import {
  canonicalIsoInstantFromDate,
  type CanonicalIsoInstant,
} from "@flarex/time/iso-instant";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Brand, Data, Effect, Option } from "effect";
import { sql } from "drizzle-orm";

import { databaseTimestampFromUnknown } from "../databaseTimestamp";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { getFrameworkSchemaArtifactEffect } from
  "../frameworkSchema/artifact/read";
import type { FrameworkSchemaArtifactError } from
  "../frameworkSchema/artifact/errors";
import type { FrameworkSchemaArtifactIdentity } from
  "../frameworkSchema/artifact/model";
import type { FrameworkSchemaArtifactRepository } from
  "../frameworkSchema/artifact/repository";
import {
  captureFrameworkSchemaAvailabilityHead,
  captureFrameworkSchemaAvailabilityHistory,
  captureFrameworkSchemaInstallation,
  captureFrameworkSchemaReadiness,
} from "../frameworkSchema/installation/canonical";
import type { FrameworkSchemaInstallationValueError } from
  "../frameworkSchema/installation/errors";
import {
  appendFrameworkSchemaAvailabilityHistoryInTransactionEffect,
} from "../frameworkSchema/installation/availabilityHistoryRepository";
import {
  initializeFrameworkSchemaAvailabilityHeadInTransactionEffect,
  readFrameworkSchemaAvailabilityHeadInTransactionEffect,
} from "../frameworkSchema/installation/availabilityHeadRepository";
import { ensureFrameworkSchemaInstallationInTransactionEffect } from
  "../frameworkSchema/installation/installationRepository";
import { ensureFrameworkSchemaReadinessInTransactionEffect } from
  "../frameworkSchema/installation/readinessRepository";
import type {
  RestoredFrameworkSchemaAvailabilityHead,
  RestoredFrameworkSchemaReadiness,
} from "../frameworkSchema/installation/storedMetadataRestoration";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { authenticateStoredRelationalSchemaArtifactEffect } from
  "../relationalSchema/artifact";
import type { RelationalSchemaError } from "../relationalSchema/errors";
import {
  captureRelationalPhysicalLayout,
} from "../relationalSchema/physical/canonical";
import type { RelationalPhysicalValueError } from
  "../relationalSchema/physical/errors";
import {
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationAttemptTerminal,
  captureFrameworkMigrationCollisionHead,
  captureFrameworkMigrationEvent,
  captureFrameworkMigrationPlanAdmission,
  captureFrameworkMigrationStepReceipt,
  captureFreshRelationalMigrationPlan,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type {
  CanonicalNonNegativeInt64,
  FrameworkMigrationAttemptStartSha256,
  FrameworkMigrationAttemptTerminalSha256,
  FrameworkMigrationStepReceiptSha256,
  FrameworkSchemaInstallationReceiptSha256,
  FrameworkSchemaReadinessSha256,
} from "./identity";
import {
  ensureFrameworkMigrationAttemptStartInTransactionEffect,
} from "./migrationAttemptRepository";
import {
  ensureFrameworkMigrationAttemptTerminalInTransactionEffect,
  readFrameworkMigrationAttemptTerminalByAttemptInTransactionEffect,
} from "./migrationAttemptTerminalRepository";
import {
  compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect,
  initializeFrameworkMigrationCollisionHeadInTransactionEffect,
  readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect,
} from "./migrationCollisionHeadRepository";
import {
  appendFrameworkMigrationEventInTransactionEffect,
} from "./migrationEventRepository";
import {
  ensureFrameworkMigrationPlanAdmissionInTransactionEffect,
} from "./migrationPlanAdmissionRepository";
import {
  ensureFreshRelationalMigrationPlanInTransactionEffect,
} from "./migrationPlanRepository";
import {
  ensureFrameworkMigrationStepReceiptInTransactionEffect,
  readFrameworkMigrationStepReceiptPrefixInTransactionEffect,
} from "./migrationStepReceiptRepository";
import type {
  FrameworkMigrationStep,
  FreshRelationalMigrationPlan,
} from "./model";
import {
  ensureRelationalPhysicalNameAssignmentInTransactionEffect,
} from "./physicalNameAssignmentRepository";
import {
  captureRelationalStructuralValidationSha256Effect,
  executeRelationalStructuralStepEffect,
  issueRelationalStructuralRunnerTokenEffect,
  observeRelationalStructuralStepEffect,
  preflightRelationalStructuralPlanEffect,
  type RelationalStructuralRunnerError,
  type RelationalStructuralRunnerToken,
} from "./relationalStructuralRunner";
import type { FrameworkMigrationRepositoryError } from "./repositoryErrors";
import {
  restoredFrameworkMigrationCollisionHeadAuthority,
  restoredFrameworkMigrationEventAuthority,
  type RestoredFrameworkMigrationCollisionHead,
  type RestoredFrameworkMigrationEvent,
  type RestoredFrameworkMigrationEventSubject,
} from "./storedEventRestoration";
import type {
  RestoredFrameworkMigrationAttemptStart,
  RestoredFrameworkMigrationCollisionDomain,
  RestoredFrameworkMigrationPlanAdmission,
  RestoredFrameworkMigrationStepReceipt,
  RestoredFreshRelationalMigrationPlan,
} from "./storedRestoration";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
  lockFrameworkMigrationCollisionDomainInTransactionEffect,
} from "./targetCollisionRepository";
import {
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
} from "./model";
import {
  type FrameworkMigrationSessionFailure,
  type FrameworkMigrationSessionIdentity,
  type FrameworkMigrationTarget,
  type FrameworkMigrationTargetCompositionError,
  type FrameworkMigrationTransaction,
  type FrameworkMigrationTransactionRequest,
  frameworkMigrationTargetSnapshot,
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
} from "./targetSession";

const frameworkMigrationClaimBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkMigrationClaim",
);
const brandNonNegativeInt64 = Brand.nominal<CanonicalNonNegativeInt64>();

export interface FrameworkMigrationClaim {
  readonly [frameworkMigrationClaimBrand]: true;
}

export class FrameworkMigrationCoordinatorError extends Data.TaggedError(
  "FrameworkMigrationCoordinatorError",
)<{
  readonly operation:
    | "prepare"
    | "claim"
    | "step"
    | "recover"
    | "finalize";
  readonly reason:
    | "invalidInput"
    | "artifactMissing"
    | "planConflict"
    | "staleFence"
    | "leaseLost"
    | "dependencyMissing"
    | "decisionUncertain"
    | "storedCorruption"
    | "resourceFailure";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type FrameworkMigrationCoordinatorFailure =
  | FrameworkMigrationCoordinatorError
  | FrameworkSchemaArtifactError
  | FrameworkMigrationValueError
  | RelationalPhysicalValueError
  | FrameworkMigrationRepositoryError
  | FrameworkSchemaInstallationValueError
  | RelationalSchemaError
  | RelationalStructuralRunnerError
  | FrameworkMigrationTargetCompositionError
  | FrameworkMigrationSessionFailure;

export interface RunFreshFrameworkMigrationCoordinatorInput {
  readonly artifactRepository: FrameworkSchemaArtifactRepository;
  readonly artifactIdentity: FrameworkSchemaArtifactIdentity;
  readonly target: FrameworkMigrationTarget;
  readonly attemptId: string;
  readonly leaseOwnerId: string;
  readonly leaseDurationMilliseconds: number;
  readonly lockTimeoutMilliseconds: number;
  readonly statementTimeoutMilliseconds: number;
  readonly maximumStepsPerRun?: number;
  readonly runTimeoutMilliseconds?: number;
}

export interface FrameworkMigrationReadyResult {
  readonly kind: "ready";
  readonly replayed: boolean;
  readonly readiness: RestoredFrameworkSchemaReadiness;
  readonly availability: RestoredFrameworkSchemaAvailabilityHead;
}

export interface FrameworkMigrationPendingResult {
  readonly kind: "pending";
  readonly claim: FrameworkMigrationClaim;
  readonly completedStepCount: number;
  readonly requiredStepCount: number;
}

export interface FrameworkMigrationBusyResult {
  readonly kind: "busy";
  readonly attemptId: string;
  readonly leaseOwnerId: string;
  readonly leaseExpiresAt: CanonicalIsoInstant;
}

export interface FrameworkMigrationNotReadyResult {
  readonly kind: "not_ready";
  readonly reason: "structureMismatch";
}

export type FreshFrameworkMigrationCoordinatorResult =
  | FrameworkMigrationReadyResult
  | FrameworkMigrationPendingResult
  | FrameworkMigrationBusyResult
  | FrameworkMigrationNotReadyResult;

interface FrameworkMigrationClaimState {
  readonly target: FrameworkMigrationTarget;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: FreshRelationalMigrationPlan;
  readonly attemptId: string;
  readonly attemptFence: string;
  readonly leaseOwnerId: string;
  readonly leaseDurationMilliseconds: number;
  readonly lockTimeoutMilliseconds: number;
  readonly statementTimeoutMilliseconds: number;
}

interface PreparedCoordinatorGraph {
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly head: RestoredFrameworkMigrationCollisionHead;
}

interface LockedClaimState {
  readonly head: RestoredFrameworkMigrationCollisionHead;
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly plan: FreshRelationalMigrationPlan;
  readonly structuralRunner: RelationalStructuralRunnerToken;
  readonly receipts: readonly RestoredFrameworkMigrationStepReceipt[];
  readonly databaseNow: CanonicalIsoInstant;
}

interface DatabaseClock {
  readonly databaseNow: CanonicalIsoInstant;
  readonly leaseExpiresAt: CanonicalIsoInstant;
}

type FrameworkMigrationEventVariant =
  | Readonly<{
      readonly kind: "attemptStarted";
      readonly attemptStartSha256: FrameworkMigrationAttemptStartSha256;
    }>
  | Readonly<{
      readonly kind: "leaseRenewed";
      readonly attemptId:
        RestoredFrameworkMigrationAttemptStart["attempt"]["frame"]["attemptId"];
      readonly attemptFence:
        RestoredFrameworkMigrationAttemptStart["attempt"]["frame"]["attemptFence"];
      readonly leaseOwnerId:
        RestoredFrameworkMigrationAttemptStart["attempt"]["frame"]["leaseOwnerId"];
      readonly leaseExpiresAt: CanonicalIsoInstant;
    }>
  | Readonly<{
      readonly kind: "stepCompleted";
      readonly stepReceiptSha256: FrameworkMigrationStepReceiptSha256;
    }>
  | Readonly<{
      readonly kind: "attemptTerminated";
      readonly terminalSha256: FrameworkMigrationAttemptTerminalSha256;
    }>
  | Readonly<{
      readonly kind: "installationPublished";
      readonly installationReceiptSha256:
        FrameworkSchemaInstallationReceiptSha256;
    }>
  | Readonly<{
      readonly kind: "readinessPublished";
      readonly readinessSha256: FrameworkSchemaReadinessSha256;
    }>;

const claimStates = new WeakMap<
  FrameworkMigrationClaim,
  FrameworkMigrationClaimState
>();

const STRUCTURE_MISMATCH_RESULT = Object.freeze({
  kind: "not_ready",
  reason: "structureMismatch",
} satisfies FrameworkMigrationNotReadyResult);

export const runFreshFrameworkMigrationCoordinatorEffect = Effect.fn(
  "FreshFrameworkMigrationCoordinator.run",
)((input: RunFreshFrameworkMigrationCoordinatorInput): Effect.Effect<
  FreshFrameworkMigrationCoordinatorResult, FrameworkMigrationCoordinatorFailure
> => Effect.suspend(() => {
  const timeout = input.runTimeoutMilliseconds ?? 120_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 300_000) {
    return Effect.fail(coordinatorError("prepare", "invalidInput", "Invalid fresh coordinator run budget"));
  }
  // Interruption is not evidence of non-commit. The target owns settlement and
  // cleanup; a later run reconstructs the exact durable prefix or readiness.
  return Effect.raceFirst(runFreshCoordinatorWithinBudgetEffect(input),
    Effect.sleep(timeout).pipe(Effect.andThen(Effect.fail(coordinatorError(
      "prepare", "resourceFailure", "Fresh coordinator run deadline expired; resume from durable state",
    )))));
}));

