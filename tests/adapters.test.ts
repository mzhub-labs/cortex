import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAdapter } from "../src/adapters/InMemoryAdapter";
import type { MemoryFact } from "../src/types";

describe("InMemoryAdapter", () => {
  let adapter: InMemoryAdapter;

  beforeEach(async () => {
    adapter = new InMemoryAdapter();
    await adapter.initialize();
  });

  describe("Fact Operations", () => {
    it("should insert a new fact", async () => {
      const fact = await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "session1",
        invalidatedAt: null,
      });

      expect(fact.id).toBeDefined();
      expect(fact.subject).toBe("User");
      expect(fact.predicate).toBe("NAME");
      expect(fact.object).toBe("John");
      expect(fact.confidence).toBe(0.9);
    });

    it("should update existing fact with same subject+predicate", async () => {
      await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "LOCATION",
        object: "NYC",
        confidence: 0.9,
        source: "session1",
        invalidatedAt: null,
      });

      const updated = await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "LOCATION",
        object: "San Francisco",
        confidence: 0.95,
        source: "session2",
        invalidatedAt: null,
      });

      expect(updated.object).toBe("San Francisco");

      const facts = await adapter.getFacts("user1");
      expect(facts.length).toBe(1);
      expect(facts[0].object).toBe("San Francisco");
    });

    it("should get facts with filters", async () => {
      await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "session1",
        invalidatedAt: null,
      });

      await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "LOCATION",
        object: "NYC",
        confidence: 0.9,
        source: "session1",
        invalidatedAt: null,
      });

      const nameFacts = await adapter.getFacts("user1", { predicate: "NAME" });
      expect(nameFacts.length).toBe(1);
      expect(nameFacts[0].object).toBe("John");
    });

    it("should soft delete a fact", async () => {
      const fact = await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "DIET",
        object: "Omnivore",
        confidence: 0.9,
        source: "session1",
        invalidatedAt: null,
      });

      await adapter.deleteFact("user1", fact.id, "User changed diet");

      const validFacts = await adapter.getFacts("user1", { validOnly: true });
      expect(validFacts.length).toBe(0);

      const allFacts = await adapter.getFacts("user1", { validOnly: false });
      expect(allFacts.length).toBe(1);
      expect(allFacts[0].invalidatedAt).not.toBeNull();
    });
  });

  describe("Session Operations", () => {
    it("should create and retrieve sessions", async () => {
      const session = await adapter.createSession("user1");

      expect(session.id).toBeDefined();
      expect(session.userId).toBe("user1");
      expect(session.messageCount).toBe(0);
      expect(session.endedAt).toBeNull();

      const retrieved = await adapter.getSession("user1", session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(session.id);
    });

    it("should end a session with summary", async () => {
      const session = await adapter.createSession("user1");
      const ended = await adapter.endSession(
        "user1",
        session.id,
        "Discussed diet preferences"
      );

      expect(ended.endedAt).not.toBeNull();
      expect(ended.summary).toBe("Discussed diet preferences");
    });
  });

  describe("Conversation Operations", () => {
    it("should save and retrieve conversations", async () => {
      const session = await adapter.createSession("user1");

      const exchange = await adapter.saveConversation("user1", {
        userId: "user1",
        sessionId: session.id,
        userMessage: "My name is John",
        assistantResponse: "Nice to meet you, John!",
        timestamp: new Date(),
      });

      expect(exchange.id).toBeDefined();

      const history = await adapter.getConversationHistory("user1");
      expect(history.length).toBe(1);
      expect(history[0].userMessage).toBe("My name is John");
    });

    it("should filter conversations by session", async () => {
      const session1 = await adapter.createSession("user1");
      const session2 = await adapter.createSession("user1");

      await adapter.saveConversation("user1", {
        userId: "user1",
        sessionId: session1.id,
        userMessage: "Message in session 1",
        assistantResponse: "Response 1",
        timestamp: new Date(),
      });

      await adapter.saveConversation("user1", {
        userId: "user1",
        sessionId: session2.id,
        userMessage: "Message in session 2",
        assistantResponse: "Response 2",
        timestamp: new Date(),
      });

      const session1History = await adapter.getConversationHistory(
        "user1",
        undefined,
        session1.id
      );
      expect(session1History.length).toBe(1);
      expect(session1History[0].userMessage).toBe("Message in session 1");
    });
  });

  describe("Export/Import", () => {
    it("should export and import user data", async () => {
      await adapter.upsertFact("user1", {
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "session1",
        invalidatedAt: null,
      });

      const session = await adapter.createSession("user1");
      await adapter.saveConversation("user1", {
        userId: "user1",
        sessionId: session.id,
        userMessage: "Hello",
        assistantResponse: "Hi there!",
        timestamp: new Date(),
      });

      const exported = await adapter.exportUser("user1");
      expect(exported.facts.length).toBe(1);
      expect(exported.conversations.length).toBe(1);
      expect(exported.sessions.length).toBe(1);

      // Import to new user
      await adapter.importUser("user2", exported);

      const user2Facts = await adapter.getFacts("user2");
      expect(user2Facts.length).toBe(1);
    });
  });
});
