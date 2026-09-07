import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { decodeCurrencyQuery } from "../src/currency-query";
import { currencyColumns } from "../src/currency-query-model";
import { decodeProductQuery } from "../src/product-query-profile";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/product-runtime-metadata";
import type { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

const outcome = <Value>(result: Result.Result<Value, CommerceTransactionError>) => Result.match(result, {
  onSuccess: value => ({ value }), onFailure: error => ({ reason: error.reason }),
});

describe("Schema-decoded Medusa query profiles", () => {
  let catalog: ProductRuntimeMetadata;
  beforeAll(async () => {
    catalog = await Effect.runPromise(captureProductSchema("query-profile-test").pipe(
      Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame)),
    ));
  });

  it("preserves distinct defaults, nullish defaults and zero-sized pages", async () => {
    expect(outcome(decodeCurrencyQuery({ where: null, options: null }))).toEqual({ value: {
      predicate: { kind: "and", children: [] }, fields: currencyColumns,
      skip: 0, take: 256, order: "asc", withDeleted: false,
    } });
    const product = await Effect.runPromise(decodeProductQuery(catalog, { where: null, options: null }));
    expect(product.query).toMatchObject({ skip: 0, take: 15, order: { column: "id", direction: "asc" } });
    expect(await Effect.runPromise(decodeProductQuery(catalog, { options: { limit: 0, offset: 255 } })))
      .toMatchObject({ query: { skip: 255, take: 0 } });
    expect(outcome(decodeCurrencyQuery({ options: { limit: 0, offset: 255 } })))
      .toMatchObject({ value: { skip: 255, take: 0 } });
  });

  it("retains Currency raw numeric projection and supported soft-delete ordering", () => {
    const result = decodeCurrencyQuery({
      where: { code: { $in: ["usd", "usd"] } },
      options: { fields: ["rounding"], orderBy: { code: "desc" }, filters: { softDeletable: { withDeleted: true } } },
    });
    expect(outcome(result)).toEqual({ value: {
      predicate: { kind: "and", children: [{ kind: "codes", values: ["usd", "usd"] }] },
      fields: ["rounding", "raw_rounding"], skip: 0, take: 256, order: "desc", withDeleted: true,
    } });
    expect(Result.match(result, { onFailure: () => false, onSuccess: value =>
      Object.isFrozen(value) && Object.isFrozen(value.fields) && value.predicate.kind === "and" && Object.isFrozen(value.predicate.children) })).toBe(true);
  });

  it.each([
    [{ extra: true }, "invalidInput"],
    [{ options: { extra: true } }, "unsupportedProfile"],
    [{ options: { fields: null } }, "invalidInput"],
    [{ options: { fields: [] } }, "invalidInput"],
    [{ options: { fields: ["code", "code"] } }, "unsupportedProfile"],
    [{ options: { fields: ["unknown"] } }, "unsupportedProfile"],
    [{ options: { fields: [], limit: -1 } }, "invalidInput"],
    [{ options: { populate: null } }, "unsupportedProfile"],
    [{ options: { limit: 257 } }, "limitExceeded"],
    [{ options: { offset: 0.5 } }, "limitExceeded"],
    [{ options: { orderBy: {} } }, "unsupportedProfile"],
    [{ options: { filters: { softDeletable: { withDeleted: true, extra: true } } } }, "unsupportedProfile"],
    [{ where: { code: { $in: ["usd"], extra: true } } }, "invalidInput"],
    [{ where: { code: "a\0b" } }, "invalidInput"],
    [{ where: { code: "x".repeat(257) } }, "invalidInput"],
    [{ where: { unknown: 1 } }, "unsupportedProfile"],
    [{ where: { $and: null } }, "invalidInput"],
  ])("preserves Currency refusal for %j", (input, reason) => {
    expect(outcome(decodeCurrencyQuery(input))).toEqual({ reason });
  });

  it.each([
    [{ extra: true }, "unsupportedProfile"],
    [{ where: [] }, "unsupportedProfile"],
    [{ options: { orderBy: { images: { rank: "ASC", extra: true } } } }, "unsupportedProfile"],
    [{ options: { orderBy: { id: "ASC", handle: "DESC" } } }, "unsupportedProfile"],
    [{ options: { fields: [], limit: -1 } }, "unsupportedProfile"],
    [{ options: { limit: -1 }, where: { unknown: 1 } }, "limitExceeded"],
    [{ where: { id: { $in: ["p"] } } }, "invalidInput"],
    [{ where: { id: Array(257).fill("p") } }, "invalidInput"],
    [{ where: { id: 3, unknown: true } }, "invalidInput"],
    [{ where: { unknown: true, id: 3 } }, "unsupportedProfile"],
  ])("preserves Product refusal and field order for %j", async (input, reason) => {
    expect(outcome(await Effect.runPromise(Effect.result(decodeProductQuery(catalog, input))))).toEqual({ reason });
  });

  it("enforces cumulative Currency budgets before decoding the next node or operand", () => {
    expect(outcome(decodeCurrencyQuery({ where: { $and: Array(63).fill({}) } }))).toHaveProperty("value");
    expect(outcome(decodeCurrencyQuery({ where: { $and: Array(64).fill({}) } }))).toEqual({ reason: "limitExceeded" });
    expect(outcome(decodeCurrencyQuery({ where: { $and: Array(65).fill({}) } }))).toEqual({ reason: "invalidInput" });
    let nested: unknown = { unknown: true };
    for (let i = 0; i < 9; i++) nested = { $and: [nested] };
    expect(outcome(decodeCurrencyQuery({ where: nested }))).toEqual({ reason: "limitExceeded" });
    expect(outcome(decodeCurrencyQuery({ where: { code: Array(256).fill("usd"), $and: [{ code: 3 }] } })))
      .toEqual({ reason: "limitExceeded" });
    expect(outcome(decodeCurrencyQuery({ where: { $and: [{ code: 3 }], code: Array(256).fill("usd") } })))
      .toEqual({ reason: "invalidInput" });
  });

  it("retains input capture without invoking getters and omits Medusa's undefined members", async () => {
    let calls = 0;
    const input = { get options() { calls++; return {}; } };
    expect(outcome(decodeCurrencyQuery(input))).toEqual({ reason: "invalidInput" });
    expect(outcome(await Effect.runPromise(Effect.result(decodeProductQuery(catalog, input))))).toEqual({ reason: "invalidInput" });
    expect(calls).toBe(0);
    expect(outcome(decodeCurrencyQuery({ options: { fields: undefined } }))).toHaveProperty("value");
  });
});
