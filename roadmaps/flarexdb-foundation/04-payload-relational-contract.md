# Payload Relational Compatibility Contract

Status: Accepted deferred foundation contract. This document strengthens the
preconditions for `S12` and `C09`; it does not start the Payload adapter or add
Payload tables.

## Decision

Payload collections may expose an existing Flarex app table without creating a
second copy of its rows. The binding is:

```text
Payload collection slug
  -> one existing stable table_id
  -> one authoritative fx_app_row_current / fx_app_row_rev history
```

For one logical table there is one schema owner, `app` or `payload`. An adapter
binding may expose the table through another API surface, but it does not create
another table identity, row body, revision history, or write authority.

Payload-facing operations use a Payload-owned request transaction adapter. The
adapter compiles supported field behavior into the same trusted row, index,
unique, and edge primitives used by app data; it does not bypass the scope
commit lane or accept physical sidecars from user code.

## Developer Relation API

Flarex should use one inline logical relation declaration, not require
developers to maintain a second Drizzle-style `defineRelations()` graph. Flarex
owns schema compilation, physical edge generation, reverse API generation, and
codegen, so a second authored declaration would be duplicate schema authority.

The authoring API should combine InstantDB's bidirectional semantic model with
Drizzle's explicit source/target, ambiguity, and traversal discipline:

```ts
posts: table({
  title: string(),
  author: relation.one("users", {
    inverse: "posts",
    inverseCardinality: "many",
    required: true,
    onDelete: "restrict",
  }),
})
```

The compiler, not the developer, expands that declaration into the canonical
manifest definition:

```text
posts.author has one users row
users.posts has many posts rows
```

The generated inverse is an API view over the same relation identity, not a
second stored array or separately owned declaration. Multiple relations between
the same tables require distinct logical names and inverse names; the compiler
must never select one by shape or declaration order.

For a pointer-only many-to-many relation, Flarex generates edge occurrences.
When the association has business data such as role, status, joined time, or
inviter, it is an ordinary application table with two explicit relations. A
filtered view such as `publishedPosts` is a query over a relation, not another
stored relation definition.

The developer DSL is convenience input. The canonical, serializable relation
AST in the immutable schema manifest remains the trusted compiler/runtime
contract. Payload `relationship`, `upload`, and `join` declarations compile to
that same AST.

### AI-generated schema requirements

Most schemas may be generated or revised by agents, so the authoring and plan
contracts must be deterministic and machine-readable:

- declare a relation once and generate the inverse;
- prefer serializable table/logical-name references over callback identity;
- require explicit cardinality, inverse name, delete behavior, ordering,
  localization, and polymorphic targets when applicable;
- reject ambiguous inverse names and multiple candidate relations with a
  precise diagnostic;
- never allow generated code to choose stable numeric IDs or physical table
  names;
- emit a canonical schema/diff plan that an agent can inspect without parsing
  prose or answering an interactive prompt.

## Storage Compatibility Matrix

"Compatible" means that the Payload field API has a deterministic Flarex
representation. It does not mean that every field uses the same physical
shape.

| Payload field category | Authoritative representation | Derived or runtime behavior |
| --- | --- | --- |
| text, textarea, email, code, checkbox, number, date, point, select, radio | tagged value in app row JSON | declared index/unique sidecars where supported |
| JSON and rich text | canonical nested row value | adapter/editor validation and population |
| group, tabs, row, collapsible | schema paths over the same row | no independent storage authority |
| arrays and blocks | ordered nested values with stable item/block IDs | hidden block-type indexes when declared; mutable position is not identity |
| relationship and upload fields | logical reference value in the row | stable current edge occurrence |
| polymorphic relationship/upload | reference plus explicit target table identity | edge carries `target_table_id` |
| join | no duplicated forward value | reverse-edge query over the owning relationship |
| localized field | locale-keyed logical value | locale participates in applicable index, unique, and edge semantics |
| virtual and UI fields | no authoritative stored value | computed/read-time or presentation behavior |
| hooks, access, defaults, validation | no physical field representation | Payload adapter/runtime ordering and policy |

Upload collection metadata may live in the shared app row model, but binary
objects remain behind an object-storage capability. Versions/drafts, globals,
auth/session state, document locks, jobs, preferences, migrations, and other
Payload lifecycle state require later source-driven adapter slices. They must
not be modeled as duplicate ordinary collection documents.

