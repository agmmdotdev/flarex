import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
import { createBackendHarness, type BackendHarness } from "flarex-backend/test/backendHarness";
import {
  backendAnalysisFromCodegenAnalysis,
} from "../src/backendPush";
import { LocalMiniflareExecutionArtifactAdapter } from "../src/executionArtifact";
import {
  bundleFlarexSourcePackage,
  initialCodegen,
} from "../src/generate";
import {
  createMaterializedArtifactLiveQueryExecutionHost,
  LocalMiniflareExecutionArtifactMaterializer,
} from "../src/runtimeMaterializer";
import type { PushSourcePackage } from "flarex-backend/types";
import type {
  InvokeAttemptContext,
  RunLiveQuerySubscriptionWithInvokeInput,
} from "@flarex/executor";

type LiveQuerySubscriptionForInvokeHost =
  Parameters<RunLiveQuerySubscriptionWithInvokeInput["executeQuery"]>[1];

describe("runtime materializer", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
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
          kind: "query",
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
          kind: "mutation",
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
      headers: { "content-type": "application/json" },
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
