import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import { PartitionRequestError, PartitionResponseError } from "../src/transaction";
import {
  ExecutionRouteOperationError,
  executionRouteOperationError,
  executionRouteOperationErrorToAdapterError,
  executionRouteOperationErrorToHttpError,
} from "../src/execution/RouteOperationError";

describe("execution route operation errors", () => {
  it("preserves execution operation failures before HTTP mapping", () => {
    const cause = new HttpError(409, "Execution session is already active.");
    const startFailure = executionRouteOperationError("start", cause);

    expect(startFailure).toBeInstanceOf(ExecutionRouteOperationError);
    expect(startFailure).toMatchObject({
      operation: "start",
      status: 409,
      message: "Execution session is already active.",
      cause,
    });
    expect(executionRouteOperationErrorToHttpError(startFailure)).toMatchObject({
      status: 409,
      message: "Execution session is already active.",
    });

    const syscallFailure = executionRouteOperationError(
      "syscall",
      new Error("transaction read failed"),
    );
    expect(syscallFailure).toMatchObject({
      operation: "syscall",
      status: 500,
      message: "transaction read failed",
    });
    expect(executionRouteOperationErrorToHttpError(syscallFailure)).toMatchObject({
      status: 500,
      message: "transaction read failed",
    });

    const finishFailure = executionRouteOperationError("finish", "commit failed");
    expect(finishFailure).toMatchObject({
      operation: "finish",
      status: 500,
      message: "commit failed",
    });
    expect(executionRouteOperationErrorToHttpError(finishFailure)).toMatchObject({
      status: 500,
      message: "commit failed",
    });
  });

  it("preserves partition request failures for the invoke adapter", () => {
    const cause = new PartitionRequestError(409, {
      code: "OCC_CONFLICT",
      error: "Read set changed.",
    });
    const failure = executionRouteOperationError("finish", cause);

    expect(failure).toMatchObject({
      operation: "finish",
      status: 500,
      message: "Partition request failed with status 409.",
      cause,
    });
    expect(executionRouteOperationErrorToAdapterError(failure)).toBe(cause);
  });

  it("preserves typed partition response failures for the invoke adapter", () => {
    const cause = new PartitionResponseError({
      status: 409,
      body: {
        code: "OCC_CONFLICT",
        error: "Read set changed.",
      },
    });
    const failure = executionRouteOperationError("finish", cause);

    expect(failure).toMatchObject({
      operation: "finish",
      status: 409,
      message: "Partition request failed with status 409.",
      cause,
    });
    expect(executionRouteOperationErrorToAdapterError(failure)).toMatchObject({
      status: 409,
      body: {
        code: "OCC_CONFLICT",
        error: "Read set changed.",
      },
    });
  });
});
