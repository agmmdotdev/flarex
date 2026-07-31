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

Flarex Trusted Relational Adapter API
  scope-pinned query, DML, transaction, introspection, and migration capabilities

Flarex Framework Adapter APIs
  Payload lifecycle storage and Medusa commerce persistence

Flarex Operator API
  backup, restore, migration jobs, redrive, repair, and inspection

Private FlarexDB Kernel APIs
  sessions, journals, compiler, OCC, committer, persistence, feed, and outbox
```

These API families converge on the same authoritative Postgres data plane,
scope clock, commit feed, and outbox. One database authority does not imply one
universal interface. In particular, Dynamic Worker logical transactions,
Payload request transactions, and Medusa relational transactions retain
different contracts.

## Delivery Model: Definition Helpers And Executable Functions

The preferred consumer experience is function-first and implementation-bearing,
similar to the useful distinction in Vite between inert definition helpers and
operations that actually run the system:

```text
defineSomething(...)
  -> constructs and validates inert input
  -> performs no analysis, registration, migration, activation, or execution

analyzeSomething(...)
registerSomething(...)
activateSomething(...)
invokeSomething(...)
  -> executes one real capability through its owning implementation
```

FlarexDB should not publish a contract-only System API surface and defer its
implementation to a later phase. Each accepted executable operation should
ship one bounded vertical slice containing:

1. its input, output, exact typed failures, and trust boundary;
2. one exported verb-named function that consumers call directly;
3. the domain service contract and live Layer when shared capabilities,
   configuration, resources, or test substitution require them;
4. request-, operation-, or transaction-scoped capabilities at their real
   lifetime rather than in a global Layer;
5. one test Layer or bounded test adapter;
6. focused PGlite, real-Postgres, and host validation required by the
   operation; and
7. its first real Standard, host, or private-system consumer.

The consumer-facing function may return an `Effect` whose requirements are
provided by the application, Worker, Durable Object, request, or test
composition root. Ordinary consumers should not construct dependency bags,
select Postgres repositories, or manually finalize transactions.

Illustrative usage is:

```ts
const analysis = yield* analyzeStandardApplicationV1(input);
const revision = yield* registerApplicationRevisionV1({ analysis });
yield* activateApplicationRevisionV1({ revisionId: revision.revisionId });
return yield* invokeApplicationPointMutationV1({
  functionName: "orders:create",
  args,
});
```

These names are directional, not accepted contracts. The important shape is
that the caller consumes concrete functions. `Context.Service` and `Layer`
remain implementation and composition tools below those functions; they are
not a second consumer API and do not authorize one repository-global service
locator.

This model also rules out a universal `defineFlarexDatabase(...)` object whose
methods mix control, schema, application data, relational adapters, operations,
and private commit authority. A later host facade may group already-implemented
functions for ergonomics, but it must preserve their separate types, trust
boundaries, lifetimes, and owners.

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
                trusted relational adapter SPI
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

## Immediate Execution Boundary

The first focused implementation is deliberately smaller than this long-term
taxonomy. It is owned by
[`../roadmaps/43-first-flarexdb-system-api-vertical.md`](../roadmaps/43-first-flarexdb-system-api-vertical.md)
and connects only:

```text
accepted complete replacement analyzer
  -> Standard analysis
  -> inactive application-revision registration
  -> evidence-backed readiness
  -> explicit activation
  -> one Standard point mutation
  -> authoritative FlarexDB/Postgres outcome
