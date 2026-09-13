# Framework Installation Core Redesign

Status: approved, implementation in progress. This is the
recommended replacement direction for the narrower, unapproved
[step-transition proposal](./75-migration-step-transition-proof.md). Current
coordinator execution path remains unchanged. ShippingProfile remains
paused. Neither this document nor its examples activate future framework modules.

## Current Implementation Boundary

The storage-protection foundation adds database guards to the existing immutable
metadata tables. Plan, admission and receipt roots carry a database-stamped
`created_transaction_id`. Their sidecars must be inserted in the same transaction
as the root, so commit closes each child set without another seal flag or table.
The stamp is bookkeeping, not a canonical identity or a verification capability.
It is cluster-local: logical restoration into a different cluster must not be
admitted as a protected target without administrative restamping/resealing and
full verification. No cross-cluster logical-restore path is enabled here.
Existing exact insert-conflict replay remains admissible because no new child row
is inserted. Stored-value validation still owns exact completeness and content.

History UPDATE/DELETE and TRUNCATE are guarded; the existing two mutable heads
remain mutable. An administrator can disable database guards, so these mechanisms
do not establish immutability against the metadata owner. Restricted-login
conformance is separate from owner-role corruption injection. Fault-injection
helpers explicitly disable only the relevant guards inside an administrative
transaction and restore them; ordinary readers retain their corruption checks.

The optimized progress model, protected-target admission, readable installer
facade, verification reorganization and performance acceptance are not yet
implemented. In particular, existing target construction still accepts a
caller-owned pool and does not enforce a non-owner login. Full current
reconstruction remains in force; the new guards are not permission to cache
database authority or enable the proposed fast path before those gates pass.

## Outcome And Scope

Make structural installation understandable and efficient by separating the
immutable definition, authoritative current progress, and full verification.
Normal execution must not reconstruct growing history to rediscover each next
step. A reader should find the public operation, transaction boundary, next-step
selection, completion write and failure recovery without traversing mutually
recursive repositories.

The owner is `@flarex/persistence-postgres`. Keep the existing target-session,
structural handler, artifact, installation/readiness and binding authorities.
Medusa owns module/link compilation and semantic migration meaning; Payload owns
configuration and lifecycle meaning. Neither adapter constructs coordinator
repositories or compensates for its cost.

This is a metadata and execution-contract redesign, not just a wrapper around
`freshCoordinator.ts`. Its 2,167 lines currently combine preparation, claims,
takeover, receipt carry-forward, step execution, recovery and publication. Its
step path restores a complete prefix, then receipt/event/head operations restore
overlapping prerequisites again. The existing collision head stores the current
attempt and event tail, but next-step selection still uses restored prefix length.

The nearest connected proof remains the seventeen-table Product/ShippingProfile
installation, cold reopening and unchanged native operations. Include Payload's
existing preference installation and content/lifecycle binding from the beginning.
Do not wait until another framework exposes the same shared-owner problem.

Non-goals: a universal migration language, Medusa business migration execution,
Payload migration callbacks, new production exports, arbitrary DDL callbacks,
whole-installation transactions, automatic startup installation, automatic down
migrations, Application schema-owner replacement, or a new workflow engine.

## Framework Coverage And Future Modules

| Consumer | Installation owner and required boundary |
| --- | --- |
| Future supported Medusa module/link sets | Medusa compiler produces one complete configured relational candidate; shared structural installation handles admitted tables, constraints, indexes and dependencies without module-name branches. Separate execution profiles remain confined after installation. |
| Payload content collections and relations | Existing authenticated Application analysis, schema readiness and activation. Do not install another relational copy of content or create a second Application head. |
| Payload reserved physical lifecycle storage | Existing preference storage is the concrete second structural consumer. Later physical lifecycle artifacts may reuse this path only where their admitted structural semantics agree. |
| Framework data conversion, backfill, hooks and seeds | Remain framework-owned, separately admitted operations. Structural readiness is not evidence of completed business initialization. |
| Binding activation | Existing binding owner checks all required readiness and the exact Application reference. It does not execute migrations. |

