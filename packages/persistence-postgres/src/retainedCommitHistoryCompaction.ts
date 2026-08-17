import { and, asc, eq, lt } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import { MAX_COMMIT_WRITE_OPERATIONS_V1 } from
  "flarex-protocol/commit-protocol";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeEpochUuidV1,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import { observeDrizzleQuery } from "./drizzleQueryObservation";
import {
  isLocatedRetainedHistoryFloorTargetInternal,
  type LocatedRetainedHistoryFloorTarget,
} from "./retainedHistoryFloorObservation";
import {
  lockScopeClockForShareInTransactionEffect,
  type LockScopeClockForShareError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "./transactionSessionAttemptKernel";
import { runLocatedReadCommittedEffect } from "./locatedReadCommittedEffect";

const retainedCommitHistoryCompactionPortBrand: unique symbol = Symbol(
  "FlarexDB/retainedCommitHistoryCompactionPort",
);

const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeScopeEpochUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochUuidV1Schema),
);

export interface RetainedCommitHistoryCompactionQuery {
  readonly name:
    | "headerDirectory"
    | "changeDirectory"
    | "changeDeletion"
    | "headerDeletion";
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface RetainedCommitHistoryCompactionPort {
  readonly [retainedCommitHistoryCompactionPortBrand]: true;
}

interface RetainedCommitHistoryCompactionPortState {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly observeQuery?: (
    query: RetainedCommitHistoryCompactionQuery,
  ) => void;
}

const portStates = new WeakMap<
  RetainedCommitHistoryCompactionPort,
  RetainedCommitHistoryCompactionPortState
>();

/**
 * Private, production-inert O11-D commit/change-feed cleanup authority.
 * Production composition remains blocked on the later reconnect pin owner.
 */
export function createRetainedCommitHistoryCompactionPort(input: {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly observeQuery?: (
    query: RetainedCommitHistoryCompactionQuery,
  ) => void;
}): RetainedCommitHistoryCompactionPort {
  const port = Object.freeze({
    [retainedCommitHistoryCompactionPortBrand]: true as const,
  });
  portStates.set(port, Object.freeze({
    authority: captureTrustedScopeAuthorityResolutionPorts(input.authority),
    ...(input.observeQuery === undefined
      ? {}
      : { observeQuery: input.observeQuery }),
  }));
  return port;
}

export type RetainedCommitHistoryCompactionResult =
  | Readonly<{
      readonly status: "compacted";
      readonly disposition: "exhausted";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly retainedFloor: CommitSeq;
    }>
  | Readonly<{
      readonly status: "compacted";
      readonly disposition: "deleted";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly retainedFloor: CommitSeq;
      readonly deletedCommitSeq: CommitSeq;
      readonly deletedChangeCount: number;
    }>;

export class RetainedCommitHistoryCompactionError extends Data.TaggedError(
  "RetainedCommitHistoryCompactionError",
)<{
  readonly reason:
    | "invalidPort"
    | "invalidTarget"
    | "staleAuthority"
    | "storedEvidenceInvalid";
  readonly deploymentId: string;
  readonly scopeId?: ScopeId;
  readonly cause?: unknown;
}> {}

export class RetainedCommitHistoryCompactionPersistenceError extends
  Data.TaggedError("RetainedCommitHistoryCompactionPersistenceError")<{
    readonly operation:
      | "headerDirectory"
      | "changeDirectory"
      | "changeDeletion"
      | "headerDeletion";
    readonly cause: unknown;
  }> {}

export type CompactRetainedCommitHistoryPageError =
  | RetainedCommitHistoryCompactionError
  | RetainedCommitHistoryCompactionPersistenceError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1
  | TrustedScopeAuthorityError;

export const compactRetainedCommitHistoryPageEffect = Effect.fn(
  "RetainedCommitHistory.compactPage",
)(function* (
  port: RetainedCommitHistoryCompactionPort,
  deploymentId: string,
): Effect.fn.Return<
  RetainedCommitHistoryCompactionResult,
  CompactRetainedCommitHistoryPageError
> {
  const state = portStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(new RetainedCommitHistoryCompactionError({
      reason: "invalidPort",
      deploymentId,
    }));
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    deploymentId,
    state.authority,
  );
  if (!isLocatedRetainedHistoryFloorTargetInternal(located.target)) {
    return yield* Effect.fail(new RetainedCommitHistoryCompactionError({
      reason: "invalidTarget",
      deploymentId,
      scopeId: located.authority.scopeId,
    }));
  }
  return yield* runLocatedReadCommittedEffect(
    located.target,
    {
      rollbackMessage: "rollback:retained-commit-history-compaction",
      cleanupDefect: failure => failure,
    },
    tx => compactInTransaction(tx, located.authority, state),
  );
});

