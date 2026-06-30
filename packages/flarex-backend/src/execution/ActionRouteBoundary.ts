import { Data, Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import {
  decodePublicExecutionActionPayload,
  parsePublicExecutionActionPayload as parsePublicExecutionActionPayloadSource,
} from "./Requests";

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
    Effect.flatMap(value => decodePublicExecutionActionRoutePayload(value, action)),
  );
}

export function parsePublicExecutionActionRequest(
  value: unknown,
  action: PublicExecutionAction,
): unknown {
  try {
    return parsePublicExecutionActionPayloadSource(value, action);
  } catch (error) {
    if (error instanceof ExecutionProtocolValidationError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}

export function parsePublicExecutionActionRequestEffect(
  value: unknown,
  action: PublicExecutionAction,
): Effect.Effect<unknown, ExecutionProtocolValidationError> {
  return decodePublicExecutionActionRoutePayload(value, action);
}

export function decodePublicExecutionActionRoutePayload(
  value: unknown,
  action: PublicExecutionAction,
): Effect.Effect<unknown, ExecutionProtocolValidationError> {
  return decodePublicExecutionActionPayload(value, action);
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
