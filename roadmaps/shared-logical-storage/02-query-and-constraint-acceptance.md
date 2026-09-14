# Shared Query And Constraint Acceptance

## Status And Scope

Status: required acceptance contract for the shared logical storage redesign;
runtime implementation and validation are pending. This document records the
review-driven requirements within GLS1-GLS3 and the final cutover gates. It is not
a new execution engine, a completed test receipt or permission to activate an
unsupported framework capability.

The [shared logical storage decision](../../design-notes/flarexdb-shared-logical-storage.md)
owns architecture and semantic policy; the [GLS roadmap](./README.md) owns
sequencing. The [first composition preflight](./01-schema-composition-preflight.md)
remains candidate-only. Preserve its narrow authority, then execute real indexed
operations rather than treating increasingly rich metadata as storage support.
[Advanced evolution](./deferred-framework-schema-evolution.md), developer APIs,
full framework activation and hosted Cloudflare proof retain separate gates.

## Sources And Current Boundaries

Use the [Medusa source receipt](../../third_party/medusa/SOURCE.json) and
[Payload dependency pin](../../packages/payload-adapter/package.json) to identify
executing versus comparison sources before each implementation. Original tests
below are behavioral inputs; their presence is not a fresh passing result.

| Source | Finding that constrains the target |
| --- | --- |
| [Pinned Pricing repository](../../third_party/medusa/upstream/packages/modules/pricing/src/repositories/pricing.ts) | Calculated prices use currency/quantity filters, active and time-valid lists, rule aggregates, numeric comparisons, JSON containment and computed ordering. Its available-attribute cache is mutable. |
| [Current Pricing adapter](../../packages/medusa-adapter/src/pricing-repository.ts) and [connected workflow](../../packages/medusa-adapter/src/product-variant-pricing-workflow.ts) | Selected creation/ID reads and a small native-step composition are implemented; they do not establish calculated Pricing or Inventory parity. |
| [Exact numeric bridge](../../packages/medusa-adapter/src/exact-numeric.ts), [Price model](../../packages/medusa-pricing/src/models/price.ts) and [ordered-index codec](../../packages/flarex-protocol/src/ordered-index.ts) | Exact companions preserve native values; the current ordered-value union has no dedicated exact-decimal form. Storage fidelity and index ordering are different guarantees. |
| [Product model](../../packages/medusa-product/src/models/product.ts) | Handle uniqueness is conditional on the native active-row predicate. |
| [Link capture](../../packages/medusa-adapter/src/link-schema.ts) and [Link/workflow tests](../../packages/medusa-adapter/test/product-variant-pricing-workflow.test.ts) | Captured Links have no endpoint FKs; cardinality/restore tests include pairs without created endpoint records. This is not a strong-reference existence proof. |
| [Pinned variant workflow](../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/create-product-variants.ts) | Inventory Links carry `required_quantity`; a universal bare pair or ID array cannot represent all rich Links. |
| [Payload compiler](../../packages/payload-adapter/src/collections.ts) and [CMS documents](../../packages/persistence-postgres/src/cmsTransaction/documents.ts) | Ordinary index declarations are not currently admitted; non-ID find and early unique validation can read a bounded collection. Final core unique enforcement is a distinct boundary. |
| [Payload operation bridge](../../packages/payload-adapter/src/operations.ts) and [native create operation](https://github.com/payloadcms/payload/blob/v3.88.0/packages/payload/src/collections/operations/create.ts) | Actual Local API calls retain access checks; native afterChange processing precedes the operation's commit. The broad native pipeline also includes upload/email behavior outside the current narrow profile. |
| [Atomic host](../../packages/persistence-postgres/src/atomicCommerce/host.ts), [commerce store](../../packages/persistence-postgres/src/commerceTransaction/store.ts) and [prepared admission](../../packages/persistence-postgres/src/frameworkSchema/installation/runtime.ts) | Early scope locking, catalog-dependent work and selected installation-evidence checks remain current costs, not solved by a generic-storage design document. |

Supporting semantic references are [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html),
[PostgreSQL isolation](https://www.postgresql.org/docs/18/transaction-iso.html),
[Medusa Module Links](https://docs.medusajs.com/learn/fundamentals/module-links)
and [Payload indexes](https://payloadcms.com/docs/database/indexes). Public docs
explain contracts; they do not override the pinned executable source or upgrade
a dependency. Source-specific divergences must remain explicit.

## Query Contract And Calculated Pricing

GLS1 maps one representative native calculated-pricing request to the shared
query primitives before their implementation contract is frozen. Identify the
logical candidate index, equality/range bounds, residual filters, joins or set
operations, aggregates, exact ordering, decode locations and row/byte accounting.
Use a finite neutral plan at existing core owners, not an arbitrary SQL parser,
a framework-name dispatcher or a new Pricing-specific database engine.

GLS2 begins and GLS3 completes an executable bounded comparison on generic data.
Exercise base prices, multiple currencies, nullable quantity limits, active and
expired/not-yet-valid lists, matching/nonmatching rules, numeric comparisons,
JSON membership where admitted, and amount/rule-specificity ordering. Pin the
same effective time, inputs, data and supported options in both comparators.
Compare sets or the ordering actually promised by native behavior; add an explicit
tie-breaker only through a declared contract, not an invented parity assertion.
Full Pricing public-method admission remains outside this representative proof.

The target need not reproduce the original SQL text. It must produce equivalent
admitted results without decoding unrelated tenant payloads. Bounded residual
work is acceptable when explicit, charged and measured. A missing access path
must refuse or trigger a core correction, not a hidden adapter full scan.
Generic typed projections, statistics or covering entries require a measured
need, shared semantic ownership and atomic maintenance; they are not forbidden
merely to minimize physical family count.

Root filtering and child population filtering are separate operations. Preserve
per-path predicate-aware batching/cache identity. Apply pagination to logical
roots, keep rows/count coherent under the selected snapshot, and distinguish a
page from a complete relation set. An overflow witness such as one extra matched
row must fail a complete-set request rather than silently truncate it. A LIMIT
is an output bound, not a proof of bounded scanning, sorting or exact counting.

## Exact Values And Conditional Uniqueness

The value contract separately declares storage representation, comparison,
collation, null/missing behavior and uniqueness semantics. A decimal string is
not a numeric ordered key, and binary64 is not an exact replacement for arbitrary
admitted decimal values. Select a proven decimal encoding or generic typed access
path; preserve native raw metadata and DTO presentation as separate concerns.

Differential/property tests against PostgreSQL numeric comparisons cover signs,
equivalent scales, exponent forms, bounds, nullable quantity endpoints and values
outside binary64's exact precision. The candidate records unsupported semantic
requirements honestly; readiness cannot turn metadata acceptance into execution
support or coerce values silently. Preserve native Application ordering and OCC
semantics where they deliberately differ.

For uniqueness, distinguish normal SQL null-distinct behavior from an explicitly
admitted nulls-not-distinct rule, including compound keys. A canonical null token
in an ordered key does not itself decide whether to acquire a unique claim.
Only the authoritative transaction may settle before/after predicate membership,
claim release/acquisition, affected rows and their publication together.

The first Product lifecycle witness creates A with handle `shirt`, soft-deletes
A, creates active B with that handle, and attempts to restore A. Require the
native conflict result with no partial row/index/claim/event state. Add concurrent
active insertion, handle update and conflicting restoration with separate
connections. Adapter pre-validation may improve error timing but is not the
final constraint. Preserve native error projection and same-request visibility.

## Native Links And Strong References

Use explicit authenticated relationship policy, not a blanket inference from
ID-shaped fields. Schema endpoint resolution and record-target existence are
different requirements. Missing/unauthorized schema dependencies always refuse;
record absence follows the selected relationship contract.

| Category | Proof and permitted interpretation |
| --- | --- |
| Module-local relationship | Preserve the admitted native nullability, target and deletion/FK-like behavior through core constraints. |
| Native stored Module Link | Characterize pair identity, singular/many cardinality, extra data, soft deletion, restore and absent-record behavior from pinned code/tests. Lack of endpoint FKs must not silently become a target-existence guarantee. |
| Strong local cross-framework reference | Enforce target existence and compatible deletion/restore/cardinality policy atomically within authorized scope and placement. |

Preserve the native-Link behavior unless a focused contract explicitly selects
stronger enforcement. Such a selection must disclose creation-order, missing-
target, visibility, delete/restore and cleanup changes and update its native
comparison/intentional-difference tests. This document does not silently choose
that stronger policy for existing Links. A strong reference must never be
weakened to unchecked IDs or asynchronous repair to pass compatibility tests.

These policies share core primitives, not three independent engines. Rich Links
remain authoritative records with identity, data and lifecycle; endpoint/reverse
indexes remain derived. Scope confinement, endpoint ownership, authorized
traversal and bounded expansion apply even when a native Link permits an absent
record. Existence checks must not leak otherwise inaccessible target data.

Exercise two shops reusing local IDs; forward/reverse reads; native cardinality
and restore conflicts; rich data round trips; and strong-reference insertion
racing target deletion. Soft deletion, hard deletion and restoration have distinct
policies. Never invoke unadmitted target hooks or cascade across semantic owners
merely because a shared constraint can locate the record. Keep cross-placement
references outside local atomic guarantees.

## Indexed Payload And Pending Visibility

Wire supported native single-field and compound-index definitions to actual
indexed Local API execution. The current narrow grammar refuses those ordinary
index options; the new proof must extend compilation and execution together,
not claim they were already accepted. Exercise a selective non-ID lookup, range
or compound sort as admitted, native page/count behavior and unique create/update
without reading every unrelated collection record.

All participating reads within a transaction must see the same pending state.
Change an indexed value from 10 to 20, query both ranges before commit, follow a
newly created Link, and count the corresponding roots. The old membership must
disappear and the new one appear. Include conditional-index/unique membership,
deletions, nested Payload requests and cross-participant reads inside an explicitly
admitted atomic group. Separate independently committed API calls are not such
a group. Force a late failure and verify rollback of every derived family.

Choose transaction-local SQL materialization or a defined overlay at one core
owner. Reusing committed index readers beside an unrelated adapter buffer is
not coherent read-your-writes. Preserve Application's exact snapshot/dependency
and history obligations; do not replay arbitrary framework callbacks through
native OCC merely because storage is shared.

Retain actual Payload Local API access/default/validation and request propagation.
AfterChange is not generally an after-commit hook. Upload/email/provider behavior
needs a separately admitted effect policy consistent with no remote effects in
business transactions; it is not included by scalar or index compatibility.

## Concurrency Before Capacity

GLS1 specifies request-identity exclusion, authority/generation fences,
row/set/invariant protection, consistent lock order, publication sequencing and
uncertain-COMMIT recovery before the generic mutation contract is finalized.
GLS2/GLS3 add distinct-connection ordinary-role PostgreSQL races with the first
executing unique and relation capabilities. GLS5 completes coordinated lock
cutover, capacity, fairness and maintenance measurements; it is not the first
place to design constraint correctness.

Existing scope-wide exclusion may remain until a replacement is proven. Label
its proofs as serialized safety, not independent concurrency. Before claiming
the clock bottleneck removed, deterministic barriers must prove unrelated keys
overlap while same-key, same-unique and same-target decisions remain protected.
Mixed CMS/Application/commerce and relevant activation/maintenance paths obey
one protocol. Do not combine clock-first and row-first writers over shared
resources without an explicit deadlock/order proof.

A final row lock does not repair an earlier stale decision. Nor does replacing
waiting with unbounded SERIALIZABLE retries establish scalability or callback
replay safety. Distinguish confirmed aborts from uncertain acknowledgements;
recovery uses the original authoritative outcome and intent. Preserve sticky
failure, cancellation cleanup, duplicate-request identity and one publisher.

## Cost, History, Cache And Readiness Obligations

GLS1 declares the historical visibility promised by each commerce read surface
and the evidence required for native OCC, pinned readers, builds, recovery and
event delivery. Reusing current/revision families neither authorizes premature
pruning nor mandates infinite retention. Measure current/revision/index/claim/
relation/publication work per business operation, narrow patches to wide rows,
small projections, unchanged index fields, and differing logical index counts.
Avoid rewriting unchanged memberships. Identify cleanup floors and the owner
that enforces them before retiring old consumers.

Immutable compiled models and query plans may be reused with complete definition
identity and bounded retention. Mutable native services and data-dependent caches
must have tenant/schema/revision ownership and write/lifecycle invalidation. The
pinned Pricing available-attribute cache is a future isolation witness: use two
shops with different rule attributes, complex contexts and intervening changes.
Prove one shop's cache cannot prune the other's input. No active cross-tenant
cache bug is asserted by this requirement.

Separate cold construction, warm authority admission, selected installation
evidence, business queries, publication, lock waits and cleanup. Measure selected
dependency growth separately from unrelated historical growth. A readiness-root
optimization cannot silently discard privileged-tamper detection guarantees;
retain the runtime owner's explicit integrity decision and enforcement proof.

Basic schema/revision pinning, compatible index-build coverage, stale-definition
refusal, crash-safe activation and safe refusal of unsupported transitions remain
early serving prerequisites. Deferring advanced upgrades/conversions/write-owner
transfers does not defer those safeguards. Atomic commands and durable multi-commit
workflows remain separate modes selected before execution, never switched because
a limit is exceeded. Existing outcome/event/Task owners retain recovery authority.

## Acceptance And Measurement Matrix

The rows below are required proof categories, not completed tests or advertised
capacity. Choose numerical performance thresholds and exact workload parameters
in the implementing preflight before observing results. Shop count, rows per
shop, index count, fan-out and tenant skew are separate independent axes.

| Witness | Earliest owner/gate | Decisive evidence |
| --- | --- | --- |
| Candidate semantics | Candidate-only GLS2 slice | Persist/reload identities and applicable policy requirements; reject unresolved schema dependencies and unsupported serving without widening the first Product candidate. |
| Calculated Pricing | GLS1 plan; GLS2/GLS3 execution | Pinned same-time/native comparison of quantity/list/rule/amount behavior; selective bounds and measured decode/aggregate work under unrelated-catalog growth. |
| Values and conditional claims | GLS2 with first writes | Decimal/order/null differential tests, active-handle lifecycle and distinct-connection unique/restore races. |
| Indexed Payload | GLS2/GLS3 | Native Local API single/compound indexes, non-ID selection, uniqueness and nested pending reads, preserving access and result envelopes. |
| Relation policy and rich Links | GLS1 policy; GLS3 execution | Separate native-Link versus strong-reference witnesses; custom data, missing targets, cross-shop refusal, cardinality, restore and parent-delete/reference-insert races. |
| Pending state and recovery | GLS2/GLS3 | New/old index ranges, coherent graph/count, late rollback, duplicate requests, cancellation, uncertain COMMIT and subscriber failure retain one complete outcome. |
| Concurrent cutover | GLS1 design; GLS2/GLS3 races; GLS5 cutover | Cross-owner common order; independent overlap distinct from serialized safety; generation/activation races and no fallback. |
| Amplification, caches and capacity | GLS1 budgets; early semantic tests; GLS5 load | Rows/bytes/WAL/history per business operation, wide rows and unchanged indexes, tenant-dependent cache isolation, hot-tenant/maintenance fairness. |

Use the current bounded Flarex relational implementation for operations it actually
supports. Use the pinned native relational path or isolated comparison harness
for broader query behavior where runnable; label unavailable comparisons instead
of inventing a baseline. Compare the generic path on equivalent data/results,
transaction/effect obligations, counts and visibility. Attribute Flarex safety
and publication overhead separately; beating an expensive catalog guard does not
prove superiority to a lean native query.

PGlite supplies fast semantic tests. Ordinary-role real PostgreSQL supplies
concurrent connections, locks, constraints, isolation and query plans. Record
p50/p95/p99, errors/retries, whole-request and phase latency, actual statements,
rows/buffers/transported bytes, CPU, memory, WAL and maintenance. Keep warm/cold
and one-scope/many-scope results distinct; never force an index to manufacture a
passing plan. Hosted Cloudflare/Hyperdrive behavior has its own later proof.

## Cutover And Completion

Each consumer passes its applicable witnesses before its displaced runtime is
removed. The corresponding native assertions and intentionally changed semantics
move with it. Final GLS6 retirement requires the representative Pricing query,
indexed Payload operations, explicit relation policies and pending/concurrent
constraint proofs, plus named history/readiness/cache obligations. This is not
permission to delay in-scope cleanup or implement every framework feature first.

A retained baseline branch, inert source island or isolated comparison harness
is not a production fallback. Remove obsolete serving paths and duplicated
constraint/admission/recovery authorities after their named consumers migrate.
Inventory named durable data and formats before reset or conversion. Preserve
one current owner for each guarantee; document exact contract breaks and refusal
boundaries instead of wrapping obsolete core behavior in another adapter.
