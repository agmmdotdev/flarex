import { describe, expect, it } from "vitest";
import {
  decideCompleteAttemptV1,
  decideHandleLeaseExpiryV1,
  decideHeartbeatAttemptV1,
  decideRequestCancellationV1,
  decideStartAttemptV1,
} from "../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { projectRunAttemptStateV1 } from "../src/runAttempt/Model.js";
import {
  decodeRunAttemptCommandV1,
  decodeTaskAttemptCompletionV1,
  decodeTaskRunAttemptAggregateV1,
  encodeTaskRunAttemptAggregateV1,
} from "../src/runAttempt/Schema.js";
import { Result } from "effect";
import {
  executeCompatibilityVectorsV1,
  executeCompatibilityInspectionsV1,
  normalizeExpectedV1,
  type CompatibilityInspectionCaseV1,
  type CompatibilityInspectionProjectionV1,
  type CompatibilityEffectCursorCaseV1,
  type CompatibilityVectorV1,
} from "./compatibility-harness.js";
import {
  ATTEMPT_ID,
  ATTEMPT_NUMBER_1,
  FENCE_1,
  JITTER,
  LEASE_VERSION_1,
  NOW,
  RUN_ID,
  committedDecision,
  attemptId,
  attemptNumber,
  cancellationGeneration,
  databaseTime,
  duration,
  effectSequence,
  executingAggregate,
  fence,
  heartbeatSequence,
  readyAggregate,
} from "./support.js";
import suiteJson from "../../../integration/durable-task-compatibility/scenarios/v1/run-attempt-lifecycle.json";

interface CompatibilitySuiteV1 {
  readonly schemaVersion: string;
  readonly upstreamCommit: string;
  readonly inspectionCases: readonly CompatibilityInspectionCaseV1[];
  readonly effectCursorCases: readonly CompatibilityEffectCursorCaseV1[];
  readonly replayLinks: ReadonlyArray<{ readonly scenarioId: string; readonly originalScenarioId: string }>;
  readonly vectors: readonly CompatibilityVectorV1[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWritableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInspectionProjection(value: unknown): value is CompatibilityInspectionProjectionV1 {
  if (!isRecord(value)) return false;
  const nullableNumberKeys = [
    "attemptNumber", "leaseVersion", "heartbeatSequence", "eligibleAtMs", "retryNotBeforeMs",
  ] as const;
  const nullableStringKeys = ["retryCause", "terminalKind", "cancellationResolution", "resultCommitment", "failureClass"] as const;
  return typeof value.version === "string" && typeof value.observedAtMs === "number" &&
    typeof value.stateVersion === "string" && typeof value.runId === "string" &&
    typeof value.taskDefinitionRevisionId === "string" && typeof value.runVersion === "number" &&
    typeof value.phase === "string" && typeof value.stateVariant === "string" &&
    typeof value.cancellationKind === "string" && typeof value.cancellationGeneration === "number" &&
    nullableNumberKeys.every((key) => value[key] === null || typeof value[key] === "number") &&
    nullableStringKeys.every((key) => value[key] === null || typeof value[key] === "string");
}

function isCompatibilitySuiteV1(value: unknown): value is CompatibilitySuiteV1 {
  if (!isRecord(value)) return false;
  const record = value;
  return typeof record.schemaVersion === "string" &&
    typeof record.upstreamCommit === "string" &&
    Array.isArray(record.inspectionCases) &&
    Array.isArray(record.effectCursorCases) &&
    Array.isArray(record.replayLinks) &&
    Array.isArray(record.vectors) && record.vectors.every((vector) => {
      if (!isRecord(vector) || typeof vector.id !== "string" || !isRecord(vector.input) || !isRecord(vector.initial) ||
        !isRecord(vector.command) || !isRecord(vector.expected)) return false;
      const expected = vector.expected;
      return typeof vector.input.databaseNowMs === "number" && typeof vector.input.retryRandomize === "boolean" &&
        typeof vector.initial.phase === "string" && typeof vector.initial.cancellation === "string" &&
        typeof vector.initial.runVersion === "number" && typeof vector.command.operation === "string" &&
        typeof vector.command.identity === "string" &&
        (expected.kind === "receipt" || expected.kind === "error") &&
        (expected.transition === null || typeof expected.transition === "string") &&
        (expected.acceptedRunVersion === null || typeof expected.acceptedRunVersion === "number") &&
        (expected.recordedAtMs === null || typeof expected.recordedAtMs === "number") &&
        Array.isArray(expected.evidenceKinds) && Array.isArray(expected.effects);
    }) && record.effectCursorCases.every((entry) => isRecord(entry) &&
      typeof entry.scenarioId === "string" && typeof entry.priorEffectCursor === "number" &&
      typeof entry.resultingEffectCursor === "number") &&
    record.replayLinks.every((entry) => isRecord(entry) &&
      typeof entry.scenarioId === "string" && typeof entry.originalScenarioId === "string") &&
    record.inspectionCases.every((entry) => isRecord(entry) && typeof entry.id === "string" && isInspectionProjection(entry.projection));
}

if (!isCompatibilitySuiteV1(suiteJson)) throw new Error("invalid admitted compatibility suite");
const suite = suiteJson;

describe("DTE03-F compatibility receipts", () => {
  it("binds the admitted vector suite and its executable receipt inventory", () => {
    expect(suite.schemaVersion).toBe("flarex.run-attempt-vector-suite.v1");
    expect(suite.upstreamCommit).toBe("f10bc23785e569e5d917318cf2033aabdbe96a0b");
    expect(suite.inspectionCases).toHaveLength(14);
    expect(suite.effectCursorCases).toHaveLength(24);
    expect(suite.replayLinks).toHaveLength(8);
    expect(suite.vectors).toHaveLength(65);
    expect(new Set(suite.vectors.map((vector) => vector.id)).size).toBe(65);
  });

  it("binds command rejection vectors to the real closed command schema", () => {
    const invalid = decodeRunAttemptCommandV1("start_attempt", {
      type: "start_attempt",
      runId: RUN_ID,
      expectedRunVersion: "1",
      retryJitter: 0.25,
      environmentId: "removed-trigger-authority",
    });
    expect(invalid).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "InvalidRunAttemptCommandError",
        operation: "start_attempt",
        issue: "invalid_shape",
      },
    });
    expect(suite.vectors.some((vector) =>
      vector.id === "invalid-command-is-redacted" && vector.expected.kind === "error"))
      .toBe(true);
  });

