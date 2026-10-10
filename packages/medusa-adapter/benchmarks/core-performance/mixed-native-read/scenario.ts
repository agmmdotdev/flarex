import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { expect } from "vitest";
import { ProductStatus } from "@medusajs/framework/utils/portable";
import type { IProductModuleService } from "@medusajs/framework/types";
import type {
  CommerceTransactionError,
} from "../../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { PrivateProductAttemptExecution } from "../../../src/product-attempt";
import { productAttemptSeed } from "../../../test/support/product-attempt-seed";
import {
  createMixedMutationPerformanceTrace,
  type TraceDispatchRecord,
  type TraceInvocationRecord,
} from "../../../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";
import {
  prepareMixedMutationPerformanceSeries,
} from "../../../../flarex-backend/test/support/mixedMutationWorkerdFixture";
import {
  makeNativeProductOperationDiagnostics,
} from "../../../../executor/test/performance/support/nativeProductOperationDiagnostics";
import { observeRetrievalPgClients, type RetrievalObservation } from "../native-retrieval/observation";
import { readRetrievalRuntimeSettings, openRetrievalServerObserver, retrievalServerDifference,
  selectRetrievalServerDatabases, requireRetrievalServerObservedCalls } from "../native-retrieval/server";
import {
  BenchmarkCpuProfiler,
  CPU_SAMPLING_INTERVAL_MICROSECONDS,
} from "../../../../executor/test/performance/support/benchmarkCpuProfiler";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const sources = [
  "packages/medusa-adapter/benchmarks/core-performance/mixed-native-read/scenario.ts",
  "packages/executor/test/performance/support/benchmarkCpuProfiler.ts",
  "packages/flarex-backend/test/support/mixedMutationWorkerdFixture.ts",
  "packages/flarex-backend/test/support/mixedMutationWorkerdAdapter.ts",
  "packages/executor/test/performance/support/mixedMutationProductFixture.ts",
  "packages/medusa-adapter/test/support/logical-currency-fixture.ts",
  "packages/persistence-postgres/test/support/postgresHelpers.ts",
  "packages/executor/test/performance/support/mixedMutationInProcessRuntime.ts",
  "packages/executor/test/performance/support/nativeProductOperationDiagnostics.ts",
  "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.ts",
  "packages/persistence-postgres/src/execution/preparation/preparedHostRuntime.ts",
  "packages/persistence-postgres/test/performance/mixedMutationPerformanceTrace.ts",
  "packages/persistence-postgres/test/storage/documents/logicalReadMetadataScalingTestSupport.ts",
  "packages/persistence-postgres/src/scope/scopeAuthorityControlRead.ts",
  "packages/persistence-postgres/src/scope/scopeClock.ts",
  "packages/persistence-postgres/src/execution/finiteAttemptAnchor.ts",
  "packages/persistence-postgres/src/installation/scopeExecutionAuthorityInstallation.ts",
  "packages/persistence-postgres/drizzle/0126_finite_execution_authority.sql",
  "packages/persistence-postgres/drizzle/0128_finite_storage_frontier.sql",
  "packages/persistence-postgres/drizzle/0129_finite_storage_reads.sql",
  "packages/persistence-postgres/drizzle/0130_finite_storage_capture.sql",
  "packages/persistence-postgres/drizzle/0131_finite_entry.sql",
  "packages/persistence-postgres/drizzle/0132_finite_historical_identity.sql",
  "packages/persistence-postgres/drizzle/0133_publication_domain.sql",
  "packages/persistence-postgres/src/execution/finiteStorageCapture.ts",
  "packages/persistence-postgres/src/commit/finitePublicationInstallation.ts",
  "packages/persistence-postgres/src/commit/finitePublicationObservation.ts",
  "packages/persistence-postgres/src/storage/materialization/materialization.ts",
  "packages/persistence-postgres/src/storage/materialization/domainApplication.ts",
  "packages/persistence-postgres/src/storage/materialization/domainInstallation.ts",
  "packages/persistence-postgres/src/storage/materialization/domainCoverage.ts",
  "packages/persistence-postgres/src/storage/unique/appUniqueKeys.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/searchEntries.ts",
  "packages/persistence-postgres/src/commit/publication/publication.ts",
  "packages/persistence-postgres/src/commit/publication/installation.ts",
  "packages/persistence-postgres/src/commit/publication/prefixInstallation.ts",
  "packages/persistence-postgres/src/commit/publication/prefixProjection.ts",
  "packages/persistence-postgres/src/commit/publication/prefixWriter.ts",
  "packages/persistence-postgres/src/commit/publication/scopePublicationModel.ts",
  "packages/persistence-postgres/src/execution/finiteEntryObservation.ts",
  "packages/persistence-postgres/src/execution/finiteEntryCompletionInstallation.ts",
  "packages/persistence-postgres/src/execution/finiteMetadataComparison.ts",
  "packages/persistence-postgres/src/database/physicalSession/postgres.ts",
  "packages/persistence-postgres/src/database/physicalSession/deadline.ts",
  "packages/persistence-postgres/src/database/physicalSession/drizzle.ts",
  "packages/persistence-postgres/src/database/postgres.ts",
  "packages/persistence-postgres/src/database/pglite.ts",
  "packages/persistence-postgres/src/database/schema.ts",
  "packages/persistence-postgres/src/database/schema/applicationEffects.ts",
  "packages/persistence-postgres/src/database/schema/applicationLegacyPublications.ts",
  "packages/persistence-postgres/src/database/schema/applicationRevisions.ts",
  "packages/persistence-postgres/src/database/schema/buildReadiness.ts",
  "packages/persistence-postgres/src/database/schema/catalogApplicationBindings.ts",
  "packages/persistence-postgres/src/database/schema/catalogIdentity.ts",
  "packages/persistence-postgres/src/database/schema/catalogIndexes.ts",
  "packages/persistence-postgres/src/database/schema/catalogLogicalReads.ts",
  "packages/persistence-postgres/src/database/schema/catalogRelations.ts",
  "packages/persistence-postgres/src/database/schema/catalogUniqueConstraints.ts",
  "packages/persistence-postgres/src/database/schema/commitFacts.ts",
  "packages/persistence-postgres/src/database/schema/commitHeaders.ts",
  "packages/persistence-postgres/src/database/schema/controlScopes.ts",
  "packages/persistence-postgres/src/database/schema/documentIndexes.ts",
  "packages/persistence-postgres/src/database/schema/documents.ts",
  "packages/persistence-postgres/src/database/schema/executionRecovery.ts",
  "packages/persistence-postgres/src/database/schema/installation.ts",
  "packages/persistence-postgres/src/database/schema/legacyApplicationRevision.ts",
  "packages/persistence-postgres/src/database/schema/legacyDeclarativeActivation.ts",
  "packages/persistence-postgres/src/database/schema/legacyDeclarativeCandidate.ts",
  "packages/persistence-postgres/src/database/schema/legacyDeclarativeRuntime.ts",
  "packages/persistence-postgres/src/database/schema/legacyDeclarativeVerifier.ts",
  "packages/persistence-postgres/src/database/schema/legacyInvokeSessions.ts",
  "packages/persistence-postgres/src/database/schema/legacyPersistence.ts",
  "packages/persistence-postgres/src/database/schema/primitives.ts",
  "packages/persistence-postgres/src/database/schema/relationReadiness.ts",
  "packages/persistence-postgres/src/database/schema/relations.ts",
  "packages/persistence-postgres/src/database/schema/retainedHistory.ts",
  "packages/persistence-postgres/src/database/schema/scope.ts",
  "packages/persistence-postgres/src/database/schema/sync.ts",
  "packages/persistence-postgres/src/database/schema/taskCompute.ts",
  "packages/persistence-postgres/src/database/schema/taskRuns.ts",
  "packages/persistence-postgres/src/database/schema/transactionJournals.ts",
  "packages/persistence-postgres/src/database/schema/transactionSessions.ts",
  "packages/persistence-postgres/src/storage/indexes/indexBuildStates.ts",
  "packages/persistence-postgres/src/execution/finiteMetadataDependencies.ts",
  "packages/persistence-postgres/src/execution/finiteMetadataReservation.ts",
  "packages/persistence-postgres/src/execution/session/kernelContracts.ts",
  "packages/persistence-postgres/src/database/locatedTransactionIdentity.ts",
  "packages/persistence-postgres/src/execution/session/errors.ts",
  "packages/persistence-postgres/src/execution/session/errorProjections.ts",
  "packages/persistence-postgres/src/installation/physicalDefinitionRetirementPins.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/documentAdmission.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalAdmission.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/readAdmission.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/rootEvaluator.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/journalEvidence.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/commitEvidence.ts",
  "packages/persistence-postgres/src/installation/frameworkSchema/binding/repository.ts",
  "packages/persistence-postgres/src/installation/frameworkSchema/binding/host.ts",
  "packages/persistence-postgres/src/installation/frameworkSchema/binding/canonical.ts",
  "packages/persistence-postgres/src/installation/frameworkSchema/binding/model.ts",
  "packages/persistence-postgres/src/installation/frameworkSchema/binding/logicalSchema.ts",
  "packages/persistence-postgres/src/frameworks/commerceTransaction/admission.ts",
  "packages/persistence-postgres/src/frameworks/commerceTransaction/logicalInitialization.ts",
  "packages/persistence-postgres/src/frameworks/commerceTransaction/host.ts",
  "packages/persistence-postgres/src/frameworks/atomicCommerce/admission.ts",
  "packages/persistence-postgres/src/frameworks/crossDomainCommand/host.ts",
  "packages/persistence-postgres/src/application/activation/acceptedBinding.ts",
  "packages/persistence-postgres/src/application/activation/activationPersistence.ts",
  "packages/persistence-postgres/src/application/activation/activeRead.ts",
  "packages/persistence-postgres/src/application/activation/bindingAcceptance.ts",
  "packages/persistence-postgres/src/application/activation/bindingPreparation.ts",
  "packages/persistence-postgres/src/application/activation/capture.ts",
  "packages/persistence-postgres/src/application/activation/constructionContracts.ts",
  "packages/persistence-postgres/src/application/activation/contracts.ts",
  "packages/persistence-postgres/src/application/activation/currentBinding.ts",
  "packages/persistence-postgres/src/application/activation/currentEntryIdentity.ts",
  "packages/persistence-postgres/src/application/activation/databaseBoundary.ts",
  "packages/persistence-postgres/src/application/activation/errors.ts",
  "packages/persistence-postgres/src/application/activation/finiteIdentity.ts",
  "packages/persistence-postgres/src/application/activation/finitePreparation.ts",
  "packages/persistence-postgres/src/application/activation/headCapture.ts",
  "packages/persistence-postgres/src/application/activation/limits.ts",
  "packages/persistence-postgres/src/application/activation/metadataProjection.ts",
  "packages/persistence-postgres/src/application/activation/readBindingPublication.ts",
  "packages/persistence-postgres/src/application/activation/repository.ts",
  "packages/persistence-postgres/src/application/activation/repositoryIdentity.ts",
  "packages/persistence-postgres/src/application/activation/selectionIdentity.ts",
  "packages/persistence-postgres/src/application/activation/standaloneBinding.ts",
  "packages/persistence-postgres/src/application/applicationActivationApi.ts",
  "packages/persistence-postgres/src/application/activeHead/contracts.ts",
  "packages/persistence-postgres/src/application/activeHead/errors.ts",
  "packages/persistence-postgres/src/application/activeHead/identity.ts",
  "packages/persistence-postgres/src/application/applicationBindingProjection.ts",
  "packages/persistence-postgres/src/application/applicationActiveHeadRead.ts",
  "packages/persistence-postgres/src/application/readiness/acceptance.ts",
  "packages/persistence-postgres/src/application/readiness/activationTarget.ts",
  "packages/persistence-postgres/src/application/readiness/bundle.ts",
  "packages/persistence-postgres/src/application/readiness/coldEvidence.ts",
  "packages/persistence-postgres/src/application/readiness/constructionContracts.ts",
  "packages/persistence-postgres/src/application/readiness/contracts.ts",
  "packages/persistence-postgres/src/application/readiness/controlSchema.ts",
  "packages/persistence-postgres/src/application/readiness/databaseBoundary.ts",
  "packages/persistence-postgres/src/application/readiness/errors.ts",
  "packages/persistence-postgres/src/application/readiness/frames.ts",
  "packages/persistence-postgres/src/application/readiness/identity.ts",
  "packages/persistence-postgres/src/application/readiness/limits.ts",
  "packages/persistence-postgres/src/application/readiness/outcomes.ts",
  "packages/persistence-postgres/src/application/readiness/persistence.ts",
  "packages/persistence-postgres/src/application/readiness/physicalCoverage.ts",
  "packages/persistence-postgres/src/application/readiness/preparation.ts",
  "packages/persistence-postgres/src/application/readiness/repository.ts",
  "packages/persistence-postgres/src/application/readiness/storedAuthority.ts",
  "packages/persistence-postgres/src/application/ownership/Capture.ts",
  "packages/persistence-postgres/src/application/ownership/Commit.ts",
  "packages/persistence-postgres/src/application/ownership/Repository.ts",
  "packages/persistence-postgres/src/application/ownership/Successor.ts",
  "packages/persistence-postgres/src/application/ownership/UniqueEvidence.ts",
  "packages/persistence-postgres/src/application/ownership/Policy.ts",
  "packages/persistence-postgres/src/application/ownership/Preparation.ts",
  "packages/persistence-postgres/src/application/relations/applicationRelationReadinessFold.ts",
  "packages/persistence-postgres/src/application/applicationStandaloneBinding.ts",
  "packages/persistence-postgres/src/storage/catalog/schemaVersionArtifacts.ts",
  "packages/persistence-postgres/src/storage/indexes/appIndexDefinitions.ts",
  "packages/persistence-postgres/src/storage/indexes/appIndexEntries.ts",
  "packages/persistence-postgres/src/storage/documents/appRows.ts",
  "packages/persistence-postgres/src/storage/unique/appUniqueConstraintDefinitions.ts",
  "packages/persistence-postgres/src/storage/unique/appUniqueConstraintCommitV1.ts",
  "packages/persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1.ts",
  "packages/persistence-postgres/src/storage/unique/appUniqueConstraintSetClosureV1.ts",
  "packages/persistence-postgres/src/storage/indexes/indexBuildReconciliation.ts",
  "packages/persistence-postgres/src/storage/indexes/indexMaintenance.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/indexReads.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts",
  "packages/persistence-postgres/src/storage/catalog/logicalStorageDefinitions.ts",
  "packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts",
  "packages/persistence-postgres/src/storage/search/logicalSearchBuild.ts",
  "packages/persistence-postgres/src/execution/sessionJournalStore.ts",
  "packages/persistence-postgres/src/execution/journal/api.ts",
  "packages/persistence-postgres/src/execution/journal/contracts.ts",
  "packages/persistence-postgres/src/execution/journal/construction.ts",
  "packages/persistence-postgres/src/execution/journal/errors.ts",
  "packages/persistence-postgres/src/execution/journal/state.ts",
  "packages/persistence-postgres/src/execution/journal/indexQueryPort.ts",
  "packages/persistence-postgres/src/execution/journal/finiteEntry.ts",
  "packages/persistence-postgres/src/execution/journal/finiteEntryActivation.ts",
  "packages/persistence-postgres/src/execution/journal/finiteEntryPublication.ts",
  "packages/persistence-postgres/src/execution/journal/frozenAttempt.ts",
  "packages/persistence-postgres/src/execution/journal/freezeClosedRoot.ts",
  "packages/persistence-postgres/src/execution/journal/attemptOwner.ts",
  "packages/persistence-postgres/src/execution/journal/codecs.ts",
  "packages/persistence-postgres/src/execution/journal/finiteRoot.ts",
  "packages/persistence-postgres/src/execution/journal/indexedQueries.ts",
  "packages/persistence-postgres/src/execution/journal/inputCapture.ts",
  "packages/persistence-postgres/src/execution/journal/journalFailures.ts",
  "packages/persistence-postgres/src/execution/journal/journalPersistence.ts",
  "packages/persistence-postgres/src/execution/journal/journalProjection.ts",
  "packages/persistence-postgres/src/execution/journal/operationModel.ts",
  "packages/persistence-postgres/src/execution/journal/participantOperations.ts",
  "packages/persistence-postgres/src/execution/journal/pointOperations.ts",
  "packages/persistence-postgres/src/execution/journal/receiptEvidence.ts",
  "packages/persistence-postgres/src/execution/journal/relationReads.ts",
  "packages/persistence-postgres/src/execution/journal/seal.ts",
  "packages/persistence-postgres/src/execution/journal/targetAdmission.ts",
  "packages/persistence-postgres/src/application/revision/applicationRevisionSyscallValidatorErrors.ts",
  "packages/persistence-postgres/src/storage/documents/pinnedPointTableErrors.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/participantErrors.ts",
  "packages/executor/src/mutation/journal/errors.ts",
  "packages/persistence-postgres/src/commit/authority/materialization.ts",
  "packages/persistence-postgres/src/application/applicationMutationAdmission.ts",
  "packages/persistence-postgres/src/database/effectTransaction.ts",
  "packages/persistence-postgres/src/commit/committedPointOutcomeErrors.ts",
  "packages/persistence-postgres/src/commit/point/attemptAcceptance.ts",
  "packages/persistence-postgres/src/commit/point/capabilities.ts",
  "packages/persistence-postgres/src/commit/point/capture.ts",
  "packages/persistence-postgres/src/commit/point/construction.ts",
  "packages/persistence-postgres/src/commit/point/constructionContracts.ts",
  "packages/persistence-postgres/src/commit/point/contracts.ts",
  "packages/persistence-postgres/src/commit/point/durablePublication.ts",
  "packages/persistence-postgres/src/commit/point/errors.ts",
  "packages/persistence-postgres/src/commit/point/finishing.ts",
  "packages/persistence-postgres/src/commit/point/finitePublication.ts",
  "packages/persistence-postgres/src/commit/point/limits.ts",
  "packages/persistence-postgres/src/commit/point/lockedState.ts",
  "packages/persistence-postgres/src/commit/point/lowering.ts",
  "packages/persistence-postgres/src/commit/point/observation.ts",
  "packages/persistence-postgres/src/commit/point/occ.ts",
  "packages/persistence-postgres/src/commit/point/participantProof.ts",
  "packages/persistence-postgres/src/commit/point/preparation.ts",
  "packages/persistence-postgres/src/commit/point/preparedCommands.ts",
  "packages/persistence-postgres/src/commit/point/promiseBoundary.ts",
  "packages/persistence-postgres/src/commit/point/relationRecovery.ts",
  "packages/persistence-postgres/src/commit/point/replacement.ts",
  "packages/persistence-postgres/src/commit/point/rollbackProof.ts",
  "packages/persistence-postgres/src/commit/point/sqlFailures.ts",
  "packages/persistence-postgres/src/commit/point/uniqueEligibility.ts",
  "packages/persistence-postgres/src/execution/claims/transactionExecutionClaimErrors.ts",
  "packages/persistence-postgres/src/execution/readCommittedTransactionFailure.ts",
  "packages/persistence-postgres/src/scope/scopeClockErrors.ts",
  "packages/persistence-postgres/src/storage/catalog/appSchemaCandidateWriteGuardErrors.ts",
  "packages/persistence-postgres/src/storage/documents/appRowErrors.ts",
  "packages/persistence-postgres/src/storage/indexes/appIndexEntryErrors.ts",
  "packages/persistence-postgres/src/storage/materialization/headEvidence.ts",
  "packages/persistence-postgres/src/storage/materialization/limits.ts",
  "packages/persistence-postgres/src/storage/materialization/originalBuildLocks.ts",
  "packages/persistence-postgres/src/storage/materialization/sidecarPolicy.ts",
  "packages/persistence-postgres/src/storage/materialization/uniqueKeyFailures.ts",
  "packages/persistence-postgres/src/storage/unique/appUniqueKeyErrors.ts",
  "packages/executor/src/mutation/authentication/stored/attemptReplacementOperations.ts",
  "packages/executor/src/mutation/authentication/stored/capabilityState.ts",
  "packages/executor/src/mutation/authentication/stored/occRerunExecutionOperations.ts",
  "packages/executor/src/mutation/authentication/stored/exactPointMutationExecutionOperations.ts",
  "packages/executor/src/mutation/journal/pointMutationJournal.ts",
  "packages/executor/src/mutation/execution/finitePointMutationExecution.ts",
  "packages/executor/src/mutation/recovery/finitePointMutationRecovery.ts",
  "packages/executor/src/mutation/session/pointMutationSessionActivation.ts",
  "packages/executor/src/mutation/claims/pointMutationExecutionClaimLiveness.ts",
  "packages/executor/src/mutation/claims/pointMutationExecutionClaimSupervision.ts",
  "packages/executor/src/mutation/session/pointMutationSessionAttemptState.ts",
  "packages/flarex-protocol/src/commit-protocol.ts",
  "packages/persistence-postgres/src/execution/session/inputCapture.ts",
  "packages/persistence-postgres/src/execution/session/attemptAuthority.ts",
  "packages/persistence-postgres/src/execution/session/contracts.ts",
  "packages/persistence-postgres/src/execution/session/constructionContracts.ts",
  "packages/persistence-postgres/src/execution/session/activation.ts",
  "packages/persistence-postgres/src/execution/session/attemptLoad.ts",
  "packages/persistence-postgres/src/execution/claims/acquisition.ts",
  "packages/persistence-postgres/src/execution/session/terminalization.ts",
  "packages/persistence-postgres/src/execution/session/finiteActivation.ts",
  "packages/persistence-postgres/src/execution/session/target.ts",
  "packages/persistence-postgres/src/execution/claims/renewal.ts",
  "packages/persistence-postgres/src/execution/session/recoveryCapture.ts",
  "packages/persistence-postgres/src/database/locatedReadCommittedRunner.ts",
  "packages/persistence-postgres/src/execution/session/attemptKernel.ts",
  "packages/persistence-postgres/src/execution/session/durableActivation.ts",
  "packages/persistence-postgres/src/execution/session/finiteSession.ts",
  "packages/persistence-postgres/src/execution/claims/renewalProjection.ts",
  "packages/persistence-postgres/src/storage/documents/logicalReadMetadata.ts",
  "packages/persistence-postgres/src/execution/preparation/preparedMetadataEpoch.ts",
  "packages/persistence-postgres/src/installation/installationLifecycle.ts",
  "packages/persistence-postgres/src/database/postgresInstallationMaintenance.ts",
  "packages/medusa-adapter/src/product-attempt.ts",
] as const;
const sourceHashes = async () => Object.fromEntries(await Promise.all(sources.map(async path =>
  [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")] as const)));
const Count = Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 30 }));
type Branch = "hit" | "miss";
type DecodedResults = Readonly<{ dispatches: number; returnedRowCount: number;
  decodedResultJsonUtf8Bytes: number; unknownResultEncodingDispatches: number }>;
type CpuProfileEvidence = Readonly<{ file: string; sha256Hex: string; startTime: number; endTime: number;
  samplingIntervalMicroseconds: number; nodeCount: number; sampleCount: number | null }>;
interface Sample {
  readonly branch: Branch; readonly sample: number; readonly warmup: boolean; readonly nativeFirst: boolean;
  readonly finiteDataPreparationMs: number;
  readonly nativeMs: number; readonly finiteOperationMs: number; readonly finiteRequestMs: number;
  readonly nativeResult: unknown; readonly finiteResult: unknown;
  readonly nativeError: ReturnType<typeof errorSummary> | null;
  readonly finiteError: ReturnType<typeof errorSummary> | null;
  readonly nativeSql: readonly RetrievalObservation[] | null;
  readonly finiteTrace: TraceInvocationRecord | null;
  readonly nativeServer: ReturnType<typeof retrievalServerDifference> | null;
  readonly finiteServer: ReturnType<typeof retrievalServerDifference> | null;
  readonly finiteOperationServer: ReturnType<typeof retrievalServerDifference> | null;
  readonly sourcePreparationUsage: Readonly<{ beforeRequestBytes: number; beforeOperationBytes: number;
    afterOperationBytes: number; afterRequestBytes: number }> | null;
  readonly methodDecodedResults: DecodedResults | null;
  readonly methodMetadataDecodedResults: DecodedResults | null;
  readonly methodBusinessDecodedResults: DecodedResults | null;
  readonly nativeCpuProfile: CpuProfileEvidence | null;
  readonly finiteCpuProfile: CpuProfileEvidence | null;
}

/** Diagnostic projection only; the entire native error remains in the Exit.
 * The commerce owner deliberately retains it as adapterFailure.cause. */
function errorSummary(error: unknown): { name: string; message: string; type?: string } {
  if (error !== null && typeof error === "object" && "reason" in error && error.reason === "adapterFailure" && "cause" in error)
    return errorSummary(error.cause);
  return { name: error instanceof Error ? error.name : "NonError",
    message: error instanceof Error ? error.message : String(error),
    ...(error !== null && typeof error === "object" && "type" in error && typeof error.type === "string" ? { type: error.type } : {}) };
}

/** Generated timestamps differ between independently authoritative stores.
 * Validate both complete DTOs and all timestamp fields, then compare all
 * remaining field values and exact structure. Reports retain original DTOs. */
function comparableDto(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableDto);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]: [string, unknown]) => {
    if ((key === "created_at" || key === "updated_at") && entry !== null) {
      const text = entry instanceof Date ? entry.toISOString() : entry;
      expect(typeof text).toBe("string");
      expect(Number.isFinite(Date.parse(String(text)))).toBe(true);
      expect(new Date(String(text)).toISOString()).toBe(text);
      return [key, "<generated-valid-timestamp>"];
    }
    return [key, comparableDto(entry)];
  }));
}

