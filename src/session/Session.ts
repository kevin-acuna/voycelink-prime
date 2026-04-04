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

export const BreakoutRoomStatus = {
  DRAFT: 'draft',
  OPEN: 'open',
  CLOSED: 'closed',
} as const;

export type BreakoutRoomStatus = typeof BreakoutRoomStatus[keyof typeof BreakoutRoomStatus];

export type ParticipantProfile = {
  nickname: string;
  preferredLanguage: string;
};

export type ParticipantLocation =
  | {
      type: 'main';
      breakoutRoomId: null;
    }
  | {
      type: 'breakout';
      breakoutRoomId: string;
    };

export type BreakoutRoomPrimitives = {
  id: string;
  name: string;
  status: BreakoutRoomStatus;
  participantIds: string[];
  openviduSessionId: string | null;
  openedAt: string | null;
  closedAt: string | null;
};

export type WhiteboardRoomState = {
  isOpen: boolean;
  canvasState: string | null;
  updatedAt: string | null;
};

export type WhiteboardStatePrimitives = {
  main: WhiteboardRoomState;
  breakouts: Record<string, WhiteboardRoomState>;
};

export const WaitingRoomRequestStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export type WaitingRoomRequestStatus =
  typeof WaitingRoomRequestStatus[keyof typeof WaitingRoomRequestStatus];

export type WaitingRoomRequestPrimitives = {
  id: string;
  nickname: string;
  preferredLanguage: string;
  role: Role;
  status: WaitingRoomRequestStatus;
  requestedAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedByRole: Role | null;
};

export type SessionPrimitives = {
  id: string;
  roomId: string;
  revision: number;
  featureFlags: SessionFeatureFlags;
  participantIds: string[];
  participantMediaConnections: Record<string, string | null>;
  participantRoles: Record<string, Role>;
  participantPermissions: Record<string, PermissionGrantSet>;
  participantProfiles: Record<string, ParticipantProfile>;
  participantLocations: Record<string, ParticipantLocation>;
  participantPresence: Record<string, 'connected' | 'disconnected'>;
  breakoutRooms: BreakoutRoomPrimitives[];
  whiteboardState: WhiteboardStatePrimitives;
  waitingRoomRequests: WaitingRoomRequestPrimitives[];
};

type BreakoutRoomState = {
  id: string;
  name: string;
  status: BreakoutRoomStatus;
  participantIds: Set<string>;
  openviduSessionId: string | null;
  openedAt: string | null;
  closedAt: string | null;
};

type WaitingRoomRequestState = WaitingRoomRequestPrimitives;

function normalizeLocation(location?: ParticipantLocation | null): ParticipantLocation {
  if (!location || location.type !== 'breakout' || !location.breakoutRoomId) {
    return {
      type: 'main',
      breakoutRoomId: null,
    };
  }

  return {
    type: 'breakout',
    breakoutRoomId: location.breakoutRoomId,
  };
}

function createDefaultWhiteboardRoomState(): WhiteboardRoomState {
  return {
    isOpen: false,
    canvasState: null,
    updatedAt: null,
  };
}

function normalizeWhiteboardState(
  whiteboardState?: Partial<WhiteboardStatePrimitives> | null
): WhiteboardStatePrimitives {
  const breakoutStates = Object.fromEntries(
    Object.entries(whiteboardState?.breakouts || {}).map(([breakoutRoomId, roomState]) => [
      breakoutRoomId,
      {
        ...createDefaultWhiteboardRoomState(),
        ...(roomState || {}),
      },
    ])
  );

  return {
    main: {
      ...createDefaultWhiteboardRoomState(),
      ...(whiteboardState?.main || {}),
    },
    breakouts: breakoutStates,
  };
}

export class Session {
  constructor(
    private readonly sessionId: string,
    private revision: number = 0,
    private featureFlags: SessionFeatureFlags = {},
    private participantIds: Set<string> = new Set(),
    private participantMediaConnections: Map<string, string | null> = new Map(),
    private participantRoles: Map<string, Role> = new Map(),
    private participantPermissions: Map<string, PermissionGrantSet> = new Map(),
    private participantProfiles: Map<string, ParticipantProfile> = new Map(),
    private participantLocations: Map<string, ParticipantLocation> = new Map(),
    private participantPresence: Map<string, 'connected' | 'disconnected'> = new Map(),
    private breakoutRooms: Map<string, BreakoutRoomState> = new Map(),
    private whiteboardState: WhiteboardStatePrimitives = normalizeWhiteboardState(),
    private waitingRoomRequests: Map<string, WaitingRoomRequestState> = new Map()
  ) {
    if (!sessionId) {
      throw new Error('Session id cannot be empty');
    }
  }

