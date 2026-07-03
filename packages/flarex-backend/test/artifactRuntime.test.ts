import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { BackendExecutionArtifactStore } from "../src/artifactStore";
import {
  CachedExecutionArtifactMaterializer,
  decodeServiceBindingExecutionArtifactRuntimeInvokeResponse,
  createExecutionArtifactRuntimeService,
  decodeServiceBindingExecutionArtifactRuntimeResponse,
  executionArtifactWorkerEnv,
  executionArtifactWorkerModules,
  ExecutionArtifactWorkerDuplicateModulePathError,
  ExecutionArtifactWorkerReservedModulePathError,
  ExecutionArtifactWorkerSourceModuleMissingError,
  ExecutionArtifactRuntimeMissingSourcePackageError,
  executionArtifactRuntimeRouteErrorToResponseEffect,
  invokeServiceBindingExecutionArtifactRuntime,
  serviceBindingExecutionArtifactRuntimeErrorToHttpErrorEffect,
  ServiceBindingExecutionArtifactRuntime,
  ServiceBindingExecutionArtifactRuntimeResponseError,
  type ExecutionArtifactInvokePayload,
  type ExecutionArtifactMaterializer,
  type MaterializedExecutionArtifactPayload,
} from "../src/artifactRuntime";
import {
  ExecutionArtifactRuntimeAuthorizationError,
  ExecutionArtifactRuntimeHeaderError,
  ExecutionArtifactRuntimeRouteNotFoundError,
  routeExecutionArtifactRuntimeInvoke,
} from "../src/artifactRuntime/RuntimeRoute";
import type {
  ActiveDeploymentStatus,
  InvokeRequest,
  PushSourcePackage,
} from "../src/types";

