# P33 SessionDO-Owned Postgres Local Proof

Status: implementation and local proof complete on 2026-07-20. P34 subsequently
completed the separate production Hyperdrive experiment.

This is an app-local future-topology experiment. It does not change the active
Flarex roadmap or promote SessionDO-owned finalization into the main executor.

## Implemented Boundary

The candidate and control are exported by one Worker script, but they do not
share one execution context:

```text
public fetch handler
  -> ProbeSessionDO
       -> network-isolated Dynamic Worker facet
            -> sealed synthetic journal and intent
       -> candidate: SessionDO-local Postgres operation
            -> OCC plus terminal outcome plus cursor write in one transaction
            -> post-commit SyncDO wake

matched control
  -> ProbeSessionDO
       -> Dynamic Worker facet
            -> same-script PostgresFinishEntrypoint RPC
                 -> the same Postgres operation and SyncDO wake
```

`gatewaySessionPostgresWorker.ts` is one deployable script. Its dedicated
`ProbeSessionDO` injects the Postgres read/finalization functions into the
shared SessionDO implementation. The ordinary probe gateway injects no such
functions and therefore does not import or initialize `pg`. This separation is
important: `pg` requires `nodejs_compat`, while the existing non-Postgres probe
must continue to start without that flag.

The Dynamic Worker receives an empty environment and
`globalOutbound: null`. It does not receive Hyperdrive, a connection string,
the Postgres functions, the SyncDO namespace, or either same-script entrypoint.
The candidate waits until the facet response is returned and validated before
SessionDO marks the attempt `finishing` and opens finalization.

The same `readPostgresSnapshot` and `finishPostgresRequest` operations back both
arms. Each operation acquires a request-scoped `pg.Client`, and the finish path
delegates to the existing pure transaction kernel for ordered cursor locking,
OCC validation, exact terminal-outcome recovery, outcome insertion, and cursor
advance. The SyncDO wake occurs only after that transaction returns an
authoritative outcome.

## Frozen Comparison

`PROBE_SESSION_POSTGRES_AB_MATRIX_V1` contains eight counterbalanced pairs,
16 runs, and 32 samples. Every run has two sequential requests, one reused
session/facet identity, stable code, two journal entries, and 64 payload bytes.
Odd pairs run entrypoint then SessionDO; even pairs reverse the order.

The control scenario is `facet_finalizer_postgres_warm_invoke`. The candidate
scenario is `session_postgres_warm_invoke`. Candidate receipts use executor
host `session-postgres`; their facet receipt must contain zero outbound finish
calls and no finish result. Control facet receipts must contain exactly one
outbound finish call.

## Local Real-Postgres Receipt

A disposable PostgreSQL 18 cluster was initialized under the ignored probe
state directory on port 55432 with only the isolated P28 probe schema and its
cursor/outcome tables. The generated one-script Worker bundle was then run in
Miniflare with `nodejs_compat`, Worker Loader, local Durable Objects, and that
real PostgreSQL connection.

The dedicated integration suite passed 4 of 4 tests:

- candidate finalization reported Postgres authority and an applied SyncDO
  wake while its facet made zero finish calls;
- the same-script entrypoint control reported Postgres authority while its
  facet made exactly one finish call; and
- the second sequential request advanced both isolated scope cursors to 2
  without changing either arm's capability placement; and
- the candidate completed through campaign registration, public gateway,
  RunDO claim/finalization, SessionDO, Postgres, and SyncDO.

The cluster was stopped, its state directory removed, and port 55432 verified
closed. This proves the local Worker -> SessionDO -> Dynamic Worker facet ->
real Postgres -> SyncDO mechanics. It does not measure Cloudflare placement,
Hyperdrive, Neon network latency, cold starts, or production performance.

## Regression And Build Receipt

- TypeScript typecheck: pass.
- Existing gateway/SessionDO Miniflare regression: 46 of 46 tests pass after
  keeping the `pg` dependency out of the ordinary gateway bundle.
- Dedicated SessionDO/Postgres Miniflare integration: 4 of 4 tests pass against
  the disposable PostgreSQL cluster.
- Complete ordinary app suite at the original P33 checkpoint: 267 tests pass
  and the three then-existing credential-gated Postgres integration tests skip,
  across 28 passing files and one skipped file.
- Session/Postgres Wrangler dry-run: pass; one script exports all Worker,
  Durable Object, Worker Loader, and same-script entrypoint surfaces.
- Focused protocol, matrix, transaction, and trace checks: pass.

The conditional integration test is intentionally skipped in the ordinary
suite unless both `RUNTIME_TOPOLOGY_PROBE_TEST_DATABASE_URL` and
`RUNTIME_TOPOLOGY_PROBE_TEST_WORKER_BUNDLE` are present. It never falls back to
an owner database or a fake in-memory transaction.

P34's fourth conditional case initially exposed an incorrect HTTP-200 test
expectation and then the missing candidate gateway relationship classifier.
After both corrections it passed and prevented recurrence of the exact
post-commit production HTTP-500 failure.

## Production Follow-Up

P34 later completed a clean 32-sample production campaign and P35 proved full
teardown. See those records for the latency result and its limits. The owner
credential was never copied into source, generated evidence, documentation, or
Git.
