# DTE03-C: Completion Failure, Retry, OOM, And Attempt Policy

## Receipt Status

**Status:** Complete — admit the DTE03-C failure taxonomy, bound retry policy,
attempt ceiling, deterministic delay algorithm, OOM escalation, terminal
classification, and policy evaluation order.

**Decision:** Preserve Trigger's useful retry formula and failure-policy order,
but validate every value, use the jitter captured with the attempt, derive time
from the database, enforce one inclusive total-attempt limit, and keep foreign
failure mapping outside the pure lifecycle decision.

This receipt fills the policy-owned leaves in DTE03-B's five-phase aggregate.
DTE03-D still owns command transition and race tables. DTE03-E owns the exact
operation outcome, evidence, requested-effect, inspection, and typed error
unions. No package, schema, migration, adapter, host, scheduler, route, or
activation is authorized here.

## Pinned Trigger Behavior

The pinned Trigger source establishes these compatibility facts:

- default retry policy is three total attempts, factor `2`, minimum delay
  `1,000ms`, maximum delay `60,000ms`, with randomization enabled;
- the current failed attempt number is passed to the delay helper;
- no retry is returned when `attempt >= maxAttempts`;
- randomized delay uses a multiplier in `[1, 2)` from `Math.random() + 1`;
- the delay is capped before being rounded to the nearest integer;
- cancellation is recognized before ordinary failure retry;
- OOM escalation is evaluated before general retry eligibility;
- general non-retryable failure terminates before retry configuration lookup;
- absent/invalid run retry configuration terminates rather than inventing a
  fallback;
- an OOM target equal to the current machine cannot escalate again; and
- OOM retry uses durable queue delivery.

Trigger's source also contains policy weaknesses that Flarex must not retain:

- its Zod retry schema accepts unbounded/negative numeric combinations;
- it samples `Math.random()` during retry calculation;
- it calculates absolute retry time from `Date.now()`;
- attempt start and completion use different global-ceiling comparisons;
- OOM detection relies partly on Trigger process-message substrings;
- OOM configuration lookup catches foreign storage errors and silently treats
  them as no escalation; and
- task errors retain product-specific stacks and error spellings.

The Flarex contract keeps the algorithmic behavior while replacing those
authority, validation, and uncertainty gaps.

## Exact Bound Policy

`RunAttemptPolicyV1` is exactly:

```ts
interface RunAttemptPolicyV1 {
  readonly version: 1;
  readonly retry: {
    readonly maxAttempts: TaskMaximumAttemptsV1;
    readonly factor: TaskRetryFactorV1;
    readonly minTimeoutInMs: TaskDurationMsV1;
    readonly maxTimeoutInMs: TaskDurationMsV1;
    readonly randomize: boolean;
  };
  readonly outOfMemory:
    | { readonly kind: "disabled" }
    | {
        readonly kind: "escalate_once";
        readonly computeProfile: TaskComputeProfileRefV1;
      };
}
```

### Numeric Bounds

| Value | Exact validation |
| --- | --- |
| `TaskMaximumAttemptsV1` | positive safe integer in `1..250` |
| `TaskRetryFactorV1` | finite number greater than or equal to `1` |
| `minTimeoutInMs` | non-negative safe integer |
| `maxTimeoutInMs` | non-negative safe integer and greater than or equal to `minTimeoutInMs` |
| `maximumDurationMs` | positive safe integer |
| `leaseDurationMs` | positive safe integer |
| `immediateRetryThresholdMs` | non-negative safe integer |

There is no hidden independent global-attempt setting. `250` is both the
schema maximum and the retained Trigger safety ceiling. A deployment cannot
raise it through Layer configuration, a command, a task manifest, or a stored
row.

Factor values below `1`, negative/NaN/infinite values, fractional attempt
counts, negative delays, `min > max`, and unsafe integers fail task-definition
analysis or stored-policy decoding. Trigger happened to accept some of those
values; no admitted compatibility scenario depends on them, and retaining
them would make delay direction and overflow undefined.

### Defaults

Omitted private definition fields normalize once to:

```text
maxAttempts = 3
factor = 2
minTimeoutInMs = 1,000
maxTimeoutInMs = 60,000
randomize = true
outOfMemory = disabled
```

