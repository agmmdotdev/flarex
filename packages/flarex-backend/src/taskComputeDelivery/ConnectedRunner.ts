import type {
  TaskComputeDeliveryCandidate,
  TaskComputeDeliveryCandidateDiscovery,
  TaskComputeDeliveryCandidatePage,
  TaskComputeDeliveryContinuationV1,
  TaskComputeDeliveryDiscoveryError,
  TaskComputeDeliveryOperation,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-discovery";
import {
  decodeTaskComputeDeliveryContinuationV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-discovery";
import type {
  ReplacementScopeDirectoryContinuationV1,
} from "@flarex/persistence-postgres/internal/replacement-scope-directory-discovery-v1";
import {
  decodeReplacementScopeDirectoryContinuationV1,
} from "@flarex/persistence-postgres/internal/replacement-scope-directory-discovery-v1";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Clock, Context, Data, Duration, Effect, Fiber, Layer, Result } from "effect";

import {
  TaskComputeDeliveryCandidateRunner,
  type TaskComputeDeliveryCandidateRunnerShape,
  type TaskComputeCancellationCandidateOutcome,
  type TaskComputeCancellationCandidateRunnerError,
  type TaskComputeDispatchCandidateOutcome,
  type TaskComputeDispatchCandidateRunnerError,
} from "./CandidateRunner.js";
import {
  MAX_TASK_COMPUTE_DELIVERY_SCOPE_PAGE_CHARGES,
  decodeTaskComputeDeliveryConnectedContinuationV1,
  encodeTaskComputeDeliveryConnectedContinuationV1,
  type EncodedTaskComputeDeliveryConnectedContinuationV1,
  type TaskComputeDeliveryConnectedActiveScopeV1,
  type TaskComputeDeliveryConnectedContinuationCodecV1Error,
  type TaskComputeDeliveryConnectedContinuationV1,
  type TaskComputeDeliveryConnectedDirectoryAfterV1,
  type TaskComputeDeliveryConnectedDirectoryStateV1,
  type TaskComputeDeliveryConnectedOperationStateV1,
} from "./ConnectedContinuation.js";
import {
  TaskComputeDeliveryTrustedDirectory,
  type TaskComputeDeliveryTrustedDirectoryError,
  type TaskComputeDeliveryTrustedDirectoryItem,
  type TaskComputeDeliveryTrustedDirectoryPage,
  type TaskComputeDeliveryTrustedDirectoryReadyItem,
  type TaskComputeDeliveryTrustedDirectoryShape,
} from "./TrustedDirectory.js";

const MAX_CONNECTED_RUNNER_COUNT = 10_000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const INVALID_DIRECTORY_ITEM = Symbol("invalid connected directory item");

export interface TaskComputeDeliveryConnectedRunnerOptions {
  readonly maximumDirectoryPages: number;
  readonly maximumScopeVisits: number;
  readonly maximumDispatchPages: number;
  readonly maximumCancellationPages: number;
  readonly maximumDispatchCandidates: number;
  readonly maximumCancellationCandidates: number;
  readonly maximumDispatchProviderCalls: number;
  readonly maximumCancellationProviderCalls: number;
  readonly maximumTotalOperations: number;
  readonly maximumDispatchPagesPerScope: number;
  readonly maximumCancellationPagesPerScope: number;
  readonly candidatesPerPage: number;
  readonly maximumRunMilliseconds: number;
  readonly maximumOperationMilliseconds: number;
  readonly settlementReserveMilliseconds: number;
}

interface CapturedRunnerPolicy extends TaskComputeDeliveryConnectedRunnerOptions {
  readonly maximumRunNanoseconds: bigint;
  readonly maximumOperationNanoseconds: bigint;
  readonly settlementReserveNanoseconds: bigint;
}

interface CapturedDirectorySettlementBudgets {
  readonly discoverNanoseconds: bigint;
  readonly resolveNanoseconds: bigint;
}

export class TaskComputeDeliveryConnectedRunnerConfigurationError
  extends Data.TaggedError(
    "TaskComputeDeliveryConnectedRunnerConfigurationError",
  )<{
    readonly reason: "invalid_policy";
    readonly cause?: unknown;
  }> {}

export class TaskComputeDeliveryConnectedRunnerContractError
  extends Data.TaggedError("TaskComputeDeliveryConnectedRunnerContractError")<{
    readonly operation: "directory" | TaskComputeDeliveryOperation;
    readonly reason:
      | "directory_item_overflow"
      | "directory_page_capture_invalid"
      | "directory_item_capture_invalid"
      | "directory_continuation_invalid"
      | "resolved_item_mismatch"
      | "page_operation_mismatch"
      | "page_candidate_overflow"
      | "page_capture_invalid"
      | "candidate_capture_invalid"
      | "candidate_operation_mismatch"
      | "candidate_ordering_mismatch"
      | "candidate_outcome_mismatch"
      | "continuation_operation_mismatch"
      | "continuation_last_mismatch"
      | "continuation_snapshot_mismatch"
      | "candidate_outside_snapshot";
    readonly cause?: unknown;
  }> {}

export type TaskComputeDeliveryConnectedRunnerOperation =
  | "directory"
  | "resolve"
  | "dispatch_discovery"
  | "cancellation_discovery"
  | "dispatch_candidate"
  | "cancellation_candidate";

export class TaskComputeDeliveryConnectedRunnerOperationTimeoutError<
  Operation extends TaskComputeDeliveryConnectedRunnerOperation =
    TaskComputeDeliveryConnectedRunnerOperation,
>
  extends Data.TaggedError(
    "TaskComputeDeliveryConnectedRunnerOperationTimeoutError",
  )<{
    readonly operation: Operation;
    readonly budgetNanoseconds: bigint;
  }> {}

export type TaskComputeDeliveryConnectedRunnerError =
  | TaskComputeDeliveryTrustedDirectoryError
  | TaskComputeDeliveryConnectedContinuationCodecV1Error
  | TaskComputeDeliveryConnectedRunnerContractError
  | TaskComputeDeliveryConnectedRunnerOperationTimeoutError<
      "directory" | "resolve"
    >;

export type TaskComputeDeliveryConnectedRunnerStopReason =
  | "cycle_exhausted"
  | "directory_budget"
  | "scope_visit_budget"
  | "dispatch_page_budget"
  | "cancellation_page_budget"
  | "dispatch_candidate_budget"
  | "cancellation_candidate_budget"
  | "dispatch_provider_budget"
  | "cancellation_provider_budget"
  | "total_operation_budget"
  | "no_time_to_start"
  | "time_budget";

export interface TaskComputeDeliveryConnectedRunnerReceipt {
  readonly version: "flarex.task-compute-delivery-connected-runner-receipt.v1";
  readonly stopReason: TaskComputeDeliveryConnectedRunnerStopReason;
  readonly directoryPagesCharged: number;
  readonly scopeVisits: number;
  readonly scopeResolutionFailures: number;
  readonly discoveryFailures: number;
  readonly dispatchPagesCharged: number;
  readonly cancellationPagesCharged: number;
  readonly dispatchCandidatesCharged: number;
  readonly cancellationCandidatesCharged: number;
  readonly dispatchProviderCallsCharged: number;
  readonly cancellationProviderCallsCharged: number;
  readonly totalOperationsCharged: number;
  readonly confirmedDispatchPagesRead: number;
  readonly confirmedCancellationPagesRead: number;
  readonly confirmedDispatchCandidatesHandled: number;
  readonly confirmedCancellationCandidatesHandled: number;
  readonly confirmedDispatchProviderCalls: number;
  readonly confirmedCancellationProviderCalls: number;
  readonly candidateFailures: number;
  readonly continuation:
    EncodedTaskComputeDeliveryConnectedContinuationV1 | null;
}

export interface TaskComputeDeliveryConnectedRunnerShape {
  readonly run: (
    continuation:
      | EncodedTaskComputeDeliveryConnectedContinuationV1
      | null,
  ) => Effect.Effect<
    TaskComputeDeliveryConnectedRunnerReceipt,
    TaskComputeDeliveryConnectedRunnerError
  >;
}

export class TaskComputeDeliveryConnectedRunner
  extends Context.Service<
    TaskComputeDeliveryConnectedRunner,
    TaskComputeDeliveryConnectedRunnerShape
  >()("flarex-backend/taskComputeDelivery/ConnectedRunner") {}

interface RunnerCounters {
  directoryPagesCharged: number;
  scopeVisits: number;
  scopeResolutionFailures: number;
  discoveryFailures: number;
  dispatchPagesCharged: number;
  cancellationPagesCharged: number;
  dispatchCandidatesCharged: number;
  cancellationCandidatesCharged: number;
  dispatchProviderCallsCharged: number;
  cancellationProviderCallsCharged: number;
  totalOperationsCharged: number;
  confirmedDispatchPagesRead: number;
  confirmedCancellationPagesRead: number;
  confirmedDispatchCandidatesHandled: number;
  confirmedCancellationCandidatesHandled: number;
  confirmedDispatchProviderCalls: number;
  confirmedCancellationProviderCalls: number;
  candidateFailures: number;
}

type CandidateRunnerFailure =
  | TaskComputeDispatchCandidateRunnerError
  | TaskComputeCancellationCandidateRunnerError
  | TaskComputeDeliveryConnectedRunnerOperationTimeoutError<
      "dispatch_candidate" | "cancellation_candidate"
    >;

export function makeTaskComputeDeliveryConnectedRunnerLayer(
  options: TaskComputeDeliveryConnectedRunnerOptions,
): Layer.Layer<
  TaskComputeDeliveryConnectedRunner,
  TaskComputeDeliveryConnectedRunnerConfigurationError,
  TaskComputeDeliveryTrustedDirectory | TaskComputeDeliveryCandidateRunner
> {
  return Layer.effect(
    TaskComputeDeliveryConnectedRunner,
    Effect.gen(function* () {
      const policy = yield* Effect.fromResult(capturePolicy(options));
      const directoryOwner = yield* TaskComputeDeliveryTrustedDirectory;
      const candidateRunnerOwner = yield* TaskComputeDeliveryCandidateRunner;
      const directoryBudgets = yield* Effect.fromResult(
        captureDirectorySettlementBudgets(directoryOwner, policy),
      );
      const discoverMethod = directoryOwner.discover;
      const resolveMethod = directoryOwner.resolve;
      const runDispatchMethod = candidateRunnerOwner.runDispatch;
      const runCancellationMethod = candidateRunnerOwner.runCancellation;

      const run: TaskComputeDeliveryConnectedRunnerShape["run"] = Effect.fn(
        "TaskComputeDeliveryConnectedRunner.run",
      )(function* (suppliedContinuation) {
        let state = suppliedContinuation === null
          ? freshContinuation()
          : yield* decodeTaskComputeDeliveryConnectedContinuationV1(
            suppliedContinuation,
          );
        const counters = freshCounters();
        const startedAt = yield* Clock.currentTimeNanos;
        const deadline = startedAt + policy.maximumRunNanoseconds;
        let located: TaskComputeDeliveryTrustedDirectoryReadyItem | null = null;

        while (true) {
          let ready: TaskComputeDeliveryTrustedDirectoryReadyItem;
          let active: TaskComputeDeliveryConnectedActiveScopeV1;

          if (state.activeScope !== null) {
            if (
              located !== null
              && located.deploymentId ===
                state.activeScope.expectedDeploymentId
              && located.scopeId === state.activeScope.expectedScopeId
            ) {
              ready = located;
            } else {
              if (counters.scopeVisits >= policy.maximumScopeVisits) {
                return yield* complete(
                  "scope_visit_budget",
                  counters,
                  state,
                );
              }
              const budget = yield* operationBudget(
                deadline,
                policy,
                directoryBudgets.resolveNanoseconds,
              );
              if (budget === null) {
                return yield* complete(
                  hasStarted(counters) ? "time_budget" : "no_time_to_start",
                  counters,
                  state,
                );
              }
              const item = yield* Effect.fromResult(captureDirectoryItem(
                yield* resolveMethod.call(directoryOwner, {
                  deploymentId: state.activeScope.expectedDeploymentId,
                  scopeId: state.activeScope.expectedScopeId,
                }).pipe(timeoutOperation("resolve", budget)),
              ));
              counters.scopeVisits += 1;
              if (
                item.deploymentId !== state.activeScope.expectedDeploymentId
                || item.scopeId !== state.activeScope.expectedScopeId
              ) {
                return yield*
                  new TaskComputeDeliveryConnectedRunnerContractError({
                    operation: "directory",
                    reason: "resolved_item_mismatch",
                  });
              }
              if (item.kind === "failed") {
                counters.scopeResolutionFailures += 1;
                const next = afterActiveScope(state.activeScope);
                if (next === null) {
                  return yield* complete("cycle_exhausted", counters, null);
                }
                located = null;
                state = next;
                continue;
              }
              ready = item;
              located = item;
            }
            active = state.activeScope;
          } else {
            if (state.directory.kind === "exhausted") {
              return yield* complete("cycle_exhausted", counters, null);
            }
            if (counters.directoryPagesCharged >= policy.maximumDirectoryPages) {
              return yield* complete("directory_budget", counters, state);
            }
            if (counters.scopeVisits >= policy.maximumScopeVisits) {
              return yield* complete("scope_visit_budget", counters, state);
            }
            const budget = yield* operationBudget(
              deadline,
              policy,
              directoryBudgets.discoverNanoseconds,
            );
            if (budget === null) {
              return yield* complete(
                hasStarted(counters) ? "time_budget" : "no_time_to_start",
                counters,
                state,
              );
            }
            counters.directoryPagesCharged += 1;
            const page = yield* Effect.fromResult(captureDirectoryPage(
              yield* discoverMethod.call(directoryOwner, {
                limit: 1,
                ...(state.directory.kind === "continuing"
                  ? { continuation: state.directory.continuation }
                  : {}),
              }).pipe(timeoutOperation("directory", budget)),
              state.directory,
            ));
            if (page.items.length > 1) {
              return yield* new TaskComputeDeliveryConnectedRunnerContractError({
                operation: "directory",
                reason: "directory_item_overflow",
              });
            }
            const item = page.items[0];
            if (item === undefined) {
              if (page.continuation === null) {
                return yield* complete("cycle_exhausted", counters, null);
              }
              state = continueDirectory(page.continuation);
              continue;
            }
            counters.scopeVisits += 1;
            const directoryAfter = directoryStateAfter(
              page.continuation,
              item.scopeId,
            );
            if (item.kind === "failed") {
              counters.scopeResolutionFailures += 1;
              const next = afterDirectoryPosition(directoryAfter);
              if (next === null) {
                return yield* complete("cycle_exhausted", counters, null);
              }
              state = next;
              continue;
            }
            ready = item;
            located = item;
            active = freshActiveScope(item, directoryAfter);
          }

          const normalized = normalizeScopeCeilings(active, policy);
          if (normalized === null) {
            const next = afterActiveScope(active);
            if (next === null) {
              return yield* complete("cycle_exhausted", counters, null);
            }
            located = null;
            state = next;
            continue;
          }
          active = normalized;
          state = withActiveScope(state.directory, active);

          const operation = active.nextOperation;
          const budgetStop = pageBudgetStop(operation, counters, policy);
          if (budgetStop !== null) {
            return yield* complete(budgetStop, counters, state);
          }
          const budget = yield* operationBudget(deadline, policy);
          if (budget === null) {
            return yield* complete(
              hasStarted(counters) ? "time_budget" : "no_time_to_start",
              counters,
              state,
            );
          }

          chargePageAdmission(operation, counters, policy.candidatesPerPage);
          active = chargeActivePage(active, operation);
          state = withActiveScope(state.directory, active);
          const discoveryOutcome = yield* discoverCandidates(
            ready.discovery,
            operation,
            active,
            policy,
          ).pipe(
            timeoutOperation(
                operation === "dispatch"
                  ? "dispatch_discovery"
                  : "cancellation_discovery",
                budget,
              ),
            Effect.matchEffect({
              onFailure: (failure) => failure instanceof
                  TaskComputeDeliveryConnectedRunnerContractError
                ? Effect.fail(failure)
                : Effect.succeed(Object.freeze({
                  kind: "failed" as const,
                  failure,
                })),
              onSuccess: (page) => Effect.succeed(Object.freeze({
                kind: "page" as const,
                page,
              })),
            }),
          );
          if (discoveryOutcome.kind === "failed") {
            counters.discoveryFailures += 1;
            active = flipOperation(active, operation);
            state = withActiveScope(state.directory, active);
            continue;
          }

          const page = discoveryOutcome.page;
          confirmPage(operation, counters, page.candidates.length);
          for (const candidate of page.candidates) {
            const candidateBudget = yield* operationBudget(deadline, policy);
            if (candidateBudget === null) {
              return yield* complete("time_budget", counters, state);
            }
            chargeCandidateOperation(operation, counters);
            const candidateOutcome = yield* runCandidate(
                candidateRunnerOwner,
                runDispatchMethod,
                runCancellationMethod,
                ready,
                operation,
                candidate,
              ).pipe(
                timeoutOperation(
                operation === "dispatch"
                  ? "dispatch_candidate"
                  : "cancellation_candidate",
                candidateBudget,
                ),
                Effect.matchEffect({
                  onFailure: (failure) => failure instanceof
                      TaskComputeDeliveryConnectedRunnerContractError
                    ? Effect.fail(failure)
                    : Effect.succeed(Object.freeze({
                      kind: "failed" as const,
                      failure,
                    })),
                  onSuccess: (outcome) => Effect.succeed(Object.freeze({
                    kind: "completed" as const,
                    outcome,
                  })),
                }),
              );
            if (candidateOutcome.kind === "failed") {
              countCandidateFailure(counters, candidateOutcome.failure);
              continue;
            }
            const confirmed = yield* Effect.fromResult(
              captureCandidateOutcome(operation, candidateOutcome.outcome),
            );
            confirmCandidateOutcome(operation, counters, confirmed);
          }

          active = yield* Effect.fromResult(completeOperationPage(
            active,
            operation,
            page.continuation,
          ));
          const nextActive = normalizeScopeCeilings(active, policy);
          if (nextActive === null) {
            const next = afterActiveScope(active);
            if (next === null) {
              return yield* complete("cycle_exhausted", counters, null);
            }
            located = null;
            state = next;
            continue;
          }
          state = withActiveScope(state.directory, nextActive);
        }
      });

      return TaskComputeDeliveryConnectedRunner.of(Object.freeze({ run }));
    }),
  );
}

function capturePolicy(
  input: TaskComputeDeliveryConnectedRunnerOptions,
): Result.Result<
  CapturedRunnerPolicy,
  TaskComputeDeliveryConnectedRunnerConfigurationError
> {
  return Result.try({
    try: () => Object.freeze({
      maximumDirectoryPages: input.maximumDirectoryPages,
      maximumScopeVisits: input.maximumScopeVisits,
      maximumDispatchPages: input.maximumDispatchPages,
      maximumCancellationPages: input.maximumCancellationPages,
      maximumDispatchCandidates: input.maximumDispatchCandidates,
      maximumCancellationCandidates: input.maximumCancellationCandidates,
      maximumDispatchProviderCalls: input.maximumDispatchProviderCalls,
      maximumCancellationProviderCalls: input.maximumCancellationProviderCalls,
      maximumTotalOperations: input.maximumTotalOperations,
      maximumDispatchPagesPerScope: input.maximumDispatchPagesPerScope,
      maximumCancellationPagesPerScope:
        input.maximumCancellationPagesPerScope,
      candidatesPerPage: input.candidatesPerPage,
      maximumRunMilliseconds: input.maximumRunMilliseconds,
      maximumOperationMilliseconds: input.maximumOperationMilliseconds,
      settlementReserveMilliseconds: input.settlementReserveMilliseconds,
    }),
    catch: (cause) => new TaskComputeDeliveryConnectedRunnerConfigurationError({
      reason: "invalid_policy",
      cause,
    }),
  }).pipe(
    Result.flatMap((captured) => {
      if (
        !isPositiveSafeInteger(captured.maximumRunMilliseconds)
        || !isPositiveSafeInteger(captured.maximumOperationMilliseconds)
        || !isPositiveSafeInteger(captured.settlementReserveMilliseconds)
      ) {
        return Result.fail(
          new TaskComputeDeliveryConnectedRunnerConfigurationError({
            reason: "invalid_policy",
          }),
        );
      }
      const operationAndReserve = captured.maximumOperationMilliseconds
        + captured.settlementReserveMilliseconds;
      const counts = [
        captured.maximumDirectoryPages,
        captured.maximumScopeVisits,
        captured.maximumDispatchPages,
        captured.maximumCancellationPages,
        captured.maximumDispatchCandidates,
        captured.maximumCancellationCandidates,
        captured.maximumDispatchProviderCalls,
        captured.maximumCancellationProviderCalls,
        captured.maximumTotalOperations,
        captured.maximumDispatchPagesPerScope,
        captured.maximumCancellationPagesPerScope,
        captured.candidatesPerPage,
      ];
      if (
        counts.some((value) =>
          !isPositiveSafeInteger(value) || value > MAX_CONNECTED_RUNNER_COUNT
        )
        || captured.maximumDispatchPagesPerScope >
          MAX_TASK_COMPUTE_DELIVERY_SCOPE_PAGE_CHARGES
        || captured.maximumCancellationPagesPerScope >
          MAX_TASK_COMPUTE_DELIVERY_SCOPE_PAGE_CHARGES
        || captured.candidatesPerPage > 100
        || captured.candidatesPerPage > captured.maximumDispatchCandidates
        || captured.candidatesPerPage > captured.maximumCancellationCandidates
        || captured.candidatesPerPage > captured.maximumDispatchProviderCalls
        || captured.candidatesPerPage >
          captured.maximumCancellationProviderCalls
        || captured.candidatesPerPage > captured.maximumTotalOperations
        || !Number.isSafeInteger(operationAndReserve)
        || operationAndReserve > captured.maximumRunMilliseconds
      ) {
        return Result.fail(
          new TaskComputeDeliveryConnectedRunnerConfigurationError({
            reason: "invalid_policy",
          }),
        );
      }
      return Result.succeed(Object.freeze({
        ...captured,
        maximumRunNanoseconds: toNanoseconds(
          captured.maximumRunMilliseconds,
        ),
        maximumOperationNanoseconds: toNanoseconds(
          captured.maximumOperationMilliseconds,
        ),
        settlementReserveNanoseconds: toNanoseconds(
          captured.settlementReserveMilliseconds,
        ),
      }));
    }),
  );
}

function captureDirectorySettlementBudgets(
  directory: TaskComputeDeliveryTrustedDirectoryShape,
  policy: CapturedRunnerPolicy,
): Result.Result<
  CapturedDirectorySettlementBudgets,
  TaskComputeDeliveryConnectedRunnerConfigurationError
> {
  return Result.try({
    try: () => Object.freeze({
      discoverMilliseconds:
        directory.singleCandidateDiscoverSettlementBudgetMilliseconds,
      resolveMilliseconds: directory.resolveSettlementBudgetMilliseconds,
    }),
    catch: (cause) => new TaskComputeDeliveryConnectedRunnerConfigurationError({
      reason: "invalid_policy",
      cause,
    }),
  }).pipe(
    Result.flatMap((captured) => {
      if (
        !isPositiveSafeInteger(captured.discoverMilliseconds)
        || !isPositiveSafeInteger(captured.resolveMilliseconds)
        || captured.discoverMilliseconds > policy.maximumOperationMilliseconds
        || captured.resolveMilliseconds > policy.maximumOperationMilliseconds
      ) {
        return Result.fail(
          new TaskComputeDeliveryConnectedRunnerConfigurationError({
            reason: "invalid_policy",
          }),
        );
      }
      return Result.succeed(Object.freeze({
        discoverNanoseconds: toNanoseconds(captured.discoverMilliseconds),
        resolveNanoseconds: toNanoseconds(captured.resolveMilliseconds),
      }));
    }),
  );
}

function captureDirectoryPage(
  page: TaskComputeDeliveryTrustedDirectoryPage,
  expectedState: TaskComputeDeliveryConnectedDirectoryStateV1,
): Result.Result<
  TaskComputeDeliveryTrustedDirectoryPage,
  TaskComputeDeliveryConnectedRunnerContractError
> {
  return Result.gen(function* () {
    const fields = yield* Result.try({
      try: () => Object.freeze({
        items: Array.from(page.items),
        continuation: page.continuation,
      }),
      catch: (cause) =>
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation: "directory",
          reason: "directory_page_capture_invalid",
          cause,
        }),
    });
    if (fields.items.length > 1) {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation: "directory",
          reason: "directory_item_overflow",
        }),
      );
    }
    const items: TaskComputeDeliveryTrustedDirectoryItem[] = [];
    for (const item of fields.items) {
      items.push(yield* captureDirectoryItem(item));
    }
    const continuation = fields.continuation === null
      ? null
      : yield* decodeReplacementScopeDirectoryContinuationV1(
        fields.continuation,
      ).pipe(
        Result.mapError((cause) =>
          new TaskComputeDeliveryConnectedRunnerContractError({
            operation: "directory",
            reason: "directory_continuation_invalid",
            cause,
          })
        ),
      );
    const item = items[0];
    if (
      item !== undefined
      && continuation !== null
      && continuation.lastScopeId !== item.scopeId
    ) {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation: "directory",
          reason: "directory_continuation_invalid",
        }),
      );
    }
    if (expectedState.kind === "continuing") {
      const expected = expectedState.continuation;
      const correlation = yield* Result.try({
        try: () => Object.freeze({
          continuationInvalid: continuation !== null
            && (
              continuation.highWaterScopeId !== expected.highWaterScopeId
              || continuation.lastScopeId <= expected.lastScopeId
            ),
          itemInvalid: item !== undefined
            && (
              item.scopeId <= expected.lastScopeId
              || item.scopeId > expected.highWaterScopeId
            ),
        }),
        catch: (cause) =>
          new TaskComputeDeliveryConnectedRunnerContractError({
            operation: "directory",
            reason: "directory_continuation_invalid",
            cause,
          }),
      });
      if (
        correlation.continuationInvalid
      ) {
        return yield* Result.fail(
          new TaskComputeDeliveryConnectedRunnerContractError({
            operation: "directory",
            reason: "directory_continuation_invalid",
          }),
        );
      }
      if (
        correlation.itemInvalid
      ) {
        return yield* Result.fail(
          new TaskComputeDeliveryConnectedRunnerContractError({
            operation: "directory",
            reason: "directory_continuation_invalid",
          }),
        );
      }
    }
    return Object.freeze({ items: Object.freeze(items), continuation });
  });
}

