# Cloudflare Freshness Cache

## Delivery Continuation Cursor Persistence

Previous completed checkpoint: `f632a11` Cover delivery continue failure summaries.

What changed:

- `DeliveryDO` now persists the last claimed delivery cursor in pending drain
  state whenever a bounded drain returns `hasMore: true`.
- Wake and continue responses still expose the same public drain result shape;
  the persisted cursor is internal continuation state, not response metadata.
- Executor claim responses now reject `hasMore: true` unless `nextCursor` is a
  concrete cursor, so continuation state cannot silently fall back to a
  no-cursor retry.
- The shared executor claim result type and Postgres persistence claim result
  now encode the same rule: `hasMore: true` requires a concrete `nextCursor`.
- Postgres delivery claiming derives the continuation cursor from the last
  candidate row, not from the rows successfully updated, so a concurrent claim
  race can still advance the scan instead of returning an invalid
  `hasMore: true`/`nextCursor: null` page.
- The in-memory executor test persistence mirrors the same cursor invariant.
- Pending delivery drain state is parsed after reading Durable Object storage
  instead of being trusted through a generic type.
- DeliveryDO normalizes claim and stored cursor timestamps through `Date`
  parsing before persisting or reusing them.
- Existing continuation success coverage now asserts the second claim includes
  the cursor from the first page.
- Continue-failure coverage now asserts the failed second claim also includes
  the persisted cursor.
- Added malformed executor response coverage for `hasMore: true` with
  `nextCursor: null`.
- Added empty-page continuation coverage so `{ deliveries: [], hasMore: true,
  nextCursor }` still persists and reuses the returned cursor.
- Added Postgres persistence coverage for delivery claim pages with more rows
  to prove they expose a concrete continuation cursor.

Why it changed:

The previous checkpoint documented that continuation state preserved only the
drain parameters. That was compatible with the executor claim contract, but it
left long backlogs dependent on the executor filtering out already-acked rows.
Persisting the cursor keeps the Cloudflare `DeliveryDO` continuation model
closer to the scheduler cursor model and reduces redundant scans. Requiring a
cursor when the executor reports more rows mirrors `SchedulerDO` continuation
contracts and makes malformed executor responses fail before state is written.
The review pass found the important production edge case: Postgres can see
claimable candidates while another worker claims them first. In that case the
cursor must come from the candidate page so `DeliveryDO` can continue bounded
maintenance work without treating a normal race as a corrupt executor response.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - Convex's sync worker keeps delivery/rerun progress inside a backend worker
    loop instead of exposing a separate continuation cursor.
- `crates/sync/src/state.rs`
  - sync state updates advance backend-owned state before client transitions
    are emitted.

Flarex differences:

- Flarex needs explicit Durable Object continuation state because bounded
  Cloudflare work may split one delivery backlog across multiple wake,
  continue, or alarm invocations.
- Flarex's executor contract is stricter than a generic list page: claim pages
  with `hasMore: true` must be restartable from `nextCursor`, even when the
  claimed delivery list is empty after concurrency filtering.
- The continuation cursor is backend-internal; it does not change the
  Convex-style client sync protocol.

Known limitations:

- This remains a single cursor per deployment `DeliveryDO` pending drain.
- Alarm failures still swallow the response after scheduling retry state; this
  checkpoint only preserves cursor state for the retry/continue path.
- Storage parsing primitives now exist in both `DeliveryDO` and `SchedulerDO`;
  a future cleanup should extract shared backend-local storage validators.
- Durable metrics and alerting hooks are still future work.
- A future real-Postgres concurrency regression should simulate candidates
  being selected while another claimer wins the update, proving the
  candidate-derived cursor still advances when the returned delivery list is
  shorter than the selected candidate page.

Verification:

```sh
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues DeliveryDO draining|DeliveryDO continue failures|claim pages with hasMore but no cursor|empty hasMore pages|records DeliveryDO claim failures|records DeliveryDO fanout failures|records DeliveryDO ack failures" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts test/liveQueryDelivery.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts -t "live query delivery" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter @flarex/executor exec vitest run test/liveQueries.test.ts -t "delivery" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Delivery Continue Failure Coverage

Previous completed checkpoint: `7ccff51` Cover delivery claim failure summaries.

What changed:

- Added backend sync coverage for structured `DeliveryDO /continue` failures.
- The test first wakes a delivery drain with `hasMore: true`, proving pending
  drain state is persisted after a successful first page.
- The direct `DeliveryDO /continue` call then fails on the next executor claim
  and must return the same structured claim-failure contract as `/wake`:
  - `failure.stage` is `claim`
  - internal failure status is `502`
  - all continuation-attempt counters are zero
  - `pendingAck` is zero
  - the second claim request reuses the persisted drain parameters

Why it changed:

The structured drain-failure wrapper applies to both public wake calls and
internal continuation calls. Earlier coverage proved wake claim/fanout/ack
failure bodies, but continuation failures are a separate reliability boundary:
they happen after `DeliveryDO` has already persisted pending drain state and
may be invoked by an alarm or maintenance caller.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - Convex keeps sync delivery work inside the backend worker loop; there is no
    separately callable HTTP continuation endpoint.
- `crates/sync/src/state.rs`
  - query state transitions are still emitted only after successful backend
    processing; failed maintenance continuation is not a client protocol event.

Flarex differences:

- Flarex splits durable delivery row draining across `DeliveryDO` wake,
  continuation, and alarm boundaries because Cloudflare execution must remain
  bounded.
- A failed continuation reports backend-internal maintenance state only. The
  client does not receive a Convex-style query failure for a delivery
  maintenance claim error.

Known limitations:

- This remains response-level observability; durable metrics and alerting hooks
  are still future work.
- The alarm path swallows continuation failures after scheduling retry state;
  this test covers direct `/continue` response shape, not alarm observability.

Verification:

```sh
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues DeliveryDO draining|DeliveryDO continue failures|records DeliveryDO claim failures|records DeliveryDO fanout failures|records DeliveryDO ack failures" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts test/liveQueryDelivery.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Direct Delivery Claim Failure Coverage

Previous completed checkpoint: `bc2e71d` Report delivery drain failure summaries.

What changed:

- Added direct backend sync coverage for `DeliveryDO` claim failures.
- The new test drives the public deployment wake route with an executor claim
  endpoint returning `503`.
- The response must now prove the structured claim-failure contract:
  - `failure.stage` is `claim`
  - the internal failure status is `502`
  - all partial drain counters are zero
  - `pendingAck` is zero
  - no delivery failure-report call is made because no rows were claimed

Why it changed:

The previous checkpoint implemented claim-failure summaries but only proved the
path indirectly through `SchedulerDO` failed wake propagation. Direct coverage
keeps the Cloudflare maintenance boundary honest: a claim error happens before
fanout and ack work exists, so the failure body should not imply any row-level
delivery state.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - Convex's sync worker owns query rerun and transition delivery in one
    backend worker path, so there is no separate HTTP claim failure response.
- `crates/sync/src/state.rs`
  - client-visible transitions are only emitted after backend state has enough
    information to update or fail a query.

Flarex differences:

- Flarex has an executor-owned durable delivery claim endpoint and a
  Cloudflare-owned `DeliveryDO` fanout loop. Claim failure is therefore a
  backend-internal maintenance failure, not a Convex client protocol message.
- Because no rows are claimed, `DeliveryDO` reports the failed drain without
  calling the executor failure-report endpoint.

Known limitations:

- This remains response-level observability; durable metrics and alerting hooks
  are still future work.
- Wake failures still return external HTTP `500` for compatibility even when
  the structured internal failure status is more specific.

Verification:

```sh
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "records DeliveryDO claim failures|records DeliveryDO fanout failures|records DeliveryDO ack failures|keeps pending delivery deployment cursor when a wake fails" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts test/liveQueryDelivery.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Delivery Drain Failure Summaries

Previous completed checkpoint: `ed5c4dd` Report live query delivery skip reasons.

What changed:

- Added structured failure bodies for `DeliveryDO` wake/continue drain failures.
- Drain failures now return:
  - top-level `error`
  - top-level `failure` with `stage`, `status`, and `error`
  - `summary.failure` with the same detail
  - partial drain counters for batches, claimed rows, acked rows, delivered
    transitions, skipped deliveries, pending ack count, and `hasMore`
- Covered fanout failure and ack failure paths in backend sync tests.
- Scheduler delivery reconciliation now preserves structured DeliveryDO failure
  details from failed wake responses instead of flattening them to response
  text.
- Scheduler failed wake parsing now reads the response body once, attempts JSON
  decoding, and preserves raw text for non-JSON failures while validating
  structured delivery summaries before exposing them.
- Scheduler structured summary validation reuses the canonical live-query
  delivery skip-reason vocabulary and rejects mismatched derived counters such
  as `pendingAck`.
- Post-claim fanout/ack failure summaries report the claimed page's `hasMore`
  value, so operators can still see whether more delivery rows were pending
  when the drain failed.
- The external HTTP status remains `500` for these thrown drain failures so
  existing callers still treat the wake as failed.

Why it changed:

Delivery drains can fail after useful work has already happened. In particular,
fanout failure means the client did not receive the transition, while ack
failure can happen after the client already received a transition. Returning
only an opaque error body forces operators to infer the stage from text and
separate executor failure rows. The response now exposes enough structured
state for schedulers, adapters, and future metrics sinks to classify the
failure safely.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - Convex keeps sync rerun and transition processing in the backend worker
    and does not need an HTTP DeliveryDO failure response.
- `crates/sync/src/state.rs`
  - sync state transitions distinguish updated, failed, and unchanged query
    results before client-visible modifications are emitted.

Flarex differences:

- Flarex has a separate Cloudflare `DeliveryDO` maintenance boundary between
  executor durable delivery rows and active `ConnectionDO` sockets.
- Because that boundary can fail independently at claim, fanout, or ack time,
  Flarex exposes backend-internal structured failure summaries on maintenance
  responses. This is not part of the Convex-style client protocol.

Known limitations:

- These summaries are response-level observability only; no durable metrics
  sink or alerting hook consumes them yet.
- Wake failures still use HTTP `500` for compatibility even when the internal
  failure detail records a more specific status.

Verification:

```sh
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "wakes DeliveryDO to claim, fanout, and ack live query deliveries|wakes DeliveryDO and delivers failed live query reruns as QueryFailed|records DeliveryDO fanout failures|records DeliveryDO ack failures|keeps pending delivery deployment cursor when a wake fails" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "skips stale failed live query deliveries after a newer result is active" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts test/liveQueryDelivery.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Delivery Skip Reason Counters

Previous completed checkpoint: `0220e51` Report stale delivery skips.

What changed:

- Added typed live-query delivery skip reason counters:
  - `wrongDeployment`
  - `wrongConnection`
  - `missingQuery`
  - `stale`
  - `unchanged`
- `ConnectionDO` records the concrete reason for every skipped delivery row.
- `deliverLiveQueryChangesToConnections` parses and aggregates reason counters
  across named connection fanout responses.
- `DeliveryDO` propagates aggregated reason counters into wake/drain responses
  and summaries.
- Legacy connection responses that only return top-level `staleSkipped` are
  normalized into `skipReasons.stale` at the parser boundary before fanout
  aggregation. Mixed responses with `staleSkipped` plus other `skipReasons`
  are canonicalized the same way when the reason object omits `stale`.
- Existing aggregate fields remain:
  - `skipped` is the total skipped row count.
  - `staleSkipped` remains a top-level compatibility/operational shortcut for
    the `stale` reason.
- Hardened the sync test `waitFor` helper from a 1s fixed timeout to a 5s
  default so concurrent Miniflare reconcile assertions do not fail before the
  background request reaches the fake executor.

Why it changed:

The previous checkpoint separated stale skips from the total `skipped` count,
but all other non-stale skips were still opaque. That made it difficult to tell
whether a delivery drain was seeing benign unchanged results, missing queries
from closed subscriptions, wrong connection routing, or stale retries.

Convex references inspected:

- `crates/sync/src/state.rs`
  - `SyncState::complete_fetch` detects unchanged query results, logs
    deduplication, and suppresses client modifications.
- `crates/sync/src/worker.rs`
  - sync transitions are derived from query state; Flarex needs additional
    delivery-boundary counters because Durable Object fanout can skip rows for
    routing and connection-state reasons before a transition exists.

Flarex differences:

- Convex does not expose delivery skip reasons because it does not have a
  separate DeliveryDO-to-ConnectionDO retry/fanout boundary.
- Flarex keeps these counters backend-internal. They are not part of the
  Convex-style client sync protocol.

Known limitations:

- Skip reasons are response-level observability only. They are not yet written
  to a durable metrics table or external metrics sink.
- The reason set is intentionally narrow and delivery-specific; it does not
  classify executor claim, ack, or failure-report errors.
- The test wait helper change only affects tests; production retry and
  coalescing behavior is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "delivery skip reasons|stale live query delivery rows|stale failed live query deliveries|stale DeliveryDO retries" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend exec vitest run test/liveQueryDelivery.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "coalesces concurrent fresh pending delivery reconciles|does not coalesce concurrent pending delivery reconciles" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts test/liveQueryDelivery.test.ts --testTimeout=30000 --hookTimeout=30000
