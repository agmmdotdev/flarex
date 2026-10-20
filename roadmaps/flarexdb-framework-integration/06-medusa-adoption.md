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
profile includes the installed Sales Channel and Location–Fulfillment Set Link
graph through [137](./preflight/137-native-location-fulfillment-set-workflow.md). It retains
actual-result Link cleanup, native module lifecycle events, retained compensation
and Addresses/Inventory/Store data. Its shared composite-key reverse path keeps
active partial-index access distinct from all-row restoration. The complete
bounded Fulfillment forest participates in the same atomic root. The connected
[Shipping Option creation slice](./preflight/138-native-shipping-option-creation.md)
adds installed Provider and Pricing Links with genuine Pricing lifecycle
callbacks as implemented private bounded support.
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

The [native Shipping Option Rule batch](./preflight/136-native-shipping-option-rule-batch-workflow.md)
root and private adapter implement genuine create/update/delete branches and
retained callbacks over existing Options. The bounded profile admits zero to
four raw entries per branch, twelve distinct Rules and four selected parents,
with a named 128-call/64-event allowance. Native projection, duplicate selectors,
historical physical deletion, fresh recreation and storage-ordered deletion
events retain their separate contracts. Existing trusted queuing admits DAL
jobs without serializing native workflow branches or changing overlap/inverse
failures. The finite SDK preserves native referenced void/null envelopes and
explicit undefined StepResponse omission through private reference provenance.
The slice reuses the existing eight-table source and native validator, with no
Option/provider authority or new schema inventory. Native in-process scheduler
characterization and portable atomic settlement remain distinct evidence
boundaries. Chunked Product import and Product export remain deferred.

The [Location–Fulfillment Set slice](./preflight/137-native-location-fulfillment-set-workflow.md)
implements genuine linked creation, stored Link installation and both existing
StockLocation and Fulfillment Set deletion compositions. Creation admits one new Set and Link, preserves ignored composer
extras and accepts native missing or historical Location endpoints. Its inverse
dismisses the actual pair and physically deletes the Set. Both deletion routers
retain full native Fulfillment metadata and genuine callbacks, including the
Set inverse's repeated restoration. Complete Link history admits eight physical
rows and four distinct Sets. The approved native return-map correction selects
the first declared key actually returned, retaining traversal and writes.
Fresh Link storage keeps preflight 63's accepted active-cardinality contract
and its explicit native restore divergence. The expanded installed deletion
resource selections and Provider/Pricing closure belong to the connected
Shipping Option profile below. Additional Shipping Option/provider workflows,
populated upgrades and public/hosted activation remain separate.

The [native Shipping Option creation slice](./preflight/138-native-shipping-option-creation.md)
is implemented as private bounded support. Its genuine workflow executes both
validators, native Option upsert, Region-aware PriceSet creation, Link replacement
and the ordered creation event. Seven selected participants supply Fulfillment,
Pricing, read-only Region and Stock Location, and the full native
LocationFulfillmentSet, LocationFulfillmentProvider and ShippingOptionPriceSet
Link definitions. The selected provider is genuine Manual fulfillment; its
calculated-price refusal remains native, and external fulfillment effects are
outside this profile.

Creation admits zero to four Options, four Rules and two prices per Option,
with up to 24 normalized PriceRules and eight distinct Regions across the root. It supports flat currency
and Region prices, numeric rules, inline Types without supplied identities and
the native declared type_id reference branch. The shared graph write owner
creates an owned inline Type before binding its FK and inserting the Option and
Rules. Identity-bearing inline Type objects remain refused because native upsert
would update the referenced Type. Native creation output retains hydrated Type
and Rules, empty to-many fields and nullable to-one initialization.

The callable Query boundary executes genuine selected reads for both the
entryPoint ABI and the native Link service-name ABI. Checked native alias
selection preserves the plural availability path across a local relation and
both Location Links, including native singleton alias behavior and actual
hydration keys. The ordinary graph API keeps its existing field mask. A bounded
own positional undefined in an ID array uses native scalar coercion before
strict command capture; object undefined omission does not admit unknown
fields, arbitrary prototypes or unbounded values. Pure extraction proofs keep
the native coercion, alias merge/selection and relation initializer algorithms
with their Medusa owners.

