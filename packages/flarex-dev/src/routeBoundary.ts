import { Data, Effect } from "effect";
import type { SourcePackage } from "./sourcePackage.ts";

export class DevRequestJsonError extends Data.TaggedError("DevRequestJsonError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class DevRouteValidationError extends Data.TaggedError("DevRouteValidationError")<{
  readonly message: string;
}> {}

export type DevRouteError = DevRequestJsonError | DevRouteValidationError;

export type LocalAnalyzerRequest = {
  sourcePackage: SourcePackage;
};

export const decodeDevInvokeBody = Effect.fn("FlarexDev.decodeDevInvokeBody")(
  function* (request: Request) {
    const value = yield* readDevJsonEffect(request);
    const body = isRecord(value) ? value : {};
    const path = yield* requiredStringEffect(body.path, "function path");
    const partitionKey = yield* optionalPartitionKeyEffect(request, body);
    const kind = body.kind === undefined
      ? {}
      : { kind: yield* requiredStringEffect(body.kind, "function kind") };
    return {
      path,
      args: body.args ?? null,
      ...partitionKey,
      ...kind,
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    };
  },
);

export const decodeLocalAnalyzerRequest = Effect.fn("FlarexDev.decodeLocalAnalyzerRequest")(
  function (request: Request): Effect.Effect<LocalAnalyzerRequest, DevRouteError> {
    return readDevJsonEffect(request).pipe(
    Effect.flatMap(value => {
      if (!isRecord(value) || value.sourcePackage === undefined) {
        return Effect.fail(new DevRouteValidationError({
          message: "Analyzer request missing sourcePackage.",
        }));
      }
      return Effect.succeed({ sourcePackage: value.sourcePackage as SourcePackage });
    }),
    );
  },
);

export function devRouteErrorMessage(error: DevRouteError): string {
  return error.message;
}

export function isDevRouteError(error: unknown): error is DevRouteError {
  return error instanceof DevRequestJsonError || error instanceof DevRouteValidationError;
}

function readDevJsonEffect(request: Request): Effect.Effect<unknown, DevRequestJsonError> {
  return Effect.tryPromise({
    try: () => request.json() as Promise<unknown>,
    catch: cause => new DevRequestJsonError({
      message: cause instanceof Error ? cause.message : "Request body must be JSON.",
      cause,
    }),
  });
}

function optionalPartitionKeyEffect(
  request: Request,
  body: Record<string, unknown>,
): Effect.Effect<{ partitionKey?: string }, DevRouteValidationError> {
  const header = request.headers.get("x-flarex-partition");
  if (header !== null) return Effect.succeed({ partitionKey: header });
  if (body.partitionKey === undefined) return Effect.succeed({});
  return requiredStringEffect(body.partitionKey, "partition key").pipe(
    Effect.map(partitionKey => ({ partitionKey })),
  );
}

function requiredStringEffect(
  value: unknown,
  name: string,
): Effect.Effect<string, DevRouteValidationError> {
  if (typeof value !== "string" || value.length === 0) {
    return Effect.fail(new DevRouteValidationError({ message: `Missing ${name}.` }));
  }
  return Effect.succeed(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
