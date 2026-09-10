# Reusable Workflow Host Composition

## Status And Scope

Status: researched implementation recommendation, awaiting capability approval.
The [Product-tag workflow](./10-medusa-workflow-integration.md) is implemented;
the reusable composition described here is not. This is one connected refactor,
including its consumers and removal of displaced wiring, not a new sequence of
prerequisite framework projects.

Recommended outcome: a module integration declares its checked workflow-facing
operations once. A shared private atomic workflow host assembles the selected
commands, graph, events and execution lifetime. Workflow authors keep the
business sequence, dependencies, hooks and event correlation. Trusted deployment
assembly supplies installations, scope authority, code revision and subscribers.

The first consumers remain Product and Currency. Preserve the current finite
atomic profile, including its minimum of two participants. This does not add
single-module execution, another commerce module, Tasks, suspension, remote
effects, locks, relational OCC, schema changes or a public application API.

## Current Sources Of Truth

The [accepted design](../../design-notes/flarex-db-accepted-design.md) and
[framework storage architecture](../../design-notes/flarexdb-framework-storage-architecture.md)
own transaction authority and execution profiles. Topics
[06](./06-local-graph-query.md), [07](./07-durable-workflow-events.md),
[09](./09-atomic-composition.md) and [10](./10-medusa-workflow-integration.md)
own the implemented graph, events, atomic root and selected workflow semantics.
This preflight changes assembly, not those owners.

| Current source | Finding that shapes the recommendation |
| --- | --- |
| [Module definition](../../packages/medusa-adapter/src/module-definition.ts) | Already prepares repository/internal-service construction and creates fresh scoped services. Its result exposes `description` and `use`; it is not yet a workflow operation catalog. |
| [Product commands](../../packages/medusa-adapter/src/product-service.ts), [Product module](../../packages/medusa-adapter/src/product-module.ts) and [Currency commands](../../packages/medusa-adapter/src/currency-service.ts) | Own service input translation, command tokens and checked graph descriptions. Commands depend on the module constructor; putting command creation inside that constructor would create a circular assembly dependency. |
| [Product-tag adapter](../../packages/medusa-adapter/src/product-tag-workflow.ts) | Manually creates participants, wraps `createProductTags`, builds graph/event resources, handles pre-call refusal and implements a string resolver. It also owns legitimate Product-tag event correlation. |
| [Connected workflow fixture](../../packages/medusa-adapter/test/product-tag-workflow.test.ts) | Repeats participant-to-installation, command-list, validator and event-contract wiring after preparing the workflow. A resolver-only extraction would leave this assembly burden behind. |
| [Workflow runtime](../../packages/medusa-adapter/src/workflow-runtime.ts) and [Promise owner](../../packages/medusa-adapter/src/commerce-promise-owner.ts) | Already own foreign callbacks, borrowed runners, cancellation, pending-work detection and escaped-service revocation. Extend this boundary rather than adding a runtime per resource. |
| [Graph preparation](../../packages/medusa-adapter/src/local-graph/query.ts) and [graph model](../../packages/medusa-adapter/src/local-graph/model.ts) | Already validate aliases and read definitions and bind to the current atomic context. Results are checked JSON projections; metadata does not establish a statically complete DTO. |
| [Atomic commands](../../packages/persistence-postgres/src/atomicCommerce/commands.ts), [participants](../../packages/persistence-postgres/src/atomicCommerce/participants.ts) and [host](../../packages/persistence-postgres/src/atomicCommerce/host.ts) | Commands are authentic opaque tokens with JSON input/output. Core independently admits commands, installations and scope. The host requires at least two participants and owns root accounting, settlement and recovery. |
| [Atomic events](../../packages/persistence-postgres/src/atomicCommerce/events.ts) and [Product event policy](../../packages/medusa-adapter/src/product-local-events.ts) | Module facts and workflow correlation are separate validation obligations. The current durable profile uses one pinned subscriber set; it is not a general subscription router. |