The actual retained creation callbacks clear this root's pending external
creation event, dismiss its new Links and physically delete its PriceSets and
Options. Internal module evidence and event resource charges remain. Native
explicit compensation retains inline Types and dismissed Link history;
whole-root atomic failure still rolls back all staged participants.

Installing both new Link families also migrates the existing Stock Location and
Fulfillment Set deletion compositions together. Their complete Fulfillment
history remains four Sets, four Zones, sixteen GeoZones, eight Options and
sixteen Rules. Pricing lifecycle admits eight PriceSets, sixteen Prices and
48 PriceRules. The new Link families admit eight physical history rows and up
to eight distinct endpoint IDs; the existing LocationFulfillmentSet deletion
profile retains eight history rows and four distinct Sets. Availability reads
admit eight Locations and Providers. These lifecycle bounds remain distinct from the four-root
creation and physical creation-inverse bounds.

The routers retain complete generated native routing metadata and genuine
callbacks. Stock Location deletion reaches Pricing through actual returned
Fulfillment identities. The literal Set root soft-deletes Sets before common
Link cleanup; that already-deleted Set call yields no invented forward Pricing
cascade. Its actual retained Link inverse can restore Option-linked Pricing
history before the root's repeated Set restoration. Provider endpoints remain
protected. Only the authenticated Shipping Pricing participant selects the
existing identity-bound mixed-publication profile; other participants receive
no override. Packet ceilings, component grouping and singular settlement stay
with the existing shared owner.

The currently selected creation allowance is 512 calls, 128 events and 2 MiB of
command bytes. Both installed deletion compositions select 512 calls, 256 events,
2 MiB and the existing 30-second logical request allowance through their named
trusted profiles; shared defaults, SQL statement and lock timeouts remain unchanged.
These selections and the connected creation and installed deletion outcomes are
implemented as private bounded support. Populated upgrades, arbitrary provider
execution, public/hosted activation, Product file import and Product export
remain separate.

The [native Shipping Option update](./preflight/139-native-shipping-option-updates.md)
root also implements private bounded support for four existing Options, sixteen
active Option Rules, eight Prices, 24 PriceRules and eight distinct Regions.
Both validators, native normalization, omitted/empty distinctions, final batch
relation hydration and genuine retained callbacks remain native-owned. The
approved native compensation correction captures complete Option Rule and
PriceRule preimages and restores original identities and creation timestamps.
Explicit compensation retains native inline-Type orphans; atomic failure still
rolls back the entire root. The selected update root uses 768 calls, 256 events,
2 MiB and 30 seconds through the existing identity-bound resource API.

The shared graph owner now supports direct Link-root endpoint projection through
authenticated target reads and checked native relationship keys; captured join
paths and bounds participate in durable workflow identity. The selected Pricing
receipt correlates requested normalized prices, mutations, results and exact
read coverage. Native Pricing owns the extracted normalization algorithm. These
extensions preserve the separate creation, Product, Store and lifecycle profiles.
Public/hosted activation and populated upgrades remain separate.

The [native Shipping Option deletion](./preflight/140-native-shipping-option-deletion.md)
root implements private bounded Option→Rule deletion, actual stored Link and
Pricing cascades, raw-string workflow events and all three genuine retained
callbacks in one outer settlement. It admits zero to four raw Option IDs,
sixteen historical Rules, eight stored Link histories/eight PriceSets, sixteen
Prices and 48 PriceRules. Missing and duplicate requested IDs retain their
native workflow-message behavior independently of actual affected-row maps.
The empty branch still executes genuine Link delete/restore with the exact
private SDK void marker; the public input remains strict `{ ids }`.

Retained inverses preserve native historical revival rather than snapshot undo.
Conflicting historical Link restoration remains an atomic refusal under the
accepted scalar-Link invariant; caught native Pricing cascade errors remain
atomic root failures under the existing authenticated tuple/sticky-refusal
boundary. The selected root uses 512 calls, 256 events, 2 MiB and 30 seconds
through the existing identity-bound API. Shared Fulfillment routing metadata
and lifecycle owners also retain the existing Set/Zone profiles and bounds.
Fresh private installation is reused without a new schema or migration;
public/hosted activation and populated upgrades remain separate.

