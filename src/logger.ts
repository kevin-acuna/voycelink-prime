import pino from 'pino';
import { config } from './config';

const usePrettyLogs =
  process.env.LOG_PRETTY !== 'false' &&
  process.stdout.isTTY &&
  process.env.NODE_ENV !== 'production';

export const logger = pino(
  {
    level: config.logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  usePrettyLogs
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      })
    : undefined
);
