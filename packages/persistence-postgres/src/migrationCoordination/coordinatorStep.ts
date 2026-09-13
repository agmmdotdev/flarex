/**
 * One structural step and its uncertain-outcome recovery. DDL, receipt, event and head
 * progress remain in one target-owned transaction.
 */
import { Effect, Option } from "effect";
import { captureFrameworkMigrationStepReceipt } from "./canonical";
import {
  ensureFrameworkMigrationStepReceiptInTransactionEffect,
} from "./migrationStepReceiptRepository";
import type { FrameworkMigrationStep } from "./model";
import {
  executeRelationalStructuralStepEffect,
  observeRelationalStructuralStepEffect,
} from "./relationalStructuralRunner";
import type { RestoredFrameworkMigrationStepReceipt } from "./storedRestoration";
import {
  type FrameworkMigrationSessionIdentity,
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
} from "./targetSession";
import {
  type FrameworkMigrationCoordinatorFailure,
  type FrameworkMigrationNotReadyResult,
  STRUCTURE_MISMATCH_RESULT,
  type ExecuteNextFrameworkMigrationStepResult,
  coordinatorError,
  corruption,
} from "./coordinatorContracts";
import {
  type FrameworkMigrationClaim,
  type FrameworkMigrationClaimState,
  withClaimGraphLimits,
  loadLockedClaimState,
  renewClaimIfNeeded,
  getFrameworkMigrationClaimState,
} from "./coordinatorClaim";
import {
  appendEvent,
  advanceHead,
  readDatabaseClock,
  ordinaryRequest,
  recoveryRequest,
} from "./coordinatorJournal";

export const executeNextFrameworkMigrationStepEffect = Effect.fn(
  "FreshFrameworkMigrationCoordinator.executeNextStep",
)(function* (
  claim: FrameworkMigrationClaim,
): Effect.fn.Return<
  ExecuteNextFrameworkMigrationStepResult,
  FrameworkMigrationCoordinatorFailure
> {
  return yield* withClaimGraphLimits(executeNextStepInternal(claim, true), claim);
});

function executeNextStepInternal(
  claim: FrameworkMigrationClaim,
  allowRecoveryRetry: boolean,
): Effect.Effect<
  ExecuteNextFrameworkMigrationStepResult,
  FrameworkMigrationCoordinatorFailure
> {
  const state = getFrameworkMigrationClaimState(claim);
  if (state === undefined) {
    return Effect.fail(coordinatorError(
      "step",
      "invalidInput",
      "Framework migration claim authority is invalid",
    ));
  }
  let attemptedStep: FrameworkMigrationStep | undefined;
  const attempt = runFrameworkMigrationTargetTransactionEffect(
    state.target,
    ordinaryRequest(state),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => Effect.gen(function* () {
        let locked = yield* loadLockedClaimState(raw, state);
        if (locked.head.progress.completedStepCount === locked.plan.frame.steps.length) {
          return Object.freeze({
            kind: "complete" as const,
            completedStepCount: locked.head.progress.completedStepCount,
            requiredStepCount: locked.plan.frame.steps.length,
          });
        }
        locked = yield* renewClaimIfNeeded(raw, state, locked);
        const step = locked.plan.frame.steps[locked.head.progress.completedStepCount];
        if (step === undefined) {
          return yield* Effect.fail(corruption(
            "step",
            "Migration receipt prefix exceeds its plan",
          ));
        }
        attemptedStep = step;
        const preparedStep = state.definition.steps[step.ordinal];
        if (preparedStep === undefined || preparedStep.step.stepSha256 !== step.stepSha256) {
          return yield* Effect.fail(corruption("step", "Prepared operation does not match the stored plan"));
        }
        const dependencyReceipts: RestoredFrameworkMigrationStepReceipt[] = [];
        for (const ordinal of preparedStep.dependencyOrdinals) {
          const receipt = locked.receipts[ordinal];
          if (receipt === undefined) {
            return yield* Effect.fail(coordinatorError(
              "step",
              "dependencyMissing",
              "Migration step dependency receipt is missing",
            ));
          }
          dependencyReceipts.push(receipt);
        }
        const execution = yield* executeRelationalStructuralStepEffect(
          locked.structuralRunner,
          transaction,
          preparedStep.step,
        ).pipe(
          Effect.map(Option.some),
          Effect.catchTag("RelationalStructuralRunnerError", error =>
            step.operation.codec.format ===
                "flarex.relational-validate-structure" &&
                error.reason === "catalogMismatch"
              ? Effect.succeed(Option.none())
              : Effect.fail(error)
          ),
        );
        if (Option.isNone(execution)) return STRUCTURE_MISMATCH_RESULT;
        const completionClock = yield* readDatabaseClock(raw, 1);
        const receiptValue = yield* captureFrameworkMigrationStepReceipt({
          attempt: locked.attempt.attempt,
          step,
          dependencyReceipts: dependencyReceipts.map(
            dependency => dependency.receipt,
          ),
          observedPostconditionSha256:
            execution.value.observedPostconditionSha256,
          completedAt: completionClock.databaseNow,
        });
        const receipt = yield*
          ensureFrameworkMigrationStepReceiptInTransactionEffect(
            raw,
            locked.attempt,
            dependencyReceipts,
            receiptValue,
          );
        const completedEvent = yield* appendEvent(
          raw,
          locked.head,
          completionClock.databaseNow,
          Object.freeze({ kind: "stepCompleted", receipt }),
          Object.freeze({
            kind: "stepCompleted",
            stepReceiptSha256: receipt.receipt.sha256,
          }),
        );
        yield* advanceHead(
          raw,
          locked.head,
          locked.attempt,
          locked.head.head.frame.currentAttempt,
          completedEvent,
          completionClock.databaseNow,
        );
        return Object.freeze({
          kind: "step" as const,
          receipt,
          completedStepCount: locked.head.progress.completedStepCount + 1,
          requiredStepCount: locked.plan.frame.steps.length,
        });
      }),
    ),
  );
  return attempt.pipe(Effect.catchTag(
    "FrameworkMigrationDecisionUncertainIssue",
    issue => {
      if (attemptedStep === undefined) {
        return recoverUnidentifiedStepDecisionEffect(
          state,
          issue.sessionIdentity,
        ).pipe(Effect.flatMap(result => {
          if (result.kind === "complete") return Effect.succeed(result);
          return allowRecoveryRetry
            ? executeNextStepInternal(claim, false)
            : Effect.fail(coordinatorError(
              "recover",
              "decisionUncertain",
              "Migration progress settlement remained uncertain after recovery",
              issue,
            ));
        }));
      }
      return recoverStepDecisionEffect(
        state,
        attemptedStep,
        issue.sessionIdentity,
      ).pipe(Effect.flatMap(result => {
        if (result.kind === "committed") return Effect.succeed(result.progress);
        if (result.kind === "not_ready") return Effect.succeed(result);
        return allowRecoveryRetry
          ? executeNextStepInternal(claim, false)
          : Effect.fail(coordinatorError(
            "recover",
            "decisionUncertain",
            "Migration step settlement remained uncertain after recovery",
          ));
      }));
    },
  ));
}

