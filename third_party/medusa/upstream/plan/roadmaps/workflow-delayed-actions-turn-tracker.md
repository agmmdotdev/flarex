# Workflow Delayed Actions Turn Tracker

## Active Goal

Implement a durable Cloudflare workflow delayed-action runtime for Medusa
workflow retry, step-timeout, and transaction-timeout behavior without replacing
Medusa workflow definitions or the existing Workflow Engine service.

This tracker is the operational checklist for the current goal. The deeper
design record remains `workflow-delayed-actions-runtime-goal.md`.

## Stop Condition For The Goal

Stop this goal only when all of these are true:

- Retry delayed actions persist in Durable Object SQLite and recover through
  the Workflow Engine service in workerd.
- Step-timeout delayed actions persist in Durable Object SQLite and recover
  through the Workflow Engine service in workerd.
- Transaction-timeout delayed actions persist in Durable Object SQLite and
  recover through the Workflow Engine service in workerd.
- Node/default Workflow Engine behavior remains covered by existing package
  tests or the closest available unchanged assertions.
- Cloudflare import guards still prove the Worker graph does not include
  Node-only Workflow Engine dependencies.
- Fork change records and the Cloudflare port roadmap name the validation and
  commit identifiers for each completed slice.

## Completed Turns

### Turn 1 - Contract Extraction

Status: completed.

Result:

- Added `WorkflowDelayedActionStore` and delayed-action record types.
- Added the default in-memory delayed-action store.
- Registered the default store in the Workflow Engine loader when no provider
  is supplied.

### Turn 2 - Route Retry/Timeout Scheduling Through Contract

Status: completed.

Result:

- Routed retry, step-timeout, and transaction-timeout scheduling through the
  delayed-action store boundary.
- Routed delayed-action cancellation through the same boundary.
- Kept Node/default behavior timer-backed through the in-memory provider.

### Turn 3 - Cloudflare Durable Object Delayed Action Store

Status: completed.

Result:

- Added the isolated
  `@medusajs/workflow-engine-cloudflare/delayed-action-store` provider subpath.
- Persisted delayed actions in Durable Object SQLite.
- Added alarm scheduling, due listing, handled marking, cancellation, and
  failed-action preservation.

### Turn 4 - Workflow Engine Recovery API

Status: completed.

Result:

- Added `recoverDueDelayedActions(now?)` to the existing Workflow Engine
  service/orchestrator/storage path.
- Recovery runs due delayed actions through the same internal execution path as
  timer callbacks.
- Non-recoverable stores preserve current default behavior by returning an
  empty recovery result.

### Turn 5 - Cloudflare Runtime And DO Alarm Wiring

Status: completed.

Commit:

- `3acf03429c`

Result:

- `CartProofDO` constructs `DurableObjectWorkflowDelayedActionStore` from the
  Durable Object storage binding.
- `createCommerceModulesRuntimeWithManager(...)` registers
  `workflowDelayedActionStore` only when the app root supplies one.
- `CartProofDO.alarm()` calls both `recoverDueSchedules()` and
  `recoverDueDelayedActions()`.
- The workerd proof verifies a real retry delayed action can survive runtime
  handler loss and complete through automatic DO alarm recovery or explicit
  service fallback.

Validation:

- `cmd /c yarn workspace @medusajs/workflow-engine-cloudflare test --testPathPattern=delayed-action-store.spec.ts --runInBand`
- `cmd /c yarn workspace @medusajs/workflow-engine-cloudflare build`
- `cmd /c yarn workspace medusa-cloudflare typecheck`
- `cmd /c yarn workspace medusa-cloudflare check:imports`
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
- `cmd /c yarn workspace medusa-cloudflare test`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`

## Remaining Turns

### Turn 6 - Step Timeout Workerd Proof

Status: completed in this slice.

Commit:

- `bd5df21e4f`

Objective:

- Prove a real step-timeout delayed action persists in Durable Object SQLite
  and recovers through `recoverDueDelayedActions(...)` in workerd.

Rules:

- Prefer existing Workflow Engine fixtures or unchanged assertions.
- If a proof workflow is needed, keep it generic and proof-only inside the
  Worker harness.
- Do not move workflow internals into `apps/medusa-cloudflare`.

Stop condition:

- workerd proves a step-timeout action is persisted, recovered, marked handled,
  and leaves no pending delayed action after cleanup.

Result:

- Added a proof-only `step-timeout-alarm-proof` route to `CartProofDO`.
- The proof uses a real Workflow Engine async step with `timeout: 0.1`,
  matching the existing Medusa async step-timeout integration pattern.
- First run persists a `step-timeout` delayed action in Durable Object SQLite.
- Runtime delayed-action handlers are cleared before recovery.
- Recovery occurs through automatic Durable Object alarm recovery or the
  package-owned `recoverDueDelayedActions(...)` fallback.
- The proof verifies the recovered transaction state is `reverted`, the error
  is a `TransactionStepTimeoutError`, the delayed action is marked handled, and
  no delayed actions remain after cleanup.

Validation:

- `cmd /c yarn workspace @medusajs/workflow-engine-inmemory test --testPathPattern=workflow-orchestrator-storage.spec.ts --runInBand`
- `cmd /c yarn workspace medusa-cloudflare typecheck`
- `cmd /c yarn workspace medusa-cloudflare check:imports`
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
- `cmd /c yarn workspace medusa-cloudflare test`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`

Required validation:

