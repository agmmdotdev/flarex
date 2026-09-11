# Shared Medusa persistence adapter preflight

## Status and scope

Status: shared reads, checked schema lowering, JSON-field decoding, keyed
updates, graph creation/replacement and the mutation-dispatch boundary are
implemented and validated on PGlite and ordinary-role PostgreSQL. Currency and
Product share the applicable adapter owners while retaining explicit module
policies. Prepared module definitions now derive ordinary internal services and
bind the existing repositories inside the command-owned lifetime.

This adapter refactor does not authorize changes to Flarex
transaction settlement, commit compilation, schema identity, resource limits,
public APIs, or production routing. A general adapter remains Medusa-owned;
Flarex core does not acquire knowledge of Product, Customer, or Medusa DML.

## Implemented read ownership

Implementation starts from `327ee559`, the maintained strict Vitest-port
baseline in [Record 48](./48-medusa-test-promotion-cleanup.md). Promoted original
test assertions and fixtures remain unchanged; authored query/projection tests
now exercise the shared owner and add renamed-schema and exact-budget proofs.

| Owner | Responsibility |
| --- | --- |
| `packages/medusa-adapter/src/query/catalog.ts` | Detached, immutable checked table/key/relation metadata; no global model registry or storage capability. |
| `src/query/predicate.ts` | Scalar membership/null predicates, bounded logical traversal and tuple-preserving selectors. Module schemas retain admission and error policy. |
| `src/query/projection.ts` | Metadata-driven storage/output field planning and recursive projection, using the pinned pure DAL helpers. |
| `src/query/read.ts` | Scoped store reads, relation filters before paging, complete-catalog windows, population and count timing. |
| `src/currency-read-profile.ts`, `src/product-read-profile.ts` | Module-owned selections, identity/FK retention, numeric companions and admitted relation paths. |

Currency, Product root/related repositories, ordinary Category reads and
Collection membership reads consume these owners. Category sorting/tree hints,
membership exclusion, root free-text/lifecycle/relation filter envelopes and
serialization stay with their domain adapters. The shared algorithms contain
no Product/Currency name branches. Renamed-table/key/relation tests exercise
all three join kinds and non-`id` relation-filter ordering.

The old `product-parent-query.ts` and `product-inverse-query.ts` planners are
removed; their assertions now exercise the shared projection compiler.
Schema artifacts, graph writes, lifecycle/event policy, command admission and
transaction settlement retain their existing owners. This is shared read
capability, not complete generic module preparation.

Resource accounting is part of compatibility. Currency explicitly supplies its
already-bound scoped store, so a read adds no table-acquisition call. Product
retains its outer predicate conjunction even without relation filters, and
acquires the root store before relation lookups. Repository tests pin Currency's
existing find/count call ceilings; a real-store test pins the internal Product
60/61-selector filter-node boundary. The test constructs DAL dollar-prefixed
selectors inside its command, after host request admission, as Medusa does.

## Implemented schema ownership

This capability starts from `aaba75d4`. Currency and Product now call
`src/schema/lower.ts` for scalar/default lowering, keys, indexes, foreign keys
and persistence capabilities. `src/schema/model.ts` describes the checked
subset using the existing DML and relational types. This compiler is a pure
value transformation: it has no store, manager, registry or installation
capability. It borrows checked data synchronously without mutating it; the
existing artifact boundary still normalizes, captures and authenticates it.

Module-owned closed decoders still admit the exact supported source shapes.
Currency adapts its checked property-parser representation; Product passes its
checked compiled tables. Four explicit provenance declarations preserve the
existing table, column, primary-key and searchability source identities.
Exact-number companion declarations retain their capability and column
identities without assuming a single numeric field or a raw-column spelling.
Implicit DML timestamp/soft-delete mechanics and FK derivation have one owner.
Primary-bearing tables still require those lifecycle fields; this is the
currently admitted DML subset, not arbitrary-module admission.

The displaced per-module lowering code is removed. Currency's complete expected
schema/artifact still matches; Product's canonical artifact digest, captured
before extraction, remains
`6e512c55e38ecd80eb868c423313bbe952fd789df31a9ecaad6ca204faf867fd`
for deployment `product-schema-test`. Renamed-metadata tests exercise natural
keys, implicit pivots, FK tuple order, scalar defaults, multiple exact-number
companions, provenance isolation and deterministic normalization. Product's
closed decoder still rejects the Currency numeric features. Relational
normalization retains refusal of invalid defaults and missing endpoints.
Value codecs, keyed updates, graph replacement and module preparation follow
as separate complete steps.

## Current sources of truth

- [Accepted FlarexDB design](../../../design-notes/flarex-db-accepted-design.md)
  and [Medusa adapter boundary](../../../design-notes/flarexdb-medusa-commerce-adapter.md)
  own storage authority, execution profiles, and framework semantics.
- [Medusa adoption](../06-medusa-adoption.md) owns integration sequencing.
  [Source receipt](../../../third_party/medusa/SOURCE.json) identifies the exact
  fork. The local pinned source, rather than a different upstream release,
  governs this comparison.
- [DAL contracts](../../../third_party/medusa/upstream/packages/core/types/src/dal/repository-service.ts)
  distinguish ordinary and tree repositories, transaction/serialization
  methods, lifecycle results, and replacement performed-actions.
- [Module persistence contract](../../../third_party/medusa/upstream/packages/core/types/src/modules-sdk/index.ts)
  includes model preparation, repository factories, custom repositories,
  event subscribers, and a separate migration adapter.
- [Pinned Drizzle implementation](../../../third_party/medusa/upstream/packages/database/drizzle/src/medusa.ts)
  supplies semantic reference algorithms. Its SQLite manager, mutable global
  prepared-model registry, transaction ownership, and eager specialized imports
  prevent importing the whole implementation as the Flarex adapter.
