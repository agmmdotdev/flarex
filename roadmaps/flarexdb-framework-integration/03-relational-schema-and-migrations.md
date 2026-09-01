# Relational Schema And Migration Coordination

## Status And Scope

Status: accepted target contract; exact consumer audits and implementation
pending

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

Every definition has stable identity, deterministic ordering, canonical
encoding, and a digest. No DML closure, ORM entity, Drizzle object,
`ModuleJoinerConfig`, service instance, or raw SQL object crosses this boundary.

The schema is internal. It is not a public developer relational DSL.

The exact Medusa source-and-contract audit must complete from the primary-fork
snapshot admitted by
[`preflight/04-medusa-fork-source-island-and-package-convergence.md`](./preflight/04-medusa-fork-source-island-and-package-convergence.md)
before this model's implementable field and capability set is frozen. Official
Medusa is provenance and comparison evidence, not the integration source that
constrains this model. The accepted shape is a boundary, not authority to invent
a speculative substitute for fork DML or repository behavior.

The exact Payload release-and-adapter contract audit must also complete before
shared migration, binding, transaction, or receipt capabilities that Payload
would consume are frozen. That audit constrains only exact shared mechanisms.
It does not make Payload content part of `RelationalSchema`: Payload content
continues through the authenticated Application document schema, row, OCC, and
native-relation path, with Payload-owned lifecycle plans remaining separate.

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

They share execution fencing and evidence. They do not share one giant step
union or compatibility classifier.

## Migration Plan And Ledger

A domain-owned `MigrationPlan` is immutable and records:

- semantic owner and target installation;
- base and candidate artifact digests;
- deterministic step identities and dependencies;
- required execution role and capability profile;
- preconditions and postconditions;
- bounded progress and checkpoint policy;
- validation commitments; and
- whether a reverse operation is explicitly proven safe.

The shared migration coordinator owns:

- target and generation resolution;
- authorization;
- lease claim, renewal, loss, and takeover keyed by physical locator, semantic
  owner, installation identity, and artifact identity rather than by scope
  clock alone;
- dependency order;
- attempt identity and checksums;
- progress and immutable receipts;
- retry and uncertainty handling;
- readiness publication; and
- cold replay.

The domain runner owns what each step means and exposes only approved
operations. The first implementation must not execute arbitrary runtime SQL or
developer callbacks.

Because one physical installation may serve many scopes, migration claim and
ledger identity are installation-scoped. Two scopes selecting the same target
cannot run competing DDL merely because their scope generations differ.

## Deployment Flow

```text
compile immutable candidate
  -> compare with active artifact
  -> create deterministic plan
  -> expand structures
  -> run bounded backfills
  -> validate constraints and semantic commitments
  -> publish installation readiness
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

## Safety Rules

- Scope and owner restrictions are physical, not optional query filters.
- Shared-table primary, unique, and applicable foreign keys include scope
  authority.
- Destructive contraction waits for binding retirement.
- Failed, interrupted, or lease-lost work cannot publish readiness.
- An idempotent replay returns the same receipt.
- Migration and runtime roles are distinct.
- Backup/restore and operator recovery retain artifact and receipt provenance.
- Down migration is not assumed; forward repair is the default.

## First Proof

Before wiring any framework adapter or promoting an active Medusa package,
prove the coordinator on a small synthetic reserved-relational schema:

- fresh install;
- interrupted step and exact resume;
- concurrent claimant fencing;
- validation failure;
- readiness publication;
- activation refusal before readiness;
- activation after readiness; and
- safe retention of the previous installation.

This migration-coordinator proof stops there. Next complete the separately
preflighted installation/binding, transaction-owner and owner-scoped store,
commit-owner and receipt/finalizer mechanics, followed by the complete synthetic
reserved-relational lifecycle/transaction proof. Then prove the full existing
Flarex Application vertical, Payload scalar/request-transaction behavior, and
Payload's relation-bearing candidate plus first non-reactive native one/many
relation behavior in the order frozen by
[`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md).
Only after those gates pass may the Medusa roadmap promote the connected
Currency closure and compile a live Currency candidate.

## Exit Criteria

- Canonical schema digest is deterministic across processes.
- Unsupported capabilities fail admission before DDL.
- Structural planning is deterministic and owner-scoped.
- The durable ledger survives restart and claimant loss.
- Readiness cannot be forged by a domain runner.
- Genuine PostgreSQL proves locks, DDL transaction assumptions, concurrency,
  and constraint behavior.
- Existing platform and application migrations remain separately owned and
  unchanged.
