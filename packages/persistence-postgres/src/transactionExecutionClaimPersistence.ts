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
  TransactionExecutionClaimFenceV1Schema,
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
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new TransactionExecutionClaimCorruptionV1Error({
      scopeId: input.scopeId,
      reason: "claimMissingOrDuplicate",
    });
  }
  return rows[0];
}

export function requireLiveTransactionExecutionClaimV1(
  scopeId: ScopeId,
  row: typeof fxSystemTransactionExecutionClaims.$inferSelect,
  expected: TransactionExecutionClaimPinV1 | undefined,
  databaseNow: Date,
): TransactionExecutionClaimObservationV1 {
  const observation = inspectTransactionExecutionClaimV1(
    scopeId,
    row,
  );
  const claimedAt = Date.parse(observation.claimedAt);
  const expiresAt = Date.parse(observation.claimExpiresAt);
  const now = finiteDateMilliseconds(databaseNow);
  if (now === undefined || claimedAt > now) {
    throw new TransactionExecutionClaimCorruptionV1Error({
      scopeId,
      reason: "claimEvidenceInvalid",
    });
  }
  if (expected !== undefined && observation.claimOwner !== expected.claimOwner) {
    throw new TransactionExecutionClaimStaleV1Error({
      scopeId,
      reason: "claimOwnerMismatch",
    });
  }
  if (expected !== undefined && observation.claimFence !== expected.claimFence) {
    throw new TransactionExecutionClaimStaleV1Error({
      scopeId,
      reason: "claimFenceMismatch",
    });
  }
  if (expiresAt <= now) {
    throw new TransactionExecutionClaimStaleV1Error({
      scopeId,
      reason: "claimExpired",
    });
  }
  return observation;
}

export function inspectTransactionExecutionClaimV1(
  scopeId: ScopeId,
  row: typeof fxSystemTransactionExecutionClaims.$inferSelect,
): TransactionExecutionClaimObservationV1 {
  const owner = decodeTransactionExecutionClaimOwnerV1(row.claimOwner);
  const fence = decodeTransactionExecutionClaimFenceV1(row.claimFence);
  const claimedAt = finiteDateMilliseconds(row.claimedAt);
  const expiresAt = finiteDateMilliseconds(row.claimExpiresAt);
  if (
    Result.isFailure(owner) ||
    Result.isFailure(fence) ||
    claimedAt === undefined ||
    expiresAt === undefined ||
    expiresAt <= claimedAt
  ) {
    throw new TransactionExecutionClaimCorruptionV1Error({
      scopeId,
      reason: "claimEvidenceInvalid",
    });
  }
  return Object.freeze({
    claimOwner: owner.success,
    claimFence: TransactionExecutionClaimFenceV1Schema.make(fence.success),
    claimedAt: new Date(claimedAt).toISOString(),
    claimExpiresAt: new Date(expiresAt).toISOString(),
  });
}
