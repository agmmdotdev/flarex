import { and, eq, sql, type SQL } from "drizzle-orm";
import { Data, Effect, Option, Result, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";

import {
  CommitSeqSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  OutboxSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  type CommitSeq,
  type OutboxSeq,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  fxSystemOutbox,
  type CommitWakeOutboxDeliveryStateV1,
  type CommitWakeOutboxEventKindV1,
  type CommitWakeOutboxFailureCodeV1,
} from "./schema";

export const COMMIT_WAKE_OUTBOX_EVENT_KIND_V1 =
  "deployment_sync_commit_wake_v1" as const satisfies
    CommitWakeOutboxEventKindV1;

export const MAX_COMMIT_WAKE_CLAIM_BATCH_SIZE_V1 = 100;
export const MAX_COMMIT_WAKE_DELAY_MILLISECONDS_V1 = 2_147_483_647;
export const MAX_COMMIT_WAKE_FAILURE_SUMMARY_UTF8_BYTES_V1 = 1_024;

const CANONICAL_UUID_TEXT_V1_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UTF8_ENCODER = new TextEncoder();

export const CommitWakeClaimOwnerV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    CANONICAL_UUID_TEXT_V1_PATTERN.test(value)
      ? undefined
      : "Expected one canonical lowercase claim-owner UUID",
  ),
).pipe(Schema.brand("FlarexDB/CommitWakeClaimOwnerV1"));
export type CommitWakeClaimOwnerV1 =
  typeof CommitWakeClaimOwnerV1Schema.Type;

export const CommitWakeClaimFenceV1Schema = Schema.BigInt.pipe(
  Schema.brand("FlarexDB/CommitWakeClaimFenceV1"),
);
export type CommitWakeClaimFenceV1 =
  typeof CommitWakeClaimFenceV1Schema.Type;

const decodeScopeUuidResult = Schema.decodeUnknownResult(ScopeUuidV1Schema);
const decodeScopeEpochUuidResult = Schema.decodeUnknownResult(
  ScopeEpochUuidV1Schema,
);
const decodeClaimOwnerResult = Schema.decodeUnknownResult(
  CommitWakeClaimOwnerV1Schema,
);

export type CommitWakeOperationV1 =
  | "claimForCommit"
  | "claimReadyBatch"
  | "settleClaim";

export type CommitWakeInputFailureReasonV1 =
  | "scopeUuidInvalid"
  | "commitSeqInvalid"
  | "outboxSeqInvalid"
  | "claimOwnerInvalid"
  | "claimFenceInvalid"
  | "claimBatchLimitInvalid"
  | "leaseMillisecondsInvalid"
  | "retryDelayMillisecondsInvalid"
  | "failureSummaryInvalid"
  | "settlementInvalid";

export type CommitWakeCorruptionReasonV1 =
  | "scopeClockInvalid"
  | "outboxRowInvalid"
  | "outboxSeqAheadOfClock"
  | "commitSeqAheadOfClock"
  | "commitWakeMissing"
  | "missingRetainedHeader"
  | "retainedHeaderEpochMismatch"
  | "claimUpdateMismatch"
  | "settleUpdateMismatch";

export type CommitWakeStaleClaimReasonV1 =
  | "wakeMissing"
  | "notClaimed"
  | "claimOwnerMismatch"
  | "claimFenceMismatch"
  | "claimExpired"
  | "terminal";

export class CommitWakeInputErrorV1 extends Data.TaggedError(
  "CommitWakeInputErrorV1",
)<{
  readonly operation: CommitWakeOperationV1;
  readonly reason: CommitWakeInputFailureReasonV1;
}> {}

export class CommitWakeScopeNotFoundErrorV1 extends Data.TaggedError(
  "CommitWakeScopeNotFoundErrorV1",
)<{
  readonly operation: CommitWakeOperationV1;
  readonly scopeUuid: ScopeUuidV1;
}> {}

export class CommitWakeCorruptionErrorV1 extends Data.TaggedError(
  "CommitWakeCorruptionErrorV1",
)<{
  readonly operation: CommitWakeOperationV1;
  readonly reason: CommitWakeCorruptionReasonV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly outboxSeq?: OutboxSeq;
  readonly commitSeq?: CommitSeq;
}> {}

export class CommitWakeStaleClaimErrorV1 extends Data.TaggedError(
  "CommitWakeStaleClaimErrorV1",
)<{
  readonly reason: CommitWakeStaleClaimReasonV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly outboxSeq: OutboxSeq;
}> {}

export class CommitWakeResourceExhaustionErrorV1 extends Data.TaggedError(
  "CommitWakeResourceExhaustionErrorV1",
)<{
  readonly operation: "claimForCommit" | "claimReadyBatch";
  readonly scopeUuid: ScopeUuidV1;
  readonly outboxSeq: OutboxSeq;
  readonly resource: "claimFence";
}> {}

export class CommitWakeSqlErrorV1 extends Data.TaggedError(
  "CommitWakeSqlErrorV1",
)<{
  readonly operation: CommitWakeOperationV1;
  readonly cause: unknown;
}> {}

export type CommitWakeClaimErrorV1 =
  | CommitWakeInputErrorV1
  | CommitWakeScopeNotFoundErrorV1
  | CommitWakeCorruptionErrorV1
  | CommitWakeResourceExhaustionErrorV1
  | CommitWakeSqlErrorV1;

export type CommitWakeSettleErrorV1 =
  | CommitWakeInputErrorV1
  | CommitWakeScopeNotFoundErrorV1
  | CommitWakeCorruptionErrorV1
  | CommitWakeStaleClaimErrorV1
  | CommitWakeSqlErrorV1;

export interface ClaimCommitWakeForCommitInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly commitSeq: CommitSeq;
  readonly claimOwner: CommitWakeClaimOwnerV1;
  readonly leaseMilliseconds: number;
}

export interface ClaimReadyCommitWakesInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly claimOwner: CommitWakeClaimOwnerV1;
  readonly leaseMilliseconds: number;
  readonly limit: number;
}

export type CommitWakeSettlementV1 =
  | Readonly<{ readonly kind: "delivered" }>
  | Readonly<{
      readonly kind: "retry";
      readonly retryDelayMilliseconds: number;
      readonly failureCode: "transient_delivery";
      readonly failureSummary?: string;
    }>
  | Readonly<{
      readonly kind: "deadLettered";
      readonly failureCode: "terminal_delivery" | "attempts_exhausted";
      readonly failureSummary?: string;
    }>;

export interface SettleCommitWakeClaimInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly outboxSeq: OutboxSeq;
  readonly claimOwner: CommitWakeClaimOwnerV1;
  readonly claimFence: CommitWakeClaimFenceV1;
  readonly settlement: CommitWakeSettlementV1;
}

export interface CommitWakeFailureEvidenceV1 {
  readonly code: CommitWakeOutboxFailureCodeV1;
  readonly summary: string | null;
  readonly failedAtEpochMilliseconds: number;
}

