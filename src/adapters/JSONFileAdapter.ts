import * as fs from "fs/promises";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { BaseAdapter } from "./BaseAdapter";
import type {
  MemoryFact,
  ConversationExchange,
  Session,
  FactFilter,
} from "../types";

interface JSONUserData {
  facts: MemoryFact[];
  conversations: ConversationExchange[];
  sessions: Session[];
}

export interface JSONFileAdapterConfig {
  /** Base path for storing JSON files (default: ./.cortex) */
  path?: string;
  /** Pretty print JSON files (default: true in dev, false in prod) */
  prettyPrint?: boolean;
}

/**
 * JSON file-based storage adapter for MVP/single-server deployments.
 * Stores each user's data in separate JSON files for portability.
 *
 * Directory structure:
 * .cortex/
 * ├── users/
 * │   ├── {userId}/
 * │   │   ├── facts.json
 * │   │   ├── conversations.json
 * │   │   └── sessions.json
 */
export class JSONFileAdapter extends BaseAdapter {
  private basePath: string;
  private prettyPrint: boolean;

  constructor(config: JSONFileAdapterConfig = {}) {
    super();
    this.basePath = config.path || "./.cortex";
    this.prettyPrint =
      config.prettyPrint ?? process.env.NODE_ENV !== "production";
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.join(this.basePath, "users"), { recursive: true });
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  // =========================================================================
  // File I/O Helpers
  // =========================================================================

