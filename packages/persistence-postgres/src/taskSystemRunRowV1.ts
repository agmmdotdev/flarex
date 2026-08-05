import {
  decodePersistedTaskRunAttemptAggregateJsonV1,
  encodePersistedTaskRunAttemptAggregateJsonV1,
  projectTaskRunAttemptPersistenceV1,
  type TaskPersistenceCodecErrorV1,
  type TaskRunAttemptAggregateV1,
  type TaskSystemRunAttemptCorruptionError,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Result, SchemaIssue } from "effect";

import { fxSystemDurableTaskRunsV1 } from "./schema";

const UTF8 = new TextEncoder();

export type TaskSystemDurableTaskRunRowV1 =
  typeof fxSystemDurableTaskRunsV1.$inferSelect;
export type TaskSystemRunRowCorruptionReasonV1 =
  TaskSystemRunAttemptCorruptionError["reason"];

export function decodeAndCorrelateTaskSystemRunRowV1(
  row: TaskSystemDurableTaskRunRowV1,
): Result.Result<
  TaskRunAttemptAggregateV1,
  TaskSystemRunRowCorruptionReasonV1
> {
  if (row.aggregateCodecVersion !== 1) return Result.fail("aggregate_invalid");
  return Result.gen(function* () {
    const aggregate = yield* decodePersistedTaskRunAttemptAggregateJsonV1(
      row.aggregateJson,
    ).pipe(Result.mapError(classifyAggregateDecodeCorruption));
    const encoded = yield* encodePersistedTaskRunAttemptAggregateJsonV1(
      aggregate,
    ).pipe(Result.mapError(() => "aggregate_invalid" as const));
    const projection = projectTaskRunAttemptPersistenceV1(aggregate);
    if (
      row.aggregateByteLength !== encodedJsonByteLength(encoded)
      || aggregate.runId !== row.runId
      || aggregate.taskDefinitionRevisionId !== row.taskDefinitionRevisionId
      || BigInt(aggregate.createdAtMs) !== row.createdAtMs
      || projection.runVersion !== row.runVersion
      || projection.phase !== row.phase
      || projection.dueKind !== row.dueKind
      || nullableNumberAsBigInt(projection.dueAtMs) !== row.dueAtMs
      || projection.currentAttemptId !== row.currentAttemptId
      || projection.executionFenceBasis !== row.executionFenceBasis
      || projection.currentLeaseVersion !== row.currentLeaseVersion
      || nullableNumberAsBigInt(projection.currentLeaseExpiresAtMs)
        !== row.currentLeaseExpiresAtMs
      || projection.cancellationGeneration !== row.cancellationGeneration
      || projection.requestedEffectSequence !== row.requestedEffectSequence
    ) {
      return yield* Result.fail("binding_reference_invalid" as const);
    }
    return aggregate;
  });
}

function classifyAggregateDecodeCorruption(
  error: TaskPersistenceCodecErrorV1,
): TaskSystemRunRowCorruptionReasonV1 {
  if (error.issue.kind !== "domain_value_invalid") return "aggregate_invalid";
  const formatted = SchemaIssue.makeFormatterStandardSchemaV1()(
    error.issue.cause.issue,
  );
  const paths = formatted.issues.flatMap(issue =>
    issue.path === undefined ? [] : [issue.path]
  );
  if (paths.some(path => path.includes("completionReplays"))) {
    return "completion_replay_invalid";
  }
  if (paths.some(path => path.includes("evidence"))) {
    return "evidence_invalid";
  }
  if (paths.some(path =>
    path.includes("requestedEffectCursor")
    || path.includes("requestedEffects")
    || path.includes("sequence")
  )) {
    return "effect_sequence_invalid";
  }
  return "aggregate_invalid";
}

function encodedJsonByteLength(value: unknown): bigint {
  return BigInt(UTF8.encode(JSON.stringify(value)).byteLength);
}

function nullableNumberAsBigInt(value: number | null): bigint | null {
  return value === null ? null : BigInt(value);
}
