# Side Conversation Handoff: Medusa Runtime Priority

This file records a side-conversation decision so the main thread can continue
with the right context.

## Decision

The current priority remains making the Medusa runtime work on Cloudflare.

Do not shift the active implementation goal into the future Flarex/Convex-like
developer API yet. The developer API direction is still valid, but it belongs
after the trusted Medusa runtime is stable enough to run real commerce behavior
on Cloudflare.

## How To Interpret Current Endpoint Proofs

Endpoint proofs are still useful, but they are not the final product API.

They are a runtime validation harness for:

- Medusa HTTP bootstrap and route registration without Express.
- Fetch request/response adaptation.
- Auth/session preparation.
- Request scope and container bindings.
- Real Medusa services and workflows.
- Remote Query and query graph bindings.
- Event Bus, Workflow Engine, locking, and persistence adapters.
- Worker-safe import graph constraints.
- Durable Object SQLite, D1 projections, Queues, and alarms.

Do not chase full REST completeness route by route as the end goal. Prove
routes only when they expose or validate a reusable Medusa runtime boundary.

## Future Platform Direction

The long-term platform direction remains:

```text
platform gateway
  -> tenant/auth/billing/deployment resolution
  -> isolated user code runtime
  -> restricted ctx APIs
      ctx.db        -> Flarex custom app data
      ctx.commerce  -> trusted Medusa commerce facade
  -> internal platform calls
      -> Medusa services/workflows/modules
      -> Flarex partitions/sync/projections
```

However, do not implement `ctx.commerce` or developer-facing Flarex APIs in the
current runtime slice. Build the Medusa runtime foundation first.

## Next Runtime Slice

The next recommended main-thread slice is production partition selection for
cart routes without the internal proof header.

Current proven path uses an internal opt-in header:

```http
x-medusa-partition-key: cart_123
```

Next proof should derive the cart partition from the route itself:

```text
/store/carts/:id -> cart partition :id
```

Start narrowly with:

```text
GET /store/carts/:id without x-medusa-partition-key
```

Then expand only after that passes:

```text
POST /store/carts/:id
POST /store/carts/:id/line-items
DELETE /store/carts/:id/line-items/:line_id
POST /store/carts/:id/complete
```

## Why This Is The Right Next Slice

- It is Medusa runtime work, not future developer API work.
- It removes an internal proof header from a real route family.
- Cart is the strongest partitioned-write candidate.
- It validates app-root runtime routing into Durable Object partitions.
- It keeps using unchanged Medusa route handlers/services/workflows as the
  behavioral reference.
- It moves the Worker closer to running selected production Medusa route groups
  by default.

## Boundary Warning

Do not interpret this as a decision to route every Medusa REST endpoint through
cart Durable Objects. Cart URL-derived partitioning is only for cart-owned
routes where the cart ID is naturally available in the URL.

Product/catalog listing, broad filtering, and sorting likely belong to D1 or
other projection/read-model paths. Auth/session routes need a separate
partition policy because there is no cart ID in the URL.
