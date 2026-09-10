# Reusable Workflow Host Composition

## Status And Scope

Status: implemented as a private, finite atomic workflow capability. Module-owned
registrations and one shared host now assemble commands, graph reads, events and
scoped resources. The Product-tag consumer uses this assembly; its displaced
manual wrappers and outer participant-list construction are removed.

Product and Currency remain the admitted consumers. The approved
[Product-tag update capability](./12-product-tag-updates.md) extends admission
to one through eight selected participants. Command limits, transaction ownership
and recovery contracts remain in force. This adds no Task, suspension, remote effect, lock, relational OCC,
schema, commerce module or public application API.

[Product-tag deletion](./13-product-tag-deletion.md) uses the same host with
Product soft deletion, graph and events selected. The native runner maps only a
top-level missing return value to null before strict capture/output validation.
Event validators can inspect captured native inputs and results of successful
calls through authentic selected method tokens; existing result-only projections
remain available from the same evidence.

[Variant-image workflows](./14-conditional-variant-image-workflow.md) select
association methods, a projected Variant list, its bounded thumbnail selector
update and graph reads. The shared binding exposes the native graph page ceiling
and rejects extra graph arguments through sticky refusal. An empty external
workflow-contract list coexists with its selected internal module event contract
and subscribers; this consumer emits only the actual Variant update.

The [native workflow composition preflight](./15-native-workflow-composition.md)
proposes child definitions borrowing the root selection and separately bound
hooks. Current preparation still refuses multiple internal module-event names
per participant; the proposed finite event policy needs an explicit core
participant-contract extension, not just removal of the adapter guard.

## Authority And Sources

The [accepted design](../../design-notes/flarex-db-accepted-design.md) and
[framework storage architecture](../../design-notes/flarexdb-framework-storage-architecture.md)
own transaction authority and execution profiles. Topics
[06](./06-local-graph-query.md), [07](./07-durable-workflow-events.md),
[09](./09-atomic-composition.md) and [10](./10-medusa-workflow-integration.md)
own graph, events, atomic execution and the selected Medusa workflow semantics.
This capability changes their assembly and adapter validation boundaries.

| Owner | Current responsibility |
| --- | --- |
| [Module definition](../../packages/medusa-adapter/src/module-definition.ts) | Repository/internal-service construction and fresh scoped services; independent of workflow orchestration. |
| [Product commands](../../packages/medusa-adapter/src/product-service.ts) and [Currency commands](../../packages/medusa-adapter/src/currency-service.ts) | Existing command tokens, service translation, graph metadata and module-owned workflow registration. |
| [Workflow module registration](../../packages/medusa-adapter/src/workflow/module.ts) | Authentic typed method adapters and captured module/graph metadata; no command execution or installation authority. |
| [Resource selections](../../packages/medusa-adapter/src/workflow/resources.ts) | Select methods/graph/events and infer the native callback view from that exact selection. |
| [Shared host](../../packages/medusa-adapter/src/workflow/host.ts) | Derive participants, allowlists, graph bindings, event contracts and replay policy; delegate preparation to the trusted atomic host factory. |
| [Shared binding](../../packages/medusa-adapter/src/workflow/binding.ts) | Create the native and Medusa compatibility views over the same scoped functions. |
| [Product-tag adapter](../../packages/medusa-adapter/src/product-tag-workflow.ts) | Business input, actual core-flow sequence, hook adaptation and event correlation. |
| [Native runner](../../packages/medusa-adapter/src/workflow-runtime.ts) | Foreign callbacks, borrowed runners, cancellation, pending-work detection and closure, including resource-construction failure. |
| [Atomic host](../../packages/persistence-postgres/src/atomicCommerce/host.ts) | Authentic command/installations/scope admission, root accounting, settlement and recovery. |

The Medusa reference remains the exact revision in
[SOURCE.json](../../third_party/medusa/SOURCE.json). The pinned step handler takes
an execution container; workflow-export can use cached modules and mutable
container state. Those fallback execution paths remain reference-only. The
selected SDK fork retains the business authoring surface while using explicit
Flarex execution resources.

