# Conformance And Flarex Adoption

## Migration Principle

Build one replacement authority and switch to it once. Do not preserve the
current backend-local sync work as a second engine, dual registry, comparison
writer, fallback, or silent compatibility path.

The current production-inert code is evidence to classify as:

| Current owner | Disposition |
| --- | --- |
| deleted `flarex-backend/src/deploymentSync/Policy.ts` | C1 removed the displaced backend-local query-generation policy. Portable decisions now come through the private transition-plan boundary; do not recreate this file or a host reducer. |
| `flarex-backend/src/deploymentSync/Model.ts` and `QuerySyncModel.ts` | Retain only backend-owned invalidation projection errors and Flarex model mapping. Do not mirror portable state unions or policy. |
| `flarex-backend/src/deploymentSync/Store.ts` | Composes the completed private generation-4 nine-operation SQLite state adapter. The current unversioned pinned-host harness is [`deploymentQuerySync.workerd.test.ts`](../../packages/flarex-backend/test/deploymentQuerySync.workerd.test.ts) with [`deploymentQuerySync.workerd.worker.ts`](../../packages/flarex-backend/test/deploymentQuerySync.workerd.worker.ts); do not create parallel tables or writes. |
| `flarex-backend/src/deploymentSyncDO.ts` | Remains an empty production-inert per-scope placement shell with no callable surface or adapter construction. Later FX02 host composition may construct one namespace engine instance per object; the class is not semantic authority. |
| `flarex-protocol/internal/scope-sync-v1` | Remains the concrete Flarex versioned codec/adapter contract until a separately approved migration. Its Flarex identities must not become generic engine types. |
| `@flarex/persistence-postgres` commit feed | Remains authoritative and later implements the trusted replayable Flarex `ChangeSource`. |
| `ConnectionDO` and current connection protocol | Remain Flarex gateway/session adapter evidence. Mutation/action messages never enter the generic query-sync package. |
| `flarex` sync client | Later wraps the selected delivery client and Flarex gateway. Do not create a second reconnect engine when upstream Durable Streams supplies it. |

Code presence, a private export, or a regression test does not prove a shipped
compatibility obligation. Re-check concrete consumers immediately before any
move/delete. Preserve a compatibility wrapper only for a demonstrated
supported consumer and give it an explicit removal gate.

## No-Dual-Engine Rules

- No new caller may use the old backend policy while another uses the new
  engine for the same namespace.
- No commit/change batch may be applied to two sync registries.
- No adapter may dual-write old and new query/dependency tables.
- No delivery may be published by both `ConnectionDO` logic and Durable Streams
  for comparison.
- No fallback may catch a new-engine failure and silently invoke the old path.
- No test may duplicate shared engine logic to make an adapter pass.
- Migration is production-inert until one complete target-only proof exists.
- Legacy removal happens only after all supported callers switch and reset,
  recovery, and state-loss behavior are proven.

Because the current `SYNC01-F` actor/store is production-inert, the preferred
path is adapt-or-replace without a live dual-state migration. If a shipped
obligation is discovered, stop and preflight its exact migration separately.

## Executable Reference Model

The first package testing subpath owns an immutable reference aggregate and
pure command reducer. It serves three purposes:

1. executable specification of transition semantics;
2. deterministic simulation and property/fuzz testing; and
3. oracle for future durable-state adapter conformance.

It is not production storage, a fake delivery network, or proof of runtime
portability. It must be bounded and explicitly unsuitable for unbounded tenant
state.

Use at least two synthetic sync models with unrelated data shapes, such as a
key/value model and a graph model. They must share only canonical engine
contracts. Flarex app-row/table/relation fixtures alone would not prove the
engine is independent.

## Conformance Matrix

| Evidence lane | Required proof |
| --- | --- |
| pure policies | canonical capture, immutability, ordering, duplicate/exact-next/gap/epoch decisions, provisional snapshot-to-current refresh, atomic authority-witness-fenced generation completion, dirty frontiers, unchanged-result refresh, aggregate byte and membership boundedness |
| immutable reference model | deterministic command sequences, source-state non-mutation, namespace/model isolation, crash-point expected state, semantic atomicity oracle |
| model adapters | canonicality, determinism, no false-negative dependency projection on decisive fixtures, bounded output, model-version separation, authority-witness capture/re-derivation, and proof that every mutable result authority is identity-, epoch/model-, or source-sequence-fenced |
| state adapters | every semantic operation against the same oracle, rollback, conflict, corruption, uncertain response, continuation, quota, and cross-namespace tests |
| PGlite and genuine Postgres | exact commit-source epoch/sequence/floor mapping, snapshot correlation, lost wake, bounded pages, transaction/outbox replay, error mapping |
| Workerd/Miniflare | per-object construction, SQLite transaction behavior, constructor re-entry, eviction/restart, alarm/wake handling, no module-global object state |
| real Cloudflare | service bindings, real lifecycle/cost, stream auth/cache/rotation, duplicate append, ambiguous receipt, load and storage budgets |
| client/gateway | authorization binding, query sharing isolation, apply-then-checkpoint, reconnect, expired-offset reset, auth change, duplicate transition |
| system proof | one real Flarex mutation/commit through query invalidation, rerun, publication, client application, crash/restart, and target-only recovery |
| second durable host | same semantic-store and orchestration conformance on a non-Cloudflare durable runtime before portability is called production-proven |

