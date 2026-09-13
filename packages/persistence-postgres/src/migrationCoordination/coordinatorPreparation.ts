/**
 * Plan preparation, admission, claiming and takeover, including recovery from uncertain
 * preparation and claim decisions.
 */
import type { PreparedFrameworkMigrationDefinition } from "./definition";
import type { CanonicalIsoInstant } from "@flarex/time/iso-instant";
import { Effect, Option } from "effect";
import { eq } from "drizzle-orm";
import { fxSystemFrameworkMigrationAttemptStarts } from "./schema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import {
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationAttemptTerminal,
  captureFrameworkMigrationCollisionHead,
  captureFrameworkMigrationEvent,
  captureFrameworkMigrationPlanAdmission,
} from "./canonical";
import { ensureFrameworkMigrationAttemptStartInTransactionEffect, restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect } from "./migrationAttemptRepository";
import {
  ensureFrameworkMigrationAttemptTerminalInTransactionEffect,
  readFrameworkMigrationAttemptTerminalByAttemptInTransactionEffect,
} from "./migrationAttemptTerminalRepository";
import {
  compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect,
  initializeFrameworkMigrationCollisionHeadInTransactionEffect,
  readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect,
  readFrameworkMigrationProgressRecordForUpdateInTransactionEffect,
} from "./migrationCollisionHeadRepository";
import { appendFrameworkMigrationEventInTransactionEffect } from "./migrationEventRepository";
import {
  ensureFrameworkMigrationPlanAdmissionInTransactionEffect,
  restoreStoredFrameworkMigrationPlanAdmissionReferenceInTransactionEffect,
} from "./migrationPlanAdmissionRepository";
import { ensureFreshRelationalMigrationPlanInTransactionEffect } from "./migrationPlanRepository";
import {
  readFrameworkMigrationStepReceiptPrefixInTransactionEffect,
} from "./migrationStepReceiptRepository";
import {
  type RelationalMigrationPlan,
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
} from "./model";
import {
  ensureRelationalPhysicalNameAssignmentsInTransactionEffect,
} from "./physicalNameAssignmentRepository";
import { observeRelationalStructuralStepEffect } from "./relationalStructuralRunner";
import {
  restoredFrameworkMigrationCollisionHeadAuthority,
  type RestoredFrameworkMigrationCollisionHead,
} from "./storedEventRestoration";
import type {
  RestoredFrameworkMigrationAttemptStart,
  RestoredFrameworkMigrationStepReceipt,
} from "./storedRestoration";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
  lockFrameworkMigrationCollisionDomainInTransactionEffect,
} from "./targetCollisionRepository";
import {
  type FrameworkMigrationTransaction,
  type FrameworkMigrationTransactionRequest,
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
} from "./targetSession";
import {
  FrameworkMigrationCoordinatorError,
  type FrameworkMigrationCoordinatorFailure,
  type RunFreshFrameworkMigrationCoordinatorInput,
  type FrameworkMigrationReadyResult,
  type FrameworkMigrationBusyResult,
  type PreparedCoordinatorDefinition,
  coordinatorError,
  corruption,
} from "./coordinatorContracts";
import {
  type FrameworkMigrationClaim,
  makeClaim,
  getFrameworkMigrationClaimState,
  loadLockedClaimProgress,
  requireAdmissibleBase,
  requireExactPlan,
} from "./coordinatorClaim";
import {
  brandNonNegativeInt64,
  appendEvent,
  advanceHead,
  readDatabaseClock,
  eventToken,
  nextInt64,
  ordinaryRequest,
  recoveryRequest,
  reserveAdditiveEvents,
} from "./coordinatorJournal";
import { readyFromLockedHead } from "./coordinatorFinalization";

function prepareCoordinatorDefinitionEffect(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  plan: RelationalMigrationPlan,
): Effect.Effect<PreparedCoordinatorDefinition, FrameworkMigrationCoordinatorFailure> {
  return runFrameworkMigrationTargetTransactionEffect(
    input.target,
    ordinaryRequest(input),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      input.target,
      raw => prepareCoordinatorDefinitionInTransaction(raw, plan, "ordinary", input.commerceProfile),
    ),
  );
}

