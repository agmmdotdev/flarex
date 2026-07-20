import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Data, Effect, Result, Schema } from "effect";
import type { GrantRetentionPolicyV1 } from
  "flarex-protocol/grant-retention-policy";
import {
  ReplacementScopeIdV1Schema,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";

import type {
  LocatedScopeClockReader,
  ScopeClockTargetReaderResolver,
  ScopeMetadataReader,
  ScopeProvisioningReceiptReader,
  TrustedScopeAuthority,
  TrustedScopeAuthorityResolutionError,
} from "./scopeAuthorityResolution";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  TrustedScopeAuthorityPortError,
} from "./scopeAuthorityResolution";
import {
  decodeTransactionExecutionClaimFenceV1,
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimObservationV1,
  type TransactionExecutionClaimPinV1,
} from "./transactionExecutionClaimModel";
import type { PointMutationSessionAttemptSelectorV1 } from
  "./transactionSessionActivation";

const decodeDeploymentId = Schema.decodeUnknownResult(
  Schema.toType(TransactionGrantDeploymentIdV1Schema),
);
const decodeScopeId = Schema.decodeUnknownResult(
  Schema.toType(ReplacementScopeIdV1Schema),
);
const decodeSessionId = Schema.decodeUnknownResult(
  Schema.toType(TransactionSessionIdV1Schema),
);
const decodeAttemptFence = Schema.decodeUnknownResult(
  Schema.toType(TransactionAttemptFenceSchema),
);

export interface PointMutationExecutionClaimLivenessInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

export interface PointMutationExecutionClaimLivenessOptionsV1 {
  readonly claimDurationMilliseconds: number;
  readonly leaseRenewalDurationMilliseconds: number;
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
}

/** Frozen correlation evidence only; never an execution or renewal capability. */
export type PointMutationExecutionClaimLivenessResultV1 =
  | Readonly<{
      readonly kind: "renewed";
      readonly phase: "open" | "sealed";
      readonly leaseExpiresAt: string;
      readonly executionClaim: TransactionExecutionClaimObservationV1;
    }>
  | Readonly<{
      readonly kind: "terminalizationRequired";
      readonly reason: "failedRoot";
      readonly leaseExpiresAt: string;
      readonly executionClaim: TransactionExecutionClaimObservationV1;
    }>
  | Readonly<{
      readonly kind: "consumedByFinishing";
    }>;

export class PointMutationExecutionClaimLivenessInputV1Error
  extends Data.TaggedError("PointMutationExecutionClaimLivenessInputV1Error")<{
    readonly reason: "invalidInput";
    readonly cause?: unknown;
  }> {}

export class PointMutationExecutionClaimLivenessConfigurationV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimLivenessConfigurationV1Error",
  )<{
    readonly reason:
      | "invalidClaimDuration"
      | "invalidLeaseRenewalDuration"
      | "claimDurationExceedsLeaseRenewalDuration"
      | "leaseRenewalDurationExceedsRetentionBudget";
  }> {}

export class PointMutationExecutionClaimLivenessStaleV1Error
  extends Data.TaggedError("PointMutationExecutionClaimLivenessStaleV1Error")<{
    readonly reason:
      | "scopeChanged"
      | "deploymentChanged"
      | "attemptMissing"
      | "attemptReplaced"
      | "lifecycleChanged"
      | "generationChanged"
      | "epochChanged"
      | "revocationEpochChanged"
      | "leaseExpired"
      | "authorizationExpired"
      | "claimOwnerChanged"
      | "claimFenceChanged"
      | "claimExpired";
  }> {}

export class PointMutationExecutionClaimLivenessCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimLivenessCorruptionV1Error",
  )<{
    readonly reason:
      | "clockInvalid"
      | "sessionInvalid"
      | "leaseInvalid"
      | "journalRootInvalid"
      | "claimInvalid"
      | "claimLeaseOrderingInvalid"
      | "mutationInvalid";
    readonly cause?: unknown;
  }> {}

export class PointMutationExecutionClaimLivenessPersistenceV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimLivenessPersistenceV1Error",
  )<{
    readonly operation: "prelude" | "transaction";
    readonly cause: unknown;
  }> {}

export class PointMutationExecutionClaimLivenessUncertainV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimLivenessUncertainV1Error",
  )<{
    readonly cause: unknown;
  }> {}

