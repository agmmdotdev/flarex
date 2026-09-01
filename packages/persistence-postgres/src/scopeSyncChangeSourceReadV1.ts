import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Data, Effect, Result } from "effect";
import type { Client } from "pg";
import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "flarex-protocol/commit-protocol";
import {
  SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncActiveHeadObservationV1,
  type ScopeSyncActiveHeadObservationV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import {
  ApplicationActiveHeadStateError,
  readCoherentApplicationActiveHeadInTransactionEffect,
} from "./applicationActiveHeadRead";
import {
  MAX_COMMIT_FEED_PAGE_COMMITS_V1,
  CommitFeedScopeNotFoundErrorV1,
  readCommitFeedPageInTransactionV1Effect,
  type CommitFeedCommitV1,
  type CommitFeedListAfterErrorV1,
} from "./commitFeed";
import type { AppRowTransaction } from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import { runEffectTransaction } from "./effectTransaction";
import { flarexSchema, fxSystemScopeClocks } from "./schema";

export interface ScopeSyncChangeSourceReadInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly requestedSourceEpoch: ScopeEpochUuidV1;
  readonly requestedAfterCommitSeqExclusive: CommitSeq;
  readonly maximumCommittedBatches: number;
  readonly maximumElapsedMilliseconds: number;
}

interface ScopeSyncChangeSourceFrontiersV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly currentSourceEpoch: ScopeEpochUuidV1;
  readonly observedLatestCommitSeq: CommitSeq;
  readonly replayableAfterCommitSeqExclusive: CommitSeq;
  readonly retainedFromCommitSeqInclusive: CommitSeq | null;
}

export type ScopeSyncChangeSourceReadV1 =
  | Readonly<ScopeSyncChangeSourceFrontiersV1 & {
      readonly kind: "page";
      readonly requestedSourceEpoch: ScopeEpochUuidV1;
      readonly requestedAfterCommitSeqExclusive: CommitSeq;
      readonly commits: ReadonlyArray<CommitFeedCommitV1>;
      readonly readThroughCommitSeq: CommitSeq;
      readonly hasMore: boolean;
      readonly authorityObservation: ScopeSyncActiveHeadObservationV1 | null;
    }>
  | Readonly<ScopeSyncChangeSourceFrontiersV1 & {
      readonly kind: "historyUnavailable";
    }>
  | Readonly<ScopeSyncChangeSourceFrontiersV1 & {
      readonly kind: "epochReplaced";
    }>
  | Readonly<ScopeSyncChangeSourceFrontiersV1 & {
      readonly kind: "cursorAhead";
      readonly requestedAfterCommitSeqExclusive: CommitSeq;
    }>;

export class ScopeSyncChangeSourceAuthorityV1Error extends Data.TaggedError(
  "ScopeSyncChangeSourceAuthorityV1Error",
)<{
  readonly reason:
    | "scopeClockDuplicate"
    | "scopeClockInvalid"
    | "activeHeadMissing";
  readonly scopeUuid: ScopeUuidV1;
  readonly cause?: unknown;
}> {}

export class ScopeSyncChangeSourceSqlV1Error extends Data.TaggedError(
  "ScopeSyncChangeSourceSqlV1Error",
)<{
  readonly operation: "configureTimeout" | "readAfter";
  readonly cause: unknown;
}> {}

export class ScopeSyncChangeSourceInputV1Error extends Data.TaggedError(
  "ScopeSyncChangeSourceInputV1Error",
)<{
  readonly reason: "maximumCommittedBatchesInvalid" |
    "maximumElapsedMillisecondsInvalid";
}> {}

export class ScopeSyncChangeSourceTimeoutV1Error extends Data.TaggedError(
  "ScopeSyncChangeSourceTimeoutV1Error",
)<{ readonly operation: "readAfter" }> {}

export type ScopeSyncChangeSourceReadV1Error =
  | CommitFeedListAfterErrorV1
  | ApplicationActiveHeadStateError
  | ScopeSyncChangeSourceInputV1Error
  | ScopeSyncChangeSourceTimeoutV1Error
  | ScopeSyncChangeSourceAuthorityV1Error
  | ScopeSyncChangeSourceSqlV1Error;

export interface ScopeSyncChangeSourceReaderV1 {
  readonly readAfter: (
    input: ScopeSyncChangeSourceReadInputV1,
  ) => Effect.Effect<
    ScopeSyncChangeSourceReadV1,
    ScopeSyncChangeSourceReadV1Error
  >;
}

type ScopeClockAuthorityRow = Pick<
  typeof fxSystemScopeClocks.$inferSelect,
  | "scopeId"
  | "scopeUuid"
  | "storageGeneration"
  | "storageGenerationFence"
  | "lastCommitSeq"
  | "oldestAvailableCommitSeq"
  | "epoch"
  | "epochUuid"
