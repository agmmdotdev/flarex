import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import {
  normalizeRelationalSchema,
} from "flarex-protocol/internal/relational-schema";
import { compileLogicalSourceSearches } from "flarex-protocol/internal/logical-storage-requirements";
import { dmlSchemaOrigins, lowerDmlSchema } from "../src/schema/lower";
import type { SchemaColumn, SchemaTable } from "../src/schema/model";
import { decodeCompiledDml } from "../src/schema/compiled";

const timestamps: readonly SchemaColumn[] = [
  { name: "created_at", type: "dateTime", nullable: false, primaryKey: false },
  { name: "updated_at", type: "dateTime", nullable: false, primaryKey: false },
  { name: "deleted_at", type: "dateTime", nullable: true, primaryKey: false },
];

const ledger = {
  name: "ledger",
  columns: [
    { name: "lookup_key", type: "text", nullable: false, primaryKey: true, options: { searchable: true } },
    { name: "state", type: "enum", nullable: false, primaryKey: false, defaultValue: "open", options: { choices: ["open", "closed"] } },
    { name: "quantity", type: "number", nullable: false, primaryKey: false, defaultValue: 0 },
    { name: "enabled", type: "boolean", nullable: false, primaryKey: false, defaultValue: false },
    { name: "amount", type: "bigNumber", nullable: false, primaryKey: false, defaultValue: "9007199254740993.125" },
    { name: "amount_data", type: "json", nullable: false, primaryKey: false, generated: true, defaultValue: { value: "9007199254740993.125", precision: 20 } },
    { name: "discount", type: "bigNumber", nullable: false, primaryKey: false, defaultValue: 0 },
    { name: "discount_data", type: "json", nullable: false, primaryKey: false, generated: true, defaultValue: { value: "0", precision: 20 } },
    ...timestamps,
  ],
  indexes: [
    { name: "ledger_key_unique", columns: ["lookup_key"], unique: true },
    { name: "ledger_active_unique", columns: ["lookup_key"], unique: true, where: "deleted_at IS NULL" },
    { name: "ledger_quantity", columns: ["quantity"], unique: false },
  ],
  foreignKeys: [],
  exactNumbers: [
    { capabilityId: "ledger.amount", numericColumn: "amount", rawColumn: "amount_data" },
    { capabilityId: "ledger.discount", numericColumn: "discount", rawColumn: "discount_data" },
  ],
} as const satisfies SchemaTable;
const labels = {
  name: "labels",
  columns: [{ name: "label_key", type: "id", nullable: false, primaryKey: true }, ...timestamps],
  indexes: [], foreignKeys: [],
} as const satisfies SchemaTable;
const pivot = {
  name: "ledger_labels",
  columns: [
    { name: "ledger_key", type: "text", nullable: false, primaryKey: false, generated: true },
    { name: "label_key", type: "text", nullable: false, primaryKey: false, generated: true },
  ],
  indexes: [{ name: "ledger_labels_unique", columns: ["ledger_key", "label_key"], unique: true }],
  foreignKeys: [
    { name: "ledger_labels_ledger_fk", columns: ["ledger_key"], referencedTable: "ledger", referencedColumns: ["lookup_key"], onDelete: "cascade" },
    { name: "ledger_labels_label_fk", columns: ["label_key"], referencedTable: "labels", referencedColumns: ["label_key"], onDelete: "cascade" },
  ],
} as const satisfies SchemaTable;

