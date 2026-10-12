/** Explicit declaration surface and driver schema composition. Declaration owners import each other directly. */
export type { MaintenanceAuthorityKind } from "./schema/buildReadiness";
import { deployments, fxControlSchemaVersions, fxControlTables } from "./schema/catalogIdentity";
import {
  fxControlIndexes,
  fxControlIndexDefinitions,
  fxControlSchemaVersionIndexBindings,
} from "./schema/catalogIndexes";
import {
  fxControlUniqueConstraints,
  fxControlUniqueConstraintDefinitions,
  fxControlSchemaVersionUniqueConstraintBindings,
  fxControlSchemaVersionUniqueConstraintSets,
} from "./schema/catalogUniqueConstraints";
import { fxControlApplicationSchemaAuthoritiesV1 } from "./schema/catalogApplicationBindings";
import {
  fxControlLogicalReadSources,
  fxControlLogicalReadTables,
  fxControlLogicalReadAccess,
} from "./schema/catalogLogicalReads";
import { fxControlScopes, fxControlScopeProvisioning } from "./schema/controlScopes";
import {
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
  fxSystemMetadataContractObservations,
} from "./schema/scope";
import { fxSystemInstallation, fxSystemInstallationRuntime } from "./schema/installation";
import { fxSystemTransactionSessions, fxSystemSnapshotLeases } from "./schema/transactionSessions";
import {
  fxSystemTransactionJournals,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalWriteEvents,
} from "./schema/transactionJournals";
import { fxAppRowRevisions, fxAppRowCurrent } from "./schema/documents";
import {
  fxAppIndexEntryRevisions,
  fxAppIndexEntryCurrent,
  fxAppUniqueKeys,
} from "./schema/documentIndexes";
import { fxAppEdgeCurrent, fxAppEdgeAdjacencyVersions } from "./schema/relations";
import {
  fxSystemIndexMaintenanceObligations,
  fxSystemUniqueMaintenanceObligations,
  fxSystemIndexBuildStates,
  fxSystemPhysicalDefinitionLifecycles,
  fxSystemUniqueConstraintBuilds,
  fxSystemAppSchemaCandidateValidations,
} from "./schema/buildReadiness";
import {
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationRevisionsV2,
} from "./schema/applicationRevisions";
import {
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationReadinessFunctionsV1,
} from "./schema/applicationLegacyPublications";
import {
  fxSystemApplicationActionInvocationsV1,
  fxSystemExternalEffectAttemptsV1,
} from "./schema/applicationEffects";
import {
  fxSystemDurableTaskRepairSchedulerV1,
  fxSystemDurableTaskDefinitionRevisionsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemDurableTaskRunRequestsV1,
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskRequestedEffectsV1,
} from "./schema/taskRuns";
import {
  fxSystemDurableTaskComputePendingV1,
  fxSystemDurableTaskComputeDispatchesV1,
  fxSystemDurableTaskComputeCancellationsV1,
} from "./schema/taskCompute";
import { fxSystemPointMutationRedeliveryScheduler } from "./schema/executionRecovery";
import {
  deploymentPackages,
  documents,
  indexes,
  leases,
  readOnly,
  persistenceGlobals,
  commits,
  outbox,
} from "./schema/legacyPersistence";
import {
  freshnessProcessedEvents,
  documentFreshnessVersions,
  tableFreshnessVersions,
  liveQuerySubscriptions,
  liveQueryConnections,
  liveQueryDeliveries,
} from "./schema/sync";
import {
  invokeSessions,
  invokeSessionDocumentReads,
  invokeSessionTableReads,
  invokeSessionIndexReads,
  invokeSessionDocumentWrites,
} from "./schema/legacyInvokeSessions";

