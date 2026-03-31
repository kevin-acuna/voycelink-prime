export const Role = {
  HOST: 'host',
  CO_HOST: 'co_host',
  PARTICIPANT: 'participant',
} as const;

export type Role = typeof Role[keyof typeof Role];

export const ALL_ROLES = Object.values(Role);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ALL_ROLES.includes(value as Role);
}
