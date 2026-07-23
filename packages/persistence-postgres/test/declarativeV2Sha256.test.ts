import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DeclarativeV2Sha256InputV1Error,
  DeclarativeV2Sha256ResourceV1Error,
  declarativeV2Sha256NativeCauseV1,
  makeDeclarativeV2Sha256V1,
} from "../src/declarativeV2Sha256";
import {
  runEffect,
  runEffectFailure,
} from "./effectTestRuntime";

describe("Declarative V2 persistence SHA-256 adapter", () => {
  it("hashes owned visible bytes with exact and one-less budgets", async () => {
    let calls = 0;
    const digest = makeDeclarativeV2Sha256V1(async (input) => {
      calls += 1;
      return webcrypto.subtle.digest("SHA-256", input);
    });
    const backing = Uint8Array.of(0xff, 0x61, 0x62, 0x63, 0xff);
    const visible = backing.subarray(1, 4);
    const result = await runEffect(digest(visible, {
      maximumInputBytes: 3,
    }));
    expect(Buffer.from(result).toString("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(calls).toBe(1);

    const failure = await runEffectFailure(digest(visible, {
      maximumInputBytes: 2,
    }));
    expect(failure).toBeInstanceOf(DeclarativeV2Sha256InputV1Error);
    expect(failure).toMatchObject({
      reason: "inputBytesExceeded",
      observed: 3,
      maximum: 2,
    });
    expect(calls).toBe(1);
  });

  it("retains only a direct native rejection identity in its private policy", async () => {
    const native = new DOMException("denied", "OperationError");
    const digest = makeDeclarativeV2Sha256V1(() => Promise.reject(native));
    const failure = await runEffectFailure(digest(new Uint8Array(), {
      maximumInputBytes: 0,
    }));
    expect(failure).toBeInstanceOf(DeclarativeV2Sha256ResourceV1Error);
    if (!(failure instanceof DeclarativeV2Sha256ResourceV1Error)) {
      throw new Error("Expected resource failure.");
    }
    expect(failure.reason).toBe("nativeRejected");
    expect(declarativeV2Sha256NativeCauseV1(failure)).toBe(native);
  });
});
