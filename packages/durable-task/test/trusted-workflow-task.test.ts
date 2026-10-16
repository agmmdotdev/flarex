import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { inspectTrustedWorkflowTaskBinding, prepareTrustedWorkflowTaskBinding,
  type TrustedWorkflowTaskBinding } from "../src/runCreation/TrustedWorkflowBinding.js";
import { makeTrustedWorkflowTaskRunCreationInitialAggregate } from "../src/runCreation/InitialAggregate.js";
import { decodeTaskDefinitionReference } from "../src/runCreation/Schema.js";
import { decodeTrustedWorkflowTaskRunAttemptAggregateJson, encodeTrustedWorkflowTaskRunAttemptAggregateJson,
  decodeApplicationTaskRunAttemptAggregateJsonV1, decodePersistedTaskRunAttemptAggregateJsonV1 } from "../src/runAttempt/PersistenceCodec.js";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowCompleteAttempt } from "../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { ATTEMPT_ID, ATTEMPT_NUMBER_1, FENCE_1, JITTER, NOW, RUN_ID, POLICY, COMPUTE_SMALL, LEASE_DURATION, duration, heartbeatSequence } from "./support.js";

const hashFixture = () => Effect.succeed(new Uint8Array(32).fill(0x71));
const definition = () => ({ scopeId: ScopeIdSchema.make("scope_00000000-0000-4000-8000-000000000001"),
  workflowRevision: "a".repeat(64), adapterRevision: "b".repeat(64), executionProfile: "trusted-fixture",
  executionPolicy: { operations: ["one-child"] }, principalSha256: "c".repeat(64),
  boundPolicy: { runAttempt: POLICY, maximumDurationMs: duration(300_000), initialComputeProfile: COMPUTE_SMALL,
    leaseDurationMs: LEASE_DURATION, immediateRetryThresholdMs: duration(5_000) },
});