export interface ClaimedCommitWakeV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly outboxSeq: OutboxSeq;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly eventKind: typeof COMMIT_WAKE_OUTBOX_EVENT_KIND_V1;
  readonly claimOwner: CommitWakeClaimOwnerV1;
  readonly claimFence: CommitWakeClaimFenceV1;
  readonly attemptCount: bigint;
  readonly claimedAtEpochMilliseconds: number;
  readonly claimExpiresAtEpochMilliseconds: number;
  readonly previousFailure: CommitWakeFailureEvidenceV1 | null;
}

export type SettledCommitWakeV1 =
  | Readonly<{
      readonly state: "pending";
      readonly scopeUuid: ScopeUuidV1;
      readonly outboxSeq: OutboxSeq;
      readonly nextAttemptAtEpochMilliseconds: number;
    }>
  | Readonly<{
      readonly state: "delivered";
      readonly scopeUuid: ScopeUuidV1;
      readonly outboxSeq: OutboxSeq;
      readonly deliveredAtEpochMilliseconds: number;
    }>
  | Readonly<{
      readonly state: "dead_lettered";
      readonly scopeUuid: ScopeUuidV1;
      readonly outboxSeq: OutboxSeq;
      readonly deadLetteredAtEpochMilliseconds: number;
    }>;

export interface CommitWakeOutboxRepositoryV1 {
  readonly claimForCommit: (
    input: ClaimCommitWakeForCommitInputV1,
  ) => Effect.Effect<
    Option.Option<ClaimedCommitWakeV1>,
    CommitWakeClaimErrorV1
  >;
  readonly claimReadyBatch: (
    input: ClaimReadyCommitWakesInputV1,
  ) => Effect.Effect<
    ReadonlyArray<ClaimedCommitWakeV1>,
    CommitWakeClaimErrorV1
  >;
  readonly settleClaim: (
    input: SettleCommitWakeClaimInputV1,
  ) => Effect.Effect<SettledCommitWakeV1, CommitWakeSettleErrorV1>;
}

interface ValidatedClaimForCommitInputV1
  extends ClaimCommitWakeForCommitInputV1 {}

interface ValidatedClaimReadyBatchInputV1
  extends ClaimReadyCommitWakesInputV1 {}

interface ValidatedSettleClaimInputV1
  extends SettleCommitWakeClaimInputV1 {}

interface CapturedScopeClockV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly lastCommitSeq: CommitSeq;
  readonly oldestAvailableCommitSeq: CommitSeq;
  readonly lastOutboxSeq: OutboxSeq;
  readonly databaseNowEpochMilliseconds: number;
}

interface StoredCommitWakeV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly outboxSeq: OutboxSeq;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly eventKind: CommitWakeOutboxEventKindV1;
  readonly deliveryState: CommitWakeOutboxDeliveryStateV1;
  readonly createdAtEpochMilliseconds: number;
  readonly nextAttemptAtEpochMilliseconds: number | null;
  readonly attemptCount: bigint;
  readonly claimFence: bigint;
  readonly claimOwner: CommitWakeClaimOwnerV1 | null;
  readonly claimedAtEpochMilliseconds: number | null;
  readonly claimExpiresAtEpochMilliseconds: number | null;
  readonly lastFailure: CommitWakeFailureEvidenceV1 | null;
  readonly deliveredAtEpochMilliseconds: number | null;
  readonly deadLetteredAtEpochMilliseconds: number | null;
  readonly claimableAtCapturedDatabaseTime: boolean;
  readonly claimLeaseLiveAtCapturedDatabaseTime: boolean;
}

interface CapturedCommitWakeV1 {
  readonly wake: StoredCommitWakeV1;
  readonly retainedHeaderEpochUuid: ScopeEpochUuidV1 | null;
}

interface CapturedCommitWakeSnapshotV1 {
  readonly clock: CapturedScopeClockV1;
  readonly wakes: ReadonlyArray<CapturedCommitWakeV1>;
}

type TransactionResult<A, E> = Result.Result<A, E>;

class CommitWakeRollbackSignal extends Error {
  readonly failure: CommitWakeCorruptionErrorV1;

  constructor(failure: CommitWakeCorruptionErrorV1) {
    super("Commit-wake transaction rolled back after an invariant failure.");
    this.failure = failure;
  }
}

export function createCommitWakeOutboxRepositoryV1(
  db: FlarexMetadataDatabase,
): CommitWakeOutboxRepositoryV1 {
  const executeTransaction = Effect.fn("CommitWakeOutbox.transaction")(
    <A, E>(
      operation: CommitWakeOperationV1,
      run: () => Promise<TransactionResult<A, E>>,
    ): Effect.Effect<
      TransactionResult<A, E>,
      CommitWakeSqlErrorV1 | CommitWakeCorruptionErrorV1
    > =>
      Effect.uninterruptible(
        Effect.tryPromise({
          try: run,
          catch: (cause) =>
            cause instanceof CommitWakeRollbackSignal
              ? cause.failure
              : new CommitWakeSqlErrorV1({ operation, cause }),
        }),
      ),
  );

  const claimForCommit = Effect.fn("CommitWakeOutbox.claimForCommit")(
    function* (
      rawInput: ClaimCommitWakeForCommitInputV1,
    ): Effect.fn.Return<
      Option.Option<ClaimedCommitWakeV1>,
      CommitWakeClaimErrorV1
    > {
      const input = yield* Effect.fromResult(
        validateClaimForCommitInput(rawInput),
      );
      const result = yield* executeTransaction(
        "claimForCommit",
        () => db.transaction((tx) => claimForCommitTransaction(tx, input)),
      );
      return yield* Effect.fromResult(result);
    },
  );

  const claimReadyBatch = Effect.fn("CommitWakeOutbox.claimReadyBatch")(
    function* (
      rawInput: ClaimReadyCommitWakesInputV1,
    ): Effect.fn.Return<
      ReadonlyArray<ClaimedCommitWakeV1>,
      CommitWakeClaimErrorV1
    > {
      const input = yield* Effect.fromResult(
        validateClaimReadyBatchInput(rawInput),
      );
      const result = yield* executeTransaction(
        "claimReadyBatch",
        () => db.transaction((tx) => claimReadyBatchTransaction(tx, input)),
      );
      return yield* Effect.fromResult(result);
    },
  );

  const settleClaim = Effect.fn("CommitWakeOutbox.settleClaim")(
    function* (
      rawInput: SettleCommitWakeClaimInputV1,
    ): Effect.fn.Return<SettledCommitWakeV1, CommitWakeSettleErrorV1> {
      const input = yield* Effect.fromResult(
        validateSettleClaimInput(rawInput),
      );
      const result = yield* executeTransaction(
        "settleClaim",
        () => db.transaction((tx) => settleClaimTransaction(tx, input)),
      );
      return yield* Effect.fromResult(result);
    },
  );

  return Object.freeze({ claimForCommit, claimReadyBatch, settleClaim });
}

