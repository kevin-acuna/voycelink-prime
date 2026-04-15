// @ts-nocheck
/**
 * AI Live Dubbing Platform - Backend BFF
 * 
 * This server acts as a secure proxy between the frontend and LiveKit Server.
 * It handles room management, token generation, and OpenAI Realtime translation proxy.
 */

import cors from 'cors';
import express from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import WebSocket from 'ws';
import { canPerform, getEffectivePermissions } from './authz';
import { Permission } from './authz/permissions';
import { Role, isRole } from './authz/roles';
import { config, validateServerConfig } from './config';
import { verifyCosmosConnection } from './infrastructure/cosmos-client';
import { CosmosSessionRepository } from './infrastructure/repositories/CosmosSessionRepository';
import { logger } from './logger';
import {
    BreakoutRoomStatus,
    ParticipantId,
    Session as DomainSession,
    WaitingRoomRequestStatus,
} from './session/Session';

const app = express();
const projectRoot = process.cwd();
const runtimeDistPublicDirectory = path.join(__dirname, 'public');
const workspaceDistPublicDirectory = path.join(projectRoot, 'dist', 'public');
const workspaceSourcePublicDirectory = path.join(projectRoot, 'public');
const preferredFrontendDirectory = fs.existsSync(path.join(runtimeDistPublicDirectory, 'index.html'))
    ? runtimeDistPublicDirectory
    : fs.existsSync(path.join(workspaceDistPublicDirectory, 'index.html'))
        ? workspaceDistPublicDirectory
        : workspaceSourcePublicDirectory;
const staticAssetDirectories = [
    preferredFrontendDirectory,
    ...(preferredFrontendDirectory === workspaceSourcePublicDirectory ? [] : [workspaceSourcePublicDirectory]),
];
const frontendDocumentPath = path.join(preferredFrontendDirectory, 'index.html');

// Validate required environment variables
validateServerConfig();

// =============================================================================
// LiveKit Client Initialization
// =============================================================================
const livekitRoomService = new RoomServiceClient(
    config.livekit.url.replace('wss://', 'https://'),
    config.livekit.apiKey,
    config.livekit.apiSecret
);
const sessionRepository = new CosmosSessionRepository();

// =============================================================================
// Middleware
// =============================================================================
app.use(cors({
    origin: '*', // In production, restrict this to your frontend domain
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Participant-Id'],
    credentials: true,
}));
app.use(express.json());

// Serve static assets from the public folder (frontend)
staticAssetDirectories.forEach((directory) => {
    app.use(express.static(directory, {
        index: false,
        setHeaders: (res, filePath) => {
            if (/\.(js|css|html)$/i.test(filePath)) {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        },
    }));
});

// Request logging middleware
app.use((req, res, next) => {
    logger.info({ method: req.method, path: req.path }, 'Incoming request');
    next();
});

// =============================================================================
// Constants & In-Memory State
// =============================================================================
const AUTH_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const INVITE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const OWNER_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_COOKIE_NAME = 'voycelink_auth';
const AUTH_REFRESH_COOKIE_NAME = 'voycelink_auth_refresh';
const BOOTSTRAP_COOKIE_NAME = 'voycelink_bootstrap';
const OWNER_COOKIE_NAME = 'voycelink_owner_rooms';
const ROOM_ID_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const LIVEKIT_RETRY_ATTEMPTS = 3;
const LIVEKIT_RETRY_DELAY_MS = 250;
const permissionSubscriptions = new Map();
const BREAKOUT_ROOM_ID_PATTERN = /^[a-z0-9-]{4,64}$/;

function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const createSegment = (length) =>
        Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    return `${createSegment(3)}-${createSegment(4)}-${createSegment(3)}`;
}

function generateBreakoutRoomId() {
    return `breakout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function generateWaitingRoomRequestId() {
    return `wreq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidBreakoutRoomId(value) {
    return typeof value === 'string' && BREAKOUT_ROOM_ID_PATTERN.test(value);
}

function getParticipantIdFromBody(req) {
    if (typeof req.body?.participantId === 'string' && req.body.participantId.trim()) {
        return req.body.participantId.trim();
    }

    if (typeof req.body?.previousParticipantId === 'string' && req.body.previousParticipantId.trim()) {
        return req.body.previousParticipantId.trim();
    }

    return null;
}

function parseCookies(req) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return {};
    }

    return Object.fromEntries(
        cookieHeader
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                const separatorIndex = part.indexOf('=');
                const key = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
                const value = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : '';
                return [key, decodeURIComponent(value)];
            })
    );
}

function appendResponseCookie(res, name, value, options = {}) {
    const mergedOptions = {
        path: '/',
        sameSite: 'Lax',
        ...options,
    };
    const parts = [`${name}=${encodeURIComponent(value)}`];

    if (mergedOptions.maxAge !== undefined) {
        parts.push(`Max-Age=${mergedOptions.maxAge}`);
    }
    if (mergedOptions.path) {
        parts.push(`Path=${mergedOptions.path}`);
    }
    if (mergedOptions.httpOnly) {
        parts.push('HttpOnly');
    }
    if (mergedOptions.sameSite) {
        parts.push(`SameSite=${mergedOptions.sameSite}`);
    }
    if (mergedOptions.secure) {
        parts.push('Secure');
    }

    const existingCookies = res.getHeader('Set-Cookie');
    const nextCookie = parts.join('; ');
    if (!existingCookies) {
        res.setHeader('Set-Cookie', nextCookie);
        return;
    }

    const cookieList = Array.isArray(existingCookies) ? existingCookies : [String(existingCookies)];
    res.setHeader('Set-Cookie', [...cookieList, nextCookie]);
}

function getAccessTokenFromRequest(req) {
    const cookies = parseCookies(req);
    if (cookies[AUTH_COOKIE_NAME]) {
        return cookies[AUTH_COOKIE_NAME];
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return null;
    }

    return authHeader.slice('Bearer '.length);
}

function signAccessToken(payload) {
    return jwt.sign(payload, config.auth.jwtSecret, {
        expiresIn: config.auth.tokenTtl,
    });
}

function signRefreshToken(payload) {
    return jwt.sign(payload, config.auth.jwtSecret, {
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    });
}

function signInviteToken(payload) {
    return jwt.sign(payload, config.auth.jwtSecret, {
        expiresIn: INVITE_TOKEN_TTL_SECONDS,
    });
}

function signOwnedRoomsToken(ownedRoomIds) {
    return jwt.sign(
        { ownedRoomIds },
        config.auth.jwtSecret,
        { expiresIn: OWNER_TOKEN_TTL_SECONDS }
    );
}

function createAccessSession(role, roomId = null) {
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + AUTH_TOKEN_TTL_SECONDS * 1000);

    return {
        token: signAccessToken({
            role,
            roomId,
        }),
        role,
        roomId,
        expiresAt: expiresAt.toISOString(),
    };
}

function issueBootstrapCookies(res, authSession) {
    appendResponseCookie(res, AUTH_COOKIE_NAME, authSession.token, {
        httpOnly: true,
        maxAge: AUTH_TOKEN_TTL_SECONDS,
        secure: config.port !== 3000,
    });
    appendResponseCookie(res, AUTH_REFRESH_COOKIE_NAME, signRefreshToken({
        role: authSession.role,
        roomId: authSession.roomId,
    }), {
        httpOnly: true,
        maxAge: REFRESH_TOKEN_TTL_SECONDS,
        secure: config.port !== 3000,
    });
    issueBootstrapStateCookie(res, authSession);
}

function issueBootstrapStateCookie(res, authSession) {
    appendResponseCookie(
        res,
        BOOTSTRAP_COOKIE_NAME,
        JSON.stringify({
            role: authSession.role,
            roomId: authSession.roomId,
            expiresAt: authSession.expiresAt,
        }),
        {
            maxAge: AUTH_TOKEN_TTL_SECONDS,
            secure: config.port !== 3000,
        }
    );
}

function clearResponseCookie(res, name) {
    appendResponseCookie(res, name, '', {
        httpOnly: name !== BOOTSTRAP_COOKIE_NAME,
        maxAge: 0,
        secure: config.port !== 3000,
    });
}

function clearAuthCookies(res) {
    clearResponseCookie(res, AUTH_COOKIE_NAME);
    clearResponseCookie(res, AUTH_REFRESH_COOKIE_NAME);
    clearResponseCookie(res, BOOTSTRAP_COOKIE_NAME);
}

function getOwnedRoomsFromRequest(req) {
    const cookies = parseCookies(req);
    const ownerToken = cookies[OWNER_COOKIE_NAME];
    if (!ownerToken) {
        return new Set();
    }

    try {
        const decoded = jwt.verify(ownerToken, config.auth.jwtSecret);
        const ownedRoomIds = Array.isArray(decoded?.ownedRoomIds)
            ? decoded.ownedRoomIds.filter((roomId) => typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId))
            : [];
        return new Set(ownedRoomIds);
    } catch (error) {
        logger.warn({ err: error }, 'Ignoring invalid owner rooms cookie');
        return new Set();
    }
}

function getRefreshTokenFromRequest(req) {
    const cookies = parseCookies(req);
    return cookies[AUTH_REFRESH_COOKIE_NAME] || null;
}

function getInviteTokenFromRequest(req) {
    return typeof req.query?.invite === 'string' ? req.query.invite : null;
}

function getInviteSessionFromRequest(req) {
    const inviteToken = getInviteTokenFromRequest(req);
    const requestedRoomId =
        typeof req.query.room === 'string' && ROOM_ID_PATTERN.test(req.query.room)
            ? req.query.room
            : null;

    if (!inviteToken || !requestedRoomId) {
        return null;
    }

    try {
        const decoded = jwt.verify(inviteToken, config.auth.jwtSecret);
        if (
            !decoded ||
            typeof decoded !== 'object' ||
            decoded.role !== Role.PARTICIPANT ||
            decoded.roomId !== requestedRoomId
        ) {
            return null;
        }

        return {
            role: Role.PARTICIPANT,
            roomId: requestedRoomId,
        };
    } catch (error) {
        logger.warn({ err: error, roomId: requestedRoomId }, 'Ignoring invalid invite token');
        return null;
    }
}

function issueOwnedRoomsCookie(res, ownedRooms) {
    if (!ownedRooms || ownedRooms.size === 0) {
        return;
    }

    appendResponseCookie(
        res,
        OWNER_COOKIE_NAME,
        signOwnedRoomsToken(Array.from(ownedRooms)),
        {
            httpOnly: true,
            maxAge: OWNER_TOKEN_TTL_SECONDS,
            secure: config.port !== 3000,
        }
    );
}

function getBootstrapSessionFromRequest(req) {
    const cookies = parseCookies(req);
    const rawBootstrap = cookies[BOOTSTRAP_COOKIE_NAME];
    if (!rawBootstrap) {
        return null;
    }

    try {
        const parsed = JSON.parse(rawBootstrap);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        return {
            role: isRole(parsed.role) ? parsed.role : null,
            roomId:
                typeof parsed.roomId === 'string' && ROOM_ID_PATTERN.test(parsed.roomId)
                    ? parsed.roomId
                    : null,
        };
    } catch (error) {
        logger.warn({ err: error }, 'Ignoring invalid bootstrap session cookie');
        return null;
    }
}

function getRequestedRoomIdForRequest(req) {
    const candidateRoomIds = [
        req.params?.sessionId,
        req.query?.sessionId,
        req.query?.roomId,
        req.query?.room,
        req.body?.sessionId,
        req.body?.sessionProperties?.customSessionId,
        getBootstrapSessionFromRequest(req)?.roomId,
    ];

    return candidateRoomIds.find(
        (roomId) => typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId)
    ) || null;
}

function tryRestoreOwnerAuthentication(req, res) {
    const requestedRoomId = getRequestedRoomIdForRequest(req);
    if (!requestedRoomId) {
        return false;
    }

    const ownedRooms = getOwnedRoomsFromRequest(req);
    if (!ownedRooms.has(requestedRoomId)) {
        return false;
    }

    const authSession = createAccessSession(Role.HOST, requestedRoomId);
    issueBootstrapCookies(res, authSession);
    issueOwnedRoomsCookie(res, ownedRooms);
    req.auth = {
        role: Role.HOST,
        roomId: requestedRoomId,
    };
    logger.info({ path: req.path, roomId: requestedRoomId }, 'Restored host authentication from owner cookie');
    return true;
}

function tryRestoreLinkAuthentication(req, res) {
    const requestedRoomId = getRequestedRoomIdForRequest(req);
    if (!requestedRoomId) {
        return false;
    }

    if (tryRestoreOwnerAuthentication(req, res)) {
        return true;
    }

    const inviteSession = getInviteSessionFromRequest(req);
    if (inviteSession) {
        const authSession = createAccessSession(inviteSession.role, inviteSession.roomId);
        issueBootstrapCookies(res, authSession);
        req.auth = {
            role: inviteSession.role,
            roomId: inviteSession.roomId,
        };
        logger.info(
            { path: req.path, roomId: inviteSession.roomId },
            'Restored participant authentication from invite token'
        );
        return true;
    }

    const authSession = createAccessSession(Role.GUEST, requestedRoomId);
    issueBootstrapCookies(res, authSession);
    req.auth = {
        role: Role.GUEST,
        roomId: requestedRoomId,
    };
    logger.info({ path: req.path, roomId: requestedRoomId }, 'Restored guest authentication from room link');
    return true;
}

