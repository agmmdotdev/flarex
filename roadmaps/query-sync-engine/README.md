# Query Sync Engine Roadmap

## Status And Scope

**Accepted replacement direction; not implemented or activated.** The target is
an independently testable versioned live-query service with automatic query
subscriptions, fixed snapshot targets, consistent session query sets and bounded
reconstruction/reset recovery. The
[accepted design](../../design-notes/runtime-agnostic-query-sync-engine.md)
owns those decisions. This roadmap owns sequencing, gaps and exit conditions.

The previous pure kernel, nine-operation state port, operation-scoped planners,
reference orchestration, Flarex mappings and generation-4 SQLite adapter remain
implemented private baseline evidence. The correlated Postgres source, private
catch-up host and application-query evidence producer are also baseline work.
`DeploymentSyncDO` exposes a private catch-up probe, not a complete live-query
service. No fixed-target session protocol, replacement state layout, automatic
client integration or production delivery is claimed complete here.

This is query-result synchronization, not arbitrary row replication, offline
writes, conflict resolution, a universal event bus or another schema/query
compiler. Database source and transaction authority remain outside the engine.

## Authority And Navigation

1. [Runtime-agnostic design](../../design-notes/runtime-agnostic-query-sync-engine.md)
   owns the accepted live-query contract and its replacement policy.
2. This roadmap and [redesign preflight](./preflight/15-live-query-service-redesign.md)
   own current gates and explicit breaks.
3. [Product and boundaries](./01-product-authority-and-package.md),
   [state and lifecycle](./02-engine-state-and-lifecycle.md),
   [host and delivery](./03-cloudflare-durable-streams-composition.md), and
   [conformance and adoption](./04-conformance-and-flarex-adoption.md) own their
   respective details.
4. [Postgres/Cloudflare integration](../../design-notes/postgres-authoritative-sync.md)
   owns the concrete bridge. [FlarexDB](../../design-notes/flarex-db-accepted-design.md)
   continues to own committed data, snapshot and transaction semantics.
5. Current code/tests own exact implemented behavior. Older preflights and Git
   preserve evidence; they cannot override the replacement contract.

The former forward prescriptions in roadmap 21 and preflights 00-14 concerning
moving-latest activation, mandatory publication-attempt settlement, session
exclusion, mandatory reconnect registries or Durable Streams adoption are
superseded where they conflict with these owners. Their source-authority,
isolation, boundedness and no-dual-engine requirements remain applicable.

## Target Architecture

```text
ordinary query + reactive client (no defineSync or extra schema)
                         |
                  Flarex sync bridge
                 /                  \
     FlarexDB / executor       standalone live-query service
     snapshots + changes       query tracking + session coordination
                                          |
                                sync-owned state adapter
                                          |
                                host / transport adapter
```

The permanent standalone composition is a synthetic transactional source, the
real local sync-state adapter and a loopback session/client. It does not require
FlarexDB, Postgres, Cloudflare or external credentials. A small early Flarex
composition challenges the same source contract; it must not become a prerequisite
for the standalone suite.

## Current Gaps

- Prove selected-target snapshots, dependency completeness, authority changes
  and correlated feed/retention with the real execution owner.
- Replace moving-latest completion with progress at fixed session targets while
  preserving later dirty work and stale-attempt fencing.
- Implement session query-set versions, atomic transitions, mutation visibility,
  bounded versioned-result retention and explicit error/reset states.
- Resolve executable query material, renewable subscriber interest, reclamation
  and actor/session-generation loss without a database-core query registry.
- Extract reusable state operations from Flarex-specific binding and make the
  actual SQLite implementation independently testable.
- Replace mandatory exact publication-attempt history only after proving the
  successor notification reconciliation, reset and backpressure contract.

## Gate Sequence

These are outcome gates, not public API versions or a fixed number of PRs.
No implementation gate is completed by this documentation change.

| Gate | Outcome | Status |
| --- | --- | --- |
| `LQ-D0` | Record the replacement product, ownership, guarantees, breaks and proof obligations | Documentation decision only |
| `LQ-S1` | Freeze the narrow source/service contract; executable synthetic source and independent oracle; one early real Flarex snapshot/dependency/feed feasibility witness | Next focused preflight; not implemented |
| `LQ-S2` | Fixed-target query tracking and bounded shared result versions; preserve future dirty work; prove progress under sustained writes | Pending S1 |
| `LQ-S3` | Portable session query sets, automatic interest lifecycle, atomic transitions, mutation visibility and reset protocol through a loopback client | Pending S1/S2 |
| `LQ-S4` | Sync-owned executable material/leases/progress; reusable local SQLite adapter; rollback, reopen, loss/reset and boundedness proofs | Pending approved state contract; may overlap S2/S3 |
| `LQ-F1` | Thin Flarex bridge plus bounded Cloudflare host/delivery, source wake recovery and automatic existing SDK adoption | Pending standalone gates and real source proof |
| `LQ-C1` | Target-only cutover, compatibility/data disposition, removal of displaced registries/attempt paths, live relation consumer proof | Pending F1 and full recovery/authorization matrix |

S1 has parallel standalone and narrow real-source tracks. A source capability
failure must correct the responsible core owner or explicitly revise the design;
it must not be hidden by adapter mocks. Runtime work still requires a focused
approved preflight. Do not restart old FX02-C2/FX02-D/FX03 plans unchanged.

## Retained Baseline Evidence

| Record | What remains useful | What is not inherited |
| --- | --- | --- |
| [Portable foundation](./preflight/01-qsync01-portable-transition-kernel.md) and [admission/state](./preflight/02-qsync01-trusted-change-and-atomic-state.md) | Canonical values, isolation, ordered changes, semantic atomicity | A frozen service API or completed session semantics |
| [Orchestration](./preflight/03-qsync01-effect-orchestration.md) and [publication](./preflight/06-qsync01-c4-publication-orchestration.md) | Retry, uncertainty and lifecycle scenarios | Mandatory exact attempt/outbox shape for default UI delivery |
| [Transition plans](./preflight/09-qsync01-d-operation-scoped-transition-plans.md) | Bounded staged reads and adapter conformance | Exactly nine operations forever |
| [SQLite publication lifecycle](./preflight/12-qsync-fx01-c3-publication-lifecycle.md) | Transaction, limits and persisted-reopen evidence | Proof of the replacement layout or session protocol |
| [Source/host](./preflight/13-qsync-fx02-postgres-host-composition.md) | Correlated source and catch-up/restart evidence | Complete hosted evaluator, publisher or production sync |
| [Query evidence](./preflight/14-qsync-fx02-c-application-query-evidence.md) | Tracked execution and the executable-material gap | Selected-target execution or durable registration already implemented |

Historical `QSYNC01-*`, `QSYNC-FX01` and completed portions of `QSYNC-FX02` are not
renamed or retroactively failed. Unfinished conflicting prescriptions are held
and replaced by the gates above. `QSYNC-CF01` is optional transport research,
not a required successor gate. `R03-B` remains blocked on a proved live-query
integration; non-reactive relation work keeps its independent owner.

## Completion Standard

The service must be usable and measurable without the database core, and then
plug into it without introducing another subscription authority. Prove safety,
progress and bounded recovery, not merely reference-adapter agreement. Separate
engine benchmarks from actual query and transport costs. Real Postgres and
Cloudflare evidence remains necessary for their adapters; a local passing suite
is not a production-portability or capacity claim.

No schemas, migrations, data, runtime APIs, dependencies, routes or callers change
in this documentation decision. No blanket destructive reset is authorized.
