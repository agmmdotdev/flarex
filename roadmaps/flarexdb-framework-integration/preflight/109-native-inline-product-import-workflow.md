# Native Inline Product Import Workflow

## Status And Authority

Status: **IMPLEMENTED AND VALIDATED** for the bounded private inline import
profile. Its implementation connects the genuine native composer and interpreter, Task
continuation/checkpoint authority, one finite Product batch, native local-feed
Notification phases and parent-controlled event eligibility. Connected PGlite
and ordinary-role PostgreSQL validation covers its admitted behavior. This does
not establish hosted or arbitrary workflow compatibility.

Shared private owners provide authentic ordinary/control execution subjects,
lease-free continuation waits, checkpoint CAS, finite commerce children,
callback outcome evidence and bounded event gates. They retain their neutral
contracts. Medusa owns the native graph, checkpoint codec, confirmation bridge,
Notification content and compensation interpretation.

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

## Connected Inline Admission

The profile executes native `importProductsWorkflow` with inline CSV text and filename.
Chunked File import and Product export are explicitly deferred and are not next
integration work. The next selected slice is
[native Sales Channel creation](./110-native-sales-channel-creation-workflow.md).
The selected inline workflow avoids File, Region and Node
stream dependencies. Its connected closure is still broader than CSV parsing:
native normalization and summary, durable confirmation with a one-hour timeout,
one background native Product batch, genuine success Notification and genuine
failure compensation, including the child-cancellation and event-group behavior.

The selected profile is host-neutral and scope-bound. It runs the native
confirmation protocol rather than an always-confirmed convenience command.
An isolated parser, continuation or batch invocation remains insufficient to
establish the complete connected outcome.

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
this protocol. The selected facade reads summary/result through the native return
closure and retains the native wait start/deadline in its Task continuation.

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
execute through the separate durable SDK profile. The native characterization
below establishes framework behavior using its abstract-storage protocol. The
connected implementation replaces its business, Notification and event-bus test
ports with the selected real owners; Redis transport and retention remain outside
the profile.

| Selected native path | Executed behavior |
| --- | --- |
| Empty successful import | The summary is visible while confirmation remains awaiting. Native requests 3600 seconds; explicit confirmation starts the background child, then success Notification and parent group release. The durable wait retains no live worker for that interval. |
| Confirmation versus timeout processing | Confirmation at the deadline, one millisecond later, and one hour later succeeds while the stored step remains waiting. A timeout callback at exactly the deadline does not expire it; a callback one millisecond after the deadline first reverts it and subsequent confirmation is refused. Timeout eligibility is strictly `now > startedAt + timeout`; confirmation does not independently enforce that clock predicate. Durable resolution must preserve the first accepted native decision. |
| Registered execution options | Parent has `store: true` and async/timeout flags. The all-synchronous batch child has `store` absent, not an explicit false value. Native wrappers and registration do not force child persistence. |
| Success Notification fails after an empty or nonempty batch | Child reports DONE without errors but publishes no checkpoint. Native child `run` can then reject with the parent's Notification failure while awaiting `triggerParentStep`. Parent attempts cancellation of the derived child ID, receives native `not_found`, ends FAILED and clears the group. Failure Notification compensation is attempted; no delete/dismiss business inverse is called. |
| Invalid CSV column | Native `invalid_data` precedes confirmation/compensation registration. Parent is REVERTED, no commerce or Notification is called, and the group is cleared. |
| Group release fails | Native finish handling attempts cancellation when release rejects. The selected bridge preserves the original core failure and replays genuine finish policy from a cold terminal checkpoint; release failure alone establishes neither successful release nor successful cancellation. |

These observations distinguish child business completion from resolution of its
parent-triggering invocation. The selected recovery contract preserves that
distinction. A native characterization port alone does not prove nonempty
database state, actual provider execution or committed module-event contents.
Cold terminal recovery now invokes the genuine native finish policy before
accepting Task completion; connected verification of that bridge remains a
completion gate.

## Private Owners And Remaining Boundaries

