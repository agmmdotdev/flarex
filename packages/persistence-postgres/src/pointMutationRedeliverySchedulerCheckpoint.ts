import { bytesEqual, isUint8Array } from "@flarex/utils/bytes";
import { copyFiniteDate, finiteDateMilliseconds } from "@flarex/utils/dates";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isLowercaseUuidText } from "@flarex/utils/strings";
import { sql } from "drizzle-orm";
import { Data, Effect, Exit, Result, Semaphore } from "effect";
import { MAX_PERSISTED_SIGNED_INT64_V1 } from
  "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import {
  MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
  POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
  POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1,
} from "./pointMutationRedeliverySchedulerModel";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

export interface PointMutationRedeliverySchedulerRunV1 {
  readonly _tag: "PointMutationRedeliverySchedulerRunV1";
}

export interface PointMutationRedeliverySchedulerContinuationEvidenceV1 {
  readonly codecVersion: 1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export type PointMutationRedeliverySchedulerAcquireResultV1 =
  | Readonly<{ readonly kind: "notDue"; readonly nextRunAt: Date }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | Readonly<{
      readonly kind: "acquired";
      readonly run: PointMutationRedeliverySchedulerRunV1;
      readonly claimExpiresAt: Date;
      readonly continuation:
        | PointMutationRedeliverySchedulerContinuationEvidenceV1
        | null;
    }>;

export type PointMutationRedeliverySchedulerRenewResultV1 = Readonly<{
  readonly kind: "renewed";
  readonly claimExpiresAt: Date;
}>;

export type PointMutationRedeliverySchedulerCheckpointResultV1 = Readonly<{
  readonly kind: "checkpointed";
  readonly checkpointSequence: bigint;
}>;

export type PointMutationRedeliverySchedulerReleaseResultV1 = Readonly<{
  readonly kind: "released";
  readonly nextRunAt: Date;
}>;

type SchedulerOperationV1 = "acquire" | "renew" | "checkpoint" | "release";

export class PointMutationRedeliverySchedulerConfigurationV1Error
  extends Data.TaggedError(
    "PointMutationRedeliverySchedulerConfigurationV1Error",
  )<{ readonly reason: "invalidClaimDuration" }> {}

export class PointMutationRedeliverySchedulerInputV1Error
  extends Data.TaggedError("PointMutationRedeliverySchedulerInputV1Error")<{
    readonly operation: Exclude<SchedulerOperationV1, "acquire">;
    readonly reason:
      | "invalidRun"
      | "runClosed"
      | "invalidContinuation"
      | "retryCommandMismatch";
  }> {}

export class PointMutationRedeliverySchedulerStaleV1Error
  extends Data.TaggedError("PointMutationRedeliverySchedulerStaleV1Error")<{
    readonly operation: Exclude<SchedulerOperationV1, "acquire">;
    readonly reason: "ownerChanged" | "claimExpired" | "checkpointChanged";
  }> {}

export class PointMutationRedeliverySchedulerCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationRedeliverySchedulerCorruptionV1Error",
  )<{
    readonly operation: SchedulerOperationV1;
    readonly reason:
      | "singletonMissing"
      | "singletonDuplicated"
      | "rowInvalid"
      | "continuationInvalid"
      | "continuationDigestMismatch"
      | "driverResultInvalid";
    readonly cause?: unknown;
  }> {}

export class PointMutationRedeliverySchedulerResourceExhaustedV1Error
  extends Data.TaggedError(
    "PointMutationRedeliverySchedulerResourceExhaustedV1Error",
  )<{
    readonly operation: "acquire" | "checkpoint";
    readonly dimension: "runFence" | "checkpointSequence";
    readonly observed: bigint;
    readonly maximum: bigint;
  }> {}

export class PointMutationRedeliverySchedulerConfirmedRollbackV1Error
  extends Data.TaggedError(
    "PointMutationRedeliverySchedulerConfirmedRollbackV1Error",
  )<{
    readonly operation: SchedulerOperationV1;
    readonly cause: unknown;
  }> {}