The [native Fulfillment creation](./preflight/141-native-fulfillment-creation.md)
root is implemented for one private local Manual fulfillment, an optional
delivery Address, up to four Items and four Labels. Genuine singleton Location
Query, provider creation, exception cleanup and retained native cancellation
borrow one outer settlement. Signed/fractional quantities, original creation
DTOs, provider-updated storage, optional-field omissions and native cancellation
guards remain distinct. Historical Shipping Option visibility masks read DTOs without
rewriting stored FKs. The named profile uses 128 calls, the existing 64-event
and 1 MiB limits, and a 30-second command lifetime.

Fresh composition selects the complete twelve-table native Fulfillment source;
the integrated Shipping Option consumers reuse it. Real standalone eight-table
consumers retain their named selection. This is no populated-source upgrade.
Public/hosted activation, external providers and broader Fulfillment workflows
remain separate.

The [physical reference-detachment preflight](./preflight/142-native-shipping-option-reference-detachment.md)
implements the named fresh twelve-table Option/Zone/Set inverse profile against
unchanged default native PostgreSQL. Direct Option deletion agrees across both
native backends; referenced parent cascades succeed on PostgreSQL and roll back
with an FK error on comparison-only Drizzle. Original comparison outcomes are
preserved, and no Drizzle-cascade parity is claimed. Shared lifecycle metadata
selects exact native nullable references; the core eager operation authenticates
same-call deletion and complete current, pending and historical source selection.
It clears only the FK while preserving source timestamps and emits no source
update event. The actual retained inverses and the combined native
Option/Fulfillment preparation support later reads, cancellation and target
recreation without reattaching sources. Existing eight-table selections and
terminal Product/ShippingProfile set-null contracts remain unchanged.
Independently durable execution, populated source upgrades and public/hosted
activation remain separate gates.

The [native standalone Fulfillment cancellation](./preflight/143-native-fulfillment-cancellation.md)
root admits one ID using only the existing authenticated cancellation method,
normal resource limits and the fresh twelve-table source. Genuine eligibility,
provider lookup, idempotence, module events and void workflow output remain
native; its retained step ID supplies no business inverse. Private late-failure
rollback remains an outer settlement obligation. The existing metadata-derived
DAL and receipt preserve historical Provider/Address owning ID references,
Shipping Option visibility masking, and native read-versus-assignment nullable
FK presentation. No extra query, transaction, schema or source lineage is added.
Public/hosted activation, populated upgrades and external providers remain
separate.

The [native Fulfillment shipment](./preflight/144-native-fulfillment-shipment.md)
root admits one existing ID, zero to four complete new Labels and an optional
shipment marker. Genuine shipment guards, nested update, native collection order
and retained step compensation use the existing local Fulfillment constructor
and twelve-table source. The selected root borrows only retrieve/update methods.
The approved [update preimage correction](./preflight/147-native-fulfillment-update.md)
retains complete Labels for both empty and nonempty replacement. Authenticated
same-root reconstitution restores both original timestamps; the earlier native
projected-preimage recreation branch remains comparison evidence. Empty
replacement and active-only membership are explicit shared graph policies.
Other reconstitution consumers retain their selected timestamp policies.
The named shipment allowance uses 128 calls with the normal 64-event, 1 MiB and
ten-second limits. No extra Query, lock, provider call or schema is introduced.
Public/hosted activation and populated upgrades remain separate gates.

The [native Fulfillment delivery](./preflight/145-native-fulfillment-delivery.md)
profile implements one existing Fulfillment with up to four Items and four
Labels through the genuine durable parent and stored synchronous update child.
Both run outside SQL. Three short authenticated commerce calls perform native
count-free singleton Query, preimage retrieval and update; confirmed settlement
precedes native release. The local factory retains the same twelve-table source.
Its explicit list-result capability never supplies a synthetic count; consumers
requiring counts refuse list-only reads. The combined Option/Fulfillment factory
is outside this singleton profile.

The existing Task owner supplies input commitments, grants, heartbeat, subject
replacement/revocation, cancellation and completion. Its CAS compound checkpoint
codec stores the native parent and one child under the existing 1 MiB cap.
Genuine current control invokes the retained native null-assignment inverse;
only that exact command admits Task control. Each commerce child reuses the
shipment 128-call allowance with normal 64-event, 1 MiB and ten-second limits.
Native guard ordering, full DTOs and original compensation remain preserved.

