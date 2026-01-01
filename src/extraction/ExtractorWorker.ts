import type { MemoryFact, ExtractionResult, MemoryOperation } from "../types";
import type { BaseAdapter } from "../adapters/BaseAdapter";
import type { BaseProvider } from "../providers/BaseProvider";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from "./prompts";
import {
  ConflictResolver,
  validateExtractionResult,
  type ConflictStrategy,
} from "./ConflictResolver";

export interface ExtractorWorkerConfig {
  /** Minimum confidence threshold for facts (0-1) */
  minConfidence?: number;
  /** Conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;
  /** Enable debug logging */
  debug?: boolean;
}

interface ExtractionTask {
  userId: string;
  sessionId: string;
  userMessage: string;
  assistantResponse: string;
  timestamp: Date;
}

/**
 * The "Slow Brain" - Background worker that extracts facts from conversations.
 * Runs asynchronously after responses are sent to users.
 */
export class ExtractorWorker {
  private provider: BaseProvider;
  private adapter: BaseAdapter;
  private conflictResolver: ConflictResolver;
  private minConfidence: number;
  private debug: boolean;

  // Simple in-memory queue for background processing
  private queue: ExtractionTask[] = [];
  private processing = false;

  constructor(
    provider: BaseProvider,
    adapter: BaseAdapter,
    config: ExtractorWorkerConfig = {}
  ) {
    this.provider = provider;
    this.adapter = adapter;
    this.minConfidence = config.minConfidence ?? 0.5;
    this.conflictResolver = new ConflictResolver(
      config.conflictStrategy ?? "latest"
    );
    this.debug = config.debug ?? false;
  }

  /**
   * Queue a conversation exchange for background extraction.
   * This method returns immediately (non-blocking).
   */
  enqueue(
    userId: string,
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): void {
    this.queue.push({
      userId,
      sessionId,
      userMessage,
      assistantResponse,
      timestamp: new Date(),
    });

    // Start processing if not already running
    if (!this.processing) {
      this.processQueue().catch((err) => {
        if (this.debug) {
          console.error("[ExtractorWorker] Queue processing error:", err);
        }
      });
    }
  }

  /**
   * Process the extraction queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task) continue;

        try {
          await this.processTask(task);
        } catch (err) {
          if (this.debug) {
            console.error("[ExtractorWorker] Task error:", err);
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single extraction task
   */
  private async processTask(task: ExtractionTask): Promise<ExtractionResult> {
    const { userId, sessionId, userMessage, assistantResponse } = task;

    if (this.debug) {
      console.log(`[ExtractorWorker] Processing task for user: ${userId}`);
    }

    // Get current facts for context
    const currentFacts = await this.adapter.getFacts(userId, {
      validOnly: true,
      limit: 50, // Limit to avoid token bloat
    });

    // Build the extraction prompt
    const factsForPrompt = currentFacts.map((f) => ({
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
    }));

    const conversation = [
      { role: "user" as const, content: userMessage },
      { role: "assistant" as const, content: assistantResponse },
    ];

    const userPrompt = buildExtractionPrompt(factsForPrompt, conversation);

    // Call the LLM
    const completion = await this.provider.complete({
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1000,
      temperature: 0.2, // Low temperature for consistent extraction
      jsonMode: true,
    });

    if (this.debug) {
      console.log(`[ExtractorWorker] LLM response:`, completion.content);
    }

    // Parse and validate the result
    let rawResult: unknown;
    try {
      rawResult = JSON.parse(completion.content);
    } catch {
      if (this.debug) {
        console.error("[ExtractorWorker] Failed to parse LLM response as JSON");
      }
      return { operations: [] };
    }

    const extractionResult = validateExtractionResult(rawResult);

    if (this.debug) {
      console.log(
        `[ExtractorWorker] Extracted ${extractionResult.operations.length} operations`
      );
    }

    // Filter by confidence threshold
    const confidentOperations = extractionResult.operations.filter(
      (op) => (op.confidence ?? 0.8) >= this.minConfidence
    );

    if (confidentOperations.length === 0) {
      return { operations: [], reasoning: extractionResult.reasoning };
    }

    // Resolve conflicts
    const { resolvedOperations } = await this.conflictResolver.resolve(
      userId,
      confidentOperations,
      this.adapter
    );

    // Apply operations to the adapter
    await this.applyOperations(userId, sessionId, resolvedOperations);

    return {
      operations: resolvedOperations,
      reasoning: extractionResult.reasoning,
    };
  }

  /**
   * Apply memory operations to the storage adapter
   */
  private async applyOperations(
    userId: string,
    sessionId: string,
    operations: MemoryOperation[]
  ): Promise<MemoryFact[]> {
    const appliedFacts: MemoryFact[] = [];

    for (const op of operations) {
      try {
        if (op.op === "DELETE") {
          // Find and soft-delete the matching fact
          const facts = await this.adapter.getFacts(userId, {
            subject: op.subject,
            predicate: op.predicate,
            validOnly: true,
          });

          const matchingFact = facts.find((f) => f.object === op.object);
          if (matchingFact) {
            await this.adapter.deleteFact(userId, matchingFact.id, op.reason);
          }
        } else {
          // INSERT or UPDATE
          // Auto-escalate importance for safety-critical predicates
          const importance = this.getEffectiveImportance(op);

          const fact = await this.adapter.upsertFact(userId, {
            subject: op.subject,
            predicate: op.predicate,
            object: op.object,
            confidence: op.confidence ?? 0.8,
            importance,
            sentiment: op.sentiment,
            memoryStage: "short-term", // New facts start in short-term
            source: sessionId,
            invalidatedAt: null,
          });
          appliedFacts.push(fact);
        }
      } catch (err) {
        if (this.debug) {
          console.error(
            `[ExtractorWorker] Failed to apply operation:`,
            op,
            err
          );
        }
      }
    }

    return appliedFacts;
  }

  /**
   * Extract facts immediately (synchronous, for testing)
   */
  async extractNow(
    userId: string,
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<ExtractionResult> {
    return this.processTask({
      userId,
      sessionId,
      userMessage,
      assistantResponse,
      timestamp: new Date(),
    });
  }

  /**
   * Get the current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if the worker is currently processing
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Wait for all queued tasks to complete
   */
  async drain(): Promise<void> {
    while (this.queue.length > 0 || this.processing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Get effective importance for an operation.
   * Auto-escalates safety-critical predicates (allergies, medical, boundaries).
   */
  private getEffectiveImportance(op: MemoryOperation): number {
    const providedImportance = op.importance ?? 5;

    // Safety-critical predicates MUST be >= 9
    const safetyPredicates = [
      "HAS_ALLERGY",
      "ALLERGY",
      "ALLERGIC_TO",
      "MEDICAL_CONDITION",
      "MEDICAL",
      "DISABILITY",
      "DO_NOT",
      "NEVER",
      "BOUNDARY",
      "EMERGENCY_CONTACT",
      "BLOOD_TYPE",
    ];

    const upperPredicate = op.predicate.toUpperCase();
    const isSafetyCritical = safetyPredicates.some((sp) =>
      upperPredicate.includes(sp)
    );

    if (isSafetyCritical && providedImportance < 9) {
      return 9; // Auto-escalate to critical
    }

    return providedImportance;
  }
}
