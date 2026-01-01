# Hierarchical Memory Modeling (HMM)

HMM is an optional mode that organizes memory into a **pyramid of abstraction** — turning thousands of facts into actionable wisdom.

---

## The Problem with Flat Memory

Without hierarchy, all facts are equal:

```
Fact A: "User likes apples"
Fact B: "User hates pears"
Fact C: "User ate salad yesterday"
Fact D: "User went to gym"
Fact E: "User tracks calories"
... (thousands more)
```

After a year of conversations, you might have 5,000 facts.

**Flat Retrieval Problem:**

- Search for "food" → returns 200 random food facts
- Most are noise: "User ate a bagel on Tuesday"
- LLM context fills with irrelevant details
- Token costs explode, quality drops

---

## The Solution: Memory Pyramid

HMM compresses data upward over time. The higher you go, the more abstract and stable the information becomes.

```
            ▲
           /█\
          / █ \        Level 4: Core Beliefs (BIOS)
         /  █  \       "User has peanut allergy" — ALWAYS loaded
        ────────
       /████████\
      / ████████ \     Level 3: Patterns (Wisdom)
     /  ████████  \    "User is health-conscious"
    ────────────────
   /████████████████\
  / ████████████████ \ Level 2: Facts (Knowledge)
 /  ████████████████  \"User ate salad", "User tracks calories"
──────────────────────
███████████████████████ Level 1: Raw Logs (Stream)
███████████████████████ Conversation buffer (ephemeral)
```

---

## The Four Levels

### Level 1: Raw Logs (Stream)

**What:** Raw conversation exchanges.  
**Retention:** Minutes to hours.  
**Handling:** Kept in immediate buffer, then flushed after extraction.  
**Brain Equivalent:** Sensory memory.

```typescript
// Raw logs are auto-flushed after extraction
await hmm.flushRawLogs(userId);
```

### Level 2: Facts (Knowledge)

**What:** Standard discrete facts (Subject → Predicate → Object).  
**Retention:** Medium to long-term.  
**Handling:** Stored in your database.  
**Brain Equivalent:** Neocortex (fact storage).

```typescript
// Standard facts from extraction
{ subject: "User", predicate: "DIET", object: "vegan" }
{ subject: "User", predicate: "LOCATION", object: "Berlin" }
```

### Level 3: Patterns (Wisdom)

**What:** Synthesized insights from multiple Level 2 facts.  
**Retention:** Long-term.  
**Benefit:** 1 token instead of 50 tokens.  
**Brain Equivalent:** Personality/traits.

```typescript
// Instead of 50 facts about food choices...
{
  subject: "User",
  predicate: "PATTERN",
  object: "health-conscious and actively maintains fitness",
  memoryLevel: "pattern",
  childrenIds: ["fact1", "fact2", "fact3", ...] // Provenance
}
```

### Level 4: Core Beliefs (BIOS)

**What:** Unchangeable truths and safety rules.  
**Retention:** Permanent.  
**Handling:** Always injected into system prompt.  
**Brain Equivalent:** Identity/safety instincts.

```typescript
// Core beliefs are ALWAYS included
{
  subject: "User",
  predicate: "HAS_ALLERGY",
  object: "peanuts",
  memoryLevel: "core_belief",
  importance: 10
}
```

---

## Usage

### Enable HMM

```typescript
import { HierarchicalMemory } from "@mz-hub/mem-ts";

const hmm = new HierarchicalMemory(adapter, provider, {
  enabled: true,
  maxRawLogs: 20,
  minFactsForPattern: 3,
  coreBeliefHours: 168, // 1 week before core promotion
});
```

### Hierarchical Retrieval (Top-Down)

Instead of searching all facts, query the hierarchy:

```typescript
const { coreBeliefs, patterns, facts, totalTokens } =
  await hmm.hydrateHierarchical(userId, 20);

// coreBeliefs: Always loaded (allergies, identity)
// patterns: High-density summaries
// facts: Fill remaining budget with specific details
```

### Compile Context

