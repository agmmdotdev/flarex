# FlarexDB Native Relational Foundation Contract

Status: `R01` and the physical snapshot/access preflight `R01-P` completed on
2026-08-23; `R02` stable binding, `S12` private edge storage, and `C09` private
point-commit lowering completed on 2026-08-24. No relation runtime read or OCC
registration, E01 build/readiness, RA01 activation, RQ01 query, public
developer API, or Payload adapter is implemented.

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
  = atomically maintained endpoint adjacency last-changed versions

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
`R01` selected an additive concrete contract evolution: zero-relation analysis
still emits exact `ApplicationManifestV1`, while relation-bearing analysis emits
`ApplicationManifestV2` with `schema.version = 2` and canonical analyzed
relation entries. The normal semantic boundary is the unversioned
`ApplicationManifest` union and its unversioned canonicalizer/manifest maker;
the numeric suffixes remain only on the two exact envelopes that must coexist
and decode independently. V1 is still active and is therefore not called
legacy. The authenticated analysis host accepts and validates both envelopes.
Persisted publication, readiness, activation, and runtime consumers remain
V1-only, and `SchemaManifestAppSchemaV1` remains unchanged; `R02` owns their
explicit relation-bearing binding evolution. Adding `relations` to either V1
shape or reusing an old digest with new meaning remains forbidden.

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

The current private semantic API is
`@flarex/standard-application-definition/internal/relation-definition`.
Its unversioned preparation and source-production operations accept exact
`RelationDeclarationV1` data and generate the sole executable schema module.
The declaration contract is:

```text
format = flarex.relation-declaration
version = 1
source = { table, path: [{ kind: field, name }], forwardName }
target = { table }
value = { cardinality: one, required }
     or { cardinality: many, minItems, maxItems, ordered,
          duplicates: forbid }
inverse = { cardinality: many, name: string | null }
localized = false
onTargetDelete = restrict
```

The source path field and forward name must be identical. Identity strings are
nonempty and at most 256 UTF-16 code units; a declaration set contains at most
1,024 declarations; one declaration's canonical JSON is at most 8,192 bytes;
and a many value has `0 <= minItems <= maxItems <= 1,024` with positive
`maxItems`. The exact input expresses:

```text
source logical table
canonical typed source path
forward logical name
one target logical table
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
implicitly equivalent. Completed `R01` admits only `localized: false` and
rejects locale fields in occurrence identity. Any future localized profile must
freeze its distinct canonical representation before its own DDL.

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

`R01` freezes the pre-binding occurrence identity as exact
`RelationOccurrenceV1` data:

```text
format = flarex.relation-occurrence
version = 1
sourceDocumentId = AppDocumentIdV1
sourcePath = RelationSourcePathV1
targetDocumentId = AppDocumentIdV1
duplicateOrdinal = 0
```

The strict envelope has no position, locale, relation ID, physical edge ID, or
future nesting field. Canonical JSON is capped at 8,192 bytes and its injected
SHA-256 capability must return exactly 32 bytes. Both canonical bytes and the
digest are defensively owned. Equal digests with unequal retained canonical
bytes fail closed as a collision; byte-identical evidence with unequal digests
fails closed as inconsistent evidence. `R02` may bind this occurrence under a
stable relation and physical edge definition without changing these bytes.

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

`R01-P` selected endpoint adjacency versions before physical binding or DDL.
`S12` adds current edges plus that support, maintained atomically with current
edges. Edge revision history is rejected for this generation. The conceptual
current row contains:

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
adjacency-version action
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

`R01-P` selected an atomically maintained endpoint adjacency
`last_changed_commit_seq` over current edges. Immutable edge-occurrence history
is rejected for this generation; it is not a fallback, comparison write, or
second read path. `O10-R` implements one bounded incoming source/occurrence page
using the selected support. A mutation read must:

```text
read adjacency version before the edge page
require version <= SnapshotToken.commitSeq
read the current page
read adjacency version again
require equality and version <= snapshot
register that exact dependency
validate it unchanged inside final commit
```

The absent-version sentinel is `0`. The final validation first locks the
existing scope clock, then compares the stored endpoint version with the exact
dependency. Every current-edge writer locks that same scope clock before it
changes current edges or versions. This closes both present-row and
absent-to-present registration races without holding a relation lock while user
code runs. A mismatch or version newer than the snapshot uses the existing OCC
attempt replacement and deterministic user-code rerun; it never reconstructs
from commit-feed or edge-history rows.

The admitted current occurrence identity is symbolically:

```text
(scope, physical edge definition, source row, target row, duplicate ordinal)
```

The physical edge definition already fixes the top-level source path, source
and monomorphic target tables, occurrence codec, and ordered meaning. Position
is nullable mutable ordering metadata, never occurrence identity. The frozen
current-edge access paths are:

```text
outgoing equality: (scope, edge definition, source row)
outgoing order:    (target row, duplicate ordinal)
incoming equality: (scope, edge definition, target row)
incoming order:    (source row, duplicate ordinal)
```

The frozen projection for both paths includes position and commit provenance in
addition to their key columns. The R01-P plan proof is for the admitted incoming
page; it does not claim an outgoing index-only scan. Canonical occurrence
bytes/SHA-256 remain retained collision evidence, but are not pagination-order
fields and need not be copied into an access index. `R02` binds the symbolic
identities to stable catalog and row-ID types; `S12` owns exact DDL spelling,
covering-index decisions, and native compact/UUID representation.

One incoming storage page returns at most `128` logical source/occurrence
identities and reads at most `129` current rows for lookahead. Its internal
consumed frontier is the last `(source row, duplicate ordinal)` inspected under
the bound scope/definition/target equality prefix. Exhausted means every
returned base row was consumed and no lookahead exists: zero rows and an exact
full page without lookahead are both exhausted, while a full page with a
lookahead row is not. One transaction may consume at most `4,096`
base relation occurrences across relation calls. There is no caller-authored
cursor. `O10-R` must compose the transaction-local overlay without weakening
these base-row, frontier, or total-work ceilings.

The selected version key is:

```text
(scope, physical edge definition, direction, endpoint row)
  -> last_changed_commit_seq
