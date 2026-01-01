import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  findTopK,
  InMemoryVectorStore,
} from "../src/embeddings";

describe("Embeddings", () => {
  describe("cosineSimilarity", () => {
    it("should return 1 for identical vectors", () => {
      const vec = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
    });

    it("should return 0 for orthogonal vectors", () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it("should return -1 for opposite vectors", () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it("should handle similar vectors", () => {
      const a = [1, 2, 3];
      const b = [1, 2, 4]; // Slightly different
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeGreaterThan(0.9);
      expect(similarity).toBeLessThan(1);
    });
  });

  describe("findTopK", () => {
    it("should find most similar vectors", () => {
      const query = [1, 0, 0];
      const candidates = [
        { id: "a", vector: [1, 0, 0] }, // Exact match
        { id: "b", vector: [0.9, 0.1, 0] }, // Very similar
        { id: "c", vector: [0, 1, 0] }, // Orthogonal
        { id: "d", vector: [-1, 0, 0] }, // Opposite
      ];

      const results = findTopK(query, candidates, 2);

      expect(results.length).toBe(2);
      expect(results[0].id).toBe("a");
      expect(results[1].id).toBe("b");
    });

    it("should return fewer if k > candidates", () => {
      const query = [1, 0, 0];
      const candidates = [{ id: "a", vector: [1, 0, 0] }];

      const results = findTopK(query, candidates, 10);
      expect(results.length).toBe(1);
    });
  });

  describe("InMemoryVectorStore", () => {
    it("should store and search vectors", () => {
      const store = new InMemoryVectorStore();

      store.store("user1", "fact1", [1, 0, 0]);
      store.store("user1", "fact2", [0, 1, 0]);
      store.store("user1", "fact3", [0.9, 0.1, 0]);

      const results = store.search("user1", [1, 0, 0], 2);

      expect(results.length).toBe(2);
      expect(results[0].id).toBe("fact1");
      expect(results[0].similarity).toBeCloseTo(1, 5);
    });

    it("should separate vectors by user", () => {
      const store = new InMemoryVectorStore();

      store.store("user1", "fact1", [1, 0, 0]);
      store.store("user2", "fact2", [1, 0, 0]);

      const user1Results = store.search("user1", [1, 0, 0], 10);
      const user2Results = store.search("user2", [1, 0, 0], 10);

      expect(user1Results.length).toBe(1);
      expect(user1Results[0].id).toBe("fact1");
      expect(user2Results.length).toBe(1);
      expect(user2Results[0].id).toBe("fact2");
    });

    it("should delete vectors", () => {
      const store = new InMemoryVectorStore();

      store.store("user1", "fact1", [1, 0, 0]);
      expect(store.count("user1")).toBe(1);

      store.delete("user1", "fact1");
      expect(store.count("user1")).toBe(0);
    });

    it("should clear all vectors for a user", () => {
      const store = new InMemoryVectorStore();

      store.store("user1", "fact1", [1, 0, 0]);
      store.store("user1", "fact2", [0, 1, 0]);
      expect(store.count("user1")).toBe(2);

      store.clear("user1");
      expect(store.count("user1")).toBe(0);
    });
  });
});
