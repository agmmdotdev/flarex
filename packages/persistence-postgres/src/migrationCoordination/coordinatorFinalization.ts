/**
 * Final validation, installation/readiness publication and uncertain-finalization
 * recovery.
 */
import { Effect, Option } from "effect";
import {
  captureFrameworkSchemaAvailabilityHead,
  captureFrameworkSchemaAvailabilityHistory,
  captureFrameworkSchemaInstallation,
  captureFrameworkSchemaReadiness,
} from "../frameworkSchema/installation/canonical";
import {
  appendFrameworkSchemaAvailabilityHistoryInTransactionEffect,
} from "../frameworkSchema/installation/availabilityHistoryRepository";
import {
  initializeFrameworkSchemaAvailabilityHeadInTransactionEffect,
  readFrameworkSchemaAvailabilityHeadInTransactionEffect,
} from "../frameworkSchema/installation/availabilityHeadRepository";
import {
  ensureFrameworkSchemaInstallationInTransactionEffect,
} from "../frameworkSchema/installation/installationRepository";
import {
  ensureFrameworkSchemaReadinessInTransactionEffect,
} from "../frameworkSchema/installation/readinessRepository";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { captureFrameworkMigrationAttemptTerminal } from "./canonical";
import {
  ensureFrameworkMigrationAttemptTerminalInTransactionEffect,
} from "./migrationAttemptTerminalRepository";
import {
  readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect,
  readFrameworkMigrationProgressRecordForUpdateInTransactionEffect,
} from "./migrationCollisionHeadRepository";
import { readFrameworkMigrationEventRecordInTransactionEffect } from "./migrationEventRepository";
import {
  captureRelationalStructuralValidationSha256Effect,
  observeRelationalStructuralStepEffect,
} from "./relationalStructuralRunner";
import {
  restoredFrameworkMigrationCollisionHeadAuthority,
  restoredFrameworkMigrationEventAuthority,
  type RestoredFrameworkMigrationCollisionHead,
} from "./storedEventRestoration";
import {
  type FrameworkMigrationSessionIdentity,
  type FrameworkMigrationTarget,
  type FrameworkMigrationTransaction,
  type FrameworkMigrationTransactionRequest,
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
} from "./targetSession";
import {
  type FrameworkMigrationCoordinatorFailure,
  type RunFreshFrameworkMigrationCoordinatorInput,
  type FrameworkMigrationReadyResult,
  type FrameworkMigrationNotReadyResult,
  type PreparedCoordinatorDefinition,
  STRUCTURE_MISMATCH_RESULT,
  coordinatorError,
  corruption,
} from "./coordinatorContracts";
import {
  type FrameworkMigrationClaim,
  type FrameworkMigrationClaimState,
  withClaimGraphLimits,
  validateLockedClaimHead,
  getFrameworkMigrationClaimState,
  requireExactPlan,
} from "./coordinatorClaim";
import {
  appendEvent,
  advanceHead,
  readDatabaseClock,
  ordinaryRequest,
  recoveryRequest,
  reserveAdditiveEvents,
} from "./coordinatorJournal";

export function finalizeFrameworkMigrationClaimEffect(
  claim: FrameworkMigrationClaim,
): Effect.Effect<
  FrameworkMigrationReadyResult | FrameworkMigrationNotReadyResult,
  FrameworkMigrationCoordinatorFailure
> {
  return withClaimGraphLimits(finalizeClaimInternal(claim, true), claim);
}

function finalizeClaimInternal(
  claim: FrameworkMigrationClaim,
  allowRecoveryRetry: boolean,
): Effect.Effect<
  FrameworkMigrationReadyResult | FrameworkMigrationNotReadyResult,
  FrameworkMigrationCoordinatorFailure
