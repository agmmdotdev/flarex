import { Data, type Effect } from "effect";

import type {
  TaskDatabaseTimeMsV1,
  TaskRunIdV1,
} from "../runAttempt/Model.js";
import type { TaskRunProjection } from "./Model.js";
import type { TaskRunListStoreItem } from "./ListSchema.js";

export const MAX_TASK_RUN_LIST_PAGE_SIZE = 100;
export const TASK_RUN_LIST_ORDER =
  "created_at_desc_run_id_ascii_desc" as const;

export interface TaskRunListCursorV1 {
  readonly version: 1;
  readonly createdAtMs: TaskDatabaseTimeMsV1;
  readonly runId: TaskRunIdV1;
}

export interface TaskRunListStoreRequest {
  readonly pageSize: number;
  readonly cursor: TaskRunListCursorV1 | null;
}

export interface TaskRunListStorePage {
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runs: readonly TaskRunListStoreItem[];
  readonly hasMore: boolean;
}

export class TaskRunListStoreFailure extends Data.TaggedError(
  "TaskRunListStoreError",
)<{
  readonly operation: "list_task_runs";
  readonly reason:
    | "unavailable"
    | "corrupt_data"
    | "stale_scope_authority"
    | "transient"
    | "unsupported";
  readonly cause: unknown;
}> {}

export type TaskRunListStoreError = TaskRunListStoreFailure;

export interface ApplicationTaskRunListStoreShape {
  readonly listRuns: (
    request: TaskRunListStoreRequest,
  ) => Effect.Effect<TaskRunListStorePage, TaskRunListStoreError>;
}

export interface TaskRunListQueryOptions {
  readonly pageSize: number;
  readonly cursor?: TaskRunListCursorV1 | null;
}

export interface TaskRunListPage {
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly items: readonly TaskRunProjection[];
  readonly nextCursor: TaskRunListCursorV1 | null;
}
