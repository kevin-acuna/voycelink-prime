/**
 * AI Live Dubbing Platform - Backend BFF
 * 
 * This server acts as a secure proxy between the frontend and Azure OpenVidu Server.
 * It handles session creation, token generation, and OpenAI Realtime translation proxy.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { OpenVidu } = require('openvidu-node-client');
const WebSocket = require('ws');

const app = express();

// =============================================================================
// Configuration
// =============================================================================
const OPENVIDU_URL = process.env.OPENVIDU_URL;
const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || 'eastus';
const AZURE_TRANSLATOR_KEY = process.env.AZURE_TRANSLATOR_KEY || process.env.AZURE_SPEECH_KEY;
const AZURE_TRANSLATOR_REGION = process.env.AZURE_TRANSLATOR_REGION || 'eastus';
const PORT = process.env.PORT || 3000;
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

// Validate required environment variables
if (!OPENVIDU_URL || !OPENVIDU_SECRET) {
    console.error('ERROR: Missing required environment variables.');
    console.error('Please ensure OPENVIDU_URL and OPENVIDU_SECRET are set in your .env file.');
    process.exit(1);
}

// =============================================================================
// OpenVidu Client Initialization
// =============================================================================
const openvidu = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET);

// =============================================================================
// Middleware
// =============================================================================
app.use(cors({
    origin: '*', // In production, restrict this to your frontend domain
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Serve static files from the public folder (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// =============================================================================
// In-Memory Session Store
// Map<sessionId, Session> - Tracks active OpenVidu sessions
// =============================================================================
const activeSessions = new Map();

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
        openviduUrl: OPENVIDU_URL 
    });
});

/**
 * GET /api/azure-speech-token
 * Returns Azure Speech credentials for client-side transcription
 */
app.get('/api/azure-speech-token', (req, res) => {
    if (!AZURE_SPEECH_KEY) {
        console.error('[Azure Speech] AZURE_SPEECH_KEY not configured');
        return res.status(500).json({ 
            error: 'Azure Speech not configured',
            details: 'AZURE_SPEECH_KEY environment variable is not set'
        });
    }
    
    console.log(`[Azure Speech] Providing credentials (region: ${AZURE_SPEECH_REGION})`);
    res.json({
        token: AZURE_SPEECH_KEY,
        region: AZURE_SPEECH_REGION
    });
});

/**
 * POST /api/translate
 * Translates text using Azure Translator API
 */
