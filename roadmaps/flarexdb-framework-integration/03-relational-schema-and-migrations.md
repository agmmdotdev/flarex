# Relational Schema And Migration Coordination

## Status And Scope

Status: value-only relational schema, the first pure physical/coordination/
lifecycle value checkpoint, additive private coordinator metadata DDL, and
source-private topological restoration implemented production-inert;
the private target/collision repository family is also implemented; remaining
repositories, generated relational DDL, target-session, binding, and runtime
gates remain closed

This plan owns the value-only relational schema boundary and the shared
execution mechanics for framework-owned migration plans. It does not own DML,
Payload configuration, framework lifecycle semantics, or Flarex platform
migration history.

## Relational Schema

`RelationalSchema` is a deterministic value model for trusted compilation and
planning. It contains owner-qualified definitions for:

- tables and columns;
- primary and unique keys;
- check and foreign-key constraints;
- indexes;
- nullability, defaults, and supported generated values;
- physical relationship and pivot requirements; and
- persistence capabilities required by repositories or lifecycle behavior.

Every definition has stable owner-qualified identity and deterministic ordering.
The complete normalized value is the typed payload of the existing private
framework artifact, whose canonical encoding and digest remain the sole
artifact authority. No DML closure, ORM entity, Drizzle object,
`ModuleJoinerConfig`, service instance, or raw SQL object crosses this boundary.

The schema is internal. It is not a public developer relational DSL.

The first value contract is implemented and recorded in
[`preflight/08-relational-schema-value-contract.md`](./preflight/08-relational-schema-value-contract.md).
It admits only the exact first-slice value vocabulary and source-backed
fixtures, performs no DDL, and creates no installation, migration, transaction,
adapter, or runtime caller.

