import type {
  RetainedHistorySchedulerDirectoryError,
  RetainedHistorySchedulerDirectoryContinuationV1,
  RetainedHistorySchedulerDirectoryItem,
  RetainedHistorySchedulerDirectory,
} from "@flarex/persistence-postgres/internal/retained-history-scheduler-directory";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Data, Effect, Result } from "effect";

import {
  type RetainedHistorySchedulerActiveScopeV1,
  type RetainedHistorySchedulerContinuationV1,
  type RetainedHistorySchedulerDirectoryStateV1,
} from "./retainedHistorySchedulerContinuationCodecV1";

export interface RetainedHistoryMultiScopeMaintenanceOptions {
  readonly maximumDirectoryPagesPerInvocation: number;
  readonly maximumMaintenancePagesPerInvocation: number;
}

export class RetainedHistoryMultiScopeMaintenanceConfigurationError
  extends Data.TaggedError(
    "RetainedHistoryMultiScopeMaintenanceConfigurationError",
  )<{ readonly reason: "invalidPolicy" }> {}

export class RetainedHistoryMultiScopeMaintenanceContractError
  extends Data.TaggedError("RetainedHistoryMultiScopeMaintenanceContractError")<{
    readonly reason:
      | "itemOverflow"
      | "resolvedItemMismatch"
      | "receiptDeploymentMismatch"
      | "receiptScopeMismatch"
      | "continuationMismatch"
      | "maintenancePagePolicyInvalid"
      | "maintenancePageChargeExceeded";
  }> {}

export type RetainedHistoryMultiScopeMaintenanceStopReason =
  | "cycleExhausted"
  | "directoryBudget"
  | "maintenanceSettled";

export interface RetainedHistoryMultiScopeMaintenanceReceiptV1 {
  readonly version: "flarex.retained-history-multi-scope-maintenance-receipt.v1";
  readonly stopReason: RetainedHistoryMultiScopeMaintenanceStopReason;
  readonly directoryPagesRead: number;
  readonly scopeVisits: number;
  readonly scopesFailed: number;
  readonly maintenanceRuns: number;
  readonly maintenance: Effect.Success<
    ReturnType<Extract<
      RetainedHistorySchedulerDirectoryItem,
      { readonly kind: "ready" }
    >["maintenance"]["runEffect"]>
  >["receipt"] | null;
  readonly continuation: RetainedHistorySchedulerContinuationV1 | null;
}

export type RetainedHistoryMultiScopeMaintenanceError =
  | RetainedHistorySchedulerDirectoryError
  | Effect.Error<
      ReturnType<Extract<
        RetainedHistorySchedulerDirectoryItem,
        { readonly kind: "ready" }
      >["maintenance"]["runEffect"]>
    >
  | RetainedHistoryMultiScopeMaintenanceContractError;

export interface RetainedHistoryMultiScopeMaintenance {
  readonly configuration: Readonly<{
    readonly maximumDirectoryPagesPerInvocation: number;
    readonly maximumMaintenancePagesPerInvocation: number;
  }>;
  readonly runEffect: (
    continuation: RetainedHistorySchedulerContinuationV1 | null,
  ) => Effect.Effect<
    RetainedHistoryMultiScopeMaintenanceReceiptV1,
    RetainedHistoryMultiScopeMaintenanceError
  >;
}

interface Counters {
  directoryPagesRead: number;
  scopeVisits: number;
  scopesFailed: number;
  maintenanceRuns: number;
}

const MAX_DIRECTORY_PAGES_PER_INVOCATION = 100;

/**
 * Advances at most one O11-E scope run. Directory-only failures may be skipped
 * within the bounded fixed-high-water page budget; maintenance failures remain
 * typed so the durable checkpoint owner never guesses progress.
 */
export function createRetainedHistoryMultiScopeMaintenance(
  directory: RetainedHistorySchedulerDirectory,
  options: RetainedHistoryMultiScopeMaintenanceOptions,
): Result.Result<
  RetainedHistoryMultiScopeMaintenance,
  RetainedHistoryMultiScopeMaintenanceConfigurationError
