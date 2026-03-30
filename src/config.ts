process.loadEnvFile();

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  logLevel: env.LOG_LEVEL || 'info',
  openvidu: {
    url: env.OPENVIDU_URL,
    secret: env.OPENVIDU_SECRET,
  },
  openai: {
    apiKey: env.OPENAI_API_KEY,
    realtimeUrl:
      'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
  },
  azure: {
    speechKey: env.AZURE_SPEECH_KEY,
    speechRegion: env.AZURE_SPEECH_REGION || 'eastus',
    translatorKey: env.AZURE_TRANSLATOR_KEY || env.AZURE_SPEECH_KEY,
    translatorRegion: env.AZURE_TRANSLATOR_REGION || 'eastus',
  },
};

export function validateServerConfig() {
  if (!config.openvidu.url || !config.openvidu.secret) {
    process.stderr.write('ERROR: Missing required environment variables.\n');
    process.stderr.write('Please ensure OPENVIDU_URL and OPENVIDU_SECRET are set in your .env file.\n');
    process.exit(1);
  }
}
