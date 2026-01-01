/**
 * Deep Sleep Worker - "Sleep Synthesis" for pattern recognition.
 *
 * Runs on a schedule (not per-message) to find higher-level patterns
 * across multiple conversations over time.
 *
 * Biological analogy: During sleep, the brain consolidates memories
 * and connects dots between experiences that happened days apart.
 */

import type { MemoryFact, MemoryOperation } from "../types";
import type { BaseAdapter } from "../adapters/BaseAdapter";
import type { BaseProvider } from "../providers/BaseProvider";

export interface DeepSleepConfig {
  /** Hours to look back for recent facts (default: 24) */
  lookbackHours?: number;
  /** Minimum facts needed to trigger synthesis (default: 3) */
  minFactsForSynthesis?: number;
  /** Maximum new insights to generate (default: 5) */
  maxInsights?: number;
  /** Minimum confidence for synthesized insights (default: 0.7) */
  minInsightConfidence?: number;
  /** Enable debug logging */
  debug?: boolean;
}

const SYNTHESIS_SYSTEM_PROMPT = `You are a Pattern Recognition AI analyzing a user's facts and behaviors over time.

## Your Task
Look at the collection of facts about a user. Identify any HIGHER-LEVEL PATTERNS that connect multiple facts.

## Examples of Synthesis:
Individual Facts:
- User is tired often
- User works late
- User skips meals
- User drinks lots of coffee

Synthesized Insight:
→ "User shows signs of work-related burnout" (importance: 7)

Individual Facts:
- User mentioned headaches
- User spends 10+ hours on screens
- User rarely exercises

Synthesized Insight:
→ "User may benefit from screen breaks and physical activity" (importance: 6)

## What to Look For:
- Health/wellness patterns
- Behavioral patterns (positive or concerning)
- Lifestyle patterns
- Relationship patterns
- Work/productivity patterns

## Output Format:
{
  "insights": [
    {
      "subject": "User",
      "predicate": "PATTERN_DETECTED",
      "object": "Description of the pattern",
      "importance": 7,
      "confidence": 0.8,
      "basedOn": ["fact1", "fact2", "fact3"],
      "reasoning": "Why this pattern matters"
    }
  ],
  "noPatterns": false
}

If no meaningful patterns are found, return:
{
  "insights": [],
  "noPatterns": true,
  "reasoning": "Why no patterns were detected"
}

## Rules:
1. Only identify patterns with 3+ supporting facts
2. Be conservative - only flag high-confidence patterns
3. Focus on actionable insights
4. Mark health/safety patterns as importance >= 8
5. Don't over-interpret trivial preferences`;

interface SynthesisResult {
  insights: Array<{
    subject: string;
    predicate: string;
    object: string;
    importance: number;
    confidence: number;
    basedOn: string[];
    reasoning: string;
  }>;
  noPatterns: boolean;
  reasoning?: string;
}

/**
 * Deep Sleep Worker - Scheduled batch synthesis for pattern recognition.
 *
 * Call `runSynthesisCycle(userId)` on a schedule (e.g., nightly cron).
 */
export class DeepSleepWorker {
  private provider: BaseProvider;
  private adapter: BaseAdapter;
  private config: Required<DeepSleepConfig>;

  constructor(
    provider: BaseProvider,
    adapter: BaseAdapter,
    config: DeepSleepConfig = {}
  ) {
    this.provider = provider;
    this.adapter = adapter;
    this.config = {
      lookbackHours: config.lookbackHours ?? 24,
      minFactsForSynthesis: config.minFactsForSynthesis ?? 3,
      maxInsights: config.maxInsights ?? 5,
      minInsightConfidence: config.minInsightConfidence ?? 0.7,
      debug: config.debug ?? false,
    };
  }

