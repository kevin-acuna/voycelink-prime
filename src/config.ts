import fs from 'fs';

if (fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  logLevel: env.LOG_LEVEL || 'info',
  auth: {
    jwtSecret: env.AUTH_JWT_SECRET || env.LIVEKIT_API_SECRET,
    tokenTtl: '15m',
  },
  livekit: {
    url: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
  },
  voiceAi: {
    apiKey: env.AZURE_VOICEAI_API_KEY,
    realtimeUrl: env.AZURE_VOICEAI_REALTIME_URL ||
      'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
    voiceSpeed: Number(env.VOICE_SPEED || '1.0'),
  },
  azure: {
    speechKey: env.AZURE_SPEECH_KEY,
    speechRegion: env.AZURE_SPEECH_REGION || 'eastus',
    translatorKey: env.AZURE_TRANSLATOR_KEY || env.AZURE_SPEECH_KEY,
    translatorRegion: env.AZURE_TRANSLATOR_REGION || 'eastus',
  },
  cosmos: {
    connectionString: env.COSMOS_DB_CONNECTION_STRING,
    databaseName: env.COSMOS_DB_DATABASE_NAME || 'voycelink',
    roomsContainerName: env.COSMOS_DB_ROOMS_CONTAINER || 'rooms',
    participantPermissionsContainerName:
      env.COSMOS_DB_PARTICIPANT_PERMISSIONS_CONTAINER || 'participant-permissions',
  },
};

export function validateServerConfig() {
  if (
    !config.livekit.url ||
    !config.livekit.apiKey ||
    !config.livekit.apiSecret ||
    !config.auth.jwtSecret ||
    !config.cosmos.connectionString
  ) {
    process.stderr.write('ERROR: Missing required environment variables.\n');
    process.stderr.write(
      'Please ensure LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, COSMOS_DB_CONNECTION_STRING are set in the environment or local .env file.\n'
    );
    process.exit(1);
  }
}
