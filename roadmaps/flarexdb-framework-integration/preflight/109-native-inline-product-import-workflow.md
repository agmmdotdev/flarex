# Native Inline Product Import Workflow

## Status And Authority

Status: pinned-source and current-owner preflight complete. Native CSV
normalization and the Notification service/model/local-provider prerequisites
are implemented privately. Their source availability does not admit a complete
import or standalone Notification facade. Durable confirmation,
cross-commit child invocation, compensation/event eligibility, native Notification
admission and connected import implementation remain proposed. Bounded native
orchestration has executed with storage and business test ports; database,
provider, elapsed-timeout and Redis conformance remain unproven. This is not
implemented import support.

The continuing Medusa integration goal authorizes necessary correct-owner
changes, implementation, review and scoped commits. Authority is the accepted
[Flarex design](../../../design-notes/flarex-db-accepted-design.md),
[package boundaries](../../16-package-boundaries.md),
[Medusa adoption](../06-medusa-adoption.md) and Medusa 2.13.4 pinned at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island remains read-only.
No hosted activation or destructive disposition of existing durable data follows
from this preflight.

The finite atomic Product workflow family, including the Image-to-Variants
implementation described in [record 108](./108-native-image-variant-workflow.md),
does not establish long-running execution. Record 108 retains its own current
validation/status gates. Existing atomic profiles must keep their limits,
rollback, replay and event-publication contracts while this different profile
is developed.

## Next Connected Outcome

Select native `importProductsWorkflow` with inline CSV text and filename before
the chunked File import or export composer. It avoids File, Region and Node
stream dependencies. Its connected closure is still broader than CSV parsing:
native normalization and summary, durable confirmation with a one-hour timeout,
one background native Product batch, genuine success Notification and genuine
failure compensation, including the child-cancellation and event-group behavior.

The first implementation milestone is a host-neutral, scope-bound
confirmation-to-one-commerce-child boundary. CSV planning and the native local
feed Notification path are connected framework work. An isolated parser,
confirmation record or batch invocation is a milestone, not completion of this
workflow. Do not replace the native composer with a convenience import command
or call an always-confirmed wrapper compatible.

## Exact Pinned Source And Native Sequence

The selected source is
`third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/import-products.ts`.
Its direct execution dependencies under that core-flows `src/` root are:

- `product/steps/normalize-products.ts`
- `product/utils/csvtojson.ts`
- `product/steps/wait-confirmation-product-import.ts`
- `product/workflows/batch-products.ts` and its admitted create/update/delete
  children, with only the create/update branches produced by CSV normalization.
- `notification/steps/notify-on-failure.ts`
- `notification/steps/send-notifications.ts`

`normalizeCsvStep(fileContent)` executes `convertCsvToJson`, native
`CSVNormalizer.preProcess(row, index + 1)` and `CSVNormalizer.proccess()`, then
the genuine Product create/update Zod validators. Relevant native utility files
are `packages/core/utils/src/product/csv-normalizer.ts` and
`packages/core/utils/src/product/validators.ts` under the pinned source root.
`csvtojson.ts` passes `preventCsvInjection: true` to `json-2-csv`'s `csv2json`
and uses native comma/semicolon/pipe header delimiter detection. The pinned
parser applies that option to JSON-to-CSV conversion, not this parse direction;
formula-looking input therefore remains data. Reuse these actual
normalization rules, grouping, conversions, defaults and failures. The CSV
validators are this executing workflow's native input contract; they do not
replace DML validation at persistence boundaries.

The promoted normalizer intentionally corrects a pinned-source dictionary
defect. Product handles and IDs use own-entry dictionaries so names such as
`__proto__`, `constructor` and `toString` cannot select and mutate inherited
objects. Ordinary grouping and enumeration semantics remain native. Variant
option name `__proto__` is explicitly refused with the native row-numbered
error: the pinned Zod record constructor discards that key, so accepting it
would silently lose the option. Other valid option names retain their native
meaning. This correction belongs to the fork normalizer; the adapter does not
filter identities or replace the native validator.

