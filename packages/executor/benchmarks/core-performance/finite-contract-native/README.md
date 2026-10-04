# Finite execution contract evidence

These reports measure the selected [finite execution contract](../../../../../roadmaps/mixed-mutation-core/23-finite-execution-contract-preflight.md).
Successful benchmark execution verifies the native DTO/error assertions and records samples;
it does not establish the numerical acceptance gates.

The original is `work/validation/mixed-query-read-20261003/native-read-baseline/mixed-native-baseline-02-quiet.json`.
Both it and `finite-contract-native-01-quiet.json` retain thirty alternating pairs per
branch after three discarded warmups. The latter predates the subsequent empty-write
closure, qualified admission, nominal scope identity and immutable index preparation
corrections; its source hashes identify that checkpoint.

| Quiet checkpoint | Branch | Added method median / P95 (ms) | Complete finite request median / P95 (ms) |
| --- | --- | --- | --- |
| Original | Hit | 16.249 / 20.683 | 301.286 / 326.839 |
| Original | Miss | 14.956 / 16.363 | 203.438 / 218.523 |
| Finite contract 01 | Hit | 9.486 / 11.247 | 386.584 / 406.626 |
| Finite contract 01 | Miss | 7.457 / 9.918 | 214.219 / 233.652 |
| Finite contract 02 | Hit | 8.337 / 13.118 | 303.394 / 333.109 |
| Finite contract 02 | Miss | 6.704 / 7.441 | 213.925 / 227.058 |
| Finite contract 03 | Hit | 8.901 / 14.735 | 306.445 / 340.088 |
| Finite contract 03 | Miss | 6.514 / 7.991 | 283.397 / 532.796 |
| Finite contract 04 | Hit | 7.951 / 11.245 | 364.636 / 615.300 |
| Finite contract 04 | Miss | 6.362 / 7.623 | 210.620 / 223.758 |
| Finite contract 05 | Hit | 8.221 / 9.642 | 312.008 / 470.129 |
| Finite contract 05 | Miss | 6.315 / 7.425 | 211.492 / 229.007 |

Finite contract 05 measures the final private architectural cutover, including
original native schema-evidence retention and its ABA replacement correction.
Both median added-method gates still fail; both P95 added-method gates pass.
Complete-request non-regression fails for both branches. The maximum hit request
is 1,274.516 ms and is retained. Before/after `quiet-05-executing-*.json` supplements
verify the same pinned inventory; all agents were idle, statement tracking was
disabled, and durability settings stayed enabled. This measurement closes the
cutover observation, not performance acceptance.

Finite contract 01 fails the fixed added-method budget of median <= 5 ms and
P95 <= 10 ms for both branches, and fails complete-request non-regression.
Keep those failures visible when evaluating later checkpoints. Setup, entry,
seal and publication costs remain charged in the reports; setup is not assumed
permanent or removed from whole-goal accounting.

`finite-contract-native-trace-01-trace.json` retains two diagnostic pairs per
branch without warmups. It identifies actual client submissions, selected
decoded-result bytes, preparation growth and phase intervals. Instrumented
timings are not quiet acceptance evidence. This checkpoint's metadata classifier
omitted the new authority/compact-kernel relation names; consult the actual
dispatch records for those results rather than treating its classified metadata
total as complete. Subsequent classifier corrections do not rewrite the report.

Finite contract 02 includes the qualified admission composition, transaction-local
scope identity reuse, authenticated immutable index specification reuse and
empty-write closure correction. It retains the same thirty-pair protocol and
still fails both-branch median acceptance, hit P95 and complete-request
non-regression. Its before/after executing-evidence supplements verify all
1,396 promoted outputs and twelve selected native entries against the original;
the separately recorded authored native runner difference remains the only
native inventory difference. The native framework outputs did not change.
These checkpoints precede the two-phase installed-admission correction required
to preserve refusal before attempt lock waits; they do not measure its final
performance.

Finite contract 03 measures the two-phase installed-admission correction under
the original 5,000-entry statistics capacity, with tracking disabled. It retains
thirty alternating pairs and three discarded warmups. Both-branch median gates,
hit P95 and complete-request non-regression still fail. The retained miss has a
large complete-request tail; no samples are removed or substituted. Before/after
executing-evidence supplements retain the unchanged pinned native graph.

Finite contract 04 includes the reviewed private unique-selection preparation,
stable Schema compiler reuse and removal of the displaced compact binding
projection cache. Both median gates, hit P95 and complete-request non-regression
still fail. The hit request retains its 1,099.148 ms maximum. All thirty pairs
and three warmups remain in the report, and before/after supplements verify the
same pinned native graph. Passing DTO/error and source checks does not accept
these latency results.

Trace 02 observes seven actual method submissions for a hit and six for a miss
in one accepting transaction. The warm diagnostic hit returns 11,699 decoded
JSON bytes, including 7,814 classified metadata bytes; the miss returns 7,832,
including 7,826 metadata bytes. Preparation grows during entry but has zero
incremental growth across either demand. The hit's publication uses 43 client
submissions and 22,533 decoded bytes. These are diagnostic samples, not quiet
timings or wire traffic. Awaited SQL accounts for only part of the method
interval; the remainder is not an isolated CPU measurement.

`finite-contract-native-server-01-failure.log` records a refused diagnostic
interval: PostgreSQL deallocated statement statistics during retrieval. No
server timing is accepted from that run. `server-statistics-capacity.json`
records the actual existing 5,000-entry capacity and the selected diagnostic
20,000-entry capacity required to retain the complete interval. The observer's
reset/deallocation guard and durability settings remain intact.

`finite-contract-native-cpu-01-cpu.json` and its eight retained V8 profiles
capture two diagnostic pairs per branch, without discarded warmups. The actual
warm finite hit/miss contain only 28/22 samples. The requested 100 microsecond
interval produces observed median sample deltas around 0.54 milliseconds.
The first inspector-start sample contributes 240–776 milliseconds outside the
method clock, dominating returned profile spans. Keep these genuine timestamps
and samples; neither the span nor summed inclusive frames establish exclusive
CPU. Matched frames include service construction, query compilation, fixed
metadata formatting, kernel decoding and row validation, with substantial idle
sampling and no dominant CPU owner established. Diagnostic timings cannot
satisfy quiet gates. Before/after supplements retain the original pinned output
comparison.

`finite-contract-native-server-02-failure.log` retains another refused server
diagnostic: its guard expected displaced nested prepared-metadata epoch work.
The selected owner reads both qualified epoch records in its installed top-level
statement. No server timing is accepted from this failure.

`finite-contract-native-server-03-server.json` accepts the strict replacement
observation inventory: separate installed and compact top-level calls, both
qualified epoch joins, and positive nested installation, placement, receipt,
authority, sequencer, session, lease, journal and claim reads across all executing
roles. Warm top-level execution totals approximately 1.18 milliseconds for
either branch; measured method wall intervals are 13.02 milliseconds for the
hit and 9.99 for the miss. First-use compact execution is approximately 22
milliseconds, falling to 0.56 warm; this report does not isolate its cause.
Nested work overlaps parent execution and must not be added to it. Planning is
unmeasured with `track_planning=off`; zero recorded planning time is not proof
of zero planning cost. This instrumented run cannot satisfy quiet gates.

No complete scaling or whole-goal acceptance is established by these reports.
Network round trips and wire traffic are not
measured. Executing source fingerprints and pinned native build provenance must
accompany any replacement acceptance measurement.
