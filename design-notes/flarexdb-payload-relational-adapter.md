# FlarexDB Payload Relational Adapter

Status: accepted adapter-boundary correction; exact `payload@3.88.0` source
audit and native non-reactive relation prerequisites are complete, but no
Payload adapter is implemented by this note

Last reviewed: 2026-09-02

This note defines how a future Payload database adapter and Payload-backed CMS
surface consume the native FlarexDB relational system. The native database
model is owned by
[`flarexdb-native-relational-system.md`](./flarexdb-native-relational-system.md).
This document does not redefine relation identity, edge occurrence storage,
snapshot/OCC behavior, commit authority, or schema activation.

Shared artifact, installation, binding, migration-host, transaction-host, and
commit-finalizer mechanics are owned by
[`flarexdb-framework-storage-architecture.md`](./flarexdb-framework-storage-architecture.md).
Payload implementation order and status are owned by
[`../roadmaps/flarexdb-framework-integration/07-payload-adoption.md`](../roadmaps/flarexdb-framework-integration/07-payload-adoption.md).
The exact pinned contract and first-profile constraints are owned by
[`../roadmaps/flarexdb-framework-integration/preflight/07-payload-release-and-adapter-contract.md`](../roadmaps/flarexdb-framework-integration/preflight/07-payload-release-and-adapter-contract.md).
The accepted design-only relational installation and structural migration
authority is owned by
[`../roadmaps/flarexdb-framework-integration/preflight/09-relational-installation-and-migration-coordination.md`](../roadmaps/flarexdb-framework-integration/preflight/09-relational-installation-and-migration-coordination.md);
it does not make Payload content a relational-schema consumer.

The executable low-level prerequisites remain in
[`../roadmaps/flarexdb-foundation/04-payload-relational-contract.md`](../roadmaps/flarexdb-foundation/04-payload-relational-contract.md).
The filename is retained for stable links, but the roadmap now begins from the
FlarexDB-native contract rather than from Payload's field API.

## Decision

Payload is a framework adapter over FlarexDB, not the source of FlarexDB's
relation semantics.

```text
Payload configuration and request behavior
  -> Payload adapter compiler/runtime
  -> Standard Application relation intent and FlarexDB System capabilities
  -> native FlarexDB row/index/unique/edge/commit authority
```

The reverse dependency is rejected:

```text
FlarexDB relation APIs
  != renamed Payload relationship/upload/join APIs

FlarexDB physical storage
  != a clone of Payload's _rels tables
```

Payload source remains important conformance evidence. It tells the adapter
which observable field, request, transaction, query, population, version, and
admin behavior must be reproduced. It does not become the canonical database
AST or private kernel contract.

Sharing one authoritative FlarexDB row does not make an ordinary `ctx.db`
mutation equivalent to a Payload operation. Payload access, defaults,
validation order, hooks, locks, localization, drafts, versions, population,
and nested request transactions are adapter-owned command semantics. A direct
row mutation preserves only the invariants enforced by FlarexDB itself. The
table's write-policy owner therefore must be explicit before an editable CMS
surface is generated.

## One Table, One Authority, One Schema Owner

A Payload collection may expose an existing Flarex application table without
creating a second copy of its rows:

```text
Payload collection slug
  -> one existing stable Flarex table identity
  -> one authoritative fx_app_row_rev history
  -> one fx_app_row_current pointer
```

For each logical table there is one schema owner:

```text
app
  Flarex/Standard application schema is authoritative;
  Payload configuration is generated or constrained by that schema.

payload
  Payload collection configuration enters authenticated Application Analysis
  and is compiled into the canonical Standard and FlarexDB schema representation;
  the separate Payload configuration digest is policy/provenance evidence only;
  generated Flarex data APIs may expose that same table when allowed.
```

An additional API surface does not create another table identity, row body,
revision history, relation definition, or write authority. Conflicting
cardinality, target, localization, ordering, requiredness, or delete policy
between two surfaces must fail definition analysis.

## CMS Exposure And Write Authority

CMS exposure is not one ambiguous Boolean marker. The accepted product model
distinguishes these authority modes:

