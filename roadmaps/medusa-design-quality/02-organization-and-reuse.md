# Medusa Adapter Organization And Reuse

## Status And Scope

Status: complete after the native Product creation workflow handoff. Cohesive
owners, shared adapter mechanics, caller migration and displaced-code removal
retain the existing native capability and outer transaction owner.

This plan owns a connected cleanup of the existing Medusa adapter: cohesive
source organization, simpler module construction, reusable repository and event
mechanics, readable workflow preparation, caller migration and removal of
displaced assembly. The completed [Q1/Q2/Q3 work](README.md) remains the baseline;
its authenticated construction and call-local receipts are not rebuilt.

The intended result is that another admitted module supplies native bindings,
checked metadata, supported operations and genuine extensions. Another admitted
workflow supplies native composition, selected resources, contracts, events and
limits. Neither reconstructs the existing persistence or execution machinery.

This work does not admit another module, expand the Product workflow contract,
resume performance tuning or shared-storage completion, change durable formats
or delete data. Public authoring, hosted activation, general schema evolution,
remote effects and durable workflow suspension retain their separate gates.

## Current Sources Of Truth

- [Accepted design](../../design-notes/flarex-db-accepted-design.md) owns authority,
  execution profiles, private replacement and durable-data obligations.
- [Package boundaries](../16-package-boundaries.md) owns dependency direction
  and utility placement; [execution architecture](../execution-architecture/README.md)
  owns the adjacent direct and composed operation boundaries.
- [Completed construction and semantic refactor](01-construction-semantics-and-queries.md)
  owns exact command authentication, native semantic ownership and the separate
  page, complete-selection and aggregate contracts.
- [Medusa adoption](../flarexdb-framework-integration/06-medusa-adoption.md),
  [Product root integration](../flarexdb-framework-integration/preflight/96-native-create-products-workflow.md)
  and [workflow foundations](../workflow-foundations/README.md) own admitted
  native capability and lifecycle scope. Their final integration status must be
  refreshed at handoff; working-tree code is not a completed baseline.
- [Shared adapter mechanics](../flarexdb-framework-integration/preflight/47-medusa-shared-persistence-adapter.md)
  provide extraction rationale. Current source and tests win over its historical
  physical-storage descriptions; [shared logical storage](../shared-logical-storage/README.md)
  owns the storage destination and separate retirement program.
- [Pinned source](../../third_party/medusa/SOURCE.json), executing promoted
  packages and their source/test guards establish native provenance. Inspect the
  executing package before deciding to extract or remove framework logic.
- The repo-local [Medusa skill](../../.agents/skills/medusa-flarex-integration/SKILL.md),
  [Effect patterns](../../.agents/skills/effect-ts-patterns/SKILL.md) and
  [Effect overlay](../../.codex/agents/effect-review-guide.md) govern implementation.
  Apply the [error-handling skill](../../.agents/skills/effect-ts-error-handling/SKILL.md)
  if classification, recovery or foreign-boundary behavior changes.

## Current Architecture And Concrete Opportunities

The completed Product creation workflow established the integration baseline.
The placement map below now points to the implementing owners.

## Implemented Ownership And Extension Cost

- Module construction and command lifetimes live in `module/`; scoped DAL
  mechanics live in `repository/`. Module-local contracts live in `modules/`,
  stored Link contracts in `links/`, named facades in `workflows/product/`, and
  cross-module schema construction in `composition/`. Medusa value capture and
  decoding remain in `value/`; existing query, write and host owners remain.
- Currency, Sales Channel, ShippingProfile, Inventory and Stock Location reuse
  one scalar graph definition with explicit aliases. Pricing and stored Links
  retain their distinct ordering and relationship contracts.
- Sales Channel, ShippingProfile, Inventory, Stock Location and Pricing supply
  their decoder to one ordered decode/copy/refusal preparer. Module event buses
  share envelope capture and sequential delivery; each module still supplies
  its grammar, capture policy and exact refusal context. Restricted repositories
  share explicit DAL denials while preserving their manager methods.
- Product receipts are separated into capture, result, membership, entity,
  Category, Collection, Product, Variant, lifecycle, Tag and call dispatch owners.
  One direct command-to-policy map replaces the overlapping dispatch chains.
  Native business semantics and call-local evidence rules retain their owners.
- Workflow facades reuse installed-binding capture in declared order. Their
  root contracts, selected resources, hooks, workload limits and native business
  composition remain explicit. Module-only creation, full native creation,
  launch of existing Products, relationships and standalone Variant workflows
  serve distinct contracts and remain separate entry points.