The real native Locking module and static in-memory provider execute through
the existing callback journal, with the explicitly approved transaction-derived
owner on acquire, release and retained compensation. The host binding owns their
lifecycle and close. Ordinary database work requires a same-host, same-subject
acquisition observation with conservative monotonic age below ten seconds;
callback receipts confer no live claim. Lock waits hold no SQL loan.

Cold terminal recovery can finish event policy without repeating business writes
or acquisition. A fresh ordinary subject refuses in-flight work based on an old
acquisition receipt. Forward events remain held until successful terminal policy;
cancellation clears held inverse events and preserves already published forward
events. In-flight reacquisition, full host/provider restart, distributed
exclusion, resource fencing, general coordination, Order delivery, populated
upgrades and public/hosted activation remain separate. Product chunked file import
and Product export remain deferred.

The [native Return Fulfillment creation](./preflight/146-native-return-fulfillment-creation.md)
root implements one local Manual creation with up to four Items and four Labels,
using the same twelve-table source, singleton Stock Location Query and creation
admission owner as ordinary Fulfillment creation. Its selected native method
retrieves the active Shipping Option's `id`, `name`, `data` and `metadata` after
insertion. That internal capability is read-only and bound to the created root;
it adds no graph alias, Option mutation, schema or separate module constructor.
The mixed Option/Fulfillment constructor retains its existing methods.

Native Manual data merging, persistent input Labels, detached initial DTO and
ordinary retained cancellation remain preserved. The native independent-
transaction witness retains the residual graphs from failed post-create Option
retrieval. No native cleanup correction is selected; a failed Flarex atomic root
publishes no staged graph or event through its existing settlement owner.
Return creation reuses 128 calls, 64 events, 1 MiB and the thirty-second command
deadline. The finite callback's transaction-covered classification does not
admit delayed compensation or a durable Return scheduler. Order/Return modules,
external providers, populated upgrades and public/hosted activation remain
separate gates.

The [standalone Fulfillment update](./preflight/147-native-fulfillment-update.md)
root implements all declared update fields and the connected module/Shipment
Label branch through the existing twelve-table constructor and authenticated
retrieve/update pair. Its approved finite/durable preimage correction selects
whole JSON values and complete Labels. Standalone execution is finite and
atomic, retaining the existing 128-call allowance and ordinary event, byte and
deadline limits. Native JSON merging and introduced-key cancellation residuals
remain preserved; exact JSON snapshot restoration is a separate native contract.

The native DAL assignment seam handles constructor-bearing JSON consistently
for ordinary/Return creation and updates; recursive own `__proto__` remains
outside its supported domain. Explicit shared replacement policies admit
identical existing owned references and managed update-time signals without
caller timestamp authority. Actual filtered hasOne hydration retains native
root update events while preserving stored reference identities. Shipment and
Delivery retain their own bounded contracts; no endpoint mutation, provider,
Query, delayed compensation or hosted activation follows from this root.

The [native Product–Sales Channel membership](./preflight/148-native-product-sales-channel-membership.md)
root manages existing endpoint identities with up to four raw additions and
four raw removals. It reuses the selected Link constructor and only its
create/dismiss methods; endpoint reads/mutations and graph access are absent.
Native order, duplicate refusals, tombstones, replacement IDs, batched events
and asymmetric empty inverses remain preserved. Retained definitions can
create an originally absent pair or dismiss an existing attachment; this is
native compensation, not snapshot restoration. Failed finite roots retain
atomic rollback and publication through the existing owner. Default concurrent
callbacks retain OCC rather than selecting scope exclusion; normal call,
event, byte and deadline limits remain unchanged. The earlier authored
endpoint-creation workflow remains a distinct consumer. Durable scheduling,
delayed compensation and public/hosted activation remain separate gates.

The [native Price Preference creation](./preflight/149-native-price-preference-creation.md)
root admits zero to four raw attribute/value inputs through the existing
Pricing factory. Its shared `pricing-price-preferences` profile owns complete
DML-derived preference rows and receipts for both ordinary creation and Store
workflows; Store pair lookup/upsert grammar remains separate. The root selects
only creation and physical deletion, with graph access off. Native empty calls,
nullable values, tax defaults, raw case, nulls-distinct uniqueness, retained IDs
and physical cancellation remain preserved. The existing physical lifecycle
uses canonical selected-row order where native deletion has no ordering promise.
Native public DTOs remain unchanged; the checked private boundary admits the
witnessed nullable runtime inputs and refuses managed caller fields. Normal
64-call/64-event, byte and deadline limits remain unchanged. Region lookup,
other Pricing methods, providers, durable scheduling and public/hosted
activation remain separate gates.

