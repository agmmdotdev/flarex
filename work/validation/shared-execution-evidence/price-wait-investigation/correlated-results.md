# Correlated pricing-wait investigation

The historical 172.1902 ms pricing wait did not recur. Fresh correlated requests
did expose a concrete database-side stall: seven other captures took
192.4477-728.0731 ms while PostgreSQL repeatedly reported **IO / WalWrite**,
without a matching client or independent-process heartbeat interruption or GC
pause. Pricing itself reached 13.2492 ms with an IO/WalWrite observation.
These are fresh wait witnesses, not proof of the historical cause or removable
client CPU. No runtime implementation was changed by this investigation.

## Campaigns and gates

All lanes use the complete small mixed workflow, the existing ordinary runtime
role, separate administrator provisioning, three warmups, and durable settings
fsync/full_page_writes/synchronous_commit on. PostgreSQL is 18.3 on localhost.
Database mode additionally includes one SDK calibration. Test-only correlation
hooks and activity polling remain enabled even in SDK quiet mode; these lanes
are not native-relative quiet acceptance.

| Lane | Completed measured pricing calls | Pricing min / median / max, ms | Status |
| --- | ---: | --- | --- |
| Full database observers, ordered server correlation | 8 | 2.4381 / 2.6064 / 13.2492 | Complete; source/settings/cleanup gates pass |
| Quiet SDK mode, duration logging, requested 100 | 23 | 1.8571 / 2.1709 / 3.6800 | Failed during subsequent setup; retained partial evidence |
| Quiet SDK mode, duration logging disabled | 20 | 1.3831 / 1.5024 / 2.2765 | All business samples succeed; source-stability gate fails |
| Deliberate client-pause positive control | 2 | Injected 172.5198; other 2.2073 | Complete; deliberately synthetic, excluded from natural evidence |

There are 51 fresh natural pricing observations across the three natural lanes,
but only the first is a completed, source-stable correlated campaign. This is
insufficient to estimate production frequency or call the historical outlier a
PC hang. The older uncorrelated campaigns remain documented separately in
[results.md](results.md); they are not pooled into a frequency claim.

Run IDs and local artifacts under `correlated/`:

- `full-batch-1`: `9a05e324-e4c1-45b8-a854-c1059cccee9a`.
- `light-100`: `a043a41e-f648-4a75-b3ce-bb7b1566a345`.
- `no-duration-20`: `f5a29d32-f820-4c66-aa68-be5702cbe7ec`.
- `control`: `357ce6ec-29c6-4e6e-8890-dd2ca87f748b`.

Each retains its timing ledger, raw SDK report where persisted, and breakdown.
Raw logs/reports and test-only diagnostic sources remain ignored local artifacts.
This report and the parent correction are the scoped Git deliverable.

## What the new stalls show

The completed database lane retained 304 capture queries: median 3.3613 ms,
P95 31.5300 ms, maximum 728.0731 ms. Seven exceeded 100 ms:

| Request suffix / capture | Client await, ms | Logged Bind + Execute, ms | Maximum client / independent heartbeat gap, ms |
| --- | ---: | ---: | --- |
| flarex:5 / 38 | 363.6042 | 1.426 | 16.272 / 16.212 |
| flarex:6 / 22 | 220.6353 | 1.381 | 16.192 / 16.204 |
| flarex:6 / 23 | 192.4477 | 1.326 | 16.454 / 16.409 |
| flarex:6 / 25 | 220.2698 | 1.383 | 16.397 / 16.111 |
| flarex:8 / 2 | 295.3144 | 1.649 | 17.880 / 17.825 |
| flarex:8 / 3 | 728.0731 | 1.621 | 18.095 / 18.126 |
| flarex:8 / 4 | 606.4128 | 1.390 | 16.150 / 16.162 |

All seven have repeated IO/WalWrite observations on the actual query backend
PID, no sampled blockers, no overlapping GC, and empty pg query queues with no
active query at submission. Synchronous submission takes 0.118-0.188 ms.
For capture 3 in flarex:8, 41 polls overlap the wait; the last observed WalWrite
is at request-query-relative 717.8172 ms. Its first pre-parser socket callback
is at 727.9413 ms and ReadyForQuery at 728.0471 ms. Both heartbeat streams keep
advancing during this interval. Polling is sampled evidence, not continuous
attribution of every millisecond; some polling calls themselves take longer.

The slowest pricing call has one WalWrite observation at +2.3588 ms, no blocker
or overlapping GC, first socket callback at +13.1435 ms, ReadyForQuery at
+13.2260 ms, and observed event-loop idle/active deltas 12.6217/0.6378 ms.
Windows CPU counter deltas are too coarse to infer zero CPU from their zero
values. This pricing call is a smaller database-wait witness, not a reproduction
of the historical 172 ms event.

