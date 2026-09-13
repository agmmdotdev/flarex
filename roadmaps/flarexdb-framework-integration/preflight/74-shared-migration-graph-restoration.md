# Shared Migration Graph Restoration

Status: both the membership/root-projection candidate and the receipt-aggregate
follow-up were evaluated and withdrawn after failing the unchanged full-suite
PGlite installation deadline. No runtime or test change from either candidate
is retained. The connected
ShippingProfile slice in [record 66](./66-connected-product-shipping-profile.md)
remains incomplete. This is not another approval of the withdrawn candidates in
records 68, 70 or 72.

## Current Disposition

The evaluated candidate added exact root-projection reuse for plan/admission
lookup routes, bounded admission-membership comparison in PostgreSQL, and
read-pass-local reuse of negative additive-policy lookups. A neutral witness
confirmed that two admission lookup routes could share one node reconstruction;
focused owner tests exercised the candidate's admission, plan and restoration
paths. This did not establish a material improvement for the connected claim,
receipt, event and head restoration workload.

The first full candidate PGlite run timed out during fixture installation,
before the native test cases ran. The acceptance sequence therefore stopped;
the three-by-three timing matrix, candidate ordinary-role PostgreSQL validation,
and final retained-code review were not completed. The candidate and its
supporting test edits were removed, returning the touched files to the exact
baseline. The unchanged connected fixture remains the failing performance
witness. No timeout, integrity check, schema, transaction or public API changed.

This rejects the evaluated implementation, not every possible correction within
the existing boundary. It establishes neither a causal slowdown nor the need
for a new ledger or larger transaction. The installation performance problem
remains unresolved. Further implementation needs a concrete, measured explanation
of the aggregate reconstruction that remains, rather than assuming reduced row
transport or an isolated cache hit meets the end-to-end requirement. The design
and retention criteria below remain the boundary for that assessment.

## Receipt-Aggregate Attribution And Disposition

Installation-scoped diagnostic counters on both drivers show that the reference
capacity is not exhausted. References are successfully reused within a pass,
but many successive passes reconstruct the growing receipt/event history. Batch
snapshots show increasing history-decoding work for equal numbers of new steps.
These are decoder invocations and successful reference operations, not unique
database rows, SQL execution times, or proof that every invocation is removable.

There are concrete untouched repeated-work sites:

- `restoreCompleteStoredAttemptReceiptPrefix` decodes its row inventory, then
  calls `restoreReceiptDependencyClosure`, which decodes each root again.
- `restoreReceiptDependencyClosure` decodes and resolves the attempt before
  checking the shared verified-node slot. A successful node lookup therefore
  does not mean the preceding decoding work was avoided.
- Event receipt-subject restoration creates a new local receipt context for
  each subject. Existing shared-node reuse helps, but the per-subject entry
  work and full cold predecessor traversal remain.
- Locked claim, event preparation, head preparation and post-write reads have
  separate evidence lifetimes. Their repeated history work must not be removed
  by silently reusing database evidence across writes.

The evaluated follow-up carried decoded, privately owned receipt rows through
prefix/closure restoration and shared attempt-local contexts among event receipt
subjects. Its neutral prefix witness removed duplicate root decoding, and its
mixed-attempt witness retained separate inventories for repeated step names.
The focused receipt/event corruption cases passed. This established bounded
removed work, not an end-to-end installation improvement.

The unchanged baseline and the first full candidate PGlite installation both
timed out. The candidate therefore failed the retention gate and was removed,
including its test additions. The comparison stopped before the complete timing
matrix, candidate PostgreSQL lane and final retained-code review. The event
predecessor decoder and cross-write restoration lifetimes were not redesigned.
This result does not prove a causal regression, that all within-pass corrections
are exhausted, or that a larger transaction/new ledger is necessary.

