# Product Variant Pricing: Admission Preflight

Status: proposed. The user approved this investigation, not the new schema,
population or Pricing capabilities below. Approval of this record would cover
the ordered foundation and connected slices, their regression fixes, reviews,
cleanup and scoped commits. Newly discovered authority, compatibility or
resource-contract changes retain their separate preflight gate.

## Outcome and sequence

Advance native Product creation with a connected priced-variant proof: for one
existing Product with valid options, create one to four variants, create their
PriceSets and base prices, associate the returned identities with the actual
native Variant–PriceSet Link step, read pending results and settle once. Existing
Product/options setup is outside this root; this is not full Product creation.

Product module options/variants, Sales Channel and ShippingProfile already have
their own completed private boundaries. The next dependency is Pricing, but
current schema and read owners cannot yet admit its native create path. Complete
the foundation slices first, then the connected Pricing slice. Inventory/Stock
Location and the full native Product composer follow later focused admission.

Authority remains as accepted in `design-notes/flarex-db-accepted-design.md` and
`roadmaps/16-package-boundaries.md`: Medusa owns business/lifecycle semantics;
the existing Postgres owner owns settlement, constraints, facts and publication.
No universal transaction API, production route or external provider is proposed.

## Source and executable boundary

The comparison source is fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, baseline
2.13.4, recorded in `third_party/medusa/SOURCE.json`. Pricing models, module and
steps remain comparison-only. Current Product commands, graph/read mechanics,
Link storage and workflow host are the reusable executable owners.

Native paths below are relative to `third_party/medusa/upstream/packages/`.

| Native owner | Consequence |
| --- | --- |
| `core/core-flows/src/product/workflows/create-product-variants.ts` | Creates variants, always invokes Inventory validation and its child workflow, creates Inventory links, creates PriceSets, associates variants with PriceSets, emits events and exposes a hook. Pricing-only composition is an explicit branch proof, not this complete workflow. |
| `core/core-flows/src/product/steps/create-product-variants.ts` | Calls the native Product service and retains generated IDs for nonempty deletion compensation. Reuse `product-commands/mutations.ts`'s existing `createVariants` command behind a module-owned workflow method. |
| `core/core-flows/src/pricing/steps/create-price-sets.ts` | Resolves Pricing and calls `createPriceSets` even for an empty array; retains IDs; deletion compensation returns early only for absent/empty IDs. |
| `core/core-flows/src/product/steps/create-variant-pricing-link.ts` | Calls native Link create even for an empty array; returns `undefined` with original input as compensation data. Do not copy ShippingProfile's different step-output contract. |
| `modules/pricing/src/services/pricing-module.ts` | Native creation normalizes/deduplicates prices, creates a PriceSet graph, always rereads `prices` and `prices.price_rules`, restores input order and serializes. Its optional `clearAvailableAttributes` callback is not a requirement to invent a cache. |
| `modules/pricing/src/static-manifest.ts` | Six real model services and a custom `pricingRepository` dependency. The static placeholder throws if instantiated. Construction must explicitly supply the actual selected capability. |
| `modules/pricing/src/models/price.ts` | Numeric amount and optional quantity bounds have generated raw companions. Price has outgoing FKs to PriceSet and nullable PriceList, plus inverse PriceRule metadata. |
| `modules/pricing/src/models/price-list.ts` | Retaining Price's native FK requires a PriceList table. Its declared partial index is `deleted_at IS NULL AND status = 'active'`. |
| `modules/link-modules/src/definitions/product-variant-price-set.ts` | Both endpoint relationships are singular; preserve pair identity, uniqueness on each active endpoint, `pvps` IDs and cascade metadata. Link deletion/cross-module cascading are not admitted by creation. |

`normalizePriceSetConfig` supplies
`options.populateWhere.prices.price_list_id = null`. This filters populated
children, not the root PriceSets. Native `buildQuery` forwards it to the DAL.
Neither ignoring it nor treating it as a root relation filter preserves the
contract. Native normalization owns equivalent-price selection: the later price
wins; the adapter must not implement a second price hash/deduplication algorithm.

Inventory is a real later prerequisite. `validate-inventory-items.ts` queries
`inventory_item` even for empty IDs; `create-inventory-items.ts` invokes the
level workflow even for empty levels; `validate-inventory-locations.ts` queries
`stock_location` without an empty shortcut. Unmanaged variants do not, by
themselves, authorize omitting those dependencies from the full native composer.

## Reproduced gaps and dispositions

A comparison-only probe compiles the actual six Pricing models with the current
pinned DML compiler, then sends each selected table through current
`schema/compiled.ts`. No runtime source or admitted profile is changed. The probe
uses the pinned Pricing enum definitions and the existing DML model builder.
Exact captured metadata and output are local validation artifacts, not an
installed-schema or database acceptance claim.

