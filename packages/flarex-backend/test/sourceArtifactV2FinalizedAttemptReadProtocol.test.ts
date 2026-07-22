import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  decodeSourceArtifactV2FinalizedAttemptReadRequestV1,
  decodeSourceArtifactV2FinalizedAttemptReadResponseV1,
  decodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1,
  encodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  encodeSourceArtifactV2FinalizedAttemptReadRequestV1,
  encodeSourceArtifactV2FinalizedAttemptReadResponseV1,
  encodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1,
  type SourceArtifactV2FinalizedAttemptReadBudgetV1,
} from "../src/sourceArtifactV2/FinalizedAttemptReadProtocol";

const budget = Object.freeze({
  maximumCalls: 20,
  maximumInputBytes: 10_000,
  maximumBodyBytes: 10_000,
  maximumCanonicalBytes: 10_000,
  maximumFrameBytes: 10_000,
  maximumHashBytes: 10_000,
  maximumElapsedMilliseconds: 1_000,
}) satisfies SourceArtifactV2FinalizedAttemptReadBudgetV1;

const request = Object.freeze({
  codecVersion: 1 as const,
  sourceArtifactCodecVersion: 1 as const,
  requestId: "request-a",
  deploymentId: "deployment-a",
  uploadId: "upload-a",
  expectedGeneration: 1,
  expectedMutationFence: 9,
});

describe("source artifact v2 finalized-attempt read private codec", () => {
  it("round-trips strict canonical request and response evidence with owned bytes", () => {
    const encodedRequest = success(encodeSourceArtifactV2FinalizedAttemptReadRequestV1(
      request,
      budget,
    ));
    const callerBytes = new Uint8Array(encodedRequest.bytes);
    const decodedRequest = success(decodeSourceArtifactV2FinalizedAttemptReadRequestV1(
      callerBytes,
      budget,
    ));
    callerBytes.fill(0);
    expect(decodedRequest.value).toEqual(request);
    expect(decodedRequest.bytes).toEqual(encodedRequest.bytes);
    expect(Object.isFrozen(decodedRequest.value)).toBe(true);

    const response = Object.freeze({
      codecVersion: 1 as const,
      sourceArtifactCodecVersion: 1 as const,
      kind: "finalized" as const,
      requestId: request.requestId,
      deploymentId: request.deploymentId,
      uploadId: request.uploadId,
      expectedGeneration: request.expectedGeneration,
      expectedMutationFence: request.expectedMutationFence,
      generation: 1,
      mutationFence: 9,
      completedRootDigest: "11".repeat(32),
      completedSelectorDigest: "22".repeat(32),
    });
    const encodedResponse = success(encodeSourceArtifactV2FinalizedAttemptReadResponseV1(
      response,
      budget,
    ));
    expect(success(decodeSourceArtifactV2FinalizedAttemptReadResponseV1(
      encodedResponse.bytes,
      budget,
    )).value).toEqual(response);
  });

  it("rejects extra fields, malformed UTF-8/JSON, and noncanonical bytes", () => {
    expect(failure(encodeSourceArtifactV2FinalizedAttemptReadRequestV1({
      ...request,
      callerAuthority: true,
    }, budget)).reason).toBe("invalidInput");
    expect(failure(decodeSourceArtifactV2FinalizedAttemptReadRequestV1(
      Uint8Array.of(0xff),
      budget,
    )).reason).toBe("invalidUtf8");
    expect(failure(decodeSourceArtifactV2FinalizedAttemptReadRequestV1(
      new TextEncoder().encode("{"),
      budget,
    )).reason).toBe("invalidJson");
    const noncanonical = new TextEncoder().encode(JSON.stringify(request));
    expect(failure(decodeSourceArtifactV2FinalizedAttemptReadRequestV1(
      noncanonical,
      budget,
    )).reason).toBe("nonCanonical");
  });

  it("enforces exact and one-less codec budgets before materialization", () => {
    const encoded = success(encodeSourceArtifactV2FinalizedAttemptReadRequestV1(request, budget));
    for (const [maximum, used] of [
      ["maximumInputBytes", encoded.usage.inputBytes],
      ["maximumBodyBytes", encoded.usage.bodyBytes],
      ["maximumCanonicalBytes", encoded.usage.canonicalBytes],
      ["maximumFrameBytes", encoded.usage.frameBytes],
    ] as const) {
      expect(Result.isSuccess(encodeSourceArtifactV2FinalizedAttemptReadRequestV1(
        request,
        { ...budget, [maximum]: used },
      ))).toBe(true);
      expect(failure(encodeSourceArtifactV2FinalizedAttemptReadRequestV1(
        request,
        { ...budget, [maximum]: used - 1 },
      )).reason).toBe("budgetExhausted");
    }
  });

  it("owns exact canonical budget and usage headers", () => {
    const budgetHeader = success(encodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1(budget));
    expect(success(decodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1(budgetHeader)))
      .toEqual(budget);
    const usage = Object.freeze({
      calls: 3,
      inputBytes: 4,
      bodyBytes: 5,
      canonicalBytes: 6,
      frameBytes: 7,
      hashBytes: 8,
      elapsedMilliseconds: 9,
    });
    const usageHeader = success(encodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1(usage));
    expect(success(decodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1(usageHeader)))
      .toEqual(usage);
    expect(Result.isFailure(decodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1(
      `${budgetHeader},0`,
    ))).toBe(true);
  });
});

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function failure<A, E>(result: Result.Result<A, E>): E {
  if (Result.isSuccess(result)) throw new Error("expected failure");
  return result.failure;
}