> {
  const state = getFrameworkMigrationClaimState(claim);
  if (state === undefined) {
    return Effect.fail(coordinatorError(
      "finalize",
      "invalidInput",
      "Framework migration claim authority is invalid",
    ));
  }
  const finalize = runFrameworkMigrationTargetTransactionEffect(
    state.target,
    ordinaryRequest(state),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => finalizeInTransaction(raw, transaction, state),
    ),
  );
  return finalize.pipe(Effect.catchTag(
    "FrameworkMigrationDecisionUncertainIssue",
    issue => recoverFinalizationDecisionEffect(
      state,
      issue.sessionIdentity,
    ).pipe(Effect.flatMap(recovered => {
      if (Option.isSome(recovered)) return Effect.succeed(recovered.value);
      return allowRecoveryRetry
        ? finalizeClaimInternal(claim, false)
        : Effect.fail(coordinatorError(
          "recover",
          "decisionUncertain",
          "Finalization settlement remained uncertain after recovery",
        ));
    })),
  ));
}

const finalizeInTransaction = Effect.fn(
  "FreshFrameworkMigrationCoordinator.finalize",
)(function* (
  raw: FlarexMetadataTransaction,
  transaction: FrameworkMigrationTransaction,
  state: FrameworkMigrationClaimState,
): Effect.fn.Return<
  FrameworkMigrationReadyResult | FrameworkMigrationNotReadyResult,
  FrameworkMigrationCoordinatorFailure
> {
  const initialHead = yield*
    readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(
      raw,
      state.collision,
    );
  if (Option.isNone(initialHead)) {
    return yield* Effect.fail(corruption(
      "finalize",
      "Collision head disappeared during finalization",
    ));
  }
  const existingReady = yield* readyFromLockedHead(raw, initialHead.value, true);
  if (Option.isSome(existingReady)) return existingReady.value;
  const locked = yield* validateLockedClaimHead(raw, state, initialHead.value);
  yield* reserveAdditiveEvents(locked.head, 4);
  if (locked.head.progress.completedStepCount !== state.definition.plan.frame.steps.length) {
    return yield* Effect.fail(coordinatorError(
      "finalize",
      "dependencyMissing",
      "Migration plan is incomplete",
    ));
  }
  const validationStep = state.definition.steps.at(-1)?.step;
  if (
    validationStep === undefined ||
    validationStep.operation.codec.format !==
      "flarex.relational-validate-structure"
  ) {
    return yield* Effect.fail(coordinatorError(
      "finalize",
      "storedCorruption",
      "Migration plan lacks its final structural validation step",
    ));
  }
  const validationObservation = yield* observeRelationalStructuralStepEffect(
    locked.structuralRunner,
    transaction,
    validationStep,
  ).pipe(
    Effect.map(Option.some),
    Effect.catchTag("RelationalStructuralRunnerError", error =>
      error.reason === "catalogMismatch"
        ? Effect.succeed(Option.none())
        : Effect.fail(error)
    ),
  );
  if (
    Option.isNone(validationObservation) ||
    validationObservation.value !== "exact"
  ) return STRUCTURE_MISMATCH_RESULT;
  const clock = yield* readDatabaseClock(raw, 1);
  const terminalValue = yield* captureFrameworkMigrationAttemptTerminal({
    attempt: locked.attempt.attempt,
    outcome: Object.freeze({
      kind: "succeeded",
      requiredStepSetSha256: state.definition.plan.requiredStepSetSha256,
    }),
    stepReceipts: locked.receipts.map(receipt => receipt.receipt),
    terminalAt: clock.databaseNow,
  });
  const terminal = yield*
    ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
      raw,
      locked.attempt,
      locked.receipts,
      terminalValue,
    );
  const terminatedEvent = yield* appendEvent(
    raw,
    locked.head,
    clock.databaseNow,
    Object.freeze({ kind: "attemptTerminated", terminal }),
    Object.freeze({
      kind: "attemptTerminated",
      terminalSha256: terminal.terminal.sha256,
    }),
  );
  let head = yield* advanceHead(
    raw,
    locked.head,
    null,
    null,
    terminatedEvent,
    clock.databaseNow,
  );
  const installationValue = yield* captureFrameworkSchemaInstallation({
    plan: terminal.attempt.plan.plan,
    admission: terminal.attempt.admission.admission,
    terminal: terminal.terminal,
    installedStructureSha256: state.definition.plan.physicalLayout.layoutSha256,
    installedPhysicalCapabilities:
      state.definition.plan.physicalLayout.frame.requiredPhysicalCapabilities,
    installedAt: clock.databaseNow,
  });
  const installation = yield* ensureFrameworkSchemaInstallationInTransactionEffect(
    raw,
    terminal,
    installationValue,
  );
  const installationEvent = yield* appendEvent(
    raw,
    head,
    clock.databaseNow,
    Object.freeze({ kind: "installationPublished", installation }),
    Object.freeze({
      kind: "installationPublished",
      installationReceiptSha256: installation.installation.sha256,
    }),
  );
  head = yield* advanceHead(
    raw,
    head,
    null,
    null,
    installationEvent,
    clock.databaseNow,
  );
  const validationSha256 = yield*
    captureRelationalStructuralValidationSha256Effect(
      locked.structuralRunner,
      locked.receipts,
    );
  const capabilities =
    state.definition.plan.physicalLayout.frame.requiredPhysicalCapabilities;
  const readinessValue = yield* captureFrameworkSchemaReadiness({
    installation: installation.installation,
    validationSha256,
    validatedStructureSha256: state.definition.plan.physicalLayout.layoutSha256,
    validatedPhysicalCapabilities: capabilities,
    residualRequirements: capabilities.map(capability => Object.freeze({
      capability: capability.identity,
      requirement: capability.residualRequirement,
    })),
    validatedAt: clock.databaseNow,
  });
  const readiness = yield* ensureFrameworkSchemaReadinessInTransactionEffect(
    raw,
    installation,
    readinessValue,
  );
  const readinessEvent = yield* appendEvent(
    raw,
    head,
    clock.databaseNow,
    Object.freeze({ kind: "readinessPublished", readiness }),
    Object.freeze({
      kind: "readinessPublished",
      readinessSha256: readiness.readiness.sha256,
    }),
  );
  head = yield* advanceHead(
    raw,
    head,
    null,
    null,
    readinessEvent,
    clock.databaseNow,
  );
  const historyValue = yield* captureFrameworkSchemaAvailabilityHistory({
    readiness: readiness.readiness,
    previous: null,
    status: "ready",
    reasonSha256: null,
    recordedAt: clock.databaseNow,
  });
  const history = yield*
    appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
      raw,
      readiness,
      null,
      historyValue,
    );
  const availabilityValue = yield* captureFrameworkSchemaAvailabilityHead(
    history.history,
  );
  const availability = yield*
    initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
      raw,
      history,
      availabilityValue,
    );
  return Object.freeze({
    kind: "ready",
    replayed: false,
    readiness,
    availability,
  });
});