```

That roadmap does not start the Control API, general schema migration API,
query API, trusted relational adapter SPI, Payload adapter, Medusa adapter,
Operator API, backup/restore, or broad public SDK. Those remain useful design
context, but they are farther from the current analyzer and Standard
Application API work.

The focused vertical must reuse the current analyzer, deployment, schema
publication, readiness, activation, host-neutral runtime, executor, OCC,
commit, feed, outbox, and persistence owners. It must not create parallel
implementations in a new "System API" package merely to make the composition
look complete.

## Current Readiness And Limitations

FlarexDB is implementation-rich below the proposed API boundary, but it is not
yet a consumer-ready System API.

The useful existing foundation includes:

- Standard application definition preparation;
- the accepted private replacement-analyzer port and the function-first
  Standard authenticated-analysis operation over its request-scoped host;
- bounded transactional app-schema publication and the first persistence-owned
  System operation for authenticated, durable, idempotent, inactive
  application-revision registration;
- the narrow SAP03 Standard wrapper and private paired persistence-backed
  analyzer/registration composition;
- scope, epoch, session, journal, execution-claim, OCC, commit, committed
  outcome, feed, outbox, and redelivery components;
- a host-neutral exact point-mutation runtime; and
- PGlite, real-Postgres, Worker, and focused test infrastructure.

The remaining limitations are architectural, not merely naming or packaging:

1. **Analysis is private and production-inactive.** The accepted analyzer and
   Standard analysis operation exist, but no production route or developer
   process may mint trusted analyzer admission. Host composition remains
   request-scoped and fail-closed.
2. **Registration is intentionally private and inactive.** The first System
   operation claims opaque context-owned candidate and producer authority,
   binds candidate, attempt, source, semantic, schema, function, validator,
   handler, artifact, analyzer, and durable reservation evidence into one
   durable revision with request-key replay, but it does not establish
   readiness, activation, routing, or public API authority.
3. **No target-native readiness operation.** S03-D4 has not yet settled
   readiness from the real located target and all required evidence.
4. **No replacement activation operation or coherent active reader.** Current
   legacy deployment activation is not the target FlarexDB revision CAS and
   must not be wrapped as though it were.
5. **The private analyzer-to-Postgres system harness is not yet assembled.**
   C07 proves the private test-owned point-mutation composition in PGlite and
   genuine PostgreSQL. A1b2-S1 supplies the private scoped command
   preparation, durable future-registration continuity intent, analyzer-owned
   terminal proof, opaque persistence Work facade, and real link-receipt to
   registration-reservation lineage. A1b2-S2 adds the persistence-owned opaque
   reservation proposal, backend-owned single-use six-commitment claim,
   exact-result-correlated restart-evidence producer, narrow authenticated
    historical settled-evidence read, and private scoped evidence/settlement/
    reload/rehydrate composition. Restart production and settlement retain the
    exact authenticated budget/usage/evidence correlation, and historical
    loading applies cumulative memory/work ceilings across database batches.
    A1b2-S3 directly replaces the former frozen-range analyzer session
    contract. Stable session authority contains attempt, candidate,
    authenticated input, analyzer release/identity, and verifier identity;
    each parse/link/registration reservation owns its exact range/lineage
    digest. Registration and cold rehydrate retain and validate the historical
    link reservation's range independently of the later registration range.
    There is no compatibility session API, fallback lifecycle, schema change,
    or parallel reservation identity.
    FSV02-A1 adds the backend-owned opaque registration-evidence capability:
    authenticated Source/Semantic/module facts and the prepared definition
    deterministically yield the existing candidate evidence, and the exact
    registration command producer receipt is later bound to the same handle
    through the private analyzer adapter. Its deployment-analysis and codegen
    identities are versioned canonical-JSON SHA-256 contracts. Their semantic
    codec facts come from the finalized Semantic root configuration verified
    against the loaded root, and terminal binding requires the same exact
    producer preparation; it changes no
    durable schema, candidate/protocol version, public API, or activation
    authority. These prerequisites do not themselves connect
   FSV01/FSV02 through artifact runtime and C07 or complete FSV03.
6. **The main executor facade remains legacy-routed.** Private
   `flarexdb_v1` modules do not make the root executor a replacement
   application-data API.
7. **Persistence interfaces are too broad for consumers.** Raw SQL clients,
   transaction repositories, physical records, and package-internal factories
   are implementation capabilities, not an acceptable System API.
8. **The service graph is incomplete.** Some backend domains use
   `Context.Service` and Layers, while executor and persistence composition
   still contains manual factories, dependency bags, and Promise boundaries.
   Each API slice must close only the service and lifecycle seams it actually
   consumes.
9. **No stable framework-adapter SPI exists.** Payload, Medusa, and general
    relational compatibility remain deferred and must not shape the first
    application-revision vertical.

These limitations mean FlarexDB does not need a new database kernel before API
work can begin. It needs the existing kernel owners assembled and proved one
capability at a time.

## Minimum Gate To Start API Development

API development starts in two deliberately separate steps:

```text
FSV01
  -> Standard API development
  -> analyzeStandardApplicationV1
  -> complete over the accepted analyzer port