app.post('/api/translate', async (req, res) => {
    const { text, targetLanguage } = req.body;
    
    if (!text || !targetLanguage) {
        return res.status(400).json({ 
            error: 'Missing required fields',
            details: 'text and targetLanguage are required'
        });
    }
    
    if (!AZURE_TRANSLATOR_KEY) {
        console.error('[Azure Translator] AZURE_TRANSLATOR_KEY not configured');
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
                'Ocp-Apim-Subscription-Key': AZURE_TRANSLATOR_KEY,
                'Ocp-Apim-Subscription-Region': AZURE_TRANSLATOR_REGION,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([{ text }])
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Azure Translator] API error:', errorText);
            return res.status(500).json({ 
                error: 'Translation failed',
                details: errorText
            });
        }
        
        const data = await response.json();
        const translatedText = data[0]?.translations[0]?.text || text;
        
        console.log(`[Azure Translator] ${text.substring(0, 30)}... → ${translatedText.substring(0, 30)}... (${targetLanguage})`);
        res.json({ translatedText });
        
    } catch (error) {
        console.error('[Azure Translator] Error:', error.message);
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
app.post('/api/sessions', async (req, res) => {
    try {
        const { sessionId, sessionProperties = {} } = req.body;
        
        // If sessionId provided, try to use it as customSessionId
        if (sessionId) {
            sessionProperties.customSessionId = sessionId;
        }

        // Check if session already exists in our cache
        const existingSession = activeSessions.get(sessionProperties.customSessionId);
        if (existingSession) {
            console.log(`[Session] Returning existing session: ${existingSession.sessionId}`);
            return res.json({ sessionId: existingSession.sessionId });
        }

        // Create new session on Azure OpenVidu Server
        const session = await openvidu.createSession(sessionProperties);
        
        // Cache the session for future token generation
        activeSessions.set(session.sessionId, session);
        
        console.log(`[Session] Created new session: ${session.sessionId}`);
        res.json({ sessionId: session.sessionId });

    } catch (error) {
        // Handle case where session already exists on server but not in our cache
        if (error.message && error.message.includes('409')) {
            const sessionId = req.body.sessionId || req.body.sessionProperties?.customSessionId;
            console.log(`[Session] Session already exists on server: ${sessionId}`);
            return res.json({ sessionId });
        }
        
        console.error('[Session] Error creating session:', error.message);
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
app.post('/api/sessions/:sessionId/connections', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { nickname, preferredLanguage, connectionProperties = {} } = req.body;

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
            // Session might exist on server but not in our cache - create/fetch it
            console.log(`[Connection] Session not in cache, creating: ${sessionId}`);
            session = await openvidu.createSession({ customSessionId: sessionId });
            activeSessions.set(sessionId, session);
        }

        // Try to generate connection token
        try {
            const connection = await session.createConnection(finalConnectionProperties);
            
            console.log(`[Connection] Token generated for session: ${sessionId}, nickname: ${nickname}`);
            
            return res.json({ 
                token: connection.token,
                connectionId: connection.connectionId
            });
        } catch (connectionError) {
            // If session was closed/destroyed, remove from cache and recreate
            if (connectionError.message && connectionError.message.includes('404')) {
                console.log(`[Connection] Session ${sessionId} was closed, recreating...`);
                activeSessions.delete(sessionId);
                
                // Create a fresh session with the same ID
                session = await openvidu.createSession({ customSessionId: sessionId });
                activeSessions.set(sessionId, session);
                
                // Now create the connection
                const connection = await session.createConnection(finalConnectionProperties);
                
                console.log(`[Connection] Token generated for recreated session: ${sessionId}, nickname: ${nickname}`);
                
                return res.json({ 
                    token: connection.token,
                    connectionId: connection.connectionId
                });
            }
            throw connectionError;
        }

    } catch (error) {
        console.error('[Connection] Error generating token:', error.message);
        
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
app.get('/api/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
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
        console.error('[Session Info] Error:', error.message);
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
        
        console.log(`[Interpreter ${sessionId}] Creating session: ${sourceLanguage} → ${targetLanguage}`);
        this.connectToOpenAI();
    }

    connectToOpenAI() {
        if (!OPENAI_API_KEY || OPENAI_API_KEY === 'sk-your-openai-api-key-here') {
            console.error(`[Interpreter ${this.sessionId}] ERROR: OPENAI_API_KEY not configured`);
            this.sendToClient({ type: 'error', message: 'OpenAI API key not configured on server' });
            return;
        }

        this.openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'OpenAI-Beta': 'realtime=v1'
            }
        });

        this.openaiWs.on('open', () => {
            console.log(`[Interpreter ${this.sessionId}] Connected to OpenAI Realtime`);
            this.sendToClient({ type: 'connected' });
        });

        this.openaiWs.on('message', (data) => {
            this.handleOpenAIMessage(JSON.parse(data.toString()));
        });

        this.openaiWs.on('error', (error) => {
            console.error(`[Interpreter ${this.sessionId}] OpenAI WebSocket error:`, error.message);
            this.sendToClient({ type: 'error', message: 'OpenAI connection error' });
        });

        this.openaiWs.on('close', () => {
            console.log(`[Interpreter ${this.sessionId}] OpenAI WebSocket closed`);
            this.openaiWs = null;
        });
    }

    configureSession() {
        if (!this.openaiWs || this.isConfigured) return;

        this.isConfigured = true;
        const prompt = generateInterpreterPrompt(this.sourceLanguage, this.targetLanguage);
        
        console.log(`[Interpreter ${this.sessionId}] Configuring session...`);

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
                // turn_detection: {
                //     type: 'server_vad',
                //     threshold: 0.5,
                //     prefix_padding_ms: 300,
                //     silence_duration_ms: 500
                // }
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
                console.log(`[Interpreter ${this.sessionId}] Session created`);
                this.configureSession();
                break;

            case 'session.updated':
                console.log(`[Interpreter ${this.sessionId}] Session configured`);
                this.sendToClient({ type: 'ready' });
                break;

            case 'input_audio_buffer.speech_started':
                console.log(`[Interpreter ${this.sessionId}] Speech detected`);
                this.sendToClient({ type: 'speech_started' });
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log(`[Interpreter ${this.sessionId}] Speech ended`);
                this.sendToClient({ type: 'speech_stopped' });
                break;

            case 'conversation.item.input_audio_transcription.completed':
                console.log(`[Interpreter ${this.sessionId}] User said: ${data.transcript}`);
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
                console.error(`[Interpreter ${this.sessionId}] OpenAI Error:`, data.error);
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
                    console.log(`[Interpreter ${this.sessionId}] Unknown message type:`, data.type);
            }
        } catch (error) {
            console.error(`[Interpreter ${this.sessionId}] Error parsing message:`, error);
        }
    }

    sendToClient(message) {
        if (this.clientWs.readyState === WebSocket.OPEN) {
            this.clientWs.send(JSON.stringify(message));
        }
    }

    close() {
        console.log(`[Interpreter ${this.sessionId}] Closing session`);
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

    wss.on('connection', (ws, req) => {
        // Parse query parameters for language configuration
        const url = new URL(req.url, `http://${req.headers.host}`);
        const sourceLanguage = url.searchParams.get('source') || 'English';
        const targetLanguage = url.searchParams.get('target') || 'Spanish';
        const sessionId = `interpreter-${++sessionCounter}`;

        console.log(`[WebSocket] New interpreter connection: ${sessionId}`);

        const session = new InterpreterSession(ws, sourceLanguage, targetLanguage, sessionId);
        interpreterSessions.set(sessionId, session);

        ws.on('message', (message) => {
            session.handleClientMessage(message.toString());
        });

        ws.on('close', () => {
            console.log(`[WebSocket] Interpreter disconnected: ${sessionId}`);
            session.close();
            interpreterSessions.delete(sessionId);
        });

        ws.on('error', (error) => {
            console.error(`[WebSocket] Error for ${sessionId}:`, error.message);
        });
    });

    console.log('  WS   /ws/interpret                      - OpenAI Realtime proxy');
    return wss;
}

// =============================================================================
// Catch-all route - Serve frontend for any non-API routes
// =============================================================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================================================
// Server Startup
// =============================================================================
const server = app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('AI Live Dubbing Platform - Backend Server');
    console.log('='.repeat(60));
    console.log(`Server running on: http://localhost:${PORT}`);
    console.log(`OpenVidu Server:   ${OPENVIDU_URL}`);
    console.log(`OpenAI API Key:    ${OPENAI_API_KEY ? '✓ Configured' : '✗ NOT SET'}`);
    console.log('='.repeat(60));
    console.log('Available endpoints:');
    console.log('  GET  /api/health                        - Health check');
    console.log('  POST /api/sessions                      - Create session');
    console.log('  POST /api/sessions/:id/connections      - Get connection token');
    console.log('  GET  /api/sessions/:id                  - Get session info');
    
    // Setup WebSocket for interpretation
    setupInterpreterWebSocket(server);
    
    console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

module.exports = { app, server };
