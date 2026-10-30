import { canonicalizeApplicationManifest, type ApplicationManifest, type ApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { Result, Schema } from "effect";
import { SchemaManifestAppDeveloperOrderedIndexSpecV1Schema } from "flarex-protocol/schema-manifest";

import { CoreIndexDeclarationSchema, type CoreIndexDeclaration } from "../core/indexState";
import { captureCoreSchema, CoreSchemaError, invalidCoreSchema, type CoreSchemaDefinition } from "../core/schemaTypes";

const decodeDeclaredIndex = Schema.decodeUnknownResult(SchemaManifestAppDeveloperOrderedIndexSpecV1Schema);
const decodeInstalledIndex = Schema.decodeUnknownResult(CoreIndexDeclarationSchema);

/** Application authoring fields, before the source compiler adds its sort suffix. */
export interface CoreApplicationIndexDeclaration {
  readonly name: string;
  readonly fields: readonly string[];
}
/** Convex Application adds creation time before IndexedFields' implicit ID tie. */
export function compileCoreApplicationIndexes(
  declarations: readonly CoreApplicationIndexDeclaration[],
): Result.Result<readonly CoreIndexDeclaration[], Schema.SchemaError> {
  return Result.gen(function* () {
    const indexes: CoreIndexDeclaration[] = [];
    for (const declaration of declarations) {
      const declared = yield* decodeDeclaredIndex({
        kind: "developerOrdered", specVersion: 1, fields: declaration.fields,
      });
      indexes.push(yield* decodeInstalledIndex({ indexDescriptor: declaration.name,
        fields: Object.freeze([...declared.fields, "_creationTime"]),
      }));
    }
    return Object.freeze(indexes);
  });
}

/** Native obligations must survive the producer boundary until their owner exists. */
export function requireCoreApplicationSchemaSupport(
  manifest: ApplicationManifest,
): Result.Result<ApplicationManifestV1, CoreSchemaError> {
  if (manifest.version !== 1 || manifest.schema.indexes.some(index => (index.decimalFields?.length ?? 0) > 0))
    return Result.fail(new CoreSchemaError({ reason: "unsupportedCapability",
      message: "The translated core does not yet enforce native write ownership, exact values, unique constraints or references." }));
  return Result.succeed(manifest);
}

/** Consume the whole manifest so native requirements cannot disappear in table projection. */
export function compileCoreApplicationSchema(
  value: unknown,
): Result.Result<CoreSchemaDefinition, Schema.SchemaError | CoreSchemaError> {
  return Result.gen(function* () {
    const canonical = yield* canonicalizeApplicationManifest(value).pipe(
      Result.mapError(cause => invalidCoreSchema("Invalid Application schema manifest", cause)));
    const manifest = yield* requireCoreApplicationSchemaSupport(canonical.manifest);
    const compiled = [];
    for (const table of manifest.schema.tables) {
      const declarations = manifest.schema.indexes.filter(index => index.tableId === table.tableId);
      const indexes = yield* compileCoreApplicationIndexes(declarations);
      compiled.push({ tableName: table.name, documentType: table.validator, indexes, stagedDbIndexes: [] });
    }
    // Existing Application manifests enforce validators; the source decoder's
    // historical missing-flag default must not disable that behavior.
    return yield* captureCoreSchema({ tables: compiled, schemaValidation: true });
  });
}