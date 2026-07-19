# P24 Warm Facet Finalizer Preflight

Status: approved on 2026-07-19 and implemented locally. Production execution
remains gated on final dry-runs and both mandatory reviews.

## Question Under Test

The closed P20-P23 experiment measured a fresh SessionDO and fresh finalizer
facet for every request. This follow-up asks how much of that path remains when
one SessionDO, one Dynamic Worker code identity, and one facet Durable Object
are reused across real sequential request boundaries.

Each independent series executes:

```text
request 1: gateway -> activated SessionDO -> facet startup -> Worker Loader
           callback -> facet finalization -> MockFinish -> SyncDO

requests 2-11: gateway -> same SessionDO -> same loaded facet
               -> facet finalization -> MockFinish -> SyncDO
```

The first request is the cold reference. The following ten requests are the
warm-reuse cohort. All eleven are eligible evidence; none is relabeled as a
runner warmup.

## Authority And Isolation Boundary

- This remains a no-Postgres mock. It proves neither OCC nor an authoritative
  Flarex commit.
- `attemptId` remains unique per query or mutation and fences the outer
  SessionDO admission plus the terminal response.
- `facetId` is stable within one series and names the reused facet Durable
  Object. It is never substituted for the per-operation attempt fence.
- The facet stores terminal attempt rows keyed by `attemptId`. Replaying one
  attempt cannot return another attempt's result.
- Temporary read-set, journal, seal, result, and commit-intent tables are
  cleared and rewritten transactionally for every sequential operation, then
  synchronized and read back before finalization.
- The warm scenario alone retains the facet after a settled response. The
  existing cold finalizer path still deletes its attempt facet immediately.
- Campaign purge deduplicates the eleven samples to one facet deletion per
  series and retains the existing terminal cleanup tombstones.

This is an experiment-only exception to the earlier one-facet-per-attempt
isolation rule. It is intentionally not an active Flarex architecture roadmap.

## Challenged Alternative

Running twenty logical operations inside one external request would measure a
single already-running isolate, but it would not test SessionDO and facet reuse
across real request boundaries. The sequential eleven-request series is the
smallest design that observes the platform callbacks directly and preserves
one ordered synthetic commit stream.

## Frozen Production Matrix

- campaign `p24_warm_facet_finalizer_v1`;
- eight independent series, `p24_01_warm` through `p24_08_warm`;
- eleven sequential requests per series, 88 eligible requests total;
- collector and execution concurrency one;
- stable `invoke-finalizer-warm-v1` code, one reused SessionDO and facet per
  series, 64 payload bytes, and two logical journal entries per request;
- unique attempt IDs and commit sequences from one through eleven;
- eight expected Dynamic Worker code/facet identities;
- exact SessionDO activation, facet-startup callback, Worker Loader callback,
  intent, finalization, sync-cursor, replay, conflict, and purge evidence.

Mechanical success requires every series to observe all three startup signals
on its first request, observe no new activation/startup callbacks on requests
two through eleven, apply every unique synthetic commit exactly once, preserve
attempt-specific receipts, and delete exactly one shared facet during purge.

The descriptive latency question compares request one with requests two
through eleven in each series. Warm reuse is called material only if the warm
internal median is at least 20 percent faster than the first-request cohort.
This small probe is not a service objective or statistical significance claim.

## Spend And Completion Boundary

The user approved at most USD 0.05 fresh incremental Cloudflare spend for this
P24-P27 experiment, within the earlier USD 2 overall authorization. Deployment
must verify the `agmmdotdev` account, paid eligibility, resource absence,
frozen campaign digest, and secret handling. P26 must persist and reread
secret-free raw and summary evidence before cleanup. P27 must purge application
state, remove every temporary Worker and Durable Object namespace, prove
absence, record the bounded conclusion, and commit only
`apps/runtime-topology-probe/**`.
