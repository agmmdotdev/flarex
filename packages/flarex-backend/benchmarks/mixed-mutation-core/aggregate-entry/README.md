# Aggregate entry performance

The [full traced](./traced/manifest.json) and [full untraced](./untraced/manifest.json)
series each retain all 104 planned samples: three warmups, twenty warm requests,
and three cold requests for each of four workloads. All 208 succeed, with zero
setup failures, exclusions, or replacement samples. Warm maxima, including the
Product **7,701.2517 ms** observation, remain in the raw archives and CSVs.
Only the declared warmups are omitted from warm latency distributions.

The [manifest](./manifest.json) records every artifact hash, exact raw JSON gzip
round trips, and original report bytes. Both lanes retain the same **107 measured
checkpoint source hashes**, including all original 73 owners. Their recorded
revision is `8125716500b618f10a3e4a21103a56e170a7ca51` and working-diff SHA-256 is
`c255dd46d33990eebc06c05f76539e2531666d91506e9a2a650d9d4de9854d8c`.
The [verified checkpoint](./verified-measurement-checkpoint.json) preserves the
complete source inventory. After measurement, a redundant trailing CRLF was
removed from `sessionJournalFiniteEntry.ts`, preserving its existing final LF.
The [mechanical-change proof](./post-measurement-mechanical-changes.json) records
both hashes and reconstructs the exact 7,246-byte measured file by appending
`0d0a` to the current 7,244-byte file. Its entire current prefix is unchanged;
the other **106** source files match their measured hashes. Original raw bytes,
source hashes, numeric evidence, and the recorded working-diff hash are preserved.
Packaging and this document are outside that measured inventory.
The previous [bounded-read](../bounded-read-execution/README.md) and
[batched-settlement](../batched-settlement/README.md) artifact directories remain
byte-for-byte unchanged; both complete inventories are retained in the manifest.

## Complete profile and acceptance

The two new lanes use identical code, business selections, PostgreSQL settings,
and source checkpoint, with distinct ordinary runtime roles. Local PostgreSQL
18.3 has fsync, synchronous commit, and full-page writes enabled; Node is
24.16.0 and pg is 8.22.0 on Windows x64. The target pool maximum is ten. Each
mixed request uses a fresh single-use Worker through the in-process private test
bridge and a PostgreSQL TCP socket.

The retained slice 17 mixed fixture omitted initial execution authentication and
genuine initial renewal. Matching benchmark settings and business selections do
not establish equivalent authenticated semantics. The complete profile preserves
both obligations. Its aggregate entry has two target transactions and one
control transaction; genuine initial renewal adds one target transaction to the
observed admission phase. Structural capture does not substitute for renewal.
The three-transaction entry topology is an owner contract with connected
correctness evidence; the aggregate phase trace does not isolate its transactions
from renewal.

| Graph | Warm SQL / transactions | All-temperature maximum SQL | Unchanged SQL ceiling | Complete transaction ceiling | Structural result |
| --- | ---: | ---: | ---: | ---: | --- |
| Product | 519 / 20 | 523 | 540 | 20 | Pass |
| Product + Payload | 542 / 21 | 548 | 563 | 21 | Pass |
| Mixed workflow | 845 / 34 | 849 | 853 | 34 | Pass |
| Standalone workflow | 309 / 6 | 309 | 309 | 6 | Pass |

All 104 traced samples enter structural acceptance, including warmups and cold
requests. Every mixed admission is **97 SQL dispatches: 71 target and 26
control**, with **three target and one control transaction**. The complete
admission ceiling is 126 dispatches and four transactions. Every mixed terminal
path retains three transactions. Warm terminal SQL is **173 / 178 / 216**;
all-temperature maxima are **177 / 183 / 220**, below the retained slice 17
ceilings **228 / 236 / 321**. These ceilings were not replaced by the previous
observations of 175 / 180 / 218.