- Callers, private export targets, source guards and live source maps migrate
  directly. Root forwarding modules and the displaced receipt monolith are
  removed; preserved upstream tests and historical benchmark records keep their
  provenance.

An ordinary future module supplies checked models, native methods, its input and
event grammar, aliases and genuine repository extensions. It reuses the current
construction, command preparation, scalar DAL/graph and event envelope owners.
A future workflow supplies its native graph, installed bindings, selected methods
and finite contract to the existing host. Neither adds a universal CRUD engine,
registry, transaction layer or another workflow lifetime.

Validation exposed an existing Medusa DAL representation mismatch: native
Product image assembly and native scalar metadata updates mutate entity reads.
Repository reads now hand off detached mutable copies after full projection
validation. Core rows and call evidence stay immutable; serialization and the
outer service boundary still capture the final native result. No native business
algorithm or shared persistence contract changes.

Two rollback fixtures targeted obsolete publication choreography. Collection
replacement injects on the second fact page of its 131 facts, after the first
page and business materialization have staged. Type byte-overflow observes
earlier materialization pages before reference traversal refuses. Both retain
complete rollback checks, and Collection retains same-key retry and replay.
Currency's interruption proof observes the installed fact-page atom and requires
it to be reached before aborting. Its lost-COMMIT recovery proof uses a fresh key
rather than an earlier test's retained tombstone; drain, rollback, new-row, fact,
replay and recovery checks remain explicit.

| Current owner | Existing useful boundary | Proposed improvement |
| --- | --- | --- |
| [module-definition.ts](../../packages/medusa-adapter/src/module/definition.ts), [commerce-module.ts](../../packages/medusa-adapter/src/module/persistence.ts) | Checked model layout, generated internal services and named extensions; request-owned repositories and native module construction | Retain these owners and make their native binding flow easy to follow. Reduce repeated surrounding assembly without adding another module factory stack. |
| [service-commands.ts](../../packages/medusa-adapter/src/module/commands.ts) | Command preparation, invocation and result projection over one module-owned service lifetime | Centralize equivalent decode/copy/refusal preparation currently repeated in Sales Channel, ShippingProfile, Inventory and Stock Location. Preserve distinct profiles and evaluation order. |
| [scalar-repository.ts](../../packages/medusa-adapter/src/repository/scalar.ts), [sales-channel-repository.ts](../../packages/medusa-adapter/src/modules/sales-channel/repository.ts) | Shared scalar creation/reads with explicit module update/delete extensions | Reuse the existing base and keyed-write owners; remove duplicate mechanics only after matching their operation and event contracts. |
| [sales-channel-service.ts](../../packages/medusa-adapter/src/modules/sales-channel/service.ts), [shipping-profile-service.ts](../../packages/medusa-adapter/src/modules/fulfillment/shipping-profile-service.ts), [inventory-service.ts](../../packages/medusa-adapter/src/modules/inventory/service.ts) | Native services, scoped event capture and explicit supported methods | Share equivalent internal event-bus plumbing. Keep module capture/receipt policy and current nested context selection explicit. |
| [product-local-events.ts](../../packages/medusa-adapter/src/modules/product/events/call-receipts.ts) | Call-local Product footprint, result and event correlation | Separate common evidence traversal from Category, Collection, Product, Variant and related-entity policies. Remove duplicated business reconstruction only when the native owner and regression witness are identified. |
| [workflow/host.ts](../../packages/medusa-adapter/src/workflow/host.ts), [workflow/resources.ts](../../packages/medusa-adapter/src/workflow/resources.ts) | Authenticated method selections and installed sources; one existing outer execution owner | Simplify repeated preparation around these owners. Keep business composition and named workload limits with their workflow. |
| [product-service.ts](../../packages/medusa-adapter/src/modules/product/service.ts), [product-commands/services.ts](../../packages/medusa-adapter/src/modules/product/commands/services.ts) | One Product command entry point with distinct repository profiles and read/write/internal branches | Preserve the entry point while placing its implementation together and clarifying the exceptional profiles. Fewer files or imports alone is not acceptance. |

## Invariants And Trust Boundaries

1. Native services and workflows own normalization, defaults, business rules,
   Category trees, compensation, event meaning and framework errors. The adapter
   translates the admitted contract and checks call evidence. The shared core
   owns scoped storage, dependencies, constraints, settlement and publication.
2. One trusted outer owner settles each direct or composed attempt. Prepared
   definitions contain immutable configuration; managers, mutable native
   services, subscribers, Promise continuations and refusal state retain their
   existing request lifetimes. No global Layer or cache retains borrowed state.