FSV02
  -> first FlarexDB System API development
  -> registerApplicationRevisionV1
  -> complete through private authenticated correlation and inactive SAP03
```

Before each later slice is accepted for implementation:

1. all packages in that slice have a green typecheck and focused test baseline;
2. the exact existing owner functions and missing composition seam are named;
3. input authority and scope derivation are explicit;
4. the operation's success, typed failures, and Effect requirements are exact;
5. request, analyzer-session, Worker, Durable Object, and transaction
   lifetimes are assigned to their real owner;
6. package or subpath placement has an acyclic dependency preflight;
7. the exported function, live implementation, test Layer or adapter, and
   first real consumer are delivered together;
8. PGlite, real-Postgres, Worker, or hosted validation is included where the
   capability crosses that boundary; and
9. routes, bindings, activation, dual writes, fallbacks, and legacy removal
   remain unchanged unless the slice explicitly owns and proves them.

Do not create `@flarex/system`, `@flarex/database`, or empty contract packages
as preparatory work. Start from the first real consumer and place the narrow
operation beside its current owner until extraction is justified.

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
5. **One authority does not mean one universal API.** Shared scope, commit,
   feed, and outbox authority sits below purpose-specific public, framework,
   operator, and private contracts.
6. **Framework behavior retains its owner.** Payload owns Payload lifecycle
   semantics. Medusa owns commerce repositories, workflows, locks, links,
   migrations, and transaction behavior.
7. **No universal application-and-commerce transaction.** Generic
   `ctx.db.transact` does not automatically include Medusa commerce state.
8. **Untrusted code receives capabilities, not infrastructure.** Dynamic
   Workers never receive Postgres, Hyperdrive, Drizzle, raw SQL, physical
   locators, migration authority, or an internal committer.
9. **Trusted framework adapters receive bounded relational capabilities.**
   Payload and Medusa adapters may require lower-level query, transaction,
   introspection, locking, or migration behavior. Those capabilities remain
   scope-pinned, least-privileged, adapter-only, and separate from public
   application APIs.
10. **Long operations are asynchronous and idempotent.** Provisioning,
   migrations, backup, restore, and repair return durable operation identities
   rather than holding one HTTP request open.
11. **Control-plane state cannot override data-plane truth.** Routing may locate
   a scope, but the active generation, epoch, schema, and commit authority must
   be revalidated in the located data plane.
12. **Version every trust boundary deliberately.** A V1 suffix versions a
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

Raw SQL may exist behind two trusted boundaries:

- an adapter-owned runtime statement capability when unchanged relational
  framework behavior genuinely requires SQL; and
- an operator-controlled framework migration runner with a separate privileged
  database role.

Neither capability is a normal Control, Standard Application, Dynamic Worker,
Payload application, or Medusa application API. Runtime relational authority
must not imply DDL authority, and migration authority must not be derivable
from a normal request transaction.

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

## API Family 4: Flarex Trusted Relational Adapter API

### Responsibility

The Trusted Relational Adapter API is a private system SPI for framework
database adapters. It exists because Payload and Medusa require lower-level
database behavior that is deliberately absent from `ctx.db`.

Its bounded capability set may include:

- scope-pinned relational reads and writes;
- query parameters, result rows, batching, and affected-row evidence;
- real database transactions with explicit isolation and timeout policy;
- savepoints, nested-transaction behavior, row locks, or advisory locks only
  where framework conformance proves them necessary;
- schema and migration-history inspection;
- trusted framework migration execution;
- adapter-owned mutation evidence; and
- a Flarex-owned finalizer that joins accepted framework changes to the scope
  commit, change feed, and outbox.

The exact common surface must be proven from consumers. Payload may use
Flarex logical app/Payload storage primitives while Medusa uses ORM-generated
relational SQL over reserved tables. Those two adapters do not need to consume
one universal query representation merely because they share transaction-host
or publication mechanics.

An illustrative in-process semantic shape is:

```ts
interface FlarexRelationalTransactionHostV1 {
  readonly withTransaction: <A, E>(
    input: RelationalTransactionInputV1,
    use: (
      transaction: TrustedRelationalTransactionV1,
    ) => Effect<A, E>,
  ) => Effect<A, E | RelationalTransactionErrorV1>;
}

