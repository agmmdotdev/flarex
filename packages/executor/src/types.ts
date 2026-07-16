import type {
  CheckReadSetFreshnessResult,
  FreshnessSourceReadSet,
  FreshnessMirrorStore,
} from "@flarex/freshness";
import type {
  LegacyV1AppDataStore,
} from "@flarex/persistence-postgres/legacy-v1-app-data-engine";
import type { LiveQueryDeliveryChange } from "flarex";
import type { AuthConfig, ExecutionIdentity } from "flarex-protocol/auth";
import type { WritableJson } from "flarex-protocol/json";
import type {
  DeploymentPackageMetadataRecord,
  DeploymentMetadataRecord,
  DeploymentMetadataCursor,
  AbortInvokeSessionMetadataInput,
  AbortStaleInvokeSessionsMetadataInput,
  AbortStaleInvokeSessionsMetadataResult,
  ClaimLiveQueryDeliveriesInput,
  ClaimLiveQueryDeliveriesResult,
  FlarexPersistenceCheck,
  FinishInvokeSessionMetadataInput,
  InsertDeploymentPackageMetadataInput,
  InsertInvokeSessionMetadataInput,
  InsertOutboxEventInput,
  InvokeSessionMetadataRecord,
  DeleteLiveQuerySubscriptionResult,
  ListExpiredLiveQueryConnectionDeploymentsResult,
  ExpiredLiveQueryConnectionDeploymentCursor,
  ListExpiredLiveQueryConnectionDeploymentsInput as PersistenceListExpiredLiveQueryConnectionDeploymentsInput,
  ListDeploymentMetadataInput,
  ListDeploymentMetadataResult,
  ListLiveQuerySubscriptionsInput,
  ListPendingLiveQueryDeliveryDeploymentsInput,
  ListPendingLiveQueryDeliveryDeploymentsResult,
  ListStuckLiveQueryDeliveriesInput,
  ListStuckLiveQueryDeliveriesResult,
  ListUndeliveredLiveQueryDeliveriesInput,
  ListUndeliveredLiveQueryDeliveriesResult,
  ListOutboxEventsInput,
  ListOutboxEventsResult,
  ListUndeliveredOutboxEventsInput,
  LiveQueryDeliveryCursor,
  LiveQueryDeliveryRecord,
  LiveQueryConnectionRecord,
  LiveQuerySubscriptionConnectionKey,
  LiveQuerySubscriptionKey,
  LiveQuerySubscriptionRecord,
  MarkLiveQueryDeliveriesDeadLetteredInput,
  MarkLiveQueryDeliveriesDeadLetteredResult,
  MarkLiveQueryDeliveriesDeliveredInput,
  MarkLiveQueryDeliveriesDeliveredResult,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
  RecordLiveQueryDeliveryFailureInput,
  RecordLiveQueryDeliveryFailureResult,
  OutboxEventCursor,
  OutboxEventRecord,
  RecordLiveQueryRerunFailureInput,
  RecordLiveQueryRerunFailureResult,
  RecordLiveQueryRerunResultInput,
  RecordLiveQueryRerunResultResult,
  UpsertLiveQueryConnectionLeaseInput,
  UpsertLiveQuerySubscriptionWithLeaseInput,
  UpsertLiveQuerySubscriptionInput,
  CloseLiveQueryConnectionInput,
  DeleteExpiredLiveQuerySubscriptionsInput,
  DeleteExpiredLiveQuerySubscriptionsResult,
  ListActiveLiveQuerySubscriptionsInput,
  UpdateDeploymentMetadataActivationInput,
} from "@flarex/persistence-postgres";
import type { ArtifactSourcePackage } from "flarex/artifacts";

