# Native Workflow Composition

## Status And Scope

Status: preflight complete; the implementation below is proposed and awaits
approval. Current nested-workflow refusal remains in force. This is one coherent
capability covering SDK composition, its native host integration, and the
explicit participant-event admission extension described below.

The outcome is a parent workflow that reuses existing Product-tag workflows
under one native atomic root. Prove create followed by update, repeated calls
to the same child, conditional children, and parent failure after a successful
child. A separate create/delete case proves a void child result. These are
small private composition consumers of the actual promoted workflows; they are
not new upstream commerce workflows or full Product batch compatibility.

The SDK API is general. Product supplies the connected business proof; Currency
supplies a second-module graph read and coexistence evidence. Keep the existing
64-node definition ceiling and root call, byte, fact, event and time limits.
Do not add a commerce module, Task, suspension, external effect, parallel
execution, resource lock, savepoint, relational OCC, migration, child outcome
store or public serving API. Transaction settlement and durable delivery remain
with their existing owners.

## Current Sources Of Truth

The [accepted design](../../design-notes/flarex-db-accepted-design.md),
[execution-profile preflight](../flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md)
and [shared transaction core](../shared-transaction-core/README.md) retain
authority. Topics [07](./07-durable-workflow-events.md),
[09](./09-atomic-composition.md), [10](./10-medusa-workflow-integration.md),
[11](./11-workflow-host-composition.md) and
[14](./14-conditional-variant-image-workflow.md) own the existing capabilities.

