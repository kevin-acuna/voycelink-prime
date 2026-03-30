// @ts-nocheck
/**
 * Transcription Manager
 * 
 * Manages real-time transcription and translation using Azure Speech SDK.
 * Shows subtitles under each participant's video in the user's preferred language.
 */

class TranscriptionManager {
    constructor() {
        this.isActive = false;
        this.localLanguage = null;
        
        // Map of connectionId -> { recognizer, language }
        this.activeTranscribers = new Map();
        
        // Azure Speech SDK config
        this.subscriptionKey = null;
        this.serviceRegion = null;
        
        // Callbacks
        this.onLog = null;
        this.onCaptionUpdate = null; // (connectionId, text, isFinal) => void
    }

    log(type, message) {
        console.log(`[TranscriptionManager] ${message}`);
        if (this.onLog) {
            this.onLog(type, message);
        }
    }

    /**
     * Initialize with Azure credentials
     */
    async initialize() {
        try {
            // Fetch Azure credentials from backend
            const response = await fetch(`${CONFIG.BACKEND_URL}/api/azure-speech-token`);
            if (!response.ok) {
                throw new Error('Failed to get Azure Speech credentials');
            }
            const data = await response.json();
            this.subscriptionKey = data.token;
            this.serviceRegion = data.region;
            this.log('info', `Azure Speech SDK initialized (region: ${this.serviceRegion})`);
            return true;
        } catch (error) {
            this.log('error', `Failed to initialize Azure Speech: ${error.message}`);
            return false;
        }
    }

    /**
     * Get language code for Azure (e.g., 'en' -> 'en-US')
     */
    getAzureLanguageCode(code) {
        const languageMap = {
            'en': 'en-US',
            'es': 'es-ES',
            'fr': 'fr-FR',
            'de': 'de-DE',
            'it': 'it-IT',
            'pt': 'pt-BR',
            'zh': 'zh-CN',
            'ja': 'ja-JP',
            'ko': 'ko-KR'
        };
        return languageMap[code] || 'en-US';
    }

    /**
     * Get short language code (e.g., 'en-US' -> 'en')
     */
    getShortLanguageCode(code) {
        return code.split('-')[0];
    }

    /**
     * Check if SDK is available
     */
    isSDKAvailable() {
        return typeof SpeechSDK !== 'undefined';
    }

    /**
     * Start transcription for all remote participants
     * @param {Object} config Configuration object
     * @param {string} config.localLanguage - Local user's language code (target language for translations)
     * @param {Array} config.remoteParticipants - Array of { connectionId, language, audioTrack, videoElement }
     */
    async start(config) {
        if (this.isActive) {
            this.log('warn', 'Transcription already active');
            return false;
        }

        if (!this.isSDKAvailable()) {
            this.log('error', 'Azure Speech SDK not loaded');
            return false;
        }

        if (!this.subscriptionKey) {
            const initialized = await this.initialize();
            if (!initialized) return false;
        }

        const { localLanguage, remoteParticipants } = config;
        this.localLanguage = localLanguage;

        const targetLangCode = this.getAzureLanguageCode(localLanguage);
        this.log('info', `Starting transcription for ${remoteParticipants.length} participant(s), target: ${targetLangCode}`);

        let startedCount = 0;

        for (const participant of remoteParticipants) {
            const { connectionId, language, audioTrack } = participant;

            if (!audioTrack) {
                this.log('warn', `Skipping ${connectionId}: no audio track`);
                continue;
            }

            if (this.activeTranscribers.has(connectionId)) {
                this.log('info', `Skipping ${connectionId}: already has transcriber`);
                continue;
            }

            const sourceLangCode = this.getAzureLanguageCode(language);
            this.log('info', `Creating transcriber: ${sourceLangCode} → ${targetLangCode} for ${connectionId}`);

            try {
                // Create speech config for translation
                const speechConfig = SpeechSDK.SpeechTranslationConfig.fromSubscription(
                    this.subscriptionKey, 
                    this.serviceRegion
                );
                speechConfig.speechRecognitionLanguage = sourceLangCode;
                speechConfig.addTargetLanguage(this.getShortLanguageCode(targetLangCode));

                // Create audio config from the participant's audio track
                const mediaStream = new MediaStream();
                mediaStream.addTrack(audioTrack);
                const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(mediaStream);

                // Create translation recognizer
                const recognizer = new SpeechSDK.TranslationRecognizer(speechConfig, audioConfig);

                const targetLangShort = this.getShortLanguageCode(targetLangCode);

                // Handle interim results (live captions)
                recognizer.recognizing = (s, e) => {
                    const translation = e.result.translations.get(targetLangShort);
                    if (translation && this.onCaptionUpdate) {
                        this.onCaptionUpdate(connectionId, translation, false);
                    }
                };

                // Handle final results
                recognizer.recognized = (s, e) => {
                    const translation = e.result.translations.get(targetLangShort);
                    if (translation && this.onCaptionUpdate) {
                        this.onCaptionUpdate(connectionId, translation, true);
                    }
                };

                // Handle errors
                recognizer.canceled = (s, e) => {
                    this.log('warn', `Transcription canceled for ${connectionId}: ${e.errorDetails}`);
                };

                // Start continuous recognition
                recognizer.startContinuousRecognitionAsync(
                    () => {
                        this.log('info', `Transcriber started for ${connectionId}`);
                    },
                    (err) => {
                        this.log('error', `Failed to start transcriber for ${connectionId}: ${err}`);
                    }
                );

                // Store the transcriber
                this.activeTranscribers.set(connectionId, {
                    recognizer,
                    language,
                    speechConfig,
                    audioConfig
                });

                startedCount++;

            } catch (error) {
                this.log('error', `Failed to create transcriber for ${connectionId}: ${error.message}`);
            }
        }

        if (startedCount > 0) {
            this.isActive = true;
            this.log('info', `Started ${startedCount} transcriber(s)`);
            return true;
        } else {
            this.log('info', 'No transcribers started');
            return false;
        }
    }