  it("executes all admitted lifecycle vectors through the production decision and boundary code", () => {
    const executions = executeCompatibilityVectorsV1(suite.vectors, suite.effectCursorCases);
    expect(executions.size).toBe(65);
    for (const vector of suite.vectors) {
      expect(executions.get(vector.id)?.actual, vector.id).toEqual(normalizeExpectedV1(vector.expected));
    }
  });

  it("proves every accepted effect cursor and replay link from executed receipts", () => {
    const executions = executeCompatibilityVectorsV1(suite.vectors, suite.effectCursorCases);
    for (const cursor of suite.effectCursorCases) {
      const actual = executions.get(cursor.scenarioId)?.actual;
      expect(actual?.effects.at(-1)?.sequence ?? cursor.priorEffectCursor, cursor.scenarioId)
        .toBe(cursor.resultingEffectCursor);
    }
    for (const link of suite.replayLinks) {
      const replay = executions.get(link.scenarioId)?.actual;
      const original = executions.get(link.originalScenarioId)?.actual;
      expect(replay, link.scenarioId).toEqual({ ...original, disposition: "idempotent" });
    }
  });

  it("projects all admitted inspection states through the production projection", () => {
    const actual = executeCompatibilityInspectionsV1(suite.inspectionCases);
    expect(actual.size).toBe(14);
    for (const entry of suite.inspectionCases) {
      expect(actual.get(entry.id), entry.id).toEqual(entry.projection);
    }
  });

  it("establishes ownership of result commitment digest bytes", () => {
    const callerDigest = new Uint8Array(32).fill(7);
    const completion = decodeTaskAttemptCompletionV1({
      kind: "succeeded",
      result: { codec: "flarex.task-result.v1", byteLength: 10, sha256: callerDigest },
      executionDurationMs: null,
    });
    expect(completion).toMatchObject({ _tag: "Success" });
    if (completion._tag !== "Success" || completion.success.kind !== "succeeded" || completion.success.result === null) {
      throw new Error("completion fixture did not decode");
    }
    expect(completion.success.result.sha256).not.toBe(callerDigest);
    callerDigest[0] = 1;
    expect(completion.success.result.sha256[0]).toBe(7);
  });

  it("returns detached frozen commit and projection graphs", () => {
    const callerDigest = new Uint8Array(32).fill(9);
    const decision = committedDecision(decideCompleteAttemptV1({
      type: "complete_attempt",
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      executionFence: FENCE_1,
      completion: {
        kind: "succeeded",
        result: { codec: "flarex.task-result.v1", byteLength: 1, sha256: callerDigest },
        executionDurationMs: null,
      },
    }, {
      databaseNowMs: NOW,
      current: executingAggregate({ effectCursor: 8n }),
      attemptGrantCandidate: null,
    }));
    if (decision.next.phase !== "terminal" || decision.next.terminal.kind !== "succeeded" ||
      decision.next.terminal.result === null) throw new Error("expected terminal result commitment");
    const storedDigest = decision.next.terminal.result.sha256;
    expect(storedDigest).not.toBe(callerDigest);
    callerDigest[0] = 1;
    expect(storedDigest[0]).toBe(9);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.next)).toBe(true);
    expect(Object.isFrozen(decision.next.terminal)).toBe(true);
    expect(Object.isFrozen(decision.evidence)).toBe(true);
    expect(Object.isFrozen(decision.requestedEffects)).toBe(true);

