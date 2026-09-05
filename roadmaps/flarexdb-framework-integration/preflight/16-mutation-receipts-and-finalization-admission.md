# Private Mutation Receipts And Finalization Admission

## Status And Outcome

Status: proposed concrete commit-owner capability. The private scalar
[transaction/store](./15-scalar-relational-transaction-and-store.md) is its
implemented prerequisite. Implementation requires approval of this contract.

Prove that each successful scalar mutation statement produces authenticated,
transaction-bound evidence, that the outer owner accounts for every attempted
mutation, and that finalization rejects otherwise valid evidence without an
admitted fact family. Keep successful read-only settlement. This closes the
receipt and rejection portion of the synthetic shared-core proof; it does not
establish a successful framework commit or complete Application preservation.

The substantive new boundary is receipt issuance and consumption by the commit
owner. No commit sequence, fact family, persisted receipt, migration, command
ledger, public export, framework adapter or production host is introduced.
Application publication and its recovery remain under their existing owner.

## Source Evidence And Design Challenge

| Current source | Decision |
| --- | --- |
| [`relationalTransaction/store.ts`](../../../packages/persistence-postgres/src/relationalTransaction/store.ts) validates scoped scalar operations, sets `mutationAttempted` before SQL, and validates bounded `RETURNING` rows. | Issue evidence at this successful SQL boundary. A command's claimed operation or returned JSON is not proof of a mutation. |
| [`relationalTransaction/lifetime.ts`](../../../packages/persistence-postgres/src/relationalTransaction/lifetime.ts) authenticates exact transaction identity, latches failures, and currently rejects any mutation attempt directly. | Retain that non-clearable marker and rollback behavior; add complete receipt accounting and an outer admission check before physical settlement. |
| [`relationalTransaction/host.ts`](../../../packages/persistence-postgres/src/relationalTransaction/host.ts) admits fixed commands and captures their JSON input/output. | Keep receipts inside trusted composition. Returning, dropping or editing command data cannot select the receipt set or authorize settlement. |
| [`pointCommitTransaction.ts`](../../../packages/persistence-postgres/src/pointCommitTransaction.ts), especially `runPointCommitPublication` and `publishPointCommitInTransaction`, validates Application authority and publishes row/relation changes, committed request outcome and wake in one transaction. | Keep this path. Its prepared command, journal, OCC, row maintenance and idempotency contracts are not a generic relational finalizer. |
| [`schema.ts`](../../../packages/persistence-postgres/src/schema.ts), `fxSystemCommits`, and [`commitFeed.ts`](../../../packages/persistence-postgres/src/commitFeed.ts) retain explicit Application-row and relation-adjacency counts and children. | Neither a generic `system` row nor an arbitrary JSON change has a publication contract. Do not disguise synthetic writes as either existing family. |
| [`applicationRelationCommit/Repository.ts`](../../../packages/persistence-postgres/src/applicationRelationCommit/Repository.ts) authenticates prepared values through same-factory WeakMaps and exact definitions. | Reuse the runtime-identity pattern, not that Application receipt type or authority. Structural equality and matching hashes alone cannot mint a new receipt. |
| [`relationalTransaction/session.ts`](../../../packages/persistence-postgres/src/relationalTransaction/session.ts) separates callback rollback, cleanup failure and uncertain physical settlement. | A logical rejection must still traverse the existing physical rollback/cleanup boundary. Receipt rejection alone is not confirmed rollback. |

The checked-in Convex `crates/database/src/transaction.rs` at the repository
root makes `FinalTransaction` consume a transaction and requires completed
subtransactions before flattening writes. Preserve one outer finalization
boundary and a complete owned set. Do not import its write engine, savepoints
or the assumption that an empty net write set permits synthetic SQL to commit.

Three alternatives were rejected:

- Extracting the whole Application publisher now would change a working
  journal/OCC and committed-outcome boundary before a real second publisher
  supplies compatible inputs.
- Adding a synthetic fact family would make the test fixture a new semantic
  write owner and would require schema, feed, retention and consumer contracts.
- Merely wrapping `unadmittedFinalization` in another function would prove no
  receipt authenticity, omitted-operation detection or one-time consumption.

The recommended slice is an actual issuer, complete collector and single-use
admission boundary, with no accepted relational publication family. It adds
the missing proof without constructing an unused pluggable publisher registry.

## Ownership And Composition