function validateClaimForCommitInput(
  input: ClaimCommitWakeForCommitInputV1,
): Result.Result<ValidatedClaimForCommitInputV1, CommitWakeInputErrorV1> {
  const common = validateClaimInput(
    "claimForCommit",
    input.scopeUuid,
    input.claimOwner,
    input.leaseMilliseconds,
  );
  if (Result.isFailure(common)) return Result.fail(common.failure);
  if (!isPositivePersistedBigInt(input.commitSeq)) {
    return inputFailure("claimForCommit", "commitSeqInvalid");
  }
  return Result.succeed(Object.freeze({
    ...common.success,
    commitSeq: CommitSeqSchema.make(input.commitSeq),
  }));
}

function validateClaimReadyBatchInput(
  input: ClaimReadyCommitWakesInputV1,
): Result.Result<ValidatedClaimReadyBatchInputV1, CommitWakeInputErrorV1> {
  const common = validateClaimInput(
    "claimReadyBatch",
    input.scopeUuid,
    input.claimOwner,
    input.leaseMilliseconds,
  );
  if (Result.isFailure(common)) return Result.fail(common.failure);
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_COMMIT_WAKE_CLAIM_BATCH_SIZE_V1
  ) {
    return inputFailure("claimReadyBatch", "claimBatchLimitInvalid");
  }
  return Result.succeed(Object.freeze({ ...common.success, limit: input.limit }));
}

function validateClaimInput(
  operation: "claimForCommit" | "claimReadyBatch",
  scopeUuid: ScopeUuidV1,
  claimOwner: CommitWakeClaimOwnerV1,
  leaseMilliseconds: number,
): Result.Result<
  Readonly<{
    scopeUuid: ScopeUuidV1;
    claimOwner: CommitWakeClaimOwnerV1;
    leaseMilliseconds: number;
  }>,
  CommitWakeInputErrorV1
> {
  const decodedScope = decodeScopeUuidResult(scopeUuid);
  if (Result.isFailure(decodedScope)) {
    return inputFailure(operation, "scopeUuidInvalid");
  }
  const decodedOwner = decodeClaimOwnerResult(claimOwner);
  if (Result.isFailure(decodedOwner)) {
    return inputFailure(operation, "claimOwnerInvalid");
  }
  if (!isValidDelayMilliseconds(leaseMilliseconds)) {
    return inputFailure(operation, "leaseMillisecondsInvalid");
  }
  return Result.succeed(Object.freeze({
    scopeUuid: decodedScope.success,
    claimOwner: decodedOwner.success,
    leaseMilliseconds,
  }));
}

function validateSettleClaimInput(
  input: SettleCommitWakeClaimInputV1,
): Result.Result<ValidatedSettleClaimInputV1, CommitWakeInputErrorV1> {
  const decodedScope = decodeScopeUuidResult(input.scopeUuid);
  if (Result.isFailure(decodedScope)) {
    return inputFailure("settleClaim", "scopeUuidInvalid");
  }
  if (!isPositivePersistedBigInt(input.outboxSeq)) {
    return inputFailure("settleClaim", "outboxSeqInvalid");
  }
  const decodedOwner = decodeClaimOwnerResult(input.claimOwner);
  if (Result.isFailure(decodedOwner)) {
    return inputFailure("settleClaim", "claimOwnerInvalid");
  }
  if (!isPositivePersistedBigInt(input.claimFence)) {
    return inputFailure("settleClaim", "claimFenceInvalid");
  }
  const settlement = validateSettlement(input.settlement);
  if (Result.isFailure(settlement)) return Result.fail(settlement.failure);
  return Result.succeed(Object.freeze({
    scopeUuid: decodedScope.success,
    outboxSeq: OutboxSeqSchema.make(input.outboxSeq),
    claimOwner: decodedOwner.success,
    claimFence: CommitWakeClaimFenceV1Schema.make(input.claimFence),
    settlement: settlement.success,
  }));
}

function validateSettlement(
  settlement: CommitWakeSettlementV1,
): Result.Result<CommitWakeSettlementV1, CommitWakeInputErrorV1> {
  switch (settlement.kind) {
    case "delivered":
      return Result.succeed(Object.freeze({ kind: "delivered" }));
    case "retry": {
      if (
        settlement.failureCode !== "transient_delivery" ||
        !isValidDelayMilliseconds(settlement.retryDelayMilliseconds)
      ) {
        return inputFailure("settleClaim", "retryDelayMillisecondsInvalid");
      }
      const summary = validateFailureSummary(settlement.failureSummary);
      if (Result.isFailure(summary)) return Result.fail(summary.failure);
      return Result.succeed(Object.freeze({
        kind: "retry",
        retryDelayMilliseconds: settlement.retryDelayMilliseconds,
        failureCode: settlement.failureCode,
        ...(summary.success === undefined
          ? {}
          : { failureSummary: summary.success }),
      }));
    }
    case "deadLettered": {
      if (
        settlement.failureCode !== "terminal_delivery" &&
        settlement.failureCode !== "attempts_exhausted"
      ) {
        return inputFailure("settleClaim", "settlementInvalid");
      }
      const summary = validateFailureSummary(settlement.failureSummary);
      if (Result.isFailure(summary)) return Result.fail(summary.failure);
      return Result.succeed(Object.freeze({
        kind: "deadLettered",
        failureCode: settlement.failureCode,
        ...(summary.success === undefined
          ? {}
          : { failureSummary: summary.success }),
      }));
    }
  }
}

function validateFailureSummary(
  value: string | undefined,
): Result.Result<string | undefined, CommitWakeInputErrorV1> {
  if (value === undefined) return Result.succeed(undefined);
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    UTF8_ENCODER.encode(value).byteLength >
      MAX_COMMIT_WAKE_FAILURE_SUMMARY_UTF8_BYTES_V1
  ) {
    return inputFailure("settleClaim", "failureSummaryInvalid");
  }
  return Result.succeed(value);
}

async function claimForCommitTransaction(
  tx: FlarexMetadataDatabase,
  input: ValidatedClaimForCommitInputV1,
): Promise<TransactionResult<
  Option.Option<ClaimedCommitWakeV1>,
  Exclude<CommitWakeClaimErrorV1, CommitWakeInputErrorV1 | CommitWakeSqlErrorV1>
