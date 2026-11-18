# Native Price List Price creation preflight

## Status and connected closure

Status: the genuine native creation root and private adapter are implemented and
admitted for zero to four List entries, two Prices per entry, two raw Rule
attributes per Price and eight raw Variant selectors over four distinct stored
Link endpoints. The explicitly approved native DAL correction preserves finite
relation membership and scalar-FK authority for existing and mixed Price reuse.
The named profile selects 128 calls and retains 64 events and all other default
limits. Product chunked file import and Product export remain deferred.

The connected implementation selects existing queued root and borrowed-operation
scheduling for the native parallel validators and paired DAL reads. Shared graph
planning now distinguishes existing-root upsert, mixed insert/upsert and owned
child upsert; an explicit foreign-key visibility policy preserves the native
ability to create a Price against a historical Price Set. Exact numeric
membership belongs to shared relational query preparation and PostgreSQL
lowering, preserving numeric precision and existing access-path limits.

Two further dispositions are explicitly approved. The maximum eight-Price/sixteen-Rule
graph exceeds the existing 64-call limit on both database lanes; a named
128-call profile leaves the 64-event and other resource limits unchanged. The
native physical inverse uses unordered `DELETE RETURNING`; measured interleaved
cases return the older Price before the fresh Price even when raw retained IDs
start with the fresh Price. The approved portable profile authenticates a
complete storage-insertion-ordered cohort before deletion. It preserves raw
native selectors, all-history Rule closure and root-only events, and does not
change other physical Price deletion profiles. These decisions apply only to
this named creation profile; other roots require their own admission.

