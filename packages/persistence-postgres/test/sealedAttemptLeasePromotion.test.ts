import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  deriveSealedAttemptLeaseTargetV1Result,
  projectSealedAttemptLeasePromotionV1Result,
} from "../src/sealedAttemptLeasePromotion";

describe("sealed-attempt lease promotion", () => {
  it("derives the hard/grant minimum without widening authority", () => {
    expect(Result.getOrThrow(
      deriveSealedAttemptLeaseTargetV1Result(2_000, 1_500),
    )).toBe(1_500);
    expect(Result.getOrThrow(
      deriveSealedAttemptLeaseTargetV1Result(2_000, 2_000),
    )).toBe(2_000);
    expect(Result.isFailure(
      deriveSealedAttemptLeaseTargetV1Result(1_500, 2_000),
    )).toBe(true);
  });

  it("accepts the exact retention bound and rejects bound plus one", () => {
    const exact = projectSealedAttemptLeasePromotionV1Result({
      authorizationGrantExpiresAtMilliseconds: 2_000,
      hardExpiresAtMilliseconds: 2_000,
      databaseNowMilliseconds: 1_000,
      currentLeaseExpiresAtMilliseconds: 1_100,
      maximumLiveSnapshotRetentionMilliseconds: 1_000,
    });
    expect(Result.getOrThrow(exact)).toEqual({
      targetLeaseExpiresAtMilliseconds: 2_000,
      remainingMilliseconds: 1_000,
    });

    const over = projectSealedAttemptLeasePromotionV1Result({
      authorizationGrantExpiresAtMilliseconds: 2_001,
      hardExpiresAtMilliseconds: 2_001,
      databaseNowMilliseconds: 1_000,
      currentLeaseExpiresAtMilliseconds: 1_100,
      maximumLiveSnapshotRetentionMilliseconds: 1_000,
    });
    expect(Result.isFailure(over) && over.failure).toMatchObject({
      kind: "retentionBudgetExceeded",
      remainingMilliseconds: 1_001,
      maximumLiveSnapshotRetentionMilliseconds: 1_000,
    });
  });

  it("rejects expired authority and a current lease beyond the target", () => {
    const expired = projectSealedAttemptLeasePromotionV1Result({
      authorizationGrantExpiresAtMilliseconds: 1_000,
      hardExpiresAtMilliseconds: 1_000,
      databaseNowMilliseconds: 1_000,
      currentLeaseExpiresAtMilliseconds: 1_000,
      maximumLiveSnapshotRetentionMilliseconds: 1_000,
    });
    expect(Result.isFailure(expired) && expired.failure).toMatchObject({
      kind: "authorityExpired",
    });

    const beyond = projectSealedAttemptLeasePromotionV1Result({
      authorizationGrantExpiresAtMilliseconds: 2_000,
      hardExpiresAtMilliseconds: 1_900,
      databaseNowMilliseconds: 1_000,
      currentLeaseExpiresAtMilliseconds: 1_901,
      maximumLiveSnapshotRetentionMilliseconds: 1_000,
    });
    expect(Result.isFailure(beyond) && beyond.failure).toMatchObject({
      kind: "currentLeaseAfterTarget",
    });
  });

  it("classifies invalid clocks, retention policy, and current leases", () => {
    const validInput = {
      authorizationGrantExpiresAtMilliseconds: 2_000,
      hardExpiresAtMilliseconds: 2_000,
      databaseNowMilliseconds: 1_000,
      currentLeaseExpiresAtMilliseconds: 1_100,
      maximumLiveSnapshotRetentionMilliseconds: 1_000,
    } as const;
    const cases = [
      [
        { ...validInput, databaseNowMilliseconds: -1 },
        "databaseClockInvalid",
      ],
      [
        { ...validInput, maximumLiveSnapshotRetentionMilliseconds: 0 },
        "retentionBudgetInvalid",
      ],
      [
        { ...validInput, currentLeaseExpiresAtMilliseconds: 0 },
        "currentLeaseInvalid",
      ],
      [
        { ...validInput, currentLeaseExpiresAtMilliseconds: 999 },
        "currentLeaseExpired",
      ],
    ] as const;

    for (const [input, expectedKind] of cases) {
      const result = projectSealedAttemptLeasePromotionV1Result(input);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.kind).toBe(expectedKind);
      }
    }
  });
});
