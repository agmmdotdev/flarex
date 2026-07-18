import type { SQLWrapper } from "drizzle-orm";
import type {
  DeploymentPackageMetadataRecord,
  InsertDeploymentPackageMetadataInput,
} from "./deploymentPackages";
import type {
  ListDeploymentMetadataInput,
  ListDeploymentMetadataResult,
  DeploymentMetadataRecord,
  InsertDeploymentMetadataInput,
  UpdateDeploymentMetadataActivationInput,
} from "./deployments";
import type {
  InsertScopeMetadataInput,
  ListScopeMetadataInput,
  ListScopeMetadataResult,
  ScopeMetadataRecord,
} from "./scopeMetadata";
import type { ScopeClockRecord } from "./scopeClock";
import type {
  DocumentRevisionRecord,
  InsertDocumentRevisionInput,
} from "./documents";
import type {
  AbortInvokeSessionMetadataInput,
  AbortStaleInvokeSessionsMetadataInput,
  AbortStaleInvokeSessionsMetadataResult,
  FinishInvokeSessionMetadataInput,
  InsertInvokeSessionMetadataInput,
  InvokeSessionMetadataRecord,
} from "./invokeSessions";
import type {
  InsertOutboxEventInput,
  ListOutboxEventsInput,
  ListOutboxEventsResult,
  ListUndeliveredOutboxEventsInput,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
  OutboxEventRecord,
} from "./outbox";
import type { HasIndexEntryAfterTsInput } from "./indexEntries";
import type { LegacyV1AppDataStore } from "./legacyV1AppDataEngine";
import type {
  ApplyFreshnessCommitInput,
  ApplyFreshnessCommitResult,
  DocumentFreshnessVersionRecord,
  FreshnessOutboxEventKey,
  FreshnessProcessedEventRecord,
  TableFreshnessVersionRecord,
} from "./freshness";
import type {
  DeleteLiveQuerySubscriptionResult,
  ListLiveQuerySubscriptionsInput,
  LiveQuerySubscriptionConnectionKey,
  LiveQuerySubscriptionKey,
  LiveQuerySubscriptionRecord,
  RecordLiveQueryRerunFailureInput,
  RecordLiveQueryRerunFailureResult,
  RecordLiveQueryRerunResultInput,
  RecordLiveQueryRerunResultResult,
  UpsertLiveQuerySubscriptionInput,
} from "./liveQuerySubscriptions";
import type {
  CloseLiveQueryConnectionInput,
  DeleteExpiredLiveQuerySubscriptionsInput,
  DeleteExpiredLiveQuerySubscriptionsResult,
  ListExpiredLiveQueryConnectionDeploymentsInput,
  ListExpiredLiveQueryConnectionDeploymentsResult,
  ListActiveLiveQuerySubscriptionsInput,
  LiveQueryConnectionRecord,
  UpsertLiveQueryConnectionLeaseInput,
  UpsertLiveQuerySubscriptionWithLeaseInput,
} from "./liveQueryConnections";
import type {
  ClaimLiveQueryDeliveriesInput,
  ClaimLiveQueryDeliveriesResult,
  InsertLiveQueryDeliveryInput,
  ListPendingLiveQueryDeliveryDeploymentsInput,
  ListPendingLiveQueryDeliveryDeploymentsResult,
  ListStuckLiveQueryDeliveriesInput,
  ListStuckLiveQueryDeliveriesResult,
  ListUndeliveredLiveQueryDeliveriesInput,
  ListUndeliveredLiveQueryDeliveriesResult,
  LiveQueryDeliveryRecord,
  MarkLiveQueryDeliveriesDeadLetteredInput,
  MarkLiveQueryDeliveriesDeadLetteredResult,
  MarkLiveQueryDeliveriesDeliveredInput,
  MarkLiveQueryDeliveriesDeliveredResult,
  RecordLiveQueryDeliveryFailureInput,
  RecordLiveQueryDeliveryFailureResult,
} from "./liveQueryDeliveries";
import type {
  EnsureAppTableDefinitionsArtifactV1Input,
  EnsureAppTableDefinitionsArtifactV1Result,
} from "./appTableDefinitionsArtifacts";
import type {
  PublishAppSchemaV1Input,
  PublishAppSchemaV1Result,
} from "./appSchemaPublication";
export { sql } from "drizzle-orm";

