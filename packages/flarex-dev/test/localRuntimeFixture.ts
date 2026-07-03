import type {
  FlarexExecutor,
  InvokeAttemptContext,
  RerunStaleLiveQuerySubscriptionsInput,
} from "@flarex/executor";
import { deploymentPackageSourcePackageJson } from "@flarex/executor";
import type { LifecycleQueryInvokeRequest } from "flarex-backend/test/lifecycleFixture";
import type { PushSourcePackage } from "flarex-backend/types";

type LocalRuntimeFixtureExecutorMethod =
  | "getActiveDeploymentPackage"
  | "invokeSyscall"
  | "rerunStaleLiveQuerySubscriptions"
  | "runLiveQuerySubscriptionWithInvoke";
type RequiredLocalRuntimeFixtureExecutorMethod =
  | "getActiveDeploymentPackage"
  | "rerunStaleLiveQuerySubscriptions"
  | "runLiveQuerySubscriptionWithInvoke";
export type LocalRuntimeFixtureExecutorOverrides =
  Pick<FlarexExecutor, RequiredLocalRuntimeFixtureExecutorMethod> &
    Partial<Pick<FlarexExecutor, LocalRuntimeFixtureExecutorMethod>>;

export function fakeExecutor(
  overrides: LocalRuntimeFixtureExecutorOverrides,
): FlarexExecutor {
  return {
    ...throwingExecutorDefaults(),
    ...overrides,
  };
}

export function emptyFreshnessStore(): RerunStaleLiveQuerySubscriptionsInput["freshnessStore"] {
  return {
    async applyCommitFreshness() {
      return { applied: false, documentVersions: [], tableVersions: [] };
    },
    getDocumentVersion: () => null,
    getTableVersion: () => null,
  };
}

export function jsonRequest(url: string, body: unknown, token: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

export function sourcePackageJson(sourcePackage: PushSourcePackage): Record<string, unknown> {
  return deploymentPackageSourcePackageJson(sourcePackage);
}

export function liveQueryAttemptForRequest(
  request: LifecycleQueryInvokeRequest,
): InvokeAttemptContext {
  return {
    attempt: 1,
    maxAttempts: 1,
    session: {
      sessionId: "session-lifecycle-parity",
      beginTs: 20,
      identity: { kind: "anonymous" },
      schemaVersion: 1,
      function: { path: request.path, kind: "query" },
      scope: {
        kind: "partition",
        table: "users",
        selector: "byId",
        partitionField: "_id",
        argField: "id",
        partitionKey: request.partitionKey ?? "1:user",
      },
      executionModule: "_flarex/execution.js",
    },
    syscall: async () => {
      throw new Error("Lifecycle parity test should use materialized artifact syscalls.");
    },
  };
}

function unexpectedExecutorCall(method: keyof FlarexExecutor): Promise<never> {
  return Promise.reject(new Error(`Unexpected fake executor call: ${method}.`));
}

function throwingExecutorDefaults(): FlarexExecutor {
  return {
    activateDeploymentPackage: () => unexpectedExecutorCall("activateDeploymentPackage"),
    ensureDeployment: () => unexpectedExecutorCall("ensureDeployment"),
    getActiveFunction: () => unexpectedExecutorCall("getActiveFunction"),
    getActiveDeploymentPackage: () => unexpectedExecutorCall("getActiveDeploymentPackage"),
    beginInvokeSession: () => unexpectedExecutorCall("beginInvokeSession"),
    finishInvokeSession: () => unexpectedExecutorCall("finishInvokeSession"),
    abortInvokeSession: () => unexpectedExecutorCall("abortInvokeSession"),
    abortStaleInvokeSessions: () => unexpectedExecutorCall("abortStaleInvokeSessions"),
    runInvokeSessionMaintenance: () => unexpectedExecutorCall("runInvokeSessionMaintenance"),
    listMaintenanceDeployments: () => unexpectedExecutorCall("listMaintenanceDeployments"),
    listUndeliveredOutboxEvents: () => unexpectedExecutorCall("listUndeliveredOutboxEvents"),
    markOutboxEventsDelivered: () => unexpectedExecutorCall("markOutboxEventsDelivered"),
    runOutboxDeliveryBatch: () => unexpectedExecutorCall("runOutboxDeliveryBatch"),
    listUndeliveredLiveQueryDeliveries: () => unexpectedExecutorCall("listUndeliveredLiveQueryDeliveries"),
    markLiveQueryDeliveriesDelivered: () => unexpectedExecutorCall("markLiveQueryDeliveriesDelivered"),
    claimLiveQueryDeliveryBatch: () => unexpectedExecutorCall("claimLiveQueryDeliveryBatch"),
    ackLiveQueryDeliveries: () => unexpectedExecutorCall("ackLiveQueryDeliveries"),
    runLiveQueryDeliveryBatch: () => unexpectedExecutorCall("runLiveQueryDeliveryBatch"),
    listPendingLiveQueryDeliveryDeployments: () =>
      unexpectedExecutorCall("listPendingLiveQueryDeliveryDeployments"),
    listStuckLiveQueryDeliveries: () => unexpectedExecutorCall("listStuckLiveQueryDeliveries"),
    markLiveQueryDeliveriesDeadLettered: () =>
      unexpectedExecutorCall("markLiveQueryDeliveriesDeadLettered"),
    deadLetterStuckLiveQueryDeliveries: () => unexpectedExecutorCall("deadLetterStuckLiveQueryDeliveries"),
    recordLiveQueryDeliveryFailure: () => unexpectedExecutorCall("recordLiveQueryDeliveryFailure"),
    touchLiveQueryConnection: () => unexpectedExecutorCall("touchLiveQueryConnection"),
    recordLiveQuerySubscription: () => unexpectedExecutorCall("recordLiveQuerySubscription"),
    removeLiveQuerySubscription: () => unexpectedExecutorCall("removeLiveQuerySubscription"),
    removeLiveQuerySubscriptionsForConnection: () =>
      unexpectedExecutorCall("removeLiveQuerySubscriptionsForConnection"),
    removeExpiredLiveQuerySubscriptions: () => unexpectedExecutorCall("removeExpiredLiveQuerySubscriptions"),
    listExpiredLiveQueryConnectionDeployments: () =>
      unexpectedExecutorCall("listExpiredLiveQueryConnectionDeployments"),
    findStaleLiveQuerySubscriptions: () => unexpectedExecutorCall("findStaleLiveQuerySubscriptions"),
    rerunLiveQuerySubscription: () => unexpectedExecutorCall("rerunLiveQuerySubscription"),
    rerunStaleLiveQuerySubscriptions: () => unexpectedExecutorCall("rerunStaleLiveQuerySubscriptions"),
    runLiveQuerySubscriptionWithInvoke: () => unexpectedExecutorCall("runLiveQuerySubscriptionWithInvoke"),
    runMaintenanceSweep: () => unexpectedExecutorCall("runMaintenanceSweep"),
    runInvokeWithRetries: () => unexpectedExecutorCall("runInvokeWithRetries"),
    invokeSyscall: () => unexpectedExecutorCall("invokeSyscall"),
    prepareInvoke: () => unexpectedExecutorCall("prepareInvoke"),
    registerDeploymentPackage: () => unexpectedExecutorCall("registerDeploymentPackage"),
    health: () => unexpectedExecutorCall("health"),
  } satisfies FlarexExecutor;
}