- [Completed compatibility record](./46-commerce-command-registration-bound.md),
  [active Product inventory](./product-upstream-test-cases.json),
  [Product registration](../../../packages/medusa-adapter/test/product-upstream.test.ts),
  and [Currency live configuration](../../../packages/medusa-adapter/vitest.live.config.ts)
  establish the regression baseline. Earlier partial-suite records describe
  previous checkpoints, not remaining Product work.

The completed Product baseline covers ten files, 205 admitted original cases,
and one retained upstream performance skip. Currency has all thirteen original
integration declarations, alongside authored initialization, transaction, and
publication checks. The completion record contains both PGlite and ordinary-role
PostgreSQL evidence. These are suite-coverage claims, not exhaustive coverage of
every possible input, every Medusa module, or production behavior. Static
linkable assertions also do not establish stored Module Link support.

The research checked current source and registrations against those completed
records; it did not rerun the database suites. Concurrent test/compiler cleanup
must finish and receive a fresh baseline before implementation. Preserve its
assertions and approved provenance policy rather than restoring an older test
copy or claiming that edited files still have their former source hashes.

## Current architecture and findings

The existing integration already executes the real promoted Medusa services.
There is no reason to replace those services with a Flarex commerce service.
What remains incomplete is the reusable persistence implementation beneath them.

| Area | Current evidence | Consequence |
| --- | --- | --- |
| Transaction and Promise ownership | `commerce-repository-context.ts`, `commerce-promise-owner.ts`, and `commerce-service-bridge.ts` are shared | Retain one command-owned bridge, opaque manager authentication, sticky refusal, cancellation, and cleanup |
| Model interpretation | Product uses `compileDmlSchema`, checked schema lowering, and runtime metadata; Currency separately checks its actual DML and lowers BigNumber companions | Reuse actual metadata, but do not assume the two schema compilers already produce one interchangeable representation |
| Relationship execution | `commerce-relations.ts` and `commerce-relation-filter.ts` use shared descriptors and pinned grouping algorithms | Extend the existing owners; do not build another relation loader |
| Query compilation | Currency, Product root, related entities, and Categories separately decode filters, fields, paging, and ordering | Share structural traversal and lowering while retaining each entry's admitted grammar and failure order |
| Projection | Product root, parent, and inverse readers separately implement selected keys and nested fields | Port a bounded form of the pinned projection-tree algorithm and replace these repeated implementations |
| Writes | Product graph capture explicitly traverses products/options/values/variants/images; replacement already uses substantial generic table/FK mechanics | Extract generic graph operations later; classify ownership rules before converting entity branches into metadata |
| Lifecycle | Currency writes `deleted_at` using the Effect clock; Product invokes the core managed-lifecycle capability | These are distinct admitted contracts. Query centralization must not silently unify timestamps or event observations |
| Category | The promoted Category service owns trees, path/rank maintenance, and leaf rules; its repository has a different call signature | Keep a named tree extension over shared scalar/relation operations |
| Events | Product validates command-specific event intent against actual core facts and lifecycle observations | Shared dispatch mechanics are reusable; event names alone cannot authorize publication |
| Composition | `product-service.ts` binds generated internal services manually; Product's persistence object refuses model/connection/repository factories | Completed service suites do not yet establish a complete reusable `ModulePersistenceAdapter` bootstrap |

Source examples:

- [Related queries](../../../packages/medusa-adapter/src/product-related.ts)
  branch on Type/Tag `value`, Collection `title`/`handle`, and Option/Variant
  `title` for the same scalar equality lowering. The allowed fields belong in
  module capability data; the lowering algorithm should not name these models.
- [Product root queries](../../../packages/medusa-adapter/src/product-query-profile.ts)
  contain real boundary policy as well as mechanics: public/internal defaults,
  free-text source validation, admitted relationship filters, and prerequisites
  for service-owned Variant image assembly. Preserve these policies explicitly.
- [Currency queries](../../../packages/medusa-adapter/src/currency-query.ts)
  use `code`, recursive conjunction/disjunction, cumulative filter budgets, and
  `rounding`/`raw_rounding` projection. A generic engine hardcoded to `id` would
  already fail the second existing consumer.
- [Category reads](../../../packages/medusa-adapter/src/product-category-repository.ts)
  read a complete bounded catalog, sort locally, and then page; [Collection
  membership](../../../packages/medusa-adapter/src/product-collection-membership.ts)
  applies an admitted exclusion selector over complete scoped rows. Neither can
  be replaced by filtering a partial database page. Local Category string
  comparison also must not silently become a different SQL collation.
- [Local event policy](../../../packages/medusa-adapter/src/product-local-events.ts)
  distinguishes module-service and direct internal calls. Deleting that
  distinction as duplication would change behavior and weaken authentication.

## Proposed architecture

```text
Pinned Medusa services and generated internal services
        |
Module composition: models + explicit capabilities + named extensions
        |
Shared Medusa adapter
  checked runtime metadata and value codecs
  query/projection compiler and scoped read executor
  scalar and relationship mutation operations
  lifecycle/event adaptation and DAL repository construction
        |
Existing Flarex CommerceCommandContext / CommerceStore
        |
Existing transaction, installation, constraint, and publication owners
```

Keep the implementation in `@flarex/medusa-adapter`, organized by responsibility
inside the package: metadata, query, repository, mutations, module composition,
and module-specific extensions. Exact subdirectory names are implementation
detail; do not perform a package-wide file move as the first step.

