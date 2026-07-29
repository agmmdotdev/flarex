# FlarexDB System APIs Proposal

Status: discussion proposal only

Last discussed: 2026-07-29

This note proposes a long-term API architecture for FlarexDB as a hosted,
multi-tenant database platform. It is intentionally not a roadmap,
implementation plan, package-extraction approval, public API commitment, or
claim about current routed behavior.

The proposal exists so the control-plane, schema, data, framework-adapter,
operator, and private database-kernel boundaries can be challenged before they
become implementation gates.

When this note conflicts with an accepted design or active roadmap, the
accepted design or roadmap controls.

## The Question

FlarexDB is becoming more than an internal Postgres persistence package. It
needs to support:

- Flarex application queries and mutations;
- sandboxed Dynamic Worker execution;
- Payload-backed CMS behavior;
- Medusa-backed commerce behavior;
- tenant, project, environment, and deployment provisioning;
- schema and migration lifecycle;
- backups, restore, repair, and operational inspection;
- OCC, commit publication, change feeds, outbox, and recovery; and
- several physical isolation models without exposing physical placement to
  ordinary application code.

The design question is not whether FlarexDB should have APIs. It should.

The important question is which capabilities belong in stable platform APIs
and which mechanisms must remain private database authority.

## Proposed Verdict

Expose database capabilities and lifecycle semantics. Do not expose internal
database machinery.

The long-term API family should be:

```text
Flarex Control API
  tenant, project, environment, deployment, and scope provisioning

Flarex Schema API
  validate, plan, migrate, prove readiness, and activate

Flarex Application Data API
  typed query, mutation, transaction, and live-result semantics

Flarex Framework Adapter APIs
  Payload lifecycle storage and Medusa commerce persistence

Flarex Operator API
  backup, restore, migration jobs, redrive, repair, and inspection

Private FlarexDB Kernel APIs
  sessions, journals, compiler, OCC, committer, persistence, feed, and outbox
```

These API families converge on the same authoritative Postgres data plane,
scope clock, commit feed, and outbox. They do not collapse into one universal
transaction API.

## Relationship To Standard Application APIs

Standard Application APIs and FlarexDB System APIs solve different problems.

```text
Developer API producer             Internal Test API producer
          \                              /
           -> Standard Application APIs
                definition
                analysis
                registration
                invocation
                         |
                         v
              FlarexDB System APIs
                schema lifecycle
                application data
                framework adapters
                private commit authority
```

Standard Application APIs normalize application intent and compose application
lifecycle stages. They must not become a database administration or raw
persistence surface.

FlarexDB System APIs own database-platform capabilities below those lifecycle
stages. A later Standard registration operation may call a trusted schema
lifecycle port. A later Standard invocation operation may enter a trusted
application-data session. That dependency does not expose database internals to
the Standard input producer.

## Core Principles

1. **Postgres remains authoritative.** Durable Objects, caches, queues, and
   runtime workers may coordinate or accelerate work but do not become an
   alternative committed-data authority.
2. **Public semantics differ from internal mechanics.** A caller may request a
   transaction, migration, backup, or deployment. It does not author physical
   writes, OCC facts, locks, outbox rows, or commit records.
3. **Tenancy and data scope are different concepts.** A tenant is a
   control-plane customer boundary. A scope is the concrete data-plane
   authority for a deployment or project environment.
4. **Physical placement is policy.** Shared database, schema-per-scope, and
   database-per-scope are internal placement choices, not application data
   semantics.
5. **Framework behavior retains its owner.** Payload owns Payload lifecycle
   semantics. Medusa owns commerce repositories, workflows, locks, links,
   migrations, and transaction behavior.
6. **No universal application-and-commerce transaction.** Generic
   `ctx.db.transact` does not automatically include Medusa commerce state.
7. **Untrusted code receives capabilities, not infrastructure.** Dynamic
   Workers never receive Postgres, Hyperdrive, Drizzle, raw SQL, physical
   locators, migration authority, or an internal committer.
8. **Long operations are asynchronous and idempotent.** Provisioning,
   migrations, backup, restore, and repair return durable operation identities
   rather than holding one HTTP request open.
