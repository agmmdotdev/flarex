# QSYNC-FX02 Postgres Source And Cloudflare Host Composition

## Status

**Preflight status:** accepted on 2026-09-01. FX02-A is implemented and locally
validated; its live real-Postgres receipt remains pending, so it is not marked
exited. FX02-B through FX02-D have not started.

This record accepts the ordered FX02 architecture and authorizes only the
bounded implementation slices defined below. It does not activate the existing
`DeploymentSyncDO`, add a production route or caller, select a delivery
adapter, or make the private Query Sync Engine public.

`QSYNC-FX01` is complete and supplies the private portable orchestration plus
the complete Flarex SQLite state adapter. FX02 must compose those owners with
the authoritative Postgres source and trusted query execution. It must not
create another engine, state machine, registry, cursor, publication outbox, or
Cloudflare-owned committed-data authority.

## Accepted Decision

Keep the Query Sync Engine independently developable and make Flarex its first
host composition through existing package owners:

```text
authoritative Postgres, reached through flarex-executor
  correlated scope clock + retained feed + current active head
  trusted query snapshot/result/dependency execution
                         |
                         | authenticated bounded service binding
                         v
flarex-backend DeploymentSyncDO for one named scope
  @flarex/query-sync namespace coordinators
  completed deploymentSync SQLite state adapter
  bounded catch-up, evaluation, publication, and retry turns
                         |
                         v
injected ResultPublisher port
  conformance/probe destination during FX02
  accepted delivery adapter only after QSYNC-CF01
```

The Durable Object does not import `pg`, Drizzle's Node Postgres adapter, or
own a Hyperdrive binding. The deployed executor already owns request-scoped
Postgres connections through cache-disabled Hyperdrive and the bearer-
authenticated `FLAREX_EXECUTOR` service boundary. FX02 extends that boundary
with strict internal source and evaluator contracts rather than moving
database authority into Cloudflare coordination.

