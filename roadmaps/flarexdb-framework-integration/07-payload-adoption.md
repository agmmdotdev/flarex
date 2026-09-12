# Payload Adoption

## Status And Scope

Status: private pinned `payload@3.88.0` scalar Local API CRUD is implemented for
the closed headless profile with exact combined content/lifecycle admission.
Create, reads, count, update, defaults/validation and fixed nested-hook behavior
use the implemented CMS host and Application publication on both drivers.
Delete uses exact `payload-preferences` cleanup with atomic lifecycle facts.
Content-only composition still rejects cleanup with full rollback. The [focused lifecycle proposal](./preflight/19-payload-preference-cleanup-and-delete-publication.md)
now implements private preference storage, binding, and bounded CMS cleanup
with authenticated receipts, atomic publication, and exact Payload delete
routing. The [content-relation preflight](./preflight/20-payload-content-relations-and-rebinding.md)
implements optional `posts.relatedPost` at depth zero, authenticated same-owner
configuration advancement, exact combined rebinding and native CMS publication.
The [population contract](./preflight/21-payload-many-transition-and-bounded-population.md)
implements bounded depth-one standalone forward reads over that relation. The
[fresh many profile](./preflight/22-payload-many-installation-and-migration-boundary.md)
adds ordered `relatedPosts` CRUD and depth-one population with exact fresh
ownership/binding and native publication. The separate fresh-only
[join profile](./preflight/23-payload-bounded-reverse-joins.md) implements bounded
reverse identities and depth-one source population in the same CMS transaction.
Existing-row conversion and general join parity remain gated. See the [exact profile](./preflight/07-payload-release-and-adapter-contract.md#current-private-conformance).

This plan owns the ordered adoption of Payload over Flarex application storage
and adapter-owned lifecycle state. It does not redefine native relation
semantics, public SDK syntax, or Payload's framework behavior.

The existing private `SV-R Core` relation vertical permits non-reactive Payload
adapter work. Fenced relation-sync registration and `SV-R Live` are
prerequisites only for subscriptions, live invalidation, reconnect, or
resnapshot claims.

Payload is pinned exactly for the private Node proof. Its implemented
compatibility owner is the private `@flarex/payload-adapter` package. There is
no public adapter export, `ctx.cms` runtime, or production Payload path. The
[package extraction record](./preflight/52-payload-adapter-package-extraction.md)
owns the current dependency and cleanup boundary.

The exact Payload contract preflight is accepted in
[`preflight/07-payload-release-and-adapter-contract.md`](./preflight/07-payload-release-and-adapter-contract.md).
It pins `payload@3.88.0` and its peeled release commit, inventories the complete
adapter surface and internal collections, and freezes the first headless Local
API profile. The subsequent private implementation admits only the closed scalar Node
composition, not public package promotion or lifecycle/migration authority. The accepted cross-
lane order is owned by
[`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md).

## Ownership Boundary

FlarexDB owns:

- stable application table and relation identities;
- authoritative document rows and revision history;
- row validation, indexes, uniqueness, relation target integrity, and derived
  edge maintenance;
- exact reads, OCC where applicable, commit facts, and outbox;
- schema artifact/readiness/activation mechanics; and
- trusted migration and operator capabilities.

Payload owns:

- collection/global configuration and observable API behavior;
- access control and principals;
- defaults, field validation, and hook ordering;
- nested request transactions;
- localization and population behavior;
- drafts, versions, publication visibility, and restore;
- uploads and object lifecycle;
- auth, sessions, globals, locks, jobs, preferences, and scheduled publication;
  and
- Payload-compatible query, result, and error behavior.

## CMS Exposure Modes

| Mode | Dashboard | Ordinary write owner |
| --- | --- | --- |
| Application table | absent | `ctx.db` application lane |
| CMS view | read-only | admitted `ctx.db` lane or application-domain commands |
| CMS managed | editable | one private Payload command pipeline through enabled surfaces; planned `ctx.cms` only after its separate public gate |
| Application-command managed | actions delegate to application-domain commands | application-domain command |

An editable CMS-managed table is excluded from ordinary generated `ctx.db`
write capabilities and protected by runtime checks. Migration, import, repair,
and fixtures use explicit privileged authority and cannot bypass database
invariants.

## Schema And Migration Ownership

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
closed on schema mismatch and does not auto-apply lifecycle migrations.

The Payload compiler has no direct schema publication or activation authority.
If the existing authenticated Application Analysis chain cannot admit its
generated input without changing the current sole-source contract, that owner
change requires a separate preflight before the first collection proof.

## Adapter Package

The implementation-bearing package now uses the accepted plain name:

```text
@flarex/payload-adapter
  normalized Payload operations
  pinned compatibility bindings
  narrow private Flarex storage capabilities
  Payload-facing conformance helpers
```

Payload-release differences belong in package-local compatibility bindings and
artifact provenance, not parallel version-named adapter packages.

The package does not own SQL, transaction settlement, Application
materialization, preference storage, commit facts, or publication. Those stay
in `@flarex/persistence-postgres` behind its private CMS adapter facade. The
adapter supplies an opaque exact-profile token to binding admission, so
persistence verifies combined lifecycle bindings without importing Payload
release configuration.

The ordinary runtime owns scoped construction, commands, and binding without
scenario hooks, counters, or raw-instance inspection. The testing subpath's
conformance factory supplies those fixed witnesses through the same internal
construction owner. Operation-specific decoders and directly bound Local API
handlers preserve typed inputs/results inside the unchanged JSON host boundary.
Shared field and query constraints retain separate caller, sanitized-filter,
and authenticated-loader admission. The
[runtime contracts and conformance preflight](./preflight/53-payload-runtime-contracts-and-conformance.md)
owns this cleanup's scope and removal decisions. Apply the repository's
[Payload integration skill](../../.agents/skills/payload-flarex-integration/SKILL.md)
for source reuse, typed contracts, boundary-specific validation, and removal
evidence. This structural cleanup does not broaden the admitted profiles or
change transaction, public-serving, or production capability status.

Ordinary construction now requires compiler-owned scalar collection metadata;
it no longer installs the fixed `posts` fixture. The implemented scalar-first
[collection configuration preflight](./preflight/54-payload-collection-configuration.md)
separates capability contracts from concrete collection definitions and traces
the required analysis, binding, and deletion-owner corrections. Its
first new proof is two fresh Payload-owned scalar collections, not arbitrary
configuration, relation expansion, migration, or serving support. Its uniqueness
prerequisite authenticates single-text unique intent, prepares the definitions
in trusted schema publication, and refuses mismatched
sets during readiness and activation revalidation. Existing scalar conformance
no longer seeds its own unique definition. The private collection compiler now
captures a closed native scalar definition set, sanitizes owned copies, and
lowers through shared schema authoring into the existing loaded-source analysis
input. Descriptor revision 3 records native field order, literal defaults,
collection-to-table mapping, and managed timestamp mode as well as uniqueness.
The private consumers use that revision; old bytes fail decoding rather
than acquiring new semantics. No stored data is rewritten.

The two-collection integration passes generated declarations through shared
loaded-source analysis, publication, readiness, activation, exact binding, and
the six Local API command families. Collection selection is captured in request
identity; checked metadata drives table, field, equality-query, and native unique
error routing. Stable document IDs must agree with the selected collection's
authenticated table. The opaque binding verifier accepts compiler-owned content
identities without granting storage authority. Collection-aware pending-deletion
evidence and native preference keys preserve one transaction, rollback, exact
scope isolation, and atomic row/lifecycle publication.

Fixed scalar/relation/many/join configurations now belong to conformance code,
which uses the same internal composition and request pipeline. No implicit
`posts` selector, old runtime, or caller-supplied configuration callback remains
in ordinary construction. The compiler itself still does not initialize Payload,
install schema state, or issue runtime authority. Native configuration and field
validation stay Payload-owned. Integration source references remain fixtures,
not uploaded or deployed artifact evidence; generalized relations, arbitrary
configuration, serving, and existing-row migration remain outside this gate.

### Runtime Lifetime And Latency Follow-Up

Current composition initializes one scoped Payload instance and reuses it for
its commands; it does not install schemas or bootstrap Payload on each command.
Each root request still performs live authority, active-schema, binding, and
transaction preparation. The [measurement-only baseline](./preflight/62-payload-latency-baseline.md)
now separates first/fresh same-process initialization, binding and warm requests,
using ordinary-role PostgreSQL statement counts and inclusive owner spans. It
identified repeated admission/readiness work. The
[prepared-admission implementation](./preflight/64-payload-prepared-admission.md)
now captures non-executable planning inputs before transaction entry and accepts
them once under the existing scope-clock and active-head locks. Binding,
content ownership and native join reads share that transaction-local acceptance;
the combined Commerce/CMS command borrows the same acceptance without changing
installation-before-Application lock order. Current authority, revocation,
readiness and binding validation remain mandatory on every request and replay.
No request-authority cache or scalar-only alternate path was introduced.
Inclusive spans are not additive; cold processes, isolated lock waits,
contention and deployed latency remain unmeasured.
Reusable immutable metadata must not become a cache of request authority.
Principals, mutable requests/loaders, cancellation, and transactions stay
request-owned; a bound host's access policy is not automatically shareable
across users. Initialization caching/eviction and any lock-duration or authority
change require their own approved design, not an adapter optimization here.

## Implementation Sequence

### Exact Payload contract preflight

- Completed for `payload@3.88.0`, peeled release commit
  `fea6f8a47a50ff1330d8a5071b43e7dcffb97b22`, with npm integrity recorded
  separately from Git provenance.
- The complete `BaseDatabaseAdapter`, query/result/error, request transaction,
  migration, internal collection, relationship, package, and host constraints
  are inventoried.
- The first profile is headless Local API over one exercised scalar content
  collection, with an explicit dormant auth collection required by sanitized
  Payload configuration and a fail-closed non-database KV adapter. It rejects
  arbitrary user hooks/access callbacks, uploads/remote effects, auth
  operations, dashboard behavior, migrations, internal/KV access, and every
  unadmitted adapter method.
- Authenticated dashboard support waits for a dedicated preferences, auth,
  locking, polymorphic-relation, and lifecycle gate because
  `payload-preferences` is polymorphically relational to auth collections. The
  first monomorphic content-relation slice is not sufficient.

### Shared-core and Application preservation prerequisites

Before the first Payload adapter or writable collection is implemented:

- retain the completed private value-only relational schema and accepted
  installation/migration design, then complete the remaining pure lifecycle,
  installation/readiness/availability, migration-coordinator, separate binding,
  owner-scoped transaction/store, receipt/finalizer, and synthetic reserved-
  relational lifecycle/transaction proof gates required by the core-first
  preflight;
- rerun the complete existing Flarex Application document, OCC, native-relation,
  commit, and read vertical without routing Application content through the
  reserved-relational store; and
- retain Application as the schema, row, OCC, relation, and commit authority for
  Payload content.

These prerequisites prepare shared mechanisms and prove non-regression. They do
not make Payload content a `RelationalSchema` consumer or authorize Payload
framework behavior inside shared core.

### CMS request transaction and commit participation preflight

Before scalar CRUD implementation, complete the mandatory transaction-owner and
commit-owner preflights from
[`04-transactions-and-commit-publication.md`](./04-transactions-and-commit-publication.md):

- define the CMS request transaction host, nested Local API reuse, scope and
  binding revalidation, timeout, interruption, rollback, settlement, and exact
  finalization boundary;
- resolve the proposed
  [standalone read contract](./preflight/07-payload-release-and-adapter-contract.md#proposed-standalone-read-contract):
  a missing ID on standalone find/count is distinct from a presented invalid
  token; freeze snapshot/isolation and paginated count consistency, and prove
  nested reads reuse the mutation's transaction-local state;
- compose authenticated Application row and later relation capabilities without
  exposing the current `AppRowTransaction`, a raw database handle, or the
  reserved-relational transaction host;
- do not use the Dynamic Worker logical journal for trusted Payload commands;
- publish scalar content mutations only through the already admitted exact
  Application-row fact family and common finalizer; and
- require a separate typed family and commit-owner preflight before any Payload
  lifecycle sidecar can participate in a commit.

This gate must be accepted before implementing nested rollback, transaction-
local reads, or the exactly-one commit/change/outbox claim.

The shared-core implementation status is maintained in the
[master capability matrix](./README.md#current-gate-status). The headless scalar
and native relation proofs remain the Payload prerequisites for Medusa;
dashboard, general hooks and broader lifecycle support are later capabilities.

### Application write-policy admission preflight

The concrete [Application table write-policy proposal](./preflight/18-application-table-write-policy.md)
now implements the private denial prerequisite, with shared PGlite and native
PostgreSQL evidence through publication, activation, recovery and commit denial.
No Payload writer is activated by this capability.

This separately approved Application-owner gate is mandatory before the first
writable Payload vertical because the current framework-binding work does not
authorize a change to application commit admission:

- define an independently digestible Payload configuration/provenance artifact
  over stable logical table identities and a stable Payload policy ID,
  excluding the later exact Application head/schema/readiness/placement
  reference and every digest derived from it;
- record that policy ID and configuration digest as authenticated per-table
  write-policy evidence in the canonical Application artifact;
- make every application write admission consult that evidence at runtime;
- use a newly declared Payload-managed table for the first proof;
- activate its Application artifact in a state that rejects ordinary `ctx.db`
  writes while Payload writes remain unavailable;
- construct and activate the content overlay only after the Application artifact
  is final, referencing both digests plus the exact Application
  schema/readiness/placement and table identities, and only while that head and
  policy evidence still match; and
- defer transfer of an existing app-writable table until a later gate proves
  atomic capability revocation and overlay activation with no dual-writer
  interval.

### Relation-free schema binding

- For the first vertical, bind one Payload-configured collection containing
  top-level scalar fields and send its pinned, provenance-bearing compiler
  output through the existing authenticated Application Analysis/publication
  chain to produce one canonical Application schema candidate with exact stable
  table identities.
- Make the Payload content overlay reference that exact active Application
  head/schema/readiness/placement reference and table identity, its
  authenticated write-policy evidence, and the pinned Payload
  configuration/provenance digest; do not install a second content schema. Add
  a separate lifecycle binding only when physical Payload lifecycle structures
  exist.
- Select the CMS-managed write-authority mode for that fixture.
- Reject conflicting ownership and unsupported fields/options before startup.
- In a separate follow-up fixture, expose an already Application-owned table as
  a read-only CMS view or application-command-managed view while its admitted
  `ctx.db` lane/application-domain commands remain the write owner.
- No table has two schema or ordinary write-policy owners in either fixture.
- Keep versions, drafts, auth operations, user globals, uploads, content
  relations, and lifecycle migrations disabled. Declare the required dormant
  auth collection explicitly with `lockDocuments: false`; do not describe the
  sanitized configuration as auth-free.
- Explicitly disable document locking, jobs, folders, and query presets. Supply
  a fail-closed KV adapter so the default database KV adapter and `payload-kv`
  collection are not injected. Inventory the always-present
  `payload-preferences` and `payload-migrations` collections plus the
  preferences polymorphic relation. The bounded harness must prove that its
  startup and admitted `posts` operations do not touch an unbound surface; any
  internal, auth, migration, or KV access fails closed before data access.
- "Relation-free" describes the user content fixture, not the full sanitized
  configuration: the always-present preferences definition still contains its
  internal polymorphic user relationship and must remain unusable until its
  dedicated lifecycle gate.

### Runtime write-authority prerequisite

This gate must pass before the first CMS-managed write is accepted:

- Prove CMS views are read-only through Payload.
- Route CMS-managed writes through one private Payload command implementation.
- Keep application-command-managed aggregates free of raw dashboard mutation.
- Reject direct application writes to Payload-managed tables at runtime.
- Make any trusted access override explicit and separately authorized.
- Prepare capability/codegen exclusion for later public surfaces, but do not
  treat TypeScript exclusion as the runtime trust boundary.
- Expose only a private operation suitable for later dashboard and `ctx.cms`
  composition; public syntax and codegen remain SDK-roadmap work.

### Scalar CRUD and request transaction

- Apply the accepted [execution-profile contract](./preflight/14-transaction-execution-profiles.md)
  through the CMS host; preserve Payload's request lifecycle without routing
  it through Application's logical journal or arbitrary-callback OCC replay.
- Implement the admitted CRUD, find, count, filter, sort, selection, and page
  subset over application rows and declared indexes/uniques.
- Reuse one request transaction for nested Payload operations.
- Roll back every nested row and sidecar mutation on failure.
- Prove outer-owner settlement: nested completion cannot commit, a caught
  borrowed-operation failure remains rollback-only, and a lost/closed mutation
  session cannot fall back to an independent database connection. Keep valid
  standalone reads under their separate admission contract.
- Publish Flarex commit/change/outbox evidence exactly once.
- Do not use the Dynamic Worker logical journal for trusted Payload commands.
- Use PGlite for the fast matrix and genuine PostgreSQL for rollback,
  uniqueness, transaction-local reads, and concurrency.
- Use one fixed conformance-only nested callback to prove same-request reuse;
  do not turn that proof into general user-hook support or hold the first
  product transaction across arbitrary remote/file work.
- Preserve supported hook ordering and pending-write visibility. `afterChange`
  runs before commit in the pinned source; do not relocate it after commit.
  Auth email, uploads, and arbitrary external-effect hooks remain outside this
  first profile. Later admission must resolve their effect/retry semantics.

### Relation-bearing Application candidate and overlay rebinding

The [focused preflight](./preflight/20-payload-content-relations-and-rebinding.md)
owns the implemented optional-one successor. It preserves owner identity and
old scalar bytes, verifies unchanged scalar/index/unique definitions, and
revalidates the transition through retained authenticated catalog evidence.
Application activation invalidates the old content overlay; exact combined
content/lifecycle rebinding restores serving without a dual-writer interval.
The [many-transition and population preflight](./preflight/21-payload-many-transition-and-bounded-population.md)
implements depth-one standalone reads. An existing-row many-valued successor
requires explicit conversion and migration-host authority; adapter defaults and
edge backfill cannot supply that authority. The [installation/migration
assessment](./preflight/22-payload-many-installation-and-migration-boundary.md)
implements fresh-install many conformance, with existing-row upgrades deferred
until their supported obligation and authority are established. Many-valued
fields are supported by the fresh profile; the separate fresh-only join profile
completes the bounded reverse consumer contract below.

- Capture a new independently digestible relation-bearing Payload
  configuration/provenance artifact. The stable Payload policy ID and ordinary
  write-owner mode may remain unchanged, but the configuration digest must
  change from the scalar candidate.
- Compile that exact relation-bearing configuration through the existing
  authenticated Application Analysis/publication chain as one new Application
  schema candidate, recording the new Payload configuration digest in its
  authenticated per-table write-policy evidence.
- Build its managed-schema structures and activate only after the exact
  readiness proof passes.
- Rebind the Payload content overlay to that exact active Application head,
  schema/readiness/placement reference, stable table and relation identities,
  authenticated write-policy evidence, stable policy ID/write-owner mode, and
  the new relation-bearing Payload configuration/provenance digest.
- Reject serving from the previous overlay after Application head movement and
  prove that no second content schema or dual-writer interval exists.
- Keep Payload lifecycle/data migrations and unrelated schema features disabled
  for this first relation candidate.

### Native relation adoption

Optional-one and fresh-install many self-relations are implemented through
Payload CRUD and bounded forward population. The separate fresh-only join
profile adds actual Payload reverse fields. The completed bounded private
adoption milestone establishes these guarantees:

- top-level, nonlocalized, monomorphic one/many values;
- duplicate rejection;
- target liveness and restrict deletion;
- source cleanup, retarget, reorder, and removal;
- bounded forward identity reads; and
- bounded reverse identity reads without unsupported filtering, sorting,
  counting, or orderability.

These native behaviors have private consumer evidence on both drivers. The
[bounded reverse-join capability](./preflight/23-payload-bounded-reverse-joins.md)
implements both virtual fields through a request-bound CMS read capability,
with first-window identities and depth-one population. Root, edge and source
reads share admission and locking. No new write or migration owner is introduced.
This closes the bounded non-reactive prerequisite for the Medusa Currency
package-convergence preflight. General join pagination and dynamic access remain
outside the supported profile.

The Payload adapter separately composes bounded forward population, reverse
join behavior, authorization, and response shaping over those native
guarantees. That composition does not expand the native relation contract.

Repeated relation targets remain disabled. A separate later gate must prove
stable repeated-occurrence identity, ordering, mutation, OCC, and pinned Payload
conformance before accepting a configuration that permits them.

The `3.88.0` relationship validator does not itself establish duplicate-target
rejection for `hasMany`. Duplicate rejection is therefore an explicit Flarex
profile constraint and unsupported Payload input, not a claim of complete
upstream parity.

Run the claimed upstream relationship behavior plus PGlite and genuine
PostgreSQL evidence. This step makes no subscription or reconnect claim.

### Broader schema evolution and lifecycle migrations

An existing-row upgrade to the first proposed many-valued content field needs
this owner decision even though its Payload input is optional: native storage
requires a present array. Fresh-install many conformance can be proved separately
and cannot be used as evidence of such an upgrade.
The [transition contract](./preflight/21-payload-many-transition-and-bounded-population.md#optional-many-existing-row-decision)
records the serving fence, candidate validation, normal row publication,
resumable conversion and recovery decisions that must precede implementation.
The [migration-host assessment](./preflight/22-payload-many-installation-and-migration-boundary.md#existing-row-conversion-contract-deferred)
also requires coverage of Application readers, candidate/prior validation,
durable progress and recovery across activation and rebinding. No general
migration engine or permanent dual writer is implied or currently authorized.

- Publish content changes only through the authenticated Application
  Analysis/publication chain as Application schema candidates.
- Activate only after existing managed-schema readiness.
- Only after a separate Payload migration-host preflight, execute lifecycle/data
  plans through any shared fenced mechanics that the proof admits.
- Prove checksums, replay, interruption, retry, receipts, and recovery.
- Permit hook bypass only through explicit migration/import/repair authority
  while retaining row, relation, uniqueness, scope, feed, and outbox rules.

### Lifecycle islands

Admit each independently rather than claiming broad Payload parity:

- globals;
- localization;
- nested arrays and blocks;
- uploads and object lifecycle;
- auth and sessions;
- versions, drafts, and publication visibility;
- document locks; and
- jobs, preferences, and scheduled publication.

Draft/version relations require explicit visibility, edge, delete, and
invalidation semantics.

### Reactive relations

This step requires fenced relation-sync registration and `SV-R Live`.

- Consume native typed relation facts and registration authority.
- Prove duplicate, reverse, gap, lost-wake, restart, epoch, retained-floor,
  resnapshot, and reconnect behavior.
- Do not introduce a Payload-local invalidation registry or timestamp fallback.

## Application/CMS-To-Commerce References

Payload may manage an extension row that refers to a stable commerce identity.
It may mutate only the extension row. Target mutation goes through the commerce
lane.

The reference is neither a Payload reverse join nor a Medusa Module Link.
Existence, deletion, soft deletion, visibility, staleness, and binding
compatibility require an explicit cross-domain reference contract.

## Exit Criteria For Private Integration

- Every enabled table has one write-policy owner.
- The claimed Payload operations and errors match the pinned release.
- Nested request operations are transactionally atomic.
- Content schema and lifecycle migrations follow their separate owners.
- Native relation reuse introduces no second row or edge authority.
- Genuine PostgreSQL proves concurrency and rollback claims.
- Reactive behavior is claimed only after its external prerequisites pass.
- Public `ctx.cms`, dashboard routing, hosted operation, and production
  activation remain separate explicit decisions.
