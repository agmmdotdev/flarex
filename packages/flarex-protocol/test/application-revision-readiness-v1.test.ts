import {
  decodeApplicationRevisionReadinessReceiptV1,
  encodeApplicationRevisionReadinessReceiptV1,
  type ApplicationRevisionReadinessReceiptFrameV1,
} from "flarex-protocol/internal/application-revision-readiness-v1";
import {
  encodeDeclarativeV2PhysicalFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

const budget = { maximumFrameBytes: 4_096, maximumCanonicalBytes: 4_096 };

describe("application revision readiness receipt v1", () => {
  it("pins a stable canonical vector and round trips defensively", () => {
    const frame = receipt();
    const encoded = Result.getOrThrow(
      encodeApplicationRevisionReadinessReceiptV1(frame),
    );
    expect(encoded.canonicalBytes.byteLength).toBe(1_311);
    expect(Array.from(encoded.canonicalBytes.slice(0, 64))).toEqual([
      102, 108, 97, 114, 101, 120, 46, 115, 121, 115, 116, 101, 109,
      47, 97, 112, 112, 108, 105, 99, 97, 116, 105, 111, 110, 45, 114,
      101, 118, 105, 115, 105, 111, 110, 45, 114, 101, 97, 100, 105,
      110, 101, 115, 115, 45, 114, 101, 99, 101, 105, 112, 116, 47,
      118, 49, 0, 0, 0, 0, 25, 0, 0, 0, 68,
    ]);
    const decoded = Result.getOrThrow(
      decodeApplicationRevisionReadinessReceiptV1(encoded.canonicalBytes),
    );
    expect(decoded.canonicalBytes).toEqual(encoded.canonicalBytes);
    expect(decoded.frame).toEqual(frame);
    expect(decoded.frame).not.toBe(frame);
    expect(decoded.frame.candidateSha256).not.toBe(frame.candidateSha256);
  });

  it("rejects changed fields, group order, malformed and trailing bytes", () => {
    const frame = receipt();
    for (const changed of [
      { ...frame, storageGenerationFence: 0n },
      { ...frame, candidateSha256: digest(99) },
      {
        ...frame,
        coldMaterializationReceipts:
          [...frame.coldMaterializationReceipts].reverse(),
      },
      { ...frame, readyAt: "2026-01-01" },
    ]) {
      expect(Result.isFailure(
        encodeApplicationRevisionReadinessReceiptV1(changed),
      )).toBe(true);
    }
    const encoded = Result.getOrThrow(
      encodeApplicationRevisionReadinessReceiptV1(frame),
    ).canonicalBytes;
    expect(Result.isFailure(
      decodeApplicationRevisionReadinessReceiptV1(encoded.slice(0, -1)),
    )).toBe(true);
    const trailing = new Uint8Array(encoded.byteLength + 1);
    trailing.set(encoded);
    expect(Result.isFailure(
      decodeApplicationRevisionReadinessReceiptV1(trailing),
    )).toBe(true);
    expect(Result.isFailure(
      decodeApplicationRevisionReadinessReceiptV1(new Uint8Array(16_385)),
    )).toBe(true);

    const coercionTrap = Object.freeze({
      [Symbol.toPrimitive]: () => {
        throw new Error("group coercion must not run");
      },
    });
    const maliciousGroup = {
      ...frame,
      coldMaterializationReceipts: [{
        ...frame.coldMaterializationReceipts[0],
        group: coercionTrap,
      }],
    };
    expect(() =>
      encodeApplicationRevisionReadinessReceiptV1(maliciousGroup)
    ).not.toThrow();
    expect(Result.isFailure(
      encodeApplicationRevisionReadinessReceiptV1(maliciousGroup),
    )).toBe(true);

    const reflectionTrap = new Proxy({}, {
      ownKeys: () => {
        throw new Error("reflection failure");
      },
    });
    expect(() =>
      encodeApplicationRevisionReadinessReceiptV1(reflectionTrap)
    ).not.toThrow();
    expect(Result.isFailure(
      encodeApplicationRevisionReadinessReceiptV1(reflectionTrap),
    )).toBe(true);
  });
});

function receipt(): ApplicationRevisionReadinessReceiptFrameV1 {
  const candidateSha256 = digest(1);
  const manifestSha256 = digest(15);
  const cold = (["transaction", "edge_action"] as const).map((group, index) => {
    const encoded = Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1({
      kind: "cold_materialization_receipt",
      candidateSha256,
      group,
      projectionSha256: digest(30 + index),
      functionGroupManifestSha256: manifestSha256,
      materializerIdentity: "worker-loader/test-v1",
      moduleCount: 1n,
      rawByteLength: 128n,
      compressedByteLength: 64n,
      startupMilliseconds: 5n,
    }, budget));
    return Object.freeze({
      codecIdentity:
        "flarex.declarative-v2/cold-materialization-receipt/v1" as const,
      group,
      sha256: digest(40 + index),
      canonicalBytes: encoded.canonicalBytes,
    });
  });
  return Object.freeze({
    kind: "application_revision_readiness_receipt",
    revisionId: `dv2_${"01".repeat(32)}`,
    scopeId: "scope_readiness_vector",
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 7n,
    scopeEpoch: "epoch_00000000-0000-0000-0000-000000000001",
    candidateSha256,
    attemptSha256: digest(2),
    registrationInputSha256: digest(3),
    verifierReceiptSha256: digest(4),
    verifierTerminalProofSha256: digest(5),
    schemaArtifactSha256: digest(6),
    schemaBindingSha256: digest(7),
    functionMetadataSha256: digest(8),
    validatorRootSha256: digest(9),
    declaredHandlerSetSha256: digest(10),
    registrationRootSha256: digest(11),
    schemaValidationReceiptSha256: digest(12),
    enabledBuildRootSha256: digest(13),
    runtimeProjectionSetSha256: digest(14),
    functionGroupManifestSha256: manifestSha256,
    runtimePublicationRootSha256: digest(16),
    coldMaterializationRootSha256: digest(17),
    coldMaterializationReceipts: Object.freeze(cold),
    readyAt: "2026-08-01T00:00:00.000Z",
  });
}

function digest(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (seed + index) & 0xff);
}
