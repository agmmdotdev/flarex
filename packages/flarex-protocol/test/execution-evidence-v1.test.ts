import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1,
  APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1,
  EXTERNAL_EFFECT_ATTEMPT_IDENTITY_V1,
  EXTERNAL_EFFECT_EXECUTION_SUBJECT_IDENTITY_V1,
  decodeApplicationActionInvocationOutcomeV1,
  decodeApplicationActionInvocationRequestV1,
  decodeExecutionEvidenceBodyReferenceV1,
  decodeExternalEffectAttemptV1,
  decodeExternalEffectExecutionSubjectV1,
  encodeApplicationActionInvocationOutcomeV1,
  encodeApplicationActionInvocationRequestV1,
  encodeExternalEffectAttemptV1,
  encodeExternalEffectExecutionSubjectV1,
  makeExecutionEvidenceBodyReferenceV1,
} from "../src/execution-evidence-v1";

const digest = (seed: number) => new Uint8Array(32).fill(seed);
const required = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
};

describe("AAV-A1 execution evidence protocol", () => {
  it("pins the four private identities and deterministic R2 references", () => {
    expect(APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1).toBe(
      "flarex.system/application-action-invocation-request/v1",
    );
    expect(APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1).toBe(
      "flarex.system/application-action-invocation-outcome/v1",
    );
    expect(EXTERNAL_EFFECT_EXECUTION_SUBJECT_IDENTITY_V1).toBe(
      "flarex.system/external-effect-execution-subject/v1",
    );
    expect(EXTERNAL_EFFECT_ATTEMPT_IDENTITY_V1).toBe(
      "flarex.system/external-effect-attempt/v1",
    );
    const reference = required(makeExecutionEvidenceBodyReferenceV1(
      "action_arguments",
      digest(1),
      17,
    ));
    expect(reference).toMatchObject({
      storeIdentity: "flarex.r2/execution-evidence-body/v1",
      codecIdentity: "flarex.codec/canonical-flarex-value/v1",
      byteLength: 17n,
    });
    expect(reference.objectKey).toBe(
      `execution-evidence-body/v1/action_arguments/${"01".repeat(32)}`,
    );
  });

  it("round-trips the canonical request and outcome vectors", () => {
    const argumentsReference = required(makeExecutionEvidenceBodyReferenceV1(
      "action_arguments",
      digest(2),
      19,
    ));
    const request = required(encodeApplicationActionInvocationRequestV1({
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      requestKey: "request-1",
      applicationRevisionId: "revision-1",
      candidateSha256: digest(3),
      actionFunctionPath: "payments:charge",
      actionBindingSha256: digest(4),
      executionIdentitySha256: digest(5),
      compatibilityDate: "2026-08-04",
      hostPolicySha256: digest(6),
      arguments: argumentsReference,
    }));
    const decoded = required(
      decodeApplicationActionInvocationRequestV1(request.canonicalBytes),
    );
    expect(decoded.canonicalBytes).toEqual(request.canonicalBytes);
    expect(decoded.frame.arguments.sha256).not.toBe(argumentsReference.sha256);
    expect(new TextDecoder().decode(request.canonicalBytes)).toContain(
      `${APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1}\0`,
    );

    const resultReference = required(makeExecutionEvidenceBodyReferenceV1(
      "action_result",
      digest(7),
      23,
    ));
    const outcome = required(encodeApplicationActionInvocationOutcomeV1({
      status: "completed",
      invocationId: "00000000-0000-4000-8000-000000000010",
      requestIdentitySha256: digest(8),
      result: resultReference,
    }));
    expect(required(
      decodeApplicationActionInvocationOutcomeV1(outcome.canonicalBytes),
    ).canonicalBytes).toEqual(outcome.canonicalBytes);
  });

  it("keeps direct-action and durable-task subjects domain-distinct", () => {
    const direct = required(encodeExternalEffectExecutionSubjectV1({
      kind: "direct_action",
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      invocationId: "same-text",
      requestIdentitySha256: digest(9),
    }));
    const task = required(encodeExternalEffectExecutionSubjectV1({
      kind: "durable_task_attempt",
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      runId: "same-text",
      attemptId: "same-text",
      taskDefinitionRevisionSha256: digest(9),
    }));
    expect(direct.canonicalBytes).not.toEqual(task.canonicalBytes);
    expect(required(
      decodeExternalEffectExecutionSubjectV1(direct.canonicalBytes),
    ).frame.kind).toBe("direct_action");
    expect(required(
      decodeExternalEffectExecutionSubjectV1(task.canonicalBytes),
    ).frame.kind).toBe("durable_task_attempt");
  });

  it("round-trips both effect kinds and rejects perturbations", () => {
    const subject = {
      kind: "direct_action" as const,
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      invocationId: "00000000-0000-4000-8000-000000000010",
      requestIdentitySha256: digest(10),
    };
    const request = required(makeExecutionEvidenceBodyReferenceV1(
      "outbound_http_request",
      digest(11),
      31,
    ));
    const http = required(encodeExternalEffectAttemptV1({
      subject,
      subjectFence: 1n,
      effectOrdinal: 1n,
      effectKind: "outbound_http",
      stableEffectKey: "effect-1",
      requestIdentitySha256: digest(12),
      outboundHttpRequest: request,
      childMutationRequestKey: null,
      childMutationFunctionPath: null,
      childMutationArgumentsSha256: null,
    }));
    expect(required(decodeExternalEffectAttemptV1(http.canonicalBytes)).frame)
      .toMatchObject({ subjectFence: 1n, effectOrdinal: 1n });

    const child = required(encodeExternalEffectAttemptV1({
      subject,
      subjectFence: 2n,
      effectOrdinal: 2n,
      effectKind: "child_mutation",
      stableEffectKey: "effect-2",
      requestIdentitySha256: digest(13),
      outboundHttpRequest: null,
      childMutationRequestKey: "child-1",
      childMutationFunctionPath: "orders:reserve",
      childMutationArgumentsSha256: digest(14),
    }));
    expect(required(decodeExternalEffectAttemptV1(child.canonicalBytes)).frame)
      .toMatchObject({ effectKind: "child_mutation", effectOrdinal: 2n });

    const altered = child.canonicalBytes.slice();
    altered[0] = 0;
    expect(Result.isFailure(decodeExternalEffectAttemptV1(altered))).toBe(true);
    expect(Result.isFailure(encodeExternalEffectAttemptV1({
      subject,
      subjectFence: 0n,
      effectOrdinal: 1n,
      effectKind: "outbound_http",
      stableEffectKey: "effect",
      requestIdentitySha256: digest(1),
      outboundHttpRequest: request,
      childMutationRequestKey: null,
      childMutationFunctionPath: null,
      childMutationArgumentsSha256: null,
    }))).toBe(true);
  });

  it("classifies malformed decoded fields at the decode boundary", () => {
    const encoded = required(encodeApplicationActionInvocationOutcomeV1({
      status: "completed",
      invocationId: "00000000-0000-4000-8000-000000000010",
      requestIdentitySha256: digest(15),
      result: required(makeExecutionEvidenceBodyReferenceV1(
        "action_result",
        digest(16),
        29,
      )),
    }));
    const text = new TextDecoder().decode(encoded.canonicalBytes);
    const separator = text.indexOf("\0");
    const projection = JSON.parse(text.slice(separator + 1)) as unknown[];
    projection[2] = "not-a-digest";
    const malformed = new TextEncoder().encode(
      `${APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1}\0${JSON.stringify(projection)}`,
    );
    const decoded = decodeApplicationActionInvocationOutcomeV1(malformed);
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(decoded.failure.operation).toBe("decode");
      expect(decoded.failure.reason).toBe("malformed");
      expect(decoded.failure.path).toBe("requestIdentitySha256");
    }

    const reference = required(makeExecutionEvidenceBodyReferenceV1(
      "outbound_http_request",
      digest(17),
      31,
    ));
    const invalidReference = decodeExecutionEvidenceBodyReferenceV1({
      ...reference,
      codecIdentity: "flarex.codec/canonical-http-response/v1",
    });
    expect(Result.isFailure(invalidReference)).toBe(true);
    if (Result.isFailure(invalidReference)) {
      expect(invalidReference.failure.operation).toBe("reference");
      expect(invalidReference.failure.path).toBe("codecIdentity");
    }
  });
});
