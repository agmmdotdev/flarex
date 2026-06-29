import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import {
  parseExecutionFinishRouteRequest,
  parseExecutionFinishRouteRequestEffect,
} from "./FinishRouteBoundary";
import {
  parseExecutionSyscallRouteRequest,
  parseExecutionSyscallRouteRequestEffect,
} from "./SyscallRouteBoundary";

export type PublicExecutionAction = "syscall" | "finish" | "abort";

export type PublicExecutionActionRouteError =
  | RequestJsonError
  | ExecutionProtocolValidationError;

export async function readPublicExecutionActionRequest(
  request: Request,
  action: PublicExecutionAction,
): Promise<unknown> {
  return await Effect.runPromise(
    decodePublicExecutionActionRequest(request, action).pipe(
      Effect.mapError(publicExecutionActionRouteErrorToHttpError),
    ),
  );
}

export function decodePublicExecutionActionRequest(
  request: Request,
  action: PublicExecutionAction,
): Effect.Effect<unknown, PublicExecutionActionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => parsePublicExecutionActionRequestEffect(value, action)),
  );
}

export function parsePublicExecutionActionRequest(
  value: unknown,
  action: PublicExecutionAction,
): unknown {
  if (action === "syscall") return parseExecutionSyscallRouteRequest(value);
  if (action === "finish") return parseExecutionFinishRouteRequest(value);
  return value;
}

export function parsePublicExecutionActionRequestEffect(
  value: unknown,
  action: PublicExecutionAction,
): Effect.Effect<unknown, ExecutionProtocolValidationError> {
  if (action === "syscall") return parseExecutionSyscallRouteRequestEffect(value);
  if (action === "finish") return parseExecutionFinishRouteRequestEffect(value);
  return Effect.succeed(value);
}

export function publicExecutionActionRouteErrorToHttpError(
  error: PublicExecutionActionRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}