The resulting `{ create, update }` yields summary
`{ toCreate: create.length, toUpdate: update.length }`. Next,
`waitConfirmationProductImportStep` is configured with `async: true` and
`timeout: 60 * 60 * 1`; its invocation body returns no completion signal.
The native examples confirm through the Workflow Engine's `setStepSuccess`,
with workflow ID, transaction ID, invocation action, step ID and
`new StepResponse(true)`. A synchronous Boolean callback or local timer is not
this protocol. Characterize summary/result visibility and the exact wait/start/
deadline instant through the executing native runner before choosing the facade.

After the wait, the composer registers `notifyOnFailureStep` with
`to: ""`, `channel: "feed"`, `template: "admin-ui"`, and native failure title/
description including the filename. The step returns an undefined forward value
and stores its input as compensation data. Its compensator calls genuine
`createNotifications(data)`. Normalization or confirmation failure precedes
that registration; do not invent a failure notification for those phases.

The composer invokes `batchProductsWorkflow.runAsStep({ input: batchRequest })`
with `.config({ async: true, backgroundExecution: true })`, sends the genuine
success feed Notification, then declares its summary response. The success step
calls `createNotifications`, returns native DTOs and their IDs as compensation
data, and declares no compensator because delivery is generally irreversible.
Keep the native business sequence and source provenance intact.

## Native Child Compensation And Grouped Events

Inspect the actual orchestration owners as part of this closure:

- `third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/create-workflow.ts`
- `third_party/medusa/upstream/packages/core/workflows-sdk/src/helper/workflow-export.ts`
- `third_party/medusa/upstream/packages/modules/workflow-engine-redis/src/services/workflows-module.ts`
- `third_party/medusa/upstream/packages/modules/workflow-engine-redis/src/services/workflow-orchestrator.ts`
- `third_party/medusa/upstream/packages/core/orchestration/src/transaction/transaction-orchestrator.ts`

Native `runAsStep` constructs a child transaction identity through
`buildTransactionId`, passes the parent step idempotency key and
`preventReleaseEvents: true`, and registers a compensator that cancels that
child through the Workflow Engine or native workflow runner. A failure after a
successful batch, including success-Notification failure, therefore attempts
child cancellation. That callback does not establish successful business undo.
The executing default child behavior is described below; do not replace it with
arbitrary inverse commands chosen by an adapter.

When native checkpointing is enabled, Redis workflow storage retains finished child executions that have
`parentStepIdempotencyKey`, even without an explicit retention time. Its cancelling
load admits DONE executions; native cancellation can transition them to
WAITING_TO_COMPENSATE. This differs from the basic in-memory storage, which
deletes finished checkpoints and cannot establish retained-child cancellation.
Executing characterization must use the real durable storage or an explicitly
labeled native storage-protocol fixture retaining those checkpoints. Such a
fixture can prove orchestrator behavior, not Redis transport or retention
conformance. Native `saveCheckpoint` can skip storage when the child's effective
`store` option is false; retention policy alone therefore proves no checkpoint
exists for this batch. Characterization must record actual child options and
checkpoint writes through the native module wrapper. Actual child business
compensation still needs execution evidence.

The native workflow-export finish handler releases grouped events on successful
completion, clears them for FAILED/REVERTED state, and cancels the flow if release
fails. Nested work with `preventReleaseEvents` does not attach that release
handler. Prove the actual import/child event-group identity and release behavior,
including Notification events, against executing native orchestration.

Existing atomic child compensation is explicitly `transactionCovered`: rollback
inside that child requires no inverse business writes. It supplies no durable
cross-commit compensation journal. The default native batch does not checkpoint,
so the observed later cancellation fails rather than executing business inverses.
Do not add a compensation journal or force child persistence to repair that
native outcome implicitly. A later checkpointed child profile would need its own
executing contract and explicit admission.

