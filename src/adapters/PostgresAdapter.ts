import { BaseAdapter } from "./BaseAdapter";
import type {
  MemoryFact,
  ConversationExchange,
  Session,
  FactFilter,
} from "../types";

/**
 * Configuration for PostgreSQL adapter
 */
export interface PostgresAdapterConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Schema name (default: 'memts') */
  schema?: string;
  /** Enable pgvector for semantic search (requires pgvector extension) */
  enableVector?: boolean;
}

/**
 * PostgreSQL storage adapter for production deployments.
 * Requires: npm install pg
 *
 * Tables created:
 * - memts.facts: User facts (knowledge graph)
 * - memts.conversations: Conversation history
 * - memts.sessions: Session metadata
 */
export class PostgresAdapter extends BaseAdapter {
  private config: PostgresAdapterConfig;
  private pool: unknown;
  private schema: string;

  constructor(config: PostgresAdapterConfig) {
    super();
    this.config = config;
    this.schema = config.schema || "memts";
  }

  private async getPool(): Promise<unknown> {
    if (this.pool) return this.pool;

    try {
      // @ts-ignore - pg is an optional peer dependency
      const { Pool } = await import("pg");
      this.pool = new Pool({
        connectionString: this.config.connectionString,
      });
      return this.pool;
    } catch {
      throw new Error("PostgreSQL driver not installed. Run: npm install pg");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async query(sql: string, params?: unknown[]): Promise<any> {
    const pool = await this.getPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (pool as any).query(sql, params);
  }

  async initialize(): Promise<void> {
    await this.getPool();

    // Create schema
    await this.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);

    // Create facts table
    await this.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.facts (
        id UUID PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        predicate VARCHAR(255) NOT NULL,
        object TEXT NOT NULL,
        confidence REAL DEFAULT 0.8,
        source VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        invalidated_at TIMESTAMPTZ,
        metadata JSONB
      )
    `);

    // Create indexes for facts
    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_facts_user_subject_predicate 
      ON ${this.schema}.facts (user_id, subject, predicate)
    `);
    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_facts_user_valid 
      ON ${this.schema}.facts (user_id, invalidated_at)
    `);

    // Create conversations table
    await this.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.conversations (
        id UUID PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        user_message TEXT NOT NULL,
        assistant_response TEXT NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        metadata JSONB
      )
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_user_session 
      ON ${this.schema}.conversations (user_id, session_id)
    `);