9. **Control-plane state cannot override data-plane truth.** Routing may locate
   a scope, but the active generation, epoch, schema, and commit authority must
   be revalidated in the located data plane.
10. **Version every trust boundary deliberately.** A V1 suffix versions a
    contract. It does not grant migration, compatibility, or public-release
    authority.

## Tenant, Project, Deployment, And Scope Model

The proposed logical hierarchy is:

```text
Tenant
  customer, organization, billing, quota, and administrative boundary

Project
  one logical application or hosted product

Environment
  development, preview, staging, or production

Deployment
  one application revision and runtime activation in an environment

Scope
  concrete data-plane authority, epoch, storage generation, and commit stream

Physical locator
  cluster, database, schema, credentials, Hyperdrive binding, and region
```

An ordinary application end user, shopper, CMS editor, or API user does not
receive a database. A hosted customer creates a project or environment, and
Flarex provisions the required data-plane scope.

The ordinary public request should describe an isolation requirement, not a
physical layout:

```ts
type IsolationRequest =
  | { readonly kind: "managed" }
  | { readonly kind: "dedicated"; readonly region?: string };
```

The platform may satisfy `managed` with shared physical tables, a schema, or a
dedicated database. That choice remains replaceable behind the scope locator.

Application and framework calls must not trust caller-supplied `scope_id`.
Authentication and deployment authority resolve the scope, and the data plane
revalidates its current epoch and generation before authoritative work.

## API Family 1: Flarex Control API

### Responsibility

The Control API manages hosted platform resources:

- tenants and memberships;
- projects;
- environments and deployments;
- data-scope provisioning;
- isolation requests and placement;
- quotas and product limits;
- lifecycle state;
- credential and binding provisioning;
- deletion and retention requests; and
- durable operation status.

### Illustrative Shape

Names and transports are not accepted by this proposal. The following only
shows the intended authority level:

```ts
interface FlarexControlApiV1 {
  readonly createProject: (
    input: CreateProjectInputV1,
  ) => Effect<ControlOperationV1, ControlApiErrorV1>;

  readonly createEnvironment: (
    input: CreateEnvironmentInputV1,
  ) => Effect<ControlOperationV1, ControlApiErrorV1>;

  readonly createDeployment: (
    input: CreateDeploymentInputV1,
  ) => Effect<ControlOperationV1, ControlApiErrorV1>;

  readonly requestIsolationChange: (
    input: IsolationChangeInputV1,
  ) => Effect<ControlOperationV1, ControlApiErrorV1>;

  readonly getOperation: (
    operationId: ControlOperationId,
  ) => Effect<ControlOperationV1, ControlApiErrorV1>;
}
```

Every mutating operation should accept a stable request key and return a
durable operation:

```ts
const operation = await control.createProject({
  tenantId,
  slug: "learning-platform",
  isolation: { kind: "managed" },
  requestKey: "create-learning-platform-v1",
});
```

### Control-Plane Boundary

The Control API may allocate and locate resources. It must not:

- publish application rows;
- mint arbitrary commit sequence values;
- edit scope clocks as ordinary metadata;
- bypass schema readiness;
- author application outbox entries;
- accept raw physical table names from customers; or
- treat a cached control record as sufficient data-plane authority.

Provisioning needs a fail-closed handshake:

```text
control request
  -> allocate project/environment identity
  -> select physical placement
  -> initialize data-plane scope authority
  -> verify scope epoch/generation
  -> publish routable control-plane locator
  -> mark operation complete
```

A partially initialized scope must remain unroutable or explicitly recoverable.

## API Family 2: Flarex Schema And Migration API

### Responsibility

The Schema API manages versioned logical schema intent and safe physical
evolution:

- immutable schema manifests;
- validation and compatibility analysis;
- catalog binding;
- migration planning;
- index and sidecar build planning;
- readiness evidence;
- activation;
- rollback to an already safe generation where supported; and
- migration-operation status.

### Three Migration Lanes

The word `migration` must not hide three different authorities.

#### Flarex Application Schema Lane

Normal application developers submit declarative schema intent:

```ts
validateSchemaManifest(...)
planSchemaChange(...)
applySchemaPlan(...)
getSchemaReadiness(...)
activateSchemaVersion(...)
```

