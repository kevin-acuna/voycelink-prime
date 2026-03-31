import type { PermissionGrantSet, Role, SessionFeatureFlags } from '../authz';

export class ParticipantId {
  constructor(private readonly id: string) {
    if (!id) {
      throw new Error('ParticipantId cannot be empty');
    }
  }

  get value() {
    return this.id;
  }
}

export type SessionPrimitives = {
  id: string;
  roomId: string;
  featureFlags: SessionFeatureFlags;
  participantIds: string[];
  participantRoles: Record<string, Role>;
  participantPermissions: Record<string, PermissionGrantSet>;
};

export class Session {
  constructor(
    private readonly sessionId: string,
    private featureFlags: SessionFeatureFlags = {},
    private participantIds: Set<string> = new Set(),
    private participantRoles: Map<string, Role> = new Map(),
    private participantPermissions: Map<string, PermissionGrantSet> = new Map()
  ) {
    if (!sessionId) {
      throw new Error('Session id cannot be empty');
    }
  }

  static create(sessionId: string, featureFlags: SessionFeatureFlags = {}) {
    return new Session(sessionId, featureFlags);
  }

  static fromPrimitives(primitives: SessionPrimitives) {
    return new Session(
      primitives.id,
      primitives.featureFlags || {},
      new Set(primitives.participantIds),
      new Map(Object.entries(primitives.participantRoles || {})),
      new Map(Object.entries(primitives.participantPermissions || {}))
    );
  }

  getSessionId() {
    return this.sessionId;
  }

  getFeatureFlags() {
    return {
      chatEnabled: true,
      whiteboardEnabled: true,
      subtitlesEnabled: true,
      aiInterpretationEnabled: false,
      ...this.featureFlags,
    };
  }

  updateFeatureFlags(featureFlags: SessionFeatureFlags) {
    this.featureFlags = {
      ...this.getFeatureFlags(),
      ...featureFlags,
    };
  }

  getParticipantIds() {
    return Array.from(this.participantIds);
  }

  addParticipant(participantId: ParticipantId) {
    this.participantIds.add(participantId.value);
  }

  setParticipantRole(participantId: ParticipantId, role: Role) {
    this.participantRoles.set(participantId.value, role);
  }

  getParticipantRole(participantId: ParticipantId): Role | null {
    return this.participantRoles.get(participantId.value) || null;
  }

  getParticipantRoles(): Record<string, Role> {
    return Object.fromEntries(this.participantRoles.entries());
  }

  removeParticipant(participantId: ParticipantId) {
    this.participantIds.delete(participantId.value);
    this.participantRoles.delete(participantId.value);
    this.participantPermissions.delete(participantId.value);
  }

  setParticipantPermissions(participantId: ParticipantId, permissions: PermissionGrantSet) {
    this.participantPermissions.set(participantId.value, {
      ...permissions,
    });
  }

  updateParticipantPermissions(participantId: ParticipantId, permissions: PermissionGrantSet) {
    const currentPermissions = this.participantPermissions.get(participantId.value) || {};
    this.participantPermissions.set(participantId.value, {
      ...currentPermissions,
      ...permissions,
    });
  }

  getParticipantPermissions(participantId: ParticipantId): PermissionGrantSet {
    return this.participantPermissions.get(participantId.value) || {};
  }

  toPrimitives(): SessionPrimitives {
    return {
      id: this.sessionId,
      roomId: this.sessionId,
      featureFlags: this.getFeatureFlags(),
      participantIds: this.getParticipantIds(),
      participantRoles: this.getParticipantRoles(),
      participantPermissions: Object.fromEntries(this.participantPermissions.entries()),
    };
  }
}
