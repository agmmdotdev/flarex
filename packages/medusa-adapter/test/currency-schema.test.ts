import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { Currency } from "@medusajs/currency/models";
import { model } from "@medusajs/utils/dml/model";
import { normalizeRelationalSchema, captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { captureCurrencySchema, currencySourceProvenance, translateCurrencySchema } from "../src/currency-schema";
import expectedInput from "./currency-input.json";

describe("actual Currency DML compatibility", () => {
  it("matches the existing Flarex Currency value contract and canonical artifact", async () => {
    const expected = Result.getOrThrow(normalizeRelationalSchema(expectedInput));
    expect(await Effect.runPromise(translateCurrencySchema(Currency))).toEqual(expected);
    const actual = await Effect.runPromise(captureCurrencySchema("medusa-comparison", Currency));
    const artifact = await Effect.runPromise(captureRelationalSchemaArtifact({
      deploymentId: "medusa-comparison", provenance: currencySourceProvenance, schema: expectedInput,
    }));
    expect(actual).toEqual(artifact);
    expect(await Effect.runPromise(captureCurrencySchema("medusa-comparison", Currency))).toEqual(actual);
  });

  it("is independent of schema property enumeration order", async () => {
    const reversed = { parse() {
      const parsed = Currency.parse();
      return { ...parsed, schema: Object.fromEntries(Object.entries(parsed.schema).reverse()) };
    } };
    expect(await Effect.runPromise(captureCurrencySchema("medusa-comparison", reversed)))
      .toEqual(await Effect.runPromise(captureCurrencySchema("medusa-comparison", Currency)));
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
