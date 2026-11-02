# Complete native Inventory maintenance workflows

Status: **Implemented after independent current/design/Convex challenge and peer
exchange. Paired owner, complete native-consumer and connected fixture proof are
complete. Selected obsolete construction is retired; wider goal gates remain.**

Baseline: `a0df230bf05d09a70ebb25a61464d32b0b4ac2c3`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
Medusa: `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline 2.13.4.

This continues the [full goal](../GOAL.md) and the
[Inventory deletion/read migration](./19-native-inventory-and-variant-read-workflows.md).
The candidate is the complete remaining admitted Inventory maintenance family,
including its transitive read/graph consumers. Its boundary follows actual
callers and native behavior, not fixture availability or a file-count limit.

## Candidate responsibility

Move Item create/update, Level create/update/delete/batch, reservations,
adjustments and stocking through the existing translated Core owners. Include
the authentic setup, empty branches, inverses, result validation and native
runtime graph. Identify and move the Stock Location read-result and Inventory
variant-price graph companions that depend on the displaced construction.
The exact suites, selected profiles, producer/runtime sources and remaining
callers are recorded below. Counts are source inventory, not executed proof.

Reuse native services, workflow algorithms, declarations and resource policies.
Use `createCoreNativeWorkflowFixture` and actual compiled definitions, command
initializers, hosts and recovery where they fit. Select the genuine source
closure for each profile; installing a broader Product bundle is not an
automatic prerequisite for standalone Inventory workflows.

PostgreSQL remains the only settlement/durable authority. The five physical
tables remain the starting layout. Native constraints and source/index access
belong to shared owners; no adapter SQL, copied enforcement, second installer,
callback replay or transaction spanning native callbacks is accepted.

## Independent challenge and decision boundary

- Current-core reader: trace the complete old fixture/host chain, actual suites,
  native producer/runtime closure, reusable Core seams and removal conditions.
- Accepted-direction reader: check ownership, native profiles, shared schema
  lifecycle, data obligations, hosting and retirement against accepted authority.
- Pinned-source reader: inspect relevant Convex owners, callers and tests for
  pending state, observations/indexes, validation, publication and recovery.

Each reader forms independent initial findings before peer exchange. Resolve
counterexamples and record the exact keep/adapt/replace map, owned worker files,
source findings, necessary divergence links and proof gates before implementation.
An actual shared-owner defect needs a retained failing witness and an owner
correction; fixtures must not bypass it or raise bounds to make the consumer pass.

## Required proof and cleanup

Carry every original consumer case and existing PostgreSQL-only race onto the
replacement. Preserve native ordering, omitted/empty behavior, exact quantities,
errors, events and snapshots. Exercise late failure and whole-root rollback,
selected callback exclusion, ordinary concurrency, stale writes, cancellation
and draining, revocation, duplicate requests and uncertain-outcome recovery as
required by these profiles. Full Causes retain native defects and typed refusal.

Prove schema/transaction/index claims on PGlite and focused ordinary-role
PostgreSQL separately. Run affected owner and connected consumer regressions,
source/promotion and portability guards, Oxc fast checks, core/diff/exact-index
lint and both required independent project reviews. Stop owned resources.

Remove the displaced construction after its complete caller closure moves.
Retained generic fixtures need named remaining consumers and removal gates.
Preserve unrelated shared-worktree edits; the baseline has 163 protected dirty
paths and a clean verification checkout. Root owns documentation, provenance,
serial validation, exact integration and the scoped commit; runtime workers
receive explicit file ownership after the challenge.

No named durable dataset or reset disposition is established by fixture use.
Inventory data conversion, broader native managed hosting and complete-flow
performance retain their own gates. This slice does not resume paused Task,
performance or finite-retirement work, and does not close the full rewrite.

## Challenged consumer map and dispositions

All suite names are in `packages/medusa-adapter/test/`. Preserve every original
registration, native helper case, parameter table, driver guard and bound.

| Suite | PostgreSQL | PGlite applicable | Existing PG-only conditions |
| --- | ---: | ---: | ---: |
| `logical-inventory-item-create-workflow.test.ts` | 32 | 30 | 2 |
| `logical-inventory-item-update-workflow.test.ts` | 13 | 13 | 0 |
| `logical-inventory-level-create-workflow.test.ts` | 32 | 30 | 2 |
| `logical-inventory-level-update-workflow.test.ts` | 17 | 15 | 2 |
| `logical-inventory-level-delete-workflow.test.ts` | 17 | 14 | 3 |
| `logical-inventory-level-batch-workflow.test.ts` | 20 | 17 | 3 |
| `logical-inventory-reservation-workflows.test.ts` | 12 | 10 | 2 |
| `logical-inventory-stocking-workflow.test.ts` | 9 | 9 | 0 |
| `logical-reservation-line-item-workflow.test.ts` | 24 | 20 | 4 |
| `logical-stock-location-read-results.test.ts` | 3 | 3 | 0 |
| `logical-inventory-variant-price-calculation-read.test.ts` | 1 | 1 | 0 |
| Total | 180 | 162 | 18 |

Standalone reservation/stocking profiles select Inventory's three tables,
StockLocation's two tables and the private event source. Maintenance cases
preserving neighboring graphs select Inventory, StockLocation, Product, Pricing
and the combined VariantLinks source in the same bundle/owner. Reuse existing
producer compilers and actual command initializers. Stocking includes genuine
Location/Address creation, defaults and ordinal association.

All four adjustment/reservation facades install the authentic scope-exclusive
Locking resource. Line Item deletion selects exclusion explicitly, including
queued inverse probes. Ordinary Item/Level and Stocking remain ordinary; Level
batch retains queued participant scheduling without scope exclusion. Step-level
Locking lookup alone does not determine the outer policy.

Independent readers and peer exchange resolved Reservation update/release,
deleted-only Line Item inverses, Stocking Addresses and actual isolation. Native17
managed hosting is a separate full-goal gate, not a prerequisite or a claim from
these database proofs. The [declared equality prerequisite](./20a-native-declared-equality-indexes.md)
owns the shared lowerer's missing unconditional Line Item history index. An actual
neutral failing witness and paired owner proof establish the correction before
connected Line Item acceptance.

Retire eight helpers under `test/support/`: `logical-inventory-maintenance-fixture.ts`,
`logical-inventory-item-update-fixture.ts`, `logical-inventory-level-update-fixture.ts`,
`logical-inventory-level-delete-fixture.ts`, `logical-inventory-level-batch-fixture.ts`,
`logical-inventory-item-create-fixture.ts`, `logical-inventory-level-create-fixture.ts`
and `logical-reservation-line-item-fixture.ts`. Their Core replacements reuse
existing owners rather than business algorithms or a second persistence path.

Keep generic `logical-inventory-fixture.ts` for `inventory-upstream.test.ts`,
`logical-inventory-deletion.test.ts` and the paused Task-owned Legacy Product
creation/update/batch imports. Their four-file chain and generic Currency/Product/
Pricing construction retain separate removal gates.

## Shared fixture lifetime correction

The actual first three Line Item cases expose a generic fixture lifetime defect:
two pass, then the third exceeds the unchanged 32-host bound. The isolated
shop-scope case passes. `core-native-workflow-fixture.ts` eagerly selects native
hosts at preparation, while `makeNativeOwnerProfile` records its selected host
only on actual use. Closing an unused facade cannot release that eager host;
unused probes accumulate. This is a fixture construction defect, not a missing
index, scope-isolation failure or permission to raise resource limits.

Independent current-owner and source/lifetime readers agree to remove only the
two eager `getHost`/`getReadHost` preflights in the generic fixture. Keep profile
capture, command-array copying, request-key timing, initial schema activation and
initializers unchanged. First use still performs recovery, generation readiness,
authentic source/configuration/binding validation and selection before callbacks.
Used facades retain existing drain/close; unused facades allocate no native host.
No production selection/cleanup engine, extra lifetime or compatibility path is
introduced. Pinned Convex's attempt acquisition/guard release supplies the general
lifetime precedent; it has no Medusa host API to copy.

Two neutral `core-atomic-workflow.test.ts` assertions used the erroneous eager
preflight to expect intrinsic Proxy/invalid-source rejection at preparation.
Those checks now invoke the facade and require the same exact typed refusals,
zero body calls and unchanged snapshot. Native facade wrong-module/token checks stay
at their existing preparation boundary. No supported public denial is weakened.

The composed Product event-selection witness also used preparation-time refusal
for five intrinsically invalid contract lists. Lazy preparation returns a facade;
the old typed-failure bridge therefore reported that successful host before event
validation ran. The check now invokes the actual host and requires exactly one
typed `invalidAuthority`, no root or module callback, an unchanged full snapshot
and existing facade cleanup. Admission fails
before request execution or settlement, so no rollback companion is expected.
The later selector, getter, capture, defect and replay checks are preserved. This is a
test-boundary migration; the shared runtime validation remains unchanged.

The fixture worker owns the shared fixture and both affected test files under
an explicit handoff. Preserve the actual failing consumer witness and its bound;
then rerun it, full Line Item and the transitive existing fixture consumers.
The scope fixture represents independent app/shop instances sharing the same
physical installation, not component namespaces inside one Core instance.
