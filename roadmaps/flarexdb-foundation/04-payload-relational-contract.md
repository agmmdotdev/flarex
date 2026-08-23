# FlarexDB Native Relational Foundation Contract

Status: accepted deferred foundation contract; the 2026-08-23 authority
reconciliation is docs-only, and no relation schema, edge table, relation
compiler, relation read, developer API, or Payload adapter is implemented by
this document

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

selected exact-snapshot support
  = edge history or endpoint adjacency versioning chosen before edge DDL

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
- authoritative forward-ID loading from source rows plus one exact bounded
  incoming relation read;
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

## Current Authority Reconciliation

The relation architecture predates completion of the
[`Application Analysis migration`](../49-application-analysis-migration.md).
The current trusted path is now:

```text
Standard relation intent
  -> generated executable function-registration and schema modules
  -> authenticated Source Artifact V2
  -> Application Analysis cold-loads both modules
  -> one concrete Application Manifest contract generation
  -> app-schema publication and stable catalog binding
  -> readiness and activation
```

For the private Application revision generation, the loaded registrations and
schema are the analyzer's only acceptance inputs after authenticated Source
Artifact V2 upload. Canonical Declarative Program V1 may remain an upstream
authoring/code-generation compatibility input, while Semantic Artifact V1 is
historical evidence/decoding only; relation work must not consult either after
cold load as a second analysis, readiness, activation, or runtime metadata
source.
[`ApplicationManifestV1`](../../packages/analysis/src/applicationAnalysisV1.ts)
has a strict `schema` member containing only tables and indexes;
[`SchemaManifestAppSchemaV1`](../../packages/flarex-protocol/src/schema-manifest.ts)
likewise has a strict table/index-only shape.
`R01` must inventory their persisted/runtime consumers and select an explicit
compatible contract evolution. Adding a `relations` member to an existing V1
shape or reusing an old digest with new meaning is forbidden.

Here, current means the unversioned private Application revision generation.
Roadmap 49's `AA-R9-P` production-cutover preflight remains no-go. No relation
gate in this sequence adds a production caller, route, binding, fallback, or
comparison authority.

This reconciliation also freezes the first admitted profile:

```text
same-scope Flarex app tables
top-level nonlocalized source field
monomorphic one or many value
duplicate targets forbidden
reverse maximum cardinality many
target live in the final commit state
target-delete restrict
source-delete derived-edge cleanup
```

Nested paths, localization, polymorphism, repeated targets, reverse-one,
detach, cascade, cross-owner targets, populated results, caller-authored
cursors, and graph traversal remain outside the first profile. Their fields may
be reserved in canonical data, but analysis must reject them.

## API Ownership

### Standard Application Contract

The Standard layer owns explicit, serializable relation intent. It is inert and
contains no stable numeric IDs, physical table names, SQL, readiness state, or
execution authority.

The internal test and later developer producers may use that inert input to
generate the executable function-registration and schema modules. After their
authenticated Source Artifact V2 upload, the values loaded from those modules
are the analyzer's sole acceptance inputs. Standard intent is not read again
beside them during analysis, registration, readiness, or runtime selection.

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

The first function-runtime relation shape is one bounded incoming
occurrence/source-endpoint page for a target. It returns logical identities,
not populated documents, and accepts no caller-authored cursor. Forward IDs
continue to come from the authoritative source row. Source/target document
loading composes through ordinary point reads with their own dependencies.
Broader APIs remain absent until their exact snapshot, cursor, authorization,
and dependency semantics are proved.

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
For the first profile, many-valued relations forbid repeated targets and every
target must be live in the transaction's final material state.

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
Reverse-one itself is deferred beyond the first profile and requires a separate
incoming-claim, build, contention, and schema-evolution gate.

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

The first native profile forbids repeated target values. A later adapter that
admits repeated bare values must wait for a separately accepted duplicate-
occurrence contract and must not introduce a separate physical table.

## Physical Edge And Snapshot Storage

`R01-P` selects the exact-snapshot support before physical binding or DDL.
`S12` always adds current edges and also adds exactly one selected support:
edge revision history, or an endpoint adjacency version maintained atomically
with current edges. The conceptual current row contains:

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
policy, constraints, byte ceilings, canonical evidence, foreign keys, index
plans, and the selected snapshot-support tables/indexes.

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
selected exact-snapshot support
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
selected adjacency-version or edge-history action
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

For the first referential profile, lowering and commit validation inspect the
complete final material row set. Every relation target must be live in that
state. A target inserted in the same commit may satisfy the relation; a target
deleted in the same commit may not. This is final-state policy, not SQL
statement-order behavior.

## Referential Delete Behavior

A physical foreign-key cascade on the edge table is not a complete relation
policy because the authoritative source row could still contain a deleted
target ID.

