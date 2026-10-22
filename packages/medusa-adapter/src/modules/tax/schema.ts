import { Effect } from "effect";
import { TaxProvider, TaxRate, TaxRateRule, TaxRegion } from "@medusajs/tax/models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";

/** Keep the complete native Tax schema, including inactive mutation constraints. */
export const captureTaxMetadata = Effect.fn("Tax.captureMetadata")(function* () {
  const source = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema([TaxProvider, TaxRate, TaxRateRule, TaxRegion]))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  if (compiled.tables.length !== 4 || compiled.tables.map(table => table.name).join(",") !== "tax_provider,tax_rate,tax_rate_rule,tax_region")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, { invalidInput: () => commerceError("unsupportedProfile"),
    hashFailure: cause => commerceError("unsupportedProfile", cause) });
});

export const taxSourceProvenance = Object.freeze({ kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f", paths: Object.freeze([
    "packages/modules/tax/src/models/tax-provider.ts", "packages/modules/tax/src/models/tax-region.ts",
    "packages/modules/tax/src/models/tax-rate.ts", "packages/modules/tax/src/models/tax-rate-rule.ts",
    "packages/modules/tax/src/services/tax-module-service.ts", "packages/modules/tax/src/services/tax-provider.ts",
    "packages/modules/tax/src/providers/system.ts", "packages/database/drizzle/src/schema.ts",
  ]) } as const);

export const compileTaxDefinition = Effect.fn("Tax.compileDefinition")(function* () {
  const metadata = yield* captureTaxMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.tax")));
  return Object.freeze({ schema, provenance: taxSourceProvenance });
});