The [native Price Preference update](./preflight/150-native-price-preference-update.md)
root is implemented for bounded private execution. Its explicit profile uses the
[PostgreSQL predicate owner](../shared-logical-storage/68-postgres-relational-predicates.md),
core-produced selected identities, sparse retained preimages, dirty-row events
and the original inverse upsert. Store and creation retain their own grammars;
the preference write owner preserves native equal-value no-ops across them.

The [native Price Preference deletion](./preflight/151-native-price-preference-deletion.md)
root is implemented for bounded private execution. It includes
native soft deletion, raw-ID restore compensation and required empty-family Link
deletion/restoration calls, including empty inputs. The original compensation
can restore previously deleted requested rows; that native behavior remains
explicit rather than being silently corrected in the adapter.

The [native Price List creation](./preflight/152-native-price-list-creation.md)
root is implemented for connected bounded private execution. The
connected branch includes stored Variant–PriceSet validation, complete Pricing
graphs and retained physical deletion. Original defaults, generic rules,
deduplication, complete DTOs and root-only inverse events remain native-owned.
Existing resource limits remain unchanged. Historical inverse cleanup uses the
shared resource bounds while protecting unrelated Pricing and stored Links.

The [native Price List update](./preflight/153-native-price-list-update.md)
root is implemented for connected bounded private execution. The selected
Pricing-only profile uses list/update with graph
access off. Its contract retains sparse union preimages, fresh replacement
Rule IDs, all-history orphan deletion, unchanged root timestamps and updated
actions for equal/ID-only upserts. Shared graph ownership supplies existing-root
upsert and authenticated global child-deletion order; the portable SDK retains
the original implicit-void composer. Null description reaches the native update
and nonnullable DML refusal; the bound service and outer workflow retain sticky
rollback-only behavior. Existing resource limits remain unchanged. The actual
two-step root and retained callbacks have separate bounded execution proofs.

The [native Price List deletion](./preflight/154-native-price-list-deletion.md)
root and private adapter admit zero to four raw IDs through Pricing soft
deletion/restoration and the required empty-family native Link calls. The bounded
contract preserves historical-descendant restamping, complete unmapped ListRule
objects, raw-ID restoration, original retained callbacks and zero restore events.
It uses the approved Price List → Price → List Rule → Price Rule group order and
a named 128-call allowance through the existing identity-bound API. Events remain
limited to 64; all other limits and profiles remain unchanged. Native MikroORM
flushes interleave those families; the unchanged native baseline remains separate
from this portable contract. Shared publication preserves the actual emitted
sequence.

The [native Price List Price creation](./preflight/155-native-price-list-price-creation.md)
root and private adapter admit zero to four List entries, two Prices per entry
and two raw Rule attributes per Price, using up to eight raw Variant selectors
over four distinct stored Link endpoints. The connected branch uses only Pricing
List reads, add/remove and genuine stored Variant-PriceSet Query. The approved
native DAL correction and shared native planner preserve existing/mixed reuse,
sparse duplicate response positions, managed stamps and native events. Reused
existing Price IDs retain their destructive physical inverse, including complete
all-history Rule cleanup and root-only deletion events. This profile alone
selects the approved storage-insertion-ordered deletion cohort. Its named
128-call allowance retains 64 events and all other default limits. Empty Rule
records retain the private invalid-input refusal and rollback boundary. General
Price List Price removal and batch roots remain separate admissions;
the unchanged native baselines remain separate from the approved portable
contract. Hosted activation, external delivery and arbitrary scale remain gated.

