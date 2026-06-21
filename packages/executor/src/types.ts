import type {
  CheckReadSetFreshnessResult,
  FreshnessSourceReadSet,
  FreshnessMirrorStore,
} from "@flarex/freshness";
import type {
  DeploymentPackageMetadataRecord,
  DeploymentMetadataRecord,
  DeploymentMetadataCursor,
  CommitInvokeSessionWritesInput,
  CommitInvokeSessionWritesResult,
  AbortInvokeSessionMetadataInput,
  AbortStaleInvokeSessionsMetadataInput,
  AbortStaleInvokeSessionsMetadataResult,
  FlarexPersistenceCheck,
  FinishInvokeSessionMetadataInput,
  InsertDeploymentPackageMetadataInput,
  InsertDeploymentMetadataInput,
  InsertInvokeSessionMetadataInput,
  InsertInvokeSessionDocumentReadInput,
  StageInvokeSessionDocumentWriteInput,
  InsertInvokeSessionIndexReadInput,
  InsertInvokeSessionTableReadInput,
  InsertOutboxEventInput,
  InvokeSessionDocumentReadRecord,
  InvokeSessionDocumentWriteRecord,
  InvokeSessionIndexReadRecord,
  InvokeSessionTableReadRecord,
  InvokeSessionMetadataRecord,
  DeleteLiveQuerySubscriptionResult,
  ListDeploymentMetadataInput,
  ListDeploymentMetadataResult,
  ListLiveQuerySubscriptionsInput,
  ListPendingLiveQueryDeliveryDeploymentsInput,
  ListPendingLiveQueryDeliveryDeploymentsResult,
  ListUndeliveredLiveQueryDeliveriesInput,
  ListUndeliveredLiveQueryDeliveriesResult,
  ListOutboxEventsInput,
  ListOutboxEventsResult,
  ListUndeliveredOutboxEventsInput,
  LiveQueryDeliveryCursor,
  LiveQueryDeliveryRecord,
  LiveQuerySubscriptionKey,
  LiveQuerySubscriptionRecord,
  MarkLiveQueryDeliveriesDeliveredInput,
  MarkLiveQueryDeliveriesDeliveredResult,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
  RecordLiveQueryDeliveryFailureInput,
  RecordLiveQueryDeliveryFailureResult,
  DocumentRevisionRecord,
  IndexedDocumentPage,
  ListDocumentsInIndexAtTsInput,
  OutboxEventCursor,
  OutboxEventRecord,
  RecordLiveQueryRerunResultInput,
  RecordLiveQueryRerunResultResult,
  UpsertLiveQuerySubscriptionInput,
  UpdateDeploymentMetadataActivationInput,
} from "@flarex/persistence-postgres";
import type { ArtifactSourcePackage } from "flarex/artifacts";

export type {
  ListOutboxEventsResult,
  ListUndeliveredOutboxEventsInput,
  ListPendingLiveQueryDeliveryDeploymentsInput,
  ListPendingLiveQueryDeliveryDeploymentsResult,
  ListUndeliveredLiveQueryDeliveriesInput,
  ListUndeliveredLiveQueryDeliveriesResult,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
  MarkLiveQueryDeliveriesDeliveredInput,
  MarkLiveQueryDeliveriesDeliveredResult,
  RecordLiveQueryDeliveryFailureInput,
  RecordLiveQueryDeliveryFailureResult,
  LiveQueryDeliveryCursor,
  LiveQueryDeliveryRecord,
  OutboxEventCursor,
} from "@flarex/persistence-postgres";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  nextId(): string;
}

export interface FlarexExecutorConfig {
  clock?: Clock;
  ids?: IdGenerator;
  persistence: FlarexExecutorPersistence;
}