function distribution(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)], minMs: sorted[0], maxMs: sorted.at(-1) };
}

const authorityStatement = /fx_system_(?:scope_clock|scope_execution_authority|data_binding_head|application_active_head|index_build_state|prepared_metadata_epoch|installation(?:_runtime)?|tx_session|snapshot_lease|tx_journal|tx_execution_claim)\b|fx_lock_(?:installation_admission|installation_frontier|prepared_metadata_epoch|running_attempt_tail|finite_running_attempt)\b|fx_accept_finite_(?:storage_capture|placement_frontier)\b|fx_control_scope(?:_provisioning)?\b/;
const businessStatement = /fx_app_(?:row|index|unique|search|relation)|fx_read_snapshot_(?:rows|index_page)\b/;
function decodedResults(dispatches: readonly TraceDispatchRecord[]): DecodedResults {
  return { dispatches: dispatches.length,
    returnedRowCount: dispatches.reduce((sum, dispatch) => sum + (dispatch.returnedRowCount ?? 0), 0),
    decodedResultJsonUtf8Bytes: dispatches.reduce((sum, dispatch) => sum + (dispatch.decodedResultJsonUtf8Bytes ?? 0), 0),
    unknownResultEncodingDispatches: dispatches.filter(dispatch => dispatch.returnedRowCount == null ||
      dispatch.decodedResultJsonUtf8Bytes == null).length };
}