  private getUserPath(userId: string): string {
    // Sanitize userId to prevent path traversal attacks
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.basePath, "users", safeUserId);
  }

  private async ensureUserDir(userId: string): Promise<void> {
    await fs.mkdir(this.getUserPath(userId), { recursive: true });
  }

  private async readFile<T>(
    userId: string,
    filename: string,
    defaultValue: T,
  ): Promise<T> {
    const filePath = path.join(this.getUserPath(userId), filename);
    try {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data, this.dateReviver);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return defaultValue;
      }
      throw error;
    }
  }

  private async writeFile<T>(
    userId: string,
    filename: string,
    data: T,
  ): Promise<void> {
    await this.ensureUserDir(userId);
    const filePath = path.join(this.getUserPath(userId), filename);
    const json = this.prettyPrint
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    await fs.writeFile(filePath, json, "utf-8");
  }

  // Date reviver for JSON.parse
  private dateReviver(_key: string, value: unknown): unknown {
    if (typeof value === "string") {
      // Check if it's an ISO date string
      const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      if (dateRegex.test(value)) {
        return new Date(value);
      }
    }
    return value;
  }

  // =========================================================================
  // Fact Operations
  // =========================================================================

  async getFacts(userId: string, filter?: FactFilter): Promise<MemoryFact[]> {
    await this.ensureInitialized();
    let facts = await this.readFile<MemoryFact[]>(userId, "facts.json", []);

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
    factId: string,
  ): Promise<MemoryFact | null> {
    await this.ensureInitialized();
    const facts = await this.readFile<MemoryFact[]>(userId, "facts.json", []);
    return facts.find((f) => f.id === factId) || null;
  }

  async upsertFact(
    userId: string,
    fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt">,
  ): Promise<MemoryFact> {
    await this.ensureInitialized();
    const facts = await this.readFile<MemoryFact[]>(userId, "facts.json", []);

    // Check for existing fact with same subject+predicate
    const existingIndex = facts.findIndex(
      (f) =>
        f.subject === fact.subject &&
        f.predicate === fact.predicate &&
        f.invalidatedAt === null,
    );

    const now = new Date();

    if (existingIndex >= 0) {
      // Update existing
      const updated: MemoryFact = {
        ...facts[existingIndex],
        ...fact,
        updatedAt: now,
      };
      facts[existingIndex] = updated;
      await this.writeFile(userId, "facts.json", facts);
      return updated;
    }

    // Create new
    const newFact: MemoryFact = {
      ...fact,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };
    facts.push(newFact);
    await this.writeFile(userId, "facts.json", facts);
    return newFact;
  }

  async updateFact(
    userId: string,
    factId: string,
    updates: Partial<MemoryFact>,
  ): Promise<MemoryFact> {
    await this.ensureInitialized();
    const facts = await this.readFile<MemoryFact[]>(userId, "facts.json", []);
    const index = facts.findIndex((f) => f.id === factId);

    if (index === -1) {
      throw new Error(`Fact not found: ${factId}`);
    }

    const updated: MemoryFact = {
      ...facts[index],
      ...updates,
      id: facts[index].id, // Prevent ID change
      updatedAt: new Date(),
    };
    facts[index] = updated;
    await this.writeFile(userId, "facts.json", facts);
    return updated;
  }

  async deleteFact(
    userId: string,
    factId: string,
    _reason?: string,
  ): Promise<void> {
    await this.ensureInitialized();
    const facts = await this.readFile<MemoryFact[]>(userId, "facts.json", []);
    const index = facts.findIndex((f) => f.id === factId);

    if (index >= 0) {
      facts[index].invalidatedAt = new Date();
      await this.writeFile(userId, "facts.json", facts);
    }
  }

  async hardDeleteFact(userId: string, factId: string): Promise<void> {
    await this.ensureInitialized();
    const facts = await this.readFile<MemoryFact[]>(userId, "facts.json", []);
    const filtered = facts.filter((f) => f.id !== factId);
    await this.writeFile(userId, "facts.json", filtered);
  }

  // =========================================================================
  // Conversation Operations
  // =========================================================================

  async getConversationHistory(
    userId: string,
    limit?: number,
    sessionId?: string,
  ): Promise<ConversationExchange[]> {
    await this.ensureInitialized();
    let conversations = await this.readFile<ConversationExchange[]>(
      userId,
      "conversations.json",
      [],
    );

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
    exchange: Omit<ConversationExchange, "id">,
  ): Promise<ConversationExchange> {
    await this.ensureInitialized();
    const conversations = await this.readFile<ConversationExchange[]>(
      userId,
      "conversations.json",
      [],
    );

    const newExchange: ConversationExchange = {
      ...exchange,
      id: uuidv4(),
    };

    conversations.push(newExchange);
    await this.writeFile(userId, "conversations.json", conversations);

    // Update session message count
    const sessions = await this.readFile<Session[]>(
      userId,
      "sessions.json",
      [],
    );
    const sessionIndex = sessions.findIndex((s) => s.id === exchange.sessionId);
    if (sessionIndex >= 0) {
      sessions[sessionIndex].messageCount++;
      await this.writeFile(userId, "sessions.json", sessions);
    }

    return newExchange;
  }

  // =========================================================================
  // Session Operations
  // =========================================================================

  async getSessions(userId: string, limit?: number): Promise<Session[]> {
    await this.ensureInitialized();
    let sessions = await this.readFile<Session[]>(userId, "sessions.json", []);

    // Sort by startedAt descending
    sessions.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    if (limit) {
      sessions = sessions.slice(0, limit);
    }

    return sessions;
  }

  async getSession(userId: string, sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();
    const sessions = await this.readFile<Session[]>(
      userId,
      "sessions.json",
      [],
    );
    return sessions.find((s) => s.id === sessionId) || null;
  }

  async createSession(userId: string): Promise<Session> {
    await this.ensureInitialized();
    const sessions = await this.readFile<Session[]>(
      userId,
      "sessions.json",
      [],
    );

    const session: Session = {
      id: uuidv4(),
      userId,
      startedAt: new Date(),
      endedAt: null,
      messageCount: 0,
    };

    sessions.push(session);
    await this.writeFile(userId, "sessions.json", sessions);
    return session;
  }

  async endSession(
    userId: string,
    sessionId: string,
    summary?: string,
  ): Promise<Session> {
    await this.ensureInitialized();
    const sessions = await this.readFile<Session[]>(
      userId,
      "sessions.json",
      [],
    );
    const index = sessions.findIndex((s) => s.id === sessionId);

    if (index === -1) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    sessions[index].endedAt = new Date();
    if (summary) {
      sessions[index].summary = summary;
    }

    await this.writeFile(userId, "sessions.json", sessions);
    return sessions[index];
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Export all data for a user (for portability)
   */
  async exportUser(userId: string): Promise<JSONUserData> {
    return {
      facts: await this.readFile<MemoryFact[]>(userId, "facts.json", []),
      conversations: await this.readFile<ConversationExchange[]>(
        userId,
        "conversations.json",
        [],
      ),
      sessions: await this.readFile<Session[]>(userId, "sessions.json", []),
    };
  }

  /**
   * Import data for a user
   */
  async importUser(userId: string, data: JSONUserData): Promise<void> {
    await this.writeFile(userId, "facts.json", data.facts);
    await this.writeFile(userId, "conversations.json", data.conversations);
    await this.writeFile(userId, "sessions.json", data.sessions);
  }

  /**
   * Delete all data for a user
   */
  async deleteUser(userId: string): Promise<void> {
    const userPath = this.getUserPath(userId);
    await fs.rm(userPath, { recursive: true, force: true });
  }
}
