# Workflow Delayed Actions Runtime Goal

## Goal

Implement durable Cloudflare workflow delayed actions for Medusa workflow retry,
step-timeout, and transaction-timeout behavior without replacing Medusa workflow
definitions or the existing Workflow Engine service.

This goal continues the in-place refactor strategy:

- keep `createWorkflow(...)`, `createStep(...)`, core flows, and public
  `IWorkflowEngineService` behavior unchanged;
- keep the existing `workflow-engine-inmemory` service as the orchestration
  engine;
- move runtime durability behind injected contracts and Cloudflare provider
  subpaths;
- keep Node/default behavior working through the current timer-based path;
- validate Cloudflare behavior through provider tests, import guards, and
  workerd proof.

## Current Baseline

Already implemented:

- `WorkflowExecutionStore` boundary for workflow checkpoints.
- `DurableObjectWorkflowExecutionStore` backed by Durable Object SQLite.
- `WorkflowScheduleStore` boundary for named scheduled workflows.
- `DurableObjectWorkflowScheduleStore` backed by Durable Object SQLite and DO
  alarms.
- Cloudflare scheduler adapter using Worker-compatible global timers.
- `recoverDueSchedules(...)` path called from `CartProofDO.alarm()`.
- workerd proof for persisted schedule recovery.

Remaining runtime gap:

- `scheduleRetry(...)`, `scheduleStepTimeout(...)`, and
  `scheduleTransactionTimeout(...)` still use in-memory timers through
  `createManagedTimer(...)`.
- Those timers can run in a Worker isolate, but they are not durable across
  isolate eviction or restart.
- The Cloudflare production path needs these internal delayed actions persisted
  and recovered through Durable Object alarms.

## Design Decision

Use a dedicated internal delayed-action contract instead of overloading
`WorkflowScheduleStore`.

Reason:

- Named scheduled workflows are user/business schedules.
- Retry, step timeout, and transaction timeout are Workflow Engine internal
  recovery actions.
- Keeping them separate makes Cloudflare alarm recovery explicit and avoids
  confusing public schedule state with internal orchestration timers.

Working name:

```ts
WorkflowDelayedActionStore
```

Expected action kinds:

```ts
type WorkflowDelayedActionKind =
  | "retry-step"
  | "step-timeout"
  | "transaction-timeout"
```

The exact TypeScript shape should be extracted from the current calls in
`InMemoryDistributedTransactionStorage`; do not invent fields that the engine
does not need.

## Non-Goals

- Do not replace the Workflow Engine module.
- Do not create a parallel Cloudflare workflow engine.
- Do not rewrite Medusa workflow definitions.
- Do not expose hosted programmable workflow APIs yet.
- Do not add cron parsing to the Cloudflare path.
- Do not encode final tenant/deployment registry behavior into the Workflow
  Engine package during this goal.

## Turn-By-Turn Plan

### Turn 1 - Contract Extraction

Status: completed in this slice.

Objective:

- Add the minimal delayed-action contract to `workflow-engine-inmemory` near the
  existing execution and schedule store contracts.

Implementation outline:

- Define delayed-action record types for retry, step timeout, and transaction
  timeout.
- Add a default in-memory delayed-action store or no-op adapter that preserves
  current Node/default behavior.
- Thread the dependency through the module loader only when needed.
- Keep existing timer behavior unchanged in this turn.

Validation:

- Focused `@medusajs/workflow-engine-inmemory` Jest suite.
- `@medusajs/workflow-engine-inmemory` build.
- `medusa-cloudflare typecheck`.
- Worker import guard.

Stop condition:

- The contract exists and default behavior is unchanged.

Result:

- Added the `WorkflowDelayedActionStore` contract and delayed-action record
  types to the existing `workflow-engine-inmemory` utility boundary.
- Added the default `InMemoryWorkflowDelayedActionStore`, backed by the
  injected `WorkflowSchedulerAdapter`.
