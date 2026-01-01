import type {
  MemoryFact,
  ConversationExchange,
  Session,
  FactFilter,
} from "../types";

/**
 * Abstract base class for storage adapters.
 * All storage implementations must extend this class.
 */
export abstract class BaseAdapter {
  protected initialized = false;

  /**
   * Initialize the adapter (connect to database, create tables, etc.)
   */
  abstract initialize(): Promise<void>;

  /**
   * Close the adapter connection
   */
  abstract close(): Promise<void>;

  // =========================================================================
  // Fact Operations
  // =========================================================================

  /**
   * Get facts for a user with optional filters
   */
  abstract getFacts(userId: string, filter?: FactFilter): Promise<MemoryFact[]>;

  /**
   * Get a specific fact by ID
   */
  abstract getFactById(
    userId: string,
    factId: string
  ): Promise<MemoryFact | null>;

  /**
   * Insert or update a fact
   */
  abstract upsertFact(
    userId: string,
    fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryFact>;

  /**
   * Update an existing fact
   */
  abstract updateFact(
    userId: string,
    factId: string,
    updates: Partial<MemoryFact>
  ): Promise<MemoryFact>;

  /**
   * Delete a fact (soft delete - sets invalidatedAt)
   */
  abstract deleteFact(
    userId: string,
    factId: string,
    reason?: string
  ): Promise<void>;

  /**
   * Hard delete a fact (permanent)
   */
  abstract hardDeleteFact(userId: string, factId: string): Promise<void>;

  // =========================================================================
  // Conversation Operations
  // =========================================================================

  /**
   * Get conversation history for a user
   */
  abstract getConversationHistory(
    userId: string,
    limit?: number,
    sessionId?: string
  ): Promise<ConversationExchange[]>;

  /**
   * Save a conversation exchange
   */
  abstract saveConversation(
    userId: string,
    exchange: Omit<ConversationExchange, "id">
  ): Promise<ConversationExchange>;

  // =========================================================================
  // Session Operations
  // =========================================================================

  /**
   * Get all sessions for a user
   */
  abstract getSessions(userId: string, limit?: number): Promise<Session[]>;

  /**
   * Get a specific session
   */
  abstract getSession(
    userId: string,
    sessionId: string
  ): Promise<Session | null>;

  /**
   * Create a new session
   */
  abstract createSession(userId: string): Promise<Session>;

  /**
   * End a session
   */
  abstract endSession(
    userId: string,
    sessionId: string,
    summary?: string
  ): Promise<Session>;

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Check if adapter is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Ensure adapter is initialized before operations
   */
  protected async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