export type {
  ListOutboxEventsResult,
  ListUndeliveredOutboxEventsInput,
  ListPendingLiveQueryDeliveryDeploymentsInput,
  ListPendingLiveQueryDeliveryDeploymentsResult,
  ListStuckLiveQueryDeliveriesInput,
  ListStuckLiveQueryDeliveriesResult,
  ListUndeliveredLiveQueryDeliveriesInput,
  ListUndeliveredLiveQueryDeliveriesResult,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
  MarkLiveQueryDeliveriesDeadLetteredInput,
  MarkLiveQueryDeliveriesDeadLetteredResult,
  MarkLiveQueryDeliveriesDeliveredInput,
  MarkLiveQueryDeliveriesDeliveredResult,
  RecordLiveQueryDeliveryFailureInput,
  RecordLiveQueryDeliveryFailureResult,
  DeleteExpiredLiveQuerySubscriptionsResult,
  ListExpiredLiveQueryConnectionDeploymentsResult,
  ExpiredLiveQueryConnectionDeploymentCursor,
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
  liveQueryInvalidation?: LiveQueryInvalidationConfig;
}

export interface LiveQueryInvalidationConfig {
  freshnessStore?: FreshnessMirrorStore;
  notifyTrigger?(input: LiveQueryInvalidationTriggerInput): Promise<void> | void;
  onError?(input: LiveQueryInvalidationErrorInput): Promise<void> | void;
}

export interface LiveQueryInvalidationTriggerInput {
  deploymentId: string;
  projectId: string;
  sessionId: string;
  functionPath: string;
  committedTs: number;
  writes: CommittedDocumentWrite[];
}

export interface LiveQueryInvalidationErrorInput
  extends LiveQueryInvalidationTriggerInput {
  error: unknown;
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
  getActiveDeploymentAuthConfig(
    input: GetActiveDeploymentAuthConfigInput,
  ): Promise<GetActiveDeploymentAuthConfigResult>;
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
  listStuckLiveQueryDeliveries(
    input: ListStuckLiveQueryDeliveriesInput,
  ): Promise<ListStuckLiveQueryDeliveriesResult>;
  markLiveQueryDeliveriesDeadLettered(
    input: MarkLiveQueryDeliveriesDeadLetteredInput,
  ): Promise<MarkLiveQueryDeliveriesDeadLetteredResult>;
  deadLetterStuckLiveQueryDeliveries(
    input: DeadLetterStuckLiveQueryDeliveriesInput,
  ): Promise<DeadLetterStuckLiveQueryDeliveriesResult>;
  recordLiveQueryDeliveryFailure(
    input: RecordLiveQueryDeliveryFailureInput,
  ): Promise<RecordLiveQueryDeliveryFailureResult>;
  touchLiveQueryConnection(
    input: TouchLiveQueryConnectionInput,
  ): Promise<TouchLiveQueryConnectionResult>;
  recordLiveQuerySubscription(
    input: RecordLiveQuerySubscriptionInput,
  ): Promise<RecordLiveQuerySubscriptionResult>;
  removeLiveQuerySubscription(
    input: RemoveLiveQuerySubscriptionInput,
  ): Promise<DeleteLiveQuerySubscriptionResult>;
  removeLiveQuerySubscriptionsForConnection(
    input: RemoveLiveQuerySubscriptionsForConnectionInput,
  ): Promise<DeleteLiveQuerySubscriptionResult>;
  removeExpiredLiveQuerySubscriptions(
    input: RemoveExpiredLiveQuerySubscriptionsInput,
  ): Promise<DeleteExpiredLiveQuerySubscriptionsResult>;
  listExpiredLiveQueryConnectionDeployments(
    input: ListExpiredLiveQueryConnectionDeploymentsInput,
  ): Promise<ListExpiredLiveQueryConnectionDeploymentsResult>;
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
    input: RunQueryInvokeWithRetriesInput,
  ): Promise<RunQueryInvokeWithRetriesResult>;
  runInvokeWithRetries(
    input: RunMutationInvokeWithRetriesInput,
  ): Promise<RunMutationInvokeWithRetriesResult>;
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

