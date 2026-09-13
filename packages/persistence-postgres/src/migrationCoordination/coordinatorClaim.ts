/**
 * Claim identity, locked progress validation and lease renewal. The registry stores
 * immutable execution inputs; Postgres still supplies every live fence, lease and
 * progress decision.
 */
import type { PreparedFrameworkMigrationDefinition } from "./definition";
import { verifyFrameworkMigrationReceiptProgress } from "./verify";
import { withAdditiveMigrationGraphLimits } from "./graphLimits";
import type { CanonicalIsoInstant } from "@flarex/time/iso-instant";
import {
  readFrameworkMigrationClaimGraphForUpdateInTransactionEffect,
  readFrameworkMigrationProgressRecordForUpdateInTransactionEffect,
  advanceFrameworkMigrationProgressRecordInTransactionEffect,
  type FrameworkMigrationProgressRecord,
} from "./migrationCollisionHeadRepository";
import { Effect, Option, Result } from "effect";
import { eq } from "drizzle-orm";
import { authenticateFrameworkMigrationBaseEffect } from "./baseRepository";
import { fxSystemFrameworkSchemaAvailabilityHeads } from "../frameworkSchema/installation/schema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import {
  readFrameworkSchemaAvailabilityHeadInTransactionEffect,
} from "../frameworkSchema/installation/availabilityHeadRepository";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import {
  readFrameworkMigrationStepReceiptPrefixInTransactionEffect,
  readFrameworkMigrationCompletionTailInTransactionEffect,
  type FrameworkMigrationCommittedCompletion,
} from "./migrationStepReceiptRepository";
import { FRAMEWORK_MIGRATION_EVENT_FORMAT, FRAMEWORK_MIGRATION_EVENT_VERSION, type RelationalMigrationPlan } from "./model";
import { captureFrameworkMigrationEvent } from "./canonical";
import { readFrameworkMigrationEventRecordInTransactionEffect, appendFrameworkMigrationEventRecordInTransactionEffect,
  type FrameworkMigrationEventRecord } from "./migrationEventRepository";
import {
  observeRelationalMigrationBaseEffect,
  type RelationalStructuralRunnerToken,
} from "./relationalStructuralRunner";
import {
  restoredFrameworkMigrationCollisionHeadAuthority,
  type RestoredFrameworkMigrationCollisionHead,
} from "./storedEventRestoration";
import type {
  RestoredFrameworkMigrationAttemptStart,
  RestoredFrameworkMigrationCollisionDomain,
  RestoredFrameworkMigrationStepReceipt,
} from "./storedRestoration";
import { indexRestoredFrameworkMigrationAttemptLineage, restoredFrameworkMigrationAttemptLineage } from "./storedRestoration";
import {
  type FrameworkMigrationTarget,
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
} from "./targetSession";
import {
  FrameworkMigrationCoordinatorError,
  type FrameworkMigrationCoordinatorFailure,
  type RunFreshFrameworkMigrationCoordinatorInput,
  coordinatorError,
  corruption,
} from "./coordinatorContracts";
import {
  readDatabaseClock,
  ordinaryRequest,
  reserveAdditiveEvents,
  reserveAdditiveEventCapacity,
  nextInt64,
  eventToken,
} from "./coordinatorJournal";

const frameworkMigrationClaimBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkMigrationClaim",
);

export interface FrameworkMigrationClaim {
  readonly [frameworkMigrationClaimBrand]: true;
}

export interface FrameworkMigrationClaimState {
  readonly definition: PreparedFrameworkMigrationDefinition;
  readonly target: FrameworkMigrationTarget;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly lineage: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart>;
  readonly attemptId: string;
  readonly attemptFence: string;
  readonly leaseOwnerId: string;
  readonly leaseDurationMilliseconds: number;
  readonly lockTimeoutMilliseconds: number;
  readonly statementTimeoutMilliseconds: number;
}

interface LockedClaimState {
  readonly head: RestoredFrameworkMigrationCollisionHead;
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly plan: RelationalMigrationPlan;
  readonly structuralRunner: RelationalStructuralRunnerToken;
  readonly receipts: readonly RestoredFrameworkMigrationStepReceipt[];
  readonly databaseNow: CanonicalIsoInstant;
}

