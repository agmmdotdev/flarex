import { Elysia } from "elysia";
import {
  DeploymentFunctionMetadataUnavailableError,
  DeploymentNotFoundError,
  DeploymentPackageNotActivatedError,
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
  DeploymentSchemaMetadataUnavailableError,
  DeploymentValidatorMetadataError,
  FlarexDocumentIdFormatError,
  FlarexInsertIdTableMismatchError,
  FunctionKindMismatchError,
  FunctionNotFoundError,
  FunctionNotInvokableError,
  FunctionVisibilityMismatchError,
  InvokeDeleteDocumentNotFoundError,
  InvokeFinishNotImplementedError,
  InvokePatchDocumentNotFoundError,
  InvokePatchNonObjectDocumentError,
  InvokePatchValueError,
  InvokeQueryRequestError,
  InvokeSessionDocumentValidationError,
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeSessionDocumentWriteAlreadyExistsError,
  InvokeSessionInsertConflictError,
  InvokeSessionIndexOccConflictError,
  InvokeSessionOccConflictError,
  InvokeSessionPatchTargetError,
  InvokeSessionTableOccConflictError,
  InvokeSessionUnsupportedStagedWriteError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
  LiveQuerySubscriptionRerunError,
  LiveQueryDeliveryPolicyError,
  MaintenancePolicyError,
  PartitionValidationError,
  InvokeSessionDeleteTargetError,
  type AbortInvokeSessionInput,
  type AbortStaleInvokeSessionsInput,
  type AckLiveQueryDeliveriesInput,
  type BeginInvokeSessionInput,
  type ClaimLiveQueryDeliveryBatchInput,
  type DeadLetterStuckLiveQueryDeliveriesInput,
  type FinishInvokeSessionInput,
  type FlarexExecutor,
  type FunctionVisibility,
  type InvokableFunctionKind,
  type InvokeSyscallInput,
  type InvokeSyscallRequest,
  type Json,
  type ListExpiredLiveQueryConnectionDeploymentsInput,
  type ListPendingLiveQueryDeliveryDeploymentsInput,
  type ListStuckLiveQueryDeliveriesInput,
  type MarkLiveQueryDeliveriesDeadLetteredInput,
  type PrepareInvokeInput,
  type RecordLiveQueryDeliveryFailureInput,
  type RecordLiveQuerySubscriptionInput,
  type RemoveExpiredLiveQuerySubscriptionsInput,
  type RemoveLiveQuerySubscriptionInput,
  type RemoveLiveQuerySubscriptionsForConnectionInput,
  type RunInvokeSessionMaintenanceInput,
  type RerunStaleLiveQuerySubscriptionsInput,
  type RunLiveQueryDeliveryBatchInput,
  type RunLiveQuerySubscriptionWithInvokeInput,
  type TouchLiveQueryConnectionInput,
} from "@flarex/executor";

export {
  createFlarexBackendLiveQueryDelivery,
  createFlarexBackendLiveQueryTriggerNotifier,
  createFlarexBackendLiveQueryWakeNotifier,
  type FlarexBackendLiveQueryDeliveryConfig,
  type FlarexBackendLiveQueryTriggerConfig,
  type FlarexBackendLiveQueryTriggerInput,
  type FlarexBackendLiveQueryWakeConfig,
  type FlarexBackendLiveQueryWakeInput,
} from "./liveQueryDelivery";

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