Adapter conformance must inspect real platform effects. A mock that implements
the desired answer cannot prove SQL transaction, Cloudflare lifecycle, network
uncertainty, or Postgres ordering behavior.

## Fault And Race Matrix

At minimum, inject interruption or uncertainty:

- before and after source-page read;
- before, during, and after exact-next state application;
- after cursor advance but before host acknowledgement;
- before evaluation, during evaluation, and after a newer dirty frontier;
- during initial refresh with a missing/reversed/wrong-epoch source interval and
  with the namespace cursor advancing after refresh evidence;
- before and after generation installation;
- after outbox insertion but before append;
- after append may have succeeded but before receipt persistence;
- during outbox completion;
- across object eviction/reconstruction;
- during source epoch rollover or retained-floor loss;
- during authorization-fingerprint/head/model change;
- during stream rotation and client resubscription; and
- with two host instances racing the same durable work.

Each case must state whether replay returns the same receipt, retries the same
identity, requests rerun/resnapshot/reset, or fails terminally. “Try again” is
not a complete uncertainty contract.

## Adoption Sequence

1. **Complete (`QSYNC01-A`).** Build the pure transition kernel/reference model
   without touching the current actor, store, Postgres feed, protocol, or
   clients.
2. **Complete (`QSYNC01-B`).** Derive the trusted change-model and semantic
   durable-state contracts from executable transitions; do not design them
   from SQLite CRUD.
3. **Complete (`QSYNC01-C4`).** C1-C4 provide recovery-stable
   evaluation/publication state plus bounded evaluation and publication
   orchestration over deterministic reference capabilities.
4. **Accepted split gate (`QSYNC-FX01`).** The dedicated preflight splits the
   broad adoption outcome into A canonical Flarex mappings, B a docs-only
   access/transition-seam proof before DDL, and C1-C3 semantic SQLite verticals
   ending in the complete nine-operation state adapter. Keep Postgres source
   reads outside the generic package.
5. **Complete (`QSYNC-FX01-A`).** Versioned query, dependency, and authority
   frames, one Flarex model projector, and coupled result/publication mapping
   are private and production-inert. A adds no SQLite schema or host behavior.
6. **Complete (`QSYNC-FX01-B`, docs only).** Every operation has a bounded
   logical read/transition/write plan and Cloudflare SQLite is feasible. B
   historically stopped before DDL because the then-current reducers consumed
   and rebuilt the complete aggregate; D1-D4 subsequently closed that seam.
7. **Complete (`QSYNC01-D0`, docs only).** The accepted
   [operation-scoped transition-plan preflight](./preflight/09-qsync01-d-operation-scoped-transition-plans.md)
   freezes bounded facts, closed staged reads, operation-specific logical
   changes, exact accounting, compatibility refactoring, and proof. It adds no
   code or adapter authority.
8. **Complete (`QSYNC01-D1`).** The private planner foundation, shared exact
   accounting, initialization, begin, staged admitted-batch application,
   aggregate/reference integration, and independent normalized equivalence
   proof are complete with no package export or adapter code.
9. **Complete (`QSYNC01-D2`).** Evaluation completion now uses scalar-first
   policy plus exact replay or material reads, planner-owned publication intent
   and counters, aggregate/reference integration, and independent normalized
   proof. It adds no package export or adapter code.
10. **Complete (`QSYNC01-D3`).** Evaluation selection now uses bounded cyclic
   scan and selected-point stages, while attempt-outcome recording uses one
   nominally authenticated scalar planner. Aggregate/reference integration,
   independent normalized interpretation, exact counters, capability,
   uncertainty, and history proofs are complete without an adapter or package
   export.
11. **Complete (`QSYNC01-D4`).** Publication claim, attempt-outcome recording,
   and completion now use bounded pure planners, completing all nine operations
   and the private transition-plan import boundary without adapter code.
12. **Complete (`QSYNC-FX01-C1`).** The
   [C1 checkpoint](./preflight/10-qsync-fx01-c1-sqlite-vertical.md), its portable
   empty-scope prerequisite, and the private generation-2 initialize, begin,
   and admitted-batch SQLite vertical completed in `12e2f375` and `b94abbb0`.
   The adapter remains package-private, unrouted, and production-inert.