Keep storage-independent algorithms ported from the fork in their existing
`@medusajs/drizzle` semantic owner, with exact provenance and focused tests.
Flarex capability checks, bounded reads, and manager access stay in the adapter.
Neither layer belongs in `@flarex/utils`. No new public package is needed.

### Metadata describes structure; admission grants operations

Prepare an immutable runtime catalog from already-checked metadata. It describes
model/table identity, primary and relation keys, scalar kinds, managed fields,
numeric companions, relationship ownership, and searchable markers where the
source establishes them. It is not a new author-facing DML grammar, schema
artifact format, or proof that a caller may access a table.

Bind explicit read capabilities to that catalog at trusted composition time:
allowed fields/operators, relation paths, ordering, projection policy, and
entry-specific paging behavior. Preserve differences between public service,
internal service, and mutation-support queries. A model's possession of a field
does not automatically admit every filter or write on it.

Use semantic policy values rather than model-name tests in the common executor.
For example, single-key identity is metadata; whether to retain that key in a
partial response is a projection policy. If a policy needs to perform an
operation, give it a named typed extension and the smallest required capability,
not an unrestricted callback with raw storage access.

The catalog must be keyed by the exact prepared model/schema/profile context,
never by a global model name alone. Request managers and population caches stay
request-owned. Concurrent Currency/Product preparations must not affect one
another, including when equal model names exist in different preparations.

### Preserve actual extension points

DML does not describe every commerce operation. The fork already has a
`createCustomRepository` contract and dedicated Inventory, Pricing, and RBAC
implementations. Its Inventory repository computes quantities; its Pricing
repository performs domain queries. The existence of a generic repository is
therefore compatible with named specialized repositories.

Keep Product Category tree semantics, Collection membership policy, Variant
image assembly, option ownership checks, and command-specific event contracts
with their actual owners. Extract common FK/pivot mechanics beneath them when
the behavior is exact. Do not move business validation out of a Medusa service
merely because a database helper could reproduce it.

## Alternatives challenged

| Alternative | Assessment |
| --- | --- |
| Continue implementing one service test family at a time indefinitely | Useful for discovering contracts, but insufficient as the future architecture; completed Product coverage now supports consolidation |
| Import the entire fork Drizzle adapter and replace its database handle | Rejected: SQL/dialect types, global preparation, transaction ownership, and eager custom-repository dependencies are coupled to it |
| Write a new generic ORM or use the simplified portable DAL experiment | Rejected: duplicates mature Medusa behavior and Flarex persistence; simpler interfaces do not establish parity |
| Treat every DML field and relation as supported automatically | Rejected: structure does not prove query semantics, authority, resource cost, or a supported lifecycle |
| Move all commerce logic into Flarex core | Rejected by accepted architecture; the generic part is generic within the Medusa adapter |
| Rename Product helpers to generic names without removing branching | Insufficient: completion requires actual shared execution by both modules |
| Generalize schema, reads, writes, lifecycle, bootstrap, and a new module in one change | Too many independent correctness boundaries; use coherent capabilities with full regression at each boundary |

The preferred approach reuses the fork's algorithms, the adapter's proven
mechanics, and Flarex's existing capabilities. It makes unsupported shapes
explicit rather than accumulating success-shaped fallbacks.

## Recommended first implementation capability

Deliver shared metadata-driven repository reads and projections across Currency
and Product, including the ordinary reads beneath related entities and Category.
This is one implementation capability, not a sequence of new research approvals.

1. Establish the completed, committed post-cleanup baseline. Inventory the
   connected read contracts and preserve existing query, refusal, scope,
   transaction, and service tests.
2. Add the runtime catalog projection over the existing checked Currency and
   Product metadata. Preserve schema/artifact/physical-layout outputs and
   existing registration tokens. Do not broaden supported key shapes merely
   because the descriptor can represent them.
3. Build one bounded query/projection compiler using the pinned semantics:
   logical/scalar predicate traversal, selected storage fields, required join
   keys, relation paths, output fields, and count/paging policy. Keep a small
   closed internal query model; this is neither public SQL nor a universal
   query/transaction API.
4. Route Currency and Product root/related reads through the shared executor.
   Reuse the current relation loader and relation-filter resolver. Resolve
   relation filters before root paging and counting. Distinguish storage fields
   needed to join from fields intentionally exposed in the response.
5. Use that executor for Category's ordinary population/projection and complete
   row reads. Retain its bounded sorting/tree preparation and Collection's
   exclusion selector as named local extensions. Preserve complete-catalog
   guarantees and the order of filtering, sorting, counting, and slicing.
6. Remove displaced read/projection implementations and update their tests to
   exercise the shared owner. Retain thin domain entry wrappers only for real
   policy or supported callers; no alternate execution path or runtime switch.

The common query executor must not import Currency/Product model classes or
switch on their names. Module wiring can name them and declare their admitted
capabilities. Domain command validation, serializers, and custom operations
remain explicit at their owning boundaries.

### Retain, extend, replace, and delete inventory