function recoverFinalizationDecisionEffect(
  state: FrameworkMigrationClaimState,
  excludedSessionIdentity: FrameworkMigrationSessionIdentity,
): Effect.Effect<
  Option.Option<FrameworkMigrationReadyResult>,
  FrameworkMigrationCoordinatorFailure
> {
  return runFrameworkMigrationTargetTransactionEffect(
    state.target,
    recoveryRequest(state, excludedSessionIdentity),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => Effect.gen(function* () {
        const head = yield*
          readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(
            raw,
            state.collision,
          );
        if (Option.isNone(head)) {
          return yield* Effect.fail(corruption(
            "recover",
            "Collision head disappeared during finalization recovery",
          ));
        }
        const ready = yield* readyFromLockedHead(raw, head.value, true);
        if (Option.isSome(ready)) return ready;
        yield* validateLockedClaimHead(raw, state, head.value, false);
        return Option.none();
      }),
    ),
  );
}

export function readReadyResultEffect(
  target: FrameworkMigrationTarget,
  prepared: PreparedCoordinatorDefinition,
  input: RunFreshFrameworkMigrationCoordinatorInput,
): Effect.Effect<
  Option.Option<FrameworkMigrationReadyResult>,
  FrameworkMigrationCoordinatorFailure
> {
  return readReadyResultForRequest(
    target,
    prepared,
    ordinaryRequest(input),
  ).pipe(Effect.catchTag(
    "FrameworkMigrationDecisionUncertainIssue",
    issue => readReadyResultForRequest(
      target,
      prepared,
      recoveryRequest(input, issue.sessionIdentity),
    ),
  ));
}