- Registered `workflowDelayedActionStore` in the Workflow Engine loader when a
  deployment has not provided one.
- Threaded the store into `InMemoryDistributedTransactionStorage` and cleared it
  on application shutdown.
- Retry and timeout scheduling still use the previous timer maps in this turn;
  moving those paths to the contract is Turn 2.

### Turn 2 - Route Retry/Timeout Scheduling Through Contract

Status: completed in this slice.

Objective:

- Route `scheduleRetry`, `scheduleStepTimeout`, and
  `scheduleTransactionTimeout` through the delayed-action boundary while keeping
  the default adapter timer-backed.

Implementation outline:

- Replace direct map/timer ownership with delayed-action store calls where
  practical.
- Keep `clearRetry`, `clearStepTimeout`, and `clearTransactionTimeout` mapped
  to delayed-action cancellation.
- Preserve the existing in-memory maps only as the Node/default delayed-action
  implementation, not as hard-coded engine storage.

Validation:

- Existing retry interval and timeout integration assertions where feasible.
- Focused storage Jest suite.
- Build/typecheck/import guards.

Stop condition:

- Node/default workflow retry and timeout behavior still passes, and the engine
  no longer hardcodes those delayed actions outside the contract.

Result:

- Tightened `WorkflowDelayedActionStore` so the public contract exposes delayed
  action records, not timer handles. Timer handles are private to the default
  in-memory implementation.
- Routed `scheduleRetry`, `scheduleStepTimeout`, and
  `scheduleTransactionTimeout` through `WorkflowDelayedActionStore`.
- Routed `clearRetry`, `clearStepTimeout`, and `clearTransactionTimeout`
  through delayed-action cancellation.
- Preserved default behavior with `InMemoryWorkflowDelayedActionStore`, which
  remains timer-backed through the injected `WorkflowSchedulerAdapter`.
- Captured the workflow id, transaction id, optional step id, due timestamp,
  action kind, and narrowed workflow run context on delayed-action records.
- Existing retry/timeout package integration was attempted but blocked by the
  local PostgreSQL environment before workflow behavior executed. The focused
  storage suite, package build, Worker tests, import guards, and workerd proof
  passed.

### Turn 3 - Cloudflare Durable Object Delayed Action Store

Status: completed in this slice.

Objective:

- Add a Cloudflare provider subpath that persists delayed actions in Durable
  Object SQLite and schedules the next DO alarm.

Implementation outline:

- Add `@medusajs/workflow-engine-cloudflare/delayed-action-store`.
- Persist delayed actions with action kind, workflow id, transaction id, step id
  when applicable, due timestamp, event-group context, and cancellation state.
- Use the same narrow Durable Object storage surface pattern as the current
  schedule store: `sql`, `getAlarm`, `setAlarm`, `deleteAlarm`.
- Keep exports isolated by subpath. Do not export backend-specific code from
  broad barrels.

Validation:

- Provider Jest tests for save, cancel, due listing, alarm rescheduling, and
  recovery record updates.
- Provider build.
- Worker import guards.

Stop condition:

- Cloudflare delayed actions persist and schedule alarms independently of
  runtime timers.

Result:

- Added `@medusajs/workflow-engine-cloudflare/delayed-action-store` as an
  isolated provider subpath. The provider package root still exports nothing.
- Persisted one-shot Workflow Engine delayed actions in Durable Object SQLite
  with action kind, workflow id, transaction id, optional step id, due
  timestamp, context JSON, handled timestamp, and cancellation timestamp.
- Kept the DO alarm pointed at the earliest pending delayed action.
- Added provider-owned recovery primitives for due action listing, successful
  handled-state recording, failed-action preservation, and alarm rescheduling.
- Preserved app thinness: this turn does not wire the store into
  `apps/medusa-cloudflare` or move Workflow Engine behavior into the app.
- Validation passed with provider tests/build, Cloudflare typecheck, import
  guards, Vitest, and workerd proof.

