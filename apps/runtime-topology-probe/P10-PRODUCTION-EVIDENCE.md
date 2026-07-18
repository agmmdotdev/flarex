# P10 Production Evidence

Status: passed on 2026-07-18. The frozen campaign produced complete,
publishable evidence and completed its single application-level purge. P11
subsequently removed the isolated Cloudflare deployment.

This receipt is limited to synthetic runtime-topology evidence. It contains no
Cloudflare account identifier or display name, workers.dev subdomain, OAuth
token, bearer secret, claim token, request payload, Flarex tenant identifier,
or production data.

## Bounded Run Receipt

P10 resumed the exact `p07b_local_v1` campaign and ignored checkpoint created
by P09. It did not create another campaign, deployment, or namespace. The
immutable matrix remained:

- 12 cells covering eight scenarios;
- 32 total samples: eight excluded warmups and 24 eligible measurements;
- 12 exact Dynamic Worker code IDs;
- at most 64 synthetic payload bytes and two synthetic journal entries per
  applicable sample; and
- collector concurrency four, with each cell independently capped at one or
  two outstanding claims.

The first P10 collector invocation began immediately after installing a fresh
secret. It stopped before a new failed or outstanding claim was recorded. Three
non-Dynamic-Worker samples had completed, the Dynamic Worker analytics meter
was unchanged, and the remote campaign remained safely resumable. A read-only
diagnostic found no failed samples and no outstanding claims. The most likely
cause is secret propagation because the collector began immediately after the
rotation, but no response body proved a `401`, so that remains an inference.

The same campaign was resumed only after rotating another in-memory secret and
waiting 30 seconds. The resume ran from `2026-07-18T14:35:20Z` through
`2026-07-18T14:37:00Z`, completed every remaining ordinal, sealed evidence,
persisted and reread both artifacts, and returned `purgeState: "purged"`. The
runner can return that state only after the campaign schema proves every
manifest-derived purge task complete.

The final ignored checkpoint strictly decodes with 32 distinct external
completions. The ignored artifacts strictly decode, agree by digest, rederive
the same summary, and have this integrity receipt:

| Evidence property | Result |
| --- | ---: |
| Planned samples | 32 |
| Observed samples | 32 |
| Eligible measurements | 24 |
| Excluded warmups | 8 |
| Excluded duplicate wakes | 0 |
| Failed scenarios | 0 |
| Missing external durations | 0 |
| Abandoned samples | 0 |
| Not-started samples | 0 |
| Derived cohorts | 108 |
| Publishable | yes |

The persisted hashes are:

| Artifact | SHA-256 |
| --- | --- |
| Canonical manifest | `f2cff90b5796ee6eb3a5aaca6fffff6c680e32fbc4f67709f495fa07e6c64e03` |
| Raw artifact | `578bfe41aa92b90a7bd75fb2f3cbcd9834c55a23166bc212d0c119f516a2283f` |
| Durable evidence records | `b66a5c2972ca3db25f8de20cadb9bfe477029096491d0f640c8c0b0bf17c29f4` |

A focused scan of the raw artifact, summary, and checkpoint found no bearer
header, bearer-secret key, claim token, or payload field. The files remain
ignored and intentionally retained locally as the reproducible source for
this sanitized receipt.

## External Round Trips

All values are milliseconds from the caller's monotonic clock. The
`external_request` span includes authentication, request parsing, RunDO claim
and finalize control, topology execution, response transfer, and collector
completion. Percentiles use the checked-in nearest-rank policy. With only two
or four eligible samples per scenario, p95 and p99 are normally the maximum;
these are descriptive receipts, not stable population estimates.

| Scenario | n | Failures | Min | Median | p95 / p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `edge_echo` | 2 | 0 | 344.636 | 344.636 | 475.974 | 475.974 |
| `session_echo` | 2 | 0 | 3,879.796 | 3,879.796 | 4,167.978 | 4,167.978 |
| `dynamic_direct_echo` | 4 | 0 | 615.622 | 766.452 | 1,188.273 | 1,188.273 |
| `facet_echo` | 2 | 0 | 835.774 | 835.774 | 1,574.276 | 1,574.276 |
| `facet_journal` | 4 | 0 | 1,494.822 | 1,965.556 | 2,767.859 | 2,767.859 |
| `commit_wake` | 2 | 0 | 1,589.230 | 1,589.230 | 2,150.149 | 2,150.149 |
| `full_invoke` | 4 | 0 | 1,251.505 | 3,051.561 | 6,859.558 | 6,859.558 |
| `sync_rerun` | 4 | 0 | 2,937.666 | 3,034.475 | 3,191.051 | 3,191.051 |

The external numbers are not clean measurements of the named Cloudflare hop.
For example, `dynamic_direct_echo` spent only 5-13 ms in its internal
gateway-to-Dynamic-Worker span while its external request took 616-1,188 ms.
Likewise, `session_echo` reported 458-538 ms inside the gateway-to-SessionDO
span while the full controlled request took 3,880-4,168 ms. The experiment
therefore rejects any interpretation that treats external duration as pure
runtime communication latency.

## Internal Topology Spans

These are the most useful aggregate medians and p95s from the application trace
trees. Parent spans include their nested child work and must not be added to
their children.

