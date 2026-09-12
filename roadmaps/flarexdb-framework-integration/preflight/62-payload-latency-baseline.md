# Payload Runtime Latency Baseline

Status: measurement-only baseline implemented; optimization decisions remain gated.

## Outcome And Owners

Establish a repeatable private Node/ordinary-role PostgreSQL baseline for the
compiler-configured Payload runtime on the current shared storage implementation.
Revalidate the existing collection, relation and lifecycle regressions first.
Own only benchmark/test support and this domain's documentation. No runtime hook,
cache, lock, transaction, schema, authority or public contract change is approved.

This follows [collection configuration](./54-payload-collection-configuration.md)
and the [latency follow-up](../07-payload-adoption.md#runtime-lifetime-and-latency-follow-up).
The accepted database and Payload designs and package-boundary roadmap govern
authority. Shared storage replacements belong to the shared-transaction-core
roadmap; measurements must identify the exact tested source rather than reuse
receipts from an older implementation.

## Method And Limits

- Compile two native scalar collections and use the existing loaded-source
  analysis, publication, readiness, activation and lifecycle binding fixtures.
  This is not uploaded-artifact or deployment evidence.
- Measure compilation, first initialized instance, later fresh instances in the
  same process, and binding separately. Module import/process launch and schema
  installation are outside request timing. Fresh instances are not cold processes.
- Warm one scoped ordinary runtime, then alternate traced and uncollected-trace
  cohorts with equal-length values through create, point read, bounded find, count, update, retained replay
  and delete. Keep live table cardinality bounded; report exact sample counts and
  nearest-rank p50/p95, not timing thresholds as correctness assertions.
  Deleted documents retain tombstones and revision history; report that growth
  rather than implying an unchanging physical database or bypassing retention.
- Reuse Effect's native tracer without altering application clocks or adding
  callbacks to runtime owners. Named span timings are inclusive and nested;
  they cannot be added to total request time. Report scope-lock acquisition as
  query/lock/decoding duration, not isolated server wait time.
- Read per-role/per-database `pg_stat_statements` deltas outside the timed
  operation. Exclude the observer's own statistics query. Require an isolated
  database/role, enabled top-level and utility statement tracking, and no concurrent workload.
  Counts include transaction control. Server execution time excludes network,
  JavaScript and untracked planning; it is not end-to-end latency.
- Keep default tracing and collected tracing separate to expose observer cost.
  Sequential, tiny-loopback fixtures are neither production load nor throughput
  proof. A later contention probe or deployed lane needs its own named workload.

## Alternatives And Completion

Do not infer that Payload initializes per request: composition already owns one
scoped instance. Do not reuse a bound host across principals, cache admission, or
change locks merely because a span is expensive. Retain native validation,
scope/binding checks, replay and finalization unchanged. Reuse fixture orchestration
and instrumentation owners; add no universal benchmark or transaction abstraction.

Completion requires focused PGlite and ordinary PostgreSQL regressions, benchmark
correctness assertions, first-instance/fresh-instance/warm samples with SQL and inclusive phase data,
affected typechecks/lint and both reviewers. Clean up owned database resources.
Keep exact timing receipts with the benchmark output/Git evidence; the roadmap
records only resulting owner decisions and unresolved measurement limitations.
If a shared-owner defect appears, preserve the witness and stop at that boundary.

## Resulting Direction

The local ordinary-role PostgreSQL baseline identifies request admission and
active-relation readiness preparation as the first investigation target, with
substantial statement amplification even for point reads and retained replay.
Same-process runtime initialization and binding are not the dominant warm-request
cost. The measured Local API call and commit phases do not explain most elapsed
time. These inclusive observations locate work; they do not establish a root
cause, additive phase accounting, contention, or a safe caching policy.

Next, preflight the shared admission/readiness owners and identify repeated
evidence loads and validations by statement and call site. Preserve live authority,
active-schema, scope, fencing and transaction checks. Any consolidation requires
its own approval and owner/consumer regressions; the Payload adapter must not
cache authority or compensate locally. Cold-process, deployed Cloudflare, larger
data and concurrent workloads remain unmeasured.

Current-storage regression fixtures retain the unique/index identity foreign-key
refusal and exercise missing-target population through a reversible corruption
of the exact current revision body. Complete primary-key inventory ordering
makes restoration independent of physical heap order. No runtime semantics or
constraints are weakened, and no legacy corruption path is retained.

Run the opt-in benchmark with `FLAREX_PAYLOAD_LATENCY=1` and
`FLAREX_POSTGRES_DATABASE_URL` against a disposable ordinary-role database with
`pg_stat_statements` installed in `public`, preloaded and tracking top-level SQL:

```text
pnpm --filter @flarex/persistence-postgres exec vitest run test/payloadLatency.postgres.test.ts --no-file-parallelism --maxWorkers=1 --silent=false
```
