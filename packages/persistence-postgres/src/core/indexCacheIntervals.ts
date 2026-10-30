/**
 * Augmented interval treap translated from Convex crates/interval_map/src/lib.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Copyright 2026 Convex, Inc.,
 * FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 * JS references replace slab handles; each exact page has one live registration.
 */
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import type { CoreInterval } from "./contracts";
import { copyInterval, keyInInterval } from "./writeLog";

interface Node {
  readonly key: string;
  readonly interval: CoreInterval;
  readonly priority: number;
  parent: Node | undefined;
  left: Node | undefined;
  right: Node | undefined;
  maximumEnd: Uint8Array | null;
}

function compareStarts(a: Uint8Array | null, b: Uint8Array | null): number {
  return a === null ? b === null ? 0 : -1 : b === null ? 1 : compareBytesLexicographically(a, b);
}

function maximumEnd(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  return a === null || b === null ? null : compareBytesLexicographically(a, b) >= 0 ? a : b;
}

/** O((matches + 1) log n) expected point lookup, without scanning every page. */
export class CoreIndexCacheIntervals {
  private root: Node | undefined;
  private readonly nodes = new Map<string, Node>();

  get size(): number { return this.nodes.size; }
  has(key: string): boolean { return this.nodes.has(key); }

  insert(key: string, interval: CoreInterval, priority: number): void {
    if (this.nodes.has(key)) throw new Error("A page interval is already registered");
    const captured = copyInterval(interval);
    const node: Node = { key, interval: captured, priority, parent: undefined,
      left: undefined, right: undefined, maximumEnd: captured.end };
    this.nodes.set(key, node);
    const root = this.root;
    if (root === undefined) { this.root = node; return; }
    let current: Node = root;
    while (true) {
      const side = compareStarts(captured.start, current.interval.start) < 0 ? "left" : "right";
      const child: Node | undefined = current[side];
      if (child === undefined) { current[side] = node; node.parent = current; break; }
      current = child;
    }
    this.updateAncestors(node.parent);
    while (node.parent !== undefined && node.priority < node.parent.priority) this.rotateUp(node);
  }

  remove(key: string): void {
    const node = this.nodes.get(key);
    if (node === undefined) return;
    while (node.left !== undefined || node.right !== undefined) {
      const left = node.left;
      const right = node.right;
      const child = left === undefined ? right : right === undefined || left.priority <= right.priority ? left : right;
      if (child === undefined) throw new Error("Non-leaf interval node has no child");
      this.rotateUp(child);
    }
    const parent = node.parent;
    if (parent === undefined) this.root = undefined;
    else if (parent.left === node) parent.left = undefined;
    else parent.right = undefined;
    this.nodes.delete(key);
    this.updateAncestors(parent);
  }

  query(point: Uint8Array): readonly string[] {
    const found: string[] = [];
    const pending: Node[] = this.root === undefined ? [] : [this.root];
    while (pending.length !== 0) {
      const node = pending.pop();
      if (node === undefined || (node.maximumEnd !== null && compareBytesLexicographically(node.maximumEnd, point) <= 0)) continue;
      if (node.left !== undefined) pending.push(node.left);
      if (node.interval.start !== null && compareBytesLexicographically(node.interval.start, point) > 0) continue;
      if (keyInInterval(point, node.interval)) found.push(node.key);
      if (node.right !== undefined) pending.push(node.right);
    }
    return found;
  }

  keys(): IterableIterator<string> { return this.nodes.keys(); }

  private rotateUp(node: Node): void {
    const parent = node.parent;
    if (parent === undefined) throw new Error("Cannot rotate a root interval node");
    const grandparent = parent.parent;
    if (parent.left === node) {
      parent.left = node.right;
      if (node.right !== undefined) node.right.parent = parent;
      node.right = parent;
    } else {
      parent.right = node.left;
      if (node.left !== undefined) node.left.parent = parent;
      node.left = parent;
    }
    node.parent = grandparent;
    parent.parent = node;
    if (grandparent === undefined) this.root = node;
    else if (grandparent.left === parent) grandparent.left = node;
    else grandparent.right = node;
    this.update(parent);
    this.update(node);
  }

  private update(node: Node): void {
    let end = node.interval.end;
    if (node.left !== undefined) end = maximumEnd(end, node.left.maximumEnd);
    if (node.right !== undefined) end = maximumEnd(end, node.right.maximumEnd);
    node.maximumEnd = end;
  }

  private updateAncestors(first: Node | undefined): void {
    let node = first;
    while (node !== undefined) { this.update(node); node = node.parent; }
  }
}