## Relation Definition Contract

`S12` and `C09` must not allocate an opaque relation ID before these semantics
are frozen from the real schema compiler:

```text
relation_id
  stable deployment-scoped logical relation identity

relation semantic definition identity
  immutable schema/API/policy interpretation used by plans and validation

edge definition identity
  immutable physical extraction, occurrence, endpoint, and read-key contract
  used by stored edges, builds, and OCC dependencies

source_table_id
source field identity or canonical schema path
allowed target_table_ids
forward name
reverse name, when exposed
forward and reverse cardinality
requiredness
ordered flag
localized flag
polymorphic flag
on-delete policy in each applicable direction
```

These are three different roles. The stable relation ID survives a compatible
rename or schema activation. The immutable semantic definition changes whenever
schema, API, validation, or policy meaning changes. The immutable edge
definition changes only when the physical edge set or its interpretation
changes: source/path extraction, endpoint identity representation, canonical
occurrence or edge codec, localization/ordering representation, projected edge
facts, or read-key semantics.

A semantic change such as a public name, admin presentation, requiredness, or
delete-policy change may bind a new semantic definition to the same physical
edge definition when R01 proves that the stored edge set and read keys remain
valid. Cardinality, ordering, and localization changes require explicit
classification: some may reuse already-retained facts after validation, while
others require a replacement edge definition and build. Do not force a full
edge rebuild merely because any relation semantic changed, and do not reuse an
edge definition when its physical interpretation changed.

An edge pins the exact edge definition that produced it. A query plan pins the
semantic definition and its edge-definition binding. An OCC dependency pins the
edge definition and exact read shape. `relation_id` alone is insufficient while
old and replacement definitions coexist.

`R02` owns the exact spelling and representation of both immutable identities.
The semantic identity may be schema-artifact-qualified rather than a new
catalog allocation. The physical identity may use a separately branded compact
`edge_definition_id` or another fail-closed representation. R02 must prove:

- one identity never serves logical, semantic-definition, and physical-edge
  roles interchangeably;
- exact replay produces the same binding;
- physically different edge definitions cannot alias;
- semantically different definitions may reuse a physical edge definition only
  through an explicit compatible binding;
- old and replacement edge definitions can coexist through build and
  activation;
- an edge, dependency, and plan can resolve the required identities without
  searching mutable prose or guessing from current schema state; and
- no second mutable definition authority is introduced.

The normalized relation-definition table remains deferred. The immutable schema
manifest is the first source of version-pinned relation definitions, while the
stable catalog supplies deployment-scoped relation identity. A rename may
preserve identity only through an explicit schema migration decision; matching
names or shapes must not guess identity. Deferring a normalized table does not
permit R02 to omit physical edge-definition identity from edges,
build/readiness state, or query plans.

Each stored edge occurrence additionally carries or deterministically derives:

```text
immutable edge definition identity
source row identity
stable nested item/block identity
canonical source path
locale
occurrence codec version
canonical occurrence evidence
stable occurrence identity
mutable list position
target_table_id
target row identity
```

Position is ordering metadata, never occurrence identity. The same target may
appear more than once, in more than one nested item, or in more than one locale.
R01 must decide whether missing locale and an empty locale spelling are
equivalent; storage must not silently choose a sentinel before that decision.
If occurrence or edge identity uses a digest, S12 must retain enough canonical
evidence to detect a collision and fail closed. A digest-only unique constraint
does not by itself implement the repository's hash-plus-evidence policy.

## InstantDB Inspiration And Flarex Divergence

The local InstantDB source confirms a useful portable relation model:

- each attribute has a stable ID, `blob | ref` value kind, `one | many`
  cardinality, forward identity, optional reverse identity, uniqueness,
  indexing, requiredness, and directional cascade metadata;
- the four relationship shapes are represented by cardinality plus uniqueness;
- current triples have forward and reverse access paths for reference traversal.

Flarex ports those schema and traversal ideas, not InstantDB's complete scalar
EAV storage. App/CMS scalar values remain authoritative exactly once in the row
body. Index, unique, and edge rows are rebuildable derived state. Duplicating
each scalar into a generic triple would create a second value authority and is
rejected.

InstantDB reference identity also needs Payload-specific strengthening. A bare
entity/attribute/target triple cannot distinguish repeated targets, nested
array/block occurrences, ordering, paths, or locales. Flarex therefore retains
the richer stable edge occurrence contract above.