git diff --check
```

## Stale Delivery Metrics

Previous completed checkpoint: `f3fb118` Cover stale delivery retry suppression.

What changed:

- Added an optional `staleSkipped` count to live query delivery results.
- `ConnectionDO` increments `staleSkipped` only when a delivery's
  `previousResultHash` no longer matches the active query result hash.
- DeliveryDO propagates that count into both the wake response and drain
  summary so durable retry wakeups distinguish duplicate stale suppression from
  ordinary skipped deliveries.
- Existing non-stale delivery responses keep the previous shape because
  `staleSkipped` is omitted when it is zero.

Why it changed:

The previous checkpoint proved stale DeliveryDO retries are safely skipped and
acked, but the response only exposed a generic `skipped` count. That made a
stale duplicate retry indistinguishable from unrelated skips such as missing
queries, wrong connection names, or unchanged results.

Convex references inspected:

- `crates/sync/src/state.rs`
  - `SyncState::complete_fetch` computes `same_result`, logs query result
    deduplication, and suppresses client state modifications for unchanged
    results.
- `crates/sync/src/worker.rs`
  - sync transitions are driven by backend query state, while Flarex has an
    extra durable delivery boundary that needs explicit retry observability.

Flarex differences:

- Convex logs query-result deduplication inside the sync worker path and does
  not expose a DeliveryDO wake response. Flarex exposes `staleSkipped` at the
  Cloudflare delivery boundary because durable delivery rows can be retried
  after fanout or ack failures.
- `staleSkipped` is not a new client protocol message. It is operational
  metadata on backend delivery endpoints.

Known limitations:

- `staleSkipped` separates stale hash mismatches from other skips, but other
  skip reasons are still grouped under `skipped`.
- This is response-level observability only; no persistent metrics sink or
  structured logging has been added yet.

Verification:

```sh
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "stale live query delivery rows|stale failed live query deliveries|stale DeliveryDO retries" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
git diff --check
```

## Stale DeliveryDO Retry Suppression

Previous completed checkpoint: `08c036b` Cover delivery ack failure reporting.

What changed:

- Added backend sync coverage for a delivery row retried after a prior
  DeliveryDO ack failure.
- The test proves the first wake:
  - claims the row,
  - fans out `QueryUpdated`,
  - fails ack, and
  - reports `stage: "ack"`.
- The second wake returns the same unacked row. `ConnectionDO` skips it because
  the active query's result hash has already advanced past the payload's
  `previousResultHash`, and DeliveryDO then acks the row.

Why it changed:

The previous checkpoint proved ack failure reporting, but not the next retry.
In production, an ack failure leaves the executor delivery row unacked, so the
same row can be claimed again. Retrying must not produce a duplicate WebSocket
transition after the client already received the first fanout.

Convex references inspected:

- `crates/sync/src/state.rs`
  - `SyncState::complete_fetch` stores result hashes and suppresses unchanged
    query transitions.
- `crates/sync/src/worker.rs`
  - sync worker transitions are derived from backend query state and result
    hashing rather than from transport retry attempts.

Flarex differences:

- Convex does not retry a separate durable HTTP delivery row between sync state
  and the WebSocket connection. Flarex does, so stale retry suppression lives
  in `ConnectionDO` using `previousResultHash`.
- The retried delivery is still acked after being skipped. That clears the
  durable executor row without sending a duplicate client transition.

Known limitations:

- This proves stale suppression for an updated result payload. Failed-query
  retry suppression is covered separately at the direct `ConnectionDO` delivery
  boundary.
- No metric currently distinguishes duplicate-stale skips from other delivery
  skips.

Verification:

```sh
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "stale DeliveryDO retries" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "stale DeliveryDO retries|DeliveryDO ack failures|DeliveryDO fanout failures|DeliveryDO draining" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
git diff --check
```

## DeliveryDO Ack Failure Reporting

Previous completed checkpoint: `9c20c21` Cover async trigger rejection.

What changed:

- Added backend sync coverage for the DeliveryDO branch where:
  - a delivery row is claimed,
  - fanout to the target `ConnectionDO` succeeds,
  - the executor ack endpoint fails, and
  - DeliveryDO reports the row to `/maintenance/live-queries/failure` with
    `stage: "ack"` before returning an error.
- The test also proves the client still receives the `QueryUpdated`
  transition produced by fanout even though durable ack failed.

Why it changed:

Fanout failure and ack failure are different reliability states. Fanout failure
means the client did not receive the transition. Ack failure means the client
may have received the transition, but the authoritative executor still owns an
unacked delivery row that may be retried later. The DeliveryDO failure report
must distinguish these cases so future retry/dead-letter policy can make
correct decisions.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - reruns invalidated queries and produces transition state after the backend
    query result is available.
- `crates/sync/src/state.rs`
  - `SyncState::complete_fetch` dedupes result hashes and emits
    `QueryUpdated` or `QueryFailed` state modifications.

Flarex differences:

- Convex does not have a separate HTTP ack boundary between sync transition
  fanout and durable delivery-row state. Flarex does because Postgres executor
  durability and Cloudflare `ConnectionDO` fanout are separate runtimes.
- Ack failure is therefore reported as a delivery maintenance failure, not as a
  query failure transition.

Known limitations:

- The test proves failure reporting and transition fanout, but it does not yet
  prove a later retry is stale-suppressed by `previousResultHash`.
- No automatic dead-letter threshold or operator metrics are attached to ack
  failures yet.

Verification:

```sh
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "DeliveryDO ack failures" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "DeliveryDO ack failures|DeliveryDO fanout failures|DeliveryDO draining" --testTimeout=30000 --hookTimeout=30000
git diff --check
```

## Durable Rerun QueryFailed Delivery

Previous completed checkpoint: `351e027` Cover duplicate unique sync failure.

What changed:

- Added a durable failed-rerun delivery payload for live queries:
  - `kind: "updated"` for successful changed results.
  - `kind: "failed"` for reruns that throw after a query was previously
    registered successfully.
- Added `recordLiveQueryRerunFailure(...)` to the Postgres persistence
  boundary. The PGlite and Postgres adapters run it inside their adapter
  transaction style so subscription removal and failure delivery insertion are
  owned by persistence, not hand-composed in executor code.
- Updated the executor live-query rerun path so a thrown query:
  - records a durable failure delivery when a delivery ID is supplied,
  - removes the durable subscription, and
  - returns a typed failed rerun result.
- Updated backend delivery parsing and `ConnectionDO` fanout so failed durable
  deliveries emit `Transition(QueryFailed)` and remove the active in-memory
  query from the connection.
- Failed delivery payloads carry `previousResultHash`, and `ConnectionDO`
  skips them when the active local query has already advanced to a different
  result hash. This mirrors the stale-delivery guard used by successful
  `QueryUpdated` payloads.
- The durable live-query delivery payload union now lives in the shared
  `flarex` package and is reused by executor, backend delivery parsing, and
  the narrowed persistence rerun-failure input.
- Extended generated hosted sync coverage so a previously successful
  `messages:uniqueByText` subscription later reruns into duplicate results and
  reaches the WebSocket as `QueryFailed`.

Why it changed:

The previous checkpoint proved initial duplicate `unique()` query failure. The
remaining correctness gap was a durable live query that was valid when
registered but becomes invalid when later rerun by the trusted executor. Convex
sync treats rerun failures as query state transitions; Flarex must not lose the
failure just because the rerun happens outside the active `ConnectionDO`.

Convex references:

- `npm-packages/convex/src/server/query.ts`
  - documents `unique()` as throwing when more than one document matches.
- `npm-packages/convex/src/server/impl/query_impl.ts`
  - implements `unique()` with a two-row read and duplicate-result throw.
- `crates/sync/src/worker.rs`
  - reruns subscribed queries and sends query result/error transitions through
    the sync worker path.
- `crates/sync/src/state.rs`
  - tracks query modifications as state transitions keyed by query ID.

Flarex differences:

- Convex has an integrated sync worker and database runtime. Flarex reruns
  durable subscriptions in the trusted executor, stores a delivery row, then
  fans out through DeliveryDO and ConnectionDO.
- Failed durable reruns remove the durable subscription in the executor before
  delivery. `ConnectionDO` only removes local query state after receiving that
  durable failure payload.
- The failure payload is intentionally minimal for now: message string,
  `errorData: null`, and empty log lines at fanout.
- Existing update payloads without `kind` remain accepted by backend parsers as
  `kind: "updated"` during the transition.
- The generic delivery table still stores `payload_json` as `unknown`, but the
  rerun-failure persistence API narrows the failure payload to the shared
  delivery type.

Known limitations:

- Failure delivery is durable, but failed-query recovery is still manual: the
  client must add the query again after app data or arguments change.
- Error payloads do not yet include structured Convex-style error data.
- The executor persistence operation is transactional at the adapter boundary,
  but there is not yet a richer domain event tying failure delivery to
  subscription lifecycle audit records.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/liveQueries.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts -t "rerun failures|rerun results" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "delivers failed live query reruns|wakes DeliveryDO to claim" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts -t "live query reruns|delivery wake|changed live query" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter @flarex/executor-nitro typecheck
git diff --check
```

## Generated Duplicate Unique QueryFailed Sync

Previous completed checkpoint: `53c7daf` Cover first and unique sync.

What changed:

- Extended the hosted generated-app sync integration with a duplicate
  `unique()` failure case.
- The generated fixture now seeds two colocated messages with the same indexed
  `text` value in a separate partition.
- Both WebSocket sessions add a generated `messages:uniqueByText` query over
  that duplicate equality range.
- The test proves the generated Dynamic Worker query throws from
  `.unique()` and `ConnectionDO` emits a `Transition(QueryFailed)` with:
  - query ID `7`,
  - the runtime error message,
  - empty log lines,
  - `errorData: null`, and
  - `journal: null`.
- Tightened the WebSocket test helper so one-shot message waits remove their
  paired error listener after success, preventing listener accumulation during
  longer sync flows.

Why it changed:

The previous checkpoint proved successful `first()` and `unique()` subscriptions,
including `unique()` changing from one matching row to no matching rows. The
remaining Convex-style semantic gap was the duplicate-result failure: Convex
documents `unique()` as throwing when more than one document matches. Flarex
must surface that failure through the sync protocol as `QueryFailed`, not as a
silent missing subscription or a fatal socket error.

Convex references:

- `npm-packages/convex/src/server/query.ts`
  - documents `unique()` as returning the single result and throwing when more
    than one document matches.
- `npm-packages/convex/src/server/impl/query_impl.ts`
  - implements `unique()` by reading two rows and throwing on the duplicate
    case.
- `crates/sync/src/worker.rs`
  - packages query execution results and failures into sync transitions.
- `crates/sync/src/state.rs`
  - sync state tracks query result/error modifications per query ID.

Flarex differences:

- Convex throws a richer table/id-specific duplicate error from its integrated
  query runtime. Flarex currently throws the portable SDK/runtime message
  `"Query returned more than one document."`.
- The failed generated query is not durably registered as a live subscription,
  matching the current `ConnectionDO` behavior for `QueryFailed`.
- This slice proves initial query failure delivery. It does not add retry or
  recovery behavior for a failed query later becoming valid.

Known limitations:

- Query failure transitions are proven for initial query-set addition, not for
  a previously successful durable live query that later reruns into a duplicate
  `unique()` failure.
- Error payloads remain minimal: `errorData` is `null` and log lines are empty.
- The integration test is now a broad generated sync behavior test. Future
  slices should consider extracting scenario helpers before adding many more
  query shapes.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Generated First And Unique Sync

Previous completed checkpoint: `ac41661` Cover indexed paginated sync.

What changed:

- Extended the hosted generated-app sync integration with two additional
  generated queries:
  - `messages:firstByTeam`, using `.withIndex(...).order("desc").first()`.
  - `messages:uniqueByText`, using an equality range over
    `["teamId", "text"]` and `.unique()`.
- Both active WebSocket sessions now subscribe to direct document, indexed
  collect, ordered limited, paginated first-page, first-result, and unique
  equality-range queries.
- The first mutation updates the current top message. The integration proves
  direct, collect, limited, paginated, and `first()` subscriptions become stale
  and deliver changed results, while the `uniqueByText("second")` subscription
  stays fresh.
- The second mutation changes a previously excluded row so it becomes the
  descending first row. The integration proves collect, limited, paginated, and
  `first()` subscriptions rerun while direct document and unique equality-range
  subscriptions remain fresh.
- The third mutation changes the row matched by `uniqueByText("second")` out
  of that equality range. The integration proves the unique subscription
  becomes stale, reruns through the scheduler/delivery path, and fans out
  `null` to both WebSocket sessions.

Why it changed:

Convex encourages developers to avoid unbounded `collect()` when they only need
one result. `first()` and `unique()` are therefore core query consumers, not
edge APIs. The previous generated hosted coverage proved collect, ordered
limit, and pagination, but not the one-result consumers that are common for
lookup and existence checks. This slice proves those consumers work through the
generated source package, Dynamic Worker syscall boundary, trusted executor
read-set capture, stale classification, durable delivery, and Cloudflare
WebSocket fanout. It also proves the important inverse case: a narrow
`unique()` equality-range subscription is not invalidated by unrelated writes,
but is invalidated when its matching row leaves the range.

Convex references:

- `npm-packages/convex/src/server/query.ts`
  - documents `first()` as returning the first result or `null`, and
    `unique()` as returning the single result or throwing when more than one
    document matches.
- `npm-packages/convex/src/server/impl/query_impl.ts`
  - implements `first()` as `take(1)` and `unique()` as `take(2)` plus a
    multiple-result error.
- `npm-packages/version/convex/util/oldCursorRules.ts`
  - records the public guidance that `.unique()` is for a single matching
    document and throws if multiple documents match.
- `crates/sync/src/worker.rs`
  - reruns invalidated query subscriptions and emits transitions for changed
    query results.

Flarex differences:

- Convex executes `first()` and `unique()` inside the integrated backend query
  runtime. Flarex proves the same generated API shape through the Dynamic
  Worker and trusted executor query syscall boundary.
- This slice covers successful `unique()` with a single row and the transition
  from one matching row to no matching rows. It does not yet prove sync error
  delivery for the Convex-style duplicate-result failure.
- The `uniqueByText("second")` query is intentionally used as a stable
  equality-range read so the test can prove unrelated writes do not over-stale
  a narrow unique subscription.

Known limitations:

- Generated hosted `/sync` does not yet cover duplicate-result `unique()`
  errors as `QueryFailed` transitions.
- The test still exercises one generated fixture. Broader query consumer
  coverage should eventually move into a more table-driven integration shape if
  this file keeps growing.
- Real Postgres query-plan behavior remains a separate correctness lane from
  the current local PGlite executor lane.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Generated Indexed Pagination Sync

Previous completed checkpoint: `dda3efb` Cover ordered limited indexed sync.

What changed:

- Extended the hosted generated-app sync integration with a fourth generated
  query, `messages:pageByTeam`.
- The generated query follows the Convex-style pagination shape:
  `args: { paginationOpts: paginationOptsValidator }` and
  `.withIndex(...).order("desc").paginate(args.paginationOpts)`.
- Both active WebSocket sessions now subscribe to the same direct, indexed
  collect, ordered limited, and paginated first-page queries.
- The test seeds three messages and subscribes with
  `{ numItems: 2, cursor: null }`, proving the first page is ordered, bounded,
  not done, and returns an opaque `continueCursor`.
- The first mutation updates a returned row and proves all eight live-query
  subscriptions become stale, rerun, persist delivery rows, and fan out through
  `SchedulerDO -> DeliveryDO -> ConnectionDO`.
- The second mutation updates a row that was outside the first page so it sorts
  into the first page. The test proves the direct document subscriptions remain
  fresh while indexed collect, ordered limit, and paginated subscriptions rerun
  on both connections.

Why it changed:

Convex apps commonly expose paginated lists with
`paginationOptsValidator` and `.paginate(...)`, and frontend clients expect the
returned `{ page, isDone, continueCursor }` shape to remain live. The previous
checkpoint proved ordered `take(2)` invalidation, but pagination adds a cursor
result boundary that needs to survive generated code, Dynamic Worker syscalls,
trusted executor read-set storage, stale classification, durable delivery, and
Cloudflare WebSocket fanout.

Convex references:

- `npm-packages/convex/src/server/pagination.ts`
  - defines `PaginationOptions`, `PaginationResult`, and
    `paginationOptsValidator`, including the public query example that calls
    `.withIndex(...).order("desc").paginate(args.paginationOpts)`.
- `npm-packages/convex/src/browser/sync/paginated_query_client.ts`
  - shows Convex client pagination as page-query subscriptions whose changed
    base query results are composed into paginated results.
- `crates/sync/src/worker.rs`
  - reruns invalidated query subscriptions and emits transitions for changed
    query results.
- `crates/database/src/query/mod.rs`
  - documents the database query model that includes reactive pagination.

Flarex differences:

- Convex's sync worker owns paginated subscription state in the backend and the
  React client composes page subscriptions with split cursors. This slice only
  proves the hosted backend page-query primitive: one explicit page query over
  `/sync`.
- Flarex currently supports the minimal cursor options shape
  `{ numItems, cursor }`; Convex also supports `endCursor`, `id`,
  `maximumRowsRead`, `maximumBytesRead`, `splitCursor`, and `pageStatus`.
- Flarex treats `continueCursor` as opaque in the integration assertions. The
  visible contract is that it is a non-empty string when `isDone` is false and
  can be passed back to the same query in future cursor-continuation coverage.

Known limitations:

- The generated hosted integration does not yet subscribe to a second page with
  the returned cursor.
- The current client layer does not yet implement Convex's
  `usePaginatedQuery` page composition, page splitting, or load-more state
  machine.
- `first()` and `unique()` are still lower-level coverage only and should get
  generated hosted `/sync` coverage in a later small slice.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Generated Indexed Order And Limit Sync

Previous completed checkpoint: `a485403` Prove multi-connection indexed sync
fanout.

What changed:

- Extended the hosted generated-app sync integration with a third generated
  query, `messages:recentByTeam`.
- The new query uses the Convex-style chain:
  `ctx.db.query("messages").withIndex("by_team_text", q => q.eq("teamId", args.teamId)).order("desc").take(2)`.
- The test now seeds three colocated messages so descending index order and
  limit behavior have observable semantics.
- The generated schema uses a deterministic compound index
  `["teamId", "text"]` so the ordered assertions prove index-field ordering
  rather than incidental generated document ID ordering.
- Both WebSocket sessions subscribe to:
  - `messages:get`,
  - `messages:listByTeam`, and
  - `messages:recentByTeam`.
- A single generated mutation updates the newest message, and the integration
  proves all six live-query subscriptions rerun and deliver exact changed
  results, including the ordered limited list.
- A second generated mutation updates the row that was previously outside the
  `take(2)` result so it sorts above the current top two. The test proves only
  the list subscriptions rerun while direct document subscriptions stay fresh,
  and the ordered limited result changes membership correctly.

Why it changed:

The previous checkpoint proved multi-connection fanout for direct and indexed
collect queries. Convex apps commonly use `order("desc").take(n)` for recent
items, feeds, notifications, and chat messages. This slice proves that Flarex's
generated Dynamic Worker path, trusted executor syscalls, read-set freshness,
durable delivery rows, and Cloudflare WebSocket fanout preserve that query
shape end to end. The excluded-row mutation is the important membership
boundary: it catches implementations that only track returned documents instead
of the index range dependency behind a limited query.

Convex references:

- `npm-packages/version/convex/util/oldCursorRules.ts`
  - documents the public Convex mental model for `withIndex(...)`,
    `order("desc")`, and `take(n)`.
- `npm-packages/private-demos/snippets/convex/queriesExample.ts`
  - uses `withIndex(...).order("desc").take(...)` for common app query
    patterns.
- `crates/sync/src/worker.rs`
  - reruns invalidated query work and emits changed query results to clients.
- `crates/database/src/query/mod.rs`
  - tracks the query model where indexed reads participate in database query
    execution and dependency recording.

Flarex differences:

- Convex executes ordered limited queries inside its integrated Rust database
  and sync runtime. Flarex sends the query shape through the Dynamic Worker
  syscall boundary and persists read dependencies in the trusted executor so
  Cloudflare DOs can later fan out the changed result.
- The current ordered limited query relies on the existing index key order
  implementation and local PGlite executor lane. It does not yet prove real
  Postgres plan behavior or high-volume range performance.

Known limitations:

- Cursor pagination is still not covered in the hosted generated sync
  integration.
- `first()` and `unique()` are covered by lower-level query API tests but not
  yet by generated hosted `/sync` integration.
- Range predicates beyond equality-prefix still need generated hosted sync
  coverage.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Multi-Connection Generated Sync Fanout

Previous completed checkpoint: `dbc748c` Add indexed generated sync fanout.

