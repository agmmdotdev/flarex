import { Result } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

export const relatedPredicateOrigin = { kind: "synthetic", sourceId: "neutral-related-predicate" };
const origin = relatedPredicateOrigin;
export const relatedPredicateSchema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId, capabilities: [], tables: [
  { tableId: "parent", origin, columns: ["id", "attribute", "operator"].map(columnId => ({ columnId, type: "text", nullable: false,
    default: { kind: "none" }, origin })), keys: [{ keyId: "parent.primary", kind: "primary", columns: ["id"], origin }],
    indexes: [], constraints: [], relationships: [] },
  { tableId: "child", origin, columns: ["id", "parent_id", "value"].map(columnId => ({ columnId, type: "text", nullable: false,
    default: { kind: "none" }, origin })), keys: [{ keyId: "child.primary", kind: "primary", columns: ["id"], origin }],
    indexes: [{ indexId: "child.parent", kind: "textEquality", columns: ["parent_id"], predicate: null, origin }],
    constraints: [{ constraintId: "child.parent", kind: "foreignKey", sourceColumns: ["parent_id"],
      targetColumns: [{ tableId: "parent", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin }],
    relationships: [{ relationshipId: "child.parent", kind: "manyToOne", foreignKeyConstraintId: "child.parent", origin }] },
] }));
export const relatedPredicateParent = relatedPredicateSchema.tables.find(table => table.identity.tableId === "parent");
export const relatedPredicateChild = relatedPredicateSchema.tables.find(table => table.identity.tableId === "child");
if (relatedPredicateParent === undefined || relatedPredicateChild === undefined) throw new Error("Missing neutral related predicate tables");

export const relatedQuery = <Predicate>(predicate: Predicate) => ({ childTable: "child", foreignKey: "child.parent", predicate });
export const numericRelatedPredicate = { kind: "and", children: [
  { kind: "parent", predicate: { kind: "in", column: "attribute", values: ["threshold"] } },
  { kind: "parent", predicate: { kind: "in", column: "operator", values: ["gte"] } },
  { kind: "notInChild", predicate: { kind: "postgresText", column: "value", operator: "notIn", values: ["bad", "2"] } },
  { kind: "child", predicate: { kind: "postgresNumericCast", column: "value", operator: "gt", value: 2 } },
] };
