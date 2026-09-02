import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { encodeCanonicalJson, type Json, type JsonObject } from
  "flarex-protocol/json";

import {
  type PrivateCanonicalStoredValueErrorPolicy,
  verifyStoredPrivateCanonicalValue,
} from "../src/frameworkSchema/privateCanonicalValue";
import { isPrivateValueStringArray } from
  "../src/frameworkSchema/privateStoredValueShape";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const EXPECTED_KEYS = Object.freeze(["format", "version", "payload"]);
const MAXIMUM_BYTES = 65_536;
type TestStoredError =
  | Readonly<{ readonly kind: "storedCorruption" }>
  | Readonly<{ readonly kind: "hashFailure"; readonly cause: unknown }>;

const ERRORS: PrivateCanonicalStoredValueErrorPolicy<TestStoredError> =
  Object.freeze({
  storedCorruption: () => Object.freeze({ kind: "storedCorruption" as const }),
  hashFailure: (cause: unknown) => Object.freeze({
    kind: "hashFailure" as const,
    cause,
  }),
  });

describe("private stored canonical value boundary", () => {
  it("uses intrinsic byte inspection without running caller byteLength accessors", async () => {
    const stored = storedFrame(frameAtDepth(1));
    let getterRan = false;
    Object.defineProperty(stored.bytes, "byteLength", {
      configurable: true,
      get: () => {
        getterRan = true;
        throw new Error("caller byteLength getter ran");
      },
    });

    const verified = await runEffect(verify(stored.bytes, stored.sha256Hex));
    expect(getterRan).toBe(false);
    expect(verified).toEqual(frameAtDepth(1));
  });

  it("rejects byte proxies and malformed byte envelopes through typed corruption", async () => {
    const valid = storedFrame(frameAtDepth(1));
    const cases: readonly unknown[] = [
      new Proxy(valid.bytes, {}),
      new Uint8Array(),
      new Uint8Array([0xff]),
      new Uint8Array(MAXIMUM_BYTES + 1),
    ];
    for (const bytes of cases) {
      await expect(runEffectFailure(verify(bytes, valid.sha256Hex)))
        .resolves.toEqual({ kind: "storedCorruption" });
    }
  });

  it("accepts JSON depth 128 and rejects depth 129 without overflowing", async () => {
    const accepted = storedFrame(frameAtDepth(128));
    const verified = await runEffect(verify(
      accepted.bytes,
      accepted.sha256Hex,
    ));
    expect(verified).toEqual(frameAtDepth(128));
    expect(Object.isFrozen(verified)).toBe(true);

    const rejected = storedFrame(frameAtDepth(129));
    await expect(runEffectFailure(verify(
      rejected.bytes,
      rejected.sha256Hex,
    ))).resolves.toEqual({ kind: "storedCorruption" });
  });

  it("runs bounded domain shape validation before canonical recapture", async () => {
    const stored = storedFrame({
      format: "flarex.test-private-canonical-value",
      version: 1,
      payload: Array.from({ length: 10_000 }, () => 0),
    });
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    try {
      const failure = await runEffectFailure(
        verifyStoredPrivateCanonicalValue({
          canonicalBytes: stored.bytes,
          sha256Hex: stored.sha256Hex,
          expectedFormat: "flarex.test-private-canonical-value",
          expectedVersion: 1,
          maximumCanonicalBytes: MAXIMUM_BYTES,
          expectedKeys: EXPECTED_KEYS,
          validateFrame: () => false,
        }, ERRORS),
      );
      expect(failure).toEqual({ kind: "storedCorruption" });
      expect(digest).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });

  it("rejects sparse, accessor, and decorated string arrays without invoking getters", () => {
    const sparse = new Array<string>(1);
    let getterRan = false;
    const accessor: string[] = [];
    Object.defineProperty(accessor, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        getterRan = true;
        return "value";
      },
    });
    accessor.length = 1;
    const decorated = ["value"];
    Object.defineProperty(decorated, "extra", {
      configurable: true,
      enumerable: true,
      value: "extra",
    });

    expect(isPrivateValueStringArray(sparse)).toBe(false);
    expect(isPrivateValueStringArray(accessor)).toBe(false);
    expect(isPrivateValueStringArray(decorated)).toBe(false);
    expect(getterRan).toBe(false);
  });
});

function verify(canonicalBytes: unknown, sha256Hex: unknown) {
  return verifyStoredPrivateCanonicalValue({
    canonicalBytes,
    sha256Hex,
    expectedFormat: "flarex.test-private-canonical-value",
    expectedVersion: 1,
    maximumCanonicalBytes: MAXIMUM_BYTES,
    expectedKeys: EXPECTED_KEYS,
    validateFrame: frame => frame.payload !== undefined,
  }, ERRORS);
}

function storedFrame(frame: JsonObject): Readonly<{
  readonly bytes: Uint8Array;
  readonly sha256Hex: string;
}> {
  const canonicalJson = encodeCanonicalJson(frame, cause => {
    throw cause;
  });
  return Object.freeze({
    bytes: new TextEncoder().encode(canonicalJson),
    sha256Hex: createHash("sha256").update(canonicalJson).digest("hex"),
  });
}

function frameAtDepth(depth: number): JsonObject {
  let payload: Json = null;
  for (let current = depth; current > 1; current -= 1) {
    payload = { value: payload };
  }
  return {
    format: "flarex.test-private-canonical-value",
    version: 1,
    payload,
  };
}