function captureDirectoryItem(
  item: TaskComputeDeliveryTrustedDirectoryItem,
): Result.Result<
  TaskComputeDeliveryTrustedDirectoryItem,
  TaskComputeDeliveryConnectedRunnerContractError
> {
  return Result.try({
    try: () => {
      const kind = item.kind;
      const deploymentId = item.deploymentId;
      const scopeId = item.scopeId;
      if (kind === "failed") {
        const reason = item.reason;
        return Object.freeze({ kind, deploymentId, scopeId, reason });
      }
      const discoveryOwner = item.discovery;
      const discoverDispatch = discoveryOwner.discoverDispatchCandidates;
      const discoverCancellation =
        discoveryOwner.discoverCancellationCandidates;
      if (
        typeof discoverDispatch !== "function"
        || typeof discoverCancellation !== "function"
      ) {
        throw INVALID_DIRECTORY_ITEM;
      }
      const capturedDispatch:
        TaskComputeDeliveryCandidateDiscovery["discoverDispatchCandidates"] =
          (request) => discoverDispatch.call(discoveryOwner, request);
      const capturedCancellation:
        TaskComputeDeliveryCandidateDiscovery[
          "discoverCancellationCandidates"
        ] = (request) => discoverCancellation.call(discoveryOwner, request);
      const discovery: TaskComputeDeliveryCandidateDiscovery = Object.freeze({
        discoverDispatchCandidates: capturedDispatch,
        discoverCancellationCandidates: capturedCancellation,
      });
      const repository = item.repository;
      return Object.freeze({
        kind,
        deploymentId,
        scopeId,
        discovery,
        repository,
      });
    },
    catch: (cause) => new TaskComputeDeliveryConnectedRunnerContractError({
      operation: "directory",
      reason: "directory_item_capture_invalid",
      ...(cause === INVALID_DIRECTORY_ITEM ? {} : { cause }),
    }),
  });
}

