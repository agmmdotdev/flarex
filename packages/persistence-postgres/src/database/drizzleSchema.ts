/**
 * Drizzle Kit's authoritative live schema surface.
 *
 * Historical table objects can remain importable from `schema.ts` for the
 * explicitly retained migration-drain readers without making Drizzle treat
 * those displaced tables as part of a fresh deployment.
 */
export { fxSystemCommitPayloadPreferenceDeletions } from "../frameworks/payloadPreferences/factsSchema";
export { fxSystemCommitRelationalChanges } from "../commit/publication/relationalFactsSchema";
export { fxSystemFrameworkInitializations } from "../installation/frameworkSchema/installation/initializationSchema";
export { fxSystemLogicalSourceInitializations } from "../storage/catalog/logicalStorageInitialization";
export {
  commits,
  deploymentPackages,
  deployments,
  documentFreshnessVersions,
  documents,
  freshnessProcessedEvents,
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
  fxAppIndexEntryCurrent,
  fxAppIndexEntryRevisions,
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxAppSearchEntryCurrent,
  fxAppJsonEntryCurrent,
  fxAppUniqueKeys,
  fxControlApplicationSchemaAuthoritiesV1,
  fxControlApplicationManifestSchemaBindings,
  fxControlBoundApplicationSchemas,
  fxControlEdgeDefinitions,
  fxControlIndexDefinitions,
  fxControlIndexes,
  fxControlRelations,
  fxControlSchemaVersionRelationBindings,
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersionUniqueConstraintBindings,
  fxControlSchemaVersionUniqueConstraintSets,
  fxControlSchemaVersions,
  fxControlScopeProvisioning,
  fxControlScopes,
  fxControlTables,
  fxControlUniqueConstraintDefinitions,
  fxControlUniqueConstraints,
  fxSystemApplicationActionInvocationsV1,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationReadinessFunctionsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationRelationSemanticReadiness,
  fxSystemApplicationRelationSemanticValidations,
  fxSystemEdgeDefinitionBuilds,
  fxSystemEdgeDefinitionReadiness,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationRevisionsV2,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
  fxSystemAppSchemaCandidateValidations,
  fxSystemCommitAppRowChanges,
  fxSystemCommitRelationAdjacencyChanges,
  fxSystemCommits,
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskComputeCancellationsV1,
  fxSystemDurableTaskComputeDispatchesV1,
  fxSystemDurableTaskComputePendingV1,
  fxSystemDurableTaskDefinitionRevisionsV1,
  fxSystemTrustedWorkflowTaskBindings,
  fxSystemDurableTaskRepairSchedulerV1,
  fxSystemDurableTaskRequestedEffectsV1,
  fxSystemDurableTaskRunRequestsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemExternalEffectAttemptsV1,
  fxSystemIdempotency,
  fxSystemIndexMaintenanceObligations,
  fxSystemUniqueMaintenanceObligations,
  fxSystemIndexBuildStates,
  fxSystemPhysicalDefinitionLifecycles,
  fxSystemCommitWakes,
  fxSystemPointMutationRedeliveryScheduler,
  fxSystemPreparedMetadataEpoch,
  fxSystemRetainedHistoryScheduler,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
  fxSystemMetadataContractObservations,
  fxSystemSearchBuildStates,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionSessions,
  fxSystemUniqueConstraintBuilds,
  indexes,
  invokeSessionDocumentReads,
  invokeSessionDocumentWrites,
  invokeSessionIndexReads,
  invokeSessions,
  invokeSessionTableReads,
  leases,
  liveQueryConnections,
  liveQueryDeliveries,
  liveQuerySubscriptions,
  outbox,
  persistenceGlobals,
  readOnly,
  tableFreshnessVersions,
} from "./schema";

export {
  fxSystemApplicationFunctions,
  fxSystemApplicationPublications,
  fxSystemApplicationReadiness,
  fxSystemApplicationReadinessFunctions,
  fxSystemApplicationReadinessRelations,
  fxSystemApplicationRevisionSchemas,
  fxSystemApplicationTaskCatalogs,
  fxSystemApplicationTaskDefinitions,
} from "../application/relations/applicationRelationSchema";

export {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "../application/applicationActivationSchema";

export {
  fxControlFrameworkSchemaArtifactDependencies,
  fxControlFrameworkSchemaArtifacts,
} from "../installation/frameworkSchema/artifact/schema";

export {
  fxSystemFrameworkSchemaAvailabilityHeads,
  fxSystemFrameworkSchemaAvailabilityHistory,
  fxSystemFrameworkSchemaInstallations,
  fxSystemFrameworkSchemaReadiness,
} from "../installation/frameworkSchema/installation/schema";

export {
  fxSystemFrameworkMigrationAdmissionAssignments,
  fxSystemFrameworkMigrationAttemptStarts,
  fxSystemFrameworkMigrationAttemptTerminals,
  fxSystemFrameworkMigrationCollisionDomains,
  fxSystemFrameworkMigrationCollisionHeads,
  fxSystemFrameworkMigrationEvents,
  fxSystemFrameworkMigrationPlanAdmissions,
  fxSystemFrameworkMigrationPlans,
  fxSystemFrameworkMigrationPlanStepDependencies,
  fxSystemFrameworkMigrationPlanSteps,
  fxSystemFrameworkMigrationStepReceiptDependencies,
  fxSystemFrameworkMigrationStepReceipts,
  fxSystemFrameworkSchemaTargetNamespaces,
  fxSystemRelationalPhysicalNameAssignments,
} from "../installation/migrationCoordination/schema";
export { fxSystemFrameworkMigrationPlanBases } from "../installation/migrationCoordination/baseSchema";
export { fxSystemApplicationWriteOwnership } from "../application/ownership/Schema";
export { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../commit/events/schema";
export { fxSystemDataBindingCandidates, fxSystemDataBindingPhysicalLanes,
  fxSystemDataBindingActivations, fxSystemDataBindingHeads } from "../installation/frameworkSchema/binding/schema";
