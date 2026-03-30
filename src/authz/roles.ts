export const Role = {
  HOST: 'host',
  CO_HOST: 'co-host',
  PARTICIPANT: 'participant',
} as const;
export type Role = typeof Role[keyof typeof Role];