import { createHash } from "node:crypto";

import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_REVISION_ACTIVATION_REQUEST_IDENTITY_V1,
  decodeApplicationRevisionActivationRequestV1,
  encodeApplicationRevisionActivationRequestV1,
  MAX_APPLICATION_REVISION_ACTIVATION_REVISION_V1,
} from "../src/application-revision-activation-request-v1";

const digest = (fill: number) => new Uint8Array(32).fill(fill);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

const first = Object.freeze({
  action: "activate" as const,
  scopeId: "scope_activation_vector",
  revisionId: "revision_activation_vector",
  candidateSha256: digest(0x11),
  readinessReceiptSha256: digest(0x22),
  expectedActiveRevision: null,
});

const replacement = Object.freeze({
  ...first,
  revisionId: "revision_activation_replacement",
  candidateSha256: digest(0x33),
  readinessReceiptSha256: digest(0x44),
  expectedActiveRevision: Object.freeze({
    activationRevision: 7n,
    activationHeadSha256: digest(0x55),
  }),
});

describe("application revision activation request V1", () => {
  it("pins the literal identity and deterministic first/replacement vectors", () => {
    expect(APPLICATION_REVISION_ACTIVATION_REQUEST_IDENTITY_V1).toBe(
      "flarex.system/application-revision-activation-request/v1",
    );
    const firstEncoded = Result.getOrThrow(
      encodeApplicationRevisionActivationRequestV1(first),
    );
    const replacementEncoded = Result.getOrThrow(
      encodeApplicationRevisionActivationRequestV1(replacement),
    );
    expect(hex(createHash("sha256").update(firstEncoded.canonicalBytes).digest()))
      .toBe("f4128704437ba6ec9b152784ede0a2db3f19151fe2d65f567fc557ea3f1ff6da");
    expect(hex(createHash("sha256").update(replacementEncoded.canonicalBytes).digest()))
      .toBe("23a09c4f33cac4f0cb0b07f7788069fe55d72c912cc79f49bdb522a0f94d0756");
    expect(Result.getOrThrow(
      decodeApplicationRevisionActivationRequestV1(firstEncoded.canonicalBytes),
    ).frame).toEqual(first);
    expect(Result.getOrThrow(
      decodeApplicationRevisionActivationRequestV1(
        replacementEncoded.canonicalBytes,
      ),
    ).frame).toEqual(replacement);
  });

  it("rejects hostile structure, bounds, malformed bytes, and noncanonical pairs", () => {
    const encoded = Result.getOrThrow(
      encodeApplicationRevisionActivationRequestV1(replacement),
    );
    const cloned = new Uint8Array(encoded.canonicalBytes);
    cloned[0] ^= 1;
    expect(Result.isFailure(
      decodeApplicationRevisionActivationRequestV1(cloned),
    )).toBe(true);
    expect(Result.isFailure(
      decodeApplicationRevisionActivationRequestV1(
        new Uint8Array(encoded.canonicalBytes.byteLength + 4_096),
      ),
    )).toBe(true);
    expect(Result.isFailure(
      encodeApplicationRevisionActivationRequestV1({
        ...replacement,
        extra: true,
      }),
    )).toBe(true);
    expect(Result.isFailure(
      encodeApplicationRevisionActivationRequestV1({
        ...replacement,
        expectedActiveRevision: {
          activationRevision:
            MAX_APPLICATION_REVISION_ACTIVATION_REVISION_V1 + 1n,
          activationHeadSha256: digest(0x55),
        },
      }),
    )).toBe(true);
    const accessor = Object.create(Object.prototype);
    for (const [key, value] of Object.entries(replacement)) {
      Object.defineProperty(accessor, key, {
        enumerable: true,
        ...(key === "scopeId" ? { get: () => value } : { value }),
      });
    }
    expect(Result.isFailure(
      encodeApplicationRevisionActivationRequestV1(accessor),
    )).toBe(true);
    expect(Result.isFailure(
      encodeApplicationRevisionActivationRequestV1({
        ...replacement,
        expectedActiveRevision: {
          activationRevision: 0n,
          activationHeadSha256: digest(0x55),
        },
      }),
    )).toBe(true);
  });

  it("changes the canonical digest for every authority field", () => {
    const base = Result.getOrThrow(
      encodeApplicationRevisionActivationRequestV1(replacement),
    ).canonicalBytes;
    const baseDigest = hex(createHash("sha256").update(base).digest());
    const variants = [
      { ...replacement, scopeId: `${replacement.scopeId}_changed` },
      { ...replacement, revisionId: `${replacement.revisionId}_changed` },
      { ...replacement, candidateSha256: digest(0x66) },
      { ...replacement, readinessReceiptSha256: digest(0x77) },
      {
        ...replacement,
        expectedActiveRevision: {
          ...replacement.expectedActiveRevision!,
          activationRevision: 8n,
        },
      },
      {
        ...replacement,
        expectedActiveRevision: {
          ...replacement.expectedActiveRevision!,
          activationHeadSha256: digest(0x88),
        },
      },
      { ...replacement, expectedActiveRevision: null },
    ];
    for (const variant of variants) {
      const bytes = Result.getOrThrow(
        encodeApplicationRevisionActivationRequestV1(variant),
      ).canonicalBytes;
      expect(hex(createHash("sha256").update(bytes).digest())).not.toBe(
        baseDigest,
      );
    }
  });
});