interface LockedClaimProgress {
  readonly head: FrameworkMigrationProgressRecord;
  readonly lastEvent: FrameworkMigrationEventRecord | null;
  readonly tail: FrameworkMigrationCommittedCompletion | null;
  readonly databaseNow: CanonicalIsoInstant;
}

export const loadLockedClaimProgress = Effect.fn("FrameworkMigrationCoordinator.loadLockedProgress")(
  function* (raw: FlarexMetadataTransaction, state: FrameworkMigrationClaimState): Effect.fn.Return<LockedClaimProgress, FrameworkMigrationCoordinatorFailure> {
    const selected = yield* readFrameworkMigrationProgressRecordForUpdateInTransactionEffect(raw, state.collision);
    if (Option.isNone(selected)) return yield* Effect.fail(corruption("step", "Collision head disappeared while continuing a claim"));
    const head = selected.value;
    const frame = head.head.frame;
    const plan = state.attempt.plan.plan;
    if (frame.currentPlan.planSha256 !== state.definition.plan.migrationPlanSha256) {
      return yield* Effect.fail(coordinatorError("step", "planConflict", "Migration collision lane contains another plan"));
    }
    yield* requireAdmissibleBase(raw, state.collision, plan);
    yield* reserveAdditiveEventCapacity(plan, frame.lastEvent?.sequence ?? "0", 2);
    const current = frame.currentAttempt;
    if (current === null || current.attemptId !== state.attemptId || current.attemptFence !== state.attemptFence || current.leaseOwnerId !== state.leaseOwnerId) {
      return yield* Effect.fail(coordinatorError("step", "staleFence", "Framework migration claim no longer owns the collision lane"));
    }
    if (head.currentPlanStorageId !== state.attempt.plan.storageId || head.currentAdmissionStorageId !== state.attempt.admission.storageId ||
      head.currentAttemptStorageId !== state.attempt.storageId || frame.currentPlan.admissionSha256 !== state.attempt.admission.admission.sha256 ||
      frame.attemptFence !== state.attemptFence || head.completedStepCount > plan.frame.steps.length) {
      return yield* Effect.fail(corruption("step", "Collision head does not match its claim definition"));
    }
    const clock = yield* readDatabaseClock(raw, 1);
    if (Date.parse(current.leaseExpiresAt) <= Date.parse(clock.databaseNow)) {
      return yield* Effect.fail(coordinatorError("step", "leaseLost", "Framework migration claim lease has expired"));
    }
    const tail = yield* readFrameworkMigrationCompletionTailInTransactionEffect(raw, state.attempt, head.completedStepCount, head.lastReceipt, state.lineage);
    let lastEvent: FrameworkMigrationEventRecord | null = null;
    if (head.lastEventStorageId !== null && frame.lastEvent !== null) {
      lastEvent = yield* readFrameworkMigrationEventRecordInTransactionEffect(raw, state.collision, head.lastEventStorageId,
        frame.lastEvent.sequence, frame.lastEvent.eventSha256);
      const event = lastEvent.event.frame;
      const matches = event.kind === "stepCompleted" ? tail !== null && event.stepReceiptSha256 === tail.sha256 :
        event.kind === "attemptStarted" ? event.attemptStartSha256 === state.attempt.attempt.sha256 :
        event.kind === "planAdmitted" ? event.admissionSha256 === state.attempt.admission.admission.sha256 :
        event.kind === "leaseRenewed" && event.attemptId === current.attemptId && event.attemptFence === current.attemptFence &&
          event.leaseOwnerId === current.leaseOwnerId && event.leaseExpiresAt === current.leaseExpiresAt;
      if (!matches) return yield* Effect.fail(corruption("step", "Collision head event does not match its operational progress"));
    } else if (tail !== null) return yield* Effect.fail(corruption("step", "Completed progress has no event commitment"));
    return Object.freeze({ head, lastEvent, tail, databaseNow: clock.databaseNow });
  },
);

