import { createHmac } from "node:crypto";
import { gcmsiv } from "@noble/ciphers/aes.js";
import * as aes from "@noble/ciphers/aes.js";
import { Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createQueryCursorBroker, type QueryCursorPosition } from "../src/query-cursor";

vi.mock("@noble/ciphers/aes.js", { spy: true });

const secret = Uint8Array.from({ length: 32 }, (_, i) => i);
const fingerprint = Uint8Array.from({ length: 32 }, (_, i) => i);
const broker = (instanceName = "test", deploymentSecret = secret) => Result.getOrThrow(createQueryCursorBroker({ instanceName, deploymentSecret }));
const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const key = createHmac("sha256", secret).update(fromHex("00000001")).update("cursor").digest().subarray(0, 16);
const seal = (plaintext: Uint8Array) => "07" + Buffer.from(gcmsiv(key, new Uint8Array(12), Uint8Array.of(7)).encrypt(plaintext)).toString("hex");

describe("version-7 InstanceCursor broker", () => {
  it("verifies RFC 8452 AES-128-GCM-SIV known vectors used by the codec", () => {
    const vectorKey = fromHex("01000000000000000000000000000000");
    const nonce = fromHex("030000000000000000000000");
    expect(Buffer.from(gcmsiv(vectorKey, nonce).encrypt(new Uint8Array())).toString("hex")).toBe("dc20e2d83f25705bb49e439eca56de25");
    expect(Buffer.from(gcmsiv(vectorKey, nonce).encrypt(fromHex("0100000000000000"))).toString("hex")).toBe("b5d839330ac7b786578782fff6013b815b287c22493a364c");
  });

  it("matches source protobuf tag order, counter-HMAC key derivation, version AAD and zero nonce", () => {
    const cursor = { position: { kind: "after", key: Uint8Array.of(1, 2, 3) } as const, queryFingerprint: fingerprint };
    const token = broker().encode(cursor);
    const expectedPlaintext = fromHex("0a0474657374120522030102032220" + Buffer.from(fingerprint).toString("hex"));
    // Independent Rust prost 0.14.3 / aes-gcm-siv 0.11.1 execution over the pinned
    // InstanceCursor layout; counter-HMAC uses deployment secret bytes 0..31.
    expect(key.toString("hex")).toBe("aacb080fcc2bfea9cfa13fc1ab2ed4f9");
    expect(token).toBe(seal(expectedPlaintext));
    expect(token).toBe("0726b5148004ae5ce33661282efc795210c6a849c500d52d36f990ec7f1bb5d0918ad7755bbae24f133cf976addf92c3d112541ce51752e191560d4563ebcf10");
    expect(token).toMatch(/^07[0-9a-f]+$/);
    expect(broker().decode(token)).toEqual(Result.succeed(cursor));
    const end = broker().encode({ position: { kind: "end" }, queryFingerprint: fingerprint });
    expect(end).toBe(seal(fromHex("0a04746573741a002220" + Buffer.from(fingerprint).toString("hex"))));
    expect(end).toBe("074280d48c8a22346f557ef0248c800ee0de474a2e0c79d08895e3fa47c1bdf9ef9c89eefa9925a67bece8031fe71b9acb4abc06504c28ade3387c");
  });

  it("is deterministic across cold factory reopen and owns all supplied and returned bytes", () => {
    const callerSecret = secret.slice();
    const first = broker("test", callerSecret);
    const positionKey = Uint8Array.of(1, 2, 3);
    const fp = fingerprint.slice();
    const token = first.encode({ position: { kind: "after", key: positionKey }, queryFingerprint: fp });
    callerSecret.fill(255); positionKey.fill(255); fp.fill(255);
    const reopened = broker();
    expect(reopened.encode({ position: { kind: "after", key: Uint8Array.of(1, 2, 3) }, queryFingerprint: fingerprint })).toBe(token);
    const decoded = Result.getOrThrow(first.decode(token));
    decoded.queryFingerprint.fill(255);
    if (decoded.position.kind === "after") decoded.position.key.fill(255);
    expect(Result.getOrThrow(first.decode(token)).queryFingerprint).toEqual(fingerprint);
  });

  it("classifies malformed encoding/version/authentication/instance/body without hiding defects", () => {
    const first = broker();
    const token = first.encode({ position: { kind: "end" }, queryFingerprint: fingerprint });
    const failure = (value: string, instance = first) => { const result = instance.decode(value); if (Result.isSuccess(result)) throw new Error("Expected failure"); return result.failure.reason; };
    expect(failure("not hex")).toBe("invalidEncoding");
    expect(failure("08" + token.slice(2))).toBe("invalidVersion");
    expect(failure("07")).toBe("authenticationFailed");
    expect(failure(token.slice(0, -2) + (token.endsWith("00") ? "01" : "00"))).toBe("authenticationFailed");
    expect(failure(token, broker("other"))).toBe("instanceMismatch");
    expect(failure(token, broker("test", new Uint8Array(32)))).toBe("authenticationFailed");
    expect(failure(seal(fromHex("0a0474657374")))).toBe("invalidPayload"); // missing position
    expect(failure(seal(fromHex("0a04746573741204")))).toBe("invalidPayload"); // truncated message
    expect(failure(seal(fromHex("0a01ff1a00")))).toBe("invalidPayload"); // invalid UTF-8
    expect(failure(seal(fromHex("0a04746573741001")))).toBe("invalidPayload"); // wrong position wire
    expect(Result.getOrThrow(first.decode(token.toUpperCase())).position).toEqual({ kind: "end" });
    expect(Result.getOrThrow(first.decode("0x" + token)).position).toEqual({ kind: "end" });
    expect(Result.getOrThrow(first.decode("0X" + token.toUpperCase())).position).toEqual({ kind: "end" });
  });

  it("retains protobuf empty/default/unknown field semantics and exact pure size projection", () => {
    const first = broker();
    const withUnknown = seal(fromHex("0a04746573741a002800"));
    expect(Result.getOrThrow(first.decode(withUnknown))).toEqual({ position: { kind: "end" }, queryFingerprint: new Uint8Array() });
    for (const length of [0, 1, 127, 128, 2500, 4000]) {
      const positions: readonly QueryCursorPosition[] = [{ kind: "end" }, { kind: "after", key: new Uint8Array(length) }];
      for (const position of positions) for (const fpLength of [0, 32, 128]) {
        expect(first.encodedLength(position, fpLength)).toBe(first.encode({ position, queryFingerprint: new Uint8Array(fpLength) }).length);
      }
    }
    expect(Result.isFailure(createQueryCursorBroker({ instanceName: "x", deploymentSecret: new Uint8Array(31) }))).toBe(true);
  });

  it("propagates distinguishable cipher defects instead of treating every throw as authentication failure", () => {
    const first = broker();
    const token = first.encode({ position: { kind: "end" }, queryFingerprint: fingerprint });
    const defect = new Error("cipher implementation defect");
    const mockedCipher = vi.mocked(aes.gcmsiv).mockImplementation(() => { throw defect; });
    try { expect(() => first.decode(token)).toThrow(defect); }
    finally { mockedCipher.mockRestore(); }
  });
});