PostgreSQL remains authority for each committed child and all immutable history
and facts. A parent publication group owns only event-delivery eligibility; it
cannot revoke a commit, erase history or become a second rollback authority.
Any required post-commit business compensation is a new authenticated operation
through its genuine owner, with its own settlement and durable outcome.

## Executing Native Contract And Limits

The genuine `WorkflowsModuleService.run/setStepSuccess/cancel`,
`WorkflowOrchestratorService`, compiled SDK, import composer and step bodies
execute through an explicit native abstract-storage protocol fixture. It retains
any published finished checkpoint and records native timeout requests. Business,
Notification and event-bus ports record calls; they do not prove database undo,
provider delivery, queued module events or Redis behavior.

| Selected native path | Executed behavior |
| --- | --- |
| Empty successful import | The summary is visible while confirmation remains awaiting. Native schedules 3600 seconds; explicit confirmation starts the background child, then success Notification and parent group release. No elapsed-hour timeout is proven. |
| Registered execution options | Parent has `store: true` and async/timeout flags. The all-synchronous batch child has `store` absent, not an explicit false value. Native wrappers and registration do not force child persistence. |
| Success Notification fails after an empty or nonempty batch | Child reports DONE without errors but publishes no checkpoint. Native child `run` can then reject with the parent's Notification failure while awaiting `triggerParentStep`. Parent attempts cancellation of the derived child ID, receives native `not_found`, ends FAILED and clears the group. Failure Notification compensation is attempted; no delete/dismiss business inverse is called. |
| Invalid CSV column | Native `invalid_data` precedes confirmation/compensation registration. Parent is REVERTED, no commerce or Notification is called, and the group is cleared. |
| Group release fails | The bounded native process fails with an unhandled `Unknown error` through `workflow-export.ts` finish/cancel handling. Recovery is unproven; neither successful release nor successful cancellation may be inferred. |

These observations distinguish child business completion from resolution of its
parent-triggering invocation. Preserve that distinction during uncertain-result
recovery. They do not prove nonempty native database state or real module-event
group contents. A separate exploratory composer-entry attempt failed a harness
observation and establishes no additional native contract.

## Current APIs And Missing Contracts

