# Shared Logical Storage For Application, Payload And Medusa

Status: accepted architecture replacement; runtime migration is not implemented.

## Decision And Authority

Application, Payload content and Medusa commerce use framework-neutral logical
tables over shared Postgres physical storage families. Creating a shop,
deployment, logical table or logical index must not create a dedicated physical
commerce table or Postgres index by default. Scope and deployment remain trusted
authorization and definition identities, not per-tenant physical DDL owners.

This is the owner-approved correction to the former separate document/commerce
storage destination. The [accepted database design](./flarex-db-accepted-design.md)
incorporates this decision. This note owns its detailed storage, index, relation,
execution and replacement policy; the [redesign roadmap](../roadmaps/shared-logical-storage/README.md)
owns sequencing and completion gates. Current code still uses shared Application
row/index/unique/edge tables and deployment-named physical Medusa module tables.
Changing these documents does not change that runtime fact.

The project is in development. The owner explicitly permits redesign of core
storage, relational mechanics, schema compilation, query execution and core
flows around all three consumers. Existing internal APIs, codecs, physical
layouts and tests are not automatic compatibility obligations. Correct the
responsible core owner; do not make adapters compensate for missing guarantees.
Preserve intended framework behavior and trust boundaries, rather than obsolete
mechanisms. Inventory named persistent environments and actual issued/public
contracts before any destructive reset or identity replacement.

## Why This Replaces The Former Direction

The existing commerce compiler preserves real SQL columns, indexes and foreign
keys, but its physical-name preimage includes deployment identity. Independent
deployments therefore receive distinct physical names even for identical models.
That implementation optimizes relational compatibility, not the intended
independent-shop logical-schema platform.

Removing deployment identity from the name hash is insufficient: target
namespace authentication, installation ownership, migration, readiness and
retirement also depend on it. A shared set of fixed Medusa module tables would
reduce table proliferation but require compatible physical schemas across the
shops sharing it. It is a comparison candidate only, not an accepted parallel
runtime or fallback. It requires a new explicit decision if generic storage
cannot satisfy a measured requirement.

Fewer physical objects do not prove faster queries or unlimited scale. The
replacement must demonstrate indexed selective work, bounded write amplification,
concurrent correctness and fair resource use across different tenant sizes.

## Physical And Logical Model

```text
Application definitions    Payload collections    Medusa DML and Module Links
          \                       |                       /
             framework-owned semantic compilation
                              |
             shared logical definitions and admission
                              |
       rows / ordered index entries / unique claims / relations
                              |
         one trusted transaction and publication authority
                              |
             shared physical families in Postgres
```

The existing `fx_app_row_rev`, `fx_app_row_current`,
`fx_app_index_entry_rev`, `fx_app_index_entry_current`, `fx_app_unique_key`,
`fx_app_edge_current` and `fx_app_edge_adjacency_version` are reuse candidates,
not immutable target spellings or proof of full commerce support. Their current
row bodies use canonical value bytes; this design is not a request to restore a
redundant JSON copy. Additional or replacement generic families require an
identified capability and storage-cost justification. Do not create a family
per framework, module, deployment or shop under a supposedly generic API.

Logical identities distinguish deployment/schema definition, scope, table,
record, index and relation. Physical keys must prevent collisions across
independent deployments that reuse logical names or local numeric IDs. Preserve
authenticated definition-to-scope binding; do not assume a bare `table_id` is
globally meaningful. Tenant isolation must cover scans, index bounds, unique
claims, references, maintenance, publication and recovery.

Shared means shared within an admitted physical database/shard. Database routing,
partitioning and capacity placement may distribute those families deliberately;
this is not a promise of one global database or one unbounded heap. Shop creation
is logical provisioning. Capacity-driven shard creation and core storage
migrations are different operations, not incidental per-shop DDL.

## One Core Contract, Separate Semantic Owners

