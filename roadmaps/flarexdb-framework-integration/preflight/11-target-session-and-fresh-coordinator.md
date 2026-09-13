# Target Session And Fresh Coordinator Preflight

Status: accepted bounded decomposition of checkpoint 3 as of 2026-09-04. All
three source-private slices for the no-base synthetic profile are implemented
as separate PGlite-functional evidence: target/session, relational structural
runner, and fresh coordinator plus its repository helpers. The bounded native
PostgreSQL fresh profile now has independent contention and settlement evidence.
The separate [one-hop additive profile](./12-base-backed-additive-upgrade.md)
now owns bounded base-backed execution and its PGlite/native acceptance.
General lineage scale, other native transports, production resolution, runtime,
activation and public API gates remain open.

Last reviewed: 2026-09-05

## Decision

Implement checkpoint 3 from
[`09-relational-installation-and-migration-coordination.md`](./09-relational-installation-and-migration-coordination.md)
as three separately reviewable commits:

1. **Opaque target/session plus PGlite functional adapter:** bind one database,
   transaction driver, deployment, canonical physical database identity, and
   physical locator behind source-private authority. Mint a fresh logical
   session identity for each ordinary or recovery transaction, keep the raw
   transaction inside a bounded callback, and close it when that callback
   ends. The PGlite adapter supplies functional evidence for this seam.
2. **Relational structural runner:** observe and execute the admitted
   expansion-only structural operations through the target transaction. Issue
   one source-private opaque token bound to the exact captured plan and target,
   and resolve every fresh step once through four fixed operation handlers. Observe
   and execute from the registered handler rather than switching on codec text
   at either call boundary.
