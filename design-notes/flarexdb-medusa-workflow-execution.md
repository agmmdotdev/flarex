# Medusa Business Workflows On Flarex Execution

Date: 2026-09-08.

Status: proposed direction supported by a source-based preflight. The user
requested reuse of Medusa business logic with Flarex-owned transaction and Task
execution. This note records that design choice for subsequent roadmap work;
no workflow compatibility layer, provider or public API is admitted by it.

Read the [shared integration overview](./flarexdb-framework-integration-direction.md)
and [shared transaction and optional OCC preflight](./flarexdb-commerce-occ-migration-preflight.md)
alongside this note.

## Decision Being Proposed

Preserve Medusa's business definitions while adapting their execution to
Flarex. Reuse module services, step callbacks, transformations, dependency
ordering, result contracts and hooks where compatible. Flarex should own
admitted atomic database commands, durable runs, retries and recovery.

The shared destination is core-owned transaction settlement, commit publication
and recovery with native OCC and framework-compatible SQL execution profiles.
This proposed workflow adapter supplies a separate Medusa coordination boundary.
Its bounded database groups may use shared SQL settlement; neither workflow
source reuse nor named atomic composition requires general relational OCC.
Optional mixed sandbox OCC and Payload migration remain separate decisions.

This deliberately revisits the existing
[execution-profile decision](../roadmaps/flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md),
only for workflow runtime ownership: it currently retains Medusa workflow
execution. Its distinct database execution profiles remain the default.
The workflow-runtime replacement still needs a focused compatibility and owner
contract; it is not a prerequisite for core transaction consolidation or ordinary
module integration.

Modularity does not require remote storage or separate commits. Modules can
retain their domain interfaces while participating in one transaction when
scope, placement, authority and execution constraints permit it. Conversely,
not every workflow belongs in one transaction merely because its modules are
hosted together.

## Verified Source And Reuse Seams

The primary source is the pinned fork at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
[`third_party/medusa/SOURCE.json`](../third_party/medusa/SOURCE.json).
Promotion still requires the repository's source/provenance and capability gates.

| Source | Finding and consequence |
| --- | --- |
| [createProductsWorkflow](../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/create-products.ts) | Contains validation, product creation, sales-channel and shipping associations, nested variant work, response assembly, events and an extension hook. Preserve this business sequencing. |
| [createProductVariantsWorkflow](../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/create-product-variants.ts) | Coordinates Product, Inventory, Pricing and links. Full Product workflow support depends on these real capabilities; existing nested Product service tests do not prove them. |
| [createProductsStep](../third_party/medusa/upstream/packages/core/core-flows/src/product/steps/create-products.ts) | Resolves the module service and returns created IDs as compensation data. The callback can remain business-owned while service resolution supplies an admitted Flarex context. |
| [createWorkflow](../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/create-workflow.ts) and [workflow export](../third_party/medusa/upstream/packages/core/workflows-sdk/src/helper/workflow-export.ts) | Composition registers with WorkflowManager; execution constructs LocalWorkflow. An engine-service replacement alone is not sufficient evidence of Flarex-owned execution. |
| [createStepHandler](../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/helpers/create-step-handler.ts) | Builds context from Medusa transaction/step state and resolves step values. This is an explicit compatibility boundary, not a plain callback runner. |
| [createHook](../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/create-hook.ts) | Registers a replaceable step, exposes result handling and refuses multiple registrations. Preserve the admitted registration, input, result and ordering contract. |
| [createRemoteLinkStep](../third_party/medusa/upstream/packages/core/core-flows/src/common/steps/create-remote-links.ts) | Calls the Link capability. Its name alone does not establish a remote network effect; actual provider and storage semantics determine admission. |
| [emitEventStep](../third_party/medusa/upstream/packages/core/core-flows/src/common/steps/emit-event.ts) | Uses workflow event metadata, grouping and compensation cleanup. This differs from the current module-mutation message contract. |