The [Price List Price update](./preflight/156-native-price-list-price-update.md)
root and private adapter implement the same bounded List/Price/Rule input graph.
The approved native correction captures complete Price/Rule preimages, restores
original native IDs and managed content, and removes only genuinely created
Prices on cancellation. Repeated committed replacement and compensation preserve
retired Application identities through the shared recorded-row replay owner.
This profile selects approved storage-insertion order for active candidate Rules;
native matching, input order and ID-ordered snapshot history retain their owners.
Its named 128-call allowance includes the retained inverse, with 64 events and
all other limits unchanged. Original native defects remain separate witnesses.
Standalone concurrent native execution, unbounded history and hosted delivery
remain outside this admission; ordinary PostgreSQL timeout reliability remains
unproven.

The [native ShippingProfile creation](./preflight/135-native-shipping-profile-create-workflow.md)
root and private adapter implement the bounded portable slice.
The genuine creation step remains unchanged and returns complete native rows,
including creation-only empty shipping_options initialization. The existing
private creation repository and its consumers migrate at that owner; the authored
Product/ShippingProfile workflow still returns its own scalar Query projection.
No parallel omission-compatibility profile or persisted inverse-relation field
is introduced. Native scalar list/projection/update results remain distinct.

The selected root admits zero to four creates and retains their actual IDs for
physical deletion. That inverse runs the genuine active Option guard, then
imperatively detaches nullable Option references across history while preserving
Option timestamps and emitting only Profile deletion events. Its existing
validation cohort is bounded to eight Options; complete historical detachment
uses the shared reference/materialization/resource bounds rather than an
invented eight-child physical ceiling. The physical FK stays NO ACTION.
The neutral [fan-out owner](../shared-logical-storage/28-core-relational-fanout-transition.md)
implements explicit timestamp mode, born/delete targets and read-only source
observations; Product consumers retain advance and Profile
selects preserve. Matching pending source mutation and post-plan reads/writes
remain unadmitted. The selected profile retains 64 calls and 64 events: the full
four-create plus genuine retained inverse consumes 36 calls and eight events on
both drivers, and the mixed four-Profile/eight-Option physical inverse consumes
21 calls. Existing source lineage and required Option schema are
reused; no populated upgrade, provider, Link or public/hosted activation follows.

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

The [native Shipping Option Type creation](./preflight/128-native-shipping-option-type-create-workflow.md)
slice admits zero to four Types under the existing optimistic 64-call/event
profile. It reuses the installed six-table source
and genuine Fulfillment constructor, with native scalar insert semantics,
empty-to-many result initialization, the named creation hook and separate module
and workflow events. Its retained inverse physically deletes bounded Type IDs;
required Option references, including soft-deleted Options, refuse deletion
through the shared reference owner without partial settlement. Wider Shipping
Option/provider execution retains its separate admission gates.

The [native Shipping Option Type update](./preflight/129-native-shipping-option-type-update-workflow.md)
slice admits four selected Types and one possible outside retarget under the
existing optimistic 64-call/event profile. It preserves native projected preimages,
selector order and explicit ID retargeting, including an outside target's
retained-inverse limitation. Type compensation uses genuine insert-or-update,
with native tombstone, missing-row and ID-only event behavior; creation's empty
to-many presentation does not apply to scalar update/list/upsert results.
Exact shared read evidence authenticates complete selector/target queries and
each sequential physical upsert read. A distinct identity-bound shared write
mode preserves native tombstones and advances managed update time without changing
ordinary upsert or granting lifecycle authority to the native resource.

The [native Shipping Option Type deletion](./preflight/130-native-shipping-option-type-delete-workflow.md)
slice admits zero to four raw Type IDs with the existing optimistic 64-call/event
profile and installed six-table source. It preserves the real paginated active
Option guard, raw-ID hook/workflow events, genuine empty Link delete/restore and
parallel event sibling. Historical indexed candidates remain authenticated read
evidence while only active Options contribute to the guard's actual count/page.
Type soft deletion preserves Option rows and FKs. The native raw-ID inverse can
revive Types deleted before forward execution and retimestamps already-active
matches; a distinct identity-bound logical active-restore selection supplies
that write while existing profiles retain their authenticated no-op behavior.
Native inverse capabilities remain bounded separately from exact failed-root
rollback; arbitrary Option workflows, custom Type Links and hosted activation
remain unadmitted.

