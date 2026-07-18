# P13 Local SessionDO Executor Proof

Status: implementation and local proof complete on 2026-07-18; mandatory
review checkpoint in progress.

## Proven Topologies

The comparison keeps the same fixed dynamic facet source and temporary SQLite
journal in both arms.

```text
external control
  gateway -> SessionDO -> attempt-scoped Dynamic Worker facet
          -> external mock read Worker
          -> facet journal -> SessionDO -> external mock finish Worker
          -> SyncDO

SessionDO candidate
  gateway -> SessionDO -> attempt-scoped Dynamic Worker facet
          -> token-gated gateway Worker entrypoint -> owning SessionDO read
          -> facet journal -> owning SessionDO finish -> SyncDO
```

Cloudflare custom Dynamic Worker bindings must be Worker entrypoint stubs. A
new `RpcTarget` constructed inside the SessionDO was therefore rejected by the
local runtime at facet transport. The supported implementation uses a
self-service binding to `ProbeSessionExecutorReadEntrypoint`. That entrypoint is
only a transport bridge: the owning SessionDO validates the opaque capability
token, exact attempt evidence, running phase, and one-shot read count before it
returns the synthetic snapshot. The bridge does not own executor state or
finish policy.

The Dynamic Worker receives only:

- the self-bound read entrypoint;
- one random, attempt-specific capability token plus exact expected read
  identity;
- its fixed code and isolated facet SQLite database.

It does not receive the SessionDO namespace, SyncDO namespace, supervisor SQL,
the external mock finish binding, credentials, Hyperdrive, or outbound
network. The SessionDO performs the synthetic finish and calls SyncDO itself.
Campaign cleanup reopens an already-planned facet under the same effective
Worker Loader identity and reconstructs the exact original WorkerCode and
bindings, as required when an ID is reused. For the SessionDO candidate, the
stored capability is already fenced by terminal attempt state and the purge
route never invokes it. Cleanup therefore introduces neither a new identity
nor a different executor authority.

A manifest-only candidate attempt with neither admission evidence nor active
facet tracking is safely treated as never created during abort cleanup. Any
tracked facet missing its required attempt evidence still fails closed. A
partial three-sample campaign proves one completion, two reconciled unstarted
samples, and terminal application purge. A separate misconfiguration lane
proves that wholly unadmitted attempts can purge without Worker Loader or read
bindings, and its tombstone reports zero physical facet deletions.

No undocumented `experimental` compatibility flag is required. Wrangler's
dry-run accepts the self-service entrypoint binding as an ordinary Worker
binding.

## Attempt And Replay Result

The SessionDO persists the exact request, opaque capability token, phase,
one-shot read count, and terminal HTTP response. The state transitions are:

```text
new exact attempt -> running -> finishing -> completed
changed evidence  -> conflict
completed exact   -> stored replay
```

Two unbarriered simultaneous local requests serialized through one completion
and one byte-identical replay. A separate test-only read barrier then held the
first request after its durable `running` transition: the in-progress duplicate
received `409 session_executor_attempt_busy`, the first completed, the next
exact call replayed the stored response, and only one SyncDO cursor advance
occurred.

A request with changed payload evidence under the same attempt identity is
rejected with `session_executor_attempt_conflict`. A missing direct SyncDO or
self-bound read capability fails before facet execution.

This probe deliberately does not recover a SessionDO that terminates after a
nonterminal `running` or `finishing` transition. Such a row remains fenced and
the bounded campaign must stop, reconcile its outer claim, purge, and report
the failed experiment. Recovering the uncertain window after SyncDO applies a
wake requires the real executor's known-settled retry/outcome-recovery design;
it is explicitly outside this mock A/B and is required before this pattern
could host a production executor.

## Frozen Production Matrix

- 12 external-control and 12 SessionDO-candidate measured cells;
- alternating external/candidate run order;
- two excluded warmups for the first cell in each arm;
- 28 total sample executions;
- 64 payload bytes and two journal entries per sample;
- one new SessionDO and one attempt-scoped Dynamic Worker loader identity per
  sample;
- collector concurrency one;
- 1,792 total payload bytes, 56 journal entries, and 28 bounded effective
  loader identities.
- 28 measured facet executions plus as many as 28 cleanup-only facet requests;
  Cloudflare analytics, not the identity count, owns final request/cost evidence.

The optional `replicate` field distinguishes independent matched cells without
pretending that payload or journal dimensions changed. It does not enter the
runtime sample identity; the unique run ID still owns each independent session
and attempt.

## Local Receipt

The final pre-production checkpoint passed:

- `corepack pnpm --filter @flarex/runtime-topology-probe typecheck`;
- all 27 Vitest files and 230 tests;
- exact external and SessionDO trace-tree validation;
- candidate success, completed replay, forced in-progress duplicate rejection,
  changed-evidence rejection, missing-capability failure, one accepted
  token-gated read, and one SyncDO advance;
- exact 24-cell/28-sample campaign budget and alternating order;
- `deploy:gateway:dry-run`, including the self-service entrypoint, Worker
  Loader, local Durable Objects, external SyncDO, and historical mock bindings.

This is still a synthetic communication experiment. It contains no Postgres
origin, OCC validation, commit compiler, uncertain-outcome recovery, or real
sync invalidation semantics.