| Mode | Payload dashboard | Ordinary reads | Ordinary writes |
| --- | --- | --- | --- |
| app table | absent | `ctx.db` | `ctx.db` |
| CMS view | read-only presentation over an app-owned table | `ctx.db` | app-owned `ctx.db` or domain commands |
| CMS managed | editable Payload lifecycle over the shared row | published/current `ctx.db` view where allowed | one adapter-owned private Payload command pipeline through enabled surfaces, including planned `ctx.cms` when separately activated |
| app-command managed | dashboard actions delegate to app-owned commands | app-owned reads | app-owned commands only |

The names `cms.view`, `cms.manage`, and an eventual delegated-command form are
illustrative developer ergonomics, not frozen public syntax. Their authority
meaning is not optional:

- a read-only CMS view cannot mutate the table through Payload;
- an editable CMS-managed table has one ordinary write pipeline, the Payload
  operation pipeline used by whichever Payload surfaces are enabled, including
  a generated `ctx.cms` facade only after its separate public gate;
- ordinary Dynamic Worker `ctx.db.insert`, `patch`, `replace`, and `delete`
  capabilities exclude CMS-managed tables in generated types and reject an
  unauthorized bypass at runtime;
- an app-command-managed table, such as an order or workflow aggregate, remains
  read-only in the CMS until dashboard actions can call its owning commands;
- migration, backfill, repair, import, and fixture capabilities are separately
  privileged. They may bypass CMS lifecycle policy, but never FlarexDB schema,
  relation, uniqueness, commit, edge, OCC, feed, or outbox invariants.

Payload-owned collections imply CMS-managed write authority. The first writable
proof independently digests the pinned Payload configuration and stable policy
ID, then uses a new table whose authenticated Application artifact already
rejects ordinary app writes and records that digest. Only afterward does the
content overlay bind the configuration digest to the finalized Application
artifact, exact active head/schema/readiness/placement evidence, and table
identities. Application has no generic framework installation. Payload writes
remain unavailable until that paired overlay is active. An app-owned table may
be presented read-only. Transferring an already app-writable table to CMS-managed authority
is deferred until the Application owner proves atomic capability revocation and
overlay activation with no dual-writer interval. Merely adding labels, layouts,
or admin widgets never transfers authority.

For a CMS-managed table, the Payload dashboard, REST/GraphQL adapters where
enabled, Payload Local API compatibility, and generated `ctx.cms` developer
operations must converge on one command implementation:

```text
dashboard / REST / GraphQL / ctx.cms
  -> authenticated Payload operation context
  -> access/defaults/validation/hooks/lifecycle
  -> one Payload-owned request transaction
  -> trusted FlarexDB row/index/unique/edge/commit capabilities
```

The normal request-scoped Flarex `ctx.cms` facade respects its current
principal and collection policy by default. A trusted system override must be
explicitly named and separately authorized; Payload Local API compatibility
must not silently export its access-override default as Flarex's ordinary
developer behavior.

## Adapter Mapping

The first mapping is:

| Payload concept | Native FlarexDB representation | Adapter/runtime behavior |
| --- | --- | --- |
| collection | stable logical table | Payload collection registration and API presentation |
| scalar field | canonical value in authoritative row | Payload validation, access, and hooks |
| group/tabs/row/collapsible | canonical typed source path over the same row | Payload form/layout behavior |
| array/block | ordered nested value with stable item/block identity | Payload editor behavior and nested path lowering |
| relationship | stored logical relation value | target validation, population, admin picker behavior |
| polymorphic relationship | tagged target table plus row identity | Payload polymorphic request/response shape |
| upload | relation to a media logical table | object-storage capability and media lifecycle |
| join | no duplicated forward value | reverse FlarexDB adjacency query |
| localized relationship | locale-keyed row value | locale-aware edge occurrence and Payload fallback policy |
| virtual/UI field | no authoritative stored value | computed or presentation behavior |
| hooks/access/defaults/validation | no physical relation representation | Payload request runtime policy |

Payload's physical `_rels` implementation is adapter-specific evidence. Flarex
stores authoritative app/CMS scalar and structured values once in the row body
and uses generic native edges as rebuildable adjacency state. It should compare
observable Payload behavior rather than reproduce a particular official
adapter's table layout.

