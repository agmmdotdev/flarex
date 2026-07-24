import { Data, Effect, Result, Schema } from "effect";

import {
  decodePointMutationExactRuntimeResultV1Effect,
  type PointMutationExactRuntimeResultV1,
} from "./point-mutation-exact-runtime";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";

export const POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1 =
  "flarex.point-mutation-exact-runtime-host-response";
export const POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1 = 1;
export const POINT_MUTATION_EXACT_RUNTIME_ARTIFACT_HOST_ENTRYPOINT_V1 =
  "FlarexPointMutationExactRuntimeArtifactHostV1";

export type PointMutationExactRuntimeHostFailureReasonV1 =
  | "invalidRequest"
  | "sourcePackageLoadFailed"
  | "sourcePackagePinMismatch"
  | "workerDefinitionFailed"
  | "workerLoadFailed"
  | "userCodeFailed"
  | "journalBoundaryFailed"
  | "invalidResult";

export type PointMutationExactRuntimeHostResponseV1 =
  | Readonly<{
      readonly format:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1;
      readonly version:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1;
      readonly kind: "success";
      readonly result: PointMutationExactRuntimeResultV1;
    }>
  | Readonly<{
      readonly format:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1;
      readonly version:
        typeof POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1;
      readonly kind: "failure";
      readonly reason: PointMutationExactRuntimeHostFailureReasonV1;
    }>;

const PointMutationExactRuntimeHostResponseShapeV1Schema = Schema.Union([
  Schema.Struct({
    format: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
    ),
    version: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
    ),
    kind: Schema.Literal("success"),
    result: Schema.Unknown,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    format: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
    ),
    version: Schema.Literal(
      POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
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

const decodePointMutationExactRuntimeHostResponseShapeV1Result =
  Schema.decodeUnknownResult(
    PointMutationExactRuntimeHostResponseShapeV1Schema,
    StrictParseOptions,
  );

export class PointMutationExactRuntimeHostResponseV1Error
  extends Data.TaggedError("PointMutationExactRuntimeHostResponseV1Error")<{
    readonly reason: "invalidShape" | "invalidResult";
    readonly cause?: unknown;
  }> {}

export const decodePointMutationExactRuntimeHostResponseV1Effect = Effect.fn(
  "PointMutationExactRuntimeHostResponse.decode",
)(function* (
  value: unknown,
): Effect.fn.Return<
  PointMutationExactRuntimeHostResponseV1,
  PointMutationExactRuntimeHostResponseV1Error
> {
  const response = yield* Effect.fromResult(
    decodePointMutationExactRuntimeHostResponseShapeV1Result(value).pipe(
      Result.mapError((cause) =>
        new PointMutationExactRuntimeHostResponseV1Error({
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
  const result = yield* decodePointMutationExactRuntimeResultV1Effect(
    response.result,
  ).pipe(
    Effect.mapError((cause) =>
      new PointMutationExactRuntimeHostResponseV1Error({
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
