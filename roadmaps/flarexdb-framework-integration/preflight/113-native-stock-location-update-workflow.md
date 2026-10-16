# Native Stock Location Update Workflow

## Status And Authority

Status: implemented private bounded update profile.
Chunked File import and Product export remain deferred. Authority is the accepted
Flarex design, package boundaries, Medusa adoption roadmap and Medusa 2.13.4
pinned at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island remains
read-only. Record 97 admits Stock Location creation and Inventory levels; record
99 admits Sales Channel links. Neither admits this update closure.

## Native Closure And Source Map

| Pinned source under `third_party/medusa/upstream/packages` | Executing owner |
| --- | --- |
| `core/core-flows/src/stock-location/workflows/update-stock-locations.ts` | Promote native composer with narrow imports |
| `core/core-flows/src/stock-location/steps/upsert-stock-location-addresses.ts` | Promote native Address upsert/preimage/compensation step |
| `core/core-flows/src/stock-location/steps/update-stock-locations.ts` | Promote native Location update/preimage/compensation step |
| `modules/stock-location/src/services/stock-location-module.ts` | Already promoted genuine service; admit named forward methods |
| `modules/stock-location/src/models/stock-location-address.ts` | Complete checked Address DML and nullability |
| `core/utils/src/modules-sdk/medusa-internal-service.ts` | Native selector expansion, metadata merge and events |
| `database/drizzle/src/medusa.ts` | Existing-row merge, complete persistence validation and no-op update evidence |

The composer always queries `stock_location` for `id` and `address.id`, including
zero matches and updates without an Address. A truthy `update.address` produces
one upsert entry per selected Location, using the attached Address ID when
present. Native upsert partitions by truthy ID, creates before updates through
native `promiseAll`, then flattens created results before updated results.
The workflow always runs the Address list/upsert step, including empty arrays.

The composer strips both `address` and `address_id` before the Location update.
It discards the upsert result and never attaches newly created Address IDs.
Consequently an addressless target creates a standalone Address. Native composer
and connected witnesses characterize this behavior without changing the pinned
business algorithm. Attaching new Addresses would be a separately scoped Medusa
business correction.

The genuine service updates all selector matches but returns `serialized[0]`,
despite the native array return annotation. Zero matches succeed with undefined;
the composer does not dereference that result. Reuse the existing private
optional-service transport from record 111 and the existing completed-undefined
to public-null boundary. Do not synthesize an array or missing-row failure.

The promoted module interface, service annotations and workflow declare the
actual scalar-or-undefined result. Address update/upsert declarations permit
partial patches while the creation input remains strict. The named Stock
Location type-only source category admits exactly the module service and its
two native type files; the shared emitted-JavaScript guard also retains the
existing Sales Channel checks. These declaration corrections change no native
runtime algorithm.

No workflow EventBus, hook, Link, Inventory, Store, Locking, File, Region, provider
or remote effect belongs to this closure. Genuine module events still require
authenticated capture and settlement through `internalModuleWorkflowEvents`.

## Partial Address Updates And No-Op Behavior

Address `address_1` and `country_code` are nonnullable without defaults. They are
required for a new row, but an attached Address can receive a partial patch:
native internal update reads the existing entity, and Drizzle validates the
merged complete persistence row. City-only, metadata-only and empty patches are
therefore valid for attached Addresses. The DTO's required fields do not define
the executing patch contract.

For an addressless target the same patch takes the create branch. Missing
required fields fail native persistence validation. A mixed attached/addressless
selection must preserve that failure and roll back the whole root. Patch and
preimage decoders must not require omitted fields; complete result decoders
still require the full stored row. Explicit null for a nonnullable field fails.

The native Drizzle `shouldUpdateRoot` path skips scalar writes and update events
for an empty root update. Address-only input becomes such a root update after
stripping. Preserve Location `updated_at` and the absence of its update event.
Preserve native ordered metadata merging across selector matches.

## Connected Owners

1. Promote the composer and two steps only. Reuse the existing portable query
   step and helper imports, add narrow package exports and exact provenance.
   Selector return declarations express scalar-or-undefined through the existing
   type-only, emitted-JS-equality guard. Narrow namespace/query type imports
   close the portable type graph; the create ABI is unchanged.
