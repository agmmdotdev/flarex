# FlarexDB Framework Storage Architecture

Status: accepted cross-domain architecture; the shared framework-storage
primitives, Payload adapter, and Medusa adapter remain unimplemented unless a
focused roadmap gate states otherwise

Last reviewed: 2026-08-30

This note owns the durable boundary between the Flarex application data model,
Payload CMS, Medusa commerce, and the shared FlarexDB mechanisms beneath them.
It does not replace the schema language, query behavior, lifecycle, or public
API owned by any one lane.

Execution order and implementation status belong to
[`../roadmaps/flarexdb-framework-integration/README.md`](../roadmaps/flarexdb-framework-integration/README.md).
The existing
[`../roadmaps/flarexdb-foundation/README.md`](../roadmaps/flarexdb-foundation/README.md)
continues to own the document-first application foundation. Code, migrations,
and decisive tests remain the authority for exact implemented behavior.

Use these lane-specific notes with this one:

- [`flarexdb-native-relational-system.md`](./flarexdb-native-relational-system.md)
  owns application-document relation semantics and the derived edge system;
- [`flarexdb-payload-relational-adapter.md`](./flarexdb-payload-relational-adapter.md)
  owns Payload exposure, request behavior, and CMS lifecycle semantics;
- [`flarexdb-medusa-commerce-adapter.md`](./flarexdb-medusa-commerce-adapter.md)
  owns Medusa persistence, repository, Module Link, workflow, and commerce
  compatibility; and
- [`flarex-internal-db-schema.md`](./flarex-internal-db-schema.md) remains the
  long-form logical and physical-policy inventory rather than an execution
  plan.

## Decision

FlarexDB is one managed committed-data authority with multiple semantic lanes.
Its physical installations may occupy different locators, but they do not
become independently committing product cores. The system is neither one
universal database API nor three competing database authorities.

Every writable binding that participates in one atomic Flarex commit has
**commit affinity**: its authoritative data and the scope commit, typed facts,
and outbox tables resolve to the same PostgreSQL transaction authority.
Different locators may serve different scopes or asynchronously coordinated
lanes, but they cannot participate in one claimed atomic commit.

```text
ctx.db                    planned ctx.cms           planned ctx.commerce
Application semantics    Payload semantics         Medusa semantics
Standard schema          Payload configuration     DML + Joiner + Links
document/OCC engine      CMS request lifecycle     repositories/workflows
          \                    |                    /
           \                   |                   /
                FlarexDB mechanism kernel
     scope authority / artifact lifecycle / migration execution
       transactions / commit publication / feed / outbox / sync
                              |
                       PostgreSQL storage
```

The physical data plane has two deliberate storage profiles:

1. **Document storage** for Flarex application data and ordinary Payload
   content: authoritative typed row JSON plus derived index, uniqueness, and
   relation sidecars.
2. **Reserved relational storage** for Medusa commerce and framework lifecycle
   state that genuinely requires normalized columns, constraints, indexes,
   links, locks, or specialized query behavior.

System and control tables remain a third internal physical category, but they
are not an application or framework semantic lane.

## One Semantic Write Owner

Every logical table, collection, or reserved relational table has exactly one
ordinary write-policy owner.

| Owner | Normal API | Storage profile | Ordinary write authority |
| --- | --- | --- | --- |
| Application | `ctx.db` | document rows and sidecars | Standard/Application validation and OCC |
| Payload-managed content | planned `ctx.cms` | document rows plus Payload lifecycle state | Payload access, defaults, validation, hooks, drafts, versions, and request transaction |
| Medusa commerce | planned `ctx.commerce` | reserved relational tables and link entities | Medusa services, repositories, workflows, Link, and transaction manager |
| Platform/system | no developer API | control and operational tables | trusted Flarex operators and internal services only |

An additional UI, query facade, or reference does not create another write
owner. In particular:

- CMS exposure alone may be read-only and does not transfer write authority.
- An editable Payload-managed table excludes ordinary `ctx.db` mutations from
  generated capabilities and rejects runtime bypass.
