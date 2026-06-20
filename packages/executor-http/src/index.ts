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
  InvokeSessionOccConflictError,
  InvokeSessionPatchTargetError,
  InvokeSessionTableOccConflictError,
  InvokeSessionUnsupportedStagedWriteError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
  PartitionValidationError,
  InvokeSessionDeleteTargetError,
  type BeginInvokeSessionInput,
  type FinishInvokeSessionInput,
  type FlarexExecutor,
  type InvokableFunctionKind,
  type InvokeSyscallInput,
  type InvokeSyscallRequest,
  type Json,
  type PrepareInvokeInput,
} from "@flarex/executor";

export interface FlarexHttpAppConfig {
  executor: FlarexExecutor;
  healthPath?: string;
  invokePreparePath?: string;
  invokeStartPath?: string;
  invokeSyscallPath?: string;
  invokeFinishPath?: string;
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

  return new Elysia()
    .get(healthPath, () => executor.health())
    .post(invokePreparePath, ({ request, set }) =>
      handleInvokePrepare(executor, request, set),
    )
    .post(invokeStartPath, ({ request, set }) =>
      handleInvokeStart(executor, request, set),
    )
    .post(invokeSyscallPath, ({ request, set }) =>
      handleInvokeSyscall(executor, request, set),
    )
    .post(invokeFinishPath, ({ request, set }) =>
      handleInvokeFinish(executor, request, set),
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
): Promise<Record<string, unknown>> {
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
): Promise<object> {
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
): Promise<object> {
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
): Promise<object> {
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
