import { Data, Effect } from "effect";
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

export class MissingExecutionSessionIdError
  extends Data.TaggedError("MissingExecutionSessionIdError")<{}> {}

export class MissingExecutionActionError
  extends Data.TaggedError("MissingExecutionActionError")<{}> {}

export type PublicExecutionRoutePath =
  | {
      readonly matched: true;
      readonly sessionId: string;
      readonly action: PublicExecutionAction;
    }
  | {
      readonly matched: false;
    };

export type PublicExecutionActionRouteError =
  | RequestJsonError
  | ExecutionProtocolValidationError;

export type PublicExecutionRoutePathError =
  | MissingExecutionSessionIdError
  | MissingExecutionActionError;

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

export const publicExecutionRoutePathFromPartsEffect = Effect.fn(
  "ExecutionActionRouteBoundary.publicExecutionRoutePathFromParts",
)(function* (
  parts: readonly string[],
): Effect.fn.Return<PublicExecutionRoutePath, PublicExecutionRoutePathError> {
  const sessionId = parts[0];
  const action = parts[1];
  if (sessionId === undefined || sessionId.length === 0) {
    return yield* Effect.fail(new MissingExecutionSessionIdError());
  }
  if (action === undefined || action.length === 0) {
    return yield* Effect.fail(new MissingExecutionActionError());
  }
  if (!isPublicExecutionAction(action)) {
    return { matched: false };
  }
  return { matched: true, sessionId, action };
});

export function publicExecutionActionRouteErrorToHttpError(
  error: PublicExecutionActionRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

export function publicExecutionRoutePathErrorToHttpError(
  error: PublicExecutionRoutePathError,
): HttpError {
  if (error instanceof MissingExecutionSessionIdError) {
    return new HttpError(400, "Missing execution session id.");
  }
  return new HttpError(400, "Missing execution action.");
}

function isPublicExecutionAction(action: string): action is PublicExecutionAction {
  return action === "syscall" || action === "finish" || action === "abort";
}