## Relation Reads, Exact Snapshots, And OCC

`fx_app_edge_current` is sufficient for trusted current-state admin/query reads
whose contract explicitly permits the latest committed relationship state. It
is not by itself sufficient for a mutation pinned to an earlier
`SnapshotToken.commitSeq`.
PostgreSQL SQL/PGQ changes query notation only; it does not provide Flarex
snapshot reconstruction, read-your-writes, phantom detection, authorization, or
dependency registration.

Mutation relation reads remain rejected until `O10-R` proves one exact one-hop
shape. That gate must choose one of these explicit authorities:

1. edge revision history capable of reconstructing the requested snapshot plus
   an exact adjacency/range dependency; or
2. current edges plus an atomically maintained adjacency version for
   `(scope, edge definition, direction, endpoint)`.

For the current-edge option, a mutation must not merely record the version it
happens to observe. It must:

```text
read the adjacency version before the edge query
require that version <= SnapshotToken.commitSeq
read the current edge result
read the adjacency version again
require both reads to be equal and <= SnapshotToken.commitSeq
register that exact version as the dependency
validate it is unchanged in the final commit transaction
```

A change before or during registration therefore produces a snapshot/OCC
conflict rather than a post-snapshot result; a change after registration fails
final validation. The supported query also needs a complete local
read-your-writes overlay. Multi-hop, arbitrary graph patterns, unsupported
filters, and pagination shapes remain typed rejections until each has bounded
dependency semantics.

The adjacency-version option may create a write hotspot for high-fanout
endpoints. O10-R must measure its lock and write amplification against the edge
history alternative before selecting it. Commit-feed scanning is not the
default third option: it remains rejected unless a separate preflight proves an
exact bounded matching summary and retained-floor contract.

## Optional PostgreSQL SQL/PGQ Projection

PostgreSQL 19 SQL/PGQ is a later capability-gated query adapter, not a storage
milestone or a reason to change relation authority. Flarex retains relational
edge tables and indexed SQL as the canonical portable path. A future adapter
may expose one or a small fixed number of platform-owned property graphs per
physical placement; it must not create a graph object per scope, app, schema
version, or logical relation.

Application developers do not submit raw `GRAPH_TABLE` text. A bounded Flarex
relation/graph API resolves the immutable semantic definition and its physical
edge-definition binding, then may compile a proven fixed-hop shape to
relational SQL or SQL/PGQ without changing scope, authorization, result,
pagination, or OCC semantics. The adapter remains off until:

- the database capability is detected explicitly and the PGlite/older-Postgres
  lane has the relational fallback;
- SQL and SQL/PGQ conformance results match for the selected shape;
- representative planning and execution measurements justify routing that
  shape through SQL/PGQ; and
- unsupported variable-length, unbounded, mutation, or backend-specific shapes
  fail closed.

The first graph projection returns only stable vertex/edge identities and
declared narrow edge properties. It does not expose complete row JSON by
default. The ordinary Flarex row resolver loads and validates documents through
their point-read contract so graph notation cannot bypass row codecs, declared
indexes, authorization, or dependency capture.

## Required Turn Order

These are low-level prerequisites, not a request to execute all Payload work:

1. `R01` - freeze relation/cardinality/delete/identity semantics from Flarex,
   Payload, and InstantDB evidence.
2. `R02` - bind stable relation IDs, immutable semantic definitions, and
   reusable immutable edge definitions into the schema manifest without adding
   a second definition authority.
3. `S12` - add `fx_app_edge_current` using that accepted identity.
4. `C09` - lower final row values into stable current edge occurrences and
   remove stale occurrences atomically.
5. `O10-R` - prove one exact forward or reverse adjacency read, snapshot
   registration, read-your-writes, and phantom/conflict behavior before
   enabling mutation relation reads.
6. Later SQL/PGQ work - prove an optional fixed-hop adapter only after the
   relational path and capability/conformance/benchmark gates exist.
7. Later Payload plan - compile Payload relationship, upload, join, locale, and
   lifecycle semantics through conformance tests.

`R01` and `R02` may be completed shortly before `S12`; they do not block the
current ordered-index, row, point-OCC, or atomic point-commit slices.

## Source Evidence

Payload source inspected at commit
`5081ad4786643e14b21fb5981941ccdceecd55bd`:

