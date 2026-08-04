# DTE03-G: Final Run-Attempt Lifecycle Admission

## Receipt Status

**Complete — decision: `admit`.**

This receipt closes Roadmap 03 after auditing DTE03-A through DTE03-F as one
contract. It opens only the production-inert DTE-IP01 package transplant
defined by DTE01. It does not authorize Roadmap 04 persistence, a Postgres or
PGlite adapter, host wiring, scheduling, compute, observability, public APIs,
or production activation.

At admission time `packages/durable-task/` does not exist. The package may now
be created only inside DTE-IP01 and only with the exact package boundary,
source map, contract, candidate-vector gate, and stop boundary consolidated
below.

## Audited Evidence Set

The decision uses these accepted owners as one closed evidence set:

- DTE01 source reuse, package boundary, provenance, compatibility-island, and
  package rollback receipts;
- DTE02-A through DTE02-G definition, scope, revision, identity, command,
  store-port, and final identity receipts;
- DTE03-A source lifecycle inventory;
- DTE03-B aggregate and legal-state model;
- DTE03-C failure, retry, attempt-ceiling, and timing policy;
- DTE03-D cancellation, heartbeat, lease, replay, and race tables;
- DTE03-E outcomes, evidence, effects, inspection, and typed errors; and
- DTE03-F canonical vectors, exact divergences, and executable contract gate.

The frozen Trigger source remains pinned to
`f10bc23785e569e5d917318cf2033aabdbe96a0b`. The machine-readable source map
contains 29 entries: 25 admitted entries and four explicit discards. The
compatibility suite contains 65 mutation vectors, fourteen complete normalized
inspection cases, 24 effect-cursor cases, eight exact replay links, and 37
named divergences.

## Admission Decision

The decision is **`admit`**, rather than `revise`, `defer`, or `reject`, because:

1. every lifecycle type and operation has one accepted owner;
2. the aggregate, transition, policy, receipt, effect, and error contracts are
   closed rather than placeholders;
3. the compatibility fixtures encode accepted decisions rather than replacing
   missing decisions;
4. every Roadmap 03 exit condition has both a normative owner and executable
   pre-admission evidence;
5. no new Trigger source, runtime dependency, public boundary, identity,
   command, store operation, scope authority, or allocation owner is required;
   and
6. the implementation checkpoint remains substantial, bounded,
   production-inert, and removable before any database or host integration.

There is no residual lifecycle decision deferred into DTE-IP01. Implementation
may expose a contradiction in an admitted contract, but it may not resolve one
silently; it must stop and reopen the owner identified below.

## Consolidated Type Inventory

This section is the package-implementation inventory. Detailed member shapes,
bounds, and discriminants remain normative in their linked owning receipts.
DTE-IP01 must not introduce a parallel temporary model.

### Identity And Command Inputs

DTE02 owns or admits these identity and bounded command values:

- catalog-owned `TaskIdV1`, which never enters a DTE-IP01 command;
- package-owned `TaskDefinitionRevisionIdV1`, `TaskRunIdV1`,
  `TaskAttemptIdV1`, `TaskAttemptNumberV1`, and `TaskExecutionFenceV1`;
- `TaskRunVersionV1`, `TaskLeaseVersionV1`, `TaskHeartbeatSequenceV1`,
  `TaskCancellationGenerationV1`, `TaskDatabaseTimeMsV1`,
  `TaskRetryJitterV1`, `TaskExecutionDurationMsV1`,
  `TaskRequestedEffectSequenceV1`, `TaskResultCommitmentV1`, and
  `TaskCancellationReasonV1`; and
- closed commands `StartAttemptCommandV1`, `HeartbeatAttemptCommandV1`,
  `CompleteAttemptCommandV1`, `RequestCancellationCommandV1`,
  `HandleLeaseExpiryCommandV1`, and `InspectCurrentAttemptCommandV1`, joined by
  `RunAttemptCommandV1`.

Every runtime-decodable value above has an exact closed Effect Schema. Commands
contain domain evidence only. Tenant, organization, project, environment,
deployment, scope, locator, database, queue, Worker, Prisma, Drizzle, and host
clock authority remain outside the values and are captured by the dynamically
acquired private Task System capability.

### Aggregate And Lifecycle State

DTE03-B owns:

- `RunAttemptPhaseV1` with exactly `ready`, `attempt_granted`, `executing`,
  `retry_waiting`, and `terminal`;