export function createFlarexHttpApp(config: FlarexHttpAppConfig) {
  const executor = config.executor;
  const healthPath = normalizePath(config.healthPath ?? "/health");
  const invokePreparePath = normalizePath(
    config.invokePreparePath ?? "/invoke/prepare",
  );
  const invokeStartPath = normalizePath(
    config.invokeStartPath ?? "/invoke/start",
  );
  const invokeSyscallPath = normalizePath(
    config.invokeSyscallPath ?? "/invoke/syscall",
  );
  const invokeFinishPath = normalizePath(
    config.invokeFinishPath ?? "/invoke/finish",
  );
  const invokeAbortPath = normalizePath(
    config.invokeAbortPath ?? "/invoke/abort",
  );
  const invokeAbortStalePath = normalizePath(
    config.invokeAbortStalePath ?? "/invoke/abort-stale",
  );
  const maintenanceInvokeSessionsPath = normalizePath(
    config.maintenanceInvokeSessionsPath ?? "/maintenance/invoke-sessions",
  );
  const maintenanceLiveQueryRerunPath = normalizePath(
    config.maintenanceLiveQueryRerunPath ??
      "/maintenance/live-queries/rerun",
  );
  const maintenanceLiveQueryDeliveryPath = normalizePath(
    config.maintenanceLiveQueryDeliveryPath ??
      "/maintenance/live-queries/deliver",
  );
  const liveQueryConnectionTouchPath = normalizePath(
    config.liveQueryConnectionTouchPath ?? "/live-query-connections/touch",
  );
  const liveQuerySubscriptionRecordPath = normalizePath(
    config.liveQuerySubscriptionRecordPath ??
      "/live-query-subscriptions/record",
  );
  const liveQuerySubscriptionRemovePath = normalizePath(
    config.liveQuerySubscriptionRemovePath ??
      "/live-query-subscriptions/remove",
  );
  const liveQuerySubscriptionRemoveConnectionPath = normalizePath(
    config.liveQuerySubscriptionRemoveConnectionPath ??
      "/live-query-subscriptions/remove-connection",
  );
  const maintenanceLiveQueryConnectionCleanupPath = normalizePath(
    config.maintenanceLiveQueryConnectionCleanupPath ??
      "/maintenance/live-queries/connections/cleanup",
  );
  const maintenanceLiveQueryExpiredConnectionDeploymentsPath = normalizePath(
    config.maintenanceLiveQueryExpiredConnectionDeploymentsPath ??
      "/maintenance/live-queries/expired-connection-deployments",
  );
  const maintenanceLiveQueryClaimPath = normalizePath(
    config.maintenanceLiveQueryClaimPath ??
      "/maintenance/live-queries/claim",
  );
  const maintenanceLiveQueryAckPath = normalizePath(
    config.maintenanceLiveQueryAckPath ?? "/maintenance/live-queries/ack",
  );
  const maintenanceLiveQueryFailurePath = normalizePath(
    config.maintenanceLiveQueryFailurePath ??
      "/maintenance/live-queries/failure",
  );
  const maintenanceLiveQueryDeadLetterPath = normalizePath(
    config.maintenanceLiveQueryDeadLetterPath ??
      "/maintenance/live-queries/dead-letter",
  );
  const maintenanceLiveQueryDeadLetterStuckPath = normalizePath(
    config.maintenanceLiveQueryDeadLetterStuckPath ??
      "/maintenance/live-queries/dead-letter-stuck",
  );
  const maintenanceLiveQueryPendingDeploymentsPath = normalizePath(
    config.maintenanceLiveQueryPendingDeploymentsPath ??
      "/maintenance/live-queries/pending-deployments",
  );
  const maintenanceLiveQueryStuckDeliveriesPath = normalizePath(
    config.maintenanceLiveQueryStuckDeliveriesPath ??
      "/maintenance/live-queries/stuck-deliveries",
  );
  const capabilityToken = config.capabilityToken;

  return new Elysia()
    .get(healthPath, () => executor.health())
    .post(invokePreparePath, ({ request, set }) =>
      handleInvokePrepare(executor, request, set, capabilityToken),
    )
    .post(invokeStartPath, ({ request, set }) =>
      handleInvokeStart(executor, request, set, capabilityToken),
    )
    .post(invokeSyscallPath, ({ request, set }) =>
      handleInvokeSyscall(executor, request, set, capabilityToken),
    )
    .post(invokeFinishPath, ({ request, set }) =>
      handleInvokeFinish(executor, request, set, capabilityToken),
    )
    .post(invokeAbortPath, ({ request, set }) =>
      handleInvokeAbort(executor, request, set, capabilityToken),
    )
    .post(invokeAbortStalePath, ({ request, set }) =>
      handleInvokeAbortStale(executor, request, set, capabilityToken),
    )
    .post(maintenanceInvokeSessionsPath, ({ request, set }) =>
      handleInvokeSessionMaintenance(executor, request, set, capabilityToken),
    )
    .post(maintenanceLiveQueryRerunPath, ({ request, set }) =>
      handleLiveQueryRerunMaintenance(
        executor,
        request,
        set,
        capabilityToken,
        config.liveQueryRerun,
      ),
    )
    .post(maintenanceLiveQueryDeliveryPath, ({ request, set }) =>
      handleLiveQueryDeliveryMaintenance(
        executor,
        request,
        set,
        capabilityToken,
        config.liveQueryDelivery,
      ),
    )
    .post(liveQueryConnectionTouchPath, ({ request, set }) =>
      handleLiveQueryConnectionTouch(executor, request, set, capabilityToken),
    )
    .post(liveQuerySubscriptionRecordPath, ({ request, set }) =>
      handleLiveQuerySubscriptionRecord(executor, request, set, capabilityToken),
    )
    .post(liveQuerySubscriptionRemovePath, ({ request, set }) =>
      handleLiveQuerySubscriptionRemove(executor, request, set, capabilityToken),
    )
    .post(liveQuerySubscriptionRemoveConnectionPath, ({ request, set }) =>
      handleLiveQuerySubscriptionRemoveConnection(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryConnectionCleanupPath, ({ request, set }) =>
      handleLiveQueryConnectionCleanup(executor, request, set, capabilityToken),
    )
    .post(maintenanceLiveQueryClaimPath, ({ request, set }) =>
      handleLiveQueryClaimMaintenance(executor, request, set, capabilityToken),
    )
    .post(maintenanceLiveQueryAckPath, ({ request, set }) =>
      handleLiveQueryAckMaintenance(executor, request, set, capabilityToken),
    )
    .post(maintenanceLiveQueryFailurePath, ({ request, set }) =>
      handleLiveQueryFailureMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryDeadLetterPath, ({ request, set }) =>
      handleLiveQueryDeadLetterMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryDeadLetterStuckPath, ({ request, set }) =>
      handleLiveQueryDeadLetterStuckMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryPendingDeploymentsPath, ({ request, set }) =>
      handleLiveQueryPendingDeploymentsMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryExpiredConnectionDeploymentsPath, ({ request, set }) =>
      handleLiveQueryExpiredConnectionDeploymentsMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryStuckDeliveriesPath, ({ request, set }) =>
      handleLiveQueryStuckDeliveriesMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .all(invokePreparePath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokePreparePath} only supports POST`,
      };
    })
    .all(invokeStartPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeStartPath} only supports POST`,
      };
    })
    .all(invokeSyscallPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeSyscallPath} only supports POST`,
      };
    })
    .all(invokeFinishPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeFinishPath} only supports POST`,
      };
    })
    .all(invokeAbortPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeAbortPath} only supports POST`,
      };
    })
    .all(invokeAbortStalePath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeAbortStalePath} only supports POST`,
      };
    })
    .all(maintenanceInvokeSessionsPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceInvokeSessionsPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryRerunPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryRerunPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryDeliveryPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryDeliveryPath} only supports POST`,
      };
    })
    .all(liveQueryConnectionTouchPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${liveQueryConnectionTouchPath} only supports POST`,
      };
    })
    .all(liveQuerySubscriptionRecordPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${liveQuerySubscriptionRecordPath} only supports POST`,
      };
    })
    .all(liveQuerySubscriptionRemovePath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${liveQuerySubscriptionRemovePath} only supports POST`,
      };
    })
    .all(liveQuerySubscriptionRemoveConnectionPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${liveQuerySubscriptionRemoveConnectionPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryConnectionCleanupPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryConnectionCleanupPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryExpiredConnectionDeploymentsPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryExpiredConnectionDeploymentsPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryClaimPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryClaimPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryAckPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryAckPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryFailurePath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryFailurePath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryDeadLetterPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryDeadLetterPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryDeadLetterStuckPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryDeadLetterStuckPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryPendingDeploymentsPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryPendingDeploymentsPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryStuckDeliveriesPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryStuckDeliveriesPath} only supports POST`,
      };
    })
    .all("*", ({ request, set }) => {
      const url = new URL(request.url);
      set.status = 404;
      return {
        error: "not_found",
        message: `No Flarex executor adapter route for ${request.method} ${url.pathname}`,
      };
    });
}

export function createFlarexHttpHandler(
  config: FlarexHttpAppConfig,
): (request: Request) => Promise<Response> {
  const app = createFlarexHttpApp(config);
  return (request) => app.handle(request);
}

async function handleInvokePrepare(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<Record<string, unknown>> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parsePrepareInvokeBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    const prepared = await executor.prepareInvoke(input.value);
    return {
      deploymentId: prepared.deployment.deploymentId,
      packageId: prepared.package.packageId,
      path: prepared.function.path,
      kind: prepared.function.kind,
      schemaVersion: prepared.schema.version,
      scope: prepared.scope,
      executionModule: prepared.executionModule,
    };
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleInvokeStart(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseBeginInvokeSessionBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.beginInvokeSession(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleInvokeSyscall(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseInvokeSyscallBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.invokeSyscall(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleInvokeFinish(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseInvokeFinishBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.finishInvokeSession(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleInvokeAbort(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseInvokeAbortBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.abortInvokeSession(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleInvokeAbortStale(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseInvokeAbortStaleBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.abortStaleInvokeSessions(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleInvokeSessionMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseInvokeSessionMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.runInvokeSessionMaintenance(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryRerunMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
  config: FlarexLiveQueryRerunConfig | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  if (config === undefined) {
    set.status = 501;
    return {
      error: "not_implemented",
      message: "Live query rerun maintenance is not configured.",
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryRerunMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    const result = await executor.rerunStaleLiveQuerySubscriptions({
      deploymentId: input.value.deploymentId,
      ...(input.value.limit === undefined ? {} : { limit: input.value.limit }),
      freshnessStore: config.freshnessStore,
      ...(config.deliverChanges === undefined
        ? {}
        : { deliverChanges: config.deliverChanges }),
      runQuery: (subscription) =>
        executor.runLiveQuerySubscriptionWithInvoke({
          subscription,
          projectId: input.value.projectId,
          executeQuery: config.executeQuery,
        }),
    });
    if (result.changed.length > 0) {
      await config.notifyDelivery?.({
        deploymentId: input.value.deploymentId,
        ...(input.value.limit === undefined ? {} : { limit: input.value.limit }),
      });
    }
    return result;
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryDeliveryMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
  config: FlarexLiveQueryDeliveryConfig | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  if (config === undefined) {
    set.status = 501;
    return {
      error: "not_implemented",
      message: "Live query delivery maintenance is not configured.",
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryDeliveryMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.runLiveQueryDeliveryBatch({
      deploymentId: input.value.deploymentId,
      ...(input.value.limit === undefined ? {} : { limit: input.value.limit }),
      deliver: config.deliver,
    });
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQuerySubscriptionRecord(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQuerySubscriptionRecordBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.recordLiveQuerySubscription(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryConnectionTouch(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryConnectionTouchBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.touchLiveQueryConnection(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQuerySubscriptionRemove(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQuerySubscriptionRemoveBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.removeLiveQuerySubscription(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQuerySubscriptionRemoveConnection(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQuerySubscriptionRemoveConnectionBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.removeLiveQuerySubscriptionsForConnection(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryConnectionCleanup(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryConnectionCleanupBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.removeExpiredLiveQuerySubscriptions(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryClaimMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryClaimMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.claimLiveQueryDeliveryBatch(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryAckMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryAckMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.ackLiveQueryDeliveries(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryFailureMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryFailureMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.recordLiveQueryDeliveryFailure(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryDeadLetterMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryDeadLetterMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.markLiveQueryDeliveriesDeadLettered(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryDeadLetterStuckMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryDeadLetterStuckMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.deadLetterStuckLiveQueryDeliveries(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryPendingDeploymentsMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryPendingDeploymentsMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.listPendingLiveQueryDeliveryDeployments(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryExpiredConnectionDeploymentsMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryExpiredConnectionDeploymentsMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.listExpiredLiveQueryConnectionDeployments(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

async function handleLiveQueryStuckDeliveriesMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: { status?: number | string },
  capabilityToken: string | undefined,
): Promise<object> {
  const unauthorized = authorizeExecutorRequest(request, capabilityToken, set);
  if (unauthorized !== null) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    set.status = 400;
    return {
      error: "bad_request",
      message: "Request body must be valid JSON.",
    };
  }

  const input = parseLiveQueryStuckDeliveriesMaintenanceBody(body);
  if ("error" in input) {
    set.status = 400;
    return input.error;
  }

  try {
    return await executor.listStuckLiveQueryDeliveries(input.value);
  } catch (error) {
    const response = executorErrorBody(error);
    set.status = response.status;
    return response.body;
  }
}

function authorizeExecutorRequest(
  request: Request,
  capabilityToken: string | undefined,
  set: { status?: number | string },
): { error: "unauthorized"; message: string } | null {
  if (capabilityToken === undefined) return null;
  const expected = `Bearer ${capabilityToken}`;
  if (request.headers.get("authorization") === expected) return null;
  set.status = 401;
  return {
    error: "unauthorized",
    message: "Unauthorized Flarex executor request.",
  };
}

function parsePrepareInvokeBody(
  body: unknown,
):
  | { value: PrepareInvokeInput }
  | { error: { error: "bad_request"; message: string } } {
  return parseInvokeBody(body, { includeIdempotencyKey: false });
}

function parseBeginInvokeSessionBody(
  body: unknown,
):
  | { value: BeginInvokeSessionInput }
  | { error: { error: "bad_request"; message: string } } {
  return parseInvokeBody(body, { includeIdempotencyKey: true });
}

function parseInvokeBody(
  body: unknown,
  options: { includeIdempotencyKey: false },
):
  | { value: PrepareInvokeInput }
  | { error: { error: "bad_request"; message: string } };
function parseInvokeBody(
  body: unknown,
  options: { includeIdempotencyKey: true },
):
  | { value: BeginInvokeSessionInput }
  | { error: { error: "bad_request"; message: string } };
function parseInvokeBody(
  body: unknown,
  options: { includeIdempotencyKey: boolean },
):
  | {
      value: BeginInvokeSessionInput;
    }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const path = requiredString(record, "path");
  if ("error" in path) return path;
  const kind = optionalInvokableKind(record.kind);
  if ("error" in kind) return kind;
  const visibility = optionalFunctionVisibility(record.visibility);
  if ("error" in visibility) return visibility;
  const args = jsonValue(record.args, "args");
  if ("error" in args) return args;
  const partitionKey = optionalString(record.partitionKey, "partitionKey");
  if ("error" in partitionKey) return partitionKey;
  const idempotencyKey = optionalString(record.idempotencyKey, "idempotencyKey");
  if ("error" in idempotencyKey) return idempotencyKey;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      path: path.value,
      ...(kind.value === undefined ? {} : { kind: kind.value }),
      ...(visibility.value === undefined ? {} : { visibility: visibility.value }),
      args: args.value,
      ...(partitionKey.value === undefined
        ? {}
        : { partitionKey: partitionKey.value }),
      ...(options.includeIdempotencyKey && idempotencyKey.value !== undefined
        ? { idempotencyKey: idempotencyKey.value }
        : {}),
    },
  };
}

function parseInvokeSyscallBody(
  body: unknown,
):
  | { value: InvokeSyscallInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const sessionId = requiredString(record, "sessionId");
  if ("error" in sessionId) return sessionId;
  const syscall = parseSyscallRequest(record);
  if ("error" in syscall) return syscall;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      sessionId: sessionId.value,
      syscall: syscall.value,
    },
  };
}

function parseInvokeFinishBody(
  body: unknown,
):
  | { value: FinishInvokeSessionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const sessionId = requiredString(record, "sessionId");
  if ("error" in sessionId) return sessionId;
  const value = jsonValue(record.value, "value");
  if ("error" in value) return value;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      sessionId: sessionId.value,
      value: value.value,
    },
  };
}

function parseInvokeAbortBody(
  body: unknown,
):
  | { value: AbortInvokeSessionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const sessionId = requiredString(record, "sessionId");
  if ("error" in sessionId) return sessionId;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      sessionId: sessionId.value,
    },
  };
}

function parseInvokeAbortStaleBody(
  body: unknown,
):
  | { value: AbortStaleInvokeSessionsInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const olderThan = requiredDate(record, "olderThan");
  if ("error" in olderThan) return olderThan;
  const maxSessions = optionalPositiveInteger(record, "maxSessions");
  if ("error" in maxSessions) return maxSessions;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      olderThan: olderThan.value,
      ...(maxSessions.value === undefined
        ? {}
        : { limit: maxSessions.value }),
    },
  };
}

function parseInvokeSessionMaintenanceBody(
  body: unknown,
):
  | { value: RunInvokeSessionMaintenanceInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const staleAfterMs = requiredPositiveInteger(record, "staleAfterMs");
  if ("error" in staleAfterMs) return staleAfterMs;
  const maxSessions = optionalPositiveInteger(record, "maxSessions");
  if ("error" in maxSessions) return maxSessions;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      staleAfterMs: staleAfterMs.value,
      ...(maxSessions.value === undefined
        ? {}
        : { maxSessions: maxSessions.value }),
    },
  };
}

function parseLiveQueryRerunMaintenanceBody(
  body: unknown,
):
  | { value: { deploymentId: string; projectId: string; limit?: number } }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    },
  };
}

function parseLiveQueryDeliveryMaintenanceBody(
  body: unknown,
):
  | { value: { deploymentId: string; limit?: number } }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;

  return {
    value: {
      deploymentId: deploymentId.value,
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    },
  };
}

function parseLiveQuerySubscriptionRecordBody(
  body: unknown,
):
  | { value: RecordLiveQuerySubscriptionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const connectionId = requiredString(record, "connectionId");
  if ("error" in connectionId) return connectionId;
  const queryId = requiredNonNegativeInteger(record, "queryId");
  if ("error" in queryId) return queryId;
  const functionPath = requiredString(record, "functionPath");
  if ("error" in functionPath) return functionPath;
  const argsJson = jsonValue(record.argsJson, "argsJson");
  if ("error" in argsJson) return argsJson;
  const partitionKey = optionalNullableString(record.partitionKey, "partitionKey");
  if ("error" in partitionKey) return partitionKey;
  const beginTs = requiredNonNegativeInteger(record, "beginTs");
  if ("error" in beginTs) return beginTs;
  const readSet = requiredFreshnessReadSet(record.readSet, "readSet");
  if ("error" in readSet) return readSet;
  const resultJson = jsonValue(record.resultJson, "resultJson");
  if ("error" in resultJson) return resultJson;
  const updatedAt = optionalDate(record.updatedAt, "updatedAt");
  if ("error" in updatedAt) return updatedAt;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      connectionId: connectionId.value,
      queryId: queryId.value,
      functionPath: functionPath.value,
      argsJson: argsJson.value,
      ...(partitionKey.value === undefined
        ? {}
        : { partitionKey: partitionKey.value }),
      beginTs: beginTs.value,
      readSet: readSet.value,
      resultJson: resultJson.value,
      ...(updatedAt.value === undefined ? {} : { updatedAt: updatedAt.value }),
    },
  };
}

function parseLiveQuerySubscriptionRemoveBody(
  body: unknown,
):
  | { value: RemoveLiveQuerySubscriptionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const connectionId = requiredString(record, "connectionId");
  if ("error" in connectionId) return connectionId;
  const queryId = requiredNonNegativeInteger(record, "queryId");
  if ("error" in queryId) return queryId;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      connectionId: connectionId.value,
      queryId: queryId.value,
    },
  };
}

function parseLiveQueryConnectionTouchBody(
  body: unknown,
):
  | { value: TouchLiveQueryConnectionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const connectionId = requiredString(record, "connectionId");
  if ("error" in connectionId) return connectionId;
  const leaseDurationMs = optionalPositiveInteger(record, "leaseDurationMs");
  if ("error" in leaseDurationMs) return leaseDurationMs;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      connectionId: connectionId.value,
      ...(leaseDurationMs.value === undefined
        ? {}
        : { leaseDurationMs: leaseDurationMs.value }),
    },
  };
}

function parseLiveQuerySubscriptionRemoveConnectionBody(
  body: unknown,
):
  | { value: RemoveLiveQuerySubscriptionsForConnectionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const connectionId = requiredString(record, "connectionId");
  if ("error" in connectionId) return connectionId;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      connectionId: connectionId.value,
    },
  };
}

function parseLiveQueryConnectionCleanupBody(
  body: unknown,
):
  | { value: RemoveExpiredLiveQuerySubscriptionsInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const expiredAt = optionalDate(record.expiredAt, "expiredAt");
  if ("error" in expiredAt) return expiredAt;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      ...(expiredAt.value === undefined ? {} : { expiredAt: expiredAt.value }),
    },
  };
}

function parseLiveQueryClaimMaintenanceBody(
  body: unknown,
):
  | { value: ClaimLiveQueryDeliveryBatchInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const leaseDurationMs = optionalPositiveInteger(record, "leaseDurationMs");
  if ("error" in leaseDurationMs) return leaseDurationMs;
  const claimOwner = optionalString(record.claimOwner, "claimOwner");
  if ("error" in claimOwner) return claimOwner;
  const cursor = optionalLiveQueryDeliveryCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      deploymentId: deploymentId.value,
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(leaseDurationMs.value === undefined
        ? {}
        : { leaseDurationMs: leaseDurationMs.value }),
      ...(claimOwner.value === undefined ? {} : { claimOwner: claimOwner.value }),
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function parseLiveQueryAckMaintenanceBody(
  body: unknown,
):
  | { value: AckLiveQueryDeliveriesInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const deliveryIds = requiredStringArray(record.deliveryIds, "deliveryIds");
  if ("error" in deliveryIds) return deliveryIds;
  const deliveredAt = optionalDate(record.deliveredAt, "deliveredAt");
  if ("error" in deliveredAt) return deliveredAt;
  const claimOwner = optionalString(record.claimOwner, "claimOwner");
  if ("error" in claimOwner) return claimOwner;

  return {
    value: {
      deploymentId: deploymentId.value,
      deliveryIds: deliveryIds.value,
      ...(deliveredAt.value === undefined ? {} : { deliveredAt: deliveredAt.value }),
      ...(claimOwner.value === undefined ? {} : { claimOwner: claimOwner.value }),
    },
  };
}

function parseLiveQueryFailureMaintenanceBody(
  body: unknown,
):
  | { value: RecordLiveQueryDeliveryFailureInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const deliveryIds = requiredStringArray(record.deliveryIds, "deliveryIds");
  if ("error" in deliveryIds) return deliveryIds;
  const stage = requiredLiveQueryDeliveryFailureStage(record.stage);
  if ("error" in stage) return stage;
  const error = requiredString(record, "error");
  if ("error" in error) return error;
  const failedAt = requiredDate(record, "failedAt");
  if ("error" in failedAt) return failedAt;
  const claimOwner = optionalString(record.claimOwner, "claimOwner");
  if ("error" in claimOwner) return claimOwner;

  return {
    value: {
      deploymentId: deploymentId.value,
      deliveryIds: deliveryIds.value,
      stage: stage.value,
      error: error.value,
      failedAt: failedAt.value,
      ...(claimOwner.value === undefined ? {} : { claimOwner: claimOwner.value }),
    },
  };
}

function parseLiveQueryDeadLetterMaintenanceBody(
  body: unknown,
):
  | { value: MarkLiveQueryDeliveriesDeadLetteredInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const deliveryIds = requiredStringArray(record.deliveryIds, "deliveryIds");
  if ("error" in deliveryIds) return deliveryIds;
  const reason = requiredString(record, "reason");
  if ("error" in reason) return reason;
  const deadLetteredAt = requiredDate(record, "deadLetteredAt");
  if ("error" in deadLetteredAt) return deadLetteredAt;
  const claimOwner = optionalString(record.claimOwner, "claimOwner");
  if ("error" in claimOwner) return claimOwner;

  return {
    value: {
      deploymentId: deploymentId.value,
      deliveryIds: deliveryIds.value,
      reason: reason.value,
      deadLetteredAt: deadLetteredAt.value,
      ...(claimOwner.value === undefined ? {} : { claimOwner: claimOwner.value }),
    },
  };
}

function parseLiveQueryDeadLetterStuckMaintenanceBody(
  body: unknown,
):
  | { value: DeadLetterStuckLiveQueryDeliveriesInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = optionalString(record.deploymentId, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const olderThan = requiredDate(record, "olderThan");
  if ("error" in olderThan) return olderThan;
  const minAttempts = optionalPositiveInteger(record, "minAttempts");
  if ("error" in minAttempts) return minAttempts;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const reason = requiredString(record, "reason");
  if ("error" in reason) return reason;
  const deadLetteredAt = optionalDate(record.deadLetteredAt, "deadLetteredAt");
  if ("error" in deadLetteredAt) return deadLetteredAt;
  const cursor = optionalStuckLiveQueryDeliveryCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      olderThan: olderThan.value,
      reason: reason.value,
      ...(deploymentId.value === undefined
        ? {}
        : { deploymentId: deploymentId.value }),
      ...(minAttempts.value === undefined
        ? {}
        : { minAttempts: minAttempts.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(deadLetteredAt.value === undefined
        ? {}
        : { deadLetteredAt: deadLetteredAt.value }),
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function parseLiveQueryPendingDeploymentsMaintenanceBody(
  body: unknown,
):
  | { value: ListPendingLiveQueryDeliveryDeploymentsInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const cursor = optionalPendingLiveQueryDeliveryDeploymentCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      limit: limit.value ?? 100,
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function parseLiveQueryExpiredConnectionDeploymentsMaintenanceBody(
  body: unknown,
):
  | { value: ListExpiredLiveQueryConnectionDeploymentsInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const expiredAt = optionalDate(record.expiredAt, "expiredAt");
  if ("error" in expiredAt) return expiredAt;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const cursor = optionalExpiredLiveQueryConnectionDeploymentCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      ...(expiredAt.value === undefined ? {} : { expiredAt: expiredAt.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function parseLiveQueryStuckDeliveriesMaintenanceBody(
  body: unknown,
):
  | { value: ListStuckLiveQueryDeliveriesInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = optionalString(record.deploymentId, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const olderThan = requiredDate(record, "olderThan");
  if ("error" in olderThan) return olderThan;
  const minAttempts = optionalPositiveInteger(record, "minAttempts");
  if ("error" in minAttempts) return minAttempts;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const cursor = optionalStuckLiveQueryDeliveryCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      olderThan: olderThan.value,
      limit: limit.value ?? 100,
      ...(deploymentId.value === undefined
        ? {}
        : { deploymentId: deploymentId.value }),
      ...(minAttempts.value === undefined
        ? {}
        : { minAttempts: minAttempts.value }),
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function requiredLiveQueryDeliveryFailureStage(
  value: unknown,
):
  | { value: "fanout" | "ack" }
  | { error: { error: "bad_request"; message: string } } {
  if (value === "fanout" || value === "ack") return { value };
  return {
    error: {
      error: "bad_request",
      message: "stage must be fanout or ack.",
    },
  };
}

function optionalStuckLiveQueryDeliveryCursor(
  value: unknown,
):
  | { value?: { lastAttemptedAt: Date; deploymentId: string; deliveryId: string } }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      error: {
        error: "bad_request",
        message: "cursor must be an object.",
      },
    };
  }
  const record = value as Record<string, unknown>;
  const lastAttemptedAt = optionalDate(
    record.lastAttemptedAt,
    "cursor.lastAttemptedAt",
  );
  if ("error" in lastAttemptedAt) return lastAttemptedAt;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deploymentId must be a non-empty string.",
      },
    };
  }
  const deliveryId = requiredString(record, "deliveryId");
  if ("error" in deliveryId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deliveryId must be a non-empty string.",
      },
    };
  }
  if (lastAttemptedAt.value === undefined) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.lastAttemptedAt must be an ISO timestamp string.",
      },
    };
  }
  return {
    value: {
      lastAttemptedAt: lastAttemptedAt.value,
      deploymentId: deploymentId.value,
      deliveryId: deliveryId.value,
    },
  };
}

function parseSyscallRequest(
  record: Record<string, unknown>,
):
  | { value: InvokeSyscallRequest }
  | { error: { error: "bad_request"; message: string } } {
  if (record.op === "get") {
    const id = requiredString(record, "id");
    if ("error" in id) return id;
    return { value: { op: "get", id: id.value } };
  }
  if (record.op === "query") {
    const request = jsonValue(record.request, "request");
    if ("error" in request) return request;
    return { value: { op: "query", request: request.value } };
  }
  if (record.op === "insert") {
    const table = requiredString(record, "table");
    if ("error" in table) return table;
    const value = jsonValue(record.value, "value");
    if ("error" in value) return value;
    const id = optionalString(record.id, "id");
    if ("error" in id) return id;
    return {
      value: {
        op: "insert",
        table: table.value,
        value: value.value,
        ...(id.value === undefined ? {} : { id: id.value }),
      },
    };
  }
  if (record.op === "patch") {
    const id = requiredString(record, "id");
    if ("error" in id) return id;
    const value = jsonValue(record.value, "value");
    if ("error" in value) return value;
    return { value: { op: "patch", id: id.value, value: value.value } };
  }
  if (record.op === "replace") {
    const id = requiredString(record, "id");
    if ("error" in id) return id;
    const value = jsonValue(record.value, "value");
    if ("error" in value) return value;
    return { value: { op: "replace", id: id.value, value: value.value } };
  }
  if (record.op === "delete") {
    const id = requiredString(record, "id");
    if ("error" in id) return id;
    return { value: { op: "delete", id: id.value } };
  }
  return {
    error: {
      error: "bad_request",
      message: "op must be get, query, insert, patch, replace, or delete.",
    },
  };
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
): { value: string } | { error: { error: "bad_request"; message: string } } {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a non-empty string.`,
      },
    };
  }
  return { value };
}

