import { Data, Effect } from "effect";

import { LiveQueryDeliveryPolicyError } from "./errors";
import { makeExecutorTimeEffect } from "./executorTime";
import type {
  AckLiveQueryDeliveriesInput,
  AckLiveQueryDeliveriesResult,
  ClaimLiveQueryDeliveryBatchInput,
  ClaimLiveQueryDeliveryBatchResult,
  Clock,
  DeadLetterStuckLiveQueryDeliveriesInput,
  DeadLetterStuckLiveQueryDeliveriesResult,
  FlarexExecutorControlPersistence,
  ListUndeliveredLiveQueryDeliveriesInput,
  ListUndeliveredLiveQueryDeliveriesResult,
  MarkLiveQueryDeliveriesDeadLetteredInput,
  MarkLiveQueryDeliveriesDeadLetteredResult,
  MarkLiveQueryDeliveriesDeliveredInput,
  MarkLiveQueryDeliveriesDeliveredResult,
  ListPendingLiveQueryDeliveryDeploymentsInput,
  ListPendingLiveQueryDeliveryDeploymentsResult,
  ListStuckLiveQueryDeliveriesInput,
  ListStuckLiveQueryDeliveriesResult,
  RecordLiveQueryDeliveryFailureInput,
  RecordLiveQueryDeliveryFailureResult,
  RunLiveQueryDeliveryBatchInput,
  RunLiveQueryDeliveryBatchResult,
} from "./types";

const DEFAULT_LIVE_QUERY_DELIVERY_LIMIT = 100;
const DEFAULT_LIVE_QUERY_DELIVERY_LEASE_MS = 30_000;
const MAX_DELIVERY_FAILURE_ERROR_LENGTH = 4000;
const MAX_DELIVERY_DEAD_LETTER_REASON_LENGTH = 4000;

export class ConfiguredLiveQueryDeliveryClockError extends Data.TaggedError(
  "ConfiguredLiveQueryDeliveryClockError",
)<{
  readonly cause: unknown;
}> {}

export class LiveQueryDeliveryForeignOperationError extends Data.TaggedError(
  "LiveQueryDeliveryForeignOperationError",
)<{
  readonly operation: LiveQueryDeliveryForeignOperation;
  readonly cause: unknown;
}> {}

export type LiveQueryDeliveryForeignOperation =
  | "ack live query deliveries"
  | "claim live query deliveries"
  | "deliver live query delivery batch"
  | "group stuck live query deliveries"
  | "list stuck live query deliveries"
  | "mark live query deliveries dead lettered"
  | "prepare live query delivery acknowledgement input"
  | "prepare live query delivery batch acknowledgement"
  | "prepare live query delivery batch claim"
  | "prepare live query delivery claim input"
  | "prepare stuck live query delivery scan"
  | "project live query delivery batch result"
  | "project stuck live query dead letter result"
  | "read live query delivery acknowledgement method"
  | "read live query delivery claim method"
  | "read live query delivery dead letter method"
  | "read live query delivery dead letter time override"
  | "validate live query delivery claim";

type LiveQueryDeliveryTimeEffect = Effect.Effect<
  Date,
  ConfiguredLiveQueryDeliveryClockError
>;

type LiveQueryDeliveryEffectError =
  | ConfiguredLiveQueryDeliveryClockError
  | LiveQueryDeliveryForeignOperationError
  | LiveQueryDeliveryPolicyError;

export async function listUndeliveredLiveQueryDeliveries(
  persistence: FlarexExecutorControlPersistence,
  input: ListUndeliveredLiveQueryDeliveriesInput,
): Promise<ListUndeliveredLiveQueryDeliveriesResult> {
  return await persistence.listUndeliveredLiveQueryDeliveries(input);
}

export async function markLiveQueryDeliveriesDelivered(
  persistence: FlarexExecutorControlPersistence,
  input: MarkLiveQueryDeliveriesDeliveredInput,
): Promise<MarkLiveQueryDeliveriesDeliveredResult> {
  return await persistence.markLiveQueryDeliveriesDelivered(input);
}

