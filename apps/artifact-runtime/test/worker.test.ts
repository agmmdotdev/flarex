import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
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

const anonymousIdentity = { kind: "anonymous" } as const;

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

    await expect(backendRuntime.invoke(
      activeDeployment(ref, sourcePackage),
      {
        path: "users:get",
        kind: "query",
        partitionKey: "user:1",
        args: { id: "1:user" },
      },
      anonymousIdentity,
    )).resolves.toEqual({
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
        identity: anonymousIdentity,
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
      identity: anonymousIdentity,
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
      identity: anonymousIdentity,
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
      identity: anonymousIdentity,
      request: {
        path: "users:get",
        kind: "query",
        args: { id: "1:user" },
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: fakeExecutorBinding(),
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
      FLAREX_EXECUTOR_TOKEN_VERSION: "ev1",
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_PROJECT_ID: "project1",
      FLAREX_INVOKE_MAX_ATTEMPTS: "4",
      FLAREX_INTERNAL_TOKEN: "internal-secret",
      FLAREX_INTERNAL_TOKEN_VERSION: "v1",
    });

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
      value: {
        loaded: true,
        body: {
          deploymentId: "deployment1",
          identity: anonymousIdentity,
          path: "users:get",
          kind: "query",
          args: { id: "1:user" },
        },
      },
    });
    expect(loader.loaded).toHaveLength(1);
    expect(loader.loaded[0]).toMatchObject({
      name: `v1:${ref.artifactId}:${ref.sourcePackageHash}:compat=2026-06-14:executor=transport=postgres,project=project1,attempts=4,auth=version-ev1:auth=version-v1`,
      code: {
        compatibilityDate: "2026-06-14",
        mainModule: "flarex-runtime-worker.js",
        env: {
          FLAREX_EXECUTOR: expect.any(Object),
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
          FLAREX_EXECUTOR_TRANSPORT: "postgres",
          FLAREX_INVOKE_MAX_ATTEMPTS: "4",
          FLAREX_INTERNAL_TOKEN: "internal-secret",
          FLAREX_PROJECT_ID: "project1",
        },
        globalOutbound: null,
      },
    });
    expect(Object.keys(loader.loaded[0]!.code.modules).sort()).toEqual([
      "_flarex/execution.js",
      "flarex-runtime-worker.js",
      "users.js",
    ]);
    expect(String(loader.loaded[0]!.code.modules["flarex-runtime-worker.js"]))
      .toContain('"/invoke/syscall"');
    expect(String(loader.loaded[0]!.code.modules["flarex-runtime-worker.js"]))
      .toContain("FLAREX_EXECUTOR service binding is required for hosted Dynamic Worker execution.");
    expect(String(loader.loaded[0]!.code.modules["flarex-runtime-worker.js"]))
      .toContain("runMutation");
  });

  it("executes the generated Dynamic Worker through the executor bridge", async () => {
    const sourcePackage = executableDbSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => Response.json({ value: null }));
    const worker = createArtifactRuntimeWorker();
    const calls: Array<{ readonly path: string; readonly body: unknown; readonly authorization: string | null }> = [];
    const executor = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const body: unknown = await request.json().catch(() => null);
        calls.push({
          path: url.pathname,
          body,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-hosted",
            function: { kind: "query" },
          });
        }
        if (url.pathname === "/invoke/syscall") {
          return Response.json({
            value: {
              page: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
              isDone: true,
            },
          });
        }
        if (url.pathname === "/invoke/finish") {
          return Response.json({
            value: bodyValue(body, "/invoke/finish"),
            readSet: { indexes: [{ indexId: 1 }] },
            readTs: 20,
          });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
      connect: () => {
        throw new Error("artifact runtime tests do not use executor connect");
      },
    } satisfies Fetcher;
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment-hosted",
      ref,
      identity: anonymousIdentity,
      request: {
        path: "messages:list",
        kind: "query",
        args: { lessonId: "1:lesson" },
        partitionKey: "1:lesson",
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: executor,
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_PROJECT_ID: "project-hosted",
      FLAREX_INTERNAL_TOKEN: "internal-secret",
    });

    expect(response.ok).toBe(true);
    expect(loader.loaded).toHaveLength(1);
    const generatedWorker = await importGeneratedDynamicWorker(loader.loaded[0]!);
    const generatedResponse = await generatedWorker.fetch(
      new Request("https://flarex-dynamic-worker.internal/__flarex_internal/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer internal-secret",
        },
        body: JSON.stringify({
          deploymentId: payload.deploymentId,
          identity: payload.identity,
          ...payload.request,
        }),
      }),
      loader.loaded[0]!.code.env,
    );

    expect(generatedResponse.status).toBe(200);
    await expect(generatedResponse.json()).resolves.toEqual({
      value: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
      readSet: { indexes: [{ indexId: 1 }] },
      readTs: 20,
    });
    expect(calls).toEqual([
      {
        path: "/invoke/start",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-hosted",
          projectId: "project-hosted",
          identity: anonymousIdentity,
          path: "messages:list",
          args: { lessonId: "1:lesson" },
          kind: "query",
          visibility: "public",
          partitionKey: "1:lesson",
        },
      },
      {
        path: "/invoke/syscall",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-hosted",
          projectId: "project-hosted",
          sessionId: "session-hosted",
          op: "query",
          request: {
            table: "messages",
            index: "by_lesson",
            range: {
              expressions: [
                { op: "eq", field: "lessonId", value: "1:lesson" },
              ],
            },
          },
        },
      },
      {
        path: "/invoke/finish",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-hosted",
          projectId: "project-hosted",
          sessionId: "session-hosted",
          value: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
        },
      },
    ]);
  });

  it("rejects malformed executor start responses in the generated Dynamic Worker", async () => {
    const sourcePackage = executableDbSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => Response.json({ value: null }));
    const worker = createArtifactRuntimeWorker();
    const executor = {
      fetch: async () => Response.json({ function: { kind: "query" } }),
      connect: () => {
        throw new Error("artifact runtime tests do not use executor connect");
      },
    } satisfies Fetcher;
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment-hosted",
      ref,
      identity: anonymousIdentity,
      request: {
        path: "messages:list",
        kind: "query",
        args: { lessonId: "1:lesson" },
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: executor,
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_PROJECT_ID: "project-hosted",
    });

    expect(response.ok).toBe(true);
    const generatedWorker = await importGeneratedDynamicWorker(loader.loaded[0]!);
    const generatedResponse = await generatedWorker.fetch(
      new Request("https://flarex-dynamic-worker.internal/__flarex_internal/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deploymentId: payload.deploymentId,
          ...payload.request,
        }),
      }),
      loader.loaded[0]!.code.env,
    );

    expect(generatedResponse.status).toBe(400);
    await expect(generatedResponse.json()).resolves.toEqual({
      error: "Executor start response did not include a sessionId.",
    });
  });

  it("rejects executor start responses with the wrong function kind", async () => {
    const sourcePackage = executableMutationSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => Response.json({ value: null }));
    const worker = createArtifactRuntimeWorker();
    const executor = {
      fetch: async () => Response.json({ sessionId: "session-wrong-kind", function: { kind: "query" } }),
      connect: () => {
        throw new Error("artifact runtime tests do not use executor connect");
      },
    } satisfies Fetcher;
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment-wrong-kind",
      ref,
      identity: anonymousIdentity,
      request: {
        path: "messages:create",
        kind: "mutation",
        args: { text: "wrong kind" },
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: executor,
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_PROJECT_ID: "project-wrong-kind",
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      LOADER: loader,
    });

    expect(response.ok).toBe(true);
    const generatedWorker = await importGeneratedDynamicWorker(loader.loaded[0]!);
    const generatedResponse = await generatedWorker.fetch(generatedInvokeRequest(payload), loader.loaded[0]!.code.env);

    expect(generatedResponse.status).toBe(400);
    await expect(generatedResponse.json()).resolves.toEqual({
      error: "Executor start response kind mismatch: expected mutation, got query.",
    });
  });

  it("executes generated Dynamic Worker mutation syscalls", async () => {
    const sourcePackage = executableMutationSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => Response.json({ value: null }));
    const worker = createArtifactRuntimeWorker();
    const calls: Array<{ readonly path: string; readonly body: unknown }> = [];
    const executor = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const body: unknown = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          return Response.json({ sessionId: "session-mutation", function: { kind: "mutation" } });
        }
        if (url.pathname === "/invoke/syscall") {
          return Response.json({ value: "2:created" });
        }
        if (url.pathname === "/invoke/finish") {
          return Response.json({
            value: bodyValue(body, "/invoke/finish"),
            committedTs: 30,
            writes: [{ tableId: 2, id: "2:created", prevTs: null, ts: 30, value: { text: "hello" } }],
          });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
      connect: () => {
        throw new Error("artifact runtime tests do not use executor connect");
      },
    } satisfies Fetcher;
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment-mutation",
      ref,
      identity: anonymousIdentity,
      request: {
        path: "messages:create",
        kind: "mutation",
        args: { text: "hello" },
        partitionKey: "1:lesson",
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: executor,
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_PROJECT_ID: "project-mutation",
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      LOADER: loader,
    });

    expect(response.ok).toBe(true);
    const generatedWorker = await importGeneratedDynamicWorker(loader.loaded[0]!);
    const generatedResponse = await generatedWorker.fetch(generatedInvokeRequest(payload), loader.loaded[0]!.code.env);

    expect(generatedResponse.status).toBe(200);
    await expect(generatedResponse.json()).resolves.toEqual({
      value: "2:created",
      committedTs: 30,
      writes: [{ tableId: 2, id: "2:created", prevTs: null, ts: 30, value: { text: "hello" } }],
    });
    expect(calls).toEqual([
      {
        path: "/invoke/start",
        body: {
          deploymentId: "deployment-mutation",
          projectId: "project-mutation",
          path: "messages:create",
          args: { text: "hello" },
          kind: "mutation",
          visibility: "public",
          partitionKey: "1:lesson",
        },
      },
      {
        path: "/invoke/syscall",
        body: {
          deploymentId: "deployment-mutation",
          projectId: "project-mutation",
          sessionId: "session-mutation",
          op: "insert",
          table: "messages",
          value: { text: "hello" },
        },
      },
      {
        path: "/invoke/finish",
        body: {
          deploymentId: "deployment-mutation",
          projectId: "project-mutation",
          sessionId: "session-mutation",
          value: "2:created",
        },
      },
    ]);
  });

  it("retries and aborts generated Dynamic Worker mutation OCC conflicts", async () => {
    const sourcePackage = executableMutationSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => Response.json({ value: null }));
    const worker = createArtifactRuntimeWorker();
    const calls: Array<{ readonly path: string; readonly body: unknown }> = [];
    let startCount = 0;
    let finishCount = 0;
    const executor = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const body: unknown = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          startCount += 1;
          return Response.json({ sessionId: `session-retry-${startCount}`, function: { kind: "mutation" } });
        }
        if (url.pathname === "/invoke/syscall") {
          return Response.json({ value: `2:created-${startCount}` });
        }
        if (url.pathname === "/invoke/finish") {
          finishCount += 1;
          if (finishCount === 1) {
            return Response.json(
              {
                error: "InvokeSessionOccConflictError",
                message: "Document changed after session begin timestamp.",
              },
              { status: 409 },
            );
          }
          return Response.json({ value: bodyValue(body, "/invoke/finish"), committedTs: 31, writes: [] });
        }
        if (url.pathname === "/invoke/abort") {
          return Response.json({ aborted: true });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
      connect: () => {
        throw new Error("artifact runtime tests do not use executor connect");
      },
    } satisfies Fetcher;
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment-retry",
      ref,
      identity: anonymousIdentity,
      request: {
        path: "messages:create",
        kind: "mutation",
        args: { text: "retry" },
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: executor,
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_INVOKE_MAX_ATTEMPTS: "2",
      FLAREX_PROJECT_ID: "project-retry",
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      LOADER: loader,
    });

    expect(response.ok).toBe(true);
    const generatedWorker = await importGeneratedDynamicWorker(loader.loaded[0]!);
    const generatedResponse = await generatedWorker.fetch(generatedInvokeRequest(payload), loader.loaded[0]!.code.env);

    expect(generatedResponse.status).toBe(200);
    await expect(generatedResponse.json()).resolves.toEqual({
      value: "2:created-2",
      committedTs: 31,
      writes: [],
    });
    expect(calls.map(call => call.path)).toEqual([
      "/invoke/start",
      "/invoke/syscall",
      "/invoke/finish",
      "/invoke/abort",
      "/invoke/start",
      "/invoke/syscall",
      "/invoke/finish",
    ]);
    expect(calls
      .filter(call => call.path === "/invoke/syscall")
      .map(call => bodySessionId(call.body))).toEqual(["session-retry-1", "session-retry-2"]);
  });

  it("executes generated Dynamic Worker nested server-side calls in active sessions", async () => {
    const sourcePackage = executableNestedSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => Response.json({ value: null }));
    const worker = createArtifactRuntimeWorker();
    const calls: Array<{ readonly path: string; readonly body: unknown }> = [];
    const executor = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const body: unknown = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          const pathValue = bodyPath(body);
          return Response.json({
            sessionId: pathValue === "messages:outerMutation" ? "session-nested-mutation" : "session-nested-query",
            function: { kind: pathValue === "messages:outerMutation" ? "mutation" : "query" },
          });
        }
        if (url.pathname === "/invoke/syscall") {
          const op = bodyOp(body);
          return Response.json({
            value: op === "insert" ? "2:nested-created" : { _id: "2:nested", text: "nested query" },
          });
        }
        if (url.pathname === "/invoke/finish") {
          return Response.json({ value: bodyValue(body, "/invoke/finish"), readSet: {}, readTs: 40 });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
      connect: () => {
        throw new Error("artifact runtime tests do not use executor connect");
      },
    } satisfies Fetcher;
    const queryPayload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment-nested",
      ref,
      identity: anonymousIdentity,
      request: {
        path: "messages:outerQuery",
        kind: "query",
        args: {},
      },
    };
    const mutationPayload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment-nested",
      ref,
      identity: anonymousIdentity,
      request: {
        path: "messages:outerMutation",
        kind: "mutation",
        args: {},
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(queryPayload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: executor,
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_PROJECT_ID: "project-nested",
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      LOADER: loader,
    });

    expect(response.ok).toBe(true);
    const generatedWorker = await importGeneratedDynamicWorker(loader.loaded[0]!);
    await expect(
      generatedWorker.fetch(generatedInvokeRequest(queryPayload), loader.loaded[0]!.code.env)
        .then(result => result.json()),
    ).resolves.toEqual({ value: { _id: "2:nested", text: "nested query" }, readSet: {}, readTs: 40 });
    await expect(
      generatedWorker.fetch(generatedInvokeRequest(mutationPayload), loader.loaded[0]!.code.env)
        .then(result => result.json()),
    ).resolves.toEqual({ value: "2:nested-created", readSet: {}, readTs: 40 });
    expect(calls.map(call => call.path)).toEqual([
      "/invoke/start",
      "/invoke/syscall",
      "/invoke/finish",
      "/invoke/start",
      "/invoke/syscall",
      "/invoke/finish",
    ]);
    expect(calls
      .filter(call => call.path === "/invoke/syscall")
      .map(call => bodyOp(call.body))).toEqual(["get", "insert"]);
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
      identity: anonymousIdentity,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };

    const first = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: fakeExecutorBinding(),
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
      FLAREX_EXECUTOR_TOKEN_VERSION: "ev1",
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_PROJECT_ID: "project1",
      FLAREX_INTERNAL_TOKEN: "internal-secret",
      FLAREX_INTERNAL_TOKEN_VERSION: "v1",
      FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE: "2026-06-14",
    });
    const second = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: fakeExecutorBinding(),
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
      FLAREX_EXECUTOR_TOKEN_VERSION: "ev2",
      FLAREX_EXECUTOR_TRANSPORT: "postgres",
      FLAREX_PROJECT_ID: "project2",
      FLAREX_INTERNAL_TOKEN: "internal-secret",
      FLAREX_INTERNAL_TOKEN_VERSION: "v2",
      FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE: "2026-07-02",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(loader.loaded.map(entry => entry.name)).toEqual([
      `v1:${ref.artifactId}:${ref.sourcePackageHash}:compat=2026-06-14:executor=transport=postgres,project=project1,attempts=default,auth=version-ev1:auth=version-v1`,
      `v1:${ref.artifactId}:${ref.sourcePackageHash}:compat=2026-07-02:executor=transport=postgres,project=project2,attempts=default,auth=version-ev2:auth=version-v2`,
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
      identity: anonymousIdentity,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: fakeExecutorBinding(),
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
      identity: anonymousIdentity,
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
      identity: anonymousIdentity,
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
      identity: anonymousIdentity,
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

  it("fails closed when the executor service binding is missing", async () => {
    const sourcePackage = testSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => {
      throw new Error("loader should not run when the executor binding is missing");
    });
    const worker = createArtifactRuntimeWorker();
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: "deployment1",
      ref,
      identity: anonymousIdentity,
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
      error: "FLAREX_EXECUTOR service binding is required for hosted Dynamic Worker execution.",
    });
    expect(loader.loaded).toEqual([]);
  });

  it("fails closed when hosted executor transport is unsupported", async () => {
    const sourcePackage = testSourcePackage();
    const bucket = new FakeR2Bucket();
    const ref = await new R2BackendExecutionArtifactStore(bucket).put(sourcePackage);
    const loader = new FakeWorkerLoader(async () => {
      throw new Error("loader should not run when executor transport is unsupported");
    });
    const worker = createArtifactRuntimeWorker();

    const response = await worker.fetch(runtimeInvokeRequest({
      deploymentId: "deployment1",
      ref,
      identity: anonymousIdentity,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    }, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: fakeExecutorBinding(),
      FLAREX_EXECUTOR_TRANSPORT: "other",
      LOADER: loader,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported Flarex executor transport: other",
    });
    expect(loader.loaded).toEqual([]);
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
      identity: anonymousIdentity,
      request: {
        path: "users:get",
        kind: "query",
        args: {},
      },
    };

    const response = await worker.fetch(runtimeInvokeRequest(payload, "runtime-secret"), {
      ARTIFACTS: bucket,
      FLAREX_EXECUTOR: fakeExecutorBinding(),
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
    identity: anonymousIdentity,
    request: {
      path: "users:get",
      kind: "query",
      args: {},
    },
  }, "runtime-secret"), {
    ARTIFACTS: bucket,
    FLAREX_EXECUTOR: fakeExecutorBinding(),
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

function executableDbSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: `export default {
  messages: {
    list: {
      isQuery: true,
      isPublic: true,
      _handler: async (ctx, args) => {
        return await ctx.db
          .query("messages")
          .withIndex("by_lesson", q => q.eq("lessonId", args.lessonId))
          .collect();
      },
    },
  },
};`,
      },
      {
        path: "messages.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export const list = {};",
      },
    ],
    functions: ["messages.js"],
    execution: "_flarex/execution.js",
  };
}

function executableMutationSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: `export default {
  messages: {
    create: {
      isMutation: true,
      isPublic: true,
      _handler: async (ctx, args) => {
        return await ctx.db.insert("messages", { text: args.text });
      },
    },
  },
};`,
      },
      {
        path: "messages.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export const create = {};",
      },
    ],
    functions: ["messages.js"],
    execution: "_flarex/execution.js",
  };
}

function executableNestedSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: `const helperQueryRef = { _path: "messages:helperQuery" };
const helperMutationRef = { _path: "messages:helperMutation" };

export default {
  messages: {
    helperQuery: {
      isQuery: true,
      isInternal: true,
      _handler: async (ctx) => await ctx.db.get("2:nested"),
    },
    outerQuery: {
      isQuery: true,
      isPublic: true,
      _handler: async (ctx) => await ctx.runQuery(helperQueryRef, {}),
    },
    helperMutation: {
      isMutation: true,
      isInternal: true,
      _handler: async (ctx) => await ctx.db.insert("messages", { text: "nested mutation" }),
    },
    outerMutation: {
      isMutation: true,
      isPublic: true,
      _handler: async (ctx) => await ctx.runMutation(helperMutationRef, {}),
    },
  },
};`,
      },
      {
        path: "messages.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export const outerQuery = {}; export const outerMutation = {};",
      },
    ],
    functions: ["messages.js"],
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

