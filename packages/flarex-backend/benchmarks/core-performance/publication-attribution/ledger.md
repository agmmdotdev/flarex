# Publication Attribution Ledger

## Disposition And Provenance

The corrected paired lane is a usable historical observed-source baseline:
36 attempts, three genuine finishing
profiles, one warmup pair and five retained alternating boundary-only/detailed
pairs per profile. All attempts succeeded, observer delivery and phase edges were
healthy, and all 119 start/end source hashes matched. Boundary-only includes
owner interval stamping; it is not an uninstrumented control. No optimization
was applied. This ledger does not establish the cause of the earlier mixed
regression, production latency, native parity or whole-goal acceptance.

| Artifact | Attempts | Disposition | Root process envelope seconds |
| --- | ---: | --- | ---: |
| [Initial paired](./paired-initial.json.gz) | 13 | Invalid naming harness: twelve Product successes, then native Product handle validation refused before publication | unavailable |
| [Corrected paired](./paired-corrected.json.gz) | 36 | Complete historical observed-source paired baseline | 130.7807811 |
| [Initial server](./server-initial.json.gz) | 0 | Invalid executing-pool settings; process startup overrides defeated reload | 27.031622 |
| [Partial server](./server-partial.json.gz) | 2 | Two healthy Product attempts, then strict reset/deallocation refusal during Payload profile setup; matrix invalid | 75.0858045 |
| [Final server cap receipt](./server-final.json.gz) and six individual sample files | 6 | Business outcomes healthy, server artifact invalid/partial; final raw cap refusal | 81.1666689 |

Original sample order, failures, settings, setup and source identities remain in
the compressed artifacts. The [manifest](./manifest.json) records private
original hashes, packaged derivative hashes and verified gzip hashes. Server
query derivatives redact 18 actual utility credential literals; numeric counters
and all other JSON tokens retain their original bytes. Private originals and
run logs remain ignored. No old cluster log history was read or packaged.

The final server retained six actual sample files totaling 22,565,153 bytes. Its
unwritten final raw was 267,684,207 bytes: combined 290,249,360 exceeded the
262,144,000-byte raw cap. No raw/report/finalization success exists. Original and
PID-filtered log copies were refused before either write; the exact admission
reason, final offsets and comparison windows were not retained. They remain
unavailable, even though the private cluster log is preserved. No rerun, cap
increase or reconstruction is selected. A later compact-receipt fix preserves
bounded metadata on future refusal; it supplies no missing measurement here.

The partial server's older failed comparison snapshots likewise remain absent.
Its 151,703,420-byte append exceeded the former 50 MB cap; no log copy exists.
Its old raw coverage label is superseded by this explicit unavailability. The
initial server's zero-byte log files establish only an empty append, not nested
coverage. All server lanes remain invalid as complete matrices.

## Owner Timing

Values are median / observed P95 milliseconds, five retained samples per mode.
At this sample size P95 is the observed maximum. Each phase uses the union of its
intervals within one sample. Parent/child regions overlap and cannot be added.

| Boundary-only region | Product | Product + Payload | Workflow |
| --- | --- | --- | --- |
| Complete attempt | 544.146 / 569.444 | 579.620 / 612.558 | 932.925 / 986.198 |
| Genuine publisher, including gaps | 78.592 / 88.219 | 82.170 / 99.155 | 150.634 / 159.627 |
| Command preparation | 3.140 / 3.316 | 4.016 / 4.409 | 6.262 / 9.140 |
| Definition preparation | 7.108 / 13.071 | 7.824 / 13.083 | 11.848 / 12.625 |
| Target transaction | 64.126 / 67.209 | 66.874 / 80.806 | 125.572 / 137.541 |
| Participant proof | 32.371 / 33.965 | 33.384 / 37.838 | 56.653 / 61.952 |
| Lowering | 19.738 / 23.002 | 21.506 / 27.914 | 57.230 / 63.406 |
| Durable publication | 4.502 / 5.188 | 4.605 / 6.328 | 5.875 / 6.710 |

Matched-pair detailed-minus-boundary publisher differences are
20.149 / 25.985, 20.758 / 26.064 and 28.851 / 48.390 ms respectively.
Detailed/boundary publisher ratios are 1.259 / 1.331, 1.254 / 1.317 and
1.192 / 1.313. Each difference/ratio was formed within its actual pair before
the distribution. These include workload variation and charged diagnostics;
they are not pure observer overhead. Complete-attempt differences also include
Worker variation and are separately retained in the [summary](./summary.json).
Fixture authoritative publication may include executor finishing/handoff work;
the core publisher region is independently recorded.

The complete-attempt label means the measured `runAttempt` interval. Its clock
starts after `prepareAttempt` graph seeding and excludes initial fixture setup,
evidence/trace finalization, source hashing and artifact writing. Those costs are
separately retained as `preparationMs`, setup and evidence/finalization fields and
artifact receipts; they remain charged work without being inserted into the
attempt distribution. Root process envelopes also retain surrounding work.
Do not add the separate medians or percentiles.

## Dispatch And Demand Ledger

All five retained detailed samples preserve the same dispatch multiplicities.
The publication phase includes work outside the target transaction.