interface TrustedRelationalTransactionV1 {
  readonly query: (
    input: TrustedRelationalQueryV1,
  ) => Effect<ReadonlyArray<Readonly<Record<string, unknown>>>, RelationalQueryErrorV1>;

  readonly mutate: (
    input: TrustedRelationalMutationV1,
  ) => Effect<RelationalMutationResultV1, RelationalMutationErrorV1>;
}
```

Names and exact query representations are not accepted here. A callback shape
describes in-process ownership; it is not automatically a serializable Worker
RPC contract.

### Runtime And Migration Authority

Runtime and migration capabilities must use distinct authority:

```text
framework runtime role
  -> scope-pinned SELECT and DML
  -> no database creation, role changes, arbitrary schema selection, or DDL

framework migration role
  -> immutable migration identity and checksum
  -> approved target scope and generation
  -> migration lock and bounded execution
  -> durable receipt and authoritative post-verification
```

SQL text inspection is not a sufficient security boundary. Database roles,
physical namespace restrictions, authenticated capability construction, and
transaction-owned finalization enforce the separation.

### Transaction Finalization

A trusted framework transaction follows this authority direction:

```text
resolve authenticated scope
  -> open one scope-pinned Postgres transaction
  -> revalidate epoch, generation, and framework schema
  -> execute adapter-owned relational work
  -> Flarex-owned finalizer publishes commit/feed/outbox evidence
  -> atomically commit
