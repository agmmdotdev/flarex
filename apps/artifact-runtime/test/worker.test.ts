import { describe, expect, it } from "vitest";
import type {
  ExecutionArtifactInvokePayload,
  ExecutionArtifactMaterializer,
  MaterializedExecutionArtifactPayload,
} from "flarex-backend/artifact-runtime";
import {
  ServiceBindingExecutionArtifactRuntime,
} from "flarex-backend/artifact-runtime";
import {
  R2BackendExecutionArtifactStore,
  type R2BucketLike,
} from "flarex-backend/artifact-store";
import type {
  ActiveDeploymentStatus,
  PushSourcePackage,
} from "flarex-backend/types";
import {
  createArtifactRuntimeWorker,
} from "../src/worker";

describe("artifact runtime worker", () => {
  it("accepts backend service-binding ref-only invokes through the deployable wrapper", async () => {
    const sourcePackage = testSourcePackage();
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const ref = await store.put(sourcePackage);
    const materializedPayloads: MaterializedExecutionArtifactPayload[] = [];
    const worker = createArtifactRuntimeWorker({
      materializer: {
        materialize: async payload => {
          materializedPayloads.push(payload);
          return {
            invoke: async invokePayload => ({
              value: {
                deploymentId: invokePayload.deploymentId,
                path: invokePayload.request.path,
                sourceModule: invokePayload.sourcePackage.execution,
              },
            }),
          };
        },
      },
    });
    const runtimeEnv = {
      ARTIFACTS: bucket,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
    };
    const runtimeBinding = {
      fetch: (input: Parameters<Fetcher["fetch"]>[0], init?: Parameters<Fetcher["fetch"]>[1]) =>
        worker.fetch(new Request(input, init), runtimeEnv),
      connect: () => {
        throw new Error("artifact runtime tests do not use Fetcher.connect");
      },
    } satisfies Fetcher;
    const backendRuntime = new ServiceBindingExecutionArtifactRuntime({
      deploymentId: "deployment1",
      store,
      runtime: runtimeBinding,
      capabilityToken: "runtime-secret",
      sendSourcePackage: false,
    });

    await expect(backendRuntime.invoke(activeDeployment(ref, sourcePackage), {
      path: "users:get",
      kind: "query",
      partitionKey: "user:1",
      args: { id: "1:user" },
    })).resolves.toEqual({
      value: {
        deploymentId: "deployment1",
        path: "users:get",
        sourceModule: "_flarex/execution.js",
      },
    });
    expect(materializedPayloads).toEqual([
      {
        deploymentId: "deployment1",
        ref,
        sourcePackage,
        request: {
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
        },
      },
    ]);
  });

  it("loads source packages from R2 for ref-only service-binding invokes", async () => {
    const sourcePackage = testSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const materializedPayloads: MaterializedExecutionArtifactPayload[] = [];
    const materializer: ExecutionArtifactMaterializer = {
      materialize: async payload => {
        materializedPayloads.push(payload);
        return {
          invoke: async invokePayload => ({
            value: {
              deploymentId: invokePayload.deploymentId,
              moduleCount: invokePayload.sourcePackage.modules.length,
              path: invokePayload.request.path,
            },
          }),
        };
      },
    };
    const worker = createArtifactRuntimeWorker({ materializer });
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      request: {
        path: "users:get",
        kind: "query",
        partitionKey: "user:1",
        args: { id: "1:user" },
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
    });

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
      value: {
        deploymentId: "deployment1",
        moduleCount: 2,
        path: "users:get",
      },
    });
    expect(materializedPayloads).toEqual([
      {
        ...payload,
        sourcePackage,
      },
    ]);
  });

  it("reuses the runtime service cache for repeated invokes in one Worker env", async () => {
    const sourcePackage = testSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const materializedArtifactIds: string[] = [];
    const worker = createArtifactRuntimeWorker({
      materializer: {
        materialize: async payload => {
          materializedArtifactIds.push(payload.ref.artifactId);
          return {
            invoke: async invokePayload => ({
              value: {
                path: invokePayload.request.path,
              },
            }),
          };
        },
      },
    });
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };
    const env = {
      ARTIFACTS: bucket,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
    };

    const first = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), env);
    const second = await worker.fetch(
      runtimeInvokeRequest({
        ...payload,
        request: {
          path: "users:list",
          kind: "query",
          args: {},
        },
      }, "runtime-secret"),
      env,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    await expect(first.json()).resolves.toEqual({ value: { path: "users:get" } });
    await expect(second.json()).resolves.toEqual({ value: { path: "users:list" } });
    expect(materializedArtifactIds).toEqual([ref.artifactId]);
  });

  it("uses the Worker Loader default materializer for ref-only invokes", async () => {
    const sourcePackage = executableSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async request => {
      const body = await request.json();
      return Response.json({
        value: {
          loaded: true,
          body,
        },
      });
    });
    const worker = createArtifactRuntimeWorker();
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      request: {
        path: "users:get",
        kind: "query",
        args: { id: "1:user" },
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      FLAREX_INTERNAL_TOKEN: "internal-secret",
      FLAREX_INTERNAL_TOKEN_VERSION: "v1",
    });

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
      value: {
        loaded: true,
        body: {
          deploymentId: "deployment1",
          path: "users:get",
          kind: "query",
          args: { id: "1:user" },
        },
      },
    });
    expect(loader.loaded).toHaveLength(1);
    expect(loader.loaded[0]).toMatchObject({
      name: `v1:${ref.artifactId}:${ref.sourcePackageHash}:compat=2026-06-14:auth=version-v1`,
      code: {
        compatibilityDate: "2026-06-14",
        mainModule: "flarex-runtime-worker.js",
        env: { FLAREX_INTERNAL_TOKEN: "internal-secret" },
        globalOutbound: null,
      },
    });
    expect(Object.keys(loader.loaded[0]!.code.modules).sort()).toEqual([
      "_flarex/execution.js",
      "flarex-runtime-worker.js",
      "users.js",
    ]);
    expect(String(loader.loaded[0]!.code.modules["flarex-runtime-worker.js"]))
      .toContain("Hosted Dynamic Worker db/syscall context is not implemented yet.");
  });

  it("varies the Worker Loader identity by compatibility date and internal auth version", async () => {
    const sourcePackage = executableSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => Response.json({ value: null }));
    const worker = createArtifactRuntimeWorker();
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };

    const first = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      FLAREX_INTERNAL_TOKEN: "internal-secret",
      FLAREX_INTERNAL_TOKEN_VERSION: "v1",
      FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE: "2026-06-14",
    });
    const second = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      FLAREX_INTERNAL_TOKEN: "internal-secret",
      FLAREX_INTERNAL_TOKEN_VERSION: "v2",
      FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE: "2026-07-02",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(loader.loaded.map(entry => entry.name)).toEqual([
      `v1:${ref.artifactId}:${ref.sourcePackageHash}:compat=2026-06-14:auth=version-v1`,
      `v1:${ref.artifactId}:${ref.sourcePackageHash}:compat=2026-07-02:auth=version-v2`,
    ]);
  });

  it("rejects invalid successful Dynamic Worker invoke JSON", async () => {
    const sourcePackage = executableSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => Response.json({ readTs: 42 }));
    const worker = createArtifactRuntimeWorker();
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid execution artifact runtime invoke response.",
    });
  });

  it("keeps capability-token auth at the deployable wrapper edge", async () => {
    const sourcePackage = testSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const materializer: ExecutionArtifactMaterializer = {
      materialize: async () => {
        throw new Error("materializer should not run for unauthorized requests");
      },
    };
    const worker = createArtifactRuntimeWorker({ materializer });
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload), {
      ARTIFACTS: bucket,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized execution artifact runtime request.",
    });
  });

  it("fails closed when the capability-token secret is missing", async () => {
    const sourcePackage = testSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const worker = createArtifactRuntimeWorker({
      materializer: {
        materialize: async () => {
          throw new Error("materializer should not run when the token secret is missing");
        },
      },
    });
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload), {
      ARTIFACTS: bucket,
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "FLAREX_ARTIFACT_RUNTIME_TOKEN is required for hosted artifact runtime requests.",
    });
  });

  it("fails closed when the Worker Loader binding is missing", async () => {
    const sourcePackage = testSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const worker = createArtifactRuntimeWorker();
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "LOADER worker loader binding is required for hosted artifact runtime requests.",
    });
  });

  it("reports missing source modules before loading a Dynamic Worker", async () => {
    const sourcePackage = sourcePackageWithMissingSource();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => {
      throw new Error("loader should not run when source modules are missing");
    });
    const worker = createArtifactRuntimeWorker();
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Source package module _flarex/execution.js has no source.",
    });
    expect(loader.loaded).toEqual([]);
  });

  it("rejects reserved and duplicate source package module paths before loading", async () => {
    const loader = new FakeWorkerLoader(async () => {
      throw new Error("loader should not run for invalid source package modules");
    });
    const reservedResponse = await invokeWithStoredSourcePackage(
      sourcePackageWithRuntimeModulePath(),
      loader,
    );
    const duplicateResponse = await invokeWithStoredSourcePackage(
      sourcePackageWithDuplicateModulePath(),
      loader,
    );

    expect(reservedResponse.status).toBe(400);
    await expect(reservedResponse.json()).resolves.toEqual({
      error: "Source package module path flarex-runtime-worker.js is reserved by the hosted artifact runtime.",
    });
    expect(duplicateResponse.status).toBe(400);
    await expect(duplicateResponse.json()).resolves.toEqual({
      error: "Source package contains duplicate module path users.js.",
    });
    expect(loader.loaded).toEqual([]);
  });
});