The original three-transaction admission forecast and whole transaction
forecasts **19 / 20 / 33 / 6** remain explicitly evaluated in
[analysis](./analysis.json). The three mixed original forecasts fail and are
superseded for the complete authenticated profile. Only their transaction
ceilings are corrected to **20 / 21 / 34 / 6**; whole SQL and latency ceilings
are unchanged. No cold exception or discarded observation is used to pass.

Times below are milliseconds from the independent untraced whole-request
interval. Median is arithmetic and p95 is descriptive nearest rank, using twenty
warm samples per graph.

| Graph | Warm p50 | Warm p95 | Warm maximum | Cold p50 | Required p50 / p95 | Latency result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Product | 752.9547 | 888.0101 | 7,701.2517 | 675.1477 | 100 / 200 | Unmet |
| Product + Payload | 678.6368 | 695.3511 | 701.9865 | 722.9142 | 200 / 400 | Unmet |
| Mixed workflow | 1,196.5994 | 1,289.4937 | 1,292.9592 | 1,268.1763 | 500 / 1,000 | Unmet |
| Standalone workflow | 314.5814 | 336.3279 | 356.4085 | 324.0746 | Median below 400 | Pass |

Standalone retains its selected graph, 128 resource calls, and six-transaction
profile. Its median changes from **287.0612 to 314.5814 ms**, a
**9.586912%** regression, below the strict 10% comparable regression gate.
All three mixed p50 and p95 goals remain unmet. The Product maximum and remaining
mixed latency have no established cause in these records; no outlier exclusion,
CPU, transport, lock, or server attribution follows from them.

## Actual dispatch ledger and limits

[Admission deltas](./admission-dispatch-deltas.csv) retain every matched warm
normalized pool/fingerprint comparison. Every mixed comparison satisfies:

**138 − 13 wrapper dispatches − 51 displaced fingerprint dispatches + 23 added
fingerprint dispatches = 97**.

The original forecast formula `138 − 16 − D + A = 122 − D + A` is superseded.
The observed wrapper reduction is thirteen. Displaced and added fingerprints
include projection replacement, complete authentication, and changed observations;
they are not semantic owner D/A, eliminated row work, or a renewal cost estimate.
The isolated initial-renewal dispatch count is **unavailable** because trace owner
mappings do not identify it and shared read fingerprints cannot be allocated from
phase totals.

Compared with retained slice 17 warm observations, each mixed request has
**43 fewer dispatches: 41 in admission and two in seal**. Admission transactions
change from nine to four; terminal transactions remain three. The final full
[terminal fingerprint ledger](./terminal-dispatch-deltas.csv) has **four displaced
and two added dispatches**, with zero wrapper difference, producing the net
reduction of two. This is a phase/fingerprint observation with no assigned source
cause. Worker phase SQL counts and publication phase SQL counts remain identical
to the retained baseline. No ten- or twenty-three-frontier search reduction is
credited by this benchmark.

[SQL fingerprints](./sql-fingerprints.csv), [families](./sql-families.csv),
[phases](./phases.csv), and [transactions](./transactions.csv) preserve the
baseline and new full trace. Family counts overlap when a query mentions multiple
tables, and cannot be added as an independent decomposition. Nested phase,
transaction, and driver-await intervals overlap. Driver dispatches do not count
statements or row work inside PostgreSQL functions and triggers.

The [original-demand ledger](./settlement-ledger.json) retains captured observations
verbatim, including byte partitions, definitions, chunks, and unavailable fields.
[Publication query observations](./publication-query-ledger.csv) retain actual
dispatch and parameter observations. Untraced query observation is unavailable;
an empty list does not prove zero queries. Committed net effects cannot reconstruct
original owner inputs.

These results establish the bounded local complete-profile structural gates.
They do not establish hosted Cloudflare latency or activation, throughput,
arbitrary framework support, public APIs, semantic equivalence to the incomplete
baseline, or final latency acceptance. No new CPU diagnostic was run. Host slice
18 remains conditional and unapproved. [Slice 19](../../../../../roadmaps/mixed-mutation-core/19-aggregate-entry-preflight.md)
owns the private contract and remaining gates.
