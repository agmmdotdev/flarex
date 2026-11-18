import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { model } from "@medusajs/framework/utils/portable";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { orderModuleModels } from "@medusajs/order/static-manifest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { compileLogicalSourceIndexes, compileLogicalSourceUniqueConstraints } from "flarex-protocol/internal/logical-storage-requirements";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";
import { compileCompleteRow, compileRowProjection } from "../src/value/complete-row";

const ledger = model.define("serial_preservation_ledger", {
  id: model.id().primaryKey(),
  ticket_number: model.autoincrement(),
});
const checkedLedger = () => Effect.runPromise(decodeCompiledDml(
  JSON.parse(JSON.stringify(compileDmlSchema([ledger]))),
));

describe("native serial value preservation", () => {
  it("lowers neutral serial metadata to signed integer storage without allocation", async () => {
    const checked = await checkedLedger();
    const before = structuredClone(checked);
    const lowered = lowerDmlSchema(checked.tables, "serial-preservation");
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowered));
    expect(schema.tables[0]?.columns.find(column => column.identity.columnId === "ticket_number"))
      .toMatchObject({ type: "integer", nullable: false, default: { kind: "none" } });
    expect(checked).toEqual(before);
  });

  it("preserves complete genuine Order metadata and lowers existing serial display IDs", async () => {
    const native = compileDmlSchema(orderModuleModels);
    const order = native.tables.find(table => table.name === "order");
    if (order === undefined) throw new Error("Native Order metadata missing");
    expect(native.tables).toHaveLength(23);
    expect(order.columns.find(column => column.name === "display_id"))
      .toEqual({ name: "display_id", type: "serial", nullable: false, primaryKey: false, options: { searchable: true } });
    expect(order.indexes).toContainEqual(expect.objectContaining({ where: "deleted_at IS NOT NULL" }));
    const checked = await Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(native))));
    expect(checked).toEqual(JSON.parse(JSON.stringify(native)));
    const lowered = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(checked.tables, "native-order-preservation")));
    expect(lowered.tables.find(table => table.identity.tableId === "order")?.columns
      .find(column => column.identity.columnId === "display_id"))
      .toMatchObject({ type: "integer", default: { kind: "none" } });
    const source = { key: "medusa.native-order-preservation", owner: "medusa" as const, evidence: null,
      sourceSha256: "a".repeat(64), writeProfile: "order-preservation", bindings: [],
      definition: { kind: "relational" as const, schema: lowered } };
    const indexes = Result.getOrThrow(compileLogicalSourceIndexes(source));
    expect(indexes.filter(index => index.physicalSpec.predicate?.kind === "fieldIsNotNull" ||
      index.physicalSpec.predicate?.kind === "fieldIsNullAndNotNull")).toHaveLength(34);
    expect(Result.isSuccess(compileLogicalSourceUniqueConstraints(source))).toBe(true);
  });

  it("validates exact signed int32 values without coercion for complete rows and preimages", async () => {
    const checked = await checkedLedger(), table = checked.tables[0];
    if (table === undefined) throw new Error("Neutral serial metadata missing");
    const complete = Result.getOrThrow(compileCompleteRow(table));
    const projection = Result.getOrThrow(compileRowProjection(table));
    const row = { id: "ledger-existing", ticket_number: 1,
      created_at: "2026-10-23T00:00:00.000Z", updated_at: "2026-10-23T00:00:00.000Z", deleted_at: null };
    for (const ticket_number of [-2147483648, -1, 0, 1, 2147483647]) {
      expect(Result.getOrThrow(complete({ ...row, ticket_number })).ticket_number).toBe(ticket_number);
      expect(Result.getOrThrow(projection({ ticket_number })).ticket_number).toBe(ticket_number);
    }
    for (const ticket_number of [-2147483649, 2147483648, 1.5, NaN, Infinity, -Infinity, "1", null, true, {}, []]) {
      expect(complete({ ...row, ticket_number })).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      expect(projection({ ticket_number })).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    }
    expect(Result.isFailure(complete({ ...row, ticket_number: undefined }))).toBe(true);
    expect(Result.getOrThrow(projection({ id: row.id }))).toEqual({ id: row.id });
  });

  it("refuses serial defaults and generated-value metadata", async () => {
    const checked = await checkedLedger();
    const input = (extra: object) => ({ tables: checked.tables.map(table => ({ ...table,
      columns: table.columns.map(column => column.type === "serial" ? { ...column, ...extra } : column),
    })) });
    for (const defaultValue of [0, 1, "1", null, false, {}, []])
      expect(Result.isFailure(await Effect.runPromise(Effect.result(decodeCompiledDml(input({ defaultValue })))))).toBe(true);
    expect(Result.isFailure(await Effect.runPromise(Effect.result(decodeCompiledDml(input({ generated: true })))))).toBe(true);
  });
});
