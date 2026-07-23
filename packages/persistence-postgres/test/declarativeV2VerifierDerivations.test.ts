import { webcrypto } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  buildDeclarativeV2CommandOutputManifestPreimageV1,
  buildDeclarativeV2ModulePathProjectionPreimageV1,
} from "../src/declarativeV2VerifierDerivations";

describe("Declarative V2 verifier derivations", () => {
  it("frames module paths with a versioned domain and exact owned bytes", async () => {
    const exact = Result.getOrThrow(
      buildDeclarativeV2ModulePathProjectionPreimageV1(
        "src/\u0000😀.mjs",
        { maximumFrameBytes: 1_000 },
      ),
    );
    const domain = "flarex.declarative-v2/module-path-projection/v1\0";
    expect(
      new TextDecoder().decode(
        exact.bytes.subarray(0, Buffer.byteLength(domain)),
      ),
    ).toBe(domain);
    expect(exact.usage.frameBytes).toBe(exact.bytes.byteLength);
    expect(hex(await sha256(exact.bytes))).toBe(
      "7b8312f9aa7f7eb45dc8feaca374e7b25e699d99a2ef4132a20d9d277a4a345f",
    );

    const exactBudget = Result.getOrThrow(
      buildDeclarativeV2ModulePathProjectionPreimageV1(
        "src/\u0000😀.mjs",
        { maximumFrameBytes: exact.bytes.byteLength },
      ),
    );
    expect(exactBudget.bytes).toEqual(exact.bytes);
    const oneLess =
      buildDeclarativeV2ModulePathProjectionPreimageV1(
        "src/\u0000😀.mjs",
        { maximumFrameBytes: exact.bytes.byteLength - 1 },
      );
    expect(Result.isFailure(oneLess) && oneLess.failure).toMatchObject({
      _tag: "DeclarativeV2VerifierDerivationInputV1Error",
      reason: "frameBytesExceeded",
      observed: exact.bytes.byteLength,
      maximum: exact.bytes.byteLength - 1,
    });

    const caller = exact.bytes;
    const replay = Result.getOrThrow(
      buildDeclarativeV2ModulePathProjectionPreimageV1(
        "src/\u0000😀.mjs",
        { maximumFrameBytes: exact.bytes.byteLength },
      ),
    );
    caller[0] ^= 0xff;
    expect(replay.bytes[0]).not.toBe(caller[0]);
  });

  it("derives one ordered command-output manifest from actual evidence keys", async () => {
    const input = {
      attemptSha256: digest(0x11),
      commandKind: "link_page",
      sequence: 9n,
      evidence: [
        {
          kind: "module_summary",
          moduleOrdinal: 0n,
          frameSha256: digest(0x21),
        },
        {
          kind: "import_edge",
          moduleOrdinal: 0n,
          edgeOrdinal: 0n,
          frameSha256: digest(0x22),
        },
        {
          kind: "phase_page_manifest",
          phase: "link",
          pageOrdinal: 0n,
          frameSha256: digest(0x23),
        },
        {
          kind: "link_node",
          moduleOrdinal: 0n,
          rowVersion: 0n,
          frameSha256: digest(0x24),
        },
        {
          kind: "frontier_entry",
          frontierSequence: 0n,
          rowVersion: 0n,
          frameSha256: digest(0x25),
        },
        {
          kind: "registration",
          registrationOrdinal: 0n,
          frameSha256: digest(0x26),
        },
        {
          kind: "diagnostic",
          diagnosticOrdinal: 0n,
          frameSha256: digest(0x27),
        },
      ],
    } as const;
    const manifest = Result.getOrThrow(
      buildDeclarativeV2CommandOutputManifestPreimageV1(input, {
        maximumFrameBytes: 1_000,
      }),
    );
    const domain = "flarex.declarative-v2/command-output-manifest/v1\0";
    expect(
      new TextDecoder().decode(
        manifest.bytes.subarray(0, Buffer.byteLength(domain)),
      ),
    ).toBe(domain);
    expect(manifest.usage.frameBytes).toBe(manifest.bytes.byteLength);
    expect(hex(await sha256(manifest.bytes))).toBe(
      "b8ae586d8f14da8d77a21454a8b0827419b30db8349ce3ab5dc57c9420d0b169",
    );
    expect(
      Result.getOrThrow(
        buildDeclarativeV2CommandOutputManifestPreimageV1(input, {
          maximumFrameBytes: manifest.bytes.byteLength,
        }),
      ).bytes,
    ).toEqual(manifest.bytes);
    const oneLess =
      buildDeclarativeV2CommandOutputManifestPreimageV1(input, {
        maximumFrameBytes: manifest.bytes.byteLength - 1,
      });
    expect(Result.isFailure(oneLess) && oneLess.failure).toMatchObject({
      reason: "frameBytesExceeded",
      observed: manifest.bytes.byteLength,
      maximum: manifest.bytes.byteLength - 1,
    });
  });

  it("rejects duplicate, out-of-order, malformed, and aliased evidence", () => {
    const first = {
      kind: "module_summary",
      moduleOrdinal: 1n,
      frameSha256: digest(1),
    } as const;
    const second = {
      kind: "module_summary",
      moduleOrdinal: 0n,
      frameSha256: digest(2),
    } as const;
    const outOfOrder = buildDeclarativeV2CommandOutputManifestPreimageV1({
      attemptSha256: digest(3),
      commandKind: "parse_module",
      sequence: 1n,
      evidence: [first, second],
    }, { maximumFrameBytes: 1_000 });
    expect(Result.isFailure(outOfOrder) && outOfOrder.failure).toMatchObject({
      reason: "outOfOrder",
    });
    const duplicate = buildDeclarativeV2CommandOutputManifestPreimageV1({
      attemptSha256: digest(3),
      commandKind: "parse_module",
      sequence: 1n,
      evidence: [first, { ...first, frameSha256: digest(4) }],
    }, { maximumFrameBytes: 1_000 });
    expect(Result.isFailure(duplicate) && duplicate.failure).toMatchObject({
      reason: "outOfOrder",
    });
    const sourceDigest = digest(5);
    const captured = Result.getOrThrow(
      buildDeclarativeV2CommandOutputManifestPreimageV1({
        attemptSha256: digest(3),
        commandKind: "parse_module",
        sequence: 1n,
        evidence: [{
          kind: "module_summary",
          moduleOrdinal: 0n,
          frameSha256: sourceDigest,
        }],
      }, { maximumFrameBytes: 1_000 }),
    );
    sourceDigest[0] = 0xff;
    expect(captured.evidence[0]?.frameSha256[0]).toBe(5);
  });
});

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = bytes.slice().buffer;
  return new Uint8Array(await webcrypto.subtle.digest("SHA-256", owned));
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