>;

interface CapturedScopeClockAuthorityV1 {
  readonly scopeId: ScopeClockAuthorityRow["scopeId"];
  readonly scopeUuid: ScopeUuidV1;
  readonly currentSourceEpoch: ScopeEpochUuidV1;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence:
    ScopeClockAuthorityRow["storageGenerationFence"];
  readonly lastCommitSeq: CommitSeq;
  readonly oldestAvailableCommitSeq: CommitSeq;
}

export function createScopeSyncChangeSourceReaderV1(
  db: FlarexMetadataDatabase,
): ScopeSyncChangeSourceReaderV1 {
  const readAfter = Effect.fn("ScopeSyncChangeSource.readAfter")(function* (
    input: ScopeSyncChangeSourceReadInputV1,
  ): Effect.fn.Return<
    ScopeSyncChangeSourceReadV1,
    ScopeSyncChangeSourceReadV1Error
  > {
    yield* Effect.fromResult(validateSourceReadInput(input));
    return yield* runEffectTransaction<
      ScopeSyncChangeSourceReadV1,
      ScopeSyncChangeSourceReadV1Error,
      ScopeSyncChangeSourceSqlV1Error,
      AppRowTransaction
    >(
      callback => db.transaction(callback),
      "Scope sync source read rolled back.",
      tx => Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => tx.setTransaction({
            isolationLevel: "repeatable read",
            accessMode: "read only",
          }),
          catch: cause => new ScopeSyncChangeSourceSqlV1Error({
            operation: "readAfter",
            cause,
          }),
        });
        yield* configureTransactionTimeout(
          tx,
          input.maximumElapsedMilliseconds,
        );
        const clockRows = yield* Effect.tryPromise({
          try: () => tx
            .select({
              scopeId: fxSystemScopeClocks.scopeId,
              scopeUuid: fxSystemScopeClocks.scopeUuid,
              storageGeneration: fxSystemScopeClocks.storageGeneration,
              storageGenerationFence:
                fxSystemScopeClocks.storageGenerationFence,
              lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
              oldestAvailableCommitSeq:
                fxSystemScopeClocks.oldestAvailableCommitSeq,
              epoch: fxSystemScopeClocks.epoch,
              epochUuid: fxSystemScopeClocks.epochUuid,
            })
            .from(fxSystemScopeClocks)
            .where(eq(fxSystemScopeClocks.scopeUuid, input.scopeUuid))
            .limit(2),
          catch: cause => new ScopeSyncChangeSourceSqlV1Error({
            operation: "readAfter",
            cause,
          }),
        });
        if (clockRows.length === 0) {
          return yield* new CommitFeedScopeNotFoundErrorV1({
            scopeUuid: input.scopeUuid,
          });
        }
        if (clockRows.length !== 1) {
          return yield* authorityFailure(
            input.scopeUuid,
            "scopeClockDuplicate",
          );
        }
        const clock = yield* Effect.fromResult(captureScopeClockAuthority(
          input.scopeUuid,
          clockRows[0],
        ));
        const frontiers = captureFrontiers(clock);
        if (input.requestedSourceEpoch !== clock.currentSourceEpoch) {
          return Object.freeze({ kind: "epochReplaced", ...frontiers });
        }

        const feed = yield* readCommitFeedPageInTransactionV1Effect(tx, {
          scopeUuid: input.scopeUuid,
          exclusiveCommitSeq: input.requestedAfterCommitSeqExclusive,
          maximumCommits: input.maximumCommittedBatches,
        }).pipe(
          Effect.catchTag(
            "CommitFeedCursorResetRequiredErrorV1",
            () => Effect.succeed(null),
          ),
          Effect.catchTag("CommitFeedInputErrorV1", error =>
            error.reason === "cursorAheadOfClock"
              ? Effect.succeed("cursorAhead" as const)
              : Effect.fail(error)),
        );
        if (feed === null) {
          return Object.freeze({ kind: "historyUnavailable", ...frontiers });
        }
        if (feed === "cursorAhead") {
          return Object.freeze({
            kind: "cursorAhead",
            ...frontiers,
            requestedAfterCommitSeqExclusive:
              input.requestedAfterCommitSeqExclusive,
          });
        }

        const hasMore = feed.continuation.kind === "more";
        const readThroughCommitSeq = feed.commits.at(-1)?.commitSeq ??
          input.requestedAfterCommitSeqExclusive;
        const authorityObservation = hasMore
          ? null
          : yield* observeAuthorityAtFrontier(tx, clock);
        return Object.freeze({
          kind: "page",
          ...frontiers,
          requestedSourceEpoch: input.requestedSourceEpoch,
          requestedAfterCommitSeqExclusive:
            input.requestedAfterCommitSeqExclusive,
          commits: feed.commits,
          readThroughCommitSeq,
          hasMore,
          authorityObservation,
        });
      }),
      cause => cause instanceof ScopeSyncChangeSourceSqlV1Error
        ? cause
        : new ScopeSyncChangeSourceSqlV1Error({
            operation: "readAfter",
            cause,
          }),
    ).pipe(Effect.mapError(error => isDatabaseTimeoutFailure(error)
      ? new ScopeSyncChangeSourceTimeoutV1Error({ operation: "readAfter" })
      : error));
  });

  return Object.freeze({ readAfter });
}

