import type { SQLWrapper } from "drizzle-orm";
import type {
  CommitInvokeSessionWritesInput,
  CommitInvokeSessionWritesResult,
} from "./commits";
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
  InsertInvokeSessionDocumentReadInput,
  InvokeSessionDocumentReadRecord,
} from "./invokeSessionReads";
import type {
  InsertInvokeSessionTableReadInput,
  InvokeSessionTableReadRecord,
} from "./invokeSessionTableReads";
import type {
  InsertInvokeSessionIndexReadInput,
  InvokeSessionIndexReadRecord,
} from "./invokeSessionIndexReads";
import type {
  StageInvokeSessionDocumentWriteInput,
  InvokeSessionDocumentWriteRecord,
} from "./invokeSessionWrites";
import type {
  InsertOutboxEventInput,
  ListOutboxEventsInput,
  ListOutboxEventsResult,
  ListUndeliveredOutboxEventsInput,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
  OutboxEventRecord,
} from "./outbox";
import type {
  HasIndexEntryAfterTsInput,
  IndexedDocumentPage,
  ListDocumentsInIndexAtTsInput,
} from "./indexEntries";
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

export interface FlarexPersistence extends FlarexSqlClient {
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
  getDocumentRevisionAtTs(
    deploymentId: string,
    id: string,
    ts: number,
  ): Promise<DocumentRevisionRecord | null>;
  listDocumentsInTableAtTs(
    deploymentId: string,
    tableId: number,
    ts: number,
    limit?: number,
  ): Promise<DocumentRevisionRecord[]>;
  listDocumentsInIndexAtTs(
    input: ListDocumentsInIndexAtTsInput,
  ): Promise<IndexedDocumentPage>;
  hasIndexEntryAfterTs(input: HasIndexEntryAfterTsInput): Promise<boolean>;
  insertInvokeSessionDocumentRead(
    input: InsertInvokeSessionDocumentReadInput,
  ): Promise<InvokeSessionDocumentReadRecord>;
  listInvokeSessionDocumentReads(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionDocumentReadRecord[]>;
  insertInvokeSessionTableRead(
    input: InsertInvokeSessionTableReadInput,
  ): Promise<InvokeSessionTableReadRecord>;
  listInvokeSessionTableReads(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionTableReadRecord[]>;
  insertInvokeSessionIndexRead(
    input: InsertInvokeSessionIndexReadInput,
  ): Promise<InvokeSessionIndexReadRecord>;
  listInvokeSessionIndexReads(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionIndexReadRecord[]>;
  stageInvokeSessionDocumentWrite(
    input: StageInvokeSessionDocumentWriteInput,
  ): Promise<InvokeSessionDocumentWriteRecord>;
  listInvokeSessionDocumentWrites(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionDocumentWriteRecord[]>;
  commitInvokeSessionWrites(
    input: CommitInvokeSessionWritesInput,
  ): Promise<CommitInvokeSessionWritesResult>;
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
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T>;
}

export interface FlarexPersistenceCheck {
  status: "ok";
}

export * from "./deploymentPackages";
export * from "./deployments";
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