export function prepareCoordinatorDefinitionWithRecoveryEffect(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  plan: RelationalMigrationPlan,
): Effect.Effect<
  PreparedCoordinatorDefinition,
  FrameworkMigrationCoordinatorFailure
> {
  return prepareCoordinatorDefinitionEffect(input, plan).pipe(Effect.catchTag(
    "FrameworkMigrationDecisionUncertainIssue",
    issue => runFrameworkMigrationTargetTransactionEffect(
      input.target,
      recoveryRequest(input, issue.sessionIdentity),
      transaction => withFrameworkMigrationRawTransactionEffect(
        transaction,
        input.target,
        raw => prepareCoordinatorDefinitionInTransaction(raw, plan, "recovery", input.commerceProfile),
      ),
    ),
  ));
}

const prepareCoordinatorDefinitionInTransaction = Effect.fn(
  "FreshFrameworkMigrationCoordinator.prepareDefinition",
)(function* (
  transaction: FlarexMetadataTransaction,
  planValue: RelationalMigrationPlan,
  requestKind: FrameworkMigrationTransactionRequest["kind"],
  commerceProfile?: import("../commerceTransaction/profile").CommerceInstallationProfile,
): Effect.fn.Return<PreparedCoordinatorDefinition, FrameworkMigrationCoordinatorFailure> {
  const target = yield* ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
    transaction,
    planValue.targetNamespace,
  );
  const ensuredCollision = yield*
    ensureFrameworkMigrationCollisionDomainInTransactionEffect(
      transaction,
      target,
      planValue,
    );
  const collision = yield*
    lockFrameworkMigrationCollisionDomainInTransactionEffect(
      transaction,
      ensuredCollision,
    );
  yield* ensureRelationalPhysicalNameAssignmentsInTransactionEffect(
    transaction,
    collision,
    planValue.physicalLayout.nameAssignments,
  );
  const plan = yield* ensureFreshRelationalMigrationPlanInTransactionEffect(
    transaction,
    collision,
    planValue,
  );
  if (requestKind === "ordinary") {
    const selected = yield* readFrameworkMigrationProgressRecordForUpdateInTransactionEffect(transaction, collision);
    if (Option.isSome(selected) && selected.value.head.frame.currentPlan.planSha256 === planValue.migrationPlanSha256) {
      const head = selected.value;
      const admission = yield* restoreStoredFrameworkMigrationPlanAdmissionReferenceInTransactionEffect(transaction, collision,
        head.currentAdmissionStorageId, head.head.frame.currentPlan.admissionSha256, "readAdmission");
      yield* requireExactPlan(admission.plan.plan, planValue, "prepare");
      if (head.currentPlanStorageId !== admission.plan.storageId || head.completedStepCount > admission.plan.plan.frame.steps.length) {
        return yield* Effect.fail(corruption("prepare", "Prepared head does not match its admitted definition"));
      }
      if ((admission.admission.frame.admissionProfile === "registered-commerce-fresh") !== (commerceProfile !== undefined)) {
        return yield* Effect.fail(coordinatorError("prepare", "planConflict", "Commerce admission requires its exact live descriptor"));
      }
      return Object.freeze({ collision: admission.collision, plan: admission.plan });
    }
  }
  const existingHead = yield*
    readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(
      transaction,
      collision,
    );
  if (Option.isSome(existingHead) && existingHead.value.plan.plan.migrationPlanSha256 === planValue.migrationPlanSha256) {
    yield* requireExactPlan(existingHead.value.plan.plan, planValue, "prepare");
    if ((existingHead.value.admission.admission.frame.admissionProfile === "registered-commerce-fresh") !== (commerceProfile !== undefined)) {
      return yield* Effect.fail(coordinatorError("prepare", "planConflict", "Commerce admission requires its exact live descriptor"));
    }
    return Object.freeze({
      collision: existingHead.value.collision,
      plan: existingHead.value.plan,
    });
  }
  if (planValue.frame.version === 1 && Option.isSome(existingHead)) {
    return yield* Effect.fail(coordinatorError("prepare", "planConflict", "Fresh plan conflicts with the current head"));
  }
  if (planValue.frame.version === 2) {
    if (Option.isNone(existingHead) || existingHead.value.plan.plan.frame.version !== 1 ||
      existingHead.value.plan.plan.migrationPlanSha256 !== planValue.frame.baseInstallation.identity.migrationPlanSha256) {
      return yield* Effect.fail(coordinatorError("prepare", "planConflict", "Additive base is not the current successful fresh head"));
    }
    yield* requireAdmissibleBase(transaction, collision, planValue);
    if (Option.isNone(yield* readyFromLockedHead(transaction, existingHead.value, true))) {
      return yield* Effect.fail(coordinatorError("prepare", "planConflict", "Additive base has no current readiness publication"));
    }
    if (BigInt(existingHead.value.head.frame.lastEvent?.sequence ?? "0") + BigInt(planValue.frame.steps.length + 8) > 128n) {
      return yield* Effect.fail(coordinatorError("prepare", "invalidInput", "Additive event budget cannot accommodate the successor"));
    }
  }
  const previousHead = Option.getOrNull(existingHead);
  const previousEvent = previousHead === null ? null : restoredFrameworkMigrationCollisionHeadAuthority(previousHead)?.lastEvent;
  if (previousEvent === undefined) return yield* Effect.fail(corruption("prepare", "Missing predecessor event authority"));
  const clock = yield* readDatabaseClock(transaction, 1);
  const admissionValue = yield* captureFrameworkMigrationPlanAdmission({
    ...(commerceProfile === undefined ? {} : { commerceProfile }),
    plan: plan.plan,
    nameAssignments: plan.plan.physicalLayout.nameAssignments,
    previousPlanSha256: previousHead?.plan.plan.migrationPlanSha256 ?? null,
    admittedAt: clock.databaseNow,
  });
  const admission = yield*
    ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
      transaction,
      plan,
      previousHead?.plan ?? null,
      admissionValue,
    );
  const eventValue = yield* captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: collision.coordinate,
    sequence: previousEvent === null ? brandNonNegativeInt64("1") : nextInt64(previousEvent.event.frame.sequence),
    previousEvent: previousEvent === null ? null : eventToken(previousEvent),
    recordedAt: clock.databaseNow,
    kind: "planAdmitted",
    admissionSha256: admission.admission.sha256,
  });
  const event = yield* appendFrameworkMigrationEventInTransactionEffect(
    transaction,
    collision,
    previousEvent,
    Object.freeze({ kind: "planAdmitted", admission }),
    eventValue,
  );
  const headValue = yield* captureFrameworkMigrationCollisionHead({
    admission: admission.admission,
    headRevision: previousHead === null ? "1" : nextInt64(previousHead.head.frame.headRevision),
    attemptFence: previousHead?.head.frame.attemptFence ?? "0",
    currentAttempt: null,
    lastEvent: eventToken(event),
    updatedAt: clock.databaseNow,
  });
  const head = previousHead !== null
    ? yield* compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect(transaction, previousHead, admission, null, event, headValue)
    : yield* initializeFrameworkMigrationCollisionHeadInTransactionEffect(
    transaction,
    collision,
    admission,
    null,
    event,
    headValue,
  );
  return Object.freeze({ collision: head.collision, plan: head.plan });
});

