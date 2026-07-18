# P12 SessionDO-Hosted Mock Executor A/B Preflight

Status: approved on 2026-07-18; implementation in progress.

## Decision Boundary

This is a new isolated experiment under `apps/runtime-topology-probe`. It does
not change the active FlarexDB roadmap, route production Flarex traffic, or
promote Durable Object SQLite into committed-data authority.

The experiment compares two matched synthetic invocation paths:

```text
external-worker control
  gateway -> SessionDO -> Dynamic Worker facet
          -> attempt-scoped read capability in the mock Worker
          -> facet journal -> SessionDO -> mock Worker finish -> SyncDO

session-executor candidate
  gateway -> SessionDO -> Dynamic Worker facet
          -> token-gated parent Worker entrypoint -> SessionDO-owned read
          -> facet journal -> SessionDO mock finish -> SyncDO
```

The candidate moves only the trusted synthetic read/finish adapter into the
per-invocation SessionDO. Postgres, OCC, the real commit compiler, authoritative
outcomes, and real sync semantics remain explicit non-goals.

## Accepted Invariants

- One server-derived SessionDO identity represents one logical invocation in
  the comparison matrix.
- One exact attempt fence and one attempt-scoped Dynamic Worker runtime are
  used per sample. A request-specific capability is never retained in a shared
  cached Worker environment.
- The Dynamic Worker receives only one narrow read capability. It receives no
  supervisor storage, SyncDO namespace, SQL, Hyperdrive, credentials, or global
  outbound network.
- The SessionDO persists an explicit synthetic attempt state machine so an
  interleaved duplicate cannot perform a second finish or sync wake merely
  because external I/O opened the Durable Object input gate.
- Exact completed replays return the stored synthetic receipt. Changed
  evidence or a different attempt fails closed. An in-progress duplicate
  receives `busy`; local proof covers both an unbarriered serialized replay and
  a forced in-progress rejection.
- Facet SQLite remains a temporary logical journal and is deleted after the
  attempt. SessionDO state remains non-authoritative probe bookkeeping and is
  purged before deployment teardown.
- The control and candidate use the same code source, attempt-scoped loader
  identity rule, payload, journal size, request order, and SyncDO implementation.

## Challenged Alternatives

Moving the real executor is premature. The active replacement path still has
runtime-neutral rerun, known-settled SQL retry, uncertain-outcome recovery,
finish orchestration, and the first end-to-end correctness gate pending. The
authenticated Cloudflare account also has no Hyperdrive configuration and the
workspace has no production Postgres origin input. A mock result must not be
reported as a real Postgres commit result.

Reusing the existing stable Dynamic Worker cache entry with a per-request RPC
target was rejected because the loader callback may not rerun. That could bind
a later attempt to a stale session capability. Both comparison arms therefore
use an internal attempt-scoped loader key even though their logical code package
is identical.

Relying only on Durable Object single-threading was rejected. Exact request
evidence and a persisted phase transition protect the synthetic finish even if
a future scheduling shape interleaves work. The local runtime serialized an
unbarriered pair, while a delayed-read barrier proved the `busy` branch before
one completion and one later replay.

Passing a newly constructed SessionDO `RpcTarget` directly into Worker Loader
was also rejected by runtime evidence. Cloudflare custom Dynamic Worker
bindings require a Worker entrypoint stub. The supported candidate uses a
self-bound gateway entrypoint as a transport-only bridge and an opaque
attempt-specific token; the SessionDO remains the read, state, and finish
authority.

## Predeclared Production Matrix

- two paired scenarios: external-Worker control and SessionDO candidate;
- 12 eligible measurements per arm plus bounded excluded warmups;
- concurrency one, new SessionDO per sample, identical 64-byte payload and two
  journal entries;
- alternating control/candidate run order;
- complete internal span trees, startup observations, exact capability-call
  evidence, sync disposition, and external caller duration;
- zero accepted scenario failures, missing durations, abandoned claims, or
  duplicate-wake exclusions.

The candidate is materially faster only if the paired internal
`gateway_session_rtt` median improves by at least 20 percent and candidate p95
does not regress. With the small bounded sample, all percentiles remain
descriptive rather than production service-level objectives.

## Spend And External-State Boundary

The authenticated target is the previously approved single Cloudflare account.
The standing incremental spend ceiling is USD 2. The expected Dynamic Worker
subtotal is below USD 0.10; stop before deployment expansion or any forecast
that could cross the ceiling.

Deploy only the historical isolated gateway, mock, and sync Worker names. Rotate
the bearer secret, run one immutable campaign, persist sanitized evidence,
purge all application state, apply the checked-in deleted-class migrations,
delete all three scripts, and prove exact script/namespace absence.

## Completion Proof

P13 must pass strict protocol/type tests, Miniflare behavior and interleaving
tests, full app tests, typecheck, Wrangler dry-runs, and both required project
reviewers. P14 owns the bounded production A/B evidence. P15 owns conclusions,
the no-Postgres limitation, cost receipt, purge, remote absence proof, and the
app-only commit.
