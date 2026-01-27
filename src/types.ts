
export interface MemoryFact {
  /** Unique identifier (UUID) */
  id: string;
  /** The entity (e.g., "User", "Project:WebApp") */
  subject: string;
  /** The relationship (e.g., "HAS_ALLERGY", "PREFERS", "WORKS_AT") */
  predicate: string;
  /** The value (e.g., "Peanuts", "Dark Mode", "Acme Corp") */
  object: string;
  /** Confidence score 0-1 */
  confidence: number;
  /**
   * Importance score 1-10 (Amygdala pattern)
   * 1-3: Trivia (preferences, minor details)
   * 4-6: Standard (work, location, relationships)
   * 7-8: Important (strong preferences, constraints)
   * 9-10: Critical (allergies, safety, medical, boundaries)
   */
  importance: number;
  /** Conversation ID that created/updated this fact */
  source: string;
  /** Specific conversation exchange ID for episodic linking */
  sourceConversationId?: string;
  /** When this fact was first created */
  createdAt: Date;
  /** When this fact was last updated */
  updatedAt: Date;
  /** When this fact was superseded (null if still valid) */
  invalidatedAt: Date | null;
  /** Number of times this fact has been accessed (Hebbian learning) */
  accessCount?: number;
  /** Last time this fact was accessed */
  lastAccessedAt?: Date;

  // =========================================================================
  // Advanced Brain Components
  // =========================================================================

  /**
   * Emotional context when fact was learned (Emotional Coloring)
   * Tracks whether the fact was learned in a positive or negative context
   */
  sentiment?: "positive" | "negative" | "neutral";
  /** Description of the emotional context */
  emotionalContext?: string;

  /**
   * Memory consolidation stage (Memory Consolidation Levels)
   * - short-term: Just learned, may not persist
   * - working: Being actively used, intermediate storage
   * - long-term: Consolidated through reinforcement
   */
  memoryStage?: "short-term" | "working" | "long-term";

  /**
   * IDs of related facts (Associative Linking / Knowledge Graph)
   * Creates connections between facts for richer context
   */
  relatedFactIds?: string[];

  /**
   * Vector embedding for semantic search (Attention Filtering)
   * Stored as array of numbers for similarity matching
   */
  embedding?: number[];

  // =========================================================================
  // Hierarchical Memory Modeling (HMM) - Optional
  // =========================================================================

  /**
   * Memory level in the hierarchy pyramid:
   * - raw_log: Raw conversation data (ephemeral, auto-deleted)
   * - fact: Specific discrete facts (your normal facts)
   * - pattern: Synthesized patterns/traits from multiple facts
   * - core_belief: Unchangeable truths, always loaded (allergies, identity)
   */
  memoryLevel?: "raw_log" | "fact" | "pattern" | "core_belief";