type ClaimCoordinatorAttemptResult =
  | Readonly<{ readonly kind: "claim"; readonly claim: FrameworkMigrationClaim }>
  | FrameworkMigrationBusyResult
  | FrameworkMigrationReadyResult;

export function claimCoordinatorAttemptEffect(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  prepared: PreparedCoordinatorDefinition,
  definition: PreparedFrameworkMigrationDefinition,
): Effect.Effect<ClaimCoordinatorAttemptResult, FrameworkMigrationCoordinatorFailure> {
  const run = (
    request: FrameworkMigrationTransactionRequest,
  ) => runFrameworkMigrationTargetTransactionEffect(
    input.target,
    request,
    transaction => claimCoordinatorAttemptInTransaction(
      input,
      prepared,
      definition,
      transaction,
      request.kind,
    ),
  );
  return run(ordinaryRequest(input)).pipe(Effect.catchTag(
    "FrameworkMigrationDecisionUncertainIssue",
    issue => run(recoveryRequest(input, issue.sessionIdentity)),
  ));
}

/** Reopening the exact live owner reauthenticates its immutable definition and
 * lineage, then applies the normal command's fresh progress checks. Other claim
 * lifecycle states remain with admission/takeover below. Failures never fall back. */
const resumeLiveCoordinatorClaim = Effect.fn("FrameworkMigrationCoordinator.resumeLiveClaim")(
  function* (raw: FlarexMetadataTransaction, input: RunFreshFrameworkMigrationCoordinatorInput,
    prepared: PreparedCoordinatorDefinition, definition: PreparedFrameworkMigrationDefinition): Effect.fn.Return<
      Option.Option<FrameworkMigrationClaim>, FrameworkMigrationCoordinatorFailure
    > {
    const selected = yield* readFrameworkMigrationProgressRecordForUpdateInTransactionEffect(raw, prepared.collision);
    if (Option.isNone(selected)) return yield* Effect.fail(corruption("claim", "Collision head disappeared during claim"));
    const head = selected.value;
    if (head.currentPlanStorageId !== prepared.plan.storageId || head.head.frame.currentPlan.planSha256 !== prepared.plan.plan.migrationPlanSha256) {
      return yield* Effect.fail(coordinatorError("claim", "planConflict", "Migration collision lane contains another plan"));
    }
    const current = head.head.frame.currentAttempt;
    if (current === null || current.attemptId !== input.attemptId || current.leaseOwnerId !== input.leaseOwnerId) return Option.none();
    const clock = yield* readDatabaseClock(raw, 1);
    if (Date.parse(current.leaseExpiresAt) <= Date.parse(clock.databaseNow)) return Option.none();
    if (head.currentAttemptStorageId === null) return yield* Effect.fail(corruption("claim", "Current attempt reference is missing"));
    const attempt = yield* restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect(raw, prepared.collision,
      head.currentAttemptStorageId, current.attemptId, "readAttemptStart");
    const claim = yield* Effect.fromResult(makeClaim(input, attempt, definition));
    const state = getFrameworkMigrationClaimState(claim);
    if (state === undefined) return yield* Effect.fail(corruption("claim", "Resumed claim state is unavailable"));
    yield* loadLockedClaimProgress(raw, state);
    return Option.some(claim);
  },
);

