// @ts-nocheck
/**
 * Main Application Controller
 * 
 * Orchestrates the UI and LiveKit client
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

/**
 * Play a short waiting room notification for hosts/co-hosts
 * Slight two-tone chime so it feels distinct from join/leave
 */
function playWaitingRoomSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(() => null);
        }

        const now = audioContext.currentTime;
        const masterGain = audioContext.createGain();
        masterGain.gain.setValueAtTime(0.05, now);
        masterGain.connect(audioContext.destination);

        [
            { frequency: 880, start: now, duration: 0.12 },
            { frequency: 1175, start: now + 0.14, duration: 0.16 },
        ].forEach((tone) => {
            const osc = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(tone.frequency, tone.start);
            gainNode.gain.setValueAtTime(0, tone.start);
            gainNode.gain.linearRampToValueAtTime(1, tone.start + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.001, tone.start + tone.duration);

            osc.connect(gainNode);
            gainNode.connect(masterGain);
            osc.start(tone.start);
            osc.stop(tone.start + tone.duration);
        });
    } catch (e) {
        console.log('Could not play waiting room notification sound:', e);
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
    currentRoomTarget: {
        type: 'main',
        breakoutRoomId: null,
        livekitRoomName: null,
        displayName: 'Main room',
    },
    breakoutRooms: [],
    participantLocations: {},
    participantProfiles: {},
    participantRoles: {},
    participantPresence: {},
    participantPermissionState: {},
    participantMediaConnections: {},
    waitingRoomRequests: [],
    waitingRoomRequestId: null,
    isWaitingForAdmission: false,
    whiteboardState: {
        main: { isOpen: false, canvasState: null, updatedAt: null },
        breakouts: {},
    },
    currentSessionSnapshotRevision: null,
    sessionFeatures: {
        chatEnabled: true,
        groupChatEnabled: false,
        whiteboardEnabled: true,
        subtitlesEnabled: true,
        aiInterpretationEnabled: false,
    },
    currentPermissions: [],
    currentParticipantId: null,
    currentRootParticipantId: null,
    isConnected: false,
    isAudioEnabled: true,
    isVideoEnabled: true,
    publishedAudioLive: false,
    publishedVideoLive: false,
    isInterpreterActive: false,
    isTranscriptionActive: false,
    isChatOpen: false,
    isParticipantsOpen: false,
    isBreakoutsOpen: false,
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
    editNicknameBtn: document.getElementById('editNicknameBtn'),
    languageSelect: document.getElementById('preferredLanguage'),
    waitingRoomCard: document.getElementById('waitingRoomCard'),
    waitingRoomStatus: document.getElementById('waitingRoomStatus'),
    waitingRoomMeta: document.getElementById('waitingRoomMeta'),
    cancelWaitingRoomBtn: document.getElementById('cancelWaitingRoomBtn'),
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
    groupChatToggleWrapper: document.getElementById('groupChatToggleWrapper'),
    groupChatToggle: document.getElementById('groupChatToggle'),
    sendChatBtn: document.getElementById('sendChatBtn'),
    closeChatBtn: document.getElementById('closeChatBtn'),
    chatBadge: document.getElementById('chatBadge'),
    chatTranslateToggle: document.getElementById('chatTranslateToggle'),
    // Whiteboard elements
    whiteboardActions: document.getElementById('whiteboardActions'),
    toggleWhiteboardBtn: document.getElementById('toggleWhiteboard'),
    toggleWhiteboardMenuBtn: document.getElementById('toggleWhiteboardMenu'),
    whiteboardMenu: document.getElementById('whiteboardMenu'),
    advancedWhiteboardLink: document.getElementById('advancedWhiteboardLink'),
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
    closeParticipantsBtn: document.getElementById('closeParticipantsBtn'),
    waitingRoomBadge: document.getElementById('waitingRoomBadge'),
    toggleBreakoutsBtn: document.getElementById('toggleBreakouts'),
    breakoutsPanel: document.getElementById('breakoutsPanel'),
    breakoutsContent: document.getElementById('breakoutsContent'),
    createBreakoutBtn: document.getElementById('createBreakoutBtn'),
    closeBreakoutsBtn: document.getElementById('closeBreakoutsBtn')
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
let isSwitchingRooms = false;
let waitingRoomPollIntervalId = null;
let waitingRoomAutoJoinInProgress = false;
let waitingRoomNotificationPrimed = false;
let knownPendingWaitingRoomRequestIds = new Set();
const ENABLE_LAYOUT_TESTER = CONFIG.DEBUG || window.location.hostname === 'localhost';
const MOCK_PARTICIPANT_PREFIX = 'mock-participant-';
const BOOTSTRAP_COOKIE_NAME = 'voycelink_bootstrap';
const NICKNAME_STORAGE_KEY = 'voycelink_nickname';
const ROOM_PARTICIPANT_STORAGE_PREFIX = 'voycelink_room_participant_';
const WAITING_ROOM_REQUEST_STORAGE_PREFIX = 'voycelink_waiting_room_request_';
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
    UPDATE_ROOM_CONFIGURATION: 'update_room_configuration',
    MANAGE_BREAKOUT_ROOMS: 'manage_breakout_rooms',
    JOIN_BREAKOUT_ROOM: 'join_breakout_room',
    MOVE_PARTICIPANT_BETWEEN_ROOMS: 'move_participant_between_rooms',
    ASSIGN_COHOST: 'assign_cohost',
    REMOVE_COHOST: 'remove_cohost',
    ADMIT_WAITING_ROOM: 'admit_waiting_room'
};
let permissionsSocket = null;
let permissionsSocketReconnectTimeoutId = null;
let activeParticipantAccessMenuId = null;
let isWhiteboardMenuOpen = false;

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
    logEvent('info', 'Create meeting clicked: requesting new host room');
    const bootstrapResponse = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.HOST_SESSION_BOOTSTRAP}`,
        { method: 'POST' }
    );

    if (!bootstrapResponse.ok) {
        const error = await bootstrapResponse.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to initialize host session');
    }

    const bootstrapData = await bootstrapResponse.json();
    loadBootstrapSession();
    await refreshCurrentPermissions({ silent: true });

    const roomId = bootstrapData.roomId || appState.authRoomId;
    if (!roomId) {
        showNotification('Unable to create meeting. Please reload the page.', 'error');
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

async function getInviteMeetingUrl() {
    if (!appState.sessionId) {
        return getMeetingUrl();
    }

    if (!canCreateMeetings() || appState.authRole !== 'host') {
        return getMeetingUrl();
    }

    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_INVITE_LINK(appState.sessionId)}`
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to generate invite link');
    }

    const payload = await response.json();
    return payload.inviteUrl || getMeetingUrl();
}

/**
 * Copy the meeting link to clipboard
 */
