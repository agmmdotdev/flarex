import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { coreQueryCheckpointPath, decodeCoreQueryCheckpointRequest, decodeCoreQueryCheckpointResponse } from "../src/core-query-checkpoint";

const route = { deploymentId: "deployment/checkpoint", scopeUuid: "45000000-0000-4000-8000-000000000001", epochUuid: "45000000-0000-4000-8000-000000000002" };
const request = { format: "flarex.core-query-checkpoint.request", version: 1, route,
  after: null, sourceId: null, maximumElapsedMilliseconds: 10_000 };
const response = { format: "flarex.core-query-checkpoint.response", version: 1, kind: "certified", route,
  after: "10", sourceId: "aa".repeat(32), retainedFrom: "5", through: "20000000" };

describe("Core query checkpoint source protocol", () => {
  it("captures fresh and sparse retained intervals without assuming dense commits", () => {
    const captured = Result.getOrThrow(decodeCoreQueryCheckpointRequest(request));
    expect(captured.after).toBeNull();
    expect(Object.isFrozen(captured.route)).toBe(true);
    expect(Result.getOrThrow(decodeCoreQueryCheckpointResponse(response))).toEqual(response);
    expect(coreQueryCheckpointPath(route.deploymentId)).toBe("/applications/deployment%2Fcheckpoint/query-checkpoint");
  });
  it.each([
    { ...request, after: "10" }, { ...request, sourceId: "aa".repeat(32) },
    { ...request, after: "01", sourceId: "aa".repeat(32) }, { ...request, after: "9223372036854775808", sourceId: "aa".repeat(32) },
    { ...request, maximumElapsedMilliseconds: 0 }, { ...request, maximumElapsedMilliseconds: 10001 },
    { ...request, maximumElapsedMilliseconds: 1.5 }, { ...request, extra: true },
    { ...request, route: { ...route, scopeUuid: route.scopeUuid.toUpperCase() + "A" } },
  ])("rejects malformed or incomplete checkpoint request %#", value => {
    expect(Result.isFailure(decodeCoreQueryCheckpointRequest(value))).toBe(true);
  });
  it.each([
    { ...response, retainedFrom: "11" }, { ...response, through: "9" },
    { ...response, kind: "historyUnavailable", retainedFrom: "10" },
    { ...response, kind: "historyUnavailable", after: null },
    { ...response, kind: "unknown" }, { ...response, sourceId: "AA".repeat(32) },
    { ...response, retainedFrom: "20000001" }, { ...response, extra: true },
  ])("rejects contradictory source evidence %#", value => {
    expect(Result.isFailure(decodeCoreQueryCheckpointResponse(value))).toBe(true);
  });
  it("preserves explicit history loss and independent old-source positions", () => {
    expect(Result.isSuccess(decodeCoreQueryCheckpointResponse({ ...response, kind: "historyUnavailable", retainedFrom: "11" }))).toBe(true);
    expect(Result.isSuccess(decodeCoreQueryCheckpointResponse({ ...response, kind: "sourceReplaced", after: "20000001" }))).toBe(true);
  });
});
