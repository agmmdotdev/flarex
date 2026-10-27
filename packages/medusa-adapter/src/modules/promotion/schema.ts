import { Effect } from "effect";
import { promotionModuleModels } from "@medusajs/promotion/static-manifest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";

export const capturePromotionMetadata = Effect.fn("Promotion.captureMetadata")(function* () {
  const input = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(promotionModuleModels))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const compiled = yield* decodeCompiledDml(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, {
    invalidInput: () => commerceError("unsupportedProfile"), hashFailure: cause => commerceError("unsupportedProfile", cause),
  });
});
export const promotionSourceProvenance = Object.freeze({ kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git", revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/promotion/src/static-manifest.ts", "packages/modules/promotion/src/models/promotion.ts",
    "packages/modules/promotion/src/models/application-method.ts", "packages/database/drizzle/src/schema.ts"]),
} as const);
export const compilePromotionDefinition = Effect.fn("Promotion.compileDefinition")(function* () {
  const metadata = yield* capturePromotionMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.promotion")));
  return Object.freeze({ schema, provenance: promotionSourceProvenance });
});
