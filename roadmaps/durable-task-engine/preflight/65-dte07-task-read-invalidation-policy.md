# DTE07 Task read invalidation policy

Status: DTE07-D1 implemented privately on 2026-08-30.

Depends on the accepted Task lifecycle transaction, persisted requested-effect
ledger, and private run/list projections. This checkpoint selects the durable
source fact and adds one pure refetch policy. It does not dispatch the source,
open a subscription, choose a host transport, add a database query or index,
change the requested-effect ledger, expose a route, or activate production.

## Source Decision

Every accepted run-attempt lifecycle transition already persists exactly one
`notify_current_state` requested effect carrying the run identity and accepted
run version. It is written by the existing lifecycle transaction after the new
state is accepted. DTE07-D therefore selects that effect as the source fact for
existing-run advancement invalidation.

The new projector accepts the shared run identity, accepted version, and kind
facet of an already-decoded requested effect. Legacy, Application, and current
persisted effect unions can enter without a cast. It returns an internal
`run_advanced(runId, runVersion)` hint only for `notify_current_state`;
dispatch, wake, cancellation, queue-release, lifecycle-event, and cleanup
effects do not enter the invalidation contract.

This decision does not authorize a reader, claimant, publisher, outbox change,
or background process over the ledger. Those owners require a separate gate.

Initial run creation does not currently persist `notify_current_state` and is
not changed here. The selected source is therefore insufficient by itself for
immediate new-run list invalidation. A later gate must select an authoritative
run-admission fact or separately preflight a change with the run-creation
transaction owner before claiming complete list freshness.

## Bounded Signal Contract

The private signal union is unversioned because it is an in-process current
implementation, not a persisted or wire compatibility contract:

```ts
type TaskReadInvalidation =
  | {
      readonly kind: "run_advanced"
      readonly runId: TaskRunId
      readonly runVersion: TaskRunVersion
    }
  | {
      readonly kind: "refresh_required"
      readonly reason: "reconnected" | "cursor_gap"
    }
```

A signal contains no Task snapshot, state, attempt, event, result, diagnostic,
scope credential, requested-effect sequence, delivery state, or command
capability. A future scope-authorized source owns which consumer receives it.
Adding a scope identifier to a message would not establish authorization.

`refresh_required` is transport evidence, not lifecycle evidence. A future
adapter emits `reconnected` after a connection is re-established and
`cursor_gap` when its own bounded resume contract proves continuity was lost.
This checkpoint does not invent that transport cursor.

## Refetch Policy

The pure point policy compares a signal with one authoritative projection:

- a newer version for the same run requests one refetch;
- an equal or older version is already covered and is ignored;
- a hint for another run is ignored; and
- reconnect or cursor-gap evidence always requests a refetch.

The pure list policy compares the signal with one bounded authoritative page:

- a newer version for a listed run requests a refetch;
- an equal or older listed version is ignored;
- a run absent from the page conservatively requests a refetch because it may
  be newly admitted or outside the page's current knowledge; and
- reconnect or cursor-gap evidence always requests a refetch.

The decision never updates a projection from the hint. Only the existing
scope-authorized list or point query can advance authoritative client state.
Several hints arriving before that read may be coalesced by a later transport,
but the hint's claimed version must not become a substitute checkpoint.

## Loss, Reorder, And Authorization

Duplicate, delayed, and reordered hints whose version is covered by the last
authoritative read are harmless. A jump to a later version needs only one
refetch; intermediate Task states need not be replayed through this live lane
because durable attempt and lifecycle-event history have separate read APIs.

The pure policy cannot detect a notification silently lost by an unspecified
transport. Correctness therefore requires every later transport to surface a
cursor gap or force a refresh on reconnect. A transport that cannot prove
continuity may still be admitted only with an explicit conservative refresh or
polling policy.

The absent-run list rule handles a hint once one exists; it does not manufacture
the missing initial-creation signal. Until a run-admission source is separately
approved, initial list refresh or conservative polling remains necessary for
new-run discovery.

An absent run also cannot become version-covered by a page that still does not
contain it. A later list transport must therefore target subscriptions for
visible run identities or apply bounded scope-level coalescing and deduplication
before using the conservative absent-run rule. Broadcasting every per-run hint
to every page without a bounded fan-out policy is not admitted.

Authorization is rechecked by the authoritative read bundle. A notification
received after authority removal cannot restore access; the later subscription
owner must terminate or reauthorize its connection independently.

## Proof Gate

Focused tests prove:

- only `notify_current_state` projects into a frozen bounded hint, with broad
  Application and current persisted-effect inputs accepted directly;
- a newer matching point and a newer listed run request refetch;
- equal, duplicate, stale, and reordered versions are ignored once covered;
- another point run is ignored while a run absent from a list page refetches;
- reconnect and cursor-gap evidence always refetch point and list reads; and
- the policy returns frozen decisions without mutating projections.

The durable-task typecheck, focused and full package suites, source and package
boundary checks, Oxlint gates, and both standing reviews must pass before
commit. No PostgreSQL lane is required because this checkpoint changes no
persistence behavior or query.

## Stop

Stop after the existing-run advancement source selection, pure signal/refetch
policy, tests, roadmap receipts, validation, review, and commit. A run-admission
source, ledger reader, publication claim, global or per-run transport cursor,
async subscription service, SSE/WebSocket/Durable Object adapter, polling
fallback, clean client hook, public route, UI, and production activation remain
separately approved gates.