The platform derives physical indexes, edge sidecars, unique-key structures,
storage generations, and bounded backfills. Application code does not submit
SQL.

#### Payload Adapter Lane

Payload configuration and collection lifecycle require a Payload-owned
adapter:

```text
Payload config
  -> Payload compatibility validation
  -> Flarex logical schema/catalog projection
  -> Payload lifecycle storage plan
  -> trusted application of accepted changes
```

Payload content may share Flarex application storage, while Payload-only
lifecycle state may use reserved logical collections or later dedicated
structures. That choice must not weaken Payload validation, hooks, versions,
drafts, auth, or access behavior.

#### Medusa Adapter Lane

Medusa migrations are compiled from Medusa DML, link/joiner metadata, migration
history, and declared adapter capabilities:

```text
Medusa persistence manifest
  -> compatibility and capability validation
  -> reserved relational schema plan
  -> Medusa-owned migration ordering
  -> trusted migration execution
```

Medusa commerce tables are not generic Flarex app-row tables, and a Medusa
migration must not be treated as a generic application schema migration.

### Migration Execution Boundary

Migration generation and execution belong to trusted control-plane, operator,
or Node tooling. They do not run inside:

- an untrusted Dynamic Worker;
- an application query or mutation;
- an ordinary executor request;
- a request-scoped Hyperdrive transaction; or
- a framework hook that can hold platform locks during arbitrary user code.

Raw SQL may exist behind an operator-owned implementation boundary. It is not a
normal Control, Standard Application, Dynamic Worker, Payload application, or
Medusa application API.

## API Family 3: Flarex Application Data API

### Developer Surface

The normal developer-facing database API remains small:

```ts
ctx.db.get(...)
ctx.db.query(...)
ctx.db.insert(...)
ctx.db.patch(...)
ctx.db.replace(...)
ctx.db.delete(...)
ctx.db.transact(...)
```

The API expresses logical tables, declared indexes, relations, validated
values, and bounded transaction work. It does not expose:

- physical table names;
- `scope_id` selection;
- raw SQL;
- a Postgres or Hyperdrive client;
- an OCC read set;
- the attempt journal;
- commit planning;
- physical index or edge writes;
- outbox insertion; or
- commit-sequence allocation.

### Runtime Boundary

The Dynamic Worker receives an invocation-scoped syscall capability:

```text
Dynamic Worker ctx.db
  -> private bounded syscall
  -> authenticated invocation and scope
  -> logical reads and staged writes
  -> sealed attempt result
  -> private FlarexDB commit authority
```

Queries and mutations may share logical read APIs, but only mutations can stage
writes. Unsupported read-your-writes or query shapes fail closed.

### Transaction Meaning

`ctx.db.transact` is a logical staging API, not a long-lived SQL transaction:

```text
run bounded application code
  -> collect authenticated reads and logical writes
  -> seal the attempt
  -> open short authoritative Postgres transaction
  -> lock and revalidate scope authority
  -> validate OCC, schema, constraints, and policies
  -> lower logical changes to physical changes
  -> publish rows, feed, outcome, and outbox atomically
```

Long network calls, workflow waits, user interaction, and arbitrary external
effects stay outside the short authoritative transaction.

### Client Query And Mutation APIs

Browser and server clients normally call application functions:

```ts
client.query(api.courses.list, args)
client.mutation(api.courses.create, args)
client.watchQuery(api.courses.list, args)
```

They do not receive a general remote database handle. Function validation,
authorization, scope resolution, quotas, and runtime isolation remain part of
the application-function boundary.

Whether a future trusted server SDK receives a narrower direct data API is an
open question and must not be inferred from `ctx.db`.

## API Family 4: Framework Adapter APIs

Payload, Medusa, and Dynamic Workers share the same FlarexDB authority but do
not use one identical API.

### Payload Adapter

A trusted Payload adapter may need:

- application-row and catalog primitives;
- Payload lifecycle collection storage;
- request-scoped transaction behavior;
- access, validation, hook, version, draft, and upload integration;
- relation and unique-key projection;
- committed change/outbox participation; and
- conformance tests against real Payload behavior.