export { bytea } from "./schema/primitives";
export { deployments, fxControlSchemaVersions, fxControlTables } from "./schema/catalogIdentity";
export {
  fxControlIndexes,
  fxControlIndexDefinitions,
  fxControlSchemaVersionIndexBindings,
} from "./schema/catalogIndexes";
export {
  fxControlUniqueConstraints,
  fxControlUniqueConstraintDefinitions,
  fxControlSchemaVersionUniqueConstraintBindings,
  fxControlSchemaVersionUniqueConstraintSets,
} from "./schema/catalogUniqueConstraints";
export {
  fxControlRelations,
  fxControlEdgeDefinitions,
  fxControlSchemaVersionRelationBindings,
} from "./schema/catalogRelations";
export {
  fxControlBoundApplicationSchemas,
  fxControlApplicationManifestSchemaBindings,
  fxControlApplicationSchemaAuthoritiesV1,
} from "./schema/catalogApplicationBindings";
export {
  fxControlLogicalReadSources,
  fxControlLogicalReadTables,
  fxControlLogicalReadAccess,
} from "./schema/catalogLogicalReads";
export { fxControlScopes, fxControlScopeProvisioning } from "./schema/controlScopes";
export {
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
  fxSystemMetadataContractObservations,
} from "./schema/scope";
export {
  fxSystemInstallation,
  fxSystemInstallationRuntime,
  fxSystemPreparedMetadataEpoch,
} from "./schema/installation";
export {
  type CommitWakeOutboxDeliveryStateV1,
  type CommitWakeOutboxFailureCodeV1,
  fxSystemCommits,
  fxSystemIdempotency,
  fxSystemCommitWakes,
} from "./schema/commitHeaders";
export {
  fxSystemCommitAppRowChanges,
  fxSystemCommitRelationAdjacencyChanges,
} from "./schema/commitFacts";
export { fxSystemTransactionSessions, fxSystemSnapshotLeases } from "./schema/transactionSessions";
export {
  fxSystemTransactionJournals,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalReceipts,
  transactionJournalPointDependencyCheck,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalWriteEvents,
} from "./schema/transactionJournals";
export { fxAppRowRevisions, fxAppRowCurrent } from "./schema/documents";
export {
  fxAppSearchEntryCurrent,
  fxAppJsonEntryCurrent,
  fxAppIndexEntryRevisions,
  fxAppIndexEntryCurrent,
  fxAppUniqueKeys,
} from "./schema/documentIndexes";
export { fxAppEdgeCurrent, fxAppEdgeAdjacencyVersions } from "./schema/relations";
export {
  fxSystemEdgeDefinitionBuilds,
  fxSystemEdgeDefinitionReadiness,
  fxSystemApplicationRelationSemanticValidations,
  fxSystemApplicationRelationSemanticReadiness,
} from "./schema/relationReadiness";
export {
  fxSystemSearchBuildStates,
  fxSystemIndexMaintenanceObligations,
  fxSystemUniqueMaintenanceObligations,
  fxSystemIndexBuildStates,
  type PhysicalDefinitionLifecycleKindV1,
  type PhysicalDefinitionLifecycleV1,
  fxSystemPhysicalDefinitionLifecycles,
  fxSystemUniqueConstraintBuilds,
  fxSystemAppSchemaCandidateValidations,
} from "./schema/buildReadiness";
export {
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationRevisionsV2,
} from "./schema/applicationRevisions";
export {
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationReadinessFunctionsV1,
} from "./schema/applicationLegacyPublications";
export {
  fxSystemApplicationActionInvocationsV1,
  fxSystemExternalEffectAttemptsV1,
} from "./schema/applicationEffects";
export {
  fxSystemDurableTaskRepairSchedulerV1,
  fxSystemDurableTaskDefinitionRevisionsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemDurableTaskRunRequestsV1,
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskRequestedEffectsV1,
} from "./schema/taskRuns";
export {
  fxSystemDurableTaskComputePendingV1,
  fxSystemDurableTaskComputeDispatchesV1,
  fxSystemDurableTaskComputeCancellationsV1,
} from "./schema/taskCompute";
export { fxSystemPointMutationRedeliveryScheduler } from "./schema/executionRecovery";
export { fxSystemRetainedHistoryScheduler } from "./schema/retainedHistory";
export {
  deploymentPackages,
  documents,
  indexes,
  leases,
  readOnly,
  persistenceGlobals,
  commits,
  outbox,
} from "./schema/legacyPersistence";
export {
  freshnessProcessedEvents,
  documentFreshnessVersions,
  tableFreshnessVersions,
  liveQuerySubscriptions,
  liveQueryConnections,
  liveQueryDeliveries,
} from "./schema/sync";
export {
  invokeSessions,
  invokeSessionDocumentReads,
  invokeSessionTableReads,
  invokeSessionIndexReads,
  invokeSessionDocumentWrites,
} from "./schema/legacyInvokeSessions";
export { fxSystemDeclarativeV2Candidates } from "./schema/legacyDeclarativeCandidate";
export {
  fxSystemDeclarativeV2RuntimeProjections,
  fxSystemDeclarativeV2RuntimeProjectionModules,
  fxSystemDeclarativeV2FunctionGroupManifests,
  fxSystemDeclarativeV2FunctionGroupEntries,
} from "./schema/legacyDeclarativeRuntime";
export {
  fxSystemDeclarativeV2VerifierAttemptsV2,
  fxSystemDeclarativeV2VerifierCommandsV2,
  fxSystemDeclarativeV2VerifierCommandAuthorityV1,
  fxSystemDeclarativeV2VerifierEvidencePagesV2,
} from "./schema/legacyDeclarativeVerifier";
export {
  fxSystemApplicationRevisionsV1,
  fxSystemApplicationRevisionRequestsV1,
} from "./schema/legacyApplicationRevision";
export {
  fxSystemDeclarativeV2Verdicts,
  fxSystemDeclarativeV2ActivationRevisions,
  fxSystemDeclarativeV2ActivationHeads,
} from "./schema/legacyDeclarativeActivation";

