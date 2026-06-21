import { describe, expect, it } from "vitest";
import {
  executionArtifactRefForSourcePackage,
  type ArtifactSourcePackage,
} from "flarex/artifacts";
import type {
  FlarexExecutor,
  GetActiveDeploymentPackageInput,
  InvokeAttemptContext,
  InvokeSyscallInput,
  RerunLiveQuerySubscriptionOutput,
  RerunStaleLiveQuerySubscriptionsInput,
  RunLiveQuerySubscriptionWithInvokeInput,
} from "@flarex/executor";
import type { PushSourcePackage } from "flarex-backend/types";

import { createLocalExecutorHttpRuntime } from "../src/executorHttpRuntime";

describe("createLocalExecutorHttpRuntime", () => {
  it("wires live-query rerun maintenance to materialized query execution", async () => {
    const sourcePackage = indexedQuerySourcePackage();
    const ref = await executionArtifactRefForSourcePackage(
      sourcePackage as ArtifactSourcePackage,
    );
    const syscalls: InvokeSyscallInput[] = [];
    const reruns: RerunLiveQuerySubscriptionOutput[] = [];
    const executor = {
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
            sourcePackageJson: sourcePackage as unknown as Record<string, unknown>,
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
    } as unknown as FlarexExecutor;

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

function emptyFreshnessStore() {
  return {
    async applyCommitFreshness() {
      return { applied: false, documentVersions: [], tableVersions: [] };
    },
    getDocumentVersion: () => null,
    getTableVersion: () => null,
  };
}

function jsonRequest(url: string, body: unknown, token: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}
