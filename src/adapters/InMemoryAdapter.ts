import { v4 as uuidv4 } from "uuid";
import { BaseAdapter } from "./BaseAdapter";
import type {
  MemoryFact,
  ConversationExchange,
  Session,
  FactFilter,
} from "../types";

interface UserData {
  facts: Map<string, MemoryFact>;
  conversations: ConversationExchange[];
  sessions: Map<string, Session>;
}

/**
 * In-memory storage adapter for development and testing.
 * Data is lost when the process exits.
 */
export class InMemoryAdapter extends BaseAdapter {
  private users: Map<string, UserData> = new Map();

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.users.clear();
    this.initialized = false;
  }

  private getUserData(userId: string): UserData {
    let userData = this.users.get(userId);
    if (!userData) {
      userData = {
        facts: new Map(),
        conversations: [],
        sessions: new Map(),
      };
      this.users.set(userId, userData);
    }
    return userData;
  }

  // =========================================================================
  // Fact Operations
  // =========================================================================

  async getFacts(userId: string, filter?: FactFilter): Promise<MemoryFact[]> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);
    let facts = Array.from(userData.facts.values());

    // Apply filters
    if (filter) {
      if (filter.subject) {
        facts = facts.filter((f) => f.subject === filter.subject);
      }
      if (filter.predicate) {
        facts = facts.filter((f) => f.predicate === filter.predicate);
      }
      if (filter.predicates && filter.predicates.length > 0) {
        facts = facts.filter((f) => filter.predicates!.includes(f.predicate));
      }
      if (filter.validOnly !== false) {
        facts = facts.filter((f) => f.invalidatedAt === null);
      }

      // Sort
      if (filter.orderBy) {
        facts.sort((a, b) => {
          const aVal = a[filter.orderBy!];
          const bVal = b[filter.orderBy!];
          if (aVal instanceof Date && bVal instanceof Date) {
            return filter.orderDir === "desc"
              ? bVal.getTime() - aVal.getTime()
              : aVal.getTime() - bVal.getTime();
          }
          if (typeof aVal === "number" && typeof bVal === "number") {
            return filter.orderDir === "desc" ? bVal - aVal : aVal - bVal;
          }
          return 0;
        });
      }

      // Limit
      if (filter.limit) {
        facts = facts.slice(0, filter.limit);
      }
    }

    return facts;
  }

  async getFactById(
    userId: string,
    factId: string
  ): Promise<MemoryFact | null> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);
    return userData.facts.get(factId) || null;
  }

  async upsertFact(
    userId: string,
    fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryFact> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);

    // Check for existing fact with same subject+predicate
    const existingFact = Array.from(userData.facts.values()).find(
      (f) =>
        f.subject === fact.subject &&
        f.predicate === fact.predicate &&
        f.invalidatedAt === null
    );

    const now = new Date();

    if (existingFact) {
      // Update existing
      const updated: MemoryFact = {
        ...existingFact,
        ...fact,
        updatedAt: now,
      };
      userData.facts.set(existingFact.id, updated);
      return updated;
    }

    // Create new
    const newFact: MemoryFact = {
      ...fact,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };
    userData.facts.set(newFact.id, newFact);
    return newFact;
  }

  async updateFact(
    userId: string,
    factId: string,
    updates: Partial<MemoryFact>
  ): Promise<MemoryFact> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);
    const fact = userData.facts.get(factId);

    if (!fact) {
      throw new Error(`Fact not found: ${factId}`);
    }

    const updated: MemoryFact = {
      ...fact,
      ...updates,
      id: fact.id, // Prevent ID change
      updatedAt: new Date(),
    };
    userData.facts.set(factId, updated);
    return updated;
  }

  async deleteFact(
    userId: string,
    factId: string,
    _reason?: string
  ): Promise<void> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);
    const fact = userData.facts.get(factId);

    if (fact) {
      fact.invalidatedAt = new Date();
      userData.facts.set(factId, fact);
    }
  }

  async hardDeleteFact(userId: string, factId: string): Promise<void> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);
    userData.facts.delete(factId);
  }

  // =========================================================================
  // Conversation Operations
  // =========================================================================

  async getConversationHistory(
    userId: string,
    limit?: number,
    sessionId?: string
  ): Promise<ConversationExchange[]> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);
    let conversations = [...userData.conversations];

    if (sessionId) {
      conversations = conversations.filter((c) => c.sessionId === sessionId);
    }

    // Sort by timestamp descending (most recent first)
    conversations.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (limit) {
      conversations = conversations.slice(0, limit);
    }

    return conversations;
  }

  async saveConversation(
    userId: string,
    exchange: Omit<ConversationExchange, "id">
  ): Promise<ConversationExchange> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);

    const newExchange: ConversationExchange = {
      ...exchange,
      id: uuidv4(),
    };

    userData.conversations.push(newExchange);

    // Update session message count
    const session = userData.sessions.get(exchange.sessionId);
    if (session) {
      session.messageCount++;
    }

    return newExchange;
  }

  // =========================================================================
  // Session Operations
  // =========================================================================

  async getSessions(userId: string, limit?: number): Promise<Session[]> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);
    let sessions = Array.from(userData.sessions.values());

    // Sort by startedAt descending
    sessions.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    if (limit) {
      sessions = sessions.slice(0, limit);
    }

    return sessions;
  }

  async getSession(userId: string, sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);
    return userData.sessions.get(sessionId) || null;
  }

  async createSession(userId: string): Promise<Session> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);

    const session: Session = {
      id: uuidv4(),
      userId,
      startedAt: new Date(),
      endedAt: null,
      messageCount: 0,
    };

    userData.sessions.set(session.id, session);
    return session;
  }

  async endSession(
    userId: string,
    sessionId: string,
    summary?: string
  ): Promise<Session> {
    await this.ensureInitialized();
    const userData = this.getUserData(userId);
    const session = userData.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.endedAt = new Date();
    if (summary) {
      session.summary = summary;
    }

    userData.sessions.set(sessionId, session);
    return session;
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Clear all data for a user (useful for testing)
   */
  async clearUser(userId: string): Promise<void> {
    this.users.delete(userId);
  }

  /**
   * Clear all data (useful for testing)
   */
  async clearAll(): Promise<void> {
    this.users.clear();
  }

  /**
   * Export all data for a user (for portability)
   */
  async exportUser(userId: string): Promise<{
    facts: MemoryFact[];
    conversations: ConversationExchange[];
    sessions: Session[];
  }> {
    const userData = this.getUserData(userId);
    return {
      facts: Array.from(userData.facts.values()),
      conversations: userData.conversations,
      sessions: Array.from(userData.sessions.values()),
    };
  }

  /**
   * Import data for a user
   */
  async importUser(
    userId: string,
    data: {
      facts: MemoryFact[];
      conversations: ConversationExchange[];
      sessions: Session[];
    }
  ): Promise<void> {
    const userData = this.getUserData(userId);

    for (const fact of data.facts) {
      userData.facts.set(fact.id, fact);
    }

    userData.conversations.push(...data.conversations);

    for (const session of data.sessions) {
      userData.sessions.set(session.id, session);
    }
  }
}
