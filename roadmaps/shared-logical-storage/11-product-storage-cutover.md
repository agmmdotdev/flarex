# Product Through Shared Logical Storage

Status: active cutover preflight under the shared-storage standing approval;
complete generic definition preparation is implemented, runtime cutover pending.
This is the next connected commerce cutover after Currency. It does not activate
Product or retire its physical installation until the named native consumers and
durable-data disposition pass the gates below.

## Outcome And Current Evidence

Run the complete pinned Product model graph through the shared logical candidate,
generic row/index/claim/relation families and the existing native Product service
and workflow methods. Preserve one selected Product writer per binding and one
outer settlement/publication owner. No shop or deployment receives a generated
Product table set in the replacement profile.

`compileProductDefinition` already captures the full native graph: Product,
Variant, Option, OptionValue, Type, Tag, Collection, Category, Image, image
assignment and their pivots (13 tables). `makeSchemaComposer` can authenticate
that graph as `medusa.product`, but this is candidate preparation, not executable
Product storage. The running `productRepository` obtains table operations through
the physical commerce profile. The shared relational participant executes
Currency's scalar table and a neutral composite-key source. It now admits
source-local single-text Product foreign keys through shared indexed row
observations and final working-set validation. `compileLogicalRelationalRead`
admits the first text identity member for
bounded indexed selection, not Product's complete graph query contract.
Complete public Product graph, population, lifecycle and service queries cannot
be routed through those contracts unchanged.

The first connected definition step now compiles all 56 native Product ordered
requirements, three implicit FK reverse access paths and 24 unique requirements
through the shared catalog. Its
bounded 32-bit `rank` values lower through the existing exact float64 order;
the relational row owner canonicalizes signed zero before storage and key
derivation, and rejects noncanonical stored integer rows. Integer query
operands remain outside the current text-key read profile and must use the
same canonicalization before that profile is expanded. Canonical UTC
millisecond timestamps are also admissible to that compiler,
while numeric uniqueness and JSON key ordering remain refused. The complete
Product/Currency candidate installs these definitions without Product DDL on
PGlite and ordinary-role PostgreSQL. Complete shared builds and readiness now
pass on both drivers; public Product command selection remains pending.

The row-identity slice recognizes a table's declared primary text key or,
when no primary exists, its sole nonnullable composite text unique key. This
is the actual shape of Product's three implicit pivots. The shared working set
uses the whole tuple for exact lookup, duplicate admission, update and deletion;
the existing generic unique claim settles conflicts. It does not invent a
synthetic pivot ID or a Product-only storage path. Native deletes of composite
rows pass a complete key object; the single-key string form remains for scalar
tables. A bounded read may order and filter on the first tuple member through
the key's generated ordered prefix, with internal row identity breaking
ties. A neutral logical commerce host exercises empty initialization, two rows
with the same first member, duplicate rejection, upsert and exact-pair deletion
on PGlite and ordinary-role PostgreSQL. The pinned Product schema proves all
three pivot declarations match this identity rule. Product's module-local FK
kernel is now implemented, while public command selection, remaining query
shapes and rich Links are the next connected gates. A new pivot-specific ID,
partial Product activation or a scan
fallback would obscure that missing core obligation.

The indexed relation-lookup slice extends the same bounded reader to any
declared unconditional text-index prefix. Native Product population selects
child and pivot rows by foreign-key columns, which may not be the row identity's
first member; the previous key-only compiler refused those lookups. Boolean
`and` chooses one bounded indexed candidate set and checks the full predicate;
`or` unions each branch's indexed candidates and deduplicates row identities.
Non-indexed text membership still refuses. Bounded results can order by a
nonnullable text column independently of the selecting index. A neutral commerce
host exercises reverse pivot lookup, mixed-index Boolean selection and a
secondary-index read after an upsert in the same request on PGlite and
ordinary-role PostgreSQL. The pinned Product pivots declare indexed access to
both endpoint columns. This changes the shared query contract used by Currency,
whose native list/count regression remains required. Scalar FK values now have
an admitted source-local execution profile; cross-framework authorization and
rich Links still need their distinct shared relation contracts. The physical Product query host remains its
named consumer until that cutover.

