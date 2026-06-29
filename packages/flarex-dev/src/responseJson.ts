import { Data, Effect } from "effect";

export class DevResponseJsonError extends Data.TaggedError("DevResponseJsonError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

type JsonHttpResponse = Pick<Response, "json">;

export function readDevResponseJsonEffect(
  response: JsonHttpResponse,
): Effect.Effect<unknown, DevResponseJsonError> {
  return Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: cause => new DevResponseJsonError({
      message: "Response body must be JSON.",
      cause,
    }),
  });
}

export function readDevResponseJsonOrNullEffect(
  response: JsonHttpResponse,
): Effect.Effect<unknown> {
  return readDevResponseJsonEffect(response).pipe(
    Effect.catchTag("DevResponseJsonError", () => Effect.succeed(null)),
  );
}
