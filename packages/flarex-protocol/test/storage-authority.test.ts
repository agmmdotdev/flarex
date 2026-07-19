import { Result, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  OutboxSeqSchema,
  InvalidScopeAuthorityUuidProjectionV1Error,
  ScopeEpochSchema,
  ScopeIdSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  StorageGenerationSchema,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  projectScopeIdUuidV1Result,
  replacementScopeEpochV1FromUuid,
  replacementScopeIdV1FromUuid,
} from "../src/storage-authority";
import type {
  CommitSeq,
  FlarexDbV1StorageGeneration,
  LegacyV1StorageGeneration,
  OutboxSeq,
  ScopeEpoch,
  ScopeId,
  SnapshotToken,
  StorageGenerationFence,
  StorageGeneration,
} from "../src/storage-authority";

const decodeScopeId = Schema.decodeUnknownSync(ScopeIdSchema);
const decodeScopeEpoch = Schema.decodeUnknownSync(ScopeEpochSchema);
const decodeCommitSeq = Schema.decodeUnknownSync(CommitSeqSchema);
const encodeCommitSeq = Schema.encodeSync(CommitSeqSchema);
const decodeOutboxSeq = Schema.decodeUnknownSync(OutboxSeqSchema);
const encodeOutboxSeq = Schema.encodeSync(OutboxSeqSchema);
const decodeStorageGenerationFence = Schema.decodeUnknownSync(
  StorageGenerationFenceSchema,
);
const encodeStorageGenerationFence = Schema.encodeSync(
  StorageGenerationFenceSchema,
);
const decodeStorageGeneration = Schema.decodeUnknownSync(StorageGenerationSchema);
const decodeLegacyV1StorageGeneration = Schema.decodeUnknownSync(
  LegacyV1StorageGenerationSchema,
);
const decodeFlarexDbV1StorageGeneration = Schema.decodeUnknownSync(
  FlarexDbV1StorageGenerationSchema,
);
const decodeSnapshotToken = Schema.decodeUnknownSync(SnapshotTokenSchema);
const encodeSnapshotToken = Schema.encodeSync(SnapshotTokenSchema);

