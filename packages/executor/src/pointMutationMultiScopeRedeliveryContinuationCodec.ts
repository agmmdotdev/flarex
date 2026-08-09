import {
  MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
  POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
} from "@flarex/persistence-postgres/point-mutation-redelivery-scheduler-model";
import { Data, Schema } from "effect";

import {
  type CanonicalContinuationCodecFailureReason,
  type CanonicalContinuationCodecOperation,
  type CanonicalContinuationEvidence,
  makeCanonicalContinuationCodec,
} from "./canonicalContinuationCodec";
import {
  PointMutationMultiScopeRedeliveryContinuationSchemaV1,
  type PointMutationMultiScopeRedeliveryContinuationV1,
} from "./pointMutationMultiScopeRedelivery";

export type EncodedPointMutationMultiScopeRedeliveryContinuationV1 =
  CanonicalContinuationEvidence<1>;

export class PointMutationMultiScopeRedeliveryContinuationCodecV1Error
  extends Data.TaggedError(
    "PointMutationMultiScopeRedeliveryContinuationCodecV1Error",
  )<{
    readonly operation: CanonicalContinuationCodecOperation;
    readonly reason: CanonicalContinuationCodecFailureReason;
    readonly observedBytes?: number;
    readonly maximumBytes?: number;
    readonly cause?: unknown;
  }> {}

const decodeContinuationResult = Schema.decodeUnknownResult(
  PointMutationMultiScopeRedeliveryContinuationSchemaV1,
  { onExcessProperty: "error" },
);

const codec = makeCanonicalContinuationCodec<
  PointMutationMultiScopeRedeliveryContinuationV1,
  1,
  PointMutationMultiScopeRedeliveryContinuationCodecV1Error
>({
  codecVersion: POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
  maximumBytes:
    MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
  encodeOperationName: "PointMutationMultiScopeRedeliveryContinuation.encode",
  decodeOperationName: "PointMutationMultiScopeRedeliveryContinuation.decode",
  decodeValueResult: (input) => decodeContinuationResult(input),
  captureValue: captureContinuation,
  failure: codecError,
});

export const encodePointMutationMultiScopeRedeliveryContinuationV1 =
  codec.encode;

export const decodePointMutationMultiScopeRedeliveryContinuationV1 =
  codec.decode;

function captureContinuation(
  continuation: PointMutationMultiScopeRedeliveryContinuationV1,
): PointMutationMultiScopeRedeliveryContinuationV1 {
  return Object.freeze({
    codecVersion:
      POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
    directory: continuation.directory.kind === "continuing"
      ? Object.freeze({
        kind: "continuing",
        continuation: Object.freeze({ ...continuation.directory.continuation }),
      })
      : Object.freeze({ kind: continuation.directory.kind }),
    scopes: Object.freeze(continuation.scopes.map((entry) => Object.freeze({
      locator: Object.freeze({ ...entry.locator }),
      attemptDiscovery: entry.attemptDiscovery.kind === "continuing"
        ? Object.freeze({
          kind: "continuing",
          continuation: Object.freeze({
            ...entry.attemptDiscovery.continuation,
          }),
        })
        : Object.freeze({ kind: "unstarted" }),
    }))),
  });
}

function codecError(
  operation: CanonicalContinuationCodecOperation,
  reason: CanonicalContinuationCodecFailureReason,
  cause?: unknown,
  observedBytes?: number,
): PointMutationMultiScopeRedeliveryContinuationCodecV1Error {
  return new PointMutationMultiScopeRedeliveryContinuationCodecV1Error({
    operation,
    reason,
    ...(observedBytes === undefined ? {} : {
      observedBytes,
      maximumBytes:
        MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
    }),
    ...(cause === undefined ? {} : { cause }),
  });
}
