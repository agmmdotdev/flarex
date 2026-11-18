import { Effect, Option } from "effect";
import { inspectTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import {
  decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowCompleteAttempt,
  decideTrustedWorkflowHandleLeaseExpiry, decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1,
  TaskFailureMessageV1Schema,
  type TaskAttemptCompletionV1, type CurrentTaskRunAttemptAggregate,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { makeTrustedWorkflowTaskRunCreationStore } from "@flarex/persistence-postgres/internal/trusted-workflow-task-run-creation";
import { makeTrustedWorkflowTaskSystemRunAttemptStore, type LocatedTaskSystemRunAttemptTargetV1 } from "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import { makeTrustedWorkflowContinuationStore } from "@flarex/persistence-postgres/internal/trusted-workflow-continuation";
import {
  captureTrustedWorkflowExecutionAuthority, issueTrustedWorkflowExecutionSubject, issueTrustedWorkflowControlSubject,
  revokeTrustedWorkflowExecutionSubject,
} from "@flarex/persistence-postgres/internal/trusted-workflow-execution-subject";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import type { makeFulfillmentDeliveryInterpreter } from "./delivery";
import { fulfillmentDeliveryPolicy, fulfillmentDeliveryProfile, verifyFulfillmentDeliveryInput } from "./delivery-input";
import { captureWorkflowRecord } from "../../workflow/configuration";

type TaskOptions = Omit<Parameters<typeof makeTrustedWorkflowTaskRunCreationStore>[0], "sha256" | "target"> & {
  readonly target: Parameters<typeof makeTrustedWorkflowTaskRunCreationStore>[0]["target"] & LocatedTaskSystemRunAttemptTargetV1;
  readonly principal: unknown;
  readonly principalCanonicalBytes: Uint8Array;
  readonly sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array>;
};
type Interpreter = Effect.Success<ReturnType<typeof makeFulfillmentDeliveryInterpreter>>;
type NativeFinished = Extract<Effect.Success<ReturnType<Interpreter["execute"]>>, { readonly kind: "finished" }>;
const canonicalPolicy = (value: Json) => encodeCanonicalJson(value,
  issue => { throw new Error(`Invalid established Fulfillment delivery policy: ${issue.reason}`); });
const unresolvedControl = TaskFailureMessageV1Schema.make("Native Fulfillment delivery control remains unresolved");

export interface FulfillmentDeliveryTaskResult {
  readonly status: CurrentTaskRunAttemptAggregate;
  readonly result: Json | null;
  readonly errors?: NativeFinished["errors"];
}

/** Private bounded Delivery driver. The existing Task owners retain grants,
 * leases, cancellation and checkpoints; each explicit advance borrows a fresh
 * authenticated subject. Input bytes remain with the outer Task body owner. */
export const makeFulfillmentDeliveryTask = Effect.fn("FulfillmentDelivery.makeTask")(
  function* (configuration: TaskOptions, native: Interpreter) {
    const task = yield* Effect.fromResult(captureWorkflowRecord(configuration));
    const interpreter = yield* Effect.fromResult(captureWorkflowRecord(native));
    const selected = yield* Effect.fromResult(inspectTrustedWorkflowTaskBinding(task.binding));
    if (selected.definition.executionProfile !== fulfillmentDeliveryProfile ||
      canonicalPolicy(selected.definition.executionPolicy) !== canonicalPolicy(fulfillmentDeliveryPolicy) ||
      selected.definition.boundPolicy.runAttempt.retry.maxAttempts < 3 ||
      selected.definition.boundPolicy.leaseDurationMs < 120_000 ||
      selected.definition.boundPolicy.maximumDurationMs < 120_000)
      return yield* commerceError("unsupportedProfile");
    const authority = yield* captureTrustedWorkflowExecutionAuthority(task);
    const creation = makeTrustedWorkflowTaskRunCreationStore(task);
    const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(task);
    const controlStore = yield* makeTrustedWorkflowContinuationStore(task);
    const jitter = yield* Effect.fromResult(decodeTaskRetryJitterV1(0.25));
    const firstHeartbeat = yield* Effect.fromResult(decodeTaskHeartbeatSequenceV1(1));
    const inspect = Effect.fn("FulfillmentDelivery.inspect")(function* (rawRunId: unknown) {
      const snapshot = yield* controlStore.inspect(rawRunId);
      if (snapshot.current.continuation !== undefined)
        return yield* commerceError("unsupportedProfile");
      return snapshot;
    });
    const cancel = Effect.fn("FulfillmentDelivery.cancel")(function* (rawRunId: unknown) {
      const snapshot = yield* inspect(rawRunId);
      yield* controlStore.cancel({ type: "request_cancellation", runId: snapshot.current.runId,
        reason: { code: "requested", message: null } });
      return yield* inspect(snapshot.current.runId);
    });
    const advance = Effect.fn("FulfillmentDelivery.advance")(function* (rawRunId: unknown, rawBody: unknown) {
      let snapshot = yield* inspect(rawRunId);
      const input = yield* verifyFulfillmentDeliveryInput(rawBody, snapshot.inputReference);
      const runId = snapshot.current.runId;
      if (snapshot.current.phase === "terminal") return Object.freeze({ status: snapshot.current,
        result: Option.isNone(snapshot.checkpoint) ? null :
          yield* interpreter.readResult({ input, runId, checkpoint: snapshot.checkpoint.value }) });
      if (snapshot.current.phase === "attempt_granted" || snapshot.current.phase === "executing") {
        const attempt = snapshot.current.currentAttempt;
        yield* lifecycle.transactRunAttempt({ operation: "handle_lease_expiry", runId,
          decide: current => decideTrustedWorkflowHandleLeaseExpiry({ type: "handle_lease_expiry", runId,
            attemptId: attempt.attemptId, executionFence: attempt.executionFence,
            expectedLeaseVersion: attempt.lease.version }, current) });
        return Object.freeze({ status: (yield* inspect(runId)).current, result: null });
      }
      const started = yield* lifecycle.transactRunAttempt({ operation: "start_attempt", runId,
        decide: current => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId,
          expectedRunVersion: snapshot.current.runVersion, retryJitter: jitter }, current) });
      if (started.outcome.kind !== "attempt_granted" || started.disposition !== "accepted")
        return Object.freeze({ status: (yield* inspect(runId)).current, result: null });
      const identity = { runId, ...started.outcome.grant.attempt };
      yield* lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId,
        decide: current => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", ...identity,
          heartbeatSequence: firstHeartbeat }, current) });
      snapshot = yield* inspect(runId);
      const control = snapshot.current.executionMode === "control" || snapshot.current.cancellation.kind === "requested";
      const ordinarySubject = control ? undefined : yield* issueTrustedWorkflowExecutionSubject(identity, task);
      const subject = ordinarySubject ?? (yield* issueTrustedWorkflowControlSubject(identity, task));
      return yield* Effect.gen(function* () {
        let outcome = yield* interpreter.execute({ subject, input,
          cancellationRequested: snapshot.current.cancellation.kind === "requested", observedAtMs: snapshot.observedAtMs });
        snapshot = yield* inspect(runId);
        if (!control && snapshot.current.cancellation.kind === "requested") {
          revokeTrustedWorkflowExecutionSubject(subject);
          const cancellationSubject = yield* issueTrustedWorkflowControlSubject(identity, task);
          outcome = yield* interpreter.execute({ subject: cancellationSubject, input,
            cancellationRequested: true, observedAtMs: snapshot.observedAtMs }).pipe(
              Effect.ensuring(Effect.sync(() => revokeTrustedWorkflowExecutionSubject(cancellationSubject))));
          snapshot = yield* inspect(runId);
        }
        const current = snapshot.current;
        const unresolved = (control || current.cancellation.kind === "requested") && outcome.state !== "reverted";
        const completion: TaskAttemptCompletionV1 = !unresolved && outcome.state === "done" && outcome.errors.length === 0
          ? { kind: "succeeded", result: null, executionDurationMs: null }
          : outcome.state === "reverted" && current.cancellation.kind === "requested"
          ? { kind: "cancellation_acknowledged", cancellationGeneration: current.cancellation.generation, executionDurationMs: null }
          : { kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: unresolved ? unresolvedControl : null },
            retry: { kind: unresolved ? "use_bound_policy" : "do_not_retry" }, executionDurationMs: null };
        yield* lifecycle.transactRunAttempt({ operation: "complete_attempt", runId,
          decide: value => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...identity, completion }, value) });
        return Object.freeze({ status: (yield* inspect(runId)).current, result: outcome.result, errors: outcome.errors });
      }).pipe(Effect.ensuring(Effect.sync(() => revokeTrustedWorkflowExecutionSubject(subject))));
    }, Effect.map((result): FulfillmentDeliveryTaskResult => result));
    const start = Effect.fn("FulfillmentDelivery.start")(function* (requestKey: unknown, inputReference: unknown, rawBody: unknown) {
      yield* verifyFulfillmentDeliveryInput(rawBody, inputReference);
      const created = yield* creation.createRun({ requestKey, input: inputReference, principal: authority.principal });
      return Object.freeze({ runId: created.runId, ...yield* advance(created.runId, rawBody) });
    });
    return Object.freeze({ start, inspect, cancel, advance });
  });