| Current owner/path | Disposition | Removal or preservation gate |
| --- | --- | --- |
| Promoted Currency/Product services and original integration assertions | Retain | Preserve the approved source transformations and real service execution |
| `commerce-repository-context`, Promise owner, service bridge | Retain | No transaction/lifecycle rewrite in this capability |
| Currency/Product schema capture, profiles, installation, seed data | Retain; project shared runtime metadata from checked outputs | Artifact and physical-layout identities must remain identical |
| `@medusajs/drizzle/relation-query` | Extend with exact portable projection mechanics if required | Update source admission/provenance; do not import SQLite execution |
| `commerce-relations`, `commerce-relation-filter` | Extend existing owners | Both modules use the common metadata contract; maintain current capability limits |
| `currency-query`, Product query/profile, related read branch | Replace duplicated mechanics; retain domain policy wrappers where needed | All existing callers use the common compiler/executor with unchanged results/refusals |
| `product-parent-query`, `product-inverse-query`, root nested projection loops | Delete displaced algorithms after replacement | No imports of old implementations; shared projection tests cover their contracts |
| Category repository reads and Collection membership reads | Port common mechanics, retain named specialized transforms | Preserve tree hints, collation, full-set exclusion and paging order |
| Currency serialization, Product Category representation codec | Retain | Preserve BigNumber conversion and own-undefined DTO representation |
| Product graph/replacement/lifecycle and local event policy | Retain for first capability | Generalize under the later mutation capability, without incidental behavior changes |
| Test/comparison runners and source admission tooling | Retain | Comparison execution is test evidence, never runtime fallback or production authority |

No shipped obligation requiring a parallel old/new production path was found
in the inspected private composition. The replacement preserves intended
semantics and tests, then removes unused internals. If supported consumers are
found during implementation, name them before retaining a compatibility wrapper.
Do not create new version suffixes to describe refactor chronology.

## Invariants and validation gates

The first capability changes adapter organization and reuse, not admitted
behavior. Prove:

- Currency `code` identity and lowercase normalization, numeric companions,
  partial selects, recursive filters, ordering, paging, and error precedence.
- Product public/internal defaults; primary-key/FK retention; nested selection;
  null versus omitted versus empty relations; Category own-undefined encoding;
  image rank ordering; relation filters before pagination; and count independent
  of the returned page.
- Existing refusal grammar and first-failure order, including malformed input
  versus unsupported capability versus exhausted budget. Capability catalogs
  cannot be supplied or enlarged by request input.
- Metadata-driven reuse with renamed model/table/key/relationship names in
  focused tests, plus isolated concurrent prepared catalogs. A fake generic
  executor that still recognizes Product must fail these checks.
- Same scoped manager for every relation lookup; foreign-scope collisions and
  forged/closed managers still fail; refusal still poisons the owning command;
  cancellation and late callbacks cannot escape it.
- Existing calls, statements, bytes, rows, traversal, and timeout bounds. Check
  overlapping relation reads and the 1000-image case for additional queries or
  repeated metadata compilation; do not raise ceilings to pass the refactor.
- No schema, migration, digest, admitted command set, event policy, transaction
  finalizer, commit fact, or publication behavior changes.

Run focused compiler/projection tests, all 205 Product originals plus the retained
skip, all thirteen Currency originals through the Flarex live lane, and the
affected local transaction/lifecycle/event, Category, scope, and cancellation
regressions on PGlite and ordinary-role PostgreSQL. Keep the existing
driver-specific Currency skip explicit. Use the package's strict authored-code
typechecks and the finalized test compiler lane, source/provenance verification,
and portable import/bundle guards. Browser bundle checks do not establish a
deployed Worker or Hyperdrive proof; deployment is outside this refactor.

Run `pnpm lint:core` and `pnpm lint:diff`, then both required read-only
TypeScript and code-quality reviewers at the completed implementation checkpoint.
Fix bounded findings, repeat stale reviews if code changes, and run
`pnpm lint:diff -- --staged` against the owned index before committing. Do not
include other tasks' changes. Docs-only preflight does not require these code
reviewers or database reruns.

Use Effect v4 according to the installed version and repo-local skill. Pure
recoverable compilation belongs in `Result`; asynchronous store operations in
named Effect operations; Medusa Promise signatures stay at the existing bridge.
Keep request-owned instances explicit. Introduce a service/Layer only for an
actual shared lifecycle or configuration owner, not a singleton transaction
manager. Preserve error/defect and cancellation behavior while extracting code.

If a shared-store defect or missing predicate appears, record the reproduction
and expected/actual behavior with that owner and obtain separate approval.
Do not compensate with partial-page filtering, raw SQL, broader catches, or
weakened original tests. Recover from an unsuccessful refactor through its
isolated source checkpoint, not a permanent dual implementation.

## Acceptance evidence

The completed read slice passes on PGlite and local PostgreSQL 18.3 using an
ordinary role without superuser, role-creation or database-creation privileges.

| Gate | PGlite | PostgreSQL |
| --- | --- | --- |
| Product originals, `vitest.product-upstream.config.ts` | 205 passed; one retained upstream skip | 205 passed; same skip |
| Currency live originals and authored boundaries, `vitest.live.config.ts` | 20 passed | 19 passed; existing PGlite-only interruption case skipped |
| Authored read, transaction, cancellation, lifecycle and projection regressions, `vitest.product-query.config.ts` | 132 passed plus the focused real-store node-budget case | 133 passed together |
| Public Categories, `vitest.product-categories.config.ts` | 26 passed | 26 passed |
| Internal Categories, `vitest.product-internal-categories.config.ts` | 34 passed | 34 passed |

The Currency lane includes all thirteen original cases on both drivers. Focused
query, projection, runtime-catalog and shared-read tests pass all 73 checks.
The PGlite authored suite had an initial fixture-setup timeout during concurrent
runs; its retry passed with the same limits. The new node-budget fixture was
corrected to construct its DAL selector after host admission, then passed on
both drivers. No original assertion or resource ceiling was weakened.

The package's four strict compiler lanes and the ten-package Medusa build pass.
All 56 promotion/test-port/source-island guard tests pass, and the exact source
manifest verifies 375 files. Browser bundle/import verification passes across
645 inputs without Node, ORM, database or island runtime imports. Core lint,
worktree diff lint and the final staged diff check pass; the adapter remains
outside the configured Oxlint source roots. Both required reviewers report no
findings after the resource-accounting corrections. Deployed Worker, Hyperdrive,
general module bootstrap and production claims remain outside this evidence.

