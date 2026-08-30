import { describe, expect, it } from "vitest";

import { createMemoryFreshnessMirrorStore } from "@flarex/freshness";
import type { DocumentRevisionRecord } from "@flarex/persistence-postgres";
import { executionIdentityFingerprint } from "flarex-protocol/auth";
import type { WritableJson } from "flarex-protocol/json";
import {
  createFlarexExecutor as createBaseFlarexExecutor,
  DeploymentProjectMismatchError,
  fingerprintJson,
  LiveQueryDeliveryPolicyError,
  LiveQuerySubscriptionRerunError,
  type RecordLiveQuerySubscriptionInput,
  type RemoveExpiredLiveQuerySubscriptionsInput,
  type RemoveLiveQuerySubscriptionInput,
  type RemoveLiveQuerySubscriptionsForConnectionInput,
} from "../src";
import {
  deploymentMetadata,
  deploymentPackageMetadata,
  memoryPersistence,
} from "./helpers/persistence";

const anonymousIdentityFingerprint = executionIdentityFingerprint({ kind: "anonymous" });

describe("executor live query subscriptions", () => {
  it("blocks every live-query write behind ready deployment authority", async () => {
    const base = memoryPersistence();
    const authorityFailure = new Error("scope authority is not ready");
    let sideEffects = 0;
    let clockReads = 0;
    const executor = createBaseFlarexExecutor({
      persistence: {
        ...base,
        async ensureDeploymentAuthority() {
          throw authorityFailure;
        },
        async upsertLiveQueryConnectionLease(input) {
          sideEffects += 1;
          return base.upsertLiveQueryConnectionLease(input);
        },
        async upsertLiveQuerySubscriptionWithLease(input) {
          sideEffects += 1;
          return base.upsertLiveQuerySubscriptionWithLease(input);
        },
        async deleteLiveQuerySubscription(input) {
          sideEffects += 1;
          return base.deleteLiveQuerySubscription(input);
        },
        async closeLiveQueryConnection(input) {
          sideEffects += 1;
          return base.closeLiveQueryConnection(input);
        },
        async deleteExpiredLiveQuerySubscriptions(input) {
          sideEffects += 1;
          return base.deleteExpiredLiveQuerySubscriptions(input);
        },
      },
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });
    const authorityInput = {
      deploymentId: "deployment_authority_blocked",
      projectId: "project_authority_blocked",
    } as const;

    await expect(
      executor.touchLiveQueryConnection({
        ...authorityInput,
        connectionId: "connection_blocked",
      }),
    ).rejects.toBe(authorityFailure);
    await expect(
      executor.recordLiveQuerySubscription({
        ...authorityInput,
        connectionId: "connection_blocked",
        queryId: 1,
        functionPath: "messages:list",
        argsJson: {},
        beginTs: 1,
        readSet: {},
        resultJson: [],
      }),
    ).rejects.toBe(authorityFailure);
    await expect(
      executor.removeLiveQuerySubscription({
        ...authorityInput,
        connectionId: "connection_blocked",
        queryId: 1,
      }),
    ).rejects.toBe(authorityFailure);
    await expect(
      executor.removeLiveQuerySubscriptionsForConnection({
        ...authorityInput,
        connectionId: "connection_blocked",
      }),
    ).rejects.toBe(authorityFailure);
    await expect(
      executor.removeExpiredLiveQuerySubscriptions(authorityInput),
    ).rejects.toBe(authorityFailure);

    expect(sideEffects).toBe(0);
    expect(clockReads).toBe(0);
  });

  it("preserves configured clock, override identity, and lease observation order", async () => {
    const basePersistence = memoryPersistence();
    const connectionLeaseTimes: Date[] = [];
    const subscriptionLeaseTimes: Date[] = [];
    const connectionExpiryTimes: Date[] = [];
    const closeTimes: Date[] = [];
    const expiryCutoffs: Date[] = [];
    const activeCutoffs: Date[] = [];
    const persistence = {
      ...basePersistence,
      async upsertLiveQueryConnectionLease(
        input: Parameters<
          typeof basePersistence.upsertLiveQueryConnectionLease
        >[0],
      ) {
        connectionLeaseTimes.push(input.lastSeenAt);
        connectionExpiryTimes.push(input.expiresAt);
        return await basePersistence.upsertLiveQueryConnectionLease(input);
      },
      async upsertLiveQuerySubscriptionWithLease(
        input: Parameters<
          typeof basePersistence.upsertLiveQuerySubscriptionWithLease
        >[0],
      ) {
        subscriptionLeaseTimes.push(input.lastSeenAt);
        return await basePersistence.upsertLiveQuerySubscriptionWithLease(input);
      },
      async closeLiveQueryConnection(
        input: Parameters<typeof basePersistence.closeLiveQueryConnection>[0],
      ) {
        closeTimes.push(input.closedAt);
        return await basePersistence.closeLiveQueryConnection(input);
      },
      async deleteExpiredLiveQuerySubscriptions(
        input: Parameters<
          typeof basePersistence.deleteExpiredLiveQuerySubscriptions
        >[0],
      ) {
        expiryCutoffs.push(input.expiredAt);
        return await basePersistence.deleteExpiredLiveQuerySubscriptions(input);
      },
      async listExpiredLiveQueryConnectionDeployments(
        input: Parameters<
          typeof basePersistence.listExpiredLiveQueryConnectionDeployments
        >[0],
      ) {
        expiryCutoffs.push(input.expiredAt);
        return await basePersistence.listExpiredLiveQueryConnectionDeployments(
          input,
        );
      },
      async listActiveLiveQuerySubscriptions(
        input: Parameters<
          typeof basePersistence.listActiveLiveQuerySubscriptions
        >[0],
      ) {
        activeCutoffs.push(input.activeAt);
        return await basePersistence.listActiveLiveQuerySubscriptions(input);
      },
    };
    const configuredDates = [new Date(100), new Date(200), new Date(500)];
    let clockReads = 0;
    const executor = createBaseFlarexExecutor({
      persistence,
      clock: {
        now: () => {
          const value = configuredDates[clockReads];
          clockReads += 1;
          if (value === undefined) {
            throw new Error("live query clock read more than expected");
          }
          return value;
        },
      },
    });
    const deploymentId = "deployment_live_query_time_compat";
    const projectId = "project_live_query_time_compat";
    const explicitUpdatedAt = new Date(300);
    const explicitExpiredAt = new Date(50);
    const explicitActiveAt = new Date(400);
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await executor.touchLiveQueryConnection({
      deploymentId,
      projectId,
      connectionId: "connection_touch",
      leaseDurationMs: 25,
    });
    await executor.recordLiveQuerySubscription({
      deploymentId,
      projectId,
      connectionId: "connection_subscription",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 1,
      readSet: {},
      resultJson: null,
    });
    await executor.recordLiveQuerySubscription({
      deploymentId,
      projectId,
      connectionId: "connection_explicit",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 1,
      readSet: {},
      resultJson: null,
      updatedAt: explicitUpdatedAt,
    });
    await executor.removeExpiredLiveQuerySubscriptions({
      deploymentId,
      projectId,
      expiredAt: explicitExpiredAt,
    });
    await executor.listExpiredLiveQueryConnectionDeployments({
      expiredAt: explicitExpiredAt,
    });
    await executor.findStaleLiveQuerySubscriptions({
      deploymentId,
      freshnessStore,
      activeAt: explicitActiveAt,
    });
    await executor.rerunStaleLiveQuerySubscriptions({
      deploymentId,
      freshnessStore,
      activeAt: explicitActiveAt,
      async runQuery() {
        throw new Error("fresh subscriptions must not rerun");
      },
    });
    await executor.removeLiveQuerySubscriptionsForConnection({
      deploymentId,
      projectId,
      connectionId: "connection_touch",
    });

    expect(clockReads).toBe(3);
    expect(connectionLeaseTimes).toEqual([configuredDates[0]]);
    expect(connectionExpiryTimes).toEqual([new Date(125)]);
    expect(subscriptionLeaseTimes).toEqual([
      configuredDates[1],
      explicitUpdatedAt,
    ]);
    expect(expiryCutoffs).toEqual([explicitExpiredAt, explicitExpiredAt]);
    expect(activeCutoffs).toEqual([explicitActiveAt, explicitActiveAt]);
    expect(closeTimes).toEqual([configuredDates[2]]);
  });

  it("preserves clock and persistence failures at the public boundary", async () => {
    const clockFailure = new Error("live query clock failed");
    const clockBasePersistence = memoryPersistence();
    let leaseWrites = 0;
    const clockExecutor = createBaseFlarexExecutor({
      persistence: {
        ...clockBasePersistence,
        async upsertLiveQueryConnectionLease(input) {
          leaseWrites += 1;
          return await clockBasePersistence.upsertLiveQueryConnectionLease(input);
        },
      },
      clock: { now: () => { throw clockFailure; } },
    });

    await expect(clockExecutor.touchLiveQueryConnection({
      deploymentId: "deployment_live_query_clock_failure",
      projectId: "project_live_query_clock_failure",
      connectionId: "connection_failure",
    })).rejects.toBe(clockFailure);
    expect(leaseWrites).toBe(0);

    const invalidLeaseBase = memoryPersistence();
    let invalidLeaseClockReads = 0;
    let invalidLeaseWrites = 0;
    const invalidLeaseExecutor = createBaseFlarexExecutor({
      persistence: {
        ...invalidLeaseBase,
        async upsertLiveQueryConnectionLease(input) {
          invalidLeaseWrites += 1;
          return await invalidLeaseBase.upsertLiveQueryConnectionLease(input);
        },
      },
      clock: {
        now: () => {
          invalidLeaseClockReads += 1;
          return new Date(100);
        },
      },
    });

    await expect(invalidLeaseExecutor.touchLiveQueryConnection({
      deploymentId: "deployment_live_query_invalid_lease",
      projectId: "project_live_query_invalid_lease",
      connectionId: "connection_invalid_lease",
      leaseDurationMs: 0,
    })).rejects.toThrow("leaseDurationMs must be a positive integer.");
    expect(invalidLeaseClockReads).toBe(1);
    expect(invalidLeaseWrites).toBe(0);

    const persistenceFailure = new Error("live query expiry scan failed");
    const persistenceBase = memoryPersistence();
    let persistenceClockReads = 0;
    const persistenceExecutor = createBaseFlarexExecutor({
      persistence: {
        ...persistenceBase,
        async listExpiredLiveQueryConnectionDeployments(): Promise<never> {
          throw persistenceFailure;
        },
      },
      clock: {
        now: () => {
          persistenceClockReads += 1;
          return new Date(100);
        },
      },
    });
    const expiredAt = new Date(50);

    await expect(
      persistenceExecutor.listExpiredLiveQueryConnectionDeployments({
        expiredAt,
      }),
    ).rejects.toBe(persistenceFailure);
    expect(persistenceClockReads).toBe(0);
  });

  it("reads close and cutoff deployment keys before acquiring time", async () => {
    const deploymentId = "deployment_live_query_key_order";
    const projectId = "project_live_query_key_order";
    const closeKeyFailure = new Error("close deployment key read failed");
    const expiryKeyFailure = new Error("expiry deployment key read failed");
    const activeKeyFailure = new Error("active deployment key read failed");
    const basePersistence = memoryPersistence();
    let closeCalls = 0;
    let expiryCalls = 0;
    let activeListCalls = 0;
    let clockReads = 0;
    const executor = createBaseFlarexExecutor({
      persistence: {
        ...basePersistence,
        async ensureDeploymentAuthority() {
          return {
            deployment: deploymentMetadata({ deploymentId, projectId }),
            createdDeployment: false,
          };
        },
        async closeLiveQueryConnection(input) {
          closeCalls += 1;
          return await basePersistence.closeLiveQueryConnection(input);
        },
        async deleteExpiredLiveQuerySubscriptions(input) {
          expiryCalls += 1;
          return await basePersistence.deleteExpiredLiveQuerySubscriptions(input);
        },
        async listActiveLiveQuerySubscriptions(input) {
          activeListCalls += 1;
          return await basePersistence.listActiveLiveQuerySubscriptions(input);
        },
      },
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });

    await expect(executor.removeLiveQuerySubscriptionsForConnection({
      get deploymentId(): string {
        throw closeKeyFailure;
      },
      projectId,
      connectionId: "connection_key_order",
    })).rejects.toBe(closeKeyFailure);
    await expect(executor.removeExpiredLiveQuerySubscriptions({
      get deploymentId(): string {
        throw expiryKeyFailure;
      },
      projectId,
    })).rejects.toBe(expiryKeyFailure);
    await expect(executor.findStaleLiveQuerySubscriptions({
      get deploymentId(): string {
        throw activeKeyFailure;
      },
      freshnessStore: createMemoryFreshnessMirrorStore(),
    })).rejects.toBe(activeKeyFailure);

    expect(clockReads).toBe(0);
    expect(closeCalls).toBe(0);
    expect(expiryCalls).toBe(0);
    expect(activeListCalls).toBe(0);
  });

  it("reads persistence methods before acquiring their inline clock value", async () => {
    const methodFailure = new Error("close method getter failed");
    const basePersistence = memoryPersistence();
    let methodReads = 0;
    let clockReads = 0;
    const executor = createBaseFlarexExecutor({
      persistence: {
        ...basePersistence,
        get closeLiveQueryConnection(): never {
          methodReads += 1;
          throw methodFailure;
        },
      },
      clock: {
        now: () => {
          clockReads += 1;
          throw new Error("clock must not win failure precedence");
        },
      },
    });

    await expect(executor.removeLiveQuerySubscriptionsForConnection({
      deploymentId: "deployment_live_query_method_order",
      projectId: "project_live_query_method_order",
      connectionId: "connection_method_order",
    })).rejects.toBe(methodFailure);
    expect(methodReads).toBe(1);
    expect(clockReads).toBe(0);
  });

  it("records a live query subscription with timestamped read set and result hash", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });

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
    const executor = createLiveQueryExecutor({ persistence });

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
    const executor = createLiveQueryExecutor({ persistence });

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

  it("removes all live query subscriptions for a connection", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });

    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_remove_connection",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      identity: {
        kind: "user",
        user: {
          tokenIdentifier: "issuer|user_a",
          subject: "user_a",
          issuer: "issuer",
        },
      },
      partitionKey: "team_a",
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:message" }] },
      resultJson: ["first"],
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_remove_connection",
      connectionId: "connection_a",
      queryId: 2,
      functionPath: "messages:count",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_a",
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: 1,
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_remove_connection",
      connectionId: "connection_b",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_b" },
      partitionKey: "team_b",
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:other" }] },
      resultJson: ["other"],
    });

    await expect(
      executor.removeLiveQuerySubscriptionsForConnection({
        deploymentId: "deployment_remove_connection",
        connectionId: "connection_a",
      }),
    ).resolves.toEqual({ deleted: 2 });
    await expect(
      executor.removeLiveQuerySubscriptionsForConnection({
        deploymentId: "deployment_remove_connection",
        connectionId: "connection_a",
      }),
    ).resolves.toEqual({ deleted: 0 });
    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_remove_connection",
      }),
    ).resolves.toMatchObject([
      {
        connectionId: "connection_b",
        queryId: 1,
      },
    ]);

    const freshnessStore = createMemoryFreshnessMirrorStore();
    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_remove_connection",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["1:message"],
      tableIds: [1],
    });

    await expect(
      executor.rerunStaleLiveQuerySubscriptions({
        deploymentId: "deployment_remove_connection",
        freshnessStore,
        runQuery: () => {
          throw new Error("deleted connection subscriptions should not rerun");
        },
      }),
    ).resolves.toMatchObject({
      changed: [],
      unchanged: [],
      changes: [],
    });
  });

  it("fingerprints object results with stable key order", () => {
    expect(fingerprintJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
  });

  it("fails explicitly when a typed result loses an array item", () => {
    const sparse: WritableJson[] = [];
    sparse.length = 1;

    expect(() => fingerprintJson(sparse)).toThrow(
      "Live-query result lost its validated JSON shape while fingerprinting (missingArrayItem).",
    );
  });

  it("classifies live query subscriptions by freshness", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });
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
                reason: "index/range freshness requires durable index history",
              },
            ],
          },
        },
      ],
    });
  });

  it("excludes expired connection leases from stale live query scans", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_expired_live_query",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["1:message"],
      tableIds: [1],
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_expired_live_query",
      connectionId: "connection_expired",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: {
        documents: [{ tableId: 1, id: "1:message" }],
      },
      resultJson: "stale",
      updatedAt: new Date("2026-06-20T00:00:00.000Z"),
    });

    await expect(
      executor.findStaleLiveQuerySubscriptions({
        deploymentId: "deployment_expired_live_query",
        freshnessStore,
        activeAt: new Date("2026-06-20T00:02:00.000Z"),
      }),
    ).resolves.toEqual({
      fresh: [],
      stale: [],
      unsupported: [],
    });
  });

  it("removes expired live query subscriptions through executor maintenance", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });

    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_expired_cleanup",
      connectionId: "connection_expired",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: {
        documents: [{ tableId: 1, id: "1:message" }],
      },
      resultJson: "expired",
      updatedAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_expired_cleanup",
      connectionId: "connection_active",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: {
        documents: [{ tableId: 1, id: "1:other" }],
      },
      resultJson: "active",
      updatedAt: new Date("2026-06-20T00:02:00.000Z"),
    });

    await expect(
      executor.removeExpiredLiveQuerySubscriptions({
        deploymentId: "deployment_expired_cleanup",
        expiredAt: new Date("2026-06-20T00:01:30.000Z"),
      }),
    ).resolves.toEqual({ deleted: 1, deletedConnections: 1 });
    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_expired_cleanup",
      }),
    ).resolves.toMatchObject([
      {
        connectionId: "connection_active",
        queryId: 1,
      },
    ]);
  });

  it("lists deployments with expired live query connections for cleanup", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });

    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_cleanup_a",
      connectionId: "connection_expired_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:message" }] },
      resultJson: "expired_a",
      updatedAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_cleanup_b",
      connectionId: "connection_expired_b",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:other" }] },
      resultJson: "expired_b",
      updatedAt: new Date("2026-06-20T00:01:00.000Z"),
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_cleanup_b",
      connectionId: "connection_active_b",
      queryId: 2,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:active" }] },
      resultJson: "active_b",
      updatedAt: new Date("2026-06-20T00:04:00.000Z"),
    });

    const page = await executor.listExpiredLiveQueryConnectionDeployments({
      expiredAt: new Date("2026-06-20T00:02:30.000Z"),
      limit: 1,
    });
    expect(page).toMatchObject({
      deployments: [
        {
          deploymentId: "deployment_cleanup_a",
          projectId: "project_live_query",
          oldestExpiredAt: new Date("2026-06-20T00:01:00.000Z"),
          expiredConnections: 1,
        },
      ],
      hasMore: true,
    });

    expect(page.nextCursor).not.toBeNull();
    const nextCursor = page.nextCursor;
    if (nextCursor === null) {
      throw new Error("Expected expired connection scan to return a cursor.");
    }

    await expect(
      executor.listExpiredLiveQueryConnectionDeployments({
        expiredAt: new Date("2026-06-20T00:02:30.000Z"),
        cursor: nextCursor,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deployments: [
        {
          deploymentId: "deployment_cleanup_b",
          projectId: "project_live_query",
          oldestExpiredAt: new Date("2026-06-20T00:02:00.000Z"),
          expiredConnections: 1,
        },
      ],
      hasMore: false,
    });
  });

  it("uses deployment id as the expired connection scan cursor tie breaker", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });

    for (const deploymentId of ["deployment_tie_a", "deployment_tie_b"]) {
      await persistence.ensureDeploymentAuthority({
        deploymentId,
        projectId: "project_live_query",
      });
      await executor.recordLiveQuerySubscription({
        deploymentId,
        connectionId: "connection_tie",
        queryId: 1,
        functionPath: "messages:list",
        argsJson: {},
        beginTs: 10,
        readSet: { documents: [{ tableId: 1, id: `1:${deploymentId}` }] },
        resultJson: deploymentId,
        updatedAt: new Date("2026-06-20T00:01:00.000Z"),
      });
    }

    const first = await executor.listExpiredLiveQueryConnectionDeployments({
      expiredAt: new Date("2026-06-20T00:02:00.000Z"),
      limit: 1,
    });
    expect(first.deployments.map((deployment) => deployment.deploymentId)).toEqual([
      "deployment_tie_a",
    ]);
    expect(first.nextCursor).not.toBeNull();
    const nextCursor = first.nextCursor;
    if (nextCursor === null) {
      throw new Error("Expected tied expired connection scan to return a cursor.");
    }

    const second = await executor.listExpiredLiveQueryConnectionDeployments({
      expiredAt: new Date("2026-06-20T00:02:00.000Z"),
      cursor: nextCursor,
      limit: 1,
    });
    expect(second.deployments.map((deployment) => deployment.deploymentId)).toEqual([
      "deployment_tie_b",
    ]);
    expect(second.hasMore).toBe(false);
  });

  it("validates expired live query connection deployment scan limits", async () => {
    const basePersistence = memoryPersistence();
    let listCalls = 0;
    let clockReads = 0;
    const executor = createLiveQueryExecutor({
      persistence: {
        ...basePersistence,
        async listExpiredLiveQueryConnectionDeployments(input) {
          listCalls += 1;
          return await basePersistence.listExpiredLiveQueryConnectionDeployments(
            input,
          );
        },
      },
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });

    await expect(
      executor.listExpiredLiveQueryConnectionDeployments({
        limit: 0,
      }),
    ).rejects.toThrow(LiveQueryDeliveryPolicyError);
    expect(listCalls).toBe(0);
    expect(clockReads).toBe(0);
  });

  it("reruns a live query subscription and reports changed results", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });
    const identity = {
      kind: "user",
      user: {
        tokenIdentifier: "issuer|user_a",
        subject: "user_a",
        issuer: "issuer",
      },
    } as const;
    const identityFingerprint = executionIdentityFingerprint(identity);
    const initial = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_rerun_changed",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: ["old"],
      identity,
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
          identityFingerprint,
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
    const payloadJson = (await persistence.listUndeliveredLiveQueryDeliveries({
      deploymentId: "deployment_rerun_changed",
      limit: 10,
    })).deliveries[0]?.payloadJson;
    expect(JSON.stringify(payloadJson)).not.toContain("issuer|user_a");
    expect(JSON.stringify(payloadJson)).not.toContain("user_a");
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
      summary: {
        claimed: 1,
        delivered: 1,
        acked: 1,
        pending: 0,
        hasMore: false,
      },
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

  it("records a failed live query rerun as a durable failure delivery", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });
    const initial = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_rerun_failed",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:uniqueByText",
      argsJson: { teamId: "team_a", text: "dupe" },
      partitionKey: "team_a",
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: { _id: "1:old", teamId: "team_a", text: "dupe" },
    });

    await expect(
      executor.rerunLiveQuerySubscription({
        subscription: initial.subscription,
        deliveryId: "delivery_failed_1",
        updatedAt: new Date("2026-06-20T00:20:00.000Z"),
        runQuery: async () => {
          throw new Error("Query returned more than one document.");
        },
      }),
    ).resolves.toMatchObject({
      status: "failed",
      previousResultHash: '{"_id":"1:old","teamId":"team_a","text":"dupe"}',
      changed: true,
      deleted: 1,
      delivery: {
        deploymentId: "deployment_rerun_failed",
        connectionId: "connection_a",
        queryId: 1,
        payloadJson: {
          kind: "failed",
          deploymentId: "deployment_rerun_failed",
          connectionId: "connection_a",
          queryId: 1,
          functionPath: "messages:uniqueByText",
          argsJson: { teamId: "team_a", text: "dupe" },
          previousResultHash: '{"_id":"1:old","teamId":"team_a","text":"dupe"}',
          errorMessage: "Query returned more than one document.",
          errorData: null,
        },
      },
    });
    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_rerun_failed",
      }),
    ).resolves.toEqual([]);
    await expect(
      executor.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_rerun_failed",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deploymentId: "deployment_rerun_failed",
          connectionId: "connection_a",
          queryId: 1,
          payloadJson: {
            kind: "failed",
            previousResultHash: '{"_id":"1:old","teamId":"team_a","text":"dupe"}',
            errorMessage: "Query returned more than one document.",
            errorData: null,
          },
          deliveredAt: null,
        },
      ],
      hasMore: false,
    });
  });

  it("claims and acks live query deliveries without owning fanout", async () => {
    const persistence = memoryPersistence();
    let now = new Date("2026-06-20T01:00:00.000Z");
    const executor = createLiveQueryExecutor({
      persistence,
      clock: { now: () => now },
    });
    const initial = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_claim_ack",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: ["old"],
    });

    await executor.rerunLiveQuerySubscription({
      subscription: initial.subscription,
      deliveryId: "delivery_claim_1",
      runQuery: async () => ({
        value: ["new"],
        beginTs: 20,
        readSet: { tables: [{ tableId: 1 }] },
      }),
    });

    await expect(
      executor.claimLiveQueryDeliveryBatch({
        deploymentId: "deployment_claim_ack",
        limit: 10,
        leaseDurationMs: 60_000,
        claimOwner: "delivery:deployment_claim_ack",
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId: "delivery_claim_1",
          connectionId: "connection_a",
          queryId: 1,
          deliveredAt: null,
          claimedAt: new Date("2026-06-20T01:00:00.000Z"),
          claimExpiresAt: new Date("2026-06-20T01:01:00.000Z"),
          claimOwner: "delivery:deployment_claim_ack",
        },
      ],
      hasMore: false,
    });
    await expect(
      executor.claimLiveQueryDeliveryBatch({
        deploymentId: "deployment_claim_ack",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });

    now = new Date("2026-06-20T01:01:00.000Z");
    await expect(
      executor.claimLiveQueryDeliveryBatch({
        deploymentId: "deployment_claim_ack",
        limit: 10,
        leaseDurationMs: 30_000,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId: "delivery_claim_1",
          claimedAt: new Date("2026-06-20T01:01:00.000Z"),
          claimExpiresAt: new Date("2026-06-20T01:01:30.000Z"),
        },
      ],
      hasMore: false,
    });

    await expect(
      executor.ackLiveQueryDeliveries({
        deploymentId: "deployment_claim_ack",
        deliveryIds: ["delivery_claim_1"],
      }),
    ).resolves.toEqual({ delivered: 1 });
    await expect(
      executor.claimLiveQueryDeliveryBatch({
        deploymentId: "deployment_claim_ack",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });
  });

  it("preserves delivery clock placement, Date identity, and override suppression", async () => {
    const basePersistence = memoryPersistence();
    const claimDates: Date[] = [];
    const expiryDates: Date[] = [];
    const deliveredDates: Date[] = [];
    const persistence = {
      ...basePersistence,
      async claimLiveQueryDeliveries(
        input: Parameters<typeof basePersistence.claimLiveQueryDeliveries>[0],
      ) {
        claimDates.push(input.claimedAt);
        expiryDates.push(input.claimExpiresAt);
        return { deliveries: [], nextCursor: null, hasMore: false as const };
      },
      async markLiveQueryDeliveriesDelivered(
        input: Parameters<
          typeof basePersistence.markLiveQueryDeliveriesDelivered
        >[0],
      ) {
        deliveredDates.push(input.deliveredAt);
        return { delivered: 0 };
      },
    };
    const configuredClaimAt = new Date(100);
    const configuredDeliveredAt = new Date(200);
    const explicitDeliveredAt = new Date(300);
    const configuredDates = [configuredClaimAt, configuredDeliveredAt];
    let clockReads = 0;
    const executor = createBaseFlarexExecutor({
      persistence,
      clock: {
        now: () => {
          const selected = configuredDates[clockReads];
          clockReads += 1;
          if (selected === undefined) {
            throw new Error("delivery clock read more than expected");
          }
          return selected;
        },
      },
    });

    await executor.claimLiveQueryDeliveryBatch({
      deploymentId: "deployment_delivery_clock_compat",
      leaseDurationMs: 50,
    });
    await executor.ackLiveQueryDeliveries({
      deploymentId: "deployment_delivery_clock_compat",
      deliveryIds: [],
    });
    await executor.ackLiveQueryDeliveries({
      deploymentId: "deployment_delivery_clock_compat",
      deliveryIds: [],
      deliveredAt: explicitDeliveredAt,
    });

    expect(clockReads).toBe(2);
    expect(claimDates[0]).toBe(configuredClaimAt);
    expect(expiryDates).toEqual([new Date(150)]);
    expect(expiryDates[0]).not.toBe(configuredClaimAt);
    expect(deliveredDates[0]).toBe(configuredDeliveredAt);
    expect(deliveredDates[1]).toBe(explicitDeliveredAt);
  });

  it("preserves delivery validation and persistence-method failure precedence", async () => {
    const basePersistence = memoryPersistence();
    const claimMethodFailure = new Error("claim method getter failed");
    const acknowledgementMethodFailure = new Error(
      "acknowledgement method getter failed",
    );
    let clockReads = 0;
    let claimMethodReads = 0;
    const claimExecutor = createBaseFlarexExecutor({
      persistence: {
        ...basePersistence,
        get claimLiveQueryDeliveries(): never {
          claimMethodReads += 1;
          throw claimMethodFailure;
        },
      },
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });

    await expect(claimExecutor.claimLiveQueryDeliveryBatch({
      deploymentId: "deployment_delivery_method_order",
      limit: 0,
    })).rejects.toBeInstanceOf(LiveQueryDeliveryPolicyError);
    expect(clockReads).toBe(0);
    expect(claimMethodReads).toBe(0);

    await expect(claimExecutor.claimLiveQueryDeliveryBatch({
      deploymentId: "deployment_delivery_method_order",
    })).rejects.toBe(claimMethodFailure);
    expect(clockReads).toBe(1);
    expect(claimMethodReads).toBe(1);

    const clockFailure = new Error("delivery claim clock failed");
    let clockFailureMethodReads = 0;
    const clockFailureExecutor = createBaseFlarexExecutor({
      persistence: {
        ...basePersistence,
        get claimLiveQueryDeliveries() {
          clockFailureMethodReads += 1;
          return basePersistence.claimLiveQueryDeliveries;
        },
      },
      clock: { now: () => { throw clockFailure; } },
    });
    await expect(clockFailureExecutor.claimLiveQueryDeliveryBatch({
      deploymentId: "deployment_delivery_clock_failure",
    })).rejects.toBe(clockFailure);
    expect(clockFailureMethodReads).toBe(0);

    let acknowledgementClockReads = 0;
    let acknowledgementMethodReads = 0;
    const acknowledgementExecutor = createBaseFlarexExecutor({
      persistence: {
        ...basePersistence,
        get markLiveQueryDeliveriesDelivered(): never {
          acknowledgementMethodReads += 1;
          throw acknowledgementMethodFailure;
        },
      },
      clock: {
        now: () => {
          acknowledgementClockReads += 1;
          throw new Error("acknowledgement clock must not win");
        },
      },
    });

    await expect(acknowledgementExecutor.ackLiveQueryDeliveries({
      deploymentId: "deployment_delivery_method_order",
      deliveryIds: [],
    })).rejects.toBe(acknowledgementMethodFailure);
    expect(acknowledgementMethodReads).toBe(1);
    expect(acknowledgementClockReads).toBe(0);
  });

  it("lists deployments with pending live query delivery rows", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });
    const first = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_pending_a",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: ["old"],
    });
    const second = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_pending_b",
      connectionId: "connection_b",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSet: { tables: [{ tableId: 1 }] },
      resultJson: ["old"],
    });

    await executor.rerunLiveQuerySubscription({
      subscription: first.subscription,
      deliveryId: "delivery_a1",
      updatedAt: new Date("2026-06-20T00:00:10.000Z"),
      runQuery: async () => ({
        value: ["new_a"],
        beginTs: 20,
        readSet: { tables: [{ tableId: 1 }] },
      }),
    });
    await executor.rerunLiveQuerySubscription({
      subscription: second.subscription,
      deliveryId: "delivery_b1",
      updatedAt: new Date("2026-06-20T00:00:20.000Z"),
      runQuery: async () => ({
        value: ["new_b"],
        beginTs: 20,
        readSet: { tables: [{ tableId: 1 }] },
      }),
    });

    const page = await executor.listPendingLiveQueryDeliveryDeployments({
      limit: 1,
    });
    expect(page).toMatchObject({
      deployments: [
        {
          deploymentId: "deployment_pending_a",
          oldestCreatedAt: new Date("2026-06-20T00:00:10.000Z"),
          pending: 1,
        },
      ],
      hasMore: true,
    });

    await expect(
      executor.listPendingLiveQueryDeliveryDeployments({
        cursor: page.nextCursor!,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deployments: [
        {
          deploymentId: "deployment_pending_b",
          oldestCreatedAt: new Date("2026-06-20T00:00:20.000Z"),
          pending: 1,
        },
      ],
      hasMore: false,
    });
  });

  it("validates live query delivery claim limits", async () => {
    const executor = createLiveQueryExecutor({ persistence: memoryPersistence() });

    await expect(
      executor.claimLiveQueryDeliveryBatch({
        deploymentId: "deployment_invalid_claim",
        limit: 0,
      }),
    ).rejects.toThrow(LiveQueryDeliveryPolicyError);
    await expect(
      executor.listPendingLiveQueryDeliveryDeployments({
        limit: 0,
      }),
    ).rejects.toThrow(LiveQueryDeliveryPolicyError);
  });

  it("reruns a live query subscription and refreshes unchanged results", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });
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
    const executor = createLiveQueryExecutor({
      clock: { now: () => new Date(20) },
      ids: { nextId: () => `session_live_query_${++nextSession}` },
      persistence,
    });
    const identity = {
      kind: "user",
      user: {
        tokenIdentifier: "issuer|user_a",
        subject: "user_a",
        issuer: "issuer",
      },
    } as const;
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
      identity,
    });

    await expect(
      executor.runLiveQuerySubscriptionWithInvoke({
        subscription: recorded.subscription,
        projectId: "project_live_query",
        executeQuery: async (attempt, subscription) => {
          expect(attempt.session).toMatchObject({
            sessionId: "session_live_query_1",
            beginTs: 20,
            identity,
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
      readSet: {
        documents: [{ tableId: 1, id: "1:message", observedTs: 10 }],
      },
    });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_invoke_live_query",
        "session_live_query_1",
      ),
    ).resolves.toMatchObject({ state: "finished", functionKind: "query" });
  });

  it("rejects invoke-backed live query reruns without partition keys", async () => {
    const executor = createLiveQueryExecutor({ persistence: memoryPersistence() });
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
    const executor = createLiveQueryExecutor({ persistence });
    const recorded = await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_project_mismatch",
      projectId: "project_actual",
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
    const executor = createLiveQueryExecutor({ persistence });
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
          identityFingerprint: anonymousIdentityFingerprint,
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
        kind: "updated",
        deploymentId: "deployment_batch_rerun",
        connectionId: "connection_a",
        queryId: 2,
        functionPath: "messages:changed",
        argsJson: {},
        identityFingerprint: anonymousIdentityFingerprint,
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
            kind: "updated",
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
    const executor = createLiveQueryExecutor({ persistence });
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
    const executor = createLiveQueryExecutor({ persistence });
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

  it("records live query delivery failure attempts while keeping rows pending", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_delivery_record_failure",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["1:changed"],
      tableIds: [1],
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_delivery_record_failure",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:changed",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:changed" }] },
      resultJson: "old",
    });
    await executor.rerunStaleLiveQuerySubscriptions({
      deploymentId: "deployment_delivery_record_failure",
      freshnessStore,
      runQuery: async () => ({
        value: "new",
        beginTs: 25,
        readSet: { documents: [{ tableId: 1, id: "1:changed" }] },
      }),
    });
    const page = await executor.listUndeliveredLiveQueryDeliveries({
      deploymentId: "deployment_delivery_record_failure",
      limit: 10,
    });
    const deliveryId = page.deliveries[0]!.deliveryId;

    await expect(
      executor.recordLiveQueryDeliveryFailure({
        deploymentId: "deployment_delivery_record_failure",
        deliveryIds: [deliveryId],
        stage: "ack",
        error: "executor ack failed",
        failedAt: new Date("2026-06-20T00:02:00.000Z"),
      }),
    ).resolves.toEqual({ failed: 1 });

    await expect(
      executor.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_delivery_record_failure",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId,
          deliveredAt: null,
          attemptCount: 1,
          lastAttemptedAt: new Date("2026-06-20T00:02:00.000Z"),
          lastErrorStage: "ack",
          lastError: "executor ack failed",
        },
      ],
      hasMore: false,
    });
  });

  it("lists stuck live query delivery candidates", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_stuck_delivery",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["1:changed"],
      tableIds: [1],
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_stuck_delivery",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:changed",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:changed" }] },
      resultJson: "old",
    });
    await executor.rerunStaleLiveQuerySubscriptions({
      deploymentId: "deployment_stuck_delivery",
      freshnessStore,
      runQuery: async () => ({
        value: "new",
        beginTs: 25,
        readSet: { documents: [{ tableId: 1, id: "1:changed" }] },
      }),
    });
    const page = await executor.listUndeliveredLiveQueryDeliveries({
      deploymentId: "deployment_stuck_delivery",
      limit: 10,
    });
    const deliveryId = page.deliveries[0]!.deliveryId;
    await executor.recordLiveQueryDeliveryFailure({
      deploymentId: "deployment_stuck_delivery",
      deliveryIds: [deliveryId],
      stage: "fanout",
      error: "connection failed",
      failedAt: new Date("2026-06-20T00:01:00.000Z"),
    });

    await expect(
      executor.listStuckLiveQueryDeliveries({
        deploymentId: "deployment_stuck_delivery",
        olderThan: new Date("2026-06-20T00:05:00.000Z"),
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId,
          attemptCount: 1,
          lastErrorStage: "fanout",
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("dead-letters stuck live query deliveries and returns reconnect targets", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({
      persistence,
      clock: { now: () => new Date("2026-06-20T00:10:00.000Z") },
    });
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await freshnessStore.applyCommitFreshness({
      eventKey: {
        deploymentId: "deployment_dead_letter_policy",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["1:changed"],
      tableIds: [1],
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_dead_letter_policy",
      connectionId: "connection_b",
      queryId: 1,
      functionPath: "messages:changed",
      argsJson: {},
      beginTs: 10,
      readSet: { documents: [{ tableId: 1, id: "1:changed" }] },
      resultJson: "old",
    });
    await executor.rerunStaleLiveQuerySubscriptions({
      deploymentId: "deployment_dead_letter_policy",
      freshnessStore,
      runQuery: async () => ({
        value: "new",
        beginTs: 25,
        readSet: { documents: [{ tableId: 1, id: "1:changed" }] },
      }),
    });
    const page = await executor.listUndeliveredLiveQueryDeliveries({
      deploymentId: "deployment_dead_letter_policy",
      limit: 10,
    });
    const deliveryId = page.deliveries[0]!.deliveryId;
    await executor.recordLiveQueryDeliveryFailure({
      deploymentId: "deployment_dead_letter_policy",
      deliveryIds: [deliveryId],
      stage: "fanout",
      error: "connection failed",
      failedAt: new Date("2026-06-20T00:01:00.000Z"),
    });

    await expect(
      executor.deadLetterStuckLiveQueryDeliveries({
        deploymentId: "deployment_dead_letter_policy",
        olderThan: new Date("2026-06-20T00:05:00.000Z"),
        reason: "force reconnect after repeated delivery failure",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      scanned: [{ deliveryId }],
      deadLettered: [
        {
          deliveryId,
          deadLetteredAt: new Date("2026-06-20T00:10:00.000Z"),
          deadLetterReason: "force reconnect after repeated delivery failure",
        },
      ],
      reconnectConnectionIds: ["connection_b"],
      nextCursor: null,
      hasMore: false,
      summary: {
        scanned: 1,
        deadLettered: 1,
        reconnectTargets: 1,
        hasMore: false,
      },
    });

    await expect(
      executor.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_dead_letter_policy",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });
  });

  it("rejects invalid live query delivery failure reports", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });

    await expect(
      executor.recordLiveQueryDeliveryFailure({
        deploymentId: "deployment_invalid_failure",
        deliveryIds: ["delivery_1"],
        stage: "claim" as "fanout",
        error: "bad",
        failedAt: new Date("2026-06-20T00:02:00.000Z"),
      }),
    ).rejects.toThrow("stage must be fanout or ack.");
  });

  it("rejects invalid live query delivery dead-letter requests", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });

    await expect(
      executor.deadLetterStuckLiveQueryDeliveries({
        olderThan: new Date("2026-06-20T00:05:00.000Z"),
        reason: "",
        limit: 10,
      }),
    ).rejects.toThrow("reason must be a non-empty string.");
  });

  it("rejects invalid stuck live query delivery limits", async () => {
    const persistence = memoryPersistence();
    const executor = createLiveQueryExecutor({ persistence });

    await expect(
      executor.listStuckLiveQueryDeliveries({
        olderThan: new Date("2026-06-20T00:05:00.000Z"),
        minAttempts: 0,
        limit: 10,
      }),
    ).rejects.toThrow("minAttempts must be a positive integer.");
  });

  it("rejects invalid stale live query rerun limits", async () => {
    const basePersistence = memoryPersistence();
    let listCalls = 0;
    let clockReads = 0;
    const executor = createLiveQueryExecutor({
      persistence: {
        ...basePersistence,
        async listActiveLiveQuerySubscriptions(input) {
          listCalls += 1;
          return await basePersistence.listActiveLiveQuerySubscriptions(input);
        },
      },
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });
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
    expect(listCalls).toBe(0);
    expect(clockReads).toBe(0);
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

function createLiveQueryExecutor(
  config: Parameters<typeof createBaseFlarexExecutor>[0],
) {
  const executor = createBaseFlarexExecutor(config);
  return {
    ...executor,
    recordLiveQuerySubscription: (
      input: Omit<RecordLiveQuerySubscriptionInput, "projectId"> &
        Partial<Pick<RecordLiveQuerySubscriptionInput, "projectId">>,
    ) =>
      executor.recordLiveQuerySubscription({
        projectId: "project_live_query",
        ...input,
      }),
    removeLiveQuerySubscription: (
      input: Omit<RemoveLiveQuerySubscriptionInput, "projectId"> &
        Partial<Pick<RemoveLiveQuerySubscriptionInput, "projectId">>,
    ) =>
      executor.removeLiveQuerySubscription({
        projectId: "project_live_query",
        ...input,
      }),
    removeLiveQuerySubscriptionsForConnection: (
      input: Omit<RemoveLiveQuerySubscriptionsForConnectionInput, "projectId"> &
        Partial<Pick<RemoveLiveQuerySubscriptionsForConnectionInput, "projectId">>,
    ) =>
      executor.removeLiveQuerySubscriptionsForConnection({
        projectId: "project_live_query",
        ...input,
      }),
    removeExpiredLiveQuerySubscriptions: (
      input: Omit<RemoveExpiredLiveQuerySubscriptionsInput, "projectId"> &
        Partial<Pick<RemoveExpiredLiveQuerySubscriptionsInput, "projectId">>,
    ) =>
      executor.removeExpiredLiveQuerySubscriptions({
        projectId: "project_live_query",
        ...input,
      }),
  };
}