function requireProtectedServerWork(statements: ReturnType<typeof retrievalServerDifference>) {
  // A recorded call with unavailable query text cannot prove named SQL work.
  const qualifier = String.raw`(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)\s*\.\s*`;
  for (const [owner, table] of [
    ["installation", "fx_system_installation"],
    ["placement", "fx_control_scope"],
    ["placement receipt", "fx_control_scope_provisioning"],
    ["execution authority", "fx_system_scope_execution_authority"],
    ["publication sequencer", "fx_system_scope_clock"],
  ] as const) {
    const pattern = new RegExp(String.raw`\bselect\b[\s\S]*?\b(?:from|join)\s+(?:${qualifier})?"?${table}"?\b`, "i");
    if (!statements.some(statement => !statement.toplevel && statement.calls > 0 && statement.query !== null && pattern.test(statement.query)))
      throw new Error(`Missing observed nested finite ${owner} server work`);
  }
  const placementCalls = /\bfx_accept_finite_placement_frontier\s*\(/i;
  const finiteCaptureCalls = /\bfx_accept_finite_storage_capture\s*\(/i;
  const selectStatement = /^\s*(?:select|with)\b/i;
  // Genuine installed acceptance and the named capture share one outer
  // statement. The capture locks the original session and selected builds,
  // then starts separate fresh time and sequencer commands after their waits.
  if (!statements.some(statement => statement.toplevel && statement.calls > 0 && statement.query !== null &&
    selectStatement.test(statement.query) &&
    placementCalls.test(statement.query) &&
    finiteCaptureCalls.test(statement.query)))
    throw new Error("Missing observed top-level scalar placement and finite capture acceptance");
  const metadataEpoch = new RegExp(String.raw`\bjoin\s+(?:${qualifier})?"?fx_system_prepared_metadata_epoch"?\b`, "i");
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 && statement.query !== null &&
    selectStatement.test(statement.query) && metadataEpoch.test(statement.query) &&
    /\bp\.login\s*=\s*session_user\b/i.test(statement.query)))
    throw new Error("Missing observed nested installation frontier metadata and actual login policy check");
  const authorityRead = new RegExp(String.raw`\bfrom\s+(?:${qualifier})?"?fx_system_scope_execution_authority"?\b`, "i");
  const authorityScope = /\bwhere\s+a\.scope_id\s*=\s*p_scope_id\b/i;
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 && statement.query !== null &&
    selectStatement.test(statement.query) &&
    authorityRead.test(statement.query) && authorityScope.test(statement.query) && /\bfor\s+share\b/i.test(statement.query)))
    throw new Error("Missing observed nested finite installed execution authority FOR SHARE query");
  const anchorRead = new RegExp(String.raw`\bfrom\s+(?:${qualifier})?"?fx_system_tx_session"?\b`, "i");
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 && statement.query !== null &&
    selectStatement.test(statement.query) && anchorRead.test(statement.query) && /\bfor\s+share\b/i.test(statement.query) &&
    /\ba\.scope_uuid\s*=\s*\(\s*substring\s*\(\s*p_scope_id\s+from\s+\$\d+\s*\)\s*\)::uuid/i.test(statement.query) &&
    /\ba\.session_id\s*=\s*\(p_expected\)\.session_id\b/i.test(statement.query)))
    throw new Error("Missing observed nested original finite session anchor FOR SHARE query");
  const sequenceRead = new RegExp(String.raw`\bfrom\s+(?:${qualifier})?"?fx_system_scope_clock"?\b`, "i");
  if (!statements.some(statement => statement.toplevel && statement.calls > 0 && statement.query !== null &&
    selectStatement.test(statement.query) && /\bfx_accept_finite_storage_capture\s*\(/i.test(statement.query)))
    throw new Error("Missing observed top-level named finite storage capture");
  const servingScope = /\bwhere\s+c\.scope_id\s*=\s*p_scope_id\b/i;
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 && statement.query !== null &&
    selectStatement.test(statement.query) && sequenceRead.test(statement.query) && servingScope.test(statement.query) &&
    /\bc\.last_commit_seq\b/i.test(statement.query)))
    throw new Error("Missing observed nested finite post-wait serving sequence command");
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 && statement.query !== null &&
    selectStatement.test(statement.query) && /\bfloor\s*\(\s*extract\s*\(\s*(?:epoch|\$\d+)\s+from\s+clock_timestamp\s*\(/i.test(statement.query)))
    throw new Error("Missing observed nested finite post-wait database time command");
  const buildRead = new RegExp(String.raw`\bfrom\s+(?:${qualifier})?"?fx_system_index_build_state"?\b`, "i");
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 && statement.query !== null &&
    selectStatement.test(statement.query) && buildRead.test(statement.query) &&
    /\bb\.index_definition_id\s*=\s*p_index_definition_id\b/i.test(statement.query) && /\bfor\s+key\s+share\b/i.test(statement.query)))
    throw new Error("Missing observed nested finite selected index build FOR KEY SHARE command");
}

