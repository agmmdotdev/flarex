# PostgreSQL Active-Work Quarantine

Status: accepted owner correction; implementation and local native acceptance
complete; hosted and production activation remain gated.

## Decision

`FSA-PG-DRAIN-01` belongs to the artifact-private PostgreSQL control-session
adapter. It is not a universal Flarex relational, OCC, transaction, Payload,
or Medusa primitive.

When an artifact control-session deadline or interruption reaches quarantine
while node-postgres work is still pending, the adapter must authenticate a
cancel request to that exact backend, drain every tracked statement, destroy
the original client, observe its transport end, and only then return the owned
failure. Removing a client from `pg.Pool` is not evidence that PostgreSQL
stopped the query.

This correction changes no repository value, SQL transaction decision,
artifact identity, public API, runtime activation, or retry policy.

## Observed Defect

The native acceptance trigger holds an artifact `INSERT` behind an advisory
lock. Advancing the host deadline caused the original client to be released
with destruction and the pool to emit `remove`, but the same PID remained
`active` in `pg_stat_activity`. Recovery showed the same defect on its second,
distinct backend.

The Promise tracker was accurate: the statement had not settled. The broken
assumption was that socket/pool destruction promptly cancels PostgreSQL work.
A backend waiting on a server lock can remain alive after the local client has
been removed.

## Accepted Native Mechanism

The node-postgres adapter owns the exceptional cancellation path:

1. close the connection's work fence so no new callback SQL can start;
2. detect whether tracked work is still pending;
3. validate both the process ID and secret recorded from PostgreSQL
   `BackendKeyData`;
4. create a short-lived node-postgres protocol connection for the configured
   endpoint, without authenticating a new SQL session or consuming a pool slot;
5. send PostgreSQL's PID-plus-secret `CancelRequest` and require the protocol
   connection to close within the remaining real host-time deadline;
6. wait within that same remaining deadline for every tracked original-client
   Promise to settle;
7. destroy/release the original client and require its transport-end event
   within that same remaining deadline; and
8. only then confirm quarantine.

The process ID alone is never signal authority. The protocol secret binds the
request to the exact live session and therefore avoids terminating an unrelated
same-role backend if an operating-system PID is recycled. The cancellation,
tracked drain, and original transport close share one monotonic platform-time
deadline rather than the application Effect clock, which can be a TestClock
and cannot safely own foreign driver cleanup.

This path deliberately uses an independent protocol connection rather than a
second checkout from the control pool. A one-connection control pool must still
be able to cancel its sole active backend.

## Driver And PostgreSQL Boundary

The installed node-postgres runtime records BackendKeyData as `processID` and
`secretKey`, although `@types/pg` omits those fields and the underlying
connection's `connect` and `cancel` methods. The adapter validates the process
ID and signed 32-bit secret, invokes only that installed protocol capability,
and fails quarantine closed when it is unavailable. A node-postgres upgrade
must retain this runtime contract or replace it with an equally authenticated
session-cancellation capability before acceptance remains green.

The cancellation client uses the pool configuration to resolve the same
PostgreSQL endpoint. Constructing node-postgres `Client` may retain the
configured password in memory, but the adapter never invokes SQL
authentication and does not send, log, or otherwise inspect that password.
CancelRequest is a PostgreSQL startup packet and requires no extra database
privilege. The connection keeps an error listener for its whole lifetime.
An `ECONNRESET` or `EPIPE` after the cancel packet was sent is accepted as the
server closing the one-shot protocol connection; pre-send errors, timeout, or
transport-destruction failure remain cleanup failures. No
`pg_terminate_backend`, `pg_signal_backend`, superuser, database creation, or
role creation grant is used.

PostgreSQL requires a cancellation connection to preserve the original
session's encryption and host-verification requirements. This slice has only a
plaintext local PostgreSQL acceptance lane, and its low-level node-postgres
protocol path does not implement default or direct TLS negotiation. It therefore
detects a resolved TLS client configuration and fails quarantine closed before
opening the cancellation socket. TLS, Hyperdrive, and hosted activation remain
gated until an encrypted CancelRequest path and native TLS acceptance exist.

## Failure Semantics

Backend cancellation is cleanup, not business recovery and not a retry:

- if authenticated cancellation succeeds, tracked work must drain before
  original-client release;
- if cancellation cannot start or cannot be confirmed, the adapter destroys
  the exact original client before its bounded drain fallback;
- any attempted cancellation or cancellation-transport failure remains a
  quarantine failure for a native node-postgres connection even if original
  work subsequently settles;
- unresolved work, original transport-end timeout, release failure, and
  cancellation failure are combined in the existing quarantine cleanup cause;
  and
- initial uncertainty remains initial uncertainty, while recovery still runs
  at most once on a distinct backend.

The adapter must never translate cancellation failure into an artifact
collision, absence, retryable error, or committed transaction decision.

## Acceptance

The correction is complete only when all of the following pass:

- the original active-`INSERT` deadline case observes its target PID absent
  before admission returns;
- that case passes with the artifact control pool capped at one connection;
- recovery cancels only its second blocked backend, returns one final
  `decisionUncertain`, and leaves both attempt PIDs absent;
- both cases retain zero artifact rows after failure and accept one clean
  retry;
- deterministic control-session coverage retains stuck-work timeout,
  release/rollback failure, interruption, distinct recovery, and complete
  `Cause` behavior;
- package typecheck, core lint, diff lint, and the consolidated artifact matrix
  pass; and
- the required TypeScript/Effect and systems-quality reviewers find no
  unresolved correctness issue.

## Non-Goals

This slice does not:

- add general query cancellation to all Flarex persistence operations;
- change application-row transactions, OCC, commit feeds, or outbox behavior;
- activate framework installation, Payload, Medusa, CMS, or ecommerce flows;
- prove TLS, Hyperdrive, or hosted Cloudflare cancellation behavior;
- add or depend on PostgreSQL signaling privileges; or
- claim that local PostgreSQL acceptance establishes production readiness.

## Local Evidence

Against an authenticated ordinary PostgreSQL 18 role, the focused admission
file passes `21/21` with no skips, the control-session adapter file passes
`26/26`, and the consolidated fourteen-file artifact matrix passes `142/142`.
Package typecheck and final lint/reviewer receipts belong to the implementation
checkpoint rather than expanding this runtime claim.