export class PointMutationRedeliverySchedulerDecisionUncertainV1Error
  extends Data.TaggedError(
    "PointMutationRedeliverySchedulerDecisionUncertainV1Error",
  )<{
    readonly operation: SchedulerOperationV1;
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export class PointMutationRedeliverySchedulerSqlV1Error
  extends Data.TaggedError("PointMutationRedeliverySchedulerSqlV1Error")<{
    readonly operation: SchedulerOperationV1;
    readonly phase: "infrastructure" | "cleanup" | "statement";
    readonly cause: unknown;
  }> {}

export class PointMutationRedeliverySchedulerCryptoV1Error
  extends Data.TaggedError("PointMutationRedeliverySchedulerCryptoV1Error")<{
    readonly operation: "acquire" | "checkpoint";
    readonly cause: unknown;
  }> {}

export type PointMutationRedeliverySchedulerV1Error =
  | PointMutationRedeliverySchedulerConfigurationV1Error
  | PointMutationRedeliverySchedulerInputV1Error
  | PointMutationRedeliverySchedulerStaleV1Error
  | PointMutationRedeliverySchedulerCorruptionV1Error
  | PointMutationRedeliverySchedulerResourceExhaustedV1Error
  | PointMutationRedeliverySchedulerConfirmedRollbackV1Error
  | PointMutationRedeliverySchedulerDecisionUncertainV1Error
  | PointMutationRedeliverySchedulerSqlV1Error
  | PointMutationRedeliverySchedulerCryptoV1Error;

type PointMutationRedeliverySchedulerCommonTransactionV1Error =
  | PointMutationRedeliverySchedulerCorruptionV1Error
  | PointMutationRedeliverySchedulerConfirmedRollbackV1Error
  | PointMutationRedeliverySchedulerDecisionUncertainV1Error
  | PointMutationRedeliverySchedulerSqlV1Error;

type PointMutationRedeliverySchedulerAcquireTransactionV1Error =
  | PointMutationRedeliverySchedulerCommonTransactionV1Error
  | PointMutationRedeliverySchedulerConfigurationV1Error
  | PointMutationRedeliverySchedulerResourceExhaustedV1Error;

type PointMutationRedeliverySchedulerRenewTransactionV1Error =
  | PointMutationRedeliverySchedulerCommonTransactionV1Error
  | PointMutationRedeliverySchedulerConfigurationV1Error
  | PointMutationRedeliverySchedulerStaleV1Error;

type PointMutationRedeliverySchedulerCheckpointTransactionV1Error =
  | PointMutationRedeliverySchedulerCommonTransactionV1Error
  | PointMutationRedeliverySchedulerStaleV1Error
  | PointMutationRedeliverySchedulerResourceExhaustedV1Error;

type PointMutationRedeliverySchedulerReleaseTransactionV1Error =
  | PointMutationRedeliverySchedulerCommonTransactionV1Error
  | PointMutationRedeliverySchedulerStaleV1Error;

export type PointMutationRedeliverySchedulerAcquireV1Error =
  | PointMutationRedeliverySchedulerConfigurationV1Error
  | PointMutationRedeliverySchedulerAcquireTransactionV1Error
  | PointMutationRedeliverySchedulerCryptoV1Error;

export type PointMutationRedeliverySchedulerRenewV1Error =
  | PointMutationRedeliverySchedulerConfigurationV1Error
  | PointMutationRedeliverySchedulerInputV1Error
  | PointMutationRedeliverySchedulerRenewTransactionV1Error;

export type PointMutationRedeliverySchedulerCheckpointV1Error =
  | PointMutationRedeliverySchedulerInputV1Error
  | PointMutationRedeliverySchedulerCheckpointTransactionV1Error
  | PointMutationRedeliverySchedulerCryptoV1Error;

export type PointMutationRedeliverySchedulerReleaseV1Error =
  | PointMutationRedeliverySchedulerInputV1Error
  | PointMutationRedeliverySchedulerReleaseTransactionV1Error;

export function isPointMutationRedeliverySchedulerAcquireConfirmedRollbackV1Error(
  error: PointMutationRedeliverySchedulerAcquireV1Error,
): error is PointMutationRedeliverySchedulerConfirmedRollbackV1Error {
  return isConfirmedRollbackForOperation(error, "acquire");
}

export function isPointMutationRedeliverySchedulerRenewConfirmedRollbackV1Error(
  error: PointMutationRedeliverySchedulerRenewV1Error,
): error is PointMutationRedeliverySchedulerConfirmedRollbackV1Error {
  return isConfirmedRollbackForOperation(error, "renew");
}

export function isPointMutationRedeliverySchedulerCheckpointConfirmedRollbackV1Error(
  error: PointMutationRedeliverySchedulerCheckpointV1Error,
): error is PointMutationRedeliverySchedulerConfirmedRollbackV1Error {
  return isConfirmedRollbackForOperation(error, "checkpoint");
}

export function isPointMutationRedeliverySchedulerReleaseConfirmedRollbackV1Error(
  error: PointMutationRedeliverySchedulerReleaseV1Error,
): error is PointMutationRedeliverySchedulerConfirmedRollbackV1Error {
  return isConfirmedRollbackForOperation(error, "release");
}

function isConfirmedRollbackForOperation(
  error: PointMutationRedeliverySchedulerV1Error,
  operation: SchedulerOperationV1,
): error is PointMutationRedeliverySchedulerConfirmedRollbackV1Error {
  return error instanceof PointMutationRedeliverySchedulerConfirmedRollbackV1Error &&
    error.operation === operation;
}

export interface PointMutationRedeliverySchedulerCheckpointV1 {
  readonly configuration: Result.Result<
    Readonly<{ readonly claimDurationMilliseconds: number }>,
    PointMutationRedeliverySchedulerConfigurationV1Error
  >;
  readonly acquireEffect: () => Effect.Effect<
    PointMutationRedeliverySchedulerAcquireResultV1,
    PointMutationRedeliverySchedulerAcquireV1Error
  >;
  readonly renewEffect: (
    run: PointMutationRedeliverySchedulerRunV1,
  ) => Effect.Effect<
    PointMutationRedeliverySchedulerRenewResultV1,
    PointMutationRedeliverySchedulerRenewV1Error
  >;
  readonly checkpointEffect: (
    run: PointMutationRedeliverySchedulerRunV1,
    continuation:
      | PointMutationRedeliverySchedulerContinuationEvidenceV1
      | null,
  ) => Effect.Effect<
    PointMutationRedeliverySchedulerCheckpointResultV1,
    PointMutationRedeliverySchedulerCheckpointV1Error
  >;
  readonly releaseEffect: (
    run: PointMutationRedeliverySchedulerRunV1,
  ) => Effect.Effect<
    PointMutationRedeliverySchedulerReleaseResultV1,
    PointMutationRedeliverySchedulerReleaseV1Error
  >;
}

export interface PointMutationRedeliverySchedulerCheckpointOptionsV1 {
  readonly claimDurationMilliseconds: number;
  readonly randomUuid?: () => string;
}

interface MutableRunStateV1 {
  readonly owner: string;
  readonly runFence: bigint;
  checkpointSequence: bigint;
  checkpointDigest: Uint8Array | null;
  claimExpiresAtMilliseconds: number;
  closed: boolean;
  pendingRetry: PendingRetryV1 | null;
  readonly operationGate: ReturnType<typeof Semaphore.makeUnsafe>;
}

type PendingRetryV1 = Readonly<{
  readonly operation: "renew" | "checkpoint" | "release";
  readonly commandDigest: Uint8Array | null;
}>;

class SchedulerStatementFailureV1 extends Error {
  constructor(
    readonly operation: SchedulerOperationV1,
    readonly cause: unknown,
  ) {
    super("Point-mutation redelivery scheduler SQL statement failed.", {
      cause,
    });
  }
}

interface LockedSchedulerRowV1 {
  readonly state: "idle" | "claimed";
  readonly runFence: bigint;
  readonly checkpointSequence: bigint;
  readonly runOwner: string | null;
  readonly claimedAt: Date | null;
  readonly claimExpiresAt: Date | null;
  readonly nextRunAt: Date;
  readonly continuationCodecVersion: number | null;
  readonly continuationSize: number | null;
  readonly continuationSha256: Uint8Array | null;
  readonly continuationBytesSelected: boolean;
  readonly continuationBytes: Uint8Array | null;
  readonly databaseNow: Date;
}

interface TransactionAcquiredV1 {
  readonly kind: "acquired";
  readonly owner: string;
  readonly runFence: bigint;
  readonly claimExpiresAt: Date;
  readonly continuationCodecVersion: number | null;
  readonly continuationBytes: Uint8Array | null;
  readonly continuationSha256: Uint8Array | null;
}

type TransactionAcquireResultV1 =
  | Readonly<{ readonly kind: "notDue"; readonly nextRunAt: Date }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | TransactionAcquiredV1;

export function createPointMutationRedeliverySchedulerCheckpointV1(
  target: LocatedReadCommittedAttemptTargetV1,
  options: PointMutationRedeliverySchedulerCheckpointOptionsV1,
): PointMutationRedeliverySchedulerCheckpointV1 {
  const configuration = captureConfiguration(options);
  const runs = new WeakMap<object, MutableRunStateV1>();
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());

  const acquireEffect: PointMutationRedeliverySchedulerCheckpointV1[
    "acquireEffect"
  ] = Effect.fn(
    "PointMutationRedeliverySchedulerCheckpoint.acquire",
  )(function* () {
    const config = yield* Effect.fromResult(configuration);
    const owner = randomUuid();
    if (!isLowercaseUuidText(owner)) {
      return yield* new PointMutationRedeliverySchedulerCorruptionV1Error({
        operation: "acquire",
        reason: "rowInvalid",
      });
    }
    const transaction = target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
      acquireTransaction(tx, owner, config.claimDurationMilliseconds)
    );
    const result = yield* awaitSettlement(
      transaction,
      mapAcquireTransactionFailure,
    );
    if (result.kind !== "acquired") return captureNonAcquired(result);

    const continuation = yield* captureReloadedContinuationEffect(result);
    const expiresAtMilliseconds = finiteDateMilliseconds(result.claimExpiresAt);
    if (expiresAtMilliseconds === undefined) {
      return yield* corruption("acquire", "rowInvalid");
    }
    const run = Object.freeze({
      _tag: "PointMutationRedeliverySchedulerRunV1" as const,
    });
    runs.set(run, {
      owner: result.owner,
      runFence: result.runFence,
      checkpointSequence: 0n,
      checkpointDigest: continuation === null
        ? null
        : new Uint8Array(continuation.sha256),
      claimExpiresAtMilliseconds: expiresAtMilliseconds,
      closed: false,
      pendingRetry: null,
      operationGate: Semaphore.makeUnsafe(1),
    });
    return Object.freeze({
      kind: "acquired" as const,
      run,
      claimExpiresAt: new Date(expiresAtMilliseconds),
      continuation,
    });
  });

  const renewEffect: PointMutationRedeliverySchedulerCheckpointV1[
    "renewEffect"
  ] = Effect.fn(
    "PointMutationRedeliverySchedulerCheckpoint.renew",
  )(function* (run: PointMutationRedeliverySchedulerRunV1) {
    const config = yield* Effect.fromResult(configuration);
    return yield* withRunOperation(runs, run, "renew", null, (state) =>
      Effect.gen(function* () {
        const transaction = target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
          renewTransaction(tx, state, config.claimDurationMilliseconds)
        );
        const result = yield* awaitRunSettlement(
          state,
          "renew",
          null,
          transaction,
          mapRenewTransactionFailure,
        );
        const expiresAtMilliseconds = finiteDateMilliseconds(
          result.claimExpiresAt,
        );
        if (expiresAtMilliseconds === undefined) {
          closeRun(state);
          return yield* corruption("renew", "rowInvalid");
        }
        state.claimExpiresAtMilliseconds = expiresAtMilliseconds;
        state.pendingRetry = null;
        return Object.freeze({
          kind: "renewed" as const,
          claimExpiresAt: new Date(expiresAtMilliseconds),
        });
      })
    );
  });

  const checkpointEffect: PointMutationRedeliverySchedulerCheckpointV1[
    "checkpointEffect"
  ] = Effect.fn(
    "PointMutationRedeliverySchedulerCheckpoint.checkpoint",
  )(function* (
    run: PointMutationRedeliverySchedulerRunV1,
    continuation:
      | PointMutationRedeliverySchedulerContinuationEvidenceV1
      | null,
  ) {
    const captured = yield* captureCheckpointEvidenceEffect(continuation);
    const commandDigest = captured === null ? null : captured.sha256;
    return yield* withRunOperation(
      runs,
      run,
      "checkpoint",
      commandDigest,
      (state) => Effect.gen(function* () {
        if (state.checkpointSequence === MAX_PERSISTED_SIGNED_INT64_V1) {
          return yield* new PointMutationRedeliverySchedulerResourceExhaustedV1Error({
            operation: "checkpoint",
            dimension: "checkpointSequence",
            observed: state.checkpointSequence,
            maximum: MAX_PERSISTED_SIGNED_INT64_V1,
          });
        }
        const transaction = target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
          checkpointTransaction(tx, state, captured)
        );
        const result = yield* awaitRunSettlement(
          state,
          "checkpoint",
          commandDigest,
          transaction,
          mapCheckpointTransactionFailure,
        );
        state.checkpointSequence = result.checkpointSequence;
        state.checkpointDigest = commandDigest === null
          ? null
          : new Uint8Array(commandDigest);
        state.pendingRetry = null;
        return Object.freeze({
          kind: "checkpointed" as const,
          checkpointSequence: result.checkpointSequence,
        });
      }),
    );
  });

  const releaseEffect: PointMutationRedeliverySchedulerCheckpointV1[
    "releaseEffect"
  ] = Effect.fn(
    "PointMutationRedeliverySchedulerCheckpoint.release",
  )(function* (run: PointMutationRedeliverySchedulerRunV1) {
    return yield* withRunOperation(runs, run, "release", null, (state) =>
      Effect.gen(function* () {
        const transaction = target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
          releaseTransaction(tx, state)
        );
        const result = yield* awaitRunSettlement(
          state,
          "release",
          null,
          transaction,
          mapReleaseTransactionFailure,
        );
        closeRun(state);
        const nextRunAt = copyFiniteDate(result.nextRunAt);
        if (nextRunAt === undefined) {
          return yield* corruption("release", "rowInvalid");
        }
        return Object.freeze({ kind: "released" as const, nextRunAt });
      })
    );
  });

  return Object.freeze({
    configuration,
    acquireEffect,
    renewEffect,
    checkpointEffect,
    releaseEffect,
  });
}

