export const Permission = {
  CREATE_SESSION: 'create_session',
  JOIN_SESSION: 'join_session',
  END_SESSION: 'end_session',
  KICK_PARTICIPANT: 'kick_participant',
  MANAGE_PARTICIPANT_MEDIA: 'manage_participant_media',
  GRANT_AUDIO: 'grant_audio',
  GRANT_VIDEO: 'grant_video',
  PUBLISH_AUDIO: 'publish_audio',
  PUBLISH_VIDEO: 'publish_video',
  MANAGE_CHAT: 'manage_chat',
  SEND_GROUP_CHAT_MESSAGE: 'send_group_chat_message',
  SEND_HOST_DIRECT_MESSAGE: 'send_host_direct_message',
  MANAGE_WHITEBOARD: 'manage_whiteboard',
  USE_WHITEBOARD: 'use_whiteboard',
  UPDATE_ROOM_CONFIGURATION: 'update_room_configuration',
  ASSIGN_COHOST: 'assign_cohost',
  REMOVE_COHOST: 'remove_cohost',
} as const;

export type Permission = typeof Permission[keyof typeof Permission];

export const ALL_PERMISSIONS = Object.values(Permission);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && ALL_PERMISSIONS.includes(value as Permission);
}
