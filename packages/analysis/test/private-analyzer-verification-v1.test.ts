import { createHash } from "node:crypto";
import { Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";
import * as AnalysisRoot from "../src/index";
import {
  canonicalPrivateAnalyzerVerificationModuleHeaderV1,
  canonicalPrivateAnalyzerVerificationRequestHeaderV1,
  canonicalPrivateAnalyzerVerificationRequestIdentityPreimageV1,
  canonicalPrivateAnalyzerVerificationResponseHeaderV1,
  canonicalPrivateAnalyzerVerificationResultIdentityPreimageV1,
  decodePrivateAnalyzerVerificationFrameV1,
  decodePrivateAnalyzerVerificationModuleHeaderV1,
  decodePrivateAnalyzerVerificationRequestHeaderV1,
  decodePrivateAnalyzerVerificationResponseHeaderV1,
  encodePrivateAnalyzerVerificationFrameV1,
  installedPrivateAnalyzerVerifierIdentitiesV1,
  PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1,
  type PrivateAnalyzerVerificationRequestHeaderV1,
} from "../src/privateAnalyzerVerificationV1";
import { installedPrivateAnalyzerReleaseTupleV1 } from "../src/privateAnalyzerReleaseV1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

function budget(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze(Object.fromEntries([
    ["kind", kind],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
      dimension => [dimension, 100_000n] as const,
    ),
  ])) as DeclarativeV2VerifierBudgetFrameV2;
}

function requestHeader(): PrivateAnalyzerVerificationRequestHeaderV1 {
  const withoutIdentity = Object.freeze({
    kind: "private_analyzer_verification_request_v1" as const,
    protocolIdentity: "flarex.private-source-analyzer-verification.v1" as const,
    protocolVersion: 1 as const,
    release: installedPrivateAnalyzerReleaseTupleV1(),
    moduleManifestSha256: digest("modules"),
    semanticContentSha256: digest("semantic"),
    pins: Object.freeze({
      projectId: "project",
      deploymentId: "deployment",
      deploymentCreatedAt: "2026-07-25T00:00:00.000Z",
      sourceUploadId: "source-upload",
      sourceGeneration: 1,
      sourceMutationFence: 2,
      sourceRootSha256: digest("source-root"),
      sourceSelectorSha256: digest("source-selector"),
      semanticUploadId: "semantic-upload",
      semanticGeneration: 3,
      semanticMutationFence: 4,
      semanticRootSha256: digest("semantic-root"),
      semanticSelectorSha256: digest("semantic-selector"),
      semanticAttemptIdentitySha256: digest("semantic-attempt"),
    }),
    moduleCount: 1,
    semanticByteLength: 0,
    maximums: budget("command_budget"),
    required: budget("attempt_usage"),
    linkerMaximums: budget("command_budget"),
    linkerRequired: budget("attempt_usage"),
    hostMaximums: budget("command_budget"),
    hostRequired: budget("attempt_usage"),
    verifier: installedPrivateAnalyzerVerifierIdentitiesV1(),
  });
  return Object.freeze({
    ...withoutIdentity,
    requestIdentitySha256: digest(
      canonicalPrivateAnalyzerVerificationRequestIdentityPreimageV1(
        withoutIdentity,
      ),
    ),
  });
}

