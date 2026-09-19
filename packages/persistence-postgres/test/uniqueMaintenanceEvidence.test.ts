import { Result, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { UniqueMaintenanceFrameSchema, decodeUniqueMaintenanceEvidenceResult, hashUniqueMaintenanceEvidence,
  uniqueMaintenanceFrameBytes, verifyUniqueMaintenanceEvidence } from "../src/uniqueMaintenanceEvidence";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const frame = Schema.decodeUnknownSync(UniqueMaintenanceFrameSchema)({
  format: "flarex.unique-maintenance", version: 1, scopeId: "scope_30000000-0000-4000-8000-000000000001",
  storageGeneration: "flarexdb_v1", storageGenerationFence: "1", epoch: "epoch",
  uniqueConstraintDefinitionId: 1, tableId: 1, physicalSpecSha256Hex: "a".repeat(64),
  deploymentId: "deployment", schemaVersionId: "schema",
  startCommitSeq: "0", attemptFence: "1", openedCommitSeq: "4", activationSequence: "2", headSha256: "c".repeat(64),
});

describe("unique maintenance evidence", () => {
  it("owns canonical bytes and verifies their digest", async () => {
    const bytes = uniqueMaintenanceFrameBytes(frame);
    const hash = await runEffect(hashUniqueMaintenanceEvidence(bytes));
    const evidence = Result.getOrThrow(decodeUniqueMaintenanceEvidenceResult(2n, bytes, hash));
    if (evidence === null) throw new Error("Expected certificate");
    bytes.fill(0); hash.fill(0);
    expect(evidence.frame).toEqual(frame);
    await runEffect(verifyUniqueMaintenanceEvidence(evidence));
    expect(await runEffectFailure(verifyUniqueMaintenanceEvidence({ ...evidence, sha256: new Uint8Array(32) })))
      .toMatchObject({ reason: "storedState" });
    const unavailable = vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(new Error("Digest unavailable"));
    try { expect(await runEffectFailure(verifyUniqueMaintenanceEvidence(evidence))).toMatchObject({ reason: "resourceFailure", retryable: false }); }
    finally { unavailable.mockRestore(); }
  });

  it("rejects partial storage, sequence disagreement and malformed canonical frames", () => {
    const bytes = uniqueMaintenanceFrameBytes(frame);
    const hash = new Uint8Array(32);
    expect(Result.getOrThrow(decodeUniqueMaintenanceEvidenceResult(null, null, null))).toBeNull();
    for (const invalid of [[null, bytes, hash], [2n, null, hash], [2n, bytes, null], [3n, bytes, hash],
      [2n, new Uint8Array(), hash], [2n, new Uint8Array(16_385), hash], [2n, bytes, new Uint8Array(31)],
      [2n, new Uint8Array([0xff]), hash]] as const) {
      expect(Result.isFailure(decodeUniqueMaintenanceEvidenceResult(invalid[0], invalid[1], invalid[2]))).toBe(true);
    }
    for (const invalid of [{ ...frame, version: 2 }, { ...frame, startCommitSeq: "5" },
      { ...frame, attemptFence: "0" }, { ...frame, openedCommitSeq: "04" }, { ...frame, activationSequence: "9223372036854775808" },
      { ...frame, firstReadableCommitSeq: "0" }, { ...frame, tableId: 0 }, { ...frame, physicalSpecSha256Hex: "bad" }]) {
      expect(Result.isFailure(decodeUniqueMaintenanceEvidenceResult(2n, new TextEncoder().encode(JSON.stringify(invalid)), hash))).toBe(true);
    }
    expect(Result.isFailure(decodeUniqueMaintenanceEvidenceResult(2n,
      new TextEncoder().encode(JSON.stringify(frame, null, 2)), hash))).toBe(true);
  });
});
