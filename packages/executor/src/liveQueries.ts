import {
  checkReadSetFreshness,
  readSetToFreshnessReadSet,
} from "@flarex/freshness";
import type {
  DeleteLiveQuerySubscriptionResult,
} from "@flarex/persistence-postgres";
import type { FreshnessReadSet } from "@flarex/freshness";

import {
  DeploymentNotFoundError,
  DeploymentProjectMismatchError,
  LiveQueryDeliveryPolicyError,
  LiveQuerySubscriptionRerunError,
} from "./errors";
import { ensureDeployment } from "./deployments";
import { runInvokeWithRetries } from "./retry";
import type {
  Clock,
  DeleteExpiredLiveQuerySubscriptionsResult,
  FindStaleLiveQuerySubscriptionsInput,
  FindStaleLiveQuerySubscriptionsResult,
  FlarexExecutorPersistence,
  IdGenerator,
  Json,
  ListExpiredLiveQueryConnectionDeploymentsInput,
  ListExpiredLiveQueryConnectionDeploymentsResult,
  LiveQueryChange,
  RecordLiveQuerySubscriptionInput,
  RecordLiveQuerySubscriptionResult,
  RemoveExpiredLiveQuerySubscriptionsInput,
  RemoveLiveQuerySubscriptionInput,
  RemoveLiveQuerySubscriptionsForConnectionInput,
  RerunLiveQuerySubscriptionInput,
  RerunLiveQuerySubscriptionOutput,
  RerunLiveQuerySubscriptionResult,
  RerunStaleLiveQuerySubscriptionsInput,
  RerunStaleLiveQuerySubscriptionsResult,
  RunLiveQuerySubscriptionWithInvokeInput,
  TouchLiveQueryConnectionInput,
  TouchLiveQueryConnectionResult,
} from "./types";

const DEFAULT_LIVE_QUERY_CONNECTION_LEASE_MS = 60_000;
const DEFAULT_EXPIRED_CONNECTION_DEPLOYMENT_LIMIT = 100;

export async function touchLiveQueryConnection(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: TouchLiveQueryConnectionInput,
): Promise<TouchLiveQueryConnectionResult> {
  await assertLiveQueryDeploymentProject(persistence, input);
  return await upsertLiveQueryConnectionLease(persistence, clock, input);
}

async function upsertLiveQueryConnectionLease(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: Omit<TouchLiveQueryConnectionInput, "projectId">,
): Promise<TouchLiveQueryConnectionResult> {
  const lease = liveQueryConnectionLease(clock, input);
  const connection = await persistence.upsertLiveQueryConnectionLease({
    deploymentId: input.deploymentId,
    connectionId: input.connectionId,
    lastSeenAt: lease.lastSeenAt,
    expiresAt: lease.expiresAt,
  });
  return { connection };
}

function liveQueryConnectionLease(
  clock: Clock,
  input: Pick<TouchLiveQueryConnectionInput, "leaseDurationMs" | "now">,
): { lastSeenAt: Date; expiresAt: Date } {
  const now = input.now ?? clock.now();
  const leaseDurationMs =
    input.leaseDurationMs ?? DEFAULT_LIVE_QUERY_CONNECTION_LEASE_MS;
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new Error("leaseDurationMs must be a positive integer.");
  }
  return {
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + leaseDurationMs),
  };
}

export async function recordLiveQuerySubscription(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: RecordLiveQuerySubscriptionInput,
): Promise<RecordLiveQuerySubscriptionResult> {
  await assertLiveQueryDeploymentProject(persistence, input);
  const lease = liveQueryConnectionLease(clock, {
    ...(input.updatedAt === undefined ? {} : { now: input.updatedAt }),
  });
  const readSet = readSetToFreshnessReadSet(input.readSet, input.beginTs);
  const resultHash = fingerprintJson(input.resultJson);
  const subscription = await persistence.upsertLiveQuerySubscriptionWithLease({
    deploymentId: input.deploymentId,
    connectionId: input.connectionId,
    queryId: input.queryId,
    functionPath: input.functionPath,
    argsJson: input.argsJson,
    partitionKey: input.partitionKey ?? null,
    beginTs: input.beginTs,
    readSetJson: readSet as Record<string, unknown>,
    resultJson: input.resultJson,
    resultHash,
    lastSeenAt: lease.lastSeenAt,
    expiresAt: lease.expiresAt,
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
  });

  return {
    subscription,
    resultHash,
  };
}

export async function removeLiveQuerySubscription(
  persistence: FlarexExecutorPersistence,
  input: RemoveLiveQuerySubscriptionInput,
): Promise<DeleteLiveQuerySubscriptionResult> {
  await assertLiveQueryDeploymentProject(persistence, input);
  return await persistence.deleteLiveQuerySubscription(input);
}

export async function removeLiveQuerySubscriptionsForConnection(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: RemoveLiveQuerySubscriptionsForConnectionInput,
): Promise<DeleteLiveQuerySubscriptionResult> {
  await assertLiveQueryDeploymentProject(persistence, input);
  await persistence.closeLiveQueryConnection({
    deploymentId: input.deploymentId,
    connectionId: input.connectionId,
    closedAt: clock.now(),
  });
  return await persistence.deleteLiveQuerySubscriptionsForConnection(input);
}

