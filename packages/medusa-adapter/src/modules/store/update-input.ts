import { Result, Schema, type Effect } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileRowProjection } from "../../value/complete-row";
import { NativePreimageConfig } from "../../workflow/preimage";
import { compileStoreCreationContracts, StoreCurrencyCreate, StoreLocaleCreate } from "./create-input";
import type { captureStoreMetadata } from "./schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const StoreUpdateIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const StoreUpdateSelector = Schema.Struct({ id: Schema.Union([Id, StoreUpdateIds]) });
const NullableText = Schema.optionalKey(Schema.NullOr(Schema.String));
const Metadata = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
/** Only the native direct-module patch. Workflow tax flags belong to Pricing's
 * original input; defaults, duplicates and normalization stay native. */
export const StoreUpdateData = Schema.Struct({ name: Schema.optionalKey(Schema.String), metadata: Metadata,
  default_sales_channel_id: NullableText, default_region_id: NullableText, default_location_id: NullableText,
  supported_currencies: Schema.optionalKey(Schema.Array(StoreCurrencyCreate).pipe(Schema.mutable).check(Schema.isMaxLength(2))),
  supported_locales: Schema.optionalKey(Schema.Array(StoreLocaleCreate).pipe(Schema.mutable).check(Schema.isMaxLength(2))),
});
export const StoreUpdateInput = Schema.Struct({ selector: StoreUpdateSelector, update: StoreUpdateData });
export const StoreUpdateReadInput = Schema.Struct({ filters: StoreUpdateSelector, config: Schema.optionalKey(NativePreimageConfig) });
const Managed = { created_at: Schema.optionalKey(Schema.String), updated_at: Schema.optionalKey(Schema.String),
  deleted_at: Schema.optionalKey(Schema.NullOr(Schema.String)) };
const ChildIdentity = { id: Schema.optionalKey(Id), store_id: Schema.optionalKey(Schema.NullOr(Id)), ...Managed };
// The genuine inverse consumes the requested native child fields, even when
// its preimage contains additional identity/managed fields. Read projections
// use the separate metadata-derived projection decoders below.
export const CurrencyPreimage = Schema.Struct({ ...ChildIdentity, currency_code: Schema.String, is_default: Schema.optionalKey(Schema.Boolean) });
export const LocalePreimage = Schema.Struct({ ...ChildIdentity, locale_code: Schema.String });
/** Captured DTO structure grants no supplied-identity/managed-field authority.
 * The replacement owner must separately prove actual prior row identity,
 * lifecycle, owner and timestamps before accepting any reconstitution. */
export const StoreUpdateUpsert = Schema.Struct({ id: Id, ...StoreUpdateData.fields, ...Managed,
  supported_currencies: Schema.optionalKey(Schema.Array(CurrencyPreimage).pipe(Schema.mutable).check(Schema.isMaxLength(2))),
  supported_locales: Schema.optionalKey(Schema.Array(LocalePreimage).pipe(Schema.mutable).check(Schema.isMaxLength(2))),
});
export const StoreUpdateUpserts = Schema.Array(StoreUpdateUpsert).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeInputShape = commerceDecoder(StoreUpdateInput, "invalidInput");
const decodeUpsertShape = commerceDecoder(StoreUpdateUpserts, "invalidInput");
// Genuine callbacks emit own undefined properties. Capture through the existing
// bounded owner before strict Schema decoding; native normalization omits them.
export const decodeStoreUpdateInput = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeInputShape));
export const decodeStoreUpdateUpserts = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeUpsertShape));
const decodeChildPreimages = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)), "storedCorruption");
const decodePreimageShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
type MetadataFrame = Effect.Success<ReturnType<typeof captureStoreMetadata>>["frame"];

export function compileStoreUpdateContracts(metadata: MetadataFrame) {
  return Result.gen(function* () {
    const creation = yield* compileStoreCreationContracts(metadata), { lifecycle } = creation;
    if (Object.keys(StoreUpdateData.fields).some(name => !["supported_currencies", "supported_locales"].includes(name) &&
      !lifecycle.store.columns.some(column => column.name === name))) return yield* Result.fail(commerceError("unsupportedProfile"));
    const root = yield* compileRowProjection(lifecycle.store), currency = yield* compileRowProjection(lifecycle.currency), locale = yield* compileRowProjection(lifecycle.locale);
    const decodePreimages = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodePreimageShape(input), roots = new Set<string>(), childKeys = new Set<string>();
      let currencyCount = 0, localeCount = 0;
      for (const row of rows) {
        const { supported_currencies, supported_locales, ...scalar } = row;
        const selected = yield* root(scalar);
        if (typeof selected.id !== "string" || roots.has(selected.id) || selected.deleted_at !== undefined && selected.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
        roots.add(selected.id);
        for (const [name, value, decode] of [["supported_currencies", supported_currencies, currency], ["supported_locales", supported_locales, locale]] as const) {
          if (value === undefined) continue;
          const members = yield* decodeChildPreimages(value);
          if (name === "supported_currencies") currencyCount += members.length; else localeCount += members.length;
          for (const member of members) {
            const child = yield* decode(member);
            const key = JSON.stringify([name, child.id]);
            if (typeof child.id !== "string" || child.store_id !== selected.id || childKeys.has(key) || child.deleted_at !== undefined && child.deleted_at !== null)
              return yield* Result.fail(commerceError("storedCorruption"));
            childKeys.add(key);
          }
        }
      }
      if (currencyCount > 8 || localeCount > 8) return yield* Result.fail(commerceError("storedCorruption"));
      return rows;
    });
    return { creation, decodePreimages, decodeUpsert: decodeStoreUpdateUpserts };
  });
}