async function copyMeetingLink() {
    try {
        const url = await getInviteMeetingUrl();
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
        showNotification(err.message || 'Failed to copy meeting link.', 'error');
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

function getMediaPermissionRestriction(kind) {
    if (kind === 'audio' && !canPublishAudio()) {
        return 'The host has not enabled microphone access for you.';
    }

    if (kind === 'video' && !canPublishVideo()) {
        return 'The host has not enabled camera access for you.';
    }

    return null;
}

function canShareScreen() {
    return hasPermission(Permission.SHARE_SCREEN);
}

function canManageWhiteboard() {
    return hasPermission(Permission.MANAGE_WHITEBOARD);
}

function canManageBreakouts() {
    return hasPermission(Permission.MANAGE_BREAKOUT_ROOMS);
}

function canAssignCoHosts() {
    return hasPermission(Permission.ASSIGN_COHOST);
}

function canRemoveCoHosts() {
    return hasPermission(Permission.REMOVE_COHOST);
}

function canAdmitWaitingRoom() {
    return hasPermission(Permission.ADMIT_WAITING_ROOM);
}

function canManageTargetParticipantRole(targetRole) {
    if (appState.authRole !== 'co_host') {
        return true;
    }

    return targetRole !== 'host' && targetRole !== 'co_host';
}

function getParticipantRoleListLabel(role) {
    if (role === 'host') {
        return 'Host';
    }

    if (role === 'co_host') {
        return 'Co-host';
    }

    return '';
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

function getParticipantStorageKey(sessionId) {
    return `${ROOM_PARTICIPANT_STORAGE_PREFIX}${sessionId}`;
}

function getWaitingRoomRequestStorageKey(sessionId) {
    return `${WAITING_ROOM_REQUEST_STORAGE_PREFIX}${sessionId}`;
}

function getStoredRoomParticipantId(sessionId) {
    if (!sessionId) {
        return null;
    }

    try {
        return localStorage.getItem(getParticipantStorageKey(sessionId)) || null;
    } catch (error) {
        return null;
    }
}

function storeRoomParticipantId(sessionId, participantId) {
    if (!sessionId || !participantId) {
        return;
    }

    try {
        localStorage.setItem(getParticipantStorageKey(sessionId), participantId);
    } catch (error) {
        logEvent('warn', `Failed to persist room participant id: ${error?.message || error}`);
    }
}

function getStoredWaitingRoomRequestId(sessionId) {
    if (!sessionId) {
        return null;
    }

    try {
        return localStorage.getItem(getWaitingRoomRequestStorageKey(sessionId)) || null;
    } catch (error) {
        return null;
    }
}

function storeWaitingRoomRequestId(sessionId, requestId) {
    if (!sessionId || !requestId) {
        return;
    }

    try {
        localStorage.setItem(getWaitingRoomRequestStorageKey(sessionId), requestId);
    } catch (error) {
        logEvent('warn', `Failed to persist waiting room request id: ${error?.message || error}`);
    }
}

function clearStoredWaitingRoomRequestId(sessionId) {
    if (!sessionId) {
        return;
    }

    try {
        localStorage.removeItem(getWaitingRoomRequestStorageKey(sessionId));
    } catch (error) {
        logEvent('warn', `Failed to clear waiting room request id: ${error?.message || error}`);
    }
}

function getCurrentRootParticipantId() {
    return appState.currentRootParticipantId || getStoredRoomParticipantId(appState.sessionId);
}

function isOwnScreenShareConnection(connectionId, connectionData = {}) {
    if (appState.screenConnectionId && connectionId === appState.screenConnectionId) {
        return true;
    }

    return (
        Boolean(connectionData.isScreenShare) &&
        Boolean(connectionData.rootParticipantId) &&
        connectionData.rootParticipantId === getCurrentRootParticipantId()
    );
}

function getMediaConnectionIdForParticipant(participantId) {
    return appState.participantMediaConnections?.[participantId] || null;
}

function getRootParticipantIdForMediaConnection(mediaConnectionId) {
    if (!mediaConnectionId) {
        return null;
    }

    const mappedParticipantId = Object.entries(appState.participantMediaConnections || {}).find(
        ([, candidateMediaConnectionId]) => candidateMediaConnectionId === mediaConnectionId
    )?.[0];

    if (mappedParticipantId) {
        return mappedParticipantId;
    }

    if (mediaConnectionId === appState.currentParticipantId) {
        return getCurrentRootParticipantId();
    }

    return null;
}

function getCurrentRoomWhiteboardState() {
    if (appState.currentRoomTarget?.type === 'breakout' && appState.currentRoomTarget.breakoutRoomId) {
        return (
            appState.whiteboardState?.breakouts?.[appState.currentRoomTarget.breakoutRoomId] || {
                isOpen: false,
                canvasState: null,
                updatedAt: null,
            }
        );
    }

    return appState.whiteboardState?.main || {
        isOpen: false,
        canvasState: null,
        updatedAt: null,
    };
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

function closeWhiteboardMenu() {
    isWhiteboardMenuOpen = false;
    elements.whiteboardMenu?.classList.remove('show');
    elements.toggleWhiteboardMenuBtn?.classList.remove('is-open');
    elements.toggleWhiteboardMenuBtn?.setAttribute('aria-expanded', 'false');
}

function positionWhiteboardMenu() {
    if (!elements.whiteboardMenu || !elements.toggleWhiteboardMenuBtn) {
        return;
    }

    const buttonRect = elements.toggleWhiteboardMenuBtn.getBoundingClientRect();
    const menu = elements.whiteboardMenu;

    menu.style.visibility = 'hidden';
    menu.classList.add('show');

    const menuRect = menu.getBoundingClientRect();
    const viewportPadding = 12;
    const left = Math.min(
        Math.max(buttonRect.right - menuRect.width, viewportPadding),
        window.innerWidth - menuRect.width - viewportPadding
    );
    const top = Math.max(buttonRect.top - menuRect.height - 10, viewportPadding);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    menu.classList.remove('show');
    menu.style.visibility = '';
}

function toggleWhiteboardMenu(event) {
    event?.stopPropagation?.();
    if (elements.toggleWhiteboardMenuBtn?.style.display === 'none') {
        return;
    }

    isWhiteboardMenuOpen = !isWhiteboardMenuOpen;
    if (isWhiteboardMenuOpen) {
        positionWhiteboardMenu();
    }
    elements.whiteboardMenu?.classList.toggle('show', isWhiteboardMenuOpen);
    elements.toggleWhiteboardMenuBtn?.classList.toggle('is-open', isWhiteboardMenuOpen);
    elements.toggleWhiteboardMenuBtn?.setAttribute('aria-expanded', isWhiteboardMenuOpen ? 'true' : 'false');
}

function applyPermissionBasedUi() {
    const canCreateMeeting = canCreateMeetings() || !getRoomIdFromUrl();
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
        setElementVisibility(elements.toggleBreakoutsBtn, canManageBreakouts(), '');
        setElementVisibility(elements.whiteboardActions, canManageWhiteboard(), 'inline-flex');
        setElementVisibility(elements.toggleWhiteboardMenuBtn, appState.authRole === 'host', 'inline-flex');
        setElementVisibility(elements.advancedWhiteboardLink, appState.authRole === 'host', 'flex');
        setElementVisibility(
            elements.groupChatToggleWrapper,
            hasPermission(Permission.UPDATE_ROOM_CONFIGURATION),
            'flex'
        );
        if (elements.groupChatToggle) {
            elements.groupChatToggle.checked = appState.sessionFeatures.groupChatEnabled === true;
        }
        setElementVisibility(elements.toggleReactionsBtn, canSendGroupMessages(), '');
        elements.sendChatBtn.disabled = !canSendAnyChatMessages();
        elements.chatInput.disabled = !canSendAnyChatMessages();
        if (elements.chatRecipientSelect) {
            elements.chatRecipientSelect.disabled = !canSendAnyChatMessages();
        }
        if (canSendAnyChatMessages()) {
            elements.chatInput.placeholder = canSendGroupMessages()
                ? 'Type a message...'
                : 'Message the host or co-host...';
        } else {
            elements.chatInput.placeholder = 'Messaging is disabled for your access level';
        }

        if (!canSendGroupMessages()) {
            hideReactionsPopup();
        }

        if (appState.authRole !== 'host') {
            closeWhiteboardMenu();
        }

        if (!canManageBreakouts()) {
            closeBreakoutsPanel();
        }
    }

    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }

    if (appState.isBreakoutsOpen) {
        renderBreakoutsPanel();
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
    appState.participantPermissionState[connectionId] = {
        ...(appState.participantPermissionState[connectionId] || getDefaultParticipantPermissionState()),
        ...permissions,
    };

    const mediaConnectionId = getMediaConnectionIdForParticipant(connectionId) || connectionId;
    const participant = participantsData.get(mediaConnectionId);
    if (participant) {
        participant.permissions = {
            ...(participant.permissions || getDefaultParticipantPermissionState()),
            ...permissions,
        };

        participantsData.set(mediaConnectionId, participant);
    }

    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
}

function normalizeSnapshotRevision(revision) {
    return Number.isFinite(revision) ? Number(revision) : null;
}

function isOutdatedSnapshotPayload(payload = {}) {
    const incomingRevision = normalizeSnapshotRevision(payload.revision);
    const currentRevision = normalizeSnapshotRevision(appState.currentSessionSnapshotRevision);

    if (incomingRevision === null) {
        return currentRevision !== null;
    }

    return currentRevision !== null && incomingRevision < currentRevision;
}

function summarizeSnapshotPayload(payload = {}) {
    const breakoutRooms = Array.isArray(payload.breakoutRooms) ? payload.breakoutRooms : [];
    const participantPresence = payload.participantPresence || {};
    const waitingRoomRequests = Array.isArray(payload.waitingRoomRequests) ? payload.waitingRoomRequests : [];

    return {
        revision: normalizeSnapshotRevision(payload.revision),
        breakoutCount: breakoutRooms.length,
        waitingRoomRequestCount: waitingRoomRequests.length,
        breakoutRooms: breakoutRooms.map((room) => ({
            id: room.id,
            status: room.status,
            participantIds: room.participantIds || [],
        })),
        connectedParticipantCount: Object.values(participantPresence).filter((presence) => presence === 'connected').length,
        participantLocations: payload.participantLocations || {},
        currentRootParticipantId: payload.currentRootParticipantId || null,
    };
}

function updateWaitingRoomBadge() {
    if (!canAdmitWaitingRoom()) {
        elements.waitingRoomBadge.style.display = 'none';
        return;
    }

    const pendingCount = (appState.waitingRoomRequests || []).filter(
        (request) => request?.status === 'pending'
    ).length;

    if (pendingCount > 0) {
        elements.waitingRoomBadge.textContent = pendingCount > 99 ? '99+' : pendingCount;
        elements.waitingRoomBadge.style.display = 'flex';
    } else {
        elements.waitingRoomBadge.style.display = 'none';
    }
}

function syncWaitingRoomNotificationState(payload = {}, options = {}) {
    const { primeOnly = false } = options;
    const pendingRequests = Array.isArray(payload.waitingRoomRequests)
        ? payload.waitingRoomRequests.filter((request) => request?.status === 'pending')
        : [];
    const pendingIds = new Set(
        pendingRequests
            .map((request) => request?.id)
            .filter((requestId) => typeof requestId === 'string' && requestId)
    );

    updateWaitingRoomBadge();

    if (!waitingRoomNotificationPrimed || primeOnly) {
        knownPendingWaitingRoomRequestIds = pendingIds;
        waitingRoomNotificationPrimed = true;
        return;
    }

    const newRequests = pendingRequests.filter(
        (request) => request?.id && !knownPendingWaitingRoomRequestIds.has(request.id)
    );

    knownPendingWaitingRoomRequestIds = pendingIds;

    if (!canAdmitWaitingRoom() || newRequests.length === 0) {
        return;
    }

    playWaitingRoomSound();
    showNotification(
        newRequests.length === 1
            ? `${newRequests[0].nickname || 'A guest'} is waiting to join.`
            : `${newRequests.length} people are waiting to join.`,
        'info'
    );
}

function applyGlobalSessionSnapshot(payload = {}) {
    const incomingRevision = normalizeSnapshotRevision(payload.revision);
    const currentRevision = normalizeSnapshotRevision(appState.currentSessionSnapshotRevision);

    if (incomingRevision === null) {
        if (currentRevision !== null) {
            logEvent(
                'warn',
                `Ignored revision-less snapshot after revision ${currentRevision}: ${JSON.stringify(summarizeSnapshotPayload(payload))}`
            );
            return false;
        }
    } else if (currentRevision !== null && incomingRevision < currentRevision) {
        logEvent(
            'warn',
            `Ignored stale snapshot revision ${incomingRevision} < ${currentRevision}: ${JSON.stringify(summarizeSnapshotPayload(payload))}`
        );
        return false;
    }

    if (incomingRevision !== null) {
        appState.currentSessionSnapshotRevision = incomingRevision;
    }

    if (Array.isArray(payload.breakoutRooms)) {
        appState.breakoutRooms = payload.breakoutRooms;
    }
    if (Array.isArray(payload.waitingRoomRequests)) {
        appState.waitingRoomRequests = payload.waitingRoomRequests;
    }
    if (payload.participantLocations) {
        appState.participantLocations = payload.participantLocations;
    }
    if (payload.participantProfiles) {
        appState.participantProfiles = payload.participantProfiles;
    }
    if (payload.participantRoles) {
        appState.participantRoles = payload.participantRoles;
    }
    if (payload.participantPresence) {
        appState.participantPresence = payload.participantPresence;
    }
    if (payload.participantPermissions) {
        appState.participantPermissionState = payload.participantPermissions;
    }
    if (payload.participantMediaConnections) {
        appState.participantMediaConnections = payload.participantMediaConnections;
    }
    if (payload.whiteboardState) {
        appState.whiteboardState = payload.whiteboardState;
    }
    if (payload.session || payload.roomConfiguration) {
        appState.sessionFeatures = {
            ...appState.sessionFeatures,
            ...(payload.session || payload.roomConfiguration),
        };
    }
    if (payload.currentRootParticipantId) {
        appState.currentRootParticipantId = payload.currentRootParticipantId;
    }

    const mediaConnectionToParticipantId = new Map(
        Object.entries(appState.participantMediaConnections || {})
            .filter(([, mediaConnectionId]) => typeof mediaConnectionId === 'string' && mediaConnectionId)
            .map(([participantId, mediaConnectionId]) => [mediaConnectionId, participantId])
    );

    participantsData.forEach((participant, connectionId) => {
        const rootParticipantId =
            mediaConnectionToParticipantId.get(connectionId)
            || (connectionId === appState.currentParticipantId ? appState.currentRootParticipantId : null);
        const profile = rootParticipantId ? appState.participantProfiles?.[rootParticipantId] : null;
        if (profile?.nickname) {
            participant.nickname = profile.nickname;
        }
        if (rootParticipantId && appState.participantRoles?.[rootParticipantId]) {
            participant.role = appState.participantRoles[rootParticipantId];
        }
        if (rootParticipantId && appState.participantPermissionState?.[rootParticipantId]) {
            participant.permissions = {
                ...(participant.permissions || getDefaultParticipantPermissionState()),
                ...appState.participantPermissionState[rootParticipantId],
            };
        }
        participantsData.set(connectionId, participant);
    });

    logEvent(
        'info',
        `Applied global snapshot: ${JSON.stringify({
            ...summarizeSnapshotPayload(payload),
            currentRoomTarget: appState.currentRoomTarget,
        })}`
    );

    return true;
}

function shouldUseGlobalRosterView() {
    return appState.authRole === 'host' || appState.authRole === 'co_host';
}

function getParticipantPresence(participantId) {
    return appState.participantPresence?.[participantId] || 'connected';
}

function getParticipantLocationLabel(participantId) {
    const location = appState.participantLocations?.[participantId];
    if (!location || location.type !== 'breakout' || !location.breakoutRoomId) {
        return 'Main room';
    }

    const breakoutRoom = (appState.breakoutRooms || []).find((room) => room.id === location.breakoutRoomId);
    return breakoutRoom?.name || 'Breakout room';
}

function getGlobalParticipantsForPanels() {
    const participantIds = new Set([
        ...Object.keys(appState.participantProfiles || {}),
        ...Object.keys(appState.participantRoles || {}),
        ...Object.keys(appState.participantLocations || {}),
        ...Object.keys(appState.participantPresence || {}),
        ...Object.keys(appState.participantPermissionState || {}),
        ...Object.keys(appState.participantMediaConnections || {}),
    ]);

    if (appState.currentRootParticipantId && appState.nickname) {
        participantIds.add(appState.currentRootParticipantId);
    }

    return Array.from(participantIds)
        .map((participantId) => {
            const mediaConnectionId = getMediaConnectionIdForParticipant(participantId);
            const localParticipant = mediaConnectionId ? participantsData.get(mediaConnectionId) : null;
            const profile = appState.participantProfiles?.[participantId];
            const isLocal = participantId === appState.currentRootParticipantId;
            return {
                connectionId: participantId,
                participantId,
                mediaConnectionId,
                nickname: profile?.nickname || localParticipant?.nickname || (isLocal ? appState.nickname : participantId),
                role: appState.participantRoles?.[participantId] || localParticipant?.role || (isLocal ? (appState.authRole || 'participant') : 'participant'),
                isLocal,
                isMuted: localParticipant?.isMuted ?? false,
                isVideoOff: localParticipant?.isVideoOff ?? false,
                presence: getParticipantPresence(participantId),
                location: appState.participantLocations?.[participantId] || {
                    type: 'main',
                    breakoutRoomId: null,
                },
                locationLabel: getParticipantLocationLabel(participantId),
                permissions: {
                    ...getDefaultParticipantPermissionState(),
                    ...(appState.participantPermissionState?.[participantId] || localParticipant?.permissions || {}),
                },
            };
        })
        .sort(compareParticipantsByRoleAndName);
}

function getParticipantForModeration(identifier) {
    if (!identifier) {
        return null;
    }

    return (
        getGlobalParticipantsForPanels().find(
            (participant) =>
                participant.connectionId === identifier || participant.mediaConnectionId === identifier
        ) ||
        participantsData.get(identifier) ||
        null
    );
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

async function updateParticipantRole(connectionId, role) {
    if (!appState.sessionId) {
        showNotification('No active session available.', 'error');
        return;
    }

    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.PARTICIPANT_ROLE(appState.sessionId, connectionId)}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role }),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to update participant role');
    }

    return response.json().catch(() => ({}));
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

async function toggleParticipantCoHostRole(connectionId, nextRole) {
    try {
        await updateParticipantRole(connectionId, nextRole);
        closeParticipantAccessMenu();
        showNotification(
            nextRole === 'co_host'
                ? 'Participant promoted to co-host.'
                : 'Co-host role removed.',
            'info'
        );
    } catch (error) {
        showNotification(error.message || 'Failed to update participant role.', 'error');
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

async function bulkUpdateParticipantPermissions(permissionsPatch) {
    if (!canManageParticipantMedia()) {
        showNotification('You do not have permission to manage participant media.', 'error');
        return;
    }

    const targets = getGlobalParticipantsForPanels().filter((participant) => {
        if (participant.isLocal) return false;
        if (!canManageTargetParticipantRole(participant.role)) return false;
        if (participant.presence !== 'connected') return false;
        return true;
    });

    if (targets.length === 0) {
        showNotification('No eligible participants to update.', 'info');
        return;
    }

    let updatedCount = 0;
    const errors = [];

    for (const participant of targets) {
        try {
            await updateParticipantPermissions(participant.connectionId, permissionsPatch);
            updatedCount++;
        } catch (error) {
            errors.push(participant.nickname);
        }
    }

    if (updatedCount > 0) {
        showNotification(`Updated access for ${updatedCount} participant${updatedCount > 1 ? 's' : ''}.`, 'info');
    }
    if (errors.length > 0) {
        showNotification(`Failed to update: ${errors.join(', ')}`, 'error');
    }

    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
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

    if (!canPublishAudio() && isLocalAudioLive()) {
        await livekitClient.toggleAudio();
        appState.isAudioEnabled = false;
    }

    if (!canPublishVideo() && isLocalVideoLive()) {
        await livekitClient.toggleVideo();
        appState.isVideoEnabled = false;
    }

    if (!canShareScreen() && appState.isScreenSharing) {
        await stopScreenShare();
    }

    syncLocalMediaControlUi();
}

/**
 * Initialize the page based on URL
 */
function initializePage() {
    applyStoredNickname();
    const roomId = getRoomIdFromUrl();
    logEvent(
        'info',
        `Initialize page: urlRoom=${roomId || 'none'}, authRoom=${appState.authRoomId || 'none'}, authRole=${appState.authRole || 'none'}`
    );
    
    if (roomId) {
        elements.homeCard.style.display = 'none';
        elements.joinCard.style.display = 'block';
        setElementVisibility(elements.waitingRoomCard, false);
        elements.sessionIdInput.value = roomId;
        elements.roomIdDisplay.textContent = roomId;

        const storedWaitingRoomRequestId = getStoredWaitingRoomRequestId(roomId);
        const storedParticipantId = getStoredRoomParticipantId(roomId);
        if (storedWaitingRoomRequestId && !storedParticipantId) {
            showWaitingRoom(roomId, storedWaitingRoomRequestId, {
                id: storedWaitingRoomRequestId,
                nickname: elements.nicknameInput.value.trim() || getStoredNickname() || 'Guest',
                preferredLanguage: elements.languageSelect.value || 'en',
            });
            startWaitingRoomPolling(
                roomId,
                storedWaitingRoomRequestId,
                elements.nicknameInput.value.trim() || getStoredNickname() || 'Guest',
                elements.languageSelect.value || 'en'
            );
        }
    } else {
        // No room - show create meeting button
        elements.homeCard.style.display = 'block';
        elements.joinCard.style.display = 'none';
        setElementVisibility(elements.waitingRoomCard, false);
    }

    applyPermissionBasedUi();
}

function resolveBoundSessionId(sessionId) {
    const roomIdFromUrl = getRoomIdFromUrl();
    if (roomIdFromUrl) {
        return roomIdFromUrl;
    }

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

function getStoredNickname() {
    try {
        return localStorage.getItem(NICKNAME_STORAGE_KEY)?.trim() || '';
    } catch (error) {
        return '';
    }
}

function persistNickname(nickname) {
    try {
        localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
    } catch (error) {
        logEvent('error', `Failed to persist nickname: ${error?.message || error}`);
    }
}

function applyStoredNickname() {
    if (!elements.nicknameInput) {
        return;
    }

    const storedNickname = getStoredNickname();

    if (storedNickname) {
        elements.nicknameInput.value = storedNickname;
        elements.nicknameInput.readOnly = true;
        setElementVisibility(elements.editNicknameBtn, true, 'inline-flex');
    } else {
        elements.nicknameInput.readOnly = false;
        setElementVisibility(elements.editNicknameBtn, false);
    }

    updatePreviewAvatar();
}

function enableNicknameEditing() {
    elements.nicknameInput.readOnly = false;
    elements.nicknameInput.focus();
    elements.nicknameInput.select();
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
        logEvent(
            'info',
            `Loaded bootstrap session: role=${appState.authRole || 'none'}, room=${appState.authRoomId || 'none'}`
        );
    } catch (error) {
        appState.authRole = null;
        appState.authRoomId = null;
        appState.authTokenExpiresAt = null;
        appState.currentPermissions = [];
    }

    applyPermissionBasedUi();
}

async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const rootParticipantId = getCurrentRootParticipantId();
    if (rootParticipantId && !headers.has('X-Participant-Id')) {
        headers.set('X-Participant-Id', rootParticipantId);
    }

    const response = await fetch(url, {
        ...options,
        headers,
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
    const requestedRoomId = getRoomIdFromUrl() || appState.authRoomId;

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

        const rootParticipantId = getCurrentRootParticipantId();
        if (rootParticipantId) {
            permissionsUrl.searchParams.set('participantId', rootParticipantId);
        }
        if (requestedRoomId) {
            permissionsUrl.searchParams.set('roomId', requestedRoomId);
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
        if (isOutdatedSnapshotPayload(authorization)) {
            logEvent('warn', `Ignored stale permissions payload: ${JSON.stringify(summarizeSnapshotPayload(authorization))}`);
            return authorization;
        }
        if (
            requestedRoomId &&
            authorization.roomId &&
            authorization.roomId !== requestedRoomId
        ) {
            throw new Error(
                `Authenticated session is bound to ${authorization.roomId}, not ${requestedRoomId}`
            );
        }
        appState.authRole = authorization.role || appState.authRole;
        appState.authRoomId = authorization.roomId || appState.authRoomId;
        appState.sessionFeatures = authorization.session || appState.sessionFeatures;
        appState.currentPermissions = Array.isArray(authorization.permissions)
            ? authorization.permissions
            : [];
        appState.currentRoomTarget = authorization.roomTarget || appState.currentRoomTarget;
        applyGlobalSessionSnapshot(authorization);
        syncWaitingRoomNotificationState(authorization, { primeOnly: true });
        if (appState.sessionId && appState.currentRootParticipantId) {
            storeRoomParticipantId(appState.sessionId, appState.currentRootParticipantId);
        }
        loadBootstrapSession();
        applyPermissionBasedUi();
        if (appState.isParticipantsOpen) {
            renderParticipantsList();
        }
        renderBreakoutsPanel();
        logEvent(
            'info',
            `Permissions refreshed: ${JSON.stringify({
                role: appState.authRole,
                roomId: appState.authRoomId,
                roomTarget: appState.currentRoomTarget,
                currentRootParticipantId: appState.currentRootParticipantId,
                revision: appState.currentSessionSnapshotRevision,
                permissions: appState.currentPermissions,
            })}`
        );
        await enforceCurrentPermissions();
        return authorization;
    } catch (error) {
        if (!silent) {
            showNotification(error.message || 'Failed to load permissions.', 'error');
        }
        return null;
    }
}

async function fetchBreakoutSnapshot() {
    if (!appState.sessionId) {
        return null;
    }

    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_BREAKOUTS(appState.sessionId)}`
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to load breakout rooms');
    }

    const payload = await response.json();
    if (isOutdatedSnapshotPayload(payload)) {
        logEvent('warn', `Ignored stale breakout snapshot response: ${JSON.stringify(summarizeSnapshotPayload(payload))}`);
        return payload;
    }
    applyGlobalSessionSnapshot(payload);
    syncWaitingRoomNotificationState(payload, { primeOnly: true });
    logEvent('info', `Fetched breakout snapshot: ${JSON.stringify(summarizeSnapshotPayload(payload))}`);
    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
    renderBreakoutsPanel();
    return payload;
}

function formatWaitingRoomMeta(sessionId, request = null) {
    if (!request) {
        return `Room ${sessionId}`;
    }

    const language = (request.preferredLanguage || 'en').toUpperCase();
    return `${request.nickname} · ${language} · Request ${request.id}`;
}

function showWaitingRoom(sessionId, requestId, request = null) {
    appState.waitingRoomRequestId = requestId || appState.waitingRoomRequestId;
    appState.isWaitingForAdmission = true;

    setElementVisibility(elements.homeCard, false);
    setElementVisibility(elements.joinCard, false);
    setElementVisibility(elements.waitingRoomCard, true, 'block');

    if (elements.waitingRoomStatus) {
        elements.waitingRoomStatus.innerHTML = `
            <span class="waiting-room-pulse" aria-hidden="true"></span>
            <span>Request sent. Waiting for approval...</span>
        `;
    }

    if (elements.waitingRoomMeta) {
        elements.waitingRoomMeta.textContent = formatWaitingRoomMeta(sessionId, request);
    }
}

function hideWaitingRoom() {
    appState.isWaitingForAdmission = false;
    setElementVisibility(elements.waitingRoomCard, false);
}

function stopWaitingRoomPolling() {
    if (waitingRoomPollIntervalId) {
        clearInterval(waitingRoomPollIntervalId);
        waitingRoomPollIntervalId = null;
    }
}

async function createWaitingRoomRequest(sessionId, nickname, preferredLanguage, requestId = null) {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.WAITING_ROOM_REQUESTS(sessionId)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requestId,
                nickname,
                preferredLanguage,
            }),
        }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.details || 'Failed to enter the waiting room');
    }

    if (payload.revision !== undefined || payload.breakoutRooms || payload.waitingRoomRequests) {
        applyGlobalSessionSnapshot(payload);
        syncWaitingRoomNotificationState(payload, { primeOnly: true });
    }

    logEvent(
        'info',
        `Created waiting room request: ${JSON.stringify({
            sessionId,
            requestId: payload?.request?.id || requestId || null,
            nickname,
            preferredLanguage,
        })}`
    );

    return payload;
}

async function fetchWaitingRoomRequestStatus(sessionId, requestId) {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.WAITING_ROOM_REQUEST(sessionId, requestId)}`,
        { suppressAuthExpiredNotice: true }
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(payload.details || 'Failed to check waiting room status');
        if (response.status === 404) {
            error.waitingRoomRequestMissing = true;
        }
        throw error;
    }

    return payload;
}

async function cancelWaitingRoomRequest(sessionId, requestId, options = {}) {
    const { silent = false } = options;
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.WAITING_ROOM_REQUEST(sessionId, requestId)}`,
        { method: 'DELETE', suppressAuthExpiredNotice: true }
    );

    if (!response.ok && response.status !== 404) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to cancel waiting room request');
    }

    stopWaitingRoomPolling();
    appState.waitingRoomRequestId = null;
    clearStoredWaitingRoomRequestId(sessionId);
    hideWaitingRoom();
    if (!silent) {
        showJoinForm();
        showNotification('Waiting room request cancelled.', 'info');
    }
}

async function approveWaitingRoomRequest(requestId) {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.WAITING_ROOM_APPROVE(appState.sessionId, requestId)}`,
        { method: 'POST' }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.details || 'Failed to admit participant');
    }

    applyGlobalSessionSnapshot(payload);
    syncWaitingRoomNotificationState(payload);
    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
    return payload;
}

