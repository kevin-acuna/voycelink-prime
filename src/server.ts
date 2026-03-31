// @ts-nocheck
/**
 * AI Live Dubbing Platform - Backend BFF
 * 
 * This server acts as a secure proxy between the frontend and Azure OpenVidu Server.
 * It handles session creation, token generation, and OpenAI Realtime translation proxy.
 */

import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import { OpenVidu } from 'openvidu-node-client';
import WebSocket from 'ws';
import { canPerform, getEffectivePermissions } from './authz';
import { Permission } from './authz/permissions';
import { Role, isRole } from './authz/roles';
import { config, validateServerConfig } from './config';
import { verifyCosmosConnection } from './infrastructure/cosmos-client';
import { CosmosSessionRepository } from './infrastructure/repositories/CosmosSessionRepository';
import { logger } from './logger';
import { ParticipantId, Session as DomainSession } from './session/Session';

const app = express();
const projectRoot = process.cwd();
const isProduction = process.env.NODE_ENV === 'production';
const staticAssetDirectories = isProduction
    ? [path.join(__dirname, 'public')]
    : [path.join(projectRoot, 'public'), path.join(projectRoot, 'dist', 'public')];
const frontendDocumentPath = isProduction
    ? path.join(__dirname, 'public', 'index.html')
    : path.join(projectRoot, 'public', 'index.html');

// Validate required environment variables
validateServerConfig();

// =============================================================================
// OpenVidu Client Initialization
// =============================================================================
const openvidu = new OpenVidu(config.openvidu.url, config.openvidu.secret);
const sessionRepository = new CosmosSessionRepository();

