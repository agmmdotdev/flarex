import { Effect, Schema } from "effect";
import { pricingModuleModels } from "@medusajs/pricing/static-manifest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

const decodeInventory = Schema.decodeUnknownEffect(Schema.Struct({ tables: Schema.Array(
  Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
) }), { onExcessProperty: "error" });
const compilePinnedPricingMetadata = Effect.fn("Pricing.compilePinnedMetadata")(function* () {
  const input = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(pricingModuleModels))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const inventory = yield* decodeInventory(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const expected = ["price_set", "price", "price_rule", "price_list", "price_list_rule", "price_preference"];
  if (inventory.tables.length !== expected.length ||
    expected.some(name => inventory.tables.filter(table => table.name === name).length !== 1))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* decodeCompiledDml({ tables: inventory.tables })
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
});

export const capturePricingMetadata = Effect.fn("Pricing.captureMetadata")(function* () {
  const frame = yield* compilePinnedPricingMetadata();
  return yield* capturePrivateCanonicalValue(frame, 1_048_576, {
    invalidInput: () => commerceError("unsupportedProfile"), hashFailure: cause => commerceError("unsupportedProfile", cause),
  });
});

export const pricingSourceProvenance = Object.freeze({
  kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/pricing/src/models", "packages/modules/pricing/src/static-manifest.ts",
    "packages/database/drizzle/src/schema.ts", "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts"]),
} as const);

/** Complete pinned Pricing source; runtime methods remain individually admitted. */
export const compilePricingDefinition = Effect.fn("Pricing.compileDefinition")(function* () {
  const compiled = yield* compilePinnedPricingMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(compiled.tables, "commerce.pricing")));
  return Object.freeze({ schema, provenance: pricingSourceProvenance });
});