The pinned Medusa migrator records executed scripts; its MikroORM runner resolves
native migration handlers. Neither supplies Flarex target, admission or fencing
authority. Installed Payload `3.88.0` exposes migration methods in its adapter
contract, but the executing Flarex adapter deliberately refuses them. Reusing a
structural installer does not turn those methods into supported callbacks.

Convex's checked-in `SchemaState` distinguishes pending, validated and active
states with uniqueness invariants. Preserve that separation of preparation,
validation and activation; do not copy its storage implementation into this
framework structural lane.

Design for growth in steps, dependency edges, module/link inventory, attempts and
upgrade lineage independently. An extra supported module should need declarations
and genuine adapter extensions, not a new coordinator factory. Unsupported
semantics still fail closed. General Medusa upgrades and Payload data migrations
are not implied by better fresh-installation throughput.

## Proposed Core Model

### Definition: what is allowed to be installed

Keep the exact artifact, target, physical layout, ordered plan, dependency graph
and admission with their current semantic owners. Authenticate them when opening
an installation run; prepare indexed step/dependency access once for that run.
Persisted identity and immutability must justify reuse, not a process-local
`verified` flag. Immutable decoded values are not live lease or commit authority.

### Progress: what Postgres has committed

Extend or replace the existing collision head as the sole current progress row;
do not add a competing checkpoint head. It needs the exact plan/admission,
current attempt/fence/lease, revision, completed position and corresponding
completion/event commitment. The completed position is a transactionally
maintained contiguous-prefix invariant, not an uncorroborated count supplied by
the caller. Only the coordinator may advance it.

One step locks that row and reads the selected operation and its exact direct
dependency receipts. It executes the fixed structural handler, validates actual
postconditions and persisted completion evidence, and advances progress in the
same transaction. Progress cannot advance without the receipt and event; receipt
or DDL failure cannot leave advanced progress. Validate the actual affected rows,
sidecar cardinality and conflict occupants rather than fabricating successful
write results. A tail hash alone is not historical authentication.

### Verification: establish or check complete evidence explicitly

Keep a full verifier for the definition, receipts, events, progress consistency
and catalog. Read each node/edge once within a bounded verification pass rather
than recursively restoring the same prerequisites through multiple repositories.
The verifier returns a diagnostic report or issues existing narrowly authorized
readiness evidence through its owner; an inspection report is not a capability.

Full verification is mandatory before initial readiness publication, explicit
cold verification, and reopening after privileged repair. Recovery/takeover may
require one bounded full pass where their evidence contract needs it. An ordinary
next step or progress inspection must not implicitly run a full audit. A mismatch
fails closed; a verifier never silently repairs progress or adopts unreceipted DDL.

Normal process restart reauthenticates the definition and reads committed progress;
it is not automatically an audit of every historical event. Lost commit responses
use the existing distinct recovery session and exact attempted transition. Never
infer non-commit from a timeout or replay an operation from in-memory success alone.

## Approved Integrity Contract

The proposed fast path relies on enforced stable completed metadata. Current
canonical bytes, foreign keys and append-only repository methods do not alone
prevent a privileged SQL writer changing historical rows.

Selected contract:

1. A restricted installer execution role cannot update/delete/truncate completed
   definition, receipt or event data, alter its guards, or act as metadata owner.
   Provisioning/administration remains separately privileged. Where an existing
   immutable row is also a locking anchor, account for PostgreSQL row-lock
   privilege requirements and reject actual mutation with an enforced guard;
   do not assume SELECT-only grants preserve the existing locking protocol.
   Scope and opaque
   target checks are still required; SQL privileges do not replace them.
2. Parent completeness must be protected too: reject extra sidecars/dependencies
   after the parent is sealed. Removing UPDATE permission alone is insufficient.
   Creation, exact completeness validation and sealing are one transaction.
   Any database guard used for sealing must serialize with inserts to prevent a
   concurrent late child from escaping the check. Prefer eliminating a redundant
   sidecar over adding a second generic sealing system solely to preserve it.
