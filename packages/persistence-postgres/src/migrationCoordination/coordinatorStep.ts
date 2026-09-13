/**
 * One structural step and its uncertain-outcome recovery. DDL, receipt, event and head
 * progress remain in one target-owned transaction.
 */
import { Effect, Option } from "effect";
import { captureFrameworkMigrationEvent, encodeFrameworkMigrationStepReceiptFrame } from "./canonical";
import {
  ensureFrameworkMigrationCommittedCompletionInTransactionEffect,
  readFrameworkMigrationDirectCompletionsInTransactionEffect,
} from "./migrationStepReceiptRepository";
import { FRAMEWORK_MIGRATION_EVENT_FORMAT, FRAMEWORK_MIGRATION_EVENT_VERSION,
  FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT, FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
  type FrameworkMigrationStep } from "./model";
import { appendFrameworkMigrationEventRecordInTransactionEffect } from "./migrationEventRepository";
import { advanceFrameworkMigrationProgressRecordInTransactionEffect } from "./migrationCollisionHeadRepository";
import {
  executeRelationalStructuralStepEffect,
  observeRelationalStructuralStepEffect,
} from "./relationalStructuralRunner";
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
  loadLockedClaimProgress,
  renewLockedClaimProgressIfNeeded,
  getFrameworkMigrationClaimState,
} from "./coordinatorClaim";
import {
  eventToken,
  nextInt64,
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
        let locked = yield* loadLockedClaimProgress(raw, state);
        const plan = state.attempt.plan.plan;
        if (locked.head.completedStepCount === plan.frame.steps.length) {
          return Object.freeze({
            kind: "complete" as const,
            completedStepCount: locked.head.completedStepCount,
            requiredStepCount: plan.frame.steps.length,
          });
        }
        locked = yield* renewLockedClaimProgressIfNeeded(raw, state, locked);
        const step = plan.frame.steps[locked.head.completedStepCount];
        if (step === undefined) {
          return yield* Effect.fail(corruption("step", "Migration receipt prefix exceeds its plan"));
        }
        attemptedStep = step;
        const preparedStep = state.definition.steps[step.ordinal];
        if (preparedStep === undefined || preparedStep.step.stepSha256 !== step.stepSha256) {
          return yield* Effect.fail(corruption("step", "Prepared operation does not match the stored plan"));
        }
        const dependencies = yield* readFrameworkMigrationDirectCompletionsInTransactionEffect(
          raw, state.attempt, step, locked.head.completedStepCount, state.lineage,
        );
        const execution = yield* executeRelationalStructuralStepEffect(
          state.definition.runner,
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
        const producer = state.attempt.attempt.frame;
        const receiptValue = yield* encodeFrameworkMigrationStepReceiptFrame({
          format: FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
          version: FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
          collision: producer.collision,
          planSha256: producer.planSha256,
          attemptId: producer.attemptId,
          attemptFence: producer.attemptFence,
          stepId: step.stepId,
          stepSha256: step.stepSha256,
          dependencyReceipts: dependencies.map(dependency => ({
            stepId: dependency.step.stepId, stepReceiptSha256: dependency.sha256,
          })),
          preconditionSha256: step.preconditionSha256,
          postconditionSha256: step.postconditionSha256,
          observedPostconditionSha256: execution.value.observedPostconditionSha256,
          completedAt: completionClock.databaseNow,
        });
        const completion = yield* ensureFrameworkMigrationCommittedCompletionInTransactionEffect(
          raw, state.attempt, step, dependencies, receiptValue,
        );
        const eventValue = yield* captureFrameworkMigrationEvent({
          format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
          version: FRAMEWORK_MIGRATION_EVENT_VERSION,
          collision: state.collision.coordinate,
          sequence: nextInt64(locked.lastEvent?.event.frame.sequence ?? "0"),
          previousEvent: locked.lastEvent === null ? null : eventToken(locked.lastEvent),
          recordedAt: completionClock.databaseNow,
          kind: "stepCompleted",
          stepReceiptSha256: completion.sha256,
        });
        const event = yield* appendFrameworkMigrationEventRecordInTransactionEffect(
          raw, state.collision, locked.lastEvent, eventValue,
        );
        const head = yield* advanceFrameworkMigrationProgressRecordInTransactionEffect(
          raw, locked.head, state.attempt, event, completion,
        );
        return Object.freeze({
          kind: "step" as const,
          completedStepCount: head.completedStepCount,
          requiredStepCount: plan.frame.steps.length,
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
