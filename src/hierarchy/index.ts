/**
 * Hierarchical Memory Manager (HMM)
 *
 * Implements the 4-level Memory Pyramid:
 *
 * Level 4: Core Beliefs (BIOS)
 *   - Always loaded, never forgotten
 *   - Allergies, identity, safety rules
 *
 * Level 3: Patterns (Wisdom)
 *   - Synthesized from multiple Level 2 facts
 *   - "User is health-conscious" instead of 50 food facts
 *
 * Level 2: Facts (Knowledge)
 *   - The standard discrete facts
 *   - Subject-Predicate-Object triples
 *
 * Level 1: Raw Logs (Stream)
 *   - Ephemeral conversation buffer
 *   - Auto-flushed after extraction
 *
 * This is an OPTIONAL wrapper - you can use mem-ts without HMM.
 */

import type { MemoryFact } from "../types";
import type { BaseAdapter } from "../adapters/BaseAdapter";
import type { BaseProvider } from "../providers/BaseProvider";

export type MemoryLevel = "raw_log" | "fact" | "pattern" | "core_belief";

export interface HierarchicalConfig {
  /** Enable HMM mode (default: false for backwards compatibility) */
  enabled?: boolean;
  /** Maximum raw logs to keep before flushing (default: 20) */
  maxRawLogs?: number;
  /** Minimum facts needed to synthesize a pattern (default: 3) */
  minFactsForPattern?: number;
  /** Hours before promoting patterns to core beliefs (default: 168 = 1 week) */
  coreBeliefHours?: number;
  /** Enable debug logging */
  debug?: boolean;
}

const PATTERN_SYNTHESIS_PROMPT = `You are analyzing a user's facts to find higher-level patterns/traits.

## Facts to Analyze:
{facts}

## Task:
Identify patterns that capture WISDOM about the user, not just data.
- Data: "User ate salad" + "User goes to gym" + "User tracks calories"
- Wisdom: "User is health-conscious and actively maintains fitness"

## Output Format:
{
  "patterns": [
    {
      "predicate": "TRAIT" or "PATTERN" or "PREFERENCE",
      "object": "The synthesized insight",
      "importance": 6-8,
      "confidence": 0.7-0.95,
      "basedOnIds": ["id1", "id2", "id3"],
      "reasoning": "Why this pattern emerges"
    }
  ],
  "promotions": [
    {
      "factId": "id",
      "newLevel": "core_belief",
      "reason": "Why this should be core (e.g., safety critical)"
    }
  ]
}

Rules:
1. Only create patterns with 3+ supporting facts
2. Patterns should be STABLE truths, not temporary states
3. Promote to core_belief ONLY if safety-critical (allergies, medical, boundaries)
4. Return empty arrays if no clear patterns found`;

/**
 * Hierarchical Memory Manager - Optional HMM mode for mem-ts
 */
export class HierarchicalMemory {
  private adapter: BaseAdapter;
  private provider?: BaseProvider;
  private config: Required<HierarchicalConfig>;

  constructor(
    adapter: BaseAdapter,
    provider?: BaseProvider,
    config: HierarchicalConfig = {}
  ) {
    this.adapter = adapter;
    this.provider = provider;
    this.config = {
      enabled: config.enabled ?? false,
      maxRawLogs: config.maxRawLogs ?? 20,
      minFactsForPattern: config.minFactsForPattern ?? 3,
      coreBeliefHours: config.coreBeliefHours ?? 168,
      debug: config.debug ?? false,
    };
  }

  /**
   * Get facts by memory level.
   */
  async getByLevel(userId: string, level: MemoryLevel): Promise<MemoryFact[]> {
    const facts = await this.adapter.getFacts(userId, { validOnly: true });
    return facts.filter((f) => (f.memoryLevel ?? "fact") === level);
  }

  /**
   * Hierarchical retrieval - top-down query.
   * 1. Always load core beliefs
   * 2. Check patterns for context
   * 3. Load specific facts only if needed
   */
  async hydrateHierarchical(
    userId: string,
    maxFacts: number = 20
  ): Promise<{
    coreBeliefs: MemoryFact[];
    patterns: MemoryFact[];
    facts: MemoryFact[];
    totalTokens: number;
  }> {
    // Level 4: Core Beliefs - ALWAYS loaded
    const coreBeliefs = await this.getByLevel(userId, "core_belief");

    // Level 3: Patterns - High-density summaries
    const patterns = await this.getByLevel(userId, "pattern");

    // Level 2: Facts - Fill remaining budget
    const usedSlots = coreBeliefs.length + patterns.length;
    const remainingSlots = Math.max(0, maxFacts - usedSlots);

    const allFacts = await this.getByLevel(userId, "fact");
    const facts = allFacts
      .sort((a, b) => (b.accessCount ?? 0) - (a.accessCount ?? 0))
      .slice(0, remainingSlots);

    // Estimate tokens
    const allSelected = [...coreBeliefs, ...patterns, ...facts];
    const totalTokens = allSelected.reduce(
      (sum, f) => sum + Math.ceil((f.predicate.length + f.object.length) / 4),
      0
    );

    return { coreBeliefs, patterns, facts, totalTokens };
  }