Cloudflare's current
[service-binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
confirms that this Worker-to-Worker boundary is internal rather than a
publicly accessible URL. That transport isolation does not replace Flarex
bearer authentication or scope authorization.

The Flarex backend remains the Cloudflare host owner. The portable package
remains unaware of Flarex, Postgres, HTTP, Workers, Durable Objects, and the
selected delivery system.

## Commit-Grounded Basis

FX02 consumes current owners rather than reopening them:

- `f032c732` established the canonical scope-local commit feed;
- `182c5126` added the fixed-purpose fenced commit-wake outbox;
- `d82f5c91` added coherent authenticated active-head observation;
- `5f2a9e69` mapped Flarex commit, query, result, dependency, and authority
  evidence into the portable model;
- `a9b309d0` and `87a7566f` added bounded evaluation and publication
  orchestration;
- `b94abbb0` began the private Cloudflare SQLite adapter; and
- `f49c5677` completed its nine-operation generation-4 exit.

Current code also proves these negative facts:

- [`deploymentSyncDO.ts`](../../../packages/flarex-backend/src/deploymentSyncDO.ts)
  is still an empty production-inert placement shell;
- the backend Wrangler configuration binds the Durable Object but gives the
  backend no Hyperdrive/Postgres binding;
- the executor Wrangler configuration owns `HYPERDRIVE_CACHE_DISABLED`, and
  its request lifecycle already requires `FLAREX_EXECUTOR_TOKEN` before
  opening a request-scoped client;
- [`commitFeed.ts`](../../../packages/persistence-postgres/src/commitFeed.ts)
  exposes a bounded authoritative page but not the complete portable
  `ReplayableChangeSource` correlation;
- [`scopeSyncActiveHeadObservationV1.ts`](../../../packages/persistence-postgres/src/scopeSyncActiveHeadObservationV1.ts)
  observes the current head through trusted scope authority, but today it is a
  separate operation from the feed page; and
- no production `QueryEvaluator`, `ResultPublisher`, wake dispatcher,
  checkpoint mirror, lag sweep, registration caller, or target-only delivery
  path exists.

Those are the seams FX02 must compose. They are not permission to copy their
logic into a host adapter.

## Authority And Package Ownership

| Owner | FX02 responsibility | Must not own |
| --- | --- | --- |
| `@flarex/query-sync` | existing admitted source, namespace catch-up, evaluation, publication, budgets, typed outcomes | Flarex codecs, Postgres queries, HTTP, Cloudflare lifecycle, auth, delivery transport |
| `flarex-protocol` | existing versioned scope/query/dependency/authority evidence | executor HTTP status policy or database access |
| `@flarex/persistence-postgres` | one correlated source-read operation over scope clock, retained feed, and active head; later conservative checkpoint mirror | portable reducers, DO state, client registry, transport delivery |
| `@flarex/executor-http` | strict internal request/response codecs, media type, and explicit work/byte budgets | database authority or query-sync semantics |
| `apps/executor` | bearer-authenticated request host, request-scoped Postgres lifecycle, source/evaluator adapters | durable query coordination or publication state |
| `flarex-backend/deploymentSync` | existing Flarex model projection and SQLite semantic state adapter | Postgres source truth or another state machine |
| `DeploymentSyncDO` | per-scope composition, bounded event runners, durable-object lifecycle and scheduling bridge | committed app data, source order, query semantics, public client protocol |
| accepted `ResultPublisher` adapter | exact idempotent external append and correlated outcome classification | invalidation, catch-up, query state, or source recovery |

No new workspace package is justified. In particular, do not create
`query-sync-postgres`, `query-sync-cloudflare`, `query-sync-host`, or a common
transport package. Each adapter stays with the platform owner that already
owns its trust and lifecycle boundary.

## Correlated Postgres Source Boundary

### Why the existing page cannot be wrapped casually

The portable final source page carries an authority observation correlated
with the page's exact `observedLatestSequence`. Calling the current commit-feed
repository and active-head observer in two independent transactions leaves a
race between those observations. It could pair feed sequence `N` with an
active head observed after `N+1`, which is not valid clean-refresh evidence.

FX02 therefore requires one persistence-owned correlated read. Inside one
trusted repeatable-read scope transaction it must:

1. resolve the requested scope through authoritative scope metadata rather
   than treating a caller-authored UUID as authority;
2. capture the scope storage generation, fence, epoch, last commit sequence,
   and retained floor;
3. compare the requested namespace, fixed admitted model, epoch, and exclusive
   cursor before returning commit data;
4. select a contiguous bounded commit page using the existing feed
   representation and validation rules;
5. return `historyUnavailable`, `epochReplaced`, or `cursorAhead` without
   exposing an incompatible partial page; and
6. only when the page reaches the captured last sequence, observe the coherent
   active Application head in that same transaction and return the authority
   observation for that exact frontier.

This may extract transaction-local feed mechanics behind a persistence-local
helper, but the existing `CommitFeedRepositoryV1.listAfter` contract, ordering,
corruption checks, retention semantics, and callers must remain compatible.
Do not duplicate its SQL or weaken its read transaction to make the adapter
easier.

### Internal wire contract

The executor boundary receives one strict versioned source-read frame. The
request contains only bounded protocol data and budgets:

- codec version;
- scope UUID and fixed Flarex query model ID;
- requested source epoch and exclusive sequence;
- maximum committed batches, response bytes, semantic work, semantic bytes,
  dependency examinations, canonical dependency bytes, and elapsed time.

The response is exactly one of:

- a contiguous page with captured latest/retained frontiers, commits, and an
  authority observation only on the terminal page;
- `historyUnavailable` with the restart frontier;
- `epochReplaced` with the current epoch and restart frontier;
- `budgetInsufficient` for a first indivisible commit that cannot fit; or
- a typed bounded protocol, authority, corruption, resource, or timeout
  failure.

The wire codec belongs under a private `@flarex/executor-http` subpath because
it is a concrete executor/backend compatibility contract. The persistence
operation returns domain values and never imports that HTTP owner. The backend
client measures the exact body it consumed locally rather than trusting a
self-reported byte count, decodes once, maps it to the existing Flarex
`ReplayableChangeSource`, then passes it through the existing portable
admission boundary. An unconstrained generic or assertion never turns raw
response JSON into trusted source data.

The endpoint reuses the hosted executor's required bearer capability,
cache-disabled Hyperdrive request lifecycle, bounded-body mechanics, redacted
resource reporting, and strict content-type/status handling. A service binding
is an internal transport capability, not namespace authorization; Postgres
scope resolution and the named Durable Object binding remain mandatory.

## Authenticated Namespace And Query Boundary

No normal FX02 operation accepts a free-form scope, dependency, snapshot,
result digest, or authority witness from a browser and treats it as trusted.

The authority chain is:

```text
authenticated Flarex caller or commit-wake owner
  -> trusted deployment/project/scope resolution
  -> deterministic deployment-sync:{scopeUuid} object name
  -> correlated Postgres active-head observation
  -> captureDeploymentQuerySyncBinding(object id, observation)
  -> namespace-bound state/source/evaluator coordinators
```

Every Durable Object event reconstructs or reauthenticates the namespace graph
from the named object plus fresh trusted source evidence before semantic work.
In-memory objects may cache pure configuration and captured method references,
but they are not authority after constructor re-entry.

Query registration additionally requires a trusted gateway to:

1. authenticate the user/application principal;
2. resolve the effective Application active head, schema and policy revisions,
   function/component path, canonical arguments, and effective identity/access
   policy;
3. canonicalize the complete `ScopeSyncQueryKeyEvidenceV1`;
4. verify its scope/epoch/head pins against the same namespace authority; and
5. pass only the resulting trusted descriptor to `beginQuery`.

The Legacy `ConnectionDO` query-first registration, Postgres live-query
subscription tables, singleton `SchedulerDO`, timestamp freshness registry,
and partition fallback are evidence only. FX02 does not read, write, shadow,
or dual-register them.

## Trusted Query Evaluator

The current application query paths do not yet return the complete evidence
required by the portable evaluator contract. FX02 must not infer dependencies
from the Legacy `readSet`, infer freshness from a wall-clock timestamp, or
convert an ordinary query result into authoritative evaluation evidence by
assertion.

The executor-side evaluator must execute the decoded trusted query identity at
one coherent authoritative Postgres snapshot and return:

- the exact query descriptor and claimed generation;
- the actual snapshot commit sequence;
- canonical query-authority evidence for that snapshot;
- canonical bounded dependency evidence captured by the query runtime;
- one canonical Flarex result value and digest; and
- explicit resource usage and typed failure classification.

The backend maps this through the existing
`captureScopeSyncQueryEvaluationProjectionV1Result` boundary. Query execution
is outside the Durable Object SQLite transaction. Completion remains the one
atomic generation-fenced state operation, and a concurrent commit or authority
change produces refresh/rerun/resnapshot through existing portable semantics.

The first evaluator slice may add only the minimum exact dependency receipt
needed for the accepted application-query model. Any change to application
runtime receipts, query-snapshot ownership, or dependency capture requires its
own bounded implementation preflight before that slice begins. It must not be
smuggled into the source adapter.

## Durable Object Host Composition

`DeploymentSyncDO` becomes a thin host only after the source vertical passes.
Its composition is domain-first and per object:

```text
trusted source client + Flarex projector
  + deploymentSync SQLite state
  + trusted evaluator client
  + injected ResultPublisher
  + bounded policies
  -> makeNamespaceQuerySync(...)
  -> makeNamespacePublicationSync(...)
```

The namespace state, source, evaluator, publisher, and coordinators are dynamic
multi-instance values. They are not module singletons or singleton Context
services. Application-scoped configuration/client factories may use Layers;
the Durable Object instance constructs its namespace-bound graph from those
factories. Effect runners exist only at real Worker, Durable Object RPC/fetch,
alarm, scheduled, queue, or test-host callbacks.

Each event runs bounded turns. A wake is only permission to inspect the source;
it never supplies committed changes and never advances a cursor. Catch-up,
evaluation selection, evaluator calls, publication claims, and publisher calls
remain separate Effects with no transaction handle crossing an external call.

Returned continuation evidence may schedule another bounded event. Recovery
must be able to rescan durable pending evaluation/publication state from the
start, so an in-memory continuation, promise, fiber, mutex, or timer is never
the only recovery record. Startup may gate storage-contract readiness, but a
Layer or constructor must not execute semantic work as a side effect.

FX02 does not add a public `fetch` surface. Internal RPC/fetch commands must be
strict, bounded, bearer/service-binding protected where they cross Workers,
and revalidated against the named scope. Public registration and client
delivery remain FX03 work.

## Wake, Sweep, And Checkpoint Ownership

The existing `deployment_sync_commit_wake_v1` row is a durable at-least-once
latency hint correlated with the authoritative commit. Its dispatcher may
claim the row, call the deterministic Durable Object, and settle delivery. It
does not carry source payloads and its delivery order never becomes commit
order.

FX02 must also prove recovery when direct wake delivery is absent. A later
FX02 slice may add one Postgres checkpoint mirror and external lag sweep under
these rules:

- the Durable Object SQLite cursor is the coordination cursor authority;
- the mirror is advanced only after the corresponding local cursor commit;
- a fence prevents an older object generation or stale writer from advancing
  it;
- the mirror may lag and cause duplicate wakes, but must never lead;
- it stores no query definitions, dependencies, generations, subscribers, or
  publication state; and
- absence or disagreement is not authority to silently reinitialize an empty
  Durable Object.

Production fresh-initialization minting remains deferred to FX03's durable
first-use/reset authority, as already frozen by FX01. FX02 probes may use an
explicit isolated one-use external authorization, but constructor re-entry,
empty SQLite, eviction, restart, or a missing mirror never proves freshness.

## Semantic Publication-Outbox Processing

FX01 already durably records, claims, settles, and completes the query-result
publication lifecycle. FX02 composes that existing state with an injected
`ResultPublisher`; it does not create a Postgres publication table or reuse the
application commit outbox as a query-result outbox.

Before `QSYNC-CF01` selects a real delivery adapter, FX02 publication evidence
uses the existing conformance publisher or a deployed probe destination with
the exact same `ResultPublisher` contract. This can prove host recovery,
outcome-unknown retry, terminal refusal, stale outcome, and exact completion,
but it is not production delivery.

Whichever delivery adapter is later accepted must preserve the immutable
publication identity and payload already stored in SQLite. Transport offsets,
acknowledgements, retries, and reconnect positions remain downstream and can
never replace the Postgres source cursor or repair a lost invalidation wake.

## Cloudflare Lifecycle Evidence

The sync actor does not accept WebSockets; `ConnectionDO` owns that client
transport. Cloudflare's WebSocket Hibernation API is therefore not an FX02
`DeploymentSyncDO` feature or exit claim.

FX02 must prove the lifecycle behavior that actually applies to this actor:

- real deployed SQLite-backed Durable Object storage;
- constructor re-entry and cold instance recreation after a deployment restart
  or an observed platform eviction;
- no semantic dependency on in-memory continuations, fibers, or caches;
- persisted catch-up/evaluation/publication recovery after recreation; and
- isolation between at least two named scope objects.

Cloudflare documents that
[inactive Durable Objects can be evicted and important state must use durable
storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).
It does not expose a deterministic production eviction command. The exit
evidence must therefore state the exact event observed. A controlled deployment
restart plus a new boot receipt and preserved SQLite state is valid deployed
restart evidence; it must not be relabeled as a forced eviction. An
opportunistically observed eviction may be reported separately. Cloudflare's
[WebSocket guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
ties the Hibernation API to a Durable Object acting as a WebSocket server, so
that proof remains a later `ConnectionDO`/delivery concern.

## Ordered FX02 Slices

### FX02-A — Correlated Postgres source vertical

Implement the private internal wire codec, persistence-owned correlated source
read, executor host, backend client, Flarex source mapping, and focused
PGlite/real-Postgres plus client-boundary proofs. Do not touch
`DeploymentSyncDO`, query execution, wake dispatch, checkpoint storage, or
publication delivery in this slice.

### FX02-B — Private catch-up host

Compose the admitted source, Flarex projector, existing SQLite state, and
portable catch-up coordinator inside a production-inert `DeploymentSyncDO`
host. Prove contiguous duplicate/reverse/gap/history-reset/epoch behavior,
two-scope isolation, bounded continuation, lost-response replay, and local plus
deployed restart recovery. Keep all outer callers probe-only.

### FX02-C — Authenticated registration and evaluation/rerun

After the application-query evidence receipt has its own accepted bounded
preflight, add trusted canonical registration and evaluator composition. Prove
the initial activation race, commit-during-evaluation, generation fencing,
single-flight rerun coalescing, unchanged-result suppression, authority drift,
and recovery after recreation.

### FX02-D — Wake recovery and semantic publication processing

Compose the existing commit-wake dispatcher, conservative fenced checkpoint
mirror and lag sweep, plus publication work through an injected accepted
publisher port. Before CF01 this remains conformance/probe-only. Prove lost
direct wake, expired wake claim, lagging mirror, duplicate wake, publisher
outcome uncertainty, terminal refusal, retry, and exact completion.

FX02 completes only after all four slices pass. Each slice is committed and
reviewed independently; one slice does not authorize the next slice's code.

## First Medium Implementation Slice

The first approved implementation slice is `QSYNC-FX02-A`. It is deliberately
medium-sized and end to end across the existing adapter boundary:

1. one strict versioned executor/backend source-read codec with explicit
   count, byte, semantic, and elapsed budgets;
2. one persistence-owned correlated scope/feed/head read that reuses current
   commit-feed validation and preserves its public internal API;
3. one bearer-authenticated executor host over its existing request-scoped
   Postgres lifecycle;
4. one backend service-binding client and Flarex `ReplayableChangeSource`
   adapter ending at the existing portable admission boundary; and
5. focused codec, PGlite, authenticated real-Postgres, host/client fault,
   max/plus-one, and exact error-mapping tests.

The slice exits with no Durable Object behavior, no new persistence schema, no
query evaluator, no publisher, and no production caller. If the correlated
read requires changing commit-feed semantics rather than extracting exact
transaction-local mechanics, stop and record that owner defect before editing
the feed.

## FX02 Exit Matrix

| Proof family | Required evidence |
| --- | --- |
| authority | caller, deployment/project, stored scope, named object, epoch, storage generation/fence, active head, model, and query pins fail closed independently |
| source | correlated final authority, duplicate/reverse/gap, cursor ahead, retained-floor reset, epoch replacement, page continuation, exact budgets, and corruption |
| host | bounded turns, no external call inside SQLite transaction, replay after lost response, two-scope isolation, no process-local recovery authority |
| evaluator | exact snapshot/dependency/result/authority evidence, activation race, commit during evaluation, stale completion, rerun coalescing, unchanged suppression |
| wake recovery | direct hint, lost hint, duplicate hint, expired claim, durable sweep, mirror lag allowed, mirror lead impossible |
| publication | pending claim, known-not-appended, outcome unknown, terminal refusal, retry, stale settlement, exact completion after restart |
| lifecycle | local Workerd plus real deployed restart/cold re-instantiation with exact labeling; no WebSocket-hibernation claim for the sync actor |
| isolation | different scopes, epochs, projects/principals, queries, and publication destinations cannot cross-read or cross-write |
| compatibility | prototype Postgres registry, SchedulerDO, PartitionDO fallback, timestamp freshness, commit owners, and existing feed callers remain untouched |
| activation | no public export, client API, production route/caller, delivery cutover, Legacy removal, or R03-B claim |

## Explicitly Not Authorized

This preflight does not authorize:

- changes to portable query-sync models, planners, reducers, state operations,
  limits, accounting, or orchestration;
- changes to commit compilation/execution, OCC, transaction journals,
  idempotency outcomes, authoritative application rows, commit/change facts,
  retention semantics, or the application outbox;
- a new engine, package, registry, actor, cursor authority, publication outbox,
  dual write, shadow comparison, fallback, silent repair, or migration from the
  unshipped prototype registry;
- a production fresh-initialization mint, destructive state reset, query
  release/expiry transition, reconnect lease, or client retention policy;
- a Durable Streams, Electric, DeliveryDO, WebSocket, SSE, queue, client SDK,
  or public `ResultPublisher` selection;
- public `DeploymentSyncDO` fetch/RPC, production routing, a live caller switch,
  Legacy removal, `QSYNC-FX03`, `QSYNC-CF01`, `R03-B`, `SV-R Live`, product
  parity, production readiness, or runtime-portability claims; or
- calling a controlled restart, Miniflare disposal, or constructor re-entry a
  forced Cloudflare eviction or WebSocket hibernation.

## Accepted Checkpoint

Accepted on 2026-09-01 with these decisions:

1. Postgres stays behind the existing authenticated executor/Hyperdrive owner;
2. the final source page and active-head authority are captured in one
   persistence-owned correlated transaction;
3. `DeploymentSyncDO` remains a thin per-scope host over the completed portable
   and SQLite owners;
4. query registration/evaluation, wake recovery/checkpointing, and publication
   processing remain distinct implementation slices;
5. FX02 uses an injected conformance/probe publisher until CF01 selects the
   production delivery adapter;
6. production fresh initialization remains FX03-gated; and
7. deployed restart/cold-recreation evidence replaces the inaccurate demand
   for a forced WebSocket-hibernation proof on the non-WebSocket sync actor.

## FX02-A Implementation Checkpoint — 2026-09-01

The approved FX02-A code vertical is implemented and remains private. It adds:

- the strict canonical `query-sync-source-read-v1` request/response codec and
  count, source-byte, semantic, dependency, and elapsed budgets;
- a persistence-owned repeatable-read, read-only correlated scope-clock,
  retained-feed, and terminal active-head observation that reuses the existing
  commit-feed validation through transaction-local mechanics;
- a request-scoped Postgres-client adapter that does not expose Drizzle through
  the runtime-persistence facade;
- an authenticated executor route and a service-binding backend
  `ReplayableChangeSource` adapter ending at `makeAdmittedChangeSource`; and
- focused codec, PGlite, host, request-lifecycle authentication, backend-client,
  exact response-byte, reset, cursor, epoch, and fault-mapping tests.

The PGlite correlated source proof and all focused host/client tests pass. The
real-Postgres correlated test is checked in and skips when
`FLAREX_POSTGRES_DATABASE_URL` is absent; this machine had no configured real
Postgres lane, so FX02-A's live real-Postgres receipt remains pending and the
slice is not marked exited. `CommitFeedRepositoryV1.listAfter` remains intact,
and its existing PGlite regression suite passes.

The next gate is the real-Postgres FX02-A receipt and review closure. FX02-B is
not authorized by this checkpoint. FX02 remains incomplete, and no Durable
Object behavior, evaluator, publisher, schema, public/client API, production
caller, delivery selection, or activation was added.
