import { Option } from "effect";

import type {
  TaskRequestedEffectV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "../runAttempt/Model.js";
import type { TaskRunListPage } from "./ListModel.js";
import type { TaskRunProjection } from "./Model.js";

export interface TaskRunAdvancedInvalidation {
  readonly kind: "run_advanced";
  readonly runId: TaskRunIdV1;
  readonly runVersion: TaskRunVersionV1;
}

export type TaskReadRefreshRequiredReason = "cursor_gap" | "reconnected";

export interface TaskReadRefreshRequiredInvalidation {
  readonly kind: "refresh_required";
  readonly reason: TaskReadRefreshRequiredReason;
}

/** A bounded refetch hint. It carries no Task state or command authority. */
export type TaskReadInvalidation =
  | TaskRunAdvancedInvalidation
  | TaskReadRefreshRequiredInvalidation;

/** Common already-decoded facet across legacy, Application, and current effects. */
export type TaskRunInvalidationSource = Readonly<{
  readonly effect: Pick<
    TaskRequestedEffectV1,
    "acceptedRunVersion" | "kind" | "runId"
  >;
}>;

export type TaskReadRefetchDecision =
  | Readonly<{
      readonly kind: "ignore";
      readonly reason: "covered" | "different_run";
    }>
  | Readonly<{
      readonly kind: "refetch";
      readonly reason:
        | "cursor_gap"
        | "reconnected"
        | "run_advanced"
        | "run_not_in_page";
    }>;

const IGNORE_COVERED = frozen({
  kind: "ignore" as const,
  reason: "covered" as const,
});
const IGNORE_DIFFERENT_RUN = frozen({
  kind: "ignore" as const,
  reason: "different_run" as const,
});
const REFETCH_RUN_ADVANCED = frozen({
  kind: "refetch" as const,
  reason: "run_advanced" as const,
});
const REFETCH_RUN_NOT_IN_PAGE = frozen({
  kind: "refetch" as const,
  reason: "run_not_in_page" as const,
});

/**
 * Projects the already-decoded durable notification intent into a bounded
 * refetch hint. Other requested effects are intentionally absent.
 */
export function projectTaskRunInvalidation(
  requested: TaskRunInvalidationSource,
): Option.Option<TaskRunAdvancedInvalidation> {
  if (requested.effect.kind !== "notify_current_state") return Option.none();
  return Option.some(frozen({
    kind: "run_advanced",
    runId: requested.effect.runId,
    runVersion: requested.effect.acceptedRunVersion,
  }));
}

/** Creates the only transport-owned signals admitted by the pure policy. */
export function makeTaskReadRefreshRequired(
  reason: TaskReadRefreshRequiredReason,
): TaskReadRefreshRequiredInvalidation {
  return frozen({ kind: "refresh_required", reason });
}

/** Decides whether one authoritative point projection must be refetched. */
export function decideTaskRunRefetch(
  current: Pick<TaskRunProjection, "runId" | "runVersion">,
  invalidation: TaskReadInvalidation,
): TaskReadRefetchDecision {
  if (invalidation.kind === "refresh_required") {
    return refetchRequired(invalidation.reason);
  }
  if (invalidation.runId !== current.runId) return IGNORE_DIFFERENT_RUN;
  return invalidation.runVersion > current.runVersion
    ? REFETCH_RUN_ADVANCED
    : IGNORE_COVERED;
}

/** Decides whether one authoritative list page must be refetched. */
export function decideTaskRunListRefetch(
  current: Pick<TaskRunListPage, "items">,
  invalidation: TaskReadInvalidation,
): TaskReadRefetchDecision {
  if (invalidation.kind === "refresh_required") {
    return refetchRequired(invalidation.reason);
  }
  const listed = current.items.find(item => item.runId === invalidation.runId);
  if (listed === undefined) return REFETCH_RUN_NOT_IN_PAGE;
  return invalidation.runVersion > listed.runVersion
    ? REFETCH_RUN_ADVANCED
    : IGNORE_COVERED;
}

function refetchRequired(
  reason: TaskReadRefreshRequiredReason,
): TaskReadRefetchDecision {
  return frozen({ kind: "refetch", reason });
}

function frozen<RecordType extends object>(
  value: RecordType,
): Readonly<RecordType> {
  return Object.freeze(value);
}