- Application code cannot mutate reserved commerce rows through `ctx.db`.
- A reference to a commerce entity grants no authority to change that entity.
- Migration, import, repair, and fixture operations use separately authorized
  capabilities and still preserve FlarexDB schema, constraint, commit, feed,
  and outbox invariants.

The first writable Payload collection requires a separate Application-owner
preflight. First produce an independently digestible Payload configuration and
provenance artifact over stable logical table identities; it must not include an
Application artifact or installation digest. The authenticated Application
artifact then carries a stable Payload policy ID plus that configuration digest,
and every application write admission consults this evidence at runtime. Only
after the Application artifact is final may the content overlay reference both
digests and the exact installation/table identities. The new table becomes
application-write-inert when that artifact activates; Payload writes remain
inert until the paired overlay is active. Transferring an already app-writable
table to CMS management is deferred until one owner proves atomic capability
revocation and overlay activation with no dual-writer interval.

The Payload configuration/provenance artifact is policy and compatibility
evidence, not desired content schema. Any schema-bearing fields still enter the
authenticated Application Analysis and publication chain.

## Shared Mechanism Kernel

Only mechanisms with identical correctness meaning belong in the shared
kernel:

- trusted scope resolution, physical placement, and generation fencing;
- stable owner-qualified catalog identity;
- immutable artifact storage, canonical digesting, and provenance;
- physical installation and readiness evidence;
- atomic binding activation;
- callback-scoped transactions and nested transaction reuse;
- migration leases, step fencing, progress, receipts, and interruption
  recovery;
- commit-sequence allocation and typed change-family publication;
- transactional outbox finalization and after-commit dispatch;
- bounded introspection, backup, restore, repair, and operator operations; and
- downstream query-sync consumption of committed facts.

The kernel does not interpret Payload hooks, Medusa DML, repository filters,
commerce workflows, developer schema declarations, or framework-specific
migration intent.

The shared kernel is not a public API. Framework adapters receive narrow,
owner-scoped capabilities. They never receive executor persistence, physical
locators, the scope clock, unrestricted Drizzle/Postgres handles, arbitrary
commit-fact construction, or a general cross-owner transaction.

## Schema Coordinates

Schema state has three separate coordinates.

### Artifact

An immutable desired semantic schema, identified by owner, provenance, and
canonical digest. An artifact is not proof that any database contains its
physical structures.

### Installation

Evidence that a specific artifact has been installed and validated at a
specific physical database locator. Installation is distinct because shared
relational DDL is physical-database state rather than tenant-local metadata.

Different scopes may bind installations at different locators. Artifacts whose
writes claim one atomic scope commit must resolve to the same transaction-
capable locator as that scope's commit/feed/outbox authority. Cross-locator
coordination is asynchronous through committed outbox evidence and cannot be
presented as one database transaction.

### Binding

A scope- and generation-pinned selection of one ready installation. Runtime
admission resolves the active binding and refuses traffic when the required
artifact, installation, scope, or generation does not match.

The catalog identity must include the semantic owner so application, Payload,
Medusa, and system artifacts cannot collide or accidentally share an active
head.

## Coordinated Data Bindings

One deployment may depend on several independently compiled artifacts. The
future coordination contract is a `DataBindingSet` with an exact reference to
the existing active Application revision and installation, an optional Payload
content configuration/provenance overlay, an optional Payload lifecycle binding
when it owns physical structures, an optional commerce binding, and explicit
cross-domain references. In the first additive contract, the Application member
is a read-only reference and precondition, not another selector or independently
writable active head.

The Payload content overlay references exact Application artifact,
installation, and table identities plus authenticated write-policy evidence. It
does not own or install another copy of content definitions. Its lifecycle
binding is separate and exists only for admitted physical lifecycle structures.

The activation owner verifies:

