# Complete multi-source Product and Variant workflows

Status: **Bounded fresh eight-root Product/Variant replacement implemented and
validated after independent challenge and review. Shared predicate lowering,
complete failure propagation and selected consumer retirement are complete;
populated conversion, named retained consumers and wider goal gates remain open.**
Baseline: `402a06a99a01eb4131ac365c7dfa37efa2112f7c`.
Integration baseline: `f76b03d4f6d9e979ea5392033e6d2a776da57c41`, including
fresh public Application activation. Its optional candidate metadata and
system-table retirement path do not change this native-only bundle. The shared
integration retains actual public Application-host and native consumer proof.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
Medusa fork: `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline 2.13.4.

## Selected connected responsibility

Migrate the complete already-admitted Product and Variant create, update, delete
and batch roots through Native17's ordinary native atomic owner. Keep genuine
Core Flows/SDK execution, native services/repositories, method views, graph reads,
Links, hooks, errors, compensation declarations and results. Replace their old
SQL/session-held construction and consumer observation machinery in the existing
owners. A smaller invented workflow or generic module-fixture project would not
complete this responsibility.

The eight roots are `createProductsWorkflow`, `createProductVariantsWorkflow`,
`updateProductsWorkflow`, `updateProductVariantsWorkflow`, `deleteProductsWorkflow`,
`deleteProductVariantsWorkflow`, `batchProductsWorkflow` and
`batchProductVariantsWorkflow`. Their actual child closure includes Inventory Item
and Level creation, Link creation, Variant-price upsert and Inventory Item deletion,
including genuine empty calls and native undefined child slots.

| Business source | Complete producer tables | Selected runtime authority |
| --- | ---: | --- |
| Product | 13 | Existing Product/Variant method views and bounded native graph reads |
| Pricing | 6 | Selected PriceSet create/read/upsert/update/soft-delete and native exact values |
| Inventory | 3 | Selected Item creation/deletion, Level creation and bounded reservation reads |
| Stock Location | 2 | Existing graph reads only |
| Sales Channel | 1 | Existing graph reads only |
| ShippingProfile | 1 | Existing graph reads only; not the twelve-table Fulfillment producer |
| Product Links | 2 | Selected SalesChannel/ShippingProfile Link lifecycle and routing |
| Variant Links | 2 | Selected InventoryItem/PriceSet Link lifecycle and routing |

These are eight business participants and 30 business tables, in addition to the
existing private event families and Core system metadata. Preserve the combined
two-table `commerce.link.variant-links` lineage and router; Native16's separate
single-family fixtures are not its replacement identity. Installed schema does
not grant broader native methods or writes to graph-only endpoints.

## Independent challenge and pinned mechanism map

Three independent read-only agents inspected the current executing closure,
accepted direction and exact pinned source, then exchanged counterexamples.
They initially converged on this complete fresh consumer closure without
establishing a new shared-engine prerequisite. Initial inspection used Native17's
isolated checkpoint and was refreshed after its Application-cutover rebase.
The first actual complete-bundle installation supplies a counterexample: Pricing's
authentic PriceList index needs a shared predicate-lowering extension. The renewed
current, accepted-direction and pinned-source challenge converges on that owner; no
physical table or preliminary numeric-index project follows from this finding.
Static convergence is not runtime proof.

| Pinned mechanism | Existing owner and required translation |
| --- | --- |
| Convex `transaction.rs:174-197,418-454,1255-1338,1551-1562` and `writes.rs:315-342,453-459`: one pending/read/index/metadata owner, prepared fallible mutation and outer flattening | Reuse `core/transaction.ts` and `atomicCommerce/nativeExecution.ts`; no per-participant transaction, callback replay or fixture storage engine. Preserve rollback without refunding observations, attempted work or ID reservations. |
| `reads.rs:148-191,332-343,447-477` and `transaction_index.rs:386-390`: exact interval dependencies and consumed frontiers | Reuse native observations/pages, pending index overlays and query owners. Preserve complete reverse-Link ownership and examined activity; returned body IDs do not prove range completeness. |
| `committer.rs:914-977,1035-1058,1081-1119`: published/accepted-prefix validation, coalescing, fenced persistence and ACK as commit | One accepted write set, outcome and publication through current owners. Recover the complete committed DTO before fresh admission; never replay hooks to repair ACK loss. |
| `bootstrap_model/schema/mod.rs:164-215`: active/pending validation through ordinary writers | Compose authentic native definitions before the shared schema/build/activation lifecycle. Keep per-source issuer identity, policy and limits. |
| PostgreSQL `sql.rs:257-263,869-886` and `lib.rs:515-617`: five tables, same-timestamp hydration and one lease transaction | Keep all business, pivot, Link, event and lifecycle records logical above the existing physical persistence. No direct SQL repair or workflow-specific tables. |

Actual Price and InventoryLevel indexes use text/FK/active-null keys. No selected
serial allocation or ordered decimal/JSON index is required. Keep unsupported
capabilities closed. Exact amount/quantity/raw companions, defaults, precision,
cold validation and comparisons still require real consumer proof.

### Shared predicate-lowering correction

Expected: install all authentic Pricing declarations with the other seven
sources before executing the selected native workflow. Actual: the complete
installation refuses `PriceList_id_status_starts_at_ends_at_0` on `price_list`
before callbacks because the existing Core eligibility grammar and relational
lowerer lack `isNullAndTextEquals`. Its declared nonunique fields are
`[id, status, starts_at, ends_at]`; its condition is
`deleted_at IS NULL AND status = 'active'`. The original failing consumer is
preserved; selected assertions were not reached.

The coordinated correction belongs only to `core/nativePolicyTypes.ts` and
`core/nativeRelationalSchema.ts`, with neutral and genuine source tests in their
existing owners. Extend the [ordinary null-predicate adaptation](../divergences/native-null-partial-index.md)
with a text literal in the existing exactly-two-distinct-term, first-null
conjunction. Preserve all older shapes and identities. The resulting ordinary
index is `[deleted_at, status, id, starts_at, ends_at]`, with both native equalities
required for explicit conditional access. Broader finds still use its full
physical superset without acquiring an active-only condition.

The shared eligibility type also serves unique constraints. Include bounded
text-conditional uniqueness in neutral proof: null business keys, pending
eligibility transitions, conflicting claims and accepted predecessor failure.
This does not make the PriceList index unique or admit another Medusa workflow.
No Source index, transaction, query or persistence algorithm change is currently
justified. Pinned `index_config.rs:9-20`, `document.rs:507-516,1165-1185`,
`index_registry.rs:172-244,359-392` and `reads.rs:174-191` retain ordinary fields,
all-value old/new keys and conflict observations. No adapter repair, omitted
index, SQL partial index, budget increase or unrelated predicate extension may
replace this shared correction. Prove the neutral owner on both database lanes,
then rerun the original focused and complete connected consumers.

### Repository failure propagation and later capture

The complete native run supplies a separate failure-owner witness. Seven failed
budget/unique checks return the original typed failure, an extra rollback-only
refusal wrapping it, and the normal seal marker. `repository/context.ts` currently
catches already-failed Effect work and calls `ctx.refuse`, which admits a new
operation against the poisoned lifetime. The independent current/design/Convex
challenge and peer exchange identify this adapter propagation misuse; the Core
latch and genuine new-operation guard retain their contracts.

Correct `checked` through the existing `ctx.recordFailure` observation capability
and rethrow its owned complete Cause. Follow the established value/Promise-owner
pattern, retaining the original Cause together with any refusal to observe it.
No new operation, call/byte charge, transaction, lifetime, generic observer or
error-code/object-identity deduplication belongs in failure propagation. Prove
fresh pre-database refusal remains sticky, already-observed failures retain their
authenticated origins and complete mixed Causes, and revoked/foreign contexts
cannot alter another lifetime. Failure observation explicitly adds no calls or
bytes; it does not reproduce the previous accidental operation admission.

Earlier Product creation/lifecycle assertions also relied on that fabricated
first `rollbackOnly`. Direct unique failures now retain `invalidInput` with the
authentic `CoreNativeUniqueConflict` descriptor and fields; direct row/call
budget failures retain `limitExceeded`. Assert each complete two-reason outcome
with its seal marker. Keep original inputs, the 256-row bound, default 64-call
allowance and named 128-call allowance. A caught failure followed by a successful
callback still reaches the genuine later guard; its rollback expectation remains.

The supplied-ID, absent-Product update witness exposes another propagation seam.
Actual native upsert emits `product.created` before per-call receipt validation;
the selected existing-Product update profile refuses it as `unadmittedEvent`.
The original generic typed-refusal assertion did not promise `receiptMismatch`.
That later receipt check is not reached on this path. Preserve the actual first
guard rather than adding a created-event grant, moving validation or replacing
native upsert with an adapter lookup.

The full Cause contains the original event refusal, a fabricated rollback-only
check retaining that refusal, and the seal marker, with three distinct origins.
Product's event check catches the failure and calls `rejectLocalEvent`, which
re-enters `ctx.refuse`. Reuse the repository bridge's existing `checked` observer
with its deferred current context and remove the displaced error-only reentry.
The expected result is exactly the original `unadmittedEvent` plus the seal
marker. Prove fresh event-decoder failures, existing owned mixed Causes,
context/authority isolation, unchanged accounting and event invocation order.
Existing-ID success and genuine later-capture refusal remain separate controls.

Six caught-hook branches require a different result: private-source and Level
refusals during Product creation, the caught Variant-update method refusal,
and Level, quantity and reservation refusals during Variant Inventory creation.
The hook catches a
refusal and returns successfully; native result capture then attempts a genuine
new operation, which must still refuse. Preserve exactly the original typed
failure, the capture rollback-only refusal containing that original complete
failure, and the seal marker, with no hidden defects, interruption or additional
failures. Keep the Native17 two-reason helpers unchanged for their original
boundaries. The separate Result-to-Exit assertion audit must restore typed
refusal checks at preparation, input/body and post-seal boundaries rather than
accept any failed Exit.

The two Inventory SKU witnesses retain the existing shared projection:
`invalidInput` with the authentic `CoreNativeUniqueConflict` and
`IDX_inventory_item_sku` descriptor. Their original consumer contract requires a
typed commerce refusal and whole-root rollback, not a new native presenter.
This does not change the separate actual `MedusaError` classification or broaden
Inventory activation. Pinned `async_syscall.rs:694-767,821-831` distinguishes
actual operation failure and later return validation; its catchable handler
checkpoint is not silently substituted for the accepted native sticky lifetime.

The new repository-owner regression also exposes a shared origin-representation
defect: three independent Reasons survive observation and rethrow, but sealing
collapses equal Error/code occurrences because their empty object origin tokens
compare structurally equal in Effect RC112. The renewed independent challenge
and peer exchange select an issuer-only correction in
`boundedRequestLifetime.ts`: mark each freshly allocated private token with
official reference equality, including unissued classification-retirement
tokens. Keep WeakMap authority, origin deduplication/enrichment, first-chain
containment, guards, resource accounting and existing Cause joins unchanged.
The [native Cause record](../divergences/native-promise-draining.md#private-origin-equality)
owns this representation adaptation and its direct/projected/native aggregation
gates. Preserve the failing occurrence test; no adapter filter or assertion
weakening repairs shared failure loss.

The necessary native differences already have owners: [row values](../divergences/native-relational-row-values.md),
[query plans](../divergences/native-relational-query-plans.md),
[FK integrity](../divergences/native-relational-foreign-keys.md),
[conditional uniqueness](../divergences/native-conditional-uniqueness.md),
[native visibility](../divergences/native-direct-read-visibility.md),
[root participation](../divergences/native-root-participation.md),
[Promise draining](../divergences/native-promise-draining.md),
[event commitment](../divergences/native-event-policy-commitment.md),
[duplicate joining](../divergences/native-inflight-request-joining.md) and
[explicit noncommit retry](../divergences/native-proven-noncommit-retry.md).
Reassess those records against actual changes. New constructor wiring needs no
new algorithm exception; a newly demonstrated mechanism divergence needs its own
record before dependent implementation. Native17's selected REAL contract remains
settled and does not authorize unrelated approximation.

## Counterexamples and invariants

- Product creation without Variants still executes genuine empty Variant,
  Inventory Item/Level, Stock Location validation and Pricing children. Empty
  Product batch skips children; empty Variant batch executes all three regions.
- Omission and explicit empty arrays differ. New Variants with omitted/empty
  prices retain positional empty PriceSets. Product update silently omits missing
  Pricing Links; standalone Variant update retains its native error and rollback.
- Sparse Product update results do not enumerate the request-initial Variant
  cohort. Preserve authenticated old/incoming activity and native aggregate
  validation without fixture re-query or invented transcripts.
- Deletion ownership includes four selected Variants, two Inventory Links each,
  eight candidate Items, four inverse owners per Item and 32 inverse edges.
  Outside unmanaged Variants retain shared Items; false-flag Variants still
  participate in ownership where selected. Preserve full candidate history.
- Candidate Items retain their bounded Levels/Reservation closure. Positive
  computed reservation refusal can follow completed sibling creation; exact
  native error/full Cause and whole-root rollback remain required. Pricing
  deletion includes base and stored PriceList prices plus their Rule descendants.
- Batch `validateItemLifetime` refuses an Item attached by one successful sibling
  and requested for deletion by another, including the controlled interleaving
  after deletion's ownership reads. Rich Links intentionally have no endpoint FKs.
  Do not add those FKs or replace this restriction with a scope mutex or input-only
  disjointness rule. Existing overlapping Product/Variant update-delete inputs
  remain admitted.
- One root does not serialize the entire native graph or independent roots.
  Preserve authentic parallel regions, existing operation queues, default OCC,
  sticky caught refusal, full cancellation/drain, escaped-capability revocation,
  exact duplicate joining and callback-once committed recovery.
- Ordinary `transactionCovered` failure rolls back without automatically invoking
  native inverse callbacks. Keep genuine compensation declarations/input capture
  and resource accounting; separately admitted inverse roots retain their own
  profiles. None of these selected views needs currently refused reconstitution,
  recorded-row replay, preserving-deletion upsert or detach capabilities.

Medusa retains its existing continuation boundary. Its
[`promise-owner`](../../../../packages/medusa-adapter/src/module/promise-owner.ts)
revokes admission and joins tracked Effect runners and finalizers, then gives
foreign callback Promises the configured bounded cleanup grace before closing
their capabilities. Arbitrary blocked hooks do not prevent root completion
indefinitely. Core still joins owned operation workers and aborts the transaction
before returning failure. Cancellation witnesses must preserve interruption,
rollback, revoked late calls and unchanged state after the genuine callback is
released. The separate [Payload Promise-draining contract](../divergences/native-promise-draining.md)
does not strengthen Medusa's Promise-completion guarantee.

## Resource and authority boundaries

| Root | Native calls | Root bytes | Events |
| --- | ---: | ---: | ---: |
| Product creation | 512 | 1 MiB | 128 |
| Product update | 512 | 2 MiB | 256 |
| Product/Variant deletion | 512 | 2 MiB | 128 |
| Product/Variant batch | 1,024 | 2 MiB | 256 |
| Standalone Variant creation/update | 256 | Existing selected limits | Existing selected limits |

The separate Variant Pricing helper retains 128 calls. The SDK's 64-node
construction ceiling counts expanded, repeated and skipped children; batch's
57/32 prepared nodes prove composition admission, not parallelism or calls.
Preserve actual lifetime charging, per-source `catalogRows`, summed member
`facts`, identity/write/event/retained-byte bounds and independent Core attempted
read/write/byte/interval accounting. No historical Native12 union cap, single-family
Native16 cap or extra participant-default ceiling should replace the selected
profile. Do not raise limits or split settlement to make a fixture pass.

## Coordinated ownership

The producer owner adds authentic Core compilation beside the existing Pricing,
Inventory, Stock Location, Sales Channel, scalar ShippingProfile and combined
Variant Links producers, reusing current source/value/lowering owners. The fixture
owner constructs one app owner, shared bundle and actual native hosts/readers;
the consumer owner moves the complete existing suites and translates only old
SQL-specific observation/error instrumentation into real Core evidence. The
coordinator owns shared-owner corrections, neutral witnesses, source/provenance,
documentation, final validation/review and cutover. Workers coordinate interfaces
and own explicit files; no adapter fixes a shared-owner defect.

## Complete consumer proof and retirement

The nine primary suites, under `packages/medusa-adapter/test/`, cover the complete
selected replacement with these source-inspected expanded cases:

| Existing suite | Cases |
| --- | ---: |
| `logical-product-creation-workflow.test.ts` | 15 |
| `logical-product-variant-inventory-workflow.test.ts` | 9 |
| `logical-product-update-workflow.test.ts` | 12 |
| `logical-product-update-boundaries.test.ts` | 6 |
| `logical-product-variant-update-workflow.test.ts` | 16 |
| `logical-product-deletion-workflow.test.ts` | 12 |
| `logical-product-deletion-boundaries.test.ts` | 6 |
| `logical-product-batch-workflow.test.ts` | 14 |
| `logical-product-batch-boundaries.test.ts` | 9 |

The complete paired proof covers all 95 applicable PGlite cases, the four existing
PostgreSQL-only conditions and all 99 ordinary-role PostgreSQL cases. Preserve
original business assertions,
maximum graphs, smaller-budget refusals, empty/missing behavior, exact numbers,
historical cascades, events, rollback, outside-connection invisibility, competing
callbacks/default OCC, ownership/uniqueness races and full-result ACK recovery.
Use focused genuine old-path characterization before test replacement. Preserve
Native17 and original Product/Links/Currency/SDK regressions; add meaningful
neutral witnesses for any changed shared mechanism. Run affected Oxc fast checks,
core/diff/exact-index lint, source/promotion/portable guards and both independent
project reviews. Host/transport claims require actual hosting evidence separately;
local DB tests alone do not establish deployed Native18 workflows. Performance
and paused external sessions remain paused.

Replace selected setup/read/host assembly and remove displaced code with its
complete migrated callers. The old creation→update→deletion→batch fixture chain
still supplies named separate consumers: inline Task import, standalone Inventory
Item deletion, variant-item pricing, revision helpers and smaller Pricing/Product
launch or SalesChannel/ShippingProfile compositions. Either move only their shared
construction without changing execution authority or retain explicit `Legacy...`
branches with removal gates. Generic Currency/Product/Pricing/Inventory helpers
and retained benchmark construction have further callers; no blanket deletion or
Task/performance resumption is authorized by this slice.

The selected retained construction is explicit under
`test/support/legacy-product-*-fixture.ts`; its exported construction symbols
carry `Legacy`. Retained caller edits only change imports and preserve execution
authority. The removal gates are:

| Retained fixture | Named remaining caller | Removal gate |
| --- | --- | --- |
| `legacy-product-batch-fixture.ts` | `logical-product-inline-import-fixture.ts` | Migrate the separate Task borrowing/checkpoint consumer and its execution authority. |
| `legacy-product-deletion-fixture.ts` | `logical-inventory-item-delete-fixture.ts`, retained batch fixture | Migrate standalone Inventory Item deletion and remove the retained batch dependency. |
| `legacy-product-update-fixture.ts` | Retained deletion fixture | Remove with its final deletion-chain consumer. |
| `legacy-product-creation-fixture.ts` | Retained update fixture, variant-item Pricing fixture and revision-only Pricing/Inventory-confirmation imports | Migrate that chain and variant-item Pricing, then detach the revision-only consumers. |

Retained Legacy fixtures keep their original owner-operated PostgreSQL harness.
Their selected complete-flow import-parity checks do not extend ordinary-role
protection or Core migration coverage; those remain obligations of each named
consumer replacement. The new Core workflows have separate ordinary-role proof.

The old standalone Variant-update fixture and unreferenced creation factory have
no remaining executable callers and are removed. Their supported Variant cases
move to the genuine Core fixture; no compatibility wrapper or second transaction
engine is introduced.

This is a fresh complete bundle cutover. Populated `schemaBundle.ts` successors
currently admit at most one newly added native source; preserve that refusal.
Fresh eight-source proof does not establish populated migration. No named external
dataset/reset/ID-conversion disposition has been established here. Shared physical
storage, retained-data conversion, Task, finite borrowing, remaining native graphs,
managed hosting and performance keep their full-goal gates.
