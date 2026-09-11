# Payload Collection Configuration And Admission

Status: proposed implementation preflight; research and design only

## Outcome And Explicit Limits

Let an application supply supported native Payload collection definitions once.
Compile their checked, declarative meaning into the existing authenticated
Application analysis path and compose the Payload Local API runtime from the
same owned metadata. Collection names and field names must no longer be fixed
by the reusable adapter. Capability support remains explicit and fail-closed.

The first new end-to-end proof is two independently named, Payload-owned scalar
collections in one fresh private Node composition. Use different fields and
different unique-field names, with neither collection named `posts`, so the
proof detects remaining fixture coupling. Exercise create, find, findByID,
count, update, and delete through Payload Local API, including preference cleanup.

This does not approve arbitrary Payload configuration. Initially support the
existing flat scalar kinds (text, number, checkbox, date), required stored
fields, literal defaults, managed timestamps, and at most one required unique
text field per collection. Keep the existing query, request, byte, identity,
and statement bounds; define collection/field limits within the existing
analysis ceilings and test their boundaries. Two collections prove routing
and isolation, not scale at the ceilings.

New cross-collection relationships, generalized many/join configuration,
optional/null scalar fields, nested/group/array/block/rich-text fields,
compound or multiple unique constraints per collection, plugins, executable
defaults/validation/access/hooks, auth operations, uploads, versions/drafts,
dashboard/API serving, public SDK syntax, Cloudflare deployment, subscriptions,
existing-row migration, and application-to-Payload ownership transfer remain
out of scope. Existing admitted relation/many/join scenarios remain regressions;
their current capabilities are not permission to generalize them here.

## Why This Slice Now

The runtime cleanup separated conformance instrumentation and typed operation
contracts, but ordinary construction still installs `payloadPostsCollection()`.
The limitation is not merely a constructor parameter: collection-specific
policy also exists in analysis, binding, query admission, unique-error mapping,
test artifact construction, and preference deletion authority.

Adding another example collection without correcting those owners would not
establish a reusable integration. Conversely, generalizing all Payload fields
and lifecycle features at once would hide the first configuration/admission
proof behind unrelated compatibility work.

## Governing Decisions

- [Accepted database design](../../../design-notes/flarex-db-accepted-design.md):
  Postgres is authoritative; framework execution profiles do not become one
  universal transaction API.
- [Accepted Payload boundary](../../../design-notes/flarexdb-payload-relational-adapter.md):
  one schema owner and one authoritative row per table. Payload-owned collection
  configuration enters authenticated Application Analysis; its compiler does
  not publish or activate schemas.
- [Payload roadmap](../07-payload-adoption.md),
  [exact release contract](./07-payload-release-and-adapter-contract.md), and
  [runtime cleanup](./53-payload-runtime-contracts-and-conformance.md): current
  private capability limits and implementation owners.
- [Package boundaries](../../16-package-boundaries.md): Payload behavior stays
  in the adapter; analysis contracts remain portable; persistence retains
  binding, storage, readiness, settlement, and publication.

Apply the repository Payload integration skill. Implementation must additionally
apply the Effect skills and review overlay for schemas, typed failures, and
request/resource lifetimes.

## Current Evidence And Reuse Seams

Paths below are relative to the repository root.