function discoverCandidates(
  discovery: TaskComputeDeliveryCandidateDiscovery,
  operation: TaskComputeDeliveryOperation,
  active: TaskComputeDeliveryConnectedActiveScopeV1,
  policy: CapturedRunnerPolicy,
): Effect.Effect<
  TaskComputeDeliveryCandidatePage,
  | TaskComputeDeliveryDiscoveryError
  | TaskComputeDeliveryConnectedRunnerContractError
> {
  const owner = discovery;
  if (operation === "dispatch") {
    const state = active.dispatch;
    const expectedContinuation = state.kind === "continuing"
      ? state.continuation
      : null;
    const request = {
      limit: policy.candidatesPerPage,
      ...(expectedContinuation === null
        ? {}
        : { continuation: expectedContinuation }),
    };
    return discovery.discoverDispatchCandidates.call(owner, request).pipe(
      Effect.flatMap((page) => validateCandidatePage(
        page,
        "dispatch",
        policy,
        expectedContinuation,
      )),
    );
  }
  const state = active.cancellation;
  const expectedContinuation = state.kind === "continuing"
    ? state.continuation
    : null;
  const request = {
    limit: policy.candidatesPerPage,
    ...(expectedContinuation === null
      ? {}
      : { continuation: expectedContinuation }),
  };
  return discovery.discoverCancellationCandidates.call(owner, request).pipe(
      Effect.flatMap((page) => validateCandidatePage(
        page,
        "cancellation",
        policy,
        expectedContinuation,
      )),
  );
}

