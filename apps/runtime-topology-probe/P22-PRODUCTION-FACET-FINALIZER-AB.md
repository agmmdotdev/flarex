# P22 Production Facet Finalizer A/B

Status: production collection passed on 2026-07-19. Evidence is complete and
publishable, application state is purged, and the candidate passed every
mechanical rule but failed the predeclared performance promotion rule.

This is a sanitized synthetic receipt. It contains no account identifier,
account display name, workers.dev subdomain, OAuth token, bearer secret, claim
token, request payload, tenant identifier, or production data.

## Campaign Receipt

Sync, mock, and gateway Workers deployed in dependency order. The first local
orchestration process stopped after those deployments and before secret
installation or campaign creation because its platform random-number API was
not available. No probe request had run. A fresh capability was then generated
in process with an available cryptographic API, installed through Wrangler's
bulk-secret path, and the frozen campaign ran once without expanding its
budget.

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

The ignored artifacts strictly decoded and were reread before purge:

| Artifact | SHA-256 |
| --- | --- |
| Canonical manifest | `c77fd834b156e84898d6de0d1033dadcdc121e19bacc321d437fbb781c8a4250` |
| Canonical raw evidence | `213a37702087ca318c92d70d05a8314ab8d804418d4c70784660bf9d1c3d1696` |
| Durable evidence records | `663bca1df27bb655af5307356610000857b78d069f05f913b8c3d0dfe399431c` |

## Predeclared Threshold Result

All values are caller-local monotonic milliseconds. Medians and p95s use the
checked-in nearest-rank policy over 12 eligible samples per arm.

| Measure | SessionDO-finalizer control | Facet-finalizer candidate | Candidate change |
| --- | ---: | ---: | ---: |
| Internal `gateway_session_rtt` median | 2,050 | 1,948 | 102 ms / 5.0% faster |
| Internal `gateway_session_rtt` p95 | 2,341 | 3,512 | 1,171 ms / 50.02% slower |
| External request median | 2,448.527 | 2,460.915 | 12.388 ms / 0.5% slower |
| External request p95 | 2,719.770 | 3,855.395 | 1,135.625 ms / 41.75% slower |

Across the 12 replicate-matched pairs, the candidate's internal median delta
was **-14 ms**, but the separately nearest-ranked paired relative improvement
was **-1.07%**. That fails the required 10% paired improvement. Candidate
aggregate internal p95 regressed **50.02%**, which also fails the allowed 10%
ceiling. The candidate therefore fails the performance promotion rule.

The paired external median delta was **-46.707 ms**, while paired relative
improvement was **-0.51%**. External latency was not the promotion criterion
and likewise shows no material improvement.

## Hop Attribution

| Span | SessionDO-finalizer median / p95 | Facet-finalizer median / p95 |
| --- | ---: | ---: |
| Trusted snapshot read | `73 / 96` | `72 / 101` |
| Facet round trip | `15 / 53` | `860 / 2,132` |
| Persisted journal I/O | `4 / 46` | `3 / 60` |
| Finalization owner | SessionDO `861 / 967` | facet `832 / 854` |
| Mock-to-Sync wake | `822 / 957` | `832 / 854` |

The larger candidate facet span is expected accounting: the facet now remains
resident while finalization and the SyncDO wake complete. It is not an
additional approximately 832 ms operation on top of finalization. The control
performs essentially the same work after its short facet call returns, while
the candidate nests that work inside the facet call. Parent and child spans
overlap and must not be added.

This placement removed SessionDO as the code location that calls MockFinish,
but it did not remove the synchronous MockFinish-to-Sync communication or the
need for SessionDO to await the admitted attempt's terminal response. The run
therefore gives no evidence that simply changing the finalizer's runtime
removes the dominant cross-runtime cost.

## Correctness And Authority Receipt

- All 28 samples returned exact successful trace trees and one applied SyncDO
  wake; no duplicate wake was accepted.
- Each of the 12 eligible candidate executions recorded one
  `facet_atomic_commit_rtt` span and no `session_mock_finish_rtt` span. Each
  eligible control recorded the inverse.
- The trusted facet shell verified the snapshot, journal seal, result, intent,
  attempt fence, and exact combined finish receipt before returning.
- User logic received no finish capability, Worker binding, SyncDO namespace,
  credential, Hyperdrive handle, Postgres handle, or outbound network.
- SessionDO retained admission, outer replay/conflict fencing, response
  correlation, lifecycle, and cleanup ownership.

Postgres remains the only possible authoritative committed-data store. This
run contains no Postgres transaction, OCC, commit compiler, application write,
authoritative terminal-outcome lookup, or real subscription delivery. The
production success path did not exercise the locally proved
apply-then-response-loss uncertainty injection.

## Dynamic Worker Usage And Cost

Cloudflare's account GraphQL dataset is date-granular for the distinct-worker
count. Subtracting the immediately preceding same-day P18 receipt from the
post-P22 total isolates this campaign's delta:

| Metric | P22 delta |
| --- | ---: |
| Dynamic Worker requests | 55 |
| Distinct Dynamic Workers | 28 |
| CPU time | 165,031 microseconds |

The 28 identities exactly match the frozen attempt-scoped matrix. At current
published overage rates and with no assumed included headroom, the conservative
Dynamic Worker subtotal is approximately **USD 0.056020**: USD 0.056 for
identities, USD 0.0000165 for requests, and USD 0.00000330 for CPU. Ordinary
Worker and Durable Object meters are excluded. The subtotal remains below the
fresh USD 0.25 ceiling.

Cloudflare's counting and rate model is documented in the
[Dynamic Workers pricing documentation](https://developers.cloudflare.com/dynamic-workers/pricing/).

With 12 pairs in one colo, all latency distributions are descriptive and do
not establish a service-level objective.