    // Create sessions table
    await this.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.sessions (
        id UUID PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        message_count INTEGER DEFAULT 0,
        summary TEXT
      )
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user 
      ON ${this.schema}.sessions (user_id, started_at DESC)
    `);

    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.pool) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.pool as any).end();
      this.pool = undefined;
    }
    this.initialized = false;
  }

  // =========================================================================
  // Fact Operations
  // =========================================================================

  async getFacts(userId: string, filter?: FactFilter): Promise<MemoryFact[]> {
    await this.ensureInitialized();

    let sql = `SELECT * FROM ${this.schema}.facts WHERE user_id = $1`;
    const params: unknown[] = [userId];
    let paramIndex = 2;

    if (filter?.subject) {
      sql += ` AND subject = $${paramIndex++}`;
      params.push(filter.subject);
    }

    if (filter?.predicate) {
      sql += ` AND predicate = $${paramIndex++}`;
      params.push(filter.predicate);
    }

    if (filter?.predicates?.length) {
      const placeholders = filter.predicates
        .map((_, i) => `$${paramIndex + i}`)
        .join(", ");
      sql += ` AND predicate IN (${placeholders})`;
      params.push(...filter.predicates);
      paramIndex += filter.predicates.length;
    }

    if (filter?.validOnly !== false) {
      sql += ` AND invalidated_at IS NULL`;
    }

    if (filter?.orderBy) {
      const column = this.camelToSnake(filter.orderBy);
      const dir = filter.orderDir === "asc" ? "ASC" : "DESC";
      sql += ` ORDER BY ${column} ${dir}`;
    }

    if (filter?.limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(filter.limit);
    }

    const result = await this.query(sql, params);
    return result.rows.map(this.rowToFact.bind(this));
  }

  async getFactById(
    userId: string,
    factId: string
  ): Promise<MemoryFact | null> {
    await this.ensureInitialized();
    const result = await this.query(
      `SELECT * FROM ${this.schema}.facts WHERE user_id = $1 AND id = $2`,
      [userId, factId]
    );
    return result.rows[0] ? this.rowToFact(result.rows[0]) : null;
  }

  async upsertFact(
    userId: string,
    fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryFact> {
    await this.ensureInitialized();
    const { v4: uuidv4 } = await import("uuid");

    // Check for existing
    const existing = await this.query(
      `SELECT id FROM ${this.schema}.facts 
       WHERE user_id = $1 AND subject = $2 AND predicate = $3 AND invalidated_at IS NULL`,
      [userId, fact.subject, fact.predicate]
    );

    if (existing.rows[0]) {
      // Update existing
      const result = await this.query(
        `UPDATE ${this.schema}.facts 
         SET object = $1, confidence = $2, source = $3, updated_at = NOW(), metadata = $4
         WHERE id = $5 RETURNING *`,
        [
          fact.object,
          fact.confidence,
          fact.source,
          fact.metadata || null,
          existing.rows[0].id,
        ]
      );
      return this.rowToFact(result.rows[0]);
    }

    // Insert new
    const id = uuidv4();
    const result = await this.query(
      `INSERT INTO ${this.schema}.facts 
       (id, user_id, subject, predicate, object, confidence, source, invalidated_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        id,
        userId,
        fact.subject,
        fact.predicate,
        fact.object,
        fact.confidence,
        fact.source,
        null,
        fact.metadata || null,
      ]
    );
    return this.rowToFact(result.rows[0]);
  }

  async updateFact(
    userId: string,
    factId: string,
    updates: Partial<MemoryFact>
  ): Promise<MemoryFact> {
    await this.ensureInitialized();

    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.object !== undefined) {
      setClauses.push(`object = $${paramIndex++}`);
      params.push(updates.object);
    }
    if (updates.confidence !== undefined) {
      setClauses.push(`confidence = $${paramIndex++}`);
      params.push(updates.confidence);
    }
    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      params.push(updates.metadata);
    }

    params.push(userId, factId);

    const result = await this.query(
      `UPDATE ${this.schema}.facts SET ${setClauses.join(", ")} 
       WHERE user_id = $${paramIndex++} AND id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows[0]) {
      throw new Error(`Fact not found: ${factId}`);
    }

    return this.rowToFact(result.rows[0]);
  }

  async deleteFact(
    userId: string,
    factId: string,
    _reason?: string
  ): Promise<void> {
    await this.ensureInitialized();
    await this.query(
      `UPDATE ${this.schema}.facts SET invalidated_at = NOW() WHERE user_id = $1 AND id = $2`,
      [userId, factId]
    );
  }

  async hardDeleteFact(userId: string, factId: string): Promise<void> {
    await this.ensureInitialized();
    await this.query(
      `DELETE FROM ${this.schema}.facts WHERE user_id = $1 AND id = $2`,
      [userId, factId]
    );
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

    let sql = `SELECT * FROM ${this.schema}.conversations WHERE user_id = $1`;
    const params: unknown[] = [userId];

    if (sessionId) {
      sql += ` AND session_id = $2`;
      params.push(sessionId);
    }

    sql += ` ORDER BY timestamp DESC`;

    if (limit) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    const result = await this.query(sql, params);
    return result.rows.map(this.rowToConversation.bind(this));
  }

  async saveConversation(
    userId: string,
    exchange: Omit<ConversationExchange, "id">
  ): Promise<ConversationExchange> {
    await this.ensureInitialized();
    const { v4: uuidv4 } = await import("uuid");

    const id = uuidv4();
    const result = await this.query(
      `INSERT INTO ${this.schema}.conversations 
       (id, user_id, session_id, user_message, assistant_response, timestamp, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        id,
        userId,
        exchange.sessionId,
        exchange.userMessage,
        exchange.assistantResponse,
        exchange.timestamp,
        exchange.metadata || null,
      ]
    );

    // Update session message count
    await this.query(
      `UPDATE ${this.schema}.sessions SET message_count = message_count + 1 WHERE id = $1`,
      [exchange.sessionId]
    );

    return this.rowToConversation(result.rows[0]);
  }

  // =========================================================================
  // Session Operations
  // =========================================================================

  async getSessions(userId: string, limit?: number): Promise<Session[]> {
    await this.ensureInitialized();

    let sql = `SELECT * FROM ${this.schema}.sessions WHERE user_id = $1 ORDER BY started_at DESC`;
    const params: unknown[] = [userId];

    if (limit) {
      sql += ` LIMIT $2`;
      params.push(limit);
    }

    const result = await this.query(sql, params);
    return result.rows.map(this.rowToSession.bind(this));
  }

  async getSession(userId: string, sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();
    const result = await this.query(
      `SELECT * FROM ${this.schema}.sessions WHERE user_id = $1 AND id = $2`,
      [userId, sessionId]
    );
    return result.rows[0] ? this.rowToSession(result.rows[0]) : null;
  }

  async createSession(userId: string): Promise<Session> {
    await this.ensureInitialized();
    const { v4: uuidv4 } = await import("uuid");

    const id = uuidv4();
    const result = await this.query(
      `INSERT INTO ${this.schema}.sessions (id, user_id) VALUES ($1, $2) RETURNING *`,
      [id, userId]
    );
    return this.rowToSession(result.rows[0]);
  }

  async endSession(
    userId: string,
    sessionId: string,
    summary?: string
  ): Promise<Session> {
    await this.ensureInitialized();

    const result = await this.query(
      `UPDATE ${this.schema}.sessions 
       SET ended_at = NOW(), summary = COALESCE($1, summary)
       WHERE user_id = $2 AND id = $3 RETURNING *`,
      [summary || null, userId, sessionId]
    );

    if (!result.rows[0]) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return this.rowToSession(result.rows[0]);
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rowToFact(row: any): MemoryFact {
    return {
      id: row.id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      confidence: row.confidence,
      importance: row.importance ?? 5,
      source: row.source,
      sourceConversationId: row.source_conversation_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at) : null,
      accessCount: row.access_count ?? 0,
      lastAccessedAt: row.last_accessed_at
        ? new Date(row.last_accessed_at)
        : undefined,
      metadata: row.metadata,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rowToConversation(row: any): ConversationExchange {
    return {
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      userMessage: row.user_message,
      assistantResponse: row.assistant_response,
      timestamp: new Date(row.timestamp),
      metadata: row.metadata,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rowToSession(row: any): Session {
    return {
      id: row.id,
      userId: row.user_id,
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : null,
      messageCount: row.message_count,
      summary: row.summary,
    };
  }
}
