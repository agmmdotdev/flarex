# Current core cost and redesign inventory

The large native-relative gap is distributed across preparation/admission,
framework working-set execution and final acceptance/publication. Freeze,
runtime result validation and final cleanup are small in the selected Product
graph. The standalone CMS and commerce profiles still run much broader
admission/readiness choreography than the finite mixed profile. A connected
replacement must migrate those consumers too.

This is measured attribution plus a source inventory, not a performance cutover.
The [owning preflight](../../../../../roadmaps/mixed-mutation-core/21-core-performance-harness-preflight.md#selected-complete-cost-attribution)
defines SDK construction, observer calibration and the bounded campaign. The
runtime baseline is `4ae75a35b4bdef52d131e20998f3d402ff601d2f`; this change adds
test-only observation and existing fixture phase boundaries. The
[held complete quiet comparison](../whole-mutation-cutover/retained-settlement/README.md#complete-quiet-comparison)
remains the acceptance reference: native median 10.6645 ms, Flarex 162.8821 ms,
actual paired excess median 152.0179 ms / P95 177.6848 ms over 30 fresh pairs.
The selected 5/10 ms added-latency gates remain failed.

## What is measured now

All runs use real complete calls and verify committed results afterward.
Construction, migration, seeding, readback and command cleanup are outside the
call timer; actual attempt finalizers are inside it. Five real warmups precede
fresh alternating quiet/resource Flarex pairs. Resource diagnostics omit SQL
fingerprints, stacks, input/result sizing, heap sampling, inspector and server
logging. They retain actual operation intervals, coarse CPU/event-loop counters,
driver awaits, originating operation, checkout, PID and outcomes.

| Small complete graph | Quiet median ms | Diagnostic median ms | Actual client exchanges per diagnostic | Fresh observer pairs |
| --- | ---: | ---: | ---: | ---: |
| Mixed Application/Product | 160.278 | 193.977 | 40 | 10 |
| Standalone Payload create | 102.804 | 179.335 | 111 | 3 |
| Standalone Medusa workflow | 306.693 | 396.618 | 252 | 3 |
| Mixed Application/Product/Payload | 193.460 | 281.179 | 42 | 3 |
| Mixed Application/Product/workflow/Payload | 435.188 | 485.820 | 58 | 3 |

These profiles have different business graphs and execution contracts. Their
latencies are not one population, and none of these observer pairs is native
acceptance. Three pairs describe bounded observations, not stable tails. The
counts are client submissions, including transaction controls; resource detail
does not count SQL statements inside a batch or installed database function.
Every diagnostic in each cohort has the same listed exchange count.

The main ten pairs show actual diagnostic-minus-quiet differences of
21.298–44.006 ms, median 29.612 ms. The other cohorts show median differences
53.342 / 63.587 / 76.529 / 68.462 ms, respectively; the workflow cohort includes
a -26.519 ms pair. These are separate executions with run variation, retained
diagnostic memory and post-request processing. They are not an exact observer
tax and are never subtracted to invent quiet phase costs. The observer remains
material, despite removal of SQL reconnaissance and profiling.

## Mixed Product: dominant envelopes

The main diagnostic request-span median is 193.674 ms. Its six top-level
envelopes locate the cost:

| Actual envelope | Median diagnostic wall ms | Interpretation |
| --- | ---: | --- |
| Request admission | 20.476 | Includes source preparation and initial finite entry |
| Portable runtime execution | 114.803 | Application calls, native Product behavior and shared working set |
| Runtime result validation | 0.365 | Exact runtime-result acceptance |
| Freeze and validation | 2.955 | Result evidence, root transfer and commit preparation |
| Authoritative publication | 54.537 | Fresh acceptance, OCC, materialization, durable result/facts and COMMIT |
| Complete call cleanup | 0.310 | Owned initial fiber and syscall-scope finalization |

The rows are medians, so their sum need not equal the median root. They are
instrumented envelopes, not estimates of quiet per-owner excess. Request
admission's source-preparation and finite-entry children overlap that row;
Product/capture children overlap runtime; publication families overlap publication.

Additional inclusive evidence:

- Three native Product operations total median 97.579 ms. Their adapters and
  shared storage are included; this is not the independent native reference.
- Thirteen `FiniteStorageCapture.run` calls total 58.437 ms and link to 13
  submissions with 43.136 ms await union. They include three Application
  captures and ten Product demands.
- Root driver-await union is 80.213 ms; checkout union is 0.459 ms. Checkout
  contention is small in this cohort. Driver wait includes PostgreSQL,
  transport and client scheduling; it is not server execution or lock time.
- Root process/thread CPU medians are 124.5/117 ms, and event-loop idle is
  71.649 ms. These inclusive quantities overlap each other and wall; they
  cannot partition the quiet gap into CPU versus PostgreSQL milliseconds.
- Recorded collector-callback union is 8.485 ms. The paired difference is
  larger because callback intervals do not cover all tracing/context work,
  retained-memory effects or run variation.

One selected refinement adds counter brackets to existing relation-selection,
contribution validation and native publication phases. It uses five warmups and
two pairs, bringing the primary campaign to **34 fresh attempts**, below its 35
attempt bound. Its quiet/diagnostic medians are 181.439/220.285 ms and paired
difference median 38.846 ms; the core behavior is unchanged, but the observer
profile differs. It is a structural attribution witness, not a stronger latency
distribution. Seventeen relation selections, 34 selection collections and 13
captures are visible. Publication lowering is about 19.652 ms and actual
materialization writes 9.444 ms inside publication. These overlap their owners.

### Exact 40-submission topology

| Contiguous submissions | Purpose | Count |
| --- | --- | ---: |
| 1–6 | Initial finite transaction, serving authority/observation, complete anchor and COMMIT | 6 |
| 7–19 | Application ownership/ID absence, ten Product demands and one logical authority demand | 13 |
| 20–40 | Durable outcome precheck, final transaction/authority, closure/OCC acceptance, materialization, prefix facts/references, clock and COMMIT | 21 |

The ten Product demands occur during update: original unique selection; four
initial relation selections; proposed unique-key absence; and four replacement
relation selections. Later retrieve/indexed-list calls use captured or pending
state. The demands are distinct, so blindly prefetching or removing them would
change validation, budget or failure order. Their **surrounding** capture runs
repeatedly accept attempt/snapshot/placement/build/maintenance evidence and
construct parameters, mappings and receipts. The current owner already retains
pure prepared SQL plans: there is no evidence of ten complete SQL compilations.

Source owners: [finiteStorageCapture.ts](../../../../persistence-postgres/src/finiteStorageCapture.ts),
[workingSet.ts](../../../../persistence-postgres/src/logicalDocuments/workingSet.ts),
[pointCommitTransaction.ts](../../../../persistence-postgres/src/pointCommitTransaction.ts)
and [materialization.ts](../../../../persistence-postgres/src/applicationDocumentMaterialization/materialization.ts).
The detailed earlier server/plan timings belong to a predecessor with broader
instrumentation. They are not current quiet server costs.

## Standalone Payload: complete 111-submission inventory

All three runs show 111 exchanges at 51 named sites, eight transactions and
eight commands outside transactions. Host construction is already outside the
timer and reused. Per-request `CmsHost.attempt` still calls
`prepareCmsApplicationCommit` before its final transaction.

| Contiguous submissions | Actual responsibility | Count |
| --- | --- | ---: |
| 1–9 | First scope/placement/target resolution | 9 |
| 10–39 | Materialization definitions, second scope resolution, candidate guard/schema snapshot | 30 |
| 40–47 | Final transaction/session/installation/authority startup | 8 |
| 48–89 | Application readiness/binding and CMS installation/binding admission | 42 |
| 90 | Durable outcome precheck | 1 |
| 91 | Native Local API's proposed unique-key storage probe | 1 |
| 92–110 | Final constraint acceptance, lowering and durable publication | 19 |
| 111 | COMMIT | 1 |

Before the final transaction there are seven preparatory transactions containing
31 commands, plus eight nontransaction commands. The final transaction contains
72 commands. The Local API buffers its document insert into the working set;
durable insertion belongs to later lowering, so the one probe is not all business
persistence. This scalar fixture has no custom hooks.

This responsibility grouping partitions all 111 driver events:

| Actual named-source family | Exchanges |
| --- | ---: |
| Scope resolution | 18 |
| Final session mechanics, including controls | 6 |
| Managed installation admission | 3 |
| Index-definition location | 8 |
| Unique definition/catalogue location | 7 |
| Candidate-schema preparation/acceptance | 8 |
| Retained schema artifacts | 4 |
| Application active head/schema | 8 |
| Relation-schema binding | 3 |
| Full readiness reconstruction/replay | 17 |
| Write ownership | 1 |
| CMS data binding | 3 |
| Framework installation evidence | 2 |
| Scope concurrency/freshness | 5 |
| Durable replay | 1 |
| Native Payload unique probe | 1 |
| Final materialization/constraints | 12 |
| Result/fact publication | 4 |
| **Total** | **111** |

Proven repetition and its owner:

- Two complete scope-resolution passes run before business work.
- Materialization preparation separately obtains intrinsic/developer/unique and
  candidate definitions despite related definitions already retained by the CMS
  host. These are different genuine issuers today; copying handles between
  owners would be a workaround, not a corrected definition contract.
- Admission observes the coherent Application head three times and schema twice.
  Retained schema artifacts and unique-set members are also read twice.
- The scalar zero-relation graph still reconstructs the complete revision,
  candidate, task catalogue, physical readiness, ownership and replay evidence.
- Framework installation acceptance recomputes sorted row digests for 16
  evidence sections. This is one substantial aggregate exchange, not a global
  catalogue scan. Narrower acceptance requires an explicit writer/interlock
  inventory; replacing it with an unchecked cache would weaken the contract.
- Ordinary CMS finalization still prepares prior-state/key plans and lowers
  through the ordinary materialization path. Finite retained-settlement work
  does not automatically migrate this consumer.

Source owners: [CMS host](../../../../persistence-postgres/src/cmsTransaction/host.ts),
[CMS publication](../../../../persistence-postgres/src/cmsTransaction/publication.ts),
[materialization participant](../../../../persistence-postgres/src/applicationDocumentMaterialization/participant.ts),
[Application activation](../../../../persistence-postgres/src/applicationActivation.ts),
[relation readiness](../../../../persistence-postgres/src/applicationRelationReadinessFold.ts)
and [framework runtime evidence](../../../../persistence-postgres/src/frameworkSchema/installation/runtimeEvidence.ts).

## Standalone Medusa workflow: repeated owners and waiting frames

The actual workflow performs nine sequential participant calls: variant create,
price-set create, Link create, three pending graph reads, previous-tag list,
tag update and Product graph read. Previous-tag data is native compensation
input, not a readiness query. No compensation runs in these successful calls.
The local synchronous workflow fork awaits each node and child; a workflow
scheduler-delay bottleneck is unsupported by this capture.

All three diagnostics have 252 driver exchanges, 16 checkouts, 11 control and
two target transactions. They create **three**, not nine, working sets. Nine
`makeWorking` invocations reuse those sets by admission. Product, Pricing and
Link each receive a full logical admission and readiness reservation; four
bundle authentications and 16 cold receipt decodes occur. Each of three source
contributions is prepared and lowered once, under one final commit publisher.

The three diagnostic requests locate large envelopes:

| Inclusive envelope | Observed range ms |
| --- | ---: |
| Before native workflow entry | 121.760–143.177 |
| Native workflow entry | 137.512–181.853 |
| After native workflow entry | 110.398–135.155 |
| Final commit publisher, inside the last envelope | 105.949–128.777 |
| Three materialization lowers, inside publication | 66.411–77.575 |
| Three full readiness inspections | 41.117–52.174 |

The actual `MedusaWorkflow.frame` unknown-leaf union is 122.975 ms in one sample,
but 121.324 ms overlaps competing service leaves. Only 1.650 ms has neither a
competing leaf nor a driver await; the other samples show 1.669/1.956 ms there.
The Promise owner captures its tracing parent before a frame begins, so bridged
service fibers appear as siblings of that later waiting frame. These intervals
are not additional workflow CPU and must not be summed. Raw parentage remains
unchanged; the inventory explains the concrete wait relationship. A future
fine-grained callback-edge observation can express that relation directly.

The diagnostic records 3,049 Effect spans and 7,654 observer intervals per call.
These counts describe the observed composition, not quantified quiet Effect
overhead. Forty-two workflow value captures total 13.13–15.39 ms and perform
multiple envelope/root-budget captures plus a detached payload copy. Ownership,
omission semantics, limits and callback isolation are required; repeatedly
walking trusted values is the replaceable mechanism. This does not explain a
123 ms frame wait.

Sources: [native workflow composition](../../../../medusa-adapter/src/product-launch-workflow.ts),
[Promise owner](../../../../medusa-adapter/src/commerce-promise-owner.ts),
[workflow runtime](../../../../medusa-workflows-sdk/src/runtime.ts),
[workflow values](../../../../medusa-adapter/src/workflow-value.ts),
[atomic admission](../../../../persistence-postgres/src/atomicCommerce/admission.ts),
[execution](../../../../persistence-postgres/src/atomicCommerce/execution.ts)
and [commerce publication](../../../../persistence-postgres/src/commerceTransaction/publication.ts).

## Required semantics and proposed replacement boundary

The source and measurements support replacing the connected execution-evidence
and acceptance flow, including ordinary CMS/commerce consumers. They do not
support another freeze-only optimization as the answer to complete overhead.

| Owner | Required behavior | Mechanics to replace or consolidate |
| --- | --- | --- |
| Admission/installation | Current scope, placement, generation, authorization, installation and maintenance interlock | Per-request immutable definition reconstruction; repeated coherent-head projection; full retained-evidence replay when a proved writer/generation contract permits narrower current acceptance |
| Readiness/source admission | Enabled demanded definitions, exact positive/negative observations, source-specific permissions and original snapshot | Common Application bundle reconstruction per participant; carrying full equivalent metadata/proof graphs through each demand |
| Working set/framework boundary | Native validation, hooks/events/compensation data, pending overlays, first-failure/budget order and detached external values | Equivalent snapshots, encodings and clones between already trusted owners; repeated projection/constraint preparation |
| Freeze/commit preparation | Genuine origin/attempt binding, one immutable final contribution, result correctness | Remaining redundant request/outcome/result transport; finish migration of ordinary consumers to retained prepared values |
| Publication/materialization | Fresh post-lock authority, exact OCC, uniqueness, history/tombstones/indexes/coverage, trigger proofs, atomic result/facts and uncertain-outcome resolution | Repeated immutable closure/definition preparation, hex/JSON proof transport, ordinary-versus-finite planning duplication, repeated full proof work at existing barriers |

The Product source contains at least 14 complete-value canonicalizations before
document/admission codecs: five journal requests, five journal outcomes, two
Application write events and two complete successful-result canonicalizations.
Participant completion and freeze also detach values. Some relational result
captures discard the captured tree and retain only its byte count. These are
real cleanup candidates, but current result validation/freeze timings are small;
the inventory does not rank every duplicate as a dominant bottleneck.

Convex's checked-in source supports a prepared-value and transaction-state
boundary: [checked objects](../../../../../../../crates/value/src/object.rs)
retain measured invariants; [transactions](../../../../../../../crates/database/src/transaction.rs)
move read/write sets into finalization; [writes](../../../../../../../crates/database/src/writes.rs)
retain first original and final pending values; [schema registries](../../../../../../../crates/database/src/schema_registry.rs)
reuse immutable definitions while recording metadata dependencies; the
[committer](../../../../../../../crates/database/src/committer.rs) accepts
dependencies, persists and then publishes visibility. Mutation request results
are recorded atomically for replay in the
[function runner](../../../../../../../crates/application/src/application_function_runner/mod.rs).

The applicable Flarex direction is **retained authenticated execution evidence
plus fresh PostgreSQL acceptance**. A real owner issues immutable normalized
values, exact bytes and limits once; mutations create newly checked prepared
values; foreign/native returns detach; one attempt-owned working graph transfers
at freeze. Metadata consumers retain dependencies and the accepting owner checks
current mutable authority after the required locks. Encode at actual transport,
durable or escaping boundaries. Framework lifecycle and three source-specific
closures stay with their owners. Convex has no direct equivalent of Flarex's
PostgreSQL grants/catalog attestation or arbitrary AFTER-trigger proof obligations.

Any implementation must inventory affected private contracts and durable formats,
writer/generation/ABA rules, consumer migration, recovery and removal gates first.
It must retain ordinary-role and PGlite correctness, hooks/events, cancellation,
rollback-only behavior, refusal/budget order, atomic outcomes and uncertain-COMMIT
resolution. No new universal transaction facade, adapter SQL bypass, cached
permission, guessed relation prefetch, compatibility wrapper or silent durable
deletion is selected by this investigation.

## Precision and completion

The current cost is named and located at real owners. Exact quiet per-function
CPU, PostgreSQL process CPU, network/lock/server decomposition of driver waits,
allocation by request phase and production Cloudflare contention remain
unavailable. Earlier profiler allocation windows include post-call sanitization;
they are not request-only allocation totals. CPU counter granularity can produce
zero deltas for work taking several milliseconds. Process counters include other
threads; nested counters and await unions overlap. Native phase callbacks and
request-owned fibers do not necessarily parent every related database submission
to the shorter phase, so zero linked descendant waits does not imply zero SQL.

Main enclosing-context unattributed median is only 0.179 ms, despite 129.870 ms
strict unknown-leaf attribution. Those leaves are retained named operations whose
deeper semantic mapping was incomplete, together with concurrent supervisor
lifetimes. This is not 130 ms of unseen execution. Workflow waiting-frame
ambiguity is separately explained above. Source reasoning identifies replaceable
work; neither elapsed source spans nor overlapping counters establish its exact
share of the quiet native excess. Future workloads and scaling remain separate
gates, and the redesign's latency result must be demonstrated after cutover.

Validation: 273 SDK tests passed with 15 explicitly gated skips; actual PGlite
resource proof passed; all five ordinary-role PostgreSQL resource campaigns and
the bounded Product refinement completed, with committed readback, stable
sources/settings, reconciled complete diagnostics and zero losses/faults.
Performance and persistence typechecks, core/diff/staged lint, whitespace and
both final project reviews pass. Reviewers found no actionable issues. Owned
PostgreSQL sessions and diagnostic roles/databases drained; the owned server,
PID file and port were stopped/removed. These are measurement/assembly and
correctness proofs, not production performance or redesigned-core acceptance.

The [manifest](manifest.json) retains exact byte counts, SHA-256s, source digests
and fresh-attempt inventories. Gzip exports round-trip to the original raw JSON.
Human report footers receive an explicit editorial correction distinguishing
resource CPU counters from CPU profiles and clarifying quantization/parentage;
raw observations and source fingerprints are unchanged.
Authored source inventories contain 2,592 files here; the held native comparison
also includes its executing native dependency island. Observer refinements have
different source fingerprints; no runtime performance replacement occurred.
The four secondary profiles use 44 fresh attempts total. Private credentials,
endpoints, server logs and payload data are excluded.

| Cohort | Human report | Raw report | Summary |
| --- | --- | --- | --- |
| Mixed Product, ten pairs | [report](dd95ff04-c138-4eb6-9e7a-949058c650cd.md) | [JSON gzip](dd95ff04-c138-4eb6-9e7a-949058c650cd.json.gz) | [summary](mixed-product-summary.json) |
| Product refinement, two pairs | [report](45093f77-852b-4c18-8198-dfcf86c6569c.md) | [JSON gzip](45093f77-852b-4c18-8198-dfcf86c6569c.json.gz) | [summary](mixed-product-refined-summary.json) |
| Payload | [report](19db7237-0cf7-4210-9961-b828e2bb6d04.md) | [JSON gzip](19db7237-0cf7-4210-9961-b828e2bb6d04.json.gz) | [summary](payload-create-summary.json) |
| Medusa workflow | [report](7477afd2-8246-489d-a0a6-c21ebf6b7327.md) | [JSON gzip](7477afd2-8246-489d-a0a6-c21ebf6b7327.json.gz) | [summary](medusa-workflow-summary.json) |
| Mixed Payload | [report](7c1097c3-1b5e-415f-80c3-642c4c56d88b.md) | [JSON gzip](7c1097c3-1b5e-415f-80c3-642c4c56d88b.json.gz) | [summary](mixed-payload-summary.json) |
| Mixed workflow | [report](bb0d0765-7fdf-44d8-a9ef-4e1395691e8a.md) | [JSON gzip](bb0d0765-7fdf-44d8-a9ef-4e1395691e8a.json.gz) | [summary](mixed-workflow-summary.json) |
