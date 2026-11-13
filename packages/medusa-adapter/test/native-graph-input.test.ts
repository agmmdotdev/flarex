import { Result } from "effect";
import { expect, it } from "vitest";
import { joinerConfig } from "@medusajs/product/joiner-config";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeNativeGraphOptions, prepareNativeGraphInput } from "../src/local-graph/native-input";

const metadata = { servicesConfig: [joinerConfig], entitiesMap: new Map(), entityRelations: new Map() };
const admit = (name: string, service: boolean) => name === "product" && !service
  ? Result.succeed(undefined) : Result.fail(commerceError("unsupportedProfile"));

it("admits recursive native selection members without admitting malformed child nodes", () => {
  const input = { __value: { product: { fields: ["id"], __args: { filters: { id: "p" } },
    isServiceAccess: false, variants: { fields: ["id"], options: { fields: ["value"] } } } } };
  const prepared = Result.getOrThrow(prepareNativeGraphInput(input, metadata, admit));
  expect(prepared.fields).toEqual(["id", "variants.id", "variants.options.value"]);
  expect(prepared.value).toEqual(input);
  for (const variants of [["id"], false, { fields: true }, { fields: [42] }, { child: ["invalid"] }]) {
    expect(prepareNativeGraphInput({ __value: { product: { fields: ["id"], variants } } }, metadata, admit))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
});

it("retains native duplicate and own-undefined IDs for the native normalizer", () => {
  const input = { entryPoint: "product", fields: ["id"], variables: { id: ["p", undefined, "p", ""] } };
  const prepared = Result.getOrThrow(prepareNativeGraphInput(input, metadata, admit));
  expect(prepared.value).toStrictEqual(input);
  expect(input.variables.id).toStrictEqual(["p", undefined, "p", ""]);
});

it("admits known roots before native filter normalization and rejects unsafe paths", () => {
  const unknown = { entity: "unknown", fields: ["id"], filters: { nested: { id: "p" } } };
  expect(prepareNativeGraphInput(unknown, metadata, admit))
    .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  for (const field of ["constructor.name", "variants.__proto__.id", "prototype"]) {
    expect(prepareNativeGraphInput({ entity: "product", fields: [field] }, metadata, admit))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
});

it("refuses native transport segments before normalization can drop fields or throw", () => {
  for (const fields of [["fields.name", "id"], ["id", "fields.name"], ["__fields.id"], ["__args.filters"], ["variants.isServiceAccess.id"]]) {
    for (const input of [{ entity: "product", fields }, { entryPoint: "product", fields }]) {
      expect(prepareNativeGraphInput(input, metadata, admit))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
  }
});

it("preserves the genuine refetch producer's own undefined optional members", () => {
  const input = { entity: "product", fields: ["id"], filters: { id: "p" }, pagination: undefined,
    context: undefined, withDeleted: undefined };
  expect(Result.getOrThrow(prepareNativeGraphInput(input, metadata, admit)).value).toStrictEqual(input);
  const page = { ...input, pagination: { skip: 0, take: 50, order: undefined } };
  expect(Result.getOrThrow(prepareNativeGraphInput(page, metadata, admit)).value).toStrictEqual(page);
});

it("admits the native Store option port without activating locale or dropping unknown members", () => {
  const options = { cache: { enable: true }, locale: undefined };
  expect(Result.getOrThrow(decodeNativeGraphOptions(options))).toStrictEqual(options);
  for (const invalid of [{ ...options, locale: "en" }, { arbitrary: undefined }, { cache: { arbitrary: undefined } },
    { throwIfRelationNotFound: true }]) {
    expect(decodeNativeGraphOptions(invalid)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
});