export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
}

export interface FlarexSqlClient {
  execute<Row extends Record<string, unknown> = Record<string, unknown>>(
    query: SQLWrapper | string,
  ): Promise<QueryResult<Row>>;
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface FlarexPersistenceTx extends FlarexSqlClient {}

export interface FlarexRuntimePersistence
  extends FlarexSqlClient, LegacyV1AppDataStore {
  check(): Promise<FlarexPersistenceCheck>;
  insertDeploymentPackageMetadata(
    input: InsertDeploymentPackageMetadataInput,
  ): Promise<DeploymentPackageMetadataRecord>;
  getDeploymentPackageMetadata(
    deploymentId: string,
    packageId: string,
  ): Promise<DeploymentPackageMetadataRecord | null>;
  insertDeploymentMetadata(
    input: InsertDeploymentMetadataInput,
  ): Promise<DeploymentMetadataRecord>;
  getDeploymentMetadata(
    deploymentId: string,
  ): Promise<DeploymentMetadataRecord | null>;
  listDeploymentMetadata(
    input: ListDeploymentMetadataInput,
  ): Promise<ListDeploymentMetadataResult>;
  updateDeploymentMetadataActivation(
    input: UpdateDeploymentMetadataActivationInput,
  ): Promise<DeploymentMetadataRecord | null>;
  /** Compatibility path: persists only the V1 table-definitions artifact. */
  ensureAppTableDefinitionsArtifactV1(
    input: EnsureAppTableDefinitionsArtifactV1Input,
  ): Promise<EnsureAppTableDefinitionsArtifactV1Result>;
  /** Publishes/replays the full V1 app-schema catalog; does not activate it. */
  publishAppSchemaV1(
    input: PublishAppSchemaV1Input,
  ): Promise<PublishAppSchemaV1Result>;
  insertScopeMetadata(
    input: InsertScopeMetadataInput,
  ): Promise<ScopeMetadataRecord>;
  getScopeMetadata(
    scopeId: InsertScopeMetadataInput["scopeId"],
  ): Promise<ScopeMetadataRecord | null>;
  getScopeMetadataByDeploymentId(
    deploymentId: string,
  ): Promise<ScopeMetadataRecord | null>;
  listScopeMetadata(
    input: ListScopeMetadataInput,
  ): Promise<ListScopeMetadataResult>;
  getScopeClock(
    scopeId: ScopeClockRecord["scopeId"],
  ): Promise<ScopeClockRecord | null>;
  insertInvokeSessionMetadata(
    input: InsertInvokeSessionMetadataInput,
  ): Promise<InvokeSessionMetadataRecord>;
  getInvokeSessionMetadata(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionMetadataRecord | null>;
  finishInvokeSessionMetadata(
    input: FinishInvokeSessionMetadataInput,
  ): Promise<InvokeSessionMetadataRecord | null>;
  abortInvokeSessionMetadata(
    input: AbortInvokeSessionMetadataInput,
  ): Promise<InvokeSessionMetadataRecord | null>;
  abortStaleInvokeSessionsMetadata(
    input: AbortStaleInvokeSessionsMetadataInput,
  ): Promise<AbortStaleInvokeSessionsMetadataResult>;
  insertDocumentRevision(
    input: InsertDocumentRevisionInput,
  ): Promise<DocumentRevisionRecord>;
  hasIndexEntryAfterTs(input: HasIndexEntryAfterTsInput): Promise<boolean>;
  insertOutboxEvent(input: InsertOutboxEventInput): Promise<OutboxEventRecord>;
  listOutboxEvents(
    input: ListOutboxEventsInput,
  ): Promise<ListOutboxEventsResult>;
  listUndeliveredOutboxEvents(
    input: ListUndeliveredOutboxEventsInput,
  ): Promise<ListOutboxEventsResult>;
  markOutboxEventsDelivered(
    input: MarkOutboxEventsDeliveredInput,
  ): Promise<MarkOutboxEventsDeliveredResult>;
  applyFreshnessCommit(
    input: ApplyFreshnessCommitInput,
  ): Promise<ApplyFreshnessCommitResult>;
  getFreshnessProcessedEvent(
    input: FreshnessOutboxEventKey,
  ): Promise<FreshnessProcessedEventRecord | null>;
  getDocumentFreshnessVersion(
    deploymentId: string,
    documentId: string,
  ): Promise<DocumentFreshnessVersionRecord | null>;
  getTableFreshnessVersion(
    deploymentId: string,
    tableId: number,
  ): Promise<TableFreshnessVersionRecord | null>;
  upsertLiveQueryConnectionLease(
    input: UpsertLiveQueryConnectionLeaseInput,
  ): Promise<LiveQueryConnectionRecord>;
  closeLiveQueryConnection(
    input: CloseLiveQueryConnectionInput,
  ): Promise<LiveQueryConnectionRecord | null>;
  upsertLiveQuerySubscriptionWithLease(
    input: UpsertLiveQuerySubscriptionWithLeaseInput,
  ): Promise<LiveQuerySubscriptionRecord>;
  upsertLiveQuerySubscription(
    input: UpsertLiveQuerySubscriptionInput,
  ): Promise<LiveQuerySubscriptionRecord>;
  recordLiveQueryRerunResult(
    input: RecordLiveQueryRerunResultInput,
  ): Promise<RecordLiveQueryRerunResultResult>;
  recordLiveQueryRerunFailure(
    input: RecordLiveQueryRerunFailureInput,
  ): Promise<RecordLiveQueryRerunFailureResult>;
  deleteLiveQuerySubscription(
    input: LiveQuerySubscriptionKey,
  ): Promise<DeleteLiveQuerySubscriptionResult>;
  deleteLiveQuerySubscriptionsForConnection(
    input: LiveQuerySubscriptionConnectionKey,
  ): Promise<DeleteLiveQuerySubscriptionResult>;
  listLiveQuerySubscriptions(
    input: ListLiveQuerySubscriptionsInput,
  ): Promise<LiveQuerySubscriptionRecord[]>;
  listActiveLiveQuerySubscriptions(
    input: ListActiveLiveQuerySubscriptionsInput,
  ): Promise<LiveQuerySubscriptionRecord[]>;
  listExpiredLiveQueryConnectionDeployments(
    input: ListExpiredLiveQueryConnectionDeploymentsInput,
  ): Promise<ListExpiredLiveQueryConnectionDeploymentsResult>;
  deleteExpiredLiveQuerySubscriptions(
    input: DeleteExpiredLiveQuerySubscriptionsInput,
  ): Promise<DeleteExpiredLiveQuerySubscriptionsResult>;
  insertLiveQueryDelivery(
    input: InsertLiveQueryDeliveryInput,
  ): Promise<LiveQueryDeliveryRecord>;
  listUndeliveredLiveQueryDeliveries(
    input: ListUndeliveredLiveQueryDeliveriesInput,
  ): Promise<ListUndeliveredLiveQueryDeliveriesResult>;
  listPendingLiveQueryDeliveryDeployments(
    input: ListPendingLiveQueryDeliveryDeploymentsInput,
  ): Promise<ListPendingLiveQueryDeliveryDeploymentsResult>;
  listStuckLiveQueryDeliveries(
    input: ListStuckLiveQueryDeliveriesInput,
  ): Promise<ListStuckLiveQueryDeliveriesResult>;
  markLiveQueryDeliveriesDelivered(
    input: MarkLiveQueryDeliveriesDeliveredInput,
  ): Promise<MarkLiveQueryDeliveriesDeliveredResult>;
  markLiveQueryDeliveriesDeadLettered(
    input: MarkLiveQueryDeliveriesDeadLetteredInput,
  ): Promise<MarkLiveQueryDeliveriesDeadLetteredResult>;
  recordLiveQueryDeliveryFailure(
    input: RecordLiveQueryDeliveryFailureInput,
  ): Promise<RecordLiveQueryDeliveryFailureResult>;
  claimLiveQueryDeliveries(
    input: ClaimLiveQueryDeliveriesInput,
  ): Promise<ClaimLiveQueryDeliveriesResult>;
  transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T>;
}

export interface FlarexPersistence extends FlarexRuntimePersistence {
  migrate(): Promise<void>;
}

export interface FlarexPersistenceCheck {
  status: "ok";
}

export * from "./deploymentPackages";
export * from "./deployments";
export * from "./scopeMetadata";
export * from "./scopeMetadataTypes";
export {
  TrustedScopeAuthorityResolutionError,
  TrustedScopeAuthorityPortError,
  resolveLocatedTrustedScopeAuthorityEffect,
  resolveTrustedScopeAuthorityEffect,
  type InvalidScopeClockTargetReason,
  type LocatedScopeClockReader,
  type ScopeClockReader,
  type ScopeClockTargetReaderResolver,
  type ScopeMetadataReader,
  type ScopeProvisioningReceiptReader,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityPortOperation,
  type TrustedScopeAuthorityResolutionFailure,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
export {
  CurrentScopeAuthorizationEpochPortError,
  CurrentScopeAuthorizationEpochResolutionError,
  resolveCurrentScopeAuthorizationEpochEffect,
  type CurrentScopeAuthorizationEpoch,
  type CurrentScopeAuthorizationEpochError,
  type CurrentScopeAuthorizationEpochResolutionFailure,
  type CurrentScopeAuthorizationEpochResolutionPorts,
} from "./scopeAuthorizationEpochAuthority";
export {
  createAppDataSnapshotResolver,
  type AppDataSnapshotResolver,
  type ResolvedAppDataSnapshot,
} from "./appDataSnapshot";
export {
  getSchemaVersionArtifactById,
  getSchemaVersionArtifactByVersion,
  InvalidSchemaVersionArtifactInputError,
  SchemaManifestChecksumCollisionError,
  SchemaVersionArtifactConflictError,
  SchemaVersionArtifactCorruptionError,
  SchemaVersionArtifactDeploymentNotFoundError,
  SchemaVersionArtifactPreparationError,
  type EnsureSchemaVersionArtifactInput,
  type EnsureSchemaVersionArtifactResult,
  type SchemaVersionArtifact,
  type SchemaVersionArtifactConflict,
  type SchemaVersionArtifactIdentity,
} from "./schemaVersionArtifacts";
export {
  getStableTableIdentityById,
  getStableTableIdentityByName,
  InvalidStableTableIdentityInputError,
  StableTableCatalogCorruptionError,
  StableTableCatalogDeploymentNotFoundError,
  StableTableCatalogIdExhaustedError,
  type EnsureStableTableIdentityInput,
  type EnsureStableTableIdentityResult,
  type StableTableIdentity,
  type StableTableIdentityName,
} from "./stableTableCatalog";
export {
  getStableLogicalIndexIdentityById,
  getStableLogicalIndexIdentityByName,
  InvalidStableLogicalIndexIdentityInputError,
  StableLogicalIndexCatalogCorruptionError,
  type StableLogicalIndexIdentity,
  type StableLogicalIndexIdentityName,
} from "./stableLogicalIndexCatalog";
export {
  AppCreationTimeIndexDefinitionChecksumCollisionError,
  AppCreationTimeIndexDefinitionParentError,
  AppCreationTimeIndexDefinitionRequirementError,
  AppDeveloperIndexDefinitionRequirementError,
  AppIndexDefinitionCatalogCorruptionError,
  AppIndexDefinitionChecksumCollisionError,
  AppIndexDefinitionIdExhaustedError,
  AppIndexDefinitionParentError,
  AppIndexDefinitionPreparationError,
  AppSchemaVersionIndexBindingConflictError,
  getAppIndexDefinitionById,
  getAppSchemaVersionIndexBinding,
  InvalidAppIndexDefinitionBindingInputError,
  listAppIndexDefinitionsForLogicalIndex,
  listAppSchemaVersionIndexBindings,
  type AppCreationTimeIndexDefinitionParentIssue,
  type AppCreationTimeIndexDefinitionRequirementIssue,
  type AppDeveloperIndexDefinitionRequirementIssue,
  type AppIndexDefinitionRecord,
  type AppIndexDefinitionParentIssue,
  type AppSchemaVersionIndexBindingRecord,
  type InvalidAppIndexDefinitionBindingInputIssue,
} from "./appIndexDefinitions";
export { StableLogicalIndexCatalogIdExhaustedError } from "./stableLogicalIndexCatalogAllocation";
export {
  IndexBuildStateClockNotFoundError,
  IndexBuildStateCorruptionError,
  InvalidIndexBuildStateReadInputError,
  readFencedIndexBuildState,
  type FencedIndexBuildStateReadResult,
  type IndexBuildAuthorityMismatch,
  type IndexBuildAuthorityMismatches,
  type IndexBuildStateRecord,
  type IndexBuildStorageAuthority,
  type InvalidIndexBuildStateReadInputIssue,
  type ReadFencedIndexBuildStateInput,
} from "./indexBuildStates";
export {
  AppTableDefinitionsArtifactV1RetryExhaustedError,
  InvalidAppTableDefinitionsArtifactV1InputError,
  MAX_APP_TABLE_DEFINITIONS_ARTIFACT_V1_ATTEMPTS,
  type EnsureAppTableDefinitionsArtifactV1Input,
  type EnsureAppTableDefinitionsArtifactV1Result,
  type InvalidAppTableDefinitionsArtifactV1InputIssue,
} from "./appTableDefinitionsArtifacts";
export {
  AppSchemaPublicationV1RetryExhaustedError,
  MAX_APP_SCHEMA_PUBLICATION_V1_ATTEMPTS,
  type AppSchemaPublicationV1Stale,
  type PublishAppSchemaV1Input,
  type PublishAppSchemaV1Result,
} from "./appSchemaPublication";
export {
  InvalidAppSchemaPublicationV1InputError,
  type InvalidAppSchemaPublicationV1InputIssue,
} from "./appSchemaPublicationPreparation";
export {
  InvalidSchemaManifestAppSchemaBindingInputError,
  type InvalidSchemaManifestAppSchemaBindingInputIssue,
} from "./schemaManifestAppSchemaBindings";
export {
  SchemaManifestTableBindingCorruptionError,
} from "./schemaManifestTableBindings";
export {
  AppSchemaPublicationV1ProjectionError,
  type AppSchemaPublicationV1Result,
  type AppSchemaPublicationV1ProjectionIssue,
} from "./appSchemaPublicationTransaction";
export {
  AppSchemaPublicationV1QuotaExceededError,
  MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
  MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS,
  MAX_APP_SCHEMA_PUBLICATION_V1_DEVELOPER_INDEXES,
  MAX_APP_SCHEMA_PUBLICATION_V1_TABLES,
  type AppSchemaPublicationV1QuotaIssue,
} from "./appSchemaPublicationPolicy";
export {
  ScopeClockCorruptionError,
  type ScopeClockRecord,
} from "./scopeClock";
export * from "./documents";
export * from "./commits";
export * from "./indexEntries";
export * from "./invokeSessions";
export * from "./invokeSessionReads";
export * from "./invokeSessionTableReads";
export * from "./invokeSessionIndexReads";
export * from "./invokeSessionWrites";
export * from "./outbox";
export * from "./freshness";
export * from "./liveQueryConnections";
export * from "./liveQuerySubscriptions";
export * from "./liveQueryDeliveries";
export * from "./validation";

/**
 * Historical package-root schema surface. New transaction-authority tables
 * remain private until their owning repository or transaction port is approved.
 */
export {
  bytea,
  commits,
  deploymentPackages,
  deployments,
  documentFreshnessVersions,
  documents,
  flarexSchema,
  freshnessProcessedEvents,
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxControlIndexDefinitions,
  fxControlIndexes,
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersions,
  fxControlScopeProvisioning,
  fxControlScopes,
  fxControlTables,
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionSessions,
  indexes,
  invokeSessionDocumentReads,
  invokeSessionDocumentWrites,
  invokeSessionIndexReads,
  invokeSessionTableReads,
  invokeSessions,
  leases,
  liveQueryConnections,
  liveQueryDeliveries,
  liveQuerySubscriptions,
  outbox,
  persistenceGlobals,
  readOnly,
  tableFreshnessVersions,
} from "./schema";
