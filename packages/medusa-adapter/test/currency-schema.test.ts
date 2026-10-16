import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { compileLogicalRelationalRead } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalQuery";
import { prepareLogicalRelationalRows } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalRows";
import { Currency } from "@medusajs/currency/models";
import { model } from "@medusajs/utils/dml/model";
import {
  normalizeRelationalSchema,
  validateRelationalRowValues,
} from "flarex-protocol/internal/relational-schema";
import { compileCurrencyDefinition, currencySourceProvenance, translateCurrencySchema } from "../src/modules/currency/schema";
import expectedInput from "./currency-input.json";
import { currencyInitialization } from "../src/modules/currency/contract";
import type { Json, JsonObject } from "flarex-protocol/json";

describe("actual Currency DML compatibility", () => {
  it("applies native defaults, transaction timestamps and exact companion consistency in generic rows", async () => {
    const schema = await Effect.runPromise(translateCurrencySchema(Currency));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing native Currency table");
    const policy = Result.getOrThrow(prepareLogicalRelationalRows(table, schema.capabilities, (reason, cause) => new Error(reason, { cause })));
    const before = "2026-09-20T00:00:00.000Z";
    const now = "2026-09-21T00:00:00.000Z";
    const row = Result.getOrThrow(policy.normalize({ code: "zzz", name: "Defaults", symbol: "Z", symbol_native: "Z" }, null, before));
    expect(row).toMatchObject({ decimal_digits: 0, rounding: "0", raw_rounding: { value: "0", precision: 20 },
      created_at: before, updated_at: before, deleted_at: null });
    expect(Result.getOrThrow(policy.normalize({ code: "zzz" }, row, now))).toMatchObject({ created_at: before, updated_at: now });
    for (const patch of [
      { updated_at: "not-a-date" }, { rounding: "1" }, { raw_rounding: { value: "1", precision: 20 } },
      { raw_rounding: { value: "0", precision: 0 } }, { raw_rounding: { value: "0" } }, { name: null }, { _id: "foreign" },
    ]) expect(policy.normalize({ code: "zzz", ...patch }, row, now)).toMatchObject({ _tag: "Failure", failure: { message: "documentInvalid" } });
    const exact = { code: "zzz", rounding: "1234567890123456.7890", raw_rounding: { value: "1234567890123456.789", precision: 20 } };
    expect(Result.getOrThrow(policy.normalize(exact, row, now))).toMatchObject(exact);
    expect(policy.validate({ ...row, extra: "hidden" }, "storedCorruption"))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  });
  it("validates complete native seeds and finite number values without accepting invalid scalar representations", async () => {
    const schema = await Effect.runPromise(translateCurrencySchema(Currency));
    const table = schema.tables[0];
    const seed = await Effect.runPromise(currencyInitialization());
    if (table === undefined || seed.rows[0] === undefined) throw new Error("Missing native Currency fixture");
    const complete = (row: JsonObject): JsonObject => ({ ...row, created_at: "2026-09-20T00:00:00.000Z",
      updated_at: "2026-09-20T00:00:00.000Z", deleted_at: null });
    for (const row of seed.rows) expect(Result.isSuccess(validateRelationalRowValues(table, complete(row)))).toBe(true);
    const row = complete(seed.rows[0]);
    for (const patch of [
      { name: null }, { decimal_digits: "1.5" }, { decimal_digits: NaN }, { decimal_digits: Infinity },
      { rounding: "NaN" }, { rounding: "1e131072" }, { rounding: "1e-16384" }, { rounding: "1\n" },
      { created_at: "not-a-date" }, { created_at: "2026-09-20T00:00:00+01:00" },
      { created_at: "0000-01-01T00:00:00.000Z" }, { created_at: "-010000-01-01T00:00:00.000Z" },
      { created_at: "+010000-01-01T00:00:00.000Z" },
      { symbol: "\ud800" }, { raw_rounding: { value: "\0" } }, { undeclared: "value" },
    ]) expect(Result.isFailure(validateRelationalRowValues(table, { ...row, ...patch }))).toBe(true);
    for (const decimal_digits of [1.5, 2147483648, -2147483649, 1e30])
      expect(Result.isSuccess(validateRelationalRowValues(table, { ...row, decimal_digits }))).toBe(true);
    const missing: Record<string, Json> = { ...row };
    delete missing.code;
    expect(validateRelationalRowValues(table, missing)).toMatchObject({ _tag: "Failure", failure: { reason: "missingColumn", column: "code" } });
    expect(Result.isSuccess(validateRelationalRowValues(table, { ...row, symbol: "😀", rounding: "12345678901234567890.001" }))).toBe(true);
    for (const created_at of ["0001-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z"])
      expect(Result.isSuccess(validateRelationalRowValues(table, { ...row, created_at }))).toBe(true);
    expect(row.rounding).toBe(seed.rows[0].rounding);
  });

  it("enforces explicit synthetic int32 and row-local checks without conflating nullable checks with required columns", () => {
    const source = expectedInput.tables[0];
    if (source === undefined) throw new Error("Missing native table input");
    const schema = Result.getOrThrow(normalizeRelationalSchema({ ...expectedInput, tables: [{ ...source,
      // This fixture explicitly owns an int32 column. Native DML number fields
      // use binary64; integerRange must keep its separate integer contract.
      columns: source.columns.map(column => column.columnId === "decimal_digits" ? { ...column, type: "integer", nullable: true,
        default: { kind: "integerLiteral", value: 0 }, origin: { kind: "synthetic", sourceId: "value-test.integer" } } : column),
      constraints: [
        { constraintId: "digits.bound", kind: "integerRange", columnId: "decimal_digits", minimum: 0, maximum: 3, origin: { kind: "synthetic", sourceId: "value-test" } },
        { constraintId: "name.set", kind: "textSet", columnId: "name", values: ["Dollar", "Euro"], origin: { kind: "synthetic", sourceId: "value-test" } },
      ],
    }] }));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing checked table");
    const row = { code: "usd", name: "Dollar", symbol: "$", symbol_native: "$", decimal_digits: 2,
      rounding: 0, raw_rounding: { value: "0", precision: 20 }, created_at: "2026-09-20T00:00:00.000Z",
      updated_at: "2026-09-20T00:00:00.000Z", deleted_at: null };
    expect(Result.isSuccess(validateRelationalRowValues(table, row))).toBe(true);
    expect(Result.isSuccess(validateRelationalRowValues(table, { ...row, decimal_digits: null }))).toBe(true);
    const projection = Result.getOrThrow(compileLogicalRelationalRead(table, schema.capabilities,
      { fields: ["code"], order: { column: "code", direction: "asc" } }, 10, (reason, cause) => new Error(reason, { cause })));
    expect(Result.isSuccess(projection.inspect(row))).toBe(true);
    for (const raw_rounding of [{ value: "1", precision: 20 }, { value: "0", precision: 0 }, { value: "0" }])
      expect(projection.inspect({ ...row, raw_rounding })).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    for (const decimal_digits of [1.5, 2147483648, -2147483649]) {
      expect(validateRelationalRowValues(table, { ...row, decimal_digits }))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidValue", column: "decimal_digits" } });
      expect(projection.inspect({ ...row, decimal_digits }))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    }
    for (const patch of [{ decimal_digits: -1 }, { decimal_digits: 4 }, { name: "Pound" }]) {
      expect(validateRelationalRowValues(table, { ...row, ...patch })).toMatchObject({ _tag: "Failure", failure: { reason: "constraintViolation" } });
      expect(projection.inspect({ ...row, ...patch })).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    }
  });
  it("matches the native Currency logical schema and source provenance", async () => {
    const expected = Result.getOrThrow(normalizeRelationalSchema(expectedInput));
    expect(await Effect.runPromise(translateCurrencySchema(Currency))).toEqual(expected);
    const compiled = await Effect.runPromise(compileCurrencyDefinition());
    expect(compiled).toEqual({ schema: expected, provenance: currencySourceProvenance });
    expect(await Effect.runPromise(compileCurrencyDefinition())).toEqual(compiled);
  });

  it("is independent of schema property enumeration order", async () => {
    const reversed = { parse() {
      const parsed = Currency.parse();
      return { ...parsed, schema: Object.fromEntries(Object.entries(parsed.schema).reverse()) };
    } };
    expect(await Effect.runPromise(translateCurrencySchema(reversed)))
      .toEqual(await Effect.runPromise(translateCurrencySchema(Currency)));
  });

  it.each([
    ["model identity", () => ({ ...Currency.parse(), name: "Product" })],
    ["table identity", () => ({ ...Currency.parse(), tableName: "another_currency" })],
    ["extra property", () => ({ ...Currency.parse(), schema: { ...Currency.parse().schema, extra: model.text() } })],
    ["missing property", () => ({ ...Currency.parse(), schema: { code: model.text() } })],
    ["number default", () => ({ ...Currency.parse(), schema: { ...Currency.parse().schema, decimal_digits: model.number().default(1) } })],
    ["searchability", () => ({ ...Currency.parse(), schema: { ...Currency.parse().schema, name: model.text() } })],
    ["nullability", () => ({ ...Currency.parse(), schema: { ...Currency.parse().schema, symbol: model.text().nullable() } })],
    ["primary key", () => ({ ...Currency.parse(), schema: { ...Currency.parse().schema, code: model.text().searchable() } })],
    ["index", () => ({ ...Currency.parse(), indexes: [{ on: ["code"] }] })],
    ["cascade", () => ({ ...Currency.parse(), cascades: { delete: ["code"] } })],
  ])("rejects an unadmitted %s", async (_name, parse) => {
    const result = await Effect.runPromise(Effect.result(translateCurrencySchema({ parse })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure._tag).toBe("CurrencySchemaError");
  });

  it("classifies a foreign parser failure", async () => {
    const result = await Effect.runPromise(Effect.result(translateCurrencySchema({ parse() { throw new Error("parse failed"); } })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure._tag).toBe("CurrencySchemaError");
  });
});
