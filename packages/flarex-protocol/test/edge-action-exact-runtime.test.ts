import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeEdgeActionExactRuntimeRequestV1Effect,
  decodeEdgeActionExactRuntimeResultV1Effect,
  edgeActionChildMutationRequestKeyV1FromDigest,
  EDGE_ACTION_CHILD_MUTATION_REQUEST_KEY_PREFIX_V1,
  EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
  EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
} from "../src/edge-action-exact-runtime";
import {
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
} from "../src/edge-action-host-policy-v1";
import { normalizeFlarexValueV1 } from "../src/value";

describe("edge action exact runtime protocol", () => {
  it("captures an exact request with owned auth and digest bytes", async () => {
    const input = request();
    const decoded = await Effect.runPromise(
      decodeEdgeActionExactRuntimeRequestV1Effect(input),
    );
    input.context.randomSeed.fill(99);
    input.auth.user.subject = "mutated";
    expect(decoded.context.randomSeed[0]).toBe(7);
    expect(decoded.auth).toMatchObject({
      kind: "user",
      user: { subject: "user-1" },
    });
    expect(Object.isFrozen(decoded.auth.kind === "user" && decoded.auth.user))
      .toBe(true);
  });

  it("rejects semantic-size and policy-digest perturbations", async () => {
    await expect(Effect.runPromise(
      decodeEdgeActionExactRuntimeRequestV1Effect({
        ...request(),
        argumentSemanticBytes: 999,
      }),
    )).rejects.toMatchObject({ reason: "argumentSizeMismatch" });
    await expect(Effect.runPromise(
      decodeEdgeActionExactRuntimeRequestV1Effect({
        ...request(),
        context: { ...request().context, hostPolicySha256: new Uint8Array(31) },
      }),
    )).rejects.toMatchObject({ reason: "invalidShape", path: "context" });
  });

  it("normalizes exact results and rejects extra fields", async () => {
    const result = await Effect.runPromise(
      decodeEdgeActionExactRuntimeResultV1Effect({
        format: EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
        version: EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
        value: { ok: true },
      }),
    );
    expect(result.value).toEqual({ ok: true });
    await expect(Effect.runPromise(
      decodeEdgeActionExactRuntimeResultV1Effect({ ...result, extra: true }),
    )).rejects.toMatchObject({ reason: "invalidShape" });
  });

  it("projects owned bounded child mutation request keys from exact digests", () => {
    const digest = Uint8Array.from({ length: 32 }, (_, index) => index);
    const requestKey = Result.getOrThrow(
      edgeActionChildMutationRequestKeyV1FromDigest(digest),
    );
    expect(requestKey).toBe(
      `${EDGE_ACTION_CHILD_MUTATION_REQUEST_KEY_PREFIX_V1}` +
        "000102030405060708090a0b0c0d0e0f" +
        "101112131415161718191a1b1c1d1e1f",
    );
    digest.fill(255);
    expect(requestKey.endsWith("1c1d1e1f")).toBe(true);
    expect(Result.getOrThrow(
      edgeActionChildMutationRequestKeyV1FromDigest(digest),
    )).not.toBe(requestKey);
  });

  it("rejects malformed and detached child mutation request-key digests", () => {
    for (const invalid of [
      undefined,
      {},
      new Uint8Array(31),
      new Uint8Array(33),
    ]) {
      expect(Result.isFailure(
        edgeActionChildMutationRequestKeyV1FromDigest(invalid),
      )).toBe(true);
    }
    const detached = new Uint8Array(32);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(Result.isFailure(
      edgeActionChildMutationRequestKeyV1FromDigest(detached),
    )).toBe(true);
  });
});

function request() {
  const argumentsValue = { orderId: "order-1" };
  return {
    format: EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1,
    version: EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    artifact: {
      runtime: "dynamic-worker",
      artifactId: `artifact_${"a".repeat(32)}`,
      sourcePackageHash: "a".repeat(64),
      executionModule: "flarexCandidateBoundEdgeActionRuntime/execution-v1.js",
    },
    function: {
      path: "orders:place",
      executionModule: "flarexCandidateBoundEdgeActionRuntime/execution-v1.js",
      kind: "action",
      visibility: "public",
      argsValidator: { type: "object", value: {} },
      returnsValidator: null,
    },
    auth: {
      kind: "user",
      user: {
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "issuer",
      },
    },
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
      .semanticSizeBytes,
    context: {
      executionId: "execution-1",
      invocationId: "invocation-1",
      executionGeneration: 1n,
      executionTime: 1_800_000_000_000,
      executionDeadline: 1_800_000_030_000,
      randomSeed: new Uint8Array(32).fill(7),
      runtimeTargetSha256: new Uint8Array(32).fill(8),
      hostPolicySha256: new Uint8Array(32).fill(9),
    },
  };
}