| Owner and exact API | Selected responsibility | Remaining boundary |
| --- | --- | --- |
| `packages/medusa-workflows-sdk/src/definition.ts` and separate `src/durable/` exports | Existing finite atomic definitions keep their restrictions; the durable export runs genuine native orchestration and async/background step behavior. | The separate export does not admit arbitrary graphs, options, providers or hosts. |
| `packages/medusa-adapter/src/workflow/host.ts`: `prepareWorkflowComposition`, `prepareAtomicWorkflowHost`; `src/workflow/runtime.ts`: `runNativeMedusaWorkflow` | Checked resources, authentic module methods and bounded fresh callback lifetimes for one atomic root. | All callbacks borrow `AtomicCommerceContext`. No continuation, confirmed resume or provider boundary exists here; do not hold this context across them. |
| `packages/medusa-adapter/src/workflows/product/batch.ts`: `prepareProductBatchTaskWorkflow` | Genuine finite Product batch through Task occurrence 1 and the existing commerce outcome owner. | The default native child remains uncheckpointed; later cancellation is not business undo. |
| `packages/persistence-postgres/src/frameworks/atomicCommerce/commands.ts`: `AtomicCommerceHost.run` and private `TaskAtomicCommerceHost.runTaskChild`; `host.ts`: `makeAtomicCommerceHost` | Single settlement, exact replay and uncertain recovery; Task child entry and final lease checks under an explicitly admitted authentic binding and scope-exclusive profile. | The native interpreter must bind its exact plan to this finite child. No Product import or continuation follows from the neutral command proof. |
| `packages/durable-task/src/runAttempt/WorkflowContinuation.ts` and `Layers/RunAttemptLifecycleLive.ts` | The private trusted generation adds `continuation_waiting`/`continuation_ready`, retained resolution receipts and fresh grants through the existing Task decisions. | No executing lease, transaction or worker spans the wait. Application and retained legacy codecs remain unchanged. |
| `packages/persistence-postgres/src/tasks/trustedWorkflowContinuationStore.ts`: `register`, `inspect`, `confirm`, `expire`, `cancel` | Authenticated binding/principal facade over the existing run and requested-effect ledger; registration atomically anchors checkpoint CAS and retires the lease. | Explicit bounded `advance` drives this profile. An autonomous scheduler, public signal transport and hosted routing are not admitted. |
| `packages/persistence-postgres/src/tasks/trustedWorkflowCheckpoint.ts`: `prepare`, `load`, `save` | Opaque, copied, digest-checked framework bytes with scoped binding/run identity, live interpreter checks and revision CAS. | Medusa validates its native checkpoint topology and codec; Task does not interpret the business graph. |
| `packages/standard-application-invocation/src/ApplicationTaskSystem.ts`: `createApplicationTaskRun` / `ApplicationTaskSystemApi.createRun` | Current Application task selection, immutable runtime/principal binding and scoped run creation. | It selects Application tasks, not Medusa workflow definitions. Do not fabricate an Application function/runtime binding to host commerce. |
| `packages/durable-task/src/runCreation/TrustedWorkflowBinding.ts`; persistence `tasks/trustedWorkflowTaskRunCreation.ts`, `taskSystemRunAttemptStoreV1.ts` and `trustedWorkflowExecutionSubject.ts` | Exact scoped creation/replay and genuine ordinary/control subjects checking canonical binding/policy/principal, current attempt, fence, cancellation and database lease. | Ordinary inspection is not a live permission. Control issuance grants only separately admitted cleanup, never Product forward work. |
| `packages/standard-application-invocation/src/ApplicationTaskMutationAuthority.ts`: external-effect session `prepare`, `declareDispatch`, `confirm`, `reconcile`, `close`; persistence `tasks/taskExternalEffectAuthority.ts`: corresponding child-mutation operations | Existing ordinal, stable request identity, fenced subject and uncertain dispatch evidence are concrete reuse references. | Inputs/subjects bind Application task launches and `TransactionFunctionPathV1`. They grant no arbitrary commerce/provider authority. Correct the real owner for a named additional subject/operation rather than laundering Medusa through a fake function path. |
| `roadmaps/durable-task-engine/preflight/55-dte07-clean-task-await-contract.md`: `awaitTask` | Bounded scope-authorized status observation and one final result read. | Caller-side polling is not durable suspension, authenticated confirmation or a wake mechanism. |
| `packages/persistence-postgres/src/tasks/trustedWorkflowCallback.ts`: `makeTrustedWorkflowCallbackJournal(...).run` | Constructor-bound callback identity/policy, ordinal input and tagged known-outcome replay in the existing external-effect ledger. | Dispatching/uncertain evidence never authorizes redelivery. Arbitrary callback lifetime is not bounded by SQL or a timeout wrapper. |
| `packages/persistence-postgres/src/tasks/trustedWorkflowEventEligibilityStore.ts`: `open`, `inspect`, `decide` | Stable run/role/occurrence groups under genuine live interpreter authority; existing publication and subscriber owners enforce the conjunction. | Native group strings alone confer no authority; release/clear affects delivery, not committed business state. |

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
contracts are selected by the private local-feed profile. The real native
service retains scalar/array/empty normalization, serialization and outer
`EmitEvents`. Its preparation/delivery/finalization seam contains no manager or
settlement capability; Product's subscriber grants no Notification authority.