The [native Service Zone creation](./preflight/131-native-service-zone-create-workflow.md)
slice admits zero to four Zones with up to four new GeoZones each, covering all
four native geographic types under existing FulfillmentSets. It reuses the
genuine native workflow, validation and constructor through a fresh eight-table
composition in the existing source lineage. Native module-event infrastructure
remains mandatory even though the root has no external workflow event or hook.
Returned child order, actual empty relations and parent-FK semantics stay native.
Its bounded physical inverse removes complete history for four Zones, sixteen
GeoZones, eight Options and sixteen Rules, with root-only native delete messages
and unchanged FK targets. Both complete root-plus-inverse and historical inverse
use the existing optimistic 64-call/event profile. Profile update and Type
creation can execute sequentially on the same installed binding; duplicate participants
for that source in one atomic root remain unadmitted. Populated schema upgrades,
public/hosted activation retain their separate gates.

The [native Service Zone deletion](./preflight/132-native-service-zone-delete-workflow.md)
slice admits zero to four raw Zone IDs with complete historical closure for
sixteen GeoZones, eight Options and sixteen Rules in the same eight-table source.
The genuine raw-ID restore inverse can revive previously deleted roots and
descendants beyond the forward changed set. Reached historical children are
re-deleted, and already-active restore matches advance update time; native
deleted/restored message families and checked model-group order remain intact.
Within-family SQL order remains unspecified. The complete maximum root plus
genuine retained inverse selects the scoped identity-bound optimistic
256-call/128-event profile through the existing trusted resource API; all other
profiles and resource limits remain unchanged. It reuses the selected logical
active-restore capability and shared graph receipt owner without a new core
mechanism or schema upgrade. Global active-name restore conflicts retain full
atomic refusal through the typed host error boundary, distinct from native
backend SQL error formatting. Module-only event infrastructure remains required.
General Shipping Option/provider workflows, populated upgrades and public/hosted
activation remain unadmitted. Chunked Product file import and Product export
remain deferred.

The [native Service Zone update](./preflight/133-native-service-zone-update-workflow.md)
slice admits zero to four selected Zones, sixteen current GeoZones including
history and four replacement entries per Zone. It preserves genuine scalar
updates, all four geographic types, projected originals, JSON reference-driven
child writes and insertion-order relation hydration. Complete old/new replacement
covers thirty-two distinct Geo identities. The genuine retained inverse removes
new children but refuses old IDs that forward execution physically deleted;
that refusal makes a containing atomic root rollback-only. A separate named
128-call profile admits the complete root and inverse; the default event and
other resource limits remain unchanged.

The neutral [insertion-generation contract](../shared-logical-storage/67-insertion-generation-order.md)
owns protected revision metadata, root-global allocation, accepting-commit
assignment and explicitly selected complete indexed ordering. Additive physical
migration 149 leaves old generations unknown; it does not backfill order or
admit a populated framework schema upgrade. Zone creation/deletion and existing
Product/Store replacement profiles retain their behavior. General Shipping
Option workflows retain their separate preflight gates.

The [native Fulfillment Set deletion](./preflight/134-native-fulfillment-set-delete-workflow.md)
slice supports zero to four raw Set IDs and the complete aggregate history of
four Sets, four Zones, sixteen GeoZones, eight Options and
sixteen Rules in the same eight-table Fulfillment source. The genuine root keeps
serial Set soft deletion then common Link cleanup; its retained callbacks restore
Link then the exact raw Set IDs. Historical roots can be skipped forward yet
revived by that broader native inverse, and reached historical descendants and
already-active restores retain native timestamp writes and deleted/restored
events. The installed LocationFulfillmentSet composition in
[137](./preflight/137-native-location-fulfillment-set-workflow.md) selects a scoped
identity-bound 512-call/256-event profile for the complete root and genuine
retained callbacks. The actual stored Link router preserves mandatory empty
endpoint calls and full native Fulfillment metadata.
Module event infrastructure and active-restore policy remain required. Shared
Fulfillment receipts authenticate actual final observations against final
mutation afterimages separately from planning preimages for both Set and Zone
lifecycle consumers. Linked Set creation and both deletion migrations share
137's connected outcome. The installed Provider/Pricing Link migration and native
Pricing lifecycle are implemented by [138](./preflight/138-native-shipping-option-creation.md)
within the private bounded profile described above. Further Shipping
Option/provider workflows, populated upgrades and public/hosted activation remain separate;
chunked Product file import and Product export remain deferred.

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
