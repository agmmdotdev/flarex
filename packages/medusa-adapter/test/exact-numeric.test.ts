import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { model } from "@medusajs/utils/dml/model";
import { normalizeRelationalSchema } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";
import { decodeExactNumeric, encodeExactNumeric } from "../src/exact-numeric";

const Ledger = model.define("NumericLedger", {
  id: model.id().primaryKey(), amount: model.bigNumber(), quantity: model.bigNumber().nullable(),
});
const compiled = () => JSON.parse(JSON.stringify(compileDmlSchema([Ledger]))) as unknown;

describe("exact numeric companion admission", () => {
  it("derives required and optional companions from actual native compiler metadata without defaults", async () => {
    const checked = await Effect.runPromise(decodeCompiledDml(compiled()));
    const lowered = lowerDmlSchema(checked.tables, "numeric-ledger");
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowered));
    expect(schema.capabilities.filter(value => value.kind === "exactNumericCompanion")).toHaveLength(2);
    expect(lowered.tables[0]?.columns.filter(column => ["amount", "raw_amount", "quantity", "raw_quantity"].includes(column.columnId)))
      .toMatchObject([
        { columnId: "amount", nullable: false, default: { kind: "none" } },
        { columnId: "quantity", nullable: true, default: { kind: "none" } },
        { columnId: "raw_amount", nullable: false, default: { kind: "none" } },
        { columnId: "raw_quantity", nullable: true, default: { kind: "none" } },
      ]);
  });

  it("normalizes nullable null defaults to absence without inventing a literal", async () => {
    const input = compileDmlSchema([Ledger]);
    for (const column of input.tables[0]?.columns ?? []) {
      if (["quantity", "raw_quantity"].includes(column.name)) column.defaultValue = null;
    }
    const checked = await Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(input))));
    expect(Result.isSuccess(normalizeRelationalSchema(lowerDmlSchema(checked.tables, "numeric-ledger")))).toBe(true);
  });

  it.each(["missing", "authored", "wrong-type", "duplicate", "required-null"])("rejects %s companion metadata", async mode => {
    const input = compileDmlSchema([Ledger]);
    const table = input.tables[0];
    const raw = table?.columns.find(column => column.name === "raw_amount");
    const amount = table?.columns.find(column => column.name === "amount");
    if (!table || !raw || !amount) throw new Error("Missing native numeric fixture");
    if (mode === "missing") table.columns = table.columns.filter(column => column !== raw);
    if (mode === "authored") raw.generated = false;
    if (mode === "wrong-type") raw.type = "text";
    if (mode === "duplicate") table.columns.push({ ...raw });
    if (mode === "required-null") amount.defaultValue = null;
    expect(await Effect.runPromise(Effect.result(decodeCompiledDml(JSON.parse(JSON.stringify(input)))))).toMatchObject({ _tag: "Failure" });
  });

  it("preserves native exact raw text through writes and verifies stored equality", async () => {
    const encoded = await Effect.runPromise(encodeExactNumeric("9007199254740993.125"));
    expect(encoded.value).toBe("9007199254740993.1250");
    expect(encoded.raw.value).toBe(encoded.value);
    expect(await Effect.runPromise(decodeExactNumeric("9007199254740993.125", encoded.raw))).toBe(Number("9007199254740993.125"));
    expect(await Effect.runPromise(decodeExactNumeric(null, null, true))).toBeNull();
  });

  it.each([undefined, null, "NaN", "Infinity", Infinity, {}, { value: "1", precision: 20 }])("rejects invalid or caller raw write input %j", async input => {
    expect(await Effect.runPromise(Effect.result(encodeExactNumeric(input)))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it.each([
    [undefined, undefined], [null, null], ["1", null], [null, { value: "1", precision: 20 }],
    ["1", { value: "2", precision: 20 }], ["1", { value: "1", precision: 0 }],
    ["NaN", { value: "NaN", precision: 20 }], ["1", undefined],
  ])("rejects corrupt required pair %j / %j", async (value, raw) => {
    expect(await Effect.runPromise(Effect.result(decodeExactNumeric(value, raw)))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });
});
