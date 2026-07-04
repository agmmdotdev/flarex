import type {
  FlarexExecutor,
  FlarexExecutorPersistence,
  PrepareInvokeResult,
  RerunStaleLiveQuerySubscriptionsInput,
} from "@flarex/executor";

import { createFlarexNitroHandler } from "../src/index";

const anonymousIdentity = { kind: "anonymous" } as const;

export function healthyPersistence(): FlarexExecutorPersistence {
  return {
    async check() {
      return { status: "ok" as const };
    },
    async getDeploymentMetadata() {
      return null;
    },
    async listDeploymentMetadata() {
      return { deployments: [], nextCursor: null, hasMore: false };
    },
    async getDeploymentPackageMetadata() {
      return null;
    },
    async insertDeploymentPackageMetadata(input) {
      return {
        deploymentId: input.deploymentId,
        packageId: input.packageId,
        sourcePackageHash: input.sourcePackageHash,
        executionModule: input.executionModule,
        sourcePackageJson: input.sourcePackageJson,
        analysisJson: input.analysisJson ?? null,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async insertDeploymentMetadata(input) {
      return {
        deploymentId: input.deploymentId,
        projectId: input.projectId,
        activePackageId: input.activePackageId ?? null,
        activeSchemaVersion: input.activeSchemaVersion ?? 0,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async updateDeploymentMetadataActivation(input) {
      return {
        deploymentId: input.deploymentId,
        projectId: "project_test",
        activePackageId: input.activePackageId,
        activeSchemaVersion: input.activeSchemaVersion,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async insertInvokeSessionMetadata(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        packageId: input.packageId,
        functionPath: input.functionPath,
        functionKind: input.functionKind,
        partitionKey: input.partitionKey,
        scopeJson: input.scopeJson,
        argsJson: input.argsJson,
        identityJson: input.identityJson ?? anonymousIdentity,
        idempotencyKey: input.idempotencyKey ?? null,
        state: input.state ?? "active",
        beginTs: input.beginTs,
        schemaVersion: input.schemaVersion,
        executionModule: input.executionModule,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
        finishedAt: null,
      };
    },
    async getInvokeSessionMetadata() {
      return null;
    },
    async finishInvokeSessionMetadata(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        projectId: "project_test",
        packageId: "package_test",
        functionPath: "messages:list",
        functionKind: "query",
        partitionKey: "team:1",
        scopeJson: {},
        argsJson: null,
        identityJson: anonymousIdentity,
        idempotencyKey: null,
        state: "finished",
        beginTs: 1,
        schemaVersion: 1,
        executionModule: "_flarex/execution.js",
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
        finishedAt: input.finishedAt,
      };
    },
    async abortInvokeSessionMetadata(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        projectId: "project_test",
        packageId: "package_test",
        functionPath: "messages:list",
        functionKind: "query",
        partitionKey: "team:1",
        scopeJson: {},
        argsJson: null,
        identityJson: anonymousIdentity,
        idempotencyKey: null,
        state: "aborted",
        beginTs: 1,
        schemaVersion: 1,
        executionModule: "_flarex/execution.js",
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
        finishedAt: input.finishedAt,
      };
    },
    async abortStaleInvokeSessionsMetadata() {
      return { sessions: [], hasMore: false };
    },
    async getDocumentRevisionAtTs() {
      return null;
    },
    async listDocumentsInTableAtTs() {
      return [];
    },
    async listDocumentsInIndexAtTs(input) {
      return {
        documents: [],
        isDone: true,
        continueCursor: input.cursor ?? "",
      };
    },
    async insertInvokeSessionDocumentRead(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: input.tableId,
        documentId: input.documentId,
        observedTs: input.observedTs ?? null,
        readAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async listInvokeSessionDocumentReads() {
      return [];
    },
    async insertInvokeSessionTableRead(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: input.tableId,
        observedTs: input.observedTs,
        readAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async listInvokeSessionTableReads() {
      return [];
    },
    async insertInvokeSessionIndexRead(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        indexId: input.indexId,
        lowerKey: input.lowerKey ?? "",
        upperKey: input.upperKey ?? "",
        observedTs: input.observedTs,
        readAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async listInvokeSessionIndexReads() {
      return [];
    },
    async stageInvokeSessionDocumentWrite(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: input.tableId,
        documentId: input.documentId,
        op: input.op,
        valueJson: input.valueJson ?? null,
        stagedAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async listInvokeSessionDocumentWrites() {
      return [];
    },
    async commitInvokeSessionWrites(input) {
      return {
        committedTs: input.minimumTs + 1,
        writes: [],
      };
    },
    async insertOutboxEvent(input) {
      return {
        deploymentId: input.deploymentId,
        ts: input.ts,
        sequence: input.sequence,
        event: input.event,
        deliveredAt: null,
      };
    },
    async listOutboxEvents() {
      return { events: [], nextCursor: null, hasMore: false };
    },
    async listUndeliveredOutboxEvents() {
      return { events: [], nextCursor: null, hasMore: false };
    },
    async markOutboxEventsDelivered() {
      return { delivered: 0 };
    },
    async upsertLiveQueryConnectionLease(input) {
      return {
        deploymentId: input.deploymentId,
        connectionId: input.connectionId,
        lastSeenAt: input.lastSeenAt,
        expiresAt: input.expiresAt,
        closedAt: null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
    },
    async closeLiveQueryConnection() {
      return null;
    },
    async upsertLiveQuerySubscriptionWithLease(input) {
      return await this.upsertLiveQuerySubscription(input);
    },
    async upsertLiveQuerySubscription(input) {
      return {
        deploymentId: input.deploymentId,
        connectionId: input.connectionId,
        queryId: input.queryId,
        functionPath: input.functionPath,
        argsJson: input.argsJson,
        identityJson: input.identityJson ?? anonymousIdentity,
        partitionKey: input.partitionKey ?? null,
        beginTs: input.beginTs,
        readSetJson: input.readSetJson,
        resultJson: input.resultJson,
        resultHash: input.resultHash,
        createdAt: input.updatedAt ?? new Date("2026-06-19T00:00:00.000Z"),
        updatedAt: input.updatedAt ?? new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async recordLiveQueryRerunResult(input) {
      const subscription = await this.upsertLiveQuerySubscription(input);
      return {
        subscription,
        delivery:
          input.delivery === undefined
            ? null
            : {
                deploymentId: input.delivery.deploymentId,
                deliveryId: input.delivery.deliveryId,
                connectionId: input.delivery.connectionId,
                queryId: input.delivery.queryId,
                payloadJson: input.delivery.payloadJson,
                deliveredAt: null,
                claimedAt: null,
                claimExpiresAt: null,
                claimOwner: null,
                attemptCount: 0,
                lastAttemptedAt: null,
                lastErrorStage: null,
                lastError: null,
                deadLetteredAt: null,
                deadLetterReason: null,
                createdAt:
                  input.delivery.createdAt ??
                  new Date("2026-06-19T00:00:00.000Z"),
              },
      };
    },
    async recordLiveQueryRerunFailure(input) {
      return {
        deleted: 0,
        delivery:
          input.delivery === undefined
            ? null
            : {
                deploymentId: input.deploymentId,
                deliveryId: input.delivery.deliveryId,
                connectionId: input.connectionId,
                queryId: input.queryId,
                payloadJson: input.delivery.payloadJson,
                deliveredAt: null,
                claimedAt: null,
                claimExpiresAt: null,
                claimOwner: null,
                attemptCount: 0,
                lastAttemptedAt: null,
                lastErrorStage: null,
                lastError: null,
                deadLetteredAt: null,
                deadLetterReason: null,
                createdAt:
                  input.delivery.createdAt ??
                  new Date("2026-06-19T00:00:00.000Z"),
              },
      };
    },
    async deleteLiveQuerySubscription() {
      return { deleted: 0 };
    },
    async deleteLiveQuerySubscriptionsForConnection() {
      return { deleted: 0 };
    },
    async listLiveQuerySubscriptions() {
      return [];
    },
    async listActiveLiveQuerySubscriptions() {
      return [];
    },
    async deleteExpiredLiveQuerySubscriptions() {
      return { deleted: 0, deletedConnections: 0 };
    },
    async listExpiredLiveQueryConnectionDeployments() {
      return { deployments: [], nextCursor: null, hasMore: false };
    },
    async listUndeliveredLiveQueryDeliveries() {
      return { deliveries: [], nextCursor: null, hasMore: false };
    },
    async claimLiveQueryDeliveries() {
      return { deliveries: [], nextCursor: null, hasMore: false };
    },
    async listPendingLiveQueryDeliveryDeployments() {
      return { deployments: [], nextCursor: null, hasMore: false };
    },
    async listStuckLiveQueryDeliveries() {
      return { deliveries: [], nextCursor: null, hasMore: false };
    },
    async markLiveQueryDeliveriesDeadLettered() {
      return { deadLettered: 0, deliveries: [] };
    },
    async markLiveQueryDeliveriesDelivered() {
      return { delivered: 0 };
    },
    async recordLiveQueryDeliveryFailure() {
      return { failed: 0 };
    },
  };
}

export function fakeExecutor(
  overrides: Partial<FlarexExecutor> = {},
): FlarexExecutor {
  return {
    async activateDeploymentPackage() {
      throw new Error("activateDeploymentPackage is not implemented by test fake");
    },
    async ensureDeployment() {
      throw new Error("ensureDeployment is not implemented by test fake");
    },
    async getActiveFunction() {
      throw new Error("getActiveFunction is not implemented by test fake");
    },
    async getActiveDeploymentPackage() {
      throw new Error(
        "getActiveDeploymentPackage is not implemented by test fake",
      );
    },
    async getActiveDeploymentAuthConfig() {
      throw new Error(
        "getActiveDeploymentAuthConfig is not implemented by test fake",
      );
    },
    async beginInvokeSession() {
      throw new Error("beginInvokeSession is not implemented by test fake");
    },
    async finishInvokeSession() {
      throw new Error("finishInvokeSession is not implemented by test fake");
    },
    async abortInvokeSession() {
      throw new Error("abortInvokeSession is not implemented by test fake");
    },
    async abortStaleInvokeSessions() {
      throw new Error(
        "abortStaleInvokeSessions is not implemented by test fake",
      );
    },
    async runInvokeSessionMaintenance() {
      throw new Error(
        "runInvokeSessionMaintenance is not implemented by test fake",
      );
    },
    async listMaintenanceDeployments() {
      throw new Error(
        "listMaintenanceDeployments is not implemented by test fake",
      );
    },
    async listUndeliveredOutboxEvents() {
      throw new Error(
        "listUndeliveredOutboxEvents is not implemented by test fake",
      );
    },
    async markOutboxEventsDelivered() {
      throw new Error(
        "markOutboxEventsDelivered is not implemented by test fake",
      );
    },
    async runOutboxDeliveryBatch() {
      throw new Error("runOutboxDeliveryBatch is not implemented by test fake");
    },
    async listUndeliveredLiveQueryDeliveries() {
      throw new Error(
        "listUndeliveredLiveQueryDeliveries is not implemented by test fake",
      );
    },
    async markLiveQueryDeliveriesDelivered() {
      throw new Error(
        "markLiveQueryDeliveriesDelivered is not implemented by test fake",
      );
    },
    async claimLiveQueryDeliveryBatch() {
      throw new Error(
        "claimLiveQueryDeliveryBatch is not implemented by test fake",
      );
    },
    async ackLiveQueryDeliveries() {
      throw new Error(
        "ackLiveQueryDeliveries is not implemented by test fake",
      );
    },
    async runLiveQueryDeliveryBatch() {
      throw new Error(
        "runLiveQueryDeliveryBatch is not implemented by test fake",
      );
    },
    async listPendingLiveQueryDeliveryDeployments() {
      throw new Error(
        "listPendingLiveQueryDeliveryDeployments is not implemented by test fake",
      );
    },
    async listStuckLiveQueryDeliveries() {
      throw new Error(
        "listStuckLiveQueryDeliveries is not implemented by test fake",
      );
    },
    async markLiveQueryDeliveriesDeadLettered() {
      throw new Error(
        "markLiveQueryDeliveriesDeadLettered is not implemented by test fake",
      );
    },
    async deadLetterStuckLiveQueryDeliveries() {
      throw new Error(
        "deadLetterStuckLiveQueryDeliveries is not implemented by test fake",
      );
    },
    async recordLiveQueryDeliveryFailure() {
      throw new Error(
        "recordLiveQueryDeliveryFailure is not implemented by test fake",
      );
    },
    async touchLiveQueryConnection() {
      throw new Error(
        "touchLiveQueryConnection is not implemented by test fake",
      );
    },
    async recordLiveQuerySubscription() {
      throw new Error(
        "recordLiveQuerySubscription is not implemented by test fake",
      );
    },
    async removeLiveQuerySubscription() {
      throw new Error(
        "removeLiveQuerySubscription is not implemented by test fake",
      );
    },
    async removeLiveQuerySubscriptionsForConnection() {
      throw new Error(
        "removeLiveQuerySubscriptionsForConnection is not implemented by test fake",
      );
    },
    async removeExpiredLiveQuerySubscriptions() {
      throw new Error(
        "removeExpiredLiveQuerySubscriptions is not implemented by test fake",
      );
    },
    async listExpiredLiveQueryConnectionDeployments() {
      throw new Error(
        "listExpiredLiveQueryConnectionDeployments is not implemented by test fake",
      );
    },
    async findStaleLiveQuerySubscriptions() {
      throw new Error(
        "findStaleLiveQuerySubscriptions is not implemented by test fake",
      );
    },
    async rerunLiveQuerySubscription() {
      throw new Error(
        "rerunLiveQuerySubscription is not implemented by test fake",
      );
    },
    async rerunStaleLiveQuerySubscriptions() {
      throw new Error(
        "rerunStaleLiveQuerySubscriptions is not implemented by test fake",
      );
    },
    async runLiveQuerySubscriptionWithInvoke() {
      throw new Error(
        "runLiveQuerySubscriptionWithInvoke is not implemented by test fake",
      );
    },
    async runMaintenanceSweep() {
      throw new Error("runMaintenanceSweep is not implemented by test fake");
    },
    async runInvokeWithRetries() {
      throw new Error("runInvokeWithRetries is not implemented by test fake");
    },
    async invokeSyscall() {
      throw new Error("invokeSyscall is not implemented by test fake");
    },
    async prepareInvoke(input) {
      return preparedInvokeResult({
        deploymentId: input.deploymentId,
        packageId: "package_active",
        path: input.path,
        kind: input.kind ?? "query",
        schemaVersion: 12,
        executionModule: "_flarex/execution.js",
      });
    },
    async registerDeploymentPackage() {
      throw new Error("registerDeploymentPackage is not implemented by test fake");
    },
    async health() {
      return {
        service: "executor",
        status: "ok",
        persistence: { status: "ok" },
        time: "2026-06-19T00:00:00.000Z",
      };
    },
    ...overrides,
  };
}

export function preparedInvokeResult(input: {
  deploymentId: string;
  packageId: string;
  path: string;
  kind: "query" | "mutation";
  schemaVersion: number;
  executionModule: string;
}): PrepareInvokeResult {
  return {
    deployment: {
      deploymentId: input.deploymentId,
      projectId: "project_active",
      activePackageId: input.packageId,
      activeSchemaVersion: input.schemaVersion,
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
    },
    package: {
      deploymentId: input.deploymentId,
      packageId: input.packageId,
      sourcePackageHash: "a".repeat(64),
      executionModule: input.executionModule,
      sourcePackageJson: {},
      analysisJson: null,
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
    },
    function: {
      path: input.path,
      kind: input.kind,
    },
    schema: {
      version: input.schemaVersion,
      tables: [],
      indexes: [],
    },
    scope: {
      kind: "partition",
      table: "teams",
      selector: "byId",
      partitionField: "_id",
      argField: "teamId",
      partitionKey: "team:1",
    },
    executionModule: input.executionModule,
  };
}

export function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function testFreshnessStore(): RerunStaleLiveQuerySubscriptionsInput["freshnessStore"] {
  return {
    async applyCommitFreshness() {
      return {
        applied: true,
        documentVersions: [],
        tableVersions: [],
      };
    },
    getDocumentVersion() {
      return null;
    },
    getTableVersion() {
      return null;
    },
  };
}

export async function expectPrepareError(error: Error): Promise<{
  status: number;
  body: unknown;
}> {
  const handler = createFlarexNitroHandler({
    executor: fakeExecutor({
      async prepareInvoke() {
        throw error;
      },
    }),
  });
  const response = await handler({
    request: jsonRequest("https://executor.test/invoke/prepare", {
      deploymentId: "deployment_active",
      projectId: "project_active",
      path: "messages:list",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    }),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}
