# FlarexDB Native Relational System

Status: accepted architecture; private system core through the direct
read-only Standard relation query `RQ01` is complete

Last reviewed: 2026-08-26

This note defines the ownership, API layering, logical model, and correctness
boundaries for relationships in FlarexDB. It is an addendum to
[`flarex-db-accepted-design.md`](./flarex-db-accepted-design.md). That document
continues to own the general FlarexDB authority, transaction, migration, sync,
Payload, and Medusa boundaries. This note controls when an older relationship,
edge, reverse-link, population, or Payload-oriented proposal conflicts with the
native FlarexDB relational model below.

The long-term CMS and commerce vocabulary in
[`flarex-commerce-cms-sections-blocks.md`](./flarex-commerce-cms-sections-blocks.md)
remains useful for product ergonomics. Its relationship API examples are not the
FlarexDB System API, Standard Application contract, or private storage
contract. Payload-specific mapping is owned separately by
[`flarexdb-payload-relational-adapter.md`](./flarexdb-payload-relational-adapter.md).
The executable foundation order remains in
[`../roadmaps/flarexdb-foundation/04-payload-relational-contract.md`](../roadmaps/flarexdb-foundation/04-payload-relational-contract.md);
that filename is retained for link stability even though its authority is now
FlarexDB-native.

## Decision

Relationships are a native FlarexDB database capability.

```text
FlarexDB defines relation semantics.
Standard Application APIs represent those semantics.
Internal tests prove those semantics.
Developer APIs make those semantics ergonomic.
Framework adapters map their behavior onto those semantics.
Postgres stores and executes the authoritative physical state.
```

Payload is an important future consumer, but Payload does not define the core
relation model. FlarexDB must not expose a renamed Payload relationship API,
copy Payload's `_rels` schema, or let Payload collection slugs, join fields,
population depth, drafts, versions, hooks, access callbacks, or admin widgets
become database authority.

The accepted physical rule remains:

```text
Flarex-owned app/CMS row body
  = authoritative relation value

fx_app_edge_current
  = deterministic, rebuildable current adjacency sidecar

selected exact-snapshot support
  = atomically maintained endpoint adjacency last-changed versions

stable relation catalog + immutable definitions
  = schema and physical interpretation authority
```

Ordinary relation writes are authoritative document writes. Developer or
adapter code patches, replaces, inserts, or deletes a row; the trusted commit
compiler derives edge insertions, removals, retargets, and ordering updates in
the same scope-local Postgres commit. The first system does not expose generic
`createEdge`, `deleteEdge`, `connect`, or `disconnect` operations that could
create a second write authority.

## API And Authority Layers

The relation system must preserve the repository's existing producer and
System API direction:

```text
Developer relation API producer       Internal test API producer
  ergonomic schema helpers              explicit fixtures, invalid inputs,
  generated table/relation refs          seeds, limits, and fault plans
                    \                    /
                     v                  v
             Standard Application APIs
               canonical relation intent
               canonical table/function intent
               definition preparation and analysis
                         |
                         v
               FlarexDB System APIs
                 schema registration
                 physical readiness
                 application data operations
                 exact relation reads
                         |
                         v
                Private FlarexDB kernel
             executor / journal / OCC / committer
          edge repository / scope clock / Postgres
```

Framework adapters are sibling consumers of the FlarexDB System APIs:

```text
Payload configuration
  -> Payload-to-Flarex compiler and request adapter
  -> Standard relation intent and FlarexDB System capabilities

Medusa relational state
  -> trusted Medusa adapter and transaction participation capability
  -> shared scope commit/feed/outbox authority where explicitly supported
```

The layers have different responsibilities.

### Standard Application APIs

Standard Application APIs own explicit, serializable application intent shared
by the internal test producer and the later developer producer. They do not own
Postgres placement, stable numeric identifiers, schema activation, edge rows,
OCC, or commit authority.

The current analysis generation, owned by
[`../roadmaps/49-application-analysis-migration.md`](../roadmaps/49-application-analysis-migration.md),
changes how that inert intent becomes trusted. The accepted authority direction
is:

```text
Standard relation intent
  -> generated executable function-registration and schema modules
  -> authenticated Source Artifact V2
  -> Application Analysis cold-loads both modules
  -> one concrete Application Manifest contract generation
  -> schema publication, stable catalog binding, readiness, and activation
```

