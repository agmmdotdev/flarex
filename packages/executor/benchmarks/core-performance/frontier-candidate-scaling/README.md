# Shared finite frontier candidate: client trace and metadata scaling

This ledger distinguishes the actual Product method from full catalog
construction, outer entry, seal and publication. The reports identify the dirty
candidate `8c394df77-plus-shared-frontier-candidate`; they are bounded diagnostic
evidence, not a final validated checkpoint or latency acceptance. Raw numerical
reports remain unchanged.
All numerical reports here predate the latest `sourceAdmission` full-callback
issuer-retry correction and do not measure or validate that correction.

The [fixed-demand trace](./shared-frontier-native-trace-01-trace.json) and each
scaling report use two serial alternating native/finite pairs per hit/miss branch,
zero warmups and a fresh authenticated attempt/Worker per finite call. Trace
timings include instrumentation and do not extend the thirty-pair
[quiet distribution](../frontier-candidate-native/README.md). Provisioning,
module construction, initial seeds and each disjoint attempt's preparation are
separately charged outside operation/request timing.

The fixture varies **1/100 unrelated definitions** on each of `tables`,
`indexes`, `relations` and `otherSourceDefinitions`, while retaining the same
ID-only Product demand, native columns/keys and complete DTO/error assertions.
Counts denote added fixture definitions, not total metadata. Named added
indexes use the existing Product title column; other-source scaling retains one
fixed Product reference while varying empty definitions from that source.

## Fixed method observations

The method filter is the `native Product operation` phase. Metadata classification
includes installation/placement/clock, session/lease, journal/claim/running tail,
binding/Application heads, selected index maintenance and the metadata epoch
tail. Business classification includes actual index-entry and row revisions.
BEGIN/COMMIT are counted in all method results but are outside those two
classifications. Classification is the runner's explicit SQL-template filter,
not an independent server-side inventory.

| Fixed trace branch | Client SQL submissions/statements | Metadata rows / decoded JSON bytes | Business rows / decoded JSON bytes | SQL await sum across each method sample | Incremental source retention during method |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hit | 12 / 12 | 8 / 6,494–6,496 | 2 / 3,903–3,913 | 8.107–10.612 ms | 0 bytes |
| Miss | 11 / 11 | 8 / 6,527 | 0 / 2 | 6.222–9.252 ms | 0 bytes |

The actual method SQL retains positive row observation for hits and one
accepting transaction per call. Full fixed request traces still submit **289**
client statements for hits and **147** for misses. Their observed SQL-await
interval unions are **125.063–160.967 ms** and **53.251–69.932 ms** respectively.
Entry and final settlement remain charged and are not part of the method
submission count or method decoded-result summaries.

## Scaling matrix

The complete four-axis 1/100 matrix is **blocked**. Only the
[tables=1 report](./shared-frontier-tables-1-trace.json) is available in addition
to the fixed trace; no growth gate is evaluated from that single endpoint.
Tables=1 adds one table to a full catalog of four sources, seventeen tables,
forty-six indexes and fifteen relations.

| Axis | Added count 1 | Added count 100 |
| --- | --- | --- |
| Tables | Measured trace | Setup failed before samples |
| Indexes | Not run | Not run |
| Relations | Not run | Not run |
| Other-source definitions | Not run | Not run |

The root stopped the serial matrix after tables=100 failed during setup with
`IndexBuildReconciliationCatalogV1Error`, reason `definitionLimitExceeded`,
detail `the required physical definition set exceeds 256`. The
[failure log](../../../../../work/validation/finite-observation-scaling-tables-100.log)
locates the failure at `packages/persistence-postgres/src/indexBuildReconciliation.ts:601`
for deployment `deployment_application_native_mutation`, scope
`scope_34000000-0000-4000-8000-000000000001`, schema `live-logical-currency`.
The log records one failed test and a 28.47-second command duration; that duration
is failed setup, not latency evidence. No tables=100 raw numerical report or
accepted request/method samples were produced. Remaining axes are unmeasured.

The investigation establishes an actual **core complete-catalog capacity policy
blocker**. A minimal relational table requires a primary key; the compiler
derives both an ordered primary-key definition and a creation-time index.
The fixed complete ordered-definition catalog contains **79** definitions;
tables=1 produces **81**, while tables=100 produces **279**, exceeding the
global complete-set limit of **256**. Other-source definitions=100 would also
produce **279**; this is a derived capacity conclusion, not a measured run of
that endpoint. A finite first-demand operation cannot proceed when complete
catalog setup is rejected, even if its own selected read proofs are bounded.

Substituting a different fixture, stripping required keys, or raising/bypassing
the limit locally is not a valid measurement repair. The proposed
[finite execution contract preflight](../../../../../roadmaps/mixed-mutation-core/23-finite-execution-contract-preflight.md)
owns a possible core correction; **it is not approved**. The global bound has
not been raised or bypassed, and this ledger claims no correction or future
validation result.

| Available tables=1 branch | Client method submissions | Metadata rows / decoded JSON bytes | Business rows / decoded JSON bytes | Method SQL await sum | Incremental source retention during method |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hit | 12 | 8 / 6,522 | 2 / 3,780–3,783 | 6.903–11.061 ms | 0 bytes |
| Miss | 11 | 8 / 6,507 | 0 / 2 | 5.520–9.587 ms | 0 bytes |

Full source preparation retains **1,306,962 bytes** at tables=1, compared with
**1,262,240 bytes** in the fixed trace's catalog. This catalog charge is separate
from the actual method's retention delta. Read the four snapshots as follows:
`beforeRequestBytes` precedes admission;
`beforeOperationBytes` follows entry and precedes native demand;
`afterOperationBytes` follows native demand;
`afterRequestBytes` follows settlement or failure teardown. The incremental
method retention is exactly `afterOperationBytes - beforeOperationBytes`;
it does not claim total source preparation is constant or free. For tables=1
hit sample 0, entry grows the charged lease from 1,306,962 to 1,313,209 bytes,
while the method itself adds zero bytes. Setup and broader entry/final behavior
must stay visible if the blocked matrix resumes.

Decoded-result bytes are the runner's UTF-8 JSON encoding of returned decoded
objects: BigInt becomes decimal strings; Date and Buffer retain their JSON
forms. Empty result arrays still encode as two bytes. This is neither driver
wire traffic, heap allocation, isolated decode CPU nor retained source bytes.
SQL submissions and their awaited intervals are not network round trips or
server execution time. Ordinary client traces do not observe statements hidden
inside protected server functions. No server-function SQL or isolated CPU
reduction is inferred.

Each report fingerprints 27 selected source files and verifies that selected
inventory before/after its run. It is not an exhaustive dirty-runtime or
executing-build fingerprint. Reports must be compared using those hashes and
their fixture differences; later source corrections are not silently covered.
Database startup/search-path failures contribute no accepted samples. Existing
source, ordinary-role, protection, result/error and transaction assertions
remain required. The failed setup and missing matrix endpoints, final correctness
validation,
review, full integration and final source provenance remain open; this ledger
does not claim completion or hosted activation.