export async function removeExpiredLiveQuerySubscriptions(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: RemoveExpiredLiveQuerySubscriptionsInput,
): Promise<DeleteExpiredLiveQuerySubscriptionsResult> {
  await assertLiveQueryDeploymentProject(persistence, input);
  return await persistence.deleteExpiredLiveQuerySubscriptions({
    deploymentId: input.deploymentId,
    expiredAt: input.expiredAt ?? clock.now(),
  });
}

export async function listExpiredLiveQueryConnectionDeployments(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: ListExpiredLiveQueryConnectionDeploymentsInput,
): Promise<ListExpiredLiveQueryConnectionDeploymentsResult> {
  const limit = liveQueryConnectionCleanupLimit(input.limit);
  return await persistence.listExpiredLiveQueryConnectionDeployments({
    expiredAt: input.expiredAt ?? clock.now(),
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

async function assertLiveQueryDeploymentProject(
  persistence: FlarexExecutorPersistence,
  input: { deploymentId: string; projectId: string },
): Promise<void> {
  await ensureDeployment(persistence, input);
}

function liveQueryConnectionCleanupLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_EXPIRED_CONNECTION_DEPLOYMENT_LIMIT;
  if (Number.isInteger(limit) && limit > 0) return limit;
  throw new LiveQueryDeliveryPolicyError("limit must be a positive integer.");
}

export async function findStaleLiveQuerySubscriptions(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: FindStaleLiveQuerySubscriptionsInput,
): Promise<FindStaleLiveQuerySubscriptionsResult> {
  const subscriptions = await persistence.listActiveLiveQuerySubscriptions({
    deploymentId: input.deploymentId,
    activeAt: input.activeAt ?? clock.now(),
  });
  const result: FindStaleLiveQuerySubscriptionsResult = {
    fresh: [],
    stale: [],
    unsupported: [],
  };

  for (const subscription of subscriptions) {
    const freshness = await checkReadSetFreshness({
      store: input.freshnessStore,
      deploymentId: input.deploymentId,
      readSet: subscription.readSetJson as FreshnessReadSet,
    });
    const entry = { subscription, freshness };
    if (freshness.status === "fresh") {
      result.fresh.push(entry);
    } else if (freshness.status === "stale") {
      result.stale.push(entry);
    } else {
      result.unsupported.push(entry);
    }
  }

  return result;
}

export async function rerunLiveQuerySubscription(
  persistence: FlarexExecutorPersistence,
  input: RerunLiveQuerySubscriptionInput,
): Promise<RerunLiveQuerySubscriptionResult> {
  const previousResultHash = input.subscription.resultHash;
  let rerun: RerunLiveQuerySubscriptionOutput;
  try {
    rerun = await input.runQuery(input.subscription);
  } catch (error) {
    const errorText = errorMessage(error);
    const deliveryPayload: LiveQueryChange = {
      kind: "failed",
      deploymentId: input.subscription.deploymentId,
      connectionId: input.subscription.connectionId,
      queryId: input.subscription.queryId,
      functionPath: input.subscription.functionPath,
      argsJson: input.subscription.argsJson as Json,
      previousResultHash,
      errorMessage: errorText,
      errorData: null,
    };
    const recorded = await persistence.recordLiveQueryRerunFailure({
      deploymentId: input.subscription.deploymentId,
      connectionId: input.subscription.connectionId,
      queryId: input.subscription.queryId,
      ...(input.deliveryId === undefined
        ? {}
        : {
            delivery: {
              deliveryId: input.deliveryId,
              payloadJson: deliveryPayload,
              ...(input.updatedAt === undefined
                ? {}
                : { createdAt: input.updatedAt }),
            },
          }),
    });
    return {
      status: "failed",
      subscription: input.subscription,
      previousResultHash,
      changed: true,
      deleted: recorded.deleted,
      delivery: recorded.delivery,
      errorMessage: errorText,
    };
  }
  const resultHash = fingerprintJson(rerun.value);
  const changed = previousResultHash !== resultHash;
  const readSet = readSetToFreshnessReadSet(rerun.readSet, rerun.beginTs);
  const deliveryPayload: LiveQueryChange = {
    kind: "updated",
    deploymentId: input.subscription.deploymentId,
    connectionId: input.subscription.connectionId,
    queryId: input.subscription.queryId,
    functionPath: input.subscription.functionPath,
    argsJson: input.subscription.argsJson as Json,
    resultJson: rerun.value,
    previousResultHash,
    resultHash,
  };
  const recorded = await persistence.recordLiveQueryRerunResult({
    deploymentId: input.subscription.deploymentId,
    connectionId: input.subscription.connectionId,
    queryId: input.subscription.queryId,
    functionPath: input.subscription.functionPath,
    argsJson: input.subscription.argsJson as Json,
    partitionKey: input.subscription.partitionKey,
    beginTs: rerun.beginTs,
    readSetJson: readSet as Record<string, unknown>,
    resultJson: rerun.value,
    resultHash,
    ...(changed && input.deliveryId !== undefined
      ? {
          delivery: {
            deploymentId: input.subscription.deploymentId,
            deliveryId: input.deliveryId,
            connectionId: input.subscription.connectionId,
            queryId: input.subscription.queryId,
            payloadJson: deliveryPayload,
            ...(input.updatedAt === undefined
              ? {}
              : { createdAt: input.updatedAt }),
          },
        }
      : {}),
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
  });

  return {
    status: "updated",
    subscription: recorded.subscription,
    previousResultHash,
    resultHash,
    changed,
    delivery: recorded.delivery,
  };
}

export async function rerunStaleLiveQuerySubscriptions(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  ids: IdGenerator,
  input: RerunStaleLiveQuerySubscriptionsInput,
): Promise<RerunStaleLiveQuerySubscriptionsResult> {
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit <= 0)
  ) {
    throw new Error("limit must be a positive integer.");
  }

  const scanned = await findStaleLiveQuerySubscriptions(persistence, clock, {
    deploymentId: input.deploymentId,
    freshnessStore: input.freshnessStore,
    ...(input.activeAt === undefined ? {} : { activeAt: input.activeAt }),
  });
  const staleToRerun =
    input.limit === undefined
      ? scanned.stale
      : scanned.stale.slice(0, input.limit);
  const changed: RerunLiveQuerySubscriptionResult[] = [];
  const unchanged: RerunLiveQuerySubscriptionResult[] = [];
  const changes: LiveQueryChange[] = [];

  for (const entry of staleToRerun) {
    const rerun = await rerunLiveQuerySubscription(persistence, {
      subscription: entry.subscription,
      deliveryId: ids.nextId(),
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
      runQuery: input.runQuery,
    });
    if (rerun.changed) {
      changed.push(rerun);
      changes.push(liveQueryChangeFromRerun(rerun));
    } else {
      unchanged.push(rerun);
    }
  }

  if (changes.length > 0) {
    await input.deliverChanges?.(changes);
  }

  return {
    scanned,
    changed,
    unchanged,
    changes,
    unsupported: scanned.unsupported,
    hasMoreStale:
      input.limit !== undefined && scanned.stale.length > staleToRerun.length,
  };
}