export interface FlarexExecutorControlPersistence {
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
  ensureDeploymentAuthority(
    input: EnsureDeploymentInput,
  ): Promise<EnsureDeploymentAuthorityResult>;
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
  deleteExpiredLiveQuerySubscriptions(
    input: DeleteExpiredLiveQuerySubscriptionsInput,
  ): Promise<DeleteExpiredLiveQuerySubscriptionsResult>;
  listExpiredLiveQueryConnectionDeployments(
    input: PersistenceListExpiredLiveQueryConnectionDeploymentsInput,
  ): Promise<ListExpiredLiveQueryConnectionDeploymentsResult>;
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
  claimLiveQueryDeliveries(
    input: ClaimLiveQueryDeliveriesInput,
  ): Promise<ClaimLiveQueryDeliveriesResult>;
  recordLiveQueryDeliveryFailure(
    input: RecordLiveQueryDeliveryFailureInput,
  ): Promise<RecordLiveQueryDeliveryFailureResult>;
}

export interface FlarexExecutorPersistence
  extends FlarexExecutorControlPersistence, LegacyV1AppDataStore {}

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
  leaseDurationMs?: number;
  claimOwner?: string;
  deliver(deliveries: LiveQueryDeliveryRecord[]): Promise<void>;
}

export interface RunLiveQueryDeliveryBatchResult {
  deliveries: LiveQueryDeliveryRecord[];
  delivered: number;
  nextCursor: LiveQueryDeliveryCursor | null;
  hasMore: boolean;
  summary: LiveQueryDeliveryBatchSummary;
}

export interface LiveQueryDeliveryBatchSummary {
  claimed: number;
  delivered: number;
  acked: number;
  pending: number;
  hasMore: boolean;
}

export interface ClaimLiveQueryDeliveryBatchInput {
  deploymentId: string;
  cursor?: LiveQueryDeliveryCursor;
  limit?: number;
  leaseDurationMs?: number;
  claimOwner?: string;
}

export type ClaimLiveQueryDeliveryBatchResult = ClaimLiveQueryDeliveriesResult;

export interface AckLiveQueryDeliveriesInput {
  deploymentId: string;
  deliveryIds: string[];
  deliveredAt?: Date;
  claimOwner?: string;
}

export interface AckLiveQueryDeliveriesResult {
  delivered: number;
}

export interface DeadLetterStuckLiveQueryDeliveriesInput {
  deploymentId?: string;
  olderThan: Date;
  minAttempts?: number;
  cursor?: ListStuckLiveQueryDeliveriesInput["cursor"];
  limit?: number;
  reason: string;
  deadLetteredAt?: Date;
}

export interface DeadLetterStuckLiveQueryDeliveriesResult {
  scanned: LiveQueryDeliveryRecord[];
  deadLettered: LiveQueryDeliveryRecord[];
  reconnectConnectionIds: string[];
  nextCursor: ListStuckLiveQueryDeliveriesResult["nextCursor"];
  hasMore: boolean;
  summary: LiveQueryDeadLetterSummary;
}

export interface LiveQueryDeadLetterSummary {
  scanned: number;
  deadLettered: number;
  reconnectTargets: number;
  hasMore: boolean;
}

export interface TouchLiveQueryConnectionInput {
  deploymentId: string;
  projectId: string;
  connectionId: string;
  leaseDurationMs?: number;
  now?: Date;
}

export interface TouchLiveQueryConnectionResult {
  connection: LiveQueryConnectionRecord;
}

