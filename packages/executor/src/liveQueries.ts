import {
  checkReadSetFreshness,
  readSetToFreshnessReadSet,
} from "@flarex/freshness";
import type { FreshnessReadSet } from "@flarex/freshness";
import type { DeleteLiveQuerySubscriptionResult } from "@flarex/persistence-postgres";
import { executionIdentityFingerprint } from "flarex-protocol/auth";
import {
  encodeCanonicalJson,
  type CanonicalJsonEncodingInvariantIssue,
} from "flarex-protocol/json";
import { Data, Effect } from "effect";

import {
  DeploymentNotFoundError,
  DeploymentProjectMismatchError,
  LiveQueryDeliveryPolicyError,
  LiveQuerySubscriptionRerunError,
} from "./errors";
import { ensureDeployment } from "./deployments";
import { makeExecutorTimeEffect } from "./executorTime";
import type {
  Clock,
  DeleteExpiredLiveQuerySubscriptionsResult,
  FindStaleLiveQuerySubscriptionsInput,
  FindStaleLiveQuerySubscriptionsResult,
  FlarexExecutor,
  FlarexExecutorControlPersistence,
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

export class ConfiguredLiveQueryClockError extends Data.TaggedError(
  "ConfiguredLiveQueryClockError",
)<{
  readonly cause: unknown;
}> {}

export class LiveQueryForeignOperationError extends Data.TaggedError(
  "LiveQueryForeignOperationError",
)<{
  readonly operation: LiveQueryForeignOperation;
  readonly cause: unknown;
}> {}

export type LiveQueryForeignOperation =
  | "assert live query deployment project"
  | "build live query connection lease"
  | "check live query read set freshness"
  | "classify live query subscription freshness"
  | "close live query connection"
  | "delete expired live query subscriptions"
  | "delete live query subscriptions for connection"
  | "deliver stale live query changes"
  | "list active live query subscriptions"
  | "list expired live query connection deployments"
  | "prepare live query connection close key"
  | "prepare live query subscription lease input"
  | "prepare stale live query scan input"
  | "project live query subscription evidence"
  | "project stale live query change"
  | "project stale live query result"
  | "read live query active cutoff override"
  | "read live query active deployment id"
  | "read live query expiry cutoff override"
  | "read live query expiry deployment id"
  | "read live query lease time override"
  | "rerun stale live query subscription"
  | "select stale live query subscriptions"
  | "upsert live query connection lease"
  | "upsert live query subscription with lease"
  | "validate expired live query deployment limit"
  | "validate stale live query rerun limit";

type LiveQueryTimeEffect = Effect.Effect<
  Date,
  ConfiguredLiveQueryClockError
>;

type LiveQueryLeaseEffectError =
  | ConfiguredLiveQueryClockError
  | LiveQueryForeignOperationError;

type LiveQueryAuthorityLeaseEffectError =
  | DeploymentProjectMismatchError
  | LiveQueryLeaseEffectError;

interface LiveQueryConnectionLease {
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

export const touchLiveQueryConnectionEffect = Effect.fn(
  "Executor.liveQuery.touchConnection",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryTimeEffect,
  input: TouchLiveQueryConnectionInput,
): Effect.fn.Return<
  TouchLiveQueryConnectionResult,
  LiveQueryAuthorityLeaseEffectError
> {
  yield* assertLiveQueryDeploymentProjectEffect(persistence, input);
  return yield* upsertLiveQueryConnectionLeaseEffect(
    persistence,
    readTime,
    input,
  );
});

const upsertLiveQueryConnectionLeaseEffect = Effect.fn(
  "Executor.liveQuery.upsertConnectionLease",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryTimeEffect,
  input: Omit<TouchLiveQueryConnectionInput, "projectId">,
): Effect.fn.Return<TouchLiveQueryConnectionResult, LiveQueryLeaseEffectError> {
  const lease = yield* liveQueryConnectionLeaseEffect(readTime, input);
  const connection = yield* tryLiveQueryPromise(
    "upsert live query connection lease",
    () => persistence.upsertLiveQueryConnectionLease({
      deploymentId: input.deploymentId,
      connectionId: input.connectionId,
      lastSeenAt: lease.lastSeenAt,
      expiresAt: lease.expiresAt,
    }),
  );
  return { connection };
});