### Turn 4 - Recovery API In Workflow Engine

Status: completed in this slice.

Objective:

- Add a package-owned recovery API that the Cloudflare DO alarm can call to
  execute due delayed actions.

Implementation outline:

- Add a method on the internal orchestrator/service boundary, likely similar to
  `recoverDueSchedules(...)`.
- Recovery should call existing `workflowOrchestratorService.run(...)` with the
  same context currently used by retry and timeout timer callbacks.
- Keep behavior idempotent: if a delayed action was cleared or already handled,
  recovery should skip it.

Validation:

- Focused storage/orchestrator tests proving due delayed actions call the same
  run path as existing timers.
- Existing timeout/retry tests still pass.

Stop condition:

- The Workflow Engine can recover internal delayed actions without app-local
  knowledge of retry or timeout internals.

Result:

- Added `RecoverableWorkflowDelayedActionStore` and
  `WorkflowDelayedActionRecoveryResult` to the existing Workflow Engine
  delayed-action boundary.
- Added `recoverDueDelayedActions(now?)` on
  `InMemoryDistributedTransactionStorage`,
  `WorkflowOrchestratorService`, `WorkflowsModuleService`, and
  `IWorkflowEngineService`.
- Recovery delegates due action execution to the same
  `runDelayedWorkflowAction(...)` path used by timer-backed retry and timeout
  callbacks.
- Non-recoverable/default in-memory delayed-action stores return an empty
  recovery result, preserving Node/default behavior.
- Existing package integration was attempted again but the local PostgreSQL
  environment failed before workflow behavior executed, and PostgreSQL tools
  for an isolated temp cluster were not available on PATH.
- Validation passed with focused Workflow Engine storage tests, package builds,
  Cloudflare typecheck, import guards, Vitest, and workerd proof.

### Turn 5 - Wire Cloudflare Runtime And DO Alarm

Status: completed in this slice.

Objective:

- Register the Cloudflare delayed-action store in `apps/medusa-cloudflare` at
  the same composition boundary used for execution and schedule stores.

Implementation outline:

- Construct the delayed-action store in the Durable Object runtime root.
- Pass it through `createCommerceModulesRuntimeWithManager(...)`.
- Update `CartProofDO.alarm()` to call both schedule recovery and delayed-action
  recovery through package-owned Workflow Engine APIs.
- Keep app code as composition only.

Validation:

- `medusa-cloudflare typecheck`.
- Worker import guards.
- `medusa-cloudflare test`.
- `medusa-cloudflare test:cart-do-sqlite`.

Stop condition:

- Cloudflare composition uses durable delayed actions without adding workflow
  logic to the app.

Result:

- `CartProofDO` now constructs `DurableObjectWorkflowDelayedActionStore` from
  the Durable Object storage binding and passes it through the existing
  commerce module composition root.
- `createCommerceModulesRuntimeWithManager(...)` now registers
  `workflowDelayedActionStore` and declares the token as a Workflow Engine
  dependency only when the app root supplies it.
- `CartProofDO.alarm()` now calls both package-owned recovery APIs:
  `recoverDueSchedules()` and `recoverDueDelayedActions()`.
- The workerd proof now creates a real retrying workflow, persists its retry
  action in Durable Object SQLite, clears runtime handlers, and verifies the
  retry completes through either the automatic DO alarm path or the explicit
  service recovery fallback.
- `DurableObjectWorkflowDelayedActionStore` marks a successfully recovered
  action handled even if the resumed workflow clears the same retry action
  during normal step cleanup.
- Validation passed with provider tests/build, Cloudflare typecheck, import
  guards, Vitest, and workerd proof.

### Turn 6 - Real Workflow Proof

Status: completed for retry, step-timeout, and transaction-timeout.

Objective:

- Prove one real timeout or retry workflow path in workerd.

Implementation outline:

- Prefer an existing workflow-engine fixture or original integration assertion
  over a custom proof workflow.
