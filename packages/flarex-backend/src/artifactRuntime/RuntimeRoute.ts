import { Data, Effect } from "effect";
import { materializedExecutionArtifactInvokePayload } from "flarex-protocol/artifact-runtime";
import type { BackendExecutionArtifactStore } from "../artifactStore.ts";
import {
  decodeExecutionArtifactInvokePayload,
  type ExecutionArtifactInvokeRouteError,
} from "./RouteBoundary.ts";
import type {
  ExecutionArtifactInvokePayload,
  MaterializedExecutionArtifact,
  MaterializedExecutionArtifactPayload,
} from "../artifactRuntime.ts";
import type { InvokeResponse } from "../types.ts";
import {
  ExecutionArtifactRuntimeMissingSourcePackageError,
  ExecutionArtifactRuntimeOperationError,
} from "./Errors.ts";
import {
  executionArtifactRuntimeOperationErrorFromUnknown,
} from "./OperationError.ts";

export class ExecutionArtifactRuntimeRouteNotFoundError extends Data.TaggedError(
  "ExecutionArtifactRuntimeRouteNotFoundError",
)<{
  readonly status: 404;
  readonly message: string;
  readonly method: string;
  readonly path: string;
}> {}

export class ExecutionArtifactRuntimeAuthorizationError extends Data.TaggedError(
  "ExecutionArtifactRuntimeAuthorizationError",
)<{
  readonly status: 401;
  readonly message: string;
}> {}

export class ExecutionArtifactRuntimeHeaderError extends Data.TaggedError(
  "ExecutionArtifactRuntimeHeaderError",
)<{
  readonly status: 400;
  readonly message: string;
  readonly header: "x-flarex-artifact-id" | "x-flarex-source-package-hash";
}> {}

export type ExecutionArtifactRuntimeRouteError =
  | ExecutionArtifactInvokeRouteError
  | ExecutionArtifactRuntimeMissingSourcePackageError
  | ExecutionArtifactRuntimeOperationError
  | ExecutionArtifactRuntimeRouteNotFoundError
  | ExecutionArtifactRuntimeAuthorizationError
  | ExecutionArtifactRuntimeHeaderError;

type RuntimeArtifactCache = {
  get(payload: MaterializedExecutionArtifactPayload): Promise<MaterializedExecutionArtifact>;
};

export const routeExecutionArtifactRuntimeInvoke = Effect.fn("ExecutionArtifactRuntime.routeInvoke")(
  function* (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    options: {
      readonly store?: BackendExecutionArtifactStore;
      readonly capabilityToken?: string;
    },
    cache: RuntimeArtifactCache,
  ) {
    const request = yield* normalizeRuntimeRequestEffect(input, init);
    const pathname = new URL(request.url).pathname;
    if (pathname !== "/invoke" || request.method !== "POST") {
      return yield* Effect.fail(new ExecutionArtifactRuntimeRouteNotFoundError({
        status: 404,
        message: "Not found.",
        method: request.method,
        path: pathname,
      }));
    }
    yield* authorizeRuntimeRequestEffect(request, options.capabilityToken);

    const payload = yield* decodeExecutionArtifactInvokePayload(request);
    yield* validateArtifactHeadersEffect(request, payload);

    const materializedPayload = yield* resolveSourcePackageEffect(payload, options.store);
    const artifact = yield* getMaterializedArtifactEffect(cache, materializedPayload);
    const response = yield* invokeMaterializedArtifactEffect(artifact, materializedPayload);
    return Response.json(response);
  },
);

function normalizeRuntimeRequestEffect(
  input: RequestInfo | URL,
  init?: RequestInit,
): Effect.Effect<Request, ExecutionArtifactRuntimeOperationError> {
  return Effect.tryPromise({
    try: () => normalizeRuntimeRequest(input, init),
    catch: cause => executionArtifactRuntimeOperationErrorFromUnknown(
      "normalizeRequest",
      cause,
    ),
  });
}

