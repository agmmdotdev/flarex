import { Miniflare } from "miniflare";
import { Data, Effect } from "effect";
import type { RunLiveQuerySubscriptionWithInvokeInput } from "@flarex/executor";
import {
  decodeMaterializedExecutionArtifactInvokeResponse,
  executionArtifactInternalInvokeRequest,
  executionArtifactInternalRequestHeaders,
  executionArtifactRuntimeWorkerSource,
  executionArtifactWorkerEnv,
  executionArtifactWorkerModules,
} from "flarex-backend/artifact-runtime";
import type {
  ExecutionArtifactQuerySessionRequest,
  ExecutionArtifactMaterializer,
  MaterializedExecutionArtifactPayload,
  MaterializedExecutionArtifact,
  MaterializedExecutionArtifactInvokeResponseError,
  ExecutionArtifactWorkerExecutorTransport,
} from "flarex-backend/artifact-runtime";
import type { InvokeResponse, Json } from "flarex-backend/types";
import { readDevResponseJsonOrNullEffect } from "./responseJson.ts";

export type RuntimeBackendDispatcher = (request: Request) => Response | Promise<Response>;

export type LocalMiniflareExecutionArtifactMaterializerOptions = {
  backend: RuntimeBackendDispatcher;
  executorTransport?: ExecutionArtifactWorkerExecutorTransport;
  projectId?: string;
  executorToken?: string;
  invokeMaxAttempts?: number;
  internalToken?: string;
  compatibilityDate?: string;
};

export type MaterializedArtifactLiveQueryExecutionHostOptions = {
  artifact: MaterializedExecutionArtifact;
  payload: MaterializedExecutionArtifactPayload;
  projectId?: string;
};

export class MaterializedArtifactResponseError extends Data.TaggedError("MaterializedArtifactResponseError")<{
  readonly status: number;
  readonly message: string;
  readonly body: unknown;
}> {}

export type MaterializedArtifactHttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
};

export function createMaterializedArtifactLiveQueryExecutionHost(
  options: MaterializedArtifactLiveQueryExecutionHostOptions,
): RunLiveQuerySubscriptionWithInvokeInput["executeQuery"] {
  return async (attempt, subscription) => {
    if (options.artifact.executeQuerySession === undefined) {
      throw new Error(
        "Materialized execution artifact does not support query-session execution.",
      );
    }
    return await options.artifact.executeQuerySession(options.payload, {
      deploymentId: subscription.deploymentId,
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      path: subscription.functionPath,
      args: subscription.argsJson as Json,
      ...(subscription.partitionKey === null ? {} : { partitionKey: subscription.partitionKey }),
      sessionId: attempt.session.sessionId,
    });
  };
}

export class LocalMiniflareExecutionArtifactMaterializer implements ExecutionArtifactMaterializer {
  private readonly backend: RuntimeBackendDispatcher;
  private readonly executorTransport: ExecutionArtifactWorkerExecutorTransport | undefined;
  private readonly projectId: string | undefined;
  private readonly executorToken: string | undefined;
  private readonly invokeMaxAttempts: number | undefined;
  private readonly internalToken: string | undefined;
  private readonly compatibilityDate: string;

  constructor(options: LocalMiniflareExecutionArtifactMaterializerOptions) {
    this.backend = options.backend;
    this.executorTransport = options.executorTransport;
    this.projectId = options.projectId;
    this.executorToken = options.executorToken;
    this.invokeMaxAttempts = options.invokeMaxAttempts;
    this.internalToken = options.internalToken;
    this.compatibilityDate = options.compatibilityDate ?? "2026-06-14";
  }

  async materialize(
    payload: MaterializedExecutionArtifactPayload,
  ): Promise<MaterializedExecutionArtifact> {
    const modules = executionArtifactWorkerModules({
      sourcePackage: payload.sourcePackage,
      runtimeModulePath: LOCAL_RUNTIME_WORKER_MODULE,
      runtimeWorkerSource: runtimeWorkerSource(payload.sourcePackage.execution),
      reservedBy: "local execution artifact runtime",
    });
    const artifact = new Miniflare({
      modules: Object.entries(modules).map(([path, contents]) => ({
        type: "ESModule" as const,
        path,
        contents,
      })),
      compatibilityDate: this.compatibilityDate,
      bindings: executionArtifactWorkerEnv({
        executorTransport: this.executorTransport,
        projectId: this.projectId,
        executorToken: this.executorToken,
        invokeMaxAttempts: this.invokeMaxAttempts,
        internalToken: this.internalToken,
      }),
      serviceBindings: {
        FLAREX_BACKEND: async (request: Request) => this.backend(request),
      },
    });
    return new LocalMiniflareMaterializedExecutionArtifact(artifact, this.internalToken);
  }
}