What changed:

- Extended the hosted generated-app sync integration from one WebSocket session
  to two independent `ConnectionDO` sessions for the same deployment.
- Both sessions now subscribe to the same generated direct document query
  `messages:get` and indexed list query `messages:listByTeam`.
- A single generated `/sync` mutation updates the message, and the test proves
  all four durable live-query subscriptions become stale:
  - first connection, direct document query,
  - first connection, indexed list query,
  - second connection, direct document query,
  - second connection, indexed list query.
- The scheduler trigger now reruns all four stale subscriptions and wakes
  `DeliveryDO`, which claims, fans out, acks, and delivers four changed rows to
  the two active WebSocket connections.
- The test asserts both WebSocket transitions contain exactly the expected
  direct document result and indexed list result after delivery.

Why it changed:

The previous generated integration proved indexed sync on one active
connection. Convex-style live sync has to fan out the same changed query result
shape to every subscribed client, not just to the mutation caller. This slice
exercises the Cloudflare split explicitly: durable subscriptions live in the
trusted executor, `SchedulerDO` reruns stale rows, `DeliveryDO` drains durable
delivery rows, and each named `ConnectionDO` sends the client transition.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex sync workers rerun invalidated queries and fan changed results out
    to connected clients.
- `crates/sync/src/state.rs`
  - query-set state is per client connection, so identical query IDs on
    different connections are independent subscriptions.
- `crates/database/src/transaction.rs`
  - indexed query dependencies participate in the read set that drives
    invalidation.

Flarex differences:

- Convex owns subscriptions, reruns, and client fanout in one backend sync
  worker. Flarex persists subscription and delivery rows in the trusted
  executor, then uses Cloudflare `SchedulerDO`, `DeliveryDO`, and
  `ConnectionDO` as the fanout boundary close to active WebSockets.
- The generated integration still uses the local PGlite executor lane. It
  proves the distributed component contract, not production Postgres lock or
  query-plan behavior.

Known limitations:

- Repeated scheduler continuation over more stale subscriptions than the
  configured limit is already covered in lower-level `SchedulerDO` tests, but
  not yet in the generated hosted app integration.
- Indexed coverage remains an equality-prefix list query. Range pagination,
  ordering, cursors, and multi-index query sets remain follow-up work.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
```

## DeliveryDO Wake And Bounded Drain

Previous completed checkpoint: `f12a7d2` Add live query delivery claim ack APIs.

What changed:

- Added Cloudflare `DeliveryDO` in `packages/flarex-backend`.
- Added deterministic DO binding/name:
  - binding: `DELIVERIES`
  - object name: `delivery:{deploymentId}`
- Added backend route:
  `POST /deployments/:deploymentId/sync/wake-delivery`.
- `DeliveryDO` now performs a bounded drain:
  - claim rows from the injected executor endpoint,
  - fanout materialized payloads to `ConnectionDO`,
  - ack row IDs through the injected executor endpoint,
  - stop after `maxBatches` or when `hasMore` is false.
- Executor injection is config-based:
  - `FLAREX_EXECUTOR` service binding when present,
  - otherwise `FLAREX_EXECUTOR_URL`,
  - optional `FLAREX_EXECUTOR_TOKEN` bearer auth.
- Added Miniflare coverage proving wake -> claim -> fanout -> ack with an
  active WebSocket subscription.

Why it changed:

This moves the delivery loop owner to Cloudflare without giving Cloudflare
Postgres access. `DeliveryDO` is the runtime worker close to `ConnectionDO`,
while the executor remains authoritative for claim/ack state.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - sync worker bounds transition production and owns send-side fanout.
- `crates/sync/src/state.rs`
  - sync state owns result-hash transition dedupe.

Flarex differences:

- Convex keeps this inside its backend sync worker. Flarex uses an injected
  executor boundary because the trusted Postgres executor can live on
  Nitro/Vercel while client connections live on Cloudflare.
- This first `DeliveryDO` does not schedule alarms or queues yet. A wake
  request drains only the configured bounded batch budget.

Known limitations:

- No automatic alarm/queue continuation when `hasMore` remains true.
- No claim leases/visibility timeout yet.
- No fallback scanner that wakes deployments with old undelivered rows.
- Error/log/journal delivery payloads are still not implemented.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- sync.test.ts
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend build
```

## Generated Indexed Sync Fanout Integration

Previous completed checkpoint: `2e2fd8d` Exercise generated sync mutations in
hosted runtime.

What changed:

- Extended the hosted generated-app sync integration from a single document
  query to two active queries on one WebSocket connection:
  - `messages:get`, a direct document query, and
  - `messages:listByTeam`, an indexed list query using
    `ctx.db.query("messages").withIndex("by_team", ...)`.
- Changed the generated fixture to model the current Flarex partition rules:
  `teams` is a `definePartitionTable(...)` root and `messages` is
  `defineColocatedTable("teams", "teamId", ...)` with a `by_team` index.
- The test now seeds and updates through generated `/sync` mutations routed by
  `model.teams.byId("teamId")`, then verifies both the document subscription
  and indexed list subscription become stale and are delivered through
  `SchedulerDO -> DeliveryDO -> ConnectionDO`.
- Fixed the trusted executor query finish response to include `readTs` so
  `ConnectionDO` records durable live-query subscriptions with the query
  session timestamp instead of falling back to `0`.
- Fixed the retained legacy `ExecutionDO` query finish path to return the
  transaction `beginTs` as `readTs`, keeping the old worker-session transport
  compatible with the same live-query freshness contract.
- Made `ConnectionDO` fail closed if an executor query response includes a
  read set without `readTs`.
- Added a focused `/sync` regression that returns `value + readSet` without
  `readTs` from the artifact runtime and asserts the client receives a
  `QueryFailed` transition instead of an unsafe live-query subscription.
- Tightened query response handling so `ConnectionDO` requires both `readSet`
  and `readTs` atomically before mutating active query metadata.
- Added local query-response shape validation at the Cloudflare connection
  boundary so malformed executor responses fail before query state is updated.
- Added a rerun regression proving a previously registered query fails closed
  when a later invalidation rerun returns only `value` and omits read metadata.
- Tightened the hosted sync integration assertions so the initial and delivered
  transitions must contain exactly the two expected `QueryUpdated` entries and
  the indexed list result must exactly match the expected row list.

Why it changed:

The previous checkpoint proved generated mutation-over-`/sync` with one direct
document query. Convex-style apps commonly subscribe to indexed lists, so the
next correctness boundary is proving that generated indexed query read sets
survive the full hosted path: generated code, Dynamic Worker artifact,
Postgres/PGlite executor syscalls, freshness classification, durable delivery,
and WebSocket fanout.

The implementation uncovered a freshness bug: indexed reads record range
dependencies without per-read observed timestamps, so live-query registration
must pass the query session timestamp. Without `readTs`, the subscription was
recorded at `beginTs: 0` and the indexed range was immediately stale after the
initial subscription.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex reruns invalidated queries and sends changed query results through
    the same sync worker path.
- `crates/sync/src/state.rs`
  - active query state tracks query IDs and transitions for multiple active
    queries on a client connection.
- `crates/database/src/transaction.rs`
  - indexed query reads participate in the transaction read set used for OCC
    and subscription invalidation.

Flarex differences:

- Convex keeps query execution, timestamping, invalidation, and client fanout
  inside its backend runtime. Flarex must preserve the query timestamp across
  the trusted executor HTTP/session boundary so Cloudflare `ConnectionDO` can
  persist correct freshness metadata.
- This slice still runs in the local PGlite executor lane. It proves the
  Postgres-authoritative design shape but not real Postgres planner, lock, or
  latency behavior.

Known limitations:

- The integration covers one WebSocket connection with two active queries. It
  does not yet cover multiple WebSocket connections or repeated scheduler
  continuation over more stale subscriptions than the configured limit.
- Indexed coverage is an equality-prefix list query. Range pagination,
  ordering, cursors, and multi-index query sets remain follow-up work.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/executionDO.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev build
```

## DeliveryDO Executor Contract Ready

Previous completed checkpoint: `e4ddeca` Plan DeliveryDO live query fanout.

What changed:

- Added the executor-side claim/ack contract that `DeliveryDO` will consume:
  - `POST /maintenance/live-queries/claim`
  - `POST /maintenance/live-queries/ack`
- The contract is platform-agnostic and available through Nitro/HTTP.

Cloudflare implication:

`DeliveryDO` should be implemented as a Cloudflare-specific consumer of this
contract. It should inject executor URL/token configuration and should not
import executor internals or own Postgres access.

Next Cloudflare step:

1. Add `DeliveryDO` class and `DELIVERIES` binding.
2. Add `POST /deployments/:deploymentId/sync/wake-delivery`.
3. In `DeliveryDO`, call claim -> fanout to `ConnectionDO` -> ack.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
```

## DeliveryDO Fanout Worker

Previous completed checkpoint: `3288183` Wire live query delivery callback
bridge.

Decision:

Add a Cloudflare `DeliveryDO` per deployment:

```txt
delivery:{deploymentId}
```

Role:

- receive wake-up notifications from the executor after mutation commits,
- serialize delivery draining for one deployment,
- claim pending `live_query_deliveries` rows from the trusted executor,
- forward materialized query results to named `ConnectionDO` instances,
- ack successfully fanned-out rows through the executor,
- schedule/requeue bounded continuation when `hasMore` remains true.

`DeliveryDO` is not a cache and is not the source of truth. It is the
Cloudflare-side delivery worker that connects durable Postgres outbox state to
active client sessions.

Target flow:

```txt
Postgres commit
  -> live_query_deliveries rows
  -> executor sends wake-up
  -> DeliveryDO claims batch
  -> ConnectionDO emits Transition(QueryUpdated)
  -> DeliveryDO acks batch
```

Why it belongs on Cloudflare:

- fanout is close to active WebSocket/SSE connections,
- per-deployment serialized DO state prevents duplicate concurrent drains,
- Vercel/Nitro avoids loops and high-frequency polling,
- retry work can be bounded and requeued without blocking user requests.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - sync worker owns transition production and send-side backpressure.
- `crates/sync/src/state.rs`
  - result hashes dedupe transition modifications.

Flarex differences:

- Convex does not need a separate `DeliveryDO`; the sync worker is already
  part of the backend. Flarex uses `DeliveryDO` because sync connections live in
  Cloudflare while the trusted executor may live on Vercel/Nitro.

Known limitations:

- No Cloudflare queue/alarm continuation policy has been chosen yet.
- No claim lease/visibility timeout exists yet; v1 can rely on per-deployment
  `DeliveryDO` serialization, but production should add leasing.
- `ConnectionDO` hibernation recovery remains separate work.

First implementation plan:

1. Add executor claim/ack APIs first so `DeliveryDO` does not need the old
   callback-style maintenance route.
2. Add `DeliveryDO` and `DELIVERIES` binding in the Cloudflare backend package.
3. Add `POST /deployments/:deploymentId/sync/wake-delivery`.
4. Implement a bounded drain method with `maxBatches`, `limit`, and has-more
   continuation metadata.
5. Keep fallback manual maintenance route for recovery until alarms/queues are
   wired.

Verification:

```sh
git diff --check
```

## Decision

Cloudflare cache layers are part of the future Postgres-authoritative design,
but they are not the source of truth.

```txt
Postgres
  authoritative document/index/commit/outbox storage

Cloudflare
  WebSocket sessions
  freshness mirrors
  hot document caches
  shared query result caches
  fanout
```

The cache layer exists to reduce executor/Postgres read pressure and make
live-query fanout efficient. It must be rebuildable from Postgres commit/outbox
state and must never be used as the authoritative write path.

## Layer Roles

### ConnectionDO

Owns a client WebSocket session:

- query-set version state,
- mapping from client query IDs to canonical query keys,
- sending Convex-style transitions,
- mutation response ordering,
- auth/session state.

`ConnectionDO` should not own authoritative documents.

### VersionDO

Replicates freshness metadata from committed Postgres outbox events:

```txt
document version:
  deploymentId + tableId + documentId -> latestCommitVersion

range version:
  deploymentId + indexId + rangeKey -> latestCommitVersion

table version:
  deploymentId + tableId -> latestCommitVersion
```

Use it to answer:

```txt
Can this cached/query result be published as fresh through commitVersion N?
```

VersionDO detects staleness. It does not repair stale results by itself.

### DocCacheDO

Stores hot replicated row images keyed by deployment/table/document:

```txt
deploymentId + tableId + documentId
  -> { commitVersion, jsonValue, deleted }
```

Use it for:

- hot `ctx.db.get(id)` query reruns,
- fanout after common document writes,
- avoiding Postgres round trips when VersionDO proves the row image is fresh.

The cache must be replayable from Postgres outbox events. Missing or stale rows
fall back to the executor/no-cache query path.

### QueryCacheDO

Stores canonical shared query results:

```txt
deploymentId + functionPath + canonicalArgsHash
  -> {
       result,
       resultHash,
       observedCommitVersion,
       readDependencies
     }
```

Use it to deduplicate reruns when many clients subscribe to the same query.
`ConnectionDO` subscribers should point at a canonical query entry instead of
each running the same query independently.

QueryCacheDO is the hardest layer because range freshness can be invalidated by
documents that are not present in the returned result.

## Hyperdrive Rule

Hyperdrive can accelerate ordinary/cold reads, but it is not a correctness
source for live queries.

For live queries:

```txt
Hyperdrive result + observed versions + VersionDO check
  -> publish only if fresh enough
  -> otherwise retry no-cache, use DocCacheDO, or rebuild QueryCacheDO
```

This rule prevents a stale cached result from being emitted as the latest live
state.

## Outbox Dependency

The cache layer depends on Postgres transactions writing outbox/change rows in
the same transaction as document and index changes:

```txt
BEGIN;
  validate read set;
  write documents;
  write index entries;
  write commit row;
  write outbox rows;
COMMIT;
```

Outbox events must include enough data to update freshness mirrors:

- `deploymentId`,
- `commitVersion`,
- changed table/document IDs,
- index/range dependency hints,
- optional document row images,
- event sequence/idempotency key.

The dispatcher must tolerate duplicate, out-of-order, and delayed events.

## Phasing

Phase 1: no cache correctness dependency.

- Use Postgres executor or no-cache query path for live-query reruns.
- Store commit/outbox rows.
- Keep `ConnectionDO` as socket/session owner.

Phase 2: freshness mirror.

- Add `VersionDO`.
- Apply outbox events into document/table/range version mirrors.
- Live-query reruns publish only when result freshness satisfies the required
  commit version.

Phase 3: hot document cache.

- Add `DocCacheDO`.
- Replicate row images for hot documents.
- Serve simple get-by-id reruns from Cloudflare when version checks pass.

Phase 4: shared query cache.

- Add `QueryCacheDO`.
- Canonicalize query keys.
- Deduplicate reruns and fan out one fresh result to many `ConnectionDO`
  subscribers.

Phase 5: Hyperdrive optimization.

- Allow selected one-shot and cold read paths to use Hyperdrive.
- For live queries, require VersionDO freshness proof before publishing.

## Current Repo Impact

Keep:

- `ConnectionDO` concepts and WebSocket/query-set tests,
- Convex-style sync protocol message names,
- result hashing/dedup ideas.

Replace:

- `PartitionDO` read-set registration,
- same-partition rerun logic,
- client-visible `partitionKey` routing.

Do not build `VersionDO`, `DocCacheDO`, or `QueryCacheDO` before the Postgres
executor can write commit/outbox records. Freshness mirrors need a durable
commit stream first. The first commit outbox writer now exists, but no
Cloudflare-side consumer has been built yet.

## Convex References

- `crates/database/src/subscription.rs`
  - read-set subscription invalidation.
- `crates/database/src/write_log.rs`
  - committed write-log freshness and token refresh.
- `crates/sync/src/worker.rs`
  - query-set modification, mutation queueing, and transition emission.
- `crates/sync/src/state.rs`
  - active subscription state model.

## Flarex Differences

- Convex keeps function execution, database reads, write log, and sync workers
  close together.
- Flarex separates Cloudflare WebSockets/caches from a trusted Postgres
  executor, so live-query freshness must be proven through explicit versions.
- Cloudflare cache DOs reduce load and fanout cost but are not authoritative.

## Known Limitations

- A Postgres commit outbox writer exists, but no dispatcher or Cloudflare cache
  mirror consumes it yet.
- No cache DOs exist yet.
- Range freshness representation is still open.
- QueryCacheDO invalidation can become expensive without careful canonical
  query keys and range dependency encoding.
- Hyperdrive can be useful but cannot by itself prove freshness.

## Checkpoint

Previous completed checkpoint: `74d8b74` Align docs with Postgres executor
pivot.

What changed:

- Promoted the cache/freshness layer from design-note-only to a dedicated
  roadmap domain.
- Defined VersionDO, DocCacheDO, QueryCacheDO, and ConnectionDO roles.
- Recorded that cache work must wait for Postgres commit/outbox support.

Verification:

```sh
git diff --check
```

## Read-Set Freshness Checker

Previous completed checkpoint: `3913b02` Add freshness delivery handler.

What changed:

- Added `checkReadSetFreshness(...)` to `@flarex/freshness`.
- The checker compares document and table read dependencies against the
  freshness mirror:
  - document reads are fresh when the document version is `<= observedTs`,
  - table reads are fresh when the table version is `<= observedTs`, and
  - missing-document reads with `observedTs: null` become stale after a later
    document freshness version exists.
- Index/range dependencies return explicit `unsupported` results for now.
- Added tests for fresh read sets, stale document/table read sets,
  missing-document reads, unsupported index reads, and durable Postgres-backed
  checks.

Cache impact:

This is the first reusable invalidation primitive for live query reruns:

```txt
query readSet
  -> durable freshness mirror
  -> fresh | stale | unsupported
```

Cached/live query code can now decide whether a document/table read set needs a
rerun. Index/range reads still require a future freshness representation.

Convex references:

- `crates/database/src/subscription.rs`
  - subscription invalidation compares read dependencies with committed writes.
- `crates/sync/src/worker.rs`
  - sync workers rerun or update queries after dependency invalidation.
- `crates/database/src/write_log.rs`
  - write-log entries provide committed freshness.

Flarex differences:

- Convex's dependency invalidation is internal to its database/sync machinery.
  Flarex exposes a package-level checker because cached query execution and
  sync fanout will run across separate components.

Known limitations:

- Index/range freshness is unsupported.
- No live query scheduler or `ConnectionDO` consumes the checker yet.
- This checker reports invalidation state; it does not rerun user queries.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Executor Read-Set Freshness Adapter

Previous completed checkpoint: `bd78a7b` Add read-set freshness checker.

What changed:

- Added `readSetToFreshnessReadSet(...)` to `@flarex/freshness`.
- The adapter turns executor-shaped read dependencies into freshness read
  dependencies by attaching a default observed timestamp.
- It preserves per-read `observedTs` when present, including `null` for
  missing-document reads.
- Added tests proving conversion and freshness checking of converted read sets.

Cache impact:

Cloudflare cache/live-query code can now store this compact state for a query:

```txt
function path + args + result + readSet + beginTs
```

Then it can convert the read set and ask the freshness mirror whether the saved
result is still usable. This is still a validity check only; cache code must
rerun user queries before publishing stale results.

Convex references:

- `crates/database/src/subscription.rs`
  - read dependencies drive invalidation.
- `crates/sync/src/worker.rs`
  - invalidated queries are rerun before client transitions are published.

Flarex differences:

- Convex stores read dependency freshness inside one backend. Flarex exposes a
  conversion helper because Cloudflare cache/fanout code will consume executor
  output across package/runtime boundaries.

Known limitations:

- No `QueryCacheDO`, scheduler, or `ConnectionDO` consumes the helper yet.
- Index/range reads still convert to an unsupported freshness dependency.
- Public executor read sets need the query `beginTs` attached by the future
  live-query registry.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Durable Live-Query Registry

Previous completed checkpoint: `7eee662` Add executor read-set freshness adapter.

What changed:

- Added durable `live_query_subscriptions` rows in Postgres.
- Each subscription records:
  - deployment id,
  - connection id,
  - query id,
  - function path and args,
  - query begin timestamp,
  - timestamped read set,
  - last result and result hash.
- Added persistence helpers and PGlite tests.

Cache impact:

The freshness/cache path now has durable query state to inspect:

```txt
live query registry
  -> readSetToFreshnessReadSet(...)
  -> checkReadSetFreshness(...)
  -> rerun stale query later
```

This does not make the cache live yet, but it gives the future scheduler a
durable source of subscriptions to evaluate.

Convex references:

- `crates/sync/src/worker.rs`
  - active query state drives client transitions.
- `crates/database/src/subscription.rs`
  - read dependency state drives invalidation.

Flarex differences:

- Convex stores this inside its integrated sync backend. Flarex persists it in
  Postgres because Cloudflare `ConnectionDO`/future cache workers and the
  trusted executor are split.

Known limitations:

- No Cloudflare `ConnectionDO` writes registry rows yet.
- No scheduler checks registry rows against freshness yet.
- Result hashes are stored, but no rerun path uses them for transition
  suppression yet.
- Index/range freshness remains unsupported.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
git diff --check
```

## Connection Cleanup Continuation State

Previous completed checkpoint: `025eac6` Add live query connection cleanup
reconciliation.

What changed:

- Added durable SchedulerDO continuation state for expired live-query
  connection deployment scans.
- Added internal continuation route:
  `POST /continue-live-query-connection-cleanup`.
- When a cleanup scan returns `hasMore: true`, SchedulerDO now persists the
  same `expiredAt` cutoff, the scan `limit`, and the returned `nextCursor`,
  then schedules the DO alarm to continue from that cursor.
- When the continuation reaches `hasMore: false`, SchedulerDO clears the
  pending connection cleanup state and removes the alarm only if no other
  continuation state remains.
- Shared the SchedulerDO alarm between stale-query rerun continuation and
  expired-connection cleanup continuation, with each persisted state carrying
  its own `nextRunAt` so retry backoff is not collapsed by the other owner.
- Added a cursor-keyed in-flight guard for connection cleanup continuation so a
  manual continuation request and a scheduled alarm cannot process the same
  cursor concurrently, without coalescing unrelated cleanup scans.
- Added a singleton in-flight guard for fresh no-cursor connection cleanup
  scans so concurrent fresh reconciles cannot race and overwrite the same
  pending cursor state.
- Kept explicit-cursor cleanup reconciles stateless: they scan and clean that
  cursor page, but they do not replace the singleton pending cleanup cursor.
- Parsed persisted Durable Object continuation state from `unknown` before
  executing it, instead of trusting generic storage reads at the persistence
  boundary.
- Made fresh no-cursor connection reconcile requests continue or report the
  existing singleton cleanup cursor rather than overwriting it with a new scan.
- Added Miniflare coverage for:
  - continuing a two-page expired connection deployment scan,
  - preserving the original `expiredAt` cutoff across continuation, and
  - advancing the scan cursor even when cleanup for one candidate deployment
    fails,
  - coalescing concurrent fresh cleanup reconciles before singleton cursor
    state is persisted, and
  - keeping explicit-cursor reconcile calls stateless.
- Hardened the existing DeliveryDO alarm continuation test so it accepts either
  valid ordering: manual `/continue` performs the second batch, or the real DO
  alarm wins the race and the manual call observes the already-drained batch.

Why it changed:

```txt
Cloudflare scheduled trigger
  -> SchedulerDO scans expired connection deployments
  -> scan page hasMore=true
  -> SchedulerDO stores expiredAt + limit + nextCursor
  -> DO alarm / internal continuation resumes from the cursor
  -> final page hasMore=false
  -> SchedulerDO clears continuation state
```

This turns connection cleanup from "one batch per cron" into a durable
at-least-once scan loop owned by Cloudflare, without moving row selection or
deletion out of the trusted executor.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps sync worker lifecycle and cleanup progress inside backend
    worker state.
- `crates/sync/src/state.rs`
  - active query-set state is in the backend sync state machine rather than
    stored behind Cloudflare alarms.

Flarex differences:

- Convex does not need a Durable Object alarm continuation for this path
  because live sync cleanup is in backend worker state.
- Flarex splits WebSocket ownership into Cloudflare and authoritative rows into
  Postgres, so long-running cleanup scans need explicit Durable Object cursor
  state.
- The historical singleton DO name remains `scheduler:live-query-deliveries`
  for compatibility, but the object now coordinates multiple live-query
  maintenance continuations.
- Because Cloudflare Durable Objects expose one alarm per object, Flarex stores
  per-owner due times and schedules the shared alarm to the earliest due
  continuation.
- New continuation and retry states preserve owner-specific `nextRunAt` due
  times. Legacy pending rerun records written before this checkpoint do not
  contain `nextRunAt`, so they are treated as due during migration rather than
  reconstructing old alarm backoff from unavailable state.

Known limitations:

- Continuation state is singleton-wide for expired connection cleanup. Future
  platform scheduling may need per-region, per-project, or priority queue
  partitioning.
- There is not yet a metrics sink for continuation attempts, retries, or
  duration; response counters remain the only observable surface.
- Executor scan failures before a cursor is known still fail the triggering
  request without persisting a retry state.
- Expired connection cleanup continuation remains singleton-wide: a no-cursor
  reconcile call will not start a separate scan while one cursor is pending.
- Explicit-cursor reconcile calls are operator/debug-style stateless page
  scans. They return `nextCursor` to the caller, but the caller must pass that
  cursor again if it wants to continue outside the singleton scheduled scan.
- Existing pending rerun retry records without `nextRunAt` may run earlier than
  their original exponential retry alarm after this code is deployed. Newly
  written retry records preserve `nextRunAt`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Delivery Reconcile Continuation State

Previous completed checkpoint: `1fd4ecc` Persist live query connection cleanup
continuation.

What changed:

- Added durable SchedulerDO continuation state for pending live-query delivery
  deployment scans.
- Added internal continuation route:
  `POST /continue-live-query-deliveries`.
- Delivery reconciliation now returns `nextCursor` alongside `hasMore`, matching
  the executor pending-deployment scan contract.
- When a no-cursor delivery reconcile scan returns `hasMore: true`, SchedulerDO
  persists `limit`, `deliveryLimit`, `maxBatches`, `cursor`, `retryAttempt`, and
  `nextRunAt`, then schedules the shared DO alarm.
- When continuation reaches `hasMore: false`, SchedulerDO clears the pending
  delivery reconcile state and refreshes the shared alarm based on remaining
  owners.
- Wake failures for individual deployment `DeliveryDO`s are now reported in the
  per-deployment `failed` array instead of aborting the whole scan, so
  `nextCursor` is still preserved.
- Fresh no-cursor delivery reconciles are coalesced by the same keyed parameter
  bundle used for execution: `limit`, `deliveryLimit`, `maxBatches`, and cursor
  owner. Identical calls share one in-flight scan, while different delivery
  parameters run independently.
- Explicit-cursor delivery reconciles are stateless page scans. They return
  `nextCursor`, but they do not replace the singleton scheduled continuation.
- Added Miniflare coverage for:
  - two-page pending delivery deployment continuation,
  - alarm-driven continuation from a stored delivery cursor,
  - cursor preservation when one deployment wake fails,
  - concurrent fresh delivery reconcile coalescing, and
  - concurrent fresh delivery reconciles with different parameters,
  - explicit-cursor stateless delivery reconcile behavior.

Why it changed:

```txt
Cloudflare scheduled trigger
  -> SchedulerDO scans deployments with pending delivery rows
  -> SchedulerDO wakes each deployment DeliveryDO
  -> scan page hasMore=true
  -> SchedulerDO stores pending deployment cursor
  -> DO alarm / internal continuation resumes from the cursor
  -> final page hasMore=false
  -> SchedulerDO clears delivery reconcile continuation state
```

This makes lost wake-notification recovery durable across large pending-delivery
deployment scans instead of requiring a future cron tick for every page.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex backend workers own sync lifecycle and notification recovery inside
    the backend runtime.
- `crates/sync/src/state.rs`
  - sync state is managed in backend process state rather than through
    Cloudflare Durable Object alarms.

Flarex differences:

- Flarex keeps delivery rows in the trusted executor/Postgres path and uses
  Cloudflare `DeliveryDO`s for fanout, so the scheduler must explicitly persist
  pending-deployment scan progress.
- The same singleton scheduler DO still uses the historical
  `scheduler:live-query-deliveries` name for compatibility, but now owns
  delivery reconcile, connection cleanup, and rerun continuation state.
- Explicit-cursor reconcile calls are operator/debug-style stateless page
  scans; scheduled no-cursor reconcile calls own the singleton durable cursor.

Known limitations:

- Durable delivery reconcile continuation is singleton-wide once a cursor is
  stored. Future platform scheduling may need priority queues or
  per-project/per-region partitioning.
- Existing pending delivery reconcile state does not predate this checkpoint,
  but legacy rerun records without `nextRunAt` still follow the migration
  limitation documented in the connection cleanup section.
- Metrics are still response counters and test assertions; no durable metrics
  sink records continuation attempts or failed wake counts yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "reconciles lost live query wake notifications|continues pending live query delivery deployment scans|continues pending live query delivery scans from alarms|keeps pending delivery deployment cursor|coalesces concurrent fresh pending delivery reconciles|does not coalesce concurrent pending delivery reconciles with different parameters|keeps explicit cursor delivery reconciles stateless" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Hosted Live-Query Rerun Bridge Integration

Previous completed checkpoint: `3d5cfec` Persist live query delivery reconcile
continuation.

What changed:

- Added a `flarex-dev` integration test that runs:
  - the real Cloudflare backend Worker harness,
  - real `ConnectionDO`, `DeliveryDO`, and `SchedulerDO` instances,
  - the local PGlite-backed executor HTTP runtime, and
  - materialized Dynamic Worker-style query execution for live-query reruns.
- The test opens a WebSocket subscription through the backend sync route, records
  the subscription in the PGlite executor through `FLAREX_EXECUTOR`, writes a
  document through executor invoke syscalls, verifies the subscription is stale,
  then calls the backend scheduler trigger route.
- The scheduler path now has integration coverage for:
  `SchedulerDO -> executor rerun -> materialized query session -> durable
  delivery row -> DeliveryDO claim/ack -> ConnectionDO QueryUpdated -> WebSocket`.
- The test also asserts the durable delivery row is acked and no undelivered
  delivery remains after fanout.
- Adjusted the existing PGlite trigger-notifier runtime test to derive
  freshness assertions from the committed timestamp returned by invoke finish,
  instead of hard-coding a timestamp that can drift as commit bookkeeping
  evolves.

Why it changed:

The previous backend sync tests proved WebSocket fanout with a fake executor
rerun response. The `flarex-dev` runtime tests separately proved PGlite-backed
reruns through materialized query execution. This checkpoint connects those two
halves so the hosted boundary is covered end to end.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps query execution, invalidation handling, transition production,
    and sync delivery inside the backend sync worker.
- `crates/sync/src/state.rs`
  - Convex tracks active queries, subscriptions, result hashes, and invalidation
    futures in one sync state machine.

Flarex differences:

- Flarex intentionally splits the same lifecycle across Postgres executor
  state, Dynamic Worker-style query execution, `SchedulerDO`, `DeliveryDO`, and
  `ConnectionDO`.
- Because the pieces are split, this is integration coverage rather than a
  direct port of Convex's in-process sync worker loop.
- Superseded by the next checkpoint: at the time of `4d10756`, the initial
  WebSocket query still used a narrow fake artifact runtime response while the
  rerun path used the real materialized executor/runtime bridge.

Known limitations:

- This is a PGlite/local-runtime integration lane, not the real Postgres
  correctness lane.
- The test covers one document read/query and one delivery row. It does not yet
  cover index/range freshness, multiple connections, or repeated `hasMoreStale`
  continuation through this PGlite-backed end-to-end path.
- Superseded by the next checkpoint: at the time of `4d10756`, the backend
  harness still needed a fake initial artifact response to seed the live
  subscription before the rerun path took over.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts -t "wires PGlite mutation commits to the Cloudflare live-query trigger notifier" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```

## Hosted Initial Live-Query Execution Bridge

Previous completed checkpoint: `4d10756` Add hosted live query rerun bridge
integration.

What changed:

- Replaced the fake initial `FLAREX_ARTIFACT_RUNTIME` response in
  `backendSyncRuntime.test.ts` with the real
  `createExecutionArtifactRuntimeService(...)`.
- Bound the runtime service to a `LocalMiniflareExecutionArtifactMaterializer`
  configured for Postgres executor transport, so initial subscription execution
  runs user source code through the same restricted syscall boundary:
  `/invoke/start -> /invoke/syscall -> /invoke/finish`.
- Kept the backend harness as the WebSocket/DO owner and the PGlite executor
  runtime as the durable session/subscription owner.
- Added an assertion that the source package is materialized during the initial
  WebSocket subscription, proving the first result is not a hard-coded fake
  runtime response.
- Added an assertion that the artifact runtime loads source from backend
  artifact storage during the initial subscription, proving
  `FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE=true` is exercising runtime-owned
  source loading instead of inline source delivery from `ConnectionDO`.

Why it changed:

The previous integration checkpoint proved the stale-rerun fanout bridge, but
the initial `ModifyQuerySet Add` result was still seeded by a narrow fake
artifact runtime. This closes that gap: both the initial subscription result
and the later stale rerun now execute through materialized user code and the
executor syscall API.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex sync workers execute initial query subscriptions and subsequent
    invalidated reruns through the same backend query execution path.
- `crates/sync/src/state.rs`
  - Convex keeps active query results, hashes, and subscription state in one
    sync state machine.

Flarex differences:

- Convex keeps the sync worker and database executor in one backend runtime.
  Flarex keeps WebSocket/session ownership in Cloudflare `ConnectionDO`, while
  the materialized Dynamic Worker code calls the trusted PGlite/Postgres
  executor over the restricted syscall API.