async function invokeWithStoredSourcePackage(
  sourcePackage: PushSourcePackage,
  loader: WorkerLoader,
): Promise<Response> {
  const bucket = new FakeR2Bucket();
  const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
  const worker = createArtifactRuntimeWorker();
  return await worker.fetch(runtimeInvokeRequest({
    deploymentId: "deployment1",
    ref,
    request: {
      path: "users:get",
      kind: "query",
      args: {},
    },
  }, "runtime-secret"), {
    ARTIFACTS: bucket,
    LOADER: loader,
    FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
  });
}

function runtimeInvokeRequest(
  payload: ExecutionArtifactInvokePayload,
  capabilityToken?: string,
): Request {
  return new Request("https://flarex-artifact-runtime.internal/invoke", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-flarex-artifact-id": payload.ref.artifactId,
      "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
      ...(capabilityToken === undefined ? {} : { authorization: `Bearer ${capabilityToken}` }),
    },
    body: JSON.stringify(payload),
  });
}

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

function executableSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: `export default {
  users: {
    get: {
      isQuery: true,
      isPublic: true,
      _handler: async (_ctx, args) => ({ id: args.id }),
    },
  },
};`,
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

function sourcePackageWithMissingSource(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
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

function sourcePackageWithRuntimeModulePath(): PushSourcePackage {
  return {
    modules: [
      {
        path: "flarex-runtime-worker.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: "export default {};",
      },
    ],
    functions: ["flarex-runtime-worker.js"],
    execution: "flarex-runtime-worker.js",
  };
}

function sourcePackageWithDuplicateModulePath(): PushSourcePackage {
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
      {
        path: "users.js",
        environment: "isolate",
        sha256: "c".repeat(64),
        source: "export const getAgain = {};",
      },
    ],
    functions: ["users.js"],
    execution: "_flarex/execution.js",
  };
}

