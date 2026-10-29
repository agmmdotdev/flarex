import type { JsonObject } from "flarex-protocol/json";

/** Related wrappers and scalar leaves both consume the aggregate allowance. */
export function relatedPredicateNodes(nodes: number): JsonObject {
  if (!Number.isInteger(nodes) || nodes < 1) throw new Error("Invalid neutral predicate size");
  if (nodes === 1) return { kind: "and", children: [] };
  const leaf = (): JsonObject => ({ kind: "parent", predicate: { kind: "in", column: "attribute", values: ["threshold"] } });
  if (nodes === 2) return leaf();
  const even = nodes % 2 === 0;
  const children = Array.from({ length: (nodes - (even ? 2 : 1)) / 2 }, leaf);
  if (even) children.push({ kind: "and", children: [] });
  return { kind: "and", children };
}
