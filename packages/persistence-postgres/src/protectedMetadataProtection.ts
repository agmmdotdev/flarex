import { getTableName, sql, type SQL } from "drizzle-orm";
import { fxControlTables, fxControlIndexes, fxControlIndexDefinitions,
  fxControlSchemaVersionIndexBindings, fxControlRelations, fxControlEdgeDefinitions,
  fxControlSchemaVersionRelationBindings, fxControlBoundApplicationSchemas,
  fxControlApplicationManifestSchemaBindings, fxControlUniqueConstraints, fxControlUniqueConstraintDefinitions,
  fxControlSchemaVersionUniqueConstraintBindings, fxControlSchemaVersionUniqueConstraintSets,
  fxControlApplicationSchemaAuthoritiesV1, fxSystemAppSchemaCandidateValidations,
  fxSystemEdgeDefinitionReadiness, fxSystemApplicationRelationSemanticReadiness,
  fxControlSchemaVersions, fxSystemApplicationCandidatesV1, fxSystemApplicationAnalysesV1,
  fxSystemApplicationRevisionsV2, fxSystemApplicationPublicationsV1, fxSystemApplicationFunctionsV1,
  fxSystemApplicationTaskCatalogsV1, fxSystemApplicationTaskDefinitionsV1, fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationReadinessV1, fxSystemApplicationReadinessFunctionsV1,
  fxControlLogicalReadSources, fxControlLogicalReadTables, fxControlLogicalReadAccess } from "./schema";
import { fxSystemApplicationPublications, fxSystemApplicationFunctions, fxSystemApplicationTaskCatalogs,
  fxSystemApplicationTaskDefinitions, fxSystemApplicationRevisionSchemas, fxSystemApplicationReadiness,
  fxSystemApplicationReadinessRelations, fxSystemApplicationReadinessFunctions } from "./applicationRelationSchema";
import { fxSystemApplicationActivations, fxSystemApplicationActiveHeads, fxSystemApplicationReadBindings } from "./applicationActivationSchema";
import { fxSystemApplicationWriteOwnership } from "./applicationWriteOwnership/Schema";
import { fxSystemDataBindingCandidates, fxSystemDataBindingPhysicalLanes, fxSystemDataBindingActivations } from "./frameworkSchema/binding/schema";

/** Immutable target/control projection and complete sidecar membership.
 * Mutable coverage, build/lifecycle heads and live authority keep fresh proofs. */
export const protectedReadinessMetadataTables = Object.freeze([
  fxControlTables, fxControlIndexes, fxControlIndexDefinitions, fxControlSchemaVersionIndexBindings,
  fxControlRelations, fxControlEdgeDefinitions, fxControlSchemaVersionRelationBindings,
  fxControlBoundApplicationSchemas, fxControlApplicationManifestSchemaBindings,
  fxControlUniqueConstraints, fxControlUniqueConstraintDefinitions, fxControlSchemaVersionUniqueConstraintBindings,
  fxControlSchemaVersionUniqueConstraintSets, fxControlApplicationSchemaAuthoritiesV1,
  fxSystemAppSchemaCandidateValidations, fxSystemEdgeDefinitionReadiness, fxSystemApplicationRelationSemanticReadiness,
]);
export const protectedMetadataTableNames = Object.freeze([
  fxControlSchemaVersions,
  ...protectedReadinessMetadataTables,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationRevisionsV2,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationReadinessFunctionsV1,
  fxSystemApplicationPublications,
  fxSystemApplicationFunctions,
  fxSystemApplicationTaskCatalogs,
  fxSystemApplicationTaskDefinitions,
  fxSystemApplicationRevisionSchemas,
  fxSystemApplicationReadiness,
  fxSystemApplicationReadinessRelations,
  fxSystemApplicationReadinessFunctions,
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
  fxSystemApplicationWriteOwnership,
  fxSystemDataBindingCandidates,
  fxSystemDataBindingPhysicalLanes,
  fxSystemDataBindingActivations,
  fxSystemApplicationReadBindings,
  fxControlLogicalReadSources,
  fxControlLogicalReadTables,
  fxControlLogicalReadAccess,
].map(getTableName));

/** An inherited write can change a parent-readable row without firing its
 * statement invalidation trigger. Both sides of every covered relation must
 * have no inheritance edge, including relations outside the installed schema. */
export function protectedMetadataHasNoInheritanceSql(namespaceOid: SQL): SQL<boolean> {
  const names = sql`ARRAY[${sql.join(protectedMetadataTableNames.map(name => sql`${name}`), sql`, `)}]::text[]`;
  return sql<boolean>`not exists (
    select 1 from pg_catalog.pg_inherits inheritance
    join pg_catalog.pg_class covered on
      covered.oid = inheritance.inhrelid or covered.oid = inheritance.inhparent
    where covered.relnamespace = ${namespaceOid}
      and covered.relname = any(${names})
  )`;
}