const liveQueryConnectionLeaseEffect = Effect.fn(
  "Executor.liveQuery.connectionLease",
)(function* (
  readTime: LiveQueryTimeEffect,
  input: Pick<TouchLiveQueryConnectionInput, "leaseDurationMs" | "now">,
): Effect.fn.Return<
  LiveQueryConnectionLease,
  LiveQueryLeaseEffectError
> {
  const nowOverride = yield* tryLiveQuerySync(
    "read live query lease time override",
    () => input.now,
  );
  const now = nowOverride ?? (yield* readTime);
  return yield* tryLiveQuerySync(
    "build live query connection lease",
    () => liveQueryConnectionLease(now, input.leaseDurationMs),
  );
});

function liveQueryConnectionLease(
  now: Date,
  leaseDurationMs: number | undefined,
): LiveQueryConnectionLease {
  const duration =
    leaseDurationMs ?? DEFAULT_LIVE_QUERY_CONNECTION_LEASE_MS;
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new Error("leaseDurationMs must be a positive integer.");
  }
  return {
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + duration),
  };
}

export const recordLiveQuerySubscriptionEffect = Effect.fn(
  "Executor.liveQuery.recordSubscription",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryTimeEffect,
  input: RecordLiveQuerySubscriptionInput,
): Effect.fn.Return<
  RecordLiveQuerySubscriptionResult,
  LiveQueryAuthorityLeaseEffectError
> {
  yield* assertLiveQueryDeploymentProjectEffect(persistence, input);
  const leaseInput = yield* tryLiveQuerySync(
    "prepare live query subscription lease input",
    () => input.updatedAt === undefined ? {} : { now: input.updatedAt },
  );
  const lease = yield* liveQueryConnectionLeaseEffect(readTime, leaseInput);
  const evidence = yield* tryLiveQuerySync(
    "project live query subscription evidence",
    () => ({
      readSet: readSetToFreshnessReadSet(input.readSet, input.beginTs),
      resultHash: fingerprintJson(input.resultJson),
    }),
  );
  const subscription = yield* tryLiveQueryPromise(
    "upsert live query subscription with lease",
    () => persistence.upsertLiveQuerySubscriptionWithLease({
      deploymentId: input.deploymentId,
      connectionId: input.connectionId,
      queryId: input.queryId,
      functionPath: input.functionPath,
      argsJson: input.argsJson,
      identityJson: input.identity ?? { kind: "anonymous" },
      partitionKey: input.partitionKey ?? null,
      beginTs: input.beginTs,
      // SAFETY: readSetToFreshnessReadSet returns a plain JSON-object read
      // set, which is what the persistence JSON column accepts.
      readSetJson: evidence.readSet as Record<string, unknown>,
      resultJson: input.resultJson,
      resultHash: evidence.resultHash,
      lastSeenAt: lease.lastSeenAt,
      expiresAt: lease.expiresAt,
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    }),
  );

  return {
    subscription,
    resultHash: evidence.resultHash,
  };
});

export async function removeLiveQuerySubscription(
  persistence: FlarexExecutorControlPersistence,
  input: RemoveLiveQuerySubscriptionInput,
): Promise<DeleteLiveQuerySubscriptionResult> {
  await assertLiveQueryDeploymentProject(persistence, input);
  return await persistence.deleteLiveQuerySubscription(input);
}

export const removeLiveQuerySubscriptionsForConnectionEffect = Effect.fn(
  "Executor.liveQuery.removeSubscriptionsForConnection",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryTimeEffect,
  input: RemoveLiveQuerySubscriptionsForConnectionInput,
): Effect.fn.Return<
  DeleteLiveQuerySubscriptionResult,
  LiveQueryAuthorityLeaseEffectError
> {
  yield* assertLiveQueryDeploymentProjectEffect(persistence, input);
  const closeLiveQueryConnection = yield* tryLiveQuerySync(
    "close live query connection",
    () => persistence.closeLiveQueryConnection,
  );
  const closeKey = yield* tryLiveQuerySync(
    "prepare live query connection close key",
    () => ({
      deploymentId: input.deploymentId,
      connectionId: input.connectionId,
    }),
  );
  const closedAt = yield* readTime;
  yield* tryLiveQueryPromise(
    "close live query connection",
    () => Reflect.apply(
      closeLiveQueryConnection,
      persistence,
      [{
        deploymentId: closeKey.deploymentId,
        connectionId: closeKey.connectionId,
        closedAt,
      }],
    ),
  );
  return yield* tryLiveQueryPromise(
    "delete live query subscriptions for connection",
    () => persistence.deleteLiveQuerySubscriptionsForConnection(input),
  );
});

export const removeExpiredLiveQuerySubscriptionsEffect = Effect.fn(
  "Executor.liveQuery.removeExpiredSubscriptions",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryTimeEffect,
  input: RemoveExpiredLiveQuerySubscriptionsInput,
): Effect.fn.Return<
  DeleteExpiredLiveQuerySubscriptionsResult,
  LiveQueryAuthorityLeaseEffectError