- `packages/payload/src/fields/config/types.ts` for field, relationship,
  polymorphic target, `hasMany`, localization, virtual, upload, and join
  contracts;
- `packages/payload/src/fields/config/sanitizeJoinField.ts` for inverse join
  validation and required target indexing;
- `packages/drizzle/src/schema/traverseFields.ts` for scalar/JSON, localized,
  array, block, select-many, and relation physical lowering;
- `packages/drizzle/src/schema/build.ts` for `_rels` parent/path/order/locale
  and polymorphic target columns;
- `packages/drizzle/src/transform/write/relationships.ts` and nested
  array/block transforms for ordered relation rows and stable nested IDs.

InstantDB local source snapshot inspected; it has no repository-local Git
metadata, so an exact revision could not be established:

- `client/packages/core/src/attrTypes.ts` and `schemaTypes.ts` for stable
  attributes, link directions, cardinality, uniqueness, and delete policies;
- `client/packages/platform/src/relationships.ts` and `migrations.ts` for
  relationship-shape lowering and schema evolution;
- `server/resources/migrations/01_bootstrap.up.sql` and
  `server/src/instant/db/model/triple.clj` for current triple indexes and
  forward/reverse reference behavior.

Drizzle source reference:

- <https://orm.drizzle.team/docs/relations> for separate soft-relation query
  definitions, explicit `one`/`many`, `from`/`to`, aliases, reverse traversal,
  and explicit many-to-many `through` mappings. Flarex keeps that explicitness
  but does not expose physical foreign-key/junction choices for generated app
  edge storage.

Convex source was not the primary evidence for this docs checkpoint because the
gap is Payload field compatibility and InstantDB-inspired relation metadata.
The existing Convex-first row, stable-table, snapshot, OCC, and compiler rules
remain unchanged.

## Known Limitations

- No Payload adapter, relation catalog, edge table, compiler, or query behavior
  is implemented by this checkpoint.
- Payload locale fallback, hook ordering, access control, draft/version
  visibility, upload object lifecycle, and transactional conformance need
  dedicated source-driven plans and tests.
- Cross-owner relations involving Medusa require a trusted Medusa resolver and
  deletion/staleness policy; they do not move Medusa rows into app storage.
- Relation-range history and OCC may require `fx_app_edge_rev`; current-edge
  storage alone proves neither historical relation reads nor an exact-snapshot
  mutation read without the `O10-R` adjacency-version protocol.
- The exact semantic- and edge-definition identity representations, edge DDL,
  canonical occurrence codec, collision response, adjacency version storage,
  and SQL/PGQ adapter package remain intentionally unfrozen until their owning
  gates.

## Checkpoint Record

Previous completed checkpoint: `9fe45b5` - `Persist stable logical index catalog`.

What changed: froze the no-duplication Payload binding rule, classified all
Payload field families by Flarex representation, documented the portable
InstantDB relationship ideas and rejected scalar EAV duplication, and inserted
`R01`/`R02` as explicit prerequisites for edge storage and lowering.

Why: the existing roadmap jumped from deferred relation semantics to `S12` and
`C09`. That left stable relation allocation, reverse/cardinality semantics, and
Payload nested/localized occurrence requirements underspecified.

Verification for this docs-only checkpoint:

```sh
git diff --check
rg -n "R01|R02|no duplicated|one authoritative|Payload Relational" \
  roadmaps/flarexdb-foundation
```

### Relation API Refinement Checkpoint

Previous completed checkpoint: `a4f3aec` -
`Freeze Payload relational compatibility contract`.

What changed: selected one inline Flarex relation declaration that compiles to
an InstantDB-inspired bidirectional canonical manifest, retained Drizzle-style
explicitness and ambiguity checks, distinguished pointer edges from
association entities, and added deterministic AI-generation requirements.

Why: requiring both field declarations and a separate relation-definition file
would duplicate authored schema authority, while fully inferred relations would
hide cardinality, inverse, deletion, and rename intent needed for safe deploys.

Convex source files were not inspected for this API-only refinement because
Convex document IDs do not define the richer bidirectional Payload relation
surface being decided here. Existing Convex-first schema artifact, codegen, and
deployment rules remain unchanged.

Known follow-up: `R01` still owns the exact public TypeScript names and
canonical AST schema. The examples above are normative semantics, not a frozen
package API signature.
