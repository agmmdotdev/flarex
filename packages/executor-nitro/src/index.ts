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
  type FlarexExecutor,
  type InvokableFunctionKind,
} from "@flarex/executor";

export interface FlarexNitroEventLike {
  request: Request;
}

export interface FlarexNitroAdapterConfig {
  executor: FlarexExecutor;
  healthPath?: string;
  invokePreparePath?: string;
}

export function createFlarexNitroHandler(
  config: FlarexNitroAdapterConfig,
): (event: FlarexNitroEventLike) => Promise<Response> {
  const executor = config.executor;
  const healthPath = normalizePath(config.healthPath ?? "/health");
  const invokePreparePath = normalizePath(
    config.invokePreparePath ?? "/invoke/prepare",
  );

  return async (event) => {
    const url = new URL(event.request.url);
    const pathname = normalizePath(url.pathname);

    if (
      event.request.method === "GET" &&
      pathname === healthPath
    ) {
      return jsonResponse(await executor.health());
    }

    if (pathname === invokePreparePath) {
      if (event.request.method !== "POST") {
        return jsonResponse(
          {
            error: "method_not_allowed",
            message: `${invokePreparePath} only supports POST`,
          },
          { status: 405 },
        );
      }

      return handleInvokePrepare(executor, event.request);
    }

    return jsonResponse(
      {
        error: "not_found",
        message: `No Flarex executor adapter route for ${event.request.method} ${url.pathname}`,
      },
      { status: 404 },
    );
  };
}

async function handleInvokePrepare(
  executor: FlarexExecutor,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        error: "bad_request",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const input = parsePrepareInvokeBody(body);
  if ("error" in input) {
    return jsonResponse(input.error, { status: 400 });
  }

  try {
    const prepared = await executor.prepareInvoke(input.value);
    return jsonResponse({
      deploymentId: prepared.deployment.deploymentId,
      packageId: prepared.package.packageId,
      path: prepared.function.path,
      kind: prepared.function.kind,
      schemaVersion: prepared.schema.version,
      executionModule: prepared.executionModule,
    });
  } catch (error) {
    return executorErrorResponse(error);
  }
}

function parsePrepareInvokeBody(
  body: unknown,
):
  | {
      value: {
        deploymentId: string;
        projectId: string;
        path: string;
        kind?: InvokableFunctionKind;
      };
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

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      path: path.value,
      ...(kind.value === undefined ? {} : { kind: kind.value }),
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

function executorErrorResponse(error: unknown): Response {
  if (
    error instanceof DeploymentNotFoundError ||
    error instanceof DeploymentPackageNotFoundError ||
    error instanceof FunctionNotFoundError
  ) {
    return knownErrorResponse(error, 404);
  }
  if (error instanceof DeploymentProjectMismatchError) {
    return knownErrorResponse(error, 403);
  }
  if (
    error instanceof FunctionKindMismatchError ||
    error instanceof FunctionNotInvokableError
  ) {
    return knownErrorResponse(error, 400);
  }
  if (
    error instanceof DeploymentPackageNotActivatedError ||
    error instanceof DeploymentFunctionMetadataUnavailableError ||
    error instanceof DeploymentSchemaMetadataUnavailableError
  ) {
    return knownErrorResponse(error, 409);
  }

  return jsonResponse(
    {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function knownErrorResponse(error: Error, status: number): Response {
  return jsonResponse(
    {
      error: error.name,
      message: error.message,
    },
    { status },
  );
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function normalizePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}
