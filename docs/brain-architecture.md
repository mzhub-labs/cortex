# Brain Architecture

cortex implements a biologically-inspired memory system. Each component maps to a real brain function.

---

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                    DIGITAL BRAIN                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌─────────────┐    ┌─────────────┐    ┌───────────┐  │
│   │  Amygdala   │    │ Hippocampus │    │ Neocortex │  │
│   │ (Importance)│    │ (Episodes)  │    │ (Storage) │  │
│   └─────────────┘    └─────────────┘    └───────────┘  │
│                                                         │
│   ┌─────────────┐    ┌─────────────┐    ┌───────────┐  │
│   │  Hebbian    │    │ Deep Sleep  │    │ Prefrontal│  │
│   │ (Learning)  │    │ (Synthesis) │    │ (Control) │  │
│   └─────────────┘    └─────────────┘    └───────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Amygdala: Importance Scoring

**Biological Function:** Tags memories with emotional weight to ensure survival-critical information is never forgotten.

**cortex Implementation:** Every fact has an `importance` score (1-10).

```typescript
interface MemoryFact {
  importance: number; // 1-10 scale
}
```

**Scale:**

- **9-10: Critical** — Allergies, medical conditions, explicit boundaries
- **7-8: Important** — Strong preferences, accessibility needs
- **4-6: Standard** — Job, location, relationships
- **1-3: Trivia** — Minor preferences, casual mentions

**Behavior:**

- Facts with `importance >= 9` are **always included** in context, regardless of recency
- Safety predicates (`ALLERGY`, `MEDICAL`, `BOUNDARY`) are auto-escalated to importance 9+

```typescript
// ContextHydrator automatically includes critical facts
const criticalFacts = allFacts.filter((f) => f.importance >= 9);
const regularFacts = fillRemainingBudget(maxFacts - criticalFacts.length);
return [...criticalFacts, ...regularFacts];
```

---

## 2. Episodic Memory: Source Anchoring

**Biological Function:** Links memories to specific events (where/when you learned something).

**cortex Implementation:** Facts track their origin conversation.

```typescript
interface MemoryFact {
  source: string; // Session ID
  sourceConversationId?: string; // Specific message ID
}
```

**Use Case:** The LLM can cite sources:

> "I remember you mentioned you're vegan (from our chat on December 12th)"

---

## 3. Hebbian Learning: Use-Based Reinforcement

**Biological Function:** "Neurons that fire together, wire together." Frequently accessed memories become stronger.

**cortex Implementation:** Track access patterns.

```typescript
interface MemoryFact {
  accessCount?: number; // Times this fact was retrieved
  lastAccessedAt?: Date; // Most recent access
}
```

**Behavior:**

- Every `hydrate()` call increments `accessCount`
- Frequently accessed facts decay slower
- Unused facts fade faster

---

## 4. Deep Sleep: Pattern Synthesis

**Biological Function:** During sleep, the brain consolidates memories and finds patterns across experiences.

**cortex Implementation:** `DeepSleepWorker` runs on a schedule.

```typescript
import { DeepSleepWorker } from "@mzhub/cortex";

const worker = new DeepSleepWorker(provider, adapter, {
  lookbackHours: 24,
  minFactsForSynthesis: 3,
});

// Run nightly via cron
await worker.runSynthesisCycle(userId);
```

**What It Finds:**

- User is tired + works late + skips meals → "User shows signs of burnout"
- User mentions headaches + spends 10h on screens → "User may benefit from screen breaks"

---

## 5. Memory Consolidation: Three-Stage Model

**Biological Function:** Memories progress from short-term → working → long-term.

**cortex Implementation:** `ConsolidationWorker` manages transitions.

```typescript
interface MemoryFact {
  memoryStage?: "short-term" | "working" | "long-term";
}
```

**Progression:**

- **Short-term:** Just learned (< 1 hour, < 2 accesses)
- **Working:** Being used (1-24 hours, 2-5 accesses)
- **Long-term:** Consolidated (> 24 hours, > 5 accesses)

```typescript
import { ConsolidationWorker } from "@mzhub/cortex";

const consolidator = new ConsolidationWorker(adapter, {
  shortTermHours: 1,
  workingAccessThreshold: 2,
  longTermAccessThreshold: 5,
});

await consolidator.consolidate(userId);
await consolidator.pruneShortTerm(userId, 24); // Delete unused short-term
```

---

## 6. Contradiction Detection

**Biological Function:** Prefrontal cortex detects logical conflicts.

**cortex Implementation:** `ContradictionDetector` flags conflicts before storage.

