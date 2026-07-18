import { describe, expect, it } from "vitest";

import { HttpError } from "../src/http";
import {
  executionArtifactRuntimeOperationErrorFromUnknown,
} from "../src/artifactRuntime/OperationError";

describe("executionArtifactRuntimeOperationErrorFromUnknown", () => {
  it.each([
    [new HttpError(503, "Runtime unavailable."), 503],
    [new HttpError(503.5, "Runtime unavailable."), 503.5],
    [Object.assign(new Error("Runtime unavailable."), { status: 504 }), 504],
    [Object.assign([], { status: 429 }), 429],
    [Object.assign(new Error("Runtime unavailable."), { status: 503.5 }), 500],
    ["Runtime unavailable.", 500],
  ])("maps a foreign cause with status %s", (cause, expectedStatus) => {
    const error = executionArtifactRuntimeOperationErrorFromUnknown(
      "runtimeFetch",
      cause,
    );

    expect(error).toMatchObject({
      _tag: "ExecutionArtifactRuntimeOperationError",
      operation: "runtimeFetch",
      status: expectedStatus,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
    expect(error.cause).toBe(cause);
  });

  it("falls back without replacing an uninspectable cause", () => {
    for (const cause of [Object.create(null), revokedProxy()]) {
      const error = executionArtifactRuntimeOperationErrorFromUnknown(
        "materialize",
        cause,
      );

      expect(error).toMatchObject({
        _tag: "ExecutionArtifactRuntimeOperationError",
        operation: "materialize",
        status: 500,
        message: "Execution artifact runtime operation failed.",
      });
      expect(error.cause).toBe(cause);
    }
  });
});

function revokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}
