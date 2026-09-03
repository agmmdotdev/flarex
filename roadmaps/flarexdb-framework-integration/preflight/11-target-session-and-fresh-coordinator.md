# Target Session And Fresh Coordinator Preflight

Status: accepted bounded decomposition of checkpoint 3 as of 2026-09-04. The
first source-private target/session plus PGlite functional-adapter slice is
complete as a private functional receipt. The relational structural runner and
fresh coordinator remain later slices, and no checkpoint-3 coordinator is
accepted yet.

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
   expansion-only structural operations through the target transaction. This
   slice must settle the opaque runner-token registry boundary before it is
   accepted; a direct codec switch in draft source is not an accepted
   composition contract.
3. **Fresh coordinator and repository helpers:** claim and advance the stable
   collision lane, restore all persisted authorities inside their owning
   transaction, execute and validate the fresh plan, and publish terminal,
   installation, readiness, event, and availability evidence. This slice is
   not accepted until its state machine, recovery, concurrency, and scaling
   gates below are resolved.

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

## Unresolved Checkpoint-3 Gates

The remaining implementation must resolve these issues before the fresh
coordinator can be accepted:

- **First-writer serialization:** `SELECT ... FOR UPDATE` on an absent mutable
  head locks no row. Fresh admission and initial head creation therefore need
  a stable genuine-PostgreSQL mutex, such as locking the already-present
  collision-domain row, before any concurrency claim.
- **Bounded lineage corroboration:** receipt prefixes, migration-event chains,
  and availability-history chains can accumulate `O(N^2)` database reads when
  rebuilt independently. A transaction/session-authenticated cache,
  materialized closure anchor, or another bounded database proof is required
  before scale or production activation.
- **Production target identity:** a host-owned production target resolver and
  driver registry must derive canonical physical database identity and issue
  targets. Caller-supplied PGlite composition cannot become that authority.
- **Runner dispatch:** the composition root must decide and authenticate an
  opaque runner token. The current design does not yet accept direct switching
  over artifact codec names inside the structural runner.
- **Coordinator state machine:** fresh claim, lease/fence ownership, bounded
  reread, stable `not_ready` outcomes, recovery, exact stored-plan rebinding,
  validation, and publication still require focused PGlite and genuine-
  PostgreSQL acceptance. Draft code is not a coordinator receipt.

## Explicitly Closed Boundaries

This preflight and its first slice do not prove or authorize:

- production target resolution or physical database identity;
- genuine-PostgreSQL locking, collision exclusion, lock/statement timeout,
  cancellation, recovery-session separation, transaction settlement, or
  external-interruption-to-decision recovery;
- generated relational DDL, the structural runner, or fresh coordinator;
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

Checkpoint 3 now has a bounded ownership and review sequence. Slice 1 closes
only the source-private target/session lifecycle and its PGlite functional
adapter. The structural runner and fresh coordinator remain separate
decisions, and genuine PostgreSQL plus the production host resolver and scaling
gates remain mandatory before any coordinator, adapter, runtime, hosted, or
production claim.
