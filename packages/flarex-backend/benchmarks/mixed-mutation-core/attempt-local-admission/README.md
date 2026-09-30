# Attempt-local admission performance

The [quiet traced smoke](./traced-smoke/manifest.json) retains 16/16
successful samples and the [full untraced series](./untraced/manifest.json)
retains 104/104. Each dataset includes the exact generated report bytes, a
gzip of the exact raw JSON bytes, every sample in CSV, explicit zero
exclusions, and byte and SHA-256 manifests. Both runs have the same revision,
working fingerprint, selected business profiles and 44 measured source hashes.
All 44 hashes matched the workspace files when packaged. There are no failed
samples or setup failures. The [fresh-admission baseline](../fresh-admission-evidence/README.md)
is retained unchanged.

The runs use the same four business graphs, local ordinary-role PostgreSQL
host, restricted runtime policy and fresh single-use Worker lifecycle for
mixed requests as the baseline. Current traced and untraced host settings
match apart from their isolated runtime-role names. The baseline has the same
CPU, OS, Node, driver, PostgreSQL settings, transport and pool limit; reported
total memory is 16,422,113,280 bytes before and 16,421,470,208 bytes now.
Their different source revisions make this an observed comparison, not an
isolated causal estimate. The trace has two warm requests per workload and
supports SQL structure, not a p95. The full untraced run has 20 warm and three
cold requests per workload; it supports latency distributions but has no SQL
or phase observer.

## End-to-end cost

Outer invocation wall times are milliseconds. Warm p95 is the descriptive
nearest rank over 20 requests; cold p50 uses three. The SQL and transaction
counts are identical across both warm traced requests per workload.

| Workload | Before warm p50 / p95 | Current warm p50 / p95 | Current cold p50 | SQL before → current | Transactions before → current |
| --- | ---: | ---: | ---: | ---: | ---: |
| Product | 1,551.6 / 1,868.6 | 857.9 / 884.6 | 817.4 | 2,256 → 1,063 | 82 → 41 |
| Product + Payload | 2,013.6 / 2,142.7 | 1,000.2 / 1,053.2 | 1,055.7 | 3,018 → 1,378 | 105 → 52 |
| Mixed finite workflow | 4,471.4 / 4,743.6 | 1,782.8 / 1,808.8 | 1,797.9 | 5,872 → 2,173 | 199 → 78 |
| Standalone finite workflow | 308.8 / 322.3 | 286.5 / 339.8 | 280.2 | 452 → 361 | 6 → 6 |

The observed SQL reductions are **1,193 / 1,640 / 3,699 / 91** dispatches
per warm request. Transaction intervals fall by **41 / 53 / 121 / 0**.
Product update falls from **49 to 16** checked intervals per request; the
mixed workflow run falls from **94 to 22**. Tentative finite-root handle,
pending-write, cached-result and close work no longer opens an empty
admission transaction. Actual database accesses, aggregate seal and later
publication retain full exact-running/session, selected source/readiness,
physical and protected-epoch checks in short owned transactions. Seal
reauthenticates each admitted child's exact selected sources using its
process-local issuer capability. Equivalent source evidence is shared only
within the checked seal or publication transaction. Selected index/unique
coverage updates use batches of at most 32 rows. Selected table-frontier reads
are shared and combined through their existing owner, with batches of at most
64 tables.

Full warm p50 decreases about **44.7% / 50.3% / 60.1% / 7.2%** from the
fresh-admission series. The proposed mixed warm p50 goals of 100 / 200 /
500 ms and p95 goals of 200 / 400 / 1,000 ms remain **unmet**. Standalone
warm p50 is below its 400 ms ceiling and below the prior 308.8 ms median,
within the strict less-than-10% regression gate. Its p95 rises **5.4%** to
339.8 ms; its **698.6 ms** maximum is retained in the 20 warm samples. No
sample is excluded or replaced, and the record does not establish the cause
of that tail.

## Retained effects and observation limits

Retained row/index/commit/event growth per successful warm request remains
`1/1/1/1` for Product, `2/3/1/1` for Product + Payload, `7/36/1/7` for
mixed workflow, and `5/33/1/6` for standalone workflow. Each ends with zero
live journal rows. Mixed graphs end with zero retained live journal bytes.
For standalone workflow, live journal bytes and sealed attempt bytes are unavailable.
Median sealed journal bytes are **12,095 / 19,305 / 34,020** in the traced
smoke and **12,180 / 19,401 / 34,109** in the full untraced series. The
observation modes have separate sample plans; this difference already exists
in earlier datasets and is not a measured journal-format change.
Every traced sample has zero unknown statements, query errors, unobserved
or lost dispatches and incomplete spans. These quantities are unavailable
in the untraced run, not zero.

Fresh database-boundary validation remains a measured cost owner. In each
warm traced Product update, **492** SQL dispatches remain across 16 checked
intervals; in each mixed workflow run, **650** remain across 22. The session,
lease, execution claim, binding head, Application head/activation/schema,
physical lifecycle, unique/search readiness, `pg_index` probe and full final
epoch attestation templates each occur once per interval in these phases.
Index-build templates occur twice per interval. SQL fingerprints and phase
labels establish these counts; they do not measure a function stack or CPU
cost. The trace retains database work alongside lower endpoint latency; it
does not establish PostgreSQL server execution, lock wait, WAL,
contention/retry latency, hosted Cloudflare latency, native ORM parity or
capacity.

The [11 preflight](../../../../../roadmaps/mixed-mutation-core/11-attempt-admission-preflight.md)
owns the delivered private contract. Broader protected framework/physical
metadata, compact session guards, cheaper epoch attestation, named-environment
activation and public authoring APIs retain their separate gates.
