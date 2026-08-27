# FlarexDB Native Relational Foundation Contract

Status: `R01` and the physical snapshot/access preflight `R01-P` completed on
2026-08-23; `R02` stable binding, `S12` private edge storage, and `C09` private
point-commit lowering completed on 2026-08-24. The preflighted `E01-A` private
physical builder and per-attempt readiness evidence are also complete at the
system-core boundary. The `E01-B` system-core checkpoint now provides private
semantic readiness, exact ordered relation-set evidence, a production-inert
serving-state guard, and the relation-aware Application readiness fold for an
inactive Application with an empty function catalog. E01 is complete at that
private, production-inert boundary. `O10-R` completed on 2026-08-25 with the
exact incoming relation read, journal dependency, read-your-writes overlay,
final OCC validation, and durable running-conflict takeover. Nonempty function
catalogs fail closed at an explicit runtime-availability gate. `RA01` completed
on 2026-08-26: the activation-owned core now preserves one private active
relation revision while replacement candidates are prepared, advances the
single existing head across exact Legacy/relation transitions, and proves both
activation-versus-builder lock orders. No RQ01 query, public developer API, or
Payload adapter was part of RA01. `RQ01` completed separately on 2026-08-26:
the private Standard system core now exposes one direct, read-only logical
incoming-relation query while retaining the empty-function readiness gate. No
public developer API, Worker relation runtime, or Payload adapter is implemented.

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
and decode independently. The authenticated analysis host accepts and validates
both envelopes. The concrete version 1 envelope remains an active compatibility
contract, while displaced product implementations use `Legacy...` names.
Current unversioned R02/E01/RA01 persistence owners are relation-aware and
retain the exact version 1 publication/readiness rows and activation frames.
Standard runtime consumers remain Legacy-only and reject relation activation;
the private O10-R relation read is a separate exact system-core composition.
`SchemaManifestAppSchemaV1` remains unchanged. Adding `relations` to either
version 1 shape or reusing an old digest with new meaning remains forbidden.

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
cursor. `O10-R` composes the transaction-local overlay without weakening
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
hold the revision inactive for RA01 after O10-R proves reverse-read/OCC behavior
```

The implementation should generalize the existing ordered-index and unique-key
build patterns: immutable definitions, scope-clock fencing, bounded cursors,
current-row revalidation, validation reset on relevant writes, replay safety,
and genuine-Postgres proof.

Before `E01` is complete, relation intent may exist only on an inactive
application revision. E01 and O10-R are now complete, and that revision remains
inactive until `RA01` uses only the existing activation owner to activate the
private revision. RQ01 subsequently consumes that active selection through the
existing Standard query owner rather than inventing candidate selection. The
previously active revision retains its prior non-relation meaning. No first-
generation active relation may expose stored relation semantics while incoming
adjacency, reverse reads, or declared target-delete restriction is disabled.

## Commit Feed And Reactive Invalidation

C09 first exposes deterministic adjacency actions inside the authoritative
commit plan. Completed `R03-A` projects every edge insert, remove, retarget, or
relevant reorder into typed adjacency change facts in that same scope commit.
Those facts identify the exact edge definition, direction, and endpoint and let
the sync engine invalidate relation subscriptions/live results without scanning
all source documents or broadly invalidating every query for a table.

Before R03-B and the complete SV-R proof, relation subscriptions and live
observation remain disabled and unclaimed. R03-A adds typed children to the
existing commit feed; it does not create a relation-specific stream or allow a
caller to author system facts.

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

### [x] E01 — Build, Validate, And Enable Edge Definitions

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
- O10-R is closed; activation remains blocked on RA01 and cannot expose an
  unready definition or a relation whose reverse/read/restrict semantics are
  disabled.

#### [x] E01-A-P — Physical Build And Readiness Preflight

The first implementation is one medium system-core slice, `E01-A`. It owns the
complete target-local physical builder and an exact per-definition readiness
receipt. `E01-B` remains a separate integration slice that folds those receipts
into the current Application revision readiness root. E01 is not complete until
both slices close.

E01-A is keyed by the located scope and immutable physical edge-definition ID.
Admission revalidates the exact R02 bound publication and definition body
through the same factory-local relation capability used by C09. The mutable
build head is keyed by `(scope_id, edge_definition_id)` and binds deployment,
relation ID, physical-definition SHA-256, storage generation, generation fence,
epoch, fixed start commit sequence `F`, attempt fence, lifecycle, bounded
internal cursors, and validation counts. An immutable receipt row is keyed by
`(scope_id, edge_definition_id, attempt_fence)` and retains the canonical
readiness bytes, digest, counts, authority pins, `F`, and database-authored
settlement time. Equal digests with unequal retained bytes are corruption.

The persisted lifecycle is exactly:

```text
cleaning
  -> backfilling
  -> validating_sources
  -> validating_edges
  -> validating_versions
  -> enabled
