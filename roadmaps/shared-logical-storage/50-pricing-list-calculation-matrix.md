# Persisted Pricing list calculation matrix

Status: implemented through a finite atomic test workflow invoking the native Pricing service under the shared-storage completion goal. Native PriceList workflow, full Pricing service and query parity remain open.

## Connected outcome and owners

One atomic test workflow calls native Pricing services to create up to four PriceSets and four PriceLists in generic logical storage, then `PricingModuleService.calculatePrices` consumes their committed rows. The selected matrix covers a lower sale price, a higher override price, a rule-free list, a matching regional rule, draft and active status, and valid, future and expired windows. Medusa owns normalization, business events and the final sale/override choice. The shared graph writer, indexed reads, transaction time and settlement own storage, resource accounting, visibility, rollback and replay.

The checked-in Pricing service and repository show that calculation joins selected PriceSet prices to list status, validity interval and rule eligibility before choosing sale or override. The preceding [PriceList creation cutover](./49-native-price-list-create-cutover.md) admitted only one active regional override list. That boundary could not exercise the representative persisted query matrix in [query acceptance](./02-query-and-constraint-acceptance.md). Broadening the same native command and graph is the coherent next consumer step. A Medusa-specific physical table or adapter-owned second query is not needed.

## Contract change and limits

The private creation input now accepts one to four lists, each with at most two prices, active or draft status, sale or override type, optional string dates and an optional regional rule with at most two values. The native service remains the date validator and normalizer. The workflow result must contain the same finite count; the logical receipt checks that the input, returned list identities and inserted PriceList roots agree and authenticates every created row/event. This replaces the narrower private selected-input contract; no public Medusa method, logical source identity or named durable data is reset.

The connected proof uses one atomic PriceSet/PriceList workflow, replay, exact events, rollback on duplicate list or invalid date, matching and absent regional context, five persisted status/type/time outcomes, and rule-free context selection. Run it on PGlite and ordinary-role PostgreSQL with the source guard, affected typechecks, lint and both required read-only reviews. Keep the upstream no-context eligibility correction documented in the preceding cutover.

The former physical Pricing event policy had no caller after the logical fixture cutover and is removed with the returned runtime field. The logical receipt remains the only selected event/row correlation owner.

This is a representative finite matrix, not native PriceList workflow parity, arbitrary Pricing parity or a throughput claim. PriceList update/delete, arbitrary rule attributes, customer groups, PricePreference mutation, range PriceRules, pending calculation during a write, populated-source conversion and a same-time upstream result comparison remain separate acceptance work. Unsupported methods stay refused; there is no physical fallback.
