# Payload Configurable Optional-One Relationships

Status: proposed; implementation awaits approval of this compiler, Analysis
contract and request-bound target-read scope.

## Outcome And Scope

Let ordinary private Payload construction consume one supported native
relationship definition instead of reserving relations for fixed conformance
collections. The decisive fresh-install proof is `articles.author -> authors`:
two Payload-owned collections, a differently named optional relationship,
actual Local API CRUD and bounded standalone depth-one population.

Authoring remains native Payload configuration, for example:

```ts
[
  { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
  { slug: "articles", fields: [
    { name: "headline", type: "text", required: true, unique: true },
    { name: "author", type: "relationship", relationTo: "authors" },
  ] },
]
```

The existing compiler owns the derived validator, relation declaration and
configuration identity. The caller must not supply table IDs, relation ordinals,
hashes, a second Flarex schema, or population handlers.

Admit zero or one relationship across the compiled collection set. The new
relationship is top-level, optional, monomorphic and nonlocalized, with
target-delete restrict and no exposed inverse field. Its target must be a
Payload-owned collection in that same checked set. Preserve self-targeting for
the existing optional-one profile; the new consumer proves cross-collection
routing. All existing scalar, collection, field, page, document, request and
population bounds remain in force. This is not a promise of scale at those
ceilings.

Keep arbitrary many/join configuration, required relations, multiple relation
declarations, polymorphism, relation predicates, optional scalar fields, nested
fields, custom defaults/validation/access/hooks, projections, auth/dashboard,
uploads, drafts/versions, subscriptions, public SDK/routes, deployed artifacts,
existing-row migration, ownership transfer and cross-domain references out of
scope. The existing fixed many/join profiles remain supported regressions, not
additional configurable capabilities. Combined Commerce/CMS commands remain
scalar-only; this proposal does not extend their relation admission.

## Governing Evidence And Why Now

The [accepted database design](../../../design-notes/flarex-db-accepted-design.md),
[Payload boundary](../../../design-notes/flarexdb-payload-relational-adapter.md)
and [package boundaries](../../16-package-boundaries.md) retain one Application
row/relation/schema authority. Payload owns native behavior and translation;
Analysis owns authenticated declarative compatibility; persistence owns live
admission, storage, settlement and publication.

The [scalar configuration gate](./54-payload-collection-configuration.md) now
accepts independently named collections through one ordinary runtime. The
[optional-one relation](./20-payload-content-relations-and-rebinding.md) and
[bounded population](./21-payload-many-transition-and-bounded-population.md)
already have fixed-profile consumer proofs. The missing connection is the
configuration-to-relation-to-runtime path, not a new relation storage engine.
Performance work is not part of this capability.

Current source evidence and affected owners:

| Owner | Current restriction | Proposed disposition |
| --- | --- | --- |
| `packages/payload-adapter/src/collections.ts` | Scalar-only native field decoder; generated declaration has no relations. | Compile the admitted optional relationship using the existing capture, native sanitation, schema-authoring and Analysis path. |
| `packages/analysis/src/applicationWritePolicy/model.ts`, `schemaCompatibility.ts` | Optional-one name/target are fixed to `relatedPost`/`posts`; relation comparison assumes the exact fixture. | Authenticate checked field/source/target identities and compare their complete native declaration; retain exact many/join constraints. |
| `packages/payload-adapter/src/profile.ts` | Ordinary binding registers `relationCount: 0`. | Register the actual checked zero/one count with the exact compiled identity through the existing issuer. |
| `packages/persistence-postgres/src/cmsTransaction/admission.ts` | Zero/one/two relation counts are checked against the existing profiles. | Retain the profile/count ceiling and current acceptance; verify the newly admitted one-relation configuration still agrees exactly. |
| `packages/payload-adapter/src/inputs.ts`, `adapter.ts`, `population.ts` | Input, null removal, projection and population inspect fixed relation names; request admission permits only the root collection. | Drive optional-one translation from owned collection metadata and admit only root-evidenced, target-specific loader reads. |
| `packages/persistence-postgres/src/cmsTransaction/documents.ts` | Existing `getMany` already accepts an admitted table name, checks each ID's table, and borrows the request lifetime. | Reuse it unchanged; no table scan, SQL bypass or new transaction for population. |
| `packages/persistence-postgres/src/applicationWriteOwnership/Successor.ts` | Authorizes only the recorded scalar-to-optional-`posts.relatedPost` successor. | Retain that exact transition; prove this fresh-configuration expansion does not grant new migration authority. |

