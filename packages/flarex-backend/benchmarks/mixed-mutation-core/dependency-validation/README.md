# Separate source dependency validation: historical measurements

This package preserves the historical checkpoint that checked each source's
complete readiness closure separately. It is superseded by the
[bundled dependency-validation implementation](../bundled-dependency-validation/README.md).
Its 120 samples remain unchanged, including the workflow SQL regression.

The [traced smoke](./traced-smoke/manifest.json) retains 16 successful samples;
the [full untraced series](./untraced/manifest.json) retains 104. Both retain the
exact generated raw JSON and report bytes, every CSV sample, zero exclusions
and byte/SHA-256 manifests. There are no failed samples or setup failures.
Both share the measured source checkpoint, business profiles and 46 source
hashes. The [verified checkpoint receipt](./verified-measurement-checkpoint.json)
was captured while those source bytes and the working fingerprint matched the
workspace. Historical packaging verifies that prior receipt against the
preserved raw headers and dataset manifests; it does not claim that the old
hashes match the current bundled implementation. This README is outside that
measured checkpoint. The [package manifest](./manifest.json) authenticates the
README, exact receipt copy and dataset manifests.

## Observed cost

Outer invocation wall times are milliseconds. Warm p95 is descriptive nearest
rank over 20 untraced requests; cold p50 uses three. The two warm traced requests
per graph have matching SQL dispatch and transaction counts and describe SQL
structure, not a latency distribution.

| Workload | Compact-access warm p50 / p95 | Separate-closure warm p50 / p95 | Cold p50 | SQL compact → separate | Transactions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Product | 867.8 / 993.0 | 754.2 / 775.3 | 782.6 | 990 → 988 | 41 → 41 |
| Product + Payload | 1,067.8 / 1,212.1 | 921.0 / 950.2 | 1,068.9 | 1,274 → 1,252 | 52 → 52 |
| Mixed finite workflow | 1,954.1 / 2,677.3 | 1,836.6 / 1,881.4 | 1,923.9 | 1,997 → 2,501 | 78 → 78 |
| Standalone finite workflow | 303.8 / 388.9 | 280.9 / 291.0 | 282.8 | 354 → 354 | 6 → 6 |

Observed warm medians are lower by 13.1% / 13.7% / 6.0% / 7.5% than the
[compact-access series](../compact-checked-access/README.md). This is a comparison
between source checkpoints, not an isolated causal estimate. All warm maxima
are retained: **781.5 / 959.0 / 1,910.9 / 292.5 ms**. No sample is removed or
replaced. The mixed p50 goals of 100 / 200 / 500 ms and p95 goals of
200 / 400 / 1,000 ms remain unmet.

The workflow's target invocation phase grows from 582 to 1,101 dispatches.
Separate exact closure keys repeat common binding, Application and mutable
readiness checks for the issued Product, Pricing and Link sources. Other
workflow SQL is unchanged; Payload phases save 15 dispatches, leaving the
whole-request increase of 504. Table/fingerprint diagnostics locate repeated
work but do not attribute CPU or explain the latency distribution. The final
bundle checks one complete issued-source union per accepting read transaction,
while retaining every source's individual authority and head-pin checks.

## Retained behavior and observation limits

The same four graphs use local ordinary-role PostgreSQL, the restricted runtime
policy and a fresh single-use Worker lifecycle for mixed requests. Host settings
match the compact-access series apart from isolated runtime-role names; reported
total memory remains 16,421,470,208 bytes. Profiles and warm retained
row/index/commit/event growth are unchanged: **1/1/1/1**, **2/3/1/1**,
**7/36/1/7**, **5/33/1/6**. Every request ends with zero live journal rows;
mixed requests also end with zero live journal bytes. Standalone live journal
bytes are unavailable.

Finite internal reads preserve full canonical binding/source authentication and
check fresh required readiness. Required misses refuse before data; unrelated
post-entry readiness misses may permit tentative reads while full seal still
refuses durability. Entry, seal, publication, standalone and durable-operation
readiness remain full. Complete unique closure authentication retains the
existing configured-control preparation lifetime, with fresh selected target
build checks in the accepting transaction.

Traced samples retain zero unknown statements, query errors, unobserved or lost
dispatches and incomplete spans. These observations are unavailable in the
untraced run. Driver await includes transport, server work and waits; it is not
pure server time or decoder/hash CPU. Neither series establishes native ORM
parity, hosted latency, throughput or production capacity.