async function rejectWaitingRoomRequest(requestId) {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.WAITING_ROOM_REJECT(appState.sessionId, requestId)}`,
        { method: 'POST' }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.details || 'Failed to reject participant');
    }

    applyGlobalSessionSnapshot(payload);
    syncWaitingRoomNotificationState(payload);
    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
    return payload;
}

async function pollWaitingRoomAdmission(sessionId, requestId, nickname, preferredLanguage) {
    try {
        const payload = await fetchWaitingRoomRequestStatus(sessionId, requestId);
        const request = payload.request || null;
        const status = request?.status || 'pending';

        if (status === 'approved') {
            stopWaitingRoomPolling();
            appState.waitingRoomRequestId = requestId;
            logEvent('info', `Waiting room request approved: ${requestId}`);
            showNotification('You were admitted to the meeting.', 'info');
            if (!waitingRoomAutoJoinInProgress) {
                waitingRoomAutoJoinInProgress = true;
                try {
                    await joinSession(sessionId, nickname, preferredLanguage, {
                        skipWaitingRoomCheck: true,
                        waitingRequestId: requestId,
                    });
                } finally {
                    waitingRoomAutoJoinInProgress = false;
                }
            }
            return;
        }

        if (status === 'rejected') {
            stopWaitingRoomPolling();
            appState.waitingRoomRequestId = null;
            clearStoredWaitingRoomRequestId(sessionId);
            hideWaitingRoom();
            logEvent('warn', `Waiting room request rejected: ${requestId}`);
            showJoinForm();
            showNotification('Your request to join was declined.', 'error');
            return;
        }

        logEvent('info', `Waiting room request still pending: ${requestId}`);
        showWaitingRoom(sessionId, requestId, request);
    } catch (error) {
        if (error.waitingRoomRequestMissing) {
            stopWaitingRoomPolling();
            appState.waitingRoomRequestId = null;
            clearStoredWaitingRoomRequestId(sessionId);
            hideWaitingRoom();
            showJoinForm();
            showNotification('Your waiting room request expired. Please try again.', 'error');
            return;
        }

        logEvent('warn', `Waiting room polling failed: ${error.message || error}`);
    }
}

function startWaitingRoomPolling(sessionId, requestId, nickname, preferredLanguage) {
    stopWaitingRoomPolling();
    waitingRoomAutoJoinInProgress = false;
    pollWaitingRoomAdmission(sessionId, requestId, nickname, preferredLanguage);
    waitingRoomPollIntervalId = setInterval(() => {
        pollWaitingRoomAdmission(sessionId, requestId, nickname, preferredLanguage);
    }, 2500);
}

async function ensureWaitingRoomAdmission(sessionId, nickname, preferredLanguage) {
    const existingParticipantId = getStoredRoomParticipantId(sessionId);
    if (
        existingParticipantId ||
        appState.authRole === 'host' ||
        appState.authRole === 'co_host'
    ) {
        return {
            admitted: true,
            waitingRequestId: null,
        };
    }

    let requestId = getStoredWaitingRoomRequestId(sessionId);
    let existingStatus = null;

    if (requestId) {
        existingStatus = await fetchWaitingRoomRequestStatus(sessionId, requestId).catch((error) => {
            if (error.waitingRoomRequestMissing) {
                clearStoredWaitingRoomRequestId(sessionId);
                return null;
            }
            throw error;
        });
    }

    if (!requestId || !existingStatus) {
        const created = await createWaitingRoomRequest(sessionId, nickname, preferredLanguage);
        requestId = created?.request?.id || null;
        if (!requestId) {
            return {
                admitted: true,
                waitingRequestId: null,
            };
        }
        storeWaitingRoomRequestId(sessionId, requestId);
        showWaitingRoom(sessionId, requestId, created.request || null);
        startWaitingRoomPolling(sessionId, requestId, nickname, preferredLanguage);
        return {
            admitted: false,
            waitingRequestId: requestId,
        };
    }

    const request = existingStatus?.request || null;
    if (request?.status === 'approved') {
        return {
            admitted: true,
            waitingRequestId: requestId,
        };
    }

    if (request?.status === 'rejected') {
        clearStoredWaitingRoomRequestId(sessionId);
        throw new Error('Your request to join was declined.');
    }

    showWaitingRoom(sessionId, requestId, request);
    startWaitingRoomPolling(sessionId, requestId, nickname, preferredLanguage);
    return {
        admitted: false,
        waitingRequestId: requestId,
    };
}

async function fetchRoomTargetForCurrentParticipant() {
    if (!appState.sessionId) {
        return null;
    }

    const participantId = getCurrentRootParticipantId();
    const url = new URL(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_ROOM_TARGET(appState.sessionId)}`,
        window.location.origin
    );

    if (participantId) {
        url.searchParams.set('participantId', participantId);
    }

    const response = await apiFetch(url.toString(), { suppressAuthExpiredNotice: true });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to resolve room target');
    }

    const payload = await response.json();
    if (isOutdatedSnapshotPayload(payload)) {
        logEvent('warn', `Ignored stale room target payload: ${JSON.stringify(summarizeSnapshotPayload(payload))}`);
        return payload;
    }
    appState.currentRoomTarget = payload.roomTarget || appState.currentRoomTarget;
    applyGlobalSessionSnapshot(payload);
    logEvent(
        'info',
        `Fetched room target: ${JSON.stringify({
            roomTarget: payload.roomTarget || null,
            participantId,
            summary: summarizeSnapshotPayload(payload),
        })}`
    );
    renderBreakoutsPanel();
    return payload;
}

function closeBreakoutsPanel() {
    appState.isBreakoutsOpen = false;
    elements.breakoutsPanel.style.display = 'none';
    elements.toggleBreakoutsBtn?.classList.remove('active');
}

async function toggleBreakoutsPanel() {
    if (!canManageBreakouts()) {
        return;
    }

    appState.isBreakoutsOpen = !appState.isBreakoutsOpen;

    if (appState.isBreakoutsOpen) {
        elements.breakoutsPanel.style.display = 'flex';
        elements.toggleBreakoutsBtn?.classList.add('active');
        await fetchBreakoutSnapshot();
    } else {
        closeBreakoutsPanel();
    }
}

function getParticipantDisplayNameForBreakout(participantId) {
    const mediaConnectionId = getMediaConnectionIdForParticipant(participantId);
    return appState.participantProfiles?.[participantId]?.nickname
        || (mediaConnectionId ? participantsData.get(mediaConnectionId)?.nickname : null)
        || participantId;
}

function doesConnectionBelongToCurrentRoom(connectionData) {
    const connectionRoomType = connectionData.roomType || 'main';
    const currentRoomType = appState.currentRoomTarget?.type || 'main';
    const connectionBreakoutRoomId = connectionData.breakoutRoomId || null;
    const currentBreakoutRoomId = appState.currentRoomTarget?.breakoutRoomId || null;

    return connectionRoomType === currentRoomType && connectionBreakoutRoomId === currentBreakoutRoomId;
}