| Current owner | Verified behavior | Consequence for this proposal |
| --- | --- | --- |
| `packages/payload-adapter/src/profile.ts`, `composition.ts` | Four fixed content identities; ordinary construction always installs `posts` plus fixed internal/auth inventory. | Separate a capability contract, an application's collection definitions, and the compiled configuration identity. Keep one construction owner. |
| `packages/payload-adapter/src/contract.ts`, `inputs.ts`, `operations.ts`, `query.ts`, `adapter.ts` | Field metadata, caller equality on `id`/`title`, Local API collection selection, date/relation projection, and unique errors assume the exercised collection. | Route through operation-local checked collection metadata. Do not introduce a mutable "current collection" variable or entity-name switch. |
| `packages/analysis/src/applicationWritePolicy/model.ts` | Scalar descriptors already allow multiple named tables and scalar field names. Relation/join descriptors are exact `posts` shapes. Scalars record kind/name but not native required/default/unique policy. | Reuse the existing declarative analysis owner; a wider runtime contract must commit its newly configurable observable semantics, not merely reuse the old name/kind digest. |
| `packages/analysis/src/applicationWritePolicy/schemaCompatibility.ts` | Requires exact flat stored fields and verifies current relation declarations. | Compiled schema and configuration must still agree; optional-field or relationship expansion is not implicit. |
| `packages/analysis/src/index.ts`, `applicationAnalysisV2.ts`, `applicationAnalysisV3.ts` | Reads own-data `writePolicies`, verifies them against analyzed tables, then builds/verifies the existing policy-bearing manifest. | Reuse this path. A compiler-returned object/hash is not authenticated publication authority. |
| `packages/persistence-postgres/src/payloadPreferences/binding.ts` | The opaque profile issuer requires exactly four identities with relation counts 0, 1, 2, 2. | Generalize the trusted issuer's admitted descriptor set; preserve copying, freezing, registry identity, and exact content/lifecycle verification. Do not replace the token with a caller-owned map. |
| `packages/persistence-postgres/src/cmsTransaction/admission.ts` | Matches fixed profile names to relation counts before admitting the runtime. | Evaluate the admitted capability contract and exact compiled identity; preserve active selection, scope lock, binding, and readiness checks. |
| `packages/persistence-postgres/src/cmsTransaction/documents.ts`, `payloadPreferences/cleanup.ts` | Pending deletion evidence requires table name `posts`; cleanup accepts only `collection-posts-...`. | This requires a narrow correction at those owners. An adapter string rewrite, SQL bypass, or successful no-op cleanup is forbidden. |
| `packages/persistence-postgres/test/applicationWritePolicyFixture.ts`, `cmsHostFixture.ts` | Tests construct policy-bearing manifests and separately seed `posts.title` unique readiness. | New compiler tests must not call that fixture synthesis the real configuration pipeline. Integration proof must consume compiler output through shared analysis and existing readiness owners. |

The executing adapter dependency was checked at
`packages/payload-adapter/node_modules/payload/package.json`: Payload 3.88.0,
matching the private package peer/dev pin. Inspect its installed public types
and implementation; no new runtime deep imports are proposed.

Relevant pinned native evidence:

- `dist/collections/config/types.d.ts` owns `CollectionConfig` and sanitized
  collection types. Native configuration is the authoring language, not a new
  Flarex field-definition DSL.
- `dist/collections/config/sanitize.js` marks/mutates input and adds native
  defaults, fields, and inventory. Reject unsupported executable/configuration
  features before calling sanitation; sanitize an owned copy, then compare the
  admitted storage/behavior meaning. Do not serialize the resulting functions.
- `dist/preferences/deleteUserPreferences.js` derives non-auth cleanup keys as
  `collection-${collectionConfig.slug}-${id}`. The scope/collection/document
  binding must be authenticated, not inferred from splitting an arbitrary key.
- `dist/database/combineQueries.js` and `dist/collections/dataloader.js`, traced
  in preflight 53, retain distinct caller, sanitized-filter, and authenticated
  loader boundaries.

## Proposed Design

### One definition, distinct derived responsibilities

For this first slice choose Payload-owned content. Application-owned read-only
CMS views remain a separate follow-up rather than a second construction mode.

```text
supported native collection definitions + fixed capability contract
  -> safe capture / supported-feature checks / native sanitation on owned data
  -> immutable compiled collection metadata and canonical behavior descriptor
      -> Payload runtime configuration and operation-specific metadata
      -> generated Application declaration and write-policy input
          -> existing authenticated analysis, publication, readiness, activation
              -> exact content/lifecycle binding
                  -> admitted Payload Local API commands
```

