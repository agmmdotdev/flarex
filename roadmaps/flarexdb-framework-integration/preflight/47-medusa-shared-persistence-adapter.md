# Shared Medusa persistence adapter preflight

## Status and scope

Status: proposed; research complete, implementation awaits approval. Recommend
one shared Medusa adapter built from the completed Currency and Product
integrations. The first implementation capability is a shared runtime catalog,
query compiler, and read/projection executor used by both modules. Subsequent
capabilities generalize schema/write mechanics and module composition.

This is an adapter architecture proposal, not permission to change Flarex
transaction settlement, commit compilation, schema identity, resource limits,
public APIs, or production routing. A general adapter remains Medusa-owned;
Flarex core does not acquire knowledge of Product, Customer, or Medusa DML.

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

## Following capabilities and module proof

After shared reads pass, consolidate schema/value and write machinery into
reusable Medusa-owned components: checked DML lowering, scalar codecs, keyed
updates, graph creation/replacement, FK/pivot planning, and event dispatch
mechanics. Preserve insert versus upsert, omitted versus empty relationships,
identity retention, metadata merging, reference ownership, managed-field
refusal, actual-row performed-actions, and mutation order. Keep domain
extensions explicit. Currency/Product lifecycle policy differences require
an explicit decision; shared algorithms alone do not authorize changing them.
Delete each displaced path when both consumers and boundary tests pass.

Then add module-scoped preparation and repository construction through the
actual Medusa persistence contract, retaining trusted command admission and
Flarex installation ownership. A complete configured module set is a separate
composition obligation; sharing a query engine does not automatically combine
Currency and Product schema artifacts or grant cross-module transactions.

Recommend Customer as the next module reuse proof. Its pinned
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
Application OCC. The nearest useful milestone is demonstrable cross-module
adapter reuse with Currency and Product, followed by one independently admitted
module that validates the abstraction.
