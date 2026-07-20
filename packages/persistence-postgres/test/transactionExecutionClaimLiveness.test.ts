import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  projectExecutionClaimRenewalV1Result,
  type ProjectExecutionClaimRenewalInputV1,
} from "../src/transactionExecutionClaimLiveness";

const BASE = Object.freeze({
  databaseNowMilliseconds: 1_000,
  currentLeaseExpiresAtMilliseconds: 2_000,
  currentClaimExpiresAtMilliseconds: 1_500,
  authorizationGrantExpiresAtMilliseconds: 10_000,
  hardExpiresAtMilliseconds: 8_000,
  claimDurationMilliseconds: 2_000,
  leaseRenewalDurationMilliseconds: 3_000,
  maximumLiveSnapshotRetentionMilliseconds: 7_000,
  phase: "open",
}) satisfies ProjectExecutionClaimRenewalInputV1;

describe("O08-B2b2b2b1a execution-claim renewal policy", () => {
  it("jointly extends an open lease and claim without exceeding either cap", () => {
    expect(Result.getOrThrow(projectExecutionClaimRenewalV1Result(BASE)))
      .toEqual({
        targetLeaseExpiresAtMilliseconds: 4_000,
        targetClaimExpiresAtMilliseconds: 3_000,
      });
  });

  it("keeps the sealed lease immutable while extending only the claim", () => {
    expect(Result.getOrThrow(projectExecutionClaimRenewalV1Result({
      ...BASE,
      phase: "sealed",
      currentLeaseExpiresAtMilliseconds: 8_000,
    }))).toEqual({
      targetLeaseExpiresAtMilliseconds: 8_000,
      targetClaimExpiresAtMilliseconds: 3_000,
    });
  });

  it("never shortens already-longer live evidence", () => {
    expect(Result.getOrThrow(projectExecutionClaimRenewalV1Result({
      ...BASE,
      currentLeaseExpiresAtMilliseconds: 6_000,
      currentClaimExpiresAtMilliseconds: 5_000,
    }))).toEqual({
      targetLeaseExpiresAtMilliseconds: 6_000,
      targetClaimExpiresAtMilliseconds: 5_000,
    });
  });

  it("fails closed for expired authority, lease, and claim evidence", () => {
    expect(projectExecutionClaimRenewalV1Result({
      ...BASE,
      hardExpiresAtMilliseconds: 1_000,
    })).toEqual(Result.fail("authorityExpired"));
    expect(projectExecutionClaimRenewalV1Result({
      ...BASE,
      currentLeaseExpiresAtMilliseconds: 1_000,
    })).toEqual(Result.fail("leaseExpired"));
    expect(projectExecutionClaimRenewalV1Result({
      ...BASE,
      currentClaimExpiresAtMilliseconds: 1_000,
    })).toEqual(Result.fail("claimExpired"));
  });

  it("rejects claim and lease ordering corruption", () => {
    expect(projectExecutionClaimRenewalV1Result({
      ...BASE,
      currentLeaseExpiresAtMilliseconds: 1_500,
      currentClaimExpiresAtMilliseconds: 1_600,
    })).toEqual(Result.fail("claimAfterLease"));
    expect(projectExecutionClaimRenewalV1Result({
      ...BASE,
      currentLeaseExpiresAtMilliseconds: 8_001,
    })).toEqual(Result.fail("leaseAfterAuthorityTarget"));
    expect(projectExecutionClaimRenewalV1Result({
      ...BASE,
      phase: "sealed",
      currentLeaseExpiresAtMilliseconds: 7_999,
    })).toEqual(Result.fail("sealedLeaseMismatch"));
  });

  it("rejects unsafe arithmetic and retention-policy overrun", () => {
    expect(projectExecutionClaimRenewalV1Result({
      ...BASE,
      databaseNowMilliseconds: Number.MAX_SAFE_INTEGER - 1,
      currentLeaseExpiresAtMilliseconds: Number.MAX_SAFE_INTEGER,
      currentClaimExpiresAtMilliseconds: Number.MAX_SAFE_INTEGER,
      authorizationGrantExpiresAtMilliseconds: Number.MAX_SAFE_INTEGER,
      hardExpiresAtMilliseconds: Number.MAX_SAFE_INTEGER,
    })).toEqual(Result.fail("invalidEvidence"));
    expect(projectExecutionClaimRenewalV1Result({
      ...BASE,
      currentLeaseExpiresAtMilliseconds: 7_001,
      maximumLiveSnapshotRetentionMilliseconds: 6_000,
    })).toEqual(Result.fail("leaseRetentionBudgetExceeded"));
  });
});
