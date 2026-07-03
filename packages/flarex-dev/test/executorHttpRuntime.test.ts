import { describe, expect, it } from "vitest";
import {
  applyOutboxEventsToFreshnessMirror,
  createPostgresFreshnessMirrorStore,
} from "@flarex/freshness";
import {
  executionArtifactRefForSourcePackage,
} from "flarex/artifacts";
import type {
  FinishInvokeSessionResult,
  GetActiveDeploymentPackageInput,
  InvokeAttemptContext,
  InvokeSyscallInput,
  RerunLiveQuerySubscriptionOutput,
  RerunStaleLiveQuerySubscriptionsInput,
  RunLiveQuerySubscriptionWithInvokeInput,
} from "@flarex/executor";
import { createFlarexExecutor } from "@flarex/executor";
import { createPGlitePersistence } from "@flarex/persistence-postgres/pglite";
import {
  materializedExecutionArtifactInvokePayload,
} from "flarex-protocol/artifact-runtime";
import type {
  ExecutionArtifactMaterializer,
  MaterializedExecutionArtifact,
  MaterializedExecutionArtifactPayload,
} from "flarex-backend/artifact-runtime";
import type { PushSourcePackage } from "flarex-backend/types";

import {
  createLocalExecutorHttpRuntime,
  createLocalPGliteExecutorHttpRuntime,
} from "../src/executorHttpRuntime";
import {
  emptyFreshnessStore,
  fakeExecutor,
  jsonRequest,
  sourcePackageJson,
} from "./localRuntimeFixture";

type QuerySessionRequest =
  Parameters<NonNullable<MaterializedExecutionArtifact["executeQuerySession"]>>[1];