The exact reference is fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline 2.13.4, selected by
[SOURCE.json](../../third_party/medusa/SOURCE.json). Current official
[nested-workflow documentation](https://docs.medusajs.com/learn/fundamentals/workflows/execute-another-workflow)
explains `runAsStep`, direct child outputs and conditional calls. Its compensation
and long-running behavior is not the proposed native atomic contract. The pinned
source governs executable comparison; this proposal upgrades no dependency.

| Source | Finding and implication |
| --- | --- |
| [Pinned createWorkflow](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/create-workflow.ts) | `runAsStep` constructs a wrapper step that invokes another workflow runtime, derives transaction context, suppresses early event release and later cancels the child during compensation. Reusing the spelling does not require importing that execution owner. |
| [Pinned composer tests](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/__tests__/index.spec.ts) | Cover returned child data, parent failure, true/false branches, compensation and context propagation. Preserve applicable assertions; classify distributed/async and compensation behavior as explicit native differences. |
| [Pinned batch variants](../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/batch-product-variants.ts) | Calls create/update/delete workflows through `runAsStep` and `parallelize`. This establishes a real composition need; its further module dependencies and parallel scheduling remain outside this capability. |
| [SDK definition](../../packages/medusa-workflows-sdk/src/definition.ts), [model](../../packages/medusa-workflows-sdk/src/model.ts) and [runtime](../../packages/medusa-workflows-sdk/src/runtime.ts) | Definitions and references are authenticated and captured. The runner already owns ordered steps, guards and invocation-local output/transform caches. There is no admitted child-call surface. |
| [Native runner](../../packages/medusa-adapter/src/workflow-runtime.ts) and [Promise owner](../../packages/medusa-adapter/src/commerce-promise-owner.ts) | One outer boundary owns callback cancellation, pending work, closure and root void-to-null completion. A child must borrow this boundary. |
| [Resource selections](../../packages/medusa-adapter/src/workflow/resources.ts) | Hook wrappers authenticate the exact prepared resource selection. A hook already bound to a separately prepared child host cannot silently borrow a different parent's selection. |
| [Workflow host](../../packages/medusa-adapter/src/workflow/host.ts) | Explicitly refuses more than one internal module-event name in a participant's selected methods. Root external event contracts are already plural. |
| [Atomic participants](../../packages/persistence-postgres/src/atomicCommerce/participants.ts) and [atomic host](../../packages/persistence-postgres/src/atomicCommerce/host.ts) | Each participant carries one `eventContract`; every module emission is captured under it. Duplicate installations are refused. The limitation cannot be removed only in the adapter or bypassed by representing Product as several participants. |
| [Atomic event capture](../../packages/persistence-postgres/src/atomicCommerce/events.ts) and [stored envelope](../../packages/persistence-postgres/src/commitEvents/model.ts) | Already support multiple authenticated event contracts in one root and retain each envelope's actual contract, revision, routing, group and order. Participant admission needs extension; event storage and settlement do not. |
| [Product event policy](../../packages/medusa-adapter/src/product-local-events.ts) and [tag correlation](../../packages/medusa-adapter/src/product-tag-workflow-events.ts) | Module messages correlate with actual per-command facts/lifecycle. Workflow messages correlate with ordered successful command results, or requested IDs for deletion. These are reusable, distinct policies. |

## Findings And Recommended Direction

### One Interpreter, Separate Child Frames

Add `runAsStep` to authentic workflow definitions. The normal authoring shape is:

```ts
// Proposed API; not available in the current implementation.
const created = createProductTagsWorkflow
  .runAsStep({ input: { product_tags: input.tags } })
  .config({ name: "create-tags" })
```

It returns a staged reference to the child's declared resolved output, with
the same name-only configuration as a step. It does not return an execution
handle or another `{ result }` wrapper. Preserve null, undefined, void and never
reference behavior and optional results under `when`. Native facade decoders
still establish native output shapes; inferred source DTO types confer no
runtime validation or capability authority.

Represent a child invocation explicitly in the existing prepared definition.
Use a fresh evaluation frame for each reached call, interpreted by the same
Effect runner with the same execution port. A frame owns only its input,
output/transform caches and hook bindings. It owns no transaction, Promise
owner, manager, resource selection, event group or commit decision.

This is simpler than copying and rewriting every child reference into the
parent's namespace. Keep the child's authentic reference owner, isolate caches
per call, and expose only its captured output through the parent's call node.
Names identify instances locally; opaque identity keeps references attached to
their original call after renaming. Diagnostics can retain a structured call
path without making concatenated names or random strings an authority.

Validate and freeze the complete reachable child tree before execution. Count
every invocation and its reachable nodes against the one existing definition
ceiling, including repeated uses of the same definition and skipped branches.
Stop traversal at the bound rather than constructing an unbounded expanded
tree. Reject cycles, forged definitions, foreign references, unfinished branches
and duplicate instance names in their owning frame. A child is defined once;
its builder does not rerun on each request or create dynamic runtime graphs.

The runner enters a child directly through Effect composition, not through a
foreign Promise callback that invokes `runNativeMedusaWorkflow` again. Capture
child input and output through the existing lifetime/value owner. Resolve a
child's returned transforms before continuing the parent even when the parent
does not use its result. Keep compensation data validation and accounting.

If an enclosing condition is false, skip the child's input resolution, hooks,
transforms, steps, predicates and result work. Each reached invocation has its
own condition decisions and caches. A child returning undefined remains an
intermediate absence; only the outer native completion converts a top-level
undefined result to null. An empty or entirely skipped root still passes the
existing root checkpoint, pending-work and final-output checks.

### Explicit Hook Binding And Root Resources

Keep root `prepare(hooks)` behavior. Add optional typed per-call hook bindings
at composition time, proposed as `child.runAsStep({ input, hooks })`. This is a
small native extension to the pinned input-only argument, with the same hook
names and handler types as the child's existing preparation contract. Missing
handlers remain no-ops. Capture own data properties and callback identities
without invoking registration getters; reject unknown/duplicate registrations.

Bind hooks to the call's opaque identity, so repeated calls can supply different
handlers and renaming cannot redirect a registration. Parent hook names do not
implicitly register child hooks. This avoids a mutable global hook registry or
a string-path configuration language. Hook code remains in the reviewed host
bundle, never in request JSON. Native callback wrappers must use the root's
authentic resource selection and existing domain hook decoders.

Compose raw workflow definitions, not already executable native host facades.
The root explicitly selects the complete finite method/graph/event set needed
by its children and hooks. Child definitions neither install a module nor grant
additional methods. Preserve runtime refusal for unselected capabilities and
for callbacks bound to another prepared selection. No callback-source scanning
or automatic DI/container fallback is introduced.

### Multiple Authorized Module Events

The diagnostic scenario is selecting Product's `createProductTags` and
`updateProductTags` methods together. Expected behavior for the proposed mixed
composition is two admitted internal event types with their actual names.
Current behavior is preparation-time `unsupportedProfile` at the host's
`moduleEventNames.size > 1` guard. Core participant capture independently has
only one token slot. This is a verified source limitation, not a failing
database simulation or an already approved core repair.

Recommend extending the private participant contract to one finite event
selection policy: an owned list of authentic contract tokens and an explicit
adapter-owned selector over captured message data. Core must independently
require that the selected token belongs to both that participant's set and the
root's admitted internal contracts. Missing, forged, foreign-participant,
external-only and unselected tokens must refuse the root. Keep the no-event
participant path and required local fact validator.

The Medusa adapter maps the checked message name directly to its prepared token.
Core does not interpret Product identities or Medusa payload fields. Do not try
decoders until one succeeds, suppress defects, or relabel created/updated/deleted
messages under a synthetic generic contract. Validate before retaining events;
preserve captured value ownership, first-failure behavior and existing accounting.

Replace the private singular slot and update all actual callers together. The
current runtime producer is the shared workflow host. No shipped external
contract or persistent format requires a singular/plural compatibility branch.
Keep actual module-event names and payloads, per-command fact/lifecycle
validation, envelope order and subscriber identities unchanged.

The adapter can derive the finite internal contract set from the already
selected method metadata. Compose the existing Product-owned workflow event
validators for the selected operations; do not copy their business correlation
into the parent fixture or persistence package. Repeated same-kind children
contribute ordered observations/messages to the existing method-based validator.
Skipped children contribute none. This requires no child execution IDs in
persisted events or command observations.

Core must bind the participant-to-contract association into the existing
identity/access-policy evidence, using authenticated participant and contract
identities. A global list of event contracts is insufficient: moving the same
token between participants must invalidate replay even if that global list is
unchanged. Preserve deterministic ordering and capture the association before
execution. This extends private admission evidence, not the persisted outcome
or event-envelope format.

### Failure, Replay And Authority

Parent and children share one authenticated root, one event group, one retained
outcome and one publication. A child failure, caught resource refusal, invalid
event, late parent failure or cancellation rolls back the whole root. Preserve
full Cause/defect information and existing sticky refusal. No child savepoint,
independent retry, inverse compensating commit or early event release is added.

Preserve the root's trusted code/hook revision contract. It must cover every
reachable child and bound callback. Include the captured composition arrangement
and instance/hook registration identities in the existing host identity policy;
core additionally binds participant/event associations as described above.
Behavior-changing captured configuration must be covered by that policy or
trusted revision. Names and
`Function.toString` alone are insufficient. Do not add a second hash service,
child request keys or another replay store. Changed child configuration must
not reuse an old successful root outcome as if it were the same operation.

Exact replay bypasses all parent/child callbacks. Uncertain acknowledgement uses
the existing root recovery path without repeating completed business work.
Exceeding a bound refuses; it never switches to Tasks or raises a ceiling.

## Alternatives And Replacement Inventory

Porting another image-association or simple CRUD wrapper is useful business
coverage but does not close workflow reuse. Pure builder helper functions are
still appropriate for ordinary shared construction; they do not preserve the
definition identity, hooks and output boundary of imported workflows.

Wrapping an independently executable child host would settle too early or add
another callback/resource owner. Copying the pinned nested engine brings its
transaction IDs, cancellation and durable runtime assumptions. Flattening and
remapping all authentic references is possible, but adds reference-rewriting
machinery that separate interpreter frames avoid.

A same-event-only proof would defer the known create/update admission gap.
Recommend resolving that small explicit participant boundary in this capability
so the first mixed-operation parent is useful. This is not authority to change
commit compilation, physical sessions, scope locks, journals or event storage.

| Owner/path | Disposition |
| --- | --- |
| SDK definition/model/runtime | Extend the one current implementation for authentic child call nodes, frames, typed outputs and per-call hooks. |
| SDK references and ordered builder | Keep existing authentication/order semantics; adapt only where child boundaries require it. |
| Pinned `runAsStep` wrapper runtime | Rewrite the supported authoring behavior; keep engine invocation/cancel/async paths reference-only. |
| Product tag core flows and inverse callbacks | Keep actual business sequences and transaction-covered declarations; no invented CRUD substitute. |
| Native host/resources and Product hook/event adapters | Extend preparation and reuse existing decoders/correlation; keep one root binding and Promise owner. |
| Core atomic participant event admission | Replace the private singular token slot with finite authenticated selection; update all consumers and remove the displaced slot. |
| Atomic event capture | Share the existing capture/validation mechanics for explicit selection; retain one buffer, closure and accounting owner. |
| Root outcome recovery, publication, event store/delivery, physical session and scope locking | Keep unchanged. |
| Original Product/Currency suites and source island | Keep unchanged; extend selected composer assertions and native-difference coverage with provenance. |

## Convex Compatibility And Flarex Divergences

The checked-in [Convex mutation context](../../../../npm-packages/convex/src/server/registration.ts)
uses typed function references and distinguishes calls within a mutation from
separate mutations launched by an action. It also documents child mutation
sub-transaction rollback and recommends ordinary helpers where appropriate.

Borrow its distinction between a reusable definition and the authority of an
execution context. The deliberate native commerce difference is whole-root
sticky failure with no child savepoint. No Application journal/OCC contract or
public `ctx.runMutation` implementation is changed. Medusa's compensating
workflow tree likewise remains distinct from this one-commit private profile.

## Next Correctness Gates

1. Before changing the shared participant owner, run the existing committed
   atomic/event baseline and retain its assertions. Implement SDK composition,
   hook binding and event admission as the one approved capability; ordinary
   fixes within that scope do not require another preflight.
2. Prove authentic child preparation, repeated/renamed calls, nested calls,
   shared references within one call, isolation across calls/requests, eager
   child completion even for unused results, true/false conditions and absent,
   void and never results. Add compile-time negative cases for wrong inputs,
   optional results and unsupported options. Preserve applicable pinned nested
   composer assertions; explicitly replace compensation expectations with native
   rollback evidence rather than silently weakening those assertions.
3. Prove typed child hooks, distinct repeated-call handlers, duplicate/unknown
   refusal, configuration capture, wrong-selection refusal, cancellation and
   parent/child namespace separation. Capture neither live services nor request
   state in reusable definitions.
4. Exercise core event admission directly: one/multiple/zero contracts, finite
   bounds, forged/unlisted/wrong-participant/external tokens, changed routing,
   mutable registration inputs, malformed data and selector failures/defects.
   A caught refusal remains fatal. Test metadata and real-fact correlation;
   do not trust an adapter-only happy path.
5. On PGlite and ordinary-role PostgreSQL, run a parent using the real create
   and update tag workflows with one tag, pending graph reads and both actual
   internal/workflow event families. Separately exercise repeated creation and
   create/delete with void child completion. Keep these bounded operation
   scenarios explicit instead of adding a general batch API. Demonstrate
   Currency graph reuse and coexistence without requiring another module.
6. Prove late child and parent failure, hook/event/output validation failure,
   cancellation and limit refusal leave no partial rows, facts, result, event
   intents, deliveries or wake. Prove one ordered complete successful
   publication and replay with no repeated callback. On PostgreSQL, also prove
   outside-connection invisibility, concurrent duplicate settlement, changed
   revision/registration conflicts and lost-acknowledgement recovery.
7. Run existing tag and variant-image workflow, atomic/graph/host/composer,
   original Product/Currency and affected core event regressions. Complete
   affected typechecks, source/promotion/portable guards and scoped lint gates.
   Both custom reviewers inspect the final code checkpoint. Keep DB runs
   serial with logs, stop owned servers, clean owned workspace DB artifacts,
   reconcile Topics 07/10/11 and this note, and commit the coherent result.

Exit criterion: imported workflows compose as reusable typed children under one
native root, including a mixed-operation Product parent with correctly admitted
events, without independent execution or settlement authority. Passing these
gates does not establish durable workflow, full batch-variants, additional-module,
Cloudflare deployment or public API compatibility.

## Approval Boundary

Approval of this proposed capability includes the named private participant-event
contract change and its core capture checks. It does not include unrelated core
corrections exposed by future system tests. Such findings retain the repository's
separate owner-diagnosis and approval rule. Until approval, this record changes
no runtime admission or implemented status.
