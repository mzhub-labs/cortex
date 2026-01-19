/**
 * Auto-summarization manager for cortex.
 * Triggers conversation summarization after a threshold of messages.
 */

import type { BaseAdapter } from "../adapters/BaseAdapter";
import type { BaseProvider } from "../providers/BaseProvider";

export interface AutoSummarizeConfig {
  /** Enable auto-summarization */
  enabled?: boolean;
  /** Number of messages before triggering summarization */
  threshold?: number;
  /** Maximum summary length in characters */
  maxSummaryLength?: number;
}

const SUMMARIZE_PROMPT = `You are a conversation summarizer. Given the following conversation exchanges, create a concise summary that captures:
1. Key topics discussed
2. Important decisions or preferences mentioned
3. Any action items or follow-ups

Output only the summary, no preamble.

Conversation:
`;

/**
 * Auto-summarization manager
 */
export class AutoSummarizer {
  private adapter: BaseAdapter;
  private provider: BaseProvider | null;
  private config: Required<AutoSummarizeConfig>;
  private messageCounters: Map<string, number> = new Map();

  constructor(
    adapter: BaseAdapter,
    provider: BaseProvider | null,
    config: AutoSummarizeConfig = {},
  ) {
    this.adapter = adapter;
    this.provider = provider;
    this.config = {
      enabled: config.enabled ?? true,
      threshold: config.threshold ?? 20,
      maxSummaryLength: config.maxSummaryLength ?? 500,
    };
  }

  /**
   * Record a message and check if summarization should trigger
   */
  async recordMessage(userId: string, sessionId: string): Promise<boolean> {
    if (!this.config.enabled || !this.provider) return false;

    const key = `${userId}:${sessionId}`;
    const count = (this.messageCounters.get(key) ?? 0) + 1;
    this.messageCounters.set(key, count);

    if (count >= this.config.threshold) {
      // Reset counter
      this.messageCounters.set(key, 0);

      // Trigger summarization
      await this.summarizeSession(userId, sessionId);
      return true;
    }

    return false;
  }

  /**
   * Summarize a session's conversation history
   */
  async summarizeSession(
    userId: string,
    sessionId: string,
  ): Promise<string | null> {
    if (!this.provider) return null;

    const history = await this.adapter.getConversationHistory(
      userId,
      this.config.threshold,
      sessionId,
    );

    if (history.length < 5) return null; // Not enough to summarize

    // Build conversation text
    const conversationText = history
      .slice()
      .reverse() // Oldest first
      .map((h) => `User: ${h.userMessage}\nAssistant: ${h.assistantResponse}`)
      .join("\n\n");

    // Generate summary
    const result = await this.provider.complete({
      systemPrompt: SUMMARIZE_PROMPT,
      userPrompt: conversationText,
      maxTokens: 300,
      temperature: 0.3,
    });

    const summary = result.content.slice(0, this.config.maxSummaryLength);

    // Update session with summary
    await this.adapter.endSession(userId, sessionId, summary);

    return summary;
  }

  /**
   * Get current message count for a session
   */
  getMessageCount(userId: string, sessionId: string): number {
    return this.messageCounters.get(`${userId}:${sessionId}`) ?? 0;
  }

  /**
   * Reset message counter for a session
   */
  resetCounter(userId: string, sessionId: string): void {
    this.messageCounters.delete(`${userId}:${sessionId}`);
  }

  /**
   * Force summarization regardless of count
   */
  async forceSummarize(
    userId: string,
    sessionId: string,
  ): Promise<string | null> {
    this.messageCounters.set(`${userId}:${sessionId}`, 0);
    return this.summarizeSession(userId, sessionId);
  }
}
