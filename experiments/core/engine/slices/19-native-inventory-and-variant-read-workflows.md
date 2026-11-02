# Inventory deletion and complete Variant read workflows

Status: **Replacement construction and Core prerequisites implemented after
independent current-core, accepted-direction and pinned-source challenges.
Paired owner/native proof, complete consumer coverage, connected regressions and
project review are complete. Wider goal gates remain open.**

Baseline: `4e6059e1b112c9cd12d75e7aa3487e81b6854f1d`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
Medusa: `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline 2.13.4.

## Connected responsibility

Replace the three complete retained native consumer families named by
[Native18](./18-native-product-multi-source-workflows.md#complete-consumer-proof-and-retirement):
Inventory Item deletion, Variant/item Pricing and Variant Inventory confirmation.
Keep their genuine native services, SDK/Core Flows, setup commands, complete
default graph, retained inverses, observations, errors and results. Replace old
session-held construction through the current shared Core owners. A smaller
invented fixture or three successful import probes does not complete this scope.

| Consumer | Existing expanded cases | Fresh business bundle | Selected root |
| --- | ---: | --- | --- |
| `logical-inventory-item-delete-workflow.test.ts` | 20 | Eight sources, 30 tables | Inventory and rich VariantInventory Links; 64 calls |
| `logical-variant-item-pricing-workflow.test.ts` | 29 | Nine sources, 31 tables | Genuine nine-participant default graph; named 256-call allowance |
| `logical-variant-inventory-confirmation-workflow.test.ts` | 17 | Nine sources, 31 tables | Pricing child then confirmation through one combined Inventory participant; named 256-call allowance |

The base eight sources remain complete Product13, Pricing6, Inventory3,
StockLocation2, SalesChannel1, scalar ShippingProfile1, ProductLinks2 and combined
VariantLinks2. The ninth authentic source is
`commerce.link.sales-channel-location`, with `sales_channel_stock_location`.
Installed schema does not grant additional native methods. Pricing/confirmation
admit zero business events; preserve existing event ceilings, deadlines, raw-ID,
row/identity, call and byte policies. The Item deletion profile retains four raw
IDs, complete historical cascade bounds and the original 64-event ceiling.

Setup includes genuine stocking, reservations, adjustments, Level updates and
deletion, PriceList/PricePreference construction, rich Links and Variant flags.
Retained Item and Link inverses are separately admitted fresh roots over matching
predeleted history and unchanged-active restore evidence. They are not automatic
rollback callbacks or restoration of only forward-changed IDs.

## Independent challenge and renewed counterexample

Three independent read-only agents inspected current execution, accepted
guarantees and exact pinned mechanisms, then exchanged counterexamples. Their
initial conditional no-prerequisite assessment was superseded by the concrete
shared-lowering omission below. The renewed exchange agrees on that owner and
the complete consumer boundary; no unresolved guarantee change is established.
Existing full-goal authorization covers the correction and caller migration.

| Pinned mechanism | Required existing owner and invariant |
| --- | --- |
| `transaction.rs:174-197,1255-1338,1551-1562` | One pending/read/index/metadata owner, prepared fallible writes and trusted outer finalization. No callback receives settlement authority. |
| `transaction_index.rs:163-325,386-390`; `query/index_range.rs:210-261` | Existing pending replacements/tombstones and consumed-prefix/EOF observations; returned body IDs or prefetch coverage do not prove complete membership. |
| `reads.rs:167-191`; `committer.rs:1035-1050` | Validate relevant published and accepted-but-unsaved changes through current owners. Preserve the selected native capture granularity and conflict verdict rather than substituting Application snapshot/event-conflict semantics. |
| `committer.rs:925-977,1060-1119` | One coalesced write set, persistence ACK as commit, ordered publication and recovery before unsafe callback reexecution. |
| `bootstrap_model/schema/mod.rs:164-215` | Compose authenticated producers before the existing shared installation/validation/activation lifecycle. |
| PostgreSQL `sql.rs:257-263,883-886`; `lib.rs:515-617` | Five physical tables, timestamp-matched index hydration and one fenced persistence transaction. All native business and lifecycle records stay logical. |

### Inferred reverse access correction

Expected: complete Item-endpoint Link history is selected through its admitted
unconditional reverse access, including predeleted rows and absence, with work
bounded by that endpoint's cohort. Original static path:

1. `links/inventory-item-deletion.ts:75-89` requests the genuine rich Link with
   `maximumRows:8` and `completeHistory:true`.
2. `links/repository.ts:83-86` selects `inventory_item_id` without a `deleted_at`
   predicate. Its primary key is `[variant_id, inventory_item_id]`; the declared
   Item index is active-only and lowers to `[deleted_at, inventory_item_id]`.
3. Protocol `relational-schema/access.ts:10-32` already derives
   `key-reverse/inventory_item_id`. Legacy read metadata and working sets consume
   it, but `core/nativeRelationalSchema.ts` originally emitted only declared and FK paths.
4. `planCoreNativeQuery` fell back to `kind:"all"`. The transaction then captured
   and hydrated the full `by_id` interval before residual filtering. Unrelated
   Links could exhaust a valid endpoint's capture bound or widen its dependencies.

This was a shared schema/access-lowering defect, even when isolated consumer cases
fit within the whole-table bound. The pre-correction neutral witness reproduced both
the `all` plan and `CoreTransactionError` capacity refusal with cause
`Native complete index capture limit`, while the selected active/deleted cohort
fit the unchanged bound. The corrected regression preserves that bound and proves
the selective indexed path. Its dedicated
[native inferred reverse-index adaptation](../divergences/native-inferred-reverse-indexes.md)
owns the difference from explicit Convex ordinary-index declarations.

The implemented correction belongs to `lowerCoreNativeRelationalSchema`. After its
existing FK loop, it consumes existing `relationalReverseIndexes(table)`, reuses actual
emitted unconditional leading coverage, then adds only missing ordinary scalar
paths with the authenticated native descriptor and existing legal Core name.
Preserve existing declaration/FK order, names, descriptors and conditional
prefixes. A conditional prefix cannot cover an unqualified historical read.
Conflicting descriptors must fail closed through existing definition validation.
Do not add an endpoint FK, uniqueness rule, membership document, adapter-specific
index, query algorithm, physical family or larger capture limit.

Composite-key definitions already include their serialized lowered schema in
`definitionHash`; exact indexes also enter native and bundle metadata. Affected
generated identities must change, unaffected definitions must remain identical,
and cold authentication must refuse the old affected proof. No global lowering
version bump is required solely to change unaffected definitions. This fresh
slice establishes no populated Medusa successor, reset or data conversion.
The protocol's broader `textEquality` coverage versus Core's skipped ordered
lowering is outside this correction's claim.

### Native scope-exclusion prerequisite

The initial genuine Item fixture refused Create Reservation preparation with
`unsupportedProfile`, before the business witnesses, because Core did not admit
the composed Locking resource's selected scope-exclusion mode. Adjustment selected
the same mode, and all three families reach this setup closure. The failure was
independent of participant capacity and Task selection.

The renewed independent challenge confirms callback exclusion is an accepted
native guarantee distinct from OCC. The
[shared exclusion prerequisite](./19a-native-scope-exclusion.md) and
[dedicated divergence](../divergences/native-scope-exclusion.md) own the precise
writer/callback boundary, implemented trusted Core mechanism and proof gates.
Paired owner and genuine native proof cover selected exclusion while preserving
ordinary callback concurrency and the original stale-deletion races. Preserve
the selected mode, genuine setup and original limits through complete consumer
verification.

### Other challenged seams

Confirmation's two memberships plus active predicate already become bounded
Cartesian points over the declared InventoryLevel compound unique key. Empty
Locations produce zero selections. Pricing reads complete indexed cohorts,
validates exact/raw numeric companions and delegates actual selection to the
promoted Medusa helper; non-equality PriceRules remain refused. Neither path
justifies numeric ordered indexes, SQL aggregates, serial allocation or casts.

Pricing/confirmation may produce zero final business writes. They still retain
the complete native observation packet and durable DTO outcome, including
recovery/replay before native callbacks. An empty-change shortcut must not drop
reads or inject outcomes. Preserve full Causes at actual native boundaries;
do not assume every native TypeError or caught callback has two typed reasons.

Relevant persistent membership/revision changes, including accepted-unsaved
changes, retain their existing native verdict. Do not strengthen that contract
into a promise that every transient Source key event must conflict. Item/Link
restoration preserves the shared complete-history lifecycle and independent fresh
root, not a second lifetime or settlement authority hidden inside an adapter.

Reuse the existing divergences for
[native query plans](../divergences/native-relational-query-plans.md),
[ordinary-index observations](../divergences/native-ordinary-index-observations.md),
[direct-read visibility](../divergences/native-direct-read-visibility.md),
[root participation](../divergences/native-root-participation.md),
[schema composition](../divergences/native-schema-composition.md),
[partial-index lowering](../divergences/native-null-partial-index.md) and
[Promise/failure preservation](../divergences/native-promise-draining.md).
Actual execution may expose another shared defect; preserve that witness and
renew its source challenge before correcting the owner.

### Fixture lifetime and native observations

The shared fixture's prepared-host ceiling is a live lease bound. Repeated
preparation creates new leases even for equal contracts; retaining every test's
hosts until suite shutdown exhausts that bound during genuine seed construction.
Keep the permanent bundle, app owner and setup hosts for the suite, and close
each case's transient hosts through their existing registered close operations.
Do not increase the ceiling or change the complete native graph to fit it.

Inventory confirmation preserves the native graph's Level-ID order when building
Location arrays. Generated native IDs have random suffixes and do not promise
creation order within one timestamp. Derive fixture expectations from the actual
created Level IDs already present in native stocking outputs. The native shared
Location union follows graph encounter order; the fully stocked default graph's
first Item supplies its complete initial order. Preserve strict DTO equality,
native reads and output order without extending the admitted Level input.

Failure witnesses inspect the complete Exit/Cause. Effect.result selects a typed
failure and can discard sibling native defects in a mixed Cause, such as a real
TypeError plus rollback-only refusal. Keep native message, defect, sticky-failure
and rollback assertions over the full result rather than changing error mapping
or accepting a narrower typed projection.
Injected plain Errors retain their original defect identity and rollback-only
failure, matching the existing Native18 failure contract. A Legacy transport's
adapter-failure tag is not a replacement for that assertion; genuine Medusa
business errors retain their native type and message checks.

## Coordinated ownership and sequencing

- Shared-lowering worker: `core/nativeRelationalSchema.ts`, its neutral schema
  tests and focused two-driver reverse-index scenario. Author the red witness
  first; root executes it before the runtime correction. Own deduplication,
  identity/cold-proof and membership/dependency evidence.
- Producer worker: the thin authentic Core compiler in
  `src/links/sales-channel-location-schema.ts`, reusing capture and generic
  lowering. Do not duplicate the native declaration or alter endpoint semantics.
- Fixture worker: narrow optional ninth-source support in the existing
  `core-product-creation-fixture.ts`, the three complete replacement fixture
  closures and displaced-construction removal. Reuse
  `createCoreNativeWorkflowFixture` for one shared bundle/app owner, initializer
  commands, hosts, observations and recovery. Keep the eight-source default for
  Native18/Item deletion; Variant read families select the ninth source explicitly.
- Consumer worker: all three original suites and native workflow witnesses,
  preserving business assertions, budgets, races and authentic failure evidence.
  Coordinate the fixture interface before migrating callers.
- Root: documentation, source/provenance, serial validation/resources, independent
  reviews, exact integration and scoped commit. Workers own explicit files and
  preserve concurrent edits; none stage, commit or run competing heavy jobs.

Dependent consumer proof waits for the shared-owner correction and its focused
regressions. No fixture or adapter may filter around the missing owner behavior,
raise bounds or implement another storage/transaction path.

## Required proof and retirement

The neutral witness uses a composite `[left,right]` key, active-only right index
and unconditional right selection. Before the fix its plan is `all`. Prove after
the fix that selected active/historical rows fit their original bound while
unrelated endpoint rows exceed it. Cover unconditional/FK coverage reuse,
descriptor collision refusal, preserved uniqueness and absence of invented
endpoint-existence semantics. Exercise empty membership, pending insert/move/delete,
selected versus unrelated changes and relevant published/accepted-unsaved changes
on PGlite and ordinary-role PostgreSQL. Prove affected/unaffected metadata,
fresh cold reopen and rejection of mismatched old installed proofs.

The complete original three suites have passing coverage for all 63 applicable
PGlite cases and all 66 ordinary-role PostgreSQL cases. PGlite coverage combines
the complete corrected Item suite with the unchanged complete Pricing and
confirmation suites; it is not one fresh aggregate run. PostgreSQL covers all
66 cases in one complete run, including the three existing database-only races.
The three conditions are Item deletion's competing reservation, adjustment and
absolute commits. Preserve complete historical cascades, exact default DTOs,
Pricing Rule/context behavior, native missing/empty/error branches, original
limits, late conflict, fresh inverses, revocation and callback-free outcome
recovery. Add meaningful genuine unrelated-history and empty-membership witnesses.
Installation credentials remain separate from serving credentials; the retained
owner-operated Legacy harness is characterization, not replacement-role proof.

Run affected shared/native owner and Native17/18 consumer regressions, source and
promotion guards, portability/canonical-host checks, Oxc fast checks, core/diff
and exact-index lint, and both required independent project reviews. Broader host,
deployment, scale, performance and populated-conversion claims retain their
separate gates. Stop owned runtime/database resources after validation.

The three displaced standalone fixture files are retired. Keep
`LegacyBatch -> LegacyDeletion -> LegacyUpdate -> LegacyCreation`: paused Task
inline-import/recovery still owns that chain's removal gate. Generic Legacy
Currency, Inventory, Pricing and Sales fixtures also retain separate named
consumers. This slice neither resumes those sessions nor removes unspecified
durable data. The full rewrite goal remains active after this bounded replacement.