  static create(sessionId: string, featureFlags: SessionFeatureFlags = {}) {
    return new Session(sessionId, 0, featureFlags);
  }

  static fromPrimitives(primitives: SessionPrimitives) {
    const breakoutRooms = new Map<string, BreakoutRoomState>(
      (primitives.breakoutRooms || []).map((room) => [
        room.id,
        {
          ...room,
          participantIds: new Set(room.participantIds || []),
        },
      ])
    );

    return new Session(
      primitives.id,
      typeof primitives.revision === 'number' ? primitives.revision : 0,
      primitives.featureFlags || {},
      new Set(primitives.participantIds || []),
      new Map(Object.entries(primitives.participantMediaConnections || {})),
      new Map(Object.entries(primitives.participantRoles || {})),
      new Map(Object.entries(primitives.participantPermissions || {})),
      new Map(Object.entries(primitives.participantProfiles || {})),
      new Map(
        Object.entries(primitives.participantLocations || {}).map(([participantId, location]) => [
          participantId,
          normalizeLocation(location),
        ])
      ),
      new Map(Object.entries(primitives.participantPresence || {})),
      breakoutRooms,
      normalizeWhiteboardState(primitives.whiteboardState),
      new Map(
        (primitives.waitingRoomRequests || []).map((request) => [
          request.id,
          {
            ...request,
          },
        ])
      )
    );
  }

  getSessionId() {
    return this.sessionId;
  }

  getRevision() {
    return this.revision;
  }

  touch() {
    this.revision += 1;
    return this.revision;
  }

