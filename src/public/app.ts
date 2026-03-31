// @ts-nocheck
/**
 * Main Application Controller
 * 
 * Orchestrates the UI and OpenVidu client
 */

// =============================================================================
// Button Click Protection (Prevent Multiple Clicks)
// =============================================================================

/**
 * Track buttons currently processing to prevent double-clicks
 */
const processingButtons = new Set();

/**
 * Wrap an async handler to prevent multiple simultaneous executions
 * Best practice: disable button during action, show loading state
 * @param {HTMLElement} button - The button element
 * @param {Function} handler - Async handler function
 * @param {Object} options - Options for loading state
 */
async function withButtonProtection(button, handler, options = {}) {
    const { loadingText, originalText } = options;
    
    // Prevent multiple clicks
    if (processingButtons.has(button)) {
        return;
    }
    
    processingButtons.add(button);
    button.disabled = true;
    
    // Store original content and show loading state
    const originalContent = button.innerHTML;
    if (loadingText) {
        button.innerHTML = loadingText;
    }
    button.classList.add('processing');
    
    try {
        await handler();
    } finally {
        // Re-enable button
        processingButtons.delete(button);
        button.disabled = false;
        button.innerHTML = originalContent;
        button.classList.remove('processing');
        
        // Refresh Lucide icons if needed
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
}

// =============================================================================
// Audio Notifications
// =============================================================================
let audioContext = null;

/**
 * Play a subtle notification sound when a participant joins
 * Soft, pleasant "ding" inspired by Slack/Teams notifications
 */
function playJoinSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const now = audioContext.currentTime;
        
        // Create a soft bell-like tone
        const osc = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Soft high tone (like a gentle bell)
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
        osc.type = 'sine';
        
        // Very subtle volume - gentle fade in and out
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.06, now + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        
        osc.start(now);
        osc.stop(now + 0.3);
        
    } catch (e) {
        console.log('Could not play notification sound:', e);
    }
}

/**
 * Play a subtle notification sound when a participant leaves
 * Soft descending tone
 */
function playLeaveSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const now = audioContext.currentTime;
        
        const osc = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Soft descending tone
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(500, now + 0.2);
        osc.type = 'sine';
        
        // Very subtle volume
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.06, now + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        
        osc.start(now);
        osc.stop(now + 0.25);
        
    } catch (e) {
        console.log('Could not play notification sound:', e);
    }
}

// =============================================================================
// Application State
// =============================================================================
const appState = {
    sessionId: null,
    nickname: null,
    preferredLanguage: 'en',
    authRole: null,
    authRoomId: null,
    authTokenExpiresAt: null,
    sessionFeatures: {
        chatEnabled: true,
        whiteboardEnabled: true,
        subtitlesEnabled: true,
        aiInterpretationEnabled: false,
    },
    currentPermissions: [],
    currentParticipantId: null,
    isConnected: false,
    isAudioEnabled: true,
    isVideoEnabled: true,
    isInterpreterActive: false,
    isTranscriptionActive: false,
    isChatOpen: false,
    isParticipantsOpen: false,
    isScreenSharing: false,
    screenPublisher: null,
    activeScreenShareConnectionId: null
};

// =============================================================================
// DOM Elements
// =============================================================================
const elements = {
    joinContainer: document.getElementById('joinContainer'),
    conferenceContainer: document.getElementById('conferenceContainer'),
    joinForm: document.getElementById('joinForm'),
    sessionIdInput: document.getElementById('sessionId'),
    nicknameInput: document.getElementById('nickname'),
    languageSelect: document.getElementById('preferredLanguage'),
    connectionStatus: document.getElementById('connectionStatus'),
    videoGrid: document.getElementById('videoGrid'),
    localVideo: document.getElementById('localVideo'),
    localNickname: document.getElementById('localNickname'),
    localLanguage: document.getElementById('localLanguage'),
    currentSessionId: document.getElementById('currentSessionId'),
    participantCount: document.getElementById('participantCount'),
    toggleAudioBtn: document.getElementById('toggleAudio'),
    toggleVideoBtn: document.getElementById('toggleVideo'),
    toggleScreenShareBtn: document.getElementById('toggleScreenShare'),
    leaveSessionBtn: document.getElementById('leaveSession'),
    debugPanel: document.getElementById('debugPanel'),
    audioTracksList: document.getElementById('audioTracksList'),
    eventLog: document.getElementById('eventLog'),
    toggleDebugBtn: document.getElementById('toggleDebug'),
    // AI Interpreter elements
    toggleInterpreterBtn: document.getElementById('toggleInterpreter'),
    // Preview elements
    previewVideo: document.getElementById('previewVideo'),
    previewAvatar: document.getElementById('previewAvatar'),
    previewAvatarInitial: document.getElementById('previewAvatarInitial'),
    previewToggleMic: document.getElementById('previewToggleMic'),
    previewToggleVideo: document.getElementById('previewToggleVideo'),
    microphoneSelect: document.getElementById('microphoneSelect'),
    speakerSelect: document.getElementById('speakerSelect'),
    cameraSelect: document.getElementById('cameraSelect'),
    microphoneLabel: document.getElementById('microphoneLabel'),
    speakerLabel: document.getElementById('speakerLabel'),
    cameraLabel: document.getElementById('cameraLabel'),
    // Room/meeting elements
    homeCard: document.getElementById('homeCard'),
    joinCard: document.getElementById('joinCard'),
    createMeetingBtn: document.getElementById('createMeetingBtn'),
    roomIdDisplay: document.getElementById('roomIdDisplay'),
    shareMeetingBtn: document.getElementById('shareMeetingBtn'),
    // Transcription elements
    toggleTranscriptionBtn: document.getElementById('toggleTranscription'),
    // Chat elements
    toggleChatBtn: document.getElementById('toggleChat'),
    chatPanel: document.getElementById('chatPanel'),
    chatMessages: document.getElementById('chatMessages'),
    chatRecipientSelect: document.getElementById('chatRecipientSelect'),
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn'),
    closeChatBtn: document.getElementById('closeChatBtn'),
    chatBadge: document.getElementById('chatBadge'),
    chatTranslateToggle: document.getElementById('chatTranslateToggle'),
    // Whiteboard elements
    toggleWhiteboardBtn: document.getElementById('toggleWhiteboard'),
    whiteboardWrapper: document.getElementById('whiteboardWrapper'),
    closeWhiteboardBtn: document.getElementById('closeWhiteboardBtn'),
    // Reactions elements
    toggleReactionsBtn: document.getElementById('toggleReactions'),
    reactionsPopup: document.getElementById('reactionsPopup'),
    // Participants panel elements
    toggleParticipantsBtn: document.getElementById('toggleParticipants'),
    participantsPanel: document.getElementById('participantsPanel'),
    participantsList: document.getElementById('participantsList'),
    participantsPanelCount: document.getElementById('participantsPanelCount'),
    closeParticipantsBtn: document.getElementById('closeParticipantsBtn')
};

// Preview state
const previewState = {
    stream: null,
    isAudioEnabled: true,
    isVideoEnabled: true,
    selectedMicId: null,
    selectedCameraId: null,
    selectedSpeakerId: null,
    hasAudioInput: true,
    hasVideoInput: true,
    audioPermission: 'unknown',
    videoPermission: 'unknown'
};

let reconnectTimeoutId = null;
let isLeavingSessionIntentional = false;
let hasHandledConnectionLoss = false;
const ENABLE_LAYOUT_TESTER = CONFIG.DEBUG || window.location.hostname === 'localhost';
const MOCK_PARTICIPANT_PREFIX = 'mock-participant-';
const BOOTSTRAP_COOKIE_NAME = 'voycelink_bootstrap';
const Permission = {
    CREATE_SESSION: 'create_session',
    JOIN_SESSION: 'join_session',
    END_SESSION: 'end_session',
    KICK_PARTICIPANT: 'kick_participant',
    MANAGE_PARTICIPANT_MEDIA: 'manage_participant_media',
    SHARE_SCREEN: 'share_screen',
    PUBLISH_AUDIO: 'publish_audio',
    PUBLISH_VIDEO: 'publish_video',
    SEND_GROUP_CHAT_MESSAGE: 'send_group_chat_message',
    SEND_HOST_DIRECT_MESSAGE: 'send_host_direct_message',
    MANAGE_WHITEBOARD: 'manage_whiteboard',
    USE_WHITEBOARD: 'use_whiteboard',
    UPDATE_ROOM_CONFIGURATION: 'update_room_configuration'
};
let permissionsSocket = null;
let permissionsSocketReconnectTimeoutId = null;
let activeParticipantAccessMenuId = null;

// =============================================================================
// Room Link Functions
// =============================================================================

/**
 * Create a new meeting using the server-assigned bootstrap room ID
 */
async function ensureHostSessionExists(sessionId) {
    const sessionResponse = await apiFetch(`${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSIONS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
    });

    if (!sessionResponse.ok) {
        const error = await sessionResponse.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to create session');
    }

    const sessionData = await sessionResponse.json();
    loadBootstrapSession();
    return sessionData.sessionId;
}

async function createNewMeeting() {
    if (appState.currentPermissions.length === 0) {
        await refreshCurrentPermissions({ silent: true });
    }

    const roomId = appState.authRoomId;
    if (!roomId) {
        showNotification('Unable to create meeting. Please reload the page.', 'error');
        return;
    }

    if (!canCreateMeetings()) {
        showNotification('You do not have permission to create a meeting.', 'error');
        return;
    }

    const resolvedRoomId = await ensureHostSessionExists(roomId);
    
    // Update URL without reloading (using query param for compatibility)
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${resolvedRoomId}`;
    window.history.pushState({ roomId: resolvedRoomId }, '', newUrl);
    
    // Show join form with room ID
    elements.homeCard.style.display = 'none';
    elements.joinCard.style.display = 'block';
    elements.sessionIdInput.value = resolvedRoomId;
    elements.roomIdDisplay.textContent = resolvedRoomId;
    
    // Focus on name input
    elements.nicknameInput.focus();
}

/**
 * Get the meeting URL for current room
 */
function getMeetingUrl() {
    return `${window.location.origin}${window.location.pathname}?room=${appState.sessionId}`;
}

/**
 * Copy the meeting link to clipboard
 */
async function copyMeetingLink() {
    const url = getMeetingUrl();
    
    try {
        await navigator.clipboard.writeText(url);
        
        // Visual feedback
        elements.shareMeetingBtn.classList.add('copied');
        elements.shareMeetingBtn.innerHTML = '<i data-lucide="check"></i>';
        lucide.createIcons();
        
        // Reset after 2 seconds
        setTimeout(() => {
            elements.shareMeetingBtn.classList.remove('copied');
            elements.shareMeetingBtn.innerHTML = '<i data-lucide="link"></i>';
            lucide.createIcons();
        }, 2000);
        
        logEvent('info', `Meeting link copied: ${url}`);
        
    } catch (err) {
        console.error('Failed to copy link:', err);
    }
}

/**
 * Get room ID from URL query parameter
 * URL format: http://localhost:8080/?room=abc-defg-hij
 */
function getRoomIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    
    // Check if it looks like a valid room ID (xxx-xxxx-xxx format)
    if (roomId && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(roomId)) {
        return roomId;
    }
    return null;
}

function hasPermission(permission) {
    return appState.currentPermissions.includes(permission);
}

function canCreateMeetings() {
    return hasPermission(Permission.CREATE_SESSION);
}

function canManageParticipantMedia() {
    return hasPermission(Permission.MANAGE_PARTICIPANT_MEDIA);
}

function canKickParticipants() {
    return hasPermission(Permission.KICK_PARTICIPANT);
}

function canSendGroupMessages() {
    return hasPermission(Permission.SEND_GROUP_CHAT_MESSAGE);
}

function canSendDirectMessages() {
    return hasPermission(Permission.SEND_HOST_DIRECT_MESSAGE);
}

function canPublishAudio() {
    return hasPermission(Permission.PUBLISH_AUDIO);
}

function canPublishVideo() {
    return hasPermission(Permission.PUBLISH_VIDEO);
}

function canShareScreen() {
    return hasPermission(Permission.SHARE_SCREEN);
}

function canManageWhiteboard() {
    return hasPermission(Permission.MANAGE_WHITEBOARD);
}

function canUseWhiteboard() {
    return canManageWhiteboard() || hasPermission(Permission.USE_WHITEBOARD);
}

function canSendAnyChatMessages() {
    return canSendGroupMessages() || canSendDirectMessages();
}

function canModerateChatRecipients() {
    return appState.authRole === 'host' || appState.authRole === 'co_host';
}

function canManageConferenceUi() {
    return (
        hasPermission(Permission.UPDATE_ROOM_CONFIGURATION) ||
        canManageWhiteboard()
    );
}

function isInterpreterFeatureEnabled() {
    return appState.sessionFeatures.aiInterpretationEnabled !== false;
}

function isSubtitlesFeatureEnabled() {
    return appState.sessionFeatures.subtitlesEnabled !== false;
}

function setElementVisibility(element, isVisible, displayMode = '') {
    if (!element) return;
    element.style.display = isVisible ? displayMode : 'none';
}

function applyPermissionBasedUi() {
    const canCreateMeeting = canCreateMeetings();
    const isInConference = elements.conferenceContainer.style.display !== 'none';
    const isOnHomeView = elements.homeCard.style.display !== 'none';

    if (isOnHomeView) {
        setElementVisibility(elements.createMeetingBtn, canCreateMeeting, '');
    }

    if (isInConference) {
        setElementVisibility(elements.toggleInterpreterBtn, isInterpreterFeatureEnabled(), '');
        setElementVisibility(elements.toggleTranscriptionBtn, isSubtitlesFeatureEnabled(), '');
        setElementVisibility(elements.toggleScreenShareBtn, canShareScreen(), '');
        setElementVisibility(elements.toggleWhiteboardBtn, canManageWhiteboard(), '');
        setElementVisibility(elements.toggleReactionsBtn, canSendGroupMessages(), '');
        elements.toggleAudioBtn.disabled = !canPublishAudio();
        elements.toggleVideoBtn.disabled = !canPublishVideo();
        elements.sendChatBtn.disabled = !canSendAnyChatMessages();
        elements.chatInput.disabled = !canSendAnyChatMessages();
        if (elements.chatRecipientSelect) {
            elements.chatRecipientSelect.disabled = !canSendAnyChatMessages();
        }
        elements.chatInput.placeholder = canSendAnyChatMessages()
            ? 'Type a message...'
            : 'Messaging is disabled for your access level';

        if (!canSendGroupMessages()) {
            hideReactionsPopup();
        }
    }

    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
}

function getDefaultParticipantPermissionState() {
    return {
        audioEnabled: false,
        videoEnabled: false,
        screenShareEnabled: false,
        whiteboardEnabled: false,
    };
}

function updateParticipantPermissionState(connectionId, permissions = {}) {
    const participant = participantsData.get(connectionId);
    if (!participant) {
        return;
    }

    participant.permissions = {
        ...(participant.permissions || getDefaultParticipantPermissionState()),
        ...permissions,
    };

    participantsData.set(connectionId, participant);

    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
}

async function updateParticipantPermissions(connectionId, permissionsPatch) {
    if (!appState.sessionId) {
        showNotification('No active session available.', 'error');
        return;
    }

    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.PARTICIPANT_PERMISSIONS(appState.sessionId, connectionId)}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(permissionsPatch),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to update participant permissions');
    }

    const payload = await response.json();
    updateParticipantPermissionState(connectionId, payload.permissions || permissionsPatch);
    return payload;
}