function validateCandidatePage<Operation extends TaskComputeDeliveryOperation>(
  page: TaskComputeDeliveryCandidatePage<Operation>,
  operation: Operation,
  policy: CapturedRunnerPolicy,
  expectedContinuation: TaskComputeDeliveryContinuationV1<Operation> | null,
): Effect.Effect<
  TaskComputeDeliveryCandidatePage<Operation>,
  TaskComputeDeliveryConnectedRunnerContractError
> {
  return Effect.fromResult(Result.gen(function* () {
    const fields = yield* Result.try({
      try: () => Object.freeze({
        operation: page.operation,
        databaseTimeBound: page.databaseTimeBound,
        candidates: Array.from(page.candidates),
        continuation: page.continuation,
      }),
      catch: (cause) => new TaskComputeDeliveryConnectedRunnerContractError({
        operation,
        reason: "page_capture_invalid",
        cause,
      }),
    });
    if (fields.operation !== operation) {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "page_operation_mismatch",
        }),
      );
    }
    if (fields.candidates.length > policy.candidatesPerPage) {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "page_candidate_overflow",
        }),
      );
    }
    const candidates: Array<TaskComputeDeliveryCandidate<Operation>> = [];
    for (const candidate of fields.candidates) {
      candidates.push(yield* captureCandidate(candidate, operation));
    }
    const continuation = fields.continuation === null
      ? null
      : yield* decodeTaskComputeDeliveryContinuationV1(
        fields.continuation,
      ).pipe(
        Result.mapError((cause) =>
          new TaskComputeDeliveryConnectedRunnerContractError({
            operation,
            reason: "continuation_operation_mismatch",
            cause,
          })
        ),
        Result.flatMap((decoded) => continuationForOperation(decoded, operation)
          ? Result.succeed(decoded)
          : Result.fail(
            new TaskComputeDeliveryConnectedRunnerContractError({
              operation,
              reason: "continuation_operation_mismatch",
            }),
          )),
      );
    if (
      continuation !== null
      && continuation.databaseTimeBound !== fields.databaseTimeBound
    ) {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "continuation_snapshot_mismatch",
        }),
      );
    }
    if (
      expectedContinuation !== null
      && (
        fields.databaseTimeBound !== expectedContinuation.databaseTimeBound
        || (
          continuation !== null
          && !sameContinuationPosition(
            continuation.highWater,
            expectedContinuation.highWater,
          )
        )
      )
    ) {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "continuation_snapshot_mismatch",
        }),
      );
    }
    const positionCorrelation = yield* Result.try({
      try: () => Object.freeze({
        outsideSnapshot: expectedContinuation !== null
          && candidates.some((candidate) =>
            compareCandidateToContinuationPosition(
              candidate,
              expectedContinuation.last,
            ) <= 0
            || compareCandidateToContinuationPosition(
              candidate,
              expectedContinuation.highWater,
            ) > 0
          ),
        unordered: candidates.some((candidate, index) =>
          index > 0
          && compareCandidates(candidates[index - 1]!, candidate) >= 0
        ),
        continuationLastMismatch: continuation !== null
          && (
            candidates.length === 0
            || compareCandidateToContinuationPosition(
              candidates[candidates.length - 1]!,
              continuation.last,
            ) !== 0
          ),
      }),
      catch: (cause) =>
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "candidate_capture_invalid",
          cause,
        }),
    });
    if (positionCorrelation.outsideSnapshot) {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "candidate_outside_snapshot",
        }),
      );
    }
    if (positionCorrelation.unordered) {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "candidate_ordering_mismatch",
        }),
      );
    }
    if (positionCorrelation.continuationLastMismatch) {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "continuation_last_mismatch",
        }),
      );
    }
    return Object.freeze({
      operation,
      databaseTimeBound: fields.databaseTimeBound,
      candidates: Object.freeze(candidates),
      continuation,
    });
  }));
}

