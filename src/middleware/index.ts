import type { MemoryOS } from "../MemoryOS";
import type { HydratedContext } from "../types";

/**
 * Express/Connect-style request object
 */
export interface MiddlewareRequest {
  body?: { userId?: string; message?: string; [key: string]: unknown };
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
  user?: { id?: string; userId?: string; [key: string]: unknown };
  memoryContext?: HydratedContext;
}

/**
 * Express/Connect-style response object
 */
export interface MiddlewareResponse {
  locals?: Record<string, unknown>;
  json?: (body: unknown) => void;
  on?: (event: string, callback: () => void) => void;
}

/**
 * Next function to call the next middleware
 */
export type NextFunction = (error?: unknown) => void;

/**
 * Options for the memory middleware
 */
export interface MemoryMiddlewareOptions {
  /** Function to extract userId from request */
  getUserId?: (req: MiddlewareRequest) => string | undefined;
  /** Function to extract user message from request */
  getMessage?: (req: MiddlewareRequest) => string | undefined;
  /** Attach context to request object */
  attachToRequest?: boolean;
  /** Auto-digest on response finish (requires response body capture) */
  autoDigest?: boolean;
}

/**
 * Result attached to request/response
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      memoryContext?: HydratedContext;
    }
    interface Locals {
      memoryContext?: HydratedContext;
    }
  }
}

/**
 * Create Express middleware for automatic context hydration.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { MemoryOS } from 'cortex';
 * import { createMemoryMiddleware } from 'cortex/middleware';
 *
 * const app = express();
 * const memory = new MemoryOS({ ... });
 *
 * app.use('/chat', createMemoryMiddleware(memory, {
 *   getUserId: (req) => req.user?.id,
 *   getMessage: (req) => req.body?.message,
 * }));
 *
 * app.post('/chat', (req, res) => {
 *   const context = req.memoryContext;
 *   // Use context.compiledPrompt in your LLM call
 * });
 * ```
 */
export function createMemoryMiddleware(
  memory: MemoryOS,
  options: MemoryMiddlewareOptions = {},
) {
  const {
    getUserId = (req) => req.user?.id || req.user?.userId || req.body?.userId,
    getMessage = (req) => req.body?.message,
    attachToRequest = true,
  } = options;

  return async (
    req: MiddlewareRequest,
    res: MiddlewareResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = getUserId(req);
      const message = getMessage(req);

      if (!userId || !message) {
        return next();
      }

      // Hydrate context
      const context = await memory.hydrate(userId, message);

      // Attach to request
      if (attachToRequest) {
        req.memoryContext = context;
        if (res.locals) {
          res.locals.memoryContext = context;
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Helper function to digest after response in Express.
 * Call this after sending the response.
 *
 * @example
 * ```typescript
 * app.post('/chat', async (req, res) => {
 *   const response = await callLLM(req.memoryContext, req.body.message);
 *   res.json({ message: response });
 *
 *   // Digest in background
 *   digestAfterResponse(memory, req.user.id, req.body.message, response);
 * });
 * ```
 */
export function digestAfterResponse(
  memory: MemoryOS,
  userId: string,
  userMessage: string,
  assistantResponse: string,
): void {
  // Fire and forget
  setImmediate(() => {
    memory.digest(userId, userMessage, assistantResponse);
  });
}

/**
 * Create a Next.js API route handler wrapper.
 *
 * @example
 * ```typescript
 * // pages/api/chat.ts or app/api/chat/route.ts
 * import { withMemory } from 'cortex/middleware';
 *
 * export const POST = withMemory(memory, async (req, context) => {
 *   const { message } = await req.json();
 *   const response = await callLLM(context.compiledPrompt, message);
 *   return Response.json({ message: response });
 * }, {
 *   getUserId: (req) => req.headers.get('x-user-id'),
 * });
 * ```
 */
export function withMemory<
  T extends { json: () => Promise<{ message?: string; userId?: string }> },
>(
  memory: MemoryOS,
  handler: (req: T, context: HydratedContext) => Promise<Response>,
  options: {
    getUserId?: (req: T) => string | null | undefined;
    getMessage?: (body: { message?: string }) => string | undefined;
  } = {},
) {
  return async (req: T): Promise<Response> => {
    try {
      const body = await req.json();
      const userId = options.getUserId?.(req) || body?.userId;
      const message = options.getMessage?.(body) || body?.message;

      if (!userId || !message) {
        return new Response(
          JSON.stringify({ error: "userId and message are required" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const context = await memory.hydrate(userId, message);
      return handler(req, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}
