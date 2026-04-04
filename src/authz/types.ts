import type { Permission } from './permissions';
import type { Role } from './roles';

export type PermissionGrantSet = {
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  screenShareEnabled?: boolean;
  groupChatEnabled?: boolean;
  hostDirectMessageEnabled?: boolean;
  whiteboardEnabled?: boolean;
};

export type SessionFeatureFlags = {
  chatEnabled?: boolean;
  groupChatEnabled?: boolean;
  whiteboardEnabled?: boolean;
  subtitlesEnabled?: boolean;
  aiInterpretationEnabled?: boolean;
};

export type AuthorizationContext = {
  role: Role;
  session?: SessionFeatureFlags;
  grants?: PermissionGrantSet;
};

export type AuthorizationResult = {
  allowed: boolean;
  reason: string;
};

export type RolePermissionMap = Record<Role, readonly Permission[]>;