```typescript
import { ContradictionDetector } from "@mzhub/cortex";

const detector = new ContradictionDetector(adapter, provider, {
  autoResolve: true,
  useLLM: false, // Use LLM for semantic conflicts
});

const result = await detector.check(userId, newFact);
if (result.hasContradictions) {
  console.log("Conflicts:", result.contradictions);
  // Resolution: 'replace' | 'keep' | 'merge' | 'clarify'
}
```

---

## 7. Associative Linking: Knowledge Graph

**Biological Function:** Related concepts are linked in the brain's associative cortex.

**cortex Implementation:** Facts can reference related facts.

```typescript
interface MemoryFact {
  relatedFactIds?: string[];
}
```

```typescript
import { AssociationEngine } from "@mzhub/cortex";

const engine = new AssociationEngine(adapter, provider, {
  similarityThreshold: 0.7,
  maxAssociations: 5,
});

// Manual linking
await engine.linkFacts(userId, factA.id, factB.id, "implies");

// Auto-link using embeddings
await engine.autoLink(userId);

// Get knowledge graph
const { nodes, edges } = await engine.getGraph(userId);
```

---

## 8. Predictive Modeling: Behavioral Patterns

**Biological Function:** The brain recognizes temporal/behavioral patterns.

**cortex Implementation:** `PredictiveEngine` detects patterns.

```typescript
import { PredictiveEngine } from "@mzhub/cortex";

const predictor = new PredictiveEngine(adapter, provider, {
  minOccurrences: 3,
  lookbackDays: 30,
});

const patterns = await predictor.analyzePatterns(userId);
// [{ type: 'temporal', description: 'User is most active on Mondays' }]

const predictions = await predictor.getPredictions(userId);
// [{ prediction: 'User may want to discuss work topics' }]
```

---

## 9. Emotional Coloring: Sentiment Context

**Biological Function:** Memories carry emotional context.

**cortex Implementation:** Facts track sentiment.

```typescript
interface MemoryFact {
  sentiment?: "positive" | "negative" | "neutral";
  emotionalContext?: string;
}
```

**Use Case:** Know if a fact was learned in a happy or frustrated context:

- "I got promoted!" → `sentiment: "positive"`
- "I hate my commute" → `sentiment: "negative"`

---

## Putting It All Together

```typescript
import {
  MemoryOS,
  DeepSleepWorker,
  ConsolidationWorker,
  ContradictionDetector,
  AssociationEngine,
  PredictiveEngine,
} from "@mzhub/cortex";

// Core memory system
const memory = new MemoryOS({ llm, adapter });

// Brain enhancement workers (optional)
const sleep = new DeepSleepWorker(provider, adapter);
const consolidator = new ConsolidationWorker(adapter);
const detector = new ContradictionDetector(adapter, provider);
const associations = new AssociationEngine(adapter);
const predictor = new PredictiveEngine(adapter);

// Schedule nightly maintenance
cron.schedule("0 3 * * *", async () => {
  for (const userId of activeUsers) {
    await sleep.runSynthesisCycle(userId);
    await consolidator.consolidate(userId);
    await consolidator.pruneShortTerm(userId);
    await associations.autoLink(userId);
  }
});
```

---

## Brain Component Summary

| Component     | Class                   | Brain Equivalent    | Default     |
| ------------- | ----------------------- | ------------------- | ----------- |
| Importance    | `importance` field      | Amygdala            | ✅ Built-in |
| Episodic      | `sourceConversationId`  | Hippocampus         | ✅ Built-in |
| Hebbian       | `accessCount`           | Neural Plasticity   | ✅ Built-in |
| Deep Sleep    | `DeepSleepWorker`       | Sleep Consolidation | Optional    |
| Stages        | `ConsolidationWorker`   | Memory Systems      | Optional    |
| Contradiction | `ContradictionDetector` | Prefrontal Cortex   | Optional    |
| Association   | `AssociationEngine`     | Associative Cortex  | Optional    |
| Prediction    | `PredictiveEngine`      | Pattern Recognition | Optional    |
| Sentiment     | `sentiment` field       | Emotional Memory    | ✅ Built-in |

---

## Why This Matters

A flat fact database answers: _"What do I know?"_

A digital brain answers:

- _"What is critical to never forget?"_ (Amygdala)
- _"When did I learn this?"_ (Episodic)
- _"What do I use most often?"_ (Hebbian)
- _"What patterns emerge across conversations?"_ (Deep Sleep)
- _"Does this conflict with what I know?"_ (Contradiction)
- _"What else is related?"_ (Association)
- _"What might the user need next?"_ (Prediction)

This is the difference between a note-taking app and a true AI companion.