For the private Application revision generation, the loaded registrations and
schema are the analyzer's only acceptance inputs after authenticated Source
Artifact V2 upload. Canonical Declarative Program may remain an upstream
authoring/code-generation compatibility input, while Semantic Artifact remains
historical evidence/decoding only; neither may be consulted after cold load by
analysis, readiness, activation, or runtime as a second metadata authority. The
active concrete
[`ApplicationManifestV1`](../packages/analysis/src/applicationAnalysisV1.ts)
has a strict `schema` member containing only tables and indexes, while current
[`SchemaManifestAppSchemaV1`](../packages/flarex-protocol/src/schema-manifest.ts)
is likewise table/index-only. Completed `R01` keeps exact V1 emission for
zero-relation analysis and adds strict `ApplicationManifestV2` only for
relation-bearing analysis. The normal semantic boundary is the unversioned
`ApplicationManifest` union; numeric suffixes identify only the two concrete
coexisting envelopes. V1 remains active and is not legacy. The authenticated
analysis host accepts both, while persisted publication/runtime consumers and
`SchemaManifestAppSchemaV1` remain V1-only until `R02` adds a distinct
post-analysis binding generation for stable catalog/physical IDs. Neither V1
shape gains `relations`, and no old digest acquires new meaning.

This is the current unversioned private authority, not a claim that production
callers have cut over. Roadmap 49's `AA-R9-P` remains no-go, and relation work
does not authorize a route, binding, production caller, or fallback.

The Standard relation representation is ordinary canonical data. The current
private semantic API is the unversioned
`@flarex/standard-application-definition/internal/relation-definition`; it
accepts exact `RelationDeclarationV1` input. The concrete envelope is:

```ts
{
  format: "flarex.relation-declaration",
  version: 1,
  source: {
    table: "posts",
    path: [
      { kind: "field", name: "author" },
    ],
    forwardName: "author",
  },
  target: { table: "users" },
  value: {
    cardinality: "one",
    required: true,
  },
  inverse: {
    name: "posts",
    cardinality: "many",
  },
  localized: false,
  onTargetDelete: "restrict",
}
```

`source.path` is exactly one `field` segment and its name equals
`forwardName`. A many value instead carries nonnegative `minItems`, positive
`maxItems` no greater than 1,024, `ordered`, and `duplicates: "forbid"`.
Identity strings are nonempty and at most 256 UTF-16 code units; a declaration
set has at most 1,024 entries and one canonical declaration at most 8,192
bytes. The durable rules are:

- the value is inert and serializable;
- logical table names and explicit path segments are used rather than module
  callback identity or declaration order;
- one owning declaration defines the relation;
- a reverse name is generated metadata over the same relation identity, not a
  separately stored array or separately authored relation;
- developers and tests never select stable numeric IDs or physical table names;
- unsupported semantics fail during definition analysis rather than silently
  degrading to JSON scans or legacy storage.

### Internal Test APIs

The internal test API is the first producer used to prove the relation system.
It may provide convenient builders for valid and invalid definitions, seeds,
concurrency schedules, forced digest collisions, injected rollback, stale
schema state, and corrupted physical evidence. It must still lower through the
same Standard representation and invoke the real analysis, registration,
readiness, activation, function runtime, executor, and persistence owners.

An internal test helper must not directly insert catalog rows, mint relation or
edge-definition IDs, write edge rows, bypass the commit compiler, or call
Postgres repositories as application behavior.

### Developer APIs

The later developer API may expose ergonomic helpers such as:

```ts
const posts = defineTable({
  title: v.string(),
  author: relation.one("users", {
    inverse: "posts",
    required: true,
    onDelete: "restrict",
  }),
})
```

That syntax is illustrative, not an accepted public contract. It is a producer
adapter over the Standard relation representation. It cannot create another
relation AST, runtime, query engine, migration owner, or storage interpretation.

A dedicated `relation` field namespace is preferable to treating relations as
ordinary `v` validators because a relation carries schema identity, adjacency,
referential policy, build/readiness, and query behavior in addition to its row
value type. The row value still lowers to ordinary canonical IDs or tagged
polymorphic references.

### FlarexDB System APIs

FlarexDB System APIs expose bounded database capabilities and lifecycle
semantics. They do not expose raw SQL, Drizzle tables, `pg.Client`, internal
transaction objects, physical edge rows, journal records, or caller-authored
commit/outbox facts.

The relation family eventually needs concrete operations equivalent to:

```text
register relation-bearing schema intent
prepare and apply stable relation/edge-definition bindings
reconcile physical edge build state
settle relation readiness
read one exact outgoing or incoming adjacency page
participate in one authoritative document commit
read current relation state for trusted admin/adapter use
```