3. Exact command tokens, authenticated module/resource identities and finite
   method selection remain authoritative. Missing, counterfeit or unselected
   resources refuse, including failures caught by native code or hooks.
4. Preserve receiver binding, scalar/array results, omitted/null/empty input,
   first-error order, full native-result validation before projection, copies,
   byte/row/call/event budgets and current nested context selection.
5. Preserve pending visibility, page versus complete-selection/count semantics,
   lifecycle timestamps, terminal replacement, event order, rollback-only state,
   cancellation/draining, replay and uncertain-outcome recovery.
6. Keep stored Module Links distinct from module-local pivots. A composed native
   Link resource routes to authentic source commands without merging source
   identities, granting cross-source raw contexts or creating another lifetime.
7. Private imports and types may change with complete caller migration. No schema,
   codec, source identity or populated-data reset is selected. If such a change
   proves necessary, stop that part and establish its actual obligation first.
8. A failing shared invariant is fixed at its real owner under AGENTS.md. This
   cleanup does not authorize adapter SQL, looser budgets, extra transactions,
   fallback engines or swallowed failures to get a passing rerun.

## Proposed Source Organization

Use folders inside the existing package. They describe actual responsibilities;
they do not create new runtime APIs or packages. The following is a placement
map, not a requirement to create every listed file for every module.

```text
packages/medusa-adapter/src/
  module/                  native module construction and call lifetime bridge
  repository/              common scoped DAL binding and scalar mechanics
  schema/                  existing checked metadata and lowering owners
  query/                   existing shared query planning and execution owners
  write/                   existing keyed and graph write owners
  local-graph/             existing native graph-query integration
  workflow/                existing host, binding and resource integration
  modules/
    currency/
    product/               commands, profiles, repositories, schema and events
    pricing/
    sales-channel/
    fulfillment/           admitted ShippingProfile capability
    inventory/
    stock-location/
  links/                   native Link mechanics and named source definitions
  workflows/               named Product and cross-module workflow facades
  composition/             trusted cross-module schema/resource construction
```

Placement decisions:

- Move module definition, native persistence construction, service bridge and
  Promise lifetime code into `module/`. Common repository context, scalar
  repository and mutation dispatch belong in `repository/`; their native module
  callers still borrow the same command owner.
- Retain `schema/`, `query/`, `write/`, `local-graph/` and `workflow/` as existing
  responsibility owners. Do not add a competing `shared/`, `utils/`, registry or
  ports package to hide their dependency relationships.
- Group module-local service, repository, input, schema, query/profile and event
  code under its module. Simple modules remain a few cohesive files. Product
  may retain `commands/` and an `events/` folder because those have real separate
  responsibilities; other modules do not inherit that layout mechanically.
- Keep named cross-module workflow facades together under `workflows/`. Separate
  native business composition, finite contract and trusted execution preparation
  only where each is substantial. A simple facade remains one readable file.
- Keep Link tuple/lifecycle mechanics and native router binding under `links/`.
  Named Product/Variant endpoint contracts remain explicit. The completed
  Product integration determines the final multi-source resource placement.
- Put schema composition and other real multi-module construction in
  `composition/`. Do not move transaction authority out of its existing core.
- Shared capture/decoder and exact-number helpers are placed only after tracing
  their consumers: Medusa contracts stay here, framework-neutral persistence
  contracts stay with core, and generic pure utilities stay in the dependency
  leaf. A repeated expression alone is not a new shared abstraction.
- Preserve current operation names unless a responsibility change requires a
  rename. Update imports and existing private package exports directly; do not
  leave root forwarding files or broad barrel exports as compatibility glue.

Tests should follow their actual owner where the current runner/source-port
contracts allow it. Keep promoted original assertions and provenance intact.
Update explicit registrations, configurations and support imports in the same
cutover; do not move promoted tests merely to make the tree symmetrical.

## Reusable Logic And Caller Burden

### Module And Command Preparation

Keep `defineCommerceModule` and `commerceServiceCommands` as the construction
owners. An ordinary module declares checked models/repositories, its native
constructor, direct supported-method bindings, graph selection and workflow
methods. It does not independently construct internal services, Promise runners
or transaction adapters.

For equivalent command preparation, share the ordered decode, detached copy and
sticky-refusal flow near the existing command owner. Keep the module's decoder,
error policy and operation name explicit. Product internal serialization,
Category projection and Collection membership profiles retain their named
behavior; do not force them through an ordinary scalar preparation contract.

### Repositories, Graphs And Events

