# Measurement SDK retained evidence

These are the exact reports from the 2026-10-06 connected SDK validation of the
existing `mixed-product`, `small` business graph. Each `.json.gz` restores the
original JSON bytes; each `.md` is an unchanged copy of the generated report.
The original source directory was `work/validation/measurement-sdk-20261006/final/`.

| Run | Lane and mode | Retained artifacts | Recorded result |
| --- | --- | --- | --- |
| `4c2f6366-4619-48ac-a726-a1e0264d5f61` | Ordinary-role PostgreSQL 18.3, `measure` / `database` | [JSON gzip](4c2f6366-4619-48ac-a726-a1e0264d5f61.json.gz), [original report](4c2f6366-4619-48ac-a726-a1e0264d5f61.md) | Complete execution and diagnostic collection; acceptance `notEvaluated`. One warmup, one separate quiet calibration, one diagnostic request. |
| `650ca3f6-002c-4665-8b0e-21eaf20fcd05` | PGlite, `measure` / `timeline` | [JSON gzip](650ca3f6-002c-4665-8b0e-21eaf20fcd05.json.gz), [original report](650ca3f6-002c-4665-8b0e-21eaf20fcd05.md) | Complete execution and diagnostic collection; acceptance `notEvaluated`. One separate quiet calibration and one diagnostic request. |
| `87014d0a-be10-470c-949c-ad4dd0381c34` | Ordinary-role PostgreSQL 18.3, fresh native/Flarex `compare` / `quiet` | [JSON gzip](87014d0a-be10-470c-949c-ad4dd0381c34.json.gz), [original report](87014d0a-be10-470c-949c-ad4dd0381c34.md) | Both complete calls and committed business results verified; acceptance `failed`. One measured pair, no warmups. |

The diagnostic requests execute the real connected business composition and
retain ordered Effect/owner observations, scalar work, observer intervals and
disjoint root accounting. PostgreSQL additionally retains physical driver,
checkout and transaction observations: 40 driver exchanges, 16 checkouts and two
transaction intervals in its diagnostic. Both diagnostic roots reconcile with
zero recorded accounting error, no dropped events, no lost context and no
collector failures. Each run records stable sources/settings and completed
owned-resource cleanup.

Complete collection does not mean complete semantic attribution. PostgreSQL's
256.927 ms root has 3.835 ms attributed, 57.614 ms ambiguous and 195.478 ms
unattributed wall. PGlite's 361.511 ms root has 4.450 ms attributed, 79.938 ms
ambiguous and 277.123 ms unattributed wall. These conservative gaps remain
visible; neither reconciliation nor overlapping owner spans explains the
remaining time. Phase and wait ledgers account for the same root and must not be
added together.

PGlite's timeline mode does **not** collect its database driver. The original
artifact's zero driver/checkout/transaction/row/byte counts and wait unions mean
unavailable observations in this lane, **not zero SQL or zero database work**.
No run collects CPU, GC or server execution/waits. Driver await does not establish
server execution, lock time or network cost; decoded JSON bytes do not measure
wire traffic or heap allocation. Platform clock precision is unknown. Observed
collector intervals cover only the captured instrumentation work. Quiet and
diagnostic requests remain separate; observer cost is never subtracted to invent
quiet latency.

The cold single pair records native 68.990 ms, Flarex 435.312 ms and paired excess
366.322 ms. It proves fresh pairing and complete-request comparison, not latency
acceptance or a distribution: its recorded sampling gate fails, and the retained
one-sample median/P95 fields repeat the sole value. Added-median and added-P95
gates also fail. Native independently commits framework calls and uses an
Application SQL surrogate; it does not reproduce Flarex's atomic mixed
publication, OCC, revision history or durable outcome. The diagnostic and native
runs retain different source digests, each stable within its own run. These
artifacts establish the bounded observation cutover, not a baseline/candidate
performance improvement, production readiness or hosted/scale acceptance.

## Integrity

Gzip restoration was checked with byte-for-byte comparison and matching SHA-256
hashes. Original Markdown and retained Markdown hashes also match. Sizes are
bytes; hashes below identify the restored original JSON, not its gzip envelope.

| Run | Original JSON bytes | Gzip bytes | Markdown bytes | Original/restored JSON SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `4c2f6366-4619-48ac-a726-a1e0264d5f61` | 4,841,730 | 316,866 | 6,048 | `e5ba906eff73e455db57d58b2c1267bee464dc1af994d67a4b46da2b6a519dbc` |
| `650ca3f6-002c-4665-8b0e-21eaf20fcd05` | 1,988,197 | 102,051 | 5,852 | `252fdb81c8958280597ced14f5154ec70d01d43135874734e5683a103ceb408c` |
| `87014d0a-be10-470c-949c-ad4dd0381c34` | 6,003 | 1,255 | 2,228 | `2f2d9dac746280beefd7ccd31ab575ba010b34b58cdbaee9927aaffa3a2ac485` |