>> {
  const captured = materializeClaimSnapshot(
    "claimForCommit",
    input.scopeUuid,
    await executeRows(tx, claimForCommitCaptureStatement(input)),
  );
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  const selected = captured.success.wakes[0];
  if (selected === undefined) {
    return Result.fail(corruption(
      "claimForCommit",
      input.scopeUuid,
      "commitWakeMissing",
      undefined,
      input.commitSeq,
    ));
  }
  if (!selected.wake.claimableAtCapturedDatabaseTime) {
    return Result.succeed(Option.none());
  }
  const claimed = await claimCapturedWakes(
    tx,
    "claimForCommit",
    captured.success.clock,
    [selected],
    input.claimOwner,
    input.leaseMilliseconds,
  );
  if (Result.isFailure(claimed)) return Result.fail(claimed.failure);
  const wake = claimed.success[0];
  if (wake === undefined) {
    throw new CommitWakeRollbackSignal(corruption(
      "claimForCommit",
      input.scopeUuid,
      "claimUpdateMismatch",
      selected.wake.outboxSeq,
      selected.wake.commitSeq,
    ));
  }
  return Result.succeed(Option.some(wake));
}

async function claimReadyBatchTransaction(
  tx: FlarexMetadataDatabase,
  input: ValidatedClaimReadyBatchInputV1,
): Promise<TransactionResult<
  ReadonlyArray<ClaimedCommitWakeV1>,
  Exclude<CommitWakeClaimErrorV1, CommitWakeInputErrorV1 | CommitWakeSqlErrorV1>
>> {
  const captured = materializeClaimSnapshot(
    "claimReadyBatch",
    input.scopeUuid,
    await executeRows(tx, claimReadyBatchCaptureStatement(input)),
  );
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  return claimCapturedWakes(
    tx,
    "claimReadyBatch",
    captured.success.clock,
    captured.success.wakes,
    input.claimOwner,
    input.leaseMilliseconds,
  );
}

async function claimCapturedWakes(
  tx: FlarexMetadataDatabase,
  operation: "claimForCommit" | "claimReadyBatch",
  clock: CapturedScopeClockV1,
  selected: ReadonlyArray<CapturedCommitWakeV1>,
  claimOwner: CommitWakeClaimOwnerV1,
  leaseMilliseconds: number,
): Promise<TransactionResult<
  ReadonlyArray<ClaimedCommitWakeV1>,
  CommitWakeCorruptionErrorV1 | CommitWakeResourceExhaustionErrorV1
>> {
  for (const item of selected) {
    if (item.wake.claimFence === MAX_PERSISTED_SIGNED_INT64_V1) {
      return Result.fail(new CommitWakeResourceExhaustionErrorV1({
        operation,
        scopeUuid: clock.scopeUuid,
        outboxSeq: item.wake.outboxSeq,
        resource: "claimFence",
      }));
    }
  }

  const claimed: ClaimedCommitWakeV1[] = [];

  for (const item of selected) {
    const wake = item.wake;
    const reclaimed = wake.deliveryState === "claimed";
    const rows = await tx
      .update(fxSystemOutbox)
      .set({
        deliveryState: "claimed",
        nextAttemptAt: null,
        attemptCount: sql`${fxSystemOutbox.attemptCount} + 1`,
        claimFence: sql`${fxSystemOutbox.claimFence} + 1`,
        claimOwner,
        claimedAt: sql`statement_timestamp()`,
        claimExpiresAt:
          sql`statement_timestamp() + (${leaseMilliseconds} * interval '1 millisecond')`,
        ...(reclaimed
          ? {
              lastFailureCode: "claim_lease_expired" as const,
              lastFailureSummary: null,
              lastFailedAt: sql`statement_timestamp()`,
            }
          : {}),
      })
      .where(and(
        eq(fxSystemOutbox.scopeUuid, wake.scopeUuid),
        eq(fxSystemOutbox.outboxSeq, wake.outboxSeq),
        eq(fxSystemOutbox.deliveryState, wake.deliveryState),
        eq(fxSystemOutbox.claimFence, wake.claimFence),
      ))
      .returning({
        outboxSeq: fxSystemOutbox.outboxSeq,
        claimedAt: fxSystemOutbox.claimedAt,
        claimExpiresAt: fxSystemOutbox.claimExpiresAt,
        lastFailedAt: fxSystemOutbox.lastFailedAt,
      });
    const row = rows[0];
    const claimedAt = row?.claimedAt;
    const claimExpiresAt = row?.claimExpiresAt;
    const lastFailedAt = row?.lastFailedAt;
    if (
      rows.length !== 1 ||
      row?.outboxSeq !== wake.outboxSeq ||
      !isFiniteDate(claimedAt) ||
      !isFiniteDate(claimExpiresAt) ||
      claimExpiresAt.getTime() <= claimedAt.getTime() ||
      (reclaimed && !isFiniteDate(lastFailedAt))
    ) {
      throw new CommitWakeRollbackSignal(corruption(
        operation,
        wake.scopeUuid,
        "claimUpdateMismatch",
        wake.outboxSeq,
        wake.commitSeq,
      ));
    }

    const claimedAtEpochMilliseconds = claimedAt.getTime();
    const claimExpiresAtEpochMilliseconds = claimExpiresAt.getTime();
    const nextFence = wake.claimFence + 1n;
    const previousFailure = reclaimed
      ? freezeFailureEvidence(
          "claim_lease_expired",
          null,
          isFiniteDate(lastFailedAt)
            ? lastFailedAt.getTime()
            : claimedAtEpochMilliseconds,
        )
      : wake.lastFailure;
    claimed.push(Object.freeze({
      scopeUuid: wake.scopeUuid,
      outboxSeq: wake.outboxSeq,
      epochUuid: wake.epochUuid,
      commitSeq: wake.commitSeq,
      eventKind: COMMIT_WAKE_OUTBOX_EVENT_KIND_V1,
      claimOwner,
      claimFence: CommitWakeClaimFenceV1Schema.make(nextFence),
      attemptCount: nextFence,
      claimedAtEpochMilliseconds,
      claimExpiresAtEpochMilliseconds,
      previousFailure,
    }));
  }

  return Result.succeed(Object.freeze(claimed));
}

async function settleClaimTransaction(
  tx: FlarexMetadataDatabase,
  input: ValidatedSettleClaimInputV1,
): Promise<TransactionResult<
  SettledCommitWakeV1,
  Exclude<CommitWakeSettleErrorV1, CommitWakeInputErrorV1 | CommitWakeSqlErrorV1>
