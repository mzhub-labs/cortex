import { describe, it, expect, beforeEach } from "vitest";
import { DecayManager } from "../src/decay";
import type { FactWithDecay } from "../src/decay";

describe("DecayManager", () => {
  let decay: DecayManager;

  beforeEach(() => {
    decay = new DecayManager({
      defaultTtlDays: 30,
      lowWeightTtlDays: 7,
      ephemeralTtlHours: 1,
    });
  });

  describe("isPermanent", () => {
    it("should identify permanent predicates", () => {
      expect(decay.isPermanent("NAME")).toBe(true);
      expect(decay.isPermanent("ALLERGY")).toBe(true);
      expect(decay.isPermanent("EMAIL")).toBe(true);
    });

    it("should be case insensitive", () => {
      expect(decay.isPermanent("name")).toBe(true);
      expect(decay.isPermanent("Name")).toBe(true);
    });

    it("should return false for non-permanent predicates", () => {
      expect(decay.isPermanent("LIKES")).toBe(false);
      expect(decay.isPermanent("WORKS_AT")).toBe(false);
    });
  });

  describe("isEphemeral", () => {
    it("should identify ephemeral predicates", () => {
      expect(decay.isEphemeral("WEARING")).toBe(true);
      expect(decay.isEphemeral("CURRENT_MOOD")).toBe(true);
      expect(decay.isEphemeral("FEELING")).toBe(true);
    });

    it("should return false for non-ephemeral predicates", () => {
      expect(decay.isEphemeral("NAME")).toBe(false);
      expect(decay.isEphemeral("LIKES")).toBe(false);
    });
  });

  describe("calculateDecayWeight", () => {
    it("should return 1 for permanent facts", () => {
      const fact: FactWithDecay = {
        id: "1",
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.5,
        source: "test",
        createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
        updatedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        invalidatedAt: null,
      };

      const weight = decay.calculateDecayWeight(fact);
      expect(weight).toBe(1);
    });

    it("should return 1 for well-reinforced facts", () => {
      const fact: FactWithDecay = {
        id: "1",
        subject: "User",
        predicate: "LIKES",
        object: "Coffee",
        confidence: 0.9,
        source: "test",
        createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
        invalidatedAt: null,
        reinforcementCount: 5,
      };

      const weight = decay.calculateDecayWeight(fact);
      expect(weight).toBe(1);
    });

    it("should decay ephemeral facts quickly", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const fact: FactWithDecay = {
        id: "1",
        subject: "User",
        predicate: "WEARING",
        object: "Blue shirt",
        confidence: 0.9,
        source: "test",
        createdAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
        invalidatedAt: null,
      };

      const weight = decay.calculateDecayWeight(fact);
      expect(weight).toBe(0); // Should be fully decayed
    });

    it("should decay low-confidence facts faster", () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      const highConfidence: FactWithDecay = {
        id: "1",
        subject: "User",
        predicate: "LIKES",
        object: "Pizza",
        confidence: 0.9,
        source: "test",
        createdAt: twoWeeksAgo,
        updatedAt: twoWeeksAgo,
        invalidatedAt: null,
      };

      const lowConfidence: FactWithDecay = {
        ...highConfidence,
        id: "2",
        confidence: 0.3,
      };

      const highWeight = decay.calculateDecayWeight(highConfidence);
      const lowWeight = decay.calculateDecayWeight(lowConfidence);

      expect(highWeight).toBeGreaterThan(lowWeight);
    });
  });

  describe("shouldPrune", () => {
    it("should not prune permanent facts", () => {
      const fact: FactWithDecay = {
        id: "1",
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "test",
        createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        invalidatedAt: null,
      };

      expect(decay.shouldPrune(fact)).toBe(false);
    });

    it("should prune expired ephemeral facts", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const fact: FactWithDecay = {
        id: "1",
        subject: "User",
        predicate: "CURRENT_MOOD",
        object: "Happy",
        confidence: 0.9,
        source: "test",
        createdAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
        invalidatedAt: null,
      };

      expect(decay.shouldPrune(fact)).toBe(true);
    });
  });

  describe("addPermanentPredicate", () => {
    it("should add custom permanent predicate", () => {
      expect(decay.isPermanent("CUSTOM_PERMANENT")).toBe(false);

      decay.addPermanentPredicate("CUSTOM_PERMANENT");

      expect(decay.isPermanent("CUSTOM_PERMANENT")).toBe(true);
    });
  });

  describe("addEphemeralPredicate", () => {
    it("should add custom ephemeral predicate", () => {
      expect(decay.isEphemeral("CUSTOM_EPHEMERAL")).toBe(false);

      decay.addEphemeralPredicate("CUSTOM_EPHEMERAL");

      expect(decay.isEphemeral("CUSTOM_EPHEMERAL")).toBe(true);
    });
  });
});
