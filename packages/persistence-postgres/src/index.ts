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
  EnsureAppSchemaVersionArtifactV1Input,
  EnsureAppSchemaVersionArtifactV1Result,
} from "./appSchemaVersionArtifacts";
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
  ensureAppSchemaVersionArtifactV1(
    input: EnsureAppSchemaVersionArtifactV1Input,
  ): Promise<EnsureAppSchemaVersionArtifactV1Result>;
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
export * from "./scopeAuthorityResolution";
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
  AppSchemaVersionArtifactRetryExhaustedError,
  InvalidAppSchemaVersionArtifactV1InputError,
  MAX_APP_SCHEMA_VERSION_ARTIFACT_ATTEMPTS,
  type EnsureAppSchemaVersionArtifactV1Input,
  type EnsureAppSchemaVersionArtifactV1Result,
  type InvalidAppSchemaVersionArtifactV1InputIssue,
} from "./appSchemaVersionArtifacts";
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
export { flarexSchema } from "./schema";
export * from "./schema";
