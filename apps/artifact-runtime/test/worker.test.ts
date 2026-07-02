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

  it("returns an explicit not-implemented boundary until Dynamic Worker materialization is wired", async () => {
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

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: `Hosted artifact runtime materializer is not wired for artifact ${ref.artifactId}.`,
    });
  });
});

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
