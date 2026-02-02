/**
 * Main Application Controller
 * 
 * Orchestrates the UI and OpenVidu client
 */

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
    isConnected: false,
    isAudioEnabled: true,
    isVideoEnabled: true,
    isInterpreterActive: false,
    isTranscriptionActive: false,
    isChatOpen: false,
    isScreenSharing: false,
    screenPublisher: null
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
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn'),
    closeChatBtn: document.getElementById('closeChatBtn'),
    chatBadge: document.getElementById('chatBadge'),
    chatTranslateToggle: document.getElementById('chatTranslateToggle')
};

// Preview state
const previewState = {
    stream: null,
    isAudioEnabled: true,
    isVideoEnabled: true,
    selectedMicId: null,
    selectedCameraId: null,
    selectedSpeakerId: null
};

// =============================================================================
// Room Link Functions
// =============================================================================

/**
 * Generate a random room ID in format: xxx-xxxx-xxx (like Google Meet)
 */
function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const getSegment = (len) => {
        let result = '';
        for (let i = 0; i < len; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };
    return `${getSegment(3)}-${getSegment(4)}-${getSegment(3)}`;
}

/**
 * Create a new meeting - generate room ID and show join form
 */
function createNewMeeting() {
    const roomId = generateRoomId();
    
    // Update URL without reloading (using query param for compatibility)
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.pushState({ roomId }, '', newUrl);
    
    // Show join form with room ID
    elements.homeCard.style.display = 'none';
    elements.joinCard.style.display = 'block';
    elements.sessionIdInput.value = roomId;
    elements.roomIdDisplay.textContent = roomId;
    
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

/**
 * Initialize the page based on URL
 */
function initializePage() {
    const roomId = getRoomIdFromUrl();
    
    if (roomId) {
        // We have a room in URL - show join form
        elements.homeCard.style.display = 'none';
        elements.joinCard.style.display = 'block';
        elements.sessionIdInput.value = roomId;
        elements.roomIdDisplay.textContent = roomId;
    } else {
        // No room - show create meeting button
        elements.homeCard.style.display = 'block';
        elements.joinCard.style.display = 'none';
    }
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Request a session and connection token from the backend
 */
async function getToken(sessionId, nickname, preferredLanguage) {
    // Step 1: Create or get session
    const sessionResponse = await fetch(`${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.SESSIONS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
    });
    
    if (!sessionResponse.ok) {
        const error = await sessionResponse.json();
        throw new Error(error.details || 'Failed to create session');
    }
    
    const sessionData = await sessionResponse.json();
    
    // Step 2: Get connection token
    const tokenResponse = await fetch(
        `${CONFIG.BACKEND_URL}${CONFIG.ENDPOINTS.CONNECTIONS(sessionData.sessionId)}`,
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
    
    return {
        sessionId: sessionData.sessionId,
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
        // Request permissions first
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(track => track.stop());
        
        // Enumerate devices
        await enumerateDevices();
        
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

/**
 * Enumerate available media devices
 */
async function enumerateDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const microphones = devices.filter(d => d.kind === 'audioinput');
        const speakers = devices.filter(d => d.kind === 'audiooutput');
        const cameras = devices.filter(d => d.kind === 'videoinput');
        
        // Populate microphone select
        elements.microphoneSelect.innerHTML = microphones.map((mic, i) => 
            `<option value="${mic.deviceId}">${cleanDeviceLabel(mic.label) || `Microphone ${i + 1}`}</option>`
        ).join('');
        
        // Populate speaker select
        if (speakers.length > 0) {
            elements.speakerSelect.innerHTML = speakers.map((speaker, i) => 
                `<option value="${speaker.deviceId}">${cleanDeviceLabel(speaker.label) || `Speaker ${i + 1}`}</option>`
            ).join('');
        } else {
            elements.speakerSelect.innerHTML = '<option value="">Default speaker</option>';
        }
        
        // Populate camera select
        elements.cameraSelect.innerHTML = cameras.map((cam, i) => 
            `<option value="${cam.deviceId}">${cleanDeviceLabel(cam.label) || `Camera ${i + 1}`}</option>`
        ).join('');
        
        // Store selected devices
        if (microphones.length > 0) previewState.selectedMicId = microphones[0].deviceId;
        if (cameras.length > 0) previewState.selectedCameraId = cameras[0].deviceId;
        if (speakers.length > 0) previewState.selectedSpeakerId = speakers[0].deviceId;
        
        // Update visible labels
        updateDeviceLabels();
        
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
        }
        
        const constraints = {
            video: previewState.isVideoEnabled ? {
                deviceId: previewState.selectedCameraId ? { exact: previewState.selectedCameraId } : undefined
            } : false,
            audio: {
                deviceId: previewState.selectedMicId ? { exact: previewState.selectedMicId } : undefined
            }
        };
        
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
function togglePreviewMic() {
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
}

function showJoinForm() {
    elements.conferenceContainer.style.display = 'none';
    elements.joinContainer.style.display = 'flex';
    updateParticipantCount();
    
    // Restart preview when returning to join form
    initPreview();
}

function updateParticipantCount() {
    const count = openviduClient.subscribers.size + 1; // +1 for local user
    elements.participantCount.textContent = count;
}

/**
 * Create video element for a remote participant
 */
function createRemoteVideoElement(subscriber) {
    const stream = subscriber.stream;
    const connectionId = stream.connection.connectionId;
    
    // Parse connection data
    let connectionData = {};
    try {
        connectionData = JSON.parse(stream.connection.data);
    } catch (e) {
        connectionData = { nickname: 'Unknown', preferredLanguage: 'en' };
    }
    
    const nickname = connectionData.nickname || 'Participant';
    
    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper remote-video';
    wrapper.id = `video-${connectionId}`;
    
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
        <span class="language-badge">${(connectionData.preferredLanguage || 'en').toUpperCase()}</span>
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
    
    // Attach subscriber's stream to video element
    subscriber.addVideoElement(video);
    
    // Check if video is enabled and show avatar if not
    if (!stream.videoActive) {
        wrapper.classList.add('camera-off');
        avatar.classList.add('visible');
    }
    
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

/**
 * Create video element for a remote screen share
 */
function createRemoteScreenShareElement(subscriber) {
    const stream = subscriber.stream;
    const connectionId = stream.connection.connectionId;
    
    // Parse connection data for nickname
    let connectionData = {};
    try {
        connectionData = JSON.parse(stream.connection.data);
    } catch (e) {
        connectionData = { nickname: 'Unknown' };
    }
    
    const nickname = connectionData.nickname || 'Participant';
    
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
    
    // Insert at the beginning of the grid
    elements.videoGrid.insertBefore(wrapper, elements.videoGrid.firstChild);
    
    // Attach subscriber's stream to video element
    subscriber.addVideoElement(video);
    
    // Enable presentation mode
    elements.videoGrid.classList.add('presentation-mode');
    
    return wrapper;
}

/**
 * Remove remote screen share element
 */
function removeRemoteScreenShareElement(connectionId) {
    const wrapper = document.getElementById(`screen-share-${connectionId}`);
    if (wrapper) {
        wrapper.remove();
    }
    
    // Check if there are any other screen shares, if not remove presentation mode
    const remainingScreenShares = document.querySelectorAll('.screen-share-video');
    if (remainingScreenShares.length === 0) {
        elements.videoGrid.classList.remove('presentation-mode');
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
    
    function detectSpeaking() {
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
    
    detectSpeaking();
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
    const remoteParticipants = openviduClient.subscribers.size;
    const hasRemoteParticipant = remoteParticipants > 0;
    
    // Enable button only if there's exactly one remote participant (PoC limitation)
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
    messageEl.className = `chat-message ${message.isLocal ? 'local' : 'remote'}`;
    messageEl.setAttribute('data-message-id', message.id);
    
    const time = message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Use chatManager to get the correct display text based on translation setting
    const displayText = chatManager.getDisplayText(message);
    
    messageEl.innerHTML = `
        <div class="chat-message-header">
            <span class="chat-message-sender" style="color: ${message.color}">${message.nickname}</span>
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
    const text = elements.chatInput.value.trim();
    if (!text) return;
    
    elements.chatInput.value = '';
    await chatManager.sendMessage(text);
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
            // Check if this is a screen share connection (by parsing connection data)
            let connectionData = {};
            try {
                connectionData = JSON.parse(stream.connection.data);
            } catch (e) {}
            
            // Skip creating camera element for screen share connections (they only publish SCREEN)
            if (connectionData.isScreenShare) {
                logEvent('info', `Skipping camera element for screen share connection`);
                return;
            }
            
            // Regular camera stream
            logEvent('info', `Creating regular video element for ${connectionId}`);
            createRemoteVideoElement(subscriber);
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
            // Regular camera stream
            removeRemoteVideoElement(connectionId);
            cleanupRemoteSpeakingDetection(connectionId);
            updateParticipantCount();
            updateAudioTracksDebug();
            updateInterpreterButtonState();
            
            // Play notification sound for participant leaving
            playLeaveSound();
            
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
        updateParticipantCount();
    };
    
    openviduClient.onConnectionDestroyed = (event) => {
        const connectionId = event.connection.connectionId;
        removeRemoteVideoElement(connectionId);
        updateParticipantCount();
        updateAudioTracksDebug();
    };
    
    openviduClient.onException = (exception) => {
        console.error('OpenVidu Exception:', exception);
        
        // Don't show alert for ICE disconnections - they're usually temporary
        if (exception.name !== 'ICE_CONNECTION_DISCONNECTED') {
            // For serious errors, show alert
            if (exception.name === 'ICE_CONNECTION_FAILED') {
                showReconnectPrompt();
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
    };

    openviduClient.onReconnected = () => {
        updateConnectionStatus(true);
        logEvent('info', 'Connection restored!');
    };

    openviduClient.onIceFailure = (exception) => {
        showReconnectPrompt();
    };
}

/**
 * Show reconnection prompt to user
 */
function showReconnectPrompt() {
    // Stop interpreter if active
    if (appState.isInterpreterActive) {
        stopInterpreter();
    }
    
    const shouldReconnect = confirm(
        'Connection lost. Would you like to rejoin the session?'
    );
    
    if (shouldReconnect && appState.sessionId) {
        // Attempt to rejoin
        leaveSession();
        joinSession(appState.sessionId, appState.nickname, appState.preferredLanguage);
    } else {
        leaveSession();
    }
}

// =============================================================================
// Main Application Flow
// =============================================================================

/**
 * Join a conference session
 */
async function joinSession(sessionId, nickname, preferredLanguage) {
    try {
        logEvent('info', `Joining session: ${sessionId}`);
        
        // Update state from preview settings
        appState.sessionId = sessionId;
        appState.nickname = nickname;
        appState.preferredLanguage = preferredLanguage;
        appState.isAudioEnabled = previewState.isAudioEnabled;
        appState.isVideoEnabled = previewState.isVideoEnabled;
        
        // Stop preview stream before joining
        stopPreview();
        
        // Get token from backend
        logEvent('info', 'Requesting token from backend...');
        const { token } = await getToken(sessionId, nickname, preferredLanguage);
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
        
        // Publish local stream with selected devices
        logEvent('info', 'Publishing local stream...');
        const publishOptions = {
            audioSource: previewState.selectedMicId || undefined,
            videoSource: previewState.selectedCameraId || undefined,
            publishAudio: appState.isAudioEnabled,
            publishVideo: appState.isVideoEnabled
        };
        await openviduClient.publish(elements.localVideo, publishOptions);
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
        
        // Initialize interpreter signals
        initializeInterpreterSignals(openviduClient.session);
        
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
    
    // Stop speaking detection
    stopSpeakingDetection();
    
    openviduClient.disconnect();
    updateConnectionStatus(false);
    
    // Clear remote videos
    const remoteVideos = document.querySelectorAll('.remote-video');
    remoteVideos.forEach(el => el.remove());
    
    // Reset state
    appState.sessionId = null;
    appState.isAudioEnabled = true;
    appState.isVideoEnabled = true;
    appState.isInterpreterActive = false;
    appState.isTranscriptionActive = false;
    appState.isScreenSharing = false;
    appState.screenPublisher = null;
    appState.screenSession = null;
    appState.screenOV = null;
    appState.screenConnectionId = null;
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
    
    await joinSession(sessionId, nickname, preferredLanguage);
});

// Audio toggle
elements.toggleAudioBtn.addEventListener('click', () => {
    appState.isAudioEnabled = openviduClient.toggleAudio();
    elements.toggleAudioBtn.classList.toggle('muted', !appState.isAudioEnabled);
    elements.toggleAudioBtn.innerHTML = appState.isAudioEnabled 
        ? '<i data-lucide="mic"></i>' 
        : '<i data-lucide="mic-off"></i>';
    lucide.createIcons();
});

// Video toggle
elements.toggleVideoBtn.addEventListener('click', () => {
    appState.isVideoEnabled = openviduClient.toggleVideo();
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
    if (confirm('Are you sure you want to leave the call?')) {
        leaveSession();
    }
});

// Screen share toggle
elements.toggleScreenShareBtn.addEventListener('click', async () => {
    await toggleScreenShare();
});

// AI Interpreter toggle
elements.toggleInterpreterBtn.addEventListener('click', async () => {
    await toggleInterpreter();
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
elements.createMeetingBtn.addEventListener('click', createNewMeeting);
elements.shareMeetingBtn.addEventListener('click', copyMeetingLink);

// Transcription toggle
elements.toggleTranscriptionBtn.addEventListener('click', async () => {
    await toggleTranscription();
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

// Clean up on page unload
window.addEventListener('beforeunload', () => {
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
initializePage();

// Initialize preview
initPreview();

logEvent('info', 'Application initialized');
logEvent('info', `Backend URL: ${CONFIG.BACKEND_URL}`);