2. Add a named Stock Location update-workflow profile with real
   `listStockLocations`, `listStockLocationAddresses`,
   `upsertStockLocationAddresses` and `updateStockLocations` bindings. Preserve
   existing read/create profiles and unrelated method refusals. The native graph
   additionally needs real list/count and optional Address population.
3. Extend the existing module repository through checked metadata, complete
   catalog/projection/population owners and the real belongs-to FK. Add bounded
   Address scalar create/update and Location keyed update using existing
   `compileKeyedUpdates` and authentic mutation dispatch. No adapter SQL or
   fabricated relation reads. Existing `GraphRelationPath.optional` supports the
   absent to-one case; `queryWorkflowGraph` already checks complete omitted-
   pagination results. No shared graph correction is statically required.
4. Extend the named receipt/event policy for partial native preimages, complete
   results, Address create/update order, Location no-op/absence and exact actual
   facts. Standalone Addresses are legitimate native results, so validation
   cannot assume every Address has a Location owner. Use the existing optional
   service envelope for Location selector results; Address upsert remains array
   valued, including empty results.
5. Add `src/workflows/stock-location/update.ts`, binding this module's genuine
   graph and forward methods under the existing atomic owner. Reuse native
   preimage configuration/selection and module-only event policy. No new
   settlement, serializer or optional-result mechanism is needed.

Both tables and their FK already exist. No source lineage change, durable reset
or schema migration is implied. The mixed native Address upsert witness reaches
`overlappingOperation` inside one command despite root queuing. The correct-owner
[borrowed scheduling extension](../../shared-transaction-core/73-borrowed-commerce-operation-scheduling.md)
adds a separate identity-bound selection for DAL work, with a FIFO per command
and child borrow. The generic repository bridge captures native input before
waiting and consumes that capability; it does not add an adapter queue. Existing
profiles, low-level overlap checks and resource ceilings remain unchanged.

## Admitted Bounded Profile

Admit zero to four actual matched Locations and four touched Addresses. ID/name
selectors may be scalars or arrays of up to four, supported combinations or an
empty selector. A fifth match must fail before writes. Refuse operators, `q`,
unknown and managed fields outside this profile.

Admit name, nullable metadata and native Address patches. `address_id` is admitted
with explicit ignored-input coverage, preserving the composer's stripping
behavior. Nested caller-supplied Address IDs remain refused: native spread would
override the selected ID and needs separate admission. Partial Address keys use
their DML nullability; creation validates the complete new row in its actual
branch. Current call/event/byte/catalog/identity/working-set limits remain.
Maximum attached and mixed Address graphs exercise four Locations and four
Addresses, including native creation and update branches under the same root.

## Compensation And Verification Gates

Retain both genuine compensation callbacks with `transactionCovered` metadata.
Location compensation skips empty preimages and otherwise upserts selected id,
name and truthy metadata/address fields, including undefined name in partial
preimages. Address compensation calls native delete/upsert for truthy arrays,
including empty arrays. Use pure callback witnesses; independently executing
these inverses would need additional update/delete/cascade admission. The live
forward profile need not expose compensation-only methods. Address DML's delete
cascade toward Locations makes generic address-delete admission inappropriate.

Prove zero/one/four/fifth selection, filter ordering/duplicates, scalar-first
results, successful absence/public null, optional Address reads, mixed attached
and addressless targets, standalone creations, ignored `address_id`, partial
patches, create-before-update order, root no-op and native preimages/callbacks.
Use pure native-composer witnesses for the source quirks before accepting them.

PGlite and ordinary-role PostgreSQL must separately prove exact results, module
events/facts, one settlement, late-failure rollback, mixed partial-create failure,
caught-refusal poisoning, replay/conflicts, scope isolation and bounded overflow.
Regress existing Stock Location creation, Sales Channel links and affected
Product consumers. Complete affected types/builds, source/provenance,
portability, lint and both required read-only reviews before a scoped commit.
General module parity, arbitrary compensation and hosted activation remain
separate gates.
