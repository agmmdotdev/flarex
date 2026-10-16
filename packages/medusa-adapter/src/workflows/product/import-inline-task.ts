import { Effect, Option } from "effect";
import { inspectTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowCompleteAttempt,
  decideTrustedWorkflowHandleLeaseExpiry, decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1, decodeTaskDurationMsV1,
  TaskFailureMessageV1Schema,
  type TaskAttemptCompletionV1, type CurrentTaskRunAttemptAggregate } from "@flarex/durable-task/internal/run-attempt-v1";
import { makeTrustedWorkflowTaskRunCreationStore } from "@flarex/persistence-postgres/internal/trusted-workflow-task-run-creation";
import { makeTrustedWorkflowTaskSystemRunAttemptStore, type LocatedTaskSystemRunAttemptTargetV1 } from "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import { makeTrustedWorkflowContinuationStore } from "@flarex/persistence-postgres/internal/trusted-workflow-continuation";
import { inspectPreparedTrustedWorkflowCheckpoint } from "@flarex/persistence-postgres/internal/trusted-workflow-checkpoint";
import { captureTrustedWorkflowExecutionAuthority, issueTrustedWorkflowExecutionSubject, issueTrustedWorkflowControlSubject,
  revokeTrustedWorkflowExecutionSubject } from "@flarex/persistence-postgres/internal/trusted-workflow-execution-subject";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import type { makeProductInlineImportInterpreter } from "./import-inline";
import { productInlineImportPolicy, productInlineImportProfile, verifyProductInlineImportInput, ProductInlineImportSummary } from "./import-inline-input";
import { captureWorkflowRecord } from "../../workflow/configuration";

type TaskOptions = Omit<Parameters<typeof makeTrustedWorkflowTaskRunCreationStore>[0], "sha256" | "target"> & {
  readonly target: Parameters<typeof makeTrustedWorkflowTaskRunCreationStore>[0]["target"] & LocatedTaskSystemRunAttemptTargetV1;
  readonly principal: unknown;
  readonly principalCanonicalBytes: Uint8Array;
  readonly sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array>;
};
type Interpreter = Effect.Success<ReturnType<typeof makeProductInlineImportInterpreter>>;
const canonicalPolicy = (value: Json) => encodeCanonicalJson(value,
  issue => { throw new Error(`Invalid established import policy: ${issue.reason}`); });
const unresolvedControl = TaskFailureMessageV1Schema.make("Native Product import control remains unresolved");
type NativeFinished = Extract<Effect.Success<ReturnType<Interpreter["execute"]>>, { readonly kind: "finished" }>;
export interface ProductInlineImportTaskResult {
  readonly status: CurrentTaskRunAttemptAggregate;
  readonly summary: typeof ProductInlineImportSummary.Type | null;
  readonly errors?: NativeFinished["errors"];
}

/** Private bounded Task driver for the fixed native inline Product graph.
 * The existing outer Task body owner publishes/loads the canonical input body;
 * this driver never stores input in a second job ledger or owns an autonomous
 * scheduler. Each advance borrows a fresh real grant and ends at wait/terminal. */