The compiler owns translation, not native field-validation algorithms or any
database authority. The application does not handwrite a second Flarex validator
or digest alongside each Payload collection. The generated declaration remains
input to the authoritative analyzer, not a caller-authenticated manifest.

Unique readiness is an explicit prerequisite, not an assumed compiler feature.
The inspected fixture manually prepares `unique_title` using the existing
unique-definition and set-build owners; the inspected native schema declaration
path does not establish equivalent generated unique readiness. The contract gate
must identify the authenticated uniqueness declaration and trusted composition
that prepares those existing owners. If that seam is missing, approve the narrow
analysis/readiness correction before the runtime slice. Do not copy fixture DML,
seed uncommitted metadata, or omit uniqueness to make the new collection pass.

The capability contract describes supported semantics and limits independently
of collection slugs: operation families, field kinds, query/population envelope,
and fixed execution/access strategy. The compiled configuration identifies the
actual collections, field order where observable, types, requiredness, literal
defaults, uniqueness/index intent, timestamps, and that capability contract.
Provenance continues to identify the executing pinned framework contract.

Native functions added by Payload sanitation are framework behavior; they are
not permission to accept application functions. Reject getters, inherited
configuration, unsupported custom values, and executable options before
sanitation. Preserve input ownership and omitted-versus-null semantics. Cosmetic
options are either explicitly supported without affecting authority or rejected;
do not silently discard behavior-changing configuration.

### Composition and command ergonomics

An illustrative caller supplies definitions to a private compile operation,
passes its generated declaration through existing analysis/readiness, then
constructs one runtime from the compiled result. Exact export names are not
frozen by this document. The caller must not assemble validators, table IDs,
configuration hashes, per-operation parsers, or six separate factories.

Keep six registered operation families, with collection selection included in
the captured command input and therefore request identity. Resolve it to the
owned collection descriptor inside existing admission, after replay handling.
Do not let callers supply stable table IDs or replace the CMS JSON host contract
with a new generic command framework. Keep decoded operation/result correlation
inside the adapter and preserve field-specific errors from native Payload.

Do not broaden the host's command registration bounds to create six commands
for every collection. Keep `id` equality and bounded paging; initially allow
the collection's single admitted unique text field as the existing equality
lookup analogue. Other query families remain rejected. Native ID queries must
also agree with the selected collection's authenticated table identity.

Metadata is reusable across requests; request bridges, pending documents,
transactions, and observations are not. Both ordinary and conformance callers
use the same compiled-metadata runtime. Fixed `posts` and its failure hooks move
to fixture ownership; no second legacy execution pipeline is introduced.

### Narrow shared-owner changes

Binding verification must accept an adapter-issued checked configuration set
instead of requiring the four built-in examples. That is an explicit private
contract change, not removal of verification. Preserve exact provenance,
configuration, table coverage, lifecycle storage, active-head, and scope checks.

Generalize pending-deletion evidence to retain and attest its authoritative
collection/table identity. Preference cleanup derives the exact native key
from this evidence and the checked collection mapping, and still requires the
same pending deletion, request lifetime, and outer finalizer. Test prefixes with
hyphens and cross-collection/cross-scope IDs. Preserve atomic preference facts,
rollback-only behavior, output bounds, and no-data-change behavior on refusal.

Unique conflict projection uses the operation's checked collection and its one
admitted unique field. Never guess a field from a general `uniqueConflict` error.
If existing conflict evidence cannot establish that mapping, the owning error
contract needs a narrow typed identity addition before proceeding. Multiple or
compound unique constraints are not smuggled into this first slice.

No physical schema, scope-clock, transaction settlement, publication, raw
database access, or Application OCC replacement is proposed. If tracing exposes
another shared-owner deficiency, preserve a failing witness and stop for that
owner's approval.

## Compatibility And Identity Decision