No further runtime optimization is selected by this record. A subsequent
preflight needs an explicit account of which committed-history proofs dominate
and which can be eliminated without changing the authority or corruption
contract; another local reuse mechanism is not sufficient evidence. Do not
increase cache limits, weaken cold/post-write/recovery checks, or restore either
withdrawn candidate. Exact measurements belong in the local research artifact
and Git receipt. Installation performance remains unresolved.

Follow-up phase attribution separates complete write-side graph restoration
from the much smaller decoder bodies. Head advancement and event persistence
dominate the measured step phases; head preparation and fresh post-update
restoration are distinct major costs. The proposed
[step-transition proof decision](./75-migration-step-transition-proof.md)
addressed that ownership boundary explicitly and is now superseded by the proposed
[framework installation core redesign](./76-framework-installation-core-redesign.md).
That broader direction is approved and its storage-protection foundation is being
implemented. It does not yet replace current graph reconstruction or authorize a
transaction-wide cache; protected-target admission and progress execution remain
unfinished. The narrower step-transition proposal was never approved separately.

## Outcome And Owners

Reduce repeated database transport and client-side reconstruction of the same
migration dependency graph within its existing read-only verification phases.
Treat the connected claim, receipt, event and head path as the capability, not
one transparent wrapper or decoder. Keep the existing coordinator, persistence
authority, metadata schema, canonical identities and transaction settlement.

The nearest end-to-end proof is installation and fresh-profile reopening of the
seventeen-table Product/ShippingProfile artifact through the real installer,
followed by unchanged native operations on both drivers. The correction must
also serve neutral fresh and admitted one-hop additive plans. It must not know
Medusa module names or grant a new framework capability.

Primary owners under `packages/persistence-postgres/src/migrationCoordination`:

- `migrationCollisionHeadRepository.ts`: locked claim restoration and the
  read-only preparation before head CAS; fresh post-write restoration.
- `migrationEventRepository.ts`, `migrationStepReceiptRepository.ts`: event
  predecessors, receipt subjects, complete receipt prefixes and dependency
  closures.
- `migrationPlanRepository.ts`, `migrationPlanAdmissionRepository.ts`,
  `physicalNameAssignmentRepository.ts`: plan, assignment and admission
  membership evidence used by those aggregate operations.
- `storedRestoration.ts`: the existing authentic stored-reference issuers.
- `graphReadPass.ts` and `additiveLimits.ts`: existing read-only reuse and
  traversal-policy boundaries, not a transaction-wide cache.

`freshCoordinator.ts` remains orchestration and the target/session owners remain
the only transaction/settlement owners. Change their wiring only if needed to
compose the above read-only aggregates; do not merge step transactions.

## Research Findings

The accepted Medusa boundary puts structural installation in Flarex and commerce
semantics in Medusa. Records 09/10/11 define the exact receipt/event/head and
recovery contract; [record 27](./27-product-installation-reconstruction-cost.md)
owns the existing pure-verification and database-read lifetimes. Static platform
migrations and database initialization precede the commerce installation timer.
Fresh-profile reopening verifies readiness; it does not restart PostgreSQL.

New ordinary-role PostgreSQL observations distinguish three different costs:

1. Server-side statement planning/execution is a minority of the fixture window.
2. Query submission through protocol completion costs more than server execution,
   but still leaves a substantial interval outside active queries.
3. Process CPU accounting and prior samples support considerable client work:
   SQL construction, row detachment, canonical capture and repeated restoration.

The query inventory independently confirms repeated admission membership,
physical assignment, plan/sidecar, receipt and event transport. Repeated negative
additive-policy probes are another source-backed contributor. No claim is made
that all such queries are redundant or that one missing index caused the delay.

The server and client observations cover the complete fixture, including its
base setup, activation, negative cases and cleanup. They are not installation-
only SQL counts. Server execution, query latency and process CPU overlap and
must not be added together or subtracted to claim exact JavaScript self-time.
The detailed prior owner spans are also inclusive. Numerical receipts and exact
commands belong in Git and the local diagnostic artifact, not this roadmap.

The source shows the repeated structure directly:

