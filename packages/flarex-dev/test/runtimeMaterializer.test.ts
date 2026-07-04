import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { deploymentAnalysisFromCodegenAnalysisEffect } from "@flarex/analysis";
import {
  createExecutionArtifactRuntimeService,
  type ExecutionArtifactMaterializer,
  type MaterializedExecutionArtifactPayload,
  type MaterializedExecutionArtifact,
} from "flarex-backend/artifact-runtime";
import {
  R2BackendExecutionArtifactStore,
  type R2BucketLike,
} from "flarex-backend/artifact-store";
import { afterAll, describe, expect, it } from "vitest";
import {
  ANALYZED_START_TEST_AUTHORIZATION,
  createBackendHarness,
  type BackendHarness,
} from "flarex-backend/test/backendHarness";
import type { DeploymentAnalysis } from "../src/analyze";
import { LocalMiniflareExecutionArtifactAdapter } from "../src/executionArtifact";
import {
  bundleFlarexSourcePackage,
  initialCodegen,
} from "../src/generate";
import {
  createMaterializedArtifactLiveQueryExecutionHost,
  decodeMaterializedArtifactResponse,
  LocalMiniflareExecutionArtifactMaterializer,
  MaterializedArtifactResponseError,
} from "../src/runtimeMaterializer";
import type { PushSourcePackage } from "flarex-backend/types";

function backendAnalysisFromCodegenAnalysis(analysis: DeploymentAnalysis) {
  return Effect.runSync(deploymentAnalysisFromCodegenAnalysisEffect(analysis));
}
import type {
  InvokeAttemptContext,
  RunLiveQuerySubscriptionWithInvokeInput,
} from "@flarex/executor";
import type { ExecutionIdentity } from "flarex-protocol/auth";

type LiveQuerySubscriptionForInvokeHost =
  Parameters<RunLiveQuerySubscriptionWithInvokeInput["executeQuery"]>[1];

