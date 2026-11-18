import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { Result } from "effect";

export type SealedAttemptLeasePromotionIssueV1 =
  | Readonly<{ readonly kind: "authorityExpiryInvalid" }>
  | Readonly<{ readonly kind: "databaseClockInvalid" }>
  | Readonly<{ readonly kind: "retentionBudgetInvalid" }>
  | Readonly<{
      readonly kind: "authorityExpired";
      readonly targetLeaseExpiresAtMilliseconds: number;
      readonly databaseNowMilliseconds: number;
    }>
  | Readonly<{
      readonly kind: "retentionBudgetExceeded";
      readonly remainingMilliseconds: number;
      readonly maximumLiveSnapshotRetentionMilliseconds: number;
    }>
  | Readonly<{ readonly kind: "currentLeaseInvalid" }>
  | Readonly<{
      readonly kind: "currentLeaseExpired";
      readonly currentLeaseExpiresAtMilliseconds: number;
      readonly databaseNowMilliseconds: number;
    }>
  | Readonly<{
      readonly kind: "currentLeaseAfterTarget";
      readonly currentLeaseExpiresAtMilliseconds: number;
      readonly targetLeaseExpiresAtMilliseconds: number;
    }>;

export interface SealedAttemptLeasePromotionV1 {
  readonly targetLeaseExpiresAtMilliseconds: number;
  readonly remainingMilliseconds: number;
}

export function deriveSealedAttemptLeaseTargetV1Result(
  authorizationGrantExpiresAtMilliseconds: number,
  hardExpiresAtMilliseconds: number,
): Result.Result<number, SealedAttemptLeasePromotionIssueV1> {
  if (
    !isPositiveSafeInteger(authorizationGrantExpiresAtMilliseconds) ||
    !isPositiveSafeInteger(hardExpiresAtMilliseconds) ||
    hardExpiresAtMilliseconds > authorizationGrantExpiresAtMilliseconds
  ) {
    return Result.fail(Object.freeze({ kind: "authorityExpiryInvalid" }));
  }
  return Result.succeed(Math.min(
    authorizationGrantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
  ));
}

export function projectSealedAttemptLeasePromotionV1Result(input: {
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly databaseNowMilliseconds: number;
  readonly currentLeaseExpiresAtMilliseconds: number;
  readonly maximumLiveSnapshotRetentionMilliseconds: number;
}): Result.Result<
  Readonly<SealedAttemptLeasePromotionV1>,
  SealedAttemptLeasePromotionIssueV1
> {
  return Result.gen(function* () {
    const targetLeaseExpiresAtMilliseconds = yield*
      deriveSealedAttemptLeaseTargetV1Result(
        input.authorizationGrantExpiresAtMilliseconds,
        input.hardExpiresAtMilliseconds,
      );

    if (!isNonNegativeSafeInteger(input.databaseNowMilliseconds)) {
      return yield* Result.fail(Object.freeze({
        kind: "databaseClockInvalid" as const,
      }));
    }
    if (!isPositiveSafeInteger(
      input.maximumLiveSnapshotRetentionMilliseconds,
    )) {
      return yield* Result.fail(Object.freeze({
        kind: "retentionBudgetInvalid" as const,
      }));
    }
    if (!isPositiveSafeInteger(input.currentLeaseExpiresAtMilliseconds)) {
      return yield* Result.fail(Object.freeze({
        kind: "currentLeaseInvalid" as const,
      }));
    }

    if (targetLeaseExpiresAtMilliseconds <= input.databaseNowMilliseconds) {
      return yield* Result.fail(Object.freeze({
        kind: "authorityExpired" as const,
        targetLeaseExpiresAtMilliseconds,
        databaseNowMilliseconds: input.databaseNowMilliseconds,
      }));
    }
    const remainingMilliseconds =
      targetLeaseExpiresAtMilliseconds - input.databaseNowMilliseconds;
    if (
      !isPositiveSafeInteger(remainingMilliseconds) ||
      remainingMilliseconds > input.maximumLiveSnapshotRetentionMilliseconds
    ) {
      return yield* Result.fail(Object.freeze({
        kind: "retentionBudgetExceeded" as const,
        remainingMilliseconds,
        maximumLiveSnapshotRetentionMilliseconds:
          input.maximumLiveSnapshotRetentionMilliseconds,
      }));
    }
    if (
      input.currentLeaseExpiresAtMilliseconds <= input.databaseNowMilliseconds
    ) {
      return yield* Result.fail(Object.freeze({
        kind: "currentLeaseExpired" as const,
        currentLeaseExpiresAtMilliseconds:
          input.currentLeaseExpiresAtMilliseconds,
        databaseNowMilliseconds: input.databaseNowMilliseconds,
      }));
    }
    if (
      input.currentLeaseExpiresAtMilliseconds >
        targetLeaseExpiresAtMilliseconds
    ) {
      return yield* Result.fail(Object.freeze({
        kind: "currentLeaseAfterTarget" as const,
        currentLeaseExpiresAtMilliseconds:
          input.currentLeaseExpiresAtMilliseconds,
        targetLeaseExpiresAtMilliseconds,
      }));
    }

    return Object.freeze({
      targetLeaseExpiresAtMilliseconds,
      remainingMilliseconds,
    });
  });
}
