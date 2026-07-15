import { describe, expect, it } from "vitest";

import {
  canonicalizeFlarexValueV1,
  decodeCanonicalFlarexValueEvidenceV1,
} from "../src/value";

const TEXT_ENCODER = new TextEncoder();

describe("canonical Flarex value evidence", () => {
  it("round-trips exact canonical bytes and digest", async () => {
    const canonical = await canonicalizeFlarexValueV1({
      z: "last",
      a: 1n,
      nested: { enabled: true },
    });

    const decoded = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: canonical.canonicalBytes,
      sha256: canonical.sha256,
    });

    expect(decoded.value).toEqual(canonical.value);
    expect(decoded.valueJson).toEqual(canonical.valueJson);
    expect(decoded.canonicalText).toBe(canonical.canonicalText);
    expect(decoded.canonicalBytes).toEqual(canonical.canonicalBytes);
    expect(decoded.sha256).toEqual(canonical.sha256);
  });

  it("defensively copies supplied canonical bytes and digest before suspension", async () => {
    const canonical = await canonicalizeFlarexValueV1({ value: 7n });
    const suppliedBytes = new Uint8Array(canonical.canonicalBytes);
    const suppliedSha256 = new Uint8Array(canonical.sha256);

    const decodedPromise = decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: suppliedBytes,
      sha256: suppliedSha256,
    });
    suppliedBytes.fill(0);
    suppliedSha256.fill(0);

    const decoded = await decodedPromise;
    expect(decoded.canonicalBytes).toEqual(canonical.canonicalBytes);
    expect(decoded.sha256).toEqual(canonical.sha256);
    expect(decoded.canonicalBytes).not.toBe(suppliedBytes);
    expect(decoded.sha256).not.toBe(suppliedSha256);
  });

  it("rejects invalid UTF-8 and invalid JSON as canonical-byte failures", async () => {
    await expect(decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: new Uint8Array([0xc3, 0x28]),
      sha256: new Uint8Array(32),
    })).rejects.toMatchObject({
      issue: {
        reason: "invalidCanonicalBytes",
        detail: "stored canonical bytes are not valid UTF-8",
      },
    });

    await expect(decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: TEXT_ENCODER.encode("{not-json"),
      sha256: new Uint8Array(32),
    })).rejects.toMatchObject({
      issue: {
        reason: "invalidCanonicalBytes",
        detail: "stored canonical bytes are not valid JSON",
      },
    });
  });

  it("rejects valid but noncanonical envelope bytes", async () => {
    const noncanonicalBytes = TEXT_ENCODER.encode(
      '{"value":{"answer":42},"format":"flarex-value","valueCodecVersion":1}',
    );

    await expect(decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: noncanonicalBytes,
      sha256: new Uint8Array(32),
    })).rejects.toMatchObject({
      issue: { reason: "canonicalBytesMismatch" },
    });
  });

  it("rejects a digest that does not authenticate exact canonical bytes", async () => {
    const canonical = await canonicalizeFlarexValueV1({ answer: 42 });

    await expect(decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: canonical.canonicalBytes,
      sha256: new Uint8Array(32),
    })).rejects.toMatchObject({
      issue: { reason: "sha256Mismatch" },
    });
  });
});
