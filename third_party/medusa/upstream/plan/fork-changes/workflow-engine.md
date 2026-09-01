# Workflow Engine

This record tracks fork-specific changes to Medusa's workflow engine,
orchestration core, and workflows SDK required for Worker-compatible
composition.

## Worker-Composable In-Memory Workflow Engine

Commit:

- `71301590d5 Add Worker-composable workflow engine slice`

Difference from original Medusa:

- `@medusajs/workflow-engine-inmemory` now exposes a static manifest entry
  point for application-root composition without filesystem discovery.
- The Cloudflare app composes the real in-memory Workflow Engine module service
  through the same module runtime used by the commerce modules. It does not
  rebuild workflow execution logic in `apps/medusa-cloudflare`.
- Core orchestration and workflows SDK imports were split into portable subpath
  exports so Worker bundles can import the required workflow pieces without
  following shared barrels into Node-only code.
- Node `EventEmitter`, `node:timers/promises`, direct `global`, and `ulid`
  usage on the Worker path were replaced with Worker-compatible utilities:
  typed local event emitter, portable sleep, `globalThis`, and
  `createPortableId`.
- Workflow SDK development-server resource registration is isolated behind a
  Worker-safe no-op boundary for this portable path.
- The in-memory workflow engine no longer statically imports `cron-parser` on
  the Worker path. Numeric schedules remain supported; cron-string schedules
  fail loudly on the Cloudflare path until a DO-alarm-native schedule format is
  defined.

Affected boundary:

- `packages/modules/workflow-engine-inmemory`
- `packages/core/orchestration`
- `packages/core/workflows-sdk`
- `packages/core/utils`
- `apps/medusa-cloudflare` module composition, aliases, import guard, and
  Durable Object proof route

Validation performed:

- `@medusajs/utils` build passed with `NODE_OPTIONS=--max-old-space-size=4096`.
- `@medusajs/orchestration` build passed with the same memory setting.
- `@medusajs/workflows-sdk` build passed with the same memory setting.
- `@medusajs/workflow-engine-inmemory` build passed.
- `@medusajs/workflow-engine-inmemory` focused static manifest test passed.
- `medusa-cloudflare` typecheck passed.
- Composed Worker import guard passed with 1018 bundled inputs.
- Production Worker build passed at 2,055.12 kB, gzip 376.19 kB.
- Portable entrypoint guard passed for `emit-events`, `portable`, and
  `static-app`.

Current status:

- The workerd Durable Object SQLite proof now reaches the Worker and passes
  with the real in-memory Workflow Engine module composed in the commerce
  module set.
- The remaining runtime work for workflows is no longer the dev-runner CJS
  startup failure. Future workflow work should focus on durable workflow
  storage/provider boundaries, scheduled workflow portability, and keeping the
  existing workflow integration assertions available for both Node and Worker
  composition.

## Workflow Dev-Runner And Static Runtime Closure

Commit:

- `76daad2355 Fix Worker workflow dev-runner path`

Difference from original Medusa:

- The Cloudflare app aliases `@medusajs/framework/awilix` to the browser
  awilix build at the composition root. This removes the final dev-runner
  CommonJS `exports` leak from `packages/core/framework/dist/deps/awilix.js`
  without changing shared module loader behavior.
- The composed Worker import guard now mirrors that alias and has an optional
  `MEDUSA_CF_PRINT_SUSPECT_INPUTS=1` diagnostic for future CJS/import-graph
  audits.
- `@medusajs/workflows-sdk` subpath exports now include `types`, `import`,
  `require`, and `default` conditions. Worker builds still use source aliases,
  while Jest/CommonJS package consumers can resolve the same subpaths.
- `@medusajs/workflow-engine-inmemory` static resources now include a
  portable joiner config generated from `WorkflowExecution`, preserving the
  module's queryable behavior in static composition.
- The in-memory workflow orchestrator now schedules subscriber notifications
  with `queueMicrotask` instead of Node-only `setImmediate`.
- Translation settings read/create methods are explicit on the Translation
  module service. The static Drizzle runtime no longer depends on generated
  base-service methods that are not present for the aliased
  `TranslationSettings` model name.
- Two CommonJS dependencies on the Worker workflow proof path were removed:
  `pluralize` from `@medusajs/utils` and `fast-json-stable-stringify` from
  `@medusajs/caching`. Small typed local implementations now cover the used
  behavior without pulling CJS into the Worker dev graph.

Affected boundary:

- `apps/medusa-cloudflare` Vite aliases and composed import guard
- `packages/core/workflows-sdk` subpath exports and type-only imports
- `packages/core/utils` pluralization helper
- `packages/modules/caching` cache-key stable serialization
- `packages/modules/translation` TranslationSettings service API
- `packages/modules/workflow-engine-inmemory` static manifest and subscriber
  scheduling

Validation performed:

- `@medusajs/utils` build passed.
- `@medusajs/caching` build passed.
- `@medusajs/workflows-sdk` build passed.
- `@medusajs/workflow-engine-inmemory` build passed.
- `@medusajs/translation` build passed.
- Focused `@medusajs/utils` pluralize test passed.
- Focused Translation static manifest test passed.
- Focused Workflow Engine static manifest test passed.
- `medusa-cloudflare` typecheck passed.
- Composed Worker import guard passed with 1015 bundled inputs.
- Production Worker build passed at 2,043.24 kB, gzip 372.60 kB.
- Durable Object SQLite workerd proof passed with Workflow Engine, Queue Event
  Bus consumer, Analytics, Caching, API Key, Auth, RBAC, Settings,
  Translation, File, Notification, Fulfillment, Order, Promotion, Tax,
  Pricing, Payment, Product, Inventory, Customer, Stock Location, Region,
  Sales Channel, Store, User, and Cart services.

Next implementation step:

- Continue with durable workflow/provider boundaries only after the current
  commerce module-set proof remains green. Do not rebuild workflow execution in
  the Cloudflare app.

## Worker-Compatible Scheduled Workflow Timers

Commit:

- `74175878ad Make workflow scheduler timers Worker-safe`

Difference from original Medusa:

- The in-memory Workflow Engine scheduler no longer assumes scheduled workflow
  timer handles expose Node's `unref()` method.
- Initial scheduled workflow timers now use the same managed timer path as
  retry and timeout scheduling, and `unref()` is called only when the runtime
  provides it.
- This does not make cron-string schedules Worker-compatible. Cron strings
  remain unsupported on the Cloudflare alarm path until a DO-alarm-native
  schedule format is defined.

Affected boundary:

- `packages/modules/workflow-engine-inmemory` scheduler storage

Validation performed:

- Focused Workflow Engine scheduler storage test passed.
- `@medusajs/workflow-engine-inmemory` build passed.
- `medusa-cloudflare` typecheck passed.
- Composed Worker import guard passed with 1015 bundled inputs.
- Production Worker build passed at 2,043.26 kB, gzip 372.59 kB.
- Durable Object SQLite workerd proof passed with the full commerce module set
  and Workflow Engine enabled.

Next implementation step:

- Add a real adapter boundary for scheduled workflow persistence and
  DO-alarm-native scheduling, or move to the next provider boundary, while
  keeping the module service and orchestration logic inside
  `@medusajs/workflow-engine-inmemory`.

## Scheduler Adapter Boundary

Commit:

- `eed9c8252d Add workflow scheduler adapter boundary`

Difference from original Medusa:

- `InMemoryDistributedTransactionStorage` now depends on an explicit
  `WorkflowSchedulerAdapter` for timer creation, timer clearing, optional
  `unref`, and optional schedule expression parsing.
- The module loader registers `defaultWorkflowSchedulerAdapter` only when the
  container does not already provide `workflowSchedulerAdapter`, so application
  roots can supply a Worker, Durable Object alarm, or test adapter
  without replacing workflow execution logic.
- Cron-string schedules still fail clearly by default on the Cloudflare path.
  The Cloudflare direction is DO-alarm-native scheduling, not bundling a Worker
  cron parser.
- Existing interval schedule behavior is preserved.

Affected boundary:

- `packages/modules/workflow-engine-inmemory` scheduler storage and loader

Validation performed:

- Focused Workflow Engine scheduler storage tests passed: interval timers
  without `unref`, missing cron adapter failure, and injected cron parser
  adapter.
