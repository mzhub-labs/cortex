import { describe, it, expect, beforeEach } from "vitest";
import { SemanticCache } from "../src/retrieval/SemanticCache";
import type { HydratedContext } from "../src/types";

describe("SemanticCache", () => {
  let cache: SemanticCache;

  const mockContext: HydratedContext = {
    compiledPrompt: "User is John, lives in NYC",
    facts: [],
    recentHistory: [],
    estimatedTokens: 10,
    fromCache: false,
  };

  beforeEach(() => {
    cache = new SemanticCache({ ttlMs: 60000, similarityThreshold: 0.6 }); // Lower threshold for test
  });

  it("should return null for cache miss", () => {
    const result = cache.get("user1", "What is my name?");
    expect(result).toBeNull();
  });

  it("should cache and retrieve exact matches", () => {
    cache.set("user1", "What is my name?", mockContext);
    const result = cache.get("user1", "What is my name?");

    expect(result).not.toBeNull();
    expect(result?.fromCache).toBe(true);
    expect(result?.compiledPrompt).toBe(mockContext.compiledPrompt);
  });

  it("should match similar queries", () => {
    cache.set("user1", "What is my name?", mockContext);

    // Similar query should match
    const result = cache.get("user1", "what is my name");

    expect(result).not.toBeNull();
    expect(result?.fromCache).toBe(true);
  });

  it("should not match dissimilar queries", () => {
    cache.set("user1", "What is my name?", mockContext);

    // Very different query should not match
    const result = cache.get("user1", "Order me a pizza with extra cheese");

    expect(result).toBeNull();
  });

  it("should separate caches by user", () => {
    cache.set("user1", "Hello", mockContext);

    const user1Result = cache.get("user1", "Hello");
    const user2Result = cache.get("user2", "Hello");

    expect(user1Result).not.toBeNull();
    expect(user2Result).toBeNull();
  });

  it("should invalidate cache for user", () => {
    cache.set("user1", "Hello", mockContext);
    expect(cache.get("user1", "Hello")).not.toBeNull();

    cache.invalidate("user1");
    expect(cache.get("user1", "Hello")).toBeNull();
  });

  it("should track cache statistics", () => {
    cache.set("user1", "Hello", mockContext);

    cache.get("user1", "Hello"); // hit
    cache.get("user1", "Hello"); // hit
    cache.get("user1", "Something else"); // miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
  });

  it("should respect TTL", async () => {
    const shortTtlCache = new SemanticCache({ ttlMs: 50 }); // 50ms TTL
    shortTtlCache.set("user1", "Hello", mockContext);

    expect(shortTtlCache.get("user1", "Hello")).not.toBeNull();

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(shortTtlCache.get("user1", "Hello")).toBeNull();
  });
});
