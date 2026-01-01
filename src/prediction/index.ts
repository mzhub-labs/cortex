/**
 * Predictive Engine - Behavioral Pattern Detection
 *
 * Detects temporal and behavioral patterns in user interactions:
 * - "User usually asks about X on Mondays"
 * - "User tends to discuss work topics in mornings"
 * - "User often follows up on topic Y after topic X"
 */

import type { ConversationExchange, MemoryFact } from "../types";
import type { BaseAdapter } from "../adapters/BaseAdapter";
import type { BaseProvider } from "../providers/BaseProvider";

export interface PredictionConfig {
  /** Minimum occurrences to consider a pattern (default: 3) */
  minOccurrences?: number;
  /** Days to look back for patterns (default: 30) */
  lookbackDays?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface BehaviorPattern {
  /** Type of pattern */
  type: "temporal" | "sequential" | "topical";
  /** Description of the pattern */
  description: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Supporting evidence */
  occurrences: number;
  /** Day of week (0-6) for temporal patterns */
  dayOfWeek?: number;
  /** Hour of day (0-23) for temporal patterns */
  hourOfDay?: number;
  /** Topic/predicate involved */
  topic?: string;
}

export interface Prediction {
  /** What we predict the user might do/ask */
  prediction: string;
  /** Based on which pattern */
  basedOn: BehaviorPattern;
  /** Confidence score (0-1) */
  confidence: number;
  /** Suggested proactive action */
  suggestedAction?: string;
}

/**
 * Analyzes user behavior to detect patterns and make predictions.
 */
export class PredictiveEngine {
  private adapter: BaseAdapter;
  private provider?: BaseProvider;
  private config: Required<PredictionConfig>;

  constructor(
    adapter: BaseAdapter,
    provider?: BaseProvider,
    config: PredictionConfig = {}
  ) {
    this.adapter = adapter;
    this.provider = provider;
    this.config = {
      minOccurrences: config.minOccurrences ?? 3,
      lookbackDays: config.lookbackDays ?? 30,
      debug: config.debug ?? false,
    };
  }

  /**
   * Analyze a user's behavior patterns.
   */
  async analyzePatterns(userId: string): Promise<BehaviorPattern[]> {
    const patterns: BehaviorPattern[] = [];

    // Get conversation history
    const history = await this.adapter.getConversationHistory(userId, 500);
    const cutoff = Date.now() - this.config.lookbackDays * 24 * 60 * 60 * 1000;
    const recentHistory = history.filter(
      (h) => h.timestamp.getTime() >= cutoff
    );

    if (recentHistory.length < this.config.minOccurrences) {
      return patterns;
    }

    // Analyze temporal patterns (day of week)
    const dayPatterns = this.analyzeTemporalPatterns(recentHistory, "day");
    patterns.push(...dayPatterns);

    // Analyze temporal patterns (hour of day)
    const hourPatterns = this.analyzeTemporalPatterns(recentHistory, "hour");
    patterns.push(...hourPatterns);

    // Analyze topic patterns
    const facts = await this.adapter.getFacts(userId, { validOnly: true });
    const topicPatterns = this.analyzeTopicPatterns(facts);
    patterns.push(...topicPatterns);

    return patterns.filter((p) => p.occurrences >= this.config.minOccurrences);
  }

