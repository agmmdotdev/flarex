# FlarexDB Native Relational Foundation Contract

Status: accepted deferred foundation contract; no relation schema, edge table, relation compiler, relation read, developer API, or Payload adapter is implemented by this document

Filename note: this file retains `04-payload-relational-contract.md` so existing
roadmap and design-note links remain stable. Payload no longer owns the framing
or the core relation semantics. The native architecture is defined by
[`../../design-notes/flarexdb-native-relational-system.md`](../../design-notes/flarexdb-native-relational-system.md).
Payload mapping is owned by
[`../../design-notes/flarexdb-payload-relational-adapter.md`](../../design-notes/flarexdb-payload-relational-adapter.md).

## Decision

Relationships are a native FlarexDB database capability.

```text
Developer API producer              Internal test API producer
          \                                 /
           -> Standard Application relation contract
                         |
                         v
                FlarexDB System APIs
          schema lifecycle / relation reads /
           authoritative document commits
                         |
                         v
                 private FlarexDB kernel
             executor / OCC / committer /
               Postgres edge repository
```

Payload, Medusa, and other framework adapters consume those capabilities. They
do not define the canonical relation AST, physical edge schema, OCC dependency,
or commit protocol.

The core authority is:

```text
Flarex app/CMS row JSON
  = authoritative stored relation value

fx_app_edge_current
  = derived, rebuildable current adjacency sidecar

stable relation catalog + immutable semantic/physical definitions
  = schema and interpretation authority
```

A relation write is an insert, patch, replace, or delete of the authoritative
source row. The trusted commit compiler derives edge and adjacency actions in
the existing scope-clock transaction. The first system does not expose generic
user-authored edge CRUD.

## Scope

This contract owns the low-level prerequisites for:

- native Flarex one, many, reverse, and polymorphic relation semantics;
- Standard Application relation metadata shared by internal test and later
  developer producers;
- stable logical relation identity and immutable physical edge identity;
- deterministic current-edge occurrences derived from final rows;
- exact one-hop outgoing or incoming relation reads;
- relation OCC, read-your-writes, pagination, and reactive invalidation;
- the database capabilities later consumed by Payload relationship, upload,
  and join behavior.

It does not start:

- the public developer relation DSL;
- generated `ctx.db` relation helpers;
- the public test SDK;
- Payload database adapter methods or lifecycle tables;
- Medusa relation/link integration;
- graph traversal, SQL/PGQ routing, search, or arbitrary joins;
- relation-specific production routing or activation.

## API Ownership

### Standard Application Contract

The Standard layer owns explicit, serializable relation intent. It is inert and
contains no stable numeric IDs, physical table names, SQL, readiness state, or
execution authority.

The exact exported API remains an implementation decision, but the canonical
input must express:

```text
source logical table
canonical typed source path
forward logical name
allowed target logical tables and stable polymorphic tags
forward cardinality
reverse maximum cardinality and optional generated reverse name
requiredness or min/max item constraints
ordered flag
duplicate policy
localized flag
directional delete policy
```

One owning declaration defines a relation. The reverse name is generated API
metadata over the same relation identity, not a separately stored array or a
second authored relation.

Logical table references are serializable names resolved by analysis. Callback
identity, module initialization order, declaration order, or inferred table
shape must not select a relation.

### Internal Test Producer

The internal test API is the first producer used to prove the system. It may
construct valid and invalid relation definitions, exact canonical fixtures,
collision fixtures, concurrent writes, stale schemas, injected rollback,
corrupted edges, and incomplete builds.

It must lower through the Standard contract and use the real analysis,
registration, readiness, activation, runtime, executor, and persistence
owners. It must not directly write catalog or edge tables, mint identities, or
bypass the commit compiler.

### Developer Producer

A later developer API may provide ergonomic `relation.one`, `relation.many`,
polymorphic relation helpers, generated inverse references, and generated
relation query methods. Those values lower to the same Standard contract and
have no independent schema or storage authority.

The native core should use a relation-specific field descriptor rather than
pretending a relation is only an ordinary value validator. The stored value
still lowers to canonical IDs or tagged target references, but relation fields
also carry identity, adjacency, referential policy, build/readiness, and query
semantics.

### FlarexDB System APIs

FlarexDB System APIs own executable database operations and lifecycle
semantics. They eventually need bounded operations for:

```text
prepare relation schema bindings
publish stable relation and immutable edge definitions
reconcile and settle edge build/readiness state
perform trusted current-state adjacency reads
perform one exact-snapshot relation read
participate in the authoritative document commit lane
```

