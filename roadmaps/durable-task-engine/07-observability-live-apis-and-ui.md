# Roadmap 07: Observability, Live APIs, And UI Reuse

## Status And Decision Boundary

**Status:** Architecture roadmap with DTE07-B1/B2/B3/B4,
DTE07-C1/C2/C3/C4/C5/C6/C7/C8/C9/C10/C11/C12/C13/C14/C15, and DTE07-D1 implemented privately
through 2026-08-30.
DTE07-B1 implements one
production-inert run projection and pure projector under
[`preflight/51-dte07-private-run-projection.md`](./preflight/51-dte07-private-run-projection.md).
DTE07-C1 implements the point-query service and clean `inspectTask(run)`
operation fixed by
[`preflight/52-dte07-private-task-run-query.md`](./preflight/52-dte07-private-task-run-query.md).
DTE07-C2 implements the private result-read authorization, body query, and
Standard composition bridge fixed by
[`preflight/53-dte07-private-task-result-body-query.md`](./preflight/53-dte07-private-task-result-body-query.md).
DTE07-C3 implements the clean immediate `readTaskResult(run)` output-contract
gate fixed by
[`preflight/54-dte07-clean-task-result-contract.md`](./preflight/54-dte07-clean-task-result-contract.md).
DTE07-C4 implements the clean deadline-controlled `awaitTask(run, options)`
operation fixed by
[`preflight/55-dte07-clean-task-await-contract.md`](./preflight/55-dte07-clean-task-await-contract.md).
DTE07-C5 implements the private scope-captured Task cancellation command
adapter fixed by
[`preflight/56-dte07-private-task-cancellation-command.md`](./preflight/56-dte07-private-task-cancellation-command.md).
DTE07-C6 implements the clean `cancelTask(run, options)` contract fixed by
[`preflight/57-dte07-clean-task-cancellation-contract.md`](./preflight/57-dte07-clean-task-cancellation-contract.md).
DTE07-B2/C7 define the production-inert bounded Task run-list contract and
private Standard query bridge fixed by
[`preflight/58-dte07-private-task-run-list-query.md`](./preflight/58-dte07-private-task-run-list-query.md).
DTE07-C8 implements the located PostgreSQL/PGlite list store fixed by
[`preflight/59-dte07-located-task-run-list-store.md`](./preflight/59-dte07-located-task-run-list-store.md).
DTE07-C9 implements the clean unversioned `listTaskRuns()` facade fixed by
[`preflight/60-dte07-clean-task-run-list-contract.md`](./preflight/60-dte07-clean-task-run-list-contract.md).
DTE07-C10 implements the listed read-only `TaskRunRef` fixed by
[`preflight/61-dte07-listed-task-run-reference.md`](./preflight/61-dte07-listed-task-run-reference.md).
DTE07-B3/C11/C12/C13 implement immutable attempt-admission projection,
scope-captured query composition, the located store, and clean
`listTaskAttempts(ref)` facade fixed by
[`preflight/62-dte07-task-attempt-history.md`](./preflight/62-dte07-task-attempt-history.md).
Its PGlite proof is complete; the checked-in real PostgreSQL lane remains
unexecuted until `FLAREX_POSTGRES_DATABASE_URL` is available.
DTE07-B4/C14 implement the bounded durable lifecycle-event projection,
central read composition, located store, and clean `listTaskEvents(ref)` facade
fixed by
[`preflight/63-dte07-task-lifecycle-event-history.md`](./preflight/63-dte07-task-lifecycle-event-history.md).
Its PGlite proof is complete; the checked-in real PostgreSQL lane remains
unexecuted until `FLAREX_POSTGRES_DATABASE_URL` is available.
DTE07-C15 closes list-reference scope composition by making the central read
Layer the only live list-service factory and binding list, point, attempt, and
event reads to one authenticated store, as fixed by
[`preflight/64-dte07-task-read-scope-binding.md`](./preflight/64-dte07-task-read-scope-binding.md).
DTE07-D1 selects the persisted `notify_current_state` intent as the existing-
run advancement source fact and implements only the bounded pure refetch policy fixed by
[`preflight/65-dte07-task-read-invalidation-policy.md`](./preflight/65-dte07-task-read-invalidation-policy.md).
It does not authorize other commands, provider delivery, cancellation waiting,
a public list contract, public routes, deployment, subscriptions,
telemetry ingestion, retention/GC, or UI publication.

