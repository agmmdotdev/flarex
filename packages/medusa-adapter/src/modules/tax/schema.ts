import { Effect } from "effect";
import { TaxProvider, TaxRate, TaxRateRule, TaxRegion } from "@medusajs/tax/models";
import { compileDmlMetadata } from "../../schema/compile";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { lowerDmlSchema } from "../../schema/lower";
import { makeMedusaCoreDefinition } from "../../schema/core-definition";

/** Keep the complete native Tax schema, including inactive mutation constraints. */
export const captureTaxMetadata = Effect.fn("Tax.captureMetadata")(function* () {
  const compiled = yield* compileDmlMetadata([TaxProvider, TaxRate, TaxRateRule, TaxRegion], cause => commerceError("unsupportedProfile", cause));
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

/** The complete native Tax DML source shares Core's logical schema lifecycle. */
export const compileTaxCoreDefinition = Effect.fn("Tax.compileCoreDefinition")(function* (target: Readonly<{
  scopeUuid: string; epochUuid: string; applicationRead?: boolean;
}>) {
  const nativeTarget = Object.freeze({ scopeUuid: target.scopeUuid, epochUuid: target.epochUuid,
    applicationRead: target.applicationRead ?? false });
  const definition = yield* compileTaxDefinition();
  return yield* makeMedusaCoreDefinition(nativeTarget, definition, { key: "medusa.tax", writeProfile: "medusa.tax",
    evidence: { provenance: definition.provenance, profile: "medusa.tax" } });
});
