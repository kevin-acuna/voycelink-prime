import { Role } from '../authz';

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
  participantIds: string[];
  customPermissions: Record<string, Role[]>;
};

export class Session {
  constructor(
    private readonly sessionId: string,
    private participantIds: Set<string> = new Set(),
    private customPermissions: Map<string, Role[]> = new Map()
  ) {
    if (!sessionId) {
      throw new Error('Session id cannot be empty');
    }
  }

  static create(sessionId: string) {
    return new Session(sessionId);
  }

  static fromPrimitives(primitives: SessionPrimitives) {
    return new Session(
      primitives.id,
      new Set(primitives.participantIds),
      new Map(Object.entries(primitives.customPermissions))
    );
  }

  getSessionId() {
    return this.sessionId;
  }

  getParticipantIds() {
    return Array.from(this.participantIds);
  }

  addParticipant(participantId: ParticipantId) {
    this.participantIds.add(participantId.value);
  }

  removeParticipant(participantId: ParticipantId) {
    this.participantIds.delete(participantId.value);
    this.customPermissions.delete(participantId.value);
  }

  addPermission(participantId: ParticipantId, role: Role) {
    const currentRoles = this.customPermissions.get(participantId.value) || [];

    if (!currentRoles.includes(role)) {
      this.customPermissions.set(participantId.value, [...currentRoles, role]);
    }
  }

  removePermission(participantId: ParticipantId, role: Role) {
    const roles = this.customPermissions.get(participantId.value);
    if (!roles) {
      return;
    }

    const updatedRoles = roles.filter((currentRole) => currentRole !== role);
    if (updatedRoles.length > 0) {
      this.customPermissions.set(participantId.value, updatedRoles);
      return;
    }

    this.customPermissions.delete(participantId.value);
  }

  getPermissions(participantId: ParticipantId): Role[] {
    return this.customPermissions.get(participantId.value) || [];
  }

  toPrimitives(): SessionPrimitives {
    return {
      id: this.sessionId,
      roomId: this.sessionId,
      participantIds: this.getParticipantIds(),
      customPermissions: Object.fromEntries(this.customPermissions.entries()),
    };
  }
}