  /**
   * Run a synthesis cycle for a user.
   * Meant to be called on a schedule (e.g., nightly).
   */
  async runSynthesisCycle(userId: string): Promise<MemoryOperation[]> {
    if (this.config.debug) {
      console.log(`[DeepSleep] Starting synthesis cycle for user: ${userId}`);
    }

    // 1. Get recent facts (created/updated in lookback window)
    const cutoff = new Date(
      Date.now() - this.config.lookbackHours * 60 * 60 * 1000
    );
    const allFacts = await this.adapter.getFacts(userId, {
      validOnly: true,
      orderBy: "updatedAt",
      orderDir: "desc",
      limit: 100,
    });

    const recentFacts = allFacts.filter((f) => f.updatedAt >= cutoff);

    if (recentFacts.length < this.config.minFactsForSynthesis) {
      if (this.config.debug) {
        console.log(
          `[DeepSleep] Not enough recent facts (${recentFacts.length}), skipping`
        );
      }
      return [];
    }

    // 2. Get older facts for context
    const olderFacts = allFacts
      .filter((f) => f.updatedAt < cutoff)
      .slice(0, 50);

    // 3. Build prompt
    const prompt = this.buildPrompt(recentFacts, olderFacts);

    // 4. Call LLM for synthesis
    const completion = await this.provider.complete({
      systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
      userPrompt: prompt,
      maxTokens: 1000,
      temperature: 0.3,
      jsonMode: true,
    });

    // 5. Parse result
    let result: SynthesisResult;
    try {
      result = JSON.parse(completion.content);
    } catch {
      if (this.config.debug) {
        console.error("[DeepSleep] Failed to parse synthesis result");
      }
      return [];
    }

    if (result.noPatterns || !result.insights?.length) {
      if (this.config.debug) {
        console.log("[DeepSleep] No patterns detected");
      }
      return [];
    }

    // 6. Convert insights to operations
    const operations: MemoryOperation[] = [];
    for (const insight of result.insights.slice(0, this.config.maxInsights)) {
      if (insight.confidence >= this.config.minInsightConfidence) {
        operations.push({
          op: "INSERT",
          subject: insight.subject || "User",
          predicate: insight.predicate || "INSIGHT",
          object: insight.object,
          confidence: insight.confidence,
          importance: insight.importance || 6,
        });
      }
    }

    // 7. Apply operations
    for (const op of operations) {
      if (op.op === "INSERT") {
        await this.adapter.upsertFact(userId, {
          subject: op.subject,
          predicate: op.predicate,
          object: op.object,
          confidence: op.confidence ?? 0.8,
          importance: op.importance ?? 6,
          source: "deep-sleep-synthesis",
          invalidatedAt: null,
        });
      }
    }

    if (this.config.debug) {
      console.log(`[DeepSleep] Generated ${operations.length} insights`);
    }

    return operations;
  }

  /**
   * Run synthesis for all active users.
   * Call this from a cron job for batch processing.
   */
  async runGlobalCycle(
    userIds: string[]
  ): Promise<Map<string, MemoryOperation[]>> {
    const results = new Map<string, MemoryOperation[]>();

    for (const userId of userIds) {
      try {
        const ops = await this.runSynthesisCycle(userId);
        results.set(userId, ops);
      } catch (err) {
        if (this.config.debug) {
          console.error(`[DeepSleep] Error for user ${userId}:`, err);
        }
        results.set(userId, []);
      }
    }

    return results;
  }

  private buildPrompt(
    recentFacts: MemoryFact[],
    olderFacts: MemoryFact[]
  ): string {
    const formatFacts = (facts: MemoryFact[]): string =>
      facts
        .map(
          (f) =>
            `- ${f.subject}.${f.predicate}: "${f.object}" (confidence: ${f.confidence})`
        )
        .join("\n");

    return `## Recent Facts (last ${this.config.lookbackHours} hours)
${formatFacts(recentFacts)}

## Historical Facts (for context)
${formatFacts(olderFacts)}

Analyze these facts and identify any higher-level patterns or insights.`;
  }
}
