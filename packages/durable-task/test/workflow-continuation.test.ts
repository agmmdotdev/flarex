import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TrustedWorkflowBindingSha256Schema, makeTrustedWorkflowTaskRunCreationInitialAggregate } from "../src/runCreation/v1.js";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowCompleteAttempt,
  decideTrustedWorkflowRequestCancellation, decideTrustedWorkflowHandleLeaseExpiry,
  decideTrustedWorkflowRegisterContinuation, decideTrustedWorkflowConfirmContinuation, decideTrustedWorkflowExpireContinuation,
  projectCurrentTaskRunAttemptPersistence, encodeTrustedWorkflowTaskRunAttemptAggregateJson,
  decodeTrustedWorkflowTaskRunAttemptAggregateJson, encodeTrustedWorkflowTaskRunAttemptAggregate,
  encodeTaskRunAttemptAggregateV1, TrustedWorkflowCheckpointDescriptorSchema,
  type CurrentTaskRunAttemptAggregate, type CurrentTaskRunAttemptDecision, type CurrentTaskSystemRunAttemptDecisionInput,
  type RegisterTrustedWorkflowContinuationCommand, type TaskAttemptGrantCandidateV1 } from "../src/runAttempt/v1.js";
import { ATTEMPT_ID, ATTEMPT_NUMBER_1, FENCE_1, RUN_ID, NOW, JITTER, heartbeatSequence,
  databaseTime, duration, attemptId, attemptNumber, fence, readyAggregate } from "./support.js";

const context = (current: CurrentTaskRunAttemptAggregate, at = NOW, candidate: TaskAttemptGrantCandidateV1 | null = null): CurrentTaskSystemRunAttemptDecisionInput =>
  ({ current, databaseNowMs: databaseTime(at), attemptGrantCandidate: candidate });
function committed<Outcome, Error>(value: Result.Result<CurrentTaskRunAttemptDecision<Outcome>, Error>) {
  const decision = Result.getOrThrow(value);
  if (decision.kind !== "commit") throw new Error("Expected a genuine lifecycle commit");
  return decision;
}
function start(current: CurrentTaskRunAttemptAggregate, ordinal: number, at: number) {
  return committed(decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: RUN_ID,
    expectedRunVersion: current.runVersion, retryJitter: JITTER }, context(current, databaseTime(at), {
      attemptId: attemptId(`attempt_00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`),
      attemptNumber: attemptNumber(ordinal), executionFence: fence(BigInt(ordinal)),
    }))).next;
}
function heartbeat(current: CurrentTaskRunAttemptAggregate, at: number) {
  if (current.phase !== "attempt_granted") throw new Error("Expected grant before heartbeat");
  return committed(decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: RUN_ID,
    attemptId: current.currentAttempt.attemptId, executionFence: current.currentAttempt.executionFence,
    heartbeatSequence: heartbeatSequence(1) }, context(current, databaseTime(at)))).next;
}
function fixture() {
  const initial = Result.getOrThrow(makeTrustedWorkflowTaskRunCreationInitialAggregate({ runId: RUN_ID, createdAtMs: NOW,
    trustedWorkflowBindingSha256: TrustedWorkflowBindingSha256Schema.make(new Uint8Array(32).fill(0x71)),
    boundPolicy: readyAggregate().boundPolicy }));
  const granted = committed(decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: RUN_ID,
    expectedRunVersion: initial.runVersion, retryJitter: JITTER }, context(initial, NOW,
      { attemptId: ATTEMPT_ID, attemptNumber: ATTEMPT_NUMBER_1, executionFence: FENCE_1 }))).next;
  const executing = heartbeat(granted, NOW + 1);
  const command: RegisterTrustedWorkflowContinuationCommand = { type: "register_continuation", runId: RUN_ID,
    attemptId: ATTEMPT_ID, executionFence: FENCE_1, expectedRunVersion: executing.runVersion,
    waitId: "import/wait-confirmation-product-import/invoke", checkpoint: { revision: 1n, byteLength: 128, sha256: new Uint8Array(32).fill(0x22) },
    nativeStartedAtMs: databaseTime(NOW + 2), timeoutMs: duration(3_600_000), deadlineAtMs: databaseTime(NOW + 3_600_002) };
  const waiting = committed(decideTrustedWorkflowRegisterContinuation(command, context(executing, databaseTime(NOW + 3)))).next;
  return { initial, executing, command, waiting };
}
function cancel(current: CurrentTaskRunAttemptAggregate, at: number) {
  return committed(decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: RUN_ID,
    reason: { code: "requested", message: null } }, context(current, databaseTime(at)))).next;
}
function codec(current: CurrentTaskRunAttemptAggregate) {
  const encoded = Result.getOrThrow(encodeTrustedWorkflowTaskRunAttemptAggregateJson(current));
  expect(Result.getOrThrow(decodeTrustedWorkflowTaskRunAttemptAggregateJson(encoded))).toEqual(current);
  return encoded;
}

