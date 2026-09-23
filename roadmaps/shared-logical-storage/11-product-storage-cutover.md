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
Product graph, population, lifecycle and native service queries cannot be
routed through those contracts unchanged.

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
pass on both drivers; native Product command selection remains pending.

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
kernel is now implemented, while native command selection, remaining query
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
passes on both database drivers; no native Product service has selected it yet.

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
3. Select logical Product for connected native Product service and Product-tag
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
