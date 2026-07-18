import { Data, Effect } from "effect";
import type { Json } from "./types";

export class RequestJsonError extends Data.TaggedError("RequestJsonError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class ResponseJsonError extends Data.TaggedError("ResponseJsonError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(value: Json | object, init?: ResponseInit): Response {
  return Response.json(value, init);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message }, { status: error.status });
  }
  return json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

export function readJsonEffect(request: Request): Effect.Effect<unknown, RequestJsonError> {
  return Effect.tryPromise({
    // Deliberate JSON bridge: Request.json is the Cloudflare HTTP boundary.
    try: () => request.json() as Promise<unknown>,
    catch: cause => new RequestJsonError({
      message: "Request body must be JSON.",
      cause,
    }),
  });
}

type JsonHttpResponse = Pick<Response, "json">;

export function readResponseJsonEffect(
  response: JsonHttpResponse,
): Effect.Effect<unknown, ResponseJsonError> {
  return Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: cause => new ResponseJsonError({
      message: "Response body must be JSON.",
      cause,
    }),
  });
}

export function readResponseJsonOrNullEffect(
  response: JsonHttpResponse,
): Effect.Effect<unknown> {
  return readResponseJsonEffect(response).pipe(
    Effect.catchTag("ResponseJsonError", () => Effect.succeed(null)),
  );
}

export function badRequestErrorToHttpError(
  error: Readonly<{ message: string }>,
): HttpError {
  return new HttpError(400, error.message);
}

export function requestJsonErrorToHttpError(error: RequestJsonError): HttpError {
  return badRequestErrorToHttpError(error);
}