describe("trusted workflow durable continuation", () => {
  it("retires the old grant, retains exact native timing/checkpoint and owns its bytes", () => {
    const { waiting, command } = fixture();
    expect(waiting.phase).toBe("continuation_waiting");
    const projection = projectCurrentTaskRunAttemptPersistence(waiting);
    expect(projection).toMatchObject({ dueKind: "handle_continuation_timeout", dueAtMs: command.deadlineAtMs + 1,
      currentAttemptId: null, currentLeaseVersion: null, currentLeaseExpiresAtMs: null, executionFenceBasis: FENCE_1 });
    command.checkpoint.sha256.fill(0);
    expect(waiting.continuation?.checkpoint.sha256).toEqual(new Uint8Array(32).fill(0x22));
    expect(Object.isFrozen(waiting.continuation?.checkpoint)).toBe(true);
    expect(decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID,
      executionFence: FENCE_1, heartbeatSequence: heartbeatSequence(2) }, context(waiting))).toMatchObject({
      _tag: "Success", success: { kind: "no_change", outcome: { reason: "phase_not_active" } },
    });
    codec(waiting);
  });

  it("does not extend a deadline or replace a checkpoint on registration replay", () => {
    const { waiting, command } = fixture();
    const replay = Result.getOrThrow(decideTrustedWorkflowRegisterContinuation(command, context(waiting, databaseTime(NOW + 40_000))));
    expect(replay).toMatchObject({ kind: "no_change", disposition: "idempotent" });
    for (const changed of [
      { ...command, waitId: "another-wait" },
      { ...command, checkpoint: { ...command.checkpoint, revision: 2n } },
      { ...command, deadlineAtMs: databaseTime(command.deadlineAtMs + 1) },
      { ...command, executionFence: fence(2n) },
    ]) expect(Result.isFailure(decideTrustedWorkflowRegisterContinuation(changed, context(waiting)))).toBe(true);
    expect(waiting.continuation?.deadlineAtMs).toBe(command.deadlineAtMs);
  });

  it("admits equal and late confirmations until timeout processing actually wins", () => {
    const { waiting, command, initial } = fixture();
    const confirm = { type: "confirm_continuation" as const, runId: RUN_ID, waitId: command.waitId };
    const expire = { ...confirm, type: "expire_continuation" as const };
    expect(Result.getOrThrow(decideTrustedWorkflowConfirmContinuation(confirm, context(initial)))).toMatchObject({
      kind: "no_change", outcome: { reason: "not_waiting" },
    });
    expect(Result.getOrThrow(decideTrustedWorkflowExpireContinuation(expire, context(waiting, command.deadlineAtMs)))).toMatchObject({
      kind: "no_change", outcome: { reason: "not_expired" },
    });
    for (const at of [command.deadlineAtMs, command.deadlineAtMs + 1, command.deadlineAtMs + 3_600_000]) {
      const confirmed = committed(decideTrustedWorkflowConfirmContinuation(confirm, context(waiting, databaseTime(at)))).next;
      expect(confirmed.continuation?.resolution).toEqual({ kind: "confirmed", observedAtMs: at });
      expect(Result.getOrThrow(decideTrustedWorkflowExpireContinuation(expire, context(confirmed, databaseTime(at + 1))))).toMatchObject({
        kind: "no_change", outcome: { reason: "already_resolved" },
      });
      expect(Result.getOrThrow(decideTrustedWorkflowConfirmContinuation(confirm, context(confirmed, databaseTime(at + 2))))).toMatchObject({
        kind: "no_change", disposition: "idempotent",
      });
      codec(confirmed);
    }
    const expired = committed(decideTrustedWorkflowExpireContinuation(expire, context(waiting, databaseTime(command.deadlineAtMs + 1)))).next;
    expect(expired.executionMode).toBe("control");
    expect(Result.getOrThrow(decideTrustedWorkflowConfirmContinuation(confirm, context(expired, databaseTime(command.deadlineAtMs + 2))))).toMatchObject({
      kind: "no_change", outcome: { reason: "already_resolved" },
    });
    codec(expired);
  });

  it("resumes with a fresh charged attempt/fence while retaining decision replay after completion", () => {
    const { waiting, command } = fixture();
    const confirm = { type: "confirm_continuation" as const, runId: RUN_ID, waitId: command.waitId };
    const ready = committed(decideTrustedWorkflowConfirmContinuation(confirm, context(waiting, databaseTime(NOW + 4)))).next;
    const granted = start(ready, 2, NOW + 5);
    expect(granted.phase).toBe("attempt_granted");
    if (granted.phase !== "attempt_granted") throw new Error("Expected fresh grant");
    expect(granted.currentAttempt).toMatchObject({ attemptNumber: 2, executionFence: 2n, grantedAtMs: NOW + 5 });
    expect(granted.executionMode).toBeUndefined();
    const active = heartbeat(granted, NOW + 6);
    const done = committed(decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", runId: RUN_ID,
      attemptId: granted.currentAttempt.attemptId, executionFence: granted.currentAttempt.executionFence,
      completion: { kind: "succeeded", result: null, executionDurationMs: null } }, context(active, databaseTime(NOW + 7)))).next;
    expect(done.phase).toBe("terminal");
    expect(done.continuation?.waitId).toBe(command.waitId);
    expect(Result.getOrThrow(decideTrustedWorkflowConfirmContinuation(confirm, context(done, databaseTime(NOW + 8))))).toMatchObject({
      kind: "no_change", disposition: "idempotent",
    });
    codec(done);
  });

  it("keeps cancellation pending through restricted control execution until genuine acknowledgement", () => {
    const { waiting, command } = fixture();
    const ready = cancel(waiting, NOW + 4);
    expect(ready).toMatchObject({ phase: "continuation_ready", executionMode: "control", cancellation: { kind: "requested" } });
    const granted = start(ready, 2, NOW + 5), active = heartbeat(granted, NOW + 6);
    if (active.phase !== "executing") throw new Error("Expected control execution");
    const identity = { runId: RUN_ID, attemptId: active.currentAttempt.attemptId, executionFence: active.currentAttempt.executionFence };
    expect(Result.isFailure(decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...identity,
      completion: { kind: "succeeded", result: null, executionDurationMs: null } }, context(active, databaseTime(NOW + 7))))).toBe(true);
    const done = committed(decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...identity,
      completion: { kind: "cancellation_acknowledged", cancellationGeneration: active.cancellation.generation, executionDurationMs: null } },
    context(active, databaseTime(NOW + 7)))).next;
    expect(done).toMatchObject({ phase: "terminal", terminal: { kind: "cancelled", resolution: "acknowledged" } });
    expect(done.continuation?.checkpoint).toEqual(command.checkpoint);
    codec(done);
  });

  it("recovers lost control leases through real retry policy and the latest actual fence, then fails honestly at exhaustion", () => {
    const { waiting } = fixture();
    const granted = start(cancel(waiting, NOW + 4), 2, NOW + 5);
    if (granted.phase !== "attempt_granted") throw new Error("Expected control grant");
    const expiry = { type: "handle_lease_expiry" as const, runId: RUN_ID, attemptId: granted.currentAttempt.attemptId,
      executionFence: granted.currentAttempt.executionFence, expectedLeaseVersion: granted.currentAttempt.lease.version };
    const retry = committed(decideTrustedWorkflowHandleLeaseExpiry(expiry, context(granted, granted.currentAttempt.lease.expiresAtMs))).next;
    expect(retry).toMatchObject({ phase: "continuation_ready", executionMode: "control", cancellation: { kind: "requested" },
      continuation: { suspendedAttempt: { attemptNumber: 1 }, resumeAfterAttempt: { attemptNumber: 2, executionFence: 2n } } });
    expect(projectCurrentTaskRunAttemptPersistence(retry).executionFenceBasis).toBe(2n);
    codec(retry);
    const due = projectCurrentTaskRunAttemptPersistence(retry).dueAtMs;
    if (due === null) throw new Error("Expected retry eligibility");
    const last = start(retry, 3, due);
    if (last.phase !== "attempt_granted") throw new Error("Expected final control grant");
    const failed = committed(decideTrustedWorkflowHandleLeaseExpiry({ type: "handle_lease_expiry", runId: RUN_ID,
      attemptId: last.currentAttempt.attemptId, executionFence: last.currentAttempt.executionFence,
      expectedLeaseVersion: last.currentAttempt.lease.version }, context(last, last.currentAttempt.lease.expiresAtMs))).next;
    expect(failed).toMatchObject({ phase: "terminal", terminal: { kind: "failed", failure: { kind: "system_failure", code: "attempt_dispatch_failed" } } });
    if (failed.phase !== "terminal" || failed.terminal.kind !== "failed") throw new Error("Expected explicit failed control");
    expect(failed.terminal.failure.message).toContain("Native workflow control did not complete");
    expect(failed.continuation?.checkpoint).toEqual(waiting.continuation?.checkpoint);
    codec(failed);
  });

  it("retries failed native control without acknowledging cancellation or losing completion replay", () => {
    const { waiting } = fixture();
    const active = heartbeat(start(cancel(waiting, NOW + 4), 2, NOW + 5), NOW + 6);
    if (active.phase !== "executing") throw new Error("Expected control execution");
    const command = { type: "complete_attempt" as const, runId: RUN_ID, attemptId: active.currentAttempt.attemptId,
      executionFence: active.currentAttempt.executionFence, completion: { kind: "failed" as const,
        failure: { kind: "task_failure" as const, code: "handler_failed" as const, message: null },
        retry: { kind: "override_delay" as const, delayMs: duration(1) }, executionDurationMs: null } };
    const retry = committed(decideTrustedWorkflowCompleteAttempt(command, context(active, databaseTime(NOW + 7)))).next;
    expect(retry).toMatchObject({ phase: "continuation_ready", cancellation: { kind: "requested" },
      continuation: { resumeAfterAttempt: { attemptNumber: 2, executionFence: 2n } } });
    codec(retry);
    expect(Result.getOrThrow(decideTrustedWorkflowCompleteAttempt(command, context(retry, databaseTime(NOW + 8))))).toMatchObject({
      kind: "no_change", disposition: "idempotent",
    });
    const last = heartbeat(start(retry, 3, NOW + 8), NOW + 9);
    if (last.phase !== "executing") throw new Error("Expected final execution");
    const failed = committed(decideTrustedWorkflowCompleteAttempt({ ...command, attemptId: last.currentAttempt.attemptId,
      executionFence: last.currentAttempt.executionFence }, context(last, databaseTime(NOW + 10)))).next;
    expect(failed).toMatchObject({ phase: "terminal", terminal: { kind: "failed" } });
    codec(failed);
  });

  it("serializes cancellation after confirmation while retaining both immutable decisions", () => {
    const { waiting, command } = fixture();
    const confirm = { type: "confirm_continuation" as const, runId: RUN_ID, waitId: command.waitId };
    const confirmed = committed(decideTrustedWorkflowConfirmContinuation(confirm, context(waiting, databaseTime(NOW + 4)))).next;
    const cancelled = cancel(confirmed, NOW + 5);
    expect(cancelled.continuation?.resolution).toEqual({ kind: "confirmed", observedAtMs: NOW + 4 });
    expect(cancelled).toMatchObject({ phase: "continuation_ready", executionMode: "control", cancellation: { kind: "requested" } });
    expect(Result.getOrThrow(decideTrustedWorkflowConfirmContinuation(confirm, context(cancelled, databaseTime(NOW + 6))))).toMatchObject({
      kind: "no_change", disposition: "idempotent", replay: { observedAtMs: NOW + 4 },
    });
    codec(cancelled);
    const granted = start(cancelled, 2, NOW + 6);
    expect(Result.getOrThrow(decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: RUN_ID,
      reason: { code: "requested", message: null } }, context(granted, databaseTime(NOW + 7))))).toMatchObject({
      kind: "no_change", disposition: "idempotent", replay: { observedAtMs: NOW + 5 },
    });
    codec(granted);
  });

  it("rejects corrupted retained registration, confirmation and cancellation evidence and effects after resume and completion", () => {
    const { waiting, command } = fixture();
    const confirmed = committed(decideTrustedWorkflowConfirmContinuation({ type: "confirm_continuation", runId: RUN_ID,
      waitId: command.waitId }, context(waiting, databaseTime(NOW + 4)))).next;
    const active = heartbeat(start(cancel(confirmed, NOW + 5), 2, NOW + 6), NOW + 7);
    if (active.phase !== "executing") throw new Error("Expected resumed control execution");
    const done = committed(decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", runId: RUN_ID,
      attemptId: active.currentAttempt.attemptId, executionFence: active.currentAttempt.executionFence,
      completion: { kind: "cancellation_acknowledged", cancellationGeneration: active.cancellation.generation,
        executionDurationMs: null } }, context(active, databaseTime(NOW + 8)))).next;
    for (const current of [active, done]) {
      codec(current);
      const continuation = current.continuation;
      if (continuation === undefined) throw new Error("Expected retained continuation");
      for (const name of ["registrationReceipt", "resolutionReceipt", "cancellationReceipt"] as const) {
        const receipt = continuation[name];
        if (receipt === null || receipt === undefined) throw new Error("Expected all retained receipts");
        const evidence = receipt.evidence[0];
        if (evidence?.kind !== "workflow_continuation") throw new Error("Expected continuation evidence");
        const mutations = [
          { runId: "run_00000000-0000-4000-8000-000000000002" },
          { operation: evidence.operation === "register_continuation" ? "confirm_continuation" : "register_continuation" },
          { acceptedRunVersion: receipt.acceptedRunVersion + 1n },
          { recordedAtMs: databaseTime(receipt.observedAtMs + 1) },
          { resultingPhase: evidence.resultingPhase === "continuation_waiting" ? "continuation_ready" : "continuation_waiting" },
          { waitId: "another-native-wait" },
          { attempt: { ...evidence.attempt, attemptId: active.currentAttempt.attemptId,
            executionFence: active.currentAttempt.executionFence, attemptNumber: active.currentAttempt.attemptNumber } },
          { outcome: { kind: "continuation_ready", waitId: continuation.waitId, resolution: "timeout" } },
          { checkpoint: { ...continuation.checkpoint, revision: 2n } },
          { nativeStartedAtMs: databaseTime(continuation.nativeStartedAtMs + 1) },
          { timeoutMs: duration(continuation.timeoutMs + 1) },
          { deadlineAtMs: databaseTime(continuation.deadlineAtMs + 1) },
        ];
        for (const mutation of mutations) {
          expect(Result.isFailure(encodeTrustedWorkflowTaskRunAttemptAggregate({ ...current,
            continuation: { ...continuation, [name]: { ...receipt, evidence: [{ ...evidence, ...mutation }] } } })),
          `${current.phase}/${name}/${Object.keys(mutation)[0]}`).toBe(true);
        }
        const firstEffect = receipt.requestedEffects[0];
        if (firstEffect === undefined || current.requestedEffectCursor.kind !== "issued") throw new Error("Expected issued effects");
        const effectMutations = [
          { ...firstEffect, effect: { ...firstEffect.effect, runId: "run_00000000-0000-4000-8000-000000000002" } },
          { ...firstEffect, effect: { ...firstEffect.effect, acceptedRunVersion: receipt.acceptedRunVersion + 1n } },
          { ...firstEffect, sequence: 0n },
          { ...firstEffect, sequence: current.requestedEffectCursor.lastSequence + 1n },
          { ...firstEffect, sequence: 1n },
          ...(firstEffect.effect.kind === "cancel_obsolete_lease_wake" ? [
            { ...firstEffect, effect: { ...firstEffect.effect, attemptId: active.currentAttempt.attemptId } },
            { ...firstEffect, effect: { ...firstEffect.effect, executionFence: active.currentAttempt.executionFence } },
            { ...firstEffect, effect: { ...firstEffect.effect, obsoleteLeaseVersion: active.currentAttempt.lease.version } },
          ] : []),
        ];
        for (const changedEffect of effectMutations) {
          expect(Result.isFailure(encodeTrustedWorkflowTaskRunAttemptAggregate({ ...current,
            continuation: { ...continuation, [name]: { ...receipt,
              requestedEffects: [changedEffect, ...receipt.requestedEffects.slice(1)] } } })),
          `${current.phase}/${name}/requestedEffect`).toBe(true);
        }
        if (receipt.requestedEffects.length > 1) {
          const second = receipt.requestedEffects[1];
          if (second === undefined) throw new Error("Expected second registration effect");
          expect(Result.isFailure(encodeTrustedWorkflowTaskRunAttemptAggregate({ ...current,
            continuation: { ...continuation, [name]: { ...receipt,
              requestedEffects: [firstEffect, { ...second, sequence: second.sequence + 1n }] } } }))).toBe(true);
        }
      }
    }
  });

  it("pins retained timeout and direct cancellation evidence to their original decision operation", () => {
    const { waiting, command } = fixture();
    const expired = committed(decideTrustedWorkflowExpireContinuation({ type: "expire_continuation", runId: RUN_ID,
      waitId: command.waitId }, context(waiting, databaseTime(command.deadlineAtMs + 1)))).next;
    for (const ready of [expired, cancel(waiting, command.deadlineAtMs + 1)]) {
      const active = heartbeat(start(ready, 2, command.deadlineAtMs + 2), command.deadlineAtMs + 3);
      codec(active);
      const continuation = active.continuation;
      const receipt = continuation?.resolutionReceipt;
      if (continuation === undefined || receipt === null || receipt === undefined) throw new Error("Expected retained decision");
      const evidence = receipt.evidence[0];
      if (evidence?.kind !== "workflow_continuation") throw new Error("Expected continuation evidence");
      expect(Result.isFailure(encodeTrustedWorkflowTaskRunAttemptAggregate({ ...active,
        continuation: { ...continuation, resolutionReceipt: { ...receipt,
          evidence: [{ ...evidence, operation: "confirm_continuation" }] } } }))).toBe(true);
    }
  });

  it("rejects malformed checkpoint/timing and keeps retained generation codecs closed", () => {
    const { waiting, executing, command } = fixture();
    const decodeCheckpoint = Schema.decodeUnknownResult(TrustedWorkflowCheckpointDescriptorSchema);
    for (const checkpoint of [{ ...command.checkpoint, revision: 0n }, { ...command.checkpoint, revision: 9_223_372_036_854_775_808n },
      { ...command.checkpoint, byteLength: 1_048_577 }, { ...command.checkpoint, sha256: new Uint8Array(31) }]) {
      expect(Result.isFailure(decodeCheckpoint(checkpoint))).toBe(true);
      expect(Result.isFailure(decideTrustedWorkflowRegisterContinuation({ ...command, checkpoint }, context(executing, databaseTime(NOW + 3))))).toBe(true);
    }
    expect(Result.isFailure(decideTrustedWorkflowRegisterContinuation({ ...command, deadlineAtMs: databaseTime(command.deadlineAtMs + 1) },
      context(executing, databaseTime(NOW + 3))))).toBe(true);
    expect(Result.isFailure(encodeTaskRunAttemptAggregateV1({ ...readyAggregate(), continuation: waiting.continuation }))).toBe(true);
    expect(Result.isFailure(encodeTaskRunAttemptAggregateV1({ ...readyAggregate(), phase: "continuation_waiting" }))).toBe(true);
    expect(Result.isFailure(encodeTrustedWorkflowTaskRunAttemptAggregate({ ...waiting, continuation: { ...waiting.continuation,
      nativeStartedAtMs: NOW, timeoutMs: duration(1), deadlineAtMs: databaseTime(NOW + 1) } }))).toBe(true);
  });
  it("never acknowledges pre-slot native cancellation from lease loss or a failed completion", () => {
    const { executing } = fixture(), requested = cancel(executing, NOW + 2);
    if (requested.phase !== "executing") throw new Error("Expected pending active cancellation");
    expect(requested.continuation).toBeUndefined();
    const expiry = committed(decideTrustedWorkflowHandleLeaseExpiry({ type: "handle_lease_expiry", runId: RUN_ID,
      attemptId: requested.currentAttempt.attemptId, executionFence: requested.currentAttempt.executionFence,
      expectedLeaseVersion: requested.currentAttempt.lease.version }, context(requested, requested.currentAttempt.lease.expiresAtMs))).next;
    expect(expiry).toMatchObject({ phase: "terminal", terminal: { kind: "failed", failure: { code: "execution_lost" } },
      cancellation: { kind: "resolved", resolution: "superseded_by_completion" } });
    if (expiry.phase !== "terminal" || expiry.terminal.kind !== "failed") throw new Error("Expected honest unresolved cancellation failure");
    expect(expiry.terminal.failure.message).toContain("Native workflow control did not complete");
    codec(expiry);
    const failed = committed(decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", runId: RUN_ID,
      attemptId: requested.currentAttempt.attemptId, executionFence: requested.currentAttempt.executionFence,
      completion: { kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: null },
        retry: { kind: "use_bound_policy" }, executionDurationMs: null } }, context(requested, databaseTime(NOW + 3)))).next;
    expect(failed).toMatchObject({ phase: "terminal", terminal: { kind: "failed", failure: { code: "handler_failed" } },
      cancellation: { kind: "resolved", resolution: "superseded_by_completion" } });
    codec(failed);
  });

});
