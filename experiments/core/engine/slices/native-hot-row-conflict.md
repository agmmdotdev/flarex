# Hot-row conflicts on native roots

Status **Decided: no Core change.** Automatic retry was challenged and not selected.

Flarex baseline `7531cf6d3`. Convex `db914cf06e2b06ee985646611b9e12ed7a770318`.

## Measured

[Load benchmark](../../../../packages/medusa-adapter/benchmarks/core-performance/product-workflows/README.md),
ordinary-role PostgreSQL, one local host, no added latency.

| Case | Concurrency | Throughput | Failures |
| --- | --- | --- | --- |
| Absolute Level update, one row | 4 / 16 | 21 / 5 per second | 75 of 100 / 120 of 128, all `writeConflict` |
| Absolute Level update, distinct rows at one Location | 4 | 66 per second | 0 |
| Stock adjustment, one row, scope-exclusive | 4 / 16 | 42 / 41 per second | 0 |

Conflicts are confined to rows that are genuinely shared. The checkout path
already waits through scope exclusion, so its ceiling is serial root latency.

## Independent challenge

- Current Core. Conflicts arise before acceptance and noncommit is durable only
  after `abortRequest` succeeds. Each attempt re-runs every step and hook with a
  fresh deadline, and no replay-safe metadata exists. `isCoreDefinitiveCommitRefusal`
  also accepts `capacity` and `admissionExpired`, so it cannot gate a retry.
- Pinned Convex. Mutations retry only commit-phase OCC, with full jitter, because
  bodies are deterministic and confined to the transaction. Actions do not retry.
- Accepted direction. Native replay stays disabled pending whole-command proof,
  and [proven-noncommit retry](../divergences/native-proven-noncommit-retry.md)
  forbids callback loops. The Level update contract selects default OCC and a
  sticky `writeConflict`.

## Dispositions

| Candidate | Disposition |
| --- | --- |
| Automatic bounded retry | Rejected. Guarantee change, and bounded attempts leave about (N-k)/N failing when one writer wins each round. |
| Scope exclusion for absolute Level updates | Rejected. Serializes the whole scope to help an admin write whose contract already reports the conflict. |
| Committer per-key queue, row locks, adapter mutex | Rejected. Stale reads stay stale, or the accepted boundary forbids them. |

## Open gate

No adapter or persistence source maps `writeConflict` to Medusa's conflict
response, so a future API host must return 409 rather than a generic failure.
Serial scope-exclusive throughput is addressed by per-root CPU and round trips.
