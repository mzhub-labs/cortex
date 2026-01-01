import { describe, it, expect } from "vitest";
import {
  validateExtractionResult,
  ConflictResolver,
} from "../src/extraction/ConflictResolver";
import { InMemoryAdapter } from "../src/adapters/InMemoryAdapter";

describe("ConflictResolver", () => {
  describe("validateExtractionResult", () => {
    it("should validate correct extraction result", () => {
      const raw = {
        operations: [
          {
            op: "INSERT",
            subject: "User",
            predicate: "NAME",
            object: "John",
            confidence: 0.9,
          },
          {
            op: "DELETE",
            subject: "User",
            predicate: "LOCATION",
            object: "NYC",
            reason: "Moved",
          },
        ],
        reasoning: "User mentioned their name and moved",
      };

      const result = validateExtractionResult(raw);
      expect(result.operations.length).toBe(2);
      expect(result.operations[0].op).toBe("INSERT");
      expect(result.operations[1].op).toBe("DELETE");
      expect(result.reasoning).toBe("User mentioned their name and moved");
    });

    it("should handle invalid input", () => {
      expect(validateExtractionResult(null).operations).toEqual([]);
      expect(validateExtractionResult(undefined).operations).toEqual([]);
      expect(validateExtractionResult("string").operations).toEqual([]);
      expect(
        validateExtractionResult({ operations: "not array" }).operations
      ).toEqual([]);
    });

    it("should skip invalid operations", () => {
      const raw = {
        operations: [
          { op: "INSERT", subject: "User", predicate: "NAME", object: "John" }, // valid
          { op: "INVALID", subject: "User", predicate: "X", object: "Y" }, // invalid op
          { op: "INSERT", predicate: "X", object: "Y" }, // missing subject
          { op: "INSERT", subject: "User", object: "Y" }, // missing predicate
          { op: "INSERT", subject: "User", predicate: "X" }, // missing object
        ],
      };

      const result = validateExtractionResult(raw);
      expect(result.operations.length).toBe(1);
    });

    it("should normalize predicate to uppercase with underscores", () => {
      const raw = {
        operations: [
          {
            op: "INSERT",
            subject: "User",
            predicate: "works at",
            object: "Google",
          },
        ],
      };

      const result = validateExtractionResult(raw);
      expect(result.operations[0].predicate).toBe("WORKS_AT");
    });

    it("should clamp confidence to 0-1", () => {
      const raw = {
        operations: [
          {
            op: "INSERT",
            subject: "User",
            predicate: "X",
            object: "Y",
            confidence: 1.5,
          },
          {
            op: "INSERT",
            subject: "User",
            predicate: "Z",
            object: "W",
            confidence: -0.5,
          },
        ],
      };

      const result = validateExtractionResult(raw);
      expect(result.operations[0].confidence).toBe(1);
      expect(result.operations[1].confidence).toBe(0);
    });
  });

  describe("ConflictResolver", () => {
    it("should pass through non-conflicting operations", async () => {
      const adapter = new InMemoryAdapter();
      await adapter.initialize();

      const resolver = new ConflictResolver("latest");
      const { resolvedOperations } = await resolver.resolve(
        "user1",
        [{ op: "INSERT", subject: "User", predicate: "NAME", object: "John" }],
        adapter
      );

      expect(resolvedOperations.length).toBe(1);
      expect(resolvedOperations[0].op).toBe("INSERT");
    });

    it("should detect and resolve conflicts with latest strategy", async () => {
      const adapter = new InMemoryAdapter();
      await adapter.initialize();

      // Add existing fact
      await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "LOCATION",
        object: "NYC",
        confidence: 0.9,
        source: "session1",
        invalidatedAt: null,
      });

      const resolver = new ConflictResolver("latest");
      const { resolvedOperations, conflicts } = await resolver.resolve(
        "user1",
        [
          {
            op: "INSERT",
            subject: "User",
            predicate: "LOCATION",
            object: "San Francisco",
          },
        ],
        adapter
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].resolution).toBe("replace");

      // Should have DELETE old + INSERT new
      expect(resolvedOperations.length).toBe(2);
      expect(resolvedOperations[0].op).toBe("DELETE");
      expect(resolvedOperations[0].object).toBe("NYC");
      expect(resolvedOperations[1].op).toBe("INSERT");
      expect(resolvedOperations[1].object).toBe("San Francisco");
    });

    it("should skip duplicate values", async () => {
      const adapter = new InMemoryAdapter();
      await adapter.initialize();

      await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "session1",
        invalidatedAt: null,
      });

      const resolver = new ConflictResolver("latest");
      const { resolvedOperations } = await resolver.resolve(
        "user1",
        [{ op: "INSERT", subject: "User", predicate: "NAME", object: "John" }], // Same value
        adapter
      );

      expect(resolvedOperations.length).toBe(0);
    });

    it("should handle keep_both strategy", async () => {
      const adapter = new InMemoryAdapter();
      await adapter.initialize();

      await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "HOBBY",
        object: "Reading",
        confidence: 0.9,
        source: "session1",
        invalidatedAt: null,
      });

      const resolver = new ConflictResolver("keep_both");
      const { resolvedOperations, conflicts } = await resolver.resolve(
        "user1",
        [
          {
            op: "INSERT",
            subject: "User",
            predicate: "HOBBY",
            object: "Gaming",
          },
        ],
        adapter
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].resolution).toBe("keep_both");

      // Should just have the INSERT, no DELETE
      expect(resolvedOperations.length).toBe(1);
      expect(resolvedOperations[0].op).toBe("INSERT");
    });
  });
});
