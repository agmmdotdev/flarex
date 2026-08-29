# DTE07 Private Run Projection Preflight

Status: accepted and implemented bounded checkpoint on 2026-08-29. The user
approved the first private run projection after the clean `task()`,
`startTask()`, and system-test delivery checkpoints. The production-inert
projection contract, pure projector, focused tests, and private package export
are complete. No query adapter or production surface is active.

Evidence snapshot: 2026-08-29 current repository state at commit `3bbe89b1`.

## Decision

Add one unversioned, host-neutral Task run projection to
`@flarex/durable-task`. It consumes the already decoded
`ApplicationTaskSystemRunAttemptInspectionSnapshotV1` returned by the existing
scope-captured Application Task run-attempt store and returns a fully owned,
runtime-stable view model.

```text
trusted located Application scope
  -> existing scope-qualified run-attempt inspection
  -> decoded and correlated Application aggregate snapshot
  -> pure Task run projector
  -> private TaskRunProjection
```

The projector is not an authorization service and does not accept unknown
input. Scope authorization, row qualification, database-time observation,
stored-data decoding, and aggregate/ledger correlation remain with the existing
Application Task store. A later DTE07-C query capability may compose that store
with this projector; this checkpoint does not add the adapter.

## First Projection Shape

The projection contains:

- run identity, creation time, authoritative observation time, and monotonic
  run version;
- one exhaustive state: `ready`, `attempt_granted`, `executing`,
  `retry_waiting`, `succeeded`, `failed`, or `cancelled`;
- human-facing attempt number, compute profile, grant time, and lease expiry
  for an active attempt;
- bounded retry timing, next compute profile, previous attempt number, and a
  safe failure code;
- cancellation request/resolution timestamps, resolution, and reason code;
- terminal completion time and execution duration; and
- success result commitment metadata as codec, byte length, and lowercase
  SHA-256 hex text.

The projection deliberately omits:

- Task input, result body, logs, traces, metrics, and user output streams;
- Application runtime-target identity and artifact hashes;
- attempt ID, execution fence, lease version, heartbeat sequence, retry jitter,
  and mutation/effect cursors;
- bound policy, lifecycle acceptance receipts, completion replay records, and
  raw persistence rows; and
- cancellation and failure messages, foreign causes, diagnostics, and stacks.

Attempt IDs and fences remain lifecycle authority, not presentation data.
Result bodies remain under the isolated result-store owner and will require a
separate read authorization and output-decoding contract before `awaitTask()`.

## Cursor, Bound, Ownership, And Redaction Rules

This is a single-run point projection, so it has no list cursor or page bound.
The caller supplies exactly one run ID to the existing inspection operation.
Attempt history, lifecycle events, lists, filters, and pagination remain a
later bounded projection gate.

`runVersion` is the only admitted monotonic change token in this projection.
It is sufficient for equality/refetch decisions but is not yet a live
notification contract.

The projector constructs every returned record itself and freezes every record
in the view. The result digest is converted to immutable lowercase hex rather
than retaining a mutable byte-array alias. Caller-owned aggregate records are
neither returned nor frozen.

Failure and cancellation messages are diagnostic data and are redacted. Their
closed kind/code fields remain because they are required to present safe Task
state. No configurable redaction callback or permissive raw-detail field is
admitted.

## Live Evidence And Hosted Ordering

No live invalidation source is selected by this checkpoint. DTE07-D must choose
an admitted commit/feed/outbox-derived advancement source and prove duplicate,
loss, reorder, reconnect, and authorization-removal behavior. A notification
will remain an invalidation hint followed by this authoritative read path.

The private projection proceeds before DTE06-F3/F4 because it creates no route,
binding, subscription, deployment, or production caller. Real Cloudflare and
Hyperdrive proofs remain prerequisites for hosted/public admission, not for a
pure private view model.

## Validation

Focused tests must prove:

1. every lifecycle phase and terminal outcome maps exhaustively;
2. active and retry views omit attempt IDs, fences, lease versions, heartbeat
   state, and retry jitter;
3. failure and cancellation messages are absent while closed codes remain;
4. success exposes commitment metadata but no result body;
5. the Application runtime-target digest and aggregate internals are absent;
6. the root and every nested record are frozen; and
7. lowercase digest encoding is exact and retains no mutable byte alias.

Package typecheck, focused tests, source/provenance boundary checks, Oxlint
gates, and both standing reviewers are required before commit. This pure
checkpoint makes no PostgreSQL locking, transaction, or hosted-runtime claim.

## Stop

This checkpoint stops after the projection contract, pure projector, focused
tests, private package export, validation, review, and commit.

Do not add the DTE07-C query service, `inspectTask()`, `awaitTask()`, result-body
loading, cancellation, list/cursor/event APIs, live invalidation, HTTP routes,
SDK exports, or production activation in this checkpoint.
