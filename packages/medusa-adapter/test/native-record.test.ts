import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { captureNativeRecord, captureNativeDateRecord } from "../src/value/native-record";

describe("native scalar record capture", () => {
  it("copies only own data without mutating the foreign record or invoking getters", async () => {
    const input = Object.freeze({ id: "native", metadata: { present: true } });
    expect(await Effect.runPromise(captureNativeRecord(input))).toEqual(input);
    let calls = 0;
    expect(await Effect.runPromise(Effect.result(captureNativeRecord({ get metadata() { calls++; return {}; } }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(calls).toBe(0);
    for (const foreign of [[], null, Object.create({ inherited: true }), Object.defineProperty({}, "hidden", { value: 1 }), { [Symbol("foreign")]: 1 }])
      expect(await Effect.runPromise(Effect.result(captureNativeRecord(foreign)))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });
  it("converts only selected genuine business dates with the intrinsic formatter", async () => {
    const stamp = new Date("2026-10-23T00:00:00.000Z"), other = new Date("2020-01-01T00:00:00.000Z");
    const input = { authorized_at: stamp, created_at: other, data: { literal: true } };
    Object.defineProperty(stamp, "toISOString", { get() { throw new Error("Foreign date method must stay inert"); } });
    const captured = await Effect.runPromise(captureNativeDateRecord(input, ["authorized_at"]));
    expect(captured).toEqual({ authorized_at: "2026-10-23T00:00:00.000Z", created_at: other, data: input.data });
    expect(input.authorized_at).toBe(stamp);
    expect(captured.created_at).toBe(other);
    expect(await Effect.runPromise(Effect.result(captureNativeDateRecord({ authorized_at: new Date(NaN) }, ["authorized_at"]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await Effect.runPromise(captureNativeDateRecord({ authorized_at: null, canceled_at: undefined }, ["authorized_at", "canceled_at"])))
      .toEqual({ authorized_at: null, canceled_at: undefined });
  });
  it("keeps an own __proto__ data field inert before reading selected values", async () => {
    let calls = 0;
    const payload = { get authorized_at() { calls++; return new Date(); }, get amount() { calls++; return "1"; } };
    const input = Object.defineProperty({ id: "native" }, "__proto__", { value: payload, enumerable: true });
    const captured = await Effect.runPromise(captureNativeDateRecord(input, ["authorized_at", "amount"]));
    expect(Object.getPrototypeOf(captured)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(captured, "__proto__")?.value).toBe(payload);
    expect(Object.hasOwn(captured, "authorized_at")).toBe(false);
    expect(Object.hasOwn(captured, "amount")).toBe(false);
    expect(calls).toBe(0);
  });
});
