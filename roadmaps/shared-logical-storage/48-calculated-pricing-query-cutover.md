# Calculated Pricing query cutover

Status: selected calculated-PriceSet path implemented under the standing
shared-storage completion goal. Selected native PriceList creation and active
override calculation are covered by [PriceList cutover](./49-native-price-list-create-cutover.md).
Full PriceList mutation and calculated-query parity retain the gates below.

## Outcome and owners

Run a representative native `PricingModuleService.calculatePrices` call against
the selected six-model logical Pricing source. Medusa owns context flattening,
currency/quantity and rule eligibility, active PriceList windows, preference and
tax behavior, and amount/specificity ordering. Flarex core owns scoped indexed
candidate reads, finite result/resource accounting, pending visibility,
readiness, settlement and recovery. The adapter translates the pinned service
and repository contracts; it must not issue raw SQL or own a second query or
transaction lifetime.

The immediate native service needs more than one repository method. Its
`calculatePrices` delegates to `PricingRepositoryService.calculatePrices`, then
calls `listPriceRules` and, for currency/region context, `listPricePreferences_`.
The candidate price query reads Price, PriceList, PriceRule and PriceListRule.
PriceListRule's JSON containment index and PriceList's active partial index are
now in the complete source; compiling them does not by itself grant their read
semantics. Product/Variant/Link does not own this calculation.

## Evidence and challenged design

The pinned repository in `third_party/medusa/upstream/packages/modules/pricing/
src/repositories/pricing.ts` filters by requested PriceSet IDs and currency,
uses nullable quantity limits, joins only active and currently valid lists,
compares matched rule counts, and orders by list presence, rule specificity and
ascending amount. The pinned service in `packages/medusa-pricing/src/services/
pricing-module.ts` then chooses override versus sale and computes tax flags.
Its attribute cache is mutable and is only an optimization for more than ten
context keys; it must not become shared cross-scope authority.

The shared `relationalQuery.ts` now offers complete bounded indexed selections,
text search, JSON containment and finite compound unique-key points. The latter
is necessary for exact PricePreference `(attribute, value)` reads: selecting
all rows by attribute would refuse a one-preference calculation in a shop with
many preferences. The shared logical working set supplies PostgreSQL's
transaction-start timestamp through the borrowed commerce context; process
wall-clock time would change active-list eligibility near a boundary.
Compound-point execution requires the same key and null membership as the
validated unique index, even when a broader competing index is listed first.
The pinned Price, PriceRule and PriceListRule models declare selective foreign-key
indexes; PriceList and PricePreference have bounded key/prefix access. Select
those complete finite candidate sets first, then apply Medusa-owned quantity,
time, rule and exact-amount semantics. This selected calculation uses the
PriceListRule list-ID index and evaluates JSON containment over that complete
bounded set; the declared JSON GIN path remains available for different access
patterns. If a
selected foreign-key set itself exceeds the request budget, refuse; a later
capacity improvement belongs in the shared query owner. The current
`pricing-service.ts` invokes the pinned native service over a Medusa-owned
finite-row selector. A Medusa-named core query or SQL compatibility layer over
generic rows would preserve the wrong ownership.

## Connected delivery

1. Identify the exact pinned input/result contract, trusted effective-time
   source, candidate indexes and per-stage row/byte bounds. Use core's
   complete indexed selections and JSON/scalar fallback, preserving pending
   writes, null semantics, exact decimals and deterministic failure. Correct
   the shared query owner only if a decisive witness proves this insufficient.
2. Bind the required native Pricing repository and PriceRule/PricePreference
   reads to the logical participant. Keep the native service's final
   override/sale and tax calculation. Supply a private read command that uses
   the same context and transaction authority as other Pricing calls. Unsupported
   combinations must fail closed, without an alternate physical path.
3. Prove the selected native Base Price and PriceRule path, exact amount and
   raw companion, preference/tax output, same-ID two-shop isolation, replay
   and complete-set overflow on PGlite and ordinary-role PostgreSQL. Use
   fixture-only logical preference rows to show exact compound selection
   remains within a budget smaller than the unrelated preference set. Pure
   Medusa selection tests cover nullable quantity, list windows, numeric and
   JSON rules without claiming full database/service parity. The connected
   logical adapter refuses non-equality PriceRules until PostgreSQL numeric-cast
   limits and persisted rule behavior have a separate dual-driver proof.
4. Remove the calculation refusal and any displaced test fixture/guard entries
   in the same coherent cutover. Run affected typechecks, source guards, lint,
   two database drivers and both read-only reviews; commit only with no known
   failing path. Keep unrelated Pricing CRUD and populated-source migration
   behind their existing gates.

The selected command removes the previous unsupported-calculation expectation.
The affected callers are private
development fixtures and the selected workflow boundary; no named durable data
or source identity is reset. Activation still refuses a populated former
four-table source until the separate structural conversion/reset decision.

## Remaining gates

Native PriceList updates/deletes, PricePreference update/upsert/delete, broader rule and
quantity combinations, and pending calculation during an admitted write still
need connected dual-driver proofs. The selected PriceList create path now proves
persisted active override, sale, draft, valid/future/expired windows, rule-free
  lists and one JSON region rule in the finite connected matrix.
Selected native PricePreference creation now feeds the calculated path through
the shared compound point; its event and replay proof is recorded in
[PricePreference creation](./57-native-price-preference-create-cutover.md).
Range PriceRules need PostgreSQL-compatible numeric-cast validation and a
connected rule mutation/read proof before admission.
The selected path refuses unsupported input shapes and complete-set overflow;
it does not prove arbitrary row counts or all Pricing service methods. No
physical module table or adapter-owned alternate query path is retained for
these gaps.
