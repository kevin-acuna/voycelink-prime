// @ts-nocheck
/**
 * Audio Processor Module
 * 
 * Handles capturing audio from MediaStreamTrack, converting to PCM16,
 * and sending to WebSocket. Also handles receiving translated audio
 * and playing it back.
 */

class AudioProcessor {
    constructor() {
        this.audioContext = null;
        this.sourceNode = null;
        this.workletNode = null;
        this.gainNode = null;
        this.ws = null;
        this.isProcessing = false;
        this.onLog = null;
        
        // Playback for translated audio
        this.playbackQueue = [];
        this.isPlaying = false;
        
        // Callback for AI speaking state changes
        this.onSpeakingStateChange = null;
        
        // Callback for AI listening state changes (when input speech is detected)
        this.onListeningStateChange = null;
    }

    log(type, message) {
        console.log(`[AudioProcessor] ${message}`);
        if (this.onLog) {
            this.onLog(type, message);
        }
    }

    /**
     * Initialize audio context and connect to WebSocket
     * @param {MediaStreamTrack} audioTrack - The audio track to capture
     * @param {string} wsUrl - WebSocket URL for the interpreter
     * @param {Function} onTranslatedAudio - Callback when translated audio is received
     * @param {Function} onTranscript - Callback for transcripts
     */
    async start(audioTrack, wsUrl, onTranslatedAudio, onTranscript) {
        if (this.isProcessing) {
            this.log('warn', 'Already processing');
            return;
        }

        try {
            // Create AudioContext
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000 // OpenAI expects 24kHz
            });

            // Create a MediaStream from the track
            const mediaStream = new MediaStream([audioTrack]);
            
            // Create source from the media stream
            this.sourceNode = this.audioContext.createMediaStreamSource(mediaStream);

            // Create a ScriptProcessorNode for capturing audio
            // Note: ScriptProcessorNode is deprecated but widely supported
            // AudioWorklet would be better but requires more setup
            const bufferSize = 4096;
            this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

            // Connect the source to the processor
            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);

            // Set up WebSocket connection
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                this.log('info', 'WebSocket connected');
                this.isProcessing = true;
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleServerMessage(data, onTranslatedAudio, onTranscript);
            };

            this.ws.onerror = (error) => {
                this.log('error', 'WebSocket error');
                console.error(error);
            };

            this.ws.onclose = () => {
                this.log('info', 'WebSocket closed');
                this.isProcessing = false;
            };

            // Process audio data
            this.processorNode.onaudioprocess = (event) => {
                if (!this.isProcessing || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    return;
                }

                const inputData = event.inputBuffer.getChannelData(0);
                
                // Convert Float32 to PCM16
                const pcm16 = this.float32ToPcm16(inputData);
                
                // Convert to base64
                const base64 = this.arrayBufferToBase64(pcm16.buffer);
                
                // Send to server
                this.ws.send(JSON.stringify({
                    type: 'audio',
                    data: base64
                }));
            };

            this.log('info', 'Audio capture started');

        } catch (error) {
            this.log('error', `Failed to start: ${error.message}`);
            throw error;
        }
    }

    /**
     * Handle messages from the server
     */
    handleServerMessage(data, onTranslatedAudio, onTranscript) {
        switch (data.type) {
            case 'connected':
                this.log('info', 'Connected to OpenAI');
                break;

            case 'ready':
                this.log('info', 'Interpreter ready');
                break;

            case 'audio':
                // Received translated audio
                if (onTranslatedAudio) {
                    onTranslatedAudio(data.data);
                }
                this.queueAudioForPlayback(data.data);
                break;

            case 'transcript_input':
                if (onTranscript) {
                    onTranscript('input', data.text);
                }
                break;

            case 'transcript_output':
                if (onTranscript) {
                    onTranscript('output', data.text);
                }
                break;

            case 'speech_started':
                this.log('info', 'Speech detected');
                if (this.onListeningStateChange) {
                    this.onListeningStateChange(true);
                }
                break;

            case 'speech_stopped':
                this.log('info', 'Speech ended');
                if (this.onListeningStateChange) {
                    this.onListeningStateChange(false);
                }
                break;

            case 'error':
                this.log('error', `Server error: ${data.message}`);
                break;
        }
    }

    /**
     * Queue translated audio for playback
     */
    queueAudioForPlayback(base64Audio) {
        // Convert base64 to ArrayBuffer
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Convert PCM16 to Float32 for Web Audio
        const pcm16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
            float32[i] = pcm16[i] / 32768;
        }

        this.playbackQueue.push(float32);
        
        if (!this.isPlaying) {
            this.playNextChunk();
        }
    }

    /**
     * Play the next audio chunk in the queue
     */
    playNextChunk() {
        if (this.playbackQueue.length === 0) {
            this.isPlaying = false;
            // Notify that AI stopped speaking
            if (this.onSpeakingStateChange) {
                this.onSpeakingStateChange(false);
            }
            return;
        }

        // Notify that AI started speaking (only on first chunk)
        if (!this.isPlaying && this.onSpeakingStateChange) {
            this.onSpeakingStateChange(true);
        }
        
        this.isPlaying = true;
        const audioData = this.playbackQueue.shift();

        // Create an AudioBuffer
        const audioBuffer = this.audioContext.createBuffer(1, audioData.length, 24000);
        audioBuffer.getChannelData(0).set(audioData);

        // Create a buffer source
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        source.onended = () => {
            this.playNextChunk();
        };

        source.start();
    }

    /**
     * Convert Float32Array to Int16Array (PCM16)
     */
    float32ToPcm16(float32Array) {
        const pcm16 = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return pcm16;
    }

    /**
     * Convert ArrayBuffer to base64
     */
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Stop processing and clean up
     */
    stop() {
        this.isProcessing = false;

        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.playbackQueue = [];
        this.isPlaying = false;

        this.log('info', 'Audio processor stopped');
    }
}

// Export for use in other modules
window.AudioProcessor = AudioProcessor;
