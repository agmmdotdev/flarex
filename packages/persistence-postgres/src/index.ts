import type { SQLWrapper } from "drizzle-orm";
import type {
  DeploymentPackageMetadataRecord,
  InsertDeploymentPackageMetadataInput,
} from "./application/deploymentPackages";
import type {
  ListDeploymentMetadataInput,
  ListDeploymentMetadataResult,
  DeploymentMetadataRecord,
  InsertDeploymentMetadataInput,
  UpdateDeploymentMetadataActivationInput,
} from "./application/deployments";
import type {
  InsertScopeMetadataInput,
  ListScopeMetadataInput,
  ListScopeMetadataResult,
  ScopeMetadataRecord,
} from "./scope/scopeMetadata";
import type { ScopeClockRecord } from "./scope/scopeClock";
import type {
  DocumentRevisionRecord,
  InsertDocumentRevisionInput,
} from "./storage/documents/documents";
import type {
  AbortInvokeSessionMetadataInput,
  AbortStaleInvokeSessionsMetadataInput,
  AbortStaleInvokeSessionsMetadataResult,
  FinishInvokeSessionMetadataInput,
  InsertInvokeSessionMetadataInput,
  InvokeSessionMetadataRecord,
} from "./legacy/invokeSessions";
import type {
  InsertOutboxEventInput,
  ListOutboxEventsInput,
  ListOutboxEventsResult,
  ListUndeliveredOutboxEventsInput,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
  OutboxEventRecord,
} from "./commit/outbox";
import type { HasIndexEntryAfterTsInput } from "./storage/indexes/indexEntries";
import type { LegacyV1AppDataStore } from "./legacy/legacyV1AppDataEngine";
import type {
  ApplyFreshnessCommitInput,
  ApplyFreshnessCommitResult,
  DocumentFreshnessVersionRecord,
  FreshnessOutboxEventKey,
  FreshnessProcessedEventRecord,
  TableFreshnessVersionRecord,
} from "./sync/freshness";
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
} from "./sync/liveQuerySubscriptions";
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
} from "./sync/liveQueryConnections";
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
} from "./sync/liveQueryDeliveries";
import type {
  EnsureAppTableDefinitionsArtifactV1Input,
  EnsureAppTableDefinitionsArtifactV1Result,
} from "./storage/catalog/appTableDefinitionsArtifacts";
import type {
  PublishAppSchemaV1Input,
  PublishAppSchemaV1Result,
} from "./storage/catalog/appSchemaPublication";
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