  getFeatureFlags() {
    return {
      chatEnabled: true,
      groupChatEnabled: false,
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
    if (!this.participantMediaConnections.has(participantId.value)) {
      this.participantMediaConnections.set(participantId.value, null);
    }
    if (!this.participantLocations.has(participantId.value)) {
      this.participantLocations.set(participantId.value, {
        type: 'main',
        breakoutRoomId: null,
      });
    }
    this.participantPresence.set(participantId.value, 'connected');
  }

  hasParticipant(participantId: ParticipantId) {
    return this.participantIds.has(participantId.value);
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

  setParticipantMediaConnection(participantId: ParticipantId, mediaConnectionId: string | null) {
    this.ensureParticipantExists(participantId);
    this.participantMediaConnections.set(participantId.value, mediaConnectionId || null);
  }

  getParticipantMediaConnection(participantId: ParticipantId): string | null {
    return this.participantMediaConnections.get(participantId.value) || null;
  }

  getParticipantMediaConnections(): Record<string, string | null> {
    return Object.fromEntries(this.participantMediaConnections.entries());
  }

  findParticipantIdByMediaConnection(mediaConnectionId: string): string | null {
    if (!mediaConnectionId) {
      return null;
    }

    for (const [participantId, connectionId] of this.participantMediaConnections.entries()) {
      if (connectionId === mediaConnectionId) {
        return participantId;
      }
    }

    return null;
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

  getAllParticipantPermissions(): Record<string, PermissionGrantSet> {
    return Object.fromEntries(this.participantPermissions.entries());
  }

  setParticipantProfile(participantId: ParticipantId, profile: ParticipantProfile) {
    this.participantProfiles.set(participantId.value, {
      nickname: profile.nickname,
      preferredLanguage: profile.preferredLanguage || 'en',
    });
  }

  getParticipantProfile(participantId: ParticipantId): ParticipantProfile | null {
    return this.participantProfiles.get(participantId.value) || null;
  }

  getParticipantProfiles(): Record<string, ParticipantProfile> {
    return Object.fromEntries(this.participantProfiles.entries());
  }

  getParticipantLocation(participantId: ParticipantId): ParticipantLocation {
    return normalizeLocation(this.participantLocations.get(participantId.value));
  }

  getParticipantLocations(): Record<string, ParticipantLocation> {
    return Object.fromEntries(
      Array.from(this.participantLocations.entries()).map(([participantId, location]) => [
        participantId,
        normalizeLocation(location),
      ])
    );
  }

  getParticipantPresence(participantId: ParticipantId): 'connected' | 'disconnected' {
    return this.participantPresence.get(participantId.value) || 'connected';
  }

  getParticipantPresenceMap(): Record<string, 'connected' | 'disconnected'> {
    return Object.fromEntries(this.participantPresence.entries());
  }

  markParticipantConnected(participantId: ParticipantId) {
    this.ensureParticipantExists(participantId);
    this.participantPresence.set(participantId.value, 'connected');
  }

  connectParticipant(participantId: ParticipantId, mediaConnectionId: string | null) {
    this.ensureParticipantExists(participantId);
    this.participantPresence.set(participantId.value, 'connected');
    this.participantMediaConnections.set(participantId.value, mediaConnectionId || null);
  }

  markParticipantDisconnected(participantId: ParticipantId) {
    this.ensureParticipantExists(participantId);
    this.removeParticipantFromAllBreakouts(participantId.value);
    this.participantLocations.set(participantId.value, {
      type: 'main',
      breakoutRoomId: null,
    });
    this.participantPresence.set(participantId.value, 'disconnected');
    this.participantMediaConnections.set(participantId.value, null);
  }

  setParticipantLocation(participantId: ParticipantId, location: ParticipantLocation) {
    this.ensureParticipantExists(participantId);
    this.removeParticipantFromAllBreakouts(participantId.value);

    const normalizedLocation = normalizeLocation(location);
    this.participantLocations.set(participantId.value, normalizedLocation);

    if (normalizedLocation.type === 'breakout') {
      const breakoutRoom = this.breakoutRooms.get(normalizedLocation.breakoutRoomId);
      if (!breakoutRoom) {
        throw new Error(`Breakout room ${normalizedLocation.breakoutRoomId} does not exist`);
      }

      breakoutRoom.participantIds.add(participantId.value);
    }
  }

  createBreakoutRoom(id: string, name: string) {
    if (!id) {
      throw new Error('Breakout room id cannot be empty');
    }
    if (!name) {
      throw new Error('Breakout room name cannot be empty');
    }
    if (this.breakoutRooms.has(id)) {
      throw new Error(`Breakout room ${id} already exists`);
    }

    this.breakoutRooms.set(id, {
      id,
      name,
      status: BreakoutRoomStatus.DRAFT,
      participantIds: new Set(),
      openviduSessionId: null,
      openedAt: null,
      closedAt: null,
    });
    this.whiteboardState.breakouts[id] = createDefaultWhiteboardRoomState();
  }

  updateBreakoutRoom(id: string, updates: { name?: string }) {
    const breakoutRoom = this.getBreakoutRoomState(id);
    if (typeof updates.name === 'string' && updates.name.trim()) {
      breakoutRoom.name = updates.name.trim();
    }
  }

  openBreakoutRoom(id: string, openviduSessionId: string, openedAt: string) {
    const breakoutRoom = this.getBreakoutRoomState(id);
    breakoutRoom.status = BreakoutRoomStatus.OPEN;
    breakoutRoom.openviduSessionId = openviduSessionId;
    breakoutRoom.openedAt = openedAt;
    breakoutRoom.closedAt = null;
  }

  closeBreakoutRoom(id: string, closedAt: string) {
    const breakoutRoom = this.getBreakoutRoomState(id);
    breakoutRoom.status = BreakoutRoomStatus.CLOSED;
    breakoutRoom.closedAt = closedAt;

    for (const participantId of breakoutRoom.participantIds) {
      this.participantLocations.set(participantId, {
        type: 'main',
        breakoutRoomId: null,
      });
    }

    breakoutRoom.participantIds.clear();
    this.updateWhiteboardRoomState(
      { type: 'breakout', breakoutRoomId: id },
      { isOpen: false, updatedAt: closedAt }
    );
  }

  deleteBreakoutRoom(id: string) {
    const breakoutRoom = this.getBreakoutRoomState(id);

    for (const participantId of breakoutRoom.participantIds) {
      this.participantLocations.set(participantId, {
        type: 'main',
        breakoutRoomId: null,
      });
    }

    breakoutRoom.participantIds.clear();
    this.breakoutRooms.delete(id);
    delete this.whiteboardState.breakouts[id];
  }

  assignParticipantToBreakout(participantId: ParticipantId, breakoutRoomId: string) {
    this.setParticipantLocation(participantId, {
      type: 'breakout',
      breakoutRoomId,
    });
  }

  returnParticipantToMain(participantId: ParticipantId) {
    this.setParticipantLocation(participantId, {
      type: 'main',
      breakoutRoomId: null,
    });
  }

  replaceParticipant(
    previousParticipantId: ParticipantId,
    nextParticipantId: ParticipantId,
    profileOverride?: ParticipantProfile
  ) {
    if (!this.participantIds.has(previousParticipantId.value)) {
      throw new Error(`Participant ${previousParticipantId.value} is not registered in session ${this.sessionId}`);
    }

    const previousRole = this.getParticipantRole(previousParticipantId);
    const previousMediaConnection = this.getParticipantMediaConnection(previousParticipantId);
    const previousPermissions = this.getParticipantPermissions(previousParticipantId);
    const previousProfile = profileOverride || this.getParticipantProfile(previousParticipantId);
    const previousLocation = this.getParticipantLocation(previousParticipantId);

    this.removeParticipant(previousParticipantId);
    this.addParticipant(nextParticipantId);

    if (previousRole) {
      this.setParticipantRole(nextParticipantId, previousRole);
    }

    if (Object.keys(previousPermissions).length > 0) {
      this.setParticipantPermissions(nextParticipantId, previousPermissions);
    }

    if (previousProfile) {
      this.setParticipantProfile(nextParticipantId, previousProfile);
    }

    this.setParticipantLocation(nextParticipantId, previousLocation);
    this.participantPresence.set(nextParticipantId.value, 'connected');
    this.participantMediaConnections.set(nextParticipantId.value, previousMediaConnection);
  }

  removeParticipant(participantId: ParticipantId) {
    this.participantIds.delete(participantId.value);
    this.participantMediaConnections.delete(participantId.value);
    this.participantRoles.delete(participantId.value);
    this.participantPermissions.delete(participantId.value);
    this.participantProfiles.delete(participantId.value);
    this.participantLocations.delete(participantId.value);
    this.participantPresence.delete(participantId.value);
    this.removeParticipantFromAllBreakouts(participantId.value);
  }

  getBreakoutRoom(id: string): BreakoutRoomPrimitives | null {
    const breakoutRoom = this.breakoutRooms.get(id);
    if (!breakoutRoom) {
      return null;
    }

    return this.toBreakoutRoomPrimitives(breakoutRoom);
  }

  getBreakoutRooms(): BreakoutRoomPrimitives[] {
    return Array.from(this.breakoutRooms.values()).map((room) => this.toBreakoutRoomPrimitives(room));
  }

  getWhiteboardRoomState(location?: ParticipantLocation | null): WhiteboardRoomState {
    const normalizedLocation = normalizeLocation(location);
    if (normalizedLocation.type !== 'breakout' || !normalizedLocation.breakoutRoomId) {
      return {
        ...createDefaultWhiteboardRoomState(),
        ...this.whiteboardState.main,
      };
    }

    return {
      ...createDefaultWhiteboardRoomState(),
      ...(this.whiteboardState.breakouts[normalizedLocation.breakoutRoomId] || {}),
    };
  }

  getWhiteboardStateSnapshot(): WhiteboardStatePrimitives {
    return normalizeWhiteboardState(this.whiteboardState);
  }

  updateWhiteboardRoomState(
    location: ParticipantLocation,
    updates: Partial<WhiteboardRoomState>
  ) {
    const normalizedLocation = normalizeLocation(location);
    const nextRoomState = {
      ...this.getWhiteboardRoomState(normalizedLocation),
      ...updates,
    };

    if (normalizedLocation.type !== 'breakout' || !normalizedLocation.breakoutRoomId) {
      this.whiteboardState.main = nextRoomState;
      return;
    }

    this.whiteboardState.breakouts[normalizedLocation.breakoutRoomId] = nextRoomState;
  }

  upsertWaitingRoomRequest(request: Omit<WaitingRoomRequestPrimitives, 'updatedAt'> & { updatedAt?: string }) {
    if (!request.id) {
      throw new Error('Waiting room request id cannot be empty');
    }

    const existingRequest = this.waitingRoomRequests.get(request.id);
    const updatedAt = request.updatedAt || request.decidedAt || request.requestedAt;

    this.waitingRoomRequests.set(request.id, {
      ...existingRequest,
      ...request,
      updatedAt,
    });
  }

  getWaitingRoomRequest(requestId: string): WaitingRoomRequestPrimitives | null {
    return this.waitingRoomRequests.get(requestId) || null;
  }

  getWaitingRoomRequests(): WaitingRoomRequestPrimitives[] {
    return Array.from(this.waitingRoomRequests.values()).sort((a, b) =>
      (a.requestedAt || '').localeCompare(b.requestedAt || '')
    );
  }

  getPendingWaitingRoomRequests(): WaitingRoomRequestPrimitives[] {
    return this.getWaitingRoomRequests().filter(
      (request) => request.status === WaitingRoomRequestStatus.PENDING
    );
  }

  approveWaitingRoomRequest(requestId: string, decidedAt: string, decidedByRole: Role) {
    const request = this.getWaitingRoomRequestStateOrFail(requestId);
    request.status = WaitingRoomRequestStatus.APPROVED;
    request.updatedAt = decidedAt;
    request.decidedAt = decidedAt;
    request.decidedByRole = decidedByRole;
  }

  rejectWaitingRoomRequest(requestId: string, decidedAt: string, decidedByRole: Role) {
    const request = this.getWaitingRoomRequestStateOrFail(requestId);
    request.status = WaitingRoomRequestStatus.REJECTED;
    request.updatedAt = decidedAt;
    request.decidedAt = decidedAt;
    request.decidedByRole = decidedByRole;
  }

  removeWaitingRoomRequest(requestId: string) {
    this.waitingRoomRequests.delete(requestId);
  }

  toPrimitives(): SessionPrimitives {
    return {
      id: this.sessionId,
      roomId: this.sessionId,
      revision: this.revision,
      featureFlags: this.getFeatureFlags(),
      participantIds: this.getParticipantIds(),
      participantMediaConnections: this.getParticipantMediaConnections(),
      participantRoles: this.getParticipantRoles(),
      participantPermissions: Object.fromEntries(this.participantPermissions.entries()),
      participantProfiles: this.getParticipantProfiles(),
      participantLocations: this.getParticipantLocations(),
      participantPresence: this.getParticipantPresenceMap(),
      breakoutRooms: this.getBreakoutRooms(),
      whiteboardState: this.getWhiteboardStateSnapshot(),
      waitingRoomRequests: this.getWaitingRoomRequests(),
    };
  }

  private ensureParticipantExists(participantId: ParticipantId) {
    if (!this.participantIds.has(participantId.value)) {
      throw new Error(`Participant ${participantId.value} is not registered in session ${this.sessionId}`);
    }
  }

  private getBreakoutRoomState(id: string): BreakoutRoomState {
    const breakoutRoom = this.breakoutRooms.get(id);
    if (!breakoutRoom) {
      throw new Error(`Breakout room ${id} does not exist`);
    }

    return breakoutRoom;
  }

  private removeParticipantFromAllBreakouts(participantId: string) {
    for (const breakoutRoom of this.breakoutRooms.values()) {
      breakoutRoom.participantIds.delete(participantId);
    }
  }

  private toBreakoutRoomPrimitives(room: BreakoutRoomState): BreakoutRoomPrimitives {
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      participantIds: Array.from(room.participantIds),
      openviduSessionId: room.openviduSessionId,
      openedAt: room.openedAt,
      closedAt: room.closedAt,
    };
  }

  private getWaitingRoomRequestStateOrFail(requestId: string): WaitingRoomRequestState {
    const request = this.waitingRoomRequests.get(requestId);
    if (!request) {
      throw new Error(`Waiting room request ${requestId} does not exist`);
    }

    return request;
  }
}
