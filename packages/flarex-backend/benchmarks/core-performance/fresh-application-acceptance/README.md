# Fresh Application acceptance: connected milestone

The selected Application acceptance component and bounded connected correctness
pass. This ledger preserves the declared full
mixed milestone, including an original mixed quiet regression and a healthy targeted
repeat whose cause is unresolved. Neither whole performance goal nor native parity
is complete.

`ledger.json` owns measured comparisons and limits; `manifest.json` owns exact raw,
gzip and source provenance. Raw originals remain in ignored validation directories.
Quiet JSON is copied byte for byte; traced JSON uses verified lossless gzip. The
initial failed baseline setup is retained separately.

| Warm wall median / P95 ms | Baseline | Final full quiet | Targeted repeat |
| --- | --- | --- | --- |
| Product | 579.9226 / 589.6374 | 540.6721 / 599.9264 | — |
| Product + Payload | 629.5939 / 655.9538 | 573.7184 / 622.9598 | — |
| Mixed workflow | 1041.359 / 1219.6634 | **1111.2239 / 2100.9614** | 972.44315 / 1095.7869 |
| Standalone workflow | 276.9914 / 298.0398 | 266.6904 / 271.3023 | — |

Full runs have three warmups, twenty measured warm and three cold samples per
workload (104 total). The repeat uses that same plan for mixed workflow only
(26 total). All final samples and setup succeed. Median averages the central pair;
P95 is nearest rank. Product P95 also exceeds the original baseline. No samples
are filtered, no medians/P95 are subtracted, and the repeat does not replace the
original regression. Mixed Worker construction/readiness median/P95 rises from
84.91635/94.8692 to 193.8132/814.9955 ms in the original full run and is
86.82265/94.7233 ms in the repeat. This identifies an observed slowdown interval,
not its cause. The standalone median meets the selected below-400 ms and below-10%
regression gate.

Final trace has 52,238 SQL dispatches and 2,028 transactions over 104 samples, with
zero unknown statements, query errors, unobserved/lost-context dispatches or
incomplete spans. Warm Product/Product+Payload/mixed/standalone requests have
477/498/762/270 SQL and 20/21/34/3 transactions. The baseline smoke has
478/499/763/270 SQL with unchanged transactions; admission falls 96 to 95 SQL in
each mixed graph. That smoke has only two measured warm samples per workload and
is a structural comparison, not a quiet latency baseline. Cold/first-use variation
remains charged in the full totals.

Baseline captures 107 source paths; final quiet, traced and repeat capture 110.
The added paths are the Application-native mutation fixture, exact running-tail
catalog owner and logical Currency fixture. All final snapshots and current bytes
match under root's external source freeze. The harness itself captures hashes once
and has no per-sample or final rehash assertion; do not infer baseline end-proof.
Settings and selected workload revisions/resource demand match except the generated
runtime role. Corrected separate-pool Payload/Product/Link fixture helpers are not
invoked by these measured workloads. Private Query RPC is outside this actual graph.

The mixed native workflow group is 226 SQL/13 transactions; Product update is
179 SQL/10 transactions; authoritative publication is 146 SQL/one transaction.
These include genuine framework work and fresh proof. Most exact SQL owners remain
unattributed. The existing `pointCommitTransaction` publication owner is a possible
next coherent attribution target; it requires a focused preflight before activation
and is not an approved remedy for the unresolved mixed regression. Nested inclusive
phases, driver awaited intervals and quiet distributions are separate evidence.

See the [standalone Product component ledger](../../../../medusa-adapter/benchmarks/core-performance/native-retrieval/README.md)
for its passing initial-readiness/pre-attestation/tail gate, complete preparation,
retained-Pool controls, cold physical Pool costs, protocol counts and earlier failed
candidates. Actual cache-disabled Hyperdrive and post-native finite Product event
global-tail proof remain unavailable; Atomic public Product retains its ordinary
full-live profile.