export const makeProductInlineImportTask = Effect.fn("ProductImport.makeTask")(
  function* (configuration: TaskOptions, native: Interpreter) {
    const task = yield* Effect.fromResult(captureWorkflowRecord(configuration));
    const interpreter = yield* Effect.fromResult(captureWorkflowRecord(native));
    const selected = yield* Effect.fromResult(inspectTrustedWorkflowTaskBinding(task.binding));
    if (selected.definition.executionProfile !== productInlineImportProfile ||
      canonicalPolicy(selected.definition.executionPolicy) !== canonicalPolicy(productInlineImportPolicy) ||
      selected.definition.boundPolicy.runAttempt.retry.maxAttempts < 3 ||
      selected.definition.boundPolicy.leaseDurationMs < 120_000 ||
      selected.definition.boundPolicy.maximumDurationMs < 120_000)
      return yield* commerceError("unsupportedProfile");
    const authority = yield* captureTrustedWorkflowExecutionAuthority(task);
    const creation = makeTrustedWorkflowTaskRunCreationStore(task);
    const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(task);
    const continuation = yield* makeTrustedWorkflowContinuationStore(task);
    const jitter = yield* Effect.fromResult(decodeTaskRetryJitterV1(0.25));
    const firstHeartbeat = yield* Effect.fromResult(decodeTaskHeartbeatSequenceV1(1));
    const create = Effect.fn("ProductImport.createTask")((requestKey: unknown, inputReference: unknown) =>
      creation.createRun({ requestKey, input: inputReference, principal: authority.principal }));
    const confirm = Effect.fn("ProductImport.confirm")(function* (rawRunId: unknown) {
      const snapshot = yield* continuation.inspect(rawRunId);
      if (snapshot.current.continuation === undefined) return snapshot;
      yield* continuation.confirm({ type: "confirm_continuation", runId: snapshot.current.runId,
        waitId: snapshot.current.continuation.waitId });
      return yield* continuation.inspect(snapshot.current.runId);
    });
    const cancel = Effect.fn("ProductImport.cancel")(function* (rawRunId: unknown) {
      const snapshot = yield* continuation.inspect(rawRunId);
      yield* continuation.cancel({ type: "request_cancellation", runId: snapshot.current.runId,
        reason: { code: "requested", message: null } });
      return yield* continuation.inspect(snapshot.current.runId);
    });
    const advance = Effect.fn("ProductImport.advance")(function* (rawRunId: unknown, rawBody: unknown) {
      let snapshot = yield* continuation.inspect(rawRunId);
      const input = yield* verifyProductInlineImportInput(rawBody, snapshot.inputReference);
      const runId = snapshot.current.runId;
      const storedSummary = () => Option.isNone(snapshot.checkpoint) ? Effect.succeed(null) :
        interpreter.readSummary({ input, runId, checkpoint: snapshot.checkpoint.value });
      if (snapshot.current.phase === "terminal") return Object.freeze({ status: snapshot.current, summary: yield* storedSummary() });
      if (snapshot.current.phase === "continuation_waiting") {
        yield* continuation.expire({ type: "expire_continuation", runId, waitId: snapshot.current.continuation.waitId });
        snapshot = yield* continuation.inspect(runId);
        if (snapshot.current.phase === "continuation_waiting") return Object.freeze({ status: snapshot.current, summary: yield* storedSummary() });
      }
      if (snapshot.current.phase === "attempt_granted" || snapshot.current.phase === "executing") {
        const attempt = snapshot.current.currentAttempt;
        yield* lifecycle.transactRunAttempt({ operation: "handle_lease_expiry", runId,
          decide: current => decideTrustedWorkflowHandleLeaseExpiry({ type: "handle_lease_expiry", runId,
            attemptId: attempt.attemptId, executionFence: attempt.executionFence,
            expectedLeaseVersion: attempt.lease.version }, current) });
        // A live competing owner is never adopted. A lost owner is recovered by
        // the existing policy and a subsequent explicit bounded advance.
        return Object.freeze({ status: (yield* continuation.inspect(runId)).current, summary: null });
      }
      const started = yield* lifecycle.transactRunAttempt({ operation: "start_attempt", runId,
        decide: current => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId,
          expectedRunVersion: snapshot.current.runVersion, retryJitter: jitter }, current) });
      if (started.outcome.kind !== "attempt_granted" || started.disposition !== "accepted")
        return Object.freeze({ status: (yield* continuation.inspect(runId)).current, summary: null });
      const identity = { runId, ...started.outcome.grant.attempt };
      yield* lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId,
        decide: current => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", ...identity,
          heartbeatSequence: firstHeartbeat }, current) });
      snapshot = yield* continuation.inspect(runId);
      const control = snapshot.current.executionMode === "control" || snapshot.current.cancellation.kind === "requested";
      const ordinarySubject = control ? undefined : yield* issueTrustedWorkflowExecutionSubject(identity, task);
      const subject = ordinarySubject ?? (yield* issueTrustedWorkflowControlSubject(identity, task));
      return yield* Effect.gen(function* () {
        let outcome = yield* interpreter.execute({ subject, input, continuation: snapshot.current.continuation ?? null,
          cancellationRequested: snapshot.current.cancellation.kind === "requested",
          observedAtMs: snapshot.observedAtMs });
        snapshot = yield* continuation.inspect(runId);
        if (!control && snapshot.current.cancellation.kind === "requested") {
          // Cancellation can win while a native call is in flight. Its genuine
          // control issuer replaces the old capability before any compensator.
          revokeTrustedWorkflowExecutionSubject(subject);
          const cancellationSubject = yield* issueTrustedWorkflowControlSubject(identity, task);
          outcome = yield* interpreter.execute({ subject: cancellationSubject, input,
            cancellationRequested: true,
            continuation: snapshot.current.continuation ?? null, observedAtMs: snapshot.observedAtMs }).pipe(
              Effect.ensuring(Effect.sync(() => revokeTrustedWorkflowExecutionSubject(cancellationSubject))));
          snapshot = yield* continuation.inspect(runId);
        }
        if (outcome.kind === "pendingControl") {
          if (snapshot.current.cancellation.kind !== "requested") return yield* commerceError("invalidAuthority");
          const delayMs = yield* Effect.fromResult(decodeTaskDurationMsV1(Math.max(0,
            outcome.deadlineAtMs + 1 - snapshot.observedAtMs)));
          yield* lifecycle.transactRunAttempt({ operation: "complete_attempt", runId,
            decide: current => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...identity,
              completion: { kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: unresolvedControl },
                retry: { kind: "override_delay", delayMs }, executionDurationMs: null } }, current) });
          return Object.freeze({ status: (yield* continuation.inspect(runId)).current,
            summary: outcome.summary, errors: outcome.errors });
        }
        if (outcome.kind === "waiting") {
          if (ordinarySubject === undefined || snapshot.current.cancellation.kind === "requested") return yield* commerceError("invalidAuthority");
          const checkpoint = yield* Effect.fromResult(inspectPreparedTrustedWorkflowCheckpoint(outcome.prepared));
          yield* continuation.register(ordinarySubject, outcome.prepared,
            { type: "register_continuation", runId, attemptId: identity.attemptId,
              executionFence: identity.executionFence, expectedRunVersion: snapshot.current.runVersion,
              waitId: outcome.waitId, checkpoint: { revision: checkpoint.expectedRevision + 1n,
                sha256: checkpoint.sha256, byteLength: checkpoint.byteLength },
              nativeStartedAtMs: outcome.nativeStartedAtMs, timeoutMs: outcome.timeoutMs, deadlineAtMs: outcome.deadlineAtMs });
          return Object.freeze({ status: (yield* continuation.inspect(runId)).current, summary: outcome.summary });
        }
        const current = snapshot.current;
        const unresolved = (control || current.cancellation.kind === "requested") && outcome.state !== "reverted";
        const completion: TaskAttemptCompletionV1 = outcome.state === "done" && outcome.errors.length === 0
          ? { kind: "succeeded", result: null, executionDurationMs: null }
          : outcome.state === "reverted" && current.cancellation.kind === "requested"
          ? { kind: "cancellation_acknowledged", cancellationGeneration: current.cancellation.generation, executionDurationMs: null }
          : { kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: unresolved ? unresolvedControl : null },
            retry: { kind: unresolved ? "use_bound_policy" : "do_not_retry" }, executionDurationMs: null };
        yield* lifecycle.transactRunAttempt({ operation: "complete_attempt", runId,
          decide: value => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...identity, completion }, value) });
        return Object.freeze({ status: (yield* continuation.inspect(runId)).current,
          summary: outcome.summary, errors: outcome.errors });
      }).pipe(Effect.ensuring(Effect.sync(() => revokeTrustedWorkflowExecutionSubject(subject))));
    }, Effect.map((result): ProductInlineImportTaskResult => result));
    const start = Effect.fn("ProductImport.start")(function* (requestKey: unknown, inputReference: unknown, rawBody: unknown) {
      yield* verifyProductInlineImportInput(rawBody, inputReference);
      // The trusted caller has already published these canonical bytes using
      // the existing Task body owner before requesting durable creation.
      const created = yield* create(requestKey, inputReference);
      return Object.freeze({ runId: created.runId, ...yield* advance(created.runId, rawBody) });
    });
    return Object.freeze({ start, inspect: continuation.inspect, confirm, cancel, advance });
  });
