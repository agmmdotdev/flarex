import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { getSelectsAndRelationsFromObjectArray } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import type { GraphReadDefinition } from "../src/local-graph/model";
import type { ReadTable } from "../src/query/catalog";
import { captureStoreMetadata } from "../src/modules/store/schema";
import { compileStoreUpdateContracts, decodeStoreUpdateInput, decodeStoreUpdateUpserts } from "../src/modules/store/update-input";
import { storeUpdatePreimageSelection } from "../src/modules/store/update-query";

let contracts: Result.Result.Success<ReturnType<typeof compileStoreUpdateContracts>>;
let read: GraphReadDefinition;
const time = "2026-10-17T00:00:00.000Z";
const child = { id: "currency-a", store_id: "store-a", currency_code: "USD", is_default: true,
  created_at: time, updated_at: time, deleted_at: null };
beforeAll(async () => {
  const metadata = (await Effect.runPromise(captureStoreMetadata())).frame;
  contracts = Result.getOrThrow(compileStoreUpdateContracts(metadata));
  const { lifecycle } = contracts.creation;
  const table = (value: typeof lifecycle.store): ReadTable => ({ name: value.name, columns: value.columns.map(column => column.name), primaryKeys: ["id"],
    foreignKeys: value.foreignKeys.flatMap(key => key.columns), companions: {} });
  read = { model: "Store", command: defineGraphReadCommand("Store125.nativeQueryProof", () => Effect.fail(commerceError("unsupportedProfile"))),
    table: table(lifecycle.store), paths: [{ path: "supported_currencies", table: table(lifecycle.currency), many: true },
      { path: "supported_locales", table: table(lifecycle.locale), many: true }], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false,
    decode: () => Result.fail(commerceError("unsupportedProfile")) };
});