## Relationship Fields

Payload relationship values compile to native relation definitions and row
values.

```text
relationTo: "users", hasMany: false
  -> one-valued monomorphic FlarexDB relation

relationTo: "users", hasMany: true
  -> many-valued monomorphic FlarexDB relation

relationTo: ["users", "organizations"]
  -> explicitly tagged polymorphic FlarexDB relation

required, minRows, maxRows
  -> owning-side requiredness or min/max item policy

localized
  -> locale participates in row and edge occurrence semantics
```

Payload names are adapter-level assertions. Stable logical table, relation, and
physical edge-definition identities are selected by the FlarexDB schema
lifecycle. A collection or field rename does not implicitly preserve or replace
identity; it must participate in an explicit schema evolution plan.

The first adapter relation profile rejects repeated targets. A later focused
gate may admit Payload configurations that allow repeats only after the native
repeated-occurrence contract, stable occurrence identity, ordering, mutation,
OCC, and conformance behavior are all proven. It must not use mutable list
position as identity or introduce a Payload-only edge table.

## Upload Fields

An upload is a relation to a media collection plus binary-object lifecycle.

```text
media document metadata
  -> authoritative FlarexDB row when the collection is Flarex-owned

binary object
  -> object-storage capability and adapter-owned lifecycle

upload field value
  -> native relation and derived edge occurrence
```

Deleting or replacing an object, generating image variants, signing URLs, and
checking object access are not generic edge operations. Those behaviors remain
in the Payload/upload adapter while metadata references use the same native
relation system.

## Join Fields

A Payload join is a virtual adapter field over a native reverse adjacency read.
It stores no duplicate target-side array.

```text
posts.category -> categories
categories.relatedPosts join
  = incoming adjacency over posts.category
```

The adapter must resolve the owning relation unambiguously from the canonical
schema binding. It cannot guess between multiple relations connecting the same
tables by declaration order or compatible shape.

Payload join filtering, sorting, pagination, counts, orderable joins, depth, and
admin editing are later conformance layers over bounded native relation and
ordered-index operations. The native first relation read remains one exact
one-hop adjacency shape; unsupported Payload join options must fail closed until
proved.

## Nested And Localized Relations

Payload arrays and blocks carry stable nested row or block identities that can
participate in the native edge occurrence codec. The adapter must preserve
those identities when creating, duplicating, moving, restoring, or localizing
content.

A nested relation occurrence includes:

```text
edge definition
source row
canonical typed source path
stable enclosing array/block item identity
locale presence/value
target table and row
duplicate occurrence discriminator
position as ordering metadata only
```

The native Flarex row model must support the required stable nested identity
before the adapter enables a corresponding field. Payload support is not
permission to infer identity from a current array offset.

Payload locale fallback is response and request behavior. It must not silently
rewrite the stored locale identity used by uniqueness, edge occurrence,
adjacency, or OCC. The adapter needs explicit conformance tests for exact locale,
fallback locale, missing locale, and empty/invalid locale behavior.

## Request Transactions

Payload-facing operations use a Payload-owned request transaction adapter.
Payload's request may create or update multiple documents through hooks and
nested Local API calls; all supported operations using the same request must
commit or roll back according to Payload's observable transaction behavior.
Dashboard and generated `ctx.cms` operations carry the same authenticated
request context into that adapter. A nested CMS operation must reuse it rather
than silently opening a second transaction.

The adapter compiles supported operations into the same trusted FlarexDB
primitives:

```text
row revisions/current pointers
ordered index sidecars
unique claims
current edge occurrences
selected endpoint adjacency-version actions
scope-local commit/change facts
outbox work
result/outcome evidence where applicable
```

It does not expose or accept caller-authored physical sidecars, commit headers,
outbox rows, relation IDs, edge-definition IDs, SQL, Drizzle, or Postgres
transaction handles.

Payload request transactions are not silently encoded as the untrusted Dynamic
Worker `SessionJournalV1` execution path. They are a separate trusted adapter
lane that converges on the same authoritative Postgres scope clock, commit
feed, and outbox. Sharing the commit authority does not require sharing the
user-code transaction protocol.

