import { Result } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

export const relatedBudgetDefinitions = [0, 1].map(index => {
  const key = "medusa.neutral-related-budget-" + index, evidence = { kind: "synthetic", sourceId: key };
  const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: key, capabilities: [], tables: [
    { tableId: "parent", origin: evidence, columns: ["id", "attribute", "operator"].map(columnId => ({ columnId, type: "text", nullable: false,
      default: { kind: "none" }, origin: evidence })), keys: [{ keyId: "parent.primary", kind: "primary", columns: ["id"], origin: evidence }],
      indexes: [], constraints: [], relationships: [] },
    { tableId: "child", origin: evidence, columns: ["id", "parent_id", "value"].map(columnId => ({ columnId, type: "text", nullable: false,
      default: { kind: "none" }, origin: evidence })), keys: [{ keyId: "child.primary", kind: "primary", columns: ["id"], origin: evidence }],
      indexes: [{ indexId: "child.parent", kind: "textEquality", columns: ["parent_id"], predicate: null, origin: evidence }],
      constraints: [{ constraintId: "child.parent", kind: "foreignKey", sourceColumns: ["parent_id"],
        targetColumns: [{ tableId: "parent", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin: evidence }],
      relationships: [{ relationshipId: "child.parent", kind: "manyToOne", foreignKeyConstraintId: "child.parent", origin: evidence }] },
  ] }));
  return { key, evidence, schema };
});
