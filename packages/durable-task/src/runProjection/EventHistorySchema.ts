import { Result, Schema } from "effect";

import {
  TaskDatabaseTimeMsV1Schema,
  TaskLifecycleEventProjectionV1Schema,
  TaskRequestedEffectSequenceV1Schema,
  TaskRunVersionV1Schema,
} from "../runAttempt/Schema.js";

const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const STRICT_STRUCT_OPTIONS = { parseOptions: STRICT_PARSE_OPTIONS } as const;

export const TaskEventHistoryStoreItemSchema = Schema.Struct({
  sequence: Schema.toType(TaskRequestedEffectSequenceV1Schema),
  acceptedRunVersion: Schema.toType(TaskRunVersionV1Schema),
  observedAtMs: TaskDatabaseTimeMsV1Schema,
  event: TaskLifecycleEventProjectionV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

export type TaskEventHistoryStoreItem =
  typeof TaskEventHistoryStoreItemSchema.Type;

const decodeStoreItem = Schema.decodeUnknownResult(
  TaskEventHistoryStoreItemSchema,
  STRICT_PARSE_OPTIONS,
);

export function decodeTaskEventHistoryStoreItem(
  input: unknown,
): Result.Result<TaskEventHistoryStoreItem, Schema.SchemaError> {
  return decodeStoreItem(input);
}
