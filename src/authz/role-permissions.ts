import { Permission } from './permissions';
import { Role } from './roles';
import type { RolePermissionMap } from './types';

export const ROLE_PERMISSIONS: RolePermissionMap = {
  [Role.GUEST]: [
    Permission.JOIN_SESSION,
  ],
  [Role.HOST]: [
    Permission.CREATE_SESSION,
    Permission.JOIN_SESSION,
    Permission.END_SESSION,
    Permission.KICK_PARTICIPANT,
    Permission.MANAGE_PARTICIPANT_MEDIA,
    Permission.GRANT_AUDIO,
    Permission.GRANT_VIDEO,
    Permission.SHARE_SCREEN,
    Permission.PUBLISH_AUDIO,
    Permission.PUBLISH_VIDEO,
    Permission.MANAGE_CHAT,
    Permission.SEND_GROUP_CHAT_MESSAGE,
    Permission.SEND_HOST_DIRECT_MESSAGE,
    Permission.MANAGE_WHITEBOARD,
    Permission.USE_WHITEBOARD,
    Permission.UPDATE_ROOM_CONFIGURATION,
    Permission.ASSIGN_COHOST,
    Permission.REMOVE_COHOST,
  ],
  [Role.CO_HOST]: [
    Permission.JOIN_SESSION,
    Permission.END_SESSION,
    Permission.KICK_PARTICIPANT,
    Permission.MANAGE_PARTICIPANT_MEDIA,
    Permission.GRANT_AUDIO,
    Permission.GRANT_VIDEO,
    Permission.SHARE_SCREEN,
    Permission.PUBLISH_AUDIO,
    Permission.PUBLISH_VIDEO,
    Permission.MANAGE_CHAT,
    Permission.SEND_GROUP_CHAT_MESSAGE,
    Permission.SEND_HOST_DIRECT_MESSAGE,
    Permission.MANAGE_WHITEBOARD,
    Permission.USE_WHITEBOARD,
  ],
  [Role.PARTICIPANT]: [
    Permission.JOIN_SESSION,
    Permission.SEND_GROUP_CHAT_MESSAGE,
    Permission.SEND_HOST_DIRECT_MESSAGE,
  ],
};