- `TaskRunAttemptBoundPolicyV1`;
- `TaskAttemptHistoryCursorV1`, `TaskLeaseHistoryCursorV1`, and
  `TaskRequestedEffectCursorV1`;
- `TaskRunReadyStateV1`, `TaskCurrentAttemptV1`, `TaskAttemptLeaseV1`, and
  `TaskAttemptHeartbeatStateV1`;
- `TaskCancellationNotRequestedV1`, `TaskCancellationRequestedV1`,
  `TaskCancellationResolvedV1`, and `TaskCancellationStateV1`;
- `TaskAcceptedRetryV1`, `TaskRetryCauseV1`,
  `TaskTerminalAttemptRefV1`, `TaskRunTerminalOutcomeV1`,
  `TaskTerminalFailureClassV1`, and `TaskAttemptCompletionReplayV1`; and
- `TaskRunAttemptAggregateV1` with its five phase-specific aggregate members.

The Schema must reject every combination outside DTE03-B's legal-state matrix.
Roadmap 04 alone may create the fixed initial `ready` aggregate. DTE-IP01
accepts an already-created aggregate and never repairs or infers malformed
state.

### Policy, Completion, And Failure

DTE03-C owns:

- `RunAttemptPolicyV1` and its fixed bounds/defaults;
- `TaskExecutionFailureV1`;
- `TaskAttemptCompletionV1`;
- `TaskRetryDirectiveV1` and `TaskRetryDeliveryV1`;
- `TaskTerminalFailureClassV1`; and
- the pure retry eligibility, attempt-ceiling, stored-jitter delay, checked-time
  arithmetic, OOM escalation, terminal classification, and lease-loss failure
  policies.

The single inclusive `maxAttempts` rule is `1..250`. Failed-completion policy
preserves the exact first-failure order recorded in DTE03-C. Database time and
stored jitter are inputs; runtime clocks and fresh randomness are not.

### Outcomes, Inspection, Decisions, And Receipts

DTE03-E owns:

- `StartAttemptOutcomeV1`, `HeartbeatAttemptOutcomeV1`,
  `CompleteAttemptOutcomeV1`, `RequestCancellationOutcomeV1`, and
  `HandleLeaseExpiryOutcomeV1`;
- `StartAttemptCurrentReasonV1`, `HeartbeatAttemptCurrentReasonV1`,
  `CompleteAttemptCurrentReasonV1`, `RequestCancellationCurrentReasonV1`, and
  `HandleLeaseExpiryCurrentReasonV1`;
- `RunAttemptStateV1`, `RunAttemptInspectionV1`, and `TaskAttemptGrantV1`;
- `TaskRunAttemptDecisionV1<Outcome>`;
- `TaskRunAttemptAcceptedReceiptV1<Outcome>`,
  `TaskRunAttemptDirectCommandIdentityV1`, and
  `TaskRunAttemptMutationAcceptanceV1`; and
- the service-level `RunAttemptServiceReceiptV1<Outcome>` with only
  `accepted`, `idempotent`, or `current` dispositions.

Inspection is a detached domain projection. It excludes fences, scope
authority, physical locators, raw rows, completion replay bodies, effect
delivery state, and host/runtime capabilities.

### Evidence And Requested Effects

DTE03-E owns:

- `TaskFailurePolicyDecisionEvidenceV1`;
- the closed `TaskRunAttemptEvidenceV1` union;
- `TaskLifecycleEventProjectionV1` and
  `TaskExecutionFailureEventProjectionV1`;
- the closed `TaskRequestedEffectV1` union; and
- `PersistedTaskRequestedEffectV1`.

The effect union has exactly nine kinds: `dispatch_attempt`,
`continue_retry`, `wake_retry`, `wake_lease_expiry`,
`request_execution_cancellation`, `release_queue_ownership`,
`publish_lifecycle_event`, `notify_current_state`, and
`cancel_obsolete_lease_wake`.

Every accepted mutation emits exactly one evidence record and the exact
operation-specific ordered effect list. Effect sequences are run-local,
contiguous, derived from the stored cursor, and validated by the store before
atomic commit. Delivery happens after commit and never becomes lifecycle state
authority.

### Service, Store Port, And Errors

The private package surface contains:

- `RunAttemptLifecycle`, with the five mutation operations plus
  `inspectCurrentAttempt`;