export * from "./application/deploymentPackages";
export * from "./application/deployments";
export * from "./scope/scopeMetadata";
export * from "./scope/scopeMetadataTypes";
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
} from "./scope/scopeAuthorityResolution";
export {
  CurrentScopeAuthorizationEpochPortError,
  CurrentScopeAuthorizationEpochResolutionError,
  resolveCurrentScopeAuthorizationEpochEffect,
  type CurrentScopeAuthorizationEpoch,
  type CurrentScopeAuthorizationEpochError,
  type CurrentScopeAuthorizationEpochResolutionFailure,
  type CurrentScopeAuthorizationEpochResolutionPorts,
} from "./scope/scopeAuthorizationEpochAuthority";
export {
  createAppDataSnapshotResolver,
  type AppDataSnapshotResolver,
  type ResolvedAppDataSnapshot,
} from "./storage/documents/appDataSnapshot";
export {
  getSchemaVersionArtifactByIdEffect,
  getSchemaVersionArtifactByVersionEffect,
  InvalidSchemaVersionArtifactInputError,
  SchemaManifestChecksumCollisionError,
  SchemaVersionArtifactConflictError,
  SchemaVersionArtifactCorruptionError,
  SchemaVersionArtifactDeploymentNotFoundError,
  SchemaVersionArtifactPersistenceError,
  SchemaVersionArtifactPreparationError,
  type EnsureSchemaVersionArtifactInput,
  type EnsureSchemaVersionArtifactResult,
  type ReadSchemaVersionArtifactError,
  type SchemaVersionArtifact,
  type SchemaVersionArtifactConflict,
  type SchemaVersionArtifactIdentity,
} from "./storage/catalog/schemaVersionArtifacts";
export {
  getStableTableIdentityByIdEffect,
  getStableTableIdentityByNameEffect,
  InvalidStableTableIdentityInputError,
  StableTableCatalogCorruptionError,
  StableTableCatalogDeploymentNotFoundError,
  StableTableCatalogIdExhaustedError,
  StableTableIdentityPersistenceError,
  type EnsureStableTableIdentityInput,
  type EnsureStableTableIdentityResult,
  type GetStableTableIdentityError,
  type StableTableIdentity,
  type StableTableIdentityName,
} from "./storage/catalog/stableTableCatalog";
export {
  getStableLogicalIndexIdentityByIdEffect,
  getStableLogicalIndexIdentityByNameEffect,
  InvalidStableLogicalIndexIdentityInputError,
  StableLogicalIndexCatalogCorruptionError,
  StableLogicalIndexIdentityPersistenceError,
  type GetStableLogicalIndexIdentityError,
  type StableLogicalIndexIdentity,
  type StableLogicalIndexIdentityName,
} from "./storage/catalog/stableLogicalIndexCatalog";
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
  AppIndexDefinitionReadPersistenceError,
  AppSchemaVersionIndexBindingConflictError,
  AppSchemaVersionIndexBindingPersistenceError,
  getAppIndexDefinitionByIdEffect,
  getAppSchemaVersionIndexBindingEffect,
  InvalidAppIndexDefinitionBindingInputError,
  listAppIndexDefinitionsForLogicalIndexEffect,
  listAppSchemaVersionIndexBindingsEffect,
  type AppCreationTimeIndexDefinitionParentIssue,
  type AppCreationTimeIndexDefinitionRequirementIssue,
  type AppDeveloperIndexDefinitionRequirementIssue,
  type AppIndexDefinitionRecord,
  type AppIndexDefinitionParentIssue,
  type AppSchemaVersionIndexBindingRecord,
  type InvalidAppIndexDefinitionBindingInputIssue,
  type ReadAppIndexDefinitionError,
  type ReadAppSchemaVersionIndexBindingError,
} from "./storage/indexes/appIndexDefinitions";
export { StableLogicalIndexCatalogIdExhaustedError } from "./storage/catalog/stableLogicalIndexCatalogAllocation";
export {
  IndexBuildStateClockNotFoundError,
  IndexBuildStateCorruptionError,
  IndexBuildStatePersistenceError,
  InvalidIndexBuildStateReadInputError,
  readFencedIndexBuildStateEffect,
  type FencedIndexBuildStateReadResult,
  type IndexBuildAuthorityMismatch,
  type IndexBuildAuthorityMismatches,
  type IndexBuildStateRecord,
  type IndexBuildStorageAuthority,
  type InvalidIndexBuildStateReadInputIssue,
  type ReadFencedIndexBuildStateError,
  type ReadFencedIndexBuildStateInput,
} from "./storage/indexes/indexBuildStates";
export {
  AppTableDefinitionsArtifactV1RetryExhaustedError,
  InvalidAppTableDefinitionsArtifactV1InputError,
  MAX_APP_TABLE_DEFINITIONS_ARTIFACT_V1_ATTEMPTS,
  type EnsureAppTableDefinitionsArtifactV1Input,
  type EnsureAppTableDefinitionsArtifactV1Result,
  type InvalidAppTableDefinitionsArtifactV1InputIssue,
} from "./storage/catalog/appTableDefinitionsArtifacts";
export {
  AppSchemaPublicationV1RetryExhaustedError,
  MAX_APP_SCHEMA_PUBLICATION_V1_ATTEMPTS,
  type AppSchemaPublicationV1Stale,
  type PublishAppSchemaV1Input,
  type PublishAppSchemaV1Result,
} from "./storage/catalog/appSchemaPublication";
export {
  InvalidAppSchemaPublicationV1InputError,
  type InvalidAppSchemaPublicationV1InputIssue,
} from "./storage/catalog/appSchemaPublicationPreparation";
export {
  InvalidSchemaManifestAppSchemaBindingInputError,
  type InvalidSchemaManifestAppSchemaBindingInputIssue,
} from "./storage/catalog/schemaManifestAppSchemaBindings";
export {
  SchemaManifestTableBindingCorruptionError,
} from "./storage/catalog/schemaManifestTableBindings";
export {
  AppSchemaPublicationV1ProjectionError,
  type AppSchemaPublicationV1Result,
  type AppSchemaPublicationV1ProjectionIssue,
} from "./storage/catalog/appSchemaPublicationTransaction";
export {
  AppSchemaPublicationV1QuotaExceededError,
  MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
  MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS,
  MAX_APP_SCHEMA_PUBLICATION_V1_DEVELOPER_INDEXES,
  MAX_APP_SCHEMA_PUBLICATION_V1_TABLES,
  type AppSchemaPublicationV1QuotaIssue,
} from "./storage/catalog/appSchemaPublicationPolicy";
export {
  ScopeClockCorruptionError,
  type ScopeClockRecord,
} from "./scope/scopeClock";
export * from "./storage/documents/documents";
export {
  type CommitInvokeSessionWritesInput,
  type CommitInvokeSessionWritesResult,
  type CommittedDocumentWriteRecord,
  InvokeSessionDeleteTargetError,
  InvokeSessionIndexOccConflictError,
  InvokeSessionInsertConflictError,
  InvokeSessionOccConflictError,
  InvokeSessionPatchTargetError,
  InvokeSessionReplaceTargetError,
  InvokeSessionTableOccConflictError,
  InvokeSessionUnsupportedStagedWriteError,
} from "./commit/commits";
export * from "./storage/indexes/indexEntries";
export * from "./legacy/invokeSessions";
export * from "./legacy/invokeSessionReads";
export * from "./legacy/invokeSessionTableReads";
export * from "./legacy/invokeSessionIndexReads";
export * from "./legacy/invokeSessionWrites";
export * from "./commit/outbox";
export * from "./sync/freshness";
export * from "./sync/liveQueryConnections";
export * from "./sync/liveQuerySubscriptions";
export * from "./sync/liveQueryDeliveries";
export * from "./values/validation";

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
  fxSystemTransactionJournalReceipts,
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
} from "./database/schema";