describe("trusted workflow Task definition and current-reference lifecycle", () => {
  it("captures owned immutable definition data and returns detached digest evidence", async () => {
    const caller = definition();
    const binding = await Effect.runPromise(prepareTrustedWorkflowTaskBinding(caller, hashFixture));
    caller.adapterRevision = "d".repeat(64);
    caller.executionPolicy.operations.push("injected");
    const first = Result.getOrThrow(inspectTrustedWorkflowTaskBinding(binding));
    expect(first.definition.adapterRevision).toBe("b".repeat(64));
    expect(first.definition.executionPolicy).toEqual({ operations: ["one-child"] });
    expect(Object.isFrozen(first.definition.boundPolicy.runAttempt.retry)).toBe(true);
    first.sha256.fill(0);
    first.canonicalBytes.fill(0);
    const second = Result.getOrThrow(inspectTrustedWorkflowTaskBinding(binding));
    expect(second.sha256).toEqual(new Uint8Array(32).fill(0x71));
    expect(new TextDecoder().decode(second.canonicalBytes)).toContain("trusted-fixture");
  });

  it("rejects getters without invoking them and rejects cycles before hashing", async () => {
    let getters = 0, hashes = 0;
    const candidate = definition();
    Object.defineProperty(candidate.executionPolicy, "unsafe", { enumerable: true, get: () => { getters += 1; return true; } });
    const hash = () => { hashes += 1; return hashFixture(); };
    const first = await Effect.runPromise(Effect.result(prepareTrustedWorkflowTaskBinding(candidate, hash)));
    expect(Result.isFailure(first)).toBe(true);
    expect(getters).toBe(0);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const second = await Effect.runPromise(Effect.result(prepareTrustedWorkflowTaskBinding({ ...definition(), executionPolicy: cycle }, hash)));
    expect(Result.isFailure(second)).toBe(true);
    expect(hashes).toBe(0);
  });

  it("refuses forged handles, oversized definitions, excess fields and invalid digests", async () => {
    // This deliberately unauthentic test handle exercises the issuer boundary.
    expect(Result.isFailure(inspectTrustedWorkflowTaskBinding({} as TrustedWorkflowTaskBinding))).toBe(true);
    for (const candidate of [{ ...definition(), unexpected: true },
      { ...definition(), executionPolicy: { data: "x".repeat(70_000) } }]) {
      expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareTrustedWorkflowTaskBinding(candidate, hashFixture))))).toBe(true);
    }
    expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareTrustedWorkflowTaskBinding(definition(), () => Effect.succeed(new Uint8Array(31))))))).toBe(true);
  });

  it("persists a real current-reference envelope which old generation decoders refuse", async () => {
    const binding = Result.getOrThrow(inspectTrustedWorkflowTaskBinding(await Effect.runPromise(prepareTrustedWorkflowTaskBinding(definition(), hashFixture))));
    const aggregate = Result.getOrThrow(makeTrustedWorkflowTaskRunCreationInitialAggregate({ runId: RUN_ID, createdAtMs: NOW,
      trustedWorkflowBindingSha256: binding.sha256, boundPolicy: binding.definition.boundPolicy }));
    const encoded = Result.getOrThrow(encodeTrustedWorkflowTaskRunAttemptAggregateJson(aggregate));
    const decoded = Result.getOrThrow(decodeTrustedWorkflowTaskRunAttemptAggregateJson(encoded));
    expect(decoded).toEqual(aggregate);
    expect(decoded).not.toHaveProperty("taskDefinitionRevisionId");
    expect(decoded).not.toHaveProperty("applicationTaskRuntimeTargetSha256");
    expect(Result.isFailure(decodeApplicationTaskRunAttemptAggregateJsonV1(encoded))).toBe(true);
    expect(Result.isFailure(decodePersistedTaskRunAttemptAggregateJsonV1(encoded))).toBe(true);
    const reference = Result.getOrThrow(decodeTaskDefinitionReference(decoded.definitionReference));
    expect(reference.generation).toBe("trusted_workflow");
  });

  it("reuses actual start, heartbeat, terminal completion and replay decisions", async () => {
    const binding = Result.getOrThrow(inspectTrustedWorkflowTaskBinding(await Effect.runPromise(prepareTrustedWorkflowTaskBinding(definition(), hashFixture))));
    const initial = Result.getOrThrow(makeTrustedWorkflowTaskRunCreationInitialAggregate({ runId: RUN_ID, createdAtMs: NOW,
      trustedWorkflowBindingSha256: binding.sha256, boundPolicy: binding.definition.boundPolicy }));
    const started = Result.getOrThrow(decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: RUN_ID,
      expectedRunVersion: initial.runVersion, retryJitter: JITTER }, { databaseNowMs: NOW, current: initial,
      attemptGrantCandidate: { attemptId: ATTEMPT_ID, attemptNumber: ATTEMPT_NUMBER_1, executionFence: FENCE_1 } }));
    if (started.kind !== "commit") throw new Error("Expected native Task start");
    const heartbeat = Result.getOrThrow(decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: RUN_ID,
      attemptId: ATTEMPT_ID, executionFence: FENCE_1, heartbeatSequence: heartbeatSequence(1) },
    { databaseNowMs: NOW, current: started.next, attemptGrantCandidate: null }));
    if (heartbeat.kind !== "commit") throw new Error("Expected native Task heartbeat");
    const command = { type: "complete_attempt" as const, runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1,
      completion: { kind: "succeeded" as const, result: null, executionDurationMs: null } };
    const completed = Result.getOrThrow(decideTrustedWorkflowCompleteAttempt(command, { databaseNowMs: NOW,
      current: heartbeat.next, attemptGrantCandidate: null }));
    if (completed.kind !== "commit") throw new Error("Expected terminal completion");
    expect(completed.next.phase).toBe("terminal");
    const replay = Result.getOrThrow(decideTrustedWorkflowCompleteAttempt(command, { databaseNowMs: NOW,
      current: completed.next, attemptGrantCandidate: null }));
    expect(replay).toMatchObject({ kind: "no_change", disposition: "idempotent" });
    expect(Result.getOrThrow(decodeTrustedWorkflowTaskRunAttemptAggregateJson(Result.getOrThrow(
      encodeTrustedWorkflowTaskRunAttemptAggregateJson(completed.next))))).toEqual(completed.next);
  });
});