Reuse checked catalogs, predicate/projection/read execution, scalar preparation,
keyed updates and graph writers. Module policy supplies admitted fields,
relations, numeric companions and capabilities. Category trees, Pricing exact
numbers, Inventory's admitted empty-level branch and Link tuples/lifecycles stay
named extensions; common mechanics must not broaden their supported operations.

Use the existing local-graph owners for repeated scalar graph binding, retaining
each module's filtered native joiner aliases, exact read command, table metadata
and ordering contract. Extract the repeated construction only if real scalar
consumers become simpler; do not infer admitted graph paths from every DML field.

Shared internal event-bus binding may own option/batch capture, scoped forwarding
and refusal of unsupported bus methods. Its caller supplies the actual capture
policy and current context accessor. Preserve timing and sticky refusal before
removing any existing emitter. It must not turn every module event into an
authorized publishable event.

Split Product receipts by evidence responsibility and entity policy. Share only
identical checks such as ordered activity, admitted tables, identities, result
projection and event/ID consumption when existing consumers demonstrate the same
contract. Keep required relationship/footprint rules explicit. Receipts do not
re-run a native workflow, calculate Category paths or reimplement price defaults.

### Workflow Preparation

Keep one reusable preparation path for an existing workflow when independently
settling and borrowed execution use the same business graph. The two execution
entry points retain their actual outer contracts. Workflow files select exact
methods and graph access from installed instances, then declare native prepared
workflow, input/output contracts, event policy and named resource bounds.

Derive participants and admissible commands through the current authenticated
module/resource owners. Do not make each facade duplicate that assembly or
introduce a second policy bag. Extract repeated event/result utilities only when
they preserve event ordering and call correlation across real workflow consumers.

Existing simple Product creation, native full creation, relationships and launch
facades are not duplicates just because their names overlap. Inventory their
direct, composed, benchmark and test consumers. Replace an equivalent milestone
only after migrating its consumers; retain a distinct behavior with a named
obligation and a removal/reassessment gate.

### Future Module And Workflow Recipe

1. Trace the requested native operation through its real services, repositories,
   models, links, empty branches and events. Select a finite supported contract.
2. Supply checked module metadata and admitted repository policy to the existing
   schema/query/write owners. Declare genuine custom repository/service behavior
   explicitly; correct native coupling at its fork seam before copying it.
3. Construct the native module through the existing definition owner, bind actual
   methods and register checked workflow methods/events at the module owner.
4. Install an instance through existing trusted construction. A workflow selects
   exact methods/resources and composes native steps under its named contract;
   it does not recreate DAL services, event adapters or transaction policy.
5. Prove the real native branch and relevant failure/authority cases. Shared
   mechanics have another consumer or neutral witness, and new support remains
   an explicit capability admission beyond this cleanup.

## Implementation Sequence And Cutover

The phases below are internal checkpoints of one connected cleanup outcome.
They are not independently completed deliveries based on helper tests or folder
moves. Complete migration, removal and verification before the scoped commit.

### Gate 0: Receive The Completed Product Workflow Baseline

- Wait for the integration session to finish its approved scope, validation,
  review, cleanup and commit. Read its final handoff and inspect current status.
  Do not use partially integrated working-tree files as the refactor baseline.
- Refresh the native execution trace, source identities, supported methods,
  composed Link resource, hooks/events, limits and known blockers from current
  code and owning roadmaps. Reconcile this plan with anything already simplified.
- Inventory callers across direct commands, native child/root workflows,
  Application participants, fixtures, exports, portability guards and benchmarks.
  Classify each selected owner as keep, move, split, share or retire, with its
  behavior and consumer obligation. Account for named physical consumers without
  starting the separate physical-storage retirement program.
- Capture before/after construction examples for an ordinary scalar module,
  Product's Category exception and a multi-module workflow. Keep exact baseline
  and validation evidence in the implementation handoff/Git, not this roadmap.

### Gate 1: Simplify Existing Shared Mechanics With Real Consumers

Consolidate equivalent input preparation and scoped event plumbing at existing
owners. Migrate Sales Channel and ShippingProfile together, then exercise the
Inventory and Stock Location branches where their contracts match. Preserve
their genuine exceptions instead of growing a universal scalar module factory.

Reuse existing repository/query/write mechanics; add a shared operation only
when at least two actual consumers demonstrate the same semantics. A neutral
metadata fixture may prove name/key independence but does not replace native
consumer validation or require another module integration.

Exit: repeated assembly is removed from migrated consumers; native bindings,
exceptional operations and input/error order remain explicit and tested.

### Gate 2: Organize Owners And Separate Product Evidence Policies

