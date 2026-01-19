import { v4 as uuidv4 } from "uuid";
import type {
  MemoryFact,
  ProviderConfig,
  HydratedContext,
  HydrateOptions,
  MemoryOSOptions,
  ConversationExchange,
  Session,
  FactFilter,
  ExtractionResult,
} from "./types";
import { BaseAdapter } from "./adapters/BaseAdapter";
import { InMemoryAdapter } from "./adapters/InMemoryAdapter";
import { BaseProvider } from "./providers/BaseProvider";
import { createProvider } from "./providers";
import { ExtractorWorker } from "./extraction/ExtractorWorker";
import { ContextHydrator } from "./retrieval/ContextHydrator";

export interface MemoryOSConfig {
  /** LLM provider configuration or instance */
  llm: ProviderConfig | { instance: BaseProvider };
  /** Storage adapter instance */
  adapter?: BaseAdapter;
  /** Behavioral options */
  options?: MemoryOSOptions;
}

/**
 * MemoryOS - The main orchestrator for AI agent memory.
 *
 * Implements the "Two-Brain" architecture:
 * - Fast Brain: Synchronous context retrieval before LLM calls
 * - Slow Brain: Asynchronous fact extraction after responses
 *
 * @example
 * ```typescript
 * import { MemoryOS } from 'cortex';
 * import { JSONFileAdapter } from 'cortex/adapters';
 *
 * const memory = new MemoryOS({
 *   llm: { provider: 'openai', apiKey: 'sk-...', model: 'gpt-4o-mini' },
 *   adapter: new JSONFileAdapter({ path: './.cortex' })
 * });
 *
 * // Before LLM call - get context
 * const context = await memory.hydrate(userId, userMessage);
 *
 * // After LLM response - extract facts (non-blocking)
 * memory.digest(userId, userMessage, assistantResponse);
 * ```
 */
export class MemoryOS {
  private adapter: BaseAdapter;
  private provider: BaseProvider;
  private extractor: ExtractorWorker;
  private hydrator: ContextHydrator;
  private options: Required<MemoryOSOptions>;
  private initialized = false;

  // Session management
  private activeSessions: Map<string, string> = new Map(); // userId -> sessionId

  constructor(config: MemoryOSConfig) {
    // Initialize adapter
    this.adapter = config.adapter || new InMemoryAdapter();

    // Initialize provider
    if ("instance" in config.llm) {
      this.provider = config.llm.instance;
    } else {
      this.provider = createProvider(config.llm);
    }

    // Initialize options with defaults
    this.options = {
      autoSummarizeAfter: config.options?.autoSummarizeAfter ?? 20,
      conflictStrategy: config.options?.conflictStrategy ?? "latest",
      enableCache: config.options?.enableCache ?? true,
      cacheTtl: config.options?.cacheTtl ?? 300,
      debug: config.options?.debug ?? false,
    };

    // Initialize components
    this.extractor = new ExtractorWorker(this.provider, this.adapter, {
      conflictStrategy: this.options.conflictStrategy,
      debug: this.options.debug,
    });

    this.hydrator = new ContextHydrator(this.adapter, {
      formatStyle: "natural",
    });
  }

  /**
   * Initialize the memory system (connects to storage, etc.)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.adapter.initialize();
    this.initialized = true;
  }

  /**
   * Ensure the system is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // ===========================================================================
  // Fast Brain: Context Retrieval
  // ===========================================================================

  /**
   * Hydrate context for injection into an LLM prompt.
   *
   * This is the "Fast Brain" - runs synchronously before each LLM call
   * to provide relevant context from the user's memory.
   *
   * @param userId - Unique identifier for the user
   * @param message - The user's current message (used for relevance ranking)
   * @param options - Optional filtering and limiting options
   * @returns Compiled context ready for injection
   *
   * @example
   * ```typescript
   * const context = await memory.hydrate(userId, userMessage);
   *
   * const response = await openai.chat.completions.create({
   *   messages: [
   *     { role: 'system', content: `Context: ${context.compiledPrompt}` },
   *     { role: 'user', content: userMessage }
   *   ]
   * });
   * ```
   */
  async hydrate(
    userId: string,
    message: string,
    options?: HydrateOptions,
  ): Promise<HydratedContext> {
    await this.ensureInitialized();
    return this.hydrator.hydrate(userId, message, options);
  }

  // ===========================================================================
  // Slow Brain: Fact Extraction
  // ===========================================================================

  /**
   * Digest a conversation exchange to extract facts.
   *
   * This is the "Slow Brain" - runs asynchronously in the background
   * after a response is sent to the user. Does not block.
   *
   * @param userId - Unique identifier for the user
   * @param userMessage - What the user said
   * @param assistantResponse - What the assistant replied
   *
   * @example
   * ```typescript
   * // Fire and forget - doesn't block
   * memory.digest(userId, userMessage, response.content);
   *
   * // Return response to user immediately
   * res.json({ message: response.content });
   * ```
   */
  digest(userId: string, userMessage: string, assistantResponse: string): void {
    // Ensure initialized (async, but we don't wait)
    this.ensureInitialized().then(() => {
      // Get or create session
      const sessionId = this.getOrCreateSession(userId);

      // Save conversation to history
      this.adapter
        .saveConversation(userId, {
          userId,
          sessionId,
          userMessage,
          assistantResponse,
          timestamp: new Date(),
        })
        .catch((err) => {
          if (this.options.debug) {
            console.error("[MemoryOS] Failed to save conversation:", err);
          }
        });

      // Queue for fact extraction (non-blocking)
      this.extractor.enqueue(userId, sessionId, userMessage, assistantResponse);
    });
  }

