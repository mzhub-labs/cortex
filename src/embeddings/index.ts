/**
 * Embeddings support for cortex.
 * Provides vector embeddings for semantic search.
 */

export interface EmbeddingConfig {
  /** Embedding provider */
  provider: "openai" | "cohere" | "local";
  /** API key (for cloud providers) */
  apiKey?: string;
  /** Model to use */
  model?: string;
  /** Embedding dimensions */
  dimensions?: number;
}

export interface EmbeddingResult {
  /** The embedding vector */
  vector: number[];
  /** Token count */
  tokens: number;
}

/**
 * Embedding provider interface
 */
export abstract class BaseEmbeddingProvider {
  protected config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = config;
  }

  abstract embed(text: string): Promise<EmbeddingResult>;
  abstract embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  abstract getDimensions(): number;
}

/**
 * OpenAI embedding provider
 */
export class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
  private model: string;
  private dimensions: number;

  constructor(config: EmbeddingConfig) {
    super(config);
    this.model = config.model ?? "text-embedding-3-small";
    this.dimensions = config.dimensions ?? 1536;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.config.apiKey) {
      throw new Error("OpenAI API key required for embeddings");
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }));
      throw new Error(
        `OpenAI embedding error: ${
          (error as { error?: { message?: string } }).error?.message
        }`,
      );
    }

    interface OpenAIEmbeddingResponse {
      data: Array<{ embedding: number[]; index: number }>;
      usage: { prompt_tokens: number; total_tokens: number };
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;

    return data.data.map((item) => ({
      vector: item.embedding,
      tokens: Math.ceil(data.usage.total_tokens / texts.length),
    }));
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find top-k most similar vectors
 */
export function findTopK(
  query: number[],
  candidates: Array<{ id: string; vector: number[] }>,
  k: number,
): Array<{ id: string; similarity: number }> {
  const scored = candidates.map((c) => ({
    id: c.id,
    similarity: cosineSimilarity(query, c.vector),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, k);
}

/**
 * In-memory vector store for simple use cases
 */
export class InMemoryVectorStore {
  private vectors: Map<string, Map<string, number[]>> = new Map();

  /**
   * Store a vector for a user
   */
  store(userId: string, id: string, vector: number[]): void {
    let userVectors = this.vectors.get(userId);
    if (!userVectors) {
      userVectors = new Map();
      this.vectors.set(userId, userVectors);
    }
    userVectors.set(id, vector);
  }

  /**
   * Search for similar vectors
   */
  search(
    userId: string,
    query: number[],
    k: number = 10,
  ): Array<{ id: string; similarity: number }> {
    const userVectors = this.vectors.get(userId);
    if (!userVectors || userVectors.size === 0) return [];

    const candidates = Array.from(userVectors.entries()).map(
      ([id, vector]) => ({
        id,
        vector,
      }),
    );

    return findTopK(query, candidates, k);
  }

  /**
   * Delete a vector
   */
  delete(userId: string, id: string): void {
    this.vectors.get(userId)?.delete(id);
  }

  /**
   * Clear all vectors for a user
   */
  clear(userId: string): void {
    this.vectors.delete(userId);
  }

  /**
   * Get vector count for a user
   */
  count(userId: string): number {
    return this.vectors.get(userId)?.size ?? 0;
  }
}

/**
 * Create an embedding provider
 */
export function createEmbeddingProvider(
  config: EmbeddingConfig,
): BaseEmbeddingProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAIEmbeddingProvider(config);
    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }
}