export type PointMutationExecutionClaimLivenessV1Error =
  | PointMutationExecutionClaimLivenessInputV1Error
  | PointMutationExecutionClaimLivenessConfigurationV1Error
  | PointMutationExecutionClaimLivenessStaleV1Error
  | PointMutationExecutionClaimLivenessCorruptionV1Error
  | PointMutationExecutionClaimLivenessPersistenceV1Error
  | PointMutationExecutionClaimLivenessUncertainV1Error
  | TrustedScopeAuthorityResolutionError;

export interface PointMutationExecutionClaimLivenessV1 {
  /**
   * Frozen construction evidence for lifecycle owners. It is scheduling
   * policy only and never execution or renewal authority.
   */
  readonly configuration: Result.Result<
    PointMutationExecutionClaimLivenessConfigurationV1,
    PointMutationExecutionClaimLivenessConfigurationV1Error
  >;
  readonly renewEffect: (
    input: PointMutationExecutionClaimLivenessInputV1,
  ) => Effect.Effect<
    PointMutationExecutionClaimLivenessResultV1,
    PointMutationExecutionClaimLivenessV1Error
  >;
}

export interface PointMutationExecutionClaimLivenessConfigurationV1 {
  readonly claimDurationMilliseconds: number;
  readonly leaseRenewalDurationMilliseconds: number;
  readonly maximumLiveSnapshotRetentionMilliseconds: number;
}

export interface PointMutationExecutionClaimLivenessPortsV1 {
  readonly scopeMetadata: ScopeMetadataReader;
  readonly provisioningReceipts: ScopeProvisioningReceiptReader;
  readonly scopeSessionTargets: ScopeClockTargetReaderResolver;
}

export interface LocatedPointMutationExecutionClaimLivenessInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
  readonly claimDurationMilliseconds: number;
  readonly leaseRenewalDurationMilliseconds: number;
  readonly maximumLiveSnapshotRetentionMilliseconds: number;
}

export const RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1: unique symbol =
  Symbol("FlarexDB/renewPointMutationExecutionClaimEffectV1");

export interface LocatedPointMutationExecutionClaimLivenessTargetV1
  extends LocatedScopeClockReader {
  readonly [RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]: (
    input: LocatedPointMutationExecutionClaimLivenessInputV1,
  ) => Effect.Effect<
    PointMutationExecutionClaimLivenessResultV1,
    Exclude<
      PointMutationExecutionClaimLivenessV1Error,
      PointMutationExecutionClaimLivenessInputV1Error |
        PointMutationExecutionClaimLivenessConfigurationV1Error |
        TrustedScopeAuthorityResolutionError
    >
  >;
}

export interface ProjectExecutionClaimRenewalInputV1 {
  readonly databaseNowMilliseconds: number;
  readonly currentLeaseExpiresAtMilliseconds: number;
  readonly currentClaimExpiresAtMilliseconds: number;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly claimDurationMilliseconds: number;
  readonly leaseRenewalDurationMilliseconds: number;
  readonly maximumLiveSnapshotRetentionMilliseconds: number;
  readonly phase: "open" | "sealed" | "failed";
}

export type ProjectExecutionClaimRenewalIssueV1 =
  | "invalidEvidence"
  | "authorityExpired"
  | "leaseExpired"
  | "claimExpired"
  | "claimAfterLease"
  | "leaseAfterAuthorityTarget"
  | "leaseRetentionBudgetExceeded"
  | "sealedLeaseMismatch";

export interface ProjectExecutionClaimRenewalV1 {
  readonly targetLeaseExpiresAtMilliseconds: number;
  readonly targetClaimExpiresAtMilliseconds: number;
}

export function projectExecutionClaimRenewalV1Result(
  input: ProjectExecutionClaimRenewalInputV1,
): Result.Result<
  ProjectExecutionClaimRenewalV1,
  ProjectExecutionClaimRenewalIssueV1