const runFreshCoordinatorWithinBudgetEffect = Effect.fn(
  "FreshFrameworkMigrationCoordinator.runWithinBudget",
)(function* (
  input: RunFreshFrameworkMigrationCoordinatorInput,
): Effect.fn.Return<
  FreshFrameworkMigrationCoordinatorResult,
  FrameworkMigrationCoordinatorFailure
> {
  const maximumSteps = input.maximumStepsPerRun ?? 16;
  if (
    !isIdentityText(input.attemptId) ||
    !isIdentityText(input.leaseOwnerId) ||
    !isPositiveBoundedInteger(input.leaseDurationMilliseconds) ||
    !isPositiveBoundedInteger(input.lockTimeoutMilliseconds) ||
    !isPositiveBoundedInteger(input.statementTimeoutMilliseconds) ||
    !Number.isSafeInteger(maximumSteps) || maximumSteps < 0 || maximumSteps > 16
  ) {
    return yield* Effect.fail(coordinatorError(
      "prepare",
      "invalidInput",
      "Framework migration coordinator input is invalid",
    ));
  }
  const artifact = yield* getFrameworkSchemaArtifactEffect(
    input.artifactRepository,
    input.artifactIdentity,
  );
  if (artifact === null) {
    return yield* Effect.fail(coordinatorError(
      "prepare",
      "artifactMissing",
      "Exact framework schema artifact is absent",
    ));
  }
  const snapshot = frameworkMigrationTargetSnapshot(input.target);
  if (snapshot === undefined) {
    return yield* Effect.fail(coordinatorError(
      "prepare",
      "invalidInput",
      "Framework migration target authority is invalid",
    ));
  }
  const relationalArtifact = yield*
    authenticateStoredRelationalSchemaArtifactEffect(artifact);
  const physicalLayout = yield* captureRelationalPhysicalLayout({
    artifact: relationalArtifact.artifact,
    physicalLocator: snapshot.physicalLocator,
    targetNamespace: snapshot.namespace,
  });
  const plan = yield* captureFreshRelationalMigrationPlan({
    artifact,
    physicalLayout,
  });
  if (plan.frame.steps.length > 11) {
    return yield* Effect.fail(coordinatorError("prepare", "invalidInput",
      "Fresh coordinator execution supports at most 11 plan steps"));
  }
  const structuralRunner = yield*
    issueRelationalStructuralRunnerTokenEffect(input.target, plan);
  yield* preflightRelationalStructuralPlanEffect(structuralRunner);

  const graph = yield* prepareCoordinatorGraphWithRecoveryEffect(input, plan);
  const existingReady = yield* readReadyResultEffect(
    input.target,
    graph,
    input,
  );
  if (Option.isSome(existingReady)) return existingReady.value;

  const claimResult = yield* claimCoordinatorAttemptEffect(
    input,
    graph,
    plan,
  );
  if (claimResult.kind === "busy" || claimResult.kind === "ready") {
    return claimResult;
  }
  let completed = 0;
  let lastProgress: FrameworkMigrationPendingResult | undefined;
  while (completed < maximumSteps) {
    const progress = yield* executeNextFrameworkMigrationStepEffect(
      claimResult.claim,
    );
    if (progress.kind === "complete") {
      return yield* finalizeFrameworkMigrationClaimEffect(claimResult.claim);
    }
    if (progress.kind === "not_ready") return progress;
    lastProgress = Object.freeze({
      kind: "pending",
      claim: claimResult.claim,
      completedStepCount: progress.completedStepCount,
      requiredStepCount: progress.requiredStepCount,
    });
    completed += 1;
  }
  if (lastProgress !== undefined) return lastProgress;
  const status = yield* readFrameworkMigrationClaimProgressEffect(
    claimResult.claim,
  );
  return status.completedStepCount === status.requiredStepCount
    ? yield* finalizeFrameworkMigrationClaimEffect(claimResult.claim)
    : Object.freeze({
      kind: "pending",
      claim: claimResult.claim,
      ...status,
    });
});

function prepareCoordinatorGraphEffect(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  plan: FreshRelationalMigrationPlan,
): Effect.Effect<PreparedCoordinatorGraph, FrameworkMigrationCoordinatorFailure> {
  return runFrameworkMigrationTargetTransactionEffect(
    input.target,
    ordinaryRequest(input),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      input.target,
      raw => prepareCoordinatorGraphInTransaction(raw, plan),
    ),
  );
}

function prepareCoordinatorGraphWithRecoveryEffect(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  plan: FreshRelationalMigrationPlan,
): Effect.Effect<
  PreparedCoordinatorGraph,
  FrameworkMigrationCoordinatorFailure
> {
  return prepareCoordinatorGraphEffect(input, plan).pipe(Effect.catchTag(
    "FrameworkMigrationDecisionUncertainIssue",
    issue => runFrameworkMigrationTargetTransactionEffect(
      input.target,
      recoveryRequest(input, issue.sessionIdentity),
      transaction => withFrameworkMigrationRawTransactionEffect(
        transaction,
        input.target,
        raw => prepareCoordinatorGraphInTransaction(raw, plan),
      ),
    ),
  ));
}