The normalized policy is captured in the immutable task-definition binding and
then in `TaskRunAttemptBoundPolicyV1`. Existing runs never adopt new defaults
after restart or activation change.

### OOM Configuration

`escalate_once` names one already-admitted `TaskComputeProfileRefV1`. It is a
policy target, not a machine, provider, region, price, runtime artifact, or
credential. Task-definition analysis must reject an escalation target equal to
the initial compute profile because it cannot change capacity.

The policy supports the DTE01-admitted OOM escalation branch without importing
Trigger machine presets. The default stays disabled. A later public API may
choose whether to expose this private option, but it must lower to this same
closed policy.

## One Attempt-Ceiling Rule

`maxAttempts` counts total granted attempts, including the initial attempt.
For a failed or lease-expired current attempt numbered `n`:

```text
another attempt is available iff n < policy.retry.maxAttempts
```

Because `maxAttempts <= 250`, no second global comparison is needed. Examples:

| `maxAttempts` | Accepted grants | Retry after attempt 1 | Retry after last grant |
| ---: | --- | --- | --- |
| 1 | attempt 1 only | no | no |
| 3 | attempts 1, 2, 3 | yes | no after attempt 3 |
| 250 | attempts 1 through 250 | yes | no after attempt 250 |

The failure from the last attempt remains the terminal failure. Reaching the
attempt limit is a retry-decision reason, not a replacement terminal failure
class.

DTE03-B is refined accordingly:

- valid `ready` and `retry_waiting` aggregates must have another attempt
  number available;
- accepted failure/lease-expiry policy never creates a retry state without a
  remaining attempt;
- `startAttempt` rechecks the invariant before using its allocation candidate;
  and
- a stored startable aggregate at its limit is corruption or an invalid stored
  transition, not an accepted `attempt_limit_exhausted` terminalization.

This removes Trigger's difference between “next attempt greater than 250” at
start and “current attempt greater than 250” during completion.

## Exact Failure Union

`TaskExecutionFailureV1` is a bounded, sanitized, closed union:

```ts
type TaskExecutionFailureV1 =
  | {
      readonly kind: "task_failure";
      readonly code:
        | "uncaught_exception"
        | "input_validation_failed"
        | "output_validation_failed"
        | "middleware_failed"
        | "handler_failed";
      readonly message: TaskFailureMessageV1 | null;
    }
  | {
      readonly kind: "system_failure";
      readonly code:
        | "attempt_dispatch_failed"
        | "runtime_start_failed"
        | "execution_lost"
        | "execution_aborted"
        | "provider_evicted"
        | "provider_failure"
        | "task_binding_unavailable"
        | "configuration_invalid"
        | "internal_invariant";
      readonly message: TaskFailureMessageV1 | null;
    }
  | {
      readonly kind: "resource_exhaustion";
      readonly code:
        | "out_of_memory"
        | "possible_out_of_memory"
        | "process_crashed"
        | "disk_exhausted";
      readonly message: TaskFailureMessageV1 | null;
    }
  | {
      readonly kind: "timed_out";
      readonly code: "maximum_duration_exceeded";
      readonly message: TaskFailureMessageV1 | null;
    };
```

`TaskFailureMessageV1` is a primitive string with these exact constraints:

- at most 1,024 UTF-8 bytes;
- no U+0000 through U+001F control code point;
- no U+007F through U+009F control code point; and
- no normalization, stack, path, source excerpt, arbitrary metadata, nested
  cause, or foreign serialized error.

An absent safe message is `null`; empty string is rejected rather than treated
as absence. The failure code is stable program logic; the message is diagnostic
only and never affects retry, equality, authorization, or terminal class.

Cancellation is not a failure member. It uses the already-admitted
`cancellation_acknowledged` completion and `TaskCancellationStateV1`.

## Failure Producer Boundary

The runtime/compute adapter owns translation from an exception, process exit,
provider result, signal, schema failure, or Trigger compatibility receipt into
`TaskExecutionFailureV1`. It must sanitize and bound the message before calling
the lifecycle service.

The pure domain decision never receives:

- an `Error`, `Cause`, stack, thrown unknown, or rejected Promise;
- Trigger `TaskRunError`, internal code, environment type, or machine name;
- process stderr/stdout, exit message, signal string, pod record, or provider
  response;
