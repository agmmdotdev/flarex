import { describe, expect, it } from "vitest";

import { createMemoryFreshnessMirrorStore } from "@flarex/freshness";
import type { DocumentRevisionRecord } from "@flarex/persistence-postgres";
import {
  createFlarexExecutor,
  DeploymentProjectMismatchError,
  fingerprintJson,
  LiveQuerySubscriptionRerunError,
} from "../src";
import {
  deploymentMetadata,
  deploymentPackageMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("executor live query subscriptions", () => {
  it("records a live query subscription with timestamped read set and result hash", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.recordLiveQuerySubscription({
        deploymentId: "deployment_live_query",
        connectionId: "connection_a",
        queryId: 1,
        functionPath: "messages:list",
        argsJson: { teamId: "team_a" },
        partitionKey: "team_a",
        beginTs: 10,
        readSet: {
          documents: [{ tableId: 1, id: "1:message" }],
          tables: [{ tableId: 1 }],
        },
        resultJson: [{ text: "hello", _id: "1:message" }],
        updatedAt: new Date("2026-06-20T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      resultHash: '[{"_id":"1:message","text":"hello"}]',
      subscription: {
        deploymentId: "deployment_live_query",
        connectionId: "connection_a",
        queryId: 1,
        functionPath: "messages:list",
        argsJson: { teamId: "team_a" },
        partitionKey: "team_a",
        beginTs: 10,
        readSetJson: {
          documents: [{ tableId: 1, id: "1:message", observedTs: 10 }],
          tables: [{ tableId: 1, observedTs: 10 }],
        },
        resultJson: [{ text: "hello", _id: "1:message" }],
        resultHash: '[{"_id":"1:message","text":"hello"}]',
      },
    });

    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_live_query",
        connectionId: "connection_a",
      }),
    ).resolves.toMatchObject([
      {
        queryId: 1,
        readSetJson: {
          documents: [{ tableId: 1, id: "1:message", observedTs: 10 }],
          tables: [{ tableId: 1, observedTs: 10 }],
        },
        partitionKey: "team_a",
      },
    ]);
  });

  it("preserves richer read-set timestamps while recording", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_rich_readset",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:maybeGet",
      argsJson: { id: "1:missing" },
      beginTs: 20,
      readSet: {
        documents: [{ tableId: 1, id: "1:missing", observedTs: null }],
        indexes: [{ indexId: 1, lower: "a", upper: "m" }],
      },
      resultJson: null,
    });

    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_rich_readset",
      }),
    ).resolves.toMatchObject([
      {
        readSetJson: {
          documents: [{ tableId: 1, id: "1:missing", observedTs: null }],
          indexes: [{ indexId: 1, observedTs: 20, lower: "a", upper: "m" }],
        },
      },
    ]);
  });

  it("replaces and removes recorded live query subscriptions", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_replace_live_query",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_a",
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: ["old"],
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_replace_live_query",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_a",
      beginTs: 20,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: ["new"],
    });

    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_replace_live_query",
      }),
    ).resolves.toMatchObject([
      {
        queryId: 1,
        beginTs: 20,
        resultJson: ["new"],
        resultHash: '["new"]',
        partitionKey: "team_a",
      },
    ]);

    await expect(
      executor.removeLiveQuerySubscription({
        deploymentId: "deployment_replace_live_query",
        connectionId: "connection_a",
        queryId: 1,
      }),
    ).resolves.toEqual({ deleted: 1 });
    await expect(
      executor.removeLiveQuerySubscription({
        deploymentId: "deployment_replace_live_query",
        connectionId: "connection_a",
        queryId: 1,
      }),
    ).resolves.toEqual({ deleted: 0 });
  });

  it("fingerprints object results with stable key order", () => {
    expect(fingerprintJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
  });

  it("classifies live query subscriptions by freshness", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_scan_live_queries",
        ts: 10,
        sequence: 0,
      },
      commitTs: 10,
      documentIds: ["1:fresh"],
      tableIds: [1],
    });
    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_scan_live_queries",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["1:stale"],
      tableIds: [2],
    });

    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_scan_live_queries",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:fresh",
      argsJson: {},
      beginTs: 10,
      readSet: {
        documents: [{ tableId: 1, id: "1:fresh" }],
      },
      resultJson: "fresh",
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_scan_live_queries",
      connectionId: "connection_a",
      queryId: 2,
      functionPath: "messages:stale",
      argsJson: {},
      beginTs: 10,
      readSet: {
        documents: [{ tableId: 2, id: "1:stale" }],
        tables: [{ tableId: 2 }],
      },
      resultJson: "stale",
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_scan_live_queries",
      connectionId: "connection_b",
      queryId: 1,
      functionPath: "messages:range",
      argsJson: {},
      beginTs: 10,
      readSet: {
        indexes: [{ indexId: 1, lower: "a", upper: "m" }],
      },
      resultJson: "unsupported",
    });

    await expect(
      executor.findStaleLiveQuerySubscriptions({
        deploymentId: "deployment_scan_live_queries",
        freshnessStore,
      }),
    ).resolves.toMatchObject({
      fresh: [
        {
          subscription: { connectionId: "connection_a", queryId: 1 },
          freshness: { status: "fresh", stale: [], unsupported: [] },
        },
      ],
      stale: [
        {
          subscription: { connectionId: "connection_a", queryId: 2 },
          freshness: {
            status: "stale",
            stale: [
              {
                kind: "document",
                id: "1:stale",
                observedTs: 10,
                version: 20,
              },
              {
                kind: "table",
                id: "2",
                observedTs: 10,
                version: 20,
              },
            ],
          },
        },
      ],
      unsupported: [
        {
          subscription: { connectionId: "connection_b", queryId: 1 },
          freshness: {
            status: "unsupported",
            unsupported: [
              {
                kind: "index",
                indexId: 1,
                reason: "index/range freshness is not implemented yet",
              },
            ],
          },
        },
      ],
    });
  });

  it("reruns a live query subscription and reports changed results", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const initial = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_rerun_changed",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: ["old"],
    });
    let receivedFunctionPath = "";

    await expect(
      executor.rerunLiveQuerySubscription({
        subscription: initial.subscription,
        updatedAt: new Date("2026-06-20T00:10:00.000Z"),
        runQuery: async (subscription) => {
          receivedFunctionPath = subscription.functionPath;
          return {
            value: ["new"],
            beginTs: 20,
            readSet: {
              documents: [{ tableId: 1, id: "1:new" }],
            },
          };
        },
      }),
    ).resolves.toMatchObject({
      previousResultHash: '["old"]',
      resultHash: '["new"]',
      changed: true,
      delivery: {
        deploymentId: "deployment_rerun_changed",
        connectionId: "connection_a",
        queryId: 1,
        payloadJson: {
          deploymentId: "deployment_rerun_changed",
          connectionId: "connection_a",
          queryId: 1,
          functionPath: "messages:list",
          argsJson: { teamId: "team_a" },
          resultJson: ["new"],
          previousResultHash: '["old"]',
          resultHash: '["new"]',
        },
      },
      subscription: {
        beginTs: 20,
        readSetJson: {
          documents: [{ tableId: 1, id: "1:new", observedTs: 20 }],
        },
        resultJson: ["new"],
        resultHash: '["new"]',
        updatedAt: new Date("2026-06-20T00:10:00.000Z"),
      },
    });
    expect(receivedFunctionPath).toBe("messages:list");
    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_rerun_changed",
      }),
    ).resolves.toMatchObject([
      {
        queryId: 1,
        beginTs: 20,
        resultJson: ["new"],
        resultHash: '["new"]',
      },
    ]);
    await expect(
      executor.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_rerun_changed",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deploymentId: "deployment_rerun_changed",
          connectionId: "connection_a",
          queryId: 1,
          payloadJson: {
            resultJson: ["new"],
            previousResultHash: '["old"]',
            resultHash: '["new"]',
          },
          deliveredAt: null,
        },
      ],
      hasMore: false,
    });

    const delivered: unknown[] = [];
    await expect(
      executor.runLiveQueryDeliveryBatch({
        deploymentId: "deployment_rerun_changed",
        limit: 10,
        deliveredAt: new Date("2026-06-20T00:15:00.000Z"),
        async deliver(deliveries) {
          delivered.push(...deliveries.map((delivery) => delivery.payloadJson));
        },
      }),
    ).resolves.toMatchObject({
      deliveries: [{ connectionId: "connection_a", queryId: 1 }],
      delivered: 1,
      hasMore: false,
    });
    expect(delivered).toMatchObject([
      {
        deploymentId: "deployment_rerun_changed",
        connectionId: "connection_a",
        queryId: 1,
        resultJson: ["new"],
      },
    ]);
    await expect(
      executor.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_rerun_changed",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });
  });

  it("reruns a live query subscription and refreshes unchanged results", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const initial = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_rerun_unchanged",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: { b: 2, a: 1 },
    });

    await expect(
      executor.rerunLiveQuerySubscription({
        subscription: initial.subscription,
        runQuery: async () => ({
          value: { a: 1, b: 2 },
          beginTs: 30,
          readSet: {
            tables: [{ tableId: 2 }],
          },
        }),
      }),
    ).resolves.toMatchObject({
      previousResultHash: '{"a":1,"b":2}',
      resultHash: '{"a":1,"b":2}',
      changed: false,
      delivery: null,
      subscription: {
        beginTs: 30,
        readSetJson: {
          tables: [{ tableId: 2, observedTs: 30 }],
        },
        resultJson: { a: 1, b: 2 },
      },
    });
  });

  it("runs a live query subscription through an invoke query session", async () => {
    const persistence = memoryPersistence(
      [
        deploymentMetadata({
          deploymentId: "deployment_invoke_live_query",
          projectId: "project_live_query",
          activePackageId: "package_live_query",
          activeSchemaVersion: 1,
        }),
      ],
      [
        deploymentPackageMetadata({
          deploymentId: "deployment_invoke_live_query",
          packageId: "package_live_query",
          sourcePackageHash: "a".repeat(64),
          executionModule: "_flarex/execution.js",
          sourcePackageJson: {
            modules: [],
            functions: [],
            execution: "_flarex/execution.js",
          },
          analysisJson: liveQueryAnalysisJson(),
        }),
      ],
      [],
      [
        documentRevision({
          deploymentId: "deployment_invoke_live_query",
          id: "1:message",
          documentId: "message",
          ts: 10,
          value: { text: "hello" },
        }),
      ],
    );
    let nextSession = 0;
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(20) },
      ids: { nextId: () => `session_live_query_${++nextSession}` },
      persistence,
    });
    const recorded = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_invoke_live_query",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_a",
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:message" }] },
      resultJson: null,
    });

    await expect(
      executor.runLiveQuerySubscriptionWithInvoke({
        subscription: recorded.subscription,
        projectId: "project_live_query",
        executeQuery: async (attempt, subscription) => {
          expect(attempt.session).toMatchObject({
            sessionId: "session_live_query_1",
            beginTs: 20,
            function: { path: "messages:list", kind: "query" },
            scope: { partitionKey: "team_a" },
          });
          expect(subscription.functionPath).toBe("messages:list");
          const message = await attempt.syscall({
            op: "get",
            id: "1:message",
          });
          return message.value;
        },
      }),
    ).resolves.toEqual({
      value: { _id: "1:message", text: "hello" },
      beginTs: 20,
      readSet: { documents: [{ tableId: 1, id: "1:message" }] },
    });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_invoke_live_query",
        "session_live_query_1",
      ),
    ).resolves.toMatchObject({ state: "finished", functionKind: "query" });
  });

  it("rejects invoke-backed live query reruns without partition keys", async () => {
    const executor = createFlarexExecutor({ persistence: memoryPersistence() });
    const recorded = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_missing_partition",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: null,
    });

    await expect(
      executor.runLiveQuerySubscriptionWithInvoke({
        subscription: recorded.subscription,
        executeQuery: async () => null,
      }),
    ).rejects.toThrow(LiveQuerySubscriptionRerunError);
  });

  it("validates project ownership for invoke-backed live query reruns", async () => {
    const persistence = memoryPersistence([
      deploymentMetadata({
        deploymentId: "deployment_project_mismatch",
        projectId: "project_actual",
        activePackageId: "package_live_query",
        activeSchemaVersion: 1,
      }),
    ]);
    const executor = createFlarexExecutor({ persistence });
    const recorded = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_project_mismatch",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_a",
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: null,
    });

    await expect(
      executor.runLiveQuerySubscriptionWithInvoke({
        subscription: recorded.subscription,
        projectId: "project_expected",
        executeQuery: async () => null,
      }),
    ).rejects.toThrow(DeploymentProjectMismatchError);
  });

  it("reruns stale live query subscriptions in limited batches", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_batch_rerun",
        ts: 10,
        sequence: 0,
      },
      commitTs: 10,
      documentIds: ["1:fresh"],
      tableIds: [1],
    });
    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_batch_rerun",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["2:changed", "2:unchanged"],
      tableIds: [2],
    });

    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_batch_rerun",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:fresh",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:fresh" }] },
      resultJson: "fresh",
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_batch_rerun",
      connectionId: "connection_a",
      queryId: 2,
      functionPath: "messages:changed",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 2, id: "2:changed" }] },
      resultJson: "old",
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_batch_rerun",
      connectionId: "connection_a",
      queryId: 3,
      functionPath: "messages:unchanged",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 2, id: "2:unchanged" }] },
      resultJson: "same",
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_batch_rerun",
      connectionId: "connection_b",
      queryId: 1,
      functionPath: "messages:range",
      argsJson: {},
      beginTs: 10,
      readSet: { indexes: [{ indexId: 1 }] },
      resultJson: "unsupported",
    });

    const rerunPaths: string[] = [];
    const delivered: unknown[] = [];
    await expect(
      executor.rerunStaleLiveQuerySubscriptions({
        deploymentId: "deployment_batch_rerun",
        freshnessStore,
        limit: 1,
        deliverChanges: async changes => {
          delivered.push(...changes);
        },
        runQuery: async (subscription) => {
          rerunPaths.push(subscription.functionPath);
          return {
            value: subscription.functionPath.endsWith("changed")
              ? "new"
              : "same",
            beginTs: 30,
            readSet: { tables: [{ tableId: 2 }] },
          };
        },
      }),
    ).resolves.toMatchObject({
      scanned: {
        fresh: [{ subscription: { queryId: 1 } }],
        stale: [
          { subscription: { queryId: 2 } },
          { subscription: { queryId: 3 } },
        ],
        unsupported: [{ subscription: { connectionId: "connection_b" } }],
      },
      changed: [
        {
          subscription: { queryId: 2, resultJson: "new" },
          previousResultHash: '"old"',
          resultHash: '"new"',
          changed: true,
          delivery: {
            deploymentId: "deployment_batch_rerun",
            connectionId: "connection_a",
            queryId: 2,
            payloadJson: {
              resultJson: "new",
              previousResultHash: '"old"',
              resultHash: '"new"',
            },
          },
        },
      ],
      changes: [
        {
          deploymentId: "deployment_batch_rerun",
          connectionId: "connection_a",
          queryId: 2,
          functionPath: "messages:changed",
          argsJson: {},
          resultJson: "new",
          previousResultHash: '"old"',
          resultHash: '"new"',
        },
      ],
      unchanged: [],
      unsupported: [{ subscription: { connectionId: "connection_b" } }],
      hasMoreStale: true,
    });
    expect(rerunPaths).toEqual(["messages:changed"]);
    expect(delivered).toEqual([
      {
        deploymentId: "deployment_batch_rerun",
        connectionId: "connection_a",
        queryId: 2,
        functionPath: "messages:changed",
        argsJson: {},
        resultJson: "new",
        previousResultHash: '"old"',
        resultHash: '"new"',
      },
    ]);
    await expect(
      executor.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_batch_rerun",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          connectionId: "connection_a",
          queryId: 2,
          payloadJson: {
            resultJson: "new",
            previousResultHash: '"old"',
            resultHash: '"new"',
          },
          deliveredAt: null,
        },
      ],
    });
  });

  it("reruns stale live query subscriptions and reports unchanged rows", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_batch_unchanged",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["1:same"],
      tableIds: [1],
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_batch_unchanged",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:same",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:same" }] },
      resultJson: { b: 2, a: 1 },
    });

    await expect(
      executor.rerunStaleLiveQuerySubscriptions({
        deploymentId: "deployment_batch_unchanged",
        freshnessStore,
        runQuery: async () => ({
          value: { a: 1, b: 2 },
          beginTs: 25,
          readSet: { tables: [{ tableId: 1 }] },
        }),
      }),
    ).resolves.toMatchObject({
      changed: [],
      changes: [],
      unchanged: [
        {
          previousResultHash: '{"a":1,"b":2}',
          resultHash: '{"a":1,"b":2}',
          changed: false,
          delivery: null,
          subscription: {
            beginTs: 25,
            readSetJson: { tables: [{ tableId: 1, observedTs: 25 }] },
          },
        },
      ],
      hasMoreStale: false,
    });
  });

  it("keeps durable live query deliveries when immediate delivery fails", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_delivery_failure",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["1:changed"],
      tableIds: [1],
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_delivery_failure",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:changed",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:changed" }] },
      resultJson: "old",
    });

    await expect(
      executor.rerunStaleLiveQuerySubscriptions({
        deploymentId: "deployment_delivery_failure",
        freshnessStore,
        deliverChanges: async () => {
          throw new Error("socket delivery failed");
        },
        runQuery: async () => ({
          value: "new",
          beginTs: 25,
          readSet: { documents: [{ tableId: 1, id: "1:changed" }] },
        }),
      }),
    ).rejects.toThrow("socket delivery failed");

    await expect(
      executor.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_delivery_failure",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          connectionId: "connection_a",
          queryId: 1,
          payloadJson: {
            resultJson: "new",
            previousResultHash: '"old"',
            resultHash: '"new"',
          },
          deliveredAt: null,
        },
      ],
      hasMore: false,
    });
  });

  it("rejects invalid stale live query rerun limits", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await expect(
      executor.rerunStaleLiveQuerySubscriptions({
        deploymentId: "deployment_invalid_limit",
        freshnessStore,
        limit: 0,
        runQuery: async () => ({
          value: null,
          beginTs: 1,
          readSet: {},
        }),
      }),
    ).rejects.toThrow("limit must be a positive integer.");
  });
});

function liveQueryAnalysisJson(): Record<string, unknown> {
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
          path: "messages:list",
          kind: "query",
          route: { type: "args", field: "teamId" },
          partition: {
            type: "partition",
            table: "messages",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
      ],
    },
  };
}

function documentRevision(
  overrides: Partial<DocumentRevisionRecord> = {},
): DocumentRevisionRecord {
  return {
    deploymentId: "deployment_live_query",
    id: "1:message",
    tableId: 1,
    documentId: "message",
    ts: 10,
    value: { text: "old" },
    deleted: false,
    prevTs: null,
    ...overrides,
  };
}
