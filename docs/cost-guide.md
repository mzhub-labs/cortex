# Cost Guide

Understanding and optimizing the costs of running mem-ts in production.

---

## Overview

mem-ts requires an LLM API for fact extraction. All other features are either free or use optional paid services.

**Minimum cost:** ~$0.002/user/day (10 messages)  
**Full features:** ~$0.005/user/day (10 messages + synthesis)

---

## Cost Breakdown by Operation

### Core Operations (Required)

| Operation         | When                | Input Tokens | Output Tokens | Cost (GPT-4o-mini) |
| ----------------- | ------------------- | ------------ | ------------- | ------------------ |
| Fact Extraction   | After each message  | ~500-800     | ~150-250      | **$0.0002**        |
| Context Hydration | Before each message | 0            | 0             | **Free**           |

**Extraction is the main cost.** Everything else is optional or free.

### Optional Brain Features

| Feature                     | Trigger             | Tokens             | Cost          | Can Skip? |
| --------------------------- | ------------------- | ------------------ | ------------- | --------- |
| Deep Sleep Synthesis        | Scheduled (nightly) | ~1500 in, ~400 out | $0.0008/run   | ✅ Yes    |
| HMM Pattern Synthesis       | Scheduled           | ~1500 in, ~500 out | $0.001/run    | ✅ Yes    |
| Contradiction Check (LLM)   | Per new fact        | ~300 in, ~100 out  | $0.0001/check | ✅ Yes    |
| Predictive Analysis (LLM)   | On demand           | ~1000 in, ~300 out | $0.0005/run   | ✅ Yes    |
| Association Discovery (LLM) | On demand           | ~800 in, ~300 out  | $0.0004/run   | ✅ Yes    |

### Embedding Costs (Optional)

Embeddings enable semantic search. They are **completely optional**.

| Provider | Model                    | Cost per 1K tokens | Per Fact (~50 tokens) |
| -------- | ------------------------ | ------------------ | --------------------- |
| OpenAI   | `text-embedding-3-small` | $0.00002           | $0.000001             |
| OpenAI   | `text-embedding-3-large` | $0.00013           | $0.0000065            |

**Note:** mem-ts works without embeddings using importance + recency scoring.

---

## Monthly Cost Estimates

### Per User (10 messages/day average)

| Mode                               | Daily  | Monthly | Annual |
| ---------------------------------- | ------ | ------- | ------ |
| **Minimal** (extraction only)      | $0.002 | $0.06   | $0.72  |
| **Standard** (+ nightly synthesis) | $0.003 | $0.09   | $1.08  |
| **Full Features** (all workers)    | $0.005 | $0.15   | $1.80  |

### By Scale

| Active Users | Messages/Day | Minimal      | Full Features |
| ------------ | ------------ | ------------ | ------------- |
| 10           | 100          | **$0.60/mo** | **$1.50/mo**  |
| 100          | 1,000        | **$6/mo**    | **$15/mo**    |
| 1,000        | 10,000       | **$60/mo**   | **$150/mo**   |
| 10,000       | 100,000      | **$600/mo**  | **$1,500/mo** |

### Database Costs (Separate)

| Option                  | Cost    | Notes              |
| ----------------------- | ------- | ------------------ |
| JSONFileAdapter         | $0      | Single-server only |
| Supabase Free Tier      | $0      | Up to 500MB        |
| Neon Free Tier          | $0      | Up to 512MB        |
| PostgreSQL (Production) | ~$25/mo | Recommended        |
| MongoDB Atlas (M10)     | ~$50/mo | Document-based     |
| Upstash Redis           | ~$10/mo | Serverless         |

---

## Cost Optimization Strategies

### 1. Use Cheap Models for Extraction

The extraction task doesn't need the smartest model. Use cheaper alternatives:

```typescript
// Option 1: GPT-4o-mini (recommended balance)
const memory = new MemoryOS({
  llm: { provider: "openai", model: "gpt-4o-mini" },
});

// Option 2: Groq (very fast, very cheap)
const memory = new MemoryOS({
  llm: { provider: "groq", model: "llama-3.1-8b-instant" },
});

// Option 3: Cerebras (fast inference)
const memory = new MemoryOS({
  llm: { provider: "cerebras", model: "llama-3.3-70b" },
});
```

**Cost comparison per 1M tokens:**

| Model               | Input | Output | vs GPT-4o       |
| ------------------- | ----- | ------ | --------------- |
| GPT-4o              | $2.50 | $10.00 | Baseline        |
| GPT-4o-mini         | $0.15 | $0.60  | **94% cheaper** |
| Claude 3.5 Haiku    | $0.25 | $1.25  | 90% cheaper     |
| Groq (Llama 3.1 8B) | $0.05 | $0.08  | **99% cheaper** |

### 2. Limit Extractions with BudgetManager

```typescript
import { BudgetManager } from "@mz-hub/mem-ts";

const budget = new BudgetManager({
  maxTokensPerUserPerDay: 50000, // Cap daily token usage
  maxExtractionsPerUserPerDay: 50, // Max 50 extraction calls
  maxExtractionsPerUserPerHour: 10, // Rate limit
});

// Check before extracting
if (budget.canExtract(userId).allowed) {
  memory.digest(userId, userMessage, response);
  budget.recordExtraction(userId);
}
```