- `@medusajs/workflow-engine-inmemory` build passed.
- `medusa-cloudflare` typecheck passed.
- Composed Worker import guard passed with 1015 bundled inputs.
- Production Worker build passed at 2,044.40 kB, gzip 372.75 kB.
- Durable Object SQLite workerd proof passed with the full commerce module set
  and Workflow Engine enabled.

Next implementation step:

- Use this adapter boundary to add durable scheduled workflow state or a
  DO-alarm-native schedule provider. Keep the Workflow Engine module service as
  the behavior owner.

## User Role Workflow Portable Entrypoints

Commit:

- `4c200ba1a4 Move Admin Users role assignment to Fetch manifest`

Difference from original Medusa:

- The user role-assignment and role-removal workflows now have explicit
  `@medusajs/core-flows/user/workflows/*` package exports so Worker static HTTP
  manifests can import method-specific workflow dependencies without pulling
  the full `@medusajs/core-flows` barrel into the route graph.
- The touched user-role workflow files and their shared link/RBAC validation
  steps import `createWorkflow`, `createStep`, `StepResponse`, and workflow
  data helpers directly from `@medusajs/workflows-sdk` instead of the broad
  `@medusajs/framework/workflows-sdk` re-export.
- The role-permission validation step now narrows graph rows from `unknown`
  before reading `policies` and `rbac_roles`, removing the explicit `any`
  traversal from this Worker-facing workflow path.

Affected boundary:

- `@medusajs/core-flows` package exports and dependencies.
- User role-assignment and role-removal workflow import graph.
- RBAC role-permission validation step type boundary.
- Worker static HTTP route imports for Admin Users role mutations.

Validation performed:

