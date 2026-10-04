import { Effect, Result, Schema } from "effect";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { CommitSeqSchema, projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";
import { captureFiniteMetadataReservation, FiniteMetadataReservationSchema,
  getCapturedFiniteMetadataReservationSha256Hex, readCapturedFiniteMetadataReservation,
  readStoredFiniteMetadataReservation, requireCapturedFiniteMetadataReservationRow } from "../src/finiteMetadataReservation";
import type { fxSystemSnapshotLeases } from "../src/schema";

const encoded = {
  format: "flarex.finite-metadata-reservation", version: 1,
  deploymentId: "finite-reservation-test", scopeId: "scope_00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002", attemptFence: "1",
  storageGeneration: "flarexdb_v1", storageGenerationFence: "1",
  snapshotToken: { scopeId: "scope_00000000-0000-4000-8000-000000000001",
    epoch: "epoch_00000000-0000-4000-8000-000000000003", commitSeq: "7" },
  schemaVersionId: "finite_schema", metadataWatermark: "11",
  application: { revisionId: "finite_revision", activationSequence: "3", headSha256: "a".repeat(64),
    activationSha256: "b".repeat(64), schemaVersionId: "finite_schema", manifestSha256: "c".repeat(64) },
  binding: { sequence: "2", sha256: "d".repeat(64), candidateSha256: "e".repeat(64), activationSha256: "f".repeat(64) },
} as const;

async function fixture(root?: Readonly<{ scopeId: string; sessionId: string }>) {
  const actualEncoded = root === undefined ? encoded : { ...encoded, ...root,
    snapshotToken: { ...encoded.snapshotToken, scopeId: root.scopeId } };
  const value = Schema.decodeUnknownSync(FiniteMetadataReservationSchema)(actualEncoded);
  const capture = await Effect.runPromise(captureFiniteMetadataReservation(value));
  const canonicalBytes = new TextEncoder().encode(encodeCanonicalJson(actualEncoded, () => { throw new Error("Invalid fixture"); }));
  const sha256 = new Uint8Array(await crypto.subtle.digest("SHA-256", canonicalBytes));
  const scope = Result.getOrThrow(projectScopeIdUuidV1Result(value.scopeId));
  const epoch = Result.getOrThrow(projectScopeEpochUuidV1Result(value.snapshotToken.epoch));
  const row: typeof fxSystemSnapshotLeases.$inferSelect = {
    scopeUuid: scope.scopeUuid, sessionId: value.sessionId, attemptFence: value.attemptFence,
    snapshotEpochUuid: epoch.epochUuid, snapshotCommitSeq: value.snapshotToken.commitSeq,
    metadataWatermark: value.metadataWatermark, finiteMetadataReservationBytes: canonicalBytes,
    finiteMetadataReservationSha256: sha256, leaseExpiresAt: new Date("2026-10-03T01:00:00Z"),
  };
  return { value, capture, row };
}

describe("finite metadata reservation", () => {
  it("authenticates the stored exact entry tuple and preserves its original watermark", async () => {
    const { value, capture, row } = await fixture();
    expect(await Effect.runPromise(readStoredFiniteMetadataReservation(row))).toEqual(value);
    expect(Result.isSuccess(requireCapturedFiniteMetadataReservationRow(capture, row))).toBe(true);
    expect(getCapturedFiniteMetadataReservationSha256Hex(capture)).toHaveLength(64);
    const retained = readCapturedFiniteMetadataReservation(capture)!;
    expect(Object.isFrozen(retained.application)).toBe(true);
    expect(Object.isFrozen(retained.snapshotToken)).toBe(true);
  });

  it("refuses copied tokens, substituted watermarks and mismatched root evidence", async () => {
    const { capture, row } = await fixture();
    expect(Result.isFailure(requireCapturedFiniteMetadataReservationRow({ ...capture }, row))).toBe(true);
    expect(Result.isFailure(requireCapturedFiniteMetadataReservationRow(capture, { ...row, metadataWatermark: null }))).toBe(true);
    await expect(Effect.runPromise(readStoredFiniteMetadataReservation({ ...row, snapshotCommitSeq: Schema.decodeUnknownSync(CommitSeqSchema)("8") })))
      .rejects.toMatchObject({ reason: "storedCorruption" });
    await expect(Effect.runPromise(readStoredFiniteMetadataReservation({ ...row, finiteMetadataReservationBytes:
      new TextEncoder().encode(JSON.stringify({ ...encoded, unexpected: true })) })))
      .rejects.toMatchObject({ reason: "storedCorruption" });
  });

  it("rejects active predecessor leases without inventing a historical watermark", async () => {
    const { row } = await fixture();
    await expect(Effect.runPromise(readStoredFiniteMetadataReservation({ ...row, metadataWatermark: null,
      finiteMetadataReservationBytes: null, finiteMetadataReservationSha256: null })))
      .rejects.toMatchObject({ reason: "storedCorruption" });
  });

  it("refuses another genuine root's reservation in either direction", async () => {
    const first = await fixture();
    const second = await fixture({ scopeId: "scope_00000000-0000-4000-8000-000000000004",
      sessionId: "00000000-0000-4000-8000-000000000005" });
    expect(Result.isSuccess(requireCapturedFiniteMetadataReservationRow(first.capture, first.row))).toBe(true);
    expect(Result.isSuccess(requireCapturedFiniteMetadataReservationRow(second.capture, second.row))).toBe(true);
    expect(Result.match(requireCapturedFiniteMetadataReservationRow(first.capture, second.row), {
      onSuccess: () => "accepted", onFailure: error => error.reason,
    })).toBe("reservationMismatch");
    expect(Result.match(requireCapturedFiniteMetadataReservationRow(second.capture, first.row), {
      onSuccess: () => "accepted", onFailure: error => error.reason,
    })).toBe("reservationMismatch");
  });
});