export interface FlarexExecutor {
  activateDeploymentPackage(
    input: ActivateDeploymentPackageInput,
  ): Promise<ActivateDeploymentPackageResult>;
  ensureDeployment(input: EnsureDeploymentInput): Promise<EnsureDeploymentResult>;
  getActiveFunction(
    input: GetActiveFunctionInput,
  ): Promise<GetActiveFunctionResult>;
  getActiveDeploymentPackage(
    input: GetActiveDeploymentPackageInput,
  ): Promise<GetActiveDeploymentPackageResult>;
  beginInvokeSession(
    input: BeginInvokeSessionInput,
  ): Promise<BeginInvokeSessionResult>;
  finishInvokeSession(
    input: FinishInvokeSessionInput,
  ): Promise<FinishInvokeSessionResult>;
  abortInvokeSession(input: AbortInvokeSessionInput): Promise<AbortInvokeSessionResult>;
  abortStaleInvokeSessions(
    input: AbortStaleInvokeSessionsInput,
  ): Promise<AbortStaleInvokeSessionsResult>;
  runInvokeSessionMaintenance(
    input: RunInvokeSessionMaintenanceInput,
  ): Promise<RunInvokeSessionMaintenanceResult>;
  listMaintenanceDeployments(
    input?: ListMaintenanceDeploymentsInput,
  ): Promise<ListMaintenanceDeploymentsResult>;
  listUndeliveredOutboxEvents(
    input: ListUndeliveredOutboxEventsInput,
  ): Promise<ListOutboxEventsResult>;
  markOutboxEventsDelivered(
    input: MarkOutboxEventsDeliveredInput,
  ): Promise<MarkOutboxEventsDeliveredResult>;
  runOutboxDeliveryBatch(
    input: RunOutboxDeliveryBatchInput,
  ): Promise<RunOutboxDeliveryBatchResult>;
  listUndeliveredLiveQueryDeliveries(
    input: ListUndeliveredLiveQueryDeliveriesInput,
  ): Promise<ListUndeliveredLiveQueryDeliveriesResult>;
  markLiveQueryDeliveriesDelivered(
    input: MarkLiveQueryDeliveriesDeliveredInput,
  ): Promise<MarkLiveQueryDeliveriesDeliveredResult>;
  claimLiveQueryDeliveryBatch(
    input: ClaimLiveQueryDeliveryBatchInput,
  ): Promise<ClaimLiveQueryDeliveryBatchResult>;
  ackLiveQueryDeliveries(
    input: AckLiveQueryDeliveriesInput,
  ): Promise<AckLiveQueryDeliveriesResult>;
  runLiveQueryDeliveryBatch(
    input: RunLiveQueryDeliveryBatchInput,
  ): Promise<RunLiveQueryDeliveryBatchResult>;
  listPendingLiveQueryDeliveryDeployments(
    input: ListPendingLiveQueryDeliveryDeploymentsInput,
  ): Promise<ListPendingLiveQueryDeliveryDeploymentsResult>;
  recordLiveQueryDeliveryFailure(
    input: RecordLiveQueryDeliveryFailureInput,
  ): Promise<RecordLiveQueryDeliveryFailureResult>;
  recordLiveQuerySubscription(
    input: RecordLiveQuerySubscriptionInput,
  ): Promise<RecordLiveQuerySubscriptionResult>;
  removeLiveQuerySubscription(
    input: RemoveLiveQuerySubscriptionInput,
  ): Promise<DeleteLiveQuerySubscriptionResult>;
  findStaleLiveQuerySubscriptions(
    input: FindStaleLiveQuerySubscriptionsInput,
  ): Promise<FindStaleLiveQuerySubscriptionsResult>;
  rerunLiveQuerySubscription(
    input: RerunLiveQuerySubscriptionInput,
  ): Promise<RerunLiveQuerySubscriptionResult>;
  rerunStaleLiveQuerySubscriptions(
    input: RerunStaleLiveQuerySubscriptionsInput,
  ): Promise<RerunStaleLiveQuerySubscriptionsResult>;
  runLiveQuerySubscriptionWithInvoke(
    input: RunLiveQuerySubscriptionWithInvokeInput,
  ): Promise<RerunLiveQuerySubscriptionOutput>;
  runMaintenanceSweep(
    input: RunMaintenanceSweepInput,
  ): Promise<RunMaintenanceSweepResult>;
  runInvokeWithRetries(
    input: RunInvokeWithRetriesInput,
  ): Promise<RunInvokeWithRetriesResult>;
  invokeSyscall(input: InvokeSyscallInput): Promise<InvokeSyscallResult>;
  prepareInvoke(input: PrepareInvokeInput): Promise<PrepareInvokeResult>;
  registerDeploymentPackage(
    input: RegisterDeploymentPackageInput,
  ): Promise<RegisterDeploymentPackageResult>;
  health(): Promise<FlarexHealth>;
}

