import { Data, Effect } from "effect";
import {
  TRUSTED_EXECUTION_IDENTITY_HEADER,
  TRUSTED_EXECUTION_IDENTITY_TOKEN_HEADER,
} from "flarex-protocol/auth-headers";
import {
  decodeExecutionIdentityEffect,
  type ExecutionIdentity,
} from "flarex-protocol/auth";
import { HttpError } from "./http";
import type { Env } from "./types";

export {
  TRUSTED_EXECUTION_IDENTITY_HEADER,
  TRUSTED_EXECUTION_IDENTITY_TOKEN_HEADER,
} from "flarex-protocol/auth-headers";
export const ANONYMOUS_EXECUTION_IDENTITY: ExecutionIdentity = { kind: "anonymous" };

export class TrustedExecutionIdentityError extends Data.TaggedError(
  "TrustedExecutionIdentityError",
)<{
  readonly reason:
    | "disabled"
    | "missingToken"
    | "unauthorized"
    | "invalidJson"
    | "invalidIdentity";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const resolveExecutionIdentityEffect = Effect.fn(
  "Auth.resolveExecutionIdentity",
)(function* (
  request: Request,
  env: Pick<
    Env,
    "FLAREX_TRUSTED_EXECUTION_IDENTITY" | "FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN"
  >,
): Effect.fn.Return<ExecutionIdentity, TrustedExecutionIdentityError> {
  const trustedIdentity = request.headers.get(TRUSTED_EXECUTION_IDENTITY_HEADER);
  if (trustedIdentity === null) return ANONYMOUS_EXECUTION_IDENTITY;
  if (env.FLAREX_TRUSTED_EXECUTION_IDENTITY !== "true") {
    return yield* Effect.fail(new TrustedExecutionIdentityError({
      reason: "disabled",
      message:
        "Trusted execution identity header is disabled for this deployment.",
    }));
  }
  if (
    env.FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN === undefined ||
    env.FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN.length === 0
  ) {
    return yield* Effect.fail(new TrustedExecutionIdentityError({
      reason: "missingToken",
      message:
        "Trusted execution identity token is required when trusted identity headers are enabled.",
    }));
  }
  if (
    request.headers.get(TRUSTED_EXECUTION_IDENTITY_TOKEN_HEADER) !==
      env.FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN
  ) {
    return yield* Effect.fail(new TrustedExecutionIdentityError({
      reason: "unauthorized",
      message: "Trusted execution identity token is invalid.",
    }));
  }
  const parsed = yield* parseTrustedExecutionIdentityHeaderEffect(trustedIdentity);
  return yield* decodeExecutionIdentityEffect(parsed).pipe(
    Effect.mapError(cause =>
      new TrustedExecutionIdentityError({
        reason: "invalidIdentity",
        message: "Trusted execution identity header must be a valid execution identity.",
        cause,
      })
    ),
  );
});

export function trustedExecutionIdentityErrorToHttpError(
  error: TrustedExecutionIdentityError,
): HttpError {
  return new HttpError(400, error.message);
}

function parseTrustedExecutionIdentityHeaderEffect(
  value: string,
): Effect.Effect<unknown, TrustedExecutionIdentityError> {
  return Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: cause => new TrustedExecutionIdentityError({
      reason: "invalidJson",
      message: "Trusted execution identity header must be JSON.",
      cause,
    }),
  });
}