Pinned Payload `3.88.0` runs collection/field hooks before the outer request
commits and permits arbitrary callback, file, and remote work in that interval.
The first Flarex profile therefore rejects user hooks, dynamic access callbacks,
uploads, and remote effects. A fixed conformance-only nested callback may prove
same-request reuse; general hook compatibility requires a later transaction and
lifecycle preflight rather than an unbounded SQL transaction.

Ordinary `ctx.db` reads may consume the table's allowed current projection, but
they do not acquire Payload operation authority. Once drafts or versions are
supported, the ordinary app-data view is the published/live projection unless
an explicitly authorized CMS read requests another visibility domain. Engine
row history is never an implicit editor-version view.

## Versions, Drafts, And Visibility

Flarex engine revision history and Payload user-visible versions are different
authorities.

```text
fx_app_row_rev
  exact database history for current state, snapshots, OCC, sync, and retention

Payload version/draft state
  editor-visible restore, autosave, publication, scheduled publication,
  locale publication, and version query behavior
```

Payload versions and drafts must not be represented by treating engine row
history as the editor version collection. Draft relation edges must not pollute
live/published reverse adjacency, delete restrictions, or storefront
invalidation. The later adapter design must freeze the visibility domain for
current, draft, historical-version, and published relation projections before
adding physical lifecycle tables.

Until that work exists, the first adapter slice must explicitly disable
versions and drafts rather than relying on framework defaults.

## Population And Depth

Payload depth is an adapter population policy, not a FlarexDB relation storage
property.

Forward population may read target IDs from the authoritative source row and
perform bounded target point reads. Reverse join population uses native edge
adjacency. Every populated document is validated through its normal table and
row codec; graph or edge access never returns unchecked complete row JSON.

The first adapter must enforce explicit ceilings for:

```text
population depth
number of populated fields
has-many relation items
join page size
joined documents
nested array/block occurrences
```

It must avoid hidden unbounded N+1 behavior and fail closed on unsupported
polymorphic or nested filters.

## Hooks, Access, Validation, And Defaults

Payload hooks, access control, field validation, defaults, filtering options,
and operation ordering remain adapter/runtime policy. They are not stored in
edge rows and do not alter native edge identity merely because a callback
changes.

The adapter must establish conformance for at least:

```text
beforeValidate / beforeChange / afterChange ordering
field and collection access
filterOptions validation
nested Local API calls sharing the request transaction
async hook failure and rollback
read population after access filtering
returning/select/locale behavior
```

A semantic policy change can require a new immutable relation semantic
definition while reusing the same physical edge definition if the stored edge
set and read keys remain valid. The native compatibility classifier owns that
decision.

## Schema And Migration Ownership

Payload content schema and Payload lifecycle migrations have different owners:

```text
Flarex platform DDL
  -> Flarex platform migration owner

Application-owned CMS view
  -> authenticated Application declaration and active artifact
  -> Payload configuration validates against exact table identities

Payload-owned content collection
  -> pinned Payload compiler output with explicit provenance
  -> existing authenticated Application Analysis/publication chain
  -> canonical Application schema candidate
  -> existing managed-schema readiness and activation

Payload lifecycle/data migration
  -> Payload-owned semantic migration plan
  -> future fenced host only after a Payload migration-host preflight
  -> native row/relation/unique/commit invariants retained
```

Payload and Medusa do not share a migration language. Production startup fails
closed on schema mismatch and never silently applies framework migrations.

The Payload compiler has no direct schema publication or activation authority.
If the current authenticated Application Analysis chain cannot admit generated
schema input without changing its sole-source contract, that owner change needs
a separate preflight before adapter implementation.

## Adapter Package And Compatibility

The Payload-facing implementation uses one implementation-bearing package with
plain current semantics:

```text
@flarex/payload-adapter
  normalized Payload operations
  pinned compatibility bindings
  trusted FlarexDB storage capabilities
  result/error mapping and conformance fixtures
```

