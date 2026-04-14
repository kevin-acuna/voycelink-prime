// @ts-nocheck
/**
 * LiveKit Client Module
 * 
 * Handles all LiveKit-related operations:
 * - Room connection
 * - Publishing local media
 * - Subscribing to remote tracks
 * - MediaStreamTrack access for AI audio processing
 */

class LiveKitClient {
    constructor() {
        this.room = null;                    // LiveKit Room instance
        this.localVideoTrack = null;         // Local camera track
        this.localAudioTrack = null;         // Local microphone track
        this.remoteAudioTracks = new Map();  // Map<participantIdentity, MediaStreamTrack>
        this.subscribers = new Map();        // Map<participantIdentity, RemoteParticipant> - compat alias
        
        // Event callbacks
        this.onTrackSubscribed = null;       // (track, publication, participant) => void
        this.onTrackUnsubscribed = null;     // (track, publication, participant) => void
        this.onParticipantConnected = null;
        this.onParticipantDisconnected = null;
        this.onTrackMuted = null;
        this.onTrackUnmuted = null;
        this.onDisconnected = null;
        this.onReconnecting = null;
        this.onReconnected = null;
        this.onDataReceived = null;          // (payload, participant, topic) => void
        this.onLog = null;
    }

    log(type, message) {
        console.log(`[LiveKitClient] ${message}`);
        if (this.onLog) {
            this.onLog(type, message);
        }
    }

    /**
     * Initialize a new LiveKit Room
     */
    init() {
        this.room = new LivekitClient.Room({
            adaptiveStream: true,
            dynacast: true,
            videoCaptureDefaults: {
                resolution: LivekitClient.VideoPresets.h720.resolution,
            },
        });
        this.setupRoomEventHandlers();
        this.log('info', 'LiveKit Room initialized');
    }

