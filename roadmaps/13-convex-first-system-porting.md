# Convex-First System Porting Policy

## Decision

Flarex should be developed as a Convex-first system across backend, runtime,
SDK, generated APIs, local dev, sync, scheduling, validation, deployment
metadata, and testing.

The default implementation rule is:

1. inspect the relevant Convex source before designing a Flarex feature,
2. copy or closely port Convex's behavior and public API shape when portable,
3. diverge only when Cloudflare runtime constraints, Durable Object
   partitioning, service bindings, licensing, or an intentional Flarex API
   difference requires it,
4. record the divergence in the relevant domain roadmap.

This policy applies beyond TypeScript type generation. It also applies to:

- OCC and transaction semantics
- document IDs, table mapping, and schema metadata
- sync and subscription invalidation
- function registration and analysis
- generated `_generated/*` files
- client APIs and transports
- local dev server behavior
- scheduler/workflow semantics
- validation and value serialization
- test strategy and simulation strategy

## Why

The goal is not to build a generic Cloudflare CRUD backend. The goal is to make
a Convex-like platform on Cloudflare where the developer mental model and core
runtime behavior stay close to Convex unless the Cloudflare architecture forces
a named difference.

Convex is the proven reference system. Flarex should use Convex's implementation
as the first design input, then adapt it carefully to Cloudflare Workers,
Durable Objects, Miniflare, and Flarex's partition/shard model.

## Convex References

Current high-level reference areas:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - Long-running dev loop, file watching, codegen, push, log watching, and
    backend-state watching.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Generated file preparation, dependency-ordered writes, stale file cleanup,
    and function typechecking.
- `npm-packages/convex/src/cli/codegen_templates`
  - Generated API, server, and data-model shape.
- `npm-packages/convex/src/server`
  - Function registration, query/mutation/action builder APIs, validator-driven
    handler typing, and runtime helpers.
- `crates/database/src/transaction.rs`
  - Core OCC transaction model.
- `crates/database/src/committer.rs`
  - Commit validation and persistence shape.
- `crates/sync`
  - Subscription and sync engine reference.
- `crates/model`
  - Schema, table mapping, indexes, and deployment metadata reference.

Future roadmap records should cite narrower files and functions as features are
implemented.

## Cloudflare Difference

Convex's backend can coordinate execution, OCC, sync, and persistence inside its
own Rust-managed backend/runtime. Flarex has to split those responsibilities
across Workers, Durable Objects, service bindings, and possibly Miniflare in
local dev.

That difference does not remove the Convex-first rule. It means the expected
workflow is:

```txt
Convex behavior/API -> identify portable pieces -> port closely -> isolate
Cloudflare-specific boundary -> document the difference
```

Examples of acceptable divergence:

- Durable Object partitioning requires explicit shard boundaries where Convex
  can use one deployment database transaction.
- Local dev should use Miniflare-managed Workers/DOs instead of Convex's local
  Rust backend process.
- User code should call backend syscalls over service bindings instead of
  Convex's in-process V8/Rust syscall path.

## Follow-Up Work

1. Before each new feature, add the specific Convex files inspected to the
   domain roadmap.
2. Replace prototype-only implementations when a closer Convex-compatible port
   is practical.
3. Keep a short list of intentional differences so they do not accidentally
   become hidden compatibility breaks.
4. When a Flarex API differs from Convex, prefer generated/type-level guidance
   and clear runtime errors.

## Verification

Documentation-only change. No runtime verification was required.
