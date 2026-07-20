import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { and, eq } from "drizzle-orm";
import { Data, Result } from "effect";

import type { ScopeId, ScopeUuidV1 } from
  "flarex-protocol/storage-authority";
import type {
  TransactionAttemptFence,
  TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";

import type { AppRowTransaction } from "./appRows";
import { fxSystemTransactionExecutionClaims } from "./schema";
import {
  decodeTransactionExecutionClaimFenceV1,
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimFenceV1,
  type TransactionExecutionClaimObservationV1,
  type TransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimPinV1,
} from "./transactionExecutionClaimModel";

export type TransactionExecutionClaimCorruptionReasonV1 =
  | "claimMissingOrDuplicate"
  | "claimEvidenceInvalid"
  | "claimMutationInvalid";

export class TransactionExecutionClaimCorruptionV1Error
  extends Data.TaggedError("TransactionExecutionClaimCorruptionV1Error")<{
    readonly scopeId: ScopeId;
    readonly reason: TransactionExecutionClaimCorruptionReasonV1;
    readonly cause?: unknown;
  }> {}

export class TransactionExecutionClaimStaleV1Error
  extends Data.TaggedError("TransactionExecutionClaimStaleV1Error")<{
    readonly scopeId: ScopeId;
    readonly reason:
      | "claimOwnerMismatch"
      | "claimFenceMismatch"
      | "claimExpired";
  }> {}

export interface TransactionExecutionClaimInsertV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly claimFence: TransactionExecutionClaimFenceV1;
  readonly claimOwner: TransactionExecutionClaimOwnerV1;
  readonly claimedAt: Date;
  readonly claimExpiresAt: Date;
}

export interface DeriveTransactionExecutionClaimInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly claimFence: bigint;
  readonly claimOwner: unknown;
  readonly databaseNow: Date;
  readonly durationMilliseconds: number;
  readonly leaseExpiresAt: Date;
  readonly authorizationGrantExpiresAt: Date;
  readonly hardExpiresAt: Date;
}

export function deriveTransactionExecutionClaimV1(
  input: DeriveTransactionExecutionClaimInputV1,
): Result.Result<
  TransactionExecutionClaimInsertV1,
  "authorityExpired" | "invalidClaimEvidence"
> {
  return Result.gen(function* () {
    const claimOwner = yield* decodeTransactionExecutionClaimOwnerV1(
      input.claimOwner,
    ).pipe(Result.mapError(() => "invalidClaimEvidence" as const));
    const claimFence = yield* decodeTransactionExecutionClaimFenceV1(
      input.claimFence,
    ).pipe(Result.mapError(() => "invalidClaimEvidence" as const));
    const now = finiteDateMilliseconds(input.databaseNow);
    const lease = finiteDateMilliseconds(input.leaseExpiresAt);
    const grant = finiteDateMilliseconds(input.authorizationGrantExpiresAt);
    const hard = finiteDateMilliseconds(input.hardExpiresAt);
    if (
      now === undefined ||
      lease === undefined ||
      grant === undefined ||
      hard === undefined ||
      !Number.isSafeInteger(input.durationMilliseconds) ||
      input.durationMilliseconds <= 0
    ) {
      return yield* Result.fail("invalidClaimEvidence" as const);
    }
    const expiresAt = Math.min(
      now + input.durationMilliseconds,
      lease,
      grant,
      hard,
    );
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      return yield* Result.fail("authorityExpired" as const);
    }
    return Object.freeze({
      scopeUuid: input.scopeUuid,
      sessionId: input.sessionId,
      attemptFence: input.attemptFence,
      claimFence,
      claimOwner,
      claimedAt: new Date(now),
      claimExpiresAt: new Date(expiresAt),
    });
  });
}

export async function lockExactTransactionExecutionClaimV1(
  tx: AppRowTransaction,
  input: Readonly<{
    readonly scopeId: ScopeId;
    readonly scopeUuid: ScopeUuidV1;
    readonly sessionId: TransactionSessionIdV1;
    readonly attemptFence: TransactionAttemptFence;
  }>,
): Promise<typeof fxSystemTransactionExecutionClaims.$inferSelect> {
  const rows = await tx.select().from(fxSystemTransactionExecutionClaims)
    .where(and(
      eq(fxSystemTransactionExecutionClaims.scopeUuid, input.scopeUuid),
      eq(fxSystemTransactionExecutionClaims.sessionId, input.sessionId),
      eq(
        fxSystemTransactionExecutionClaims.attemptFence,
        input.attemptFence,
      ),
    )).limit(2).for("update");
  return Result.getOrThrow(
    materializeLockedTransactionExecutionClaimResult(input.scopeId, rows),
  );
}