describe("private analyzer verification V1", () => {
  it("round-trips canonical request, module, response, and identity preimages", () => {
    const request = requestHeader();
    const requestBytes = canonicalPrivateAnalyzerVerificationRequestHeaderV1(request);
    const decodedRequest = decodePrivateAnalyzerVerificationRequestHeaderV1(
      requestBytes,
      request.release,
    );
    expect(Result.isSuccess(decodedRequest)).toBe(true);
    if (Result.isFailure(decodedRequest)) return;
    expect(decodedRequest.success).toEqual(request);
    expect(Object.isFrozen(decodedRequest.success)).toBe(true);

    const module = Object.freeze({
      kind: "private_analyzer_verification_module_v1" as const,
      ordinal: 0,
      roles: 1,
      modulePath: "functions/example.js",
      sourceByteLength: 24,
      sourceSha256: digest("source"),
      frameSha256: digest("frame"),
      maximums: budget("command_budget"),
      required: budget("attempt_usage"),
    });
    expect(decodePrivateAnalyzerVerificationModuleHeaderV1(
      canonicalPrivateAnalyzerVerificationModuleHeaderV1(module),
    )).toMatchObject({ success: module });

    const resultFields = Object.freeze({
      kind: "private_analyzer_verification_response_v1" as const,
      protocolIdentity: request.protocolIdentity,
      protocolVersion: request.protocolVersion,
      requestIdentitySha256: request.requestIdentitySha256,
      evidenceSha256: digest("evidence"),
      verified: true,
      moduleCount: 1,
      evidenceCount: 2,
      diagnosticCount: 0,
    });
    const response = Object.freeze({
      ...resultFields,
      resultIdentitySha256: digest(
        canonicalPrivateAnalyzerVerificationResultIdentityPreimageV1(resultFields),
      ),
    });
    expect(decodePrivateAnalyzerVerificationResponseHeaderV1(
      canonicalPrivateAnalyzerVerificationResponseHeaderV1(response),
      request.requestIdentitySha256,
    )).toMatchObject({ success: response });
  });

  it("rejects noncanonical, hostile, identity-mismatched, and truncated frames", () => {
    const request = requestHeader();
    const pretty = encoder.encode(
      JSON.stringify(JSON.parse(
        decoder.decode(canonicalPrivateAnalyzerVerificationRequestHeaderV1(request)),
      ), null, 2),
    );
    expect(decodePrivateAnalyzerVerificationRequestHeaderV1(
      pretty,
      request.release,
    )).toMatchObject({ failure: { reason: "nonCanonical" } });
    expect(decodePrivateAnalyzerVerificationRequestHeaderV1(
      canonicalPrivateAnalyzerVerificationRequestHeaderV1(request),
      { ...request.release, implementationIdentity: "f".repeat(64) },
    )).toMatchObject({ failure: { reason: "malformed" } });
    const revoked = Proxy.revocable(new Uint8Array(0), {});
    revoked.revoke();
    expect(decodePrivateAnalyzerVerificationRequestHeaderV1(
      revoked.proxy,
      request.release,
    )).toMatchObject({ failure: { reason: "invalidInput" } });

    const encodedFrame = encodePrivateAnalyzerVerificationFrameV1(
      "moduleBytes",
      encoder.encode("abc"),
    );
    if (Result.isFailure(encodedFrame)) throw encodedFrame.failure;
    const frame = encodedFrame.success;
    expect(decodePrivateAnalyzerVerificationFrameV1(frame)).toMatchObject({
      success: { kind: "moduleBytes", payload: encoder.encode("abc") },
    });
    expect(decodePrivateAnalyzerVerificationFrameV1(frame.subarray(0, 6)))
      .toMatchObject({ failure: { reason: "malformed" } });
  });

  it("pins exact and plus-one frame admission and owned payload bytes", () => {
    const exactPayload = new Uint8Array(
      PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1,
    ).fill(7);
    const encodedResult = encodePrivateAnalyzerVerificationFrameV1(
      "evidence",
      exactPayload,
    );
    if (Result.isFailure(encodedResult)) throw encodedResult.failure;
    const encoded = encodedResult.success;
    exactPayload.fill(0);
    const decoded = decodePrivateAnalyzerVerificationFrameV1(encoded);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success.payload[0]).toBe(7);
      decoded.success.payload.fill(9);
      expect(decodePrivateAnalyzerVerificationFrameV1(encoded))
        .toMatchObject({ success: { payload: expect.objectContaining({ 0: 7 }) } });
    }
    expect(encodePrivateAnalyzerVerificationFrameV1(
      "evidence",
      new Uint8Array(PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1 + 1),
    )).toMatchObject({ failure: { reason: "budgetExceeded" } });
    const detached = new Uint8Array([1]);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(encodePrivateAnalyzerVerificationFrameV1("evidence", detached))
      .toMatchObject({ failure: { reason: "invalidInput" } });
  });

  it("keeps the verification contract off the analysis package root", () => {
    expect("PRIVATE_ANALYZER_VERIFICATION_PATH_V1" in AnalysisRoot).toBe(false);
    expect("makeDeclarativeV2VerifierResultAccessFactoryV1" in AnalysisRoot)
      .toBe(false);
  });
});
