import { Result } from "effect";

export interface ProjectExecutionClaimRenewalInputV1 {
  readonly databaseNowMilliseconds: number;
  readonly currentLeaseExpiresAtMilliseconds: number;
  readonly currentClaimExpiresAtMilliseconds: number;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly claimDurationMilliseconds: number;
  readonly leaseRenewalDurationMilliseconds: number;
  readonly maximumLiveSnapshotRetentionMilliseconds: number;
  readonly phase: "open" | "sealed" | "relationConflicted" | "failed";
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
