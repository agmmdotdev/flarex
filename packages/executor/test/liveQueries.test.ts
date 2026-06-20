import { describe, expect, it } from "vitest";

import { createMemoryFreshnessMirrorStore } from "@flarex/freshness";
import { createFlarexExecutor, fingerprintJson } from "../src";
import { memoryPersistence } from "./helpers/persistence";

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
      subscription: {
        beginTs: 30,
        readSetJson: {
          tables: [{ tableId: 2, observedTs: 30 }],
        },
        resultJson: { a: 1, b: 2 },
      },
    });
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
    await expect(
      executor.rerunStaleLiveQuerySubscriptions({
        deploymentId: "deployment_batch_rerun",
        freshnessStore,
        limit: 1,
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
        },
      ],
      unchanged: [],
      unsupported: [{ subscription: { connectionId: "connection_b" } }],
      hasMoreStale: true,
    });
    expect(rerunPaths).toEqual(["messages:changed"]);
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
      unchanged: [
        {
          previousResultHash: '{"a":1,"b":2}',
          resultHash: '{"a":1,"b":2}',
          changed: false,
          subscription: {
            beginTs: 25,
            readSetJson: { tables: [{ tableId: 1, observedTs: 25 }] },
          },
        },
      ],
      hasMoreStale: false,
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
