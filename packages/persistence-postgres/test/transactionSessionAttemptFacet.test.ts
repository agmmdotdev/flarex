import { describe, expect, it } from "vitest";
import { Result } from "effect";

import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
} from "flarex-protocol/storage-authority";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";

import {
  buildFreshTransactionAttemptFacetV1,
  type FreshTransactionAttemptFacetInputV1,
} from "../src/transactionSessionAttemptFacet";

const VALID_INPUT = Object.freeze({
  scopeUuid: ScopeUuidV1Schema.make(
    "89000000-0000-0000-0000-000000000001",
  ),
  sessionId: TransactionSessionIdV1Schema.make(
    "89000000-0000-4000-8000-000000000002",
  ),
  attemptFence: TransactionAttemptFenceSchema.make(2n),
  snapshotEpochUuid: ScopeEpochUuidV1Schema.make(
    "89000000-0000-0000-0000-000000000003",
  ),
  snapshotCommitSeq: CommitSeqSchema.make(11n),
  databaseNowMilliseconds: 1_725_000_000_000,
  authorizationGrantExpiresAtMilliseconds: 1_725_000_120_000,
  hardExpiresAtMilliseconds: 1_725_000_180_000,
  leaseDurationMilliseconds: 60_000,
} satisfies FreshTransactionAttemptFacetInputV1);

describe("fresh transaction-attempt facet", () => {
  it("constructs the pristine facet from validated database time", () => {
    const facet = Result.getOrThrow(
      buildFreshTransactionAttemptFacetV1(VALID_INPUT),
    );

    expect(facet.sessionUpdatedAt.getTime()).toBe(
      VALID_INPUT.databaseNowMilliseconds,
    );
    expect(facet.leaseExpiresAt.getTime()).toBe(
      VALID_INPUT.databaseNowMilliseconds + VALID_INPUT.leaseDurationMilliseconds,
    );
    expect(facet.journalRoot.creationTimeSeed).toBe(
      VALID_INPUT.databaseNowMilliseconds,
    );
    expect(facet.journalRoot.nextCreationTime).toBe(
      VALID_INPUT.databaseNowMilliseconds,
    );
    expect(facet.journalRoot.state).toBe("open");
  });

  it.each([
    [
      "databaseTimeInvalid",
      { databaseNowMilliseconds: 0 },
    ],
    [
      "leaseDurationInvalid",
      { leaseDurationMilliseconds: 0 },
    ],
    [
      "authorityExpired",
      {
        authorizationGrantExpiresAtMilliseconds:
          VALID_INPUT.databaseNowMilliseconds,
      },
    ],
  ] as const)("returns %s through Result", (expected, override) => {
    const result = buildFreshTransactionAttemptFacetV1({
      ...VALID_INPUT,
      ...override,
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(expected);
  });

  it("does not reclassify caller accessor defects as invalid time", () => {
    const defect = new Error("database time accessor defect");
    const input = { ...VALID_INPUT };
    Object.defineProperty(input, "databaseNowMilliseconds", {
      enumerable: true,
      get: () => {
        throw defect;
      },
    });

    expect(() => buildFreshTransactionAttemptFacetV1(input)).toThrow(defect);
  });
});