function captureConfiguration(
  options: PointMutationRedeliverySchedulerCheckpointOptionsV1,
): PointMutationRedeliverySchedulerCheckpointV1["configuration"] {
  return isPositiveSafeInteger(options.claimDurationMilliseconds)
    ? Result.succeed(Object.freeze({
      claimDurationMilliseconds: options.claimDurationMilliseconds,
    }))
    : Result.fail(
      new PointMutationRedeliverySchedulerConfigurationV1Error({
        reason: "invalidClaimDuration",
      }),
    );
}

async function acquireTransaction(
  tx: AppRowTransaction,
  owner: string,
  claimDurationMilliseconds: number,
): Promise<TransactionAcquireResultV1> {
  const row = await lockSchedulerRow(tx, "acquire", true);
  const now = finiteDateMilliseconds(row.databaseNow);
  const nextRunAt = finiteDateMilliseconds(row.nextRunAt);
  const claimExpiresAt = row.claimExpiresAt === null
    ? undefined
    : finiteDateMilliseconds(row.claimExpiresAt);
  if (now === undefined || nextRunAt === undefined) {
    throw corruption("acquire", "rowInvalid");
  }
  if (row.state === "idle" && nextRunAt > now) {
    return Object.freeze({
      kind: "notDue",
      nextRunAt: new Date(nextRunAt),
    });
  }
  if (row.state === "claimed" && claimExpiresAt !== undefined && claimExpiresAt > now) {
    return Object.freeze({
      kind: "busy",
      claimExpiresAt: new Date(claimExpiresAt),
    });
  }
  if (row.runFence === MAX_PERSISTED_SIGNED_INT64_V1) {
    throw new PointMutationRedeliverySchedulerResourceExhaustedV1Error({
      operation: "acquire",
      dimension: "runFence",
      observed: row.runFence,
      maximum: MAX_PERSISTED_SIGNED_INT64_V1,
    });
  }
  const nextFence = row.runFence + 1n;
  const nextExpiry = deriveClaimExpiry(
    now,
    undefined,
    claimDurationMilliseconds,
  );
  const rows = await executeRows(tx, "acquire", sql`
    update fx_system_point_mutation_redelivery_scheduler
    set
      scheduler_state = 'claimed',
      run_fence = ${nextFence},
      checkpoint_sequence = 0,
      run_owner = ${owner}::uuid,
      claimed_at = ${row.databaseNow},
      claim_expires_at = ${nextExpiry},
      updated_at = ${row.databaseNow}
    where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    returning claim_expires_at
  `);
  if (rows.length !== 1) throw corruption("acquire", "singletonMissing");
  return Object.freeze({
    kind: "acquired",
    owner,
    runFence: nextFence,
    claimExpiresAt: nextExpiry,
    continuationCodecVersion: row.continuationCodecVersion,
    continuationBytes: row.continuationBytes === null
      ? null
      : new Uint8Array(row.continuationBytes),
    continuationSha256: row.continuationSha256 === null
      ? null
      : new Uint8Array(row.continuationSha256),
  });
}

