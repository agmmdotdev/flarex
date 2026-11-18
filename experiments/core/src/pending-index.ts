import type { Document } from "./definition.ts";
import type { NumericRange } from "./query.ts";

interface Node { readonly value: number; readonly creationTime: number; readonly id: string; readonly body: Document; left: Node | null; right: Node | null; height: number }
const height = (node: Node | null) => node?.height ?? 0;
const compare = (value: number, creationTime: number, id: string, node: Node) => value - node.value || creationTime - node.creationTime || (id < node.id ? -1 : id > node.id ? 1 : 0);
const update = (node: Node) => { node.height = 1 + Math.max(height(node.left), height(node.right)); return node; };
function rotateLeft(node: Node): Node {
  const next = node.right; if (next === null) return node;
  node.right = next.left; next.left = update(node); return update(next);
}
function rotateRight(node: Node): Node {
  const next = node.left; if (next === null) return node;
  node.left = next.right; next.right = update(node); return update(next);
}
function balance(node: Node): Node {
  update(node);
  if (height(node.left) - height(node.right) > 1) {
    if (node.left !== null && height(node.left.left) < height(node.left.right)) node.left = rotateLeft(node.left);
    return rotateRight(node);
  }
  if (height(node.right) - height(node.left) > 1) {
    if (node.right !== null && height(node.right.right) < height(node.right.left)) node.right = rotateRight(node.right);
    return rotateLeft(node);
  }
  return node;
}
function put(node: Node | null, value: number, creationTime: number, id: string, body: Document | null): Node | null {
  if (node === null) return body === null ? null : { value, creationTime, id, body, left: null, right: null, height: 1 };
  const order = compare(value, creationTime, id, node);
  if (order < 0) node.left = put(node.left, value, creationTime, id, body);
  else if (order > 0) node.right = put(node.right, value, creationTime, id, body);
  else {
    if (body !== null) return { ...node, body };
    if (node.left === null) return node.right;
    if (node.right === null) return node.left;
    let next = node.right; while (next.left !== null) next = next.left;
    return balance({ ...next, left: node.left, right: put(node.right, next.value, next.creationTime, next.id, null) });
  }
  return balance(node);
}

/** Numeric pending membership only. Updates maintain order; queries visit the
 * relevant frontier rather than rescan/sort the root's complete pending rows. */
export function createPendingIndex() {
  let root: Node | null = null;
  let comparisons = 0;
  return {
    set: (value: number, creationTime: number, id: string, body: Document | null) => { root = put(root, value, creationTime, id, body); },
    select: (range: NumericRange) => {
      const rows: Document[] = [];
      const visit = (node: Node | null): void => {
        if (node === null) return;
        comparisons++;
        const below = range.lower !== null && (node.value < range.lower.value || node.value === range.lower.value && !range.lower.inclusive);
        const above = range.upper !== null && (node.value > range.upper.value || node.value === range.upper.value && !range.upper.inclusive);
        if (!below) visit(node.left);
        if (!below && !above) rows.push(node.body);
        if (!above) visit(node.right);
      };
      visit(root); return rows;
    },
    diagnostics: () => ({ height: height(root), comparisons }),
  };
}