function optionalInvokableKind(
  value: unknown,
):
  | { value?: InvokableFunctionKind }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (value === "query" || value === "mutation") return { value };
  return {
    error: {
      error: "bad_request",
      message: "kind must be query or mutation.",
    },
  };
}

function optionalFunctionVisibility(
  value: unknown,
):
  | { value?: FunctionVisibility }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (value === "public" || value === "internal") return { value };
  return {
    error: {
      error: "bad_request",
      message: "visibility must be public or internal.",
    },
  };
}

function optionalString(
  value: unknown,
  field: string,
): { value?: string } | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value === "string" && value.length > 0) return { value };
  return {
    error: {
      error: "bad_request",
      message: `${field} must be a non-empty string.`,
    },
  };
}

function optionalNullableString(
  value: unknown,
  field: string,
):
  | { value?: string | null }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (value === null) return { value: null };
  if (typeof value === "string" && value.length > 0) return { value };
  return {
    error: {
      error: "bad_request",
      message: `${field} must be a non-empty string or null.`,
    },
  };
}

function requiredDate(
  record: Record<string, unknown>,
  field: string,
): { value: Date } | { error: { error: "bad_request"; message: string } } {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be an ISO timestamp string.`,
      },
    };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be an ISO timestamp string.`,
      },
    };
  }
  return { value: date };
}

