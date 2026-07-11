# Convex-First System Porting Policy

## Require Evidence-First Design Challenge

Previous completed checkpoint: `ca565e7` Persist immutable schema artifacts.

What changed:

- Added an explicit `AGENTS.md` rule that treats user proposals, markdown,
  current code, and an agent's own first idea as hypotheses to pressure-test.
  Agents must identify concrete contradictions, duplicate authorities, unsafe
  trust/transaction boundaries, stale assumptions, failure gaps, and smaller
  correctness-preserving alternatives without manufacturing objections.
- Corrected replacement-source precedence. The accepted design remains first;
  the v1 cutline controls inventory/deferrals; focused foundation plans control
  active slice refinements; and the long-form internal schema is explicitly a
  proposal/provenance source whose unrefined DDL is not automatically accepted.
- Removed the duplicated roadmap map and stale deployment-scoped Durable Object
  name list from `AGENTS.md`. The maintained roadmap index now owns those
  details, and historical `DO`/`partition`/`shard` filenames do not imply active
  architecture.
- Updated durable backend language to use Postgres authority, exact snapshot
  tokens, scope-local commit sequences, host-neutral short transactions, and
  proportional verification. Cloudflare provisioning and broad unrelated
  suites are no longer implied by a narrow core slice.

Why it changed:

`AGENTS.md` is an operating contract, not a second roadmap. Volatile copies had
already drifted from accepted S03 identities, the Postgres-authoritative host
decision, scope-owned coordination, and the user's preference for explicit
design pushback. Keeping only durable rules makes future critiques more likely
to catch mixed old/new assumptions before they become migrations.

Convex sources inspected:

- No new Convex source inspection was needed for this governance-only change.
  The existing Convex-first requirement and source-routing policy are retained.

How Flarex differs:

- Flarex has several migration-era documents and Cloudflare compatibility
  hosts around one Postgres authority. That makes explicit source precedence
  and stale-assumption checks more important than in a single-backend design.
- Cloudflare remains a host and coordination boundary, but no longer appears in
  the operating rules as the explanation for every database divergence.

Known limitations and follow-up:

- This checkpoint does not adjudicate the proposed S03-B2 table-definition
  shape or rewrite historical roadmap entries; those remain separate design
  decisions with their original provenance.
- Exact active actor names and milestone status must stay in their owning
  roadmap/code and may still require focused cleanup when touched.

Verification:

```sh
git diff --check -- AGENTS.md roadmaps/README.md roadmaps/13-convex-first-system-porting.md
```

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