> {
  yield* assertLiveQueryDeploymentProjectEffect(persistence, input);
  const deleteExpiredLiveQuerySubscriptions = yield* tryLiveQuerySync(
    "delete expired live query subscriptions",
    () => persistence.deleteExpiredLiveQuerySubscriptions,
  );
  const deploymentId = yield* tryLiveQuerySync(
    "read live query expiry deployment id",
    () => input.deploymentId,
  );
  const expiredAtOverride = yield* tryLiveQuerySync(
    "read live query expiry cutoff override",
    () => input.expiredAt,
  );
  const expiredAt = expiredAtOverride ?? (yield* readTime);
  return yield* tryLiveQueryPromise(
    "delete expired live query subscriptions",
    () => Reflect.apply(
      deleteExpiredLiveQuerySubscriptions,
      persistence,
      [{
        deploymentId,
        expiredAt,
      }],
    ),
  );
});

export const listExpiredLiveQueryConnectionDeploymentsEffect = Effect.fn(
  "Executor.liveQuery.listExpiredConnectionDeployments",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryTimeEffect,
  input: ListExpiredLiveQueryConnectionDeploymentsInput,
): Effect.fn.Return<
  ListExpiredLiveQueryConnectionDeploymentsResult,
  LiveQueryDeliveryPolicyError | LiveQueryLeaseEffectError
> {
  const limit = yield* Effect.try({
    try: () => liveQueryConnectionCleanupLimit(input.limit),
    catch: (cause) => cause instanceof LiveQueryDeliveryPolicyError
      ? cause
      : new LiveQueryForeignOperationError({
        operation: "validate expired live query deployment limit",
        cause,
      }),
  });
  const listExpiredLiveQueryConnectionDeployments = yield* tryLiveQuerySync(
    "list expired live query connection deployments",
    () => persistence.listExpiredLiveQueryConnectionDeployments,
  );
  const expiredAtOverride = yield* tryLiveQuerySync(
    "read live query expiry cutoff override",
    () => input.expiredAt,
  );
  const expiredAt = expiredAtOverride ?? (yield* readTime);
  return yield* tryLiveQueryPromise(
    "list expired live query connection deployments",
    () => Reflect.apply(
      listExpiredLiveQueryConnectionDeployments,
      persistence,
      [{
        expiredAt,
        limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      }],
    ),
  );
});

const assertLiveQueryDeploymentProjectEffect = Effect.fn(
  "Executor.liveQuery.assertDeploymentProject",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  input: { deploymentId: string; projectId: string },
): Effect.fn.Return<
  void,
  DeploymentProjectMismatchError | LiveQueryForeignOperationError
> {
  yield* tryLiveQueryAuthorityPromise(
    () => assertLiveQueryDeploymentProject(persistence, input),
  );
});

async function assertLiveQueryDeploymentProject(
  persistence: FlarexExecutorControlPersistence,
  input: { deploymentId: string; projectId: string },
): Promise<void> {
  await ensureDeployment(persistence, input);
}

function liveQueryConnectionCleanupLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_EXPIRED_CONNECTION_DEPLOYMENT_LIMIT;
  if (Number.isInteger(limit) && limit > 0) return limit;
  throw new LiveQueryDeliveryPolicyError("limit must be a positive integer.");
}

export const findStaleLiveQuerySubscriptionsEffect = Effect.fn(
  "Executor.liveQuery.findStaleSubscriptions",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryTimeEffect,
  input: FindStaleLiveQuerySubscriptionsInput,
): Effect.fn.Return<
  FindStaleLiveQuerySubscriptionsResult,
  LiveQueryLeaseEffectError