async function renewTransaction(
  tx: AppRowTransaction,
  state: MutableRunStateV1,
  claimDurationMilliseconds: number,
): Promise<Readonly<{ readonly claimExpiresAt: Date }>> {
  const row = await lockSchedulerRow(tx, "renew", false);
  const current = requireCurrentRun(row, state, "renew");
  const nextExpiry = deriveClaimExpiry(
    current.databaseNowMilliseconds,
    current.claimExpiresAtMilliseconds,
    claimDurationMilliseconds,
  );
  const rows = await executeRows(tx, "renew", sql`
    update fx_system_point_mutation_redelivery_scheduler
    set claim_expires_at = ${nextExpiry}, updated_at = ${row.databaseNow}
    where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
      and scheduler_state = 'claimed'
      and run_owner = ${state.owner}::uuid
      and run_fence = ${state.runFence}
    returning claim_expires_at
  `);
  if (rows.length !== 1) throw stale("renew", "ownerChanged");
  return Object.freeze({ claimExpiresAt: nextExpiry });
}

async function checkpointTransaction(
  tx: AppRowTransaction,
  state: MutableRunStateV1,
  continuation: CapturedCheckpointV1 | null,
): Promise<Readonly<{ readonly checkpointSequence: bigint }>> {
  const row = await lockSchedulerRow(tx, "checkpoint", false);
  requireCurrentRun(row, state, "checkpoint");
  if (row.checkpointSequence === MAX_PERSISTED_SIGNED_INT64_V1) {
    throw new PointMutationRedeliverySchedulerResourceExhaustedV1Error({
      operation: "checkpoint",
      dimension: "checkpointSequence",
      observed: row.checkpointSequence,
      maximum: MAX_PERSISTED_SIGNED_INT64_V1,
    });
  }
  if (
    row.checkpointSequence !== state.checkpointSequence ||
    !nullableBytesEqual(row.continuationSha256, state.checkpointDigest)
  ) {
    throw stale("checkpoint", "checkpointChanged");
  }
  const nextSequence = state.checkpointSequence + 1n;
  const rows = await executeRows(tx, "checkpoint", sql`
    update fx_system_point_mutation_redelivery_scheduler
    set
      checkpoint_sequence = ${nextSequence},
      continuation_codec_version = ${
        continuation === null
          ? null
          : POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1
      },
      continuation_bytes = ${continuation?.canonicalBytes ?? null},
      continuation_sha256 = ${continuation?.sha256 ?? null},
      updated_at = ${row.databaseNow}
    where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
      and scheduler_state = 'claimed'
      and run_owner = ${state.owner}::uuid
      and run_fence = ${state.runFence}
      and checkpoint_sequence = ${state.checkpointSequence}
      and continuation_sha256 is not distinct from ${state.checkpointDigest}
    returning checkpoint_sequence
  `);
  if (rows.length !== 1) throw stale("checkpoint", "checkpointChanged");
  return Object.freeze({ checkpointSequence: nextSequence });
}

