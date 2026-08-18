import {
  captureRetainedHistoryMaintenanceContinuationEvidenceV1,
  decodeRetainedHistoryMaintenanceContinuationEvidenceV1Result,
  type RetainedHistoryMaintenanceContinuationEvidenceV1,
} from "@flarex/persistence-postgres/internal/retained-history-maintenance-continuation-evidence-v1";
import {
  decodeReplacementScopeDirectoryContinuationV1,
  type ReplacementScopeDirectoryContinuationV1,
} from "@flarex/persistence-postgres/internal/replacement-scope-directory-discovery-v1";
import {
  MAX_RETAINED_HISTORY_SCHEDULER_CONTINUATION_BYTES_V1,
  RETAINED_HISTORY_SCHEDULER_CONTINUATION_CODEC_V1,
} from "@flarex/persistence-postgres/internal/retained-history-scheduler-model-v1";
import { Data, Result, Schema } from "effect";
import {
  ReplacementScopeIdV1Schema,
  ScopeIdSchema,
  type ReplacementScopeIdV1,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import {
  type CanonicalContinuationCodecFailureReason,
  type CanonicalContinuationCodecOperation,
  type CanonicalContinuationEvidence,
  makeCanonicalContinuationCodec,
} from "./canonicalContinuationCodec";

export type RetainedHistorySchedulerDirectoryStateV1 =
  | Readonly<{ readonly kind: "unstarted" }>
  | Readonly<{
      readonly kind: "continuing";
      readonly continuation: ReplacementScopeDirectoryContinuationV1;
    }>;

export type RetainedHistorySchedulerDirectoryAfterV1 =
  | Readonly<{
      readonly kind: "continuing";
      readonly continuation: ReplacementScopeDirectoryContinuationV1;
    }>
  | Readonly<{
      readonly kind: "exhausted";
      readonly highWaterScopeId: ScopeId;
    }>;

export interface RetainedHistorySchedulerActiveScopeV1 {
  readonly deploymentId: string;
  readonly scopeId: ReplacementScopeIdV1;
  readonly maintenance:
    | RetainedHistoryMaintenanceContinuationEvidenceV1
    | null;
  readonly directoryAfter: RetainedHistorySchedulerDirectoryAfterV1;
}

export interface RetainedHistorySchedulerContinuationV1 {
  readonly version: "flarex.retained-history-scheduler-continuation.v1";
  readonly directory: RetainedHistorySchedulerDirectoryStateV1;
  readonly activeScope: RetainedHistorySchedulerActiveScopeV1 | null;
}

export type EncodedRetainedHistorySchedulerContinuationV1 =
  CanonicalContinuationEvidence<1>;

export class RetainedHistorySchedulerContinuationCodecV1Error
  extends Data.TaggedError("RetainedHistorySchedulerContinuationCodecV1Error")<{
    readonly operation: CanonicalContinuationCodecOperation;
    readonly reason: CanonicalContinuationCodecFailureReason;
    readonly observedBytes?: number;
    readonly maximumBytes?: number;
    readonly cause?: unknown;
  }> {}

const NonBlankStringSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    value.trim().length > 0 ? undefined : "Expected a nonblank string"
  ),
);

const RawContinuingDirectoryStateSchema = Schema.Struct({
  kind: Schema.Literal("continuing"),
  continuation: Schema.Unknown,
});

const RawDirectoryStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unstarted") }),
  RawContinuingDirectoryStateSchema,
]);

const RawDirectoryAfterSchema = Schema.Union([
  RawContinuingDirectoryStateSchema,
  Schema.Struct({
    kind: Schema.Literal("exhausted"),
    highWaterScopeId: ScopeIdSchema,
  }),
]);

const RawActiveScopeSchema = Schema.NullOr(Schema.Struct({
  deploymentId: NonBlankStringSchema,
  scopeId: ReplacementScopeIdV1Schema,
  maintenance: Schema.NullOr(Schema.Unknown),
  directoryAfter: RawDirectoryAfterSchema,
}));

type RawActiveScope = Exclude<typeof RawActiveScopeSchema.Type, null>;

const RawContinuationSchema = Schema.Struct({
  version: Schema.Literal("flarex.retained-history-scheduler-continuation.v1"),
  directory: RawDirectoryStateSchema,
  activeScope: RawActiveScopeSchema,
});

const decodeRawContinuationResult = Schema.decodeUnknownResult(
  RawContinuationSchema,
  { onExcessProperty: "error" },
);

const codec = makeCanonicalContinuationCodec<
  RetainedHistorySchedulerContinuationV1,
  1,
  RetainedHistorySchedulerContinuationCodecV1Error
>({
  codecVersion: RETAINED_HISTORY_SCHEDULER_CONTINUATION_CODEC_V1,
  maximumBytes: MAX_RETAINED_HISTORY_SCHEDULER_CONTINUATION_BYTES_V1,
  encodeOperationName: "RetainedHistorySchedulerContinuation.encode",
  decodeOperationName: "RetainedHistorySchedulerContinuation.decode",
  decodeValueResult: decodeContinuationResult,
  captureValue: captureContinuation,
  failure: codecError,
});

export const encodeRetainedHistorySchedulerContinuationV1 = codec.encode;

export const decodeRetainedHistorySchedulerContinuationV1 = codec.decode;

