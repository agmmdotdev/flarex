import { Result, Schema } from "effect";

import {
  TaskAttemptIdV1Schema,
  TaskAttemptNumberV1Schema,
  TaskRunVersionV1Schema,
} from "../runAttempt/Schema.js";

const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;

export const TaskAttemptHistoryStoreItemSchema = Schema.Struct({
  attemptId: TaskAttemptIdV1Schema,
  attemptNumber: TaskAttemptNumberV1Schema,
  acceptedRunVersion: Schema.toType(TaskRunVersionV1Schema),
});

export type TaskAttemptHistoryStoreItem =
  typeof TaskAttemptHistoryStoreItemSchema.Type;

const decodeStoreItem = Schema.decodeUnknownResult(
  TaskAttemptHistoryStoreItemSchema,
  STRICT_PARSE_OPTIONS,
);
const decodeRunVersion = Schema.decodeUnknownResult(
  Schema.toType(TaskRunVersionV1Schema),
  STRICT_PARSE_OPTIONS,
);

export function decodeTaskAttemptHistoryStoreItem(
  input: unknown,
): Result.Result<TaskAttemptHistoryStoreItem, Schema.SchemaError> {
  return decodeStoreItem(input);
}

export function decodeTaskAttemptHistoryRunVersion(
  input: unknown,
): Result.Result<typeof TaskRunVersionV1Schema.Type, Schema.SchemaError> {
  return decodeRunVersion(input);
}