const prepareCoordinatorGraphInTransaction = Effect.fn(
  "FreshFrameworkMigrationCoordinator.prepareGraph",
)(function* (
  transaction: FlarexMetadataTransaction,
  planValue: FreshRelationalMigrationPlan,
): Effect.fn.Return<PreparedCoordinatorGraph, FrameworkMigrationCoordinatorFailure> {
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
  for (const assignment of planValue.physicalLayout.nameAssignments) {
    yield* ensureRelationalPhysicalNameAssignmentInTransactionEffect(
      transaction,
      collision,
      assignment,
    );
  }
  const plan = yield* ensureFreshRelationalMigrationPlanInTransactionEffect(
    transaction,
    collision,
    planValue,
  );
  const existingHead = yield*
    readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(
      transaction,
      collision,
    );
  if (Option.isSome(existingHead)) {
    yield* requireExactPlan(existingHead.value.plan.plan, planValue, "prepare");
    return Object.freeze({
      collision: existingHead.value.collision,
      plan: existingHead.value.plan,
      admission: existingHead.value.admission,
      head: existingHead.value,
    });
  }
  const clock = yield* readDatabaseClock(transaction, 1);
  const admissionValue = yield* captureFrameworkMigrationPlanAdmission({
    plan: plan.plan,
    nameAssignments: plan.plan.physicalLayout.nameAssignments,
    previousPlanSha256: null,
    admittedAt: clock.databaseNow,
  });
  const admission = yield*
    ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
      transaction,
      plan,
      null,
      admissionValue,
    );
  const eventValue = yield* captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: collision.coordinate,
    sequence: brandNonNegativeInt64("1"),
    previousEvent: null,
    recordedAt: clock.databaseNow,
    kind: "planAdmitted",
    admissionSha256: admission.admission.sha256,
  });
  const event = yield* appendFrameworkMigrationEventInTransactionEffect(
    transaction,
    collision,
    null,
    Object.freeze({ kind: "planAdmitted", admission }),
    eventValue,
  );
  const headValue = yield* captureFrameworkMigrationCollisionHead({
    admission: admission.admission,
    headRevision: "1",
    attemptFence: "0",
    currentAttempt: null,
    lastEvent: eventToken(event),
    updatedAt: clock.databaseNow,
  });
  const head = yield* initializeFrameworkMigrationCollisionHeadInTransactionEffect(
    transaction,
    collision,
    admission,
    null,
    event,
    headValue,
  );
  return Object.freeze({ collision, plan, admission, head });
});

type ClaimCoordinatorAttemptResult =
  | Readonly<{ readonly kind: "claim"; readonly claim: FrameworkMigrationClaim }>
  | FrameworkMigrationBusyResult
  | FrameworkMigrationReadyResult;

function claimCoordinatorAttemptEffect(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  graph: PreparedCoordinatorGraph,
  plan: FreshRelationalMigrationPlan,
): Effect.Effect<ClaimCoordinatorAttemptResult, FrameworkMigrationCoordinatorFailure> {
  const run = (
    request: FrameworkMigrationTransactionRequest,
  ) => runFrameworkMigrationTargetTransactionEffect(
    input.target,
    request,
    transaction => claimCoordinatorAttemptInTransaction(
      input,
      graph,
      plan,
      transaction,
    ),
  );
  return run(ordinaryRequest(input)).pipe(Effect.catchTag(
    "FrameworkMigrationDecisionUncertainIssue",
    issue => run(recoveryRequest(input, issue.sessionIdentity)),
  ));
}

const claimCoordinatorAttemptInTransaction = Effect.fn(
  "FreshFrameworkMigrationCoordinator.claim",
)(function* (
  input: RunFreshFrameworkMigrationCoordinatorInput,
  graph: PreparedCoordinatorGraph,
  plan: FreshRelationalMigrationPlan,
  transaction: FrameworkMigrationTransaction,
): Effect.fn.Return<ClaimCoordinatorAttemptResult, FrameworkMigrationCoordinatorFailure> {
  return yield* withFrameworkMigrationRawTransactionEffect(
    transaction,
    input.target,
    raw => Effect.gen(function* () {
      const lockedHead = yield*
        readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(
          raw,
          graph.collision,
        );
      if (Option.isNone(lockedHead)) {
        return yield* Effect.fail(corruption(
          "claim",
          "Collision head disappeared during claim",
        ));
      }
      let currentHead = lockedHead.value;
      yield* requireExactPlan(currentHead.plan.plan, graph.plan.plan, "claim");
      const ready = yield* readyFromLockedHead(raw, currentHead, true);
      if (Option.isSome(ready)) return ready.value;
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
              claim: makeClaim(
                input,
                currentHead.collision,
                plan,
                currentProjection.attemptFence,
              ),
            });
          }
          return Object.freeze({
            kind: "busy" as const,
            attemptId: currentProjection.attemptId,
            leaseOwnerId: currentProjection.leaseOwnerId,
            leaseExpiresAt: currentProjection.leaseExpiresAt,
          });
        }
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
      yield* carryForwardPredecessorReceipts(
        raw,
        transaction,
        input.target,
        attempt,
        predecessorReceipts,
        currentHead,
      );
      return Object.freeze({
        kind: "claim" as const,
        claim: makeClaim(
          input,
          attempt.collision,
          plan,
          attempt.attempt.frame.attemptFence,
        ),
      });
    }),
  );
});