Each executable System operation must ship with its real implementation,
typed failures, Effect/resource lifetime where required, test adapter, and first
real consumer. A contract-only facade over missing behavior is rejected.

The accepted first private Standard read operation is the unversioned
`takeIncomingRelationSources`. Its exact input selects a relation by the owning
source `{ table, path }`, supplies one target document ID and a limit from 1 to
128, and accepts no physical identity, caller cursor, population, filter, or
graph shape. Its exact result is `{ sources, exhausted }`; each source retains
the O10-R logical `sourceDocumentId`, `duplicateOrdinal`, and `position`.

RQ01 composes this operation directly through the active Application query
snapshot owner because relation readiness still deliberately accepts only an
empty function catalog. It is not the function-runtime API described below.
The relation-aware Worker/function vertical remains owned by `SV-R` after R03.

### Function Runtime APIs

Untrusted application code receives logical relation capabilities through the
host-neutral function runtime. It never receives relation IDs,
edge-definition IDs, occurrence digests, SQL cursors, adjacency-version rows,
or persistence repositories.

The first relation read should be one bounded incoming one-hop operation. A
private runtime capability may be structurally similar to:

```ts
interface FunctionRuntimeIncomingRelationReader<
  RelationRef,
  RelationOccurrenceRef,
  DocumentId,
> {
  takeIncomingRelationSources(args: {
    relation: RelationRef
    target: DocumentId
    limit: number
  }): Promise<{
    sources: ReadonlyArray<{
      occurrence: RelationOccurrenceRef
      sourceId: DocumentId
    }>
    exhausted: boolean
  }>
}
```

The exact exported spelling remains an implementation gate. The durable first
boundary returns logical occurrence/endpoint identities, not populated
documents, and has no caller-authored cursor. Source or target documents load
through ordinary point reads with their own dependencies. Forward loading
continues to read IDs from the authoritative source row. A later composition
may return documents or expose external pagination only after its result,
snapshot, cursor-binding, authorization, and dependency semantics are proved.

## Native Logical Relation Model

A relation definition must express at least:

```text
source table
source field identity or canonical typed source path
allowed target tables and stable polymorphic tags
forward name
optional reverse name
forward cardinality
reverse maximum cardinality
owning-side requiredness or min/max item constraints
ordered flag
duplicate policy
localized flag
directional delete policy
```

The first supported subset is intentionally smaller:

```text
same-scope Flarex app tables
top-level nonlocalized source fields
monomorphic one or many values
duplicate targets forbidden
reverse maximum cardinality many
generated inverse metadata
target must be live at final commit
target-delete restrict
source-delete derived-edge cleanup
```

Nested paths, localization, polymorphism, repeated targets, reverse-one,
detach, cascade, cross-owner targets, and external pagination remain rejected
first-generation inputs. The canonical representation can reserve future
fields, but schema analysis must reject an unsupported combination. Presence in
the AST is not permission to execute it.

### Cardinality

For one-valued relations:

```text
cardinality = one
required = true | false
```

For many-valued relations:

```text
cardinality = many
minItems
maxItems
ordered
allow or forbid repeated targets
```

Reverse cardinality is a maximum constraint and API shape. A reverse
cardinality of `one` means that at most one source occurrence may point to one
target. It requires an exact transactionally maintained incoming-endpoint
claim. It does not imply that every target must have a source. Global minimum
existence constraints remain unsupported until separately designed.
Reverse-one is not admitted by the first relation slice and requires its own
claim, build, contention, and schema-evolution gate.

### Pointer Relations And Association Tables

The generic edge sidecar represents pointer-only adjacency. When an association
has business data such as role, status, quantity, price, discount, joined time,
inviter, workflow state, or notes, it is an ordinary application table with two
or more explicit relations.

```ts
const memberships = defineTable({
  organization: relation.one("organizations"),
  user: relation.one("users"),
  role: v.string(),
  joinedAt: v.number(),
})
```

Generic edge rows must not become hidden entity rows or accept arbitrary
application metadata.

### Forward And Reverse Directions

A stored forward relation already exists in the authoritative source row.
Bounded forward loading can therefore resolve the source value and perform
ordinary target point reads. It need not scan the edge sidecar merely to
rediscover IDs stored in the row.

A reverse relation is a virtual adjacency query over derived edge storage:

```text
post.author -> user
user.posts   -> incoming adjacency over post.author
```

