# Flarex Query Sync Engine Roadmaps

## Status And Scope

**Status:** accepted architecture and roadmap authority. `QSYNC01-A`,
`QSYNC01-B`, `QSYNC01-C1`, `QSYNC01-C2`, and `QSYNC01-C3` are complete,
private, and production-inert. The accepted
[`QSYNC01-C` umbrella](./preflight/03-qsync01-effect-orchestration.md) keeps C4
separately gated. The proposed
[`QSYNC01-C4` preflight](./preflight/06-qsync01-c4-publication-orchestration.md)
proposes the next bounded publication-orchestration decision but is not
implementation authority. The exact
[`QSYNC01-C3` record](./preflight/05-qsync01-c3-bounded-evaluation-orchestration.md)
owns the completed bounded evaluation-orchestration slice.

[`QSYNC01-P`](./preflight/00-qsync01-framework-authority.md), the
independent-engine preflight, remains docs-only authority. The user separately
approved [`QSYNC01-A`](./preflight/01-qsync01-portable-transition-kernel.md)
and [`QSYNC01-B`](./preflight/02-qsync01-trusted-change-and-atomic-state.md).
Together they implement the private pure kernel, admitted change boundary,
semantic transition-state port, and deterministic reference/conformance
adapters. They add no real durable adapter, Durable Object, route, client API,
or production caller.

This roadmap family owns the runtime-neutral semantics for synchronizing
authoritative server-query results:

- namespace-isolated ordered change admission;
- canonical query, dependency, generation, dirty-frontier, and result state;
- deterministic invalidation, rerun, activation, and unchanged-result
  decisions;
- semantic state-store and query/publication capability contracts;
- failure, reset, boundedness, and conformance requirements; and
- the migration boundary from the current backend-local sync work into one
  independently testable framework package.

It does **not** own PostgreSQL commit or application-row authority, OCC,
transaction journals, commit compilation, application query execution,
Cloudflare Durable Object lifecycle, stream transport, client sessions, public
SDK ergonomics, row replication, offline writes, conflict resolution, CRDTs,
or a general event bus.

The product is a **query-result synchronization engine**. It is deliberately
not advertised as a universal data-sync database.

## Authority Order

Use these authorities in order for query-sync work:

1. [`../../design-notes/runtime-agnostic-query-sync-engine.md`](../../design-notes/runtime-agnostic-query-sync-engine.md)
   owns the accepted cross-domain architecture decision.
2. This roadmap family owns portable engine semantics, status, package
   boundaries, and ordered implementation gates.
3. [`../21-cloudflare-freshness-cache.md`](../21-cloudflare-freshness-cache.md)
   owns the Flarex Cloudflare host composition, per-scope placement, Postgres
   adapter, Durable Streams adapter, recovery scheduling, and deferred caches.
4. `flarex-protocol` owns concrete versioned Flarex wire and persisted
   contracts. Those contracts are adapter inputs; they do not define the
   generic engine vocabulary.
5. `@flarex/persistence-postgres` owns the authoritative Flarex commit feed,
   retained floor, scope epoch, snapshot, application facts, and transactional
   outbox behavior.
6. The upstream Durable Streams protocol and packages own stream offsets,
   append/read semantics, transport resume, SSE/long-poll behavior, and their
   own conformance contract.
7. The native relational roadmap owns `R03-B` as a consumer. It cannot repair,
   duplicate, or bypass this engine or its Cloudflare/Postgres adapters.

When these documents disagree, portable semantics stay here and concrete
Flarex/Postgres/Cloudflare mappings stay in their adapter owners. Current code
and tests remain the authority for behavior already implemented.

## Current Implementation Boundary