Potential internal separation:

```text
PayloadOperationPortV1
  owns Payload request/lifecycle semantics

PayloadStoragePortV1
  stores accepted Payload/app content through FlarexDB
```

Neither port is a raw Postgres adapter exposed to Payload application code.

### Medusa Adapter

A trusted Medusa adapter may need:

- generated reserved relational tables;
- repositories and query behavior;
- a Medusa transaction manager;
- module and link compatibility;
- migration ordering;
- workflow and locking behavior;
- committed change and outbox publication; and
- conformance tests against unchanged Medusa module behavior.

Potential internal separation:

```text
MedusaPersistencePortV1
  owns relational persistence required by Medusa repositories

MedusaScopePublicationPortV1
  narrowly joins trusted commerce changes to Flarex scope commit/feed/outbox
```

The publication port must not let callers author arbitrary commit facts,
outbox rows, scope clocks, or application-row changes. Its authority is derived
from a genuine Medusa-owned transaction and accepted adapter policy.

### No Universal Cross-Domain Transaction

The following is rejected as an automatic promise:

```ts
ctx.db.transact(async (tx) => {
  await tx.insert("reviews", review);
  await ctx.commerce.orders.complete(orderId);
});
```

If an application extension is part of a commerce invariant, a Medusa-owned
facade or workflow owns that operation. Ordinary app/display state follows
commerce changes idempotently through stable IDs and transactional outbox
events.

## API Family 5: Flarex Operator API

### Responsibility

The Operator API is a privileged administrative surface for bounded operations
such as:

- create and verify backup;
- restore or clone into a new scope;
- inspect schema and generation readiness;
- execute approved migration jobs;
- pause or quarantine a scope;
- redrive outbox or commit-wake work;
- inspect stuck operations;
- run bounded consistency verification;
- rotate internal credentials;
- request repair; and
- retrieve redacted operational evidence.

### Operator Safety

Operator APIs require stronger controls than application APIs:

- explicit privileged identity;
- tenant/project/scope authorization;
- stable request keys;
- durable operation records;
- bounded targets and work limits;
- approval or break-glass policy for destructive actions;
- audit records;
- dry-run or plan receipts where practical;
- redacted errors and evidence;
- generation/epoch fencing; and
- authoritative post-operation verification.

An operator API should prefer:

```ts
planRepair(...)
executeApprovedRepair(planId, requestKey)
getRepairOperation(...)
```

over:

```ts
executeArbitrarySql(scopeId, sql)
```

An internal emergency SQL procedure may still exist, but it is not the normal
FlarexDB Operator API contract.

## API Family 6: Private FlarexDB Kernel APIs

### Responsibility

The private kernel owns the authoritative correctness chain:

```text
authenticated session and current scope authority
  -> bounded logical reads
  -> logical attempt journal
  -> sealed result
  -> verified compiler input
  -> inert logical prepared plan
  -> authenticated persistence command
  -> OCC and current-authority validation
  -> atomic durable publication
  -> committed outcome, feed, and outbox
```

Kernel domains include:

- query and mutation session lifecycle;
- read-set and dependency validation;
- read-your-writes overlay;
- deterministic logical commit compilation;
- physical lowering;
- OCC validation;
- scope clock and generation fencing;
- indexes, edges, unique keys, and constraints;
- committed-result idempotency;
- commit and change feeds;
- outbox and wake publication;
- retry classification;
- uncertain-outcome recovery;
- retention and redelivery; and
- persistence-driver adaptation.

### Private Does Not Mean Undesigned

These contracts should still be:

- explicit;
- versioned where they cross process or package boundaries;
- typed;
- bounded;
- deterministic where required;
- tested through PGlite and real Postgres as appropriate; and
- clear about failures, interruption, lifecycle, and capability ownership.

They are private because structural possession must not grant database
authority.

### Do Not Publish The Machinery

The following must not become customer or Dynamic Worker APIs:

```text
CommitIntent
CommitEnvelope
PreparedCommit
CommitPlanner
CommitExecutor
OCC read-set rows
scope-clock locks
storage-generation capabilities
outbox row constructors
physical persistence commands
raw migration runners
```