3. Current progress is mutable only through the trusted command's guarded
   transition. Shared locking follows the existing collision order. Audit data is
   append-only history, not another independently writable progress authority.
4. Administrative repair requires quiescing/fencing the installation, invalidating
   its execution/readiness eligibility as appropriate, then full verification
   before reopening. Arbitrary live historical edits are unsupported. Automatic
   repair and an online repair API are not part of this slice.
5. Corruption of evidence actually read, changed write results and failed catalog
   checks still fail immediately. Full verification detects inconsistent stored
   history outside the selected step's working set. It is not a cryptographic
   guarantee against an administrator rewriting all data and commitments.

This explicitly changes the detection schedule: ordinary progress calls no longer
promise to rediscover arbitrary historical corruption after each statement.
Fault-injection tests must distinguish a forbidden ordinary-role mutation from
an administrative corruption witness caught by full verification. Do not just
delete the old corruption assertions or make every old reader secretly shallow.

READ COMMITTED supplies statement snapshots, not a fixed transaction snapshot;
the head lock does not freeze arbitrary historical writers. PostgreSQL owners can
restore their own privileges. Therefore role separation, sealed-child rules and
repair exclusion need executable ordinary-role PostgreSQL evidence before any
fast path is retained. PGlite also needs a guard witness; running a fixture as
owner is not a role-isolation proof. If the existing host provisioning cannot
satisfy this contract without a different authority boundary, stop and present
that exact decision rather than falling back to unenforced immutability.

## Small Construction API

Current trusted callers assemble target/artifact repositories, repeat coordinator
policy in the operation input and own a pure verification wrapper across batches.
The commerce fixture's essential shape is:

```ts
const migration = {
  target, artifactRepository, artifactIdentity, commerceProfile,
  attemptId, leaseOwnerId, leaseDurationMilliseconds,
  lockTimeoutMilliseconds, statementTimeoutMilliseconds, maximumStepsPerRun: 16,
};
// Repeat coordinator calls while pending, inside withFrameworkMigrationPlanVerification.
yield* runFreshFrameworkMigrationCoordinatorEffect(migration);
```

Proposed naming/usage sketch, not existing exports or final TypeScript signatures:

```ts
// Trusted host composition only. Existing opaque capabilities, no raw DB escape.
const installer = makeFrameworkInstaller({ target, artifactRepository, policy });

const result = yield* installer.installFresh({
  artifactIdentity,
  commerceProfile, // Existing exact commerce admission; absent for admitted non-commerce plans.
  attemptId,
  leaseOwnerId,
});
```

Use named `installFresh`, `installAdditive`, `inspect` and `verify` operations;
reuse current admitted inputs and result meanings rather than create a generic
operation dispatcher. Additive remains limited to its existing admitted profile;
the method does not enable commerce upgrades. The Payload preference call supplies
its admitted artifact, not a fabricated commerce profile. Future admission
extensions belong with their real profile owner, not module strings in core.

The factory binds stable capabilities/policy and hides repositories, verification
scope and internal claim construction. It performs no installation on construction.
Installation owns bounded internal batches with one prepared definition per run,
separate per-step transactions and an explicit total work/time budget. It returns
ready, pending, busy or not-ready as appropriate; pending never launches hidden
background work. The operator may resume using the same request identity. Do not
confuse a batch yield with a new historical audit or increase test deadlines.

Retain meaningful result alternatives and precise Effect failure channels. One
installer instance is bound to one target; no global singleton, generic repository
factory or callback registry. Artifact admission remains a separate trusted
authority; a small API must not secretly grant artifact publication rights.

## Proposed Organization And Reading Order

Within the existing package, use one lifecycle-oriented owner:

```text
migrationCoordination/
  installer.ts       construction and install/inspect/verify operations
  definition.ts      load, authenticate and prepare a structural plan
  claim.ts           claim, renew and take over fenced execution
  executeStep.ts     the complete single-step transaction, top to bottom
  progress.ts        exact progress/receipt/event storage transitions
  verify.ts          full bounded graph and catalog verification
  recover.ts         uncertain settlement reconciliation
  finalize.ts        verify completion; delegate readiness publication
  schema.ts          authoritative metadata and constraints
  targetSession.ts   existing driver/session/settlement owner
```