function toggleParticipantAccessMenu(connectionId) {
    activeParticipantAccessMenuId =
        activeParticipantAccessMenuId === connectionId ? null : connectionId;
    renderParticipantsList();
}

function closeParticipantAccessMenu() {
    if (!activeParticipantAccessMenuId) {
        return;
    }

    activeParticipantAccessMenuId = null;
    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
}

async function handleParticipantAccessAction(connectionId, action) {
    const actionMap = {
        enableMedia: { mediaEnabled: true },
        disableMedia: { mediaEnabled: false },
        enableScreenShare: { screenShareEnabled: true },
        disableScreenShare: { screenShareEnabled: false },
        enableWhiteboard: { whiteboardEnabled: true },
        disableWhiteboard: { whiteboardEnabled: false },
    };

    const patch = actionMap[action];
    if (!patch) {
        return;
    }

    await updateParticipantPermissions(connectionId, patch);
    closeParticipantAccessMenu();
    showNotification('Participant access updated.', 'info');
}

async function handleParticipantPermissionToggle(connectionId, permissionKey, enabled) {
    try {
        await updateParticipantPermissions(connectionId, {
            [permissionKey]: enabled,
        });
        showNotification('Participant permissions updated.', 'info');
    } catch (error) {
        showNotification(error.message || 'Failed to update participant permissions.', 'error');
        renderParticipantsList();
    }
}

async function enforceCurrentPermissions() {
    if (typeof whiteboardManager.setAccess === 'function') {
        whiteboardManager.setAccess({
            canManage: canManageWhiteboard(),
            canDraw: canUseWhiteboard(),
        });
    }

    if (!openviduClient.publisher) {
        return;
    }

    if (!canPublishAudio() && appState.isAudioEnabled && localPublisherHasTrack('audio')) {
        appState.isAudioEnabled = openviduClient.toggleAudio();
        elements.toggleAudioBtn.classList.add('muted');
        elements.toggleAudioBtn.innerHTML = '<i data-lucide="mic-off"></i>';
    }

    if (!canPublishVideo() && appState.isVideoEnabled && localPublisherHasTrack('video')) {
        appState.isVideoEnabled = openviduClient.toggleVideo();
        elements.toggleVideoBtn.classList.add('muted');
        elements.toggleVideoBtn.innerHTML = '<i data-lucide="video-off"></i>';
        const localWrapper = document.getElementById('localVideoWrapper');
        const localAvatar = document.getElementById('localAvatar');
        if (localWrapper && localAvatar) {
            localWrapper.classList.add('camera-off');
            localAvatar.classList.add('visible');
        }
    }

    if (!canShareScreen() && appState.isScreenSharing) {
        await stopScreenShare();
    }

    lucide.createIcons();
}

/**
 * Initialize the page based on URL
 */
function initializePage() {
    const roomId = getRoomIdFromUrl();
    const bootstrapRoomId = appState.authRoomId;
    
    if (roomId) {
        const effectiveRoomId = bootstrapRoomId || roomId;
        if (bootstrapRoomId && roomId !== bootstrapRoomId) {
            const newUrl = `${window.location.origin}${window.location.pathname}?room=${bootstrapRoomId}`;
            window.history.replaceState({ roomId: bootstrapRoomId }, '', newUrl);
        }
        elements.homeCard.style.display = 'none';
        elements.joinCard.style.display = 'block';
        elements.sessionIdInput.value = effectiveRoomId;
        elements.roomIdDisplay.textContent = effectiveRoomId;
    } else {
        // No room - show create meeting button
        elements.homeCard.style.display = 'block';
        elements.joinCard.style.display = 'none';
    }

    applyPermissionBasedUi();
}

function resolveBoundSessionId(sessionId) {
    if (appState.authRoomId && sessionId !== appState.authRoomId) {
        return appState.authRoomId;
    }

    return sessionId;
}

function getCookieValue(name) {
    const cookiePrefix = `${name}=`;
    const match = document.cookie
        .split(';')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(cookiePrefix));

    if (!match) {
        return null;
    }

    return decodeURIComponent(match.slice(cookiePrefix.length));
}

function loadBootstrapSession() {
    const rawBootstrapCookie = getCookieValue(BOOTSTRAP_COOKIE_NAME);
    if (!rawBootstrapCookie) {
        appState.authRole = null;
        appState.authRoomId = null;
        appState.authTokenExpiresAt = null;
        appState.currentPermissions = [];
        applyPermissionBasedUi();
        return;
    }

    try {
        const authSession = JSON.parse(rawBootstrapCookie);
        appState.authRole = authSession.role || null;
        appState.authRoomId = authSession.roomId || null;
        appState.authTokenExpiresAt = authSession.expiresAt || null;
    } catch (error) {
        appState.authRole = null;
        appState.authRoomId = null;
        appState.authTokenExpiresAt = null;
        appState.currentPermissions = [];
    }

    applyPermissionBasedUi();
}

async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: 'same-origin',
    });

    const shouldShowAuthExpiredNotice =
        !options.suppressAuthExpiredNotice &&
        !appState.isConnected &&
        elements.conferenceContainer.style.display === 'none';

    if (response.status === 401 && shouldShowAuthExpiredNotice) {
        showNotification('Your access session expired. Reload the page to continue.', 'error');
    }

    return response;
}

window.voycelinkApiFetch = apiFetch;

async function refreshCurrentPermissions(options = {}) {
    const { silent = false } = options;

    if (!appState.authRoomId && !getCookieValue(BOOTSTRAP_COOKIE_NAME)) {
        appState.currentPermissions = [];
        applyPermissionBasedUi();
        return null;
    }

    try {
        const permissionsUrl = new URL(
            `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.MY_PERMISSIONS}`,
            window.location.origin
        );

        if (appState.currentParticipantId) {
            permissionsUrl.searchParams.set('participantId', appState.currentParticipantId);
        }

        const response = await apiFetch(permissionsUrl.toString());
        if (!response.ok) {
            if (!silent) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.details || 'Failed to load permissions');
            }
            return null;
        }

        const authorization = await response.json();
        appState.authRole = authorization.role || appState.authRole;
        appState.authRoomId = authorization.roomId || appState.authRoomId;
        appState.sessionFeatures = authorization.session || appState.sessionFeatures;
        appState.currentPermissions = Array.isArray(authorization.permissions)
            ? authorization.permissions
            : [];
        loadBootstrapSession();
        applyPermissionBasedUi();
        await enforceCurrentPermissions();
        return authorization;
    } catch (error) {
        if (!silent) {
            showNotification(error.message || 'Failed to load permissions.', 'error');
        }
        return null;
    }
}

function getPermissionsWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(`${protocol}//${window.location.host}/ws/permissions`);
    if (appState.authRoomId) {
        url.searchParams.set('roomId', appState.authRoomId);
    }
    if (appState.currentParticipantId) {
        url.searchParams.set('participantId', appState.currentParticipantId);
    }
    return url.toString();
}

function disconnectPermissionsWebSocket() {
    if (permissionsSocketReconnectTimeoutId) {
        clearTimeout(permissionsSocketReconnectTimeoutId);
        permissionsSocketReconnectTimeoutId = null;
    }

    if (!permissionsSocket) {
        return;
    }

    permissionsSocket.close();
    permissionsSocket = null;
}

function connectPermissionsWebSocket() {
    if (permissionsSocket || !appState.authRoomId) {
        return;
    }

    permissionsSocket = new WebSocket(getPermissionsWebSocketUrl());

    permissionsSocket.addEventListener('message', async (event) => {
        try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'connected') {
                logEvent('info', 'Access updates channel connected');
                return;
            }

            if (payload.type !== 'participant_access_updated') {
                return;
            }

            if (payload.sessionId !== appState.authRoomId) {
                return;
            }

            updateParticipantPermissionState(payload.participantId, payload.permissions || {});

            if (!appState.currentParticipantId || payload.participantId !== appState.currentParticipantId) {
                return;
            }

            await refreshCurrentPermissions({ silent: true });
            showNotification('Your session access was updated.', 'info');
        } catch (error) {
            console.error('Error processing permissions WebSocket message:', error);
        }
    });

    permissionsSocket.addEventListener('open', () => {
        logEvent('info', 'Access updates channel opened');
    });

    permissionsSocket.addEventListener('close', () => {
        permissionsSocket = null;
        if (appState.isConnected) {
            permissionsSocketReconnectTimeoutId = setTimeout(() => {
                connectPermissionsWebSocket();
            }, 1500);
        }
    });

    permissionsSocket.addEventListener('error', () => {
        logEvent('warn', 'Access updates channel error');
        permissionsSocket = null;
    });
}


// =============================================================================
// API Functions
// =============================================================================

/**
 * Request a session and connection token from the backend
 */
