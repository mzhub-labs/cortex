import type {
  MemoryFact,
  ConversationExchange,
  HydratedContext,
  HydrateOptions,
} from "../types";
import type { BaseAdapter } from "../adapters/BaseAdapter";
import { wrapContextSafely } from "../security";

export interface ContextHydratorConfig {
  /** Maximum number of facts to include in context */
  maxFacts?: number;
  /** Maximum number of recent messages to include */
  maxHistory?: number;
  /** Format style for compiled prompt */
  formatStyle?: "natural" | "structured" | "minimal";
  /** Minimum confidence threshold for facts (0-1) */
  minConfidence?: number;
  /** Wrap context in safety tags to prevent injection */
  safeMode?: boolean;
}

/**
 * The "Fast Brain" - Builds compiled context for LLM injection.
 * Runs synchronously before each LLM call.
 */
export class ContextHydrator {
  private adapter: BaseAdapter;
  private config: Required<ContextHydratorConfig>;

  constructor(adapter: BaseAdapter, config: ContextHydratorConfig = {}) {
    this.adapter = adapter;
    this.config = {
      maxFacts: config.maxFacts ?? 20,
      maxHistory: config.maxHistory ?? 5,
      formatStyle: config.formatStyle ?? "natural",
      minConfidence: config.minConfidence ?? 0.5, // Ignore low-confidence facts
      safeMode: config.safeMode ?? true, // Enable safety by default
    };
  }

  /**
   * Hydrate context for a user based on their message.
   *
   * Uses the "Amygdala pattern":
   * 1. CRITICAL facts (importance >= 9) are ALWAYS included
   * 2. Remaining budget filled with recent, high-confidence facts
   */
  async hydrate(
    userId: string,
    _message: string,
    options: HydrateOptions = {}
  ): Promise<HydratedContext> {
    const maxFacts = options.maxFacts ?? this.config.maxFacts;
    const maxHistory = options.maxHistory ?? this.config.maxHistory;
    const minConfidence = this.config.minConfidence;

    // Fetch all valid facts for this user (more than we need to filter)
    const allFacts = await this.adapter.getFacts(userId, {
      validOnly: true,
      limit: maxFacts * 3,
      orderBy: "updatedAt",
      orderDir: "desc",
      predicates: options.predicates,
    });

    // AMYGDALA PATTERN: Critical facts (importance >= 9) ALWAYS included
    // These are safety-critical: allergies, medical conditions, explicit boundaries
    const criticalFacts = allFacts.filter((f) => (f.importance ?? 5) >= 9);

    // Fill remaining budget with recent, high-confidence facts (not already critical)
    const criticalIds = new Set(criticalFacts.map((f) => f.id));
    const regularFacts = allFacts
      .filter((f) => !criticalIds.has(f.id))
      .filter((f) => (f.confidence ?? 0.8) >= minConfidence)
      .slice(0, maxFacts - criticalFacts.length);

    // Combine: critical first (for emphasis), then regular
    const facts = [...criticalFacts, ...regularFacts];

    // Track access for Hebbian learning (optional, fire-and-forget)
    this.recordAccess(userId, facts).catch(() => {});

    // Fetch recent conversation history
    const recentHistory = await this.adapter.getConversationHistory(
      userId,
      maxHistory
    );

    // Compile the context prompt
    let compiledPrompt = this.compilePrompt(facts, recentHistory);

    // Wrap in safety tags to prevent prompt injection via memory
    if (this.config.safeMode && compiledPrompt.length > 0) {
      compiledPrompt = wrapContextSafely(compiledPrompt);
    }

    // Estimate tokens (rough approximation: 1 token ≈ 4 chars)
    const estimatedTokens = Math.ceil(compiledPrompt.length / 4);

    return {
      compiledPrompt,
      facts,
      recentHistory,
      estimatedTokens,
      fromCache: false,
    };
  }

  /**
   * Record fact access for Hebbian learning (strengthens frequently used facts)
   */
  private async recordAccess(
    userId: string,
    facts: MemoryFact[]
  ): Promise<void> {
    const now = new Date();
    for (const fact of facts) {
      try {
        await this.adapter.updateFact(userId, fact.id, {
          accessCount: (fact.accessCount ?? 0) + 1,
          lastAccessedAt: now,
        });
      } catch {
        // Ignore errors - this is a non-critical optimization
      }
    }
  }