- Prisma/Drizzle/Postgres failure; or
- a caller-provided `retryable` or terminal-class Boolean.

Mapping failure at that foreign boundary is an adapter/runtime error. It is not
converted into `internal_invariant` merely so the task can be terminalized.

Trigger OOM message heuristics remain compatibility-runner inputs only. A
production Flarex adapter may emit `out_of_memory` or
`possible_out_of_memory` only from its approved compute-provider evidence; the
domain package does not scan strings for `SIGKILL`, `-1`, ffmpeg, or V8 text.

## Terminal Classification

Terminal class is a total projection from the failure kind:

| Failure kind | `TaskTerminalFailureClassV1` |
| --- | --- |
| `task_failure` | `task_failure` |
| `system_failure` | `system_failure` |
| `resource_exhaustion` | `resource_exhaustion` |
| `timed_out` | `timed_out` |

`TaskTerminalFailureClassV1` therefore has exactly those four members.
Trigger's `COMPLETED_WITH_ERRORS`, `SYSTEM_FAILURE`, `CRASHED`, and `TIMED_OUT`
labels are later read-projection mappings, not stored lifecycle statuses.

## Retry Eligibility Table

Retry eligibility is derived from the closed failure code; it is never carried
inside the failure value:

| Failure code | Policy eligibility | Notes |
| --- | --- | --- |
| `uncaught_exception` | ordinary retry | retains Trigger user-error retry behavior |
| `input_validation_failed` | ordinary retry | completion directive may still choose `do_not_retry` |
| `output_validation_failed` | ordinary retry | retains admitted task-output retry behavior |
| `middleware_failed` | ordinary retry | retains Trigger locked-policy lookup behavior |
| `handler_failed` | ordinary retry | bounded replacement for built-in/string/custom task failures |
| `attempt_dispatch_failed` | ordinary retry, durable delivery | pre-heartbeat loss cannot use process-local continuation |
| `runtime_start_failed` | ordinary retry, durable delivery | runtime could not begin safely |
| `execution_lost` | ordinary retry, durable delivery | synthesized by expired executing lease |
| `execution_aborted` | ordinary retry, durable delivery | approved compute/system abort, not user cancellation |
| `provider_evicted` | ordinary retry, durable delivery | retains provider-eviction recovery |
| `provider_failure` | ordinary retry, durable delivery | bounded provider failure |
| `task_binding_unavailable` | never retry | immutable binding/configuration problem |
| `configuration_invalid` | never retry | retry cannot repair accepted invalid configuration |
| `internal_invariant` | never retry | platform defect, not ordinary workload retry |
| `out_of_memory` | OOM policy only | never falls through to ordinary retry |
| `possible_out_of_memory` | OOM policy only | same conservative escalation branch |
| `process_crashed` | ordinary retry, durable delivery | non-OOM process crash may recover |
| `disk_exhausted` | never retry | another attempt on the same bound policy is not corrective |
| `maximum_duration_exceeded` | never retry | maximum duration is terminal |

“Ordinary retry” still requires a retry directive that does not prohibit retry
and a remaining attempt. “Durable delivery” forces `retry_waiting` even when
the delay is below the immediate threshold.

## Retry Directive Semantics

The DTE02 union remains exact:

```ts
type TaskRetryDirectiveV1 =
  | { readonly kind: "use_bound_policy" }
  | { readonly kind: "do_not_retry" }
  | {
      readonly kind: "override_delay";
      readonly delayMs: TaskDurationMsV1;
    };
```

Its precedence is:

1. `do_not_retry` terminates the failure before OOM or ordinary retry;
2. `use_bound_policy` uses the deterministic bound-policy delay; and
3. `override_delay` uses the supplied bounded delay without jitter.

An override changes only delay. It cannot make a never-retry failure eligible,
add an attempt, enable OOM escalation, choose a compute profile, change terminal
classification, select immediate delivery for a forced-durable failure, or
provide an absolute timestamp.

The runtime adapter selects a directive under its own trusted task-execution
contract. User code cannot submit a lifecycle command directly or use the
directive to bypass task-definition policy.

