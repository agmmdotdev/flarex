import { Effect } from "effect";
import { promotionModuleModels } from "@medusajs/promotion/static-manifest";
import { compileDmlMetadata } from "../../schema/compile";
import { makeMedusaCoreDefinition } from "../../schema/core-definition";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { lowerDmlSchema } from "../../schema/lower";

export const capturePromotionMetadata = Effect.fn("Promotion.captureMetadata")(function* () {
  const compiled = yield* compileDmlMetadata(promotionModuleModels, cause => commerceError("unsupportedProfile", cause));
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

export const compilePromotionCoreDefinition = Effect.fn("Promotion.compileCoreDefinition")(function* ({ scopeUuid, epochUuid }: Readonly<{
  scopeUuid: string;
  epochUuid: string;
}>) {
  const { schema, provenance } = yield* compilePromotionDefinition();
  return yield* makeMedusaCoreDefinition({ scopeUuid, epochUuid, applicationRead: false }, { schema, provenance }, { key: "medusa.promotion", writeProfile: "medusa.promotion",
    evidence: { provenance, profile: "medusa.promotion" } });
});
