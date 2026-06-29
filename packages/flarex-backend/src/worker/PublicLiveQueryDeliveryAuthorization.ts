import { Data, Effect } from "effect";
import { HttpError } from "../http";
import type { Env } from "../types";

export class PublicLiveQueryDeliveryAuthorizationError
  extends Data.TaggedError("PublicLiveQueryDeliveryAuthorizationError")<{}> {}

export function authorizePublicLiveQueryDeliveryRequest(
  request: Request,
  env: Env,
): Effect.Effect<void, PublicLiveQueryDeliveryAuthorizationError> {
  return Effect.suspend(() => {
    if (env.FLAREX_LIVE_QUERY_DELIVERY_TOKEN === undefined) {
      return Effect.void;
    }
    const expected = `Bearer ${env.FLAREX_LIVE_QUERY_DELIVERY_TOKEN}`;
    if (request.headers.get("authorization") === expected) {
      return Effect.void;
    }
    return Effect.fail(new PublicLiveQueryDeliveryAuthorizationError());
  });
}

export function publicLiveQueryDeliveryAuthorizationErrorToHttpError(
  _error: PublicLiveQueryDeliveryAuthorizationError,
): HttpError {
  return new HttpError(401, "Unauthorized live query delivery request.");
}
