---
name: effect-ts-error-handling
description: Design and review Effect failure semantics, including Schema parse failures, pure Result verdicts, ordinary Option absence, typed domain errors, foreign throws/rejections, retry, timeout, cancellation and full Exit/Cause outcomes. Use when adding or changing failure classification, recovery, boundary conversion or logging; preserve defects and lifecycle ownership instead of wrapping ordinary code in broad catches.
---

# Effect TypeScript Error Handling

Classify each failure at its source before choosing its representation or
recovery. Preserve the error's meaning across Schema, Result, Effect and the
outer runtime. Follow repository contracts and the installed Effect version;
examples in the linked reference target Effect v4.

## Choose what the outcome means

| Situation | Use | Do not |
| --- | --- | --- |
| Unknown data violates a runtime contract | Schema decoder, with the owner's input/corruption error | Handwrite the same fields in a parallel interface/predicate, or catch all defects as invalid input |
| Pure recoverable validation/policy verdict retained as data | Result<A, E> | Treat Result as an alternative to having a schema |
| Expected failure while executing a domain/service operation | Effect failure channel E | Return Exit or an ad-hoc success/error union from every method |
| Expected missing value with no error reason | Option<A> | Convert invalid data, permission denial, corruption or transport failure into None |
| Full completion, including defect and interruption | Exit<A, E> and Cause at an owning boundary | Collapse a combined Cause into whichever error is easiest to extract |
| In-process domain/integration error | Data.TaggedError or the established tagged contract | Introduce a broad Error or unknown channel to make types compile |
| Error payload must itself be encoded/decoded | Schema-backed tagged error and an explicit wire projection | Serialize arbitrary exception causes or change an existing public error contract |
| Unexpected bug/invariant failure | Defect | Normalize it as a retryable business failure |
| Cancellation | Interruption with scoped cleanup | Convert it into ordinary success, absence, or retry eligibility |

For data-contract and composition decisions, apply the sibling
[effect-ts-patterns](../effect-ts-patterns/SKILL.md) skill and its
[data-contract reference](../effect-ts-patterns/references/data-contracts.md).
Read [effect-error-patterns.md](references/effect-error-patterns.md) for examples.

## Decode and classify once at the right boundary

Schema owns structure, encoded form and intrinsic value invariants. Compile its
decoder once. Use decodeUnknownEffect when the boundary owns Effect failures;
use decodeUnknownResult for a deliberately pure decoder shared by consumers,
then enter Effect once with Effect.fromResult.

A parsing failure and a current authorization/lease/epoch failure have different
owners. Keep contextual checks after decoding; do not label all refusals
invalidSchema. Preserve canonical codecs, no-getter capture and issuer identity
where their contracts require special mechanics.

Map each foreign throw/rejected Promise at its narrow adapter:

- Expected driver/provider failures become a precise tagged failure.
- Already-classified domain failures propagate without redundant wrapping.
- Unexpected defects stay defects when the boundary can distinguish them.
- A foreign library may intentionally report all failures through rejection;
  classify that documented boundary rather than applying a universal
  instanceof Error rule.

Effect.sync describes deferred synchronous work whose unexpected throw is a
defect. Effect.try and Effect.tryPromise classify actual foreign throws or
rejections. Do not wrap owned validation plus domain orchestration in one broad
catch. Effect.promise is only for a boundary whose Promise cannot reject under
its contract; otherwise use the typed adapter.

A deliberate public/host/domain projection may translate tagged failures once
and retain the original cause. "Never map an already-tagged error" is too broad:
the real prohibition is redundant remapping within the same owning contract.

## Choose composition and recovery