Create source-private `src/commitPublication/` modules for the receipt model,
authenticated collection and finalization admission. Keep physical SQL and
scalar validation in `relationalTransaction/store.ts`; the relational lifetime
owns composition and the outer call into admission. Use named Effect operations
for lifetime/failure behavior and Result for pure bounded validation.

Each admitted transaction gets a private issuer/collector bound to its exact
lifetime and actual database transaction. It pins deployment, scope,
generation/fence/epoch, target and physical placement, restored installation,
readiness/availability, semantic owner and authenticated table identities.
Reuse owned admission references rather than clone the installed graph for
each operation. Neither a module-global singleton transaction service nor a
consumer-selected issuer is admitted.

The store receives only the internal recording capability. The outer lifetime
receives sealing/admission authority. Commands retain the existing table/store
facade and JSON result contract; they receive neither capability. Source-private
trusted test composition may inspect evidence and inject admission candidates
to exercise refusal, but may not bypass actual SQL issuance in the end-to-end
proof or inject an accepting publisher.

## Receipt Contract

`RelationalMutationReceipt` is an opaque, immutable runtime token whose record
is held by the owner. It is not a persisted or wire contract and needs no
version suffix. Its private evidence includes:

- exact issuer, transaction/admission identity and authenticated table;
- monotonically increasing mutation-attempt ordinal;
- operation: scalar insert, update or delete;
- complete scalar primary key in its validated SQL text spelling; and
- successful statement outcome: one affected row or zero affected rows.

Issuance uses the checked SQL result, including returned primary-key agreement.
Insert must affect one row. Update/delete can affect zero or one. No receipt
is issued for failed SQL, failed returned-row validation or failed issuance;
each failure latches rollback-only even after SQL changed pending state.

This evidence proves the admitted operation and affected identity. It does
not claim an update preimage, a durable change, a net transaction diff, domain
event intent or committed recovery identity. Current update `RETURNING` is an
after-image and cannot supply the prior value. A future real fact family must
specify any additional before/after capture before publication is enabled.
Do not add a pre-read or a second row-history engine for this rejection proof.

Reserve an attempt slot before each mutating statement, alongside the existing
marker. Complete that exact slot once after SQL/result validation; a second
completion is invalid. Automatically retain the issued token in the collector
before returning the ordinary store result. Preserve every completed attempt,
including same-value updates, zero-row operations and insert-then-delete.
No coalescing or no-op exemption clears the mutation marker.

Bound receipt count by the existing 64 combined-call ceiling. Additionally cap
retained receipt identity data at 256 KiB per transaction, charged against the
existing 1 MiB command data budget. Measure the owned operation/ordinal/table/
primary-key/outcome record; shared pinned authority is retained once. Reserve
the maximum zero/one-outcome record before issuing SQL, reject exhaustion
before the next statement, and release all retained evidence on close. Do not
retain duplicate full scalar rows, SQL text, parameters or driver results.

## Outer Sealing And Admission

The proposed flow is:

```text
scope/binding admission on the actual transaction
  -> scalar statement: reserve attempt, execute, validate, issue and retain
  -> nested commands return ordinary data; any failure latches rollback-only
  -> root command finishes and its result passes the existing size check
  -> fence further command/store work; require no active nested call or SQL
  -> seal the complete ordered receipt set once
  -> authenticate the seal, its exact receipt membership and authority
  -> no mutation attempts: allow existing read-only physical settlement
  -> mutation attempts: reject unadmitted family and physically roll back
```

Sealing is available only to the outer owner, after successful command
completion and before the session attempts COMMIT. A rollback-only command
does not become eligible by presenting valid receipts. Fence work before
sealing; entering closing state must not accidentally invalidate the owner's
one permitted admission call. Store/table handles stay unusable during it.

Authentication checks every receipt before family eligibility: issuer and
exact accepting transaction/admission; unique ordinal and token; matching
operation/table/scope pins; completed attempt count; and exact ordered
membership in the collector. A caller-supplied array cannot be substituted
for the owner-held complete set. Do not trust tokens merely because they have
the right properties, hashes or owner string.

The seal is single-use, including a rejected admission. Reject copied, forged,
foreign, expired, missing, duplicate, reordered or omitted evidence, and reject
another seal attempt. No partially authenticated set grants authority. There
is no cross-transaction receipt transfer or replay; a new command re-executes
under a fresh lifetime and can never reuse an old token.