describe("bounded native Store update input and projection", () => {
  it("keeps raw selector duplicates and native business-invalid patches for native validation", () => {
    for (const input of [{ selector: { id: [] }, update: {} }, { selector: { id: ["store-a", "missing", "store-a"] }, update: {
      name: "   ", default_region_id: null, default_sales_channel_id: null, default_location_id: null, metadata: null,
      supported_currencies: [{ currency_code: "USD", is_default: true }, { currency_code: "usd", is_default: true }],
      supported_locales: [{ locale_code: "en-US" }, { locale_code: "en-US" }],
    } }, { selector: { id: "store-a" }, update: { supported_currencies: [], supported_locales: [] } }])
      expect(Result.getOrThrow(decodeStoreUpdateInput(input))).toEqual(input);
    expect(Result.getOrThrow(decodeStoreUpdateInput({ selector: { id: "store-a" }, update: {
      name: undefined, metadata: undefined, supported_currencies: [{ currency_code: "USD", is_default: undefined }],
    } }))).toEqual({ selector: { id: "store-a" }, update: { supported_currencies: [{ currency_code: "USD" }] } });
  });
  it("refuses broad selectors, managed writes, tax flags, invalid nullability and over-limit input", () => {
    for (const input of [{ selector: {}, update: {} }, { selector: { id: Array(5).fill("store-a") }, update: {} },
      { selector: { id: "store-a" }, update: { name: null } }, { selector: { id: "store-a" }, update: { created_at: time } },
      { selector: { id: "store-a" }, update: { supported_currencies: [{ currency_code: "usd", is_tax_inclusive: true }] } },
      { selector: { id: "store-a" }, update: { supported_currencies: [{ id: "supplied", currency_code: "usd" }] } },
      { selector: { id: "store-a" }, update: { supported_locales: Array(3).fill({ locale_code: "en" }) } }])
      expect(Result.isFailure(decodeStoreUpdateInput(input))).toBe(true);
  });
  it("admits captured managed child DTO shapes without granting reconstitution authority", () => {
    expect(Result.getOrThrow(decodeStoreUpdateUpserts([{ id: "store-a", metadata: undefined,
      supported_currencies: [child], supported_locales: [] }]))).toEqual([{ id: "store-a", supported_currencies: [child], supported_locales: [] }]);
    expect(Result.getOrThrow(contracts.decodePreimages([{ id: "store-a", supported_currencies: [child] }]))).toEqual([{ id: "store-a", supported_currencies: [child] }]);
    expect(Result.getOrThrow(contracts.decodePreimages([{ id: "store-a", supported_currencies: [{ id: "currency-a", store_id: "store-a", currency_code: "USD" }] }]))).toEqual([
      { id: "store-a", supported_currencies: [{ id: "currency-a", store_id: "store-a", currency_code: "USD" }] }]);
    expect(Result.getOrThrow(contracts.decodePreimages([{ id: "store-a", supported_currencies: [{ id: "currency-a", store_id: "store-a" }] }]))).toEqual([
      { id: "store-a", supported_currencies: [{ id: "currency-a", store_id: "store-a" }] }]);
    for (const value of [[{}], [{ id: "store-a", supported_currencies: [{ ...child, extra: true }] }], [{ id: "store-a", supported_currencies: [{ ...child, is_default: "yes" }] }],
      [{ id: "store-a", supported_currencies: [{ id: "currency-a", store_id: "store-a" }] }],
      [{ id: "store-a", supported_locales: [{ id: "locale-a", store_id: "store-a" }] }]])
      expect(Result.isFailure(decodeStoreUpdateUpserts(value))).toBe(true);
  });
  it("uses checked DML for selected preimages and reuses complete final-output decoder", () => {
    for (const input of [[{ id: "store-a", extra: true }], [{ id: "store-a", name: null }], [{ id: "store-a", deleted_at: time }],
      [{ id: "store-a", supported_currencies: [{ ...child, store_id: "other" }] }],
      [{ id: "store-a", supported_currencies: [child, child] }],
      [{ id: "store-a", supported_currencies: [{ ...child, deleted_at: time }] }]])
      expect(Result.isFailure(contracts.decodePreimages(input))).toBe(true);
    expect(Result.isFailure(contracts.creation.decodeRows([{ id: "store-a" }]))).toBe(true);
  });
  it("ignores dotted metadata paths and retains root identity without capturing full metadata", () => {
    const config = { select: ["metadata.foo", "metadata.nested.bar"], relations: [] };
    expect(Result.getOrThrow(storeUpdatePreimageSelection(config, read))).toEqual({ select: ["id"], relations: [] });
    expect(Result.getOrThrow(storeUpdatePreimageSelection({ select: ["metadata"], relations: [] }, read))).toEqual({ select: ["id", "metadata"], relations: [] });
    expect(config).toEqual({ select: ["metadata.foo", "metadata.nested.bar"], relations: [] });
  });
  it("selects full managed children for empty nested select and identity plus ownership for projected children", () => {
    const native = getSelectsAndRelationsFromObjectArray([{ supported_currencies: [], supported_locales: [] }]);
    expect(native).toEqual({ selects: [], relations: ["supported_currencies", "supported_locales"] });
    const empty = Result.getOrThrow(storeUpdatePreimageSelection({ select: native.selects, relations: native.relations }, read));
    expect(empty.select).toEqual(["id", ...read.paths.flatMap(path => path.table.columns.map(column => path.path + "." + column))]);
    expect(empty.select).toContain("supported_currencies.created_at"); expect(empty.select).toContain("supported_locales.deleted_at");
    expect(Result.getOrThrow(storeUpdatePreimageSelection({ select: ["supported_currencies.currency_code"], relations: ["supported_currencies"] }, read)))
      .toEqual({ select: ["id", "supported_currencies.currency_code", "supported_currencies.id", "supported_currencies.store_id"], relations: ["supported_currencies"] });
  });
  it("keeps unknown relationships and fields refused at this named boundary", () => {
    for (const config of [{ select: ["unknown"], relations: [] }, { select: [], relations: ["region"] },
      { select: ["supported_currencies.currency_code"], relations: [] }, { select: ["supported_currencies.unknown"], relations: ["supported_currencies"] }])
      expect(Result.isFailure(storeUpdatePreimageSelection(config, read))).toBe(true);
  });
});