## Schema extraction validation

The schema-focused matrix passes 93 tests across shared lowering, both module
schemas, Currency values, Product value profiles and Product runtime metadata.
All four strict compiler lanes, ten private-package builds, 56 promotion guards,
the exact 378-file source manifest and 646-input browser portability check pass.
Both required reviewers report no findings; main and independent reviewer lint
gates pass. PGlite runs all 205 Product originals (one unchanged upstream skip)
and 20 Currency live tests. PostgreSQL Currency passes 19 tests, retaining its
existing PGlite-only interruption skip; all thirteen original cases run on each
driver. PostgreSQL is local 18.3 under an ordinary role without superuser,
database-creation or role-creation privileges.

The initial concurrent PostgreSQL Product run passed 203 originals and failed
two internal Product tag-list cases (with/without relations), reporting
`rollbackOnly` and `PhysicalSessionDeadlineIssue` with initial callback
deadline. Expected behavior is normal selected Product results within the
existing request/session budget. The affected execution owner is the existing
bounded request/physical-session boundary; this extraction changes neither.
Evidence is retained in
`work/validation/shared-medusa-schema/product-postgres.log`. The isolated rerun
passed all 205 originals (one unchanged upstream skip) in 229 seconds using
unchanged code, assertions, coverage reporter and ceilings; its receipt is
`product-postgres-serial.log` in that directory. Current disposition: not
reproduced in isolation, consistent with load sensitivity but not a diagnosed
shared-owner defect. No shared-owner correction or limit increase was made.
The final staged diff gate also passes. These receipts establish the current
bounded schemas and services; they do not admit arbitrary Medusa modules or
claim deployed Worker or production support.

## Implemented keyed-update and value-field ownership

This step starts from `69b20f6d`. Currency and Product now compile their
admitted single-text-key update pairs through `src/write/keyed.ts`.
`commerceRowDecoder` owns their identical metadata-field JSON decoding
mechanics, including strict keys and original property order. It proves an
allowed JSON field shape, not a scalar storage type. Currency's exact-number
conversion remains a module-owned codec with one current consumer.

Module profiles retain batch/per-entry decoding order, key validation,
writable-field policy and duplicate handling. Currency rejects any supplied
update code, preserves repeated keys for its existing downstream checks, and
performs lowercase/numeric/storage validation later. Product accepts only a
repeated matching ID and rejects duplicate IDs before data validation. Its
whole-batch structural decoder still runs before per-row admission, and an
unadmitted table still fails before batch decoding.

The shared compiler retains omission, null, empty relation data, metadata,
row order, original errors and per-call state. Data decoding validates the
payload without substituting a transformed value. The existing repository
still owns capture/refusal and store dispatch; persistence owns stored-row
merging, constraints and mutation facts. No transaction, lifecycle or graph
authority moves into this compiler. The displaced per-module assembly loops
and Product-local JSON-field schema factory are removed.

The pinned Drizzle `normalizeUpdateEntry` at
`packages/database/drizzle/src/medusa.ts` also accepts bare records and
contains a fallback outside this adapter's admitted pair grammar. The shared
compiler therefore remains an adapter-owned checked-pair implementation;
it neither imports the SQLite manager nor broadens input admission.
Renamed-key, error-identity, duplicate-order, payload-preservation, boundary
ordering and full original-service tests gate the extraction.

### Keyed-update validation

All 103 focused checks pass, covering shared writes, module value profiles,
structural boundaries, runtime metadata and unchanged schema artifacts.
The four strict TypeScript lanes and ten-package private build pass. All 56
promotion guards pass; the manifest verifies 380 exact files and browser
portability verifies 647 inputs without Node, ORM, database-driver or
source-island runtime imports.

Database suites ran sequentially and passed on their first runs:

| Suite | PGlite | Ordinary-role PostgreSQL 18.3 |
| --- | --- | --- |
| Product originals | 205 passed; one unchanged upstream skip | 205 passed; same skip |
| Currency live originals and authored boundaries | 20 passed | 19 passed; existing PGlite-only interruption skip |

All thirteen Currency original cases run on both drivers. Assertions, coverage
reporters and resource ceilings are unchanged. Logs are retained under
`work/validation/shared-medusa-write/`. Both required reviewers report no
findings. Core, worktree-diff and exact staged-diff lint pass; the adapter
remains outside the configured Oxlint source roots. This validates the admitted
single-text-key profiles, not composite-key writes or arbitrary module support.

## Implemented graph creation and replacement ownership

This step starts from `ebadd81d`. Product graph capture, insertion and
replacement now delegate to `src/write/create.ts` and `src/write/replace.ts`.
The internal `graph-model.ts` contracts describe checked single-text-key
entities, reference decoding and explicit module policies. Product's compiled
primary column supplies its key identity; the shared algorithms contain no
Product model or table branches. These contracts are trusted package-local
composition, not an unknown-input schema or authority to register a module.

`product-graph-profile.ts` retains Product traversal order, per-root exact
Variant snapshots, external Tag/Category references, Collection's additive
Product membership, mutable Product references, Variant/Option ownership,
requested relation admission, nested Option projection and Image rank ordering.
Creation preserves its original null-as-empty membership normalization;
replacement preserves omission versus empty arrays and refuses null to-many
memberships. Structural row decoding still uses the checked Product value
profile at the same traversal points.