const claimCoordinatorAttemptInTransaction = Effect.fn(
  "FreshFrameworkMigrationCoordinator.claim",
)(function* (
  input: RunFreshFrameworkMigrationCoordinatorInput,
  prepared: PreparedCoordinatorDefinition,
  definition: PreparedFrameworkMigrationDefinition,
  transaction: FrameworkMigrationTransaction,
  requestKind: FrameworkMigrationTransactionRequest["kind"],
): Effect.fn.Return<ClaimCoordinatorAttemptResult, FrameworkMigrationCoordinatorFailure> {
  return yield* withFrameworkMigrationRawTransactionEffect(
    transaction,
    input.target,
    raw => Effect.gen(function* () {
      if (requestKind === "ordinary") {
        const resumed = yield* resumeLiveCoordinatorClaim(raw, input, prepared, definition);
        if (Option.isSome(resumed)) return Object.freeze({ kind: "claim" as const, claim: resumed.value });
      }
      const lockedHead = yield*
        readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(
          raw,
          prepared.collision,
        );
      if (Option.isNone(lockedHead)) {
        return yield* Effect.fail(corruption(
          "claim",
          "Collision head disappeared during claim",
        ));
      }
      let currentHead = lockedHead.value;
      yield* requireExactPlan(currentHead.plan.plan, prepared.plan.plan, "claim");
      const ready = yield* readyFromLockedHead(raw, currentHead, true);
      if (Option.isSome(ready)) return ready.value;
      yield* requireAdmissibleBase(raw, currentHead.collision, currentHead.plan.plan);
      const clock = yield* readDatabaseClock(
        raw,
        input.leaseDurationMilliseconds,
      );
      const headAuthority = restoredFrameworkMigrationCollisionHeadAuthority(
        currentHead,
      );
      if (headAuthority === undefined) {
        return yield* Effect.fail(corruption(
          "claim",
          "Collision head authority is unavailable",
        ));
      }
      let previousAttempt = headAuthority.currentAttempt;
      let predecessorReceipts: readonly RestoredFrameworkMigrationStepReceipt[] = [];
      const currentProjection = currentHead.head.frame.currentAttempt;
      if (previousAttempt !== null && currentProjection !== null) {
        const live = Date.parse(currentProjection.leaseExpiresAt) >
          Date.parse(clock.databaseNow);
        if (live) {
          if (
            currentProjection.attemptId === input.attemptId &&
            currentProjection.leaseOwnerId === input.leaseOwnerId
          ) {
            return Object.freeze({
              kind: "claim" as const,
              claim: yield* Effect.fromResult(makeClaim(
                input,
                previousAttempt,
                definition,
              )),
            });
          }
          return Object.freeze({
            kind: "busy" as const,
            attemptId: currentProjection.attemptId,
            leaseOwnerId: currentProjection.leaseOwnerId,
            leaseExpiresAt: currentProjection.leaseExpiresAt,
          });
        }
        yield* reserveAdditiveClaim(raw, currentHead);
        const receipts = yield*
          readFrameworkMigrationStepReceiptPrefixInTransactionEffect(
            raw,
            previousAttempt,
          );
        predecessorReceipts = receipts;
        const existingTerminal = yield*
          readFrameworkMigrationAttemptTerminalByAttemptInTransactionEffect(
            raw,
            previousAttempt,
          );
        if (
          Option.isSome(existingTerminal) &&
          existingTerminal.value.terminal.frame.outcome.kind ===
            "decisionUncertain"
        ) {
          return yield* Effect.fail(coordinatorError(
            "claim",
            "decisionUncertain",
            "Decision-uncertain migration attempt requires operator resolution",
          ));
        }
        if (
          Option.isSome(existingTerminal) &&
          existingTerminal.value.terminal.frame.outcome.kind === "succeeded"
        ) {
          return yield* Effect.fail(corruption(
            "claim",
            "Successful terminal exists without atomic readiness publication",
          ));
        }
        const terminal = Option.isSome(existingTerminal)
          ? existingTerminal.value
          : yield* ensureLeaseLostTerminal(
            raw,
            previousAttempt,
            receipts,
            currentHead,
            clock.databaseNow,
          );
        const terminatedEvent = yield* appendEvent(
          raw,
          currentHead,
          clock.databaseNow,
          Object.freeze({ kind: "attemptTerminated", terminal }),
          Object.freeze({
            kind: "attemptTerminated",
            terminalSha256: terminal.terminal.sha256,
          }),
        );
        currentHead = yield* advanceHead(
          raw,
          currentHead,
          null,
          null,
          terminatedEvent,
          clock.databaseNow,
        );
      } else if (previousAttempt !== null || currentProjection !== null) {
        return yield* Effect.fail(corruption(
          "claim",
          "Collision head current-attempt projection is inconsistent",
        ));
      }
      if (previousAttempt === null) yield* reserveAdditiveClaim(raw, currentHead);
      const attemptFence = nextInt64(currentHead.head.frame.attemptFence);
      const attemptValue = yield* captureFrameworkMigrationAttemptStart({
        admission: currentHead.admission.admission,
        attemptId: input.attemptId,
        attemptFence,
        leaseOwnerId: input.leaseOwnerId,
        leaseExpiresAt: clock.leaseExpiresAt,
        previousAttemptId: previousAttempt?.attempt.frame.attemptId ?? null,
        startedAt: clock.databaseNow,
      });
      const attempt = yield*
        ensureFrameworkMigrationAttemptStartInTransactionEffect(
          raw,
          currentHead.admission,
          previousAttempt,
          attemptValue,
        );
      const startedEvent = yield* appendEvent(
        raw,
        currentHead,
        clock.databaseNow,
        Object.freeze({ kind: "attemptStarted", attempt }),
        Object.freeze({
          kind: "attemptStarted",
          attemptStartSha256: attempt.attempt.sha256,
        }),
      );
      currentHead = yield* advanceHead(
        raw,
        currentHead,
        attempt,
        Object.freeze({
          attemptId: attempt.attempt.frame.attemptId,
          attemptFence: attempt.attempt.frame.attemptFence,
          leaseOwnerId: attempt.attempt.frame.leaseOwnerId,
          leaseExpiresAt: attempt.attempt.frame.leaseExpiresAt,
        }),
        startedEvent,
        clock.databaseNow,
      );
      yield* observePredecessorReceipts(
        raw,
        transaction,
        definition,
        attempt,
        predecessorReceipts,
      );
      return Object.freeze({
        kind: "claim" as const,
        claim: yield* Effect.fromResult(makeClaim(
          input,
          attempt,
          definition,
        )),
      });
    }),
  );
});

