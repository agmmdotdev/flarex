# Shared Schema Installation And Evolution

Status: **accepted architecture; shared foundations exist; full consolidation
and Task integration pending**. The [accepted database design](./flarex-db-accepted-design.md)
owns general authority. This note owns the shared schema lifecycle for Flarex
Application, Payload, Medusa and platform Tasks. It complements the
[shared logical storage design](./flarexdb-shared-logical-storage.md) and
[Task design](./task-system/README.md).

This is a documentation decision. It does not implement new APIs, activate a
schema, run migrations or reset data. Existing bounded capabilities retain their
recorded limits. [Advanced evolution](../roadmaps/shared-logical-storage/deferred-framework-schema-evolution.md)
remains a separately scoped follow-on after the core redesign.

## One Shared Internal Lifecycle

All four consumers build on shared core APIs for logical schema admission,
installation and evolution. Extend and consolidate the existing owners. Do not
create an installer or independently authoritative migration engine for each
framework or for Tasks, or preserve overlapping engines behind one facade.

```text
Flarex app schema / authenticated analysis ----\
Payload collection compiler -----------------+
Medusa model / module / Link compiler --------+--> shared schema lifecycle core
Platform-owned Task schema definitions -------/       |
                                      logical catalog and storage
                                      shared indexes and DO cache machinery
                                      PostgreSQL durable authority
```

"Shared core APIs" describes one set of responsible mechanisms and contracts;
it does not require a new package, service registry, universal authoring DSL or
one giant install function. Keep native Application OCC, Payload, Medusa and
Task transaction profiles distinct. Each schema has an authenticated owner,
target scope, immutable version and declared dependencies. Independent apps and
platform scopes can use different schema versions over shared physical storage.

## Producer And Core Responsibilities

| Owner | Supplies or owns |
| --- | --- |
| Flarex Application producer | Developer declarations, authenticated schema analysis and function/code dependencies; developer push/deploy entry points compose the shared lifecycle |
| Payload producer | Native collection/configuration compilation, field and lifecycle interpretation, and any explicit Payload data-conversion meaning |
| Medusa producer | Native DML/model/module/Link compilation, dependency requirements and explicit business-conversion meaning for admitted upgrades |
| Platform Task producer | Private run/attempt/wait/checkpoint and scheduler/discovery/repair definitions, version requirements and admitted Task record conversions |
| Shared schema lifecycle core | Stable identities, immutable definitions, provenance/dependency checks, logical change planning, index/constraint builds, validation, progress/recovery, readiness, activation and retirement |
| Shared execution/persistence/host owners | Scoped authority, outer settlement, fencing, durable outcomes/publication, core cache coherence and injected runtime/storage mechanisms |

Compilers translate native schema inputs into admitted core definitions. They
do not acquire raw installation or settlement authority. Framework runtime
startup and ordinary requests consume ready bindings; they do not silently run
DDL or migrations. The Trigger fork remains the Task execution engine. Schema
installation/evolution belongs to the shared core used by that engine's store.

## Lifecycle Contract

These are responsibility boundaries, not proposed callable names or a new step
language. Reuse current owners and derive exact API shapes from connected work.

| Stage | Shared guarantee |
| --- | --- |
| Capture and compose | Authenticate producer output and target, detach bounded immutable definitions, resolve explicit dependencies and reject conflicting ownership |
| Admit | Allocate/reuse stable logical identities and persist exact version/provenance evidence idempotently; admission alone issues no serving capability |
| Plan | Compare current and desired definitions, classify compatible changes and required work, and refuse unsupported transitions without altering the active schema |
| Prepare and execute | Install logical definitions and perform admitted builds/backfills/conversions with bounded work, stable operation identities and durable progress |
| Validate and mark ready | Prove required data, indexes, constraints and dependency versions usable; partial build coverage is not readiness |
| Activate | Revalidate live authority and expected current state, then publish the admitted schema/execution binding through its trusted settlement owner |
| Retire | Account for retained readers, pending work, rollback/forward-repair policy and durable data before removing displaced definitions or records |

Shared progress and recovery must handle competing installers, replay, stale
plans, interrupted builds and uncertain commits. Preserve the existing correct
settlement/outcome owner. No database transaction spans an entire backfill,
remote effect, workflow pause or arbitrary framework callback. Data conversions
use admitted bounded operations; their semantic meaning remains producer-owned.
Restoring an old schema definition does not undo converted data automatically.

Dependency-aware activation does not make writes across different databases or
scopes atomic. Each activation has an explicit settlement domain. Where a
transition spans domains, retain safe serving fences and use an admitted durable
protocol. A producer cannot activate against missing or incompatible dependencies.

## Application And Platform Installation

