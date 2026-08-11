import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import {
  decodeSystemTestStructuredCloneBridgeValueV1,
  encodeSystemTestStructuredCloneBridgeValueV1,
  systemTestStructuredCloneBridgeEchoModuleSourceForTest,
} from "../support/fsv06StandardPointMutationHarness";

describe("FSV06 structured-clone RPC surrogate", () => {
  it("round-trips every supported scalar and container edge without collisions", () => {
    const input = {
      absent: undefined,
      integer: 42n,
      bytes: Uint8Array.from([0, 1, 127, 255]).buffer,
      numbers: [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      nested: { value: "recipe" },
    };

    const decoded = decodeSystemTestStructuredCloneBridgeValueV1(
      JSON.parse(JSON.stringify(encodeSystemTestStructuredCloneBridgeValueV1(input))),
    ) as typeof input;

    expect(Object.hasOwn(decoded, "absent")).toBe(true);
    expect(decoded.absent).toBeUndefined();
    expect(decoded.integer).toBe(42n);
    expect(Array.from(new Uint8Array(decoded.bytes))).toEqual([0, 1, 127, 255]);
    expect(Object.is(decoded.numbers[0], 0)).toBe(true);
    expect(Object.is(decoded.numbers[1], -0)).toBe(true);
    expect(Number.isNaN(decoded.numbers[2])).toBe(true);
    expect(decoded.numbers[3]).toBe(Number.POSITIVE_INFINITY);
    expect(decoded.numbers[4]).toBe(Number.NEGATIVE_INFINITY);
    expect(decoded.nested).toEqual({ value: "recipe" });

    expect(encodeSystemTestStructuredCloneBridgeValueV1(new ArrayBuffer(0)))
      .not.toEqual(encodeSystemTestStructuredCloneBridgeValueV1({}));
    expect(encodeSystemTestStructuredCloneBridgeValueV1(-0))
      .not.toEqual(encodeSystemTestStructuredCloneBridgeValueV1(0));
  });

  it("uses the same exact representation inside Workerd", async () => {
    const runtime = new Miniflare({
      compatibilityDate: "2026-06-18",
      modules: [{
        type: "ESModule",
        path: "bridge-echo.js",
        contents: systemTestStructuredCloneBridgeEchoModuleSourceForTest(),
      }],
    });
    try {
      const input = {
        absent: undefined,
        integer: -7n,
        bytes: Uint8Array.from([4, 8, 15, 16, 23, 42]).buffer,
        numbers: [-0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      };
      const response = await runtime.dispatchFetch("https://bridge.test/", {
        method: "POST",
        body: JSON.stringify(encodeSystemTestStructuredCloneBridgeValueV1(input)),
      });
      expect(response.status).toBe(200);
      const decoded = decodeSystemTestStructuredCloneBridgeValueV1(
        JSON.parse(await response.text()),
      ) as typeof input;

      expect(Object.hasOwn(decoded, "absent")).toBe(true);
      expect(decoded.absent).toBeUndefined();
      expect(decoded.integer).toBe(-7n);
      expect(Array.from(new Uint8Array(decoded.bytes))).toEqual(
        [4, 8, 15, 16, 23, 42],
      );
      expect(Object.is(decoded.numbers[0], -0)).toBe(true);
      expect(Number.isNaN(decoded.numbers[1])).toBe(true);
      expect(decoded.numbers[2]).toBe(Number.POSITIVE_INFINITY);
      expect(decoded.numbers[3]).toBe(Number.NEGATIVE_INFINITY);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects unsupported prototypes, accessors, and cycles without invoking accessors", () => {
    expect(() => encodeSystemTestStructuredCloneBridgeValueV1(new Date()))
      .toThrow("non-plain object");

    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "not read";
      },
    });
    expect(() => encodeSystemTestStructuredCloneBridgeValueV1(accessor))
      .toThrow("invalid object property");
    expect(getterCalls).toBe(0);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => encodeSystemTestStructuredCloneBridgeValueV1(cyclic))
      .toThrow("cyclic value");
  });
});
