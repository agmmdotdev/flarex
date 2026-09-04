# Target Session And Fresh Coordinator Preflight

Status: accepted bounded decomposition of checkpoint 3 as of 2026-09-04. All
three source-private slices for the no-base synthetic profile are implemented
as separate PGlite-functional evidence: target/session, relational structural
runner, and fresh coordinator plus its repository helpers. This does not
complete checkpoint 3. Genuine-PostgreSQL coordination and settlement,
bounded-lineage scale, base-backed execution, production resolution, runtime,
activation, and public API gates remain open.

Last reviewed: 2026-09-04

## Decision

Implement checkpoint 3 from
[`09-relational-installation-and-migration-coordination.md`](./09-relational-installation-and-migration-coordination.md)
as three separately reviewable commits:

1. **Opaque target/session plus PGlite functional adapter:** bind one database,
   transaction driver, deployment, canonical physical database identity, and
   physical locator behind source-private authority. Mint a fresh logical
   session identity for each ordinary or recovery transaction, keep the raw
   transaction inside a bounded callback, and close it when that callback
   ends. PGlite is only the functional/test issuer for this seam.
2. **Relational structural runner:** observe and execute the admitted
   expansion-only structural operations through the target transaction. Issue
   one source-private opaque token bound to the exact captured plan and target,
   and resolve every step once through a fixed four-handler registry. Observe
   and execute from the registered handler rather than switching on codec text
   at either call boundary.
3. **Fresh coordinator and repository helpers:** claim and advance the stable
   collision lane, restore all persisted authorities inside their owning
   transaction, execute and validate the fresh plan, and publish terminal,
   installation, readiness, event, and availability evidence. This slice is
   accepted only as source-private PGlite-functional evidence for the no-base
   synthetic profile. It does not resolve the genuine-PostgreSQL concurrency,
   settlement, or scaling gates below.

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
PGlite lane passes all nine tests and proves, without exporting the
implementation:

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

The implemented PGlite-functional profile does not resolve these issues:

- **First-writer serialization:** the implementation locks the stable collision
  row before admission and initial head creation because `SELECT ... FOR UPDATE`
  on an absent mutable head locks no row. Real PostgreSQL must still prove
  that mutex excludes competing first writers before any concurrency claim.
- **Bounded lineage corroboration:** receipt prefixes, migration-event chains,
  and availability-history chains can accumulate `O(N^2)` database reads when
  rebuilt independently. A transaction/session-authenticated cache,
  materialized closure anchor, or another bounded database proof is required
  before scale or production activation.
- **Production target identity:** a host-owned production target resolver and
  driver registry must derive canonical physical database identity and issue
  targets. Caller-supplied PGlite composition cannot become that authority.
- **Production runner resolution:** the private four-handler registry can bind
  an authenticated plan/target token, but a later host composition root must
  still decide which admitted runner profile may be issued for a production
  target. Codec text, a decoded token, or caller composition cannot become
  that selection authority.
- **Genuine-PostgreSQL coordinator acceptance:** real PostgreSQL must still
  prove first-writer exclusion, `FOR UPDATE` behavior, concurrent claims,
  lease contention, lock and statement timeouts, cancellation, external
  interruption, transaction settlement, and recovery on a distinct physical
  session for both fresh and later base-backed profiles.

## Explicitly Closed Boundaries

This preflight and its three bounded PGlite-functional slices do not prove or
authorize:

- production target resolution or physical database identity;
- genuine-PostgreSQL locking, collision exclusion, lock/statement timeout,
  cancellation, recovery-session separation, transaction settlement, or
  external-interruption-to-decision recovery;
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

Checkpoint 3 now has three implemented source-private slices for the no-base
synthetic PGlite-functional profile: target/session lifecycle, plan/target-
bound structural execution, and fresh coordinator plus repository
orchestration. Checkpoint 3 itself remains open. Genuine PostgreSQL,
base-backed execution, bounded-lineage scale, and the production target/runner
resolver remain mandatory before any adapter, runtime, hosted, public, or
production claim.