The [module-local FK preflight](./13-module-local-foreign-keys.md) owns the
native-key, reverse-index, cascade and contention gates. Product's three
undeclared child-side reverse paths now install through shared definitions;
the shared working set enforces their admitted single-text FK profile. A
complete Product build/readiness and committed Variant cascade kernel witness
passes on both database drivers; the native internal service selection below
does not yet exercise that FK graph through public Product methods.

The conditional-index read cutover admits a text index conditional on a null field
only when the query branch itself requires that field to be null. This is needed
for Product's active-handle lookup; the prior reader recognized only unconditional
text prefixes. The shared Boolean planner carries each branch's proven null
conditions into index selection, including nested `and`/`or`, and continues to
refuse an unindexed branch rather than scan. A neutral commerce source shows
active and inactive rows, pending updates, a branch-local condition, and refusal
of handle lookup without the active condition. The core reader and its existing
index/revision settlement own this behavior; the Medusa adapter gains no query
fallback. This changes no public API or durable format and leaves Product's FK
and graph serving refusal intact.

The first native selection witness now composes Product and Currency with
Application and Payload, builds the full Product candidate, and selects
`medusa.product` in a logical commerce host. The pinned internal Product
service creates, retrieves, updates, lists, soft-deletes and restores a row
through shared storage. A duplicate active handle rolls back, a replay returns
the committed outcome, and no physical Product table is created. Multi-table
initialization now probes live current rows across every selected source table
before seeding, so a second step cannot treat a populated Product source as
empty merely because its first `image` table has no rows. The probe uses shared
scope/table row identity and exact revision tombstone state in the same
transaction, avoiding full catalog counts. This is a
bounded service-path proof on PGlite and ordinary-role PostgreSQL, not public
Product or workflow activation. The test's optional Product source in the
Currency fixture exists only to compose the full candidate; Currency retains
its own source and initialization.

The existing initialization input has no table discriminator. A source with
multiple tables therefore admits only an empty seed; a nonempty multi-table
seed refuses before writing to the first table. Future nonempty multi-table
initialization needs its own explicit source/table contract rather than
inferring a target from table order.

The internal-service slice reuses the native internal service and shared commerce
settlement because they already own the needed semantics. A Product-only DAL,
adapter SQL path, partial graph installation or compatibility writer would
duplicate authority. It changes no durable format or public contract and
removes no physical Product consumer. The following tag-workflow slice adds
logical Product mutation-event validation. The physical Product profile remains
the named owner of other public Product tests and runtime calls until their
graph, lifecycle and event paths are proven. That retained
path is removed with the complete Product cutover and an explicit data
disposition; no production switch is implied by this witness.

## Logical Product Event And Tag-Workflow Slice

The pinned `createProductTagsWorkflow` now runs with logical Product and
logical Currency under the existing atomic commerce owner. The earlier
internal-service witness could not admit Product module events because only
the physical participant could compare messages with row facts. The outer
workflow event/result check alone cannot establish that a claimed ID was
actually inserted.

The shared working set now retains bounded before/after observations from its
validated writes. The logical participant authenticates and projects them by
selected source. Atomic execution validates the Product module messages before
the one event/publication closure settles. The Product adapter owns the
tag-created interpretation; core has no Product names. Its first policy admits
the native tag-create call followed by optional read-only calls and requires
every tag insert to match exactly one created message. A forged message ID
refuses the whole request without a row or event publication. The physical
fact policy remains for named physical Product callers until their cutover.

The private atomic participant policy now has a logical fact validator beside
the physical one. A logical event-producing member without that validator is
refused; Currency remains event-free. Native tag creation, row/event
correlation, replay and mismatched-event rollback pass on PGlite and
ordinary-role PostgreSQL. The existing mixed physical Product/logical Currency
workflow also passes. This is one bounded public Product workflow proof; other
Product commands, complete graph and lifecycle behavior, Links, two-scope
isolation and concurrency remain at the gates below. There is no new durable
format, second settlement path, old Product data migration or production
switch in this slice.

The physical profile is constructed in `product-schema.ts` and
`product-profile.ts`. Its active test consumers include the Product runner and
local service, installation, relationship, SalesChannel, ShippingProfile,
ProductTag, Variant/Image and Variant/Pricing workflow suites. The mixed
Category/Currency fixture is another explicit physical Product consumer.
`product-runtime-metadata.ts` derives the supported graph and population paths
from pinned DML; it is the adapter-side semantic inventory, not a replacement
core schema or permission to infer every Link as a foreign key.