> {
  const values = [
    input.databaseNowMilliseconds,
    input.currentLeaseExpiresAtMilliseconds,
    input.currentClaimExpiresAtMilliseconds,
    input.authorizationGrantExpiresAtMilliseconds,
    input.hardExpiresAtMilliseconds,
    input.claimDurationMilliseconds,
    input.leaseRenewalDurationMilliseconds,
    input.maximumLiveSnapshotRetentionMilliseconds,
  ];
  if (
    values.some((value) => !Number.isSafeInteger(value)) ||
    input.databaseNowMilliseconds <= 0 ||
    input.claimDurationMilliseconds <= 0 ||
    input.leaseRenewalDurationMilliseconds <= 0 ||
    input.maximumLiveSnapshotRetentionMilliseconds <= 0 ||
    input.claimDurationMilliseconds > input.leaseRenewalDurationMilliseconds ||
    input.leaseRenewalDurationMilliseconds >
      input.maximumLiveSnapshotRetentionMilliseconds ||
    input.databaseNowMilliseconds >
      Number.MAX_SAFE_INTEGER - input.leaseRenewalDurationMilliseconds ||
    input.databaseNowMilliseconds >
      Number.MAX_SAFE_INTEGER - input.claimDurationMilliseconds
  ) {
    return Result.fail("invalidEvidence");
  }
  const authorityTarget = Math.min(
    input.authorizationGrantExpiresAtMilliseconds,
    input.hardExpiresAtMilliseconds,
  );
  if (authorityTarget <= input.databaseNowMilliseconds) {
    return Result.fail("authorityExpired");
  }
  if (input.currentLeaseExpiresAtMilliseconds <= input.databaseNowMilliseconds) {
    return Result.fail("leaseExpired");
  }
  if (input.currentClaimExpiresAtMilliseconds <= input.databaseNowMilliseconds) {
    return Result.fail("claimExpired");
  }
  if (
    input.currentClaimExpiresAtMilliseconds >
      input.currentLeaseExpiresAtMilliseconds
  ) {
    return Result.fail("claimAfterLease");
  }
  if (input.currentLeaseExpiresAtMilliseconds > authorityTarget) {
    return Result.fail("leaseAfterAuthorityTarget");
  }
  if (
    input.currentLeaseExpiresAtMilliseconds - input.databaseNowMilliseconds >
      input.maximumLiveSnapshotRetentionMilliseconds
  ) {
    return Result.fail("leaseRetentionBudgetExceeded");
  }
  if (
    input.phase === "sealed" &&
    input.currentLeaseExpiresAtMilliseconds !== authorityTarget
  ) {
    return Result.fail("sealedLeaseMismatch");
  }

  const targetLeaseExpiresAtMilliseconds = input.phase === "sealed"
    ? input.currentLeaseExpiresAtMilliseconds
    : Math.max(
      input.currentLeaseExpiresAtMilliseconds,
      Math.min(
        input.databaseNowMilliseconds + input.leaseRenewalDurationMilliseconds,
        authorityTarget,
      ),
    );
  const targetClaimExpiresAtMilliseconds = Math.max(
    input.currentClaimExpiresAtMilliseconds,
    Math.min(
      input.databaseNowMilliseconds + input.claimDurationMilliseconds,
      targetLeaseExpiresAtMilliseconds,
      authorityTarget,
    ),
  );
  return Result.succeed(Object.freeze({
    targetLeaseExpiresAtMilliseconds,
    targetClaimExpiresAtMilliseconds,
  }));
}

export function createPointMutationExecutionClaimLivenessV1(
  ports: PointMutationExecutionClaimLivenessPortsV1,
  options: PointMutationExecutionClaimLivenessOptionsV1,
): PointMutationExecutionClaimLivenessV1 {
  const configuration = captureLivenessConfiguration(options);
  const renewEffect = Effect.fn("PointMutationExecutionClaimLiveness.renew")(
    function* (
      input: PointMutationExecutionClaimLivenessInputV1,
    ): Effect.fn.Return<
      PointMutationExecutionClaimLivenessResultV1,
      PointMutationExecutionClaimLivenessV1Error
    > {
      const config = yield* Effect.fromResult(configuration);
      const captured = yield* Effect.fromResult(captureLivenessInput(input));
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        captured.selector.deploymentId,
        {
          scopeMetadata: ports.scopeMetadata,
          provisioningReceipts: ports.provisioningReceipts,
          scopeClockTargets: ports.scopeSessionTargets,
        },
      ).pipe(Effect.mapError((error) =>
        error instanceof TrustedScopeAuthorityPortError
          ? new PointMutationExecutionClaimLivenessPersistenceV1Error({
            operation: "prelude",
            cause: error.cause,
          })
          : error
      ));
      if (located.authority.scopeId !== captured.selector.scopeId) {
        return yield* Effect.fail(
          new PointMutationExecutionClaimLivenessStaleV1Error({
            reason: "scopeChanged",
          }),
        );
      }
      if (!isLocatedLivenessTarget(located.target)) {
        return yield* Effect.fail(
          new PointMutationExecutionClaimLivenessPersistenceV1Error({
            operation: "prelude",
            cause: new Error(
              "Located scope target cannot renew execution-claim liveness.",
            ),
          }),
        );
      }
      return yield* located.target[
        RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1
      ]({
        ...captured,
        preliminaryAuthority: located.authority,
        ...config,
      });
    },
  );
  return Object.freeze({ configuration, renewEffect });
}