Payload may later map a relationship field to the forward direction and a join
field to the reverse direction, but FlarexDB does not call its native reverse
operation a Payload join.

## Identity And Schema Evolution

Three identities are required and must not be interchanged.

```text
relation_id
  stable deployment-scoped logical identity

semantic relation definition identity
  immutable API, validation, cardinality, naming, and policy interpretation

edge definition identity
  immutable physical extraction, occurrence, endpoint, ordering,
  localization, and read-key interpretation
```

A practical target is:

```text
CatalogRelationId
  compact stable logical catalog identity

SemanticRelationDefinitionIdentity
  schema-artifact-qualified canonical semantic SHA-256

CatalogEdgeDefinitionId
  compact immutable physical definition identity bound to canonical bytes/SHA-256
```

A semantic-only change may reuse the same edge definition when the stored edge
set and read keys remain valid. A physical interpretation change requires a new
edge definition, build, validation, readiness result, and activation binding.
Old and replacement definitions must coexist during that lifecycle.

Examples:

| Change | Logical relation | Semantic definition | Edge definition |
| --- | --- | --- | --- |
| required/min/max policy | preserve | replace | reuse when physical facts are unchanged |
| public or admin reverse-name change | explicit preserve | replace | reuse |
| target-delete policy | preserve | replace | reuse |
| unordered to ordered when position was always retained | preserve | replace | reuse after validation |
| allowed polymorphic target set change when target table is always stored | explicit preserve | replace | reuse only through an explicit compatible binding |
| source path move | explicit migration | replace | replace |
| nonlocalized to localized | explicit migration | replace | replace |
| one to many | explicit migration | replace | normally replace |
| occurrence codec or adjacency read-key change | preserve logical identity | replace | replace |

Names or shapes must never guess identity preservation. Rename, retarget, or
cardinality evolution requires an explicit schema migration decision.

## Edge Occurrence Identity

Mutable array position is ordering metadata, not occurrence identity. The same
target may appear in multiple source fields, nested items, blocks, locales, or
repeated positions.

For the first profile, `RelationOccurrenceV1` is the strict canonical envelope
`{ format, version, sourceDocumentId, sourcePath, targetDocumentId,
duplicateOrdinal: 0 }`. It deliberately contains no position, locale, relation
ID, physical edge ID, nesting segment, or other future field. Canonical JSON is
capped at 8,192 bytes; injected SHA-256 must return exactly 32 owned bytes;
equal digests with unequal retained bytes and equal bytes with unequal digests
both fail closed. Later stable relation/edge binding encloses this evidence and
does not change its bytes.

Every stored occurrence must carry or deterministically derive:

```text
exact immutable edge definition
source table and row identity
canonical source path
stable enclosing array/block item identity when applicable
locale presence and value
canonical target table and row identity
duplicate ordinal or another accepted repeated-occurrence discriminator
occurrence codec version
canonical occurrence bytes and SHA-256
position when ordered
```

Hash equality is never sufficient by itself. Persistence retains the canonical
evidence needed to compare equal digests and fails closed on unequal bytes.

Ordinary Flarex arrays do not currently provide stable element identity. The
first native relation subset should therefore either forbid nested relations or
require a keyed array/block field that supplies stable item identity. Payload
nested relations are not permission to invent positional identity in the core.

The native developer default should normally forbid repeated target values in a
bounded many relation. Payload compatibility may admit repeated bare values;
that adapter must lower them through the same canonical duplicate-occurrence
contract rather than changing edge storage.

## Authoritative Writes And Delete Behavior

A relation value is written by inserting, patching, replacing, or deleting the
source row. The trusted compiler compares prior and final authoritative values
and derives deterministic edge actions.

```text
prior row + final row + pinned relation binding
  -> outgoing edge insert/remove/retarget/reorder actions
  -> incoming and outgoing adjacency change facts
  -> referential-constraint actions
```

Those actions publish atomically with row revision/current, indexes, unique
claims, result, commit/change feed, outbox, and idempotency outcome.

The first relation contract is referential rather than a weak dangling
reference. The final material row set must contain a live target for every
admitted relation value. Under the existing scope-clock commit serialization,
a relation insertion racing a target deletion must settle in one deterministic
order: the later incompatible commit fails. Same-commit target insertion,
replacement, or deletion is judged from the final material state, not SQL
statement order or a foreign key to a current-row pointer.

Physical foreign-key cascade on the edge sidecar is not a complete relation
policy. Deleting an edge without rewriting an authoritative source row would
leave the row containing a stale target ID.