The executing package remains `payload@3.88.0`, checked at
`packages/payload-adapter/node_modules/payload/package.json`. Its installed
primary sources establish the relevant behavior:

- `dist/fields/validations.js`: native relationship validation checks required
  input and ID shape, then filter options. It is not Flarex target-liveness proof.
- `dist/fields/hooks/afterRead/relationshipPopulationPromise.js`: population
  selects `field.relationTo`, uses the request loader and mutates the output
  slot; unresolved non-trash targets may fall back to their ID.
- `dist/collections/dataloader.js`: keys include target collection, transaction,
  depth/access/projection context; compatible requests produce target-collection
  `find` calls with `id.in` and no pagination. Native batches run sequentially.

Keep those algorithms native. Flarex's target-integrity, bounded-read and
corruption-refusal constraints are additional private-profile contracts, not
claims that Payload itself supplies them.

## Contract And Implementation Direction

### Compilation And Authenticated Meaning

Extend the existing native definition decoder with the optional-one shape.
Capture unknown author data before sanitation; reject executable options,
unknown targets and ambiguous slug-to-logical-name mappings. Sanitize an owned
copy and verify that native defaults and field order match the admitted meaning.
Use native `relationTo` slugs for Payload and their checked logical-table mapping
for Application ID validators and relation targets. A hyphenated target fixture
must prove those identities are not confused.

Reuse `applicationIdValidatorJson` and the existing object/schema authoring
owners. Emit the existing relation-declaration format and let authoritative
relation analysis assign/correlate ordinals. Authenticate source table, exact
single-segment field path/forward name, target table, optional cardinality,
localization, inverse-many/null name and restrict policy. Reject both missing
and extra declarations; a matching relation count alone is insufficient.

The compiled configuration selects the existing scalar or optional-one profile.
Its declarations flow through loaded-source Analysis, policy verification,
manifest publication, readiness, activation and exact content/lifecycle binding.
The compiler still initializes no Payload runtime, installs no database state
and issues no serving authority. Integration source references remain fixture
artifacts, not a deployment proof.

### Request And Target-Read Boundary

Keep six operation families and collection selection in request identity.
Keep the root collection immutable for the request; do not change a shared
`current collection` while Payload's loader visits the target.

Use the root's checked relation metadata to register only observed target
references. Admission must bind target collection/table and IDs together.
Permit the native loader's existing bounded `find` form only for that evidence
and the same live request, scope, transaction, depth and access context. Having
another collection in the compiled set must not authorize an arbitrary nested
read, cross-collection mutation, user-supplied `id.in`, or lifecycle collection.
Resolve target output with its own collection metadata, not the root's fields;
an `authors` document must not acquire an artificial `author` or `relatedPost`.

Reuse the existing request-local population ledger, semaphore and
`CmsDocuments.getMany`. Preserve the aggregate target ceiling, root ordering,
duplicate-reference deduplication, occurrence-weighted output-byte accounting,
no overlapping storage operations, cancellation and close behavior. Do not add
a second loader, request lifetime, transaction or population engine.

Depth omission remains zero. Standalone `find` and `findByID` may request one
hop; a collection without outgoing relations returns its ordinary shape with no
target reads. Writes and nested mutation operations remain depth zero. Self-
references/cycles stop at that boundary. A missing target in a populated stored
reference remains a typed corruption refusal, not a successful ID fallback.

### Write And Delete Semantics