- The test uses `FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE=true`, so the runtime
  service loads the active source package from backend artifact storage instead
  of receiving source inline from `ConnectionDO`.

Known limitations:

- This still uses the local PGlite executor lane, not the real Postgres
  correctness lane.
- The integration covers one document read/query and one delivery row. It does
  not yet cover indexed/range reads, multi-query sets, multiple connections, or
  repeated scheduler continuation in the same hosted-runtime path.
- Superseded by the next checkpoint: at the time of `ea5f103`, the test fixture
  still used a hand-written source package instead of a real `flarex/` app
  folder.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```

## Generated App Hosted Sync Integration

Previous completed checkpoint: `ea5f103` Use real artifact runtime for initial
sync query.

What changed:

- Replaced the hosted sync integration test's hand-written `PushSourcePackage`
  and manual backend analysis with a real temporary `flarex/` app folder.
- The test now runs the Convex-style local developer flow before activating the
  backend deployment:
  `initialCodegen -> bundleFlarexSourcePackage ->
  LocalMiniflareExecutionArtifactAdapter.analyze ->
  backendAnalysisFromCodegenAnalysis`.
- Tightened `backendAnalysisFromCodegenAnalysis` so the generated fixture
  consumes a backend-typed `DeploymentAnalysis` directly instead of a shallow
  test-local analysis guard.
- The generated app defines a partitioned `messages` table plus generated
  `messages:get` query and `messages:seed` mutation function metadata.
- The existing hosted sync assertions remain intact:
  initial WebSocket subscription materializes generated user code, the source
  package is loaded from backend artifact storage, the executor records the
  durable live-query subscription, a direct executor write marks it stale, and
  `SchedulerDO -> DeliveryDO -> ConnectionDO` fans out `QueryUpdated`.

Why it changed:

The previous checkpoint proved the hosted runtime path with a real artifact
runtime, but the source package was still hand-written. This checkpoint proves
the developer-facing generation path can feed the same hosted sync runtime
without bypassing codegen, source bundling, or execution-artifact analysis.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex sync uses deployed/analyzed function metadata to execute and track
    query subscriptions.
- `crates/sync/src/state.rs`
  - Convex keeps generated query identity, active result state, and transition
    production tied together in the sync state machine.
- `npm-packages/convex/src/server/registration.ts`
  - Convex-style query/mutation registration remains the developer mental model
    that Flarex generation is preserving.

Flarex differences:

- Convex's generated files and backend deployment flow feed an integrated Rust
  backend. Flarex generates a source package, analyzes it in a Miniflare-backed
  execution artifact, stores it in backend artifact storage, and executes it
  through a Cloudflare-hosted artifact runtime that calls the trusted executor
  syscall API.
- The mutation write in this test still uses direct executor syscalls to create
  a deterministic document and timestamp; the point of this slice is generated
  query deployment and live-query sync, not mutation-over-WebSocket coverage.

Known limitations:

- This still uses the local PGlite executor lane, not the real Postgres
  correctness lane.
- The integration covers one generated document read/query and one delivery
  row. It does not yet cover generated indexed/range queries, multi-query sets,
  multiple WebSocket connections, or repeated scheduler continuation in the
  same hosted-runtime path.
- Superseded by the next checkpoint: at the time of `87933a3`, generated
  mutation execution over `/sync` was not covered and the write path remained a
  direct executor session for deterministic setup.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```

## Generated Mutation Sync Fanout Integration

Previous completed checkpoint: `87933a3` Use generated app for hosted sync
integration.

What changed:

- Replaced the hosted sync integration test's direct executor write setup with
  real WebSocket `Mutation` messages.
- Changed the generated `messages:seed` mutation to execute user code through
  `ctx.db.insert(...)` and return the backend preallocated create-root document
  ID.
- Added a generated `messages:update` mutation that patches the created
  document through `ctx.db.patch(...)`.
- The test now:
  - creates a message through generated mutation-over-`/sync`,
  - subscribes to the returned document ID,
  - updates that same document through generated mutation-over-`/sync`,
  - verifies the executor marks the durable live-query subscription stale, and
  - triggers `SchedulerDO -> DeliveryDO -> ConnectionDO` fanout to deliver the
    updated query result.
- The test keeps assertions that source is loaded from backend artifact storage
  and that the generated artifact is materialized once and reused.
- Exported `flarex-backend/test/sync-protocol` so cross-package integration
  tests can type WebSocket mutation/query messages and mutation responses
  against the backend sync protocol instead of duplicating protocol shapes
  locally. This is deliberately test-scoped because the SDK still has its own
  client protocol module until we consolidate the public sync boundary.
- Raised the existing local Postgres `/sync` dev-runtime integration test's
  per-test timeout to 60s because the focused test takes roughly 29s on this
  Windows machine and can exceed Vitest's default 30s timeout during the full
  package run.
- Raised the backend package Vitest hook/test timeout to 30s so the default
  `flarex-backend test` gate matches the sync-suite timeout already used for
  SchedulerDO/DeliveryDO validation.

Why it changed:

The previous checkpoint proved generated query deployment and hosted live-query
rerun, but mutation writes still bypassed the sync protocol by calling executor
session routes directly. This closes the Convex-style loop through the client
sync surface: generated query subscription, generated mutation execution,
trusted executor commit, stale subscription detection, scheduler rerun, and
WebSocket query update.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex sync workers queue mutations, emit mutation responses, and then
    drive query invalidation/rerun through the same sync state machine.
- `crates/sync/src/state.rs`
  - active query results and mutation-driven transitions are coordinated in the
    backend sync state.
- `npm-packages/convex/src/browser/sync/client.ts`
  - client mutations and query subscriptions share the sync WebSocket protocol.

Flarex differences:

- Convex performs mutation execution, commit, invalidation, rerun, and fanout
  in one backend runtime. Flarex splits that work across Cloudflare
  `ConnectionDO`, a materialized execution artifact, the trusted PGlite/Postgres
  executor, `SchedulerDO`, and `DeliveryDO`.
- The generated create-root mutation relies on backend preallocation for the
  root document ID, so the test subscribes to the mutation result rather than a
  hard-coded document ID.

Known limitations:

- This still uses the local PGlite executor lane, not the real Postgres
  correctness lane.
- The integration covers one generated query, one generated create mutation,
  one generated update mutation, and one delivery row. It does not yet cover
  generated indexed/range queries, multi-query sets, multiple WebSocket
  connections, or repeated scheduler continuation in the same hosted-runtime
  path.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```

## Executor Live-Query Registry Writer

Previous completed checkpoint: `f32cc4f` Add durable live query registry.

What changed:

- Added executor helpers to record and remove live-query subscription rows.
- Recording stores a timestamped freshness read set, last result, and stable
  result fingerprint.
- The result fingerprint uses stable JSON key ordering, matching the legacy
  Cloudflare sync prototype.

Cache impact:

The future freshness scheduler now has the expected write-side API:

```txt
query finished
  -> recordLiveQuerySubscription(...)
  -> live_query_subscriptions
  -> future freshness scan and rerun
```

This keeps the cache/sync layer from needing to know how to normalize read sets
or fingerprint results.

Convex references:

- `crates/sync/src/worker.rs`
  - active query state is updated after query execution and rerun.
- `crates/database/src/subscription.rs`
  - read dependency state is tied to query validity.

Flarex differences:

- Convex keeps active query state internal. Flarex writes explicit durable rows
  so Cloudflare connection/session owners and the trusted executor can hand off
  sync work cleanly.

Known limitations:

- No cache scheduler scans `live_query_subscriptions` yet.
- No `ConnectionDO` calls the writer yet.
- No result-hash comparison is used to suppress future transitions yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Stale Live-Query Scanner

Previous completed checkpoint: `d438453` Add executor live query registry writer.

What changed:

- Added `findStaleLiveQuerySubscriptions(...)`.
- The scanner compares durable live-query rows with a supplied freshness mirror.
- It groups rows as `fresh`, `stale`, or `unsupported`.

Cache impact:

The future cache scheduler can now start from this read-only flow:

```txt
live_query_subscriptions
  -> findStaleLiveQuerySubscriptions(...)
  -> stale rows to rerun later
```

This proves the freshness mirror is usable for subscription invalidation before
we implement query reruns or connection fanout.

Convex references:

- `crates/sync/src/worker.rs`
  - stale query work is driven from active sync state.
- `crates/database/src/subscription.rs`
  - read dependencies are compared against committed writes.

Flarex differences:

- Convex's sync worker owns stale-query discovery internally. Flarex separates
  it because freshness mirrors and live-query registry rows may be consumed by
  Nitro, Cloudflare workers, or tests.

Known limitations:

- No query rerun is performed.
- No result-hash comparison is performed after rerun.
- No Cloudflare `ConnectionDO` notification is performed.
- Index/range reads are still unsupported.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Single Live-Query Rerun Primitive

Previous completed checkpoint: `47bd722` Add stale live query scanner.

What changed:

- Added a single-subscription rerun primitive.
- Rerun refreshes the registry row with the new result and timestamped read set.
- Rerun returns whether the stable result fingerprint changed.

Cache impact:

The future cache scheduler can now use this shape:

```txt
stale row
  -> rerunLiveQuerySubscription(...)
  -> changed | unchanged
```

`changed: false` still matters because the row's read-set freshness is refreshed
even when the client-visible result is identical. `changed: true` is the future
fanout signal.

Convex references:

- `crates/sync/src/worker.rs`
  - reruns stale queries and only emits client-visible updates when needed.
- `crates/database/src/subscription.rs`
  - refreshed query execution updates dependency state.

Flarex differences:

- Convex's rerun worker is integrated with the backend. Flarex keeps execution
  injected so Cloudflare, Nitro, and local test runtimes can share the same
  registry refresh behavior.

Known limitations:

- No scheduler loops over stale rows yet.
- No result fanout is implemented yet.
- No cache layer stores materialized query output outside Postgres yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Batch Stale Live-Query Rerun

Previous completed checkpoint: `d69a73e` Add live query rerun primitive.

What changed:

- Added a batch helper that scans the registry, reruns stale rows, and returns
  changed/unchanged/unsupported buckets.
- Added batch limit support for scheduler-friendly slices.

Cache impact:

The freshness/cache path now has the core loop:

```txt
freshness mirror + live_query_subscriptions
  -> rerun stale rows
  -> changed rows for future fanout
```

`unchanged` rows still refresh their stored read sets and timestamps. `changed`
rows are the future transition/fanout input.

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers process invalidated active queries and emit updates.
- `crates/database/src/subscription.rs`
  - read dependency state drives invalidation.

Flarex differences:

- Convex owns this loop inside the backend. Flarex keeps it as executor core so
  Cloudflare, Nitro, and tests share one implementation while fanout remains
  separate.

Known limitations:

- No fanout or socket delivery exists yet.
- No scheduler invokes the helper yet.
- Index/range subscriptions remain unsupported.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Durable Freshness Delivery Handler

Previous completed checkpoint: `f0fd56f` Add durable freshness store.

What changed:

- Added `createFreshnessDeliveryHandler(store)` in `@flarex/freshness`.
- Added `createPostgresFreshnessDeliveryHandler(persistence)` for the durable
  Postgres/PGlite-backed freshness store.
- Updated executor pipeline tests to use the reusable handler for the normal
  projection path.
- Added freshness package tests for memory and Postgres delivery handlers.

Cache impact:

The production composition is now a reusable function:

```ts
await executor.runOutboxDeliveryBatch({
  deploymentId,
  deliver: async (events) => {
    await createPostgresFreshnessDeliveryHandler(persistence)(events);
  },
});
```

The executor still owns outbox acknowledgement. The freshness package owns
projection into the durable mirror. This keeps the boundary explicit while
removing duplicated handler code from future schedulers.

Convex references:

- `crates/sync/src/worker.rs`
  - worker logic composes committed changes with downstream update handling.
- `crates/database/src/write_log.rs`
  - committed write metadata is the durable input.

Flarex differences:

- Convex does not need an exported delivery handler because its worker runs
  inside the backend. Flarex exposes this composition helper because schedulers,
  Nitro routes, or Cloudflare workers may invoke the dispatcher.

Known limitations:

- No scheduler/Nitro route calls this helper yet.
- No range/index freshness is represented.
- No query rerun or `ConnectionDO` fanout consumes the durable versions yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Durable Postgres Freshness Store

Previous completed checkpoint: `0f896fd` Test outbox freshness pipeline.

What changed:

- Added Postgres/PGlite freshness tables through Drizzle migration
  `0007_moaning_whizzer.sql`:
  - `freshness_processed_events`,
  - `document_freshness_versions`, and
  - `table_freshness_versions`.
- Added `applyFreshnessCommit(...)` to `@flarex/persistence-postgres`.
  It inserts the processed outbox event key and updates document/table versions
  inside one transaction.
- Added getters for processed event, document freshness, and table freshness.
- Added `PostgresFreshnessMirrorStore` in `@flarex/freshness`, implementing
  the existing `FreshnessMirrorStore` interface over the durable persistence
  API.
- Added PGlite tests proving durable idempotency and non-regression.
- Added freshness package tests proving the projector works against durable
  PGlite-backed storage and skips replays across store instances.

Cache impact:

The freshness mirror is no longer memory-only. The correctness reference path
is now:

```txt
outbox event
  -> runOutboxDeliveryBatch(...)
  -> applyOutboxEventsToFreshnessMirror(...)
  -> PostgresFreshnessMirrorStore
  -> durable document/table freshness versions
```

This makes process restarts and replay recovery testable before adding
Cloudflare-specific mirror storage.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata is durable and replayable.
- `crates/database/src/subscription.rs`
  - read dependencies compare against committed write metadata.
- `crates/sync/src/worker.rs`
  - sync workers consume committed changes and update client-visible state.

Flarex differences:

- Convex keeps this inside its backend write-log/subscription machinery.
  Flarex persists explicit freshness projection tables because the Postgres
  executor and Cloudflare freshness/cache layers are separate components.

Known limitations:

- Only document and whole-table freshness are durable.
- Range/index freshness is still not represented.
- No query rerun, minimum-freshness check, or `ConnectionDO` fanout uses these
  durable versions yet.
- No Cloudflare DO/D1 freshness mirror exists yet; Postgres/PGlite is the
  correctness reference.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Outbox To Freshness Pipeline Test

Previous completed checkpoint: `97d0f0f` Add freshness mirror projector.

What changed:

- Added `@flarex/freshness` as a test-time dependency of `@flarex/executor`.
- Added executor tests that compose:

```txt
runOutboxDeliveryBatch(...)
  -> applyOutboxEventsToFreshnessMirror(...)
  -> markOutboxEventsDelivered(...)
```

- Proved a successful dispatch updates the in-memory freshness mirror and then
  hides the event from undelivered outbox batches.
- Proved at-least-once replay safety when projection succeeds but the delivery
  handler crashes before acknowledgement: the event remains undelivered,
  reruns, the projector skips the already processed event key, and the
  dispatcher then marks it delivered.

Cache impact:

The in-process pipeline now proves the intended freshness handoff semantics.
The next cache/freshness step can focus on durable mirror storage instead of
the correctness of dispatcher/projector composition.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata feeds downstream freshness.
- `crates/database/src/subscription.rs`
  - subscription invalidation must tolerate committed changes being processed
    by worker loops.
- `crates/sync/src/worker.rs`
  - sync workers process committed changes into client-visible transitions.

Flarex differences:

- Convex does not need this explicit test seam because the write-log and sync
  worker are internal backend components. Flarex has a runtime handoff from
  Postgres executor to freshness/cache components, so the at-least-once replay
  behavior must be tested explicitly.

Known limitations:

- This is still an in-memory test pipeline, not durable storage.
- No range/index freshness representation exists yet.
- No query rerun, cache minimum-freshness check, or `ConnectionDO` fanout uses
  these versions yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Freshness Mirror Projector Core

Previous completed checkpoint: `5526aa2` Add outbox dispatcher core.

What changed:

- Added a new framework-neutral `@flarex/freshness` package.
- Added `applyOutboxEventsToFreshnessMirror(...)`, which converts committed
  outbox events into document and table freshness versions.
- Added `FreshnessMirrorStore` with one atomic method,
  `applyCommitFreshness(...)`, so idempotency and version updates are owned by
  the mirror store.
- Added `MemoryFreshnessMirrorStore` for tests and local simulation.
- The in-memory store tracks:
  - processed event keys: `(deploymentId, ts, sequence)`,
  - document versions: `(deploymentId, documentId) -> commitTs`, and
  - table versions: `(deploymentId, tableId) -> commitTs`.
- Added event-shape validation through `FreshnessOutboxEventShapeError`.
- Added tests for applying versions, replay idempotency, non-regression when
  older events arrive later, and malformed event rejection.

Cache impact:

This is the first real delivery target for the outbox dispatcher. The intended
composition is now:

```txt
runOutboxDeliveryBatch({
  deliver(events) {
    return applyOutboxEventsToFreshnessMirror({ store, events });
  }
})
```

That gives Flarex the beginning of a freshness proof source for cached reads
and live-query reruns. The projector currently records document/table versions
only; range/index freshness still needs its own representation.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata is the durable source for freshness.
- `crates/database/src/subscription.rs`
  - subscriptions compare read dependencies against committed writes.
- `crates/sync/src/worker.rs`
  - sync workers consume committed changes and publish updates.

Flarex differences:

- Convex keeps write-log, freshness, and sync machinery inside its backend.
  Flarex splits them: Postgres commits write outbox events, executor dispatches
  those events, and `@flarex/freshness` projects them into a mirror that can
  later live in Cloudflare DO/D1/SQLite storage.
- The first store is in-memory only. It proves semantics, not durability.
- At-least-once delivery means store implementations must treat
  `(deploymentId, ts, sequence)` as the idempotency key.

Known limitations:

- No durable freshness store exists yet.
- No range/index freshness representation exists yet.
- No query rerun, cache minimum-freshness check, or `ConnectionDO` fanout uses
  these versions yet.
- No integration test wires `runOutboxDeliveryBatch(...)` to the projector yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Outbox Dispatcher Prerequisite

Previous completed checkpoint: `2683fe0` Add outbox delivery primitives.

What changed:

- Added `runOutboxDeliveryBatch(...)` in `@flarex/executor`.
- The batch runner accepts an injected delivery handler so cache/freshness code
  can apply outbox events without owning acknowledgement details.
- Events are marked delivered only after the handler succeeds.

Cache impact:

The future freshness mirror can now be implemented as the injected handler:

```txt
outbox batch
  -> update document/table/range version mirror
  -> acknowledge batch