function sameContinuationPosition(
  left: TaskComputeDeliveryContinuationV1["highWater"],
  right: TaskComputeDeliveryContinuationV1["highWater"],
): boolean {
  return left.eligibleAt === right.eligibleAt
    && left.runId === right.runId
    && left.requestedEffectSequence === right.requestedEffectSequence;
}

function compareCandidateToContinuationPosition(
  candidate: TaskComputeDeliveryCandidate,
  position: TaskComputeDeliveryContinuationV1["highWater"],
): number {
  const candidateMilliseconds = Date.parse(candidate.eligibleAt);
  const positionMilliseconds = Date.parse(position.eligibleAt);
  if (candidateMilliseconds !== positionMilliseconds) {
    return candidateMilliseconds < positionMilliseconds ? -1 : 1;
  }
  if (candidate.runId !== position.runId) {
    return candidate.runId < position.runId ? -1 : 1;
  }
  const positionSequence = BigInt(position.requestedEffectSequence);
  if (candidate.requestedEffectSequence === positionSequence) return 0;
  return candidate.requestedEffectSequence < positionSequence ? -1 : 1;
}

function compareCandidates(
  left: TaskComputeDeliveryCandidate,
  right: TaskComputeDeliveryCandidate,
): number {
  const leftMilliseconds = Date.parse(left.eligibleAt);
  const rightMilliseconds = Date.parse(right.eligibleAt);
  if (leftMilliseconds !== rightMilliseconds) {
    return leftMilliseconds < rightMilliseconds ? -1 : 1;
  }
  if (left.runId !== right.runId) return left.runId < right.runId ? -1 : 1;
  if (left.requestedEffectSequence === right.requestedEffectSequence) return 0;
  return left.requestedEffectSequence < right.requestedEffectSequence ? -1 : 1;
}