export async function markLiveQueryDeliveriesDeadLettered(
  persistence: FlarexExecutorControlPersistence,
  input: MarkLiveQueryDeliveriesDeadLetteredInput,
): Promise<MarkLiveQueryDeliveriesDeadLetteredResult> {
  validateDeliveryIds(input.deliveryIds);
  return await persistence.markLiveQueryDeliveriesDeadLettered({
    ...input,
    reason: deliveryDeadLetterReason(input.reason),
  });
}

export async function listPendingLiveQueryDeliveryDeployments(
  persistence: FlarexExecutorControlPersistence,
  input: ListPendingLiveQueryDeliveryDeploymentsInput,
): Promise<ListPendingLiveQueryDeliveryDeploymentsResult> {
  const limit = liveQueryDeliveryLimit(input.limit);
  return await persistence.listPendingLiveQueryDeliveryDeployments({
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

export async function listStuckLiveQueryDeliveries(
  persistence: FlarexExecutorControlPersistence,
  input: ListStuckLiveQueryDeliveriesInput,
): Promise<ListStuckLiveQueryDeliveriesResult> {
  const limit = liveQueryDeliveryLimit(input.limit);
  const minAttempts = input.minAttempts ?? 1;
  if (!Number.isInteger(minAttempts) || minAttempts <= 0) {
    throw new LiveQueryDeliveryPolicyError(
      "minAttempts must be a positive integer.",
    );
  }
  return await persistence.listStuckLiveQueryDeliveries({
    olderThan: input.olderThan,
    minAttempts,
    limit,
    ...(input.deploymentId === undefined
      ? {}
      : { deploymentId: input.deploymentId }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

export const deadLetterStuckLiveQueryDeliveriesEffect = Effect.fn(
  "Executor.liveQueryDelivery.deadLetterStuck",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryDeliveryTimeEffect,
  input: DeadLetterStuckLiveQueryDeliveriesInput,
): Effect.fn.Return<
  DeadLetterStuckLiveQueryDeliveriesResult,
  LiveQueryDeliveryEffectError
> {
  const preparation = yield* tryLiveQueryDeliveryPolicySync(
    "prepare stuck live query delivery scan",
    () => ({
      reason: deliveryDeadLetterReason(input.reason),
      listInput: {
        olderThan: input.olderThan,
        ...(input.deploymentId === undefined
          ? {}
          : { deploymentId: input.deploymentId }),
        ...(input.minAttempts === undefined
          ? {}
          : { minAttempts: input.minAttempts }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        limit: input.limit ?? DEFAULT_LIVE_QUERY_DELIVERY_LIMIT,
      },
    }),
  );
  const page = yield* tryLiveQueryDeliveryPromise(
    "list stuck live query deliveries",
    () => listStuckLiveQueryDeliveries(persistence, preparation.listInput),
  );
  const emptyResult = yield* tryLiveQueryDeliverySync(
    "project stuck live query dead letter result",
    () => page.deliveries.length === 0
      ? {
          scanned: [],
          deadLettered: [],
          reconnectConnectionIds: [],
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          summary: {
            scanned: 0,
            deadLettered: 0,
            reconnectTargets: 0,
            hasMore: page.hasMore,
          },
        } satisfies DeadLetterStuckLiveQueryDeliveriesResult
      : undefined,
  );
  if (emptyResult !== undefined) return emptyResult;

  const deadLettered: Array<
    DeadLetterStuckLiveQueryDeliveriesResult["deadLettered"][number]
  > = [];
  const byDeployment = yield* tryLiveQueryDeliverySync(
    "group stuck live query deliveries",
    () => deliveriesByDeployment(page.deliveries),
  );
  const deadLetteredAtOverride = yield* tryLiveQueryDeliverySync(
    "read live query delivery dead letter time override",
    () => input.deadLetteredAt,
  );
  const deadLetteredAt = deadLetteredAtOverride ?? (yield* readTime);
  for (const [deploymentId, deliveries] of byDeployment) {
    const markDeadLetteredOperation = yield* tryLiveQueryDeliverySync(
      "read live query delivery dead letter method",
      () => persistence.markLiveQueryDeliveriesDeadLettered,
    );
    const result = yield* tryLiveQueryDeliveryPromise(
      "mark live query deliveries dead lettered",
      () => Reflect.apply(markDeadLetteredOperation, persistence, [{
        deploymentId,
        deliveryIds: deliveries.map(delivery => delivery.deliveryId),
        deadLetteredAt,
        reason: preparation.reason,
      }]),
    );
    yield* tryLiveQueryDeliverySync(
      "project stuck live query dead letter result",
      () => deadLettered.push(...result.deliveries),
    );
  }

  return yield* tryLiveQueryDeliverySync(
    "project stuck live query dead letter result",
    () => {
      const reconnectConnectionIds = uniqueSortedConnectionIds(
        deadLettered,
      );
      return {
        scanned: page.deliveries,
        deadLettered,
        reconnectConnectionIds,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        summary: {
          scanned: page.deliveries.length,
          deadLettered: deadLettered.length,
          reconnectTargets: reconnectConnectionIds.length,
          hasMore: page.hasMore,
        },
      };
    },
  );
});

export async function recordLiveQueryDeliveryFailure(
  persistence: FlarexExecutorControlPersistence,
  input: RecordLiveQueryDeliveryFailureInput,
): Promise<RecordLiveQueryDeliveryFailureResult> {
  if (input.stage !== "fanout" && input.stage !== "ack") {
    throw new LiveQueryDeliveryPolicyError("stage must be fanout or ack.");
  }
  validateDeliveryIds(input.deliveryIds);
  return await persistence.recordLiveQueryDeliveryFailure({
    ...input,
    error: truncateDeliveryFailureError(input.error),
  });
}

export const claimLiveQueryDeliveryBatchEffect = Effect.fn(
  "Executor.liveQueryDelivery.claimBatch",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryDeliveryTimeEffect,
  input: ClaimLiveQueryDeliveryBatchInput,
): Effect.fn.Return<
  ClaimLiveQueryDeliveryBatchResult,
  LiveQueryDeliveryEffectError
> {
  const policy = yield* tryLiveQueryDeliveryPolicySync(
    "validate live query delivery claim",
    () => ({
      limit: liveQueryDeliveryLimit(input.limit),
      leaseDurationMs: liveQueryDeliveryLeaseDurationMs(input.leaseDurationMs),
    }),
  );
  const claimedAt = yield* readTime;
  const claimLiveQueryDeliveries = yield* tryLiveQueryDeliverySync(
    "read live query delivery claim method",
    () => persistence.claimLiveQueryDeliveries,
  );
  const claimInput = yield* tryLiveQueryDeliverySync(
    "prepare live query delivery claim input",
    () => ({
      deploymentId: input.deploymentId,
      limit: policy.limit,
      claimedAt,
      claimExpiresAt: new Date(
        claimedAt.getTime() + policy.leaseDurationMs,
      ),
      ...(input.claimOwner === undefined
        ? {}
        : { claimOwner: input.claimOwner }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
  );
  return yield* tryLiveQueryDeliveryPromise(
    "claim live query deliveries",
    () => Reflect.apply(claimLiveQueryDeliveries, persistence, [claimInput]),
  );
});

export const ackLiveQueryDeliveriesEffect = Effect.fn(
  "Executor.liveQueryDelivery.ack",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryDeliveryTimeEffect,
  input: AckLiveQueryDeliveriesInput,
): Effect.fn.Return<AckLiveQueryDeliveriesResult, LiveQueryDeliveryEffectError> {
  const markDeliveredOperation = yield* tryLiveQueryDeliverySync(
    "read live query delivery acknowledgement method",
    () => persistence.markLiveQueryDeliveriesDelivered,
  );
  const preparation = yield* tryLiveQueryDeliverySync(
    "prepare live query delivery acknowledgement input",
    () => ({
      deploymentId: input.deploymentId,
      deliveryIds: input.deliveryIds,
      deliveredAt: input.deliveredAt,
    }),
  );
  const deliveredAt = preparation.deliveredAt ?? (yield* readTime);
  const claimOwner = yield* tryLiveQueryDeliverySync(
    "prepare live query delivery acknowledgement input",
    () => input.claimOwner === undefined
      ? {}
      : { claimOwner: input.claimOwner },
  );
  return yield* tryLiveQueryDeliveryPromise(
    "ack live query deliveries",
    () => Reflect.apply(markDeliveredOperation, persistence, [{
      deploymentId: preparation.deploymentId,
      deliveryIds: preparation.deliveryIds,
      deliveredAt,
      ...claimOwner,
    }]),
  );
});

export const runLiveQueryDeliveryBatchEffect = Effect.fn(
  "Executor.liveQueryDelivery.runBatch",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: LiveQueryDeliveryTimeEffect,
  input: RunLiveQueryDeliveryBatchInput,
): Effect.fn.Return<
  RunLiveQueryDeliveryBatchResult,
  LiveQueryDeliveryEffectError
> {
  const claimPreparation = yield* tryLiveQueryDeliverySync(
    "prepare live query delivery batch claim",
    () => {
      const claimOwner = input.claimOwner ??
        liveQueryDeliveryClaimOwner(input.deploymentId);
      return {
        claimOwner,
        claimInput: { ...input, claimOwner },
      };
    },
  );
  const page = yield* claimLiveQueryDeliveryBatchEffect(
    persistence,
    readTime,
    claimPreparation.claimInput,
  );
  const emptyResult = yield* tryLiveQueryDeliverySync(
    "project live query delivery batch result",
    () => page.deliveries.length === 0
      ? {
          deliveries: [],
          delivered: 0,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          summary: {
            claimed: 0,
            delivered: 0,
            acked: 0,
            pending: 0,
            hasMore: page.hasMore,
          },
        } satisfies RunLiveQueryDeliveryBatchResult
      : undefined,
  );
  if (emptyResult !== undefined) return emptyResult;

  yield* tryLiveQueryDeliveryPromise(
    "deliver live query delivery batch",
    () => input.deliver(page.deliveries),
  );
  const acknowledgementInput = yield* tryLiveQueryDeliverySync(
    "prepare live query delivery batch acknowledgement",
    () => ({
      deploymentId: input.deploymentId,
      deliveryIds: page.deliveries.map((delivery) => delivery.deliveryId),
      ...(input.deliveredAt === undefined
        ? {}
        : { deliveredAt: input.deliveredAt }),
      claimOwner: claimPreparation.claimOwner,
    }),
  );
  const delivered = yield* ackLiveQueryDeliveriesEffect(
    persistence,
    readTime,
    acknowledgementInput,
  );

  return yield* tryLiveQueryDeliverySync(
    "project live query delivery batch result",
    () => ({
      deliveries: page.deliveries,
      delivered: delivered.delivered,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      summary: {
        claimed: page.deliveries.length,
        delivered: page.deliveries.length,
        acked: delivered.delivered,
        pending: Math.max(0, page.deliveries.length - delivered.delivered),
        hasMore: page.hasMore,
      },
    }),
  );
});

export function makeLiveQueryDeliveryTimeEffect(
  clock: Clock | undefined,
): LiveQueryDeliveryTimeEffect {
  return makeExecutorTimeEffect(
    clock,
    (cause) => new ConfiguredLiveQueryDeliveryClockError({ cause }),
  );
}

export function runLiveQueryDeliveryPromise<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.mapError(liveQueryDeliveryFailureCause)),
  );
}

export function liveQueryDeliveryFailureCause(error: unknown): unknown {
  return error instanceof ConfiguredLiveQueryDeliveryClockError ||
      error instanceof LiveQueryDeliveryForeignOperationError
    ? error.cause
    : error;
}

function truncateDeliveryFailureError(error: string): string {
  if (error.length <= MAX_DELIVERY_FAILURE_ERROR_LENGTH) return error;
  return error.slice(0, MAX_DELIVERY_FAILURE_ERROR_LENGTH);
}

function deliveryDeadLetterReason(reason: string): string {
  if (reason.length === 0) {
    throw new LiveQueryDeliveryPolicyError("reason must be a non-empty string.");
  }
  if (reason.length <= MAX_DELIVERY_DEAD_LETTER_REASON_LENGTH) return reason;
  return reason.slice(0, MAX_DELIVERY_DEAD_LETTER_REASON_LENGTH);
}

function validateDeliveryIds(deliveryIds: string[]): void {
  if (
    deliveryIds.some(
      (deliveryId) => typeof deliveryId !== "string" || deliveryId.length === 0,
    )
  ) {
    throw new LiveQueryDeliveryPolicyError(
      "deliveryIds must contain only non-empty strings.",
    );
  }
}

function deliveriesByDeployment<T extends { deploymentId: string }>(
  deliveries: T[],
): Map<string, T[]> {
  const byDeployment = new Map<string, T[]>();
  for (const delivery of deliveries) {
    const existing = byDeployment.get(delivery.deploymentId);
    if (existing === undefined) {
      byDeployment.set(delivery.deploymentId, [delivery]);
    } else {
      existing.push(delivery);
    }
  }
  return byDeployment;
}

function uniqueSortedConnectionIds(
  deliveries: Array<{ connectionId: string }>,
): string[] {
  return Array.from(new Set(deliveries.map(delivery => delivery.connectionId)))
    .toSorted();
}

function liveQueryDeliveryLimit(limit: number | undefined): number {
  const resolved = limit ?? DEFAULT_LIVE_QUERY_DELIVERY_LIMIT;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved <= 0) {
    throw new LiveQueryDeliveryPolicyError("limit must be a positive integer.");
  }
  return resolved;
}

function liveQueryDeliveryLeaseDurationMs(value: number | undefined): number {
  const resolved = value ?? DEFAULT_LIVE_QUERY_DELIVERY_LEASE_MS;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved <= 0) {
    throw new LiveQueryDeliveryPolicyError(
      "leaseDurationMs must be a positive integer.",
    );
  }
  return resolved;
}

function liveQueryDeliveryClaimOwner(deploymentId: string): string {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `executor:${deploymentId}:${token}`;
}

function tryLiveQueryDeliveryPromise<A>(
  operation: LiveQueryDeliveryForeignOperation,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<
  A,
  LiveQueryDeliveryForeignOperationError | LiveQueryDeliveryPolicyError
> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => cause instanceof LiveQueryDeliveryPolicyError
      ? cause
      : new LiveQueryDeliveryForeignOperationError({ operation, cause }),
  });
}

function tryLiveQueryDeliveryPolicySync<A>(
  operation: LiveQueryDeliveryForeignOperation,
  evaluate: () => A,
): Effect.Effect<
  A,
  LiveQueryDeliveryForeignOperationError | LiveQueryDeliveryPolicyError
> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => cause instanceof LiveQueryDeliveryPolicyError
      ? cause
      : new LiveQueryDeliveryForeignOperationError({ operation, cause }),
  });
}

function tryLiveQueryDeliverySync<A>(
  operation: LiveQueryDeliveryForeignOperation,
  evaluate: () => A,
): Effect.Effect<A, LiveQueryDeliveryForeignOperationError> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => new LiveQueryDeliveryForeignOperationError({
      operation,
      cause,
    }),
  });
}
