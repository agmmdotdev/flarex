# Native Price List Price removal preflight

## Status and source

Status: bounded private adapter implemented; hosted activation remains gated.
Product chunked file import and Product
export remain deferred; the Price List Price batch root is a separate slice.

Authority is the accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary),
[source promotion contract](./04-medusa-fork-source-island-and-package-convergence.md)
and Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded
in `third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream/packages/`:

- `core/core-flows/src/price-list/workflows/remove-price-list-prices.ts`
  invokes its single original step and returns its selected Price IDs.
- The adjacent `steps/remove-price-list-prices.ts` owns forward selection,
  soft deletion and retained restoration.
- `core/utils/src/modules-sdk/medusa-internal-service.ts`, the native generated
  service and MikroORM DAL own active filtering, default list ordering,
  lifecycle traversal, return maps, dirty detection and events.
- `modules/pricing/src/models/price.ts` declares the PriceRule cascade;
  `price-rule.ts` declares active Rule uniqueness.

The original callbacks execute with the approved 155 DAL and 156 Pricing
dependencies. Those dependencies do not introduce the 156 snapshot/replay
compensation into this workflow. Preserve original callbacks and comparison
evidence separately from any portable compatibility disposition.

## Executing contract

The native documentation calls the input PriceList IDs, but the executing
selector is **Price.id**. Do not expand Lists or add List-membership validation.
Base Prices and Prices from different Lists are valid matched rows. An active
Price under a historical List remains selectable in the native witness.

Empty `ids` returns `StepResponse([], [])` before resolving Pricing. Nonempty
input calls `listPrices({ id: ids }, { relations: ["price_list"] })`, maps the
actual returned rows to IDs, and calls `softDeletePrices(actualSelectedIds)`.
That call still occurs when the nonempty raw selector matches nothing. The
initial list selects active Prices in Price.id ASC order. Raw order and
duplicates do not become duplicate returned identities.

The native query also requires an active PriceSet. Its nullable PriceList join
can return null for a historical List without excluding the Price. In that
case the native DTO masks both `price_list` and `price_list_id` to null while
the stored foreign key remains intact. It returns an ID-only `price_set`
reference. Preserve these native read and presentation semantics independently
from the lifecycle ordering decision.

The root returns the actual selected `string[]`. The step retains those same
IDs; its nonempty output and compensation use the same native array. Public
lifecycle maps and internal tuples require their own complete boundary proofs
but do not replace the workflow result.

The retained inverse skips resolution for empty IDs; otherwise it invokes
`restorePrices(retainedIds)`. Pricing is the only commerce module; the existing
EventBus remains SDK infrastructure. Query, Link, Product, Region, File and
providers are absent, including the empty branch.
Stored Links are protected fixture data, not a root resource.

## History, compensation and events

Soft deletion traverses the selected active Prices and their complete current
PriceRules, including historical Rules. It preserves business fields and
creation stamps while advancing deletion/update stamps. Newly deleted rows emit
native deleted events; historical descendants that are restamped emit updated
events. No PriceList, PriceListRule, PriceSet, preference or Link lifecycle
transition belongs to this root. Unselected Price/Rule graphs remain protected.

Restoration reads retained roots with deleted history and restores their current
Rules. It can reactivate historical Rules and include Rules added after forward
execution. It preserves outside scalar edits and cannot recreate physically
deleted rows. It is a current-graph inverse, distinct from 156 recorded-preimage
replay. Already-active rows can occur in native result maps without a dirty
update or changed timestamps. Original restore registers no mutation subscriber
and emits no module events.

Historical/active Rule twins and later active-key collisions can reject native
restoration. Preserve that failure and the rolled-back native restore
transaction; do not remove conflicts, omit historical rows or invent a repair.
Promise fulfillment must remain distinct from the native SDK's failed state.
In the characterized successful cases, repeated native cancellation invokes no
new callbacks. The finite host's replay and whole-root rollback are separate
existing contracts, not
evidence of identical post-completion native scheduling.

