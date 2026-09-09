import { Result } from "effect";
import { Currency } from "@medusajs/currency/models";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { readCurrencyMetadata } from "./currency-schema";
import { makeReadCatalog } from "./query/catalog";
import type { ProjectionPolicy } from "./query/projection";

export const currencyReadCatalog = readCurrencyMetadata(Currency).pipe(
  Result.mapError(cause => commerceError("unsupportedProfile", cause)),
  Result.flatMap(metadata => makeReadCatalog([{
    name: metadata.tableName, columns: Object.values(metadata.schema).map(field => field.fieldName),
    primaryKeys: [metadata.schema.code.fieldName], foreignKeys: [],
    companions: { [metadata.schema.rounding.fieldName]: metadata.schema.raw_rounding.fieldName },
  }], new Map())),
);
export const currencyReadProjection: ProjectionPolicy = {
  keys: "selected", storageKeys: "selected", joinKeys: "storage", selectableRelations: [], nested: new Map(),
};