The independent private `@flarex/query-sync` package now contains the pure
runtime-neutral transition kernel, the trusted replayable-source and
invalidation-projection boundary, nominal refresh admission, retry-safe
evaluation begin/completion plus atomic publication intent, durable evaluation
selection and publication-attempt state, a receipt-only semantic transition
port, a private bounded catch-up/evaluation coordinator, and deterministic
reference/conformance adapters including a reference query evaluator accepted
through `QSYNC01-C3`. The coordinator is exposed only through the deliberate
private `./internal/orchestration` subpath. The package has no publisher,
package-root export, production caller, or real host, persistence, network, or
delivery adapter.

Current production-inert work under `flarex-backend/deploymentSync`,
`DeploymentSyncDO`, and `flarex-protocol/internal/scope-sync-v1` proves useful
cursor, dependency, canonical-query, and generation ideas, but it is coupled
to Flarex scope identities, Postgres commit records, and Cloudflare SQLite.
It is migration evidence, not the portable engine authority.

`SYNC01-GP` previously authorized adding substantially more query state to the
backend-local Durable Object store. That authorization is superseded and held.
No agent may implement `SYNC01-G` from its old package-local prescription.
Useful canonical-frame, collision, active/provisional coexistence, corruption,
and synchronous-SQLite requirements remain inputs to the later Flarex adapter
preflight.

No production sync caller changes because of `QSYNC01-A` through `QSYNC01-C3`.

## Target Architecture

```text
trusted application or database owner
  -> replayable ChangeSource plus optional wake hint
  -> admitted model-specific invalidation facts
                         |
                         v
                @flarex/query-sync
      namespace cursor and ordered admission
      canonical query and generation policy
      dependency invalidation and dirty frontier
      rerun/activation/result-hash decisions
      semantic store and publication capabilities
                         |
              host-owned adapters and composition
        +----------------+------------------+
        |                                   |
        v                                   v
Flarex Postgres/Cloudflare             reference/test host
  commit-feed adapter                    deterministic model
  per-scope coordinator DO
  SQLite state adapter
  accepted delivery publisher
    (Durable Streams candidate)
        |
        v
authenticated Durable Stream -> @durable-streams/client -> Flarex SDK adapter
```

The framework is independently developable and testable. It is not independently
deployable without a trusted change source, query evaluator, durable state
adapter, publication adapter, authentication gateway, and host lifecycle.

## Package Direction

The first package is one private `@flarex/query-sync` workspace member with
explicit internal subpaths. Do not start with separate contracts, engine,
testing, Cloudflare, Postgres, and client packages.

The package may initially depend only on:

- `effect`; and
- an exact `@flarex/utils` dependency-leaf primitive when reuse is proven.

It must not import `flarex-protocol`, `@flarex/persistence-postgres`,
`flarex-backend`, Cloudflare types, database drivers, Electric packages,
WebSocket/HTTP frameworks, or application-specific row/relation types.

The deterministic reference model belongs behind a deliberate testing subpath
in the same package. Split another package only after a real second owner or a
public compatibility contract makes that boundary concrete.

## Gate Sequence

| Gate | Outcome | Status |
| --- | --- | --- |
| `QSYNC01-P` | Freeze product scope, authority, package direction, Electric/Durable Streams decision, migration constraints, and the first medium slice | Complete, docs only |
| `QSYNC01-A` | Pure transition kernel plus immutable deterministic reference model | Complete; private and production-inert |
| `QSYNC01-B` | Trusted change-model boundary and semantic atomic state-store contract derived from the reference transitions | Complete; private and production-inert |
| `QSYNC01-C` | Recovery-stable work/publication state followed by Effect-native catch-up, evaluation fencing, rerun coalescing, and publication recovery over reference capabilities | C1 complete in `b6621cf3`; C2 complete in `1df70907`; C3 complete in `a9b309d0`, private, and production-inert; exact C4 preflight proposed, implementation not authorized |
| `QSYNC-CF01` | Production-inert Cloudflare Durable Streams feasibility spike covering lifecycle cost, auth, retention, payload, and failure recovery | Preflight required; may run after the portable kernel is stable |
| `QSYNC-FX01` | Flarex model/change/result mappings plus the first Cloudflare SQLite implementation of the complete post-C semantic state contract, including query-result publication outbox state | Blocked on `QSYNC01-C`; independent of delivery-adapter selection |
| `QSYNC-FX02` | Postgres catch-up, authenticated query registration/evaluation/rerun host composition, and processing of the already-semantic publication outbox | Blocked on `QSYNC-FX01` |
| `QSYNC-FX03` | Accepted delivery adapter, client gateway/SDK adoption, reconnect/reset proof, Legacy path retirement, and `R03-B` integration | Blocked on `QSYNC-FX02` plus an accepted delivery-adapter gate such as `QSYNC-CF01` |
| portability proof | The same conformance contract through a second real durable host/store | Required before claiming proven runtime portability |

