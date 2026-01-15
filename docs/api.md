# API Reference

## MemoryOS

The main class that orchestrates memory operations.

### Constructor

```typescript
const memory = new MemoryOS({
  llm: {
    provider: "openai" | "anthropic" | "gemini" | "groq" | "cerebras",
    apiKey: string,
    model: string, // Optional, uses provider default
    baseUrl: string, // Optional, for proxies
  },
  adapter: BaseAdapter, // Storage adapter
  options: {
    conflictStrategy: "latest" | "keep_both",
    enableCache: boolean,
    cacheTtl: number,
    debug: boolean,
  },
});
```

### Methods

#### `hydrate(userId, message, options?)`

Get compiled context before an LLM call.

```typescript
const context = await memory.hydrate("user123", "What should I eat?");
// context.compiledPrompt → "User is vegan and allergic to peanuts."
```

**Returns:** `HydratedContext`

```typescript
{
  compiledPrompt: string,    // Ready to inject into system message
  facts: MemoryFact[],       // Raw facts retrieved
  recentHistory: ConversationExchange[],
  estimatedTokens: number,
  fromCache: boolean,
}
```

#### `digest(userId, userMessage, assistantResponse)`

Extract facts in the background (non-blocking).

```typescript
memory.digest("user123", "I just went vegan", "Great choice!");
// Returns immediately, extraction happens async
```

#### `digestSync(userId, userMessage, assistantResponse)`

Extract facts synchronously (for testing).

```typescript
const result = await memory.digestSync("user123", "I am John", "Hi John!");
// result.operations → [{ op: 'INSERT', fact: {...} }]
```

#### `getFacts(userId, filter?)`

Get all facts for a user.

```typescript
const facts = await memory.getFacts("user123", {
  validOnly: true,
  predicate: "DIET",
});
```

#### `addFact(userId, subject, predicate, object, confidence?, importance?)`

Manually add a fact.

```typescript
await memory.addFact("user123", "User", "NAME", "John", 0.95, 5);
// importance defaults to 5 if not specified
```

#### `deleteFact(userId, factId, reason?)`

Soft-delete a fact.

```typescript
await memory.deleteFact("user123", "fact-id-123", "User requested deletion");
```

#### `startSession(userId)` / `endSession(userId, summary?)`

Manage conversation sessions.

```typescript
const session = await memory.startSession("user123");
// ... conversation happens ...
await memory.endSession("user123", "Discussed diet preferences");
```

#### `exportUser(userId)`

Export all user data (for portability/backup).

```typescript
const data = await memory.exportUser("user123");
// { facts: [...], conversations: [...], sessions: [...] }
```

#### `close()`

Clean up resources.

```typescript
await memory.close();
```

---

## MemoryFact

The core data structure for stored memories.

```typescript
interface MemoryFact {
  id: string;
  subject: string; // "User", "Project:MyApp"
  predicate: string; // "NAME", "WORKS_AT", "HAS_ALLERGY"
  object: string; // "John", "Google", "Peanuts"
  confidence: number; // 0-1
  importance: number; // 1-10 (9-10 = critical, always loaded)
  source: string; // Session ID
  createdAt: Date;
  updatedAt: Date;
  invalidatedAt: Date | null;

  // Brain Components
  sourceConversationId?: string; // Episodic memory
  accessCount?: number; // Hebbian learning
  lastAccessedAt?: Date;
  sentiment?: "positive" | "negative" | "neutral";
  memoryStage?: "short-term" | "working" | "long-term";

  // HMM (Optional)
  memoryLevel?: "raw_log" | "fact" | "pattern" | "core_belief";
  childrenIds?: string[]; // Facts this pattern was derived from

  // Knowledge Graph
  relatedFactIds?: string[]; // Associated facts
  embedding?: number[]; // Vector for semantic search

  metadata?: Record<string, unknown>;
}
```

---

## Brain Components

### DeepSleepWorker

Synthesizes patterns across conversations (run on schedule).

```typescript
import { DeepSleepWorker } from "@mzhub/cortex";

const worker = new DeepSleepWorker(provider, adapter, {
  lookbackHours: 24,
  minFactsForSynthesis: 3,
  maxInsights: 5,
});

await worker.runSynthesisCycle(userId);
```

### ConsolidationWorker

Manages memory stage transitions.

```typescript
import { ConsolidationWorker } from "@mzhub/cortex";

const consolidator = new ConsolidationWorker(adapter, {
  shortTermHours: 1,
  workingAccessThreshold: 2,
  longTermAccessThreshold: 5,
});

await consolidator.consolidate(userId);
await consolidator.pruneShortTerm(userId, 24);
```