describe("backend execution artifact runtime", () => {
  it("builds generated worker env bindings without host service bindings", () => {
    expect(executionArtifactWorkerEnv({
      executorToken: "executor-secret",
      executorTransport: "postgres",
      invokeMaxAttempts: 4,
      projectId: "project1",
      internalToken: "internal-secret",
    })).toEqual({
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_INVOKE_MAX_ATTEMPTS: "4",
      FLAREX_PROJECT_ID: "project1",
      FLAREX_INTERNAL_TOKEN: "internal-secret",
    });

    const env = executionArtifactWorkerEnv({});
    expect(env).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(env, "FLAREX_EXECUTOR")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(env, "FLAREX_BACKEND")).toBe(false);
  });

  it("builds runtime worker module maps and validates source package modules", () => {
    expect(executionArtifactWorkerModules({
      sourcePackage: testSourcePackage(),
      runtimeModulePath: "worker.js",
      runtimeWorkerSource: "export default {};",
      reservedBy: "test runtime",
    })).toEqual({
      "worker.js": "export default {};",
      "_flarex/execution.js": "export default {};",
      "users.js": "export const get = {};",
    });

    const modulesWithPrototypePath = executionArtifactWorkerModules({
      sourcePackage: {
        ...testSourcePackage(),
        modules: [
          ...testSourcePackage().modules,
          {
            path: "__proto__",
            environment: "isolate",
            sha256: "d".repeat(64),
            source: "export const proto = true;",
          },
        ],
      },
      runtimeModulePath: "worker.js",
      runtimeWorkerSource: "export default {};",
      reservedBy: "test runtime",
    });
    expect(
      Object.prototype.hasOwnProperty.call(modulesWithPrototypePath, "__proto__"),
    ).toBe(true);
    expect(Object.entries(modulesWithPrototypePath)).toContainEqual([
      "__proto__",
      "export const proto = true;",
    ]);

    expect(() => executionArtifactWorkerModules({
      sourcePackage: {
        ...testSourcePackage(),
        modules: [
          ...testSourcePackage().modules,
          {
            path: "worker.js",
            environment: "isolate",
            sha256: "c".repeat(64),
            source: "export const reserved = true;",
          },
        ],
      },
      runtimeModulePath: "worker.js",
      runtimeWorkerSource: "export default {};",
      reservedBy: "test runtime",
    })).toThrow(ExecutionArtifactWorkerReservedModulePathError);

    expect(() => executionArtifactWorkerModules({
      sourcePackage: {
        ...testSourcePackage(),
        modules: [
          ...testSourcePackage().modules,
          {
            path: "users.js",
            environment: "isolate",
            sha256: "c".repeat(64),
            source: "export const duplicate = true;",
          },
        ],
      },
      runtimeModulePath: "worker.js",
      runtimeWorkerSource: "export default {};",
      reservedBy: "test runtime",
    })).toThrow(ExecutionArtifactWorkerDuplicateModulePathError);

    expect(() => executionArtifactWorkerModules({
      sourcePackage: {
        ...testSourcePackage(),
        modules: testSourcePackage().modules.map(module =>
          module.path === "_flarex/execution.js"
            ? {
                path: module.path,
                environment: module.environment,
                sha256: module.sha256,
              }
            : module,
        ),
      },
      runtimeModulePath: "worker.js",
      runtimeWorkerSource: "export default {};",
      reservedBy: "test runtime",
    })).toThrow(ExecutionArtifactWorkerSourceModuleMissingError);
  });

  it("exposes typed service-binding runtime response failures before HTTP mapping", async () => {
    await expect(
      Effect.runPromise(
        decodeServiceBindingExecutionArtifactRuntimeResponse(
          new Response("unavailable", { status: 503 }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "ServiceBindingExecutionArtifactRuntimeResponseError",
      status: 503,
      message: "Execution artifact runtime failed with status 503",
      body: null,
    });
  });

  it("decodes service-binding invoke responses through the protocol schema", async () => {
    await expect(Effect.runPromise(
      decodeServiceBindingExecutionArtifactRuntimeInvokeResponse({
        value: { ok: true },
        readSet: { documents: [{ tableId: 1, id: "1:user" }] },
        readTs: 42,
      }),
    )).resolves.toEqual({
      value: { ok: true },
      readSet: { documents: [{ tableId: 1, id: "1:user" }] },
      readTs: 42,
    });

    await expect(Effect.runPromise(Effect.flip(
      decodeServiceBindingExecutionArtifactRuntimeInvokeResponse({ readTs: 42 }),
    ))).resolves.toMatchObject({
      _tag: "ServiceBindingExecutionArtifactRuntimeResponseError",
      status: 500,
      message: "Invalid execution artifact runtime invoke response.",
      body: { readTs: 42 },
    });
  });

  it("loads the active source package before invoking the runtime service", async () => {
    const sourcePackage = testSourcePackage();
    const calls: Array<{
      url: string;
      artifactId: string | null;
      sourcePackageHash: string | null;
      authorization: string | null;
      body: unknown;
    }> = [];
    const store: BackendExecutionArtifactStore = {
      put: async () => activeDeployment.executionArtifactRef,
      get: async ref => {
        expect(ref).toEqual(activeDeployment.executionArtifactRef);
        return sourcePackage;
      },
    };
    const runtime = new ServiceBindingExecutionArtifactRuntime({
      deploymentId: "deployment1",
      capabilityToken: "runtime-secret",
      store,
      runtime: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          calls.push({
            url: request.url,
            artifactId: request.headers.get("x-flarex-artifact-id"),
            sourcePackageHash: request.headers.get("x-flarex-source-package-hash"),
            authorization: request.headers.get("authorization"),
            body: await request.json(),
          });
          return Response.json({ value: { ok: true } });
        },
      } as unknown as Fetcher,
    });
    const invokeRequest: InvokeRequest = {
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "user:1",
      kind: "query",
    };

    await expect(runtime.invoke(activeDeployment, invokeRequest)).resolves.toEqual({
      value: { ok: true },
    });
    expect(calls).toEqual([
      {
        url: "https://flarex-artifact-runtime.internal/invoke",
        artifactId: activeDeployment.executionArtifactRef.artifactId,
        sourcePackageHash: activeDeployment.executionArtifactRef.sourcePackageHash,
        authorization: "Bearer runtime-secret",
        body: {
          deploymentId: "deployment1",
          ref: activeDeployment.executionArtifactRef,
          sourcePackage,
          request: invokeRequest,
        },
      },
    ]);
  });

  it("can invoke the runtime without embedding sourcePackage when the runtime owns artifact loading", async () => {
    const calls: Array<{ body: unknown }> = [];
    const store: BackendExecutionArtifactStore = {
      put: async () => activeDeployment.executionArtifactRef,
      get: async () => {
        throw new Error("backend store should not be read in runtime-store mode");
      },
    };
    const runtime = new ServiceBindingExecutionArtifactRuntime({
      deploymentId: "deployment1",
      store,
      sendSourcePackage: false,
      runtime: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          calls.push({ body: await request.json() });
          return Response.json({ value: { ok: true } });
        },
      } as unknown as Fetcher,
    });
    const invokeRequest: InvokeRequest = {
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "user:1",
      kind: "query",
    };

    await expect(runtime.invoke(activeDeployment, invokeRequest)).resolves.toEqual({
      value: { ok: true },
    });
    expect(calls).toEqual([
      {
        body: {
          deploymentId: "deployment1",
          ref: activeDeployment.executionArtifactRef,
          request: invokeRequest,
        },
      },
    ]);
  });

  it("exposes typed service-binding source package load failures before HTTP mapping", async () => {
    const unavailable = new Error("Artifact store unavailable") as Error & { status?: number };
    unavailable.status = 503;
    const store: BackendExecutionArtifactStore = {
      put: async () => activeDeployment.executionArtifactRef,
      get: async () => {
        throw unavailable;
      },
    };

    await expect(Effect.runPromise(invokeServiceBindingExecutionArtifactRuntime(
      {
        deploymentId: "deployment1",
        store,
        runtime: {
          fetch: async () => {
            throw new Error("runtime should not run when source package load fails");
          },
        } as unknown as Fetcher,
      },
      activeDeployment,
      {
        path: "users:get",
        args: {},
        kind: "query",
      },
    ))).rejects.toMatchObject({
      _tag: "ExecutionArtifactRuntimeOperationError",
      operation: "loadSourcePackage",
      status: 503,
      message: "Artifact store unavailable",
      cause: unavailable,
    });
  });

  it("exposes typed service-binding runtime fetch failures before HTTP mapping", async () => {
    const fetchFailure = new Error("Runtime binding unavailable") as Error & { status?: number };
    fetchFailure.status = 504;
    const store: BackendExecutionArtifactStore = {
      put: async () => activeDeployment.executionArtifactRef,
      get: async () => testSourcePackage(),
    };

    await expect(Effect.runPromise(invokeServiceBindingExecutionArtifactRuntime(
      {
        deploymentId: "deployment1",
        store,
        runtime: {
          fetch: async () => {
            throw fetchFailure;
          },
        } as unknown as Fetcher,
      },
      activeDeployment,
      {
        path: "users:get",
        args: {},
        kind: "query",
      },
    ))).rejects.toMatchObject({
      _tag: "ExecutionArtifactRuntimeOperationError",
      operation: "runtimeFetch",
      status: 504,
      message: "Runtime binding unavailable",
      cause: fetchFailure,
    });
  });

  it("maps service-binding runtime response failures to HttpError at the adapter edge", async () => {
    const store: BackendExecutionArtifactStore = {
      put: async () => activeDeployment.executionArtifactRef,
      get: async () => testSourcePackage(),
    };
    const runtime = new ServiceBindingExecutionArtifactRuntime({
      deploymentId: "deployment1",
      store,
      runtime: {
        fetch: async () => new Response("unavailable", { status: 503 }),
      } as unknown as Fetcher,
    });

    await expect(runtime.invoke(activeDeployment, {
      path: "users:get",
      args: {},
      kind: "query",
    })).rejects.toMatchObject({
      name: "HttpError",
      status: 503,
      message: "Execution artifact runtime failed with status 503",
    });
  });

  it("maps invalid service-binding runtime invoke responses to HttpError at the adapter edge", async () => {
    const runtime = new ServiceBindingExecutionArtifactRuntime({
      deploymentId: "deployment1",
      store: {
        put: async () => activeDeployment.executionArtifactRef,
        get: async () => testSourcePackage(),
      },
      runtime: {
        fetch: async () => Response.json({ readTs: 42 }),
      } as unknown as Fetcher,
    });

    await expect(runtime.invoke(activeDeployment, {
      path: "users:get",
      args: {},
      kind: "query",
    })).rejects.toMatchObject({
      name: "HttpError",
      status: 500,
      message: "Invalid execution artifact runtime invoke response.",
    });
  });

  it("maps service-binding runtime operation failures to HttpError at the adapter edge", async () => {
    const fetchFailure = new Error("Runtime binding unavailable") as Error & { status?: number };
    fetchFailure.status = 504;
    const runtime = new ServiceBindingExecutionArtifactRuntime({
      deploymentId: "deployment1",
      store: {
        put: async () => activeDeployment.executionArtifactRef,
        get: async () => testSourcePackage(),
      },
      runtime: {
        fetch: async () => {
          throw fetchFailure;
        },
      } as unknown as Fetcher,
    });

    await expect(runtime.invoke(activeDeployment, {
      path: "users:get",
      args: {},
      kind: "query",
    })).rejects.toMatchObject({
      name: "HttpError",
      status: 504,
      message: "Runtime binding unavailable",
    });
  });

  it("maps service-binding runtime failures through a named adapter effect", async () => {
    const error = new ServiceBindingExecutionArtifactRuntimeResponseError({
      status: 503,
      message: "Execution artifact runtime failed with status 503",
      body: null,
    });

    await expect(Effect.runPromise(Effect.flip(
      serviceBindingExecutionArtifactRuntimeErrorToHttpErrorEffect(error),
    ))).resolves.toMatchObject({
      name: "HttpError",
      status: 503,
      message: "Execution artifact runtime failed with status 503",
    });
  });

  it("materializes each artifact once and reuses cached artifacts by artifact ID", async () => {
    const payload = testPayload();
    const materialized: string[] = [];
    const invoked: string[] = [];
    const cache = new CachedExecutionArtifactMaterializer({
      materialize: async nextPayload => {
        materialized.push(nextPayload.ref.artifactId);
        return {
          invoke: async invokePayload => {
            invoked.push(invokePayload.request.path);
            return { value: { artifactId: nextPayload.ref.artifactId } };
          },
        };
      },
    });

    await expect((await cache.get(payload)).invoke(payload)).resolves.toEqual({
      value: { artifactId: payload.ref.artifactId },
    });
    await expect((await cache.get(payload)).invoke({
      ...payload,
      request: { ...payload.request, path: "users:list" },
    })).resolves.toEqual({ value: { artifactId: payload.ref.artifactId } });

    expect(materialized).toEqual([payload.ref.artifactId]);
    expect(invoked).toEqual(["users:get", "users:list"]);
    expect(cache.size()).toBe(1);
  });

  it("rematerializes when an artifact ID is reused with a different source hash", async () => {
    const first = testPayload();
    const second: MaterializedExecutionArtifactPayload = {
      ...first,
      ref: { ...first.ref, sourcePackageHash: "b".repeat(64) },
      sourcePackage: {
        ...first.sourcePackage,
        modules: first.sourcePackage.modules.map(module =>
          module.path === "users.js" ? { ...module, sha256: "c".repeat(64) } : module,
        ),
      },
    };
    const materializedHashes: string[] = [];
    const cache = new CachedExecutionArtifactMaterializer({
      materialize: async payload => {
        materializedHashes.push(payload.ref.sourcePackageHash);
        return { invoke: async () => ({ value: payload.ref.sourcePackageHash }) };
      },
    });

    await cache.get(first);
    await cache.get(second);

    expect(materializedHashes).toEqual([
      first.ref.sourcePackageHash,
      second.ref.sourcePackageHash,
    ]);
    expect(cache.size()).toBe(1);
  });

  it("disposes the old artifact when an artifact ID is rematerialized", async () => {
    const first = testPayload();
    const second: MaterializedExecutionArtifactPayload = {
      ...first,
      ref: { ...first.ref, sourcePackageHash: "b".repeat(64) },
    };
    const disposed: string[] = [];
    const cache = new CachedExecutionArtifactMaterializer({
      materialize: async payload => ({
        invoke: async () => ({ value: payload.ref.sourcePackageHash }),
        dispose: () => {
          disposed.push(payload.ref.sourcePackageHash);
        },
      }),
    });

    await cache.get(first);
    await cache.get(second);

    expect(disposed).toEqual([first.ref.sourcePackageHash]);
    expect(cache.size()).toBe(1);
  });

  it("disposes cached artifacts on delete and clear", async () => {
    const first = testPayload();
    const second: MaterializedExecutionArtifactPayload = {
      ...first,
      ref: {
        ...first.ref,
        artifactId: "artifact_ffffffffffffffffffffffffffffffff",
        sourcePackageHash: "b".repeat(64),
      },
    };
    const disposed: string[] = [];
    const cache = new CachedExecutionArtifactMaterializer({
      materialize: async payload => ({
        invoke: async () => ({ value: payload.ref.artifactId }),
        dispose: async () => {
          disposed.push(payload.ref.artifactId);
        },
      }),
    });

    await cache.get(first);
    await cache.get(second);
    await cache.delete(first.ref.artifactId);

    expect(disposed).toEqual([first.ref.artifactId]);
    expect(cache.size()).toBe(1);

    await cache.clear();

    expect(disposed).toEqual([first.ref.artifactId, second.ref.artifactId]);
    expect(cache.size()).toBe(0);
  });

  it("serves runtime invoke requests through the materializer cache", async () => {
    const payload = testPayload();
    const materialized: string[] = [];
    const materializer: ExecutionArtifactMaterializer = {
      materialize: async nextPayload => {
        materialized.push(nextPayload.ref.artifactId);
        return {
          invoke: async invokePayload => ({
            value: {
              deploymentId: invokePayload.deploymentId,
              path: invokePayload.request.path,
            },
          }),
        };
      },
    };
    const fetch = createExecutionArtifactRuntimeService({
      materializer,
      capabilityToken: "runtime-secret",
    });

    const response = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
        "x-flarex-artifact-id": payload.ref.artifactId,
        "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      },
      body: JSON.stringify(payload),
    });
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
      value: { deploymentId: "deployment1", path: "users:get" },
    });

    const second = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
        "x-flarex-artifact-id": payload.ref.artifactId,
        "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      },
      body: JSON.stringify({
        ...payload,
        request: { ...payload.request, path: "users:list" },
      }),
    });
    expect(second.ok).toBe(true);
    await expect(second.json()).resolves.toEqual({
      value: { deploymentId: "deployment1", path: "users:list" },
    });
    expect(materialized).toEqual([payload.ref.artifactId]);
  });

  it("disposes cached runtime service artifacts", async () => {
    const payload = testPayload();
    const disposed: string[] = [];
    const fetch = createExecutionArtifactRuntimeService({
      capabilityToken: "runtime-secret",
      materializer: {
        materialize: async materializedPayload => ({
          invoke: async () => ({ value: materializedPayload.request.path }),
          dispose: () => {
            disposed.push(materializedPayload.ref.artifactId);
          },
        }),
      },
    });

    const response = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
        "x-flarex-artifact-id": payload.ref.artifactId,
        "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      },
      body: JSON.stringify(payload),
    });
    expect(response.ok).toBe(true);
    expect(fetch.cacheSize()).toBe(1);

    await fetch.dispose();

    expect(disposed).toEqual([payload.ref.artifactId]);
    expect(fetch.cacheSize()).toBe(0);
  });

  it("loads sourcePackage from runtime store before materializing", async () => {
    const payload = testPayload();
    const { sourcePackage: _sourcePackage, ...payloadWithoutSource } = payload;
    const storeCalls: Array<string> = [];
    const materializedSources: PushSourcePackage[] = [];
    const fetch = createExecutionArtifactRuntimeService({
      capabilityToken: "runtime-secret",
      store: {
        put: async () => payload.ref,
        get: async ref => {
          storeCalls.push(ref.artifactId);
          return payload.sourcePackage!;
        },
      },
      materializer: {
        materialize: async materializedPayload => {
          materializedSources.push(materializedPayload.sourcePackage);
          return { invoke: async () => ({ value: { path: materializedPayload.request.path } }) };
        },
      },
    });

    const response = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
        "x-flarex-artifact-id": payload.ref.artifactId,
        "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      },
      body: JSON.stringify(payloadWithoutSource),
    });

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ value: { path: "users:get" } });
    expect(storeCalls).toEqual([payload.ref.artifactId]);
    expect(materializedSources).toEqual([payload.sourcePackage]);
  });

  it("exposes typed runtime route failures before adapter response mapping", async () => {
    const payload = testPayload();
    const cache = new CachedExecutionArtifactMaterializer({
      materialize: async () => {
        throw new Error("materializer should not run for route failures");
      },
    });

    await expect(Effect.runPromise(routeExecutionArtifactRuntimeInvoke(
      "https://runtime.test/unknown",
      { method: "POST" },
      { capabilityToken: "runtime-secret" },
      cache,
    ))).rejects.toBeInstanceOf(ExecutionArtifactRuntimeRouteNotFoundError);

    await expect(Effect.runPromise(routeExecutionArtifactRuntimeInvoke(
      "https://runtime.test/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-artifact-id": payload.ref.artifactId,
          "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
        },
        body: JSON.stringify(payload),
      },
      { capabilityToken: "runtime-secret" },
      cache,
    ))).rejects.toBeInstanceOf(ExecutionArtifactRuntimeAuthorizationError);

    await expect(Effect.runPromise(routeExecutionArtifactRuntimeInvoke(
      "https://runtime.test/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer runtime-secret",
          "x-flarex-artifact-id": "artifact_ffffffffffffffffffffffffffffffff",
          "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
        },
        body: JSON.stringify(payload),
      },
      { capabilityToken: "runtime-secret" },
      cache,
    ))).rejects.toMatchObject({
      _tag: "ExecutionArtifactRuntimeHeaderError",
      header: "x-flarex-artifact-id",
      message: "Execution artifact ID header mismatch.",
    } satisfies Partial<ExecutionArtifactRuntimeHeaderError>);

    const { sourcePackage: _sourcePackage, ...payloadWithoutSource } = payload;
    await expect(Effect.runPromise(routeExecutionArtifactRuntimeInvoke(
      "https://runtime.test/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer runtime-secret",
          "x-flarex-artifact-id": payload.ref.artifactId,
          "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
        },
        body: JSON.stringify(payloadWithoutSource),
      },
      { capabilityToken: "runtime-secret" },
      cache,
    ))).rejects.toBeInstanceOf(ExecutionArtifactRuntimeMissingSourcePackageError);
  });

  it("rejects runtime-store mode without a store when sourcePackage is omitted", async () => {
    const payload = testPayload();
    const { sourcePackage: _sourcePackage, ...payloadWithoutSource } = payload;
    const fetch = createExecutionArtifactRuntimeService({
      capabilityToken: "runtime-secret",
      materializer: {
        materialize: async () => {
          throw new Error("materializer should not run without source package");
        },
      },
    });

    const response = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
        "x-flarex-artifact-id": payload.ref.artifactId,
        "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      },
      body: JSON.stringify(payloadWithoutSource),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Execution artifact invoke payload missing sourcePackage.",
    });
  });

  it("maps runtime route failures through a named response adapter effect", async () => {
    const response = await Effect.runPromise(executionArtifactRuntimeRouteErrorToResponseEffect(
      new ExecutionArtifactRuntimeAuthorizationError({
        status: 401,
        message: "Unauthorized execution artifact runtime request.",
      }),
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized execution artifact runtime request.",
    });
  });

  it("preserves runtime store source-package load error status codes", async () => {
    const payload = testPayload();
    const { sourcePackage: _sourcePackage, ...payloadWithoutSource } = payload;
    const fetch = createExecutionArtifactRuntimeService({
      capabilityToken: "runtime-secret",
      store: {
        put: async () => payload.ref,
        get: async () => {
          const error = new Error("Artifact store unavailable") as Error & { status?: number };
          error.status = 503;
          throw error;
        },
      },
      materializer: {
        materialize: async () => {
          throw new Error("materializer should not run when store load fails");
        },
      },
    });

    const response = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
        "x-flarex-artifact-id": payload.ref.artifactId,
        "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      },
      body: JSON.stringify(payloadWithoutSource),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Artifact store unavailable",
    });
  });

  it("rejects malformed or invalid runtime invoke payloads at the route boundary", async () => {
    const fetch = createExecutionArtifactRuntimeService({
      capabilityToken: "runtime-secret",
      materializer: {
        materialize: async () => {
          throw new Error("materializer should not run for invalid payloads");
        },
      },
    });

    const malformed = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
      },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const invalid = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
      },
      body: JSON.stringify({
        deploymentId: "deployment1",
        ref: activeDeployment.executionArtifactRef,
      }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "Invalid execution artifact invoke payload.",
    });
  });

  it("rejects unauthorized or mismatched runtime invoke requests", async () => {
    const payload = testPayload();
    const fetch = createExecutionArtifactRuntimeService({
      capabilityToken: "runtime-secret",
      materializer: {
        materialize: async () => ({ invoke: async () => ({ value: null }) }),
      },
    });

    const notFound = await fetch("https://runtime.test/unknown", {
      method: "POST",
    });
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({
      error: "Not found.",
    });

    const unauthorized = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flarex-artifact-id": payload.ref.artifactId,
        "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      },
      body: JSON.stringify(payload),
    });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: "Unauthorized execution artifact runtime request.",
    });

    const mismatched = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
        "x-flarex-artifact-id": "artifact_ffffffffffffffffffffffffffffffff",
        "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      },
      body: JSON.stringify(payload),
    });
    expect(mismatched.status).toBe(400);
    await expect(mismatched.json()).resolves.toEqual({
      error: "Execution artifact ID header mismatch.",
    });

    const hashMismatched = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
        "x-flarex-artifact-id": payload.ref.artifactId,
        "x-flarex-source-package-hash": "b".repeat(64),
      },
      body: JSON.stringify(payload),
    });
    expect(hashMismatched.status).toBe(400);
    await expect(hashMismatched.json()).resolves.toEqual({
      error: "Execution artifact source package hash header mismatch.",
    });
  });

  it("preserves materialized artifact error status codes", async () => {
    const payload = testPayload();
    const fetch = createExecutionArtifactRuntimeService({
      capabilityToken: "runtime-secret",
      materializer: {
        materialize: async () => ({
          invoke: async () => {
            const error = new Error("ArgumentValidationError: bad args") as Error & {
              status?: number;
            };
            error.status = 400;
            throw error;
          },
        }),
      },
    });

    const response = await fetch("https://runtime.test/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer runtime-secret",
        "x-flarex-artifact-id": payload.ref.artifactId,
        "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "ArgumentValidationError: bad args",
    });
  });
});

const activeDeployment: ActiveDeploymentStatus = {
  activePushId: "push1",
  activatedAt: 1,
  schemaVersion: 1,
  executionArtifactRef: {
    runtime: "dynamic-worker",
    artifactId: "artifact_1234567890abcdef1234567890abcdef",
    sourcePackageHash: "a".repeat(64),
    executionModule: "_flarex/execution.js",
  },
  sourcePackage: testSourcePackage(),
  analysis: {
    schema: { version: 1, tables: [], indexes: [] },
    functions: { functions: [{ path: "users:get", kind: "query" }] },
  },
  codegenAnalysis: {
    schema: { version: 1, tables: [], indexes: [] },
    functions: [],
  },
};

function testSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: "export default {};",
      },
      {
        path: "users.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export const get = {};",
      },
    ],
    functions: ["users.js"],
    execution: "_flarex/execution.js",
  };
}

function testPayload(): MaterializedExecutionArtifactPayload {
  return {
    deploymentId: "deployment1",
    ref: activeDeployment.executionArtifactRef,
    sourcePackage: testSourcePackage(),
    request: {
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "user:1",
      kind: "query",
    },
  };
}
