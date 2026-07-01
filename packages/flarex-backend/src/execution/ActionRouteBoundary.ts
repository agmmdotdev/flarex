import { Data, Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { readJsonEffect, RequestJsonError } from "../http";
import {
  decodePublicExecutionActionPayload,
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

export const decodePublicExecutionActionRequest = Effect.fn(
  "ExecutionActionRouteBoundary.decodePublicActionRequest",
)(function* (
  request: Request,
  action: PublicExecutionAction,
): Effect.fn.Return<unknown, PublicExecutionActionRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(value => decodePublicExecutionActionRoutePayload(value, action)),
  );
});

export const decodePublicExecutionActionRoutePayload = Effect.fn(
  "ExecutionActionRouteBoundary.decodePublicActionPayload",
)(function* (
  value: unknown,
  action: PublicExecutionAction,
): Effect.fn.Return<unknown, ExecutionProtocolValidationError> {
  return yield* decodePublicExecutionActionPayload(value, action);
});

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

function isPublicExecutionAction(action: string): action is PublicExecutionAction {
  return action === "syscall" || action === "finish" || action === "abort";
}
