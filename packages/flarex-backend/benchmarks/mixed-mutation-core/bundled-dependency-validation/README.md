# Bundled dependency-validation performance

The [quiet traced smoke](./traced-smoke/manifest.json) retains 16 successful
samples and the [full untraced series](./untraced/manifest.json) retains 104.
Each includes the exact generated raw JSON/report bytes, every sample in CSV,
explicit zero exclusions and byte/SHA-256 manifests. Both share the measured
working fingerprint, business profiles and 46 source hashes. All 46 hashes and
the fingerprint matched the workspace in the packaging pass before this README
and final roadmap prose changed; that prose is outside the measured checkpoint.
There are no failed samples or setup failures. The separate-closure
[historical checkpoint](../dependency-validation/README.md), its verified
receipt and all 120 samples remain unchanged.

The same four graphs run on local ordinary-role PostgreSQL with the same
restricted runtime policy and fresh single-use Worker lifecycle for mixed
requests. Host settings match the
[compact-access comparison](../compact-checked-access/README.md), apart from
isolated runtime-role names, including reported total memory of
16,421,470,208 bytes. This compares source checkpoints; it does not isolate the
cause of latency changes. Two warm traced requests per graph support SQL
structure. Twenty warm and three cold untraced requests per graph support the
latency distribution; SQL/phase observations are unavailable in that lane.

## End-to-end cost

Outer invocation wall times are milliseconds. Warm p95 uses descriptive nearest
rank over 20 requests; cold p50 uses three. SQL dispatch and transaction counts
match across both warm traced requests per graph.

| Workload | Compact-access warm p50 / p95 | Bundled warm p50 / p95 | Cold p50 | SQL compact → bundled | Transactions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Product | 867.8 / 993.0 | 940.7 / 1,166.4 | 889.3 | 990 → 988 | 41 → 41 |
| Product + Payload | 1,067.8 / 1,212.1 | 1,087.1 / 1,176.3 | 1,134.3 | 1,274 → 1,252 | 52 → 52 |
| Mixed finite workflow | 1,954.1 / 2,677.3 | 1,787.7 / 1,960.0 | 1,780.7 | 1,997 → 1,979 | 78 → 78 |
| Standalone finite workflow | 303.8 / 388.9 | 319.8 / 403.4 | 309.8 | 354 → 354 | 6 → 6 |

Warm medians change by **+8.4% / +1.8% / −8.5% / +5.3%**; warm p95 changes
by **+17.5% / −3.0% / −26.8% / +3.7%**. SQL dispatches fall by only
**2 / 22 / 18 / 0** against compact access; transaction counts do not change.
Latency does not improve across all workloads: Product, Product + Payload and
standalone medians rise; mixed workflow falls. All warm maxima are retained:
**3,355.9 / 1,177.1 / 2,063.6 / 442.2 ms**. No sample is excluded or replaced,
and no cause is assigned to the Product tail.

The mixed p50 goals of 100 / 200 / 500 ms and p95 goals of
200 / 400 / 1,000 ms remain **unmet**. Standalone passes its explicit median
gate: **319.8 ms < 400 ms**, and the **5.3%** median increase from compact
access is strictly below the 10% regression limit. Its p95 and maximum remain
part of the result; passing that median gate is not an improvement claim.

The historical separate-closure workflow has 2,501 SQL dispatches, compared
with 1,979 here. Its warm p50/p95 is 1,836.6/1,881.4 ms; this checkpoint's
median is lower and its p95 is higher. The union contract eliminates repeated
common checks for distinct issued source closures inside one read transaction.
This structural change does not establish the cause of the latency differences
between either comparison series.

## Delivered owners and retained proof

The [dependency-validation preflight](../../../../../roadmaps/mixed-mutation-core/13-dependency-validation-preflight.md)
owns the contract. The finite profile comes from the exact admitted attempt;
callers cannot override it. Internal reads select every definition for their
source and required transitive reference/target/delete sources. Multi-source
workflow reads derive one complete union from the actual issued bundle states.
The first common check derives readiness lazily; reuse requires the exact
requested source set and existing application, control, authority, unique,
scope, clock, schema and manifest identities inside that same accepting
transaction. Every source still checks its own method/root authority and head
pin before data. Common union readiness precedes ordered source pins. Full
entry, aggregate seal, publication, standalone and durable-operation checks
remain distinct and mandatory.

Required readiness misses refuse before data. An unrelated post-entry miss may
permit tentative finite reads while full seal refuses durability. Full canonical
bodies, heads, complete lane membership, live required physical checks and exact
authority/fencing/time/epoch guards remain. Complete unique closure and spec
authentication retain the existing configured-control preparation lifetime;
fresh target build readiness is checked in the accepting transaction. Neither
the existing full path nor the selected path rereads that control closure there.
No wider metadata protection or control/target coordination contract is added.

Historical indexed hydration reuses the app-row query/decoder owner and consumes
already decoded distinct identities in requested order. The bounded internal
batch permits at most 256 identities; the existing live-set wrapper keeps its
128-identity limit. A byte projection retains metadata and the full first body
crossing the initial remaining budget capped at 1 MiB, withholding later bodies.
Canonical decode, dependency observation and budget/state updates remain
sequential. A malformed crossing body fails before its budget charge; an earlier
budget failure prevents decoding a later malformed body. Reaching a withheld
body is an internal defect, never fabricated absence or a fallback read. This
does not promise an absolute bound on a malicious crossing body's stored bytes.
Missing rows, tombstones, historical snapshots and pending/local semantics remain
with their owners; seed hydration is unchanged.

## Retained effects and limits

Warm retained row/index/commit/event growth remains **1/1/1/1** for Product,
**2/3/1/1** for Product + Payload, **7/36/1/7** for mixed workflow and
**5/33/1/6** for standalone. Profiles are unchanged. Every request ends with
zero live journal rows; mixed requests also end with zero live journal bytes.
Standalone live journal bytes are unavailable.

Every traced sample retains zero unknown statements, query errors, unobserved or
lost dispatches and incomplete spans. Those observations are unavailable in the
untraced lane, not zero. Driver await includes transport, server work and waits;
transaction intervals include application work and waits. Neither supplies pure
server/lock time or decoder/hash CPU attribution. Further cost work needs a
focused owner contract and decisive measurement; operation closure, broader
metadata protection and cheaper attestation remain separately gated. These
local measurements establish no native ORM parity, hosted latency, throughput
or production capacity.
