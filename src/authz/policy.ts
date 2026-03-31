import { Permission, type Permission as PermissionType } from './permissions';
import { ROLE_PERMISSIONS } from './role-permissions';
import { Role } from './roles';
import type {
  AuthorizationContext,
  AuthorizationResult,
} from './types';

function hasBasePermission(role: AuthorizationContext['role'], permission: PermissionType): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

function isChatPermission(permission: PermissionType): boolean {
  return (
    permission === Permission.SEND_GROUP_CHAT_MESSAGE ||
    permission === Permission.SEND_HOST_DIRECT_MESSAGE
  );
}

function isConferenceConfigurationPermission(permission: PermissionType): boolean {
  return permission === Permission.UPDATE_ROOM_CONFIGURATION;
}

export function getEffectivePermissions(context: AuthorizationContext): PermissionType[] {
  return Object.values(Permission).filter((permission) => canPerform(context, permission).allowed);
}

export function canPerform(
  context: AuthorizationContext,
  permission: PermissionType
): AuthorizationResult {
  const { role, session, grants } = context;

  if (!hasBasePermission(role, permission)) {
    return {
      allowed: false,
      reason: `${role} does not include ${permission} in its base role permissions`,
    };
  }

  if (permission === Permission.PUBLISH_AUDIO && role === Role.PARTICIPANT && !grants?.audioEnabled) {
    return {
      allowed: false,
      reason: 'participant audio must be enabled by the host or a co-host',
    };
  }

  if (permission === Permission.PUBLISH_VIDEO && role === Role.PARTICIPANT && !grants?.videoEnabled) {
    return {
      allowed: false,
      reason: 'participant video must be enabled by the host or a co-host',
    };
  }

  if (isChatPermission(permission)) {
    if (session?.chatEnabled === false) {
      return {
        allowed: false,
        reason: 'chat is currently disabled for the session',
      };
    }

    if (
      permission === Permission.SEND_GROUP_CHAT_MESSAGE &&
      role === Role.PARTICIPANT &&
      grants?.groupChatEnabled === false
    ) {
      return {
        allowed: false,
        reason: 'group chat is disabled for this participant',
      };
    }

    if (
      permission === Permission.SEND_HOST_DIRECT_MESSAGE &&
      role === Role.PARTICIPANT &&
      grants?.hostDirectMessageEnabled === false
    ) {
      return {
        allowed: false,
        reason: 'direct messages to the host are disabled for this participant',
      };
    }
  }

  if (permission === Permission.USE_WHITEBOARD) {
    if (session?.whiteboardEnabled === false) {
      return {
        allowed: false,
        reason: 'whiteboard is not currently enabled for the session',
      };
    }

    if (role === Role.PARTICIPANT && grants?.whiteboardEnabled === false) {
      return {
        allowed: false,
        reason: 'whiteboard access is disabled for this participant',
      };
    }
  }

  if (permission === Permission.ASSIGN_COHOST || permission === Permission.REMOVE_COHOST) {
    return role === Role.HOST
      ? { allowed: true, reason: 'host manages co-host role assignments' }
      : { allowed: false, reason: 'only the host can manage co-host roles' };
  }

  if (isConferenceConfigurationPermission(permission)) {
    return role === Role.HOST
      ? { allowed: true, reason: 'host can update room configuration' }
      : { allowed: false, reason: 'only the host can update room configuration' };
  }

  return {
    allowed: true,
    reason: `${role} can perform ${permission}`,
  };
}