export async function runLiveQuerySubscriptionWithInvoke(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  ids: IdGenerator,
  input: RunLiveQuerySubscriptionWithInvokeInput,
): Promise<RerunLiveQuerySubscriptionOutput> {
  const subscription = input.subscription;
  if (
    typeof subscription.partitionKey !== "string" ||
    subscription.partitionKey.length === 0
  ) {
    throw new LiveQuerySubscriptionRerunError(
      `${subscription.deploymentId}/${subscription.connectionId}/${subscription.queryId} is missing partitionKey`,
    );
  }

  const deployment = await persistence.getDeploymentMetadata(
    subscription.deploymentId,
  );
  if (deployment === null) {
    throw new DeploymentNotFoundError(subscription.deploymentId);
  }
  if (
    input.projectId !== undefined &&
    deployment.projectId !== input.projectId
  ) {
    throw new DeploymentProjectMismatchError(
      subscription.deploymentId,
      input.projectId,
      deployment.projectId,
    );
  }

  const result = await runInvokeWithRetries(persistence, clock, ids, undefined, {
    deploymentId: subscription.deploymentId,
    projectId: deployment.projectId,
    path: subscription.functionPath,
    kind: "query",
    args: subscription.argsJson as Json,
    partitionKey: subscription.partitionKey,
    ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    runAttempt: (attempt) => input.executeQuery(attempt, subscription),
  });

  return {
    value: result.value,
    beginTs: result.beginTs,
    readSet: result.readSet,
  };
}

export function fingerprintJson(value: Json): string {
  return stableJson(value);
}

function liveQueryChangeFromRerun(
  rerun: RerunLiveQuerySubscriptionResult,
): LiveQueryChange {
  if (rerun.status === "failed") {
    return {
      kind: "failed",
      deploymentId: rerun.subscription.deploymentId,
      connectionId: rerun.subscription.connectionId,
      queryId: rerun.subscription.queryId,
      functionPath: rerun.subscription.functionPath,
      argsJson: rerun.subscription.argsJson as Json,
      previousResultHash: rerun.previousResultHash,
      errorMessage: rerun.errorMessage,
      errorData: null,
    };
  }
  return {
    kind: "updated",
    deploymentId: rerun.subscription.deploymentId,
    connectionId: rerun.subscription.connectionId,
    queryId: rerun.subscription.queryId,
    functionPath: rerun.subscription.functionPath,
    argsJson: rerun.subscription.argsJson as Json,
    resultJson: rerun.subscription.resultJson as Json,
    previousResultHash: rerun.previousResultHash,
    resultHash: rerun.resultHash,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stableJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
    .join(",")}}`;
}
