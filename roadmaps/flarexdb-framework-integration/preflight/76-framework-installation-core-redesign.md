# Framework Installation Core Redesign

## Shared Logical Storage Authority

Storage target correction: [shared logical storage](../../../design-notes/flarexdb-shared-logical-storage.md)
and its [replacement gates](../../shared-logical-storage/README.md)
supersede this record's physical Medusa/module-table destination and any
per-deployment schema recommendation. Retain applicable source provenance,
framework semantics and completed implementation evidence. Generated-table DDL,
physical index/FK mappings and their tests describe the displaced baseline;
they are not a compatibility obligation or permission to extend it as the
platform destination. Inventory retained system/lifecycle consumers separately.
Target migration remains unimplemented.

Status: completed within the approved bounded profiles. This replaces the
narrower, unapproved
[step-transition proposal](./75-migration-step-transition-proof.md). Normal step execution now uses the
[protected direct-dependency command](./85-protected-normal-step-command.md);
takeover retains original plan receipts. The coordinator
[prepares execution definitions once per run and exposes an explicit read-only audit](./79-prepared-definition-and-explicit-audit.md).
Full graph handoff, complete phase accounting, cleanup and frozen performance
acceptance are complete. ShippingProfile remains paused at its own connected
module/Link/workflow gates. Neither this document nor its examples activate future framework modules.

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

Database-bound schema placement now belongs to `frameworkSchema/target.ts`.
Runtime hosts, installation selection and data binding accept its opaque
`FrameworkSchemaTarget`, which carries no migration driver or transaction runner.
Trusted runtime composition can create this evidence without constructing a
migration session. Migration construction issues its own separate authority and
exposes only attenuated placement through `.schema`; both factories enforce the
same exact database-object/canonical-identity binding. Persisted namespace and
installation identities are unchanged. These source-private handles are not
production target resolution or proof of protected execution privileges.

Native migration execution now checks protected-login and metadata-guard
requirements on every acquired ordinary or recovery connection before invoking
coordinator work. Construction still borrows a trusted caller-owned pool and
does not itself certify any future connection. The [receipt storage cutover](./77-installation-progress-storage-map.md) makes
completion unique per plan step while retaining the producing attempt and digest.
Takeover reobserves the original prefix without cloning receipts or completion
events; terminals retain their fence-bounded prefix. The [durable head progress](./78-collision-head-progress.md)
now stores the completed position and original receipt tail and checks them against
authenticated events. Its CAS advances one completion atomically. The coordinator
now separates [lifecycle operations](./81-coordinator-lifecycle-operations.md)
behind its existing entry points. The [trusted installer construction](./82-installer-construction-and-completion-gates.md)
now owns fresh/additive batching and one prepared definition per installation
call, with [explicit inspection and verification](./83-installer-inspection-and-verification.md)
through the same construction. [Evidence handoff](./84-installation-evidence-graph-and-step-transition.md)
now shares attempt lineage, terminal prefixes and publication prerequisites within
event restoration. A [per-plan receipt working graph](./86-receipt-evidence-across-event-and-terminal-subjects.md)
shares receipt/edge issuance across event subjects and terminal inventories while
retaining exact actual root rereads. Explicit verification retains the head's issued receipt
prefix and independently checks its stored inventory. The protected normal
command now reads fresh locked head/event/tail projections and direct completion
references, then validates the actual receipt, sidecars, event and guarded head
write in one target-owned transaction. Its claim retains immutable definition and
actual attempt lineage, never cached live progress or lease authority.
[Live-claim restart](./87-live-claim-restart-without-history-replay.md) now
authenticates the prepared admission and actual attempt lineage, then reuses fresh
normal progress checks without replaying receipt/event history. Ordinary negative
readiness probes issue no readiness authority. Positive readiness, new/expired or
competing claims, uncertain recovery and explicit verification retain their full
evidence owners. [Protected final publication](./89-protected-final-publication.md)
performs one complete head/inventory/catalog proof and hands its prerequisites to
the existing publication writers; exact stored occupants, event transitions and
head CAS remain mandatory. [Settled readiness replay](./90-settled-readiness-evidence-handoff.md)
hands its authenticated readiness to fresh availability head/history restoration,
removing repeated installation reconstruction. [Retirement and acceptance](./91-installation-redesign-retirement-and-acceptance.md)
cover the bounded structural-work accounting, unchanged full-suite comparison and
retained independent owners. Runtime and ordinary audit costs retain the limits
described there; this is not arbitrary-inventory or deployment performance proof.

