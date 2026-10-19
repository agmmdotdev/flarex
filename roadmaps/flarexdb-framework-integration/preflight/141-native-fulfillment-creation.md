# Native Fulfillment creation preflight

Status: implemented for the private bounded local Manual create/cancel profile.
Public/hosted activation and broader Fulfillment lifecycle composition remain
unadmitted. The genuine default
MikroORM/PostgreSQL comparison succeeds for the complete bounded root and actual
retained cancellation. The separate unchanged Drizzle/SQLite root remains
blocked at native Address-filter translation. No native business correction or
shared-core extension is established by this preflight.

## Selected outcome and source

Implement the literal `createFulfillmentWorkflow` after Shipping Option
creation, update and deletion. The pinned source contains no
`batchShippingOptions` workflow; its Rule batch is already covered by
[136](./136-native-shipping-option-rule-batch-workflow.md). Shipping Option price
calculation needs the broader Cart graph and a provider that calculates prices;
genuine Manual calculation refuses and is outside this outcome.

Authority is `third_party/medusa/SOURCE.json`, revision
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline 2.13.4. Native paths
below are relative to `third_party/medusa/upstream/`:

- `packages/core/core-flows/src/fulfillment/workflows/create-fulfillment.ts`:
  genuine singleton Location query, input/Location transform and creation step.
- `packages/core/core-flows/src/common/steps/use-remote-query.ts`: actual
  deprecated Remote Query with direct `variables: { id }`, `list: false` and
  `throw_if_key_not_found: true`.
- `packages/core/core-flows/src/fulfillment/steps/create-fulfillment.ts`: native
  creation and `StepResponse(fulfillment, fulfillment.id)`; the retained inverse
  calls native `cancelFulfillment(id)`.
- `packages/modules/fulfillment/src/services/fulfillment-module-service.ts`:
  initial nested creation, genuine provider call, provider-result update,
  original-object serialization, failure cleanup and cancellation guards.
- `packages/modules/providers/fulfillment-manual/src/services/manual-fulfillment.ts`:
  genuine local create result `{ data: {}, labels: [] }` and cancel result `{}`;
  no external request is sent.

The workflow invokes no hook, external workflow event, Link mutation, Order,
Cart, Pricing, Inventory or provider-pricing method. Inline order is passed to
the provider and removed before persistence. The appended Location is transient
provider context, not an invented persisted relationship. Native location and
item line/inventory IDs are text fields; they grant no endpoint mutation.

## Verified native envelope

The complete default-backend matrix ran one root with zero or one delivery
address, zero to four items and zero to four caller labels. It used one existing
Location, an optional Location Address, genuine Manual registration and an
optional existing Shipping Option. Ten owned rows is the observed creation
maximum: one root, one Address, four Labels and four Items.

| Input | Actual unchanged native behavior |
| --- | --- |
| `items: []` or `items: null` | Success with `items: []`; no Item rows |
| Empty delivery Address `{}` | Creates one Address with nullable fields |
| Missing or null delivery Address | Success; no Address row, stored FK null; original create DTO omits both relation and FK |
| Quantities `0.125`, `0`, `-1` | Success; exact raw quantity companions preserved |
| Invalid nonnumeric quantity | Native refusal; no created graph remains |
| Optional Option omitted or null | Success; omitted FK stays absent in create DTO, explicit null stays null; storage is nullable |
| Historical existing Option | Success; no Option restoration or mutation |
| Missing Option or Provider row | Native relationship-not-found refusal before graph persistence |
| Missing/historical Location | Native singleton not-found refusal before creation |
| Persisted Provider without implementation | Native registration refusal after initial graph creation, followed by native cleanup |
| Raw Address/JSON values | Case, whitespace, nulls and nested JSON retained |
| Packed, shipped, delivered or canceled business dates | Creation succeeds; native cancellation rules apply separately |

No positive/integer-only quantity rule or required Address rule may be added.
Public identity/managed-stamp exclusions and aggregate bounds remain distinct
from native business validation. Omitted items and explicit null labels were
not separate target cases in this matrix; any additional public grammar branch
must follow its actual owner and receive focused evidence before a broader
compatibility claim.

