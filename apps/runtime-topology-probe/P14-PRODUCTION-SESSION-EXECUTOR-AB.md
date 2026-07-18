# P14 Production SessionDO Executor A/B

Status: production collection passed on 2026-07-18. The evidence is complete
and publishable, application state is purged, and the SessionDO candidate did
not meet the predeclared latency threshold.

This is a sanitized synthetic receipt. It contains no account identifier,
account display name, workers.dev subdomain, OAuth token, bearer secret, claim
token, request payload, tenant identifier, or production data.

## Campaign Receipt

The isolated sync, mock, and gateway Workers deployed in dependency order. A
fresh in-memory bearer capability was installed before collection and removed
from the process environment afterward.

The first smoke stopped at retryable `campaign-registration` before any sample
ran. A read-only diagnostic proved that the immutable campaign existed,
registered the remaining RunDO cells idempotently, and was still `running` with
24 of 24 registrations and zero reconciliations. Collection then resumed that
same campaign; it did not create a second campaign or expand the budget.

The final receipt is:

| Evidence property | Result |
| --- | ---: |
| Planned / observed samples | 28 / 28 |
| Eligible measurements | 24 |
| Excluded warmups | 4 |
| Failed scenarios | 0 |
| Missing external durations | 0 |
| Abandoned / not-started samples | 0 / 0 |
| Duplicate-wake exclusions | 0 |
| Edge colo | `MNL` for all samples |
| Publishable | yes |
| Application purge | `purged` |

The ignored local raw artifact, summary, and checkpoint strictly decode and
remain unstaged. Their integrity receipt is:

| Artifact | SHA-256 |
| --- | --- |
| Canonical manifest | `bd22eb830f0f15d9aa7b090cfbf253e1b88f9718541a3e57d7e99447002b5687` |
| Canonical raw evidence | `5b404588a273c64edfb1de0a084558b32ffb15c10736b84d9ee21538944f7ac7` |
| Durable evidence records | `1247d3ef06506b44d3087087fcbc23d6bef3a4b78f56e575f325560ef9fa2ef2` |

## Matched Latency Result

All values are caller-local monotonic milliseconds. Medians and p95s use the
checked-in nearest-rank policy over 12 eligible samples per arm.

| Measure | External Worker control | SessionDO candidate | Candidate change |
| --- | ---: | ---: | ---: |
| Internal `gateway_session_rtt` median | 1,963 | 2,521 | +558 ms / 28.4% slower |
| Internal `gateway_session_rtt` p95 | 4,983 | 6,040 | +1,057 ms / 21.2% slower |
| External request median | 2,714.452 | 2,957.655 | +243.203 ms / 9.0% slower |
| External request p95 | 5,148.063 | 6,661.743 | +1,513.680 ms / 29.4% slower |

Across the 12 replicate-matched pairs, the candidate's median internal delta
was **+612 ms** and its median relative improvement was **-33.9%**. The paired
external median delta was **+586.306 ms**, with **-22.9%** median relative
improvement.

The predeclared success rule required at least 20% paired internal median
improvement and no candidate p95 regression. The candidate failed both parts.

## Hop Attribution

The reverse facet-to-SessionDO read was the clearest added cost:

| Span | External control median / p95 | SessionDO candidate median / p95 |
| --- | ---: | ---: |
| Executor read | `facet_mock_read_rtt`: 56 / 78 | `facet_session_read_rtt`: 544 / 840 |
| Whole facet | `session_facet_rtt`: 92 / 123 | `session_facet_rtt`: 584 / 851 |
| Trusted finish and sync wake | 785 / 2,384 | 797 / 2,864 |
| Facet journal I/O | 30 / 39 | 4 / 35 |
| Sync cursor I/O | 238 / 679 | 238 / 664 |

The candidate finish median was close to the control, while the narrow reverse
read made the facet round trip roughly 6.3 times larger at the median. Parent
and child spans overlap and must not be added. Every eligible sample reported
both Worker Loader and facet startup callbacks, so this run does not isolate a
warm-cache cohort.

## Correctness And Capability Receipt

- Every attempt used a fresh SessionDO, facet identity, opaque capability, and
  attempt-scoped Worker Loader identity.
- All 28 samples returned exact successful trace trees and one applied sync
  wake; no duplicate wake was accepted.
- The candidate Dynamic Worker received the self-bound read entrypoint and its
  exact attempt envelope, but no SessionDO or SyncDO namespace, supervisor SQL,
  Hyperdrive, credential, or outbound network.
- The SessionDO performed the synthetic finish and sync wake. Neither the
  facet nor SessionDO became committed-data authority.
- Purge reused the exact WorkerCode for each existing loader identity. Planned
  but never-created attempts are separately represented as absent, although
  none occurred in this completed production campaign.

## Dynamic Worker Usage And Cost

Cloudflare's exact `workersInvocationsByOwnerAndScriptGroups` dataset for the
isolated UTC window reported:

| Metric | Observed |
| --- | ---: |
| Dynamic Worker requests | 65 |
| Distinct Dynamic Workers | 28 |
| CPU time | 101,327 microseconds |

The 28 identities exactly match the frozen attempt-scoped plan. The
application issued 28 measured facet calls and planned up to 28 cleanup-only
facet calls, but the account-level meter reported 65 requests. The extra nine
cannot be attributed to a specific application operation from this aggregate,
so the receipt does not invent a per-path billing rule.

Using Cloudflare's published overage rates with no assumed included headroom,
the bounded Dynamic Worker subtotal is approximately **USD 0.056022**:
USD 0.056 for 28 identities, USD 0.0000195 for 65 requests, and USD 0.00000203
for 101.327 CPU milliseconds. This is a rate calculation, not an invoice; it
excludes ordinary Worker and Durable Object meters but remains far below the
approved USD 2 ceiling.

Cloudflare documents the identity, request, CPU, and GraphQL counting model in
its [Dynamic Workers pricing documentation](https://developers.cloudflare.com/dynamic-workers/pricing/).

## Scope Limit

This production run contains no Postgres snapshot, OCC, commit compiler,
authoritative outcome, uncertain-outcome recovery, or real subscription
delivery. It measures only the synthetic runtime communication topology. With
12 pairs in one colo, its percentiles are descriptive and do not establish a
service-level objective.
