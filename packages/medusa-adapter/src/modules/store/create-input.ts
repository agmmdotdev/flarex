import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileStoreDeletionContracts } from "./delete-input";
import type { captureStoreMetadata } from "./schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
/** Business strings remain native strings, including empty values. Native
 * normalization and validation own duplicate/default and case behavior. */
export const StoreCurrencyCreate = Schema.Struct({ currency_code: Schema.String, is_default: Schema.optionalKey(Schema.Boolean) });
export const StoreLocaleCreate = Schema.Struct({ locale_code: Schema.String });
export const StoreCreate = Schema.Struct({ name: Schema.optionalKey(Schema.String),
  default_sales_channel_id: Schema.optionalKey(Schema.String), default_region_id: Schema.optionalKey(Schema.String),
  default_location_id: Schema.optionalKey(Schema.String), metadata: Schema.optionalKey(Schema.JsonObject),
  supported_currencies: Schema.optionalKey(Schema.Array(StoreCurrencyCreate).pipe(Schema.mutable).check(Schema.isMaxLength(2))),
  supported_locales: Schema.optionalKey(Schema.Array(StoreLocaleCreate).pipe(Schema.mutable).check(Schema.isMaxLength(2))),
});
export const StoreCreates = Schema.Array(StoreCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const StorePhysicalDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeStoreCreates = commerceDecoder(StoreCreates, "invalidInput");
export const decodeStorePhysicalDeletionIds = commerceDecoder(StorePhysicalDeletionIds, "invalidInput");
export const decodeStorePhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)),
}), "unsupportedProfile");
const decodeOutputShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeChildRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)), "storedCorruption");
const decodeReplacementConfig = commerceDecoder(Schema.Struct({ relations: Schema.Tuple([
  Schema.Literal("supported_currencies"), Schema.Literal("supported_locales"),
]) }), "unsupportedProfile");
const decodeReplacement = commerceDecoder(Schema.Struct({ input: StoreCreates, config: Schema.JsonObject }), "unsupportedProfile");
// An empty Struct accepts arbitrary properties in the installed Effect API.
const EmptyActions = Schema.Record(Schema.String, Schema.Never);
const decodeActions = commerceDecoder(Schema.Struct({
  created: Schema.Struct({ Store: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isLengthBetween(1, 4))),
    StoreCurrency: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isLengthBetween(1, 8))),
    StoreLocale: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isLengthBetween(1, 8))) }),
  updated: EmptyActions, deleted: EmptyActions,
}), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureStoreMetadata>>["frame"];

/** The checked native DML remains the complete row/default authority. Shapes
 * above select the supported create DTO, not a second storage definition. */
export function compileStoreCreationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const lifecycle = yield* compileStoreDeletionContracts(metadata);
    if ([lifecycle.currency, lifecycle.locale].some(table => table.foreignKeys.some(key => key.onDelete !== "cascade")))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const defaults = new Map<string, JsonObject>();
    for (const entity of lifecycle.entities) {
      const values: Record<string, Json> = {};
      for (const column of entity.table.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
        if (column.defaultValue !== undefined) values[column.name] = column.defaultValue;
        else if (column.nullable) values[column.name] = null;
      }
      defaults.set(entity.table.name, values);
    }
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeOutputShape(input);
      const roots = new Set<string>(), children = new Set<string>();
      let currencyCount = 0, localeCount = 0;
      for (const row of rows) {
        const { supported_currencies, supported_locales, ...scalar } = row;
        const root = yield* lifecycle.decodeStoreRow(scalar);
        const currencies = yield* decodeChildRows(supported_currencies), locales = yield* decodeChildRows(supported_locales);
        if (typeof root.id !== "string" || roots.has(root.id) || root.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
        roots.add(root.id); currencyCount += currencies.length; localeCount += locales.length;
        for (const [table, members] of [[lifecycle.currency.name, currencies], [lifecycle.locale.name, locales]] as const) {
          const entity = lifecycle.entities.find(entity => entity.table.name === table);
          if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
          for (const member of members) {
            const child = yield* entity.decodeRow(member), key = JSON.stringify([table, child.id]);
            if (typeof child.id !== "string" || child.store_id !== root.id || child.deleted_at !== null || children.has(key))
              return yield* Result.fail(commerceError("storedCorruption"));
            children.add(key);
          }
        }
      }
      if (currencyCount > 8 || localeCount > 8) return yield* Result.fail(commerceError("storedCorruption"));
      return rows;
    });
    // The host needs a Schema. Delegate its complete-row verdict to the same
    // metadata-derived decoder used by repository, method and receipt owners.
    const Output = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeRows(rows)) || "Expected complete native Store creation rows"));
    const decodeUpsert = (input: unknown) => decodeReplacement(input).pipe(Result.flatMap(value =>
      decodeReplacementConfig(value.config).pipe(Result.map(config => ({ input: value.input, config })))));
    const decodePerformedActions = (input: unknown, rows: readonly JsonObject[]) => Result.gen(function* () {
      const actions = yield* decodeActions(input);
      const created: Record<string, { id: string }[]> = {};
      for (const [model, members] of Object.entries(actions.created)) created[model] = members.map(member => ({ id: member.id }));
      // The native action helper must identify exactly the complete graph that
      // will be returned. Its genuine internal dispatcher owns event delivery.
      const expected: Record<string, string[]> = {};
      if (rows.length) {
        const ids: string[] = [];
        for (const row of rows) {
          if (typeof row.id !== "string") return yield* Result.fail(commerceError("storedCorruption"));
          ids.push(row.id);
        }
        expected.Store = ids;
      }
      for (const [field, model] of [["supported_currencies", "StoreCurrency"], ["supported_locales", "StoreLocale"]] as const) {
        const ids: string[] = [];
        for (const row of rows) for (const child of yield* decodeChildRows(row[field])) {
          if (typeof child.id !== "string") return yield* Result.fail(commerceError("storedCorruption"));
          ids.push(child.id);
        }
        if (ids.length) expected[model] = ids;
      }
      if (Object.keys(created).length !== Object.keys(expected).length || Object.entries(expected).some(([model, ids]) =>
        !jsonEqual(created[model]?.map(row => row.id) ?? [], ids))) return yield* Result.fail(commerceError("storedCorruption"));
      return { created, updated: {}, deleted: {} };
    });
    return { lifecycle, defaults, decodeRows, Output, decodeUpsert, decodePerformedActions };
  });
}