```text
one step transaction
  locked claim: restore head -> event/attempt/admission/plan/receipt evidence
  structural execution
  ensure receipt: corroborate prerequisites -> write -> restore occupant
  append event: corroborate previous/subject -> write -> restore occupant
  advance head: corroborate expected/current/proposed -> CAS -> restore result
```

Plan admission additionally fetches the complete ordered membership projection
on every restoration. The plan-sidecar reader already demonstrates exact,
bounded SQL projection comparison without transporting every matching cell.
The admission path does not yet use that approach. This is a reuse candidate,
not permission to copy a generic comparison framework or assume storage IDs.

Read-pass reference keys deliberately include transaction, collision authority,
root evidence and validation policy. Multiple lookup routes and separately
constructed authority objects may prevent reuse; measure actual misses before
changing those keys. Object equality, matching digest and a held collision lock
alone do not prove equivalent stored evidence.

## Recommended Correction

### 1. Make existing read-only aggregates reconstruct each exact node once

Use the current locked-claim, event/receipt and head-preparation owners to share
their already established read-only pass. Inventory actual SQL loads, decoded
nodes and successful reuse separately. Within that pass, converge equivalent
lookup routes on the existing typed node owner where their full validation
contracts agree. Avoid rebuilding a plan and its assignment/admission membership
solely because another parent in the same authenticated graph requests it.

This is not permission to key a cache by digest or storage ID alone. A reused
result must retain exact transaction/collision authority, actual root-row
projections, dependency requirements and applicable validation policy. Preserve
the current capacity and cleanup semantics. Missing values and failures remain
uncached. If equivalent identity cannot be proved without changing the trust
contract, stop that part and report the necessary design decision.

### 2. Reduce repeated membership transport at the owning repository

Apply the existing exact bounded projection-comparison approach to admission
membership where the expected values are derived from the verified admission
and freshly authenticated assignment inventory. Compare actual stored IDs,
collision, ordinal, spelling, digest and exact cardinality, including an extra-
row sentinel. Do not replace exact equality with a digest-only shortcut.

Keep actual root identity and canonical validation with the current restorer.
Factor the smallest private completion contract needed in that issuer instead
of fabricating rows or duplicating its final authority registration. No caller-
supplied `verified` flag, generic verifier registry, public token or new barrel
export is allowed. Preserve evaluation and first-failure order, including
malformed expected evidence and cold verification.

### 3. Resolve traversal policy once at its existing read-only boundary

Where a repeated additive-plan existence check has the same exact transaction,
collision and read-only pass, allow that owner to reuse the resolved policy for
the rest of that pass, including the non-additive result. A default `false` must
not be mistaken for an authenticated negative lookup. A new pass, another
collision, a write or settlement requires fresh resolution. Do not weaken the
additive traversal limits or infer policy from an untrusted frame.

These are implementation parts of one connected graph-restoration correction,
not authorization for a sequence of unrelated optimizations. SQL transport
alone cannot eliminate the measured client work; reduced reconstruction must
be demonstrated independently of elapsed time.

## Preserved Boundaries And Rejected Alternatives

- One structural step still owns one bounded READ COMMITTED transaction.
  Preserve lock order, database clock, lease/fence checks, guarded CAS and
  exact catalog postconditions.
- Every write ends the relevant read-only evidence pass. No raw inventory,
  resolved policy or restored authority is reused across that write by a cache.
  Post-write restoration, the next step and recovery acquire fresh evidence.
- Cold and recovery reads continue to authenticate full dependencies, including
  changed bytes with an old digest and changed normalized projections.
- Keep canonical value contracts, byte/graph bounds, named owner observability,
  expected errors, defects/interruption, cleanup, quarantining and uncertain-
  outcome recovery. No new retry or weaker timeout is included.

Reject a whole-installation transaction: it changes locking, failure granularity
and uncertain settlement. Reject process/global or transaction-wide authority
caches: READ COMMITTED does not give one immutable snapshot for all statements,
and a root lock does not make every dependency row immutable against arbitrary
writers. Reject a persisted certificate/checkpoint or new ledger: each would
change schema, identity and corruption/recovery contracts. Reject ORM/Effect
replacement and broad tracing removal: neither is established as the required
owner correction. Reject parallel queries on one transaction and Medusa-specific
installation bypasses. PGlite watchdog behavior remains unchanged.