The shared owner captures input, enforces repeated identities and parent
ownership, plans single-column FKs and pivot tuples, loads each scoped store
once, orders dependencies and applies deletes/inserts/updates sequentially.
It reuses pinned tuple grouping, changed-field comparison, relationship errors
and performed-action helpers. The existing manager, managed timestamps,
resource ceilings, stored metadata merge, transaction rollback and final event
dispatch remain with their current owners. Creation uses inserts and catalog
order; replacement computes dependency order before writing. Returned rows and
performed actions come from actual store receipts.

The shared result exposes key-preserving action records. Medusa's legacy
`PerformedActions` type requires `id`, so only the Product facade restores
that compatibility type, grounded in its checked literal `id` metadata and
core-decoded returned rows. Static tests keep arbitrary graph keys from
acquiring that narrower promise.

The displaced Product traversal and mutation algorithms are removed; its
existing facades remain the call sites. Currency has no admitted graph, so it
continues to use the shared keyed-update owner. A synthetic Volume/Edition/
Label graph proves alternate table names, natural keys, traversal, references,
ownership, cascades, membership modes, error preservation, dependency refusal
and actual-row results without claiming another Medusa module is admitted.

### Graph validation

All 29 shared graph/write/schema checks and 134 authored Product checks pass.
The renamed graph cases cover scoped manager identity, one store acquisition
per table, untouched and emptied relations, additive association, child and
pivot deletion order, returned-row projections, actual-row action capture,
creation collisions, dependency cycles and original failure propagation.
The TypeScript review identified and resolved the generic action-key contract
issue above; both required reviewers report no findings on the final diff.

The ten-package private build, all four strict TypeScript lanes, 56 promotion
guards, 385-file exact source manifest and 650-input browser portability gate
pass. Core and worktree-diff lint pass; the adapter remains outside the
configured Oxlint source roots.

Database suites ran sequentially and passed on their first runs:

| Suite | PGlite | Ordinary-role PostgreSQL 18.3 |
| --- | --- | --- |
| Product originals | 205 passed; one unchanged upstream skip | 205 passed; same skip |
| Currency live originals and authored boundaries | 20 passed | 19 passed; existing PGlite-only interruption skip |

All thirteen Currency originals run on both drivers. Final Product boundary
checks and the full compiler build also pass after the action-type correction.
Assertions, coverage reporters, resource ceilings and persistence owners are
unchanged. PostgreSQL ran without superuser, database-creation or role-creation
privileges; the temporary fixture was stopped after validation. Logs are under
`work/validation/shared-medusa-graph/`. Deployed Worker/Hyperdrive, arbitrary
module admission and production support remain separate proof obligations.

## Implemented shared mutation dispatch boundary

This step starts from `2197f17d`. `commerce-mutation-events.ts` centralizes the
request-local subscriber/context registration sets and nine repeated foreign
dispatch adapters from Product repository composition. It delegates to the
already-promoted pinned Medusa subscriber, created-row, row-update and cascade
helpers. It does not duplicate their grouping, callback concurrency, explicit
subscriber precedence, suppression, duplicate-token accounting or conventional
aggregator behavior.

Product retains each admission check at its original position after storage
work: required registration, the permitted direct callback kinds, exceptions
for Category/assignment event dispatch, restore's unsubscribed conventional
path, lifecycle change-set construction and actual-row selection/copying.
The shared instance is scoped to one repository family and borrows the existing
Promise owner. Foreign failures retain their existing `adapterFailure` envelope
and original cause; the repository's checked boundary still poisons the current
transaction. No runner, transaction or publication authority is introduced.

Currency currently composes its internal service without mutation-event
dispatch, so it does not gain an event subscriber or change lifecycle behavior.
Product local-event schemas, command-specific intent, authenticated facts,
managed lifecycle observations and post-commit delivery retain their current
owners. The new generic dispatch tests use renamed models and keys, exact
callback/context identity, duplicate consumption, conventional restore,
registration isolation, asynchronous shutdown and Product refusal/rollback
evidence. Registration alone is never proof of publication authority.

### Mutation dispatch validation

All 11 focused dispatch cases and 134 authored Product boundary checks pass.
The ten-package private build and all four strict TypeScript lanes pass, as do
56 promotion guards, the 387-file exact source manifest and browser portability
across 651 inputs. Both required reviewers report no findings against the final
source and tests. Core and worktree-diff lint pass; the adapter remains outside
the configured Oxlint source roots.

| Suite | PGlite | Ordinary-role PostgreSQL 18.3 |
| --- | --- | --- |
| Product originals | 205 passed; one unchanged upstream skip | 205 passed; same skip |
| Currency live originals and authored boundaries | 20 passed | 19 passed; existing PGlite-only interruption skip |

The database suites ran sequentially. Both Product runs passed on their first
attempts, and all thirteen Currency originals run on each driver. An initial
Currency invocation named PGlite inherited `FLAREX_TEST_DRIVER=postgres` from
the preceding run; its PostgreSQL receipt is preserved as
`currency-postgres-inherited-driver.log`. The subsequent explicitly selected
PGlite run passed all 20 checks, including its interruption case. Logs are in
`work/validation/shared-medusa-events/`. PostgreSQL used an ordinary role with
no superuser, database-creation or role-creation privileges and was stopped
after validation. Assertions, coverage reporters, ceilings, lifecycle policy
and persistence/publication owners remain unchanged.

## Module-scoped preparation and repository construction

This slice uses the pinned `ModulePersistenceAdapter` model
preparation and constructor methods. The actual repository loader chooses model
repositories by `lowerCaseFirst(model.name) + "Repository"` and separately
constructs the base repository. The shared `commerce-module.ts` owner follows
those names and contracts with request-local factories. It does not import the
MikroORM loader or the Drizzle connection manager.