/** Re-observe receipted predecessor progress without replaying its DDL. */
const observePredecessorReceipts = Effect.fn(
  "FreshFrameworkMigrationCoordinator.observePredecessorReceipts",
)(function* (
  raw: FlarexMetadataTransaction,
  transaction: FrameworkMigrationTransaction,
  definition: PreparedFrameworkMigrationDefinition,
  attempt: RestoredFrameworkMigrationAttemptStart,
  predecessorReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
): Effect.fn.Return<void, FrameworkMigrationCoordinatorFailure> {
  if (predecessorReceipts.length === 0) return;
  yield* requireExactPlan(attempt.plan.plan, definition.plan, "claim");
  const plan = definition.plan;
  const runner = definition.runner;
  for (const [ordinal, predecessor] of predecessorReceipts.entries()) {
    const step = plan.frame.steps[ordinal];
    if (step === undefined ||
      predecessor.receipt.frame.stepId !== step.stepId ||
      predecessor.receipt.frame.stepSha256 !== step.stepSha256 ||
      predecessor.receipt.frame.observedPostconditionSha256 !== step.postconditionSha256) {
      return yield* Effect.fail(corruption("claim", "Predecessor receipt does not match the successor plan prefix"));
    }
    const observation = yield* observeRelationalStructuralStepEffect(runner, transaction, step);
    if (observation !== "exact") {
      return yield* Effect.fail(corruption("claim", "Predecessor receipted structure is absent during takeover"));
    }
  }
});

