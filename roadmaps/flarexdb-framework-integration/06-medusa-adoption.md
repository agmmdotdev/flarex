# Medusa Adoption

## Status And Scope

Status: accepted source-backed adoption sequence. The private Currency, Product
and Sales Channel integrations execute promoted Medusa services through Flarex-owned
installation, scoped transactions, and relational publication. Currency proves
its complete original integration file and seed-gated initialization. Product
proves all ten inventoried integration files, including public and internal
services, graph mutation, lifecycle, events, category trees, and the bounded
1000-image case. The [completed compatibility record](./preflight/46-commerce-command-registration-bound.md)
and [active case inventory](./preflight/product-upstream-test-cases.json) own the
current suite boundary and retained skips; earlier partial-suite counts are
historical checkpoints.

The [shared persistence adapter](./preflight/47-medusa-shared-persistence-adapter.md)
now centralizes checked runtime metadata, schema lowering, JSON-field decoding,
repository reads/projections, keyed updates, graph writes, mutation dispatch and
module-scoped repository/service construction for Currency, Product and Sales Channel. Named
domain policies retain query admission, Category tree/sort behavior, membership
exclusions and distinct lifecycle contracts. Product command assembly separates
profile preparation, reads, mutations and direct internal calls behind its
existing entry point. Product public commands and Currency reads share scoped
command construction with direct native-method bindings; domain-specific
admission and native upsert/lifecycle semantics remain explicit.
The exact Product + Sales Channel endpoint set shares one configured schema
installation with separately confined profiles. The approved
[B1 correction](./preflight/55-shared-installation-atomic-commerce.md) adds
same-installation atomic participants and is complete. Arbitrary configured
module sets remain unadmitted. Medusa services
remain above the existing Flarex transaction and publication owners.

The user-selected next integration outcome is full Product workflow execution.
The [Sales Channel and first stored Link preflight](./preflight/50-product-workflow-sales-channel-foundation.md)
traces `createProductsWorkflow` and defines the connected Sales Channel endpoint,
ProductSalesChannel Link and native association-step milestone. Customer is a
deferred adapter-reuse candidate, not a Product-creation prerequisite. The new
foundation gate is complete. Its [core binding correction](./preflight/51-commerce-installation-profile-bindings.md)
separates physical readiness from authorized execution profiles and is complete.
One unversioned current binding API
replaces the development-only encodings; the owner confirmed no production data
or retained compatibility obligation. Neutral core fixtures exercise three
disjoint profiles without module-specific branches. Same-installation atomic
participants retain those confined profiles. The approved
[stored ProductSalesChannel Link](./preflight/57-stored-product-sales-channel-link.md)
adds a fresh fifteen-table candidate and a third confined profile. Its actual
native Link router/services implement attach, tuple dismiss, endpoint-selected
soft-delete/restore and Link-root reads. Native event evidence, complete-key
ordering, atomic endpoint-plus-Link composition, replay and rollback are covered
by complete PGlite and ordinary-role PostgreSQL conformance. Shared assignment
batching replaces repeated installer SQL without changing its deadline or adding
a Medusa-specific core branch. The construction entry
point owns native wiring without exposing repository/manager assembly to callers.
The [Gate C composition](./preflight/58-native-product-sales-channel-workflow.md)
uses the actual native Product/Sales Channel creation and association steps.
Its named private facade selects one channel and one to four simple Products,
associates returned IDs, and reads pending Product, Sales Channel and Link roots
through the existing atomic workflow host. Module-owned registrations hide
method/repository assembly; root rollback restores pre-existing Link state rather
than executing inverse callbacks. This gate adds no core/schema/engine changes.
Cross-module graph hydration and full `createProductsWorkflow` remain unadmitted.
The [shipping-profile foundation](./preflight/59-product-shipping-profile-foundation.md)
implements its shared text-inequality prerequisite and native cardinality
characterization, not Fulfillment/ProductShippingProfile activation. Inequality
is explicitly admitted for Link IDs and the Sales Channel ID, with shared
scope, null, pagination/count and resource limits. The approved
[native batch correction](./preflight/61-native-link-batch-cardinality.md)
rejects contradictory incoming partners from relationship metadata before any
service create. Many-to-many behavior and exact duplicate delegation are retained,
without a Flarex core change.
The implemented [singular-Link storage foundation](./preflight/63-native-singular-link-storage.md)
derives active uniqueness from native metadata and protects tuple endpoints
from extra-data replacement, reusing existing Flarex partial-index machinery.
Shared scalar-Link schema, repository, native wiring and event mechanics serve
both the unchanged ProductSalesChannel binding and a neutral one-to-one stored
proof. Pair identity survives soft deletion; conflicting reattach or restore
rolls back without facts/events. Scope isolation and actual PostgreSQL unique-index
contention are covered independently of host serialization. This foundation
retains the existing core capability and public activation boundary.
The implemented [connected ShippingProfile slice](./preflight/66-connected-product-shipping-profile.md)
adds native ShippingProfile creation and scalar reads, with the real Fulfillment
constructor but only one selected Fulfillment table. A fresh seventeen-table
schema contains Product, Sales Channel and both homogeneous Link families under
one native router. The private workflow creates the endpoints, associates Sales
Channels before ShippingProfiles, reads five pending roots and settles once.
The source closure remains broader than table/API grants; provider execution,
deletion, hydration, full Fulfillment and public activation remain unadmitted.

