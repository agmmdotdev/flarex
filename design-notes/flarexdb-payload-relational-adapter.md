# FlarexDB Payload Relational Adapter

Status: accepted adapter-boundary correction; no Payload adapter is implemented by this note

Last reviewed: 2026-08-23

This note defines how a future Payload database adapter and Payload-backed CMS
surface consume the native FlarexDB relational system. The native database
model is owned by
[`flarexdb-native-relational-system.md`](./flarexdb-native-relational-system.md).
This document does not redefine relation identity, edge occurrence storage,
snapshot/OCC behavior, commit authority, or schema activation.

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
  Payload collection configuration is compiled into the canonical Standard
  and FlarexDB schema representation;
  generated Flarex data APIs may expose that same table when allowed.
```

An additional API surface does not create another table identity, row body,
revision history, relation definition, or write authority. Conflicting
cardinality, target, localization, ordering, requiredness, or delete policy
between two surfaces must fail definition analysis.

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

Payload may allow repeated values in a has-many relationship. The adapter must
lower them through the native repeated-occurrence contract. It must not use
mutable list position as identity or introduce a Payload-only edge table.

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

The adapter compiles supported operations into the same trusted FlarexDB
primitives:

```text
row revisions/current pointers
ordered index sidecars
unique claims
current edge occurrences
selected edge-history or adjacency-version snapshot-support actions
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

## Versioned Adapter Packages

The Payload-facing implementation should separate a version-neutral FlarexDB
adapter kernel from version-specific Payload interfaces:

```text
@flarex/payload-adapter-core
  normalized operations, trusted FlarexDB capabilities, result/error mapping,
  and shared conformance fixtures

@flarex/payload-adapter-v3
  current stable Payload interface bindings

@flarex/payload-adapter-v4
  pinned Payload v4 interface bindings after an explicit source/release gate
```

Payload types must not enter the canonical relation protocol, Standard
Application definition package, function runtime, executor, or Postgres
persistence package.

Both version bindings should run the same normalized behavioral suite. A
framework version change that only alters TypeScript or adapter interface shape
must not create a new physical relation meaning.

### Separate Adapter-Core And Relation Gates

Payload work has two distinct proofs:

1. an adapter-core preflight pins the Payload version and inventories the exact
   database-adapter methods, query shapes, schema/migration lifecycle,
   repositories, request transaction IDs, nested Local API behavior, and error
   mapping that the first release claims; it then proves a relation-free
   collection CRUD/find/count/request-transaction matrix; and
2. only after native `SV-R`, a relation-mapping gate lowers the admitted Payload
   field shapes to native relation intent and composes bounded forward
   population and reverse joins over the proven native identity read plus
   ordinary document point reads.

The second proof does not widen the first one's method matrix. An unsupported
join filter, sort, count projection, fractional/orderable join, migration mode,
or limit must reject during startup, analysis, or query planning before data
access.

## Initial Truthful Adapter Cut

The first Payload adapter claim should be narrow:

```text
collections only
one Payload-owned or Flarex-owned table binding
versions disabled
drafts disabled
non-auth
non-global
top-level nonlocalized scalar fields
top-level monomorphic one/many relationships
duplicate relationship targets rejected
reverse maximum cardinality many
relation-free adapter-core CRUD/find/count/request-transaction matrix proven
bounded forward population and reverse-join composition
reverse join only after native incoming adjacency is ready
no join filter, sort, count projection, orderable join, or unbounded limit
```

Later slices add:

```text
polymorphic relationships
localized fields
arrays and blocks with stable nested identities
uploads and object lifecycle
join filtering/sorting/orderable behavior
versions and drafts
globals
auth and sessions
locks, jobs, preferences, and migrations
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
- draft/version visibility once supported;
- target deletion, stale references, and repair behavior;
- exact commit/change/outbox agreement with native FlarexDB state.

PGlite is the fast lane. Genuine Postgres is required for transaction,
concurrency, uniqueness, edge pagination, rollback, and adapter integration
acceptance. Payload's own relevant relationship and database-adapter tests
should be ported or invoked against the version binding where licensing and
fixture boundaries permit.

## Rejected Adapter Designs

```text
making Payload configuration the canonical FlarexDB relation AST
creating a duplicate Payload document for an existing Flarex row
letting both app and Payload schema independently own one table
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
8. completed R03's fenced relation commit facts and native sync invalidation;
9. completed the production-inert internal `SV-R` vertical.

The adapter can then compile Payload relationship, upload, and join semantics
onto the proven FlarexDB capabilities. Payload research informs conformance;
it does not move ahead of the native database foundation.
The first adapter may omit a live-subscription promise, but if it makes one it
must consume R03's proven facts, registration fence, retention, reconnect, and
resnapshot behavior rather than inventing an adapter-local invalidation path.
