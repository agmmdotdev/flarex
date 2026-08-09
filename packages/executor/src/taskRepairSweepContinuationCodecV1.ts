import {
  decodeTaskSystemWakeSchedulerRepairDirectoryContinuationV1,
  decodeTaskSystemWakeSchedulerRepairDueCursorV1,
} from "@flarex/persistence-postgres/internal/task-wake-scheduler-repair-directory-v1";
import {
  MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1,
  TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1,
} from "@flarex/persistence-postgres/internal/task-repair-scheduler-model-v1";
import { Data, Result, Schema } from "effect";
import {
  ReplacementScopeIdV1Schema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";

import {
  type CanonicalContinuationCodecFailureReason,
  type CanonicalContinuationCodecOperation,
  type CanonicalContinuationEvidence,
  makeCanonicalContinuationCodec,
} from "./canonicalContinuationCodec";
import type {
  TaskRepairSweepContinuationV1,
  TaskRepairSweepDirectoryAfterV1,
  TaskRepairSweepDirectoryStateV1,
  TaskRepairSweepPartitionStateV1,
} from "./taskRepairSweepV1";

export type EncodedTaskRepairSweepContinuationV1 =
  CanonicalContinuationEvidence<1>;

export class TaskRepairSweepContinuationCodecV1Error extends Data.TaggedError(
  "TaskRepairSweepContinuationCodecV1Error",
)<{
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

const RawDirectoryAfterSchema = Schema.Union([
  RawContinuingDirectoryStateSchema,
  Schema.Struct({
    kind: Schema.Literal("exhausted"),
    highWaterScopeId: ScopeIdSchema,
  }),
]);

const RawDirectoryStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unstarted") }),
  RawContinuingDirectoryStateSchema,
]);

const RawPartitionStateSchema = Schema.NullOr(Schema.Struct({
  expectedDeploymentId: NonBlankStringSchema,
  expectedScopeId: ReplacementScopeIdV1Schema,
  dueKind: Schema.Literals(["start_attempt", "handle_lease_expiry"]),
  cursor: Schema.NullOr(Schema.Unknown),
  directoryAfter: Schema.optional(RawDirectoryAfterSchema),
}));

type RawPartitionState = Exclude<typeof RawPartitionStateSchema.Type, null>;

const RawContinuationSchema = Schema.Struct({
  version: Schema.Literal("flarex.task-repair-sweep-continuation.v1"),
  directory: RawDirectoryStateSchema,
  partition: RawPartitionStateSchema,
});

const decodeRawContinuationResult = Schema.decodeUnknownResult(
  RawContinuationSchema,
  { onExcessProperty: "error" },
);

const codec = makeCanonicalContinuationCodec<
  TaskRepairSweepContinuationV1,
  1,
  TaskRepairSweepContinuationCodecV1Error
>({
  codecVersion: TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1,
  maximumBytes: MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1,
  encodeOperationName: "TaskRepairSweepContinuation.encode",
  decodeOperationName: "TaskRepairSweepContinuation.decode",
  decodeValueResult: decodeContinuationResult,
  captureValue: captureContinuation,
  failure: codecError,
});

export const encodeTaskRepairSweepContinuationV1 = codec.encode;

export const decodeTaskRepairSweepContinuationV1 = codec.decode;

function decodeContinuationResult(
  input: unknown,
): Result.Result<TaskRepairSweepContinuationV1, unknown> {
  return decodeRawContinuationResult(input).pipe(
    Result.flatMap((raw) =>
      Result.gen(function* () {
        const directory: TaskRepairSweepDirectoryStateV1 =
          raw.directory.kind === "unstarted"
            ? Object.freeze({ kind: "unstarted" })
            : Object.freeze({
              kind: "continuing",
              continuation: yield*
                decodeTaskSystemWakeSchedulerRepairDirectoryContinuationV1(
                  raw.directory.continuation,
                ),
            });

        let partition: TaskRepairSweepPartitionStateV1 | null = null;
        if (raw.partition !== null) {
          const directoryAfter = yield* decodeOptionalDirectoryState(
            raw.partition.directoryAfter,
          );
          partition = Object.freeze({
            expectedDeploymentId: raw.partition.expectedDeploymentId,
            expectedScopeId: raw.partition.expectedScopeId,
            dueKind: raw.partition.dueKind,
            cursor: raw.partition.cursor === null
              ? null
              : yield* decodeTaskSystemWakeSchedulerRepairDueCursorV1(
                raw.partition.dueKind,
                raw.partition.cursor,
              ),
            ...(directoryAfter === undefined ? {} : { directoryAfter }),
          });
        }

        yield* validateDirectoryCorrelation(directory, partition);

        return Object.freeze({
          version: "flarex.task-repair-sweep-continuation.v1" as const,
          directory,
          partition,
        });
      })
    ),
  );
}