- `cmd /c yarn workspace @medusajs/core-flows build`
- `cmd /c yarn workspace medusa-cloudflare typecheck`
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"`
- `cmd /c yarn workspace medusa-cloudflare check:imports`
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`

Next implementation step:

- Use these portable workflow entrypoints to move the remaining Admin Users
  role-removal routes through the package-owned static HTTP manifest. Keep the
  workflow implementation in `@medusajs/core-flows`.

## Remote Link Workflow Step Type Boundary

Commit:

- `23a55a2127 Move Admin Users role removal to Fetch manifest`

Difference from original Medusa:

- The common `create-remote-links` and `dismiss-remote-links` workflow steps no
  longer import the `Link` class from `@medusajs/framework/modules-sdk`.
- The steps only need the resolved link service shape, so this fork uses a
  narrow local structural type plus `LinkDefinition` from `@medusajs/types`.
- This removes a runtime `@medusajs/framework/modules-sdk` import from
  Worker-facing user role workflows while preserving the existing container
  resolution key and link service behavior.

Affected boundary:

- `packages/core/core-flows/src/common/steps/create-remote-links.ts`
- `packages/core/core-flows/src/common/steps/dismiss-remote-links.ts`
- User role-assignment and role-removal workflow import graphs.

Validation performed:

- `cmd /c yarn workspace @medusajs/core-flows build`
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"`
- `cmd /c yarn workspace medusa-cloudflare typecheck`
- `cmd /c yarn workspace medusa-cloudflare check:imports`
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`

Next implementation step:

- Continue moving user mutation routes only when their workflows can use
  package-owned portable entrypoints without importing broad framework barrels.

## User Update Workflow Portable Entrypoint

Commit:

- `3b4b5af33f Move Admin Users update to Fetch manifest`

Difference from original Medusa:

- The user update workflow now has an explicit
  `@medusajs/core-flows/user/workflows/update-users` package export so Worker
  static HTTP manifests can import the Admin Users update route dependency
  without pulling the full `@medusajs/core-flows` barrel into the route graph.
- The touched user update workflow and step import workflow SDK helpers
  directly from `@medusajs/workflows-sdk` and type contracts from
  `@medusajs/types` instead of broad framework re-exports.
- `UserWorkflowEvents` is imported from the portable
  `@medusajs/utils/core-flows/events` subpath instead of
  `@medusajs/framework/utils`, avoiding an undefined event constant in workerd
  when the workflow starts from the package subpath.
- The common `emit-event` workflow step now imports event bus and workflow SDK
  types from portable packages and uses `Record<string, unknown>` for event
  payloads instead of explicit `any`.
- The Cloudflare Vite composition root aliases the new user update workflow
  subpath to source, matching the existing Worker-safe workflow alias pattern.

Affected boundary:

- `@medusajs/core-flows` package exports and dependencies.
- User update workflow import graph.
- Common workflow event emission step type boundary.
- Worker static HTTP route imports for Admin Users update.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck`
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"`
- `cmd /c yarn workspace medusa-cloudflare check:imports`
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`

Validation note:

- The broad `@medusajs/core-flows` package build still fails on many existing
  untouched workflow files that import through `@medusajs/framework/*`. This
  slice did not claim that package-wide cleanup; the Worker-facing user update
  subpath is covered by the Cloudflare route and workerd gates above.

Next implementation step:

- Continue with user delete only after its workflow graph is made portable
  through package-owned subpaths.

## Schedule Store Boundary

Commit:

- `88f14d8bb3 Add workflow schedule store boundary`

Difference from original Medusa:

- Scheduled workflow runtime state is now behind a `WorkflowScheduleStore`
  contract instead of a private `Map` inside
  `InMemoryDistributedTransactionStorage`.
- The default `InMemoryWorkflowScheduleStore` preserves the existing in-memory
  behavior.
- The Workflow Engine loader registers `workflowScheduleStore` only when the
  container has not already provided one, allowing a later Durable Object
  SQLite or other durable implementation to replace scheduler state without
  moving workflow execution logic into the Cloudflare app.
- This slice does not make scheduled workflow state durable yet; it creates the
  internal boundary needed for that implementation.

Affected boundary:

- `packages/modules/workflow-engine-inmemory` scheduler storage and loader

Validation performed:

- Focused Workflow Engine scheduler storage tests passed: interval timers
  without `unref`, missing cron adapter failure, injected cron parser adapter,
  `removeAll` through the schedule store, and `jobHandler` rescheduling through
  the schedule store.
- `@medusajs/workflow-engine-inmemory` build passed.
- `medusa-cloudflare` typecheck passed.
- Composed Worker import guard passed with 1015 bundled inputs.
- Production Worker build passed at 2,045.08 kB, gzip 372.87 kB.
- Durable Object SQLite workerd proof passed with the full commerce module set
  and Workflow Engine enabled.

Next implementation step:

- Implement a durable schedule store using the new boundary, likely backed by
  the same Durable Object SQLite partition used by the current module-set
  proof. Keep timer execution and schedule interpretation behind
  `WorkflowSchedulerAdapter`.

## Durable Object Schedule Store Proof

Commit:

- `21a56ce4e6 Add DO workflow schedule store proof`

Difference from original Medusa:

- `apps/medusa-cloudflare` now provides a
  `DurableObjectWorkflowScheduleStore` backed by Durable Object SQLite for
  scheduled workflow state.
- The store preserves runtime timer handles in memory while persisting the
  schedule definition, execution count, and scheduler config in the DO SQLite
  partition.
- The Cloudflare app registers `workflowScheduleStore` in the shared static
  module container and declares it as a Workflow Engine module dependency when
  the app provides one. This bridges the token into the module-local container
  without changing the default Node/in-memory module path.
- The Durable Object cart proof route now creates a real workflow, schedules it
  through Medusa's `WorkflowScheduler`, verifies the row was persisted through
  the injected store, clears it through the scheduler, and verifies runtime and
  persisted cleanup.
- This remains a proof of durable schedule state, not final alarm-based
  scheduler recovery. Isolate restart recovery and Cloudflare Alarm execution
  are still future work behind the existing scheduler adapter/store
  boundaries.

Affected boundary:

- `apps/medusa-cloudflare` module composition and Durable Object proof routes
- Workflow Engine dependency bridging for app-provided schedule stores
- Existing `@medusajs/workflow-engine-inmemory` scheduler/store contracts

Validation performed:

- `medusa-cloudflare` typecheck passed.
- Durable Object SQLite workerd proof passed with Workflow schedule store
  persistence and cleanup included in the module-set proof.
- Composed Worker import guard passed with 1016 bundled inputs.
- Production Worker build passed at 2,052.58 kB, gzip 374.51 kB.

Next implementation step:

- Add Cloudflare Alarm or equivalent scheduler recovery semantics behind
  `WorkflowSchedulerAdapter`/`WorkflowScheduleStore`, or move to the next
  workflow provider boundary. Keep workflow execution behavior inside the real
  Medusa Workflow Engine module.

## Durable Object Alarm Schedule Recovery

Commit:

- `0d5cb30757 Add DO alarm workflow schedule recovery`

Difference from original Medusa:

- `DurableObjectWorkflowScheduleStore` now persists `next_execution_at` for
  scheduled workflow rows and keeps the DO alarm pointed at the earliest
  persisted schedule.
- The Cloudflare cart proof Durable Object now implements `alarm()`, initializes
  the real Workflow Engine runtime, and recovers due persisted schedules through
  the Workflow Engine service when the runtime timer map is missing.
- Alarm recovery skips jobs that still have active runtime timers. The alarm is
  a recovery path for lost timers, not a second executor competing with the
  in-memory scheduler.
- The proof route simulates isolate timer loss by clearing only the runtime
  schedule map, then invokes the same recovery path used by `alarm()` and
  verifies that the persisted workflow is executed and the schedule row records
  the execution count.
- Cron-string alarm recovery remains unsupported on the Cloudflare path.
  Interval schedules are the validated path; future calendar-style scheduling
  should use a DO-alarm-native format rather than a Worker cron parser.

Affected boundary:

- `apps/medusa-cloudflare` Durable Object schedule store and cart proof route
- Cloudflare DO alarm integration for the app-provided Workflow Engine schedule
  store
- Existing Workflow Engine module service execution path

Validation performed:

- `medusa-cloudflare` typecheck passed.
- Durable Object SQLite workerd proof passed with Workflow schedule store and
  alarm recovery included in the module-set proof.
- Composed Worker import guard passed with 1016 bundled inputs.
- Production Worker build passed at 2,059.30 kB, gzip 375.60 kB.

Next implementation step:

- Move from proof-only alarm recovery toward shared Workflow Engine recovery
  APIs, or continue to the next workflow provider boundary. Keep platform alarm
  behavior adapter-driven and avoid Worker cron-parser dependencies.

## Shared Schedule Recovery API

Commit:

- `ef5b8f5cf8 Add workflow schedule recovery API`

Difference from original Medusa:

- The Workflow Engine module service now exposes `recoverDueSchedules(now?)`.
  Durable Object alarms can call the real Workflow Engine service instead of
  owning the recovery run loop in `apps/medusa-cloudflare`.
- `WorkflowOrchestratorService` delegates recovery to
  `InMemoryDistributedTransactionStorage`, keeping scheduled workflow execution
  inside the existing workflow engine behavior owner.
- `InMemoryDistributedTransactionStorage` now detects whether the injected
  `WorkflowScheduleStore` supports durable recovery. The default in-memory
  store returns an empty recovery result, preserving Node/default behavior.
- Recoverable stores receive a typed `runWorkflow(jobId)` callback from the
  Workflow Engine storage boundary, so app-provided DO stores no longer need to
  import or call Workflow Engine services directly.
- The Cloudflare cart proof `alarm()` now calls
  `runtime.workflowEngine.service.recoverDueSchedules()`.

Affected boundary:

- `packages/modules/workflow-engine-inmemory` service, orchestrator, and
  scheduler storage
- `packages/core/types` workflow engine service contract
- `apps/medusa-cloudflare` Durable Object alarm composition

Validation performed:

- Focused Workflow Engine scheduler storage test passed with recovery coverage.
- `@medusajs/types` build passed.
- `@medusajs/workflow-engine-inmemory` build passed.
- `medusa-cloudflare` typecheck passed.
- Durable Object SQLite workerd proof passed with schedule alarm recovery using
  the Workflow Engine service API.
- Composed Worker import guard passed with 1016 bundled inputs.
- Production Worker build passed at 2,059.82 kB, gzip 375.79 kB.

Next implementation step:

- Continue with DO-alarm-native scheduling semantics or the next workflow
  provider boundary. Do not add Worker cron-parser dependencies to the
  Cloudflare path.

## Cloudflare Workflow Schedule Store Package

Commit:

- `eba3d38bb2 Extract Cloudflare workflow schedule store`

Difference from original Medusa:

- `DurableObjectWorkflowScheduleStore` moved out of `apps/medusa-cloudflare`
  into `@medusajs/workflow-engine-cloudflare/schedule-store`.
- The Cloudflare-specific provider package lives under
  `packages/modules/providers/workflow-engine-cloudflare`.
- The package root `index.ts` intentionally exports nothing. The app imports
  only the Cloudflare-specific schedule-store subpath, keeping backend-specific
  code out of shared barrels.
- `apps/medusa-cloudflare` remains the composition and proof root. It
  constructs the store and calls the shared Workflow Engine recovery API, but
  does not own Workflow Engine recovery behavior.
- The Worker import graph remains selected at the app root through an isolated
  Vite alias and TypeScript path for the Cloudflare package subpath.

Affected boundary:

- `@medusajs/workflow-engine-cloudflare` provider package
- `apps/medusa-cloudflare` composition imports, Vite aliases, and TypeScript
  paths
- Yarn workspace graph and lockfile

Validation performed:

- `@medusajs/workflow-engine-cloudflare` build passed.
- `medusa-cloudflare` typecheck passed.
- Durable Object SQLite workerd proof passed with schedule persistence and
  alarm recovery.
- Composed Worker import guard passed with 1016 bundled inputs.
- Production Worker build passed at 2,059.88 kB, gzip 375.80 kB.

Next implementation step:

- Continue with DO-alarm-native scheduling semantics or move to the next
  workflow provider boundary. Keep the app thin and do not add Worker
  cron-parser dependencies.

## Cloudflare Schedule Store Interval-Only Guard

Commit:

- `07f9cad320 Reject cron in Cloudflare workflow schedule store`

Difference from original Medusa:

- The Cloudflare Workflow schedule store now rejects cron schedules before
  writing runtime or Durable Object SQLite state.
- Interval schedules remain the validated DO-alarm-native path. Cron support
  remains available only where the Workflow Engine has an injected parser
  adapter; it is not persisted by the Cloudflare store.
- The provider constructor now depends on the small Durable Object storage
  surface it uses (`sql`, `getAlarm`, `setAlarm`, `deleteAlarm`) instead of the
  full Worker storage type. Real `DurableObjectStorage` remains structurally
  compatible.
- The provider package now has focused Jest coverage and excludes test sources
  from its build output.

Affected boundary:

- `@medusajs/workflow-engine-cloudflare/schedule-store`
- Cloudflare-specific Workflow Engine schedule persistence behavior
- Provider package test/build configuration

Validation performed:

- `@medusajs/workflow-engine-cloudflare` focused Jest suite passed.
- `@medusajs/workflow-engine-cloudflare` build passed.
- `medusa-cloudflare` typecheck passed.
- Composed Worker import guard passed with 1016 bundled inputs.
- Production Worker build passed at 2,059.68 kB, gzip 375.78 kB.
- Durable Object SQLite workerd proof passed with schedule persistence and
  alarm recovery.

Next implementation step:

- Continue with a real DO-alarm-native schedule format if calendar-style
  scheduling is required, or move to the next workflow provider boundary.
  Do not add Worker cron-parser dependencies to the Cloudflare path.

## Cloudflare Workflow Scheduler Adapter

Commit:

- `952e372f05 Add Cloudflare workflow scheduler adapter`

Difference from original Medusa:

- `@medusajs/workflow-engine-cloudflare/scheduler-adapter` now provides the
  Cloudflare-selected Workflow Engine scheduler adapter.
- The adapter delegates to Worker-compatible global timer APIs and does not
  provide a cron parser. Cron schedules therefore remain unavailable on the
  Cloudflare path unless a future DO-alarm-native schedule adapter is added.
- `apps/medusa-cloudflare` explicitly registers both
  `workflowSchedulerAdapter` and `workflowScheduleStore` at the app root before
  loading the existing Workflow Engine module.
- The Cloudflare app adds the scheduler adapter dependency to the Workflow
  Engine module declaration only when the app selects that adapter, keeping the
  default Node/in-memory path unchanged.
- The Cloudflare provider package exports the adapter through an isolated
  subpath. The root provider barrel still does not re-export backend-specific
  runtime code.

Affected boundary:

- `@medusajs/workflow-engine-cloudflare/scheduler-adapter`
- `apps/medusa-cloudflare` Workflow Engine composition and aliases
- Existing Workflow Engine module dependency injection boundary

Validation performed:

- `@medusajs/workflow-engine-cloudflare` focused Jest suite passed.
- `@medusajs/workflow-engine-cloudflare` build passed.
- `medusa-cloudflare` typecheck passed.
- Composed Worker import guard passed with 1017 bundled inputs.
- Production Worker build passed at 2,060.64 kB, gzip 375.96 kB.
- Durable Object SQLite workerd proof passed with schedule persistence and
  alarm recovery.

Next implementation step:

- Continue with a real DO-alarm-native schedule format if calendar-style
  scheduling is required, or move to the next Workflow Engine provider
  boundary. Keep scheduler behavior adapter-driven and keep cron parser code
  out of the Worker import graph.

## Workflow Execution Store Boundary

Commit:

- `10efd04622 Add workflow execution store boundary`

Difference from original Medusa:

- `InMemoryDistributedTransactionStorage` now persists workflow checkpoints
  through a `WorkflowExecutionStore` contract instead of calling the Medusa
  internal Workflow Execution service directly.
- `InternalServiceWorkflowExecutionStore` is the default adapter. It preserves
  the original behavior by delegating checkpoint save, delete, lookup, expiry
  listing, and expiry deletion to the existing internal service.
- The Workflow Engine loader registers the default execution store when the
  container has not already provided `workflowExecutionStore`.
- The existing Workflow Engine public service APIs and Medusa module model
  remain unchanged. This is a persistence seam for future Cloudflare-specific
  execution storage, not a replacement Workflow Engine implementation.
- Expiry rows are narrowed at the adapter boundary before the storage attempts
  retention cleanup.

Affected boundary:

- `packages/modules/workflow-engine-inmemory` transaction storage and loader
- Workflow Engine checkpoint persistence, lookup, delete, and expiry cleanup
- Existing Workflow Engine focused storage tests

Validation performed:

- Focused Workflow Engine storage Jest suite passed.
- `@medusajs/workflow-engine-inmemory` build passed.
- `medusa-cloudflare` typecheck passed.
- Composed Worker import guard passed with 1017 bundled inputs.
- Production Worker build passed at 2,061.95 kB, gzip 376.18 kB.
- Durable Object SQLite workerd proof passed with schedule persistence and
  alarm recovery.

Next implementation step:

- Add a Cloudflare provider implementation of `WorkflowExecutionStore`, backed
  by DO SQLite/Drizzle, and wire it at the app root. Keep the existing
  Workflow Engine service and public workflow execution APIs unchanged.

## Cloudflare Workflow Execution Store

Commit:

- `51cb681121 Add Cloudflare workflow execution store`

Difference from original Medusa:

- `@medusajs/workflow-engine-cloudflare/execution-store` now implements the
  Workflow Engine execution store boundary for Cloudflare Durable Object
  SQLite.
- The Cloudflare store writes to the existing `workflow_execution` table rather
  than a parallel provider-only table, so existing Workflow Engine public APIs
  such as `listWorkflowExecutions` continue to read the same persisted rows.
- The store implements checkpoint save, latest lookup, soft delete by run id,
  expirable finished execution listing, and soft delete by id.
- `apps/medusa-cloudflare` now constructs the execution store at the app root
  and registers it alongside the Cloudflare scheduler adapter and schedule
  store before loading the existing Workflow Engine module.
- The Durable Object cart proof now asserts that a retained workflow execution
  is persisted through the Cloudflare execution store with state `done`.

Affected boundary:

- `@medusajs/workflow-engine-cloudflare/execution-store`
- `apps/medusa-cloudflare` Workflow Engine composition and provider aliases
- Durable Object SQLite workerd proof for Workflow Engine persistence

Validation performed:

- `@medusajs/workflow-engine-cloudflare` focused Jest suite passed.
- `@medusajs/workflow-engine-cloudflare` build passed.
- `@medusajs/workflow-engine-inmemory` build passed.
- `medusa-cloudflare` typecheck passed.
- Composed Worker import guard passed with 1018 bundled inputs.
- Production Worker build passed at 2,071.09 kB, gzip 377.82 kB.
- Durable Object SQLite workerd proof passed with Workflow execution
  persistence, schedule persistence, and alarm recovery.

Next implementation step:

- Continue reducing Workflow Engine app-owned proof logic by moving any
  remaining Cloudflare-specific Workflow Engine storage behavior into provider
  subpaths, or move to the next runtime boundary once Workflow Engine storage
  durability is sufficiently proven.

## Cloudflare Workflow Execution API Proof Coverage

Commit:

- `8314038784 Validate workflow execution APIs on Cloudflare runtime`

Difference from original Medusa:

- The Cloudflare HTTP proof setup resource now covers the Admin workflow
  execution API paths exercised by the original module integration spec:
  list, retrieve by id, retrieve by workflow/transaction id, run, success, and
  failure.
- This is not a replacement Workflow Engine implementation. The production
  direction remains the existing Medusa Workflow Engine service, with
  Cloudflare-specific persistence and scheduling behind provider boundaries.
- The setup path allowlist now forwards workflow execution retrieve, run, and
  success URLs to the existing proof handler instead of letting them fall
  through as 404s.
- Workflow execution proof rows now include the id, execution, context, and
  deleted_at fields expected by the original Admin workflow execution
  assertions.

Affected boundary:

- `apps/medusa-cloudflare` HTTP proof setup resources for Admin workflow
  execution routes.
- Original `integration-tests-modules` Workflow Engine API assertions running
  through `MEDUSA_TEST_HTTP_RUNTIME=cloudflare`.

Validation performed:

- Production Worker build passed.
- Existing `integration-tests-modules test:integration` runner passed for
  `workflow-engine/admin/workflow-executions.spec.ts` with
  `MEDUSA_TEST_HTTP_RUNTIME=cloudflare`: 1 suite, 3 tests.
- Existing `integration-tests-modules test:integration` runner passed for
  `workflow-engine/workflow-engine.spec.ts` with
  `MEDUSA_TEST_HTTP_RUNTIME=cloudflare`: 1 suite, 3 tests.

Next implementation step:

- Continue route-by-route validation with the existing
  `integration-tests-modules test:integration` script. Do not create parallel
  test scripts or replacement assertions for covered Medusa behavior.

## Workflow Delayed Action Store Contract

Commit:

- `a1c57bf46c` (`Add workflow delayed action store contract`)

Difference from original Medusa:

- The Workflow Engine in-memory storage now has a dedicated
  `WorkflowDelayedActionStore` contract for internal delayed actions.
- The delayed-action contract is intentionally separate from
  `WorkflowScheduleStore` because retry, step-timeout, and transaction-timeout
  actions are Workflow Engine internals, while scheduled workflows are named
  business schedules.
- `InMemoryWorkflowDelayedActionStore` preserves the current default behavior
  by using the injected `WorkflowSchedulerAdapter` to schedule and clear
  runtime timers.
- The Workflow Engine loader registers `workflowDelayedActionStore` only when a
  deployment has not already provided one.
- `InMemoryDistributedTransactionStorage` now accepts the delayed-action store
  dependency and clears it on shutdown, but retry and timeout paths still use
  the existing timer maps in this slice. Moving those paths behind the contract
  is the next turn in the delayed-action runtime goal.

Affected boundary:

- `@medusajs/workflow-engine-inmemory` utility contracts and loader
- Default Workflow Engine timer-backed delayed-action behavior
- Future Cloudflare provider boundary for durable delayed actions

Validation performed:

- Focused Workflow Engine storage Jest suite passed:

```bash
yarn workspace @medusajs/workflow-engine-inmemory test --testPathPattern=workflow-orchestrator-storage.spec.ts --runInBand
```

Result: 2 suites passing, 12 tests passing.

- `@medusajs/workflow-engine-inmemory` build passed.
- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare` composed Worker import guard passed with 1546 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.

Next implementation step:

- Turn 2 of `plan/roadmaps/workflow-delayed-actions-runtime-goal.md`: route
  `scheduleRetry`, `scheduleStepTimeout`, and `scheduleTransactionTimeout`
  through the delayed-action boundary while keeping Node/default behavior
  timer-backed.

## Workflow Delayed Action Routing

Commit:

- `1550196c85` (`Route workflow delayed actions through store`)

Difference from original Medusa:

- `WorkflowDelayedActionStore` now exposes delayed-action records only. Runtime
  timer handles are private to `InMemoryWorkflowDelayedActionStore`.
- `scheduleRetry`, `scheduleStepTimeout`, and `scheduleTransactionTimeout` now
  create delayed-action records through the injected store instead of owning
  hard-coded retry and timeout timer maps in
  `InMemoryDistributedTransactionStorage`.
- `clearRetry`, `clearStepTimeout`, and `clearTransactionTimeout` now cancel
  through the delayed-action store.
- The default Node/in-memory path remains timer-backed through
  `InMemoryWorkflowDelayedActionStore` and the injected
  `WorkflowSchedulerAdapter`.
- Delayed-action records capture the action kind, workflow id, transaction id,
  optional step id, due timestamp, and a narrowed workflow run context derived
  from Medusa's `Context` type.
- This does not replace the Workflow Engine service, Medusa workflow
  definitions, or public workflow contracts. It only moves internal delayed
  retry and timeout scheduling behind the provider boundary needed for a
  durable Cloudflare implementation.

Affected boundary:

- `@medusajs/workflow-engine-inmemory` delayed-action contracts
- `InMemoryDistributedTransactionStorage` retry and timeout scheduling
- Future `@medusajs/workflow-engine-cloudflare/delayed-action-store` provider

Validation performed:

- Focused Workflow Engine storage Jest suite passed:

```bash
yarn workspace @medusajs/workflow-engine-inmemory test --testPathPattern=workflow-orchestrator-storage.spec.ts --runInBand
```

Result: 2 suites passing, 13 tests passing.

- `@medusajs/workflow-engine-inmemory` build passed.
- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare` composed Worker import guard passed with 1546 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.
- `medusa-cloudflare` real module import audit passed.
- `medusa-cloudflare` Vitest suite passed: 14 tests passing.
- `medusa-cloudflare test:cart-do-sqlite` workerd proof passed.
- `git diff --check` passed with CRLF warnings only.

Integration validation note:

- The package integration runner was attempted for
  `@medusajs/workflow-engine-inmemory`, but the local PostgreSQL environment
  failed before exercising workflow behavior:
  `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.
  Teardown then reported `ORM not configured`.

Next implementation step:

- Turn 3 of `plan/roadmaps/workflow-delayed-actions-runtime-goal.md`: add the
  Cloudflare Durable Object SQLite delayed-action store provider subpath.

## Cloudflare Workflow Delayed Action Store

Commit:

- `2efb4ae5c1` (`Add Cloudflare workflow delayed action store`)

Difference from original Medusa:

- `@medusajs/workflow-engine-cloudflare/delayed-action-store` now provides the
  Cloudflare-selected delayed-action store for Workflow Engine internal retry,
  step-timeout, and transaction-timeout actions.
- Delayed actions are persisted in Durable Object SQLite with action kind,
  workflow id, transaction id, optional step id, due timestamp, narrowed
  workflow context, handled timestamp, and cancellation timestamp.
- The store keeps the Durable Object alarm pointed at the earliest pending
  delayed action.
- Cancellation is durable: `delete(actionId)` marks a pending action cancelled
  and reschedules the alarm.
- Recovery primitives are provider-owned: due actions can be listed and
  recovered through a callback, successful actions are marked handled, and
  failed actions remain pending for a later recovery attempt.
- The provider package root still exports nothing. The new backend-specific
  runtime code is available only through the isolated `./delayed-action-store`
  subpath.
- This slice does not wire the provider into `apps/medusa-cloudflare` and does
  not move Workflow Engine recovery behavior into the app. Wiring waits for a
  package-owned Workflow Engine delayed-action recovery API.

Affected boundary:

- `@medusajs/workflow-engine-cloudflare/delayed-action-store`
- Durable Object SQLite storage for Workflow Engine internal delayed actions
- Future Durable Object alarm recovery path for retry and timeout behavior

Validation performed:

- `@medusajs/workflow-engine-cloudflare` Jest suite passed: 4 suites, 11 tests.
- `@medusajs/workflow-engine-cloudflare` build passed.
- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare` composed Worker import guard passed with 1546 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.
- `medusa-cloudflare` real module import audit passed.
- `medusa-cloudflare` Vitest suite passed: 14 tests.
- `medusa-cloudflare test:cart-do-sqlite` workerd proof passed.

Next implementation step:

- Turn 4 of `plan/roadmaps/workflow-delayed-actions-runtime-goal.md`: add a
  package-owned Workflow Engine recovery API for due delayed actions before
  wiring the provider into the Cloudflare app alarm path.

## Workflow Delayed Action Recovery API

Commit:

- `1e7df9bd9e` (`Add workflow delayed action recovery API`)

Difference from original Medusa:

- The Workflow Engine now exposes `recoverDueDelayedActions(now?)` through the
  existing service stack: `InMemoryDistributedTransactionStorage`,
  `WorkflowOrchestratorService`, `WorkflowsModuleService`, and
  `IWorkflowEngineService`.
- `RecoverableWorkflowDelayedActionStore` is the durable-provider extension
  point for recovering due internal retry, step-timeout, and
  transaction-timeout actions.
- Recovery delegates each due action back to the same
  `runDelayedWorkflowAction(...)` path used by timer-backed delayed actions.
  That preserves the existing Workflow Engine run behavior and context
  handling.
- Default Node/in-memory behavior is unchanged. Stores that do not implement
  `recoverDueActions(...)` return an empty recovery result.
- The Cloudflare app is still not responsible for retry or timeout recovery
  internals. A later wiring slice should call this service API from the
  Durable Object alarm after registering the Cloudflare delayed-action store.

Affected boundary:

- `@medusajs/workflow-engine-inmemory` delayed-action recovery contract
- `WorkflowOrchestratorService` and `WorkflowsModuleService` service APIs
- `@medusajs/types` `IWorkflowEngineService`
- Future Cloudflare Durable Object alarm wiring

Validation performed:

- Focused Workflow Engine storage Jest suite passed: 2 suites, 15 tests.
- `@medusajs/types` build passed.
- `@medusajs/workflow-engine-inmemory` build passed.
- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare` composed Worker import guard passed with 1546 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.
- `medusa-cloudflare` real module import audit passed.
- `medusa-cloudflare` Vitest suite passed: 14 tests.
- `medusa-cloudflare test:cart-do-sqlite` workerd proof passed.

Integration validation note:

- The package integration runner was attempted again with:

```bash
yarn workspace @medusajs/workflow-engine-inmemory test:integration
```

It failed before workflow behavior executed because the local PostgreSQL
environment returned `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be
a string`, and teardown then reported `ORM not configured`.
- `initdb`, `pg_ctl`, `postgres`, and `psql` were not available on PATH, so an
  isolated temporary PostgreSQL cluster could not be started in this turn.

Next implementation step:

- Turn 5 of `plan/roadmaps/workflow-delayed-actions-runtime-goal.md`: wire
  `DurableObjectWorkflowDelayedActionStore` into `apps/medusa-cloudflare`
  composition and call `recoverDueDelayedActions(...)` from the Durable Object
  alarm alongside scheduled workflow recovery.

## Cloudflare Delayed Action Alarm Wiring

Commit:

- `3acf03429c`

Difference from original Medusa:

- `apps/medusa-cloudflare` now constructs
  `DurableObjectWorkflowDelayedActionStore` at the Durable Object composition
  root and registers it as `workflowDelayedActionStore` for the existing
  Workflow Engine module.
- `createCommerceModulesRuntimeWithManager(...)` accepts the delayed-action
  store and adds the dependency token only when the app root selects that
  provider.
- `CartProofDO.alarm()` now calls both package-owned Workflow Engine recovery
  APIs: `recoverDueSchedules()` and `recoverDueDelayedActions()`.
- The Cloudflare proof route validates a real retrying workflow path: first
  run persists a retry delayed action in Durable Object SQLite, runtime
  handlers are cleared, and recovery completes the workflow through the
  existing Workflow Engine service.
- The proof accepts either explicit service recovery or automatic Durable
  Object alarm recovery. In the validated workerd run, the DO alarm recovered
  the retry action before the explicit fallback call.
- `DurableObjectWorkflowDelayedActionStore` now marks recovered actions handled
  even if the resumed workflow clears the same retry during normal cleanup.

Affected boundary:

- `apps/medusa-cloudflare` Workflow Engine composition and `CartProofDO.alarm()`
- `@medusajs/workflow-engine-cloudflare/delayed-action-store`
- Workerd Cart Durable Object SQLite proof harness

Validation performed:

- `@medusajs/workflow-engine-cloudflare` Jest suite passed: 4 suites, 11 tests.
- `@medusajs/workflow-engine-cloudflare` build passed.
- `medusa-cloudflare` typecheck passed after provider build completed.
- `medusa-cloudflare` composed Worker import guard passed with 1547 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.
- `medusa-cloudflare` real module import audit passed.
- `medusa-cloudflare` Vitest suite passed: 14 tests.
- `medusa-cloudflare test:cart-do-sqlite` workerd proof passed with Workflow
  delayed-action persistence and alarm recovery included.

Validation note:

- Running provider build and app typecheck in parallel can fail transiently
  because provider build removes `dist` before re-emitting declarations. The
  recorded typecheck pass was run after provider build completed.

Next implementation step:

- Turn 6 of `plan/roadmaps/workflow-delayed-actions-runtime-goal.md`: broaden
  real workflow proof coverage for retry, step-timeout, and
  transaction-timeout behavior, preferring unchanged Medusa Workflow Engine
  assertions where practical.

## Cloudflare Step Timeout Delayed Action Proof

Commit:

- `bd5df21e4f`

Difference from original Medusa:

- `apps/medusa-cloudflare` now includes a proof-only
  `step-timeout-alarm-proof` route that validates the existing Workflow Engine
  step-timeout behavior against the Cloudflare delayed-action store.
- The proof uses a real async workflow step with `timeout: 0.1`, matching the
  existing Medusa async step-timeout fixture pattern instead of app-owned
  timeout logic.
- First run persists a `step-timeout` delayed action in Durable Object SQLite.
- Runtime delayed-action handlers are cleared before recovery, then the proof
  allows the Durable Object alarm to recover the action or calls
  `recoverDueDelayedActions(...)` as the package-owned fallback.
- The proof verifies the recovered transaction state is `reverted`, the
  workflow error is a `TransactionStepTimeoutError`, the delayed action is
  marked handled, and cleanup leaves no pending delayed actions.

Affected boundary:

- `apps/medusa-cloudflare` proof-only Cart Durable Object route.
- Workerd Cart Durable Object SQLite proof checker.
- Existing Workflow Engine service recovery API and Cloudflare delayed-action
  store, without changing shared Workflow Engine behavior in this slice.

Validation performed:

- `@medusajs/workflow-engine-inmemory` focused Jest storage suite passed:
  2 suites, 15 tests.
- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare` composed Worker import guard passed with 1547 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.
- `medusa-cloudflare` real module import audit passed.
- `medusa-cloudflare` Vitest suite passed: 14 tests.
- `medusa-cloudflare test:cart-do-sqlite` workerd proof passed with Workflow
  step-timeout delayed-action recovery included.

Validation note:

- A broad `@medusajs/orchestration` root import was rejected during validation
  because it pulled `@medusajs/utils` broad barrels and MikroORM into the Worker
  import graph. The implemented proof imports the existing narrow
  `@medusajs/orchestration/transaction/errors` subpath instead.

Next implementation step:

- Turn 7 of `plan/roadmaps/workflow-delayed-actions-turn-tracker.md`: prove
  transaction-timeout delayed-action recovery in workerd.

## Cloudflare Transaction Timeout Delayed Action Proof

Commit:

- `72ca5aca12`

Difference from original Medusa:

- `apps/medusa-cloudflare` now includes a proof-only
  `transaction-timeout-alarm-proof` route that validates existing Workflow
  Engine transaction-timeout behavior against the Cloudflare delayed-action
  store.
- The proof uses a real workflow-level `timeout: 0.1` and async workflow step,
  matching the existing Medusa async transaction-timeout fixture pattern
  instead of app-owned timeout logic.
- First run persists a `transaction-timeout` delayed action in Durable Object
  SQLite.
- Runtime delayed-action handlers are cleared before recovery, then the proof
  allows the Durable Object alarm to recover the action or calls
  `recoverDueDelayedActions(...)` as the package-owned fallback.
- The proof verifies the recovered transaction state is `reverted`, the
  workflow error is a `TransactionTimeoutError`, the delayed action is marked
  handled, and cleanup leaves no pending delayed actions.

Affected boundary:

- `apps/medusa-cloudflare` proof-only Cart Durable Object route.
- Workerd Cart Durable Object SQLite proof checker.
- Existing Workflow Engine service recovery API and Cloudflare delayed-action
  store, without changing shared Workflow Engine behavior in this slice.

Validation performed:

- `@medusajs/workflow-engine-inmemory` focused Jest storage suite passed:
  2 suites, 15 tests.
- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare` composed Worker import guard passed with 1547 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.
- `medusa-cloudflare` real module import audit passed.
- `medusa-cloudflare` Vitest suite passed: 14 tests.
- `medusa-cloudflare test:cart-do-sqlite` workerd proof passed with Workflow
  transaction-timeout delayed-action recovery included.

Existing assertion mapping:

- Retry is covered in workerd by `delayed-action-alarm-proof`.
- Async step-timeout is covered in workerd by `step-timeout-alarm-proof` and
  mirrors the existing `workflow_step_timeout_async` fixture shape.
- Async transaction-timeout is covered in workerd by
  `transaction-timeout-alarm-proof` and mirrors the existing
  `workflow_transaction_timeout_async` fixture shape.
- A focused unchanged integration selector was attempted with:

```bash
cmd /c ..\..\..\node_modules\.bin\jest --passWithNoTests --forceExit --runInBand --testPathPattern="integration-tests/__tests__/index\.spec\.ts" -t "transaction timeout expires"
```

It failed before workflow behavior executed because local PostgreSQL auth
returned `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`;
teardown then reported `ORM not configured`.

Goal status:

- Retry, step-timeout, and transaction-timeout delayed actions now have durable
  Cloudflare recovery proof coverage through the existing Workflow Engine
  service and `recoverDueDelayedActions(...)` API.

## Workflow Engine Temp PostgreSQL Integration Runner

Commit:

- `eb92c01de0`

Difference from original Medusa:

- `@medusajs/workflow-engine-inmemory` now has a package-local
  `test:integration:temp-postgres` script that starts an isolated temporary
  PostgreSQL cluster for the package integration runner.
- The runner uses `PG_BIN` when provided, otherwise discovers the local
  PostgreSQL binaries on Windows under `C:\Program Files\PostgreSQL`.
- The runner sets `DB_HOST`, `DB_PORT`, `DB_USERNAME`, and `DB_PASSWORD` only
  for the child Jest process and stops/removes the temporary cluster after the
  run.
- This avoids changing the machine's existing PostgreSQL service and replaces
  the previous local blocker where the default connection hit the installed
  server with no password and failed with
  `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.

Affected boundary:

- `packages/modules/workflow-engine-inmemory/package.json`
- `packages/modules/workflow-engine-inmemory/scripts/run-integration-with-temp-postgres.mjs`
- Local Workflow Engine integration-test execution only; runtime behavior is
  unchanged.

Validation performed:

- Focused existing Workflow Engine integration selectors passed through the
  temp PostgreSQL runner:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test:integration:temp-postgres -- --passWithNoTests --forceExit --runInBand --verbose --testPathPattern=integration-tests/__tests__/index\.spec\.ts -t "retry steps X times automatically when maxRetries is set|step timeout expires|transaction timeout expires"
```

Result: `integration-tests/__tests__/index.spec.ts` passed with 4 tests and
25 skipped.

- Dedicated retry interval integration file passed through the temp PostgreSQL
  runner:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test:integration:temp-postgres -- --passWithNoTests --forceExit --runInBand --verbose --testPathPattern=integration-tests/__tests__/retry-interval\.spec\.ts
```

Result: `integration-tests/__tests__/retry-interval.spec.ts` passed with
2 tests.

Full-suite note:

- Running `cmd /c yarn workspace @medusajs/workflow-engine-inmemory test:integration:temp-postgres`
  now reaches workflow behavior instead of failing at PostgreSQL auth, but the
  full package integration suite is not green yet.
- Remaining full-suite failures observed after unblocking PostgreSQL:
  - scheduled cron workflow fails because the Worker-compatible default
    scheduler has no cron parser adapter;
  - parallel async error assertion times out;
  - cleaner job fails deleting workflow executions by id through the current
    internal service path.

Next implementation step:

- Decide whether to restore a Node-only cron parser adapter for the default
  Node integration lane without adding cron parsing to the Worker bundle, then
  address the remaining full-suite Workflow Engine failures one by one.

## Node Workflow Scheduler Cron Adapter

Commit:

- `cb8e52bea1`

Difference from original Medusa:

- `@medusajs/workflow-engine-inmemory` now exposes a Node-only
  `./node-scheduler-adapter` subpath that adds `cron-parser` support to the
  existing scheduler adapter contract.
- The Worker-compatible default scheduler adapter remains cron-parser-free and
  still fails clearly when cron parsing is requested without an injected
  parser.
- The Workflow Engine integration spec now injects the Node scheduler adapter
  and declares `workflowSchedulerAdapter` as a module dependency, matching the
  app-root dependency bridge used by Cloudflare-specific workflow stores.
- The package root and shared utils barrel do not export the Node cron adapter,
  so Worker bundles only see it when an application root explicitly imports
  that backend-specific subpath.

Affected boundary:

- `packages/modules/workflow-engine-inmemory/src/node-scheduler-adapter.ts`
- `packages/modules/workflow-engine-inmemory/package.json`
- `packages/modules/workflow-engine-inmemory/integration-tests/__tests__/index.spec.ts`

Validation performed:

- Focused Workflow Engine Jest suite passed:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test --testPathPattern=node-scheduler-adapter.spec.ts --runInBand
```

Result: 3 suites passed, 16 tests passed.

- `@medusajs/workflow-engine-inmemory` build passed.
- Focused unchanged scheduled workflow integration selector passed through the
  temp PostgreSQL runner:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test:integration:temp-postgres -- --passWithNoTests --forceExit --runInBand --verbose --testPathPattern=integration-tests/__tests__/index\.spec\.ts -t "should execute a scheduled workflow"
```

Result: 1 test passed, 28 skipped.

- `medusa-cloudflare` composed Worker import guard passed with 1547 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.

Full integration status:

- A broader `test:integration:temp-postgres` run now passes the scheduled cron
  workflow tests and the parallel async error assertion in
  `integration-tests/__tests__/index.spec.ts`.
- The remaining observed failure in that file is the cleaner job:
  `workflowExecution - workflow_id, transaction_id, run_id must be defined`
  when deleting expired workflow executions through the current internal
  service path.

Next implementation step:

- Fix the Workflow Engine cleaner deletion path so the existing cleaner job
  assertion passes, then continue the remaining package integration files.

## Workflow Cleaner Composite-Key Deletion

Commit:

- `1b90a01e6f`

Difference from original Medusa:

- `WorkflowExecutionStore` no longer deletes expired workflow executions by the
  generated `id` column.
- Expirable workflow execution rows now carry the actual DML primary key:
  `workflow_id`, `transaction_id`, and `run_id`.
- `InternalServiceWorkflowExecutionStore.delete(...)` passes those composite
  identifiers to the generated internal service, matching the
  `WorkflowExecution` model primary-key contract.
- The temp PostgreSQL integration runner now starts the isolated PostgreSQL
  process with UTC settings and runs the package integration files
  `--runInBand`. This keeps timestamp-without-time-zone parsing aligned with
  `Date.now()` in the Node test process and avoids timing-sensitive workflow
  flakes in the default package command.

Affected boundary:

- `packages/modules/workflow-engine-inmemory/src/utils/workflow-orchestrator-storage.ts`
- `packages/modules/workflow-engine-inmemory/src/__tests__/workflow-orchestrator-storage.spec.ts`
- `packages/modules/workflow-engine-inmemory/scripts/run-integration-with-temp-postgres.mjs`

Validation performed:

- Focused Workflow Engine storage Jest suite passed:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test --testPathPattern=workflow-orchestrator-storage.spec.ts --runInBand
```

Result: 3 suites passed, 16 tests passed.

- `@medusajs/workflow-engine-inmemory` build passed.
- Focused unchanged cleaner integration selector passed through the temp
  PostgreSQL runner:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test:integration:temp-postgres -- --passWithNoTests --forceExit --runInBand --verbose --testPathPattern=integration-tests/__tests__/index\.spec\.ts -t "should remove expired executions of finished workflows and keep the others"
```

Result: 1 test passed, 28 skipped.

- Full unchanged Workflow Engine package integration command passed through the
  temp PostgreSQL runner:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test:integration:temp-postgres
```

Result: `index.spec.ts` 29 tests passed, `race.spec.ts` 4 tests passed,
`subscribe.spec.ts` 2 tests passed, and `retry-interval.spec.ts` 2 tests
passed.

- `medusa-cloudflare` composed Worker import guard passed with 1547 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.

Current status:

- The Workflow Engine in-memory package integration suite is green through the
  isolated temp PostgreSQL runner.
- The remaining Workflow Engine migration work is no longer the Node package
  integration lane; continue with Cloudflare/workerd provider coverage or the
  next selected runtime boundary.

## Cloudflare Workflow Execution Store Composite-Key Contract

Commit:

- `5cd566ee57`

Difference from original Medusa:

- The Cloudflare Workflow Engine execution store provider now follows the same
  cleaner deletion contract as the Node internal-service-backed store.
- Expirable finished execution rows are selected with the actual
  `WorkflowExecution` primary key fields: `workflow_id`, `transaction_id`, and
  `run_id`.
- Deletion updates the Durable Object SQLite row by that composite key instead
  of using the generated `id` column.
- The existing Cart proof Durable Object already selects this provider at the
  application composition root, keeping Cloudflare storage selection out of
  shared Medusa barrels.

Affected boundary:

- `packages/modules/providers/workflow-engine-cloudflare/src/execution-store.ts`
- `packages/modules/providers/workflow-engine-cloudflare/src/__tests__/execution-store.spec.ts`
- Existing composition root:
  `apps/medusa-cloudflare/src/cart-proof-do.ts`
- Existing runtime dependency bridge:
  `apps/medusa-cloudflare/src/commerce-modules.ts`

Validation performed:

- Cloudflare Workflow Engine provider tests passed:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-cloudflare test --testPathPattern=execution-store --runInBand
```

Result: 4 suites passed, 11 tests passed.

- `@medusajs/workflow-engine-cloudflare` build passed.
- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare test:cart-do-sqlite` passed, including actual Durable
  Object SQLite module-set proof, Workflow execution store persistence, schedule
  persistence, queue dispatch, alarm recovery, and atomic rollback proof.
- `medusa-cloudflare` composed Worker import guard passed with 1547 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.

Next implementation step:

- Add the colocated cleaner proof against the Cart proof Durable Object so
  expired workflow executions are validated through the same DO SQLite
  execution-store boundary.

## Colocated Durable Object Workflow Execution Cleaner Proof

Commit:

- `118a553f9f`

Difference from original Medusa:

- Workflow Engine execution cleanup is now exposed as
  `IWorkflowEngineService.clearExpiredExecutions()`.
- The method delegates to the existing Workflow Engine storage cleaner instead
  of requiring application code or tests to reach into private storage fields.
- Both current Workflow Engine service implementations expose the method:
  in-memory/Postgres and Redis.
- The Cloudflare Cart proof Durable Object now validates cleaner behavior
  against its colocated DO SQLite execution store by seeding expired finished,
  not-yet-expired finished, and expired running executions and then invoking
  the shared Workflow Engine service cleaner.

Affected boundary:

- `packages/core/types/src/workflows-sdk/service.ts`
- `packages/modules/workflow-engine-inmemory/src/services/workflow-orchestrator.ts`
- `packages/modules/workflow-engine-inmemory/src/services/workflows-module.ts`
- `packages/modules/workflow-engine-redis/src/services/workflow-orchestrator.ts`
- `packages/modules/workflow-engine-redis/src/services/workflows-module.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`

Validation performed:

- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare test:cart-do-sqlite` passed and now includes
  `POST /do-cart/:id/execution-cleaner-proof`.
- Focused Workflow Engine storage Jest suite passed:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test --testPathPattern=workflow-orchestrator-storage.spec.ts --runInBand
```

Result: 3 suites passed, 16 tests passed.

- `medusa-cloudflare` composed Worker import guard passed with 1547 bundled
  inputs.
- `medusa-cloudflare` runtime source import guard passed.
- `medusa-cloudflare` portable entrypoint guard passed.
- Full unchanged Workflow Engine package integration command passed through the
  temp PostgreSQL runner:

```bash
cmd /c yarn workspace @medusajs/workflow-engine-inmemory test:integration:temp-postgres
```

Result: `index.spec.ts` 29 tests passed, `race.spec.ts` 4 tests passed,
`subscribe.spec.ts` 2 tests passed, and `retry-interval.spec.ts` 2 tests
passed.

Current status:

- The colocated Workflow Execution Durable Object SQLite proof now covers
  execution persistence, composite-key deletion, cleaner behavior, schedule
  persistence, delayed-action persistence, queue dispatch, alarm recovery, and
  atomic rollback.

## Workflow Step Route SDK Import Portability

Commit:

- `84d9e35197 Move Admin Users retrieve to Fetch manifest`

Difference from original Medusa:

- The Admin workflow execution step-success and step-failure route handlers now
  import `StepResponse` directly from `@medusajs/workflows-sdk`.
- Original Medusa imports it through `@medusajs/framework/workflows-sdk`.
- In this fork, that framework re-export pulls framework container typings into
  the Worker bundle graph, which reaches MikroORM/Knex type augmentation.
- The direct workflows SDK import preserves the same runtime class while
  avoiding the broad framework re-export for already package-owned static
  Fetch routes.

Affected boundary:

- `packages/medusa/src/api/admin/workflows-executions/[workflow_id]/steps/success/route.ts`
- `packages/medusa/src/api/admin/workflows-executions/[workflow_id]/steps/failure/route.ts`
- Cloudflare Worker import graph for package-owned workflow step routes.

Validation performed:

```bash
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The workflow step routes remain package-owned static manifest
routes and no longer introduce the framework workflow-sdk re-export path into
the Worker bundle.

## User Delete Workflow Portable Entrypoint

Commit:

- `71aafe9079 Move Admin Users delete to Fetch manifest`

Difference from original Medusa:

- `removeUserAccountWorkflow`, `deleteUsersWorkflow`, `deleteUsersStep`,
  `setAuthAppMetadataStep`, `useRemoteQueryStep`, and `removeRemoteLinkStep`
  now use direct portable workflow SDK and type/event imports along the
  Admin Users delete route path.
- Original Medusa reaches these helpers through broad
  `@medusajs/framework/*` barrels and common workflow barrels.
- In this fork, package-owned static Fetch routes cannot allow those broad
  barrels into the Worker graph because they can pull framework container,
  modules-sdk, and MikroORM edges.
- `@medusajs/core-flows/user/workflows/remove-user-account` is now an explicit
  package subpath so the application root and import guard can resolve the
  Worker-facing workflow path to source without importing unrelated
  core-flows barrels.
- `removeRemoteLinkStep` resolves a narrow structural link service contract for
  `delete(...)` and `restore(...)` instead of importing the runtime
  `@medusajs/framework/modules-sdk` Link type.

Affected boundary:

- `packages/core/core-flows/src/user/workflows/remove-user-account.ts`
- `packages/core/core-flows/src/user/workflows/delete-users.ts`
- `packages/core/core-flows/src/user/steps/delete-users.ts`
- `packages/core/core-flows/src/auth/steps/set-auth-app-metadata.ts`
- `packages/core/core-flows/src/common/steps/use-remote-query.ts`
- `packages/core/core-flows/src/common/steps/remove-remote-links.ts`
- `packages/core/core-flows/package.json`
- Worker import graph for `DELETE /admin/users/:id`

Validation performed:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The Admin Users delete route now executes the real
`removeUserAccountWorkflow` through the package-owned Fetch route path without
introducing `@medusajs/framework/modules-sdk` or MikroORM blockers into the
composed Worker import graph.

## User Delete Workflow Direct Utility Imports

Commit:

- `55bc41c10a Use portable utility imports in user delete flow`

Difference from original Medusa:

- The Worker-facing user delete workflow path now imports utility constants and
  helpers directly from portable `@medusajs/utils/*` subpaths:
  `Modules`, `ContainerRegistrationKeys`, and `remoteQueryObjectFromString`.
- Original Medusa imports those values through `@medusajs/framework/utils`.
- In this fork, `@medusajs/framework/utils` is still too broad for Worker
  bundle boundaries and currently requires an app-local shim. Direct portable
  imports reduce that shim dependency for the proven Admin Users delete flow.
- This is an import-boundary cleanup only; route behavior, workflow graph, and
  module service contracts are unchanged.

Affected boundary:

- `packages/core/core-flows/src/user/workflows/delete-users.ts`
- `packages/core/core-flows/src/user/steps/delete-users.ts`
- `packages/core/core-flows/src/auth/steps/set-auth-app-metadata.ts`
- `packages/core/core-flows/src/common/steps/emit-event.ts`
- `packages/core/core-flows/src/common/steps/remove-remote-links.ts`
- `packages/core/core-flows/src/common/steps/use-remote-query.ts`
- Worker import graph for `DELETE /admin/users/:id`

Validation performed:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. A first workerd run timed out waiting for local server health
after a successful build; an immediate rerun passed.

## User Update Step Direct Utility Import

Commit:

- `dd304d0bbc Use portable utility import in user update step`

Difference from original Medusa:

- The Worker-facing user update step now imports `Modules` directly from the
  portable `@medusajs/utils/modules-sdk/definition` subpath.
- Original Medusa imports `Modules` through `@medusajs/framework/utils`.
- In this fork, `@medusajs/framework/utils` remains too broad for Worker
  import boundaries and is still backed by an app-local shim in the proof app.
  Direct portable imports reduce that shim dependency for the already proven
  Admin Users update flow.
- This is an import-boundary cleanup only; route behavior, workflow graph, and
  module service contracts are unchanged.

Affected boundary:

- `packages/core/core-flows/src/user/steps/update-users.ts`
- Worker import graph for `POST /admin/users/:id`

Validation performed:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Cart Update Workflow Registration Blocker

Commit:

- This commit (`Record cart mutation workflow blocker`)

Difference from original Medusa:

- Original Medusa imports workflows through the Node filesystem
  `WorkflowLoader`; importing the workflow file registers it through
  `createWorkflow(...)`.
- The Cloudflare runtime needs the same behavior through package-owned static
  workflow entrypoints, without filesystem discovery and without broad
  framework barrels entering the Worker bundle.

Finding:

- The unchanged Store cart update route calls `we.run("update-cart", ...)`.
- The current Cart DO production runtime reaches the unchanged route, but the
  workflow is not registered in the Worker workflow registry.
- Importing `packages/core/core-flows/src/cart/workflows/update-cart.ts` as a
  first static registration proof pulls a broad cart workflow graph:
  refresh-cart, cart promotions, shipping methods, payment collection, tax
  lines, fulfillment helpers, locking steps, and translation helpers.
- That graph still contains Worker blockers, including Node timer imports in
  locking steps and broad `@medusajs/framework/*`/`@medusajs/utils` edges that
  lead to filesystem, MikroORM, PostgreSQL, Knex, JWT, and other Node-only
  dependencies during the workerd build.

Decision:

- Do not fake or reimplement `update-cart` in `apps/medusa-cloudflare`.
- Treat cart mutation routing as blocked on making the real cart core-flow
  graph Worker-portable through package-owned static workflow entrypoints.
- Keep route partitioning and workflow portability as separate slices: the
  route key is already understood, but the unchanged handler cannot execute in
  production Worker runtime until the workflow graph is portable.

Validation performed:

- Focused app typecheck passed after backing out the unproven static workflow
  import.
- Focused Worker routing tests passed with the last proven GET-only Cart route
  policy.
- Workerd Cart DO SQLite proof remains the required gate before POST cart
  routing can be considered complete.
