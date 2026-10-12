# Publication, capture and client CPU cost inventory

Status: binding-owned maintenance and transaction-scoped binding reuse are implemented;
complete performance acceptance remains unmet. [Preflight 27](../../../../../roadmaps/mixed-mutation-core/27-shared-execution-evidence-redesign-preflight.md#current-decision-binding-owned-maintenance-cutover)
owns that connected implementation contract and migration. This ledger supplies
the measured baseline and its limits. Immutable metadata key reuse is implemented;
broader repeated-capture and client CPU changes remain investigation proposals.
Structural work removal and complete performance results
are reported separately below.

## Immutable metadata key correction

The [demand and cost diagnostic](../../../../../work/validation/shared-execution-evidence/capture-diagnostic/results-and-proposal.md)
establishes that the 38 mixed captures contain 26 distinct index ranges, eight
distinct single-row packets, two separately fresh participant timestamps and
one ownership/identity demand each. Equal labels or empty answers do not make
the Link or Variant find/create bounds equal. General exact-demand reuse has
no measured business SQL removal in this graph. The historical 172.19 ms pricing
driver wait did not recur; its cause cannot be recovered from the older trace.

The same diagnostic finds 691 client metadata comparison calls per workflow.
Source-policy comparison takes the full structural fallback 282 times for five
original projection/key pairs; known index/unique definitions add 23 full
fallback comparisons. The source-policy group's observed instrumented wall
cost is 6.35–6.58 ms, including collector hashing; this is neither exclusive CPU
nor predicted savings. The [approved correction](../../../../../roadmaps/mixed-mutation-core/27-shared-execution-evidence-redesign-preflight.md#approved-correction-immutable-metadata-key-reuse)
extends the existing projection-issued immutable key mechanism and removes
literal key reconstruction at working-set, native Application and final
participant consumers. Missing/foreign inputs retain full validation and the
original root/watermark, dependency semantics and charging remain live.

Fresh capture, placement, authorization, post-wait time/readiness, rollback-only,
metadata/OCC and publication checks are unchanged. The complete native-relative
CPU/latency gates remain fixed; correctness and reduced structural interpretation
do not establish performance acceptance. Compact replacement responses remain
a proposal with unisolated cost, outside this key correction.

The [three-call key-path diagnostic](../../../../../work/validation/shared-execution-evidence/metadata-key-reuse/key-path-results.json)
confirms all 305 formerly structural source-policy/index/unique comparisons use
original retained templates. Semantic checks remain live: total comparisons are
694 rather than 691 because native root consumption adds three template checks
while removing its repeated capture/record decoding. Missing access-family
comparisons remain 39 fully validated calls. Captures, checkouts and exchanges
remain 38, 41 and 60 in the mixed workflow.

The [complete matched results](../../../../../work/validation/shared-execution-evidence/metadata-key-reuse/results.md)
retain all 15 successful processes and unchanged sources/settings, with
[owned-source and native-inventory stability](../../../../../work/validation/shared-execution-evidence/metadata-key-reuse/source-integrity.json).

| Medusa graph | Added thread CPU ms | Native / Flarex quiet median ms | Paired added median / P95 ms | Exchanges |
| --- | ---: | ---: | ---: | ---: |
| Standalone | 78 | 19.45 / 149.59 | 130.06 / 134.57 | 87 |
| Mixed | 125 | 34.76 / 252.58 | 219.55 / 251.80 | 60 |

Four CPU gates and all five quiet latency gates fail; Payload's median added
thread CPU meets the fixed gate at 16 ms. The preceding binding-reuse cohort's
Medusa CPU excess was 63/156 ms. These are separate cohorts, with approximately
16 ms Windows counter resolution, not exclusive causal improvement evidence.
The correction is implemented and correctness-reviewed. The owner requested a
checkpoint commit with complete performance acceptance explicitly still unmet. The
[validation and handoff](../../../../../work/validation/shared-execution-evidence/metadata-key-reuse/validation-and-handoff.md)
retains rollback, concurrency, recovery, review and resource disposition.

## Transaction binding reuse result

The [complete results](../../../../../work/validation/shared-execution-evidence/binding-reuse/results.md)
retain all 15 successful graph/lane processes with frozen sources. The
[exact binding-read comparison](../../../../../work/validation/shared-execution-evidence/binding-reuse/binding-read-comparison.json)
confirms removal of all six standalone head/evidence reads at Application
readiness, logical readiness and logical materialization. Admission's original
locked selection, live preparation lease and metadata final guard protect the
borrowed evidence. Capture closes before business savepoints; activation clears
the selection before writes, and every scope Exit removes it.

| Medusa graph | Maintenance / reuse exchanges | Added CPU ms | Native / Flarex quiet median ms | Paired added median / P95 ms |
| --- | ---: | ---: | ---: | ---: |
| Standalone | 93 / 87 | 63 | 21.22 / 157.73 | 133.80 / 149.54 |
| Mixed | 60 / 60 | 156 | 36.45 / 262.78 | 228.30 / 247.75 |

Mixed publication retains its fresh head/evidence pair because entry and
settlement use different transactions. The final reference-publication check
also remains. Mixed still performs 38 implicit captures across 41 checkouts.
Publication work remains nine document revisions, 42 index revisions, two
unique releases and ten claims, with zero recurring index/unique coverage updates.

All five complete graphs still fail the fixed CPU and latency gates. Added CPU
uses five matched pairs with approximately 16 ms Windows counter resolution;
quiet latency uses 30 matched pairs. The preceding maintenance cohort and this
cohort are separate measurements: standalone added CPU was 95 ms and mixed was
94 ms there. These results do not establish a general CPU improvement or exclusive
causal attribution. The six removed diagnostic reads previously accounted for
3.04 ms driver-await and 25,359 decoded JSON bytes; those are not exclusive CPU
costs or a prediction of quiet latency savings.

The [handoff](../../../../../work/validation/shared-execution-evidence/binding-reuse/handoff.md)
records correctness, review, measurement and resource state. The owner requested
a checkpoint commit with complete performance acceptance explicitly still open.
Repeated capture and broader client CPU changes remain discussion proposals.

## Preceding binding maintenance candidate result

The [complete candidate results](../../../../../work/validation/shared-execution-evidence/binding-maintenance/results.md)
retain all 15 successful graph/lane processes. The [publication work comparison](../../../../../work/validation/shared-execution-evidence/binding-maintenance/publication-work.json)
reconciles the actual diagnostic with the preceding saved cohort:

| Mixed publication work | Previous | Candidate |
| --- | ---: | ---: |
| Document revisions | 9 | 9 |
| Index revisions, including seven intrinsic revisions | 42 | 42 |
| Unique releases / claims | 2 / 10 | 2 / 10 |
| Recurring index coverage updates | 49 | 0 |
| Recurring unique coverage updates | 16 | 0 |

The old coverage loop's 65 UPDATEs and 227 SELECTs no longer execute for those
maintained builds. The 227 SELECTs remain a source-derived gross count of the
removed loop, not a net server-statement measurement. Fresh maintenance acceptance
still performs required work. Candidate/build progress retains its real owners.

| Medusa graph | Previous / candidate exchanges | Previous / candidate added CPU ms | Native / Flarex quiet median ms | Paired added median / P95 ms |
| --- | ---: | ---: | ---: | ---: |
| Standalone | 87 / 93 | 77 / 95 | 21.11 / 163.33 | 142.66 / 159.69 |
| Mixed | 58 / 60 | 141 / 94 | 38.10 / 272.90 | 232.27 / 296.12 |

The extra standalone exchanges are exactly `readHeadRecord` and
`readSelectedEvidence` at Application readiness, logical readiness and logical
materialization. Mixed adds that pair only at logical materialization. Its 38
implicit captures and 41 checkouts remain. These observations identify the
new cost at that checkpoint. The transaction-scoped correction above supersedes
the standalone rereads; the mixed publication pair remains necessary.

All five graphs still fail the fixed 16 ms added-CPU and 5/10 ms added-median/P95
latency gates. CPU uses five matched pairs and approximately 16 ms Windows counter
steps; quiet latency uses 30 matched pairs. Previous and candidate values come
from separate cohorts and are not exclusive causal attribution. The candidate
does not establish a general CPU or latency improvement. Sources and settings
were stable within every run, and source fingerprints agree across runs with the
same inventory: CPU/quiet include native sources; database diagnostics do not.

Setup is outside request timing and remains visible: standalone Medusa setup was
34.74 s in the CPU lane and 34.86 s in quiet; mixed setup was 40.93 s and 39.29 s.
The [handoff](../../../../../work/validation/shared-execution-evidence/binding-maintenance/handoff.md)
records correctness, migration, review and resource state. No new commit was
created. The earlier intermittent Currency timeout is not established as resolved
by this successful cohort. The older inventory below remains the baseline evidence.

## Evidence and limits

The inspected runtime baseline is `5f5a2b7376ce6260a69c489ea6aacce59972496c`.
The saved native-local-program measurements were collected before that commit;
their recorded source checkpoint and quiet/native comparisons remain historical
measurement evidence, not a new acceptance run of HEAD.

- [Complete saved results](../../../../../work/validation/shared-execution-evidence/native-local-program/results.md)
  retain the quiet, root-counter and database lanes separately.
- [Exchange inventory](../../../../../work/validation/shared-execution-evidence/native-local-program/sql-work-inventory.json)
  contains all 87 standalone and 58 mixed exchanges, SQL templates, operation
  owners, transaction/checkouts, returned rows and driver-awaited time.
- [Capture ancestry and publication work](../../../../../work/validation/shared-execution-evidence/cost-inventory/capture-and-publication.json)
  retain the existing successful diagnostic's call chains and work counters.
- [Fresh CPU inventory](../../../../../work/validation/shared-execution-evidence/cost-inventory/cpu-summary.json)
  contains ten root-only profiles for each Medusa graph, raw-report paths,
  disjoint leaf counts, synchronous caller attribution and exclusions. The
  [analysis script](../../../../../work/validation/shared-execution-evidence/cost-inventory/analyze.cjs)
  consumes existing measurement-SDK classifications rather than inventing a new
  clock alignment.

Both fresh CPU runs completed with successful samples, completed cleanup, and
unchanged source inventories. Whole-investigation source snapshots also match:
15,577 files, fingerprint
`66090450d911bbd09ca1a9e056c10eb212362751f72b549440f7803a45463993`.
These are diagnostic Flarex-only profiles, not new native comparisons or quiet
latency acceptance. No production implementation was changed.

An additional PostgreSQL nested-plan diagnostic used auto_explain with complete
nested logging, analysis, buffers and per-node timing disabled. It failed during
fixture setup in publication materialization with a statement timeout. Its
[manifest](../../../../../work/validation/shared-execution-evidence/cost-inventory/database/2026-10-11T16-41-39-200Z-962e8d48-a5cd-4413-9b45-6ac26d1ee0aa/manifest.json)
and logs are retained. It supplied no successful complete-request server
breakdown. Logging overhead is a confounder, not a demonstrated explanation of
this failure or the previous intermittent Currency timeout. No retry or limit
increase was used. The owned port-56431 fixture is stopped; profiling options
were startup arguments, not persistent PostgreSQL configuration edits.

Counts below are either observed driver/work counts or explicitly labeled
source-derived internal work. Driver waits include server work, transport and
client scheduling. They are not exclusive server CPU and must not be added to
CPU-profile costs or subtracted from a different quiet cohort. Native SQL counts,
exact server-internal duration, exact duplicate demand identities and exclusive
CPU by application operation remain unavailable.

## Reconciled driver work

Standalone Medusa is the selected Variant/Pricing/Link/Tag graph on a seeded
Product, not one product SELECT. Its successful saved diagnostic contains one
checkout and one explicit transaction.

| Work | Exchanges | Summed observed driver wait ms |
| --- | ---: | ---: |
| Transaction setup, installation admission and commit | 6 | 3.96 |
| Request lock | 1 | 0.19 |
| Authority, clock and revocation observations | 19 | 6.59 |
| Application and binding metadata | 6 | 2.15 |
| Readiness and initialization | 10 | 18.35 |
| Prior outcome lookup | 1 | 0.99 |
| Row, index and unique-key work | 33 | 27.13 |
| Publication, materialization and final guards | 11 | 61.27 |
| Total | 87 | 120.62 |

The 33 storage exchanges are 15 unique-slot lookups, nine range reads, five row
reads, three current-index-page reads and one commit-head selection. The 19
authority/clock exchanges are eight authority locks/reads, seven data-access
clock reads, three revocation checks and one ordinary-writer clock capture.
The table is disjoint by submitting operation, not an assertion that every
instruction inside a database routine belongs exclusively to that category.

The 11 publication exchanges are acceptance (1), database time (1), header (1),
application materialization (1), row-fact submissions (3), header count update
(1), terminal prefix (1), clock advance (1), and final metadata guard (1).
Application materialization awaited 32.98 ms and header creation 14.81 ms in
this observed request. The three fact submissions together awaited 1.98 ms;
the count update awaited 0.45 ms. Their frequency is not their latency rank.

Mixed Medusa contains 58 exchanges, 41 checkouts and two explicit transactions.
Its 38 implicit captures awaited 68.53 ms in the saved diagnostic; the remaining
20 entry/publication/control exchanges awaited 78.44 ms. Checkouts are acquisition
events, not evidence of connection establishment or pool contention. One mixed
application-materialization call awaited 32.16 ms.

## Publication: useful writes and internal multipliers

The successful mixed diagnostic's publication owner reports:

| Durable or derived work | Count |
| --- | ---: |
| Document revisions | 9: seven creates and two updates |
| Developer index revisions | 35: 32 creates and three deletes |
| Additional intrinsic index revisions | 7 |
| Unique-slot releases / claims | 2 / 10 |
| Index coverage updates / unique coverage updates | 49 / 16 |
| Search delete row-demands / inserted entries / build updates | 3 / 3 / 3 |
| Commit headers / document facts | 1 / 9 |
| Events / deliveries / outcome / wake | 7 / 7 / 1 / 1 |

The seven intrinsic revisions are additional server totals, not a duplicate of
the 35 prepared developer revisions. Search insert counts appear both as prepared
work and server totals in the raw ledger; they describe the same three entries
and must not be added. Search delete row-demands do not count deleted posting
rows. Coverage totals are returned by the server and checked by
`materializeAcceptedApplicationPublicationRows`; standalone lacks this detail
and must not inherit the mixed counts.

In `storage/materialization/domainInstallation.ts`, `fx_advance_app_coverage`
performs, for each coverage item, an expected-state SELECT, an UPDATE, and an
immediate complete-row SELECT. It then verifies the current batch and, on the
last batch, all earlier items with another SELECT per item. The compositor uses
batches of 32. For the observed 49 index and 16 unique coverage items:

- Three table statements per item: `65 * 3 = 195`.
- Final verification SELECTs: first index batch 32, final index batch 49,
  unique batch 16: `32 + 49 + 16 = 97`.
- **292 table SELECT/UPDATE executions are implied by the current successful
  path**, inside three coverage-helper calls and one client materialization
  exchange. This excludes PL/pgSQL expression evaluation, readiness, row/index
  writes, triggers and other nested work; it is a source-derived count, not a
  server trace or a millisecond allocation.

`publicationStagesInstallation.ts` also loads each unique/index build and its
maintenance obligation, may inspect per-table write frontiers, and reselects
build rows for intrinsic transitions. `domainInstallation.ts` writes document
revisions/current pointers and index revisions/current memberships in ordered
loops. Those are additional candidates for reducing repeated execution, but the
current evidence does not establish their exclusive cost.

The initially proposed batching alternative at the existing coverage owner was
to replace the 97 final
verification lookups with **three ordered set-based verification SELECTs**, one
at each existing batch boundary. This would remove 94 table query executions
for this graph while retaining all 65 coverage updates, immediate post-write
checks, exact stored projections and the first mismatching ordinal. It does not
reduce driver exchange count and does not promise a 94-query latency saving.
Validate native timestamp precision, missing rows, prior-page tampering and
first-failure behavior before accepting this replacement.

Further batching must preserve actual lock/write/trigger ordering. Do not
discard immediate readbacks on the assumption that RETURNING proves the final
state after AFTER-trigger work. Do not drop revision history, uniqueness,
coverage, durable outcomes, event facts or final commit guards. Removing marker
advancement changes the contract across writers, readiness readers and build
recovery. That connected replacement is now selected: extend existing protected
maintenance obligations to genuine framework binding activation, keep frontiers
sealed during continuous atomic maintenance, and retain explicit progress for
actual builds/candidates. Definition selection already filters touched tables
(participant attempted tables in finite publication); skipping unrelated tables
is not a new optimization. The target removes all 65 normal serving updates and
the 227 SELECTs in their old advancement/readback loops after conversion.
Replacement fresh acceptance still costs work; this is not a net statement-count
or latency prediction.

At the Commerce publisher, facts are emitted in a separate append call per source
even after the physical writes have been combined. A bounded accumulator could
preserve source/derived order and pack adjacent facts into existing-sized pages.
The observed three submissions could become fewer when their combined packet
fits. A final known contribution could also avoid the provisional header count
rewrite if its construction frontier is moved coherently. These are small
connected cleanups, not the primary performance deliverable: all three current
fact submissions plus the count update awaited only 2.43 ms in total. They must
retain genuine callbacks, derived writes, per-source budgets and stored proof.

## Repeated captures: what repeats and what does not

| Capture purpose | Count | Observed driver wait ms |
| --- | ---: | ---: |
| Historical unique-owner index lookup | 15 | 22.55 |
| Other index selection | 11 | 20.47 |
| Previously unseen row bodies | 8 | 12.59 |
| Participant transaction time | 2 | 6.47 |
| Application write ownership | 1 | 3.59 |
| Historical insertion identity | 1 | 2.38 |
| Total | 38 | 68.53 |

Call ancestry identifies the 15 unique-owner lookups; SQL text alone did not.
The ten Product-phase index captures and eight body captures service initial
lookup, relation population, graph loading and write validation. The workflow
phase has 15 index captures and no new body capture; Payload contributes one
unique-owner index capture. Absence/negative-membership proofs can be useful work
even when no document body is returned.

The existing `logicalDocuments/workingSet.ts` already shares root rows and
dependencies, filters seen identities in `readFiniteBase`, caches complete index
selections in `indexReads`, and caches unique results in `uniqueReads`.
`finiteStorageCapture.ts` already retains compiled SQL shapes. These mechanisms
must not be proposed again as new optimizations. No exact duplicate database
demand has been proved by this inventory.

The actual repeated mechanism is fresh acquisition/admission and decoding per
capture. Distinct independent membership demands that are already known at one
trusted frontier could share a bounded capture envelope while retaining separate
results, exact dependencies, deterministic refusal order and accounting.
Current demand identities, keys, root revisions and intervening writes are not
retained, so **the removable capture count is not yet known**.

Membership acceptance, lookahead/identity charging and actual point permission
precede unseen body transfer. Those client-owned boundaries prevent a blanket
fusion of all 26 membership and eight body captures. Keeping a transaction or
connection across framework/untrusted callbacks, retaining a live authorization
verdict, or skipping liveness checks is not this proposal. The two timestamp
captures have participant semantics and are already locally cached; sharing one
root timestamp requires an explicit framework-time contract decision.

The next capture decision needs a bounded demand ledger: operation/call ordinal,
opaque demand equality ID, table/index identity, original snapshot, root revision,
limits, result completeness, dependency/permission frontier and intervening
write. Use opaque fixture identities, not raw user values. Only then calculate
which already-known independent demands can be submitted together and which
same-snapshot complete selections can be reused. No capture savings estimate is
assigned to an identical redacted SQL template.

## Client CPU: fresh location evidence

Both graphs used the existing root-only profiler: five warmups and ten diagnostic
profiles, each with the SDK's calibration protocol. Only self samples definitely
inside the request window are included below; categories are disjoint.

| Sampled leaf location | Standalone: 486 active samples | Mixed: 915 active samples |
| --- | ---: | ---: |
| Flarex source | 38.27% | 42.30% |
| Effect | 37.45% | 34.21% |
| Drizzle | 10.49% | 5.68% |
| PostgreSQL client | 1.65% | 4.04% |
| Node builtins | 5.76% | 6.23% |
| Unresolved native/redacted | 6.17% | 6.78% |
| Other | 0.21% | 0.77% |

Excluded standalone counts: 374 idle, two GC, 13 program/root, 190 boundary
ambiguous and 11 outside samples. Mixed: 613 idle, 21 GC, 13 program/root,
225 ambiguous and ten outside. Synchronous application callers are unavailable
for 127/179 active samples; async ancestry must not be fabricated. These shares
are sampled locations, not percentages of removable work or exclusive CPU ms.
They do not partition the older 77/141 ms added-native CPU numbers.

The private JSON visitor is a visible leaf (24 standalone samples); its broader
file has 27 standalone and 29 mixed samples. Thirteen samples in each graph are
under `captureCommerceInput`; other callers include projection, working-set
values, relational rows, events and request capture. Current code already issues
immutable value facts and reuses exact owned children. Foreign descriptors,
undefined omission, byte/node/depth accounting and escaping mutable copies remain
necessary. To remove another traversal, demonstrate the same authentic immutable
value passing through a redundant internal boundary; sample counts do not prove
that identity or redundancy.

Effect samples include construction/interpreter/Result/Schema work. A sampled
library name is not a recommendation to replace Effect. The Promise bridge is
the genuine framework boundary and owns cancellation, runner joining and closure.
Candidate CPU work must be attributable to a repeated application operation,
preserve that lifetime, and eliminate the operation or fuse a pure traversal
within its existing owner. Drizzle source callers include publication tuple/SQL
construction, but 36/31 Drizzle samples lack a synchronous repository caller.
The prior scalar-tuple-to-array transport correction is already implemented.

## Ranked proposal for discussion

| Rank | Connected target | Removable work established or proposed | Confidence and decision gate |
| --- | --- | --- | --- |
| 1 | Binding-owned maintenance across activation, publication and ordinary/finite readers | Remove the 65 recurring coverage-marker updates and their old 227 internal SELECTs for fully converted maintained serving builds | Owner approved after discussion. Replacement fresh acceptance has cost; complete CPU/latency savings remain unmeasured. Preserve current authority, atomic complete maintenance, build/recovery and migration proofs. |
| 2 | Finite demand formation, capture envelope and working-set interpretation | Repeated capture overhead for independent demands available at the same frontier; reuse only exact complete snapshot evidence | 38 captures are observed; zero exact duplicate demands proved. Record demand identity and frontier first; do not predict 38-to-1. |
| 3 | Client preparation/value processing at the measured owners | Repeated preparation or traversal of genuinely identical owned input; avoid reconstruction before an existing validator/encoder | Current profiles identify locations, not redundant invocation counts. First establish per-operation visits/bytes and authentic value identity; retain native framework boundaries. |
| 4 | Ordinary authority/clock choreography | Potential repeated observations within one continuously held, authentic transaction capability | Low initial priority: 19 exchanges awaited 6.59 ms total. Freshness, post-wait refresh and revocation forbid generic memoization. |

Decision: implement the **binding-owned maintenance cutover** in preflight 27.
The earlier 94-select batching proposal and source-fact packing are superseded
as the primary direction. They do not remove recurring marker writes. The
approved preflight inventories the necessary private schema, reader, writer,
permission and migration changes. No silent data reset, new host lifecycle,
Effect-wide rewrite, adapter cache or unrelated capture redesign is selected.

Required proofs include batch/prior-page corruption and trigger cases, exact
failure ordinal, coverage/build concurrency, lock order, native timestamp
precision, rollback/unknown-commit behavior, and actual standalone/mixed business
consumers on PGlite and ordinary-role PostgreSQL. Both project reviews, cleanup
and full matched native CPU/quiet latency gates remain delivery requirements.

Before attributing publication savings, obtain a bounded server diagnostic that
does not dump every setup statement: bracket the request and target the coverage
helper or use filtered nested statistics. Preserve the failed full-log attempt.
Measure matched baseline/candidate business graphs with observers disabled for
acceptance, collect native driver counts in the diagnostic lane, and report
server work, client CPU and end-to-end latency independently. The unchanged
complete gates are added median thread CPU <=16 ms and paired added median/P95
latency <=5/10 ms; a favorable internal count is not completion.

## Source anchors

- `packages/persistence-postgres/src/storage/materialization/domainInstallation.ts`:
  `fx_advance_app_coverage`, row/index write primitives and materialization batching.
- `packages/persistence-postgres/src/storage/materialization/publicationStagesInstallation.ts`:
  unique/index coverage acceptance, intrinsic rereads and materialization entry.
- `packages/persistence-postgres/src/storage/materialization/materialization.ts`:
  returned proof counts and additional intrinsic work, not double-counted observations.
- `packages/persistence-postgres/src/frameworks/commerceTransaction/logicalPublication.ts`
  and `publication.ts`: source-ordered fact appends and provisional count ownership.
- `packages/persistence-postgres/src/commit/publication/prefixWriter.ts`
  and `prefixInstallation.ts`: page, stored proof, terminal and header-count duties.
- `packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts`:
  root caches, historical uniqueness and membership/permission/body boundaries.
- `packages/persistence-postgres/src/execution/finiteStorageCapture.ts`:
  retained query shapes and per-command fresh acceptance.
- `packages/persistence-postgres/src/values/privateJsonData.ts`,
  `packages/medusa-adapter/src/commerce-input.ts`, `commerce-promise-owner.ts`
  and `workflow-value.ts`: genuine capture, runtime and escaping-copy boundaries.