export interface FlarexExecutorPersistence {
  check(): Promise<FlarexPersistenceCheck>;
  getDeploymentPackageMetadata(
    deploymentId: string,
    packageId: string,
  ): Promise<DeploymentPackageMetadataRecord | null>;
  insertDeploymentPackageMetadata(
    input: InsertDeploymentPackageMetadataInput,
  ): Promise<DeploymentPackageMetadataRecord>;
  getDeploymentMetadata(
    deploymentId: string,
  ): Promise<DeploymentMetadataRecord | null>;
  listDeploymentMetadata(
    input: ListDeploymentMetadataInput,
  ): Promise<ListDeploymentMetadataResult>;
  insertDeploymentMetadata(
    input: InsertDeploymentMetadataInput,
  ): Promise<DeploymentMetadataRecord>;
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
  upsertLiveQuerySubscription(
    input: UpsertLiveQuerySubscriptionInput,
  ): Promise<LiveQuerySubscriptionRecord>;
  recordLiveQueryRerunResult(
    input: RecordLiveQueryRerunResultInput,
  ): Promise<RecordLiveQueryRerunResultResult>;
  deleteLiveQuerySubscription(
    input: LiveQuerySubscriptionKey,
  ): Promise<DeleteLiveQuerySubscriptionResult>;
  listLiveQuerySubscriptions(
    input: ListLiveQuerySubscriptionsInput,
  ): Promise<LiveQuerySubscriptionRecord[]>;
  listUndeliveredLiveQueryDeliveries(
    input: ListUndeliveredLiveQueryDeliveriesInput,
  ): Promise<ListUndeliveredLiveQueryDeliveriesResult>;
  listPendingLiveQueryDeliveryDeployments(
    input: ListPendingLiveQueryDeliveryDeploymentsInput,
  ): Promise<ListPendingLiveQueryDeliveryDeploymentsResult>;
  markLiveQueryDeliveriesDelivered(
    input: MarkLiveQueryDeliveriesDeliveredInput,
  ): Promise<MarkLiveQueryDeliveriesDeliveredResult>;
  recordLiveQueryDeliveryFailure(
    input: RecordLiveQueryDeliveryFailureInput,
  ): Promise<RecordLiveQueryDeliveryFailureResult>;
}

export interface RunOutboxDeliveryBatchInput {
  deploymentId: string;
  cursor?: OutboxEventCursor;
  limit?: number;
  deliveredAt?: Date;
  deliver(events: OutboxEventRecord[]): Promise<void>;
}

export interface RunOutboxDeliveryBatchResult {
  events: OutboxEventRecord[];
  delivered: number;
  nextCursor: OutboxEventCursor | null;
  hasMore: boolean;
}

export interface RunLiveQueryDeliveryBatchInput {
  deploymentId: string;
  cursor?: LiveQueryDeliveryCursor;
  limit?: number;
  deliveredAt?: Date;
  deliver(deliveries: LiveQueryDeliveryRecord[]): Promise<void>;
}

export interface RunLiveQueryDeliveryBatchResult {
  deliveries: LiveQueryDeliveryRecord[];
  delivered: number;
  nextCursor: LiveQueryDeliveryCursor | null;
  hasMore: boolean;
}

export interface ClaimLiveQueryDeliveryBatchInput {
  deploymentId: string;
  cursor?: LiveQueryDeliveryCursor;
  limit?: number;
}

