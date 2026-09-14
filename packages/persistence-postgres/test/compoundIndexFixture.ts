export const compoundIndexValue = "active') AND (true) -- \\ $fx$";

export function compoundIndexSchema(value = compoundIndexValue) {
  const origin = { kind: "authored", sourceId: "fixture.compound-index" };
  return { owner: "medusa", lineageId: "compound-index", tables: [{
    tableId: "listing", origin,
    columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "state", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "retired", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
    ],
    keys: [{ keyId: "listing.primary", kind: "primary", columns: ["id"], origin }],
    indexes: [{ indexId: "listing.active", kind: "btree", columns: ["state"],
      predicate: { kind: "isNullAndTextEquals", nullColumnId: "retired", textColumnId: "state", value }, origin }],
    constraints: [{ constraintId: "listing.states", kind: "textSet", columnId: "state", values: [value, "draft"], origin }],
    relationships: [],
  }], capabilities: [] };
}
