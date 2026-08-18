import { createHash } from "node:crypto";

import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
  APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
  MAX_APPLICATION_TASK_MUTATION_FUNCTION_PATH_BYTES_V1,
  applicationTaskMutationRequestKeyV1FromDigest,
  decodeApplicationTaskMutationCallbackRequestV1,
  decodeApplicationTaskMutationCallbackResultV1,
  encodeApplicationTaskMutationRequestIdentityPreimageV1,
  encodeApplicationTaskMutationStableKeyPreimageV1,
  normalizeApplicationTaskMutationCallbackValueV1,
} from "../src/application-task-mutation-callback-v1";

describe("Application Task mutation callback V1", () => {
  it("owns one exact sequential mutation request and success result", () => {
    const argumentsValue = Result.getOrThrow(
      normalizeApplicationTaskMutationCallbackValueV1(
        { orderId: "order-1" },
        "request",
      ),
    );
    const request = Result.getOrThrow(
      decodeApplicationTaskMutationCallbackRequestV1({
        format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
        version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
        operation: "runMutation",
        ordinal: 1n,
        functionPath: "orders:complete",
        arguments: argumentsValue.value,
        argumentSemanticBytes: argumentsValue.semanticSizeBytes,
      }),
    );
    const result = Result.getOrThrow(
      decodeApplicationTaskMutationCallbackResultV1({
        format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
        version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
        kind: "success",
        callId: "execution-1:mutation:1",
        deadlineMs: 1_000,
        value: request.arguments,
        valueSemanticBytes: request.argumentSemanticBytes,
      }),
    );

    expect(request).toMatchObject({
      operation: "runMutation",
      ordinal: 1n,
      functionPath: "orders:complete",
    });
    expect(result).toMatchObject({
      kind: "success",
      callId: "execution-1:mutation:1",
      value: { orderId: "order-1" },
    });
  });

  it.each([
    ["zero ordinal", { ordinal: 0n }],
    ["negative ordinal", { ordinal: -1n }],
    ["unsafe ordinal", { ordinal: 1n << 63n }],
    ["blank path", { functionPath: " " }],
    ["non-Unicode path", { functionPath: "orders:\ud800" }],
    ["oversized path", {
      functionPath: "x".repeat(
        MAX_APPLICATION_TASK_MUTATION_FUNCTION_PATH_BYTES_V1 + 1,
      ),
    }],
    ["size drift", { argumentSemanticBytes: 1 }],
    ["excess member", { unexpected: true }],
  ])("rejects %s before host dispatch", (_label, override) => {
    const normalized = Result.getOrThrow(
      normalizeApplicationTaskMutationCallbackValueV1({}, "request"),
    );
    expect(Result.isFailure(decodeApplicationTaskMutationCallbackRequestV1({
      format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
      version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
      operation: "runMutation",
      ordinal: 1n,
      functionPath: "orders:complete",
      arguments: normalized.value,
      argumentSemanticBytes: normalized.semanticSizeBytes,
      ...override,
    }))).toBe(true);
  });

  it("rejects accessors and hostile record reflection without invoking getters", () => {
    let getterCalled = false;
    const hostileGetter = Object.defineProperty({}, "format", {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error("must not run");
      },
    });
    const hostileProxy = new Proxy({}, {
      ownKeys() {
        throw new Error("foreign ownKeys failure");
      },
    });

    expect(Result.isFailure(
      decodeApplicationTaskMutationCallbackResultV1(hostileGetter),
    )).toBe(true);
    expect(Result.isFailure(
      decodeApplicationTaskMutationCallbackRequestV1(hostileProxy),
    )).toBe(true);
    expect(getterCalled).toBe(false);
  });

  it.each([
    "invalid_request",
    "stale_launch",
    "sequence_mismatch",
    "replay_conflict",
    "mutation_failed",
    "outcome_uncertain",
    "invalid_result",
    "timed_out",
    "interrupted",
    "resource_exceeded",
  ] as const)("decodes the closed %s failure reason", (reason) => {
    expect(Result.getOrThrow(decodeApplicationTaskMutationCallbackResultV1({
      format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
      version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
      kind: "failure",
      callId: "call-1",
      deadlineMs: 1,
      reason,
    }))).toMatchObject({ kind: "failure", reason });
  });

  it("derives one stable key preimage from scope, run, and ordinal only", () => {
    const firstAttempt = Result.getOrThrow(
      encodeApplicationTaskMutationStableKeyPreimageV1({
        scopeId: "scope-1",
        runId: "run-1",
        operationOrdinal: 7n,
      }),
    );
    const replayAttempt = Result.getOrThrow(
      encodeApplicationTaskMutationStableKeyPreimageV1({
        scopeId: "scope-1",
        runId: "run-1",
        operationOrdinal: 7n,
      }),
    );
    const nextOrdinal = Result.getOrThrow(
      encodeApplicationTaskMutationStableKeyPreimageV1({
        scopeId: "scope-1",
        runId: "run-1",
        operationOrdinal: 8n,
      }),
    );

    expect(hex(firstAttempt.canonicalBytes)).toBe(hex(replayAttempt.canonicalBytes));
    expect(hex(firstAttempt.canonicalBytes)).not.toBe(hex(nextOrdinal.canonicalBytes));
    expect(Result.isFailure(encodeApplicationTaskMutationStableKeyPreimageV1({
      scopeId: "scope-1",
      runId: "run-1",
      operationOrdinal: 7n,
      attemptId: "attempt-must-not-enter-the-stable-key",
    }))).toBe(true);
  });

  it("pins the V1 stable-key and exact-request compatibility vectors", () => {
    const stable = Result.getOrThrow(
      encodeApplicationTaskMutationStableKeyPreimageV1({
        scopeId: "scope-1",
        runId: "run-1",
        operationOrdinal: 7n,
      }),
    );
    const stableDigest = sha256(stable.canonicalBytes);
    const stableRequestKey = Result.getOrThrow(
      applicationTaskMutationRequestKeyV1FromDigest(stableDigest),
    );
    const request = Result.getOrThrow(
      encodeApplicationTaskMutationRequestIdentityPreimageV1({
        stableRequestKey,
        applicationTaskRuntimeTargetSha256: digest(1),
        functionPath: "orders:complete",
        argumentsSha256: digest(2),
        identityAccessPolicySha256: digest(3),
      }),
    );

    expect(hex(stable.canonicalBytes)).toBe(
      "666c617265782e73797374656d2f6170706c69636174696f6e2d7461736b2d" +
        "6d75746174696f6e2d737461626c652d6b65792f7631000000000773636f7065" +
        "2d310000000572756e2d310000000000000007",
    );
    expect(hex(stableDigest)).toBe(
      "e61b4721a41180bc45fe104c14caf0d2d369b90f1e47105407c4f8ca10463bf1",
    );
    expect(stableRequestKey).toBe(
      "task-mutation:v1:e61b4721a41180bc45fe104c14caf0d2d369b90f1e47105407c4f8ca10463bf1",
    );
    expect(hex(request.canonicalBytes)).toBe(
      "666c617265782e73797374656d2f6170706c69636174696f6e2d7461736b2d" +
        "6d75746174696f6e2d726571756573742f763100000000517461736b2d6d7574" +
        "6174696f6e3a76313a653631623437323161343131383062633435666531303463" +
        "313463616630643264333639623930663165343731303534303763346638636131" +
        "3034363362663101010101010101010101010101010101010101010101010101" +
        "010101010101010000000f6f72646572733a636f6d706c657465020202020202" +
        "0202020202020202020202020202020202020202020202020202030303030303" +
        "0303030303030303030303030303030303030303030303030303",
    );
    expect(hex(sha256(request.canonicalBytes))).toBe(
      "2454a698363c5aaf759b175e15c73ea74a35d6cdcb00a620e222d12803628e60",
    );
  });

  it("projects the stable digest into the existing mutation request-key contract", () => {
    const digest = sha256(Result.getOrThrow(
      encodeApplicationTaskMutationStableKeyPreimageV1({
        scopeId: "scope-1",
        runId: "run-1",
        operationOrdinal: 1n,
      }),
    ).canonicalBytes);
    const key = Result.getOrThrow(
      applicationTaskMutationRequestKeyV1FromDigest(digest),
    );

    expect(key).toMatch(/^task-mutation:v1:[0-9a-f]{64}$/);
    digest.fill(0xff);
    expect(key).not.toContain("ff".repeat(32));
  });

  it("commits every request facet while preserving the stable request key", () => {
    const stableDigest = sha256(Result.getOrThrow(
      encodeApplicationTaskMutationStableKeyPreimageV1({
        scopeId: "scope-1",
        runId: "run-1",
        operationOrdinal: 1n,
      }),
    ).canonicalBytes);
    const stableRequestKey = Result.getOrThrow(
      applicationTaskMutationRequestKeyV1FromDigest(stableDigest),
    );
    const base = {
      stableRequestKey,
      applicationTaskRuntimeTargetSha256: digest(1),
      functionPath: "orders:complete",
      argumentsSha256: digest(2),
      identityAccessPolicySha256: digest(3),
    };
    const original = Result.getOrThrow(
      encodeApplicationTaskMutationRequestIdentityPreimageV1(base),
    );

    for (const changed of [
      { ...base, applicationTaskRuntimeTargetSha256: digest(4) },
      { ...base, functionPath: "orders:cancel" },
      { ...base, argumentsSha256: digest(5) },
      { ...base, identityAccessPolicySha256: digest(6) },
    ]) {
      const changedIdentity = Result.getOrThrow(
        encodeApplicationTaskMutationRequestIdentityPreimageV1(changed),
      );
      expect(hex(sha256(changedIdentity.canonicalBytes))).not.toBe(
        hex(sha256(original.canonicalBytes)),
      );
      expect(changedIdentity.frame.stableRequestKey).toBe(stableRequestKey);
    }
  });

  it("owns digest inputs before returning identity evidence", () => {
    const runtimeTarget = digest(1);
    const argumentsDigest = digest(2);
    const identityPolicy = digest(3);
    const identity = Result.getOrThrow(
      encodeApplicationTaskMutationRequestIdentityPreimageV1({
        stableRequestKey: `task-mutation:v1:${"01".repeat(32)}`,
        applicationTaskRuntimeTargetSha256: runtimeTarget,
        functionPath: "orders:complete",
        argumentsSha256: argumentsDigest,
        identityAccessPolicySha256: identityPolicy,
      }),
    );
    const before = hex(identity.canonicalBytes);

    runtimeTarget.fill(9);
    argumentsDigest.fill(9);
    identityPolicy.fill(9);

    expect(hex(identity.canonicalBytes)).toBe(before);
    expect([...identity.frame.applicationTaskRuntimeTargetSha256]).toEqual(
      [...digest(1)],
    );
  });

  it("rejects malformed and detached identity digests", () => {
    const detached = digest(1);
    structuredClone(detached, { transfer: [detached.buffer] });
    const base = {
      stableRequestKey: `task-mutation:v1:${"01".repeat(32)}`,
      applicationTaskRuntimeTargetSha256: digest(1),
      functionPath: "orders:complete",
      argumentsSha256: digest(2),
      identityAccessPolicySha256: digest(3),
    };

    expect(Result.isFailure(
      applicationTaskMutationRequestKeyV1FromDigest(detached),
    )).toBe(true);
    expect(Result.isFailure(
      encodeApplicationTaskMutationRequestIdentityPreimageV1({
        ...base,
        argumentsSha256: detached,
      }),
    )).toBe(true);
    expect(Result.isFailure(
      encodeApplicationTaskMutationRequestIdentityPreimageV1({
        ...base,
        identityAccessPolicySha256: new Uint8Array(31),
      }),
    )).toBe(true);
    expect(Result.isFailure(
      encodeApplicationTaskMutationRequestIdentityPreimageV1({
        ...base,
        stableRequestKey: "caller-selected-key",
      }),
    )).toBe(true);
  });
});

function digest(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