## Deterministic Bound-Policy Delay

For a failed current attempt numbered `n`, bound policy computes:

```text
multiplier = randomize ? (1 + storedRetryJitter) : 1
uncapped = multiplier * minTimeoutInMs * factor^(n - 1)
capped = min(maxTimeoutInMs, uncapped)
delayMs = roundToNearestNonNegativeInteger(capped)
```

`storedRetryJitter` is the `TaskRetryJitterV1` captured when attempt `n` was
granted. It is in `[0, 1)`. A completion replay therefore derives the same
delay. When `randomize` is false, the stored sample remains evidence but is not
used.

Rounding matches JavaScript `Math.round` for non-negative values: an exact half
rounds toward positive infinity. The returned delay is a non-negative safe
integer and never exceeds `maxTimeoutInMs`.

The implementation must use saturating comparison rather than relying on an
overflowing `Math.pow` result:

1. if `minTimeoutInMs` or `maxTimeoutInMs` is zero, return zero;
2. determine whether the exponential product reaches the maximum before
   materializing an unsafe/infinite intermediate;
3. return the maximum immediately when it saturates;
4. otherwise compute the finite product, apply the multiplier, cap, and round;
   and
5. treat a non-finite or unsafe result from an allegedly validated policy as
   policy corruption/defect, never as delay zero.

This is mathematically equivalent to the pinned Trigger formula over admitted
inputs while remaining deterministic and bounded.

## Retry Eligibility Time

For either bound or override delay:

```text
notBeforeMs = databaseNowMs + delayMs
```

Addition must remain a non-negative safe integer and within the persistence
adapter's admitted timestamp range. The command cannot provide `databaseNowMs`
or `notBeforeMs`.

Overflow from a valid decoded aggregate at a current database time is a typed
policy/counter failure with no write. Roadmap 04 must reject a newly bound
policy that cannot be represented by its target timestamp type; an adapter may
not clamp the value silently.

## Immediate Versus Durable Retry

After a retry is accepted:

- OOM escalation is always durable;
- retry synthesized from `handleLeaseExpiry` is always durable;
- `attempt_dispatch_failed`, `runtime_start_failed`, `execution_lost`,
  `execution_aborted`, `provider_evicted`, `provider_failure`, and
  `process_crashed` are always durable;
- an ordinary failed completion is `ready` with `immediate_retry` when
  `delayMs < immediateRetryThresholdMs`; and
- it is `retry_waiting` when
  `delayMs >= immediateRetryThresholdMs`.

Equality chooses durable retry, matching Trigger's warm-start threshold
comparison. A threshold of zero makes every retry durable.

Immediate retry remains durable state and still enforces `notBeforeMs`.
`continue_retry` is a latency hint to a current compute consumer, not authority
to start early. Durable retry emits `wake_retry`; a lost wake is recovered by
Roadmap 04/05 due-run discovery.

## OOM Escalation Algorithm

For `out_of_memory` or `possible_out_of_memory`, after `do_not_retry` and the
remaining-attempt check:

1. `outOfMemory.kind === "disabled"` terminates as resource exhaustion;
2. an `escalate_once` target equal to the current attempt compute profile
   terminates as resource exhaustion;
3. otherwise accept one retry using the target compute profile;
4. compute delay from `use_bound_policy` or `override_delay` as above;
5. record the original resource failure in `TaskAcceptedRetryV1`; and
6. enter `retry_waiting` and request durable wake delivery.

Because the next attempt stores the escalation target as its current compute
profile, another OOM cannot escalate to the same target. The ordinary retry
table is not consulted for an OOM code.

All OOM policy data is already in the decoded aggregate. There is no storage
lookup, caught lookup error, Trigger machine-price calculation, or host callback
inside the decision. A malformed/missing compute-profile binding is corruption
or runtime-resolution failure at its owner, not “OOM escalation unavailable.”

## Exact Failed-Completion Policy Order

After DTE03-D's command replay, current-attempt/fence, phase, and cancellation-
race checks accept a `failed` completion for policy evaluation, the pure order
is exactly:

1. validate `TaskExecutionFailureV1`, directive, duration, and canonical
   completion value;