/** Re-observe receipted predecessor progress without replaying its DDL. */
const carryForwardPredecessorReceipts = Effect.fn(
  "FreshFrameworkMigrationCoordinator.carryForwardPredecessorReceipts",
)(function* (
  raw: FlarexMetadataTransaction,
  transaction: FrameworkMigrationTransaction,
  target: FrameworkMigrationTarget,
  attempt: RestoredFrameworkMigrationAttemptStart,
  predecessorReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
  initialHead: RestoredFrameworkMigrationCollisionHead,
): Effect.fn.Return<void, FrameworkMigrationCoordinatorFailure> {
  if (predecessorReceipts.length === 0) return;
  const plan = attempt.plan.plan;
  const runner = yield* issueRelationalStructuralRunnerTokenEffect(target, plan);
  yield* preflightRelationalStructuralPlanEffect(runner);
  let head = initialHead;
  for (const predecessor of predecessorReceipts) {
    const prefix = yield* readFrameworkMigrationStepReceiptPrefixInTransactionEffect(
      raw,
      attempt,
    );
    const step = plan.frame.steps[prefix.length];
    if (
      step === undefined ||
      predecessor.receipt.frame.stepId !== step.stepId ||
      predecessor.receipt.frame.stepSha256 !== step.stepSha256 ||
      predecessor.receipt.frame.observedPostconditionSha256 !== step.postconditionSha256
    ) {
      return yield* Effect.fail(corruption(
        "claim",
        "Predecessor receipt does not match the successor plan prefix",
      ));
    }
    const observation = yield* observeRelationalStructuralStepEffect(
      runner,
      transaction,
      step,
    );
    if (observation !== "exact") {
      return yield* Effect.fail(corruption(
        "claim",
        "Predecessor receipted structure is absent during takeover",
      ));
    }
    const dependencies = prefix.filter(receipt => step.dependencies.some(
      dependency => dependency.stepId === receipt.receipt.frame.stepId,
    )).toSorted((left, right) => compareUtf16Strings(
      left.receipt.frame.stepId,
      right.receipt.frame.stepId,
    ));
    const clock = yield* readDatabaseClock(raw, 1);
    const value = yield* captureFrameworkMigrationStepReceipt({
      attempt: attempt.attempt,
      step,
      dependencyReceipts: dependencies.map(receipt => receipt.receipt),
      observedPostconditionSha256: step.postconditionSha256,
      completedAt: clock.databaseNow,
    });
    const receipt = yield* ensureFrameworkMigrationStepReceiptInTransactionEffect(
      raw,
      attempt,
      dependencies,
      value,
    );
    const event = yield* appendEvent(
      raw,
      head,
      clock.databaseNow,
      Object.freeze({ kind: "stepCompleted", receipt }),
      Object.freeze({ kind: "stepCompleted", stepReceiptSha256: receipt.receipt.sha256 }),
    );
    head = yield* advanceHead(
      raw,
      head,
      attempt,
      head.head.frame.currentAttempt,
      event,
      clock.databaseNow,
    );
  }
});

export type ExecuteNextFrameworkMigrationStepResult =
  | Readonly<{
      readonly kind: "step";
      readonly receipt: RestoredFrameworkMigrationStepReceipt;
      readonly completedStepCount: number;
      readonly requiredStepCount: number;
    }>
  | Readonly<{
      readonly kind: "complete";
      readonly completedStepCount: number;
      readonly requiredStepCount: number;
    }>
  | FrameworkMigrationNotReadyResult;

export const executeNextFrameworkMigrationStepEffect = Effect.fn(
  "FreshFrameworkMigrationCoordinator.executeNextStep",
)(function* (
  claim: FrameworkMigrationClaim,
): Effect.fn.Return<
  ExecuteNextFrameworkMigrationStepResult,
  FrameworkMigrationCoordinatorFailure
> {
  return yield* executeNextStepInternal(claim, true);
});

function executeNextStepInternal(
  claim: FrameworkMigrationClaim,
  allowRecoveryRetry: boolean,
): Effect.Effect<
  ExecuteNextFrameworkMigrationStepResult,
  FrameworkMigrationCoordinatorFailure
