# Storage Adapters

mem-ts supports multiple storage backends through adapters. Choose based on your deployment needs.

---

## InMemoryAdapter

For development and testing. Data is lost when the process exits.

```typescript
import { InMemoryAdapter } from "mem-ts";

const adapter = new InMemoryAdapter();
```

**When to use:**

- Local development
- Unit tests
- Demos

---

## JSONFileAdapter

Stores data as JSON files on disk. Simple and portable.

```typescript
import { JSONFileAdapter } from "mem-ts/adapters";

const adapter = new JSONFileAdapter({
  path: "./.mem-ts", // Directory for storage
});
```

**File structure:**

```
.mem-ts/
├── users/
│   ├── user123/
│   │   ├── facts.json
│   │   ├── conversations.json
│   │   └── sessions.json
│   └── user456/
│       └── ...
```

**When to use:**

- Single-server deployments
- Prototypes
- When you want portable, inspectable data

---

## MongoDBAdapter

Production-ready adapter for MongoDB.

```typescript
import { MongoDBAdapter } from "mem-ts";

const adapter = new MongoDBAdapter({
  uri: process.env.MONGODB_URI,
  database: "myapp", // Optional, default: 'memts'
  collectionPrefix: "memory_", // Optional, default: 'memts_'
});
```

**Collections created:**

- `memory_facts` — User facts
- `memory_conversations` — Conversation history
- `memory_sessions` — Session metadata

**Indexes created automatically:**

- `(userId, subject, predicate)` on facts
- `(userId, timestamp)` on conversations

**When to use:**

- Production with MongoDB
- Document-based data model preference

---

## PostgresAdapter

Production-ready adapter for PostgreSQL.

```typescript
import { PostgresAdapter } from "mem-ts";

const adapter = new PostgresAdapter({
  connectionString: process.env.DATABASE_URL,
  schema: "memts", // Optional, default: 'memts'
});
```

**Tables created:**

- `memts.facts`
- `memts.conversations`
- `memts.sessions`

**When to use:**

- Production with PostgreSQL
- Works with Supabase, Neon, Railway, etc.
- Relational data model preference

---

## UpstashRedisAdapter

Serverless-friendly adapter using Upstash Redis REST API.

```typescript
import { UpstashRedisAdapter } from "mem-ts";

const adapter = new UpstashRedisAdapter({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
  prefix: "mem:", // Optional, default: 'memts:'
  cacheTtl: 3600, // Optional, TTL in seconds
});
```

**Key structure:**

- `mem:{userId}:facts` — Hash of facts
- `mem:{userId}:conversations` — List of conversations
- `mem:{userId}:sessions` — Hash of sessions

**When to use:**

- Edge functions (Vercel, Cloudflare Workers)
- Serverless deployments
- Hot cache layer

---

## TieredAdapter

Combines hot (fast) and cold (persistent) storage with automatic data movement.

```typescript
import { TieredAdapter, InMemoryAdapter } from 'mem-ts';
import { PostgresAdapter } from 'mem-ts/adapters';

const adapter = new TieredAdapter({
  hotAdapter: new InMemoryAdapter(),        // Fast, limited
  coldAdapter: new PostgresAdapter({...}),  // Slow, unlimited
  hotFactLimit: 50,           // Max facts in hot storage per user
  hotConversationLimit: 20,   // Max conversations in hot
  autoPromote: true,          // Promote to hot on access
  autoDemote: true,           // Demote old facts automatically
});
```

**How it works:**

1. **Reads**: Check hot first, fall back to cold
2. **Writes**: Write to both (durability + speed)
3. **Promotion**: Frequently accessed data moves to hot
4. **Demotion**: Old data is evicted from hot (still in cold)

**Methods:**

```typescript
await adapter.warmCache(userId); // Pre-populate hot storage
await adapter.promoteToHot(userId, factId);
await adapter.demoteFromHot(userId, factId);

const stats = await adapter.getStorageStats(userId);
// { hotFacts: 10, coldFacts: 150, hotConversations: 5, coldConversations: 200 }
```

**When to use:**

- High-traffic applications
- When you need both speed and unlimited storage
- Edge + database architectures

---

## Creating a Custom Adapter

Extend `BaseAdapter` and implement all methods:

```typescript
import { BaseAdapter, MemoryFact, ConversationExchange, Session } from 'mem-ts';

class MyAdapter extends BaseAdapter {
  async initialize(): Promise<void> { /* connect */ }
  async close(): Promise<void> { /* disconnect */ }

  async getFacts(userId: string, filter?): Promise<MemoryFact[]> { ... }
  async getFactById(userId: string, factId: string): Promise<MemoryFact | null> { ... }
  async upsertFact(userId: string, fact): Promise<MemoryFact> { ... }
  async updateFact(userId: string, factId: string, updates): Promise<MemoryFact> { ... }
  async deleteFact(userId: string, factId: string, reason?): Promise<void> { ... }
  async hardDeleteFact(userId: string, factId: string): Promise<void> { ... }

  async getConversationHistory(userId: string, limit?, sessionId?): Promise<ConversationExchange[]> { ... }
  async saveConversation(userId: string, exchange): Promise<ConversationExchange> { ... }

  async getSessions(userId: string, limit?): Promise<Session[]> { ... }
  async getSession(userId: string, sessionId: string): Promise<Session | null> { ... }
  async createSession(userId: string): Promise<Session> { ... }
  async endSession(userId: string, sessionId: string, summary?): Promise<Session> { ... }
}
```
