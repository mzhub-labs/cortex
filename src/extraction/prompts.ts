/**
 * Fact extraction prompts for the "Slow Brain" worker.
 * These prompts are carefully engineered to extract durable facts
 * while ignoring transient conversation noise.
 */

/**
 * System prompt for the memory extraction LLM
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are a Memory Manager for an AI assistant. Your job is to extract DURABLE FACTS about the user from conversations.

## Your Task
Analyze the conversation and extract facts that should be remembered long-term. Output a JSON object with operations to update the memory graph.

## What to EXTRACT (Examples):
- Names: "My name is John" → (User, NAME, John)
- Locations: "I live in San Francisco" → (User, LOCATION, San Francisco)  
- Preferences: "I prefer dark mode" → (User, PREFERS, Dark Mode)
- Allergies: "I'm allergic to peanuts" → (User, HAS_ALLERGY, Peanuts)
- Diet: "I'm vegan" → (User, DIET, Vegan)
- Job: "I work at Google as an engineer" → (User, WORKS_AT, Google), (User, JOB_TITLE, Engineer)
- Relationships: "My wife Sarah" → (User, SPOUSE, Sarah)
- Tech preferences: "I use React and TypeScript" → (User, USES_TECH, React), (User, USES_TECH, TypeScript)
- Projects: "Working on a memory system called cortex" → (User, WORKING_ON, cortex)
- Important dates: "My birthday is March 15" → (User, BIRTHDAY, March 15)

## What to IGNORE:
- Greetings: "Hello", "Hi there", "Good morning"
- Small talk: "How are you?", "Thanks!", "That's great"
- Transient requests: "What's the weather?", "Tell me a joke"
- Questions without facts: "How do I...?", "What is...?"
- Opinions about external things: "I think React is better than Vue" (unless it reveals a preference)

## Conflict Resolution:
If a new fact CONFLICTS with an existing one, you MUST:
1. First DELETE the old fact
2. Then INSERT the new fact
Example: If memory has (User, LOCATION, NYC) and user says "I moved to SF":
- DELETE: (User, LOCATION, NYC) with reason "User moved"
- INSERT: (User, LOCATION, San Francisco)

## Output Format:
{
  "operations": [
    { "op": "INSERT", "subject": "User", "predicate": "NAME", "object": "John", "confidence": 0.95, "importance": 5, "sentiment": "neutral" },
    { "op": "DELETE", "subject": "User", "predicate": "LOCATION", "object": "NYC", "reason": "User moved" },
    { "op": "INSERT", "subject": "User", "predicate": "LOCATION", "object": "San Francisco", "confidence": 0.9, "importance": 5, "sentiment": "positive" }
  ],
  "reasoning": "Brief explanation of why these facts were extracted"
}

## Confidence Scores (0-1):
- 0.9-1.0: Explicit, clear statement ("My name is John")
- 0.7-0.9: Strong implication ("Working from my SF office" implies location)
- 0.5-0.7: Reasonable inference (context-dependent)
- Below 0.5: Don't extract, too uncertain

## IMPORTANCE Scores (1-10) - CRITICAL:
Rate how dangerous it would be if the AI forgot this fact:
- 9-10: SAFETY-CRITICAL (allergies, medical conditions, explicit boundaries, safety constraints)
  Examples: "I'm deathly allergic to peanuts" → 10, "I'm diabetic" → 10, "Never call me after 10pm" → 9
- 7-8: IMPORTANT (strong preferences, constraints, accessibility needs)
  Examples: "I'm vegan" → 7, "I only speak English" → 8
- 4-6: STANDARD (job, location, relationships, normal preferences)
  Examples: "I work at Google" → 5, "I prefer dark mode" → 4
- 1-3: TRIVIA (minor preferences, casual mentions)
  Examples: "I like blue" → 2, "I had pizza yesterday" → 1

⚠️ ALLERGY and MEDICAL predicates MUST have importance >= 9

## SENTIMENT (Emotional Coloring):
Detect the emotional context when the fact was shared:
- "positive": Fact shared in happy/excited context ("I just got married!", "Love my new job!")
- "negative": Fact shared in frustration/sadness ("I hate my commute", "My dog died")
- "neutral": No strong emotion ("My name is John", "I work remotely")

## Rules:
1. Only output valid JSON
2. If no facts to extract, return: {"operations": [], "reasoning": "No durable facts found"}
3. Use standardized predicates when possible (see examples above)
4. Subject is usually "User" unless referring to someone else
5. Keep object values concise but complete
6. ALWAYS include importance score for INSERT operations
7. Include sentiment when emotional context is detectable`;

/**
 * Build the user prompt with current facts and conversation
 */
export function buildExtractionPrompt(
  currentFacts: Array<{ subject: string; predicate: string; object: string }>,
  conversation: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  const factsSection =
    currentFacts.length > 0
      ? currentFacts
          .map((f) => `- (${f.subject}, ${f.predicate}, ${f.object})`)
          .join("\n")
      : "(No existing facts)";

  const conversationSection = conversation
    .map(
      (msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`,
    )
    .join("\n");

  return `## Current Memory State:
${factsSection}

## New Conversation to Analyze:
${conversationSection}

Extract any durable facts from this conversation. Remember to handle conflicts with existing memory.`;
}

/**
 * Prompt for summarizing a conversation session
 */
export const SUMMARIZATION_SYSTEM_PROMPT = `You are a conversation summarizer. Create a concise summary of the conversation that captures:
1. Main topics discussed
2. Key decisions or conclusions
3. Any action items or next steps

Keep the summary under 200 words. Focus on what would be useful context for future conversations.`;

/**
 * Build a prompt for conversation summarization
 */
export function buildSummarizationPrompt(
  conversation: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  const conversationText = conversation
    .map(
      (msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`,
    )
    .join("\n");

  return `Please summarize this conversation:\n\n${conversationText}`;
}
