import { describe, expect, it } from "vitest";
import { Result, Schema } from "effect";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder, commerceRowDecoder } from "../src/commerce-decoder";
import { compileKeyedUpdates } from "../src/write/keyed";
import { currencyUpdateRows } from "../src/currency-input";

const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({
  entity: Schema.Struct({ sku: Schema.String }),
  update: Schema.JsonObject,
})), "invalidInput");
const data = commerceRowDecoder(["title", "metadata", "children", "optional"], "unsupportedProfile");
const renamed = (repeatedKeys: "preserve" | "reject") => compileKeyedUpdates({
  keyColumn: "sku", repeatedKeys, decodeEntries: decodePairs,
  readEntry: pair => Result.succeed({ key: pair.entity.sku, update: pair.update }),
  validateData: data,
});

describe("shared keyed update planning", () => {
  it("uses a renamed key and preserves omitted, null, empty and metadata values", () => {
    const updates = renamed("reject");
    const input = [
      { entity: { sku: "first" }, update: { title: "new", children: [], metadata: { keep: null }, optional: null, sku: "first" } },
      { entity: { sku: "second" }, update: {} },
    ];
    const before = structuredClone(input);
    const rows = Result.getOrThrow(updates(input));
    expect(rows).toEqual([
      { title: "new", children: [], metadata: { keep: null }, optional: null, sku: "first" },
      { sku: "second" },
    ]);
    expect(Object.keys(rows[0] ?? {})).toEqual(["title", "children", "metadata", "optional", "sku"]);
    expect(input).toEqual(before);
    expect(rows[0]).not.toBe(input[0]?.update);
  });

  it("rejects moved keys and undeclared data while admitting an unchanged key", () => {
    const updates = renamed("reject");
    expect(updates([{ entity: { sku: "first" }, update: { sku: "other", unknown: 1 } }]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(updates([{ entity: { sku: "first" }, update: { sku: "first", unknown: 1 } }]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(Result.getOrThrow(updates([{ entity: { sku: "first" }, update: { sku: "first" } }]))).toEqual([{ sku: "first" }]);
  });

  it("keeps duplicate policy explicit and invocation state isolated", () => {
    const input = [{ entity: { sku: "a" }, update: { title: "first" } }, { entity: { sku: "a" }, update: { title: "last" } }];
    const strict = renamed("reject");
    expect(strict(input)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(Result.getOrThrow(renamed("preserve")(input))).toEqual([{ title: "first", sku: "a" }, { title: "last", sku: "a" }]);
    expect(Result.getOrThrow(strict([input[0] ?? {}]))).toEqual([{ title: "first", sku: "a" }]);
    expect(Result.getOrThrow(strict([input[0] ?? {}]))).toEqual([{ title: "first", sku: "a" }]);
    expect(Result.getOrThrow(strict([]))).toEqual([]);
  });

  it("short-circuits on the original data failure without evaluating later entries", () => {
    const failure = commerceError("unsupportedProfile");
    const calls: string[] = [];
    const updates = compileKeyedUpdates({
      keyColumn: "sku", repeatedKeys: "reject",
      decodeEntries: (_input: Json) => Result.succeed(["a", "b"]),
      readEntry: key => { calls.push("entry:" + key); return Result.succeed({ key, update: { title: "value" } }); },
      validateData: (_data: JsonObject) => { calls.push("data"); return Result.fail(failure); },
    });
    const result = updates([]);
    expect(result).toMatchObject({ _tag: "Failure" });
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(calls).toEqual(["entry:a", "data"]);
  });

  it("checks duplicate identities before validating the duplicate row's data", () => {
    const calls: string[] = [];
    const updates = compileKeyedUpdates({
      keyColumn: "sku", repeatedKeys: "reject",
      decodeEntries: (_input: Json) => Result.succeed(["a", "a"]),
      readEntry: key => { calls.push("entry"); return Result.succeed({ key, update: { title: "value" } }); },
      validateData: (_data: JsonObject) => { calls.push("data"); return Result.succeed(undefined); },
    });
    expect(updates([])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(calls).toEqual(["entry", "data", "entry"]);
  });

  it("treats data decoding as validation, without adopting a replacement payload", () => {
    const metadata = { keep: true };
    const supplied = { metadata, children: [] };
    const updates = compileKeyedUpdates({
      keyColumn: "sku", repeatedKeys: "reject",
      decodeEntries: (_input: Json) => Result.succeed(["a"]),
      readEntry: key => Result.succeed({ key, update: supplied }),
      validateData: (_data: JsonObject) => Result.succeed({ title: "discarded normalization" }),
    });
    const [row] = Result.getOrThrow(updates([]));
    expect(row).toEqual({ metadata: { keep: true }, children: [], sku: "a" });
    expect(row?.metadata).toBe(metadata);
    expect(supplied).toEqual({ metadata: { keep: true }, children: [] });
  });

  it("preserves batch and entry failure identity without running later stages", () => {
    const failure = commerceError("invalidInput");
    let entries = 0, validations = 0;
    const updates = compileKeyedUpdates({
      keyColumn: "sku", repeatedKeys: "reject",
      decodeEntries: (_input: Json): Result.Result<readonly string[], typeof failure> => Result.fail(failure),
      readEntry: key => { entries++; return Result.succeed({ key, update: {} }); },
      validateData: (_data: JsonObject) => { validations++; return Result.succeed(undefined); },
    });
    const result = updates([]);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    else throw new Error("Expected batch refusal");
    expect([entries, validations]).toEqual([0, 0]);
    const entryFailure = compileKeyedUpdates({
      keyColumn: "sku", repeatedKeys: "reject",
      decodeEntries: (_input: Json) => Result.succeed(["a", "b"]),
      readEntry: (_key: string) => { entries++; return Result.fail(failure); },
      validateData: (_data: JsonObject) => { validations++; return Result.succeed(undefined); },
    })([]);
    if (Result.isFailure(entryFailure)) expect(entryFailure.failure).toBe(failure);
    else throw new Error("Expected entry refusal");
    expect([entries, validations]).toEqual([1, 0]);
  });

  it("retains Currency's strict key prohibition and later scalar-validation stage", () => {
    expect(currencyUpdateRows([{ entity: { code: "USD" }, update: { code: "USD" } }]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(Result.getOrThrow(currencyUpdateRows([
      { entity: { code: "USD", name: "not copied" }, update: { name: "first" } },
      { entity: { code: "USD" }, update: { name: "second" } },
      { entity: { code: "" }, update: { created_at: "still checked at write boundary" } },
    ]))).toEqual([
      { name: "first", code: "USD" }, { name: "second", code: "USD" },
      { created_at: "still checked at write boundary", code: "" },
    ]);
    expect(Result.getOrThrow(currencyUpdateRows(Array.from({ length: 257 }, () => ({ entity: { code: "USD" }, update: {} }))))).toHaveLength(257);
  });
});
