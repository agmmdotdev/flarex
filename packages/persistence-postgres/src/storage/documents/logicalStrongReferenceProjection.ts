import { Data, Effect } from "effect";
import { logicalTableKey, type QualifiedLogicalTable } from "flarex-protocol/internal/logical-schema-candidate";
import { compileLogicalStrongReferences } from "flarex-protocol/internal/logical-storage-requirements";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { runEffectTransaction } from "../../database/effectTransaction";
import type { PublishedPhysicalRequirementSnapshotV1 } from "../indexes/indexBuildReconciliation";
import type { readLogicalStorageRequirements } from "../catalog/logicalStorageDefinitions";
import { getStableLogicalIndexIdentityByNameEffect } from "../catalog/stableLogicalIndexCatalog";
import { getAppUniqueConstraintIdentityByNameEffect,
  locateAppUniqueConstraintDefinitionsForSchemaEffect } from "../unique/appUniqueConstraintDefinitions";
import type { StrongReferenceActivationProjection } from "../../installation/frameworkSchema/binding/strongReferenceProjection";

export class LogicalStrongReferenceProjectionError extends Data.TaggedError("LogicalStrongReferenceProjectionError")<{
  readonly reason: "incompleteCatalog" | "resourceFailure";
  readonly cause?: unknown;
}> {}

/** Prepare target-side publication policy from one authenticated control
 * snapshot. No target transaction or framework runtime supplies these facts. */
export const prepareLogicalStrongReferenceProjections = Effect.fn("LogicalStrongReferences.prepareProjection")(
  function (db: FlarexMetadataDatabase, deploymentId: string, scopeId: ScopeId,
    requirements: Effect.Success<ReturnType<typeof readLogicalStorageRequirements>>,
    definitions: PublishedPhysicalRequirementSnapshotV1["definitions"], reader?: FlarexMetadataTransaction) {
    const acquire = (tx: FlarexMetadataTransaction) => prepareLogicalStrongReferenceProjectionsFromReader(tx, deploymentId, scopeId, requirements, definitions);
    return reader === undefined ? runEffectTransaction<Effect.Success<ReturnType<typeof acquire>>, Effect.Error<ReturnType<typeof acquire>>,
      LogicalStrongReferenceProjectionError, FlarexMetadataTransaction>(callback => db.transaction(callback),
      "Logical strong reference catalog acquisition rolled back", acquire,
      cause => new LogicalStrongReferenceProjectionError({ reason: "resourceFailure", cause })) : acquire(reader);
  },
);