async function releaseTransaction(
  tx: AppRowTransaction,
  state: MutableRunStateV1,
): Promise<Readonly<{ readonly nextRunAt: Date }>> {
  const row = await lockSchedulerRow(tx, "release", false);
  requireCurrentRun(row, state, "release");
  if (
    row.checkpointSequence !== state.checkpointSequence ||
    !nullableBytesEqual(row.continuationSha256, state.checkpointDigest)
  ) {
    throw stale("release", "checkpointChanged");
  }
  const rows = await executeRows(tx, "release", sql`
    update fx_system_point_mutation_redelivery_scheduler
    set
      scheduler_state = 'idle',
      run_owner = null,
      claimed_at = null,
      claim_expires_at = null,
      next_run_at = ${row.databaseNow},
      updated_at = ${row.databaseNow}
    where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
      and scheduler_state = 'claimed'
      and run_owner = ${state.owner}::uuid
      and run_fence = ${state.runFence}
      and checkpoint_sequence = ${state.checkpointSequence}
      and continuation_sha256 is not distinct from ${state.checkpointDigest}
    returning next_run_at
  `);
  if (rows.length !== 1) throw stale("release", "ownerChanged");
  return Object.freeze({ nextRunAt: new Date(row.databaseNow) });
}

async function lockSchedulerRow(
  tx: AppRowTransaction,
  operation: SchedulerOperationV1,
  includeContinuationBytes: boolean,
): Promise<LockedSchedulerRowV1> {
  const rows = await executeRows(tx, operation, sql`
    with scheduler_context as materialized (
      select clock_timestamp() as database_now
    )
    select
      scheduler_state,
      run_fence::text as run_fence_text,
      checkpoint_sequence::text as checkpoint_sequence_text,
      run_owner,
      case when claimed_at is null then null
        else floor(extract(epoch from claimed_at) * 1000)::bigint::text
      end as claimed_at_milliseconds_text,
      case when claim_expires_at is null then null
        else floor(extract(epoch from claim_expires_at) * 1000)::bigint::text
      end as claim_expires_at_milliseconds_text,
      floor(extract(epoch from next_run_at) * 1000)::bigint::text
        as next_run_at_milliseconds_text,
      continuation_codec_version,
      case
        when continuation_bytes is null then null
        else octet_length(continuation_bytes)
      end as continuation_size,
      continuation_sha256,
      case when
        ${includeContinuationBytes}
        and (
          (
            scheduler_state = 'idle'
            and next_run_at <= scheduler_context.database_now
          )
          or
          (
            scheduler_state = 'claimed'
            and claim_expires_at <= scheduler_context.database_now
          )
        )
        and continuation_codec_version = ${POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1}
        and octet_length(continuation_bytes) between 1 and ${MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1}
        and octet_length(continuation_sha256) = 32
      then 1 else 0 end as continuation_bytes_selected,
      case
        when ${includeContinuationBytes}
          and (
            (
              scheduler_state = 'idle'
              and next_run_at <= scheduler_context.database_now
            )
            or
            (
              scheduler_state = 'claimed'
              and claim_expires_at <= scheduler_context.database_now
            )
          )
          and continuation_codec_version = ${POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1}
          and octet_length(continuation_bytes) between 1 and ${MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1}
          and octet_length(continuation_sha256) = 32
        then continuation_bytes
        else null
      end as continuation_bytes,
      floor(extract(epoch from scheduler_context.database_now) * 1000)::bigint::text
        as database_now_milliseconds_text
    from fx_system_point_mutation_redelivery_scheduler
    cross join scheduler_context
    where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    for update of fx_system_point_mutation_redelivery_scheduler
  `);
  if (rows.length === 0) throw corruption(operation, "singletonMissing");
  if (rows.length !== 1) throw corruption(operation, "singletonDuplicated");
  return captureLockedRow(rows[0], operation);
}

function captureLockedRow(
  raw: unknown,
  operation: SchedulerOperationV1,
): LockedSchedulerRowV1 {
  if (!isNonArrayRecord(raw)) {
    throw corruption(operation, "rowInvalid");
  }
  const value = raw;
  const state = value.scheduler_state;
  const runFence = parseNonnegativeSignedInt64(value.run_fence_text);
  const checkpointSequence = parseNonnegativeSignedInt64(
    value.checkpoint_sequence_text,
  );
  const runOwner = value.run_owner;
  const continuationCodecVersion = value.continuation_codec_version;
  const continuationSize = value.continuation_size;
  const continuationSha256 = value.continuation_sha256;
  const continuationBytesSelectedRaw = value.continuation_bytes_selected;
  const continuationBytesSelected = continuationBytesSelectedRaw === 1;
  const continuationBytes = value.continuation_bytes;
  const claimedAt = parseNullableEpochMilliseconds(
    value.claimed_at_milliseconds_text,
  );
  const claimExpiresAt = parseNullableEpochMilliseconds(
    value.claim_expires_at_milliseconds_text,
  );
  const nextRunAt = parseEpochMilliseconds(
    value.next_run_at_milliseconds_text,
  );
  const databaseNow = parseEpochMilliseconds(
    value.database_now_milliseconds_text,
  );
  if (
    (state !== "idle" && state !== "claimed") ||
    runFence === undefined || checkpointSequence === undefined ||
    (runOwner !== null &&
      (typeof runOwner !== "string" || !isLowercaseUuidText(runOwner))) ||
    (continuationBytesSelectedRaw !== 0 && continuationBytesSelectedRaw !== 1) ||
    nextRunAt === undefined || databaseNow === undefined ||
    claimedAt === undefined || claimExpiresAt === undefined
  ) {
    throw corruption(operation, "rowInvalid");
  }
  if (
    (state === "idle" &&
      (runOwner !== null || claimedAt !== null || claimExpiresAt !== null)) ||
    (state === "claimed" &&
      (runOwner === null || claimedAt === null || claimExpiresAt === null ||
        claimExpiresAt.getTime() <= claimedAt.getTime()))
  ) {
    throw corruption(operation, "rowInvalid");
  }
  const continuationAbsent = continuationCodecVersion === null &&
    continuationSize === null && continuationSha256 === null;
  const continuationPresent = continuationCodecVersion ===
      POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1 &&
    typeof continuationSize === "number" &&
    Number.isSafeInteger(continuationSize) && continuationSize >= 1 &&
    continuationSize <=
      MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1 &&
    isUint8Array(continuationSha256) && continuationSha256.byteLength === 32;
  if (!continuationAbsent && !continuationPresent) {
    throw corruption(operation, "continuationInvalid");
  }
  if (
    continuationBytesSelected && continuationPresent &&
    (!isUint8Array(continuationBytes) ||
      continuationBytes.byteLength !== continuationSize)
  ) {
    throw corruption(operation, "continuationInvalid");
  }
  if (
    (continuationBytesSelected && !continuationPresent) ||
    (!continuationBytesSelected && continuationBytes !== null)
  ) {
    throw corruption(operation, "continuationInvalid");
  }
  let capturedContinuationSha256: Uint8Array | null = null;
  let capturedContinuationBytes: Uint8Array | null = null;
  if (!continuationAbsent) {
    if (!isUint8Array(continuationSha256)) {
      throw corruption(operation, "continuationInvalid");
    }
    capturedContinuationSha256 = new Uint8Array(continuationSha256);
    if (continuationBytesSelected) {
      if (!isUint8Array(continuationBytes)) {
        throw corruption(operation, "continuationInvalid");
      }
      capturedContinuationBytes = new Uint8Array(continuationBytes);
    }
  }
  return Object.freeze({
    state,
    runFence,
    checkpointSequence,
    runOwner,
    claimedAt,
    claimExpiresAt,
    nextRunAt,
    continuationCodecVersion: continuationAbsent
      ? null
      : POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
    continuationSize: continuationAbsent ? null : continuationSize,
    continuationSha256: capturedContinuationSha256,
    continuationBytesSelected,
    continuationBytes: capturedContinuationBytes,
    databaseNow,
  });
}

