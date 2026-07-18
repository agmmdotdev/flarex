import { Elysia } from "elysia";
import type { FlarexHttpAppConfig } from "./config";
import {
  handleInvokeAbort,
  handleInvokeAbortStale,
  handleInvokeFinish,
  handleInvokePrepare,
  handleInvokeSessionMaintenance,
  handleInvokeStart,
  handleInvokeSyscall,
  handleLiveQueryAckMaintenance,
  handleLiveQueryClaimMaintenance,
  handleLiveQueryConnectionCleanup,
  handleLiveQueryConnectionTouch,
  handleLiveQueryDeadLetterMaintenance,
  handleLiveQueryDeadLetterStuckMaintenance,
  handleLiveQueryDeliveryMaintenance,
  handleLiveQueryExpiredConnectionDeploymentsMaintenance,
  handleLiveQueryFailureMaintenance,
  handleLiveQueryPendingDeploymentsMaintenance,
  handleLiveQueryRerunMaintenance,
  handleLiveQueryStuckDeliveriesMaintenance,
  handleLiveQuerySubscriptionRecord,
  handleLiveQuerySubscriptionRemove,
  handleLiveQuerySubscriptionRemoveConnection,
} from "./routeEffects";
import {
  normalizeExecutorHttpRoutePath as normalizeRoutePath,
} from "./routePath";