System operations expose typed logical input and output. They do not expose
`pg.Client`, Drizzle schemas, physical edge rows, caller-authored commit facts,
raw transaction handles, or private repositories.

### Function Runtime

Untrusted user functions receive a narrow host-neutral relation capability only
after the complete System operation exists. The runtime uses logical relation
references and document IDs. It never receives relation IDs,
edge-definition IDs, occurrence bytes, SQL cursors, adjacency-version rows, or
persistence handles.

The first function-runtime relation shape must be one bounded one-hop outgoing
or incoming adjacency page. Broader APIs remain absent until their exact
snapshot and dependency semantics are proved.

## Native Relation Semantics

### Owning Values

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
duplicates = allow | forbid
```

The source row owns the value. A reverse direction is virtual and query-backed.

### Reverse Cardinality

Reverse cardinality describes the maximum number of source occurrences allowed
to reference one target and the generated API result shape.

```text
reverse many
  no incoming uniqueness constraint

reverse one
  one exact incoming-endpoint uniqueness claim is required
```

Reverse `one` does not imply every target must have a source. Global minimum
existence constraints remain unsupported until separately designed.

### Pointer Relations Versus Association Tables

Pointer-only adjacency uses the generic relation sidecar. An association with
business data is an ordinary Flarex application table.

```text
role
quantity
price
discount
joinedAt
inviter
status
workflow state
```

must not be hidden as arbitrary metadata on `fx_app_edge_current`.

### Forward And Reverse Reads

A forward relation value already exists in the source row. Bounded forward
population can read the IDs from the row and use ordinary target point reads.
The edge table is not required merely to rediscover those IDs.

A reverse relation is an incoming adjacency query over current edges. Payload
may later expose it as a join field, but the native operation remains a
FlarexDB relation read.

### Polymorphism

Polymorphic relations use an explicit stable target tag plus target table and
row identity. A logical table or collection rename must not silently change the
stored API tag. Allowed target-set changes participate in schema compatibility
classification.

### Localization

Locale presence and locale value participate in relation occurrence and read
semantics when a relation is localized. Missing locale and empty locale are not
implicitly equivalent. R01 must freeze the canonical representation before
DDL.

## Identity Roles

Three identities are mandatory and cannot be reused interchangeably.

```text
relation_id
  stable deployment-scoped logical relation identity

semantic relation definition identity
  immutable API, cardinality, validation, name, and delete-policy meaning

edge definition identity
  immutable physical extraction, occurrence, endpoint, ordering,
  localization, and adjacency read-key meaning
```

The target representation is expected to follow the existing table/index
catalog pattern:

```text
CatalogRelationId
  compact stable logical identity

SemanticRelationDefinitionIdentity
  schema-artifact-qualified canonical semantic commitment

CatalogEdgeDefinitionId
  compact immutable physical definition identity with canonical bytes/SHA-256
