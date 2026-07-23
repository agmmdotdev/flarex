import { webcrypto } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeDeclarativeV2PageEvidenceRootV1,
  encodeDeclarativeV2PageEvidenceRootV1,
} from "../src/declarative-v2-verification-evidence-v1";

const goldenHex =
  "666c617265782e6465636c617261746976652d76322f706167652d65766964656e63652d726f6f742f76310000000001000000000000000000000000000000000000000000000000000000000000000004000000000000000104020000000000000000000000000000000000000000000000010000000000";

describe("Declarative V2 verification evidence V1", () => {
  it("matches the accepted empty-registration golden vector", async () => {
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PageEvidenceRootV1({
        attemptSha256: digest(0),
        commandKind: "registration_page",
        sequence: 1n,
        phase: "registration",
        disposition: "completion",
        pageOrdinal: 0n,
        firstItemOrdinal: 0n,
        itemCount: 1n,
        previousPageSha256: null,
        evidence: [],
      }, { maximumFrameBytes: 120 }),
    );
    expect(hex(encoded.canonicalBytes)).toBe(goldenHex);
    expect(encoded.canonicalBytes.byteLength).toBe(120);
    const sha256 = new Uint8Array(await webcrypto.subtle.digest(
      "SHA-256",
      encoded.canonicalBytes.slice().buffer,
    ));
    expect(hex(sha256)).toBe(
      "1ad5b6eeb08312e69419326884c574d226cca06c4eb44e25272d4f05ca8e6b6d",
    );
    expect(
      Result.getOrThrow(
        decodeDeclarativeV2PageEvidenceRootV1(
          encoded.canonicalBytes,
          { maximumFrameBytes: 120 },
        ),
      ).frame,
    ).toEqual(encoded.frame);
  });

  it("owns inert references and ordered physical evidence", () => {
    const objectSha256 = digest(1);
    const frameSha256 = digest(2);
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PageEvidenceRootV1({
        attemptSha256: digest(3),
        commandKind: "source_page",
        sequence: 2n,
        phase: "source",
        disposition: "continuation",
        pageOrdinal: 1n,
        firstItemOrdinal: 2n,
        itemCount: 3n,
        previousPageSha256: digest(4),
        evidence: [
          {
            kind: "inert_object_reference",
            namespace: "source",
            objectKind: "block",
            firstItemOrdinal: 2n,
            itemCount: 3n,
            bodyByteLength: 9n,
            objectSha256,
          },
          {
            kind: "module_summary",
            moduleOrdinal: 0n,
            frameSha256,
          },
        ],
      }, { maximumFrameBytes: 1_000 }),
    );
    objectSha256[0] = 0xff;
    frameSha256[0] = 0xff;
    expect(encoded.frame.evidence[0]).toMatchObject({
      kind: "inert_object_reference",
      objectSha256: digest(1),
    });
    expect(encoded.frame.evidence[1]).toMatchObject({
      kind: "module_summary",
      frameSha256: digest(2),
    });
    encoded.canonicalBytes.fill(0);
    expect(encoded.frame.evidence[0]).toMatchObject({
      objectSha256: digest(1),
    });
  });

  it("rejects duplicates, out-of-order evidence, and future authority evidence only when malformed", () => {
    const item = {
      kind: "diagnostic",
      diagnosticOrdinal: 0n,
      frameSha256: digest(1),
    } as const;
    for (const evidence of [[item, item], [
      item,
      {
        kind: "module_summary",
        moduleOrdinal: 0n,
        frameSha256: digest(2),
      } as const,
    ]]) {
      const result = encodeDeclarativeV2PageEvidenceRootV1({
        ...base(),
        evidence,
      }, { maximumFrameBytes: 1_000 });
      expect(Result.isFailure(result) && result.failure).toMatchObject({
        reason: "outOfOrder",
      });
    }
    expect(Result.isSuccess(encodeDeclarativeV2PageEvidenceRootV1({
      ...base(),
      evidence: [{
        kind: "static_finalization",
        frameSha256: digest(8),
      }],
    }, { maximumFrameBytes: 1_000 }))).toBe(true);
  });

  it("fails at exact minus one budget and rejects bad predecessor pairing", () => {
    const exact = Result.getOrThrow(
      encodeDeclarativeV2PageEvidenceRootV1(
        base(),
        { maximumFrameBytes: 1_000 },
      ),
    ).canonicalBytes.byteLength;
    expect(Result.isSuccess(encodeDeclarativeV2PageEvidenceRootV1(
      base(),
      { maximumFrameBytes: exact },
    ))).toBe(true);
    const tooSmall = encodeDeclarativeV2PageEvidenceRootV1(
      base(),
      { maximumFrameBytes: exact - 1 },
    );
    expect(Result.isFailure(tooSmall) && tooSmall.failure).toMatchObject({
      reason: "frameBytesExceeded",
      observed: exact,
      maximum: exact - 1,
    });
    expect(Result.isFailure(encodeDeclarativeV2PageEvidenceRootV1({
      ...base(),
      pageOrdinal: 1n,
    }, { maximumFrameBytes: 1_000 }))).toBe(true);
    expect(Result.isSuccess(encodeDeclarativeV2PageEvidenceRootV1({
      ...base(),
      sequence: 0x7fff_ffff_ffff_ffffn,
      itemCount: 0x7fff_ffff_ffff_ffffn,
    }, { maximumFrameBytes: 1_000 }))).toBe(true);
    expect(Result.isFailure(encodeDeclarativeV2PageEvidenceRootV1({
      ...base(),
      sequence: 0x8000_0000_0000_0000n,
    }, { maximumFrameBytes: 1_000 }))).toBe(true);

    const hostileEvidence = Object.defineProperty({}, "kind", {
      enumerable: true,
      get: () => {
        throw new Error("evidence must not be traversed");
      },
    });
    const preflight = encodeDeclarativeV2PageEvidenceRootV1({
      ...base(),
      evidence: new Array(100).fill(hostileEvidence),
    }, { maximumFrameBytes: 120 });
    expect(Result.isFailure(preflight) && preflight.failure).toMatchObject({
      reason: "frameBytesExceeded",
      observed: 3_420,
      maximum: 120,
    });
  });

  it("rejects truncation, trailing bytes, bad domains, and noncanonical order", () => {
    const bytes = Result.getOrThrow(
      encodeDeclarativeV2PageEvidenceRootV1(
        base(),
        { maximumFrameBytes: 1_000 },
      ),
    ).canonicalBytes;
    for (let length = 0; length < bytes.byteLength; length += 1) {
      expect(Result.isFailure(decodeDeclarativeV2PageEvidenceRootV1(
        bytes.slice(0, length),
        { maximumFrameBytes: 1_000 },
      ))).toBe(true);
    }
    expect(Result.isFailure(decodeDeclarativeV2PageEvidenceRootV1(
      new Uint8Array([...bytes, 0]),
      { maximumFrameBytes: 1_000 },
    ))).toBe(true);
    const badDomain = bytes.slice();
    badDomain[0] ^= 0xff;
    expect(Result.isFailure(decodeDeclarativeV2PageEvidenceRootV1(
      badDomain,
      { maximumFrameBytes: 1_000 },
    ))).toBe(true);
    for (const offset of [80, 89, 90]) {
      const badTag = bytes.slice();
      badTag[offset] = 0xff;
      expect(Result.isFailure(decodeDeclarativeV2PageEvidenceRootV1(
        badTag,
        { maximumFrameBytes: 1_000 },
      ))).toBe(true);
    }
  });

  it("rejects hostile and detached inputs without consulting iterators", () => {
    const bytes = Result.getOrThrow(
      encodeDeclarativeV2PageEvidenceRootV1(
        base(),
        { maximumFrameBytes: 1_000 },
      ),
    ).canonicalBytes;
    Object.defineProperty(bytes, Symbol.iterator, {
      value: () => {
        throw new Error("iterator must not run");
      },
    });
    expect(Result.isSuccess(decodeDeclarativeV2PageEvidenceRootV1(
      bytes,
      { maximumFrameBytes: 1_000 },
    ))).toBe(true);
    const detached = bytes.slice();
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(Result.isFailure(decodeDeclarativeV2PageEvidenceRootV1(
      detached,
      { maximumFrameBytes: 1_000 },
    ))).toBe(true);
    expect(Result.isFailure(decodeDeclarativeV2PageEvidenceRootV1(
      new Proxy(bytes, {}),
      { maximumFrameBytes: 1_000 },
    ))).toBe(true);
  });

  it("is available only through its intentional internal subpath", async () => {
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const root = await import("../src/index");
    expect(packageJson.default.exports).toHaveProperty(
      "./internal/declarative-v2-verification-evidence-v1",
      "./src/declarative-v2-verification-evidence-v1.ts",
    );
    expect(root).not.toHaveProperty(
      "encodeDeclarativeV2PageEvidenceRootV1",
    );
  });
});

function base() {
  return {
    attemptSha256: digest(0),
    commandKind: "registration_page",
    sequence: 1n,
    phase: "registration",
    disposition: "completion",
    pageOrdinal: 0n,
    firstItemOrdinal: 0n,
    itemCount: 1n,
    previousPageSha256: null,
    evidence: [],
  } as const;
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