Each trusted module composition registers its exact DML objects and existing
admitted repositories. Preparation requires the complete registered set, rejects
duplicates, foreign or same-name replacement objects and injection-name
collisions, preserves each DML object, and returns a separate ordered array.
This preparation selects already admitted model bindings; the existing checked
DML capture/lowering and host installation remain the schema authorities.

Repository constructors bind the admitted repository methods with their original
receiver. The base and model instances share the existing request's manager,
Promise owner and borrowed transactions. The shared internal-service constructor
retains Medusa's DML primary-key inference and optional event facets. Currency
has no event facets. Product supplies its existing checked mutation dispatch,
keeps the specialized Category constructor explicit, and constructs its blocked
image-product service alias with its restricted repository. The former local
Product internal-service factory and unsupported preparation stubs are removed.

Connection loaders and custom-repository discovery synchronously refuse through
the existing sticky Promise-owner boundary. There is no fallback to framework
connection setup, schema installation, automatic custom repository selection,
new transaction owner, or cross-module authority. These factories are internal
to the command-owned composition and are not a public full-bootstrap adapter.

### Module construction validation

All 15 new construction cases and the 11 existing dispatch cases pass, as do
134 authored Product boundary checks, the ten-package private build with all
four strict TypeScript lanes, 56 promotion guards, the 389-file exact source
manifest and browser portability across 652 inputs. Core and worktree-diff lint
pass. Both required reviewers report no findings against the final source and
tests. The adapter remains outside the configured Oxlint source roots.

The first full ordinary-role PostgreSQL run passed 204 Product originals and
failed `updateCollections > should respond with collections when products are
updated` with `rollbackOnly`. Expected behavior is the unchanged original's
successful collection response. At 21:53:08.045 +0630 the PostgreSQL server
recorded `canceling statement due to statement timeout` for its two-row Product
insert. The affected boundary is the existing persistence statement deadline
and bounded request's rollback latch. No model-selection or DTO discrepancy
was reported. This is diagnostic timing evidence, not authority to alter
persistence or its deadlines. No owner correction is proposed in this slice.

All 22 unchanged focused collection cases then passed on the same PostgreSQL
fixture, including the failed original and four authored membership/scope/
rollback boundaries. A second serial full run, without source, assertion,
reporter, concurrency, database setting or resource-limit changes, also passed
204 originals and failed a different case: `Product Service > list > relation:
variants > should filter by id and including relations`. The first failing
collection case passed. The second failure is `statementFailure` at
`writeOutcome`; at 22:02:38.560 +0630 the server timed out the shared
`fx_system_idempotency` insert. Its affected owner is existing outcome
publication/persistence, not the model constructor contract. This extraction
does not change that SQL or owner. Full-run PostgreSQL stability remains
unresolved; two partial full runs must not be described as one green run.
Further shared-owner changes require their own preflight and approval.

The initial failed run and server evidence remain in
`work/validation/shared-medusa-module/product-postgres.log` and
`postgres-timeout.log`; the second run and server evidence are
`product-postgres-rerun.log` and `postgres-rerun-timeout.log`. All slice
receipts use that validation directory.

The affected internal Product lane subsequently passed all 27 cases on
PostgreSQL, including the timed-out original and four authored boundary cases.
Currency passes all thirteen originals on both drivers: 20 live cases on
PGlite and 19 on PostgreSQL with the existing PGlite-only interruption skip.
PGlite Product passes all 205 originals and retains its one upstream skip.
All database suites ran sequentially with explicit driver selection. PostgreSQL
18.3 used the ordinary role without superuser, database-creation or
role-creation privileges; after all test-role connections closed, the task-owned
server was stopped. No assertions, reporters, schema artifacts, SQL, limits or
shared transaction/publication owners changed.

Supplemental code-quality review examined both PostgreSQL failures and the
publication call path. It found no concrete construction defect and required no
further full rerun after the focused lanes passed. The evidence is consistent
with intermittent timing, but does not prove an environmental cause or establish
full PostgreSQL stability. Carry that qualification into subsequent module work;
shared-owner diagnosis and any correction require a separate preflight.

The subsequent [PostgreSQL timeout investigation](./49-medusa-postgres-timeout-investigation.md)
completed an observed prior/current comparison, with all 205 active originals
passing in each run. Both earlier failures trace to Product fixture creation.
Measured WAL-write and reset stalls support a bounded fixture-cleanup experiment;
the intermittent reliability qualification remains open. Record 49 owns the
diagnostic evidence, remaining uncertainties and proposed next slice.

## Prepared module authoring and composition

The accepted authoring direction separates application use from integration
implementation. Application code uses a supported module; integration code owns
its checked profile and named exceptions. Models and the existing Medusa main
service remain the authoring inputs. Flarex does not introduce another ORM,
business-service framework, general dependency container or transaction owner.

`src/module-definition.ts` prepares an instance-local definition from a typed DML
set, repository profile, explicit service extensions and main-service factory.
Preparation is a pure recoverable `Result`; it captures declarations and callback
selection, checks duplicate model/injection names, requires explicit replacement,
and reports missing declared capabilities before binding. An immutable description
exposes the resulting choices for diagnostics. The model objects retain their DML
identity; renaming a model after preparation refuses before repository binding.
The checked DML/schema owners still govern other model semantics.
Captured method callbacks retain their receivers; this does not freeze arbitrary
receiver or closure state. Extension records require own enumerable string data
properties so preparation cannot silently omit a declared service.

The scoped `use` operation derives ordinary service registrations from model names
and delegates to `withCommerceService`. Repositories, subscribers and services
remain command-owned; no global model registry, singleton Context tag, new
connection or lifetime is introduced. Native Medusa context arguments remain
explicit at this private adapter boundary. Model-name and service/extension
inference survives the factory; runtime query catalogs do not claim static
projection types or grant operations merely because fields exist.
Definite literal tuple members infer required services; dynamic arrays and
union-selected members retain optionality for services that may be absent.