describe("runtime materializer", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
  });

  it("decodes materialized artifact responses through typed Effect failures", async () => {
    await expect(Effect.runPromise(
      decodeMaterializedArtifactResponse<{ value: { ok: true } }>(
        Response.json({ value: { ok: true } }),
        "Materialized execution artifact failed",
      ),
    )).resolves.toEqual({ value: { ok: true } });

    await expect(Effect.runPromise(
      decodeMaterializedArtifactResponse(
        Response.json({ error: "artifact failed" }, { status: 409 }),
        "Materialized execution artifact failed",
      ),
    )).rejects.toMatchObject({
      _tag: "MaterializedArtifactResponseError",
      status: 409,
      message: "artifact failed",
      body: { error: "artifact failed" },
    } satisfies Partial<MaterializedArtifactResponseError>);

    await expect(Effect.runPromise(
      decodeMaterializedArtifactResponse(
        new Response("not json", { status: 502 }),
        "Materialized execution artifact failed",
      ),
    )).rejects.toMatchObject({
      _tag: "MaterializedArtifactResponseError",
      status: 502,
      message: "Materialized execution artifact failed with status 502",
      body: null,
    } satisfies Partial<MaterializedArtifactResponseError>);
  });

  it("validates local source package module maps before creating Miniflare artifacts", async () => {
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      backend: async () => Response.json({ error: "backend should not run" }, { status: 500 }),
    });

    await expect(
      materializer.materialize(payloadWithSourceModules([
        ...indexedQueryPayload().sourcePackage.modules,
        {
          path: "worker.js",
          environment: "isolate",
          sha256: "k".repeat(64),
          source: "export const reserved = true;",
        },
      ])),
    ).rejects.toThrow(
      "Source package module path worker.js is reserved by the local execution artifact runtime.",
    );

    await expect(
      materializer.materialize(payloadWithSourceModules([
        ...indexedQueryPayload().sourcePackage.modules,
        {
          path: "_flarex/execution.js",
          environment: "isolate",
          sha256: "l".repeat(64),
          source: "export const duplicate = true;",
        },
      ])),
    ).rejects.toThrow("Source package contains duplicate module path _flarex/execution.js.");

    await expect(
      materializer.materialize(payloadWithSourceModules(
        indexedQueryPayload().sourcePackage.modules.map(module =>
          module.path === "_flarex/execution.js"
            ? {
                path: module.path,
                environment: module.environment,
                sha256: module.sha256,
              }
            : module,
        ),
      )),
    ).rejects.toThrow("Source package module _flarex/execution.js has no source.");
  });

  it("materializes a stored source package and invokes it through backend sessions", async () => {
    const root = await createProject();
    const context = await initialCodegen({ root });
    const sourcePackage = await bundleFlarexSourcePackage(context);
    const codegenAnalysis = await new LocalMiniflareExecutionArtifactAdapter()
      .analyze(sourcePackage);
    const analysis = backendAnalysisFromCodegenAnalysis(codegenAnalysis);

    let harness!: BackendHarness;
    let materializeCount = 0;
    const artifactStore = {
      put: async (package_: typeof sourcePackage) =>
        new R2BackendExecutionArtifactStore(
          (await harness.mf.getR2Bucket("ARTIFACTS")) as unknown as R2BucketLike,
        ).put(package_),
      get: async (ref: Parameters<R2BackendExecutionArtifactStore["get"]>[0]) =>
        new R2BackendExecutionArtifactStore(
          (await harness.mf.getR2Bucket("ARTIFACTS")) as unknown as R2BucketLike,
        ).get(ref),
    };
    const baseMaterializer = new LocalMiniflareExecutionArtifactMaterializer({
      internalToken: "artifact-internal",
      backend: request => dispatchBackend(harness, request),
    });
    const materializer: ExecutionArtifactMaterializer = {
      materialize: async (
        payload: MaterializedExecutionArtifactPayload,
      ): Promise<MaterializedExecutionArtifact> => {
        materializeCount += 1;
        return baseMaterializer.materialize(payload);
      },
    };

    harness = await createBackendHarness({
      bindings: {
        FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
        FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE: "true",
      },
      r2Buckets: ["ARTIFACTS"],
      serviceBindings: {
        FLAREX_ARTIFACT_RUNTIME: createExecutionArtifactRuntimeService({
          capabilityToken: "runtime-secret",
          materializer,
          store: artifactStore,
        }),
      },
    });
    harnesses.push(harness);

    const deploymentId = "runtime-materializer";
    const start = await startPush(harness, deploymentId, {
      sourcePackage,
      analysis,
    });
    const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
    await new R2BackendExecutionArtifactStore(bucket as unknown as R2BucketLike).put(sourcePackage);
    await finishPush(harness, deploymentId, start.pushId);

    const created = await invoke(harness, deploymentId, {
      path: "messages:create",
      kind: "mutation",
      partitionKey: "1:lesson",
      args: { lessonId: "1:lesson", text: "hello" },
    });
    const createBody = await created.json() as {
      value: { id: string };
      committedTs: number;
      writes: Array<{ value: { lessonId: string; text: string; done: boolean } }>;
    };
    expect({ status: created.status, body: createBody }).toMatchObject({ status: 200 });
    expect(createBody.value.id).toMatch(/^2:/);
    expect(createBody.writes).toEqual([
      expect.objectContaining({
        value: { lessonId: "1:lesson", text: "hello", done: true },
      }),
    ]);

    const listed = await invoke(harness, deploymentId, {
      path: "messages:list",
      kind: "query",
      partitionKey: "1:lesson",
      args: { lessonId: "1:lesson" },
    });
    const listBody = await listed.json();
    expect({ status: listed.status, body: listBody }).toMatchObject({ status: 200 });
    expect(listBody).toMatchObject({
      value: [
        {
          _id: createBody.value.id,
          lessonId: "1:lesson",
          text: "hello",
          done: true,
        },
      ],
    });
    expect(materializeCount).toBe(1);
  });

  it("materializes create-root mutations without caller partition keys", async () => {
    const root = await createCreateRootProject();
    const context = await initialCodegen({ root });
    const sourcePackage = await bundleFlarexSourcePackage(context);
    const codegenAnalysis = await new LocalMiniflareExecutionArtifactAdapter()
      .analyze(sourcePackage);
    const analysis = backendAnalysisFromCodegenAnalysis(codegenAnalysis);

    let harness!: BackendHarness;
    const artifactStore = {
      put: async (package_: typeof sourcePackage) =>
        new R2BackendExecutionArtifactStore(
          (await harness.mf.getR2Bucket("ARTIFACTS")) as unknown as R2BucketLike,
        ).put(package_),
      get: async (ref: Parameters<R2BackendExecutionArtifactStore["get"]>[0]) =>
        new R2BackendExecutionArtifactStore(
          (await harness.mf.getR2Bucket("ARTIFACTS")) as unknown as R2BucketLike,
        ).get(ref),
    };
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      internalToken: "artifact-internal",
      backend: request => dispatchBackend(harness, request),
    });

    harness = await createBackendHarness({
      bindings: {
        FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
        FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE: "true",
      },
      r2Buckets: ["ARTIFACTS"],
      serviceBindings: {
        FLAREX_ARTIFACT_RUNTIME: createExecutionArtifactRuntimeService({
          capabilityToken: "runtime-secret",
          materializer,
          store: artifactStore,
        }),
      },
    });
    harnesses.push(harness);

    const deploymentId = "runtime-materializer-create-root";
    const start = await startPush(harness, deploymentId, {
      sourcePackage,
      analysis,
    });
    const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
    await new R2BackendExecutionArtifactStore(bucket as unknown as R2BucketLike).put(sourcePackage);
    await finishPush(harness, deploymentId, start.pushId);

    const created = await invoke(harness, deploymentId, {
      path: "users:create",
      kind: "mutation",
      args: { name: "Ada" },
    });
    const createBody = await created.json() as {
      value: { userId: string; profileId: string };
      writes: Array<{ tableId: number; id: string; value: unknown }>;
    };

    expect({ status: created.status, body: createBody }).toMatchObject({ status: 200 });
    expect(createBody.value.userId).toMatch(/^2:/);
    expect(createBody.value.profileId).toMatch(/^1:/);
    expect(createBody.writes).toEqual([
      expect.objectContaining({
        tableId: 2,
        id: createBody.value.userId,
        value: { name: "Ada" },
      }),
      expect.objectContaining({
        tableId: 1,
        id: createBody.value.profileId,
        value: { userId: createBody.value.userId, bio: "Hello" },
      }),
    ]);
  });

  it("emits Convex-style indexed query syscalls from materialized artifacts", async () => {
    const syscalls: unknown[] = [];
    const finishes: unknown[] = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        if (url.pathname === "/deployments/deployment-index/executions/start") {
          return Response.json({ sessionId: "session-index", kind: "query" });
        }
        if (url.pathname === "/deployments/deployment-index/executions/session-index/syscall") {
          syscalls.push(body);
          return Response.json({
            page: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
            isDone: true,
            continueCursor: "cursor-index",
          });
        }
        if (url.pathname === "/deployments/deployment-index/executions/session-index/finish") {
          finishes.push(body);
          return Response.json({ value: (body as { value: unknown }).value });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = indexedQueryPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).resolves.toEqual({
        value: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
      });
    } finally {
      await artifact.dispose?.();
    }

    expect(syscalls).toEqual([
      {
        op: "query",
        request: {
          table: "messages",
          index: "by_lesson_text",
          range: {
            expressions: [
              { op: "eq", field: "lessonId", value: "1:lesson" },
              { op: "eq", field: "text", value: "hello" },
            ],
          },
          limit: 2,
        },
      },
    ]);
    expect(finishes).toEqual([
      { value: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }] },
    ]);
  });

  it("emits replace syscalls from materialized mutation artifacts", async () => {
    const syscalls: unknown[] = [];
    const finishes: unknown[] = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        if (url.pathname === "/deployments/deployment-replace/executions/start") {
          return Response.json({ sessionId: "session-replace", kind: "mutation" });
        }
        if (url.pathname === "/deployments/deployment-replace/executions/session-replace/syscall") {
          syscalls.push(body);
          return Response.json(null);
        }
        if (url.pathname === "/deployments/deployment-replace/executions/session-replace/finish") {
          finishes.push(body);
          return Response.json({ value: (body as { value: unknown }).value });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = replaceMutationPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).resolves.toEqual({
        value: { replaced: true },
      });
    } finally {
      await artifact.dispose?.();
    }

    expect(syscalls).toEqual([
      {
        op: "replace",
        id: "2:message",
        value: { lessonId: "1:lesson", text: "final", done: true },
      },
    ]);
    expect(finishes).toEqual([{ value: { replaced: true } }]);
  });

  it("can target Postgres executor invoke routes from materialized artifacts", async () => {
    const calls: Array<{ path: string; body: unknown; authorization: string | null }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-index",
      executorToken: "executor-secret",
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        calls.push({
          path: url.pathname,
          body,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-index",
            function: { path: "messages:list", kind: "query" },
            beginTs: 1,
            schemaVersion: 1,
            scope: { kind: "partition", partitionKey: "1:lesson" },
            executionModule: "_flarex/execution.js",
          });
        }
        if (url.pathname === "/invoke/syscall") {
          return Response.json({
            value: {
              page: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
              isDone: true,
              continueCursor: "cursor-index",
            },
            readSet: { indexes: [{ indexId: 1 }] },
          });
        }
        if (url.pathname === "/invoke/finish") {
          return Response.json({
            value: (body as { value: unknown }).value,
            readSet: { indexes: [{ indexId: 1 }] },
          });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = indexedQueryPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).resolves.toEqual({
        value: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
        readSet: { indexes: [{ indexId: 1 }] },
      });
    } finally {
      await artifact.dispose?.();
    }

    expect(calls).toEqual([
      {
        path: "/invoke/start",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-index",
          projectId: "project-index",
          path: "messages:list",
          args: { lessonId: "1:lesson" },
          identity: { kind: "anonymous" },
          kind: "query",
          visibility: "public",
          partitionKey: "1:lesson",
        },
      },
      {
        path: "/invoke/syscall",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-index",
          projectId: "project-index",
          sessionId: "session-index",
          op: "query",
          request: {
            table: "messages",
            index: "by_lesson_text",
            range: {
              expressions: [
                { op: "eq", field: "lessonId", value: "1:lesson" },
                { op: "eq", field: "text", value: "hello" },
              ],
            },
            limit: 2,
          },
        },
      },
      {
        path: "/invoke/finish",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-index",
          projectId: "project-index",
          sessionId: "session-index",
          value: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
        },
      },
    ]);
  });

  it("forwards internal visibility for internal materialized artifact invokes", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-internal",
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-internal",
            function: { path: "messages:internalList", kind: "query" },
            beginTs: 1,
            schemaVersion: 1,
            scope: { kind: "partition", partitionKey: "1:lesson" },
            executionModule: "_flarex/execution.js",
          });
        }
        if (url.pathname === "/invoke/finish") {
          return Response.json({ value: finishValue(body) });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = internalQueryPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).resolves.toEqual({ value: "secret" });
    } finally {
      await artifact.dispose?.();
    }

    expect(calls).toEqual([
      {
        path: "/invoke/start",
        body: {
          deploymentId: "deployment-internal",
          projectId: "project-internal",
          path: "messages:internalList",
          args: { lessonId: "1:lesson" },
          identity: { kind: "anonymous" },
          kind: "query",
          visibility: "internal",
          partitionKey: "1:lesson",
        },
      },
      {
        path: "/invoke/finish",
        body: {
          deploymentId: "deployment-internal",
          projectId: "project-internal",
          sessionId: "session-internal",
          value: "secret",
        },
      },
    ]);
  });

  it("rejects materialized functions without exactly one visibility marker before backend start", async () => {
    const cases = [
      {
        name: "missing visibility marker",
        extraMarkers: "",
      },
      {
        name: "ambiguous visibility markers",
        extraMarkers: "isPublic: true,\n      isInternal: true,",
      },
    ] as const;

    for (const testCase of cases) {
      const calls: string[] = [];
      const materializer = new LocalMiniflareExecutionArtifactMaterializer({
        executorTransport: "postgres",
        projectId: `project-${testCase.name.replaceAll(" ", "-")}`,
        backend: async (request) => {
          calls.push(new URL(request.url).pathname);
          return Response.json({ error: "backend should not be called" }, { status: 500 });
        },
      });
      const payload = malformedVisibilityPayload(testCase.extraMarkers);
      const artifact = await materializer.materialize(payload);
      try {
        await expect(artifact.invoke(payload)).rejects.toThrow(
          "Flarex function must be exactly one of public or internal.",
        );
      } finally {
        await artifact.dispose?.();
      }
      expect(calls).toEqual([]);
    }
  });

  it("executes nested server-side query calls in the active session", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-nested",
      backend: async (request) => {
        const url = new URL(request.url);
        const body: unknown = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-nested",
            function: { path: "messages:usesRunQuery", kind: "query" },
          });
        }
        if (url.pathname === "/invoke/syscall") {
          return Response.json({
            value: { _id: "2:message", text: "nested" },
          });
        }
        if (url.pathname === "/invoke/finish") {
          const record = jsonRecord(body, "/invoke/finish");
          return Response.json({
            value: record.value,
            readSet: { documents: [{ tableId: 2, id: "2:message", observedTs: 10 }] },
            readTs: 20,
          });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = nestedRunQueryPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).resolves.toEqual({
        value: { _id: "2:message", text: "nested" },
        readSet: { documents: [{ tableId: 2, id: "2:message", observedTs: 10 }] },
        readTs: 20,
      });
    } finally {
      await artifact.dispose?.();
    }

    expect(calls).toEqual([
      {
        path: "/invoke/start",
        body: {
          deploymentId: "deployment-nested",
          projectId: "project-nested",
          path: "messages:usesRunQuery",
          args: { lessonId: "1:lesson" },
          identity: { kind: "anonymous" },
          kind: "query",
          visibility: "public",
          partitionKey: "1:lesson",
        },
      },
      {
        path: "/invoke/syscall",
        body: {
          deploymentId: "deployment-nested",
          projectId: "project-nested",
          sessionId: "session-nested",
          op: "get",
          id: "2:message",
        },
      },
      {
        path: "/invoke/finish",
        body: {
          deploymentId: "deployment-nested",
          projectId: "project-nested",
          sessionId: "session-nested",
          value: { _id: "2:message", text: "nested" },
        },
      },
    ]);
  });

  it("executes nested server-side mutation calls in the active session", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-nested-mutation",
      backend: async (request) => {
        const url = new URL(request.url);
        const body: unknown = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-nested-mutation",
            function: { path: "messages:usesRunMutation", kind: "mutation" },
          });
        }
        if (url.pathname === "/invoke/syscall") {
          return Response.json({ value: "2:created" });
        }
        if (url.pathname === "/invoke/finish") {
          const record = jsonRecord(body, "/invoke/finish");
          return Response.json({
            value: record.value,
            committedTs: 30,
            writes: [{ tableId: 2, id: "2:created", prevTs: null, ts: 30, value: { text: "nested" } }],
          });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = nestedRunMutationPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).resolves.toEqual({
        value: "2:created",
        committedTs: 30,
        writes: [{ tableId: 2, id: "2:created", prevTs: null, ts: 30, value: { text: "nested" } }],
      });
    } finally {
      await artifact.dispose?.();
    }

    expect(calls).toEqual([
      {
        path: "/invoke/start",
        body: {
          deploymentId: "deployment-nested-mutation",
          projectId: "project-nested-mutation",
          path: "messages:usesRunMutation",
          args: { lessonId: "1:lesson" },
          identity: { kind: "anonymous" },
          kind: "mutation",
          visibility: "public",
          partitionKey: "1:lesson",
        },
      },
      {
        path: "/invoke/syscall",
        body: {
          deploymentId: "deployment-nested-mutation",
          projectId: "project-nested-mutation",
          sessionId: "session-nested-mutation",
          op: "insert",
          table: "messages",
          value: { text: "nested" },
        },
      },
      {
        path: "/invoke/finish",
        body: {
          deploymentId: "deployment-nested-mutation",
          projectId: "project-nested-mutation",
          sessionId: "session-nested-mutation",
          value: "2:created",
        },
      },
    ]);
  });

  it("executes nested query calls during live-query reruns without starting a session", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-live-nested",
      backend: async (request) => {
        const url = new URL(request.url);
        const body: unknown = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/syscall") {
          return Response.json({
            value: { _id: "2:message", text: "nested" },
          });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = nestedRunQueryPayload();
    const artifact = await materializer.materialize(payload);
    const executeQuery = createMaterializedArtifactLiveQueryExecutionHost({
      artifact,
      payload,
      projectId: "project-live-nested",
    });
    const attempt: InvokeAttemptContext = {
      attempt: 1,
      maxAttempts: 1,
      session: {
        sessionId: "session-live-nested",
        beginTs: 20,
        identity: { kind: "anonymous" },
        schemaVersion: 1,
        function: { path: "messages:usesRunQuery", kind: "query" },
        scope: {
          kind: "partition",
          table: "lessons",
          selector: "byId",
          partitionField: "_id",
          argField: "lessonId",
          partitionKey: "1:lesson",
        },
        executionModule: "_flarex/execution.js",
      },
      syscall: async () => {
        throw new Error("live-query nested-call test should not use host syscalls");
      },
    };
    const subscription: LiveQuerySubscriptionForInvokeHost = {
      deploymentId: "deployment-nested",
      connectionId: "connection-live-nested",
      queryId: 2,
      functionPath: "messages:usesRunQuery",
      argsJson: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      beginTs: 10,
      identityJson: { kind: "anonymous" },
      readSetJson: {},
      resultJson: [],
      resultHash: "previous",
      createdAt: new Date("2026-06-21T00:00:00.000Z"),
      updatedAt: new Date("2026-06-21T00:00:00.000Z"),
    };

    try {
      await expect(executeQuery(attempt, subscription)).resolves.toEqual({
        _id: "2:message",
        text: "nested",
      });
    } finally {
      await artifact.dispose?.();
    }

    expect(calls).toEqual([
      {
        path: "/invoke/syscall",
        body: {
          deploymentId: "deployment-nested",
          projectId: "project-live-nested",
          sessionId: "session-live-nested",
          op: "get",
          id: "2:message",
        },
      },
    ]);
  });

  it("rejects nested mutation calls from a query context", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-query-nested-mutation",
      backend: async (request) => {
        const url = new URL(request.url);
        const body: unknown = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-query-nested-mutation",
            function: { path: "messages:queryCallsMutation", kind: "query" },
          });
        }
        if (url.pathname === "/invoke/abort") {
          return Response.json({ aborted: true });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = queryCallsNestedMutationPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).rejects.toThrow(
        "Cannot run mutation during a query.",
      );
    } finally {
      await artifact.dispose?.();
    }

    expect(calls.map(call => call.path)).toEqual(["/invoke/start", "/invoke/abort"]);
  });

  it("rejects recursive nested server-side calls before stack overflow", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-nested-recursive",
      backend: async (request) => {
        const url = new URL(request.url);
        const body: unknown = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-nested-recursive",
            function: { path: "messages:recursive", kind: "query" },
          });
        }
        if (url.pathname === "/invoke/abort") {
          return Response.json({ aborted: true });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = recursiveNestedQueryPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).rejects.toThrow(
        "Maximum nested function call depth exceeded.",
      );
    } finally {
      await artifact.dispose?.();
    }

    expect(calls.map(call => call.path)).toEqual(["/invoke/start", "/invoke/abort"]);
  });

  it("executes live-query reruns against an existing Postgres invoke session", async () => {
    const calls: Array<{ path: string; body: unknown; authorization: string | null }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-live",
      executorToken: "executor-secret",
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        calls.push({
          path: url.pathname,
          body,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname === "/invoke/syscall") {
          return Response.json({
            value: {
              page: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
              isDone: true,
              continueCursor: "cursor-live",
            },
            readSet: { indexes: [{ indexId: 1 }] },
          });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = indexedQueryPayload();
    const artifact = await materializer.materialize(payload);
    const executeQuery = createMaterializedArtifactLiveQueryExecutionHost({
      artifact,
      payload,
      projectId: "project-live",
    });
    const attempt: InvokeAttemptContext = {
      attempt: 1,
      maxAttempts: 1,
      session: {
        sessionId: "session-live",
        beginTs: 20,
        identity: { kind: "anonymous" },
        schemaVersion: 1,
        function: { path: "messages:list", kind: "query" },
        scope: {
          kind: "partition",
          table: "lessons",
          selector: "byId",
          partitionField: "_id",
          argField: "lessonId",
          partitionKey: "1:lesson",
        },
        executionModule: "_flarex/execution.js",
      },
      syscall: async () => {
        throw new Error("live-query execution host should use the artifact db bridge");
      },
    };
    const subscription: LiveQuerySubscriptionForInvokeHost = {
      deploymentId: "deployment-index",
      connectionId: "connection-live",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      beginTs: 10,
      identityJson: { kind: "anonymous" },
      readSetJson: {},
      resultJson: [],
      resultHash: "previous",
      createdAt: new Date("2026-06-21T00:00:00.000Z"),
      updatedAt: new Date("2026-06-21T00:00:00.000Z"),
    };

    try {
      await expect(executeQuery(attempt, subscription)).resolves.toEqual([
        { _id: "2:message", lessonId: "1:lesson", text: "hello" },
      ]);
    } finally {
      await artifact.dispose?.();
    }

    expect(calls).toEqual([
      {
        path: "/invoke/syscall",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-index",
          projectId: "project-live",
          sessionId: "session-live",
          op: "query",
          request: {
            table: "messages",
            index: "by_lesson_text",
            range: {
              expressions: [
                { op: "eq", field: "lessonId", value: "1:lesson" },
                { op: "eq", field: "text", value: "hello" },
              ],
            },
            limit: 2,
          },
        },
      },
    ]);
  });

  it("exposes session identity through ctx.auth in materialized queries and mutations", async () => {
    const calls: Array<{ path: string; body: unknown; authorization: string | null }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-auth",
      executorToken: "executor-secret",
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        calls.push({
          path: url.pathname,
          body,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname === "/invoke/start") {
          const record = jsonRecord(body, "/invoke/start");
          return Response.json({
            sessionId: `session-${String(record.kind)}`,
            function: { path: record.path, kind: record.kind },
            beginTs: 1,
            schemaVersion: 1,
            scope: { kind: "partition", partitionKey: "auth" },
            executionModule: "_flarex/execution.js",
            identity: record.identity,
          });
        }
        if (url.pathname === "/invoke/finish") {
          return Response.json({ value: finishValue(body) });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const queryPayload = authPayload("query");
    const mutationPayload = authPayload("mutation");
    const queryArtifact = await materializer.materialize(queryPayload);
    const mutationArtifact = await materializer.materialize(mutationPayload);
    try {
      await expect(queryArtifact.invoke(queryPayload)).resolves.toEqual({ value: "user-auth" });
      await expect(mutationArtifact.invoke(mutationPayload)).resolves.toEqual({
        value: "issuer|user-auth",
      });
    } finally {
      await Promise.all([
        queryArtifact.dispose?.(),
        mutationArtifact.dispose?.(),
      ]);
    }

    expect(calls).toEqual([
      {
        path: "/invoke/start",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-auth",
          projectId: "project-auth",
          path: "auth:subject",
          args: {},
          identity: authUserIdentity(),
          kind: "query",
          visibility: "public",
          partitionKey: "auth",
        },
      },
      {
        path: "/invoke/finish",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-auth",
          projectId: "project-auth",
          sessionId: "session-query",
          value: "user-auth",
        },
      },
      {
        path: "/invoke/start",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-auth",
          projectId: "project-auth",
          path: "auth:token",
          args: {},
          identity: authUserIdentity(),
          kind: "mutation",
          visibility: "public",
          partitionKey: "auth",
        },
      },
      {
        path: "/invoke/finish",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-auth",
          projectId: "project-auth",
          sessionId: "session-mutation",
          value: "issuer|user-auth",
        },
      },
    ]);
  });

  it("passes existing session identity into materialized live-query reruns", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-auth-live",
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = authPayload("query");
    const artifact = await materializer.materialize(payload);
    const executeQuery = createMaterializedArtifactLiveQueryExecutionHost({
      artifact,
      payload,
      projectId: "project-auth-live",
    });
    const attempt: InvokeAttemptContext = {
      attempt: 1,
      maxAttempts: 1,
      session: {
        sessionId: "session-auth-live",
        beginTs: 20,
        identity: authUserIdentity(),
        schemaVersion: 1,
        function: { path: "auth:subject", kind: "query" },
        scope: {
          kind: "partition",
          table: "users",
          selector: "byId",
          partitionField: "_id",
          argField: "userId",
          partitionKey: "auth",
        },
        executionModule: "_flarex/execution.js",
      },
      syscall: async () => {
        throw new Error("live-query auth test should not use host syscalls");
      },
    };
    const subscription: LiveQuerySubscriptionForInvokeHost = {
      deploymentId: "deployment-auth",
      connectionId: "connection-auth-live",
      queryId: 3,
      functionPath: "auth:subject",
      argsJson: {},
      partitionKey: "auth",
      beginTs: 10,
      identityJson: { kind: "anonymous" },
      readSetJson: {},
      resultJson: null,
      resultHash: "previous",
      createdAt: new Date("2026-06-21T00:00:00.000Z"),
      updatedAt: new Date("2026-06-21T00:00:00.000Z"),
    };

    try {
      await expect(executeQuery(attempt, subscription)).resolves.toBe("user-auth");
    } finally {
      await artifact.dispose?.();
    }

    expect(calls).toEqual([]);
  });

  it("rejects malformed backend session identity before materialized handlers run", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-auth-malformed",
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-auth-malformed",
            function: { path: "auth:malformed", kind: "query" },
            beginTs: 1,
            schemaVersion: 1,
            scope: { kind: "partition", partitionKey: "auth" },
            executionModule: "_flarex/execution.js",
            identity: { kind: "user", user: {} },
          });
        }
        if (url.pathname === "/invoke/abort") {
          return Response.json({ aborted: true });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = authPayload("malformed");
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).rejects.toThrow("Execution identity was invalid.");
    } finally {
      await artifact.dispose?.();
    }

    expect(calls.map(call => call.path)).toEqual(["/invoke/start", "/invoke/abort"]);
  });

  it("aborts Postgres executor sessions when materialized user code fails", async () => {
    const calls: Array<{ path: string; body: unknown; authorization: string | null }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-fail",
      executorToken: "executor-secret",
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        calls.push({
          path: url.pathname,
          body,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-fail",
            function: { path: "messages:fail", kind: "mutation" },
            beginTs: 1,
            schemaVersion: 1,
            scope: { kind: "partition", partitionKey: "1:lesson" },
            executionModule: "_flarex/execution.js",
          });
        }
        if (url.pathname === "/invoke/abort") {
          return Response.json({ aborted: true });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = failingMutationPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).rejects.toThrow("boom");
    } finally {
      await artifact.dispose?.();
    }

    expect(calls).toEqual([
      {
        path: "/invoke/start",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-fail",
          projectId: "project-fail",
          path: "messages:fail",
          args: { lessonId: "1:lesson" },
          identity: { kind: "anonymous" },
          kind: "mutation",
          visibility: "public",
          partitionKey: "1:lesson",
        },
      },
      {
        path: "/invoke/abort",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment-fail",
          projectId: "project-fail",
          sessionId: "session-fail",
        },
      },
    ]);
  });

  it("retries Postgres materialized mutation sessions on OCC finish conflicts", async () => {
    const calls: Array<{ path: string; body: unknown; authorization: string | null }> = [];
    const sessions = ["session-retry-1", "session-retry-2"];
    let finishCount = 0;
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-retry",
      executorToken: "executor-secret",
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        calls.push({
          path: url.pathname,
          body,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname === "/invoke/start") {
          const sessionId = sessions.shift();
          if (sessionId === undefined) {
            return Response.json({ error: "unexpected extra start" }, { status: 500 });
          }
          return Response.json({
            sessionId,
            function: { path: "messages:retryCreate", kind: "mutation" },
            beginTs: sessionId === "session-retry-1" ? 10 : 12,
            schemaVersion: 1,
            scope: { kind: "partition", partitionKey: "1:lesson" },
            executionModule: "_flarex/execution.js",
          });
        }
        if (url.pathname === "/invoke/syscall") {
          const sessionId = (body as { sessionId?: unknown }).sessionId;
          return Response.json({
            value: sessionId === "session-retry-1" ? "2:first" : "2:second",
          });
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
          return Response.json({
            value: (body as { value: unknown }).value,
            committedTs: 13,
          });
        }
        if (url.pathname === "/invoke/abort") {
          return Response.json({ aborted: true });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = retryMutationPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).resolves.toEqual({
        value: { id: "2:second" },
        committedTs: 13,
      });
    } finally {
      await artifact.dispose?.();
    }

    expect(calls.map(call => call.path)).toEqual([
      "/invoke/start",
      "/invoke/syscall",
      "/invoke/finish",
      "/invoke/abort",
      "/invoke/start",
      "/invoke/syscall",
      "/invoke/finish",
    ]);
    expect(
      calls
        .filter(call => call.path === "/invoke/syscall")
        .map(call => (call.body as { sessionId?: unknown }).sessionId),
    ).toEqual(["session-retry-1", "session-retry-2"]);
  });

  it("reports exhausted Postgres materialized mutation OCC retries", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project-retry-exhausted",
      executorToken: "executor-secret",
      invokeMaxAttempts: 1,
      backend: async (request) => {
        const url = new URL(request.url);
        const body = await request.json().catch(() => null);
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/invoke/start") {
          return Response.json({
            sessionId: "session-retry-exhausted",
            function: { path: "messages:retryCreate", kind: "mutation" },
            beginTs: 10,
            schemaVersion: 1,
            scope: { kind: "partition", partitionKey: "1:lesson" },
            executionModule: "_flarex/execution.js",
          });
        }
        if (url.pathname === "/invoke/syscall") {
          return Response.json({ value: "2:first" });
        }
        if (url.pathname === "/invoke/finish") {
          return Response.json(
            {
              error: "InvokeSessionOccConflictError",
              message: "Document changed after session begin timestamp.",
            },
            { status: 409 },
          );
        }
        if (url.pathname === "/invoke/abort") {
          return Response.json({ aborted: true });
        }
        return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
      },
    });
    const payload = retryMutationPayload();
    const artifact = await materializer.materialize(payload);
    try {
      await expect(artifact.invoke(payload)).rejects.toThrow(
        "Flarex invoke retry exhausted after 1 attempts: Document changed after session begin timestamp.",
      );
    } finally {
      await artifact.dispose?.();
    }

    expect(calls.map(call => call.path)).toEqual([
      "/invoke/start",
      "/invoke/syscall",
      "/invoke/finish",
      "/invoke/abort",
    ]);
  });
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-runtime-materializer-"));
  await mkdir(path.join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    path.join(root, "flarex/schema.ts"),
    `import { defineColocatedTable, definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  lessons: definePartitionTable({
    title: v.string(),
  }),
  messages: defineColocatedTable("lessons", "lessonId", {
    lessonId: v.id("lessons"),
    text: v.string(),
    done: v.boolean(),
  }).index("by_lesson_text", ["lessonId", "text"]),
});
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/messages.ts"),
    `import { model, mutation, query } from "../_generated/server";
import { v } from "flarex/values";

export const create = mutation({
  partition: model.lessons,
  args: { lessonId: v.id("lessons"), text: v.string() },
  returns: v.object({ id: v.id("messages") }),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("messages", { lessonId: args.lessonId, text: args.text, done: false });
    await ctx.db.patch(id, { text: "intermediate", done: true });
    await ctx.db.replace(id, { lessonId: args.lessonId, text: args.text, done: true });
    return { id };
  },
});