The native fixture also establishes that `softDeletePriceRules` can select no
rows under an already-deleted parent: native active-parent joins filter the
Rule, even when creation of that Rule succeeded. A historical-late-Rule setup
must therefore restore the parent, create and soft-delete the Rule while the
parent is active, then redelete the parent before invoking the original inverse.
Preserve the original failed fixture and its missing outside-snapshot boundary,
the corrected genuine setup, and the separate observed filtered no-op in the
external `flarex-157-native-price-list-prices-removal-witness` packet. This is a
harness correction; no native business correction is selected.

The initial 156 adapter replacement required an active parent when writing a
Rule. Its genuine attempt to add a late active Rule beneath a deleted Price
refused and rolled back; that failed witness remains preserved. The scoped
[158 correction](./158-native-price-list-price-batch.md) admits existing
historical parents only for update Rule ownership, matching the native packet's
after-forward late-active branch. The retained removal inverse restores that
current graph while preserving already-active Rule clocks. Canonical mixed
history and the restore-parent/update/redelete sequence remain distinct cases.

## Approved portable ordering

Native lifecycle SQL does not prescribe a total order, and observed ORM flush
events interleave Price and PriceRule rows. The first list's explicit ID order
does not establish lifecycle mutation or event order.

The approved 157-only compatibility disposition reuses the existing lifecycle:

1. Read complete Price roots in Price.id ASC order.
2. Visit each parent's complete Rules in Rule.id ASC order, with parents visited
   in Price.id ASC order.
3. Apply and emit the complete Price group, then the complete Rule group in that
   parent/child traversal order. This is not global Rule.id sorting.
4. Correlate complete TABLE+ID preimages and returned identities before native
   event dispatch. Preserve event contents, membership, classification and
   zero-event restoration.

The user explicitly approved this order for 157. Ordering approvals for 154,
155 and 156 do not transfer. Shared lifecycle ordering remains unchanged.

## Private adapter contract and owners

1. Keep independently authenticated native evidence and meaningful negative
   controls separate from portable compatibility. Require exact source/dependency
   ownership, declared cases and fixture preconditions, complete selected/output/
   retained identities, actual lifecycle closure, protected rows, native SQL
   settlement, event membership and acquired-schema cleanup. Retain genuine
   failed outcomes and the separate harness refusal. Optional ORM accessors are
   not invoked; snapshots and reserved ID vectors carry mandatory proof. SQL
   supports sequential transaction correlation, not finer call attribution;
   external entry/manifest hashes do not attest every transitive package file.
2. The named Pricing removal admission uses the existing service and
   repository owners, checked DML scalar decoders, indexed reads and
   population for the exact native `listPrices` ABI, including `price_list`.
   Reuse `PriceListPriceRemovalIds` for raw selectors without inheriting 155
   physical-delete authority.
3. `medusaLifecycle` uses a Price/PriceRule catalog, complete preimages,
   native mutation dispatch and `correlateLifecycleGraphReceipt`. Keep existing
   active-restore no-op behavior; do not select `allowActiveRestoreUpdate`.
   No new core lifecycle correction is selected.
4. The original root/step runs through the existing prepared workflow host.
   It exposes exactly `listPrices`, `softDeletePrices` and `restorePrices`, with
   graph access disabled, trusted module identity, sticky refusal, one outer
   settlement owner and transaction-covered compensation metadata.
5. `{ ids: string[] }` admits zero to eight raw members of at most 256
   characters, preserving empty strings and duplicates. It keeps default 64 calls,
   64 events and all other limits. The ordinary maximum is eight Prices with
   sixteen Rules; current/historical descendants require complete bounded
   traversal or refusal. No 128-call allowance transfers from another profile.
6. The bounded profile covers complete forward/inverse capacity, history/restamping, active no-op,
   current and physically removed descendants, conflicts, empty/missing/base/
   cross-List selection, protected Links, repeated cancellation, late-parent
   composition and two committed cycles on PGlite and ordinary-role PostgreSQL.
   Finite atomic rollback remains distinct from independently committed native
   callbacks. The scoped 158 correction resolves the initial 156 late-active-Rule
   setup limitation above without changing removal's lifecycle authority.
   Hosted activation, external delivery, arbitrary inputs and scale remain gated.
