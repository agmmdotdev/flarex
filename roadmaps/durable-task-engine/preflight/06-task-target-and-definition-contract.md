# DTE02-B: Task Target And Definition Contract

## Decision

**Outcome: ADMIT one existing Standard Application target shape for the first
private task vertical.**

The first Flarex durable task target is exactly:

```text
handler kind: action
visibility: internal
runtime execution group: edge_action
lookup key: canonical functionPath in one authenticated active revision
```

This decision reuses the existing `internalAction` declaration, Standard
Application definition and analysis pipeline, canonical function metadata,
candidate function-group entry, and `edge_action` runtime projection. It does
not add a `task` function kind, a second analyzer, public task syntax, or an
action execution route.

The target is definition-admissible and invocation-inert. Current production
runtime authority does not execute actions end to end. Roadmap 06 must admit a
candidate-bound action runtime target and compute route before any task attempt
can invoke user code. Unknown or unsupported execution must fail closed; it
must never fall back to the current mutation route.

## Why `internalAction`

### It Matches Task Execution Semantics

A durable task attempt is non-transactional orchestration that may be retried,
interrupted, or resumed by platform policy. It must not imply that the whole
handler is one application-row transaction.

The existing action context is the closest Flarex contract because user code
can perform non-transactional work and call separately authorized queries or
mutations. Those nested database operations continue through their existing
executor, OCC, commit, outcome, feed, and outbox owners. The task engine owns
only task lifecycle state.

This preserves the critical separation:

```text
task attempt lifecycle transaction
  != user application mutation transaction
```

### Internal Visibility Is The First Authority Boundary

The first vertical is a private platform capability, not a direct client
invocation API. Requiring `visibility: internal` prevents a public function
reference from becoming an accidental task-creation authorization surface.

Internal visibility is necessary but not sufficient. The caller still needs a
trusted active application selection and a scope-bound Task System capability.
A caller cannot authorize a task merely by knowing an internal function path.

### The Artifact Model Already Separates Actions

Current candidate materialization groups `action` functions into
`edge_action`; query, mutation, and `workflowMutation` functions are grouped
into `transaction`. The registered function entry already carries:

- canonical function ordinal;
- function path;
- artifact execution module;
- export name;
- handler kind;
- visibility;
- execution group; and
- runtime projection digest and object reference.

The first task target therefore uses an existing artifact boundary rather than
creating a task-specific bundle representation.

## Rejected First-Target Alternatives

### Query

A query is read-only and request/response oriented. It cannot represent a
general durable task attempt and would make retries or long-running
orchestration meaningless.

**Decision:** reject as the first task handler kind.

### Mutation

A mutation is transaction-owned application work. Running an arbitrary
durable task handler as one mutation would conflate task retry and lease
semantics with application OCC and commit semantics. It would also encourage
the task engine to become a second application-data transaction owner.

The existing mutation runtime is not a shortcut for task execution.

**Decision:** reject as the first task handler kind.

### `workflowMutation`

`workflowMutation` is the existing design direction for durable, multi-step,
cross-shard database work with explicit compensation. It is not currently an
end-to-end runtime capability, and its future step/partition semantics are
narrower than a general durable task.

The durable task engine may later provide infrastructure used by a
`workflowMutation` implementation, but binding one run attempt directly to a
`workflowMutation` handler now would pre-decide that separate roadmap's
orchestration and compensation model.

**Decision:** defer; do not use as the first generic task target.

### New `task` Function Kind

Adding a fifth function kind would require coordinated SDK, analyzer,
canonical program, metadata codec, physical artifact, readiness, registration,
activation, code generation, and runtime changes. None is needed to prove the
private task engine.

A future public `task()` API may lower to an internal action plus a task
descriptor, or may justify a distinct canonical kind after the private
vertical. DTE02-B does not decide that public lowering.

**Decision:** reject for the first private vertical.

## Current Reuse Chain

The current source of truth already supports the definition half of the target:

1. `internalAction` produces exclusive `isAction` and `isInternal` markers.
2. The analyzer recognizes `action` and `internal` independently and emits one
   canonical function record.
3. Standard Application definition preparation normalizes the canonical
   program and lowers the source graph without task-specific behavior.
4. Authenticated Standard Application analysis binds source and semantic
   evidence.
5. Application revision registration durably binds canonical function metadata,
   validator, handler-set, candidate, and artifact evidence.
6. Candidate runtime publication places action functions in the existing
   `edge_action` projection.
7. Readiness and activation bind the projection into one active application
   revision.

DTE02-B consumes the result after step 7. It does not inspect SDK objects,
source modules, or analyzer-private state itself.

## Canonical Target Lookup

The backend begins with an issuer-backed
`AuthenticatedActiveApplicationRevisionSelectionV1` and one requested
function path. The future task-target adapter must perform one bounded lookup
with the following order.

### 1. Claim The Active Runtime State

Claim the selection through the existing private active-selection owner. A
structurally similar object, revoked selection, missing selection, or selection
from another process must fail as `notIssued` or the final domain equivalent.

Do not accept active metadata, scope metadata, or runtime publication as
independent caller fields.

### 2. Revalidate Candidate-Level Evidence

Before selecting the function, verify the same candidate-level commitments
used by current runtime target adapters:

- supported storage generation;
- decoded canonical function metadata digest equals active metadata;
- candidate digest equals active metadata;
- candidate runtime-projection-set digest equals active metadata; and
- candidate function-group-manifest digest equals active metadata.

Any mismatch is candidate evidence failure, not an unknown task.

### 3. Select Exactly One Function Metadata Entry

Lookup uses exact canonical `functionPath` equality in the already canonical
function metadata set. The canonical decoder owns duplicate-path rejection and
ordering. The task adapter must not normalize, trim, case-fold, append an
extension, or guess an export name.

Missing metadata or missing function-group entry is `unknownFunction`.

### 4. Require The Exact Task Target Shape

The selected metadata and function-group entry must both prove:

```text
kind / handlerKind = action
visibility = internal
group = edge_action
```

Any other supported Standard Application function is
`unsupportedTaskTarget`, not a fallback candidate.

### 5. Cross-Check Function Evidence

The adapter must reject unless all of the following agree:

- metadata ordinal equals function-group entry ordinal;
- the canonical path contains a valid module/export separator;
- export name equals the canonical path suffix;
- logical execution module resolves to the artifact execution module;
- entry projection digest equals the `edge_action` projection reference;
- the projection contains the selected artifact module; and
- argument and return validators come from the same decoded canonical metadata
  entry.

The exact runtime object-reference and digest projection is finalized by
DTE02-D. DTE02-B fixes the selection algorithm and target shape.

## Logical Task Key

For the first private vertical, the logical task key is the canonical function
path under one Flarex scope:

```text
(trusted scope, canonical functionPath)
```

Only `functionPath` crosses into the definition request as caller intent. The
trusted scope is supplied by the operation-scoped capability, not serialized
beside the path.

This choice has deliberate first-version semantics:

- the same canonical path in a later application revision is the same logical
  task but a different immutable definition revision;
- renaming the path creates a different logical task;
- the path is not globally unique across scopes;
- the path does not authorize invocation; and
- a future public stable task ID may add alias/rename policy without changing
  existing immutable run bindings.

No separate customer-chosen task ID is admitted in the first vertical.

## Immutable Definition Revision Claim

One task-definition revision binds exactly one normalized claim:

```text
trusted scope authority supplied out of band
+ active application revision ID
+ canonical function ordinal and path
+ handlerKind = action
+ visibility = internal
+ executionGroup = edge_action
+ function metadata / validator / handler commitments
+ candidate and runtime-projection commitments
+ selected runtime object references finalized by DTE02-D
+ normalized RunAttemptPolicyV1
```

The working durable identity remains `TaskDefinitionRevisionIdV1`. The exact
identifier codec and generation authority remain DTE02-E decisions.