- exact scope and generation;
- artifact and installation digests;
- current readiness evidence;
- supported framework and capability profiles;
- compatible cross-domain endpoint identities; and
- readiness of every required component.

It then activates the framework overlay set atomically only if the referenced
Application revision is still current. It does not write the Application head.
A future operation that switches the Application head and framework bindings
together requires a separate migration of activation ownership and proof.
Activation never runs migrations and never interprets Payload configuration or
Medusa DML.

An application that does not enable Payload or Medusa has no corresponding
binding and no readiness dependency on that lane.

## Schema Languages And Compilation

There is no universal source schema.

| Lane | Authoritative source | Compiled target |
| --- | --- | --- |
| Application | Standard/Application definition | application manifest and document-storage definitions |
| Payload | Payload configuration plus explicit Application table references | authenticated Application content definitions; a Payload configuration/provenance overlay; and a separate optional lifecycle artifact when physical lifecycle structures exist |
| Medusa | normalized DML, complete configured supported module/link set for the candidate, Joiner/Link configuration, explicit semantic migration intent, legacy migration evidence, and capability declarations | value-only reserved relational schema plus Medusa-owned semantic migration intent |

The current `@flarex/managed-schema` remains application-specific. Its
compatibility rules must not become a large conditional planner for every
framework. Shared artifact, installation, readiness, and activation mechanics
may be extracted only when two real lanes prove the same contract.

A neutral `RelationalSchema` contains deterministic value definitions for:

- owner-qualified tables and columns;
- primary and unique keys;
- checks and foreign keys;
- indexes, defaults, generated values, and nullability;
- supported physical relation metadata; and
- required persistence capabilities.

It has canonical ordering and encoding and therefore a reproducible digest.
It contains no ORM object, framework service, closure, raw migration object,
or query-language value.

## Migration Authority

Four migration families remain distinct:

1. Flarex platform migrations.
2. Application document-schema validation and managed sidecar builds.
3. Payload lifecycle and data migrations.
4. Medusa structural and semantic migrations.

They share a migration host, not a migration language.

The shared host owns target resolution, role authorization, leases, fencing,
step order, bounded progress, receipts, retry admission, readiness evidence,
and recovery. Each domain planner owns the meaning of its plan and the allowed
operations used to execute it.

A migration plan records immutable identity, dependencies, preconditions,
postconditions, progress boundaries, and receipt requirements. Structural work
follows expand, backfill, validate, and contract phases where needed. Contract
work cannot remove structures still referenced by an active binding.

Production runtime startup verifies the active digest and fails closed on a
mismatch. It does not apply DDL. Local development may offer an explicitly
selected auto-apply mode, but that mode is not production precedent.

There is no general automatic down migration. Rollback is allowed only when a
domain plan proves the reverse operation safe; otherwise recovery is a new
forward plan.

## Transaction Hosts

The application, Payload, Medusa, and migration lanes do not share one broad
transaction API.

They use separate high-level hosts:

- the application commit host for untrusted logical journals and OCC;
- the CMS request transaction host for Payload commands and nested Local API
  calls;
- the commerce transaction host for Medusa repositories and transaction
  manager propagation; and
- the migration host for privileged schema and backfill operations.

Those hosts may share a lower-level scope transaction mechanism. A relational
transaction is pinned to exact scope, owner capability, physical placement,
schema generation, isolation policy, timeout, and settlement state. Nested
framework calls reuse the current transaction or an explicitly supported
savepoint; they do not open an unrelated autocommit connection.

The normal write sequence is:

```text
resolve trusted scope and active binding
  -> open one bounded transaction and revalidate its binding
  -> execute lane-owned operations
  -> enforce lane invariants and database constraints
  -> collect opaque transaction-bound mutation receipts
  -> acquire the canonical final-publication lock
  -> revalidate scope generation and commit dependencies
  -> finalize one Flarex commit and typed change families
  -> write one transactional outbox wake
  -> commit once
  -> release post-commit framework events
```