| Existing owner and exact API | Reusable behavior | Missing connected contract |
| --- | --- | --- |
| `packages/medusa-workflows-sdk/src/definition.ts`: `createStep`, `createWorkflow`, `runAsStep`; `src/runtime.ts`: `executeWorkflow` | Authentic definitions, finite child frames, conditions and queued sibling execution through caller-owned ports. | Step options admit only `name` and `compensation: "transactionCovered"`; `.config` admits name only. Native async/timeout/background and irreversible compensation remain refused. Add a separate explicit execution profile rather than loosening atomic definitions. |
| `packages/medusa-adapter/src/workflow/host.ts`: `prepareWorkflowComposition`, `prepareAtomicWorkflowHost`; `src/workflow/runtime.ts`: `runNativeMedusaWorkflow` | Checked resources, authentic module methods and bounded fresh callback lifetimes for one atomic root. | All callbacks borrow `AtomicCommerceContext`. No continuation, confirmed resume or provider boundary exists here; do not hold this context across them. |
| `packages/medusa-adapter/src/workflows/product/batch.ts`: `prepareProductBatchWorkflow` | Genuine bounded Product batch and native Product/Pricing/Inventory/Link children. | A fenced durable caller must invoke one prepared child with a retained stable request key and recover its exact outcome; it cannot regenerate a key on resume. Cross-commit compensation and delayed event eligibility need their actual owners. |
| `packages/persistence-postgres/src/frameworks/atomicCommerce/commands.ts`: `AtomicCommerceHost.run(requestKey, command, args)` and `close`; `host.ts`: `makeAtomicCommerceHost` | Single child settlement, exact request equivalence, retained committed outcome, fresh authority and uncertain-result recovery. | Task/continuation execution fencing is not implied by possession of a command token. Add authenticated subject-to-child binding at the appropriate execution owner; no raw transaction capability crosses out. |
| `packages/durable-task/src/runAttempt/Services/RunAttemptLifecycle.ts`: `startAttempt`, `heartbeatAttempt`, `completeAttempt`, `requestCancellation`, `handleLeaseExpiry`, `inspectCurrentAttempt` | Existing Task state, versions, fences, lease/cancellation and terminal meaning. | Current aggregates are ready, attempt_granted, executing, retry_waiting and terminal; none is a durable confirmation wait. Do not relabel retry delay or keep an executing lease alive for an hour. |
| `packages/durable-task/src/scheduling/TaskWakeScheduler.ts`: `makeTaskWakeSchedulerV1(...).run(request)` | Scope-bound bounded due discovery, cursor correlation and existing candidate handling. | A confirmed/expired import continuation has no admitted candidate kind or lifecycle correlation yet. Queue hints may wake work, but PostgreSQL owns eligibility and the winning transition. |
| `packages/standard-application-invocation/src/ApplicationTaskSystem.ts`: `createApplicationTaskRun` / `ApplicationTaskSystemApi.createRun` | Current Application task selection, immutable runtime/principal binding and scoped run creation. | It selects Application tasks, not Medusa workflow definitions. Do not fabricate an Application function/runtime binding to host commerce. |
| `packages/durable-task/src/runCreation/TrustedWorkflowBinding.ts`: `prepareTrustedWorkflowTaskBinding`; persistence `tasks/trustedWorkflowTaskRunCreation.ts`: `makeTrustedWorkflowTaskRunCreationStore`; `taskSystemRunAttemptStoreV1.ts`: `makeTrustedWorkflowTaskSystemRunAttemptStore` | Implemented private trusted workflow binding, exact scoped creation/replay and existing lifecycle decisions under a separate definition reference. | Compute/due-discovery admission, authenticated execution-subject issuance, continuation waits and commerce effects remain absent. The future issuer must check canonical persisted binding/policy/principal as well as the current attempt and lease. |
| `packages/standard-application-invocation/src/ApplicationTaskMutationAuthority.ts`: external-effect session `prepare`, `declareDispatch`, `confirm`, `reconcile`, `close`; persistence `tasks/taskExternalEffectAuthority.ts`: corresponding child-mutation operations | Existing ordinal, stable request identity, fenced subject and uncertain dispatch evidence are concrete reuse references. | Inputs/subjects bind Application task launches and `TransactionFunctionPathV1`. They grant no arbitrary commerce/provider authority. Correct the real owner for a named additional subject/operation rather than laundering Medusa through a fake function path. |
| `roadmaps/durable-task-engine/preflight/55-dte07-clean-task-await-contract.md`: `awaitTask` | Bounded scope-authorized status observation and one final result read. | Caller-side polling is not durable suspension, authenticated confirmation or a wake mechanism. |
| `packages/persistence-postgres/src/commit/events/` and workflow-foundations topic07 | Existing immutable event intents, commit correlation, claims and durable subscriber outcomes. | Groups spanning multiple committed steps remain deferred. Immediate child event eligibility does not implement parent release/clear. Extend the actual eligibility owner without a competing event feed/outbox or mutable committed facts. |

[Workflow foundations 02](../../workflow-foundations/02-durable-operations-and-recovery.md),
[03](../../workflow-foundations/03-continuations-waits-and-signals.md),
[04](../../workflow-foundations/04-cancellation-and-compensation.md) and
[05](../../workflow-foundations/05-task-command-integration.md) retain pending
general preflights. This concrete consumer should resolve only the contracts
it needs. It does not select a universal engine, public signal API or new
package. Native execution remains framework-neutral; Medusa owns this import's
normalization, step sequencing, notification content and business compensation.

## Genuine Notification Closure

The pinned native module owner is
`packages/modules/notification/src/services/notification-module-service.ts`,
with `services/notification-provider.ts` and models `notification.ts` and
`notification-provider.ts`. Those paths are under
`third_party/medusa/upstream/`. Their DML, native module construction, provider
metadata, repository reads/writes, event families and exact scalar/array DTO
contracts need an explicit connected admission. The native source closure and
its preparation/delivery/finalization extraction are available privately;
Product's subscriber and an arbitrary supplied callback grant no admission.

