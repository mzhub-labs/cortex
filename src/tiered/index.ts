import { BaseAdapter } from "../adapters/BaseAdapter";
import type {
  MemoryFact,
  ConversationExchange,
  Session,
  FactFilter,
} from "../types";

export interface TieredAdapterConfig {
  /** Hot storage (fast, limited) - e.g., Redis, in-memory */
  hotAdapter: BaseAdapter;
  /** Cold storage (slow, unlimited) - e.g., Postgres, MongoDB */
  coldAdapter: BaseAdapter;
  /** Maximum facts to keep in hot storage per user */
  hotFactLimit?: number;
  /** Maximum conversations to keep in hot storage per user */
  hotConversationLimit?: number;
  /** Automatically promote frequently accessed facts to hot */
  autoPromote?: boolean;
  /** Automatically demote old facts to cold */
  autoDemote?: boolean;
}

/**
 * Tiered storage adapter that manages hot (fast) and cold (persistent) storage.
 *
 * Hot tier: Recent/frequently accessed data for fast retrieval
 * Cold tier: Long-term persistent storage
 *
 * Read path: Hot first, fall back to cold, promote on access
 * Write path: Write to both (hot for speed, cold for durability)
 */
export class TieredAdapter extends BaseAdapter {
  private hot: BaseAdapter;
  private cold: BaseAdapter;
  private config: Required<
    Omit<TieredAdapterConfig, "hotAdapter" | "coldAdapter">
  >;

  constructor(config: TieredAdapterConfig) {
    super();
    this.hot = config.hotAdapter;
    this.cold = config.coldAdapter;
    this.config = {
      hotFactLimit: config.hotFactLimit ?? 50,
      hotConversationLimit: config.hotConversationLimit ?? 20,
      autoPromote: config.autoPromote ?? true,
      autoDemote: config.autoDemote ?? true,
    };
  }

  async initialize(): Promise<void> {
    await Promise.all([this.hot.initialize(), this.cold.initialize()]);
    this.initialized = true;
  }

  async close(): Promise<void> {
    await Promise.all([this.hot.close(), this.cold.close()]);
    this.initialized = false;
  }

  // =========================================================================
  // Fact Operations - Read from hot, fall back to cold
  // =========================================================================

  async getFacts(userId: string, filter?: FactFilter): Promise<MemoryFact[]> {
    await this.ensureInitialized();

    // Try hot first
    let facts = await this.hot.getFacts(userId, filter);

    if (facts.length === 0) {
      // Fall back to cold
      facts = await this.cold.getFacts(userId, filter);

      // Promote to hot if configured
      if (this.config.autoPromote && facts.length > 0) {
        await this.promoteFactsToHot(
          userId,
          facts.slice(0, this.config.hotFactLimit)
        );
      }
    }

    return facts;
  }

  async getFactById(
    userId: string,
    factId: string
  ): Promise<MemoryFact | null> {
    await this.ensureInitialized();

    // Try hot first
    let fact = await this.hot.getFactById(userId, factId);

    if (!fact) {
      // Fall back to cold
      fact = await this.cold.getFactById(userId, factId);

      // Promote to hot
      if (fact && this.config.autoPromote) {
        await this.hot.upsertFact(userId, fact);
      }
    }

    return fact;
  }