export const flarexSchema = {
  fxControlLogicalReadSources,
  fxControlLogicalReadTables,
  fxControlLogicalReadAccess,
  fxSystemInstallation,
  fxSystemInstallationRuntime,
  commits,
  deploymentPackages,
  deployments,
  documentFreshnessVersions,
  documents,
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxAppIndexEntryCurrent,
  fxAppIndexEntryRevisions,
  fxAppUniqueKeys,
  fxControlIndexDefinitions,
  freshnessProcessedEvents,
  fxControlIndexes,
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersionUniqueConstraintBindings,
  fxControlSchemaVersionUniqueConstraintSets,
  fxControlSchemaVersions,
  fxControlTables,
  fxControlUniqueConstraintDefinitions,
  fxControlUniqueConstraints,
  fxControlScopeProvisioning,
  fxControlScopes,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationReadinessFunctionsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationRevisionsV2,
  fxControlApplicationSchemaAuthoritiesV1,
  fxSystemApplicationActionInvocationsV1,
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskComputeCancellationsV1,
  fxSystemDurableTaskComputeDispatchesV1,
  fxSystemDurableTaskComputePendingV1,
  fxSystemDurableTaskDefinitionRevisionsV1,
  fxSystemDurableTaskRequestedEffectsV1,
  fxSystemDurableTaskRunRequestsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemIndexMaintenanceObligations,
  fxSystemUniqueMaintenanceObligations,
  fxSystemIndexBuildStates,
  fxSystemPhysicalDefinitionLifecycles,
  fxSystemAppSchemaCandidateValidations,
  fxSystemUniqueConstraintBuilds,
  fxSystemExternalEffectAttemptsV1,
  fxSystemSnapshotLeases,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
  fxSystemMetadataContractObservations,
  fxSystemPointMutationRedeliveryScheduler,
  fxSystemDurableTaskRepairSchedulerV1,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionSessions,
  indexes,
  invokeSessionDocumentReads,
  invokeSessionTableReads,
  invokeSessionIndexReads,
  invokeSessionDocumentWrites,
  invokeSessions,
  leases,
  liveQueryConnections,
  liveQueryDeliveries,
  liveQuerySubscriptions,
  outbox,
  persistenceGlobals,
  readOnly,
  tableFreshnessVersions,
};
