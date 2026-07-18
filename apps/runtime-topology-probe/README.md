# Runtime Topology Probe

This private workspace app is an isolated Cloudflare communication and latency
probe. It does not implement Flarex transactions and is not an accepted
production runtime. The ordered experiment, boundaries, deployment controls,
and teardown requirements live in [`PLAN.md`](./PLAN.md).

## Current Slice

`P09` is complete in production. The app wraps the P02-P06 communication
shapes in durable per-cell and deployment-wide campaign coordination without
introducing a real executor, transaction, or sync engine. The current app owns:

- bearer-protected run creation, run status, and compact per-sample commands
  with bounded streaming JSON reads;
- one SQLite `ProbeRunDO` per immutable scenario/dimension cell, with atomic
  claims, opaque-token finalization fencing, exact retry idempotency, durable
  partial state, and per-cell request/payload/journal/unique-code budgets;
- server-derived warmup phase and synthetic payload, plus separate configured
  concurrency and maximum outstanding claim-lifetime observations;
- controlled sample metadata that keeps scenario-window duration outside the
  topology spans, declares the external request control-plane-inclusive, and
  separates warmup and duplicate-wake samples from eligible cohorts;
- `edge_echo` and gateway-to-`ProbeSessionDO` round-trip samples;
- a SQLite-backed `ProbeSessionDO` with untimed state controls for persistence,
  isolation, restart, and reset proofs;
- gateway trace fragments that deliberately omit the external root span;
- a collector helper that adds the true caller-measured external round trip;
- an in-memory Vite/Miniflare harness that executes the actual Worker bundle;
- an isolated Wrangler gateway configuration with its first SQLite Durable
  Object migration;
- fixed platform-owned direct Worker source loaded through Worker Loader with
  outbound networking disabled and no injected capabilities;
- stable and bounded new-code modes whose IDs include the `direct-v1` source
  profile; and
- `dynamic_direct_echo` fragments that separately record Worker Loader code
  callback execution and gateway-to-Dynamic-Worker round-trip latency;
- one platform-owned `ProbeInvocationFacet` per exact attempt, loaded from the
  SessionDO with no injected environment capability or outbound network;
- `facet_echo` and `facet_journal` traces that preserve caller-local nesting
  across gateway-to-session, session-to-facet, and facet-local SQLite work;
- a bounded synthetic journal that stores the actual payload in ordered rows,
  synchronizes storage, reads every row back, and returns a host-recomputed
  SHA-256 logical seal; and
- internal-only lifecycle controls proving warm reuse, abort-preserved facet
  storage, explicit delete/reset, restart rehydration, fresh-attempt isolation,
  and deletion of ordinary measurement facets before their response returns;
- a separate private mock Worker with restricted `MockReadEntrypoint` and
  `MockFinishEntrypoint` service-binding contracts;
- a separate private sync Worker that exclusively owns one deterministic,
  SQLite-backed `ProbeSyncDO` per synthetic scope;
- applied, duplicate, gap, and stale wake classification with exact cursor
  preservation/advance rules, reset, scope fencing, and restart persistence;
- a fixed `invoke-v1` Dynamic Worker facet that receives only `MOCK_READ`,
  keeps outbound networking disabled, writes and seals its temporary journal,
  and returns to the SessionDO before mock finish;
- `commit_wake` and `full_invoke` traces across mock read, facet journal,
  SessionDO-to-mock finish, mock-to-sync wake, and sync cursor I/O; and
- strict decoding of enumerable RPC wire fields while excluding Cloudflare's
  transport-owned `Symbol.dispose` marker from application protocol fields;
- a private `MockRerunEntrypoint` that forwards a per-call, one-shot `RpcTarget`
  through `ProbeSyncDO`, with no permanent reverse service binding;
- a gateway-local `ProbeRuntimeRerunEntrypoint` reached through `ctx.exports`
  that opens the depth-1 runtime path into a fresh SessionDO attempt facet;
- a capability-free `rerun-v1` facet with outbound networking and subrequests
  disabled, strict terminal receipts, and no second sync wake;
- an exact `external -> sync rerun -> session -> facet` trace whose successful
  receipt requires proof that the fresh facet startup callback ran; and