async function getToken(sessionId, nickname, preferredLanguage) {
    let resolvedSessionId = resolveBoundSessionId(sessionId);

    if (appState.currentPermissions.length === 0) {
        await refreshCurrentPermissions({ silent: true });
    }

    if (canCreateMeetings()) {
        const sessionResponse = await apiFetch(`${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSIONS}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: resolvedSessionId })
        });
        
        if (!sessionResponse.ok) {
            const error = await sessionResponse.json();
            throw new Error(error.details || 'Failed to create session');
        }
        
        const sessionData = await sessionResponse.json();
        loadBootstrapSession();
        await refreshCurrentPermissions({ silent: true });
        resolvedSessionId = sessionData.sessionId;
    }
    
    // Step 2: Get connection token
    const tokenResponse = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.CONNECTIONS(resolvedSessionId)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname, preferredLanguage })
        }
    );
    
    if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        throw new Error(error.details || 'Failed to get connection token');
    }
    
    const tokenData = await tokenResponse.json();
    loadBootstrapSession();
    await refreshCurrentPermissions({ silent: true });
    
    return {
        sessionId: resolvedSessionId,
        token: tokenData.token
    };
}

// =============================================================================
// Preview Functions
// =============================================================================

/**
 * Initialize preview - enumerate devices and start video preview
 */
async function initPreview() {
    try {
        // Enumerate devices
        await enumerateDevices();
        await requestAvailableDevicePermissions();
        
        // Start preview with default devices
        await startPreview();
        
        // Update avatar initial when nickname changes
        elements.nicknameInput.addEventListener('input', updatePreviewAvatar);
        
    } catch (error) {
        console.error('Error initializing preview:', error);
        elements.previewAvatar.classList.add('visible');
    }
}

/**
 * Clean device label by removing ID codes like (0020:0b21)
 */
function cleanDeviceLabel(label) {
    if (!label) return null;
    // Remove patterns like (0020:0b21) or (046d:085b) at the end
    return label.replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)\s*$/, '').trim();
}

function isPermissionDeniedError(error) {
    return error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
}

function getDeviceAccessError(kind) {
    const isAudio = kind === 'audio';
    const hasDevice = isAudio ? previewState.hasAudioInput : previewState.hasVideoInput;
    const permission = isAudio ? previewState.audioPermission : previewState.videoPermission;

    if (!hasDevice) {
        return isAudio
            ? 'No microphone detected'
            : 'No camera detected';
    }

    if (permission === 'denied') {
        return isAudio
            ? 'Microphone access is blocked. Enable it in your browser site settings.'
            : 'Camera access is blocked. Enable it in your browser site settings.';
    }

    return null;
}

async function requestAvailableDevicePermissions() {
    if (previewState.hasAudioInput) {
        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            previewState.audioPermission = 'granted';
            audioStream.getTracks().forEach(track => track.stop());
        } catch (error) {
            if (isPermissionDeniedError(error)) {
                previewState.audioPermission = 'denied';
                previewState.isAudioEnabled = false;
            }
            console.error('Error requesting microphone permissions:', error);
        }
    }

    if (previewState.hasVideoInput) {
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
            previewState.videoPermission = 'granted';
            videoStream.getTracks().forEach(track => track.stop());
        } catch (error) {
            if (isPermissionDeniedError(error)) {
                previewState.videoPermission = 'denied';
                previewState.isVideoEnabled = false;
            }
            console.error('Error requesting camera permissions:', error);
        }
    }

    await enumerateDevices();
    await syncDevicePermissionStates();
}

async function syncDevicePermissionStates() {
    if (!navigator.permissions?.query) {
        return;
    }

    try {
        if (previewState.hasAudioInput) {
            const audioPermission = await navigator.permissions.query({ name: 'microphone' });
            previewState.audioPermission = audioPermission.state;
            if (audioPermission.state === 'denied') {
                previewState.isAudioEnabled = false;
            }
        }

        if (previewState.hasVideoInput) {
            const videoPermission = await navigator.permissions.query({ name: 'camera' });
            previewState.videoPermission = videoPermission.state;
            if (videoPermission.state === 'denied') {
                previewState.isVideoEnabled = false;
            }
        }
    } catch (error) {
        console.error('Error querying media permissions:', error);
    } finally {
        updateMediaAvailabilityUI();
    }
}

async function requestDevicePermission(kind) {
    const isAudio = kind === 'audio';
    const hasDevice = isAudio ? previewState.hasAudioInput : previewState.hasVideoInput;

    if (!hasDevice) {
        showNotification(getDeviceAccessError(kind), 'error');
        return false;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia(
            isAudio ? { audio: true, video: false } : { audio: false, video: true }
        );
        stream.getTracks().forEach(track => track.stop());

        if (isAudio) {
            previewState.audioPermission = 'granted';
        } else {
            previewState.videoPermission = 'granted';
        }

        await enumerateDevices();
        await syncDevicePermissionStates();
        return true;
    } catch (error) {
        if (isPermissionDeniedError(error)) {
            if (isAudio) {
                previewState.audioPermission = 'denied';
                previewState.isAudioEnabled = false;
            } else {
                previewState.videoPermission = 'denied';
                previewState.isVideoEnabled = false;
            }
            updateMediaAvailabilityUI();
        }

        console.error(`Error requesting ${kind} permission:`, error);
        showNotification(getDeviceAccessError(kind) || 'Device permission not granted', 'error');
        return false;
    }
}

/**
 * Enumerate available media devices
 */
async function enumerateDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const microphones = devices.filter(d => d.kind === 'audioinput');
        const speakers = devices.filter(d => d.kind === 'audiooutput');
        const cameras = devices.filter(d => d.kind === 'videoinput');

        previewState.hasAudioInput = microphones.length > 0;
        previewState.hasVideoInput = cameras.length > 0;
        if (!previewState.hasAudioInput) previewState.audioPermission = 'unknown';
        if (!previewState.hasVideoInput) previewState.videoPermission = 'unknown';
        
        // Populate microphone select
        elements.microphoneSelect.innerHTML = microphones.length > 0
            ? microphones.map((mic, i) => 
                `<option value="${mic.deviceId}">${cleanDeviceLabel(mic.label) || `Microphone ${i + 1}`}</option>`
            ).join('')
            : '<option value="">No microphone detected</option>';
        
        // Populate speaker select
        if (speakers.length > 0) {
            elements.speakerSelect.innerHTML = speakers.map((speaker, i) => 
                `<option value="${speaker.deviceId}">${cleanDeviceLabel(speaker.label) || `Speaker ${i + 1}`}</option>`
            ).join('');
        } else {
            elements.speakerSelect.innerHTML = '<option value="">Default speaker</option>';
        }
        
        // Populate camera select
        elements.cameraSelect.innerHTML = cameras.length > 0
            ? cameras.map((cam, i) => 
                `<option value="${cam.deviceId}">${cleanDeviceLabel(cam.label) || `Camera ${i + 1}`}</option>`
            ).join('')
            : '<option value="">No camera detected</option>';
        
        // Store selected devices
        previewState.selectedMicId = microphones.length > 0 ? microphones[0].deviceId : null;
        previewState.selectedCameraId = cameras.length > 0 ? cameras[0].deviceId : null;
        if (speakers.length > 0) previewState.selectedSpeakerId = speakers[0].deviceId;
        if (!previewState.hasAudioInput) previewState.isAudioEnabled = false;
        if (!previewState.hasVideoInput) previewState.isVideoEnabled = false;
        if (previewState.audioPermission === 'denied') previewState.isAudioEnabled = false;
        if (previewState.videoPermission === 'denied') previewState.isVideoEnabled = false;
        
        // Update visible labels
        updateDeviceLabels();
        updateMediaAvailabilityUI();
        
    } catch (error) {
        console.error('Error enumerating devices:', error);
    }
}

/**
 * Start video/audio preview
 */
async function startPreview() {
    try {
        // Stop existing stream
        if (previewState.stream) {
            previewState.stream.getTracks().forEach(track => track.stop());
            previewState.stream = null;
        }
        
        const constraints = {
            video: previewState.hasVideoInput && previewState.videoPermission === 'granted' && previewState.isVideoEnabled ? {
                deviceId: previewState.selectedCameraId ? { exact: previewState.selectedCameraId } : undefined
            } : false,
            audio: previewState.hasAudioInput && previewState.audioPermission === 'granted' ? {
                deviceId: previewState.selectedMicId ? { exact: previewState.selectedMicId } : undefined
            } : false
        };

        if (!constraints.audio && !constraints.video) {
            elements.previewVideo.srcObject = null;
            updatePreviewVideoState();
            return;
        }
        
        previewState.stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Set video element source
        elements.previewVideo.srcObject = previewState.stream;
        
        // Update audio track state
        const audioTrack = previewState.stream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = previewState.isAudioEnabled;
        }
        
        // Update avatar visibility
        updatePreviewVideoState();
        
    } catch (error) {
        if (isPermissionDeniedError(error)) {
            if (previewState.isAudioEnabled) {
                previewState.audioPermission = 'denied';
                previewState.isAudioEnabled = false;
            }
            if (previewState.isVideoEnabled) {
                previewState.videoPermission = 'denied';
                previewState.isVideoEnabled = false;
            }
            updateMediaAvailabilityUI();
        }
        console.error('Error starting preview:', error);
        elements.previewAvatar.classList.add('visible');
    }
}

/**
 * Stop preview stream
 */
function stopPreview() {
    if (previewState.stream) {
        previewState.stream.getTracks().forEach(track => track.stop());
        previewState.stream = null;
    }
    elements.previewVideo.srcObject = null;
}

/**
 * Toggle preview microphone
 */
async function togglePreviewMic() {
    if (!previewState.isAudioEnabled && previewState.audioPermission !== 'granted') {
        const granted = await requestDevicePermission('audio');
        if (!granted) return;
    }

    const audioError = getDeviceAccessError('audio');
    if (audioError) {
        showNotification(audioError, 'error');
        return;
    }

    previewState.isAudioEnabled = !previewState.isAudioEnabled;
    
    if (previewState.stream) {
        const audioTrack = previewState.stream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = previewState.isAudioEnabled;
        }
    }
    
    elements.previewToggleMic.classList.toggle('muted', !previewState.isAudioEnabled);
    elements.previewToggleMic.innerHTML = previewState.isAudioEnabled 
        ? '<i data-lucide="mic"></i>' 
        : '<i data-lucide="mic-off"></i>';
    lucide.createIcons();
}

/**
 * Toggle preview camera
 */
async function togglePreviewVideo() {
    if (!previewState.isVideoEnabled && previewState.videoPermission !== 'granted') {
        const granted = await requestDevicePermission('video');
        if (!granted) return;
    }

    const videoError = getDeviceAccessError('video');
    if (videoError) {
        showNotification(videoError, 'error');
        return;
    }

    previewState.isVideoEnabled = !previewState.isVideoEnabled;
    
    elements.previewToggleVideo.classList.toggle('muted', !previewState.isVideoEnabled);
    elements.previewToggleVideo.innerHTML = previewState.isVideoEnabled 
        ? '<i data-lucide="video"></i>' 
        : '<i data-lucide="video-off"></i>';
    lucide.createIcons();
    
    // Restart preview with new video state
    await startPreview();
}

/**
 * Update preview video/avatar state
 */
function updatePreviewVideoState() {
    if (previewState.isVideoEnabled && previewState.stream && previewState.stream.getVideoTracks().length > 0) {
        elements.previewAvatar.classList.remove('visible');
    } else {
        elements.previewAvatar.classList.add('visible');
    }
}

/**
 * Update preview avatar initial based on nickname input
 */
function updatePreviewAvatar() {
    const nickname = elements.nicknameInput.value.trim();
    const initial = nickname ? nickname.charAt(0).toUpperCase() : '?';
    elements.previewAvatarInitial.textContent = initial;
}

/**
 * Update visible device labels
 */
function updateDeviceLabels() {
    const micOption = elements.microphoneSelect.options[elements.microphoneSelect.selectedIndex];
    const speakerOption = elements.speakerSelect.options[elements.speakerSelect.selectedIndex];
    const cameraOption = elements.cameraSelect.options[elements.cameraSelect.selectedIndex];
    
    elements.microphoneLabel.textContent = micOption ? micOption.text : 'No microphone';
    elements.speakerLabel.textContent = speakerOption ? speakerOption.text : 'No speaker';
    elements.cameraLabel.textContent = cameraOption ? cameraOption.text : 'No camera';
}

function updateMediaAvailabilityUI() {
    const audioUnavailable = !previewState.hasAudioInput;
    const videoUnavailable = !previewState.hasVideoInput;
    const audioPermissionDenied = previewState.audioPermission === 'denied';
    const videoPermissionDenied = previewState.videoPermission === 'denied';

    elements.previewToggleMic.disabled = false;
    elements.previewToggleVideo.disabled = false;
    elements.toggleAudioBtn.disabled = false;
    elements.toggleVideoBtn.disabled = false;
    elements.microphoneSelect.disabled = audioUnavailable;
    elements.cameraSelect.disabled = videoUnavailable;

    elements.previewToggleMic.title = audioUnavailable
        ? 'No microphone detected'
        : audioPermissionDenied
        ? 'Microphone permission denied'
        : 'Toggle Microphone';
    elements.previewToggleVideo.title = videoUnavailable
        ? 'No camera detected'
        : videoPermissionDenied
        ? 'Camera permission denied'
        : 'Toggle Camera';
    elements.toggleAudioBtn.title = audioUnavailable
        ? 'No microphone detected'
        : audioPermissionDenied
        ? 'Microphone permission denied'
        : 'Toggle Microphone';
    elements.toggleVideoBtn.title = videoUnavailable
        ? 'No camera detected'
        : videoPermissionDenied
        ? 'Camera permission denied'
        : 'Toggle Camera';

    elements.previewToggleMic.classList.toggle('muted', audioUnavailable || audioPermissionDenied || !previewState.isAudioEnabled);
    elements.previewToggleVideo.classList.toggle('muted', videoUnavailable || videoPermissionDenied || !previewState.isVideoEnabled);
    elements.toggleAudioBtn.classList.toggle('muted', audioUnavailable || audioPermissionDenied || !appState.isAudioEnabled);
    elements.toggleVideoBtn.classList.toggle('muted', videoUnavailable || videoPermissionDenied || !appState.isVideoEnabled);

    if (audioUnavailable || audioPermissionDenied) {
        elements.previewToggleMic.innerHTML = '<i data-lucide="mic-off"></i>';
        elements.toggleAudioBtn.innerHTML = '<i data-lucide="mic-off"></i>';
    }

    if (videoUnavailable || videoPermissionDenied) {
        elements.previewToggleVideo.innerHTML = '<i data-lucide="video-off"></i>';
        elements.toggleVideoBtn.innerHTML = '<i data-lucide="video-off"></i>';
    }

    lucide.createIcons();
}

function localPublisherHasTrack(kind) {
    if (!openviduClient.publisher || !openviduClient.publisher.stream) {
        return false;
    }

    const mediaStream = openviduClient.publisher.stream.getMediaStream();
    if (!mediaStream) {
        return false;
    }

    return kind === 'audio'
        ? mediaStream.getAudioTracks().length > 0
        : mediaStream.getVideoTracks().length > 0;
}

async function publishLocalStreamWithCurrentPermissions() {
    const canPublishAudio =
        previewState.hasAudioInput && previewState.audioPermission === 'granted';
    const canPublishVideo =
        previewState.hasVideoInput && previewState.videoPermission === 'granted';

    if (!canPublishAudio && !canPublishVideo) {
        return false;
    }

    if (openviduClient.publisher && openviduClient.session) {
        try {
            openviduClient.session.unpublish(openviduClient.publisher);
        } catch (error) {
            console.error('Error unpublishing local stream:', error);
        }
        openviduClient.publisher = null;
    }

    const publishOptions = {
        audioSource: canPublishAudio ? previewState.selectedMicId || undefined : false,
        videoSource: canPublishVideo ? previewState.selectedCameraId || undefined : false,
        publishAudio: appState.isAudioEnabled,
        publishVideo: appState.isVideoEnabled
    };

    await openviduClient.publish(elements.localVideo, publishOptions);

    if (openviduClient.publisher && openviduClient.publisher.stream) {
        const mediaStream = openviduClient.publisher.stream.getMediaStream();
        if (mediaStream) {
            setupLocalSpeakingDetection(mediaStream);
        }
    }

    return true;
}

/**
 * Handle device selection change
 */
async function handleDeviceChange(type) {
    switch (type) {
        case 'microphone':
            previewState.selectedMicId = elements.microphoneSelect.value;
            await startPreview();
            break;
        case 'camera':
            previewState.selectedCameraId = elements.cameraSelect.value;
            await startPreview();
            break;
        case 'speaker':
            previewState.selectedSpeakerId = elements.speakerSelect.value;
            // Speaker change doesn't need preview restart
            break;
    }
    // Update visible labels
    updateDeviceLabels();
}

// =============================================================================
// UI Functions
// =============================================================================

function updateConnectionStatus(connected) {
    appState.isConnected = connected;
    elements.connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
    elements.connectionStatus.classList.toggle('connected', connected);
    elements.connectionStatus.style.background = '';
}

/**
 * Generate a random earthy/brown color
 */
function generateEarthyColor() {
    const earthyColors = [
        '#8B4513', // Saddle Brown
        '#A0522D', // Sienna
        '#6B4423', // Kobicha
        '#8B5A2B', // Tan4
        '#704214', // Sepia
        '#5C4033', // Dark Brown
        '#7B3F00', // Chocolate
        '#654321', // Dark Brown
        '#80461B', // Russet
        '#6F4E37', // Coffee
        '#4A3728', // Taupe
        '#8B7355', // Burlywood4
        '#7B5544', // Pastel Brown
        '#826644', // Raw Umber
    ];
    return earthyColors[Math.floor(Math.random() * earthyColors.length)];
}

/**
 * Get initial from name
 */
function getInitial(name) {
    if (!name || name.trim() === '') return '?';
    return name.trim().charAt(0).toUpperCase();
}

/**
 * Set up avatar for a video wrapper
 */
function setupAvatar(wrapper, nickname, avatarElement, initialElement) {
    const color = generateEarthyColor();
    wrapper.style.backgroundColor = color;
    avatarElement.style.backgroundColor = color;
    initialElement.textContent = getInitial(nickname);
}

function parseOpenViduConnectionData(connection) {
    let connectionData = {};

    try {
        const rawData = connection?.data || '';
        const dataParts = rawData.split('%/%');
        for (const part of dataParts) {
            try {
                const parsed = JSON.parse(part);
                connectionData = { ...connectionData, ...parsed };
            } catch (e) {}
        }
    } catch (e) {}

    return {
        nickname: connectionData.nickname || 'Participant',
        preferredLanguage: connectionData.preferredLanguage || 'en',
        role: connectionData.role || 'participant',
        isScreenShare: Boolean(connectionData.isScreenShare),
    };
}

function getParticipantRolePriority(role) {
    if (role === 'host') return 0;
    if (role === 'co_host') return 1;
    return 2;
}

function compareParticipantsByRoleAndName(a, b) {
    const rolePriority = getParticipantRolePriority(a.role) - getParticipantRolePriority(b.role);
    if (rolePriority !== 0) {
        return rolePriority;
    }

    if (a.isLocal && !b.isLocal) return -1;
    if (!a.isLocal && b.isLocal) return 1;

    return (a.nickname || '').localeCompare(b.nickname || '');
}

function reorderGalleryByParticipantRole() {
    if (!elements.videoGrid) {
        return;
    }

    const participantTiles = Array.from(
        elements.videoGrid.querySelectorAll('.video-wrapper:not(.screen-share-video)')
    );

    participantTiles
        .sort((a, b) =>
            compareParticipantsByRoleAndName(
                {
                    role: a.dataset.role || 'participant',
                    nickname: a.dataset.nickname || '',
                    isLocal: a.classList.contains('local-video'),
                },
                {
                    role: b.dataset.role || 'participant',
                    nickname: b.dataset.nickname || '',
                    isLocal: b.classList.contains('local-video'),
                }
            )
        )
        .forEach((tile) => {
            elements.videoGrid.appendChild(tile);
        });
}

async function syncParticipantRolesFromSession() {
    if (!appState.sessionId) {
        return;
    }

    try {
        const response = await apiFetch(
            `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION(appState.sessionId)}`
        );

        if (!response.ok) {
            return;
        }

        const sessionData = await response.json();
        const participantRoles = sessionData.participantRoles || {};

        Object.entries(participantRoles).forEach(([connectionId, role]) => {
            const participant = participantsData.get(connectionId);
            if (participant) {
                participant.role = role;
                participantsData.set(connectionId, participant);
            }

            const wrapperId =
                connectionId === appState.currentParticipantId
                    ? 'localVideoWrapper'
                    : `video-${connectionId}`;
            const wrapper = document.getElementById(wrapperId);
            if (wrapper) {
                wrapper.dataset.role = role;
            }
        });

        reorderGalleryByParticipantRole();
        updateChatRecipientOptions();

        if (appState.isParticipantsOpen) {
            renderParticipantsList();
        }
    } catch (error) {
        logEvent('warn', 'Could not sync participant roles');
    }
}

function showConferenceRoom() {
    elements.joinContainer.style.display = 'none';
    elements.conferenceContainer.style.display = 'flex';
    elements.currentSessionId.textContent = appState.sessionId;
    elements.localNickname.textContent = appState.nickname;
    elements.localLanguage.textContent = appState.preferredLanguage.toUpperCase();
    
    // Set up local avatar
    const localAvatar = document.getElementById('localAvatar');
    const localAvatarInitial = document.getElementById('localAvatarInitial');
    const localWrapper = document.getElementById('localVideoWrapper');
    localWrapper.dataset.role = appState.authRole || 'participant';
    localWrapper.dataset.nickname = appState.nickname || 'You';
    setupAvatar(localWrapper, appState.nickname, localAvatar, localAvatarInitial);
    
    // Sync button states with preview settings
    elements.toggleAudioBtn.classList.toggle('muted', !appState.isAudioEnabled);
    elements.toggleAudioBtn.innerHTML = appState.isAudioEnabled 
        ? '<i data-lucide="mic"></i>' 
        : '<i data-lucide="mic-off"></i>';
    elements.toggleVideoBtn.classList.toggle('muted', !appState.isVideoEnabled);
    elements.toggleVideoBtn.innerHTML = appState.isVideoEnabled 
        ? '<i data-lucide="video"></i>' 
        : '<i data-lucide="video-off"></i>';
    lucide.createIcons();
    
    // Show avatar if video is disabled
    if (!appState.isVideoEnabled) {
        localWrapper.classList.add('camera-off');
        localAvatar.classList.add('visible');
    }

    reorderGalleryByParticipantRole();
    updateVideoGridLayoutState();
    applyPermissionBasedUi();
}

function showJoinForm() {
    elements.conferenceContainer.style.display = 'none';
    elements.joinContainer.style.display = 'flex';
    clearMockParticipants();
    updateParticipantCount();
    
    // Restart preview when returning to join form
    initPreview();
    applyPermissionBasedUi();
}

function updateParticipantCount() {
    const count = participantsData.size > 0
        ? participantsData.size
        : appState.isConnected || appState.sessionId
        ? 1
        : 0;
    elements.participantCount.textContent = count;
    updateVideoGridLayoutState();
}

function updateVideoGridLayoutState() {
    const grid = elements.videoGrid;
    if (!grid) return;

    const participantTiles = grid.querySelectorAll('.video-wrapper:not(.screen-share-video)').length;
    const galleryClasses = [
        'gallery-count-0',
        'gallery-count-1',
        'gallery-count-2',
        'gallery-count-3',
        'gallery-count-4',
        'gallery-count-5',
        'gallery-count-6',
        'gallery-count-7-plus'
    ];

    grid.classList.remove(...galleryClasses);

    if (participantTiles <= 0) {
        grid.classList.add('gallery-count-0');
        return;
    }

    if (participantTiles >= 7) {
        grid.classList.add('gallery-count-7-plus');
        return;
    }

    grid.classList.add(`gallery-count-${participantTiles}`);
}

// =============================================================================
// Layout Test Helpers (easy to remove)
// =============================================================================

function clearMockParticipants() {
    const mockIds = Array.from(participantsData.keys()).filter((id) =>
        id.startsWith(MOCK_PARTICIPANT_PREFIX)
    );

    mockIds.forEach((connectionId) => {
        removeRemoteVideoElement(connectionId);
        removeParticipantFromPanel(connectionId);
    });

    updateParticipantCount();
    updateAudioTracksDebug();
}

function createMockParticipant(index) {
    const connectionId = `${MOCK_PARTICIPANT_PREFIX}${index + 1}`;
    const languagePool = ['en', 'es', 'fr', 'de', 'pt'];
    const nickname = `Mock User ${index + 1}`;
    const rolePool = ['participant', 'participant', 'guest', 'co_host'];
    const connection = {
        connectionId,
        data: JSON.stringify({
            nickname,
            preferredLanguage: languagePool[index % languagePool.length],
            role: rolePool[index % rolePool.length],
        }),
    };

    createRemoteVideoElement(connection);
    addParticipantToPanel(connectionId, nickname, false, rolePool[index % rolePool.length]);
}

function promptMockParticipantCount() {
    if (elements.conferenceContainer.style.display === 'none') {
        showNotification('Join a room before generating mock participants.', 'info');
        return;
    }

    const response = window.prompt('How many mock participants do you want to generate?', '10');
    if (response === null) return;

    const count = Number.parseInt(response, 10);
    if (!Number.isFinite(count) || count < 0) {
        showNotification('Please enter a valid participant count.', 'error');
        return;
    }

    clearMockParticipants();
    for (let i = 0; i < count; i += 1) {
        createMockParticipant(i);
    }

    updateParticipantCount();
    showNotification(`Generated ${count} mock participant${count === 1 ? '' : 's'}.`, 'info');
}

function initializeLayoutTester() {
    if (!ENABLE_LAYOUT_TESTER) return;
    if (document.getElementById('layoutTestFab')) return;

    const tester = document.createElement('div');
    tester.id = 'layoutTestFab';
    tester.className = 'layout-test-fab';
    tester.innerHTML = `
        <button type="button" class="layout-test-btn primary" id="layoutTestGenerate">
            Test Layout
        </button>
        <button type="button" class="layout-test-btn" id="layoutTestClear">
            Clear
        </button>
    `;

    document.body.appendChild(tester);

    document.getElementById('layoutTestGenerate')?.addEventListener('click', promptMockParticipantCount);
    document.getElementById('layoutTestClear')?.addEventListener('click', () => {
        clearMockParticipants();
        showNotification('Mock participants cleared.', 'info');
    });
}

/**
 * Create video element for a remote participant
 */
function createRemoteVideoElement(subscriberOrConnection) {
    const isSubscriber =
        subscriberOrConnection &&
        typeof subscriberOrConnection.addVideoElement === 'function' &&
        subscriberOrConnection.stream;
    const stream = isSubscriber ? subscriberOrConnection.stream : null;
    const connection = stream?.connection || subscriberOrConnection;
    const subscriber = isSubscriber ? subscriberOrConnection : null;
    const connectionId = connection.connectionId;
    const connectionData = parseOpenViduConnectionData(connection);
    const nickname = connectionData.nickname;

    const existingWrapper = document.getElementById(`video-${connectionId}`);
    if (existingWrapper) {
        const labelName = existingWrapper.querySelector('.video-label-left span:last-child');
        const languageBadge = existingWrapper.querySelector('.language-badge');
        const avatar = document.getElementById(`avatar-${connectionId}`);

        if (labelName) {
            labelName.textContent = nickname;
        }
        if (languageBadge) {
            languageBadge.textContent = connectionData.preferredLanguage.toUpperCase();
        }
        if (avatar) {
            avatar.classList.toggle('visible', !stream || !stream.videoActive);
        }
        existingWrapper.classList.toggle('camera-off', !stream || !stream.videoActive);
        existingWrapper.dataset.role = connectionData.role || 'participant';
        existingWrapper.dataset.nickname = nickname;

        if (subscriber) {
            const video = document.getElementById(`video-element-${connectionId}`);
            if (video) {
                subscriber.addVideoElement(video);
            }
        }

        reorderGalleryByParticipantRole();

        return existingWrapper;
    }
    
    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper remote-video';
    wrapper.id = `video-${connectionId}`;
    wrapper.dataset.role = connectionData.role || 'participant';
    wrapper.dataset.nickname = nickname;
    
    // Create avatar placeholder
    const avatar = document.createElement('div');
    avatar.className = 'video-avatar';
    avatar.id = `avatar-${connectionId}`;
    
    const avatarCircle = document.createElement('div');
    avatarCircle.className = 'avatar-circle';
    avatarCircle.id = `avatar-initial-${connectionId}`;
    avatar.appendChild(avatarCircle);
    
    // Create video element
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.id = `video-element-${connectionId}`;
    
    // Create label
    const label = document.createElement('div');
    label.className = 'video-label';
    label.innerHTML = `
        <div class="video-label-left">
            <span class="speaking-indicator" id="speaking-${connectionId}"></span>
            <span>${nickname}</span>
        </div>
        <span class="language-badge">${connectionData.preferredLanguage.toUpperCase()}</span>
    `;
    
    // Create subtitle container
    const subtitleContainer = createSubtitleElement(connectionId);
    
    // Create AI interpreter avatar
    const aiAvatar = document.createElement('div');
    aiAvatar.className = 'ai-interpreter-avatar';
    aiAvatar.id = `ai-avatar-${connectionId}`;
    aiAvatar.innerHTML = '<i data-lucide="bot"></i>';
    
    wrapper.appendChild(avatar);
    wrapper.appendChild(video);
    wrapper.appendChild(subtitleContainer);
    wrapper.appendChild(aiAvatar);
    wrapper.appendChild(label);
    elements.videoGrid.appendChild(wrapper);
    
    // Initialize lucide icon for the AI avatar
    if (typeof lucide !== 'undefined') {
        lucide.createIcons({ nodes: [aiAvatar] });
    }
    
    // Set up avatar with earthy color
    setupAvatar(wrapper, nickname, avatar, avatarCircle);
    
    // Attach subscriber's stream to video element when available
    if (subscriber) {
        subscriber.addVideoElement(video);
    }
    
    // Check if video is enabled and show avatar if not
    if (!stream || !stream.videoActive) {
        wrapper.classList.add('camera-off');
        avatar.classList.add('visible');
    }

    reorderGalleryByParticipantRole();
    
    return wrapper;
}

/**
 * Remove video element for a disconnected participant
 */
function removeRemoteVideoElement(connectionId) {
    const wrapper = document.getElementById(`video-${connectionId}`);
    if (wrapper) {
        wrapper.remove();
    }
}

function setActiveScreenShare(connectionId) {
    const screenShares = Array.from(elements.videoGrid.querySelectorAll('.screen-share-video'));
    if (screenShares.length === 0) {
        appState.activeScreenShareConnectionId = null;
        elements.videoGrid.classList.remove('presentation-mode');
        return;
    }

    const nextActiveId = connectionId || screenShares[0].id.replace('screen-share-', '');
    appState.activeScreenShareConnectionId = nextActiveId;
    elements.videoGrid.classList.add('presentation-mode');

    screenShares.forEach((wrapper) => {
        const isActive = wrapper.id === `screen-share-${nextActiveId}`;
        wrapper.classList.toggle('screen-share-active', isActive);
        wrapper.classList.toggle('screen-share-inactive', !isActive);
    });
}

/**
 * Create video element for a remote screen share
 */
function createRemoteScreenShareElement(subscriber) {
    const stream = subscriber.stream;
    const connectionId = stream.connection.connectionId;
    
    // Parse connection data for nickname
    // OpenVidu concatenates client and server data with '%/%' separator
    let connectionData = {};
    try {
        const rawData = stream.connection.data;
        // Handle OpenVidu's '%/%' separator format
        const dataParts = rawData.split('%/%');
        // Try to parse each part and merge
        for (const part of dataParts) {
            try {
                const parsed = JSON.parse(part);
                connectionData = { ...connectionData, ...parsed };
            } catch (e) {}
        }
    } catch (e) {
        connectionData = { nickname: 'Unknown' };
    }
    
    // Extract nickname - remove "(Screen)" suffix if present since we add it in the label
    let nickname = connectionData.nickname || 'Participant';
    nickname = nickname.replace(/\s*\(Screen\)\s*$/, '');
    
    const existingWrapper = document.getElementById(`screen-share-${connectionId}`);
    if (existingWrapper) {
        const video = existingWrapper.querySelector('video');
        if (video) {
            subscriber.addVideoElement(video);
        }
        setActiveScreenShare(connectionId);
        return existingWrapper;
    }

    // Create wrapper for screen share
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper screen-share-video remote-screen-share';
    wrapper.id = `screen-share-${connectionId}`;
    
    // Create video element
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.id = `screen-video-${connectionId}`;
    
    // Create label
    const label = document.createElement('div');
    label.className = 'video-label';
    label.innerHTML = `
        <div class="video-label-left">
            <span>${nickname} (Screen)</span>
        </div>
        <span class="screen-share-badge">SCREEN</span>
    `;
    
    wrapper.appendChild(video);
    wrapper.appendChild(label);
    wrapper.addEventListener('click', () => {
        if (appState.activeScreenShareConnectionId !== connectionId) {
            setActiveScreenShare(connectionId);
        }
    });
    
    // Insert at the beginning of the grid
    elements.videoGrid.insertBefore(wrapper, elements.videoGrid.firstChild);
    
    // Attach subscriber's stream to video element
    subscriber.addVideoElement(video);
    
    setActiveScreenShare(connectionId);
    
    return wrapper;
}

/**
 * Remove remote screen share element
 */
function removeRemoteScreenShareElement(connectionId) {
    const wrapper = document.getElementById(`screen-share-${connectionId}`);
    const wasActive = appState.activeScreenShareConnectionId === connectionId;
    if (wrapper) {
        wrapper.remove();
    }

    if (wasActive) {
        const nextScreenShare = elements.videoGrid.querySelector('.screen-share-video');
        setActiveScreenShare(nextScreenShare?.id.replace('screen-share-', '') || null);
        return;
    }

    const remainingScreenShares = document.querySelectorAll('.screen-share-video');
    if (remainingScreenShares.length === 0) {
        setActiveScreenShare(null);
    }
}

/**
 * Update debug panel with audio track information
 */
function updateAudioTracksDebug() {
    const tracks = openviduClient.getRemoteAudioTracks();
    elements.audioTracksList.innerHTML = '';
    
    if (tracks.size === 0) {
        elements.audioTracksList.innerHTML = '<li>No remote audio tracks yet</li>';
        return;
    }
    
    tracks.forEach((track, connectionId) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <strong>${connectionId.substring(0, 8)}...</strong><br>
            Track ID: ${track.id}<br>
            Enabled: ${track.enabled ? '✅' : '❌'}
        `;
        elements.audioTracksList.appendChild(li);
    });
}

