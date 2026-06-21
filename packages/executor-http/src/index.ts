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
  type FinishInvokeSessionInput,
  type FlarexExecutor,
  type InvokableFunctionKind,
  type InvokeSyscallInput,
  type InvokeSyscallRequest,
  type Json,
  type PrepareInvokeInput,
  type RunInvokeSessionMaintenanceInput,
  type RerunStaleLiveQuerySubscriptionsInput,
  type RunLiveQueryDeliveryBatchInput,
  type RunLiveQuerySubscriptionWithInvokeInput,
} from "@flarex/executor";

export {
  createFlarexBackendLiveQueryDelivery,
  createFlarexBackendLiveQueryWakeNotifier,
  type FlarexBackendLiveQueryDeliveryConfig,
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
  maintenanceLiveQueryClaimPath?: string;
  maintenanceLiveQueryAckPath?: string;
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
  const maintenanceLiveQueryClaimPath = normalizePath(
    config.maintenanceLiveQueryClaimPath ??
      "/maintenance/live-queries/claim",
  );
  const maintenanceLiveQueryAckPath = normalizePath(
    config.maintenanceLiveQueryAckPath ?? "/maintenance/live-queries/ack",
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
    .post(maintenanceLiveQueryClaimPath, ({ request, set }) =>
      handleLiveQueryClaimMaintenance(executor, request, set, capabilityToken),
    )
    .post(maintenanceLiveQueryAckPath, ({ request, set }) =>
      handleLiveQueryAckMaintenance(executor, request, set, capabilityToken),
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
  const cursor = optionalLiveQueryDeliveryCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      deploymentId: deploymentId.value,
      ...(limit.value === undefined ? {} : { limit: limit.value }),
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

  return {
    value: {
      deploymentId: deploymentId.value,
      deliveryIds: deliveryIds.value,
      ...(deliveredAt.value === undefined ? {} : { deliveredAt: deliveredAt.value }),
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
  if (record.op === "delete") {
    const id = requiredString(record, "id");
    if ("error" in id) return id;
    return { value: { op: "delete", id: id.value } };
  }
  return {
    error: {
      error: "bad_request",
      message: "op must be get, query, insert, patch, or delete.",
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
