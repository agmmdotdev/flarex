import { Data, Effect } from "effect";
import { HttpError } from "../http";
import type { BackendFunctionKind, DeploymentFunctionKind } from "../types";
import type { ExecutionRouteOperation } from "./RouteOperationError";

export type ExecutionSessionErrorReason =
  | { readonly _tag: "ActiveSession" }
  | { readonly _tag: "MissingSession" }
  | {
      readonly _tag: "UnsupportedFunctionKind";
      readonly functionKind: DeploymentFunctionKind;
    }
  | {
      readonly _tag: "FunctionKindMismatch";
      readonly requestKind: BackendFunctionKind;
      readonly functionKind: BackendFunctionKind;
    }
  | {
      readonly _tag: "ArgumentValidation";
      readonly message: string;
    }
  | {
      readonly _tag: "MutationOnlySyscall";
      readonly syscall: string;
      readonly executionKind: BackendFunctionKind;
    }
  | {
      readonly _tag: "UnsupportedSyscall";
      readonly syscall: string;
    };

export class ExecutionSessionError extends Data.TaggedError("ExecutionSessionError")<{
  readonly operation: ExecutionRouteOperation;
  readonly reason: ExecutionSessionErrorReason;
}> {}

export function executionSessionError(
  operation: ExecutionRouteOperation,
  reason: ExecutionSessionErrorReason,
): ExecutionSessionError {
  return new ExecutionSessionError({ operation, reason });
}

export function requireNoActiveExecutionSession<A>(
  operation: ExecutionRouteOperation,
  session: A | null,
): Effect.Effect<void, ExecutionSessionError> {
  if (session !== null) {
    return Effect.fail(executionSessionError(operation, { _tag: "ActiveSession" }));
  }
  return Effect.void;
}

export function requireActiveExecutionSession<A>(
  operation: ExecutionRouteOperation,
  session: A | null,
): Effect.Effect<A, ExecutionSessionError> {
  if (session === null) {
    return Effect.fail(executionSessionError(operation, { _tag: "MissingSession" }));
  }
  return Effect.succeed(session);
}

export function requireExecutionKindMatch(
  operation: ExecutionRouteOperation,
  requestKind: BackendFunctionKind | undefined,
  functionKind: BackendFunctionKind,
): Effect.Effect<void, ExecutionSessionError> {
  if (requestKind !== undefined && requestKind !== functionKind) {
    return Effect.fail(executionSessionError(operation, {
      _tag: "FunctionKindMismatch",
      requestKind,
      functionKind,
    }));
  }
  return Effect.void;
}

export function requireSupportedExecutionFunctionKind(
  operation: ExecutionRouteOperation,
  functionKind: DeploymentFunctionKind,
): Effect.Effect<BackendFunctionKind, ExecutionSessionError> {
  if (functionKind === "query" || functionKind === "mutation") {
    return Effect.succeed(functionKind);
  }
  return Effect.fail(executionSessionError(operation, {
    _tag: "UnsupportedFunctionKind",
    functionKind,
  }));
}

export function requireMutationExecution(
  operation: ExecutionRouteOperation,
  executionKind: BackendFunctionKind,
  syscall: string,
): Effect.Effect<void, ExecutionSessionError> {
  if (executionKind !== "mutation") {
    return Effect.fail(executionSessionError(operation, {
      _tag: "MutationOnlySyscall",
      syscall,
      executionKind,
    }));
  }
  return Effect.void;
}

export function executionSessionErrorToHttpError(error: ExecutionSessionError): HttpError {
  const { status, message } = executionSessionErrorHttpShape(error.reason);
  return new HttpError(status, message);
}

function executionSessionErrorHttpShape(
  reason: ExecutionSessionErrorReason,
): { readonly status: number; readonly message: string } {
  switch (reason._tag) {
    case "ActiveSession":
      return { status: 409, message: "Execution session is already active." };
    case "MissingSession":
      return { status: 409, message: "Execution session has not started." };
    case "UnsupportedFunctionKind":
      return {
        status: 400,
        message: `${reason.functionKind} execution is not implemented by execution sessions.`,
      };
    case "FunctionKindMismatch":
      return {
        status: 400,
        message: `Function kind mismatch. Request has ${reason.requestKind}, function is ${reason.functionKind}.`,
      };
    case "ArgumentValidation":
      return { status: 400, message: `ArgumentValidationError: ${reason.message}` };
    case "MutationOnlySyscall":
      return {
        status: 400,
        message: `Cannot run ${reason.syscall} during ${reason.executionKind} execution.`,
      };
    case "UnsupportedSyscall":
      return {
        status: 400,
        message: `Unsupported execution syscall: ${reason.syscall}.`,
      };
  }
}