function captureCandidate<Operation extends TaskComputeDeliveryOperation>(
  candidate: TaskComputeDeliveryCandidate,
  operation: Operation,
): Result.Result<
  TaskComputeDeliveryCandidate<Operation>,
  TaskComputeDeliveryConnectedRunnerContractError
> {
  return Result.try({
    try: () => Object.freeze({
      operation: candidate.operation,
      eligibleAt: candidate.eligibleAt,
      runId: candidate.runId,
      requestedEffectSequence: candidate.requestedEffectSequence,
    }),
    catch: (cause) => new TaskComputeDeliveryConnectedRunnerContractError({
      operation,
      reason: "candidate_capture_invalid",
      cause,
    }),
  }).pipe(
    Result.flatMap((captured) => captured.operation === operation
      ? Result.succeed(Object.freeze({
        operation,
        eligibleAt: captured.eligibleAt,
        runId: captured.runId,
        requestedEffectSequence: captured.requestedEffectSequence,
      }))
      : Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "candidate_operation_mismatch",
        }),
      )),
  );
}

function runCandidate(
  owner: TaskComputeDeliveryCandidateRunnerShape,
  runDispatch: TaskComputeDeliveryCandidateRunnerShape["runDispatch"],
  runCancellation: TaskComputeDeliveryCandidateRunnerShape["runCancellation"],
  ready: TaskComputeDeliveryTrustedDirectoryReadyItem,
  operation: TaskComputeDeliveryOperation,
  candidate: TaskComputeDeliveryCandidate,
): Effect.Effect<
  TaskComputeDispatchCandidateOutcome | TaskComputeCancellationCandidateOutcome,
  | TaskComputeDispatchCandidateRunnerError
  | TaskComputeCancellationCandidateRunnerError
  | TaskComputeDeliveryConnectedRunnerContractError
> {
  return operation === "dispatch" && candidateForOperation(candidate, "dispatch")
    ? runDispatch.call(owner, ready.repository, candidate)
    : operation === "cancellation"
      && candidateForOperation(candidate, "cancellation")
    ? runCancellation.call(owner, ready.repository, candidate)
    : Effect.fail(new TaskComputeDeliveryConnectedRunnerContractError({
      operation,
      reason: "candidate_operation_mismatch",
    }));
}

function candidateForOperation<Operation extends TaskComputeDeliveryOperation>(
  candidate: TaskComputeDeliveryCandidate,
  operation: Operation,
): candidate is TaskComputeDeliveryCandidate<Operation> {
  return candidate.operation === operation;
}

function timeoutOperation<
  Success,
  Failure,
  Operation extends TaskComputeDeliveryConnectedRunnerOperation,
>(
  operation: Operation,
  budgetNanoseconds: bigint,
) {
  return (
    effect: Effect.Effect<Success, Failure>,
  ): Effect.Effect<
    Success,
    Failure | TaskComputeDeliveryConnectedRunnerOperationTimeoutError<Operation>
  > => Effect.scoped(Effect.gen(function* () {
    const operationFiber = yield* effect.pipe(Effect.forkScoped);
    return yield* Fiber.join(operationFiber).pipe(Effect.timeoutOrElse({
      duration: Duration.nanos(budgetNanoseconds),
      orElse: () => Effect.fail(
        new TaskComputeDeliveryConnectedRunnerOperationTimeoutError<Operation>({
          operation,
          budgetNanoseconds,
        }),
      ),
    }));
  }));
}

function operationBudget(
  deadline: bigint,
  policy: CapturedRunnerPolicy,
  requiredNanoseconds?: bigint,
): Effect.Effect<bigint | null> {
  return Effect.map(Clock.currentTimeNanos, (now) => {
    const available = deadline - now - policy.settlementReserveNanoseconds;
    if (available <= 0n) return null;
    if (requiredNanoseconds !== undefined) {
      return available < requiredNanoseconds ? null : requiredNanoseconds;
    }
    return available < policy.maximumOperationNanoseconds
      ? available
      : policy.maximumOperationNanoseconds;
  });
}

