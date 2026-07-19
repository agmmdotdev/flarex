# P18 Production Facet-Resident Executor A/B

Status: production collection passed on 2026-07-19. Evidence is complete and
publishable, application state is purged, and the candidate passed the local
facet threshold but did not pass the end-to-end improvement threshold.

This is a sanitized synthetic receipt. It contains no account identifier,
account display name, workers.dev subdomain, OAuth token, bearer secret, claim
token, request payload, tenant identifier, or production data.

## Campaign Receipt

Sync, mock, and gateway Workers deployed in dependency order. The first runner
attempt stopped at campaign registration before any sample. Exact status then
proved one immutable campaign with all 24 RunDO registrations, zero
reconciliations, and zero sample evidence. The bearer upload was changed from
PowerShell text input to Wrangler's JSON bulk-secret path, authorization was
verified, and collection resumed the same campaign. It did not create another
campaign or expand the frozen budget.

| Evidence property | Result |
| --- | ---: |
| Planned / observed samples | 28 / 28 |
| Eligible measurements | 24 |
| Excluded warmups | 4 |
| Failed scenarios | 0 |
| Missing external durations | 0 |
| Abandoned / not-started samples | 0 / 0 |
| Duplicate-wake exclusions | 0 |
| Edge colo | `SIN` for all samples |
| Publishable | yes |
| Application purge | `purged` |

The ignored artifacts strictly decoded and were reread before purge:

| Artifact | SHA-256 |
| --- | --- |
| Canonical manifest | `fd39ab691535403387121a36f046ac8c5ad8597976cf23fc19dbcc58ba95f82b` |
| Canonical raw evidence | `3fb5e427cad73ba6018b83cdb363407a5a44ac4bb077b89d81cc1fd48c511b29` |
| Durable evidence records | `a11a0e52c104ee9965ec0ea5d5c734e32b0597be774c5a6e7b805a16ccdc7a7c` |

## Predeclared Threshold Result

All values are caller-local monotonic milliseconds. Medians and p95s use the
checked-in nearest-rank policy over 12 eligible samples per arm.

| Measure | Bound-read control | Facet candidate | Candidate change |
| --- | ---: | ---: | ---: |
| Whole facet median | 85 | 15 | 70 ms / 82.4% faster |
| Whole facet p95 | 267 | 19 | 248 ms / 92.9% faster |
| Internal `gateway_session_rtt` median | 1,759 | 1,717 | 42 ms / 2.4% faster |
| Internal `gateway_session_rtt` p95 | 1,877 | 2,040 | 163 ms / 8.7% slower |
| External request median | 2,845.547 | 2,619.087 | 226.460 ms / 8.0% faster |
| External request p95 | 7,667.044 | 9,017.997 | 1,350.953 ms / 17.6% slower |

Across 12 replicate-matched pairs, the candidate's whole-facet median delta
was **-74 ms** and its paired relative improvement was **83.95%**. This passes
the predeclared 20% locality threshold.

The paired internal median delta was **-84 ms**, but paired relative
improvement was only **2.39%**, below the required 10%. Candidate aggregate
internal p95 regressed **8.68%**, inside the allowed 10% ceiling. The candidate
therefore fails the combined end-to-end promotion rule even though locality
and p95 containment pass separately.

The paired external median delta was **-354.671 ms**, with **10.46%** paired
relative improvement. External p95 was worse and external latency was not the
promotion criterion.

## Hop Attribution

| Span | Bound-read median / p95 | Facet candidate median / p95 |
| --- | ---: | ---: |
| Snapshot acquisition | in-facet `71 / 85` | pre-facet `76 / 101` |
| Whole facet | `85 / 267` | `15 / 19` |
| Persisted execution-state I/O | `4 / 180` | `3 / 5` |
| Trusted finish and sync wake | `819 / 885` | `787 / 849` |

The candidate removed the approximately 71 ms bound-read wait from inside the
facet, and the facet round trip fell accordingly. The read still exists before
facet execution, so the complete SessionDO path improved only slightly. The
roughly 800 ms trusted finish/Sync path and other SessionDO work dominate this
mock topology. Parent and child spans overlap and must not be added.

## Correctness And Authority Receipt

- Both arms used the same durable attempt admission, finishing, completion,
  replay, conflict, busy, and cleanup protocol.
- Every facet persisted, synchronized, and read back its exact logical read
  set, journal, result, and sealed intent.
- The candidate received no read capability, SessionDO or SyncDO namespace,
  supervisor SQL, network, credential, Hyperdrive, or Postgres authority.
- SessionDO independently recomputed and correlated the returned snapshot,
  journal seal, result, and intent digest.
- All 28 samples produced successful exact trace trees and one applied wake.

Postgres remains the only possible authoritative committed-data store. This
run contains no Postgres snapshot, OCC, commit compiler, authoritative outcome,
uncertain-outcome recovery, or real subscription delivery.

## Dynamic Worker Usage And Cost

Cloudflare's account GraphQL dataset for 2026-07-19 reported:

| Metric | Observed |
| --- | ---: |
| Dynamic Worker requests | 55 |
| Distinct Dynamic Workers | 28 |
| CPU time | 132,782 microseconds |

The 28 identities exactly match the frozen attempt-scoped matrix. At current
published overage rates and with no assumed included headroom, the conservative
subtotal is approximately **USD 0.056019**: USD 0.056 for identities,
USD 0.0000165 for requests, and USD 0.00000266 for CPU. Ordinary Worker and
Durable Object meters are excluded. The subtotal remains below the fresh
USD 0.25 ceiling.

Cloudflare's counting and rate model is documented in the
[Dynamic Workers pricing documentation](https://developers.cloudflare.com/dynamic-workers/pricing/).

With 12 pairs in one colo, all latency distributions are descriptive and do
not establish a service-level objective.