Native `createNotifications` first reserves/creates rows and resolves configured
enabled providers in a repository transaction, then sends through the provider,
and finally updates success/failure and optional external identity. Existing
idempotency keys filter already-sent entries and retry failed entries; the
already-sent array result is empty. The native failed-key branch generates a
fresh ID while suppressing creation of an existing keyed row, so its final
update may target a missing ID. The narrow import profile refuses keys; these
particular native workflow messages supply none. Do not inject an extra key into the
native workflow input or replace calls with synthetic events to hide restart
duplication. Stable Task phase occurrences and the callback journal retain exact
prepared rows and known results across attempts without changing those messages.

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

## Selected Private Profile

`prepareProductInlineImportInput` captures exactly `{ fileContent, filename }`
and returns its canonical bytes and Task input reference. The existing outer
Task body owner publishes and reloads those exact bytes, including the filename;
the adapter adds no second input store. Every `start`/`advance` verifies the
complete supplied body against the run's immutable input reference before native
normalization or child work. A changed filename is an input conflict even when
the CSV is unchanged.

The profile admits at most 256 KiB UTF-8 CSV, sixty-four parsed records and
256 UTF-8 filename bytes. Genuine native normalization must produce at most
four total create/update Products and four incoming Variants. The existing
batch's independent request-initial Variant and nested graph limits still
apply. CSV normalization produces no delete branch. A complete normalized plan
outside that child contract is refused before confirmation or business writes;
fields and records are not dropped to fit. Native checkpoint bytes are limited
to 1 MiB. These are private admission limits, not scale or parser-performance
claims.

`makeProductInlineImportTask` exposes explicit bounded `start`, `inspect`,
`confirm`, `cancel` and `advance`. Construction requires the exact authenticated
workflow profile/policy, at least three allowed attempts, and at least 120 seconds
each for the lease and maximum active-attempt duration. Waiting consumes no
executing lease; fresh advancement uses the existing Task start/heartbeat
decisions and a new authentic subject. A live competing attempt is never adopted.
Lease loss follows the existing Task policy and a later explicit advance.

### Continuation And Native Checkpoint

The framework checkpoint uses `medusa.native-checkpoint.json.v1`. Medusa decodes
the real native checkpoint and verifies workflow ID, Task-run transaction ID,
exact input and genuine builder topology. Task stores opaque copied bytes with
binding/run identity, codec, revision, length and digest. It does not reconstruct
the native business graph or translate a timeout into a new engine state.

Registration commits checkpoint CAS and `continuation_waiting` through the
existing Task run/requested-effect owner, preserving the suspended attempt and
acceptance anchor while retiring its lease wake. The stored deadline is the
native wait's original `startedAt + 3600 seconds`. A cold host can recover the
waiting checkpoint before registration without restarting the native timer.
Inspection correlates the continuation descriptor with the actual stored bytes;
a missing or contradictory checkpoint fails closed.

Confirmation and timeout resolution retain the first accepted receipt.
Confirmation may win after the deadline while timeout has not been processed;
timeout is eligible only when database time is strictly greater than the native
deadline. Resolution enters `continuation_ready`, not an hour-long executing
attempt. A fresh grant resumes the native `setStepSuccess(new StepResponse(true))`
protocol. If that native success was already checkpointed before a crash, recovery
calls the actual native `run` instead of acknowledging the step twice.

### Pending Cancellation And Control

Cancellation is an authenticated Task transition. Ordinary authority is revoked
before continuing with a genuine control subject; timeout also selects control
mode. Issuance still checks canonical binding, bound policy, principal, current
attempt/fence, cancellation or control state and the live database-clock lease.
It does not manufacture ordinary Product authority from a cancellation flag.

Native cancellation of an unanswered asynchronous confirmation may remain
`WAITING_TO_COMPENSATE`. The adapter does not inject a fake step-failure response
to make that state look finished. The current control attempt completes as
failed with `override_delay` until the original deadline plus one millisecond.
The existing lifecycle retains `continuation_ready` with
`continuation.controlRetry`; an explicit later advance obtains a fresh control
grant and runs the genuine native timeout path. Exhausted attempts remain an honest Task failure with
unresolved-control meaning, not successful cancellation. A native REVERTED
result may acknowledge the actual cancellation generation; FAILED cleanup does
not.