function requireCurrentRun(
  row: LockedSchedulerRowV1,
  state: MutableRunStateV1,
  operation: "renew" | "checkpoint" | "release",
): Readonly<{
  readonly databaseNowMilliseconds: number;
  readonly claimExpiresAtMilliseconds: number;
}> {
  if (
    row.state !== "claimed" || row.runOwner !== state.owner ||
    row.runFence !== state.runFence
  ) {
    throw stale(operation, "ownerChanged");
  }
  const now = finiteDateMilliseconds(row.databaseNow);
  const expiresAt = row.claimExpiresAt === null
    ? undefined
    : finiteDateMilliseconds(row.claimExpiresAt);
  if (now === undefined || expiresAt === undefined) {
    throw corruption(operation, "rowInvalid");
  }
  if (expiresAt <= now) throw stale(operation, "claimExpired");
  return Object.freeze({
    databaseNowMilliseconds: now,
    claimExpiresAtMilliseconds: expiresAt,
  });
}

function deriveClaimExpiry(
  databaseNowMilliseconds: number,
  currentClaimExpiresAtMilliseconds: number | undefined,
  claimDurationMilliseconds: number,
): Date {
  if (
    databaseNowMilliseconds >
      Number.MAX_SAFE_INTEGER - claimDurationMilliseconds
  ) {
    throw new PointMutationRedeliverySchedulerConfigurationV1Error({
      reason: "invalidClaimDuration",
    });
  }
  const targetMilliseconds = Math.max(
    currentClaimExpiresAtMilliseconds ?? databaseNowMilliseconds,
    databaseNowMilliseconds + claimDurationMilliseconds,
  );
  const target = new Date(targetMilliseconds);
  if (finiteDateMilliseconds(target) === undefined) {
    throw new PointMutationRedeliverySchedulerConfigurationV1Error({
      reason: "invalidClaimDuration",
    });
  }
  return target;
}

async function executeRows(
  tx: AppRowTransaction,
  operation: SchedulerOperationV1,
  statement: ReturnType<typeof sql>,
): Promise<ReadonlyArray<unknown>> {
  try {
    const result = await tx.execute(statement);
    return rowsFromDriverExecuteResult(result, () => {
      throw corruption(operation, "driverResultInvalid");
    });
  } catch (cause) {
    if (
      cause instanceof PointMutationRedeliverySchedulerConfigurationV1Error ||
      cause instanceof PointMutationRedeliverySchedulerCorruptionV1Error ||
      cause instanceof PointMutationRedeliverySchedulerStaleV1Error ||
      cause instanceof PointMutationRedeliverySchedulerResourceExhaustedV1Error
    ) {
      throw cause;
    }
    throw new SchedulerStatementFailureV1(operation, cause);
  }
}

function awaitSettlement<Value, Failure>(
  transaction: Promise<Value>,
  mapFailure: (cause: unknown) => Failure,
): Effect.Effect<Value, Failure> {
  return Effect.uninterruptibleMask((restore) =>
    restore(Effect.tryPromise({
      try: () => transaction,
      catch: mapFailure,
    })).pipe(
      Effect.onInterrupt(() => Effect.promise(() =>
        transaction.then(() => undefined, () => undefined)
      )),
    )
  );
}

function awaitRunSettlement<
  Value,
  Failure extends PointMutationRedeliverySchedulerV1Error,
>(
  state: MutableRunStateV1,
  operation: "renew" | "checkpoint" | "release",
  commandDigest: Uint8Array | null,
  transaction: Promise<Value>,
  mapFailure: (cause: unknown) => Failure,
): Effect.Effect<Value, Failure> {
  let retainRunForConfirmedRollbackRetry = false;
  return awaitSettlement(transaction, mapFailure).pipe(
    Effect.tapError((error) => Effect.sync(() => {
      if (
        error instanceof PointMutationRedeliverySchedulerConfirmedRollbackV1Error
      ) {
        if (state.pendingRetry === null) {
          retainRunForConfirmedRollbackRetry = true;
          state.pendingRetry = Object.freeze({
            operation,
            commandDigest: commandDigest === null
              ? null
              : new Uint8Array(commandDigest),
          });
        } else {
          closeRun(state);
        }
      } else {
        closeRun(state);
      }
    })),
    Effect.onExit((exit) =>
      Exit.isFailure(exit) && !retainRunForConfirmedRollbackRetry
        ? Effect.sync(() => closeRun(state))
        : Effect.void
    ),
  );
}

