import { Clock, Effect, Exit, Result, Schema } from "effect";
import { DistributedTransaction, TransactionState } from "@medusajs/orchestration/transaction";
import { TransactionStepState, TransactionStepStatus } from "@medusajs/utils/orchestration/types";
import type { WorkflowContainer } from "@medusajs/orchestration/runtime";
import { StepResponse } from "@medusajs/workflows-sdk/durable";
import { WorkflowOrchestratorService, WorkflowsModuleService } from "@medusajs/workflows-sdk/durable/engine";
import { importProductsWorkflow, importProductsWorkflowId } from "@medusajs/core-flows/durable/product/import-products";
import { productImportAtomicBatchService } from "@medusajs/core-flows/durable/product/batch-products";
import { productImportPlanAdmissionService } from "@medusajs/core-flows/durable/product/normalize-products-step";
import { waitConfirmationProductImportStepId } from "@medusajs/core-flows/durable/product/wait-confirmation-product-import-step";
import type { TrustedWorkflowContinuation } from "@flarex/durable-task/internal/run-attempt-v1";
import { makeTrustedWorkflowCheckpointStore } from "@flarex/persistence-postgres/internal/trusted-workflow-checkpoint";
import { inspectTrustedWorkflowInterpreterSubject, type TrustedWorkflowInterpreterSubject, type TrustedWorkflowExecutionSubject } from "@flarex/persistence-postgres/internal/trusted-workflow-execution-subject";
import { prepareCommitEventEligibility } from "@flarex/persistence-postgres/internal/commit-event-eligibility";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import type { prepareProductBatchTaskWorkflow } from "./batch";
import type { prepareDurableNotification } from "../../workflow/durable-notification";
import { decodeDurableNativeCheckpoint, makeDurableNativeStorage, nativeCheckpointCodec, type DurableNativeEffectBoundary } from "../../workflow/durable-native-storage";
import { captureCommerceInput } from "../../value/input";
import { ProductInlineImportSummary, productInlineImportPolicy, productInlineImportProfile, type ProductInlineImportInput } from "./import-inline-input";

type Batch = Effect.Success<ReturnType<typeof prepareProductBatchTaskWorkflow>>;
type Notifications = Effect.Success<ReturnType<typeof prepareDurableNotification>>;
const decodeSummary = Schema.decodeUnknownEffect(ProductInlineImportSummary, { onExcessProperty: "error" });
const atomicBatchStepId = "batch-products-as-step";

/** The native Promise API alone uses this generic resolver. Its values are
 * fixed trusted services built below; no caller-provided lookup is accepted. */
function nativeContainer(values: ReadonlyMap<string, unknown>): WorkflowContainer {
  return { resolve<Value>(name: string, options?: { allowUnregistered?: boolean }): Value {
    if (!values.has(name) && !options?.allowUnregistered) throw commerceError("unsupportedProfile");
    // SAFETY: the native framework's generic resolver boundary cannot express
    // the key→service correlation. This fixed private graph supplies each key.
    return values.get(name) as Value;
  } };
}

/** This interpreter owns native execution only. The outer Task manager creates
 * grants, verifies original input, registers the wait and accepts completion. */