```

A semantic-only change may reuse a physical edge definition only through an
explicit compatibility decision. A physical interpretation change requires a
new edge definition, build, validation, readiness result, and activation
binding. Old and replacement edge definitions coexist until retirement.

Names or shapes never guess identity. Rename, retarget, path movement,
cardinality conversion, localization conversion, or codec changes require an
explicit schema evolution decision.

## Canonical Source Paths

Relation extraction paths must be a typed sequence rather than an ambiguous
dotted string. Path segments distinguish fields, array items, block variants,
and other admitted structural boundaries.

Illustrative segments are:

```text
field(name)
arrayItems
block(type)
group(name)
```

The exact codec and admitted segment set are owned by R01. Unsupported nesting
fails definition analysis.

## Edge Occurrence Contract

Position is ordering metadata, never occurrence identity.

Each current edge occurrence carries or deterministically derives:

```text
exact immutable edge definition
source table and row identity
canonical typed source path
stable enclosing array/block item identity when applicable
locale presence and value
target table and row identity
duplicate occurrence discriminator
occurrence codec version
canonical occurrence bytes
occurrence SHA-256
mutable position when ordered
schema, epoch, and commit provenance
```

The same target can occur in different fields, nested items, blocks, locales,
or repeated positions. Those occurrences must remain distinguishable.

Hash equality is checked against retained canonical evidence. Equal digest with
unequal bytes is a fatal collision. A digest-only unique constraint is
insufficient.

Ordinary Flarex arrays do not currently establish stable item identity. The
first relation subset should reject nested relations until a keyed array/block
contract exists. Payload's nested row IDs do not authorize positional identity
inside the native core.

The native default for a bounded many relation should normally forbid repeated
target values. An adapter that admits repeated bare values must lower them
through the same duplicate-occurrence codec, not a separate physical table.

## Physical Current Edge Storage

`S12` adds only current edges for v1. The conceptual row contains:

```text
scope UUID
stable logical relation ID
immutable physical edge-definition ID
source table and row
occurrence codec/version/bytes/SHA-256
target table and row
nullable locale
nullable position
schema version
write epoch
commit sequence
```

The exact DDL is not frozen by this prose. S12 owns native UUID/compact-ID
policy, constraints, byte ceilings, canonical evidence, foreign keys, and
index plans.

The current edge key must include the physical edge definition and source
occurrence. Incoming and outgoing indexes are definition-aware and use a frozen
total pagination order.

A current edge row stores no full document and no arbitrary business
properties.

## Authoritative Commit Lowering

`C09` derives edge actions from:

```text
prior authoritative row
final authoritative row or tombstone
pinned semantic relation binding
pinned immutable physical edge definition
```

The pure lowerer produces deterministic:

```text
insert occurrence
remove occurrence
retarget occurrence
update ordering metadata
incoming adjacency change
outgoing adjacency change
referential-constraint action
```

The existing point/multi-row commit owner applies those actions atomically with:

```text
row revision/current pointer
index revisions/current pointers
unique claims
committed result/outcome
scope commit and typed change children
outbox wake
session completion
```

The compiler removes stale edges only for the exact physical definition it is
maintaining. It never reinterprets an old definition as a replacement one.
Schema deployment/build owns parallel replacement-definition population.

The outer commit remains the sole transaction, sequence, idempotency, and
publication owner.

## Referential Delete Behavior

A physical foreign-key cascade on the edge table is not a complete relation
policy because the authoritative source row could still contain a deleted
target ID.

The first supported target-delete policy is:

```text
restrict
```

It requires complete enabled incoming edge state before it may authorize a
delete check.

Later policies mean:

```text
detach
  patch every authoritative source row and regenerate sidecars

cascadeSource
  delete authoritative source rows through the normal commit lane