const compactInTransaction = Effect.fn(
  "RetainedCommitHistory.compactInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  state: RetainedCommitHistoryCompactionPortState,
): Effect.fn.Return<
  RetainedCommitHistoryCompactionResult,
  | RetainedCommitHistoryCompactionError
  | RetainedCommitHistoryCompactionPersistenceError
  | LockScopeClockForShareError
> {
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* requireExactAuthority(authority, clock);
  const scopeUuid = yield* projectScopeIdUuidV1Result(clock.scopeId).pipe(
    Result.mapError(cause => compactionError(
      authority,
      "storedEvidenceInvalid",
      cause,
    )),
    Effect.fromResult,
  );

  const headerQuery = tx.select({
    epochUuid: fxSystemCommits.epochUuid,
    commitSeq: fxSystemCommits.commitSeq,
    changeCount: fxSystemCommits.changeCount,
  }).from(fxSystemCommits).where(and(
    eq(fxSystemCommits.scopeUuid, scopeUuid.scopeUuid),
    lt(fxSystemCommits.commitSeq, clock.oldestAvailableCommitSeq),
  )).orderBy(asc(fxSystemCommits.commitSeq)).limit(1).for("update");
  observeDrizzleQuery("headerDirectory", headerQuery, state.observeQuery);
  const headerRows = yield* queryEffect("headerDirectory", headerQuery);
  if (headerRows.length === 0) {
    return Object.freeze({
      status: "compacted" as const,
      disposition: "exhausted" as const,
      deploymentId: authority.deploymentId,
      scopeId: authority.scopeId,
      retainedFloor: clock.oldestAvailableCommitSeq,
    });
  }
  if (headerRows.length !== 1) {
    return yield* Effect.fail(compactionError(
      authority,
      "storedEvidenceInvalid",
    ));
  }
  const header = yield* Effect.fromResult(decodeHeaderResult(
    authority,
    clock.oldestAvailableCommitSeq,
    headerRows[0],
  ));

  const changeQuery = tx.select({
    changeOrdinal: fxSystemCommitAppRowChanges.changeOrdinal,
  }).from(fxSystemCommitAppRowChanges).where(and(
    eq(fxSystemCommitAppRowChanges.scopeUuid, scopeUuid.scopeUuid),
    eq(fxSystemCommitAppRowChanges.commitSeq, header.commitSeq),
  )).orderBy(asc(fxSystemCommitAppRowChanges.changeOrdinal));
  observeDrizzleQuery("changeDirectory", changeQuery, state.observeQuery);
  const changeRows = yield* queryEffect("changeDirectory", changeQuery);
  yield* Effect.fromResult(requireExactChangeDirectoryResult(
    authority,
    header.changeCount,
    changeRows,
  ));

  const changeDeletion = tx.delete(fxSystemCommitAppRowChanges).where(and(
    eq(fxSystemCommitAppRowChanges.scopeUuid, scopeUuid.scopeUuid),
    eq(fxSystemCommitAppRowChanges.commitSeq, header.commitSeq),
  )).returning({
    changeOrdinal: fxSystemCommitAppRowChanges.changeOrdinal,
  });
  observeDrizzleQuery("changeDeletion", changeDeletion, state.observeQuery);
  const deletedChanges = yield* queryEffect("changeDeletion", changeDeletion);
  yield* Effect.fromResult(requireExactChangeDirectoryResult(
    authority,
    header.changeCount,
    deletedChanges,
  ));

  const headerDeletion = tx.delete(fxSystemCommits).where(and(
    eq(fxSystemCommits.scopeUuid, scopeUuid.scopeUuid),
    eq(fxSystemCommits.epochUuid, header.epochUuid),
    eq(fxSystemCommits.commitSeq, header.commitSeq),
    eq(fxSystemCommits.changeCount, header.changeCount),
  )).returning({ commitSeq: fxSystemCommits.commitSeq });
  observeDrizzleQuery("headerDeletion", headerDeletion, state.observeQuery);
  const deletedHeaders = yield* queryEffect("headerDeletion", headerDeletion);
  if (
    deletedHeaders.length !== 1 ||
    deletedHeaders[0]?.commitSeq !== header.commitSeq
  ) {
    return yield* Effect.fail(compactionError(
      authority,
      "storedEvidenceInvalid",
    ));
  }

  return Object.freeze({
    status: "compacted" as const,
    disposition: "deleted" as const,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    retainedFloor: clock.oldestAvailableCommitSeq,
    deletedCommitSeq: header.commitSeq,
    deletedChangeCount: header.changeCount,
  });
});

