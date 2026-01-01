import type { MemoryFact, Session, ExtractionResult } from "../types";

/**
 * Event types for MemoryOS
 */
export interface MemoryEvents {
  "fact:created": { fact: MemoryFact; userId: string };
  "fact:updated": { fact: MemoryFact; oldFact: MemoryFact; userId: string };
  "fact:deleted": { fact: MemoryFact; reason?: string; userId: string };
  "session:start": { session: Session };
  "session:end": { session: Session };
  "extraction:start": { userId: string; sessionId: string };
  "extraction:complete": {
    result: ExtractionResult;
    userId: string;
    sessionId: string;
  };
  "hydration:start": { userId: string; message: string };
  "hydration:complete": {
    userId: string;
    factsCount: number;
    fromCache: boolean;
  };
  "cache:hit": { userId: string; query: string };
  "cache:miss": { userId: string; query: string };
  error: { error: Error; context?: string };
}

type EventHandler<T> = (data: T) => void;

/**
 * Simple event emitter for MemoryOS events.
 * Provides type-safe event handling.
 */
export class MemoryEventEmitter {
  private handlers: Map<keyof MemoryEvents, Set<EventHandler<unknown>>> =
    new Map();

  /**
   * Subscribe to an event
   */
  on<K extends keyof MemoryEvents>(
    event: K,
    handler: EventHandler<MemoryEvents[K]>
  ): () => void {
    let handlers = this.handlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(event, handlers);
    }
    handlers.add(handler as EventHandler<unknown>);

    // Return unsubscribe function
    return () => {
      handlers?.delete(handler as EventHandler<unknown>);
    };
  }

  /**
   * Subscribe to an event once
   */
  once<K extends keyof MemoryEvents>(
    event: K,
    handler: EventHandler<MemoryEvents[K]>
  ): () => void {
    const wrappedHandler = (data: MemoryEvents[K]) => {
      unsubscribe();
      handler(data);
    };
    const unsubscribe = this.on(event, wrappedHandler);
    return unsubscribe;
  }

  /**
   * Emit an event
   */
  emit<K extends keyof MemoryEvents>(event: K, data: MemoryEvents[K]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          // Emit error event if handler fails (avoid infinite loop)
          if (event !== "error") {
            this.emit("error", {
              error: error instanceof Error ? error : new Error(String(error)),
              context: `Handler for ${event} threw an error`,
            });
          }
        }
      }
    }
  }

  /**
   * Remove all handlers for an event
   */
  off<K extends keyof MemoryEvents>(event: K): void {
    this.handlers.delete(event);
  }

  /**
   * Remove all handlers
   */
  removeAllListeners(): void {
    this.handlers.clear();
  }

  /**
   * Get handler count for an event
   */
  listenerCount<K extends keyof MemoryEvents>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