class LocalMiniflareMaterializedExecutionArtifact implements MaterializedExecutionArtifact {
  private readonly artifact: Miniflare;
  private readonly internalToken: string | undefined;

  constructor(artifact: Miniflare, internalToken: string | undefined) {
    this.artifact = artifact;
    this.internalToken = internalToken;
  }

  async invoke(payload: MaterializedExecutionArtifactPayload): Promise<InvokeResponse> {
    const request = executionArtifactInternalInvokeRequest({
      url: "https://flarex-artifact.internal/__flarex_internal/invoke",
      payload,
      internalToken: this.internalToken,
    });
    const response = await this.artifact.dispatchFetch(
      request.url,
      {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.text(),
      },
    );
    // Deliberate runtime bridge: materialized worker invoke API returns Promise.
    return await Effect.runPromise(
      decodeMaterializedExecutionArtifactInvokeResponse(
        response,
        "Materialized execution artifact failed",
      ).pipe(
        Effect.mapError(materializedArtifactInvokeResponseErrorToError),
      ),
    );
  }

  async executeQuerySession(
    payload: MaterializedExecutionArtifactPayload,
    input: ExecutionArtifactQuerySessionRequest,
  ): Promise<Json> {
    const response = await this.artifact.dispatchFetch(
      "https://flarex-artifact.internal/__flarex_internal/query-session",
      {
        method: "POST",
        headers: executionArtifactInternalRequestHeaders({
          ref: payload.ref,
          internalToken: this.internalToken,
        }),
        body: JSON.stringify(input),
      },
    );
    // Deliberate runtime bridge: materialized worker query API returns Promise.
    return await Effect.runPromise(
      decodeMaterializedArtifactResponse<Json>(
        response,
        "Materialized execution artifact failed",
      ).pipe(
        Effect.mapError(materializedArtifactResponseErrorToError),
      ),
    );
  }

  async dispose(): Promise<void> {
    await this.artifact.dispose();
  }
}

export const decodeMaterializedArtifactResponse = Effect.fn(
  "LocalMiniflareMaterializedExecutionArtifact.decodeResponse",
)(
  function* <A>(response: MaterializedArtifactHttpResponse, fallbackMessage: string) {
    const body = yield* readMaterializedArtifactResponseJson(response);
    if (!response.ok) {
      return yield* Effect.fail(new MaterializedArtifactResponseError({
        status: response.status,
        message: materializedArtifactErrorMessage(body, fallbackMessage, response.status),
        body,
      }));
    }
    return body as A;
  },
);

function readMaterializedArtifactResponseJson(
  response: MaterializedArtifactHttpResponse,
): Effect.Effect<unknown> {
  return readDevResponseJsonOrNullEffect(response);
}

function materializedArtifactErrorMessage(
  body: unknown,
  fallbackMessage: string,
  status: number,
): string {
  return typeof body === "object" && body !== null && "error" in body
    ? String((body as { error: unknown }).error)
    : `${fallbackMessage} with status ${status}`;
}

function materializedArtifactResponseErrorToError(
  error: MaterializedArtifactResponseError,
): Error & { status?: number } {
  const legacy = new Error(error.message) as Error & { status?: number };
  legacy.status = error.status;
  return legacy;
}

function materializedArtifactInvokeResponseErrorToError(
  error: MaterializedExecutionArtifactInvokeResponseError,
): Error & { status?: number } {
  const legacy = new Error(error.message) as Error & { status?: number };
  legacy.status = error.status;
  return legacy;
}

const LOCAL_RUNTIME_WORKER_MODULE = "worker.js";

function runtimeWorkerSource(executionModule: string): string {
  return executionArtifactRuntimeWorkerSource({
    profile: "local-miniflare",
    executionModule,
  });
}
