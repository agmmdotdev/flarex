import { Effect } from "effect";
import { regionModuleModels } from "@medusajs/region/static-manifest";
import { compileDmlMetadata } from "../../schema/compile";
import { makeMedusaCoreDefinition } from "../../schema/core-definition";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { lowerDmlSchema } from "../../schema/lower";

/** Full native Region/Country metadata is retained even though this capability
 * only reads Region scalar fields. Country bootstrap and mutations are absent. */
export const captureRegionMetadata = Effect.fn("Region.captureMetadata")(function* () {
  const compiled = yield* compileDmlMetadata(regionModuleModels, cause => commerceError("unsupportedProfile", cause));
  const region = compiled.tables.find(table => table.name === "region"), country = compiled.tables.find(table => table.name === "region_country");
  if (compiled.tables.length !== 2 || region === undefined || country === undefined || region.foreignKeys.length ||
    region.cascades.delete.length || region.cascades.detach.length || region.relationships.length !== 1 ||
    region.relationships[0]?.name !== "countries" || region.relationships[0].type !== "hasMany" ||
    country.columns.filter(column => column.primaryKey).length !== 1 || country.columns.find(column => column.name === "iso_2")?.primaryKey !== true ||
    country.foreignKeys.length !== 1 || country.foreignKeys[0]?.columns[0] !== "region_id" || country.foreignKeys[0].referencedTable !== region.name)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, { invalidInput: () => commerceError("unsupportedProfile"),
    hashFailure: cause => commerceError("unsupportedProfile", cause) });
});

export const regionSourceProvenance = Object.freeze({ kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f", paths: Object.freeze([
    "packages/modules/region/src/models/region.ts", "packages/modules/region/src/models/country.ts",
    "packages/modules/region/src/services/region-module.ts", "packages/database/drizzle/src/schema.ts",
  ]) } as const);

export const compileRegionDefinition = Effect.fn("Region.compileDefinition")(function* () {
  const metadata = yield* captureRegionMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.region")));
  return Object.freeze({ schema, provenance: regionSourceProvenance });
});

export const compileRegionCoreDefinition = Effect.fn("Region.compileCoreDefinition")(function* ({ scopeUuid, epochUuid }: Readonly<{
  scopeUuid: string;
  epochUuid: string;
}>) {
  const { schema, provenance } = yield* compileRegionDefinition();
  return yield* makeMedusaCoreDefinition({ scopeUuid, epochUuid, applicationRead: false }, { schema, provenance }, { key: "medusa.region", writeProfile: "medusa.region",
    evidence: { provenance, profile: "medusa.region" } });
});
