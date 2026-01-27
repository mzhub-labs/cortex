import type { MemoryFact, MemoryOperation, ExtractionResult } from "../types";
import type { BaseAdapter } from "../adapters/BaseAdapter";

export interface ConflictResolutionResult {
  /** Operations to apply after conflict resolution */
  resolvedOperations: MemoryOperation[];
  /** Conflicts that were detected and resolved */
  conflicts: Array<{
    existingFact: MemoryFact;
    newOperation: MemoryOperation;
    resolution: "replace" | "keep_both" | "merge" | "ignore";
  }>;
}

export type ConflictStrategy = "latest" | "keep_both" | "merge";

/**
 * Resolves conflicts between new operations and existing facts.
 * Implements the conflict resolution logic for the memory graph.
 */
export class ConflictResolver {
  private strategy: ConflictStrategy;

  constructor(strategy: ConflictStrategy = "latest") {
    this.strategy = strategy;
  }

  /**
   * Resolve conflicts between new operations and existing facts
   */
  async resolve(
    userId: string,
    operations: MemoryOperation[],
    adapter: BaseAdapter,
  ): Promise<ConflictResolutionResult> {
    const resolvedOperations: MemoryOperation[] = [];
    const conflicts: ConflictResolutionResult["conflicts"] = [];

    // Get current facts for the user
    const existingFacts = await adapter.getFacts(userId, { validOnly: true });

    for (const op of operations) {
      if (op.op === "DELETE") {
        // DELETE operations are passed through as-is
        resolvedOperations.push(op);
        continue;
      }

      // Check for existing fact with same subject + predicate
      const existingFact = existingFacts.find(
        (f) => f.subject === op.subject && f.predicate === op.predicate,
      );

      if (!existingFact) {
        // No conflict, pass through
        resolvedOperations.push(op);
        continue;
      }

      // We have a potential conflict
      if (existingFact.object === op.object) {
        // Same value, no conflict - skip the operation
        continue;
      }

      // Different value - apply conflict strategy
      switch (this.strategy) {
        case "latest":
          // Delete old, insert new
          conflicts.push({
            existingFact,
            newOperation: op,
            resolution: "replace",
          });
          resolvedOperations.push({
            op: "DELETE",
            subject: existingFact.subject,
            predicate: existingFact.predicate,
            object: existingFact.object,
            reason: `Replaced by new value: ${op.object}`,
          });
          resolvedOperations.push(op);
          break;

        case "keep_both":
          // Keep both values (for multi-valued predicates)
          conflicts.push({
            existingFact,
            newOperation: op,
            resolution: "keep_both",
          });
          resolvedOperations.push(op);
          break;

        case "merge":
          // For now, merge is the same as latest
          // Future: could implement smarter merging for certain predicates
          conflicts.push({
            existingFact,
            newOperation: op,
            resolution: "merge",
          });
          resolvedOperations.push({
            op: "DELETE",
            subject: existingFact.subject,
            predicate: existingFact.predicate,
            object: existingFact.object,
            reason: `Merged with new value: ${op.object}`,
          });
          resolvedOperations.push(op);
          break;
      }
    }

    return { resolvedOperations, conflicts };
  }

  /**
   * Check if a predicate should allow multiple values
   * (e.g., USES_TECH can have multiple values, but LOCATION should not)
   */
  isMultiValuePredicate(predicate: string): boolean {
    const multiValuePredicates = [
      "USES_TECH",
      "SPEAKS_LANGUAGE",
      "HAS_HOBBY",
      "KNOWS_PERSON",
      "WORKING_ON",
      "INTERESTED_IN",
      "SKILL",
    ];
    return multiValuePredicates.includes(predicate.toUpperCase());
  }
}

/**
 * Validate and sanitize extraction results from the LLM
 */
export function validateExtractionResult(raw: unknown): ExtractionResult {
  if (!raw || typeof raw !== "object") {
    return { operations: [], reasoning: "Invalid extraction result" };
  }

  const result = raw as Record<string, unknown>;

  if (!Array.isArray(result.operations)) {
    return { operations: [], reasoning: "No operations found" };
  }

  const validOperations: MemoryOperation[] = [];

  for (const op of result.operations) {
    if (!op || typeof op !== "object") continue;

    const operation = op as Record<string, unknown>;

    // Validate required fields
    if (
      typeof operation.op !== "string" ||
      !["INSERT", "UPDATE", "DELETE"].includes(operation.op)
    ) {
      continue;
    }

    if (typeof operation.subject !== "string" || !operation.subject.trim()) {
      continue;
    }

    if (
      typeof operation.predicate !== "string" ||
      !operation.predicate.trim()
    ) {
      continue;
    }

    if (typeof operation.object !== "string" || !operation.object.trim()) {
      continue;
    }

    validOperations.push({
      op: operation.op as "INSERT" | "UPDATE" | "DELETE",
      subject: operation.subject.trim(),
      predicate: operation.predicate.trim().toUpperCase().replace(/\s+/g, "_"),
      object: operation.object.trim(),
      reason:
        typeof operation.reason === "string" ? operation.reason : undefined,
      confidence:
        typeof operation.confidence === "number"
          ? Math.max(0, Math.min(1, operation.confidence))
          : 0.8,
      importance:
        typeof operation.importance === "number"
          ? Math.max(1, Math.min(10, operation.importance))
          : 5,
      sentiment:
        typeof operation.sentiment === "string" &&
        ["positive", "negative", "neutral"].includes(operation.sentiment)
          ? (operation.sentiment as "positive" | "negative" | "neutral")
          : undefined,
    });
  }

  return {
    operations: validOperations,
    reasoning:
      typeof result.reasoning === "string" ? result.reasoning : undefined,
  };
}