The first supported target-delete policy is:

```text
restrict
```

It requires complete enabled incoming edge state before it may authorize a
delete check. Relation-bearing revisions do not activate before that evidence
is ready. Under the existing scope-clock transaction, a relation insertion
racing a target deletion serializes with the delete check; the later
incompatible commit fails instead of leaving a dangling reference.

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

`R01-P` must select and prove the physical viability of one exact-snapshot
support over current edges:

1. edge revision history plus an exact adjacency/range dependency; or
2. an atomically maintained adjacency
   `last_changed_commit_seq` for scope, edge definition, direction, and
   endpoint.

`O10-R` then implements one bounded incoming source/occurrence page using that
already selected support. For the adjacency-version option, a mutation must:

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
- deterministic bounded internal page/frontier semantics;
- phantom detection for inserts, removals, and retargets;
- the existing conflict replacement and deterministic user-code rerun owner.

The page returns only logical occurrence/source-endpoint identities. Document
loading is a separate point-read composition, and the first operation has no
caller-authored cursor. `R01-P` measures high-fanout contention, tenant skew,
prepared plans, index size, write amplification, churn/vacuum behavior, and
populated-history `EXPLAIN ANALYZE` results before selection. Commit-feed
scanning is not an automatic fallback.

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
validate the selected exact-snapshot support
settle physical enabled/readable state
include physical relation readiness in the application revision readiness root
hold the revision inactive until O10-R proves reverse-read/OCC behavior
```

The implementation should generalize the existing ordered-index and unique-key
build patterns: immutable definitions, scope-clock fencing, bounded cursors,
current-row revalidation, validation reset on relevant writes, replay safety,
and genuine-Postgres proof.

Before `E01` is complete, relation intent may exist only on an inactive
application revision. After E01, that revision remains inactive until O10-R
proves the mutation dependency/overlay. `RA01` may then use only the existing
activation owner to activate the private revision; RQ01 subsequently consumes
that active selection through the existing Standard query owner rather than
inventing candidate selection. The previously active revision retains its prior
non-relation meaning. No first-generation active relation may expose stored
relation semantics while incoming adjacency, reverse reads, or declared
target-delete restriction is disabled.

## Commit Feed And Reactive Invalidation

C09 first exposes deterministic adjacency actions inside the authoritative
commit plan. `R03` later projects every edge insert, remove, retarget, or
relevant reorder into typed adjacency change facts in that same scope commit.
Those facts identify the exact edge definition, direction, and endpoint and let
the sync engine invalidate relation subscriptions/live results without scanning
all source documents or broadly invalidating every query for a table.

Before R03 and the complete SV-R proof, relation-specific change feeds,
subscriptions, and live observation remain disabled and unclaimed. R03 does not
create a second edge commit stream or allow a caller to author system facts.

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

### [x] REL-P0 — Reconcile Current Authority And First Profile

Outcome:

- rebase relation analysis on authenticated executable function-registration/
  schema modules, Application Analysis, and the concrete Application Manifest/
  app-schema publication path;
- retain Canonical Declarative Program V1 only as an upstream authoring/code-
  generation compatibility input and Semantic Artifact V1 only as historical
  evidence/decoding; neither becomes post-load acceptance authority;
- freeze the narrow first profile recorded above and fail every broader shape;
- insert `R01-P`, `E01`, `RA01`, `RQ01`, `R03`, and `SV-R` into the controlling
  order;
- keep the native relation API distinct from the discussion-only trusted
  framework relational transaction/persistence SPI.

Exit gates:

- the accepted owner path contains one analysis and schema authority;
- current exact V1 contracts are not silently widened or reinterpreted;
- this checkpoint changes documentation only and does not approve R01 code,
  relation DDL, runtime behavior, public syntax, production cutover, or Payload
  work.

### [ ] R01 — Freeze Native Relation Semantics And Codecs

Outcome:

- freeze the Standard relation AST for same-scope, top-level, nonlocalized,
  monomorphic one/many values with duplicates forbidden, reverse-many, live
  targets, and target-delete restrict;
- freeze source required/min/max and ordering semantics, the top-level typed
  source-path codec, occurrence canonical bytes/SHA-256, position exclusion
  from identity, and resource ceilings;
- define the executable schema-module representation observed by Application
  Analysis and its one canonical analyzed relation projection;
- inventory every persisted/runtime `ApplicationManifestV1` and app-schema
  manifest consumer and select an explicit concrete contract evolution without
  changing an existing V1 meaning;
- reject nested, localized, polymorphic, repeated-target, reverse-one,
  detach/cascade, cross-owner, populated, cursor, and graph shapes during
  analysis;
- add internal test fixtures and golden vectors without adding storage or
  runtime execution.

Exit gates:

- every admitted relation has unambiguous semantics;
- internal test and prospective developer producers can lower to one exact
  Standard representation that generates the sole analyzed schema module;
- unsupported future fields cannot alias admitted occurrences or become
  executable merely because they are representable;
- digest collisions fail closed against retained canonical evidence;
- no Payload type, analyzer ordinal, or physical ID enters the Standard
  contract;
- old manifest/schema contracts remain exactly decodable for their retained
  consumers.

### [ ] R01-P — Select Snapshot Support And Access Paths

Prerequisite: R01 has frozen the exact first relation/read semantics.

Outcome:

- compare edge revision history with an atomically maintained endpoint
  adjacency version as alternative exact-snapshot supports over current edges;
- freeze one incoming source/occurrence page, its total order, internal consumed
  frontier, empty/exhausted meaning, ceilings, and no-external-cursor rule;
- measure high-fanout endpoints, tenant skew, representative distributions,
  prepared-plan behavior, index size, write amplification, churn/vacuum cost,
  and populated-history validation with genuine PostgreSQL
  `EXPLAIN ANALYZE`;
- select one support for S12/C09/E01/O10-R. Do not implement both, scan the
  commit feed, or defer the choice until after DDL.

Exit gates:

- the selected support can serve the exact snapshot and registration races
  within bounded lock-held work;
- its schema, read keys, maintenance actions, backfill/repair behavior, and
  physical-definition meaning are explicit inputs to R02;
- PGlite compatibility remains possible, while genuine PostgreSQL owns the
  production plan and contention evidence.

### [ ] R02 — Bind Relation And Edge Definitions Into Schema Lifecycle

Outcome:

- allocate stable relation IDs through the existing optimistic stale-plan
  discipline;
- consume the R01-frozen Application Manifest evolution so Application Analysis
  emits only canonical relation declarations and analysis-local ordinals, with
  no stable catalog or physical IDs;
- derive an explicitly evolved post-analysis app-schema binding from that exact
  manifest, then bind stable relation IDs, immutable semantic definitions,
  immutable physical edge definitions, and the selected snapshot support/read
  keys through the existing publication lifecycle;
- map analysis-local table/relation ordinals to stable deployment catalog IDs
  without treating those ordinal domains as equal;
- pin the analyzed-manifest and bound-publication digests together so later
  compiler/read/build owners cannot consume one without the other;
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
- analyzer ordinals never become deployment-stable catalog IDs;
- physically different definitions cannot alias;
- every edge, build, plan, and dependency can resolve exact immutable meaning;
- no second mutable definition authority exists.

### [ ] S12 — Add Stable Edge And Snapshot Storage

Prerequisite: R01, R01-P, and R02 are complete for the admitted subset.

Outcome:

- add private `fx_app_edge_current` plus only the snapshot-support storage
  selected by R01-P;
- retain canonical occurrence evidence and collision checks;
- add exact physical-definition-aware incoming access and maintenance paths;
- implement the frozen total page order and row/byte ceilings;
- add transaction-only repository primitives with no public edge CRUD or
  alternate snapshot fallback.

Exit gates:

- first-profile occurrence identity, reorder, source deletion, and cross-scope
  isolation pass;
- hash collisions cannot overwrite or conflate occurrences;
- every stored edge pins an exact physical definition;
- PGlite and genuine Postgres prove constraints and access plans.

### [ ] C09 — Lower Authoritative Rows Into Relation Sidecars

Prerequisite: the exact relation binding and edge repository exist.

Outcome:

- implement the pure prior/final row relation lowerer;
- integrate deterministic current-edge and selected snapshot-authority actions
  into the existing commit lane;
- remove stale occurrences for the exact maintained definition;
- require every target to be live in the final material row set, including
  same-commit target insert/delete behavior;
- serialize relation insertion/retarget against target-delete restrict through
  the existing scope-clock transaction; reverse-one remains deferred;
- preserve rollback, replay, result, feed, outbox, and idempotency atomicity.

Exit gates:

- insert, patch, replace, delete, retarget, reorder, and stale cleanup pass;
- repeated-target input rejects before sidecar publication;
- concurrent relation-insert versus target-delete and same-commit target final
  state pass without a dangling reference;
- old and replacement definitions do not cross-delete one another;
- injected failures roll back row and every sidecar together;
- relation reads remain disabled until their own proof.

### [ ] E01 — Build, Validate, And Enable Edge Definitions

Prerequisite: S12 and C09 are complete.

Outcome:

- add scope-fenced bounded build/readiness state;
- backfill existing rows through the same canonical lowerer;
- build and validate the selected snapshot support through the same
  fenced lifecycle;
- revalidate current rows and reset validation under relevant concurrent
  commits;
- prove complete expected current contents;
- settle enabled/readable evidence and fold it into revision readiness.

Exit gates:

- existing rows cannot be omitted from reverse reads or delete restrictions;
- concurrent writes cannot escape the validation frontier;
- replay, rollback, stale schema, replacement definitions, and corrupted edges
  fail closed;
- E01 emits physical readiness only and does not activate the relation-bearing
  revision;
- activation remains blocked until O10-R closes and cannot expose an unready
  definition or a relation whose reverse/read/restrict semantics are disabled.

### [ ] O10-R — Prove One Exact Relation Read

Prerequisite: E01 has enabled the selected edge definition and its R01-P
snapshot support.

Outcome:

- implement one bounded incoming source/occurrence page using the R01-P
  support;
- add exact snapshot registration, deterministic internal frontier semantics,
  complete read-your-writes, phantom validation, and OCC rerun composition;
- return logical identities only; compose any document loading through ordinary
  point reads and accept no external cursor;
- add only the required function-runtime and journal/dependency representation.

Exit gates:

- changes before, during, and after dependency registration conflict correctly;
- staged insert/update/delete/retarget operations overlay correctly;
- partial pages and empty/exhausted pages have exact dependencies;
- unsupported relation, graph, filter, and pagination shapes fail before target
  data I/O.

### [ ] RA01 — Activate One Private Relation Revision

Prerequisites: E01 has settled complete physical readiness and O10-R has proved
the incoming dependency/overlay for the exact bound relation publication.

Outcome:

- after O10-R closes as a roadmap proof, invoke only the existing Application
  activation owner with the exact analyzed manifest, R02 bound publication, and
  persisted readiness evidence; O10-R is not caller-authored activation input;
- make forward storage, current incoming reads, and `restrict` enforcement
  available together for one private relation-bearing revision;
- add no candidate query path, second activation head, route, binding,
  production caller, fallback, or comparison authority.

Exit gates:

- the existing active-revision selection resolves the exact relation binding
  that E01/O10-R proved;
- stale readiness, head movement, mismatched binding, or missing relation
  evidence fails closed under the existing activation CAS;
- relation-specific subscriptions/live observation remain absent until R03 and
  the full SV-R proof; roadmap 49's production-cutover decision remains no-go.

### [ ] RQ01 — Compose One Read-Only Standard Relation Query

Prerequisite: RA01 has activated the private relation-bearing revision after
O10-R proved the logical incoming page and selected snapshot reader.

Outcome:

- expose that same logical incoming identity page through the existing
  active Application query snapshot and Standard invocation owners;
- keep document point loading separate and validated;
- add no mutation journal, OCC commit dependency, write authority, public route,
  caller cursor, population depth, or alternate query engine.

Exit gates:

- one private Standard query returns the exact bounded snapshot result in
  PGlite and genuine PostgreSQL;
- malformed, stale, unready, oversized, populated, cursor, filter, and graph
  shapes reject before application-row loading;
- query execution publishes no row, edge, result, commit, feed, or outbox
  mutation.

### [ ] R03 — Relation Change Facts And Sync Invalidation

Prerequisite: C09 exposes deterministic adjacency actions and RQ01 proves the
read-only logical dependency shape that sync will observe.

Outcome:

- publish typed incoming/outgoing adjacency changes from C09 actions in the
  existing scope commit;
- enable relation dependency registration at an exact scope-commit-fenced
  baseline: earlier changes are observed through a fresh snapshot, and every
  later relevant change has a typed fact;
- allow the sync owner to register relation dependencies and invalidate live
  results without a second commit stream;
- freeze retention and reconnect behavior before production relation
  subscriptions.

Exit gates:

- a change before the registration fence is visible in the fresh query snapshot,
  while every relevant change after it invalidates the dependency;
- reconnect across retained and expired fact history follows one fail-closed
  resnapshot policy;
- no relation-specific observer is admitted before the fenced baseline and fact
  publication path are both ready.

### [ ] SV-R — Internal Standard Relation Vertical

Prerequisite: R01 through R03, including R01-P, E01, O10-R, RA01, and RQ01,
are complete for the admitted profile.

Outcome:

- use the internal test producer to define, analyze, register, ready, activate,
  invoke, commit, query through RQ01, and observe one real relation-bearing
  application;
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
- The first high-level supported profile is frozen by REL-P0, while its exact
  AST, codecs, budgets, and manifest contract evolution remain R01 work.
- The exact physical identity spelling, DDL, index order, internal page
  frontier, build table, and snapshot support remain intentionally deferred
  to R01-P and their downstream owning gates.
- Cross-owner references to Medusa or other external resolvers require separate
  existence, deletion, staleness, and transaction participation contracts.
- Payload relation behavior remains adapter conformance work and does not block
  the native R01 contract from being designed independently.