| Owner | Responsibility |
| --- | --- |
| Protocol and existing logical-definition owners | Exact values, identities, immutable logical table/index/constraint/relation contracts and deterministic encoding. Extend or replace them cohesively; avoid a second framework schema language. |
| Analysis and binding owners | Compile/validate the admitted definitions, authorize scope and schema revisions, and gate readiness/activation. Backend analysis remains authoritative for deployed function metadata. |
| Persistence core | Shared storage, indexed query primitives, logical constraint enforcement, mutation evidence, physical transaction settlement, publication and recovery. |
| Trusted execution core | Operation admission, budgets, execution profiles, cancellation, authority and lifecycle composition. |
| Payload adapter | Native configuration and Local API semantics, access, defaults, hooks, population and supported lifecycle policy. |
| Medusa adapter and pinned fork | DML and module semantics, repository/query translation, Link lifecycle, native workflows, events and compensation. |

Sharing storage does not grant ordinary `ctx.db` or Payload writes to
Medusa-owned logical records. Each logical table retains one ordinary semantic
write owner. A neutral fixture and consumers from multiple frameworks must use
the same core capability without framework-name dispatch in core.

Adapters may translate contracts. They may not scan whole logical tables to
emulate a missing index, implement private uniqueness maps, bypass resource
limits, invent extra transactions or duplicate relation/publication/recovery
logic. A missing guarantee blocks that capability until its owner is corrected.

## Indexes And Query Execution

Logical indexes are metadata plus entries in shared indexed physical families.
An index definition is not a new Postgres index for each tenant. The existing
ordered entry key `(scope_uuid, index_definition_id, encoded_key, row_id)` is a
starting point. Row history and snapshot requirements must remain correct if
the physical representation is replaced.

| Logical requirement | Required target behavior |
| --- | --- |
| Composite ordered index | Encode a typed tuple in declared order; compile equality prefixes and supported ranges into database bounds with deterministic pagination. |
| Conditional/partial index | Evaluate an admitted immutable predicate in core and atomically add/remove membership on every relevant row or lifecycle transition. |
| Conditional uniqueness | Atomically claim/release the scoped key only when its predicate holds, including delete/restore and concurrent insertion. A prior read alone is not enforcement. |
| Exact values | Preserve required decimal, integer, timestamp, string/collation, null/missing and ordering semantics; do not route commerce decimals through lossy JavaScript numbers. |
| Graph/Link query | Use scoped endpoint/index access and bounded joins or set operations; retain complete-set overflow and native result shapes. |
| Index lifecycle | Build/backfill under fences while accounting for concurrent writes, validate coverage, activate atomically, and retire obsolete entries only after reader/recovery obligations end. |

The native Product active-handle uniqueness and Pricing value semantics are
mandatory witnesses. Match the pinned source's SQL NULL and soft-delete
behavior; do not assume existing Application codecs have identical semantics.
Unsupported expressions fail admission. Do not accept arbitrary user SQL or
silently drop an index/predicate that cannot be represented.

Flarex must choose logical access paths and compile bounds because Postgres
cannot infer logical field distributions from opaque encoded keys. Prove actual
generated SQL plans and data retrieval costs. A selective query must avoid
decoding unrelated documents; fetch required rows in bounded batches and retain
projection/byte limits. Plan compound filters, sort, count, offset and relation
fan-out explicitly. A `LIMIT` is not a scanned-work bound, and an exact count
does not become constant-cost merely because an index exists.

Adding indexes increases entries, WAL, history and maintenance work. Avoid
rewriting unchanged memberships and unique ownership. Covering entries or
statistics structures are evidence-driven extensions, not mandatory duplication.
Measure hot/cold cache behavior and skew; do not force index scans merely to
produce a passing plan assertion.

## Relationships And Constraints

Shared relational core means logical relationships over generic storage, not
the existing `relationalSchema` DDL compiler under a new name. The compiler's
current tables/indexes/FKs are the displaced commerce representation.

Application/Payload document references may retain authoritative fields and
derived edge entries. A Medusa Module Link with identity, fields, timestamps
or soft-deletion lifecycle remains an authoritative logical record. Its
endpoint indexes are derived. A read-only Link remains query metadata. Do not
replace rich link records with public ID arrays or make edges a second writer.