export const list = query({
  partition: model.lessons,
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, args) => {
    return await ctx.db.query("messages").withIndex("by_lesson_text", q => q.eq("lessonId", args.lessonId).eq("text", "hello")).collect();
  },
});
`,
  );
  return root;
}

function finishValue(body: unknown): unknown {
  if (body === null || typeof body !== "object" || !("value" in body)) {
    throw new Error("Expected /invoke/finish body with value.");
  }
  return body.value;
}

function jsonRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} request body is not a JSON object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

function indexedQueryPayload(): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
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
      _handler: async ({ db }, args) => {
        return await db
          .query("messages")
          .withIndex("by_lesson_text", q =>
            q.eq("lessonId", args.lessonId).eq("text", "hello")
          )
          .take(2);
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-index",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-index",
      sourcePackageHash: "a".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:list",
      args: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      kind: "query",
    },
  };
}

function payloadWithSourceModules(
  modules: PushSourcePackage["modules"],
): MaterializedExecutionArtifactPayload {
  const payload = indexedQueryPayload();
  return {
    ...payload,
    sourcePackage: {
      ...payload.sourcePackage,
      modules,
    },
  };
}

function authUserIdentity(): ExecutionIdentity {
  return {
    kind: "user",
    user: {
      tokenIdentifier: "issuer|user-auth",
      subject: "user-auth",
      issuer: "issuer",
      name: "Auth User",
    },
  };
}

function authPayload(kind: "query" | "mutation" | "malformed"): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "m".repeat(64),
        source: `export default {
  auth: {
    subject: {
      isQuery: true,
      isPublic: true,
      _handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity !== null) {
          identity.subject = "mutated";
        }
        const reread = await ctx.auth.getUserIdentity();
        return reread === null ? null : reread.subject;
      },
    },
    token: {
      isMutation: true,
      isPublic: true,
      _handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        return identity === null ? null : identity.tokenIdentifier;
      },
    },
    malformed: {
      isQuery: true,
      isPublic: true,
      _handler: async () => "handler should not run",
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-auth",
    identity: authUserIdentity(),
    ref: {
      runtime: "dynamic-worker",
      artifactId: `artifact-auth-${kind}`,
      sourcePackageHash: "m".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path:
        kind === "query"
          ? "auth:subject"
          : kind === "mutation"
            ? "auth:token"
            : "auth:malformed",
      args: {},
      partitionKey: "auth",
      kind: kind === "mutation" ? "mutation" : "query",
    },
  };
}