export const makeProductInlineImportInterpreter = Effect.fn("ProductImport.makeInterpreter")(function* <HashFailure>(config: {
  readonly checkpointStore: ReturnType<typeof makeTrustedWorkflowCheckpointStore<HashFailure>>;
  readonly batch: Batch;
  readonly notifications: Notifications;
  readonly runEffect: DurableNativeEffectBoundary;
}) {
  const readSummary = Effect.fn("ProductImport.readSummary")(function* (input: {
    readonly input: ProductInlineImportInput;
    readonly runId: string;
    readonly checkpoint: Readonly<{ codec: string; bytes: Uint8Array }>;
  }) {
    if (input.checkpoint.codec !== nativeCheckpointCodec) return yield* commerceError("storedCorruption");
    const checkpoint = yield* decodeDurableNativeCheckpoint(input.checkpoint.bytes, {
      workflowId: importProductsWorkflowId, transactionId: input.runId, expectedInput: input.input,
      expectedEventGroupId: input.runId,
    });
    // The existing exported-workflow closure owns the return reference. This
    // reads its native checkpoint context without constructing an execution or
    // issuing any current-attempt capability.
    const resolved = yield* Effect.exit(Effect.tryPromise({
      try: () => Promise.resolve(importProductsWorkflow().resolveResult(checkpoint)),
      catch: cause => commerceError("storedCorruption", cause),
    }).pipe(Effect.flatMap(value => decodeSummary(value).pipe(Effect.mapError(cause => commerceError("storedCorruption", cause))))));
    if (Exit.isSuccess(resolved)) return resolved.value;
    if (checkpoint.flow.state === TransactionState.REVERTED || checkpoint.flow.state === TransactionState.FAILED) return null;
    return yield* Effect.failCause(resolved.cause);
  });
  const execute = Effect.fn("ProductImport.interpret")(function* (input: {
    readonly subject: TrustedWorkflowInterpreterSubject;
    readonly input: ProductInlineImportInput;
    readonly continuation: TrustedWorkflowContinuation | null;
    readonly observedAtMs: number;
    readonly cancellationRequested: boolean;
  }) {
    const pins = yield* Effect.fromResult(inspectTrustedWorkflowInterpreterSubject(input.subject));
    if (pins.definition.executionProfile !== productInlineImportProfile || !jsonEqual(pins.definition.executionPolicy, productInlineImportPolicy))
      return yield* commerceError("invalidAuthority");
    if (input.cancellationRequested && pins.executionMode !== "control") return yield* commerceError("invalidAuthority");
    const clock = yield* Clock.Clock;
    const started = clock.monotonicTimeNanosUnsafe();
    const resolution = input.continuation?.resolution;
    const anchor = Math.max(input.observedAtMs, resolution?.observedAtMs ?? input.observedAtMs);
    if (!Number.isSafeInteger(anchor) || anchor < 0 || (resolution?.kind === "timeout" && anchor <= input.continuation!.deadlineAtMs))
      return yield* commerceError("storedCorruption");
    const transactionId = pins.runId;
    const bridge = yield* makeDurableNativeStorage({
      subject: input.subject, checkpointStore: config.checkpointStore, runEffect: config.runEffect,
      clock: { now: () => anchor + Number((clock.monotonicTimeNanosUnsafe() - started) / 1_000_000n) },
      workflowId: importProductsWorkflowId, transactionId,
      uncheckpointedChild: { workflowId: "batch-products", transactionId: `batch-products-as-step-${transactionId}` },
      recoveryStepId: atomicBatchStepId,
      waitStepId: waitConfirmationProductImportStepId, timeoutMs: productInlineImportPolicy.confirmationTimeoutSeconds * 1000,
      expectedInput: input.input,
      expectedEventGroupId: transactionId,
      ...(input.continuation === null ? {} : { requiredCheckpoint: input.continuation.checkpoint }),
    });
    const services = new Map<string, unknown>();
    const container = nativeContainer(services);
    const engine = new WorkflowOrchestratorService(bridge.runtime, container);
    const module = new WorkflowsModuleService(engine);
    services.set("workflows", module);
    services.set(productImportPlanAdmissionService, { admit: async (plan: unknown) => {
      // Pure profile refusal is native business failure data. It must not
      // revoke the subject needed to persist the native failed checkpoint.
      Result.getOrThrow(config.batch.decodeInput(plan));
    },
    });
    services.set(productImportAtomicBatchService, { invoke: (plan: unknown) => bridge.boundary(Effect.gen(function* () {
      if (pins.executionMode !== "workflow") return yield* commerceError("invalidAuthority");
      const value = yield* Effect.fromResult(config.batch.decodeInput(plan));
      const parent = yield* config.notifications.parentFor(input.subject);
      const eligibility = yield* Effect.fromResult(prepareCommitEventEligibility([parent]));
      // SAFETY: inspection authenticates this exact issuer object's ordinary
      // mode. The core repeats current live subject and lease checks at SQL.
      return yield* config.batch.runTaskChild(input.subject as TrustedWorkflowExecutionSubject, 1n, value, eligibility);
    })) });
    const success = pins.executionMode === "workflow" ? config.notifications.serviceFor("success", input.subject, bridge.boundary) : undefined;
    const failure = config.notifications.serviceFor("failure", input.subject, bridge.boundary);
    const expected = (role: "success" | "failure") => [{ to: "", channel: "feed", template: "admin-ui", data: {
      title: "Product import", description: role === "success"
        ? `Product import of file ${input.input.filename} completed successfully!`
        : `Failed to import products from file ${input.input.filename}`,
    } }];
    services.set("notification", { createNotifications: async (raw: unknown) => {
      const role = await bridge.boundary(Effect.gen(function* () {
        const value = yield* Effect.fromResult(captureCommerceInput(raw));
        if (jsonEqual(value, expected("success"))) return "success" as const;
        if (jsonEqual(value, expected("failure"))) return "failure" as const;
        return yield* commerceError("unsupportedProfile");
      }));
      // The genuine native Notification module owns provider failure and its
      // persisted status. Only its internal core effects use the sticky port.
      if (role === "success") return success === undefined
        ? await bridge.boundary(Effect.fail(commerceError("invalidAuthority")))
        : await success.createNotifications(raw);
      return await failure.createNotifications(raw);
    } });
    const decideEvents = (group: unknown, decision: "released" | "cleared") => bridge.boundary(
      group === transactionId ? config.notifications.decideParent(input.subject, decision) : Effect.fail(commerceError("invalidAuthority")));
    services.set("event_bus", {
      releaseGroupedEvents: (group: unknown) => decideEvents(group, "released"),
      clearGroupedEvents: (group: unknown) => decideEvents(group, "cleared"),
    });
    const foreign = <A>(work: () => Promise<A>) => Effect.tryPromise({
      try: () => bridge.runNative(work), catch: cause => commerceError("adapterFailure", cause),
    });
    const summaryFor = (transaction: DistributedTransaction) => foreign(() =>
      Promise.resolve(importProductsWorkflow(container).resolveResult(transaction))).pipe(
        Effect.flatMap(value => decodeSummary(value).pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)))));
    const result = Effect.gen(function* () {
      const stored = yield* bridge.checkpoint;
      if (pins.executionMode === "workflow") yield* config.notifications.parentFor(input.subject);
      if (stored !== undefined && [TransactionState.DONE, TransactionState.FAILED, TransactionState.REVERTED].includes(stored.flow.state) &&
        !(input.cancellationRequested && stored.flow.state === TransactionState.DONE)) {
        const transaction = yield* foreign(() => engine.getRunningTransaction(importProductsWorkflowId, transactionId));
        yield* foreign(() => importProductsWorkflow(container).recoverTerminalEvents(transaction, { runtime: bridge.runtime }));
        yield* bridge.drain;
        yield* bridge.assertHealthy;
        const recovered = yield* foreign(() => engine.getRunningTransaction(importProductsWorkflowId, transactionId));
        if (!recovered.hasFinished()) return yield* commerceError("resultUnavailable");
        const summary = yield* Effect.exit(summaryFor(recovered));
        yield* bridge.assertHealthy;
        if (Exit.isFailure(summary) && recovered.getFlow().state !== TransactionState.FAILED &&
          recovered.getFlow().state !== TransactionState.REVERTED) return yield* Effect.failCause(summary.cause);
        return Object.freeze({ kind: "finished" as const, state: recovered.getFlow().state,
          summary: Exit.isSuccess(summary) ? summary.value : null, errors: recovered.getErrors() });
      }
      // A crash after the native waiting save and before Task registration is
      // recovered without running timeout scheduling or changing the clock.
      if (input.continuation === null && pins.executionMode === "workflow" && stored !== undefined) {
        const proposal = yield* bridge.waitProposal;
        if (proposal !== undefined && stored.flow.state === TransactionState.INVOKING) {
          const transaction = yield* foreign(() => engine.getRunningTransaction(importProductsWorkflowId, transactionId));
          const summary = yield* summaryFor(transaction);
          const latest = yield* bridge.latest;
          yield* bridge.drain;
          yield* bridge.assertHealthy;
          if (latest === undefined) return yield* commerceError("storedCorruption");
          return Object.freeze({ kind: "waiting" as const, prepared: latest.prepared, ...proposal, summary });
        }
      }
      const context = { eventGroupId: transactionId };
      const pendingChild = stored === undefined ? undefined : Object.values(stored.flow.steps)
        .find(step => step.definition?.action === atomicBatchStepId);
      const storedConfirmation = stored === undefined ? undefined : Object.values(stored.flow.steps)
        .find(step => step.definition?.action === waitConfirmationProductImportStepId);
      const confirmationAcknowledged = storedConfirmation?.invoke.state === TransactionStepState.DONE &&
        storedConfirmation.invoke.status === TransactionStepStatus.OK;
      const recoveringChild = !input.cancellationRequested && pins.executionMode === "workflow" && resolution?.kind === "confirmed" &&
        stored?.flow.state === TransactionState.INVOKING && storedConfirmation?.invoke.state === TransactionStepState.DONE &&
        pendingChild?.invoke.state === TransactionStepState.INVOKING && pendingChild.invoke.status === TransactionStepStatus.WAITING;
      if (recoveringChild) {
        if (pendingChild.attempts < 1 || pendingChild.attempts + 1 > pins.attemptNumber ||
          pendingChild.attempts + 1 > pins.definition.boundPolicy.runAttempt.retry.maxAttempts)
          return yield* commerceError("unsupportedProfile");
        // A crash after retryStep's own save already left the native retry
        // flag. Otherwise ask the genuine orchestrator to write that metadata
        // and propose its immediate retry. The following native run consumes
        // it and derives the real child attempt ID; occurrence 1 remains the
        // same durable commerce receipt.
        if (!pendingChild.retryRescheduledAt) {
          yield* foreign(() => module.retryStep({ idempotencyKey: {
            workflowId: importProductsWorkflowId, transactionId, stepId: atomicBatchStepId, action: "invoke",
          }, options: { context, throwOnError: false } }));
          yield* bridge.assertHealthy;
          if (!(yield* bridge.retryRequested)) return yield* commerceError("storedCorruption");
        }
      }
      const outcome = yield* Effect.exit(foreign(() => {
        if (input.cancellationRequested) return stored?.flow.cancelledAt !== undefined ||
          stored?.flow.state === TransactionState.WAITING_TO_COMPENSATE || stored?.flow.state === TransactionState.COMPENSATING
          ? module.run(importProductsWorkflowId, { transactionId, input: input.input, context, throwOnError: false })
          : module.cancel(importProductsWorkflowId, { transactionId, context, throwOnError: false });
        if (resolution?.kind === "timeout") return module.run(importProductsWorkflowId,
          { transactionId, input: input.input, context, throwOnError: false });
        if (pins.executionMode === "control") return module.cancel(importProductsWorkflowId,
          { transactionId, context, throwOnError: false });
        if (recoveringChild || (resolution?.kind === "confirmed" && confirmationAcknowledged)) return module.run(importProductsWorkflowId,
          { transactionId, input: input.input, context, throwOnError: false });
        if (resolution?.kind === "confirmed") return module.setStepSuccess({
          idempotencyKey: { workflowId: importProductsWorkflowId, transactionId,
            stepId: waitConfirmationProductImportStepId, action: "invoke" },
          stepResponse: new StepResponse(true), options: { context, throwOnError: false },
        });
        if (input.continuation !== null) throw commerceError("invalidAuthority");
        return module.run(importProductsWorkflow, { transactionId, input: input.input, context, throwOnError: false });
      }));
      yield* bridge.drain;
      yield* bridge.assertHealthy;
      if (yield* bridge.terminalWakeRequested) {
        // Native queued this wake from its stale nested-child failure callback.
        // The real parent run reads the newer FAILED checkpoint and performs
        // no business operation. Drain that one admitted wake before releasing
        // this attempt; no timer/job is silently left behind.
        yield* foreign(() => module.run(importProductsWorkflowId,
          { transactionId, input: input.input, context, throwOnError: false }));
        yield* bridge.drain;
        yield* bridge.assertHealthy;
      }
      const transaction = yield* foreign(() => engine.getRunningTransaction(importProductsWorkflowId, transactionId));
      const state = transaction.getFlow().state;
      const summaryExit = yield* Effect.exit(summaryFor(transaction));
      yield* bridge.assertHealthy;
      if (Exit.isFailure(summaryExit) && state !== TransactionState.FAILED && state !== TransactionState.REVERTED)
        return yield* Effect.failCause(summaryExit.cause);
      const summary = Exit.isSuccess(summaryExit) ? summaryExit.value : null;
      if (transaction.hasFinished()) return Object.freeze({ kind: "finished" as const, state, summary, errors: transaction.getErrors() });
      if (Exit.isFailure(outcome)) return yield* Effect.failCause(outcome.cause);
      const confirmation = Object.values(transaction.getFlow().steps).find(step => step.definition?.action === waitConfirmationProductImportStepId);
      if (input.cancellationRequested && pins.executionMode === "control" && state === TransactionState.WAITING_TO_COMPENSATE &&
        transaction.getFlow().cancelledAt !== undefined && confirmation?.invoke.state === TransactionStepState.INVOKING &&
        confirmation.invoke.status === TransactionStepStatus.WAITING) {
        const proposal = yield* bridge.waitProposal;
        if (proposal === undefined || proposal.nativeStartedAtMs !== confirmation.startedAt || summary === null)
          return yield* commerceError("storedCorruption");
        // Native cancellation cannot compensate an unanswered async step.
        // The outer Task owner retires this control attempt and schedules its
        // existing retry at the original timeout; a fresh subject runs the
        // genuine timeout path rather than inventing a cancellation response.
        return Object.freeze({ kind: "pendingControl" as const, state, ...proposal, summary, errors: transaction.getErrors() });
      }
      if (input.continuation !== null || confirmation?.invoke.state !== TransactionStepState.INVOKING ||
        confirmation.invoke.status !== TransactionStepStatus.WAITING)
        return yield* commerceError("resultUnavailable", { nativeState: state });
      const proposal = yield* bridge.waitProposal;
      const latest = yield* bridge.latest;
      if (state !== TransactionState.INVOKING || proposal === undefined || latest === undefined || summary === null || pins.executionMode !== "workflow")
        return yield* commerceError("storedCorruption");
      return Object.freeze({ kind: "waiting" as const, prepared: latest.prepared, ...proposal, summary });
    });
    return yield* result.pipe(Effect.onExit(exit => Effect.uninterruptible(Effect.gen(function* () {
      if (Exit.isFailure(exit)) yield* bridge.poison(exit.cause);
      // Foreground as well as recursive native background Promises are owned.
      yield* bridge.drain;
      yield* bridge.close;
    }))));
  });
  return Object.freeze({ execute, readSummary });
});
