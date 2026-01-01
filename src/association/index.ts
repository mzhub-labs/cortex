/**
 * Association Engine - Knowledge Graph Links
 *
 * Creates and manages links between related facts.
 * Enables richer context by connecting:
 * - "likes hiking" → "likes outdoors"
 * - "works at Google" → "is an engineer"
 */

import type { MemoryFact } from "../types";
import type { BaseAdapter } from "../adapters/BaseAdapter";
import type { BaseProvider } from "../providers/BaseProvider";
import { cosineSimilarity } from "../embeddings";

export interface AssociationConfig {
  /** Minimum similarity score to auto-link (default: 0.7) */
  similarityThreshold?: number;
  /** Maximum associations per fact (default: 5) */
  maxAssociations?: number;
  /** Use LLM to find semantic relationships (default: false) */
  useLLM?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

export interface Association {
  /** Source fact ID */
  fromFactId: string;
  /** Target fact ID */
  toFactId: string;
  /** Type of relationship */
  relationship: "similar" | "implies" | "contradicts" | "related" | "causes";
  /** Strength of association (0-1) */
  strength: number;
}

/**
 * Manages associations (links) between facts.
 */
export class AssociationEngine {
  private adapter: BaseAdapter;
  private provider?: BaseProvider;
  private config: Required<AssociationConfig>;

  constructor(
    adapter: BaseAdapter,
    provider?: BaseProvider,
    config: AssociationConfig = {}
  ) {
    this.adapter = adapter;
    this.provider = provider;
    this.config = {
      similarityThreshold: config.similarityThreshold ?? 0.7,
      maxAssociations: config.maxAssociations ?? 5,
      useLLM: config.useLLM ?? false,
      debug: config.debug ?? false,
    };
  }

  /**
   * Manually link two facts together.
   */
  async linkFacts(
    userId: string,
    factIdA: string,
    factIdB: string,
    relationship: Association["relationship"] = "related"
  ): Promise<void> {
    // Update both facts to reference each other
    const factA = await this.adapter.getFactById(userId, factIdA);
    const factB = await this.adapter.getFactById(userId, factIdB);

    if (!factA || !factB) {
      throw new Error("One or both facts not found");
    }

    // Add to relatedFactIds arrays
    const relatedA = new Set(factA.relatedFactIds ?? []);
    const relatedB = new Set(factB.relatedFactIds ?? []);

    relatedA.add(factIdB);
    relatedB.add(factIdA);

    await this.adapter.updateFact(userId, factIdA, {
      relatedFactIds: Array.from(relatedA),
    });
    await this.adapter.updateFact(userId, factIdB, {
      relatedFactIds: Array.from(relatedB),
    });

    if (this.config.debug) {
      console.log(
        `[Association] Linked ${factIdA} ↔ ${factIdB} (${relationship})`
      );
    }
  }

  /**
   * Find all facts related to a given fact.
   */
  async findRelated(userId: string, factId: string): Promise<MemoryFact[]> {
    const fact = await this.adapter.getFactById(userId, factId);
    if (!fact || !fact.relatedFactIds?.length) {
      return [];
    }

    const related: MemoryFact[] = [];
    for (const relatedId of fact.relatedFactIds) {
      const relatedFact = await this.adapter.getFactById(userId, relatedId);
      if (relatedFact && !relatedFact.invalidatedAt) {
        related.push(relatedFact);
      }
    }

    return related;
  }

  /**
   * Automatically find and link similar facts using embeddings.
   */
  async autoLink(userId: string): Promise<number> {
    const facts = await this.adapter.getFacts(userId, { validOnly: true });

    // Filter to facts with embeddings
    const factsWithEmbeddings = facts.filter((f) => f.embedding?.length);

    if (factsWithEmbeddings.length < 2) {
      return 0;
    }

    let linksCreated = 0;

    // Compare each pair
    for (let i = 0; i < factsWithEmbeddings.length; i++) {
      const factA = factsWithEmbeddings[i];
      const currentRelated = new Set(factA.relatedFactIds ?? []);

      if (currentRelated.size >= this.config.maxAssociations) {
        continue; // Already at max
      }

      for (let j = i + 1; j < factsWithEmbeddings.length; j++) {
        const factB = factsWithEmbeddings[j];

        // Skip if already linked
        if (currentRelated.has(factB.id)) continue;

        // Calculate similarity
        const similarity = cosineSimilarity(factA.embedding!, factB.embedding!);

        if (similarity >= this.config.similarityThreshold) {
          await this.linkFacts(userId, factA.id, factB.id, "similar");
          linksCreated++;
          currentRelated.add(factB.id);

          if (currentRelated.size >= this.config.maxAssociations) {
            break;
          }
        }
      }
    }

    if (this.config.debug) {
      console.log(`[Association] Created ${linksCreated} automatic links`);
    }

    return linksCreated;
  }

  /**
   * Use LLM to find deeper relationships between facts.
   */
  async findSemanticRelationships(userId: string): Promise<Association[]> {
    if (!this.provider) {
      return [];
    }

    const facts = await this.adapter.getFacts(userId, { validOnly: true });
    if (facts.length < 2) return [];

    const factsDescription = facts
      .map((f) => `[${f.id}] ${f.subject}.${f.predicate}: ${f.object}`)
      .join("\n");

    const prompt = `Analyze these facts and identify relationships between them.

${factsDescription}

For each relationship found, output:
{
  "relationships": [
    {
      "fromId": "fact-id-1",
      "toId": "fact-id-2", 
      "type": "implies|contradicts|related|causes",
      "strength": 0.0-1.0,
      "reasoning": "why these are related"
    }
  ]
}

Only include strong, meaningful relationships. Output valid JSON.`;

    try {
      const result = await this.provider.complete({
        systemPrompt:
          "You analyze facts to find relationships. Output only valid JSON.",
        userPrompt: prompt,
        maxTokens: 500,
        temperature: 0.2,
        jsonMode: true,
      });

      const parsed = JSON.parse(result.content);

      const associations: Association[] = [];
      for (const rel of parsed.relationships ?? []) {
        associations.push({
          fromFactId: rel.fromId,
          toFactId: rel.toId,
          relationship: rel.type || "related",
          strength: rel.strength || 0.7,
        });

        // Create the links
        await this.linkFacts(userId, rel.fromId, rel.toId, rel.type);
      }

      return associations;
    } catch (e) {
      if (this.config.debug) {
        console.error("[Association] LLM analysis failed:", e);
      }
      return [];
    }
  }

  /**
   * Get the full knowledge graph for a user.
   */
  async getGraph(userId: string): Promise<{
    nodes: MemoryFact[];
    edges: Array<{ from: string; to: string }>;
  }> {
    const facts = await this.adapter.getFacts(userId, { validOnly: true });
    const edges: Array<{ from: string; to: string }> = [];

    for (const fact of facts) {
      for (const relatedId of fact.relatedFactIds ?? []) {
        // Add edge (avoid duplicates by only adding if from < to)
        if (fact.id < relatedId) {
          edges.push({ from: fact.id, to: relatedId });
        }
      }
    }

    return { nodes: facts, edges };
  }
}