> {
  const state = claimStates.get(claim);
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
    claimOrdinaryRequest(state),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => Effect.gen(function* () {
        let locked = yield* loadLockedClaimState(raw, state);
        if (locked.receipts.length === locked.plan.frame.steps.length) {
          return Object.freeze({
            kind: "complete" as const,
            completedStepCount: locked.receipts.length,
            requiredStepCount: locked.plan.frame.steps.length,
          });
        }
        locked = yield* renewClaimIfNeeded(raw, state, locked);
        const step = locked.plan.frame.steps[locked.receipts.length];
        if (step === undefined) {
          return yield* Effect.fail(corruption(
            "step",
            "Migration receipt prefix exceeds its plan",
          ));
        }
        attemptedStep = step;
        const dependencyReceipts: RestoredFrameworkMigrationStepReceipt[] = [];
        for (const reference of step.dependencies.toSorted((left, right) =>
          compareUtf16Strings(left.stepId, right.stepId)
        )) {
          const receipt = locked.receipts.find(candidate =>
            candidate.receipt.frame.stepId === reference.stepId
          );
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
          step,
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
          completedStepCount: locked.receipts.length + 1,
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
    claimRecoveryRequest(state, excludedSessionIdentity),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => Effect.map(loadLockedClaimState(raw, state), locked =>
        locked.receipts.length === locked.plan.frame.steps.length
          ? Object.freeze({
            kind: "complete" as const,
            completedStepCount: locked.receipts.length,
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
    claimRecoveryRequest(state, excludedSessionIdentity),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => Effect.gen(function* () {
        const locked = yield* loadLockedClaimState(raw, state, false);
        const recoveredStep = locked.plan.frame.steps[step.ordinal];
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
              completedStepCount: locked.receipts.length,
              requiredStepCount: locked.plan.frame.steps.length,
            }),
          });
        }
        if (Option.isNone(observation)) return STRUCTURE_MISMATCH_RESULT;
        if (recoveredStep.operation.codec.format !==
            "flarex.relational-validate-structure" &&
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

export const readFrameworkMigrationClaimProgressEffect = Effect.fn(
  "FreshFrameworkMigrationCoordinator.readClaimProgress",
)(function* (
  claim: FrameworkMigrationClaim,
): Effect.fn.Return<
  Readonly<{
    readonly completedStepCount: number;
    readonly requiredStepCount: number;
  }>,
  FrameworkMigrationCoordinatorFailure
> {
  const state = claimStates.get(claim);
  if (state === undefined) {
    return yield* Effect.fail(coordinatorError(
      "step",
      "invalidInput",
      "Framework migration claim authority is invalid",
    ));
  }
  return yield* runFrameworkMigrationTargetTransactionEffect(
    state.target,
    claimOrdinaryRequest(state),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => Effect.map(loadLockedClaimState(raw, state), locked =>
        Object.freeze({
          completedStepCount: locked.receipts.length,
          requiredStepCount: state.plan.frame.steps.length,
        })
      ),
    ),
  );
});

export function finalizeFrameworkMigrationClaimEffect(
  claim: FrameworkMigrationClaim,
): Effect.Effect<
  FrameworkMigrationReadyResult | FrameworkMigrationNotReadyResult,
  FrameworkMigrationCoordinatorFailure
> {
  return finalizeClaimInternal(claim, true);
}

function finalizeClaimInternal(
  claim: FrameworkMigrationClaim,
  allowRecoveryRetry: boolean,
): Effect.Effect<
  FrameworkMigrationReadyResult | FrameworkMigrationNotReadyResult,
  FrameworkMigrationCoordinatorFailure
> {
  const state = claimStates.get(claim);
  if (state === undefined) {
    return Effect.fail(coordinatorError(
      "finalize",
      "invalidInput",
      "Framework migration claim authority is invalid",
    ));
  }
  const finalize = runFrameworkMigrationTargetTransactionEffect(
    state.target,
    claimOrdinaryRequest(state),
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
  if (locked.receipts.length !== state.plan.frame.steps.length) {
    return yield* Effect.fail(coordinatorError(
      "finalize",
      "dependencyMissing",
      "Migration plan is incomplete",
    ));
  }
  const validationStep = state.plan.frame.steps.at(-1);
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
  const lockedValidationStep = locked.plan.frame.steps.at(-1);
  if (
    lockedValidationStep === undefined ||
    lockedValidationStep.stepId !== validationStep.stepId ||
    lockedValidationStep.stepSha256 !== validationStep.stepSha256
  ) {
    return yield* Effect.fail(corruption(
      "finalize",
      "Stored validation step does not match the claimed migration plan",
    ));
  }
  const validationObservation = yield* observeRelationalStructuralStepEffect(
    locked.structuralRunner,
    transaction,
    lockedValidationStep,
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
      requiredStepSetSha256: state.plan.requiredStepSetSha256,
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
    installedStructureSha256: state.plan.physicalLayout.layoutSha256,
    installedPhysicalCapabilities:
      state.plan.physicalLayout.frame.requiredPhysicalCapabilities,
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
    state.plan.physicalLayout.frame.requiredPhysicalCapabilities;
  const readinessValue = yield* captureFrameworkSchemaReadiness({
    installation: installation.installation,
    validationSha256,
    validatedStructureSha256: state.plan.physicalLayout.layoutSha256,
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
    claimRecoveryRequest(state, excludedSessionIdentity),
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

function readReadyResultEffect(
  target: FrameworkMigrationTarget,
  graph: PreparedCoordinatorGraph,
  input: RunFreshFrameworkMigrationCoordinatorInput,
): Effect.Effect<
  Option.Option<FrameworkMigrationReadyResult>,
  FrameworkMigrationCoordinatorFailure
> {
  return readReadyResultForRequest(
    target,
    graph,
    ordinaryRequest(input),
  ).pipe(Effect.catchTag(
    "FrameworkMigrationDecisionUncertainIssue",
    issue => readReadyResultForRequest(
      target,
      graph,
      recoveryRequest(input, issue.sessionIdentity),
    ),
  ));
}

function readReadyResultForRequest(
  target: FrameworkMigrationTarget,
  graph: PreparedCoordinatorGraph,
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
        const head = yield*
          readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(
            raw,
            graph.collision,
          );
        if (Option.isNone(head)) {
          return yield* Effect.fail(corruption(
            "prepare",
            "Collision head disappeared after preparation",
          ));
        }
        return yield* readyFromLockedHead(raw, head.value, true);
      }),
    ),
  );
}

const readyFromLockedHead = Effect.fn(
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

const loadLockedClaimState = Effect.fn(
  "FreshFrameworkMigrationCoordinator.loadLockedClaim",
)(function* (
  raw: FlarexMetadataTransaction,
  state: FrameworkMigrationClaimState,
  requireUnexpiredLease = true,
): Effect.fn.Return<LockedClaimState, FrameworkMigrationCoordinatorFailure> {
  const head = yield*
    readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(
      raw,
      state.collision,
    );
  if (Option.isNone(head)) {
    return yield* Effect.fail(corruption(
      "step",
      "Collision head disappeared while continuing a claim",
    ));
  }
  return yield* validateLockedClaimHead(
    raw,
    state,
    head.value,
    requireUnexpiredLease,
  );
});

const validateLockedClaimHead = Effect.fn(
  "FreshFrameworkMigrationCoordinator.validateLockedClaim",
)(function* (
  raw: FlarexMetadataTransaction,
  state: FrameworkMigrationClaimState,
  head: RestoredFrameworkMigrationCollisionHead,
  requireUnexpiredLease = true,
): Effect.fn.Return<LockedClaimState, FrameworkMigrationCoordinatorFailure> {
  yield* requireExactPlan(head.plan.plan, state.plan, "step");
  const authority = restoredFrameworkMigrationCollisionHeadAuthority(head);
  const projection = head.head.frame.currentAttempt;
  const attempt = authority?.currentAttempt;
  if (
    attempt === null || attempt === undefined || projection === null ||
    projection.attemptId !== state.attemptId ||
    projection.attemptFence !== state.attemptFence ||
    projection.leaseOwnerId !== state.leaseOwnerId ||
    attempt.attempt.frame.attemptId !== state.attemptId ||
    attempt.attempt.frame.attemptFence !== state.attemptFence
  ) {
    return yield* Effect.fail(coordinatorError(
      "step",
      "staleFence",
      "Framework migration claim no longer owns the collision lane",
    ));
  }
  const clock = yield* readDatabaseClock(raw, 1);
  if (
    requireUnexpiredLease &&
    Date.parse(projection.leaseExpiresAt) <= Date.parse(clock.databaseNow)
  ) {
    return yield* Effect.fail(coordinatorError(
      "step",
      "leaseLost",
      "Framework migration claim lease has expired",
    ));
  }
  const receipts = yield*
    readFrameworkMigrationStepReceiptPrefixInTransactionEffect(raw, attempt);
  const plan = attempt.plan.plan;
  const structuralRunner = yield*
    issueRelationalStructuralRunnerTokenEffect(state.target, plan);
  yield* preflightRelationalStructuralPlanEffect(structuralRunner);
  return Object.freeze({
    head,
    attempt,
    plan,
    structuralRunner,
    receipts,
    databaseNow: clock.databaseNow,
  });
});

const renewClaimIfNeeded = Effect.fn(
  "FreshFrameworkMigrationCoordinator.renewIfNeeded",
)(function* (
  raw: FlarexMetadataTransaction,
  state: FrameworkMigrationClaimState,
  locked: LockedClaimState,
): Effect.fn.Return<LockedClaimState, FrameworkMigrationCoordinatorFailure> {
  const projection = locked.head.head.frame.currentAttempt;
  if (projection === null) {
    return yield* Effect.fail(corruption(
      "step",
      "Claim head lost its current-attempt projection",
    ));
  }
  const remaining = Date.parse(projection.leaseExpiresAt) -
    Date.parse(locked.databaseNow);
  if (remaining > Math.floor(state.leaseDurationMilliseconds / 2)) {
    return locked;
  }
  const clock = yield* readDatabaseClock(
    raw,
    state.leaseDurationMilliseconds,
  );
  const renewedEvent = yield* appendEvent(
    raw,
    locked.head,
    clock.databaseNow,
    Object.freeze({ kind: "leaseRenewed", attempt: locked.attempt }),
    Object.freeze({
      kind: "leaseRenewed",
      attemptId: locked.attempt.attempt.frame.attemptId,
      attemptFence: locked.attempt.attempt.frame.attemptFence,
      leaseOwnerId: locked.attempt.attempt.frame.leaseOwnerId,
      leaseExpiresAt: clock.leaseExpiresAt,
    }),
  );
  const head = yield* advanceHead(
    raw,
    locked.head,
    locked.attempt,
    Object.freeze({
      attemptId: locked.attempt.attempt.frame.attemptId,
      attemptFence: locked.attempt.attempt.frame.attemptFence,
      leaseOwnerId: locked.attempt.attempt.frame.leaseOwnerId,
      leaseExpiresAt: clock.leaseExpiresAt,
    }),
    renewedEvent,
    clock.databaseNow,
  );
  return Object.freeze({ ...locked, head, databaseNow: clock.databaseNow });
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

const appendEvent = Effect.fn(
  "FreshFrameworkMigrationCoordinator.appendEvent",
)(function* (
  raw: FlarexMetadataTransaction,
  head: RestoredFrameworkMigrationCollisionHead,
  recordedAt: CanonicalIsoInstant,
  subject: RestoredFrameworkMigrationEventSubject,
  variant: FrameworkMigrationEventVariant,
): Effect.fn.Return<RestoredFrameworkMigrationEvent, FrameworkMigrationCoordinatorFailure> {
  const authority = restoredFrameworkMigrationCollisionHeadAuthority(head);
  if (authority === undefined) {
    return yield* Effect.fail(corruption(
      "step",
      "Collision head event authority is unavailable",
    ));
  }
  const previous = authority.lastEvent;
  const eventValue = yield* captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: head.collision.coordinate,
    sequence: nextInt64(previous?.event.frame.sequence ?? "0"),
    previousEvent: previous === null ? null : eventToken(previous),
    recordedAt,
    ...variant,
  });
  return yield* appendFrameworkMigrationEventInTransactionEffect(
    raw,
    head.collision,
    previous,
    subject,
    eventValue,
  );
});

const advanceHead = Effect.fn(
  "FreshFrameworkMigrationCoordinator.advanceHead",
)(function* (
  raw: FlarexMetadataTransaction,
  head: RestoredFrameworkMigrationCollisionHead,
  nextAttempt: RestoredFrameworkMigrationAttemptStart | null,
  currentAttempt: RestoredFrameworkMigrationCollisionHead["head"]["frame"]["currentAttempt"],
  lastEvent: RestoredFrameworkMigrationEvent,
  updatedAt: CanonicalIsoInstant,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionHead,
  FrameworkMigrationCoordinatorFailure
> {
  const authority = restoredFrameworkMigrationCollisionHeadAuthority(head);
  if (
    authority === undefined ||
    (currentAttempt === null) !== (nextAttempt === null) ||
    (nextAttempt !== null && (
      nextAttempt.collision.storageId !== head.collision.storageId ||
      nextAttempt.admission.storageId !== head.admission.storageId ||
      nextAttempt.attempt.frame.attemptId !== currentAttempt?.attemptId ||
      nextAttempt.attempt.frame.attemptFence !== currentAttempt.attemptFence
    ))
  ) {
    return yield* Effect.fail(corruption(
      "step",
      "Collision head attempt authority is unavailable",
    ));
  }
  const headValue = yield* captureFrameworkMigrationCollisionHead({
    admission: head.admission.admission,
    headRevision: nextInt64(head.head.frame.headRevision),
    attemptFence: currentAttempt?.attemptFence ??
      head.head.frame.attemptFence,
    currentAttempt,
    lastEvent: eventToken(lastEvent),
    updatedAt,
  });
  return yield*
    compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect(
      raw,
      head,
      head.admission,
      nextAttempt,
      lastEvent,
      headValue,
    );
});

const readDatabaseClock = Effect.fn(
  "FreshFrameworkMigrationCoordinator.readDatabaseClock",
)(function* (
  raw: FlarexMetadataTransaction,
  leaseDurationMilliseconds: number,
): Effect.fn.Return<DatabaseClock, FrameworkMigrationCoordinatorError> {
  const result = yield* runDrizzleStatementEffect(
    raw.execute(sql`
      with migration_clock as (
        select date_trunc('milliseconds', clock_timestamp()) as database_now
      )
      select database_now,
        database_now + (${leaseDurationMilliseconds}::bigint *
          interval '1 millisecond') as lease_expires_at
      from migration_clock
    `),
    cause => coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock query failed",
      cause,
    ),
  );
  const rows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(result, () => {
      throw new Error("Invalid database clock result");
    }),
    catch: cause => coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock result is invalid",
      cause,
    ),
  });
  const row = rows[0];
  if (rows.length !== 1 || !isRecord(row)) {
    return yield* Effect.fail(coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock returned an invalid row count",
    ));
  }
  const databaseNow = databaseTimestampFromUnknown(row.database_now);
  const leaseExpiresAt = databaseTimestampFromUnknown(row.lease_expires_at);
  if (databaseNow === null || leaseExpiresAt === null) {
    return yield* Effect.fail(coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock returned an invalid timestamp",
    ));
  }
  return Object.freeze({
    databaseNow: yield* Effect.fromResult(
      canonicalIsoInstantFromDate(databaseNow),
    ).pipe(Effect.mapError(cause => coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock was not canonical",
      cause,
    ))),
    leaseExpiresAt: yield* Effect.fromResult(
      canonicalIsoInstantFromDate(leaseExpiresAt),
    ).pipe(Effect.mapError(cause => coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration lease expiry was not canonical",
      cause,
    ))),
  });
});

