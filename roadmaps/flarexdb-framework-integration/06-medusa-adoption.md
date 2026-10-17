# Medusa Adoption

## Shared Logical Storage Authority

The accepted [shared logical storage decision](../../design-notes/flarexdb-shared-logical-storage.md)
and [redesign roadmap](../shared-logical-storage/README.md)
replace the former deployment-owned commerce physical-table destination.
Application, Payload and Medusa target generic physical families with logical
tables, indexes, constraints and relations. Core and integration flows may be
redesigned cleanly during development; adapters must not compensate for missing
core contracts. Framework semantic ownership and singular settlement remain.

Descriptions below of current generated commerce tables, SQL indexes/FKs,
installation receipts and completed tests are baseline evidence. They do not
override the replacement target or prove its implementation. Physical lifecycle
work with retained system consumers must be inventoried before removal.

## Status And Scope

The [early cross-framework proof](../shared-logical-storage/README.md#early-cross-framework-proof)
is a required shared-storage integration gate: include Medusa-origin references
as well as Application/Payload references into commerce, with indexed traversal,
owner-preserving access, integrity and dependency-aware schema evolution. Report
core blockers with a proposed correction and request explicit approval unless
that exact correction is already covered; do not complete the adapter through
workarounds. The repository Medusa skill carries this integration procedure.

Status: accepted source-backed adoption sequence. The private Currency, Product
and Sales Channel integrations execute promoted Medusa services through Flarex-owned
installation, scoped transactions, and relational publication. Currency proves
its complete original integration file and seed-gated initialization. Product
proves all ten inventoried integration files, including public and internal
services, graph mutation, lifecycle, events, category trees, and the bounded
1000-image case. The [completed compatibility record](./preflight/46-commerce-command-registration-bound.md)
and [active case inventory](./preflight/product-upstream-test-cases.json) own the
current suite boundary and retained skips; earlier partial-suite counts are
historical checkpoints.

The [shared persistence adapter](./preflight/47-medusa-shared-persistence-adapter.md)
now centralizes checked runtime metadata, schema lowering, JSON-field decoding,
repository reads/projections, keyed updates, graph writes, mutation dispatch and
module-scoped repository/service construction for Currency, Product and Sales Channel. Named
domain policies retain query admission, Category tree/sort behavior, membership
exclusions and distinct lifecycle contracts. Product command assembly separates
profile preparation, reads, mutations and direct internal calls behind its
existing entry point. Product public commands and Currency reads share scoped
command construction with direct native-method bindings; domain-specific
admission and native upsert/lifecycle semantics remain explicit.
The exact Product + Sales Channel endpoint set shares one configured schema
installation with separately confined profiles. The approved
[B1 correction](./preflight/55-shared-installation-atomic-commerce.md) adds
same-installation atomic participants and is complete. Arbitrary configured
module sets remain unadmitted. Medusa services
remain above the existing Flarex transaction and publication owners.

The private inline Product import is complete for its bounded admitted profile.
The bounded [native Sales Channel creation](./preflight/110-native-sales-channel-creation-workflow.md)
profile, [native Sales Channel selector update](./preflight/111-native-sales-channel-update-workflow.md)
and [native Sales Channel deletion](./preflight/112-native-sales-channel-delete-workflow.md)
are complete. Deletion retains the genuine Store default-channel guard and both
supported Link families, their native lifecycle and transaction-covered
compensation callbacks. Its four-ID/eight-pivot-per-family profile keeps existing
resource limits. The bounded
[native Stock Location update](./preflight/113-native-stock-location-update-workflow.md)
profile implements optional Address reads, native partial patches and mixed
Address upsert. It preserves scalar-first results, successful absence, standalone
Address creation and cumulative selector metadata. Its explicit borrowed-operation
scheduling selects the shared owner without changing existing profiles or limits.
The bounded
[native Stock Location deletion](./preflight/114-native-stock-location-delete-workflow.md)
profile is implemented for the installed Sales Channel Link graph. It retains
actual-result Link cleanup, native module lifecycle events, retained compensation
and Addresses/Inventory/Store data. Its shared composite-key reverse path keeps
active partial-index access distinct from all-row restoration. Additional default
Fulfillment and Pricing cascade branches retain their separate connected admission.
The bounded
[native Inventory Item update](./preflight/115-native-inventory-item-update-workflow.md)
profile preserves keyed final patches, native preimages and compensation,
scalar/array service results and ID-only no-op behavior. Its finite dimensions
use the shared binary64 representation selected by generic DML lowering;
existing int32, exact-decimal and populated-source admission remain distinct.
Inventory levels, reservations and rich Variant links retain their stored data.
The bounded
[native absolute Inventory Level update](./preflight/116-native-inventory-level-update-workflow.md)
profile preserves native tuple lookup, caller-ID precedence, keyed final patches,
exact quantities, reserved stock and tuple-only writes/events. Shared conjunctive
point planning keeps complete tuple reads confined to their existing compound
index, including absent tuples, without weakening receipts or resource limits.
The bounded
[native Inventory Level deletion](./preflight/117-native-inventory-level-delete-workflow.md)
profile preserves selected native IDs, exact four-field guard projection,
Level-only soft deletion and retained restoration. Its named graph admission
authenticates complete bodies before the native field mask; shared
[call-local activity](../shared-logical-storage/62-call-local-row-observations.md)
distinguishes genuine cached and pending candidate use from earlier calls while
retaining complete settlement dependencies. Existing OCC, calls and events stay
with their current owners. The bounded
[native Inventory Item deletion](./preflight/118-native-inventory-item-delete-workflow.md)
profile retains computed reservation guards, complete Item/Level/Reservation
cascades, eight rich Links and native retained inverses. Link preparation binds
complete-history admission to its genuine immutable repository owner. Native
raw-ID results and batched Link events retain their existing semantics. The
bounded [native Level batch workflow](./preflight/119-native-inventory-level-batch-workflow.md)
combines eight creates, four updates and four raw deletes through the genuine
parallel composer and one Inventory participant. It preserves omitted deleted
output, the direct create branch's scalar Location behavior, and distinct
physical-create, update and restoration inverses within existing resource limits.
The bounded
[standalone Inventory Item creation](./preflight/120-native-inventory-item-create-workflow.md)
profile preserves native ordinal association for four Items and eight nested
Levels, including unconditional empty Stock Location reads. Shared Item-create
receipts authenticate complete ordered DTOs before association; Stock Location
read receipts authenticate IDs, projections and pagination counts against actual
call-local observations. Retained physical Item compensation removes its complete
bounded history while emitting only native root Item events. Existing resource
limits remain unchanged. The bounded
[standalone Inventory Level creation](./preflight/121-native-inventory-level-create-workflow.md)
profile creates up to eight Levels for existing Items and Locations through a
dedicated two-method Inventory profile. It retains the required empty Location
query, complete native DTOs, physical creation inverse and existing resource
limits. Shared Level event decoding preserves batch receipt error classification
while each profile keeps its own publication actions. The bounded
[Reservation deletion by Line Item](./preflight/122-native-reservation-line-item-delete-workflow.md)
profile admits four raw Line Item IDs, four complete matching Reservation history
rows and four affected Level tuples. It preserves native selectors, grouping,
events and retained inverse behavior, with the approved native correction using
deleted-only preimages to restore reserved demand. An unconditional derived Line
Item index provides complete-history access through existing storage owners.
The trusted workflow host explicitly selects identity-bound scope exclusion
before native callbacks; existing resource limits remain unchanged. The native
inverse also restores older matching tombstones, so external saga safety remains
unclaimed. By-ID restore and populated-schema upgrades remain separate gates.
The bounded [Store deletion workflow](./preflight/123-native-store-delete-workflow.md)
admits four raw Store IDs and complete history of eight Currency and eight Locale
children through the genuine module lifecycle and required empty-family Link
routing. Native module registration owns maps and events; the existing read-only
Store guard and scalar default endpoints retain their separate authority.
The deletion profile retains existing resource limits. The bounded
[Store creation workflow](./preflight/124-native-store-create-workflow.md) admits
four Stores, eight Currencies and eight Locales in total, and four distinct raw
Pricing preference keys. Native normalization, cross-Store raw-key selection,
complete DTOs, required empty calls and retained physical/previous-DTO inverses
use existing shared owners under one settlement. Its separate trusted profile
selects 128 calls and existing root/borrowed FIFO scheduling; other resource
limits retain their defaults. The bounded
[Store update workflow](./preflight/125-native-store-update-workflow.md) admits
four selected Stores with eight historical rows per child family and at most
two active children per family per Store. Native selector/projection,
normalization, physical replacement and original-input Pricing behavior remain
intact. A separate identity-bound profile selects scope exclusion, FIFO
scheduling and 128 calls. An explicitly admitted neutral core operation proves
same-root deleted-row identity and managed fields for the genuine retained
full-child inverse. Native dotted-metadata and historical-tombstone inverse
limitations remain; exact failed-root rollback is separate from external saga
compensation, which is not admitted.
Chunked File import and Product
export are explicitly deferred; their File and Region dependencies are outside
the current integration goal.
With performance optimization paused, the approved bounded connected admission is
[Product Variant Inventory](./preflight/95-product-variant-inventory-workflow.md):
managed/default InventoryItems and rich Variant–InventoryItem Links, retaining
the native empty inventory-level and Stock Location query dependencies. This
executes the actual native variant composer for one to four variants on an
existing Product, including Pricing and both stored Link families under one
root. Its named 256-call profile preserves the smaller existing profiles.
Nonempty levels and reservations remain subsequent admissions. The Pricing-only branch retains its named Product-launch consumer
until that existing-Product/Tag operation has an explicitly selected replacement.
The approved [native Product root](./preflight/96-native-create-products-workflow.md)
executes the actual `createProductsWorkflow` for one to four new Products and
zero to four variants across the batch, including the complete variant child.
One native Link resource delegates to the two existing logical Link sources,
preserving their identities and command/receipt owners. The named root selects
512 calls and the separately approved 128-event allowance; other profiles and
resource limits remain unchanged. Sales Channel and ShippingProfile references
use previously created endpoints. This is bounded private admission. The Pricing-only
launch graph retains its distinct existing-Product/Tag and measurement consumers
until those consumers migrate explicitly; new-Product creation alone does not
displace that behavior.
The [Stock Location and Inventory-level admission](./preflight/97-stock-location-inventory-levels.md)
stocks existing Inventory items through the actual native Location and level
workflows. Its separate root admits up to four locations with optional inline
addresses and eight levels, resolves new location ordinals from authentic native
results, and retains the default 64-call/64-event envelope. Native location
validation, exact quantities, computed availability and module events retain
their owners. Existing Product/Variant item-only profiles and Stock Location
read profiles keep their refusals; nonempty levels are not invented as inputs
to the Product composer. Sales Channel/location links remain subsequent
admissions. The
[stock-adjustment and reservation preflight](./preflight/98-stock-adjustments-and-reservations.md)
admits up to four native sequential stock deltas and individual reservation
create/update/release workflows. Its explicit identity-bound scope-exclusive
atomic profile reuses the existing writer clock before native callbacks; other
profiles and limits retain their behavior. Inventory owns exact arithmetic,
numeric DTO serialization and native events/lifecycle, with one shared outer
publication. Native batch availability and relocation gaps retain their
Inventory owner and remain excluded. Reservation updates keep the same item,
location and backorder flag; zero quantities and native backorder creation are
included. This is bounded private support, not general Locking/Cart/Order or
hosted compatibility.
The [Sales Channel and Stock Location Link admission](./preflight/99-sales-channel-stock-location-links.md)
implements the native add-then-remove workflow, named many-to-many Link and
attached/detached event families. Its bounded private facade selects one location
and up to four additions and four removals under existing default atomic limits,
with a separate logical source and Link-root reads. Its connected admission is
complete within those bounds; cross-module hydration, stronger endpoint liveness
enforcement and hosted activation remain separate admissions.
The [native Product Variant update profile](./preflight/100-native-product-variant-update-workflow.md)
implements existing-variant edits, native base-price replacement, Inventory-Link
dismissal and ordered workflow events/hooks. Its explicit Pricing and Link
mutation profiles retain existing creation consumers and endpoint identities.
The bounded root admits at most four variants, two base prices and two Inventory
links per variant under a named 256-call/64-event allowance and default atomic
OCC. The [whole-Product update profile](./preflight/101-native-product-update-workflow.md)
now executes the native parent and Pricing child, owned-graph reconciliation,
Product Link replacement and endpoint-selected Pricing cascades. Its bounded
four-Product/four-Variant root selects 512 calls, 2 MiB and 256 events under
default OCC. Explicit queued root operations preserve native Link concurrency;
identity-bound mixed publication supports Product and Pricing while retaining
their 256/128 identity allowances and the existing commit packet limits.
The [native Product deletion slice](./preflight/102-native-product-deletion-workflows.md)
implements native Product and Variant soft-deletion roots, complete
Inventory ownership reads, the native reservation guard and Link/Pricing
cascades. Its named four-target/four-Variant profile retains 512 calls,
128 events, 2 MiB and ordinary participant working sets under default OCC.
General deletion, restoration and hosted activation remain unadmitted.
The [native Product batch slice](./preflight/103-native-product-batch-workflows.md)
joins the actual create/update/delete children through native Product and
Variant composers. Explicit SDK sibling regions share one queued atomic root
over authentic Product, Pricing, Inventory and Link capabilities. Its named
four-entry profile admits 1,024 calls, 256 events and 2 MiB, with Product's
256-identity working set and ordinary 128-identity sets elsewhere. It bounds
request-initial and incoming Variants separately and refuses Item attachment
and deletion intersections. General batch size and hosted activation remain
unadmitted.
The [native Product Type slice](./preflight/104-native-product-type-workflows.md)
implements creation, complete selector updates and soft deletion through the
real native composers. Its four-Type profile admits 64 calls and 64 events
with ordinary 128-identity working sets and one authentic native write per
root. Type soft deletion preserves Product references and uses the genuine
empty native Link route. Selector updates preserve native ID-array order,
including native first-occurrence deduplication, with independently ordered receipts.
General restoration, custom Type Links and hosted
activation remain unadmitted.
The [native Product Collection slice](./preflight/105-native-product-collection-workflows.md)
implements creation, complete selector updates and soft deletion through the
real native composers. Creation admits four Collections and four total Product
references; updates admit four selected Collections, four requested Product
entries and four prior members per Collection. Genuine ordered native Product
updates preserve last-target membership, hook-visible pending reads and
first-touch events. Creation/deletion retain 64 calls; updates select a named
128-call allowance. Each retains 64 events and ordinary 128-identity working
sets under default OCC. Soft deletion preserves Product references and uses
the genuine empty native Link route. General restoration, larger membership
graphs, custom Collection Links and hosted activation remain unadmitted.
The [native Product Category slice](./preflight/106-native-product-category-workflows.md)
implements creation, complete selector updates and leaf soft deletion through
the real native composers. It admits four requested entries, four total Product
references on creation, sixteen existing Categories touched by native tree
preparation and depth four. Only actual new Categories expand the identity bound
to twenty. Each operation selects a named 128-call/64-event allowance with
ordinary 128-identity working sets and default OCC. Native rank/path maintenance,
duplicate deletion requests, metadata replacement, event/hook order and the
genuine empty Link route remain intact. Shared creation receipts authenticate
native identity, rank, path and ordered sibling shifts. Physical deletion retains
complete soft-deleted descendant and pivot cleanup while returning and emitting
callbacks for requested roots only. General restoration, custom Category Links,
larger trees and hosted activation remain unadmitted.

The [native Product Option slice](./preflight/107-native-product-option-workflows.md)
implements creation, complete selector updates and soft deletion through the
actual native composers. It bounds four roots, four persisted and four incoming
Values per Option, four Product parents and two pivots per removed Value.
Complete preparation precedes writes. Creation/update select named 128-call
allowances; deletion retains 64 calls. All retain 64 events, ordinary
128-identity working sets and default OCC. Matching active Values retain their
identities; omitted Values preserve storage while explicit replacement removes
omitted Values and their pivots, including already-deleted Values. Default
presentation hides deleted children without discarding replacement evidence.
Soft deletion preserves pivots and classifies retimestamped deleted Values from
actual preimages. Hooks precede workflow events and use the genuine empty Link
route. The selected portable fork's DTO/order/event distinctions from fresh ORM
execution remain explicit. Reassignment, restoration, custom Option Links,
larger graphs and hosted activation remain unadmitted.

The [native Image-to-Variants slice](./preflight/108-native-image-variant-workflow.md)
implements the inverse image-association composer with one Image and four raw
additions/removals each. Duplicate requests, distinct assignment identities,
cross-Product pairs and genuine parallel intersections retain native behavior.
Full-row removal sees only assignments with active Image and Variant endpoints;
native URL-filtered thumbnail updates retain complete sibling/Option preparation.
The named profile admits sixteen prepared sibling Variants, four read Product
parents, four total Options, four selected Values per Option, four pivots per
Variant and eight selected assignment deletions. Its authenticated facade selects
128 calls with ordinary 64 events, 128-identity working sets and default OCC.
SDK resolution authenticates closure-returned references before capture and
bounds descriptor inspection and expanded traversal. Existing Variant-to-Images
admission and portable endpoint integrity remain intact. Larger graphs, File
import/export execution, general restoration and hosted activation remain
unadmitted.

The [inline Product import preflight](./preflight/109-native-inline-product-import-workflow.md)
implements the bounded private native composer and interpreter, durable
confirmation with lease-free waits, cold checkpoint recovery, one finite atomic
Product batch, persisted local-feed Notification phases and Task-bound parent
event eligibility. Trusted Task lifecycle and fresh ordinary/control subjects
own continuation, cancellation and cleanup authority. Native CSV normalization
and complete graph admission precede the confirmation wait.
Native orchestration distinguishes
a completed default batch from its subsequently failed parent invocation:
the uncheckpointed child cannot be found for cancellation, so business undo
must not be invented. Recovery covers business commit, confirmation, child DONE
and terminal parent checkpoints before native event release. Unknown provider
outcomes retain their uncertainty and cannot be redispatched as fresh. Chunked File import and Region/File
export are deferred, with their separate dependencies excluded from this goal.

The [Sales Channel and first stored Link preflight](./preflight/50-product-workflow-sales-channel-foundation.md)
traces `createProductsWorkflow` and defines the connected Sales Channel endpoint,
ProductSalesChannel Link and native association-step milestone. Customer is a
deferred adapter-reuse candidate, not a Product-creation prerequisite. The new
foundation gate is complete. Its [core binding correction](./preflight/51-commerce-installation-profile-bindings.md)
separates physical readiness from authorized execution profiles and is complete.
One unversioned current binding API
replaces the development-only encodings; the owner confirmed no production data
or retained compatibility obligation. Neutral core fixtures exercise three
disjoint profiles without module-specific branches. Same-installation atomic
participants retain those confined profiles. The approved
[stored ProductSalesChannel Link](./preflight/57-stored-product-sales-channel-link.md)
adds a fresh fifteen-table candidate and a third confined profile. Its actual
native Link router/services implement attach, tuple dismiss, endpoint-selected
soft-delete/restore and Link-root reads. Native event evidence, complete-key
ordering, atomic endpoint-plus-Link composition, replay and rollback are covered
by complete PGlite and ordinary-role PostgreSQL conformance. Shared assignment
batching replaces repeated installer SQL without changing its deadline or adding
a Medusa-specific core branch. The construction entry
point owns native wiring without exposing repository/manager assembly to callers.
The [Gate C composition](./preflight/58-native-product-sales-channel-workflow.md)
uses the actual native Product/Sales Channel creation and association steps.
Its named private facade selects one channel and one to four simple Products,
associates returned IDs, and reads pending Product, Sales Channel and Link roots
through the existing atomic workflow host. Module-owned registrations hide
method/repository assembly; root rollback restores pre-existing Link state rather
than executing inverse callbacks. This gate adds no core/schema/engine changes.
Cross-module graph hydration remains unadmitted; the bounded native Product root
is admitted separately by the record above.
The [shipping-profile foundation](./preflight/59-product-shipping-profile-foundation.md)
implements its shared text-inequality prerequisite and native cardinality
characterization, not Fulfillment/ProductShippingProfile activation. Inequality
is explicitly admitted for Link IDs and the Sales Channel ID, with shared
scope, null, pagination/count and resource limits. The approved
[native batch correction](./preflight/61-native-link-batch-cardinality.md)
rejects contradictory incoming partners from relationship metadata before any
service create. Many-to-many behavior and exact duplicate delegation are retained,
without a Flarex core change.
The implemented [singular-Link storage foundation](./preflight/63-native-singular-link-storage.md)
derives active uniqueness from native metadata and protects tuple endpoints
from extra-data replacement, reusing existing Flarex partial-index machinery.
Shared scalar-Link schema, repository, native wiring and event mechanics serve
both the unchanged ProductSalesChannel binding and a neutral one-to-one stored
proof. Pair identity survives soft deletion; conflicting reattach or restore
rolls back without facts/events. Scope isolation and actual PostgreSQL unique-index
contention are covered independently of host serialization. This foundation
retains the existing core capability and public activation boundary.
The implemented [connected ShippingProfile slice](./preflight/66-connected-product-shipping-profile.md)
adds native ShippingProfile creation and scalar reads, with the real Fulfillment
constructor but only one selected Fulfillment table. A fresh seventeen-table
schema contains Product, Sales Channel and both homogeneous Link families under
one native router. The private workflow creates the endpoints, associates Sales
Channels before ShippingProfiles, reads five pending roots and settles once.
The source closure remains broader than table/API grants; provider execution,
deletion, hydration, full Fulfillment and public activation remain unadmitted.
The separate [native Shipping Profile update](./preflight/126-native-shipping-profile-update-workflow.md)
admits an explicit selector of up to four raw IDs and native name/type/metadata
patches through the genuine update and retained upsert callbacks. It preserves
array results, metadata merge/key removal, empty/null clearing, true empty-patch
no-ops and projected metadata inverse limitations. Complete row/projection,
mutation and event receipts retain the existing optimistic atomic owner and
default 64-call allowance. Both profiles share the genuine constructor while
keeping sibling Fulfillment tables, providers and relationship hydration denied.

The [native Shipping Profile deletion](./preflight/127-native-shipping-profile-delete-workflow.md)
admits up to four raw Profile IDs through the real Product-Link Query guard,
Shipping Option hydration and retained endpoint Link compensation. Its explicit
fresh six-table Fulfillment composition preserves all five native Option FKs
and the existing scalar profiles; populated schema evolution remains separately
gated. Shared evidence of executed relational selections authenticates empty
guards and complete historical Link restoration for this profile and the
existing Inventory Item Link lifecycle. The complete root and retained inverse
use the existing optimistic atomic profile and default 64-call/event allowances.

The [framework installation core redesign](./preflight/76-framework-installation-core-redesign.md)
is complete within its approved bounded profiles. Persistence now owns protected
immutable definitions/evidence, sealed child sets, durable operational progress,
prepared construction, explicit full verification and exact publication handoff.
Normal steps and live resume avoid growing historical reconstruction; settled
replay reads current availability using its full head's readiness. Full verification,
uncertain recovery and runtime cold construction retain their independent contracts.
The unchanged seventeen-table fixture meets its frozen acceptance gate on both
drivers. Exact samples live in artifacts and Git; this is not arbitrary-inventory
or deployment proof. PGlite remains functional-only and native execution requires
actual restricted logins on every acquired connection.

Earlier reconstruction-only candidates remain withdrawn and the narrower record
75 proposal is superseded. Medusa's current module/Link semantics and Payload's
structural lifecycle consumer share the corrected installer while Application
content-schema authority remains separate. ShippingProfile retains its private
commerce error envelope. The two pinned native creation/event cases execute
unchanged through the native service and emitter; exact duplicate-message parity
and both native deletion cases remain deferred in the retained original source.

ShippingProfile's approved [resource admission](./preflight/92-shipping-profile-workflow-resource-admission.md)
selects 128 calls for four fresh named profiles and the trusted root, keeping
one-to-four Products and every other budget unchanged. Each participant still
caps the root. Existing default profiles, their 64-call refusal, identity/replay
semantics and the independent ProductSalesChannel workflow remain supported.
The native module's unselected public methods are explicit sticky refusals,
including provider calls and empty writes caught after pending creation.

The approved [Product Variant Pricing admission](./preflight/93-product-variant-pricing-admission.md)
starts with shared exact-numeric, compound-index and child-population prerequisites
exposed by the pinned native PriceSet create path. Native creation rereads prices
and rules, and Price's nullable PriceList FK retains a structural table dependency.
The three foundation slices and private connected branch are implemented. The
branch creates one to four variants, zero to two base prices per variant and
one string-valued rule per price, then associates native returned identities
through singular Variant–PriceSet Links under one root. PriceList is required
by the native FK and deliberately has no row grant. The approved
[structural-table ownership correction](./preflight/94-commerce-structural-table-ownership.md)
provides explicit zero-access ownership at the shared profile/binding owner.
The finite native closure and three unchanged test bodies retain their actual
seed data. All three profiles and the root use the approved 128-call contract.
The bounded private admission is complete. Price calculation,
PriceList operations, cross-module cascades, nonempty Inventory levels, Stock
Location writes and the complete Product composer remain subsequent admission
gates. The later Inventory admission above adds its own selected structural and
runtime closure without broadening this Pricing-only profile.

The approved [JSON identity and retained-outcome correction](./preflight/60-commerce-json-identity-and-outcomes.md)
gives both commerce hosts domain-separated ordinary JSON identity and result
evidence, including reserved and Unicode keys. Shared idempotency rows retain an
explicit encoding, including after expiration; existing rows remain Application
evidence without re-encoding. The existing bounded resolver rejects the wrong
family before byte transfer. Application, CMS and cross-domain encoding is
unchanged. Old private commerce request keys conflict rather than being replayed
under new semantics; no compatibility wrapper or second outcome store exists.
Sales Channel's six-command profile preserves the original service and static
cases, native metadata merging, scalar/array results, pagination and errors.
Boundary checks retain input refusal, identity protection, replay, service
lifetime and complete event-evidence rollback. Upsert, selector updates and
soft-delete/restore remain unadmitted rather than inferred from the native class.

Gate A exposed a
[shared module-construction defect](./preflight/47-medusa-shared-persistence-adapter.md#native-mutation-subscriber-construction-contract):
the native constructor lacked the prepared persistence dependency required to
connect mutation subscribers. Its approved correction supplies one shared typed
constructor dependency object, retaining the neutral module and Sales Channel
write witnesses. Product/Currency regression coverage is preserved. This
completed correction changes shared Medusa adapter composition, not Flarex core.
The Sales Channel entry point reuses it without module-specific subscriber wiring.

Complete integration-suite coverage does not establish arbitrary input parity
or a complete module bootstrap/migration adapter. Other stored Module Links,
workflows, distributed locks, durable business-event delivery, general module
migrations, public serving, and production activation remain separately gated.

This plan owns Medusa semantic adoption and conformance. Its current physical
module-table implementation is the baseline to replace under
[shared logical storage](../shared-logical-storage/README.md). The target is
generic physical families with logical commerce tables/indexes/constraints and
rich Link records. Preserve intended DML, module, Query, Link, workflow,
idempotency and event behavior; redesign core and fork seams rather than
preserving inadequate repository/DDL internals through adapter workarounds.

It does not turn Medusa tables into public application tables or make Flarex
core depend on Medusa.

## Source Authority

The primary integration source is the Cloudflare-oriented fork maintained at
`https://github.com/agmmdotdev/medusa-fork.git`. Official Medusa source and npm
packages are historical provenance, licensing, and comparison evidence; they
will not override behavior in the future selected fork snapshot.

[`preflight/04-medusa-fork-source-island-and-package-convergence.md`](./preflight/04-medusa-fork-source-island-and-package-convergence.md)
owns the exact source hierarchy, clean pin, inert `third_party/medusa` island,
verification contract, reuse classification, and later package-promotion
gates. The island is not a production dependency. Only source-map-admitted
packages promoted into the active root workspace may later enter the Medusa
adapter graph.

[`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md)
owns the prerequisite order before any such package promotion. Source mapping
and inert fixture extraction may proceed early. The shared-core, Flarex Application,
and bounded Payload gates have passed. Exact Currency source promotion is also
complete, as are private Flarex-backed Currency installation and service
execution. Product schema/relationship installation, private nested creation,
bounded population and local event conformance are complete. Related creation
and bounded reads are implemented under record 30; keyed tag/type updates under
record 31. Records 32-34 implement the larger Product mutation and lifecycle
milestones, including explicit shared reference-update, declared-key removal
and managed-transition capabilities. General Payload
compatibility is separate.

[`preflight/06-medusa-package-capability-source-map.md`](./preflight/06-medusa-package-capability-source-map.md)
now owns the exact fork-pin capability audit, the reproducibly measured
65-input Currency semantic graph, exploratory broader graph notes, reuse
classifications, retained test inventory, and source consequences for the
value-only relational schema. Its companion JSON is machine-readable audit
evidence, not a promoted package manifest.

The admitted island now pins fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` as 8,496 exact tracked regular
files under [`third_party/medusa`](../../third_party/medusa). Its checksum and
boundary verifiers are root-owned admission tooling, not a Medusa runtime
dependency. Seven private root `@medusajs/*` packages and the private
`@flarex/medusa-adapter` value translator now exist under the exact Currency
promotion manifest; their presence does not authorize live serving.

## Current Source Findings

The locally audited fork demonstrates important compatibility surfaces:

- modules currently consume the mature `@medusajs/utils/dml/model` grammar,
  whose models include scalar fields, indexes, checks, defaults, soft-delete
  behavior, and relationship metadata;
- the newer `@medusajs/dml` implementation is currently scalar-only even though
  its types describe relationships, so it is not the module grammar to mirror;
- repository contracts include transaction reuse, list/count/query, create,
  update, upsert, delete, soft delete, restore, and relation replacement;
- static module manifests provide a Worker-safe alternative to filesystem
  discovery;
- `Context.transactionManager` is the existing transaction propagation seam;
- Module Joiner and Link definitions carry endpoint, alias, cardinality,
  cascade, extra-data, and read-only semantics; and
- custom repositories and Query require more than basic generated CRUD.

The fork is also substantially more advanced than a plain Node-oriented
Medusa checkout. It contains portable DML/DAL experiments, Drizzle and
Cloudflare persistence packages, Worker-safe runtime entrypoints, static
manifests, Query/runtime work, Cloudflare workflow/event/lock integrations,
physical Worker import guards, and real unchanged module assertions exercised
through multiple persistence lanes.

That work is valuable source and conformance evidence to reuse. It is not yet
a Flarex-backed production adapter:

- prepared module models are held in mutable module-global state while static
  modules may load concurrently;
- its generated Drizzle migration adapter intentionally throws from the
  optional run/revert methods and therefore does not provide the Flarex-managed
  production migration lifecycle;
- link modules still use MikroORM entity generation and PostgreSQL
  introspection/diff logic; and
- Link uniqueness uses an application precheck that storage must close under
  concurrency.

The exact audit has now regenerated these findings at fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The checked-in command
reproducibly measures a 65-input real Currency model/service graph with zero
checked Worker blockers. The observed 76-input static-manifest and 130-input
eager Drizzle graphs remain exploratory snapshots without a frozen reproducible
tool policy; their exact counts are not accepted receipts. Source evidence still
rejects the eager Drizzle graph as an unchanged Currency closure. The first
later promotion therefore separates Currency semantics/static bootstrap from a
translated persistence seam.

## Ownership Boundary

FlarexDB owns:

- scope-qualified physical lowering;
- schema artifact, installation, migration receipt, readiness, and binding;
- columns, indexes, checks, constraints, and transaction enforcement;
- transaction settlement and commit publication;
- optional derived adjacency and storage observability; and
- backup, restore, repair, and operator mechanics.

Medusa owns:

- DML authoring and normalization;
- static module manifests and dependency injection;
- complete module-set coordination;
- Joiner aliases, linkable keys, and Module Link meaning;
- repository and custom-repository behavior;
- query-option, Query, RemoteJoiner, GraphQL, and index planning;
- Link attach/dismiss and lifecycle;
- workflows, locks, idempotency, and commerce events; and
- semantic migration and data-backfill intent.

## Module-Scoped Persistence Preparation

Replace process-global prepared-model state with an immutable module-scoped
binding:

```text
prepareModule(module identity, normalized models, repositories, capabilities)
  -> PreparedModulePersistence
```

The result captures the exact module schema subset and authorized relational
handles. Loading another module cannot change it.

All module preparations and resolved links then feed one coordinator. Here,
"complete" means the complete configured supported module/link set for that
candidate, not every module in the commerce universe:

```text
static manifests
  -> normalize actual DML
  -> collect module ownership and capabilities
  -> resolve Joiner and Module Links
  -> finalize complete configured candidate set
  -> compile one owner-qualified artifact whose payload is RelationalSchema
```

Do not create a third DML grammar. Normalize the mature Medusa model once and
compile its value output into Flarex `RelationalSchema`.

## Initial Compatibility Profile

The first supported environment is deliberately narrow:

- one admitted clean snapshot of the primary Medusa fork with its official
  upstream provenance baseline recorded;
- one homogeneous configured supported module/link set per candidate; the
  first candidate may contain Currency alone;
- one shared physical relational installation;
- scope-qualified reserved tables and constraints;
- static manifests rather than runtime filesystem discovery; and
- no per-scope custom schema or staggered module generation.

Unsupported modules, repository capabilities, link shapes, triggers, or
migration requirements fail admission before serving traffic.

## Implementation Sequence

### Source-island admission

- Completed without adding a root package, adapter, runtime import, route, or
  deployment binding.
- The clean committed fork pin, independent workspace, lockfile, patches,
  package graph, provenance, licenses, exact bytes/modes, and selected
  regression commands are preserved and mechanically verified.
- The root boundary derives active Flarex package names from root manifests and
  rejects package/import edges, relative or absolute file and workspace path
  dependencies, manifest/TypeScript/bundler aliases, static code and JSDoc
  references, symlinks, broad workspace membership, and implicit root-script
  entry. Island manifests, sources, configs, and symlinks are checked in the
  reverse direction. A dedicated path-filtered CI job enforces admission.

### Source maps and contract audit

- Completed at the exact admitted pin without importing the island into Flarex
  code.
- Mature DML remains the schema-normalization authority; standalone
  `@medusajs/dml` is rejected as a relationship-capable replacement.
- Repository, transaction, Query, Joiner/Link, migration, workflow, lock,
  idempotency, and event capabilities are classified with exact sources.
- Currency model/service/static inputs, initial data, legacy migrations, test
  evidence, graph measurements, and package direction are frozen as audit
  constraints.
- The current process-global prepared-model/module registries are rejected as
  Flarex scope authority.

### Schema admission

- Completed privately in
  [`preflight/08-relational-schema-value-contract.md`](./preflight/08-relational-schema-value-contract.md):
  the canonical value-only `RelationalSchema`, deterministic normalization,
  framework-artifact digest/provenance composition, and unsupported-capability
  failures use the source-audited capability matrix and exact representative
  fixtures.
- Owned by
  [`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md):
  scope-isolated physical lowering, stable collision-domain migration
  coordination, structural readiness, and availability. Private values and
  metadata/repositories are implemented; the target/session, runner and fresh
  coordinator have no-base PGlite-functional evidence. Native acceptance,
  scale, base-backed execution and the later binding checkpoint remain open.
  Use the [master capability matrix](./README.md#current-gate-status) for
  cross-lane status; these mechanisms do not establish a live Medusa compiler
  or repository adapter.
- Keep live fork DML normalization and candidate compilation outside this step;
  those begin only after the connected source closure is promoted.
- Generate no public application schema and expose no raw database handle.

### Shared-core and earlier-lane promotion hold

Do not begin the Currency-connected foundational promotion until all of these
are complete:

- the completed exact Medusa source/capability map and exact Payload contract
  preflight;
- completed value-only `RelationalSchema` admission;
- completed framework installation, readiness, availability, and migration-
  coordinator mechanics, followed by the separate binding checkpoint;
- an owner-scoped relational transaction/store capability;
- transaction-bound mutation receipts and typed common finalization under their
  separately accepted owner preflights;
- a synthetic reserved-relational lifecycle/transaction proof, including
  fail-closed unadmitted-receipt rejection and rollback, in PGlite and genuine
  PostgreSQL;
- the complete existing Flarex Application document/OCC/native-relation/commit
  regression proof;
- Payload scalar CRUD and nested request-transaction proof; and
- Payload's first non-reactive top-level one/many relation proof.

These gates prepare and verify the mechanisms Medusa will later consume. They
do not implement Medusa semantics in shared core. Once they pass, promotion
still begins with unchanged fork compatibility and remains separate from the
later Medusa transaction-propagation and typed commerce receipt adaptations.

### Currency-connected foundational promotion

- Treat the promotion unit as the private, test-only connected Currency
  portability closure, not as one superficially isolated npm package.
- Admit and promote only the actual Currency model, service, static manifest,
  mature DML normalization, and exact portable DAL, modules-sdk, type, utility,
  module-preparation, and repository-adapter closure required to establish the
  unchanged relocation baseline.
- Preserve `@medusajs/*` manifest identities where they are part of the fork's
  internal compatibility graph while using root-owned dependency versions,
  tests, and bundle gates.
- Give every promoted package a source map to the exact fork commit and source
  closure; retain no runtime import or file dependency on the island.
- Establish the unchanged fork compatibility baseline before adapting a Flarex
  host seam.
- Compile the complete configured normalized module/link set for the first
  candidate into canonical `RelationalSchema` values through the promoted
  source closure.
- Before any runtime adaptation, replace mutable prepared-model state with
  instance- or module-scoped ownership and define `MedusaModule` state
  isolation.
- Do not mistake the standalone scalar-oriented portable DML experiment for
  the complete mature relationship-capable module grammar.
- Keep migrations, Link, workflows, locks, events, idempotency, CMS
  interaction, and public commerce APIs outside this first promoted closure.

### Commerce transaction-host admission

- [Record 25](./preflight/25-medusa-currency-host-and-publication.md) combines
  this host, fresh seed-gated installation, bounded DAL and Currency row
  publication into one implemented private capability. Its scope covers those owners
  together; ordinary implementation details do not create new approval gates.
- Apply the accepted [execution-profile contract](./preflight/14-transaction-execution-profiles.md):
  preserve service transaction-manager reuse while Flarex owns the outer
  physical transaction. Workflow orchestration is a separate execution profile.
- Record 25 owns Currency transaction and publication admission together; a
  future module must prove its additional required semantics.
- Prove Flarex-owned scoped physical transaction acquisition, binding
  revalidation, isolation, timeout, interruption, commit, rollback, and
  settlement.
- Adapt Medusa's transaction-manager contract and nested propagation without
  giving Medusa or a repository the raw physical handle or finalizer.
- Preserve current Application lock ordering initially. Resolve the complete
  shared lock order in the transaction-owner contract before any change to
  publication-lock placement; acquisition after lane work is not yet accepted.
- Prove that borrowed-manager completion cannot commit the outer transaction,
  and nested failure cannot escape through an independent transaction.

### Commerce-row commit and event-intent admission

- Currency first proves row facts from seed/private repository writes. Its
  declared public service is read-only; it admits no domain-event family and
  rejects nonempty event handoffs. Event identity and durable delivery below
  remain obligations for the first selected module operation requiring them.
- Reuse shared relational facts and initialization receipts. Dataset size and
  module behavior belong to adapter contracts, not new core metadata per module.
- Add typed commerce-row mutation receipts and facts to the common finalizer.
- Add only the pinned typed Medusa event-intent contracts required by a later
  selected module; Currency admits no domain-event family.
- Persist each admitted event intent with the same commit and common outbox
  wake, then dispatch by stable identity with durable retry and delivery state.
- Intercept the existing service event handoff into that typed intent path;
  `EmitEvents` service completion is not evidence of an outer borrowed
  transaction's commit. Prove rollback suppresses external publication.
- Introduce no temporary publication path, arbitrary event envelope, second
  feed, or second outbox.

### Currency baseline

- Produce a fresh baseline for the Currency module.
- Install through the migration coordinator.
- Bind a scope-pinned commerce transaction manager.
- Adapt generated repository operations.
- Run unchanged Currency service and relevant integration tests.
- Prove scope isolation, uniqueness, rollback, transaction-local reads, and
  authoritative transaction settlement in genuine PostgreSQL.
- Prove each accepted write publishes its typed commerce-row fact, any admitted
  event intent, and the common outbox wake in the same commit.

### Product schema and physical relationships

- [Record 26](./preflight/26-medusa-product-schema-and-relationships.md) implements
  one complete fresh-schema capability: actual ten-model closure, derived
  pivots, shared schema extensions, deterministic installation and physical
  constraint conformance in PGlite and genuine PostgreSQL.
- Preserve implicit unique-pair pivots separately from the explicit
  VariantProductImage entity. Add no Product-specific core metadata.
- Keep this schema proof separate from runtime mutation admission. The
  single-table Currency runtime profile does not expand when a broader
  structural artifact becomes admissible.

### Product local events and later durable delivery

- Before the first Product create, update, delete, relation replacement, or
  restore proof, inventory the exact events emitted by the unchanged Product
  service behavior.
- [Record 28](./preflight/28-medusa-product-create-and-event-delivery.md) admits
  only a private local create/read proof with typed, transaction-buffered events.
  Acknowledged commit releases the buffer; uncertain settlement discards it even
  if database-result recovery succeeds. No business event is stored in outbox.
- Before event-bearing serving, decide the durable storage and dispatch owner,
  comparing shared outbox payloads with separate immutable intents. Complete
  atomic capture, provider handoff and crash recovery before that serving gate.
  A separate event table and an existing dispatcher are not assumed.

### Product service relationships

- [Record 29](./preflight/29-medusa-original-product-tests.md) proves three original
  cases using one installed fixture per driver. [Record 30](./preflight/30-medusa-product-related-create-and-reads.md)
  implements related creation and reads admitting eight more: tags, types,
  create-only collections, standalone images, associations and bounded relation
  predicates/population. [Record 31](./preflight/31-medusa-keyed-updates-and-remaining-product-tests.md)
  adds four tag/type update/upsert cases. Other updates, replacement, category
  mutations and scale remain unadmitted. [Record 32](./preflight/32-medusa-standalone-options-and-variants.md)
  groups related entities and Product graph updates into one 35-case milestone;
  lifecycle and scale follow. Admission changes only after the original assertions pass.
- Consume the complete schema proved above. Record 28 owns the bounded
  multi-table create/read profile; later operations must expand the repository
  and transaction profile together with their required typed event contracts.
- Prove filtering, population, replacement, deletion and restore through the
  unchanged selected service behavior. Include complete relational facts for
  cascading changes; physical FK success does not prove publication coverage.
- Existing-row module-set upgrades retain their separate migration obligation.
- Keep Query and cross-module links outside this step.

### First Link endpoint candidate

- Select one real non-read-only Module Link and both exact endpoint modules from
  the pinned supported source set.
- Add, compile, install, and prove the second endpoint module with Product as one
  complete configured candidate before any Link mutation; before event-intent
  admission, its executable proof is limited to schema, startup, and read-only
  repository behavior.
- Inventory every domain event emitted by the unchanged endpoint services and
  Link behavior.

### Commerce-link commit admission

- The [focused Gate B preflight](./preflight/55-shared-installation-atomic-commerce.md)
  records completed shared-installation atomic admission, followed by native Link
  characterization and explicit key/publication contract approval. No stored
  Link capability is admitted by the shared-installation correction alone.
- [Native Link characterization](./preflight/56-native-link-storage-contract.md)
  establishes the bounded native storage outcomes and approved shared declared-key,
  lifecycle and storage-owned event evidence correction. Authoritative post-write
  timestamps deliberately replace ORM stale-response/precision artifacts.
- The accepted transaction-bound Link receipt representation is the existing
  authenticated `CommerceRowClosure` and full-key `RelationalRowFact`, consumed
  once by the common finalizer. No separate `commerceLink` feed family or receipt
  brand is required solely because the row is a Module Link.
- Before the first stored Module Link writes, admit its checked schema/key/profile
  and validate native event identity/lifecycle against the actual operation-local
  storage evidence, including unchanged restores and IDs replaced by later calls.
  Neutral core tests do not admit this native Link consumer.
- Admit the exact typed event-intent contracts emitted by both endpoint modules
  and the Link behavior before executing them.
- Preserve the existing commit order and common outbox authority.

### First Module Link

- Prove any required second-endpoint mutations only after its event-intent
  contracts are admitted.
- Compile one stored resolved link with real cardinality and lifecycle.
- Enforce uniqueness/cardinality atomically in storage.
- Prove attach, dismiss, soft delete, restore, `deleteCascade`, the pinned
  duplicate/retry outcomes, and concurrency.
- Add a derived adjacency projection only if measured query or sync needs
  justify it.

### Custom repositories and Query

- Admit repository-specific relational query capabilities one use case at a
  time.
- Keep custom-query capabilities read-only; add a dedicated receipt-producing
  operation for every admitted custom write.
- Translate Medusa query shapes in the adapter.
- Preserve module-service and Query semantics.
- Do not create a public universal query AST.

### Workflows and locks

- Prove transaction boundaries around workflow steps.
- Preserve checkpoint, retry, waiting, and compensation semantics. A supported
  service call joining one transaction does not prove a whole workflow can join
  it; retain the original product-create compensation behavior as evidence.
- Do not hold database locks across workflow pauses or remote effects.
- Adapt lock and idempotency stores through their own bounded capabilities.
- Test crash, replay, duplicate delivery, timeout, and lost-response behavior.

## Migration Policy

Fresh installs compile a baseline from the admitted primary-fork snapshot and
the complete configured supported module/link set for the candidate. Later
upgrades combine structural artifact differences with explicit Medusa-owned
semantic transformations.

Historical MikroORM/Postgres migrations remain legacy-backend evidence. They
are translated only when a proven compatibility obligation requires a
particular behavior. Production startup verifies the active commerce digest
and never silently applies DDL.

## Exit Criteria For Private Integration

- The primary fork snapshot, official-upstream provenance baseline, source
  file set, modes, links, lockfile, patches, licenses, and notices reproduce
  exactly.
- The inert island remains outside the root workspace and every active runtime
  import graph.
- Every promoted package or connected capability has an accepted source map,
  bounded dependency closure, reuse classification, and retained test evidence.
- All admitted modules use module-scoped immutable preparation.
- Complete module/link compilation is deterministic.
- Runtime binds to exactly one active commerce digest.
- Unchanged claimed Medusa tests pass against the Flarex adapter.
- Real PostgreSQL proves transaction, constraint, lock, concurrency, and
  migration behavior.
- Commerce writes publish through one Flarex commit/feed/outbox authority.
- No public application API can access reserved commerce rows.
- Unsupported capabilities fail closed before startup.
- Hosted, operator, scale, observability, and production activation remain
  separate gates.