### 3. Skip Extraction for Trivial Messages

```typescript
const SKIP_PATTERNS = [
  /^(ok|thanks|got it|cool|nice)$/i,
  /^(yes|no|maybe)$/i,
  /^\W+$/, // Just punctuation
];

function shouldExtract(message: string): boolean {
  if (message.length < 10) return false;
  if (SKIP_PATTERNS.some((p) => p.test(message))) return false;
  return true;
}

// Only digest meaningful messages
if (shouldExtract(userMessage)) {
  memory.digest(userId, userMessage, response);
}
```

### 4. Use HMM to Reduce Context Tokens

Without HMM, context grows linearly:

- 200 facts × 20 tokens = 4,000 tokens per hydrate

With HMM compression:

- 3 core beliefs + 5 patterns + 10 facts = ~400 tokens per hydrate

**Savings: 90%** on context injection costs.

```typescript
import { HierarchicalMemory } from "@mz-hub/mem-ts";

const hmm = new HierarchicalMemory(adapter, provider, { enabled: true });

// Compressed retrieval
const { coreBeliefs, patterns, facts } = await hmm.hydrateHierarchical(userId);
```

### 5. Run Synthesis During Off-Hours

Schedule expensive operations when usage is low:

```typescript
// Run nightly at 3 AM
cron.schedule("0 3 * * *", async () => {
  const activeUsers = await getActiveUsers();

  for (const userId of activeUsers) {
    await deepSleep.runSynthesisCycle(userId);
    await hmm.synthesizePatterns(userId);
  }
});
```

### 6. Disable Optional LLM Features

For maximum savings, use only the required extraction:

```typescript
// Minimal setup - no optional LLM workers
const memory = new MemoryOS({
  llm: { provider: "groq", model: "llama-3.1-8b-instant" },
  adapter: new JSONFileAdapter({ path: "./.mem-ts" }),
});

// DON'T use:
// - DeepSleepWorker (requires LLM)
// - ContradictionDetector with useLLM: true
// - PredictiveEngine.analyzeWithLLM()
// - AssociationEngine.findSemanticRelationships()

// DO use (free):
// - ConsolidationWorker (rule-based)
// - ContradictionDetector with useLLM: false
// - PredictiveEngine.analyzePatterns() (heuristic)
// - AssociationEngine.autoLink() without LLM
```

---

## Feature Cost Matrix

| Feature                    | LLM Required | Embeddings | Database | Total Cost |
| -------------------------- | ------------ | ---------- | -------- | ---------- |
| Core extraction            | ✅           | ❌         | ✅       | Low        |
| Context hydration          | ❌           | ❌         | ✅       | Free       |
| Importance scoring         | ❌           | ❌         | ✅       | Free       |
| Hebbian learning           | ❌           | ❌         | ✅       | Free       |
| Memory consolidation       | ❌           | ❌         | ✅       | Free       |
| Contradiction (rule-based) | ❌           | ❌         | ✅       | Free       |
| Contradiction (semantic)   | ✅           | ❌         | ✅       | Low        |
| Deep Sleep synthesis       | ✅           | ❌         | ✅       | Low        |
| HMM synthesis              | ✅           | ❌         | ✅       | Low        |
| Association (manual)       | ❌           | ❌         | ✅       | Free       |
| Association (auto)         | ❌           | ✅         | ✅       | Very Low   |
| Association (semantic)     | ✅           | ❌         | ✅       | Low        |
| Prediction (heuristic)     | ❌           | ❌         | ✅       | Free       |
| Prediction (LLM)           | ✅           | ❌         | ✅       | Low        |
| Attention filtering        | ❌           | ✅         | ✅       | Very Low   |

---

## Comparison: mem-ts vs Alternatives

| Approach                  | Monthly Cost (1K users) | Notes              |
| ------------------------- | ----------------------- | ------------------ |
| **mem-ts (minimal)**      | **$60**                 | Just extraction    |
| **mem-ts (full)**         | **$150**                | All brain features |
| Full conversation storage | $200-500                | Token-heavy        |
| Vector DB + RAG           | $100-300                | Embedding costs    |
| Custom memory system      | $500+                   | Engineering time   |

---

## Monitoring Costs

Track your actual usage:

```typescript
import { TokenTracker } from "@mz-hub/mem-ts";

const tracker = new TokenTracker();

// After each extraction
tracker.record({
  userId: "user123",
  operation: "extraction",
  inputTokens: result.usage.inputTokens,
  outputTokens: result.usage.outputTokens,
});

// Get analytics
const stats = tracker.getAnalytics();
console.log(`Total tokens used: ${stats.totalTokens}`);
console.log(`Estimated cost: $${stats.estimatedCost}`);
```

---

## Summary

| User Goal                 | Recommended Setup                 | Est. Cost  |
| ------------------------- | --------------------------------- | ---------- |
| **Prototype**             | Groq + JSONFile                   | ~$1/mo     |
| **Small app** (100 users) | GPT-4o-mini + Supabase            | ~$10/mo    |
| **Production** (1K users) | GPT-4o-mini + PostgreSQL          | ~$100/mo   |
| **Scale** (10K+ users)    | HMM + BudgetManager + Cheap model | $500-1K/mo |

The key insight: **extraction is cheap, and everything else is optional.**
