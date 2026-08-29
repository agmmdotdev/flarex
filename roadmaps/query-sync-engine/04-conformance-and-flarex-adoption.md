# Conformance And Flarex Adoption

## Migration Principle

Build one replacement authority and switch to it once. Do not preserve the
current backend-local sync work as a second engine, dual registry, comparison
writer, fallback, or silent compatibility path.

The current production-inert code is evidence to classify as:

| Current owner | Disposition |
| --- | --- |
| `flarex-backend/src/deploymentSync/Policy.ts` | Separate Flarex fact/dependency projection from genuinely portable transition ideas. Re-prove portable semantics in the new package; do not copy Postgres/Flarex types into it. |
| `flarex-backend/src/deploymentSync/Model.ts` | Map portable failures and states to the new package or retain only Flarex/host-specific adapter errors. Remove duplicate policy types at cutover. |
| `flarex-backend/src/deploymentSync/Store.ts` | Retain as Cloudflare SQLite adapter migration evidence. Replace its low-level package-local authority with the later semantic state contract; do not create parallel tables/writes. |
| `flarex-backend/src/deploymentSyncDO.ts` | Remains the first production-inert per-scope host placement. It constructs one namespace engine instance and host adapters per object; it is not the semantic engine owner. |
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
   logical read/transition/write plan and Cloudflare SQLite is feasible, but B
   stopped before DDL because current reducers consume and rebuild the complete
   aggregate. C1-C3 remain blocked.
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
11. Next, decide whether to approve `QSYNC01-D4`, moving the three publication
   lifecycle operations and completing the all-nine planner proof.
12. Only after D1-D4 complete and a fresh adapter checkpoint is approved may
   C1-C3 implement semantic verticals over the one existing per-scope SQLite
   cursor owner, without duplicate tables, cursors, reducers, or writes.
13. Independently run the Cloudflare Durable Streams feasibility spike and
   accept or reject it at explicit maturity, security, retention, payload, and
   cost gates. Rejection does not block the Flarex model/source/SQLite adapter;
   it blocks only that delivery composition.
14. Adapt the authoritative Postgres commit feed as the replayable change source
   and prove contiguous duplicate/reverse/gap/reset behavior.
15. Compose query execution, provisional completion, rerun coalescing,
   unchanged suppression, and processing of the already-semantic durable
   publication outbox.
16. Compose whichever delivery adapter passed its own gate with the authenticated
   gateway, then the
   Flarex client wrapper.
17. Prove target-only reset/reconnect/recovery and switch internal callers.
18. Remove the displaced unshipped engine code/state/export when no supported
   consumer remains.
19. Run `R03-B` through the accepted framework and Flarex adapters; relation
   code may consume dependency keys but cannot own sync state.
20. Prove a second real durable host before making a broad production
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