- `TaskSystemRunAttemptStore`, with only `transactRunAttempt` and
  `inspectRunAttempt`;
- `TaskSystemRunAttemptTransactionV1<Outcome>` and
  `TaskSystemRunAttemptDecisionInputV1`; and
- `RunAttemptLifecycleLive`, which requires the dynamically supplied store and
  immutable policy configuration.

The command error is `InvalidRunAttemptCommandError`. The exact decision-error
members are `InvalidRunAttemptTransitionError`, `StaleTaskRunVersionError`,
`StaleTaskExecutionFenceError`, `ConflictingTaskAttemptCompletionError`,
`InvalidTaskCancellationAcknowledgementError`,
`TaskRunAttemptPolicyError`, and `TaskRunAttemptCounterExhaustedError`, joined
by `RunAttemptDecisionErrorV1`. The exact store-error members are
`TaskSystemRunAttemptUnavailableError`,
`TaskSystemRunAttemptCorruptionError`,
`TaskSystemRunAttemptStaleScopeAuthorityError`,
`TaskSystemRunAttemptTransientStoreError`, and
`TaskSystemRunAttemptTerminalStoreError`, joined by
`TaskSystemRunAttemptStoreErrorV1`. `RunAttemptLifecycleErrorV1` is the closed
exported union of command, decision, and store errors.

Corruption, invariant violations, and unexpected defects do not become
current/idempotent domain outcomes. Missing and cross-scope runs remain
non-disclosing and indistinguishable.

### Compatibility Contracts

DTE03-F owns only test/roadmap evidence:

- `run-attempt-lifecycle.json` for the canonical scenario, inspection, cursor,
  and replay contracts;
- `divergences/v1.json` for exact leaf-pointer differences; and
- `check-durable-task-lifecycle-vectors.mjs` plus mutation-negative tests for
  structural, semantic, source-map, removed-field, and divergence closure.

These artifacts are not package inputs, runtime fallback data, product status
models, or public compatibility APIs.

## Consolidated Transition And Decision Order

The five mutation operations use one shared order:

1. decode the operation-specific closed command;
2. validate the externally acquired scope-bound store authority;
3. load and decode aggregate, binding, acceptance, replay, evidence, and effect
   state under one transaction database-time snapshot;
4. perform completion replay equality/conflict lookup first for completion, or
   exact latest direct-replay lookup for other mutations;
5. apply the operation-specific current-reason order;
6. validate attempt, fence, lease, heartbeat, cancellation, and timing evidence
   required by that operation;
7. apply the accepted transition and DTE03-C policy with checked arithmetic;
8. construct the exact outcome, one evidence record, accepted receipt,
   optional completion replay, ordered effects, and next aggregate;
9. validate the next-state, run-version, replay, effect-sequence, cursor, and
   commit-basis invariants in the store;
10. atomically persist the complete mutation or persist nothing; and
11. return detached accepted, idempotent, or current receipt data.

The five transition owners are fixed as follows:

| Operation | Accepted transition families | No-write families | Typed rejection boundary |
| --- | --- | --- | --- |
| `startAttempt` | eligible `ready` to `attempt_granted` with one grant | exact direct replay or safe current state | corruption/invariant only |
| `heartbeatAttempt` | accepted next sequence renews the active lease once | exact replay, duplicate/stale/gap/current state | corruption/invariant only |
| `completeAttempt` | success, cancellation acknowledgement, immediate retry, durable retry, or terminal failure | exact completion replay or safe current state | conflicting completion or invalid cancellation acknowledgement |
| `requestCancellation` | first request, non-active terminal cancellation, or accepted active cancellation request | exact replay, existing request, or terminal current state | corruption/invariant only |
| `handleLeaseExpiry` | dispatch-loss retry/failure, execution-loss retry/failure, or cancellation resolution | exact replay, stale/early wake, or safe current state | corruption/invariant only |

All race winners, replay precedence, lease boundaries, and operation-specific
current reasons remain exactly those in DTE03-D and DTE03-E.

## Twelve-Condition Exit Audit