The first safe target-delete policy is `restrict`. Later `detach` must patch
all authoritative source rows and regenerate their sidecars. Later
`cascadeSource` must delete authoritative source rows. Unbounded detach or
cascade requires a separately designed managed workflow; it must not be hidden
inside one supposedly bounded transaction.

Source-row deletion removes its derived outgoing edges as part of the same
commit.

## Exact Snapshots, OCC, And Read-Your-Writes

Current edges alone are sufficient for explicitly current-state trusted reads.
They are not sufficient for a mutation pinned to an earlier snapshot.

The first mutation relation read must prove one bounded incoming adjacency
shape with:

- exact snapshot eligibility;
- deterministic internally owned page/frontier semantics;
- complete transaction-local overlay;
- phantom detection;
- final commit-time dependency validation;
- the existing OCC conflict replacement and user-code rerun owner.

`R01-P` selected current edges plus an atomically maintained adjacency
`last_changed_commit_seq` keyed by scope, physical edge definition, direction,
and endpoint. Edge revision history is rejected for this generation and must
not remain as a fallback or dual-write path.

A mutation reads the version before and after its bounded current-edge page,
requires equality and a version no newer than the snapshot, registers that
exact dependency, and validates it unchanged after locking the scope clock in
the final commit. Absent is version `0`. Because every edge/version writer locks
the same scope clock first, the final check also closes an absent-to-present
registration race. A conflict uses the existing attempt replacement and
deterministic rerun; there is no history or commit-feed reconstruction path.

Current occurrence identity is `(scope, physical edge definition, source row,
target row, duplicate ordinal)`; mutable position is not identity. Incoming
pages use the `(scope, definition, target)` equality prefix and
`(source, duplicate)` order. They return at most 128 logical identities, read
at most 129 base rows for lookahead, retain only an internal frontier, and share
a 4,096-occurrence transaction ceiling. Outgoing maintenance uses the matching
source equality prefix and target/duplicate order.

The genuine PostgreSQL `18.3` receipt used 33,179 current edges and a 20,000
source hot endpoint. Both automatic and forced-generic plans used the intended
indexes for distinct initial and resumed shapes without filtered rows, but the
retained-history page scanned 16,385 revisions and 205 blocks to return its
513-candidate ceiling while each selected current page read 129 rows and 5
blocks. One-row-per-revision history required `12,402,688` bytes
before churn and about `533` candidate-only WAL bytes per mixed mutation;
adjacency versions required `5,160,960` bytes and about `515` bytes. Naked
version-row contention was measurable, but with the already-required
scope-clock-first lock both candidates completed the same 128-write workload
in about 54-57 ms with about 7.5-9.3 ms p95. Final validation was observed blocking
behind a writer's scope-clock lock and then rejecting the stale adjacency
dependency. The full diagnostic receipt and
reopen thresholds live in
`roadmaps/flarexdb-foundation/04-payload-relational-contract.md`. Timing is
local diagnostic evidence, not a product SLA.

Multi-hop traversal, arbitrary graph patterns, unbounded pagination, raw joins,
post-edge filters, and variable-length paths remain rejected until each has
bounded dependency semantics.

## Build, Readiness, Activation, And Reactive Change

Adding a relation to a table that already contains rows requires a target-native
build lifecycle. Merely activating a manifest and beginning future edge
maintenance would make reverse reads and delete restrictions incomplete.

The relation lifecycle must provide:

```text
immutable relation and edge-definition binding
per-scope build reconciliation
bounded exact-frontier row scan
current-row revalidation before edge publication
concurrent-write maintenance or validation invalidation
complete edge-set validation
enabled/readable verdict
readiness-root participation
activation only after required evidence is complete
```

Relation intent may be analyzed and published on an inactive application
revision while a build runs. A relation-bearing revision does not activate
until every required edge definition is fully maintained, validated,
reverse-readable, and restrict-ready. There is no active first-generation state
in which a field is called a relation while reverse reads or its declared
delete policy are silently disabled. Existing active revisions retain their
previous non-relation semantics until the new revision activates.

The existing ordered-index and unique-key build patterns should be generalized
rather than replaced by an unrelated edge migration engine.