### ContradictionDetector

Flags conflicting information.

```typescript
import { ContradictionDetector } from "@mzhub/cortex";

const detector = new ContradictionDetector(adapter, provider, {
  autoResolve: true,
  useLLM: false,
});

const result = await detector.check(userId, newOperation);
// result.hasContradictions, result.contradictions[], result.resolution
```

### AssociationEngine

Manages knowledge graph links.

```typescript
import { AssociationEngine } from "@mzhub/cortex";

const engine = new AssociationEngine(adapter, provider, {
  similarityThreshold: 0.7,
  maxAssociations: 5,
});

await engine.linkFacts(userId, factA.id, factB.id, "implies");
await engine.autoLink(userId);
const { nodes, edges } = await engine.getGraph(userId);
```

### PredictiveEngine

Detects behavioral patterns.

```typescript
import { PredictiveEngine } from "@mzhub/cortex";

const predictor = new PredictiveEngine(adapter, provider, {
  minOccurrences: 3,
  lookbackDays: 30,
});

const patterns = await predictor.analyzePatterns(userId);
const predictions = await predictor.getPredictions(userId);
```

### HierarchicalMemory

Optional 4-level memory pyramid.

```typescript
import { HierarchicalMemory } from "@mzhub/cortex";

const hmm = new HierarchicalMemory(adapter, provider, {
  enabled: true,
  maxRawLogs: 20,
  minFactsForPattern: 3,
});

const { coreBeliefs, patterns, facts } = await hmm.hydrateHierarchical(userId);
await hmm.synthesizePatterns(userId);
await hmm.promoteToCore(userId, factId, "reason");
```

---

## Security Utilities

### SecurityScanner

```typescript
import { SecurityScanner } from "@mzhub/cortex";

const scanner = new SecurityScanner({
  detectInjection: true,
  blockInjectedFacts: true,
  detectPii: true,
  redactPii: false,
});

const result = scanner.scan("My email is test@example.com");
// result.safe → true/false
// result.issues → [{ type: 'pii', description: '...' }]
```

### BudgetManager

```typescript
import { BudgetManager } from "@mzhub/cortex";

const budget = new BudgetManager({
  maxTokensPerUserPerDay: 100000,
  maxExtractionsPerUserPerDay: 100,
});

if (budget.canExtract("user123").allowed) {
  budget.recordExtraction("user123");
}
```

### DecayManager

```typescript
import { DecayManager } from "@mzhub/cortex";

const decay = new DecayManager({
  defaultTtlDays: 90,
  ephemeralPredicates: ["WEARING", "CURRENT_MOOD"],
});

if (decay.shouldPrune(fact)) {
  // fact has expired
}
```

---

## Adapters

All adapters extend `BaseAdapter`:

| Adapter               | Use Case                   |
| --------------------- | -------------------------- |
| `InMemoryAdapter`     | Development/testing        |
| `JSONFileAdapter`     | Single-server deployment   |
| `MongoDBAdapter`      | Production (documents)     |
| `PostgresAdapter`     | Production (relational)    |
| `UpstashRedisAdapter` | Serverless edge            |
| `TieredAdapter`       | Hot/cold automatic tiering |

---

## Events

```typescript
import { MemoryEventEmitter } from "@mzhub/cortex";

const emitter = new MemoryEventEmitter();

emitter.on("fact:created", (e) => console.log("New fact:", e.fact.predicate));
emitter.on("fact:deleted", (e) => console.log("Deleted:", e.factId));
emitter.on("session:start", (e) => console.log("Session started"));
emitter.on("session:end", (e) => console.log("Session ended"));
```

---

## Full Export List

```typescript
// Core
export { MemoryOS } from "@mzhub/cortex";

// Adapters
export {
  BaseAdapter,
  InMemoryAdapter,
  JSONFileAdapter,
  MongoDBAdapter,
  PostgresAdapter,
  UpstashRedisAdapter,
  TieredAdapter,
} from "@mzhub/cortex";

// Brain Components
export {
  DeepSleepWorker,
  ConsolidationWorker,
  ContradictionDetector,
  AssociationEngine,
  PredictiveEngine,
  HierarchicalMemory,
} from "@mzhub/cortex";

// Utilities
export {
  SecurityScanner,
  BudgetManager,
  DecayManager,
  TokenTracker,
  AutoSummarizer,
  MemoryEventEmitter,
} from "@mzhub/cortex";

// Embeddings (Optional)
export {
  createEmbeddingProvider,
  OpenAIEmbeddingProvider,
  InMemoryVectorStore,
  cosineSimilarity,
  findTopK,
} from "@mzhub/cortex";
```