  /**
   * Compile hierarchical context into a prompt.
   */
  compileHierarchicalPrompt(
    coreBeliefs: MemoryFact[],
    patterns: MemoryFact[],
    facts: MemoryFact[]
  ): string {
    const sections: string[] = [];

    if (coreBeliefs.length > 0) {
      sections.push("## CRITICAL (Never forget):");
      for (const f of coreBeliefs) {
        sections.push(`- ${f.predicate}: ${f.object}`);
      }
    }

    if (patterns.length > 0) {
      sections.push("\n## User Traits:");
      for (const f of patterns) {
        sections.push(`- ${f.object}`);
      }
    }

    if (facts.length > 0) {
      sections.push("\n## Specific Facts:");
      for (const f of facts) {
        sections.push(`- ${f.predicate}: ${f.object}`);
      }
    }

    return sections.join("\n");
  }

  /**
   * Promote fact to core_belief level.
   */
  async promoteToCore(
    userId: string,
    factId: string,
    reason?: string
  ): Promise<void> {
    await this.adapter.updateFact(userId, factId, {
      memoryLevel: "core_belief",
      metadata: { promotionReason: reason },
    });

    if (this.config.debug) {
      console.log(`[HMM] Promoted ${factId} to core_belief`);
    }
  }

  /**
   * Synthesize patterns from facts using LLM.
   * This is the "Deep Sleep" compression step.
   */
  async synthesizePatterns(userId: string): Promise<{
    patternsCreated: number;
    promotions: number;
    factsCompressed: number;
  }> {
    if (!this.provider) {
      return { patternsCreated: 0, promotions: 0, factsCompressed: 0 };
    }

    // Get Level 2 facts
    const facts = await this.getByLevel(userId, "fact");

    if (facts.length < this.config.minFactsForPattern) {
      return { patternsCreated: 0, promotions: 0, factsCompressed: 0 };
    }

    // Build prompt
    const factsText = facts
      .map((f) => `[${f.id}] ${f.predicate}: ${f.object}`)
      .join("\n");

    const prompt = PATTERN_SYNTHESIS_PROMPT.replace("{facts}", factsText);

    try {
      const result = await this.provider.complete({
        systemPrompt:
          "You synthesize patterns from user facts. Output only valid JSON.",
        userPrompt: prompt,
        maxTokens: 800,
        temperature: 0.3,
        jsonMode: true,
      });

      const parsed = JSON.parse(result.content);
      let patternsCreated = 0;
      let promotions = 0;
      let factsCompressed = 0;

      // Create patterns
      for (const pattern of parsed.patterns ?? []) {
        await this.adapter.upsertFact(userId, {
          subject: "User",
          predicate: pattern.predicate || "PATTERN",
          object: pattern.object,
          confidence: pattern.confidence || 0.8,
          importance: pattern.importance || 7,
          memoryLevel: "pattern",
          childrenIds: pattern.basedOnIds,
          source: "hmm-synthesis",
          invalidatedAt: null,
        });
        patternsCreated++;

        // Optionally archive the source facts (lower priority)
        for (const sourceId of pattern.basedOnIds ?? []) {
          await this.adapter.updateFact(userId, sourceId, {
            metadata: { compressedInto: "pattern", archivedAt: new Date() },
          });
          factsCompressed++;
        }
      }

      // Handle promotions
      for (const promo of parsed.promotions ?? []) {
        await this.promoteToCore(userId, promo.factId, promo.reason);
        promotions++;
      }

      if (this.config.debug) {
        console.log(
          `[HMM] Created ${patternsCreated} patterns, ${promotions} promotions`
        );
      }

      return { patternsCreated, promotions, factsCompressed };
    } catch (e) {
      if (this.config.debug) {
        console.error("[HMM] Synthesis failed:", e);
      }
      return { patternsCreated: 0, promotions: 0, factsCompressed: 0 };
    }
  }

  /**
   * Flush raw logs - extract facts and delete.
   */
  async flushRawLogs(userId: string): Promise<number> {
    const rawLogs = await this.getByLevel(userId, "raw_log");

    if (rawLogs.length < this.config.maxRawLogs) {
      return 0; // Not enough to flush
    }

    let flushed = 0;
    for (const log of rawLogs) {
      await this.adapter.hardDeleteFact(userId, log.id);
      flushed++;
    }

    if (this.config.debug) {
      console.log(`[HMM] Flushed ${flushed} raw logs`);
    }

    return flushed;
  }

  /**
   * Get compression statistics - shows efficiency of HMM.
   */
  async getCompressionStats(userId: string): Promise<{
    rawLogs: number;
    facts: number;
    patterns: number;
    coreBeliefs: number;
    compressionRatio: number;
  }> {
    const all = await this.adapter.getFacts(userId, { validOnly: true });

    const stats = {
      rawLogs: 0,
      facts: 0,
      patterns: 0,
      coreBeliefs: 0,
      compressionRatio: 0,
    };

    for (const f of all) {
      switch (f.memoryLevel ?? "fact") {
        case "raw_log":
          stats.rawLogs++;
          break;
        case "fact":
          stats.facts++;
          break;
        case "pattern":
          stats.patterns++;
          break;
        case "core_belief":
          stats.coreBeliefs++;
          break;
      }
    }

    // Compression ratio: how many facts were compressed into patterns
    const totalLowLevel = stats.rawLogs + stats.facts;
    const totalHighLevel = stats.patterns + stats.coreBeliefs;
    stats.compressionRatio =
      totalLowLevel > 0 ? totalHighLevel / totalLowLevel : 0;

    return stats;
  }
}