function optionalDate(
  value: unknown,
  field: string,
): { value?: Date } | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "string" || value.length === 0) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be an ISO timestamp string.`,
      },
    };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be an ISO timestamp string.`,
      },
    };
  }
  return { value: date };
}

function requiredStringArray(
  value: unknown,
  field: string,
): { value: string[] } | { error: { error: "bad_request"; message: string } } {
  if (
    Array.isArray(value) &&
    value.every(item => typeof item === "string" && item.length > 0)
  ) {
    return { value };
  }
  return {
    error: {
      error: "bad_request",
      message: `${field} must be an array of non-empty strings.`,
    },
  };
}

function optionalLiveQueryDeliveryCursor(
  value: unknown,
):
  | { value?: { createdAt: Date; deliveryId: string } }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      error: {
        error: "bad_request",
        message: "cursor must be an object.",
      },
    };
  }
  const record = value as Record<string, unknown>;
  const createdAt = optionalDate(record.createdAt, "cursor.createdAt");
  if ("error" in createdAt) return createdAt;
  const deliveryId = requiredString(record, "deliveryId");
  if ("error" in deliveryId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deliveryId must be a non-empty string.",
      },
    };
  }
  if (createdAt.value === undefined) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.createdAt must be an ISO timestamp string.",
      },
    };
  }
  return {
    value: {
      createdAt: createdAt.value,
      deliveryId: deliveryId.value,
    },
  };
}

