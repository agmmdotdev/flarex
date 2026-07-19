# P26 Production Warm Facet Finalizer Evidence

Status: closed as a non-publishable partial campaign on 2026-07-19. The
campaign was reconciled, its secret-free evidence was persisted and reread,
and application purge reached `purged` before external teardown.

This is an isolated no-Postgres probe. It is not an accepted Flarex runtime or
an active roadmap.

## Frozen Campaign And Integrity

The approved campaign contained eight independent series. Each series planned
eleven sequential external requests through one SessionDO and one stable facet,
with a unique attempt fence per request. The first request was the cold
reference and requests two through eleven were the intended warm cohort.

The production runner stopped when every active series reached the same
uncertain-outcome class. The abort path then reconciled, sealed, persisted, and
purged the partial evidence:

| Integrity field | Receipt |
| --- | ---: |
| Planned requests | 88 |
| Observed requests | 47 |
| Successful scenario requests | 39 |
| Failed scenario requests | 8 |
| Not started | 41 |
| External durations missing | 0 |
| Publishable | no |
| Application purge | `purged` |

Seven runs completed ordinals zero through four and failed ordinal five. The
eighth completed ordinals zero through three and failed ordinal four when the
collector stopped. Every failure was strictly decoded as non-retryable
`outcome_uncertain` at `gateway_session_rtt`; startup callbacks and SyncDO wake
were unobserved for those failures. The receipt therefore does not claim that
the finalizer did or did not finish. That ambiguity is the intended fence, not
a successful commit result.

## Descriptive Successful Latency

The following medians use only the 39 successful observations: eight ordinal-
zero cold references and 31 later warm requests. They are descriptive because
the campaign is incomplete and non-publishable.

| Caller-local span | Cold median | Warm median | Warm reduction |
| --- | ---: | ---: | ---: |
| External request | 2,018.813 ms | 227.316 ms | 88.74% |
| Gateway to SessionDO | 1,850 ms | 64 ms | 96.54% |
| SessionDO to facet | 903 ms | 29 ms | 96.79% |
| Facet atomic-finalize path | 861.5 ms | 14 ms | 98.37% |
| Mock finish plus SyncDO wake | 861.5 ms | 14 ms | 98.37% |

The successful subset passes the predeclared descriptive 20 percent warm
median threshold by a wide margin. It does not pass the campaign integrity
gate and cannot be promoted as a production latency result.

Among all 47 observations, 12 reported SessionDO activation plus facet and
Worker Loader startup, two reported SessionDO/facet startup without a Worker
Loader callback, 25 reported no startup callback, and eight failures could not
observe startup. This proves that real warm facet reuse occurred for multiple
external requests; it also proves that startup can recur after the initial
request and must remain an explicit measurement dimension.

Cloudflare documents that `ctx.facets.get()` reuses a running facet without
calling its startup callback, while a new or hibernated facet calls the
callback again. Dynamic Worker `get(id, callback)` similarly permits reuse but
does not guarantee that a cached worker will never be evicted.

## Failure Interpretation

The evidence proves a repeated uncertain-response boundary after real reuse,
but the production protocol intentionally normalizes the inner facet failure.
It therefore does not prove one exact platform cause. Plausible contributors
include facet or Dynamic Worker reactivation, rollout convergence after the
secret-created Worker version, or lifetime behavior of the injected finish
binding. Treating any one of these as confirmed would overstate the receipt.

The next isolated diagnostic, if approved separately, should wait for version
and secret propagation before opening the campaign and persist a bounded
platform-owned inner failure code before the supervisor converts it to
`outcome_uncertain`. If any RPC target is passed as an RPC parameter and kept
after that call, the implementation must also follow Cloudflare's explicit
stub lifecycle/duplication rules. None of those follow-ups belongs in the
current Flarex roadmap.

## Dynamic Worker Usage And Cost

The account GraphQL daily aggregate increased from the immediately preceding
same-UTC-day P22 total by:

| Metric | P26 delta |
| --- | ---: |
| Dynamic Worker requests | 55 |
| Distinct Dynamic Workers | 8 |
| CPU time | 158,844 microseconds |

The eight identities exactly match the frozen stable series. At the published
overage rates, with no assumed included headroom, the conservative Dynamic
Worker subtotal is approximately **USD 0.016020**: USD 0.016 for identities,
USD 0.0000165 for requests, and USD 0.00000318 for CPU. Ordinary Worker and
Durable Object meters are excluded. The subtotal stayed below the approved
USD 0.05 incremental ceiling.

Cloudflare's identity, request, CPU, and GraphQL counting model is documented
in the [Dynamic Workers pricing documentation](https://developers.cloudflare.com/dynamic-workers/pricing/).

## Authority Boundary

No Postgres transaction, OCC validator, commit compiler, authoritative
terminal outcome, application write, or real subscription delivery ran here.
Facet SQLite remains non-authoritative. A real finalizer may execute trusted
logic in a facet, but the application writes, attempt/session fence, and
terminal outcome must still commit atomically in Postgres. Recovery resolves
an uncertain response from that Postgres outcome, not from facet memory or
facet SQLite alone.