- If a proof workflow is necessary, keep it in the Worker proof harness and use
  it only to exercise the generic delayed-action contract.
- Assert persisted delayed action, alarm scheduling, recovery, and final
  workflow execution state.

Validation:

- Focused provider tests.
- Focused Workflow Engine tests.
- `medusa-cloudflare test`.
- `medusa-cloudflare test:cart-do-sqlite`.
- Import guards.

Stop condition:

- A delayed retry or timeout survives runtime schedule recovery and completes
  through existing Workflow Engine behavior.

Result:

- Retry delayed-action recovery was already proven by Turn 5.
- Step-timeout delayed-action recovery is now proven in workerd by a real async
  Workflow Engine step with `timeout: 0.1`.
- Transaction-timeout delayed-action recovery is now proven in workerd by a
  workflow-level `timeout: 0.1` and async Workflow Engine step.
- The timeout proofs verify Durable Object SQLite persistence, recovery through
  DO alarm or explicit service fallback, handled-state persistence, final
  `reverted` transaction state, and the expected `TransactionStepTimeoutError`
  or `TransactionTimeoutError`.

### Turn 7 - Existing Test Runner Coverage

Status: completed as mapping plus blocked unchanged integration selector.

Objective:

- Bring existing Medusa Workflow Engine retry/timeout integration assertions
  into the Cloudflare validation lane where practical.

Implementation outline:

- Use existing scripts; do not create parallel test scripts.
- Start with focused retry/timeout specs.
- Record which assertions are covered, blocked, or not relevant to Cloudflare
  because they rely on Node/Redis-specific behavior.

Validation:

- Existing `integration-tests-modules` or package integration runner, focused
  by test path/name.
- PostgreSQL/default lane remains passing for changed shared behavior.

Stop condition:

- At least one unchanged retry/timeout assertion is covered by the Cloudflare
  path, or the blocker is documented with exact failure evidence.

Result:

- The Cloudflare workerd path now covers retry, async step-timeout, and async
  transaction-timeout behavior through proof routes that exercise the existing
  Workflow Engine service and delayed-action recovery API.
- The step-timeout proof matches the existing Redis
  `workflow_step_timeout_async` fixture shape.
- The transaction-timeout proof matches the existing Redis
  `workflow_transaction_timeout_async` fixture shape.
- A focused unchanged `@medusajs/workflow-engine-inmemory` integration selector
  was attempted for transaction-timeout behavior and failed before workflow
  behavior executed because local PostgreSQL auth returned
  `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`; teardown
  then reported `ORM not configured`.

### Turn 8 - Documentation And Boundary Cleanup

Status: completed in this slice.

Objective:

- Record the implemented difference and clean up any temporary proof-only
  behavior.

Implementation outline:

- Update `plan/fork-changes/workflow-engine.md`.
- Update `plan/cloudflare-port-refactor-plan.md`.
- If new exports or composition rules matter, update `AGENTS.md`.
- Commit the implementation slice and a record-hash update.

Validation:

- Full validation set used by the implementation turn.
- `git diff --check`.
- Clean worktree after commits.

Stop condition:

- Goal is complete when retry, step-timeout, and transaction-timeout delayed
  actions have a durable Cloudflare path, Node/default behavior still passes,
  Worker import guards pass, and at least one real workerd recovery proof
  passes.

## Acceptance Criteria

- No new parallel Workflow Engine implementation.
- No rewrites of Medusa workflow definitions.
- Node/default timer behavior remains available.
- Cloudflare delayed actions are persisted in Durable Object SQLite.
- Cloudflare delayed actions are recoverable from DO alarms.
- Worker bundle remains free of Node-only workflow runtime dependencies.
- Relevant original workflow tests remain the behavioral spec.
- Documentation records the difference from original Medusa and the validation
  evidence.

## Recommended Next Turn

Run the final completion audit against the acceptance criteria before moving to
unrelated workflow, event, HTTP, or persistence work.
