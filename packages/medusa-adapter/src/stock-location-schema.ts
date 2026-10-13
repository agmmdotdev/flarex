import { Effect, Schema } from "effect";
import { stockLocationModuleModels } from "@medusajs/stock-location/static-manifest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCompiledDml } from "./schema/compiled";
import { lowerDmlSchema } from "./schema/lower";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

const decodeStockLocation = Schema.decodeUnknownEffect(Schema.Struct({ tables: Schema.Array(
  Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
) }), { onExcessProperty: "error" });
const compilePinnedStockLocationMetadata = Effect.fn("StockLocation.compilePinnedMetadata")(function* () {
  const input = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(stockLocationModuleModels))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const stockLocation = yield* decodeStockLocation(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const expected = ["stock_location","stock_location_address"];
  if (stockLocation.tables.length !== expected.length ||
    expected.some(name => stockLocation.tables.filter(table => table.name === name).length !== 1))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* decodeCompiledDml({ tables: stockLocation.tables })
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
});

export const captureStockLocationMetadata = Effect.fn("StockLocation.captureMetadata")(function* () {
  const frame = yield* compilePinnedStockLocationMetadata();
  return yield* capturePrivateCanonicalValue(frame, 1_048_576, {
    invalidInput: () => commerceError("unsupportedProfile"), hashFailure: cause => commerceError("unsupportedProfile", cause),
  });
});

export const stockLocationSourceProvenance = Object.freeze({
  kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/stock-location/src/models", "packages/modules/stock-location/src/static-manifest.ts",
    "packages/database/drizzle/src/schema.ts", "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts"]),
} as const);

/** Complete pinned StockLocation source; runtime methods remain individually admitted. */
export const compileStockLocationDefinition = Effect.fn("StockLocation.compileDefinition")(function* () {
  const compiled = yield* compilePinnedStockLocationMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(compiled.tables, "commerce.stock-location")));
  return Object.freeze({ schema, provenance: stockLocationSourceProvenance });
});
