# Native Fulfillment update preflight

Status: implemented as a private bounded standalone root through the existing
Fulfillment constructor. The native preimage correction is explicitly approved
and applied to finite/durable copies; standalone execution remains finite and
atomic. Shipment and Delivery retain their own bounded workflow contracts.

## Native authority and connected outcome

Authority is Medusa 2.13.4, revision
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream/`.

- `packages/core/core-flows/src/fulfillment/workflows/update-fulfillment.ts`
  owns `update-fulfillment-workflow` and returns its genuine update step result.
- `packages/core/core-flows/src/fulfillment/steps/update-fulfillment.ts` derives
  preimage selectors from supplied fields, retrieves that DTO, calls genuine
  `updateFulfillment`, and retains the retrieved value. Its original inverse
  calls the same module method with the retained fields and identity.
- `packages/core/types/src/workflow/fulfillment/update-fulfillment.ts` declares
  `id`, `location_id`, `packed_at`, `shipped_at`, `marked_shipped_by`,
  `created_by`, `delivered_at`, `data` and `metadata`.
- `packages/core/types/src/fulfillment/mutations/fulfillment.ts` additionally
  declares Labels on the module update DTO while omitting the workflow actor
  fields. Shipment already forwards Labels through the executing workflow.
  These are separately identified runtime cases, not a claim that the workflow
  interface declares Labels.
- `packages/modules/fulfillment/src/services/fulfillment-module-service.ts`
  always hydrates Items and Labels internally and normalizes existing Labels
  before the genuine repository performs relation replacement.
- The original internal service merges metadata, including empty-string key
  removal; MikroORM assignment also merges object values. Adapter code must
  consume native normalization rather than reproduce these algorithms.

The complete connected outcome covers every declared workflow field and the
existing module/Shipment Label branch. It needs the existing twelve-table
Fulfillment source and only its retrieve/update methods. No provider operation,
Stock Location Query, Order, Cart, Inventory, Pricing, Module Link, Locking or
Task capability follows from standalone update. Fixture Stock Location/provider
construction does not make those runtime workflow dependencies.

## Immutable unchanged-native evidence

The packet is `%TEMP%/flarex-147-native-update-fulfillment-witness`.
Executed `run.postgres.v1.mjs` has SHA256
`5405990ce3723b273f34c665902740f675534a9f6f9a394955ccdf5d88cf3d60`.
The complete report is
`unchanged-native-postgres-runs/2026-10-19T12-41-19.650Z-16352/report.json`,
SHA256 `ae25d26dfb27b98bd07bebc4e696dbfd01f1519de4f050c0e13deb7c68cf843b`.

All 63 artifact hashes and byte lengths match. The 46 workflow-contract cases
and 17 separately tagged Label cases retain actual original scheduler
cancellation, genuine services/default MikroORM conversion and ordinary-role
PostgreSQL. There are no cohort or selection failures; all 126 owned-schema
absence proofs hold. Native refusal and incomplete inverses are observations,
not passing restoration assertions. The separate nominal smoke and immutable
146 donor remain preserved.

Scalar dates, actor fields and Location strings follow the original update
service without Shipment/Delivery guards or an invented Location lookup.
Missing/historical roots retain their original retrieve errors. Historical
Option and Provider references do not introduce unrelated runtime validation.

Id-only and SDK-resolved undefined updates request `select: []` and
`relations: []`. With active references, their native retained DTO contains the
ID and reference identities, rather than all scalar fields. The actual inverse
forwards those unchanged references and makes no raw change. Historical
reference visibility and native initialization differ as characterized below.
Internal admission for this
shape must prove unchanged identities; it must not add reference or managed
fields to the outer workflow input.

The original recursive selector treats object-valued `data` as relations.
Nested object/array data fails relation population; null array members in data
or metadata fail the original selector. Flat JSON may succeed despite the
misclassification. These are native preimage defects, not adapter read failures.

Cancellation of ID-only retained Label replacements can fail because the
retained member lacks required tracking fields after a sibling is removed.
Two original inverses finish `failed` and leave an original member absent.
The exported native errors array omits compensation errors; actual service
errors and final scheduler state establish the failure. Other Label inverses
can restore identities/content while recreating timestamps.

Even a complete JSON preimage does not make the original inverse an exact
snapshot restore: introduced data/metadata keys can survive native object
merging, including genuine late-parent compensation. Record these residuals
explicitly. A broader JSON replacement contract requires its own native
transaction design and business decision. Do not clear and restore JSON using
two independently committed module calls or change the global ORM policy.

The late-parent cases retain and cancel the actual native child transaction;
no synthetic StepResponse or manually reconstructed inverse input is supplied.
Protected sibling graphs, unrelated tables and zero provider/Query operations
are checked separately. This proves the local default PostgreSQL native
envelope, not Flarex/PGlite parity, durable restart or hosted activation.

## Separate preimage correction candidate

The frozen external candidate changes only the original update step's preimage
selection block. It supplies `objectFields: ["data", "metadata"]` to the native
selector and, when Labels are supplied, selects `labels.*` with the Labels
relation. Forward and inverse still call the original module update once each;
neither the module, generic selector, native ORM nor JSON merge policy changes.
The comparison snapshot and executing repository files remain unchanged.

Candidate source `update-fulfillment.preimage-candidate.v1.ts` has SHA256
`f222b6d2c6c1bf0a5f3d916659759536497fab13c2bf7f8dac3bcc0a58da4101`.
Executed `run.postgres.preimage-candidate.v2.mjs` has SHA256
`5637bfb3f8363821ec49c8f6714cba7897bd48c8a17d79b5516253690f53fb0e`.
Its complete report is
`preimage-candidate-v2-postgres-runs/2026-10-19T13-08-14.265Z-452/report.json`,
SHA256 `a6a27e4cc90f28b8279f469e653712e3154308eb53595378dabc6b7ff00ffb34`.

All 63 candidate artifacts match their hashes/lengths; comparison and cohort
constraints hold, with all 126 schema absence proofs. Four original JSON
selector failures now reach the genuine update and original inverse. Both
failed ID-only Label inverses now finish `reverted`, restoring original Label
identities and business fields. Pristine Label preimages contain all eight
native columns. Final managed timestamps remain observations, not an exact
snapshot restoration promise. Other canonical business outcomes, actual update
call counts, id-only reference preimages and native JSON merge residuals remain
unchanged. Missing/historical root/member failures and injected late-parent
failures remain explicit expected outcomes, rather than successful updates.

The first candidate run and immutable runner remain preserved. Its only failed
comparison used a random transient Label ID from late-parent compensation that
was absent from the final row snapshot. The second runner fixes only that
harness mapping: actual native-call row milestones supply a distinct identity
map shared across rows, arguments and create/delete events. It removes no
business-field or event assertion and does not change the native candidate.

The owner explicitly approved this scoped correction. It changes nested JSON
acceptance and incomplete Label cancellation behavior while preserving native
JSON merging and its cancellation residuals. Exact JSON replacement remains a
separate contract decision. This native witness alone does not admit the adapter.

## Private bounded implementation

The approved native update-step preimage correction treats `data` and `metadata`
as whole object fields and captures complete Labels when supplied. Both finite
and durable copies retain one genuine forward module call and one original
inverse call, preserving native normalization, other selectors, errors and JSON
merge semantics. The original comparison snapshot and separate candidate
witnesses remain preserved. The portable copies use the guarded ES2021 own-key
spelling without changing the candidate's behavior.

Shipment invokes this exact update workflow as its native child. The correction
therefore also replaces its earlier nonempty-Label timestamp recreation branch:
complete retained Labels now restore their original timestamps for both empty
and four-member replacement. Candidate case 049 proves complete eight-column
retained DTOs and unchanged original timestamps after genuine cancellation
(artifact SHA256 `76e8ff81e14d44fee56522fc0e97171c680962799bbe2a447d70ce7c0ac4f985`).
The original case and Shipment comparison packet remain unchanged. Connected
tests require full retained/restored Label row equality, preserving their
existing identity, ordering, event, budget and protected-row assertions.

The existing Fulfillment graph update, query, serialization and causal receipt
owners admit the complete selected update contract. Their displaced
Shipment-only restrictions are removed. Creation retains its Manual-provider
assignment lifetime while sharing the genuine DAL JSON assignment seam;
standalone updates consume their actual native normalized pair. One local
module constructor reuses the existing projection/read/persistence owners.

The standalone facade binds only retrieve/update resources over the same
authenticated Fulfillment source. Outer input admits the complete native
workflow field contract plus the separately described bounded Label branch,
never arbitrary DML writes or managed/reference fields. Internal retained
projections and reference no-ops require their actual causal evidence.

The private graph remains one root with at most four Items/four Labels. It uses
the existing 128-call Fulfillment allowance, 64 events, 1 MiB and thirty-second
deadline. Maximum forward and retained replacement inverses remain bounded by
that profile. Shared corrections stay with their existing owners under the
core-change authorization; this root increases no resource limit.

### Native JSON assignment and connected creation

The pinned default repository enables MikroORM 6.4.16
`mergeObjectProperties: true`. Its plain-object decision and recursive merge
belong to the framework DAL; a generic shallow/deep merge in the adapter would
change arrays, nested objects and own `constructor` keys. The portable DAL seam
retains the selected original algorithm, uses the existing native JSON copier
for ordinary JSON representation and carries the original MIT notice. Its
separate frozen foreign source capsule and exact extraction guard do not relax
the Medusa upstream source boundary or import ORM code at runtime.

The isolated pure native packet is
`%TEMP%/flarex-147-native-json-assignment-witness`, with report
`pure-native-runs/2026-10-19T14-53-42.006Z-15572/report.json`, SHA256
`f5f3d5c7587120eb4e9058a8d62c26e3afe7fef6c1f3661c4e0502135b4d9b22`.
It executes the actual installed assignment method in isolated child processes;
no expected merge implementation is substituted. Ordinary and null-prototype
input experiments prove that container normalization must preserve native
constructor decisions. Own `prototype` and `constructor` business keys remain
supported. Recursive own `__proto__` is outside the private assignment domain:
the original merge can mutate the child process's object prototype. Refuse it
before native assignment, including unsupported stored values, rather than
silently rewriting data or reproducing that side effect. The parent remains
unmodified. This predicate is an algorithm-domain gate after the owning JSON
capture/schema, not a second JSON validator or authority mechanism.

The connected genuine creation packet is
`%TEMP%/flarex-147-native-creation-json-witness`. Frozen `run.postgres.v2.mjs`
has SHA256 `08f4ea10523c1f23c6a15db65eebe0493a47bf3c02fc32ddeeb474f8ec451e75`.
Its report
`unchanged-native-v2-postgres-runs/2026-10-19T15-35-46.977Z-3496/report.json`
has SHA256 `e2913527c80ea6946a86b102d85d641b236d14c31b1991e7b3c0f1528e7135ca`.
Ordinary and Return creation both retain constructor-bearing input data in the
initial native DTO, then store `{}` after the genuine Manual provider's empty
data assignment. A nested constructor control retains its ordinary outer
object. The former adapter's `isJsonObject` retention heuristic disagrees with
this native outcome; creation and updates must share the genuine assignment
owner, while preserving detached initial DTOs and their existing lifetimes.
Raw null-prototype workflow inputs are original SDK refusals before Query or
module calls, not successful creation controls. The original runs are retained;
the second runner corrects only that harness expectation. All ten artifacts and
twenty schema absence proofs are recorded.

### Repeated owned references

The native repeated ID-only Label case succeeds and represents one collection
member. Initial adapter validation instead refuses it at the shared graph
writer's unconditional visited-identity check. Preserve that failing consumer
witness and correct the shared replacement owner with explicit profile admission
for identical, existing active key-only owned references. The default remains
refusal; repeated root/full writes, new or historical identities, conflicting
owners and touched members remain unsupported. Prove this with neutral owned
relations and the native Fulfillment consumer in both database lanes. Native
result ordering must use unique actual collection members, without a separate
adapter enforcement or storage path.

### Managed update time during retained compensation

The complete and partial active-Label native cases pass the original retained
`updated_at` to the genuine inverse. Native assignment restores Label business
fields while its `onUpdate` hook assigns a fresh timestamp. The original time
does not become timestamp-setting authority. The initial adapter instead
rejects both authentic inverses at the shared graph's managed-field equality
gate; the failing consumer witness is retained in
`%TEMP%/flarex-147-active-label-inverse-failing-1.log`.

The shared replacement owner has explicit profile admission for an existing
active owned child's supplied update time: validate it, retain its native dirty
signal and let the existing core write generate the stored time. Creation and
deletion times, root writes, default profiles and same-root deleted-row
reconstitution retain their existing checks. The Fulfillment receipt must
authenticate the same operation, including its actual generated clock and
events. Neutral graph tests and actual native inverses cover this connected
correction separately in both database lanes.

### Historical references and native initialization

The separate reference-only extension retains the original 63-case packets.
Its eight ordinary-role PostgreSQL cases pair id-only/undefined input with
active references and historical Option, Provider and Address targets. Report
`reference-only-and-label-replay-v1-postgres-runs/2026-10-19T16-22-17.328Z-9584/report.json`
has SHA256 `8be2ef6da61a43e8bc7284a3c33b060a142b540bf82c05165b0116fcc63dc5aa`
under the existing native-update witness packet. Empty selection returns a
historical Option as a null relation/scalar pair, and omits historical
Provider/Address pairs. Default/full reads retain the owning Provider/Address
identities. All genuine inverses preserve the raw stored foreign keys.

The four historical Provider/Address cases also perform native root updates
and emit root update events on both forward and inverse calls, even for empty
business patches. Native `HasOneWithFK` initialization reconstructs a reference
from its owning formula key after filtering; ORM dirty tracking writes the
same foreign key and a generated update time. The separate four no-probe cases
confirm this occurs without the additional diagnostic retrievals. Their report
is `paired-no-probe-and-detached-label-v3-postgres-runs/2026-10-19T16-28-41.860Z-6936/report.json`,
SHA256 `a2dbfa5b862837a85089551875ad75551a1cf468ba2a779098273b1ddcba61c2`.
The query owner derives this dirty signal from actual hydrated reference
visibility before DTO projection, retaining it only within the native service
use. An explicit shared profile performs an ordinary root update with managed
timestamps. The receipt re-derives its mutation and event expectations from
actual read evidence, preserving every raw foreign key. This grants no
association mutation or additional read capability.

The same paired report separately proves two detached pristine Label callback
replays: the actual retained DTO is cloned before its first native inverse,
then the original callback receives that clone with the original context. It
emits one Label update event and generates a fresh timestamp even after business
content already matches. This characterizes the managed dirty signal, not SDK
retry support. The preserved same-live-input replay instead fails in native
comparison after the first inverse attaches cyclic ORM entities to its retained
DTO. A second actual SDK cancellation performs no module calls or events in
either experiment. The portable captured-DTO boundary does not expose those
transient ORM entities or admit a durable compensation scheduler.

## Admission and validation gates

Preserve all declared fields, empty/omitted/undefined input, nullable dates and
JSON, scalar/combined updates, actual native metadata/data normalization,
Label replacement and original retained inverses. Separate corrected preimage
behavior from unchanged native JSON merge residuals. Check missing/historical
roots and Label identities, existing state without invented guards, maximum
graphs, protected references, actual late failure and repeated cancellation.

Validate malformed input, projection/receipt/event tampering, authority and
borrowed-resource lifetimes, replay/conflict, no publication on failed atomic
roots and measured resource bounds. Run PGlite and focused ordinary-role
PostgreSQL separately, then creation/Return/cancellation/Shipment/Delivery and
mixed-constructor regressions, affected types/builds, source/provenance/browser
portability guards, lint and both required project reviews before a scoped
implementation commit. Whole-root rollback does not replace native retained
business compensation.

Product chunked file import and Product export remain deferred. Exact JSON
snapshot restoration, durable standalone execution, remote effects, populated
upgrades, broader Order/Return lifecycle and hosted activation are separate.
