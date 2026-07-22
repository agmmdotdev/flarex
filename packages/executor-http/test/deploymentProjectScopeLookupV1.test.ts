import { describe, expect, it } from "vitest";
import { Result } from "effect";

import {
  decodeDeploymentProjectScopeLookupBudgetHeaderV1,
  decodeDeploymentProjectScopeLookupBudgetFailureHeaderV1,
  decodeDeploymentProjectScopeLookupRequestV1,
  decodeDeploymentProjectScopeLookupResponseV1,
  encodeDeploymentProjectScopeLookupBudgetHeaderV1,
  encodeDeploymentProjectScopeLookupBudgetFailureHeaderV1,
  encodeDeploymentProjectScopeLookupRequestV1,
  encodeDeploymentProjectScopeLookupResponseV1,
  type DeploymentProjectScopeLookupBudgetV1,
} from "../src/deploymentProjectScopeLookupV1";

const generousBudget = Object.freeze({
  maximumLookupCalls: 1,
  maximumInputBytes: 4_096,
  maximumBodyBytes: 4_096,
  maximumCanonicalBytes: 4_096,
  maximumFrameBytes: 4_096,
  maximumElapsedMilliseconds: 1_000,
}) satisfies DeploymentProjectScopeLookupBudgetV1;

describe("deployment project-scope lookup V1 codec", () => {
  it("round-trips strict canonical request and response evidence", () => {
    const request = unwrap(encodeDeploymentProjectScopeLookupRequestV1({
      codecVersion: 1,
      deploymentId: "deployment-a",
      projectId: "project-a",
    }, generousBudget));
    const decodedRequest = unwrap(
      decodeDeploymentProjectScopeLookupRequestV1(request.bytes, generousBudget),
    );
    expect(decodedRequest.value).toEqual(request.value);
    expect(decodedRequest.bytes).not.toBe(request.bytes);

    const response = unwrap(encodeDeploymentProjectScopeLookupResponseV1({
      codecVersion: 1,
      kind: "matched",
      deploymentId: "deployment-a",
      projectId: "project-a",
      deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
    }, generousBudget));
    expect(unwrap(
      decodeDeploymentProjectScopeLookupResponseV1(response.bytes, generousBudget),
    ).value).toEqual(response.value);
  });

  it("rejects extra fields, noncanonical bytes, invalid UTF-8, and mismatched response shapes", () => {
    expect(Result.isFailure(encodeDeploymentProjectScopeLookupRequestV1({
      codecVersion: 1,
      deploymentId: "deployment-a",
      projectId: "project-a",
      extra: true,
    }, generousBudget))).toBe(true);
    expect(Result.isFailure(decodeDeploymentProjectScopeLookupRequestV1(
      new TextEncoder().encode(
        '{"projectId":"project-a", "deploymentId":"deployment-a","codecVersion":1}',
      ),
      generousBudget,
    ))).toBe(true);
    expect(Result.isFailure(decodeDeploymentProjectScopeLookupRequestV1(
      Uint8Array.of(0xff),
      generousBudget,
    ))).toBe(true);
    expect(Result.isFailure(encodeDeploymentProjectScopeLookupResponseV1({
      codecVersion: 1,
      kind: "matched",
      deploymentId: "deployment-a",
      deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
    }, generousBudget))).toBe(true);
  });

  it("uses a strict canonical six-field budget header", () => {
    const header = unwrap(encodeDeploymentProjectScopeLookupBudgetHeaderV1(generousBudget));
    expect(header).toBe("1,4096,4096,4096,4096,1000");
    expect(unwrap(decodeDeploymentProjectScopeLookupBudgetHeaderV1(header))).toEqual(
      generousBudget,
    );
    for (const malformed of [null, "1,2", "01,2,3,4,5,6", "1,-1,3,4,5,6"]) {
      expect(Result.isFailure(
        decodeDeploymentProjectScopeLookupBudgetHeaderV1(malformed),
      )).toBe(true);
    }
  });

  it("round-trips only exact budget-failure fields", () => {
    for (const field of [
      "lookupCalls",
      "inputBytes",
      "bodyBytes",
      "canonicalBytes",
      "frameBytes",
      "elapsedMilliseconds",
    ] as const) {
      const encoded = unwrap(encodeDeploymentProjectScopeLookupBudgetFailureHeaderV1(field));
      expect(unwrap(
        decodeDeploymentProjectScopeLookupBudgetFailureHeaderV1(encoded),
      )).toBe(field);
    }
    for (const malformed of [null, "maximumBodyBytes", "bodybytes", " bodyBytes"] ) {
      expect(Result.isFailure(
        decodeDeploymentProjectScopeLookupBudgetFailureHeaderV1(malformed),
      )).toBe(true);
    }
  });

  it("reports exact inclusive input/body/canonical/frame budget boundaries", () => {
    const encoded = unwrap(encodeDeploymentProjectScopeLookupRequestV1({
      codecVersion: 1,
      deploymentId: "deployment-budget",
      projectId: "project-budget",
    }, generousBudget));
    const exact = Object.freeze({
      ...generousBudget,
      maximumInputBytes: encoded.usage.inputBytes,
      maximumBodyBytes: encoded.usage.bodyBytes,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
      maximumFrameBytes: encoded.usage.frameBytes,
    });
    expect(Result.isSuccess(decodeDeploymentProjectScopeLookupRequestV1(
      encoded.bytes,
      exact,
    ))).toBe(true);
    for (const field of [
      "maximumInputBytes",
      "maximumBodyBytes",
      "maximumCanonicalBytes",
      "maximumFrameBytes",
    ] as const) {
      expect(Result.isFailure(decodeDeploymentProjectScopeLookupRequestV1(
        encoded.bytes,
        { ...exact, [field]: exact[field] - 1 },
      ))).toBe(true);
    }
  });

  it("copies caller bytes without consulting an overridden iterator", () => {
    const encoded = unwrap(encodeDeploymentProjectScopeLookupRequestV1({
      codecVersion: 1,
      deploymentId: "deployment-owned",
      projectId: "project-owned",
    }, generousBudget));
    Object.defineProperty(encoded.bytes, Symbol.iterator, {
      value: () => {
        throw new Error("caller iterator must not run");
      },
    });
    const decoded = unwrap(
      decodeDeploymentProjectScopeLookupRequestV1(encoded.bytes, generousBudget),
    );
    encoded.bytes.fill(0);
    expect(decoded.value.deploymentId).toBe("deployment-owned");
  });
});

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