function optionalPendingLiveQueryDeliveryDeploymentCursor(
  value: unknown,
):
  | { value?: { oldestCreatedAt: Date; deploymentId: string } }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      error: {
        error: "bad_request",
        message: "cursor must be an object.",
      },
    };
  }
  const record = value as Record<string, unknown>;
  const oldestCreatedAt = optionalDate(
    record.oldestCreatedAt,
    "cursor.oldestCreatedAt",
  );
  if ("error" in oldestCreatedAt) return oldestCreatedAt;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deploymentId must be a non-empty string.",
      },
    };
  }
  if (oldestCreatedAt.value === undefined) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.oldestCreatedAt must be an ISO timestamp string.",
      },
    };
  }
  return {
    value: {
      oldestCreatedAt: oldestCreatedAt.value,
      deploymentId: deploymentId.value,
    },
  };
}

function optionalExpiredLiveQueryConnectionDeploymentCursor(
  value: unknown,
):
  | { value?: NonNullable<ListExpiredLiveQueryConnectionDeploymentsInput["cursor"]> }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      error: {
        error: "bad_request",
        message: "cursor must be an object.",
      },
    };
  }
  const record = value as Record<string, unknown>;
  const oldestExpiredAt = optionalDate(
    record.oldestExpiredAt,
    "cursor.oldestExpiredAt",
  );
  if ("error" in oldestExpiredAt) return oldestExpiredAt;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deploymentId must be a non-empty string.",
      },
    };
  }
  if (oldestExpiredAt.value === undefined) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.oldestExpiredAt must be an ISO timestamp string.",
      },
    };
  }
  return {
    value: {
      oldestExpiredAt: oldestExpiredAt.value,
      deploymentId: deploymentId.value,
    },
  };
}