Distinguish invalid receipt authority, incomplete accounting, reused/closed
admission and unadmitted family in private typed failures. Authentic complete
synthetic evidence still yields the existing outer `unadmittedFinalization`;
do not let that expected rejection mask corruption in the set. A malformed
candidate or failed nested check latches rollback-only before propagation.

On either outcome, invalidate receipt/seal/issuer authority and clear retained
state. Preserve the original Cause through physical rollback; combine cleanup
failure without replacing the rejection, defect or interruption. Reuse the
existing cancellation/drain/quarantine policy and time budgets. No command
retry, outcome recovery query or asynchronous cleanup is added.

## Publication And Lock Boundary

No relational fact family is admitted in this slice. There is no enum branch
that accepts Application, Payload or Medusa by name, no extension callback,
and no test-only accepting finalizer. The successful empty/read-only admission
must not be interpreted as permission to commit a zero-row mutation attempt.

Retain scope clock FOR UPDATE, then availability FOR SHARE, then scalar rows.
Admission runs while these locks and the actual transaction are still owned.
Authenticate against the pinned accepting lifetime; do not resolve a new
binding or open a second transaction at finalization. No scope-clock lock is
released/reacquired or moved later. Existing admission already checks current
generation/fence/epoch; this slice introduces no new OCC read dependencies.

The receipt boundary does not call the commit allocator, Application publisher,
commit-feed writer or wake dispatcher. Assert unchanged scope clocks, commit
headers, both existing child-fact tables, idempotency outcomes and outbox rows.
The later first successful family must specify its semantic issuer, before/
after requirements, committed-result identity, same-transaction projection,
feed/retention compatibility and uncertain-write recovery before being admitted.
Payload scalar publication must compose Application authority; commerce rows,
links and events retain their separately owned family gates.

## Existing-Code Disposition

| Area | Disposition |
| --- | --- |
| Scalar SQL, row validation, ordinary store results and pending reads | Keep; add private attempt reservation and checked-result receipt issuance. |
| Direct `mutationAttempted` completion rejection | Port into complete collection/sealing/admission; keep the marker as an independent backstop. No mutation becomes committable. |
| Binding admission, physical session, cancellation and quarantine | Keep; use the same actual transaction and cleanup semantics. |
| Application journal, OCC, publisher, request idempotency, relation commit and feed | Keep; no rerouting, extraction or schema changes. |
| Legacy invoke-session publication in `commits.ts` | Keep untouched; it is not the authoritative framework integration seam. |
| New generic publisher registry, persisted receipt ledger or synthetic feed family | Do not create. |

There is no shipped receipt format or consumer compatibility migration. The
private store facade retains its result types. This capability does not repair
unrelated existing commit/compiler issues or widen their owner authority.

## Completion Proof And Execution

Use pure focused tests for runtime token forgery/copying, wrong issuer and
transaction, exact-set completeness, duplicate/reordered/omitted receipts,
single consumption, closure cleanup and bounded reservation. Tests must prove
positive authentication separately from the expected unsupported-family result;
an unconditional reject function cannot satisfy this contract.

Extend the existing shared scalar scenario definitions and manifest-owned
PGlite/PostgreSQL lanes. Reuse their one installation per driver. Prove actual
insert/update/delete and zero-row receipt issuance, nested shared ordinals,
same-value and net-zero mutation rejection, failed SQL without a receipt,
failure after SQL before issuance, caught failure followed by refusal, and
full row/publication-state rollback. Inject failure after the last pending
mutation and verify no late publication. Successful read-only work stays valid.

Ordinary-role PostgreSQL must observe unchanged acquisition order and blocked
scope/availability movement through the outer boundary, no mutation COMMIT,
confirmed rollback or exact-client quarantine on failure, and preserved
uncertain read-only settlement. PGlite retains its worker/lease termination
proof. Cover receipt-specific changes within these shared fixtures; do not
repeat migration setup or ten-second deadline waits for every receipt case.

Run the affected binding/Application regressions, bounded package typecheck,
manifest validation, core/diff lint, both standing reviewers and the exact
staged gate. This is focused preservation evidence, not a claim that the full
Application document/OCC/relation/commit vertical has been requalified.

After approval, implement the entire issuer, collector, outer admission and
database rejection proof with durable roadmap reconciliation in one coherent
checkpoint. Then complete the full Application-preservation gate and the
separately required CMS host/Application commit-participation contract. Preserve
the ordered Payload scalar, Payload native-relation and real Medusa Currency
proofs; receipt plumbing alone does not prove the core through both frameworks.