| Witness | Current owner and disposition |
| --- | --- |
| PriceSet and PriceRule decode; Price fails at `columns[3].type` (`bigNumber`). | Shared Medusa checked-DML grammar rejects the compiler's numeric output. `schema/model.ts` and lowering already name numeric types, but that does not establish admission. Extend the real decoder and validated companion construction. |
| Price's foreign targets are `price_set` and `price_list`; PriceList fails at `indexes[0].where`. | The shared decoder accepts only `deleted_at IS NULL`; current lowering maps every nonempty admitted predicate to that meaning. Do not bypass the decoder or let it mislower the compound condition. |
| Relational logical/physical predicates currently represent only null or one `isNull` atom. | Persistence's schema policy, canonicalization, stored validation, capability identity and structural SQL owner need an explicit neutral extension before exact PriceList admission. This is a new shared contract, not an installer failure. |
| Exact numeric companion policy currently requires matching nullability and matching nonempty numeric/raw defaults. | Native Price amount has no default, a required numeric column and nullable generated raw column; optional quantity bounds also lack defaults. The existing Currency-shaped capability does not establish these contracts. Extend logical/physical validation deliberately; do not manufacture zero defaults or silently change native nullability. |
| Shared relation population accepts paths/order/lifecycle but no child predicate. | Extend the shared Medusa read/population owner. Its local fetched-row reuse must account for the predicate; equal target tables do not make differently filtered populations interchangeable. |

These are identified admission prerequisites. There is no evidence here of a
failure in the completed ShippingProfile or installation capabilities. The
temporary model probe is not native Pricing service, storage or concurrency proof.

## Foundation slices

### A1. Exact numeric metadata and values

Extend shared Medusa compiled-DML decoding to validate `bigNumber` columns and
their actual generated raw companions. Extend the existing persistence companion
contract to distinguish required values without defaults, nullable values with
absent/null defaults, and the already supported matching explicit defaults.
Retain authored versus derived provenance, same-table/type checks, exact supplied
numeric/raw agreement, and the existing residual adapter write obligation.

The native generated raw column may be physically nullable; this must not turn
an inconsistent stored pair into a valid value. Define and test missing, null,
finite exact value, conflicting raw payload and malformed stored-row behavior.
Reuse existing numeric codecs/native BigNumber handling and Currency evidence;
do not convert exact values through an extra floating-point representation.
Existing Currency artifacts, physical identities and defaults must be unchanged.
Use neutral required/optional numeric models as well as the actual Price model.

### A2. Bounded compound partial-index predicates

Extend the existing relational schema/index owner with a bounded conjunction of
one null test and one text/enum equality atom, sufficient for the native PriceList
index. Keep existing null/`isNull` encodings and identities unchanged. Validate
both column references and the equality value before physical lowering; define
canonical operand ordering and carry all references through stored restoration,
capability requirements, plan verification and structural index creation.

This is typed schema metadata, not raw caller SQL or a general expression parser.
Medusa's checked DML boundary must recognize the supported native predicate
exactly and lower its meaning, rejecting every other unsupported expression.
The trusted physical owner must quote identifiers/literals through its existing
safe construction rules. Preserve the managed-soft-delete capability's exact
single-column index requirement; a compound index is not a replacement for it.

Prove fresh install, replay/restoration, unsupported/malformed predicates and
literal escaping on neutral tables. Inspect the resulting index definition on
ordinary-role PostgreSQL and distinguish catalog/semantic correctness from
performance. This slice changes no installed deployment or live schema.

### A3. Per-path child population predicates

Add a small optional per-path predicate input to the existing Medusa read plan
and population owner. Reuse checked column/predicate compilation and bounded
scoped reads. Preserve root membership/count, child filtering, nested paths,
projection, lifecycle selection, first failure and request lifetime.

Bind predicate identity into relation-row reuse, or omit reuse when completeness
cannot be proved. Prove two paths to the same table with different filters,
filtered/unfiltered reads, empty children and scope isolation. Product and its
existing relation/profile tests must keep their unchanged results. Pricing's
module policy admits the native base-price null filter; it must not invent a
module-local population engine or strip the native option before storage.

Each foundation is a separate coherent tested/reviewed commit. These shared
owners remain module-neutral and do not import Pricing or dispatch by its name.

## B. Connected native Pricing admission

After the foundations, promote the finite native Pricing constructor/model,
utility/type and step closure with exact provenance/browser guards. Construct
all six real internal services through `defineCommerceModule`. Add the named
`pricingRepository` dependency through its existing explicit extension seam:
the selected capability refuses `calculatePrices` through the borrowed refusal
owner. Do not instantiate the ORM repository, return fabricated calculations or
invent `clearAvailableAttributes` when no attributes cache exists.

