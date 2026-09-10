# Conditional Atomic Workflows And Variant Images

## Status And Scope

Status: implemented, validated and reviewed. This private capability uses the
existing SDK, core-flows and Medusa adapter packages. It extends no shared
database or transaction owner.

The accepted capability executes the pinned variant-image batch
workflow as an explicitly ordered, conditional native atomic workflow. Build
the reusable SDK and graph-step foundations first within that capability, then
prove them through the actual Product consumer before declaring it complete.

The native fork adds images, removes images, and conditionally clears
the variant thumbnail in one existing Flarex transaction. It rejects duplicate
IDs within either input list and IDs present in both lists. It preserves the
original requested-ID result and service-owned relational behavior. General
`parallelize` is deferred; the source workflow explicitly replaces that call
with ordered step construction rather than exposing a sequential implementation
under a parallel API name.

This stays within Product and the existing private atomic profile. It adds no
Task, durable step checkpoint, suspension, remote effect, resource-lock engine,
Application OCC, schema migration, new settlement owner or public serving path.
Existing Product/Currency and tag create/update/delete consumers remain valid.

## Authority And Current Evidence

The [accepted design](../../design-notes/flarex-db-accepted-design.md),
[framework storage architecture](../../design-notes/flarexdb-framework-storage-architecture.md)
and [shared transaction core](../shared-transaction-core/README.md) retain
authority. Topics [06](./06-local-graph-query.md),
[09](./09-atomic-composition.md), [10](./10-medusa-workflow-integration.md) and
[11](./11-workflow-host-composition.md) own current graph, execution and host
contracts. The [source identity](../../third_party/medusa/SOURCE.json) selects
fork commit `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline 2.13.4.

| Inspected source | Finding and implication |
| --- | --- |
| [Variant-image workflow](../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/batch-variant-images.ts) | Uses `parallelize`, two named `when` blocks, two renamed graph-step instances and a Variant selector update. No nested workflow, external effect, workflow hook or workflow-event emission is present. |
| [Add step](../../third_party/medusa/upstream/packages/core/core-flows/src/product/steps/add-images-to-variant.ts) and [remove step](../../third_party/medusa/upstream/packages/core/core-flows/src/product/steps/remove-images-from-variant.ts) | Return requested IDs; empty arrays bypass their service call. Original compensators perform inverse association calls. Native rollback must cover these steps without invoking compensating commits. |
| [Variant update step](../../third_party/medusa/upstream/packages/core/core-flows/src/product/steps/update-product-variants.ts) | The used branch lists previous values and calls `updateProductVariants(selector, update)`. The unused upsert branch and compensator do not justify granting upsert. |
| [Graph step](../../third_party/medusa/upstream/packages/core/core-flows/src/common/steps/use-query-graph.ts) | Separates `isList`, calls `query.graph(config, options)`, and projects the first result for a single read. It mutates its input options and returned envelope. A native adapter needs explicit bounds and option/result rules. |
| [Workflow value capture](../../packages/medusa-adapter/src/workflow-value.ts) | Step values are owned copies with accounted omissions. Input mutation is therefore not evidence of a frozen-input failure; preservation of caller values, result ownership and strict final JSON are the actual obligations. |
| [Pinned parallel composer](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/parallelize.ts) | Merges graph actions; it is not a result-array helper. A sequential replacement must be an explicit source-fork change. |
| [Pinned conditions](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/when.ts) and [step wrappers](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/create-step.ts) | Build branch contents during composition, attach execution predicates to steps, and synthesize a return step for transformed branch results. The wrapper can reevaluate a predicate for each enclosed step. |
| [Native definition](../../packages/medusa-workflows-sdk/src/definition.ts), [references](../../packages/medusa-workflows-sdk/src/references.ts), [runner](../../packages/medusa-workflows-sdk/src/runtime.ts) | One ordered runner supports named conditions and renamed instances. Opaque identity survives renaming; final preparation rejects collisions and authentic references to later nodes. |
| [Request lifetime](../../packages/persistence-postgres/src/boundedRequestLifetime.ts) | Rejects overlapping operations and sibling ownership misuse. Driver-level query queuing does not authorize concurrent callbacks or make multi-query service operations independent. |
| [Product commands](../../packages/medusa-adapter/src/product-service.ts) and [workflow registration](../../packages/medusa-adapter/src/product-workflow-module.ts) | Workflow methods reuse association commands and projected Variant reads. The bounded selector command calls the real selector overload for thumbnail updates; existing ID/data commands remain separate. |
| [Product graph registration](../../packages/medusa-adapter/src/product-graph-query.ts) and [read profiles](../../packages/medusa-adapter/src/product-read-profile.ts) | Image count reads use the generated service and existing Image profile alongside Variant and other admitted roots. |
| [Graph Query](../../packages/medusa-adapter/src/local-graph/query.ts) and [resource binding](../../packages/medusa-adapter/src/workflow/binding.ts) | Native Graph Query requires explicit pagination and returns arrays. Its resource wrapper takes one input; upstream second-argument options are not an admitted compatibility surface. |
| [Product service](../../packages/medusa-product/src/services/product-module-service.ts) and [Variant proofs](../../packages/medusa-adapter/test/support/product-variant-checks.ts) | Association removal preserves image rows. Variant image hydration also includes general product images; removing an assignment does not necessarily remove that image from a hydrated `variant.images` result. |

Current official documentation describes [parallel steps](https://docs.medusajs.com/learn/fundamentals/workflows/parallel-steps)
as concurrent work with a completion barrier and ordered result positions.
The [condition guide](https://docs.medusajs.com/learn/fundamentals/workflows/conditions)
and [constructor rule](https://docs.medusajs.com/resources/lint/rules/no-if-in-workflow-constructor)
distinguish definition-time construction from execution-time decisions. These
are explanatory references; the pinned executable source determines the fork
comparison. Do not interpret `.then` as constructing new steps at execution time.

## Recommended Contracts

### Conditional Composition And Step Identity

Extend the existing SDK, without a parallel graph runner or a second definition
registry. Admit explicitly named `when(name, input, predicate).then(build)` and
name-only `.config({ name })` for repeated instances of an existing step.

Branch construction is synchronous and runs during definition preparation.
Predicates are synchronous Boolean decisions over resolved, captured values;
evaluate each reached branch once per fresh invocation. This is an explicit
native contract, narrower than the pinned per-step condition wrapper. The
selected workflow's predicates are pure and give the same decision either way.
Do not claim arbitrary side-effecting or asynchronous predicate parity.

A false branch must not resolve its enclosed step inputs, execute its transforms,
invoke its steps or hooks, or produce events. Its result resolves to the existing
intermediate `undefined` representation. A branch returning a transform still
needs a guarded result boundary. Nested named branches retain parent guards;
downstream consumers see a skipped result only through the declared optional
type. Final JSON/output validation and void-to-null completion stay unchanged.
Configurable step references remain available for null, undefined, void and
never outputs. Optional branch results cannot satisfy required step inputs
without narrowing in a resolved callback. Builder types reject a possible
Promise result as well as an exclusively asynchronous result.

Names label authentic step instances; renaming must not redirect an existing
reference to another invocation. Check collisions, foreign references, unfinished
branches, unsupported configuration and invalid build results synchronously
before execution. Capture the final definition once, then keep it immutable.
Keep existing node/depth limits, including internal branch/result nodes, and
route predicates through the existing invocation/checkpoint/failure owner.
Do not introduce random branch names, process-global runtime state, retries,
loops, dynamic runtime graph construction or nested-workflow execution.

Pure property references select from already captured values without scheduling
a callback. Every real callback receives a lifetime-checked, charged, detached
input, preventing transforms from mutating cached predecessor outputs. Step
output and distinct compensation data are captured in one envelope; identical
values are captured once. Guarded result nodes only forward resolved values.
The final checkpoint and native output capture still run, including empty or
fully skipped workflows. The existing 64-call and byte ceilings are unchanged;
there is no independent workflow allowance or bypass of module operations.

### Checked Workflow Graph Step

Adapt the shared graph step once, beside the promoted common workflow steps.
Use the existing selected query resource; keep Local Graph Query's mandatory
pagination and array result contract intact.

The step accepts the existing native entity/field/filter/page subset plus a
checked `isList` choice. Other remote/index/context/cache options remain refused.
The bound query exposes native `maxPageSize` alongside `graph`; the common step
uses it for the default page, and core validates every requested page.
Explicit pages retain their existing semantics. For an omitted page, issue one
explicit bounded page using the admitted native ceiling and require a complete
result: refuse if the count exceeds that ceiling. Never silently truncate,
inherit module defaults or introduce a fetch-all loop.

For `isList: false`, require a complete zero-or-one match with no skipped rows;
reject ambiguous multi-record results instead of choosing an arbitrary first
row. Preserve an absent result as intermediate `undefined`; do not assert that
the row exists or is a complete DTO. The Product workflow must explicitly refuse
a missing variant when its removal branch needs the thumbnail. Keep that
business check out of the generic graph executor. List reads retain arrays.
Validate options before invoking the one-argument native graph resource, and
construct owned input/output envelopes instead of deleting or overwriting
properties supplied by another owner. Make that touched resource wrapper reject
extra arguments explicitly through the existing sticky-refusal boundary, so a
caller cannot silently discard an unsupported second options argument.

Add only the missing Image count/list command needed by the graph registry,
using the real generated Product service and existing Image read profile.
Reuse checked metadata, field projection, count/order validation, scope checks
and pending-write reads. Do not query physical tables from the workflow adapter
or introduce another relation loader. Dynamic projections remain checked partial
JSON; an unconstrained type argument cannot promise a full Medusa DTO.

### Product Variant-image Consumer

The private facade accepts `variant_id` and optional bounded `add`/`remove`
arrays. Validate IDs through the existing bounded identifier policy, reject
unknown fields, repeated IDs within a list, and overlap between lists. Normalize
omitted arrays to empty arrays once. Preserve an entirely empty request as the
original no-op sequence; it need not invent a Variant existence lookup.

Fork the original workflow's grouped call into explicit add-then-remove steps.
Keep its subsequent graph reads, conditional thumbnail update and ordered
`{ added, removed }` result. Those arrays describe requested IDs from successful
steps, not verified counts of newly changed associations. Preserve the admitted
service's behavior for already-associated or missing associations; do not quietly
turn creation into upsert or general removal into replacement-set semantics.

The thumbnail comparison uses URLs of existing images among the requested
removals, as the pinned source does. It is not derived solely from actual
association-deletion facts. Preserve image rows and unrelated variants/products,
and retain the Product service's general-image hydration behavior.

Register only the used add/remove association methods, projected Variant list,
and the selector-update form used to set a selected Variant's thumbnail to null.
Invoke the real service through fresh scoped commands. Add a bounded selector
command where the existing ID/data command cannot preserve the used signature;
do not manufacture a selector result from a different service overload. The
unused upsert branch and restore/inverse callbacks remain unadmitted.

Mark the promoted mutation steps `transactionCovered`; retain their reference
compensators without calling them on native rollback. Association changes keep
complete relational facts and the existing zero-module-event rule. A thumbnail
update retains its actual Product module event. This workflow has no additional
workflow event family; select only the existing internal Variant-update contract
and validate that no workflow messages were emitted. Reuse host support for an
empty workflow-contract list with the selected module contract and subscribers.
Do not emit invented image-association or batch-completed messages.

All calls use one authentic Product participant, including when Currency is also
installed. Failure, cancellation, limits, replay, uncertain acknowledgement and
publication remain with the current atomic host. A skipped branch creates no
independent outcome, and a failed child cannot be caught into a partial commit.

## Alternatives And Replacement Inventory

General parallel execution would change the request ownership model and require
a conflict policy for multi-query service operations. It supplies no necessary
correctness capability for this consumer. A hidden sequential `parallelize`
would misstate the authoring contract. Explicit ordered source composition with
disjoint input lists is the recommended fork difference; it makes failure and
publication order predictable without changing the shared lifetime.

Putting the whole workflow in a custom imperative step would be smaller code,
but would bypass the conditional composition and graph-step capability being
prepared for other workflows. Another scalar create/update workflow would mostly
repeat existing proof. Full product creation reaches other commerce modules.
These are alternatives, not additional planned implementation slices.

| Path | Disposition |
| --- | --- |
| SDK preparation, authentic references and ordered execution | Extend in place for named instances and conditional regions; keep one current implementation. |
| Pinned `when` ambient state/per-step wrappers | Rewrite behind the supported authoring surface; record the once-per-branch predicate contract. |
| General `parallelize` and orchestration scheduler | Keep reference-only and unadmitted. |
| Selected workflow's `parallelize` call | Replace explicitly with ordered construction; preserve remaining supported business sequence. |
| Common query step | Port and adapt once to checked native query semantics; remove unsupported imported option/type closure from its active fork. |
| Product reads, mutations and event policy | Reuse existing owners; extend only missing Image graph and used Variant workflow adapters. |
| Original steps and compensators | Port the necessary source closure; retain compensators as reference behavior and declare transaction-covered mutations. |
| Core lifetime, transaction, publication, recovery, database schema and Task engine | Keep unchanged. |
| Source island, current tag workflows and original Product/Currency tests | Keep unchanged; record active fork provenance and intentional differences. |

No deployed data or supported legacy engine is displaced. No compatibility
bridge, fallback runtime or duplicate persistence store is needed.

The checked-in [Convex mutation contract](../../../../npm-packages/convex/src/server/registration.ts)
offers a relevant comparison: called queries see the calling mutation's
transaction, but nested mutations have sub-transaction rollback semantics.
Flarex commerce continues to provide one bounded trusted root with sticky
failure. Conditional steps neither add Convex child rollback nor convert
commerce reads into Application OCC evidence. This is host-neutral private
work; deployed Cloudflare and public activation require their own proof.

## Verification Requirements

The capability is complete only with the following connected proof:

1. Extend SDK preparation, instance naming and guarded execution together.
   Prove true/false and nested guards, skipped transforms, guarded transform
   returns, predicate call count, authentic references after renaming, duplicate
   names, definition closure, concurrent runs with independent values, and
   cancellation/failure through the existing owner. Preserve applicable pinned
   composer assertions and add explicit native-difference cases.
2. Connect the shared graph step to native reads and add Image graph admission.
   Prove bounded unpaged completeness, explicit pages, unique single lookups,
   empty/missing results, unsupported options, input/result ownership and named
   repeated query instances. Prove reuse with a Currency query as well as Product;
   core and common graph-step code must not contain Product-specific identities.
3. Port the ordered conditional variant-image consumer and its narrow method
   registrations. Exercise add-only, remove-only, empty, mixed disjoint lists,
   duplicate/overlapping refusal, missing/foreign-scope IDs, already-associated
   and missing associations, matching/nonmatching/null thumbnails, retained image
   rows, actual assignment facts and correct module-event publication. Preserve
   general-image hydration rather than assuming assignment removal hides an image.
4. On PGlite and ordinary-role PostgreSQL, prove late failure and cancellation
   roll back association changes, thumbnail, result, events and wake together.
   On PostgreSQL, prove outside-connection invisibility, duplicate-request
   settlement and uncertain-commit recovery without rerunning steps or inverse
   compensators. Keep all established limits and closure assertions.
5. Run connected tag/atomic/graph/composer and original Product/Currency
   regressions, affected typechecks, source/promotion/portable guards and the
   required lint and reviewer gates. Use serial database runs with persistent
   logs and the dedicated PostgreSQL configuration; an environment variable
   alone does not override the default PGlite test config.
6. Reconcile this note and Topics 06, 10 and 11 with implemented behavior,
   remove displaced local mechanisms, stop owned test servers, clean owned
   workspace artifacts and commit the completed capability.

Exit criterion: the real variant-image operation executes as one bounded native
conditional workflow, preserves the explicitly selected Medusa semantics and
fork differences, and demonstrates reusable named steps and graph composition
without extending a shared database or transaction owner.