function failingMutationPayload(): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: `export default {
  messages: {
    fail: {
      isMutation: true,
      isPublic: true,
      _handler: async () => {
        throw new Error("boom");
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-fail",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-fail",
      sourcePackageHash: "b".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:fail",
      args: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      kind: "mutation",
    },
  };
}

function internalQueryPayload(): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "e".repeat(64),
        source: `export default {
  messages: {
    internalList: {
      isQuery: true,
      isInternal: true,
      _handler: async () => "secret",
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-internal",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-internal",
      sourcePackageHash: "e".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:internalList",
      args: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      kind: "query",
    },
  };
}

function malformedVisibilityPayload(extraMarkers: string): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "f".repeat(64),
        source: `export default {
  messages: {
    malformed: {
      isQuery: true,
      ${extraMarkers}
      _handler: async () => "malformed",
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-malformed",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-malformed",
      sourcePackageHash: "f".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:malformed",
      args: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      kind: "query",
    },
  };
}

function nestedRunQueryPayload(): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "g".repeat(64),
        source: `export default {
  messages: {
    usesRunQuery: {
      isQuery: true,
      isPublic: true,
      _handler: async (ctx) => {
        return await ctx.runQuery({ _path: "messages:helper" }, { id: "2:message" });
      },
    },
    helper: {
      isQuery: true,
      isInternal: true,
      _handler: async ({ db }, args) => {
        return await db.get(args.id);
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-nested",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-nested",
      sourcePackageHash: "g".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:usesRunQuery",
      args: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      kind: "query",
    },
  };
}

function nestedRunMutationPayload(): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "h".repeat(64),
        source: `export default {
  messages: {
    usesRunMutation: {
      isMutation: true,
      isPublic: true,
      _handler: async (ctx) => {
        return await ctx.runMutation({ _path: "messages:create" }, { text: "nested" });
      },
    },
    create: {
      isMutation: true,
      isInternal: true,
      _handler: async ({ db }, args) => {
        return await db.insert("messages", { text: args.text });
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-nested-mutation",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-nested-mutation",
      sourcePackageHash: "h".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:usesRunMutation",
      args: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      kind: "mutation",
    },
  };
}

function queryCallsNestedMutationPayload(): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "i".repeat(64),
        source: `export default {
  messages: {
    queryCallsMutation: {
      isQuery: true,
      isPublic: true,
      _handler: async (ctx) => {
        return await ctx.runMutation({ _path: "messages:create" }, { text: "nested" });
      },
    },
    create: {
      isMutation: true,
      isInternal: true,
      _handler: async ({ db }, args) => {
        return await db.insert("messages", { text: args.text });
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-query-nested-mutation",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-query-nested-mutation",
      sourcePackageHash: "i".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:queryCallsMutation",
      args: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      kind: "query",
    },
  };
}

function recursiveNestedQueryPayload(): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "j".repeat(64),
        source: `export default {
  messages: {
    recursive: {
      isQuery: true,
      isPublic: true,
      _handler: async (ctx) => {
        return await ctx.runQuery({ _path: "messages:recursive" }, {});
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-nested-recursive",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-nested-recursive",
      sourcePackageHash: "j".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:recursive",
      args: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      kind: "query",
    },
  };
}

function retryMutationPayload(): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "d".repeat(64),
        source: `export default {
  messages: {
    retryCreate: {
      isMutation: true,
      isPublic: true,
      _handler: async ({ db }, args) => {
        const id = await db.insert("messages", {
          lessonId: args.lessonId,
          text: args.text,
        });
        return { id };
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-retry",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-retry",
      sourcePackageHash: "d".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:retryCreate",
      args: { lessonId: "1:lesson", text: "hello" },
      partitionKey: "1:lesson",
      kind: "mutation",
    },
  };
}

function replaceMutationPayload(): MaterializedExecutionArtifactPayload {
  const sourcePackage: PushSourcePackage = {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "c".repeat(64),
        source: `export default {
  messages: {
    replace: {
      isMutation: true,
      isPublic: true,
      _handler: async ({ db }) => {
        await db.replace("2:message", {
          lessonId: "1:lesson",
          text: "final",
          done: true,
        });
        return { replaced: true };
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
  return {
    deploymentId: "deployment-replace",
    identity: { kind: "anonymous" },
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact-replace",
      sourcePackageHash: "c".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage,
    request: {
      path: "messages:replace",
      args: { lessonId: "1:lesson" },
      partitionKey: "1:lesson",
      kind: "mutation",
    },
  };
}

async function createCreateRootProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-runtime-create-root-"));
  await mkdir(path.join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    path.join(root, "flarex/schema.ts"),
    `import { defineColocatedTable, definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  profiles: defineColocatedTable("users", "userId", {
    userId: v.id("users"),
    bio: v.string(),
  }),
  users: definePartitionTable({
    name: v.string(),
  }),
});
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/users.ts"),
    `import { model, mutation } from "../_generated/server";
import { v } from "flarex/values";

export const create = mutation({
  partition: model.users,
  args: { name: v.string() },
  returns: v.object({ userId: v.id("users"), profileId: v.id("profiles") }),
  handler: async (ctx, args) => {
    const userId = await ctx.db.insert("users", { name: args.name });
    const profileId = await ctx.db.insert("profiles", { userId, bio: "Hello" });
    return { userId, profileId };
  },
});
`,
  );
  return root;
}

async function dispatchBackend(harness: BackendHarness, request: Request): Promise<Response> {
  const init = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    ...(request.method === "GET" || request.method === "HEAD"
      ? {}
      : { body: await request.text() }),
  };
  return harness.mf.dispatchFetch(request.url, {
    ...init,
  }) as unknown as Promise<Response>;
}

async function startPush(
  harness: BackendHarness,
  deploymentId: string,
  body: unknown,
): Promise<{ pushId: string }> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: {
        authorization: ANALYZED_START_TEST_AUTHORIZATION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<{ pushId: string }>;
}

async function finishPush(
  harness: BackendHarness,
  deploymentId: string,
  pushId: string,
): Promise<void> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  expect(response.ok).toBe(true);
}

function invoke(
  harness: BackendHarness,
  deploymentId: string,
  body: unknown,
): Promise<Response> {
  return harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/invoke`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as Promise<Response>;
}