function pageBudgetStop(
  operation: TaskComputeDeliveryOperation,
  counters: RunnerCounters,
  policy: CapturedRunnerPolicy,
): TaskComputeDeliveryConnectedRunnerStopReason | null {
  if (counters.totalOperationsCharged + policy.candidatesPerPage >
    policy.maximumTotalOperations) return "total_operation_budget";
  if (operation === "dispatch") {
    if (counters.dispatchPagesCharged >= policy.maximumDispatchPages) {
      return "dispatch_page_budget";
    }
    if (counters.dispatchCandidatesCharged + policy.candidatesPerPage >
      policy.maximumDispatchCandidates) return "dispatch_candidate_budget";
    if (counters.dispatchProviderCallsCharged + policy.candidatesPerPage >
      policy.maximumDispatchProviderCalls) return "dispatch_provider_budget";
    return null;
  }
  if (counters.cancellationPagesCharged >= policy.maximumCancellationPages) {
    return "cancellation_page_budget";
  }
  if (counters.cancellationCandidatesCharged + policy.candidatesPerPage >
    policy.maximumCancellationCandidates) {
    return "cancellation_candidate_budget";
  }
  return counters.cancellationProviderCallsCharged + policy.candidatesPerPage >
      policy.maximumCancellationProviderCalls
    ? "cancellation_provider_budget"
    : null;
}

function chargePageAdmission(
  operation: TaskComputeDeliveryOperation,
  counters: RunnerCounters,
  candidateCharge: number,
): void {
  if (operation === "dispatch") {
    counters.dispatchPagesCharged += 1;
    counters.dispatchCandidatesCharged += candidateCharge;
  } else {
    counters.cancellationPagesCharged += 1;
    counters.cancellationCandidatesCharged += candidateCharge;
  }
}

function chargeCandidateOperation(
  operation: TaskComputeDeliveryOperation,
  counters: RunnerCounters,
): void {
  counters.totalOperationsCharged += 1;
  if (operation === "dispatch") {
    counters.dispatchProviderCallsCharged += 1;
  } else {
    counters.cancellationProviderCallsCharged += 1;
  }
}

function confirmPage(
  operation: TaskComputeDeliveryOperation,
  counters: RunnerCounters,
  _candidates: number,
): void {
  if (operation === "dispatch") counters.confirmedDispatchPagesRead += 1;
  else counters.confirmedCancellationPagesRead += 1;
}

function confirmCandidateOutcome(
  operation: TaskComputeDeliveryOperation,
  counters: RunnerCounters,
  outcome: Readonly<{ readonly providerCalled: boolean }>,
): void {
  if (operation === "dispatch") {
    counters.confirmedDispatchCandidatesHandled += 1;
    if (outcome.providerCalled) {
      counters.confirmedDispatchProviderCalls += 1;
    }
  } else {
    counters.confirmedCancellationCandidatesHandled += 1;
    if (outcome.providerCalled) {
      counters.confirmedCancellationProviderCalls += 1;
    }
  }
}

function captureCandidateOutcome(
  operation: TaskComputeDeliveryOperation,
  outcome:
    | TaskComputeDispatchCandidateOutcome
    | TaskComputeCancellationCandidateOutcome,
): Result.Result<
  Readonly<{ readonly providerCalled: boolean }>,
  TaskComputeDeliveryConnectedRunnerContractError
> {
  return Result.gen(function* () {
    const kind = yield* Result.try({
      try: () => outcome.kind,
      catch: (cause) => new TaskComputeDeliveryConnectedRunnerContractError({
        operation,
        reason: "candidate_outcome_mismatch",
        cause,
      }),
    });
    let providerCalled: boolean;
    if (operation === "dispatch") {
      if (kind === "dispatch_not_called") providerCalled = false;
      else if (kind === "dispatch_accepted" || kind === "dispatch_known_failure") {
        providerCalled = true;
      } else {
        return yield* Result.fail(
          new TaskComputeDeliveryConnectedRunnerContractError({
            operation,
            reason: "candidate_outcome_mismatch",
          }),
        );
      }
    } else if (kind === "cancellation_not_called") providerCalled = false;
    else if (
      kind === "cancellation_delivered"
      || kind === "cancellation_known_failure"
    ) providerCalled = true;
    else {
      return yield* Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "candidate_outcome_mismatch",
        }),
      );
    }
    return Object.freeze({ providerCalled });
  });
}

function countCandidateFailure(
  counters: RunnerCounters,
  _failure: CandidateRunnerFailure,
): void {
  counters.candidateFailures += 1;
}

function chargeActivePage(
  active: TaskComputeDeliveryConnectedActiveScopeV1,
  operation: TaskComputeDeliveryOperation,
): TaskComputeDeliveryConnectedActiveScopeV1 {
  return Object.freeze({
    ...active,
    ...(operation === "dispatch"
      ? { dispatchPagesCharged: active.dispatchPagesCharged + 1 }
      : { cancellationPagesCharged: active.cancellationPagesCharged + 1 }),
  });
}

function completeOperationPage(
  active: TaskComputeDeliveryConnectedActiveScopeV1,
  operation: TaskComputeDeliveryOperation,
  continuation: TaskComputeDeliveryContinuationV1 | null,
): Result.Result<
  TaskComputeDeliveryConnectedActiveScopeV1,
  TaskComputeDeliveryConnectedRunnerContractError
> {
  if (operation === "dispatch") {
    if (
      continuation !== null
      && !continuationForOperation(continuation, "dispatch")
    ) {
      return Result.fail(
        new TaskComputeDeliveryConnectedRunnerContractError({
          operation,
          reason: "continuation_operation_mismatch",
        }),
      );
    }
    const state: TaskComputeDeliveryConnectedOperationStateV1<"dispatch"> =
      continuation === null
        ? Object.freeze({ kind: "exhausted" })
        : Object.freeze({ kind: "continuing", continuation });
    return Result.succeed(Object.freeze({
      ...active,
      dispatch: state,
      nextOperation: "cancellation",
    }));
  }
  if (
    continuation !== null
    && !continuationForOperation(continuation, "cancellation")
  ) {
    return Result.fail(
      new TaskComputeDeliveryConnectedRunnerContractError({
        operation,
        reason: "continuation_operation_mismatch",
      }),
    );
  }
  const state: TaskComputeDeliveryConnectedOperationStateV1<"cancellation"> =
    continuation === null
      ? Object.freeze({ kind: "exhausted" })
      : Object.freeze({ kind: "continuing", continuation });
  return Result.succeed(Object.freeze({
    ...active,
    cancellation: state,
    nextOperation: "dispatch",
  }));
}

function continuationForOperation<Operation extends TaskComputeDeliveryOperation>(
  continuation: TaskComputeDeliveryContinuationV1,
  operation: Operation,
): continuation is TaskComputeDeliveryContinuationV1<Operation> {
  return continuation.operation === operation;
}

function flipOperation(
  active: TaskComputeDeliveryConnectedActiveScopeV1,
  operation: TaskComputeDeliveryOperation,
): TaskComputeDeliveryConnectedActiveScopeV1 {
  return Object.freeze({
    ...active,
    nextOperation: operation === "dispatch" ? "cancellation" : "dispatch",
  });
}