```

Every transition runs in one short located READ COMMITTED transaction after
taking the existing scope-clock update lock. A step must observe the same
generation/fence/epoch and `last_commit_seq = F` before it changes build state or
S12 data. Any intervening authoritative commit invalidates the attempt: the
next reconciliation increments the attempt fence, captures the new frontier,
clears every cursor/count, and returns to `cleaning`. E01-A does not add a
commit-time reset hook, dual-maintain an inactive definition, or create a second
clock, OCC, journal, commit, feed, outbox, or retry owner.

`cleaning` removes only the exact inactive definition's candidate current edges
and adjacency versions through a bounded transaction-only S12 build facet.
There is no unbounded `DELETE`, attempt-generation column on an edge, or
in-place repair of an enabled definition. `backfilling` scans at most four
authoritative row pointers per step in unsigned 16-byte row-ID order. Four is
fixed because one admitted row may lower to 1,024 occurrences and C09's complete
transaction ceiling is 4,096. Each selected row is reread under the lock,
lowered through an authenticated single-definition view of the same pure C09
lowerer, checked for current target liveness, and published through S12 at `F`.
There is no caller-authored page size or cursor.

Validation is independently replayed from row ID zero. Source validation proves
the exact expected occurrence set for every current source row. Edge validation
scans at most 128 stored occurrences per step, revalidates canonical occurrence
bytes/digest, source extraction, target liveness, and both endpoint versions.
Version validation scans at most 128 stored endpoint versions per step and
rejects an orphan, wrong direction/key, wrong-definition row, or value other
than `F`. These passes prove both directions: no expected occurrence/version is
missing and no extra stored occurrence/version is accepted. Empty endpoints
remain absent and therefore mean version `0`.

A domain mismatch leaves the attempt non-enabled and returns typed diagnostic
evidence. A later authoritative remediation commit invalidates and restarts it.
Same-frontier sidecar repair requires the explicit factory-authenticated restart
operation, which increments the attempt fence and re-enters bounded cleaning;
it never edits an enabled receipt or reuses another definition's rows. SQL,
stored-row, canonical-evidence, and decision-uncertainty failures remain
distinct and fail closed. Retry observes durable head/receipt state rather than
assuming that an uncertain transaction committed.

E01-A may add only two narrow owner extensions: C09 may mint a same-factory
single-definition prepared lowering value for this builder, and S12 may expose
bounded definition cleanup/validation mechanics to that authenticated builder.
Neither extension changes point-commit behavior or exposes a relation runtime
read. The new build port is a lifecycle-free local factory because control DB,
located target authority, and C09 capability instances must remain exact and
multiple such instances may coexist; it is not a singleton Context service.

E01-A closes only when focused PGlite and genuine-PostgreSQL proof covers empty
and populated builds, bounded multi-page progress, replay, concurrent-frontier
invalidation, target deletion, malformed relation values, replacement-definition
isolation, injected rollback, exact edge/version validation, corruption, repair,
and readiness receipt replay. The port remains private, production-inert, and
unwired from activation or higher APIs.

#### [x] E01-A — Private Physical Edge-Definition Builder

The private target-local builder now implements the complete preflight above.
Migration `0071_nebulous_crystal.sql` adds the fenced per-definition build head
and immutable per-attempt receipt. The package-local build port revalidates the
R02 binding, resolves one located target capability, locks the existing scope
clock, and advances exactly one bounded lifecycle step per transaction. It
reuses C09's authenticated single-definition lowerer and S12's bounded build
facet; neither owner gained a second commit path or a runtime relation read.

The builder keeps source, edge, version, cleanup, and target-evidence work
bounded under the scope-clock lock and fails closed when current-row evidence
is newer than its fixed frontier. Engine-specific test coverage remains owned
by the package test suites and commit handoff rather than this living roadmap.
The port remains private and production-inert. Application-wide readiness,
activation, relation OCC, runtime query, and higher APIs remain unchanged.

E01-A deliberately does not reinterpret an already-enabled physical definition
for a moved semantic binding. That admission fails with `bindingMoved` and
leaves the original head, receipt, edges, and versions untouched; it does not
mint binding-specific readiness for R02 policy-only physical reuse. E01-B or a
separately approved reuse-validation gate must authenticate that reuse lineage,
run validation-only state without cleaning or backfill, and bind a new semantic
readiness result to the original physical receipt before E01 can close.

The current port also has no authenticated view of which definition is serving
an active Application revision. Its restart and frontier-reconciliation paths
are therefore admitted only for inactive candidate definitions while the port
is production-inert. Before E01-B or RA01 wires any caller, the composition must
prove that the definition is non-serving, or introduce separate validation-only
state, so bounded cleanup can never mutate active relation sidecars. This is an
explicit integration gate rather than a caller convention.

#### [x] E01-B-P — Application Relation Readiness Fold Preflight

E01-B is two connected medium implementation checkpoints rather than one broad
rewrite of the existing Application lifecycle. The first checkpoint owns the
private relation-readiness core: exact R02 set preparation, bounded semantic
reuse validation, E01-A receipt revalidation inside a caller-owned target
transaction, and race-free non-serving admission for destructive build work.
The second checkpoint composes that result into relation-aware Application
publication, schema authority, cold materialization, and a distinct persisted
Application readiness contract. Approval of this preflight authorizes both
checkpoints in that order, but E01-B and E01 remain open until both close.

The first checkpoint also closed the fresh-migration blocker reproduced on
2026-08-25. Migration 0072 now uses dependency-safe same-search-path foreign
keys rather than schema-qualified references that escaped the isolated
PostgreSQL test schema. Fresh PGlite and authenticated ordinary-role
PostgreSQL 18 migration proofs pass. This correction belongs to the E01-B
persistence owner; the Cooking system-test harness did not repair or mask it.

The relation-readiness core is one factory-local capability constructed from
the exact R02/C09 relation capability, E01-A build capability, control database,
and located scope authority. It prepares one nominal token from the retained
manifest-to-bound-schema commitment and complete R02 bound publication. The
required set comes only from the dense R02 relation bindings in relation-ordinal
order, never from build heads or caller-authored IDs. Preparation pins the
deployment, manifest SHA-256, Application schema SHA-256, schema version and
manifest SHA-256, bound-publication SHA-256, semantic and physical definitions,
evolution lineage, and one exact relation-owned physical definition per current
relation binding.

Final validation runs inside the existing caller-owned located transaction
after its scope-clock lock. One narrow same-factory E01-A facet rereads each
required immutable physical receipt without opening another transaction. Every
receipt must retain exact canonical bytes and digest and agree on scope,
deployment, relation and edge-definition identity, semantic and physical
definition digests, storage generation and fence, epoch, fixed frontier,
attempt fence, and counts. A direct current definition additionally requires
that physical receipt's frontier to equal the already-locked current commit
sequence. Semantic reuse instead authenticates the historical root receipt at
its own frontier and binds it to a fresh semantic-current receipt at the locked
frontier; it never reinterprets the historical receipt as current. Missing,
extra, stale, moved, incomplete, or corrupt evidence fails closed. Across
schema revisions, compatible semantic bindings for one stable relation may
reuse its relation-owned physical definition. Catalog, build, and sidecar work
remains shared by the stable edge-definition ID, while each revision's semantic
lineage remains explicit in its ordered readiness child.

An R02 `preserve` plus `reuse` binding whose semantic digest moved cannot
reinterpret the original E01-A receipt. It receives separate durable
validation-only state keyed by `(scope_id, schema_version_id,
relation_ordinal)`. The state pins the new bound publication and semantic
binding, exact origin coordinates, original physical receipt, authority and
frontier, attempt fence, bounded source/edge/version cursors, and counts. Its
lifecycle is exactly:

```text
validating_sources
  -> validating_edges
  -> validating_versions
  -> ready