```

Unbounded detach or cascade requires a separately managed, fenced, retryable
workflow and visibility contract. It must not be hidden inside one bounded
transaction.

Deleting a source row removes its outgoing derived edges in the same commit.

## Exact Relation Reads And OCC

`fx_app_edge_current` supports current-state trusted reads after the exact edge
definition is enabled. It does not alone reconstruct an older mutation
snapshot.

`O10-R` must prove one exact outgoing or incoming adjacency shape using one of:

1. edge revision history plus an exact adjacency/range dependency; or
2. current edges plus an atomically maintained adjacency
   `last_changed_commit_seq` for scope, edge definition, direction, and
   endpoint.

For the current-edge option, a mutation must:

```text
read adjacency version before the edge page
require version <= SnapshotToken.commitSeq
read the current page
read adjacency version again
require equality and version <= snapshot
register that exact dependency
validate it unchanged inside final commit
```

The read also requires:

- complete transaction-local read-your-writes overlay;
- deterministic bounded pagination;
- target document point dependencies for returned documents;
- phantom detection for inserts, removals, and retargets;
- the existing conflict replacement and deterministic user-code rerun owner.

A high-fanout endpoint may make one adjacency version a write hotspot. O10-R
must measure it against edge history before selection. Commit-feed scanning is
not an automatic fallback.

Multi-hop traversal, arbitrary graph patterns, raw joins, unbounded pagination,
post-relation filters, variable-length paths, and mutations through graph
syntax remain rejected.

## Edge Build And Readiness

A relation-bearing schema cannot become reverse-query-ready or delete-policy
ready merely because future writes maintain edges. Existing authoritative rows
must be backfilled and validated.

`E01` owns the target-native lifecycle:

```text
reconcile one physical edge-definition build per scope
capture an exact start frontier
scan authoritative rows in bounded row-ID order
lower and publish candidate edges
re-read current rows before publication
maintain or invalidate validation under concurrent writes
validate the complete expected current edge set
settle enabled/readable state
include relation readiness in the application revision readiness root
activate only after every required relation definition is ready
```

The implementation should generalize the existing ordered-index and unique-key
build patterns: immutable definitions, scope-clock fencing, bounded cursors,
current-row revalidation, validation reset on relevant writes, replay safety,
and genuine-Postgres proof.

Before `E01` is complete:

```text
forward values may still be stored and point-read when their schema is active;
incoming adjacency, reverse APIs, target-delete restrict, Payload joins, and
relation-subscription correctness must remain disabled for that definition.
```

## Commit Feed And Reactive Invalidation

Every edge insert, remove, retarget, or relevant reorder produces typed
adjacency change facts in the same scope commit. The facts identify the exact
edge definition, direction, and endpoint affected.

They are used by the sync engine to invalidate relation subscriptions and live
results without scanning all source documents or broadly invalidating every
query for a table. They do not create a second edge commit stream or allow a
caller to author system facts.

The exact commit child schema and retention behavior are separate implementation
gates after C09 exposes deterministic edge actions.

## Payload Adapter Boundary

Payload compiles its relationship, upload, and join behavior onto the native
system:

```text
relationship -> stored native relation
hasMany      -> many cardinality and min/max policy
polymorphic  -> stable tags and allowed target set
upload       -> media relation plus object lifecycle
join         -> reverse native adjacency query
locale/depth -> adapter behavior over native identities and reads
```

A Payload collection may bind to one existing stable table and expose the same
authoritative row. One table has one schema owner, `app` or `payload`; another
surface cannot independently redefine relations.

Payload request transactions are adapter-owned and converge on the same trusted
row/index/unique/edge/commit primitives. They are not silently encoded as
untrusted Dynamic Worker `SessionJournalV1` attempts.

Versions, drafts, globals, auth, sessions, locks, jobs, preferences, migrations,
hook/access ordering, locale fallback, object lifecycle, population behavior,
and adapter-version interfaces remain separate conformance work. Engine row
history is not Payload version history.

## Optional SQL/PGQ Adapter

Postgres relational edge tables and indexed SQL remain the portable canonical
query path. A later PostgreSQL SQL/PGQ adapter may compile one proven fixed-hop
shape to a small platform-owned property graph projection.

It does not change storage authority, snapshot reconstruction, overlays,
authorization, pagination, OCC, commit facts, or invalidation. Application code
never supplies raw `GRAPH_TABLE` text. Older Postgres and PGlite lanes retain
the relational fallback, and SQL/PGQ routing requires conformance and benchmark
evidence.

## Required Turn Order

### [ ] R01 — Freeze Native Relation Semantics And Codecs

Outcome:

- freeze the Standard Application relation AST;
- freeze source/reverse cardinality, required/min/max, target sets,
  polymorphic tags, ordering, duplicate policy, localization, and directional
  delete behavior;
- freeze typed source-path and occurrence codecs with canonical bytes/SHA-256;
- freeze nested stable identity, repeated-target discrimination, locale
  absence/empty handling, position exclusion, and resource ceilings;
- define which first-generation combinations are supported and reject every
  other combination during analysis;
- add internal test fixtures and golden vectors without adding storage or
  runtime execution.

Exit gates:

- every admitted relation has unambiguous semantics;
- internal test and prospective developer producers can lower to one exact
  Standard representation;
- repeated/localized/nested occurrences cannot alias through mutable position;
- digest collisions fail closed against retained canonical evidence;
- no Payload type or physical ID enters the canonical contract.

### [ ] R02 — Bind Relation And Edge Definitions Into Schema Lifecycle

Outcome:

- allocate stable relation IDs through the existing optimistic stale-plan
  discipline;
- bind immutable semantic relation definitions and immutable physical edge
  definitions into the versioned schema artifact;
- use explicit compatibility classification for rename, policy, target,
  cardinality, path, localization, and codec changes;
- permit compatible semantic definitions to reuse a physical definition only
  through an explicit binding;
- permit old and replacement edge definitions to coexist;
- keep normalized relation-definition projections deferred unless identity,
  build, or hot introspection proves one necessary.

Exit gates:

- exact replay preserves identities;
- logical, semantic, and physical identities cannot be confused;
- physically different definitions cannot alias;
- every edge, build, plan, and dependency can resolve exact immutable meaning;
- no second mutable definition authority exists.

### [ ] S12 — Add Stable Current Edge Occurrences

Prerequisite: R01 and R02 are complete for the admitted subset.

Outcome:

- add private `fx_app_edge_current` storage only;
- retain canonical occurrence evidence and collision checks;
- add exact physical-definition-aware incoming and outgoing access paths;
- freeze total pagination order and row/byte ceilings;
- add transaction-only repository primitives with no public edge CRUD and no
  edge history table.

Exit gates:

- repeated targets, reorder, locale/path distinction, source deletion, and
  cross-scope isolation pass;
- hash collisions cannot overwrite or conflate occurrences;
- every stored edge pins an exact physical definition;
- PGlite and genuine Postgres prove constraints and access plans.

### [ ] C09 — Lower Authoritative Rows Into Current Edges

Prerequisite: the exact relation binding and edge repository exist.

Outcome:

- implement the pure prior/final row relation lowerer;
- integrate deterministic edge and adjacency actions into the existing commit
  lane;
- remove stale occurrences for the exact maintained definition;
- enforce admitted referential and reverse-one constraints;
- preserve rollback, replay, result, feed, outbox, and idempotency atomicity.

Exit gates:

- insert, patch, replace, delete, retarget, reorder, repeated values, and stale
  cleanup pass;
- old and replacement definitions do not cross-delete one another;
- injected failures roll back row and every sidecar together;
- relation reads remain disabled until their own proof.

### [ ] E01 — Build, Validate, And Enable Edge Definitions

Prerequisite: S12 and C09 are complete.

Outcome:

- add scope-fenced bounded build/readiness state;
- backfill existing rows through the same canonical lowerer;
- revalidate current rows and reset validation under relevant concurrent
  commits;
- prove complete expected current contents;
- settle enabled/readable evidence and fold it into revision readiness.

Exit gates:

- existing rows cannot be omitted from reverse reads or delete restrictions;
- concurrent writes cannot escape the validation frontier;
- replay, rollback, stale schema, replacement definitions, and corrupted edges
  fail closed;
- activation cannot expose an unready required relation definition.

### [ ] O10-R — Prove One Exact Relation Read

Prerequisite: the selected edge definition is enabled.

Outcome:

- implement one bounded outgoing or incoming adjacency page;
- select and prove edge history or adjacency-version authority;
- add exact snapshot registration, deterministic pagination, complete
  read-your-writes, target point dependencies, phantom validation, and OCC
  rerun composition;
- add only the required function-runtime and journal/dependency representation.

Exit gates:

- changes before, during, and after dependency registration conflict correctly;
- staged insert/update/delete/retarget operations overlay correctly;
- partial pages and empty/exhausted pages have exact dependencies;
- unsupported relation, graph, filter, and pagination shapes fail before target
  data I/O.

### [ ] R03 — Relation Change Facts And Sync Invalidation

Outcome:

- publish typed incoming/outgoing adjacency changes from C09 actions in the
  existing scope commit;
- allow the sync owner to register relation dependencies and invalidate live
  results without a second commit stream;
- freeze retention and reconnect behavior before production relation
  subscriptions.

### [ ] SV-R — Internal Standard Relation Vertical

Outcome:

- use the internal test producer to define, analyze, register, ready, activate,
  invoke, commit, query, and observe one real relation-bearing application;
- prove the path in PGlite and genuine Postgres;
- keep the operation route-independent and production-inert until the normal
  activation/routing owners permit it.

Only after this vertical is green may the developer SDK and Payload adapter
claim the native relation capability.

### Later Developer And Adapter Work

```text
developer producer
  ergonomic relation helpers, generated references, typed forward/inverse APIs

