import { Data, Effect } from "effect";
import { HttpError } from "../http";
import type { Env } from "../types";

export class PublicAnalyzedStartAuthorizationError
  extends Data.TaggedError("PublicAnalyzedStartAuthorizationError")<{}> {}

type PublicAnalyzedStartAuthorizationEnv = Pick<Env, "FLAREX_ANALYZED_START_TOKEN">;

export function authorizePublicAnalyzedStartRequest(
  request: Request,
  env: PublicAnalyzedStartAuthorizationEnv,
): Effect.Effect<void, PublicAnalyzedStartAuthorizationError> {
  return Effect.suspend(() => {
    const token = env.FLAREX_ANALYZED_START_TOKEN;
    if (token === undefined || token.trim() === "") {
      return Effect.fail(new PublicAnalyzedStartAuthorizationError());
    }
    const expected = `Bearer ${token}`;
    if (request.headers.get("authorization") === expected) {
      return Effect.void;
    }
    return Effect.fail(new PublicAnalyzedStartAuthorizationError());
  });
}

export function publicAnalyzedStartAuthorizationErrorToHttpError(
  _error: PublicAnalyzedStartAuthorizationError,
): HttpError {
  return new HttpError(401, "Unauthorized analyzed start-push request.");
}