function requiredPositiveInteger(
  record: Record<string, unknown>,
  field: string,
): { value: number } | { error: { error: "bad_request"; message: string } } {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a positive integer.`,
      },
    };
  }
  return { value };
}

function requiredNonNegativeInteger(
  record: Record<string, unknown>,
  field: string,
): { value: number } | { error: { error: "bad_request"; message: string } } {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a non-negative integer.`,
      },
    };
  }
  return { value };
}

function optionalPositiveInteger(
  record: Record<string, unknown>,
  field: string,
):
  | { value?: number }
  | { error: { error: "bad_request"; message: string } } {
  if (record[field] === undefined) return {};
  return requiredPositiveInteger(record, field);
}

function jsonValue(
  value: unknown,
  field: string,
): { value: Json } | { error: { error: "bad_request"; message: string } } {
  if (!isJson(value)) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a JSON value.`,
      },
    };
  }
  return { value };
}

function requiredJsonObject(
  value: unknown,
  field: string,
):
  | { value: Record<string, Json> }
  | { error: { error: "bad_request"; message: string } } {
  const parsed = jsonValue(value, field);
  if ("error" in parsed) return parsed;
  if (
    parsed.value === null ||
    typeof parsed.value !== "object" ||
    Array.isArray(parsed.value)
  ) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a JSON object.`,
      },
    };
  }
  return { value: parsed.value };
}

