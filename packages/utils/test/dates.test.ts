import { describe, expect, it } from "vitest";

import {
  copyFiniteDate,
  finiteDateMilliseconds,
} from "@flarex/utils/dates";

describe("finite Date utilities", () => {
  it("reads genuine Dates with finite internal times", () => {
    expect(finiteDateMilliseconds(new Date(0))).toBe(0);
    expect(finiteDateMilliseconds(new Date(8_640_000_000_000_000))).toBe(
      8_640_000_000_000_000,
    );
    expect(finiteDateMilliseconds(new Date(-8_640_000_000_000_000))).toBe(
      -8_640_000_000_000_000,
    );
  });

  it("rejects invalid Dates and non-Date values", () => {
    expect(finiteDateMilliseconds(new Date(Number.NaN))).toBeUndefined();
    expect(
      finiteDateMilliseconds(new Date(8_640_000_000_000_001)),
    ).toBeUndefined();
    expect(finiteDateMilliseconds(Date.now())).toBeUndefined();
    expect(
      finiteDateMilliseconds("2026-07-18T00:00:00.000Z"),
    ).toBeUndefined();
    expect(finiteDateMilliseconds(null)).toBeUndefined();
  });

  it("reads intrinsic state without invoking caller-controlled methods", () => {
    const valid = new Date(0);
    Object.defineProperty(valid, "getTime", {
      value: () => Number.NaN,
    });
    expect(finiteDateMilliseconds(valid)).toBe(0);

    const invalid = new Date(Number.NaN);
    Object.defineProperty(invalid, "getTime", { value: () => 0 });
    expect(finiteDateMilliseconds(invalid)).toBeUndefined();
  });

  it("snapshots subclasses without invoking stateful overrides", () => {
    class StatefulDate extends Date {
      calls = 0;

      override getTime(): number {
        this.calls += 1;
        return this.calls === 1 ? 0 : Number.NaN;
      }
    }

    const date = new StatefulDate(0);
    expect(finiteDateMilliseconds(date)).toBe(0);
    expect(copyFiniteDate(date)).toEqual(new Date(0));
    expect(date.calls).toBe(0);
  });

  it("returns a fresh plain Date over exactly the captured timestamp", () => {
    const source = new Date(123);
    const copy = copyFiniteDate(source);

    expect(copy).toEqual(new Date(123));
    expect(copy).not.toBe(source);
    expect(Object.getPrototypeOf(copy)).toBe(Date.prototype);
  });

  it("does not invoke caller-controlled accessors", () => {
    const date = new Date(0);
    let calls = 0;
    Object.defineProperty(date, "getTime", {
      get: () => {
        calls += 1;
        throw new Error("getTime accessor");
      },
    });

    expect(finiteDateMilliseconds(date)).toBe(0);
    expect(calls).toBe(0);
  });

  it("rejects forwarding and revoked Proxies without throwing", () => {
    const target = new Date(0);
    expect(finiteDateMilliseconds(new Proxy(target, {}))).toBeUndefined();

    const forwarding = new Proxy(target, {
      get(value, key) {
        const member: unknown = Reflect.get(value, key, value);
        return typeof member === "function" ? member.bind(value) : member;
      },
    });
    expect(forwarding.getTime()).toBe(0);
    expect(finiteDateMilliseconds(forwarding)).toBeUndefined();

    const revocable = Proxy.revocable(new Date(0), {});
    revocable.revoke();
    expect(finiteDateMilliseconds(revocable.proxy)).toBeUndefined();
  });

  it("ignores a Proxy installed in a genuine Date's prototype chain", () => {
    const date = new Date(0);
    Object.setPrototypeOf(date, new Proxy(Date.prototype, {
      get: () => () => Number.NaN,
      getOwnPropertyDescriptor: () => ({
        configurable: true,
        value: Date.prototype.getTime,
        writable: true,
      }),
      getPrototypeOf: () => Date.prototype,
    }));

    expect(date.getTime()).toBe(Number.NaN);
    expect(finiteDateMilliseconds(date)).toBe(0);
    expect(copyFiniteDate(date)).toEqual(new Date(0));
  });

  it("rejects Date prototype impostors without throwing", () => {
    const impostor: unknown = Object.create(Date.prototype);
    expect(impostor instanceof Date).toBe(true);
    expect(finiteDateMilliseconds(impostor)).toBeUndefined();

    const forgedProxy: unknown = new Proxy({}, {
      getPrototypeOf: () => Date.prototype,
    });
    expect(forgedProxy instanceof Date).toBe(true);
    expect(finiteDateMilliseconds(forgedProxy)).toBeUndefined();
  });
});