```

It reuses E01-A's fixed four-source and 128-edge/version page ceilings and its
C09 lowering plus S12 content-validation mechanics, but can never enter
cleaning or backfill and can never write an edge or adjacency version. It has a
separate semantic-current provenance policy because normal C09/S12 maintenance
does not rewrite unchanged edges at every commit and deliberately retains an
endpoint's adjacency-version row after its last edge is removed. Let `F0` be
the authenticated root physical receipt frontier and `F` the locked current
frontier. Source validation freshly lowers every current source through the
new semantic definition and proves the exact stored occurrence set plus target
liveness. Edge validation proves exact occurrence bytes, identity, position,
current epoch, and `F0 <= edge commit <= F`; each nonempty endpoint version
must exist and lie between the greater of `F0` and that edge commit and `F`.
Version validation admits retained empty endpoints and requires every stored
version to lie in `F0..F`. The new source, edge, and version counts come from
this scan; the historical receipt's counts remain authenticated snapshot
evidence but are not expected counts for a later frontier.

This semantic-current receipt is a content/coherence proof over trusted C09/S12
transactional maintenance, not a forensic reconstruction of every historical
endpoint transition. The current S12 adjacency-version row has no tombstone or
history witness, so an empty endpoint's exact last-change history cannot be
reproved from the current projection alone. Adding such history would change
the S12 owner and requires a separate preflight; E01-B does not do so. Frontier
movement increments only the semantic-validation attempt, clears its validation
cursors/counts, and starts again at `validating_sources`. Settlement retains a
new immutable semantic-readiness receipt that references the original physical
receipt and the exact R02 lineage. Chained reuse follows the immediate retained
origin; there is no digest-only or name-based shortcut.

Before E01-A inserts or restarts a physical head, cleans candidate sidecars, or
automatically reconciles a physical attempt after frontier movement, it invokes
an exact serving-state facet under the same scope-clock update lock. E01-B
installs that production-inert guard and authenticates the complete current V1
active-selection tuple; a V1 active head and an unattached relation-readiness
root are both non-serving. Revision-only correlation is forbidden. The current
activation foreign keys cannot select relation-aware readiness, so the genuine
serving branch is deliberately unreachable here. RA01 must extend the same
facet to its exact relation-aware active-selection tuple and prove that a
serving definition returns a dedicated typed failure before restart, frontier
reconciliation, or cleanup. Validation-only semantic reuse remains allowed
because it performs no sidecar writes. This is an authenticated transaction
invariant, never a caller-authored Boolean or promise that a revision is
inactive.

The eventual Application integration dispatcher must accept the unversioned
`ApplicationManifest` union and route it to the exact publication,
schema-authority, readiness, and cold-materialization generation. E01-B stops
below that higher boundary: its private relation system-core ports accept the
decoded `ApplicationManifestV2` member only, and no public or developer-facing
dispatcher is claimed complete here. Relation-bearing input is never
down-projected and persisted as V1. Existing `flarex.application-readiness`
version 1 bytes, tables, decoder, activation foreign keys, and table/index/
unique meaning remain exact. Relation-bearing readiness uses a distinct
persisted frame generation and atomically retained ordered relation children.
Its root includes the R02 bound-publication digest and relation-set digest in
addition to the existing Application, task, cold, candidate, table/index, and
unique evidence. The current activation owner must remain unable to consume
this result. The unversioned dispatcher and RA01 remain later-owned work;
O10-R is complete at the private system-core boundary.

Focused PGlite and genuine-PostgreSQL proof must cover retained-V1 empty
integration, exact one/many relation-bearing sets, cross-revision physical
reuse, prepare-versus-settle movement, missing and corrupt physical receipts,
semantic reuse and chained reuse with zero sidecar writes, frontier restart,
the production-inert exact active-selection guard, V1-active and unattached
relation-root non-serving cases, inactive replacement cleanup, rollback,
replay, concurrent settlement, retained V1 byte exactness, and relation-ready
activation rejection. RA01 owns positive active-serving cleanup rejection and
lock-order concurrency proof before relation activation becomes reachable. No
checkpoint adds a relation read, OCC
registration, active head, public API, route, Payload/Medusa adapter, second
transaction owner, dual write, fallback, feed, outbox, or production caller.

#### [x] E01-B Core — Private Ordered Relation Readiness

The system-core checkpoint is complete. The authenticated readiness capability
now validates the complete dense R02 relation set inside the caller-owned
located transaction after the existing scope-clock update lock. It emits one
nominal, timestamp-free `flarex.application-relation-set-readiness` version 1
evidence frame with exact Application, publication, schema, authority, frontier,
relation-order, definition, attempt, and child-receipt commitments. Its byte
accessors return owned copies, structural clones do not carry authority, and
the validator opens no transaction, acquires no second scope lock, and writes
no database state.

Direct children authenticate current E01-A physical receipts. Reused children
authenticate the exact retained origin plus the current semantic-validation
attempt and receipt. The ordered validator rejects missing, extra, duplicate,
foreign, stale, moved, corrupt, or non-ready evidence without accepting a
caller-authored subset. Its final exact-set scan is linear in the bounded
relation count after per-child authentication.

Focused PGlite and ordinary-role PostgreSQL 18 proof covers two distinct direct
relations, two independent cross-revision preserve/reuse lineages, mixed
semantic and new-physical children, stable relation/edge/physical identities,
changed semantic digests, ordered per-ordinal attempt binding, canonical replay,
defensive byte ownership, foreign capability rejection, stale authority,
extra-head rejection, and rollback. The same proof pins unchanged physical
catalogs, build receipts, and sidecars across semantic reuse. Retained V1 active
selection is classified as non-serving, while corrupt active-head evidence
fails in its existing typed error channel. The genuine relation-serving branch
remains unreachable until RA01 owns an exact relation-aware active tuple.

One bounded performance issue is recorded rather than hidden: successive calls
to `advanceReadinessInTransaction` still revalidate already-ready relation
prefixes, so completing a many-relation lifecycle can perform a quadratic
number of child validations even though each final set validation is linear.
Removing that repetition requires durable set-progress state or a new bulk
E01-A authentication facet. Either choice changes an owner contract and needs a
separate preflight; this checkpoint does not duplicate E01-A verification logic
or broaden its authority.

#### [x] E01-B — Application Relation Readiness Fold

The private Application integration checkpoint is complete for the first
runtime-honest system-core boundary. Migration
`0073_application_relation_readiness_fold.sql` adds separate unversioned
relation-aware Application publication, function, task-catalog,
task-definition, revision-schema, readiness-root, readiness-function, and
ordered readiness-relation tables. The retained `_v1` tables, bytes, decoders,
foreign keys, and activation head are unchanged; the new names represent the
accepted current implementation, while version 2 appears only on the concrete
persisted Application publication and readiness frame contracts.

Relation-aware publication authenticates the exact R02 manifest binding before
the target transaction and persists the complete V2 schema and function
commitments without down-projecting them into V1. Schema authority is read-only
over the R02 bound publication and writes no V1 Application schema-authority
row. Task registration reuses the exact existing task-binding version 1 codec
under separate relation-aware storage and requires the process-local authentic
publication capability; a structural copy is rejected.

The readiness fold resolves the located authority, rereads the analyzed V2
revision, publication, complete function set, and task catalog, and prepares
the existing candidate, unique-constraint, physical-definition, and ordered
relation readiness capabilities. Its final caller-owned target transaction
takes the existing scope-clock update lock, revalidates every one of those
owners, authenticates the nominal relation-set evidence, and atomically commits
one `flarex.application-readiness` version 2 root plus the dense relation
children. The root pins the complete R02 binding and bound-publication digests,
candidate, unique, existing table/index physical readiness, task binding, and
exact retained relation-set bytes and digest. Replay reuses the database-authored
first readiness timestamp and requires byte-for-byte root and child identity.

The first runtime boundary deliberately accepts only `functions: []`.
Relation-bearing functions are persisted, but readiness returns
`functionRuntimeUnavailable` before invoking the retained cold adapter because
no relation-aware runtime target/materializer has been approved. A real
version-1 task definition is nevertheless stored and authenticated, proving
that empty tasks are only a fixture choice and not an implementation limit.
The ready result has its own nominal issuer and is not registered with the V1
activation issuer. Current activation therefore cannot consume it; an attempted
legacy activation of the authentic relation revision fails in the retained
Application-readiness `storedState` channel and writes no V1 readiness,
activation, or active-head row. A generation-specific activation-admission
error and positive relation activation remain RA01 ownership.

Focused PGlite proof covers two distinct direct relations, a nonempty task
catalog, order-independent two-export publication replay, exact task/readiness
replay, bounded overfull function/task child-set rejection, PostgreSQL
lock-not-available retry classification, exact receipt foreign keys,
same-composition capability rejection, caller-mutation isolation, atomic
rollback across revision schema, root, and ordered children, the
nonempty-function runtime gate, zero V1 schema/
publication/task/readiness/activation writes, and all fresh migrations. The
configured PostgreSQL 18 integration role concurrently settles the same
complete fold into exactly one inserted and one replayed root, one ordered
two-child set, and zero V1 readiness rows. That lane does not claim a
non-superuser role boundary; role-specific least-privilege proof remains a
separate deployment/operability concern. No OCC, commit, journal, feed,
outbox, application row, runtime-read, route, public API, or higher-adapter
owner changed.

### [x] O10-R — Prove One Exact Relation Read

Prerequisite: E01 has enabled the selected edge definition and its R01-P
snapshot support.

#### Approved O10-R Implementation Preflight

Completion receipt: the approved medium system-core slice is implemented and
proven in focused PGlite and genuine-PostgreSQL lanes. It remains private and
production-inert: no active-head change, Standard query, public API, route,
framework adapter, or production caller was added.

This is one medium system-core slice. It extends the accepted current
implementation directly; it does not create a chronological `V2` journal,
relation reader, OCC lane, or retry owner. `SessionJournalV1` remains the one
concrete persisted journal contract because the private FlarexDB path is still
production-inert and no coexisting shipped decoder requires a second format.
The new product/domain modules and process-local capabilities use plain names.

The admitted logical dependency is exactly:

```text
appRelationIncoming(
  edgeDefinitionId,
  targetRowId,
  observedAdjacencyVersion
)
```

Scope, schema, snapshot, storage generation, epoch, session, and attempt remain
the existing authenticated journal/commit pins. Dependencies coalesce by the
exact immutable edge definition plus target row, sort by that same identity,
and retain the first exact observed version. A later observation with a
different version is a conflict, never a replacement value. The concrete V1
journal contract adds one dedicated child set and root counters for at most
`128` relation syscalls, `128` coalesced relation dependencies, and `4,096`
physically consumed base occurrences per attempt. These are separate from
point-document and ordered-index accounting.

The core resolver accepts only an opaque same-composition relation capability
derived from the exact R02 binding and E01-B readiness fold. It resolves one
incoming reverse-many, same-scope, top-level, nonlocalized, monomorphic,
duplicate-free, target-live `restrict` definition before target edge I/O. The
durable syscall receipt stores the resolved immutable identifiers; callers do
not supply a physical definition, direction, filter, cursor, graph expression,
or document-population request. A later API owner may translate its own logical
descriptor into this capability, but O10-R publishes no such API.

The syscall runs through the existing exact-running read admission. Under the
scope-clock `FOR SHARE` lock and exact session/claim lock it performs the S12
version-before/page/version-after handshake, follows only the internal
`(sourceRowId, duplicateOrdinal)` frontier, and stops after one logical page or
the attempt-wide physical-work ceiling. Its result contains only source
document/occurrence identity plus nullable retained position and an exhaustion
flag. It has no external continuation token.

Read-your-writes uses one exact composition:

```text
current staged point writes
  -> existing final-document overlay
  -> authenticated single-definition C09 lowerer
  -> relation put/remove/reorder delta
  -> ordered merge with bounded S12 incoming pages