> {
  const maximumDirectoryPagesPerInvocation =
    options.maximumDirectoryPagesPerInvocation;
  const maximumMaintenancePagesPerInvocation =
    options.maximumMaintenancePagesPerInvocation;
  if (
    !isPositiveSafeInteger(maximumDirectoryPagesPerInvocation) ||
    maximumDirectoryPagesPerInvocation >
      MAX_DIRECTORY_PAGES_PER_INVOCATION ||
    !isPositiveSafeInteger(maximumMaintenancePagesPerInvocation)
  ) {
    return Result.fail(
      new RetainedHistoryMultiScopeMaintenanceConfigurationError({
        reason: "invalidPolicy",
      }),
    );
  }

  const owner = directory;
  const discoverMethod = owner.discoverEffect;
  const resolveMethod = owner.resolveEffect;
  const discover: RetainedHistorySchedulerDirectory["discoverEffect"] =
    (input) => discoverMethod.call(owner, input);
  const resolve: RetainedHistorySchedulerDirectory["resolveEffect"] =
    (candidate) => resolveMethod.call(owner, candidate);

  const runEffect: RetainedHistoryMultiScopeMaintenance["runEffect"] =
    Effect.fn("RetainedHistoryMultiScopeMaintenance.run")(
      function* (suppliedContinuation) {
        let state = suppliedContinuation === null
          ? freshContinuation()
          : captureContinuation(suppliedContinuation);
        const counters: Counters = {
          directoryPagesRead: 0,
          scopeVisits: 0,
          scopesFailed: 0,
          maintenanceRuns: 0,
        };

        while (true) {
          let active = state.activeScope;
          let readyItem: Extract<
            RetainedHistorySchedulerDirectoryItem,
            { readonly kind: "ready" }
          >;

          if (active !== null) {
            const item = captureDirectoryItem(yield* resolve(Object.freeze({
              deploymentId: active.deploymentId,
              scopeId: active.scopeId,
            })));
            counters.scopeVisits += 1;
            if (
              item.deploymentId !== active.deploymentId ||
              item.scopeId !== active.scopeId
            ) {
              return yield*
                new RetainedHistoryMultiScopeMaintenanceContractError({
                  reason: "resolvedItemMismatch",
                });
            }
            if (item.kind === "failed") {
              counters.scopesFailed += 1;
              const next = afterActiveScope(active);
              if (next === null) {
                return receipt("cycleExhausted", counters, null, null);
              }
              state = next;
              continue;
            }
            readyItem = item;
          } else {
            if (
              counters.directoryPagesRead >=
                maximumDirectoryPagesPerInvocation
            ) {
              return receipt("directoryBudget", counters, null, state);
            }
            const page = yield* discover({
              limit: 1,
              ...(state.directory.kind === "continuing"
                ? { continuation: state.directory.continuation }
                : {}),
            });
            counters.directoryPagesRead += 1;
            if (page.items.length > 1) {
              return yield*
                new RetainedHistoryMultiScopeMaintenanceContractError({
                  reason: "itemOverflow",
                });
            }
            const suppliedItem = page.items[0];
            if (suppliedItem === undefined) {
              const next = advanceDirectory(page.continuation);
              if (next === null) {
                return receipt("cycleExhausted", counters, null, null);
              }
              state = next;
              continue;
            }
            const item = captureDirectoryItem(suppliedItem);
            counters.scopeVisits += 1;
            active = freshActiveScope(item, page.continuation);
            if (item.kind === "failed") {
              counters.scopesFailed += 1;
              const next = afterActiveScope(active);
              if (next === null) {
                return receipt("cycleExhausted", counters, null, null);
              }
              state = next;
              continue;
            }
            readyItem = item;
          }

          if (
            !isPositiveSafeInteger(readyItem.maximumPagesPerRun) ||
            readyItem.maximumPagesPerRun >
              maximumMaintenancePagesPerInvocation
          ) {
            return yield*
              new RetainedHistoryMultiScopeMaintenanceContractError({
                reason: "maintenancePagePolicyInvalid",
              });
          }
          const maintenanceOwner = readyItem.maintenance;
          const runMethod = maintenanceOwner.runEffect;
          const settled = yield* runMethod.call(
            maintenanceOwner,
            active.maintenance,
          );
          counters.maintenanceRuns += 1;
          yield* validateSettledResult(readyItem, settled);

          const next = settled.continuation !== null
            ? withActiveScope(state.directory, Object.freeze({
              ...active,
              maintenance: settled.continuation,
            }))
            : settled.receipt.status === "maintenanceComplete"
            ? afterActiveScope(active)
            : withActiveScope(state.directory, Object.freeze({
              ...active,
              maintenance: null,
            }));

          return next === null
            ? receipt(
              "cycleExhausted",
              counters,
              settled.receipt,
              null,
            )
            : receipt(
              "maintenanceSettled",
              counters,
              settled.receipt,
              next,
            );
        }
      },
    );

  return Result.succeed(Object.freeze({
    configuration: Object.freeze({
      maximumDirectoryPagesPerInvocation,
      maximumMaintenancePagesPerInvocation,
    }),
    runEffect,
  }));
}