Only the finalizer allocates commit order and publishes core facts. Adapter
repositories cannot mint commit sequences, scope-clock values, arbitrary feed
records, or outbox rows.

The current scope clock is the safe initial ordering authority. Its scope-wide
serialization may become expensive for commerce traffic; retain it for the
first vertical, measure contention, and require a separate transaction-owner
preflight before changing commit ordering or lock granularity.

## Relation Authority Profiles

Relationships share identity and indexing mechanics only where their meaning
matches. They retain separate authority profiles.

### Document relation

The source application or Payload document field is authoritative. Current
edge occurrences and adjacency versions are derived and rebuildable.

### Relational foreign-key relation

An intra-module relational column or pivot is authoritative. A physical
foreign key may enforce the relationship when both endpoints share a compatible
local installation and lifecycle.

### Commerce link

Every non-read-only Medusa Module Link is an authoritative stored link entity.
Its row retains the link identity, endpoints, metadata, timestamps, soft-
deletion state, and lifecycle required by the pinned Medusa contract. Endpoint-
pair uniqueness and one-side cardinality are enforced atomically in storage
rather than by a read-before-insert check.

A read-only Medusa link is query/join metadata and creates no physical link
row.

### Adjacency projection

Adjacency is an optional derived projection for reverse lookup, bounded
traversal, invalidation, or sync. It must never become a second write authority
for a document relation or commerce link.

The current application edge tables use application-row identity and
document-occurrence semantics. They must not be generalized in place before a
real commerce link proves which identity, ordering, and lifecycle mechanics are
actually shared.

## Cross-Domain References

An application or CMS row may eventually refer to a stable commerce identity
without becoming a Medusa Module Link. The private conceptual
`CrossDomainReference` records source and target owner, stable endpoints,
cardinality, resolver and authorization policy, validation policy, deletion
policy, and the binding compatibility required to interpret it. It is not an
implemented contract or public schema feature before its focused roadmap gate
passes.

Logical validation is the default. A physical foreign key is allowed only when
both endpoints are local relational tables with compatible installation,
migration, scope, and deletion lifecycles. External or independently deployed
module endpoints cannot be forced into local physical foreign keys.

Cross-domain operations do not imply a public `ctx.db + ctx.commerce`
transaction. Atomic commerce behavior belongs behind a Medusa-owned command or
workflow that receives the exact trusted capabilities it needs. Otherwise,
the owners coordinate through committed events and outbox delivery.
An active binding across different physical locators does not create a
distributed transaction.

## Medusa Boundary

FlarexDB owns physical lowering, scope isolation, constraints, transaction
settlement, schema installations, migration receipts, commit publication, and
storage observability.

Medusa continues to own:

- DML authoring and normalization;
- static module manifests, module discovery, and dependency injection;
- `ModuleJoinerConfig`, aliases, linkable keys, and `defineLink` meaning;
- repository behavior, custom repositories, and query-option translation;
- Module Link commands and lifecycle;
- soft delete, restore, cascades, workflows, locks, business/workflow
  idempotency, and commerce events;
- Query, RemoteJoiner, GraphQL, and index planning; and
- semantic migration and backfill intent.

Medusa business/workflow idempotency remains separate from Flarex commit-
publication idempotency, even when both participate in one accepted operation.

The adapter prepares persistence per module. It must not retain a mutable
process-global model set that can be overwritten while modules load in
parallel. The complete resolved module and link set is compiled into one
commerce schema candidate and activated coherently.

The first supported shape uses one pinned Medusa fork revision and one
homogeneous module set over shared scope-qualified reserved tables. Staggered
or per-scope custom module sets require separate physical-installation and
compatibility proofs.

## Payload Boundary

Payload continues to own hooks, access, defaults, validation order,
localization, drafts, versions, publication visibility, uploads, authentication,
sessions, globals, locks, jobs, preferences, population, and Payload-compatible
errors.

Payload content-schema evolution compiles through the application document
schema path. Payload lifecycle storage uses Payload-owned plans executed by the
shared migration host. Payload migrations are not Medusa migrations, and an
application schema diff cannot substitute for either framework's lifecycle
semantics.

