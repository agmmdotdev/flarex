# Native PricePreference creation on logical Pricing storage

Status: selected native creation and calculated-price consumption implemented
under the shared-storage completion goal. Update, upsert and deletion remain
outside this admitted path.

## Preflight and ownership

The selected `PricingModuleService.calculatePrices` read already uses an indexed
logical `(attribute, value)` preference point, but its connected test inserted
PricePreference rows through a test-only direct table command. That bypassed the
native service default, module event and call receipt. The complete six-model
Pricing source and scoped unique claim already exist, so the next connected
step is to admit native `createPricePreferences` and feed its committed rows to
the same calculation.

Medusa owns the optional tax flag's `false` default and created event. Flarex
owns scope selection, the logical insert and unique claim, one transaction and
publication, replay and indexed reads. The Pricing adapter reuses the existing
scalar create repository with the Pricing request's event subscriber; it does
not create a separate event or transaction lifetime. The private command
accepts one to four explicit `(attribute, value)` pairs and optional tax flags.
It does not claim the full optional native DTO grammar.

The displaced fixture-only writer is removed. This breaks only private Pricing
command, workflow-method and test wiring; no named durable data is reset or
converted. No physical Pricing fallback is introduced. Extending the generic
scalar repository to use an already-owned event subscriber avoids duplicating
its insert and native event mechanics.

## Connected proof and remaining gates

The native service creates three preferences with explicit and default tax
flags, publishes their module events, and replays without more publication.
The same PriceSet calculation observes the selected USD preference through the
shared compound index. A second shop's colliding PriceSet and currency remains
tax-exclusive. The receipt matches each native result's ID and public fields
to the inserted logical row and selected input. PGlite and ordinary-role
PostgreSQL run the connected test, with affected typecheck, source guard, lint
and both read-only reviews before commit.

PricePreference update/upsert/delete, broader filter and nullable-value
semantics, pending calculation during a write, PriceList mutations and full
calculated-query parity remain in [calculated Pricing](./48-calculated-pricing-query-cutover.md).
Their eventual cutover must preserve native events and exact uniqueness and
must remove any displaced fixture or refusal in the same slice. This proof
does not establish arbitrary preference-set or hot-shop capacity.
