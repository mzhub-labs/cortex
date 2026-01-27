import { describe, it, expect } from "vitest";
import { MemoryEventEmitter } from "../src/events";

describe("MemoryEventEmitter", () => {
  it("should emit and receive events", () => {
    const emitter = new MemoryEventEmitter();
    let received = false;

    emitter.on("fact:created", (data) => {
      expect(data.userId).toBe("user1");
      expect(data.fact.subject).toBe("User");
      received = true;
    });

    emitter.emit("fact:created", {
      userId: "user1",
      fact: {
        id: "1",
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "session1",
        createdAt: new Date(),
        updatedAt: new Date(),
        invalidatedAt: null,
      },
    });

    expect(received).toBe(true);
  });

  it("should return unsubscribe function", () => {
    const emitter = new MemoryEventEmitter();
    let callCount = 0;

    const unsubscribe = emitter.on("session:start", () => {
      callCount++;
    });

    emitter.emit("session:start", {
      session: {
        id: "1",
        userId: "user1",
        startedAt: new Date(),
        endedAt: null,
        messageCount: 0,
      },
    });

    expect(callCount).toBe(1);

    unsubscribe();

    emitter.emit("session:start", {
      session: {
        id: "2",
        userId: "user1",
        startedAt: new Date(),
        endedAt: null,
        messageCount: 0,
      },
    });

    expect(callCount).toBe(1); // Should not increment
  });

  it("should support once listeners", () => {
    const emitter = new MemoryEventEmitter();
    let callCount = 0;

    emitter.once("cache:hit", () => {
      callCount++;
    });

    emitter.emit("cache:hit", { userId: "user1", query: "test" });
    emitter.emit("cache:hit", { userId: "user1", query: "test2" });

    expect(callCount).toBe(1);
  });

  it("should handle multiple listeners", () => {
    const emitter = new MemoryEventEmitter();
    const results: string[] = [];

    emitter.on("error", (data) =>
      results.push("handler1: " + data.error.message)
    );
    emitter.on("error", (data) =>
      results.push("handler2: " + data.error.message)
    );

    emitter.emit("error", { error: new Error("Test error") });

    expect(results).toEqual(["handler1: Test error", "handler2: Test error"]);
  });

  it("should track listener count", () => {
    const emitter = new MemoryEventEmitter();

    expect(emitter.listenerCount("fact:created")).toBe(0);

    const unsub1 = emitter.on("fact:created", () => {});
    const unsub2 = emitter.on("fact:created", () => {});

    expect(emitter.listenerCount("fact:created")).toBe(2);

    unsub1();
    expect(emitter.listenerCount("fact:created")).toBe(1);

    unsub2();
    expect(emitter.listenerCount("fact:created")).toBe(0);
  });

  it("should remove all listeners for an event", () => {
    const emitter = new MemoryEventEmitter();

    emitter.on("hydration:start", () => {});
    emitter.on("hydration:start", () => {});
    emitter.on("hydration:complete", () => {});

    expect(emitter.listenerCount("hydration:start")).toBe(2);
    expect(emitter.listenerCount("hydration:complete")).toBe(1);

    emitter.off("hydration:start");

    expect(emitter.listenerCount("hydration:start")).toBe(0);
    expect(emitter.listenerCount("hydration:complete")).toBe(1);
  });

  it("should remove all listeners", () => {
    const emitter = new MemoryEventEmitter();

    emitter.on("fact:created", () => {});
    emitter.on("session:start", () => {});

    emitter.removeAllListeners();

    expect(emitter.listenerCount("fact:created")).toBe(0);
    expect(emitter.listenerCount("session:start")).toBe(0);
  });

  it("should emit error event when handler throws", () => {
    const emitter = new MemoryEventEmitter();
    let errorReceived = false;

    emitter.on("fact:created", () => {
      throw new Error("Handler error");
    });

    emitter.on("error", (data) => {
      expect(data.error.message).toBe("Handler error");
      expect(data.context).toContain("fact:created");
      errorReceived = true;
    });

    emitter.emit("fact:created", {
      userId: "user1",
      fact: {
        id: "1",
        subject: "User",
        predicate: "NAME",
        object: "John",
        confidence: 0.9,
        source: "session1",
        createdAt: new Date(),
        updatedAt: new Date(),
        invalidatedAt: null,
      },
    });

    expect(errorReceived).toBe(true);
  });
});
