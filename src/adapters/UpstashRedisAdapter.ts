import { BaseAdapter } from "./BaseAdapter";
import type {
  MemoryFact,
  ConversationExchange,
  Session,
  FactFilter,
} from "../types";

/**
 * Configuration for Upstash Redis adapter
 */
export interface UpstashRedisAdapterConfig {
  /** Upstash Redis REST URL */
  url: string;
  /** Upstash Redis REST Token */
  token: string;
  /** Key prefix (default: 'memts:') */
  prefix?: string;
  /** TTL for hot cache entries in seconds (default: 3600) */
  cacheTtl?: number;
}

/**
 * Upstash Redis adapter for serverless hot cache layer.
 * Uses the Upstash REST API - no Redis connection needed.
 *
 * Key structure:
 * - memts:{userId}:facts - Hash of facts
 * - memts:{userId}:conversations - List of conversations
 * - memts:{userId}:sessions - Hash of sessions
 */
export class UpstashRedisAdapter extends BaseAdapter {
  private config: UpstashRedisAdapterConfig;
  private prefix: string;
  private defaultTtl: number;

  constructor(config: UpstashRedisAdapterConfig) {
    super();
    this.config = config;
    this.prefix = config.prefix || "memts:";
    this.defaultTtl = config.cacheTtl || 3600;
  }