function mapTransactionFailure(
  operation: SchedulerOperationV1,
  cause: unknown,
): PointMutationRedeliverySchedulerCommonTransactionV1Error |
  PointMutationRedeliverySchedulerConfigurationV1Error |
  PointMutationRedeliverySchedulerStaleV1Error |
  PointMutationRedeliverySchedulerResourceExhaustedV1Error {
  if (
    cause instanceof PointMutationRedeliverySchedulerConfigurationV1Error ||
    cause instanceof PointMutationRedeliverySchedulerCorruptionV1Error ||
    cause instanceof PointMutationRedeliverySchedulerStaleV1Error ||
    cause instanceof PointMutationRedeliverySchedulerResourceExhaustedV1Error
  ) {
    return cause;
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    const issue = cause.issue;
    switch (issue.kind) {
      case "callbackRolledBack": {
        const callbackCause = issue.callbackCause;
        if (callbackCause instanceof SchedulerStatementFailureV1) {
          return new PointMutationRedeliverySchedulerConfirmedRollbackV1Error({
            operation,
            cause: callbackCause.cause,
          });
        }
        if (
          callbackCause instanceof PointMutationRedeliverySchedulerConfigurationV1Error ||
          callbackCause instanceof PointMutationRedeliverySchedulerCorruptionV1Error ||
          callbackCause instanceof PointMutationRedeliverySchedulerStaleV1Error ||
          callbackCause instanceof PointMutationRedeliverySchedulerResourceExhaustedV1Error
        ) {
          return callbackCause;
        }
        throw callbackCause;
      }
      case "decisionUncertain":
        return new PointMutationRedeliverySchedulerDecisionUncertainV1Error({
          operation,
          cause,
        });
      case "callbackCleanupFailed":
        return new PointMutationRedeliverySchedulerSqlV1Error({
          operation,
          phase: "cleanup",
          cause,
        });
      case "infrastructureFailure":
        return new PointMutationRedeliverySchedulerSqlV1Error({
          operation,
          phase: "infrastructure",
          cause,
        });
    }
    const exhaustiveIssue: never = issue;
    throw exhaustiveIssue;
  }
  if (cause instanceof SchedulerStatementFailureV1) {
    return new PointMutationRedeliverySchedulerSqlV1Error({
      operation,
      phase: "statement",
      cause: cause.cause,
    });
  }
  throw cause;
}

function mapAcquireTransactionFailure(
  cause: unknown,
): PointMutationRedeliverySchedulerAcquireTransactionV1Error {
  const failure = mapTransactionFailure("acquire", cause);
  if (failure instanceof PointMutationRedeliverySchedulerStaleV1Error) {
    throw failure;
  }
  return failure;
}

function mapRenewTransactionFailure(
  cause: unknown,
): PointMutationRedeliverySchedulerRenewTransactionV1Error {
  const failure = mapTransactionFailure("renew", cause);
  if (
    failure instanceof PointMutationRedeliverySchedulerResourceExhaustedV1Error
  ) {
    throw failure;
  }
  return failure;
}

function mapCheckpointTransactionFailure(
  cause: unknown,
): PointMutationRedeliverySchedulerCheckpointTransactionV1Error {
  const failure = mapTransactionFailure("checkpoint", cause);
  if (failure instanceof PointMutationRedeliverySchedulerConfigurationV1Error) {
    throw failure;
  }
  return failure;
}

function mapReleaseTransactionFailure(
  cause: unknown,
): PointMutationRedeliverySchedulerReleaseTransactionV1Error {
  const failure = mapTransactionFailure("release", cause);
  if (
    failure instanceof PointMutationRedeliverySchedulerConfigurationV1Error ||
    failure instanceof PointMutationRedeliverySchedulerResourceExhaustedV1Error
  ) {
    throw failure;
  }
  return failure;
}

const withRunOperation = Effect.fn(
  "PointMutationRedeliverySchedulerCheckpoint.withRunOperation",
)(function* <Value, Failure, Requirements>(
  runs: WeakMap<object, MutableRunStateV1>,
  run: PointMutationRedeliverySchedulerRunV1,
  operation: "renew" | "checkpoint" | "release",
  commandDigest: Uint8Array | null,
  use: (
    state: MutableRunStateV1,
  ) => Effect.Effect<Value, Failure, Requirements>,
) {
  const preliminaryState = yield* lookupRunStateEffect(runs, run, operation);
  return yield* preliminaryState.operationGate.withPermit(
    Effect.gen(function* () {
      const currentState = yield* runStateEffect(
        runs,
        run,
        operation,
        commandDigest,
      );
      return yield* use(currentState);
    }),
  );
});

function lookupRunStateEffect(
  runs: WeakMap<object, MutableRunStateV1>,
  run: PointMutationRedeliverySchedulerRunV1,
  operation: "renew" | "checkpoint" | "release",
): Effect.Effect<
  MutableRunStateV1,
  PointMutationRedeliverySchedulerInputV1Error
> {
  const state = typeof run === "object" && run !== null
    ? runs.get(run)
    : undefined;
  if (state === undefined) {
    return Effect.fail(new PointMutationRedeliverySchedulerInputV1Error({
      operation,
      reason: "invalidRun",
    }));
  }
  if (state.closed) {
    return Effect.fail(new PointMutationRedeliverySchedulerInputV1Error({
      operation,
      reason: "runClosed",
    }));
  }
  return Effect.succeed(state);
}

function runStateEffect(
  runs: WeakMap<object, MutableRunStateV1>,
  run: PointMutationRedeliverySchedulerRunV1,
  operation: "renew" | "checkpoint" | "release",
  commandDigest: Uint8Array | null,
): Effect.Effect<MutableRunStateV1, PointMutationRedeliverySchedulerInputV1Error> {
  return lookupRunStateEffect(runs, run, operation).pipe(
    Effect.flatMap((state) => {
      if (state.pendingRetry !== null &&
        (state.pendingRetry.operation !== operation ||
          !nullableBytesEqual(
            state.pendingRetry.commandDigest,
            commandDigest,
          ))) {
        closeRun(state);
        return Effect.fail(new PointMutationRedeliverySchedulerInputV1Error({
          operation,
          reason: "retryCommandMismatch",
        }));
      }
      return Effect.succeed(state);
    }),
  );
}

