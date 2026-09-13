# Migration Step Transition Proof

Status: superseded proposal, never approved for implementation. The broader
[framework installation core redesign](./76-framework-installation-core-redesign.md)
is the current discussion direction; it addresses cross-step complexity,
construction APIs and both Medusa and Payload structural consumers. The
installer remains unchanged and the connected ShippingProfile gate remains
open. This is not permission to restore the candidates withdrawn in record 74.

## Outcome, Owners And Non-Goals

Separate authenticating an existing stored graph from proving the writes of one
trusted structural-step command. The proposed command would authenticate its
incoming state once, execute the registered structural operation, then validate
the actual receipt, sidecar, event and guarded-head write results using those
established prerequisites. Its state belongs to that command, not to a generic
transaction cache, a framework adapter or another authority service.

Owners remain `migrationCoordination/freshCoordinator.ts`, its receipt/event/head
repositories and the existing stored-value issuers in `@flarex/persistence-postgres`.
Postgres remains the only commit authority. The nearest proof is the unchanged
seventeen-table Product/ShippingProfile installation and cold reopening, followed
by the connected native operations on both database drivers.

No Medusa-specific branch, new ledger/table, public API, version suffix,
whole-installation transaction, larger cache, broader workflow capability or
relaxed installation deadline is proposed. Keep one bounded transaction per
structural step, fixed handlers, exact catalog postconditions, lock order,
lease/fence validation, rollback and uncertain-outcome recovery.

## Evidence And Why This Owner

The phase-attributed observations identify head advancement and event persistence
as the largest step phases. Head advancement prepares and corroborates its swap,
performs its guarded update, and then reconstructs the stored head and dependency
graph again. Event persistence similarly authenticates prerequisites before
writing and resolves the stored occupant afterward. Each independent graph
restoration includes growing receipt/event history and plan/admission evidence.

The measured decoder bodies are a much smaller portion of the installation than
those complete repository operations. Removing repeated receipt decoding was a
valid local mechanism witness but did not establish the required installation
benefit. Another decoder cache is therefore not the selected direction.

[Record 11](./11-target-session-and-fresh-coordinator.md) already identifies
quadratic accumulated lineage corroboration as an unresolved scale gate.
[Record 27](./27-product-installation-reconstruction-cost.md) owns pure canonical
verification and read-pass lifetimes; [record 74](./74-shared-migration-graph-restoration.md)
preserves the withdrawn candidates and their retention boundary. Exact diagnostic
timings, counts and observer limitations belong in the local research artifact
and Git receipt, not as a completed performance claim here.

## Contract Decision Required

This proposal deliberately differs from record 74's rule that each write ends
all reusable database evidence. Previously authenticated prerequisites would
remain usable only inside the closed step command as premises for its specific
writes. An independent read, another command, the next step, cold reopening,
takeover, recovery and final readiness validation still acquire fresh evidence.
There is no supported arbitrary callback or publicly issuable verification token.

READ COMMITTED is not a transaction-wide snapshot. A collision-head lock does
not prevent an unrelated privileged writer from changing old metadata. Neither
matching digests nor an UPDATE RETURNING result proves unchanged dependencies.
The user must explicitly accept or reject the proposed corruption-detection
boundary: the command authenticates its incoming history and its own changes;
it does not promise to rediscover an out-of-band historical rewrite after every
internal statement. Independent subsequent reads remain fully corroborating.

Before implementation can proceed, the focused design must prove that every
admitted writer and fixed structural handler obeys the command's mutation set,
and classify concurrent direct metadata repair/corruption explicitly. If the
required contract includes detecting such changes inside the command, this
proposal is insufficient without an additional snapshot, locking or enforced
immutability decision. None of those changes is implicitly authorized here.

## Proposed Operation Shape

1. Freshly lock/read the collision head and authenticate plan, admission,
   attempt, event history and complete receipt prefix. Validate current target,
   lease, fence and selected dependency receipts.
2. Execute the fixed structural handler and its exact catalog observations.
   This is trusted code, not a framework callback, remote effect or workflow pause.
3. Persist the new receipt and its complete sidecars, then the event and guarded
   head transition. Decode actual returned rows and compare exact projected
   fields, canonical bytes, identities, dependencies and cardinality through
   the existing issuers. Do not manufacture synthetic rows or use a verified flag.
4. The existing outer owner settles. Discard all command state on success,
   failure or interruption. Decision uncertainty continues through the existing
   fresh recovery session, never by trusting an in-memory write result.

An insert conflict does not prove that the proposed row was written. Preserve
exact incumbent replay/corruption/conflict classification where an operation
still admits that case. RETURNING may supply the actual affected root, but does
not alone prove sidecar completeness or historical integrity. Changed write
results and triggers must remain visible to validation and cause rollback.

This should simplify the existing coordinator entry point's internal ownership;
callers must not assemble stores, transaction state, restoration contexts or
proof parts. Use plain current names and operation-specific private mechanics,
not a generic proof registry or an entity/kind dispatcher.

## Alternatives And Cleanup

- **Retain:** independent full graph reads, cold/recovery/takeover/finalization
  verification, existing canonical issuers, fencing/CAS and settlement owners.
- **Replace if approved and proven:** repeated historical reconstruction inside
  the closed step command with exact command-owned write-result validation.
- **Delete:** displaced private coordinator assembly and diagnostic observers;
  retain separate repository operations only for actual independent consumers,
  not a legacy performance-comparison path.
- **Reject as the next fix:** larger read caches, blanket tracing removal,
  module-specific bypasses or higher deadlines. Measured operation counts are
  not proof that removing observability alone fixes the algorithm.
- **Defer:** persisted checkpoints, new immutable metadata enforcement and
  isolation-level changes. Each needs a concrete contract and its own approval;
  failed local optimizations do not prove any one is necessary.

Even one full history read per step retains cumulative quadratic work. This is
a bounded installation-throughput proposal, not a complete lineage-scale or
production solution. Do not present it as eliminating the scale gate.

## Validation And Completion Gates

First prove a neutral multi-step command with an exact statement/graph-work
witness. Cover wrong target/attempt/fence, reordered or missing/extra sidecars,
changed bytes with unchanged digests, trigger-altered write results, insert
conflicts, stale head CAS, cancellation and rollback. Test the selected
out-of-band mutation contract explicitly; do not silently rewrite the existing
independent-read corruption witnesses to accommodate a shortcut.

Retain actual ordinary-role PostgreSQL contention, lease takeover and distinct
recovery-session evidence as well as the PGlite lane. Run owner and unchanged
Currency/Product/SalesChannel/ShippingProfile consumers, affected typechecks,
lint and both required final reviewers for any retained code. Use record 74's
material performance threshold and uncensored/censored comparison rules; the
new observations are diagnostic baselines, not acceptance samples. A retained
claim requires the full comparison and no weaker deadline.

There is no known production-data migration obligation for this private path,
but this proposal does not remove the stored formats or schemas. If an
implementation needs a new schema, isolation/retry profile, durable identity,
compatibility surface or broader writer permission, stop for that decision.

## Primary Sources

- [PostgreSQL READ COMMITTED](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED):
  statement snapshots, visibility of own writes and concurrent conflict behavior.
- [PostgreSQL RETURNING](https://www.postgresql.org/docs/18/dml-returning.html):
  actual affected-row projections, including trigger-modified values; not
  dependency-graph authentication.
- Pinned Medusa `third_party/medusa/SOURCE.json` and
  `upstream/packages/core/framework/src/migrations/migrator.ts`: native migration
  ownership is distinct from the Flarex structural coordinator measured here.
