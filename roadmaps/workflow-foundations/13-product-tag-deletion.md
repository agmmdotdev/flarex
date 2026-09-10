# Product-tag Deletion And Native Completion Results

## Status And Scope

Status: researched proposal awaiting capability approval. No implementation is
authorized by this note. Topics [10](./10-medusa-workflow-integration.md),
[11](./11-workflow-host-composition.md) and [12](./12-product-tag-updates.md)
remain the implemented private atomic baseline.

Recommended outcome: execute the pinned Product-tag deletion workflow through
the shared native host, with soft deletion, its checked hook, pending graph
visibility, both event families, a retained null result and existing recovery.
This completes the create/update/delete tag workflow lifecycle without adding
another commerce module. Two reusable capabilities earn their place through
this consumer: native completion without a return value, and authenticated
successful-command input evidence for workflow event validation.

This proposal deliberately includes changes to private atomic call observations,
the native result boundary, and Product's admitted lifecycle operations. These
are the material boundaries requiring approval. It does not add a transaction
owner, persisted format, migration, execution profile, Task continuation, lock
engine, remote join, Module Link, public API or deployment.

## Current Sources Of Truth

The [accepted design](../../design-notes/flarex-db-accepted-design.md),
[framework storage architecture](../../design-notes/flarexdb-framework-storage-architecture.md)
and [shared transaction core](../shared-transaction-core/README.md) retain
authority over storage and settlement. [Atomic composition](./09-atomic-composition.md)
owns selected participant admission. [Durable events](./07-durable-workflow-events.md)
owns committed intent and delivery; [Local Graph Query](./06-local-graph-query.md)
owns checked reads.

The [pinned source identity](../../third_party/medusa/SOURCE.json) selects the
reference fork. Inspect its executable bodies rather than inferring behavior
from the word "delete" or from current upstream documentation.

| Current source | Finding and implication |
| --- | --- |
| [Delete workflow](../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/delete-product-tags.ts) | Calls the delete step, invokes `productTagsDeleted` with requested IDs, emits one workflow message per requested ID, and returns the step result. |
| [Delete step](../../third_party/medusa/upstream/packages/core/core-flows/src/product/steps/delete-product-tags.ts) | Calls `softDeleteProductTags`, returns `StepResponse(void 0, ids)`, and retains a restore compensator. It performs no remote-link or parallel step. |
| [Generated Medusa service](../../packages/medusa-utils/src/modules-sdk/medusa-service.ts) | Soft-delete methods call the existing internal service/repository and return a linkable-key map or void. The workflow step deliberately discards that value. |
| [Pinned Drizzle repository](../../third_party/medusa/upstream/packages/database/drizzle/src/medusa.ts) | Soft deletion changes matching active rows, follows declared cascade metadata, and dispatches lifecycle events from actual changes. Missing and already-deleted rows produce no new row mutation. |
| [Product tag model](../../packages/medusa-product/src/models/product-tag.ts) | Tag values are unique among active rows. The inverse Product relation declares no soft-delete cascade. |
| [Product profile](../../packages/medusa-adapter/src/product-profile.ts), [repository](../../packages/medusa-adapter/src/product-repository.ts), [lifecycle planner](../../packages/medusa-adapter/src/product-lifecycle.ts) | Tag managed lifecycle is currently unadmitted at all three boundaries. Existing `deleteTags` is physical deletion and cannot substitute for this step. |
| [Product module events](../../packages/medusa-adapter/src/product-local-events.ts) | Managed lifecycle evidence is checked against admitted commands and tables; a tag soft-delete command needs an explicit association. |
| [Native runner](../../packages/medusa-adapter/src/workflow-runtime.ts) | Intermediate undefined values are supported, but the final strict JSON capture refuses a void workflow result. |
| [Atomic observations](../../packages/persistence-postgres/src/atomicCommerce/events.ts) and [producer](../../packages/persistence-postgres/src/atomicCommerce/host.ts) | Successful outer participant calls expose participant, command and result, but not captured input. Returned rows therefore cannot authenticate deletion events that intentionally name requested IDs. |
| [Shared host](../../packages/medusa-adapter/src/workflow/host.ts) | Projects results by authentic method token. Extend this projection with captured call inputs while retaining current result consumers. |

