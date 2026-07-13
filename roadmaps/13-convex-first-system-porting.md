# Convex-First System Porting Policy

## Status And Scope

Status: active cross-system policy.

This roadmap defines how Flarex uses Convex as its primary behavioral and
developer-model reference across backend, storage, execution, generated APIs,
sync, deployment, local development, clients, and tests. It does not own the
current implementation status of those domains or chronological porting
history.

[`../AGENTS.md`](../AGENTS.md) owns the operating rule and design-source
precedence. Domain roadmaps own each accepted port/divergence and its current
status.

## Core Rule

For every material system feature:

1. Inspect the relevant current Convex source and tests before designing the
   Flarex behavior.
2. Port the developer mental model, public API, invariants, and implementation
   pattern closely when portable and licensed for the intended use.
3. Identify the exact runtime/storage boundary that prevents a close port.
4. Choose the smallest named Flarex divergence that preserves correctness.
5. Record the Convex sources, retained semantics, divergence, limitations, and
   verification in the owning living domain roadmap when those durable facts
   change.

Do not invent a new framework abstraction when Convex already supplies a
portable pattern. Do not copy an implementation shape whose assumptions do not
survive Postgres, Cloudflare isolation, service bindings, or licensing.

## Evidence-First Challenge

Treat user proposals, existing markdown, current code, historical prototypes,
and the agent's first idea as hypotheses.

Before promoting a design, compare it with:

- [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
  and other accepted design records;
- current Convex behavior and source;
- current Flarex schemas, code, and decisive tests;
- the active slice boundary; and
- known migration and rollback requirements.

Call out concrete contradictions, duplicate authorities, unsafe trust or
transaction boundaries, missing failure/recovery behavior, stale assumptions,
premature abstractions, and smaller correctness-preserving alternatives. Do
not manufacture objections after a proposal survives the evidence.

Current code is compatibility evidence, not automatic future authority.
Historical filenames containing `DO`, `partition`, or `shard` do not promote
their architecture over the accepted Postgres-authoritative replacement.

## System Coverage

The Convex-first rule applies to:

- schema definition, validators, table identity, document IDs, values, and
  ordered index keys;
- exact snapshots, OCC dependencies, transaction retries, idempotency, and
  committed outcomes;
- query/mutation/action registration and restricted syscall APIs;
- function references, visibility, analysis, deployment metadata, and
  backend-authoritative codegen;
- generated `_generated/server`, `_generated/dataModel`, and API surfaces;
- client query/mutation/watch semantics and React bindings;
- live-query activation, subscription tokens, result hashing, reruns, and
  ordered transitions;
- scheduling, maintenance, recovery, and operational errors;
- local dev, push, bundling, source-package identity, and artifact lifecycle;
  and
- testing strategy, simulation, conformance, and failure injection.

Each feature should cite the narrowest relevant Convex files/functions rather
than repeating only broad crate or package names.

## Current Flarex Boundaries

Flarex's accepted storage/runtime topology differs from Convex in specific
ways:

- Postgres is the only authoritative committed app-data store.
- Untrusted developer modules run in generated Dynamic Workers.
- Restricted syscalls cross a private service binding to a trusted executor
  Worker.
- The executor uses request-scoped Postgres clients through cache-disabled
  Hyperdrive in hosted production.
- Convex can retain an active mutation snapshot inside one backend execution.
  Flarex crosses Dynamic Worker, service-binding, retry, and Postgres
  lifetimes, so S07 adds a small authoritative transaction-session anchor and
  constrained current-attempt snapshot lease. This preserves exact-snapshot
  and fenced-retry semantics while naming the distributed-execution divergence.
- Cloudflare Durable Objects own WebSockets, coordination, temporary session
  bookkeeping when measurement justifies it, and disposable cache state—not
  authoritative committed data.
- Control/data placement and storage-generation migration require explicit
  scope locators, fences, backfill, comparison, cutover, and rollback.

These differences require explicit adapters and recovery protocols. They do
not justify changing ordinary developer APIs away from Convex without a
separate accepted reason.

## Acceptable Divergence Tests

A Flarex divergence is acceptable only when at least one is true:

- Cloudflare runtime isolation or service-binding placement requires it;
- Postgres transaction, lock, indexing, or operational behavior requires it;
- partitioning of physical infrastructure is internal and cannot preserve a
  Convex implementation detail transparently;
- licensing prevents a close code port;
- a deliberately different public Flarex API has been accepted and documented;
  or
- evidence shows the Convex pattern is not portable to the declared slice.

Even then:

- preserve the closest developer mental model;
- keep the divergence behind a narrow adapter or typed boundary;
- expose limitations and typed errors instead of pretending transparency;
- define failure, retry, recovery, and compatibility behavior; and
- add tests comparing the portable semantics with Convex expectations.

Cloudflare hosting by itself is not a blanket reason to diverge. Neither is
the existence of legacy Durable Object prototype code.

## Reference Areas

Common starting points include:

- `npm-packages/convex/src/server` for function registration, validators, and
  developer APIs;
- `npm-packages/convex/src/cli/lib/dev.ts`, `codegen.ts`, and codegen templates
  for local development, push, and generated files;
- `crates/database/src/transaction.rs`, `reads.rs`, and `committer.rs` for OCC,
  dependencies, and authoritative commit;
- `crates/database/src/subscription.rs` and `crates/sync` for subscriptions and
  ordered live-query state;
- `crates/model` for schema, indexes, deployment metadata, and lifecycle; and
- existing Convex tests beside each implementation for edge-case semantics.

Owning domain roadmaps must narrow these references for actual implementation
slices.

## Durable Follow-Up Rule

When a port changes durable system truth, the owning roadmap records:

- the Convex behavior and exact sources inspected;
- what Flarex preserves;
- why any divergence is necessary;
- the trust, transaction, failure, and recovery implications;
- known compatibility gaps; and
- the next correctness gate.

Commit messages and per-turn verification receipts remain in Git/task reports,
not in this policy or other living roadmaps.