export interface ClaimLiveQueryDeliveryBatchResult {
  deliveries: LiveQueryDeliveryRecord[];
  nextCursor: LiveQueryDeliveryCursor | null;
  hasMore: boolean;
}

export interface AckLiveQueryDeliveriesInput {
  deploymentId: string;
  deliveryIds: string[];
  deliveredAt?: Date;
}

export interface AckLiveQueryDeliveriesResult {
  delivered: number;
}

export interface RecordLiveQuerySubscriptionInput {
  deploymentId: string;
  connectionId: string;
  queryId: number;
  functionPath: string;
  argsJson: Json;
  partitionKey?: string | null;
  beginTs: number;
  readSet: FreshnessSourceReadSet;
  resultJson: Json;
  updatedAt?: Date;
}

export interface RecordLiveQuerySubscriptionResult {
  subscription: LiveQuerySubscriptionRecord;
  resultHash: string;
}

export type RemoveLiveQuerySubscriptionInput = LiveQuerySubscriptionKey;

export interface FindStaleLiveQuerySubscriptionsInput {
  deploymentId: string;
  freshnessStore: FreshnessMirrorStore;
}

export interface LiveQuerySubscriptionFreshnessEntry {
  subscription: LiveQuerySubscriptionRecord;
  freshness: CheckReadSetFreshnessResult;
}

export interface FindStaleLiveQuerySubscriptionsResult {
  fresh: LiveQuerySubscriptionFreshnessEntry[];
  stale: LiveQuerySubscriptionFreshnessEntry[];
  unsupported: LiveQuerySubscriptionFreshnessEntry[];
}

export interface RerunLiveQuerySubscriptionOutput {
  value: Json;
  beginTs: number;
  readSet: FreshnessSourceReadSet;
}

export interface RerunLiveQuerySubscriptionInput {
  subscription: LiveQuerySubscriptionRecord;
  deliveryId?: string;
  updatedAt?: Date;
  runQuery(
    subscription: LiveQuerySubscriptionRecord,
  ): Promise<RerunLiveQuerySubscriptionOutput>;
}

export interface RerunLiveQuerySubscriptionResult {
  subscription: LiveQuerySubscriptionRecord;
  previousResultHash: string;
  resultHash: string;
  changed: boolean;
  delivery: LiveQueryDeliveryRecord | null;
}

export interface LiveQueryChange {
  deploymentId: string;
  connectionId: string;
  queryId: number;
  functionPath: string;
  argsJson: Json;
  resultJson: Json;
  previousResultHash: string;
  resultHash: string;
}

export interface RerunStaleLiveQuerySubscriptionsInput {
  deploymentId: string;
  freshnessStore: FreshnessMirrorStore;
  limit?: number;
  updatedAt?: Date;
  runQuery(
    subscription: LiveQuerySubscriptionRecord,
  ): Promise<RerunLiveQuerySubscriptionOutput>;
  deliverChanges?(changes: LiveQueryChange[]): Promise<void> | void;
}

export interface RerunStaleLiveQuerySubscriptionsResult {
  scanned: FindStaleLiveQuerySubscriptionsResult;
  changed: RerunLiveQuerySubscriptionResult[];
  unchanged: RerunLiveQuerySubscriptionResult[];
  changes: LiveQueryChange[];
  unsupported: LiveQuerySubscriptionFreshnessEntry[];
  hasMoreStale: boolean;
}

export interface RunLiveQuerySubscriptionWithInvokeInput {
  subscription: LiveQuerySubscriptionRecord;
  projectId?: string;
  maxAttempts?: number;
  executeQuery(
    attempt: InvokeAttemptContext,
    subscription: LiveQuerySubscriptionRecord,
  ): Promise<Json>;
}

export interface ActivateDeploymentPackageInput {
  deploymentId: string;
  projectId: string;
  packageId: string;
  schemaVersion: number;
}

export interface ActivateDeploymentPackageResult {
  deployment: DeploymentMetadataRecord;
  createdDeployment: boolean;
}