  async upsertFact(
    userId: string,
    fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryFact> {
    await this.ensureInitialized();

    // Write to cold first (durability)
    const saved = await this.cold.upsertFact(userId, fact);

    // Also write to hot (speed)
    await this.hot.upsertFact(userId, saved);

    // Check if we need to demote old facts
    if (this.config.autoDemote) {
      await this.demoteOldFacts(userId);
    }

    return saved;
  }

  async updateFact(
    userId: string,
    factId: string,
    updates: Partial<MemoryFact>
  ): Promise<MemoryFact> {
    await this.ensureInitialized();

    // Update cold first
    const updated = await this.cold.updateFact(userId, factId, updates);

    // Update hot too (if exists)
    try {
      await this.hot.updateFact(userId, factId, updates);
    } catch {
      // May not exist in hot, that's OK
    }

    return updated;
  }

  async deleteFact(
    userId: string,
    factId: string,
    reason?: string
  ): Promise<void> {
    await this.ensureInitialized();

    await Promise.all([
      this.cold.deleteFact(userId, factId, reason),
      this.hot.deleteFact(userId, factId, reason).catch(() => {}),
    ]);
  }

  async hardDeleteFact(userId: string, factId: string): Promise<void> {
    await this.ensureInitialized();

    await Promise.all([
      this.cold.hardDeleteFact(userId, factId),
      this.hot.hardDeleteFact(userId, factId).catch(() => {}),
    ]);
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

    // Recent history from hot
    let history = await this.hot.getConversationHistory(
      userId,
      limit,
      sessionId
    );

    if (history.length < (limit ?? 10)) {
      // Get more from cold
      const coldHistory = await this.cold.getConversationHistory(
        userId,
        limit,
        sessionId
      );

      // Merge and dedupe
      const ids = new Set(history.map((h) => h.id));
      for (const h of coldHistory) {
        if (!ids.has(h.id)) {
          history.push(h);
        }
      }

      // Sort by timestamp descending
      history.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Apply limit
      if (limit) {
        history = history.slice(0, limit);
      }
    }

    return history;
  }

  async saveConversation(
    userId: string,
    exchange: Omit<ConversationExchange, "id">
  ): Promise<ConversationExchange> {
    await this.ensureInitialized();

    // Save to cold first
    const saved = await this.cold.saveConversation(userId, exchange);

    // Also save to hot
    await this.hot.saveConversation(userId, saved);

    // Demote old conversations if needed
    if (this.config.autoDemote) {
      await this.demoteOldConversations(userId);
    }

    return saved;
  }

  // =========================================================================
  // Session Operations
  // =========================================================================

  async getSessions(userId: string, limit?: number): Promise<Session[]> {
    await this.ensureInitialized();
    // Sessions always from cold (source of truth)
    return this.cold.getSessions(userId, limit);
  }

  async getSession(userId: string, sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();
    return this.cold.getSession(userId, sessionId);
  }

  async createSession(userId: string): Promise<Session> {
    await this.ensureInitialized();
    const session = await this.cold.createSession(userId);
    await this.hot.createSession(userId).catch(() => {});
    return session;
  }

  async endSession(
    userId: string,
    sessionId: string,
    summary?: string
  ): Promise<Session> {
    await this.ensureInitialized();
    return this.cold.endSession(userId, sessionId, summary);
  }

  // =========================================================================
  // Tier Management
  // =========================================================================

  private async promoteFactsToHot(
    userId: string,
    facts: MemoryFact[]
  ): Promise<void> {
    for (const fact of facts) {
      try {
        await this.hot.upsertFact(userId, fact);
      } catch {
        // Ignore promotion failures
      }
    }
  }

  private async demoteOldFacts(userId: string): Promise<void> {
    const hotFacts = await this.hot.getFacts(userId, { validOnly: true });

    if (hotFacts.length > this.config.hotFactLimit) {
      // Sort by updatedAt, remove oldest
      hotFacts.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
      const toRemove = hotFacts.slice(
        0,
        hotFacts.length - this.config.hotFactLimit
      );

      for (const fact of toRemove) {
        await this.hot.hardDeleteFact(userId, fact.id).catch(() => {});
      }
    }
  }

  private async demoteOldConversations(_userId: string): Promise<void> {
    // Note: BaseAdapter doesn't have deleteConversation method yet.
    // Conversations in hot storage will naturally age out or be overwritten.
    // TODO: Add deleteConversation to BaseAdapter for full tier management.
  }

  /**
   * Manually promote a fact to hot storage
   */
  async promoteToHot(userId: string, factId: string): Promise<void> {
    const fact = await this.cold.getFactById(userId, factId);
    if (fact) {
      await this.hot.upsertFact(userId, fact);
    }
  }

  /**
   * Manually demote a fact from hot storage
   */
  async demoteFromHot(userId: string, factId: string): Promise<void> {
    await this.hot.hardDeleteFact(userId, factId).catch(() => {});
  }

  /**
   * Sync all facts from cold to hot for a user (cache warming)
   */
  async warmCache(userId: string): Promise<void> {
    const facts = await this.cold.getFacts(userId, {
      validOnly: true,
      limit: this.config.hotFactLimit,
      orderBy: "updatedAt",
      orderDir: "desc",
    });

    await this.promoteFactsToHot(userId, facts);
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(userId: string): Promise<{
    hotFacts: number;
    coldFacts: number;
    hotConversations: number;
    coldConversations: number;
  }> {
    const [hotFacts, coldFacts, hotConvos, coldConvos] = await Promise.all([
      this.hot.getFacts(userId, { validOnly: false }),
      this.cold.getFacts(userId, { validOnly: false }),
      this.hot.getConversationHistory(userId),
      this.cold.getConversationHistory(userId),
    ]);

    return {
      hotFacts: hotFacts.length,
      coldFacts: coldFacts.length,
      hotConversations: hotConvos.length,
      coldConversations: coldConvos.length,
    };
  }
}
