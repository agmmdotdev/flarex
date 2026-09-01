# Workflow Execution Colocated DO Turn Tracker

This tracker records the execution state for
`workflow-execution-colocated-do-goal.md`.

## Current State

- Node `@medusajs/workflow-engine-inmemory` temp-postgres integration lane is
  green.
- Cloudflare schedule and delayed-action stores already prove DO alarm-backed
  recovery for selected Workflow Engine runtime state.
- Current discussion decision: workflow execution persistence should be
  colocated with the owning business partition where practical, starting with
  the Cart proof DO.
- This tracker is not permission to build a final hosted partition topology.

## Turns

| Turn | Slice | Status | Required Validation |
| --- | --- | --- | --- |
| 1 | Map current execution-store wiring | Completed | `git status --short` |
| 2 | Add Cloudflare workflow execution store provider | Completed | provider test, provider build, Worker import guards |
| 3 | Wire provider into Cart proof DO | Completed | app typecheck, app tests, `test:cart-do-sqlite`, Worker import guards |
| 4 | Add colocated cleaner proof | Completed | app typecheck, `test:cart-do-sqlite`, Worker import guards |
| 5 | Re-run Node compatibility lane | Completed | `@medusajs/workflow-engine-inmemory test:integration:temp-postgres` |
| 6 | Record and commit checkpoint | Completed | `git diff --check`, clean commit state |

## Per-Turn Rules

- Keep every turn independently commit-sized.
- Update this tracker as each turn completes.
- Do not advance to a new runtime boundary when the previous turn has failing
  required validation.
- Do not move Workflow Engine behavior into `apps/medusa-cloudflare`.
- Do not import Cloudflare provider code from shared barrels.
- Do not add a single tenant-wide Medusa Durable Object.
- Do not use Cloudflare Workflows as the Medusa Workflow Engine replacement in
  this goal.

## Evidence Log

Add completed turn evidence below as commits land.

### Turns 1-3: Cloudflare Execution Store Provider Contract

Commit:

- `5cd566ee57`

What changed:

- Confirmed `apps/medusa-cloudflare` already selects
  `DurableObjectWorkflowExecutionStore` at the Cart proof DO composition root.
- Aligned the Cloudflare execution store provider with the current
  Workflow Engine cleaner contract by deleting finished executions through the
  `workflow_id`, `transaction_id`, and `run_id` composite key.
- Kept the provider behind its backend-specific subpath instead of exporting it
  from shared barrels.

Validation:

- `cmd /c yarn workspace @medusajs/workflow-engine-cloudflare test --testPathPattern=execution-store --runInBand`
- `cmd /c yarn workspace @medusajs/workflow-engine-cloudflare build`
- `cmd /c yarn workspace medusa-cloudflare typecheck`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`
- `cmd /c yarn workspace medusa-cloudflare check:imports`
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`

Next turn:

- Add the colocated cleaner proof against the Cart proof DO execution store.

### Turns 4-5: Colocated Cleaner Proof And Node Compatibility

Commit:

- `118a553f9f`

What changed:

- Exposed `clearExpiredExecutions()` through the shared Workflow Engine module
  service contract instead of requiring app code to reach into private storage.
- Added the same public method to the in-memory and Redis Workflow Engine
  service implementations.
- Added a Cart proof DO endpoint that seeds expired finished, not-yet-expired
  finished, and expired running workflow execution rows into the colocated DO
  SQLite execution store.
- Extended `test:cart-do-sqlite` to prove the Worker runtime cleaner deletes
  only expired finished executions through the colocated store.

Validation:

- `cmd /c yarn workspace medusa-cloudflare typecheck`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`
- `cmd /c yarn workspace @medusajs/workflow-engine-inmemory test --testPathPattern=workflow-orchestrator-storage.spec.ts --runInBand`
- `cmd /c yarn workspace medusa-cloudflare check:imports`
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
- `cmd /c yarn workspace @medusajs/workflow-engine-inmemory test:integration:temp-postgres`

Result:

- Workerd Cart DO SQLite proof now includes execution cleaner behavior.
- Node temp-postgres Workflow Engine integration lane remains green.
