/**
 * Interpreter Manager
 * 
 * Manages multi-participant interpretation.
 * Supports up to 3+ participants with different languages.
 * 
 * Architecture:
 * - Each user can independently activate their AI interpreter
 * - When activated, creates interpreters for each remote participant with a different language
 * - Example: If local user speaks Spanish, and there are English and French speakers:
 *   - Creates interpreter: English → Spanish
 *   - Creates interpreter: French → Spanish
 */

class InterpreterManager {
    constructor() {
        this.isActive = false;
        this.localLanguage = null;
        
        // Map of connectionId -> { audioProcessor, language, videoElement }
        this.activeInterpreters = new Map();
        
        // Callbacks
        this.onLog = null;
        this.onTranscript = null;
        this.onStatusChange = null;
    }

    log(type, message) {
        console.log(`[InterpreterManager] ${message}`);
        if (this.onLog) {
            this.onLog(type, message);
        }
    }

    /**
     * Get language display name from code
     */
    getLanguageName(code) {
        const languages = {
            'en': 'English',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese',
            'zh': 'Chinese',
            'ja': 'Japanese',
            'ko': 'Korean'
        };
        return languages[code] || code;
    }

    /**
     * Check if interpretation is needed (different languages)
     */
    needsInterpretation(localLang, remoteLang) {
        return localLang !== remoteLang;
    }

    /**
     * Start interpreters for all remote participants with different languages
     * @param {Object} config Configuration object
     * @param {string} config.localLanguage - Local user's language code
     * @param {Array} config.remoteParticipants - Array of { connectionId, language, audioTrack, videoElement }
     */
    async start(config) {
        if (this.isActive) {
            this.log('warn', 'Interpreter already active');
            return false;
        }

        const { localLanguage, remoteParticipants } = config;
        this.localLanguage = localLanguage;

        const localLangName = this.getLanguageName(localLanguage);
        this.log('info', `Starting interpreter for ${remoteParticipants.length} remote participant(s)`);

        let startedCount = 0;

        for (const participant of remoteParticipants) {
            const { connectionId, language, audioTrack, videoElement } = participant;

            // Skip if same language
            if (!this.needsInterpretation(localLanguage, language)) {
                this.log('info', `Skipping ${connectionId}: same language (${language})`);
                continue;
            }

            // Skip if no audio track
            if (!audioTrack) {
                this.log('warn', `Skipping ${connectionId}: no audio track`);
                continue;
            }

            // Skip if already has interpreter
            if (this.activeInterpreters.has(connectionId)) {
                this.log('info', `Skipping ${connectionId}: already has interpreter`);
                continue;
            }

            const remoteLangName = this.getLanguageName(language);
            this.log('info', `Creating interpreter: ${remoteLangName} → ${localLangName} for ${connectionId}`);

            try {
                // Reduce volume of original audio to 30%
                if (videoElement) {
                    videoElement.volume = 0.3;
                }

                // Create audio processor for this participant
                const audioProcessor = new AudioProcessor();
                audioProcessor.onLog = this.onLog;

                // Build WebSocket URL
                const wsUrl = `${CONFIG.BACKEND_URL.replace('http', 'ws')}/ws/interpret?source=${encodeURIComponent(remoteLangName)}&target=${encodeURIComponent(localLangName)}`;

                // Start processing
                await audioProcessor.start(
                    audioTrack,
                    wsUrl,
                    (audioData) => {
                        // Translated audio received - played automatically
                    },
                    (type, text) => {
                        if (this.onTranscript) {
                            this.onTranscript(type, text, connectionId);
                        }
                    }
                );

                // Store the interpreter
                this.activeInterpreters.set(connectionId, {
                    audioProcessor,
                    language,
                    videoElement
                });

                startedCount++;
                this.log('info', `Interpreter started for ${connectionId} (${remoteLangName} → ${localLangName})`);

            } catch (error) {
                this.log('error', `Failed to start interpreter for ${connectionId}: ${error.message}`);
            }
        }

        if (startedCount > 0) {
            this.isActive = true;
            if (this.onStatusChange) {
                this.onStatusChange(true);
            }
            this.log('info', `Started ${startedCount} interpreter(s)`);
            return true;
        } else {
            this.log('info', 'No interpreters needed (all same language or no participants)');
            return false;
        }
    }

