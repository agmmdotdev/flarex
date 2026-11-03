# Native Stock Location and Sales Channel consumer replacement

Status: **Connected ordinary consumer replacement implemented with required
scoped validation and review. Broader native, hosted, Task, advanced evolution
and performance gates remain open.**

Baseline: `7e0ed9bc12211347f8a06891d06d0c5b67fe8659`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
Medusa fork: `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, tree
`41cb1ea75b0ef88c352008adef4117a73266ad3c`, baseline 2.13.4.

This continues the [full goal](../GOAL.md) and recorded remaining-commerce
[retirement boundary](./16b-legacy-entrypoint-retirement.md), following
[Inventory](./20-native-inventory-maintenance-workflows.md) and
[Pricing](./21-native-pricing-maintenance-workflows.md). It migrates existing
admitted ordinary consumers; it adds no general Shipping/Fulfillment, Store CRUD,
external provider or Task capability.

## Complete connected inventory

All suites below are under `packages/medusa-adapter/test/`. These are expanded
source registrations per driver, not executed proof or historical green claims.
Preserve behavioral coverage and explicitly PostgreSQL-only cases.

| Existing suite | Cases | PostgreSQL-only |
| --- | ---: | ---: |
| `logical-stock-location-create-identities.test.ts` | 5 | 0 |
| `logical-stock-location-update-workflow.test.ts` | 11 | 0 |
| `logical-stock-location-one-to-one.test.ts` | 2 | 0 |
| `logical-stock-location-deletion-workflow.test.ts` | 23 | 1 |
| `logical-sales-channel-storage.test.ts` | 17 | 0 |
| `logical-sales-channel-creation-workflow.test.ts` | 7 | 0 |
| `logical-sales-channel-update-workflow.test.ts` | 6 | 0 |
| `logical-sales-channel-deletion-workflow.test.ts` | 9 | 0 |
| `logical-sales-channel-location-workflow.test.ts` | 15 | 1 |
| `logical-product-sales-channel-link.test.ts` | 7 | 0 |
| `logical-product-sales-channel-workflow.test.ts` | 7 | 0 |
| `logical-product-sales-channel-membership-workflow.test.ts` | 37 | 1 |
| `logical-location-fulfillment-set-creation-workflow.test.ts` | 6 | 0 |
| `logical-fulfillment-set-deletion-workflow.test.ts` | 41 | 4 |
| **Total** | **193** | **7** |

The expected original boundary is 186 runnable PGlite cases plus seven explicit
PostgreSQL-only skips, and 193 PostgreSQL cases. Retain the three already-Core
`logical-stock-location-read-results.test.ts` cases as connected regressions.
Their fixture already uses the Core Inventory owner; do not migrate it backwards.
Four additional `logical-sales-channel-native-atomic-admission.test.ts` cases
exercise the genuine Sales count and update methods in the supported storage
atomic composition. Creation alone has no count guard; do not invent one. Keep
these shared-owner regressions separate from the original 193 registrations.

## Challenge and mechanism map

Three independent agents traced current consumers, accepted authority and the
immutable Convex/native sources, then exchanged counterexamples. No new Core
algorithm or module-specific mechanism exception is established. Reuse existing
owners and preserve a real failing witness if the migration exposes a gap.

| Current responsibility | Selected treatment and pinned mechanism |
| --- | --- |
| Legacy `logicalCurrencyFixture`, commerce hosts, participants and generated installation assemble the selected native roots | Replace selected construction with the existing Core native workflow fixture and shared logical lifecycle. Application/Currency baseline data is not an inherent requirement of these native roots. |
| Native services, workflow graphs, normalization, Address ordering, selected inverses, Link methods and events | Reuse actual promoted native implementations and existing assertions. Convex supplies no commerce business policy. |
| Pending values, first originals, observations, constraints and settlement | Reuse Core. Pinned `database/src/writes.rs` retains first originals and requires genuinely fresh internal IDs; `transaction_index.rs` merges pending entries and suppresses pending deletions. |
| Nested execution and atomic graph publication | Reuse one Core root. Pinned `Transaction::apply_function_runner_tx` requires the same begin timestamp before merging reads/writes; `committer::validate_commit` validates published and accepted changes and coalesces final writes. |
| Native callback/inverse recovery | Reuse authenticated outcomes/history and existing explicit profiles. Convex UDF retries and transactional session-request absence do not authorize native callback replay. |
| Physical persistence and schema production | Retain the translated PostgreSQL five-table owner and Source definitions. Add missing wrappers at existing schema producers, with no physical framework table, second installer or adapter SQL enforcement. |

Pinned transaction/writes/index/committer blobs are respectively
`a830bd8240d57bb9e2c4cec2e80fa5c7ec368cad`,
`916bf904972cb99334c1074e20629ee7a429c906`,
`43f3ee368d96ce9fec804508a19fd6505719853f` and
`5c0035658f1d0ed8dc0a61176349f2077ca1d89c`.
`application_function_runner::_retry_mutation` and
`model/session_requests` retain their existing Application-versus-native boundary.
Existing divergences for native visibility, root participation, sticky failure,
constraints, budgets, events, retained restoration and PostgreSQL predicates
remain applicable. A newly necessary mechanism departure needs its own record
and challenge before affected code changes.

## Source closure and authority

Use the exact source variants selected by the existing workflows. In particular,
Fulfillment means `compileServiceZoneCreationDefinition`'s eight-table variant,
not the unrelated twelve-table Fulfillment creation source or a populated upgrade.

| Profile | Complete business table closure |
| --- | --- |
| Stock create/update/one-to-one | Stock Location 2 |
| Sales create/update/storage | Sales Channel 1 |
| Product/Sales membership | Product 13 + Sales 1 + sales-only Product Links 1 |
| Sales/Location Link | Sales 1 + Stock 2 + Link 1 |
| Sales deletion | Product 13 + Sales 1 + Stock 2 + sales-only Product Links 1 + Sales/Location Link 1 + Store 3 = 21 |
| Location/Fulfillment Set creation | Stock 2 + Fulfillment 8 + Location/Set Link 1 |
| Fulfillment Set deletion | Fulfillment 8 + Stock 2 + Sales 1 + Sales/Location Link 1 + Location/Set Link 1 + provider Link 1 + option/PriceSet Link 1 + Pricing 6 = 21 |
| Stock deletion | Stock 2 + Sales 1 + Sales/Location Link 1 + Store 3 + Fulfillment 8 + Location/Set Link 1 + provider Link 1 + option/PriceSet Link 1 + Pricing 6 + Inventory 3 = 27 |

Stock deletion grants exactly `stock_location`, `sales_channel_location_links`,
`location_fulfillment_set_links`, `fulfillment`, `providerLinks`, `priceSetLinks`
and `pricing`. Store and Inventory installation/data do not grant their APIs.
Sales deletion retains actual Store `listStores` guard reads, Sales lifecycle and
the two required Link lifecycle families. Store CRUD remains unavailable.

The cross-app scope witnesses use independent Core instances sharing the same
five physical tables. Same-instance component scopes and hosted activation retain
separate gates.

Preserve Stock deletion's explicit 512-call, 256-event, 2 MiB, 30-second profile
and existing Fulfillment Set bounds. Preserve the unchanged large-graph refusal
under default 64-call/event authority. Preserve default/explicit scheduling;
queued execution alone is not source-exclusion authority.

## Native behavior and accepted corrections

Keep scalar versus array results, selector updates affecting multiple rows but
returning the first scalar result, empty selections yielding `undefined`, native
create-before-update upsert grouping, Address-upsert-before-Location ordering,
truthy metadata/address projections and exact selected inverse fields.

Stock cleanup follows actual deleted results; Sales events retain requested-ID
ordering and the real Store guard. Preserve native event names, Link messages,
complete Fulfillment/Pricing forests, historical descendants, untouched neighbors
and the two genuine Fulfillment restoration routes with their repeated calls and
events. Whole-root rollback is not a replacement for native compensation.

Module Links retain pair identity, missing/historical endpoint behavior,
nullable/default values and active cardinality; add no endpoint FK/liveness rule.
Keep [scalar-Link cardinality](../../../../roadmaps/flarexdb-framework-integration/preflight/63-native-singular-link-storage.md)
and its separately labeled pinned two-active witness. Keep the accepted
[first-actually-present lifecycle result](../../../../roadmaps/flarexdb-framework-integration/preflight/137-native-location-fulfillment-set-workflow.md)
correction in the native Link owner. Existing `decodeLinkCascade` validates the
whole tuple and latches nonempty native errors; add no second latch or fallback.

### Selected caller and admission corrections

The independent follow-up challenge separates replacement caller assumptions
from shared mechanisms. Failure witnesses must inspect `Effect.exit` or
`runPromiseExit` and every Cause reason: `Effect.result` and Promise squashing
can select a `rollbackOnly` failure while an initiating defect remains alongside
it. Retain original late Error/TypeError evidence and all unchanged rollback
snapshots. Accepted native failure classification keeps arbitrary foreign throws
as defects; only genuine Medusa errors map to `adapterFailure`. Forged Link IDs
still require exact receipt refusal; the first error wrapper is not authority.
Internal direct preparation must supply its selected identity/access policy.

The ordinary Sales read witnesses require the existing 128-identity admission.
The generic fixture had unconditionally granted 2,048 identities and batch
resources; ordinary observation hosts must use the production ordinary defaults.
Keep the separate explicitly admitted bulk initializer/profile. Preserve sparse
one-match success and 129/133-match refusal through the real owner; add no
Sales-specific result-count check or larger refusal threshold. The atomic
implicit/explicit profile mapping correction belongs to the shared owner under
[22a](./22a-native-atomic-admission.md), preserving numeric participant limits and
their existing root identity/recovery commitment.

Fresh repeated scalar input IDs follow the existing native canonical alias plan:
first non-null fields win, nullish fields can be filled and every response slot
survives while one canonical row is stored. Assert exact rows, aliases and events,
and retain actual already-persisted-ID conflict/rollback coverage. The original
Drizzle raw-insert rejection is distinct baseline provenance; do not rewrite it
or claim that all native storage implementations agree.

## Coordinated ownership and handoffs

Reuse `core-native-workflow-fixture`, `shareCoreNativeWorkflowPhysical`, existing
native-storage facade branches, Core Inventory/Product assembly where appropriate,
and Native21's retained-history/predicate owners. Private fixture APIs can change;
migrate callers instead of wrapping Core in the displaced host API.

- Producer worker owns only `src/modules/store/schema.ts`,
  `src/modules/fulfillment/shipping-profile-schema.ts`,
  `src/links/location-fulfillment-set-schema.ts`,
  `src/links/location-fulfillment-provider-schema.ts` and
  `src/links/shipping-option-price-set-schema.ts`, plus their direct producer tests.
  Add Core variants through existing `captureLogicalSchemaSource` and
  `makeCoreRelationalNativeDefinition`. Preserve the complete Store 3 and
  Fulfillment 8 constructors; no new runtime business algorithms or exports.
- Stock/forest worker owns the four Stock write/identity suites, Location/Set
  creation and Fulfillment Set deletion suites, their new Core fixture assembly,
  and selected old fixture retirement once all actual consumers move.
- Sales worker owns the eight Sales/Product-Link suites and their Core assembly,
  preserving read-only Store guard, scope, events and complete inverses.
- Root owns this plan/goal pointers, common fixture/production handoff reservations,
  actual source-resolution configuration, integration, two-driver resources,
  cross-owner failures, required reviews and exact-index commit. Shared pure
  graph data has one test owner; sequence cross-worker use rather than copy it.

Target wrapper names follow existing owners: `compileStoreCoreDefinition`,
`compileServiceZoneCreationCoreDefinition`, and the three existing Link compiler
names with `CoreDefinition`. Share exact source key/profile contracts before
consumer wiring; reserve any additional shared path before editing it.

## Retirement, protected work and data

Retain `logical-sales-channel-fixture` for its named API Key, old Product and
runner consumers; retain the Product Link helper for Product/Shipping Profile
and old Product construction; retain Service Zone construction for its existing
ServiceZone/Shipping Option Rule consumers. Pure graph exports used by input/
receipt tests may move to their test owner while retaining those assertions.
`logicalCurrencyFixture` retains other consumers and paused finite/performance
obligations. Remove only the complete selected obsolete closure; no blanket
helper deletion, compatibility wrapper or permanent parallel execution engine.

Current selected schemas/facades/fixtures/suites are clean at the baseline.
Preserve unrelated dirty promoted manifests/catalog/lockfile,
`analysis/src/logicalSchemaCandidate.ts`,
`frameworkSchema/binding/logicalSchema.ts` and `mixedMutationProductFixture.ts`.
Task, finite implementation, performance measurements, external provider effects,
hosted activation and general populated evolution remain separate. No named
external dataset or reset disposition is established; fresh fixture migration
authorizes no durable data deletion or physical-table retirement.

## Required validation and provenance

Run the complete selected inventory and existing Core Stock reads on both lanes,
matching every case/skip explicitly. Prove constraints, scope, defaults, events,
compensation, concurrency, old/new API limits, sticky failure, cancellation,
ordinary outcome replay and real contributing-durability behavior where admitted.
Use neutral owner regressions for a shared defect, with no weakened assertion.

The default adapter Vitest configuration does not select `source`; Node currently
resolves Stock/Sales/Fulfillment service exports to ignored compiled files.
Focused configs select Source; registrations alone prove neither historical
execution nor a prior runner. Use explicit Source and SSR conditions following
`vitest.fulfillment-delivery.config.ts`, set the actual `FLAREX_TEST_DRIVER`
consumed by these suites, and verify actual resolution/provenance. Alternatively
pin a deliberately selected compiled closure. Do not infer conditions from an
available export or relabel past receipts. Record actual loaded source/artifacts
and primary native comparison identity separately from Git-tree membership.
The dedicated `native-stock-sales-source-provenance.proof.ts` checks service
exports against configured Vitest-environment resolution of promoted entry/leaf
paths and hashes; it is deliberately excluded from default test discovery.
Keep package import boundaries strict; do not bypass them with cross-package
relative imports. The configured Node test worker uses Vitest's `ssr` module-runner
environment; resolve through that existing environment, rather than the distinct
`__vitest__` bootstrap environment or a separately created Vite resolver. Removing
the Source conditions must fail the provenance gate.

Run affected typechecks, source/portability guards, core/diff/exact-index lint and
both required read-only reviewers. Stop owned runtimes/databases; preserve all
unrelated work. This slice is not deployment, scale, performance or full-goal proof.
