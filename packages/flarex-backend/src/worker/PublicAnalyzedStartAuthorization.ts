import { Data, Effect } from "effect";
import { HttpError } from "../http";
import type { Env } from "../types";

export class PublicAnalyzedStartAuthorizationError
  extends Data.TaggedError("PublicAnalyzedStartAuthorizationError")<{}> {}

// Compatibility: deploy-push authorization keeps the legacy Effect `_tag`.
// Use `instanceof PublicDeploymentPushAuthorizationError` for the narrower route boundary.
export class PublicDeploymentPushAuthorizationError
  extends PublicAnalyzedStartAuthorizationError {
  private declare readonly publicDeploymentPushAuthorizationError: "PublicDeploymentPushAuthorizationError";
}

type PublicDeploymentPushAuthorizationEnv = Pick<Env, "FLAREX_ANALYZED_START_TOKEN">;
type PublicAnalyzedStartAuthorizationEnv = PublicDeploymentPushAuthorizationEnv;

export function authorizePublicAnalyzedStartRequest(
  request: Request,
  env: PublicAnalyzedStartAuthorizationEnv,
): Effect.Effect<void, PublicAnalyzedStartAuthorizationError> {
  return authorizePublicDeploymentPushMutationRequest(request, env);
}

export function authorizePublicDeploymentPushMutationRequest(
  request: Request,
  env: PublicDeploymentPushAuthorizationEnv,
): Effect.Effect<void, PublicDeploymentPushAuthorizationError> {
  return Effect.suspend(() => {
    const token = env.FLAREX_ANALYZED_START_TOKEN;
    if (token === undefined || token.trim() === "") {
      return Effect.fail(new PublicDeploymentPushAuthorizationError());
    }
    const expected = `Bearer ${token}`;
    if (request.headers.get("authorization") === expected) {
      return Effect.void;
    }
    return Effect.fail(new PublicDeploymentPushAuthorizationError());
  });
}

export function publicAnalyzedStartAuthorizationErrorToHttpError(
  _error: PublicAnalyzedStartAuthorizationError,
): HttpError {
  return new HttpError(401, "Unauthorized analyzed start-push request.");
}

export function publicDeploymentPushAuthorizationErrorToHttpError(
  _error: PublicDeploymentPushAuthorizationError,
): HttpError {
  return new HttpError(401, "Unauthorized deployment push request.");
}