  /**
   * Compile facts and history into a prompt string
   */
  private compilePrompt(
    facts: MemoryFact[],
    history: ConversationExchange[]
  ): string {
    switch (this.config.formatStyle) {
      case "structured":
        return this.compileStructured(facts, history);
      case "minimal":
        return this.compileMinimal(facts);
      case "natural":
      default:
        return this.compileNatural(facts, history);
    }
  }

  /**
   * Natural language format (default)
   */
  private compileNatural(
    facts: MemoryFact[],
    history: ConversationExchange[]
  ): string {
    const sections: string[] = [];

    // User profile from facts
    if (facts.length > 0) {
      const profile = this.groupFactsBySubject(facts);
      const userFacts = profile.get("User");

      if (userFacts && userFacts.length > 0) {
        const factStrings = userFacts.map((f) => this.factToNaturalLanguage(f));
        sections.push(`About the user: ${factStrings.join(". ")}.`);
      }

      // Other entities
      for (const [subject, subjectFacts] of profile) {
        if (subject === "User") continue;
        const factStrings = subjectFacts.map(
          (f) => `${f.predicate.toLowerCase().replace(/_/g, " ")}: ${f.object}`
        );
        sections.push(`${subject}: ${factStrings.join(", ")}.`);
      }
    }

    // Recent context
    if (history.length > 0) {
      const historyText = history
        .slice()
        .reverse() // Oldest first
        .map((h) => `User asked about: "${this.truncate(h.userMessage, 50)}"`)
        .join(". ");
      sections.push(`Recent topics: ${historyText}.`);
    }

    return sections.join("\n\n");
  }

  /**
   * Structured format (for debugging or specific use cases)
   */
  private compileStructured(
    facts: MemoryFact[],
    history: ConversationExchange[]
  ): string {
    const sections: string[] = [];

    if (facts.length > 0) {
      sections.push("## User Profile");
      for (const fact of facts) {
        sections.push(`- ${fact.subject}.${fact.predicate}: ${fact.object}`);
      }
    }

    if (history.length > 0) {
      sections.push("\n## Recent Conversation");
      for (const h of history.slice().reverse()) {
        sections.push(`User: ${this.truncate(h.userMessage, 100)}`);
        sections.push(`Assistant: ${this.truncate(h.assistantResponse, 100)}`);
      }
    }

    return sections.join("\n");
  }

  /**
   * Minimal format (just facts, no history)
   */
  private compileMinimal(facts: MemoryFact[]): string {
    if (facts.length === 0) return "";

    return facts.map((f) => `${f.predicate}: ${f.object}`).join("; ");
  }

  /**
   * Convert a fact to natural language
   */
  private factToNaturalLanguage(fact: MemoryFact): string {
    const predicate = fact.predicate.toLowerCase().replace(/_/g, " ");
    const object = fact.object;

    // Special handling for common predicates
    const templates: Record<string, string> = {
      name: `their name is ${object}`,
      location: `they live in ${object}`,
      works_at: `they work at ${object}`,
      job_title: `they are a ${object}`,
      diet: `they are ${object.toLowerCase()}`,
      has_allergy: `they are allergic to ${object}`,
      prefers: `they prefer ${object}`,
      uses_tech: `they use ${object}`,
      speaks_language: `they speak ${object}`,
      birthday: `their birthday is ${object}`,
      spouse: `their spouse is ${object}`,
      working_on: `they are working on ${object}`,
    };

    const key = fact.predicate.toLowerCase();
    return templates[key] || `${predicate}: ${object}`;
  }

  /**
   * Group facts by subject
   */
  private groupFactsBySubject(facts: MemoryFact[]): Map<string, MemoryFact[]> {
    const grouped = new Map<string, MemoryFact[]>();

    for (const fact of facts) {
      const existing = grouped.get(fact.subject) || [];
      existing.push(fact);
      grouped.set(fact.subject, existing);
    }

    return grouped;
  }

  /**
   * Truncate text to a maximum length
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + "...";
  }
}
