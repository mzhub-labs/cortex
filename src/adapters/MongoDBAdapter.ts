import { BaseAdapter } from "./BaseAdapter";
import type {
  MemoryFact,
  ConversationExchange,
  Session,
  FactFilter,
} from "../types";

/**
 * Configuration for MongoDB adapter
 */
export interface MongoDBAdapterConfig {
  /** MongoDB connection URI */
  uri: string;
  /** Database name */
  database?: string;
  /** Collection prefix (default: 'memts_') */
  collectionPrefix?: string;
}

/**
 * MongoDB storage adapter for production deployments.
 * Requires: npm install mongodb
 *
 * Collections created:
 * - memts_facts: User facts (knowledge graph)
 * - memts_conversations: Conversation history
 * - memts_sessions: Session metadata
 */
export class MongoDBAdapter extends BaseAdapter {
  private config: MongoDBAdapterConfig;
  private client: unknown;
  private db: unknown;
  private collectionPrefix: string;

  constructor(config: MongoDBAdapterConfig) {
    super();
    this.config = config;
    this.collectionPrefix = config.collectionPrefix || "memts_";
  }

  private async getClient(): Promise<unknown> {
    if (this.client) return this.client;

    try {
      // @ts-ignore - mongodb is an optional peer dependency
      const { MongoClient } = await import("mongodb");
      this.client = new MongoClient(this.config.uri);
      await (this.client as { connect: () => Promise<void> }).connect();
      return this.client;
    } catch {
      throw new Error("MongoDB driver not installed. Run: npm install mongodb");
    }
  }