Authority is the accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary),
[source promotion contract](./04-medusa-fork-source-island-and-package-convergence.md)
and Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`,
recorded in `third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream/`:

- `packages/core/core-flows/src/price-list/workflows/create-price-list-prices.ts`
  parallelizes `validatePriceListsStep` and `validateVariantPriceLinksStep`,
  then calls `createPriceListPricesStep` and returns its PriceDTO array.
- The adjacent original three step files own List validation, raw Variant
  selectors, actual Query mapping, module arguments and retained compensation.
  Both validators are already promoted for 152/153; the original create root
  and create step form the additional promoted closure.
- `packages/modules/pricing/src/services/pricing-module.ts` owns
  `addPriceListPrices`, existing candidate reads, original `normalizePrices`/
  hash behavior and Price `upsertWithReplace`. Original `removePrices` physically
  deletes the actual retained Price IDs and their Rule descendants.

Required public resources are Pricing `listPriceLists`, `addPriceListPrices`
and inverse `removePrices`, plus genuine public Query through RemoteQuery,
RemoteJoiner and the stored ProductVariantPriceSet Link service. The exact Query
entry point is `product_variant_price_set`, fields `variant_id, price_set_id`,
with the raw flattened Variant selector. No Link mutation resource, Product
endpoint hydration, Region, File, provider, Locking or lifecycle bridge
is required.

Outer `data: []` still resolves Pricing and REMOTE_QUERY, makes no public calls
and returns `[]`. Nonempty entries with empty Prices validate Lists and execute
genuine Query with an empty Variant selector, then skip add/remove. Missing
resources therefore fail even empty input. Parallel validators have no promised
relative completion order; both must complete before creation.

## Authenticated original evidence

The immutable packet is
`%TEMP%/flarex-155-native-price-list-prices-create-witness`. Original root,
three callbacks, genuine containers/resolvers, Pricing/generated/internal
services, default MikroORM, all six Pricing tables, native stored Link schema,
LocalEventBus and actual SDK cancellation execute on ordinary-role PostgreSQL.
The decisive report is
`unchanged-native-price-list-prices-create-v1-postgres-runs/2026-10-20T02-43-59.116Z-16132/report.json`,
SHA256 `bac50287f5a98487d5889eb51bddb57a81fb6e434ea3d69cceaf98aa900681df`.
Runner SHA256 is
`fd7cba673b35238fb1b6e8cf110369307b6318f14af232c1e939e398cf79f3e1`.
Independent `audit.full48-v2.json`, SHA256
`639c8681f0e86fbec4ddf63f759a2890f15ac54332b5fbec8f2c87ae304609d9`,
authenticates 48 case artifacts, 328 source/emitted pairs, 96 owned schema absence
proofs and 48 EventBus cleanups, with zero authentication/consistency findings.

All 48 forward Promises fulfill, while actual SDK states are 37 done and 11
reverted. All 37 independent first cancellations and 19 repeated cancellations
reach reverted; three required outside-edit phases prove their persisted
preconditions. There are 35 successful nonempty public add calls. Native
rejection, SDK state, harness/setup failure and projection limits are distinct.

The 1,473 coverage notes comprise 641 sparse DTO/stored-field differences,
336 generic opaque projections, 204 references, 146 accessors, 72 transient event
identities, 27 compensated DTO rows absent from final snapshots, 25 omitted
`price_rules` arrays and 11 each of non-completed roots/unreached independent
inverses. They are not 1,473 failures. No missing retained-ID/callback,
public/internal ID-vector, action-projection or unknown-event proof is reported.
Both late-parent cases retain genuine child transactions, original output IDs
and actual successful first compensation. Their transient rows are removed
before the final snapshot.

Actual role rows and all five false ordinary-role flags are retained for both
schemas. Dependency hashes authenticate recorded entries/nearest manifests,
not every transitive byte. SQL traces are logger diagnostics, not exhaustive
wire SQL or Flarex accounting. Original module calls settle independently;
this evidence establishes no Flarex atomicity, production activation or scale.

## Observed contract and representation gate

Declared input is `{ data: [{ id, prices: [{ variant_id, currency_code,
amount, min_quantity?, max_quantity?, rules? }] }] }`, with nullable quantity
bounds and generic string rules. The admitted finite bounds are zero to four List
entries, two Prices/entry, two rule attributes/Price and eight raw Variant selectors
over four distinct linked endpoints.
Omitted Prices and explicit/null Price IDs are separately labeled runtime-only
probes, not additions to the declared workflow profile.

Native normalization preserves own-property distinctions, rule insertion
order and per-entry grouping. Omitted/null quantities can produce different
identities. Same-hash input within one module entry retains the last value at
the first key position; duplicate List entries normalize separately and can
create distinct IDs. Uppercase currency, negative/fractional amounts, empty
rule attributes/values and reversed quantity bounds retain observed behavior.
Declared `rules: {}` instead rejects with native `invalid_data` and
`column "rules" of relation "price" does not exist`, leaving no net writes or
events. Do not strip that input, invent SQL or copy an ORM error mapper to
convert it into success; retain the existing private refusal/sticky rollback
boundary and independently prove its actual exposed classification.

Actual public DTOs are sparse plain data, not unread ORM objects: all 35
successful add returns have no own accessor/depth/instance or generic opaque
markers. Common fields are ID, amount, currency, Set/List FKs and raw amount;
supplied quantities/raw companions and rules_count/price_rules appear when
native normalization supplies them. Nested Rules expose ID, attribute, value,
priority and Price FK. Stored default fields, operator and managed stamps are
not added to these outputs. Preserve actual omissions/undefined boundaries;
validate complete DML/numeric rows separately before native sparse projection.

In the original 48-case baseline, every returned and retained Price ID is new relative to its seed, including
the cases named for exact-existing, changed-amount and destructive reused-ID
inverse. Upsert actions are created only. Seed Prices/Rules and every List root
remain unchanged, including stamps. Thus existing-ID reuse, mixed insert/update,
equal/update clocks and removal of a reused old Price are unproved by that baseline.

The native candidate read was not empty: an existing matching stored Price and
Rules were selected, but internal ORM results were opaque and normalization
forwarded no old ID. Actual property presence/FK values and loaded Rule order
are not established by stored rows alone. No exact mismatch cause is proved.
A logical repository supplies checked plain DML rows, which could hash-match
where the actual ORM object did not. Do not substitute candidates, suppress
reuse or implement only an assumed fresh branch. Resolve this representation
gate before full adapter implementation.

Maximum ordinary creation emits eight Price-created messages followed by 16
Rule-created messages in actual returned Price/Rule traversal order: 24 total.
The physical inverse uses actual retained IDs, deletes all current Rule
descendants including later/history rows, and emits only actually removed
Price-root deletion messages: eight at maximum. Already-removed retained roots
produce no new deletion events. Late maximum compensation produces 32 events.
Repeated SDK cancellation does not rerun completed callbacks. These are bounded
observed vectors, not universal SQL ordering or adapter-budget proofs. The separate 154
family-contiguous ordering does not transfer to this creation/upsert path.

## Narrow supplemental capture before implementation

Preserve original 48 and prepare a separate versioned native witness using the
same original root, callbacks, candidates, normalization and hash. Existing
goal authorization covers these read-only diagnostics; no new native business
decision is required merely to collect the evidence.

The supplemental matrix has 18 cases: no-rule equal/changed amount; single-rule equal/changed
amount; two Rules in declared/reversed input order; a repeated original root
without cancellation and its changed-amount counterpart; candidate-plus-fresh
and reversed mixed traversal; actual retained inverse after repeat; and late
parent failure after repeat. Use native seed APIs and persist exact IDs/FKs,
history, rule order and supplied quantity presence. A first invocation must
reach SDK done before a genuine second invocation reads that persisted graph.
Returned first IDs are observations, never forced IDs in public input.
Five additional cohorts supply finite quantities (`min_quantity: 1`,
`max_quantity: 9`) to both native seed and input: no-rule equal/changed amount,
single-rule equal/changed amount and mixed candidate-plus-fresh input. They
test the quantity representation seam without assuming that reuse succeeds.
The final case separately omits nullable quantity keys. It retains the
distinction between absent bounds and explicitly supplied null values.

Add forwarding observers only: actual PriceService candidate-list return,
original synchronous normalizePrices arguments/output/post-call mutation and
bounded own/prototype descriptor/presence metadata for real hash operands.
Call each original exactly once with its original receiver and return the same
objects. Do not execute getters, hydrate, sort Rules, copy hash logic, replace
ORM candidates with DTOs or change the native business body. Accessor values
and Collections remain explicit gaps.

Diagnostic traversal must bound aggregate nodes, keys and text before
allocation and descent. Reserve separate finite projections for actual entity
IDs, managed actions, candidate descriptors and reference identity so optional
ORM detail cannot exhaust or obscure those proofs. Keep compact phase markers
around original calls and observation; an incomplete process or absent report
does not establish a native outcome. Local proof failures caught by the native
SDK must still cause the outer harness to refuse the result. Prove that refusal
with a separately labeled control, preserving the ordinary native baseline.

If needed, serialize retained actual references through the genuine native
serializer only after the original forward and its snapshot, in a separately
labeled diagnostic phase with before/after proof. That cannot prove earlier
operand values. A continuation influenced by serialization must be distinguished
from the principal unchanged path and compared with an isolated twin. Audit
helper/list ownership, actual upsert/public/retained IDs, managed actions,
events and inverse independently. If representation remains unresolved, record
that source-owned disposition instead of approximating a hidden hash key.

## Supplemental existing-Price boundary

A separately captured original `finite-no-rules-equal` invocation supplies
`min_quantity: 1` and `max_quantity: 9` in both seed and input. It returns the
existing seed ID through normalization, internal upsert, public output, workflow
output and retained compensation. Native actions contain `updated.Price` and
the corresponding update event even though all seven stored table snapshots,
including managed stamps, remain unchanged after forward execution.

Original cancellation calls `removePrices` with that existing ID, returns void,
physically deletes the seed Price and emits its deletion event. The remaining
Prices and six other tables stay unchanged. Preserve this retained-ID behavior;
it is not a restore-preimage operation. Public output remains sparse, while a
later native serialization of cached candidate references does not prove earlier
getter values. This single case establishes neither mixed insertion/update nor
rule-bearing reuse or the full proposed bounds.

A finite no-rule changed-amount case also reuses the existing ID. Native upsert
changes only `amount` and `raw_amount` from 40 to 88; `created_at`, `updated_at`
and `deleted_at` remain unchanged. It retains the same ID for physical inverse.
An adapter must preserve these observed update/event semantics through the
actual shared owner, rather than repair managed stamps after a graph write.

Separately seeded no-rule comparisons establish the own-property boundary:
explicit `min_quantity: null, max_quantity: null` reuses the existing nullable
seed ID, while omitting both keys creates a fresh Price and leaves the nullable
seed unchanged. Original and isolated snapshot-candidate modes preserve that
distinction, the actual normalization/upsert/retained identity chain and physical
compensation. Native hash construction tests property presence before quantity
values. Complete stored DML rows therefore do not authorize adding omitted
quantity keys to public input or changing the original normalization algorithm.

The original repeated rule-bearing path does not produce a completed second
root. Same-receiver forwarding diagnostics record repeated completed
`manager.create`/`getEntityWithId` calls while native mapping iterates an existing
live Rule Collection. That diagnostic was interrupted; interruption or heap
exhaustion supplies no successful native output, compensation or commit proof.

## Isolated Rule owner correction gate

The preserved first candidate changes only `dataForRelation.map` to
`Array.from(dataForRelation).map` in the native DAL owner. Its authenticated
repeated Rule invocation terminates but rejects before the late-parent callback.
Internal upsert returns tentative updates for the existing Price and Rule IDs;
the public transaction's later flush then attempts to insert a different Rule ID
with the same Price/attribute/operator and rolls back on native `invalid_data`.
All seven before/after table snapshots remain unchanged and no events emit.
The first successful root can still be cancelled through its genuine retained
IDs; the permanently failed second transaction cannot be reverted. This is a
failed candidate business path, not a complete correction or adapter admission.

The concrete witness is
`candidate-native-price-list-prices-create-snapshot-candidate-v1-postgres-runs/2026-10-20T08-04-55.906Z-17588/report.json`
under the immutable packet, SHA256
`4fdfc2b47580250b341096cd8c97a3546eb562daed60ec213aa2d27928726747`.
Native `getEntityWithId` creates a temporary unmanaged entity with a fresh ID,
then preserves the original ID in its returned plain object. A parent relation
alias can propagate that temporary entity into the managed parent's Collection;
`persist: false` alone does not stop the later transaction flush from reaching it.
The temporary object token was not correlated to the inserted SQL ID, so that
last identity link remains a source-supported explanation rather than a captured
object-identity proof.

A second isolated source candidate makes exactly two native DAL changes:

- Snapshot relation membership with `Array.from(dataForRelation).map` before
  normalizing members, so temporary entities cannot extend that traversal.
- Exclude metadata-declared `persist: false` many-to-one aliases only from the
  copied temporary `manager.create` input when every nonempty scalar join column
  is supplied with a value other than `undefined`. Explicit null is supplied;
  alias-only inputs keep their original path.

The original data, returned identity/defaults, native hooks, create options and
post-create cleanup remain unchanged. This is a generic native DAL owner
correction, with no Price entity switch, private ORM flags, native hash rewrite
or adapter-side SQL repair. The original and first candidate remain separate.

The candidate DAL source is
`candidate-scalar-normalization-v1/mikro-orm-repository.ts`, SHA256
`93b40e45139080fdcc4c5fbb45e22b8f5dab0b1a58dc6290c25fe6884a5ef911`.
The separate 18-case PostgreSQL report is
`candidate2-native-price-list-prices-create-scalar-candidate-v1-postgres-runs/2026-10-20T08-52-30.732Z-8644/report.json`.
`audit.candidate2-full18-v2.json`, SHA256
`15dcb5084bd95dd0a73e4ec1b032e0cbfd07769152859a64a6ded6d29cddbbe5`,
authenticates all 18 artifacts with no evidence, required-proof or semantic
findings. Seventeen forwards reach done; the remaining forward reaches the
deliberately injected late-parent failure and reverts after successful native
creation. All 17 independent inverses, eight repeated inverses and four first-root
cancellations complete. These are candidate results, not unchanged-native parity
or adapter admission.

Existing and mixed cases retain actual native IDs, actions and physical inverse.
Rule insertion order remains meaningful: the declared-order two-Rule case creates
a fresh Price while its reversed-input counterpart reuses an existing one.
Mixed events group created Prices before updated Prices and updated Rules;
returned/retained IDs preserve entry order. Reused Price stamps remain unchanged,
including a changed amount. Some repeated Rule stamps round database microseconds
to native JavaScript milliseconds; do not turn that observation into a new clock
update or a blanket unchanged-descendant-stamp claim.

Two additional genuine native duplicate-entry cases retain the same existing
Price ID twice. With amounts 77 and 88 in separate raw List entries, native
storage takes the first amount, while sparse output retains both amounts and
positions. Only the first output position receives populated Rules. Actions and
events update one Price and one Rule; compensation receives both IDs but
physically removes that Price and Rule once. This does not authorize rejecting
duplicate List entries or changing native normalization.
The separate report is
`candidate2-native-price-list-prices-create-duplicate-existing-v1-postgres-runs/2026-10-20T09-29-17.720Z-20392/report.json`;
the independent source/artifact/journal/whole-graph review is
`%TEMP%/flarex-155-outcome-analysis/duplicate-existing-independent-review.v1.md`,
SHA256 `0bad117372777ef20fbdc69dd65f5fecd55f0ec4b3d49a8ad9b5485f7ef17e02`.
The duplicate native cases use identical Rule cohorts. Distinct last-relation
source selection therefore needs the actual native planning extraction and its
neutral coverage; these two runs alone do not dynamically establish it.

The implementation extracts storage-independent batch and response planning
from the native DAL into `@medusajs/utils/dal/upsert-planning`, used by both the
real native DAL and this adapter branch. It retains first scalar writes, the
last original relation source and raw reconstructed response positions. Shared
graph planning receives unique roots and retains its duplicate-identity guard.
Native hashing and normalization are not copied into the adapter.

The shared graph owner needs explicit mixed-root and owned-child upsert
policies. Existing roots and equal Rules must produce actual updated actions
without advancing their managed stamps; fresh roots still insert. Its original
ordinary-update route advances `updated_at`, reproduced on both PGlite and
ordinary-role PostgreSQL before correction. The selected graph policies reuse
the existing durable upsert owner with exact identity, active-row, same-owner
and managed-field guards. Existing all-existing-root and default profiles remain
distinct; no persistence transaction API or post-write timestamp repair is added.

Five isolated real native `getEntityWithId` controls run separately in each mode.
Original temporary Rule IDs are observed entering the supplied alias parent's
Collection even when the returned ID is the old ID, the scalar FK names another
parent, or the scalar FK is null. The candidate preserves the actual temporary
creation and returned scalar values without those spurious Collection additions.
Both modes preserve alias-only behavior when a scalar FK is absent, and fresh
numeric defaults. All seven database tables remain unchanged, with no flush,
events or principal workflow execution in these isolated controls.
`audit.owner5-original-v3.json` (SHA256
`485110cbf5fb2d0f518875ff7c482d729388028dd7763f79f5404cba2b5daee0`)
and `audit.owner5-candidate2-v3.json` (SHA256
`28b1e5a455ac7a0556d297a36676460e20fb69fc93b94fe7b9221e5ea95e85ac`)
authenticate five controls each without evidence or required-proof failures.
This direct owner evidence complements the transaction witnesses; it does not
replace them or establish support for arbitrary other native modules.

The separate candidate regression runner preserves all original 48 declarations
and observers, changing only source selection and its authentication. Its report
is `candidate2-native-price-list-prices-create-scalar-full48-v1-postgres-runs/2026-10-20T09-03-10.134Z-8728/report.json`.
`audit.candidate2-full48-full-v2.json`, SHA256
`693d7b34ba8b067e96bbc05d900ae0080577dbc3b42433d57de84b75f04eeb72`,
authenticates all 48 artifacts with zero evidence or semantic findings. Across
all 48 names, forward/first-inverse/repeated-inverse status, SDK state, public,
Link, Query and EventBus call vectors, and delivered counts match the original
baseline. Sparse/opaque projection notes remain explicit. This preserves the
fresh-creation regression surface; it does not substitute for the 18 reuse cases
or assert arbitrary-input equivalence. These native witnesses use ordinary-role
PostgreSQL; their native evidence remains separate from private Flarex admission.

Auditor versions that rejected diagnostic-reference or JSON-omission shapes
remain preserved. The corrected versions require the exact source-owned shapes;
the shared-input reference is accepted only with its exact observer path and
three matching actual workflow-input captures. No missing phase, failed public
transaction or incomplete table snapshot is waived.
Eight separately copied corruption controls verify refusal of missing/forged
reference markers, sidecars, missing/mismatching actual inputs and truncated
configuration. Each refreshes artifact/report hashes and requires the exact
intended proof failure, after an unchanged copied positive passes. Their
`control-results.json` SHA256 is
`bd66d84cd005044d90e93eff321f6fa3c80f9536293a6ed39e5d4b55b411072f`;
all eight pass and all original files remain unchanged. A separate intentional
SDK-swallowed harness failure exits nonzero and authenticates only in control
mode; normal/control mode substitutions are refused in both directions.

The user explicitly approved the native business decision: permit the bounded
rule-bearing reuse path to complete through these two owner corrections, while
preserving native normalization, scalar-FK authority, outputs, events and retained
physical compensation. This is separate from the already-authorized necessary
Flarex core changes. Its promotion, adapter integration and validation form one
connected implementation scope. The unchanged native comparison packet remains
separate from the portable admission.

Audit action/event obligations follow the actual public transaction owner.
Successful inner upsert actions do not establish a successful public add or an
event obligation after that public transaction rejects and rolls back. Any
failed-owner classification must retain the attempted actions, actual refusal,
unchanged complete snapshots and rollback evidence. Successful public methods
retain strict event obligations, including when a later parent fails.

## Implemented ownership and remaining gates

The genuine root and creation step reuse both native validators, the stored
Variant-PriceSet Link Query, native candidate constraints and normalization,
and the original retained-ID inverse. Pricing exposes only List reads, add and
physical removal; module graph access remains off. Both existing operation
queues cover the parallel validators and paired native DAL reads.

The executing native DAL and adapter share the extracted native upsert planner,
including first-write/last-relation duplicate behavior and sparse reconstructed
positions. Shared graph policies explicitly select mixed insert/upsert, owned
child upsert and existing-parent FK visibility. Exact numeric membership is a
shared relational predicate using existing precision, access-path, working-set
and complete-query proofs. Other profiles retain their existing policies.

Complete receipts authenticate native candidate order, sparse results, original
managed stamps, actual actions and event sequence. Explicit empty Rule records
retain the private invalid-input refusal and rollback boundary. Existing Price
reuse retains its destructive native inverse: complete all-history Rules are
removed before the retained Price roots, with root-only deletion events. Only
this profile selects the approved storage-insertion-ordered root cohort; raw
native selectors and duplicate response positions remain intact.

The named 128-call allowance covers the complete maximum forward graph, retained
inverse and late-parent composition. Default 64-call refusal and cross-profile
replay identity remain part of the bounded contract. Events stay at 64; byte,
deadline and working-set limits remain unchanged.

General Price List Price update, removal and batch workflow roots remain
separate admissions. Hosted activation, durable external delivery, arbitrary
scale, populated schema upgrades and cold scheduler recovery remain separate
gates. The original native baselines and approved DAL candidate evidence remain
preserved rather than rewritten as portable equivalence.