### Finite Product Child And Recovery

Commerce occurrence 1 invokes the prepared native Product batch through the
actual native asynchronous child wrapper. The immutable command input, host
policy, installations, binding and parent eligibility are retained by the
existing commerce receipt. Stable identity is scope/run/occurrence, independent
of attempt and fence. Missing, conflicting or expired evidence cannot produce a
new request key or a fresh business operation.

If a cold parent checkpoint still waits for that child, the bridge asks the
genuine native `retryStep`/`run` path to derive its next child transaction ID,
including the native `-attempt-N` suffix. Native attempt counts are bounded by
the fresh Task attempt and bound retry policy. That different native child ID
still reuses commerce occurrence 1 and its exact committed receipt. The default
batch remains uncheckpointed; the bridge does not retain it merely to make
later cancellation succeed.

Cold DONE/FAILED/REVERTED parent checkpoints replay the genuine native finish
policy, including parent event release or clearing, before Task completion.
The original Effect Cause remains sticky across native Promise handling,
background work and finalization. All owned native work is drained before the
bridge closes; an unknown core result cannot be swallowed by a native helper
and followed by successful Task settlement.

The finite child's native callback boundary records mapped rejections with the
existing transaction refusal owner before exposing them to fail-fast parallel
execution. Sibling cancellation still stops and joins queued DAL runners;
it cannot replace the initiating callback failure. The full outcome retains
the transaction owner's additional rollback-only cleanup evidence.

### Notification And Delivery Eligibility

The native messages remain unchanged and contain no supplied idempotency key.
Their exact success/failure payloads, including filename, select fixed trusted
roles. Genuine Notification preparation and finalization each use one finite
commerce child; the real local provider runs between those settled transactions.

| Native role | Preparation occurrence | Finalization occurrence | Callback occurrence | Role gate |
| --- | --- | --- | --- | --- |
| Success `send-notifications` invoke | 2 | 3 | 1 | notification 1 |
| Failure `notify-on-failure` compensate | 4 | 5 | 2 | notification 2 |

Callback ordinals belong to their own ledger kind. The constructor binds real
callback identity/revision, input/outcome codec revisions, finite callback budget
and whether control is allowed. Expected provider errors are framework-owned
tagged failure data; arbitrary Effect failure, defect and interruption retain
their full Cause. Confirmed known outcomes replay without another send.
Dispatching/uncertain evidence is explicitly unknown and never redispatched as
fresh. A late or revoked callback cannot write a known result. SQL deadlines do
not bound an arbitrary hanging foreign callback, and the local log is not an
exactly-once effect.

Product intents require the parent gate. Notification intents require both the
parent and their role gate; the parent permits five enrolled child commits, each
role two. The real native outer `EmitEvents` must match the exact original
preparation/finalization messages before releasing that role gate. It does not
write duplicate event intents. Native parent finish release/clear uses genuine
Task-bound eligibility authority, not the descriptive native group string.
Clearing changes delivery eligibility only; committed rows, facts and history
remain PostgreSQL authority.

Only the two Notification phase commands are allowlisted for `runControlChild`;
the Product command and success role remain forbidden. Ordinary and control
execution use the same logical cleanup receipt identity, so a fresh control
attempt can replay existing authorized cleanup rather than repeat it. Each use
still rechecks the current issuer permission, live lease and exact request.

A known success-provider error can leave the Product batch committed, finalize
the native failure status, attempt the failure Notification, receive native
`NOT_FOUND` when cancelling the uncheckpointed child, and end with parent FAILED.
The native event decision clears the parent gate. This is neither Product undo
nor successful cancellation. Failure while reporting failure retains its real
native/core disposition.

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

## Deferred Product Import And Export Variants

Chunked File import and Product export are outside the current integration goal.
Their dependencies below remain an exclusion inventory, not a prerequisite or
an ordered follow-up to inline import.

Chunked import additionally needs native
`product/steps/normalize-products-to-chunks.ts` and
`product/steps/process-import-chunks.ts`: File download streams, csv-parse,
Product-preserving chunk boundaries, JSON chunk uploads, independent sequential
batches and unconditional cleanup. Export additionally needs
`product/steps/export-products.ts` and `product/helpers/normalize-for-export.ts`:
Region reads, complete paged graph fields, File upload/backpressure/completion,
download-URL hydration and cleanup compensation. Keep those later admissions
separate rather than assuming inline import proves them.