| # | Lifecycle-model condition | Accepted proof |
| --- | --- | --- |
| 1 | Every phase and terminal outcome is unambiguous | DTE03-B's five-phase union and closed terminal outcome union |
| 2 | Illegal aggregate combinations fail closed | DTE03-B aggregate Schema contract and legal-state matrix; DTE03-F malformed-aggregate vector |
| 3 | All five mutations have exhaustive transitions/outcomes | DTE03-D tables, DTE03-E closed outcomes, and DTE03-F branch coverage |
| 4 | Inspection cannot expose impossible or authoritative state | DTE03-E detached projection and all fourteen legal normalized inspection cases |
| 5 | Retry/failure policy is deterministic | DTE03-C stored policy, database time, stored jitter, checked arithmetic, and rejection vectors |
| 6 | Attempt ceiling and cancellation/heartbeat/lease races are singular and replay-safe | DTE03-C/D tables and race, current, idempotent, overflow, and exhaustion vectors |
| 7 | Completion replay distinguishes identity from conflict | bounded attempt/fence replay, eight replay links, and identical/conflicting redelivery vectors |
| 8 | State, evidence, replay, and effects commit atomically | DTE02-F two-method store transaction contract and DTE03-E decision/receipt contract |
| 9 | Effect order is stable and delivery is non-authoritative | thirteen accepted effect plans, 24 cursor cases, contiguous store validation, and production boundary gate |
| 10 | Typed errors preserve order and corruption/defects stay distinct | DTE03-E 16-step first-error order plus corruption and store-failure vectors |
| 11 | Vectors close every admitted branch and divergence | 65 vectors, 37 exact divergences, source-map binding, and positive/mutation-negative checker tests |
| 12 | DTE01/DTE02 contracts were not silently reopened | green source-map/source-pin/boundary gates and the reopening audit below |

All twelve conditions are accepted. No condition relies on future persistence
or host behavior for its semantic answer.

## DTE01 And DTE02 Reopening Audit

DTE01 remains closed:

- no additional Trigger file or symbol is required;
- all 29 map entries retain their admitted/discarded classification;
- no dependency beyond `effect@catalog:` is required at runtime;
- the package remains private with only `./internal/run-attempt-v1`;
- no Trigger workspace import, active product dependency, or public export is
  introduced; and
- the ten semantic-change categories remain sufficient.

DTE02 remains closed:

- the six service operations are unchanged;
- the store port remains exactly two methods;
- identity representations and allocation owners are unchanged;
- scope authority remains out of band in the private Task System capability;
- database time, run version, attempt/fence, lease version, cancellation
  generation, and effect sequence retain their accepted meanings; and
- DTE-IP01 still starts from an already-created run.

## Exact DTE-IP01 Start Order

DTE-IP01 remains one coherent reviewed checkpoint, not a sequence of separately
shipped shells. Within that checkpoint implementation must proceed in this
order:

1. create the exact manifest, DOM/Cloudflare-free `tsconfig.json`, notices,
   licenses, and package-local source-map receipt;
2. materialize `Model.ts`, `Schema.ts`, `Errors.ts`, and `Policy.ts`, adapting
   the admitted Trigger status, retry, heartbeat, and failure logic into the
   closed Flarex types without reimplementing behavior that can be reused;
3. materialize the pure decision functions inside the admitted package files
   and bind their real Effect Schemas and decisions to the same 65 vectors,
   fourteen inspection cases, 24 cursor cases, and eight replay links;
4. do not proceed until the candidate Schema/decision vector lane and its
   mutation-negative tests pass;
5. materialize `Services/RunAttemptLifecycle.ts`,
   `Services/TaskSystemRunAttemptStore.ts`, and
   `Layers/RunAttemptLifecycleLive.ts`, adapting the mapped Trigger systems to
   the two-method port and ordered-effect seam;
6. add the deterministic test store Layer and all mapped compatibility and
   Flarex-added tests;
7. expose only `v1.ts` through `./internal/run-attempt-v1`; and
8. run every package-creation, boundary, typecheck, test, provenance, source-
   map, and compatibility gate before committing the checkpoint.

There is no temporary lifecycle package, second model, fixture-driven runtime,
Prisma bridge, or interim database adapter in this order. The source map is the
reuse ledger; an implementation that abandons mapped logic for fresh behavior
must stop and record a new explicit transformation/divergence decision.

## DTE-IP01 Stop Boundary

Stop when the private package and deterministic tests are green. DTE-IP01 must
not add:

- Drizzle tables, SQL, migrations, transactions, PGlite, Postgres, or any
  concrete store adapter;
- a dependency from an existing app or production package;
- queue, alarm, cron, Durable Object, Worker, HTTP, service-binding, compute,
  observability, UI, or effect-delivery hosts;