describe("FlarexDB storage authority contracts", () => {
  it("keeps identity, counter, generation, and snapshot types nominal", () => {
    expectTypeOf<ScopeId>().toMatchTypeOf<string>();
    expectTypeOf<string>().not.toMatchTypeOf<ScopeId>();
    expectTypeOf<ScopeId>().not.toEqualTypeOf<ScopeEpoch>();

    expectTypeOf<CommitSeq>().toMatchTypeOf<bigint>();
    expectTypeOf<bigint>().not.toMatchTypeOf<CommitSeq>();
    expectTypeOf<CommitSeq>().not.toEqualTypeOf<OutboxSeq>();
    expectTypeOf<StorageGenerationFence>().toMatchTypeOf<bigint>();
    expectTypeOf<bigint>().not.toMatchTypeOf<StorageGenerationFence>();
    expectTypeOf<StorageGenerationFence>().not.toEqualTypeOf<CommitSeq>();

    expectTypeOf<StorageGeneration>()
      .toMatchTypeOf<"legacy_v1" | "flarexdb_v1">();
    expectTypeOf<"legacy_v1" | "flarexdb_v1">()
      .not.toMatchTypeOf<StorageGeneration>();
    expectTypeOf<LegacyV1StorageGeneration>()
      .toMatchTypeOf<StorageGeneration>();
    expectTypeOf<FlarexDbV1StorageGeneration>()
      .toMatchTypeOf<StorageGeneration>();
    expectTypeOf<StorageGeneration>()
      .not.toMatchTypeOf<LegacyV1StorageGeneration>();

    expectTypeOf<SnapshotToken>().toMatchTypeOf<{
      readonly scopeId: ScopeId;
      readonly epoch: ScopeEpoch;
      readonly commitSeq: CommitSeq;
    }>();
    expectTypeOf<{
      readonly scopeId: ScopeId;
      readonly epoch: ScopeEpoch;
      readonly commitSeq: CommitSeq;
    }>().not.toMatchTypeOf<SnapshotToken>();
  });

  it("decodes non-empty scope identities", () => {
    expect(decodeScopeId("scope-a")).toBe("scope-a");
    expect(decodeScopeEpoch("epoch-a")).toBe("epoch-a");

    for (const value of ["", 1, null, undefined]) {
      expect(() => decodeScopeId(value)).toThrow();
      expect(() => decodeScopeEpoch(value)).toThrow();
    }
  });

  it("derives native UUID projections without tightening legacy identities", () => {
    const scopeUuid = "018f22e2-58cc-7b2a-91d8-f3f3401a0874";
    const epochUuid = "00000000-0000-0000-0000-000000000000";
    const scope = projectScopeIdUuidV1(`scope_${scopeUuid}`);
    const scopeResult = projectScopeIdUuidV1Result(`scope_${scopeUuid}`);
    const epoch = projectScopeEpochUuidV1(`epoch_${epochUuid}`);

    expect(scope).toEqual({ scopeId: `scope_${scopeUuid}`, scopeUuid });
    expect(Result.isSuccess(scopeResult)).toBe(true);
    if (Result.isSuccess(scopeResult)) {
      expect(scopeResult.success).toEqual(scope);
    }
    expect(epoch).toEqual({ epoch: `epoch_${epochUuid}`, epochUuid });
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(epoch)).toBe(true);
    expect(replacementScopeIdV1FromUuid(scopeUuid)).toBe(`scope_${scopeUuid}`);
    expect(replacementScopeEpochV1FromUuid(epochUuid)).toBe(
      `epoch_${epochUuid}`,
    );

    expect(decodeScopeId("scope-a")).toBe("scope-a");
    expect(decodeScopeEpoch("epoch-a")).toBe("epoch-a");
  });

  it("fails closed on unmappable or non-canonical native projections", () => {
    for (const value of [
      "scope-a",
      "scope_018F22E2-58CC-7B2A-91D8-F3F3401A0874",
      "018f22e2-58cc-7b2a-91d8-f3f3401a0874",
      "scope_018f22e258cc7b2a91d8f3f3401a0874",
      1,
      null,
    ]) {
      expect(() => projectScopeIdUuidV1(value)).toThrow(
        InvalidScopeAuthorityUuidProjectionV1Error,
      );
      const result = projectScopeIdUuidV1Result(value);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(
          InvalidScopeAuthorityUuidProjectionV1Error,
        );
      }
    }
  });

  it("round-trips canonical counters without number precision loss", () => {
    for (const value of [
      "0",
      "1",
      "9007199254740993",
      MAX_PERSISTED_SIGNED_INT64_V1.toString(),
    ]) {
      const commitSeq = decodeCommitSeq(value);
      const outboxSeq = decodeOutboxSeq(value);

      expect(commitSeq).toBe(BigInt(value));
      expect(outboxSeq).toBe(BigInt(value));
      expect(encodeCommitSeq(commitSeq)).toBe(value);
      expect(encodeOutboxSeq(outboxSeq)).toBe(value);
    }
  });

  it("rejects non-canonical or unsafe counter encodings", () => {
    for (const value of [
      1,
      -1,
      "-1",
      "-0",
      "+1",
      "01",
      "1.0",
      "1e3",
      " 1",
      "1 ",
      (MAX_PERSISTED_SIGNED_INT64_V1 + 1n).toString(),
    ]) {
      expect(() => decodeCommitSeq(value)).toThrow();
      expect(() => decodeOutboxSeq(value)).toThrow();
    }
  });

  it("rejects negative counters at the decoded type boundary", () => {
    expect(() => CommitSeqSchema.make(-1n)).toThrow();
    expect(() => OutboxSeqSchema.make(-1n)).toThrow();
    const uncheckedNegativeCommitSeq = CommitSeqSchema.make(-1n, {
      disableChecks: true,
    });
    expect(() => SnapshotTokenSchema.make({
      scopeId: ScopeIdSchema.make("scope-a"),
      epoch: ScopeEpochSchema.make("epoch-a"),
      commitSeq: uncheckedNegativeCommitSeq,
    })).toThrow();
  });

  it("round-trips only positive canonical storage-generation fences", () => {
    for (const value of [
      "1",
      "9007199254740993",
      MAX_PERSISTED_SIGNED_INT64_V1.toString(),
    ]) {
      const fence = decodeStorageGenerationFence(value);
      expect(fence).toBe(BigInt(value));
      expect(encodeStorageGenerationFence(fence)).toBe(value);
    }

    for (const value of [
      0,
      1,
      "0",
      "-1",
      "+1",
      "01",
      "1.0",
      " 1",
      (MAX_PERSISTED_SIGNED_INT64_V1 + 1n).toString(),
    ]) {
      expect(() => decodeStorageGenerationFence(value)).toThrow();
    }
    expect(() => StorageGenerationFenceSchema.make(0n)).toThrow();
  });

  it("accepts only named storage generations", () => {
    expect(decodeStorageGeneration("legacy_v1")).toBe("legacy_v1");
    expect(decodeStorageGeneration("flarexdb_v1")).toBe("flarexdb_v1");
    expect(decodeLegacyV1StorageGeneration("legacy_v1")).toBe("legacy_v1");
    expect(decodeFlarexDbV1StorageGeneration("flarexdb_v1"))
      .toBe("flarexdb_v1");
    expect(() => decodeLegacyV1StorageGeneration("flarexdb_v1")).toThrow();
    expect(() => decodeFlarexDbV1StorageGeneration("legacy_v1")).toThrow();

    for (const value of [
      "legacy",
      "postgres",
      "flarexdb",
      "future_v1",
      undefined,
    ]) {
      expect(() => decodeStorageGeneration(value)).toThrow();
    }
  });

  it("round-trips the strict snapshot token shape", () => {
    const token = decodeSnapshotToken({
      scopeId: "scope-a",
      epoch: "epoch-a",
      commitSeq: "9007199254740993",
    });

    expect(token).toEqual({
      scopeId: "scope-a",
      epoch: "epoch-a",
      commitSeq: 9007199254740993n,
    });
    expect(encodeSnapshotToken(token)).toEqual({
      scopeId: "scope-a",
      epoch: "epoch-a",
      commitSeq: "9007199254740993",
    });
  });

  it("rejects incomplete, malformed, or authority-expanded snapshot tokens", () => {
    for (const value of [
      { scopeId: "scope-a", epoch: "epoch-a" },
      { scopeId: "", epoch: "epoch-a", commitSeq: "0" },
      { scopeId: "scope-a", epoch: "", commitSeq: "0" },
      { scopeId: "scope-a", epoch: "epoch-a", commitSeq: 0 },
      { scopeId: "scope-a", epoch: "epoch-a", commitSeq: "-1" },
      {
        scopeId: "scope-a",
        epoch: "epoch-a",
        commitSeq: (MAX_PERSISTED_SIGNED_INT64_V1 + 1n).toString(),
      },
      {
        scopeId: "scope-a",
        epoch: "epoch-a",
        commitSeq: "0",
        generation: "legacy_v1",
      },
      {
        scopeId: "scope-a",
        epoch: "epoch-a",
        commitSeq: "0",
        fence: "1",
      },
    ]) {
      expect(() => decodeSnapshotToken(value)).toThrow();
    }
  });
});
