# Native standalone Fulfillment cancellation preflight

Status: private standalone root implemented on PGlite and ordinary-role
PostgreSQL. All 30 unchanged-native cases reached their intended stored fixture
and actual standalone target. The selected root reuses the existing twelve-table
Fulfillment source and normal resource limits. Existing
[141](./141-native-fulfillment-creation.md) also admits cancellation as the
retained creation callback; the standalone root has its own strict selection.
Public/hosted activation and external providers remain separate.

## Native source and connected closure

Authority is Medusa 2.13.4, pinned revision
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` in
`third_party/medusa/SOURCE.json`. Paths in this paragraph are relative to
`third_party/medusa/upstream/`:

- `packages/core/core-flows/src/fulfillment/workflows/cancel-fulfillment.ts`
  declares input `{ id: string }`, workflow ID
  `cancel-fulfillment-workflow`, and invokes one
  `cancelFulfillmentStep(input.id)`. Its composer returns no WorkflowResponse.
- `packages/core/core-flows/src/fulfillment/steps/cancel-fulfillment.ts`
  declares step ID `cancel-fulfillment`, resolves only `Modules.FULFILLMENT`,
  awaits `service.cancelFulfillment(id)`, and returns
  `new StepResponse(void 0, id)`. It supplies **no compensation callback**.
  The retained ID is not an inverse and must not become an invented undo.
- `packages/modules/fulfillment/src/services/fulfillment-module-service.ts`
  owns `cancelFulfillment` and `canCancelFulfillmentOrThrow`.
- `packages/modules/fulfillment/src/services/fulfillment-provider.ts` owns
  registration lookup and delegates cancellation to the selected provider.
- `packages/modules/providers/fulfillment-manual/src/services/manual-fulfillment.ts`
  supplies genuine local cancellation returning `{}` without a remote effect.

The already executing module equivalents are under
`packages/medusa-fulfillment/` and `packages/medusa-fulfillment-manual/`.
The standalone step/workflow are promoted through the selected
`packages/medusa-core-flows` export. Their framework import edges select the
executing portable utils/private SDK and direct step import. The private SDK
requires a synchronous WorkflowResponse, so the root uses the existing
void-composer seam from 140:
`return new WorkflowResponse(void 0)` after the unchanged cancellation step.
This preserves native undefined output. No compensation annotation is added:
the selected SDK requires `transactionCovered` for an actual compensation
function, not an absent one. The exact source/provenance guard authenticates
this promotion and rejects changes to the genuine callback behavior.

No Query, Stock Location, Link, Pricing, Inventory, Reservation, Order, Cart,
hook, workflow emit-event step, or provider-pricing method is reached. The
Fulfillment module's ordinary relation visibility reads are a different owner
from workflow Query. The installed twelve-table native source is reused; no
schema, populated upgrade or physical-reference-detachment capability follows
from this workflow.

## Service ordering and effects to preserve

The executing module service at lines 1885–1925 performs this sequence:

1. Allocate `canceledAt = new Date()` and retrieve the active Fulfillment with
   empty config through its genuine internal service.
2. Call `canCancelFulfillmentOrThrow` before considering idempotence. The guard
   at lines 2077–2094 checks truthy `shipped_at` first, then truthy
   `delivered_at`, with distinct native INVALID_DATA messages.
3. Only when `canceled_at` is falsy, call the actual provider using the
   retrieved `provider_id` and `fulfillment.data ?? {}`. Its return value is
   ignored. A provider failure is rethrown before the date update.
4. Update only `{ id, canceled_at: canceledAt }` through the existing internal
   service, then serialize the current Fulfillment through the native base
   repository. Already-canceled eligible rows skip provider and update but are
   still retrieved and serialized.

The standalone witnesses establish that shipped wins over delivered when both
exist, and either guard wins over an already-canceled timestamp. The root
preserves native truthiness/date semantics without another business validator.

The internal service owns NOT_FOUND behavior and managed update tracking.
`@EmitEvents` owns the module aggregator. The upstream Fulfillment service
integration test `fulfillment.spec.ts` at lines 461–514 asserts successful
idempotent cancellation, a root `fulfillment.fulfillment.updated` message and
the individual shipped/delivered refusals. The existing adapter cancellation
receipt authenticates root-only date changes, exact reads and output, one
update event for a changed row, and no event for the no-op branch. Owned
Address/Items/Labels, JSON data, Option/Provider and unrelated graphs must stay
unchanged; the standalone workflow discards the service DTO.

Native owning relation kinds have distinct presentation. Historical Option
visibility masks its DTO relation/FK while preserving the stored FK. Native
`hasOneWithFK` initialization reconstitutes Provider and Address ID references
from their stored owning keys, including historical targets. A null Provider
key yields `provider: null` and an omitted DTO `provider_id`. Preserve these
actual native distinctions through checked relation population/serialization.
Registration absence remains distinct from historical Provider state,
especially because an already-canceled row bypasses provider invocation.

## Observed unchanged-native contract

The ordinary-role PostgreSQL packet is
`%TEMP%/flarex-143-native-fulfillment-cancellation-witness/unchanged-native-postgres-v2-runs/2026-10-19T05-14-51.011Z-9576/report.json`.
All 28 case artifacts match their recorded SHA256, all fixture preparations
succeeded, every target executed, and every owned schema was removed. The
executed runner SHA256 is
`1d9c3fd0f24684b66a3db55c314aa38bde4eeb922308bc115164212c90ed044e`.
This characterizes unchanged native MikroORM/PostgreSQL, not Drizzle parity or
portable support. No standalone Drizzle witness has been executed.

| Native branch | Observed result |
| --- | --- |
| Eligible active root, packed-only, four Items/four Labels and fractional quantity, or empty children | Genuine Manual receives stored data; one date update and one root event; standalone output is `undefined` |
| Stored null data | Manual receives `{}`; the stored data remains null |
| Already canceled, including null or unregistered Provider and historical Provider | Native no-op succeeds without provider invocation, update or new event |
| Shipped/delivered, including already canceled combinations | Guard refuses before provider/update; shipped wins when both dates exist |
| Missing or historical Fulfillment | Native NOT_FOUND without provider/update |
| Unregistered Provider, null Provider FK or physically removed Provider | Native registration error before update; null/removed endpoints resolve to the native undefined registration key |
| Historical or disabled registered Manual Provider | Cancellation succeeds; historical Provider ID reference and FK remain present in both cancellation and separate read DTOs |
| Historical Address | Cancellation succeeds; both DTOs retain its FK and ID-only reference, without populating its historical fields |
| Historical Option or physically detached Option | Cancellation succeeds; historical Option's DTO FK/relation are null while its stored FK remains; physically detached Option has a null stored FK |
| Omitted/null Option | Native presentation preserved |
| Diagnostic wrapper fails after genuine cancellation | Native scheduler reverses its step state; canceled data persists because the child business step has no inverse |

Successful standalone cases retain the actual
`StepResponse(undefined, fulfillmentId)`. The workflow discards the service DTO.
The native scheduler's cancellation of a successful root does not undo business
data. Private Flarex whole-root rollback on a later failure is a separate atomic
settlement obligation and must not be presented as a native compensation.

The historical Provider case exposed an adapter defect, reproduced by genuine
cancellation on PGlite and ordinary-role PostgreSQL. The PostgreSQL witness
first verified the stored Provider FK and historical target, then failed in the
native Provider service because the adapter had erased its lookup key. The
existing adapter applied one active-target mask to every relation, while native
`hasOneWithFK` and belongs-to relations differ. The correction stays in the
existing metadata-derived DAL/DTO and receipt owners; the failing witnesses are
preserved. Business ordering, reference reads and resource accounting remain
unchanged. No native business
correction or shared-core change follows from this adapter defect.
The native omitted scalar FK for a null has-one target needs an explicit
checked output translation, rather than accepting arbitrary incomplete rows.

Two additional unchanged-native no-op cohorts are retained in
`unchanged-native-postgres-v3-runs/2026-10-19T05-21-52.763Z-4960/report.json`
under the same packet. Both preparations and targets succeeded, both artifacts
match their hashes and both fixtures were cleaned. A previously canceled root
with no Address omits `delivery_address_id` in its cancellation and separate
read DTOs. With a null Provider it omits `provider_id` as well. In contrast,
the original changed minimum case returns `delivery_address_id: null` from
native update while a separate read omits that field. Preserve read-versus-
assignment presentation; a blanket nullable-FK omission is not native parity.

## Reusable adapter owners and smallest implementation

`src/` paths below are relative to `packages/medusa-adapter/`:

- `modules/fulfillment/fulfillment-create-service.ts` already owns authentic
  `fulfillmentCancelForWorkflow`, `workflow.methods.cancelFulfillment`, native
  constructor binding, local Manual installation and exact DTO output decoding.
- `modules/fulfillment/fulfillment-create-repository.ts` already owns scalar
  lookup, same-manager active reference visibility and checked cancellation
  update decoding; `fulfillment-create-input.ts` owns the bounded ID grammar
  and native business-date boundary.
- `modules/fulfillment/fulfillment-create-receipt.ts` already owns cancellation
  request/mutation/read/result/event correlation. Reuse it rather than adding
  a second cancellation algorithm or a void receipt that skips the service DTO.
- `workflow/resources.ts`, `workflow/host.ts` and
  `workflow/events.ts:internalModuleWorkflowEvents` already own authenticated
  finite selections, settlement and module-only events.
- `workflow/runtime.ts` already captures a native `undefined` result as JSON
  `null`. Verify the actual standalone result first; use that existing encoding
  with `Schema.Null`, without inventing a successful DTO return.

The standalone composition owner is
`src/workflows/fulfillment/cancel-fulfillment.ts`, with a strict `{ id }` public
input using the existing ID schema, one authentic installed Fulfillment
participant, only `cancelFulfillment` selected, graph access disabled and
internal module events. Reuse the genuine existing local factory; selecting a
single method does not require granting creation to this root, creating another
module source lineage or widening the fresh twelve-table profile. Extra/forged
modules and creation methods must remain unavailable. Existing eight-table
profiles are outside the selection.

One requested root is the admitted envelope. Cancellation does not populate the
owned Item/Label collections, so pre-existing children are protected state,
not an invented per-call four-child selection ceiling. Existing complete
reference reads and resource bounds remain authoritative. Start within normal
root resources. No named allowance, core change or native business correction
is needed.

## Native witness construction and acceptance gates

The executed external runner is:
`%TEMP%/flarex-143-native-fulfillment-cancellation-witness/run.postgres.v2.mjs`.
Its separate preparation index and README record the runner/donor hashes,
root commands, ordinary-role URL variable `FLAREX_NATIVE143_POSTGRES_URL`,
28 named cases and fixture cleanup. It reuses the actual141 native PostgreSQL
fixture/loader; original141/142 packets are unchanged. Actual outcomes are
recorded above; preparation alone is not their evidence. A separate Drizzle
runner is not prepared.
The first143 runner remains immutable. Its source audit found missing stored
cohort assertions, scalar Provider setup that did not establish the native
relation, ambiguous wrapper retained-context wording and cleanup evidence loss.
The separate v2 preparation corrects those harness owners. The initial concern
that Manual overwrites populated data/Labels was disproved by the existing141
raw PostgreSQL artifact; no native behavior correction follows from this audit.

Before invoking cancellation, the fixture must assert exact persisted JSON,
Item and Label IDs/counts/values, business guard dates, root history and the
selected reference state. Preserve the initial native create DTO and its raw
post-create state separately; use genuine native updates only where fixture
arrangement requires them. The native Provider `hasOne` FK is a non-persisted
formula/hook-owned field in MikroORM, and `UpdateFulfillmentDTO` does not expose
`provider_id`. Fixture-only Provider changes therefore use the real injected
internal service's `provider: { id }` or `provider: null` relation payload,
followed by raw FK and actual registration-absence assertions; scalar update
acceptance alone proves neither state. These arrangements do not extend the
adapter's public cancellation input or module methods.

Native `runAsStep` supplies a scheduler compensator that calls child scheduler
cancellation. Preserve that callback in the late diagnostic wrapper. The
cancellation **business step** still has no inverse. Parent wrapper context is
not the direct child's `invoke['cancel-fulfillment']`. On the native synchronous
path, read the actual child WorkflowResult retained as the parent StepResponse's
compensateInput, identity-check its native DistributedTransaction and observe
that real child context. Retain the parent context separately; do not rebuild
a child retained payload from the input. Direct standalone cases also establish
retained-ID/output evidence. Cleanup failures must retain completed target evidence and any
primary error independently while reporting a nonzero harness failure; they
must not relabel an executed target as unexecuted.

Prepare a separate immutable packet using the genuine SDK/composer, selected
pinned workflow/step, actual Fulfillment services and genuine local Manual.
Reuse the existing native MikroORM/PostgreSQL fixture mechanics and preserve
the original creation/Drizzle artifacts. Seed real persisted Fulfillments;
observe provider arguments, root/child rows, DTO, events and retained step
context without fabricated callbacks or result maps. Record these cases:

| Case | Required observation |
| --- | --- |
| Eligible active root, populated data and protected children | Actual provider data, date-only root change, service DTO, one root event, void workflow result |
| Null/omitted stored data | Actual provider receives native empty-object default; stored data is not replaced by provider return |
| Already canceled, including unregistered provider implementation | Provider/update invocation counts, unchanged date/stamp/events and successful serialized DTO if native permits |
| Shipped only; delivered only; both; each combined with canceled | Exact error precedence, zero provider calls and no mutations/events |
| Missing and soft-deleted Fulfillment | Exact native NOT_FOUND, no provider calls, no mutation |
| Missing/hidden Provider or genuine persisted unregistered implementation | Actual relation visibility and native registration failure before date update |
| Historical Option/Address and detached Option FK | Exact stored FK versus masked DTO visibility; children/history preserved |
| Maximum admitted DTO context and unrelated graph | No hidden traversal/writes and measured resources |
| Original step retained context | Actual `undefined` output plus retained ID; no compensation function |
| Repeated standalone execution | Native idempotence, output and event counts |
| Wrapper failure after the genuine step/root | Preserve native runAsStep scheduler cancellation; observe absence of a child business inverse separately from private outer atomic rollback |

Use observer-only provider instrumentation; genuine Manual remains the provider
implementation. Provider failure evidence can use a real persisted unregistered
provider, without claiming a fabricated provider as native behavior. A direct
Drizzle comparison may characterize cancellation separately if bootstrapped
through genuine module calls; the known creation Query failure is not evidence
that standalone cancellation fails.

After native characterization, promote the two files and prepare the narrow
root, then validate real standalone execution on PGlite and ordinary-role
PostgreSQL separately. Add strict public/resource capability negatives, exact
void-result/retained-ID proof, original guard/idempotence/provider cases,
scope/replay/lifetime and late outer failure rollback, unchanged child/history
graphs, and owning receipt forgery negatives. Preserve failing witnesses and
fix their actual owner before widening the claim. Run the owning creation,
retained-cancel and connected reference-detachment regressions, affected
typechecks/source guards/lint, both read-only reviews and a scoped commit.

## Implemented private boundary

The genuine standalone workflow executes on both PGlite and ordinary-role
PostgreSQL. The selected capability surface is frozen to cancellation alone;
creation, graph Query and unrelated modules are unavailable. Strict input,
result and receipt checks retain the full native service DTO before the void
workflow result is encoded as JSON null. Changed cancellation authenticates
the root-only date patch and one module update event; eligible repetition has
no mutation or event. Historical reference presentation and nullable owning
keys follow the unchanged-native cohorts above, including the difference
between retrieved and assigned rows.

The bounded coverage also exercises native guard ordering, missing/history
errors, provider registration state, protected children, retained step context,
scope/replay and borrowed-handle lifetime, and atomic late-failure/resource
refusal. Connected creation, retained cancellation and physical reference
detachment remain covered on both drivers. No arbitrary graph size, external
provider behavior, Drizzle cancellation parity, populated upgrade or production
activation follows from this private selection.