/**
 * Add entry to event log
 */
function logEvent(type, message) {
    const entry = document.createElement('div');
    entry.className = type;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    elements.eventLog.insertBefore(entry, elements.eventLog.firstChild);
    
    // Keep only last 50 entries
    while (elements.eventLog.children.length > 50) {
        elements.eventLog.removeChild(elements.eventLog.lastChild);
    }
}

// =============================================================================
// Speaking Detection
// =============================================================================

const speakingState = {
    localAnalyser: null,
    localDataArray: null,
    remoteAnalysers: new Map(),
    animationFrame: null,
    audioContext: null,
    speakingTimers: new Map(),
    HOLD_TIME: 400
};

/**
 * Initialize audio context for speaking detection
 */
function initAudioContext() {
    if (!speakingState.audioContext) {
        speakingState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return speakingState.audioContext;
}

/**
 * Set up speaking detection for local microphone
 */
function setupLocalSpeakingDetection(stream) {
    try {
        const audioContext = initAudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        
        speakingState.localAnalyser = analyser;
        speakingState.localDataArray = new Uint8Array(analyser.frequencyBinCount);
        
        startSpeakingDetectionLoop();
    } catch (error) {
        console.error('Error setting up local speaking detection:', error);
    }
}

/**
 * Set up speaking detection for a remote participant
 */
function setupRemoteSpeakingDetection(connectionId, audioTrack) {
    try {
        const audioContext = initAudioContext();
        const stream = new MediaStream([audioTrack]);
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        
        speakingState.remoteAnalysers.set(connectionId, {
            analyser,
            dataArray: new Uint8Array(analyser.frequencyBinCount)
        });
    } catch (error) {
        console.error('Error setting up remote speaking detection:', error);
    }
}

/**
 * Check audio level and determine if speaking
 */
function getAudioLevel(analyser, dataArray) {
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    return sum / dataArray.length;
}

/**
 * Update speaking indicator UI with debounce to avoid flickering
 */
function updateSpeakingIndicator(elementId, wrapperId, isSpeaking) {
    const indicator = document.getElementById(elementId);
    const wrapper = document.getElementById(wrapperId);
    const timerId = `${elementId}-${wrapperId}`;
    
    if (!indicator && !wrapper) return;
    
    if (isSpeaking) {
        // Clear any pending "stop speaking" timer
        if (speakingState.speakingTimers.has(timerId)) {
            clearTimeout(speakingState.speakingTimers.get(timerId));
            speakingState.speakingTimers.delete(timerId);
        }
        // Turn on immediately
        if (indicator) indicator.classList.add('speaking');
        if (wrapper) wrapper.classList.add('speaking');
    } else {
        // Only turn off after hold time (debounce)
        if (!speakingState.speakingTimers.has(timerId)) {
            const timer = setTimeout(() => {
                if (indicator) indicator.classList.remove('speaking');
                if (wrapper) wrapper.classList.remove('speaking');
                speakingState.speakingTimers.delete(timerId);
            }, speakingState.HOLD_TIME);
            speakingState.speakingTimers.set(timerId, timer);
        }
    }
}

/**
 * Main loop for speaking detection
 */
function startSpeakingDetectionLoop() {
    if (speakingState.animationFrame) return;
    
    const SPEAKING_THRESHOLD = 15;
    const DETECTION_INTERVAL = 100; // Check every 100ms instead of every frame (better for 50+ participants)
    let lastCheck = 0;
    
    function detectSpeaking(timestamp) {
        // Throttle to reduce CPU usage with many participants
        if (timestamp - lastCheck < DETECTION_INTERVAL) {
            speakingState.animationFrame = requestAnimationFrame(detectSpeaking);
            return;
        }
        lastCheck = timestamp;
        
        // Check local audio
        if (speakingState.localAnalyser && speakingState.localDataArray) {
            const level = getAudioLevel(speakingState.localAnalyser, speakingState.localDataArray);
            const isSpeaking = level > SPEAKING_THRESHOLD && appState.isAudioEnabled;
            updateSpeakingIndicator('localSpeakingIndicator', 'localVideoWrapper', isSpeaking);
        }
        
        // Check remote audio
        speakingState.remoteAnalysers.forEach((data, connectionId) => {
            const level = getAudioLevel(data.analyser, data.dataArray);
            const isSpeaking = level > SPEAKING_THRESHOLD;
            updateSpeakingIndicator(`speaking-${connectionId}`, `video-${connectionId}`, isSpeaking);
        });
        
        speakingState.animationFrame = requestAnimationFrame(detectSpeaking);
    }
    
    detectSpeaking(0);
}

/**
 * Clean up speaking detection for a remote participant
 */
function cleanupRemoteSpeakingDetection(connectionId) {
    speakingState.remoteAnalysers.delete(connectionId);
}

/**
 * Stop all speaking detection
 */
function stopSpeakingDetection() {
    if (speakingState.animationFrame) {
        cancelAnimationFrame(speakingState.animationFrame);
        speakingState.animationFrame = null;
    }
    // Clear all debounce timers
    speakingState.speakingTimers.forEach(timer => clearTimeout(timer));
    speakingState.speakingTimers.clear();
    
    speakingState.localAnalyser = null;
    speakingState.localDataArray = null;
    speakingState.remoteAnalysers.clear();
}

// =============================================================================
// AI Interpreter Functions
// =============================================================================

/**
 * Update the interpreter button state based on participants
 */
function updateInterpreterButtonState() {
    if (!isInterpreterFeatureEnabled()) {
        elements.toggleInterpreterBtn.disabled = true;
        return;
    }

    const remoteParticipants = openviduClient.subscribers.size;
    const hasRemoteParticipant = remoteParticipants > 0;
    elements.toggleInterpreterBtn.disabled = !hasRemoteParticipant;
    
    if (hasRemoteParticipant) {
        logEvent('info', 'Remote participant detected - AI Interpreter available');
    }
}

/**
 * Get all remote participants' info
 */
function getAllRemoteParticipants() {
    const subscribers = openviduClient.subscribers;
    if (subscribers.size === 0) return [];
    
    const participants = [];
    
    for (const [connectionId, subscriber] of subscribers) {
        let connectionData = {};
        try {
            connectionData = JSON.parse(subscriber.stream.connection.data);
        } catch (e) {
            connectionData = { preferredLanguage: 'en' };
        }
        
        // Skip screen share connections
        if (connectionData.isScreenShare) continue;
        
        const audioTrack = openviduClient.getAudioTrackForParticipant(connectionId);
        const videoElement = document.getElementById(`video-element-${connectionId}`);
        
        participants.push({
            connectionId,
            subscriber,
            language: connectionData.preferredLanguage || 'en',
            nickname: connectionData.nickname,
            audioTrack,
            videoElement
        });
    }
    
    return participants;
}

/**
 * Get a specific remote participant's info
 */
function getRemoteParticipantInfo(connectionId) {
    const subscriber = openviduClient.subscribers.get(connectionId);
    if (!subscriber) return null;
    
    let connectionData = {};
    try {
        connectionData = JSON.parse(subscriber.stream.connection.data);
    } catch (e) {
        connectionData = { preferredLanguage: 'en' };
    }
    
    const audioTrack = openviduClient.getAudioTrackForParticipant(connectionId);
    const videoElement = document.getElementById(`video-element-${connectionId}`);
    
    return {
        connectionId,
        subscriber,
        language: connectionData.preferredLanguage || 'en',
        nickname: connectionData.nickname,
        audioTrack,
        videoElement
    };
}

/**
 * Start the AI interpreter for all remote participants
 */
async function startInterpreter() {
    const remoteParticipants = getAllRemoteParticipants();
    
    if (remoteParticipants.length === 0) {
        logEvent('error', 'No remote participants to interpret');
        return;
    }
    
    logEvent('info', `Starting interpreter for ${remoteParticipants.length} participant(s)`);
    
    // Set up interpreter manager callbacks
    interpreterManager.onLog = logEvent;
    interpreterManager.onStatusChange = (isActive) => {
        appState.isInterpreterActive = isActive;
        elements.toggleInterpreterBtn.classList.toggle('active', isActive);
        elements.toggleInterpreterBtn.innerHTML = isActive 
            ? '<i data-lucide="languages"></i><span>Stop AI</span>' 
            : '<i data-lucide="languages"></i><span>AI Interpreter</span>';
        lucide.createIcons();
        
        // Send signal to all participants about interpreter state
        sendInterpreterActiveSignal(isActive);
    };
    
    // Set up AI speaking state callback
    interpreterManager.onAiSpeakingChange = (isSpeaking) => {
        sendAiSpeakingSignal(isSpeaking);
    };
    
    // Set up AI listening state callback (when input speech is detected)
    interpreterManager.onAiListeningChange = (isListening) => {
        sendAiListeningSignal(isListening);
    };
    
    const success = await interpreterManager.start({
        localLanguage: appState.preferredLanguage,
        remoteParticipants: remoteParticipants
    });
    
    if (!success) {
        logEvent('warn', 'Interpreter did not start (all same language or no participants)');
    }
}

/**
 * Stop the AI interpreter
 */
function stopInterpreter() {
    interpreterManager.stop();
    // Send signal that interpreter is deactivated
    sendInterpreterActiveSignal(false);
    logEvent('info', 'AI Interpreter stopped');
}

/**
 * Toggle interpreter on/off
 */
async function toggleInterpreter() {
    if (!isInterpreterFeatureEnabled()) {
        showNotification('AI interpretation is not enabled for this room.', 'error');
        return;
    }

    if (appState.isInterpreterActive) {
        stopInterpreter();
    } else {
        await startInterpreter();
    }
}

// =============================================================================
// Live Transcription Functions
// =============================================================================

/**
 * Update transcription button state based on participants
 */
function updateTranscriptionButtonState() {
    if (!isSubtitlesFeatureEnabled()) {
        elements.toggleTranscriptionBtn.disabled = true;
        return;
    }

    const remoteParticipants = openviduClient.subscribers.size;
    const hasRemoteParticipant = remoteParticipants > 0;
    elements.toggleTranscriptionBtn.disabled = !hasRemoteParticipant;
}

/**
 * Start live transcription for all remote participants
 */
async function startTranscription() {
    const remoteParticipants = getAllRemoteParticipants();
    
    if (remoteParticipants.length === 0) {
        logEvent('error', 'No remote participants for transcription');
        return;
    }
    
    logEvent('info', `Starting transcription for ${remoteParticipants.length} participant(s)`);
    
    // Set up transcription manager callbacks
    transcriptionManager.onLog = logEvent;
    transcriptionManager.onCaptionUpdate = (connectionId, text, isFinal) => {
        updateSubtitle(connectionId, text, isFinal);
    };
    
    const success = await transcriptionManager.start({
        localLanguage: appState.preferredLanguage,
        remoteParticipants: remoteParticipants
    });
    
    if (success) {
        appState.isTranscriptionActive = true;
        elements.toggleTranscriptionBtn.classList.add('active');
        elements.toggleTranscriptionBtn.innerHTML = '<i data-lucide="subtitles"></i><span>Stop CC</span>';
        lucide.createIcons();
        logEvent('info', 'Transcription started');
    } else {
        logEvent('warn', 'Transcription did not start');
    }
}

/**
 * Stop live transcription
 */
function stopTranscription() {
    transcriptionManager.stop();
    appState.isTranscriptionActive = false;
    elements.toggleTranscriptionBtn.classList.remove('active');
    elements.toggleTranscriptionBtn.innerHTML = '<i data-lucide="subtitles"></i><span>Subtitles</span>';
    lucide.createIcons();
    
    // Clear all subtitles
    document.querySelectorAll('.subtitle-text').forEach(el => {
        el.textContent = '';
    });
    
    logEvent('info', 'Transcription stopped');
}

/**
 * Toggle transcription on/off
 */
async function toggleTranscription() {
    if (!isSubtitlesFeatureEnabled()) {
        showNotification('Subtitles are not enabled for this room.', 'error');
        return;
    }

    if (appState.isTranscriptionActive) {
        stopTranscription();
    } else {
        await startTranscription();
    }
}

/**
 * Update subtitle text for a participant
 */
function updateSubtitle(connectionId, text, isFinal) {
    const subtitleEl = document.getElementById(`subtitle-${connectionId}`);
    if (subtitleEl) {
        subtitleEl.textContent = text;
        subtitleEl.classList.toggle('interim', !isFinal);
        
        // Clear subtitle after 5 seconds of no updates (for final text)
        if (isFinal && text) {
            clearTimeout(subtitleEl.clearTimer);
            subtitleEl.clearTimer = setTimeout(() => {
                subtitleEl.textContent = '';
            }, 5000);
        }
    }
}

/**
 * Create subtitle element for a video wrapper
 */
function createSubtitleElement(connectionId) {
    const subtitleContainer = document.createElement('div');
    subtitleContainer.className = 'video-subtitle';
    subtitleContainer.innerHTML = `<span class="subtitle-text" id="subtitle-${connectionId}"></span>`;
    return subtitleContainer;
}

// =============================================================================
// Chat Functions
// =============================================================================

/**
 * Initialize chat manager with session
 */
function initializeChat(session) {
    chatManager.initialize(session, appState.nickname, appState.preferredLanguage);
    
    // Set up callbacks
    chatManager.onMessage = (message) => {
        addChatMessageToUI(message);
    };
    
    chatManager.onUnreadChange = (count) => {
        updateChatBadge(count);
    };

    updateChatRecipientOptions();
}

/**
 * Add a chat message to the UI
 */
function addChatMessageToUI(message) {
    // Remove empty state if present
    const emptyState = elements.chatMessages.querySelector('.chat-empty');
    if (emptyState) {
        emptyState.remove();
    }
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${message.isLocal ? 'local' : 'remote'} ${message.messageType === 'direct' ? 'chat-message-direct' : ''}`;
    messageEl.setAttribute('data-message-id', message.id);
    
    const time = message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Use chatManager to get the correct display text based on translation setting
    const displayText = chatManager.getDisplayText(message);
    
    messageEl.innerHTML = `
        <div class="chat-message-header">
            <span class="chat-message-sender" style="color: ${message.color}">${message.nickname}</span>
            ${message.messageType === 'direct'
                ? `<span class="chat-message-meta">${message.isLocal ? `to ${escapeHtml(message.recipientNickname || 'Direct')}` : 'Direct message'}</span>`
                : ''}
            <span class="chat-message-time">${time}</span>
        </div>
        <div class="chat-message-bubble">${escapeHtml(displayText)}</div>
    `;
    
    elements.chatMessages.appendChild(messageEl);
    
    // Scroll to bottom
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

/**
 * Refresh all chat messages (used when translation toggle changes)
 */
function refreshChatMessages() {
    const messages = chatManager.getMessages();
    
    if (messages.length === 0) {
        return;
    }
    
    // Clear current messages
    elements.chatMessages.innerHTML = '';
    
    // Re-add all messages with current translation setting
    messages.forEach(message => {
        addChatMessageToUI(message);
    });
}

/**
 * Toggle chat translation
 */
function toggleChatTranslation() {
    const enabled = elements.chatTranslateToggle.checked;
    chatManager.setTranslationEnabled(enabled);
    refreshChatMessages();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Update chat badge with unread count
 */
function updateChatBadge(count) {
    if (count > 0) {
        elements.chatBadge.textContent = count > 99 ? '99+' : count;
        elements.chatBadge.style.display = 'flex';
    } else {
        elements.chatBadge.style.display = 'none';
    }
}

/**
 * Toggle chat panel visibility
 */
function toggleChat() {
    appState.isChatOpen = !appState.isChatOpen;
    
    if (appState.isChatOpen) {
        elements.chatPanel.style.display = 'flex';
        elements.toggleChatBtn.classList.add('active');
        chatManager.setOpen(true);
        updateChatRecipientOptions();
        elements.chatInput.focus();
    } else {
        elements.chatPanel.style.display = 'none';
        elements.toggleChatBtn.classList.remove('active');
        chatManager.setOpen(false);
    }
    
    lucide.createIcons();
}

/**
 * Close chat panel
 */
function closeChat() {
    appState.isChatOpen = false;
    elements.chatPanel.style.display = 'none';
    elements.toggleChatBtn.classList.remove('active');
    chatManager.setOpen(false);
}

/**
 * Send chat message
 */
async function sendChatMessage() {
    if (!canSendAnyChatMessages()) {
        showNotification('You do not have permission to send messages.', 'error');
        return;
    }

    const text = elements.chatInput.value.trim();
    if (!text) return;

    const selectedRecipient = elements.chatRecipientSelect?.value || 'everyone';
    const selectedOption = elements.chatRecipientSelect?.selectedOptions?.[0];
    const isDirectMessage = selectedRecipient !== 'everyone';

    if (isDirectMessage && !canSendDirectMessages()) {
        showNotification('You do not have permission to send direct messages.', 'error');
        return;
    }

    if (!isDirectMessage && !canSendGroupMessages()) {
        showNotification('You do not have permission to send messages to everyone.', 'error');
        return;
    }
    
    elements.chatInput.value = '';
    await chatManager.sendMessage(
        text,
        isDirectMessage
            ? {
                  messageType: 'direct',
                  recipientConnectionId: selectedRecipient,
                  recipientNickname: selectedOption?.dataset?.nickname || selectedOption?.textContent || 'Direct',
              }
            : { messageType: 'group' }
    );
}

/**
 * Reset chat UI
 */
function resetChatUI() {
    elements.chatMessages.innerHTML = `
        <div class="chat-empty">
            <i data-lucide="message-square-dashed"></i>
            <p>No messages yet</p>
            <span>Messages will be translated to your language</span>
        </div>
    `;
    lucide.createIcons();
    elements.chatBadge.style.display = 'none';
    elements.chatPanel.style.display = 'none';
    elements.toggleChatBtn.classList.remove('active');
    appState.isChatOpen = false;
    if (elements.chatRecipientSelect) {
        elements.chatRecipientSelect.innerHTML = '<option value="everyone">Everyone</option>';
    }
}

function getEligibleDirectMessageRecipients() {
    const participants = Array.from(participantsData.values()).filter((participant) => !participant.isLocal);

    if (canModerateChatRecipients()) {
        return participants;
    }

    return participants.filter((participant) => participant.role === 'host' || participant.role === 'co_host');
}

function updateChatRecipientOptions() {
    if (!elements.chatRecipientSelect) {
        return;
    }

    const previousValue = elements.chatRecipientSelect.value;
    const options = [];

    if (canSendGroupMessages()) {
        options.push('<option value="everyone">Everyone</option>');
    }

    if (canSendDirectMessages()) {
        getEligibleDirectMessageRecipients().forEach((participant) => {
            options.push(
                `<option value="${participant.connectionId}" data-nickname="${escapeHtml(participant.nickname)}">Direct to ${escapeHtml(participant.nickname)}</option>`
            );
        });
    }

    if (options.length === 0) {
        elements.chatRecipientSelect.innerHTML = '<option value="">No available destinations</option>';
        elements.chatRecipientSelect.disabled = true;
        return;
    }

    elements.chatRecipientSelect.innerHTML = options.join('');

    const hasPreviousValue = Array.from(elements.chatRecipientSelect.options).some(
        (option) => option.value === previousValue
    );
    elements.chatRecipientSelect.value = hasPreviousValue ? previousValue : elements.chatRecipientSelect.options[0].value;
    elements.chatRecipientSelect.disabled = !canSendAnyChatMessages();
}

// =============================================================================
// Participants Panel
// =============================================================================

/**
 * Track participants data for the panel
 */
const participantsData = new Map();

/**
 * Toggle participants panel visibility
 */
function toggleParticipants() {
    appState.isParticipantsOpen = !appState.isParticipantsOpen;
    
    if (appState.isParticipantsOpen) {
        elements.participantsPanel.style.display = 'flex';
        elements.toggleParticipantsBtn.classList.add('active');
        renderParticipantsList();
    } else {
        elements.participantsPanel.style.display = 'none';
        elements.toggleParticipantsBtn.classList.remove('active');
    }
    
    lucide.createIcons();
}

function toggleWhiteboardForCurrentRole() {
    if (!canManageWhiteboard()) {
        showNotification('You do not have permission to manage the whiteboard.', 'error');
        return;
    }

    whiteboardManager.toggle();
}

/**
 * Close participants panel
 */
function closeParticipants() {
    appState.isParticipantsOpen = false;
    elements.participantsPanel.style.display = 'none';
    elements.toggleParticipantsBtn.classList.remove('active');
}

/**
 * Add participant to tracking
 */
function addParticipantToPanel(connectionId, nickname, isLocal = false, role = null) {
    participantsData.set(connectionId, {
        connectionId,
        nickname,
        isLocal,
        role: role || (isLocal ? (appState.authRole || 'participant') : 'participant'),
        isMuted: false,
        isVideoOff: false,
        permissions: getDefaultParticipantPermissionState(),
    });
    updateParticipantsCount();
    updateChatRecipientOptions();
    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
}

/**
 * Remove participant from tracking
 */
function removeParticipantFromPanel(connectionId) {
    participantsData.delete(connectionId);
    updateParticipantsCount();
    updateChatRecipientOptions();
    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
}

/**
 * Update participants count display
 */
function updateParticipantsCount() {
    const count = participantsData.size;
    elements.participantsPanelCount.textContent = count;
    elements.participantCount.textContent = count;
}

/**
 * Render the participants list
 */
function renderParticipantsList() {
    if (participantsData.size === 0) {
        elements.participantsList.innerHTML = `
            <div class="participants-empty">
                <i data-lucide="user-x"></i>
                <p>No participants yet</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }
    
    // Sort: local user first, then alphabetically
    const sortedParticipants = Array.from(participantsData.values()).sort(compareParticipantsByRoleAndName);
    
    elements.participantsList.innerHTML = sortedParticipants.map(p => {
        const initials = p.nickname.charAt(0).toUpperCase();
        const isYou = p.isLocal;
        const canMuteParticipant = canManageParticipantMedia() && !isYou;
        const canRemoveParticipant = canKickParticipants() && !isYou;
        const canModerateParticipant = canMuteParticipant || canRemoveParticipant;
        const canManagePermissionGrants = (canManageParticipantMedia() || canManageWhiteboard()) && !isYou;
        const participantPermissions = p.permissions || getDefaultParticipantPermissionState();
        const isAccessMenuOpen = activeParticipantAccessMenuId === p.connectionId;
        
        return `
            <div class="participant-item ${isYou ? 'is-you' : ''}" data-connection-id="${p.connectionId}">
                <div class="participant-avatar">${initials}</div>
                <div class="participant-info">
                    <div class="participant-name">
                        ${escapeHtml(p.nickname)}
                        ${isYou ? '<span class="participant-you-badge">You</span>' : ''}
                    </div>
                    <div class="participant-status ${p.isMuted ? 'muted' : ''}">
                        ${p.isMuted 
                            ? '<i data-lucide="mic-off"></i> Muted' 
                            : '<i data-lucide="mic"></i> Active'}
                    </div>
                    ${canManagePermissionGrants ? `
                        <div class="participant-access">
                            <button class="participant-access-btn ${isAccessMenuOpen ? 'is-open' : ''}" data-connection-id="${p.connectionId}" title="Manage participant access" aria-expanded="${isAccessMenuOpen ? 'true' : 'false'}">
                                <i data-lucide="sliders-horizontal"></i>
                                <span>Access</span>
                            </button>
                            ${isAccessMenuOpen ? `
                                <div class="participant-access-menu" data-connection-id="${p.connectionId}">
                                    ${canManageParticipantMedia() ? `
                                        <button class="participant-access-menu-item" data-connection-id="${p.connectionId}" data-action="${participantPermissions.audioEnabled || participantPermissions.videoEnabled ? 'disableMedia' : 'enableMedia'}">
                                            ${participantPermissions.audioEnabled || participantPermissions.videoEnabled ? 'Disable mic and camera' : 'Enable mic and camera'}
                                        </button>
                                        <button class="participant-access-menu-item" data-connection-id="${p.connectionId}" data-action="${participantPermissions.screenShareEnabled ? 'disableScreenShare' : 'enableScreenShare'}">
                                            ${participantPermissions.screenShareEnabled ? 'Disable screen sharing' : 'Enable screen sharing'}
                                        </button>
                                    ` : ''}
                                    ${canManageWhiteboard() ? `
                                        <button class="participant-access-menu-item" data-connection-id="${p.connectionId}" data-action="${participantPermissions.whiteboardEnabled ? 'disableWhiteboard' : 'enableWhiteboard'}">
                                            ${participantPermissions.whiteboardEnabled ? 'Disable whiteboard access' : 'Enable whiteboard access'}
                                        </button>
                                    ` : ''}
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
                ${canModerateParticipant ? `
                    <div class="participant-actions">
                        ${canMuteParticipant ? `<button class="participant-action-btn mute-btn" 
                                data-connection-id="${p.connectionId}" 
                                title="Request mute">
                            <i data-lucide="mic-off"></i>
                        </button>` : ''}
                        ${canRemoveParticipant ? `<button class="participant-action-btn kick-btn" 
                                data-connection-id="${p.connectionId}" 
                                title="Remove from call">
                            <i data-lucide="user-x"></i>
                        </button>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    lucide.createIcons();
    
    // Add click handlers for action buttons
    elements.participantsList.querySelectorAll('.mute-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const connectionId = btn.dataset.connectionId;
            requestMuteParticipant(connectionId);
        });
    });
    
    elements.participantsList.querySelectorAll('.kick-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const connectionId = btn.dataset.connectionId;
            kickParticipant(connectionId);
        });
    });

    elements.participantsList.querySelectorAll('.participant-access-btn').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleParticipantAccessMenu(button.dataset.connectionId);
        });
    });

    elements.participantsList.querySelectorAll('.participant-access-menu-item').forEach((button) => {
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            await handleParticipantAccessAction(button.dataset.connectionId, button.dataset.action);
        });
    });
}

/**
 * Request a participant to mute their microphone
 */
function requestMuteParticipant(connectionId) {
    if (!openviduClient.session) return;
    if (!canManageParticipantMedia()) {
        showNotification('You do not have permission to manage participant media.', 'error');
        return;
    }
    
    const participant = participantsData.get(connectionId);
    if (!participant) return;
    
    // Send signal to request mute
    openviduClient.session.signal({
        data: JSON.stringify({ 
            fromNickname: appState.nickname 
        }),
        to: [openviduClient.session.remoteConnections.get(connectionId)],
        type: 'requestMute'
    }).then(() => {
        logEvent('info', `Sent mute request to ${participant.nickname}`);
    }).catch(err => {
        console.error('Error sending mute request:', err);
    });
}

/**
 * Kick a participant from the call
 */
function kickParticipant(connectionId) {
    if (!openviduClient.session) return;
    if (!canKickParticipants()) {
        showNotification('You do not have permission to remove participants.', 'error');
        return;
    }
    
    const participant = participantsData.get(connectionId);
    if (!participant) return;
    
    // Confirm before kicking
    if (!confirm(`Remove ${participant.nickname} from the call?`)) {
        return;
    }
    
    // Send signal to kick
    openviduClient.session.signal({
        data: JSON.stringify({ 
            fromNickname: appState.nickname,
            reason: 'Removed by host'
        }),
        to: [openviduClient.session.remoteConnections.get(connectionId)],
        type: 'kick'
    }).then(() => {
        logEvent('info', `Kicked ${participant.nickname} from the call`);
    }).catch(err => {
        console.error('Error kicking participant:', err);
    });
}

/**
 * Handle incoming mute request signal
 */
function handleMuteRequest(event) {
    try {
        const data = JSON.parse(event.data);
        // Show notification and auto-mute
        const message = `${data.fromNickname} has requested you to mute your microphone`;
        
        // Auto-mute the user
        if (appState.isAudioEnabled) {
            appState.isAudioEnabled = openviduClient.toggleAudio();
            elements.toggleAudioBtn.classList.add('muted');
            elements.toggleAudioBtn.innerHTML = '<i data-lucide="mic-off"></i>';
            lucide.createIcons();
        }
        
        // Show a brief notification
        showNotification(message, 'info');
        logEvent('info', message);
    } catch (e) {
        console.error('Error handling mute request:', e);
    }
}

/**
 * Handle incoming kick signal
 */
function handleKickSignal(event) {
    try {
        const data = JSON.parse(event.data);
        alert(`You have been removed from the call by ${data.fromNickname}`);
        leaveSession();
    } catch (e) {
        console.error('Error handling kick signal:', e);
    }
}

/**
 * Show a brief notification toast
 */
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i data-lucide="${type === 'info' ? 'info' : 'alert-circle'}"></i>
        <span>${escapeHtml(message)}</span>
    `;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        padding: 12px 20px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 9999;
        animation: slideDown 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    lucide.createIcons();
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

/**
 * Reset participants panel
 */
function resetParticipantsPanel() {
    participantsData.clear();
    elements.participantsList.innerHTML = `
        <div class="participants-empty">
            <i data-lucide="user-x"></i>
            <p>No participants yet</p>
        </div>
    `;
    lucide.createIcons();
    elements.participantsPanel.style.display = 'none';
    elements.toggleParticipantsBtn.classList.remove('active');
    appState.isParticipantsOpen = false;
    updateParticipantsCount();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =============================================================================
// Reactions
// =============================================================================

/**
 * Toggle reactions popup visibility
 */
function toggleReactionsPopup() {
    if (!canSendGroupMessages()) {
        showNotification('You do not have permission to send reactions.', 'error');
        return;
    }

    const willShow = !elements.reactionsPopup?.classList.contains('show');
    if (willShow) {
        positionReactionsPopup();
    }
    elements.reactionsPopup?.classList.toggle('show', willShow);
    elements.toggleReactionsBtn?.classList.toggle('active', willShow);
}

/**
 * Hide reactions popup
 */
function hideReactionsPopup() {
    elements.reactionsPopup?.classList.remove('show');
    elements.toggleReactionsBtn?.classList.remove('active');
}

function positionReactionsPopup() {
    if (!elements.reactionsPopup || !elements.toggleReactionsBtn) {
        return;
    }

    const buttonRect = elements.toggleReactionsBtn.getBoundingClientRect();
    const popup = elements.reactionsPopup;

    popup.style.visibility = 'hidden';
    popup.classList.add('show');

    const popupRect = popup.getBoundingClientRect();
    const viewportPadding = 12;
    const centeredLeft = buttonRect.left + (buttonRect.width / 2) - (popupRect.width / 2);
    const left = Math.min(
        Math.max(centeredLeft, viewportPadding),
        window.innerWidth - popupRect.width - viewportPadding
    );
    const top = Math.max(buttonRect.top - popupRect.height - 10, viewportPadding);

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    popup.classList.remove('show');
    popup.style.visibility = '';
}

/**
 * Send a reaction to all participants
 */
function sendReaction(reaction) {
    if (!canSendGroupMessages()) {
        showNotification('You do not have permission to send reactions.', 'error');
        return;
    }

    if (!openviduClient.session) {
        console.error('[Reactions] No session available');
        return;
    }
    
    // Show reaction locally on own video
    showReactionOnVideo('localVideoWrapper', reaction);
    
    // Broadcast to others
    const signalData = {
        reaction: reaction,
        senderName: appState.nickname || 'Anonymous'
    };
    
    console.log('[Reactions] Sending reaction:', signalData);
    
    openviduClient.session.signal({
        data: JSON.stringify(signalData),
        type: 'reaction'
    }).then(() => {
        console.log('[Reactions] Signal sent successfully');
    }).catch(err => console.error('[Reactions] Error sending reaction:', err));
    
    logEvent('info', `Sent reaction: ${reaction}`);
}

/**
 * Show reaction animation on a video wrapper
 */
function showReactionOnVideo(wrapperId, reaction) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) {
        console.warn('[Reactions] Video wrapper not found:', wrapperId);
        return;
    }
    
    // Create reaction element
    const reactionEl = document.createElement('div');
    reactionEl.className = 'video-reaction';
    reactionEl.textContent = reaction;
    
    wrapper.appendChild(reactionEl);
    
    // Remove after animation completes
    setTimeout(() => {
        reactionEl.remove();
    }, 2000);
}

/**
 * Initialize reaction signal handlers
 */
function initializeReactionSignals(session) {
    session.on('signal:reaction', (event) => {
        // Skip if it's our own signal
        if (event.from.connectionId === openviduClient.session.connection.connectionId) return;
        
        try {
            const data = JSON.parse(event.data);
            const connectionId = event.from.connectionId;
            
            console.log('[Reactions] Received reaction from', connectionId, ':', data.reaction);
            
            // Show reaction on the sender's video
            showReactionOnVideo(`video-${connectionId}`, data.reaction);
            
            logEvent('info', `${data.senderName} reacted: ${data.reaction}`);
        } catch (err) {
            console.error('[Reactions] Error processing reaction:', err);
        }
    });
    
    console.log('[Reactions] Signal handlers initialized');
}

// =============================================================================
// AI Interpreter Visual Feedback (Signals)
// =============================================================================

/**
 * Initialize interpreter signal handlers
 */
function initializeInterpreterSignals(session) {
    // Listen for interpreter active state changes from other users
    session.on('signal:interpreter-active', (event) => {
        if (event.from.connectionId === openviduClient.session.connection.connectionId) return;
        
        const data = JSON.parse(event.data);
        const connectionId = event.from.connectionId;
        updateRemoteInterpreterAvatar(connectionId, 'active', data.active);
    });
    
    // Listen for AI speaking state changes from other users
    session.on('signal:ai-speaking', (event) => {
        if (event.from.connectionId === openviduClient.session.connection.connectionId) return;
        
        const data = JSON.parse(event.data);
        const connectionId = event.from.connectionId;
        updateRemoteInterpreterAvatar(connectionId, 'speaking', data.speaking);
    });
    
    // Listen for AI listening state changes from other users
    session.on('signal:ai-listening', (event) => {
        if (event.from.connectionId === openviduClient.session.connection.connectionId) return;
        
        const data = JSON.parse(event.data);
        const connectionId = event.from.connectionId;
        updateRemoteInterpreterAvatar(connectionId, 'listening', data.listening);
    });
}

/**
 * Send interpreter active state signal to all participants
 */
function sendInterpreterActiveSignal(active) {
    if (!openviduClient.session) return;
    
    openviduClient.session.signal({
        data: JSON.stringify({ active }),
        type: 'interpreter-active'
    }).catch(err => console.error('Error sending interpreter signal:', err));
    
    // Update local AI avatar
    updateLocalInterpreterAvatar('active', active);
}

/**
 * Send AI speaking state signal to all participants
 */
function sendAiSpeakingSignal(speaking) {
    if (!openviduClient.session) return;
    
    openviduClient.session.signal({
        data: JSON.stringify({ speaking }),
        type: 'ai-speaking'
    }).catch(err => console.error('Error sending AI speaking signal:', err));
    
    // Update local AI avatar speaking state
    updateLocalInterpreterAvatar('speaking', speaking);
}

/**
 * Send AI listening state signal to all participants
 */
function sendAiListeningSignal(listening) {
    if (!openviduClient.session) return;
    
    openviduClient.session.signal({
        data: JSON.stringify({ listening }),
        type: 'ai-listening'
    }).catch(err => console.error('Error sending AI listening signal:', err));
    
    // Update local AI avatar listening state
    updateLocalInterpreterAvatar('listening', listening);
}

/**
 * Update local user's AI interpreter avatar
 * @param {string} stateType - 'active', 'listening', or 'speaking'
 * @param {boolean} value - true to enable state, false to disable
 */
function updateLocalInterpreterAvatar(stateType, value) {
    const aiAvatar = document.getElementById('localAiAvatar');
    
    if (!aiAvatar) return;
    
    if (stateType === 'active') {
        // Interpreter activated/deactivated
        if (value) {
            aiAvatar.classList.add('active');
        } else {
            aiAvatar.classList.remove('active', 'listening', 'speaking');
        }
        aiAvatar.innerHTML = '<i data-lucide="bot"></i>';
    } else if (stateType === 'listening') {
        // AI is listening to speech
        if (value) {
            aiAvatar.classList.add('listening');
            aiAvatar.classList.remove('speaking');
            aiAvatar.innerHTML = '<i data-lucide="ear"></i>';
        } else {
            aiAvatar.classList.remove('listening');
            aiAvatar.innerHTML = '<i data-lucide="bot"></i>';
        }
    } else if (stateType === 'speaking') {
        // AI is speaking translation
        if (value) {
            aiAvatar.classList.add('speaking');
            aiAvatar.classList.remove('listening');
            aiAvatar.innerHTML = '<i data-lucide="volume-2"></i>';
        } else {
            aiAvatar.classList.remove('speaking');
            aiAvatar.innerHTML = '<i data-lucide="bot"></i>';
        }
    }
    
    // Refresh lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons({ nodes: [aiAvatar] });
    }
}

/**
 * Update remote user's AI interpreter avatar
 * @param {string} connectionId - Remote participant's connection ID
 * @param {string|boolean} stateType - 'active', 'listening', 'speaking', or boolean for backward compat
 * @param {boolean} value - true to enable state, false to disable
 */
function updateRemoteInterpreterAvatar(connectionId, stateType, value) {
    const aiAvatar = document.getElementById(`ai-avatar-${connectionId}`);
    
    if (!aiAvatar) return;
    
    // Handle backward compatibility (boolean active parameter)
    if (typeof stateType === 'boolean') {
        if (stateType) {
            aiAvatar.classList.add('active');
        } else {
            aiAvatar.classList.remove('active', 'listening', 'speaking');
        }
        aiAvatar.innerHTML = '<i data-lucide="bot"></i>';
    } else if (stateType === 'active') {
        if (value) {
            aiAvatar.classList.add('active');
        } else {
            aiAvatar.classList.remove('active', 'listening', 'speaking');
        }
        aiAvatar.innerHTML = '<i data-lucide="bot"></i>';
    } else if (stateType === 'listening') {
        if (value) {
            aiAvatar.classList.add('listening');
            aiAvatar.classList.remove('speaking');
            aiAvatar.innerHTML = '<i data-lucide="ear"></i>';
        } else {
            aiAvatar.classList.remove('listening');
            aiAvatar.innerHTML = '<i data-lucide="bot"></i>';
        }
    } else if (stateType === 'speaking') {
        if (value) {
            aiAvatar.classList.add('speaking');
            aiAvatar.classList.remove('listening');
            aiAvatar.innerHTML = '<i data-lucide="volume-2"></i>';
        } else {
            aiAvatar.classList.remove('speaking');
            aiAvatar.innerHTML = '<i data-lucide="bot"></i>';
        }
    }
    
    // Refresh lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons({ nodes: [aiAvatar] });
    }
}

// =============================================================================
// OpenVidu Event Handlers
// =============================================================================

function setupOpenViduCallbacks() {
    openviduClient.onStreamCreated = (event, subscriber) => {
        const stream = event.stream;
        const connectionId = stream.connection.connectionId;
        const connectionData = parseOpenViduConnectionData(stream.connection);
        
        // Detailed logging for debugging
        logEvent('info', `=== Stream Created Event ===`);
        logEvent('info', `Connection ID: ${connectionId}`);
        logEvent('info', `Stream typeOfVideo: ${stream.typeOfVideo}`);
        
        // Check if this is a screen share stream
        const isScreenShare = stream.typeOfVideo === 'SCREEN';
        logEvent('info', `Is Screen Share: ${isScreenShare}`);
        
        if (isScreenShare) {
            // Create screen share video element (for both local sharer and remote viewers)
            logEvent('info', `Creating screen share element...`);
            createRemoteScreenShareElement(subscriber);
            logEvent('info', `Screen share displayed from ${connectionId}`);
        } else {
            // Skip creating camera element for screen share connections (they only publish SCREEN)
            if (connectionData.isScreenShare) {
                logEvent('info', `Skipping camera element for screen share connection`);
                return;
            }
            
            // Regular camera stream
            logEvent('info', `Creating regular video element for ${connectionId}`);
            createRemoteVideoElement(subscriber);
            
            // Add to participants panel
            addParticipantToPanel(connectionId, connectionData.nickname, false, connectionData.role);
            syncParticipantRolesFromSession();
            
            updateParticipantCount();
            updateAudioTracksDebug();
            updateInterpreterButtonState();
            
            // Play notification sound for new participant
            playJoinSound();
            
            // Update transcription button state
            updateTranscriptionButtonState();
            
            // Set up speaking detection for remote participant
            subscriber.on('streamPlaying', async () => {
                const audioTrack = openviduClient.extractAudioTrack(connectionId, subscriber);
                if (audioTrack) {
                    setupRemoteSpeakingDetection(connectionId, audioTrack);
                    
                    // If interpreter is active, add this participant
                    if (appState.isInterpreterActive) {
                        const participantInfo = getRemoteParticipantInfo(connectionId);
                        if (participantInfo) {
                            await interpreterManager.addParticipant(participantInfo);
                        }
                    }
                    
                    // If transcription is active, add this participant
                    if (appState.isTranscriptionActive) {
                        const participantInfo = getRemoteParticipantInfo(connectionId);
                        if (participantInfo) {
                            await transcriptionManager.addParticipant(participantInfo);
                        }
                    }
                }
                
                // Broadcast current interpreter state to new participant
                if (appState.isInterpreterActive) {
                    sendInterpreterActiveSignal(true);
                }
            });
        }
    };
    
    openviduClient.onStreamPropertyChanged = (event) => {
        const connectionId = event.stream.connection.connectionId;
        const wrapper = document.getElementById(`video-${connectionId}`);
        const avatar = document.getElementById(`avatar-${connectionId}`);
        
        if (wrapper && avatar && event.changedProperty === 'videoActive') {
            if (event.newValue) {
                // Video turned ON
                wrapper.classList.remove('camera-off');
                avatar.classList.remove('visible');
            } else {
                // Video turned OFF
                wrapper.classList.add('camera-off');
                avatar.classList.add('visible');
            }
        }
    };
    
    openviduClient.onStreamDestroyed = (event) => {
        const stream = event.stream;
        const connectionId = stream.connection.connectionId;
        const isScreenShare = stream.typeOfVideo === 'SCREEN';
        
        if (isScreenShare) {
            // Remove remote screen share
            removeRemoteScreenShareElement(connectionId);
            logEvent('info', `Remote screen share ended from ${connectionId}`);
        } else {
            const hadParticipant = participantsData.has(connectionId);
            removeRemoteVideoElement(connectionId);
            removeParticipantFromPanel(connectionId);
            cleanupRemoteSpeakingDetection(connectionId);
            updateParticipantCount();
            updateAudioTracksDebug();
            updateInterpreterButtonState();
            if (hadParticipant) {
                playLeaveSound();
            }
            
            // Update transcription button state
            updateTranscriptionButtonState();
            
            // Remove interpreter for this participant if active
            if (interpreterManager.isActive) {
                interpreterManager.removeParticipant(connectionId);
            }
            
            // Remove transcription for this participant if active
            if (transcriptionManager.isActive) {
                transcriptionManager.removeParticipant(connectionId);
            }
        }
    };
    
    openviduClient.onConnectionCreated = (event) => {
        const { connection } = event;
        const localConnectionId = openviduClient.session?.connection?.connectionId;

        if (!connection || connection.connectionId === localConnectionId) {
            updateParticipantCount();
            return;
        }

        const connectionData = parseOpenViduConnectionData(connection);
        if (!connectionData.isScreenShare) {
            createRemoteVideoElement(connection);
            addParticipantToPanel(connection.connectionId, connectionData.nickname, false, connectionData.role);
            syncParticipantRolesFromSession();
            playJoinSound();
        }

        updateParticipantCount();
        updateInterpreterButtonState();
        updateTranscriptionButtonState();
    };
    
    openviduClient.onConnectionDestroyed = (event) => {
        const connectionId = event.connection.connectionId;
        const connectionData = parseOpenViduConnectionData(event.connection);
        removeRemoteVideoElement(connectionId);
        if (!connectionData.isScreenShare) {
            const hadParticipant = participantsData.has(connectionId);
            removeParticipantFromPanel(connectionId);
            if (hadParticipant) {
                playLeaveSound();
            }
        }
        updateParticipantCount();
        updateAudioTracksDebug();
    };
    
    openviduClient.onException = (exception) => {
        console.error('OpenVidu Exception:', exception);
        
        // Don't show alert for ICE disconnections - they're usually temporary
        if (exception.name !== 'ICE_CONNECTION_DISCONNECTED') {
            if (exception.name === 'ICE_CONNECTION_FAILED') {
                handleConnectionLost('Connection failed');
            }
        }
    };
    
    openviduClient.onLog = (type, message) => {
        logEvent(type, message);
    };

    // Handle reconnection events
    openviduClient.onReconnecting = () => {
        updateConnectionStatus(false);
        elements.connectionStatus.textContent = 'Reconnecting...';
        elements.connectionStatus.style.background = '#f59e0b'; // Orange
        logEvent('warn', 'Attempting to reconnect...');
        clearReconnectTimeout();
        reconnectTimeoutId = setTimeout(() => {
            handleConnectionLost('Connection lost');
        }, 12000);
    };

    openviduClient.onReconnected = () => {
        clearReconnectTimeout();
        updateConnectionStatus(true);
        logEvent('info', 'Connection restored!');
    };

    openviduClient.onIceFailure = (exception) => {
        handleConnectionLost('Connection failed');
    };

    openviduClient.onSessionDisconnected = (event) => {
        if (isLeavingSessionIntentional) {
            return;
        }

        const reason = event?.reason === 'networkDisconnect'
            ? 'Connection lost'
            : 'Session disconnected';
        handleConnectionLost(reason);
    };
}

function clearReconnectTimeout() {
    if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
    }
}

function handleConnectionLost(reason = 'Connection lost') {
    if (isLeavingSessionIntentional || hasHandledConnectionLoss) {
        return;
    }

    hasHandledConnectionLoss = true;
    clearReconnectTimeout();

    if (appState.isInterpreterActive) {
        stopInterpreter();
    }

    updateConnectionStatus(false);
    showNotification(`${reason}. You have been returned to the waiting room.`, 'error');
    logEvent('error', `${reason}. Returned to waiting room.`);
    leaveSession();
}

// =============================================================================
// Main Application Flow
// =============================================================================

/**
 * Join a conference session
 */
async function joinSession(sessionId, nickname, preferredLanguage) {
    try {
        const resolvedSessionId = resolveBoundSessionId(sessionId);
        if (resolvedSessionId !== sessionId) {
            elements.sessionIdInput.value = resolvedSessionId;
            elements.roomIdDisplay.textContent = resolvedSessionId;
            logEvent('warn', `Room mismatch detected. Using bound room ${resolvedSessionId} instead of ${sessionId}`);
        }

        isLeavingSessionIntentional = false;
        hasHandledConnectionLoss = false;
        clearReconnectTimeout();
        logEvent('info', `Joining session: ${resolvedSessionId}`);
        
        // Update state from preview settings
        appState.sessionId = resolvedSessionId;
        appState.nickname = nickname;
        appState.preferredLanguage = preferredLanguage;
        appState.isAudioEnabled =
            previewState.hasAudioInput &&
            previewState.audioPermission !== 'denied' &&
            previewState.isAudioEnabled;
        appState.isVideoEnabled =
            previewState.hasVideoInput &&
            previewState.videoPermission !== 'denied' &&
            previewState.isVideoEnabled;
        
        // Stop preview stream before joining
        stopPreview();
        
        // Get token from backend
        logEvent('info', 'Requesting token from backend...');
        const { token } = await getToken(resolvedSessionId, nickname, preferredLanguage);
        logEvent('info', 'Token received');
        
        // Initialize OpenVidu
        setupOpenViduCallbacks();
        openviduClient.init();
        
        // Connect to session
        logEvent('info', 'Connecting to OpenVidu...');
        await openviduClient.connect(token);
        updateConnectionStatus(true);
        
        // Show conference UI
        showConferenceRoom();
        
        const canPublishAudio =
            previewState.hasAudioInput && previewState.audioPermission === 'granted';
        const canPublishVideo =
            previewState.hasVideoInput && previewState.videoPermission === 'granted';

        if (canPublishAudio || canPublishVideo) {
            logEvent('info', 'Publishing local stream...');
            await publishLocalStreamWithCurrentPermissions();
        } else {
            logEvent('info', 'Joined session without local media devices');
        }

        updateMediaAvailabilityUI();
        logEvent('info', 'Successfully joined session!');
        
        // Set up local speaking detection
        if (openviduClient.publisher && openviduClient.publisher.stream) {
            const mediaStream = openviduClient.publisher.stream.getMediaStream();
            if (mediaStream) {
                setupLocalSpeakingDetection(mediaStream);
            }
        }
        
        // Initialize chat
        initializeChat(openviduClient.session);
        
        // Initialize whiteboard
        whiteboardManager.initialize(openviduClient.session);
        
        // Initialize reactions
        initializeReactionSignals(openviduClient.session);
        
        // Initialize interpreter signals
        initializeInterpreterSignals(openviduClient.session);
        
        // Initialize participants panel with local user
        const localConnectionId = openviduClient.session.connection.connectionId;
        appState.currentParticipantId = localConnectionId;
        addParticipantToPanel(localConnectionId, nickname, true, appState.authRole || 'participant');
        await refreshCurrentPermissions({ silent: true });
        await syncParticipantRolesFromSession();
        connectPermissionsWebSocket();
        
        // Register signal handlers for participants panel (mute/kick)
        openviduClient.session.on('signal:requestMute', handleMuteRequest);
        openviduClient.session.on('signal:kick', handleKickSignal);
        
    } catch (error) {
        console.error('Error joining session:', error);
        logEvent('error', `Failed to join: ${error.message}`);
        alert(`Failed to join session: ${error.message}`);
        updateConnectionStatus(false);
    }
}

/**
 * Toggle screen sharing
 */
async function toggleScreenShare() {
    if (!canShareScreen()) {
        showNotification('You do not have permission to share to the stage.', 'error');
        return;
    }

    if (appState.isScreenSharing) {
        // Stop screen sharing
        await stopScreenShare();
    } else {
        // Start screen sharing
        await startScreenShare();
    }
}

/**
 * Start screen sharing
 * Creates a separate OpenVidu session/connection for screen share
 * (OpenVidu doesn't allow multiple publishers from same connection)
 */
async function startScreenShare() {
    try {
        logEvent('info', 'Starting screen share...');
        
        if (!appState.sessionId) {
            logEvent('error', 'No active session');
            return;
        }
        
        // Step 1: Get a new token for screen share connection
        logEvent('info', 'Step 1: Getting new token for screen share...');
        const tokenData = await getToken(appState.sessionId, `${appState.nickname} (Screen)`, appState.preferredLanguage);
        const screenToken = tokenData.token;
        logEvent('info', 'Step 2: Token received for screen share');
        
        // Step 2: Create new OpenVidu instance and session for screen share
        const screenOV = new OpenVidu();
        const screenSession = screenOV.initSession();
        
        // Step 3: Connect to session with new token
        logEvent('info', 'Step 3: Connecting screen share session...');
        await screenSession.connect(screenToken, JSON.stringify({ 
            nickname: `${appState.nickname} (Screen)`,
            preferredLanguage: appState.preferredLanguage,
            isScreenShare: true
        }));
        
        // Store the screen share connection ID to filter it out from remote streams
        appState.screenConnectionId = screenSession.connection.connectionId;
        logEvent('info', `Step 4: Screen share session connected (${appState.screenConnectionId})`);
        
        // Step 4: Initialize screen share publisher
        logEvent('info', 'Step 5: Initializing screen publisher...');
        const screenPublisher = await screenOV.initPublisherAsync(undefined, {
            videoSource: 'screen',
            publishAudio: false,
            publishVideo: true,
            mirror: false
        });
        logEvent('info', 'Step 6: Screen publisher created');
        
        // Handle when user stops sharing via browser UI
        const mediaStream = screenPublisher.stream.getMediaStream();
        if (mediaStream) {
            const videoTracks = mediaStream.getVideoTracks();
            if (videoTracks.length > 0) {
                videoTracks[0].addEventListener('ended', () => {
                    logEvent('info', 'Screen share stopped by user');
                    stopScreenShare();
                });
            }
        }
        
        // Step 5: Publish screen share stream (no local preview - we'll see it via main session)
        logEvent('info', 'Step 7: Publishing screen share...');
        // Note: We don't create a local preview because the main session will receive
        // our own screen share stream and display it (filtered by screenConnectionId for others)
        logEvent('info', 'Step 8: Publishing screen share...');
        await screenSession.publish(screenPublisher);
        logEvent('info', 'Step 9: Screen share published successfully!');
        
        // Store references for cleanup
        appState.screenOV = screenOV;
        appState.screenSession = screenSession;
        appState.screenPublisher = screenPublisher;
        appState.isScreenSharing = true;
        
        // Update layout to presentation mode
        elements.videoGrid.classList.add('presentation-mode');
        
        // Update button state
        elements.toggleScreenShareBtn.classList.add('sharing');
        elements.toggleScreenShareBtn.innerHTML = '<i data-lucide="monitor-off"></i>';
        lucide.createIcons();
        
        logEvent('info', 'Screen sharing active and visible to others');
        
    } catch (error) {
        logEvent('error', `Screen share error: ${error?.message || error}`);
        console.error('Screen share error:', error);
        
        // Clean up
        const screenWrapper = document.getElementById('screenShareWrapper');
        if (screenWrapper) {
            screenWrapper.remove();
        }
        
        if (error?.name === 'NotAllowedError') {
            logEvent('warn', 'Screen share cancelled by user');
        }
    }
}

/**
 * Stop screen sharing
 */
async function stopScreenShare() {
    try {
        logEvent('info', 'Stopping screen share...');
        
        // Disconnect the screen share session
        if (appState.screenSession) {
            try {
                appState.screenSession.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
            appState.screenSession = null;
        }
        
        // Clean up screen publisher
        if (appState.screenPublisher) {
            try {
                appState.screenPublisher.stream.disposeWebRtcPeer();
                appState.screenPublisher.stream.disposeMediaStream();
            } catch (e) {
                // Ignore dispose errors
            }
            appState.screenPublisher = null;
        }
        
        // Clean up OpenVidu instance and connection ID
        appState.screenOV = null;
        appState.screenConnectionId = null;
        
        appState.isScreenSharing = false;
        appState.activeScreenShareConnectionId = null;
        
        // Only remove presentation mode if there are no other screen shares
        const remainingScreenShares = document.querySelectorAll('.screen-share-video');
        if (remainingScreenShares.length === 0) {
            elements.videoGrid.classList.remove('presentation-mode');
        }
        
        // Update button state
        elements.toggleScreenShareBtn.classList.remove('sharing');
        elements.toggleScreenShareBtn.innerHTML = '<i data-lucide="monitor-up"></i>';
        lucide.createIcons();
        
        logEvent('info', 'Screen sharing stopped');
        
    } catch (error) {
        logEvent('error', `Error stopping screen share: ${error?.message || error}`);
    }
}

/**
 * Leave the current session
 */
function leaveSession() {
    isLeavingSessionIntentional = true;
    clearReconnectTimeout();
    disconnectPermissionsWebSocket();

    // Stop screen sharing if active
    if (appState.isScreenSharing) {
        stopScreenShare();
    }
    
    // Stop interpreter if active
    if (appState.isInterpreterActive) {
        stopInterpreter();
    }
    
    // Stop transcription if active
    if (appState.isTranscriptionActive) {
        stopTranscription();
    }
    
    // Clean up chat
    chatManager.destroy();
    resetChatUI();
    
    // Clean up participants panel
    resetParticipantsPanel();
    
    // Stop speaking detection
    stopSpeakingDetection();
    
    openviduClient.disconnect();
    updateConnectionStatus(false);
    
    // Clear remote videos
    const remoteVideos = document.querySelectorAll('.remote-video');
    remoteVideos.forEach(el => el.remove());
    
    // Reset state
    appState.sessionId = null;
    appState.currentParticipantId = null;
    appState.isAudioEnabled = true;
    appState.isVideoEnabled = true;
    appState.isInterpreterActive = false;
    appState.isTranscriptionActive = false;
    appState.sessionFeatures = {
        chatEnabled: true,
        whiteboardEnabled: true,
        subtitlesEnabled: true,
        aiInterpretationEnabled: false,
    };
    appState.isScreenSharing = false;
    appState.screenPublisher = null;
    appState.screenSession = null;
    appState.screenOV = null;
    appState.screenConnectionId = null;
    appState.activeScreenShareConnectionId = null;
    elements.toggleAudioBtn.classList.remove('muted');
    elements.toggleVideoBtn.classList.remove('muted');
    elements.toggleScreenShareBtn.classList.remove('sharing');
    elements.toggleInterpreterBtn.disabled = true;
    elements.toggleInterpreterBtn.classList.remove('active');
    elements.toggleInterpreterBtn.textContent = '🌐 AI Interpreter';
    elements.toggleTranscriptionBtn.disabled = true;
    elements.toggleTranscriptionBtn.classList.remove('active');
    elements.toggleTranscriptionBtn.innerHTML = '<i data-lucide="subtitles"></i><span>Subtitles</span>';
    lucide.createIcons();
    
    showJoinForm();
    logEvent('info', 'Left session');
    isLeavingSessionIntentional = false;
}

// =============================================================================
// Event Listeners
// =============================================================================

// Join form submission
elements.joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const sessionId = elements.sessionIdInput.value.trim();
    const nickname = elements.nicknameInput.value.trim();
    const preferredLanguage = elements.languageSelect.value;
    
    if (!sessionId || !nickname) {
        alert('Please enter both Room Name and Your Name');
        return;
    }
    
    // Find submit button and protect against multiple clicks
    const submitBtn = elements.joinForm.querySelector('button[type="submit"]');
    if (submitBtn) {
        await withButtonProtection(submitBtn, async () => {
            await joinSession(sessionId, nickname, preferredLanguage);
        }, { loadingText: '<i data-lucide="loader-2" class="animate-spin"></i> Joining...' });
    } else {
        await joinSession(sessionId, nickname, preferredLanguage);
    }
});