>> {
  const captured = materializeClaimSnapshot(
    "settleClaim",
    input.scopeUuid,
    await executeRows(tx, settleClaimCaptureStatement(input)),
  );
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  const selected = captured.success.wakes[0];
  if (selected === undefined) {
    return Result.fail(new CommitWakeStaleClaimErrorV1({
      reason: "wakeMissing",
      scopeUuid: input.scopeUuid,
      outboxSeq: input.outboxSeq,
    }));
  }
  const staleReason = staleClaimReason(
    selected.wake,
    input,
  );
  if (staleReason !== null) {
    return Result.fail(new CommitWakeStaleClaimErrorV1({
      reason: staleReason,
      scopeUuid: input.scopeUuid,
      outboxSeq: input.outboxSeq,
    }));
  }

  const update = settlementUpdate(input);
  const rows = await tx
    .update(fxSystemOutbox)
    .set(update)
    .where(and(
      eq(fxSystemOutbox.scopeUuid, input.scopeUuid),
      eq(fxSystemOutbox.outboxSeq, input.outboxSeq),
      eq(fxSystemOutbox.deliveryState, "claimed"),
      eq(fxSystemOutbox.claimOwner, input.claimOwner),
      eq(fxSystemOutbox.claimFence, input.claimFence),
      sql`${fxSystemOutbox.claimExpiresAt} > clock_timestamp()`,
    ))
    .returning({
      outboxSeq: fxSystemOutbox.outboxSeq,
      nextAttemptAt: fxSystemOutbox.nextAttemptAt,
      deliveredAt: fxSystemOutbox.deliveredAt,
      deadLetteredAt: fxSystemOutbox.deadLetteredAt,
    });
  if (rows.length === 0) {
    return Result.fail(new CommitWakeStaleClaimErrorV1({
      reason: "claimExpired",
      scopeUuid: input.scopeUuid,
      outboxSeq: input.outboxSeq,
    }));
  }
  if (rows.length !== 1 || rows[0]?.outboxSeq !== input.outboxSeq) {
    throw new CommitWakeRollbackSignal(corruption(
      "settleClaim",
      input.scopeUuid,
      "settleUpdateMismatch",
      input.outboxSeq,
      selected.wake.commitSeq,
    ));
  }
  const settled = materializeSettlementResult(input, rows[0]);
  if (settled === null) {
    throw new CommitWakeRollbackSignal(corruption(
      "settleClaim",
      input.scopeUuid,
      "settleUpdateMismatch",
      input.outboxSeq,
      selected.wake.commitSeq,
    ));
  }
  return Result.succeed(settled);
}

function settlementUpdate(
  input: ValidatedSettleClaimInputV1,
) {
  switch (input.settlement.kind) {
    case "delivered":
      return {
        deliveryState: "delivered" as const,
        nextAttemptAt: null,
        claimOwner: null,
        claimedAt: null,
        claimExpiresAt: null,
        deliveredAt: sql`statement_timestamp()`,
      };
    case "retry":
      return {
        deliveryState: "pending" as const,
        nextAttemptAt:
          sql`statement_timestamp() + (${input.settlement.retryDelayMilliseconds} * interval '1 millisecond')`,
        claimOwner: null,
        claimedAt: null,
        claimExpiresAt: null,
        lastFailureCode: input.settlement.failureCode,
        lastFailureSummary: input.settlement.failureSummary ?? null,
        lastFailedAt: sql`statement_timestamp()`,
      };
    case "deadLettered":
      return {
        deliveryState: "dead_lettered" as const,
        nextAttemptAt: null,
        claimOwner: null,
        claimedAt: null,
        claimExpiresAt: null,
        lastFailureCode: input.settlement.failureCode,
        lastFailureSummary: input.settlement.failureSummary ?? null,
        lastFailedAt: sql`statement_timestamp()`,
        deadLetteredAt: sql`statement_timestamp()`,
      };
  }
}

function materializeSettlementResult(
  input: ValidatedSettleClaimInputV1,
  row: Readonly<{
    outboxSeq: bigint;
    nextAttemptAt: Date | null;
    deliveredAt: Date | null;
    deadLetteredAt: Date | null;
  }>,
): SettledCommitWakeV1 | null {
  switch (input.settlement.kind) {
    case "delivered":
      return isFiniteDate(row.deliveredAt)
        ? Object.freeze({
            state: "delivered",
            scopeUuid: input.scopeUuid,
            outboxSeq: input.outboxSeq,
            deliveredAtEpochMilliseconds: row.deliveredAt.getTime(),
          })
        : null;
    case "retry":
      return isFiniteDate(row.nextAttemptAt)
        ? Object.freeze({
            state: "pending",
            scopeUuid: input.scopeUuid,
            outboxSeq: input.outboxSeq,
            nextAttemptAtEpochMilliseconds: row.nextAttemptAt.getTime(),
          })
        : null;
    case "deadLettered":
      return isFiniteDate(row.deadLetteredAt)
        ? Object.freeze({
            state: "dead_lettered",
            scopeUuid: input.scopeUuid,
            outboxSeq: input.outboxSeq,
            deadLetteredAtEpochMilliseconds: row.deadLetteredAt.getTime(),
          })
        : null;
  }
}

function staleClaimReason(
  wake: StoredCommitWakeV1,
  input: ValidatedSettleClaimInputV1,
): CommitWakeStaleClaimReasonV1 | null {
  if (wake.deliveryState === "delivered" || wake.deliveryState === "dead_lettered") {
    return "terminal";
  }
  if (wake.deliveryState !== "claimed") return "notClaimed";
  if (wake.claimOwner !== input.claimOwner) return "claimOwnerMismatch";
  if (wake.claimFence !== input.claimFence) return "claimFenceMismatch";
  if (!wake.claimLeaseLiveAtCapturedDatabaseTime) {
    return "claimExpired";
  }
  return null;
}

function claimForCommitCaptureStatement(
  input: ValidatedClaimForCommitInputV1,
): SQL {
  return captureStatement(input.scopeUuid, sql`
    o.scope_uuid = ${input.scopeUuid}
    and o.event_kind = ${COMMIT_WAKE_OUTBOX_EVENT_KIND_V1}
    and o.commit_seq = ${input.commitSeq}
    order by o.outbox_seq asc
    limit 1
    for update of o
  `);
}

function claimReadyBatchCaptureStatement(
  input: ValidatedClaimReadyBatchInputV1,
): SQL {
  return captureStatement(input.scopeUuid, sql`
    o.scope_uuid = ${input.scopeUuid}
    and o.event_kind = ${COMMIT_WAKE_OUTBOX_EVENT_KIND_V1}
    and o.delivery_state in ('pending', 'claimed')
    and case
      when o.delivery_state = 'pending' then o.next_attempt_at
      when o.delivery_state = 'claimed' then o.claim_expires_at
      else null
    end <= clock.database_now
    order by
      case
        when o.delivery_state = 'pending' then o.next_attempt_at
        when o.delivery_state = 'claimed' then o.claim_expires_at
        else null
      end asc,
      o.outbox_seq asc
    limit ${input.limit}
    for update of o skip locked
  `);
}

function settleClaimCaptureStatement(
  input: ValidatedSettleClaimInputV1,
): SQL {
  return captureStatement(input.scopeUuid, sql`
    o.scope_uuid = ${input.scopeUuid}
    and o.outbox_seq = ${input.outboxSeq}
    order by o.outbox_seq asc
    limit 1
    for update of o
  `);
}