The [Currency cutover](./10-currency-storage-cutover.md) proves generic Currency
beside retained physical Product under one atomic owner. It is not a Product
storage proof. Its fully admitted PostgreSQL overlap passes; the earlier
tracer-at-entry timeout during unfinished admission remains unexplained and is a
separate concurrency gate before any broad throughput claim.

## Product-Tag Update And Delete Slice

The pinned `updateProductTagsWorkflow` and `deleteProductTagsWorkflow` now run
through the same selected logical Product source as tag creation. Their native
selector update and soft-delete methods use the existing shared before/after
attempt and trusted call-mode observations. The Product-owned logical event
policy admits exactly one tag write, correlates its module messages with the
actual inserted, updated or active-to-deleted row transitions, and permits
read-only hook calls with no mutations or module events. The native workflow's
deletion event for a requested missing ID remains distinct from module events
for actual row transitions.

The first review exposed an unrelated-row dependency in the existing Product
lifecycle reader: it scanned every tag before filtering a requested ID. The
Product lifecycle owner now selects root IDs through the shared indexed row
reader, so deleting one tag still works when the logical tag catalog exceeds
the 128-identity request bound. The bounded refusal remains for a genuinely
overlarge selected set. The subsequent indexed lifecycle selection below
covers the related-row loads. Neither slice claims general Product lifecycle
scale.

The private workflow registration types now admit a selected logical Product
source. Native no-match updates, pending hook reads, multi-row deletion,
replay, conflicting multi-row updates and forged module-event rollback are
covered on PGlite and ordinary-role PostgreSQL, alongside the existing
physical workflow regressions. The physical Product policy and fixtures remain
for named unmigrated consumers. No second writer, storage fallback, Product-
specific row query or production activation was added. Broader Product,
relationship, Link and migration retirement remain at their existing gates.

## Indexed Product Lifecycle Relation Selection

The next connected Product gate is lifecycle traversal beyond the selected
root. The pinned service must soft-delete and restore owned images, options and
variants, hard-delete owned rows and pivots, reject a category with active
children, and detach nullable Product references when deleting a type or
collection. The existing adapter read whole related tables before filtering;
one selected Product could therefore fail because another Product had more
rows than the request's identity bound. The shared relational core already
admits source-local foreign keys with indexed reverse access. The correct
replacement is to select each declared reference by its source column and
parent key, preserving Medusa's cascade/event choice and core's bounded read,
pending state, FK validation and settlement authority. A new generic scan
exception or Product-specific SQL would duplicate that owner. Composite or
unindexed references outside the admitted profile must still refuse.

This slice replaces the lifecycle planner's unqualified category, child and
Product-reference loads with reverse selections. It keeps the pinned native
service and physical Product regression surface until the public logical
Product commands, graph queries and event policy move together. The direct
logical Product witness places more than one request's worth of unrelated
images beside a selected image and proves soft-delete/restore touches only
the selected relationship. The existing physical native lifecycle suite
remains the behavior witness for graph facts, events, rollback and deletion.
Review and both database-driver runs are required before this slice closes.

## Native Simple Product Creation Slice

The next public Product boundary is Medusa's `createProductsStep` with its
already-admitted scalar `{ id?, title }` input. The private Product workflow
binds that native step to the selected Product source and reads the resulting
IDs through the pending graph before the atomic root settles. The Product
event policy validates the sole `productCreate` write call, its exact inserted
Product rows and matching native `product.product.created` messages against
the same logical attempt transcript. It reuses the tag policy's single-entity
mechanics without granting a graph-wide or multi-command event contract.

This is a connected public service and workflow cutover, not a new storage
owner. It changes no durable format or supported Product API. The physical
Product profile remains for the named graph, lifecycle, Link and other
unmigrated consumers; no dual writer is introduced. The logical witness
requires pending Product graph reads, one publication with native module
events, replay without duplicate writes, active-handle conflict rollback and
no generated Product table. The owned graph admission below extends this
same selected workflow and event policy.

## Native Owned Product Graph Creation Slice