// Audio toggle
elements.toggleAudioBtn.addEventListener('click', async () => {
    if (!canPublishAudio()) {
        showNotification('You do not have permission to enable your microphone.', 'error');
        return;
    }

    if (!appState.isAudioEnabled && previewState.audioPermission !== 'granted') {
        const granted = await requestDevicePermission('audio');
        if (!granted) return;

        appState.isAudioEnabled = true;
        if (!openviduClient.publisher || !localPublisherHasTrack('audio')) {
            await publishLocalStreamWithCurrentPermissions();
        }
    }

    const audioError = getDeviceAccessError('audio');
    if (audioError) {
        showNotification(audioError, 'error');
        return;
    }

    if (openviduClient.publisher && localPublisherHasTrack('audio')) {
        appState.isAudioEnabled = openviduClient.toggleAudio();
    }
    elements.toggleAudioBtn.classList.toggle('muted', !appState.isAudioEnabled);
    elements.toggleAudioBtn.innerHTML = appState.isAudioEnabled 
        ? '<i data-lucide="mic"></i>' 
        : '<i data-lucide="mic-off"></i>';
    lucide.createIcons();
});

// Video toggle
elements.toggleVideoBtn.addEventListener('click', async () => {
    if (!canPublishVideo()) {
        showNotification('You do not have permission to enable your camera.', 'error');
        return;
    }

    if (!appState.isVideoEnabled && previewState.videoPermission !== 'granted') {
        const granted = await requestDevicePermission('video');
        if (!granted) return;

        appState.isVideoEnabled = true;
        if (!openviduClient.publisher || !localPublisherHasTrack('video')) {
            await publishLocalStreamWithCurrentPermissions();
        }
    }

    const videoError = getDeviceAccessError('video');
    if (videoError) {
        showNotification(videoError, 'error');
        return;
    }

    if (openviduClient.publisher && localPublisherHasTrack('video')) {
        appState.isVideoEnabled = openviduClient.toggleVideo();
    }
    elements.toggleVideoBtn.classList.toggle('muted', !appState.isVideoEnabled);
    elements.toggleVideoBtn.innerHTML = appState.isVideoEnabled 
        ? '<i data-lucide="video"></i>' 
        : '<i data-lucide="video-off"></i>';
    lucide.createIcons();
    
    // Show/hide local avatar
    const localWrapper = document.getElementById('localVideoWrapper');
    const localAvatar = document.getElementById('localAvatar');
    if (appState.isVideoEnabled) {
        localWrapper.classList.remove('camera-off');
        localAvatar.classList.remove('visible');
    } else {
        localWrapper.classList.add('camera-off');
        localAvatar.classList.add('visible');
    }
    logEvent('info', appState.isVideoEnabled ? 'Video enabled' : 'Video disabled');
});