DTE06-E5 and DTE06-F0A/F0B/F1/F2 are complete privately, including connected
execution and fresh-host takeover in PGlite and ordinary-role PostgreSQL.
DTE06-F3/F4 remain prerequisites for a real hosted Cloudflare claim. Roadmap 07
may define private read contracts before those gates close, but projections,
notifications, and dashboards must never become more authoritative than the
Task System.

The accepted direction is:

1. Flarex owns the canonical observability and command APIs;
2. Trigger.dev UI behavior and selected presentation code are reuse inputs;
3. Trigger API compatibility is optional and belongs in a thin facade, not in
   Flarex durable state or identity; and
4. no claim that the APIs are already the same is admitted.

## Verified Source Baseline

The frozen Trigger compatibility island is pinned by
[`third_party/trigger.dev/SOURCE.json`](../../third_party/trigger.dev/SOURCE.json)
to commit `f10bc23785e569e5d917318cf2033aabdbe96a0b`. Its
[`README.md`](../../third_party/trigger.dev/README.md) deliberately excludes
Trigger's web application, dashboard, SDK, CLI, bundler, and user runtime
entrypoints. The local island therefore proves run-engine and selected runtime
behavior, but it does not prove dashboard or public-API reuse.

This audit inspected matching files directly at the pinned upstream commit.
Those paths are evidence only; they are not active Flarex dependencies and
have not been imported into the workspace.

## Goal

Deliver a scope-authorized observability surface that lets a web application:

- list durable task runs with stable pagination and filters;
- inspect one run, its attempts, lifecycle events, result commitment, and safe
  failure projection;
- observe bounded live advancement without making the live channel authority;
- inspect traces, spans, and logs through separately owned stores;
- consume user-defined output streams independently from run-state changes;
- submit explicitly authorized commands such as cancellation; and
- reuse or adapt Trigger-derived UI behavior without importing Trigger product
  identity, Prisma types, Redis/Electric authority, or management APIs.

## Authority And Data Lanes

Roadmap 07 keeps five lanes distinct:

| Lane | Authority | First consumer contract |
| --- | --- | --- |
| Durable run state | Flarex Task System and PostgreSQL transactions | Scope-authorized run/attempt/event query projections |
| Commands | Existing fenced lifecycle and task capabilities | Operation-specific cancellation or later admitted commands |
| Live notification | Commit/feed/outbox-derived advancement only | Bounded invalidation, version, or cursor followed by refetch |
| Trace, log, metrics | Separately admitted observability stores | Bounded queries with redaction and retention |
| User output streams | Stream/object owner | Ordered records with independent authorization and backpressure |

Notification loss may delay refresh but may not lose durable state. Realtime
delivery never performs a Task transition and never proves that a transition
committed. A UI refetches the authoritative query projection after reconnect,
cursor gaps, or invalidation loss.

Large result bodies, logs, traces, metrics, and stream records do not belong in
Task System rows. Task rows retain only exact commitments and bounded metadata
admitted by their owners.

## Trigger.dev Frontend And API Reuse Audit

### Presentation Components