Developer schema authoring and push/deploy APIs sit above the shared internal
lifecycle. Internal Payload, Medusa and Task producers need not fabricate
developer source or invoke a public CLI to install their own definitions.
Application analysis continues to authenticate deployed functions; accepting a
system schema must not grant executable-code or arbitrary data-plane authority.

Task schemas are platform-maintained logical definitions bound into each
app/environment or private platform scope. Their identities and data survive
app code redeployment. App schema replacement cannot delete or redefine them.
Use trusted platform producer evidence and core catalog/installation authority;
a reserved namespace or an `owner: system` label alone is insufficient.

Bootstrap generic core storage/catalog first, then install the required Task
logical schemas through shared APIs before enabling the engine. Initial
installation and its recovery cannot depend on running a Task whose own schema
is not ready. Later background work may use admitted execution capabilities
without moving schema progress, activation or settlement ownership into Trigger.

## Logical Evolution And Physical Core Upgrades

Logical tables, indexes and constraints use the shared physical families. Adding
an app, Payload collection, Medusa module or Task index does not create a
dedicated per-consumer SQL schema/table/index family. Shared builds and schema
activation participate in core readiness and publication/cache rules; no
consumer-specific index builder or invalidation layer is added.

Physical upgrades of generic PostgreSQL storage/catalog infrastructure remain
platform maintenance with their own versioning and deployment rules. They are
distinct from logical per-scope evolution, while reusing correct lower-level
authority/session/outcome mechanisms where contracts fit. This decision does
not make platform SQL migrations app-controlled or authorize new Task-specific
physical tables. The [Task retirement contract](./task-system/04-cutover-and-retirement.md)
still removes the entire old Task-specific physical representation.

## Current Foundations And Gaps

| Existing source | What it establishes |
| --- | --- |
| [Schema composer](../packages/medusa-adapter/src/composition/schema.ts), [Payload compiler](../packages/payload-adapter/src/collections.ts) and native Medusa definition compilers | Current trusted composition of Application, Payload and selected Medusa definitions; no complete four-consumer installation API |
| [Candidate protocol](../packages/flarex-protocol/src/logical-schema-candidate.ts) and [candidate preparation](../packages/analysis/src/logicalSchemaCandidate.ts) | Shared definition/provenance contract, including a `system` source kind; candidate format still requires Application-analysis coordinates |
| [Logical schema admission](../packages/persistence-postgres/src/storage/catalog/logicalSchemaAdmission.ts) | `makeLogicalSchemaAdmission` uses the shared catalog transaction owner; current construction is deployment/scope-bound |
| [Logical definitions](../packages/persistence-postgres/src/storage/catalog/logicalStorageDefinitions.ts) and [readiness](../packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts) | `ensureLogicalStorageDefinitions`, shared requirements/build machinery and `prepareLogicalStorageReadiness`; candidate admission alone is not installation/readiness |
| [Managed Application schema deployment](../roadmaps/flarexdb-foundation/05-managed-schema-deployment.md) and [framework coordinator](../roadmaps/flarexdb-framework-integration/03-relational-schema-and-migrations.md) | Private bounded planning/apply/activation and installation/progress mechanisms to compare and consolidate; neither is a finished universal lifecycle |

Platform Task installation needs an authenticated system producer and target
contract independent of mandatory Application analysis and app code deployment.
Generalize the actual shared admission/readiness owners; do not disguise Tasks
as Medusa models or invent an Application analysis artifact. Inspect current
callers and preserve their guarantees while removing displaced choreography.

General populated-data upgrades, ownership transfers, arbitrary native business
conversions and production orchestration remain unimplemented or separately
gated. A producer being representable in a schema format does not establish its
installation, migration or runtime support.

## Ownership And Implementation Gates

The [shared storage roadmap](../roadmaps/shared-logical-storage/README.md) owns
common foundation/consumer consolidation and its existing completion boundary;
the [Task roadmap](../roadmaps/task-system/README.md) owns Task installation and
engine cutover. Advanced transitions follow the deferred evolution owner. This
note does not silently add Tasks or a general migration product to an already
active core implementation goal.

Each admitted implementation must identify the existing owner and named
consumer/transition, consolidate the required mechanisms, migrate callers and
remove redundant code/exports/metadata with an explicit durable-data disposition.
Prove initial install, idempotent replay, wrong-scope/provenance refusal, index
and constraint readiness, interrupted work, activation races, uncertain outcomes
and dependent-version refusal on PGlite and ordinary-role real PostgreSQL.
Task witnesses include bootstrap without the Task engine, app redeployment
preserving private schemas, a scoped Task schema change and no separate installer.
Core cache reuse also requires its actual DO composition/restart evidence.