The [framework installation core redesign](./preflight/76-framework-installation-core-redesign.md)
is complete within its approved bounded profiles. Persistence now owns protected
immutable definitions/evidence, sealed child sets, durable operational progress,
prepared construction, explicit full verification and exact publication handoff.
Normal steps and live resume avoid growing historical reconstruction; settled
replay reads current availability using its full head's readiness. Full verification,
uncertain recovery and runtime cold construction retain their independent contracts.
The unchanged seventeen-table fixture meets its frozen acceptance gate on both
drivers. Exact samples live in artifacts and Git; this is not arbitrary-inventory
or deployment proof. PGlite remains functional-only and native execution requires
actual restricted logins on every acquired connection.

Earlier reconstruction-only candidates remain withdrawn and the narrower record
75 proposal is superseded. Medusa's current module/Link semantics and Payload's
structural lifecycle consumer share the corrected installer while Application
content-schema authority remains separate. ShippingProfile retains its private
commerce error envelope. The two pinned native creation/event cases execute
unchanged through the native service and emitter; exact duplicate-message parity
and both native deletion cases remain deferred in the retained original source.

ShippingProfile's approved [resource admission](./preflight/92-shipping-profile-workflow-resource-admission.md)
selects 128 calls for four fresh named profiles and the trusted root, keeping
one-to-four Products and every other budget unchanged. Each participant still
caps the root. Existing default profiles, their 64-call refusal, identity/replay
semantics and the independent ProductSalesChannel workflow remain supported.
The native module's unselected public methods are explicit sticky refusals,
including provider calls and empty writes caught after pending creation.

The next proposed [Product Variant Pricing admission](./preflight/93-product-variant-pricing-admission.md)
starts with shared exact-numeric, compound-index and child-population prerequisites
exposed by the pinned native PriceSet create path. Native creation rereads prices
and rules, and Price's nullable PriceList FK retains a structural table dependency.
The proposed connected branch creates variants, PriceSets and their singular Link
under one root. Pricing runtime promotion and the new shared contracts still
require approval; Inventory/Stock Location and the complete Product composer
remain subsequent admission gates.

The approved [JSON identity and retained-outcome correction](./preflight/60-commerce-json-identity-and-outcomes.md)
gives both commerce hosts domain-separated ordinary JSON identity and result
evidence, including reserved and Unicode keys. Shared idempotency rows retain an
explicit encoding, including after expiration; existing rows remain Application
evidence without re-encoding. The existing bounded resolver rejects the wrong
family before byte transfer. Application, CMS and cross-domain encoding is
unchanged. Old private commerce request keys conflict rather than being replayed
under new semantics; no compatibility wrapper or second outcome store exists.
Sales Channel's six-command profile preserves the original service and static
cases, native metadata merging, scalar/array results, pagination and errors.
Boundary checks retain input refusal, identity protection, replay, service
lifetime and complete event-evidence rollback. Upsert, selector updates and
soft-delete/restore remain unadmitted rather than inferred from the native class.