A future portable commit-compiler package, if justified independently, would
own only a pure inert transformation. It would not let a caller mint an
executable commit capability.

## Trust And Consumer Matrix

| API | Normal customer control client | Flarex CLI/deploy | Dynamic Worker | Payload adapter | Medusa adapter | Operator |
| --- | --- | --- | --- | --- | --- | --- |
| Control API | Scoped | Yes | No | No | No | Yes |
| Schema API | Through deployment policy | Yes | No | Trusted adapter lane | Trusted adapter lane | Yes |
| Application Data API | Through functions/client | Yes in local/test tooling | Invocation-scoped `ctx.db` | Storage subset | No generic app-row access for commerce | Diagnostic read only where approved |
| Payload Adapter API | No | Composition only | Through `ctx.cms` facade | Yes | No | Bounded administration |
| Medusa Adapter API | No | Composition only | Through `ctx.commerce` facade | No | Yes | Bounded administration |
| Operator API | No | Selected safe commands | No | No | No | Yes |
| Private Kernel API | No | No direct authority | Syscall boundary only | Narrow authenticated bridge | Narrow authenticated bridge | No arbitrary command minting |

The matrix describes the intended trust direction, not an accepted export map.

## Illustrative End-To-End Flows

### Create A Hosted Application

```text
authenticated tenant administrator
  -> Control API createProject(requestKey)
  -> allocate project and default environment
  -> choose placement policy
  -> initialize data-plane scope and epoch
  -> verify scope authority
  -> publish routable locator
  -> return completed control operation
```

The customer sees project and environment identities. The physical locator
remains internal.

### Deploy And Activate A Schema

```text
developer definition
  -> Standard definition preparation
  -> accepted analysis and registration
  -> Schema API stores immutable manifest
  -> plan catalog/index/sidecar changes
  -> execute bounded migration/build work
  -> produce readiness evidence
  -> lock and revalidate data-plane scope authority
  -> activate one schema/storage generation
```

Activation cannot be inferred merely because migration work completed.

### Run A Dynamic Worker Mutation

```text
authenticated application invocation
  -> resolve active deployment and scope
  -> start bounded mutation attempt
  -> Dynamic Worker uses restricted ctx.db syscalls
  -> seal logical journal and result
  -> trusted compiler and persistence path
  -> OCC/current-authority validation
  -> atomic row/feed/outbox/outcome publication
  -> committed result returned
```

### Run A Payload Operation

```text
authenticated CMS request
  -> Payload lifecycle pipeline
  -> Payload access, hooks, validation, and version policy
  -> trusted Payload storage adapter
  -> FlarexDB app/Payload storage and commit authority
  -> committed change/outbox publication
```

Direct `ctx.db` writes remain subject to the collection's declared Payload
write policy.

### Run A Medusa Commerce Transaction

```text
commerce request or workflow step
  -> Medusa service/facade
  -> Medusa repository and transaction manager
  -> reserved relational commerce writes
  -> narrow trusted scope commit/change/outbox participation
  -> atomic commerce commit
  -> post-commit event and workflow continuation
```

Generic Flarex app-data transactions do not impersonate this lane.

## API Contract Requirements

Any future accepted API from this proposal should define:

1. caller and trust level;
2. exact authorization and capability source;
3. tenant/project/deployment/scope derivation;
4. request-key and idempotency behavior;
5. synchronous versus asynchronous operation semantics;
6. typed failures and stable public error codes;
7. retryable, terminal, and uncertain outcomes;
8. quotas and pre-allocation budgets;
9. generation, epoch, and activation fencing;
10. transaction and atomicity boundary;
11. lifecycle, interruption, cleanup, and cancellation;
12. audit and observability contract;
13. redaction and data-retention policy;
14. compatibility and versioning policy;
15. PGlite, real-Postgres, Worker, and hosted validation lanes; and
16. package, transport, and deployment-boundary impact.

## Possible Package And Transport Shapes

This proposal does not authorize packages or endpoints. Possible shapes to
compare later include:

```text
@flarex/control-contracts
@flarex/schema-lifecycle
@flarex/application-data
@flarex/payload-adapter
@flarex/medusa-adapter
@flarex/operator-contracts
```