function activeDeployment(
  executionArtifactRef: ActiveDeploymentStatus["executionArtifactRef"],
  sourcePackage: PushSourcePackage,
): ActiveDeploymentStatus {
  return {
    activePushId: "push1",
    activatedAt: 1,
    schemaVersion: 1,
    executionArtifactRef,
    sourcePackage,
    analysis: {
      schema: {
        version: 1,
        tables: [],
        indexes: [],
      },
      functions: {
        functions: [],
      },
    },
    codegenAnalysis: {
      schema: {
        version: 1,
        tables: [],
        indexes: [],
      },
      functions: [],
    },
  };
}

class FakeR2Bucket implements R2BucketLike {
  private readonly objects = new Map<string, string>();

  put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
    return Promise.resolve();
  }

  get(key: string): Promise<{ json<T>(): Promise<T> } | null> {
    const value = this.objects.get(key);
    if (value === undefined) return Promise.resolve(null);
    return Promise.resolve({
      json: <T>() => Promise.resolve(JSON.parse(value) as T),
    });
  }

  delete(key: string | string[]): Promise<void> {
    for (const nextKey of Array.isArray(key) ? key : [key]) {
      this.objects.delete(nextKey);
    }
    return Promise.resolve();
  }
}

type FakeWorkerEntrypoint = {
  fetch(request: Request): Promise<Response>;
};

class FakeWorkerLoader implements WorkerLoader {
  readonly loaded: Array<{
    readonly name: string | null;
    readonly code: WorkerLoaderWorkerCode;
  }> = [];
  private readonly handler: FakeWorkerEntrypoint["fetch"];

  constructor(handler: FakeWorkerEntrypoint["fetch"]) {
    this.handler = handler;
  }

  get(
    name: string | null,
    getCode: () => WorkerLoaderWorkerCode | Promise<WorkerLoaderWorkerCode>,
  ): WorkerStub {
    return new FakeWorkerStub(async request => {
      const code = await getCode();
      if (!this.loaded.some(entry => entry.name === name)) {
        this.loaded.push({ name, code });
      }
      return await this.handler(request);
    });
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loaded.push({ name: null, code });
    return new FakeWorkerStub(request => this.handler(request));
  }
}

class FakeWorkerStub implements WorkerStub {
  private readonly handler: FakeWorkerEntrypoint["fetch"];

  constructor(handler: FakeWorkerEntrypoint["fetch"]) {
    this.handler = handler;
  }

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
    options?: WorkerStubEntrypointOptions,
  ): Fetcher<T> {
    void name;
    void options;
    const fetcher = {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        this.handler(new Request(input, init)),
      connect: () => {
        throw new Error("artifact runtime tests do not use WorkerStub.connect");
      },
    } satisfies Fetcher;
    return fetcher as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>(
    name?: string,
    options?: WorkerStubEntrypointOptions,
  ): DurableObjectClass<T> {
    void name;
    void options;
    throw new Error("artifact runtime tests do not use dynamic Durable Objects");
  }
}