interface CapturedCheckpointV1 {
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

function captureCheckpointEvidenceEffect(
  input: PointMutationRedeliverySchedulerContinuationEvidenceV1 | null,
): Effect.Effect<
  CapturedCheckpointV1 | null,
  | PointMutationRedeliverySchedulerInputV1Error
  | PointMutationRedeliverySchedulerCryptoV1Error
> {
  if (input === null) return Effect.succeed(null);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return Effect.fail(new PointMutationRedeliverySchedulerInputV1Error({
      operation: "checkpoint",
      reason: "invalidContinuation",
    }));
  }
  const codecVersion = Reflect.get(input, "codecVersion");
  const canonicalBytesInput = Reflect.get(input, "canonicalBytes");
  const sha256Input = Reflect.get(input, "sha256");
  if (
    codecVersion !==
      POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1 ||
    !isUint8Array(canonicalBytesInput) || canonicalBytesInput.byteLength < 1 ||
    canonicalBytesInput.byteLength >
      MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1 ||
    !isUint8Array(sha256Input) || sha256Input.byteLength !== 32
  ) {
    return Effect.fail(new PointMutationRedeliverySchedulerInputV1Error({
      operation: "checkpoint",
      reason: "invalidContinuation",
    }));
  }
  const canonicalBytes = new Uint8Array(canonicalBytesInput);
  const expectedSha256 = new Uint8Array(sha256Input);
  return sha256Effect(canonicalBytes, "checkpoint").pipe(
    Effect.flatMap((sha256) =>
      bytesEqual(sha256, expectedSha256)
        ? Effect.succeed(Object.freeze({ canonicalBytes, sha256 }))
        : Effect.fail(new PointMutationRedeliverySchedulerInputV1Error({
          operation: "checkpoint",
          reason: "invalidContinuation",
        }))
    ),
  );
}

function captureReloadedContinuationEffect(
  result: TransactionAcquiredV1,
): Effect.Effect<
  PointMutationRedeliverySchedulerContinuationEvidenceV1 | null,
  | PointMutationRedeliverySchedulerCorruptionV1Error
  | PointMutationRedeliverySchedulerCryptoV1Error
> {
  if (
    result.continuationCodecVersion === null &&
    result.continuationBytes === null && result.continuationSha256 === null
  ) {
    return Effect.succeed(null);
  }
  if (
    result.continuationCodecVersion !==
      POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1 ||
    result.continuationBytes === null || result.continuationSha256 === null
  ) {
    return Effect.fail(corruption("acquire", "continuationInvalid"));
  }
  const bytes = new Uint8Array(result.continuationBytes);
  const expected = new Uint8Array(result.continuationSha256);
  return sha256Effect(bytes, "acquire").pipe(
    Effect.flatMap((observed) =>
      bytesEqual(observed, expected)
        ? Effect.succeed(captureContinuationEvidence(bytes, expected))
        : Effect.fail(corruption("acquire", "continuationDigestMismatch"))
    ),
  );
}

function sha256Effect(
  bytes: Uint8Array,
  operation: "acquire" | "checkpoint",
): Effect.Effect<Uint8Array, PointMutationRedeliverySchedulerCryptoV1Error> {
  const input = new Uint8Array(bytes);
  return Effect.tryPromise({
    try: async () =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
    catch: (cause) =>
      new PointMutationRedeliverySchedulerCryptoV1Error({ operation, cause }),
  });
}

function captureContinuationEvidence(
  bytes: Uint8Array,
  sha256: Uint8Array,
): PointMutationRedeliverySchedulerContinuationEvidenceV1 {
  const ownedBytes = new Uint8Array(bytes);
  const ownedSha256 = new Uint8Array(sha256);
  return Object.freeze({
    codecVersion:
      POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
    get canonicalBytes() {
      return new Uint8Array(ownedBytes);
    },
    get sha256() {
      return new Uint8Array(ownedSha256);
    },
  });
}

function captureNonAcquired(
  result: Exclude<TransactionAcquireResultV1, TransactionAcquiredV1>,
): Exclude<PointMutationRedeliverySchedulerAcquireResultV1, { kind: "acquired" }> {
  return result.kind === "busy"
    ? Object.freeze({
      kind: "busy",
      claimExpiresAt: new Date(result.claimExpiresAt),
    })
    : Object.freeze({
      kind: "notDue",
      nextRunAt: new Date(result.nextRunAt),
    });
}

function nullableBytesEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  return left === null || right === null
    ? left === null && right === null
    : bytesEqual(left, right);
}

function parseEpochMilliseconds(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value)) {
    return undefined;
  }
  const milliseconds = Number(value);
  return Number.isSafeInteger(milliseconds)
    ? copyFiniteDate(new Date(milliseconds))
    : undefined;
}

function parseNullableEpochMilliseconds(
  value: unknown,
): Date | null | undefined {
  return value === null ? null : parseEpochMilliseconds(value);
}

function parseNonnegativeSignedInt64(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return undefined;
  }
  const parsed = BigInt(value);
  return parsed <= MAX_PERSISTED_SIGNED_INT64_V1 ? parsed : undefined;
}

function closeRun(state: MutableRunStateV1): void {
  state.closed = true;
  state.pendingRetry = null;
}

function stale(
  operation: "renew" | "checkpoint" | "release",
  reason: PointMutationRedeliverySchedulerStaleV1Error["reason"],
): PointMutationRedeliverySchedulerStaleV1Error {
  return new PointMutationRedeliverySchedulerStaleV1Error({
    operation,
    reason,
  });
}

function corruption(
  operation: SchedulerOperationV1,
  reason: PointMutationRedeliverySchedulerCorruptionV1Error["reason"],
  cause?: unknown,
): PointMutationRedeliverySchedulerCorruptionV1Error {
  return new PointMutationRedeliverySchedulerCorruptionV1Error({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