- cursor-preservation, same-identity normal cleanup replay, new-code isolation,
  missing-capability failure, and one-way binding-graph proofs in Miniflare.
- one fixed deployment-wide `ProbeCampaignDO` that freezes a single immutable
  matrix, exact aggregate sample/code/payload/journal budgets, and ordered
  registration, reconciliation, evidence, and purge progress;
- RunDO seal/reconcile/evidence states that classify unfinished work as
  `abandoned`, fence late finalization, and preserve terminal server fragments
  whose caller-local duration was not acknowledged;
- a checked-in 12-cell/eight-scenario matrix with 32 bounded sample executions,
  a host-neutral concurrent runner, and an atomic file checkpoint for replaying
  exact external-duration completions;
- strict raw/summary artifacts that are persisted and reread before cleanup and
  cannot carry the bearer token, claim tokens, or payload strings;
- exact request/receipt and bounded evidence-page correlation, canonical
  manifest verification, and nested sample-to-run artifact binding;
- a required persistence receipt that must match the raw, summary, manifest,
  and durable evidence seal before cleanup can begin; and
- resumable SessionDO facet cleanup, mock-to-sync cleanup, RunDO cleanup, and a
  retained campaign/session/sync tombstone proving the terminal cleanup fence.

This slice has complete local evidence, one cleaned-up eligibility failure, and
one successful production smoke. The app-local
[`P08-PRODUCTION-PREFLIGHT.md`](./P08-PRODUCTION-PREFLIGHT.md) freezes the
isolated resources, budget, corrected one-campaign smoke/measurement flow,
evidence destination, and teardown order. The first attempt was removed after
the target rejected Worker Loader as ineligible; its absence proof is in
[`P09-PRODUCTION-ATTEMPT-1.md`](./P09-PRODUCTION-ATTEMPT-1.md). After the owner
upgraded the target, all eight P09 scenarios completed and the production
campaign remained running. The sanitized result, single-sample durations,
Dynamic Worker counts, trace configuration, and retained-state boundary are in
[`P09-PRODUCTION-SMOKE.md`](./P09-PRODUCTION-SMOKE.md). `P07B` does not
make a lost JavaScript call stack resumable: it seals the run and records the
claim as `abandoned`. SessionDO cleanup explicitly deletes facet databases,
removes supervisor probe rows, and retains one exact completion/fence tombstone;
final namespace and Worker Loader code-cache teardown after the retained P10
run remains a `P11` responsibility.

All durations are caller-local monotonic round trips. The protocol never
subtracts absolute timestamps created by different isolates.

## Commands

```sh
corepack pnpm --filter @flarex/runtime-topology-probe typecheck
corepack pnpm --filter @flarex/runtime-topology-probe test
corepack pnpm --filter @flarex/runtime-topology-probe test:local
corepack pnpm --filter @flarex/runtime-topology-probe test:matrix
corepack pnpm --filter @flarex/runtime-topology-probe deploy:sync:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe deploy:mock:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe deploy:gateway:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe deploy:gateway:teardown:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe deploy:sync:teardown:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe teardown:gateway:delete:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe teardown:mock:delete:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe teardown:sync:delete:dry-run
```

The teardown commands above are local dry-runs. Their configs retain the
production Worker names but export only a binding-free `410 Gone` handler and
append the required Durable Object deletion tags. The authenticated,
destructive P11 order is intentionally documented only in
[`P08-PRODUCTION-PREFLIGHT.md`](./P08-PRODUCTION-PREFLIGHT.md); never substitute
these configs for the ordinary deployment configs during P09.

After P08 identifies the exact production target, supply the origin and bearer
secret only through environment variables. P09 runs the resumable eight-scenario
smoke without sealing or purging the singleton campaign; P10 then resumes the
same checkpoint and completes the frozen matrix:

```sh
RUNTIME_TOPOLOGY_PROBE_ORIGIN=https://probe.example.workers.dev \
RUNTIME_TOPOLOGY_PROBE_TOKEN=replace-me \
RUNTIME_TOPOLOGY_PROBE_REQUEST_TIMEOUT_MS=30000 \
corepack pnpm --filter @flarex/runtime-topology-probe probe:smoke

RUNTIME_TOPOLOGY_PROBE_ORIGIN=https://probe.example.workers.dev \
RUNTIME_TOPOLOGY_PROBE_TOKEN=replace-me \
RUNTIME_TOPOLOGY_PROBE_REQUEST_TIMEOUT_MS=30000 \
corepack pnpm --filter @flarex/runtime-topology-probe probe:run
```

Each collector request has a bounded deadline. The optional timeout defaults to
30,000 milliseconds and must be an integer from 1 through 300,000; a timeout is
reported at the originating runner stage as a retryable failure and aborts the
request signal. Response streaming remains inside that deadline and is capped
at 4 MiB before schema decoding.

The ignored `.probe-state/` checkpoint contains only caller-duration completion
records. Strict raw and summary files are written under `.probe-output/` before
purge begins. If a process stops after purge starts, verify those files and run
`probe:purge`; that command refuses to resume cleanup unless both artifacts
strictly decode and agree by digest.

If P09 must stop after creating the campaign, `probe:abort` explicitly
requires that exact campaign to exist, replays its durable external-completion
checkpoint, reconciles unfinished ordinals as partial evidence, persists and
verifies the artifacts, and runs the same bounded cleanup. Use it only for an
intentional abort; ordinary P09 success must remain `running` for P10.

## Source Layout

- `src/identity.ts` validates and derives synthetic-only identities.
- `src/protocol.ts` owns strict wire schemas and typed decode failures.
- `src/commitProtocol.ts` owns synthetic mock-read, mock-finish, sync-wake,
  cursor, and receipt contracts.
- `src/runtimeProtocol.ts` owns per-sample gateway fragments and collector
  completion plus control metadata kept outside topology spans.
- `src/runProtocol.ts` owns strict run registration, claim, finalize, status,
  budget, disposition, and controlled-sample contracts.
- `src/campaignProtocol.ts` owns the immutable deployment campaign, aggregate
  budgets, control receipts, and canonical manifest digest.
- `src/evidenceProtocol.ts` owns redacted raw/summary artifact schemas and exact
  integrity accounting.
- `src/runner.ts` owns host-neutral collection, external-duration completion,
  reconciliation, evidence sealing, and bounded purge orchestration.
- `src/dynamicProtocol.ts` owns the direct Worker wire contract and fixed
  capability-free source package.
- `src/facetProtocol.ts` owns the strict facet/session wire contracts, logical
  journal seal, and fixed capability-free facet source package.
- `src/invokeProtocol.ts` owns the `invoke-v1` facet contract, logical journal
  seal, and fixed source package with only the mock-read capability.
- `src/rerunProtocol.ts` owns depth-0 sync requests, depth-1 runtime requests,
  terminal receipts, and the capability-free `rerun-v1` facet source.
- `src/rerunGuards.ts` owns deterministic one-shot and same-sample concurrency
  fences used at the two forwarded-call boundaries.
- `src/runtimeRerunEntrypoint.ts` owns the private runtime callback and its
  one-shot forwarded RPC target.
- `src/gateway.ts` owns the protected public boundary and local hop timing.
- `src/gatewayWorker.ts` is the Workers-only adapter that creates the target
  from `ctx.exports`; the host-neutral gateway core does not import
  `cloudflare:workers`.
- `src/sessionDO.ts` owns supervisor routing, facet lifecycle, cleanup tracking,
  and isolated SQLite Durable Object control state. It never opens facet journal
  storage.
- `src/probeRunDO.ts` owns one non-production SQLite run/cell coordinator and
  never executes a probe scenario itself.
- `src/mockCommitWorker.ts` owns the only synthetic finish-to-sync wake path.
- `src/probeSyncDO.ts` and `src/syncWorker.ts` own the isolated synthetic cursor
  actor and its private deployable Worker.
- `src/trace.ts` validates completeness, parentage, cycles, and outcome
  agreement for each scenario.
- `src/statistics.ts` computes exact disposition-aware summaries without
  dropping eligible failures or mixing warmups/duplicate wakes into them.