2. project terminal class from failure kind;
3. if directive is `do_not_retry`, terminalize with the original failure;
4. if current attempt number is not strictly below `maxAttempts`, terminalize
   with the original failure and record attempt-limit retry rejection;
5. if failure is OOM/possible OOM, run only the OOM escalation algorithm;
6. if the failure table says never retry, terminalize with the original
   failure;
7. choose bound-policy or override delay;
8. derive `notBeforeMs` from transaction database time with checked arithmetic;
9. choose forced-durable, threshold-durable, or immediate delivery;
10. remove current attempt/fence/lease authority;
11. append the canonical completion replay;
12. construct the next `ready`, `retry_waiting`, or `terminal` aggregate; and
13. return ordered evidence/effect intents for one atomic commit.

No requested effect is delivered during this order. A policy calculation
failure produces no transition, replay entry, evidence, or effect.

Cancellation acknowledgement is a different completion variant and never
passes through failure policy. Successful completion also bypasses this
policy. DTE03-D decides how an already-requested cancellation races a success
or failed completion before step 1.

## Lease-Expiry Failure Synthesis

DTE03-D will apply these fixed policy inputs when a matching lease expires:

| Active phase | Synthesized failure | Retry delivery |
| --- | --- | --- |
| `attempt_granted` | `system_failure/attempt_dispatch_failed` | forced durable |
| `executing` | `system_failure/execution_lost` unless approved compute evidence already supplied a stronger failure | forced durable |
| either active phase with cancellation requested | no failure; resolve terminal cancellation by lease expiry | not applicable |

The generic lease-expiry command carries no foreign process evidence, so the
domain may not guess OOM from missing heartbeats. A compute adapter that has
authoritative OOM evidence must deliver a fenced failed completion before the
lease-expiry transition wins.

This deliberately removes Trigger's configurable “treat production stalls as
OOM” heuristic from lifecycle authority.

## Terminal Outcome Refinement

DTE03-B's failed terminal outcome is refined to:

```ts
type TaskTerminalFailureClassV1 =
  | "task_failure"
  | "system_failure"
  | "resource_exhaustion"
  | "timed_out";
```

The `attempt_limit_exhausted` member is removed. A terminal failed outcome
always contains the original bounded failure and normally the attempt that
produced or acquired it. A valid startable state cannot discover ordinary
attempt exhaustion at start.

`attempt: null` remains permitted only for a Roadmap 04/system failure that
terminates a run before any attempt was granted. DTE-IP01 failed completion and
lease-expiry transitions always name their current attempt.

## Evidence Requirements For Later DTE03-E

DTE03-E must provide bounded evidence sufficient to explain policy without
copying raw errors:

- failure kind/code and optional safe message;
- current and maximum attempt number;
- directive kind;
- retry eligibility result and rejection reason;
- stored jitter used/not used;
- computed delay and database-derived not-before time when retrying;
- delivery selection and its reason;
- previous and next compute-profile references only for OOM escalation; and
- terminal class when terminalizing.

The evidence is diagnostic/audit data committed with the transition. It is not
a second policy input and cannot be edited to change state.

## Compatibility And Difference Matrix

| Source behavior | Flarex result |
| --- | --- |
| three-attempt defaults and exponential formula | retained exactly over admitted inputs |
| random multiplier `[1,2)` | retained through stored `[0,1)` jitter |
| `Math.random()` at completion | replaced by start-captured deterministic sample |
| `Date.now()` retry timestamp | replaced by transaction database time plus delay |
| global maximum 250 | retained as schema maximum |
| start/completion off-by-one difference | replaced by one inclusive total-attempt rule |
| unbounded/negative retry options | rejected during analysis/decode |
| Trigger error shapes/stacks | mapped once to bounded Flarex failure union |
| development stalled run becomes cancellation | removed; cancellation requires accepted cancellation state |
| production stall optionally guessed as OOM | removed; lease loss is system failure without compute evidence |
| OOM retry on different machine | retained as one different compute-profile escalation |
| repeated OOM on target machine | terminal resource exhaustion |
| OOM policy lookup catches storage error | removed; immutable policy is already in aggregate |
| OOM retry uses queue | retained as forced durable retry |
| long delay uses queue threshold `>=` | retained as durable threshold comparison |

