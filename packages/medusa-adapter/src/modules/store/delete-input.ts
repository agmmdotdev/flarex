import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import type { captureStoreMetadata } from "./schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const StoreDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeStoreDeletionIds = commerceDecoder(StoreDeletionIds, "invalidInput");
export const decodeStoreDeletionArguments = commerceDecoder(Schema.Tuple([StoreDeletionIds]), "invalidInput");
export const decodeStoreDeletionOutput = commerceDecoder(Schema.Struct({
  store_id: Schema.optionalKey(StoreDeletionIds),
  store_currency_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
  store_locale_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
}), "storedCorruption");

const decodeTupleShape = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  Schema.Struct({
    Store: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMinLength(1), Schema.isMaxLength(4))),
    StoreCurrency: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMinLength(1), Schema.isMaxLength(8))),
    StoreLocale: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMinLength(1), Schema.isMaxLength(8))),
  }),
]), "storedCorruption");

type Metadata = Effect.Success<ReturnType<typeof captureStoreMetadata>>["frame"];

/** The native Store cascade owns its two local child models. Default region,
 * channel and location IDs are scalar references, not lifecycle descendants. */
export function compileStoreDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const store = metadata.tables.find(table => table.name === "store");
    const currency = metadata.tables.find(table => table.name === "store_currency");
    const locale = metadata.tables.find(table => table.name === "store_locale");
    if (metadata.tables.length !== 3 || store === undefined || currency === undefined || locale === undefined ||
      store.foreignKeys.length !== 0 || store.relationships.length !== 2 ||
      !store.relationships.some(relation => relation.name === "supported_currencies" && relation.type === "hasMany" &&
        relation.targetTable === currency.name && relation.cascadeDelete && relation.mappedBy === "store") ||
      !store.relationships.some(relation => relation.name === "supported_locales" && relation.type === "hasMany" &&
        relation.targetTable === locale.name && relation.cascadeDelete && relation.mappedBy === "store"))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const child of [currency, locale]) {
      if (child.foreignKeys.length !== 1 || !child.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "store_id" &&
        key.referencedTable === store.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id") ||
        child.relationships.some(relation => relation.cascadeDelete) ||
        !child.columns.some(column => column.name === "store_id" && column.nullable))
        return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    const decodeStoreRow = yield* compileCompleteRow(store);
    const entities = [
      { table: store, model: "Store", linkableKey: "store_id", maximum: 4, decodeRow: decodeStoreRow },
      { table: currency, model: "StoreCurrency", linkableKey: "store_currency_id", maximum: 8, decodeRow: yield* compileCompleteRow(currency) },
      { table: locale, model: "StoreLocale", linkableKey: "store_locale_id", maximum: 8, decodeRow: yield* compileCompleteRow(locale) },
    ];
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const tuple = yield* decodeTupleShape(input);
      if (!jsonEqual(tuple[0], tuple[1].Store ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      const captured: Readonly<Record<string, readonly object[] | undefined>> = tuple[1];
      const cascades: Record<string, object[]> = {};
      for (const entity of entities) {
        const rows = captured[entity.model];
        if (rows === undefined) continue;
        for (const row of rows) yield* entity.decodeRow(row);
        cascades[entity.model] = rows.map(row => ({ ...row }));
      }
      return [tuple[0].map(row => ({ ...row })), cascades] satisfies [object[], Record<string, unknown[]>];
    });
    return { store, currency, locale, entities, decodeStoreRow, decodeLifecycleResult, decodeOutput: decodeStoreDeletionOutput };
  });
}