function authorizeRuntimeRequestEffect(
  request: Request,
  capabilityToken: string | undefined,
): Effect.Effect<void, ExecutionArtifactRuntimeAuthorizationError> {
  if (capabilityToken === undefined) return Effect.void;
  const expected = `Bearer ${capabilityToken}`;
  if (request.headers.get("authorization") === expected) return Effect.void;
  return Effect.fail(new ExecutionArtifactRuntimeAuthorizationError({
    status: 401,
    message: "Unauthorized execution artifact runtime request.",
  }));
}

function validateArtifactHeadersEffect(
  request: Request,
  payload: ExecutionArtifactInvokePayload,
): Effect.Effect<void, ExecutionArtifactRuntimeHeaderError> {
  if (request.headers.get("x-flarex-artifact-id") !== payload.ref.artifactId) {
    return Effect.fail(new ExecutionArtifactRuntimeHeaderError({
      status: 400,
      message: "Execution artifact ID header mismatch.",
      header: "x-flarex-artifact-id",
    }));
  }
  if (request.headers.get("x-flarex-source-package-hash") !== payload.ref.sourcePackageHash) {
    return Effect.fail(new ExecutionArtifactRuntimeHeaderError({
      status: 400,
      message: "Execution artifact source package hash header mismatch.",
      header: "x-flarex-source-package-hash",
    }));
  }
  return Effect.void;
}

function resolveSourcePackageEffect(
  payload: ExecutionArtifactInvokePayload,
  store: BackendExecutionArtifactStore | undefined,
): Effect.Effect<
  MaterializedExecutionArtifactPayload,
  ExecutionArtifactRuntimeMissingSourcePackageError | ExecutionArtifactRuntimeOperationError
> {
  if (payload.sourcePackage !== undefined) {
    return Effect.succeed(materializedExecutionArtifactInvokePayload({
      deploymentId: payload.deploymentId,
      identity: payload.identity,
      ref: payload.ref,
      sourcePackage: payload.sourcePackage,
      request: payload.request,
    }));
  }
  if (store === undefined) {
    return Effect.fail(new ExecutionArtifactRuntimeMissingSourcePackageError({
      message: "Execution artifact invoke payload missing sourcePackage.",
    }));
  }
  return Effect.tryPromise({
    try: async () => materializedExecutionArtifactInvokePayload({
      deploymentId: payload.deploymentId,
      identity: payload.identity,
      ref: payload.ref,
      request: payload.request,
      sourcePackage: await store.get(payload.ref),
    }),
    catch: cause => executionArtifactRuntimeOperationErrorFromUnknown(
      "loadSourcePackage",
      cause,
    ),
  });
}

function getMaterializedArtifactEffect(
  cache: RuntimeArtifactCache,
  payload: MaterializedExecutionArtifactPayload,
): Effect.Effect<MaterializedExecutionArtifact, ExecutionArtifactRuntimeOperationError> {
  return Effect.tryPromise({
    try: () => cache.get(payload),
    catch: cause => executionArtifactRuntimeOperationErrorFromUnknown(
      "materialize",
      cause,
    ),
  });
}

function invokeMaterializedArtifactEffect(
  artifact: MaterializedExecutionArtifact,
  payload: MaterializedExecutionArtifactPayload,
): Effect.Effect<InvokeResponse, ExecutionArtifactRuntimeOperationError> {
  return Effect.tryPromise({
    try: () => artifact.invoke(payload),
    catch: cause => executionArtifactRuntimeOperationErrorFromUnknown(
      "invoke",
      cause,
    ),
  });
}

async function normalizeRuntimeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Request> {
  if (isRequestLike(input) && !(input instanceof Request)) {
    return requestFromRequestLike(input);
  }
  if (init !== undefined || typeof input === "string" || input instanceof URL || input instanceof Request) {
    return new Request(input, init);
  }
  return new Request(input, init);
}

type RequestLike = {
  url: string;
  method: string;
  headers: HeadersInit;
  text(): Promise<string>;
};

function isRequestLike(value: unknown): value is RequestLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RequestLike>;
  return (
    typeof candidate.url === "string" &&
    typeof candidate.method === "string" &&
    candidate.headers !== undefined &&
    typeof candidate.text === "function"
  );
}

async function requestFromRequestLike(request: RequestLike): Promise<Request> {
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    ...(request.method === "GET" || request.method === "HEAD"
      ? {}
      : { body: await request.text() }),
  };
  return new Request(request.url, init);
}