Native `createNotifications` first reserves/creates rows and resolves configured
enabled providers in a repository transaction, then sends through the provider,
and finally updates success/failure and optional external identity. Existing
idempotency keys filter already-sent entries and retry failed entries; the
already-sent array result is empty. The native failed-key branch generates a
fresh ID while suppressing creation of an existing keyed row, so its final
update may target a missing ID. The narrow import profile refuses keys; these
particular native workflow messages supply none. Do not inject an extra key into the
native workflow input or replace calls with synthetic events to hide restart
duplication. Determine stable occurrence/result recovery and the native owner
seam needed to retain those genuine calls across uncertainty.

Use the genuine local provider at
`packages/modules/providers/notification-local/src/services/local.ts` under the
pinned source root. `packages/core/utils/src/common/define-config.ts` configures
it for `feed`. Its `send` logs and returns `{}`; it does not send email or grant
general external providers. Construct a named enabled local-feed configuration
and preserve native service/provider outcomes. Even this local side effect is
not transactional rollback or proof of exactly-once provider execution. Actual
provider execution must run outside an open borrowed commerce transaction;
Notification's preparation, send and final persistence keep their own lifecycle.

The provider's native `channels` field remains DML `array` with default `[]`.
Shared checked lowering represents it as JSONB with the generic relational
`emptyJsonArray` default. The default has no arbitrary JSON payload, requires a
JSONB column and has its own physical capability identity. Logical creates
materialize a fresh empty array; explicit values and updates retain their usual
meaning. Other array defaults remain refused. This extension rewrites no
existing artifact, retained row or installation. The local-feed boundary checks
the native array shape and string entries separately from JSONB storage.

## Proposed Finite Boundary

Begin with one inline CSV, one filename, one confirmation occurrence and one
native Product batch, with at most four total normalized create/update Products
and the existing batch's four total incoming Variants. Retain its independent
request-initial Variant and nested graph limits. CSV normalization produces no
delete branch. Do not silently drop normalized fields or records outside that
existing admitted child contract.

For planning, propose at most 256 KiB UTF-8 CSV, sixty-four parsed records and
256 UTF-8 filename bytes. These are unimplemented admission candidates, not
measured safe maxima or new parser semantics. Bound raw input before parsing,
then complete normalized output before persistence/confirmation. Preserve
quoted fields/newlines and all native row numbering/grouping. Confirm exact
parser behavior and output encoding before finalizing these bounds.

Retained state must bind workflow/code and validator revisions, scope and
principal, installation/profile identities, exact normalized plan and summary,
confirmation occurrence/deadline, child operation identity and terminal outcome,
plus necessary compensation and event eligibility evidence. Use the actual
durable owners' codecs and authority; this is an obligation inventory, not a
selected new schema. Retention/expiry may not cause uncertain child work to be
treated as fresh. Any later durable schema changes need forward migration and
explicit existing-data disposition; this record authorizes no reset.

## Connected Implementation Plan

1. Characterize executing native inline import and orchestration. Preserve
   composer/step source bodies and record actual normalization, summary/start
   result visibility, confirmation identity/deadline, asynchronous child result,
   post-child failure/cancellation and parent event-group behavior. Native ORM,
   orchestration, provider and Flarex adapter witnesses are distinct evidence.
2. Resolve the narrow durable owner contracts below. Implement and prove a
   framework-neutral confirmation-to-one-child fixture first, reusing existing
   Task/fence/scheduling/publication machinery where it actually fits. No
   long-lived connection, process-local deferred or retry loop owns the wait.
3. Admit the native local-feed Notification closure with checked logical schema,
   provider construction and real service phases. Resolve occurrence replay,
   unknown provider outcome and compensation retry separately from Product
   settlement. Preserve failures, including failure while reporting failure.