The next connected Product step extends that same native `createProductsStep`
selection to owned images, options and values, variants, and variant/value
pivots. The checked workflow input follows the pinned service's actual create
normalization: it admits optional image and variant IDs, but not an option ID
that the native service discards. External tags, categories, collection/type
links, and other Product commands remain outside this admission.

One `productCreate` call must account for every inserted entity and pivot in
the logical attempt. The Product event policy matches native created messages
to the entity facts and requires each child to trace back through declared
foreign keys to an inserted Product root; each pivot's variant and value must
belong to the same root. The workflow reads images, option values and variant
options from the pending graph before the atomic owner settles. Shared logical
relational reads admit non-null integer ordering so the native image `rank`
order can be read without a Product-only storage path.

This changes the private workflow input, output and event admission, plus the
shared relational read grammar. Existing scalar creation remains admitted.
The physical Product profile remains for named unmigrated lifecycle, broader
graph, Link and relationship consumers. Completion requires PGlite and
ordinary-role PostgreSQL graph/replay/rollback evidence, Product regressions,
type and lint checks, review and removal of displaced scalar-only descriptions.
Bounded complete population and overflow behavior, broader Product commands,
and general Product serving readiness remain later gates.

## Native Product Read And Population Slice

The selected logical Product source admits the native public `listProducts`,
`retrieveProduct`, and `listAndCountProducts` methods. A filtered Product
request reads its indexed root
set and owned image/option/value/variant relations without requiring an
unrelated Product or child catalog to fit in one request. Count must describe
the selected roots before population, and page order must remain native. An
unfiltered or overwide selection may still refuse at the shared resource bound;
this slice does not claim general large-catalog pagination or complete-count
overflow support.

The existing core relational reader and Product query owner serve the request.
The two-driver public-service witness selects one Product, its ordered images,
option values and variant options beside 130 unrelated Product roots and 130
unrelated images. It checks native list/retrieve/count, filtered page/count,
and soft-deleted visibility. This proves indexed confinement for that selected
shape, not general large-catalog serving. The physical Product profile remains
for lifecycle, broader commands, Link and relationship consumers, with retirement gated on
their cutovers. No durable format or public contract changes.

## Native Product Lifecycle Observation Slice

The public Product soft-delete and restore commands now run through their
native service, owned cascade, and module events on the selected logical
source. The physical store already gave its event policy a storage-owned
lifecycle observation when restore selected an active row and made no update;
the shared logical closure now records that distinction too.

The trusted logical working-set closure retains charged, immutable
before/after lifecycle observations. The atomic owner passes them alongside
the attempt transcript to the logical event validator. The Product validator
admits only the public `productSoftDelete` and `productRestore` commands,
correlates every owned entity event to its observation and changed attempt
when present, and rejects unrelated writes or invented messages.
The native Product service, cascade planner, generic relational storage,
single settlement owner and physical behavior witness remain authoritative.
This breaks only the internal logical validator signature and closure shape;
its callers migrate in the same slice. No durable format or public API changes.

The selected native-service proof covers owned Product graph soft-delete and
restore, module events, repeated-request replay, active restore with events
but no row update, active-handle conflict rollback, and forged-event refusal.
It does not complete hard deletion or general Product serving. The physical
profile stays for the named
unmigrated Product commands, Link, and relationship consumers; retirement
still requires their cutovers and approved data disposition.

## Native Product Hard-Delete Slice

The pinned public `deleteProducts` service removes an owned Product graph and
its variant/value pivot but emits only the original Product root's deleted
message. The existing physical profile proves that behavior. The selected
logical source now runs the same native command; the shared working set records
each deletion as an authoritative tombstone revision before publication.

The Product-owned logical event policy matches root messages to deleted
Product attempts, proves each option, value, variant, image and variant/value
pivot belongs to a deleted root through declared keys, and refuses unrelated
mutations or invented events. The native service and shared FK, unique,
resource, recovery and settlement owners remain in place; this adds no Product
SQL or second delete path. This selected logical policy breaks no durable format
or public contract. Other Product links and command families retain the
physical profile until their own cutovers and approved data disposition.