- public protocol, SDK, management API, root package export, or Trigger
  workspace importer;
- dual execution, dual writes, shadow comparison, fallback, routing, or
  activation; or
- changes to existing OCC, commit, journal, feed, outbox, or authoritative
  application-row owners.

Roadmap 04 remains the first owner allowed to discuss the concrete Task System
adapter and Drizzle schema after DTE-IP01 closes successfully.

## Reopening Rules

Stop DTE-IP01 and reopen:

- **DTE01** for another Trigger source symbol/file, runtime dependency, package
  export, host API, reuse class, license/provenance rule, or semantic-change
  category;
- **DTE02** for another command/store operation, identity representation,
  allocation owner, scope-authority placement, or changed meaning of time,
  fence, lease, cancellation, run version, or effect sequence;
- **DTE03-A** for missing or misclassified source lifecycle behavior;
- **DTE03-B** for a phase, aggregate field, terminal topology, replay topology,
  cursor, or legal-state change;
- **DTE03-C** for failure, attempt-ceiling, retry, jitter, OOM, compute-class,
  timing, or terminal-classification change;
- **DTE03-D** for transition precedence, heartbeat, lease, cancellation,
  replay, current-state, or race-winner change;
- **DTE03-E** for an outcome, inspection, evidence, effect, receipt, error,
  evaluation-order, or atomic-commit contract change; and
- **DTE03-F** for a missing scenario, changed vector expectation, compatibility
  projection, divergence, source binding, or executable-gate rule.

If none of those contracts can support a correct implementation, change this
receipt from `admit` to `revise`; do not work around the contradiction in code.

## Validation Receipt

The final pre-admission audit passed on 2026-08-04:

- `pnpm trigger:source:verify` — 1,518 files and two symlinks verified at the
  pinned Trigger commit;
- `pnpm check:durable-task-source-map` — 29 entries, pre-admission;
- `pnpm check:durable-task-lifecycle-vectors` — 65 vectors and 37 named
  differences;
- `pnpm check:trigger-compatibility-boundary` — active import/bundle boundary
  passed;
- `pnpm check:standard-application-definition-boundaries` — definition owner
  boundary passed;
- `pnpm typecheck:scripts` — strict checked-JavaScript gate passed; and
- `pnpm test:scripts` — five files and 48 tests passed.

These checks prove source integrity, contract closure, and production exclusion.
They do not claim package parity: package parity begins with the mandatory
candidate Schema/decision lane inside DTE-IP01.

## Final Handoff

Roadmap 03 is **complete: admit**. The next implementation action is exactly
**DTE-IP01: Run-Attempt Domain Package Transplant**. The next roadmap after a
successful DTE-IP01 package checkpoint is Roadmap 04, which must separately
preflight the private Task System API, Drizzle schema, transaction protocol,
and concrete Postgres/PGlite adapters.

## Authority And Evidence

- [`../01-source-reuse-and-package-admission.md`](../01-source-reuse-and-package-admission.md)
- [`../02-task-definition-identity-and-scope.md`](../02-task-definition-identity-and-scope.md)
- [`../03-run-attempt-engine.md`](../03-run-attempt-engine.md)
- [`./05-final-package-admission.md`](./05-final-package-admission.md)
- [`./10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md)
- [`./11-final-identity-admission.md`](./11-final-identity-admission.md)
- [`./12-current-lifecycle-and-transition-inventory.md`](./12-current-lifecycle-and-transition-inventory.md)
- [`./13-phase-terminal-and-aggregate-model.md`](./13-phase-terminal-and-aggregate-model.md)
- [`./14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md)
- [`./15-cancellation-heartbeat-lease-and-race-tables.md`](./15-cancellation-heartbeat-lease-and-race-tables.md)
- [`./16-operation-outcomes-evidence-effects-and-errors.md`](./16-operation-outcomes-evidence-effects-and-errors.md)
- [`./17-compatibility-vectors-and-executable-gate.md`](./17-compatibility-vectors-and-executable-gate.md)
- [`./source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json)
- [`../../../integration/durable-task-compatibility/scenarios/v1/run-attempt-lifecycle.json`](../../../integration/durable-task-compatibility/scenarios/v1/run-attempt-lifecycle.json)
- [`../../../integration/durable-task-compatibility/divergences/v1.json`](../../../integration/durable-task-compatibility/divergences/v1.json)