Payload adapter
  relationship/upload/join mapping, request transactions, population,
  localization, versions/drafts, and lifecycle conformance

SQL/PGQ adapter
  optional fixed-hop query routing after relational conformance and benchmarks
```

## Verification

Every implementation turn runs the owning package checks plus focused PGlite
and genuine-Postgres tests where storage, transactions, concurrency, or access
plans change. Protocol/Standard changes run canonical vector and producer
conformance. Function-runtime changes run the host-neutral runtime and exact
journal/OCC composition. Readiness changes run managed-schema activation and
rollback proofs. Sync changes run reconnect and retained-floor scenarios.

Significant code turns require both standing exact-diff reviewers before the
checkpoint commit.

## Known Limitations

- No native relation definition is currently admitted by the production
  application schema contract.
- No relation catalog, edge definition, edge table, edge build state, compiler,
  adjacency version, edge history, relation read, or relation sync dependency
  is implemented.
- The exact first supported cardinality/path/locale/polymorphism subset remains
  intentionally unfrozen until R01.
- The exact physical identity spelling, DDL, index order, pagination cursor,
  build table, and adjacency authority remain intentionally deferred to their
  owning gates.
- Cross-owner references to Medusa or other external resolvers require separate
  existence, deletion, staleness, and transaction participation contracts.
- Payload relation behavior remains adapter conformance work and does not block
  the native R01 contract from being designed independently.
