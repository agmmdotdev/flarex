# DTE07 Clean Task Await Contract Preflight

Status: implementation checkpoint completed privately on 2026-08-29.

Evidence snapshot: 2026-08-29 current repository state at commit `5f2a9e69`.

## Decision

Add one unversioned clean primitive:

```ts
awaitTask(run, {
  timeout: "30 seconds",
  pollInterval: "250 millis",
}): Effect<Output, AwaitTaskError,
  StandardApplicationTaskRunQuery | StandardApplicationTaskResultQuery>
```

`timeout` is required. `pollInterval` is optional and defaults to 250
milliseconds. Both accept Effect `Duration.Input`, are normalized once before
query I/O, and must resolve to a timer-supported duration between 1 and
2,147,483,647 milliseconds inclusive. The upper bound matches the installed
Effect live-clock timer ceiling; accepting a larger finite duration would
create a timer that never fires.

The operation authenticates the opaque process-local run handle, then repeats
only the scope-authorized point status query while the run is incomplete. It
does not repeatedly attempt a failed query or result read.

```text
opaque TaskRun<Output>
  -> authenticate local handle
  -> normalize supported wait policy
  -> inspect current authoritative status
       incomplete -> interruptible Effect sleep -> inspect again
       succeeded  -> one readTaskResult(run) -> Output
       failed     -> TaskRunFailedError
       cancelled  -> TaskRunCancelledError
  -> cooperative operation timeout -> TaskAwaitTimeoutError
```

## Deadline And Polling Semantics

The timeout covers the initial status query, every sleep and later status
query, and the final result-body read. The first status query is immediate.
The fixed interval is measured by Effect Clock through `Effect.sleep`; no
platform clock, database clock, timer callback, random jitter, exponential
backoff, or manual scheduler is introduced.

The whole wait uses Effect's timeout ownership. When the timer wins, Effect
requests interruption of the in-flight sleep or query and waits for that
fiber's interruption cleanup before returning `TaskAwaitTimeoutError`. The
connected Postgres inspection transaction deliberately contains an
uninterruptible region, so this is a cooperative operation timeout, not a hard
wall-clock or database-statement deadline. A slow uninterruptible query can
delay observation of the timeout until it completes cleanup. Hosts retain
their own request lifetime, database statement-timeout, and connection policy;
changing those persistence owners requires a separate preflight.

Caller interruption follows the same structured cleanup rule and remains
interruption rather than entering the typed failure channel. Deterministic
tests use `TestClock`, including the uninterruptible-query cleanup case.

Polling is observation only and carries no lifecycle authority. Each point
query remains independently scope-authorized and database-backed. No observed
status is used as a transition basis, lease claim, result commitment, or
cancellation command.

## Failure Contract

`AwaitTaskError` is the union of:

- `TaskAwaitOptionsError` for an invalid, infinite, zero, negative,
  sub-millisecond, or above-ceiling timeout or poll interval;
- `TaskAwaitTimeoutError`, retaining the run ID, normalized timeout, and last
  successfully observed status when one exists;
- `TaskRunFailedError`, retaining the exact failed terminal state and its
  authoritative observation identity;
- `TaskRunCancelledError`, retaining the exact cancelled terminal state and
  its authoritative observation identity;
- the exact clean `InspectTaskError`, passed through immediately without a
  second translation, retry, or logging; and
- the exact `ReadTaskResultError` union, passed through immediately after one
  succeeded observation without retry, wrapping, or logging.

A succeeded run whose result commitment is absent continues to fail through
the existing result-query `TaskRunResultUnavailableError` with
`reason: "result_absent"`. A local output-contract mismatch remains the
existing `ApplicationTaskResultContractError`. Neither condition is converted
into a lifecycle terminal error or retried.

## Terminal Evidence

Failed and cancelled errors retain:

- the run ID;
- the authoritative observation time and run version; and
- the exact narrowed terminal state projection.

This avoids inventing a second failure/cancellation schema and preserves the
existing redaction boundary. No diagnostic message, raw aggregate, attempt
row, storage locator, result commitment, or internal command capability is
added.

## Ownership

- `@flarex/application-invocation` owns the wait policy, clean orchestration,
  option errors, timeout projection, and clean terminal errors;
- `@flarex/standard-application-invocation` retains the two private
  scope-authorized query capabilities;
- `@flarex/durable-task` retains lifecycle state, terminal meaning, and result
  availability authority;
- persistence and captured Application scope owners retain database and
  authorization authority; and
- Effect Clock and structured interruption own local wait timing and
  cancellation.

No new Context service or Layer is required. `awaitTask()` composes the two
existing query requirements and leaves their provisioning to the host.

## Validation

Focused proof must cover:

1. the first inspection happens immediately and success reads the result once;
2. incomplete states poll only after the configured interval under
   `TestClock`;
3. failed and cancelled states produce their distinct typed errors and never
   read a result;
4. the timeout stops ordinary polling without a post-timeout query and waits
   for an in-flight uninterruptible query to finish cleanup;
5. caller interruption remains interruption;
6. the clean inspection failure is forwarded once, result failures preserve
   identity, and neither is retried;
7. invalid duration inputs fail before query I/O;
8. forged handles defect before option validation, service lookup, or query
   I/O;
9. the clean root gains only `awaitTask` plus its types; and
10. focused tests, package typechecks, boundary checks, Oxlint gates, and both
    standing reviews pass before commit.

## Stop

Stop after the private clean `awaitTask()` primitive, its errors, tests,
boundary receipt, roadmap updates, validation, review, and commit.

Do not add cancellation, commands, subscriptions, adaptive backoff, jitter,
event cursors, list APIs, public routes, SDK compatibility, deployment, or
production activation in this checkpoint. The private command adapter must be
preflighted separately before `cancelTask()`.
