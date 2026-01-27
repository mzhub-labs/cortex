import { describe, it, expect, beforeEach } from "vitest";
import { BudgetManager } from "../src/budget";

describe("BudgetManager", () => {
  let budget: BudgetManager;

  beforeEach(() => {
    budget = new BudgetManager({
      maxTokensPerUserPerDay: 1000,
      maxExtractionsPerUserPerDay: 10,
      extractionCooldownMs: 100,
    });
  });

  describe("canExtract", () => {
    it("should allow extraction when within limits", () => {
      const result = budget.canExtract("user1");
      expect(result.allowed).toBe(true);
    });

    it("should block extraction after limit reached", () => {
      // Record max extractions
      for (let i = 0; i < 10; i++) {
        budget.recordExtraction("user1");
      }

      const result = budget.canExtract("user1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("limit reached");
    });

    it("should enforce cooldown between extractions", async () => {
      budget.recordExtraction("user1");

      // Immediately after
      const result1 = budget.canExtract("user1");
      expect(result1.allowed).toBe(false);
      expect(result1.reason).toContain("cooldown");

      // Wait for cooldown
      await new Promise((r) => setTimeout(r, 150));

      const result2 = budget.canExtract("user1");
      expect(result2.allowed).toBe(true);
    });
  });

  describe("canUseTokens", () => {
    it("should allow tokens within budget", () => {
      const result = budget.canUseTokens("user1", 500);
      expect(result.allowed).toBe(true);
    });

    it("should block tokens exceeding budget", () => {
      budget.recordTokens("user1", 800);

      const result = budget.canUseTokens("user1", 300);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("exhausted");
    });
  });

  describe("getRemainingBudget", () => {
    it("should return full budget for new user", () => {
      const remaining = budget.getRemainingBudget("user1");

      expect(remaining.tokensRemaining).toBe(1000);
      expect(remaining.extractionsRemaining).toBe(10);
    });

    it("should decrease after usage", () => {
      budget.recordTokens("user1", 300);
      budget.recordExtraction("user1");

      const remaining = budget.getRemainingBudget("user1");

      expect(remaining.tokensRemaining).toBe(700);
      expect(remaining.extractionsRemaining).toBe(9);
    });
  });

  describe("getUsageStats", () => {
    it("should return usage statistics", () => {
      budget.recordTokens("user1", 200);
      budget.recordExtraction("user1");
      budget.recordExtraction("user1");

      const stats = budget.getUsageStats("user1");

      expect(stats.tokensUsedToday).toBe(200);
      expect(stats.extractionsToday).toBe(2);
      expect(stats.tokensRemaining).toBe(800);
      expect(stats.extractionsRemaining).toBe(8);
    });
  });

  describe("resetUserBudget", () => {
    it("should reset user budget", () => {
      budget.recordTokens("user1", 500);
      budget.recordExtraction("user1");

      budget.resetUserBudget("user1");

      const stats = budget.getUsageStats("user1");
      expect(stats.tokensUsedToday).toBe(0);
      expect(stats.extractionsToday).toBe(0);
    });
  });
});