export async function runMixedNativeReadPerformanceScenario(native: Pick<IProductModuleService,
  "retrieveProduct" | "createProducts" | "createProductTags" | "createProductCategories">, nativeModuleSetupMs: number) {
  const mode = Schema.decodeUnknownSync(Schema.Literals(["quiet", "trace", "server", "cpu"]))(process.env.FLAREX_MIXED_NATIVE_READ_MODE ?? "quiet");
  const output = process.env.FLAREX_MIXED_NATIVE_READ_REPORT_DIR;
  if (mode === "cpu" && output === undefined) throw new Error("CPU mode requires an owned report directory");
  const managedRead = true;
  const count = Schema.decodeUnknownSync(Count)(process.env.FLAREX_MIXED_NATIVE_READ_SAMPLES ?? (mode === "quiet" ? "30" : "2"));
  const warmups = Schema.decodeUnknownSync(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 5 })))(
    process.env.FLAREX_MIXED_NATIVE_READ_WARMUPS ?? (mode === "quiet" ? "3" : "0"));
  const attemptCount = count + warmups;
  const axis = process.env.FLAREX_MIXED_NATIVE_READ_METADATA_AXIS;
  const readMetadataScale = axis === undefined ? undefined : {
    profile: "finite" as const,
    axis: Schema.decodeUnknownSync(Schema.Literals(["tables", "indexes", "relations", "otherSourceDefinitions"]))(axis),
    count: Schema.decodeUnknownSync(Schema.Literals([1, 100]))(Schema.decodeUnknownSync(Schema.NumberFromString)(
      process.env.FLAREX_MIXED_NATIVE_READ_METADATA_COUNT ?? "1")),
  };
  const label = Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{1,60}$/)))(
    process.env.FLAREX_MIXED_NATIVE_READ_LABEL ?? "mixed-read-baseline");
  const before = await sourceHashes();
  const samples: Sample[] = [];
  const setup = [];
  const base: unknown = Reflect.get(native, "baseRepository_");
  if (base === null || typeof base !== "object") throw new Error("Missing actual native repository for runtime settings");
  const fresh: unknown = Reflect.get(base, "getFreshManager");
  if (typeof fresh !== "function") throw new Error("Missing actual native manager accessor");
  const manager: unknown = Reflect.apply(fresh, base, []);
  if (manager === null || typeof manager !== "object") throw new Error("Missing actual native manager");
  const execute: unknown = Reflect.get(manager, "execute");
  if (typeof execute !== "function") throw new Error("Missing actual native manager settings query");
  const nativeSettings = await readRetrievalRuntimeSettings(async sql => Reflect.apply(execute, manager, [sql]));
  for (const branch of ["hit", "miss"] as const) {
    let observed: { exit: Exit.Exit<PrivateProductAttemptExecution, CommerceTransactionError>; elapsedMs: number } | undefined;
    const suffix = `${label}-${branch}`;
    const setupStart = performance.now();
    let server: Awaited<ReturnType<typeof openRetrievalServerObserver>> | undefined;
    let operationBefore: Awaited<ReturnType<NonNullable<typeof server>["snapshot"]>> | undefined;
    let operationAfter: typeof operationBefore;
    let beforeOperationBytes: number | undefined;
    let afterOperationBytes: number | undefined;
    let finiteCpuProfiler: BenchmarkCpuProfiler | undefined;
    let cpuSample: number | undefined;
    let finiteCpuProfile: CpuProfileEvidence | null = null;
    const saveCpuProfile = async (owner: "native" | "finite", index: number,
      profiler: BenchmarkCpuProfiler): Promise<CpuProfileEvidence> => {
      const profile = await profiler.stop();
      if (output === undefined) throw new Error("Missing CPU profile output directory");
      const file = `${label}-cpu-${branch}-${index}-${owner}.cpuprofile`;
      const bytes = JSON.stringify(profile);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, file), bytes, { flag: "wx" });
      return { file, sha256Hex: createHash("sha256").update(bytes).digest("hex"),
        startTime: profile.startTime, endTime: profile.endTime,
        samplingIntervalMicroseconds: CPU_SAMPLING_INTERVAL_MICROSECONDS,
        nodeCount: profile.nodes.length, sampleCount: profile.samples?.length ?? null };
    };
    const operationDiagnostics: ReturnType<typeof makeNativeProductOperationDiagnostics> = makeNativeProductOperationDiagnostics((_method, _args, exit, elapsedMs) => {
      observed = { exit, elapsedMs };
      if (mode === "trace") afterOperationBytes = Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes;
      const profiler = finiteCpuProfiler;
      if (profiler !== undefined) return (async () => {
        if (cpuSample === undefined) throw new Error("Missing finite CPU sample identity");
        finiteCpuProfile = await saveCpuProfile("finite", cpuSample, profiler);
      })();
      return server?.snapshot().then(snapshot => { operationAfter = snapshot; });
    });
    const series = await prepareMixedMutationPerformanceSeries({ driver: "postgres", suffix, profile: "product", sampleCount: attemptCount,
      ...(readMetadataScale === undefined ? {} : { readMetadataScale }),
      hooks: { onNativeOperationExit: operationDiagnostics,
        beforeNative: () => {
          const beforeNative = (mode === "trace" ? Effect.sync(() => {
            beforeOperationBytes = Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes;
          }) : Effect.void).pipe(Effect.andThen(server === undefined ? Effect.void : Effect.tryPromise({ try: async () => {
            operationBefore = await server?.snapshot();
          }, catch: cause => commerceError("resourceFailure", cause) })));
          const profiler = finiteCpuProfiler;
          return profiler === undefined ? beforeNative : beforeNative.pipe(Effect.andThen(Effect.tryPromise({
            try: () => profiler.start(), catch: cause => commerceError("resourceFailure", cause),
          })));
        } },
      applicationSource: seed => `export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => ctx.privateMixed.call("medusa.product", "retrieve", { id: ${JSON.stringify(branch === "hit" ? seed.productId : `prod_missing_${suffix}`)} }) } } };`,
    });
    // No sampling resource exists while series initialization can fail.
    const nativeCpuProfiler = mode === "cpu" ? new BenchmarkCpuProfiler() : undefined;
    finiteCpuProfiler = mode === "cpu" ? new BenchmarkCpuProfiler() : undefined;
    const finiteSetupMs = performance.now() - setupStart;
    const nativeSeedStart = performance.now();
    try {
      for (let index = 0; index < attemptCount; index++) {
        const seed = productAttemptSeed(`${suffix}-${index}`);
        await native.createProductTags(seed.tagInput);
        await native.createProductCategories(seed.categoryInput);
        await native.createProducts(seed.createInput.products[0]!);
      }
      if (series.currency.resource.kind !== "postgres") throw new Error("Native comparison requires actual PostgreSQL");
      const resource = series.currency.resource;
      const finiteSettings = await readRetrievalRuntimeSettings(async sql => (await resource.target.pool.query(sql)).rows);
      for (const runtime of [nativeSettings, finiteSettings]) {
        for (const name of ["fsync", "synchronous_commit", "full_page_writes"])
          expect(runtime.settings[name]).toMatchObject({ status: "observed", value: "on" });
        expect(runtime.settings["pg_stat_statements.track"]).toMatchObject({ status: "observed", value: mode === "server" ? "all" : "none" });
        const autoExplain = runtime.settings["auto_explain.log_min_duration"];
        if (mode !== "server" && autoExplain?.status === "observed") expect(autoExplain.value).toBe("-1");
      }
      if (mode === "server") {
        const observerUrl = process.env.FLAREX_MIXED_NATIVE_READ_OBSERVER_DATABASE_URL;
        const nativeDatabase = process.env.NATIVE_RETRIEVAL_DATABASE;
        if (observerUrl === undefined || nativeDatabase === undefined) throw new Error("Server mode requires isolated observer URL and native database");
        const controlSettings = await readRetrievalRuntimeSettings(async sql => (await resource.control.pool.query(sql)).rows);
        expect(controlSettings.settings["pg_stat_statements.track"]).toMatchObject({ status: "observed", value: "all" });
        server = await openRetrievalServerObserver(observerUrl,
          selectRetrievalServerDatabases(nativeDatabase, nativeSettings, finiteSettings, controlSettings));
      }
      const branchSetup = { branch, finiteSetupMs, nativeSeedingMs: performance.now() - nativeSeedStart,
        nativeSettings, finiteSettings,
        metadataCounts: series.currency.metadataCounts, metadataScaling: series.currency.metadataScaling,
        sourcePreparationRetainedBytes: Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes,
        builtInSqlObserver: series.currency.observeSql !== undefined,
        serverObserver: server === undefined ? null : { settings: server.settings, identity: server.observerIdentity, coverage: server.coverage },
        provisioningMs: series.provisioningMilliseconds, modulePreparationMs: series.preparedModuleMilliseconds,
        initialSeedingMs: series.initialSeedingMilliseconds, additionalSeedingMs: series.additionalSetupSeedingMilliseconds,
        lifetime: "one prepared module/schema/pool graph; fresh authenticated attempt and single-use Worker per sample" };
      setup.push(branchSetup);
      const trace = mode === "trace" && series.currency.resource.kind === "postgres"
        ? createMixedMutationPerformanceTrace({ controlPool: series.currency.resource.control.pool, targetPool: series.currency.resource.target.pool }) : undefined;
      series.setTrace(trace);
      try {
        for (let index = 0; index < attemptCount; index++) {
          // The series requires each disjoint data graph before request entry.
          // Charge this setup separately, before either alternating pair member
          // opens its timing, trace or server-observation interval.
          const preparationStarted = performance.now();
          await series.prepareAttempt(index);
          const finiteDataPreparationMs = performance.now() - preparationStarted;
          branchSetup.additionalSeedingMs += finiteDataPreparationMs;
          const seed = productAttemptSeed(`${suffix}-${index}`);
          const id = branch === "hit" ? seed.productId : `prod_missing_${suffix}`;
          let nativeResult: unknown;
          let nativeError: ReturnType<typeof errorSummary> | null = null;
          let nativeMs = 0;
          let finiteRequestMs = 0;
          let finiteResult: unknown;
          let finiteFailure: unknown;
          let nativeServer: Sample["nativeServer"] = null;
          let finiteServer: Sample["finiteServer"] = null;
          let finiteOperationServer: Sample["finiteOperationServer"] = null;
          let sourcePreparationUsage: Sample["sourcePreparationUsage"] = null;
          let nativeCpuProfile: CpuProfileEvidence | null = null;
          const nativeSql: RetrievalObservation[] | null = mode === "trace" ? [] : null;
          const runNative = async () => {
            const before = await server?.snapshot();
            const close = nativeSql === null ? undefined : observeRetrievalPgClients(nativeSql);
            if (nativeCpuProfiler !== undefined) await nativeCpuProfiler.start();
            const started = performance.now();
            try { nativeResult = await native.retrieveProduct(id); }
            catch (error) { nativeError = errorSummary(error); }
            finally { nativeMs = performance.now() - started; close?.(); }
            if (nativeCpuProfiler !== undefined) nativeCpuProfile = await saveCpuProfile("native", index, nativeCpuProfiler);
            if (before !== undefined && server !== undefined) {
              nativeServer = retrievalServerDifference(before, await server.snapshot());
              requireRetrievalServerObservedCalls({ database: nativeSettings.database, dbid: nativeSettings.dbid }, nativeServer);
            }
          };
          const runFinite = async () => {
            observed = undefined;
            cpuSample = index;
            finiteCpuProfile = null;
            operationBefore = undefined;
            operationAfter = undefined;
            beforeOperationBytes = undefined;
            afterOperationBytes = undefined;
            const beforeRequestBytes = mode === "trace" ? Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes : undefined;
            const before = await server?.snapshot();
            const started = performance.now();
            const work = async () => {
              try { finiteResult = (await series.runAttempt(index)).returnedValue; }
              catch (error) { finiteFailure = error; }
            };
            if (trace === undefined) await work();
            else await trace.withInvocation({ id: `${branch}/${index}`, mode: "recon" }, work);
            finiteRequestMs = performance.now() - started;
            operationDiagnostics.assertMeasurement();
            finiteCpuProfiler?.assertMeasurement();
            if (beforeRequestBytes !== undefined && beforeOperationBytes !== undefined && afterOperationBytes !== undefined)
              sourcePreparationUsage = { beforeRequestBytes, beforeOperationBytes, afterOperationBytes,
                afterRequestBytes: Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes };
            if (before !== undefined && server !== undefined) {
              const after = await server.snapshot();
              finiteServer = retrievalServerDifference(before, after);
              if (operationBefore === undefined || operationAfter === undefined)
                throw new Error("Missing exact finite native operation server interval");
              finiteOperationServer = retrievalServerDifference(operationBefore, operationAfter);
              requireRetrievalServerObservedCalls({ database: finiteSettings.database, dbid: finiteSettings.dbid }, finiteOperationServer);
              requireProtectedServerWork(finiteOperationServer);
            }
          };
          const nativeFirst = index % 2 === 0;
          if (nativeFirst) { await runNative(); await runFinite(); }
          else { await runFinite(); await runNative(); }
          if (observed === undefined) {
            if (finiteFailure !== undefined) throw finiteFailure;
            throw new Error("Missing actual native operation Exit");
          }
          let finiteError: ReturnType<typeof errorSummary> | null = null;
          if (branch === "hit") {
            expect(finiteFailure).toBeUndefined();
            expect(nativeError).toBeNull();
            expect(Exit.isSuccess(observed.exit)).toBe(true);
            expect(finiteResult).toMatchObject({ status: ProductStatus.DRAFT });
            expect(comparableDto(finiteResult)).toEqual(comparableDto(nativeResult));
          } else {
            expect(finiteFailure).toBeInstanceOf(Error);
            expect(nativeError).not.toBeNull();
            if (Exit.isSuccess(observed.exit)) throw new Error("Missing Product unexpectedly succeeded");
            expect(observed.exit.cause.reasons).toHaveLength(1);
            const reason = observed.exit.cause.reasons[0];
            if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Native miss became a defect or interruption");
            finiteError = errorSummary(reason.error);
            expect(finiteError).toEqual(nativeError);
          }
          const finiteTrace = trace?.records().find(record => record.id === `${branch}/${index}`) ?? null;
          if (mode === "cpu") {
            expect(nativeCpuProfile).not.toBeNull();
            expect(finiteCpuProfile).not.toBeNull();
          }
          const methodDispatches = finiteTrace?.dispatches.filter(dispatch => dispatch.phasePath.includes("native Product operation"));
          const methodDecodedResults = methodDispatches === undefined ? null : decodedResults(methodDispatches);
          const methodMetadataDecodedResults = methodDispatches === undefined ? null : decodedResults(methodDispatches.filter(dispatch =>
            authorityStatement.test(dispatch.template ?? "")));
          const methodBusinessDecodedResults = methodDispatches === undefined ? null : decodedResults(methodDispatches.filter(dispatch =>
            !authorityStatement.test(dispatch.template ?? "") && businessStatement.test(dispatch.template ?? "")));
          if (mode === "trace") {
            expect(sourcePreparationUsage).not.toBeNull();
            expect(methodDecodedResults?.unknownResultEncodingDispatches).toBe(0);
          }
          samples.push({ branch, sample: index, warmup: index < warmups, nativeFirst, finiteDataPreparationMs,
            nativeMs, finiteOperationMs: observed.elapsedMs,
            finiteRequestMs, nativeResult, finiteResult, nativeError, finiteError, nativeSql,
            nativeServer, finiteServer, finiteOperationServer, sourcePreparationUsage, methodDecodedResults,
            methodMetadataDecodedResults, methodBusinessDecodedResults, finiteTrace, nativeCpuProfile, finiteCpuProfile });
        }
      } finally { trace?.close(); }
    } finally {
      try { await nativeCpuProfiler?.dispose(); }
      finally {
        try { await finiteCpuProfiler?.dispose(); }
        finally { try { await server?.close(); } finally { await series.close(); } }
      }
    }
  }
  expect(await sourceHashes()).toEqual(before);
  const report = { format: "flarex.matched-finite-native-product-retrieve", mode, label, managedRead, readMetadataScale, nativeModuleSetupMs, warmups, count,
    checkpoint: process.env.FLAREX_MIXED_NATIVE_READ_CHECKPOINT, sourceHashes: before, setup, samples,
    summary: ["hit", "miss"].map(branch => {
      const selected = samples.filter(sample => sample.branch === branch && !sample.warmup);
      return { branch, native: distribution(selected.map(sample => sample.nativeMs)),
        finiteOperation: distribution(selected.map(sample => sample.finiteOperationMs)),
        pairedOperationExcess: distribution(selected.map(sample => sample.finiteOperationMs - sample.nativeMs)),
        finiteRequest: distribution(selected.map(sample => sample.finiteRequestMs)) };
    }),
    interpretation: ["Exact admitted ID-only private retrieve; full native default DTO and error contract retained.",
      "Actual generated created_at/updated_at differ between authoritative stores; every field and timestamp is retained and validated, all other values/structure compared exactly.",
      "Every finite hit is the first Product demand in a fresh attempt; no pending-only or repeated-row observation is presented as a storage hit.",
      "Missing Product failures poison their own attempt and keep the native Commerce adapter cause; no failure recovery or publication is introduced.",
      "Finite operation covers actual private native operation, close and receipt validation; complete request includes admission, fresh Worker, execution, local freeze, publication and fixture disposal.",
      "Schema/module/seeding costs are separately charged per actual series lifetime; measured native schema/module bootstrap remains runner-owned and outside per-operation samples.",
      "Each finite disjoint data graph is prepared before its alternating pair; per-sample preparation is recorded and included in setup additionalSeedingMs outside request and operation intervals.",
      "Quiet and trace are separate runs; trace observations are client SQL dispatches, never network round trips or server execution time."],
    cpuInterpretation: mode === "cpu" ? [
      "Diagnostic V8 sampling at 100 microseconds; timings carry profiler overhead and cannot satisfy quiet gates.",
      "Profiles start before the method clock and stop after its completed outcome; finite service construction, close and receipt validation are included.",
      "Returned startTime/endTime are genuine profiler timestamps in microseconds; profiles sample the local Node isolate, including asynchronous and inspector work.",
      "Short samples are noisy; no exclusive CPU is inferred by subtracting SQL awaits or from overlapping spans.",
    ] : null,
    unavailable: ["network round trips", ...(mode === "server" ? [] : ["server execution time"]), "driver wire bytes", "isolated CPU"] };
  if (output !== undefined) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, `${label}-${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}
