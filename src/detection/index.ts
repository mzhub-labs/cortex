/**
 * Contradiction Detection
 *
 * Detects when new facts conflict with existing facts in real-time.
 * Can be used to:
 * 1. Automatically resolve conflicts
 * 2. Flag for user clarification
 * 3. Emit events for logging/debugging
 */

import type { MemoryFact, MemoryOperation } from "../types";
import type { BaseAdapter } from "../adapters/BaseAdapter";
import type { BaseProvider } from "../providers/BaseProvider";

export interface ContradictionConfig {
  /** Whether to auto-resolve contradictions (default: true) */
  autoResolve?: boolean;
  /** Use LLM to detect semantic contradictions (default: false) */
  useLLM?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

export interface Contradiction {
  /** The new fact attempting to be stored */
  newFact: MemoryOperation;
  /** The existing fact it conflicts with */
  existingFact: MemoryFact;
  /** Type of contradiction */
  type: "direct" | "semantic" | "temporal";
  /** Confidence that this is a real contradiction (0-1) */
  confidence: number;
  /** Description of the contradiction */
  description: string;
}

export interface ContradictionResult {
  /** Whether contradictions were found */
  hasContradictions: boolean;
  /** List of detected contradictions */
  contradictions: Contradiction[];
  /** Suggested resolution */
  resolution?: "replace" | "keep" | "merge" | "clarify";
}

const CONTRADICTION_PROMPT = `You are analyzing two facts for contradiction.

Existing fact: {existing}
New fact: {new}

Determine if these facts contradict each other.
- Direct contradiction: Same property with different values (e.g., "lives in NYC" vs "lives in LA")
- Semantic contradiction: Logically incompatible (e.g., "is vegan" vs "loves steak")
- Temporal contradiction: Time-based conflict (e.g., "will meet on Monday" when it's now Tuesday)

Output JSON:
{
  "isContradiction": true/false,
  "type": "direct" | "semantic" | "temporal" | "none",
  "confidence": 0.0-1.0,
  "reasoning": "explanation"
}`;

/**
 * Detects contradictions between new and existing facts.
 */
export class ContradictionDetector {
  private adapter: BaseAdapter;
  private provider?: BaseProvider;
  private config: Required<ContradictionConfig>;

  constructor(
    adapter: BaseAdapter,
    provider?: BaseProvider,
    config: ContradictionConfig = {}
  ) {
    this.adapter = adapter;
    this.provider = provider;
    this.config = {
      autoResolve: config.autoResolve ?? true,
      useLLM: config.useLLM ?? false,
      debug: config.debug ?? false,
    };
  }

  /**
   * Check if a new operation contradicts existing facts.
   */
  async check(
    userId: string,
    operation: MemoryOperation
  ): Promise<ContradictionResult> {
    if (operation.op === "DELETE") {
      return { hasContradictions: false, contradictions: [] };
    }

    // Get existing facts with the same predicate
    const existingFacts = await this.adapter.getFacts(userId, {
      subject: operation.subject,
      predicate: operation.predicate,
      validOnly: true,
    });

    const contradictions: Contradiction[] = [];

    for (const existing of existingFacts) {
      // Direct contradiction: same subject+predicate, different object
      if (existing.object !== operation.object) {
        // Check if this is truly a contradiction or an update
        const contradiction = await this.analyzeContradiction(
          operation,
          existing
        );

        if (contradiction) {
          contradictions.push(contradiction);
        }
      }
    }

    // Determine resolution strategy
    let resolution: ContradictionResult["resolution"];
    if (contradictions.length > 0) {
      if (this.config.autoResolve) {
        resolution = "replace"; // Default: new fact wins
      } else {
        resolution = "clarify"; // Ask user
      }
    }

    return {
      hasContradictions: contradictions.length > 0,
      contradictions,
      resolution,
    };
  }

  /**
   * Analyze if two facts are truly contradictory.
   */
  private async analyzeContradiction(
    newOp: MemoryOperation,
    existing: MemoryFact
  ): Promise<Contradiction | null> {
    // For single-value predicates, different values = contradiction
    const singleValuePredicates = [
      "NAME",
      "LOCATION",
      "DIET",
      "WORKS_AT",
      "JOB_TITLE",
      "SPOUSE",
      "BIRTHDAY",
      "TIMEZONE",
      "EMAIL",
      "PHONE",
    ];

    const predUpper = newOp.predicate.toUpperCase();

    if (singleValuePredicates.includes(predUpper)) {
      return {
        newFact: newOp,
        existingFact: existing,
        type: "direct",
        confidence: 0.95,
        description: `${predUpper} changed from "${existing.object}" to "${newOp.object}"`,
      };
    }

    // For multi-value predicates (like allergies), check semantic conflict
    if (this.config.useLLM && this.provider) {
      return this.checkSemanticContradiction(newOp, existing);
    }

    // Simple heuristic: if values are very different, flag as potential contradiction
    if (existing.object.toLowerCase() !== newOp.object.toLowerCase()) {
      return {
        newFact: newOp,
        existingFact: existing,
        type: "direct",
        confidence: 0.7,
        description: `Possible conflict: "${existing.object}" vs "${newOp.object}"`,
      };
    }

    return null;
  }

  /**
   * Use LLM to detect semantic contradictions.
   */
  private async checkSemanticContradiction(
    newOp: MemoryOperation,
    existing: MemoryFact
  ): Promise<Contradiction | null> {
    if (!this.provider) return null;

    const prompt = CONTRADICTION_PROMPT.replace(
      "{existing}",
      `${existing.subject}.${existing.predicate}: ${existing.object}`
    ).replace("{new}", `${newOp.subject}.${newOp.predicate}: ${newOp.object}`);

    try {
      const result = await this.provider.complete({
        systemPrompt:
          "You detect contradictions between facts. Output only valid JSON.",
        userPrompt: prompt,
        maxTokens: 200,
        temperature: 0.1,
        jsonMode: true,
      });

      const analysis = JSON.parse(result.content);

      if (analysis.isContradiction) {
        return {
          newFact: newOp,
          existingFact: existing,
          type: analysis.type || "semantic",
          confidence: analysis.confidence || 0.8,
          description: analysis.reasoning || "LLM detected contradiction",
        };
      }
    } catch (e) {
      if (this.config.debug) {
        console.error("[ContradictionDetector] LLM check failed:", e);
      }
    }

    return null;
  }

  /**
   * Check multiple operations at once.
   */
  async checkBatch(
    userId: string,
    operations: MemoryOperation[]
  ): Promise<Map<number, ContradictionResult>> {
    const results = new Map<number, ContradictionResult>();

    for (let i = 0; i < operations.length; i++) {
      const result = await this.check(userId, operations[i]);
      if (result.hasContradictions) {
        results.set(i, result);
      }
    }

    return results;
  }
}