This is a reading map, not a mandate to force all remaining codecs or physical
handlers into ten files. Keep substantial pure value codecs and registered DDL
handlers with their existing owners. `frameworkSchema/installation/` continues
to own published installation/readiness/availability, and binding remains outside.

The central flow should visibly read:

```text
open definition -> claim/resume -> [lock progress -> read step/dependencies
  -> execute/check structure -> record completion + advance progress -> commit]
  -> verify complete installation -> publish readiness
```

Square brackets are one bounded transaction repeated per step. Recovery is a
named failure branch, not recursive repository behavior. Storage helpers may
validate their own rows, but must not secretly reconstruct the whole installation.
No file-length quotas, artificial interface-per-file split or giant export barrel.
Public operators must not import `storedRestoration`, read-pass slots, repositories
or receipt constructors to run installation.

## Retain, Extend, Replace, Delete

| Existing responsibility | Proposed disposition and completion condition |
| --- | --- |
| Target namespace, collision identity, physical assignment ownership | Retain; these prevent wrong-target/name ownership, not redundant audit scaffolding. |
| Artifact, plan, admission and their sidecars | Retain semantic identity/admission; replace repeated restoration with one prepared definition and protected storage. Keep an indexed projection only for a demonstrated query/constraint; remove redundant representations after auditing consumers and sealing requirements. |
| Mutable collision head | Extend/replace in place as sole operational progress. Reconsider mirrored mutable canonical bytes/digest only with a complete reference/CAS migration; no second head or boolean verified flag. |
| Attempt starts/terminals and lease/fence evidence | Retain responsibilities; simplify access through claim/recovery. Do not collapse attempts into a progress count or erase takeover provenance. |
| Receipts, dependency evidence and events | Retain durable completion/audit/recovery meaning; replace recursively authenticating write composition with one exact transition. Takeover must not clone a complete prefix merely to make execution convenient; any receipt-identity change requires an explicit reference mapping before cutover. |
| Installation/readiness/availability and binding | Retain distinct owners and externally consumed guarantees. Adapt their verifier input; do not bypass publication or create a second Application selector. |
| `freshCoordinator.ts` assembly and displaced generic read paths | Replace with lifecycle operations; delete obsolete exports/assembly after every current consumer migrates. Keep full verification where it has an independent contract. |
| Graph read-pass caches and pure verification helpers | Retain only where a remaining bounded verifier/codec demonstrably needs them. Delete unused slots, recursive loaders and compatibility paths; no larger caches as the redesign. |
| Diagnostic hooks and comparison implementations | Delete from runtime. Benchmark evidence lives outside production execution. |

No arbitrary target table count is promised. Before schema edits, produce an
exact column/FK/identity/writer inventory under this approved direction; generic
table reduction is not itself correctness. The user reports development-only
data and no production compatibility obligation: prefer one clean replacement,
not V2/V3 APIs or permanent dual formats. Determine any actual cross-package
identity obligations before removing them. Any development database reset must
name its exact disposable target; this proposal does not authorize deleting
workspace/application data or another task's fixtures.

## Implementation And Acceptance Gates

1. Freeze the invariants, writer/sealing rules, before/after callers and exact
   storage/reference mapping. Resolve provisioning or schema decisions that would
   exceed this contract before implementing them. Reconcile accepted owner notes
   only after approval, not to retroactively bless implementation drift.
2. Prove the new progress transition and full verifier with neutral plans on both
   drivers. Cover dependency diamonds, missing/extra/reordered children, unchanged
   digests with changed bytes, insert conflicts, altered returned rows, invalid
   prefix, duplicate completion, wrong target/fence, takeover and lease expiry.
   Test concurrent parent sealing/child insertion and ordinary-role write refusal.