The private commit compiler, executor, and persistence contracts may remain
inside their current owners. Repetition alone is not a reason to create a
package.

Possible transports include:

- in-process Effect service and Layer composition;
- private Worker service-binding Fetch;
- private Workers RPC;
- Node CLI/control-plane jobs;
- queue-driven asynchronous operations; and
- test-only direct adapters.

The contract should be selected before the transport. A transport replacement
must not create a second correctness implementation.

## Non-Goals

This proposal does not:

- define final HTTP routes;
- define an npm-public package;
- authorize a generic `@flarex/database` catch-all;
- authorize package extraction for the commit compiler;
- change current executor routing;
- change OCC or commit semantics;
- authorize raw SQL for application code;
- make caches or Durable Objects authoritative;
- promise one physical database per end user;
- promise one transaction across generic app, Payload, and Medusa operations;
- require every tenant to use the same physical isolation model;
- define pricing, billing, regions, or product tiers;
- approve destructive migration or prototype retirement;
- define the complete backup/restore implementation; or
- make any future API production-routed.

## Questions To Resolve Before A Roadmap

### Product And Tenancy

1. Is a project the durable customer-facing database identity, or should a
   project explicitly own multiple named databases?
2. Does every environment receive an independent scope, or can preview
   deployments share a controlled branch/clone model?
3. Which isolation choices are customer-visible: managed versus dedicated, or
   shared/schema/database as explicit product options?
4. What are the retention and deletion guarantees for projects, environments,
   backups, and operation receipts?

### Control Plane

5. Which component owns the global tenant/project catalog?
6. What is the exact fail-closed provisioning handshake between global control
   state and the located Postgres data plane?
7. How are failed or partially provisioned scopes repaired or garbage
   collected?
8. Are clone, branch, preview, and restore first-class operations or later
   extensions?

### Schema And Migration

9. Which logical schema changes are online, offline, backfilled, rejected, or
   generation-replacing?
10. Which migration plans may be rolled back after activation?
11. How do Payload and Medusa adapter migrations coordinate with a Flarex
    deployment without creating one universal migration language?
12. Which readiness evidence must exist before activation?

### Application Data

13. Is direct trusted server access needed outside function invocation, or
    should all application access remain function-oriented?
14. What is the first complete bounded query API: point reads, one declared
    index range, relation traversal, or another shape?
15. What transaction quotas and ceilings are part of the stable developer
    contract?
16. Which committed receipt fields are public, internal, or observability-only?

### Payload And Medusa

17. Which Payload conformance slice is first: scalar CRUD, request
    transactions, versions/drafts, relationships, auth, uploads, or hooks?
18. Which Medusa modules and unchanged integration suites define the minimum
    viable adapter?
19. What exact narrow capability lets a Medusa transaction publish Flarex
    commit/change/outbox evidence without authoring arbitrary system state?
20. Which cross-domain operations require a Medusa-owned facade rather than
    eventual outbox coordination?

### Operations

21. What are the backup consistency and restore-fencing contracts?
22. Which repair and redrive actions are safe to automate?
23. Which actions require explicit operator approval or break-glass authority?
24. How are audit logs, support references, privacy, and tenant-scoped
    observability exposed?

### Ownership

25. Which API contracts have two real consumers and justify extraction?
26. Which contracts should remain package-private inside executor or
    persistence?
27. Which operations require Effect services and scoped Layers, and which are
    pure inert planning operations?
28. Which API family should be discussed first without blocking the current
    analyzer, Standard Application API, or FlarexDB foundation work?

## Suggested Future Discussion Order

If this proposal is accepted for further design work, discuss it in this order:

1. tenancy vocabulary and project/environment/scope ownership;
2. control-plane provisioning and data-plane authority handshake;
3. schema and migration API lanes;
4. Dynamic Worker application-data API;
5. Payload adapter contract;
6. Medusa adapter and scope-publication contract;
7. operator, backup, restore, and repair APIs; and
8. only then package placement, transports, and implementation roadmaps.

This ordering keeps product identity, trust, and authority decisions ahead of
package extraction or endpoint design.