## Module And Workflow Authoring

A module-owned registration references its existing checked command tokens.
Each selected method has a tuple argument decoder, command-input encoder and
result decoder. Graph registration reuses the existing read tokens and checked
metadata. Module event capture and fact validation stay module-owned.

Product exposes the selected array-only tag creation signature and its current
graph profile. Native tag results validate `id` and `value` and retain checked
JSON projection fields; they do not promise a full Medusa DTO. Currency's native
retrieve method reuses its existing value decoder and validates `code` and
`name`. The Product-tag workflow selects Currency graph reads only. A separate
connected test composition selects direct Currency retrieval and Product graph,
with no event resource.

[Product-tag updates](./12-product-tag-updates.md) add a separate selector-update
method and a checked projected-list method to the Product registration. Each
workflow selects its own methods and module event family; the update facade
selects Product alone. Creation and update reuse one Product-owned event-ID
correlator while retaining their distinct flow, hook and event names.

`prepareWorkflowResources` selects literal method tuples and graph flags.
Widened arrays, union-valued tuple members and union tuples cannot promise a
complete method set and are rejected by its type contract. A literal `true`
graph flag establishes the inferred query resource. Runtime preparation still
checks every selection and authentic registration.

Native step/hook callbacks use the selection's `callback` adapter and receive
inferred `resources`. The generic `hooks` adapter is available for hook contracts
whose input already agrees with the native boundary. Product's hook explicitly
decodes its native JSON view because Medusa DTO date fields differ. The existing
`container.resolve<T>` signature remains only a compatibility facade for promoted
steps. Both views invoke the same selected functions; `T` grants no authority.

A workflow definition carries an SDK-authenticated immutable prepared graph,
its resource selection, input/output Schemas and optional event contracts.
The SDK's preparation registry rejects structural copies before host preparation
can retain mutable nodes or callbacks. Callback code itself remains trusted;
registration capture is not a JavaScript sandbox.

Input uses the Schema's encoded representation at `run`, then decodes once
inside the atomic command. Output decodes before settlement; returned and
replayed values use the same Schema's decoded-type validator. Transformations
therefore do not run again against already normalized stored results.

## Trusted Host And Execution

`AtomicWorkflowExecution` contains captured identity/access policy and one
`prepare(composition)` factory. The trusted database composition closes over
its existing session, database, installation authority and host inputs, and
calls `makeAtomicCommerceHost`. The portable adapter receives only the prepared
composition interface; it does not import a database implementation at runtime.

For the Product-tag consumer:

```ts
const host = yield* prepareProductTagWorkflow({
  execution: trustedExecution,
  modules: { product: installedProduct, currency: installedCurrency },
  hooks,
  revision: reviewedBundleRevision,
  subscribers,
})

const tags = yield* host.run(requestKey, input)
```

Each installed binding pairs a module registration with its already prepared
profile/installation and optional module-event capture/validation. It neither
installs a schema nor authorizes itself. The shared host derives the exact
participant tokens, command allowlists, graph and event policy and delegates to
core. Ordinary callers no longer construct those lists or a resolver.

Prepared hosts support simultaneous module sets and revisions. Explicit instances
preserve this cardinality; no process-global Context tag or mutable container
selects request resources. Every invocation creates fresh scoped wrappers and
one existing Promise owner. Every module call constructs services through the
existing command path; live managers/services are never cached across requests.

## Capture, Failure And Replay

- Registration records and arrays use bounded descriptor inspection to avoid
  invoking getters and to preserve authentic capability identity. Graph data
  uses existing JSON capture and named structural Schemas before graph admission.
  Caller-owned configuration is copied rather than frozen in place.
- Method/module/resource tokens use private registries. Missing, ambiguous,
  forged and unsupported registrations fail before business execution. Core
  independently authenticates command tokens, installations and scope.