function materializeLockedTransactionExecutionClaimResult(
  scopeId: ScopeId,
  rows: ReadonlyArray<
    typeof fxSystemTransactionExecutionClaims.$inferSelect
  >,
): Result.Result<
  typeof fxSystemTransactionExecutionClaims.$inferSelect,
  TransactionExecutionClaimCorruptionV1Error
> {
  const row = rows[0];
  return rows.length === 1 && row !== undefined
    ? Result.succeed(row)
    : Result.fail(new TransactionExecutionClaimCorruptionV1Error({
      scopeId,
      reason: "claimMissingOrDuplicate",
    }));
}

export function requireLiveTransactionExecutionClaimV1Result(
  scopeId: ScopeId,
  row: typeof fxSystemTransactionExecutionClaims.$inferSelect,
  expected: TransactionExecutionClaimPinV1 | undefined,
  databaseNow: Date,
): Result.Result<
  TransactionExecutionClaimObservationV1,
  TransactionExecutionClaimCorruptionV1Error |
    TransactionExecutionClaimStaleV1Error
> {
  return Result.gen(function* () {
    const observation = yield* inspectTransactionExecutionClaimV1Result(
      scopeId,
      row,
    );
    const claimedAt = Date.parse(observation.claimedAt);
    const expiresAt = Date.parse(observation.claimExpiresAt);
    const now = finiteDateMilliseconds(databaseNow);
    if (now === undefined || claimedAt > now) {
      return yield* Result.fail(
        new TransactionExecutionClaimCorruptionV1Error({
          scopeId,
          reason: "claimEvidenceInvalid",
        }),
      );
    }
    if (
      expected !== undefined && observation.claimOwner !== expected.claimOwner
    ) {
      return yield* Result.fail(new TransactionExecutionClaimStaleV1Error({
        scopeId,
        reason: "claimOwnerMismatch",
      }));
    }
    if (
      expected !== undefined && observation.claimFence !== expected.claimFence
    ) {
      return yield* Result.fail(new TransactionExecutionClaimStaleV1Error({
        scopeId,
        reason: "claimFenceMismatch",
      }));
    }
    if (expiresAt <= now) {
      return yield* Result.fail(new TransactionExecutionClaimStaleV1Error({
        scopeId,
        reason: "claimExpired",
      }));
    }
    return observation;
  });
}

/**
 * Temporary throwing projection for transactionSessionActivation's Drizzle
 * Promise callbacks. Delete it when those callers consume the Result API.
 */
export function requireLiveTransactionExecutionClaimV1(
  scopeId: ScopeId,
  row: typeof fxSystemTransactionExecutionClaims.$inferSelect,
  expected: TransactionExecutionClaimPinV1 | undefined,
  databaseNow: Date,
): TransactionExecutionClaimObservationV1 {
  return Result.getOrThrow(requireLiveTransactionExecutionClaimV1Result(
    scopeId,
    row,
    expected,
    databaseNow,
  ));
}

export function inspectTransactionExecutionClaimV1Result(
  scopeId: ScopeId,
  row: typeof fxSystemTransactionExecutionClaims.$inferSelect,
): Result.Result<
  TransactionExecutionClaimObservationV1,
  TransactionExecutionClaimCorruptionV1Error
> {
  const claimOwner = row.claimOwner;
  const claimFence = row.claimFence;
  const claimedAtInput = row.claimedAt;
  const claimExpiresAtInput = row.claimExpiresAt;
  return Result.gen(function* () {
    const invalidEvidence = () =>
      new TransactionExecutionClaimCorruptionV1Error({
        scopeId,
        reason: "claimEvidenceInvalid",
      });
    const owner = yield* decodeTransactionExecutionClaimOwnerV1(
      claimOwner,
    ).pipe(Result.mapError(invalidEvidence));
    const fence = yield* decodeTransactionExecutionClaimFenceV1(
      claimFence,
    ).pipe(Result.mapError(invalidEvidence));
    const claimedAt = finiteDateMilliseconds(claimedAtInput);
    const expiresAt = finiteDateMilliseconds(claimExpiresAtInput);
    if (
      claimedAt === undefined ||
      expiresAt === undefined ||
      expiresAt <= claimedAt
    ) {
      return yield* Result.fail(invalidEvidence());
    }
    return Object.freeze({
      claimOwner: owner,
      claimFence: fence,
      claimedAt: new Date(claimedAt).toISOString(),
      claimExpiresAt: new Date(expiresAt).toISOString(),
    });
  });
}

/**
 * Temporary throwing projection for transactionSessionActivation's Drizzle
 * Promise callbacks. Delete it when those callers consume the Result API.
 */
export function inspectTransactionExecutionClaimV1(
  scopeId: ScopeId,
  row: typeof fxSystemTransactionExecutionClaims.$inferSelect,
): TransactionExecutionClaimObservationV1 {
  return Result.getOrThrow(
    inspectTransactionExecutionClaimV1Result(scopeId, row),
  );
}