The current descriptor is not a full serialization of configurable Payload
behavior. A caller changing a default or unique policy must not reuse an
identity that commits only field names/kinds. Freeze a new canonical descriptor
revision and mutation/reordering vectors before runtime activation; retain plain
unversioned implementation names. A serialized format revision is justified by
different authenticated bytes, not by a code refactor.

Recommended scope is fresh private configurations. No public/deployed arbitrary
collection contract is claimed by the current roadmap. Do not infer that every
private persisted database can be discarded: inventory actual retained artifacts
and consumers before replacing decoder contracts. Prefer a clean fixture/caller
migration when no supported durable obligation exists. Old authenticated bytes
must never silently acquire new meaning. If a supported old artifact requires
coexistence, name the exact decoder/migration obligation and retirement gate
before approving that additional path.

The existing scalar-to-optional-relation successor policy in
`applicationWriteOwnership/Successor.ts` remains exact; new collection sets,
default/unique changes, or ownership changes do not automatically become valid
successors. Existing-row conversion is not part of fresh installation.

## Retain, Extend, Replace, Delete

| Decision | Owner and completion condition |
| --- | --- |
| Retain | Native Local API lifecycle, exact admission/replay, one transaction/finalizer, schema/readiness authority, row history, and existing scalar/relation/many/join failure witnesses. |
| Extend | Supported configuration compilation and analysis agreement; opaque binding verification; collection-aware pending-deletion/cleanup evidence at its existing owner. |
| Replace | Four-example identity registration, hardcoded ordinary collection/field/query/unique routing, and manually paired new-test configuration/schema construction with checked metadata and compiler output. |
| Relocate | `payloadPostsCollection`, concrete scalar/relation/many/join fixtures, and fixed scenario policies into conformance ownership once every ordinary caller supplies compiled configuration. |
| Delete | Superseded runtime branches, duplicate declarations and fixture-only assembly from ordinary composition. Do not retain an old runtime or compatibility alias solely to avoid migrating tests. |
| Conditional retain | Old serialized decoders only for an inventoried supported durable obligation, with explicit retirement evidence; no such obligation is established by this preflight. |

## Implementation And Completion Gates

1. Contract/compiler gate: finalize supported native options, safe capture and
   sanitation order, schema/unique lowering, canonical descriptor revision,
   actual artifact compatibility disposition, and the real authenticated source
   handoff. Test determinism, input mutation, duplicate/reserved names, invalid
   defaults, unsupported executable options, excess limits, and semantically
   distinct configurations. A compiler-only test is not a completed integration.
2. Admission gate: narrow owner corrections for checked configuration tokens and
   collection-aware deletion. Preserve forged-token, copied-token, wrong-hash,
   wrong-table, stale-head, cross-scope, and no-lifecycle refusal witnesses.
3. Runtime gate: two distinct scalar collections through real Local API CRUD,
   defaults, native validation, unique conflicts, equality/paging, preference
   cleanup, and shared publication. Wrong-collection IDs must fail without
   changing either collection. Replay under a different collection must not
   re-execute or return the first collection's outcome.
4. Regression/removal gate: migrate the existing conformance callers through the
   same composition; preserve relation/many/join, rebinding, nested rollback,
   closure/cancellation, and Currency/Payload composite assertions. Prove no
   ordinary factory installs fixture names or scenario hooks. Reconcile roadmap
   truth and delete displaced assembly.
5. Validation gate: affected adapter/analysis/persistence/composite typechecks,
   package exports, source guards, core/diff/staged lint, and both project
   reviewers. Run focused PGlite and ordinary-role PostgreSQL lanes serially,
   including uniqueness, cancellation, concurrency and lost-COMMIT recovery;
   keep driver evidence and production claims separate.

Implementation is not approved merely by this document's existence. Review the
fresh scalar-first scope, shared-owner corrections, and identity/compatibility
gate with the user before changing those contracts.