| Scenario and span | n | Median | p95 |
| --- | ---: | ---: | ---: |
| Direct: `gateway_dynamic_rtt` | 4 | 8 | 13 |
| Session control: `gateway_session_rtt` | 2 | 458 | 538 |
| Facet echo: `gateway_session_rtt` | 2 | 453 | 993 |
| Facet echo: `session_facet_rtt` | 2 | 3 | 10 |
| Facet journal: `gateway_session_rtt` | 4 | 984 | 1,060 |
| Facet journal: `session_facet_rtt` | 4 | 19 | 29 |
| Facet journal: `facet_journal_io` | 4 | 7 | 12 |
| Commit wake: `mock_sync_wake_rtt` | 2 | 144 | 1,049 |
| Commit wake: `sync_cursor_io` | 2 | 8 | 288 |
| Full invoke: `gateway_session_rtt` | 4 | 1,492 | 2,101 |
| Full invoke: `session_facet_rtt` | 4 | 92 | 138 |
| Full invoke: `facet_mock_read_rtt` | 4 | 76 | 118 |
| Full invoke: `facet_journal_io` | 4 | 4 | 6 |
| Full invoke: `session_mock_finish_rtt` | 4 | 452 | 983 |
| Full invoke: `mock_sync_wake_rtt` | 4 | 452 | 983 |
| Full invoke: `sync_cursor_io` | 4 | 5 | 347 |
| Sync rerun: `sync_runtime_rerun_rtt` | 4 | 1,000 | 1,392 |
| Sync rerun: nested `gateway_session_rtt` | 4 | 957 | 1,262 |
| Sync rerun: nested `session_facet_rtt` | 4 | 11 | 19 |

The direct Dynamic Worker and ordinary facet hop were small relative to the
SessionDO, service-binding/sync, and outer control paths in this run. Temporary
facet SQLite work was also small at this synthetic two-entry scale. This is a
latency observation, not evidence that facet storage is authoritative, durable
across a lost JavaScript stack, or transactionally equivalent to Postgres.

## Cohorts And Confounders

- Every one of the 14 eligible facet samples reported `callback-ran` for its
  fresh attempt facet. The Worker Loader callback ran for 15 eligible samples,
  did not run for three warm-code facet samples, and was not applicable to six
  non-dynamic samples. Those cohorts are too small and scenario-confounded to
  estimate a startup penalty.
- The four paired stable/new-code scenarios did not show a uniform direction.
  New code had higher external medians for direct, journal, and full-invoke,
  but a lower median for rerun. Each code-mode cohort has only two samples.
- The eligible sample set contains 12 `MNL` and 12 `SIN` observations overall,
  but individual cells are not balanced: some contain two samples from one
  colo. Region, activation, code mode, and run order therefore remain
  confounded.
- Eight samples were configured at concurrency one and 16 at concurrency two.
  The maximum observed outstanding-claim count was one for 16 samples and two
  for eight. This is a claim-lifetime observation, not exact simultaneous CPU
  or I/O, and scenario assignment prevents a causal concurrency comparison.
- Payload size is either zero or 64 bytes and journal count is either zero or
  two, but each value is fixed by scenario. The matrix cannot isolate a payload
  or journal-size slope.

## Dynamic Worker Usage And Cost Model Correction

Cloudflare's `workersInvocationsByOwnerAndScriptGroups` analytics reported:

| UTC interval | Requests | CPU (microseconds) | Distinct Dynamic Workers |
| --- | ---: | ---: | ---: |
| P09 smoke, `12:00` five-minute bucket | 5 | 7,502 | 4 |
| P10 resume, `14:35` five-minute bucket | 32 | 45,297 | 12 |
| Same-day total | 37 | 52,799 | 12 |

The 12 distinct identities exactly match the frozen manifest. The request
count does not match the preflight assumption. P10 had 18 remaining logical
dynamic/facet samples, and the preflight forecast a clean same-day total of 23
requests with an operational ceiling of 28. The observed total was 37.

The P10 delta can be reconstructed as four direct samples plus twice the 14
facet-based samples: `4 + (2 * 14) = 32`. That strongly suggests a second
metered Dynamic Worker invocation per repeated facet path in this run, but the
account-level minute aggregate cannot attribute requests to individual
samples, and P09's initial five-request result does not establish the same
rule. This is an evidence-backed inference, not a claim about undocumented
Cloudflare billing semantics. Any future facet experiment must discard the
one-request-per-sample assumption and budget at least two requests per facet
sample until a smaller isolated billing test proves otherwise.

Using the published overage rates with no assumed included headroom, the
same-day Dynamic Worker subtotal is approximately USD 0.024012: USD 0.024 for
12 identities, USD 0.0000111 for 37 requests, and about USD 0.00000106 for
52.799 CPU milliseconds. This is not an invoice and excludes ordinary Worker,
Durable Object, and observability meters, but it remains far below the owner's
USD 2 incremental ceiling. Because analytics ingestion exposed the request
model mismatch only after the bounded campaign completed, the campaign was not
expanded and moved directly to purge and P11 teardown.

## P10 Conclusion

P10 proves that all eight synthetic communication shapes can complete on the
selected production Cloudflare target with strict identity, trace, evidence,
and cleanup contracts. It does not select a Flarex runtime architecture. The
small direct/facet/journal spans make a later Postgres-backed comparison worth
running, while the high outer-control and SessionDO/sync variance means a
larger, colo-controlled experiment is required before making a latency claim.
The final interpretation and teardown receipt are recorded in
[`P11-CONCLUSIONS-AND-TEARDOWN.md`](./P11-CONCLUSIONS-AND-TEARDOWN.md).