Each gate requires its own bounded preflight. A later gate does not authorize
adjacent public APIs, production routing, schema changes, or compatibility
paths.

## Roadmap Files

- [`01-product-authority-and-package.md`](./01-product-authority-and-package.md)
  defines the product, vocabulary, trust boundaries, API planes, and package
  ownership.
- [`02-engine-state-and-lifecycle.md`](./02-engine-state-and-lifecycle.md)
  defines the state model, semantic operations, Effect/lifecycle rules,
  failures, transactions, and limits.
- [`03-cloudflare-durable-streams-composition.md`](./03-cloudflare-durable-streams-composition.md)
  records the Electric/Durable Streams choice and the Cloudflare-native
  delivery risk gates.
- [`04-conformance-and-flarex-adoption.md`](./04-conformance-and-flarex-adoption.md)
  defines reference/conformance evidence, migration, integration order, and
  the no-dual-engine cutover rule.
- [`preflight/00-qsync01-framework-authority.md`](./preflight/00-qsync01-framework-authority.md)
  records the completed docs-only product, authority, package, adapter, and
  adoption decision.
- [`preflight/01-qsync01-portable-transition-kernel.md`](./preflight/01-qsync01-portable-transition-kernel.md)
  is the completed preflight and implementation record for the first medium
  slice.
- [`preflight/02-qsync01-trusted-change-and-atomic-state.md`](./preflight/02-qsync01-trusted-change-and-atomic-state.md)
  freezes the trusted source/model, nominal refresh-admission, four-operation
  semantic state, Effect, uncertainty, and conformance boundary for the second
  medium slice.
- [`preflight/03-qsync01-effect-orchestration.md`](./preflight/03-qsync01-effect-orchestration.md)
  owns the accepted C-stage umbrella. C1, C2, and C3 are complete; C4 remains
  separately gated.
- [`preflight/04-qsync01-c2-durable-work-and-publication-state.md`](./preflight/04-qsync01-c2-durable-work-and-publication-state.md)
  is the completed C2 implementation record for revision-fenced evaluation
  selection, terminal blocking, publication attempt state, exact Effect
  channels, and the reference proof boundary.
- [`preflight/05-qsync01-c3-bounded-evaluation-orchestration.md`](./preflight/05-qsync01-c3-bounded-evaluation-orchestration.md)
  records the completed private C3 coordinator, evaluator, shared budget,
  retry/uncertainty, refresh, restart, and reference proof contract.
- [`preflight/06-qsync01-c4-publication-orchestration.md`](./preflight/06-qsync01-c4-publication-orchestration.md)
  proposes the exact separate publication coordinator, publisher trust seam,
  recovery/idempotency rules, bounds, and reference proof matrix.

## Next Correctness Gate

The next correctness decision is review, amendment if needed, and explicit
approval of the separately bounded
[`QSYNC01-C4` preflight](./preflight/06-qsync01-c4-publication-orchestration.md).
C3 added no publisher or real adapter, and the proposed C4 document adds no
code. No Cloudflare SQLite adapter, public client API, production caller, or
delivery-adapter adoption is admitted.