3. Replace the connected coordinator, finalization and recovery paths together.
   Preserve DDL/receipt/event/progress atomicity, cancellation, rollback-only and
   commit-success/response-loss recovery. Retain distinct recovery sessions and
   fail-closed treatment of unreceipted physical structures.
4. Migrate trusted construction callers and run both real lanes: Medusa's current
   module/link inventory and Payload preference installation plus combined
   Application-content/lifecycle binding and Local API delete. Keep existing
   admitted additive and neutral system regressions. Do not implement unrelated
   dirty ShippingProfile code or claim full module activation from installer proof.
5. Measure algorithmic work independently of time. For N steps and E dependency
   edges, one uninterrupted install should inspect O(N + E) structural metadata,
   plus bounded full passes at named boundaries, not O(N squared) growing prefixes.
   Count rows/bytes fetched and nodes verified, not just SQL statements. Use
   increasing neutral inventories and varying fan-out, attempts and lineage.
   Report restart/takeover/full-audit costs separately; repeated external opens
   must not be hidden inside the normal-run complexity claim. Dense graphs can
   legitimately have quadratic E. Bound memory and check indexed query plans too.
6. Retain record 74's full-suite timing comparison as a minimum, not an ambitious
   final SLO: unchanged native assertions/deadline, alternating samples on both
   drivers, censored baselines reported honestly. Agree a tighter operational
   target from the resulting scaling measurements; do not promise seconds without
   evidence. No bulk-DDL transaction shortcut or performance bypass for fixtures.
7. Readability acceptance: trace one successful step and one uncertain outcome
   through named operations; show Medusa and Payload callers with no private
   assembly imports. Review responsibility placement and hidden graph work, not
   counts of files/imports. Run affected typechecks, lint, source/export guards and
   both required reviewers for retained code. Remove displaced paths, reconcile
   roadmaps and commit coherent verified changes. Never retain a failed candidate
   behind a mode flag.

## Approved Direction And Remaining Gates

The user approved the architecture of protected immutable definitions/evidence,
one durable operational progress owner, and explicit full verification, shared by
the actual structural consumers above. The selected
corruption-detection/repair contract prohibits live historical edits and verifies at
named boundaries instead of re-reading all history during normal progress.

The target design does not promise immediate detection of arbitrary privileged
historical edits on every normal call. Its protected-target and verification
boundaries must be implemented before normal execution stops reconstructing that
history. Merely renaming the existing loop cannot achieve the intended scaling.

## Evidence And Governing Sources

- [Accepted framework storage architecture](../../../design-notes/flarexdb-framework-storage-architecture.md), especially Artifact/Installation/Binding and Migration Authority.
- [Package boundaries](../../16-package-boundaries.md), [Medusa adoption](../06-medusa-adoption.md) and [Payload adoption](../07-payload-adoption.md).
- [Metadata catalog](./10-relational-coordinator-metadata-and-repositories.md), [coordinator contract](./11-target-session-and-fresh-coordinator.md), [reconstruction research](./74-shared-migration-graph-restoration.md) and [predecessor proposal](./75-migration-step-transition-proof.md).
- Current `migrationCoordination/freshCoordinator.ts`, `schema.ts`, receipt/event/head repositories and `frameworkSchema/installation/storedMetadataRestoration.ts`; `test/commerceHostFixture.ts` is the before-call witness.
- Pinned `third_party/medusa/SOURCE.json`, framework `migrations/migrator.ts` and utils `dal/mikro-orm/custom-db-migrator.ts`; installed Payload `3.88.0` database types and executing `packages/payload-adapter/src/adapter.ts`.
- Checked-in Convex `crates/common/src/bootstrap_model/schema_state.rs` and `crates/application/src/schema_worker/mod.rs`, relative to the enclosing Convex checkout.
- [PostgreSQL privileges](https://www.postgresql.org/docs/18/ddl-priv.html), [statement snapshots](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED) and [trigger behavior](https://www.postgresql.org/docs/18/trigger-definition.html). These establish mechanism constraints, not that this proposed protection is implemented.

Exact prior timings and observer limitations remain in the research receipt;
this document establishes no new performance result.