### Connected validation boundaries

Offline Application fixture seeding must leave its seeded row readable. The
fixture writes a row revision and commit fact, advances the scope clock, then
uses the existing physical-index build owner to consume that commit. Without
the catch-up, active reads correctly refuse `physicalBuildNotCovered`; binding
must not bypass that refusal. This is test setup, not a replacement Application
write path or a production readiness change.

The stored-authority loader captures and checks its selected size-projection row
before constructing the combined Application graph size record. A cardinality
check alone does not narrow indexed access under a consumer's
`noUncheckedIndexedAccess` setting. Missing/extra rows still fail through the
existing materialization checks; no assertion or weakened row contract is needed.

### Protected execution profiles

PGlite cannot currently prove the restricted-login integrity contract. In the
installed PGlite 0.5.8 source, `defaultStartParams` selects PostgreSQL single-user
mode and the `username` option executes `SET ROLE` after startup; it does not
authenticate a new session. A reproducible in-memory witness creates a restricted
login role, dumps the database, closes it, and reopens the snapshot with that
`username`. `current_user` becomes the restricted role and its `rolsuper` is false,
but `session_user` remains `postgres`; `SET SESSION AUTHORIZATION postgres`
succeeds. Both database instances are disposable and closed after the probe.

Therefore a current-role-only admission check, including one under `SET ROLE`,
would falsely certify protection. Native admission must establish the actual
login authority on the acquired execution connection, account for role/session
reset and reachable owner privileges, and verify the exact protected objects and
guards before coordinator work. A constructor-time probe on another pooled
connection is insufficient. Provisioning remains separately privileged.

The approved split makes protected installer execution a native PostgreSQL
capability. PGlite remains an explicitly functional-only conformance lane for the
shared algorithm and guard behavior, with its migration factory in test support
and outside the shipped source tree. It does not issue native restricted-login
protection. There is no `skipProtection` option, owner fallback, or weakening of
shared integrity rules for a framework or test driver.

`postgresTargetProtection.ts` owns the connection checks; `postgresTarget.ts`
retains acquisition, deadlines, rollback, quarantine, settlement and excluded
recovery-session ownership. Before work, the connection resets role/session
authorization to reveal its authenticated login, captures its metadata namespace,
and pins name resolution to `pg_catalog`, that namespace, then `pg_temp`.
Metadata checks inspect the fixed protected object set, not installation rows or
historical prefixes. Login checks also inspect reachable privileges and retained
foreign-key dependencies in the database catalog; their cost can grow with the
catalog and remains part of the later performance gate.

The current native profile deliberately requires a login with no superuser,
database/role-creation, replication or bypass-RLS attributes, no role memberships,
no database CREATE or `session_replication_role` setting privilege, and no
executable security-definer functions owned by another role, including functions
in `pg_catalog` and functions whose namespace is no longer usable. It also rejects
table- or column-level `REFERENCES` on any non-owned table, and existing foreign
keys from installer-owned tables to non-owned tables even after that grant is
revoked, because referential-integrity casts execute with the referenced table
owner's authority. For references in the opposite direction, it admits only a
single matching UUID or text key on both sides, its exact built-in equality
operators, and NO ACTION/RESTRICT actions. Each text key must use the built-in
default or C collation; current binding candidates use C while the scope root
uses default. This retains current Application scope UUID and text-ID references
without admitting user-defined conversions or cascading writes as another owner.
It rejects database, protected namespace/table/function,
extension and procedural-language ownership. Rejecting extension ownership also
closes indirect cascading deletion through the guard language's dependencies.
Initial timeout configuration uses qualified built-ins before protection pins
name resolution. The installer owns its physical tables and reference roots;
physical DDL ownership remains separate from protected metadata ownership.
Supporting a more permissive role graph is a future explicit profile decision,
not an implicit exception for a consumer.

The checked metadata catalog must have ordinary non-partitioned, non-inherited
tables without rewrite rules or RLS. The execution role cannot have their TRIGGER
privilege. Guard function bodies are pinned to the guard migration by SHA-256,
with exact language/configuration and execution properties. Trigger checks cover
the complete expected set, enabled state, timing/events, function identity,
arguments and absence of conditional/transition-table alterations. Parent stamp
columns must retain their required bigint shape. These checks do not replace
historical completeness, canonical-value, FK, physical-structure or lineage
verification by their existing owners.

