import { Data, Effect, Result, Schema } from "effect";

import {
  decodePointMutationExactRuntimeResultV1Effect,
  type PointMutationExactRuntimeResultV1,
} from "./point-mutation-exact-runtime";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";
import {
  FlarexValueCodecV1Error,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
} from "./value";

export const POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2 =
  "flarex.point-mutation-exact-runtime-host-response";
export const POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2 = 2;
export const POINT_MUTATION_EXACT_RUNTIME_ARTIFACT_HOST_ENTRYPOINT_V1 =
  "FlarexPointMutationExactRuntimeArtifactHostV1";
export const MAX_POINT_MUTATION_APPLICATION_ERROR_TEXT_BYTES_V2 = 1_024;

export type PointMutationExactRuntimeHostFailureReasonV2 =
  | "invalidRequest"
  | "sourcePackageLoadFailed"
  | "sourcePackagePinMismatch"
  | "workerDefinitionFailed"
  | "workerLoadFailed"
  | "userCodeFailed"
  | "journalBoundaryFailed"
  | "invalidResult";

export interface PointMutationExactRuntimeApplicationErrorV2 {
  readonly code: string;
  readonly message: string;
  readonly data?: CanonicalFlarexRuntimeValueV1;
}

export type PointMutationExactRuntimeHostResponseV2 =
  | Readonly<{
      readonly format:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2;
      readonly version:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2;
      readonly kind: "success";
      readonly result: PointMutationExactRuntimeResultV1;
    }>
  | Readonly<{
      readonly format:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2;
      readonly version:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2;
      readonly kind: "applicationError";
      readonly error: PointMutationExactRuntimeApplicationErrorV2;
    }>
  | Readonly<{
      readonly format:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2;
      readonly version:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2;
      readonly kind: "failure";
      readonly reason: PointMutationExactRuntimeHostFailureReasonV2;
    }>;

const textEncoder = new TextEncoder();
const BoundedApplicationErrorTextV2Schema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) =>
    textEncoder.encode(value).byteLength <=
        MAX_POINT_MUTATION_APPLICATION_ERROR_TEXT_BYTES_V2
      ? undefined
      : `Expected at most ${MAX_POINT_MUTATION_APPLICATION_ERROR_TEXT_BYTES_V2} UTF-8 bytes`
  ),
);
const ApplicationErrorShapeV2Schema = Schema.Union([
  Schema.Struct({
    code: BoundedApplicationErrorTextV2Schema,
    message: BoundedApplicationErrorTextV2Schema,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    code: BoundedApplicationErrorTextV2Schema,
    message: BoundedApplicationErrorTextV2Schema,
    data: Schema.Unknown,
  }).annotate(StrictStructOptions),
]);

const PointMutationExactRuntimeHostResponseShapeV2Schema = Schema.Union([
  Schema.Struct({
    format: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
    ),
    version: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
    ),
    kind: Schema.Literal("success"),
    result: Schema.Unknown,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    format: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
    ),
    version: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
    ),
    kind: Schema.Literal("applicationError"),
    error: ApplicationErrorShapeV2Schema,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    format: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
    ),
    version: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
    ),
    kind: Schema.Literal("failure"),
    reason: Schema.Literals([
      "invalidRequest",
      "sourcePackageLoadFailed",
      "sourcePackagePinMismatch",
      "workerDefinitionFailed",
      "workerLoadFailed",
      "userCodeFailed",
      "journalBoundaryFailed",
      "invalidResult",
    ]),
  }).annotate(StrictStructOptions),
]);

const decodePointMutationExactRuntimeHostResponseShapeV2Result =
  Schema.decodeUnknownResult(
    PointMutationExactRuntimeHostResponseShapeV2Schema,
    StrictParseOptions,
  );

export class PointMutationExactRuntimeHostResponseV2Error
  extends Data.TaggedError("PointMutationExactRuntimeHostResponseV2Error")<{
    readonly reason:
      | "invalidShape"
      | "invalidResult"
      | "invalidApplicationError";
    readonly cause?: unknown;
  }> {}

export const decodePointMutationExactRuntimeHostResponseV2Effect = Effect.fn(
  "PointMutationExactRuntimeHostResponse.decode",
)(function* (
  value: unknown,
): Effect.fn.Return<
  PointMutationExactRuntimeHostResponseV2,
  PointMutationExactRuntimeHostResponseV2Error
> {
  const response = yield* Effect.fromResult(
    decodePointMutationExactRuntimeHostResponseShapeV2Result(value).pipe(
      Result.mapError((cause) =>
        new PointMutationExactRuntimeHostResponseV2Error({
          reason: "invalidShape",
          cause,
        })
      ),
    ),
  );
  if (response.kind === "failure") {
    return Object.freeze({
      format: response.format,
      version: response.version,
      kind: response.kind,
      reason: response.reason,
    });
  }
  if (response.kind === "applicationError") {
    const error = yield* decodeApplicationErrorV2(response.error);
    return Object.freeze({
      format: response.format,
      version: response.version,
      kind: response.kind,
      error,
    });
  }
  const result = yield* decodePointMutationExactRuntimeResultV1Effect(
    response.result,
  ).pipe(
    Effect.mapError((cause) =>
      new PointMutationExactRuntimeHostResponseV2Error({
        reason: "invalidResult",
        cause,
      })
    ),
  );
  return Object.freeze({
    format: response.format,
    version: response.version,
    kind: response.kind,
    result,
  });
});

const decodeApplicationErrorV2 = Effect.fn(
  "PointMutationExactRuntimeHostResponse.decodeApplicationError",
)(function* (
  error: typeof ApplicationErrorShapeV2Schema.Type,
): Effect.fn.Return<
  PointMutationExactRuntimeApplicationErrorV2,
  PointMutationExactRuntimeHostResponseV2Error
> {
  if (!("data" in error)) {
    return Object.freeze({ code: error.code, message: error.message });
  }
  const data = yield* Effect.try({
    try: () => normalizeFlarexValueV1(error.data).value,
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause: unknown) =>
      cause instanceof FlarexValueCodecV1Error
        ? Effect.fail(new PointMutationExactRuntimeHostResponseV2Error({
            reason: "invalidApplicationError",
            cause,
          }))
        : Effect.die(cause)
    ),
  );
  return Object.freeze({
    code: error.code,
    message: error.message,
    data,
  });
});
