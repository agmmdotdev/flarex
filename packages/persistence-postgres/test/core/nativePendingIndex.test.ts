import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { describe, expect, it } from "vitest";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import { coreNativePendingIndexDocuments } from "../../src/core/nativeQuery";

describe("native pending index interval selection", () => {
  it("visits only the selected prefix and its end guard, retaining live members and ignoring tombstones", () => {
    const tree = new BTree<Uint8Array, DocumentObject | null>(undefined, compareBytesLexicographically);
    tree.set(Uint8Array.of(10), { _id: "before" });
    tree.set(Uint8Array.of(20), { _id: "selected" });
    tree.set(Uint8Array.of(25), null);
    tree.set(Uint8Array.of(30), { _id: "end-guard" });
    tree.set(Uint8Array.of(40), { _id: "untouched-suffix" });
    const starts: (Uint8Array | undefined)[] = [], visited: number[] = [];
    const observed = { *entries(start?: Uint8Array) {
      starts.push(start);
      for (const pair of tree.entries(start)) { visited.push(pair[0][0] ?? -1); yield pair; }
    } };
    expect([...coreNativePendingIndexDocuments(observed, { start: Uint8Array.of(20), end: Uint8Array.of(30) })])
      .toEqual([{ _id: "selected" }]);
    expect(starts).toEqual([Uint8Array.of(20)]);
    expect(visited).toEqual([20, 25, 30]);
  });

  it("retains full-range EOF and empty pending-index semantics", () => {
    const tree = new BTree<Uint8Array, DocumentObject | null>(undefined, compareBytesLexicographically);
    tree.set(Uint8Array.of(10), null);
    tree.set(Uint8Array.of(20), { _id: "live" });
    expect([...coreNativePendingIndexDocuments(tree, { start: null, end: null })]).toEqual([{ _id: "live" }]);
    expect([...coreNativePendingIndexDocuments(undefined, { start: null, end: null })]).toEqual([]);
    expect([...coreNativePendingIndexDocuments(tree, { start: Uint8Array.of(30), end: null })]).toEqual([]);
  });
});