  /**
   * Analyze when user tends to interact.
   */
  private analyzeTemporalPatterns(
    history: ConversationExchange[],
    granularity: "day" | "hour"
  ): BehaviorPattern[] {
    const patterns: BehaviorPattern[] = [];
    const counts: Map<number, number> = new Map();

    for (const exchange of history) {
      const key =
        granularity === "day"
          ? exchange.timestamp.getDay()
          : exchange.timestamp.getHours();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const total = history.length;
    const expectedPct = 1 / (granularity === "day" ? 7 : 24);

    for (const [key, count] of counts) {
      const actualPct = count / total;

      // If this time slot is significantly more common than expected
      if (
        actualPct > expectedPct * 1.5 &&
        count >= this.config.minOccurrences
      ) {
        const dayNames = [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ];

        patterns.push({
          type: "temporal",
          description:
            granularity === "day"
              ? `User is most active on ${dayNames[key]}s`
              : `User is most active around ${key}:00`,
          confidence: Math.min(actualPct / expectedPct / 3, 0.95),
          occurrences: count,
          dayOfWeek: granularity === "day" ? key : undefined,
          hourOfDay: granularity === "hour" ? key : undefined,
        });
      }
    }

    return patterns;
  }

  /**
   * Analyze what topics user engages with most.
   */
  private analyzeTopicPatterns(facts: MemoryFact[]): BehaviorPattern[] {
    const patterns: BehaviorPattern[] = [];
    const predicateCounts: Map<string, number> = new Map();

    for (const fact of facts) {
      const key = fact.predicate;
      predicateCounts.set(
        key,
        (predicateCounts.get(key) ?? 0) + (fact.accessCount ?? 1)
      );
    }

    // Find most accessed topics
    const sorted = Array.from(predicateCounts.entries()).sort(
      (a, b) => b[1] - a[1]
    );

    for (const [predicate, count] of sorted.slice(0, 5)) {
      if (count >= this.config.minOccurrences) {
        patterns.push({
          type: "topical",
          description: `User frequently discusses ${predicate
            .toLowerCase()
            .replace(/_/g, " ")}`,
          confidence: Math.min(count / 10, 0.9),
          occurrences: count,
          topic: predicate,
        });
      }
    }

    return patterns;
  }

  /**
   * Get predictions for what user might need/ask next.
   */
  async getPredictions(
    userId: string,
    _currentContext?: string
  ): Promise<Prediction[]> {
    const patterns = await this.analyzePatterns(userId);
    const predictions: Prediction[] = [];
    const now = new Date();

    for (const pattern of patterns) {
      // Temporal predictions
      if (pattern.type === "temporal") {
        const isRelevantTime =
          (pattern.dayOfWeek !== undefined &&
            pattern.dayOfWeek === now.getDay()) ||
          (pattern.hourOfDay !== undefined &&
            Math.abs(pattern.hourOfDay - now.getHours()) <= 2);

        if (isRelevantTime) {
          predictions.push({
            prediction: `User is typically active at this time`,
            basedOn: pattern,
            confidence: pattern.confidence,
            suggestedAction: "Consider proactive engagement",
          });
        }
      }

      // Topical predictions
      if (pattern.type === "topical" && pattern.topic) {
        predictions.push({
          prediction: `User may want to discuss ${pattern.topic
            .toLowerCase()
            .replace(/_/g, " ")}`,
          basedOn: pattern,
          confidence: pattern.confidence * 0.7, // Slightly lower confidence
        });
      }
    }

    return predictions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Use LLM for deeper behavioral analysis.
   */
  async analyzeWithLLM(userId: string): Promise<BehaviorPattern[]> {
    if (!this.provider) return [];

    const history = await this.adapter.getConversationHistory(userId, 50);
    const facts = await this.adapter.getFacts(userId, {
      validOnly: true,
      limit: 30,
    });

    if (history.length < 5) return [];

    const historyText = history
      .slice(0, 20)
      .map(
        (h) =>
          `[${h.timestamp.toISOString()}] User: ${h.userMessage.slice(0, 100)}`
      )
      .join("\n");

    const factsText = facts
      .map((f) => `${f.predicate}: ${f.object}`)
      .join("\n");

    const prompt = `Analyze this user's behavior patterns:

## Recent Conversations
${historyText}

## Known Facts
${factsText}

Identify behavioral patterns. Output JSON:
{
  "patterns": [
    {
      "type": "temporal|sequential|topical",
      "description": "what the pattern is",
      "confidence": 0.0-1.0
    }
  ]
}`;

    try {
      const result = await this.provider.complete({
        systemPrompt:
          "You analyze user behavior patterns. Output only valid JSON.",
        userPrompt: prompt,
        maxTokens: 400,
        temperature: 0.3,
        jsonMode: true,
      });

      const parsed = JSON.parse(result.content);
      return (parsed.patterns ?? []).map(
        (p: { type?: string; description?: string; confidence?: number }) => ({
          type: p.type || "topical",
          description: p.description || "",
          confidence: p.confidence || 0.5,
          occurrences: 0, // Not available from LLM
        })
      );
    } catch (e) {
      if (this.config.debug) {
        console.error("[Prediction] LLM analysis failed:", e);
      }
      return [];
    }
  }
}