const configureTransactionTimeout = Effect.fn(
  "ScopeSyncChangeSource.configureTransactionTimeout",
)(function* (
  tx: AppRowTransaction,
  maximumElapsedMilliseconds: number,
): Effect.fn.Return<void, ScopeSyncChangeSourceSqlV1Error> {
  const timeout = `${maximumElapsedMilliseconds}ms`;
  yield* Effect.tryPromise({
    try: () => tx.execute(sql`
      select set_config('statement_timeout', ${timeout}, true),
             set_config('transaction_timeout', ${timeout}, true)
    `),
    catch: cause => new ScopeSyncChangeSourceSqlV1Error({
      operation: "configureTimeout",
      cause,
    }),
  });
});

/** Adapts one caller-owned request-scoped Postgres client without leaking Drizzle. */
export function createPostgresClientScopeSyncChangeSourceReaderV1(
  client: Client,
): ScopeSyncChangeSourceReaderV1 {
  const delegate = createScopeSyncChangeSourceReaderV1(
    drizzle(client, { schema: flarexSchema }),
  );
  const readAfter = Effect.fn(
    "ScopeSyncChangeSource.configurePostgresClientTimeoutAndReadAfter",
  )(function* (input: ScopeSyncChangeSourceReadInputV1) {
    yield* Effect.fromResult(validateSourceReadInput(input));
    const timeout = `${input.maximumElapsedMilliseconds}ms`;
    yield* Effect.tryPromise({
      try: () => client.query({
        text: `select set_config('statement_timeout', $1, false),
                      set_config('transaction_timeout', $1, false)`,
        values: [timeout],
      }),
      catch: cause => scopeSyncChangeSourceTimeoutErrorFromCauseV1(cause) ??
        new ScopeSyncChangeSourceSqlV1Error({
            operation: "configureTimeout",
            cause,
          }),
    });
    return yield* delegate.readAfter(input);
  });
  return Object.freeze({ readAfter });
}

function validateSourceReadInput(
  input: ScopeSyncChangeSourceReadInputV1,
): Result.Result<
  ScopeSyncChangeSourceReadInputV1,
  ScopeSyncChangeSourceInputV1Error
> {
  if (!Number.isSafeInteger(input.maximumCommittedBatches) ||
    input.maximumCommittedBatches < 1 ||
    input.maximumCommittedBatches > MAX_COMMIT_FEED_PAGE_COMMITS_V1) {
    return Result.fail(new ScopeSyncChangeSourceInputV1Error({
      reason: "maximumCommittedBatchesInvalid",
    }));
  }
  return !Number.isSafeInteger(input.maximumElapsedMilliseconds) ||
      input.maximumElapsedMilliseconds < 1 ||
      input.maximumElapsedMilliseconds > 60_000
    ? Result.fail(new ScopeSyncChangeSourceInputV1Error({
        reason: "maximumElapsedMillisecondsInvalid",
      }))
    : Result.succeed(input);
}

function captureScopeClockAuthority(
  requestedScopeUuid: ScopeUuidV1,
  row: ScopeClockAuthorityRow | undefined,
): Result.Result<
  CapturedScopeClockAuthorityV1,
  ScopeSyncChangeSourceAuthorityV1Error
> {
  if (row === undefined || row.scopeUuid !== requestedScopeUuid ||
    row.storageGeneration !== "flarexdb_v1" ||
    typeof row.storageGenerationFence !== "bigint" ||
    row.storageGenerationFence < 1n ||
    row.storageGenerationFence > MAX_PERSISTED_SIGNED_INT64_V1 ||
    typeof row.lastCommitSeq !== "bigint" || row.lastCommitSeq < 0n ||
    row.lastCommitSeq > MAX_PERSISTED_SIGNED_INT64_V1 ||
    typeof row.oldestAvailableCommitSeq !== "bigint" ||
    row.oldestAvailableCommitSeq < 0n ||
    row.oldestAvailableCommitSeq > row.lastCommitSeq ||
    !isNonBlankString(row.scopeId) || !isNonBlankString(row.epoch)) {
    return Result.fail(authorityFailure(
      requestedScopeUuid,
      "scopeClockInvalid",
    ));
  }
  return Result.gen(function* () {
    const projectedScope = yield* projectScopeIdUuidV1Result(row.scopeId)
      .pipe(Result.mapError(cause => authorityFailure(
        requestedScopeUuid,
        "scopeClockInvalid",
        cause,
      )));
    const projectedEpoch = yield* projectScopeEpochUuidV1Result(row.epoch)
      .pipe(Result.mapError(cause => authorityFailure(
        requestedScopeUuid,
        "scopeClockInvalid",
        cause,
      )));
    if (projectedScope.scopeUuid !== requestedScopeUuid ||
      row.epochUuid !== projectedEpoch.epochUuid) {
      return yield* Result.fail(authorityFailure(
        requestedScopeUuid,
        "scopeClockInvalid",
      ));
    }
    return Object.freeze({
      scopeId: row.scopeId,
      scopeUuid: projectedScope.scopeUuid,
      currentSourceEpoch: projectedEpoch.epochUuid,
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: row.storageGenerationFence,
      lastCommitSeq: CommitSeqSchema.make(row.lastCommitSeq),
      oldestAvailableCommitSeq:
        CommitSeqSchema.make(row.oldestAvailableCommitSeq),
    });
  });
}