function fakeExecutorBinding(): Fetcher {
  return {
    fetch: () => Promise.resolve(Response.json({ error: "unexpected executor call" }, { status: 500 })),
    connect: () => {
      throw new Error("artifact runtime tests do not use executor connect");
    },
  } satisfies Fetcher;
}

type GeneratedDynamicWorker = {
  readonly fetch: (request: Request, env: unknown) => Promise<Response>;
};

async function importGeneratedDynamicWorker(
  entry: { readonly code: WorkerLoaderWorkerCode },
): Promise<GeneratedDynamicWorker> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-hosted-dynamic-worker-"));
  for (const [modulePath, source] of Object.entries(entry.code.modules)) {
    if (typeof source !== "string") {
      throw new Error(`Generated Dynamic Worker module ${modulePath} is not string source.`);
    }
    const destination = path.join(root, modulePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, source);
  }
  const moduleUrl = `${pathToFileURL(path.join(root, "flarex-runtime-worker.js")).href}?cache=${Date.now()}`;
  const module: unknown = await import(moduleUrl);
  if (!isGeneratedDynamicWorkerModule(module)) {
    throw new Error("Generated Dynamic Worker module did not export a fetch handler.");
  }
  return module.default;
}

function generatedInvokeRequest(payload: ExecutionArtifactInvokePayload): Request {
  return new Request("https://flarex-dynamic-worker.internal/__flarex_internal/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deploymentId: payload.deploymentId,
      ...payload.request,
    }),
  });
}

function isGeneratedDynamicWorkerModule(value: unknown): value is { readonly default: GeneratedDynamicWorker } {
  if (!isRecord(value)) return false;
  const defaultExport = value.default;
  return isRecord(defaultExport) && typeof defaultExport.fetch === "function";
}

function bodyValue(body: unknown, context: string): unknown {
  if (isRecord(body) && "value" in body) return body.value;
  throw new Error(`${context} body is missing value.`);
}

function bodySessionId(body: unknown): unknown {
  if (isRecord(body) && "sessionId" in body) return body.sessionId;
  throw new Error("Body is missing sessionId.");
}

function bodyPath(body: unknown): unknown {
  if (isRecord(body) && "path" in body) return body.path;
  throw new Error("Body is missing path.");
}

function bodyOp(body: unknown): unknown {
  if (isRecord(body) && "op" in body) return body.op;
  throw new Error("Body is missing op.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
