<p align="center">
  <img src="logo.png" alt="mem-ts" width="180" />
</p>

<h1 align="center">mem-ts</h1>

<p align="center">
  <strong>Persistent memory for AI agents — the digital brain</strong><br/>
  <em>Built by MZ Hub</em>
</p>

<!-- TODO: Add GIF demo here showing memory in action -->
<!-- <p align="center"><img src="demo.gif" width="600" /></p> -->

---

## The Problem

AI agents forget.

Not sometimes. Always.

Every conversation starts from zero. Every user has to re-explain themselves. Every preference is lost the moment the session ends.

```
Monday   User: "I'm allergic to peanuts"
         Bot:  "Noted!"

Friday   User: "What snack should I get?"
         Bot:  "Try our peanut butter cups!"
```

This is the default behavior of every LLM. They have no memory. Only context windows that reset.

---

## Why Current Memory Systems Fail

The common solution is a vector database. Store everything as embeddings. Retrieve by similarity.

This fails silently when facts change.

```
March    User: "I work at Google"
         → Stored as embedding ✓

June     User: "I just joined Microsoft"
         → Also stored as embedding ✓

July     User: "Where do I work?"
         → Vector search returns BOTH
         → LLM sees contradictory information
         → Hallucinates or hedges
```

**The core issue:**

| What vectors do    | What memory requires   |
| ------------------ | ---------------------- |
| Find similar text  | Track current truth    |
| Retrieve matches   | Replace outdated facts |
| Rank by similarity | Resolve contradictions |

Vector databases answer: _"What text matches this query?"_

They cannot answer: _"What is true about this user right now?"_

[Read the full explanation →](./docs/why-vectors-fail.md)

---

## The Solution: Brain-Inspired Architecture

mem-ts doesn't just store facts. It thinks like a brain.

```
┌─────────────────────────────────────────────────────────────┐
│                        User Message                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
            ┌──────────────▼──────────────┐
            │      🧠 FAST BRAIN          │
            │      (Your LLM)             │
            │                             │
            │  • Reasoning                │
            │  • Conversation             │
            │  • Immediate responses      │
            └──────────────┬──────────────┘
                           │
            ┌──────────────▼──────────────┐
            │      Response to User       │ ◄── Returns immediately
            └──────────────┬──────────────┘
                           │
                           │ (async, non-blocking)
                           ▼
            ┌─────────────────────────────┐
            │      🔄 SLOW BRAIN          │
            │      (mem-ts)               │
            │                             │
            │  • Extract facts            │
            │  • Detect contradictions    │
            │  • Synthesize patterns      │
            │  • Consolidate memories     │
            └─────────────────────────────┘
```

### Built-In Brain Components

| Component                   | Biological Equivalent  | What It Does                                            |
| --------------------------- | ---------------------- | ------------------------------------------------------- |
| **Importance Scoring**      | Amygdala               | Safety-critical facts (allergies) are never forgotten   |
| **Episodic Memory**         | Hippocampus            | Links facts to conversations ("when did I learn this?") |
| **Hebbian Learning**        | Neural Plasticity      | Frequently accessed facts get stronger                  |
| **Deep Sleep**              | Sleep Consolidation    | Synthesizes patterns across conversations               |
| **Memory Stages**           | Short/Long-term Memory | Facts progress from temporary → permanent               |
| **Contradiction Detection** | Prefrontal Cortex      | Flags conflicting information in real-time              |
| **Knowledge Graph**         | Associative Cortex     | Links related facts together                            |
| **Behavioral Prediction**   | Pattern Recognition    | Detects user habits and preferences                     |

[Learn about the brain architecture →](./docs/brain-architecture.md)

---

## Quick Start

### Install

```bash
npm install @mz-hub/mem-ts
```

### Use

```typescript
import { MemoryOS, JSONFileAdapter } from "@mz-hub/mem-ts";

const memory = new MemoryOS({
  llm: { provider: "openai", apiKey: process.env.OPENAI_API_KEY },
  adapter: new JSONFileAdapter({ path: "./.mem-ts" }),
});

async function chat(userId, message) {
  // 1. Ask: "What do I know about this user?"
  const context = await memory.hydrate(userId, message);

  // 2. Include it in your LLM call
  const response = await yourLLM({
    system: context.compiledPrompt,
    user: message,
  });

  // 3. Learn from this conversation (non-blocking)
  memory.digest(userId, message, response);

  return response;
}
```

That's it. The agent now remembers.

---

## Optional: Hierarchical Memory (HMM)

