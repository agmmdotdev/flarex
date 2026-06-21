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
  LiveQuerySubscriptionRerunError,
} from "./errors";
import { runInvokeWithRetries } from "./retry";
import type {
  Clock,
  FindStaleLiveQuerySubscriptionsInput,
  FindStaleLiveQuerySubscriptionsResult,
  FlarexExecutorPersistence,
  IdGenerator,
  Json,
  LiveQueryChange,
  RecordLiveQuerySubscriptionInput,
  RecordLiveQuerySubscriptionResult,
  RemoveLiveQuerySubscriptionInput,
  RerunLiveQuerySubscriptionInput,
  RerunLiveQuerySubscriptionOutput,
  RerunLiveQuerySubscriptionResult,
  RerunStaleLiveQuerySubscriptionsInput,
  RerunStaleLiveQuerySubscriptionsResult,
  RunLiveQuerySubscriptionWithInvokeInput,
} from "./types";

export async function recordLiveQuerySubscription(
  persistence: FlarexExecutorPersistence,
  input: RecordLiveQuerySubscriptionInput,
): Promise<RecordLiveQuerySubscriptionResult> {
  const readSet = readSetToFreshnessReadSet(input.readSet, input.beginTs);
  const resultHash = fingerprintJson(input.resultJson);
  const subscription = await persistence.upsertLiveQuerySubscription({
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
  return await persistence.deleteLiveQuerySubscription(input);
}

export async function findStaleLiveQuerySubscriptions(
  persistence: FlarexExecutorPersistence,
  input: FindStaleLiveQuerySubscriptionsInput,
): Promise<FindStaleLiveQuerySubscriptionsResult> {
  const subscriptions = await persistence.listLiveQuerySubscriptions({
    deploymentId: input.deploymentId,
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
  const rerun = await input.runQuery(input.subscription);
  const previousResultHash = input.subscription.resultHash;
  const recorded = await recordLiveQuerySubscription(persistence, {
    deploymentId: input.subscription.deploymentId,
    connectionId: input.subscription.connectionId,
    queryId: input.subscription.queryId,
    functionPath: input.subscription.functionPath,
    argsJson: input.subscription.argsJson as Json,
    partitionKey: input.subscription.partitionKey,
    beginTs: rerun.beginTs,
    readSet: rerun.readSet,
    resultJson: rerun.value,
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
  });

  return {
    subscription: recorded.subscription,
    previousResultHash,
    resultHash: recorded.resultHash,
    changed: previousResultHash !== recorded.resultHash,
  };
}

export async function rerunStaleLiveQuerySubscriptions(
  persistence: FlarexExecutorPersistence,
  input: RerunStaleLiveQuerySubscriptionsInput,
): Promise<RerunStaleLiveQuerySubscriptionsResult> {
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit <= 0)
  ) {
    throw new Error("limit must be a positive integer.");
  }

  const scanned = await findStaleLiveQuerySubscriptions(persistence, {
    deploymentId: input.deploymentId,
    freshnessStore: input.freshnessStore,
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

  const result = await runInvokeWithRetries(persistence, clock, ids, {
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
    readSet: result.readSet ?? {},
  };
}

export function fingerprintJson(value: Json): string {
  return stableJson(value);
}

function liveQueryChangeFromRerun(
  rerun: RerunLiveQuerySubscriptionResult,
): LiveQueryChange {
  return {
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

function stableJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
    .join(",")}}`;
}
