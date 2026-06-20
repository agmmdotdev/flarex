import { readSetToFreshnessReadSet } from "@flarex/freshness";
import type { DeleteLiveQuerySubscriptionResult } from "@flarex/persistence-postgres";

import type {
  FlarexExecutorPersistence,
  Json,
  RecordLiveQuerySubscriptionInput,
  RecordLiveQuerySubscriptionResult,
  RemoveLiveQuerySubscriptionInput,
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