Native fixtures now provision separate installer logins and reuse the real
protected driver. Setup/corruption access stays with the fixture owner;
application access to installer-created physical tables uses explicit grants,
not installer-role membership. Provisioning credentials are required for that
test lane and are never a runtime fallback. Restart workers authenticate as the
same fixture installer without inheriting process-local authority. Fixture
cleanup closes installer pools, returns surviving physical objects to setup for
its schema teardown, and removes only its disposable roles and grants.
Administrative reset checks both setup and installer pools for borrowed clients
before truncating fixture state.

These are native conformance guarantees, not a production provisioning service,
Cloudflare/Hyperdrive deployment proof, cross-cluster restore capability, or a
performance result. Privileged repair still requires quiescence/fencing and full
verification; arbitrary online administrator edits remain outside the protected
execution contract.

Sources: installed PGlite source-map `src/pglite.ts`, the
[PGlite constructor contract](https://pglite.dev/docs/api), PostgreSQL
[single-user authority](https://www.postgresql.org/docs/18/app-postgres.html),
and [session authorization/reset](https://www.postgresql.org/docs/18/sql-set-session-authorization.html).

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

This is a metadata and execution-contract redesign. `freshCoordinator.ts` now
owns bounded run orchestration over separate preparation, claim, step and
finalization operations. Normal steps use the collision head's committed position
and exact direct dependency completions; same-owner live restarts reauthenticate
the definition and progress. Full restoration remains at named publication,
takeover, recovery and verification boundaries.

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

## Core Model

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

Trusted construction binds the existing target, artifact repository and policy.
The source-private factory owns preparation and bounded batches; requests supply
business selection and attempt identity. Existing capabilities still control
artifact admission and target placement.

```ts
const installer = Result.getOrThrow(makeFrameworkInstaller({
  target, artifactRepository, policy,
}));
const result = yield* installer.installFresh({
  artifactIdentity, commerceProfile, attemptId, leaseOwnerId,
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

## Operation Organization And Reading Order

Within the existing package, use one lifecycle-oriented owner:

```text
migrationCoordination/
  installer.ts                construction and install/inspect/verify operations
  definition.ts               authenticate and prepare a structural plan
  coordinatorPreparation.ts   preparation, admission and fenced claim opening
  coordinatorClaim.ts         claim evidence and fresh locked progress checks
  coordinatorStep.ts          one step and named uncertain-outcome recovery
  verify.ts                   full graph, inventory and catalog verification
  coordinatorFinalization.ts  complete proof and delegated readiness publication
  schema.ts                   authoritative metadata and constraints
  targetSession.ts            target transaction and recovery-session contracts
  postgresTarget.ts           acquired-connection protection and settlement
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
   target from the resulting scaling measurements. The retained local regression
   budget is 15 seconds for the fixed seventeen-table installation/reopen timer;
   it is separate from the unchanged test deadline and is not a deployment SLO. No bulk-DDL transaction shortcut or performance bypass for fixtures.
7. Readability acceptance: trace one successful step and one uncertain outcome
   through named operations; show Medusa and Payload callers with no private
   assembly imports. Review responsibility placement and hidden graph work, not
   counts of files/imports. Run affected typechecks, lint, source/export guards and
   both required reviewers for retained code. Remove displaced paths, reconcile
   roadmaps and commit coherent verified changes. Never retain a failed candidate
   behind a mode flag.

## Approved Direction And Deferred Capabilities

The approved redesign and its bounded acceptance gates are complete. Production
provisioning, Cloudflare deployment, online privileged repair, arbitrary framework
migrations and ShippingProfile connected activation retain their separate gates.

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
- [PostgreSQL privileges](https://www.postgresql.org/docs/18/ddl-priv.html), [statement snapshots](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED) and [trigger behavior](https://www.postgresql.org/docs/18/trigger-definition.html). These establish mechanism constraints; current schemas, code and tests establish the implemented protection.

Exact frozen revisions, samples, hashes, observer limitations and validation
receipts belong in artifacts and Git history. The acceptance statement here is
limited to the retained profiles and unchanged fixture.