> {
  const listActiveLiveQuerySubscriptions = yield* tryLiveQuerySync(
    "list active live query subscriptions",
    () => persistence.listActiveLiveQuerySubscriptions,
  );
  const deploymentId = yield* tryLiveQuerySync(
    "read live query active deployment id",
    () => input.deploymentId,
  );
  const activeAtOverride = yield* tryLiveQuerySync(
    "read live query active cutoff override",
    () => input.activeAt,
  );
  const activeAt = activeAtOverride ?? (yield* readTime);
  const subscriptions = yield* tryLiveQueryPromise(
    "list active live query subscriptions",
    () => Reflect.apply(
      listActiveLiveQuerySubscriptions,
      persistence,
      [{
        deploymentId,
        activeAt,
      }],
    ),
  );
  const result: FindStaleLiveQuerySubscriptionsResult = {
    fresh: [],
    stale: [],
    unsupported: [],
  };

  for (const subscription of subscriptions) {
    const freshness = yield* tryLiveQueryPromise(
      "check live query read set freshness",
      () => checkReadSetFreshness({
        store: input.freshnessStore,
        deploymentId: input.deploymentId,
        // SAFETY: this module persisted readSetJson from a validated
        // FreshnessReadSet produced by readSetToFreshnessReadSet.
        readSet: subscription.readSetJson as FreshnessReadSet,
      }),
    );
    yield* tryLiveQuerySync(
      "classify live query subscription freshness",
      () => {
        const entry = { subscription, freshness };
        if (freshness.status === "fresh") {
          result.fresh.push(entry);
        } else if (freshness.status === "stale") {
          result.stale.push(entry);
        } else {
          result.unsupported.push(entry);
        }
      },
    );
  }

  return result;
});