PostgreSQL documents IO/WalWrite as waiting for a WAL file write. It differs
from IO/WalSync and from LWLock/WALWrite. The observed database wait is therefore
specific; these measurements do not identify an SSD fault, antivirus activity,
checkpoint interference, other applications, or the underlying cause of slow
OS writes. [PostgreSQL 18 wait events](https://www.postgresql.org/docs/18/monitoring-stats.html)

## Why short server duration logs did not rule this out

The ordinary extended-query SELECT completes Execute before the implicit
transaction finishes at Sync. PostgreSQL 18.3 logs Execute duration first;
Sync then calls `finish_xact_command()` before ReadyForQuery. Consequently
Parse + Bind + Execute does **not** measure the entire server response interval.
The hundreds of milliseconds left after subtracting those logs cannot be called
client/transport time or added CPU. The source ordering and observed late
response strongly support WAL work during implicit transaction completion as
the phase responsible for these fresh stalls; a backend stack trace was not
collected. [PostgreSQL 18.3 protocol implementation](https://github.com/postgres/postgres/blob/REL_18_3/src/backend/tcop/postgres.c)

These apparent membership reads include physical row locks. Current ownership
is shared persistence: `finiteCaptureFrontierInstallation.ts` takes FOR SHARE
on control scope and installation receipt; `0145_binding_maintenance_authority.sql`
installs capture authority/session FOR SHARE and build FOR KEY SHARE checks in
`fx_accept_finite_storage_capture`. PostgreSQL row locking can cause disk writes.
This explains why application read semantics do not imply a physically read-only
transaction. Which particular lock generates WAL in each witness was not
isolated. The investigation does not authorize removing authority locks,
grouping transaction lifetimes, or disabling synchronous durability.
[PostgreSQL row locks](https://www.postgresql.org/docs/18/explicit-locking.html)

## Distinguishing client stalls and logging effects

The positive control deliberately blocks the client event loop for 172 ms
immediately after pricing submission. Its 172.5198 ms await has only 1.159 ms
logged Bind/Execute, a 175.0701 ms client heartbeat gap, about 172 ms of process
and thread CPU, and an advancing independent heartbeat (maximum 16.1884 ms).
PostgreSQL is already idle / ClientRead in repeated samples through +157.999 ms.
This demonstrates the instruments can distinguish a client stall from the fresh
WalWrite stalls. It does not establish that a deliberate pause resembles the
historical cause.

With duration logging disabled, no 100 ms capture stall appears in the 20
completed business samples. The largest of 760 captures is 22.3853 ms and
overlaps a 20.5394 ms GC pause. The client heartbeat gap is 21.9939 ms while the
independent gap is 15.6760 ms; the backend is sampled idle / ClientRead. This
is a separate, naturally observed client-pause signature. No server duration
is available in this lane; activity correlation remains by actual backend PID.

Logging all prepared statements writes substantial SQL text despite parameter
suppression. It could amplify local disk contention. The no-duration lane has
fewer samples and a source-stability failure: its before/after source hashes
differ while settings stability and cleanup pass. Its observations cannot prove
logging caused the previous WAL stalls or establish a stable performance
comparison. Concurrent unrelated worktree changes were preserved.

## Failures and measurement boundaries

A first 30-sample full-observer attempt reached report export but failed with
`RangeError: Invalid string length` when serializing the large raw report. It is
retained as `full-observers.log`, with its server logs; no completed correlation
campaign is claimed. Later full batches were bounded to eight to fit the export
limit. No runtime SDK report behavior or acceptance gate was weakened.

The requested 100-sample light lane completed 23 roots, then a fixture setup
unique-build observation query failed with SQLSTATE 57014, statement timeout,
wrapped by the existing target-transaction invalidAuthority boundary. The query
was outside the instrumented business root, so this ledger does not identify
its cause. No timeout cause is inferred from the earlier WalWrite witnesses.
The failed SDK raw report and full failure log remain retained. Cleanup passes;
source/settings after-snapshots are unavailable and their gates fail, rather
than demonstrating a specific settings change. This is a separate unresolved
campaign blocker, not a successful 100-run result.

Correlation pairs all named submissions, including setup, with ordered backend
Bind/Execute records by actual PID and statement name, checks equal counts,
single backend session identity and strict per-session line order. This avoids
the prior wall-clock candidate matching. The completed full lane pairs all 498
named submissions; the positive control pairs 252. Socket callbacks are prepended
before pg parsing; they are user-space delivery observations, not kernel packet
arrival timestamps. GC observations and client/independent heartbeat timestamps
are monotonic; IPC ping brackets verify the shared process hrtime coordinate.
Heartbeat/activity timers request 5 ms, but ordinary observed Windows gaps are
approximately 16 ms. Short unobserved waits cannot be excluded.

The harness is `correlated/diagnostic.test.ts`, its Vitest config and
`sampler.cjs`; `analyze.cjs` produces the breakdowns. Run with ordinary/provisioning
endpoints, `FLAREX_EVIDENCE_OUTPUT`, `CORRELATED_MODE=database`,
`CORRELATED_SAMPLES=8`, `CORRELATED_CONTROL=none`, and
`CORRELATED_SERVER_LOG_START` set to the server log's pre-run byte length.
PostgreSQL correlation logging uses `log_min_duration_statement=0`,
`log_parameter_max_length=0`, `log_parameter_max_length_on_error=0`, and
`log_line_prefix=FXCORR[%n][%p][%l][%c]`; keep SDK-disabled pg_stat_statements
tracking and auto_explain thresholds disabled. For a logging-off lane also set
`CORRELATED_SERVER_DURATION_LOGGING=off`, `log_duration=off` and
`log_min_duration_statement=-1`. The client-pause control must remain explicitly
separate. [PostgreSQL logging settings](https://www.postgresql.org/docs/18/runtime-config-logging.html)

Owned PostgreSQL on port 56433 and the sampler children were stopped. PGlite,
native-relative acceptance and runtime changes were outside this diagnostic.
The next historical-sized pricing occurrence can now be classified using the
same instrumentation. The original 172 ms attribution remains open; the new
correlated evidence supports local WAL I/O as a concrete intermittent mechanism,
not a broad Effect rewrite or the separate OCC planning correction.
