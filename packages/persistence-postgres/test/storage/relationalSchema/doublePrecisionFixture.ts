const origin = { kind: "synthetic", sourceId: "neutral.binary64-storage" };
/** Neutral scalar source, independent of any framework's business algorithm. */
export const binary64SchemaInput = () => ({ owner: "medusa", lineageId: "neutral-binary64-storage", capabilities: [], tables: [{ tableId: "measure", origin,
  columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "value", type: "doublePrecision", nullable: false, default: { kind: "doublePrecisionLiteral", value: 1.25 }, origin },
    { columnId: "large_default", type: "doublePrecision", nullable: false, default: { kind: "doublePrecisionLiteral", value: 1e30 }, origin },
    { columnId: "optional", type: "doublePrecision", nullable: true, default: { kind: "none" }, origin },
    { columnId: "count", type: "integer", nullable: false, default: { kind: "integerLiteral", value: 7 }, origin }],
  keys: [{ keyId: "measure.primary", kind: "primary", columns: ["id"], origin },
    { keyId: "measure.value", kind: "unique", columns: ["value"], origin }], indexes: [], constraints: [], relationships: [] }] });
export const binary64Values = [-1e30, -2147483649, -1.25, 0, Number.MIN_VALUE, 2147483648, 9007199254740991, 1e30, Number.MAX_VALUE];