  /**
   * IDs of lower-level facts that this pattern/belief was derived from.
   * Creates provenance chain for "why do I believe this?"
   */
  childrenIds?: string[];

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A memory operation for updating the fact graph
 */
export interface MemoryOperation {
  /** Operation type */
  op: "INSERT" | "UPDATE" | "DELETE";
  /** The entity */
  subject: string;
  /** The relationship */
  predicate: string;
  /** The value */
  object: string;
  /** Reason for this operation (especially for DELETEs) */
  reason?: string;
  /** Confidence score 0-1 */
  confidence?: number;
  /** Importance score 1-10 (for safety-critical facts) */
  importance?: number;
  /** Sentiment context when fact was learned */
  sentiment?: "positive" | "negative" | "neutral";
}

/**
 * Result from the fact extraction LLM
 */
export interface ExtractionResult {
  /** List of operations to apply */
  operations: MemoryOperation[];
  /** Reasoning for the extractions */
  reasoning?: string;
}

// ============================================================================
// Conversation & Session
// ============================================================================

/**
 * A single message in a conversation
 */
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

/**
 * A conversation exchange (user message + assistant response)
 */
export interface ConversationExchange {
  id: string;
  userId: string;
  sessionId: string;
  userMessage: string;
  assistantResponse: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Session information
 */
export interface Session {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  messageCount: number;
  summary?: string;
}

// ============================================================================
// Hydration & Context
// ============================================================================

/**
 * Result from hydrating context before an LLM call
 */
export interface HydratedContext {
  /** Compiled prompt ready for injection into system message */
  compiledPrompt: string;
  /** Raw facts that were retrieved */
  facts: MemoryFact[];
  /** Recent conversation history */
  recentHistory: ConversationExchange[];
  /** Token estimate for the compiled context */
  estimatedTokens: number;
  /** Whether this was served from cache */
  fromCache: boolean;
}

/**
 * Options for hydration
 */
export interface HydrateOptions {
  /** Maximum number of facts to include */
  maxFacts?: number;
  /** Maximum number of recent messages to include */
  maxHistory?: number;
  /** Specific predicates to filter for */
  predicates?: string[];
  /** Whether to include invalidated facts */
  includeInvalidated?: boolean;
}

// ============================================================================
// LLM Provider Types
// ============================================================================

/**
 * Options for LLM completion
 */
export interface CompletionOptions {
  /** System prompt */
  systemPrompt: string;
  /** User prompt */
  userPrompt: string;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Temperature (0-1, lower = more deterministic) */
  temperature?: number;
  /** Force JSON output mode */
  jsonMode?: boolean;
}

/**
 * Result from LLM completion
 */
export interface CompletionResult {
  /** The generated content */
  content: string;
  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Supported LLM providers
 */
export type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "cerebras";

/**
 * LLM provider configuration
 */
export interface ProviderConfig {
  /** Provider name */
  provider: ProviderName;
  /** API key */
  apiKey: string;
  /** Model to use (each provider has its own default) */
  model?: string;
  /** Base URL override (for proxies or self-hosted) */
  baseUrl?: string;
}

// ============================================================================
// Storage Adapter Types
// ============================================================================

/**
 * Filter options for querying facts
 */
export interface FactFilter {
  /** Filter by subject */
  subject?: string;
  /** Filter by predicate */
  predicate?: string;
  /** Filter by predicates (OR) */
  predicates?: string[];
  /** Only valid (non-invalidated) facts */
  validOnly?: boolean;
  /** Limit number of results */
  limit?: number;
  /** Order by field */
  orderBy?: "createdAt" | "updatedAt" | "confidence";
  /** Order direction */
  orderDir?: "asc" | "desc";
}

// ============================================================================
// MemoryOS Configuration
// ============================================================================

/**
 * Options for MemoryOS behavior
 */
export interface MemoryOSOptions {
  /** Auto-summarize conversations after this many messages */
  autoSummarizeAfter?: number;
  /** Conflict resolution strategy */
  conflictStrategy?: "latest" | "merge" | "keep_both";
  /** Enable semantic caching */
  enableCache?: boolean;
  /** Cache TTL in seconds */
  cacheTtl?: number;
  /** Debug mode */
  debug?: boolean;
}

/**
 * Full MemoryOS configuration
 */
export interface MemoryOSConfig {
  /** LLM provider configuration */
  llm: ProviderConfig;
  /** Storage adapter options */
  adapter?: unknown; // Type defined in adapters module
  /** Hot cache adapter (optional) */
  hotAdapter?: unknown;
  /** Cold storage adapter (optional) */
  coldAdapter?: unknown;
  /** Behavioral options */
  options?: MemoryOSOptions;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Events emitted by MemoryOS
 */
export interface MemoryOSEvents {
  "fact:created": (fact: MemoryFact) => void;
  "fact:updated": (fact: MemoryFact, oldFact: MemoryFact) => void;
  "fact:deleted": (fact: MemoryFact, reason: string) => void;
  "session:start": (session: Session) => void;
  "session:end": (session: Session) => void;
  "extraction:complete": (result: ExtractionResult) => void;
  error: (error: Error) => void;
}
