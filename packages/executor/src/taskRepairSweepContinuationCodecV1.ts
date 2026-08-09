import {
  decodeTaskSystemWakeSchedulerRepairDirectoryContinuationV1,
  decodeTaskSystemWakeSchedulerRepairDueCursorV1,
} from "@flarex/persistence-postgres/internal/task-wake-scheduler-repair-directory-v1";
import {
  MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1,
  TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1,
} from "@flarex/persistence-postgres/internal/task-repair-scheduler-model-v1";
import { Data, Result, Schema } from "effect";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";

import {
  type CanonicalContinuationCodecFailureReason,
  type CanonicalContinuationCodecOperation,
  type CanonicalContinuationEvidence,
  makeCanonicalContinuationCodec,
} from "./canonicalContinuationCodec";
import type {
  TaskRepairSweepContinuationV1,
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

const RawDirectoryStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unstarted") }),
  Schema.Struct({
    kind: Schema.Literal("continuing"),
    continuation: Schema.Unknown,
  }),
]);

const RawPartitionStateSchema = Schema.NullOr(Schema.Struct({
  expectedDeploymentId: NonBlankStringSchema,
  expectedScopeId: ReplacementScopeIdV1Schema,
  dueKind: Schema.Literals(["start_attempt", "handle_lease_expiry"]),
  cursor: Schema.NullOr(Schema.Unknown),
}));

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

        const partition: TaskRepairSweepPartitionStateV1 | null =
          raw.partition === null
            ? null
            : Object.freeze({
              expectedDeploymentId: raw.partition.expectedDeploymentId,
              expectedScopeId: raw.partition.expectedScopeId,
              dueKind: raw.partition.dueKind,
              cursor: raw.partition.cursor === null
                ? null
                : yield* decodeTaskSystemWakeSchedulerRepairDueCursorV1(
                  raw.partition.dueKind,
                  raw.partition.cursor,
                ),
            });

        return Object.freeze({
          version: "flarex.task-repair-sweep-continuation.v1" as const,
          directory,
          partition,
        });
      })
    ),
  );
}

function captureContinuation(
  continuation: TaskRepairSweepContinuationV1,
): TaskRepairSweepContinuationV1 {
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
    partition: continuation.partition === null
      ? null
      : Object.freeze({
        expectedDeploymentId: continuation.partition.expectedDeploymentId,
        expectedScopeId: continuation.partition.expectedScopeId,
        dueKind: continuation.partition.dueKind,
        cursor: continuation.partition.cursor === null
          ? null
          : Object.freeze({ ...continuation.partition.cursor }),
      }),
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