Prepare a fresh, named eighteen-table schema: existing thirteen Product tables,
`price_set`, `price`, `price_rule`, `price_list`, and
`product_variant_price_set`. This is the proposed FK-closed inventory, not an
installed result. PriceList is structural-only in this branch: its service is
denied and no writes are granted. PriceListRule and PricePreference remain
source-only, with denied repositories. Retain native FK/index definitions rather
than dropping them to reduce this inventory.

Use three confined Product/Pricing/Link profiles. The intended Pricing surface is
create, retrieve/list/count with exactly the local `prices.price_rules` population
needed by native creation; no calculated price/context, PriceLists, preference
administration, update, upsert, deletion or cross-module hydration. Denied native
public methods must remain fatal when caught, with names checked against the
pinned module interface.

The proposed connected input has one existing Product, one to four variants,
zero to two base prices per variant, and at most one string-valued rule per price.
Use the existing admitted numeric input codec subset and bounded currency/rule
strings; do not invent currency-case normalization or require Currency storage
where the native Price model has no such FK. Characterize omitted versus empty
prices and native equivalent-price replacement without broadening to price
calculation or operator-rule APIs.
Module creation must also retain the optional supplied IDs/titles used by the
native fixtures, while refusing caller-managed lifecycle and raw-number fields.

Use actual `createProductVariantsStep`, `createPriceSetsStep` and
`createVariantPricingLinkStep`, preserving output/compensation shapes and input
ordering. Extend Product's module-owned workflow registration over its existing
native variant command, and reuse the current singular-Link metadata/repository/
event owners. Read pending variants, PriceSets with native local price/rule data,
and the Link root before the single settlement. Root rollback covers admitted
transactional work; no remote effect or suspended workflow is introduced.

Propose an explicit 128-call ceiling for the three fresh private profiles and
root; retain all other current resource defaults. This requires the approval of
this record and is not inherited from ShippingProfile. Account for the full
maximum input and failure/recovery envelope. If it does not fit, preserve the
failure and return for a resource decision; do not raise limits, drop reads or
split the commit. Existing default and ShippingProfile profiles remain unchanged.

## Compatibility, cleanup and acceptance

Preserve the complete original Pricing test files as comparison evidence. The
initial unchanged-body candidates from `price-set.spec.ts` are `should create a
priceSet successfully`, `should create a price set with prices`, and `should take
the later price when passing two prices with equivalent rules`. Their actual seed
helper creates rule-bearing PriceSets and must be included in the admission
audit. Retain executable assertions and native events, not fabricated harness
results. Inventory other tests explicitly; this subset is not full Pricing parity.

| Action | Owner and retirement/completion condition |
| --- | --- |
| Retain | Pinned native business methods, normalization, tests, FK/index/cascade metadata; existing Currency, Product, Sales Channel and ShippingProfile private profiles. These remain supported independent consumers. |
| Extend | Shared numeric/schema/population mechanics only at their actual owners; named Pricing and variant workflow declarations; exact promotion and runtime guards. |
| Replace/delete | Superseded shared decoder/population implementation in place; no legacy branch, per-Pricing bypass, copied deduplication, second lifetime, fake repository result or temporary runtime instrumentation. |
| Defer | Price calculation, PriceLists/rule operators/preferences, promotions/tax, price/variant deletion and cross-module cascade, Inventory/Stock Location, full native Product composer/hooks, general schema upgrades, public HTTP and production activation. |

For each slice, run affected typechecks/builds, source/provenance guards, required
lint and both project reviews. Storage/schema/transaction claims require both
PGlite and ordinary-role real PostgreSQL. Keep current installer deadlines,
same-scope serialization and physical-constraint evidence distinct.

Connected acceptance includes native scalar/array/empty creation, exact numeric
round trips, seed/projection behavior, duplicate native normalization, operation-
local graph facts/events, both singular Link endpoint constraints, conflicting
restore, late/caught failure, replay/revision/profile mismatch, cancellation and
escaped capabilities, subscriber failure and uncertain settlement. Use the
maximum admitted input for resource/recovery proof. Rerun affected Currency,
Product relation/variant, existing Link and ShippingProfile consumers. Stop owned
resources and commit only complete verified slices.

Rejected alternatives are a scalar PriceSet facade that omits native rereads,
dropping PriceList or its predicate, treating numeric values as ordinary numbers,
loading all six Pricing tables for constructor convenience, and claiming the full
variant workflow by disabling inventory input. No core correction is justified
solely by a convenient module name; the concrete witnesses above own this proposal.
