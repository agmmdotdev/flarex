---
name: effect-ts-error-handling
description: Design or review Effect failure classification, recovery, retry, timeout, cancellation and boundary logging. Preserve typed domain failures, ordinary absence, defects, interruption and full Causes; use narrow foreign adapters rather than broad catches.
---

# Effect TypeScript Error Handling

Classify failures at their source; follow repository contracts and installed
Effect APIs. Use [patterns](../effect-ts-patterns/SKILL.md) for representation,
Schema/composition and lifetimes, and
[error examples](references/effect-error-patterns.md) for detailed cases.

## Decode And Classify

- Decode unknown data with its authoritative Schema/codec. Use Effect decoding
  in Effect flow or pure Result decoding then Effect.fromResult. Parse errors,
  authorization/lease/epoch refusal and corruption have distinct owners.
  Preserve canonical capture and issuer-identity semantics.
- Keep expected execution failures in E, ordinary absence in Option, bugs in
  defects and cancellation in interruption. Exit/Cause belongs where complete
  completion is the contract; never select one convenient error from a combined
  Cause or turn denial/corruption/I/O failure into absence.
- Use the existing tagged contract or Data.TaggedError; use Schema-backed errors
  when error payloads require encoding. Keep precise channels and explicit wire
  projections; never serialize arbitrary causes into public output.
- Map foreign throws/rejections once at the narrow adapter: known provider
  failures become tagged errors, classified domain failures propagate, and
  distinguishable defects stay defects. A documented all-rejection library
  boundary needs its own classification, not a universal instanceof Error rule.
- Effect.sync owns deferred synchronous defects; try/tryPromise classify foreign
  failures. Effect.promise requires a non-rejecting Promise contract. Do not
  catch owned validation and orchestration together. A genuine new domain/host
  projection may translate tagged errors once while retaining provenance.

## Recovery

Use catchTag/catchTags for known variants, mapError for an owner-changing
projection, match for plain branches and matchEffect for Effect branches.
Broad typed recovery belongs only where the boundary owns every typed failure;
full-Cause recovery must preserve interruption and unrelated defects.

Do not convert E to Result/Option/Exit just to reconstruct E. Missing-value
recovery must target the missing variant. Preserve eager Result/Option member
construction, sequential short-circuiting, and the concurrency/cancellation
contract of Effect.all; do not make shared transactions parallel implicitly.

## Retry, Timeout And Settlement

Before retry, establish exact eligible variants checked on EVERY failed attempt,
attempt/deadline bounds, delay/cancellation ownership, safe idempotency or
reconciliation, and the exhausted-budget outcome. A later terminal failure must
stop even after an initial transient one. Use bounded installed Schedule/retry
options; do not wrap another retry or uncertain-commit owner in a new retry loop.

In-process Schedule cannot replace persisted retry, wakeup, lease or fencing
state. Preserve database-authoritative time. Timeout/interruption does not prove
foreign work stopped or a commit did not happen: signal and drain/join or
quarantine according to the resource contract, and reconcile uncertain outcomes
before replaying mutations.

## Sticky Failure And Diagnostics

If refusal must poison the root request/transaction, register it with that owner
before exposing rejection, including validation failures before any database
call. A callback can catch a rejected Promise; a typed error alone does not
latch rollback-only state. Preserve the first complete Cause and propagate
already-latched failures without re-registering them. Revoked/foreign handles
cannot read or change another request's failure state.

Observe failures at the diagnostic owner with useful correlation fields and
explicit redaction. Avoid repeated logs, raw inputs/secrets/causes in public
output, and diagnostic failure replacing the original outcome. Keep defects
and interruption distinct.

## Verify

Test the changed boundary's relevant cases: malformed/omitted input, expected
failure versus defect, transient then terminal failure, retry exhaustion,
cancellation/cleanup, caught callback rejection, uncertain settlement and replay.
Assert typed failures or full Causes at their owning level; use Effect-aware
tests/TestClock where available. Do not impose every case on unrelated edits.