3. **Fresh coordinator and repository helpers:** claim and advance the stable
   collision lane, restore all persisted authorities inside their owning
   transaction, execute and validate the fresh plan, and publish terminal,
   installation, readiness, event, and availability evidence. The PGlite
   functional proof and the later bounded native proof remain independent.
   [Native implementation evidence](#native-implementation-evidence) defines
   the admitted fresh profile; upgrade and scaling gates remain open.

Completion of an earlier slice does not authorize a later slice. All three
remain source-private and production-inert. None may add a package-root export,
route, runtime caller, binding, adapter, startup hook, or production target
issuer.

## Slice 1 Authority Boundary

The target/session seam has one authority chain:

```text
host-bound database + session driver
  -> opaque migration target
  -> fresh ordinary or recovery session identity
  -> callback-scoped opaque transaction
  -> package-private raw transaction access
```

The target snapshot may reveal only the authenticated target namespace,
physical locator, and structural capability class. It must not expose the
database, driver, raw transaction, session constructor, or a reusable
repository handle.

Under the approved [installation redesign](./76-framework-installation-core-redesign.md),
runtime placement is a separate `FrameworkSchemaTarget` owned by
`frameworkSchema/target.ts`. Its snapshot has the namespace and locator but no
structural execution capability. A migration target exposes this narrower handle
as `.schema`; runtime hosts and binding no longer accept migration authority.
Both construction paths share exact database-object identity enforcement.
Constructing placement does not query or acquire a database connection and does
not certify installer-role protection.

The same database object cannot be rebound to a conflicting canonical physical
database identity. A driver must remain bound to the database with which it was
constructed. Recovery must identify one prior session from the same target as
the session excluded from recovery work. Every transaction request carries
positive bounded lock and statement budgets.

The transaction callback is the lifetime boundary. Package-private consumers
may obtain the raw transaction only while the opaque transaction is active and
only for its exact target. A closed or cross-target transaction fails rather
than leaking or reusing database authority.

These are private persistence mechanics, not a public relational database API,
framework service, `Context` singleton, or `Layer`.

## PGlite Functional Adapter

The PGlite adapter composes the target from the package-owned Drizzle database
and runs work inside one Drizzle transaction callback. It applies the requested
transaction-local lock and statement budgets before user work and preserves
typed callback failure, rollback/cleanup failure, begin/configuration failure,
and post-callback decision uncertainty as distinct outcomes.

This adapter proves only functional composition and lifecycle behavior. Its
fresh logical session identity is not proof of a new physical PostgreSQL
backend. Its recovery exclusion is a carried and validated identity, not proof
that an uncertain backend was discarded or that recovery acquired a distinct
connection. PGlite does not prove server lock waiting, statement cancellation,
concurrent collision exclusion, driver quarantine, or pre-/post-commit
settlement recovery.

The adapter defers an external Effect interruption while its PGlite transaction
settles. A pending interruption may therefore be delivered after the database
has committed, and an interrupted exit is not evidence that the transaction
did not commit. This slice does not supply interruption-to-decision recovery;
the production driver and coordinator must own that separately rather than
copying the PGlite lifecycle.

## Completed Slice 1 Functional Evidence

The focused
`packages/persistence-postgres/test/frameworkCoordinatorTargetSession.test.ts`
PGlite lane covers, without exporting the implementation:

- opaque frozen target snapshots and sequential plus concurrently competing
  rejection of conflicting database identity or a driver bound to another
  database;
- fresh session identity for each ordinary transaction and exact propagation
  of lock and statement budgets;
- recovery exclusion accepted only for a session from the same target;
- raw transaction access while active, followed by closed-transaction and
  cross-target and forged-authority rejection;
- synchronous user-work construction defects preserve their `Cause` and still
  close the transaction capability;
- a real successful PGlite commit and exact typed callback-failure rollback
  with database-row proof;
- synchronous begin and configuration-statement failures,
  callback-plus-rollback/cleanup failure, and post-callback decision-
  uncertain classification with exact causes and session identity; and
- absence from the package export map and package root.

The reproducible manifest-owned lane is:

```text
pnpm --filter @flarex/persistence-postgres test:framework-coordinator-target-session:pglite
```

The final lane receipt is nine of nine tests. Package typecheck and file-scoped
Oxlint passed. This closes only slice 1. The result remains PGlite-functional
evidence and does not promote any limit listed below.

## Slice 2 Authority Boundary

The structural runner has a separate authority chain inside the persistence
package:

```text
authenticated target + exact captured fresh plan
  -> frozen opaque plan/target-bound runner token
  -> exact captured step identity + fixed registered handler
  -> callback-active transaction for the token's exact target
  -> bounded catalog observation or trusted structural statement
```

Issuance is the only operation-codec dispatch point. A module-local registry
contains exactly four `(format, version)` handlers:

- `flarex.relational-create-table` version 1 creates one table together with
  its admitted columns, primary/unique keys, and integer-range checks;
- `flarex.relational-create-index` version 1 creates one ordinary B-tree
  index;
- `flarex.relational-add-foreign-key` version 1 adds one exact scope-authority
  or ordinary foreign key; and
- `flarex.relational-validate-structure` version 1 performs validation-only
  observation of the complete physical layout and emits no DDL.

The frozen token reveals none of the target, plan, registry, registered steps,
SQL, or transaction. Its module-local state retains the exact target and
captured plan plus an identity-keyed map from each captured step to its fixed
handler. A decoded or cloned token, an equal-but-distinct step, and a
transaction for another target fail before raw SQL. Observation and execution
therefore cannot use caller-selected codec text, SQL, callbacks, or physical
identifiers as authority.

For a structural step, observation returns only `absent` or `exact`. A
same-name object with any different admitted catalog facet fails as
`catalogMismatch`; it is never adopted. Execution refuses an already exact
object as `unreceiptedStructure`, emits one statement only for an absent DDL
step, and then requires the exact postcondition. The validation handler
requires the whole candidate layout to be exact. Exact-numeric raw defaults
use only the trusted encoder's canonical JSONB `{ value, precision }` value;
they do not admit caller SQL.

## Completed Slice 2 PGlite Functional Evidence

The focused
`packages/persistence-postgres/test/frameworkCoordinatorRelationalStructuralRunner.test.ts`
lane passes all fifteen tests and proves:

- one exact seven-step fresh synthetic plan in deterministic order: two table
  steps, one ordinary index step, three foreign-key steps, and one final
  validation-only step;
- six transaction-bound expansion DDL statements followed by validation, with
  the first six postconditions observed `absent` before execution and every
  postcondition observed `exact` afterwards;
- exact catalog comparison for tables, columns, defaults, primary and unique
  keys, integer-range checks, B-tree ordering and options, foreign keys, and
  the complete layout;
- fail-closed rejection of wrong same-name tables, missing or changed defaults,
  while accepting equivalent normalized integer-literal syntax; B-tree
  direction, null placement, opclass, collation and `INCLUDE` drift;
  unique-key `NULLS NOT DISTINCT`, foreign-key match drift, and a same-name
  non-foreign-key constraint before any structural DDL;
- target-transaction rollback of emitted DDL, plus rejection of exact
  pre-existing unreceipted structure;
- frozen/source-private token containment, forged-token rejection, and cloned-
  step and cross-target rejection before raw SQL;
- typed `resourceFailure` mapping for a synchronous raw-execution exception and
  a malformed driver-result envelope;
- validation evidence only from one complete aggregate-restored,
  issuer-authenticated receipt chain, with cloned, mixed-attempt, and reordered
  chains rejected as invalid authority; and
- trusted exact-numeric raw-default encoding and exact observation without
  widening the operation registry or accepting authored SQL, including
  rejection of changed canonical value or precision.

The reproducible manifest-owned lane is:

```text
pnpm --filter @flarex/persistence-postgres test:framework-coordinator-structural-runner:pglite
```

The final lane receipt is fifteen of fifteen tests. Package typecheck and
file-scoped Oxlint passed. This closes only the private PGlite-functional
structural-runner slice. It does not establish any genuine-PostgreSQL or
coordinator claim below.

## Slice 3 Authority And PGlite Functional Boundary

The fresh coordinator composes the first two source-private capabilities with
the exact stored coordinator authority. It rereads the exact admitted artifact
before opening target state, reissues relational lowering authority only after
the stored artifact reproduces its canonical bytes and digest, and captures
the no-base plan. Each execution transaction issues a plan/target-bound runner
token from its exact restored plan. A returned claim is an
opaque, source-private capability bound to that target, plan, attempt, lease
owner, and fence.

Lease takeover authenticates the predecessor's complete committed prefix and
re-observes each structural postcondition under the locked collision head. It
atomically issues dependency-coherent successor receipts with the new claim;
it neither replays completed DDL nor adopts structure without predecessor
receipt evidence. Missing or changed predecessor structure rolls back the
takeover. This prefix work remains subject to the bounded-lineage scale gate.

Each admitted turn restores and corroborates the stored collision head,
attempt, receipt prefix, and event history inside the owning transaction. A
step checks database time, lease ownership, fence, and dependency receipts,
executes at most one registered structural operation, and commits its exact
receipt, event, and advanced head atomically. A decision-uncertain transaction
is resolved through a distinct authenticated logical recovery session by
rereading durable state; the coordinator does not blindly replay the original
transaction.

Finalization independently re-observes the complete physical layout before it
publishes terminal, installation, readiness, availability history/head, event,
and collision-head evidence. Exact ready replay returns the authenticated
stored result without creating another attempt. Validation drift or corrupt
stored evidence fails closed without publishing readiness or availability.

The PGlite-functional boundary covers bounded interruption and exact resume,
stable busy results, serial lease expiry/takeover and stale-fence rejection,
logical committed-versus-rolled-back decision recovery, final structural
refusal, and exact readiness replay. These are state-machine and persistence
semantics only. A fresh logical recovery identity is not proof of a distinct
physical PostgreSQL connection, and serial lease tests are not lock or
concurrent-exclusion evidence.

## Remaining Checkpoint-3 Gates

The implemented private fresh profile does not resolve these issues:

- **Bounded lineage corroboration:** read-only pass reuse removes repeated
  immutable-reference reads within one restoration. Receipt prefixes,
  migration-event chains and availability-history chains can still accumulate
  `O(N^2)` work across independent restorations. General lineage scale needs
  its own measured bound and reviewed corroboration strategy before production
  activation.
- **Production target identity:** a host-owned production target resolver and
  driver registry must derive canonical physical database identity and issue
  targets. Caller-supplied test composition cannot become that authority.
- **Production runner resolution:** the private fixed-handler registry can bind
  an authenticated plan/target token, but a later host composition root must
  still decide which admitted runner profile may be issued for a production
  target. Codec text, a decoded token, or caller composition cannot become
  that selection authority.
- **Broader upgrade profiles:** the
  [additive contract](./12-base-backed-additive-upgrade.md) owns the implemented
  one-hop successor and its independent contention, interruption, settlement
  and recovery evidence. Fresh evidence does not establish these guarantees,
  and neither profile admits general or destructive upgrades.
- **Other native transports:** hosted poolers, TLS cancellation and production
  driver composition remain outside the direct non-TLS PostgreSQL test profile.

## Native Implementation Evidence

The approved native fresh-installation proof exposed a catalog wire-type
portability defect: PostgreSQL returns `pg_attribute.attname` arrays as
`name[]`, which node-postgres leaves as an encoded string, while the structural
runner requires a decoded text array. The native synthetic installation failed
before readiness with `column_names is not a text array`; PGlite had accepted
the same query. The affected owner is the private structural runner catalog
projection, within this native integration capability. The three name-array
projections now cast their elements to `text` at the SQL boundary, preserving
strict decoded-array validation and exact structural comparison. Native
installation/recovery and the existing PGlite structural lane cover the fix.

Native concurrent first-writer acceptance also exposed an over-strong collision
mutex: preparation held the immutable root `FOR UPDATE` while waiting for its
head, whereas a claim held the head and needed a foreign-key `KEY SHARE` lock
on that root while inserting an event. PostgreSQL detected the resulting cycle.
The private collision repository owns this in-scope correction: serialize
preparations with `FOR NO KEY UPDATE`, which still excludes another preparation
and key-changing/deleting writers but permits event foreign-key checks. An
independent-connection regression holds the head, queues preparation, then
inserts a referencing row without deadlock before releasing the head.

The source-private native adapter, `migrationCoordination/postgresTarget.ts`,
owns bounded callback-pool acquisition, transaction settlement, and cleanup;
its connection and transport modules own tracked SQL, the closed work fence,
authenticated BackendKeyData cancellation, drain and exact-client destruction.
Artifact control-session identities and repository authority remain separate.
Logical recovery identities map to actual checked-out clients, and an uncertain
client is excluded from durable decision reconstruction.

The native correctness lane covers ordinary-role fresh installation and replay,
concurrent first-head creation behind independent-connection barriers, live
claims, independent collision domains, lease takeover and stale fencing. It
also covers atomic DDL/receipt/event/head rollback, corrupt-ledger and catalog
refusal, acquisition expiry and late release, lock/statement/whole-transaction
deadlines, active-query cancellation, cleanup failure, blocked COMMIT settlement,
and interruption after acknowledged COMMIT. Separate OS-process tests reconstruct
partial progress and pre-/post-COMMIT response loss from durable state.

### Read-only Graph Corroboration

Private pass-local reuse reduces duplicate immutable-reference restoration
within one read-only graph pass. Event-chain restoration repeatedly reaches the
same attempt, admission and plan through distinct subjects and receipt prefixes.
Canonical codecs, complete sidecar checks, restored authority issuers,
repository signatures, transaction drivers and mutable-head lock/CAS behavior
remain intact. Only successful stored immutable references are retained;
failed or absent results are not. Pass identity includes the exact transaction;
reference identity includes the exact preferred authority object and every
reference argument. Digest-only and storage-ID-only global caches are excluded.

The pass begins inside a read-only aggregate restoration and ends on success,
failure or interruption. It cannot cross an ensure/publication write, separate
repository call, new transaction or recovery session. Closed inherited contexts
cannot reuse evidence. Each pass retains at most 512 successful reference
entries independently of the coordinator's statement and time limits;
exhausting retention capacity continues ordinary validated reads. This reuse
does not change storage formats, schemas, drivers or production resolution.

The pass also retains successfully verified receipt dependency nodes and exact
terminal prefixes. Node identity includes the issued attempt object, storage
ID, digest, operation and traversal policy; prefix identity additionally
distinguishes an empty terminal anchor, an exact tail and an unanchored complete
prefix. Local traversal stacks and cycle/duplicate detection are not shared.
Every retained node has passed the existing full stored-value and sidecar
restoration. New reads after a pass closes must detect changed roots or
sidecars, including within the same transaction.

Performance investigation separates fixture preparation, deliberate waits,
coordinator phase time, process CPU and successful SQL transport/row-delivery
time. Native work tests share observation mechanics while retaining their
scenario and correctness assertions. CPU profiles require serial tests in a
single worker; SQL elapsed time is not server CPU time. The portable driver-row
snapshot helper remains responsible for rejecting shared-backed bytes and
accessor/custom-record input before cloning, without throwing brand probes on
ordinary byte buffers. No shared mutable database or transaction-wide cache is
introduced by these optimizations.

A transaction-wide cache and durable closure anchors were considered and
deferred: they would require write invalidation or new persisted authority.
PostgreSQL [Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED)
uses statement snapshots, so sharing a transaction does not establish an
immutable database snapshot. Reuse here has the same read-pass boundary as the
existing receipt/admission restoration maps; it adds no isolation guarantee.

The native seven-, nine- and eleven-step work profiles require fewer SQL reads,
and the fifteen-step profile now fits the existing transaction and statement
budgets. Same-transaction corruption refusal and closed-context isolation
preserve fresh validation across passes. General upgrade/availability lineage
scale remains a separate gate; this optimization does not make work across
independent passes constant or establish production throughput.

### Admitted Work Profile

The shared coordinator, on both PGlite and PostgreSQL, admits at most **fifteen
plan steps** and at most **sixteen step calls per run**. Larger plans fail before target acquisition or metadata
publication. These are execution-profile limits; the pure plan/value format
retains its independent capacity. Defaults are a 120-second coordinator run,
5-second acquisition, 60-second transaction, 5-second cleanup, and 8,192 SQL
statements per transaction. The coordinator run budget may be configured up to
300 seconds. Statement and lock deadlines remain bounded by the transaction
budget. A timeout never establishes non-commit; a later run must reconstruct
durable progress or readiness.

Native work measurements cover seven-, nine-, eleven- and fifteen-step fixtures and
separate acquisition, preparation/claim, each step, reconstruction, takeover and
finalization. Deliberate lease waits are outside the operation measurements.
Pass-local immutable-reference reuse reduces repeated graph authentication
enough to admit the measured fifteen-step profile. Larger plans and long
lineages still require a separately reviewed, measured corroboration strategy;
the execution limit must not grow by increasing timeouts or extrapolating these
fixtures. This profile does not close the general lineage or throughput gate.

`test:framework-coordinator-fresh:postgres` is the manifest-owned serial native
lane. The target/session, structural-runner and fresh-coordinator PGlite lanes
remain independent regression evidence.

## Approved First Implementation Capability

**Native PostgreSQL fresh installation and recovery** was approved as one
coherent capability and is implemented for the bounded profile above. This
authorization does not extend to production selection or the excluded owners.

### Outcome And Reason For This Order

Run the existing no-base synthetic `system` plan through a source-private
native PostgreSQL target/session adapter and the existing coordinator. A fresh
install must reach one authenticated installation/readiness/availability
result, and competing claims, interruption, crash or lost response must either
recover that exact durable result or return an explicit unresolved/refused
outcome without speculative DDL replay.

This brings forward the fresh-profile portion of native acceptance before the
base-backed candidate in
[the umbrella sequence](./09-relational-installation-and-migration-coordination.md#ordered-implementation-checkpoints).
It tests the driver and coordinator together before adding upgrade semantics.
The separate base-backed PGlite and native proofs are owned by
[the additive capability](./12-base-backed-additive-upgrade.md); this fresh
capability does not establish those guarantees by itself.

### Implementation Boundary And Reuse

Keep the existing plan/value codecs, fixed fresh-operation handlers, metadata
catalog, repository authority, and PGlite adapter. Adapt the private
`FrameworkMigrationSessionDriver` seam for native acquisition, bounded
transaction execution and cleanup; any additional acquisition, whole-attempt
or cleanup budget belongs to this private lifecycle contract. Preserve typed
callback failure, confirmed rollback, cleanup failure and decision uncertainty.

Use a source-private test composition over a harness-owned known database and
locator. It must bind the driver and native connections to that exact target;
it is not a production physical-identity resolver or a new public issuer.
Recovery must exclude the actual uncertain backend, cancel and drain active
work before reuse or return, discard that backend when required, and use a
distinct physical connection. A fresh logical token alone is insufficient.

Inspect and classify these existing owners before implementing the native seam:

| Owner | Disposition |
| --- | --- |
| `migrationCoordination/targetSession.ts` | Keep authority/lifetime semantics; adapt only the private native lifecycle contract where required |
| `migrationCoordination/pgliteTarget.ts` | Keep as functional/test adapter; do not copy deferred interruption as native cancellation policy |
| `migrationCoordination/freshCoordinator.ts` and its repository helpers | Keep state-machine authority; fix only native-profile integration defects within the approved capability |
| `frameworkSchema/artifact/postgresControlSession.ts` and its native tests | Port applicable acquisition, cancellation/drain and settlement mechanics behind the target seam; artifact-specific identities and repository authority stay with their owner |
| Platform migrations, Application execution, commit/feed/outbox and production host resolvers | Keep unchanged; a required change to these owners needs its own preflight |

The artifact adapter uses artifact-specific session contracts and schema
composition. Its existing native tests are reference evidence, not proof of
the target adapter. Do not create a universal PostgreSQL session package merely
to share spelling; extraction is justified only by identical lifetime and
failure semantics. No legacy data migration, dual path or compatibility bridge
is required by this new private native test capability.

### Required Acceptance

- Run the existing structural profile and complete coordinator catalog on
  ordinary-role PostgreSQL; verify exact catalog postconditions and one durable
  readiness result on initial execution and replay.
- Use independent connections and deterministic barriers to prove first-head
  serialization, competing claims, database-time lease takeover, stale-fence
  rejection and independent collision domains proceeding without false
  blocking. Serial calls or sleeps alone do not prove exclusion.
- Roll back DDL and its receipt/event/head changes together on failure. Reject
  corrupt ledgers and mismatched structure without adopting unreceipted DDL or
  publishing readiness.
- Exercise acquisition expiry, lock/statement timeout, active-SQL cancellation,
  external interruption and cleanup failure. Prove that late acquisitions are
  released and the caller does not return while abandoned backend work can
  still publish unseen state.
- Inject pre-/post-commit response loss at step and finalization boundaries.
  Prove durable decision lookup using a distinct physical recovery connection;
  do not translate an interrupted Effect exit into evidence of non-commit.
- Reconstruct from durable state after a process restart during partial
  progress and after a committed result whose response was lost. This is
  separate from same-process token reuse.
- Measure statement counts and elapsed time by acquisition, claim, step,
  reconstruction, takeover and finalization on increasing bounded plan sizes.
  Record fixture size and deliberate waits separately. Freeze explicit work
  budgets for the claimed native profile and bound work per call; do not infer
  production scale from a passing seven-step fixture. General lineage scaling
  remains open if the measurements do not establish it.
- Preserve the existing target/session, structural-runner and fresh-coordinator
  PGlite lanes. Add a manifest-owned serial native lane, run the affected
  package typecheck/lint, and perform the repository's required implementation
  reviews. Missing native database access leaves native acceptance incomplete.

The test/code anchors are under `packages/persistence-postgres/src/` at the
owners above, plus `test/frameworkCoordinatorTargetSession.test.ts`,
`test/frameworkCoordinatorRelationalStructuralRunner.test.ts`,
`test/frameworkCoordinatorFreshCoordinator.test.ts`, and
`test/frameworkSchemaArtifactControlSession.postgres.test.ts`. PostgreSQL's
[explicit-locking contract](https://www.postgresql.org/docs/18/explicit-locking.html)
governs row-lock and deadlock expectations.

### Completion And Exclusions

Completion closes only native execution, contention and recovery for the
declared fresh profile. Base-backed upgrades, additional structural codecs,
destructive/data migrations, general scale, production target/runner
resolution, bindings, framework data stores/finalization, Payload/Medusa
adapters and hosted/public activation stay outside the capability. A failed
native proof must remain a failed or open gate rather than widening the
PGlite claim.

## Explicitly Closed Boundaries

This preflight and its bounded private PGlite/native slices do not prove or
authorize:

- production target resolution or physical database identity;
- native guarantees beyond the admitted direct non-TLS fresh profile;
- any structural operation outside the fixed create-table, create-index,
  add-foreign-key, and validate-structure registry, including base-backed or
  destructive migration;
- production-scale lineage reconstruction or coordinator throughput;
- base-backed planning, destructive change, rename, cast, data migration,
  seeds, nontransactional DDL, or concurrent index creation;
- Application projection, `DataBindingSet`, activation, serving, transaction
  store, commit participation, feed, or outbox work;
- Payload or Medusa adapters, schema compilation, migrations, Module Links,
  workflows, or runtime activation; or
- public relational, SQL, CMS, commerce, migration, target, session, or
  repository APIs.

## Exit Decision

Checkpoint 3 has the source-private target/session, structural runner and fresh
coordinator, with independent PGlite and bounded native PostgreSQL evidence.
Checkpoint 3 itself remains open. Base-backed execution, bounded-lineage scale,
and the production target/runner resolver remain mandatory before any adapter, runtime, hosted, public, or
production claim.