Changing any claim member creates a different immutable definition revision.
There is no mutable `latest` policy or runtime target inside the revision.

## Versioned Task Policy

### Ownership

Task retry behavior is not added to Standard Application function metadata.
The analyzer proves the handler and artifact. The durable-task domain owns the
run-attempt policy that governs execution of that handler.

The first definition revision binds one normalized `RunAttemptPolicyV1`. Its
decoder and lifecycle algorithm land in the already admitted
`./internal/run-attempt-v1` package surface. This does not authorize a new
task-definition export or reopen the DTE01 package boundary.

### First-Version Normalized Shape

The first version contains only the Trigger-derived retry fields needed by the
admitted lifecycle plus an explicitly disabled compute escalation:

```ts
interface RunAttemptPolicyV1 {
  readonly version: 1;
  readonly retry: {
    readonly maxAttempts: number;
    readonly factor: number;
    readonly minTimeoutInMs: number;
    readonly maxTimeoutInMs: number;
    readonly randomize: boolean;
  };
  readonly outOfMemory: { readonly kind: "disabled" };
}
```

The private input may omit retry members. Normalization fills the admitted
Trigger-compatible defaults:

```text
maxAttempts = 3
factor = 2
minTimeoutInMs = 1,000
maxTimeoutInMs = 60,000
randomize = true
outOfMemory = disabled
```

Semantics are fixed:

- attempts are one-indexed;
- `maxAttempts` is the maximum total number of attempts, including the first;
- after failed attempt `n`, no retry is scheduled when
  `n >= maxAttempts`;
- otherwise the base delay is
  `min(maxTimeoutInMs, minTimeoutInMs * factor^(n - 1))`;
- `randomize: false` uses multiplier `1`;
- `randomize: true` consumes a supplied deterministic jitter sample and
  preserves Trigger's multiplier interval `[1, 2)`;
- the final delay is rounded to the nearest integer millisecond; and
- the lifecycle returns a duration, never a host-clock timestamp.

### Validation Policy

DTE-IP01 must encode the finite/safe constraints in its Effect Schema and
retain invalid input versus stored corruption as different typed failures.
The first bounded policy is:

- `maxAttempts`: safe integer from 1 through 100;
- `factor`: finite number from 1 through 100;
- `minTimeoutInMs`: safe integer from 1 through 86,400,000;
- `maxTimeoutInMs`: safe integer from `minTimeoutInMs` through 86,400,000;
- `randomize`: Boolean; and
- no unknown fields after normalization.

The exponentiation path must reject non-finite or unsafe intermediate/final
durations rather than persisting an unusable retry wake.

The first version deliberately excludes:

- Trigger machine names or pricing tiers;
- OOM compute escalation;
- user callbacks that calculate retry delay;
- error-specific retry callbacks;
- per-environment defaults;
- attempt execution timeout;
- queue priority or concurrency; and
- mutable policy lookup after run creation.

Lease duration, heartbeat cadence, and recovery scan cadence are platform
lifecycle configuration, not user task-definition retry fields. An explicit
attempt execution timeout can be added only through a new versioned policy and
immutable definition revision.

## Registration Idempotency

The working private request-key name is
`TaskDefinitionRegistrationRequestKeyV1`. DTE02-E owns its exact type and
codec, but DTE02-B fixes these input constraints:

- primitive string;
- nonblank under ECMAScript trim semantics;
- no null code unit;
- at most 1,024 UTF-8 bytes; and
- no normalization of the accepted spelling.

The registration operation computes a canonical claim digest from the full
immutable definition claim. Scope is supplied by authority and included by the
persistence owner in the uniqueness boundary.

Required behavior:

| Existing state | New request | Result |
| --- | --- | --- |
| no receipt, no matching claim | any valid key and claim | insert one revision and receipt |
| same key, same claim digest | identical replay | return the original revision |
| same key, different claim digest | conflicting reuse | typed request-key conflict |
| different key, same claim digest | semantically identical registration | converge on the same revision and add/replay the receipt |
| different key, different claim digest | new immutable definition | insert another revision |

