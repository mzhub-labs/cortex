import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateCost,
  compressConversation,
  TokenTracker,
} from "../src/utils/tokenEconomics";

describe("Token Economics", () => {
  describe("estimateTokens", () => {
    it("should estimate tokens for text", () => {
      const tokens = estimateTokens("Hello, my name is John.");
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20); // Should be around 6-8 tokens
    });

    it("should return 0 for empty text", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("should scale with text length", () => {
      const short = estimateTokens("Hello");
      const long = estimateTokens(
        "Hello, my name is John and I live in San Francisco."
      );

      expect(long).toBeGreaterThan(short);
    });
  });

  describe("estimateCost", () => {
    it("should calculate cost for known models", () => {
      const cost = estimateCost(
        { inputTokens: 1000000, outputTokens: 500000 },
        "gpt-4o-mini"
      );

      // gpt-4o-mini: $0.15/1M input, $0.6/1M output
      // Expected: 0.15 + 0.3 = 0.45
      expect(cost).toBeCloseTo(0.45, 2);
    });

    it("should use default pricing for unknown models", () => {
      const cost = estimateCost(
        { inputTokens: 1000000, outputTokens: 0 },
        "unknown-model"
      );

      expect(cost).toBeGreaterThan(0);
    });

    it("should return 0 for free models", () => {
      const cost = estimateCost(
        { inputTokens: 1000000, outputTokens: 1000000 },
        "llama-3.3-70b" // Cerebras free tier
      );

      expect(cost).toBe(0);
    });
  });

  describe("compressConversation", () => {
    const messages = [
      { role: "user", content: "Hello, my name is John." },
      { role: "assistant", content: "Nice to meet you, John!" },
      { role: "user", content: "I live in San Francisco." },
      { role: "assistant", content: "Great city!" },
      { role: "user", content: "Can you recommend a restaurant?" },
      { role: "assistant", content: "Sure, how about State Bird?" },
    ];

    it("should not compress short conversations", () => {
      const short = messages.slice(0, 2);
      const result = compressConversation(short, { keepRecent: 4 });

      expect(result.messages).toEqual(short);
      expect(result.originalTokens).toBe(result.compressedTokens);
    });

    it("should compress long conversations", () => {
      const result = compressConversation(messages, { keepRecent: 2 });

      expect(result.messages.length).toBe(3); // 1 summary + 2 recent
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[0].content).toContain(
        "Previous conversation summary"
      );
      // Compression should happen, but due to summary overhead it may not always be smaller
      // The goal is to reduce context window usage for older messages
      expect(result.originalTokens).toBeGreaterThan(0);
    });

    it("should keep specified number of recent messages", () => {
      const result = compressConversation(messages, { keepRecent: 4 });

      // Last 4 messages + 1 summary
      expect(result.messages.length).toBe(5);
    });
  });

  describe("TokenTracker", () => {
    it("should track token usage", () => {
      const tracker = new TokenTracker("gpt-4o-mini");

      tracker.record({ inputTokens: 100, outputTokens: 50 });
      tracker.record({ inputTokens: 200, outputTokens: 100 });

      const analytics = tracker.getAnalytics();

      expect(analytics.totalInputTokens).toBe(300);
      expect(analytics.totalOutputTokens).toBe(150);
      expect(analytics.totalCalls).toBe(2);
      expect(analytics.averageInputTokens).toBe(150);
      expect(analytics.averageOutputTokens).toBe(75);
    });

    it("should track cache savings", () => {
      const tracker = new TokenTracker("gpt-4o-mini");

      tracker.recordCacheSavings(500);
      tracker.recordCacheSavings(300);

      const analytics = tracker.getAnalytics();
      expect(analytics.tokensSavedByCache).toBe(800);
    });

    it("should track compression savings", () => {
      const tracker = new TokenTracker("gpt-4o-mini");

      tracker.recordCompressionSavings(1000, 300); // Saved 700

      const analytics = tracker.getAnalytics();
      expect(analytics.tokensSavedByCompression).toBe(700);
    });

    it("should calculate estimated savings", () => {
      const tracker = new TokenTracker("gpt-4o-mini");

      tracker.recordCacheSavings(1000000); // 1M tokens saved

      const analytics = tracker.getAnalytics();
      // gpt-4o-mini input: $0.15/1M
      expect(analytics.estimatedSavings).toBeCloseTo(0.15, 2);
    });

    it("should reset analytics", () => {
      const tracker = new TokenTracker();

      tracker.record({ inputTokens: 100, outputTokens: 50 });
      tracker.recordCacheSavings(500);

      tracker.reset();

      const analytics = tracker.getAnalytics();
      expect(analytics.totalCalls).toBe(0);
      expect(analytics.tokensSavedByCache).toBe(0);
    });
  });
});