4. Extend the SDK/runner at its explicit durable execution profile and bind
   authentic resumed capabilities. Connect the genuine inline composer to one
   prepared existing Product batch, preserve the observed cancellation/failure
   dispositions and event eligibility, and refuse unsupported options/profiles at construction.
   Existing atomic callers must retain their exact supported contracts.
5. Run the connected matrix, required reviews and source/provenance/browser/
   configured lint gates, then commit a complete scoped capability. Any smaller
   owner milestone retains incomplete import status. Update adoption only at
   the actual capability boundary, without copying chronological receipts here.

## Concrete Decisions Still Required

- Which existing durable Task/operation owner stores this bounded continuation,
  and whether a correlated workflow continuation record or narrowly extended
  lifecycle is necessary. Specify authoritative transitions before schema/API
  names; do not invent an independent Medusa job engine.
- The exact authorized confirmation subject, early/duplicate/late response,
  expiry/cancellation precedence and native one-hour deadline origin. Decide
  waiting-time versus attempt-time accounting and fresh resume authority.
- Stable child occurrence identity across new attempts, exact plan/revision/
  installation binding, fencing at dispatch and outcome recovery after either
  business commit or continuation-checkpoint loss. Expired/unavailable evidence
  must not authorize redispatch as new work.
- Durable representation of a completed child whose parent-triggering invocation
  rejects, subsequent native cancellation-not-found and failed compensation.
  Preserve the default uncheckpointed-child contract; other retained-child
  profiles or business undo need separate evidence and a named decision.
- Parent-controlled cross-commit event release/clear, including compensation
  events and failed release. Extend existing committed-intent eligibility;
  preserve one PostgreSQL publication authority and ordinary atomic event use.
- Notification occurrence identity and prepared-row/provider/result recovery
  without adding fields to the native message or promising exactly-once logs.
  Select a correct native service seam and narrow local-feed admission.
- Bounded plan/result retention and cleanup, exact summary facade contract, and
  refusal/error classification at each phase. These decisions remain work within
  the authorized goal; this record does not imply another user approval gate.

## Validation And Exclusions

Use deterministic pure clocks/state fixtures for confirmation and lifecycle
semantics, then separate PGlite and ordinary-role PostgreSQL tests for durable
rows, locks, fencing, races, replay and uncertain settlement. Prove no retained
SQL transaction/connection during confirmation, scheduling, provider work or
background execution. Include restart with freshly constructed hosts and
authority, early/duplicate/late confirmation, timeout/confirm/cancel races,
competing resumes, stale execution, revision/profile/principal conflicts,
over-bound complete input/output, native malformed CSV and validator failures.

Inject loss after plan commit, confirmation commit, child dispatch declaration,
business commit, outcome checkpoint, provider send/final update, event release
and compensation progress. Preserve exact known/unknown disposition; successful
provider invocation is not durable workflow success. Test failure while sending
the failure Notification and after a successfully committed child. Assert native
event eligibility and compensation outcomes, plus unchanged atomic batch and
standalone Notification behavior within their own admitted profiles.

Finish affected typechecks/builds, retained native normalization assertions,
source/promotion/browser and configured lint guards; both project reviewers
receive exact owned paths/checkpoint/contracts and both database results before
the scoped commit. No hosted support, general providers, arbitrary Task/API
exposure, arbitrary workflow graphs, File/Region integration or destructive data
migration is admitted here.

Chunked import additionally needs native
`product/steps/normalize-products-to-chunks.ts` and
`product/steps/process-import-chunks.ts`: File download streams, csv-parse,
Product-preserving chunk boundaries, JSON chunk uploads, independent sequential
batches and unconditional cleanup. Export additionally needs
`product/steps/export-products.ts` and `product/helpers/normalize-for-export.ts`:
Region reads, complete paged graph fields, File upload/backpressure/completion,
download-URL hydration and cleanup compensation. Keep those later admissions
separate rather than assuming inline import proves them.