```

The merge refills after staged removals, includes staged insertions before,
inside, and after physical pages, and preserves source-row/duplicate-ordinal
order. It does not duplicate relation extraction, scan arbitrary JSON, load
documents into the result, or fall back to the commit feed.

Two conflict times converge on O08. A dependency mismatch found under the final
scope-clock update lock extends the existing point-commit conflict union and
uses the existing finishing replacement path. A version above the pinned
snapshot, or a version change observed before a result can be returned, emits
an authenticated running-relation conflict. O08 gains one bounded
`running -> retrying` replacement branch that consumes the exact execution
claim, deletes the old journal and lease, advances the attempt fence, and
creates the same pristine fresh attempt as the finishing branch. It does not
seal a dummy result, terminally abort the attempt, or add another loop, retry
budget, backoff policy, outcome owner, or user-code runner. Both branches use
the same maximum four reruns, committed-outcome check, fresh-snapshot proof,
handoff capability, deterministic rerun, and convergence validation.

The implementation order is protocol/journal storage, pure overlay and bounded
reader, exact syscall composition, final and early conflict reproduction, then
PGlite/PostgreSQL plan and race proof. No activation, active-head change,
developer SDK, Standard query API, Payload/Medusa adapter, route, feed, outbox,
or production caller is part of this slice.

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

### [x] RA01 — Activate One Private Relation Revision

Prerequisites: E01 has settled complete physical readiness and O10-R has proved
the incoming dependency/overlay for the exact bound relation publication.

Outcome:

- with O10-R closed as a roadmap proof, invoke only the existing Application
  activation owner with the exact analyzed manifest, R02 bound publication, and
  persisted readiness evidence; O10-R is not caller-authored activation input;
- make forward storage, current incoming reads, and `restrict` enforcement
  available together for one private relation-bearing revision;
- extend the production-inert E01-B serving-state facet with the exact
  relation-aware active-selection tuple, never revision-only correlation;
- add no candidate query path, second activation head, route, binding,
  production caller, fallback, or comparison authority.

Exit gates:

- the existing active-revision selection resolves the exact relation binding
  that E01/O10-R proved;
- stale readiness, head movement, mismatched binding, or missing relation
  evidence fails closed under the existing activation CAS;
- an active relation child rejects E01-A restart, frontier reconciliation, and
  cleanup under the shared scope-clock lock, while inactive replacement work
  and validation-only semantic reuse remain available;
- relation-specific subscriptions/live observation remain absent until R03-B and
  the full SV-R proof; roadmap 49's production-cutover decision remains no-go.

#### RA01 approved implementation preflight

RA01 is one medium system-core slice. The existing Application activation
module, scope-clock lock, activation sequence, request replay, CAS, immutable
history, and single active head remain the only activation authority. The
current physical activation tables are hard-foreign-keyed to the retained
`flarex.application-readiness` version 1 contract, while E01-B persists the
relation-aware version 2 contract in the unversioned readiness root and dense
relation children. Passing the E01 result through the old readiness path,
fabricating a version 1 row, dropping the readiness foreign key, or adding a
second relation head would all violate that authority boundary.

Migration `0075` therefore renames the existing private activation-history and
active-head tables to the accepted unversioned names and evolves those same
tables in place. Existing rows and version 1 activation/head bytes remain exact.
The evolved history carries a concrete readiness-contract discriminator, the
common readiness digest, mutually exclusive Legacy and relation-readiness
witness columns, and conditional foreign keys to the retained version 1 root or
the current relation-aware root. The relation witness includes the exact
relation-set digest and count. A database check requires exactly one witness to
equal the common digest. The single head carries the same contract discriminator
and is foreign-keyed to the corresponding common activation identity. Relation
activation/head frames use concrete contract version 2 and commit the exact
relation-root tuple; product modules and APIs remain unversioned. There is no
second physical head, runtime priority order, fallback, comparison read, or dual
write.

The Application activation owner gains a private readiness dispatcher derived
from the stored analyzed manifest and persisted head contract, never from a
caller-authored generation flag. Its Legacy branch preserves the current
relation-free settle/read/validation behavior and byte-for-byte frame decoding.
Its relation branch reuses E01-B's owner: cold reconstruction authenticates the
stored manifest, R02 publication/binding, task/candidate/unique/physical
evidence, version 2 root, relation-set bytes/digest/frontier/count, and every
dense ordered child. First activation and already-active reads revalidate that
same evidence inside the caller-owned activation transaction after the existing
scope-clock lock. Missing, extra, reordered, stale, foreign, or corrupt evidence
fails closed; issuer identity alone is never sufficient.

One opaque `ApplicationActiveSelection` remains process-local. Its hidden basis
is discriminated by readiness contract. Existing relation-free claimants reject
a relation selection instead of interpreting a version 2 manifest. The private
relation claimant requires the exact selection identity and transactionally
revalidates its scope clock and complete head/history/root tuple. Only that
active result may derive the already-proved O10-R definition/read capability;
candidate readiness or an unattached, copied, foreign, inactive, or superseded
O10-R capability is not serving authority. RQ01 remains the later owner of query
composition.

The existing E01 serving-state facet becomes positive only by authenticating
the same active head, activation row, relation-readiness root, and matching
dense child for the requested immutable edge definition. No active head remains
`not_serving`; an exact retained Legacy head remains `not_serving`; corrupt or
missing active relation evidence is a typed stored-state failure, never
absence. Because activation and E01 restart/reconciliation/cleanup both take
the scope-clock update lock before their owned locks, either the builder wins
and later activation revalidation fails stale/not-ready, or activation wins and
later sidecar mutation observes `serving` and fails before writes.

The focused proof includes fresh and populated-Legacy migration, Legacy byte
and behavior regression, relation insert/replay/CAS/rollback/cold read,
Legacy-to-relation and relation-to-Legacy head movement,
root/child/binding corruption,
selection authenticity and staleness, active-child cleanup rejection, inactive
replacement and validation-only reuse, and both activation-versus-builder lock
orders in PGlite and genuine PostgreSQL. Point commit, OCC, journal/session,
retry policy, function runtime, feeds/outbox, routes, bindings, Standard query
APIs, SDKs, Payload/Medusa, and production callers are explicit stop boundaries
requiring separate approval if implementation would need to change them.

#### RA01 implementation checkpoint — bounded core complete, exit still open

The approved activation-owned system-core work is implemented as one bounded
checkpoint. Migration `0075` evolves the one activation history and one active
head in place, retains exact Legacy contract-version-1 rows and frames, and adds
the mutually exclusive relation contract-version-2 witnesses. The activation
dispatcher derives its branch from the authenticated stored manifest. Its
relation branch cold-reconstructs and reauthenticates the complete readiness
root, ordered children, immutable physical and semantic receipts, immediate R02
origin lineage, current scope authority, and activation request before insert
or replay. Exact replay is checked before current-frontier settlement, so an
already committed activation remains replayable after the scope frontier
advances without minting a second activation or head.

The same checkpoint adds one exact relation selection and read-capability mint,
revalidates the selection before minting, and extends E01's serving inspector to
the complete relation head/history/readiness tuple under the caller-owned scope
clock. The inspector rejects stale generation, fence, epoch, future relation
frontier, corrupt evidence, and active-definition restart or cleanup. Legacy
runtime consumers explicitly accept only readiness contract version 1; they do
not reinterpret a relation head. No route, Standard query API, SDK, framework
adapter, second head, fallback, comparison path, dual write, feed, or outbox is
added.

Focused PGlite and genuine PostgreSQL 18 receipts cover fresh and populated
Legacy migration, Legacy activation regression, relation settlement and cold
reconstruction, insert and exact replay (including replay after frontier
advance), canonical root and child corruption, direct and semantic historical
receipt authentication, selection authenticity, serving rejection, rollback,
concurrent settlement, and a real relation read/OCC conflict. These receipts do
not yet establish every preflight matrix cell: complete Legacy-to-relation and
relation-to-Legacy replacement coverage and both activation-versus-builder lock
orders remain open.

One shared-owner defect prevents RA01 from being marked complete:

- **Reproducible scenario:** activate relation revision A, mint its private
  O10-R read capability, then replace the active head with revision B while an
  A-pinned attempt still holds that capability. `ApplicationRelationRead.resolve`
  and `lowerOverlay` authenticate only their process-local `WeakMap` entry and
  static deployment/scope/schema tuple. `SessionJournalStore` can therefore
  resolve and consume the old capability without rereading the current active
  head.
- **Expected behavior:** a capability whose issuing relation selection has
  been superseded fails closed before relation data I/O; the active head remains
  the serving authority at use time.
- **Actual behavior:** activation-time and mint-time validation are exact, but
  no use-time head validation occurs inside the journal-owned read transaction.
- **Affected owner and trust boundary:** the O10-R session-journal read path,
  specifically `SessionJournalStore.resolveApplicationRelationRead` and the
  transaction that runs `runApplicationRelationIncomingRead`; a safe repair
  must either revalidate the active selection there or make the finishing
  transaction retain an exact active-head dependency.
- **Evidence and disposition:** the static resolution is visible in
  `applicationRelationRead/Repository.ts` and consumption in
  `sessionJournalStore.ts`. Point commit, OCC, journal/session, and retry owners
  are explicit RA01 stop boundaries, so this checkpoint records the defect and
  does not weaken assertions, add a fallback, or duplicate active-head logic.
  RA01 stays open pending a separately approved journal/OCC preflight and the
  remaining replacement and lock-order proofs.

#### RA01-J — Active-selection use-time and finish-time authority

Status: implementation preflight approved on 2026-08-26. This is one medium
system-core slice crossing only the existing Application activation,
Application relation-read, session-journal, and point-commit owners. It closes
the recorded superseded-capability defect; it does not authorize RQ01, a
relation-aware function runtime or session-activation path, a route, public
API, SDK, framework adapter, second activation head, or alternate commit/OCC
lane.

The existing unversioned Application relation-read port retains the exact
opaque `ApplicationActiveSelection` that issued each relation capability. It
adds one transaction-owned validation operation rather than exposing the
selection basis to callers. The operation first authenticates the capability
through the port's private `WeakMap`, then invokes the existing Application
activation owner's relation-selection validator with the caller-owned target
transaction and already-locked scope clock. It must reauthenticate the complete
head, immutable activation, relation-readiness root and dense children,
readiness and relation-set digests, activation sequence and digest, scope
authority, schema, frontier, generation fence, and epoch. A structurally copied
capability or selection remains invalid.

`SessionJournalStore.runApplicationRelationIncomingRead` invokes that operation
inside the exact-running syscall transaction before loading relation overlay
transitions, current edges, adjacency versions, or returning a stored relation
outcome. The existing scope-clock `FOR SHARE` lock therefore excludes
activation movement for the complete relation syscall. Missing, foreign,
corrupt, or superseded selection evidence fails through the existing typed
relation-read/activation channel before relation data I/O and before new
journal evidence is written.

Each accepted `appRelationIncoming` dependency additionally retains the exact
issuing active-head CAS token: activation sequence plus active-head SHA-256.
Scope, deployment, schema, generation, fence, and epoch remain the existing
attempt pins, while the authenticated head digest commits the revision and
relation-readiness tuple. Repeating the complete selection basis would add
large redundant evidence without strengthening head-movement detection. Every
relation dependency in one attempt must carry the same CAS token; a different
selection is not coalesced, replaced, or treated as an additional authority.
The activation sequence plus head digest prevents an A-to-B-to-A replacement
from passing as unchanged authority.

`SessionJournalV1` remains the one concrete persisted journal contract because
this core is still production-inert and no coexisting shipped decoder requires
a new generation. Its existing strict `appRelationIncoming` dependency gains
the two CAS-token fields. Seal snapshotting, stored-row decoding, canonical
normalization, replay, corruption checks, and the point-commit command all
carry them. Product modules and APIs remain unversioned; the `V1` suffix stays
only on this concrete journal/wire contract.

At finish time, the existing point-commit kernel validates those pins after
taking the scope-clock update lock and before row, index, unique, relation-edge,
result, feed, or outbox writes. It authenticates the single coherent current
head and immutable activation, requires the relation readiness contract, and
compares the exact retained CAS token. An absent or different head is a typed
stale-Application authority failure, not an adjacency conflict and not
permission to rerun revision A under revision B. The unchanged exact head
continues into the existing point, indexed-range, relation-adjacency, and write
validation. Attempts with no relation syscall retain their current journal and
point-commit behavior.

The migration adds only non-null activation-sequence and 32-byte active-head
digest columns to the private relation-dependency table. Existing Application
activation, session, journal-root, result, feed, outbox, and authoritative
application-row rows remain unchanged. No trustworthy issuing head can be
invented for an old relation-dependency row, so migration fails closed if that
private table is populated instead of fabricating a backfill. The adjacency
version remains the independent data-OCC component of the same dependency.

Focused PGlite and genuine-PostgreSQL proof must cover:

- a capability superseded before its first syscall fails before overlay or edge
  access and writes no relation dependency;
- a head replaced after a successful relation read but before finish fails at
  final authority validation before application or sidecar writes;
- unchanged-head read, replay, seal, and finish preserve exact canonical
  evidence and existing relation OCC behavior;
- multiple relation dependencies from the same active selection retain one
  exact CAS token, while different selections in one attempt fail closed;
- A-to-B-to-A replacement cannot satisfy the earlier activation sequence and
  head digest;
- malformed, missing, copied, and digest-divergent CAS fields fail as stored
  corruption;
- complete Legacy-to-relation and relation-to-Legacy replacement behavior; and
- both activation-versus-builder lock orders, proving the scope-clock-first
  order without deadlock or post-activation sidecar mutation.

RA01 closes only when this matrix and the previously open replacement and
builder lock-order cells pass. RQ01 remains blocked until then.

#### RA01-J implementation checkpoint — journal authority complete, RA01 open

The approved medium system-core slice is implemented without adding a higher
API or a parallel commit path. The unversioned relation-read capability retains
its exact issuing active selection and validates it inside the journal syscall
transaction before replay, overlay, adjacency, or edge access. The concrete
session-journal dependency now retains its activation sequence and active-head
digest, canonical normalization preserves those fields, and every dependency
in an attempt must agree on one exact token. Migration `0076` adds the two
private persisted witnesses and fails closed rather than inventing authority
for a populated relation-dependency table.

The shared finishing kernel validates the coherent relation head immediately
after the scope-clock update lock and before dependency queries or publication
side effects. The specialized running-relation-conflict replacement path uses
the same authority rule; a first-read relation conflict persists its logical
dependency and CAS token, so replacement cannot bypass final validation.
Superseded authority maps to `activeRelationSelectionChanged`, while an
unchanged head continues through the existing adjacency OCC checks.

Focused PGlite proof covers capability use before relation storage access,
stored replay, successful seal, final rollback proof, first-read conflict and
specialized replacement, malformed and divergent stored CAS evidence, and a
real A1-to-B2-to-same-revision-A3 cycle. The A1 capability and finishing
command remain stale under both B2 and A3, while the three activation-head
digests are distinct. Genuine PostgreSQL receipts cover the same transaction
ordering and migration behavior. These receipts close the RA01-J superseded-
capability defect, but do not close all of RA01.

One separate stored-active readiness defect now blocks the remaining complete
Legacy/relation transition proof. The original dispatcher diagnosis was too
broad: direct Legacy activation does not call the relation-readiness fold.

- **Reproducible scenario:** activate a ready relation revision A and retain its
  exact active selection, then install candidate-validation evidence for a
  replacement Legacy revision B without changing the active head.
- **Expected behavior:** preparing B does not revoke A. A remains readable and
  its retained selection remains valid until a successful single-head CAS
  replaces it; the ready Legacy revision can then replace A and a ready
  relation revision can replace that Legacy head through the same protocol.
- **Actual behavior:** relation active-read and retained-selection validation
  reload A through the one non-active candidate-validation head per scope.
  Installing B moves that head, so A observes `wrongSchema`, which the
  relation-readiness fold exposes as operation `validate`, reason
  `authorityChanged`, even though the serving head did not move. The direct
  Legacy activation branch itself validates B and performs the existing CAS;
  it has no call path into A's relation fold.
- **Affected owner and trust boundary:** the stored-active preparation and
  validation paths in `applicationRelationReadinessFold.ts`, not activation
  dispatch, the journal, relation read, point commit, or the candidate
  validation owner.
- **Evidence and disposition:** the candidate-validation table intentionally
  has one mutable, non-active head per scope, while the immutable relation
  readiness root already commits A's exact candidate-validation receipt. The
  active path incorrectly consults the former instead of authenticating the
  latter. This checkpoint corrects the diagnosis without weakening an
  assertion, adding a fallback, or changing either owner before the separate
  preflight below.

Complete Legacy-to-relation and relation-to-Legacy replacement proof and both
real activation-versus-builder lock orders therefore remain RA01 exit gates.
RQ01 remains blocked.

#### RA01-S — Active-serving continuity and transition closure

Status: implementation preflight approved on 2026-08-26. This is the final
medium system-core slice for RA01's open serving-continuity, mixed-kind
transition, and lock-order gates. It changes only the existing relation
readiness and activation owners plus their focused persistence tests. RQ01,
higher relation APIs, function-runtime composition, routes, SDKs, framework
adapters, commit/OCC behavior, feeds, outbox, a second active head, fallback,
comparison authority, and dual writes remain out of scope.

The active head is serving authority; the candidate-validation head is not.
The latter remains one target-local, non-active admission head per scope and
may move whenever a replacement schema is prepared. Its current exact receipt
continues to be required by relation `settle`, ordinary `readReady`, and first
activation. Moving it must not revoke a different revision whose immutable
readiness and activation evidence remain the current active head.

The stored-active relation path therefore gains an explicit preparation mode.
It reconstructs the active revision's candidate-validation receipt digest from
the immutable readiness root and validates that same committed digest during
canonical replay; it neither fabricates the process-local candidate evidence
brand nor queries the current non-active candidate head. Ordinary prepared
readiness keeps the branded current evidence and its existing transaction-time
validation. Both modes retain exact bundle, schema/publication/task binding,
scope generation/fence/epoch, schema-version-keyed unique eligibility, current
physical lifecycle, stored dense relation root and children, historical
physical or semantic receipt authentication, canonical readiness bytes and
digest, and final active-head CAS validation. Legacy stored-readiness behavior
and all first-activation gates remain unchanged.

The mixed-kind proof uses only the existing readiness dispatcher and single
head: relation A at activation sequence 1, Legacy B at sequence 2, then a newly
prepared relation C at sequence 3. It retains each exact CAS token before
preparing the replacement, proves A remains usable while B's candidate
evidence is installed, proves B remains usable while C's candidate evidence is
installed, and requires three distinct head digests. History keeps the
mutually exclusive Legacy and relation witnesses, exactly one head remains,
and the A1 and B2 selections remain stale after C3. Reinstalling relation
candidate evidence does not rewrite A's immutable readiness receipt; C settles
against the new receipt instead. The existing relation-only replacement proof
continues to own same-revision A-to-B-to-A ABA. No transition may revalidate or
rewrite the displaced head as a prerequisite to replacing it.

Genuine PostgreSQL must additionally run both real repository operations over
separate connections. In the builder-first order, a restart holds the scope
clock through its lifecycle transition; activation blocks, then fails
`notReady` after the builder commits, with no activation/head write. In the
activation-first order, activation holds the scope clock after inserting its
history row; the builder blocks, then observes the committed definition as
serving and fails before a build-head or sidecar mutation. The proof may widen
the existing private activation fault callback to await a test gate, but may
not add a product operation or use direct table mutation as a substitute for
either owner. PostgreSQL blocker inspection is observation only.

RA01-S closes only when focused PGlite and PostgreSQL receipts prove stored-
active continuity, the complete A1-to-B2-to-C3 transition, rollback/staleness,
and both lock orders; core and changed-diff lint, exact staged validation, and
both standing reviewers must pass. Any defect discovered in the builder,
candidate-validation, physical lifecycle, activation-history, commit/OCC, or
journal owner is recorded and stopped at that boundary rather than repaired
incidentally. RQ01 remains blocked until this checkpoint is committed.

#### RA01-S implementation checkpoint — RA01 complete

Completed on 2026-08-26. The relation-readiness fold now prepares stored-active
candidate validation from the immutable readiness root's exact receipt digest.
Canonical replay authenticates that committed digest while only the mutable
non-active candidate head check is omitted. Ordinary `settle`, `readReady`, and
first-activation preparation retain the branded current candidate evidence and
all existing validation gates.

Focused persistence proofs now establish:

- active relation A remains readable, including through a cold repository
  instance, after Legacy B installs a newer candidate-validation head;
- the single activation head advances A1 -> Legacy B2 -> relation C3 with three
  distinct digests, mutually exclusive historical witnesses, and stale prior
  selections;
- corrupting the stored candidate receipt fails canonical readiness replay;
- genuine PostgreSQL runs the real builder and activation owners on separate
  connections in both lock orders: builder-first makes activation fail
  `notReady` without activation/head writes, while activation-first makes the
  builder reject the serving revision without changing its physical snapshot.

The package typecheck, core and changed-diff lint, exact staged lint, all 69
E01-B PGlite tests, all 6 focused genuine-PostgreSQL tests, and both standing
reviews pass. That checkpoint added no RQ01 query, higher relation API,
route, SDK, framework adapter, second head, fallback, comparison authority, or
dual write. Those receipts close RA01; RQ01 was separately preflighted and is
completed below.

### [x] RQ01 — Compose One Read-Only Standard Relation Query

Status: completed on 2026-08-26. This is one medium,
private system-core slice through the existing active Application query
snapshot and Standard invocation owners. It does not authorize a relation-aware
function Worker, a nonempty relation-bearing function catalog, a public route
or SDK, mutation-journal/OCC behavior, sync facts, framework adapters, or the
later `SV-R` vertical.

#### RQ01 implementation preflight

The first accepted internal operation is the unversioned
`takeIncomingRelationSources`. It accepts this exact logical request:

```text
relation = {
  source = {
    table = RelationIdentityV1
    path = [{ kind = field, name = RelationIdentityV1 }]
  }
}
target = AppDocumentIdV1
limit = integer in [1, 128]
```

The source table and canonical typed source path are the relation selector.
The caller does not supply a relation ID, edge-definition ID, target table,
inverse name, physical definition, adjacency version, or SQL cursor. The
active authenticated semantic definition supplies those facts, and the target
document ID must belong to its declared target table.

The exact result is:

```text
sources = [{ sourceDocumentId, duplicateOrdinal, position }]
exhausted = boolean
```

This preserves the already-proved O10-R logical item and ordering contract.
`duplicateOrdinal` remains zero in the admitted duplicate-forbidden profile;
`position` preserves the scalar-null versus ordered-many position meaning. No
source or target document is populated, and no caller cursor is returned.

The Standard boundary strictly decodes and snapshots the complete request
before reading active authority. Primitive, array, accessor, missing, extra,
oversized, populated, cursor/offset, filter/order, and graph/traversal shapes
fail there. The relation-read owner adds source-semantic preparation beside its
existing internal-ID preparation, resolves exactly one authenticated active
definition, and mints the same process-local O10-R capability. It does not
expose the resolved numeric identities to Standard callers.

The existing Application query snapshot owner adds one relation mode rather
than a second query engine. It retains the same Scope-owned opaque handle,
`ScopeExecution` located `READ COMMITTED` transaction, scope-clock share lock,
serialized-use gate, trusted placement/fence/epoch checks, snapshot token, and
history-retention proof. Open captures the active relation selection and the
scope clock's `lastCommitSeq`. Read revalidates that exact selection in its
transaction before edge access, validates the target table and limit, and then
uses the selected S12 incoming page reader with its bounded lookahead.

The relation snapshot accepts a page only when its adjacency versions are
equal and do not exceed the captured snapshot commit sequence. A newer
adjacency version is a typed retryable snapshot conflict; unequal or regressed
evidence at or before the snapshot is stored-state failure. With no mutation
overlay, the selected physical page's internal lookahead directly proves the
logical `exhausted` result; RQ01 does not call or refactor the session journal,
mint an execution claim, register an OCC dependency, or reproduce mutation
read-your-writes policy.

The current relation-readiness rule that accepts only `functions: []` remains
unchanged. Consequently this private Standard operation reads the composite
active head and invokes the relation snapshot directly. It performs no Source
Artifact load, Worker definition/materialization, host transaction, RPC
bridge, default identity decision, point read, or index read. `SV-R` retains
ownership of the later real function-runtime integration.

Focused proof must establish in both PGlite and genuine PostgreSQL:

- present, empty, exact exhaustion, stable ordering, and the 128-identity
  boundary through the active relation selection;
- strict rejection of malformed, foreign-target, oversized, populated,
  cursor, filter, graph, Legacy/unready, superseded-selection, and
  post-snapshot-adjacency cases before application-row loading;
- exact query observation proving only the bounded edge page is read; and
- unchanged application rows, current edges, adjacency versions, journal and
  result evidence, execution claims, idempotency outcomes, scope commits,
  change facts, feeds, outbox rows, and scope-clock commit/outbox counters.

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

#### RQ01 completion checkpoint

The private unversioned `takeIncomingRelationSources` operation now composes
the active relation selection through `ApplicationRelationQuerySystem`, the
existing Application query-snapshot owner, and the O10-R relation-read owner.
Standard strictly snapshots and decodes the complete logical request before
active-authority I/O. Persistence resolves the semantic source table/path to
one authenticated active relation, keeps numeric table and edge identities in
module-local opaque snapshot state, and performs one bounded S12 incoming-page
read inside the existing located `READ COMMITTED` scope execution.

The shared paired-engine proof covers empty, 129-source lookahead, and exactly
128-source exhaustion; stable logical order and item projection; exact SQL,
placeholders, parameters, and `limit + 1 = 129`; foreign target rejection;
post-open adjacency change; a genuinely current Legacy selection; and a
superseded relation selection. The Legacy and stale-selection cells make edge
storage unavailable to prove rejection before edge access. Read-only state is
compared across 22 write-bearing application, relation, journal, session,
claim, result, commit, feed, outbox, and clock tables.

The focused Standard suite passes 15/15, the new PGlite proof passes 1/1, the
new genuine PostgreSQL 18 proof passes 2/2 under a non-superuser, and the
existing genuine-PostgreSQL relation-readiness suite passes 6/6. The three
owning package typechecks, core lint, changed-diff lint, and both standing
reviews pass. RQ01 adds no Worker/function execution, mutation journal or OCC
dependency, application-row population, caller cursor, route, SDK, framework
adapter, alternate query engine, or production cutover. `R03-A` is now complete;
`R03-B` remains the next separately owned relation slice.

### [ ] R03 — Relation Change Facts And Sync Invalidation

Prerequisite: C09 exposes deterministic adjacency actions and RQ01 proves the
read-only logical dependency shape that sync will observe.

R03 is split at its two ownership boundaries. `R03-A` changes only authoritative
commit publication, the package-private commit-feed reader, and retained-history
compaction. `R03-B` later changes only the accepted scope-local sync owner after
roadmap 21 freezes and implements its target contracts. The Legacy Postgres
subscription/Scheduler path is regression evidence, not an interim R03 owner.

#### [x] R03-A — Atomic Relation Adjacency Facts

Outcome:

- derive one deterministic fact per unique affected
  `(edgeDefinitionId, direction, endpointRowId)` from C09's already
  authenticated actions;
- treat put, remove, and relevant reorder as changes to the outgoing source and
  incoming target endpoints; a retarget coalesces its unchanged outgoing source
  while retaining both old and new incoming targets;
- publish those typed facts as dedicated children of the existing scope commit,
  with an independent exact child count, while preserving the existing commit
  sequence, transaction, idempotency outcome, and generic commit-wake outbox;
- extend the same bounded repeatable-read commit feed and O11 compaction owner
  to validate, retain, and delete those children under the existing retained
  floor.

`R03-A` facts describe changed adjacency endpoints, not raw storage actions.
They are coalesced once per endpoint per commit, matching S12's adjacency-version
advance. Callers cannot author them, the feed does not reconstruct them from
current edges, and no second relation stream or relation-specific wake exists.

Exit gates:

- put, remove, reorder, retarget, and source deletion publish the exact ordered
  endpoint facts, while no-op, rollback, and committed-outcome replay publish
  none or no duplicate;
- at publication, exactly the fact endpoint set advances to the publishing S12
  adjacency version, with exact per-header count, ordinal, identity, and scope
  checks;
- retained facts replay through the existing feed, expired history returns the
  existing fail-closed cursor reset, and compaction verifies and deletes every
  relation child before its header;
- existing app-row feed children, outcome, outbox, and scope-clock behavior stay
  unchanged.

Implemented system-core boundary:

- one package-local pure projector now owns endpoint decoding, coalescing, and
  deterministic ordering for both C09 publication facts and S12 adjacency-
  version advancement;
- migration `0077_lame_human_torch.sql` adds one schema-local private relation-
  fact child directory and an independent default-zero header count, with no
  foreign key to mutable current-edge or adjacency-version state;
- the existing point-commit transaction writes the header, app-row children,
  relation children in bounded batches of at most 500, outcome, generic wake,
  and scope-clock publication under the same rollback and committed-outcome
  replay boundary;
- the package-private repeatable-read feed independently bounds 16,000 app-row
  children and 8,192 relation children, with a hard combined maximum of 24,192;
  it never splits a commit, materializes logical endpoint row IDs, and fails
  closed on count, ordinal, header, identity, canonical-order, or endpoint
  corruption;
- O11 retained-history compaction validates both child directories before
  deleting either, deletes both before the exact header, and preserves the one
  retained floor and existing cursor-reset contract;
- focused PGlite and genuine PostgreSQL proofs cover exact put/remove/
  reorder/retarget/source-delete facts, replay and rollback, independent
  maximum-page cutoffs, the 24,192-child combined first-commit capacity,
  repeatable-read capture, schema-local 0076-to-0077 upgrade/default-zero
  behavior, child constraints, bounded publication statement counts, and
  bounded query plans.

R03-A adds no RQ01 result field, subscription registry, DO/Worker observer,
new wake or stream, relation build/backfill fact, OCC/journal owner change,
route, public SDK, Payload adapter, or production cutover. Full R03 remains open
at R03-B.

#### [ ] R03-B — Fenced Relation Sync Registration

Prerequisite: R03-A is complete and roadmap 21's accepted scope-local sync
contracts and owner exist. This gate must not extend the Legacy timestamp-based
Postgres subscription registry or compatibility SchedulerDO.

Roadmap 21's `SYNC01-P` docs-only preflight and bounded `SYNC01-A` strict
persisted cursor/wake plus pure host-neutral contiguous-cursor core are
complete. `SYNC01-B` also completes the private RQ01 receipt containing the
same-read snapshot token, typed incoming dependency, and authenticated active-
head witness. `SYNC01-C` adds the strict scope-local dependency-key and pure
commit-routing core, including exact incoming relation keys, but no stored
inverted index. `SYNC01-D` adds the complete canonical query identity plus
strict provisional/active generation and pure activation-classification core.
These checkpoints do not satisfy this prerequisite. R03-B remains blocked
until the target sync owner also has durable per-scope cursor and generation
state, a persisted typed dependency index, authenticated active-head
observation, and reset/reconnect behavior.

Roadmap 21's `SYNC01-E` now implements the narrow authenticated current-head
observation prerequisite: strict evidence from the trusted located read, the
query receipt's storage-generation fence, and the connected activation-
classifier checks. Its paired PGlite and genuine-PostgreSQL transaction/lock
acceptance lanes are complete. Roadmap 21's `SYNC01-F` now also implements the
production-inert deterministic `DeploymentSyncDO` and its fenced SQLite
scope-cursor owner. Persisted query identity, generation and dependency state,
catch-up, head-change recovery, reset, reconnect, and relation registration
remain absent and continue to block R03-B.

Completed `SYNC01-F` intentionally excludes canonical-query key encoding,
generation and dependency storage, feed catch-up, reset/reconnect, and
registration. The actor and cursor owner are therefore real, but the next
query-state preflight and the later contiguous catch-up proof must complete
before R03-B's registration prerequisite is satisfied.

Roadmap 21's `SYNC01-GP` now freezes that next query-state slice without
implementing it. The accepted model keeps the installed active generation and
dependency directory authoritative while one newer provisional candidate is in
flight, stores and revalidates a protocol-owned canonical query frame beside
its SHA-256 lookup key, and forbids cursor-only advancement after query state
exists. Authorized `SYNC01-G` remains production-inert; later contiguous
cursor-plus-invalidation catch-up and provisional registration/refresh gates
are still required before R03-B can begin.

Outcome:

- enable relation dependency registration at an exact scope-commit-fenced
  baseline: earlier changes are observed through a fresh snapshot, and every
  later relevant change has a typed fact;
- allow the accepted sync owner to register relation dependencies and
  invalidate live results through the existing contiguous commit feed;
- freeze retention and reconnect behavior before production relation
  subscriptions.

Exit gates:

- provisional registration, the RQ01 snapshot token and typed incoming
  dependency, the same authenticated activation-sequence/head-digest witness,
  refresh through the contiguous cursor, and activation form one fail-closed
  protocol;
- a change before the registration fence is visible in the fresh query snapshot,
  while every matching change after it invalidates and unrelated facts do not;
- duplicate, reverse, and gap processing catch up contiguously, while epoch
  mismatch or an expired retained floor requires one explicit resnapshot;
- no relation-specific observer is admitted before the fenced baseline and fact
  publication path are both ready.

Application activation is not an R03 app-data fact. The target sync owner must
compare the separately authenticated current active head against the witness
returned by the query owner; it must not fabricate an activation commit, infer
head changes from relation facts, or rely on a best-effort activation wake.

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

- The production-inert private core now includes R02 publication/binding, S12
  edge and adjacency-version storage, C09 point-commit lowering, E01 readiness,
  O10-R journal/OCC reads, and completed RA01 single-head activation and
  active-serving continuity, direct RQ01 relation reads, and R03-A relation
  facts. Public routing, sync registration, developer APIs, and framework
  adapters remain absent.
- Fenced sync registration and invalidation remain absent until R03-B; typed
  relation children in the existing point-commit feed are not treated as an
  implicit relation observer.
- The first admitted high-level profile and its exact declaration/occurrence
  codecs, budgets, Standard source representation, analyzed projection, and
  manifest evolution remain intentionally narrow under completed `R01`.
- Cross-owner references to Medusa or other external resolvers require separate
  existence, deletion, staleness, and transaction participation contracts.
- Payload relation behavior remains adapter conformance work and does not block
  the native R01 contract from being designed independently.