function captureFrontiers(
  clock: CapturedScopeClockAuthorityV1,
): ScopeSyncChangeSourceFrontiersV1 {
  const replayableAfterCommitSeqExclusive = CommitSeqSchema.make(
    clock.oldestAvailableCommitSeq === 0n
      ? 0n
      : clock.oldestAvailableCommitSeq - 1n,
  );
  return Object.freeze({
    scopeUuid: clock.scopeUuid,
    currentSourceEpoch: clock.currentSourceEpoch,
    observedLatestCommitSeq: clock.lastCommitSeq,
    replayableAfterCommitSeqExclusive,
    retainedFromCommitSeqInclusive:
      replayableAfterCommitSeqExclusive === clock.lastCommitSeq
        ? null
        : CommitSeqSchema.make(replayableAfterCommitSeqExclusive + 1n),
  });
}

const observeAuthorityAtFrontier = Effect.fn(
  "ScopeSyncChangeSource.observeAuthorityAtFrontier",
)(function* (
  tx: AppRowTransaction,
  clock: CapturedScopeClockAuthorityV1,
): Effect.fn.Return<
  ScopeSyncActiveHeadObservationV1,
  ApplicationActiveHeadStateError | ScopeSyncChangeSourceAuthorityV1Error
> {
  const active = yield* readCoherentApplicationActiveHeadInTransactionEffect(
    tx,
    clock.scopeId,
  );
  if (active === null) {
    return yield* authorityFailure(clock.scopeUuid, "activeHeadMissing");
  }
  return captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: clock.scopeUuid,
    epochUuid: clock.currentSourceEpoch,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    observedAtCommitSeq: clock.lastCommitSeq,
    activationSequence: ApplicationActivationSequenceV1Schema.make(
      active.head.activationSequence,
    ),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      encodeBytesToLowercaseHex(active.head.headSha256),
    ),
  });
});

function authorityFailure(
  scopeUuid: ScopeUuidV1,
  reason: ScopeSyncChangeSourceAuthorityV1Error["reason"],
  cause?: unknown,
): ScopeSyncChangeSourceAuthorityV1Error {
  return new ScopeSyncChangeSourceAuthorityV1Error({
    scopeUuid,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function isDatabaseTimeoutFailure(
  error: ScopeSyncChangeSourceReadV1Error,
): boolean {
  switch (error._tag) {
    case "ApplicationActiveHeadStateError":
      return scopeSyncChangeSourceTimeoutErrorFromCauseV1(error.cause) !== null;
    case "CommitFeedSqlErrorV1":
    case "ScopeSyncChangeSourceSqlV1Error":
      return scopeSyncChangeSourceTimeoutErrorFromCauseV1(error.cause) !== null;
    case "CommitFeedCorruptionErrorV1":
    case "CommitFeedCursorResetRequiredErrorV1":
    case "CommitFeedInputErrorV1":
    case "CommitFeedScopeNotFoundErrorV1":
    case "ScopeSyncChangeSourceAuthorityV1Error":
    case "ScopeSyncChangeSourceInputV1Error":
    case "ScopeSyncChangeSourceTimeoutV1Error":
      return false;
  }
}

export function scopeSyncChangeSourceTimeoutErrorFromCauseV1(
  cause: unknown,
): ScopeSyncChangeSourceTimeoutV1Error | null {
  const code = findSqlState(cause);
  return code === "57014" || code === "25P04"
    ? new ScopeSyncChangeSourceTimeoutV1Error({ operation: "readAfter" })
    : null;
}

function findSqlState(cause: unknown, depth = 0): string | undefined {
  if (depth > 4 || !isNonArrayRecord(cause)) return undefined;
  const code = cause.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  const nested = cause.cause;
  return nested === cause ? undefined : findSqlState(nested, depth + 1);
}