function makeClaim(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  collision: RestoredFrameworkMigrationCollisionDomain,
  plan: FreshRelationalMigrationPlan,
  attemptFence: string,
): FrameworkMigrationClaim {
  const claim = Object.freeze({
    [frameworkMigrationClaimBrand]: true,
  } satisfies FrameworkMigrationClaim);
  claimStates.set(claim, Object.freeze({
    target: input.target,
    collision,
    plan,
    attemptId: input.attemptId,
    attemptFence,
    leaseOwnerId: input.leaseOwnerId,
    leaseDurationMilliseconds: input.leaseDurationMilliseconds,
    lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
    statementTimeoutMilliseconds: input.statementTimeoutMilliseconds,
  }));
  return claim;
}

function requireExactPlan(
  actual: FreshRelationalMigrationPlan,
  expected: FreshRelationalMigrationPlan,
  operation: FrameworkMigrationCoordinatorError["operation"],
): Effect.Effect<void, FrameworkMigrationCoordinatorError> {
  return actual.migrationPlanSha256 === expected.migrationPlanSha256 &&
      actual.canonicalJson === expected.canonicalJson
    ? Effect.void
    : Effect.fail(coordinatorError(
      operation,
      "planConflict",
      "Migration collision lane contains another plan",
    ));
}

