/** Neutral declarations: the checked schema/layout owners compile all FK behavior. */
export function structuralCommerceSchema(chain = false, extraTables = 0) {
  const origin = { kind: "authored", sourceId: "test.structural-ownership" };
  const table = (tableId: string, target?: string) => ({ tableId, origin,
    columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      ...(target === undefined ? [] : [{ columnId: "parent_id", type: "text", nullable: false, default: { kind: "none" }, origin }])],
    keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin }],
    indexes: [], relationships: [],
    constraints: target === undefined ? [] : [{ constraintId: `${tableId}.parent`, kind: "foreignKey", sourceColumns: ["parent_id"],
      targetColumns: [{ tableId: target, columnId: "id" }], onDelete: "cascade", onUpdate: "restrict", origin }],
  });
  return { owner: "medusa", lineageId: "structural-ownership", capabilities: [],
    tables: [table("parent", chain ? "ancestor" : undefined), table("child", "parent"), table("independent"),
      ...(chain ? [table("ancestor")] : []), ...Array.from({ length: extraTables }, (_, index) => table(`extra_${index}`))] };
}
export const structuralCommerceProvenance = { kind: "sourceSnapshot", repository: "https://example.com/structural-ownership",
  revision: "d".repeat(40), paths: ["model.ts"] };