  /**
   * Extract facts immediately (synchronous version of digest).
   * Useful for testing or when you need the extraction result.
   */
  async digestSync(
    userId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<ExtractionResult> {
    await this.ensureInitialized();
    const sessionId = await this.ensureSession(userId);

    // Save conversation
    await this.adapter.saveConversation(userId, {
      userId,
      sessionId,
      userMessage,
      assistantResponse,
      timestamp: new Date(),
    });

    // Extract facts synchronously
    return this.extractor.extractNow(
      userId,
      sessionId,
      userMessage,
      assistantResponse,
    );
  }

  // ===========================================================================
  // Direct Fact Management
  // ===========================================================================

  /**
   * Get all facts for a user
   */
  async getFacts(userId: string, filter?: FactFilter): Promise<MemoryFact[]> {
    await this.ensureInitialized();
    return this.adapter.getFacts(userId, filter);
  }

  /**
   * Add a fact directly (bypasses extraction)
   */
  async addFact(
    userId: string,
    subject: string,
    predicate: string,
    object: string,
    confidence = 1.0,
    importance = 5,
  ): Promise<MemoryFact> {
    await this.ensureInitialized();
    const sessionId = await this.ensureSession(userId);

    return this.adapter.upsertFact(userId, {
      subject,
      predicate: predicate.toUpperCase().replace(/\s+/g, "_"),
      object,
      confidence,
      importance,
      source: sessionId,
      invalidatedAt: null,
    });
  }

  /**
   * Delete a fact
   */
  async deleteFact(
    userId: string,
    factId: string,
    reason?: string,
  ): Promise<void> {
    await this.ensureInitialized();
    return this.adapter.deleteFact(userId, factId, reason);
  }

  /**
   * Clear all facts for a user (use with caution!)
   */
  async clearFacts(userId: string): Promise<void> {
    await this.ensureInitialized();
    const facts = await this.adapter.getFacts(userId, { validOnly: false });
    for (const fact of facts) {
      await this.adapter.hardDeleteFact(userId, fact.id);
    }
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Start a new session for a user
   */
  async startSession(userId: string): Promise<Session> {
    await this.ensureInitialized();

    // End any existing session
    const existingSessionId = this.activeSessions.get(userId);
    if (existingSessionId) {
      await this.endSession(userId);
    }

    // Create new session
    const session = await this.adapter.createSession(userId);
    this.activeSessions.set(userId, session.id);
    return session;
  }

  /**
   * End the current session for a user
   */
  async endSession(userId: string, summary?: string): Promise<Session | null> {
    await this.ensureInitialized();

    const sessionId = this.activeSessions.get(userId);
    if (!sessionId) return null;

    const session = await this.adapter.endSession(userId, sessionId, summary);
    this.activeSessions.delete(userId);
    return session;
  }

  /**
   * Get or create a session ID for a user
   */
  private getOrCreateSession(userId: string): string {
    let sessionId = this.activeSessions.get(userId);
    if (!sessionId) {
      sessionId = uuidv4();
      this.activeSessions.set(userId, sessionId);
      // Create session in background
      this.adapter.createSession(userId).catch(() => {});
    }
    return sessionId;
  }

  /**
   * Ensure a session exists (async version)
   */
  private async ensureSession(userId: string): Promise<string> {
    let sessionId = this.activeSessions.get(userId);
    if (!sessionId) {
      const session = await this.adapter.createSession(userId);
      sessionId = session.id;
      this.activeSessions.set(userId, sessionId);
    }
    return sessionId;
  }

  // ===========================================================================
  // Conversation History
  // ===========================================================================

  /**
   * Get conversation history for a user
   */
  async getHistory(
    userId: string,
    limit?: number,
    sessionId?: string,
  ): Promise<ConversationExchange[]> {
    await this.ensureInitialized();
    return this.adapter.getConversationHistory(userId, limit, sessionId);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Export all data for a user (for portability)
   */
  async exportUser(userId: string): Promise<{
    facts: MemoryFact[];
    conversations: ConversationExchange[];
    sessions: Session[];
  }> {
    await this.ensureInitialized();

    const facts = await this.adapter.getFacts(userId, { validOnly: false });
    const conversations = await this.adapter.getConversationHistory(userId);
    const sessions = await this.adapter.getSessions(userId);

    return { facts, conversations, sessions };
  }

  /**
   * Wait for all pending extractions to complete
   */
  async drain(): Promise<void> {
    await this.extractor.drain();
  }

  /**
   * Get the number of pending extraction tasks
   */
  getPendingExtractions(): number {
    return this.extractor.getQueueLength();
  }

  /**
   * Close the memory system (disconnects from storage)
   */
  async close(): Promise<void> {
    await this.drain();
    await this.adapter.close();
    this.initialized = false;
  }
}