interface RecoveredStepDecision {
  readonly kind: "committed";
  readonly progress: ExecuteNextFrameworkMigrationStepResult;
}

interface RolledBackStepDecision {
  readonly kind: "rolledBack";
}

type RecoveredStepSettlement =
  | RecoveredStepDecision
  | RolledBackStepDecision
  | FrameworkMigrationNotReadyResult;

function recoverUnidentifiedStepDecisionEffect(
  state: FrameworkMigrationClaimState,
  excludedSessionIdentity: FrameworkMigrationSessionIdentity,
): Effect.Effect<
  Extract<ExecuteNextFrameworkMigrationStepResult, { readonly kind: "complete" }> |
    Readonly<{ readonly kind: "pending" }>,
  FrameworkMigrationCoordinatorFailure
> {
  return runFrameworkMigrationTargetTransactionEffect(
    state.target,
    recoveryRequest(state, excludedSessionIdentity),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => Effect.map(loadLockedClaimState(raw, state), locked =>
        locked.head.progress.completedStepCount === locked.plan.frame.steps.length
          ? Object.freeze({
            kind: "complete" as const,
            completedStepCount: locked.head.progress.completedStepCount,
            requiredStepCount: locked.plan.frame.steps.length,
          })
          : Object.freeze({ kind: "pending" as const })
      ),
    ),
  );
}

function recoverStepDecisionEffect(
  state: FrameworkMigrationClaimState,
  step: FrameworkMigrationStep,
  excludedSessionIdentity: FrameworkMigrationSessionIdentity,
): Effect.Effect<
  RecoveredStepSettlement,
  FrameworkMigrationCoordinatorFailure
> {
  return runFrameworkMigrationTargetTransactionEffect(
    state.target,
    recoveryRequest(state, excludedSessionIdentity),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => Effect.gen(function* () {
        const locked = yield* loadLockedClaimState(raw, state, false);
        const recoveredStep = state.definition.steps[step.ordinal]?.step;
        if (
          recoveredStep === undefined ||
          recoveredStep.stepId !== step.stepId ||
          recoveredStep.stepSha256 !== step.stepSha256
        ) {
          return yield* Effect.fail(corruption(
            "recover",
            "Recovered migration step does not match the uncertain step",
          ));
        }
        const receipt = locked.receipts[recoveredStep.ordinal];
        const observation = yield* observeRelationalStructuralStepEffect(
          locked.structuralRunner,
          transaction,
          recoveredStep,
        ).pipe(
          Effect.map(Option.some),
          Effect.catchTag("RelationalStructuralRunnerError", error =>
            recoveredStep.operation.codec.format ===
                "flarex.relational-validate-structure" &&
                error.reason === "catalogMismatch"
              ? Effect.succeed(Option.none())
              : Effect.fail(error)
          ),
        );
        if (receipt !== undefined) {
          if (
            receipt.receipt.frame.stepId !== recoveredStep.stepId ||
            Option.isNone(observation) || observation.value !== "exact"
          ) {
            return yield* Effect.fail(corruption(
              "recover",
              "Committed step receipt and catalog state disagree",
            ));
          }
          return Object.freeze({
            kind: "committed" as const,
            progress: Object.freeze({
              kind: "step" as const,
              receipt,
              completedStepCount: locked.head.progress.completedStepCount,
              requiredStepCount: locked.plan.frame.steps.length,
            }),
          });
        }
        if (Option.isNone(observation)) return STRUCTURE_MISMATCH_RESULT;
        if (recoveredStep.operation.codec.format !==
            "flarex.relational-validate-structure" &&
            recoveredStep.operation.codec.format !== "flarex.relational-verify-base-structure" &&
            observation.value === "exact") {
          return yield* Effect.fail(corruption(
            "recover",
            "Catalog postcondition exists without a committed step receipt",
          ));
        }
        return Object.freeze({
          kind: "rolledBack" as const,
        });
      }),
    ),
  );
}
