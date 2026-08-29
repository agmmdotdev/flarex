import { Result } from "effect";

import { QuerySyncInvariantDefect } from "../kernel/Errors.js";
import {
  createEmptyQuerySyncState,
} from "../kernel/Model.js";
import type {
  BuildQuerySyncStateError,
  NamespaceCursor,
  QuerySyncState,
} from "../kernel/Model.js";
import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
} from "./Errors.js";
import type { QuerySyncStateIntegrationError } from "./Errors.js";
import {
  QuerySyncInitializationPolicyError,
} from "../transition-plan/Errors.js";
import {
  planInitializeOrInspectNamespace,
} from "../transition-plan/Initialization.js";
import type {
  InitializeNamespaceBinding,
  InitializeNamespacePlan,
  InitializeNamespacePresence,
} from "../transition-plan/Initialization.js";
import {
  freezeScopeFacts,
  querySyncStateMetricsEqual,
} from "../transition-plan/Model.js";
import type { TransitionDisposition } from "../transition-plan/Model.js";
import type { InitializeNamespaceReceipt } from "../transition-plan/Receipts.js";

export interface InitializeNamespaceAggregateTransition {
  readonly receipt: InitializeNamespaceReceipt;
  readonly nextState: QuerySyncState;
  readonly disposition: TransitionDisposition;
  readonly plan: InitializeNamespacePlan;
}

export type InitializeNamespaceAggregateError =
  | BuildQuerySyncStateError
  | QuerySyncStateIntegrationError<"initializeOrInspectNamespace">;

function mapInitializationPolicyError(
  error: QuerySyncInitializationPolicyError,
): QuerySyncStateIntegrationError<"initializeOrInspectNamespace"> {
  if (error.reason === "bootstrapBindingMismatch") {
    return new QuerySyncStoredStateIncompatibleError<
      "initializeOrInspectNamespace"
    >({
      operation: "initializeOrInspectNamespace",
      commitCertainty: "notCommitted",
      reason: "bootstrapBindingMismatch",
      cause: null,
    });
  }
  return new QuerySyncStoredStateCorruptError<
    "initializeOrInspectNamespace"
  >({
    operation: "initializeOrInspectNamespace",
    commitCertainty: "notCommitted",
    reason: error.reason,
    cause: null,
  });
}

function presenceFor(
  current: QuerySyncState | null,
  wasPreviouslyInitialized: boolean,
): InitializeNamespacePresence {
  if (current !== null) {
    return Object.freeze({
      _tag: "present",
      scope: freezeScopeFacts({
        cursor: current.cursor,
        evaluationWork: current.evaluationWork,
        metrics: current.metrics,
      }),
    });
  }
  return Object.freeze({
    _tag: wasPreviouslyInitialized
      ? "previouslyInitializedAbsence"
      : "authorizedFreshAbsence",
  });
}

function initializationDefect(): QuerySyncInvariantDefect {
  return new QuerySyncInvariantDefect({
    operation: "initializeOrInspectNamespace",
    invariant: "transitionPlanUnexpectedStep",
  });
}

export function applyInitializeNamespaceTransition(input: {
  readonly current: QuerySyncState | null;
  readonly wasPreviouslyInitialized: boolean;
  readonly binding: InitializeNamespaceBinding;
  readonly bootstrapCursor: NamespaceCursor;
}): Result.Result<
  InitializeNamespaceAggregateTransition,
  InitializeNamespaceAggregateError
> {
  return planInitializeOrInspectNamespace({
    binding: input.binding,
    bootstrapCursor: input.bootstrapCursor,
    presence: presenceFor(
      input.current,
      input.wasPreviouslyInitialized,
    ),
  }).pipe(
    Result.mapError(mapInitializationPolicyError),
    Result.flatMap((plan) => {
      if (plan._tag === "noWrite") {
        if (input.current === null) throw initializationDefect();
        const transition: InitializeNamespaceAggregateTransition =
          Object.freeze({
          receipt: plan.receipt,
          nextState: input.current,
          disposition: "noWrite",
          plan,
        });
        return Result.succeed(transition);
      }
      if (input.current !== null) throw initializationDefect();
      return createEmptyQuerySyncState(plan.nextScope.cursor).pipe(
        Result.map((nextState) => {
          if (
            !querySyncStateMetricsEqual(
              nextState.metrics,
              plan.nextScope.metrics,
            )
          ) {
            throw new QuerySyncInvariantDefect({
              operation: "initializeOrInspectNamespace",
              invariant: "transitionPlanMetricsMismatch",
            });
          }
          const transition: InitializeNamespaceAggregateTransition =
            Object.freeze({
            receipt: plan.receipt,
            nextState,
            disposition: "write",
            plan,
          });
          return transition;
        }),
      );
    }),
  );
}
