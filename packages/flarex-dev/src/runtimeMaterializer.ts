import { Miniflare } from "miniflare";
import { Data, Effect } from "effect";
import type { RunLiveQuerySubscriptionWithInvokeInput } from "@flarex/executor";
import { executionArtifactErrorBodyMessage } from "flarex-protocol/artifact-runtime";
import { isWritableJsonFromUnknown } from "flarex-protocol/json";
import {
  decodeMaterializedExecutionArtifactInvokeResponse,
  executionArtifactInternalInvokeRequest,
  executionArtifactInternalRequestHeaders,
  executionArtifactWorkerDefinition,
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
import {
  readDevResponseJsonEffect,
  readDevResponseJsonOrNullEffect,
} from "./responseJson.ts";

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
      identity: attempt.session.identity,
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
    const definition = executionArtifactWorkerDefinition({
      sourcePackage: payload.sourcePackage,
      profile: "local-miniflare",
      runtimeModulePath: LOCAL_RUNTIME_WORKER_MODULE,
      reservedBy: "local execution artifact runtime",
      env: {
        executorTransport: this.executorTransport,
        projectId: this.projectId,
        executorToken: this.executorToken,
        invokeMaxAttempts: this.invokeMaxAttempts,
        internalToken: this.internalToken,
      },
    });
    const artifact = new Miniflare({
      modules: Object.entries(definition.modules).map(([path, contents]) => ({
        type: "ESModule" as const,
        path,
        contents,
      })),
      compatibilityDate: this.compatibilityDate,
      bindings: definition.env,
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
      decodeMaterializedArtifactResponse(
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
  function* (
    response: MaterializedArtifactHttpResponse,
    fallbackMessage: string,
  ): Effect.fn.Return<Json, MaterializedArtifactResponseError> {
    if (!response.ok) {
      const body = yield* readDevResponseJsonOrNullEffect(response);
      return yield* Effect.fail(new MaterializedArtifactResponseError({
        status: response.status,
        message: materializedArtifactErrorMessage(body, fallbackMessage, response.status),
        body,
      }));
    }
    const body = yield* readMaterializedArtifactResponseJson(
      response,
      fallbackMessage,
    );
    if (!isWritableJsonFromUnknown(body)) {
      return yield* Effect.fail(new MaterializedArtifactResponseError({
        status: 500,
        message: invalidMaterializedArtifactResponseMessage(fallbackMessage),
        body,
      }));
    }
    return body;
  },
);

function readMaterializedArtifactResponseJson(
  response: MaterializedArtifactHttpResponse,
  fallbackMessage: string,
): Effect.Effect<unknown, MaterializedArtifactResponseError> {
  return readDevResponseJsonEffect(response).pipe(
    Effect.mapError(() => new MaterializedArtifactResponseError({
      status: 500,
      message: invalidMaterializedArtifactResponseMessage(fallbackMessage),
      body: null,
    })),
  );
}

function invalidMaterializedArtifactResponseMessage(
  fallbackMessage: string,
): string {
  return `${fallbackMessage}: response body must be valid Flarex JSON.`;
}

function materializedArtifactErrorMessage(
  body: unknown,
  fallbackMessage: string,
  status: number,
): string {
  return executionArtifactErrorBodyMessage(body) ??
    `${fallbackMessage} with status ${status}`;
}

function materializedArtifactResponseErrorToError(
  error: MaterializedArtifactResponseError,
): Error & { status?: number } {
  return Object.assign(new Error(error.message), { status: error.status });
}

function materializedArtifactInvokeResponseErrorToError(
  error: MaterializedExecutionArtifactInvokeResponseError,
): Error & { status?: number } {
  return Object.assign(new Error(error.message), { status: error.status });
}

const LOCAL_RUNTIME_WORKER_MODULE = "worker.js";