function requiredFreshnessReadSet(
  value: unknown,
  field: string,
):
  | { value: RecordLiveQuerySubscriptionInput["readSet"] }
  | { error: { error: "bad_request"; message: string } } {
  const parsed = requiredJsonObject(value, field);
  if ("error" in parsed) return parsed;
  const documents = optionalDocumentReadSet(parsed.value.documents, `${field}.documents`);
  if ("error" in documents) return documents;
  const tables = optionalTableReadSet(parsed.value.tables, `${field}.tables`);
  if ("error" in tables) return tables;
  const indexes = optionalIndexReadSet(parsed.value.indexes, `${field}.indexes`);
  if ("error" in indexes) return indexes;
  return {
    value: {
      ...(documents.value === undefined ? {} : { documents: documents.value }),
      ...(tables.value === undefined ? {} : { tables: tables.value }),
      ...(indexes.value === undefined ? {} : { indexes: indexes.value }),
    },
  };
}

function optionalDocumentReadSet(
  value: unknown,
  field: string,
):
  | { value?: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["documents"]> }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return badRequest(`${field} must be an array.`);
  const documents: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["documents"]> = [];
  for (const [index, item] of value.entries()) {
    const record = itemRecord(item, `${field}[${index}]`);
    if ("error" in record) return record;
    const tableId = requiredNonNegativeInteger(record.value, "tableId");
    if ("error" in tableId) return prefixBadRequest(tableId, `${field}[${index}].`);
    const id = requiredString(record.value, "id");
    if ("error" in id) return prefixBadRequest(id, `${field}[${index}].`);
    const observedTs = optionalObservedTs(record.value.observedTs, `${field}[${index}].observedTs`);
    if ("error" in observedTs) return observedTs;
    documents.push({
      tableId: tableId.value,
      id: id.value,
      ...(observedTs.value === undefined ? {} : { observedTs: observedTs.value }),
    });
  }
  return { value: documents };
}