function captureStatement(
  scopeUuid: ScopeUuidV1,
  candidateSelection: SQL,
): SQL {
  return sql`
    with clock_snapshot as materialized (
      select
        scope_uuid,
        last_commit_seq,
        oldest_available_commit_seq,
        last_outbox_seq,
        clock_timestamp() as database_now
      from fx_system_scope_clock
      where scope_uuid = ${scopeUuid}
      limit 1
    ),
    candidate as materialized (
      select o.*
      from fx_system_outbox as o
      cross join clock_snapshot as clock
      where ${candidateSelection}
    )
    select
      clock.scope_uuid::text as "clockScopeUuid",
      clock.last_commit_seq::text as "lastCommitSeqText",
      clock.oldest_available_commit_seq::text as "oldestAvailableCommitSeqText",
      clock.last_outbox_seq::text as "lastOutboxSeqText",
      floor(extract(epoch from clock.database_now) * 1000)::bigint::text
        as "databaseNowEpochMillisecondsText",
      wake.scope_uuid::text as "wakeScopeUuid",
      wake.outbox_seq::text as "outboxSeqText",
      wake.epoch_uuid::text as "wakeEpochUuid",
      wake.commit_seq::text as "wakeCommitSeqText",
      wake.event_kind as "eventKind",
      wake.delivery_state as "deliveryState",
      floor(extract(epoch from wake.created_at) * 1000)::bigint::text
        as "createdAtEpochMillisecondsText",
      floor(extract(epoch from wake.next_attempt_at) * 1000)::bigint::text
        as "nextAttemptAtEpochMillisecondsText",
      wake.attempt_count::text as "attemptCountText",
      wake.claim_fence::text as "claimFenceText",
      wake.claim_owner::text as "claimOwner",
      floor(extract(epoch from wake.claimed_at) * 1000)::bigint::text
        as "claimedAtEpochMillisecondsText",
      floor(extract(epoch from wake.claim_expires_at) * 1000)::bigint::text
        as "claimExpiresAtEpochMillisecondsText",
      wake.last_failure_code as "lastFailureCode",
      wake.last_failure_summary as "lastFailureSummary",
      floor(extract(epoch from wake.last_failed_at) * 1000)::bigint::text
        as "lastFailedAtEpochMillisecondsText",
      floor(extract(epoch from wake.delivered_at) * 1000)::bigint::text
        as "deliveredAtEpochMillisecondsText",
      floor(extract(epoch from wake.dead_lettered_at) * 1000)::bigint::text
        as "deadLetteredAtEpochMillisecondsText",
      case
        when wake.delivery_state = 'pending'
          then wake.next_attempt_at <= clock.database_now
        when wake.delivery_state = 'claimed'
          then wake.claim_expires_at <= clock.database_now
        else false
      end as "claimableAtCapturedDatabaseTime",
      (
        wake.delivery_state = 'claimed'
        and wake.claim_expires_at > clock.database_now
      ) as "claimLeaseLiveAtCapturedDatabaseTime",
      header.epoch_uuid::text as "retainedHeaderEpochUuid"
    from clock_snapshot as clock
    left join candidate as wake on true
    left join fx_system_commit as header
      on header.scope_uuid = wake.scope_uuid
      and header.commit_seq = wake.commit_seq
    order by wake.outbox_seq asc nulls last
  `;
}

async function executeRows(
  tx: FlarexMetadataDatabase,
  statement: SQL,
): Promise<ReadonlyArray<unknown>> {
  return rowsFromExecuteResult(await tx.execute(statement));
}

function materializeClaimSnapshot(
  operation: CommitWakeOperationV1,
  expectedScopeUuid: ScopeUuidV1,
  rawRows: ReadonlyArray<unknown>,
): Result.Result<
  CapturedCommitWakeSnapshotV1,
  CommitWakeScopeNotFoundErrorV1 | CommitWakeCorruptionErrorV1
> {
  if (rawRows.length === 0) {
    return Result.fail(new CommitWakeScopeNotFoundErrorV1({
      operation,
      scopeUuid: expectedScopeUuid,
    }));
  }
  const first = recordFromUnknown(rawRows[0]);
  const clock = decodeClock(first, expectedScopeUuid);
  if (clock === null) {
    return Result.fail(corruption(
      operation,
      expectedScopeUuid,
      "scopeClockInvalid",
    ));
  }

  const wakes: CapturedCommitWakeV1[] = [];
  for (const rawRow of rawRows) {
    const row = recordFromUnknown(rawRow);
    if (!sameClockRow(row, clock)) {
      return Result.fail(corruption(
        operation,
        expectedScopeUuid,
        "scopeClockInvalid",
      ));
    }
    if (row === null) {
      return Result.fail(corruption(
        operation,
        expectedScopeUuid,
        "outboxRowInvalid",
      ));
    }
    const wakeScopeUuid = nullableStringField(row, "wakeScopeUuid");
    if (wakeScopeUuid === undefined) {
      return Result.fail(corruption(
        operation,
        expectedScopeUuid,
        "outboxRowInvalid",
      ));
    }
    if (wakeScopeUuid === null) continue;
    const wake = decodeStoredWake(row, expectedScopeUuid);
    if (wake === null) {
      return Result.fail(corruption(
        operation,
        expectedScopeUuid,
        "outboxRowInvalid",
      ));
    }
    const headerEpoch = decodeNullableEpochUuid(
      nullableStringField(row, "retainedHeaderEpochUuid"),
    );
    if (headerEpoch === undefined) {
      return Result.fail(corruption(
        operation,
        expectedScopeUuid,
        "outboxRowInvalid",
        wake.outboxSeq,
        wake.commitSeq,
      ));
    }
    const correlation = validateCommitCorrelation(
      operation,
      clock,
      wake,
      headerEpoch,
    );
    if (Result.isFailure(correlation)) return Result.fail(correlation.failure);
    wakes.push(Object.freeze({
      wake,
      retainedHeaderEpochUuid: headerEpoch,
    }));
  }
  return Result.succeed(Object.freeze({
    clock,
    wakes: Object.freeze(wakes),
  }));
}

function decodeClock(
  row: Readonly<Record<string, unknown>> | null,
  expectedScopeUuid: ScopeUuidV1,
): CapturedScopeClockV1 | null {
  if (row === null) return null;
  const scope = decodeScopeUuidResult(stringField(row, "clockScopeUuid"));
  const lastCommit = parsePersistedBigInt(
    stringField(row, "lastCommitSeqText"),
    false,
  );
  const floor = parsePersistedBigInt(
    stringField(row, "oldestAvailableCommitSeqText"),
    false,
  );
  const lastOutbox = parsePersistedBigInt(
    stringField(row, "lastOutboxSeqText"),
    false,
  );
  const now = parseEpochMilliseconds(
    stringField(row, "databaseNowEpochMillisecondsText"),
  );
  if (
    Result.isFailure(scope) ||
    scope.success !== expectedScopeUuid ||
    lastCommit === null ||
    floor === null ||
    lastOutbox === null ||
    floor > lastCommit ||
    now === null
  ) {
    return null;
  }
  return Object.freeze({
    scopeUuid: scope.success,
    lastCommitSeq: CommitSeqSchema.make(lastCommit),
    oldestAvailableCommitSeq: CommitSeqSchema.make(floor),
    lastOutboxSeq: OutboxSeqSchema.make(lastOutbox),
    databaseNowEpochMilliseconds: now,
  });
}