function captureLivenessConfiguration(
  input: PointMutationExecutionClaimLivenessOptionsV1,
): Result.Result<
  PointMutationExecutionClaimLivenessConfigurationV1,
  PointMutationExecutionClaimLivenessConfigurationV1Error
> {
  if (!isPositiveSafeInteger(input.claimDurationMilliseconds)) {
    return Result.fail(
      new PointMutationExecutionClaimLivenessConfigurationV1Error({
        reason: "invalidClaimDuration",
      }),
    );
  }
  if (!isPositiveSafeInteger(input.leaseRenewalDurationMilliseconds)) {
    return Result.fail(
      new PointMutationExecutionClaimLivenessConfigurationV1Error({
        reason: "invalidLeaseRenewalDuration",
      }),
    );
  }
  if (
    input.claimDurationMilliseconds > input.leaseRenewalDurationMilliseconds
  ) {
    return Result.fail(
      new PointMutationExecutionClaimLivenessConfigurationV1Error({
        reason: "claimDurationExceedsLeaseRenewalDuration",
      }),
    );
  }
  if (
    input.leaseRenewalDurationMilliseconds >
      input.grantRetentionPolicy.maximumLiveSnapshotRetentionMilliseconds
  ) {
    return Result.fail(
      new PointMutationExecutionClaimLivenessConfigurationV1Error({
        reason: "leaseRenewalDurationExceedsRetentionBudget",
      }),
    );
  }
  return Result.succeed(Object.freeze({
    claimDurationMilliseconds: input.claimDurationMilliseconds,
    leaseRenewalDurationMilliseconds: input.leaseRenewalDurationMilliseconds,
    maximumLiveSnapshotRetentionMilliseconds:
      input.grantRetentionPolicy.maximumLiveSnapshotRetentionMilliseconds,
  }));
}

function captureLivenessInput(
  input: PointMutationExecutionClaimLivenessInputV1,
): Result.Result<
  Readonly<{
    readonly selector: PointMutationSessionAttemptSelectorV1;
    readonly executionClaim: TransactionExecutionClaimPinV1;
  }>,
  PointMutationExecutionClaimLivenessInputV1Error
> {
  return Result.gen(function* () {
    const invalid = (cause?: unknown) =>
      new PointMutationExecutionClaimLivenessInputV1Error({
        reason: "invalidInput",
        ...(cause === undefined ? {} : { cause }),
      });
    const selectorInput = input?.selector;
    const deploymentId = yield* decodeDeploymentId(
      selectorInput?.deploymentId,
    ).pipe(Result.mapError(invalid));
    const scopeId = yield* decodeScopeId(selectorInput?.scopeId).pipe(
      Result.mapError(invalid),
    );
    const sessionId = yield* decodeSessionId(selectorInput?.sessionId).pipe(
      Result.mapError(invalid),
    );
    const attemptFence = yield* decodeAttemptFence(
      selectorInput?.attemptFence,
    ).pipe(Result.mapError(invalid));
    const claimOwner = yield* decodeTransactionExecutionClaimOwnerV1(
      input?.executionClaim?.claimOwner,
    ).pipe(Result.mapError(invalid));
    const claimFence = yield* decodeTransactionExecutionClaimFenceV1(
      input?.executionClaim?.claimFence,
    ).pipe(Result.mapError(invalid));
    return Object.freeze({
      selector: Object.freeze({
        deploymentId,
        scopeId,
        sessionId,
        attemptFence,
      }),
      executionClaim: Object.freeze({ claimOwner, claimFence }),
    });
  });
}

function isLocatedLivenessTarget(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationExecutionClaimLivenessTargetV1 {
  return typeof Reflect.get(
    target,
    RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1,
  ) === "function";
}
