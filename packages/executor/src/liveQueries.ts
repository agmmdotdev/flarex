import {
  checkReadSetFreshness,
  readSetToFreshnessReadSet,
} from "@flarex/freshness";
import type {
  DeleteLiveQuerySubscriptionResult,
} from "@flarex/persistence-postgres";
import type { FreshnessReadSet } from "@flarex/freshness";

import type {
  FindStaleLiveQuerySubscriptionsInput,
  FindStaleLiveQuerySubscriptionsResult,
  FlarexExecutorPersistence,
  Json,
  RecordLiveQuerySubscriptionInput,
  RecordLiveQuerySubscriptionResult,
  RemoveLiveQuerySubscriptionInput,
  RerunLiveQuerySubscriptionInput,
  RerunLiveQuerySubscriptionResult,
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

export function fingerprintJson(value: Json): string {
  return stableJson(value);
}

function stableJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
    .join(",")}}`;
}
