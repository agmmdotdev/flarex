# Medusa PostgreSQL timeout investigation

Status: fixture cleanup, first-cause preservation and duplicate plan-transfer
correction implemented; intermittent storage-stall diagnosis remains open.
Investigation date: 2026-09-09. Implementation baseline: `20476446`;
comparison baseline: `bae23025`. The original investigation authorized no shared
owner change; the follow-up correction below defines the subsequently approved
scope. Deadline, recovery and publication policy remain unchanged.

## Approved failure correction

The follow-up request to fix the recorded failures authorizes a bounded
correction of first-failure visibility and investigation of cold installation
cost. Before correction, an authenticated operation after a latched failure returned
`rollbackOnly` without its retained first cause; the Medusa refusal bridge can
therefore hide the originating statement failure before sealing. Preserve that
full cause on the rollback-only error, retaining the existing error reason,
authority checks, failure latch, settlement and recovery decisions. Rejected
foreign or revoked contexts must not gain access to another request's cause.
Prove this deterministically before relying on another intermittent timeout.

Profile cold setup before changing its implementation. A passing repetition
alone cannot resolve storage stalls or justify changing statement/command/setup
limits, automatic callback retries, or durability policy.

The cold Product trace identifies repeated warm migration-plan reads during
fixture installation. Each previously sent the complete canonical-plan text twice, once for each SQL
equality expression. The expected behavior is one exact-byte comparison input
per read; the duplicate transfer is unnecessary serialization work. Its owner
is `migrationCoordination/migrationPlanRepository.ts`. The bounded correction
binds that text once through a one-row SQL relation while preserving the exact
byte comparison, bounded corrupt-byte transfer, all projections, sidecars and
transaction-local restoration. Require warm/cold corruption tests and measured
setup improvement before retaining it. No cache of database truth or authority
may cross transaction boundaries.

## Findings and disposition

