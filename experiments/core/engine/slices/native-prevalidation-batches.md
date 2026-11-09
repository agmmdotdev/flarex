# Native prevalidation batches

Status **Implemented.** Flarex baseline `24749b741`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`.

Mechanism and its difference from Convex:
[batched first pages in native commit prevalidation](../divergences/native-prevalidation-read-batches.md).

## Measured attribution

A statement trace of Product create compared 1 and 16 concurrent callers. One query
accounted for nearly all the growth from 51 to 93 round trips per request: the index
page read issued by `CoreNativeValidation.prepare`, about 38 per request, plus about
10 from foreign-key probes. At concurrency 1 these reuse exact-timestamp cache pages.
Under load each commit advances the published timestamp, so each one misses.

A CPU profile limited to the measured window put 13% of request CPU in
`privateJsonData.capture`, of which half was allocation in
`measureCanonicalJsonUtf8Bytes` for individual primitives. Effect runtime overhead was
30%, spread across many sites. Schema parsing appeared only in setup.

## Independent challenge

Two read-only challengers inspected current Core and pinned Convex.

- Batching is sound only if the preload is advisory: a typed failure must leave each
  scan to report its own outcome.
- The generation check must not be hoisted, or a later conflict could preempt an
  earlier slot's refusal. Stale indexes are filtered purely.
- The preload must use the loop's exact page size, or its pages silently miss.
- Folding the write-log suffix over a prepared result is a separate design. The log
  keeps keys only today, and all four preparation stages would have to fold.

## Dispositions

| Item | Outcome |
| --- | --- |
| Index observations | First pages share one advisory statement, up to 1,024 observations. |
| Failure handling | `advisoryPreload` is shared with `CoreIndexSnapshot.rangeBatch`. |
| Foreign-key probes | Remain sequential; batching needs a failure-tolerant pre-walk. |
| Cross-timestamp cache reuse | Not selected; verification stays at 100%. |
| Scalar JSON measurement | No walk state or generator for primitives; same results. |

## Measured outcome

Product create on ordinary-role PostgreSQL, one local host, no added latency. Medians
of three alternating rounds against a clean baseline clone, 128 operations each.

| Callers | Round trips | CPU per request | Throughput | Median latency |
| --- | --- | --- | --- | --- |
| 1 | 51 → 51 | 74.5 → 71.8 ms | 9.1 → 9.4 per second | 109 → 105 ms |
| 16 | 99 → 59 | 76.2 → 70.2 ms | 12.4 → 13.9 per second | 1,270 → 1,137 ms |

The machine was not quiet, so read these as a paired comparison, not absolute capacity.
CPU per request remains the throughput limit.