For advanced use cases, enable the **Memory Pyramid** — compressing thousands of facts into wisdom.

```typescript
import { HierarchicalMemory } from "@mz-hub/mem-ts";

const hmm = new HierarchicalMemory(adapter, provider, { enabled: true });

// Top-down retrieval: wisdom first, details only if needed
const { coreBeliefs, patterns, facts } = await hmm.hydrateHierarchical(userId);

// Compress facts into patterns ("User is health-conscious")
await hmm.synthesizePatterns(userId);
```

**The Memory Pyramid:**

```
    Level 4: Core Beliefs (BIOS)
    ────────────────────────────
    • Allergies, identity, safety rules
    • ALWAYS loaded, never forgotten

    Level 3: Patterns (Wisdom)
    ────────────────────────────
    • "User is health-conscious"
    • Synthesized from many facts
    • 1 token instead of 50

    Level 2: Facts (Knowledge)
    ────────────────────────────
    • "User ate salad on Tuesday"
    • Standard discrete facts

    Level 1: Raw Logs (Stream)
    ────────────────────────────
    • Ephemeral conversation buffer
    • Auto-flushed after extraction
```

[Learn more about HMM →](./docs/hierarchical-memory.md)

---

## Before and After

### Without mem-ts

```
User: "Recommend a restaurant"
Bot:  "What kind of food do you like?"
User: "I told you last week, I'm vegan"
Bot:  "Sorry, I don't have memory of previous conversations"
```

- Token-heavy prompts (full history)
- Repeated clarifications
- Inconsistent behavior
- User frustration

### With mem-ts

```
User: "Recommend a restaurant"
Bot:  "Here are some vegan spots near Berlin..."
```

- Preferences remembered
- Facts updated when they change
- Critical info never forgotten
- Predictable behavior

---

## What Gets Stored

mem-ts stores facts, not chat logs.

```
┌─────────────────────────────────────────────────────────────┐
│                    User: john@example.com                   │
├───────────────┬─────────────────────────────────────────────┤
│ name          │ John                            (importance: 5) │
│ diet          │ vegan                           (importance: 7) │
│ location      │ Berlin                          (importance: 5) │
│ allergies     │ peanuts                         (importance: 10)│
│ PATTERN       │ health-conscious                (importance: 7) │
├───────────────┴─────────────────────────────────────────────┤
│ Memory Stage: long-term  │  Access Count: 47  │  Sentiment: + │
└─────────────────────────────────────────────────────────────┘
```

When facts change, they are **replaced**, not appended.
Critical facts (importance ≥ 9) are **always included** in context.

---

## Safety and Cost Considerations

### Security

| Risk                        | Mitigation                            |
| --------------------------- | ------------------------------------- |
| Prompt injection via memory | Content scanning, XML safety wrapping |
| PII storage                 | Detection and optional redaction      |
| Cross-user leakage          | Strict user ID isolation              |
| Forgetting critical info    | Importance scoring (amygdala pattern) |

### Cost Control

| Risk                     | Mitigation                                |
| ------------------------ | ----------------------------------------- |
| Runaway extraction costs | Daily token/call budgets                  |
| Token bloat from memory  | Hierarchical retrieval (patterns > facts) |
| Stale data accumulation  | Memory consolidation + automatic decay    |

```typescript
// Built-in budget limits
const budget = new BudgetManager({
  maxTokensPerUserPerDay: 100000,
  maxExtractionsPerUserPerDay: 100,
});
```

---

## Who This Is For

**Good fit:**

- AI agents with recurring users
- Support bots that need context
- Personal assistants
- Workflow automation (n8n, Zapier)
- Any system where users expect to be remembered

**Not a fit:**

- One-time chat interactions
- Document search / RAG
- Stateless demos
- Replacing vector databases entirely

mem-ts complements vectors. It does not replace them.

---

## Documentation

- [Why Vector Databases Fail](./docs/why-vectors-fail.md)
- [Brain Architecture](./docs/brain-architecture.md)
- [Hierarchical Memory (HMM)](./docs/hierarchical-memory.md)
- [Cost Guide](./docs/cost-guide.md)
- [API Reference](./docs/api.md)
- [Storage Adapters](./docs/adapters.md)
- [Security](./docs/security.md)

---

## Philosophy

- Memory should be explicit, not inferred from similarity
- Facts should be overwriteable, not append-only
- Critical information should never be forgotten
- Agents should think like brains, not databases
- Infrastructure should be boring and reliable

---

## License

MIT — Built by **MZ Hub**
