import { Result, Schema } from "effect";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { TransactionAuthorizationRevocationEpochSchema } from "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import { decodeLegacyApplicationRevisionRegistrationClockResult } from "../../../src/application/revision/legacyApplicationRevisionRegistrationClock";
import { ScopeClockCorruptionError } from "../../../src/scope/scopeClockErrors";

const historicalClock = Object.freeze({
  scopeId: ScopeIdSchema.make("retained_registration_scope"),
  scopeUuid: null,
  storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
  storageGenerationFence: StorageGenerationFenceSchema.make(1n),
  lastCommitSeq: CommitSeqSchema.make(7n),
  oldestAvailableCommitSeq: CommitSeqSchema.make(2n),
  authorizationRevocationEpoch: TransactionAuthorizationRevocationEpochSchema.make(0n),
  epoch: ScopeEpochSchema.make("retained_registration_epoch"),
  epochUuid: null,
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
});

describe("retained registration inline clock contract", () => {
  it("accepts historical non-UUID authority and owns a finite timestamp snapshot", () => {
    const row = { ...historicalClock, updatedAt: new Date(historicalClock.updatedAt.getTime()) };
    const clock = Result.getOrThrow(decodeLegacyApplicationRevisionRegistrationClockResult(row, row.scopeId));

    expect(clock.scopeId).toBe(row.scopeId);
    expect(clock.epoch).toBe(row.epoch);
    expect(clock.scopeUuid).toBeNull();
    expect(clock.epochUuid).toBeNull();
    expect(clock).not.toHaveProperty("lastMetadataSequence");
    expect(clock.updatedAt).toEqual(row.updatedAt);
    expect(clock.updatedAt).not.toBe(row.updatedAt);
    row.updatedAt.setTime(0);
    expect(clock.updatedAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("refuses malformed durable clock state with its corruption owner and schema cause", () => {
    const invalidRows = [
      ["malformed commit sequence", { lastCommitSeq: "7" }],
      ["negative commit sequence", { lastCommitSeq: -1n }],
      ["overflow commit sequence", { lastCommitSeq: MAX_PERSISTED_SIGNED_INT64_V1 + 1n }],
      ["malformed fence", { storageGenerationFence: "1" }],
      ["nonpositive fence", { storageGenerationFence: 0n }],
      ["overflow fence", { storageGenerationFence: MAX_PERSISTED_SIGNED_INT64_V1 + 1n }],
      ["negative retained floor", { oldestAvailableCommitSeq: -1n }],
      ["floor above committed sequence", { oldestAvailableCommitSeq: 8n }],
      ["invalid timestamp", { updatedAt: new Date(Number.NaN) }],
      ["inconsistent generated scope identity", { scopeUuid: "00000000-0000-4000-8000-000000000001" }],
      ["inconsistent generated epoch identity", { epochUuid: "00000000-0000-4000-8000-000000000002" }],
    ] satisfies ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]>;

    for (const [label, corrupt] of invalidRows) {
      const clock = decodeLegacyApplicationRevisionRegistrationClockResult(
        { ...historicalClock, ...corrupt }, historicalClock.scopeId,
      );
      expect(Result.isFailure(clock), label).toBe(true);
      if (Result.isFailure(clock)) {
        expect(clock.failure, label).toBeInstanceOf(ScopeClockCorruptionError);
        expect(clock.failure.scopeId, label).toBe(historicalClock.scopeId);
        expect(Schema.isSchemaError(clock.failure.cause), label).toBe(true);
      }
    }
  });
});