  private async redis<T>(command: string[]): Promise<T> {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`Upstash Redis error: ${response.statusText}`);
    }

    const data = (await response.json()) as { result: T };
    return data.result;
  }

  private key(userId: string, type: string): string {
    return `${this.prefix}${userId}:${type}`;
  }

  async initialize(): Promise<void> {
    // Test connection
    await this.redis(["PING"]);
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  // =========================================================================
  // Fact Operations
  // =========================================================================

  async getFacts(userId: string, filter?: FactFilter): Promise<MemoryFact[]> {
    await this.ensureInitialized();

    const data = await this.redis<string[] | Record<string, string>>([
      "HGETALL",
      this.key(userId, "facts"),
    ]);

    if (!data) return [];

    // Upstash returns HGETALL as array [key1, val1, key2, val2, ...]
    // Convert to object if it's an array
    let dataObj: Record<string, string>;
    if (Array.isArray(data)) {
      dataObj = {};
      for (let i = 0; i < data.length; i += 2) {
        if (data[i + 1]) {
          dataObj[data[i]] = data[i + 1];
        }
      }
    } else if (typeof data === "object") {
      dataObj = data;
    } else {
      return [];
    }

    let facts: MemoryFact[] = Object.values(dataObj)
      .filter((v) => typeof v === "string")
      .map((v) => JSON.parse(v) as MemoryFact)
      .map((f) => ({
        ...f,
        createdAt: new Date(f.createdAt),
        updatedAt: new Date(f.updatedAt),
        invalidatedAt: f.invalidatedAt ? new Date(f.invalidatedAt) : null,
      }));

    // Apply filters
    if (filter) {
      if (filter.subject) {
        facts = facts.filter((f) => f.subject === filter.subject);
      }
      if (filter.predicate) {
        facts = facts.filter((f) => f.predicate === filter.predicate);
      }
      if (filter.predicates?.length) {
        facts = facts.filter((f) => filter.predicates!.includes(f.predicate));
      }
      if (filter.validOnly !== false) {
        facts = facts.filter((f) => f.invalidatedAt === null);
      }
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

    const data = await this.redis<string | null>([
      "HGET",
      this.key(userId, "facts"),
      factId,
    ]);

    if (!data) return null;

    const fact = JSON.parse(data) as MemoryFact;
    return {
      ...fact,
      createdAt: new Date(fact.createdAt),
      updatedAt: new Date(fact.updatedAt),
      invalidatedAt: fact.invalidatedAt ? new Date(fact.invalidatedAt) : null,
    };
  }

  async upsertFact(
    userId: string,
    fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryFact> {
    await this.ensureInitialized();
    const { v4: uuidv4 } = await import("uuid");

    // Check for existing fact
    const existingFacts = await this.getFacts(userId, {
      subject: fact.subject,
      predicate: fact.predicate,
      validOnly: true,
    });

    const now = new Date();

    if (existingFacts.length > 0) {
      // Update existing
      const existing = existingFacts[0];
      const updated: MemoryFact = {
        ...existing,
        ...fact,
        updatedAt: now,
      };
      await this.redis([
        "HSET",
        this.key(userId, "facts"),
        existing.id,
        JSON.stringify(updated),
      ]);
      return updated;
    }

    // Create new
    const newFact: MemoryFact = {
      ...fact,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };

    await this.redis([
      "HSET",
      this.key(userId, "facts"),
      newFact.id,
      JSON.stringify(newFact),
    ]);
    return newFact;
  }

  async updateFact(
    userId: string,
    factId: string,
    updates: Partial<MemoryFact>
  ): Promise<MemoryFact> {
    await this.ensureInitialized();

    const existing = await this.getFactById(userId, factId);
    if (!existing) {
      throw new Error(`Fact not found: ${factId}`);
    }

    const updated: MemoryFact = {
      ...existing,
      ...updates,
      id: existing.id,
      updatedAt: new Date(),
    };

    await this.redis([
      "HSET",
      this.key(userId, "facts"),
      factId,
      JSON.stringify(updated),
    ]);
    return updated;
  }

  async deleteFact(
    userId: string,
    factId: string,
    _reason?: string
  ): Promise<void> {
    await this.ensureInitialized();

    const existing = await this.getFactById(userId, factId);
    if (existing) {
      existing.invalidatedAt = new Date();
      await this.redis([
        "HSET",
        this.key(userId, "facts"),
        factId,
        JSON.stringify(existing),
      ]);
    }
  }

  async hardDeleteFact(userId: string, factId: string): Promise<void> {
    await this.ensureInitialized();
    await this.redis(["HDEL", this.key(userId, "facts"), factId]);
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

    const data = await this.redis<string[]>([
      "LRANGE",
      this.key(userId, "conversations"),
      "0",
      "-1",
    ]);

    if (!data || !Array.isArray(data)) return [];

    let conversations: ConversationExchange[] = data
      .map((v) => JSON.parse(v) as ConversationExchange)
      .map((c) => ({
        ...c,
        timestamp: new Date(c.timestamp),
      }));

    if (sessionId) {
      conversations = conversations.filter((c) => c.sessionId === sessionId);
    }

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
    const { v4: uuidv4 } = await import("uuid");

    const newExchange: ConversationExchange = {
      ...exchange,
      id: uuidv4(),
    };

    await this.redis([
      "LPUSH",
      this.key(userId, "conversations"),
      JSON.stringify(newExchange),
    ]);

    // Update session message count
    const session = await this.getSession(userId, exchange.sessionId);
    if (session) {
      session.messageCount++;
      await this.redis([
        "HSET",
        this.key(userId, "sessions"),
        session.id,
        JSON.stringify(session),
      ]);
    }

    return newExchange;
  }

  // =========================================================================
  // Session Operations
  // =========================================================================

  async getSessions(userId: string, limit?: number): Promise<Session[]> {
    await this.ensureInitialized();

    const data = await this.redis<string[] | Record<string, string>>([
      "HGETALL",
      this.key(userId, "sessions"),
    ]);

    if (!data) return [];

    // Upstash returns HGETALL as array [key1, val1, key2, val2, ...]
    let dataObj: Record<string, string>;
    if (Array.isArray(data)) {
      dataObj = {};
      for (let i = 0; i < data.length; i += 2) {
        if (data[i + 1]) {
          dataObj[data[i]] = data[i + 1];
        }
      }
    } else if (typeof data === "object") {
      dataObj = data;
    } else {
      return [];
    }

    let sessions: Session[] = Object.values(dataObj)
      .filter((v) => typeof v === "string")
      .map((v) => JSON.parse(v) as Session)
      .map((s) => ({
        ...s,
        startedAt: new Date(s.startedAt),
        endedAt: s.endedAt ? new Date(s.endedAt) : null,
      }));

    sessions.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    if (limit) {
      sessions = sessions.slice(0, limit);
    }

    return sessions;
  }

  async getSession(userId: string, sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();

    const data = await this.redis<string | null>([
      "HGET",
      this.key(userId, "sessions"),
      sessionId,
    ]);

    if (!data) return null;

    const session = JSON.parse(data) as Session;
    return {
      ...session,
      startedAt: new Date(session.startedAt),
      endedAt: session.endedAt ? new Date(session.endedAt) : null,
    };
  }

  async createSession(userId: string): Promise<Session> {
    await this.ensureInitialized();
    const { v4: uuidv4 } = await import("uuid");

    const session: Session = {
      id: uuidv4(),
      userId,
      startedAt: new Date(),
      endedAt: null,
      messageCount: 0,
    };

    await this.redis([
      "HSET",
      this.key(userId, "sessions"),
      session.id,
      JSON.stringify(session),
    ]);
    return session;
  }

  async endSession(
    userId: string,
    sessionId: string,
    summary?: string
  ): Promise<Session> {
    await this.ensureInitialized();

    const session = await this.getSession(userId, sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.endedAt = new Date();
    if (summary) {
      session.summary = summary;
    }

    await this.redis([
      "HSET",
      this.key(userId, "sessions"),
      sessionId,
      JSON.stringify(session),
    ]);
    return session;
  }

  // =========================================================================
  // Utility Methods for Hot Cache
  // =========================================================================

  /**
   * Set TTL on a user's data (useful for expiring cache)
   * If no TTL is provided, uses the configured default TTL.
   */
  async setUserTtl(userId: string, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtl;
    await this.redis(["EXPIRE", this.key(userId, "facts"), String(ttl)]);
    await this.redis([
      "EXPIRE",
      this.key(userId, "conversations"),
      String(ttl),
    ]);
    await this.redis(["EXPIRE", this.key(userId, "sessions"), String(ttl)]);
  }

  /**
   * Clear all data for a user
   */
  async clearUser(userId: string): Promise<void> {
    await this.redis(["DEL", this.key(userId, "facts")]);
    await this.redis(["DEL", this.key(userId, "conversations")]);
    await this.redis(["DEL", this.key(userId, "sessions")]);
  }
}
