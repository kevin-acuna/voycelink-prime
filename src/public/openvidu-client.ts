// @ts-nocheck
/**
 * OpenVidu Client Module
 * 
 * Handles all OpenVidu-related operations:
 * - Session connection
 * - Publishing local media
 * - Subscribing to remote streams
 * - MediaStreamTrack access for future AI audio processing
 */

class OpenViduClient {
    constructor() {
        this.OV = null;                     // OpenVidu instance
        this.session = null;                // Current session
        this.publisher = null;              // Local publisher
        this.subscribers = new Map();       // Map<connectionId, Subscriber>
        this.remoteAudioTracks = new Map(); // Map<connectionId, MediaStreamTrack> - FOR AI PROCESSING
        
        // Event callbacks - set these from app.js
        this.onStreamCreated = null;
        this.onStreamDestroyed = null;
        this.onConnectionCreated = null;
        this.onConnectionDestroyed = null;
        this.onException = null;
        this.onLog = null;
        this.onSessionDisconnected = null;
    }

    /**
     * Log helper - sends logs to debug panel
     */
    log(type, message) {
        console.log(`[OpenViduClient] ${message}`);
        if (this.onLog) {
            this.onLog(type, message);
        }
    }

    /**
     * Initialize OpenVidu and create a session
     */
    init() {
        this.OV = new OpenVidu();
        
        // Enable detailed logging in development
        if (CONFIG.DEBUG) {
            this.OV.enableProdMode();
        }
        
        this.session = this.OV.initSession();
        this.setupSessionEventHandlers();
        
        this.log('info', 'OpenVidu initialized');
    }

    /**
     * Set up all session event handlers
     * These events are crucial for managing the video conference
     */
    setupSessionEventHandlers() {
        // =========================================================================
        // STREAM CREATED - A new participant published their stream
        // =========================================================================
        this.session.on('streamCreated', (event) => {
            this.log('info', `Stream created: ${event.stream.connection.connectionId}`);
            
            // Subscribe to the remote stream
            const subscriber = this.session.subscribe(event.stream, undefined);
            
            // Store subscriber reference
            const connectionId = event.stream.connection.connectionId;
            this.subscribers.set(connectionId, subscriber);
            
            // =====================================================================
            // CRITICAL FOR AI DUBBING: Access MediaStreamTrack when ready
            // =====================================================================
            subscriber.on('streamPlaying', (e) => {
                this.extractAudioTrack(connectionId, subscriber);
            });
            
            // Notify app layer
            if (this.onStreamCreated) {
                this.onStreamCreated(event, subscriber);
            }
        });

        // =========================================================================
        // STREAM PROPERTY CHANGED - Video/Audio toggled by remote participant
        // =========================================================================
        this.session.on('streamPropertyChanged', (event) => {
            const connectionId = event.stream.connection.connectionId;
            this.log('info', `Stream property changed: ${event.changedProperty} for ${connectionId}`);
            
            if (this.onStreamPropertyChanged) {
                this.onStreamPropertyChanged(event);
            }
        });

        // =========================================================================
        // STREAM DESTROYED - A participant stopped their stream
        // =========================================================================
        this.session.on('streamDestroyed', (event) => {
            const connectionId = event.stream.connection.connectionId;
            this.log('warn', `Stream destroyed: ${connectionId}`);
            
            // Clean up references
            this.subscribers.delete(connectionId);
            this.remoteAudioTracks.delete(connectionId);
            
            if (this.onStreamDestroyed) {
                this.onStreamDestroyed(event);
            }
        });

        // =========================================================================
        // CONNECTION CREATED - New participant joined (might not have published yet)
        // =========================================================================
        this.session.on('connectionCreated', (event) => {
            this.log('info', `Connection created: ${event.connection.connectionId}`);
            
            if (this.onConnectionCreated) {
                this.onConnectionCreated(event);
            }
        });

        // =========================================================================
        // CONNECTION DESTROYED - Participant left
        // =========================================================================
        this.session.on('connectionDestroyed', (event) => {
            const connectionId = event.connection.connectionId;
            this.log('warn', `Connection destroyed: ${connectionId}`);
            
            // Clean up
            this.subscribers.delete(connectionId);
            this.remoteAudioTracks.delete(connectionId);
            
            if (this.onConnectionDestroyed) {
                this.onConnectionDestroyed(event);
            }
        });

        // =========================================================================
        // EXCEPTION - Handle OpenVidu errors
        // =========================================================================
        this.session.on('exception', (exception) => {
            this.log('error', `Exception: ${exception.name} - ${exception.message}`);
            
            // Handle ICE disconnection specifically
            if (exception.name === 'ICE_CONNECTION_DISCONNECTED') {
                this.handleIceDisconnection(exception);
            } else if (exception.name === 'ICE_CONNECTION_FAILED') {
                this.handleIceFailure(exception);
            }
            
            if (this.onException) {
                this.onException(exception);
            }
        });

        // =========================================================================
        // RECONNECTION EVENTS
        // =========================================================================
        this.session.on('reconnecting', () => {
            this.log('warn', 'Connection lost. Attempting to reconnect...');
            if (this.onReconnecting) {
                this.onReconnecting();
            }
        });

        this.session.on('reconnected', () => {
            this.log('info', 'Successfully reconnected!');
            if (this.onReconnected) {
                this.onReconnected();
            }
        });

        this.session.on('sessionDisconnected', (event) => {
            this.log('warn', `Session disconnected: ${event.reason}`);
            if (this.onSessionDisconnected) {
                this.onSessionDisconnected(event);
            }
        });
    }