13. **Complete (`QSYNC-FX01-C2`).** The accepted
    [C2 checkpoint](./preflight/11-qsync-fx01-c2-sqlite-evaluation-vertical.md)
    implemented the historical generation-3 six-operation evaluation subset
    with focused migration, rollback, portable-oracle, and genuine Workerd proof
    on 2026-08-30. Its exact fifteen-write generation-2 migration fault matrix
    and SQLite-local 4,096-query streaming migration proof are also complete.
14. **Complete C2 exit proof.** On 2026-08-31 the pinned local Workerd lane
    closed the retained maximum-population, row/content, binding, buffering,
    disposal, and reopen matrix. This is not deployed Cloudflare evidence or a
    measured 128 MiB guarantee, and dispose/recreate does not prove eviction or
    hibernation.
15. **Complete (`QSYNC-FX01-C3` and `QSYNC-FX01`).** The accepted
    [C3 checkpoint](./preflight/12-qsync-fx01-c3-publication-lifecycle.md)
    now records the completed generation-4 publication lifecycle and private
    nine-operation adapter. Node SQLite proves the exact 4,096-pending/32 MiB
    compound topology, exact 64 MiB and plus-one pre-exposure behavior, and
    capacity-infallible settlement. Miniflare `4.20260611.0` with Workerd
    `1.20260611.1` proves the maximum publication lifecycle, selector plan,
    rollback, two-object isolation, disposal/recreation, and persisted reopen.
    The completed adapter remains package-private, unrouted, and
    production-inert; this is not eviction, hibernation, deployed Cloudflare,
    runtime-portability, production-parity, or publisher/client/delivery
    evidence.
16. Independently run the Cloudflare Durable Streams feasibility spike and
    accept or reject it at explicit maturity, security, retention, payload, and
    cost gates. Rejection does not block the Flarex model/source/SQLite adapter;
    it blocks only that delivery composition.
17. **Preflight accepted (`QSYNC-FX02`).** The
    [FX02 record](./preflight/13-qsync-fx02-postgres-host-composition.md)
    freezes the exact Postgres source, authenticated query registration/
    evaluation/rerun host composition, lifecycle, wake recovery, and semantic-
    outbox processing boundaries.
18. **FX02-A implementation checkpoint.** The private correlated authoritative
    Postgres scope/feed/head read, strict executor/backend codec, authenticated
    host, service-binding client, and replayable-source/admission adapter are
    implemented. Focused local proofs pass; the checked-in real-Postgres test
    awaits `FLAREX_POSTGRES_DATABASE_URL`, so FX02-A is not marked exited and
    no Durable Object behavior is authorized yet.
19. Compose query execution, provisional completion, rerun coalescing,
    unchanged suppression, and processing of the already-semantic durable
    publication outbox.
20. Compose whichever delivery adapter passed its own gate with the authenticated
    gateway, then the
    Flarex client wrapper.
21. Prove target-only reset/reconnect/recovery and switch internal callers.
22. Remove the displaced unshipped engine code/state/export when no supported
    consumer remains.
23. Run `R03-B` through the accepted framework and Flarex adapters; relation
    code may consume dependency keys but cannot own sync state.
24. Prove a second real durable host before making a broad production
    portability claim.

## Relation Gate

`R03-A` already publishes relation-adjacency facts through the existing commit
and retention owners. `R03-B` remains the native relation consumer gate for
fenced live registration.

`R03-B` is blocked until the portable engine plus Flarex adapters prove:

- one authenticated namespace binding;
- canonical relation-query identity including its effective access fingerprint;
- initial provisional registration at a coherent snapshot;
- relation dependency projection without false negatives;
- contiguous source catch-up across registration;
- generation-fenced activation and rerun;
- explicit source/stream reset;
- durable publication and client reconnect; and
- no use of the Legacy timestamp registry or compatibility `SchedulerDO`.

Non-reactive `SV-R Core` may proceed under its own relation roadmap. The sync
engine gates only live/reactive/reconnectable claims and `SV-R Live`; it must
not become a reason to repair or widen unrelated relation owners.

## Documentation And Review Gates

Every implementation preflight must name:

- exact files/package exports and dependency graph;
- current-to-target move/delete/adapter/compatibility classification;
- trusted inputs and untrusted inputs;
- semantic operations and transaction revalidation;
- precise Effect success, failure, and requirement channels;
- lifecycle/cardinality owner for every service, state instance, runtime, and
  background process;
- retry, uncertainty, reset, and corruption behavior;
- limits and resource/cost budgets;
- focused tests plus real-platform evidence; and
- explicit non-authorized adjacent work.

Significant TypeScript implementation checkpoints require the repository's
standing TypeScript and code-quality reviewers before commit, after core/diff
lint and before the final staged diff gate. Docs-only planning changes do not.