The operation must commit the revision and request receipt atomically. A lost
response is resolved by retrying the same request key. It must not create a
second revision or infer success from an active application head alone.

Whether `TaskDefinitionRevisionIdV1` is storage-issued or derived from the
canonical claim remains DTE02-E's decision. Idempotency semantics do not depend
on that representation.

## Definition Versus Invocation Readiness

DTE02-B admits identification and immutable binding, not execution.

The following facts are current:

- `internalAction` can be declared and analyzed;
- action metadata can be registered with an application revision;
- action artifacts can be grouped into `edge_action` and covered by readiness
  and activation evidence; and
- the current exact runtime target and invoke path do not execute actions.

Therefore:

1. tests may prove target selection over authenticated fixture evidence;
2. a future private definition registration may remain production-inert;
3. run creation and attempt dispatch remain closed until DTE02-D, Roadmap 04,
   and Roadmap 06 gates are satisfied; and
4. no route may reinterpret an internal action as a mutation to obtain current
   runtime support.

This is a truthful capability gate, not an implementation blocker for the
host-neutral DTE-IP01 lifecycle package.

## Package Consequences

DTE02-B does not reopen DTE01:

- `RunAttemptPolicyV1` is already part of the admitted run-attempt model and
  Schema ownership;
- the retry algorithm and defaults already have admitted Trigger provenance;
- no new runtime dependency is required;
- no public or package-root export is required;
- no Standard Application or persistence import enters
  `@flarex/durable-task`; and
- the action target lookup remains a future persistence/backend adapter, not
  domain-package code.

A future task-definition service/package surface is not admitted by this
receipt. DTE-IP01 receives an accepted task-definition-revision identity and a
validated policy snapshot through its scope-bound store contract; it does not
register definitions.

## Required Proofs For Later Implementation

### Standard Reuse Proof

- an `internalAction` survives Standard definition, analysis, registration,
  readiness, and activation with one canonical path;
- no task-specific SDK inspection or analyzer branch exists; and
- wrong kind, wrong visibility, duplicate path, or mismatched artifact evidence
  fails closed.

### Policy Proof

- omitted fields normalize to the exact first-version defaults;
- boundary values and invalid numeric values are covered;
- retry attempt numbering and rounding match the pinned Trigger vectors;
- deterministic jitter produces repeatable receipts;
- stored invalid policy is corruption, not defaultable missing input; and
- new fields or variants cannot bypass exhaustive policy handling.

### Idempotency Proof

- identical request replay returns the same revision;
- same key with a different claim conflicts;
- different keys for the same claim converge;
- transaction rollback leaves neither a revision nor receipt;
- lost response followed by replay is safe; and
- scope A receipts cannot replay or discover scope B definitions.

## Decision Receipt

DTE02-B is complete with these exact conclusions:

1. the first private task target is `action` + `internal` + `edge_action`;
2. canonical function path is the first logical task key;
3. target lookup reuses active revision, canonical metadata, and runtime
   publication evidence;
4. task retry policy remains a durable-task domain value, not Standard
   Application metadata;
5. the first retry policy preserves admitted Trigger semantics with bounded,
   deterministic Flarex validation;
6. definition registration is idempotent by request key and canonical claim;
7. no current action invocation capability is claimed; and
8. DTE02-C scope capability is the next preflight.

## Authority And Evidence

This decision is grounded in:

- existing `internalAction` SDK markers and action context;
- canonical declarative function kind and visibility records;
- Standard Application definition and authenticated analysis stages;
- canonical function metadata decoding and duplicate-path rejection;
- candidate runtime projection grouping (`action -> edge_action`);
- application revision registration, readiness, activation, and selection;
- the current mutation-only runtime target's fail-closed pattern;
- [`../02-task-definition-identity-and-scope.md`](../02-task-definition-identity-and-scope.md);
- [`./05-final-package-admission.md`](./05-final-package-admission.md); and
- the retry schema and algorithm in the pinned Trigger.dev source map.