// Leave session
elements.leaveSessionBtn.addEventListener('click', () => {
    leaveSession();
});

// Screen share toggle
elements.toggleScreenShareBtn.addEventListener('click', async () => {
    await withButtonProtection(elements.toggleScreenShareBtn, async () => {
        await toggleScreenShare();
    });
});

// AI Interpreter toggle
elements.toggleInterpreterBtn.addEventListener('click', async () => {
    await withButtonProtection(elements.toggleInterpreterBtn, async () => {
        await toggleInterpreter();
    });
});

// Debug panel toggle
elements.toggleDebugBtn.addEventListener('click', () => {
    elements.debugPanel.classList.toggle('visible');
});

// Preview controls
elements.previewToggleMic.addEventListener('click', togglePreviewMic);
elements.previewToggleVideo.addEventListener('click', togglePreviewVideo);

// Device selectors
elements.microphoneSelect.addEventListener('change', () => handleDeviceChange('microphone'));
elements.cameraSelect.addEventListener('change', () => handleDeviceChange('camera'));
elements.speakerSelect.addEventListener('change', () => handleDeviceChange('speaker'));

// Meeting controls
elements.createMeetingBtn.addEventListener('click', async () => {
    await withButtonProtection(elements.createMeetingBtn, async () => {
        await createNewMeeting();
    }, { loadingText: '<i data-lucide="loader-2" class="animate-spin"></i> Creating...' });
});
elements.shareMeetingBtn.addEventListener('click', copyMeetingLink);