- New planner, argument, result and event validation failures latch root refusal
  before a callback can catch the rejection. Trusted decoder defects also poison
  pending work while retaining their defect channel. Existing participant calls
  bypass this adapter check and preserve their already-owned full Cause.
- Root call/byte/deadline limits, cancellation, draining/joining and escaped-method
  closure remain with the existing runtime. Finalization also covers resource
  construction. Resources cannot grant raw SQL, managers or delivery authority.
- Module fact validation and workflow event correlation remain separate. The
  Product-tag adapter correlates create/update IDs with successful command
  results and deletion IDs with captured inputs of successful calls. Shared
  event handling captures batches, checks names/group and
  dispatches admitted contracts, preserving event order and subscriber policy.
- Event-free hosts have no event bus, contracts or subscribers. The durable
  Product binding uses capture/validation directly, without a dummy local
  destination. The standalone local-event profile retains delivery for its
  supported callers.
- Trusted bundle revision covers workflow, hook, decoder and adapter code.
  Captured selections, graph metadata, each method/read-to-command name and mode,
  and event associations enter the existing identity/access-policy input. The
  private core facade projects command identity without exposing executable
  callbacks. No new hash store, identity authority or code-scanning mechanism is
  introduced.
- Exact replay and uncertain-commit recovery remain core-owned. Changed bundle,
  selected capabilities or dispatch associations conflict with an old request
  key. Persisted formats and database schemas do not change.

## Replacement And Compatibility Inventory

| Responsibility | Disposition |
| --- | --- |
| Existing module/service/repository and command execution | Retained; registrations reference exact command tokens. |
| Product-tag manual wrappers, graph/event resolver and outer participant lists | Replaced by shared assembly and deleted from the consumer. |
| Product-tag input/hook/event business semantics | Retained in its thin workflow facade. |
| Graph planner and service-owned query/population | Retained; newly originated decoder failures use the shared adapter refusal boundary. |
| Workflow Promise owner | Retained; no independent runner or cleanup owner. |
| Product module-event policy | Capture/validation shared between explicit local and durable host profiles. |
| Category/Currency atomic conformance command | Retained independently; it need not depend on the workflow SDK. |
| Core transaction, publication, recovery and durable event store/pump | Unchanged execution and storage ownership. |

## Validation Boundary And Remaining Decisions

[Registration tests](../../packages/medusa-adapter/test/workflow-host.test.ts)
pin inferred methods, invalid selections, authentic definitions, captured
metadata, shared native/compatibility resources and closure.
[Connected workflow scenarios](../../packages/medusa-adapter/test/product-tag-workflow.test.ts)
cover both event families, pending graph reads, one commit, rollback, swallowed
validation/decoder failures, cancellation, budgets, exact replay, revision and
association isolation, transforming schemas, uncertain settlement and durable
delivery. A different event-free composition proves reuse with both real modules.

PGlite and ordinary-role PostgreSQL cover the connected workflow/atomic/graph
lanes. Competing transactions and pending-write invisibility remain PostgreSQL
proofs. Original Product/Currency and selected composer assertions, affected
TypeScript, provenance, portable imports, lint and both reviewer scopes remain
required regression evidence. These checks do not establish whole-SDK parity,
Cloudflare deployment or production dispatcher readiness.

The [Product-tag update capability](./12-product-tag-updates.md) adds single-module
execution and authenticated selected-module admission, including the real selector
update step. The update host selects Product alone even when Currency is active;
the existing creation host retains its cross-module selection. Durable steps,
Task integration, waits/signals, external effects,
remote joins, Module Link, additional modules and public serving remain separate
decisions. Exceeding an atomic bound never silently switches execution mode.

The Convex reference's typed function references and runtime call context remain
useful distinctions, but this host does not adopt nested-mutation sub-transaction
rollback. Flarex commerce refusal stays sticky for the whole atomic root, with
no `ctx.db` exposure or Application OCC extension.
