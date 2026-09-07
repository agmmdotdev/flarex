import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { currencyWriteRows, serializeCurrency } from "../src/currency-values";
import { currencyDto, currencyDtos, currencyCountResult } from "../src/currency-result";
import type { CommerceTransactionError, Json } from "@flarex/persistence-postgres/internal/commerce-values";

const outcome = <Value>(result: Result.Result<Value, CommerceTransactionError>) => Result.match(result, {
  onSuccess: value => ({ value }), onFailure: error => ({ reason: error.reason }),
});
const run = <Value>(effect: Effect.Effect<Value, CommerceTransactionError>) =>
  Effect.runPromise(effect.pipe(Effect.result, Effect.map(outcome)));

describe("Currency value decoding", () => {
  it("normalizes code and keeps Medusa's exact numeric companion without mutating input", async () => {
    const input = [{ code: "USD", rounding: "0.125", name: undefined }];
    const rows = await Effect.runPromise(currencyWriteRows(input));
    expect(rows).toEqual([{ code: "usd", rounding: "0.12500000000000000000", raw_rounding: { value: "0.12500000000000000000", precision: 20 } }]);
    expect(input).toEqual([{ code: "USD", rounding: "0.125", name: undefined }]);
    expect(await Effect.runPromise(serializeCurrency(rows))).toEqual([
      { ...rows[0], rounding: 0.125 },
    ]);
  });

  it("preserves empty batches and leaves ordinary column validation to persistence", async () => {
    expect(await run(currencyWriteRows([]))).toEqual({ value: [] });
    expect(await run(currencyWriteRows([{ code: "X", name: null, decimal_digits: "2" }]))).toEqual({ value: [{ code: "x", name: null, decimal_digits: "2" }] });
    expect(await run(currencyWriteRows(Array.from({ length: 256 }, () => ({ code: "x" }))))).toHaveProperty("value");
  });

  it.each([
    null, {}, [null], [{}], [{ code: "" }], [{ code: "x".repeat(257) }],
    [{ code: "usd", raw_rounding: {} }], [{ code: "usd", rounding: null }],
    [{ code: "usd", rounding: {} }], [{ code: "usd", rounding: "NaN" }],
    [{ code: "usd", rounding: "Infinity" }], [{ code: "usd", rounding: "1e999" }],
    Array.from({ length: 257 }, () => ({ code: "x" })),
  ])("refuses malformed write input %#", async input => {
    expect(await run(currencyWriteRows(input))).toEqual({ reason: "invalidInput" });
  });

  it("rejects getters without invoking them", async () => {
    let reads = 0;
    const input = { code: "usd", get rounding() { reads += 1; return 1; } };
    expect(await run(currencyWriteRows([input]))).toEqual({ reason: "invalidInput" });
    expect(await run(serializeCurrency(input))).toEqual({ reason: "invalidInput" });
    expect(reads).toBe(0);
  });

  it("preserves selected projections, row cardinality and raw metadata", async () => {
    expect(await run(serializeCurrency([]))).toEqual({ value: [] });
    expect(await run(serializeCurrency({ code: "usd" }))).toEqual({ value: { code: "usd" } });
    expect(await run(serializeCurrency({ raw_rounding: null }))).toEqual({ value: { raw_rounding: null } });
    const raw = { value: "1.25", precision: 20, source: "preserved" };
    expect(await run(serializeCurrency({ rounding: "1.2500", raw_rounding: raw }))).toEqual({ value: { rounding: 1.25, raw_rounding: raw } });
  });

  it.each([
    null, 1, { extra: true }, { rounding: null }, { rounding: 1 },
    { rounding: 1, raw_rounding: { value: "1", precision: 0 } },
    { rounding: 1, raw_rounding: { value: "1", precision: 101 } },
    { rounding: 1, raw_rounding: { value: "1", precision: 1.5 } },
    { rounding: 1, raw_rounding: { value: 1, precision: 20 } },
    { rounding: 1, raw_rounding: { value: "2", precision: 20 } },
    { rounding: "NaN", raw_rounding: { value: "NaN", precision: 20 } },
    { rounding: "1e999", raw_rounding: { value: "1e999", precision: 20 } },
  ])("refuses corrupted stored values %#", async input => {
    expect(await run(serializeCurrency(input))).toEqual({ reason: "storedCorruption" });
  });

  it("compares exact decimals before returning Medusa's number representation", async () => {
    expect(await run(serializeCurrency({ rounding: "9007199254740993", raw_rounding: { value: "9007199254740992", precision: 20 } }))).toEqual({ reason: "storedCorruption" });
    expect(await run(serializeCurrency({ rounding: "0.00000001", raw_rounding: { value: "0.00000001", precision: 20 } }))).toEqual({ value: { rounding: 0, raw_rounding: { value: "0.00000001", precision: 20 } } });
  });
});

describe("Currency service result decoding", () => {
  it("preserves selected DTOs, extra serialized columns and list/count shape", () => {
    const row = { code: "usd", rounding: 0.125, raw_rounding: { value: "0.125", precision: 20 } };
    expect(outcome(currencyDto(row))).toEqual({ value: row });
    expect(outcome(currencyDtos([{}, row]))).toEqual({ value: [{}, row] });
    expect(outcome(currencyCountResult([[row], 5]))).toEqual({ value: [[row], 5] });
  });

  it.each<Json>([null, [], { code: 1 }, { symbol: null }, { symbol_native: false }, { name: [] }])("rejects malformed DTO projections %#", value => {
    expect(outcome(currencyDto(value))).toEqual({ reason: "storedCorruption" });
    expect(outcome(currencyDtos([value]))).toEqual({ reason: "storedCorruption" });
  });

  it.each<Json>([{}, [], [[]], [[], "1"], [[], 1, 2], [{}, 1], [[{ name: null }], 1]])("rejects malformed list/count tuples %#", value => {
    expect(outcome(currencyCountResult(value))).toEqual({ reason: "storedCorruption" });
  });
});