Product's composition owner is `src/product-module.ts`. Category construction,
the mutation-interceptor cycle, local event adapter and restricted image alias
remain named Product behavior. Ordinary model/repository and internal-service
lists are derived; the former manual assembly in `product-service.ts` is removed.
Currency uses the same definition path. The image alias explicitly enumerates
the existing allowed DAL operations rather than inheriting future permissions.

Default selection/naming follows the pinned
`core/utils/src/modules-sdk/loaders/container-loader-factory.ts`. Its singleton
container lifetime, connection bootstrap and custom-repository fallback are not
imported into the command-owned Flarex adapter. This is a narrow lifetime
adaptation of Medusa assembly conventions. Convex's definition/execution split
is a useful authoring reference; commerce retains its accepted transaction lane.

Extensions are independent named service constructors with explicit `add` or
`replace` intent and declared profile requirements. Their declaration order is
their construction order; they do not resolve each other or override by ordering.
These are trusted integration factories over existing admitted DAL capabilities,
not an untrusted plugin sandbox. Resourceful extensions requiring a new lifecycle
or novel repository behavior need the corresponding capability design.

The defining regression gates are Currency and Product's maintained original
suites plus renamed non-`id` model, replacement type, declaration capture,
collision/refusal, concurrent-use and escaped-service checks. Shared transaction
limits, installation identities, event admission, lifecycle policies and source
provenance remain unchanged. A passing assembly proof does not resolve the
separately recorded PostgreSQL fixture-pressure investigation.

Validation of this composition slice passes all four strict adapter TypeScript
lanes, 32 shared/definition tests, 134 authored Product boundary checks on
ordinary-role PostgreSQL, and all 56 source guards. Currency passes 20 live cases
on PGlite and 19 on PostgreSQL with its existing driver-specific skip. Product
passes all 205 active originals on each driver with the existing upstream skip.
The initial PGlite attempt timed out during fixture setup before any original
case ran; the serial rerun passed without changing limits or assertions. The
original suites used the shared worktree's separate fixture-cleanup changes;
those changes remain owned by record 49 and are excluded from this checkpoint.
An isolated proposed-commit snapshot independently verifies all 392 exact source
files across the ten packages. Browser portability passes across 654 inputs;
core and diff lint pass. Receipts are `work/module-assembly-*.log`.

## Following capabilities and module proof

Product command composition retains one source-private entry point,
`makeLocalProductCommands`, returning the existing command set, service-use
operation, graph and workflow definitions. Its `product-commands` owners prepare
the four named profiles and define read, mutation and direct internal-service
command families. The entry point owns the exact command registration and binds
graph/workflow metadata to those same tokens. Preparation has no live manager;
services and repositories still belong to each command's existing lifetime.
Product public commands and Currency reads use the same small service-command
factory for preparation followed by scoped invocation. Bindings call the actual
Medusa methods on their live receiver; no entity-name dispatcher, inferred CRUD
exposure, secondary service registry or replacement upsert algorithm is involved.
Related Product reads share admission mechanics while retaining their original
decoders. Related writes share DML admission and shape handling, with explicit
Category, Tag and Variant checks and the Collection membership profile.
The existing count tokens still mean native `listAndCount`, not a scalar count.
Command names, modes and graph/workflow token identity remain unchanged.
Category projection, Collection membership, pre-normalization parent checks and
internal serialization/event differences remain explicit adapter policy. No new
package export, module bootstrap, storage capability or transaction owner is
introduced.

Shared reads, checked DML lowering, JSON-field decoders, keyed updates and graph
creation/replacement, mutation dispatch and module repository construction now
have common owners. Preserve
insert versus upsert, omitted versus empty relationships,
identity retention, metadata merging, reference ownership, managed-field
refusal, actual-row performed-actions, and mutation order. Keep domain
extensions explicit. Currency/Product lifecycle policy differences require
an explicit decision; shared algorithms alone do not authorize changing them.
Delete each displaced path when both consumers and boundary tests pass.

A complete configured module set remains a separate composition obligation;
sharing a query engine does not automatically combine
Currency and Product schema artifacts or grant cross-module transactions.

Customer remains a possible later module reuse proof, not the next dependency
for the user-selected Product workflow goal. The
[Sales Channel foundation preflight](./50-product-workflow-sales-channel-foundation.md)
now owns the proposed next connected proof. Customer's pinned
[static manifest](../../../third_party/medusa/upstream/packages/modules/customer/src/static-manifest.ts)
has four models and no custom repository registrations. Its
[Customer model](../../../third_party/medusa/upstream/packages/modules/customer/src/models/customer.ts)
adds addresses, an explicit group pivot, deletion/detachment policies, nullable
searchable fields, and an active-row composite unique index. This is a useful
structural contrast to Product; full Customer compatibility is not yet claimed.

Success for that later module means adding admitted source, model/capability
registration, necessary named extensions, and tests without adding Customer
branches to the shared read/write algorithms. Novel query or constraint
requirements must extend their real capability owner and rerun existing module
regressions. Inventory/Pricing custom repositories, stored Module Links,
workflows, distributed locks, durable business events, general migrations,
public serving, and production activation retain their independent gates.

This Medusa repository work follows the accepted framework execution profile;
it does not port commerce queries through Convex document APIs or change
Application OCC. The next proposed milestone validates reuse through a required
Product-workflow dependency and its actual stored Link, rather than adding a
module solely to exercise the abstraction. Its core admission gates remain
separate from this completed shared-adapter work.