The two failures in [Record 47](./47-medusa-shared-persistence-adapter.md#module-construction-validation)
are server-side statement timeouts during Product fixture creation. Neither
failure is evidence of a wrong Collection response or variants projection:

| Reported original case | Operation that failed | Evidence |
| --- | --- | --- |
| Collection update response | Two-row Product insert during `beforeEach` | PostgreSQL log at 21:53:08.045 +0630; the unchanged Collection fixture creates these two Products before each case |
| Internal Product variants list | Idempotency outcome insert for `__flarex_private_commerce/productCreate` | Retained error parameters identify the command; `product.spec.ts` creates Product fixtures before the variants read |

The full runs each passed 204 originals, failed one different case, and retained
one upstream skip. Each failing case passed in the other run, and the affected
22-case Collection and 27-case internal Product lanes passed separately. Earlier
intermittent failures also predate this extraction; see the existing
[shared-transaction validation limitation](../../shared-transaction-core/03-validation-and-completion.md#status-and-scope).

The live diagnostic run directly observed a `COMMIT` waiting in `IO/WalWrite`
for more than one second without a reported blocking-session chain. It also
observed harness `TRUNCATE` statements exceeding one second. Storage stalls are
therefore measured, not merely inferred from failed assertions. Their exact OS,
device or checkpoint cause, and their causal connection to the two earlier
failures, remain unproven. Do not describe an eventual passing run as a fix.

## Actual budget and failure owners

- `commerceTransaction/host.ts` sets transaction-local `statement_timeout` to
  1000 ms and `lock_timeout` to 500 ms. The commerce command budget is 10000 ms.
  The physical session initially sets its remaining transaction budget; commerce
  subsequently installs the narrower statement ceiling. The server's default
  `statement_timeout = 0` does not override this transaction-local setting.
- Store statements participate in `BoundedRequestLifetime.operation`. Its first
  failing cause is latched. `commerceRepositoryContext.checked` can then call
  `ctx.refuse`, which re-enters that already failed lifetime and reports
  `rollbackOnly`. The corrected refusal carries the retained complete Cause;
  `seal` continues to expose it through its existing full-Cause failure. The
  earlier implementation could unwind before sealing without that evidence,
  explaining why the first historical receipt needed the server log.
- Outcome publication occurs after command execution/sealing. The second error
  retained `statementFailure`, `writeOutcome` and PostgreSQL SQLSTATE `57014`.
  It is a setup write's outcome, not an idempotency write caused by a read API.
- No automatic retry of the framework callback, increased budget, altered
  durability setting, or change to rollback/uncertain-COMMIT policy is proposed.

## Controlled comparison and observation

The baseline run substitutes only the exact prior Product service, Product
repository and Currency service source bytes at their original resolved module
IDs. An external Vite diagnostic configuration loads `git show bae23025:<path>`
snapshots; load receipts and SHA-256 hashes establish the substitution. The
tracked checkout is never swapped. The source delta was checked: original tests,
coverage reporter, schema/compiler, SQL and shared persistence code are identical
between those two commits. The diagnostic path is not a shipping fallback.

Both runs use the existing complete 205-active-case entry point, ordinary-role
PostgreSQL 18.3 on port 62922, explicit PostgreSQL driver selection, one test
worker and unchanged resource caps. A separate ordinary-role client samples
`pg_stat_activity` every 75 ms and captures start/end cumulative statistics.
There is no query-wrapper or hot-path instrumentation. Sampling can miss short
waits; a missing blocker does not rule out every form of contention. Global
statistics include background workers and are not per-command cost receipts.

The server retains `fsync = on`, `synchronous_commit = on`,
`wal_sync_method = open_datasync`, 128 MiB shared buffers and a 300-second
checkpoint interval. I/O timing collection is off: zero timing counters do not
mean zero I/O cost. Historical inactive fixture schemas were observed and left
untouched. The database is not claimed to be a pristine cluster.

| Complete original suite | Result | Elapsed | Activity samples | Observer query median / P99 |
| --- | --- | --- | --- | --- |
| Prior adapter, `bae23025` | 205 passed, one unchanged skip | 221.51 s | 3149 | 1 / 2 ms |
| Current adapter, `20476446` | 205 passed, one unchanged skip | 274.18 s | 3412 | 1 / 2 ms |

Both samplers recorded zero blocking-session chains. Active `IO/WalWrite`
observations numbered 48 in the baseline and 328 in the current run. These are
sample counts, not complete wait durations or statement counts. The current
run sampled a `COMMIT` in `WalWrite` at 1049.862 ms and a harness `TRUNCATE`
at 1632.878 ms. The baseline's longest sampled reset was 504.874 ms; its final
schema drop reached 582.872 ms.

The current run overlapped a completed background checkpoint whose server log
reports 37585 synchronized files, a 7.410-second synchronization phase and a
269.470-second paced write phase. The long paced phase is not evidence that all
requests were blocked for that duration. Global client-backend relation-extension
counts were 5059 and 5100; WAL-write counts were 6065 and 6066. I/O timings were
disabled, so these counts cannot assign latency to a device or individual
command. Run order, cache and checkpoint state differ: the elapsed-time ratio is
not a measured adapter regression or a controlled causal checkpoint experiment.

The original timeout did not recur in this pair. This supplies a fresh complete
PostgreSQL conformance receipt for the current adapter while retaining the open
intermittent reliability qualification. The sampler and test connections closed,
and the task-owned server was stopped. No tracked source or test code changed.

## Test-fixture cleanup ownership

`test/support/product-runner.ts` owns `clearProductRunnerRows`. Cleanup covers
every installed Product table across all fixture scopes, even when a case uses
only a small part of the model graph. It deliberately retains
installation/readiness and authenticated history. The complete fixture also
creates and drops a migrated schema. Those operations must not be mistaken for
ordinary module request cost.

PostgreSQL documents that `TRUNCATE` takes exclusive table locks and that it can
replace relation filenodes. `WalWrite` denotes waiting for WAL writes; a null
wait event alone does not classify a statement as CPU work. Together with the
observed stalls, this makes fixture-generated file/WAL churn a concrete next
hypothesis, not a diagnosed engine defect.

The bounded replacement uses `test/support/product-fixture-reset.ts` to compile
one child-before-parent deletion batch from the admitted physical layout. It
includes database cascade edges, handles Category self-references with one
whole-table deletion, and refuses cross-table cycles. The fixture compiles the
plan once after installation; the existing `exec` driver boundary executes it
as one implicit transaction. Scope-authority tables are outside the plan. It
does not call module delete services, disable constraints, change seed calls or
wrap multiple test cases in one transaction.

Keep these validation boundaries when evolving fixture cleanup:

1. Measure current reset-only and reset-plus-small-create cycles over a complete
   suite-length workload, retaining per-phase times, server failures and wait
   observations. Separate cold setup and final schema removal from commands.
2. Compare one fixture-local row-deletion cleanup candidate against the current
   truncate path. Derive dependency order from the admitted layout; account for
   self-references and database cascades. Do not disable constraints, run module
   delete services, wrap the suite in one rollback transaction, or change seed
   calls. This is an explicit experiment, never an automatic runtime fallback.
3. Require identical empty application tables across all fixture scopes,
   preserved installation/readiness/history, unchanged fixtures/assertions and
   all originals. Include retained replay, scope, event and rollback boundaries.
   Show tail-cost improvement on repeated ordinary-role PostgreSQL runs before
   retaining the switch. Preserve PGlite compatibility. If the candidate loses
   semantics or fails to improve timing, reject it and retain current cleanup.
4. Retire the displaced cleanup path and temporary comparison plumbing only
   after those gates pass. No general persistence-test helper migration is
   included merely because other suites also use `TRUNCATE`.

The approved first-cause correction keeps the existing trusted error chain
through a rollback-only refusal. It introduces no logging surface or SQL argument
projection. Further diagnostic fields or publication changes remain separately
scoped work.

Cold fixture installation has a separate reliability boundary: the PGlite
preservation lane can exhaust `commerceHostFixture`'s existing 90-second
installation gate before any reset executes. The expected outcome is a ready
fixture followed by all preservation cases; the observed failure is a setup
`TimeoutError` with those cases skipped. Source-snapshot preparation overlapped
the observed failure, but causation is unproven. Retain that diagnostic evidence
separately from cleanup measurements. Installation and deadline policy remain
unchanged and require separate owner approval for a correction.

| Owner | Retain or proposed disposition |
| --- | --- |
| Shared Medusa reads, writes and module construction | Retain; no semantic defect established |
| Product fixture row cleanup | Retain the layout-derived row-deletion batch; per-case truncation is retired |
| Pinned original tests, source guards, assertions, skips | Retain unchanged |
| Request/physical-session limits and authenticated publication | Retain unchanged |
| First-failure visibility | Preserve the first complete Cause on authenticated rollback-only refusals |
| Migration plan comparison input | Bind canonical text once; preserve exact-byte and cold-restoration checks |
| Temporary source substitution and sampler | Diagnostic artifacts only; never package exports or normal test fallback |

Customer admission and general module-set bootstrap remain separate work. This
investigation adds evidence to the open PostgreSQL reliability gate and does not
claim that the intermittent failure has been resolved.

## Sources and receipts

Local sources: `packages/medusa-adapter/test/support/product-runner.ts`,
`packages/medusa-product/integration-tests/__tests__/product-module-service/product-collections.spec.ts`,
`packages/medusa-product/integration-tests/__tests__/product.spec.ts`,
`packages/persistence-postgres/src/commerceTransaction/{host,context,store}.ts`,
`packages/persistence-postgres/src/boundedRequestLifetime.ts`, and
`packages/persistence-postgres/src/physicalSession/postgres.ts`.

Official PostgreSQL 18 references:
[statement timeout](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-STATEMENT-TIMEOUT),
[wait events and statistics](https://www.postgresql.org/docs/18/monitoring-stats.html),
[TRUNCATE semantics](https://www.postgresql.org/docs/18/sql-truncate.html), and
[relation file layout](https://www.postgresql.org/docs/18/storage-file-layout.html).

Original failures remain in `work/validation/shared-medusa-module/`.
This investigation's scripts, source manifest, source-load receipts, test logs,
samples and summaries are in `work/validation/medusa-postgres-preflight/`.
These are local diagnostic artifacts, not promoted Medusa source files.

The cleanup experiment and its source-pinning receipts are retained locally in
`work/validation/medusa-fixture-cleanup/`. Source pinning isolates the experiment
from concurrent module-composition work; it is absent from promoted test paths.
Run the fixture preservation checks with
`pnpm --filter @flarex/medusa-adapter exec vitest run --config vitest.product-fixture.config.ts`,
selecting `FLAREX_TEST_DRIVER=pglite` or `postgres` explicitly.

The atomic batch relies on PostgreSQL's documented
[multiple-statements simple-query transaction](https://www.postgresql.org/docs/18/protocol-flow.html#PROTOCOL-FLOW-MULTI-STATEMENT)
and is exercised against both fixture drivers, including a later deletion
failure after an earlier deletion has taken effect.
