import { describe, expect, it } from "vitest";

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
});