At the first additive gate, a Payload compiler has no direct publication or
activation authority. Its generated content definitions must enter the existing
authenticated Application Analysis and publication chain with explicit
compiler provenance. If that chain cannot admit generated schema input without
changing its sole-source contract, implementation stops for a separate
Application-owner preflight. An Application-owned CMS view only constrains
Payload configuration and never republishes the table schema.

Dashboard, REST/GraphQL when enabled, Payload Local API compatibility, and the
planned `ctx.cms` facade converge on one Payload command pipeline for an editable
Payload-managed table.

## Commit, Feed, And Outbox

One scope commit may contain several typed contribution families, initially:

- application-row changes;
- document-relation adjacency changes;
- commerce-row changes;
- commerce-link changes; and
- admitted typed Medusa event intents tied to the same commit.

Repositories return opaque, transaction-bound receipts. The finalizer proves
that each receipt belongs to the current transaction, scope, owner, generation,
and epoch before publishing its typed facts.

Do not add an arbitrary JSON change-event escape hatch. A new child family
requires an explicit contract and persistence preflight. Medusa domain events
remain Medusa-owned. During service execution, Medusa may construct and buffer
an event; the adapter turns each admitted event into a typed, transaction-bound
intent. The finalizer persists that intent with the authoritative commit and
common outbox wake. After commit, an idempotent dispatcher claims pending
intents by stable identity, records delivery, and resumes after crashes. No
event is externally released before commit, and no crash window may silently
discard a committed event.

There is one ordered commit/feed/outbox authority. A second Medusa commit log
would create ambiguous ordering, recovery, and sync semantics.

## Module And Package Direction

Do not create an umbrella `@flarex/database` package or a collection of empty
"core" packages in anticipation of future consumers.

Begin with private domain modules whose owners are clear:

```text
@flarex/persistence-postgres
  scopeExecution/
  schemaArtifacts/
  relationalSchema/
  migrationCoordination/
  commitPublication/
  relationProjection/
```

Keep the existing application managed-schema owner intact. Extract a package
such as `@flarex/schema-core`, `@flarex/relational-schema`, or
`@flarex/schema-migration` only after real application and framework consumers
prove an identical portable contract.

Framework integration packages may later use plain names:

- `@flarex/payload-adapter`
- `@flarex/medusa-adapter`

The Flarex kernel must not import Medusa. The Medusa adapter may import Medusa
contracts and private Flarex host contracts. Public application packages must
not depend on either framework adapter.

## Implementation Shape

Use domain-first modules rather than a large shared service file:

- pure models, canonical encoders, compatibility policies, and planners;
- typed domain errors;
- narrow service contracts only for genuine shared capabilities;
- substantial Postgres implementations in live Layers owned by persistence;
- explicit host composition and startup gates; and
- transaction-specific handles as scoped values rather than singleton Context
  services.

Pure compilation and planning remain plain TypeScript and use `Result` for
recoverable validation. Asynchronous, cancellable, retrying, resource-owning,
or lifecycle orchestration uses Effect internally. Promise or throwing facades
exist only at the Payload and Medusa framework boundaries over one
lifecycle-owned Effect runtime.

Migration execution is an explicit deployment operation. It must not be hidden
inside a request path or accidentally run merely because a Layer was built.

## Admission And Non-Goals

The architecture is accepted, but it does not itself authorize:

- a public relational developer API;
- raw SQL or ORM access for application code;
- production Payload or Medusa activation;
- automatic atomic transactions across arbitrary semantic lanes;
- a universal query AST;
- generalization of current application edge storage;
- translation of the entire historical Medusa migration archive;
- a second commit feed or outbox;
- scope-clock or point-commit transaction redesign; or
- public cross-domain mutation APIs.

Each requires the focused roadmap gate, source-backed implementation, and
proportionate conformance evidence described by the framework-integration
roadmap.