function eventToken(event: RestoredFrameworkMigrationEvent) {
  return Object.freeze({
    sequence: event.event.frame.sequence,
    eventSha256: event.event.sha256,
  });
}

function nextInt64(value: string): CanonicalNonNegativeInt64 {
  return brandNonNegativeInt64((BigInt(value) + 1n).toString());
}

function ordinaryRequest(input: RunFreshFrameworkMigrationCoordinatorInput) {
  return Object.freeze({
    kind: "ordinary" as const,
    lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
    statementTimeoutMilliseconds: input.statementTimeoutMilliseconds,
  });
}

function recoveryRequest(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  excludedSessionIdentity: FrameworkMigrationSessionIdentity,
) {
  return Object.freeze({
    kind: "recovery" as const,
    excludedSessionIdentity,
    lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
    statementTimeoutMilliseconds: input.statementTimeoutMilliseconds,
  });
}

function claimOrdinaryRequest(state: FrameworkMigrationClaimState) {
  return Object.freeze({
    kind: "ordinary" as const,
    lockTimeoutMilliseconds: state.lockTimeoutMilliseconds,
    statementTimeoutMilliseconds: state.statementTimeoutMilliseconds,
  });
}

function claimRecoveryRequest(
  state: FrameworkMigrationClaimState,
  excludedSessionIdentity: FrameworkMigrationSessionIdentity,
) {
  return Object.freeze({
    kind: "recovery" as const,
    excludedSessionIdentity,
    lockTimeoutMilliseconds: state.lockTimeoutMilliseconds,
    statementTimeoutMilliseconds: state.statementTimeoutMilliseconds,
  });
}

function coordinatorError(
  operation: FrameworkMigrationCoordinatorError["operation"],
  reason: FrameworkMigrationCoordinatorError["reason"],
  message: string,
  cause?: unknown,
): FrameworkMigrationCoordinatorError {
  return new FrameworkMigrationCoordinatorError({
    operation,
    reason,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function corruption(
  operation: FrameworkMigrationCoordinatorError["operation"],
  message: string,
): FrameworkMigrationCoordinatorError {
  return coordinatorError(operation, "storedCorruption", message);
}

function isPositiveBoundedInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 600_000;
}

function isIdentityText(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024 &&
    !value.includes("\0");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