// =============================================================================
// Middleware
// =============================================================================
app.use(cors({
    origin: '*', // In production, restrict this to your frontend domain
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));
app.use(express.json());

// Serve static assets from the public folder (frontend)
staticAssetDirectories.forEach((directory) => {
    app.use(express.static(directory, { index: false }));
});

// Request logging middleware
app.use((req, res, next) => {
    logger.info({ method: req.method, path: req.path }, 'Incoming request');
    next();
});

// =============================================================================
// In-Memory Session Store
// Map<sessionId, Session> - Tracks active OpenVidu sessions
// =============================================================================
const activeSessions = new Map();
const AUTH_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const INVITE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const OWNER_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_COOKIE_NAME = 'voycelink_auth';
const AUTH_REFRESH_COOKIE_NAME = 'voycelink_auth_refresh';
const BOOTSTRAP_COOKIE_NAME = 'voycelink_bootstrap';
const PENDING_HOST_COOKIE_NAME = 'voycelink_pending_host';
const OWNER_COOKIE_NAME = 'voycelink_owner_rooms';
const ROOM_ID_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const OPENVIDU_RETRY_ATTEMPTS = 3;
const OPENVIDU_RETRY_DELAY_MS = 250;
const permissionSubscriptions = new Map();

function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const createSegment = (length) =>
        Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    return `${createSegment(3)}-${createSegment(4)}-${createSegment(3)}`;
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

function signPendingHostToken(payload) {
    return jwt.sign(payload, config.auth.jwtSecret, {
        expiresIn: AUTH_TOKEN_TTL_SECONDS,
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

function issuePendingHostCookie(res, roomId) {
    appendResponseCookie(
        res,
        PENDING_HOST_COOKIE_NAME,
        signPendingHostToken({
            role: Role.HOST,
            roomId,
        }),
        {
            httpOnly: true,
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

function getPendingHostSessionFromRequest(req) {
    const cookies = parseCookies(req);
    const pendingHostToken = cookies[PENDING_HOST_COOKIE_NAME];
    if (!pendingHostToken) {
        return null;
    }

    try {
        const decoded = jwt.verify(pendingHostToken, config.auth.jwtSecret);
        if (
            !decoded ||
            typeof decoded !== 'object' ||
            decoded.role !== Role.HOST ||
            typeof decoded.roomId !== 'string' ||
            !ROOM_ID_PATTERN.test(decoded.roomId)
        ) {
            return null;
        }

        return {
            role: Role.HOST,
            roomId: decoded.roomId,
        };
    } catch (error) {
        logger.warn({ err: error }, 'Ignoring invalid pending host cookie');
        return null;
    }
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

function tryRestorePendingHostAuthentication(req, res) {
    const pendingHostSession = getPendingHostSessionFromRequest(req);
    if (!pendingHostSession) {
        return false;
    }

    const requestedRoomId = getRequestedRoomIdForRequest(req);
    const bootstrapSession = getBootstrapSessionFromRequest(req);
    const effectiveRoomId = requestedRoomId || bootstrapSession?.roomId || null;

    if (effectiveRoomId && effectiveRoomId !== pendingHostSession.roomId) {
        return false;
    }

    const authSession = createAccessSession(Role.HOST, pendingHostSession.roomId);
    issueBootstrapCookies(res, authSession);
    req.auth = {
        role: Role.HOST,
        roomId: pendingHostSession.roomId,
    };
    logger.info(
        { path: req.path, roomId: pendingHostSession.roomId },
        'Restored host authentication from pending host cookie'
    );
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

function isPrimaryDocumentNavigation(req) {
    const mode = req.headers['sec-fetch-mode'];
    const dest = req.headers['sec-fetch-dest'];
    const user = req.headers['sec-fetch-user'];

    // Browsers on real top-level navigations usually send navigate/document.
    // We accept missing headers as a fallback for clients that don't set them.
    if (!mode && !dest && !user) {
        return true;
    }

    return mode === 'navigate' && dest === 'document';
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

        if (tryRestorePendingHostAuthentication(req, res)) {
            return next();
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

        if (tryRestorePendingHostAuthentication(req, res)) {
            return next();
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
    return (req, res, next) => {
        const role = req.auth?.role;
        const authorization = canPerform({ role }, permission);

        if (!authorization.allowed) {
            return res.status(403).json({
                error: 'Forbidden',
                details: authorization.reason,
            });
        }

        next();
    };
}

function getParticipantIdFromRequest(req) {
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
    const participantId = getParticipantIdFromRequest(req);
    let grants = {};
    let sessionFlags = {
        chatEnabled: true,
        whiteboardEnabled: true,
        subtitlesEnabled: true,
        aiInterpretationEnabled: false,
    };

    if (req.auth?.roomId) {
        const storedSession = await sessionRepository.findById(req.auth.roomId);
        if (storedSession) {
            sessionFlags = storedSession.getFeatureFlags();
            if (participantId) {
                grants = storedSession.getParticipantPermissions(new ParticipantId(participantId));
            }
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

function getOpenViduStatusCode(error) {
    const directStatus = error?.status || error?.statusCode || error?.response?.status;
    if (typeof directStatus === 'number') {
        return directStatus;
    }

    const message = getErrorMessage(error);
    const match = message.match(/\b(4\d{2}|5\d{2})\b/);
    return match ? Number(match[1]) : null;
}

function isRetryableOpenViduError(error) {
    const statusCode = getOpenViduStatusCode(error);
    if (statusCode === 408 || statusCode === 409 || statusCode === 429) {
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

async function withOpenViduRetry(operationName, handler) {
    let lastError = null;

    for (let attempt = 1; attempt <= OPENVIDU_RETRY_ATTEMPTS; attempt += 1) {
        try {
            return await handler();
        } catch (error) {
            lastError = error;
            const retryable = isRetryableOpenViduError(error);

            logger.warn(
                {
                    err: error,
                    operationName,
                    attempt,
                    retryable,
                },
                'OpenVidu operation failed'
            );

            if (!retryable || attempt === OPENVIDU_RETRY_ATTEMPTS) {
                throw error;
            }

            await delay(OPENVIDU_RETRY_DELAY_MS * attempt);
        }
    }

    throw lastError;
}

function sendOpenViduError(res, error, fallbackMessage) {
    const statusCode = getOpenViduStatusCode(error);
    const details = getErrorMessage(error);

    if (statusCode === 404) {
        return res.status(404).json({
            error: 'Session not found',
            details,
        });
    }

    if (statusCode === 409) {
        return res.status(409).json({
            error: fallbackMessage,
            details,
        });
    }

    if (statusCode === 429) {
        return res.status(429).json({
            error: 'OpenVidu rate limit reached',
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

async function fetchOpenViduSessionById(sessionId) {
    await withOpenViduRetry('openvidu.fetch', () => openvidu.fetch());
    return openvidu.activeSessions.find((candidate) => candidate.sessionId === sessionId) || null;
}

async function getCachedOrRemoteOpenViduSession(sessionId) {
    const cachedSession = activeSessions.get(sessionId);
    if (cachedSession) {
        return cachedSession;
    }

    const remoteSession = await fetchOpenViduSessionById(sessionId);
    if (!remoteSession) {
        return null;
    }

    activeSessions.set(sessionId, remoteSession);
    return remoteSession;
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
        openviduUrl: config.openvidu.url,
        cosmosDatabase: config.cosmos.databaseName,
        cosmosContainers: [
            config.cosmos.roomsContainerName,
            config.cosmos.participantPermissionsContainerName,
        ],
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
        const authorizationContext = await getAuthorizationContextForRequest(req);
        const permissions = getEffectivePermissions(authorizationContext);
        const authSession = createAccessSession(req.auth.role, req.auth.roomId ?? null);
        issueBootstrapCookies(res, authSession);

        res.json({
            role: req.auth.role,
            roomId: req.auth.roomId ?? null,
            permissions,
            session: authorizationContext.session,
            grants: authorizationContext.grants ?? {},
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

        const storedSession = await sessionRepository.findById(sessionId);
        if (!storedSession) {
            return res.status(404).json({
                error: 'Session not found',
                details: `Session ${sessionId} is not registered in the repository`,
            });
        }

        if (!storedSession.getParticipantIds().includes(participantId)) {
            return res.status(404).json({
                error: 'Participant not found',
                details: `Participant ${participantId} is not registered in session ${sessionId}`,
            });
        }

        const participantRef = new ParticipantId(participantId);
        storedSession.updateParticipantPermissions(participantRef, permissionPatch);
        await sessionRepository.save(storedSession);

        const participantPermissions = storedSession.getParticipantPermissions(participantRef);
        broadcastPermissionUpdate(sessionId, {
            type: 'participant_access_updated',
            sessionId,
            participantId,
            permissions: participantPermissions,
        });

        return res.json({
            participantId,
            permissions: participantPermissions,
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to update participant permissions');
        return res.status(400).json({
            error: 'Failed to update participant permissions',
            details: getErrorMessage(error),
        });
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
 * Creates a new OpenVidu session or returns existing one
 * 
 * Body: { sessionId?: string, sessionProperties?: object }
 * Response: { sessionId: string }
 */
app.post('/api/sessions', requirePermission(Permission.CREATE_SESSION), async (req, res) => {
    const ownedRooms = getOwnedRoomsFromRequest(req);
    const roomConfiguration = req.body?.roomConfiguration || {};
    const normalizedRoomConfiguration = {
        subtitlesEnabled:
            typeof roomConfiguration.subtitlesEnabled === 'boolean'
                ? roomConfiguration.subtitlesEnabled
                : true,
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
        
        sessionProperties.customSessionId = resolvedSessionId;

        const storedSession = await sessionRepository.findById(resolvedSessionId);
        const existingSession = await getCachedOrRemoteOpenViduSession(sessionProperties.customSessionId);

        if (existingSession) {
            let sessionModel = storedSession;
            if (!storedSession) {
                sessionModel = DomainSession.create(existingSession.sessionId, normalizedRoomConfiguration);
                await sessionRepository.save(sessionModel);
            } else {
                storedSession.updateFeatureFlags(normalizedRoomConfiguration);
                await sessionRepository.save(storedSession);
            }

            logger.info({ sessionId: existingSession.sessionId }, 'Returning existing session');
            const authSession = createAccessSession(req.auth.role, existingSession.sessionId);
            issueBootstrapCookies(res, authSession);
            if (req.auth.role === Role.HOST) {
                ownedRooms.add(existingSession.sessionId);
                issueOwnedRoomsCookie(res, ownedRooms);
            }
            return res.json({
                sessionId: existingSession.sessionId,
                roomConfiguration: sessionModel?.getFeatureFlags?.() || normalizedRoomConfiguration,
            });
        }

        const session = await withOpenViduRetry(
            'openvidu.createSession',
            () => openvidu.createSession(sessionProperties)
        );
        
        activeSessions.set(session.sessionId, session);
        const domainSession = DomainSession.create(session.sessionId, normalizedRoomConfiguration);
        await sessionRepository.save(domainSession);
        
        logger.info({ sessionId: session.sessionId }, 'Created new session');
        const authSession = createAccessSession(req.auth.role, session.sessionId);
        issueBootstrapCookies(res, authSession);
        if (req.auth.role === Role.HOST) {
            ownedRooms.add(session.sessionId);
            issueOwnedRoomsCookie(res, ownedRooms);
        }
        res.json({
            sessionId: session.sessionId,
            roomConfiguration: domainSession.getFeatureFlags(),
        });

    } catch (error) {
        if (error.message && error.message.includes('409')) {
            const sessionId =
                req.body.sessionId ||
                req.body.sessionProperties?.customSessionId ||
                req.auth.roomId;

            const domainSession = DomainSession.create(sessionId, normalizedRoomConfiguration);
            await sessionRepository.save(domainSession);
            logger.info({ sessionId }, 'Session already exists on server');
            const authSession = createAccessSession(req.auth.role, sessionId);
            issueBootstrapCookies(res, authSession);
            if (req.auth.role === Role.HOST) {
                ownedRooms.add(sessionId);
                issueOwnedRoomsCookie(res, ownedRooms);
            }
            return res.json({
                sessionId,
                roomConfiguration: domainSession.getFeatureFlags(),
            });
        }
        
        logger.error({ err: error }, 'Failed to create session');
        return sendOpenViduError(res, error, 'Failed to create session');
    }
});

/**
 * POST /api/sessions/:sessionId/connections
 * Generates a connection token for a participant to join the session
 * 
 * Params: sessionId - The OpenVidu session ID
 * Body: { 
 *   nickname?: string,           // Display name for the participant
 *   preferredLanguage?: string,  // e.g., 'en', 'es', 'fr' - for future AI dubbing
 *   connectionProperties?: object 
 * }
 * Response: { token: string }
 */
app.post('/api/sessions/:sessionId/connections', requirePermission(Permission.JOIN_SESSION), async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { nickname, preferredLanguage, connectionProperties = {} } = req.body;

        if (!validateRoomBinding(req, res, sessionId)) {
            return;
        }

        // Build connection data - this will be available to all participants
        // Crucial for AI dubbing: we store language preference in connection data
        const connectionData = JSON.stringify({
            nickname: nickname || `User_${Date.now()}`,
            preferredLanguage: preferredLanguage || 'en',
            role: req.auth.role,
            joinedAt: new Date().toISOString()
        });

        // Merge with any additional connection properties
        const finalConnectionProperties = {
            data: connectionData,
            ...connectionProperties
        };

        const storedSession = await sessionRepository.findById(sessionId);
        if (!storedSession) {
            return res.status(404).json({
                error: 'Session not found',
                details: `Session ${sessionId} is not registered in the repository`,
            });
        }

        try {
            const session = await getCachedOrRemoteOpenViduSession(sessionId);
            if (!session) {
                await sessionRepository.delete(sessionId);
                return res.status(404).json({
                    error: 'Session not found',
                    details: `Session ${sessionId} does not exist`,
                });
            }

            const connection = await withOpenViduRetry(
                'openvidu.createConnection',
                () => session.createConnection(finalConnectionProperties)
            );

            const participantId = new ParticipantId(connection.connectionId);
            storedSession.addParticipant(participantId);
            storedSession.setParticipantRole(participantId, req.auth.role);
            await sessionRepository.save(storedSession);
            
            logger.info({ sessionId, nickname, connectionId: connection.connectionId }, 'Generated connection token');
            const authSession = createAccessSession(req.auth.role, sessionId);
            issueBootstrapCookies(res, authSession);
            
            return res.json({ 
                token: connection.token,
                connectionId: connection.connectionId,
            });
        } catch (connectionError) {
            if (connectionError.message && connectionError.message.includes('404')) {
                logger.warn({ sessionId }, 'Session was closed before connection creation');
                activeSessions.delete(sessionId);
                await sessionRepository.delete(sessionId);

                return res.status(404).json({
                    error: 'Session not found',
                    details: `Session ${sessionId} is no longer active`,
                });
            }
            throw connectionError;
        }

    } catch (error) {
        logger.error({ err: error }, 'Failed to generate connection token');
        return sendOpenViduError(res, error, 'Failed to generate connection token');
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
        
        const storedSession = await sessionRepository.findById(sessionId);
        if (!storedSession) {
            return res.status(404).json({ error: 'Session not found', details: `Session ${sessionId} is not registered in the repository` });
        }

        const session = await fetchOpenViduSessionById(sessionId);
        
        if (!session) {
            activeSessions.delete(sessionId);
            await sessionRepository.delete(sessionId);
            return res.status(404).json({ error: 'Session not found', details: `Session ${sessionId} is no longer active in OpenVidu` });
        }

        activeSessions.set(sessionId, session);

        res.json({
            sessionId: session.sessionId,
            createdAt: session.createdAt,
            roomConfiguration: storedSession.getFeatureFlags(),
            persistedParticipants: storedSession.getParticipantIds(),
            participantRoles: storedSession.getParticipantRoles(),
            connections: session.activeConnections.map(conn => ({
                connectionId: conn.connectionId,
                data: conn.data,
                createdAt: conn.createdAt
            }))
        });

    } catch (error) {
        logger.error({ err: error }, 'Failed to fetch session info');
        return sendOpenViduError(res, error, 'Failed to fetch session info');
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
    return `You are a real-time voice interpreter. Your ONLY job is to translate speech from ${sourceLanguage} to ${targetLanguage}.

## CRITICAL RULES:
- You are a TRANSLATION MACHINE, not a conversational assistant.
- You ONLY output the translation. Nothing else.
- NEVER introduce yourself or greet.
- NEVER respond to questions - just translate them.
- NEVER add commentary or explanations.
- PRESERVE the speaker's tone: if they sound happy, sad, angry, excited - reflect that in your voice.
- Translate naturally, not word-by-word.

## BEHAVIOR:
1. User speaks ${sourceLanguage} → You respond ONLY in ${targetLanguage} with the translation.
2. If audio is unclear → Say "Could you repeat that?" in ${targetLanguage}.
3. If user speaks ${targetLanguage} or another language → Still translate to ${targetLanguage} or say "I can only translate from ${sourceLanguage} to ${targetLanguage}."

## STYLE:
- Match the speaker's emotional tone (happy, sad, urgent, calm, etc.)
- Natural, fluent phrasing
- Professional but warm`;
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
        if (!config.openai.apiKey || config.openai.apiKey === 'sk-your-openai-api-key-here') {
            this.logger.error('OPENAI_API_KEY not configured');
            this.sendToClient({ type: 'error', message: 'OpenAI API key not configured on server' });
            return;
        }

        this.openaiWs = new WebSocket(config.openai.realtimeUrl, {
            headers: {
                'Authorization': `Bearer ${config.openai.apiKey}`,
                'OpenAI-Beta': 'realtime=v1'
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
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                turn_detection: {
                    type: 'semantic_vad',
                    eagerness: 'auto'
                }
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

            ws.on('close', () => {
                removePermissionSubscription(roomId, ws);
                wsLogger.info({ roomId, participantId }, 'Permissions WebSocket disconnected');
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

    if (!hasExplicitRoom && !isPrimaryDocumentNavigation(req)) {
        logger.info(
            {
                path: req.path,
                originalUrl: req.originalUrl,
                mode: req.headers['sec-fetch-mode'],
                dest: req.headers['sec-fetch-dest'],
                user: req.headers['sec-fetch-user'],
            },
            'Serving frontend without mutating bootstrap cookies for non-primary navigation'
        );
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

    if (hasExplicitRoom) {
        issueBootstrapCookies(res, authSession);
        if (bootstrapSession.role === Role.HOST && bootstrapSession.roomId) {
            const ownedRooms = getOwnedRoomsFromRequest(req);
            ownedRooms.add(bootstrapSession.roomId);
            issueOwnedRoomsCookie(res, ownedRooms);
        }
    } else {
        clearResponseCookie(res, AUTH_COOKIE_NAME);
        clearResponseCookie(res, AUTH_REFRESH_COOKIE_NAME);
        issueBootstrapStateCookie(res, authSession);
        issuePendingHostCookie(res, bootstrapSession.roomId);
    }
    res.sendFile(frontendDocumentPath);
});

// =============================================================================
// Server Startup
// =============================================================================
const server = app.listen(config.port, () => {
    logger.info(
        {
            port: config.port,
            openviduUrl: config.openvidu.url,
            openaiConfigured: Boolean(config.openai.apiKey),
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
