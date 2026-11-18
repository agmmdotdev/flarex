# Native Shipping Option update preflight (139)

Status: implemented as private bounded support, including the approved native
compensation corrections. Hosted activation, populated upgrades and external
fulfillment effects remain unadmitted.

## Native authority and connected outcome

Use Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
The native `fulfillment/workflows/update-shipping-options.ts` runs both parallel
validators, the existing Option upsert step, per-Option Pricing updates and the
workflow update event. Empty input retains its native validation dependencies.
Execution borrows the existing atomic outer owner; native independent module
transactions are reference behavior, not proof of shared settlement.

Reuse the installed Fulfillment, Pricing, Region and Stock Location owners and
the three stored Link families admitted by [138](./138-native-shipping-option-creation.md).
Links supply native availability and PriceSet traversal; this root does not
replace Link memberships. Keep actual Manual provider calculation refusal.
General providers, external fulfillment effects, hosted activation, populated
schema upgrades, chunked Product import and Product export remain separate.

## Native behavior and approved compensation correction

Omitted prices skip the forward Pricing update but still capture a Pricing
preimage and invoke its retained inverse. An explicit empty price array removes
the existing cohort. Native price hashing, rule normalization, numeric operator
validation and Region currency selection remain native. Empty `rules: {}` does
not explicitly clear existing PriceRules. Conflicting explicit Price identities
can fail the native unique rule constraint before old rules are deleted.

Option `rules: []` is a native update no-op. Nonempty rule input replaces the
owned cohort. Scalar Type references change the Option FK; a supplied Type
object updates that Type even when it contains only its ID. Inline Type
replacement creates a row; explicit compensation retains the new orphan Type.
The native DAL hydrates the union of requested relations across all returned
Options after the full batch. Shared Type updates therefore return that Type's
final state on every Option, while mutation/event order remains per input.
Duplicate Option inputs retain their native failure rather than receiving a
new successful interpretation.
The native preimage field helper also refuses nested JSON arrays containing
`null`; preserve that failure and atomic rollback rather than repairing it at
the adapter boundary.

The original native inverse lacks complete PriceRule preimages: clearing or
replacing a Price can restore the Price while losing its rules. Replacing Option
Rules removes original identities which the old inverse subsequently rejects;
an originally empty Rule cohort is also not restored by an empty update.
The approved correction belongs to the native workflow steps:

- Capture complete Option Rule preimages when any selected input supplies rules.
  Before the existing Option inverse upsert, use native Rule APIs to recreate
  removed original rules and delete introduced rules.
- Keep the existing native PriceSet Link Query and capture complete old
  PriceRules through the native Pricing Rule read API. Recreate missing old
  rules for surviving Prices before the existing scalar PriceSet inverse;
  deleted Prices and their rules use the existing native nested creation path.
- Preserve original Rule IDs and creation timestamps. Keep ordinary forward
  validation and normalization unchanged. Retain original native witnesses and
  separately identified correction witnesses; never edit the comparison source.

The reference Drizzle backend retains the recognized undefined-relation issue
documented in 138. Its separate known correction is required to reach nonempty
workflow business behavior. A nested `prices.price_rules` Query candidate also
fails in that reference backend; the selected correction uses the actual flat
Pricing Rule API, with no fabricated Query result or alternate storage engine.

## Adapter ownership and bounds

Admit zero to four existing Options, four Rules per Option and two Prices per
Option, with at most 24 normalized PriceRules and eight distinct Region IDs.
Both original and replacement cohorts must fit; retained inverse support cannot
truncate removed rows. Four original and four inline replacement Types can be
observed in one call. Each before/final referenced Type cohort remains bounded
by the four Option roots.
The union of original and replacement Option Rule observations can contain 32
identities even though each active before/final cohort contains at most 16.
The native service retains a cumulative Rule-ID list across Options. Its
pre-delete difference can repeat already visited IDs during retained batch
restoration; raw selector accounting is distinct from the bounded stored cohort.

Use selected Fulfillment update and Pricing shipping-update profiles. Preserve
strict creation and other mutation profiles. Reuse the shared Medusa graph
replacement owner for scalar Type references and explicitly selected native
owned-to-one touches. Complete retained creates use the existing core's exact
same-root reconstitution proof; a module profile does not grant timestamp or
arbitrary historical identity authority.

Native module calls, query/read coverage, returned projections, mutations and
events require correlated receipts. Preserve internal facts when workflow event
compensation clears pending external publication. Keep source promotion and
portable runtime guards, both driver lanes, full retained callbacks, rollback,
scope confinement, replay, maximum cohorts and refusal controls as admission
gates. Named resource selection must cover the measured connected graph without
changing other profiles, SQL/lock timeouts or core ceilings.
The complete forward-and-inverse root selects 768 calls, 256 events, 2 MiB of
command bytes and the existing 30-second logical request duration. The initial
512-call selection refuses the maximum retained cancellation; creation and
other profiles keep their separate selections.

## Shared owner corrections

The native Link service-name Query selects `price_set.prices.*` directly from
the Link root. The shared Medusa graph owner now resolves that direct endpoint
projection using checked native Link relationship keys, authentic endpoint read
commands and bounded complete-set reads. It retains to-one endpoint shape and
the endpoint's own local child projection. Captured endpoint descriptors,
including join keys, paths and bounds, participate in durable workflow identity.
Traversal grants no Link mutation authority.

The generic Pricing mutation receipt checks identities and events. The selected
Shipping Option update receipt additionally correlates requested replacement
prices, native normalization, mutations, results and exact read coverage. Native
price hashing and normalization are extracted within Pricing, with guarded
delegation from its native service; the adapter does not copy those algorithms.
Native absent `price_list_id` is materialized as `null` before retained complete
creation, preserving the existing core's exact same-root preimage proof.