```

This gives the cache layer at-least-once event application. Mirror updates must
therefore be idempotent by event key: `(deploymentId, ts, sequence)`.

Convex references:

- `crates/database/src/write_log.rs`
  - durable committed write information is the source of freshness.
- `crates/database/src/subscription.rs`
  - committed write metadata invalidates subscriptions.

Flarex differences:

- Convex's backend can apply freshness invalidation directly from its internal
  write log. Flarex needs an explicit dispatcher because the freshness mirror
  will live outside the trusted Postgres transaction executor.

Known limitations:

- No freshness mirror tables/DOs exist yet.
- No query-result minimum freshness protocol is implemented yet.
- No multi-dispatcher claim/lease protocol exists yet.
- Coarse event payloads still need conversion into precise range/table/document
  versions.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Executor Wake Notification Hook

Previous completed checkpoint: `bd74849` Add DeliveryDO live query fanout.

What changed:

- Added the HTTP/Nitro adapter hook that lets the trusted executor notify
  Cloudflare after durable live-query delivery rows are written.
- Added a reusable backend wake notifier that calls
  `/deployments/:deploymentId/sync/wake-delivery`.
- The wake notifier carries optional `limit` and `maxBatches` controls for the
  DeliveryDO bounded drain.

Freshness/cache impact:

```txt
Postgres freshness marks subscriptions stale
  -> executor reruns stale subscriptions
  -> changed results become durable delivery rows
  -> executor notifies Cloudflare wake route
  -> DeliveryDO drains and fans out
```

This makes the freshness pipeline event-driven for the normal case. The
delivery row remains the source of truth, so a failed wake notification does not
lose the client update.

Convex references:

- `crates/sync/src/worker.rs`
  - backend worker owns query rerun and transition send work.
- `crates/sync/src/state.rs`
  - active query state moves forward after rerun completion.

Flarex differences:

- Convex can call directly across in-process backend components. Flarex uses an
  explicit wake notification because Postgres execution and Cloudflare
  WebSocket fanout are separate deployments.
- The wake notification does not include result payloads. It only asks
  DeliveryDO to claim durable rows from the executor.

Known limitations:

- No Cloudflare Queue, alarm, or background continuation exists yet for
  `hasMore`.
- No periodic reconciler scans undelivered rows if every wake notification
  fails.
- The direct `/deliver-live-query` callback path still exists as a legacy/local
  helper until tests and examples fully move to durable wake delivery.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Stale Rerun Fanout Consumer

Previous completed checkpoint: `0139e0d` Wire live query dead-letter
reconnects.

What changed:

- Cloudflare `SchedulerDO` can now call executor
  `/maintenance/live-queries/rerun`.
- When the executor reports changed stale subscriptions, `SchedulerDO` wakes
  the deployment's `DeliveryDO`.
- `DeliveryDO` uses the existing claim/fanout/ack loop, so changed rerun
  results move through durable delivery rows before reaching WebSocket clients.
- A backend sync test proves the maintenance route produces a `ConnectionDO`
  `Transition` for an active subscribed query.

Freshness impact:

```txt
freshness mirror marks subscription stale
  -> executor reruns stale subscription
  -> executor records changed result as durable live-query delivery
  -> SchedulerDO wakes DeliveryDO
  -> DeliveryDO claims and fans out rows
  -> ConnectionDO sends QueryUpdated Transition
```

This checkpoint closes the previous "changed result fanout is missing" gap for
the manual maintenance path.

Convex references:

- `crates/sync/src/worker.rs`
  - server-side sync schedules query updates and emits transitions.
- `crates/sync/src/state.rs`
  - state tracks invalidated queries, subscriptions, and result hashes.
- `npm-packages/convex/src/browser/sync/client.ts`
  - client sync applies transitions to active query observers.
- `npm-packages/convex/src/browser/sync/remote_query_set.ts`
  - `QueryUpdated` writes the remote query result map.

Flarex differences:

- Convex does not need a separate freshness-cache scheduler route because stale
  reruns happen inside its backend sync worker. Flarex uses an explicit
  executor route and Cloudflare DO drain because storage authority and
  WebSocket fanout are split.
- The Cloudflare consumer does not trust cache revalidation; it trusts executor
  rerun output and durable delivery rows.

Known limitations:

- Automatic cron/alarm scheduling is still not implemented for rerun
  continuation.
- The first consumer handles one bounded call and returns `hasMoreStale`;
  platform automation must call it again later.
- Real Dynamic Worker-hosted query execution is still outside this checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "reruns stale live query subscriptions"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Bounded Stale Rerun Continuation

Previous completed checkpoint: `0386055` Fan out stale live query reruns.

What changed:

- `SchedulerDO` now persists pending rerun state when
  `/maintenance/live-queries/rerun` reports `hasMoreStale`.
- The pending state keeps deployment, project, rerun limit, delivery limit,
  max delivery batches, and retry attempt.
- An alarm and internal continuation route resume the same bounded rerun flow.
- The continuation test proves two bounded stale rerun passes can produce two
  separate WebSocket `Transition` updates without a long-running Worker loop.

Freshness impact:

```txt
stale rerun page reports hasMoreStale
  -> SchedulerDO stores pending rerun
  -> SchedulerDO alarm or internal continue resumes rerun
  -> executor persists changed rows
  -> DeliveryDO drains rows
  -> ConnectionDO sends Transition
```

Convex references:

- `crates/sync/src/worker.rs`
  - Convex schedules query updates after invalidation and query-set changes.
- `crates/sync/src/state.rs`
  - state tracks invalidated queries until rerun/refill completes.
- `npm-packages/convex/src/browser/sync/client.ts`
  - clients receive the resulting transitions through the same sync channel.

Flarex differences:

- Convex's sync worker can keep backend scheduling state in process. Flarex
  must store bounded continuation in Durable Object storage because the
  Cloudflare runtime should not rely on unbounded loops.
- The continuation is still manual/alarm-local. It is not yet triggered by
  freshness projection or commit outbox processing.

Known limitations:

- No commit/freshness trigger automatically wakes this scheduler yet.
- Only one pending stale-rerun continuation is stored per scheduler DO.
- No metrics or operator view exposes retry attempts yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues stale live query reruns"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Freshness Trigger Boundary

Previous completed checkpoint: `986442c` Continue stale live query reruns.

What changed:

- Added Cloudflare Worker route
  `POST /scheduler/live-query-subscriptions/trigger`.
- The trigger route accepts the same deployment/project/bounds input as rerun
  maintenance and wakes the bounded `SchedulerDO` stale-rerun flow.
- The focused sync test now proves this trigger route reaches durable delivery
  fanout and produces a WebSocket `Transition`.

Freshness impact:

```txt
future freshness producer sees deployment may be stale
  -> POST /scheduler/live-query-subscriptions/trigger
  -> SchedulerDO bounded rerun
  -> executor records changed delivery rows
  -> DeliveryDO drains rows
  -> ConnectionDO sends Transition
```

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps invalidation scheduling inside the backend sync worker.
- `crates/sync/src/state.rs`
  - query invalidation state is internal to the sync runtime.
- `npm-packages/convex/src/browser/sync/client.ts`
  - browser clients only see the resulting transition stream.

Flarex differences:

- Flarex exposes a Cloudflare trigger route because freshness projection,
  executor rerun, and WebSocket fanout are split across runtime boundaries.
- The route does not compute freshness or inspect cache rows. It only starts
  the existing bounded stale-rerun flow.

Known limitations:

- No freshness projector calls this trigger automatically yet.
- The route is still protected by the live-query delivery token, not a separate
  producer-scoped token.
- Per-deployment scheduler naming is still a future scaling concern.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "triggers stale live query reruns"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Trigger Ownership And Recovery Routes

Previous completed checkpoint: `48d7261` Add live query trigger route.

What changed:

- Recorded which Cloudflare freshness/sync routes are hot-path triggers and
  which are recovery/maintenance boundaries.
- Clarified that Cloudflare receives trigger notifications but does not decide
  whether a mutation committed or which writes are authoritative.
- Defined mutation-owned invalidation as the next production wiring step.

Cloudflare route roles:

| Route or worker | Hot path or recovery | Owner | When it fires |
| --- | --- | --- | --- |
| `/scheduler/live-query-subscriptions/trigger` | Hot path | Trusted executor or freshness producer | After post-commit stale subscription state exists |
| `/scheduler/live-query-subscriptions/rerun` | Recovery/manual | Operator/test scheduler | Manual bounded rerun with explicit bounds |
| `SchedulerDO /rerun/live-query-subscriptions` | Internal hot path | Backend Worker | Forwarded from trigger/rerun route |
| `SchedulerDO /continue-live-query-reruns` and alarm | Hot path continuation | `SchedulerDO` | Previous rerun page reported more stale work or retry is needed |
| `/deployments/:deploymentId/sync/wake-delivery` | Hot path | Executor delivery notifier | After durable delivery rows exist |
| `DeliveryDO /wake` | Internal hot path | Backend Worker | Forwarded from wake route |
| `DeliveryDO /continue` and alarm | Hot path continuation | `DeliveryDO` | Previous delivery drain had more rows or retry is needed |
| `/scheduler/live-query-deliveries/reconcile` | Recovery | Cloudflare cron/operator | Pending delivery rows exist but wake notification was lost |
| `/scheduler/live-query-deliveries/dead-letter` | Recovery | Operator/cron policy | Delivery rows are stuck past retry policy |
| `ConnectionDO /deliver/live-query` | Internal fanout | `DeliveryDO` | Claimed delivery rows need to reach active sockets |

Cloudflare must treat trigger notifications as hints backed by durable executor
state:

```txt
trigger can be duplicated
trigger can be delayed
trigger can be lost
durable Postgres subscription/delivery state decides what work exists
```

Why it changed:

The route layer is now broad enough that unclear ownership would create bugs:
premature transitions, lost updates, duplicate fanout, or serverless polling.
The freshness/cache roadmap needs an explicit separation between normal
post-commit triggers and recovery sweeps.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - the backend sync worker owns invalidation and transition scheduling.
- `crates/sync/src/state.rs`
  - sync state tracks invalidated queries and result-hash dedupe.
- `crates/database/src/committer.rs`
  - write publication and subscription-visible write-log data happen after
    commit validation.

Flarex differences:

- Convex has no Cloudflare trigger route because backend sync is integrated.
  Flarex uses explicit Cloudflare boundaries, but durable state remains in the
  trusted executor/Postgres path.
- Cloudflare DOs own scheduling, bounded continuation, and WebSocket proximity;
  they do not own mutation correctness.

Known limitations:

- The trigger route exists, but no freshness projector or mutation commit path
  calls it automatically.
- Cloudflare freshness mirror DOs are still future work; current correctness
  uses executor/Postgres state.
- Reconcile and dead-letter are available, but policy cadence and operator
  controls are still minimal.

First implementation plan:

1. Implement executor-owned stale subscription marking after successful
   mutation commit.
2. Inject a Cloudflare trigger notifier from the host into executor commit
   completion.
3. Keep `SchedulerDO` and `DeliveryDO` duplicate-safe by relying on durable
   stale/delivery rows.
4. Add a no-manual-scheduler integration test for mutation-to-transition.

Verification:

```sh
git diff --check
```

## Executor-Owned Freshness Trigger Hook

Previous completed checkpoint: `5437ca8` Document live query route ownership.

What changed:

- The executor can now apply committed mutation writes to a supplied freshness
  mirror immediately after commit.
- The executor can then call an injected Cloudflare trigger notifier, allowing
  hosts to wake `SchedulerDO` through
  `POST /scheduler/live-query-subscriptions/trigger`.
- `@flarex/executor-http` now exposes
  `createFlarexBackendLiveQueryTriggerNotifier(...)` to build that notifier
  without coupling executor core to Cloudflare.
- Tests prove the freshness mirror marks a table read stale after commit and
  the trigger request carries deployment/project plus bounded rerun controls.

Freshness impact:

```txt
mutation commit writes documents
  -> executor applies document/table freshness versions
  -> executor notifies Cloudflare trigger route
  -> SchedulerDO scans stale subscriptions against freshness
  -> changed reruns become delivery rows
  -> DeliveryDO sends ConnectionDO transitions
```

Convex references inspected:

- `crates/database/src/committer.rs`
  - write-log/subscription-visible metadata is part of successful commit
    publication.
- `crates/sync/src/worker.rs`
  - invalidated queries are backend-scheduled work.
- `crates/sync/src/state.rs`
  - unchanged rerun results are suppressed through result hashes.

Flarex differences:

- Convex does not need a trigger notifier because the sync worker is integrated
  with the backend. Flarex must cross from executor-hosted freshness state to
  Cloudflare-hosted `SchedulerDO`.
- The v1 freshness mark is document/table-level. Range/index freshness is still
  a future cache correctness layer.

Known limitations:

- Trigger notification is best-effort in this checkpoint. If Cloudflare is down
  after commit, the mutation remains committed and the host receives `onError`;
  a durable retry path is still needed.
- This does not build VersionDO, DocCacheDO, or QueryCacheDO. The supplied
  freshness store can be memory/PGlite/Postgres-backed depending on host setup.
- Full mutation-to-WebSocket proof awaits the hosted Dynamic Worker executor
  path. Existing tests cover post-commit trigger ownership and trigger-to-
  WebSocket fanout separately.

Verification:

```sh
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
```

## Local Durable Freshness Trigger Wiring

Previous completed checkpoint: `730d284` Trigger live query invalidation after
commit.

What changed:

- Local PGlite executor runtime now uses `PostgresFreshnessMirrorStore` backed
  by the same persistence object as the executor.
- Mutation finish through real executor HTTP routes updates durable freshness
  and posts the Cloudflare scheduler trigger route through the injected
  notifier.
- Test coverage proves a missing-document live-query read becomes stale after
  the mutation inserts that document.

Freshness impact:

```txt
PGlite mutation commit
  -> durable document/table freshness rows
  -> Cloudflare trigger notification
  -> later SchedulerDO rerun can classify stale subscriptions
```

Convex references inspected:

- `crates/database/src/committer.rs`
  - commit write metadata is the freshness source.
- `crates/sync/src/worker.rs`
  - scheduler work follows invalidation.
- `crates/sync/src/state.rs`
  - transition emission remains downstream of rerun.

Flarex differences:

- Convex does not expose a PGlite freshness mirror or Cloudflare trigger URL.
  Flarex uses them to preserve the same semantic order across separate
  runtimes.

Known limitations:

- Cloudflare `VersionDO`, `DocCacheDO`, and `QueryCacheDO` are still future
  cache layers.
- Durable retry of failed trigger notification is not implemented.
- Index/range freshness remains future work.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts
```

## Stuck Delivery Reconnect Consumer

Previous completed checkpoint: `038649e` Add live query delivery dead
lettering.

What changed:

- The Cloudflare scheduler can now call the executor
  `/maintenance/live-queries/dead-letter-stuck` policy route.
- For each returned `reconnectConnectionIds` entry, the scheduler calls the
  named `ConnectionDO` and asks it to force a reconnect.
- `ConnectionDO` unregisters active partition subscriptions before closing its
  WebSockets, so a reconnected client must resubscribe through the normal
  `ModifyQuerySet` path.
- The scheduler result reports scanned rows, dead-lettered rows, reconnect
  targets, successful reconnect calls, failed reconnect calls, `nextCursor`, and
  `hasMore`.