    /**
     * Add transcriber for a new participant
     */
    async addParticipant(participant) {
        if (!this.isActive) return false;

        const { connectionId, language, audioTrack } = participant;

        if (!audioTrack) {
            this.log('warn', `Cannot add ${connectionId}: no audio track`);
            return false;
        }

        if (this.activeTranscribers.has(connectionId)) {
            return false;
        }

        const sourceLangCode = this.getAzureLanguageCode(language);
        const targetLangCode = this.getAzureLanguageCode(this.localLanguage);
        const targetLangShort = this.getShortLanguageCode(targetLangCode);

        this.log('info', `Adding transcriber for new participant: ${sourceLangCode} → ${targetLangCode}`);

        try {
            const speechConfig = SpeechSDK.SpeechTranslationConfig.fromSubscription(
                this.subscriptionKey, 
                this.serviceRegion
            );
            speechConfig.speechRecognitionLanguage = sourceLangCode;
            speechConfig.addTargetLanguage(targetLangShort);

            const mediaStream = new MediaStream();
            mediaStream.addTrack(audioTrack);
            const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(mediaStream);

            const recognizer = new SpeechSDK.TranslationRecognizer(speechConfig, audioConfig);

            recognizer.recognizing = (s, e) => {
                const translation = e.result.translations.get(targetLangShort);
                if (translation && this.onCaptionUpdate) {
                    this.onCaptionUpdate(connectionId, translation, false);
                }
            };

            recognizer.recognized = (s, e) => {
                const translation = e.result.translations.get(targetLangShort);
                if (translation && this.onCaptionUpdate) {
                    this.onCaptionUpdate(connectionId, translation, true);
                }
            };

            recognizer.canceled = (s, e) => {
                this.log('warn', `Transcription canceled for ${connectionId}: ${e.errorDetails}`);
            };

            recognizer.startContinuousRecognitionAsync();

            this.activeTranscribers.set(connectionId, {
                recognizer,
                language,
                speechConfig,
                audioConfig
            });

            this.log('info', `Transcriber added for ${connectionId}`);
            return true;

        } catch (error) {
            this.log('error', `Failed to add transcriber for ${connectionId}: ${error.message}`);
            return false;
        }
    }

    /**
     * Remove transcriber for a participant
     */
    removeParticipant(connectionId) {
        const transcriber = this.activeTranscribers.get(connectionId);
        if (!transcriber) return;

        this.log('info', `Removing transcriber for ${connectionId}`);

        try {
            transcriber.recognizer.stopContinuousRecognitionAsync(
                () => {
                    transcriber.recognizer.close();
                },
                (err) => {
                    this.log('warn', `Error stopping transcriber for ${connectionId}: ${err}`);
                }
            );
        } catch (e) {
            this.log('warn', `Error cleaning up transcriber: ${e.message}`);
        }

        this.activeTranscribers.delete(connectionId);

        // Clear caption for this participant
        if (this.onCaptionUpdate) {
            this.onCaptionUpdate(connectionId, '', true);
        }

        if (this.activeTranscribers.size === 0 && this.isActive) {
            this.isActive = false;
            this.log('info', 'All transcribers stopped');
        }
    }

    /**
     * Stop all transcribers
     */
    stop() {
        this.log('info', 'Stopping all transcribers');

        for (const [connectionId, transcriber] of this.activeTranscribers) {
            try {
                transcriber.recognizer.stopContinuousRecognitionAsync(
                    () => {
                        transcriber.recognizer.close();
                    },
                    (err) => {
                        this.log('warn', `Error stopping transcriber: ${err}`);
                    }
                );
                
                // Clear caption
                if (this.onCaptionUpdate) {
                    this.onCaptionUpdate(connectionId, '', true);
                }
            } catch (e) {
                this.log('warn', `Error cleaning up transcriber: ${e.message}`);
            }
        }

        this.activeTranscribers.clear();
        this.isActive = false;
        this.localLanguage = null;

        this.log('info', 'All transcribers stopped');
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            isActive: this.isActive,
            localLanguage: this.localLanguage,
            activeCount: this.activeTranscribers.size,
            transcribers: Array.from(this.activeTranscribers.keys())
        };
    }
}

// Create singleton instance
const transcriptionManager = new TranscriptionManager();
