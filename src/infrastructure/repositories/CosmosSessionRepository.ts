import { cosmos } from '../cosmos-client';
import { Session, type SessionPrimitives } from '../../session/Session';
import type { SessionRepository } from '../../session/SessionRepository';

type CosmosSessionDocument = SessionPrimitives & {
  entityType: 'session';
};

export class CosmosSessionRepository implements SessionRepository {
  async findById(sessionId: string): Promise<Session | null> {
    try {
      const response = await cosmos.containers.rooms.item(sessionId, sessionId).read<CosmosSessionDocument>();

      if (!response.resource) {
        return null;
      }

      return Session.fromPrimitives(response.resource);
    } catch (error) {
      if (error?.code === 404) {
        return null;
      }

      throw error;
    }
  }

  async save(session: Session): Promise<void> {
    const document: CosmosSessionDocument = {
      ...session.toPrimitives(),
      entityType: 'session',
    };

    await cosmos.containers.rooms.items.upsert(document);
  }

  async delete(sessionId: string): Promise<void> {
    await cosmos.containers.rooms.item(sessionId, sessionId).delete();
  }
}