function validateSettledResult(
  item: Extract<
    RetainedHistorySchedulerDirectoryItem,
    { readonly kind: "ready" }
  >,
  settled: Effect.Success<ReturnType<typeof item.maintenance.runEffect>>,
): Effect.Effect<void, RetainedHistoryMultiScopeMaintenanceContractError> {
  if (settled.receipt.deploymentId !== item.deploymentId) {
    return new RetainedHistoryMultiScopeMaintenanceContractError({
      reason: "receiptDeploymentMismatch",
    });
  }
  if (settled.receipt.scopeId !== item.scopeId) {
    return new RetainedHistoryMultiScopeMaintenanceContractError({
      reason: "receiptScopeMismatch",
    });
  }
  if (
    !Number.isSafeInteger(settled.receipt.pagesExecuted) ||
    settled.receipt.pagesExecuted < 0 ||
    settled.receipt.pagesExecuted > item.maximumPagesPerRun
  ) {
    return new RetainedHistoryMultiScopeMaintenanceContractError({
      reason: "maintenancePageChargeExceeded",
    });
  }
  if (
    settled.continuation !== null &&
    (
      settled.continuation.deploymentId !== item.deploymentId ||
      settled.continuation.scopeId !== item.scopeId
    )
  ) {
    return new RetainedHistoryMultiScopeMaintenanceContractError({
      reason: "continuationMismatch",
    });
  }
  return Effect.void;
}

function captureDirectoryItem(
  item: RetainedHistorySchedulerDirectoryItem,
): RetainedHistorySchedulerDirectoryItem {
  if (item.kind === "failed") {
    return Object.freeze({
      kind: item.kind,
      deploymentId: item.deploymentId,
      scopeId: item.scopeId,
      reason: item.reason,
    });
  }
  const owner = item.maintenance;
  const runMethod = owner.runEffect;
  return Object.freeze({
    kind: item.kind,
    deploymentId: item.deploymentId,
    scopeId: item.scopeId,
    maximumPagesPerRun: item.maximumPagesPerRun,
    maintenance: Object.freeze({
      runEffect: (
        continuation: Parameters<typeof runMethod>[0],
      ) => runMethod.call(owner, continuation),
    }),
  });
}

function freshContinuation(): RetainedHistorySchedulerContinuationV1 {
  return Object.freeze({
    version: "flarex.retained-history-scheduler-continuation.v1",
    directory: Object.freeze({ kind: "unstarted" }),
    activeScope: null,
  });
}

