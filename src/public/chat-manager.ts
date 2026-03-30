// @ts-nocheck
/**
 * Chat Manager
 * 
 * Manages chat messages using OpenVidu signals with automatic translation
 * to each user's native language using Azure Translator API.
 */

class ChatManager {
    constructor() {
        this.messages = [];
        this.localLanguage = null;
        this.localNickname = null;
        this.session = null;
        this.isOpen = false;
        this.unreadCount = 0;
        this.translationEnabled = true;
        
        // Color palette for participants (earthy tones matching app style)
        this.colorPalette = [
            '#10b981', // emerald
            '#f59e0b', // amber
            '#8b5cf6', // violet
            '#ec4899', // pink
            '#06b6d4', // cyan
            '#f97316', // orange
            '#84cc16', // lime
            '#6366f1', // indigo
        ];
        this.userColors = new Map();
        this.colorIndex = 0;
        
        // Callbacks
        this.onMessage = null;
        this.onUnreadChange = null;
    }

    /**
     * Initialize the chat manager
     */
    initialize(session, localNickname, localLanguage) {
        this.session = session;
        this.localNickname = localNickname;
        this.localLanguage = localLanguage;
        this.messages = [];
        this.unreadCount = 0;
        
        // Assign color to local user
        this.getUserColor(localNickname);
        
        // Listen for incoming chat messages
        this.session.on('signal:chat', async (event) => {
            await this.handleIncomingMessage(event);
        });
        
        console.log('[ChatManager] Initialized');
    }

    /**
     * Get or assign a color for a user
     */
    getUserColor(nickname) {
        if (!this.userColors.has(nickname)) {
            this.userColors.set(nickname, this.colorPalette[this.colorIndex % this.colorPalette.length]);
            this.colorIndex++;
        }
        return this.userColors.get(nickname);
    }

    /**
     * Get language code for Azure Translator (e.g., 'en' stays 'en')
     */
    getTranslatorLanguageCode(code) {
        // Azure Translator uses simple codes like 'en', 'es', 'fr'
        return code.split('-')[0];
    }

    /**
     * Translate text using Azure Translator API via backend
     */
    async translateText(text, targetLanguage) {
        try {
            const response = await fetch(`${CONFIG.BACKEND_URL}/api/translate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    targetLanguage: this.getTranslatorLanguageCode(targetLanguage)
                })
            });
            
            if (!response.ok) {
                console.warn('[ChatManager] Translation failed, using original text');
                return text;
            }
            
            const data = await response.json();
            return data.translatedText || text;
        } catch (error) {
            console.error('[ChatManager] Translation error:', error);
            return text;
        }
    }

    /**
     * Handle incoming chat message
     */
    async handleIncomingMessage(event) {
        try {
            const data = JSON.parse(event.data);
            const senderNickname = data.nickname;
            const originalText = data.message;
            const senderLanguage = data.language;
            const messageId = data.id;
            const timestamp = new Date(data.timestamp);
            
            // Check if we already have this message (avoid duplicates)
            if (this.messages.some(m => m.id === messageId)) {
                return;
            }
            
            // Get or assign color for sender
            const color = this.getUserColor(senderNickname);
            
            // Translate if sender's language is different from local language
            let displayText = originalText;
            if (senderLanguage !== this.localLanguage) {
                displayText = await this.translateText(originalText, this.localLanguage);
            }
            
            const message = {
                id: messageId,
                nickname: senderNickname,
                originalText: originalText,
                displayText: displayText,
                language: senderLanguage,
                color: color,
                timestamp: timestamp,
                isLocal: senderNickname === this.localNickname
            };
            
            this.messages.push(message);
            
            // Update unread count if chat is closed
            if (!this.isOpen) {
                this.unreadCount++;
                if (this.onUnreadChange) {
                    this.onUnreadChange(this.unreadCount);
                }
            }
            
            // Notify listener
            if (this.onMessage) {
                this.onMessage(message);
            }
            
        } catch (error) {
            console.error('[ChatManager] Error handling incoming message:', error);
        }
    }

    /**
     * Send a chat message
     */
    async sendMessage(text) {
        if (!this.session || !text.trim()) {
            return false;
        }
        
        const messageId = this.generateId();
        const timestamp = new Date();
        
        const messageData = {
            id: messageId,
            nickname: this.localNickname,
            message: text.trim(),
            language: this.localLanguage,
            timestamp: timestamp.toISOString()
        };
        
        // Add to local messages BEFORE sending signal (to prevent duplicate when signal comes back)
        const color = this.getUserColor(this.localNickname);
        const localMessage = {
            id: messageId,
            nickname: this.localNickname,
            originalText: text.trim(),
            displayText: text.trim(),
            language: this.localLanguage,
            color: color,
            timestamp: timestamp,
            isLocal: true
        };
        
        this.messages.push(localMessage);
        
        if (this.onMessage) {
            this.onMessage(localMessage);
        }
        
        try {
            // Send via OpenVidu signal to all participants
            await this.session.signal({
                data: JSON.stringify(messageData),
                type: 'chat'
            });
            
            return true;
        } catch (error) {
            console.error('[ChatManager] Error sending message:', error);
            return false;
        }
    }

    /**
     * Generate unique message ID
     */
    generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Set chat panel open state
     */
    setOpen(isOpen) {
        this.isOpen = isOpen;
        if (isOpen) {
            this.unreadCount = 0;
            if (this.onUnreadChange) {
                this.onUnreadChange(0);
            }
        }
    }

    /**
     * Set translation enabled/disabled
     */
    setTranslationEnabled(enabled) {
        this.translationEnabled = enabled;
        // Return messages for UI refresh with appropriate text
        return this.messages.map(msg => ({
            ...msg,
            displayText: enabled ? msg.displayText : msg.originalText
        }));
    }

    /**
     * Check if translation is enabled
     */
    isTranslationEnabled() {
        return this.translationEnabled;
    }

    /**
     * Get display text for a message based on translation setting
     */
    getDisplayText(message) {
        return this.translationEnabled ? message.displayText : message.originalText;
    }

    /**
     * Get all messages
     */
    getMessages() {
        return this.messages;
    }

    /**
     * Clear all messages
     */
    clear() {
        this.messages = [];
        this.unreadCount = 0;
        this.userColors.clear();
        this.colorIndex = 0;
    }

    /**
     * Cleanup
     */
    destroy() {
        this.clear();
        this.session = null;
        this.localNickname = null;
        this.localLanguage = null;
        this.translationEnabled = true;
    }
}

// Create singleton instance
const chatManager = new ChatManager();