function resolveBootstrapSession(req, decodedToken) {
    const requestedRoomId =
        typeof req.query.room === 'string' && ROOM_ID_PATTERN.test(req.query.room)
            ? req.query.room
            : null;
    const ownedRooms = getOwnedRoomsFromRequest(req);

    if (requestedRoomId) {
        const inviteSession = getInviteSessionFromRequest(req);
        if (
            (decodedToken?.role === Role.HOST &&
                typeof decodedToken?.roomId === 'string' &&
                decodedToken.roomId === requestedRoomId) ||
            ownedRooms.has(requestedRoomId)
        ) {
            return {
                role: Role.HOST,
                roomId: requestedRoomId,
            };
        }

        if (inviteSession) {
            return inviteSession;
        }

        return {
            role: Role.GUEST,
            roomId: requestedRoomId,
        };
    }

    return {
        role: Role.HOST,
        roomId: generateRoomId(),
    };
}

function getBootstrapDebugMetadata(req) {
    return {
        originalUrl: req.originalUrl,
        path: req.path,
        roomQuery: typeof req.query?.room === 'string' ? req.query.room : null,
        roomIdQuery: typeof req.query?.roomId === 'string' ? req.query.roomId : null,
        sessionIdQuery: typeof req.query?.sessionId === 'string' ? req.query.sessionId : null,
        secFetchMode: req.headers['sec-fetch-mode'] || null,
        secFetchDest: req.headers['sec-fetch-dest'] || null,
        secFetchUser: req.headers['sec-fetch-user'] || null,
        referer: req.headers.referer || null,
        hasAccessCookie: Boolean(parseCookies(req)[AUTH_COOKIE_NAME]),
        hasRefreshCookie: Boolean(parseCookies(req)[AUTH_REFRESH_COOKIE_NAME]),
        hasBootstrapCookie: Boolean(parseCookies(req)[BOOTSTRAP_COOKIE_NAME]),
        hasOwnerCookie: Boolean(parseCookies(req)[OWNER_COOKIE_NAME]),
    };
}

function validateRoomBinding(req, res, sessionId) {
    const boundRoomId = req.auth?.roomId;

    if (!boundRoomId) {
        res.status(403).json({
            error: 'Forbidden',
            details: 'Authenticated session is not bound to a room',
        });
        return false;
    }

    if (boundRoomId !== sessionId) {
        res.status(403).json({
            error: 'Forbidden',
            details: `Authenticated session is bound to ${boundRoomId}, not ${sessionId}`,
        });
        return false;
    }

    return true;
}

function authenticateRequest(req, res, next) {
    const requestedRoomId = getRequestedRoomIdForRequest(req);
    const token = getAccessTokenFromRequest(req);
    logger.info(
        {
            path: req.path,
            method: req.method,
            requestedRoomId,
            hasAccessToken: Boolean(token),
            hasRefreshToken: Boolean(getRefreshTokenFromRequest(req)),
            bootstrapRoomId: getBootstrapSessionFromRequest(req)?.roomId ?? null,
            bootstrapRole: getBootstrapSessionFromRequest(req)?.role ?? null,
        },
        'Authenticating request'
    );

    if (!token) {
        const refreshToken = getRefreshTokenFromRequest(req);
        if (refreshToken) {
            try {
                const decodedRefresh = jwt.verify(refreshToken, config.auth.jwtSecret);
                if (decodedRefresh && typeof decodedRefresh === 'object' && isRole(decodedRefresh.role)) {
                    logger.info(
                        {
                            path: req.path,
                            method: req.method,
                            requestedRoomId,
                            refreshRole: decodedRefresh.role,
                            refreshRoomId: decodedRefresh.roomId ?? null,
                        },
                        'Recovered authentication candidate from refresh token'
                    );
                    if (
                        requestedRoomId &&
                        decodedRefresh.roomId &&
                        decodedRefresh.roomId !== requestedRoomId
                    ) {
                        logger.warn(
                            {
                                path: req.path,
                                requestedRoomId,
                                refreshRoomId: decodedRefresh.roomId,
                            },
                            'Ignoring refresh token bound to a different room'
                        );
                    } else {
                    const authSession = createAccessSession(decodedRefresh.role, decodedRefresh.roomId ?? null);
                    issueBootstrapCookies(res, authSession);
                    req.auth = {
                        role: decodedRefresh.role,
                        roomId: decodedRefresh.roomId ?? null,
                    };
                    return next();
                    }
                }
            } catch (error) {
                logger.warn({ err: error, path: req.path }, 'Invalid refresh token');
            }
        }

        if (tryRestoreLinkAuthentication(req, res)) {
            return next();
        }

        return res.status(401).json({
            error: 'Missing authorization token',
            details: 'Bearer token is required',
        });
    }

    try {
        const decoded = jwt.verify(token, config.auth.jwtSecret);
        if (!decoded || typeof decoded !== 'object' || !isRole(decoded.role)) {
            return res.status(401).json({
                error: 'Invalid authorization token',
                details: 'Access token payload does not contain a valid role',
            });
        }

        logger.info(
            {
                path: req.path,
                method: req.method,
                requestedRoomId,
                tokenRole: decoded.role,
                tokenRoomId: decoded.roomId ?? null,
            },
            'Recovered authentication from access token'
        );

        if (requestedRoomId && decoded.roomId && decoded.roomId !== requestedRoomId) {
            logger.warn(
                {
                    path: req.path,
                    requestedRoomId,
                    tokenRoomId: decoded.roomId,
                },
                'Ignoring access token bound to a different room'
            );
            if (tryRestoreLinkAuthentication(req, res)) {
                return next();
            }

            return res.status(401).json({
                error: 'Invalid authorization token',
                details: `Authenticated session is bound to ${decoded.roomId}, not ${requestedRoomId}`,
            });
        }

        req.auth = decoded;
        next();
    } catch (error) {
        const refreshToken = getRefreshTokenFromRequest(req);
        if (refreshToken) {
            try {
                const decodedRefresh = jwt.verify(refreshToken, config.auth.jwtSecret);
                if (decodedRefresh && typeof decodedRefresh === 'object' && isRole(decodedRefresh.role)) {
                    logger.info(
                        {
                            path: req.path,
                            method: req.method,
                            requestedRoomId,
                            refreshRole: decodedRefresh.role,
                            refreshRoomId: decodedRefresh.roomId ?? null,
                        },
                        'Recovered authentication candidate from refresh token after access token failure'
                    );
                    if (
                        requestedRoomId &&
                        decodedRefresh.roomId &&
                        decodedRefresh.roomId !== requestedRoomId
                    ) {
                        logger.warn(
                            {
                                path: req.path,
                                requestedRoomId,
                                refreshRoomId: decodedRefresh.roomId,
                            },
                            'Ignoring refresh token bound to a different room after access token failure'
                        );
                    } else {
                    const authSession = createAccessSession(decodedRefresh.role, decodedRefresh.roomId ?? null);
                    issueBootstrapCookies(res, authSession);
                    req.auth = {
                        role: decodedRefresh.role,
                        roomId: decodedRefresh.roomId ?? null,
                    };
                    return next();
                    }
                }
            } catch (refreshError) {
                logger.warn({ err: refreshError, path: req.path }, 'Invalid refresh token after access token failure');
            }
        }

        if (tryRestoreLinkAuthentication(req, res)) {
            return next();
        }

        logger.warn({ err: error, path: req.path }, 'Invalid or expired access token');
        res.status(401).json({
            error: 'Invalid authorization token',
            details: 'Access token is invalid or expired',
        });
    }
}

function requirePermission(permission) {
    return async (req, res, next) => {
        try {
            let effectiveRole = req.auth?.role;

            if (req.auth?.roomId && req.auth?.role !== Role.HOST) {
                const storedSession = await sessionRepository.findById(req.auth.roomId);
                const participantId = resolveRootParticipantId(
                    storedSession,
                    getParticipantIdFromRequest(req)
                );

                if (participantId) {
                    const storedRole = storedSession?.getParticipantRole?.(new ParticipantId(participantId));
                    if (storedRole) {
                        effectiveRole = storedRole;
                    }
                    req.auth.participantId = participantId;
                }
            }

            req.auth.role = effectiveRole;
            const authorization = canPerform({ role: effectiveRole }, permission);

            if (!authorization.allowed) {
                return res.status(403).json({
                    error: 'Forbidden',
                    details: authorization.reason,
                });
            }

            next();
        } catch (error) {
            logger.error({ err: error, path: req.path, permission }, 'Failed to resolve effective role for permission check');
            return res.status(500).json({
                error: 'Failed to authorize request',
                details: getErrorMessage(error),
            });
        }
    };
}

function getParticipantIdFromRequest(req) {
    const bodyParticipantId = getParticipantIdFromBody(req);
    if (bodyParticipantId) {
        return bodyParticipantId;
    }

    if (typeof req.query.participantId === 'string' && req.query.participantId.trim()) {
        return req.query.participantId.trim();
    }

    const participantIdHeader = req.headers['x-participant-id'];
    if (typeof participantIdHeader === 'string' && participantIdHeader.trim()) {
        return participantIdHeader.trim();
    }

    return null;
}

