import type {
  FlarexExecutor,
  RerunStaleLiveQuerySubscriptionsInput,
  RunLiveQueryDeliveryBatchInput,
  RunLiveQuerySubscriptionWithInvokeInput,
} from "@flarex/executor";

export interface FlarexLiveQueryRerunConfig {
  freshnessStore: RerunStaleLiveQuerySubscriptionsInput["freshnessStore"];
  executeQuery: RunLiveQuerySubscriptionWithInvokeInput["executeQuery"];
  deliverChanges?: RerunStaleLiveQuerySubscriptionsInput["deliverChanges"];
  notifyDelivery?: (input: {
    deploymentId: string;
    limit?: number;
  }) => Promise<void> | void;
}

export interface FlarexLiveQueryDeliveryConfig {
  deliver: RunLiveQueryDeliveryBatchInput["deliver"];
}

export interface FlarexHttpAppConfig {
  executor: FlarexExecutor;
  capabilityToken?: string;
  healthPath?: string;
  invokePreparePath?: string;
  invokeStartPath?: string;
  invokeSyscallPath?: string;
  invokeFinishPath?: string;
  invokeAbortPath?: string;
  invokeAbortStalePath?: string;
  maintenanceInvokeSessionsPath?: string;
  maintenanceLiveQueryRerunPath?: string;
  maintenanceLiveQueryDeliveryPath?: string;
  liveQueryConnectionTouchPath?: string;
  liveQuerySubscriptionRecordPath?: string;
  liveQuerySubscriptionRemovePath?: string;
  liveQuerySubscriptionRemoveConnectionPath?: string;
  maintenanceLiveQueryConnectionCleanupPath?: string;
  maintenanceLiveQueryExpiredConnectionDeploymentsPath?: string;
  maintenanceLiveQueryClaimPath?: string;
  maintenanceLiveQueryAckPath?: string;
  maintenanceLiveQueryFailurePath?: string;
  maintenanceLiveQueryDeadLetterPath?: string;
  maintenanceLiveQueryDeadLetterStuckPath?: string;
  maintenanceLiveQueryPendingDeploymentsPath?: string;
  maintenanceLiveQueryStuckDeliveriesPath?: string;
  liveQueryRerun?: FlarexLiveQueryRerunConfig;
  liveQueryDelivery?: FlarexLiveQueryDeliveryConfig;
}