- Focused Workflow Engine tests for changed shared behavior.
- Provider tests if the DO delayed-action store changes.
- `cmd /c yarn workspace medusa-cloudflare typecheck`
- Import guards.
- `cmd /c yarn workspace medusa-cloudflare test`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`

### Turn 7 - Transaction Timeout Workerd Proof

Status: completed in this slice.

Commit:

- `72ca5aca12`

Objective:

- Prove a real transaction-timeout delayed action persists in Durable Object
  SQLite and recovers through `recoverDueDelayedActions(...)` in workerd.

Rules:

- Keep timeout semantics in the existing Workflow Engine service.
- Add only the composition/proof code needed to validate the Cloudflare runtime
  path.

Stop condition:

- workerd proves a transaction-timeout action is persisted, recovered, marked
  handled or failed according to existing Workflow Engine behavior, and leaves
  deterministic persisted state.

Result:

- Added a proof-only `transaction-timeout-alarm-proof` route to `CartProofDO`.
- The proof uses a real Workflow Engine workflow-level `timeout: 0.1` with an
  async step, matching the existing Medusa transaction-timeout async fixture
  pattern.
- First run persists a `transaction-timeout` delayed action in Durable Object
  SQLite.
- Runtime delayed-action handlers are cleared before recovery.
- Recovery occurs through automatic Durable Object alarm recovery or the
  package-owned `recoverDueDelayedActions(...)` fallback.
- The proof verifies the recovered transaction state is `reverted`, the error
  is a `TransactionTimeoutError`, the delayed action is marked handled, and no
  delayed actions remain after cleanup.

Validation:

- `cmd /c yarn workspace @medusajs/workflow-engine-inmemory test --testPathPattern=workflow-orchestrator-storage.spec.ts --runInBand`
- `cmd /c yarn workspace medusa-cloudflare typecheck`
- `cmd /c yarn workspace medusa-cloudflare check:imports`
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
- `cmd /c yarn workspace medusa-cloudflare test`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`

Required validation:

- Focused Workflow Engine tests for changed shared behavior.
- Provider tests if the DO delayed-action store changes.
- `cmd /c yarn workspace medusa-cloudflare typecheck`
- Import guards.
- `cmd /c yarn workspace medusa-cloudflare test`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`

### Turn 8 - Existing Assertion Mapping

Status: completed in this slice.

Objective:

- Map retry, step-timeout, and transaction-timeout coverage back to existing
  Medusa Workflow Engine assertions.

Rules:

- Use existing package or integration runner scripts where practical.
- Do not create a parallel behavioral spec if an unchanged Medusa assertion can
  be reused.
- If the local PostgreSQL environment blocks a Node/default integration run,
  record the exact blocker instead of pretending coverage exists.

Stop condition:

- The tracker names which unchanged assertions cover retry and timeout behavior,
  which are covered only by focused package tests, and which are blocked by
  local environment constraints.

Result:

- Retry recovery is proven in workerd by `delayed-action-alarm-proof`, which
  exercises a real retrying Workflow Engine step through the durable delayed
  action boundary. It is proof-harness coverage, not a direct unchanged
  integration assertion.
- Step-timeout recovery is proven in workerd by `step-timeout-alarm-proof`,
  using the same async step-timeout shape as the existing Redis
  `workflow_step_timeout_async` fixture.
- Transaction-timeout recovery is proven in workerd by
  `transaction-timeout-alarm-proof`, using the same workflow-level timeout plus
  async step shape as the existing Redis `workflow_transaction_timeout_async`
  fixture.
- Shared scheduling/recovery behavior is covered by the focused
  `@medusajs/workflow-engine-inmemory` storage Jest suite.
- The existing focused integration assertion selector was attempted with:

```bash
cmd /c ..\..\..\node_modules\.bin\jest --passWithNoTests --forceExit --runInBand --testPathPattern="integration-tests/__tests__/index\.spec\.ts" -t "transaction timeout expires"
```

It failed before workflow behavior executed because local PostgreSQL auth
returned `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`;
teardown then reported `ORM not configured`.

Required validation:

- Existing focused Workflow Engine package tests.
- Any practical unchanged integration test selector.
- `git diff --check`.

### Turn 9 - Goal Closure And Documentation Cleanup

Status: completed in this slice.

Objective:

- Close the delayed-action runtime goal with complete docs and a clean
  worktree.

Rules:

- Update `plan/fork-changes/workflow-engine.md` with final behavior and commit
  identifiers.
- Update `plan/cloudflare-port-refactor-plan.md` with the final sequence.
- Keep `AGENTS.md` unchanged unless a new standing rule was actually adopted.
- Commit each completed slice before moving to unrelated workflow/event/HTTP
  work.

Stop condition:

- All goal stop conditions are satisfied, documentation names the validation
  evidence, and the goal can be marked complete.

Result:

- Retry, step-timeout, and transaction-timeout delayed actions now have durable
  Cloudflare recovery proof coverage in workerd.
- Documentation names the implementation boundaries, validation commands, and
  remaining local PostgreSQL integration-test blocker.
- No `AGENTS.md` update was needed because no new standing workflow rule was
  adopted.

Required validation:

- Final relevant package tests.
- Final Cloudflare import guards.
- Final workerd proof.
- `git status --short` is clean.

## Next Command Slice

The delayed-action runtime goal is ready for final completion audit. Do not
start unrelated workflow, event, HTTP, or persistence work until the goal state
has been checked against the acceptance criteria.