The original [Product-tag integration cases](../../third_party/medusa/upstream/packages/modules/product/integration-tests/__tests__/product-module-service/product-tags.spec.ts)
exercise physical deletion, not this soft-delete workflow. Keep those assertions
and add connected evidence for the new behavior; existing green tests do not
already prove it.

## Proposed Execution And Result Contract

Preserve the original workflow/step sequence. Port only the required source
closure, relocate imports, and declare the step's compensation
`transactionCovered`. Keep the original restore callback as reference behavior;
the atomic runner must never invoke it after rolling back pending work. Do not
grant a restore command just to satisfy an unused compensator.

Add a Product-owned `softDeleteTags` command that invokes the real
`softDeleteProductTags` method once through fresh scoped services. Retain its
actual service result at the command boundary, with existing JSON normalization
for a possible void result. Do not return requested IDs as though they were
changed rows. Register the exact one-argument workflow method and select only
that method, Product graph and checked events. Ordinary callers continue to use
the thin prepared facade with inferred resources.

Admit bounded, unique tag IDs through the existing lifecycle decoder. Accept
empty input; reject malformed IDs, duplicate IDs, extra fields and exceeded
limits before publication. The duplicate rejection retains the native lifecycle
profile's existing narrower contract; do not silently deduplicate or claim full
upstream input parity. Keep physical `deleteTags`, Product/Variant lifecycle
behavior and unsupported related-model operations distinct.

Extend only Tag soft-delete capability declarations and their connected
repository/planner/event validation. Reuse the metadata-driven traversal and
core managed timestamp/fact operations. Soft deletion must retain tag rows and
Product-tag pivots, leave Products active, hide deleted tags in ordinary root
and related graph reads, and free the active-value uniqueness slot. Do not turn
this into general restore support or universal model lifecycle admission.

At the native workflow's final result boundary, normalize only top-level
`undefined` to JSON `null` before the existing root capture and declared output
validation. The deletion facade declares a null output, so fresh execution and
replay both return null. Existing create/update output schemas must continue to
reject unexpected null. Nested undefined, sparse arrays, unsupported values,
getter avoidance, byte/call accounting, first refusal and owner closure retain
their existing contracts. No permissive catch, general result envelope or new
per-workflow mode switch is needed.

This follows the checked-in [Convex return boundary](../../../../npm-packages/convex/src/server/impl/registration_impl.ts),
which maps a missing top-level return value to null before transport encoding.
Medusa's step remains void in the SDK; Flarex's native result is JSON null.
Only that representation behavior is reused. Commerce keeps its bounded SQL
transaction, whole-root refusal and existing recovery rather than adopting
Application OCC or child rollback semantics.

## Successful Call Evidence And Event Meaning

Extend `AtomicCommerceCallObservation` with the native command input captured
by the existing authorized invocation boundary. Keep this generic to commands,
participants and JSON; it contains no Product or workflow event names.

- Retain the existing captured, recursively frozen input, not caller-owned
  arguments or a second snapshot taken after execution. The input's existing
  root budget charge remains authoritative; do not add an unbounded log or
  bypass capture accounting.
- Record evidence only after a successful outer `ctx.call`, including its
  existing row/lifecycle/event validation. Failed calls do not qualify. Keep
  the existing outer-call granularity and order; nested service invocations
  must not create duplicate workflow observations.
- Add a method-token-filtered call view to the shared host. Its input is the
  encoded native command input, not the foreign Medusa argument tuple. Keep
  current result access as a projection of the same observations. Foreign or
  unselected method tokens yield no evidence.
- Observations are request-local validation evidence. They are not persisted
  step history, a replay journal, subscriber payload or new commit format.
  Replay continues to consume retained results/events without running steps.

Deletion has two intentionally different event contracts:

| Event family | Evidence and meaning |
| --- | --- |
| Internal `product.product-tag.deleted` | Actual managed Tag transitions and complete relational facts through Product's existing module policy. Missing or already-deleted tags do not create invented module events. |
| Workflow `product-tag.deleted` | The ordered IDs submitted to successful admitted soft-delete calls, matching the pinned workflow's input-derived emission. These are not proof that each ID named an existing row. |