export const renewLockedClaimProgressIfNeeded = Effect.fn("FrameworkMigrationCoordinator.renewLockedProgress")(
  function* (raw: FlarexMetadataTransaction, state: FrameworkMigrationClaimState, locked: LockedClaimProgress): Effect.fn.Return<
    LockedClaimProgress, FrameworkMigrationCoordinatorFailure
  > {
    const current = locked.head.head.frame.currentAttempt;
    if (current === null) return yield* Effect.fail(corruption("step", "Claim head lost its current-attempt projection"));
    if (Date.parse(current.leaseExpiresAt) - Date.parse(locked.databaseNow) > Math.floor(state.leaseDurationMilliseconds / 2)) return locked;
    const clock = yield* readDatabaseClock(raw, state.leaseDurationMilliseconds);
    const value = yield* captureFrameworkMigrationEvent({ format: FRAMEWORK_MIGRATION_EVENT_FORMAT, version: FRAMEWORK_MIGRATION_EVENT_VERSION,
      collision: state.collision.coordinate, sequence: nextInt64(locked.lastEvent?.event.frame.sequence ?? "0"),
      previousEvent: locked.lastEvent === null ? null : eventToken(locked.lastEvent), recordedAt: clock.databaseNow,
      kind: "leaseRenewed", attemptId: current.attemptId, attemptFence: current.attemptFence,
      leaseOwnerId: current.leaseOwnerId, leaseExpiresAt: clock.leaseExpiresAt });
    const lastEvent = yield* appendFrameworkMigrationEventRecordInTransactionEffect(raw, state.collision, locked.lastEvent, value);
    const head = yield* advanceFrameworkMigrationProgressRecordInTransactionEffect(raw, locked.head, state.attempt, lastEvent, null);
    return Object.freeze({ head, lastEvent, tail: locked.tail, databaseNow: clock.databaseNow });
  },
);

const claimStates = new WeakMap<
  FrameworkMigrationClaim,
  FrameworkMigrationClaimState
>();

export function makeClaim(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  attempt: RestoredFrameworkMigrationAttemptStart,
  definition: PreparedFrameworkMigrationDefinition,
): Result.Result<FrameworkMigrationClaim, FrameworkMigrationCoordinatorError> {
  const lineage = restoredFrameworkMigrationAttemptLineage(attempt);
  if (lineage === undefined || attempt.attempt.frame.attemptId !== input.attemptId ||
    attempt.plan.plan.migrationPlanSha256 !== definition.plan.migrationPlanSha256 || attempt.plan.plan.canonicalJson !== definition.plan.canonicalJson) {
    return Result.fail(coordinatorError("claim", "invalidInput", "Framework migration claim definition or attempt is invalid"));
  }
  indexRestoredFrameworkMigrationAttemptLineage(lineage);
  const claim = Object.freeze({
    [frameworkMigrationClaimBrand]: true,
  } satisfies FrameworkMigrationClaim);
  claimStates.set(claim, Object.freeze({
    target: input.target,
    collision: attempt.collision,
    attempt,
    lineage: new Map(lineage.map(producer => [producer.storageId, producer])),
    definition,
    attemptId: input.attemptId,
    attemptFence: attempt.attempt.frame.attemptFence,
    leaseOwnerId: input.leaseOwnerId,
    leaseDurationMilliseconds: input.leaseDurationMilliseconds,
    lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
    statementTimeoutMilliseconds: input.statementTimeoutMilliseconds,
  }));
  return Result.succeed(claim);
}

export function withClaimGraphLimits<Value, Failure>(effect: Effect.Effect<Value, Failure>, claim: FrameworkMigrationClaim): Effect.Effect<Value, Failure> {
  return claimStates.get(claim)?.definition.plan.frame.version === 2 ? withAdditiveMigrationGraphLimits(effect) : effect;
}

