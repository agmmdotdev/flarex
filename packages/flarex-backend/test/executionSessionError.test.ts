import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  ExecutionSessionError,
  executionSessionError,
  executionSessionErrorToHttpError,
  requireActiveExecutionSession,
  requireExecutionKindMatch,
  requireMutationExecution,
  requireNoActiveExecutionSession,
} from "../src/execution/SessionError";

describe("execution session errors", () => {
  it("preserves typed session failures before HTTP mapping", () => {
    const error = executionSessionError(
      "syscall",
      { _tag: "MissingSession" },
    );

    expect(error).toBeInstanceOf(ExecutionSessionError);
    expect(error).toMatchObject({
      _tag: "ExecutionSessionError",
      operation: "syscall",
      reason: {
        _tag: "MissingSession",
      },
    });
    expect(executionSessionErrorToHttpError(error)).toMatchObject({
      name: "HttpError",
      status: 409,
      message: "Execution session has not started.",
    });
  });

  it("fails through the typed channel when a session is missing", async () => {
    const error = await Effect.runPromise(Effect.flip(
      requireActiveExecutionSession("finish", null),
    ));

    expect(error).toMatchObject({
      _tag: "ExecutionSessionError",
      operation: "finish",
      reason: {
        _tag: "MissingSession",
      },
    });
  });

  it("fails through the typed channel when a session is already active", async () => {
    const error = await Effect.runPromise(Effect.flip(
      requireNoActiveExecutionSession("start", { active: true }),
    ));

    expect(error).toMatchObject({
      _tag: "ExecutionSessionError",
      operation: "start",
      reason: {
        _tag: "ActiveSession",
      },
    });
  });

  it("fails through the typed channel when execution kind mismatches", async () => {
    const error = await Effect.runPromise(Effect.flip(
      requireExecutionKindMatch("start", "query", "mutation"),
    ));

    expect(error).toMatchObject({
      _tag: "ExecutionSessionError",
      operation: "start",
      reason: {
        _tag: "FunctionKindMismatch",
        requestKind: "query",
        functionKind: "mutation",
      },
    });
    expect(executionSessionErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "Function kind mismatch. Request has query, function is mutation.",
    });
  });

  it("fails through the typed channel for mutation-only syscalls in query sessions", async () => {
    const error = await Effect.runPromise(Effect.flip(
      requireMutationExecution("syscall", "query", "insert"),
    ));

    expect(error).toMatchObject({
      _tag: "ExecutionSessionError",
      operation: "syscall",
      reason: {
        _tag: "MutationOnlySyscall",
        syscall: "insert",
        executionKind: "query",
      },
    });
    expect(executionSessionErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "Cannot run insert during query execution.",
    });
  });
});
