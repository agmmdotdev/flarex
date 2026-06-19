import { Elysia } from "elysia";
import {
  DeploymentFunctionMetadataUnavailableError,
  DeploymentNotFoundError,
  DeploymentPackageNotActivatedError,
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
  DeploymentSchemaMetadataUnavailableError,
  FunctionKindMismatchError,
  FunctionNotFoundError,
  FunctionNotInvokableError,
  PartitionValidationError,
  type BeginInvokeSessionInput,
  type FlarexExecutor,
  type InvokableFunctionKind,
  type Json,
  type PrepareInvokeInput,
} from "@flarex/executor";

export interface FlarexHttpAppConfig {
  executor: FlarexExecutor;
  healthPath?: string;
  invokePreparePath?: string;
  invokeStartPath?: string;
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

  return new Elysia()
    .get(healthPath, () => executor.health())
    .post(invokePreparePath, ({ request, set }) =>
      handleInvokePrepare(executor, request, set),
    )
    .post(invokeStartPath, ({ request, set }) =>
      handleInvokeStart(executor, request, set),
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
    error instanceof FunctionNotFoundError
  ) {
    return knownErrorBody(error, 404);
  }
  if (error instanceof DeploymentProjectMismatchError) {
    return knownErrorBody(error, 403);
  }
  if (
    error instanceof FunctionKindMismatchError ||
    error instanceof FunctionNotInvokableError ||
    error instanceof PartitionValidationError
  ) {
    return knownErrorBody(error, 400);
  }
  if (
    error instanceof DeploymentPackageNotActivatedError ||
    error instanceof DeploymentFunctionMetadataUnavailableError ||
    error instanceof DeploymentSchemaMetadataUnavailableError
  ) {
    return knownErrorBody(error, 409);
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