function sameClockRow(
  row: Readonly<Record<string, unknown>> | null,
  clock: CapturedScopeClockV1,
): boolean {
  if (row === null) return false;
  return (
    stringField(row, "clockScopeUuid") === clock.scopeUuid &&
    stringField(row, "lastCommitSeqText") === String(clock.lastCommitSeq) &&
    stringField(row, "oldestAvailableCommitSeqText") ===
      String(clock.oldestAvailableCommitSeq) &&
    stringField(row, "lastOutboxSeqText") === String(clock.lastOutboxSeq) &&
    stringField(row, "databaseNowEpochMillisecondsText") ===
      String(clock.databaseNowEpochMilliseconds)
  );
}

function decodeStoredWake(
  row: Readonly<Record<string, unknown>>,
  expectedScopeUuid: ScopeUuidV1,
): StoredCommitWakeV1 | null {
  const scope = decodeScopeUuidResult(stringField(row, "wakeScopeUuid"));
  const epoch = decodeScopeEpochUuidResult(stringField(row, "wakeEpochUuid"));
  const outboxSeq = parsePersistedBigInt(
    stringField(row, "outboxSeqText"),
    true,
  );
  const commitSeq = parsePersistedBigInt(
    stringField(row, "wakeCommitSeqText"),
    true,
  );
  const attemptCount = parsePersistedBigInt(
    stringField(row, "attemptCountText"),
    false,
  );
  const claimFence = parsePersistedBigInt(
    stringField(row, "claimFenceText"),
    false,
  );
  const createdAt = parseEpochMilliseconds(
    stringField(row, "createdAtEpochMillisecondsText"),
  );
  const nextAttemptAt = parseNullableEpochMilliseconds(
    nullableStringField(row, "nextAttemptAtEpochMillisecondsText"),
  );
  const claimedAt = parseNullableEpochMilliseconds(
    nullableStringField(row, "claimedAtEpochMillisecondsText"),
  );
  const claimExpiresAt = parseNullableEpochMilliseconds(
    nullableStringField(row, "claimExpiresAtEpochMillisecondsText"),
  );
  const lastFailedAt = parseNullableEpochMilliseconds(
    nullableStringField(row, "lastFailedAtEpochMillisecondsText"),
  );
  const deliveredAt = parseNullableEpochMilliseconds(
    nullableStringField(row, "deliveredAtEpochMillisecondsText"),
  );
  const deadLetteredAt = parseNullableEpochMilliseconds(
    nullableStringField(row, "deadLetteredAtEpochMillisecondsText"),
  );
  const claimableAtCapturedDatabaseTime = booleanField(
    row,
    "claimableAtCapturedDatabaseTime",
  );
  const claimLeaseLiveAtCapturedDatabaseTime = booleanField(
    row,
    "claimLeaseLiveAtCapturedDatabaseTime",
  );
  if (
    Result.isFailure(scope) ||
    scope.success !== expectedScopeUuid ||
    Result.isFailure(epoch) ||
    outboxSeq === null ||
    commitSeq === null ||
    attemptCount === null ||
    claimFence === null ||
    attemptCount !== claimFence ||
    createdAt === null ||
    nextAttemptAt === undefined ||
    claimedAt === undefined ||
    claimExpiresAt === undefined ||
    lastFailedAt === undefined ||
    deliveredAt === undefined ||
    deadLetteredAt === undefined ||
    claimableAtCapturedDatabaseTime === null ||
    claimLeaseLiveAtCapturedDatabaseTime === null
  ) {
    return null;
  }

  const eventKind = stringField(row, "eventKind");
  const deliveryState = stringField(row, "deliveryState");
  if (
    eventKind !== COMMIT_WAKE_OUTBOX_EVENT_KIND_V1 ||
    !isDeliveryState(deliveryState)
  ) {
    return null;
  }
  const claimOwnerText = nullableStringField(row, "claimOwner");
  if (claimOwnerText === undefined) return null;
  const claimOwner = claimOwnerText === null
    ? null
    : decodeClaimOwnerResult(claimOwnerText);
  if (claimOwner !== null && Result.isFailure(claimOwner)) return null;

  const failureCode = nullableStringField(row, "lastFailureCode");
  const failureSummary = nullableStringField(row, "lastFailureSummary");
  const lastFailure = decodeFailureEvidence(
    failureCode,
    failureSummary,
    lastFailedAt,
  );
  if (lastFailure === undefined) return null;

  const wake: StoredCommitWakeV1 = Object.freeze({
    scopeUuid: scope.success,
    outboxSeq: OutboxSeqSchema.make(outboxSeq),
    epochUuid: epoch.success,
    commitSeq: CommitSeqSchema.make(commitSeq),
    eventKind,
    deliveryState,
    createdAtEpochMilliseconds: createdAt,
    nextAttemptAtEpochMilliseconds: nextAttemptAt,
    attemptCount,
    claimFence,
    claimOwner: claimOwner === null ? null : claimOwner.success,
    claimedAtEpochMilliseconds: claimedAt,
    claimExpiresAtEpochMilliseconds: claimExpiresAt,
    lastFailure,
    deliveredAtEpochMilliseconds: deliveredAt,
    deadLetteredAtEpochMilliseconds: deadLetteredAt,
    claimableAtCapturedDatabaseTime,
    claimLeaseLiveAtCapturedDatabaseTime,
  });
  return isValidStoredState(wake) ? wake : null;
}

function isValidStoredState(wake: StoredCommitWakeV1): boolean {
  const noClaim = wake.claimOwner === null &&
    wake.claimedAtEpochMilliseconds === null &&
    wake.claimExpiresAtEpochMilliseconds === null;
  switch (wake.deliveryState) {
    case "pending":
      return wake.nextAttemptAtEpochMilliseconds !== null &&
        wake.nextAttemptAtEpochMilliseconds >= wake.createdAtEpochMilliseconds &&
        noClaim &&
        wake.deliveredAtEpochMilliseconds === null &&
        wake.deadLetteredAtEpochMilliseconds === null &&
        (wake.attemptCount === 0n
          ? wake.nextAttemptAtEpochMilliseconds ===
              wake.createdAtEpochMilliseconds && wake.lastFailure === null
          : wake.lastFailure !== null &&
            wake.nextAttemptAtEpochMilliseconds >=
              wake.lastFailure.failedAtEpochMilliseconds);
    case "claimed":
      return wake.attemptCount >= 1n &&
        wake.nextAttemptAtEpochMilliseconds === null &&
        wake.claimOwner !== null &&
        wake.claimedAtEpochMilliseconds !== null &&
        wake.claimExpiresAtEpochMilliseconds !== null &&
        wake.deliveredAtEpochMilliseconds === null &&
        wake.deadLetteredAtEpochMilliseconds === null &&
        (wake.attemptCount === 1n
          ? wake.lastFailure === null
          : wake.lastFailure !== null);
    case "delivered":
      return wake.attemptCount >= 1n &&
        wake.nextAttemptAtEpochMilliseconds === null &&
        noClaim &&
        wake.deliveredAtEpochMilliseconds !== null &&
        wake.deadLetteredAtEpochMilliseconds === null &&
        (wake.attemptCount === 1n
          ? wake.lastFailure === null
          : wake.lastFailure !== null);
    case "dead_lettered":
      return wake.attemptCount >= 1n &&
        wake.nextAttemptAtEpochMilliseconds === null &&
        noClaim &&
        wake.deliveredAtEpochMilliseconds === null &&
        wake.deadLetteredAtEpochMilliseconds !== null &&
        wake.lastFailure !== null &&
        (wake.lastFailure.code === "terminal_delivery" ||
          wake.lastFailure.code === "attempts_exhausted");
  }
}