export interface RecordLiveQuerySubscriptionInput {
  deploymentId: string;
  projectId: string;
  connectionId: string;
  queryId: number;
  functionPath: string;
  argsJson: Json;
  identity?: ExecutionIdentity;
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

export type RemoveLiveQuerySubscriptionInput = LiveQuerySubscriptionKey & {
  projectId: string;
};

export type RemoveLiveQuerySubscriptionsForConnectionInput =
  LiveQuerySubscriptionConnectionKey & {
    projectId: string;
  };

export interface RemoveExpiredLiveQuerySubscriptionsInput {
  deploymentId: string;
  projectId: string;
  expiredAt?: Date;
}

export interface ListExpiredLiveQueryConnectionDeploymentsInput {
  expiredAt?: Date;
  cursor?: ExpiredLiveQueryConnectionDeploymentCursor;
  limit?: number;
}

export interface FindStaleLiveQuerySubscriptionsInput {
  deploymentId: string;
  freshnessStore: FreshnessMirrorStore;
  activeAt?: Date;
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

export interface RerunLiveQuerySubscriptionUpdatedResult {
  status: "updated";
  subscription: LiveQuerySubscriptionRecord;
  previousResultHash: string;
  resultHash: string;
  changed: boolean;
  delivery: LiveQueryDeliveryRecord | null;
}

export interface RerunLiveQuerySubscriptionFailedResult {
  status: "failed";
  subscription: LiveQuerySubscriptionRecord;
  previousResultHash: string;
  changed: true;
  deleted: number;
  delivery: LiveQueryDeliveryRecord | null;
  errorMessage: string;
}

export type RerunLiveQuerySubscriptionResult =
  | RerunLiveQuerySubscriptionUpdatedResult
  | RerunLiveQuerySubscriptionFailedResult;

export type LiveQueryChange = LiveQueryDeliveryChange;

export interface RerunStaleLiveQuerySubscriptionsInput {
  deploymentId: string;
  freshnessStore: FreshnessMirrorStore;
  limit?: number;
  updatedAt?: Date;
  activeAt?: Date;
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

export interface GetActiveDeploymentAuthConfigInput {
  deploymentId: string;
  projectId: string;
}

interface GetActiveDeploymentAuthConfigBase {
  deployment: DeploymentMetadataRecord;
  package: DeploymentPackageMetadataRecord;
}

export type GetActiveDeploymentAuthConfigResult =
  GetActiveDeploymentAuthConfigBase &
    (
      | {
          authConfig: AuthConfig;
          authConfigModule: string;
        }
      | {
          authConfig: null;
          authConfigModule: null;
        }
    );

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

export type Json = WritableJson;

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
  visibility?: FunctionVisibility;
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
  identity?: ExecutionIdentity;
}

export interface BeginInvokeSessionResult {
  sessionId: string;
  beginTs: number;
  identity: ExecutionIdentity;
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

export interface RunQueryInvokeWithRetriesInput extends RunInvokeWithRetriesInput {
  kind: "query";
}

export interface RunMutationInvokeWithRetriesInput extends RunInvokeWithRetriesInput {
  kind: "mutation";
}

export type RunQueryInvokeWithRetriesResult = FinishQueryInvokeSessionResult & {
  attempts: number;
  beginTs: number;
};

export type RunMutationInvokeWithRetriesResult = FinishMutationInvokeSessionResult & {
  attempts: number;
  beginTs: number;
};

export type RunInvokeWithRetriesResult = FinishInvokeSessionResult & {
  attempts: number;
  beginTs: number;
};

export interface FinishInvokeSessionInput {
  deploymentId: string;
  projectId: string;
  sessionId: string;
  value: Json;
}

export type FinishInvokeSessionResult =
  | FinishQueryInvokeSessionResult
  | FinishMutationInvokeSessionResult;

export interface FinishQueryInvokeSessionResult {
  value: Json;
  readSet: InvokeReadSet;
  readTs: number;
  committedTs?: never;
  writes?: never;
}

export interface FinishMutationInvokeSessionResult {
  value: Json;
  committedTs: number;
  writes: CommittedDocumentWrite[];
  readSet?: never;
  readTs?: never;
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
    observedTs?: number | null;
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

export interface EnsureDeploymentAuthorityResult {
  readonly deployment: DeploymentMetadataRecord;
  readonly createdDeployment: boolean;
}

export interface ReadyDeploymentAuthorityProvisioner {
  ensure(
    input: EnsureDeploymentInput,
  ): Promise<EnsureDeploymentAuthorityResult>;
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