## Provider update, result and event contracts

The native module calls Manual after initial persistence and then performs the
real update with its returned data/labels. Preserve these observed distinctions:

- Populated input data is retained in both creation output and storage when
  Manual returns an empty object. The empty native JSON update produces no
  changed root, timestamp or additional update event in that branch.
- Omitted or null input data returns `data: null` in the original creation DTO,
  while the provider update persists `{}`. A separate genuine post-create read
  returns `{}`. The returned creation timestamp/state and final persisted state
  are separate observations; do not replace the original DTO with a fresh read.
  This branch emits a real root update event.
- All four caller Labels survive Manual's empty labels array with their original
  IDs. An empty update array does not clear the collection in this native path.
- Creation returns full owned Address, Items and Labels, native exact numeric
  companions and nullable/default fields. Provider is an ID reference. The
  creation DTO can omit the Shipping Option reference object while a later
  native read exposes its ID reference. Do not infer arbitrary relation hydration.
- Native scalar retrieval left-joins Provider, Shipping Option and delivery
  Address with each target's active-row filter. For an existing historical
  Shipping Option, creation retains the supplied FK in its first DTO, while a
  later native read or cancellation DTO reports both `shipping_option_id` and
  `shipping_option` as null. The stored FK still references that historical row:
  cancellation updates only its date and managed update timestamp. Preserve
  this read visibility without changing the persisted relationship.
  The [standalone cancellation preflight](./143-native-fulfillment-cancellation.md)
  further distinguishes native owning relations: historical Provider and
  Address retain their ID references/FKs through `hasOneWithFK` initialization.
  The Shipping Option observation does not establish masking for those kinds.
- Native module events are internal. The maximum populated-data case emits
  Address-created, root-created, four Label-created and four Item-created
  messages in that observed model grouping. Nullable-data conversion adds a
  root-updated message. There is no external workflow event to clear.

Receipts must correlate the initial create result, later provider update,
actual mutations, selected reads, native result and events. A result is not
required to equal the final stored row merely because it belongs to the same
logical module call. Preserve this source-owned distinction with precise
activity evidence rather than permitting unrelated results or edits.

## Actual retained compensation and failure

The real serialized StepResponse is retained in native
`TransactionContext.invoke["create-fulfillment"].output`; its `compensateInput`
is the actual created Fulfillment ID and matches the genuine cancellation call.
Native SDK `create-step-handler.ts` calls `StepResponse.toJSON()`, which reads
the private field directly; the prototype getter log is not retention evidence.
The final packet records that actual serialized object and ID explicitly as
read-only diagnostics. No rebuilt payload is used by the scheduler or callback.

Ordinary genuine cancellation succeeds and keeps root/Address/Items/Labels. It
stamps only the Fulfillment's `canceled_at` and managed update time, emits the
real root-updated event and invokes Manual cancellation once. A root created
already canceled returns its original cancellation date without another
provider call, mutation or update event. Repeated scheduler cancellation is
idempotent and does not invoke the module again.

Creation with shipped or delivered state succeeds, but its retained inverse
fails through the existing native guards before Manual cancellation. The
scheduler reports `failed`; actual module errors identify already-shipped or
already-delivered state even when its returned errors array is empty. Preserve
that native failure and its still-existing graph.

A late parent failure invokes the genuine cancellation callback: an ordinary
created graph remains canceled and the native parent reverts. With shipped
input, cancellation refuses and the parent fails, leaving the shipped graph.
These retained native outcomes are distinct from failed Flarex atomic execution,
which must publish none of the staged graph, history, facts or events.

A persisted-but-unregistered Provider demonstrates actual native exception
cleanup: the initial root and Item rows are deleted, while the created Address
remains orphaned. Missing endpoint and invalid quantity failures leave no graph.
Keep the orphan witness as native independent-transaction behavior; do not add
an Address cleanup workaround. Portable failed-root rollback must leave no
orphan or other staged result because its outer atomic owner settles nothing.

## Query and backend comparison boundary