describe("shared checked DML lowering", () => {
  it("preserves empty native array defaults through neutral lowering", () => {
    const input: SchemaTable = { ...labels, columns: [...labels.columns,
      { name: "channels", type: "array", nullable: false, primaryKey: false, defaultValue: [] },
      { name: "attachments", type: "array", nullable: true, primaryKey: false },
    ] };
    const before = structuredClone(input);
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema([input], "array-default")));
    expect(schema.tables[0]?.columns.find(column => column.identity.columnId === "channels"))
      .toMatchObject({ type: "jsonb", default: { kind: "emptyJsonArray" } });
    expect(schema.tables[0]?.columns.find(column => column.identity.columnId === "attachments"))
      .toMatchObject({ type: "jsonb", nullable: true, default: { kind: "none" } });
    expect(input).toEqual(before);
  });

  it("refuses unsupported array defaults in the shared compiled grammar", async () => {
    const input = (defaultValue: unknown) => ({ tables: [{ name: "messages", columns: [
      { name: "channels", type: "array", nullable: false, primaryKey: false, defaultValue },
    ], indexes: [], checks: [], foreignKeys: [], relationships: [], cascades: { delete: [], detach: [] } }] });
    expect(Result.isSuccess(await Effect.runPromise(Effect.result(decodeCompiledDml(input([])))))).toBe(true);
    for (const value of [null, {}, ["feed"], "[]", false])
      expect(Result.isFailure(await Effect.runPromise(Effect.result(decodeCompiledDml(input(value)))))).toBe(true);
  });

  it("lowers renamed natural keys, exact numeric companions and scalar defaults without module names", () => {
    const input = [ledger, labels, pivot];
    const before = structuredClone(input);
    const lowered = lowerDmlSchema(input, "ledger");
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowered));
    const table = schema.tables.find(table => table.identity.tableId === "ledger");
    expect(table?.columns.find(column => column.identity.columnId === "amount")).toMatchObject({
      type: "numeric", default: { kind: "exactNumericLiteral", value: "9007199254740993.125" },
    });
    expect(table?.columns.find(column => column.identity.columnId === "amount_data")).toMatchObject({
      type: "jsonb", default: { kind: "exactNumericRawLiteral", value: "9007199254740993.125", precision: 20 },
      origin: { kind: "derived", sourceId: "ledger.amount_data" },
    });
    expect(table?.columns.find(column => column.identity.columnId === "quantity")).toMatchObject({ type: "integer", default: { kind: "integerLiteral", value: 0 } });
    expect(table?.columns.find(column => column.identity.columnId === "enabled")).toMatchObject({ type: "boolean", default: { kind: "booleanLiteral", value: false } });
    expect(table?.columns.find(column => column.identity.columnId === "state")).toMatchObject({ type: "text", default: { kind: "textLiteral", value: "open" } });
    expect(table?.columns.find(column => column.identity.columnId === "created_at")).toMatchObject({ type: "timestamptz", default: { kind: "currentTimestamp" }, origin: { kind: "implicit" } });
    expect(table?.columns.find(column => column.identity.columnId === "deleted_at")).toMatchObject({ nullable: true, default: { kind: "none" } });
    expect(table?.keys).toMatchObject([
      { kind: "primary", columns: [{ columnId: "lookup_key" }] },
      { kind: "unique", columns: [{ columnId: "lookup_key" }] },
    ]);
    expect(table?.indexes.find(index => index.identity.indexId === "ledger_active_unique")).toMatchObject({
      kind: "uniqueBtree", predicate: { kind: "isNull", column: { columnId: "deleted_at" } },
    });
    expect(table?.constraints).toMatchObject([{ kind: "textSet", values: ["closed", "open"] }]);
    expect(lowered.capabilities.filter(capability => capability.kind === "exactNumericCompanion")).toEqual([
      { capabilityId: "ledger.amount", kind: "exactNumericCompanion", numericColumn: { tableId: "ledger", columnId: "amount" }, rawColumn: { tableId: "ledger", columnId: "amount_data" }, origin: { kind: "derived", sourceId: "dml.big-number.companion" } },
      { capabilityId: "ledger.discount", kind: "exactNumericCompanion", numericColumn: { tableId: "ledger", columnId: "discount" }, rawColumn: { tableId: "ledger", columnId: "discount_data" }, origin: { kind: "derived", sourceId: "dml.big-number.companion" } },
    ]);
    expect(lowered.capabilities.find(capability => capability.kind === "searchableText")).toMatchObject({
      columns: [{ tableId: "ledger", columnId: "lookup_key" }],
    });
    expect(Result.getOrThrow(compileLogicalSourceSearches({
      key: "ledger", owner: "medusa", evidence: null, sourceSha256: "0".repeat(64), writeProfile: "ledger",
      definition: { kind: "relational", schema }, bindings: [],
    }))).toMatchObject([{ localName: "ledger", descriptor: "search/ledger.searchable", columns: ["lookup_key"] }]);
    expect(input).toEqual(before);
  });

  it("keeps implicit pivots identity-free and retains foreign key tuple order", () => {
    const lowered = lowerDmlSchema([pivot], "ledger");
    expect(lowered.capabilities).toEqual([]);
    expect(lowered.tables[0]).toMatchObject({
      origin: { kind: "implicit", sourceId: "ledger_labels" },
      keys: [{ keyId: "ledger_labels_unique", kind: "unique", columns: ["ledger_key", "label_key"], origin: { kind: "implicit" } }],
      indexes: [],
      relationships: [
        { kind: "manyToOne", foreignKeyConstraintId: "ledger_labels_ledger_fk" },
        { kind: "manyToOne", foreignKeyConstraintId: "ledger_labels_label_fk" },
      ],
    });
    const composite = lowerDmlSchema([{ ...pivot, foreignKeys: [{
      name: "composite_fk", columns: ["label_key", "ledger_key"], referencedTable: "other",
      referencedColumns: ["second", "first"],
    }] }], "ledger");
    expect(composite.tables[0]?.constraints).toEqual([{
      constraintId: "composite_fk", kind: "foreignKey", sourceColumns: ["label_key", "ledger_key"],
      targetColumns: [{ tableId: "other", columnId: "second" }, { tableId: "other", columnId: "first" }],
      onDelete: "noAction", onUpdate: "noAction", origin: { kind: "derived", sourceId: "composite_fk" },
    }]);
  });

  it("leaves missing endpoints and invalid defaults to relational normalization", () => {
    expect(Result.isFailure(normalizeRelationalSchema(lowerDmlSchema([pivot], "ledger")))).toBe(true);
    const invalid = { ...ledger, columns: ledger.columns.map(column => column.type === "enum" && column.name === "state" ? { ...column, defaultValue: "missing" } : column) };
    expect(Result.isFailure(normalizeRelationalSchema(lowerDmlSchema([invalid], "ledger")))).toBe(true);
    const missingRaw = { ...ledger, exactNumbers: [{ capabilityId: "ledger.amount", numericColumn: "amount", rawColumn: "absent" }] };
    expect(Result.isFailure(normalizeRelationalSchema(lowerDmlSchema([missingRaw], "ledger")))).toBe(true);
  });

  it("refuses an unsupported native index method instead of admitting it as B-tree", () => {
    for (const unique of [false, true]) {
      const withGin = { ...ledger, indexes: [...ledger.indexes,
        { name: "ledger_key_gin", columns: ["lookup_key"], unique, type: "gin" }] };
      const lowered = lowerDmlSchema([withGin], "ledger");
      expect(lowered.tables[0]?.indexes.find(index => index.indexId === "ledger_key_gin"))
        .toMatchObject({ kind: "gin", columns: ["lookup_key"] });
      expect(lowered.tables[0]?.keys.some(key => key.keyId === "ledger_key_gin")).toBe(false);
      expect(Result.isFailure(normalizeRelationalSchema(lowered))).toBe(true);
    }
  });

  it("admits the supported nonunique JSON GIN declaration while refusing unique GIN", () => {
    for (const unique of [false, true]) {
      const withGin = { ...ledger, indexes: [...ledger.indexes,
        { name: "ledger_amount_data_gin", columns: ["amount_data"], unique, type: "gin" }] };
      const lowered = lowerDmlSchema([withGin], "ledger");
      expect(lowered.tables[0]?.indexes.find(index => index.indexId === "ledger_amount_data_gin"))
        .toMatchObject({ kind: unique ? "gin" : "jsonContainment", columns: ["amount_data"] });
      expect(Result.isSuccess(normalizeRelationalSchema(lowered))).toBe(!unique);
    }
  });

  it("keeps provenance instance-local and canonical output independent of enumeration order", () => {
    const normal = lowerDmlSchema([ledger, labels, pivot], "ledger");
    const overridden = lowerDmlSchema([ledger], "ledger", {
      ...dmlSchemaOrigins,
      table: () => ({ kind: "authored", sourceId: "fixture/models/ledger" }),
      primaryKey: () => ({ kind: "authored", sourceId: "fixture/ledger.lookup_key" }),
    });
    expect(overridden.tables[0]?.origin.sourceId).toBe("fixture/models/ledger");
    expect(overridden.tables[0]?.keys[0]?.origin.sourceId).toBe("fixture/ledger.lookup_key");
    expect(lowerDmlSchema([ledger, labels, pivot], "ledger")).toEqual(normal);
    const reversed = [pivot, labels, ledger].map(table => ({
      ...table, columns: [...table.columns].reverse(), indexes: [...table.indexes].reverse(), foreignKeys: [...table.foreignKeys].reverse(),
    }));
    expect(Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(reversed, "ledger")))).toEqual(
      Result.getOrThrow(normalizeRelationalSchema(normal)),
    );
  });
});
