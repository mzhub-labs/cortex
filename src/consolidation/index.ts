/**
 * Memory Consolidation Worker
 *
 * Implements the three-stage memory model:
 * - Short-term: Just learned, may not persist (< 1 hour, < 2 accesses)
 * - Working: Being actively used (1-24 hours, 2-5 accesses)
 * - Long-term: Consolidated through reinforcement (> 24 hours, > 5 accesses)
 *
 * Facts progress through stages based on time and access patterns.
 */

import type { MemoryFact } from "../types";
import type { BaseAdapter } from "../adapters/BaseAdapter";

export interface ConsolidationConfig {
  /** Hours before short-term can become working (default: 1) */
  shortTermHours?: number;
  /** Hours before working can become long-term (default: 24) */
  workingHours?: number;
  /** Access count to promote short-term → working (default: 2) */
  workingAccessThreshold?: number;
  /** Access count to promote working → long-term (default: 5) */
  longTermAccessThreshold?: number;
  /** Enable debug logging */
  debug?: boolean;
}

type MemoryStage = "short-term" | "working" | "long-term";

/**
 * Manages memory consolidation through the three-stage model.
 */
export class ConsolidationWorker {
  private adapter: BaseAdapter;
  private config: Required<ConsolidationConfig>;

  constructor(adapter: BaseAdapter, config: ConsolidationConfig = {}) {
    this.adapter = adapter;
    this.config = {
      shortTermHours: config.shortTermHours ?? 1,
      workingHours: config.workingHours ?? 24,
      workingAccessThreshold: config.workingAccessThreshold ?? 2,
      longTermAccessThreshold: config.longTermAccessThreshold ?? 5,
      debug: config.debug ?? false,
    };
  }

  /**
   * Determine what stage a fact should be in based on age and access.
   */
  determineStage(fact: MemoryFact): MemoryStage {
    const now = Date.now();
    const ageMs = now - fact.createdAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const accessCount = fact.accessCount ?? 0;

    // Long-term: Old enough AND accessed enough
    if (
      ageHours >= this.config.workingHours &&
      accessCount >= this.config.longTermAccessThreshold
    ) {
      return "long-term";
    }

    // Working: Either old enough OR accessed enough
    if (
      ageHours >= this.config.shortTermHours ||
      accessCount >= this.config.workingAccessThreshold
    ) {
      return "working";
    }

    // Short-term: New and not accessed much
    return "short-term";
  }

  /**
   * Run consolidation for a user's facts.
   * Promotes facts through stages based on age and access patterns.
   */
  async consolidate(userId: string): Promise<{
    promoted: number;
    demoted: number;
    unchanged: number;
  }> {
    const facts = await this.adapter.getFacts(userId, { validOnly: true });

    let promoted = 0;
    let demoted = 0;
    let unchanged = 0;

    for (const fact of facts) {
      const currentStage = fact.memoryStage ?? "short-term";
      const targetStage = this.determineStage(fact);

      if (currentStage !== targetStage) {
        await this.adapter.updateFact(userId, fact.id, {
          memoryStage: targetStage,
        });

        const stageOrder: Record<MemoryStage, number> = {
          "short-term": 0,
          working: 1,
          "long-term": 2,
        };

        if (stageOrder[targetStage] > stageOrder[currentStage]) {
          promoted++;
          if (this.config.debug) {
            console.log(
              `[Consolidation] ${fact.predicate}: ${currentStage} → ${targetStage}`
            );
          }
        } else {
          demoted++;
        }
      } else {
        unchanged++;
      }
    }

    return { promoted, demoted, unchanged };
  }

  /**
   * Get facts filtered by memory stage.
   */
  async getFactsByStage(
    userId: string,
    stage: MemoryStage
  ): Promise<MemoryFact[]> {
    const facts = await this.adapter.getFacts(userId, { validOnly: true });
    return facts.filter((f) => (f.memoryStage ?? "short-term") === stage);
  }

  /**
   * Automatically prune short-term facts that haven't been accessed.
   * Call this periodically to clean up ephemeral memories.
   */
  async pruneShortTerm(
    userId: string,
    maxAgeHours: number = 24
  ): Promise<number> {
    const facts = await this.getFactsByStage(userId, "short-term");
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;

    let pruned = 0;
    for (const fact of facts) {
      if (fact.createdAt.getTime() < cutoff && (fact.accessCount ?? 0) === 0) {
        await this.adapter.deleteFact(userId, fact.id, "short-term-expired");
        pruned++;
      }
    }

    return pruned;
  }
}