Use a Product-owned deletion event validator with exact name, group, multiplicity
and ordered-ID checks. Preserve create/update correlation with returned tag
rows. Share only exact envelope mechanics if warranted; do not overload the
existing returned-row helper with ambiguous flags or move business policy into
core. Hook calls to the selected soft-delete method are also accountable: a
successful additional call needs matching workflow events or the root refuses.

For a fresh request containing a missing or already-deleted ID, the workflow
still emits its requested-ID event after a successful no-op service call. An
exact request-key replay emits nothing again. Empty input emits neither tag
event family and retains the existing empty-command publication semantics.

## Alternatives And Replacement Inventory

Another create/update port mostly repeats the proven path. Full create-products
would cross Pricing, Inventory, Sales Channel, Fulfillment, links, nested flows
and parallel composition; those are outside the current Product/Currency scope.
Tag deletion offers a concrete next end-to-end proof within the existing module.

Physical deletion would alter storage and relation semantics. Deriving every
workflow event from changed rows would alter the pinned no-match behavior.
Echoing input IDs into a fabricated mutation result avoids the real evidence
gap. Capturing inputs in mutable adapter state duplicates the transaction's
authority. The proposed core observation extension supplies one reusable owner.

| Path | Disposition |
| --- | --- |
| Selected participant admission, lifetime, transaction, publisher, recovery, graph and event delivery | Keep existing owners and contracts. |
| Atomic successful-call observation | Extend with the already-captured native input; keep it ephemeral and authenticated. |
| Native final result capture | Rewrite the top-level void boundary to null normalization; retain strict JSON and output validation. |
| Product profile/repository/lifecycle/event policy | Extend only the admitted Tag soft-delete path; retain managed core writes and metadata-driven traversal. |
| Actual deletion workflow, step and event constant | Port the needed closure with narrow exports and explicit atomic compensation policy. |
| Shared method registration and host event view | Extend; reuse current scoped resource binding and result projections. |
| Original physical-delete and create/update consumers | Keep unchanged semantics and original assertions. |
| Source island and promotion/portable guards | Keep the immutable reference and strict policy; record exact new active source provenance. |

No deployed data, legacy engine or supported facade is displaced, and no
temporary bridge or database migration is proposed.

## Completion Gates

1. Keep the committed create/update/atomic baseline. Add focused proof for
   captured-input ownership, authentic token filtering, successful-call-only
   evidence, nested-call granularity and unchanged resource limits. Assert a
   non-Product consumer so the new evidence contract remains generic.
2. Prove top-level void becomes null on fresh execution and replay; retain
   strict nested-value handling, existing output-schema rejection, decoder
   defects, swallowed refusals, cancellation and escaped-resource closure.
3. Execute the actual promoted deletion workflow against real Product
   installation. Cover live/missing/already-deleted/empty IDs, duplicate refusal,
   service result shape, retained pivots and unaffected Products, root/related
   graph visibility, active-value reuse and exact two-family event behavior.
4. Verify hook failure and caught invalid method/graph/event operations roll
   back rows, result, events and wake together. Verify forged/missing/extra or
   wrong-group event IDs refuse. Keep restored-event access unavailable.
5. On ordinary-role PostgreSQL, prove another connection sees pre-commit rows
   while the hook sees pending deletion; prove duplicate requests, cancellation
   and uncertain commit acknowledgement settle through the existing owner
   without rerunning the workflow or compensator. Run the connected PGlite lane
   as well, including Product-only selection beside installed Currency.
6. Retain original Product/Currency and existing create/update/atomic tests,
   affected typechecks, promotion/source/portable guards, core/diff/staged lint
   and both standing reviews. Run database-heavy suites serially with persistent
   logs and bounded process control. Preserve existing timeouts and assertions;
   a passing rerun is not a root-cause finding.
7. Reconcile Topics 07, 09, 10, 11 and this note with implemented boundaries,
   remove displaced local checks only where replaced, stop owned test servers,
   clean owned workspace artifacts and create one coherent implementation commit.

Exit criterion: the real soft-delete workflow succeeds or rolls back as one
native atomic command, its null result and distinct event meanings survive
recovery, and existing consumers retain their proven behavior. Broader workflow
profiles and production activation remain separate decisions.