The selected witness covers a native owned-graph delete, root-only event
publication, replay without duplicate effects, owned current pointers advancing
to tombstone revisions, late-refusal rollback, absence through public
with-deleted reads, and forged-event refusal. The retained physical Product
deletion test stays the source behavior witness; the selected graph proof does
not claim Product-to-tag/category pivots, external Links or general runtime
serving readiness.

## Product Tag And Category Membership Slice

The pinned Product service normalizes `tag_ids` and `category_ids` to
references to existing ProductTag and ProductCategory rows. The checked Product
schema declares separate join tables with cascading Product foreign keys. The
selected logical create workflow now admits those references beside the owned
image/option/value/variant graph. Its pending graph read and public native
Product read return both memberships. A selected native Category root-creation
command supplies a real target beside the existing logical ProductTag workflow;
broader Category commands remain unadmitted.

The Product event policy authenticates both join-table inserts against the
inserted Product roots and declared join columns. Native graph admission refuses
duplicate references; shared FK and unique constraints enforce target existence
and persisted pair identity. Hard deletion authenticates both cascading pivot
removals without deleting the referenced tag/category rows or emitting extra
module messages. The Product adapter owns native reference interpretation and
event correlation. Generic storage owns row/index/FK/constraint maintenance,
bounds, settlement and recovery. No Product-only SQL, adapter-side existence
cache or second relationship engine is introduced.

This extends the private selected workflow input/output and logical event
policy, not the durable schema or public Product service. The connected proof
covers native existing-target creation, pending and committed relationship
reads, root-only hard deletion with retained targets, missing-target/duplicate
refusal, replay and forged-pivot rollback on PGlite and ordinary-role
PostgreSQL. The physical profile remains for named unmigrated Product commands
and relationship consumers; its removal gate remains their cutover and approved
data disposition. Cross-module rich Links and advanced evolution stay outside
this slice.

## Indexed Graph Replacement And Native Product Update Preflight

The shared Medusa graph replacement planner still loads every row of each
touched Product table before selecting an existing root, FK target, child or
join membership. A one-Product update can therefore fail when unrelated rows
exceed the shared request bound. This is an adapter query-planning defect: the
generic logical store already offers indexed, bounded predicates and owns
their completeness, pending membership, constraint and settlement checks.
Raising its catalog limit, adding Product SQL or accepting a small-catalog
update would preserve the wrong scaling contract.

Replace the planner's table-wide snapshots with source-key and declared
relationship selections. Keep a request-local overlay for planned inserts,
updates and removals; read the resulting projection from the same working set
after applying the plan. Change the internal `GraphLoad` callback to demand a
specific key selection, migrate Product's variant/option validator, and remove
the old full-table cache. Preserve native replacement semantics, event facts,
resource refusal for genuinely oversized selected sets, first-failure order
where framework-visible, and one borrowed transaction/settlement owner.

The connected proof is native public Product update of a selected root and
tag/category membership beyond more than one request bound of unrelated
Product and join rows. Verify pending and committed reads, unchanged target
records, events, replay, bad reference/foreign-child refusal and rollback on
both database drivers; retain existing physical Product and graph regressions.
This changes only internal graph selection/callback contracts. The physical
profile stays for named unmigrated command families and data disposition; rich
Links, general pagination/count overflow and advanced evolution remain outside
this slice.

The selected implementation now resolves graph roots, children, FK targets
and pivots through complete indexed selections. It keeps planned and written
rows in one request-local view, batches tag/category targets and Collection
associations, and reuses retained children selected by their parent FK.
The selected logical host admits one native Product root update with its
tag/category membership changes and authenticates the root event against
those row transitions. The larger-catalog witness uses 260 unrelated Product
rows and 260 unrelated tag memberships while updating one Product. General
Product update shapes that mutate owned options or variants still need
their own logical event admission and end-to-end cutover; the physical profile
remains their named consumer. Bounded selections may still refuse when the
selected set or predicate itself exceeds the core resource contract.

## Native Product Image Replacement Preflight

The pinned `updateProducts` service reorders existing images and removes all
images when the update supplies an empty array. The shared planner can select
those image rows by the declared Product foreign key, but the earlier logical
event policy admitted only the Product root and tag/category pivots. That left
a real native Product update branch on the physical profile.