## Retain, Extend, Replace And Delete

- Retain the schema, frame identities, canonical validators, original corruption
  and recovery witnesses, ordinary repository paths needed by independent
  consumers, and authoritative read/write boundaries.
- Extend existing read-pass and aggregate restoration tests for equivalent
  routes, non-equivalent evidence, policy changes and fresh post-write reads.
- Replace redundant in-pass reconstruction and repeated membership transport
  only where the new path establishes the same complete evidence.
- Delete displaced private assembly/decoder scaffolding with no remaining
  consumer, all diagnostic observers and any unsuccessful candidate. Do not keep
  dual hot paths for performance comparison or add chronological API suffixes.

No stored-data migration or public compatibility change is intended. If one is
required, pause for a new preflight rather than extending this approval.

## Validation And Completion

First add neutral deterministic witnesses that distinguish actual SQL loads,
node decoding and cache hits. Cover exact and reordered inputs, copied/forged
authorities, missing/extra/duplicate members, malformed bytes/digests, changed
sidecars, wrong collision/target/IDs, and unchanged digests with changed data.
Include new-pass and post-write corruption, policy transitions, capacity
exhaustion, interrupted cleanup and escaped context. Prove different reference
routes share work only when their full validation contracts agree.

Run owner suites for graph-pass, plan/assignment/admission, attempts, receipt
prefix/closure, event history and head CAS; fresh and one-hop additive coordinator
and installation suites; and unchanged Product/SalesChannel/ShippingProfile
consumers. Preserve actual ordinary-role PostgreSQL contention, stale-fence,
rollback, cancellation and uncertain-commit recovery tests as well as PGlite.

Performance acceptance is proposed as a material gate, not a promised speedup:

- Compare an exact frozen baseline and candidate with no neighboring runtime
  edits or competing heavy work, using the full unchanged seventeen-table suite.
- Alternate three baseline and three candidate samples per driver. Retain every
  sample; instrumented attribution is separate from acceptance timing.
- Require all candidate suites to pass the unchanged deadline and at least a
  30 percent reduction in median installation-plus-reopen time on each driver.
  A timed-out baseline is censored: do not substitute the deadline into an
  average or percentage; report it and require all three candidates at or below
  63 seconds in that lane, plus the deterministic removed-work proof.
- Demonstrate at least a 50 percent reduction in the measured repeated
  reconstruction or membership-transport work targeted by this correction;
  do not call improved timing alone proof of its mechanism.

This first target is not the final scalability objective and does not establish
performance for arbitrary module inventories. If it cannot be met within the
preserved boundary, remove the candidate and present the measured need for a
larger transaction/ledger decision; do not accumulate unproven micro-fixes.

Run affected typechecks, source/private-export guards, core/diff/staged lint and
both required final read-only reviewers before a retained runtime commit. Stop
owned databases/runtimes, remove diagnostic code, reconcile records 06/66/74,
and commit one coherent verified capability. Native connected ShippingProfile
completion remains its own unfinished gate afterward.

## Primary Sources

- [PostgreSQL statement statistics](https://www.postgresql.org/docs/18/pgstatstatements.html):
  planning/execution measurement, query aggregation and monitoring overhead.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html):
  READ COMMITTED statement snapshots; no implicit transaction-wide evidence cache.
- [Node Inspector](https://nodejs.org/api/inspector.html): profiling capabilities;
  prior CPU samples are not complete logical async-call attribution.
- Pinned Medusa source: `third_party/medusa/upstream/packages/core/framework/src/migrations/migrator.ts`
  and `packages/core/utils/src/dal/mikro-orm/custom-db-migrator.ts` establish the
  native migration seam, not a replacement for Flarex target/fencing authority.
