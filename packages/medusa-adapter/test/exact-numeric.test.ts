import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { model } from "@medusajs/utils/dml/model";
import {
  normalizeRelationalSchema,
} from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";
import { captureExactNumericUpdatePair, decodeExactNumeric, encodeExactNumeric, projectExactNumericColumns } from "../src/value/exact-numeric";
import { MathBN } from "@medusajs/framework/utils/portable";

const Ledger = model.define("NumericLedger", {
  id: model.id().primaryKey(), amount: model.bigNumber(), quantity: model.bigNumber().nullable(),
});
const compiled = () => JSON.parse(JSON.stringify(compileDmlSchema([Ledger]))) as unknown;

describe("exact numeric companion admission", () => {
  it("encodes native MathBN results without a number round trip", async () => {
    expect(await Effect.runPromise(encodeExactNumeric(MathBN.add("9007199254740993", "0.125"))))
      .toMatchObject({ value: "9007199254740993.1250", raw: { value: "9007199254740993.1250", precision: 20 } });
  });
  it("captures native numeric update pairs without executing accessors", async () => {
    let executed = false;
    const pair = { entity: { id: "row" }, get update() { executed = true; return { quantity: 1 }; } };
    await expect(Effect.runPromise(captureExactNumericUpdatePair(pair, [{ name: "quantity" }]))).rejects.toMatchObject({ reason: "invalidInput" });
    expect(executed).toBe(false);
  });
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

  it("selects genuine native ORM raw presentation without rewriting storage or arbitrary JSON", async () => {
    const encoded = await Effect.runPromise(encodeExactNumeric("9007199254740993.1250"));
    const stored = { amount: encoded.value, raw_amount: encoded.raw,
      raw_other: { value: "1.2300", precision: 20 }, metadata: { raw_amount: { value: "2.0000", precision: 20 } } };
    const original = structuredClone(stored), columns = [{ name: "amount" }];
    const presented = await Effect.runPromise(projectExactNumericColumns(stored, columns, "nativeOrm"));
    expect(presented).toEqual({ amount: 9007199254740994, raw_amount: { value: "9007199254740993.125", precision: 20 },
      raw_other: stored.raw_other, metadata: stored.metadata });
    expect(await Effect.runPromise(projectExactNumericColumns(presented, columns, "nativeOrm"))).toEqual(presented);
    expect(await Effect.runPromise(projectExactNumericColumns(stored, columns, "reserialize")))
      .toMatchObject({ amount: 9007199254740994, raw_amount: { value: "9007199254740993.1250", precision: 20 } });
    expect(await Effect.runPromise(projectExactNumericColumns(stored, columns, "exact"))).toEqual(stored);
    expect(await Effect.runPromise(projectExactNumericColumns({ metadata: stored.metadata }, columns, "nativeOrm"))).toEqual({ metadata: stored.metadata });
    expect(await Effect.runPromise(projectExactNumericColumns({ raw_amount: stored.raw_amount, metadata: stored.metadata }, columns, "nativeOrm")))
      .toEqual({ raw_amount: { value: "9007199254740993.125", precision: 20 }, metadata: stored.metadata });
    expect(stored).toEqual(original);
  });

  it.each([
    ["1.0000000000000000000", "1"], ["-0.0000000000000000000", "-0"], ["1.2300000000000000000e+25", "1.23e+25"],
  ])("uses the existing native normalizer for %s", async (value, expected) => {
    expect(await Effect.runPromise(projectExactNumericColumns({ amount: value, raw_amount: { value, precision: 20 } }, [{ name: "amount" }], "nativeOrm")))
      .toMatchObject({ raw_amount: { value: expected, precision: 20 } });
  });

  it("preserves nullable companions and refuses tampering before native presentation", async () => {
    expect(await Effect.runPromise(projectExactNumericColumns({ amount: null, raw_amount: null }, [{ name: "amount", nullable: true }], "nativeOrm")))
      .toEqual({ amount: null, raw_amount: null });
    expect(await Effect.runPromise(projectExactNumericColumns({ raw_amount: null }, [{ name: "amount", nullable: true }], "nativeOrm")))
      .toEqual({ raw_amount: null });
    for (const raw_amount of [null, { value: "Infinity", precision: 20 }, { value: "1.0000", precision: 0 }])
      expect(await Effect.runPromise(Effect.result(projectExactNumericColumns({ raw_amount }, [{ name: "amount" }], "nativeOrm"))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    for (const value of [
      { amount: "1", raw_amount: { value: "2.0000", precision: 20 } },
      { amount: 2, raw_amount: { value: "1.0000", precision: 20 } },
      { amount: "1", raw_amount: { value: "1.0000", precision: 0 } },
      { amount: "1", raw_amount: null },
    ]) expect(await Effect.runPromise(Effect.result(projectExactNumericColumns(value, [{ name: "amount" }], "nativeOrm"))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
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