// Transcription toggle
elements.toggleTranscriptionBtn.addEventListener('click', async () => {
    await withButtonProtection(elements.toggleTranscriptionBtn, async () => {
        await toggleTranscription();
    });
});

// Chat controls
elements.toggleChatBtn.addEventListener('click', toggleChat);
elements.closeChatBtn.addEventListener('click', closeChat);
elements.sendChatBtn.addEventListener('click', sendChatMessage);
elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
});
elements.chatTranslateToggle.addEventListener('change', toggleChatTranslation);

// Participants panel controls
elements.toggleParticipantsBtn.addEventListener('click', toggleParticipants);
elements.closeParticipantsBtn.addEventListener('click', closeParticipants);

// Whiteboard controls
elements.toggleWhiteboardBtn.addEventListener('click', toggleWhiteboardForCurrentRole);

// Reactions controls
elements.toggleReactionsBtn?.addEventListener('click', toggleReactionsPopup);
document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const reaction = btn.dataset.reaction;
        sendReaction(reaction);
        hideReactionsPopup();
    });
});

// Close reactions popup when clicking outside
document.addEventListener('click', (e) => {
    if (elements.reactionsPopup?.classList.contains('show')) {
        if (!e.target.closest('.reactions-container')) {
            hideReactionsPopup();
        }
    }

    if (!e.target.closest('.participant-access')) {
        closeParticipantAccessMenu();
    }
});

window.addEventListener('resize', () => {
    if (elements.reactionsPopup?.classList.contains('show')) {
        positionReactionsPopup();
    }
});

window.addEventListener('scroll', () => {
    if (elements.reactionsPopup?.classList.contains('show')) {
        positionReactionsPopup();
    }
}, true);

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    disconnectPermissionsWebSocket();
    stopPreview();
    if (appState.isConnected) {
        openviduClient.disconnect();
    }
});

// =============================================================================
// Initialization
// =============================================================================

// Show debug panel by default in debug mode
if (CONFIG.DEBUG) {
    elements.debugPanel.classList.add('visible');
}

// Initialize Lucide icons
lucide.createIcons();

// Initialize page based on URL (home vs room)
loadBootstrapSession();
initializePage();
refreshCurrentPermissions({ silent: true });

// Initialize preview
initPreview();

// Local-only layout tester for gallery/presentation verification
initializeLayoutTester();

logEvent('info', 'Application initialized');
logEvent('info', `Backend URL: ${CONFIG.BACKEND_URL}`);