The Medusa reference remains the exact fork revision in
[SOURCE.json](../../third_party/medusa/SOURCE.json). Its
[step handler](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/helpers/create-step-handler.ts)
receives the execution container, while
[workflow-export](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/helper/workflow-export.ts)
can fall back to cached loaded modules and mutate the workflow's container.
[create-workflow](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/create-workflow.ts)
also resolves the workflow engine for nested async execution. Those execution
paths remain reference-only in the native atomic profile.

Current Medusa documentation explains the convenience of its
[automatically populated container](https://docs.medusajs.com/learn/fundamentals/medusa-container)
and uses [workflows across isolated modules](https://docs.medusajs.com/learn/fundamentals/modules/isolation).
Keep that authoring convenience while using Flarex's explicit execution-scoped
resources. Current documentation is context; the pinned source and selected
tests determine compatibility.

## Recommendation And Design Challenges

| Alternative | Decision and reason |
| --- | --- |
| Extract only `resolve(name)` | Reject. Command packing, validation, event routing, admission lists and lifetime wiring would still be repeated by each workflow. |
| Expose complete module service instances | Reject. Existing command wrappers deliberately select profiles, validate input and construct scoped services. A complete service type would also promise unsupported methods and result shapes. |
| Derive every operation from DML/model names | Reject. Checked DML can describe storage and graph metadata; it cannot infer specialized service semantics, compensation policy or workflow dependencies. |
| Copy the full Medusa container and scheduler | Reject for this capability. Mutable fallback registration and additional execution owners are unnecessary for the admitted local atomic profile. |
| Put workflow commands into the low-level repository module constructor | Reject the dependency cycle. Add a module-owned integration description beside the existing command catalog, using its exact tokens and checked metadata. |
| Share complete assembly through explicit module descriptions | Recommend. It removes real caller work while preserving the existing authority and lifetime boundaries. |

The shared implementation must contain no Product/Currency name switch. However,
module-owned argument packing, result decoding and event semantics remain
explicit. A descriptor whose only useful member is an unrestricted `bind(ctx)`
callback would move the manual wrappers without simplifying them.

## Proposed Ownership And Authoring Contract

### Module Integration

Each module-owned command factory exposes one immutable integration description
alongside its existing supported command catalog. The description references
the existing module definition; it does not reconstruct repositories or create
new commands for identical operations. Keep the low-level `defineCommerceModule`
free of workflow orchestration dependencies.

The selected description contains:

- Workflow-facing method names, exact existing command tokens and the owning
  argument/result adapters. Supported signatures are explicit, including tuple
  arguments, optional fields and the selected array-only Product-tag input.
- Existing checked graph metadata and read tokens. Workflow selection refers to
  that metadata rather than repeating aliases and command lists.
- Module event capture/validation policy for the chosen profile, separate from
  workflow event contracts. Product's fact validator remains Product-owned.

Native resource types follow these registrations. A method returning only
validated `{ id, value }` must not be typed as a complete ProductTag DTO. Reuse
existing value/projection decoders where exact; add a narrow module-owned result
decoder when the exposed native shape is stronger than the current JSON token.
Currency's compatibility DTO assertion is not proof of a full native DTO.
Graph results retain their current checked projection type in this refactor.

The initial Product-tag descriptor exposes its current creation method and graph
profile. Currency remains graph-only for that workflow. Prove direct Currency
read registration using a second, test-only composition with the existing
retrieve command; do not broaden Product-tag's resource set to supply it.

### Workflow Definition

A workflow integration selects module operations, graph profiles and emitted
event contracts from those descriptions. Hook dependencies are explicit and
included in the prepared workflow's selected resource set. The current profile
uses one resource set for the workflow and its trusted hooks; per-step access
policies are not introduced here.

No source scanning or trial execution attempts to discover arbitrary
`container.resolve` calls. Preparation validates declared dependencies; an
undeclared dynamic lookup is still refused during execution.

Product-tag retains its input contract, actual core-flow business sequence,
optional `productTagsCreated` hook, `product-tag.created` schema and correlation
against the actual successful creation command observations. Shared event
handling may capture batches, enforce group identity and dispatch admitted
contracts; it must not infer Product event meaning or create correlation from
caller-supplied IDs alone.

Native callbacks receive resources inferred from the selected registration,
without `resolve<T>` supplied by the caller. Keep Medusa's existing
`container.resolve<T>(name)` only at the compatibility facade needed by promoted
steps. Both views dispatch to the same scoped methods. This requires neither a
second workflow DSL nor a rewrite of the preserved Product business composer.

### Trusted Host And Execution

One source-private adapter composition entry point prepares a workflow against
the trusted execution inputs and installed module bindings. It derives exact
participant tokens, command allowlists, graph bindings and event policy, then
delegates to the existing atomic host. Ordinary callers do not separately build
`productCommands`, `currencyCommands`, event-contract associations or a container.
The resulting facade accepts a request key and workflow input; installations and
revision policy are not request arguments.

Conceptual usage, with names illustrative rather than a shipped API:

```ts
const host = yield* prepareAtomicWorkflowHost({
  execution: trustedExecution,
  modules: { product: installedProduct, currency: installedCurrency },
  workflow: productTagWorkflow,
  hooks,
  revision: reviewedBundleRevision,
  subscribers,
})

const tags = yield* host.run(requestKey, input)
```

`installedProduct` pairs the module-owned description with the already prepared
profile/installation and its module event policy. It does not install a schema
or authorize itself. Preparation rejects missing dependencies, ambiguous names,
duplicate registrations and unsupported profiles before business execution;
core remains the authority for authentic commands, bindings and scope admission.

Prepared descriptions capture configuration and callbacks once and retain no
transaction manager, Promise runner or live module service. Every execution
creates its scoped wrappers and one workflow Promise owner. Each module call
continues to construct services through the existing command path; do not cache
live services across calls or requests to make DI appear cheaper.

Use Effect for preparation/execution and Result for pure recoverable descriptor
checks. These prepared hosts intentionally support multiple simultaneous module
sets and revisions; use explicit instances with scoped execution, not one global
Context service for all hosts. A future long-lived deployment service can own
instances through a Layer at its host boundary. Follow the current
[Effect lifetime guidance](../effect-native-guidance/14-domain-services-layers-and-composition.md).

## Invariants And Failure Boundaries

- Preserve the existing root call, byte and deadline limits. Wrappers must not
  obtain independent allowances or call standalone module hosts.
- Capture and validate before dispatch. New pre-call failures must refuse the
  root even if a callback catches the Promise rejection. Already-owned
  participant failures retain their complete Cause; do not rewrap them merely
  to invoke refusal again.
- Keep a finalizer around resource construction as well as execution. Preserve
  cancellation, overlapping-work refusal, draining/joining and rejection of
  services or native resources retained after closure.
- Missing compatibility resources and explicitly unsupported methods preserve
  refusal behavior. Neither the native view nor a caller type argument grants
  a manager, raw SQL, event delivery control or unregistered command.
- Copy registration records without invoking accessors. Preserve authentic
  token identity; do not serialize/reconstruct command tokens or freeze
  caller-owned objects in place. Reject ambiguous resource/alias registrations.
- Preserve the current Product-tag graph surface explicitly. Do not silently
  narrow existing hook graph access or grant all registered module methods.
- Keep module fact validation and workflow event correlation. Module and
  workflow messages retain their order, names, `internal` distinction, group,
  revisions and the current common subscriber set. Event-free compositions do
  not fabricate event contracts, subscribers or a dummy local delivery function.
- Trusted bundle revision covers workflow, hook and adapter code. Captured
  method/alias selections and other behavior-affecting configuration must enter
  the existing identity/access-policy input when not already represented by its
  canonical participant/event evidence. Use the existing hash/replay owner;
  introduce no second identity store or code-hashing mechanism.
- Preserve exact replay and uncertain-commit recovery. Changed capability or
  bundle identity must conflict with an old request key, rather than reuse its
  result under changed behavior. No persisted format or data migration is
  needed for this source-private host refactor.

The current two-participant minimum and atomic-versus-durable distinction are
intentional limits for this work. Generalizing either requires execution
evidence beyond an assembly refactor. The selected tests must not fake a second
participant merely to advertise single-module workflow support.

## Replacement And Compatibility Inventory

| Path or responsibility | Disposition and completion condition |
| --- | --- |
| Existing module/service/repository construction and command execution | **Keep.** Descriptions reuse exact commands; original Product/Currency behavior remains covered. |
| Product-tag manual resource factory and outer participant-list assembly | **Rewrite**, then **delete** displaced assembly once the shared host passes connected tests. Keep only workflow input/hook/event semantics and declarative selections. |
| Workflow runtime and Promise ownership | **Keep/extend** for shared binding and finalization. No independent runner, global container or second cleanup path. |
| Graph preparation and execution | **Keep.** Centralize its host assembly, not its planner, query contract or service-owned population. |
| Product module-event capture/validation | **Keep.** Share capture/validation with the durable composition without requiring a dummy local destination. Preserve the standalone local-event delivery profile and its supported callers. |
| Medusa `resolve<T>` ABI | **Keep** as the narrow facade used by promoted steps; native callbacks use inferred resources. No full Medusa container is admitted. |
| Category/Currency atomic conformance command | **Keep.** It proves lower-level composition independently and need not become a workflow or depend on the SDK. |
| Atomic host, publication, recovery and durable event store/pump | **Keep unchanged.** No schema, migration, lock, retention or settlement refactor. |

The Product-tag preparation function is source-private and currently consumed by
its connected test. It can become a thin workflow-specific definition/facade or
be replaced at that caller. Do not keep a second manual execution path merely
for source compatibility; no published production obligation is established.

## Next Correctness Gates

Implement the descriptions, shared preparation/runtime and Product-tag consumer
as one capability. Prove the following before removing displaced assembly:

1. Registration inference checks valid method arguments/results and rejects
   unavailable methods, wrong inputs and invented resources. Runtime tests also
   reject malformed, ambiguous or mutable registrations; types alone are not
   admission evidence.
2. Real Product-tag execution retains both event families, pending Product and
   Currency graph reads, optional hook behavior, one commit, replay and revision
   isolation. Preserve rollback, swallowed validation/refusal, cancellation,
   escaped-service, shared-budget and uncertain-commit assertions.
3. A second test-only workflow uses a different selected resource set: existing
   Currency retrieval and Product graph reads, with no event bus. Run it through
   the same host implementation with both actual modules; shared files acquire
   no business-name branches or per-workflow wrapper factories.
4. Two prepared hosts with different selections/hooks remain isolated, including
   interleaved executions and resources captured by a callback. Missing or
   refused resources cannot become accessible through the compatibility view.
5. Use PGlite plus ordinary-role PostgreSQL for the connected workflow/atomic/
   graph lanes. PostgreSQL retains pending-write invisibility and competing-run
   coverage; PGlite alone does not establish these properties. Preserve the
   affected original Product/Currency and composer regressions, event delivery
   tests and existing assertion/time limits.
6. Run affected TypeScript configurations, source/provenance guard tests,
   portable bundle checks, core/diff lint and both required reviewers. Refresh
   approved source hashes when necessary without relaxing preserved-source or
   original-test rules. No whole-workspace or Cloudflare parity claim follows.
7. Reconcile Topics 10/11 and their index, remove superseded manual bindings,
   verify that tests clean their owned database artifacts, and commit the
   complete capability.

## Convex Compatibility And Flarex Divergence

The checked-in Convex SDK's `npm-packages/convex/src/server/registration.ts` and
`server/impl/registration_impl.ts` use explicit function references and runtime
context for cross-function calls. Preserve the useful distinction between a
typed callable reference and runtime execution authority.

This host remains a trusted Medusa integration over the already approved atomic
commerce profile. It does not adopt Convex's nested-mutation sub-transaction
rollback semantics: Flarex's existing commerce refusal remains sticky for the
whole root. It does not expose `ctx.db`, extend Application OCC, or make durable
steps share one transaction. This is a deliberate framework execution profile,
not general Convex function registration.