export interface RegisterDeploymentPackageInput {
  deploymentId: string;
  projectId: string;
  sourcePackage: ArtifactSourcePackage;
  analysisJson?: Record<string, unknown> | null;
}

export interface RegisterDeploymentPackageResult {
  deployment: DeploymentMetadataRecord;
  package: DeploymentPackageMetadataRecord;
  createdDeployment: boolean;
  createdPackage: boolean;
}

export interface GetActiveDeploymentPackageInput {
  deploymentId: string;
  projectId: string;
}

export interface GetActiveDeploymentPackageResult {
  deployment: DeploymentMetadataRecord;
  package: DeploymentPackageMetadataRecord;
}

export interface GetActiveFunctionInput {
  deploymentId: string;
  projectId: string;
  path: string;
}

export interface GetActiveFunctionResult {
  deployment: DeploymentMetadataRecord;
  package: DeploymentPackageMetadataRecord;
  function: DeploymentFunctionMetadata;
}

export type DeploymentFunctionKind =
  | "query"
  | "mutation"
  | "action"
  | "workflowMutation";

export type FunctionVisibility = "public" | "internal";

export interface DeploymentFunctionMetadata {
  path: string;
  kind: DeploymentFunctionKind;
  visibility?: FunctionVisibility;
  args?: unknown;
  returns?: unknown;
  route?: FunctionRoutePolicy | null;
  partition?: FunctionPartitionMetadata | null;
  position?: unknown;
}

export type InvokableFunctionKind = "query" | "mutation";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type TablePlacement =
  | { kind: "partitionBy"; field: string }
  | { kind: "colocateWith"; table: string; field: string }
  | { kind: "global" };

export interface SchemaTableMetadata {
  tableId: number;
  name: string;
  state?: "active" | "hidden" | "deleted";
  placement: TablePlacement;
}

export interface SchemaIndexMetadata {
  indexId: number;
  tableId: number;
  name: string;
  fields: string[];
  state?: "enabled" | "staged" | "disabled";
}

export interface DeploymentSchemaMetadata {
  version: number;
  tables: SchemaTableMetadata[];
  indexes: SchemaIndexMetadata[];
}

export type FunctionRoutePolicy = { type: "args"; field: string };

export type FunctionPartitionPolicy = {
  type: "partition";
  table: string;
  selector: string;
  partitionField: string;
  argField: string;
};

export type FunctionPartitionCreateRootPolicy = {
  type: "partitionCreateRoot";
  table: string;
  partitionField: "_id";
};

export type FunctionPartitionMetadata =
  | FunctionPartitionPolicy
  | FunctionPartitionCreateRootPolicy;

export type FunctionExecutionScope =
  | {
      kind: "partition";
      table: string;
      selector: string;
      partitionField: string;
      argField: string;
      partitionKey: string;
    }
  | {
      kind: "partitionCreateRoot";
      table: string;
      partitionField: "_id";
      partitionKey: string;
      preallocatedRootId: string;
    };

export interface PrepareInvokeInput {
  deploymentId: string;
  projectId: string;
  path: string;
  kind?: InvokableFunctionKind;
  args: Json;
  partitionKey?: string;
}

export interface PrepareInvokeResult {
  deployment: DeploymentMetadataRecord;
  package: DeploymentPackageMetadataRecord;
  function: DeploymentFunctionMetadata & { kind: InvokableFunctionKind };
  schema: DeploymentSchemaMetadata;
  scope: FunctionExecutionScope;
  executionModule: string;
}

export interface BeginInvokeSessionInput extends PrepareInvokeInput {
  idempotencyKey?: string;
}

export interface BeginInvokeSessionResult {
  sessionId: string;
  beginTs: number;
  schemaVersion: number;
  function: {
    path: string;
    kind: InvokableFunctionKind;
  };
  scope: FunctionExecutionScope;
  executionModule: string;
}

