import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
  APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
  MAX_APPLICATION_TASK_QUERY_FUNCTION_PATH_BYTES_V1,
  decodeApplicationTaskQueryCallbackRequestV1,
  decodeApplicationTaskQueryCallbackResultV1,
  normalizeApplicationTaskQueryCallbackValueV1,
} from "../src/application-task-query-callback-v1";

describe("Application Task query callback V1", () => {
  it("owns one exact canonical request and success result", () => {
    const argumentsValue = Result.getOrThrow(
      normalizeApplicationTaskQueryCallbackValueV1({ orderId: "order-1" }, "request"),
    );
    const request = Result.getOrThrow(decodeApplicationTaskQueryCallbackRequestV1({
      format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
      version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
      operation: "runQuery",
      functionPath: "orders:get",
      arguments: argumentsValue.value,
      argumentSemanticBytes: argumentsValue.semanticSizeBytes,
    }));
    const result = Result.getOrThrow(decodeApplicationTaskQueryCallbackResultV1({
      format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
      version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
      kind: "success",
      callId: "execution-1:query:1",
      deadlineMs: 1_000,
      value: request.arguments,
      valueSemanticBytes: request.argumentSemanticBytes,
    }));

    expect(result).toMatchObject({
      kind: "success",
      callId: "execution-1:query:1",
      value: { orderId: "order-1" },
    });
  });

  it.each([
    ["blank path", { functionPath: " " }],
    ["oversized path", {
      functionPath: "x".repeat(MAX_APPLICATION_TASK_QUERY_FUNCTION_PATH_BYTES_V1 + 1),
    }],
    ["size drift", { argumentSemanticBytes: 1 }],
    ["excess member", { unexpected: true }],
  ])("rejects %s before authority dispatch", (_label, override) => {
    const normalized = Result.getOrThrow(
      normalizeApplicationTaskQueryCallbackValueV1({}, "request"),
    );
    expect(Result.isFailure(decodeApplicationTaskQueryCallbackRequestV1({
      format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
      version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
      operation: "runQuery",
      functionPath: "orders:get",
      arguments: normalized.value,
      argumentSemanticBytes: normalized.semanticSizeBytes,
      ...override,
    }))).toBe(true);
  });

  it("rejects getter-backed and malformed callback results", () => {
    let getterCalled = false;
    const hostile = Object.defineProperty({}, "format", {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error("must not run");
      },
    });
    expect(Result.isFailure(decodeApplicationTaskQueryCallbackResultV1(hostile)))
      .toBe(true);
    expect(getterCalled).toBe(false);
    expect(Result.isFailure(decodeApplicationTaskQueryCallbackResultV1({
      format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
      version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
      kind: "failure",
      callId: "call-1",
      deadlineMs: 1,
      reason: "unknown",
    }))).toBe(true);
  });
});
