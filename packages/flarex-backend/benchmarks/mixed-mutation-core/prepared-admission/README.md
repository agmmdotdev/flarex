# Prepared target admission performance

This package retains the complete [16-sample traced smoke](./traced-smoke/manifest.json)
and [104-sample untraced series](./untraced/manifest.json): exact generated raw
JSON and report bytes, gzip round trips, every CSV sample, zero exclusions and
byte/SHA-256 manifests. All samples succeed with no setup failures. The
[verified checkpoint](./verified-measurement-checkpoint.json) records that all
51 source hashes and the exact benchmark working fingerprint matched the
workspace before this README and roadmap prose changed. Both lanes share those
hashes and the unchanged business profiles. The
[prior bundled checkpoint](../bundled-dependency-validation/README.md) and its
120 samples remain untouched.

## Measured cost

The four graphs use the same local ordinary-role PostgreSQL settings and fresh
single-use Worker lifecycle. Two warm traced requests per graph have identical
SQL and transaction counts. Latency uses 20 untraced warm requests and three
cold requests; warm p95 is descriptive nearest rank. Times below are milliseconds.

| Workload | Prior warm p50 / p95 | Prepared warm p50 / p95 | Cold p50 | Prior → prepared SQL | Transactions | Stage SQL ceiling |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Product | 940.7 / 1,166.4 | 783.7 / 1,011.6 | 837.4 | 988 → 862 | 41 | 871 |
| Product + Payload | 1,087.1 / 1,176.3 | 973.8 / 1,006.0 | 1,459.3 | 1,252 → 1,068 | 52 | 1,081 |
| Mixed finite workflow | 1,787.7 / 1,960.0 | 1,676.6 / 1,714.8 | 1,732.8 | 1,979 → 1,663 | 78 | 1,688 |
| Standalone finite workflow | 319.8 / 403.4 | 309.4 / 395.3 | 293.4 | 354 → 354 | 6 | 354 |

All original stage ceilings pass. Warm medians change by **−16.7% / −10.4% /
−6.2% / −3.3%**. These compare source checkpoints and do not isolate latency
causes. Every warm maximum is retained: **1,193.7 / 1,014.0 / 2,800.9 / 406.9 ms**.
No outlier is excluded or replaced. The mixed p50 goals of **100 / 200 / 500 ms**
and p95 goals of **200 / 400 / 1,000 ms** remain unmet. Standalone passes its
median gate: **309.4 < 400 ms**, with no median regression against 319.8 ms.

## Attributable SQL structure

[SQL families](./sql-families.csv), [full warm fingerprints](./sql-fingerprints.csv),
[phase spans](./phases.csv), [transaction intervals](./transactions.csv) and
[exact derived analysis](./analysis.json) preserve the comparison and template
selection rules. Counts in this table match both warm traced samples.

| Target statement family | Product prior → prepared | Product + Payload | Mixed workflow |
| --- | ---: | ---: | ---: |
| Shared canonical Application activation | 27 → 6 | 37 → 6 | 60 → 6 |
| Legacy revision-schema projection | 26 → 5 | 36 → 5 | 59 → 5 |
| Binding activation/candidate/complete-lane join | 23 → 2 | 33 → 3 | 56 → 6 |
| Full clock KEY SHARE | 50 → 6 | 70 → 6 | 116 → 6 |
| Revocation KEY SHARE | 23 → 1 | 33 → 1 | 56 → 1 |
| Full epoch capture | 2 → 5 | 2 → 6 | 2 → 9 |
| Mandatory full epoch tail | 22 → 22 | 32 → 32 | 55 → 55 |

Actual lazy first fills add **3 / 4 / 7** full captures: two Application
structures plus one binding snapshot per source-admission preparation context.
The benchmark's selections and admissions are request/series-owned, outside
retained-host allocation. Their canonical readers bound retained payloads.
Retained service hosts instead capture and charge their actual lease; atomic
first fill charges once, and the outer host lifetime gates use and disposal.
The original conservative ceilings stay unchanged. Net dispatch reductions are
**126 / 184 / 316**, exceeding the proposed 120 / 174 / 294.

The six kernel statements and transaction topology remain. Strong clock
statement counts stay **34 / 45 / 71** and physical catalog proofs stay
**23 / 28 / 50**. Full epoch tail mean driver awaits are **61.2 / 92.9 / 145.4 ms**;
capture awaits are **13.7 / 16.7 / 25.8 ms**. Traced mean request-admission spans
are **107.1 / 132.6 / 231.7 ms**, seal/OCC **89.1 / 104.9 / 112.7 ms**, and
publication **95.9 / 104.4 / 187.9 ms**. These spans overlap/nest; query and
transaction waits are non-additive. Trace wall times are not latency acceptance.

## Retained proof and limits

[Slice 15](../../../../../roadmaps/mixed-mutation-core/15-admission-protection-preflight.md)
extends full installation attestation to 23 immutable target tables under
existing privileged quiescence. Canonical first reads authenticate against the
original readiness epoch after decoding, before retention. Application uses its
issuer's exact head pins; a binding head miss performs the existing full proof
without replacing its one snapshot. Fresh heads, source/required readiness,
control closure, physical facts and the mandatory full tail remain. The clock
observation is exact-transaction evidence, revoked on exit or clock mutation.
Current relation Fold, standalone and durable callers retain actual full-proof
obligations. No new backend certificate or maintenance barrier is implemented.

Warm row/index/commit/event growth remains **1/1/1/1**, **2/3/1/1**,
**7/36/1/7**, **5/33/1/6**. All requests end with zero live journal rows;
mixed live journal bytes are zero, while standalone bytes are unavailable.
All traced samples have zero unknown statements, query errors, lost/unobserved
dispatches and incomplete spans. Those observations are unavailable in untraced
samples. Driver await includes transport, server execution and waits; it is not
pure server time. No full 23-table server-work or hash/decoder CPU attribution
was collected. Native ORM parity, hosted latency and production capacity are
not established.

A separate correctness matrix encountered one provisioning `55P03` during
`CREATE TABLE fx_system_framework_migration_attempt_start`, before the Product
runtime ran. Existing migration 0057 sets a transaction-local five-second lock
timeout. The exact blocker is unknown; overlapping fixture runs were observed.
The final quiet serial run passed 18 selected native cases across five files.
That incident is not a performance sample or an exclusion from these 120 samples.