export type InvokeSyscallRequest =
  | {
      op: "get";
      id: string;
    }
  | {
      op: "query";
      request: Json;
    }
  | {
      op: "insert";
      table: string;
      value: Json;
      id?: string;
    }
  | {
      op: "patch";
      id: string;
      value: Json;
    }
  | {
      op: "replace";
      id: string;
      value: Json;
    }
  | {
      op: "delete";
      id: string;
    };

export interface InvokeSyscallInput {
  deploymentId: string;
  projectId: string;
  sessionId: string;
  syscall: InvokeSyscallRequest;
}

export interface InvokeSyscallResult {
  value: Json;
  readSet?: InvokeReadSet;
}

export interface InvokeAttemptContext {
  attempt: number;
  maxAttempts: number;
  session: BeginInvokeSessionResult;
  syscall(syscall: InvokeSyscallRequest): Promise<InvokeSyscallResult>;
}

export interface RunInvokeWithRetriesInput extends BeginInvokeSessionInput {
  maxAttempts?: number;
  runAttempt(attempt: InvokeAttemptContext): Promise<Json>;
}

export interface RunInvokeWithRetriesResult extends FinishInvokeSessionResult {
  attempts: number;
  beginTs: number;
}

export interface FinishInvokeSessionInput {
  deploymentId: string;
  projectId: string;
  sessionId: string;
  value: Json;
}

export interface FinishInvokeSessionResult {
  value: Json;
  readSet?: InvokeReadSet;
  committedTs?: number;
  writes?: CommittedDocumentWrite[];
}

export interface AbortInvokeSessionInput {
  deploymentId: string;
  projectId: string;
  sessionId: string;
}

export interface AbortInvokeSessionResult {
  aborted: true;
}

export interface AbortStaleInvokeSessionsInput {
  deploymentId: string;
  projectId: string;
  olderThan: Date;
  limit?: number;
}

export interface AbortStaleInvokeSessionsResult {
  aborted: number;
  sessions: string[];
  hasMore: boolean;
}

export interface RunInvokeSessionMaintenanceInput {
  deploymentId: string;
  projectId: string;
  staleAfterMs: number;
  maxSessions?: number;
}

export interface RunInvokeSessionMaintenanceResult {
  staleAborted: number;
  sessions: string[];
  hasMore: boolean;
}

export interface ListMaintenanceDeploymentsInput {
  limit?: number;
  cursor?: DeploymentMetadataCursor;
}

export interface ListMaintenanceDeploymentsResult {
  deployments: DeploymentMetadataRecord[];
  nextCursor: DeploymentMetadataCursor | null;
  hasMore: boolean;
}

export interface RunMaintenanceSweepInput {
  staleAfterMs: number;
  deploymentLimit?: number;
  deploymentCursor?: DeploymentMetadataCursor;
  maxSessionsPerDeployment?: number;
}

export interface MaintenanceSweepDeploymentResult {
  deploymentId: string;
  projectId: string;
  staleAborted: number;
  sessions: string[];
  hasMoreSessions: boolean;
}

export interface RunMaintenanceSweepResult {
  deployments: MaintenanceSweepDeploymentResult[];
  nextDeploymentCursor: DeploymentMetadataCursor | null;
  hasMoreDeployments: boolean;
}

export interface CommittedDocumentWrite {
  tableId: number;
  id: string;
  prevTs: number | null;
  ts: number;
  value: Json | null;
}

export interface InvokeReadSet {
  documents?: Array<{
    tableId: number;
    id: string;
  }>;
  tables?: Array<{
    tableId: number;
  }>;
  indexes?: Array<{
    indexId: number;
    lower?: string;
    upper?: string;
  }>;
}

export interface EnsureDeploymentInput {
  deploymentId: string;
  projectId: string;
}

export interface EnsureDeploymentResult {
  deployment: DeploymentMetadataRecord;
  created: boolean;
}

export interface FlarexHealth {
  service: "executor";
  status: "ok" | "degraded";
  persistence: FlarexExecutorDependencyHealth;
  time: string;
}

export type FlarexExecutorDependencyHealth =
  | {
      status: "ok";
    }
  | {
      status: "error";
      message: string;
    };
