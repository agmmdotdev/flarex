import { Effect } from "effect";
import { Store, StoreCurrency, StoreLocale } from "@medusajs/store/models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";

/** Retain the complete native constructor closure. Guard admission does not
 * grant Store mutation or hydration of its native child relations. */
export const captureStoreMetadata = Effect.fn("Store.captureMetadata")(function* () {
  const source = yield* Effect.try({
    try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema([Store, StoreCurrency, StoreLocale]))),
    catch: cause => commerceError("unsupportedProfile", cause),
  });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const names = ["store", "store_currency", "store_locale"];
  if (compiled.tables.length !== names.length || names.some(name => compiled.tables.filter(table => table.name === name).length !== 1)
    || compiled.tables.some(table => table.foreignKeys.some(key => key.referencedTable !== "store")))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, {
    invalidInput: () => commerceError("unsupportedProfile"), hashFailure: cause => commerceError("unsupportedProfile", cause),
  });
});

export const storeSourceProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/store/src/models/store.ts", "packages/modules/store/src/models/currency.ts",
    "packages/modules/store/src/models/locale.ts", "packages/modules/store/src/static-manifest.ts",
    "packages/database/drizzle/src/schema.ts"]),
} as const);

export const compileStoreDefinition = Effect.fn("Store.compileDefinition")(function* () {
  const metadata = yield* captureStoreMetadata();
  const lowered = lowerDmlSchema(metadata.frame.tables, "commerce.store");
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ ...lowered, tables: lowered.tables.map(table =>
    table.tableId !== "store" ? table : { ...table, indexes: [...table.indexes, {
      indexId: "store.default-sales-channel-equality", kind: "textEquality" as const,
      columns: ["default_sales_channel_id"], predicate: null,
      origin: { kind: "derived" as const, sourceId: "store.default-sales-channel-equality" },
    }] }) }));
  return Object.freeze({ schema, provenance: storeSourceProvenance });
});