function renderBreakoutsPanel() {
    if (!elements.breakoutsContent) {
        return;
    }

    if (!canManageBreakouts() || !appState.sessionId) {
        elements.breakoutsContent.innerHTML = `
            <div class="participants-empty">
                <i data-lucide="layout-panel-top"></i>
                <p>No breakout controls available</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    const breakoutRooms = Array.isArray(appState.breakoutRooms) ? appState.breakoutRooms : [];
    const globalParticipants = getGlobalParticipantsForPanels()
        .filter((participant) => !participant.isLocal && participant.presence === 'connected')
        .sort(compareParticipantsByRoleAndName);

    const assignmentItems = globalParticipants.map((participant) => {
        const location = appState.participantLocations?.[participant.participantId];
        const currentValue =
            location?.type === 'breakout' && location.breakoutRoomId
                ? location.breakoutRoomId
                : 'main';
        return `
            <div class="breakout-room-participant">
                <span class="breakout-room-participant-name">${escapeHtml(participant.nickname)}</span>
                <select class="breakout-room-assignment-select" data-participant-id="${participant.participantId}">
                    <option value="main" ${currentValue === 'main' ? 'selected' : ''}>Main room</option>
                    ${breakoutRooms.map((room) => `
                        <option value="${room.id}" ${currentValue === room.id ? 'selected' : ''}>
                            ${escapeHtml(room.name)}
                        </option>
                    `).join('')}
                </select>
            </div>
        `;
    }).join('');

    const isInBreakoutRoom = appState.currentRoomTarget?.type === 'breakout';
    const currentRoomLabel = isInBreakoutRoom
        ? escapeHtml(appState.currentRoomTarget?.displayName || 'Breakout room')
        : 'Main room';

    elements.breakoutsContent.innerHTML = `
        <div class="breakout-room-card breakout-room-card-current">
            <div class="breakout-room-header">
                <div class="breakout-room-name">Current room</div>
                <span class="breakout-room-status ${isInBreakoutRoom ? 'is-open' : ''}">
                    ${isInBreakoutRoom ? 'Breakout' : 'Main'}
                </span>
            </div>
            <div class="breakout-room-meta">You are currently in ${currentRoomLabel}</div>
            ${isInBreakoutRoom ? `
                <div class="breakout-room-actions">
                    <button class="btn btn-small breakout-return-main-btn">
                        Return to main room
                    </button>
                </div>
            ` : ''}
        </div>
        <div class="breakout-room-card breakout-room-card-lobby">
            <div class="breakout-room-header">
                <div class="breakout-room-name">Main room</div>
                <span class="breakout-room-status">Lobby</span>
            </div>
            <div class="breakout-room-meta">Move participants between the main room and breakout rooms.</div>
            <div class="breakout-room-participants">
                ${assignmentItems || '<div class="breakout-room-meta">No remote participants connected</div>'}
            </div>
        </div>
        ${breakoutRooms.map((room) => {
            const isOpen = room.status === 'open';
            const isCurrentRoom = appState.currentRoomTarget?.breakoutRoomId === room.id;
            const participantItems = (room.participantIds || []).map((participantId) => `
                <div class="breakout-room-participant">
                    <span class="breakout-room-participant-name">${escapeHtml(getParticipantDisplayNameForBreakout(participantId))}</span>
                </div>
            `).join('');

            return `
                <div class="breakout-room-card">
                    <div class="breakout-room-header">
                        <div class="breakout-room-title-group">
                            <input class="breakout-room-name breakout-room-name-input" data-breakout-room-id="${room.id}" value="${escapeHtml(room.name)}" />
                            <div class="breakout-room-meta">${(room.participantIds || []).filter((participantId) => getParticipantPresence(participantId) === 'connected').length} participant(s)</div>
                        </div>
                        <span class="breakout-room-status ${isOpen ? 'is-open' : ''}">${escapeHtml(room.status)}</span>
                    </div>
                    <div class="breakout-room-actions">
                        <button class="btn btn-small breakout-open-btn" data-breakout-room-id="${room.id}">
                            ${isOpen ? 'Re-open' : 'Open'}
                        </button>
                        <button class="btn btn-small breakout-close-btn" data-breakout-room-id="${room.id}" ${isOpen ? '' : 'disabled'}>
                            Close
                        </button>
                        <button class="btn btn-small breakout-join-btn" data-breakout-room-id="${room.id}" ${isOpen ? '' : 'disabled'}>
                            ${isCurrentRoom ? 'Return to main' : 'Join'}
                        </button>
                        <button class="btn btn-small breakout-delete-btn" data-breakout-room-id="${room.id}">
                            Delete
                        </button>
                    </div>
                    <div class="breakout-room-participants">
                        ${participantItems || '<div class="breakout-room-meta">No assigned participants</div>'}
                    </div>
                </div>
            `;
        }).join('')}
    `;

    lucide.createIcons();

    elements.breakoutsContent.querySelectorAll('.breakout-room-assignment-select').forEach((select) => {
        select.addEventListener('change', async () => {
            try {
                const participantId = select.dataset.participantId;
                const targetBreakoutRoomId = select.value === 'main' ? null : select.value;
                await moveParticipantToRoom(participantId, targetBreakoutRoomId);
            } catch (error) {
                showNotification(error.message || 'Failed to move participant.', 'error');
            }
        });
    });

    elements.breakoutsContent.querySelectorAll('.breakout-open-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                await openBreakoutRoom(button.dataset.breakoutRoomId);
            } catch (error) {
                showNotification(error.message || 'Failed to open breakout room.', 'error');
            }
        });
    });

    elements.breakoutsContent.querySelectorAll('.breakout-close-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                await closeBreakoutRoom(button.dataset.breakoutRoomId);
            } catch (error) {
                showNotification(error.message || 'Failed to close breakout room.', 'error');
            }
        });
    });

    elements.breakoutsContent.querySelectorAll('.breakout-join-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                const breakoutRoomId = button.dataset.breakoutRoomId;
                const isCurrentRoom = appState.currentRoomTarget?.breakoutRoomId === breakoutRoomId;
                await moveCurrentUserToRoom(isCurrentRoom ? null : breakoutRoomId);
            } catch (error) {
                showNotification(error.message || 'Failed to switch room.', 'error');
            }
        });
    });

    elements.breakoutsContent.querySelectorAll('.breakout-room-name-input').forEach((input) => {
        input.addEventListener('change', async () => {
            try {
                await renameBreakoutRoom(input.dataset.breakoutRoomId, input.value);
            } catch (error) {
                showNotification(error.message || 'Failed to rename breakout room.', 'error');
            }
        });
    });

    elements.breakoutsContent.querySelectorAll('.breakout-delete-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                if (!confirm('Delete this breakout room?')) {
                    return;
                }
                await deleteBreakoutRoom(button.dataset.breakoutRoomId);
            } catch (error) {
                showNotification(error.message || 'Failed to delete breakout room.', 'error');
            }
        });
    });

    elements.breakoutsContent.querySelectorAll('.breakout-return-main-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                await moveCurrentUserToRoom(null);
            } catch (error) {
                showNotification(error.message || 'Failed to return to the main room.', 'error');
            }
        });
    });
}

async function createBreakoutRoom() {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_BREAKOUTS(appState.sessionId)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to create breakout room');
    }

    await fetchBreakoutSnapshot();
}

async function renameBreakoutRoom(breakoutRoomId, name) {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_BREAKOUT(appState.sessionId, breakoutRoomId)}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to rename breakout room');
    }

    await fetchBreakoutSnapshot();
}

async function openBreakoutRoom(breakoutRoomId) {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_BREAKOUT_OPEN(appState.sessionId, breakoutRoomId)}`,
        { method: 'POST' }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to open breakout room');
    }

    await fetchBreakoutSnapshot();
}

async function closeBreakoutRoom(breakoutRoomId) {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_BREAKOUT_CLOSE(appState.sessionId, breakoutRoomId)}`,
        { method: 'POST' }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to close breakout room');
    }

    await fetchBreakoutSnapshot();

    if (appState.currentRoomTarget?.breakoutRoomId === breakoutRoomId) {
        await fetchRoomTargetForCurrentParticipant().catch(() => null);
        if (appState.currentRoomTarget?.type !== 'breakout') {
            await reconnectToAssignedRoom();
        }
    }
}

async function deleteBreakoutRoom(breakoutRoomId) {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_BREAKOUT(appState.sessionId, breakoutRoomId)}`,
        { method: 'DELETE' }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to delete breakout room');
    }

    await fetchBreakoutSnapshot();
}

async function moveParticipantToRoom(participantId, breakoutRoomId) {
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.PARTICIPANT_LOCATION(appState.sessionId, participantId)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
                breakoutRoomId
                    ? { target: 'breakout', breakoutRoomId }
                    : { target: 'main' }
            ),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to move participant');
    }

    await fetchBreakoutSnapshot();
    return response.json().catch(() => ({}));
}

async function moveCurrentUserToRoom(breakoutRoomId) {
    const rootParticipantId = getCurrentRootParticipantId();
    if (!rootParticipantId) {
        return;
    }

    const payload = await moveParticipantToRoom(rootParticipantId, breakoutRoomId);
    if (payload?.roomTarget) {
        appState.currentRoomTarget = payload.roomTarget;
    }
    await reconnectToAssignedRoom();
}

function getPermissionsWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(`${protocol}//${window.location.host}/ws/permissions`);
    if (appState.authRoomId) {
        url.searchParams.set('roomId', appState.authRoomId);
    }
    const rootParticipantId = getCurrentRootParticipantId();
    if (rootParticipantId) {
        url.searchParams.set('participantId', rootParticipantId);
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

            if (payload.type === 'breakout_rooms_updated') {
                if (payload.sessionId !== appState.authRoomId) {
                    return;
                }

                const snapshotApplied = applyGlobalSessionSnapshot(payload);
                if (!snapshotApplied && payload.revision !== undefined) {
                    return;
                }
                syncWaitingRoomNotificationState(payload);
                logEvent('info', `Received breakout_rooms_updated: ${JSON.stringify(summarizeSnapshotPayload(payload))}`);
                renderBreakoutsPanel();
                if (appState.isParticipantsOpen) {
                    renderParticipantsList();
                }
                return;
            }

            if (payload.type === 'waiting_room_updated') {
                if (payload.sessionId !== appState.authRoomId) {
                    return;
                }

                const snapshotApplied = applyGlobalSessionSnapshot(payload);
                if (!snapshotApplied && payload.revision !== undefined) {
                    return;
                }
                syncWaitingRoomNotificationState(payload);
                logEvent('info', `Received waiting_room_updated: ${JSON.stringify(summarizeSnapshotPayload(payload))}`);
                if (appState.isParticipantsOpen) {
                    renderParticipantsList();
                }
                return;
            }

            if (payload.type === 'room_transfer_requested') {
                if (payload.sessionId !== appState.authRoomId || payload.participantId !== appState.currentRootParticipantId) {
                    return;
                }

                const snapshotApplied = applyGlobalSessionSnapshot(payload);
                if (!snapshotApplied && payload.revision !== undefined) {
                    return;
                }
                appState.currentRoomTarget = payload.targetRoom || appState.currentRoomTarget;
                logEvent(
                    'info',
                    `Received room_transfer_requested: ${JSON.stringify({
                        participantId: payload.participantId,
                        targetRoom: payload.targetRoom || null,
                        summary: summarizeSnapshotPayload(payload),
                    })}`
                );
                showNotification(
                    payload.targetRoom?.type === 'breakout'
                        ? `You have been moved to ${payload.targetRoom.displayName || 'a breakout room'}.`
                        : 'You have been returned to the main room.',
                    'info'
                );
                if (!isSwitchingRooms) {
                    await reconnectToAssignedRoom();
                }
                return;
            }

            if (payload.type === 'whiteboard_state_updated') {
                if (payload.sessionId !== appState.authRoomId) {
                    return;
                }

                const snapshotApplied = applyGlobalSessionSnapshot(payload);
                if (!snapshotApplied && payload.revision !== undefined) {
                    return;
                }
                logEvent(
                    'info',
                    `Received whiteboard_state_updated: ${JSON.stringify({
                        roomType: payload.roomType,
                        breakoutRoomId: payload.breakoutRoomId || null,
                        revision: payload.revision ?? null,
                    })}`
                );
                if (
                    payload.roomType === (appState.currentRoomTarget?.type || 'main') &&
                    (payload.breakoutRoomId || null) === (appState.currentRoomTarget?.breakoutRoomId || null)
                ) {
                    whiteboardManager.applyRoomState?.(payload.roomState || getCurrentRoomWhiteboardState());
                }
                return;
            }

            if (payload.type !== 'participant_access_updated') {
                if (payload.type === 'participant_role_updated') {
                    const snapshotApplied = applyGlobalSessionSnapshot(payload);
                    if (!snapshotApplied && payload.revision !== undefined) {
                        return;
                    }
                    if (appState.isParticipantsOpen) {
                        renderParticipantsList();
                    }
                    renderBreakoutsPanel();
                    await syncParticipantRolesFromSession();

                    if (payload.participantId === appState.currentRootParticipantId) {
                        await refreshCurrentPermissions({ silent: true });
                        showNotification(
                            payload.role === 'co_host'
                                ? 'You have been promoted to co-host.'
                                : 'Your co-host role was removed.',
                            'info'
                        );
                    }
                    return;
                }
                if (payload.type === 'room_configuration_updated') {
                    const snapshotApplied = applyGlobalSessionSnapshot(payload);
                    if (!snapshotApplied && payload.revision !== undefined) {
                        return;
                    }
                    applyPermissionBasedUi();
                    updateChatRecipientOptions();
                    logEvent(
                        'info',
                        `Received room_configuration_updated: ${JSON.stringify({
                            revision: payload.revision ?? null,
                            session: payload.session || null,
                        })}`
                    );
                    return;
                }
                if (payload.type === 'participant_left_conference') {
                    const snapshotApplied = applyGlobalSessionSnapshot(payload);
                    if (!snapshotApplied && payload.revision !== undefined) {
                        return;
                    }
                    logEvent('info', `Received participant_left_conference: ${JSON.stringify(summarizeSnapshotPayload(payload))}`);
                    if (appState.isParticipantsOpen) {
                        renderParticipantsList();
                    }
                    renderBreakoutsPanel();
                }
                return;
            }

            if (payload.sessionId !== appState.authRoomId) {
                return;
            }

            const snapshotApplied = applyGlobalSessionSnapshot(payload);
            if (!snapshotApplied && payload.revision !== undefined) {
                return;
            }
            logEvent(
                'info',
                `Received participant_access_updated: ${JSON.stringify({
                    participantId: payload.participantId || null,
                    revision: payload.revision ?? null,
                    summary: summarizeSnapshotPayload(payload),
                })}`
            );
            updateParticipantPermissionState(payload.participantId, payload.permissions || {});

            if (!appState.currentRootParticipantId || payload.participantId !== appState.currentRootParticipantId) {
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
async function getToken(sessionId, nickname, preferredLanguage, options = {}) {
    const {
        previousParticipantId = null,
        rootParticipantId = null,
        waitingRequestId = null,
        isAuxiliaryMedia = false,
        auxiliaryMediaKind = null,
    } = options;
    let resolvedSessionId = resolveBoundSessionId(sessionId);
    logEvent(
        'info',
        `Get token start: inputRoom=${sessionId}, resolvedRoom=${resolvedSessionId}, authRoom=${appState.authRoomId || 'none'}, authRole=${appState.authRole || 'none'}, urlRoom=${getRoomIdFromUrl() || 'none'}`
    );

    if (appState.currentPermissions.length === 0) {
        await refreshCurrentPermissions({ silent: true });
    }

    if (canCreateMeetings()) {
        logEvent(
            'info',
            `Creating session from frontend: resolvedRoom=${resolvedSessionId}, permissions=${appState.currentPermissions.join(',') || 'none'}`
        );
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
            body: JSON.stringify({
                nickname,
                preferredLanguage,
                previousParticipantId,
                rootParticipantId,
                waitingRequestId,
                isAuxiliaryMedia,
                auxiliaryMediaKind,
            })
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
        token: tokenData.token,
        connectionId: tokenData.connectionId,
        livekitUrl: tokenData.livekitUrl || '',
        roomTarget: tokenData.roomTarget || appState.currentRoomTarget,
        rootParticipantId: tokenData.rootParticipantId || rootParticipantId || previousParticipantId || null,
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
    const accessRestriction = getMediaPermissionRestriction('audio');
    if (accessRestriction) {
        showNotification(accessRestriction, 'error');
        return;
    }

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
    const accessRestriction = getMediaPermissionRestriction('video');
    if (accessRestriction) {
        showNotification(accessRestriction, 'error');
        return;
    }

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
    const audioAccessRestricted = Boolean(getMediaPermissionRestriction('audio'));
    const videoAccessRestricted = Boolean(getMediaPermissionRestriction('video'));

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
        : audioAccessRestricted
        ? 'Microphone access is disabled by the host'
        : 'Toggle Microphone';
    elements.previewToggleVideo.title = videoUnavailable
        ? 'No camera detected'
        : videoPermissionDenied
        ? 'Camera permission denied'
        : videoAccessRestricted
        ? 'Camera access is disabled by the host'
        : 'Toggle Camera';
    elements.toggleAudioBtn.title = audioUnavailable
        ? 'No microphone detected'
        : audioPermissionDenied
        ? 'Microphone permission denied'
        : audioAccessRestricted
        ? 'Microphone access is disabled by the host'
        : 'Toggle Microphone';
    elements.toggleVideoBtn.title = videoUnavailable
        ? 'No camera detected'
        : videoPermissionDenied
        ? 'Camera permission denied'
        : videoAccessRestricted
        ? 'Camera access is disabled by the host'
        : 'Toggle Camera';

    elements.previewToggleMic.classList.toggle('muted', audioUnavailable || audioPermissionDenied || audioAccessRestricted || !previewState.isAudioEnabled);
    elements.previewToggleVideo.classList.toggle('muted', videoUnavailable || videoPermissionDenied || videoAccessRestricted || !previewState.isVideoEnabled);

    if (audioUnavailable || audioPermissionDenied || audioAccessRestricted) {
        elements.previewToggleMic.innerHTML = '<i data-lucide="mic-off"></i>';
    }

    if (videoUnavailable || videoPermissionDenied || videoAccessRestricted) {
        elements.previewToggleVideo.innerHTML = '<i data-lucide="video-off"></i>';
    }

    syncLocalMediaControlUi();
    lucide.createIcons();
}

function localPublisherHasTrack(kind) {
    if (kind === 'audio') {
        return Boolean(livekitClient.localAudioTrack);
    }
    return Boolean(livekitClient.localVideoTrack);
}

function syncPublishedLocalMediaState() {
    appState.publishedAudioLive = livekitClient.isMicrophoneEnabled();
    appState.publishedVideoLive = livekitClient.isCameraEnabled();
}

function isLocalAudioLive() {
    return livekitClient.isMicrophoneEnabled();
}

function isLocalVideoLive() {
    return livekitClient.isCameraEnabled();
}

function syncLocalMediaControlUi() {
    const localWrapper = document.getElementById('localVideoWrapper');
    const localAvatar = document.getElementById('localAvatar');
    syncPublishedLocalMediaState();
    const audioLive = appState.publishedAudioLive;
    const videoLive = appState.publishedVideoLive;

    elements.toggleAudioBtn.classList.toggle('muted', !audioLive);
    elements.toggleAudioBtn.innerHTML = audioLive
        ? '<i data-lucide="mic"></i>'
        : '<i data-lucide="mic-off"></i>';

    elements.toggleVideoBtn.classList.toggle('muted', !videoLive);
    elements.toggleVideoBtn.innerHTML = videoLive
        ? '<i data-lucide="video"></i>'
        : '<i data-lucide="video-off"></i>';

    if (localWrapper && localAvatar) {
        localWrapper.classList.toggle('camera-off', !videoLive);
        localAvatar.classList.toggle('visible', !videoLive);
    }

    lucide.createIcons();
}

async function publishLocalStreamWithCurrentPermissions() {
    const canPublishLocalAudio =
        previewState.hasAudioInput &&
        previewState.audioPermission === 'granted' &&
        canPublishAudio() &&
        appState.isAudioEnabled;
    const canPublishLocalVideo =
        previewState.hasVideoInput &&
        previewState.videoPermission === 'granted' &&
        canPublishVideo() &&
        appState.isVideoEnabled;

    if (!canPublishLocalAudio && !canPublishLocalVideo) {
        syncLocalMediaControlUi();
        return false;
    }

    // Unpublish existing tracks before republishing
    if (livekitClient.localVideoTrack || livekitClient.localAudioTrack) {
        try {
            if (livekitClient.localVideoTrack) {
                livekitClient.room?.localParticipant?.unpublishTrack(livekitClient.localVideoTrack);
                livekitClient.localVideoTrack.stop();
                livekitClient.localVideoTrack = null;
            }
            if (livekitClient.localAudioTrack) {
                livekitClient.room?.localParticipant?.unpublishTrack(livekitClient.localAudioTrack);
                livekitClient.localAudioTrack.stop();
                livekitClient.localAudioTrack = null;
            }
        } catch (error) {
            console.error('Error unpublishing local tracks:', error);
        }
    }

    const publishOptions = {
        audioSource: canPublishLocalAudio ? previewState.selectedMicId || undefined : false,
        videoSource: canPublishLocalVideo ? previewState.selectedCameraId || undefined : false,
        publishAudio: canPublishLocalAudio,
        publishVideo: canPublishLocalVideo
    };

    await livekitClient.publish(elements.localVideo, publishOptions);

    if (livekitClient.localAudioTrack) {
        const mediaStream = new MediaStream([livekitClient.localAudioTrack.mediaStreamTrack]);
        setupLocalSpeakingDetection(mediaStream);
    }

    syncLocalMediaControlUi();
    updateParticipantCount();
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

function parseParticipantMetadata(connection) {
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
        roomType: connectionData.roomType || 'main',
        breakoutRoomId: connectionData.breakoutRoomId || null,
        rootSessionId: connectionData.rootSessionId || null,
        rootParticipantId: connectionData.rootParticipantId || null,
        auxiliaryMediaKind: connectionData.auxiliaryMediaKind || null,
    };
}

function getRoleTagHtml(role) {
    if (role === 'host') {
        return '<span class="role-tag role-tag-host">Host</span>';
    }
    if (role === 'co_host') {
        return '<span class="role-tag role-tag-cohost">Co-host</span>';
    }
    return '';
}

function updateVideoRoleTag(wrapper, role) {
    if (!wrapper) return;
    const labelLeft = wrapper.querySelector('.video-label-left');
    if (!labelLeft) return;
    const existing = labelLeft.querySelector('.role-tag');
    if (existing) existing.remove();
    const tagHtml = getRoleTagHtml(role);
    if (tagHtml) {
        labelLeft.insertAdjacentHTML('beforeend', tagHtml);
    }
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
        const snapshotApplied = applyGlobalSessionSnapshot(sessionData);
        if (!snapshotApplied && sessionData.revision !== undefined) {
            return;
        }

        Object.entries(participantRoles).forEach(([participantId, role]) => {
            const mediaConnectionId =
                getMediaConnectionIdForParticipant(participantId)
                || (participantId === appState.currentRootParticipantId ? appState.currentParticipantId : null);
            const participant = mediaConnectionId ? participantsData.get(mediaConnectionId) : null;
            if (participant) {
                participant.role = role;
                participantsData.set(mediaConnectionId, participant);
            }

            const wrapperId =
                participantId === appState.currentRootParticipantId
                    ? 'localVideoWrapper'
                    : mediaConnectionId
                    ? `video-${mediaConnectionId}`
                    : null;
            const wrapper = wrapperId ? document.getElementById(wrapperId) : null;
            if (wrapper) {
                wrapper.dataset.role = role;
                updateVideoRoleTag(wrapper, role);
            }
        });

        reorderGalleryByParticipantRole();
        updateChatRecipientOptions();

        if (appState.isParticipantsOpen) {
            renderParticipantsList();
        }
        renderBreakoutsPanel();
    } catch (error) {
        logEvent('warn', 'Could not sync participant roles');
    }
}

function showConferenceRoom() {
    elements.joinContainer.style.display = 'none';
    elements.conferenceContainer.style.display = 'flex';
    elements.currentSessionId.textContent =
        appState.currentRoomTarget?.type === 'breakout'
            ? `${appState.sessionId} / ${appState.currentRoomTarget.displayName || 'Breakout'}`
            : appState.sessionId;
    elements.localNickname.textContent = appState.nickname;
    elements.localLanguage.textContent = appState.preferredLanguage.toUpperCase();
    
    // Set up local avatar
    const localAvatar = document.getElementById('localAvatar');
    const localAvatarInitial = document.getElementById('localAvatarInitial');
    const localWrapper = document.getElementById('localVideoWrapper');
    localWrapper.dataset.role = appState.authRole || 'participant';
    localWrapper.dataset.nickname = appState.nickname || 'You';
    setupAvatar(localWrapper, appState.nickname, localAvatar, localAvatarInitial);
    updateVideoRoleTag(localWrapper, appState.authRole || 'participant');
    
    syncLocalMediaControlUi();

    reorderGalleryByParticipantRole();
    updateVideoGridLayoutState();
    applyPermissionBasedUi();
}

function showJoinForm() {
    elements.conferenceContainer.style.display = 'none';
    elements.joinContainer.style.display = 'flex';
    hideWaitingRoom();
    clearMockParticipants();
    updateParticipantCount();
    applyStoredNickname();

    const roomId = getRoomIdFromUrl();
    setElementVisibility(elements.homeCard, !roomId, 'block');
    setElementVisibility(elements.joinCard, Boolean(roomId), 'block');
    
    // Restart preview when returning to join form
    initPreview();
    applyPermissionBasedUi();
}

function updateParticipantCount() {
    const remoteParticipantCount = Array.from(participantsData.values()).filter(
        (participant) => !participant.isLocal
    ).length;
    const count = remoteParticipantCount + (appState.isConnected || appState.sessionId ? 1 : 0);
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
function createRemoteVideoElement(participantData) {
    // Accept either LiveKit participant data or legacy connection object
    const identity = participantData.identity || participantData.connectionId;
    const metadata = participantData.metadata || (() => {
        try { return JSON.parse(participantData.data || '{}'); } catch { return {}; }
    })();
    const track = participantData.track || null;
    const connectionId = identity;
    const nickname = metadata.nickname || 'Participant';
    const connectionData = { ...metadata, nickname, preferredLanguage: metadata.preferredLanguage || 'en', role: metadata.role || 'participant' };

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
        existingWrapper.dataset.role = connectionData.role;
        existingWrapper.dataset.nickname = nickname;
        updateVideoRoleTag(existingWrapper, connectionData.role);

        if (track && track.kind === 'video') {
            const video = document.getElementById(`video-element-${connectionId}`);
            if (video) {
                track.attach(video);
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
            ${getRoleTagHtml(connectionData.role)}
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
    
    // Attach track to video element if available
    if (track && track.kind === 'video') {
        track.attach(video);
    } else {
        // No video track yet - show avatar
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
function createRemoteScreenShareElement(screenData, options = {}) {
    const connectionId = screenData.identity;
    const track = screenData.track || null;
    const shouldMutePlayback = Boolean(options.muteAudio);
    
    // Get nickname from participant metadata
    const metadata = livekitClient.getParticipantMetadata(connectionId);
    let nickname = metadata.nickname || 'Participant';
    nickname = nickname.replace(/\s*\(Screen\)\s*$/, '');
    
    const existingWrapper = document.getElementById(`screen-share-${connectionId}`);
    if (existingWrapper) {
        const video = existingWrapper.querySelector('video');
        if (video && track) {
            video.muted = shouldMutePlayback;
            video.defaultMuted = shouldMutePlayback;
            video.volume = shouldMutePlayback ? 0 : 1;
            track.attach(video);
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
    video.muted = shouldMutePlayback;
    video.defaultMuted = shouldMutePlayback;
    video.volume = shouldMutePlayback ? 0 : 1;
    
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
    
    // Attach track to video element
    if (track) {
        track.attach(video);
    }
    
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
    const tracks = livekitClient.getRemoteAudioTracks();
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

    const consoleMethod =
        type === 'error' ? 'error'
            : type === 'warn' ? 'warn'
                : 'log';
    console[consoleMethod](`[Voycelink] ${message}`);
    
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

    const remoteParticipants = livekitClient.subscribers.size;
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
    const subscribers = livekitClient.subscribers;
    if (subscribers.size === 0) return [];
    
    const participants = [];
    
    for (const [connectionId, participant] of subscribers) {
        let connectionData = {};
        try {
            connectionData = JSON.parse(participant.metadata || '{}');
        } catch (e) {
            connectionData = { preferredLanguage: 'en' };
        }
        
        // Skip screen share connections
        if (connectionData.isScreenShare) continue;
        
        const audioTrack = livekitClient.getAudioTrackForParticipant(connectionId);
        const videoElement = document.getElementById(`video-element-${connectionId}`);
        
        participants.push({
            connectionId,
            subscriber: participant,
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
    const participant = livekitClient.subscribers.get(connectionId);
    if (!participant) return null;
    
    let connectionData = {};
    try {
        connectionData = JSON.parse(participant.metadata || '{}');
    } catch (e) {
        connectionData = { preferredLanguage: 'en' };
    }
    
    const audioTrack = livekitClient.getAudioTrackForParticipant(connectionId);
    const videoElement = document.getElementById(`video-element-${connectionId}`);
    
    return {
        connectionId,
        subscriber: participant,
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

    const remoteParticipants = livekitClient.subscribers.size;
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
    const globalParticipants = getGlobalParticipantsForPanels()
        .filter((participant) => !participant.isLocal && participant.presence === 'connected')
        .map((participant) => ({
            ...participant,
            messageTargetConnectionId: participant.mediaConnectionId || null,
        }))
        .filter((participant) => Boolean(participant.messageTargetConnectionId));

    const participants =
        globalParticipants.length > 0
            ? globalParticipants
            : Array.from(participantsData.values())
                .filter((participant) => !participant.isLocal)
                .map((participant) => ({
                    ...participant,
                    messageTargetConnectionId: participant.connectionId,
                }));

    const sortedParticipants = [...participants].sort(compareParticipantsByRoleAndName);

    if (canModerateChatRecipients()) {
        return sortedParticipants;
    }

    return sortedParticipants.filter((participant) => participant.role === 'host' || participant.role === 'co_host');
}

async function updateSessionConfiguration(roomConfiguration) {
    if (!appState.sessionId) {
        return null;
    }

    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_CONFIGURATION(appState.sessionId)}`,
        {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roomConfiguration }),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to update room configuration');
    }

    const payload = await response.json();
    appState.sessionFeatures = {
        ...appState.sessionFeatures,
        ...(payload.roomConfiguration || {}),
    };
    if (payload.revision !== undefined) {
        appState.currentSessionSnapshotRevision = normalizeSnapshotRevision(payload.revision);
    }
    applyPermissionBasedUi();
    updateChatRecipientOptions();
    return payload;
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
                `<option value="${participant.messageTargetConnectionId}" data-nickname="${escapeHtml(participant.nickname)}">Direct to ${escapeHtml(participant.nickname)}</option>`
            );
        });
    }

    if (options.length === 0) {
        elements.chatRecipientSelect.innerHTML = '<option value="">No available destinations</option>';
        elements.chatRecipientSelect.disabled = true;
        elements.chatInput.disabled = true;
        elements.sendChatBtn.disabled = true;
        elements.chatInput.placeholder = canSendDirectMessages()
            ? 'No connected host or co-host available'
            : 'Messaging is disabled for your access level';
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

async function persistWhiteboardState(updates = {}) {
    if (!appState.sessionId) {
        return null;
    }

    const location =
        appState.currentRoomTarget?.type === 'breakout' && appState.currentRoomTarget.breakoutRoomId
            ? {
                roomType: 'breakout',
                breakoutRoomId: appState.currentRoomTarget.breakoutRoomId,
            }
            : {
                roomType: 'main',
                breakoutRoomId: null,
            };

    const participantId = getCurrentRootParticipantId();
    const response = await apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.WHITEBOARD_STATE(appState.sessionId)}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...location,
                ...(participantId ? { participantId } : {}),
                ...updates,
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.details || 'Failed to update whiteboard state');
    }

    const payload = await response.json().catch(() => ({}));
    if (isOutdatedSnapshotPayload(payload)) {
        return payload;
    }
    applyGlobalSessionSnapshot(payload);
    return payload;
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
    renderBreakoutsPanel();
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
    renderBreakoutsPanel();
}

/**
 * Update participants count display
 */
function updateParticipantsCount() {
    const panelCount = shouldUseGlobalRosterView()
        ? getGlobalParticipantsForPanels().filter((participant) => participant.presence === 'connected').length
        : Array.from(participantsData.values()).filter((participant) => !participant.isLocal).length +
            (appState.isConnected ? 1 : 0);
    elements.participantsPanelCount.textContent = panelCount;
    updateParticipantCount();
}

/**
 * Render the participants list
 */
function renderParticipantsList() {
    const pendingWaitingRoomRequests = canAdmitWaitingRoom()
        ? (appState.waitingRoomRequests || []).filter((request) => request.status === 'pending')
        : [];
    const roster = shouldUseGlobalRosterView()
        ? getGlobalParticipantsForPanels().filter((participant) => participant.presence === 'connected')
        : Array.from(participantsData.values()).map((participant) => {
            const rootParticipantId = participant.isLocal
                ? getCurrentRootParticipantId()
                : getRootParticipantIdForMediaConnection(participant.connectionId);
            const location = rootParticipantId
                ? appState.participantLocations?.[rootParticipantId]
                : null;

            return {
                ...participant,
                presence: rootParticipantId ? getParticipantPresence(rootParticipantId) : 'connected',
                location: location || {
                    type: 'main',
                    breakoutRoomId: null,
                },
                locationLabel: rootParticipantId ? getParticipantLocationLabel(rootParticipantId) : 'Main room',
                permissions: rootParticipantId
                    ? {
                        ...getDefaultParticipantPermissionState(),
                        ...(appState.participantPermissionState?.[rootParticipantId] || participant.permissions || {}),
                    }
                    : (participant.permissions || getDefaultParticipantPermissionState()),
            };
        });

    if (roster.length === 0 && pendingWaitingRoomRequests.length === 0) {
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
    const sortedParticipants = roster.sort(compareParticipantsByRoleAndName);

    const waitingRoomMarkup = pendingWaitingRoomRequests.length > 0
        ? `
            <div class="participants-section waiting-room-section">
                <div class="participants-section-title">Waiting room</div>
                ${pendingWaitingRoomRequests.map((request) => `
                    <div class="participant-item waiting-room-request-item" data-waiting-request-id="${request.id}">
                        <div class="participant-avatar">${escapeHtml((request.nickname || '?').charAt(0).toUpperCase())}</div>
                        <div class="participant-info">
                            <div class="participant-name">
                                <span class="participant-name-text">${escapeHtml(request.nickname || 'Guest')}</span>
                            </div>
                            <div class="participant-status">
                                <i data-lucide="clock-3"></i>
                                Waiting for approval
                            </div>
                            <div class="participant-status">${escapeHtml((request.preferredLanguage || 'en').toUpperCase())}</div>
                        </div>
                        <div class="participant-actions" style="opacity: 1;">
                            <button class="participant-action-btn approve-btn" data-waiting-request-id="${request.id}" title="Admit to meeting">
                                <i data-lucide="check"></i>
                            </button>
                            <button class="participant-action-btn kick-btn reject-btn" data-waiting-request-id="${request.id}" title="Reject request">
                                <i data-lucide="x"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `
        : '';

    const participantMarkup = sortedParticipants.map(p => {
        const initials = p.nickname.charAt(0).toUpperCase();
        const isYou = p.isLocal;
        const isProtectedTarget = !canManageTargetParticipantRole(p.role);
        const roleLabel = getParticipantRoleListLabel(p.role);
        const isParticipantInCurrentRoom = !shouldUseGlobalRosterView() || (
            p.location?.type === (appState.currentRoomTarget?.type || 'main') &&
            (p.location?.breakoutRoomId || null) === (appState.currentRoomTarget?.breakoutRoomId || null)
        );
        const canMuteParticipant =
            canManageParticipantMedia() &&
            !isYou &&
            !isProtectedTarget &&
            p.presence === 'connected' &&
            isParticipantInCurrentRoom;
        const canRemoveParticipant = canKickParticipants() && !isYou && !isProtectedTarget;
        const canModerateParticipant = canMuteParticipant || canRemoveParticipant;
        const canManagePermissionGrants =
            (canManageParticipantMedia() || canManageWhiteboard()) &&
            !isYou &&
            !isProtectedTarget;
        const canToggleCoHostRole =
            !isYou &&
            ((p.role !== 'co_host' && canAssignCoHosts()) || (p.role === 'co_host' && canRemoveCoHosts()));
        const participantPermissions = p.permissions || getDefaultParticipantPermissionState();
        const isAccessMenuOpen = activeParticipantAccessMenuId === p.connectionId;
        
        return `
            <div class="participant-item ${isYou ? 'is-you' : ''}" data-connection-id="${p.connectionId}">
                <div class="participant-avatar">${initials}</div>
                <div class="participant-info">
                    <div class="participant-name">
                        <span class="participant-name-text">${escapeHtml(p.nickname)}</span>
                        ${roleLabel ? `<span class="participant-role-label">(${escapeHtml(roleLabel)})</span>` : ''}
                        ${isYou ? '<span class="participant-you-badge">You</span>' : ''}
                    </div>
                    <div class="participant-status ${p.isMuted ? 'muted' : ''}">
                        ${p.presence !== 'connected'
                            ? '<i data-lucide="user-round-x"></i> Outside conference'
                            : p.isMuted 
                            ? '<i data-lucide="mic-off"></i> Muted' 
                            : '<i data-lucide="mic"></i> Active'}
                    </div>
                    <div class="participant-status">${escapeHtml(p.locationLabel || 'Main room')}</div>
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
                                    ${canToggleCoHostRole ? `
                                        <button class="participant-access-menu-item participant-role-menu-item" data-connection-id="${p.connectionId}" data-next-role="${p.role === 'co_host' ? 'participant' : 'co_host'}">
                                            ${p.role === 'co_host' ? 'Remove co-host role' : 'Make co-host'}
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
                                data-connection-id="${p.mediaConnectionId || ''}" 
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

    const showBulkActions = canManageParticipantMedia() && sortedParticipants.filter(p => !p.isLocal && canManageTargetParticipantRole(p.role) && p.presence === 'connected').length > 1;
    const bulkActionsMarkup = showBulkActions ? `
        <div class="participants-bulk-actions">
            <button class="bulk-action-btn bulk-enable-all" title="Enable mic & camera for all participants">
                <i data-lucide="mic"></i>
                <span>Enable all</span>
            </button>
            <button class="bulk-action-btn bulk-disable-all" title="Disable mic & camera for all participants">
                <i data-lucide="mic-off"></i>
                <span>Disable all</span>
            </button>
        </div>
    ` : '';

    elements.participantsList.innerHTML = `
        ${bulkActionsMarkup}
        ${waitingRoomMarkup}
        ${participantMarkup
            ? `
                <div class="participants-section">
                    ${waitingRoomMarkup ? '<div class="participants-section-title">In conference</div>' : ''}
                    ${participantMarkup}
                </div>
            `
            : ''}
    `;
    
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

    elements.participantsList.querySelectorAll('.participant-role-menu-item').forEach((button) => {
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            await toggleParticipantCoHostRole(button.dataset.connectionId, button.dataset.nextRole);
        });
    });

    elements.participantsList.querySelectorAll('.approve-btn').forEach((button) => {
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            await withButtonProtection(button, async () => {
                await approveWaitingRoomRequest(button.dataset.waitingRequestId);
                showNotification('Participant admitted to the meeting.', 'info');
            });
        });
    });

    elements.participantsList.querySelectorAll('.reject-btn').forEach((button) => {
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            await withButtonProtection(button, async () => {
                await rejectWaitingRoomRequest(button.dataset.waitingRequestId);
                showNotification('Waiting room request rejected.', 'info');
            });
        });
    });

    // Bulk action handlers
    const enableAllBtn = elements.participantsList.querySelector('.bulk-enable-all');
    if (enableAllBtn) {
        enableAllBtn.addEventListener('click', async (event) => {
            event.stopPropagation();
            await withButtonProtection(enableAllBtn, async () => {
                await bulkUpdateParticipantPermissions({ mediaEnabled: true });
            });
        });
    }

    const disableAllBtn = elements.participantsList.querySelector('.bulk-disable-all');
    if (disableAllBtn) {
        disableAllBtn.addEventListener('click', async (event) => {
            event.stopPropagation();
            await withButtonProtection(disableAllBtn, async () => {
                await bulkUpdateParticipantPermissions({ mediaEnabled: false });
            });
        });
    }
}

/**
 * Request a participant to mute their microphone
 */
function requestMuteParticipant(connectionId) {
    if (!livekitClient.room) return;
    if (!connectionId) return;
    if (!canManageParticipantMedia()) {
        showNotification('You do not have permission to manage participant media.', 'error');
        return;
    }
    
    const participant = getParticipantForModeration(connectionId);
    if (!participant) return;
    if (!canManageTargetParticipantRole(participant.role)) {
        showNotification('Co-hosts cannot mute the host or other co-hosts.', 'error');
        return;
    }
    
    // Send data message to request mute
    livekitClient.sendData('requestMute', { fromNickname: appState.nickname }, [connectionId])
        .then(() => logEvent('info', `Sent mute request to ${participant.nickname}`))
        .catch(err => console.error('Error sending mute request:', err));
}

/**
 * Kick a participant from the call
 */
async function kickParticipant(connectionId) {
    if (!appState.sessionId) return;
    if (!canKickParticipants()) {
        showNotification('You do not have permission to remove participants.', 'error');
        return;
    }
    
    const participant =
        getGlobalParticipantsForPanels().find((candidate) => candidate.connectionId === connectionId)
        || participantsData.get(connectionId);
    if (!participant) return;
    if (!canManageTargetParticipantRole(participant.role)) {
        showNotification('Co-hosts cannot remove the host or other co-hosts.', 'error');
        return;
    }
    
    // Confirm before kicking
    if (!confirm(`Remove ${participant.nickname} from the call?`)) {
        return;
    }

    apiFetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSION_PARTICIPANT(appState.sessionId, connectionId)}`,
        { method: 'DELETE' }
    )
        .then(async (response) => {
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.details || 'Failed to remove participant');
            }

            logEvent('info', `Removed ${participant.nickname} from the call`);
            showNotification(`${participant.nickname} was removed from the call.`, 'info');
        })
        .catch((err) => {
            console.error('Error kicking participant:', err);
            showNotification(err.message || 'Failed to remove participant.', 'error');
        });
}

/**
 * Handle incoming mute request signal
 */
async function handleMuteRequest(event) {
    try {
        const data = JSON.parse(event.data);
        const senderParticipant = getParticipantForModeration(event?.from?.connectionId);
        const senderRole = senderParticipant?.role || 'participant';
        const localRole = appState.authRole || 'participant';
        const senderCanRequestMute =
            senderRole === 'host' ||
            (senderRole === 'co_host' && localRole !== 'host' && localRole !== 'co_host');

        if (!senderCanRequestMute) {
            logEvent('warn', `Ignored mute request from ${senderParticipant?.nickname || 'unknown participant'} due to insufficient moderation privileges`);
            return;
        }

        // Show notification and auto-mute
        const message = `${data.fromNickname} has requested you to mute your microphone`;
        
        // Auto-mute the user
        if (isLocalAudioLive()) {
            await livekitClient.toggleAudio();
            appState.isAudioEnabled = false;
            syncLocalMediaControlUi();
        }
        
        // Show a brief notification
        showNotification(message, 'info');
        logEvent('info', message);
    } catch (e) {
        console.error('Error handling mute request:', e);
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
    elements.waitingRoomBadge.style.display = 'none';
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

    if (!livekitClient.room) {
        console.error('[Reactions] No room available');
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
    
    livekitClient.sendData('reaction', signalData)
        .then(() => console.log('[Reactions] Signal sent successfully'))
        .catch(err => console.error('[Reactions] Error sending reaction:', err));
    
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
 * Handle received reaction (called from onDataReceived)
 */
function handleReceivedReaction(data, senderIdentity) {
    console.log('[Reactions] Received reaction from', senderIdentity, ':', data.reaction);
    showReactionOnVideo(`video-${senderIdentity}`, data.reaction);
    logEvent('info', `${data.senderName} reacted: ${data.reaction}`);
}

// =============================================================================
// AI Interpreter Visual Feedback (Signals)
// =============================================================================

/**
 * Handle interpreter active signal (called from onDataReceived)
 */
function handleInterpreterActiveSignal(data, senderIdentity) {
    updateRemoteInterpreterAvatar(senderIdentity, 'active', data.active);
}

/**
 * Handle AI speaking signal (called from onDataReceived)
 */
function handleAiSpeakingSignal(data, senderIdentity) {
    updateRemoteInterpreterAvatar(senderIdentity, 'speaking', data.speaking);
}

/**
 * Handle AI listening signal (called from onDataReceived)
 */
function handleAiListeningSignal(data, senderIdentity) {
    updateRemoteInterpreterAvatar(senderIdentity, 'listening', data.listening);
}

/**
 * Send interpreter active state signal to all participants
 */
function sendInterpreterActiveSignal(active) {
    if (!livekitClient.room) return;
    
    livekitClient.sendData('interpreter-active', { active })
        .catch(err => console.error('Error sending interpreter signal:', err));
    
    // Update local AI avatar
    updateLocalInterpreterAvatar('active', active);
}

/**
 * Send AI speaking state signal to all participants
 */
function sendAiSpeakingSignal(speaking) {
    if (!livekitClient.room) return;
    
    livekitClient.sendData('ai-speaking', { speaking })
        .catch(err => console.error('Error sending AI speaking signal:', err));
    
    // Update local AI avatar speaking state
    updateLocalInterpreterAvatar('speaking', speaking);
}

/**
 * Send AI listening state signal to all participants
 */
function sendAiListeningSignal(listening) {
    if (!livekitClient.room) return;
    
    livekitClient.sendData('ai-listening', { listening })
        .catch(err => console.error('Error sending AI listening signal:', err));
    
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
// LiveKit Event Handlers
// =============================================================================

function setupLiveKitCallbacks() {
    // Track subscribed - a remote participant's track is ready to use
    livekitClient.onTrackSubscribed = (track, publication, participant) => {
        const identity = participant.identity;
        const metadata = livekitClient.getParticipantMetadata(identity);
        
        logEvent('info', `Track subscribed: ${track.kind} from ${identity}`);
        
        const isScreenShare = track.source === 'screen_share' || track.source === 'screen_share_audio';
        
        if (isScreenShare && track.kind === 'video') {
            if (!doesConnectionBelongToCurrentRoom(metadata)) {
                logEvent('info', `Ignoring screen share from ${identity} outside current room`);
                return;
            }
            const isOwnScreenShare = isOwnScreenShareConnection(identity, metadata);
            // Create screen share video element
            const videoEl = track.attach();
            createRemoteScreenShareElement({ identity, track, videoElement: videoEl }, { muteAudio: isOwnScreenShare });
            logEvent('info', `Screen share displayed from ${identity}`);
        } else if (track.kind === 'video') {
            if (metadata.isScreenShare) return;
            
            // Regular camera track - attach to existing video element or create one
            const videoElement = document.getElementById(`video-element-${identity}`);
            if (videoElement) {
                track.attach(videoElement);
            } else {
                createRemoteVideoElement({ identity, metadata, track, participant });
            }
            
            // Show/hide avatar based on video state
            const wrapper = document.getElementById(`video-${identity}`);
            const avatar = document.getElementById(`avatar-${identity}`);
            if (wrapper && avatar) {
                wrapper.classList.remove('camera-off');
                avatar.classList.remove('visible');
            }
        } else if (track.kind === 'audio') {
            if (metadata.isScreenShare) {
                // Screen share audio - attach for playback
                const audioEl = track.attach();
                audioEl.id = `screen-audio-${identity}`;
                document.body.appendChild(audioEl);
                return;
            }
            
            // Regular audio track
            const audioEl = track.attach();
            audioEl.id = `audio-${identity}`;
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
            
            // Set up speaking detection
            setupRemoteSpeakingDetection(identity, track.mediaStreamTrack);
            
            // If interpreter is active, add this participant
            if (appState.isInterpreterActive) {
                const participantInfo = getRemoteParticipantInfo(identity);
                if (participantInfo) {
                    interpreterManager.addParticipant(participantInfo);
                }
            }
            
            // If transcription is active, add this participant
            if (appState.isTranscriptionActive) {
                const participantInfo = getRemoteParticipantInfo(identity);
                if (participantInfo) {
                    transcriptionManager.addParticipant(participantInfo);
                }
            }
            
            // Broadcast interpreter state to new participant
            if (appState.isInterpreterActive) {
                sendInterpreterActiveSignal(true);
            }
        }
    };
    
    // Track unsubscribed
    livekitClient.onTrackUnsubscribed = (track, publication, participant) => {
        const identity = participant.identity;
        const isScreenShare = track.source === 'screen_share' || track.source === 'screen_share_audio';
        
        track.detach().forEach(el => el.remove());
        
        if (isScreenShare && track.kind === 'video') {
            removeRemoteScreenShareElement(identity);
            logEvent('info', `Remote screen share ended from ${identity}`);
        } else if (track.kind === 'audio' && !isScreenShare) {
            const audioEl = document.getElementById(`audio-${identity}`);
            if (audioEl) audioEl.remove();
            cleanupRemoteSpeakingDetection(identity);
            
            if (interpreterManager.isActive) {
                interpreterManager.removeParticipant(identity);
            }
            if (transcriptionManager.isActive) {
                transcriptionManager.removeParticipant(identity);
            }
        }
    };
    
    // Track muted/unmuted - handle video avatar toggle
    livekitClient.onTrackMuted = (publication, participant) => {
        if (publication.kind === 'video' && publication.source === 'camera') {
            const wrapper = document.getElementById(`video-${participant.identity}`);
            const avatar = document.getElementById(`avatar-${participant.identity}`);
            if (wrapper && avatar) {
                wrapper.classList.add('camera-off');
                avatar.classList.add('visible');
            }
        }
    };
    
    livekitClient.onTrackUnmuted = (publication, participant) => {
        if (publication.kind === 'video' && publication.source === 'camera') {
            const wrapper = document.getElementById(`video-${participant.identity}`);
            const avatar = document.getElementById(`avatar-${participant.identity}`);
            if (wrapper && avatar) {
                wrapper.classList.remove('camera-off');
                avatar.classList.remove('visible');
            }
        }
    };
    
    // Participant connected
    livekitClient.onParticipantConnected = (participant) => {
        const metadata = JSON.parse(participant.metadata || '{}');
        if (!doesConnectionBelongToCurrentRoom(metadata)) {
            updateParticipantCount();
            return;
        }
        if (metadata.rootParticipantId === getCurrentRootParticipantId()) {
            updateParticipantCount();
            return;
        }
        
        if (!metadata.isScreenShare) {
            createRemoteVideoElement({ identity: participant.identity, metadata, participant });
            addParticipantToPanel(participant.identity, metadata.nickname || 'Participant', false, metadata.role);
            syncParticipantRolesFromSession();
            playJoinSound();
        }
        
        updateParticipantCount();
        updateAudioTracksDebug();
        updateInterpreterButtonState();
        updateTranscriptionButtonState();
    };
    
    // Participant disconnected
    livekitClient.onParticipantDisconnected = (participant) => {
        const identity = participant.identity;
        const hadParticipant = participantsData.has(identity);
        
        // Clean up all attached elements
        const audioEl = document.getElementById(`audio-${identity}`);
        if (audioEl) audioEl.remove();
        const screenAudioEl = document.getElementById(`screen-audio-${identity}`);
        if (screenAudioEl) screenAudioEl.remove();
        
        removeRemoteVideoElement(identity);
        removeRemoteScreenShareElement(identity);
        removeParticipantFromPanel(identity);
        cleanupRemoteSpeakingDetection(identity);
        
        if (hadParticipant) {
            playLeaveSound();
        }
        
        updateParticipantCount();
        updateAudioTracksDebug();
        updateInterpreterButtonState();
        updateTranscriptionButtonState();
        
        if (interpreterManager.isActive) {
            interpreterManager.removeParticipant(identity);
        }
        if (transcriptionManager.isActive) {
            transcriptionManager.removeParticipant(identity);
        }
    };
    
    // Data received - handles all data channel messages
    livekitClient.onDataReceived = (data, participant, topic) => {
        if (!participant) return;
        const identity = participant.identity;
        
        // Skip our own messages
        if (identity === livekitClient.room?.localParticipant?.identity) return;
        
        try {
            const parsed = JSON.parse(data);
            
            switch (topic) {
                case 'reaction':
                    handleReceivedReaction(parsed, identity);
                    break;
                case 'requestMute':
                    handleMuteRequest({ data, from: { connectionId: identity } });
                    break;
                case 'interpreter-active':
                    handleInterpreterActiveSignal(parsed, identity);
                    break;
                case 'ai-speaking':
                    handleAiSpeakingSignal(parsed, identity);
                    break;
                case 'ai-listening':
                    handleAiListeningSignal(parsed, identity);
                    break;
                case 'chat':
                    chatManager.handleChatData(parsed, identity);
                    break;
                case 'whiteboard-object':
                case 'whiteboard-clear':
                case 'whiteboard-sync':
                case 'whiteboard-state':
                case 'whiteboard-request-sync':
                    whiteboardManager.handleWhiteboardData(topic, parsed, identity);
                    break;
            }
        } catch (e) {
            logEvent('error', `Error parsing data message: ${e.message}`);
        }
    };
    
    livekitClient.onLog = (type, message) => {
        logEvent(type, message);
    };

    // Handle reconnection events
    livekitClient.onReconnecting = () => {
        updateConnectionStatus(false);
        elements.connectionStatus.textContent = 'Reconnecting...';
        elements.connectionStatus.style.background = '#f59e0b';
        logEvent('warn', 'Attempting to reconnect...');
        clearReconnectTimeout();
        reconnectTimeoutId = setTimeout(() => {
            handleConnectionLost('Connection lost');
        }, 12000);
    };

    livekitClient.onReconnected = () => {
        clearReconnectTimeout();
        updateConnectionStatus(true);
        logEvent('info', 'Connection restored!');
    };

    livekitClient.onDisconnected = (reason) => {
        if (isLeavingSessionIntentional || isSwitchingRooms) {
            return;
        }
        handleConnectionLost(reason || 'Session disconnected');
    };
}

function clearReconnectTimeout() {
    if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
    }
}

function handleConnectionLost(reason = 'Connection lost') {
    if (isLeavingSessionIntentional || isSwitchingRooms || hasHandledConnectionLoss) {
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

function clearCurrentRoomUiForReconnect() {
    if (appState.isInterpreterActive) {
        stopInterpreter();
    }

    if (appState.isTranscriptionActive) {
        stopTranscription();
    }

    if (appState.isScreenSharing) {
        stopScreenShare();
    }

    chatManager.destroy();
    resetChatUI();
    participantsData.clear();
    setActiveScreenShare(null);
    updateParticipantCount();
    updateParticipantsCount();
    updateChatRecipientOptions();
    if (appState.isParticipantsOpen) {
        renderParticipantsList();
    }
    stopSpeakingDetection();
    whiteboardManager.destroy?.();

    const remoteVideos = document.querySelectorAll('.remote-video, .screen-share-video');
    remoteVideos.forEach((element) => element.remove());

    livekitClient.disconnect();
    disconnectPermissionsWebSocket();
}

async function reconnectToAssignedRoom() {
    if (!appState.sessionId || !appState.nickname || isSwitchingRooms) {
        return;
    }

    isSwitchingRooms = true;

    try {
        const previousParticipantId = appState.currentParticipantId || getStoredRoomParticipantId(appState.sessionId);
        const rootParticipantId = getCurrentRootParticipantId();
        logEvent(
            'info',
            `Reconnecting to assigned room: ${JSON.stringify({
                sessionId: appState.sessionId,
                previousParticipantId,
                rootParticipantId,
                currentRoomTarget: appState.currentRoomTarget,
                currentRevision: appState.currentSessionSnapshotRevision,
            })}`
        );
        clearCurrentRoomUiForReconnect();
        appState.currentParticipantId = null;

        const tokenData = await getToken(
            appState.sessionId,
            appState.nickname,
            appState.preferredLanguage,
            { previousParticipantId: rootParticipantId || previousParticipantId, rootParticipantId: rootParticipantId || previousParticipantId }
        );
        const { token, connectionId, roomTarget, rootParticipantId: nextRootParticipantId } = tokenData;

        setupLiveKitCallbacks();
        livekitClient.init();
        const reconnectLivekitUrl = tokenData.livekitUrl || CONFIG.LIVEKIT_URL || '';
        await livekitClient.connect(reconnectLivekitUrl, token);
        appState.currentParticipantId = connectionId || livekitClient.room?.localParticipant?.identity;
        appState.currentRootParticipantId = nextRootParticipantId || rootParticipantId || previousParticipantId || null;
        appState.currentRoomTarget = roomTarget || appState.currentRoomTarget;
        storeRoomParticipantId(appState.sessionId, appState.currentRootParticipantId);
        updateConnectionStatus(true);
        await fetchRoomTargetForCurrentParticipant().catch(() => null);
        await refreshCurrentPermissions({ silent: true });
        await fetchBreakoutSnapshot().catch(() => null);

        showConferenceRoom();

        const canPublishLocalAudio =
            previewState.hasAudioInput &&
            previewState.audioPermission === 'granted' &&
            canPublishAudio();
        const canPublishLocalVideo =
            previewState.hasVideoInput &&
            previewState.videoPermission === 'granted' &&
            canPublishVideo();

        if (canPublishLocalAudio || canPublishLocalVideo) {
            await publishLocalStreamWithCurrentPermissions();
        }

        initializeChat(livekitClient);
        whiteboardManager.initialize(livekitClient, {
            roomTarget: appState.currentRoomTarget,
            initialState: getCurrentRoomWhiteboardState(),
            onPersistState: persistWhiteboardState,
        });
        addParticipantToPanel(appState.currentParticipantId, appState.nickname, true, appState.authRole || 'participant');
        await syncParticipantRolesFromSession();
        if (appState.isParticipantsOpen) {
            renderParticipantsList();
        }
        if (appState.isBreakoutsOpen) {
            renderBreakoutsPanel();
        }
        logEvent(
            'info',
            `Reconnect completed: ${JSON.stringify({
                sessionId: appState.sessionId,
                currentParticipantId: appState.currentParticipantId,
                currentRootParticipantId: appState.currentRootParticipantId,
                currentRoomTarget: appState.currentRoomTarget,
                currentRevision: appState.currentSessionSnapshotRevision,
                localParticipantCount: participantsData.size,
            })}`
        );
        connectPermissionsWebSocket();
        // Signal handlers are managed via onDataReceived callback
    } finally {
        isSwitchingRooms = false;
    }
}

// =============================================================================
// Main Application Flow
// =============================================================================

/**
 * Join a conference session
 */
async function joinSession(sessionId, nickname, preferredLanguage, options = {}) {
    try {
        const {
            skipWaitingRoomCheck = false,
            waitingRequestId: initialWaitingRequestId = null,
        } = options;
        const resolvedSessionId = resolveBoundSessionId(sessionId);
        if (resolvedSessionId !== sessionId) {
            elements.sessionIdInput.value = resolvedSessionId;
            elements.roomIdDisplay.textContent = resolvedSessionId;
            logEvent('warn', `Room mismatch detected. Using bound room ${resolvedSessionId} instead of ${sessionId}`);
        }

        let waitingRequestId = initialWaitingRequestId;
        if (!skipWaitingRoomCheck) {
            const waitingRoomAdmission = await ensureWaitingRoomAdmission(
                resolvedSessionId,
                nickname,
                preferredLanguage
            );
            if (!waitingRoomAdmission.admitted) {
                return;
            }
            waitingRequestId = waitingRoomAdmission.waitingRequestId || waitingRequestId;
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
        const previousParticipantId = getStoredRoomParticipantId(resolvedSessionId);
        const tokenData = await getToken(
            resolvedSessionId,
            nickname,
            preferredLanguage,
            { previousParticipantId, rootParticipantId: previousParticipantId, waitingRequestId }
        );
        const { token, connectionId, roomTarget, rootParticipantId: nextRootParticipantId } = tokenData;
        logEvent('info', 'Token received');
        
        // Initialize LiveKit
        setupLiveKitCallbacks();
        livekitClient.init();
        
        // Connect to room
        const livekitUrl = tokenData.livekitUrl || CONFIG.LIVEKIT_URL || '';
        logEvent('info', 'Connecting to LiveKit...');
        await livekitClient.connect(livekitUrl, token);
        updateConnectionStatus(true);

        const localConnectionId = connectionId || livekitClient.room?.localParticipant?.identity;
        appState.currentParticipantId = localConnectionId;
        appState.currentRootParticipantId = nextRootParticipantId || previousParticipantId || null;
        appState.currentRoomTarget = roomTarget || appState.currentRoomTarget;
        storeRoomParticipantId(resolvedSessionId, appState.currentRootParticipantId);
        clearStoredWaitingRoomRequestId(resolvedSessionId);
        appState.waitingRoomRequestId = null;
        hideWaitingRoom();
        stopWaitingRoomPolling();
        await fetchRoomTargetForCurrentParticipant().catch(() => null);
        await refreshCurrentPermissions({ silent: true });
        await fetchBreakoutSnapshot().catch(() => null);
        
        // Show conference UI
        showConferenceRoom();
        
        const canPublishLocalAudio =
            previewState.hasAudioInput && previewState.audioPermission === 'granted' && canPublishAudio();
        const canPublishLocalVideo =
            previewState.hasVideoInput && previewState.videoPermission === 'granted' && canPublishVideo();

        if (canPublishLocalAudio || canPublishLocalVideo) {
            logEvent('info', 'Publishing local stream...');
            await publishLocalStreamWithCurrentPermissions();
        } else {
            logEvent('info', 'Joined session without local media devices');
        }

        updateMediaAvailabilityUI();
        logEvent('info', 'Successfully joined session!');
        
        // Set up local speaking detection
        if (livekitClient.localAudioTrack) {
            const mediaStream = new MediaStream([livekitClient.localAudioTrack.mediaStreamTrack]);
            setupLocalSpeakingDetection(mediaStream);
        }
        
        // Initialize chat with LiveKit data channels
        initializeChat(livekitClient);
        
        // Initialize whiteboard
        whiteboardManager.initialize(livekitClient, {
            roomTarget: appState.currentRoomTarget,
            initialState: getCurrentRoomWhiteboardState(),
            onPersistState: persistWhiteboardState,
        });
        
        // Reactions and interpreter signals are handled via onDataReceived callback
        
        // Initialize participants panel with local user
        addParticipantToPanel(localConnectionId, nickname, true, appState.authRole || 'participant');
        await syncParticipantRolesFromSession();
        connectPermissionsWebSocket();
        
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
 * In LiveKit, screen sharing publishes tracks via the same room connection
 */
async function startScreenShare() {
    try {
        logEvent('info', 'Starting screen share...');
        
        if (!livekitClient.room) {
            logEvent('error', 'No active room');
            return;
        }
        
        // Create screen share tracks with high quality settings
        let screenTracks;
        try {
            screenTracks = await LivekitClient.createLocalScreenTracks({
                audio: true,
                video: {
                    resolution: { width: 1920, height: 1080 },
                },
            });
        } catch (screenAudioError) {
            logEvent('warn', `Screen audio unavailable, trying video-only: ${screenAudioError?.message}`);
            screenTracks = await LivekitClient.createLocalScreenTracks({
                audio: false,
                video: {
                    resolution: { width: 1920, height: 1080 },
                },
            });
        }
        
        // Publish screen share tracks with high bitrate for crisp quality
        const publishedTracks = [];
        for (const track of screenTracks) {
            const publishOptions = {
                source: track.kind === 'video'
                    ? LivekitClient.Track.Source.ScreenShare
                    : LivekitClient.Track.Source.ScreenShareAudio,
            };
            // Set high bitrate and disable simulcast for screen share
            if (track.kind === 'video') {
                publishOptions.videoEncoding = {
                    maxBitrate: 3_000_000,
                    maxFramerate: 30,
                };
                publishOptions.screenShareEncoding = {
                    maxBitrate: 3_000_000,
                    maxFramerate: 30,
                };
                publishOptions.simulcast = false;
                publishOptions.screenShareSimulcastLayers = [];
            }
            const publication = await livekitClient.room.localParticipant.publishTrack(track, publishOptions);
            publishedTracks.push(track);
            
            // Handle when user stops sharing via browser UI
            if (track.kind === 'video') {
                track.mediaStreamTrack.addEventListener('ended', () => {
                    logEvent('info', 'Screen share stopped by user');
                    stopScreenShare();
                });
            }
        }
        
        logEvent('info', 'Screen share published successfully');
        
        // Store references for cleanup
        appState.screenTracks = publishedTracks;
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
        
        // Unpublish and stop screen share tracks
        if (appState.screenTracks) {
            for (const track of appState.screenTracks) {
                try {
                    livekitClient.room?.localParticipant?.unpublishTrack(track);
                    track.stop();
                } catch (e) {
                    // Ignore errors
                }
            }
            appState.screenTracks = null;
        }
        
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
function notifyParticipantDisconnected(options = {}) {
    const { useBeacon = false } = options;

    const rootParticipantId = getCurrentRootParticipantId();
    if (!appState.sessionId || !rootParticipantId) {
        return;
    }

    const disconnectUrl = new URL(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.PARTICIPANT_DISCONNECT(appState.sessionId, rootParticipantId)}`,
        window.location.origin
    );
    disconnectUrl.searchParams.set('participantId', rootParticipantId);

    if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(disconnectUrl.toString(), new Blob([], { type: 'application/json' }));
        return;
    }

    fetch(disconnectUrl.toString(), {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
    }).catch(() => null);
}

function leaveSession() {
    notifyParticipantDisconnected();
    isLeavingSessionIntentional = true;
    clearReconnectTimeout();
    stopWaitingRoomPolling();
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
    closeBreakoutsPanel();
    
    // Stop speaking detection
    stopSpeakingDetection();
    
    livekitClient.disconnect();
    updateConnectionStatus(false);
    
    // Clear remote videos
    const remoteVideos = document.querySelectorAll('.remote-video');
    remoteVideos.forEach(el => el.remove());
    
    // Reset state
    appState.sessionId = null;
    appState.currentParticipantId = null;
    appState.currentRootParticipantId = null;
    appState.currentRoomTarget = {
        type: 'main',
        breakoutRoomId: null,
        livekitRoomName: null,
        displayName: 'Main room',
    };
    appState.breakoutRooms = [];
    appState.participantLocations = {};
    appState.participantProfiles = {};
    appState.participantRoles = {};
    appState.participantPresence = {};
    appState.participantPermissionState = {};
    appState.participantMediaConnections = {};
    appState.waitingRoomRequests = [];
    appState.waitingRoomRequestId = null;
    appState.isWaitingForAdmission = false;
    waitingRoomNotificationPrimed = false;
    knownPendingWaitingRoomRequestIds = new Set();
    appState.whiteboardState = {
        main: { isOpen: false, canvasState: null, updatedAt: null },
        breakouts: {},
    };
    appState.currentSessionSnapshotRevision = null;
    appState.isAudioEnabled = true;
    appState.isVideoEnabled = true;
    appState.publishedAudioLive = false;
    appState.publishedVideoLive = false;
    appState.isInterpreterActive = false;
    appState.isTranscriptionActive = false;
    appState.sessionFeatures = {
        chatEnabled: true,
        groupChatEnabled: false,
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

    persistNickname(nickname);
    elements.nicknameInput.readOnly = true;
    setElementVisibility(elements.editNicknameBtn, true, 'inline-flex');
    updatePreviewAvatar();
    
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

elements.editNicknameBtn?.addEventListener('click', () => {
    enableNicknameEditing();
});

elements.cancelWaitingRoomBtn?.addEventListener('click', async () => {
    const sessionId = elements.sessionIdInput.value.trim() || getRoomIdFromUrl() || appState.authRoomId;
    const requestId = appState.waitingRoomRequestId || getStoredWaitingRoomRequestId(sessionId);
    if (!sessionId || !requestId) {
        hideWaitingRoom();
        showJoinForm();
        return;
    }

    try {
        await cancelWaitingRoomRequest(sessionId, requestId);
    } catch (error) {
        showNotification(error.message || 'Failed to cancel waiting room request.', 'error');
    }
});

// Audio toggle
elements.toggleAudioBtn.addEventListener('click', async () => {
    const currentlyLive = isLocalAudioLive();

    // If trying to enable, check permission
    if (!currentlyLive) {
        if (!canPublishAudio()) {
            showNotification(getMediaPermissionRestriction('audio') || 'You do not have permission to enable your microphone.', 'error');
            return;
        }
        if (previewState.audioPermission !== 'granted') {
            const granted = await requestDevicePermission('audio');
            if (!granted) return;
        }
        const audioError = getDeviceAccessError('audio');
        if (audioError) {
            showNotification(audioError, 'error');
            return;
        }
    }

    // Perform the toggle
    if (!currentlyLive && !localPublisherHasTrack('audio')) {
        // First time enabling - need to publish the track
        appState.isAudioEnabled = true;
        await publishLocalStreamWithCurrentPermissions();
    } else {
        // Track exists - just toggle mute state
        const newState = await livekitClient.toggleAudio();
        appState.isAudioEnabled = newState;
    }
    syncLocalMediaControlUi();
    logEvent('info', appState.isAudioEnabled ? 'Microphone enabled' : 'Microphone muted');
});

// Video toggle
elements.toggleVideoBtn.addEventListener('click', async () => {
    const currentlyLive = isLocalVideoLive();

    // If trying to enable, check permission
    if (!currentlyLive) {
        if (!canPublishVideo()) {
            showNotification(getMediaPermissionRestriction('video') || 'You do not have permission to enable your camera.', 'error');
            return;
        }
        if (previewState.videoPermission !== 'granted') {
            const granted = await requestDevicePermission('video');
            if (!granted) return;
        }
        const videoError = getDeviceAccessError('video');
        if (videoError) {
            showNotification(videoError, 'error');
            return;
        }
    }

    // Perform the toggle
    if (!currentlyLive && !localPublisherHasTrack('video')) {
        // First time enabling - need to publish the track
        appState.isVideoEnabled = true;
        await publishLocalStreamWithCurrentPermissions();
    } else {
        // Track exists - just toggle mute state
        const newState = await livekitClient.toggleVideo();
        appState.isVideoEnabled = newState;
    }
    syncLocalMediaControlUi();
    logEvent('info', appState.isVideoEnabled ? 'Camera enabled' : 'Camera disabled');
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
elements.nicknameInput.addEventListener('input', updatePreviewAvatar);

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
elements.groupChatToggle?.addEventListener('change', async () => {
    const nextValue = elements.groupChatToggle.checked;

    try {
        await updateSessionConfiguration({ groupChatEnabled: nextValue });
        showNotification(
            nextValue
                ? 'Global chat enabled for participants.'
                : 'Global chat disabled for participants.',
            'info'
        );
    } catch (error) {
        elements.groupChatToggle.checked = appState.sessionFeatures.groupChatEnabled === true;
        showNotification(error.message || 'Failed to update global chat.', 'error');
    }
});

// Participants panel controls
elements.toggleParticipantsBtn.addEventListener('click', toggleParticipants);
elements.closeParticipantsBtn.addEventListener('click', closeParticipants);
elements.toggleBreakoutsBtn?.addEventListener('click', async () => {
    await toggleBreakoutsPanel();
});
elements.closeBreakoutsBtn?.addEventListener('click', closeBreakoutsPanel);
elements.createBreakoutBtn?.addEventListener('click', async () => {
    try {
        await createBreakoutRoom();
    } catch (error) {
        showNotification(error.message || 'Failed to create breakout room.', 'error');
    }
});

// Whiteboard controls
elements.toggleWhiteboardBtn.addEventListener('click', toggleWhiteboardForCurrentRole);
elements.toggleWhiteboardMenuBtn?.addEventListener('click', toggleWhiteboardMenu);
elements.advancedWhiteboardLink?.addEventListener('click', () => {
    closeWhiteboardMenu();
});

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

    if (!e.target.closest('.whiteboard-actions')) {
        closeWhiteboardMenu();
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
    stopWaitingRoomPolling();
    disconnectPermissionsWebSocket();
    stopPreview();
    if (appState.isConnected) {
        notifyParticipantDisconnected({ useBeacon: true });
        livekitClient.disconnect();
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
