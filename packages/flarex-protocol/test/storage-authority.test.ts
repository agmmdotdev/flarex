import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  SnapshotTokenSchema,
  StorageGenerationSchema,
} from "../src/storage-authority";
import type {
  CommitSeq,
  FlarexDbV1StorageGeneration,
  LegacyV1StorageGeneration,
  OutboxSeq,
  ScopeEpoch,
  ScopeId,
  SnapshotToken,
  StorageGeneration,
} from "../src/storage-authority";

const decodeScopeId = Schema.decodeUnknownSync(ScopeIdSchema);
const decodeScopeEpoch = Schema.decodeUnknownSync(ScopeEpochSchema);
const decodeCommitSeq = Schema.decodeUnknownSync(CommitSeqSchema);
const encodeCommitSeq = Schema.encodeSync(CommitSeqSchema);
const decodeOutboxSeq = Schema.decodeUnknownSync(OutboxSeqSchema);
const encodeOutboxSeq = Schema.encodeSync(OutboxSeqSchema);
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

  it("round-trips canonical counters without number precision loss", () => {
    for (const value of ["0", "1", "9007199254740993"]) {
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

  it("accepts only named storage generations", () => {
    expect(decodeStorageGeneration("legacy_v1")).toBe("legacy_v1");
    expect(decodeStorageGeneration("flarexdb_v1")).toBe("flarexdb_v1");
    expect(decodeLegacyV1StorageGeneration("legacy_v1")).toBe("legacy_v1");
    expect(decodeFlarexDbV1StorageGeneration("flarexdb_v1"))
      .toBe("flarexdb_v1");
    expect(() => decodeLegacyV1StorageGeneration("flarexdb_v1")).toThrow();
    expect(() => decodeFlarexDbV1StorageGeneration("legacy_v1")).toThrow();

    for (const value of ["legacy", "postgres", "flarexdb", undefined]) {
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