Cache and freshness impact:

```txt
executor finds stuck delivery rows
  -> executor dead-letters the rows
  -> executor returns affected connection ids
  -> SchedulerDO calls each ConnectionDO
  -> ConnectionDO closes the socket
  -> client reconnects and reissues active query set
```

This does not make a stale cached result fresh by itself. It removes trust in
the old sync session and forces the client back through normal subscription
setup, where future query rerun/freshness logic can produce an authoritative
result.

Convex references:

- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`
  - socket closure is a recoverable reconnect path.
- `npm-packages/convex/src/browser/sync/client.ts`
  - reconnect rebuilds remote query state and resends query-set modifications.
- `crates/sync/src/worker.rs`
  - sync workers own active query-set transitions.

Flarex differences:

- Convex live-query freshness does not depend on a Cloudflare delivery outbox.
  Flarex must bridge executor-owned stuck-row policy back to Cloudflare-owned
  WebSocket sessions.
- Flarex uses deterministic connection DO names as reconnect targets.

Known limitations:

- This checkpoint exposes the manual maintenance route. A recurring cron/alarm
  that continues draining when `hasMore` is true remains future work.
- The route does not rerun queries directly; it reconnects clients so they
  resubscribe through the normal sync protocol.
- ConnectionDO force reconnect is per active DO instance. If the DO is inactive,
  the call is a no-op that still proves no active socket was available to close.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "dead-letters stuck live query deliveries"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## DeliveryDO Failure Reporting

Previous completed checkpoint: `d1bc1fe` Add live query delivery reconciler.

What changed:

- `DeliveryDO` now reports claimed delivery IDs back to the executor when
  `ConnectionDO` fanout fails.
- `DeliveryDO` also reports claimed delivery IDs when executor ack fails.
- Failure reporting is best-effort and never masks the original delivery error.
- Existing retry behavior remains unchanged: the DO schedules retry/alarm work
  and the delivery row remains unacked.

Runtime flow:

```text
claim pending delivery rows
  -> fanout to ConnectionDO
  -> fanout or ack fails
  -> POST /maintenance/live-queries/failure
  -> executor increments attempt metadata
  -> DeliveryDO rethrows and schedules retry
```

Convex references:

- `crates/sync/src/worker.rs`
  - Convex sync workers own transition processing without a Cloudflare edge
    handoff.

Flarex differences:

- Flarex must observe failures across Cloudflare DO and executor boundaries.
- Reporting is not an acknowledgement; it only records retry diagnostics.

Known limitations:

- Claim failures cannot report delivery IDs because no rows have been claimed.
- No automatic dead-letter threshold is implemented yet.
- No metrics exporter or dashboard exists yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "records DeliveryDO fanout failures"
```

## Stuck Delivery Candidate Endpoint

Previous completed checkpoint: `b35e2ca` Record live query delivery failures.

What changed:

- Added an executor HTTP maintenance endpoint for stuck live-query delivery
  candidates:
  `/maintenance/live-queries/stuck-deliveries`.
- The endpoint is read-only and returns rows that still need delivery but have
  an old recorded failure attempt.
- This is the safe precursor to any future Cloudflare scheduler/dead-letter
  policy.

Cloudflare implication:

```text
DeliveryDO records failures
  -> executor stores attempt metadata
  -> maintenance endpoint lists stuck candidates
  -> future policy can decide reconnect/dead-letter behavior
```

Convex reference:

- `crates/sync/src/worker.rs`
  - sync retry and transition work remains backend-internal in Convex.

Flarex difference:

- Flarex exposes the candidate listing at the executor HTTP boundary because
  the Cloudflare runtime cannot query Postgres internals directly.

Known limitations:

- No Cloudflare consumer calls this endpoint yet.
- No automatic dead-letter/reconnect policy exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
```

## Dead-Letter Policy Precursor

Previous completed checkpoint: `14925e0` List stuck live query deliveries.

What changed:

- Added executor HTTP routes for explicit dead-lettering:
  - `/maintenance/live-queries/dead-letter`
  - `/maintenance/live-queries/dead-letter-stuck`
- The stuck policy returns `reconnectConnectionIds`, giving a future
  Cloudflare consumer the exact connection names that should be forced to
  reconnect/resubscribe after their pending delivery rows are abandoned.
- No Cloudflare `DeliveryDO` or `SchedulerDO` behavior changes in this
  checkpoint.

Future Cloudflare flow:

```text
SchedulerDO lists stuck candidates
  -> executor dead-letters selected rows
  -> executor returns reconnectConnectionIds
  -> ConnectionDO forces reconnect/resubscribe
```

Convex files inspected:

- `crates/sync/src/worker.rs`
  - backend sync worker owns retries and transitions internally.
- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`
  - reconnect behavior is client sync-runtime behavior.

Flarex difference:

- Flarex must bridge a Postgres executor maintenance decision into Cloudflare
  connection handling. Returning connection IDs keeps that boundary explicit.

Known limitations:

- `ConnectionDO` does not yet expose a force-reconnect endpoint.
- `SchedulerDO` does not yet call the dead-letter policy endpoint.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
```

## DeliveryDO Alarm Continuation For Pending Rows

Previous completed checkpoint: `9c160d8` Notify DeliveryDO after live query
reruns.

What changed:

- `DeliveryDO` persists pending drain config when a wake drain still has more
  rows.
- `DeliveryDO.alarm()` resumes claim/fanout/ack work from Durable Object
  storage.
- Failed alarm drains persist retry attempt state and schedule exponential
  backoff.
- Tests cover the persisted continuation path through an internal DO endpoint.

Freshness/cache impact:

```txt
executor writes durable delivery rows
  -> wake DeliveryDO once
  -> DeliveryDO drains bounded work
  -> if hasMore, alarm repeats from durable pending state
  -> rows are acked only after ConnectionDO fanout
```

This is the first version of Cloudflare-owned fanout continuation. Nitro/Vercel
does not need a loop, queue worker, or cron for the common `hasMore` case.

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker keeps processing active query updates.
- `crates/sync/src/state.rs`
  - active query state advances with completed transitions.

Flarex differences:

- Convex does this inside the backend sync worker. Flarex uses DO storage plus
  alarms because WebSocket fanout lives in Cloudflare while trusted execution
  and Postgres ownership may live elsewhere.

Known limitations:

- There is still no global reconciler for wake notifications that never reach
  Cloudflare.
- There is no queue/dead-letter mechanism for repeatedly failing deployments.
- Miniflare does not reliably auto-dispatch alarms in the current harness, so
  tests use an internal DO continuation endpoint that calls the same persisted
  drain logic.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues DeliveryDO"
git diff --check
```

## SchedulerDO Lost-Wake Reconciler

Previous completed checkpoint: `c8f2f93` Continue DeliveryDO drains with
alarms.

What changed:

- Added `SchedulerDO` live-query delivery reconciliation endpoint:
  `/reconcile/live-query-deliveries`.
- Added Worker route for manual/internal maintenance:
  `POST /scheduler/live-query-deliveries/reconcile`.
- Added Worker `scheduled(...)` handler that calls the same SchedulerDO.
- Added Wrangler cron trigger for the deployable backend wrapper.
- SchedulerDO calls executor
  `/maintenance/live-queries/pending-deployments`, then wakes each matching
  `DeliveryDO`.
- Added backend sync coverage proving SchedulerDO recovers a lost wake by
  waking DeliveryDO, which then claims, fans out, and acks.

Freshness/cache impact:

```txt
lost executor wake
  -> delivery row remains durable and undelivered
  -> SchedulerDO scan finds deployment
  -> SchedulerDO wakes DeliveryDO
  -> DeliveryDO drains and acks after ConnectionDO fanout
```

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker owns active query update processing.
- `crates/sync/src/state.rs`
  - query transitions are applied as backend state advances.

Flarex differences:

- Convex does not expose this fallback boundary because wakeup and processing
  are internal to one backend.
- Flarex needs an explicit Cloudflare reconciler because the trusted executor
  can run on Nitro/Vercel and wake notifications are not durable.

Known limitations:

- SchedulerDO scans one bounded page per run and reports `hasMore`; it does not
  yet persist cursor continuation across cron runs.
- No dead-letter/observability table tracks repeatedly failing deployments.
- The manual route uses the existing live-query delivery capability token when
  configured; platform-level auth/ops scoping is still future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "reconciles lost live query"
git diff --check
```

## Outbox Delivery Prerequisite

Previous completed checkpoint: `b4f98a4` Write commit outbox events.

What changed:

- The executor can now list undelivered Postgres outbox events and mark them
  delivered after a consumer applies them.
- The implementation uses the existing `outbox.delivered_at` field and keeps
  full outbox history visible through `listOutboxEvents(...)`.
- The delivery API is exposed through the executor, not only the raw Postgres
  persistence package.

Cache impact:

This gives a future Cloudflare freshness/cache updater a minimal durable loop:

```txt
page undelivered commit events
  -> update document/table/range version mirrors
  -> mark delivered
```

The updater itself is not implemented yet. Cached query freshness is still not
proved until events are applied into version mirrors and query reruns require a
minimum freshness token.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata is the durable freshness source.
- `crates/database/src/subscription.rs`
  - subscription invalidation uses committed write information.

Flarex differences:

- Convex does not need a separate `delivered_at` acknowledgement for cache
  freshness because the write-log and sync/cache invalidation workers are part
  of the backend. Flarex needs an explicit handoff between Postgres executor
  and Cloudflare freshness/cache workers.

Known limitations:

- No freshness mirror or dispatcher exists yet.
- No multi-worker claim/lease protocol exists yet.
- Query-range freshness still needs compact invalidation metadata.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Commit Outbox Prerequisite

Previous completed checkpoint: `c71110d` Expose ctx db replace.

What changed:

- The Postgres executor now writes one commit outbox event per successful
  mutation commit.
- The event includes the committed timestamp, changed document ids, changed
  table ids, and write summary needed by future freshness mirrors.

Cache impact:

This unblocks the next cache/freshness implementation step: a worker or DO can
page `outbox` events and update version mirrors. It does not make cached query
results fresh by itself.

Convex references:

- `crates/database/src/write_log.rs`
  - committed freshness tokens come from a durable write log.
- `crates/database/src/subscription.rs`
  - subscription invalidation is driven by committed write metadata.

Flarex differences:

- Flarex needs a replayable Postgres outbox because cache and WebSocket logic
  will live in Cloudflare, away from the trusted executor process.

Known limitations:

- No dispatcher has been implemented.
- `delivered_at` is not used yet.
- Query-range freshness still needs a compact invalidation representation.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Live-Query Rerun Maintenance Route

Previous completed checkpoint: `2b91699` Add batch stale live query rerun.

What changed:

- Added `POST /maintenance/live-queries/rerun` to the HTTP adapter and Nitro
  handler path.
- The route delegates to the executor's
  `rerunStaleLiveQuerySubscriptions(...)` operation.
- The route uses configured `freshnessStore` and `runQuery` dependencies. The
  request body only supplies `deploymentId` and optional `limit`.

Cache impact:

```txt
scheduler / cron
  -> maintenance route
  -> batch stale live-query rerun
  -> changed rows for future WebSocket fanout
```

This is the first hosted boundary for stale-query refresh work. It does not
perform Cloudflare cache invalidation yet, but it gives a scheduler or platform
job a stable place to ask the trusted executor to re-evaluate stale
subscriptions.

Convex references:

- `crates/sync/src/worker.rs`
  - backend sync workers process active-query refresh work.
- `crates/application/src/api.rs`
  - trusted backend APIs expose runtime operations behind service boundaries.

Flarex differences:

- Convex keeps this work internal to the backend service. Flarex exposes a
  portable route because scheduler hosting, Nitro executor hosting, and
  Cloudflare WebSocket/cache hosting are separate deployment concerns.

Known limitations:

- No WebSocket fanout is implemented yet.
- The real Dynamic Worker query bridge is not wired into `runQuery` yet.
- The route returns `501` until the host configures `liveQueryRerun`.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Live-Query Partition Routing Metadata

Previous completed checkpoint: `196cef9` Add live query rerun maintenance
route.

What changed:

- Durable live-query subscriptions now have nullable `partition_key`.
- Executor subscription recording accepts and preserves `partitionKey`.
- Rerun updates keep the same `partitionKey` when replacing the stored
  subscription result/read set.

Cache impact:

Cloudflare freshness/cache workers can identify stale subscriptions from
freshness mirrors, but the trusted executor must rerun the query in the same
partition scope as the original watch. Persisting `partition_key` is the
handoff field between Cloudflare-side subscription state and Postgres executor
query execution.

Convex references:

- `npm-packages/convex/src/browser/sync/client.ts`
  - query subscriptions are part of the sync protocol query set.
- `crates/sync/src/worker.rs`
  - the backend reruns active queries without exposing routing as a public
    subscription column.

Flarex differences:

- Flarex currently has an explicit partition routing model, so the cache/sync
  handoff must keep the partition key durable.

Known limitations:

- Existing rows with `partition_key = null` cannot safely use the future
  invoke-backed rerun bridge.
- No WebSocket fanout is wired to changed rerun results yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Invoke-Backed Live-Query Rerun Bridge

Previous completed checkpoint: `21de98d` Persist live query partition keys.

What changed:

- Added executor bridge `runLiveQuerySubscriptionWithInvoke(...)`.
- The bridge converts a stale subscription row into a query invoke session and
  returns a fresh result/read-set snapshot.
- The Dynamic Worker/user-code execution call remains injected through
  `executeQuery(...)`.

Cache impact:

```txt
freshness mirror says subscription is stale
  -> executor bridge starts query session
  -> Dynamic Worker executes user query with syscall client
  -> executor finishes query session and returns new read set
  -> future fanout publishes changed result
```

This is the trusted rerun primitive a Cloudflare freshness/cache scheduler can
use after stale detection. It keeps the freshness proof tied to the executor's
query-session `beginTs`, not to Hyperdrive cache timing.

Convex references:

- `crates/sync/src/worker.rs`
  - backend sync worker owns stale active-query reruns.
- `crates/application/src/application_function_runner/mod.rs`
  - application execution is coordinated by backend services.

Flarex differences:

- Convex reruns inside one backend runtime. Flarex splits rerun into trusted
  session ownership plus host-supplied Dynamic Worker execution.

Known limitations:

- The Cloudflare worker/DO scheduler is not wired yet.
- Changed result fanout is still missing.
- Rows without `partition_key` are rejected until clients refresh
  subscriptions.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
git diff --check
```

## Live-Query Rerun Route Uses Invoke Bridge

Previous completed checkpoint: `895e221` Add invoke backed live query rerun
bridge.

What changed:

- The maintenance route now delegates stale subscription reruns to the
  invoke-backed executor bridge.
- Route config now carries only the host-side `executeQuery(...)` callback plus
  the freshness store.
- The route body carries `projectId` so reruns validate deployment ownership.

Cache impact:

```txt
stale subscription scan
  -> maintenance route
  -> invoke-backed rerun bridge
  -> host executes Dynamic Worker query
  -> route returns changed/unchanged rows for future fanout
```

This keeps cache freshness tied to executor-owned query sessions while still
leaving Cloudflare-side user-code execution outside the Postgres executor
package.

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker performs stale query processing inside the backend.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution is coordinated by backend services.

Flarex differences:

- Convex does not need a public maintenance route or host callback here.
  Flarex exposes this boundary because scheduler/cache hosting and query
  execution are intentionally split.

Known limitations:

- Changed results are not pushed to WebSocket clients yet.
- The real Dynamic Worker execution host is not implemented yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Live-Query Delivery Claim Leases

Previous completed checkpoint: `da099c6` Prove Postgres live sync through
client.

What changed:

- Added `claimed_at`, `claim_expires_at`, and `claim_owner` to durable
  `live_query_deliveries` rows.
- Replaced delivery claiming with an executor-owned lease operation:
  `claimLiveQueryDeliveries(...)`.
- Delivery rows are claimable only when they are undelivered, not
  dead-lettered, and either unclaimed or past `claim_expires_at`.
- Ack, explicit dead-letter, and delivery failure release the lease metadata.
- `DeliveryDO` now passes a per-drain owner token and a lease duration to the
  executor claim endpoint.
- Ack and failure reports carry the same owner token so an expired old drain
  cannot clear a newer drain's active lease.

Why this exists:

```txt
executor records durable delivery row
  -> DeliveryDO claims row with a short lease
  -> DeliveryDO fans out to ConnectionDO
  -> DeliveryDO acks row after successful fanout
  -> failure clears lease so a later drain can retry
```

This prevents two `DeliveryDO` drains, reconciler wakeups, or retried host
requests from concurrently delivering the same row while still allowing recovery
after a crash or lost callback.

Convex references:

- `crates/sync/src/worker.rs`
  - backend sync workers own active query update processing and retries.
- `crates/sync/src/state.rs`
  - sync state keeps active query transitions inside the backend process.

Flarex differences:

- Convex does not need a Postgres delivery lease because the sync worker and
  transition fanout are backend-internal.