The exact Location query returns its selected root fields and Address fields,
or `address: null`; final Query output omits helper `address_id`. Native module
read output can contain that FK before Query projection. A selected reader must
prove both representations and preserve missing/historical Location refusal.

All eight PostgreSQL Query/module controls succeed. They cover scalar fields,
full Address projection with direct and nested IDs, genuine Address hydration,
the generated undefined relation filter, explicit empty and actual-identity
relation filters, and the graph Query API.

The corresponding eight unchanged SQLite controls have four successes and
four refusals. Scalar Query, direct Address hydration and explicit empty/real
identity relation filters succeed. Full callable Query with either ID shape,
exact generated `address: undefined` module filter and full graph Query all
refuse `Unknown filter field "address"`. Actual models, relationship hydration
and GraphQL Address registration are present; this is not a missing model.

Native `remote-fetch-data.ts` deliberately supplies the undefined relation
argument, and `build-query.ts` preserves it. Drizzle's `toMedusaDrizzleWhere`
falls through to scalar `toDrizzleWhere` for that value. The genuine default
`mikroOrmCreateConnection` explicitly selects `ignoreUndefinedInQuery: true`.
The successful native comparison therefore uses original MikroORM conversion,
repositories, service loaders, serialization and connection configuration.
It does not repair or claim success for the preserved Drizzle root. No native
business/public behavior is changed by selecting this authentic comparison.

## Proposed implementation and verification

1. Promote only the literal creation workflow/step and extend the actual common
   Remote Query owner for this singleton direct-ID/list-false/missing-key ABI.
   Preserve native field projection and fail-closed unsupported options.
2. Compile a fresh twelve-table Fulfillment definition in the existing source
   lineage: add Fulfillment, FulfillmentAddress, FulfillmentItem and
   FulfillmentLabel to the existing eight tables. Address provenance is
   `models/address.ts`. No populated upgrade is included.
3. Reuse `defineFulfillmentPersistenceModule`, genuine Manual registration and
   existing graph/numeric/read/event owners. Admit root creation, its real
   provider-result update and exception cleanup internally, and native
   cancellation solely for the selected root/inverse. Expose no general CRUD.
4. Reuse the existing Stock Location Address read owner through graph-only
   selection. The basic scalar reader is insufficient. Authenticate both module
   pre-projection helper keys and final selected Query shape; do not hydrate or
   validate relationships through adapter-specific glue.
5. Prepare the two-participant root with a strict public runtime grammar and
   exact native result/receipt/event correlation. Protect all existing source
   tables and unrelated rows. Preserve nullable inputs, signed exact quantities,
   data/Label semantics and genuine callback failures above.
6. Bind the complete root and retained inverse to the named 128-call allowance,
   existing 64-event and 1 MiB limits, and a 30-second command lifetime. The
   nullable ten-row graph plus cancellation requires 65 calls and twelve
   messages; populated data with repeated cancellation requires 69 calls.
   Native SQL counts do not establish this allowance. Shared defaults,
   ceilings, locks and other profiles remain unchanged.

The checked Medusa compiler grammar must retain the actual native
`hasOneWithFK` relationship variant used by Fulfillment's Provider and delivery
Address. These are owning single-FK relationships; they lower through the
existing shared reference/constraint mechanics. Retaining that native metadata
variant grants no repository capability and requires no SQL/core exception.

The selected Manual update admits exactly `data: {}` and `labels: []`.
MikroORM's `manager.assign` uses `mergeObjectProperties: true`: its
`EntityAssigner` object branch retains an existing plain data object for this
empty assignment, and otherwise assigns `{}`. A named finite value translation
and JSON equality preserve that dirty-tracking result; this does not introduce
an arbitrary provider merge algorithm. A descriptor-safe module boundary
normalizes genuine native `Date` instances only for the declared business date
fields. Public managed timestamps and caller identities remain unadmitted.

The selected exact-quantity path also reuses native `trimZeros`, matching
`MikroOrmBigNumberProperty`'s raw companion representation after the existing
exact numeric capture. Other module profiles retain their current encoding.
Scalar reads populate the three owning references through the shared relation
owner. Historical targets remain valid stored FKs but are hidden in native
read/cancellation DTOs; receipt proofs authenticate indexed candidates before
active-row projection and never rewrite those stored FKs.