| Intent | Construct |
| --- | --- |
| One success/failure transformation | map, flatMap or mapError in a focused pipeline |
| Several dependent successes or validations | Effect.gen, Result.gen or Option.gen for the representation involved |
| Recover one or several known domain variants | catchTag or catchTags |
| Translate an error without recovery | mapError at the owner-changing boundary |
| Both branches produce plain data | match/fold; Effect.match for Effects |
| Both branches execute Effects | Effect.matchEffect or focused recovery |
| Boundary deliberately owns every typed failure | v4 Effect.catch; v3 catchAll |
| Boundary must handle the whole Cause | Installed catchCause/Exit facilities; preserve interruption and unrelated defects |
| Observe without changing the outcome | Appropriate tap/logging operation at its diagnostic owner |

Keep E intact through ordinary composition. Do not call Effect.result,
Effect.option or Effect.exit merely to inspect an outcome and rebuild the same
success/failure channel. Use these conversions only when their resulting data
is the actual contract. Recover absence from the specific missing-value error,
not from all failures.

Result and Option collections are eager when their array/record is constructed.
Use gen or a lazy iterable when later validation calls must not run after the
first rejection. Effect.all must preserve the operation's concurrency and
cancellation contract; it does not make a database transaction parallel-safe.
Do not mechanically replace every guard with a pipeline.

## Retry and timeout are behavioral contracts

Before retry, establish all of:

1. The exact retryable variants, checked on EVERY failed attempt.
2. An attempt/deadline bound, appropriate delay and cancellation ownership.
3. Idempotency or reconciliation for effects that may already have happened.
4. The final error/outcome when the budget is exhausted.

Do not check one initial error and then run an unrestricted retry policy: a
later terminal failure must stop immediately. Use the installed retry predicate
together with the bounded Schedule/options. Do not invent a fresh outer retry
around an operation that already owns retry or uncertain-commit recovery.

Effect Schedule handles an in-process policy. Persisted retries, wakeups, leases
and fences remain with the durable owner; an in-memory retry loop cannot replace
that evidence. Preserve database-authoritative time where required.

Timeout/interruption does not prove a foreign operation stopped or a commit did
not happen. Signal cancellation and drain/join or quarantine according to its
resource contract. Use recovery/reconciliation for uncertain settlement rather
than executing a mutation again blindly.

## Resource and authority failures stay sticky when the owner requires it

A callback may catch a rejected Promise. If an invalid operation must poison
the root transaction/request, the resource adapter must register the refusal
with that owner before exposing rejection. This includes validation that fails
before a database call. Returning a typed error alone does not latch failure.

Preserve the first complete Cause where the owner promises it. Propagate
already-latched participant failures; do not catch and rebuild them merely to
re-register refusal. Revoked/foreign handles cannot inspect or change another
request's failure state.

Use Scope/acquire-release and owned fibers for cleanup. Keep runtime runners at
actual executable/foreign callback edges. Compose services and Layers at the
host/test boundary instead of provisioning dependencies repeatedly in business
pipelines.

## Observe at the diagnostic owner

Use Effect logging/tracing and failure/Cause taps at the boundary that owns
reporting. Log useful operation and correlation fields with explicit redaction;
do not dump raw inputs, secrets or arbitrary cause objects into public output.
Avoid duplicate logs at every propagation step. Diagnostic effects must have a
deliberate failure policy so a logging failure does not accidentally replace the
original outcome. Defects and interruption remain distinct in full-Cause reports.

## Review and verify

For each changed boundary, identify its input schema/decoder, expected E,
ordinary absence, defects, interruption and any intentional conversion. Check
missing abstractions as well as existing imports.

Verify relevant behavior with focused cases: malformed and omitted data;
expected failure versus defect; a transient failure followed by a terminal one;
retry exhaustion; cancellation and cleanup; caught callback rejection; and
uncertain settlement/replay when the operation owns those semantics.
Do not require every case for a small unrelated edit.

Tests should assert typed failures or full Causes at the appropriate level.
Prefer Effect-aware tests and TestClock where available. Keep one explicit test
runtime bridge where the package needs it. Report concrete bounded violations
and justified exceptions; green typechecking/lint alone is not semantic review.