export const loadLockedClaimState = Effect.fn(
  "FreshFrameworkMigrationCoordinator.loadLockedClaim",
)(function* (
  raw: FlarexMetadataTransaction,
  state: FrameworkMigrationClaimState,
  requireUnexpiredLease = true,
): Effect.fn.Return<LockedClaimState, FrameworkMigrationCoordinatorFailure> {
  const head = yield*
    readFrameworkMigrationClaimGraphForUpdateInTransactionEffect(
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
    head.value.head,
    requireUnexpiredLease,
    head.value.receipts,
  );
});

export const requireAdmissibleBase = Effect.fn("FrameworkMigrationCoordinator.requireBase")(
  function* (raw: FlarexMetadataTransaction, collision: RestoredFrameworkMigrationCollisionDomain,
    plan: RelationalMigrationPlan): Effect.fn.Return<void, FrameworkMigrationCoordinatorFailure> {
    if (plan.frame.version === 1) return;
    const base = yield* authenticateFrameworkMigrationBaseEffect(raw, collision, plan.frame.baseInstallation, "readPlan");
    const locked = yield* runDrizzleStatementEffect(raw.select({
      status: fxSystemFrameworkSchemaAvailabilityHeads.status,
      sequence: fxSystemFrameworkSchemaAvailabilityHeads.availabilitySequence,
    }).from(fxSystemFrameworkSchemaAvailabilityHeads).where(eq(
      fxSystemFrameworkSchemaAvailabilityHeads.installationStorageId, base.installation.storageId,
    )).for("update"), cause => coordinatorError("step", "resourceFailure", "Base availability lock failed", cause));
    if (locked.length !== 1 || locked[0]?.status !== "ready" || locked[0].sequence > 8n) {
      return yield* Effect.fail(coordinatorError("step", "planConflict", "Base availability is not admissible"));
    }
    const availability = yield* readFrameworkSchemaAvailabilityHeadInTransactionEffect(raw, base.installation);
    if (Option.isNone(availability) || availability.value.head.frame.status !== "ready" ||
      availability.value.head.frame.readinessSha256 !== base.readiness.sha256 ||
      (yield* observeRelationalMigrationBaseEffect(raw, plan)) !== "exact") {
      return yield* Effect.fail(coordinatorError("step", "planConflict", "Base evidence or retained structure changed"));
    }
  },
);

export const validateLockedClaimHead = Effect.fn(
  "FreshFrameworkMigrationCoordinator.validateLockedClaim",
)(function* (
  raw: FlarexMetadataTransaction,
  state: FrameworkMigrationClaimState,
  head: RestoredFrameworkMigrationCollisionHead,
  requireUnexpiredLease = true,
  restoredReceipts?: readonly RestoredFrameworkMigrationStepReceipt[],
): Effect.fn.Return<LockedClaimState, FrameworkMigrationCoordinatorFailure> {
  yield* requireExactPlan(head.plan.plan, state.definition.plan, "step");
  yield* requireAdmissibleBase(raw, head.collision, head.plan.plan);
  yield* reserveAdditiveEvents(head, 2);
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
  const receipts = restoredReceipts ?? (yield*
    readFrameworkMigrationStepReceiptPrefixInTransactionEffect(raw, attempt));
  yield* verifyFrameworkMigrationReceiptProgress(head, receipts);
  const plan = attempt.plan.plan;
  const structuralRunner = state.definition.runner;
  return Object.freeze({
    head,
    attempt,
    plan,
    structuralRunner,
    receipts,
    databaseNow: clock.databaseNow,
  });
});

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
    ordinaryRequest(state),
    transaction => withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      raw => Effect.map(loadLockedClaimProgress(raw, state), locked =>
        Object.freeze({
          completedStepCount: locked.head.completedStepCount,
          requiredStepCount: state.definition.plan.frame.steps.length,
        })
      ),
    ),
  );
}, withClaimGraphLimits);

export function requireExactPlan(
  actual: RelationalMigrationPlan,
  expected: RelationalMigrationPlan,
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

/** Source-private read access; the claim registry has one issuer and remains private. */
export function getFrameworkMigrationClaimState(claim: FrameworkMigrationClaim): FrameworkMigrationClaimState | undefined {
  return claimStates.get(claim);
}