Payload types must not enter the canonical relation protocol, Standard
Application definition package, function runtime, executor, or Postgres
persistence package.

Payload release compatibility belongs in package-local bindings and artifact
provenance rather than parallel version-named packages. Every supported binding
runs the same normalized behavioral suite. A framework release change that only
alters TypeScript or adapter interface shape must not create a new physical
relation meaning.

### Separate Adapter-Core And Relation Gates

Payload work has two distinct proofs:

1. the completed adapter-core preflight pins Payload `3.88.0` and inventories
   the exact
   database-adapter methods, query shapes, schema/migration lifecycle,
   repositories, request transaction IDs, nested Local API behavior, and error
   mapping that the first release claims; it then proves a relation-free
   content-collection CRUD/find/count/request-transaction matrix while retaining
   the sanitized configuration's dormant auth and internal definitions; and
2. only after native `SV-R Core`, a relation-mapping gate lowers the admitted Payload
   field shapes to native relation intent and composes bounded forward
   population and reverse joins over the proven native identity read plus
   ordinary document point reads.

The second proof does not widen the first one's method matrix. An unsupported
join filter, sort, count projection, fractional/orderable join, migration mode,
or limit must reject during startup, analysis, or query planning before data
access.

## Application/CMS-To-Commerce References

Payload may manage an application or CMS extension row that refers to a stable
commerce identity. It may mutate only the extension row; target mutation goes
through the commerce lane.

This reference is neither a Payload reverse join nor a Medusa Module Link.
Cross-owner existence, deletion, soft-delete, visibility, staleness, and binding
compatibility require the separate private cross-domain reference contract in
the framework-integration roadmap.

## Initial Truthful Adapter Cut

The first private adapter claim is a relation-free scalar core:

```text
one exercised Payload-configured scalar content collection compiled through authenticated Application Analysis
one explicit dormant auth collection required by sanitized Payload config
Payload content overlay references exact Application artifact/head/schema/readiness/placement/table/policy evidence
one CMS-managed write-authority mode
Payload writes remain inert until the exact content overlay is active
editable CMS-managed bindings write only through the Payload operation pipeline
ordinary ctx.db writer capability rejects CMS-managed bindings
private command pipeline suitable for later dashboard and ctx.cms composition
versions disabled
drafts disabled
auth operations disabled; sanitized config is not auth-free
non-global
top-level nonlocalized scalar fields
relation-free adapter-core CRUD/find/count/request-transaction matrix proven
no generated ctx.cms, dashboard route, or public compatibility claim
always-present payload-preferences and payload-migrations plus the preferences
  polymorphic relation inventoried but not treated as scalar dashboard/lifecycle parity
document locking, jobs, folders, query presets, and optional internal surfaces
  disabled
dedicated fail-closed KV adapter prevents default payload-kv injection and
  rejects all KV use
user hooks, dynamic access callbacks, uploads, and remote effects disabled
```

After that private scalar proof, the non-reactive relation slice may add:

```text
top-level monomorphic one/many relationships
duplicate relationship targets rejected
reverse maximum cardinality many
bounded forward population and reverse-join composition
reverse join only after native incoming adjacency is ready
no join filter, sort, count projection, orderable join, or unbounded limit
```

Dashboard, enabled Payload HTTP surfaces, broader Local API surfaces, and
generated `ctx.cms` are separately activated product surfaces. When admitted,
they must converge on the same Payload command pipeline and prove equivalent
hooks, access, transaction, error, and write-authority behavior; their existence
is not part of the private adapter-core claim. The dashboard additionally waits
for dedicated preferences, auth, locking, polymorphic-relation, and lifecycle
support; the first monomorphic content-relation slice is not sufficient.

Later lifecycle islands add:

```text
polymorphic relationships
localized fields
arrays and blocks with stable nested identities
uploads and object lifecycle
join filtering/sorting/orderable behavior
versions and drafts
globals
auth and sessions
document locks, jobs, preferences, and scheduled-publication collection migrations
```

A partial adapter must reject unsupported configuration during startup or
schema analysis. It must not accept a field and silently store it as arbitrary
JSON without relation, uniqueness, visibility, or transaction semantics.

## Conformance Requirements