  private getCollection(name: string): unknown {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db as any).collection(`${this.collectionPrefix}${name}`);
  }

  async initialize(): Promise<void> {
    const client = await this.getClient();
    const dbName = this.config.database || "memts";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.db = (client as any).db(dbName);

    // Create indexes for efficient queries
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const facts = this.getCollection("facts") as any;
    await facts.createIndex({ userId: 1, subject: 1, predicate: 1 });
    await facts.createIndex({ userId: 1, invalidatedAt: 1 });
    await facts.createIndex({ userId: 1, updatedAt: -1 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversations = this.getCollection("conversations") as any;
    await conversations.createIndex({ userId: 1, sessionId: 1 });
    await conversations.createIndex({ userId: 1, timestamp: -1 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessions = this.getCollection("sessions") as any;
    await sessions.createIndex({ userId: 1, startedAt: -1 });

    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.client) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client as any).close();
      this.client = undefined;
      this.db = undefined;
    }
    this.initialized = false;
  }

  // =========================================================================
  // Fact Operations
  // =========================================================================

  async getFacts(userId: string, filter?: FactFilter): Promise<MemoryFact[]> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("facts") as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = { userId };

    if (filter?.subject) query.subject = filter.subject;
    if (filter?.predicate) query.predicate = filter.predicate;
    if (filter?.predicates?.length) {
      query.predicate = { $in: filter.predicates };
    }
    if (filter?.validOnly !== false) {
      query.invalidatedAt = null;
    }

    let cursor = collection.find(query);

    if (filter?.orderBy) {
      const dir = filter.orderDir === "asc" ? 1 : -1;
      cursor = cursor.sort({ [filter.orderBy]: dir });
    }

    if (filter?.limit) {
      cursor = cursor.limit(filter.limit);
    }

    const docs = await cursor.toArray();
    return docs.map(this.docToFact);
  }

  async getFactById(
    userId: string,
    factId: string
  ): Promise<MemoryFact | null> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("facts") as any;
    const doc = await collection.findOne({ userId, id: factId });
    return doc ? this.docToFact(doc) : null;
  }

  async upsertFact(
    userId: string,
    fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryFact> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("facts") as any;
    const { v4: uuidv4 } = await import("uuid");

    const now = new Date();

    // Try to find existing fact
    const existing = await collection.findOne({
      userId,
      subject: fact.subject,
      predicate: fact.predicate,
      invalidatedAt: null,
    });

    if (existing) {
      // Update existing
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            object: fact.object,
            confidence: fact.confidence,
            source: fact.source,
            updatedAt: now,
            metadata: fact.metadata,
          },
        }
      );
      return this.docToFact({
        ...existing,
        object: fact.object,
        updatedAt: now,
      });
    }

    // Create new
    const newFact = {
      id: uuidv4(),
      userId,
      ...fact,
      createdAt: now,
      updatedAt: now,
    };

    await collection.insertOne(newFact);
    return this.docToFact(newFact);
  }

  async updateFact(
    userId: string,
    factId: string,
    updates: Partial<MemoryFact>
  ): Promise<MemoryFact> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("facts") as any;

    const result = await collection.findOneAndUpdate(
      { userId, id: factId },
      {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      throw new Error(`Fact not found: ${factId}`);
    }

    return this.docToFact(result);
  }

  async deleteFact(
    userId: string,
    factId: string,
    _reason?: string
  ): Promise<void> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("facts") as any;

    await collection.updateOne(
      { userId, id: factId },
      { $set: { invalidatedAt: new Date() } }
    );
  }

  async hardDeleteFact(userId: string, factId: string): Promise<void> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("facts") as any;
    await collection.deleteOne({ userId, id: factId });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("conversations") as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = { userId };
    if (sessionId) query.sessionId = sessionId;

    let cursor = collection.find(query).sort({ timestamp: -1 });

    if (limit) {
      cursor = cursor.limit(limit);
    }

    const docs = await cursor.toArray();
    return docs.map(this.docToConversation);
  }

  async saveConversation(
    userId: string,
    exchange: Omit<ConversationExchange, "id">
  ): Promise<ConversationExchange> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("conversations") as any;
    const { v4: uuidv4 } = await import("uuid");

    const newExchange = {
      id: uuidv4(),
      ...exchange,
    };

    await collection.insertOne(newExchange);

    // Update session message count
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionsCollection = this.getCollection("sessions") as any;
    await sessionsCollection.updateOne(
      { userId, id: exchange.sessionId },
      { $inc: { messageCount: 1 } }
    );

    return this.docToConversation(newExchange);
  }

  // =========================================================================
  // Session Operations
  // =========================================================================

  async getSessions(userId: string, limit?: number): Promise<Session[]> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("sessions") as any;

    let cursor = collection.find({ userId }).sort({ startedAt: -1 });

    if (limit) {
      cursor = cursor.limit(limit);
    }

    const docs = await cursor.toArray();
    return docs.map(this.docToSession);
  }

  async getSession(userId: string, sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("sessions") as any;
    const doc = await collection.findOne({ userId, id: sessionId });
    return doc ? this.docToSession(doc) : null;
  }

  async createSession(userId: string): Promise<Session> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("sessions") as any;
    const { v4: uuidv4 } = await import("uuid");

    const session = {
      id: uuidv4(),
      userId,
      startedAt: new Date(),
      endedAt: null,
      messageCount: 0,
    };

    await collection.insertOne(session);
    return this.docToSession(session);
  }

  async endSession(
    userId: string,
    sessionId: string,
    summary?: string
  ): Promise<Session> {
    await this.ensureInitialized();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = this.getCollection("sessions") as any;

    const result = await collection.findOneAndUpdate(
      { userId, id: sessionId },
      {
        $set: {
          endedAt: new Date(),
          ...(summary && { summary }),
        },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return this.docToSession(result);
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private docToFact(doc: any): MemoryFact {
    return {
      id: doc.id,
      subject: doc.subject,
      predicate: doc.predicate,
      object: doc.object,
      confidence: doc.confidence,
      importance: doc.importance ?? 5,
      source: doc.source,
      sourceConversationId: doc.sourceConversationId,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
      invalidatedAt: doc.invalidatedAt ? new Date(doc.invalidatedAt) : null,
      accessCount: doc.accessCount ?? 0,
      lastAccessedAt: doc.lastAccessedAt
        ? new Date(doc.lastAccessedAt)
        : undefined,
      metadata: doc.metadata,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private docToConversation(doc: any): ConversationExchange {
    return {
      id: doc.id,
      userId: doc.userId,
      sessionId: doc.sessionId,
      userMessage: doc.userMessage,
      assistantResponse: doc.assistantResponse,
      timestamp: new Date(doc.timestamp),
      metadata: doc.metadata,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private docToSession(doc: any): Session {
    return {
      id: doc.id,
      userId: doc.userId,
      startedAt: new Date(doc.startedAt),
      endedAt: doc.endedAt ? new Date(doc.endedAt) : null,
      messageCount: doc.messageCount,
      summary: doc.summary,
    };
  }
}