Core must enforce logical target existence, endpoint ownership, cardinality,
unique pairs, deletion policy and complete change facts atomically. Concurrent
parent deletion and child insertion, missing endpoints, restore, cascades and
cross-scope refusal require real database witnesses. Generic physical FKs may
protect stable storage identities; field-specific native FKs cannot simply be
copied onto arbitrary encoded record fields. Their guarantees need a proven
logical constraint owner, not weaker adapter checks.

Redesign the current edge/row core when those semantics do not fit. Do not
preserve application-shaped internals by attaching a second commerce relation
engine. Reuse is judged by authority and semantics, not matching type names.

## Cross-Framework Relationship Contract

Declared relationships between Application, Payload and Medusa logical records
are an accepted target, including references originating in any of the three
and indexed traversal in both directions. Prove this early through real native
calls; completing three isolated adapters does not prove their composition.
Shared physical storage alone supplies neither integrity nor authorization.

A relationship binds stable source and target identities, their semantic owners,
the admitted schema revisions, cardinality, visibility and deletion policy.
Its endpoints must resolve within the authorized scope and compatible local
transaction placement. Separate deployments do not gain access to one another
through shared storage. Cross-shop or remote-service references require a
separate explicit contract; do not claim local atomic enforcement for them.

Keep one authoritative reference field or rich Link record. Reverse traversal
uses derived indexes, not a second independently writable relationship. The
source owner can change its reference; target mutations still pass through the
target's admitted framework behavior. Medusa-owned extensions require a supported
fork/model seam, not arbitrary writes into built-in commerce records. Read and
population boundaries preserve access checks and Payload draft/version visibility;
core must not expose target rows or existence through an unauthorized traversal.

Core enforces the declared relationship atomically, including concurrent target
deletion and reference insertion. Deletion, soft deletion, restore, cardinality
and lifecycle visibility need explicit compatible endpoint policies. Never
silently cascade across owners or invoke unadmitted hooks from constraint code.
Reject an unsupported policy rather than degrade a strong relation to an
unchecked ID or asynchronous repair. Distinguish a strong local relation from
an explicitly admitted weak/external reference.

Schema dependencies span framework boundaries. A candidate that removes or
changes a referenced table, identity, field, index or relation must account for
dependent schemas, existing data, in-flight readers and recovery. Independent
schema evolution is allowed when compatible; incompatible changes require a
coordinated transition. Dependency cycles cannot be resolved by arbitrarily
activating one broken endpoint first. The shared evolution contract must either
admit a coherent activation group or refuse that transition before writes.

## Transactions, Concurrency And Workflow Boundaries

One physical representation does not require one universal transaction API.
Native Application retains its intended snapshot/dependency/OCC behavior.
Payload and Medusa retain explicit admitted transactional execution profiles
over the shared core. Their internal mechanics may be redesigned; a change to
observable atomicity, retry or failure semantics must be stated and proved.

Only the trusted outer owner settles rows, indexes, unique claims, relations,
facts, durable results and event intent together. Preserve pending read-your-
writes behavior across module calls. Do not hold database transactions over
untrusted execution, remote effects, workflow waits or suspension. Durable
workflows use committed steps and stable outcome/effect identities through
existing execution owners, not a second scheduler or ledger.

Generic storage alone does not remove scope-clock serialization. Before
concurrent execution replaces it, specify request-identity exclusion,
authorization fences, row/set/invariant protection, common lock order,
publication ordering and lost-COMMIT recovery across all consumers. Protect
decisions before applying their writes; locking the final row does not repair
a stale decision. Do not automatically replay arbitrary hooks or callbacks.

## Schema Evolution And Admission

Different shops/deployments can bind different logical schemas over the same
physical families. Adding a field, module, logical index or link is logical
definition/build work, not a tenant-owned ALTER TABLE. Changes requiring data
conversion still need explicit semantic migration, backfill, validation and
activation; generic storage does not make incompatible old records disappear.

Keep physical core migrations separate from logical schema evolution. Reuse
proven installation progress, immutable evidence, fencing and readiness owners
where contracts fit; replace DDL-specific assumptions for logical builds.
Definition identity, live authorization and integrity auditing remain separate.
No cached prepared plan is current execution authority. Select the integrity
contract explicitly before reducing current evidence checks.