The adapter suite should record whether each behavior is supported or rejected
by the pinned version and current slice, then compare the claimed observable
behavior, including:

- create, update, replace, delete, and rollback;
- one, many, polymorphic, nested, and localized value shapes;
- required/min/max and invalid target handling;
- repeated values and ordering;
- relationship filtering and admin option validation;
- forward population and reverse joins;
- selection, locale, depth, pagination, counts, and sort;
- hook/access ordering and nested request transactions;
- dashboard/REST/GraphQL/`ctx.cms` command equivalence for every claimed
  operation;
- generated-type exclusion and runtime rejection of unauthorized direct writes
  to CMS-managed tables;
- explicit system override, migration, repair, and import behavior without
  bypassing native FlarexDB invariants;
- draft/version visibility once supported;
- target deletion, stale references, and repair behavior;
- exact commit/change/outbox agreement with native FlarexDB state.

PGlite is the fast lane. Genuine Postgres is required for transaction,
concurrency, uniqueness, edge pagination, rollback, and adapter integration
acceptance. Payload's own relevant relationship and database-adapter tests
should be ported or invoked against the version binding where licensing and
fixture boundaries permit.

Current upstream reference evidence, rechecked against Payload `3.88.0` on
2026-09-01:

- [Payload Local API](https://payloadcms.com/docs/local-api/overview) records
  that local operations expose the REST/GraphQL operation family, accept
  lifecycle options, and require the request to be threaded through nested
  operations for transaction participation.
- [Payload Local API access control](https://payloadcms.com/docs/local-api/access-control)
  records that upstream local operations override access by default unless the
  caller explicitly supplies user context and disables the override. Flarex's
  ordinary request-scoped `ctx.cms` decision above is intentionally safer; an
  adapter compatibility layer may preserve upstream behavior only behind an
  explicit trusted authority.
- [Payload collection hooks](https://payloadcms.com/docs/hooks/collections)
  records the server-side validation/change/read/delete lifecycle that direct
  FlarexDB row writes cannot be assumed to execute.

The exact release pin and source audit are accepted in the focused preflight.
Any release change must refresh that record and its runtime conformance; these
living documentation pages do not silently float the compatibility target.

## Rejected Adapter Designs

```text
making Payload configuration the canonical FlarexDB relation AST
creating a duplicate Payload document for an existing Flarex row
letting both app and Payload schema independently own one table
allowing ordinary ctx.db writes to bypass an editable CMS-managed lifecycle
making a read-only CMS presentation silently writable
letting a dashboard mutate an app-command-owned aggregate as raw row data
copying official _rels DDL as the native edge model
storing target-side reverse arrays to implement joins
routing Payload request transactions through untrusted SessionJournalV1
using engine row history as Payload versions
enabling drafts without visibility-specific edge semantics
accepting unsupported fields as untracked JSON
exposing SQL, Postgres clients, edge IDs, or commit facts to Payload hooks
```

## Required Order

Payload relational work begins only after the native system has:

1. rebased relation intent on authenticated executable function-registration/
   schema modules, Application Analysis, and an explicit manifest contract
   evolution;
2. frozen the first Standard relation and occurrence contracts;
3. selected the exact-snapshot support and physical access path before DDL;
4. bound stable relation and immutable edge definitions;
5. added current-edge plus selected snapshot-support storage and atomic
   row-to-sidecar lowering;
6. built, validated, and enabled edge definitions for existing rows;
7. proved the native incoming relation read, activated one private relation
   revision through the existing owner, and composed the read-only Standard
   query required by the adapter;
8. completed typed native relation commit facts; and
9. completed the production-inert non-reactive `SV-R Core` vertical.

The adapter can then compile Payload relationship, upload, and join semantics
onto the proven FlarexDB capabilities. Payload research informs conformance;
it does not move ahead of the native database foundation.
The non-reactive adapter may proceed without R03-B. A live-subscription,
invalidation, reconnect, or resnapshot claim requires R03-B and `SV-R Live` and
must consume their proven facts, registration fence, retention, reconnect, and
resnapshot behavior rather than inventing an adapter-local invalidation path.
