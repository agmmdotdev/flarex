const origin = { kind: "synthetic", sourceId: "neutral.numeric-lower-bound" };
export function numericLowerBoundSchemaInput(lineageId = "neutral-numeric-lower-bound") {
  return { owner: "medusa", lineageId, capabilities: [], tables: [{ tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "amount", type: "numeric", nullable: true, default: { kind: "none" }, origin },
    { columnId: "floor", type: "numeric", nullable: false, default: { kind: "exactNumericLiteral", value: "1.000000000000000001" }, origin },
    { columnId: "negative", type: "numeric", nullable: true, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [], relationships: [], constraints: [
    { constraintId: "entry.amount", kind: "numericLowerBound", columnId: "amount", minimum: "0", origin },
    { constraintId: "entry.floor", kind: "numericLowerBound", columnId: "floor", minimum: "1.000000000000000001", origin },
    { constraintId: "entry.negative", kind: "numericLowerBound", columnId: "negative", minimum: "-1.25", origin },
  ] }] };
}