    /**
     * Set up all room event handlers
     */
    setupRoomEventHandlers() {
        const RoomEvent = LivekitClient.RoomEvent;

        // Track subscribed - a remote participant's track is ready
        this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            this.log('info', `Track subscribed: ${track.kind} from ${participant.identity}`);

            if (track.kind === 'audio') {
                const mediaStream = new MediaStream([track.mediaStreamTrack]);
                this.remoteAudioTracks.set(participant.identity, track.mediaStreamTrack);
            }

            // Map participant by identity for backward compatibility
            this.subscribers.set(participant.identity, participant);

            if (this.onTrackSubscribed) {
                this.onTrackSubscribed(track, publication, participant);
            }
        });

        // Track unsubscribed
        this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            this.log('info', `Track unsubscribed: ${track.kind} from ${participant.identity}`);

            if (track.kind === 'audio') {
                this.remoteAudioTracks.delete(participant.identity);
            }

            if (this.onTrackUnsubscribed) {
                this.onTrackUnsubscribed(track, publication, participant);
            }
        });

        // Track muted/unmuted
        this.room.on(RoomEvent.TrackMuted, (publication, participant) => {
            this.log('info', `Track muted: ${publication.kind} from ${participant.identity}`);
            if (this.onTrackMuted) {
                this.onTrackMuted(publication, participant);
            }
        });

        this.room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
            this.log('info', `Track unmuted: ${publication.kind} from ${participant.identity}`);
            if (this.onTrackUnmuted) {
                this.onTrackUnmuted(publication, participant);
            }
        });

        // Participant connected
        this.room.on(RoomEvent.ParticipantConnected, (participant) => {
            this.log('info', `Participant connected: ${participant.identity}`);
            this.subscribers.set(participant.identity, participant);
            if (this.onParticipantConnected) {
                this.onParticipantConnected(participant);
            }
        });

        // Participant disconnected
        this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            this.log('warn', `Participant disconnected: ${participant.identity}`);
            this.subscribers.delete(participant.identity);
            this.remoteAudioTracks.delete(participant.identity);
            if (this.onParticipantDisconnected) {
                this.onParticipantDisconnected(participant);
            }
        });

        // Data received
        this.room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
            if (this.onDataReceived) {
                try {
                    const decoded = new TextDecoder().decode(payload);
                    this.onDataReceived(decoded, participant, topic);
                } catch (e) {
                    this.log('error', `Error decoding data message: ${e.message}`);
                }
            }
        });

        // Disconnected
        this.room.on(RoomEvent.Disconnected, (reason) => {
            this.log('warn', `Disconnected: ${reason}`);
            if (this.onDisconnected) {
                this.onDisconnected(reason);
            }
        });

        // Reconnecting
        this.room.on(RoomEvent.Reconnecting, () => {
            this.log('warn', 'Connection lost. Attempting to reconnect...');
            if (this.onReconnecting) {
                this.onReconnecting();
            }
        });

        // Reconnected
        this.room.on(RoomEvent.Reconnected, () => {
            this.log('info', 'Successfully reconnected!');
            if (this.onReconnected) {
                this.onReconnected();
            }
        });
    }

    /**
     * Connect to a room using a token
     * @param {string} livekitUrl - The LiveKit server URL
     * @param {string} token - The access token
     */
    async connect(livekitUrl, token) {
        if (!this.room) {
            throw new Error('Room not initialized. Call init() first.');
        }
        await this.room.connect(livekitUrl, token);
        this.log('info', 'Connected to room');
        
        // Populate subscribers map with already-connected remote participants
        // ParticipantConnected only fires for participants who join AFTER us
        this.room.remoteParticipants.forEach((participant) => {
            this.subscribers.set(participant.identity, participant);
            this.log('info', `Pre-existing participant: ${participant.identity}`);
        });
    }

    /**
     * Get all remote participants already in the room (for initial enumeration)
     */
    getExistingParticipants() {
        if (!this.room) return [];
        return Array.from(this.room.remoteParticipants.values());
    }

    /**
     * Publish local camera and microphone
     * @param {HTMLVideoElement} videoElement - Video element to attach the stream to
     * @param {Object} settings - Publisher settings
     */
    async publish(videoElement, settings = {}) {
        const tracks = await LivekitClient.createLocalTracks({
            audio: settings.publishAudio !== false ? (settings.audioSource ? { deviceId: settings.audioSource } : true) : false,
            video: settings.publishVideo !== false ? (settings.videoSource ? { deviceId: settings.videoSource } : true) : false,
        });

        for (const track of tracks) {
            await this.room.localParticipant.publishTrack(track);
            if (track.kind === 'video') {
                this.localVideoTrack = track;
                if (videoElement) {
                    track.attach(videoElement);
                }
            } else if (track.kind === 'audio') {
                this.localAudioTrack = track;
            }
        }

        this.log('info', 'Local tracks published');
    }

    /**
     * Toggle local audio (mute/unmute)
     * Uses setMicrophoneEnabled which properly handles the async mute/unmute lifecycle
     * @returns {Promise<boolean>} New audio state (true = unmuted/live)
     */
    async toggleAudio() {
        const lp = this.room?.localParticipant;
        if (!lp) return false;
        const isCurrentlyEnabled = this.isMicrophoneEnabled();
        const newEnabled = !isCurrentlyEnabled;
        await lp.setMicrophoneEnabled(newEnabled);
        // Update local track reference
        if (newEnabled) {
            const micPub = lp.getTrackPublication(LivekitClient.Track.Source.Microphone);
            if (micPub?.track) this.localAudioTrack = micPub.track;
        }
        this.log('info', `Audio ${newEnabled ? 'unmuted' : 'muted'}`);
        return newEnabled;
    }

    /**
     * Toggle local video (on/off)
     * Uses setCameraEnabled which properly handles the async mute/unmute lifecycle
     * @returns {Promise<boolean>} New video state (true = enabled)
     */
    async toggleVideo() {
        const lp = this.room?.localParticipant;
        if (!lp) return false;
        const isCurrentlyEnabled = this.isCameraEnabled();
        const newEnabled = !isCurrentlyEnabled;
        await lp.setCameraEnabled(newEnabled);
        // Update local track reference
        if (newEnabled) {
            const camPub = lp.getTrackPublication(LivekitClient.Track.Source.Camera);
            if (camPub?.track) this.localVideoTrack = camPub.track;
        }
        this.log('info', `Video ${newEnabled ? 'enabled' : 'disabled'}`);
        return newEnabled;
    }

    /**
     * Check if microphone is currently enabled (published and not muted)
     */
    isMicrophoneEnabled() {
        const lp = this.room?.localParticipant;
        if (!lp) return false;
        const micPub = lp.getTrackPublication(LivekitClient.Track.Source.Microphone);
        return Boolean(micPub && !micPub.isMuted);
    }

    /**
     * Check if camera is currently enabled (published and not muted)
     */
    isCameraEnabled() {
        const lp = this.room?.localParticipant;
        if (!lp) return false;
        const camPub = lp.getTrackPublication(LivekitClient.Track.Source.Camera);
        return Boolean(camPub && !camPub.isMuted);
    }

    /**
     * Send data message to participants
     * @param {string} topic - Message topic (e.g., 'chat', 'reaction')
     * @param {string|object} data - Data to send
     * @param {Array} destinationIdentities - Array of participant identities (empty = broadcast)
     */
    async sendData(topic, data, destinationIdentities = []) {
        if (!this.room?.localParticipant) return;
        const payload = new TextEncoder().encode(
            typeof data === 'string' ? data : JSON.stringify(data)
        );
        await this.room.localParticipant.publishData(payload, {
            reliable: true,
            topic,
            destinationIdentities: destinationIdentities.length > 0 ? destinationIdentities : undefined,
        });
    }

    /**
     * Get all remote audio tracks (for AI processing)
     */
    getRemoteAudioTracks() {
        return this.remoteAudioTracks;
    }

    /**
     * Get audio track for a specific participant
     */
    getAudioTrackForParticipant(identity) {
        return this.remoteAudioTracks.get(identity) || null;
    }

    /**
     * Get local audio track
     */
    getLocalAudioTrack() {
        if (!this.localAudioTrack) return null;
        return this.localAudioTrack.mediaStreamTrack || null;
    }

    /**
     * Get the local participant's metadata as parsed JSON
     */
    getLocalMetadata() {
        try {
            return JSON.parse(this.room?.localParticipant?.metadata || '{}');
        } catch {
            return {};
        }
    }

    /**
     * Get a remote participant's metadata as parsed JSON
     */
    getParticipantMetadata(identity) {
        try {
            const participant = this.room?.remoteParticipants?.get(identity);
            return JSON.parse(participant?.metadata || '{}');
        } catch {
            return {};
        }
    }

    /**
     * Switch active input/output device mid-call
     * @param {'audioinput'|'audiooutput'|'videoinput'} kind
     * @param {string} deviceId
     * @param {HTMLVideoElement} [localVideoElement] - video element to re-attach camera track
     */
    async switchActiveDevice(kind, deviceId, localVideoElement = null) {
        if (!this.room) return;
        const lp = this.room.localParticipant;

        if (kind === 'audioinput') {
            if (this.isMicrophoneEnabled()) {
                await this.room.switchActiveDevice(kind, deviceId);
            }
            // If mic is muted, just store the preference — it'll be used on next enable
            const micPub = lp.getTrackPublication(LivekitClient.Track.Source.Microphone);
            if (micPub?.track) this.localAudioTrack = micPub.track;
        } else if (kind === 'videoinput') {
            if (this.isCameraEnabled()) {
                // Detach old track from video element
                if (this.localVideoTrack && localVideoElement) {
                    this.localVideoTrack.detach(localVideoElement);
                }
                await this.room.switchActiveDevice(kind, deviceId);
                // Re-attach the new track
                const camPub = lp.getTrackPublication(LivekitClient.Track.Source.Camera);
                if (camPub?.track) {
                    this.localVideoTrack = camPub.track;
                    if (localVideoElement) {
                        camPub.track.attach(localVideoElement);
                    }
                }
            }
            // If camera is off, just store the preference
        } else {
            // audiooutput
            await this.room.switchActiveDevice(kind, deviceId);
        }

        this.log('info', `Switched ${kind} to ${deviceId}`);
    }

    /**
     * Disconnect and clean up
     */
    disconnect() {
        if (this.room) {
            this.room.disconnect();
        }

        if (this.localVideoTrack) {
            this.localVideoTrack.stop();
            this.localVideoTrack = null;
        }
        if (this.localAudioTrack) {
            this.localAudioTrack.stop();
            this.localAudioTrack = null;
        }

        this.subscribers.clear();
        this.remoteAudioTracks.clear();
        this.room = null;

        this.log('info', 'Disconnected and cleaned up');
    }

    /**
     * Get the LiveKit server URL from config
     */
    get serverUrl() {
        return CONFIG.LIVEKIT_URL || '';
    }
}

// Export singleton instance (keeping backward-compatible name for gradual migration)
const livekitClient = new LiveKitClient();