The native creation step passes the explicitly selected Stock Location
projection to the service, rather than a complete StockLocationDTO. Its type
seam must describe that partial projection (including the nullable selected
Address), with no runtime field additions or behavior change. The common Query
owner and Stock Location reader retain their own projection proofs.

Validation must cover actual retained callbacks, null/omitted distinctions,
original-output versus final-state receipts, no-op updates, event order,
negative capability/forged result/read evidence, scope/replay/lifetime,
cancellation, late/caught failure and resource overflow. Run PGlite and focused
ordinary-role PostgreSQL independently. Regress existing Shipping
Option/Profile/Zone and installed deletion consumers against the new fresh
schema, especially physical Option deletion with added Fulfillment references.
Do not silently change any existing FK, cascade, deletion or compensation rule.

No new core mechanism or native business correction is needed by the evidence
so far. Discovered owner gaps retain their own witnesses and review gates.
Standalone Fulfillment update, shipment, return creation, public cancellation,
delivery locking, Cart calculations, external providers, populated upgrades
and hosted activation remain later outcomes. Chunked Product file import and
Product export remain deferred.

## Connected physical-deletion gate

Physical Option deletion with existing Fulfillment references is outside this
create/cancel profile and must be qualified before broader composed lifecycle
support. Both unchanged native backends clear `Fulfillment.shipping_option_id`,
preserve the Fulfillment timestamp and emit no Fulfillment update event.
PostgreSQL uses its `SET NULL` FK; Drizzle's `medusa.ts:detachDeletedRelations`
implements the non-cascading `hasMany` detachment before deleting the Option.
The compiled SQLite FK's `NO ACTION` alone therefore does not describe native
business behavior.

The current shared Medusa `repository/lifecycle.ts` physical path traverses
cascade FKs; `physical-graph-receipt.ts` correlates that delete closure. Native
metadata-derived detachment and exact receipt coverage belong at those shared
owners, using the existing core set-null primitive with managed updates
preserved. Pending rows, historical dependents and same-root deletion visibility
need their own proof. Do not add direct SQL, ordinary managed patches, relaxed
FKs, or a creation-specific cleanup workaround. No FK rule is changed here.

The separate native packets are
`unchanged-native-foreign-keys-postgres-runs/2026-10-18T17-22-35.226Z-24672/report.json`
and
`unchanged-native-foreign-keys-drizzle-runs/2026-10-18T17-22-35.212Z-21864/report.json`
under the external witness folder below. Each covers active and historical
references plus an unlinked control with an unrelated protected graph, and
retains actual DDL/catalog constraints, SQL, raw rows and events. All owned
native fixtures were cleaned. This establishes the next owner preflight;
it does not establish portable physical-deletion parity.

## Evidence and limits

External packet: `%TEMP%/flarex-141-native-fulfillment-create-witness`.
The full default-backend index is
`unchanged-native-postgres-v4-runs/2026-10-18T16-16-55.941Z-6264/report.json`, with
36 complete per-case JSON artifacts and their hashes: 28 target/parent cases
plus eight Query controls. Genuine services/provider/Query/SDK and native SQL
remain unchanged. Each case used two run-owned schemas under an ordinary role;
all fixtures and schemas were cleaned. This is native characterization, not
Flarex database validation, full default-app bootstrap, durable workflow engine,
restart, arbitrary provider or hosted evidence.

The separate SQLite evidence is the original nominal report
`unchanged-native-runs/2026-10-18T15-51-32.842Z-9032/report.json` and controls
`unchanged-native-controls-runs/2026-10-18T16-02-32.009Z-20208/report.json`.
Both remain unchanged. Earlier PostgreSQL candidates exposed observer Proxy
recursion, cyclic ORM inspection and aggregate artifact-size faults. Their
preserved reports/logs establish harness causes and are excluded from native
business conclusions; the final packet removes repository interception, skips
native accessors and bounds only diagnostic inspection text. Complete plain
DTOs, selectors, rows, SQL, events and actual retained IDs remain in case files.
