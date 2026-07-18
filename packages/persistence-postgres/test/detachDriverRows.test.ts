import { Buffer } from "node:buffer";
import { runInNewContext } from "node:vm";
import { isUint8Array } from "@flarex/utils/bytes";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  detachDriverRows,
  detachUnknownDriverRows,
} from "../src/detachDriverRows";

interface DriverRowFixture {
  nested: { label: string };
  createdAt: Date;
  bytes: Uint8Array;
}

describe("detachDriverRows", () => {
  it("rejects callable custom-prototype rows at compile time", () => {
    const readSymbol = Symbol("read");
    class CustomDriverRow {
      readonly value = 1;

      read(): number {
        return this.value;
      }
    }
    class CustomDate extends Date {
      read(): number {
        return this.getTime();
      }
    }
    class CustomBytes extends Uint8Array {
      read(): number | undefined {
        return this[0];
      }
    }
    class SymbolDate extends Date {
      [readSymbol](): number {
        return this.getTime();
      }
    }
    class NarrowDate extends Date {
      override toISOString(): "custom" {
        return "custom";
      }
    }

    if (false) {
      // @ts-expect-error structuredClone does not preserve custom prototypes.
      detachDriverRows([new CustomDriverRow()]);
      // @ts-expect-error structuredClone normalizes Date subclasses.
      detachDriverRows([{ createdAt: new CustomDate() }]);
      // @ts-expect-error structuredClone normalizes Uint8Array subclasses.
      detachDriverRows([{ bytes: new CustomBytes() }]);
      // @ts-expect-error structuredClone drops added symbol-keyed APIs.
      detachDriverRows([{ createdAt: new SymbolDate() }]);
      // @ts-expect-error structuredClone restores the base Date method type.
      detachDriverRows([{ createdAt: new NarrowDate() }]);
    }
    expect(new CustomDriverRow().read()).toBe(1);
  });

  it("rejects prototype and accessor-backed row properties", () => {
    class GetterDriverRow {
      get value(): number {
        return 1;
      }
    }
    let getterCalled = false;
    const accessorRow = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return 1;
      },
    });
    const byteImpostor: Uint8Array = Object.create(Uint8Array.prototype);

    expect(() => detachDriverRows([new GetterDriverRow()])).toThrow(
      "Driver rows must contain only plain records.",
    );
    expect(() => detachDriverRows([accessorRow])).toThrow(
      "Driver rows must contain only enumerable data properties.",
    );
    expect(() => detachDriverRows([{ bytes: byteImpostor }])).toThrow(
      "Driver rows must contain only plain records.",
    );
    expect(getterCalled).toBe(false);
  });

  it("rejects top-level accessors without invoking them", () => {
    let iteratorGetterCalled = false;
    const rows = [{ value: 1 }];
    Object.defineProperty(rows, Symbol.iterator, {
      get: () => {
        iteratorGetterCalled = true;
        return Array.prototype[Symbol.iterator];
      },
    });

    expect(() => detachDriverRows(rows)).toThrow(
      "Driver rows contain an unsupported key.",
    );
    expect(iteratorGetterCalled).toBe(false);
  });

  it("deeply detaches rows while freezing only the owned array", () => {
    const sourceRow: DriverRowFixture = {
      nested: { label: "original" },
      createdAt: new Date("2026-07-18T00:00:00.000Z"),
      bytes: new Uint8Array([1, 2, 3]),
    };
    const source = [sourceRow];

    const detached = detachDriverRows(source);
    const detachedRow = detached[0];
    if (detachedRow === undefined) {
      throw new Error("Expected one detached driver row");
    }

    expect(detached).not.toBe(source);
    expect(detachedRow).not.toBe(sourceRow);
    expect(Object.isFrozen(detached)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(detachedRow)).toBe(false);
    expect(Object.isFrozen(detachedRow.nested)).toBe(false);
    expect(detachedRow.createdAt).not.toBe(sourceRow.createdAt);
    expect(detachedRow.bytes).not.toBe(sourceRow.bytes);

    sourceRow.nested.label = "mutated";
    sourceRow.createdAt.setTime(0);
    sourceRow.bytes[0] = 9;

    expect(detachedRow.nested.label).toBe("original");
    expect(detachedRow.createdAt.toISOString()).toBe(
      "2026-07-18T00:00:00.000Z",
    );
    expect(detachedRow.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("allocates a fresh frozen snapshot for every call", () => {
    const first = detachDriverRows([]);
    const second = detachDriverRows([]);

    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
  });

  it("normalizes a driver Buffer within the declared Uint8Array contract", () => {
    const driverBytes: Uint8Array = Buffer.from([1, 2, 3]);
    const detached = detachDriverRows([{ bytes: driverBytes }]);
    const detachedBytes = detached[0]?.bytes;

    expect(detachedBytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(detachedBytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(detachedBytes)).toBe(false);
  });

  it("rejects shared-backed bytes that structuredClone cannot detach", () => {
    const shared = new SharedArrayBuffer(3);
    const bytes = new Uint8Array(shared);

    expect(() => detachDriverRows([{ bytes }])).toThrow(
      "Driver row bytes must not use SharedArrayBuffer storage.",
    );
  });

  it("rejects cross-realm shared-backed bytes intrinsically", () => {
    const candidate: unknown = runInNewContext(
      "new Uint8Array(new SharedArrayBuffer(3))",
    );
    if (!isUint8Array(candidate)) {
      throw new Error("Expected a cross-realm Uint8Array");
    }

    expect(candidate instanceof Uint8Array).toBe(false);
    expect(() => detachDriverRows([{ bytes: candidate }])).toThrow(
      "Driver row bytes must not use SharedArrayBuffer storage.",
    );
  });

  it("preserves the platform structured-clone failure", () => {
    const rows = [{ uncloneable: () => undefined }];
    const detachedUnknown = detachUnknownDriverRows([{ value: 1 }]);

    expectTypeOf(detachedUnknown).toEqualTypeOf<ReadonlyArray<unknown>>();
    expect(() => detachUnknownDriverRows(rows)).toThrowError(
      expect.objectContaining({ name: "DataCloneError" }),
    );
    expect(Object.isFrozen(rows)).toBe(false);
  });
});