```

Within one scope commit, `C09` advances each affected endpoint at most once to
that commit sequence, in the same transaction as current edges and all existing
commit facts. Insert advances outgoing source and incoming target; removal
advances outgoing source and old incoming target; retarget advances outgoing
source plus old and new incoming targets; position/order or occurrence-evidence
change advances every direction whose logical projection changed; source delete
advances its outgoing endpoint and every affected incoming target. Values never
decrease. Transaction rollback rolls back current-edge and version changes
together.

Backfill and repair never rewrite an enabled definition invisibly. `E01` builds
an inactive physical edge definition at fixed scope frontier `F`, creates its
current edges, initializes every nonempty endpoint version to `F`, validates the
whole definition, and only then makes it eligible for activation. Empty
endpoints remain absent/`0`. Stale and replacement definitions coexist because
the physical edge definition is part of every key. A repair rebuilds an
inactive replacement definition/generation; rollback discards that candidate or
reactivates the independently keyed predecessor. Adjacency versions are retained
until their physical definition passes normal retirement pins; they have no
O11 retained-history floor or anchor.

The read also requires:

- complete transaction-local read-your-writes overlay;
- deterministic bounded internal page/frontier semantics;
- phantom detection for inserts, removals, and retargets;
- the existing conflict replacement and deterministic user-code rerun owner.

The page returns only logical occurrence/source-endpoint identities. Document
loading is a separate point-read composition. The R01-P receipt below owns the
physical selection; commit-feed scanning is not an automatic fallback.

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

### [x] R01 — Freeze Native Relation Semantics And Codecs

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

Implementation receipt (2026-08-23):

- `flarex-protocol` owns strict `RelationDeclarationV1` and
  `RelationOccurrenceV1` codecs, canonical vectors, resource ceilings,
  defensive byte ownership, injected SHA-256, and fail-closed collision
  comparison through internal contract subpaths;
- Standard Application owns unversioned relation preparation and one private
  relation-bearing source producer. It canonicalizes, sorts, owns, and freezes
  declarations, rejects duplicates, and emits the existing `defineSchema`
  result wrapped with canonical `relations`. The established zero-relation
  producer and generated bytes remain exact;
- the relation-aware Application Analysis operation validates source and target
  tables, top-level validator compatibility, required one versus required
  many-array shape, duplicate source paths, inverse/field collisions, and
  duplicate target inverse names. It emits deterministic dense one-based
  analysis-local relation and table ordinals only;
- the unversioned manifest operation emits exact `ApplicationManifestV1` for
  zero relations and strict `ApplicationManifestV2` for relation-bearing
  analysis. V2 retains the V1 source, function, table, and index projections,
  uses `schema.version = 2`, adds only canonical analyzed relations, enforces
  the existing one-MiB manifest ceiling, and has a strict V1/V2 union decoder;
- the authenticated analysis Worker core and host cold-load the generated
  relation schema twice, validate the canonical union, and reject unsupported
  declarations through the existing `invalidSchema` classification. The
  analyzer policy identity and generated-core identity changed accordingly;
- existing publication persistence, schema-manifest, readiness, activation,
  and runtime materialization remain V1-only and fail closed for relation
  manifests. Their relation-bearing evolution belongs to `R02`; no relation
  identity, DDL, commit behavior, runtime read, route, fallback, or public API
  entered this checkpoint.

Evidence: protocol, Standard definition, analysis, boundary-guard, analyzer
unit, deterministic generated-core, and real Miniflare cold-load suites cover
strictness, limits, ordering, mutation isolation, V1 exactness, V2 selection,
invalid shapes, canonical evidence, hash-service failures, forced collisions,
and the generated Standard-to-analyzer path.

R01 consumer inventory:

- union-aware now: `packages/analysis/src/applicationAnalysis.ts`,
  `packages/analysis/src/applicationAnalysisV2.ts`, and the analyzer Worker core
  and host;
- V1-only analysis registration: `apps/analyzer/src/ApplicationAnalysisComposition.ts`,
  `packages/standard-application-analysis/src/application.ts`, and
  `packages/persistence-postgres/src/applicationAnalysisRegistration.ts`;
- V1-only publication/lifecycle: analysis `applicationPublicationFramesV1` and
  persistence `applicationPublication`, `applicationSchemaAuthority`,
  `applicationReadiness`, `applicationActivation`, `applicationActionAdmission`,
  `applicationActionAuthorityV1`, `applicationMutationAdmission`,
  `applicationQuerySnapshot`, and `storedCommitAuthority` model/materialization;
- V1-only runtime/invocation: executor stored-commit authority, backend
  `ApplicationWorkerDefinition`, `ApplicationRuntimeSourceAuthority`,
  `ApplicationRuntimeMaterializer`, and `ApplicationActionRunner`, plus Standard
  `ApplicationActionHostComposition`, `ApplicationMutationSystem`, and
  `ApplicationQuerySystem`;
- unchanged `SchemaManifestAppSchemaV1` protocol/compiler consumers:
  `schema-manifest`, `app-schema-catalog`, and `point-mutation-start`;
- unchanged schema-manifest persistence/evolution consumers: persistence
  `schema`, `schemaManifestAppSchemaBindings`, `schemaManifestValueSnapshot`,
  `appSchemaPublicationTransaction`, `applicationSchemaAuthority`,
  `appSchemaCandidateValidation`, and `indexBuildReconciliation`, plus managed
  schema `CandidateDocument`, `Compatibility`, and `Planning`;
- unchanged schema-manifest activation/read/commit consumers: persistence
  `applicationRevisionActivationV1`, `applicationRevisionActiveSelectionStateV1`,
  `applicationRevisionSyscallValidatorV1`,
  `applicationRevisionSyscallValidatorStateV1`,
  `applicationPointQuerySnapshotV1`, and stored-commit model/materialization,
  plus executor stored-attempt authentication and its commit-authority/input
  verifiers.

Every V1-only group remains fail-closed in R01. `R02` must evolve the exact
post-analysis binding and its consumers together; no union-aware host result
may be persisted by merely stripping relations or decoding it as V1.

### [x] R01-P — Select Snapshot Support And Access Paths

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

Completion receipt (2026-08-23):

- The retained private harness is
  `packages/persistence-postgres/test/relationSnapshotSupportPreflight.ts`,
  with a seven-case PGlite semantic lane and a fail-closed PostgreSQL physical
  lane. Its candidate tables are created only inside a disposable schema; no
  production migration, package export, runtime caller, compiler, or reader was
  added.
- The selecting run used a fresh disposable schema on a dedicated exclusive
  PostgreSQL `18.3` cluster with default planner mode, `random_page_cost = 4`,
  `full_page_writes = on`, and `wal_compression = off`. The deterministic
  profile contained `33,179`
  current edges, `49,051` history revisions, `33,500` adjacency-version rows,
  a `20,000`-source hot endpoint, 64 ordinary endpoints of fanout 32, eight
  skewed scopes, `1,024` churn mutations, and four prewarmed 8-writer by
  16-write contention trials. History was represented fairly as one immutable
  row per occurrence revision plus one incoming snapshot index; it was not
  doubled into separate incoming and outgoing rows. Of the history rows,
  `512` identities retained 32 revisions each.
- Distinct initial and after-frontier query shapes prevented nullable-cursor
  filters. Automatic and forced-generic prepared plans for both shapes used
  only the intended indexes, with one loop, no filtered rows, no sort, and no
  candidate-table sequential scan. The retained-history hot page returned its
  513-candidate ceiling but
  scanned `16,385` physical revisions, used 205 shared-hit blocks, and took
  `2.800 ms`; its work grew with retained depth. The selected initial and
  near-tail resumed current-edge pages each read 129 rows using 5 blocks in
  `0.034 ms` and `0.046 ms`, respectively; the version point read one row using
  4 blocks in `0.020 ms`. These local timings are diagnostic, not an SLA.
- Before churn, candidate-only total storage was `12,402,688` bytes for edge
  history versus `5,160,960` bytes for adjacency versions; the shared current
  edge table/indexes were `7,077,888` bytes and are not charged to either
  candidate.
- Each exclusive WAL round used exactly 256 inserts, 256 deletes, 256
  retargets, and 256 reorders. Required preexisting candidate state was seeded
  before the starting LSN; shared current-edge writes, scope-clock writes, and
  all other shared row writes were excluded from both candidate deltas. Each
  candidate delta included the same one batch-transaction commit record,
  amortized across its 1,024 logical mutations. Three alternating rounds
  averaged `533.284` bytes per history mutation versus `515.141` per
  adjacency-version mutation.
- The naked hot endpoint showed the expected adjacency-row tradeoff (`4.255 ms`
  p95 versus history's `2.283 ms`). Under the production-relevant existing
  scope-clock-first lock, all 128 transactions completed and the candidates
  remained within the accepted 2x boundary: `57.476 ms` total and `9.271 ms`
  p95 for adjacency versus `53.861 ms` and `7.485 ms` for history. The version
  row therefore adds no wider lock domain while scope commits remain
  serialized.
- Churn produced an approximate `6,108` dead adjacency tuples before ordinary
  `VACUUM (ANALYZE)` and zero afterward. History avoided update garbage but
  grew append-only. After churn and ordinary vacuum, candidate storage was
  `14,278,656` bytes for history versus `6,283,264` bytes for versions;
  ordinary vacuum correctly reused space rather than shrinking files.
- Across the PostgreSQL and PGlite lanes, the proof covers current-page parity,
  old-snapshot history reconstruction versus conservative version conflict,
  insert/delete/retarget/reorder behavior, empty/exhausted and bounded frontier
  semantics, rollback, stale-definition isolation, and present/absent version
  races. A coordinated
  final-validation proof captured expected version `0`, let a writer hold the
  scope clock with version `2`, observed final validation block behind that
  writer, and rejected the stale dependency after acquiring the clock. A
  genuine-PostgreSQL transaction also proved that current edges, history, scope
  clock, and versions remain invisible together after rollback.

Selection: endpoint adjacency version wins. It preserves a direct bounded
current-edge read, uses materially less storage and slightly less WAL in the
fair mixed workload, and its only losing dimension—the naked hot-row lock—does
not widen the accepted scope-clock commit serialization. Edge history loses on
retained size and depth-amplified reconstruction while solving an
older-snapshot case that the existing OCC rerun owner can safely reject and
rerun.

Reopen R01-P before changing production storage only if at least one of these
boundaries changes:

- commits that can affect one endpoint cease to serialize through the same
  scope-clock-first transaction;
- a supported caller must return an older relation snapshot instead of taking a
  typed OCC conflict and deterministic rerun;
- page/fanout/work limits exceed the measured `128`/`20,000`/`4,096` profile;
- an enabled definition must be repaired in place without a newly advancing
  authoritative commit sequence or replacement physical definition; or
- three alternating exclusive PostgreSQL trials on the proposed production
  schema show adjacency-version total storage or WAL no better than history, or
  scope-serialized p95/total completion more than `2x` history.

Reopening is a new preflight, not permission to ship dual writes, retain edge
history as fallback, or scan the commit feed.

### [x] R02 — Bind Relation And Edge Definitions Into Schema Lifecycle

Status: completed on 2026-08-24.

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

Accepted implementation shape:

- consume only the durable canonical `ApplicationManifestV2` and its recorded
  digest; never accept a second relation declaration or reinterpret V1;
- preserve the exact V1 schema-publication frame, table/index-only
  `SchemaManifestAppSchemaV1`, and binding bytes, while adding concrete V2
  schema-publication and application-schema-binding envelopes behind
  unversioned semantic dispatchers;
- pin complete semantic and physical definition bodies, their domain-separated
  canonical digests, stable IDs, analysis-local ordinals, compatibility
  receipts, and table/index binding evidence in the reusable V2 bound-schema
  envelope. Retain the exact canonical V2 schema-frame bytes in its immutable
  root as collision evidence. A separate immutable manifest-schema commitment
  retains the exact canonical manifest bytes and pins their digest to the exact
  schema digest, schema version, and bound-publication digest, so function-only
  changes reuse the same bound schema without losing collision evidence;
- persist only the stable relation catalog, immutable edge-definition catalog,
  per-schema relation binding, bound-schema root, and manifest-schema
  commitment as normalized projections. The semantic body remains solely in
  the V2 bound publication;
- require an explicit prior schema/relation coordinate to preserve a logical
  relation, and an explicit compatible-reuse decision to reuse a physical
  definition. An identical physical replacement fails closed. Exact replay is
  idempotent; name or shape similarity never decides identity;
- derive physical meaning from stable source/target tables, the exact source
  path, scalar-versus-array extraction, nonlocalized representation, forbidden
  duplicates, nullable position retention, occurrence codec V1, selected
  current-edge keys, and endpoint-adjacency-version snapshot semantics;
- use optimistic high-water planning followed by locked revalidation in one
  short control-database transaction, retaining canonical bytes anywhere a
  digest can select identity; and
- bound the new canonical publication at 16 MiB. Readiness's existing 1 MiB V1
  frame ceiling is not reused for this larger compatibility envelope.

This gate may make Application Analysis V2 durable and expose a private binder.
It does not wire relation-bearing located-scope publication, readiness,
activation, runtime reads, edge/OCC storage, routes, or a public API.

Exit gates:

- exact replay preserves identities;
- logical, semantic, and physical identities cannot be confused;
- analyzer ordinals never become deployment-stable catalog IDs;
- physically different definitions cannot alias;
- every edge, build, plan, and dependency can resolve exact immutable meaning;
- no second mutable definition authority exists.

Completion receipt (2026-08-24):

- Durable Application Analysis now accepts the exact V1/V2 manifest union and
  invokes one private post-analysis binder. Zero-relation V1 remains current;
  relation-bearing V2 is never stripped or reinterpreted as V1.
- Migration `0069_stale_landau.sql` adds only the stable relation catalog,
  immutable physical edge-definition catalog, per-schema relation binding,
  reusable bound-schema root, and manifest-to-bound-schema commitment. The
  canonical bound publication remains the sole semantic-definition body.
- Replay, explicit preservation, compatibility classification, physical
  reuse/replacement, collision evidence, atomic rollback, stale-plan
  convergence, origin provenance, and JSONB normalization are covered in
  PGlite and genuine PostgreSQL.
- The first isolated-schema PostgreSQL run caught Drizzle Kit's generated
  `REFERENCES public...` qualifiers in migration 0069. Removing those
  qualifiers preserved the repository's selected-`search_path` migration
  contract; the three R02 PostgreSQL files then passed `9/9` on a disposable
  PostgreSQL `18.3` instance.
- The repeatable `test:r02:pglite` and `test:r02:postgres` package commands own
  the focused gate, and the generic PostgreSQL persistence sweep includes both
  new R02 PostgreSQL files.
- Located-scope publication, readiness, activation, runtime reads, edge/OCC
  storage, routes, fallbacks, and public APIs remain outside R02.

### [x] S12 — Add Stable Edge And Snapshot Storage

Prerequisite: R01, R01-P, and R02 are complete for the admitted subset.

Status: completed on 2026-08-24.

Outcome:

- add private `fx_app_edge_current` plus only the snapshot-support storage
  selected by R01-P;
- retain canonical occurrence evidence and collision checks;
- add exact physical-definition-aware incoming access and maintenance paths;
- implement the frozen total page order and row/byte ceilings;
- add transaction-only repository primitives with no public edge CRUD or
  alternate snapshot fallback.

Accepted storage and repository shape:

- add exactly `fx_app_edge_current` and
  `fx_app_edge_adjacency_version`; do not add an edge revision/history table;
- keep occurrence identity in the current-edge primary key as
  `(scope_uuid, edge_definition_id, source_row_id, target_row_id,
  duplicate_ordinal)`, so the primary key is also the outgoing equality-prefix
  and total-order access path;
- add the incoming covering index in the exact order
  `(scope_uuid, edge_definition_id, target_row_id, source_row_id,
  duplicate_ordinal) include (position, commit_seq)`;
- retain the stable relation ID, exact immutable edge-definition ID,
  source/target table IDs, occurrence codec version, canonical occurrence
  bytes, SHA-256 digest, explicit absent locale, nullable position, schema
  version, epoch, and commit provenance on every current edge;
- constrain row IDs to 16 bytes, occurrence codec/duplicate ordinal to the
  accepted V1 contract, canonical occurrence bytes to `1..8192`, digests to 32
  bytes, locale to `NULL`, array position to `0..1023`, and catalog IDs/commit
  sequence to their positive native ranges;
- key endpoint versions by
  `(scope_uuid, edge_definition_id, direction, endpoint_row_id)`, persist only
  positive `last_changed_commit_seq` values, and interpret an absent row as the
  frozen zero sentinel;
- foreign-key both tables only to the target-local scope clock. Stable control
  catalog IDs cannot be protected by a cross-database foreign key, current
  edges must not pin old source-row revisions indefinitely, target liveness is
  C09 final-material authority, and adjacency-version rows must survive an
  empty endpoint;
- keep the implementation under the private `appRelationEdges` persistence
  domain. Its aggregate mutation operation accepts the caller-owned metadata
  transaction, locks the existing scope clock first, applies at most 4,096
  exact put/remove/reorder actions, and advances each affected incoming or
  outgoing endpoint version once per scope commit;
- validate exact physical-definition and canonical-occurrence agreement before
  SQL, compare retained bytes whenever a digest selects identity, map foreign
  database failures once into a typed persistence error, and never treat a
  uniqueness error as successful replay; and
- expose a bounded physical incoming-page primitive only for storage and plan
  proof: at most 128 logical identities, one 129th-row lookahead, the internal
  `(source_row_id, duplicate_ordinal)` frontier, and version-before/page/
  version-after evidence. O10-R still owns snapshot eligibility, dependency
  registration, final OCC validation, read-your-writes, and any runtime read.

The repository input is package-private physical storage evidence, not a new
located-scope publication authority. S12 does not add a production locator or
claim that raw IDs authorize a write; C09 consumes the authenticated bound
definition through its separately approved integration boundary.

Exit gates:

- first-profile occurrence identity, reorder, source deletion, and cross-scope
  isolation pass;
- hash collisions cannot overwrite or conflate occurrences;
- every stored edge pins an exact physical definition;
- PGlite and genuine Postgres prove constraints and access plans.

Completion receipt:

- Migration `0070_far_vengeance.sql` installs exactly the selected current-edge
  and endpoint-version tables; no edge history or comparison path exists.
- The private transaction aggregate owns complete-batch validation, fixed-size
  set operations, savepoint rollback for captured typed failures, exact
  occurrence evidence, coalesced versions, and the frozen 128-plus-lookahead
  incoming page.
- PGlite passed `45/45`; PostgreSQL `18.3` passed `4/4`, including a populated
  25,000-edge skew, bounded automatic and forced-generic resumed-page plans,
  scope-lock serialization, and the exact 4,096-occurrence write ceiling.
- C09 now consumes S12 only through the authenticated R02 definition and
  point-commit boundary. Neither slice changed OCC, journals, commit/change
  feeds, outbox behavior, authoritative application-row semantics, runtime
  reads, or public APIs.

### [x] C09 — Lower Authoritative Rows Into Relation Sidecars

Prerequisite: the exact relation binding and edge repository exist.

Status: completed privately on 2026-08-24 behind the authenticated point-commit
composition. It remains production-inert and uncomposed from relation-bearing
readiness, activation, and reads.

Accepted lowerer and final-state policy:

- One private `applicationRelationCommit` owner consumes the complete canonical
  R02 binding and pairs each stable relation binding with its exact semantic and
  immutable physical definition. Analyzer ordinals, field names by themselves,
  raw catalog IDs, and caller-authored actions are never write authority.
- The pure input is the prior authoritative document, final authoritative
  document or tombstone, source identity, and exact paired definition. It
  accepts only the frozen top-level, nonlocalized, monomorphic, reverse-many,
  duplicate-free, target-live, `restrict` profile; optional scalar absence is
  distinct from an invalid value, arrays retain zero-based position metadata
  even when semantic ordering is false, and target document IDs must name the
  bound target table.
- Preparation validates required/minimum/maximum cardinality, repeated targets,
  occurrence identity, and exact physical/semantic agreement before target or
  sidecar SQL. It admits at most 4,096 prior occurrences, 4,096 final
  occurrences, 4,096 emitted S12 actions, and 4,096 distinct final target
  checks, plus at most 4,096 exact deleted-target/definition `restrict` probes.
  A maximum-plus-one case fails during preparation.
- Actions are deterministic and sorted by immutable edge definition, source,
  target, and action phase. A retained target with changed list position emits
  only reorder; retarget emits remove plus put; source deletion removes its
  exact outgoing occurrences; and no action for one physical definition can
  delete another definition's edge.
- Target liveness first overlays every same-commit row intent, so a live target
  inserted in that commit succeeds and a final tombstone fails regardless of
  SQL statement order. Remaining distinct targets are resolved in one bounded
  set against the authoritative current-row pointer and exact revision in the
  same scope. Missing, tombstoned, wrong-table, other-scope-only, duplicate, or
  incomplete evidence fails closed.
- After the edge delta is applied but before commit publication, every deleted
  target is checked against every exact bound definition that targets its table.
  One S12-owned, index-backed `LIMIT 1` incoming-existence query per checked
  endpoint observes the final transaction-local edge set. This naturally
  accounts for removals, retargets, and puts in the same commit without an
  unbounded incoming scan. The primitive is private writer policy, not a
  runtime page or O10-R dependency.
- C09 exposes no runtime incoming/outgoing page, cursor, relation dependency,
  change fact, readiness receipt, activation capability, public export,
  Payload/Medusa adapter, reverse-one claim, localization, nesting,
  polymorphism, `detach`, `cascade`, edge history, comparison write, or fallback.

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

- The private Standard source, authenticated Application Analysis host, and
  durable R02 binder admit `RelationDeclarationV1`, but located-scope
  publication, readiness, activation, and production routing do not.
- Stable relation and immutable physical edge-definition catalogs are
  implemented. No edge-occurrence table, edge build state, compiler lowering,
  adjacency-version storage, relation read, or relation sync dependency is
  implemented.
- The first high-level profile and its exact declaration/occurrence codecs,
  budgets, Standard source representation, analyzed projection, and manifest
  evolution are frozen by completed `R01`.
- R02 freezes exact physical-definition identity and snapshot/access meaning.
  Edge-occurrence DDL, access-index spelling, internal page implementation,
  build tables, and adjacency-version storage remain owned by S12 and later
  gates.
- Cross-owner references to Medusa or other external resolvers require separate
  existence, deletion, staleness, and transaction participation contracts.
- Payload relation behavior remains adapter conformance work and does not block
  the native R01 contract from being designed independently.
