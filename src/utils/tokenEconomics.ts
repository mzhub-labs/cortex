/**
 * Token economics utilities for cortex.
 * Provides token estimation, compression, and analytics.
 */

/**
 * Token usage statistics
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost?: number;
}

/**
 * Token analytics over time
 */
export interface TokenAnalytics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  tokensSavedByCache: number;
  tokensSavedByCompression: number;
  estimatedSavings: number;
}

/**
 * Pricing per 1M tokens (approximate, as of late 2024)
 */
export const TOKEN_PRICING: Record<string, { input: number; output: number }> =
  {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4-turbo": { input: 10, output: 30 },
    "claude-3-opus": { input: 15, output: 75 },
    "claude-3-sonnet": { input: 3, output: 15 },
    "claude-3-haiku": { input: 0.25, output: 1.25 },
    "gemini-1.5-pro": { input: 1.25, output: 5 },
    "gemini-1.5-flash": { input: 0.075, output: 0.3 },
    "gemini-2.0-flash": { input: 0.075, output: 0.3 },
    "llama-3.3-70b": { input: 0, output: 0 }, // Cerebras free tier
    "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 }, // Groq
  };

/**
 * Estimate token count for a string.
 * Uses a simple heuristic: ~4 characters per token for English text.
 * For more accurate counts, use tiktoken or similar.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Rule of thumb: 1 token ≈ 4 characters for English
  // Adjust for common patterns
  const charCount = text.length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Average of character-based and word-based estimates
  const charEstimate = Math.ceil(charCount / 4);
  const wordEstimate = Math.ceil(wordCount * 1.3); // ~1.3 tokens per word

  return Math.round((charEstimate + wordEstimate) / 2);
}

/**
 * Estimate cost for a given token usage
 */
export function estimateCost(
  usage: { inputTokens: number; outputTokens: number },
  model: string,
): number {
  const pricing = TOKEN_PRICING[model] || TOKEN_PRICING["gpt-4o-mini"];

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

/**
 * Token analytics tracker
 */
export class TokenTracker {
  private usages: TokenUsage[] = [];
  private tokensSavedByCache = 0;
  private tokensSavedByCompression = 0;
  private model: string;

  constructor(model = "gpt-4o-mini") {
    this.model = model;
  }

  /**
   * Record a token usage
   */
  record(usage: { inputTokens: number; outputTokens: number }): void {
    this.usages.push({
      ...usage,
      totalTokens: usage.inputTokens + usage.outputTokens,
      estimatedCost: estimateCost(usage, this.model),
    });
  }

  /**
   * Record tokens saved by cache hit
   */
  recordCacheSavings(tokens: number): void {
    this.tokensSavedByCache += tokens;
  }

  /**
   * Record tokens saved by compression
   */
  recordCompressionSavings(
    originalTokens: number,
    compressedTokens: number,
  ): void {
    this.tokensSavedByCompression += originalTokens - compressedTokens;
  }

  /**
   * Get analytics summary
   */
  getAnalytics(): TokenAnalytics {
    const totalInputTokens = this.usages.reduce(
      (sum, u) => sum + u.inputTokens,
      0,
    );
    const totalOutputTokens = this.usages.reduce(
      (sum, u) => sum + u.outputTokens,
      0,
    );
    const totalCalls = this.usages.length;

    const pricing = TOKEN_PRICING[this.model] || TOKEN_PRICING["gpt-4o-mini"];
    const savedTokens = this.tokensSavedByCache + this.tokensSavedByCompression;
    const estimatedSavings = (savedTokens / 1_000_000) * pricing.input;

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCalls,
      averageInputTokens: totalCalls > 0 ? totalInputTokens / totalCalls : 0,
      averageOutputTokens: totalCalls > 0 ? totalOutputTokens / totalCalls : 0,
      tokensSavedByCache: this.tokensSavedByCache,
      tokensSavedByCompression: this.tokensSavedByCompression,
      estimatedSavings,
    };
  }

  /**
   * Reset analytics
   */
  reset(): void {
    this.usages = [];
    this.tokensSavedByCache = 0;
    this.tokensSavedByCompression = 0;
  }
}

/**
 * Compress conversation history by summarizing older messages.
 * Returns a compressed conversation array.
 */
export function compressConversation(
  messages: Array<{ role: string; content: string }>,
  options: {
    keepRecent?: number;
    maxSummaryTokens?: number;
  } = {},
): {
  messages: Array<{ role: string; content: string }>;
  originalTokens: number;
  compressedTokens: number;
} {
  const keepRecent = options.keepRecent ?? 4;
  const maxSummaryTokens = options.maxSummaryTokens ?? 200;

  if (messages.length <= keepRecent) {
    const tokens = messages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );
    return { messages, originalTokens: tokens, compressedTokens: tokens };
  }

  const originalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  );

  // Keep recent messages
  const recentMessages = messages.slice(-keepRecent);
  const oldMessages = messages.slice(0, -keepRecent);

  // Create a summary of old messages
  const oldContent = oldMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  // Truncate to max summary tokens
  const summaryChars = maxSummaryTokens * 4; // Approximate
  const truncatedSummary =
    oldContent.length > summaryChars
      ? oldContent.slice(0, summaryChars) + "..."
      : oldContent;

  const summaryMessage = {
    role: "system",
    content: `[Previous conversation summary: ${truncatedSummary}]`,
  };

  const compressedMessages = [summaryMessage, ...recentMessages];
  const compressedTokens = compressedMessages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  );

  return {
    messages: compressedMessages,
    originalTokens,
    compressedTokens,
  };
}