function freshActiveScope(
  item: RetainedHistorySchedulerDirectoryItem,
  directoryContinuation: RetainedHistorySchedulerDirectoryContinuationV1 | null,
): RetainedHistorySchedulerActiveScopeV1 {
  return Object.freeze({
    deploymentId: item.deploymentId,
    scopeId: item.scopeId,
    maintenance: null,
    directoryAfter: directoryContinuation === null
      ? Object.freeze({
        kind: "exhausted" as const,
        highWaterScopeId: item.scopeId,
      })
      : Object.freeze({
        kind: "continuing" as const,
        continuation: captureDirectoryContinuation(directoryContinuation),
      }),
  });
}

function advanceDirectory(
  continuation: RetainedHistorySchedulerDirectoryContinuationV1 | null,
): RetainedHistorySchedulerContinuationV1 | null {
  return continuation === null
    ? null
    : Object.freeze({
      version: "flarex.retained-history-scheduler-continuation.v1",
      directory: Object.freeze({
        kind: "continuing",
        continuation: captureDirectoryContinuation(continuation),
      }),
      activeScope: null,
    });
}

function afterActiveScope(
  active: RetainedHistorySchedulerActiveScopeV1,
): RetainedHistorySchedulerContinuationV1 | null {
  return active.directoryAfter.kind === "exhausted"
    ? null
    : Object.freeze({
      version: "flarex.retained-history-scheduler-continuation.v1",
      directory: Object.freeze({
        kind: "continuing",
        continuation: captureDirectoryContinuation(
          active.directoryAfter.continuation,
        ),
      }),
      activeScope: null,
    });
}

function withActiveScope(
  directory: RetainedHistorySchedulerDirectoryStateV1,
  activeScope: RetainedHistorySchedulerActiveScopeV1,
): RetainedHistorySchedulerContinuationV1 {
  return Object.freeze({
    version: "flarex.retained-history-scheduler-continuation.v1",
    directory: captureDirectoryState(directory),
    activeScope,
  });
}

function captureContinuation(
  continuation: RetainedHistorySchedulerContinuationV1,
): RetainedHistorySchedulerContinuationV1 {
  return Object.freeze({
    version: continuation.version,
    directory: captureDirectoryState(continuation.directory),
    activeScope: continuation.activeScope === null
      ? null
      : Object.freeze({
        ...continuation.activeScope,
        directoryAfter: continuation.activeScope.directoryAfter.kind ===
            "exhausted"
          ? Object.freeze({ ...continuation.activeScope.directoryAfter })
          : Object.freeze({
            kind: "continuing" as const,
            continuation: captureDirectoryContinuation(
              continuation.activeScope.directoryAfter.continuation,
            ),
          }),
      }),
  });
}

function captureDirectoryState(
  directory: RetainedHistorySchedulerDirectoryStateV1,
): RetainedHistorySchedulerDirectoryStateV1 {
  return directory.kind === "unstarted"
    ? Object.freeze({ kind: "unstarted" })
    : Object.freeze({
      kind: "continuing",
      continuation: captureDirectoryContinuation(directory.continuation),
    });
}

function captureDirectoryContinuation<Continuation extends Readonly<{
  readonly codecVersion: 1;
  readonly highWaterScopeId: string;
  readonly lastScopeId: string;
}>>(continuation: Continuation): Continuation {
  return Object.freeze({ ...continuation });
}

function receipt(
  stopReason: RetainedHistoryMultiScopeMaintenanceStopReason,
  counters: Counters,
  maintenance: RetainedHistoryMultiScopeMaintenanceReceiptV1["maintenance"],
  continuation: RetainedHistorySchedulerContinuationV1 | null,
): RetainedHistoryMultiScopeMaintenanceReceiptV1 {
  return Object.freeze({
    version: "flarex.retained-history-multi-scope-maintenance-receipt.v1",
    stopReason,
    directoryPagesRead: counters.directoryPagesRead,
    scopeVisits: counters.scopeVisits,
    scopesFailed: counters.scopesFailed,
    maintenanceRuns: counters.maintenanceRuns,
    maintenance,
    continuation,
  });
}
