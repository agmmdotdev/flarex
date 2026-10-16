# Native Sales Channel Deletion Workflow

## Status And Authority

Status: source preflight complete; implementation pending.
This follows selector updates. Chunked File import and Product export remain
deferred. Authority is the accepted Flarex design, package boundaries, Medusa
adoption roadmap and Medusa 2.13.4 pinned at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island remains read-only.

## Native Closure

The pinned deletion composer calls the Store default-channel guard, soft-deletes
Sales Channels, removes their remote Links and emits `sales-channel.deleted`
messages in requested-ID order. It returns native undefined; the finite fork
can follow its existing `WorkflowResponse(void 0)` convention and atomic public
null completion. Physical Sales Channel deletion is not a substitute.

The guard invokes genuine `Store.listStores` with
`{ default_sales_channel_id: ids }` and selects `default_sales_channel_id`.
Every matching Store contributes to the native refusal message. There is no
executing Store service/profile yet: a fabricated empty service or first-match
read would bypass the native guard.

The remote Link call is the grouped endpoint
`{ sales_channel: { sales_channel_id: ids } }`. Both supported families apply:
`product_sales_channel` and `sales_channel_stock_location`. Neither definition
sets `deleteCascade`. Soft-delete their pivots while preserving identities for
restoration; Products and Stock Locations remain unchanged.

## Proposed Admission And Owners

Admit zero to four requested Sales Channel IDs and a bounded closure of at most
eight affected pivots in each existing family. Keep existing call, byte, event,
catalog and identity limits pending connected maximum-graph validation. Refuse
closure overflow before settlement rather than truncate native behavior.

1. Promote the genuine Store service, `Store`, `StoreCurrency`, `StoreLocale`
   models and static manifest. Retain complete checked DML. Expose only the exact
   guard read with its default-channel filter/projection; deny unrelated writes
   and relation reads. Reuse the complete bounded query owner, with the existing
   256-row catalog ceiling. Seed positive guard fixtures through canonical
   initialization rather than inventing a Store CRUD prerequisite. Verify the
   admitted schema/query indexing and transitive model dependencies first.
   The native runtime closure is the three models and their barrel, the Store
   service and its barrel, module types and static manifest. Promote the six
   native Store type files and existing framework type exports, plus the native
   `getDuplicates` utility and its portable export. Explicit construction needs
   no module bootstrap entry. Store has no native initializer or runtime service
   dependency on Currency, Region, Sales Channel or Stock Location; the default
   IDs and currency/locale codes are plain text. Only StoreCurrency and
   StoreLocale reference Store. Add the missing adapter-owned text-equality
   index for `default_sales_channel_id`; native DML does not define it.
2. Add a named Sales Channel lifecycle profile using the existing lifecycle
   owner and genuine native `softDeleteSalesChannels` and `restoreSalesChannels`
   methods. Its receipt policy must authenticate lifecycle activity and distinct
   native deleted/restored module events. The ordinary scalar policy correctly
   refuses that unadmitted activity today.
3. Reuse ProductSalesChannel lifecycle support and add an authenticated lifecycle
   token to SalesChannelLocation. Compose a genuine native Link router containing
   exactly these two families, with queued participant scheduling. Reuse the
   cascade-result codec at its Link owner; avoid depending on the Product
   deletion resource and its unrelated Shipping, Inventory and Pricing modules.
   Prepare the two genuine families directly with a named Sales Channel deletion
   admission and `maximumLifecycleRows: 8`. The shared Link repository already
   owns bounded soft deletion and restoration. Expose authenticated restore
   tokens alongside deletion tokens for the retained native compensators, and
   move the existing cascade-result decoder unchanged from its Product-specific
   location while migrating consumers.
4. Promote the two native deletion steps and composer with narrow exports,
   portable imports and exact provenance. Bind Store, Sales Channel, both Link
   participants and EventBus to the existing atomic settlement owner.

## Empty Behavior And Compensation

Even `ids: []` resolves Store, Sales Channel, Link and EventBus. Store receives
the empty-array selector. Native Sales Channel soft deletion returns before DAL
work, but its service method is still invoked. The real Link router receives
the grouped empty endpoint and returns `[null, {}]` without family calls. No
workflow messages are emitted.

Retain the native compensation callbacks with transaction-covered metadata.
Nonempty Sales Channel compensation restores the requested IDs; empty IDs skip
it. Link compensation restores the original grouped endpoint, including its
empty-array form. The guard has no compensation. The existing atomic owner
settles failures; this does not admit independently durable compensation.

## Validation And Closure

Prove positive Store refusal before mutations and complete empty dependencies;
both pivot families and endpoint preservation; missing, repeated and already
deleted IDs; closure overflow rollback; requested-order workflow events and
distinct internal events; late failure, replay/conflicts and scope isolation.
Use pure witnesses for retained compensation and both PGlite and ordinary-role
PostgreSQL for connected lifecycle behavior. Run affected owner/consumer
regressions, types/builds, provenance, portability and lint; obtain both required
read-only reviews, clean owned resources and commit separately. Hosted activation
and arbitrary Link or Store capabilities remain outside this profile.
