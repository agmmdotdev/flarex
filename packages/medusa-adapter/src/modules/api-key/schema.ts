import { Effect } from "effect";
import { apiKeyModuleModels } from "@medusajs/api-key/static-manifest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";

export const captureApiKeyMetadata = Effect.fn("ApiKey.captureMetadata")(function* () {
  const source = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(apiKeyModuleModels))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const table = compiled.tables[0];
  if (compiled.tables.length !== 1 || table?.name !== "api_key" || table.foreignKeys.length || table.relationships.length ||
    table.cascades.delete.length || table.cascades.detach.length)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, { invalidInput: () => commerceError("unsupportedProfile"),
    hashFailure: cause => commerceError("unsupportedProfile", cause) });
});

export const apiKeySourceProvenance = Object.freeze({ kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f", paths: Object.freeze([
    "packages/modules/api-key/src/models/api-key.ts", "packages/modules/api-key/src/static-manifest.ts",
    "packages/database/drizzle/src/schema.ts",
  ]) } as const);

export const compileApiKeyDefinition = Effect.fn("ApiKey.compileDefinition")(function* () {
  const metadata = yield* captureApiKeyMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.api-key")));
  return Object.freeze({ schema, provenance: apiKeySourceProvenance });
});
