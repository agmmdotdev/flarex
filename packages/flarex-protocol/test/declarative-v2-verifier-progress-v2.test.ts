import { webcrypto } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
} from "../src/declarative-v2-physical-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
  DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
  decodeDeclarativeV2VerifierProgressFrameV2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  requireDeclarativeV2VerifierProtocolIdentitiesV2,
} from "../src/declarative-v2-verifier-progress-v2";

const budget = Object.freeze({
  maximumFrameBytes: 10_000,
  maximumCanonicalBytes: 0,
});

describe("Declarative V2 verifier Budget/Progress V2", () => {
  it("pins the 26-dimension budget frame with an independent oracle", async () => {
    const values = Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
        (dimension, index) => [dimension, BigInt(index + 1)],
      ),
    );
    const frame = { kind: "attempt_ceilings", ...values };
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(frame, budget),
    );
    const expected = concat(
      utf8("flarex.declarative-v2/attempt_ceilings/v2\0"),
      u32(26),
      ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
        (dimension) => u64(values[dimension]!),
      ),
    );
    expect(encoded.canonicalBytes).toEqual(expected);
    expect(hex(await sha256(expected))).toBe(
      "a2cad26e067b7c7df1175ba16aef3f5c58b03799f4766629ac976db4ad0b2898",
    );
    expect(Result.getOrThrow(
      decodeDeclarativeV2VerifierProgressFrameV2(expected, {
        maximumFrameBytes: expected.byteLength,
        maximumCanonicalBytes: 0,
      }),
    ).frame).toEqual(frame);
    expect(Result.isFailure(
      encodeDeclarativeV2VerifierProgressFrameV2(frame, {
        maximumFrameBytes: expected.byteLength - 1,
        maximumCanonicalBytes: 0,
      }),
    )).toBe(true);
  });

  it("round-trips owned attempt and progress evidence at signed-int64 maximum", () => {
    const candidate = digest(1);
    const ceilings = digest(2);
    const attempt = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "attempt_identity",
        candidateSha256: candidate,
        progressProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
        budgetProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
        ceilingsSha256: ceilings,
      }, budget),
    );
    candidate[0] = 99;
    ceilings[0] = 99;
    expect(attempt.frame.kind).toBe("attempt_identity");
    if (attempt.frame.kind !== "attempt_identity") {
      throw new Error("Expected attempt identity.");
    }
    expect(attempt.frame.candidateSha256[0]).toBe(1);
    expect(attempt.frame.ceilingsSha256[0]).toBe(2);

    const receipt = digest(3);
    const cursor = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "progress_cursor",
        phase: "verdict",
        settledSequence: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
        moduleOrdinal: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
        edgeOrdinal: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
        pageOrdinal: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
        previousReceiptSha256: receipt,
      }, budget),
    );
    receipt[0] = 44;
    const decoded = Result.getOrThrow(
      decodeDeclarativeV2VerifierProgressFrameV2(
        cursor.canonicalBytes,
        budget,
      ),
    );
    expect(decoded.frame).toEqual(cursor.frame);
    expect(decoded.canonicalBytes).not.toBe(cursor.canonicalBytes);
    expect(Result.isFailure(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "progress_cursor",
        phase: "verdict",
        settledSequence: DECLARATIVE_V2_MAX_SIGNED_INT64_V1 + 1n,
        moduleOrdinal: 0n,
        edgeOrdinal: 0n,
        pageOrdinal: 0n,
        previousReceiptSha256: null,
      }, budget),
    )).toBe(true);
  });

  it("fails pre-V2 identities and malformed or noncanonical bytes closed", () => {
    expect(Result.isFailure(
      requireDeclarativeV2VerifierProtocolIdentitiesV2({
        budgetProtocolIdentity: "flarex.declarative-v2/verifier-budget/v1",
        progressProtocolIdentity:
          "flarex.declarative-v2/verifier-progress-page-evidence/v1",
      }),
    )).toBe(true);
    expect(Result.isSuccess(
      requireDeclarativeV2VerifierProtocolIdentitiesV2({
        budgetProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
        progressProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
      }),
    )).toBe(true);
    const valid = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "progress_cursor",
        phase: "source",
        settledSequence: 0n,
        moduleOrdinal: 0n,
        edgeOrdinal: 0n,
        pageOrdinal: 0n,
        previousReceiptSha256: null,
      }, budget),
    ).canonicalBytes;
    for (let boundary = 0; boundary < valid.byteLength; boundary += 1) {
      expect(Result.isFailure(
        decodeDeclarativeV2VerifierProgressFrameV2(
          valid.subarray(0, boundary),
          budget,
        ),
      )).toBe(true);
    }
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(
        concat(valid, new Uint8Array([0])),
        budget,
      ),
    )).toBe(true);
    const v1 = new Uint8Array(valid);
    const version = utf8("/v2\0");
    const at = findBytes(v1, version);
    v1[at + 2] = 0x31;
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(v1, budget),
    )).toBe(true);

    const attemptBytes = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "attempt_identity",
        candidateSha256: digest(8),
        progressProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
        budgetProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
        ceilingsSha256: digest(9),
      }, budget),
    ).canonicalBytes;
    for (const malformed of [
      attemptBytes.subarray(0, attemptBytes.byteLength - 1),
      concat(attemptBytes, new Uint8Array([0])),
    ]) {
      const decoded = decodeDeclarativeV2VerifierProgressFrameV2(
        malformed,
        budget,
      );
      expect(Result.isFailure(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        expect(decoded.failure.reason).toBe("malformed");
      }
    }

    const detached = new Uint8Array(valid);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(detached, budget),
    )).toBe(true);

    const withSymbol = {
      budgetProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
      progressProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
      [Symbol("extra")]: true,
    };
    expect(Result.isFailure(
      requireDeclarativeV2VerifierProtocolIdentitiesV2(withSymbol),
    )).toBe(true);

    const nonEnumerable = {
      budgetProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
      progressProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
    };
    Object.defineProperty(nonEnumerable, "hidden", { value: true });
    expect(Result.isFailure(
      requireDeclarativeV2VerifierProtocolIdentitiesV2(nonEnumerable),
    )).toBe(true);

    let getterReads = 0;
    const accessor = {
      get budgetProtocolIdentity() {
        getterReads += 1;
        throw new Error("must not be invoked");
      },
      progressProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
    };
    expect(Result.isFailure(
      requireDeclarativeV2VerifierProtocolIdentitiesV2(accessor),
    )).toBe(true);
    expect(getterReads).toBe(0);
  });

  it("keeps the package root unchanged and exposes only the intentional subpath", async () => {
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const root = await import("../src/index");
    expect(packageJson.default.exports).toHaveProperty(
      "./internal/declarative-v2-verifier-progress-v2",
      "./src/declarative-v2-verifier-progress-v2.ts",
    );
    expect(root).not.toHaveProperty(
      "encodeDeclarativeV2VerifierProgressFrameV2",
    );
  });
});

function digest(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    if (
      needle.every((value, offset) => haystack[index + offset] === value)
    ) return index;
  }
  throw new Error("Needle not found.");
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await webcrypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
