/**
 * Budget management for cortex.
 * Prevents runaway costs from infinite loops or abuse.
 */

export interface BudgetConfig {
  /** Maximum tokens per user per day for background processing */
  maxTokensPerUserPerDay?: number;
  /** Maximum extraction calls per user per day */
  maxExtractionsPerUserPerDay?: number;
  /** Maximum facts per user (to prevent storage abuse) */
  maxFactsPerUser?: number;
  /** Maximum conversations stored per user */
  maxConversationsPerUser?: number;
  /** Cooldown between extractions in ms (prevents rapid-fire) */
  extractionCooldownMs?: number;
}

interface UserBudgetState {
  tokensUsedToday: number;
  extractionsToday: number;
  lastExtractionTime: number;
  lastResetDate: string;
}

/**
 * Budget manager to prevent runaway costs and abuse.
 */
export class BudgetManager {
  private config: Required<BudgetConfig>;
  private userBudgets: Map<string, UserBudgetState> = new Map();

  constructor(config: BudgetConfig = {}) {
    this.config = {
      maxTokensPerUserPerDay: config.maxTokensPerUserPerDay ?? 100000, // 100k tokens
      maxExtractionsPerUserPerDay: config.maxExtractionsPerUserPerDay ?? 100,
      maxFactsPerUser: config.maxFactsPerUser ?? 1000,
      maxConversationsPerUser: config.maxConversationsPerUser ?? 10000,
      extractionCooldownMs: config.extractionCooldownMs ?? 1000, // 1 second
    };
  }

  private getToday(): string {
    return new Date().toISOString().split("T")[0];
  }

  private getUserState(userId: string): UserBudgetState {
    const today = this.getToday();
    let state = this.userBudgets.get(userId);

    if (!state || state.lastResetDate !== today) {
      // Reset daily counters
      state = {
        tokensUsedToday: 0,
        extractionsToday: 0,
        lastExtractionTime: 0,
        lastResetDate: today,
      };
      this.userBudgets.set(userId, state);
    }

    return state;
  }

  /**
   * Check if a user can perform an extraction
   */
  canExtract(userId: string): { allowed: boolean; reason?: string } {
    const state = this.getUserState(userId);
    const now = Date.now();

    // Check extraction count
    if (state.extractionsToday >= this.config.maxExtractionsPerUserPerDay) {
      return {
        allowed: false,
        reason: `Daily extraction limit reached (${this.config.maxExtractionsPerUserPerDay})`,
      };
    }

    // Check cooldown
    const timeSinceLastExtraction = now - state.lastExtractionTime;
    if (timeSinceLastExtraction < this.config.extractionCooldownMs) {
      return {
        allowed: false,
        reason: `Extraction cooldown active (${
          this.config.extractionCooldownMs - timeSinceLastExtraction
        }ms remaining)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if a user has token budget remaining
   */
  canUseTokens(
    userId: string,
    estimatedTokens: number,
  ): { allowed: boolean; reason?: string } {
    const state = this.getUserState(userId);

    if (
      state.tokensUsedToday + estimatedTokens >
      this.config.maxTokensPerUserPerDay
    ) {
      return {
        allowed: false,
        reason: `Daily token budget exhausted (${state.tokensUsedToday}/${this.config.maxTokensPerUserPerDay} used)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record an extraction
   */
  recordExtraction(userId: string): void {
    const state = this.getUserState(userId);
    state.extractionsToday++;
    state.lastExtractionTime = Date.now();
  }

  /**
   * Record token usage
   */
  recordTokens(userId: string, tokens: number): void {
    const state = this.getUserState(userId);
    state.tokensUsedToday += tokens;
  }

  /**
   * Get remaining budget for a user
   */
  getRemainingBudget(userId: string): {
    tokensRemaining: number;
    extractionsRemaining: number;
  } {
    const state = this.getUserState(userId);

    return {
      tokensRemaining: Math.max(
        0,
        this.config.maxTokensPerUserPerDay - state.tokensUsedToday,
      ),
      extractionsRemaining: Math.max(
        0,
        this.config.maxExtractionsPerUserPerDay - state.extractionsToday,
      ),
    };
  }

  /**
   * Get max facts allowed per user
   */
  getMaxFactsPerUser(): number {
    return this.config.maxFactsPerUser;
  }

  /**
   * Get max conversations allowed per user
   */
  getMaxConversationsPerUser(): number {
    return this.config.maxConversationsPerUser;
  }

  /**
   * Reset a user's budget (for testing or admin override)
   */
  resetUserBudget(userId: string): void {
    this.userBudgets.delete(userId);
  }

  /**
   * Get current usage stats for a user
   */
  getUsageStats(userId: string): {
    tokensUsedToday: number;
    extractionsToday: number;
    tokensRemaining: number;
    extractionsRemaining: number;
  } {
    const state = this.getUserState(userId);
    const remaining = this.getRemainingBudget(userId);

    return {
      tokensUsedToday: state.tokensUsedToday,
      extractionsToday: state.extractionsToday,
      ...remaining,
    };
  }
}
