import { Result } from "effect";
import { describe, expect, it } from "vitest";
import * as AnalysisRoot from "../src/index";
import {
  canonicalPrivateAnalyzerHandshakeRequestV1,
  canonicalPrivateAnalyzerHandshakeResponseV1,
  capturePrivateAnalyzerReleaseTupleV1,
  decodePrivateAnalyzerHandshakeRequestV1,
  decodePrivateAnalyzerHandshakeResponseV1,
  GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1,
  installedPrivateAnalyzerReleaseTupleV1,
  type PrivateAnalyzerReleaseTupleV1,
} from "../src/privateAnalyzerReleaseV1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function installedTuple(): PrivateAnalyzerReleaseTupleV1 {
  return installedPrivateAnalyzerReleaseTupleV1();
}

function expectFailureReason(
  result: Result.Result<unknown, { readonly reason: string }>,
  reason: string,
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.reason).toBe(reason);
}

describe("private analyzer release V1", () => {
  it("owns the strict release tuple and canonical handshake goldens", () => {
    const identity = installedTuple();
    const captured = capturePrivateAnalyzerReleaseTupleV1({ ...identity });
    expect(Result.isSuccess(captured)).toBe(true);
    if (Result.isFailure(captured)) return;
    expect(captured.success).toEqual(identity);
    expect(captured.success).not.toBe(identity);
    expect(Object.isFrozen(captured.success)).toBe(true);

    expect(decoder.decode(canonicalPrivateAnalyzerHandshakeRequestV1(identity))).toBe(
      `{"configurationIdentity":"${identity.configurationIdentity}",` +
        `"implementationIdentity":"${identity.implementationIdentity}",` +
        `"protocolIdentity":"${identity.protocolIdentity}","protocolVersion":1}`,
    );
    expect(decoder.decode(canonicalPrivateAnalyzerHandshakeResponseV1(identity))).toBe(
      `{"configurationIdentity":"${identity.configurationIdentity}",` +
        `"implementationIdentity":"${identity.implementationIdentity}","kind":"compatible",` +
        `"protocolIdentity":"${identity.protocolIdentity}","protocolVersion":1}`,
    );
  });

  it("strictly rejects malformed tuple shapes without granting identity", () => {
    const identity = installedTuple();
    const inherited = Object.assign(Object.create(identity) as object, {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
    });
    const nonEnumerableExtra = { ...identity } as Record<PropertyKey, unknown>;
    Object.defineProperty(nonEnumerableExtra, "extra", { value: true });
    const symbolicExtra = { ...identity, [Symbol("extra")]: true };
    for (const value of [
      null,
      { ...identity, extra: true },
      inherited,
      nonEnumerableExtra,
      symbolicExtra,
      { ...identity, protocolIdentity: "other" },
      { ...identity, protocolVersion: 2 },
      { ...identity, implementationIdentity: "A".repeat(64) },
      { ...identity, configurationIdentity: "0".repeat(63) },
    ]) {
      expectFailureReason(capturePrivateAnalyzerReleaseTupleV1(value), "malformed");
    }
  });

  it("round-trips canonical request and response into owned frozen tuples", () => {
    const identity = installedTuple();
    for (const result of [
      decodePrivateAnalyzerHandshakeRequestV1(
        canonicalPrivateAnalyzerHandshakeRequestV1(identity),
        identity,
      ),
      decodePrivateAnalyzerHandshakeResponseV1(
        canonicalPrivateAnalyzerHandshakeResponseV1(identity),
        identity,
      ),
    ]) {
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isFailure(result)) continue;
      expect(result.success).toEqual(identity);
      expect(result.success).not.toBe(identity);
      expect(Object.isFrozen(result.success)).toBe(true);
    }
  });

  it("preserves malformed versus well-formed identity-mismatch classification", () => {
    const identity = installedTuple();
    const incompatible = Object.freeze({
      ...identity,
      implementationIdentity: "f".repeat(64),
    });
    expectFailureReason(
      decodePrivateAnalyzerHandshakeRequestV1(
        canonicalPrivateAnalyzerHandshakeRequestV1(incompatible),
        identity,
      ),
      "identityMismatch",
    );
    expectFailureReason(
      decodePrivateAnalyzerHandshakeResponseV1(
        canonicalPrivateAnalyzerHandshakeResponseV1(incompatible),
        identity,
      ),
      "identityMismatch",
    );

    const wrongProtocol = encoder.encode(JSON.stringify({
      configurationIdentity: identity.configurationIdentity,
      implementationIdentity: identity.implementationIdentity,
      protocolIdentity: "other",
      protocolVersion: 1,
    }));
    expectFailureReason(
      decodePrivateAnalyzerHandshakeRequestV1(wrongProtocol, identity),
      "identityMismatch",
    );
  });

  it("rejects malformed, extra, noncanonical, and invalid UTF-8 wire evidence", () => {
    const identity = installedTuple();
    const malformedValues = [
      encoder.encode(JSON.stringify({ ...identity, extra: true })),
      encoder.encode(JSON.stringify(identity, null, 2)),
      encoder.encode(JSON.stringify({ ...identity, protocolVersion: 2 })),
      encoder.encode(JSON.stringify({ kind: "wrong", ...identity })),
      new Uint8Array([0xc3, 0x28]),
      new Proxy(new Uint8Array(0), {}),
    ];
    for (const bytes of malformedValues) {
      expectFailureReason(decodePrivateAnalyzerHandshakeRequestV1(bytes, identity), "malformed");
    }
    expectFailureReason(
      decodePrivateAnalyzerHandshakeResponseV1(
        encoder.encode(JSON.stringify({ ...identity, kind: "wrong" })),
        identity,
      ),
      "malformed",
    );
  });

  it("isolates returned bytes and decoded records from caller aliases", () => {
    const identity = installedTuple();
    const first = canonicalPrivateAnalyzerHandshakeRequestV1(identity);
    const original = new Uint8Array(first);
    first.fill(0);
    expect(canonicalPrivateAnalyzerHandshakeRequestV1(identity)).toEqual(original);

    const mutable = { ...identity } as {
      protocolIdentity: string;
      protocolVersion: number;
      implementationIdentity: string;
      configurationIdentity: string;
    };
    const captured = capturePrivateAnalyzerReleaseTupleV1(mutable);
    expect(Result.isSuccess(captured)).toBe(true);
    mutable.implementationIdentity = "0".repeat(64);
    if (Result.isSuccess(captured)) {
      expect(captured.success.implementationIdentity).toBe(identity.implementationIdentity);
    }
  });

  it("keeps unexpected accessor defects outside the recoverable codec channel", () => {
    const identity = installedTuple();
    const defect = Object.freeze({ defect: "release-tuple-getter" });
    const hostile = { ...identity };
    Object.defineProperty(hostile, "protocolIdentity", {
      enumerable: true,
      get() {
        throw defect;
      },
    });
    expect(() => capturePrivateAnalyzerReleaseTupleV1(hostile)).toThrow(defect);
  });

  it("keeps the release contract absent from the root and owns the generated manifest", () => {
    expect("PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1" in AnalysisRoot).toBe(false);
    expect(Object.isFrozen(GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1)).toBe(true);
    expect(Object.isFrozen(GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1.toolchain)).toBe(true);
  });
});
