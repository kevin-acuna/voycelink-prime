// @ts-nocheck
/**
 * Frontend Configuration
 * 
 * Configure the backend API URL here.
 * In production, this should point to your deployed backend.
 */

const CONFIG = {
    // Backend API URL - empty string for same-origin deployment (Azure Web App)
    BACKEND_URL: '',
    // For local development, use: 'http://localhost:3000'
    // BACKEND_URL: 'http://localhost:3000',
    
    // API Endpoints
    ENDPOINTS: {
        HEALTH: '/api/health',
        MY_PERMISSIONS: '/api/me/permissions',
        HOST_SESSION_BOOTSTRAP: '/api/bootstrap/host-session',
        SESSIONS: '/api/sessions',
        SESSION: (sessionId) => `/api/sessions/${sessionId}`,
        SESSION_INVITE_LINK: (sessionId) => `/api/sessions/${sessionId}/invite-link`,
        SESSION_ROOM_TARGET: (sessionId) => `/api/sessions/${sessionId}/room-target`,
        SESSION_BREAKOUTS: (sessionId) => `/api/sessions/${sessionId}/breakouts`,
        SESSION_BREAKOUT: (sessionId, breakoutRoomId) => `/api/sessions/${sessionId}/breakouts/${breakoutRoomId}`,
        SESSION_BREAKOUT_OPEN: (sessionId, breakoutRoomId) => `/api/sessions/${sessionId}/breakouts/${breakoutRoomId}/open`,
        SESSION_BREAKOUT_CLOSE: (sessionId, breakoutRoomId) => `/api/sessions/${sessionId}/breakouts/${breakoutRoomId}/close`,
        WHITEBOARD_STATE: (sessionId) => `/api/sessions/${sessionId}/whiteboard-state`,
        PARTICIPANT_LOCATION: (sessionId, participantId) =>
            `/api/sessions/${sessionId}/participants/${participantId}/location`,
        CONNECTIONS: (sessionId) => `/api/sessions/${sessionId}/connections`,
        SESSION_PARTICIPANT: (sessionId, participantId) =>
            `/api/sessions/${sessionId}/participants/${participantId}`,
        PARTICIPANT_DISCONNECT: (sessionId, participantId) =>
            `/api/sessions/${sessionId}/participants/${participantId}/disconnect`,
        PARTICIPANT_PERMISSIONS: (sessionId, participantId) =>
            `/api/sessions/${sessionId}/participants/${participantId}/permissions`,
        PARTICIPANT_ROLE: (sessionId, participantId) =>
            `/api/sessions/${sessionId}/participants/${participantId}/role`
    },
    
    // OpenVidu Publisher Settings
    PUBLISHER_SETTINGS: {
        audioSource: undefined,     // Default microphone
        videoSource: undefined,     // Default camera
        publishAudio: true,
        publishVideo: true,
        resolution: '640x480',
        frameRate: 30,
        insertMode: 'APPEND',
        mirror: false               // We handle mirroring via CSS
    },
    
    // Debug mode - shows the debug panel (set to false for production)
    DEBUG: false
};

// Freeze config to prevent accidental modifications
Object.freeze(CONFIG);
Object.freeze(CONFIG.ENDPOINTS);
Object.freeze(CONFIG.PUBLISHER_SETTINGS);