const prepareLogicalStrongReferenceProjectionsFromReader = Effect.fn("LogicalStrongReferences.prepareProjectionFromReader")(
  function* (db: FlarexMetadataTransaction, deploymentId: string, scopeId: ScopeId,
    requirements: Effect.Success<ReturnType<typeof readLogicalStorageRequirements>>,
    definitions: PublishedPhysicalRequirementSnapshotV1["definitions"]) {
    const { candidate } = requirements.evidence;
    const references = yield* Effect.fromResult(compileLogicalStrongReferences(candidate)).pipe(
      Effect.mapError(cause => new LogicalStrongReferenceProjectionError({ reason: "incompleteCatalog", cause })));
    if (references.length === 0) {
      const empty: readonly StrongReferenceActivationProjection[] = Object.freeze([]);
      return empty;
    }
    const tableId = (table: QualifiedLogicalTable) =>
      requirements.evidence.tableBindings.find(binding => logicalTableKey(binding.table) === logicalTableKey(table))?.tableId;
    const uniqueTableIds = [...new Set(references.map(extension => tableId(extension.target.table))
      .filter((id): id is NonNullable<typeof id> => id !== undefined))];
    const unique = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(db, deploymentId, scopeId,
      requirements.artifact.schemaVersionId, uniqueTableIds, requirements.unique.length)
      .pipe(Effect.mapError(cause => new LogicalStrongReferenceProjectionError({ reason: "resourceFailure", cause })));
    if (unique === null) return yield* Effect.fail(new LogicalStrongReferenceProjectionError({ reason: "incompleteCatalog" }));
    const projected: StrongReferenceActivationProjection[] = [];
    for (const extension of references) {
      const sourceTableId = tableId(extension.source.table);
      const targetTableId = tableId(extension.target.table);
      if (sourceTableId === undefined || targetTableId === undefined)
        return yield* Effect.fail(new LogicalStrongReferenceProjectionError({ reason: "incompleteCatalog" }));
      const reverse = requirements.ordered.find(index => index.tableId === sourceTableId &&
        index.physicalSpec.predicate === undefined && index.physicalSpec.orderedFields[0]?.kind === "documentPath" &&
        index.physicalSpec.orderedFields[0].path === extension.source.field &&
        index.physicalSpec.orderedFields[0].valueFormat !== "exactDecimal");
      if (reverse === undefined) return yield* Effect.fail(new LogicalStrongReferenceProjectionError({ reason: "incompleteCatalog" }));
      const stableIndex = yield* getStableLogicalIndexIdentityByNameEffect(db, {
        deploymentId, tableId: sourceTableId, descriptor: reverse.descriptor,
      }).pipe(Effect.mapError(cause => new LogicalStrongReferenceProjectionError({ reason: "resourceFailure", cause })));
      const definition = definitions.find(member => member.access.kind === "developer" &&
        member.access.logicalIndexId === stableIndex?.logicalIndexId && member.tableId === sourceTableId);
      if (definition === undefined) return yield* Effect.fail(new LogicalStrongReferenceProjectionError({ reason: "incompleteCatalog" }));

      const targetSource = candidate.sources.find(source => source.bindings.some(binding =>
        binding.kind === "definition" && logicalTableKey(binding.table) === logicalTableKey(extension.target.table)));
      if (targetSource === undefined) return yield* Effect.fail(new LogicalStrongReferenceProjectionError({ reason: "incompleteCatalog" }));
      let targetIdentity: StrongReferenceActivationProjection["targetIdentity"];
      if (targetSource.definition.kind === "documents") {
        targetIdentity = { kind: "documentId", logicalTableName: extension.target.table.logicalName };
      } else {
        const table = targetSource.definition.schema.tables.find(member =>
          targetSource.bindings.some(binding => binding.kind === "definition" &&
            binding.localName === member.identity.tableId && logicalTableKey(binding.table) === logicalTableKey(extension.target.table)));
        const primary = table?.keys.find(key => key.kind === "primary" && key.columns.length === 1 &&
          key.columns[0]?.columnId === extension.target.field);
        const descriptor = primary === undefined ? undefined : `key/${primary.identity.keyId}`;
        const requirement = requirements.unique.find(member => member.tableId === targetTableId &&
          member.descriptor === descriptor);
        if (requirement === undefined) return yield* Effect.fail(new LogicalStrongReferenceProjectionError({ reason: "incompleteCatalog" }));
        const stableUnique = yield* getAppUniqueConstraintIdentityByNameEffect(db, {
          deploymentId, tableId: targetTableId, descriptor: requirement.descriptor,
        }).pipe(Effect.mapError(cause => new LogicalStrongReferenceProjectionError({ reason: "resourceFailure", cause })));
        const located = unique.find(member => member.logicalUniqueConstraintId === stableUnique?.logicalUniqueConstraintId &&
          member.tableId === targetTableId);
        if (located === undefined) return yield* Effect.fail(new LogicalStrongReferenceProjectionError({ reason: "incompleteCatalog" }));
        targetIdentity = { kind: "textPrimaryKey", uniqueConstraintDefinitionId: located.uniqueConstraintDefinitionId };
      }
      projected.push(Object.freeze({ name: extension.name, sourceTableId, sourceField: extension.source.field,
        sourceLiveness: extension.liveness.source,
        reverseIndex: Object.freeze({ indexDefinitionId: definition.indexDefinitionId,
          physicalSpec: reverse.physicalSpec, physicalSpecSha256Hex: definition.physicalSpecSha256Hex }),
        targetTableId, targetField: extension.target.field, targetLiveness: extension.liveness.target,
        ...(extension.onTargetSoftDelete === undefined ? {} : { onTargetSoftDelete: extension.onTargetSoftDelete }),
        targetIdentity, onTargetDelete: extension.onTargetDelete }));
    }
    return Object.freeze(projected);
  },
);