```

The adapter may author accepted framework rows. It may not mint commit
sequences, edit the scope clock, construct arbitrary outbox rows, impersonate
app-row OCC evidence, or finalize a transaction for a different scope.

### Runtime Placement

An interactive SQL transaction must not be stretched across unrelated
stateless Worker requests. The framework adapter and transaction owner must
either:

- execute together for the complete bounded transaction; or
- submit one complete bounded framework operation to a private Flarex service.

A remote transaction token alone does not prove connection affinity,
transaction liveness, interruption safety, or current scope authority.

## API Family 5: Framework Adapter APIs

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
The Flarex adapter should implement Payload's database-adapter contract
directly. The fact that Payload's Postgres adapter currently uses Drizzle and
`pg` does not require Flarex to publish a general `pg.Client` clone.
Compatibility with existing Postgres-adapter-specific migration files,
Drizzle extensions, or custom SQL is a separate explicit conformance target,
not an automatic consequence of implementing Payload's database-adapter
contract.

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

The persistence port may consume the Trusted Relational Adapter API for
ORM-generated queries, real transaction behavior, locks, and framework
migration compatibility. Medusa application and module code does not receive
the underlying Flarex transaction host or physical Postgres capability.
The adapter should implement Medusa's accepted module-persistence, repository,
and transaction-manager contracts. Compatibility with existing MikroORM
migration SQL or custom repository behavior must be proved explicitly against
unchanged module integration suites.

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

## API Family 6: Flarex Operator API

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

## API Family 7: Private FlarexDB Kernel APIs

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
| Trusted Relational Adapter API | No | Migration tooling only | No | Scope-pinned adapter capability | Scope-pinned adapter capability | Migration/diagnostic capability only |
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
  -> scope-pinned Flarex logical/relational capabilities
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
  -> trusted scope-pinned relational transaction
  -> reserved relational commerce writes
  -> Flarex-owned scope commit/change/outbox finalization
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
15. PGlite, real-Postgres, Worker, and hosted validation lanes;
16. package, transport, and deployment-boundary impact;
17. permitted statement classes, database role, physical namespace, and schema
    authority for any relational adapter capability; and
18. transaction connection affinity, runtime placement, timeout, interruption,
    and finalization behavior.

## Possible Package And Transport Shapes

This proposal does not authorize packages or endpoints. Possible shapes to
compare later include:

```text
@flarex/control
@flarex/schema-lifecycle
@flarex/application-data
@flarex/relational-adapter
@flarex/payload-adapter
@flarex/medusa-adapter
@flarex/operator
```

These are implementation-bearing domain candidates, not a request to create
empty `*-contracts` packages. A separate contract package is justified only
when dependency direction, authority ownership, and concrete consumers require
it. The first vertical should prefer a narrow subpath beside its current owner
until extraction has an approved package-boundary preflight.

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

The semantic operation and trust boundary should be selected before the
transport, but the operation should be delivered with its first concrete
implementation and consumer. A transport replacement must not create a second
correctness implementation. A callback-scoped relational transaction is
naturally in-process. A remote transport must not pretend that a transaction
identifier preserves a live Postgres connection or transaction across
stateless Worker requests.

## Non-Goals

This proposal does not:

- define final HTTP routes;
- define an npm-public package;
- authorize contract-only System API exports without an implementation and
  consumer;
- authorize a generic `@flarex/database` catch-all;
- authorize a customer-facing `pg` clone or unrestricted SQL endpoint;
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

## Questions To Resolve Before Wider API-Family Roadmaps

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

17. Which exact relational primitives are genuinely shared by the Payload and
    Medusa adapters rather than merely similar?
18. Does the trusted runtime SPI use a typed relational plan, adapter-owned
    prepared statements, ORM-generated SQL, or more than one narrow form?
19. Where do Payload and Medusa transaction owners execute so one interactive
    transaction is not stretched across stateless Worker requests?
20. Which database roles and physical namespace restrictions separate runtime
    DML, schema introspection, framework migration, and operator authority?
21. Which Payload conformance slice is first: scalar CRUD, request
    transactions, versions/drafts, relationships, auth, uploads, or hooks?
22. Which Medusa modules and unchanged integration suites define the minimum
    viable adapter?
23. Must existing Payload Postgres/Drizzle migration files run unchanged, or
    may a Flarex adapter define its own migration format and cutover tooling?
24. Which existing Medusa MikroORM migrations, raw SQL, custom repositories,
    isolation levels, savepoints, and lock behaviors are compatibility
    requirements?
25. What exact narrow capability lets a Medusa transaction publish Flarex
    commit/change/outbox evidence without authoring arbitrary system state?
26. Which cross-domain operations require a Medusa-owned facade rather than
    eventual outbox coordination?

### Operations

27. What are the backup consistency and restore-fencing contracts?
28. Which repair and redrive actions are safe to automate?
29. Which actions require explicit operator approval or break-glass authority?
30. How are audit logs, support references, privacy, and tenant-scoped
    observability exposed?

### Ownership

31. Which API contracts have two real consumers and justify extraction?
32. Which contracts should remain package-private inside executor or
    persistence?
33. Which operations require Effect services and scoped Layers, and which are
    pure inert planning operations?
34. Which API family should be discussed first without blocking the current
    analyzer, Standard Application API, or FlarexDB foundation work?

## Suggested Future Discussion Order

The first focused vertical is already narrowed by
[`../roadmaps/43-first-flarexdb-system-api-vertical.md`](../roadmaps/43-first-flarexdb-system-api-vertical.md).
It is not blocked on resolving every long-term question below.

After that vertical supplies an end-to-end working system, discuss the wider
families in this order:

1. the next bounded application-data operation;
2. schema and migration API lanes beyond one application revision;
3. tenancy vocabulary and project/environment/scope ownership;
4. control-plane provisioning and data-plane authority handshake;
5. trusted relational adapter authority, transaction ownership, and placement;
6. Payload adapter contract;
7. Medusa adapter and scope-publication contract;
8. operator, backup, restore, and repair APIs; and
9. only then package placement, transports, and implementation roadmaps.

This ordering keeps the current analyzer-to-database composition ahead of
distant framework compatibility work while still placing trust and authority
decisions before package extraction or endpoint design.
