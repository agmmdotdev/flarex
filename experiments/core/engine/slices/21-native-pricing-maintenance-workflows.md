# Complete native Pricing maintenance workflows

Status: **Independent current/design/Convex challenge and peer exchange complete.
Core prerequisites, native consumer migration, physical-history correction and
the data-preserving installed-target upgrade are implemented and verified for
the selected connected scope. Required review is complete; named retained
consumers and wider full-goal gates remain.**

Baseline: `d31c5df21ea79ba63e25dc4e1d9814361396611a`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
Medusa: `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, tree
`41cb1ea75b0ef88c352008adef4117a73266ad3c`, package baseline 2.13.4.

This continues the [full goal](../GOAL.md) after the
[Inventory continuation](./20-native-inventory-maintenance-workflows.md).
Move the complete existing ordinary Pricing maintenance family through the
translated owners. Existing native behavior defines the scope; constructor
availability does not permit an ID-only or forward-only subset.

## Consumer and executing-source boundary

All suites below are under `packages/medusa-adapter/test/`. Counts enumerate
unchanged source registrations and parameter tables, not executed proof.

| Family | Suite | Registered cases |
| --- | --- | ---: |
| Preference create | `logical-price-preference-create-workflow.test.ts` | 16 |
| Preference update | `logical-price-preference-update-workflow.test.ts` | 18 |
| Preference delete | `logical-price-preference-delete-workflow.test.ts` | 17 |
| List create | `logical-price-list-create-workflow.test.ts` | 21 |
| List update | `logical-price-list-update-workflow.test.ts` | 25 |
| List delete | `logical-price-list-delete-workflow.test.ts` | 21 |
| List Price add | `logical-price-list-price-create-workflow.test.ts` | 24 |
| List Price update | `logical-price-list-price-update-workflow.test.ts` | 27 |
| List Price remove | `logical-price-list-price-removal-workflow.test.ts` | 21 |
| List Price batch | `logical-price-list-price-batch-workflow.test.ts` | 22 |
| Removal read | `logical-price-list-price-removal-read.test.ts` | 4 |
| Total | | 216 |

Three existing PostgreSQL-only Preference races account for the difference from
213 applicable PGlite cases. They require both ordinary callbacks to stage, then
one `writeConflict`; blanket scope exclusion would change their contract.
The comparison-data callers `pricing-list-creation-receipts.test.ts`,
`pricing-list-update-receipts.test.ts` and `pricing-list-deletion-receipts.test.ts`
add 19 source cases. Preserve their data while removing constructor imports.

Pricing services/models resolve the promoted `packages/medusa-pricing/dist`
exports; selected Core Flows and Workflow SDK execute promoted TypeScript.
The corrected Price update captures detached complete prior graphs, partitions
actually affected existing/fresh IDs and invokes the genuine native restore
method. The frozen upstream compensation defect is not the executing contract.

The intended fresh graph is complete Pricing six tables, the standalone
VariantPricingLink table and private event storage. Preserve authentic
Product/Pricing joiner metadata. That Link has no endpoint FK and the selected
Query is flat; Product body authority is not required by these reads. Prove the
actual installation and flat-query path. Reuse the existing Native16 standalone
Core wrapper in the owning compiler rather than importing the combined
Inventory/Pricing Link source or a larger Product runtime.

## Independent challenge and resolved counterexamples

The initial current-core, accepted-direction and pinned-Convex readers formed
findings independently, then exchanged them. Their challenged runtime inputs
are unchanged at this baseline. Further focused current-owner readers and the
accepted-direction reader reconciled predicate authority/lifetimes and retained
schema provenance before runtime edits.

- Current core: ten constructors still use old commerce/atomic hosts. Complete
  Preference update reaches the Core `postgresPredicate` refusal. Price update
  and batch select replay/preserving-deletion capabilities Core rejects.
- Accepted direction: preflight 150 preserves full PostgreSQL selectors and
  explicitly rejects an ID-only replacement; preflight 156 and shared contract
  69 require authentic recorded Price/Rule restoration. Existing full-goal
  authorization covers necessary owner correction, not new module admission.
- Pinned source: transaction begin timestamp, pending overlay, first originals,
  exact point/range/EOF/metadata dependencies and committed plus accepted-write
  validation remain the default. Previously existing internal IDs, including
  tombstones, cannot be reused.
- Refined predicate challenge: `nativeOperation` alone does not prove actual
  source authority for selective metadata. Source-specific captures before SQL
  and after success are required, including empty/cached/pending cohorts. The
  complete detached cohort is unchanged by those captures. Legacy SQL admission
  transactions remain with their named Legacy callers.
- Refined history challenge: a Core row revision carries no source/schema marker.
  Current native policy cannot authenticate all history when a tablet acquires a
  new schema ID. Historical table and schema revisions must prove exact admitted
  source-local meaning; no arbitrary old definition is reconstructed.

Relevant pinned owners include `database/src/transaction.rs:402-403,1188-1217`,
`writes.rs:313-337,423-440`, `transaction_index.rs:240-298,598-653`,
`query/index_range.rs:215-226,246-260` and
`committer.rs:915-976,1035-1057,1138-1173,1628-1681`. They provide mechanisms,
not Convex Pricing APIs. Missing upstream test bodies are not runtime evidence.

## Keep, adapt and replace

| Responsibility | Disposition |
| --- | --- |
| Native selectors, defaults, matching, services, callbacks, inverses and events | Reuse executing promoted behavior and existing complete assertions. |
| Pricing producer and standalone Link compiler | Reuse Pricing; move the existing standalone Core wrapping into its real compiler owner. |
| Snapshot, pending, first originals, dependency and settlement algorithms | Keep translated Core owners; no callback replay or parallel authority. |
| Closed PostgreSQL predicate program and renderer | Reuse one implementation, split portable capture from PostgreSQL transport, replace old Core refusal. |
| Recorded values and retired native-key lookup | Extend shared history/policy/transaction owners with exact authentication and current destination selection. |
| Old workflow construction | Replace ten constructors and their full caller closure; separate pure comparison data. |

The [predicate prerequisite](./21a-native-postgres-predicates.md) and
[restoration/history prerequisite](./21b-native-recorded-row-restoration.md)
own their actual failures, mechanisms and neutral proof gates. The subsequent
[physical-history prerequisite](./21c-native-history-physical-pages.md) corrects
bounded physical selection and owns its data-preserving platform upgrade. Each necessary
native difference has a dedicated record in the
[divergence index](../divergences/README.md). Neither adds a physical table.

## Preserved native and resource contracts

Keep ordinary 64-call profiles; List deletion and List Price add/update retain
their named 128 calls; combined batch retains 256. All retain 64 events and
their original remaining bounds. The native parallel batch keeps queued facade
scheduling and its characterized mixed-time update/delete behavior; it does not
gain a coherent parent-wide snapshot promise.

Preserve every empty child/Query call, selector multiplicity, sparse preimage,
omitted-versus-empty Rules, ordering distinction, equal-value no-op and native
event/stamp behavior. Exact amounts such as `9007199254740993.0000` and fractional
quantity `1.25` must survive without a numeric round trip. Historical List masking
changes returned nullable relations, not stored Price ownership. Preserve the
genuine destructive creation inverse where admitted, and the corrected committed
`40 -> 77 -> 88 -> 77 -> 40` restore sequence without a second inverse.

## Coordinated ownership and gates

Root owns these notes, source/provenance, protected-worktree inventory, validation
resources, exact integration and scoped commit. Assign runtime workers explicit
paths after the owner seam is fixed. One predicate owner handles the closed
program/persistence/transaction path and same-lifetime byte forwarding. One
restoration owner handles history, metadata proof and native replay. Sequence
their overlapping Core API/contracts/database/transaction/persistence edits.
Proof ownership is separate from production fixes. Fixture/consumer ownership
migrates genuine native construction and comparison data, then retires callers.
Every worker is told that the checkout is shared; reviewers remain read-only.

Replace storage observations with their actual Core owners: canonical revisions
prove retained row changes, committed native-root outcomes prove settlement, and
private event families/deliveries prove publication. Keep complete before/after
evidence for rollback and no-ops. Remove the displaced empty Legacy physical-facts
family checks rather than emulating that family; fresh installation proves the
five physical tables and exact logical source closure.

Before either production correction, execute and retain a genuine neutral Core
failure through installed definitions and actual operations. Then prove the
owner on PGlite and ordinary-role PostgreSQL before dependent consumer acceptance.
Run the complete eleven-suite native family, receipt cases and affected connected
regressions, required source/portability/artifact guards, Oxc fast checks,
core/diff/exact-index lint and both project reviews. Stop owned resources.

Retire ten dedicated `logical-price-{preference,list}*-fixture.ts` constructions
after their workflow/read/data imports move. Generic Pricing helpers retain named
direct-service, private Product-launch/finite, paused Task and performance callers.
No fixture establishes an external durable dataset or reset permission. General
populated evolution, broader hosting and performance retain their full-goal gates;
this slice does not resume paused Task/finite/performance work.
