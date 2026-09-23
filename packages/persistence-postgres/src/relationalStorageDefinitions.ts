import { Data, Effect } from "effect";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import { compileLogicalSourceUniqueConstraints, compileLogicalSourceIndexes } from "flarex-protocol/internal/logical-storage-requirements";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { FlarexMetadataDatabase } from "./deployments";
import { readSchemaVersionArtifactByIdEffect } from "./schemaVersionArtifacts";
import { readLogicalSchemaAdmissionEvidence } from "./logicalSchemaAdmissionEvidence";
import { prepareAppUniqueConstraintDefinitionBindingV1Effect, type PreparedAppUniqueConstraintDefinitionBindingV1 } from "./appUniqueConstraintDefinitions";
import { prepareOrderedIndexDefinitionBinding, ensureAppDeveloperIndexDefinitionBindingV1InTransaction } from "./appIndexDefinitions";
import { ensureStableLogicalIndexIdentityInTransaction } from "./stableLogicalIndexCatalog";
import { getStableTableIdentityByValidatedIdEffect, type StableTableCatalogTransaction } from "./stableTableCatalog";
import { lockSchemaManifestBindingDeploymentEffect } from "./schemaManifestTableBindings";

export class RelationalStorageDefinitionError extends Data.TaggedError("RelationalStorageDefinitionError")<{
  readonly reason: "missingSchema" | "missingSource" | "unsupportedDefinition" | "tableBindingChanged";
  readonly cause?: unknown;
}> {}

/** Source-local metadata preparation only. Whole-candidate build/readiness must
 * compile every configured source through the shared requirement compiler. */
const readRelationalSource = Effect.fn("RelationalStorageDefinitions.readSource")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: CatalogSchemaVersionId, sourceKey: string,
) {
  const artifact = yield* readSchemaVersionArtifactByIdEffect(db, deploymentId, schemaVersionId);
  if (artifact === null) return yield* Effect.fail(new RelationalStorageDefinitionError({ reason: "missingSchema" }));
  const evidence = yield* readLogicalSchemaAdmissionEvidence(artifact.manifestJson, deploymentId);
  const source = evidence.candidate.sources.find(candidateSource => candidateSource.key === sourceKey);
  if (source === undefined) return yield* Effect.fail(new RelationalStorageDefinitionError({ reason: "missingSource" }));
  if (source.definition.kind !== "relational" || source.bindings.some(binding => binding.kind !== "definition")) {
    return yield* Effect.fail(new RelationalStorageDefinitionError({ reason: "unsupportedDefinition" }));
  }
  const tableFor = (localName: string) => {
    const binding = source.bindings.find(candidate => candidate.localName === localName);
    return binding === undefined ? undefined : evidence.tableBindings.find(candidate =>
      logicalTableKey(candidate.table) === logicalTableKey(binding.table));
  };
  return { source, tableFor };
});

export const prepareRelationalUniqueDeclarations = Effect.fn("RelationalStorageDefinitions.prepareUnique")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: CatalogSchemaVersionId, sourceKey: string,
) {
  const { source, tableFor } = yield* readRelationalSource(db, deploymentId, schemaVersionId, sourceKey);
  const declarations = yield* Effect.fromResult(compileLogicalSourceUniqueConstraints(source)).pipe(Effect.mapError(cause =>
    new RelationalStorageDefinitionError({ reason: "unsupportedDefinition", cause })));
  const prepared: PreparedAppUniqueConstraintDefinitionBindingV1[] = [];
  for (const declaration of declarations) {
    const bound = tableFor(declaration.localName);
    if (bound === undefined) return yield* Effect.fail(new RelationalStorageDefinitionError({ reason: "unsupportedDefinition" }));
    prepared.push(yield* prepareAppUniqueConstraintDefinitionBindingV1Effect(db, {
      deploymentId, schemaVersionId, tableId: bound.tableId, descriptor: declaration.descriptor, physicalSpec: declaration.physicalSpec,
    }));
  }
  return Object.freeze(prepared);
});

export const ensureRelationalOrderedDefinitions = Effect.fn("RelationalStorageDefinitions.ensureOrdered")(function* (
  tx: StableTableCatalogTransaction, deploymentId: string, schemaVersionId: CatalogSchemaVersionId, sourceKey: string,
) {
  yield* lockSchemaManifestBindingDeploymentEffect(tx, deploymentId);
  const { source, tableFor } = yield* readRelationalSource(tx, deploymentId, schemaVersionId, sourceKey);
  const declarations = yield* Effect.fromResult(compileLogicalSourceIndexes(source)).pipe(Effect.mapError(cause =>
    new RelationalStorageDefinitionError({ reason: "unsupportedDefinition", cause })));
  const results: Effect.Success<ReturnType<typeof ensureAppDeveloperIndexDefinitionBindingV1InTransaction>>[] = [];
  for (const declaration of declarations) {
    const bound = tableFor(declaration.localName);
    if (bound === undefined) return yield* Effect.fail(new RelationalStorageDefinitionError({ reason: "unsupportedDefinition" }));
    const current = yield* getStableTableIdentityByValidatedIdEffect(tx, { deploymentId, tableId: bound.tableId });
    if (current === null || current.namespace !== bound.table.namespace || current.logicalName !== bound.table.logicalName) {
      return yield* Effect.fail(new RelationalStorageDefinitionError({ reason: "tableBindingChanged" }));
    }
    const identity = yield* ensureStableLogicalIndexIdentityInTransaction(tx, {
      deploymentId, tableId: bound.tableId, descriptor: declaration.descriptor,
    });
    const prepared = yield* prepareOrderedIndexDefinitionBinding({ deploymentId, schemaVersionId,
      tableId: bound.tableId, logicalIndexId: identity.index.logicalIndexId, physicalSpec: declaration.physicalSpec });
    results.push(yield* ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, prepared));
  }
  return Object.freeze(results);
});
