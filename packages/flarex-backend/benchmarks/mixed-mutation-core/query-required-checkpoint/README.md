# Paused query-required checkpoint measurements

Measured runtime: `6026d24fdaf6e1c898c1a9627209da315007c9bc`, 2026-10-03.
The owner requested fresh Payload and Medusa workflow measurements while keeping
implementation paused. No runtime code changed. The standalone Payload observer's
stale two-lookup assertion was corrected to one fresh lookup: its bound host now
prepares outside the measured request. Both project reviewers traced current
admission and confirmed that fresh catalog validation remains. All other result,
admission, installation and catalog assertions remain unchanged.

## Complete mixed and workflow requests

Each successful workload has three warmups, twenty measured warm requests and
three cold requests in each separate quiet/traced lane. Latency below is quiet
wall time; SQL and transaction counts are from the traced lane. All commands ran
serially on local PostgreSQL 18.3, Node 24.16.0 and ordinary runtime roles, with
fsync, synchronous commit and full-page writes enabled. This is not hosted
Cloudflare latency or native ORM parity.

| Workload | Warm median / P95 ms | Cold median ms | Warm SQL dispatches | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Application + Product | 535.085 / 554.359 | 558.182 | 522 | 48 |
| Standalone Product/Pricing/Link/Tag workflow | 302.025 / 333.394 | 300.439 | 301 | 13 |
| Application + Product + Payload | Unavailable: first warmup fails | Unavailable | 304 before failure only | 33 before failure only |
| Mixed workflow | Unavailable: first warmup fails | Unavailable | 304 before failure only | 33 before failure only |

Product and standalone workflow each complete 26/26 samples in both lanes.
Their warm SQL/transaction counts are constant across all twenty samples.
Every captured trace, including failed samples, has zero unknown statements,
query errors, unobserved dispatches, lost-context dispatches and incomplete spans.
This does not establish coverage of uninstrumented pools or PostgreSQL nested SQL.
Cold invocation excludes separately reported fixture provisioning/preparation.

Product/Payload fails at `productPayload-warm-0-0` in quiet and traced runs.
The native error tokens are `LogicalParticipantAdmissionError` and
`resourceFailure`; its final transaction rolls back in `payload-create`.
Mixed workflow fails at `mixedWorkflow-warm-0-0` in quiet and traced runs with
`CommerceTransactionError`, `rollbackOnly` and `resourceFailure`; its final
transaction rolls back in `medusa.workflow:run`. No successful warm/cold request
was measured for either graph. Failed elapsed times and incomplete SQL paths are
not successful performance observations. Underlying causes remain unresolved;
there was no fallback, skipped assertion or runtime correction.

The older [complete ledger](../../core-performance/fresh-application-acceptance/README.md)
reported Product 540.672/599.926 ms with 477 SQL/20 transactions and standalone
workflow 266.690/271.302 ms with 270 SQL/3 transactions. Product latency is similar
with more SQL/transactions; standalone workflow is slower with more SQL and
transactions. These are historical cross-checkpoint comparisons, not isolated
causal attribution to this last runtime commit. Existing performance gates remain
unchanged. Neither the failed mixed graphs nor the successful samples establish
complete mixed-core acceptance.

## Dedicated standalone Payload Local API

The existing preference-enabled CMS benchmark exercises native Payload create,
find-by-ID, find, count, update, retained replay and delete. It is distinct from
the new generic managed direct-read profile and the borrowed mixed participant.
Three warmup pairs precede twenty alternating observed/uncollected cohorts.
Values below use the uncollected cohort and nearest-rank quantiles. SQL counts
are per-role/database `pg_stat_statements` top-level plus utility deltas, excluding
the observer. They are not measured client round trips or the mixed tracer's
dispatch metric. Live cardinality remains bounded while tombstones grow.

| Operation | Median / P95 ms | SQL statements | Historical median ms / SQL |
| --- | ---: | ---: | ---: |
| Create | 79.929 / 122.038 | 125 | 92.319 / 172 |
| Find by ID | 48.155 / 81.515 | 65 | 68.022 / 121 |
| Find | 50.930 / 66.452 | 65 | 70.581 / 121 |
| Count | 49.875 / 52.996 | 65 | 71.061 / 121 |
| Update | 78.905 / 89.993 | 122 | 90.223 / 164 |
| Retained replay | 54.425 / 61.231 | 96 | 74.011 / 137 |
| Delete | 80.334 / 102.312 | 126 | 88.106 / 171 |

Binding costs are separate: current median/P95 102.790/161.948 ms and 141 SQL,
versus historical 49.203/52.867 ms and 43 SQL. Moving preparation to a bound
lifetime does not make that work free. First instance initialization is 63.717 ms
(one sample); later fresh instances in the same process have median/P95
1.046/1.348 ms, both with zero SQL. These are not cold-process measurements.
The original assertion-failed run is retained; the corrected benchmark passes
both tests and all operation checks. Current request medians/SQL are lower,
but create/find-by-ID/delete tails are worse than that historical candidate.

## Evidence and preservation

`summary.json` records distributions, sample counts, failures, source freeze and
raw artifact hashes. The 147-path runtime/source inventory is unchanged before
and after the framework measurements; the standalone Payload harness correction
is explicitly separate. Raw reports/logs and source inventories remain in the
ignored local directory
`work/validation/current-framework-measurements-20261003/`:

- `quiet/` and `traced/`: full Product and preserved first Payload failure.
- `mixed-workflow-quiet/` and `mixed-workflow-traced/`: preserved workflow failures.
- `standalone-workflow-quiet/` and `standalone-workflow-traced/`: complete workflow.
- `payload-standalone.log`: original stale-observer assertion failure.
- `payload-standalone-corrected.log` and `payload-standalone.json`: successful Local API run.
- `source-before.json`, `source-after.json`, `summary.json`: evidence inventory.

The isolated database's temporary top-level statement tracking was restored to
its original setting. All owned benchmark processes ended and the owned
PostgreSQL instance was stopped. Data and original failed reports are preserved.
