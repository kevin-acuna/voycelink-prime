import type { PublisherProperties } from 'openvidu-browser';

// Compile-time guards for the screen-share publisher settings used in app.ts.
// This lets us validate OpenVidu-specific options without turning the legacy
// browser globals file into a full module yet.

export const screenShareWithAudioPublisherSettings = {
    videoSource: 'screen',
    audioSource: 'screen',
    publishAudio: true,
    publishVideo: true,
    mirror: false,
} satisfies PublisherProperties;

export const screenShareVideoOnlyPublisherSettings = {
    videoSource: 'screen',
    publishAudio: false,
    publishVideo: true,
    mirror: false,
} satisfies PublisherProperties;