    /**
     * Handle ICE disconnection - connection temporarily lost
     */
    handleIceDisconnection(exception) {
        this.log('warn', 'ICE disconnection detected - network may be unstable');
        // OpenVidu will attempt to reconnect automatically
        // We just log and wait for reconnection events
    }

    /**
     * Handle ICE failure - connection completely failed
     */
    handleIceFailure(exception) {
        this.log('error', 'ICE connection failed - cannot recover');
        // This is more serious - may need to rejoin the session
        if (this.onIceFailure) {
            this.onIceFailure(exception);
        }
    }

    /**
     * CRITICAL METHOD FOR AI DUBBING
     * 
     * Extracts the audio MediaStreamTrack from a subscriber.
     * This track can later be used to:
     * 1. Create an AudioContext for processing
     * 2. Send audio chunks to WebSocket for real-time translation
     * 3. Apply audio transformations
     * 
     * @param {string} connectionId - The connection ID of the subscriber
     * @param {Subscriber} subscriber - The OpenVidu Subscriber object
     */
    extractAudioTrack(connectionId, subscriber) {
        try {
            // Get the MediaStream from the subscriber
            const mediaStream = subscriber.stream.getMediaStream();
            
            if (!mediaStream) {
                this.log('warn', `No MediaStream for ${connectionId}`);
                return null;
            }
            
            // Get audio tracks from the stream
            const audioTracks = mediaStream.getAudioTracks();
            
            if (audioTracks.length === 0) {
                this.log('warn', `No audio tracks for ${connectionId}`);
                return null;
            }
            
            // Store the first audio track (usually there's only one)
            const audioTrack = audioTracks[0];
            this.remoteAudioTracks.set(connectionId, audioTrack);
            
            this.log('info', `Audio track extracted for ${connectionId}: ${audioTrack.label}`);
            
            // Parse connection data to get language preference
            let connectionData = {};
            try {
                connectionData = JSON.parse(subscriber.stream.connection.data);
            } catch (e) {
                // Connection data might not be JSON
            }
            
            // Log track info for debugging
            this.log('info', `  - Track ID: ${audioTrack.id}`);
            this.log('info', `  - Track Label: ${audioTrack.label}`);
            this.log('info', `  - Track Enabled: ${audioTrack.enabled}`);
            this.log('info', `  - User Language: ${connectionData.preferredLanguage || 'unknown'}`);
            
            return audioTrack;
            
        } catch (error) {
            this.log('error', `Error extracting audio track: ${error.message}`);
            return null;
        }
    }

    /**
     * Get all remote audio tracks (for AI processing)
     * Returns a Map of connectionId -> MediaStreamTrack
     */
    getRemoteAudioTracks() {
        return this.remoteAudioTracks;
    }

    /**
     * Get audio track for a specific participant
     * @param {string} connectionId 
     * @returns {MediaStreamTrack|null}
     */
    getAudioTrackForParticipant(connectionId) {
        return this.remoteAudioTracks.get(connectionId) || null;
    }

    /**
     * Connect to a session using a token from the backend
     * @param {string} token - The connection token from backend
     */
    async connect(token) {
        if (!this.session) {
            throw new Error('Session not initialized. Call init() first.');
        }
        
        await this.session.connect(token);
        this.log('info', 'Connected to session');
    }

    /**
     * Publish local camera and microphone
     * @param {HTMLVideoElement} videoElement - Video element to attach the stream to
     * @param {Object} settings - Publisher settings override
     */
    async publish(videoElement, settings = {}) {
        const publisherSettings = {
            ...CONFIG.PUBLISHER_SETTINGS,
            ...settings
        };
        
        // Initialize publisher WITHOUT a target element (we'll attach manually)
        // OpenVidu expects a container div, not a video element
        this.publisher = await this.OV.initPublisherAsync(undefined, publisherSettings);
        
        // Manually attach the stream to our video element
        if (videoElement && videoElement.tagName === 'VIDEO') {
            this.publisher.addVideoElement(videoElement);
            this.log('info', 'Video element attached');
        }
        
        // Publish to session
        await this.session.publish(this.publisher);
        
        this.log('info', 'Local stream published');
        
        return this.publisher;
    }

    /**
     * Toggle local audio (mute/unmute)
     * @returns {boolean} New audio state
     */
    toggleAudio() {
        if (!this.publisher) return false;
        
        const newState = !this.publisher.stream.audioActive;
        this.publisher.publishAudio(newState);
        
        this.log('info', `Audio ${newState ? 'unmuted' : 'muted'}`);
        return newState;
    }

    /**
     * Toggle local video (on/off)
     * @returns {boolean} New video state
     */
    toggleVideo() {
        if (!this.publisher) return false;
        
        const newState = !this.publisher.stream.videoActive;
        this.publisher.publishVideo(newState);
        
        this.log('info', `Video ${newState ? 'enabled' : 'disabled'}`);
        return newState;
    }

    /**
     * Disconnect from the session and clean up
     */
    disconnect() {
        if (this.session) {
            this.session.disconnect();
        }
        
        this.subscribers.clear();
        this.remoteAudioTracks.clear();
        this.publisher = null;
        this.session = null;
        this.OV = null;
        
        this.log('info', 'Disconnected and cleaned up');
    }

    /**
     * Get local stream's audio track (for monitoring local audio)
     * @returns {MediaStreamTrack|null}
     */
    getLocalAudioTrack() {
        if (!this.publisher) return null;
        
        const mediaStream = this.publisher.stream.getMediaStream();
        if (!mediaStream) return null;
        
        const audioTracks = mediaStream.getAudioTracks();
        return audioTracks.length > 0 ? audioTracks[0] : null;
    }
}

// Export singleton instance
const openviduClient = new OpenViduClient();