function decodeContinuationResult(
  input: unknown,
): Result.Result<RetainedHistorySchedulerContinuationV1, unknown> {
  return decodeRawContinuationResult(input).pipe(
    Result.flatMap((raw) =>
      Result.gen(function* () {
        const directory: RetainedHistorySchedulerDirectoryStateV1 =
          raw.directory.kind === "unstarted"
            ? Object.freeze({ kind: "unstarted" })
            : Object.freeze({
              kind: "continuing",
              continuation: yield*
                decodeReplacementScopeDirectoryContinuationV1(
                  raw.directory.continuation,
                ),
            });
        const activeScope = raw.activeScope === null
          ? null
          : yield* decodeActiveScopeResult(raw.activeScope);

        yield* validateDirectoryCorrelation(directory, activeScope);

        return Object.freeze({
          version: "flarex.retained-history-scheduler-continuation.v1" as const,
          directory,
          activeScope,
        });
      })
    ),
  );
}

function decodeActiveScopeResult(
  raw: RawActiveScope,
): Result.Result<RetainedHistorySchedulerActiveScopeV1, unknown> {
  return Result.gen(function* () {
    const maintenance = raw.maintenance === null
      ? null
      : yield* decodeRetainedHistoryMaintenanceContinuationEvidenceV1Result(
        raw.maintenance,
      );
    const directoryAfter = yield* decodeDirectoryAfterResult(
      raw.directoryAfter,
    );
    if (
      maintenance !== null &&
      (
        maintenance.deploymentId !== raw.deploymentId ||
        maintenance.scopeId !== raw.scopeId
      )
    ) {
      return yield* Result.fail(
        new Error("Maintenance continuation does not match the active scope."),
      );
    }
    return Object.freeze({
      deploymentId: raw.deploymentId,
      scopeId: raw.scopeId,
      maintenance,
      directoryAfter,
    });
  });
}

function decodeDirectoryAfterResult(
  directory: RawActiveScope["directoryAfter"],
): Result.Result<RetainedHistorySchedulerDirectoryAfterV1, unknown> {
  return directory.kind === "exhausted"
    ? Result.succeed(Object.freeze({
      kind: "exhausted" as const,
      highWaterScopeId: directory.highWaterScopeId,
    }))
    : decodeReplacementScopeDirectoryContinuationV1(
      directory.continuation,
    ).pipe(Result.map((continuation) => Object.freeze({
      kind: "continuing" as const,
      continuation,
    })));
}

function validateDirectoryCorrelation(
  directory: RetainedHistorySchedulerDirectoryStateV1,
  activeScope: RetainedHistorySchedulerActiveScopeV1 | null,
): Result.Result<void, unknown> {
  if (activeScope === null) {
    return Result.succeed(undefined);
  }
  const after = activeScope.directoryAfter;
  const afterHighWaterScopeId = after.kind === "exhausted"
    ? after.highWaterScopeId
    : after.continuation.highWaterScopeId;
  const afterPositionMatches = after.kind === "exhausted"
    ? after.highWaterScopeId === activeScope.scopeId
    : after.continuation.lastScopeId === activeScope.scopeId;
  if (!afterPositionMatches) {
    return Result.fail(
      new Error("Directory-after position does not match the active scope."),
    );
  }
  return directory.kind === "unstarted" ||
      (
        directory.continuation.highWaterScopeId === afterHighWaterScopeId &&
        directory.continuation.lastScopeId < activeScope.scopeId
      )
    ? Result.succeed(undefined)
    : Result.fail(
      new Error("Directory-after position does not continue the snapshot."),
    );
}

function captureContinuation(
  continuation: RetainedHistorySchedulerContinuationV1,
): RetainedHistorySchedulerContinuationV1 {
  return Object.freeze({
    version: "flarex.retained-history-scheduler-continuation.v1",
    directory: captureDirectory(continuation.directory),
    activeScope: continuation.activeScope === null
      ? null
      : captureActiveScope(continuation.activeScope),
  });
}

function captureDirectory(
  directory: RetainedHistorySchedulerDirectoryStateV1,
): RetainedHistorySchedulerDirectoryStateV1 {
  return directory.kind === "unstarted"
    ? Object.freeze({ kind: "unstarted" })
    : Object.freeze({
      kind: "continuing",
      continuation: Object.freeze({ ...directory.continuation }),
    });
}

function captureActiveScope(
  activeScope: RetainedHistorySchedulerActiveScopeV1,
): RetainedHistorySchedulerActiveScopeV1 {
  return Object.freeze({
    deploymentId: activeScope.deploymentId,
    scopeId: activeScope.scopeId,
    maintenance: activeScope.maintenance === null
      ? null
      : captureRetainedHistoryMaintenanceContinuationEvidenceV1(
        activeScope.maintenance,
      ),
    directoryAfter: captureDirectoryAfter(activeScope.directoryAfter),
  });
}

function captureDirectoryAfter(
  directory: RetainedHistorySchedulerDirectoryAfterV1,
): RetainedHistorySchedulerDirectoryAfterV1 {
  return directory.kind === "exhausted"
    ? Object.freeze({
      kind: "exhausted",
      highWaterScopeId: directory.highWaterScopeId,
    })
    : Object.freeze({
      kind: "continuing",
      continuation: Object.freeze({ ...directory.continuation }),
    });
}

function codecError(
  operation: CanonicalContinuationCodecOperation,
  reason: CanonicalContinuationCodecFailureReason,
  cause?: unknown,
  observedBytes?: number,
): RetainedHistorySchedulerContinuationCodecV1Error {
  return new RetainedHistorySchedulerContinuationCodecV1Error({
    operation,
    reason,
    ...(observedBytes === undefined ? {} : {
      observedBytes,
      maximumBytes: MAX_RETAINED_HISTORY_SCHEDULER_CONTINUATION_BYTES_V1,
    }),
    ...(cause === undefined ? {} : { cause }),
  });
}