| Pinned Trigger source | Finding | Flarex decision |
| --- | --- | --- |
| [`RunTimeline.tsx`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/apps/webapp/app/components/run/RunTimeline.tsx) | Accepts a relatively narrow timestamp/status view model, but imports Trigger duration utilities, local primitives, and timeline-event semantics. | **Adapt.** Preserve visual interaction and pure timeline construction after defining a Flarex view model. |
| [`TaskRunStatus.tsx`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/apps/webapp/app/components/runs/v3/TaskRunStatus.tsx) | Directly depends on Trigger database status enums, friendly-status policy, deployment states, and documentation links. | **Reproduce behavior, not the status contract.** Map Flarex run/attempt projections exhaustively to Flarex display states. |
| [`TaskRunsTable.tsx`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/apps/webapp/app/components/runs/v3/TaskRunsTable.tsx) | Deeply coupled to Remix, Trigger presenters, organization/project/environment hooks, managed-cloud features, regions, machines, billing/cost, and Trigger command dialogs. | **Reuse layout and interaction ideas only.** Split useful cells or primitives behind Flarex view models. |
| [`RunTimeline` Storybook route](https://github.com/triggerdotdev/trigger.dev/tree/f10bc23785e569e5d917318cf2033aabdbe96a0b/apps/webapp/app/routes/storybook.run-and-span-timeline) | Provides isolated visual behavior separate from the dashboard route. | **Use as visual evidence** only after an approved source-import and provenance decision. |

### Read And Live-Update Logic

| Pinned Trigger source | Finding | Flarex decision |
| --- | --- | --- |
| [`mapRunToLiveFields.server.ts`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/apps/webapp/app/presenters/v3/mapRunToLiveFields.server.ts) | Projects a small status/timestamp/cancellability/cost record. | **Adapt the projection pattern.** Flarex fields come from its aggregate; cost is absent until separately admitted. |
| [`useRunsLiveReload.ts`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/apps/webapp/app/routes/_app.orgs.%24organizationSlug.projects.%24projectParam.env.%24envParam.runs._index/useRunsLiveReload.ts) | Combines polling, pagination awareness, incremental fields, and new-run detection, but is coupled to Remix fetchers and Trigger presenter types. | **Adapt reconnect/refetch behavior.** Consume Flarex cursor/version advancement and refetch Flarex projections. |
| [`RunStreamPresenter.server.ts`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/apps/webapp/app/presenters/v3/RunStreamPresenter.server.ts) | Couples SSE to Trigger sessions, Prisma membership, run-store residency, mollifier fallback, trace pub/sub, and logging. It contains useful abort, throttling, cleanup, and authorization lessons. | **Discard the adapter; preserve failure scenarios.** Flarex live delivery originates from its own feed/outbox and scope authority. |
| [`realtime.v1.runs.$runId.ts`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/apps/webapp/app/routes/realtime.v1.runs.%24runId.ts) | Uses Trigger environment authentication, RBAC resources, run-store reads, primary fallback, and selectable Electric/native realtime. | **Do not adopt as canonical API.** Primary fallback, abort, and not-found behavior remain scenarios to evaluate. |

### React Hooks

| Pinned Trigger source | Finding | Flarex decision |
| --- | --- | --- |
| [`useRun.ts`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/packages/react-hooks/src/hooks/useRun.ts) | Thin SWR wrapper around Trigger `ApiClient.retrieveRun`, stopping refresh after Trigger completion. | **Adapt after the Flarex query contract.** The hook shape is reusable; client, types, completion, auth, and retry policy are not. |
| [`useRealtime.ts`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/packages/react-hooks/src/hooks/useRealtime.ts) | Owns abort, throttled state, completion callbacks, subscriptions, and combined stream consumption, but is typed around Trigger clients and models. | **Reuse behavioral tests and interaction design.** Keep run invalidations separate from output streams even if one hook composes both. |
| [`useApiClient.ts`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/packages/react-hooks/src/hooks/useApiClient.ts) | Constructs a Trigger client from Trigger auth context, access token, preview branch, and base URL. | **Discard.** Replace with a Flarex scope-authorized client/capability. |

### Trace And Public API Routes

| Pinned Trigger source | Finding | Flarex decision |
| --- | --- | --- |
| [`api.v1.runs.$runId.trace.ts`](https://github.com/triggerdotdev/trigger.dev/blob/f10bc23785e569e5d917318cf2033aabdbe96a0b/apps/webapp/app/routes/api.v1.runs.%24runId.trace.ts) | Resolves Trigger run/environment identity, RBAC, event-store placement, trace tables, replica behavior, and a Trigger-specific buffered trace. | **Use as scenario inventory.** Flarex trace ownership, authorization, storage, redaction, and cursor contracts need their own preflight. |
| Trigger run/cancel/replay/result/realtime route family | Exposes useful capability inventory but mixes commands, reads, streams, Trigger identity, and deployment policy. | **Classify route by route before any facade.** Names and response shapes are not automatic obligations. |

## Canonical Flarex API Direction

The first API is private and host-neutral. Exact wire versions are introduced
only when a concrete encoded contract must coexist or be decoded. Capability
and service names remain unversioned.

### Query APIs

The private query owner should eventually expose bounded operations equivalent
to:

- list runs under one trusted scope with stable cursor pagination;
- read one run aggregate projection;
- list attempts and lifecycle events for that run;
- read committed result metadata and, through separate authorization, its body;
- read trace/span/log projections from their owner; and
- report projection version/cursor evidence needed for safe refetch.

These operations return explicit Flarex view models. They do not return Drizzle
rows, Trigger Prisma payloads, Trigger status enums, internal transaction
receipts, raw exceptions, runtime capabilities, or unredacted task inputs.

### Command APIs

Commands remain separate from queries. The first candidate is exact
cancellation through the existing generation-correlated lifecycle. Replay,
retry, reschedule, or bulk commands require their own lifecycle and
authorization decisions; a Trigger dashboard control is not authority to add
one.

### Live APIs

The preferred initial contract is a bounded notification carrying only trusted
scope/run identity plus monotonic projection version or cursor. The client
refetches the query projection. A full snapshot may be delivered later only if
the same projection owner preserves cursor and authorization semantics.

Reconnect must handle:

- duplicate, reordered, delayed, and missing notifications;
- cursor expiry or compaction;
- authorization removal during an open connection;
- run completion racing with disconnect;
- page filters while new runs arrive;
- client abort and server cleanup; and
- primary-committed state not yet visible through replica-backed reads.

### Output Streams

User streams such as AI tokens have their own ordered record identity,
retention, limits, authorization, backpressure, resume cursor, and close
semantics. A React hook may compose run updates and stream records, but their
storage and transport remain separate from lifecycle transitions.

## UI Package Boundary

Reusable UI depends on Flarex presentation contracts rather than server or
persistence packages:

```text
Flarex task dashboard components
        -> Flarex observability client/hooks
             -> query transport
             -> command transport
             -> live invalidation transport
             -> trace/log transport
             -> output stream transport
                  -> separately owned backend capabilities
```

Preferred extraction order:

1. pure display-state and timeline view models;
2. status, timeline, duration, attempt, and trace components;
3. query hooks over an injected Flarex client;
4. live refetch/reconnect hooks;
5. output-stream hooks; and
6. route composition, navigation, and command dialogs.

Do not import server presenters into browser components. Do not make component
props carry database rows or Trigger product identity merely to reuse a table.

## Optional Trigger-Compatible Facade

A compatibility facade is permitted only after native Flarex contracts are
implemented and measured. It may be worthwhile when adapting a large,
well-isolated Trigger UI surface costs more than translating its bounded
request/response contract.

The facade must:

- translate from Flarex-owned projections and commands;
- authenticate through Flarex tenant/scope capabilities;
- remain presentation-only and non-authoritative;
- expose only an audited subset of Trigger routes;
- document omitted or semantically different fields;
- add no Prisma schema, Trigger identity, Redis/Electric authority, fallback
  execution, or duplicate lifecycle; and
- be removable without changing durable state.

Before admission, compare exact routes, methods, authentication, statuses,
errors, run/attempt semantics, timestamps, cursors, filters, ordering, command
idempotency, realtime reconnect, trace/log/result shapes, redaction, frontend
dependencies, styling, assets, and license/provenance cost. API spelling
similarity alone is not evidence.

## Ordered Work

### DTE07-A: Exact Source And Capability Inventory — Architecture Record Complete

- acquire or inspect pinned webapp and React-hook sources under an approved
  read-only or selective-import boundary;
- map run list, run detail, attempts, timeline, trace/log, realtime, streams,
  cancel, replay, and result display;
- classify each source as reuse unchanged, adapt, reproduce, or discard; and
- verify license/provenance before copying code or assets.

This document completes only an architecture-level inventory. It is not an
implementation receipt and does not admit source copying.

### DTE07-B: Private Projection Contracts — B4 Implemented

- define scope-authorized run, attempt, event, result-metadata, and cursor view
  models;
- prove stable ordering, bounds, pagination, ownership, and redaction;
- keep SQL and driver rows behind persistence adapters; and
- remain private and production-inert.

DTE07-B1 implements only the single-run projection fixed by preflight 51.
Attempt history, events, broader result reads, and every live contract remain
later bounded checkpoints.

DTE07-B2 defines the bounded newest-first list page, concrete internal keyset
cursor with canonical-ASCII run-ID ordering, captured compact list-store
contract, domain-owned item decoding, safe page validation, and reuse of the
existing point projection owner fixed by preflight 58. It adds no persistence
adapter, filter, clean facade, or public cursor encoding.

DTE07-B3 defines only bounded immutable attempt-admission history fixed by
preflight 62. It exposes attempt identity, ordinal, and admitting run version;
historical attempt state remains unavailable.

DTE07-B4 defines the complete bounded durable lifecycle-event timeline fixed by
preflight 63. It exposes only the already-redacted lifecycle projection and its
immutable recording coordinates; internal requested effects remain private.

### DTE07-C: Private Query And Command Adapters — C14 Implemented

- implement private HTTP-agnostic query capabilities;
- compose exact cancellation through the admitted lifecycle;
- keep result-body, trace/log, and output-stream owners separate; and
- prove alternate identifiers cannot bypass authorization.

DTE07-C1 implements only the scope-bound single-run query service and clean
`inspectTask(run)` operation fixed by preflight 52. Commands and every broader
read remain separate checkpoints.

DTE07-C2 implements only the separately authorized result-body query fixed by
preflight 53. It adds no clean root operation, waiting, output decoding, or
result polling.

DTE07-C3 implements only the clean immediate `readTaskResult(run)` operation
and local output-contract binding fixed by preflight 54.

DTE07-C4 implements only the clean deadline-controlled
`awaitTask(run, options)` operation, fixed incomplete-status polling,
cooperative timeout handling, and terminal-failure projection fixed by
preflight 55. Query/result failures are not retried, and commands remain
separate.

DTE07-C5 implements only the private scope-captured cancellation command
service fixed by preflight 56. It delegates one exact lifecycle transaction,
preserves its receipt and typed failure, and adds no clean `cancelTask()`
operation, provider call, route, or production activation.

DTE07-C6 implements only the clean authenticated `cancelTask(run, options)`
operation fixed by preflight 57. It validates one optional safe reason, submits
one private command, and projects the receipt without exposing lifecycle or
provider internals. It does not wait for execution to stop.

DTE07-C7 implements only the private Standard Application Task run-list query
bridge fixed by preflight 58.

DTE07-C8 implements only the captured-authority PostgreSQL/PGlite list store
fixed by preflight 59. It uses compact JSONB projection, database observation
time, exact C-collated keyset order, and a dedicated partial index. Its PGlite
and disposable PostgreSQL 18 proofs are accepted.

DTE07-C9 implements only the clean unversioned `listTaskRuns()` operation fixed
by preflight 60. It owns a default page size, a process-local opaque cursor,
clean option failures, and clean page naming over the existing private query.
It adds no serializable cursor or public route.

DTE07-C10 implements only the read-only process-local `TaskRunRef` fixed by
preflight 61. The clean list issues it and `inspectTask()` accepts it, while
result reads, waiting, and cancellation remain restricted to an admitted typed
`TaskRun<Output>`.

DTE07-C11/C12/C13 implement only the scope-captured attempt-history bridge,
located PostgreSQL/PGlite store, and clean `listTaskAttempts(ref)` facade fixed
by preflight 62. PGlite proves the connected store; real PostgreSQL acceptance
remains pending its configured test lane.

DTE07-C14 implements the central point/attempt/event read composition, located
lifecycle ledger projection, and clean `listTaskEvents(ref)` facade fixed by
preflight 63. PGlite proves the connected store; real PostgreSQL acceptance
remains pending its configured test lane.

DTE07-C15 implements only the Task read scope-binding correction fixed by
preflight 64. The central authenticated read Layer now owns the live list,
point, attempt, and event service bundle, and listed references capture that
bundle's point-query capability without a separately supplied service.

### DTE07-D: Live Invalidation And Reconnect

- choose an admitted feed/outbox/change source;
- define bounded cursor/version notifications;
- prove duplicate/loss/reorder/reconnect behavior; and
- add no transition authority to live transport.

DTE07-D1 selects the transactionally persisted `notify_current_state` effect
as the existing-run advancement source and implements only an in-process run-
version or refresh-required signal plus pure point/list refetch policy. Initial
run creation has no matching effect, so a run-admission source remains
unselected. DTE07-D1 does not add a ledger reader, publisher, resumable cursor,
subscription, host transport, polling fallback, route, or production caller.

### DTE07-E: UI View Models And Component Reuse

- implement Flarex presentation models;
- adapt admitted Trigger-derived components behind those models;
- add visual and interaction regressions for status, timeline, attempts, trace,
  live refresh, and terminal states; and
- retain no Trigger database/auth/product types in browser contracts.

### DTE07-F: Optional Compatibility Facade Decision

- measure native UI adaptation against a bounded Trigger-shaped facade;
- approve or reject exact route compatibility explicitly;
- if approved, prove translation parity without state authority; and
- if rejected, retain only source/behavior provenance and native APIs.

### DTE07-G: Public And Hosted Admission

- add public API/SDK/UI contracts only after DTE06-F and Roadmap 10 gates;
- prove hosted authorization, privacy, retention, limits, backpressure,
  deployment, and incident behavior; and
- activate no route or subscription from a private package export.

## Validation Matrix

| Claim | Minimum proof |
| --- | --- |
| Task state remains authoritative | notification loss/reorder followed by exact projection refetch |
| Scope authorization | cross-scope run, trace, result, stream, and alternate-ID negatives |
| Stable list/read contract | cursor/order/filter bounds and concurrent-insert tests |
| No persistence leakage | type/import boundaries and hostile projection-row fixtures |
| Safe terminal state | success/failure/retry/cancel/timeout/stale/lost-session projections |
| Result separation | Task rows contain commitment only; body uses separate authorization |
| Trace/log separation | independent storage, cursor, redaction, retention, availability tests |
| Stream separation | ordered resume, duplicates, disconnect, backpressure, terminal-race tests |
| UI reuse is honest | pinned source map, behavior tests, no Trigger server/product imports |
| Facade is non-authoritative | parity tests and proof all writes use Flarex commands |
| Production inertness | no active route, binding, Queue/Cron, or subscription before approval |

## Explicit Non-Goals

Roadmap 07 does not authorize:

- exposing raw Task System, Drizzle, PostgreSQL, trace, or object-store rows;
- copying Trigger organization/project/environment, auth, billing, deployment,
  or RBAC models;
- adopting Trigger status enums as Flarex lifecycle authority;
- making Electric, SSE, WebSocket, pub/sub, or polling authoritative;
- putting logs, traces, outputs, or streams into Task lifecycle rows;
- adding replay, retry, bulk action, or deletion because Trigger UI has them;
- direct `@trigger.dev/*` dependencies or a workspace/lockfile merge;
- public API compatibility by implication; or
- production activation before separate hosted and public-readiness gates.

## Current Stop And Next Decision

The connected/private-host foundation and fresh-host takeover are complete
through DTE06-F2. The real-Cloudflare F3/F4 proof remains separately gated.
DTE07-B1 is complete. Its first single-run projection delegates scope
authorization to the existing captured located-scope inspection store, has no
cursor/page bound, and owns exact immutable/redacted output. It proceeds
privately before DTE06-F3/F4 because it adds no route or hosted resource.

DTE07-C1 is complete for the private scope-bound point-query adapter and clean
`inspectTask(run)` operation. DTE07-C2 is complete for the separately
authorized result-body query under preflight 53. DTE07-C3 is complete for the
clean immediate `readTaskResult(run)` output-contract gate under preflight 54.
DTE07-C4 is complete for the clean deadline-controlled
`awaitTask(run, options)` contract under preflight 55.
DTE07-C5 is complete for the private Task cancellation command adapter under
preflight 56. DTE07-C6 is complete for the clean `cancelTask(run, options)`
handle contract under preflight 57. DTE07-B2/C7 are complete for the bounded
production-inert Task run-list contract and private Standard bridge under
preflight 58. DTE07-C8 is complete for the located compact PostgreSQL/PGlite
list store under preflight 59, including disposable PostgreSQL 18 acceptance.
DTE07-C9 is complete for the clean production-inert `listTaskRuns()` facade
under preflight 60. DTE07-C10 is complete for the listed read-only Task-run
reference under preflight 61. DTE07-B3/C11/C12/C13 are implemented for bounded
attempt-admission history under preflight 62, with PGlite accepted and the real
PostgreSQL receipt still pending. DTE07-B4/C14 are implemented for bounded
lifecycle-event history under preflight 63, with PGlite accepted and the real
PostgreSQL receipt still pending. DTE07-C15 is complete for central Task read
scope binding under preflight 64. DTE07-D1 is complete for the pure Task read
invalidation policy under preflight 65; publication, resume, subscription, and
transport owners remain unselected and unapproved, as does the initial run-
admission source needed for complete list freshness. Before enriched attempt
state, other command, later live, public, or hosted work, approve that owner
separately.