Apply the responsibility map to the selected connected source. Move callers,
private exports, tests/configurations, guards and documentation with their owners.
Separate Product event capture, result/evidence matching, receipt assembly and
entity-specific policies; share identical operations with existing scalar,
Pricing or Link consumers where their contracts actually match.

Exit: a reader can trace native service to repository to scoped core and follow a
receipt to its rule owner without unrelated module code. Old assembly, moved
paths and unused exports are gone; no circular imports or forwarding layer remain.

### Gate 3: Simplify Workflow Facades And Close The Whole Cutover

Use the completed native Product root, an existing Product relationship workflow
and a repeated/child workflow as real consumers of the preparation owner.
Consolidate repeated installed-resource/event assembly without relocating native
business composition into a generic dispatcher. Preserve distinct borrowed and
direct execution entry points and distinct named workload limits.

Finish the retained-consumer inventory, remove displaced facades/helpers only
when their behavior has migrated, and update the reading map and applicable
roadmap capability truth. Do not widen method support or adjust resource limits
as a side effect of reuse.

Exit: existing module and workflow callers use the final owners, construction
examples show less repeated machinery, exceptional behavior remains readable,
and all final validation/review gates below pass.

## Validation And Acceptance

| Claim | Required proof |
| --- | --- |
| Ordinary module reuse | Real Sales Channel and ShippingProfile native service behavior plus the affected Inventory/Stock Location branches; renamed metadata where shared code claims name independence. |
| Exceptional module behavior | Product/Category native tree and internal-service regressions, distinct Collection replacement, Pricing numeric contracts and Link tuple/lifecycle cases. |
| Safer, simpler command/event binding | Malformed inputs, omission/empty/scalar/array results, first-error order, receiver binding, full result validation, nested context selection and sticky refusal after caught failures. |
| Unchanged workflow composition | Completed native Product-root maximum/empty paths and hook/event behavior, pending graph/Link reads, repeated native calls and child frames; preserve the integration session's failure witnesses. |
| Same authority and lifetime | Same-name counterfeit token and unselected-method refusal, escaped bindings, multiple installed sources/shops, late failure, rollback, cancellation/draining, replay and uncertain settlement. |
| No accidental storage/query change | Affected PGlite and focused ordinary-role PostgreSQL owner and native consumer tests; maintain page/complete/count distinctions, exact budgets and one publication with correct facts/events. |
| Complete source cutover | Affected package typechecks/builds, source-promotion/test-port/portability and import guards, valid private exports/configurations, no displaced imports and no new package/owner cycles. |
| Future extension cost | Before/after examples for an ordinary module, an exceptional module and a composed workflow. Each remaining registration/policy has a named semantic or trust purpose. |

Prefer existing behavioral suites such as module/shared owner tests, logical
Product/service/lifecycle tests, logical Sales Channel/Pricing/Link tests and
workflow host/composition tests. The final Product workflow handoff supplies the
root-specific suites and configurations. Run focused low-parallelism checks;
workspace-wide validation requires a demonstrated cross-cutting need.

For material JS/TS changes run `pnpm lint:core` and `pnpm lint:diff` before review,
then `pnpm lint:diff -- --staged` on the exact owned index before committing.
Preserve source-provenance guards, original compatibility assertions and labeled
authored cases. No new tests are required merely to prove a file moved.

Before the implementation commit, both read-only project reviewers
(`typescript-diff-reviewer` and `code-quality-diff-reviewer`) use `gpt-6.1-sol`
with high reasoning under current AGENTS.md. Give them the exact checkpoint,
owned tracked/untracked scope, contract and validation evidence. Correct findings
and rerun affected checks and both reviews after substantive changes.

Completion requires one scoped imperative commit after the connected refactor,
consumer migration, cleanup and verification succeed. Report PGlite and real
PostgreSQL separately, along with any material compatibility limits. Stop owned
temporary runtimes/resources. No performance improvement or broader module
support follows merely from cleaner organization.

## Convex Compatibility And Remaining Decisions

This plan preserves the Application developer model and its distinct OCC path.
The selected change is internal Medusa organization; no new Convex API divergence
is proposed. Any discovered Application/shared-execution correction follows its
own current-source preflight and authorization boundary.

The completed Product integration supplied the move map and retained workflow
disposition recorded above. Successful reuse means smaller module-specific obligations
and clearer execution flow, not fewer source files, a common CRUD engine or a
claim that every future Medusa module is already supported.

Ordinary PostgreSQL validation remains bounded local evidence. Intermittent
one-second publication-statement timeouts remain unexplained; successful quiet
execution does not establish their cause or behavior under checkpoint pressure.
Runtime performance, scale and hosted activation retain their separate owners
and gates.
