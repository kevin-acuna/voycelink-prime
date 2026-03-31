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
import { canPerform } from './authz';
import { Permission } from './authz/permissions';
import { Role, isRole } from './authz/roles';
import { config, validateServerConfig } from './config';
import { logger } from './logger';

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

// =============================================================================
// Middleware
// =============================================================================
app.use(cors({
    origin: '*', // In production, restrict this to your frontend domain
    methods: ['GET', 'POST'],
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
const AUTH_COOKIE_NAME = 'voycelink_auth';
const BOOTSTRAP_COOKIE_NAME = 'voycelink_bootstrap';
const ROOM_ID_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

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

function resolveBootstrapSession(req, decodedToken) {
    const requestedRoomId =
        typeof req.query.room === 'string' && ROOM_ID_PATTERN.test(req.query.room)
            ? req.query.room
            : null;
    const tokenRoomId =
        typeof decodedToken?.roomId === 'string' && ROOM_ID_PATTERN.test(decodedToken.roomId)
            ? decodedToken.roomId
            : null;

    if (requestedRoomId) {
        return {
            role: Role.GUEST,
            roomId: requestedRoomId,
        };
    }

    if (decodedToken?.role === Role.HOST && tokenRoomId) {
        return {
            role: Role.HOST,
            roomId: tokenRoomId,
        };
    }

    return {
        role: Role.HOST,
        roomId: generateRoomId(),
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
    const token = getAccessTokenFromRequest(req);

    if (!token) {
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

        req.auth = decoded;
        next();
    } catch (error) {
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
        openviduUrl: config.openvidu.url 
    });
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
    try {
        const { sessionId, sessionProperties = {} } = req.body;
        const resolvedSessionId = sessionId || req.auth.roomId;

        if (!validateRoomBinding(req, res, resolvedSessionId)) {
            return;
        }
        
        sessionProperties.customSessionId = resolvedSessionId;

        // Check if session already exists in our cache
        const existingSession = activeSessions.get(sessionProperties.customSessionId);
        if (existingSession) {
            logger.info({ sessionId: existingSession.sessionId }, 'Returning existing session');
            const authSession = createAccessSession(req.auth.role, existingSession.sessionId);
            issueBootstrapCookies(res, authSession);
            return res.json({
                sessionId: existingSession.sessionId,
            });
        }

        // Create new session on Azure OpenVidu Server
        const session = await openvidu.createSession(sessionProperties);
        
        // Cache the session for future token generation
        activeSessions.set(session.sessionId, session);
        
        logger.info({ sessionId: session.sessionId }, 'Created new session');
        const authSession = createAccessSession(req.auth.role, session.sessionId);
        issueBootstrapCookies(res, authSession);
        res.json({
            sessionId: session.sessionId,
        });

    } catch (error) {
        // Handle case where session already exists on server but not in our cache
        if (error.message && error.message.includes('409')) {
            const sessionId =
                req.body.sessionId ||
                req.body.sessionProperties?.customSessionId ||
                req.auth.roomId;
            logger.info({ sessionId }, 'Session already exists on server');
            const authSession = createAccessSession(req.auth.role, sessionId);
            issueBootstrapCookies(res, authSession);
            return res.json({
                sessionId,
            });
        }
        
        logger.error({ err: error }, 'Failed to create session');
        res.status(500).json({ 
            error: 'Failed to create session', 
            details: error.message 
        });
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
            joinedAt: new Date().toISOString()
        });

        // Merge with any additional connection properties
        const finalConnectionProperties = {
            data: connectionData,
            ...connectionProperties
        };

        // Get or create the session
        let session = activeSessions.get(sessionId);
        
        if (!session) {
            await openvidu.fetch();
            session = openvidu.activeSessions.find((candidate) => candidate.sessionId === sessionId);

            if (!session) {
                return res.status(404).json({
                    error: 'Session not found',
                    details: `Session ${sessionId} does not exist`,
                });
            }

            activeSessions.set(sessionId, session);
        }

        // Try to generate connection token
        try {
            const connection = await session.createConnection(finalConnectionProperties);
            
            logger.info({ sessionId, nickname, connectionId: connection.connectionId }, 'Generated connection token');
            const authSession = createAccessSession(req.auth.role, sessionId);
            issueBootstrapCookies(res, authSession);
            
            return res.json({ 
                token: connection.token,
                connectionId: connection.connectionId,
            });
        } catch (connectionError) {
            // If session was closed/destroyed, remove from cache and return not found
            if (connectionError.message && connectionError.message.includes('404')) {
                logger.warn({ sessionId }, 'Session was closed before connection creation');
                activeSessions.delete(sessionId);

                return res.status(404).json({
                    error: 'Session not found',
                    details: `Session ${sessionId} is no longer active`,
                });
            }
            throw connectionError;
        }

    } catch (error) {
        logger.error({ err: error }, 'Failed to generate connection token');
        
        res.status(500).json({ 
            error: 'Failed to generate connection token', 
            details: error.message 
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
        
        // Fetch fresh session data from OpenVidu server
        await openvidu.fetch();
        
        const sessions = openvidu.activeSessions;
        const session = sessions.find(s => s.sessionId === sessionId);
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
            sessionId: session.sessionId,
            createdAt: session.createdAt,
            connections: session.activeConnections.map(conn => ({
                connectionId: conn.connectionId,
                data: conn.data,
                createdAt: conn.createdAt
            }))
        });

    } catch (error) {
        logger.error({ err: error }, 'Failed to fetch session info');
        res.status(500).json({ error: 'Failed to fetch session info' });
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
function setupInterpreterWebSocket(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/interpret' });
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

    if (!isDocumentRequest || hasFileExtension) {
        return res.status(404).end();
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
    const authSession = createAccessSession(
        bootstrapSession.role,
        bootstrapSession.roomId
    );

    issueBootstrapCookies(res, authSession);
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
    
    // Setup WebSocket for interpretation
    setupInterpreterWebSocket(server);
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