Medusa workflows also provide recovery, extension and long-running semantics
when modules are local. See the official descriptions of
[compensation](https://docs.medusajs.com/learn/fundamentals/workflows/compensation-function),
[step retry](https://docs.medusajs.com/learn/fundamentals/workflows/retry-failed-steps)
and [long-running workflows](https://docs.medusajs.com/learn/fundamentals/workflows/long-running-workflow).
These explain responsibilities; the pinned fork remains compatibility authority.

## Proposed Architecture

```text
Pinned workflow definitions, business callbacks and hook contracts
                            |
Private Medusa workflow adapter: composition, values, admitted context
                            |
Explicit execution plan bound to definition, scope and capabilities
                   /                         \
       Atomic database group             Durable continuation
       Flarex command/commit             Existing Flarex Task owner
```

The adapter belongs with Medusa compatibility, not inside the generic task
lifecycle or SQL store. Extract/adapt definition and value-resolution machinery
where feasible; keep the workflow source unchanged where supported. Any source
adjustment must be small, attributable and checked against pinned behavior.

Do not maintain handwritten copies of every workflow, or retain Medusa's
scheduler underneath a Flarex task wrapper while claiming one execution owner.
Do not recreate leases, retry queues or cancellation state in the adapter.

## Step And Hook Admission

| Behavior | Proposed owner and boundary |
| --- | --- |
| Pure transformation/validation | Reused under a bound definition and an explicit replay contract |
| Module database operation | Domain capability inside an admitted atomic command |
| Database-only hook | Same command only with declared table/service capabilities and compatible retry behavior |
| External effect | Durable execution with stable identity and an explicit uncertainty policy |
| Waiting/suspension | Task-owned continuation after database settlement |
| Compensation | Recovery for previously committed work and external effects |

Classifications are trusted admission declarations verified by capability
boundaries; they cannot be inferred safely from an arbitrary JavaScript
callback. Unknown hooks/effects fail closed. Preserve observable hook order and
pending-read behavior; moving a pre-commit hook after commit is a semantic
change requiring an explicit contract.

One database group must remain bounded and use a single owning transaction.
Parallel graph branches do not authorize concurrent operations on an owner
that requires serialization. Remote calls, unbounded callbacks and waits may
not hold that transaction open.

## Failure, Replay And Compensation

A failed uncommitted atomic group rolls back. Its original compensating deletes
must not subsequently run against rows that never committed. Preserve
compensation callbacks and their inputs for work that did commit before a later
group or external effect failed. Compensation itself needs identity, retry,
failure and cancellation semantics.

Bind workflow definition and hook configuration to execution identity. Capture
the outputs and compensation data required to resume; correlate each resumed
step/group with its original inputs. Reconcile uncertain commits before
re-executing business work. No external provider is assumed exactly-once.

Workflow events and module mutation events need separate checked contracts and
an explicit cardinality/deduplication policy. Do not treat workflow-level
messages as forged duplicates merely because the underlying rows also produced
module events. Do not silently drop either event family to pass a test.

## Existing Task Foundation And Remaining Gaps

Flarex has private durable run/attempt, scheduling, provider, retry, cancellation
and recovery machinery. Its current API roadmap also includes private inspect,
result, await, cancellation and listing operations; these are stronger than
older notes describing all management APIs as future work. See
[the Task roadmap](../roadmaps/durable-task-engine/README.md) and
[the current API status](../roadmaps/durable-task-engine/07-observability-live-apis-and-ui.md).

The [task mutation authority](../packages/standard-application-invocation/src/ApplicationTaskMutationAuthority.ts)
already handles stable child-mutation identities and reconciliation. Assess it
before designing another replay ledger. It currently targets Application
mutation authority; a commerce workflow cannot assume automatic access.

Still unproved for this integration are graph-to-task mapping, durable step
outputs and compensation data, restart-compatible definition identity, hook
execution, suspension and event-group behavior. Scheduler/provider checkpoints
are not by themselves durable Medusa step checkpoints.

Database commit and continuation scheduling need a recoverable handoff. Neither
calling task creation before a commerce commit nor starting it only from a
volatile after-commit callback establishes atomicity. Preflight the existing
Task and publication owners' participation before choosing storage or APIs.

## First Workflow Compatibility Proof

The [atomic composition preflight](../roadmaps/workflow-foundations/09-atomic-composition.md)
now recommends a private multi-installation command and transactional-read
foundation before this original workflow proof. That foundation needs no Task
and is not itself a Medusa workflow. Grouped events remain a prerequisite for
the original workflow below; current local Product buffering does not supply
them. The SQL-versus-native-relational-OCC choice remains explicit.

Use the original
[createProductTagsWorkflow](../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/create-product-tags.ts).
It exercises a module step, StepResponse, transformation, hook, workflow event
and compensation metadata without first requiring Pricing, Inventory or links.

First prove the bounded definition/handler extraction and that execution does
not instantiate Medusa's runtime engine. Then run the actual tag service under
Flarex with one fixed, admitted database hook. Preserve original business
assertions and add hook arguments/order, single-commit success, pending reads,
late-hook rollback, no events on failure, replay and unsupported-effect refusal.
Use both PGlite and ordinary-role PostgreSQL for database guarantees.

This proof is not cross-module compatibility, full workflow support or OCC.
Follow it with a separately admitted two-module command, then durable
continuation/restart and conflict proofs. Full Product workflow admission waits
for actual Inventory, Pricing and Module Link capabilities and their assertions.
