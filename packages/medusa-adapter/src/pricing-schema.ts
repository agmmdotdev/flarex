import { Effect, Schema } from "effect";
import { pricingModuleModels } from "@medusajs/pricing/static-manifest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCompiledDml } from "./schema/compiled";

const decodeInventory = Schema.decodeUnknownEffect(Schema.Struct({ tables: Schema.Array(
  Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
) }), { onExcessProperty: "error" });
export const capturePricingMetadata = Effect.fn("Pricing.captureMetadata")(function* () {
  const input = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(pricingModuleModels))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const inventory = yield* decodeInventory(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const selected = ["price_set", "price", "price_rule", "price_list"];
  if (inventory.tables.length !== 6 || new Set(inventory.tables.map(table => table.name)).size !== 6) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const compiled = yield* decodeCompiledDml({ tables: inventory.tables.filter(table => selected.includes(table.name)) })
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  if (compiled.tables.length !== 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, {
    invalidInput: () => commerceError("unsupportedProfile"), hashFailure: cause => commerceError("unsupportedProfile", cause),
  });
});