```typescript
const prompt = hmm.compileHierarchicalPrompt(coreBeliefs, patterns, facts);

// Output:
// ## CRITICAL (Never forget):
// - HAS_ALLERGY: peanuts
//
// ## User Traits:
// - health-conscious and actively maintains fitness
// - prefers direct communication style
//
// ## Specific Facts:
// - LOCATION: Berlin
// - TIMEZONE: Europe/Berlin
```

### Synthesize Patterns

Run the compression step to create Level 3 patterns from Level 2 facts:

```typescript
const { patternsCreated, promotions, factsCompressed } =
  await hmm.synthesizePatterns(userId);

console.log(
  `Created ${patternsCreated} patterns, compressed ${factsCompressed} facts`
);
```

### Promote to Core Belief

Safety-critical facts can be promoted manually or automatically:

```typescript
// Manual promotion
await hmm.promoteToCore(userId, factId, "User confirmed critical allergy");

// Automatic: facts with importance >= 9 are auto-promoted
// during synthesis
```

### Get Compression Stats

Monitor memory efficiency:

```typescript
const stats = await hmm.getCompressionStats(userId);

console.log(stats);
// {
//   rawLogs: 0,
//   facts: 127,
//   patterns: 8,
//   coreBeliefs: 3,
//   compressionRatio: 0.086  // Patterns represent many facts
// }
```

---

## Compression Example

**Before HMM (127 facts):**

```
User ate salad on Monday
User went to gym on Tuesday
User ate grilled chicken on Wednesday
User tracks macros in MyFitnessPal
User drinks protein shakes
User avoids processed food
... (120 more fitness-related facts)
```

**After HMM (3 patterns + 7 key facts):**

```
CORE BELIEFS:
- User has peanut allergy

PATTERNS:
- User is fitness-focused and tracks nutrition
- User prefers whole foods over processed

KEY FACTS:
- Uses MyFitnessPal
- Gym schedule: Tuesday/Thursday
```

**Token savings:** 500+ tokens → 50 tokens (90% reduction)

---

## When to Run Synthesis

Schedule pattern synthesis during low-traffic periods:

```typescript
// Run nightly via cron
cron.schedule("0 3 * * *", async () => {
  for (const userId of activeUsers) {
    await hmm.synthesizePatterns(userId);
    await hmm.flushRawLogs(userId);
  }
});
```

Or trigger after significant conversation volume:

```typescript
const factCount = await adapter.getFacts(userId, { validOnly: true });
if (factCount.length > 50) {
  await hmm.synthesizePatterns(userId);
}
```

---

## HMM vs Standard Mode

| Feature           | Standard Mode             | HMM Mode                  |
| ----------------- | ------------------------- | ------------------------- |
| Memory structure  | Flat (all facts equal)    | Pyramid (4 levels)        |
| Retrieval         | Recent + critical facts   | Core → Patterns → Facts   |
| Token usage       | Grows with fact count     | Stays compact             |
| Pattern detection | Manual only               | Automatic synthesis       |
| Best for          | Small scale (< 100 facts) | Large scale (1000+ facts) |
| Setup complexity  | Zero config               | Requires scheduled jobs   |

---

## Configuration Options

```typescript
interface HierarchicalConfig {
  /** Enable HMM mode (default: false) */
  enabled?: boolean;

  /** Maximum raw logs to keep before flushing (default: 20) */
  maxRawLogs?: number;

  /** Minimum facts needed to synthesize a pattern (default: 3) */
  minFactsForPattern?: number;

  /** Hours before patterns can become core beliefs (default: 168 = 1 week) */
  coreBeliefHours?: number;

  /** Enable debug logging */
  debug?: boolean;
}
```

---

## Why HMM Matters

**Without HMM:** Your system is a trivia database.

- "User ate a bagel on Tuesday"
- "User had coffee at 3pm"
- "User mentioned headache"

**With HMM:** Your system understands the user.

- "User is health-conscious"
- "User experiences work burnout"
- "User prefers morning productivity"

This is the difference between **data** and **wisdom**.

---

## Related Concepts

- [Brain Architecture](./brain-architecture.md) — The biological components HMM builds on
- [Deep Sleep Worker](./brain-architecture.md#4-deep-sleep-pattern-synthesis) — The synthesis engine
- [Memory Consolidation](./brain-architecture.md#5-memory-consolidation-three-stage-model) — Stage-based progression