function validateCommitCorrelation(
  operation: CommitWakeOperationV1,
  clock: CapturedScopeClockV1,
  wake: StoredCommitWakeV1,
  retainedHeaderEpochUuid: ScopeEpochUuidV1 | null,
): Result.Result<void, CommitWakeCorruptionErrorV1> {
  if (wake.outboxSeq > clock.lastOutboxSeq) {
    return Result.fail(corruption(
      operation,
      clock.scopeUuid,
      "outboxSeqAheadOfClock",
      wake.outboxSeq,
      wake.commitSeq,
    ));
  }
  if (wake.commitSeq > clock.lastCommitSeq) {
    return Result.fail(corruption(
      operation,
      clock.scopeUuid,
      "commitSeqAheadOfClock",
      wake.outboxSeq,
      wake.commitSeq,
    ));
  }
  if (
    retainedHeaderEpochUuid === null &&
    wake.commitSeq >= clock.oldestAvailableCommitSeq
  ) {
    return Result.fail(corruption(
      operation,
      clock.scopeUuid,
      "missingRetainedHeader",
      wake.outboxSeq,
      wake.commitSeq,
    ));
  }
  if (
    retainedHeaderEpochUuid !== null &&
    retainedHeaderEpochUuid !== wake.epochUuid
  ) {
    return Result.fail(corruption(
      operation,
      clock.scopeUuid,
      "retainedHeaderEpochMismatch",
      wake.outboxSeq,
      wake.commitSeq,
    ));
  }
  return Result.succeed(undefined);
}

function decodeFailureEvidence(
  code: string | null | undefined,
  summary: string | null | undefined,
  failedAtEpochMilliseconds: number | null,
): CommitWakeFailureEvidenceV1 | null | undefined {
  if (code === null && summary === null && failedAtEpochMilliseconds === null) {
    return null;
  }
  if (
    code === undefined ||
    summary === undefined ||
    !isFailureCode(code) ||
    failedAtEpochMilliseconds === null ||
    (summary !== null &&
      (summary.trim().length === 0 ||
        UTF8_ENCODER.encode(summary).byteLength >
          MAX_COMMIT_WAKE_FAILURE_SUMMARY_UTF8_BYTES_V1))
  ) {
    return undefined;
  }
  return freezeFailureEvidence(code, summary, failedAtEpochMilliseconds);
}

function freezeFailureEvidence(
  code: CommitWakeOutboxFailureCodeV1,
  summary: string | null,
  failedAtEpochMilliseconds: number,
): CommitWakeFailureEvidenceV1 {
  return Object.freeze({ code, summary, failedAtEpochMilliseconds });
}

function inputFailure(
  operation: CommitWakeOperationV1,
  reason: CommitWakeInputFailureReasonV1,
): Result.Result<never, CommitWakeInputErrorV1> {
  return Result.fail(new CommitWakeInputErrorV1({ operation, reason }));
}

function corruption(
  operation: CommitWakeOperationV1,
  scopeUuid: ScopeUuidV1,
  reason: CommitWakeCorruptionReasonV1,
  outboxSeq?: OutboxSeq,
  commitSeq?: CommitSeq,
): CommitWakeCorruptionErrorV1 {
  return new CommitWakeCorruptionErrorV1({
    operation,
    reason,
    scopeUuid,
    ...(outboxSeq === undefined ? {} : { outboxSeq }),
    ...(commitSeq === undefined ? {} : { commitSeq }),
  });
}

function isValidDelayMilliseconds(value: number): boolean {
  return Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_COMMIT_WAKE_DELAY_MILLISECONDS_V1;
}

function isPositivePersistedBigInt(value: unknown): value is bigint {
  return typeof value === "bigint" &&
    value >= 1n &&
    value <= MAX_PERSISTED_SIGNED_INT64_V1;
}

function parsePersistedBigInt(
  value: string | undefined,
  positive: boolean,
): bigint | null {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = BigInt(value);
  if (
    parsed > MAX_PERSISTED_SIGNED_INT64_V1 ||
    (positive ? parsed < 1n : parsed < 0n)
  ) {
    return null;
  }
  return parsed;
}

function parseEpochMilliseconds(value: string | undefined): number | null {
  if (value === undefined || !/^-?(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && Number.isFinite(parsed)
    ? parsed
    : null;
}

function parseNullableEpochMilliseconds(
  value: string | null | undefined,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseEpochMilliseconds(value) ?? undefined;
}

function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function decodeNullableEpochUuid(
  value: string | null | undefined,
): ScopeEpochUuidV1 | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const decoded = decodeScopeEpochUuidResult(value);
  return Result.isFailure(decoded) ? undefined : decoded.success;
}

function isDeliveryState(
  value: unknown,
): value is CommitWakeOutboxDeliveryStateV1 {
  return value === "pending" ||
    value === "claimed" ||
    value === "delivered" ||
    value === "dead_lettered";
}

function isFailureCode(
  value: string | null,
): value is CommitWakeOutboxFailureCodeV1 {
  return value === "transient_delivery" ||
    value === "claim_lease_expired" ||
    value === "terminal_delivery" ||
    value === "attempts_exhausted";
}

function recordFromUnknown(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  return isNonArrayRecord(value) ? value : null;
}

function stringField(
  row: Readonly<Record<string, unknown>> | null,
  key: string,
): string | undefined {
  if (row === null) return undefined;
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function booleanField(
  row: Readonly<Record<string, unknown>>,
  key: string,
): boolean | null {
  const value = row[key];
  return typeof value === "boolean" ? value : null;
}

function nullableStringField(
  row: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null | undefined {
  if (row === null) return undefined;
  const value = row[key];
  return value === null
    ? null
    : typeof value === "string"
      ? value
      : undefined;
}

function rowsFromExecuteResult(result: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(result)) return result;
  if (isNonArrayRecord(result) && Array.isArray(result.rows)) {
    return result.rows;
  }
  throw new Error("Commit-wake query returned an invalid driver result.");
}
