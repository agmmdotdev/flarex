import { Result } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

export const referenceCheckpointOrigin = { kind: "synthetic", sourceId: "neutral-reference-checkpoint" };
const origin = referenceCheckpointOrigin;
export const referenceCheckpointSchema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  capabilities: [], tables: [
    { tableId: "parent", origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    ], keys: [{ keyId: "parent.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] },
    { tableId: "child", origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "parent_id", type: "text", nullable: false, default: { kind: "none" }, origin },
    ], keys: [{ keyId: "child.primary", kind: "primary", columns: ["id"], origin }],
    indexes: [{ indexId: "child.parent", kind: "textEquality", columns: ["parent_id"], predicate: null, origin }],
    constraints: [{ constraintId: "child.parent", kind: "foreignKey", sourceColumns: ["parent_id"],
      targetColumns: [{ tableId: "parent", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin }],
    relationships: [{ relationshipId: "child.parent", kind: "manyToOne", foreignKeyConstraintId: "child.parent", origin }] },
  ] }));