interface DecodedHeader {
  readonly epochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly changeCount: number;
}

function decodeHeaderResult(
  authority: TrustedScopeAuthority,
  retainedFloor: CommitSeq,
  row: Readonly<{
    readonly epochUuid: unknown;
    readonly commitSeq: unknown;
    readonly changeCount: unknown;
  }>,
): Result.Result<DecodedHeader, RetainedCommitHistoryCompactionError> {
  return Result.gen(function* () {
    const epochUuid = yield* decodeScopeEpochUuidResult(row.epochUuid).pipe(
      Result.mapError(cause => compactionError(
        authority,
        "storedEvidenceInvalid",
        cause,
      )),
    );
    const commitSeq = yield* decodeCommitSeqResult(row.commitSeq).pipe(
      Result.mapError(cause => compactionError(
        authority,
        "storedEvidenceInvalid",
        cause,
      )),
      Result.filterOrFail(
        value => value >= 1n && value < retainedFloor,
        () => compactionError(authority, "storedEvidenceInvalid"),
      ),
    );
    if (
      typeof row.changeCount !== "number" ||
      !Number.isSafeInteger(row.changeCount) ||
      row.changeCount < 0 ||
      row.changeCount > MAX_COMMIT_WRITE_OPERATIONS_V1
    ) {
      return yield* Result.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    return Object.freeze({
      epochUuid,
      commitSeq,
      changeCount: row.changeCount,
    });
  });
}

function requireExactChangeDirectoryResult(
  authority: TrustedScopeAuthority,
  expectedCount: number,
  rows: ReadonlyArray<Readonly<{ readonly changeOrdinal: unknown }>>,
): Result.Result<void, RetainedCommitHistoryCompactionError> {
  if (rows.length !== expectedCount) {
    return Result.fail(compactionError(authority, "storedEvidenceInvalid"));
  }
  const seen = new Uint8Array(expectedCount);
  for (const row of rows) {
    if (
      typeof row.changeOrdinal !== "number" ||
      !Number.isSafeInteger(row.changeOrdinal) ||
      row.changeOrdinal < 0 ||
      row.changeOrdinal >= expectedCount ||
      seen[row.changeOrdinal] !== 0
    ) {
      return Result.fail(compactionError(authority, "storedEvidenceInvalid"));
    }
    seen[row.changeOrdinal] = 1;
  }
  return Result.succeed(undefined);
}

function requireExactAuthority(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): Effect.Effect<void, RetainedCommitHistoryCompactionError> {
  return clock.storageGeneration === "flarexdb_v1" &&
      clock.storageGeneration === authority.storageGeneration &&
      clock.storageGenerationFence === authority.storageGenerationFence &&
      clock.epoch === authority.epoch
    ? Effect.void
    : Effect.fail(compactionError(authority, "staleAuthority"));
}

function queryEffect<Value>(
  operation: RetainedCommitHistoryCompactionPersistenceError["operation"],
  query: PromiseLike<Value>,
): Effect.Effect<Value, RetainedCommitHistoryCompactionPersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: cause => new RetainedCommitHistoryCompactionPersistenceError({
      operation,
      cause,
    }),
  }));
}

function compactionError(
  authority: TrustedScopeAuthority,
  reason: RetainedCommitHistoryCompactionError["reason"],
  cause?: unknown,
): RetainedCommitHistoryCompactionError {
  return new RetainedCommitHistoryCompactionError({
    reason,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    cause,
  });
}
