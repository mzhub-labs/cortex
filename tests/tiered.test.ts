import { describe, it, expect, beforeEach } from "vitest";
import { TieredAdapter } from "../src/tiered";
import { InMemoryAdapter } from "../src/adapters";

describe("TieredAdapter", () => {
  let tiered: TieredAdapter;
  let hot: InMemoryAdapter;
  let cold: InMemoryAdapter;

  beforeEach(async () => {
    hot = new InMemoryAdapter();
    cold = new InMemoryAdapter();

    tiered = new TieredAdapter({
      hotAdapter: hot,
      coldAdapter: cold,
      hotFactLimit: 5,
      autoPromote: true,
      autoDemote: true,
    });

    await tiered.initialize();
  });

  describe("dual writes", () => {
    it("should write to both hot and cold", async () => {
      await tiered.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "test",
        invalidatedAt: null,
      });

      const hotFacts = await hot.getFacts("user1");
      const coldFacts = await cold.getFacts("user1");

      expect(hotFacts.length).toBe(1);
      expect(coldFacts.length).toBe(1);
    });
  });

  describe("read path", () => {
    it("should read from hot first", async () => {
      // Add directly to hot
      await hot.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "test",
        invalidatedAt: null,
      });

      const facts = await tiered.getFacts("user1");
      expect(facts.length).toBe(1);
      expect(facts[0].object).toBe("John");
    });

    it("should fall back to cold when hot is empty", async () => {
      // Add directly to cold only
      await cold.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "Jane",
        confidence: 0.9,
        source: "test",
        invalidatedAt: null,
      });

      const facts = await tiered.getFacts("user1");
      expect(facts.length).toBe(1);
      expect(facts[0].object).toBe("Jane");
    });

    it("should promote cold facts to hot on access", async () => {
      // Add to cold only
      await cold.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "Jane",
        confidence: 0.9,
        source: "test",
        invalidatedAt: null,
      });

      // Read via tiered (should promote)
      await tiered.getFacts("user1");

      // Now hot should have it
      const hotFacts = await hot.getFacts("user1");
      expect(hotFacts.length).toBe(1);
    });
  });

  describe("auto-demotion", () => {
    it("should demote old facts when limit exceeded", async () => {
      // Add 6 facts (limit is 5)
      for (let i = 0; i < 6; i++) {
        await tiered.upsertFact("user1", {
          subject: "User",
          predicate: `FACT_${i}`,
          object: `Value ${i}`,
          confidence: 0.9,
          source: "test",
          invalidatedAt: null,
        });
      }

      const hotFacts = await hot.getFacts("user1");
      expect(hotFacts.length).toBeLessThanOrEqual(5);

      // Cold should have all 6
      const coldFacts = await cold.getFacts("user1");
      expect(coldFacts.length).toBe(6);
    });
  });

  describe("warmCache", () => {
    it("should populate hot from cold", async () => {
      // Add to cold only
      await cold.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "test",
        invalidatedAt: null,
      });

      // Hot should be empty
      let hotFacts = await hot.getFacts("user1");
      expect(hotFacts.length).toBe(0);

      // Warm cache
      await tiered.warmCache("user1");

      // Now hot should have it
      hotFacts = await hot.getFacts("user1");
      expect(hotFacts.length).toBe(1);
    });
  });

  describe("getStorageStats", () => {
    it("should return counts for both tiers", async () => {
      await tiered.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "test",
        invalidatedAt: null,
      });

      const stats = await tiered.getStorageStats("user1");

      expect(stats.hotFacts).toBe(1);
      expect(stats.coldFacts).toBe(1);
    });
  });
});
