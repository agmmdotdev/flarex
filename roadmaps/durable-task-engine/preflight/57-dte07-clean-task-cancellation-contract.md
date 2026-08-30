# DTE07 Clean Task Cancellation Contract Preflight

Status: implementation checkpoint approved on 2026-08-29.

Evidence snapshot: 2026-08-29 current repository state at commit `b65de92b`.

## Decision

Add one unversioned clean primitive over the private command adapter completed
by preflight 56:

```ts
cancelTask(run, { reason?: string }): Effect<
  CancelTaskResult,
  CancelTaskError,
  StandardApplicationTaskCancellation
>
```

The options object is optional. An omitted reason becomes the lifecycle-owned
`{ code: "requested", message: null }`. A provided reason is decoded through
the existing durable cancellation-reason Schema before command I/O. The clean
operation owns only the plain string input and its clean option failure.

## Authentication And Command Order

`cancelTask()` authenticates the opaque process-local `TaskRun` handle before
option decoding, service lookup, or command I/O. A forged or foreign-process
handle remains an invariant defect with the existing
`Task run metadata is unavailable.` message.

For an authentic handle, the order is:

```text
authenticate handle
  -> decode optional reason with code "requested"
  -> submit exactly one scope-captured Standard cancellation command
  -> project the authoritative receipt into one clean frozen result
```

There is no status inspection before the command, no retry, no timeout, and no
provider call. The existing lifecycle transaction remains the sole authority
for cancellation generation, active-attempt fencing, idempotency, terminal
state, evidence, and requested delivery effects.

## Reason Contract

A provided reason follows the existing safe cancellation-message contract:

- it is a string with at least one code unit;
- it is at most 1,024 UTF-8 bytes; and
- it contains no C0 or C1 control characters.

Whitespace is significant and is not trimmed or normalized. Invalid input
fails as `CancelTaskOptionsError` with `field: "reason"` and
`reason: "invalidMessage"`. The underlying Schema issue is not exposed. The
failure occurs before the Standard cancellation service is requested.

## Clean Result

The operation returns a frozen `CancelTaskResult` containing:

- the authenticated run ID;
- authoritative `observedAtMs` and `runVersion` values from the command
  receipt;
- `replayed`, which is true only for an idempotent lifecycle receipt; and
- one clean status:
  - `cancellationRequested`: the request committed against an active attempt;
  - `cancelled`: the run became terminal without an active attempt;
  - `alreadyRequested`: cancellation was already pending; or
  - `alreadyTerminal`: the run was already terminal.

`cancellationRequested` proves only the durable lifecycle request and its
requested effects committed. It does not prove provider delivery, execution
interruption, acknowledgement, or terminal cancellation. Callers use
`inspectTask()` or `awaitTask()` when they need later authoritative state.

The clean result deliberately omits receipt disposition names, attempt IDs,
attempt numbers, fences, cancellation generations, reasons, raw state,
evidence, requested effects, locators, and provider details.

## Failure Contract

`CancelTaskError` is the union of:

- `CancelTaskOptionsError`; and
- after the later preflight 69 cleanup, `TaskCancellationError`, which carries
  the authenticated clean run ID, a stable camel-case reason, and the exact
  Standard owner failure as an opaque cause.

Already-requested and already-terminal outcomes are successful observations,
not typed failures.

## Ownership

- `@flarex/application-invocation` owns handle authentication, the plain reason
  option, clean option error, receipt projection, and clean result names;
- `@flarex/standard-application-invocation` owns the private scope-captured
  command bridge and a narrow reason decoder facade;
- `@flarex/durable-task` retains message Schema, lifecycle decision, receipt,
  error, idempotency, and requested-effect authority; and
- persistence, delivery, and provider owners remain unchanged.

## Validation

Focused proof must cover:

1. handle authentication happens before options and command I/O;
2. omitted and accepted reasons construct code `requested` exactly;
3. empty, oversized, and control-character reasons fail before command I/O;
4. all four clean statuses and replay projection are exact and frozen;
5. the exact Standard failure is retained by identity as
   `TaskCancellationError.cause` and is not retried;
6. the clean root gains only `cancelTask` plus its types;
7. exact package-import admission rejects broader durable authority; and
8. package tests, typechecks, boundary checks, Oxlint gates, and both standing
   reviews pass before commit.

## Stop

Stop after the private clean `cancelTask()` operation, its options, result,
errors, reason-decoder bridge, tests, boundary receipt, roadmap updates,
validation, review, and commit.

Do not add provider delivery, cancellation waiting, bulk cancellation, retry,
timeout, routes, subscriptions, public SDK compatibility, deployment, or
production activation in this checkpoint.

## Later Clean-Root Scalar Cleanup

The 2026-08-30 clean-root surface audit later made the result's
`observedAtMs` and `runVersion` declarations ordinary `number` and `bigint`
scalars. The values still come unchanged from the authoritative Standard
receipt. This removes private branded type names from the facade without
changing command order, receipt projection, failure identity, or lifecycle
authority.
