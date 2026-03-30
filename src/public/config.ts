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
        SESSIONS: '/api/sessions',
        CONNECTIONS: (sessionId) => `/api/sessions/${sessionId}/connections`
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
