# Product–Variant–Pricing Workflow Logical Cutover

Status: connected workflow cutover implemented under the approved shared-storage
completion goal; the remaining Link lifecycle has its own physical consumer.

## Contract And Owner

Run the existing native `productVariantPricingWorkflow` with Product, base
Pricing, and stored Variant–PriceSet Link as three logical participants in one
Flarex atomic root. The native steps, pending graph queries, DTOs, event names
and compensation boundary remain Medusa-owned. Shared generic rows, indexes,
constraints, participant observations, settlement and recovery remain core-owned.
The Link remains its rich row and does not acquire endpoint FKs or implied
endpoint-existence enforcement.

The displaced physical workflow fixture supplied the scenario inventory: up
to four variants with option values, four PriceSets, eight Prices, eight
PriceRules and four Links in one commit, plus generated identities, late rollback,
replay, cancellation and uncertain outcome. Its fixed statement budget prevented
the maximum graph from passing. The logical replacement proves these gates.
Product root creation, base Pricing creation and Link attach
already have separate logical proofs. The connected gap is native standalone
Variant creation against an existing Product's option values and the three
participants' shared pending graph and publication.

## Connected Slice And Breaking Change

Admit the native Variant command's inserted variant and option-value pivot
attempts with exact module-event correlation and bounded observed ancestry.
Select the three authenticated logical sources in the existing workflow host.
Prove the maximum native graph and exact Pricing values, missing/invalid option
refusal, late rollback, replay, two-shop isolation and uncertain settlement on
PGlite and ordinary-role PostgreSQL. Assert one shared commit and no generated
module DDL. Do not substitute adapter SQL, a second transaction, a generic edge
writer or synthetic workflow steps.

This replaces the selected workflow's private storage selection and the
assumption that Product Variant commands are usable only through physical
profiles. No public Medusa DTO or event contract changes. The obsolete combined
physical workflow fixture is removed after moving its cancellation, event-pump,
revision-conflict, generated-ID and rollback witnesses to the logical suite.
The exact Link dismiss/restore/cardinality witness has moved to the
[logical lifecycle cutover](./17-variant-pricing-link-lifecycle-cutover.md). The physical
Pricing profile remains a named base-price consumer, including PriceList's
structural-only role. No named durable environment is reset or converted in
this slice.

## Completion Gates

Use the pinned native workflow and service commands, verify attempted rows and
event IDs before publication, preserve exact decimal text, active Link
cardinality and Product option ancestry, and check request replay against
retained outcome. Run affected typechecks, source guards, lint, both database
drivers and read-only TypeScript/systems reviews. Remove any newly displaced
assembly in the same commit; keep only named physical consumers with the
removal gate above. Broader Product commands, Link replacement and restore,
advanced populated-data evolution, developer APIs and hosted activation remain
outside this slice.