Gate A exposed a
[shared module-construction defect](./preflight/47-medusa-shared-persistence-adapter.md#native-mutation-subscriber-construction-contract):
the native constructor lacked the prepared persistence dependency required to
connect mutation subscribers. Its approved correction supplies one shared typed
constructor dependency object, retaining the neutral module and Sales Channel
write witnesses. Product/Currency regression coverage is preserved. This
completed correction changes shared Medusa adapter composition, not Flarex core.
The Sales Channel entry point reuses it without module-specific subscriber wiring.

Complete integration-suite coverage does not establish arbitrary input parity
or a complete module bootstrap/migration adapter. Other stored Module Links,
workflows, distributed locks, durable business-event delivery, general module
migrations, public serving, and production activation remain separately gated.

This plan owns the ordered adoption of the Medusa fork onto FlarexDB reserved
relational storage. It preserves Medusa's DML, module, repository, Query, Link,
workflow, locking, idempotency, and commerce-event semantics.

It does not turn Medusa tables into public application tables or make Flarex
core depend on Medusa.

## Source Authority

The primary integration source is the Cloudflare-oriented fork maintained at
`https://github.com/agmmdotdev/medusa-fork.git`. Official Medusa source and npm
packages are historical provenance, licensing, and comparison evidence; they
will not override behavior in the future selected fork snapshot.

[`preflight/04-medusa-fork-source-island-and-package-convergence.md`](./preflight/04-medusa-fork-source-island-and-package-convergence.md)
owns the exact source hierarchy, clean pin, inert `third_party/medusa` island,
verification contract, reuse classification, and later package-promotion
gates. The island is not a production dependency. Only source-map-admitted
packages promoted into the active root workspace may later enter the Medusa
adapter graph.

[`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md)
owns the prerequisite order before any such package promotion. Source mapping
and inert fixture extraction may proceed early. The shared-core, Flarex Application,
and bounded Payload gates have passed. Exact Currency source promotion is also
complete, as are private Flarex-backed Currency installation and service
execution. Product schema/relationship installation, private nested creation,
bounded population and local event conformance are complete. Related creation
and bounded reads are implemented under record 30; keyed tag/type updates under
record 31. Records 32-34 implement the larger Product mutation and lifecycle
milestones, including explicit shared reference-update, declared-key removal
and managed-transition capabilities. General Payload
compatibility is separate.

[`preflight/06-medusa-package-capability-source-map.md`](./preflight/06-medusa-package-capability-source-map.md)
now owns the exact fork-pin capability audit, the reproducibly measured
65-input Currency semantic graph, exploratory broader graph notes, reuse
classifications, retained test inventory, and source consequences for the
value-only relational schema. Its companion JSON is machine-readable audit
evidence, not a promoted package manifest.

The admitted island now pins fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` as 8,496 exact tracked regular
files under [`third_party/medusa`](../../third_party/medusa). Its checksum and
boundary verifiers are root-owned admission tooling, not a Medusa runtime
dependency. Seven private root `@medusajs/*` packages and the private
`@flarex/medusa-adapter` value translator now exist under the exact Currency
promotion manifest; their presence does not authorize live serving.

## Current Source Findings

The locally audited fork demonstrates important compatibility surfaces:

- modules currently consume the mature `@medusajs/utils/dml/model` grammar,
  whose models include scalar fields, indexes, checks, defaults, soft-delete
  behavior, and relationship metadata;
- the newer `@medusajs/dml` implementation is currently scalar-only even though
  its types describe relationships, so it is not the module grammar to mirror;
- repository contracts include transaction reuse, list/count/query, create,
  update, upsert, delete, soft delete, restore, and relation replacement;
- static module manifests provide a Worker-safe alternative to filesystem
  discovery;
- `Context.transactionManager` is the existing transaction propagation seam;
- Module Joiner and Link definitions carry endpoint, alias, cardinality,
  cascade, extra-data, and read-only semantics; and
- custom repositories and Query require more than basic generated CRUD.

The fork is also substantially more advanced than a plain Node-oriented
Medusa checkout. It contains portable DML/DAL experiments, Drizzle and
Cloudflare persistence packages, Worker-safe runtime entrypoints, static
manifests, Query/runtime work, Cloudflare workflow/event/lock integrations,
physical Worker import guards, and real unchanged module assertions exercised
through multiple persistence lanes.

That work is valuable source and conformance evidence to reuse. It is not yet
a Flarex-backed production adapter:

- prepared module models are held in mutable module-global state while static
  modules may load concurrently;
- its generated Drizzle migration adapter intentionally throws from the
  optional run/revert methods and therefore does not provide the Flarex-managed
  production migration lifecycle;
- link modules still use MikroORM entity generation and PostgreSQL
  introspection/diff logic; and
- Link uniqueness uses an application precheck that storage must close under
  concurrency.

The exact audit has now regenerated these findings at fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The checked-in command
reproducibly measures a 65-input real Currency model/service graph with zero
checked Worker blockers. The observed 76-input static-manifest and 130-input
eager Drizzle graphs remain exploratory snapshots without a frozen reproducible
tool policy; their exact counts are not accepted receipts. Source evidence still
rejects the eager Drizzle graph as an unchanged Currency closure. The first
later promotion therefore separates Currency semantics/static bootstrap from a
translated persistence seam.

## Ownership Boundary

FlarexDB owns:

- scope-qualified physical lowering;
- schema artifact, installation, migration receipt, readiness, and binding;
- columns, indexes, checks, constraints, and transaction enforcement;
- transaction settlement and commit publication;
- optional derived adjacency and storage observability; and
- backup, restore, repair, and operator mechanics.

Medusa owns:

- DML authoring and normalization;
- static module manifests and dependency injection;
- complete module-set coordination;
- Joiner aliases, linkable keys, and Module Link meaning;
- repository and custom-repository behavior;
- query-option, Query, RemoteJoiner, GraphQL, and index planning;
- Link attach/dismiss and lifecycle;
- workflows, locks, idempotency, and commerce events; and
- semantic migration and data-backfill intent.

## Module-Scoped Persistence Preparation

Replace process-global prepared-model state with an immutable module-scoped
binding:

```text
prepareModule(module identity, normalized models, repositories, capabilities)
  -> PreparedModulePersistence
```

The result captures the exact module schema subset and authorized relational
handles. Loading another module cannot change it.

All module preparations and resolved links then feed one coordinator. Here,
"complete" means the complete configured supported module/link set for that
candidate, not every module in the commerce universe:

```text
static manifests
  -> normalize actual DML
  -> collect module ownership and capabilities
  -> resolve Joiner and Module Links
  -> finalize complete configured candidate set
  -> compile one owner-qualified artifact whose payload is RelationalSchema
```

Do not create a third DML grammar. Normalize the mature Medusa model once and
compile its value output into Flarex `RelationalSchema`.

## Initial Compatibility Profile

The first supported environment is deliberately narrow:

- one admitted clean snapshot of the primary Medusa fork with its official
  upstream provenance baseline recorded;
- one homogeneous configured supported module/link set per candidate; the
  first candidate may contain Currency alone;
- one shared physical relational installation;
- scope-qualified reserved tables and constraints;
- static manifests rather than runtime filesystem discovery; and
- no per-scope custom schema or staggered module generation.

Unsupported modules, repository capabilities, link shapes, triggers, or
migration requirements fail admission before serving traffic.

## Implementation Sequence

### Source-island admission

- Completed without adding a root package, adapter, runtime import, route, or
  deployment binding.
- The clean committed fork pin, independent workspace, lockfile, patches,
  package graph, provenance, licenses, exact bytes/modes, and selected
  regression commands are preserved and mechanically verified.
- The root boundary derives active Flarex package names from root manifests and
  rejects package/import edges, relative or absolute file and workspace path
  dependencies, manifest/TypeScript/bundler aliases, static code and JSDoc
  references, symlinks, broad workspace membership, and implicit root-script
  entry. Island manifests, sources, configs, and symlinks are checked in the
  reverse direction. A dedicated path-filtered CI job enforces admission.

### Source maps and contract audit

- Completed at the exact admitted pin without importing the island into Flarex
  code.
- Mature DML remains the schema-normalization authority; standalone
  `@medusajs/dml` is rejected as a relationship-capable replacement.
- Repository, transaction, Query, Joiner/Link, migration, workflow, lock,
  idempotency, and event capabilities are classified with exact sources.
- Currency model/service/static inputs, initial data, legacy migrations, test
  evidence, graph measurements, and package direction are frozen as audit
  constraints.
- The current process-global prepared-model/module registries are rejected as
  Flarex scope authority.

### Schema admission

- Completed privately in
  [`preflight/08-relational-schema-value-contract.md`](./preflight/08-relational-schema-value-contract.md):
  the canonical value-only `RelationalSchema`, deterministic normalization,
  framework-artifact digest/provenance composition, and unsupported-capability
  failures use the source-audited capability matrix and exact representative
  fixtures.
- Owned by
  [`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md):
  scope-isolated physical lowering, stable collision-domain migration
  coordination, structural readiness, and availability. Private values and
  metadata/repositories are implemented; the target/session, runner and fresh
  coordinator have no-base PGlite-functional evidence. Native acceptance,
  scale, base-backed execution and the later binding checkpoint remain open.
  Use the [master capability matrix](./README.md#current-gate-status) for
  cross-lane status; these mechanisms do not establish a live Medusa compiler
  or repository adapter.
- Keep live fork DML normalization and candidate compilation outside this step;
  those begin only after the connected source closure is promoted.
- Generate no public application schema and expose no raw database handle.

### Shared-core and earlier-lane promotion hold

Do not begin the Currency-connected foundational promotion until all of these
are complete:

- the completed exact Medusa source/capability map and exact Payload contract
  preflight;
- completed value-only `RelationalSchema` admission;
- completed framework installation, readiness, availability, and migration-
  coordinator mechanics, followed by the separate binding checkpoint;
- an owner-scoped relational transaction/store capability;
- transaction-bound mutation receipts and typed common finalization under their
  separately accepted owner preflights;
- a synthetic reserved-relational lifecycle/transaction proof, including
  fail-closed unadmitted-receipt rejection and rollback, in PGlite and genuine
  PostgreSQL;
- the complete existing Flarex Application document/OCC/native-relation/commit
  regression proof;
- Payload scalar CRUD and nested request-transaction proof; and
- Payload's first non-reactive top-level one/many relation proof.

These gates prepare and verify the mechanisms Medusa will later consume. They
do not implement Medusa semantics in shared core. Once they pass, promotion
still begins with unchanged fork compatibility and remains separate from the
later Medusa transaction-propagation and typed commerce receipt adaptations.

### Currency-connected foundational promotion

- Treat the promotion unit as the private, test-only connected Currency
  portability closure, not as one superficially isolated npm package.
- Admit and promote only the actual Currency model, service, static manifest,
  mature DML normalization, and exact portable DAL, modules-sdk, type, utility,
  module-preparation, and repository-adapter closure required to establish the
  unchanged relocation baseline.
- Preserve `@medusajs/*` manifest identities where they are part of the fork's
  internal compatibility graph while using root-owned dependency versions,
  tests, and bundle gates.
- Give every promoted package a source map to the exact fork commit and source
  closure; retain no runtime import or file dependency on the island.
- Establish the unchanged fork compatibility baseline before adapting a Flarex
  host seam.
- Compile the complete configured normalized module/link set for the first
  candidate into canonical `RelationalSchema` values through the promoted
  source closure.
- Before any runtime adaptation, replace mutable prepared-model state with
  instance- or module-scoped ownership and define `MedusaModule` state
  isolation.
- Do not mistake the standalone scalar-oriented portable DML experiment for
  the complete mature relationship-capable module grammar.
- Keep migrations, Link, workflows, locks, events, idempotency, CMS
  interaction, and public commerce APIs outside this first promoted closure.

### Commerce transaction-host admission

- [Record 25](./preflight/25-medusa-currency-host-and-publication.md) combines
  this host, fresh seed-gated installation, bounded DAL and Currency row
  publication into one implemented private capability. Its scope covers those owners
  together; ordinary implementation details do not create new approval gates.
- Apply the accepted [execution-profile contract](./preflight/14-transaction-execution-profiles.md):
  preserve service transaction-manager reuse while Flarex owns the outer
  physical transaction. Workflow orchestration is a separate execution profile.
- Record 25 owns Currency transaction and publication admission together; a
  future module must prove its additional required semantics.
- Prove Flarex-owned scoped physical transaction acquisition, binding
  revalidation, isolation, timeout, interruption, commit, rollback, and
  settlement.
- Adapt Medusa's transaction-manager contract and nested propagation without
  giving Medusa or a repository the raw physical handle or finalizer.
- Preserve current Application lock ordering initially. Resolve the complete
  shared lock order in the transaction-owner contract before any change to
  publication-lock placement; acquisition after lane work is not yet accepted.
- Prove that borrowed-manager completion cannot commit the outer transaction,
  and nested failure cannot escape through an independent transaction.

### Commerce-row commit and event-intent admission

- Currency first proves row facts from seed/private repository writes. Its
  declared public service is read-only; it admits no domain-event family and
  rejects nonempty event handoffs. Event identity and durable delivery below
  remain obligations for the first selected module operation requiring them.
- Reuse shared relational facts and initialization receipts. Dataset size and
  module behavior belong to adapter contracts, not new core metadata per module.
- Add typed commerce-row mutation receipts and facts to the common finalizer.
- Add only the pinned typed Medusa event-intent contracts required by a later
  selected module; Currency admits no domain-event family.
- Persist each admitted event intent with the same commit and common outbox
  wake, then dispatch by stable identity with durable retry and delivery state.
- Intercept the existing service event handoff into that typed intent path;
  `EmitEvents` service completion is not evidence of an outer borrowed
  transaction's commit. Prove rollback suppresses external publication.
- Introduce no temporary publication path, arbitrary event envelope, second
  feed, or second outbox.

### Currency baseline

- Produce a fresh baseline for the Currency module.
- Install through the migration coordinator.
- Bind a scope-pinned commerce transaction manager.
- Adapt generated repository operations.
- Run unchanged Currency service and relevant integration tests.
- Prove scope isolation, uniqueness, rollback, transaction-local reads, and
  authoritative transaction settlement in genuine PostgreSQL.
- Prove each accepted write publishes its typed commerce-row fact, any admitted
  event intent, and the common outbox wake in the same commit.

### Product schema and physical relationships

- [Record 26](./preflight/26-medusa-product-schema-and-relationships.md) implements
  one complete fresh-schema capability: actual ten-model closure, derived
  pivots, shared schema extensions, deterministic installation and physical
  constraint conformance in PGlite and genuine PostgreSQL.
- Preserve implicit unique-pair pivots separately from the explicit
  VariantProductImage entity. Add no Product-specific core metadata.
- Keep this schema proof separate from runtime mutation admission. The
  single-table Currency runtime profile does not expand when a broader
  structural artifact becomes admissible.

### Product local events and later durable delivery

- Before the first Product create, update, delete, relation replacement, or
  restore proof, inventory the exact events emitted by the unchanged Product
  service behavior.
- [Record 28](./preflight/28-medusa-product-create-and-event-delivery.md) admits
  only a private local create/read proof with typed, transaction-buffered events.
  Acknowledged commit releases the buffer; uncertain settlement discards it even
  if database-result recovery succeeds. No business event is stored in outbox.
- Before event-bearing serving, decide the durable storage and dispatch owner,
  comparing shared outbox payloads with separate immutable intents. Complete
  atomic capture, provider handoff and crash recovery before that serving gate.
  A separate event table and an existing dispatcher are not assumed.

### Product service relationships

- [Record 29](./preflight/29-medusa-original-product-tests.md) proves three original
  cases using one installed fixture per driver. [Record 30](./preflight/30-medusa-product-related-create-and-reads.md)
  implements related creation and reads admitting eight more: tags, types,
  create-only collections, standalone images, associations and bounded relation
  predicates/population. [Record 31](./preflight/31-medusa-keyed-updates-and-remaining-product-tests.md)
  adds four tag/type update/upsert cases. Other updates, replacement, category
  mutations and scale remain unadmitted. [Record 32](./preflight/32-medusa-standalone-options-and-variants.md)
  groups related entities and Product graph updates into one 35-case milestone;
  lifecycle and scale follow. Admission changes only after the original assertions pass.
- Consume the complete schema proved above. Record 28 owns the bounded
  multi-table create/read profile; later operations must expand the repository
  and transaction profile together with their required typed event contracts.
- Prove filtering, population, replacement, deletion and restore through the
  unchanged selected service behavior. Include complete relational facts for
  cascading changes; physical FK success does not prove publication coverage.
- Existing-row module-set upgrades retain their separate migration obligation.
- Keep Query and cross-module links outside this step.

### First Link endpoint candidate

- Select one real non-read-only Module Link and both exact endpoint modules from
  the pinned supported source set.
- Add, compile, install, and prove the second endpoint module with Product as one
  complete configured candidate before any Link mutation; before event-intent
  admission, its executable proof is limited to schema, startup, and read-only
  repository behavior.
- Inventory every domain event emitted by the unchanged endpoint services and
  Link behavior.

### Commerce-link commit admission

- The [focused Gate B preflight](./preflight/55-shared-installation-atomic-commerce.md)
  records completed shared-installation atomic admission, followed by native Link
  characterization and explicit key/publication contract approval. No stored
  Link capability is admitted by the shared-installation correction alone.
- [Native Link characterization](./preflight/56-native-link-storage-contract.md)
  establishes the bounded native storage outcomes and approved shared declared-key,
  lifecycle and storage-owned event evidence correction. Authoritative post-write
  timestamps deliberately replace ORM stale-response/precision artifacts.
- The accepted transaction-bound Link receipt representation is the existing
  authenticated `CommerceRowClosure` and full-key `RelationalRowFact`, consumed
  once by the common finalizer. No separate `commerceLink` feed family or receipt
  brand is required solely because the row is a Module Link.
- Before the first stored Module Link writes, admit its checked schema/key/profile
  and validate native event identity/lifecycle against the actual operation-local
  storage evidence, including unchanged restores and IDs replaced by later calls.
  Neutral core tests do not admit this native Link consumer.
- Admit the exact typed event-intent contracts emitted by both endpoint modules
  and the Link behavior before executing them.
- Preserve the existing commit order and common outbox authority.

### First Module Link

- Prove any required second-endpoint mutations only after its event-intent
  contracts are admitted.
- Compile one stored resolved link with real cardinality and lifecycle.
- Enforce uniqueness/cardinality atomically in storage.
- Prove attach, dismiss, soft delete, restore, `deleteCascade`, the pinned
  duplicate/retry outcomes, and concurrency.
- Add a derived adjacency projection only if measured query or sync needs
  justify it.

### Custom repositories and Query

- Admit repository-specific relational query capabilities one use case at a
  time.
- Keep custom-query capabilities read-only; add a dedicated receipt-producing
  operation for every admitted custom write.
- Translate Medusa query shapes in the adapter.
- Preserve module-service and Query semantics.
- Do not create a public universal query AST.

### Workflows and locks

- Prove transaction boundaries around workflow steps.
- Preserve checkpoint, retry, waiting, and compensation semantics. A supported
  service call joining one transaction does not prove a whole workflow can join
  it; retain the original product-create compensation behavior as evidence.
- Do not hold database locks across workflow pauses or remote effects.
- Adapt lock and idempotency stores through their own bounded capabilities.
- Test crash, replay, duplicate delivery, timeout, and lost-response behavior.

## Migration Policy

Fresh installs compile a baseline from the admitted primary-fork snapshot and
the complete configured supported module/link set for the candidate. Later
upgrades combine structural artifact differences with explicit Medusa-owned
semantic transformations.

Historical MikroORM/Postgres migrations remain legacy-backend evidence. They
are translated only when a proven compatibility obligation requires a
particular behavior. Production startup verifies the active commerce digest
and never silently applies DDL.

## Exit Criteria For Private Integration

- The primary fork snapshot, official-upstream provenance baseline, source
  file set, modes, links, lockfile, patches, licenses, and notices reproduce
  exactly.
- The inert island remains outside the root workspace and every active runtime
  import graph.
- Every promoted package or connected capability has an accepted source map,
  bounded dependency closure, reuse classification, and retained test evidence.
- All admitted modules use module-scoped immutable preparation.
- Complete module/link compilation is deterministic.
- Runtime binds to exactly one active commerce digest.
- Unchanged claimed Medusa tests pass against the Flarex adapter.
- Real PostgreSQL proves transaction, constraint, lock, concurrency, and
  migration behavior.
- Commerce writes publish through one Flarex commit/feed/outbox authority.
- No public application API can access reserved commerce rows.
- Unsupported capabilities fail closed before startup.
- Hosted, operator, scale, observability, and production activation remain
  separate gates.