function validateDirectoryCorrelation(
  directory: TaskRepairSweepDirectoryStateV1,
  partition: TaskRepairSweepPartitionStateV1 | null,
): Result.Result<void, unknown> {
  const directoryAfter = partition?.directoryAfter;
  if (partition === null) {
    return Result.succeed(undefined);
  }
  if (directoryAfter === undefined) {
    return directory.kind === "unstarted"
        || (
          directory.continuation.lastScopeId < partition.expectedScopeId
          && partition.expectedScopeId <=
            directory.continuation.highWaterScopeId
        )
      ? Result.succeed(undefined)
      : invalidDirectoryCorrelation(
        "Legacy Task repair partition is outside the original snapshot.",
      );
  }
  const expectedScopeId = partition.expectedScopeId;
  const afterHighWaterScopeId = directoryAfter.kind === "exhausted"
    ? directoryAfter.highWaterScopeId
    : directoryAfter.continuation.highWaterScopeId;
  const positionMatches = directoryAfter.kind === "exhausted"
    ? directoryAfter.highWaterScopeId === expectedScopeId
    : directoryAfter.continuation.lastScopeId === expectedScopeId;
  if (!positionMatches) {
    return invalidDirectoryCorrelation(
      "Task repair directory-after position does not match the active scope.",
    );
  }
  return directory.kind === "unstarted"
      || directory.continuation.highWaterScopeId === afterHighWaterScopeId
        && directory.continuation.lastScopeId < expectedScopeId
    ? Result.succeed(undefined)
    : invalidDirectoryCorrelation(
      "Task repair directory-after position does not continue the original snapshot.",
    );
}

function invalidDirectoryCorrelation(
  message: string,
): Result.Result<never, unknown> {
  return Result.fail(new Error(message));
}

function decodeOptionalDirectoryState(
  directory: RawPartitionState["directoryAfter"],
): Result.Result<TaskRepairSweepDirectoryAfterV1 | undefined, unknown> {
  if (directory === undefined) {
    return Result.succeed(directory);
  }
  if (directory.kind === "exhausted") {
    return Result.succeed(Object.freeze({
      kind: "exhausted",
      highWaterScopeId: directory.highWaterScopeId,
    }));
  }
  return decodeTaskSystemWakeSchedulerRepairDirectoryContinuationV1(
    directory.continuation,
  ).pipe(
    Result.map((continuation) => Object.freeze({
      kind: "continuing" as const,
      continuation,
    })),
  );
}

function captureContinuation(
  continuation: TaskRepairSweepContinuationV1,
): TaskRepairSweepContinuationV1 {
  const partition = continuation.partition;
  return Object.freeze({
    version: "flarex.task-repair-sweep-continuation.v1",
    directory: continuation.directory.kind === "unstarted"
      ? Object.freeze({ kind: "unstarted" })
      : Object.freeze({
        kind: "continuing",
        continuation: Object.freeze({
          ...continuation.directory.continuation,
        }),
      }),
    partition: partition === null ? null : capturePartition(partition),
  });
}

function capturePartition(
  partition: TaskRepairSweepPartitionStateV1,
): TaskRepairSweepPartitionStateV1 {
  const cursor = partition.cursor;
  const directoryAfter = partition.directoryAfter;
  return Object.freeze({
    expectedDeploymentId: partition.expectedDeploymentId,
    expectedScopeId: partition.expectedScopeId,
    dueKind: partition.dueKind,
    cursor: cursor === null ? null : Object.freeze({ ...cursor }),
    ...(directoryAfter === undefined ? {} : {
      directoryAfter: captureDirectoryAfter(directoryAfter),
    }),
  });
}

function captureDirectoryAfter(
  directory: TaskRepairSweepDirectoryAfterV1,
): TaskRepairSweepDirectoryAfterV1 {
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
): TaskRepairSweepContinuationCodecV1Error {
  return new TaskRepairSweepContinuationCodecV1Error({
    operation,
    reason,
    ...(observedBytes === undefined ? {} : {
      observedBytes,
      maximumBytes: MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1,
    }),
    ...(cause === undefined ? {} : { cause }),
  });
}
