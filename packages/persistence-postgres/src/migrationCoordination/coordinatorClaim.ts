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
} from "./migrationCollisionHeadRepository";
import { Effect, Option } from "effect";
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
} from "./migrationStepReceiptRepository";
import type { RelationalMigrationPlan } from "./model";
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
  appendEvent,
  advanceHead,
  readDatabaseClock,
  ordinaryRequest,
  reserveAdditiveEvents,
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

const claimStates = new WeakMap<
  FrameworkMigrationClaim,
  FrameworkMigrationClaimState
>();

export function makeClaim(
  input: RunFreshFrameworkMigrationCoordinatorInput,
  collision: RestoredFrameworkMigrationCollisionDomain,
  definition: PreparedFrameworkMigrationDefinition,
  attemptFence: string,
): FrameworkMigrationClaim {
  const claim = Object.freeze({
    [frameworkMigrationClaimBrand]: true,
  } satisfies FrameworkMigrationClaim);
  claimStates.set(claim, Object.freeze({
    target: input.target,
    collision,
    definition,
    attemptId: input.attemptId,
    attemptFence,
    leaseOwnerId: input.leaseOwnerId,
    leaseDurationMilliseconds: input.leaseDurationMilliseconds,
    lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
    statementTimeoutMilliseconds: input.statementTimeoutMilliseconds,
  }));
  return claim;
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

export const renewClaimIfNeeded = Effect.fn(
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
      raw => Effect.map(loadLockedClaimState(raw, state), locked =>
        Object.freeze({
          completedStepCount: locked.head.progress.completedStepCount,
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