describe("createLocalExecutorHttpRuntime", () => {
  it("wires live-query rerun maintenance to materialized query execution", async () => {
    const sourcePackage = indexedQuerySourcePackage();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    const syscalls: InvokeSyscallInput[] = [];
    const reruns: RerunLiveQuerySubscriptionOutput[] = [];
    const executor = fakeExecutor({
      async getActiveDeploymentPackage(input: GetActiveDeploymentPackageInput) {
        expect(input).toEqual({
          deploymentId: "deployment-live",
          projectId: "project-live",
        });
        return {
          deployment: {
            deploymentId: "deployment-live",
            projectId: "project-live",
            activePackageId: ref.artifactId,
            activeSchemaVersion: 1,
            createdAt: new Date("2026-06-21T00:00:00.000Z"),
          },
          package: {
            deploymentId: "deployment-live",
            packageId: ref.artifactId,
            sourcePackageHash: ref.sourcePackageHash,
            executionModule: ref.executionModule,
            sourcePackageJson: sourcePackageJson(sourcePackage),
            analysisJson: null,
            createdAt: new Date("2026-06-21T00:00:00.000Z"),
          },
        };
      },
      async rerunStaleLiveQuerySubscriptions(input: RerunStaleLiveQuerySubscriptionsInput) {
        expect(input.deploymentId).toBe("deployment-live");
        expect(input.limit).toBe(1);
        const rerun = await input.runQuery({
          deploymentId: "deployment-live",
          connectionId: "connection-a",
          queryId: 7,
          functionPath: "messages:list",
          argsJson: { lessonId: "1:lesson" },
          partitionKey: "1:lesson",
          beginTs: 10,
          readSetJson: {},
          resultJson: [],
          resultHash: "previous",
          createdAt: new Date("2026-06-21T00:00:00.000Z"),
          updatedAt: new Date("2026-06-21T00:00:00.000Z"),
        });
        reruns.push(rerun);
        return {
          scanned: { fresh: [], stale: [], unsupported: [] },
          changed: [],
          unchanged: [],
          changes: [],
          unsupported: [],
          hasMoreStale: false,
        };
      },
      async runLiveQuerySubscriptionWithInvoke(
        input: RunLiveQuerySubscriptionWithInvokeInput,
      ) {
        expect(input.projectId).toBe("project-live");
        const value = await input.executeQuery(liveQueryAttempt(), input.subscription);
        return {
          value,
          beginTs: 20,
          readSet: { indexes: [{ indexId: 1, observedTs: 20 }] },
        };
      },
      async invokeSyscall(input: InvokeSyscallInput) {
        syscalls.push(input);
        return {
          value: {
            page: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
            isDone: true,
            continueCursor: "cursor-live",
          },
          readSet: { indexes: [{ indexId: 1 }] },
        };
      },
    });

    const runtime = createLocalExecutorHttpRuntime({
      executor,
      projectId: "project-live",
      capabilityToken: "executor-secret",
      freshnessStore: emptyFreshnessStore(),
    });

    try {
      const response = await runtime.fetch(jsonRequest(
        "https://executor.test/maintenance/live-queries/rerun",
        {
          deploymentId: "deployment-live",
          projectId: "project-live",
          limit: 1,
        },
        "executor-secret",
      ));

      expect(response.status).toBe(200);
      expect(runtime.cacheSize()).toBe(1);
      await expect(response.json()).resolves.toEqual({
        scanned: { fresh: [], stale: [], unsupported: [] },
        changed: [],
        unchanged: [],
        changes: [],
        unsupported: [],
        hasMoreStale: false,
      });
    } finally {
      await runtime.dispose();
    }

    expect(reruns).toEqual([
      {
        value: [{ _id: "2:message", lessonId: "1:lesson", text: "hello" }],
        beginTs: 20,
        readSet: { indexes: [{ indexId: 1, observedTs: 20 }] },
      },
    ]);
    expect(syscalls).toEqual([
      {
        deploymentId: "deployment-live",
        projectId: "project-live",
        sessionId: "session-live",
        syscall: {
          op: "query",
          request: {
            table: "messages",
            index: "by_lesson",
            range: {
              expressions: [
                { op: "eq", field: "lessonId", value: "1:lesson" },
              ],
            },
            limit: 2,
          },
        },
      },
    ]);
  });

  it("builds local live-query materialization payloads through the shared lifecycle helper", async () => {
    const sourcePackage = indexedQuerySourcePackage();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    const materializedPayloads: MaterializedExecutionArtifactPayload[] = [];
    const querySessionPayloads: MaterializedExecutionArtifactPayload[] = [];
    const querySessionRequests: QuerySessionRequest[] = [];
    const executor = fakeExecutor({
      async getActiveDeploymentPackage(input: GetActiveDeploymentPackageInput) {
        expect(input).toEqual({
          deploymentId: "deployment-local-payload",
          projectId: "project-local-payload",
        });
        return {
          deployment: {
            deploymentId: "deployment-local-payload",
            projectId: "project-local-payload",
            activePackageId: ref.artifactId,
            activeSchemaVersion: 1,
            createdAt: new Date("2026-06-21T00:00:00.000Z"),
          },
          package: {
            deploymentId: "deployment-local-payload",
            packageId: ref.artifactId,
            sourcePackageHash: ref.sourcePackageHash,
            executionModule: ref.executionModule,
            sourcePackageJson: sourcePackageJson(sourcePackage),
            analysisJson: null,
            createdAt: new Date("2026-06-21T00:00:00.000Z"),
          },
        };
      },
      async rerunStaleLiveQuerySubscriptions(input: RerunStaleLiveQuerySubscriptionsInput) {
        const subscription = {
          deploymentId: "deployment-local-payload",
          connectionId: "connection-local-payload",
          queryId: 11,
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
        const rerun = await input.runQuery(subscription);
        expect(rerun.value).toEqual([
          { _id: "2:message", lessonId: "1:lesson", text: "shared" },
        ]);
        return {
          scanned: { fresh: [], stale: [], unsupported: [] },
          changed: [
            {
              status: "updated",
              subscription,
              previousResultHash: "previous",
              resultHash: "next",
              changed: true,
              delivery: null,
            },
          ],
          unchanged: [],
          changes: [],
          unsupported: [],
          hasMoreStale: false,
        };
      },
      async runLiveQuerySubscriptionWithInvoke(
        input: RunLiveQuerySubscriptionWithInvokeInput,
      ) {
        return {
          value: await input.executeQuery(liveQueryAttempt(), input.subscription),
          beginTs: 20,
          readSet: { indexes: [{ indexId: 1, observedTs: 20 }] },
        };
      },
    });
    const materializer: ExecutionArtifactMaterializer = {
      materialize: async (
        payload: MaterializedExecutionArtifactPayload,
      ): Promise<MaterializedExecutionArtifact> => {
        materializedPayloads.push(payload);
        return {
          invoke: async () => {
            throw new Error("live-query materialization should not call invoke.");
          },
          executeQuerySession: async (payload, request) => {
            querySessionPayloads.push(payload);
            querySessionRequests.push(request);
            return [{ _id: "2:message", lessonId: "1:lesson", text: "shared" }];
          },
        };
      },
    };
    const runtime = createLocalExecutorHttpRuntime({
      executor,
      projectId: "project-local-payload",
      capabilityToken: "executor-secret",
      freshnessStore: emptyFreshnessStore(),
      materializer,
    });

    try {
      const response = await runtime.fetch(jsonRequest(
        "https://executor.test/maintenance/live-queries/rerun",
        {
          deploymentId: "deployment-local-payload",
          projectId: "project-local-payload",
          limit: 1,
        },
        "executor-secret",
      ));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        changed: [
          {
            status: "updated",
            changed: true,
          },
        ],
      });
      expect(materializedPayloads).toEqual([
        materializedExecutionArtifactInvokePayload({
          deploymentId: "deployment-local-payload",
          ref,
          sourcePackage,
          request: {
            path: "messages:list",
            args: { lessonId: "1:lesson" },
            kind: "query",
            partitionKey: "1:lesson",
          },
        }),
      ]);
      expect(querySessionPayloads).toEqual(materializedPayloads);
      expect(querySessionRequests).toEqual([
        {
          deploymentId: "deployment-local-payload",
          projectId: "project-local-payload",
          path: "messages:list",
          args: { lessonId: "1:lesson" },
          partitionKey: "1:lesson",
          sessionId: "session-live",
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("reruns stale live queries through PGlite-backed executor state", async () => {
    let now = 100;
    let nextSession = 0;
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(++now) },
      ids: { nextId: () => `session_pglite_${++nextSession}` },
      persistence,
    });
    const sourcePackage = getMessageSourcePackage();
    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment-pglite-live",
      projectId: "project-pglite-live",
      sourcePackage,
      analysisJson: getMessageAnalysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment-pglite-live",
      projectId: "project-pglite-live",
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });

    const seeded = await executor.runInvokeWithRetries({
      deploymentId: "deployment-pglite-live",
      projectId: "project-pglite-live",
      path: "messages:seed",
      kind: "mutation",
      args: { messageId: "1:message", text: "fresh" },
      partitionKey: "1:message",
      runAttempt: async attempt =>
        (await attempt.syscall({
          op: "insert",
          table: "messages",
          id: "1:message",
          value: { text: "fresh" },
        })).value,
    });
    expect(seeded.value).toBe("1:message");

    const outbox = await persistence.listOutboxEvents({
      deploymentId: "deployment-pglite-live",
      limit: 10,
    });
    const freshnessStore = createPostgresFreshnessMirrorStore(persistence);
    await applyOutboxEventsToFreshnessMirror({
      store: freshnessStore,
      events: outbox.events,
    });

    const initial = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment-pglite-live",
      projectId: "project-pglite-live",
      connectionId: "connection-pglite",
      queryId: 1,
      functionPath: "messages:get",
      argsJson: { messageId: "1:message" },
      partitionKey: "1:message",
      beginTs: seeded.beginTs - 1,
      readSet: {
        documents: [{ tableId: 1, id: "1:message", observedTs: null }],
      },
      resultJson: null,
    });

    const runtime = createLocalExecutorHttpRuntime({
      executor,
      projectId: "project-pglite-live",
      capabilityToken: "executor-secret",
      freshnessStore,
    });

    try {
      const response = await runtime.fetch(jsonRequest(
        "https://executor.test/maintenance/live-queries/rerun",
        {
          deploymentId: "deployment-pglite-live",
          projectId: "project-pglite-live",
          limit: 1,
        },
        "executor-secret",
      ));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        changed: [
          {
            previousResultHash: initial.resultHash,
            changed: true,
            subscription: {
              deploymentId: "deployment-pglite-live",
              connectionId: "connection-pglite",
              queryId: 1,
              functionPath: "messages:get",
              resultJson: { _id: "1:message", text: "fresh" },
            },
          },
        ],
        changes: [
          {
            deploymentId: "deployment-pglite-live",
            connectionId: "connection-pglite",
            queryId: 1,
            functionPath: "messages:get",
            argsJson: { messageId: "1:message" },
            resultJson: { _id: "1:message", text: "fresh" },
            previousResultHash: initial.resultHash,
          },
        ],
        unchanged: [],
        hasMoreStale: false,
      });
      expect(runtime.cacheSize()).toBe(1);
    } finally {
      await runtime.dispose();
    }

    await expect(
      persistence.query<{ count: number }>(
        `
          select count(*)::int as count
          from invoke_sessions
          where deployment_id = $1
            and function_kind = 'query'
            and state = 'finished'
        `,
        ["deployment-pglite-live"],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      persistence.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment-pglite-live",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          connectionId: "connection-pglite",
          queryId: 1,
          payloadJson: {
            resultJson: { _id: "1:message", text: "fresh" },
            previousResultHash: initial.resultHash,
          },
          deliveredAt: null,
        },
      ],
      hasMore: false,
    });
    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment-pglite-live",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        resultJson: { _id: "1:message", text: "fresh" },
      }),
    ]);
  });

  it("wires PGlite mutation commits to the Cloudflare live-query trigger notifier", async () => {
    let now = 100;
    let nextSession = 0;
    const triggerRequests: Array<{
      url: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const runtime = await createLocalPGliteExecutorHttpRuntime({
      projectId: "project-pglite-trigger",
      capabilityToken: "executor-secret",
      backendUrl: "https://backend.test/base",
      triggerCapabilityToken: "delivery-secret",
      triggerLimit: 5,
      triggerDeliveryLimit: 10,
      triggerMaxBatches: 2,
      clock: { now: () => new Date(++now) },
      ids: { nextId: () => `session_trigger_${++nextSession}` },
      triggerFetch: async (input, init) => {
        const request = new Request(input, init);
        triggerRequests.push({
          url: request.url,
          authorization: request.headers.get("authorization"),
          body: await request.json(),
        });
        return Response.json({
          deploymentId: "deployment-pglite-trigger",
          changed: 0,
          unchanged: 0,
          unsupported: 0,
          hasMoreStale: false,
        });
      },
    });

    try {
      const sourcePackage = getMessageSourcePackage();
      const registered = await runtime.executor.registerDeploymentPackage({
        deploymentId: "deployment-pglite-trigger",
        projectId: "project-pglite-trigger",
        sourcePackage,
        analysisJson: getMessageAnalysisJson(),
      });
      await runtime.executor.activateDeploymentPackage({
        deploymentId: "deployment-pglite-trigger",
        projectId: "project-pglite-trigger",
        packageId: registered.package.packageId,
        schemaVersion: 1,
      });
      await runtime.executor.recordLiveQuerySubscription({
        deploymentId: "deployment-pglite-trigger",
        projectId: "project-pglite-trigger",
        connectionId: "connection-pglite-trigger",
        queryId: 1,
        functionPath: "messages:get",
        argsJson: { messageId: "1:message" },
        partitionKey: "1:message",
        beginTs: 100,
        readSet: {
          documents: [{ tableId: 1, id: "1:message", observedTs: null }],
        },
        resultJson: null,
      });

      const start = await runtime.fetch(jsonRequest(
        "https://executor.test/invoke/start",
        {
          deploymentId: "deployment-pglite-trigger",
          projectId: "project-pglite-trigger",
          path: "messages:seed",
          kind: "mutation",
          args: { messageId: "1:message", text: "fresh" },
          partitionKey: "1:message",
        },
        "executor-secret",
      ));
      expect(start.status).toBe(200);
      const started = await start.json() as { sessionId: string };

      const syscall = await runtime.fetch(jsonRequest(
        "https://executor.test/invoke/syscall",
        {
          deploymentId: "deployment-pglite-trigger",
          projectId: "project-pglite-trigger",
          sessionId: started.sessionId,
          op: "insert",
          table: "messages",
          id: "1:message",
          value: { text: "fresh" },
        },
        "executor-secret",
      ));
      expect(syscall.status).toBe(200);

      const finish = await runtime.fetch(jsonRequest(
        "https://executor.test/invoke/finish",
        {
          deploymentId: "deployment-pglite-trigger",
          projectId: "project-pglite-trigger",
          sessionId: started.sessionId,
          value: "1:message",
        },
        "executor-secret",
      ));

      expect(finish.status).toBe(200);
      const finished: unknown = await finish.json();
      expect(finished).toMatchObject({
        value: "1:message",
        committedTs: expect.any(Number),
        writes: [
          {
            tableId: 1,
            id: "1:message",
            prevTs: null,
            ts: expect.any(Number),
            value: { text: "fresh" },
          },
        ],
      });
      const committedTs = committedTsFromInvokeFinish(finished);
      await expect(
        runtime.freshnessStore.getDocumentVersion(
          "deployment-pglite-trigger",
          "1:message",
        ),
      ).resolves.toMatchObject({ version: committedTs });
      await expect(
        runtime.executor.findStaleLiveQuerySubscriptions({
          deploymentId: "deployment-pglite-trigger",
          freshnessStore: runtime.freshnessStore,
        }),
      ).resolves.toMatchObject({
        stale: [
          {
            subscription: {
              deploymentId: "deployment-pglite-trigger",
              connectionId: "connection-pglite-trigger",
              queryId: 1,
            },
          },
        ],
      });
      expect(triggerRequests).toEqual([
        {
          url: "https://backend.test/base/scheduler/live-query-subscriptions/trigger",
          authorization: "Bearer delivery-secret",
          body: {
            deploymentId: "deployment-pglite-trigger",
            projectId: "project-pglite-trigger",
            limit: 5,
            deliveryLimit: 10,
            maxBatches: 2,
          },
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });
});

function indexedQuerySourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "d".repeat(64),
        source: `export default {
  messages: {
    list: {
      isQuery: true,
      _handler: async ({ db }, args) => {
        return await db
          .query("messages")
          .withIndex("by_lesson", q => q.eq("lessonId", args.lessonId))
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
}

function getMessageSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "e".repeat(64),
        source: `export default {
  messages: {
    get: {
      isQuery: true,
      _handler: async ({ db }, args) => {
        return await db.get(args.messageId);
      },
    },
    seed: {
      isMutation: true,
      _handler: async () => {
        throw new Error("seed is exercised directly through executor syscalls");
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
}

function getMessageAnalysisJson(): Record<string, unknown> {
  const partition = {
    type: "partition",
    table: "messages",
    selector: "byId",
    partitionField: "_id",
    argField: "messageId",
  };
  return {
    schema: {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "messages",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    },
    functions: {
      functions: [
        {
          path: "messages:get",
          kind: "query",
          route: { type: "args", field: "messageId" },
          partition,
        },
        {
          path: "messages:seed",
          kind: "mutation",
          route: { type: "args", field: "messageId" },
          partition,
        },
      ],
    },
  };
}

function liveQueryAttempt(): InvokeAttemptContext {
  return {
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
      throw new Error("local executor HTTP runtime should use artifact syscalls");
    },
  };
}

function committedTsFromInvokeFinish(
  value: unknown,
): NonNullable<FinishInvokeSessionResult["committedTs"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invoke finish response must be an object.");
  }
  if (!("committedTs" in value)) {
    throw new Error("Invoke finish committedTs is missing.");
  }
  const committedTs = value.committedTs;
  if (typeof committedTs !== "number" || !Number.isInteger(committedTs)) {
    throw new Error("Invoke finish committedTs must be an integer.");
  }
  return committedTs;
}