Omitted relationship input on create means absent native storage and null in
the Payload result. Omission on update preserves the prior value; explicit null
clears it. A string sets/retargets it. Reject numeric IDs, populated objects and
unadmitted shapes without weakening native validation or failure provenance.
Use the existing patch/replace owner to remove a cleared optional field; do not
store null where Application expects an absent optional ID.

Native relation materialization retains target liveness, table identity,
restrict deletion and edge facts. Article deletion removes its outgoing edge
and exact preference key atomically; author deletion is refused while referenced
and succeeds after clearing/removing references. No target write is implied by
assigning an article's relation. Borrowed failures remain rollback-only, and
only the outer owner settles and publishes.

## Compatibility, Alternatives And Cleanup

The existing descriptor revision already encodes name, logical target and
cardinality. Recommended direction is to extend its admitted optional-one
values without changing the meaning or bytes of previously valid descriptors.
Do not add a format version solely for a wider accepted literal set. Require
old scalar/optional-one/many/join byte/hash vectors and unchanged policy IDs,
timestamp/default semantics and canonical order. If additional encoded meaning
is actually needed, stop for an explicit identity/revision decision rather
than silently reinterpreting revision 3 or adding fallback decoding.

- Retain: authoritative native relation/storage/commit machinery, exact live
  binding checks, existing scalar and fixed many/join contracts, preference
  lifecycle authority, and the exact existing successor exception.
- Extend: existing compiler metadata, optional-one Analysis compatibility,
  ordinary profile registration and request-local target-read admission.
- Replace/delete: optional-one fixture-name branches in the reusable path with
  checked metadata-driven behavior. Fixed collection definitions remain test
  fixtures, not alternate runtime authority; do not keep a separate old
  optional-one execution path after its consumers migrate.
- Defer: generalized many/joins, existing-row evolution, new successor
  exceptions, arbitrary graph traversal and public/hosted exposure.

A compiler-only patch is insufficient because target reads currently fail the
root-collection check. Removing that check globally is unsafe. A new storage
adapter or handcrafted population engine duplicates existing owners. The
recommended correction is the smallest complete metadata-to-admission path.

## Validation And Completion Gates

Before runtime activation, prove compiler/Analysis agreement and exact rejection
of unsupported shapes, unknown/auth/lifecycle targets, duplicate mappings,
altered target/requiredness/delete policy and extra/missing relation evidence.
Exercise author-data mutation and native sanitation without lending mutable
metadata to either runtime or caller. Retain strict malformed-input and error
ordering witnesses; apply the Payload and Effect skills during implementation.

Run the actual compiled `articles`/`authors` Local API proof on PGlite and an
ordinary PostgreSQL role: create with/without author, read at depths zero/one,
page/count consistency, shared targets, retarget, clear, omitted update, article
delete/preference cleanup, restricted author deletion and post-clear deletion.
Add a renamed/hyphenated-target variant to expose hidden fixture assumptions.

Prove wrong-table and foreign-scope IDs, forged target batches, unobserved IDs,
unbound targets, extra loader options, depth overflow, target/output limits,
missing-target corruption, stale binding and post-close operations fail closed.
Prove target read/delete concurrency under the existing lock owner, complete
rollback after relation failure, exactly one publication and cold/replay
recovery. Direct Application writes to both managed collections remain denied.
Existing stored artifacts must not acquire a new configuration-successor path.

Retain scalar, fixed optional-one/many/join and combined scalar-command
regressions. Tests must orchestrate shared analysis/readiness owners rather
than synthesize a manifest or duplicate core state transitions. Run affected
typechecks, source/compatibility guards, core/diff/staged lint and both required
reviewers against the final owned checkpoint. Reconcile the roadmap, remove
temporary diagnostics, stop owned resources and make one scoped verified commit.

This proposed scope includes the named Analysis and adapter admission changes,
not a native relation/storage correction. If a consumer witness exposes another
shared-owner defect or requires different transaction, migration or authority
semantics, preserve the witness and pause at that boundary for approval. Keep
the parallel Medusa and installer work untouched.