export function createFlarexHttpApp(config: FlarexHttpAppConfig) {
  const executor = config.executor;
  const healthPath = normalizeRoutePath(config.healthPath ?? "/health");
  const invokePreparePath = normalizeRoutePath(
    config.invokePreparePath ?? "/invoke/prepare",
  );
  const invokeStartPath = normalizeRoutePath(
    config.invokeStartPath ?? "/invoke/start",
  );
  const invokeSyscallPath = normalizeRoutePath(
    config.invokeSyscallPath ?? "/invoke/syscall",
  );
  const invokeFinishPath = normalizeRoutePath(
    config.invokeFinishPath ?? "/invoke/finish",
  );
  const invokeAbortPath = normalizeRoutePath(
    config.invokeAbortPath ?? "/invoke/abort",
  );
  const invokeAbortStalePath = normalizeRoutePath(
    config.invokeAbortStalePath ?? "/invoke/abort-stale",
  );
  const maintenanceInvokeSessionsPath = normalizeRoutePath(
    config.maintenanceInvokeSessionsPath ?? "/maintenance/invoke-sessions",
  );
  const maintenanceLiveQueryRerunPath = normalizeRoutePath(
    config.maintenanceLiveQueryRerunPath ??
      "/maintenance/live-queries/rerun",
  );
  const maintenanceLiveQueryDeliveryPath = normalizeRoutePath(
    config.maintenanceLiveQueryDeliveryPath ??
      "/maintenance/live-queries/deliver",
  );
  const liveQueryConnectionTouchPath = normalizeRoutePath(
    config.liveQueryConnectionTouchPath ?? "/live-query-connections/touch",
  );
  const liveQuerySubscriptionRecordPath = normalizeRoutePath(
    config.liveQuerySubscriptionRecordPath ??
      "/live-query-subscriptions/record",
  );
  const liveQuerySubscriptionRemovePath = normalizeRoutePath(
    config.liveQuerySubscriptionRemovePath ??
      "/live-query-subscriptions/remove",
  );
  const liveQuerySubscriptionRemoveConnectionPath = normalizeRoutePath(
    config.liveQuerySubscriptionRemoveConnectionPath ??
      "/live-query-subscriptions/remove-connection",
  );
  const maintenanceLiveQueryConnectionCleanupPath = normalizeRoutePath(
    config.maintenanceLiveQueryConnectionCleanupPath ??
      "/maintenance/live-queries/connections/cleanup",
  );
  const maintenanceLiveQueryExpiredConnectionDeploymentsPath = normalizeRoutePath(
    config.maintenanceLiveQueryExpiredConnectionDeploymentsPath ??
      "/maintenance/live-queries/expired-connection-deployments",
  );
  const maintenanceLiveQueryClaimPath = normalizeRoutePath(
    config.maintenanceLiveQueryClaimPath ??
      "/maintenance/live-queries/claim",
  );
  const maintenanceLiveQueryAckPath = normalizeRoutePath(
    config.maintenanceLiveQueryAckPath ?? "/maintenance/live-queries/ack",
  );
  const maintenanceLiveQueryFailurePath = normalizeRoutePath(
    config.maintenanceLiveQueryFailurePath ??
      "/maintenance/live-queries/failure",
  );
  const maintenanceLiveQueryDeadLetterPath = normalizeRoutePath(
    config.maintenanceLiveQueryDeadLetterPath ??
      "/maintenance/live-queries/dead-letter",
  );
  const maintenanceLiveQueryDeadLetterStuckPath = normalizeRoutePath(
    config.maintenanceLiveQueryDeadLetterStuckPath ??
      "/maintenance/live-queries/dead-letter-stuck",
  );
  const maintenanceLiveQueryPendingDeploymentsPath = normalizeRoutePath(
    config.maintenanceLiveQueryPendingDeploymentsPath ??
      "/maintenance/live-queries/pending-deployments",
  );
  const maintenanceLiveQueryStuckDeliveriesPath = normalizeRoutePath(
    config.maintenanceLiveQueryStuckDeliveriesPath ??
      "/maintenance/live-queries/stuck-deliveries",
  );
  const capabilityToken = config.capabilityToken;

  return new Elysia()
    .get(healthPath, () => executor.health())
    .post(invokePreparePath, ({ request, set }) =>
      handleInvokePrepare(executor, request, set, capabilityToken),
    )
    .post(invokeStartPath, ({ request, set }) =>
      handleInvokeStart(executor, request, set, capabilityToken),
    )
    .post(invokeSyscallPath, ({ request, set }) =>
      handleInvokeSyscall(executor, request, set, capabilityToken),
    )
    .post(invokeFinishPath, ({ request, set }) =>
      handleInvokeFinish(executor, request, set, capabilityToken),
    )
    .post(invokeAbortPath, ({ request, set }) =>
      handleInvokeAbort(executor, request, set, capabilityToken),
    )
    .post(invokeAbortStalePath, ({ request, set }) =>
      handleInvokeAbortStale(executor, request, set, capabilityToken),
    )
    .post(maintenanceInvokeSessionsPath, ({ request, set }) =>
      handleInvokeSessionMaintenance(executor, request, set, capabilityToken),
    )
    .post(maintenanceLiveQueryRerunPath, ({ request, set }) =>
      handleLiveQueryRerunMaintenance(
        executor,
        request,
        set,
        capabilityToken,
        config.liveQueryRerun,
      ),
    )
    .post(maintenanceLiveQueryDeliveryPath, ({ request, set }) =>
      handleLiveQueryDeliveryMaintenance(
        executor,
        request,
        set,
        capabilityToken,
        config.liveQueryDelivery,
      ),
    )
    .post(liveQueryConnectionTouchPath, ({ request, set }) =>
      handleLiveQueryConnectionTouch(executor, request, set, capabilityToken),
    )
    .post(liveQuerySubscriptionRecordPath, ({ request, set }) =>
      handleLiveQuerySubscriptionRecord(executor, request, set, capabilityToken),
    )
    .post(liveQuerySubscriptionRemovePath, ({ request, set }) =>
      handleLiveQuerySubscriptionRemove(executor, request, set, capabilityToken),
    )
    .post(liveQuerySubscriptionRemoveConnectionPath, ({ request, set }) =>
      handleLiveQuerySubscriptionRemoveConnection(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryConnectionCleanupPath, ({ request, set }) =>
      handleLiveQueryConnectionCleanup(executor, request, set, capabilityToken),
    )
    .post(maintenanceLiveQueryClaimPath, ({ request, set }) =>
      handleLiveQueryClaimMaintenance(executor, request, set, capabilityToken),
    )
    .post(maintenanceLiveQueryAckPath, ({ request, set }) =>
      handleLiveQueryAckMaintenance(executor, request, set, capabilityToken),
    )
    .post(maintenanceLiveQueryFailurePath, ({ request, set }) =>
      handleLiveQueryFailureMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryDeadLetterPath, ({ request, set }) =>
      handleLiveQueryDeadLetterMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryDeadLetterStuckPath, ({ request, set }) =>
      handleLiveQueryDeadLetterStuckMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryPendingDeploymentsPath, ({ request, set }) =>
      handleLiveQueryPendingDeploymentsMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryExpiredConnectionDeploymentsPath, ({ request, set }) =>
      handleLiveQueryExpiredConnectionDeploymentsMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .post(maintenanceLiveQueryStuckDeliveriesPath, ({ request, set }) =>
      handleLiveQueryStuckDeliveriesMaintenance(
        executor,
        request,
        set,
        capabilityToken,
      ),
    )
    .all(invokePreparePath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokePreparePath} only supports POST`,
      };
    })
    .all(invokeStartPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeStartPath} only supports POST`,
      };
    })
    .all(invokeSyscallPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeSyscallPath} only supports POST`,
      };
    })
    .all(invokeFinishPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeFinishPath} only supports POST`,
      };
    })
    .all(invokeAbortPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeAbortPath} only supports POST`,
      };
    })
    .all(invokeAbortStalePath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${invokeAbortStalePath} only supports POST`,
      };
    })
    .all(maintenanceInvokeSessionsPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceInvokeSessionsPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryRerunPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryRerunPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryDeliveryPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryDeliveryPath} only supports POST`,
      };
    })
    .all(liveQueryConnectionTouchPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${liveQueryConnectionTouchPath} only supports POST`,
      };
    })
    .all(liveQuerySubscriptionRecordPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${liveQuerySubscriptionRecordPath} only supports POST`,
      };
    })
    .all(liveQuerySubscriptionRemovePath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${liveQuerySubscriptionRemovePath} only supports POST`,
      };
    })
    .all(liveQuerySubscriptionRemoveConnectionPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${liveQuerySubscriptionRemoveConnectionPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryConnectionCleanupPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryConnectionCleanupPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryExpiredConnectionDeploymentsPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryExpiredConnectionDeploymentsPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryClaimPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryClaimPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryAckPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryAckPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryFailurePath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryFailurePath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryDeadLetterPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryDeadLetterPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryDeadLetterStuckPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryDeadLetterStuckPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryPendingDeploymentsPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryPendingDeploymentsPath} only supports POST`,
      };
    })
    .all(maintenanceLiveQueryStuckDeliveriesPath, ({ set }) => {
      set.status = 405;
      return {
        error: "method_not_allowed",
        message: `${maintenanceLiveQueryStuckDeliveriesPath} only supports POST`,
      };
    })
    .all("*", ({ request, set }) => {
      const url = new URL(request.url);
      set.status = 404;
      return {
        error: "not_found",
        message: `No Flarex executor adapter route for ${request.method} ${url.pathname}`,
      };
    });
}

export function createFlarexHttpHandler(
  config: FlarexHttpAppConfig,
): (request: Request) => Promise<Response> {
  const app = createFlarexHttpApp(config);
  return (request) => app.handle(request);
}