export async function rerunLiveQuerySubscription(
  persistence: FlarexExecutorControlPersistence,
  input: RerunLiveQuerySubscriptionInput,
): Promise<RerunLiveQuerySubscriptionResult> {
  const previousResultHash = input.subscription.resultHash;
  let rerun: RerunLiveQuerySubscriptionOutput;
  try {
    rerun = await input.runQuery(input.subscription);
  } catch (error) {
    const errorText = errorMessage(error);
    const identityFingerprint = executionIdentityFingerprint(input.subscription.identityJson);
    const deliveryPayload: LiveQueryChange = {
      kind: "failed",
      deploymentId: input.subscription.deploymentId,
      connectionId: input.subscription.connectionId,
      queryId: input.subscription.queryId,
      functionPath: input.subscription.functionPath,
      // SAFETY: subscription.argsJson is stored validated JSON per the
      // live-query subscription contract.
      argsJson: input.subscription.argsJson as Json,
      identityFingerprint,
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
  const identityFingerprint = executionIdentityFingerprint(input.subscription.identityJson);
  const deliveryPayload: LiveQueryChange = {
    kind: "updated",
    deploymentId: input.subscription.deploymentId,
    connectionId: input.subscription.connectionId,
    queryId: input.subscription.queryId,
    functionPath: input.subscription.functionPath,
    // SAFETY: subscription.argsJson is stored validated JSON per the
    // live-query subscription contract.
    argsJson: input.subscription.argsJson as Json,
    identityFingerprint,
    resultJson: rerun.value,
    previousResultHash,
    resultHash,
  };
  const recorded = await persistence.recordLiveQueryRerunResult({
    deploymentId: input.subscription.deploymentId,
    connectionId: input.subscription.connectionId,
    queryId: input.subscription.queryId,
    functionPath: input.subscription.functionPath,
    // SAFETY: subscription.argsJson is stored validated JSON per the
    // live-query subscription contract.
    argsJson: input.subscription.argsJson as Json,
    identityJson: input.subscription.identityJson,
    partitionKey: input.subscription.partitionKey,
    beginTs: rerun.beginTs,
    // SAFETY: readSetToFreshnessReadSet returns a plain JSON-object read
    // set, which is what the persistence JSON column accepts.
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

export const rerunStaleLiveQuerySubscriptionsEffect = Effect.fn(
  "Executor.liveQuery.rerunStaleSubscriptions",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryTimeEffect,
  ids: IdGenerator,
  input: RerunStaleLiveQuerySubscriptionsInput,
): Effect.fn.Return<
  RerunStaleLiveQuerySubscriptionsResult,
  LiveQueryLeaseEffectError
> {
  yield* tryLiveQuerySync(
    "validate stale live query rerun limit",
    () => {
      if (
        input.limit !== undefined &&
        (!Number.isInteger(input.limit) || input.limit <= 0)
      ) {
        throw new Error("limit must be a positive integer.");
      }
    },
  );

  const scanInput = yield* tryLiveQuerySync(
    "prepare stale live query scan input",
    () => ({
      deploymentId: input.deploymentId,
      freshnessStore: input.freshnessStore,
      ...(input.activeAt === undefined ? {} : { activeAt: input.activeAt }),
    }),
  );
  const scanned = yield* findStaleLiveQuerySubscriptionsEffect(
    persistence,
    readTime,
    scanInput,
  );
  const staleToRerun = yield* tryLiveQuerySync(
    "select stale live query subscriptions",
    () => input.limit === undefined
      ? scanned.stale
      : scanned.stale.slice(0, input.limit),
  );
  const changed: RerunLiveQuerySubscriptionResult[] = [];
  const unchanged: RerunLiveQuerySubscriptionResult[] = [];
  const changes: LiveQueryChange[] = [];

  for (const entry of staleToRerun) {
    const rerun = yield* tryLiveQueryPromise(
      "rerun stale live query subscription",
      () => rerunLiveQuerySubscription(persistence, {
        subscription: entry.subscription,
        deliveryId: ids.nextId(),
        ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
        runQuery: input.runQuery,
      }),
    );
    yield* tryLiveQuerySync(
      "project stale live query change",
      () => {
        if (rerun.changed) {
          changed.push(rerun);
          changes.push(liveQueryChangeFromRerun(rerun));
        } else {
          unchanged.push(rerun);
        }
      },
    );
  }

  if (changes.length > 0) {
    yield* tryLiveQueryPromise(
      "deliver stale live query changes",
      () => Promise.resolve(input.deliverChanges?.(changes)),
    );
  }

  return yield* tryLiveQuerySync(
    "project stale live query result",
    () => ({
      scanned,
      changed,
      unchanged,
      changes,
      unsupported: scanned.unsupported,
      hasMoreStale:
        input.limit !== undefined && scanned.stale.length > staleToRerun.length,
    }),
  );
});

export async function runLiveQuerySubscriptionWithInvoke(
  persistence: FlarexExecutorControlPersistence,
  runInvokeWithRetries: FlarexExecutor["runInvokeWithRetries"],
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

  const result = await runInvokeWithRetries({
    deploymentId: subscription.deploymentId,
    projectId: deployment.projectId,
    path: subscription.functionPath,
    kind: "query",
    // SAFETY: subscription.argsJson is stored validated JSON per the
    // live-query subscription contract.
    args: subscription.argsJson as Json,
    identity: subscription.identityJson,
    partitionKey: subscription.partitionKey,
    ...(input.maxAttempts === undefined
      ? {}
      : { maxAttempts: input.maxAttempts }),
    runAttempt: (attempt) => input.executeQuery(attempt, subscription),
  });

  return {
    value: result.value,
    beginTs: result.beginTs,
    readSet: result.readSet,
  };
}

export function fingerprintJson(value: Json): string {
  return encodeCanonicalJson(value, liveQueryFingerprintInvariantViolation);
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
      // SAFETY: subscription.argsJson is stored validated JSON per the
      // live-query subscription contract.
      argsJson: rerun.subscription.argsJson as Json,
      identityFingerprint: executionIdentityFingerprint(rerun.subscription.identityJson),
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
    // SAFETY: subscription.argsJson and resultJson are stored validated
    // JSON per the live-query subscription contract.
    argsJson: rerun.subscription.argsJson as Json,
    identityFingerprint: executionIdentityFingerprint(rerun.subscription.identityJson),
    // SAFETY: subscription.resultJson is stored validated JSON per the
    // live-query subscription contract.
    resultJson: rerun.subscription.resultJson as Json,
    previousResultHash: rerun.previousResultHash,
    resultHash: rerun.resultHash,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function liveQueryFingerprintInvariantViolation(
  issue: CanonicalJsonEncodingInvariantIssue,
): never {
  throw new Error(
    `Live-query result lost its validated JSON shape while fingerprinting (${issue.reason}).`,
  );
}

export function makeLiveQueryTimeEffect(
  clock: Clock | undefined,
): LiveQueryTimeEffect {
  return makeExecutorTimeEffect(
    clock,
    (cause) => new ConfiguredLiveQueryClockError({ cause }),
  );
}

export function runLiveQueryPromise<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.mapError(liveQueryFailureCause)),
  );
}

export function liveQueryFailureCause(error: unknown): unknown {
  return error instanceof ConfiguredLiveQueryClockError ||
      error instanceof LiveQueryForeignOperationError
    ? error.cause
    : error;
}

function tryLiveQueryPromise<A>(
  operation: LiveQueryForeignOperation,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, LiveQueryForeignOperationError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new LiveQueryForeignOperationError({ operation, cause }),
  });
}

function tryLiveQueryAuthorityPromise<A>(
  evaluate: () => PromiseLike<A>,
): Effect.Effect<
  A,
  DeploymentProjectMismatchError | LiveQueryForeignOperationError
> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => cause instanceof DeploymentProjectMismatchError
      ? cause
      : new LiveQueryForeignOperationError({
        operation: "assert live query deployment project",
        cause,
      }),
  });
}

function tryLiveQuerySync<A>(
  operation: LiveQueryForeignOperation,
  evaluate: () => A,
): Effect.Effect<A, LiveQueryForeignOperationError> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => new LiveQueryForeignOperationError({ operation, cause }),
  });
}
