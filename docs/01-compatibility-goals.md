# Compatibility Goals

The Cloudflare runtime should preserve Convex's approachable developer and
client APIs. It deliberately changes the consistency contract where Cloudflare
cannot provide arbitrary global transactions efficiently.

## Primary Goal

Existing Convex-style code should continue to look like this:

```ts
import { defineSchema, defineTable } from "./_generated/server";
import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    roomId: v.id("rooms"),
    body: v.string(),
  }).index("by_room", ["roomId"]),
});

export const list = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_room", q => q.eq("roomId", args.roomId))
      .collect();
  },
});

export const send = mutation({
  args: { roomId: v.id("rooms"), body: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
  },
});
```

The generated files, function builders, validators, table definitions, and
client calls should remain familiar. The developer should not learn a new
database API just because the backend runs on Cloudflare.

## What Must Stay Compatible

### TypeScript Developer API

Keep these concepts:

- `defineSchema`
- `defineTable`
- `.index(...)`
- validators from `convex/values`
- generated `_generated/server`
- generated `_generated/api`
- generated data model types
- `query`, `internalQuery`
- `mutation`, `internalMutation`
- `action`, `internalAction`
- `httpAction`
- `ctx.db`
- `ctx.auth`
- `ctx.scheduler`
- `ctx.storage`
- `ctx.runQuery`, `ctx.runMutation`, `ctx.runAction`

The Cloudflare backend may compile and package source differently, but the app
authoring model should stay familiar.

Cloudflare-specific additions are intentionally small:

- `partitionBy` and `colocateWith` declare authoritative transaction placement
- `defineProjection` declares derived live read models
- `workflowMutation` declares durable cross-partition operations

### Client API

The normal npm client API should remain the compatibility test:

- `new ConvexClient(...)`
- `useQuery`
- `useMutation`
- `useAction`
- `ConvexReactClient`
- generated `api.*` references
- optimistic updates where supported by the client
- WebSocket reconnect and resubscription behavior

If the existing client cannot talk to the Cloudflare backend, treat that as a
backend compatibility bug first.

### HTTP API

Support the public function endpoints:

```txt
POST /query
POST /mutation
POST /action
POST /query_batch
POST /function
POST /function/{path...}/{functionName}
GET  /query
POST /query_at_ts
GET  /query_ts
```

The payload shape should remain compatible with `UdfPostRequest`:

```json
{
  "path": "messages:list",
  "args": {},
  "format": "convex_encoded_json"
}
```

Responses should preserve the `UdfResponse` shape:

```json
{
  "status": "success",
  "value": {}
}
```

or:

```json
{
  "status": "error",
  "errorMessage": "...",
  "errorData": null
}
```

### Sync Protocol

Support both endpoint spellings used by the backend:

```txt
GET /sync
GET /{client_version}/sync
```

The protocol should preserve these concepts:

- connect/auth message
- query set modifications
- query set version
- state version
- transition messages
- mutation messages
- mutation responses
- action messages
- action responses
- server-driven query invalidation and rerun
- reconnect with session identity where possible

The goal is not just to push JSON diffs. The goal is to preserve Convex's live
query model where the server knows which query dependencies remain valid.

## What Can Change

These can be implemented differently:

- local Rust isolate can become Dynamic Workers
- Tokio sync worker can become Durable Object session state
- authoritative storage can become partition Durable Object SQLite
- global list/read models can become declarative projections
- cross-partition writes can become generated Cloudflare Workflow plans
- subscription invalidation can follow partition commits and projection updates
- node action callbacks can become authenticated Worker-to-Worker syscalls

The compatibility rule is: preserve familiar APIs and make semantic differences
explicit rather than silently weakening guarantees.

## Deliberate Semantic Differences

Normal Convex:

```txt
one bounded mutation may atomically touch arbitrary documents
```

Primary Cloudflare-native design:

```txt
mutation
  atomic inside one partition

workflowMutation
  durable across partitions
  not globally atomic

projection
  live derived data
  not authoritative mutation input
```

The platform must not claim full Convex transaction compatibility for the
partitioned design.

## Compatibility Boundary

The repo already has a useful boundary: `ApplicationApi`. The Cloudflare port
should provide an equivalent implementation for:

- `authenticate`
- `execute_public_query`
- `execute_public_mutation`
- `execute_public_action`
- `execute_http_action`
- `execute_any_function`
- `latest_timestamp`
- `subscription_client`
- storage authorization and file APIs

The route layer and sync layer should call a Cloudflare implementation through
that shape instead of learning about partition Durable Objects or Dynamic
Workers directly.

## Acceptance Tests

Use compatibility tests that exercise the same client API:

1. Generate schema and API files for a small app.
2. Start the Cloudflare backend locally.
3. Run `ConvexReactClient` or `ConvexClient` against `/sync`.
4. Subscribe to a query.
5. Run a mutation from the client.
6. Verify the subscribed query updates without a manual refetch.
7. Verify same-partition concurrent mutations serialize correctly.
8. Run actions that call mutations and verify side effects are not retried as
   part of mutation retry.
9. Verify accidental cross-partition mutation commits nothing.
10. Verify `workflowMutation` groups operations by partition.

The backend is not compatible until this path works through the real client,
not only through direct internal tests.