The cycle-free installation, physical-lowering, collision-domain,
coordinator, readiness, and availability design is accepted in
[`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md).
Its first pure-value checkpoint is implemented under the private
`relationalSchema/physical`, `migrationCoordination`, and
`frameworkSchema/installation` owners. The exact checkpoint-2 metadata,
cold-rehydration, and private repository contract is accepted in
[`preflight/10-relational-coordinator-metadata-and-repositories.md`](./preflight/10-relational-coordinator-metadata-and-repositories.md).
Its additive private metadata storage, focused PGlite DDL/catalog evidence, and
source-private stored restoration are implemented. The private target/collision
repository family is implemented; all later repository families remain pending.
Target sessions, generated relational DDL, the Application projection,
`DataBindingSet`, activation, and serving also remain pending.

The exact Medusa source-and-contract audit is complete at fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` in
[`preflight/06-medusa-package-capability-source-map.md`](./preflight/06-medusa-package-capability-source-map.md).
It makes mature DML the source grammar, records the Currency authored,
derived, and implicit schema facts, and rejects the standalone scalar-only DML
experiment and eager Drizzle graph as schema authority. Official Medusa remains
provenance and comparison evidence.

The exact Payload release-and-adapter contract audit is also complete for
`payload@3.88.0` in
[`preflight/07-payload-release-and-adapter-contract.md`](./preflight/07-payload-release-and-adapter-contract.md).
It constrains only exact shared migration, binding, transaction, receipt, and
host mechanisms. Payload content does not become part of `RelationalSchema`:
it continues through the authenticated Application document schema, row, OCC,
and native-relation path, with Payload-owned lifecycle plans remaining
separate.

[`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md)
owns the consumer-informed proof order and the stop before Medusa package
promotion.

## Domain Compilers

Each semantic owner compiles independently:

- application definitions continue through the application manifest and
  managed-schema owner;
- Payload content definitions compile into the application schema path while
  Payload lifecycle requirements remain Payload-owned; and
- Medusa compiles normalized DML derived from the admitted primary-fork
  snapshot, the complete configured supported module/link set for the
  candidate, resolved Joiner and Module Link configuration, and declared
  persistence capabilities into one commerce relational artifact.

Do not create another Medusa DML grammar inside Flarex. The Medusa adapter owns
normalization and translates its output at the boundary.

## Migration Families

Keep these plans distinct:

| Family | Semantic owner | Examples |
| --- | --- | --- |
| Platform | Flarex persistence | control tables, catalogs, commit/feed/outbox storage |
| Application | application managed schema | validator scans, index/unique/edge builds |
| Payload | Payload adapter | versions, drafts, auth, locks, jobs, lifecycle data transformations |
| Medusa | Medusa adapter | normalized tables, constraints, link tables, authored commerce backfills |

They do not currently share one execution host. The accepted coordinator first
owns framework structural plans for a synthetic `system` artifact and, only
after its adapter gate, Medusa structural plans. Platform remains on the static
Drizzle runner, Application keeps its existing build/readiness owners, and
Payload lifecycle/data plans remain Payload-owned. A later family may reuse
exact fencing or evidence mechanics only through its own preflight. No family
shares one giant step union or compatibility classifier.

## Migration Plan And Ledger

A domain-owned `MigrationPlan` is immutable and records:

- semantic owner, candidate artifact, exact physical locator,
  host-authenticated canonical target namespace, and optional base
  installation;
- base and candidate artifact digests;
- deterministic step identities and dependencies;
- required execution-capability profile;
- preconditions and postconditions;
- bounded progress and checkpoint policy;
- validation commitments; and
- whether a reverse operation is explicitly proven safe.

The shared migration coordinator owns:

- exact target resolution and capability-profile authentication;
- authorization;
- lease claim, renewal, loss, and takeover keyed by one stable collision domain
  comprising deployment, host-authenticated canonical physical-database
  identity, exact schema name, semantic owner, lineage, and physical namespace
  profile rather than by logical locator alias, candidate artifact,
  installation, or scope clock;
- dependency order;
- attempt identity and checksums;
- progress and immutable receipts;
- retry and uncertainty handling;
- readiness publication; and
- cold replay.

The domain runner owns what each step means and exposes only approved
operations. The first implementation must not execute arbitrary runtime SQL or
developer callbacks.

Because one physical installation may serve many scopes, structural claim and
ledger identity are physical-lane-scoped. Different candidate artifacts for
the same lane cannot run competing DDL. Scope-bound seed or lifecycle-data work
uses a different later identity and cannot be hidden inside structural
readiness.

## Deployment Flow

```text
compile immutable candidate
  -> compare with explicit base installation or fresh state
  -> create deterministic plan
  -> expand structures
  -> run bounded backfills
  -> validate constraints and semantic commitments
  -> publish installation readiness
  -> publish or change installation availability

later binding checkpoint:
  authenticate readiness + availability
  -> activate through DataBindingSet
  -> contract only after old bindings are gone
```

Production runtime startup checks the active digest and fails closed. It does
not run migrations. Local development auto-apply, if later added, is explicit
and uses the same coordinator and receipts.

## Medusa Baseline Policy

The first commerce installation is a fresh baseline compiled from the admitted
primary-fork snapshot, its recorded official-upstream provenance baseline, and
the complete configured supported module/link set for that candidate. The
first candidate may contain Currency alone. Do not replay or mechanically
translate the full historical MikroORM migration archive.

Later upgrades use:

- deterministic structural active-to-candidate differences; plus
- explicit Medusa-owned semantic/data transformations that cannot be inferred
  from final DML.

Module tables and stored Module Links become ready and active as one coherent
commerce generation. Per-module migration loading may contribute source intent,
but it cannot partially activate the runtime schema.

Currency's default dataset is scope-bound Medusa initialization evidence. It is
not part of a locator-wide structural installation receipt and remains blocked
until the Medusa data-migration and binding gates define its exact identity.

## Safety Rules

- Scope and owner restrictions are physical, not optional query filters.
- Shared-table primary, unique, and applicable foreign keys include scope
  authority.
- Destructive contraction waits for binding retirement.
- Failed, interrupted, or lease-lost work cannot publish readiness.
- An idempotent replay returns the same receipt.
- Migration and runtime software capabilities are distinct. Database-enforced
  PostgreSQL role separation remains a mandatory hosted/production preflight.
- Backup/restore and operator recovery retain artifact and receipt provenance.
- Down migration is not assumed; forward repair is the default.

## First Proof

The value-only schema proof is complete. Before wiring any framework adapter or
promoting an active Medusa package, separately preflight and prove the
coordinator on a small synthetic reserved-relational schema:

- fresh install;
- interrupted step and exact resume;
- concurrent claimant fencing;
- validation failure;
- readiness publication;
- availability transition only after readiness; and
- a separate base-backed additive candidate that safely retains the exact
  authenticated base structures.

The design boundary and ordered implementation checkpoints are frozen by
[`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md).
The exact checkpoint-2 storage/repository boundary is frozen by
[`preflight/10-relational-coordinator-metadata-and-repositories.md`](./preflight/10-relational-coordinator-metadata-and-repositories.md).
The coordinator proof stops at authenticated readiness and availability. Next
complete the Application-projection and `DataBindingSet` preflight, then a
separate synthetic-`system` selection preflight because the initial binding set
has no system slot. Only then complete the transaction-owner and owner-scoped
store, commit-owner and receipt/finalizer mechanics, followed by the complete
synthetic reserved-relational lifecycle/transaction proof. Then prove the full
existing Flarex Application
vertical, Payload scalar/request-transaction behavior, and Payload's relation-
bearing candidate plus first non-reactive native one/many relation behavior in
the order frozen by
[`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md).
Only after those gates pass may the Medusa roadmap promote the connected
Currency closure and compile a live Currency candidate.

## Exit Criteria

- Canonical schema digest is deterministic across processes.
- Unsupported capabilities fail admission before DDL.
- Structural planning is deterministic and owner-scoped.
- Installation identity is derived after the plan digest with no digest cycle.
- Different candidates for one physical lane share one collision-domain fence.
- Physical names are bounded digest spellings and scope isolation is injected
  into every applicable key, index, and foreign key.
- The durable ledger survives restart and claimant loss.
- Readiness cannot be forged by a domain runner.
- Structural readiness does not claim residual query/store behavior, scope
  data initialization, binding, activation, or serving.
- Genuine PostgreSQL proves locks, DDL transaction assumptions, concurrency,
  and constraint behavior.
- Existing platform and application migrations remain separately owned and
  unchanged.
