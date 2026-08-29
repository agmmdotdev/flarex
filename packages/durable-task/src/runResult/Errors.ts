import { Data } from "effect";

import type { TaskRunIdV1 } from "../runAttempt/Model.js";

export class TaskRunResultUnavailableError extends Data.TaggedError(
  "TaskRunResultUnavailableError",
)<{
  readonly runId: TaskRunIdV1;
  readonly reason: "run_incomplete" | "run_not_succeeded" | "result_absent";
}> {}