    const state = projectRunAttemptStateV1(decision.next);
    if (state.phase !== "terminal" || state.terminal.kind !== "succeeded" || state.terminal.result === null) {
      throw new Error("expected projected terminal result commitment");
    }
    expect(state.terminal.result.sha256).not.toBe(storedDigest);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.terminal)).toBe(true);
  });

  it("rejects persisted receipt and replay collections outside admitted bounds", () => {
    const decision = committedDecision(decideCompleteAttemptV1({
      type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1,
      completion: { kind: "succeeded", result: null, executionDurationMs: null },
    }, {
      databaseNowMs: NOW, current: executingAggregate({ effectCursor: 8n }), attemptGrantCandidate: null,
    }));
    const encoded = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(decision.next));
    if (!isWritableRecord(encoded) || !Array.isArray(encoded.completionReplays) ||
      encoded.completionReplays[0] === undefined || !isWritableRecord(encoded.lastLifecycleAcceptance) ||
      !isWritableRecord(encoded.lastLifecycleAcceptance.accepted)) {
      throw new Error("encoded aggregate bounds fixture invalid");
    }

    const noEvidence = structuredClone(encoded);
    if (!isWritableRecord(noEvidence.lastLifecycleAcceptance) || !isWritableRecord(noEvidence.lastLifecycleAcceptance.accepted)) {
      throw new Error("encoded acceptance fixture invalid");
    }
    noEvidence.lastLifecycleAcceptance.accepted.evidence = [];
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(noEvidence))).toBe(true);

    const oneEffect = structuredClone(encoded);
    if (!isWritableRecord(oneEffect.lastLifecycleAcceptance) || !isWritableRecord(oneEffect.lastLifecycleAcceptance.accepted)) {
      throw new Error("encoded effect fixture invalid");
    }
    oneEffect.lastLifecycleAcceptance.accepted.requestedEffects = [
      ...(Array.isArray(oneEffect.lastLifecycleAcceptance.accepted.requestedEffects)
        ? oneEffect.lastLifecycleAcceptance.accepted.requestedEffects.slice(0, 1)
        : []),
    ];
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(oneEffect))).toBe(true);

    const tooManyReplays = structuredClone(encoded);
    if (!Array.isArray(tooManyReplays.completionReplays) || tooManyReplays.completionReplays[0] === undefined) {
      throw new Error("encoded replay fixture invalid");
    }
    const replay = tooManyReplays.completionReplays[0];
    tooManyReplays.completionReplays = Array.from({ length: 251 }, () => replay);
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(tooManyReplays))).toBe(true);
  });

  it("rejects each mandatory aggregate correlation family as stored corruption", () => {
    const activeState = committedDecision(decideStartAttemptV1({
      type: "start_attempt",
      runId: RUN_ID,
      expectedRunVersion: readyAggregate().runVersion,
      retryJitter: JITTER,
    }, {
      databaseNowMs: NOW,
      current: readyAggregate(),
      attemptGrantCandidate: {
        attemptId: ATTEMPT_ID,
        attemptNumber: ATTEMPT_NUMBER_1,
        executionFence: FENCE_1,
      },
    })).next;
    const activeEncoded = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(activeState));
    if (!isWritableRecord(activeEncoded) || !isWritableRecord(activeEncoded.currentAttempt) ||
      !isWritableRecord(activeEncoded.currentAttempt.lease)) throw new Error("active aggregate fixture invalid");

    const attemptCursorMismatch = structuredClone(activeEncoded);
    attemptCursorMismatch.attemptHistory = { kind: "issued", lastAttemptNumber: 2 };
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(attemptCursorMismatch))).toBe(true);

    const leaseCursorMismatch = structuredClone(activeEncoded);
    leaseCursorMismatch.leaseHistory = { kind: "issued", lastLeaseVersion: "2" };
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(leaseCursorMismatch))).toBe(true);

    const zeroLease = structuredClone(activeEncoded);
    if (!isWritableRecord(zeroLease.currentAttempt) || !isWritableRecord(zeroLease.currentAttempt.lease)) {
      throw new Error("lease fixture invalid");
    }
    zeroLease.currentAttempt.lease.expiresAtMs = zeroLease.currentAttempt.lease.renewedAtMs;
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(zeroLease))).toBe(true);

    const wrongLeaseDuration = structuredClone(activeEncoded);
    if (!isWritableRecord(wrongLeaseDuration.currentAttempt) ||
      !isWritableRecord(wrongLeaseDuration.currentAttempt.lease) ||
      typeof wrongLeaseDuration.currentAttempt.lease.expiresAtMs !== "number") {
      throw new Error("lease-duration fixture invalid");
    }
    wrongLeaseDuration.currentAttempt.lease.expiresAtMs += 1;
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(wrongLeaseDuration))).toBe(true);

    const missingAcceptance = structuredClone(activeEncoded);
    missingAcceptance.lastLifecycleAcceptance = null;
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(missingAcceptance))).toBe(true);

    const createdAfterAcceptance = structuredClone(activeEncoded);
    createdAfterAcceptance.createdAtMs = Number(NOW) + 1;
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(createdAfterAcceptance))).toBe(true);

    const startGrantTimestampMismatch = structuredClone(activeEncoded);
    if (!isWritableRecord(startGrantTimestampMismatch.lastLifecycleAcceptance) ||
      !isWritableRecord(startGrantTimestampMismatch.lastLifecycleAcceptance.accepted) ||
      !isWritableRecord(startGrantTimestampMismatch.lastLifecycleAcceptance.accepted.outcome) ||
      !isWritableRecord(startGrantTimestampMismatch.lastLifecycleAcceptance.accepted.outcome.grant) ||
      !Array.isArray(startGrantTimestampMismatch.lastLifecycleAcceptance.accepted.evidence) ||
      !isWritableRecord(startGrantTimestampMismatch.lastLifecycleAcceptance.accepted.evidence[0]) ||
      !isWritableRecord(startGrantTimestampMismatch.lastLifecycleAcceptance.accepted.evidence[0].grant)) {
      throw new Error("start grant timestamp fixture invalid");
    }
    startGrantTimestampMismatch.lastLifecycleAcceptance.accepted.outcome.grant.grantedAtMs = Number(NOW) + 1;
    startGrantTimestampMismatch.lastLifecycleAcceptance.accepted.evidence[0].grant.grantedAtMs = Number(NOW) + 1;
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(startGrantTimestampMismatch))).toBe(true);

    const startFromPhaseMismatch = structuredClone(activeEncoded);
    if (!isWritableRecord(startFromPhaseMismatch.lastLifecycleAcceptance) ||
      !isWritableRecord(startFromPhaseMismatch.lastLifecycleAcceptance.accepted) ||
      !Array.isArray(startFromPhaseMismatch.lastLifecycleAcceptance.accepted.evidence) ||
      !isWritableRecord(startFromPhaseMismatch.lastLifecycleAcceptance.accepted.evidence[0])) {
      throw new Error("start from-phase fixture invalid");
    }
    startFromPhaseMismatch.lastLifecycleAcceptance.accepted.evidence[0].fromPhase = "retry_waiting";
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(startFromPhaseMismatch))).toBe(true);

    const retryDecision = committedDecision(decideCompleteAttemptV1({
      type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1,
      completion: {
        kind: "failed",
        failure: { kind: "task_failure", code: "handler_failed", message: null },
        retry: { kind: "use_bound_policy" },
        executionDurationMs: null,
      },
    }, { databaseNowMs: NOW, current: executingAggregate({ effectCursor: 8n }), attemptGrantCandidate: null }));
    const retryAtLimit = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(retryDecision.next));
    if (!isWritableRecord(retryAtLimit) || !isWritableRecord(retryAtLimit.boundPolicy) ||
      !isWritableRecord(retryAtLimit.boundPolicy.runAttempt) ||
      !isWritableRecord(retryAtLimit.boundPolicy.runAttempt.retry)) throw new Error("retry-limit fixture invalid");
    retryAtLimit.boundPolicy.runAttempt.retry.maxAttempts = 1;
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(retryAtLimit))).toBe(true);

    const retryPolicyMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(retryDecision.next));
    if (!isWritableRecord(retryPolicyMismatch) || !Array.isArray(retryPolicyMismatch.completionReplays) ||
      !isWritableRecord(retryPolicyMismatch.completionReplays[0]) ||
      !isWritableRecord(retryPolicyMismatch.completionReplays[0].accepted) ||
      !Array.isArray(retryPolicyMismatch.completionReplays[0].accepted.evidence) ||
      !isWritableRecord(retryPolicyMismatch.completionReplays[0].accepted.evidence[0]) ||
      !isWritableRecord(retryPolicyMismatch.completionReplays[0].accepted.evidence[0].policy)) {
      throw new Error("retry-policy fixture invalid");
    }
    retryPolicyMismatch.completionReplays[0].accepted.evidence[0].policy.maximumAttempts = 2;
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(retryPolicyMismatch))).toBe(true);

    const cancelled = committedDecision(decideRequestCancellationV1({
      type: "request_cancellation", runId: RUN_ID, reason: { code: "requested", message: null },
    }, { databaseNowMs: NOW, current: readyAggregate(), attemptGrantCandidate: null }));
    const cancellationMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(cancelled.next));
    if (!isWritableRecord(cancellationMismatch) || !isWritableRecord(cancellationMismatch.cancellation)) {
      throw new Error("terminal-cancellation fixture invalid");
    }
    cancellationMismatch.cancellation.generation = "2";
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(cancellationMismatch))).toBe(true);

    const activeCancellationTargetMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(
      committedDecision(decideRequestCancellationV1({
        type: "request_cancellation", runId: RUN_ID, reason: { code: "requested", message: null },
      }, { databaseNowMs: NOW, current: activeState, attemptGrantCandidate: null })).next,
    ));
    if (!isWritableRecord(activeCancellationTargetMismatch) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.outcome) ||
      !Array.isArray(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.evidence) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.evidence[0]) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.evidence[0].attempt) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.evidence[0].outcome) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.evidence[0].outcome.attempt) ||
      !Array.isArray(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.requestedEffects) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.requestedEffects[0]) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.requestedEffects[0].effect) ||
      !isWritableRecord(activeCancellationTargetMismatch.lastLifecycleAcceptance.accepted.outcome.attempt)) {
      throw new Error("active-cancellation target fixture invalid");
    }
    const otherAttemptId = "attempt_00000000-0000-4000-8000-000000000002";
    const lifecycleAcceptance = activeCancellationTargetMismatch.lastLifecycleAcceptance;
    if (!isWritableRecord(lifecycleAcceptance)) {
      throw new Error("active-cancellation acceptance fixture lost narrowing");
    }
    const acceptance = lifecycleAcceptance.accepted;
    if (!isWritableRecord(acceptance) || !Array.isArray(acceptance.evidence) ||
      !isWritableRecord(acceptance.outcome) || !Array.isArray(acceptance.requestedEffects)) {
      throw new Error("active-cancellation receipt fixture lost narrowing");
    }
    const evidenceItems = acceptance.evidence;
    const evidence = evidenceItems[0];
    const acceptedOutcome = acceptance.outcome;
    const requestedEffects = acceptance.requestedEffects;
    if (!isWritableRecord(evidence) || !isWritableRecord(evidence.attempt) ||
      !isWritableRecord(evidence.outcome) || !isWritableRecord(evidence.outcome.attempt) ||
      !isWritableRecord(acceptedOutcome) || !isWritableRecord(acceptedOutcome.attempt) ||
      !isWritableRecord(requestedEffects[0]) || !isWritableRecord(requestedEffects[0].effect)) {
      throw new Error("active-cancellation target fixture lost narrowing");
    }
    evidence.attempt.attemptId = otherAttemptId;
    evidence.attempt.executionFence = "2";
    evidence.outcome.attempt.attemptId = otherAttemptId;
    evidence.outcome.attempt.executionFence = "2";
    acceptedOutcome.attempt.attemptId = otherAttemptId;
    acceptedOutcome.attempt.executionFence = "2";
    requestedEffects[0].effect.attemptId = otherAttemptId;
    requestedEffects[0].effect.executionFence = "2";
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(activeCancellationTargetMismatch))).toBe(true);

    const heartbeatLeasePredecessorMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(
      committedDecision(decideHeartbeatAttemptV1({
        type: "heartbeat_attempt",
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        executionFence: FENCE_1,
        heartbeatSequence: heartbeatSequence(1),
      }, {
        databaseNowMs: databaseTime(NOW + 1),
        current: activeState,
        attemptGrantCandidate: null,
      })).next,
    ));
    if (!isWritableRecord(heartbeatLeasePredecessorMismatch) ||
      !isWritableRecord(heartbeatLeasePredecessorMismatch.lastLifecycleAcceptance) ||
      !isWritableRecord(heartbeatLeasePredecessorMismatch.lastLifecycleAcceptance.accepted) ||
      !Array.isArray(heartbeatLeasePredecessorMismatch.lastLifecycleAcceptance.accepted.evidence) ||
      !isWritableRecord(heartbeatLeasePredecessorMismatch.lastLifecycleAcceptance.accepted.evidence[0]) ||
      !Array.isArray(heartbeatLeasePredecessorMismatch.lastLifecycleAcceptance.accepted.requestedEffects) ||
      !isWritableRecord(heartbeatLeasePredecessorMismatch.lastLifecycleAcceptance.accepted.requestedEffects[0]) ||
      !isWritableRecord(heartbeatLeasePredecessorMismatch.lastLifecycleAcceptance.accepted.requestedEffects[0].effect)) {
      throw new Error("heartbeat predecessor fixture invalid");
    }
    heartbeatLeasePredecessorMismatch.lastLifecycleAcceptance.accepted.evidence[0].previousLeaseVersion = "2";
    heartbeatLeasePredecessorMismatch.lastLifecycleAcceptance.accepted.requestedEffects[0].effect.obsoleteLeaseVersion = "2";
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(heartbeatLeasePredecessorMismatch))).toBe(true);

    const leaseExpiryVersionMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(
      committedDecision(decideHandleLeaseExpiryV1({
        type: "handle_lease_expiry",
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        executionFence: FENCE_1,
        expectedLeaseVersion: LEASE_VERSION_1,
      }, {
        databaseNowMs: NOW,
        current: executingAggregate({ leaseExpiresAt: NOW, effectCursor: 8n }),
        attemptGrantCandidate: null,
      })).next,
    ));
    if (!isWritableRecord(leaseExpiryVersionMismatch) ||
      !isWritableRecord(leaseExpiryVersionMismatch.lastLifecycleAcceptance) ||
      !isWritableRecord(leaseExpiryVersionMismatch.lastLifecycleAcceptance.command) ||
      !isWritableRecord(leaseExpiryVersionMismatch.lastLifecycleAcceptance.accepted) ||
      !Array.isArray(leaseExpiryVersionMismatch.lastLifecycleAcceptance.accepted.evidence) ||
      !isWritableRecord(leaseExpiryVersionMismatch.lastLifecycleAcceptance.accepted.evidence[0])) {
      throw new Error("lease-expiry version fixture invalid");
    }
    leaseExpiryVersionMismatch.lastLifecycleAcceptance.command.expectedLeaseVersion = "2";
    leaseExpiryVersionMismatch.lastLifecycleAcceptance.accepted.evidence[0].expiredLeaseVersion = "2";
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(leaseExpiryVersionMismatch))).toBe(true);

    const replayMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(committedDecision(
      decideCompleteAttemptV1({
        type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1,
        completion: { kind: "succeeded", result: null, executionDurationMs: null },
      }, { databaseNowMs: NOW, current: executingAggregate({ effectCursor: 8n }), attemptGrantCandidate: null }),
    ).next));
    if (!isWritableRecord(replayMismatch) || !Array.isArray(replayMismatch.completionReplays) ||
      !isWritableRecord(replayMismatch.completionReplays[0]) ||
      !isWritableRecord(replayMismatch.completionReplays[0].completion)) throw new Error("replay-correlation fixture invalid");
    replayMismatch.completionReplays[0].completion.executionDurationMs = 1;
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(replayMismatch))).toBe(true);

    const latestOutcomeMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(committedDecision(
      decideCompleteAttemptV1({
        type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1,
        completion: { kind: "succeeded", result: null, executionDurationMs: null },
      }, { databaseNowMs: NOW, current: executingAggregate({ effectCursor: 8n }), attemptGrantCandidate: null }),
    ).next));
    if (!isWritableRecord(latestOutcomeMismatch) || !isWritableRecord(latestOutcomeMismatch.lastLifecycleAcceptance) ||
      !isWritableRecord(latestOutcomeMismatch.lastLifecycleAcceptance.accepted) ||
      !isWritableRecord(latestOutcomeMismatch.lastLifecycleAcceptance.accepted.outcome) ||
      !isWritableRecord(latestOutcomeMismatch.lastLifecycleAcceptance.accepted.outcome.terminal)) {
      throw new Error("latest-outcome fixture invalid");
    }
    latestOutcomeMismatch.lastLifecycleAcceptance.accepted.outcome.terminal.result = {
      codec: "flarex.task-result.v1",
      byteLength: 0,
      sha256: new Uint8Array(32),
    };
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(latestOutcomeMismatch))).toBe(true);

    const terminalAttemptMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(committedDecision(
      decideCompleteAttemptV1({
        type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1,
        completion: { kind: "succeeded", result: null, executionDurationMs: null },
      }, { databaseNowMs: NOW, current: executingAggregate({ effectCursor: 8n }), attemptGrantCandidate: null }),
    ).next));
    if (!isWritableRecord(terminalAttemptMismatch) || !isWritableRecord(terminalAttemptMismatch.terminal) ||
      !isWritableRecord(terminalAttemptMismatch.terminal.attempt)) {
      throw new Error("terminal attempt fixture invalid");
    }
    terminalAttemptMismatch.terminal.attempt.attemptId = "attempt_00000000-0000-4000-8000-000000000002";
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(terminalAttemptMismatch))).toBe(true);

    const completionAuthorityMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(committedDecision(
      decideCompleteAttemptV1({
        type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1,
        completion: { kind: "succeeded", result: null, executionDurationMs: null },
      }, { databaseNowMs: NOW, current: executingAggregate({ effectCursor: 8n }), attemptGrantCandidate: null }),
    ).next));
    if (!isWritableRecord(completionAuthorityMismatch) ||
      !isWritableRecord(completionAuthorityMismatch.terminal) ||
      !isWritableRecord(completionAuthorityMismatch.terminal.attempt) ||
      !isWritableRecord(completionAuthorityMismatch.lastLifecycleAcceptance) ||
      !isWritableRecord(completionAuthorityMismatch.lastLifecycleAcceptance.accepted) ||
      !isWritableRecord(completionAuthorityMismatch.lastLifecycleAcceptance.accepted.outcome) ||
      !isWritableRecord(completionAuthorityMismatch.lastLifecycleAcceptance.accepted.outcome.terminal) ||
      !isWritableRecord(completionAuthorityMismatch.lastLifecycleAcceptance.accepted.outcome.terminal.attempt) ||
      !Array.isArray(completionAuthorityMismatch.completionReplays) ||
      !isWritableRecord(completionAuthorityMismatch.completionReplays[0]) ||
      !isWritableRecord(completionAuthorityMismatch.completionReplays[0].accepted) ||
      !isWritableRecord(completionAuthorityMismatch.completionReplays[0].accepted.outcome) ||
      !isWritableRecord(completionAuthorityMismatch.completionReplays[0].accepted.outcome.terminal) ||
      !isWritableRecord(completionAuthorityMismatch.completionReplays[0].accepted.outcome.terminal.attempt) ||
      !Array.isArray(completionAuthorityMismatch.completionReplays[0].accepted.evidence) ||
      !isWritableRecord(completionAuthorityMismatch.completionReplays[0].accepted.evidence[0]) ||
      !isWritableRecord(completionAuthorityMismatch.completionReplays[0].accepted.evidence[0].outcome) ||
      !isWritableRecord(completionAuthorityMismatch.completionReplays[0].accepted.evidence[0].outcome.terminal) ||
      !isWritableRecord(completionAuthorityMismatch.completionReplays[0].accepted.evidence[0].outcome.terminal.attempt)) {
      throw new Error("completion authority fixture invalid");
    }
    const otherCompletionAttempt = "attempt_00000000-0000-4000-8000-000000000002";
    completionAuthorityMismatch.terminal.attempt.attemptId = otherCompletionAttempt;
    completionAuthorityMismatch.lastLifecycleAcceptance.accepted.outcome.terminal.attempt.attemptId = otherCompletionAttempt;
    completionAuthorityMismatch.completionReplays[0].accepted.outcome.terminal.attempt.attemptId = otherCompletionAttempt;
    completionAuthorityMismatch.completionReplays[0].accepted.evidence[0].outcome.terminal.attempt.attemptId = otherCompletionAttempt;
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(completionAuthorityMismatch))).toBe(true);

    const cancellationCompletionMismatch = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(committedDecision(
      decideCompleteAttemptV1({
        type: "complete_attempt",
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        executionFence: FENCE_1,
        completion: {
          kind: "cancellation_acknowledged",
          cancellationGeneration: cancellationGeneration(1n),
          executionDurationMs: null,
        },
      }, {
        databaseNowMs: NOW,
        current: executingAggregate({ cancellation: "requested", effectCursor: 14n }),
        attemptGrantCandidate: null,
      }),
    ).next));
    if (!isWritableRecord(cancellationCompletionMismatch) ||
      !isWritableRecord(cancellationCompletionMismatch.lastLifecycleAcceptance) ||
      !isWritableRecord(cancellationCompletionMismatch.lastLifecycleAcceptance.accepted) ||
      !Array.isArray(cancellationCompletionMismatch.lastLifecycleAcceptance.accepted.evidence) ||
      !isWritableRecord(cancellationCompletionMismatch.lastLifecycleAcceptance.accepted.evidence[0]) ||
      !isWritableRecord(cancellationCompletionMismatch.lastLifecycleAcceptance.accepted.evidence[0].completion) ||
      !Array.isArray(cancellationCompletionMismatch.completionReplays) ||
      !isWritableRecord(cancellationCompletionMismatch.completionReplays[0]) ||
      !isWritableRecord(cancellationCompletionMismatch.completionReplays[0].completion) ||
      !isWritableRecord(cancellationCompletionMismatch.completionReplays[0].accepted) ||
      !Array.isArray(cancellationCompletionMismatch.completionReplays[0].accepted.evidence) ||
      !isWritableRecord(cancellationCompletionMismatch.completionReplays[0].accepted.evidence[0]) ||
      !isWritableRecord(cancellationCompletionMismatch.completionReplays[0].accepted.evidence[0].completion)) {
      throw new Error("cancellation completion fixture invalid");
    }
    cancellationCompletionMismatch.completionReplays[0].completion.cancellationGeneration = "2";
    cancellationCompletionMismatch.completionReplays[0].accepted.evidence[0].completion.cancellationGeneration = "2";
    cancellationCompletionMismatch.lastLifecycleAcceptance.accepted.evidence[0].completion.cancellationGeneration = "2";
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(cancellationCompletionMismatch))).toBe(true);

    const durableRetryDecision = committedDecision(decideCompleteAttemptV1({
      type: "complete_attempt",
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      executionFence: FENCE_1,
      completion: {
        kind: "failed",
        failure: { kind: "task_failure", code: "handler_failed", message: null },
        retry: { kind: "override_delay", delayMs: duration(6_000) },
        executionDurationMs: null,
      },
    }, { databaseNowMs: NOW, current: executingAggregate({ effectCursor: 8n }), attemptGrantCandidate: null }));
    if (durableRetryDecision.next.phase !== "retry_waiting") throw new Error("retry overlap fixture did not retry");
    const laterStart = committedDecision(decideStartAttemptV1({
      type: "start_attempt",
      runId: RUN_ID,
      expectedRunVersion: durableRetryDecision.next.runVersion,
      retryJitter: JITTER,
    }, {
      databaseNowMs: durableRetryDecision.next.retry.notBeforeMs,
      current: durableRetryDecision.next,
      attemptGrantCandidate: {
        attemptId: attemptId("attempt_00000000-0000-4000-8000-000000000002"),
        attemptNumber: attemptNumber(2),
        executionFence: fence(2n),
      },
    }));
    const replayOverlap = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(laterStart.next));
    if (!isWritableRecord(replayOverlap) || !Array.isArray(replayOverlap.completionReplays) ||
      !isWritableRecord(replayOverlap.completionReplays[0]) ||
      !isWritableRecord(replayOverlap.completionReplays[0].accepted) ||
      !Array.isArray(replayOverlap.completionReplays[0].accepted.requestedEffects)) {
      throw new Error("replay overlap fixture invalid");
    }
    for (const persisted of replayOverlap.completionReplays[0].accepted.requestedEffects) {
      if (!isWritableRecord(persisted) || typeof persisted.sequence !== "string") {
        throw new Error("replay overlap sequence fixture invalid");
      }
      persisted.sequence = String(BigInt(persisted.sequence) + 4n);
    }
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(replayOverlap))).toBe(true);

    const replayBeyondCursor = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(committedDecision(
      decideCompleteAttemptV1({
        type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1,
        completion: { kind: "succeeded", result: null, executionDurationMs: null },
      }, { databaseNowMs: NOW, current: executingAggregate({ effectCursor: 8n }), attemptGrantCandidate: null }),
    ).next));
    if (!isWritableRecord(replayBeyondCursor) || !Array.isArray(replayBeyondCursor.completionReplays) ||
      !isWritableRecord(replayBeyondCursor.completionReplays[0]) ||
      !isWritableRecord(replayBeyondCursor.completionReplays[0].accepted) ||
      !Array.isArray(replayBeyondCursor.completionReplays[0].accepted.requestedEffects)) {
      throw new Error("replay-effect fixture invalid");
    }
    for (const persisted of replayBeyondCursor.completionReplays[0].accepted.requestedEffects) {
      if (!isWritableRecord(persisted) || typeof persisted.sequence !== "string") {
        throw new Error("replay-effect sequence fixture invalid");
      }
      persisted.sequence = String(BigInt(persisted.sequence) + 100n);
    }
    expect(Result.isFailure(decodeTaskRunAttemptAggregateV1(replayBeyondCursor))).toBe(true);
  });

  it("owns and freezes decoded aggregates while allowing initial run-creation effect history", () => {
    const initial = readyAggregate();
    const encoded = Result.getOrThrow(encodeTaskRunAttemptAggregateV1({
      ...initial,
      requestedEffectCursor: { kind: "issued", lastSequence: effectSequence(3n) },
    }));
    const decoded = Result.getOrThrow(decodeTaskRunAttemptAggregateV1(encoded));
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.boundPolicy)).toBe(true);
    expect(Object.isFrozen(decoded.completionReplays)).toBe(true);
    expect(decoded.requestedEffectCursor).toMatchObject({ kind: "issued", lastSequence: 3n });
  });
});