Logical evolution must converge on shared definitions, planning, validation,
index/constraint builds, progress/recovery and readiness mechanics for all three
consumers. Begin with the Application evolution owners and compare the existing
framework coordinator's guarantees. Redesign inadequate contracts instead of
retaining overlapping engines behind a facade or adding framework-name branches
to the Application planner. Native schema compilation and business conversion
meaning remain framework-owned. Data conversions execute through admitted,
bounded operations with shared progress and settlement; they are not arbitrary
migration callbacks or one long database transaction.

Current Application evolution is not a ready-made universal engine. Its
`managed-schema` planner and persistence apply/build/activation owners need a
connected capability analysis. Current framework migration metadata tables are
already shared physical tables; their count does not multiply per shop. Inventory
their responsibilities against Application catalog, build and activation state.
Retain needed definitions, fences, progress and evidence once per responsibility;
replace or delete redundant authorities and generated-commerce name/DDL records
as their consumers move. Platform physical upgrades and explicitly retained
system/lifecycle consumers remain separately justified. No exact table layout
or wholesale deletion is approved merely by choosing consolidation.

## Replacement, Compatibility And Completion

| Existing component | Disposition and completion condition |
| --- | --- |
| Shared app row/index/unique/edge storage and logical compilers | Retain, extend or replace at the correct owner after three-consumer contract analysis; no automatic freeze of current internals. |
| Medusa DML, services, workflows, Link semantics and original assertions | Retain intended behavior and provenance; change fork seams when needed, with explicit divergences. |
| Deployment-named Medusa tables and per-module physical DDL | Replace with logical definitions/shared storage; delete obsolete runtime consumers, exports and tests of displaced mechanics after semantic parity. |
| Commerce-only store guards and materialization | Replace with shared indexed and bounded mechanics; keep framework lifecycle translation only. |
| Application evolution and framework installation/migration infrastructure | Consolidate logical planning/build/readiness/progress at shared owners; inventory both metadata sets and replace duplicate authorities. Retain proven evidence/recovery mechanics and explicitly needed platform/system DDL consumers; delete obsolete commerce name assignments and DDL paths after cutover. |
| Shared settlement, feed, outbox, outcomes and task owners | Retain authority; redesign internals only under explicit connected correctness gates. |
| Fixed shared Medusa physical tables | Comparison only; no fallback or implementation without a new architecture decision. |

The owner authorizes clean development-phase replacement rather than preserving
unshipped internals. Do not build dual writes, adapters around obsolete core
contracts, or automatic fallback. Retain an old path only for an inventoried
consumer or real compatibility obligation, with a named removal gate. Each
implementation slice includes its consumer migration and cleanup. Do not delete
named durable data without its inventory, or change pinned source snapshots to
make compatibility tests pass.

## Validation And Limits

Acceptance includes different deployments reusing logical names, multiple scopes,
different logical schemas, no per-shop/module/index DDL, and a real connected
Medusa workflow plus Payload Local API and native Application operations.
Use PGlite for fast semantics and ordinary-role real Postgres for concurrency,
isolation, query plans, constraints, builds and settlement. Keep hosted
Cloudflare/Hyperdrive proof separate.

Measure growing shop counts and per-shop rows independently, logical index count,
relation fan-out, skewed hot tenants, independent/conflicting keys, p50/p95/p99,
errors/retries, SQL/rows/buffers, bytes, CPU, memory, WAL, history and maintenance.
Predeclare targets and compare equivalent operations against the current
relational baseline. No table-count reduction is a throughput claim.

Convex's logical table/index developer model remains the reference; this does
not claim identical internal storage. Postgres authority, framework transaction
profiles and explicit SQL-compatible commerce semantics are deliberate Flarex
differences. Relevant checked-in sources are `crates/database/src/table_registry.rs`
and `crates/common/src/bootstrap_model/index/index_metadata.rs` in the enclosing
Convex checkout; exact operation gates must inspect their corresponding source.