function normalizeScopeCeilings(
  active: TaskComputeDeliveryConnectedActiveScopeV1,
  policy: CapturedRunnerPolicy,
): TaskComputeDeliveryConnectedActiveScopeV1 | null {
  const dispatchDone = active.dispatch.kind === "exhausted"
    || active.dispatchPagesCharged >= policy.maximumDispatchPagesPerScope;
  const cancellationDone = active.cancellation.kind === "exhausted"
    || active.cancellationPagesCharged >=
      policy.maximumCancellationPagesPerScope;
  if (dispatchDone && cancellationDone) return null;
  const dispatch = dispatchDone
    ? Object.freeze({ kind: "exhausted" as const })
    : active.dispatch;
  const cancellation = cancellationDone
    ? Object.freeze({ kind: "exhausted" as const })
    : active.cancellation;
  const nextOperation = active.nextOperation === "dispatch" && dispatchDone
    ? "cancellation"
    : active.nextOperation === "cancellation" && cancellationDone
    ? "dispatch"
    : active.nextOperation;
  return Object.freeze({ ...active, dispatch, cancellation, nextOperation });
}

function freshActiveScope(
  item: TaskComputeDeliveryTrustedDirectoryReadyItem,
  directoryAfter: TaskComputeDeliveryConnectedDirectoryAfterV1,
): TaskComputeDeliveryConnectedActiveScopeV1 {
  return Object.freeze({
    expectedDeploymentId: item.deploymentId,
    expectedScopeId: item.scopeId,
    directoryAfter,
    nextOperation: "dispatch",
    dispatch: Object.freeze({ kind: "unstarted" }),
    cancellation: Object.freeze({ kind: "unstarted" }),
    dispatchPagesCharged: 0,
    cancellationPagesCharged: 0,
  });
}

function freshContinuation(): TaskComputeDeliveryConnectedContinuationV1 {
  return Object.freeze({
    version: "flarex.task-compute-delivery-connected-continuation.v1",
    directory: Object.freeze({ kind: "unstarted" }),
    activeScope: null,
  });
}

function continueDirectory(
  continuation: ReplacementScopeDirectoryContinuationV1,
): TaskComputeDeliveryConnectedContinuationV1 {
  return Object.freeze({
    version: "flarex.task-compute-delivery-connected-continuation.v1",
    directory: Object.freeze({ kind: "continuing", continuation }),
    activeScope: null,
  });
}

function directoryStateAfter(
  continuation: ReplacementScopeDirectoryContinuationV1 | null,
  terminalScopeId: TaskComputeDeliveryTrustedDirectoryItem["scopeId"],
): TaskComputeDeliveryConnectedDirectoryAfterV1 {
  return continuation === null
    ? Object.freeze({ kind: "exhausted", highWaterScopeId: terminalScopeId })
    : Object.freeze({ kind: "continuing", continuation });
}

function afterDirectoryPosition(
  after: TaskComputeDeliveryConnectedDirectoryAfterV1,
): TaskComputeDeliveryConnectedContinuationV1 | null {
  return after.kind === "exhausted" ? null : continueDirectory(after.continuation);
}

function afterActiveScope(
  active: TaskComputeDeliveryConnectedActiveScopeV1,
): TaskComputeDeliveryConnectedContinuationV1 | null {
  return afterDirectoryPosition(active.directoryAfter);
}

function withActiveScope(
  directory: TaskComputeDeliveryConnectedDirectoryStateV1,
  activeScope: TaskComputeDeliveryConnectedActiveScopeV1,
): TaskComputeDeliveryConnectedContinuationV1 {
  return Object.freeze({
    version: "flarex.task-compute-delivery-connected-continuation.v1",
    directory,
    activeScope,
  });
}

function freshCounters(): RunnerCounters {
  return {
    directoryPagesCharged: 0,
    scopeVisits: 0,
    scopeResolutionFailures: 0,
    discoveryFailures: 0,
    dispatchPagesCharged: 0,
    cancellationPagesCharged: 0,
    dispatchCandidatesCharged: 0,
    cancellationCandidatesCharged: 0,
    dispatchProviderCallsCharged: 0,
    cancellationProviderCallsCharged: 0,
    totalOperationsCharged: 0,
    confirmedDispatchPagesRead: 0,
    confirmedCancellationPagesRead: 0,
    confirmedDispatchCandidatesHandled: 0,
    confirmedCancellationCandidatesHandled: 0,
    confirmedDispatchProviderCalls: 0,
    confirmedCancellationProviderCalls: 0,
    candidateFailures: 0,
  };
}

function hasStarted(counters: RunnerCounters): boolean {
  return counters.directoryPagesCharged > 0
    || counters.dispatchPagesCharged > 0
    || counters.cancellationPagesCharged > 0
    || counters.scopeVisits > 0;
}

function complete(
  stopReason: TaskComputeDeliveryConnectedRunnerStopReason,
  counters: RunnerCounters,
  continuation: TaskComputeDeliveryConnectedContinuationV1 | null,
): Effect.Effect<
  TaskComputeDeliveryConnectedRunnerReceipt,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<"encode">
> {
  return Effect.gen(function* () {
    const encoded = continuation === null
      ? null
      : yield* encodeTaskComputeDeliveryConnectedContinuationV1(continuation);
    return Object.freeze({
      version:
        "flarex.task-compute-delivery-connected-runner-receipt.v1" as const,
      stopReason,
      directoryPagesCharged: counters.directoryPagesCharged,
      scopeVisits: counters.scopeVisits,
      scopeResolutionFailures: counters.scopeResolutionFailures,
      discoveryFailures: counters.discoveryFailures,
      dispatchPagesCharged: counters.dispatchPagesCharged,
      cancellationPagesCharged: counters.cancellationPagesCharged,
      dispatchCandidatesCharged: counters.dispatchCandidatesCharged,
      cancellationCandidatesCharged: counters.cancellationCandidatesCharged,
      dispatchProviderCallsCharged: counters.dispatchProviderCallsCharged,
      cancellationProviderCallsCharged:
        counters.cancellationProviderCallsCharged,
      totalOperationsCharged: counters.totalOperationsCharged,
      confirmedDispatchPagesRead: counters.confirmedDispatchPagesRead,
      confirmedCancellationPagesRead:
        counters.confirmedCancellationPagesRead,
      confirmedDispatchCandidatesHandled:
        counters.confirmedDispatchCandidatesHandled,
      confirmedCancellationCandidatesHandled:
        counters.confirmedCancellationCandidatesHandled,
      confirmedDispatchProviderCalls: counters.confirmedDispatchProviderCalls,
      confirmedCancellationProviderCalls:
        counters.confirmedCancellationProviderCalls,
      candidateFailures: counters.candidateFailures,
      continuation: encoded,
    });
  });
}

function toNanoseconds(milliseconds: number): bigint {
  return BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
}
