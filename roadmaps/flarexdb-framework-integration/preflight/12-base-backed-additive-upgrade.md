# Bounded Base-Backed Additive Upgrade Preflight

Status: researched recommendation; implementation is not yet approved. This
document specifies one coherent capability covering values, metadata, execution
and PGlite/native recovery. It does not admit an upgrade profile by itself.

## Outcome And Scope

Prove one fresh synthetic `system` installation A followed by one additive
successor B in the same physical namespace. B retains A's exact definitions
and adds one scope-isolated table, its ordinary B-tree index, its scope foreign
key and a foreign key to a retained A table. Existing rows, object identities,
installation receipts and readiness evidence remain intact. B publishes its
own installation/readiness/availability result and exactly replays it.

This exercises the shared migration core needed by both framework consumers.
It does not yet implement Payload or Medusa compilers, stores or domain data
migrations. Application bindings, serving activation, data backfills, changes
to existing columns/keys/defaults, contraction, automatic down migrations,
hosted transports and production routing stay outside this capability.

The owner is the private persistence migration coordinator and its installation
repositories. [The umbrella](./09-relational-installation-and-migration-coordination.md#ordered-implementation-checkpoints)
owns sequence; [the fresh profile](./11-target-session-and-fresh-coordinator.md)
remains implemented and independently bounded. This recommendation covers the
bounded base-backed candidate and its native acceptance together, before the
later binding preflight.

## Current Evidence And Design Challenge

| Current seam | Consequence for an upgrade |
| --- | --- |
| `migrationCoordination/model.ts` and `canonical.ts` require a null base and `synthetic-system-fresh` admission | A base needs a real canonical contract, not an optional unverified caller object. |
| `storedValidation.ts` reproduces a create step for every candidate table/index/foreign key | A delta cannot pass by merely filtering fresh steps; cold restoration must reproduce the additive plan. |
| `freshCoordinator.ts` preparation requires the existing head's exact plan | A successor needs an explicit admission/head transition; retries of the same successor must be distinguished from a new competing candidate. |
| `relationalStructuralRunner.ts` rejects exact pre-existing DDL postconditions without current receipts | Retained base objects need authenticated observation evidence. Keep this rejection for newly requested objects. |
| `schema.ts` constrains the admission profile and four operation formats | The new profile and base evidence require owned metadata changes and migration tests. |
| Installation/readiness repositories restore immutable evidence; availability has a separate mutable head | A successful historical installation is insufficient when its current availability is no longer admissible. |
| Read-only graph reuse retains at most 512 references per pass | That bounds reuse, not predecessor traversal or cross-pass work. The upgrade needs explicit lineage limits. |

The [accepted framework architecture](../../../design-notes/flarexdb-framework-storage-architecture.md)
keeps physical migration separate from activation and domain data mutation.
The checked-in Convex `crates/model/src/lib.rs` introduction likewise motivates
special-purpose APIs for system metadata with stronger invariants. Reuse that
authority principle. The existing Flarex target transaction/receipt protocol
and PostgreSQL catalog semantics govern this physical DDL capability; do not
port a document-schema lifecycle as a PostgreSQL migration executor.

Rejected alternatives are: treating any exact existing object as adoptable;
recreating the complete candidate with `IF NOT EXISTS`; copying A's create
receipts into B; resetting the collision head; and replacing the shared core
with framework-specific migration runners. Each loses either provenance,
fencing, exact structural comparison or a shared ownership boundary.

## Recommended Contracts And Storage

Keep fresh plan/admission version-1 bytes, digests and decoding unchanged.
Introduce version 2 of those two persisted frame contracts for the additive
branch, with a required non-null base and a closed
`synthetic-system-additive` admission profile. These versions coexist in one
actual graph: A's fresh plan and B's additive plan. Use ordinary domain names
for TypeScript types, not chronological suffixes. Installation, readiness,
event and receipt frame versions need not change unless their encoded shapes
actually change.

The base reference pins A's complete installation identity, installation
receipt digest, readiness digest and physical-layout digest. It is comparison
data until a target transaction restores and corroborates the exact stored
graph. A digest, storage ID, captured locator or decoded object alone never
issues base authority. Mutable availability is checked live; do not bake a
changing availability status into the immutable plan identity.

Add one immutable candidate-plan-to-base sidecar, unique per candidate plan,
with exact installation/readiness reference tuples and digest checks. Reuse
existing composite keys where they fit and add context keys where needed to
enforce collision consistency. The sidecar corroborates the canonical base
reference; it is not a second source of truth. Fresh plans have no base row;
additive plans require exactly one. Plan insertion and its base row settle in
one transaction. Missing, extra, mismatched or cross-collision evidence fails
closed without repair. Concrete row references form A-plan -> A-installation
-> B-plan dependency order even though schema definitions refer across owners.

Use the next checked-in Drizzle metadata migration, with fresh and previous-head
upgrade/rollback tests. Extend only the required profile, frame-version and
operation checks. This capability does not rebaseline or dual-write unrelated
platform storage. No deployed framework-upgrade compatibility obligation has
been established; do not invent a rollout bridge or old-binary upgrade promise.

## Retained Structure And Step Flow

Keep the existing fresh API as a compatibility facade. Add a source-private
additive entrypoint and share the existing transaction, claim, step and
finalization machinery behind explicit fresh/additive policy. Avoid a second
copy of the coordinator. Keep target resolution, raw transaction ownership,
Effect failure channels, settlement recovery and public exports intact.

The additive planner requires a strict structural superset: every A definition
and name assignment survives unchanged. Additions in the first profile are
confined to the new table and its index/foreign keys. A changed or removed
stable definition, an extra index on a retained table, an unrelated conflicting
object, and a candidate with no structural addition are refused in this profile.

Compare retained physical definitions and name-assignment preimages, not whole
layout digests: A and B legitimately have different artifact/layout identities.

Add one fixed `flarex.relational-verify-base-structure` operation codec and
handler. It performs no DDL: it authenticates A and observes A's exact required projection. Its
receipt records a verification performed by B's current attempt, never a claim
that B created A's objects. Existing table/index/foreign-key codecs create only
new objects, and the final validator observes the complete B projection. Base
verification cannot trigger readiness; only completion of the whole candidate
and its final validation can do so.

```text
restore and lock A's admissible base evidence
  -> canonical additive plan + atomic successor admission/head CAS
  -> verify-base-structure receipt
  -> create new table -> create index and add foreign keys
  -> validate complete B structure
  -> atomic B terminal/install/readiness/availability publication
```

Existing same-plan step-reference/dependency receipts remain the ordering
mechanism. A step that uses retained objects depends on the verification step;
a foreign key also depends on each newly created endpoint table. Final
validation depends on every preceding step. A verification receipt does not
authorize stale reads: re-observe the required base projection and current
availability in each transaction that advances B. Takeover re-observes the
base and all committed candidate postconditions before reissuing candidate
prefix receipts under the new fence.

PostgreSQL foreign-key creation locks both referencing and referenced tables,
so even this additive profile needs real contention/timeout evidence. It makes
no claim of uninterrupted concurrent application writes. See
[PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html).
Keep ordinary transaction-bound indexes; concurrent index creation cannot run
in a transaction block and remains outside this profile. See
[PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html).

## Admission, Availability And Recovery

For a new B, require A to be the current collision-head plan, with a successful
terminal and exact installation/readiness evidence. A must be a fresh plan in
the same deployment, physical database/schema, locator, owner, lineage and
physical namespace profile. Require current base availability `ready`; reject
missing, withdrawn, superseded or quarantined state in this first profile.
This is stricter than the umbrella's minimum quarantined-base refusal.

Recognize exact B replay/resume before applying the new-successor rule. While
B owns the head, another candidate C cannot replace it. After B succeeds, C
using stale base A is refused, and a B-to-C upgrade is outside the one-hop
profile. Same-candidate retries compare the persisted base reference as well
as the candidate digest. Replays never synthesize a new admission or reset a
fence merely because the request supplies A again.

Admission appends to the existing event chain and records the exact previous
head plan. CAS advances head revision, preserves the collision's monotonic
attempt-fence counter, and starts B without inheriting A's active attempt.
Candidate plan/base metadata, admission, event and head transition are atomic.
They must not strand a newly admitted plan without its base evidence.

Lock order is collision root/head, then A's availability head. The availability
row must stay locked against status CAS through each advancing transaction;
a read of its status alone is insufficient. Existing private availability
mutations must be checked against this order. A status change between steps
halts further advancement; it cannot be bypassed with a cached base handle.
No new operator endpoint or availability-management API is included.

Finalization independently observes both retained and added structure. It
publishes B's exact result without withdrawing, superseding or selecting A or
B for serving. A's old receipts and rows remain unchanged. A timeout or lost
COMMIT response resolves via a distinct authenticated recovery session and
durable evidence. Never infer rollback, delete committed additions, or replay
DDL speculatively. Partial B state remains recorded and owned by B on refusal.

## Proposed Admission And Work Limits

Start with a fresh base of at most seven plan steps, one additive successor of
at most eight steps including base verification and final validation, and at
most two attempts per plan. Permit at most two plan admissions, 128 migration
events across the collision lineage and eight availability-history nodes per
installation. These are proposed execution-profile ceilings to measure, not
scalability claims. The existing fresh fifteen-step profile is unchanged.

Enforce traversal budgets before following excess links, including cold
restoration; do not restore an unbounded graph and only then count it. Preserve
cycle, byte/digest, sidecar and authority checks. Reserve enough event capacity
before a write for that transaction's complete publication. Refuse exhausted
profiles without resetting their durable state or claiming readiness; recovery
beyond these admitted limits requires a separately admitted capability.

Keep the current sixteen-call ceiling, 120-second default run budget,
60-second native transaction budget and 8,192-statement transaction ceiling.
Measure base restoration, admission, every step, takeover and finalization.
Failure to fit means narrowing or improving this profile, not increasing
timeouts to obtain a passing result. Pass-local reuse remains read-only and
cannot carry base authority across writes or transactions.

## Implementation And Acceptance

One implementation approval covers this complete capability. Work through its
dependent internals in order: canonical values and base reference; metadata
and cold restoration; the verification handler and shared coordinator policy;
then PGlite and ordinary-role PostgreSQL acceptance. This is not a request for
separate approvals for each file or internal stage.

Completion requires:

- fresh A -> additive B -> exact B replay, unchanged A object identities and
  seeded test rows, plus a new-to-retained foreign key and scope isolation;
- refusal of changed/deleted definitions, unreceipted new objects, wrong base
  target/owner/lineage, corrupt base bytes/sidecars and non-ready availability;
- same-B convergence, competing B/C serialization, stale A rejection after B,
  independent collision progress and availability-status races;
- interruption after each committed boundary, partial process restart, lease
  takeover, stale-fence rejection and pre-/post-COMMIT response-loss recovery;
- rollback of each advancing transaction's DDL and metadata together, while
  retaining earlier committed progress; no readiness on failed validation;
- limits at and beyond each admitted bound, including overlong cold graphs,
  and measured native work within the unchanged budgets;
- existing fresh, structural-runner, repository and target/session regressions;
  new manifest-owned PGlite/native upgrade lanes, compiler/lint checks and both
  required read-only implementation reviews.

Fixture row seeding is test-local evidence of preservation, not a new framework
data writer. Keep raw SQL where it proves physical catalog identity, corruption
or database concurrency. Under host memory pressure, serial compiler partitions
may cover the same roots/dependencies with unchanged options; report them as
partitioned checks rather than a passing monolithic command.

Classify existing fresh kernels and drivers as **keep/reuse**, fresh APIs as
**keep**, and fresh-only decoder/admission policies as **extend explicitly**.
There is no legacy executor removal, framework package promotion or temporary
storage bridge in this recommendation.