function readReadyResultForRequest(
  target: FrameworkMigrationTarget,
  prepared: PreparedCoordinatorDefinition,
  request: FrameworkMigrationTransactionRequest,
): Effect.Effect<
  Option.Option<FrameworkMigrationReadyResult>,
  FrameworkMigrationCoordinatorFailure
> {
  return runFrameworkMigrationTargetTransactionEffect(
    target,
    request,
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      target,
      raw => Effect.gen(function* () {
        if (request.kind === "ordinary") {
          const selected = yield* readFrameworkMigrationProgressRecordForUpdateInTransactionEffect(raw, prepared.collision);
          if (Option.isNone(selected)) return yield* Effect.fail(corruption("prepare", "Collision head disappeared after preparation"));
          const progress = selected.value;
          if (progress.currentPlanStorageId !== prepared.plan.storageId || progress.head.frame.currentPlan.planSha256 !== prepared.plan.plan.migrationPlanSha256) {
            return yield* Effect.fail(coordinatorError("prepare", "planConflict", "Migration collision lane contains another plan"));
          }
          const reference = progress.head.frame.lastEvent;
          if (progress.lastEventStorageId === null || reference === null) return Option.none();
          const event = yield* readFrameworkMigrationEventRecordInTransactionEffect(raw, progress.collision,
            progress.lastEventStorageId, reference.sequence, reference.eventSha256);
          if (event.event.frame.kind !== "readinessPublished") return Option.none();
        }
        const head = yield*
          readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(
            raw,
            prepared.collision,
          );
        if (Option.isNone(head)) {
          return yield* Effect.fail(corruption(
            "prepare",
            "Collision head disappeared after preparation",
          ));
        }
        yield* requireExactPlan(head.value.plan.plan, prepared.plan.plan, "prepare");
        return yield* readyFromLockedHead(raw, head.value, true);
      }),
    ),
  );
}

export const readyFromLockedHead = Effect.fn(
  "FreshFrameworkMigrationCoordinator.readyFromHead",
)(function* (
  raw: FlarexMetadataTransaction,
  head: RestoredFrameworkMigrationCollisionHead,
  replayed: boolean,
): Effect.fn.Return<
  Option.Option<FrameworkMigrationReadyResult>,
  FrameworkMigrationCoordinatorFailure
> {
  const authority = restoredFrameworkMigrationCollisionHeadAuthority(head);
  const lastEvent = authority?.lastEvent;
  if (lastEvent === null || lastEvent === undefined) return Option.none();
  const eventAuthority = restoredFrameworkMigrationEventAuthority(lastEvent);
  if (eventAuthority?.subject.kind !== "readinessPublished") {
    return Option.none();
  }
  const readiness = eventAuthority.subject.readiness;
  if (
    readiness.installation.plan.plan.migrationPlanSha256 !==
      head.plan.plan.migrationPlanSha256
  ) {
    return yield* Effect.fail(corruption(
      "prepare",
      "Readiness event belongs to another migration plan",
    ));
  }
  const availability = yield*
    readFrameworkSchemaAvailabilityHeadInTransactionEffect(
      raw,
      readiness.installation,
    );
  if (Option.isNone(availability) || availability.value.head.frame.status !== "ready") {
    return yield* Effect.fail(corruption(
      "prepare",
      "Ready migration event lacks its exact availability head",
    ));
  }
  return Option.some(Object.freeze({
    kind: "ready",
    replayed,
    readiness,
    availability: availability.value,
  }));
});
