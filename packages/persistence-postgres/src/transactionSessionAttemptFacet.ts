import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Result, Schema } from "effect";

import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
} from "flarex-protocol/commit-protocol";
import type {
  CommitSeq,
  ScopeEpochUuidV1,
  ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import type {
  TransactionAttemptFence,
  TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";

import type {
  fxSystemSnapshotLeases,
  fxSystemTransactionJournals,
} from "./schema";

type SnapshotLeaseInsertV1 = typeof fxSystemSnapshotLeases.$inferInsert;
type JournalRootInsertV1 = typeof fxSystemTransactionJournals.$inferInsert;
type JournalRootRowV1 = typeof fxSystemTransactionJournals.$inferSelect;

const decodeAppCreationTimeV1Result = Schema.decodeUnknownResult(
  Schema.toType(AppCreationTimeV1Schema),
);

export type FreshTransactionAttemptFacetIssueV1 =
  | "databaseTimeInvalid"
  | "leaseDurationInvalid"
  | "authorityExpired";

export interface FreshTransactionAttemptFacetInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly snapshotEpochUuid: ScopeEpochUuidV1;
  readonly snapshotCommitSeq: CommitSeq;
  readonly databaseNowMilliseconds: number;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly leaseDurationMilliseconds: number;
}

export interface FreshTransactionAttemptFacetV1 {
  readonly sessionUpdatedAt: Date;
  readonly leaseExpiresAt: Date;
  readonly lease: Readonly<SnapshotLeaseInsertV1>;
  readonly journalRoot: Readonly<JournalRootInsertV1>;
}

/**
 * Package-internal O08-A construction policy matching initial activation's
 * database-time seed, bounded lease expiry, and pristine-root shape. The
 * replacement transaction retains failure mapping and mutation-order ownership.
 */
export function buildFreshTransactionAttemptFacetV1(
  input: FreshTransactionAttemptFacetInputV1,
): Result.Result<
  FreshTransactionAttemptFacetV1,
  FreshTransactionAttemptFacetIssueV1
> {
  const now = input.databaseNowMilliseconds;
  if (
    !isPositiveSafeInteger(now) ||
    finiteDateMilliseconds(new Date(now)) === undefined
  ) {
    return Result.fail("databaseTimeInvalid");
  }
  if (!isPositiveSafeInteger(input.leaseDurationMilliseconds)) {
    return Result.fail("leaseDurationInvalid");
  }
  const authorityExpiry = Math.min(
    input.authorizationGrantExpiresAtMilliseconds,
    input.hardExpiresAtMilliseconds,
  );
  if (
    !isPositiveSafeInteger(authorityExpiry) ||
    authorityExpiry <= now
  ) {
    return Result.fail("authorityExpired");
  }
  const leaseExpiresAtMilliseconds = Math.min(
    now + input.leaseDurationMilliseconds,
    authorityExpiry,
  );
  if (
    !Number.isSafeInteger(leaseExpiresAtMilliseconds) ||
    leaseExpiresAtMilliseconds <= now
  ) {
    return Result.fail("authorityExpired");
  }

  return decodeAppCreationTimeV1Result(now).pipe(
    Result.mapError(() => "databaseTimeInvalid" as const),
    Result.flatMap((creationTimeSeed) => {
      const sessionUpdatedAt = new Date(now);
      const leaseExpiresAt = new Date(leaseExpiresAtMilliseconds);
      if (
        finiteDateMilliseconds(sessionUpdatedAt) !== now ||
        finiteDateMilliseconds(leaseExpiresAt) !== leaseExpiresAtMilliseconds
      ) {
        return Result.fail("databaseTimeInvalid" as const);
      }

      return Result.succeed(Object.freeze({
        sessionUpdatedAt,
        leaseExpiresAt,
        lease: Object.freeze({
          scopeUuid: input.scopeUuid,
          sessionId: input.sessionId,
          attemptFence: input.attemptFence,
          snapshotEpochUuid: input.snapshotEpochUuid,
          snapshotCommitSeq: input.snapshotCommitSeq,
          leaseExpiresAt: new Date(leaseExpiresAtMilliseconds),
        }),
        journalRoot: Object.freeze({
          scopeUuid: input.scopeUuid,
          sessionId: input.sessionId,
          attemptFence: input.attemptFence,
          state: "open" as const,
          lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(0n),
          creationTimeSeed,
          nextCreationTime: creationTimeSeed,
          readDocuments: 0,
          readSemanticBytes: 0,
          pointDependencyCount: 0,
          writeOperations: 0,
          writeSemanticBytes: 0,
          materialWriteEventEvidenceBytes:
            CommitMaterialWriteEventEvidenceBytesV1Schema.make(0),
          createdAt: new Date(now),
          updatedAt: new Date(now),
        }),
      }));
    }),
  );
}

/**
 * Shared exact-root predicate for O08-A convergence and O03's temporal fresh-
 * attempt observation. Child absence remains transaction-owned because it
 * requires a database snapshot; this helper owns only the row invariant.
 */
export function isPristineFreshTransactionAttemptJournalRootV1(
  root: Readonly<JournalRootRowV1>,
  expected: Readonly<JournalRootInsertV1>,
): boolean {
  return root.scopeUuid === expected.scopeUuid &&
    root.sessionId === expected.sessionId &&
    root.attemptFence === expected.attemptFence &&
    root.state === "open" &&
    root.lastSyscallSequence === 0n &&
    root.creationTimeSeed === expected.creationTimeSeed &&
    root.nextCreationTime === expected.nextCreationTime &&
    root.readDocuments === 0 &&
    root.readSemanticBytes === 0 &&
    root.pointDependencyCount === 0 &&
    root.writeOperations === 0 &&
    root.writeSemanticBytes === 0 &&
    root.materialWriteEventEvidenceBytes === 0 &&
    root.failureDimension === null &&
    root.sealedFinalSyscallSequence === null &&
    root.sealedJournalBytes === null &&
    root.sealedJournalSha256 === null &&
    root.sealedResultValueCodecVersion === null &&
    root.sealedResultSemanticBytes === null &&
    root.sealedResultBytes === null &&
    root.sealedResultSha256 === null &&
    root.sealedAt === null &&
    finiteDateMilliseconds(root.createdAt) ===
      finiteDateMilliseconds(expected.createdAt) &&
    finiteDateMilliseconds(root.updatedAt) ===
      finiteDateMilliseconds(expected.updatedAt);
}