| Graph | Product | Product + Payload | Workflow |
| --- | ---: | ---: | ---: |
| Complete publication dispatches | 103 | 108 | 146 |
| Control / target | 17 / 86 | 19 / 89 | 31 / 115 |
| Distinct fingerprints | 87 | 90 | 102 |
| Inside target transaction interval | 82 | 85 | 111 |
| Explicit target BEGIN / COMMIT | 1 / 1 | 1 / 1 | 1 / 1 |
| Participant proof, all target | 25 | 28 | 40 |
| Lowering, all target | 28 | 28 | 42 |
| Durable publication, all target | 11 | 11 | 11 |
| SELECT / WITH / INSERT / UPDATE / DELETE | 72 / 5 / 12 / 6 / 5 | 77 / 5 / 12 / 6 / 5 | 104 / 7 / 16 / 9 / 7 |

BEGIN, SET and COMMIT contribute three further dispatches in each complete graph.
The [owner ledger](./owner-ledger.json.gz) preserves every sample's phase/pool/
verb/fingerprint multiplicities, observed parameter counts/scalar bytes/unknown
encodings, SQL bytes, source owner classifications and input/batch events.
Interval intersections overlap; an intersecting query is not exclusive ownership.
Full source sites and SQL templates remain in the paired raw artifact.

Representative retained pair 1 original and actual material demands follow;
all per-sample byte variation remains in the summary/raw.

| Demand or actual issued batch | Product | Product + Payload | Workflow |
| --- | ---: | ---: | ---: |
| Planned live rows / touched tables | 2 / 2 | 3 / 3 | 9 / 9 |
| Row revisions / creates / updates | 2 / 1 / 1 | 3 / 2 / 1 | 9 / 7 / 2 |
| Index revisions / creates / deletes | 5 / 3 / 2 | 7 / 5 / 2 | 42 / 39 / 3 |
| Unique releases / claims | 1 / 1 | 1 / 2 | 2 / 10 |
| Index / unique coverage rows | 10 / 2 | 12 / 3 | 49 / 16 |
| Search target rows / inserted entries | 1 / 1 | 1 / 1 | 3 / 3 |
| Row facts / events / deliveries | 2 / 1 / 1 | 3 / 1 / 1 | 9 / 7 / 7 |
| Point dependencies | 11 | 12 | 15 |
| Intrinsic / developer / unique definitions | 2 / 9 / 2 | 3 / 10 / 3 | 9 / 41 / 16 |
| Journal / result bytes | 13,140 / 4,363 | 20,419 / 5,617 | 34,732 / 4,939 |

Each actual batch plan also issued one commit header, outcome, wake, journal
deletion, lease deletion, session commit and clock advance. Counts describe
provisional writes verified in the transaction; actual successful COMMIT makes
their effects durable. Input counts, repeated contribution evidence and actual
batches are different levels and must not be summed together. Search delete
counts are targeted row identities, not affected entries; reference endpoints
are selected table IDs, not fine edge demand. Participant range/unique demands
are already batched by contribution, not one query per individual dependency.

The participant graph is 1 journal + 1/2/8 historical participant reads + one
shared 21-dispatch full-live source graph + 2/4/10 dependency dispatches.
Full-live source proof executes once, not once per contribution. This is fresh
participant correlation, not a lowering optimization seam.

## Partial Server Evidence And Limits

[Partial server summary](./partial-server-summary.json) preserves actual window
epochs, deallocation counts, snapshot costs and separate top-level/nested
counters without SQL text. Its retained Product publication window has
103 top-level calls across 87 entries, 9.1663 ms planning and 7.5466 ms execution;
29 nested calls across 13 entries have 0.1816 ms planning and 0.1862 ms execution.
The warmup window had 107 top-level calls and is separately preserved. Parent
execution includes nested work; never add those timings or compare them with
quiet distributions as an improvement. Both windows had unchanged reset epoch
and zero deallocation. This one retained Product window does not establish an
all-profile distribution or universal function/trigger coverage. Missing log
copies prevent full reconciliation. An empty counter delta is not proof of zero
SQL work. CPU, lock waits, wire round trips and complete native comparison remain
unavailable.

All measured runs used 119 source identities. Final current-byte comparison
matches 114. The harness, report and server collector changed for future refusal
retention; `pointCommitTransaction.ts` and `commitPublication/publication.ts`
changed for phase-boundary transparency. OCC, lowering and clock advance now
stamp guarded phase edges inside their original async owners with `try/finally`,
retaining original awaits and kernel allocation/return instead of extra
diagnostic async callback grouping. Disabled scheduling and exact observed
child boundaries are therefore relevant to this correction. These final core
bytes are unmeasured; final latency reproduction is not claimed. The manifest
lists every exact difference. Measured originals, reports, summary and compressed
owner projection keep their original source/interval interpretation.

The implemented focused point-publication witness now combines a throwing phase
observer, forwarded COMMIT, held then lost response, interruption and replay
through a fresh publisher. It asserts deferred interruption until the response
boundary, interrupted Exit, both OCC/lowering/clock phase edges, retained
diagnostic failure and exactly one durable commit header/outcome/wake with clock
sequence one after replay. This does not generalize to all native lifecycle or
server-observer failure combinations and supplies no final-source performance
measurement. No additional performance run is selected.

Start/end hashing, setup, seeding, native work,
admission, seal/finishing, serialization/copy, snapshots and artifact costs are
charged in the original receipts. Packaging separately processed 161,419,883
input bytes within the raw cap; per-file redaction/gzip/verification costs and
the extra ledger projection pass are recorded. True peak memory and a
self-referential manifest write duration are unavailable.