function optionalTableReadSet(
  value: unknown,
  field: string,
):
  | { value?: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["tables"]> }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return badRequest(`${field} must be an array.`);
  const tables: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["tables"]> = [];
  for (const [index, item] of value.entries()) {
    const record = itemRecord(item, `${field}[${index}]`);
    if ("error" in record) return record;
    const tableId = requiredNonNegativeInteger(record.value, "tableId");
    if ("error" in tableId) return prefixBadRequest(tableId, `${field}[${index}].`);
    const observedTs = optionalNonNegativeInteger(
      record.value.observedTs,
      `${field}[${index}].observedTs`,
    );
    if ("error" in observedTs) return observedTs;
    tables.push({
      tableId: tableId.value,
      ...(observedTs.value === undefined ? {} : { observedTs: observedTs.value }),
    });
  }
  return { value: tables };
}

function optionalIndexReadSet(
  value: unknown,
  field: string,
):
  | { value?: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["indexes"]> }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return badRequest(`${field} must be an array.`);
  const indexes: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["indexes"]> = [];
  for (const [index, item] of value.entries()) {
    const record = itemRecord(item, `${field}[${index}]`);
    if ("error" in record) return record;
    const indexId = requiredNonNegativeInteger(record.value, "indexId");
    if ("error" in indexId) return prefixBadRequest(indexId, `${field}[${index}].`);
    const observedTs = optionalNonNegativeInteger(
      record.value.observedTs,
      `${field}[${index}].observedTs`,
    );
    if ("error" in observedTs) return observedTs;
    const lower = optionalString(record.value.lower, `${field}[${index}].lower`);
    if ("error" in lower) return lower;
    const upper = optionalString(record.value.upper, `${field}[${index}].upper`);
    if ("error" in upper) return upper;
    indexes.push({
      indexId: indexId.value,
      ...(observedTs.value === undefined ? {} : { observedTs: observedTs.value }),
      ...(lower.value === undefined ? {} : { lower: lower.value }),
      ...(upper.value === undefined ? {} : { upper: upper.value }),
    });
  }
  return { value: indexes };
}

function itemRecord(
  value: unknown,
  field: string,
):
  | { value: Record<string, unknown> }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { value: value as Record<string, unknown> };
  }
  return badRequest(`${field} must be an object.`);
}

function optionalObservedTs(
  value: unknown,
  field: string,
):
  | { value?: number | null }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (value === null) return { value: null };
  return optionalNonNegativeInteger(value, field);
}

function optionalNonNegativeInteger(
  value: unknown,
  field: string,
):
  | { value?: number }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return badRequest(`${field} must be a non-negative integer.`);
  }
  return { value };
}

function badRequest(message: string): { error: { error: "bad_request"; message: string } } {
  return { error: { error: "bad_request", message } };
}

function prefixBadRequest(
  result: { error: { error: "bad_request"; message: string } },
  prefix: string,
): { error: { error: "bad_request"; message: string } } {
  return badRequest(`${prefix}${result.error.message}`);
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return Number.isFinite(value as number) || typeof value !== "number";
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJson);
  }
  return false;
}

function executorErrorBody(error: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  if (
    error instanceof DeploymentNotFoundError ||
    error instanceof DeploymentPackageNotFoundError ||
    error instanceof InvokeSessionNotFoundError ||
    error instanceof InvokeDeleteDocumentNotFoundError ||
    error instanceof InvokePatchDocumentNotFoundError ||
    error instanceof FunctionNotFoundError
  ) {
    return knownErrorBody(error, 404);
  }
  if (
    error instanceof DeploymentProjectMismatchError ||
    error instanceof InvokeSessionProjectMismatchError
  ) {
    return knownErrorBody(error, 403);
  }
  if (
    error instanceof FunctionKindMismatchError ||
    error instanceof FunctionVisibilityMismatchError ||
    error instanceof FunctionNotInvokableError ||
    error instanceof FlarexDocumentIdFormatError ||
    error instanceof FlarexInsertIdTableMismatchError ||
    error instanceof InvokePatchNonObjectDocumentError ||
    error instanceof InvokePatchValueError ||
    error instanceof InvokeQueryRequestError ||
    error instanceof InvokeSessionDocumentValidationError ||
    error instanceof InvokeSessionDocumentWriteAlreadyExistsError ||
    error instanceof InvokeSyscallNotAllowedError ||
    error instanceof LiveQueryDeliveryPolicyError ||
    error instanceof LiveQuerySubscriptionRerunError ||
    error instanceof MaintenancePolicyError ||
    error instanceof PartitionValidationError
  ) {
    return knownErrorBody(error, 400);
  }
  if (
    error instanceof DeploymentPackageNotActivatedError ||
    error instanceof DeploymentFunctionMetadataUnavailableError ||
    error instanceof DeploymentSchemaMetadataUnavailableError ||
    error instanceof DeploymentValidatorMetadataError ||
    error instanceof InvokeSessionDeleteTargetError ||
    error instanceof InvokeSessionInsertConflictError ||
    error instanceof InvokeSessionIndexOccConflictError ||
    error instanceof InvokeSessionOccConflictError ||
    error instanceof InvokeSessionPatchTargetError ||
    error instanceof InvokeSessionTableOccConflictError ||
    error instanceof InvokeSessionNotActiveError
  ) {
    return knownErrorBody(error, 409);
  }
  if (
    error instanceof InvokeFinishNotImplementedError ||
    error instanceof InvokeSessionUnsupportedStagedWriteError ||
    error instanceof InvokeSyscallNotImplementedError
  ) {
    return knownErrorBody(error, 501);
  }

  return {
    status: 500,
    body: {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function knownErrorBody(error: Error, status: number): {
  status: number;
  body: Record<string, unknown>;
} {
  return {
    status,
    body: {
      error: error.name,
      message: error.message,
    },
  };
}

function normalizePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}