async function getAuthorizationContextForRequest(req) {
    const requestedParticipantId = getParticipantIdFromRequest(req);
    let grants = {};
    let sessionFlags = {
        chatEnabled: true,
        groupChatEnabled: false,
        whiteboardEnabled: true,
        subtitlesEnabled: false,
        aiInterpretationEnabled: false,
    };

    if (req.auth?.roomId) {
        const storedSession = await loadStoredSessionOrFail(req.auth.roomId);
        sessionFlags = storedSession.getFeatureFlags();
        const participantId = resolveRootParticipantId(storedSession, requestedParticipantId);
        if (participantId) {
            grants = storedSession.getParticipantPermissions(new ParticipantId(participantId));
        }
    }

    return {
        role: req.auth.role,
        session: sessionFlags,
        grants,
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error) {
    return error?.message || 'Unexpected error';
}

function getHttpStatusCode(error) {
    const directStatus = error?.status || error?.statusCode || error?.response?.status;
    if (typeof directStatus === 'number') {
        return directStatus;
    }

    const message = getErrorMessage(error);
    const match = message.match(/\b(4\d{2}|5\d{2})\b/);
    return match ? Number(match[1]) : null;
}

function isRetryableError(error) {
    const statusCode = getHttpStatusCode(error);
    if (statusCode === 408 || statusCode === 429) {
        return true;
    }

    if (statusCode && statusCode >= 500) {
        return true;
    }

    const message = getErrorMessage(error).toLowerCase();
    return (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('socket hang up') ||
        message.includes('econnreset') ||
        message.includes('temporarily unavailable')
    );
}

async function withRetry(operationName, handler) {
    let lastError = null;

    for (let attempt = 1; attempt <= LIVEKIT_RETRY_ATTEMPTS; attempt += 1) {
        try {
            return await handler();
        } catch (error) {
            lastError = error;
            const retryable = isRetryableError(error);

            logger.warn(
                {
                    err: error,
                    operationName,
                    attempt,
                    retryable,
                },
                'LiveKit operation failed'
            );

            if (!retryable || attempt === LIVEKIT_RETRY_ATTEMPTS) {
                throw error;
            }

            await delay(LIVEKIT_RETRY_DELAY_MS * attempt);
        }
    }

    throw lastError;
}

function sendServiceError(res, error, fallbackMessage) {
    const statusCode = getHttpStatusCode(error);
    const details = getErrorMessage(error);

    if (statusCode === 404) {
        return res.status(404).json({
            error: 'Room not found',
            details,
        });
    }

    if (statusCode && statusCode >= 400 && statusCode < 500) {
        return res.status(statusCode).json({
            error: fallbackMessage,
            details,
        });
    }

    return res.status(502).json({
        error: fallbackMessage,
        details,
    });
}

/**
 * Check if a LiveKit room exists
 */
async function livekitRoomExists(roomName) {
    try {
        const rooms = await livekitRoomService.listRooms([roomName]);
        return rooms.length > 0;
    } catch {
        return false;
    }
}

function getBreakoutLivekitRoomName(rootSessionId, breakoutRoomId) {
    return `${rootSessionId}__breakout__${breakoutRoomId}`;
}

function generateRootParticipantId() {
    return `prt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a LiveKit access token for a participant
 */
async function generateLivekitToken(roomName, participantIdentity, metadata = {}) {
    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
        identity: participantIdentity,
        metadata: JSON.stringify(metadata),
    });
    at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });
    return await at.toJwt();
}

/**
 * Remove a participant from a LiveKit room
 */
async function removeLivekitParticipant(roomName, participantIdentity) {
    try {
        await withRetry('livekit.removeParticipant', () =>
            livekitRoomService.removeParticipant(roomName, participantIdentity)
        );
        return true;
    } catch (error) {
        logger.warn(
            { err: error, roomName, participantIdentity },
            'Failed to remove LiveKit participant'
        );
        return false;
    }
}

function createHttpError(status, message, details) {
    const error = new Error(message);
    error.status = status;
    if (details !== undefined) {
        error.details = details;
    }
    return error;
}

async function loadStoredSessionOrFail(sessionId) {
    const storedSession = await sessionRepository.findById(sessionId);
    if (storedSession) {
        return storedSession;
    }

    const roomExists = await livekitRoomExists(sessionId);
    if (roomExists) {
        logger.error(
            { sessionId },
            'Root session aggregate missing while LiveKit room is still active'
        );
        throw createHttpError(
            500,
            `Root session aggregate for ${sessionId} is missing while the LiveKit room is still active`
        );
    }

    throw createHttpError(404, `Session ${sessionId} is not registered in the repository`);
}

async function getConsistentStoredSession(sessionId) {
    return loadStoredSessionOrFail(sessionId);
}

function resolveRootParticipantId(storedSession, participantIdOrConnectionId = null) {
    if (!storedSession || !participantIdOrConnectionId) {
        return null;
    }

    if (storedSession.hasParticipant(new ParticipantId(participantIdOrConnectionId))) {
        return participantIdOrConnectionId;
    }

    return storedSession.findParticipantIdByMediaConnection(participantIdOrConnectionId) || null;
}

function getRoomTargetForParticipant(storedSession, participantId = null) {
    if (!participantId) {
        return {
            type: 'main',
            breakoutRoomId: null,
            livekitRoomName: storedSession.getSessionId(),
            displayName: 'Main room',
        };
    }

    const location = storedSession.getParticipantLocation(new ParticipantId(participantId));
    if (location.type !== 'breakout' || !location.breakoutRoomId) {
        return {
            type: 'main',
            breakoutRoomId: null,
            livekitRoomName: storedSession.getSessionId(),
            displayName: 'Main room',
        };
    }

    const breakoutRoom = storedSession.getBreakoutRoom(location.breakoutRoomId);
    if (!breakoutRoom || breakoutRoom.status !== BreakoutRoomStatus.OPEN || !breakoutRoom.livekitRoomName) {
        return {
            type: 'main',
            breakoutRoomId: null,
            livekitRoomName: storedSession.getSessionId(),
            displayName: 'Main room',
        };
    }

    return {
        type: 'breakout',
        breakoutRoomId: breakoutRoom.id,
        livekitRoomName: breakoutRoom.livekitRoomName,
        displayName: breakoutRoom.name,
        status: breakoutRoom.status,
    };
}

function buildBreakoutSnapshot(storedSession) {
    return {
        revision: storedSession.getRevision(),
        session: storedSession.getFeatureFlags(),
        breakoutRooms: storedSession.getBreakoutRooms(),
        waitingRoomRequests: storedSession.getPendingWaitingRoomRequests(),
        participantLocations: storedSession.getParticipantLocations(),
        participantProfiles: storedSession.getParticipantProfiles(),
        participantRoles: storedSession.getParticipantRoles(),
        participantPermissions: storedSession.getAllParticipantPermissions(),
        participantPresence: storedSession.getParticipantPresenceMap(),
        participantMediaConnections: storedSession.getParticipantMediaConnections(),
        whiteboardState: storedSession.getWhiteboardStateSnapshot(),
    };
}

function summarizeStoredSessionForLogs(storedSession) {
    if (!storedSession) {
        return null;
    }

    const participantPresence = storedSession.getParticipantPresenceMap();
    const participantLocations = storedSession.getParticipantLocations();
    const breakoutRooms = storedSession.getBreakoutRooms();

    return {
        revision: storedSession.getRevision(),
        connectedParticipantCount: Object.values(participantPresence).filter((presence) => presence === 'connected').length,
        waitingRoomRequestCount: storedSession.getPendingWaitingRoomRequests().length,
        waitingRoomRequests: storedSession.getPendingWaitingRoomRequests().map((request) => ({
            id: request.id,
            nickname: request.nickname,
            role: request.role,
            status: request.status,
        })),
        participantLocations,
        breakoutRooms: breakoutRooms.map((room) => ({
            id: room.id,
            name: room.name,
            status: room.status,
            livekitRoomName: room.livekitRoomName,
            participantIds: room.participantIds,
        })),
    };
}

function resolveWhiteboardLocation(payload = {}) {
    if (payload?.roomType === 'breakout') {
        if (!payload.breakoutRoomId || !isValidBreakoutRoomId(payload.breakoutRoomId)) {
            throw new Error('A valid breakoutRoomId is required for breakout whiteboard state');
        }

        return {
            type: 'breakout',
            breakoutRoomId: payload.breakoutRoomId,
        };
    }

    return {
        type: 'main',
        breakoutRoomId: null,
    };
}

function buildWhiteboardStatePayload(storedSession, location) {
    const roomState = storedSession.getWhiteboardRoomState(location);
    return {
        roomType: location.type,
        breakoutRoomId: location.breakoutRoomId ?? null,
        roomState,
        whiteboardState: storedSession.getWhiteboardStateSnapshot(),
    };
}

function broadcastWhiteboardState(rootSessionId, storedSession, location) {
    broadcastPermissionUpdate(rootSessionId, {
        type: 'whiteboard_state_updated',
        sessionId: rootSessionId,
        ...buildWhiteboardStatePayload(storedSession, location),
        ...buildBreakoutSnapshot(storedSession),
    });
}

function broadcastBreakoutSnapshot(rootSessionId, storedSession) {
    broadcastPermissionUpdate(rootSessionId, {
        type: 'breakout_rooms_updated',
        sessionId: rootSessionId,
        ...buildBreakoutSnapshot(storedSession),
    });
}

function broadcastWaitingRoomSnapshot(rootSessionId, storedSession) {
    broadcastPermissionUpdate(rootSessionId, {
        type: 'waiting_room_updated',
        sessionId: rootSessionId,
        ...buildBreakoutSnapshot(storedSession),
    });
}

function broadcastRoomTransferRequested(rootSessionId, storedSession, participantId, targetRoom) {
    broadcastPermissionUpdate(rootSessionId, {
        type: 'room_transfer_requested',
        sessionId: rootSessionId,
        participantId,
        targetRoom,
        ...buildBreakoutSnapshot(storedSession),
    });
}

function canManageRequestedPermissions(role, permissionPatch) {
    const needsParticipantMediaManagement =
        permissionPatch.mediaEnabled !== undefined ||
        permissionPatch.audioEnabled !== undefined ||
        permissionPatch.videoEnabled !== undefined ||
        permissionPatch.screenShareEnabled !== undefined;
    const needsWhiteboardManagement = permissionPatch.whiteboardEnabled !== undefined;

    if (
        needsParticipantMediaManagement &&
        !canPerform({ role }, Permission.MANAGE_PARTICIPANT_MEDIA).allowed
    ) {
        return {
            allowed: false,
            reason: 'Current user cannot manage participant media permissions',
        };
    }

    if (
        needsWhiteboardManagement &&
        !canPerform({ role }, Permission.MANAGE_WHITEBOARD).allowed
    ) {
        return {
            allowed: false,
            reason: 'Current user cannot manage whiteboard permissions',
        };
    }

    return {
        allowed: true,
        reason: 'Permission update is allowed',
    };
}

function requiresWaitingRoomApproval(role, participantId = null, isAuxiliaryMedia = false) {
    if (isAuxiliaryMedia || participantId) {
        return false;
    }

    return role !== Role.HOST && role !== Role.CO_HOST;
}

function canModerateTargetRole(actorRole, targetRole) {
    if (actorRole !== Role.CO_HOST) {
        return {
            allowed: true,
            reason: 'Target role can be moderated',
        };
    }

    if (targetRole === Role.HOST || targetRole === Role.CO_HOST) {
        return {
            allowed: false,
            reason: 'Co-hosts cannot moderate the host or other co-hosts',
        };
    }

    return {
        allowed: true,
        reason: 'Target role can be moderated',
    };
}

function normalizePermissionPatch(payload) {
    const permissionPatch = {};
    if (payload.mediaEnabled !== undefined) {
        if (typeof payload.mediaEnabled !== 'boolean') {
            throw new Error('Field mediaEnabled must be a boolean');
        }

        permissionPatch.audioEnabled = payload.mediaEnabled;
        permissionPatch.videoEnabled = payload.mediaEnabled;
    }

    const supportedFields = [
        'audioEnabled',
        'videoEnabled',
        'screenShareEnabled',
        'whiteboardEnabled',
    ];

    for (const field of supportedFields) {
        if (payload[field] === undefined) {
            continue;
        }

        if (typeof payload[field] !== 'boolean') {
            throw new Error(`Field ${field} must be a boolean`);
        }

        permissionPatch[field] = payload[field];
    }

    return permissionPatch;
}

function addPermissionSubscription(roomId, ws) {
    if (!permissionSubscriptions.has(roomId)) {
        permissionSubscriptions.set(roomId, new Set());
    }

    permissionSubscriptions.get(roomId).add(ws);
}

function removePermissionSubscription(roomId, ws) {
    const subscribers = permissionSubscriptions.get(roomId);
    if (!subscribers) {
        return;
    }

    subscribers.delete(ws);
    if (subscribers.size === 0) {
        permissionSubscriptions.delete(roomId);
    }
}

function broadcastPermissionUpdate(roomId, message) {
    const subscribers = permissionSubscriptions.get(roomId);
    if (!subscribers) {
        return;
    }

    for (const ws of subscribers) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
}

// =============================================================================
// API Routes
// =============================================================================

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        livekitUrl: config.livekit.url,
        cosmosDatabase: config.cosmos.databaseName,
        cosmosContainers: [
            config.cosmos.roomsContainerName,
            config.cosmos.participantPermissionsContainerName,
        ],
    });
});

app.post('/api/bootstrap/host-session', (req, res) => {
    const roomId = generateRoomId();
    const authSession = createAccessSession(Role.HOST, roomId);
    issueBootstrapCookies(res, authSession);

    const ownedRooms = getOwnedRoomsFromRequest(req);
    ownedRooms.add(roomId);
    issueOwnedRoomsCookie(res, ownedRooms);

    logger.info({ roomId }, 'Issued explicit host bootstrap session');
    res.json({
        role: Role.HOST,
        roomId,
        expiresAt: authSession.expiresAt,
    });
});

app.get('/api/health/cosmos', async (req, res) => {
    try {
        const database = await verifyCosmosConnection();
        res.json({
            status: 'ok',
            databaseId: database?.id ?? config.cosmos.databaseName,
            containers: {
                rooms: config.cosmos.roomsContainerName,
                participantPermissions: config.cosmos.participantPermissionsContainerName,
            },
        });
    } catch (error) {
        logger.error({ err: error }, 'Cosmos DB health check failed');
        res.status(500).json({
            status: 'error',
            error: 'Cosmos DB health check failed',
            details: error.message,
        });
    }
});

app.use('/api', (req, res, next) => {
    if (req.path === '/health') {
        return next();
    }

    return authenticateRequest(req, res, next);
});

/**
 * GET /api/azure-speech-token
 * Returns Azure Speech credentials for client-side transcription
 */
app.get('/api/azure-speech-token', requirePermission(Permission.JOIN_SESSION), (req, res) => {
    if (!config.azure.speechKey) {
        logger.error('AZURE_SPEECH_KEY not configured');
        return res.status(500).json({ 
            error: 'Azure Speech not configured',
            details: 'AZURE_SPEECH_KEY environment variable is not set'
        });
    }
    
    logger.info({ region: config.azure.speechRegion }, 'Providing Azure Speech credentials');
    res.json({
        token: config.azure.speechKey,
        region: config.azure.speechRegion
    });
});

app.get('/api/me/permissions', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const storedSession = req.auth.roomId
            ? await loadStoredSessionOrFail(req.auth.roomId)
            : null;
        const participantId = resolveRootParticipantId(storedSession, getParticipantIdFromRequest(req));
        const authorizationContext = await getAuthorizationContextForRequest(
            Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
                query: participantId ? { ...req.query, participantId } : req.query,
            })
        );
        const permissions = getEffectivePermissions(authorizationContext);
        const authSession = createAccessSession(req.auth.role, req.auth.roomId ?? null);
        issueBootstrapCookies(res, authSession);
        const roomTarget = storedSession
            ? getRoomTargetForParticipant(storedSession, participantId)
            : {
                type: 'main',
                breakoutRoomId: null,
                livekitRoomName: req.auth.roomId ?? null,
                displayName: 'Main room',
            };

        logger.info(
            {
                roomId: req.auth.roomId ?? null,
                participantId,
                role: req.auth.role,
                roomTarget,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Resolved /api/me/permissions'
        );

        res.json({
            role: req.auth.role,
            roomId: req.auth.roomId ?? null,
            permissions,
            session: authorizationContext.session,
            grants: authorizationContext.grants ?? {},
            currentRootParticipantId: participantId,
            roomTarget,
            revision: storedSession?.getRevision?.() ?? 0,
            breakoutRooms: storedSession?.getBreakoutRooms?.() || [],
            waitingRoomRequests: storedSession?.getPendingWaitingRoomRequests?.() || [],
            participantLocations: storedSession?.getParticipantLocations?.() || {},
            participantProfiles: storedSession?.getParticipantProfiles?.() || {},
            participantRoles: storedSession?.getParticipantRoles?.() || {},
            participantPermissions: storedSession?.getAllParticipantPermissions?.() || {},
            participantPresence: storedSession?.getParticipantPresenceMap?.() || {},
            participantMediaConnections: storedSession?.getParticipantMediaConnections?.() || {},
            whiteboardState: storedSession?.getWhiteboardStateSnapshot?.() || {
                main: { isOpen: false, canvasState: null, updatedAt: null },
                breakouts: {},
            },
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to resolve current permissions');
        res.status(500).json({
            error: 'Failed to resolve current permissions',
            details: getErrorMessage(error),
        });
    }
});

app.get('/api/sessions/:sessionId/invite-link', requirePermission(Permission.CREATE_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const inviteToken = signInviteToken({
            role: Role.PARTICIPANT,
            roomId: sessionId,
        });

        res.json({
            sessionId,
            inviteToken,
            inviteUrl: `${req.protocol}://${req.get('host')}/?room=${sessionId}&invite=${encodeURIComponent(inviteToken)}`,
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to generate invite link');
        res.status(500).json({
            error: 'Failed to generate invite link',
            details: getErrorMessage(error),
        });
    }
});

app.get('/api/sessions/:sessionId/room-target', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);

        const participantId = resolveRootParticipantId(storedSession, getParticipantIdFromRequest(req));
        const authorizationContext = await getAuthorizationContextForRequest(req);
        const roomTarget = getRoomTargetForParticipant(storedSession, participantId);

        logger.info(
            {
                sessionId,
                participantId,
                role: req.auth.role,
                roomTarget,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Resolved room target'
        );

        return res.json({
            sessionId,
            participantId,
            currentRootParticipantId: participantId,
            roomTarget,
            role: req.auth.role,
            permissions: getEffectivePermissions(authorizationContext),
            ...buildBreakoutSnapshot(storedSession),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to resolve room target');
        return res.status(500).json({
            error: 'Failed to resolve room target',
            details: getErrorMessage(error),
        });
    }
});

