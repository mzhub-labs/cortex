import type { HydratedContext } from "../types";

/**
 * Configuration for semantic cache
 */
export interface SemanticCacheConfig {
  /** Maximum cache size per user */
  maxSize?: number;
  /** TTL in milliseconds (default: 5 minutes) */
  ttlMs?: number;
  /** Similarity threshold for cache hit (0-1) */
  similarityThreshold?: number;
}

interface CacheEntry {
  query: string;
  queryLower: string;
  context: HydratedContext;
  timestamp: number;
  hits: number;
}

/**
 * In-memory semantic cache for reducing redundant hydrations.
 * Uses simple string similarity for matching - can be extended with embeddings.
 */
export class SemanticCache {
  private cache: Map<string, CacheEntry[]> = new Map();
  private config: Required<SemanticCacheConfig>;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(config: SemanticCacheConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? 100,
      ttlMs: config.ttlMs ?? 5 * 60 * 1000, // 5 minutes
      similarityThreshold: config.similarityThreshold ?? 0.85,
    };
  }

  /**
   * Try to get a cached context for a query
   */
  get(userId: string, query: string): HydratedContext | null {
    const entries = this.cache.get(userId);
    if (!entries || entries.length === 0) {
      this.stats.misses++;
      return null;
    }

    const now = Date.now();
    const queryLower = query.toLowerCase().trim();

    // Find best matching entry
    let bestMatch: CacheEntry | null = null;
    let bestScore = 0;

    for (const entry of entries) {
      // Check TTL
      if (now - entry.timestamp > this.config.ttlMs) {
        continue;
      }

      // Calculate similarity
      const score = this.calculateSimilarity(queryLower, entry.queryLower);

      if (score >= this.config.similarityThreshold && score > bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      bestMatch.hits++;
      this.stats.hits++;
      return {
        ...bestMatch.context,
        fromCache: true,
      };
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Store a context in the cache
   */
  set(userId: string, query: string, context: HydratedContext): void {
    let entries = this.cache.get(userId);
    if (!entries) {
      entries = [];
      this.cache.set(userId, entries);
    }

    // Clean up expired entries
    const now = Date.now();
    const validEntries = entries.filter(
      (e) => now - e.timestamp <= this.config.ttlMs
    );

    // Evict if at capacity (LRU by hits, then by age)
    if (validEntries.length >= this.config.maxSize) {
      validEntries.sort((a, b) => {
        if (a.hits !== b.hits) return a.hits - b.hits;
        return a.timestamp - b.timestamp;
      });
      validEntries.shift();
      this.stats.evictions++;
    }

    // Add new entry
    validEntries.push({
      query,
      queryLower: query.toLowerCase().trim(),
      context: { ...context, fromCache: false },
      timestamp: now,
      hits: 0,
    });

    this.cache.set(userId, validEntries);
  }

  /**
   * Invalidate cache for a user (call after digest)
   */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    hits: number;
    misses: number;
    evictions: number;
    hitRate: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /**
   * Calculate simple string similarity using Jaccard index on word tokens
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1;

    const tokensA = new Set(a.split(/\s+/).filter(Boolean));
    const tokensB = new Set(b.split(/\s+/).filter(Boolean));

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) intersection++;
    }

    const union = tokensA.size + tokensB.size - intersection;
    return intersection / union;
  }
}