DTE03-F must mark the authority replacements as expected differences while
preserving normalized retry/terminal outcomes.

## Required Policy Tests And Vectors

DTE03-F and DTE-IP01 must cover at least:

- defaults for attempts 1 and 2, then terminal attempt 3;
- exact `maxAttempts` values 1, 3, and 250;
- no grant 251 and no retry state after attempt 250;
- factor 1, min 0, max 0, min=max, and saturating exponential growth;
- jitter 0 and the greatest representable value below 1;
- randomization disabled ignores stored jitter;
- half-up rounding and max cap before rounding;
- override zero delay and override maximum safe delay;
- checked database-time addition overflow;
- threshold below, equal, and above delay;
- `do_not_retry` precedence;
- every never-retry failure code;
- every ordinary/forced-durable failure family;
- OOM disabled, OOM escalation, repeated OOM on target, and no attempts left;
- failed-completion replay derives identical policy evidence;
- lease-loss retry uses durable delivery and never guesses OOM;
- malformed stored policy is corruption; and
- foreign mapping failure never becomes an ordinary terminal task outcome.

## Decisions Closed By DTE03-C

1. `maxAttempts` is an inclusive total-attempt count in `1..250`.
2. Valid startable states always have another attempt available.
3. Retry defaults and deterministic delay formula are exact.
4. Stored attempt jitter replaces completion-time randomness.
5. Database time replaces absolute caller/host retry timestamps.
6. The failure union has four kinds, closed codes, and bounded single-line
   diagnostic messages without stacks or causes.
7. Retry eligibility is a total code table, not a caller Boolean.
8. `do_not_retry`, OOM, ordinary eligibility, delay, and delivery order is
   fixed.
9. OOM may escalate once to one different Flarex compute profile and always
   uses durable retry.
10. Missing heartbeats do not prove OOM.
11. Terminal failure retains the original failure; attempt-limit exhaustion is
    retry evidence, not a terminal class.
12. Policy arithmetic failure or corrupted policy commits nothing.

## Exact Handoff To DTE03-D

DTE03-D must now define the complete transition/race tables using these fixed
inputs:

- five DTE03-B phases;
- orthogonal cancellation request/resolution;
- active grant versus heartbeat-proven execution;
- exact attempt availability rule;
- exact retry/terminal decision order;
- forced-durable lease-loss and OOM behavior; and
- terminal failure carrying the original bounded failure.

It must decide accepted/idempotent/current/conflict behavior for every command,
especially cancellation request versus success/failure completion, first and
duplicate heartbeat, early and stale expiry, and completion versus expiry.

Do not create `packages/durable-task/` until DTE03-G admits the complete
lifecycle contract.

## Reopening Audit

DTE03-C does not reopen DTE01/DTE02 authority or package boundaries:

- it uses only already-admitted Trigger retry/error source behavior;
- it requires no new runtime dependency or source island import;
- it keeps the six commands and two-operation store port unchanged;
- it uses the already-admitted retry directive, jitter, database time,
  duration, attempt number, and compute-profile reference owners;
- the `escalate_once` member fills Roadmap 03's explicitly deferred OOM policy
  under the existing `RunAttemptPolicyV1` field; it adds no task-manifest field
  or host authority;
- it adds no public export, persistence type, environment branch, queue, or
  compute-provider API; and
- it corrects DTE03-B's provisional attempt-limit terminal member within the
  same still-open Roadmap 03 lifecycle gate.

## Authority And Evidence

- [`../03-run-attempt-engine.md`](../03-run-attempt-engine.md)
- [`13-phase-terminal-and-aggregate-model.md`](./13-phase-terminal-and-aggregate-model.md)
- [`12-current-lifecycle-and-transition-inventory.md`](./12-current-lifecycle-and-transition-inventory.md)
- [`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md)
- [`06-task-target-and-definition-contract.md`](./06-task-target-and-definition-contract.md)
- [`05-final-package-admission.md`](./05-final-package-admission.md)
- [`source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json)
- frozen Trigger `retrying.ts`, `errors.ts`, `consts.ts`, core retry schemas,
  retry helpers, error predicates, sanitizers, and tests at commit
  `f10bc23785e569e5d917318cf2033aabdbe96a0b`
