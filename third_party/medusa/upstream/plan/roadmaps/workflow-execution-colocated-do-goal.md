# Workflow Execution Colocated DO Goal

## Objective

Prove Workflow Engine execution persistence in Cloudflare Durable Object
SQLite while keeping the workflow behavior inside Medusa's existing Workflow
Engine service.

The implementation target is colocation inside the current Cart-oriented proof
Durable Object, not a standalone global workflow Durable Object and not a final
production partition topology.

## Design Rule

Use tenant and deployment scope as the namespace, then use the business
transaction boundary as the Durable Object partition.

```text
tenant/deployment/environment/version
  -> namespace and isolation scope
  -> business partition selects the DO instance
```

Do not use:

```text
tenant -> one DO for all Medusa state
workflow module -> one global workflow DO
one Medusa table -> one DO class
```

Prefer:

```text
cart:{tenant}:{deployment}:{cartId}
  -> cart state
  -> checkout workflow execution rows
  -> schedule rows
  -> delayed actions
  -> local locks
  -> local outbox/projection events
```

This keeps strongly related checkout state in one SQLite transaction boundary
and avoids recreating distributed transactions across separate Cart,
Workflow, Lock, Event, and Payment-session Durable Objects.

## Relationship To Cloudflare Workflows

Cloudflare Workflows is not the Medusa Workflow Engine replacement for this
goal.

Possible later uses:

- tenant provisioning;
- deployment orchestration;
- projection rebuilds;
- imports/exports;
- platform maintenance jobs.

Current Medusa workflow semantics remain owned by:

- `@medusajs/workflow-engine-inmemory`;
- Medusa workflow definitions;
- existing Workflow Engine service APIs;
- existing recovery APIs for schedules and delayed actions.

## Turn Plan

### Turn 1: Map Current Execution Store Wiring

Goal:

- Inspect current `workflowExecutionStore` dependency bridge in
  `apps/medusa-cloudflare`.
- Inspect `@medusajs/workflow-engine-cloudflare` provider package shape.
- Confirm whether a DO SQLite execution store already exists or only schedule
  and delayed-action stores exist.

Expected edits:

- None unless the docs need a small status correction.

Validation:

```bash
git status --short
```

Stop condition:

- A concrete file-level implementation plan for the provider subpath and app
  wiring is known.

### Turn 2: Add Cloudflare Workflow Execution Store Provider

Goal:

- Add a backend-specific provider subpath, likely:
  `@medusajs/workflow-engine-cloudflare/execution-store`.
- Implement the existing `WorkflowExecutionStore` contract against DO SQLite:
  `save`, `deleteByRunId`, `findLatest`, `listExpirableFinished`, and
  `delete`.
- Preserve the composite primary-key semantics:
  `workflow_id`, `transaction_id`, `run_id`.

Expected edits:

- `packages/modules/providers/workflow-engine-cloudflare/src/execution-store.ts`
- focused provider tests;
- provider package exports.

Validation:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-cloudflare test --testPathPattern=execution-store --runInBand
cmd /c yarn workspace @medusajs/workflow-engine-cloudflare build
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
```

Stop condition:

- Provider tests pass and Worker import guards prove the provider is only
  imported through the Cloudflare app/provider boundary.

### Turn 3: Wire Execution Store Into Cart Proof DO

Goal:

- Construct `DurableObjectWorkflowExecutionStore` inside `CartProofDO`.
- Pass it through `createCommerceModulesRuntimeWithManager(...)` using the
  existing `workflowExecutionStore` dependency bridge.
- Keep `apps/medusa-cloudflare` as composition/proof root only.

Expected edits:

- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/src/commerce-modules.ts`
- app/provider aliases if needed.

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
```

Stop condition:

- Existing Cart DO proof remains green with workflow execution persistence
  selected at the app root.

### Turn 4: Add Colocated Cleaner Proof

Goal:

- Add a proof route in the Cart DO that creates finished, running, expired,
  and not-expired workflow executions through real Workflow Engine paths.
- Call the existing cleaner path through the real Workflow Engine storage
  owner.
- Assert only expired finished executions are removed from the colocated DO
  SQLite store.

Expected edits:

- proof-only route/checker in `apps/medusa-cloudflare`;
- no new Workflow Engine behavior in the app.

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
```

Stop condition:

- Workerd proves cleaner behavior against colocated DO SQLite execution rows.

### Turn 5: Re-run Node Compatibility Lane

Goal:

- Confirm the Cloudflare provider work did not regress the unchanged Node
  Workflow Engine integration lane.

Expected edits:

- None unless a real regression appears.

Validation:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test:integration:temp-postgres
```

Stop condition:

- Node temp-postgres Workflow Engine package integration remains green, or a
  blocker is recorded in `plan/fork-changes/workflow-engine.md`.

### Turn 6: Record Architecture And Commit Checkpoint

Goal:

- Record the implemented difference from original Medusa.
- Record that the workflow execution store is colocated inside the Cart proof
  DO as a proof of transaction-boundary colocation, not the final topology.

Expected edits:

- `plan/fork-changes/workflow-engine.md`
- `plan/fork-changes/cloudflare-runtime-tenancy.md` if tenant/partition
  addressing changes;
- `plan/cloudflare-port-refactor-plan.md`
- this roadmap/turn tracker.

Validation:

```bash
git diff --check
git status --short
```

Stop condition:

- Slice is committed and the docs include the implementation commit hash.

## Acceptance Criteria

- Medusa Workflow Engine remains the behavior owner.
- The Cloudflare app selects only backend-specific providers and proof routes.
- Workflow execution rows persist in the same DO SQLite partition as the Cart
  proof runtime.
- Cleaner behavior passes in workerd.
- Node temp-postgres Workflow Engine package integration remains green.
- Worker import guards remain green.
- No final tenant/global/module partition topology is encoded.