Extend that one logical command's receipt policy to admit image insert, update
and delete transitions only when their before/after Product owner is the
updated root, their active/deleted state matches the operation, and the native
image event exactly matches each transition. Keep silent tag/category pivots
bound to the same root and preserve one publication owner. Do not manufacture
an image event from storage facts or add adapter SQL. The internal policy's
accepted mutation set broadens; no durable schema or public command contract
changes. The physical update profile remains for other unmigrated Product
shapes until their own gates are satisfied.

Use the native service to reorder retained images, insert a new image and remove
one, then clear the list. Check rank/order, pending and committed views, exact
row/event correspondence, replay, foreign-owner refusal, and rollback after an
unadmitted extra image transition. Run focused physical regressions and PGlite
plus ordinary-role PostgreSQL logical proofs. Option/value/variant updates stay
at their named later gate: an option value can refer to an unchanged option, so
the current mutation-only receipt does not itself prove that value's Product
owner. Resolve that through the shared authority contract before admitting it.

The logical Product update policy now admits direct image replacement for its
selected root, using the DML-declared image owner key and exact native image
events. The same atomic request can read the ranked pending image graph before
settlement; committed reads and replay retain that order. An image already
assigned to a variant still follows the existing assignment/deletion contract;
variant relationship changes remain at the later variant update gate.

## Replacement Contract And Breaking Changes

Keep native Product DML, service, repository, event and workflow semantics at
the Medusa boundary. Replace the physical layout/profile/installation reference
and `CommerceCommandContext.table` backing for the selected Product source with
source-confined logical table capabilities. The complete Product source and
binding must authenticate every supported table, index, unique constraint and
relationship dependency. A table or operation whose semantics remain unsupported
must refuse; it must not silently scan the catalog or fall back to generated SQL
tables. Update the affected service, workflow and test constructors directly.

Core must own module-local relationship maintenance and its concurrency policy:
stable scoped endpoint identities, forward/reverse access, native nullability,
cardinality, soft deletion, target-existence and deletion behavior where the
native schema actually declares it. A native Module Link is a distinct rich
record policy and must not inherit strong-reference existence implicitly.
Queries need indexed, operation-bounded root selection, consistent pending
membership, separately bounded population and complete-count overflow handling.
Product's active-handle partial uniqueness must settle with row/index/claim and
event changes, including conflicting restore. Do not implement these guarantees
as Product-only SQL or a second relational engine.

This intentionally breaks internal physical Product profile/layout identities,
repository storage bindings, installation references and test fixtures. Native
business behavior, persisted logical identities and published outcomes remain
the compatibility targets. Existing physical Product data must be inventoried;
the development reset or migration policy must be explicit before table removal.
No dual writer, compatibility fallback or silent durable reset is authorized.

## Connected Implementation And Proof Gates

1. Inventory every Product physical-store caller, table/pivot requirement and
   existing native read/write/workflow case. Classify each as migrated, retained
   for a named consumer with a removal gate, or deleted. Pin the original
   service and workflow behavior to the executing Medusa fork.
2. Extend the shared relational row/relation/query contracts for the complete
   Product source, using neutral core witnesses and the real Product schema.
   Preserve exact values, conditional indexes, defaults, pending reads,
   confinement and resource accounting. Refuse unsupported semantics at
   readiness or operation admission, never after partial mutation.
3. Select logical Product for connected public native Product service and Product-tag
   workflow paths. Prove create/update/delete/restore, graph population,
   filtered page/count, events, replay, rollback, two-scope isolation and
   ordinary-role PostgreSQL contention. Prove the active-handle reuse/restore
   conflict before accepting general Product lifecycle.
4. Move remaining Variant, Option, Category, Collection, Image and relationship
   workflows and their constructors through the same selected source; preserve
   original behavioral coverage. Only then retire physical Product profile,
   generated DDL, installation metadata and orphaned fixtures/exports under the
   approved data disposition. Keep Link, Pricing, SalesChannel and
   ShippingProfile as separately named consumers until their own cutovers.

Each implementation slice records its exact affected consumers and removal
gate, runs focused PGlite and ordinary-role PostgreSQL witnesses, both required
reviews and the staged lint checks, then commits the coherent behavior and
cleanup. The completed core execution contracts and Currency source are reused;
neither a candidate-only test nor a primary-key ProductTag demo completes this
cutover.
