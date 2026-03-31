import { Session } from './Session';

export interface SessionRepository {
  findById(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
}
