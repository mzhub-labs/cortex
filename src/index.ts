// Main export
export { MemoryOS } from "./MemoryOS";
export type { MemoryOSConfig } from "./MemoryOS";

// Types
export type {
  MemoryFact,
  MemoryOperation,
  ExtractionResult,
  Message,
  ConversationExchange,
  Session,
  HydratedContext,
  HydrateOptions,
  CompletionOptions,
  CompletionResult,
  ProviderName,
  ProviderConfig,
  FactFilter,
  MemoryOSOptions,
  MemoryOSEvents,
} from "./types";

// Adapters
export {
  BaseAdapter,
  InMemoryAdapter,
  JSONFileAdapter,
  MongoDBAdapter,
  PostgresAdapter,
  UpstashRedisAdapter,
} from "./adapters";
export type {
  JSONFileAdapterConfig,
  MongoDBAdapterConfig,
  PostgresAdapterConfig,
  UpstashRedisAdapterConfig,
} from "./adapters";

// Providers
export {
  BaseProvider,
  createProvider,
  getAvailableProviders,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  GroqProvider,
  CerebrasProvider,
} from "./providers";

// Extraction (Slow Brain)
export { ExtractorWorker, ConflictResolver } from "./extraction";
export type { ConflictStrategy } from "./extraction";

// Retrieval (Fast Brain)
export { ContextHydrator, SemanticCache } from "./retrieval";
export type { SemanticCacheConfig } from "./retrieval";

// Token Economics
export {
  estimateTokens,
  estimateCost,
  compressConversation,
  TokenTracker,
  TOKEN_PRICING,
} from "./utils";
export type { TokenUsage, TokenAnalytics } from "./utils";

// Middleware
export {
  createMemoryMiddleware,
  digestAfterResponse,
  withMemory,
} from "./middleware";
export type { MemoryMiddlewareOptions } from "./middleware";

// Events
export { MemoryEventEmitter } from "./events";
export type { MemoryEvents } from "./events";

// Security
export {
  SecurityScanner,
  wrapContextSafely,
  sanitizeForStorage,
} from "./security";
export type { SecurityConfig, SecurityCheckResult } from "./security";

// Budget Management
export { BudgetManager } from "./budget";
export type { BudgetConfig } from "./budget";

// Memory Decay
export { DecayManager } from "./decay";
export type { DecayConfig, FactWithDecay } from "./decay";

// Auto-Summarization
export { AutoSummarizer } from "./summarization";
export type { AutoSummarizeConfig } from "./summarization";

// Tiered Storage
export { TieredAdapter } from "./tiered";
export type { TieredAdapterConfig } from "./tiered";

// Embeddings
export {
  createEmbeddingProvider,
  OpenAIEmbeddingProvider,
  InMemoryVectorStore,
  cosineSimilarity,
  findTopK,
} from "./embeddings";
export type { EmbeddingConfig, EmbeddingResult } from "./embeddings";

// Deep Sleep (Pattern Synthesis)
export { DeepSleepWorker } from "./synthesis";
export type { DeepSleepConfig } from "./synthesis";

// Memory Consolidation (Short-term → Working → Long-term)
export { ConsolidationWorker } from "./consolidation";
export type { ConsolidationConfig } from "./consolidation";

// Contradiction Detection (Real-time conflict flagging)
export { ContradictionDetector } from "./detection";
export type {
  ContradictionConfig,
  Contradiction,
  ContradictionResult,
} from "./detection";

// Association Engine (Knowledge Graph Links)
export { AssociationEngine } from "./association";
export type { AssociationConfig, Association } from "./association";

// Predictive Engine (Behavioral Pattern Detection)
export { PredictiveEngine } from "./prediction";
export type {
  PredictionConfig,
  BehaviorPattern,
  Prediction,
} from "./prediction";

// Hierarchical Memory Modeling (HMM) - Optional
export { HierarchicalMemory } from "./hierarchy";
export type { HierarchicalConfig, MemoryLevel } from "./hierarchy";
