import { Result } from "effect";
import {
  ScopeIdSchema,
  ScopeUuidV1Schema,
} from "flarex-protocol/storage-authority";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import {
  TransactionExecutionClaimFenceV1Schema,
  TransactionExecutionClaimOwnerV1Schema,
} from "../src/transactionExecutionClaimModel";
import {
  inspectTransactionExecutionClaimV1Result,
  requireLiveTransactionExecutionClaimV1Result,
  TransactionExecutionClaimCorruptionV1Error,
  TransactionExecutionClaimStaleV1Error,
} from "../src/transactionExecutionClaimPersistence";

const SCOPE_ID = ScopeIdSchema.make("scope:execution-claim-result");
const CLAIM_OWNER = TransactionExecutionClaimOwnerV1Schema.make(
  "61000000-0000-4000-8000-000000000101",
);
const OTHER_CLAIM_OWNER = TransactionExecutionClaimOwnerV1Schema.make(
  "61000000-0000-4000-8000-000000000102",
);
const CLAIM_FENCE = TransactionExecutionClaimFenceV1Schema.make(2n);
const OTHER_CLAIM_FENCE = TransactionExecutionClaimFenceV1Schema.make(3n);
const DATABASE_NOW = new Date("2030-01-01T00:00:30.000Z");

const CLAIM_ROW = Object.freeze({
  scopeUuid: ScopeUuidV1Schema.make(
    "61000000-0000-0000-0000-000000000001",
  ),
  sessionId: TransactionSessionIdV1Schema.make(
    "61000000-0000-4000-8000-000000000002",
  ),
  attemptFence: TransactionAttemptFenceSchema.make(1n),
  claimFence: CLAIM_FENCE,
  claimOwner: CLAIM_OWNER,
  claimedAt: new Date("2030-01-01T00:00:00.000Z"),
  claimExpiresAt: new Date("2030-01-01T00:01:00.000Z"),
} satisfies Parameters<typeof inspectTransactionExecutionClaimV1Result>[1]);

describe("transaction execution-claim Result validation", () => {
  it("materializes and accepts one live exact claim", () => {
    const observation = Result.getOrThrow(
      inspectTransactionExecutionClaimV1Result(SCOPE_ID, CLAIM_ROW),
    );
    expect(observation).toEqual({
      claimOwner: CLAIM_OWNER,
      claimFence: CLAIM_FENCE,
      claimedAt: "2030-01-01T00:00:00.000Z",
      claimExpiresAt: "2030-01-01T00:01:00.000Z",
    });
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Result.getOrThrow(requireLiveTransactionExecutionClaimV1Result(
      SCOPE_ID,
      CLAIM_ROW,
      Object.freeze({ claimOwner: CLAIM_OWNER, claimFence: CLAIM_FENCE }),
      DATABASE_NOW,
    ))).toEqual(observation);
  });

  it("preserves evidence, owner, fence, and expiry failure precedence", () => {
    const invalidEvidence = requireLiveTransactionExecutionClaimV1Result(
      SCOPE_ID,
      Object.freeze({ ...CLAIM_ROW, claimedAt: new Date(Number.NaN) }),
      Object.freeze({
        claimOwner: OTHER_CLAIM_OWNER,
        claimFence: OTHER_CLAIM_FENCE,
      }),
      new Date("2030-01-01T00:02:00.000Z"),
    );
    expectFailure(invalidEvidence, TransactionExecutionClaimCorruptionV1Error, {
      reason: "claimEvidenceInvalid",
    });

    const ownerMismatch = requireLiveTransactionExecutionClaimV1Result(
      SCOPE_ID,
      CLAIM_ROW,
      Object.freeze({
        claimOwner: OTHER_CLAIM_OWNER,
        claimFence: OTHER_CLAIM_FENCE,
      }),
      new Date("2030-01-01T00:02:00.000Z"),
    );
    expectFailure(ownerMismatch, TransactionExecutionClaimStaleV1Error, {
      reason: "claimOwnerMismatch",
    });

    const fenceMismatch = requireLiveTransactionExecutionClaimV1Result(
      SCOPE_ID,
      CLAIM_ROW,
      Object.freeze({
        claimOwner: CLAIM_OWNER,
        claimFence: OTHER_CLAIM_FENCE,
      }),
      new Date("2030-01-01T00:02:00.000Z"),
    );
    expectFailure(fenceMismatch, TransactionExecutionClaimStaleV1Error, {
      reason: "claimFenceMismatch",
    });

    const expired = requireLiveTransactionExecutionClaimV1Result(
      SCOPE_ID,
      CLAIM_ROW,
      Object.freeze({ claimOwner: CLAIM_OWNER, claimFence: CLAIM_FENCE }),
      new Date("2030-01-01T00:02:00.000Z"),
    );
    expectFailure(expired, TransactionExecutionClaimStaleV1Error, {
      reason: "claimExpired",
    });
  });

  it("leaves unexpected row-accessor failures as defects", () => {
    const defect = new Error("claim row accessor defect");
    const row = new Proxy(CLAIM_ROW, {
      get(target, property, receiver) {
        if (property === "claimFence") throw defect;
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() => inspectTransactionExecutionClaimV1Result(SCOPE_ID, row))
      .toThrow(defect);
  });
});

function expectFailure<E>(
  result: Result.Result<unknown, E>,
  errorClass:
    | typeof TransactionExecutionClaimCorruptionV1Error
    | typeof TransactionExecutionClaimStaleV1Error,
  shape: object,
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(errorClass);
    expect(result.failure).toMatchObject(shape);
  }
}