    /**
     * Add interpreter for a new participant (when they join while interpreter is active)
     */
    async addParticipant(participant) {
        if (!this.isActive) return false;

        const { connectionId, language, audioTrack, videoElement } = participant;

        // Skip if same language
        if (!this.needsInterpretation(this.localLanguage, language)) {
            this.log('info', `New participant ${connectionId} speaks same language, no interpreter needed`);
            return false;
        }

        // Skip if already exists
        if (this.activeInterpreters.has(connectionId)) {
            return false;
        }

        const localLangName = this.getLanguageName(this.localLanguage);
        const remoteLangName = this.getLanguageName(language);

        this.log('info', `Adding interpreter for new participant: ${remoteLangName} → ${localLangName}`);

        try {
            if (videoElement) {
                videoElement.volume = 0.3;
            }

            const audioProcessor = new AudioProcessor();
            audioProcessor.onLog = this.onLog;

            const wsUrl = `${CONFIG.BACKEND_URL.replace('http', 'ws')}/ws/interpret?source=${encodeURIComponent(remoteLangName)}&target=${encodeURIComponent(localLangName)}`;

            await audioProcessor.start(
                audioTrack,
                wsUrl,
                (audioData) => {},
                (type, text) => {
                    if (this.onTranscript) {
                        this.onTranscript(type, text, connectionId);
                    }
                }
            );

            this.activeInterpreters.set(connectionId, {
                audioProcessor,
                language,
                videoElement
            });

            this.log('info', `Interpreter added for ${connectionId}`);
            return true;

        } catch (error) {
            this.log('error', `Failed to add interpreter for ${connectionId}: ${error.message}`);
            return false;
        }
    }

    /**
     * Remove interpreter for a participant (when they leave)
     */
    removeParticipant(connectionId) {
        const interpreter = this.activeInterpreters.get(connectionId);
        if (!interpreter) return;

        this.log('info', `Removing interpreter for ${connectionId}`);

        if (interpreter.audioProcessor) {
            interpreter.audioProcessor.stop();
        }

        if (interpreter.videoElement) {
            interpreter.videoElement.volume = 1.0;
        }

        this.activeInterpreters.delete(connectionId);

        // If no more interpreters, deactivate
        if (this.activeInterpreters.size === 0 && this.isActive) {
            this.isActive = false;
            if (this.onStatusChange) {
                this.onStatusChange(false);
            }
            this.log('info', 'All interpreters stopped');
        }
    }

    /**
     * Stop all interpreters and restore normal audio
     */
    stop() {
        this.log('info', 'Stopping all interpreters');

        // Stop all active interpreters
        for (const [connectionId, interpreter] of this.activeInterpreters) {
            if (interpreter.audioProcessor) {
                interpreter.audioProcessor.stop();
            }
            if (interpreter.videoElement) {
                interpreter.videoElement.volume = 1.0;
            }
        }
        this.activeInterpreters.clear();

        // Also restore any other remote videos (safety)
        const remoteVideos = document.querySelectorAll('.remote-video video');
        remoteVideos.forEach(video => {
            video.volume = 1.0;
        });

        this.isActive = false;
        this.localLanguage = null;

        if (this.onStatusChange) {
            this.onStatusChange(false);
        }

        this.log('info', 'All interpreters stopped');
    }

    /**
     * Check if interpreter is currently active
     */
    getStatus() {
        return {
            isActive: this.isActive,
            localLanguage: this.localLanguage,
            activeCount: this.activeInterpreters.size,
            interpreters: Array.from(this.activeInterpreters.keys())
        };
    }
}

// Create singleton instance
const interpreterManager = new InterpreterManager();