app.get('/api/sessions/:sessionId/breakouts', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        logger.info(
            {
                sessionId,
                requesterRole: req.auth.role,
                requesterParticipantId: getParticipantIdFromRequest(req),
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Serving breakout snapshot'
        );

        return res.json(buildBreakoutSnapshot(storedSession));
    } catch (error) {
        logger.error({ err: error }, 'Failed to list breakout rooms');
        return res.status(500).json({
            error: 'Failed to list breakout rooms',
            details: getErrorMessage(error),
        });
    }
});

app.post('/api/sessions/:sessionId/waiting-room/requests', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;
        const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : '';
        const preferredLanguage = typeof req.body?.preferredLanguage === 'string'
            ? req.body.preferredLanguage.trim() || 'en'
            : 'en';
        const requestId = typeof req.body?.requestId === 'string' && req.body.requestId.trim()
            ? req.body.requestId.trim()
            : generateWaitingRoomRequestId();

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        if (!nickname) {
            return res.status(400).json({
                error: 'Nickname is required',
                details: 'A nickname is required to create a waiting room request',
            });
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const participantId = resolveRootParticipantId(storedSession, getParticipantIdFromRequest(req));

        if (participantId || req.auth.role === Role.HOST || req.auth.role === Role.CO_HOST) {
            return res.json({
                waitingRoomRequired: false,
                admitted: true,
                currentRootParticipantId: participantId,
                request: null,
                ...buildBreakoutSnapshot(storedSession),
            });
        }

        const existingRequest = storedSession.getWaitingRoomRequest(requestId);
        const requestedAt = existingRequest?.requestedAt || new Date().toISOString();
        storedSession.upsertWaitingRoomRequest({
            id: requestId,
            nickname,
            preferredLanguage,
            role: req.auth.role,
            status: existingRequest?.status || WaitingRoomRequestStatus.PENDING,
            requestedAt,
            decidedAt: existingRequest?.decidedAt || null,
            decidedByRole: existingRequest?.decidedByRole || null,
        });
        await sessionRepository.save(storedSession);

        logger.info(
            {
                sessionId,
                requestId,
                nickname,
                preferredLanguage,
                role: req.auth.role,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            existingRequest ? 'Updated waiting room request' : 'Created waiting room request'
        );

        broadcastWaitingRoomSnapshot(sessionId, storedSession);

        return res.status(existingRequest ? 200 : 201).json({
            waitingRoomRequired: true,
            admitted: false,
            request: storedSession.getWaitingRoomRequest(requestId),
            ...buildBreakoutSnapshot(storedSession),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to create waiting room request');
        return res.status(error.status || 500).json({
            error: 'Failed to create waiting room request',
            details: error.details || getErrorMessage(error),
        });
    }
});

app.get('/api/sessions/:sessionId/waiting-room/requests/:requestId', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId, requestId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const request = storedSession.getWaitingRoomRequest(requestId);
        if (!request) {
            return res.status(404).json({
                error: 'Waiting room request not found',
                details: `Waiting room request ${requestId} does not exist`,
            });
        }

        return res.json({
            request,
            revision: storedSession.getRevision(),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to fetch waiting room request');
        return res.status(error.status || 500).json({
            error: 'Failed to fetch waiting room request',
            details: error.details || getErrorMessage(error),
        });
    }
});

app.delete('/api/sessions/:sessionId/waiting-room/requests/:requestId', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId, requestId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const request = storedSession.getWaitingRoomRequest(requestId);
        if (!request) {
            return res.status(404).json({
                error: 'Waiting room request not found',
                details: `Waiting room request ${requestId} does not exist`,
            });
        }

        storedSession.removeWaitingRoomRequest(requestId);
        await sessionRepository.save(storedSession);

        logger.info(
            {
                sessionId,
                requestId,
                role: req.auth.role,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Removed waiting room request'
        );

        broadcastWaitingRoomSnapshot(sessionId, storedSession);
        return res.json({
            removed: true,
            requestId,
            ...buildBreakoutSnapshot(storedSession),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to remove waiting room request');
        return res.status(error.status || 500).json({
            error: 'Failed to remove waiting room request',
            details: error.details || getErrorMessage(error),
        });
    }
});

app.post('/api/sessions/:sessionId/waiting-room/requests/:requestId/approve', requirePermission(Permission.ADMIT_WAITING_ROOM), async (req, res) => {
    try {
        const { sessionId, requestId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const request = storedSession.getWaitingRoomRequest(requestId);
        if (!request) {
            return res.status(404).json({
                error: 'Waiting room request not found',
                details: `Waiting room request ${requestId} does not exist`,
            });
        }

        if (request.status !== WaitingRoomRequestStatus.APPROVED) {
            storedSession.approveWaitingRoomRequest(requestId, new Date().toISOString(), req.auth.role);
            await sessionRepository.save(storedSession);
            broadcastWaitingRoomSnapshot(sessionId, storedSession);
        }

        logger.info(
            {
                sessionId,
                requestId,
                decidedByRole: req.auth.role,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Approved waiting room request'
        );

        return res.json({
            request: storedSession.getWaitingRoomRequest(requestId),
            ...buildBreakoutSnapshot(storedSession),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to approve waiting room request');
        return res.status(error.status || 500).json({
            error: 'Failed to approve waiting room request',
            details: error.details || getErrorMessage(error),
        });
    }
});

app.post('/api/sessions/:sessionId/waiting-room/requests/:requestId/reject', requirePermission(Permission.ADMIT_WAITING_ROOM), async (req, res) => {
    try {
        const { sessionId, requestId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const request = storedSession.getWaitingRoomRequest(requestId);
        if (!request) {
            return res.status(404).json({
                error: 'Waiting room request not found',
                details: `Waiting room request ${requestId} does not exist`,
            });
        }

        if (request.status !== WaitingRoomRequestStatus.REJECTED) {
            storedSession.rejectWaitingRoomRequest(requestId, new Date().toISOString(), req.auth.role);
            await sessionRepository.save(storedSession);
            broadcastWaitingRoomSnapshot(sessionId, storedSession);
        }

        logger.info(
            {
                sessionId,
                requestId,
                decidedByRole: req.auth.role,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Rejected waiting room request'
        );

        return res.json({
            request: storedSession.getWaitingRoomRequest(requestId),
            ...buildBreakoutSnapshot(storedSession),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to reject waiting room request');
        return res.status(error.status || 500).json({
            error: 'Failed to reject waiting room request',
            details: error.details || getErrorMessage(error),
        });
    }
});

app.post('/api/sessions/:sessionId/breakouts', requirePermission(Permission.MANAGE_BREAKOUT_ROOMS), async (req, res) => {
    try {
        const { sessionId } = req.params;
        const requestedName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const breakoutRoomName = requestedName || `Breakout ${Date.now().toString(36).slice(-4).toUpperCase()}`;

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);

        const breakoutRoomId = generateBreakoutRoomId();
        storedSession.createBreakoutRoom(breakoutRoomId, breakoutRoomName);
        await sessionRepository.save(storedSession);
        logger.info(
            {
                sessionId,
                breakoutRoomId,
                breakoutRoomName,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Created breakout room'
        );
        broadcastBreakoutSnapshot(sessionId, storedSession);

        return res.status(201).json({
            breakoutRoom: storedSession.getBreakoutRoom(breakoutRoomId),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to create breakout room');
        return res.status(error?.status || 400).json({
            error: 'Failed to create breakout room',
            details: getErrorMessage(error),
        });
    }
});

app.patch('/api/sessions/:sessionId/breakouts/:breakoutRoomId', requirePermission(Permission.MANAGE_BREAKOUT_ROOMS), async (req, res) => {
    try {
        const { sessionId, breakoutRoomId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);

        storedSession.updateBreakoutRoom(breakoutRoomId, {
            name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        });
        await sessionRepository.save(storedSession);
        logger.info(
            {
                sessionId,
                breakoutRoomId,
                requestedName: req.body?.name,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Updated breakout room'
        );
        broadcastBreakoutSnapshot(sessionId, storedSession);

        return res.json({
            breakoutRoom: storedSession.getBreakoutRoom(breakoutRoomId),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to update breakout room');
        return res.status(error?.status || 400).json({
            error: 'Failed to update breakout room',
            details: getErrorMessage(error),
        });
    }
});

app.post('/api/sessions/:sessionId/breakouts/:breakoutRoomId/open', requirePermission(Permission.MANAGE_BREAKOUT_ROOMS), async (req, res) => {
    try {
        const { sessionId, breakoutRoomId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);

        const breakoutRoom = storedSession.getBreakoutRoom(breakoutRoomId);
        if (!breakoutRoom) {
            return res.status(404).json({
                error: 'Breakout room not found',
                details: `Breakout room ${breakoutRoomId} does not exist`,
            });
        }

        const livekitRoomName =
            breakoutRoom.livekitRoomName || getBreakoutLivekitRoomName(sessionId, breakoutRoomId);

        // LiveKit rooms are created on-the-fly when first participant connects
        storedSession.openBreakoutRoom(breakoutRoomId, livekitRoomName, new Date().toISOString());
        await sessionRepository.save(storedSession);
        logger.info(
            {
                sessionId,
                breakoutRoomId,
                livekitRoomName,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Opened breakout room'
        );
        broadcastBreakoutSnapshot(sessionId, storedSession);

        return res.json({
            breakoutRoom: storedSession.getBreakoutRoom(breakoutRoomId),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to open breakout room');
        return sendServiceError(res, error, 'Failed to open breakout room');
    }
});

app.post('/api/sessions/:sessionId/breakouts/:breakoutRoomId/close', requirePermission(Permission.MANAGE_BREAKOUT_ROOMS), async (req, res) => {
    try {
        const { sessionId, breakoutRoomId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);

        const breakoutRoom = storedSession.getBreakoutRoom(breakoutRoomId);
        if (!breakoutRoom) {
            return res.status(404).json({
                error: 'Breakout room not found',
                details: `Breakout room ${breakoutRoomId} does not exist`,
            });
        }

        const movedParticipantIds = [...breakoutRoom.participantIds];
        storedSession.closeBreakoutRoom(breakoutRoomId, new Date().toISOString());
        await sessionRepository.save(storedSession);
        logger.info(
            {
                sessionId,
                breakoutRoomId,
                movedParticipantIds,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Closed breakout room'
        );
        broadcastBreakoutSnapshot(sessionId, storedSession);

        for (const participantId of movedParticipantIds) {
            broadcastRoomTransferRequested(
                sessionId,
                storedSession,
                participantId,
                getRoomTargetForParticipant(storedSession, participantId)
            );
        }

        return res.json({
            breakoutRoom: storedSession.getBreakoutRoom(breakoutRoomId),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to close breakout room');
        return res.status(error?.status || 400).json({
            error: 'Failed to close breakout room',
            details: getErrorMessage(error),
        });
    }
});

app.delete('/api/sessions/:sessionId/breakouts/:breakoutRoomId', requirePermission(Permission.MANAGE_BREAKOUT_ROOMS), async (req, res) => {
    try {
        const { sessionId, breakoutRoomId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const breakoutRoom = storedSession.getBreakoutRoom(breakoutRoomId);
        if (!breakoutRoom) {
            return res.status(404).json({
                error: 'Breakout room not found',
                details: `Breakout room ${breakoutRoomId} does not exist`,
            });
        }

        const connectedParticipantIds = (breakoutRoom.participantIds || []).filter((participantId) => {
            return storedSession.getParticipantPresence(new ParticipantId(participantId)) === 'connected';
        });

        if (connectedParticipantIds.length > 0) {
            return res.status(409).json({
                error: 'Breakout room not empty',
                details: 'Connected participants must return to the main room before deleting this breakout room',
            });
        }

        if (breakoutRoom.status === BreakoutRoomStatus.OPEN) {
            storedSession.closeBreakoutRoom(breakoutRoomId, new Date().toISOString());
        }

        storedSession.deleteBreakoutRoom(breakoutRoomId);
        await sessionRepository.save(storedSession);
        logger.info(
            {
                sessionId,
                breakoutRoomId,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Deleted breakout room'
        );
        broadcastBreakoutSnapshot(sessionId, storedSession);

        return res.status(204).send();
    } catch (error) {
        logger.error({ err: error }, 'Failed to delete breakout room');
        return res.status(error?.status || 400).json({
            error: 'Failed to delete breakout room',
            details: getErrorMessage(error),
        });
    }
});

app.put('/api/sessions/:sessionId/participants/:participantId/location', requirePermission(Permission.MOVE_PARTICIPANT_BETWEEN_ROOMS), async (req, res) => {
    try {
        const { sessionId, participantId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);

        const resolvedParticipantId = resolveRootParticipantId(storedSession, participantId);
        if (!resolvedParticipantId) {
            return res.status(404).json({
                error: 'Participant not found',
                details: `Participant ${participantId} is not registered in session ${sessionId}`,
            });
        }
        const participantRef = new ParticipantId(resolvedParticipantId);

        const targetType = req.body?.target === 'breakout' ? 'breakout' : 'main';
        const breakoutRoomId = req.body?.breakoutRoomId;
        const participantPresence = storedSession.getParticipantPresence(participantRef);

        if (participantPresence !== 'connected' && targetType === 'breakout') {
            return res.status(409).json({
                error: 'Participant disconnected',
                details: `Participant ${participantId} must rejoin the conference before being moved to a breakout room`,
            });
        }

        if (targetType === 'breakout') {
            if (!isValidBreakoutRoomId(breakoutRoomId)) {
                return res.status(400).json({
                    error: 'Invalid breakout room',
                    details: 'A valid breakoutRoomId is required',
                });
            }

            const breakoutRoom = storedSession.getBreakoutRoom(breakoutRoomId);
            if (!breakoutRoom) {
                return res.status(404).json({
                    error: 'Breakout room not found',
                    details: `Breakout room ${breakoutRoomId} does not exist`,
                });
            }

            if (breakoutRoom.status !== BreakoutRoomStatus.OPEN) {
                return res.status(409).json({
                    error: 'Breakout room not open',
                    details: `Breakout room ${breakoutRoomId} must be opened before moving participants`,
                });
            }

            storedSession.assignParticipantToBreakout(participantRef, breakoutRoomId);
        } else {
            storedSession.returnParticipantToMain(participantRef);
        }

        await sessionRepository.save(storedSession);
        logger.info(
            {
                sessionId,
                resolvedParticipantId,
                targetType,
                breakoutRoomId: targetType === 'breakout' ? breakoutRoomId : null,
                resultingRoomTarget: getRoomTargetForParticipant(storedSession, resolvedParticipantId),
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Moved participant between rooms'
        );
        broadcastBreakoutSnapshot(sessionId, storedSession);
        broadcastRoomTransferRequested(
            sessionId,
            storedSession,
            resolvedParticipantId,
            getRoomTargetForParticipant(storedSession, resolvedParticipantId)
        );

        return res.json({
            participantId: resolvedParticipantId,
            roomTarget: getRoomTargetForParticipant(storedSession, resolvedParticipantId),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to move participant between rooms');
        return res.status(error?.status || 400).json({
            error: 'Failed to move participant between rooms',
            details: getErrorMessage(error),
        });
    }
});

app.post('/api/sessions/:sessionId/participants/:participantId/disconnect', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId, participantId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const requestParticipantId = resolveRootParticipantId(
            await getConsistentStoredSession(sessionId),
            getParticipantIdFromRequest(req)
        );
        const storedSession = await getConsistentStoredSession(sessionId);
        const resolvedParticipantId = resolveRootParticipantId(storedSession, participantId);
        const isSelfDisconnect = requestParticipantId && resolvedParticipantId && requestParticipantId === resolvedParticipantId;
        const canModerateDisconnect =
            canPerform({ role: req.auth.role }, Permission.KICK_PARTICIPANT).allowed ||
            canPerform({ role: req.auth.role }, Permission.MOVE_PARTICIPANT_BETWEEN_ROOMS).allowed;

        if (!isSelfDisconnect && !canModerateDisconnect) {
            return res.status(403).json({
                error: 'Forbidden',
                details: 'You cannot disconnect another participant',
            });
        }

        if (!resolvedParticipantId) {
            return res.status(204).send();
        }
        const participantRef = new ParticipantId(resolvedParticipantId);

        const disconnectingRole = storedSession.getParticipantRole(participantRef);
        storedSession.markParticipantDisconnected(participantRef);
        await sessionRepository.save(storedSession);
        logger.info(
            {
                sessionId,
                resolvedParticipantId,
                isSelfDisconnect,
                disconnectingRole,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Marked participant disconnected'
        );
        broadcastBreakoutSnapshot(sessionId, storedSession);
        broadcastPermissionUpdate(sessionId, {
            type: 'participant_left_conference',
            sessionId,
            participantId: resolvedParticipantId,
            ...buildBreakoutSnapshot(storedSession),
        });

        // If the host disconnected, notify all remaining participants
        if (disconnectingRole === Role.HOST) {
            // Find a connected co-host to auto-promote
            const roles = storedSession.getParticipantRoles();
            const presence = storedSession.getParticipantPresenceMap();
            const connectedCoHost = Object.entries(roles).find(
                ([pid, role]) => role === Role.CO_HOST && presence[pid] === 'connected'
            );

            // Actually promote the co-host to host in the stored session
            if (connectedCoHost) {
                storedSession.setParticipantRole(new ParticipantId(connectedCoHost[0]), Role.HOST);
            } else {
                // No co-host — revoke audio/video permissions for all connected participants
                for (const [pid, status] of Object.entries(presence)) {
                    if (status === 'connected' && roles[pid] === Role.PARTICIPANT) {
                        storedSession.updateParticipantPermissions(new ParticipantId(pid), {
                            audioEnabled: false,
                            videoEnabled: false,
                        });
                    }
                }
                logger.info({ sessionId }, 'Revoked audio/video for all participants — no co-host available');
            }
            await sessionRepository.save(storedSession);

            broadcastPermissionUpdate(sessionId, {
                type: 'host_disconnected',
                sessionId,
                hasCoHost: Boolean(connectedCoHost),
                promotedParticipantId: connectedCoHost ? connectedCoHost[0] : null,
                ...buildBreakoutSnapshot(storedSession),
            });
            logger.info(
                { sessionId, hasCoHost: Boolean(connectedCoHost), promotedCoHost: connectedCoHost?.[0] || null },
                'Host disconnected — notified participants'
            );
        }

        return res.status(204).send();
    } catch (error) {
        logger.error({ err: error }, 'Failed to mark participant disconnected');
        return res.status(error?.status || 400).json({
            error: 'Failed to mark participant disconnected',
            details: getErrorMessage(error),
        });
    }
});

// End meeting — host closes the session for everyone
app.post('/api/sessions/:sessionId/end-meeting', requirePermission(Permission.END_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const presence = storedSession.getParticipantPresenceMap();
        const mediaConnections = storedSession.getParticipantMediaConnections();
        const roomTarget = getRoomTargetForParticipant(storedSession);
        const targetRoomName = roomTarget?.livekitRoomName || sessionId;

        // Remove all connected participants from LiveKit
        const removalPromises = [];
        for (const [pid, status] of Object.entries(presence)) {
            if (status === 'connected') {
                const mediaId = mediaConnections[pid];
                if (mediaId) {
                    removalPromises.push(
                        removeLivekitParticipant(targetRoomName, mediaId).catch((err) =>
                            logger.warn({ err, participantId: pid }, 'Failed to remove participant from LiveKit during end-meeting')
                        )
                    );
                }
                storedSession.markParticipantDisconnected(new ParticipantId(pid));
            }
        }
        await Promise.allSettled(removalPromises);
        await sessionRepository.save(storedSession);

        broadcastPermissionUpdate(sessionId, {
            type: 'meeting_ended',
            sessionId,
            reason: 'The host has ended the meeting.',
        });

        logger.info({ sessionId }, 'Meeting ended by host');
        return res.status(204).send();
    } catch (error) {
        logger.error({ err: error }, 'Failed to end meeting');
        return sendServiceError(res, error, 'Failed to end the meeting');
    }
});

// Transfer host role to a specific co-host
app.post('/api/sessions/:sessionId/transfer-host', requirePermission(Permission.END_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const targetParticipantId = req.body?.participantId;
        if (!targetParticipantId) {
            return res.status(400).json({ error: 'Missing participantId', details: 'You must specify the co-host to promote.' });
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const resolvedTargetId = resolveRootParticipantId(storedSession, targetParticipantId);
        if (!resolvedTargetId) {
            return res.status(404).json({ error: 'Participant not found', details: `Participant ${targetParticipantId} not found.` });
        }

        const targetRef = new ParticipantId(resolvedTargetId);
        const targetRole = storedSession.getParticipantRole(targetRef);
        if (targetRole !== Role.CO_HOST) {
            return res.status(400).json({ error: 'Invalid target', details: 'Host can only be transferred to a co-host.' });
        }

        const targetPresence = storedSession.getParticipantPresence(targetRef);
        if (targetPresence !== 'connected') {
            return res.status(400).json({ error: 'Target not connected', details: 'The target co-host is not currently connected.' });
        }

        // Promote the co-host to host
        storedSession.setParticipantRole(targetRef, Role.HOST);

        // Demote current host to co-host (so they retain elevated access until they actually leave)
        const currentHostId = getParticipantIdFromRequest(req);
        const resolvedCurrentHostId = resolveRootParticipantId(storedSession, currentHostId);
        if (resolvedCurrentHostId) {
            storedSession.setParticipantRole(new ParticipantId(resolvedCurrentHostId), Role.CO_HOST);
        }

        await sessionRepository.save(storedSession);

        broadcastPermissionUpdate(sessionId, {
            type: 'host_transferred',
            sessionId,
            newHostParticipantId: resolvedTargetId,
            previousHostParticipantId: resolvedCurrentHostId,
            ...buildBreakoutSnapshot(storedSession),
        });

        logger.info(
            { sessionId, newHost: resolvedTargetId, previousHost: resolvedCurrentHostId },
            'Host role transferred'
        );

        return res.json({
            transferred: true,
            newHostParticipantId: resolvedTargetId,
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to transfer host role');
        return sendServiceError(res, error, 'Failed to transfer host role');
    }
});

app.patch('/api/sessions/:sessionId/participants/:participantId/permissions', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId, participantId } = req.params;

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const permissionPatch = normalizePermissionPatch(req.body ?? {});
        if (Object.keys(permissionPatch).length === 0) {
            return res.status(400).json({
                error: 'Invalid permission patch',
                details: 'At least one supported permission flag must be provided',
            });
        }

        const authorization = canManageRequestedPermissions(req.auth.role, permissionPatch);
        if (!authorization.allowed) {
            return res.status(403).json({
                error: 'Forbidden',
                details: authorization.reason,
            });
        }

        const storedSession = await getConsistentStoredSession(sessionId);

        const resolvedParticipantId = resolveRootParticipantId(storedSession, participantId);
        if (!resolvedParticipantId) {
            return res.status(404).json({
                error: 'Participant not found',
                details: `Participant ${participantId} is not registered in session ${sessionId}`,
            });
        }

        const participantRef = new ParticipantId(resolvedParticipantId);
        const targetRole = storedSession.getParticipantRole(participantRef) || Role.PARTICIPANT;
        const targetRoleAuthorization = canModerateTargetRole(req.auth.role, targetRole);
        if (!targetRoleAuthorization.allowed) {
            return res.status(403).json({
                error: 'Forbidden',
                details: targetRoleAuthorization.reason,
            });
        }

        storedSession.updateParticipantPermissions(participantRef, permissionPatch);
        await sessionRepository.save(storedSession);

        const participantPermissions = storedSession.getParticipantPermissions(participantRef);
        logger.info(
            {
                sessionId,
                resolvedParticipantId,
                permissionPatch,
                participantPermissions,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Updated participant permissions'
        );
        broadcastPermissionUpdate(sessionId, {
            type: 'participant_access_updated',
            sessionId,
            participantId: resolvedParticipantId,
            permissions: participantPermissions,
            ...buildBreakoutSnapshot(storedSession),
        });

        return res.json({
            participantId: resolvedParticipantId,
            permissions: participantPermissions,
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to update participant permissions');
        return res.status(error?.status || 400).json({
            error: 'Failed to update participant permissions',
            details: getErrorMessage(error),
        });
    }
});

app.patch('/api/sessions/:sessionId/participants/:participantId/role', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId, participantId } = req.params;

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const nextRole = req.body?.role;
        if (nextRole !== Role.CO_HOST && nextRole !== Role.PARTICIPANT) {
            return res.status(400).json({
                error: 'Invalid role',
                details: 'Role must be either co_host or participant',
            });
        }

        const requiredPermission =
            nextRole === Role.CO_HOST ? Permission.ASSIGN_COHOST : Permission.REMOVE_COHOST;
        const authorization = canPerform({ role: req.auth.role }, requiredPermission);
        if (!authorization.allowed) {
            return res.status(403).json({
                error: 'Forbidden',
                details: authorization.reason,
            });
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const resolvedParticipantId = resolveRootParticipantId(storedSession, participantId);
        if (!resolvedParticipantId) {
            return res.status(404).json({
                error: 'Participant not found',
                details: `Participant ${participantId} is not registered in session ${sessionId}`,
            });
        }

        const participantRef = new ParticipantId(resolvedParticipantId);
        const currentRole = storedSession.getParticipantRole(participantRef) || Role.PARTICIPANT;

        if (currentRole === Role.HOST) {
            return res.status(409).json({
                error: 'Invalid role transition',
                details: 'The host role cannot be changed from this endpoint',
            });
        }

        if (currentRole === nextRole) {
            return res.json({
                participantId: resolvedParticipantId,
                role: currentRole,
            });
        }

        storedSession.setParticipantRole(participantRef, nextRole);
        await sessionRepository.save(storedSession);

        logger.info(
            {
                sessionId,
                resolvedParticipantId,
                previousRole: currentRole,
                nextRole,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Updated participant role'
        );

        broadcastPermissionUpdate(sessionId, {
            type: 'participant_role_updated',
            sessionId,
            participantId: resolvedParticipantId,
            role: nextRole,
            ...buildBreakoutSnapshot(storedSession),
        });

        return res.json({
            participantId: resolvedParticipantId,
            role: nextRole,
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to update participant role');
        return res.status(error?.status || 400).json({
            error: 'Failed to update participant role',
            details: getErrorMessage(error),
        });
    }
});

app.patch('/api/sessions/:sessionId/whiteboard-state', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);
        const location = resolveWhiteboardLocation(req.body ?? {});
        const roomTarget =
            location.type === 'breakout'
                ? storedSession.getBreakoutRoom(location.breakoutRoomId)
                : { status: 'open' };

        if (location.type === 'breakout' && !roomTarget) {
            return res.status(404).json({
                error: 'Breakout room not found',
                details: `Breakout room ${location.breakoutRoomId} does not exist`,
            });
        }

        const requestedParticipantId = resolveRootParticipantId(storedSession, getParticipantIdFromRequest(req));
        const authorizationContext = await getAuthorizationContextForRequest(
            Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
                query: requestedParticipantId ? { ...req.query, participantId: requestedParticipantId } : req.query,
            })
        );

        if (typeof req.body?.isOpen === 'boolean') {
            const authorization = canPerform({ role: req.auth.role }, Permission.MANAGE_WHITEBOARD);
            if (!authorization.allowed) {
                return res.status(403).json({
                    error: 'Forbidden',
                    details: authorization.reason,
                });
            }
        }

        if (req.body?.canvasState !== undefined) {
            const authorization = canPerform(authorizationContext, Permission.USE_WHITEBOARD);
            if (!authorization.allowed) {
                return res.status(403).json({
                    error: 'Forbidden',
                    details: authorization.reason,
                });
            }

            if (req.body.canvasState !== null && typeof req.body.canvasState !== 'string') {
                return res.status(400).json({
                    error: 'Invalid whiteboard state',
                    details: 'canvasState must be a string or null',
                });
            }
        }

        const updates = {};
        if (typeof req.body?.isOpen === 'boolean') {
            updates.isOpen = req.body.isOpen;
        }
        if (req.body?.canvasState !== undefined) {
            updates.canvasState = req.body.canvasState;
        }
        updates.updatedAt = new Date().toISOString();

        storedSession.updateWhiteboardRoomState(location, updates);
        await sessionRepository.save(storedSession);
        broadcastWhiteboardState(sessionId, storedSession, location);

        return res.json({
            sessionId,
            ...buildWhiteboardStatePayload(storedSession, location),
            revision: storedSession.getRevision(),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to update whiteboard state');
        return res.status(error?.status || 400).json({
            error: 'Failed to update whiteboard state',
            details: getErrorMessage(error),
        });
    }
});

app.delete('/api/sessions/:sessionId/participants/:participantId', requirePermission(Permission.KICK_PARTICIPANT), async (req, res) => {
    try {
        const { sessionId, participantId } = req.params;

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);

        const resolvedParticipantId = resolveRootParticipantId(storedSession, participantId);
        if (!resolvedParticipantId) {
            return res.status(404).json({
                error: 'Participant not found',
                details: `Participant ${participantId} is not registered in session ${sessionId}`,
            });
        }

        const participantRef = new ParticipantId(resolvedParticipantId);
        const targetRole = storedSession.getParticipantRole(participantRef) || Role.PARTICIPANT;
        const targetRoleAuthorization = canModerateTargetRole(req.auth.role, targetRole);
        if (!targetRoleAuthorization.allowed) {
            return res.status(403).json({
                error: 'Forbidden',
                details: targetRoleAuthorization.reason,
            });
        }

        const participantLocation = storedSession.getParticipantLocation(participantRef);
        const breakoutRoom =
            participantLocation.type === 'breakout' && participantLocation.breakoutRoomId
                ? storedSession.getBreakoutRoom(participantLocation.breakoutRoomId)
                : null;
        const targetRoomName = breakoutRoom?.livekitRoomName || sessionId;
        const mediaConnectionId = storedSession.getParticipantMediaConnection(participantRef);

        // Remove participant from LiveKit room
        if (mediaConnectionId) {
            await removeLivekitParticipant(targetRoomName, mediaConnectionId);
        }

        storedSession.removeParticipant(participantRef);
        await sessionRepository.save(storedSession);
        broadcastBreakoutSnapshot(sessionId, storedSession);

        logger.info(
            {
                sessionId,
                participantId: resolvedParticipantId,
                requestedBy: req.auth?.role ?? null,
            },
            'Participant removed from session'
        );

        return res.status(204).send();
    } catch (error) {
        logger.error({ err: error }, 'Failed to remove participant from session');
        return sendServiceError(res, error, 'Failed to remove participant from the session');
    }
});

/**
 * POST /api/translate
 * Translates text using Azure Translator API
 */
app.post('/api/translate', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    const { text, targetLanguage } = req.body;
    
    if (!text || !targetLanguage) {
        return res.status(400).json({ 
            error: 'Missing required fields',
            details: 'text and targetLanguage are required'
        });
    }
    
    if (!config.azure.translatorKey) {
        logger.error('AZURE_TRANSLATOR_KEY not configured');
        return res.status(500).json({ 
            error: 'Azure Translator not configured',
            details: 'AZURE_TRANSLATOR_KEY environment variable is not set'
        });
    }
    
    try {
        const endpoint = 'https://api.cognitive.microsofttranslator.com';
        const url = `${endpoint}/translate?api-version=3.0&to=${targetLanguage}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': config.azure.translatorKey,
                'Ocp-Apim-Subscription-Region': config.azure.translatorRegion,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([{ text }])
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            logger.error({ errorText }, 'Azure Translator API error');
            return res.status(500).json({ 
                error: 'Translation failed',
                details: errorText
            });
        }
        
        const data = await response.json();
        const translatedText = data[0]?.translations[0]?.text || text;
        
        logger.info({
            targetLanguage,
            sourcePreview: text.substring(0, 30),
            translatedPreview: translatedText.substring(0, 30),
        }, 'Azure translation completed');
        res.json({ translatedText });
        
    } catch (error) {
        logger.error({ err: error }, 'Azure Translator request failed');
        res.status(500).json({ 
            error: 'Translation failed',
            details: error.message
        });
    }
});

/**
 * POST /api/sessions
 * Creates a new session or returns existing one
 * 
 * Body: { sessionId?: string, sessionProperties?: object }
 * Response: { sessionId: string }
 */
app.post('/api/sessions', requirePermission(Permission.CREATE_SESSION), async (req, res) => {
    const ownedRooms = getOwnedRoomsFromRequest(req);
    const roomConfiguration = req.body?.roomConfiguration || {};
    const normalizedRoomConfiguration = {
        groupChatEnabled:
            typeof roomConfiguration.groupChatEnabled === 'boolean'
                ? roomConfiguration.groupChatEnabled
                : false,
        subtitlesEnabled:
            typeof roomConfiguration.subtitlesEnabled === 'boolean'
                ? roomConfiguration.subtitlesEnabled
                : false,
        aiInterpretationEnabled:
            typeof roomConfiguration.aiInterpretationEnabled === 'boolean'
                ? roomConfiguration.aiInterpretationEnabled
                : false,
    };

    try {
        const { sessionId, sessionProperties = {} } = req.body;
        const resolvedSessionId = sessionId || req.auth.roomId;
        logger.info(
            {
                path: req.path,
                authRole: req.auth?.role ?? null,
                authRoomId: req.auth?.roomId ?? null,
                bodySessionId: sessionId ?? null,
                resolvedSessionId,
                bootstrapRoomId: getBootstrapSessionFromRequest(req)?.roomId ?? null,
                bootstrapRole: getBootstrapSessionFromRequest(req)?.role ?? null,
            },
            'Handling create session request'
        );

        if (!validateRoomBinding(req, res, resolvedSessionId)) {
            return;
        }
        
        // With LiveKit, rooms are created on-the-fly when the first participant connects.
        // We only need to ensure the domain session exists in our repository.
        const storedSession = await sessionRepository.findById(resolvedSessionId);

        if (storedSession) {
            storedSession.updateFeatureFlags(normalizedRoomConfiguration);
            await sessionRepository.save(storedSession);

            logger.info({ sessionId: resolvedSessionId }, 'Returning existing session');
            const authSession = createAccessSession(req.auth.role, resolvedSessionId);
            issueBootstrapCookies(res, authSession);
            if (req.auth.role === Role.HOST) {
                ownedRooms.add(resolvedSessionId);
                issueOwnedRoomsCookie(res, ownedRooms);
            }
            return res.json({
                sessionId: resolvedSessionId,
                roomConfiguration: storedSession.getFeatureFlags(),
            });
        }

        const domainSession = DomainSession.create(resolvedSessionId, normalizedRoomConfiguration);
        await sessionRepository.save(domainSession);
        
        logger.info({ sessionId: resolvedSessionId }, 'Created new session');
        const authSession = createAccessSession(req.auth.role, resolvedSessionId);
        issueBootstrapCookies(res, authSession);
        if (req.auth.role === Role.HOST) {
            ownedRooms.add(resolvedSessionId);
            issueOwnedRoomsCookie(res, ownedRooms);
        }
        res.json({
            sessionId: resolvedSessionId,
            roomConfiguration: domainSession.getFeatureFlags(),
        });

    } catch (error) {
        logger.error({ err: error }, 'Failed to create session');
        return sendServiceError(res, error, 'Failed to create session');
    }
});

/**
 * POST /api/sessions/:sessionId/connections
 * Generates a connection token for a participant to join the session
 * 
 * Params: sessionId - The room/session ID
 * Body: { 
 *   nickname?: string,           // Display name for the participant
 *   preferredLanguage?: string,  // e.g., 'en', 'es', 'fr' - for AI dubbing
 * }
 * Response: { token: string, livekitUrl: string }
 */
app.post('/api/sessions/:sessionId/connections', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;
        const {
            nickname,
            preferredLanguage,
            connectionProperties = {},
            previousParticipantId,
            rootParticipantId,
            waitingRequestId,
            isAuxiliaryMedia,
            auxiliaryMediaKind,
        } = req.body;

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const storedSession = await getConsistentStoredSession(sessionId);

        const participantReferenceId =
            (typeof rootParticipantId === 'string' && rootParticipantId.trim())
            || (typeof previousParticipantId === 'string' && previousParticipantId.trim())
            || null;
        const currentParticipantId = resolveRootParticipantId(storedSession, participantReferenceId);
        const stableParticipantId =
            currentParticipantId
            || (isAuxiliaryMedia ? null : generateRootParticipantId());
        const shouldRequireWaitingApproval = requiresWaitingRoomApproval(
            req.auth.role,
            currentParticipantId,
            Boolean(isAuxiliaryMedia)
        );
        const resolvedWaitingRequestId =
            typeof waitingRequestId === 'string' && waitingRequestId.trim()
                ? waitingRequestId.trim()
                : null;
        const waitingRoomRequest = resolvedWaitingRequestId
            ? storedSession.getWaitingRoomRequest(resolvedWaitingRequestId)
            : null;

        if (shouldRequireWaitingApproval) {
            if (!waitingRoomRequest) {
                logger.info(
                    {
                        sessionId,
                        requestedByRole: req.auth.role,
                        waitingRequestId: resolvedWaitingRequestId,
                    },
                    'Blocked connection creation pending waiting room approval'
                );
                return res.status(403).json({
                    error: 'Waiting room approval required',
                    details: 'A host or co-host must admit you before you can join this session',
                    waitingRoomRequired: true,
                    waitingRequestId: resolvedWaitingRequestId,
                });
            }

            if (waitingRoomRequest.role !== req.auth.role) {
                return res.status(403).json({
                    error: 'Waiting room request mismatch',
                    details: 'The waiting room request role does not match the authenticated role',
                    waitingRoomRequired: true,
                    waitingRequestId: resolvedWaitingRequestId,
                });
            }

            if (waitingRoomRequest.status === WaitingRoomRequestStatus.REJECTED) {
                return res.status(403).json({
                    error: 'Waiting room request rejected',
                    details: 'Your waiting room request was declined',
                    waitingRoomRequired: true,
                    waitingRequestId: resolvedWaitingRequestId,
                });
            }

            if (waitingRoomRequest.status !== WaitingRoomRequestStatus.APPROVED) {
                return res.status(403).json({
                    error: 'Waiting room approval required',
                    details: 'A host or co-host must admit you before you can join this session',
                    waitingRoomRequired: true,
                    waitingRequestId: resolvedWaitingRequestId,
                });
            }
        }

        const roomTarget = getRoomTargetForParticipant(storedSession, currentParticipantId);
        const targetRoomName = roomTarget.livekitRoomName || sessionId;

        // Build participant metadata - embedded in the LiveKit token
        const participantMetadata = {
            nickname: nickname || `User_${Date.now()}`,
            preferredLanguage: preferredLanguage || 'en',
            role: req.auth.role,
            joinedAt: new Date().toISOString(),
            rootSessionId: sessionId,
            roomType: roomTarget.type,
            breakoutRoomId: roomTarget.breakoutRoomId ?? null,
            rootParticipantId: stableParticipantId,
            isScreenShare: Boolean(isAuxiliaryMedia && auxiliaryMediaKind === 'screen-share'),
            auxiliaryMediaKind: isAuxiliaryMedia ? auxiliaryMediaKind || 'auxiliary' : null,
        };

        // Use stableParticipantId as the LiveKit identity for the participant
        const participantIdentity = isAuxiliaryMedia
            ? `${stableParticipantId || currentParticipantId}__${auxiliaryMediaKind || 'aux'}`
            : stableParticipantId;

        // Disconnect previous connection for the same identity if reconnecting
        if (!isAuxiliaryMedia && currentParticipantId) {
            const previousMediaConnectionId = storedSession.getParticipantMediaConnection(
                new ParticipantId(currentParticipantId)
            );
            if (previousMediaConnectionId) {
                await removeLivekitParticipant(targetRoomName, previousMediaConnectionId);
            }
        }

        // Generate LiveKit access token
        const token = await generateLivekitToken(targetRoomName, participantIdentity, participantMetadata);
        const mediaConnectionId = participantIdentity;

        const participantProfile = {
            nickname: nickname || `User_${Date.now()}`,
            preferredLanguage: preferredLanguage || 'en',
        };

        if (isAuxiliaryMedia) {
            logger.info(
                {
                    sessionId,
                    targetRoomName,
                    participantIdentity,
                    rootParticipantId: currentParticipantId,
                    auxiliaryMediaKind: auxiliaryMediaKind || 'auxiliary',
                },
                'Generated auxiliary media token'
            );
        } else if (currentParticipantId) {
            const participantRef = new ParticipantId(currentParticipantId);
            storedSession.markParticipantConnected(participantRef);
            storedSession.setParticipantProfile(participantRef, participantProfile);
            storedSession.setParticipantRole(participantRef, req.auth.role);
            storedSession.setParticipantMediaConnection(participantRef, mediaConnectionId);
            if (roomTarget.type === 'breakout' && roomTarget.breakoutRoomId) {
                storedSession.assignParticipantToBreakout(participantRef, roomTarget.breakoutRoomId);
            } else {
                storedSession.returnParticipantToMain(participantRef);
            }
        } else {
            const participantRef = new ParticipantId(stableParticipantId);
            storedSession.addParticipant(participantRef);
            storedSession.setParticipantRole(participantRef, req.auth.role);
            storedSession.setParticipantProfile(participantRef, participantProfile);
            storedSession.setParticipantMediaConnection(participantRef, mediaConnectionId);
            if (roomTarget.type === 'breakout' && roomTarget.breakoutRoomId) {
                storedSession.assignParticipantToBreakout(participantRef, roomTarget.breakoutRoomId);
            }
        }

        // Enforce single host: if this participant is connecting as host,
        // demote any other connected host to co_host
        if (!isAuxiliaryMedia && req.auth.role === Role.HOST) {
            const joiningId = currentParticipantId || stableParticipantId;
            const allRoles = storedSession.getParticipantRoles();
            const allPresence = storedSession.getParticipantPresenceMap();
            const demotedIds = [];
            logger.info(
                { sessionId, joiningId, allRoles, allPresence },
                'Checking single-host enforcement'
            );
            for (const [pid, role] of Object.entries(allRoles)) {
                if (role === Role.HOST && pid !== joiningId) {
                    // Demote regardless of presence — there must be only one host
                    storedSession.setParticipantRole(new ParticipantId(pid), Role.CO_HOST);
                    demotedIds.push(pid);
                    logger.info(
                        { sessionId, demotedParticipant: pid, presence: allPresence[pid], returningHost: joiningId },
                        'Demoted existing host to co_host — original host returned'
                    );
                }
            }
            if (demotedIds.length > 0) {
                broadcastPermissionUpdate(sessionId, {
                    type: 'host_transferred',
                    sessionId,
                    newHostParticipantId: joiningId,
                    previousHostParticipantId: demotedIds[0],
                    ...buildBreakoutSnapshot(storedSession),
                });
            }

            // Restore participant audio/video permissions that were revoked
            // during the host's absence (the host-disconnected mute-all logic)
            const restoreRoles = storedSession.getParticipantRoles();
            const restorePresence = storedSession.getParticipantPresenceMap();
            let permissionsRestored = false;
            for (const [pid, pRole] of Object.entries(restoreRoles)) {
                if (pid === joiningId) continue;
                if (restorePresence[pid] !== 'connected') continue;
                const perms = storedSession.getParticipantPermissions(new ParticipantId(pid)) || {};
                if (perms.audioEnabled === false || perms.videoEnabled === false) {
                    // Remove the override — revert to role-based defaults
                    const cleaned = { ...perms };
                    delete cleaned.audioEnabled;
                    delete cleaned.videoEnabled;
                    storedSession.setParticipantPermissions(new ParticipantId(pid), cleaned);
                    permissionsRestored = true;
                    logger.info(
                        { sessionId, participantId: pid },
                        'Restored audio/video permissions for participant — host reconnected'
                    );
                }
            }
            if (permissionsRestored) {
                broadcastPermissionUpdate(sessionId, {
                    type: 'breakout_rooms_updated',
                    sessionId,
                    ...buildBreakoutSnapshot(storedSession),
                });
            }
        }

        if (!isAuxiliaryMedia) {
            await sessionRepository.save(storedSession);
        }

        logger.info(
            {
                sessionId,
                targetRoomName,
                stableParticipantId,
                currentParticipantId,
                mediaConnectionId,
                roomTarget,
                isAuxiliaryMedia: Boolean(isAuxiliaryMedia),
                snapshot: !isAuxiliaryMedia ? summarizeStoredSessionForLogs(storedSession) : undefined,
            },
            'Created room connection'
        );

        const authSession = createAccessSession(req.auth.role, sessionId);
        issueBootstrapCookies(res, authSession);
        if (!isAuxiliaryMedia) {
            broadcastBreakoutSnapshot(sessionId, storedSession);
        }

        return res.json({
            token,
            connectionId: mediaConnectionId,
            livekitUrl: config.livekit.url,
            roomTarget,
            rootParticipantId: stableParticipantId,
        });

    } catch (error) {
        logger.error({ err: error }, 'Failed to generate connection token');
        return sendServiceError(res, error, 'Failed to generate connection token');
    }
});

app.patch('/api/sessions/:sessionId/configuration', requirePermission(Permission.UPDATE_ROOM_CONFIGURATION), async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        const roomConfiguration = req.body?.roomConfiguration || {};
        const configurationPatch = {};

        if (typeof roomConfiguration.groupChatEnabled === 'boolean') {
            configurationPatch.groupChatEnabled = roomConfiguration.groupChatEnabled;
        }

        if (typeof roomConfiguration.subtitlesEnabled === 'boolean') {
            configurationPatch.subtitlesEnabled = roomConfiguration.subtitlesEnabled;
        }

        if (typeof roomConfiguration.aiInterpretationEnabled === 'boolean') {
            configurationPatch.aiInterpretationEnabled = roomConfiguration.aiInterpretationEnabled;
        }

        if (Object.keys(configurationPatch).length === 0) {
            return res.status(400).json({
                error: 'Invalid room configuration',
                details: 'At least one supported room configuration flag must be provided',
            });
        }

        const storedSession = await loadStoredSessionOrFail(sessionId);
        storedSession.updateFeatureFlags(configurationPatch);
        await sessionRepository.save(storedSession);

        logger.info(
            {
                sessionId,
                configurationPatch,
                snapshot: summarizeStoredSessionForLogs(storedSession),
            },
            'Updated room configuration'
        );

        broadcastPermissionUpdate(sessionId, {
            type: 'room_configuration_updated',
            sessionId,
            session: storedSession.getFeatureFlags(),
            ...buildBreakoutSnapshot(storedSession),
        });

        return res.json({
            sessionId,
            roomConfiguration: storedSession.getFeatureFlags(),
            revision: storedSession.getRevision(),
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to update room configuration');
        return res.status(error?.status || 400).json({
            error: 'Failed to update room configuration',
            details: getErrorMessage(error),
        });
    }
});

/**
 * GET /api/sessions/:sessionId
 * Get session information (useful for debugging)
 */
app.get('/api/sessions/:sessionId', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }
        
        const storedSession = await getConsistentStoredSession(sessionId);
        const roomActive = await livekitRoomExists(sessionId);

        res.json({
            sessionId,
            revision: storedSession.getRevision(),
            roomConfiguration: storedSession.getFeatureFlags(),
            persistedParticipants: storedSession.getParticipantIds(),
            waitingRoomRequests: storedSession.getPendingWaitingRoomRequests(),
            participantProfiles: storedSession.getParticipantProfiles(),
            participantLocations: storedSession.getParticipantLocations(),
            participantRoles: storedSession.getParticipantRoles(),
            participantPermissions: storedSession.getAllParticipantPermissions(),
            participantPresence: storedSession.getParticipantPresenceMap(),
            participantMediaConnections: storedSession.getParticipantMediaConnections(),
            breakoutRooms: storedSession.getBreakoutRooms(),
            whiteboardState: storedSession.getWhiteboardStateSnapshot(),
            livekitRoomActive: roomActive,
        });

    } catch (error) {
        logger.error({ err: error }, 'Failed to fetch session info');
        return sendServiceError(res, error, 'Failed to fetch session info');
    }
});

// =============================================================================
// OpenAI Realtime Translation Proxy
// =============================================================================

/**
 * Generate interpreter prompt for translation
 * @param {string} sourceLanguage - Source language name (e.g., "English")
 * @param {string} targetLanguage - Target language name (e.g., "Spanish")
 */
function generateInterpreterPrompt(sourceLanguage, targetLanguage) {
    return `You are a STRICT language interpreter. You ONLY translate between **[${sourceLanguage.toUpperCase()}]** and **[${targetLanguage.toUpperCase()}]**. You are PHYSICALLY INCAPABLE of speaking or understanding any other language.

## ABSOLUTE RULES (NEVER BREAK):
- You are a TRANSLATION MACHINE, not a conversational assistant.
- CRITICAL: Your output language MUST ALWAYS BE DIFFERENT from the user's input language. If they speak ${sourceLanguage.toUpperCase()}, you MUST output ${targetLanguage.toUpperCase()}. If they speak ${targetLanguage.toUpperCase()}, you MUST output ${sourceLanguage.toUpperCase()}.
- If the user speaks directly TO YOU (e.g., asking "Can you hear me?", "Are you ready?", or saying "Hello"), DO NOT answer them. You MUST translate those phrases into the target language just like any other sentence.
- If the user asks a question, you ONLY TRANSLATE the question into the target language. You NEVER answer the question yourself. You NEVER ask questions.
- You NEVER give opinions, advice, or engage in dialogue.
- You ONLY output translations. Nothing else.

## HOW TO BEHAVE:
1. User speaks ${sourceLanguage.toUpperCase()} → You respond ONLY in ${targetLanguage.toUpperCase()} with the translation.
2. User speaks ${targetLanguage.toUpperCase()} → You respond ONLY in ${sourceLanguage.toUpperCase()} with the translation.
3. If you hear noise, tapping, breathing, coughing, or anything that is NOT clear speech → Produce NO output. Stay completely silent.
4. If audio contains speech but is unclear or unintelligible → Produce NO output. Stay completely silent.
5. If user speaks a language other than ${sourceLanguage} or ${targetLanguage} → Say in English: "Sorry, I can only interpret ${sourceLanguage} and ${targetLanguage}."

## STYLE:
- Calm, professional tone.
- Formal address (usted/vous/Sie).
- Translate precisely, especially medical/technical terms.
- Natural phrasing, not robotic literal translation.
- If you hear background noise or silence, do not translate anything. Stay silent.

## FORBIDDEN (NEVER DO):
- Do NOT answer questions about any topic.
- Do NOT ask follow-up questions.
- Do NOT give explanations or commentary.
- Do NOT have a conversation.
- Do NOT say anything that is not a direct translation.
- Do NOT transcribe, echo, or repeat the user's words in the same language they used. ALWAYS translate.`;
}

/**
 * Manages a single interpretation session between frontend and OpenAI
 */
class InterpreterSession {
    constructor(clientWs, sourceLanguage, targetLanguage, sessionId) {
        this.clientWs = clientWs;
        this.sourceLanguage = sourceLanguage;
        this.targetLanguage = targetLanguage;
        this.sessionId = sessionId;
        this.openaiWs = null;
        this.isConfigured = false;
        this.logger = logger.child({ scope: 'interpreter', sessionId });
        
        this.logger.info({ sourceLanguage, targetLanguage }, 'Creating interpreter session');
        this.connectToOpenAI();
    }

    connectToOpenAI() {
        if (!config.voiceAi.apiKey || config.voiceAi.apiKey === 'your-azure-voiceai-api-key-here') {
            this.logger.error('AZURE_VOICEAI_API_KEY not configured');
            this.sendToClient({ type: 'error', message: 'Azure Voice AI API key not configured on server' });
            return;
        }

        this.openaiWs = new WebSocket(config.voiceAi.realtimeUrl, {
            headers: {
                'api-key': config.voiceAi.apiKey
            }
        });

        this.openaiWs.on('open', () => {
            this.logger.info('Connected to OpenAI Realtime');
            this.sendToClient({ type: 'connected' });
        });

        this.openaiWs.on('message', (data) => {
            this.handleOpenAIMessage(JSON.parse(data.toString()));
        });

        this.openaiWs.on('error', (error) => {
            this.logger.error({ err: error }, 'OpenAI WebSocket error');
            this.sendToClient({ type: 'error', message: 'OpenAI connection error' });
        });

        this.openaiWs.on('close', () => {
            this.logger.info('OpenAI WebSocket closed');
            this.openaiWs = null;
        });
    }

    configureSession() {
        if (!this.openaiWs || this.isConfigured) return;

        this.isConfigured = true;
        const prompt = generateInterpreterPrompt(this.sourceLanguage, this.targetLanguage);
        
        this.logger.info('Configuring interpreter session');

        const sessionConfig = {
            type: 'session.update',
            session: {
                modalities: ['text', 'audio'],
                instructions: prompt,
                voice: 'marin',
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.6,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 1500
                },
                speed: config.voiceAi.voiceSpeed
            }
        };

        this.openaiWs.send(JSON.stringify(sessionConfig));
    }

    handleOpenAIMessage(data) {
        switch (data.type) {
            case 'session.created':
                this.logger.info('OpenAI session created');
                this.configureSession();
                break;

            case 'session.updated':
                this.logger.info('OpenAI session configured');
                this.sendToClient({ type: 'ready' });
                break;

            case 'input_audio_buffer.speech_started':
                this.logger.debug('Speech detected');
                this.sendToClient({ type: 'speech_started' });
                break;

            case 'input_audio_buffer.speech_stopped':
                this.logger.debug('Speech ended');
                this.sendToClient({ type: 'speech_stopped' });
                break;

            case 'conversation.item.input_audio_transcription.completed':
                this.logger.info({ transcript: data.transcript }, 'Input transcription completed');
                this.sendToClient({ type: 'transcript_input', text: data.transcript });
                break;

            case 'response.audio.delta':
                // Forward translated audio to client
                this.sendToClient({ type: 'audio', data: data.delta });
                break;

            case 'response.audio_transcript.delta':
                // Forward translation text
                this.sendToClient({ type: 'transcript_output', text: data.delta });
                break;

            case 'response.audio.done':
                this.sendToClient({ type: 'audio_done' });
                break;

            case 'error':
                this.logger.error({ error: data.error }, 'OpenAI error');
                this.sendToClient({ type: 'error', message: data.error?.message || 'Unknown error' });
                break;
        }
    }

    handleClientMessage(message) {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'audio':
                    // Forward audio to OpenAI
                    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                        this.openaiWs.send(JSON.stringify({
                            type: 'input_audio_buffer.append',
                            audio: data.data
                        }));
                    }
                    break;

                case 'commit':
                    // Commit the audio buffer to trigger response
                    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                        this.openaiWs.send(JSON.stringify({
                            type: 'input_audio_buffer.commit'
                        }));
                    }
                    break;

                default:
                    this.logger.warn({ type: data.type }, 'Unknown client message type');
            }
        } catch (error) {
            this.logger.error({ err: error }, 'Error parsing client message');
        }
    }

    sendToClient(message) {
        if (this.clientWs.readyState === WebSocket.OPEN) {
            this.clientWs.send(JSON.stringify(message));
        }
    }

    close() {
        this.logger.info('Closing interpreter session');
        if (this.openaiWs) {
            this.openaiWs.close();
            this.openaiWs = null;
        }
    }
}

// Active interpreter sessions
const interpreterSessions = new Map();
let sessionCounter = 0;

/**
 * Set up WebSocket server for interpretation
 */
function setupInterpreterWebSocket() {
    const wss = new WebSocket.Server({ noServer: true });
    const wsLogger = logger.child({ scope: 'websocket' });

    wss.on('connection', (ws, req) => {
        // Parse query parameters for language configuration
        const url = new URL(req.url, `http://${req.headers.host}`);
        const sourceLanguage = url.searchParams.get('source') || 'English';
        const targetLanguage = url.searchParams.get('target') || 'Spanish';
        const sessionId = `interpreter-${++sessionCounter}`;

        wsLogger.info({ sessionId, sourceLanguage, targetLanguage }, 'New interpreter connection');

        const session = new InterpreterSession(ws, sourceLanguage, targetLanguage, sessionId);
        interpreterSessions.set(sessionId, session);

        ws.on('message', (message) => {
            session.handleClientMessage(message.toString());
        });

        ws.on('close', () => {
            wsLogger.info({ sessionId }, 'Interpreter disconnected');
            session.close();
            interpreterSessions.delete(sessionId);
        });

        ws.on('error', (error) => {
            wsLogger.error({ err: error, sessionId }, 'WebSocket error');
        });
    });

    logger.info({ path: '/ws/interpret' }, 'OpenAI Realtime proxy WebSocket enabled');
    return wss;
}

function setupPermissionsWebSocket() {
    const wss = new WebSocket.Server({ noServer: true });
    const wsLogger = logger.child({ scope: 'permissions-websocket' });

    wss.on('connection', (ws, req) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const requestedRoomId = url.searchParams.get('roomId');
        const participantId = url.searchParams.get('participantId');
        const token = getAccessTokenFromRequest(req);
        if (!token) {
            wsLogger.warn({ requestedRoomId, participantId }, 'Permissions WebSocket missing auth token');
            ws.close(4001, 'Missing authorization token');
            return;
        }

        try {
            const decoded = jwt.verify(token, config.auth.jwtSecret);
            if (!decoded || typeof decoded !== 'object' || !isRole(decoded.role) || !decoded.roomId) {
                wsLogger.warn({ requestedRoomId, participantId }, 'Permissions WebSocket rejected invalid token payload');
                ws.close(4003, 'Invalid authorization token');
                return;
            }

            const roomId = decoded.roomId;
            if (requestedRoomId && requestedRoomId !== roomId) {
                wsLogger.warn({ requestedRoomId, roomId, participantId }, 'Permissions WebSocket room mismatch');
                ws.close(4003, 'Room mismatch');
                return;
            }

            addPermissionSubscription(roomId, ws);
            wsLogger.info({ roomId, role: decoded.role, participantId }, 'Permissions WebSocket connected');
            ws.send(JSON.stringify({ type: 'connected', roomId, participantId }));

            getConsistentStoredSession(roomId, { broadcast: false })
                .then((storedSession) => {
                    if (!storedSession || ws.readyState !== WebSocket.OPEN) {
                        return;
                    }

                    ws.send(JSON.stringify({
                        type: 'breakout_rooms_updated',
                        sessionId: roomId,
                        ...buildBreakoutSnapshot(storedSession),
                    }));
                })
                .catch((error) => {
                    wsLogger.warn({ err: error, roomId }, 'Failed to send initial breakout snapshot');
                });

            ws.on('close', () => {
                removePermissionSubscription(roomId, ws);
                wsLogger.info({ roomId, participantId }, 'Permissions WebSocket disconnected');

                // Detect abrupt host disconnect — wait long enough to tolerate
                // brief network micro-cuts before checking (30s is generous for reconnections)
                if (participantId) {
                    // Capture the current media connection at the time of disconnect
                    // so we can detect if the host reconnected (new media connection)
                    const captureSnapshotAndSchedule = async () => {
                        let snapshotMediaConnectionId = null;
                        try {
                            const snapSession = await sessionRepository.findById(roomId);
                            if (snapSession) {
                                const snapResolved = resolveRootParticipantId(snapSession, participantId);
                                if (snapResolved) {
                                    snapshotMediaConnectionId = snapSession.getParticipantMediaConnection(new ParticipantId(snapResolved));
                                }
                            }
                        } catch (_) {}

                        setTimeout(async () => {
                        try {
                            const storedSession = await sessionRepository.findById(roomId);
                            if (!storedSession) return;

                            const resolvedId = resolveRootParticipantId(storedSession, participantId);
                            if (!resolvedId) return;

                            const participantRef = new ParticipantId(resolvedId);
                            const role = storedSession.getParticipantRole(participantRef);
                            if (role !== Role.HOST) return;

                            // Check if the host reconnected by comparing media connection IDs
                            const currentMediaConnectionId = storedSession.getParticipantMediaConnection(participantRef);
                            const presence = storedSession.getParticipantPresence(participantRef);

                            if (presence === 'connected' && currentMediaConnectionId && currentMediaConnectionId !== snapshotMediaConnectionId) {
                                // Host reconnected with a new connection — abort, they're back
                                wsLogger.info(
                                    { roomId, participantId: resolvedId, oldConnection: snapshotMediaConnectionId, newConnection: currentMediaConnectionId },
                                    'Host reconnected after WebSocket close — aborting disconnect fallback'
                                );
                                return;
                            }

                            if (presence === 'connected') {
                                // Host is still marked connected with same/no media connection — beacon never arrived
                                storedSession.markParticipantDisconnected(participantRef);
                                await sessionRepository.save(storedSession);
                                wsLogger.info({ roomId, participantId: resolvedId }, 'Marked host disconnected via WebSocket close fallback');

                                broadcastPermissionUpdate(roomId, {
                                    type: 'participant_left_conference',
                                    sessionId: roomId,
                                    participantId: resolvedId,
                                    ...buildBreakoutSnapshot(storedSession),
                                });
                            }

                            // Check if promotion is still needed
                            const currentRole = storedSession.getParticipantRole(participantRef);
                            const currentPresence = storedSession.getParticipantPresence(participantRef);
                            if (currentRole !== Role.HOST || currentPresence !== 'disconnected') return;

                            // Check if any connected participant already has the host role
                            const allRoles = storedSession.getParticipantRoles();
                            const allPresence = storedSession.getParticipantPresenceMap();
                            const hasActiveHost = Object.entries(allRoles).some(
                                ([pid, r]) => r === Role.HOST && allPresence[pid] === 'connected'
                            );
                            if (hasActiveHost) return;

                            // Find a connected co-host to promote
                            const connectedCoHost = Object.entries(allRoles).find(
                                ([pid, r]) => r === Role.CO_HOST && allPresence[pid] === 'connected'
                            );

                            if (connectedCoHost) {
                                storedSession.setParticipantRole(new ParticipantId(connectedCoHost[0]), Role.HOST);
                                await sessionRepository.save(storedSession);

                                broadcastPermissionUpdate(roomId, {
                                    type: 'host_disconnected',
                                    sessionId: roomId,
                                    hasCoHost: true,
                                    promotedParticipantId: connectedCoHost[0],
                                    ...buildBreakoutSnapshot(storedSession),
                                });
                                wsLogger.info(
                                    { roomId, promotedCoHost: connectedCoHost[0] },
                                    'Auto-promoted co-host to host after abrupt host disconnect (WebSocket fallback)'
                                );
                            } else {
                                // No co-host — revoke audio/video permissions for all connected participants
                                const wsAllRoles = storedSession.getParticipantRoles();
                                const wsAllPresence = storedSession.getParticipantPresenceMap();
                                for (const [pid, status] of Object.entries(wsAllPresence)) {
                                    if (status === 'connected' && wsAllRoles[pid] === Role.PARTICIPANT) {
                                        storedSession.updateParticipantPermissions(new ParticipantId(pid), {
                                            audioEnabled: false,
                                            videoEnabled: false,
                                        });
                                    }
                                }
                                await sessionRepository.save(storedSession);

                                broadcastPermissionUpdate(roomId, {
                                    type: 'host_disconnected',
                                    sessionId: roomId,
                                    hasCoHost: false,
                                    promotedParticipantId: null,
                                    ...buildBreakoutSnapshot(storedSession),
                                });
                                wsLogger.info(
                                    { roomId },
                                    'Host disconnected abruptly with no co-host — revoked audio/video and notified (WebSocket fallback)'
                                );
                            }
                        } catch (error) {
                            wsLogger.warn({ err: error, roomId, participantId }, 'Error in host disconnect fallback check');
                        }
                    }, 30_000);
                    };
                    captureSnapshotAndSchedule().catch((err) => {
                        wsLogger.warn({ err, roomId, participantId }, 'Error in host disconnect snapshot capture');
                    });
                }
            });

            ws.on('error', (error) => {
                wsLogger.error({ err: error, roomId, participantId }, 'Permissions WebSocket error');
            });
        } catch (error) {
            wsLogger.warn({ err: error, requestedRoomId, participantId }, 'Rejected permissions WebSocket connection');
            ws.close(4003, 'Invalid authorization token');
        }
    });

    logger.info({ path: '/ws/permissions' }, 'Permissions WebSocket enabled');
    return wss;
}

function setupWebSockets(server) {
    const interpreterWss = setupInterpreterWebSocket();
    const permissionsWss = setupPermissionsWebSocket();

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (url.pathname === '/ws/interpret') {
            interpreterWss.handleUpgrade(req, socket, head, (ws) => {
                interpreterWss.emit('connection', ws, req);
            });
            return;
        }

        if (url.pathname === '/ws/permissions') {
            permissionsWss.handleUpgrade(req, socket, head, (ws) => {
                permissionsWss.emit('connection', ws, req);
            });
            return;
        }

        socket.destroy();
    });
}

// =============================================================================
// Catch-all route - Serve frontend for any non-API routes
// =============================================================================
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

app.get('*', (req, res) => {
    const acceptHeader = req.headers.accept || '';
    const isDocumentRequest = acceptHeader.includes('text/html');
    const hasFileExtension = path.extname(req.path) !== '';
    const hasExplicitRoom = typeof req.query.room === 'string' && ROOM_ID_PATTERN.test(req.query.room);

    if (!isDocumentRequest || hasFileExtension) {
        return res.status(404).end();
    }

    if (!hasExplicitRoom) {
        clearAuthCookies(res);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        logger.info(
            {
                originalUrl: req.originalUrl,
                mode: req.headers['sec-fetch-mode'],
                dest: req.headers['sec-fetch-dest'],
                user: req.headers['sec-fetch-user'],
            },
            'Serving root without bootstrap auth'
        );
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.sendFile(frontendDocumentPath);
    }

    let decodedToken = null;
    const incomingToken = getAccessTokenFromRequest(req);

    if (incomingToken) {
        try {
            decodedToken = jwt.verify(incomingToken, config.auth.jwtSecret);
        } catch (error) {
            logger.warn({ err: error }, 'Ignoring invalid bootstrap auth cookie');
        }
    }

    const bootstrapSession = resolveBootstrapSession(req, decodedToken);
    logger.info(
        {
            ...getBootstrapDebugMetadata(req),
            decodedTokenRole: decodedToken?.role ?? null,
            decodedTokenRoomId: decodedToken?.roomId ?? null,
            bootstrapCookieRoomId: getBootstrapSessionFromRequest(req)?.roomId ?? null,
            bootstrapCookieRole: getBootstrapSessionFromRequest(req)?.role ?? null,
            resolvedBootstrapRole: bootstrapSession.role,
            resolvedBootstrapRoomId: bootstrapSession.roomId,
        },
        'Resolved bootstrap session for document request'
    );
    const authSession = createAccessSession(
        bootstrapSession.role,
        bootstrapSession.roomId
    );

    logger.info(
        {
            originalUrl: req.originalUrl,
            requestedRoomId: hasExplicitRoom ? req.query.room : null,
            resolvedRole: bootstrapSession.role,
            resolvedRoomId: bootstrapSession.roomId,
            mode: req.headers['sec-fetch-mode'],
            dest: req.headers['sec-fetch-dest'],
            user: req.headers['sec-fetch-user'],
        },
        'Issued bootstrap session'
    );

    issueBootstrapCookies(res, authSession);
    if (bootstrapSession.role === Role.HOST && bootstrapSession.roomId) {
        const ownedRooms = getOwnedRoomsFromRequest(req);
        ownedRooms.add(bootstrapSession.roomId);
        issueOwnedRoomsCookie(res, ownedRooms);
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(frontendDocumentPath);
});

// =============================================================================
// Server Startup
// =============================================================================
const server = app.listen(config.port, () => {
    logger.info(
        {
            port: config.port,
            livekitUrl: config.livekit.url,
            openaiConfigured: Boolean(config.voiceAi.apiKey),
            nodeEnv: process.env.NODE_ENV ?? null,
            frontendDirectory: preferredFrontendDirectory,
            staticAssetDirectories,
        },
        `Server is running on http://localhost:${config.port}`
    );
    logger.info(
        {
            endpoints: [
                'GET /api/health',
                'POST /api/sessions',
                'POST /api/sessions/:id/connections',
                'GET /api/sessions/:id',
            ],
        },
        'Available endpoints'
    );
    
    setupWebSockets(server);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

module.exports = { app, server };