const ensureLeaseLostTerminal = Effect.fn(
  "FreshFrameworkMigrationCoordinator.ensureLeaseLostTerminal",
)(function* (
  raw: FlarexMetadataTransaction,
  attempt: RestoredFrameworkMigrationAttemptStart,
  receipts: readonly RestoredFrameworkMigrationStepReceipt[],
  head: RestoredFrameworkMigrationCollisionHead,
  terminalAt: CanonicalIsoInstant,
) {
  const terminalValue = yield* captureFrameworkMigrationAttemptTerminal({
    attempt: attempt.attempt,
    outcome: Object.freeze({
      kind: "failed",
      reason: "leaseLost",
      evidenceSha256: head.head.sha256,
    }),
    stepReceipts: receipts.map(receipt => receipt.receipt),
    terminalAt,
  });
  return yield* ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
    raw,
    attempt,
    receipts,
    terminalValue,
  );
});

const reserveAdditiveClaim = Effect.fn("FrameworkMigrationCoordinator.reserveClaim")(
  function* (raw: FlarexMetadataTransaction, head: RestoredFrameworkMigrationCollisionHead): Effect.fn.Return<
    void, FrameworkMigrationCoordinatorError
  > {
    if (head.plan.plan.frame.version === 1) return;
    yield* reserveAdditiveEvents(head, head.plan.plan.frame.steps.length + 3);
    const attempts = yield* runDrizzleStatementEffect(raw.select({ id: fxSystemFrameworkMigrationAttemptStarts.attemptStorageId })
      .from(fxSystemFrameworkMigrationAttemptStarts).where(eq(fxSystemFrameworkMigrationAttemptStarts.planStorageId,
        head.plan.storageId)).limit(2), cause => coordinatorError("claim", "resourceFailure", "Attempt budget read failed", cause));
    if (attempts.length >= 2) return yield* Effect.fail(coordinatorError("claim", "invalidInput", "Additive attempt budget is exhausted"));
  },
);
