# Store Cart completion HTTP

## Status And Scope

Status: admitted private bounded System-provider checkout on PGlite,
ordinary-role Postgres and the actual Workerd application host.

This profile owns `POST /store/carts/:id/complete` on the private Store Effect
HTTP host. It selects the pinned Medusa route, middleware and Order response
configuration. Store Order list/detail routes, remote payment providers,
deployment activation and capacity acceptance remain separate gates.

## Current Sources Of Truth

The [accepted database design](../../../design-notes/flarex-db-accepted-design.md)
owns authority. Native commerce behavior belongs to
[complete-cart](../../../packages/medusa-core-flows/src/cart/workflows/complete-cart.ts),
Order, Inventory, Promotion, Payment and native Module Links. The
[checkout owner](./checkout-workflow.md) and
[native Query owner](../../workflow-foundations/06-local-graph-query.md)
govern execution and presentation. Decisive consumer witnesses are the
[HTTP tests](../../../packages/medusa-adapter/test/store-cart-completion-request.test.ts)
and [Workerd proof](../../../apps/executor/test/storeCartCompletionApplicationDO.postgres.test.ts).

## Current Architecture

The native handler calls `complete-cart` with `throwOnError: false`. Its selected
workflow has no suspension or remote provider: the trusted atomic owner drains
before exposing the native finished envelope. A single native Medusa refusal
with rollback markers can enter that envelope. Mixed Causes, defects,
interruption and uncertain settlement keep their complete failure channel.
Native payment-action errors refetch the Cart and return its action envelope;
other errors retain the pinned handler's refetch and error behavior. Success
refetches the Order through genuine native Query after settlement.

Both complete response projections are admitted before execution: the requested
Order and the native default Cart error refetch. Order reads retain native
`formatOrder`, totals, item/detail and shipping wrapper presentation, tax lines,
adjustments, credits, addresses, Variant/Product and PaymentCollection traversal.
These independent protected refetches do not become one transaction snapshot.

The serving catalog has twenty-five commerce sources. Completion selects exactly
twenty, including genuine Order–Cart, Order–PaymentCollection, Order–Promotion and
Customer–AccountHolder sources. The Store profile reuses the existing
Cart–Promotion preimage source; older digital checkout profiles retain their
original source identity. A stored Promotion link is never replaced by a
synthetic result or omitted branch.

## Invariants And Trust Boundaries

Postgres alone commits Cart completion, Order families, Inventory reservations,
Promotion usage, Links, Payment authorization, events and the durable outcome.
The existing scope-exclusive queued root owns settlement, sticky refusal,
rollback and replay. Native retained inverses remain executable. Repeated Cart
completion uses the native existing-Order branch; same-request replay uses the
outer owner's retained outcome without executing business callbacks again.

The explicit logical participant allowance is twenty. Default and physical
allowances remain eight. Completion retains its existing 512-call profile,
per-family four-row/cohort bounds and one shared runtime admitting 35 hosts with an
8 MiB prepared-byte budget. The bounded
[allowance divergence](../../../experiments/core/engine/divergences/bounded-logical-participant-allowance.md)
records the numeric profile; it introduces no Core transaction mechanism.

## Decisions And Rationale

Populated Order creation and deletion use existing checked CreationProfile
relationships and native service receipts. Tax/adjustment calculated DTO fields
stay presentation values. Promotion usage and reversal execute the real native
methods, including spend, usage and attribute budgets. Receipt reconstruction
executes those same native methods over authenticated observations and preimages.
The Promotion scalar boundary authenticates its checked nullable Campaign
relationship and omits only native `campaign: null` presentation when the owning
FK is also null. Scalar validation and receipt reconstruction remain strict;
non-null, contradictory or unknown relationship payloads refuse.

The full selected resource proof uses an explicit framed digest representation.
Every ordered participant/composed-resource frame is owned before hashing and
retains the 64 KiB limit, as does the final identity policy. Complete source,
method, dependency and graph identities remain bound. Existing raw and digest
encoding algorithms are unchanged; the digital eighteen/nineteen-source roots
explicitly select the resource digest representation. Resource framing grants
no persistence authority.

Fresh Store installation selects Order's existing native serial generation for
`display_id`. Native creation omits this managed field; the catalog must retain
its generator. No populated Order schema conversion is selected. Link metadata
comes from the native Payment service's joiner declaration, avoiding the unused
host provider loader in its static manifest.

## Convex Compatibility And Flarex Divergences

The trusted outer owner retains the same transaction across native calls, as
the pinned Convex mechanisms do across nested execution. The accepted
[native participation divergence](../../../experiments/core/engine/divergences/native-root-participation.md)
retains sticky native failure. No child transaction, retry store, provider
network effect or new settlement lifetime is introduced.

## Implemented Capabilities

Populated guest and verified-Customer Carts complete through the native handler
and return its full default Order projection. Shipping, Tax, Promotion usage,
Inventory reservations, Payment authorization, stored Links, events and the
durable outcome share one atomic publication. Provider refusal and genuine
late authorization failure preserve business rows, revisions, indexes and
pending events. Native repeated completion and cold recreation retain the
existing Order without duplicating business effects. The connected HTTP and
Workerd witnesses above own this bounded acceptance; focused owner witnesses
also cover native Order creation/deletion and Promotion usage/inverse.

## Known Gaps And Limitations

The local provider is `pp_system_default`; supported Shipping and Tax providers
retain their existing local profiles. General Order browsing, fulfillment,
transfers, remote gateways, arbitrary framework support and production activation
are outside this profile. Bounded runtime acceptance does not establish scale.

## Target Direction

Keep native Medusa business behavior behind the private Effect HTTP adapter and
the existing trusted Postgres settlement owner. Extend route families only when
their complete native dependency and runtime boundaries are proven.

## Next Correctness Gates

General Store Order browsing requires its own native route, query and access
contracts. Remote gateways require their complete provider and workflow
lifetimes. Production activation and measured capacity retain independent
acceptance gates; this profile does not establish them.
