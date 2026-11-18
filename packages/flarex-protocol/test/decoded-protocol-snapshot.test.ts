import { describe, expect, it } from "vitest";
import { snapshotDecodedProtocolPlainData } from "../src/decoded-protocol-snapshot";

describe("decoded protocol plain-data snapshots", () => {
  it("detaches a shared graph once while preserving identity, primitive bytes and own keys", () => {
    const leaf = { integer: 17n, zero: -0, text: "\u0000" };
    const fields: Record<string, string> = {};
    Object.defineProperty(fields, "__proto__", { value: "own", enumerable: true });
    const owned = { leaf, alias: leaf, fields };
    type Branch = { child: Branch | typeof owned; alias: Branch | typeof owned };
    let graph: Branch | typeof owned = owned;
    for (let depth = 0; depth < 30; depth += 1) graph = { child: graph, alias: graph };
    const snapshot = snapshotDecodedProtocolPlainData(graph);
    expect(snapshot === graph).toBe(false);
    let current: Branch | typeof owned = snapshot;
    let depth = 0;
    while ("child" in current) {
      expect(current.child).toBe(current.alias);
      expect(Object.isFrozen(current)).toBe(true);
      current = current.child;
      depth += 1;
    }
    expect(depth).toBe(30);
    expect(current.leaf).toBe(current.alias);
    expect(current.leaf).not.toBe(leaf);
    expect(Object.isFrozen(current.leaf)).toBe(true);
    expect(current.leaf.integer).toBe(17n);
    expect(Object.is(current.leaf.zero, -0)).toBe(true);
    expect(current.leaf.text).toBe("\u0000");
    expect(Object.hasOwn(current.fields, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(current.fields)).toBe(Object.prototype);
    leaf.integer = 19n;
    expect(current.leaf.integer).toBe(17n);
  });

  it("copies deeply nested decoded data without a native or recursive stack limit", () => {
    type Node = { child: Node | null };
    let graph: Node = { child: null };
    for (let depth = 0; depth < 10_000; depth += 1) graph = { child: graph };
    const snapshot = snapshotDecodedProtocolPlainData(graph);
    let current: Node | null = snapshot;
    let containers = 0;
    while (current !== null) {
      expect(Object.isFrozen(current)).toBe(true);
      containers += 1;
      current = current.child;
    }
    expect(containers).toBe(10_001);
  });

  it("fails closed when a caller violates the decoded plain-data precondition", () => {
    for (const value of [new Uint8Array([1]), new Date(), new Map(), new Set(), () => true]) {
      expect(() => snapshotDecodedProtocolPlainData(value)).toThrow(TypeError);
    }
    let called = false;
    const accessor = { get value() { called = true; return true; } };
    expect(() => snapshotDecodedProtocolPlainData(accessor)).toThrow(TypeError);
    expect(called).toBe(false);
  });
});