- Flarex splits rerun, durable delivery, and Cloudflare `DeliveryDO` fanout, so
  Postgres must own the at-least-once claim boundary.

Known limitations:

- Explicit operator dead-letter calls can still omit an owner intentionally.
- The lease is implemented in the repository method, but there is no
  multi-process Postgres race test yet.
- Metrics around expired leases and duplicate fanout attempts are still
  missing.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/liveQueries.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro exec vitest run test/health.test.ts --testTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/example exec vitest run flarex/sync-e2e.test.ts --testTimeout=30000 --hookTimeout=30000
git diff --check
```

## Real-Postgres Delivery Claim Race Coverage

Previous completed checkpoint: `393d3b4` Lease live query delivery claims.

What changed:

- Added a gated real-Postgres concurrency test for live-query delivery claims.
- The test creates one durable delivery row and races two
  `claimLiveQueryDeliveries(...)` calls against it.
- It asserts the row is returned to exactly one owner.
- It then verifies stale-owner failure and stale-owner ack calls cannot release
  or deliver the winner's active lease.

Why this exists:

```txt
two delivery workers race the same pending row
  -> Postgres UPDATE rechecks the lease predicate under row locking
  -> only one owner receives the row
  -> stale owner cannot clear the winner's lease
```

This is the concrete Postgres acceptance test for the lease boundary. PGlite
continues to cover local behavior, but production correctness depends on real
Postgres row-lock/recheck semantics.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps live-query transition processing inside backend sync workers.
- `crates/sync/src/state.rs`
  - active query state and transition delivery remain internal to the sync
    runtime.

Flarex differences:

- Convex does not expose this database-level delivery claim race because its
  sync worker is integrated with the backend.
- Flarex uses Postgres as the durable claim boundary between executor reruns
  and Cloudflare `DeliveryDO` fanout, so the race must be tested directly.

Known limitations:

- The test is gated by `FLAREX_POSTGRES_DATABASE_URL`; local runs without that
  variable skip it.
- The test proves claim exclusivity for one delivery row. Broader load and
  lease-expiry stress tests still belong in a later operational test suite.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test:postgres
git diff --check
```

Local result:

- `test:postgres` skipped because `FLAREX_POSTGRES_DATABASE_URL` was not set.

## Live-Query Delivery Maintenance Summaries

Previous completed checkpoint: `43b1cb6` Test Postgres delivery claim races.

What changed:

- Added a typed `summary` object to executor live-query delivery batch results.
- Added a typed `summary` object to stuck-delivery dead-letter results.
- Added a `summary` object to `DeliveryDO` wake/continue drain responses.
- Existing top-level fields and result arrays remain for compatibility; the new
  summaries give callers stable counters without recomputing from payloads.

Why this exists:

```txt
delivery maintenance route
  -> returns raw rows for debugging
  -> also returns summary counters for operations
```

This is the first observability layer for delivery maintenance. It lets the
executor, Nitro adapter, Cloudflare `DeliveryDO`, scheduler routes, and tests
observe claimed, delivered, acked, pending-ack, scanned, dead-lettered, and
reconnect-target counts in one consistent result shape.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps live-query delivery work inside the backend sync worker.
- `crates/sync/src/state.rs`
  - sync state drives transitions without exposing a separate maintenance
    result API.

Flarex differences:

- Convex does not need public maintenance counters for delivery drains because
  transition scheduling is in-process backend behavior.
- Flarex splits rerun, durable delivery rows, Cloudflare `DeliveryDO` fanout,
  and scheduler reconciliation, so each maintenance boundary needs structured
  counters for debugging and future metrics sinks.

Known limitations:

- These are response counters, not a durable metrics sink.
- Failure paths still report through existing error responses and failure rows;
  a later slice should add structured failure summaries for thrown
  `DeliveryDO` drains and aggregate metrics emission.
- Expired/reclaimed lease counts are still inferred from claim results and
  stuck scans; they are not first-class counters yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/liveQueries.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro exec vitest run test/health.test.ts --testTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
```

## Connection Subscription Lifecycle Cleanup

Previous completed checkpoint: `b69b881` Add live query delivery summaries.

What changed:

- Added a persistence primitive to delete all live-query subscriptions for a
  deployment connection.
- Added executor-core ownership validation and a typed
  `removeLiveQuerySubscriptionsForConnection(...)` API.
- Added the HTTP endpoint
  `POST /live-query-subscriptions/remove-connection`.
- Changed `ConnectionDO` WebSocket close and forced reconnect cleanup to remove
  the whole connection's durable subscriptions in one executor-owned call.
- Kept explicit query removal on `ModifyQuerySet` `Remove` using the existing
  single-query endpoint.
- Made `ConnectionDO` unregister idempotent so `/force-reconnect` and the
  subsequent WebSocket close hook do not double-clean the same connection.

Why this exists:

```txt
client disconnects or is force-reconnected
  -> ConnectionDO unregisters connection once
  -> executor verifies deployment/project ownership
  -> Postgres deletes durable subscriptions for that connection
  -> later stale scans have no row to rerun or deliver
```

This closes the durable lifecycle gap between Cloudflare connection state and
Postgres-authoritative live-query subscriptions. Without this, stale rows could
continue to rerun and enqueue delivery work after the client connection was
gone.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex sync workers own active query lifecycle and transition delivery
    inside the backend.
- `crates/sync/src/state.rs`
  - active query-set state is removed as part of sync state transitions instead
    of a public persistence cleanup API.
- `npm-packages/convex/src/browser/sync/client.ts`
  - the browser sync client reconnects and re-establishes query state through
    the sync protocol.

Flarex differences:

- Convex does not need a Postgres delete-by-connection route because active
  query state is held by the backend sync runtime.
- Flarex stores durable subscription rows for executor-driven reruns, while
  Cloudflare `ConnectionDO` owns live WebSocket sockets. The close/reconnect
  boundary must therefore explicitly remove durable subscription rows through
  the executor.
- The operation is intentionally connection-scoped, not query-looped, because a
  disconnect invalidates the whole connection query set and because the DO may
  not be the best long-term source of every persisted query ID.

Known limitations:

- This cleans durable subscription rows but does not yet cancel delivery rows
  already claimed or enqueued before cleanup. Existing delivery paths still skip
  inactive sockets and dead-letter/reconnect maintenance handles stuck rows.
- There is no durable heartbeat expiry for abandoned connections yet. This
  slice covers close and forced reconnect paths; crash/eviction expiry belongs
  in a later maintenance slice.
- The old Durable Object partition subscription unregister path remains for the
  legacy prototype. New Postgres-authoritative sync uses the executor endpoint.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/persistence-postgres test -- pglite.test.ts
corepack pnpm --filter flarex-backend test -- sync.test.ts
```

## Connection Leases And Expired Subscription Filtering

Previous completed checkpoint: `ae6cc57` Clean up live query subscriptions on
disconnect.

What changed:

- Added the `live_query_connections` table with `last_seen_at`, `expires_at`,
  `closed_at`, and deterministic deployment/connection primary key.
- Added Postgres/PGlite persistence operations to:
  - upsert a connection lease,
  - close a connection lease,
  - list only subscriptions whose connection lease is active, and
  - delete subscriptions for expired or closed connection leases.
- Changed executor live-query subscription recording to refresh the connection
  lease and store the subscription row through one transaction-owned
  persistence operation.
- Changed stale live-query scans and batch reruns to read only active leased
  subscriptions.
- Changed connection-level subscription removal to mark the connection lease
  closed before deleting the connection's subscription rows.
- Added HTTP adapter routes:
  - `POST /live-query-connections/touch`
  - `POST /maintenance/live-queries/connections/cleanup`
- Added `ConnectionDO` heartbeat/alarm refresh against
  `/live-query-connections/touch` with a longer connection lease than the alarm
  interval.
- Made expired cleanup delete expired/closed connection rows and dependent
  subscription rows through one DB-side CTE inside an adapter transaction, so
  cleanup does not materialize unbounded connection IDs in TypeScript.
- Added PGlite, executor, HTTP, and Nitro helper coverage for the new lease
  boundary.

Why this exists:

```txt
subscription record
  -> executor validates deployment/project
  -> transactionally upsert connection lease and durable subscription row

stale scan / rerun
  -> read only subscriptions joined to active non-closed leases
  -> expired or closed connections do not rerun

ConnectionDO heartbeat
  -> touch connection lease while WebSocket remains open

maintenance cleanup
  -> delete expired or closed lease rows in a CTE
  -> delete dependent subscription rows using the returned CTE rows
```

This handles the connection state that a clean WebSocket close cannot cover:
client drops, Worker/DO eviction, crashes, or lost close events. Durable
subscription rows no longer remain eligible for rerun forever without a live
connection lease.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex sync workers own live query state and subscription lifecycle inside
    backend sync workers.
- `crates/sync/src/state.rs`
  - active query-set state is part of the sync state machine rather than a
    separate durable lease table.
- `npm-packages/convex/src/browser/sync/client.ts`
  - client reconnect/re-authentication re-establishes query state through the
    sync protocol.

Flarex differences:

- Convex does not need a Postgres connection lease table for active query
  filtering because active subscriptions are backend sync-worker state.
- Flarex stores subscription rows durably so executor reruns can happen outside
  the Cloudflare WebSocket DO. That split requires an explicit durable lease to
  prove a subscription still belongs to an active connection.
- The current lease is refreshed on subscription record and by `ConnectionDO`
  heartbeat/alarm while the WebSocket remains open.

Known limitations:

- Expired subscription cleanup is available as an executor/HTTP maintenance
  operation, but it is not yet wired into `SchedulerDO` or `DeliveryDO`.
- Existing delivery rows already enqueued before expiry are not deleted by this
  cleanup. Delivery fanout still relies on the existing active-socket check,
  ack/failure recording, and dead-letter maintenance.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
corepack pnpm --filter @flarex/persistence-postgres test -- pglite.test.ts
corepack pnpm --filter flarex-backend test -- sync.test.ts
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter @flarex/persistence-postgres build
```

## Cloudflare-Scheduled Connection Lease Cleanup

Previous completed checkpoint: `29f13b8` Add live query connection leases.

What changed:

- Added a Cloudflare scheduler trigger route:
  `POST /scheduler/live-query-connections/cleanup`.
- Added the matching internal `SchedulerDO` operation:
  `POST /cleanup/live-query-connections`.
- Centralized Worker-to-`SchedulerDO` live-query maintenance forwarding so new
  scheduler routes share auth, scheduler object naming, JSON forwarding, and
  internal request construction.
- Added a shared typed internal live-query scheduler route map used by the
  Worker scheduled handler, Worker forwarding routes, and `SchedulerDO` path
  checks.
- Extracted project-id resolution into a shared backend helper used by
  `ConnectionDO` and `SchedulerDO`.
- The scheduler validates the request, resolves `projectId` from the request or
  `FLAREX_PROJECT_ID`, normalizes optional `expiredAt`, and calls the trusted
  executor route:
  `POST /maintenance/live-queries/connections/cleanup`.
- `SchedulerDO` now converts `HttpError`s into JSON HTTP responses instead of
  allowing validation failures to surface as Durable Object 500s.
- The route returns stable cleanup counters:
  `deploymentId`, `deleted`, and `deletedConnections`.
- Added Miniflare coverage proving the Cloudflare route forwards the cleanup
  request to the executor with bearer auth and normalized timestamps.
- Added route coverage for explicit `projectId` when no environment fallback is
  configured, and for rejecting cleanup before calling the executor when no
  project id can be resolved.
- Added route coverage for executor cleanup failure returning a SchedulerDO
  502 response.

Why it changed:

```txt
platform/admin/cron trigger
  -> Cloudflare Worker route
  -> SchedulerDO serializes one deployment cleanup request
  -> trusted executor validates deployment/project ownership
  -> Postgres deletes expired or closed connection leases and subscriptions
```

This keeps Vercel/Nitro executor deployments out of long-running polling loops
while giving the Cloudflare side a concrete maintenance boundary for abandoned
WebSocket subscriptions.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex sync workers own active subscription lifecycle inside the backend.
- `crates/sync/src/state.rs`
  - active query-set state is removed from the sync state machine rather than a
    public cleanup route.

Flarex differences:

- Convex does not need an expired connection lease cleanup route because live
  subscriptions are backend worker state.
- Flarex persists subscriptions in Postgres and owns WebSocket sessions in
  Cloudflare `ConnectionDO`s, so abandoned connection cleanup must cross the
  scheduler/executor boundary explicitly.
- The Cloudflare scheduler owns when cleanup is triggered; the trusted executor
  still owns which rows are valid to delete.

Known limitations:

- This is a per-deployment trigger. A future platform scheduler still needs to
  enumerate deployments or enqueue per-deployment cleanup jobs.
- Existing delivery rows already created for expired connections are not
  deleted by this route. Delivery dead-letter and reconnect maintenance remain
  separate cleanup paths.
- No metrics sink is attached yet; callers only receive response counters.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Connection Cleanup Reconcile Owner

Previous completed checkpoint: `7ae8a7b` Wire live query connection cleanup
scheduler.

What changed:

- Added the executor/persistence candidate scan for expired connection cleanup:
  `listExpiredLiveQueryConnectionDeployments(...)`.
- Added HTTP adapter route:
  `POST /maintenance/live-queries/expired-connection-deployments`.
- The candidate scan returns deployment/project pairs, oldest expired lease
  timestamp, expired connection counts, cursor, and `hasMore`.
- Added Cloudflare Worker trigger route:
  `POST /scheduler/live-query-connections/reconcile`.
- Added internal `SchedulerDO` route:
  `POST /reconcile/live-query-connections`.
- The Cloudflare scheduled handler now triggers both delivery reconciliation
  and expired connection cleanup reconciliation.
- `SchedulerDO` now:
  - asks the executor for expired connection cleanup candidates,
  - calls the existing per-deployment cleanup route for each candidate,
  - aggregates deleted subscription/connection counters,
  - reports per-deployment failures without failing the whole batch, and
  - returns `nextCursor`/`hasMore` for platform continuation.
- Added PGlite, executor, HTTP adapter, and Miniflare coverage for the new
  candidate scan and reconcile route.
- Added request validation coverage for invalid scan limits, malformed scan
  cursors, and malformed Cloudflare reconcile cursors so bad caller input fails
  with 400 before reaching the executor.
- Kept the singleton Cloudflare scheduler object at the existing
  `scheduler:live-query-deliveries` compatibility name so any stored alarm or
  rerun state is not orphaned, while documenting that the object is now the
  broader live-query maintenance owner.
- Tightened scheduler/executor response parsing so expired-connection scan
  timestamps are validated and canonicalized as ISO timestamps; bad executor
  output fails as a 502 protocol error.
- Renamed HTTP adapter internals from "connection cleanup deployments" to
  "expired connection deployments" so scan ownership stays separate from the
  per-deployment delete route.
- Added cursor tie-breaker coverage for equal `oldestExpiredAt` timestamps in
  both the memory executor test lane and the PGlite persistence lane.
- Added a connection-specific deployment scan default so expired connection
  scanning does not reuse delivery-pending naming by accident.

Why it changed:

```txt
Cloudflare cron / platform trigger
  -> SchedulerDO reconcile live-query connections
  -> executor lists deployments with expired connection leases
  -> SchedulerDO calls per-deployment cleanup
  -> executor validates deployment/project ownership
  -> Postgres deletes expired lease rows and dependent subscriptions
```

This makes abandoned WebSocket subscription cleanup operational instead of only
manually callable. Vercel/Nitro still does not run a loop; Cloudflare owns the
maintenance trigger, while the trusted executor owns row selection and deletion.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps active subscription lifecycle and sync worker cleanup inside
    the backend worker runtime.
- `crates/sync/src/state.rs`
  - active query-set state is part of the backend sync state machine.

Flarex differences:

- Convex does not need a public deployment-candidate scan because live sync
  state is in-process backend state.
- Flarex stores live-query subscription state durably in Postgres and owns
  WebSocket sessions in Cloudflare, so the cleanup owner must be explicit:
  Cloudflare schedules, executor scans/deletes, Postgres remains authoritative.
- The scheduler uses at-least-once maintenance semantics. Repeated cleanup is
  safe because the executor route is idempotent over already-deleted leases.
- The singleton Cloudflare DO still uses the historical delivery-shaped storage
  name for compatibility, but its responsibility is now maintenance-scoped:
  delivery reconciliation, delivery dead-lettering, and expired connection
  reconciliation.

Known limitations:

- The scheduled handler currently sends one default reconcile request. A future
  platform scheduler should persist `nextCursor`/`hasMore` continuation state or
  enqueue follow-up work for very large installations.
- Candidate scanning is deployment-level only; it does not yet prioritize by
  project, region, or customer plan.
- Metrics are still response counters, not a durable metrics sink.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor exec vitest run test/liveQueries.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor-nitro exec vitest run test/health.test.ts --testTimeout=30000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/persistence-postgres db:check
git diff --check
```