C09 first exposes deterministic adjacency actions inside the authoritative
commit plan. R03 later projects every edge insert, removal, retarget, or ordering
change into typed adjacency change facts in that same commit. Those facts allow
the sync engine to invalidate relation subscriptions and dependent live results
without broadly invalidating every query for the source table. Until R03 and the
complete SV-R proof, relation-specific change feeds, subscriptions, and live
observation remain disabled and unclaimed. The facts are commit children, not a
second edge commit stream. R03 enables dependency registration at a fenced
scope-commit baseline: prior changes are incorporated by a fresh snapshot, and
every relevant later change has a typed fact.

## Framework Adapter Boundary

Framework adapters consume the native relation system through narrow trusted
capabilities.

Payload mapping, for example, is:

```text
Payload relationship  -> stored FlarexDB relation
Payload hasMany       -> many cardinality and min/max policy
Payload polymorphism  -> explicitly tagged allowed targets
Payload join          -> reverse adjacency query
Payload upload        -> relation to a media logical table plus object lifecycle
Payload depth         -> adapter population policy
Payload hooks/access  -> adapter runtime policy
```

One logical table has one row authority and one schema owner. Another API
surface may expose the same table, but it cannot redefine the relation or write
a second document copy.

Payload request transactions are adapter-owned and compile supported behavior
into the same trusted row/index/unique/edge/commit primitives. They are not
silently encoded as the Dynamic Worker `SessionJournalV1` path. Payload
versions, drafts, globals, auth, locks, jobs, preferences, locale fallback,
hooks, and access ordering remain separate conformance work.

Medusa retains its repositories, relational tables, transaction manager,
ModuleJoiner/link metadata, migrations, and workflows. Cross-owner references
require a trusted resolver and staleness/delete policy; Medusa rows are not
copied into app-row storage.

## PostgreSQL And SQL/PGQ

Postgres is the authoritative physical engine. FlarexDB remains the logical
database system: it owns schema identity, exact snapshots, OCC, commit
compilation, reactive changes, adapter boundaries, and relation semantics.

Portable indexed relational SQL is the canonical edge query path. A future
PostgreSQL SQL/PGQ adapter may compile a proven fixed-hop shape over a small
platform-owned property graph projection. SQL/PGQ does not replace relation
authority, snapshot reconstruction, overlays, authorization, pagination, OCC,
or invalidation. Application developers never submit raw `GRAPH_TABLE` text.

## Rejected Designs

The following are rejected as the native relation foundation:

```text
Payload field configuration as FlarexDB's relation AST
Payload collection slugs as physical relation authority
copying Payload's _rels schema
one separately authored forward and reverse relation declaration
stored reverse arrays on target rows
generic user-authored createEdge/deleteEdge operations
arbitrary business metadata on hidden edge rows
position as occurrence identity
relation IDs inferred from names or declaration order
raw SQL, Drizzle, pg, or edge-definition IDs in application code
relation reads that silently fall back to JSON scans or legacy storage
SQL/PGQ as a correctness or storage prerequisite
```

## Implementation Direction

The relation work should proceed through these bounded stages:

1. complete (`R01`): rebase the relation producer and artifact path on
   authenticated executable function-registration/schema modules, Application
   Analysis, and one explicit manifest-contract evolution;
2. complete (`R01`): freeze the narrow native Standard relation semantics and
   canonical occurrence/path codecs;
3. complete (`R01-P`): select endpoint adjacency versions over edge history
   through genuine-Postgres evidence and freeze the bounded access/page rule;
4. complete (`R02`): bind stable logical relation identities, immutable
   semantic definitions, and immutable physical edge definitions into the
   schema lifecycle;
5. complete (`S12`): add private current-edge storage plus the selected
   endpoint-adjacency-version support, bounded transaction maintenance, and
   access paths;
6. lower authoritative final rows, current edges, and the selected snapshot
   support into the existing commit lane;
7. build, validate, and enable edge definitions for existing rows;
8. prove one exact incoming endpoint page with mutation OCC and
   read-your-writes;
9. activate one private relation-bearing revision through the existing
   Application activation owner;
10. compose the same logical read through the active read-only Application query
    owner;
11. add typed adjacency commit facts and relation subscription invalidation;
12. prove the complete path with the internal test producer;
13. add developer ergonomics and generated relation references;
14. implement Payload and other framework-adapter conformance over the proven
    native system.

The first implementation checkpoint, physical preflight, stable binding, and
private edge storage are complete at `R01`/`R01-P`/`R02`/`S12`; C09, E01,
O10-R, RA01, and RQ01 are also complete at their private system-core
boundaries. R03 is the next separate relation slice. Do not widen it into the
later function runtime, a Payload-shaped public API, or unrelated commit
authority.
