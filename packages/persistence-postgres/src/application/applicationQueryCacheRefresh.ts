import { Effect, Result, Schema } from "effect";
import { appRowIdHexV1FromBytesResult, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { CommitSeqSchema, projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";

import {
  CommitFeedCorruptionErrorV1,
  CommitFeedInputErrorV1,
  MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1,
  MAX_COMMIT_FEED_PAGE_COMMITS_V1,
  MAX_COMMIT_FEED_PAGE_RELATION_ADJACENCY_CHANGES_V1,
  readBoundedCommitFeedPageInTransactionEffect,
  type CommitFeedListAfterErrorV1,
} from "../commit/commitFeed";
import {
  defineScopedReadOperation,
  runScopedTransactionOperationEffect,
  type ScopedTransaction,
} from "../scope/execution/ScopedTransaction";
import {
  consumeBoundedAppRowsAtSnapshotInTransactionEffect,
  InvalidAppRowReadInputError,
  MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES,
  type AppRowIdentityV1,
  type AppRowReadResultV1,
  type AppRowRevisionV1,
  type AppRowTransaction,
  type ReadAppRowError,
} from "../storage/documents/appRows";
import { AppRowStorageCorruptionError } from "../storage/documents/appRowErrors";

export interface ApplicationQueryCacheRefreshInput {
  readonly fromCommitSeq: CommitSeq;
  readonly targetCommitSeq: CommitSeq;
  readonly maximumCommits: number;
  readonly maximumChanges: number;
  readonly maximumSemanticBytes: number;
}

export interface ApplicationQueryCacheRevisionChange {
  readonly commitSeq: CommitSeq;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly previous: AppRowReadResultV1;
  readonly next: AppRowRevisionV1;
}

export type ApplicationQueryCacheRefreshResult =
  | Readonly<{ readonly kind: "cold"; readonly reason: "historyUnavailable" | "capacityExceeded" }>
  | Readonly<{
      readonly kind: "captured";
      readonly snapshotCommitSeq: CommitSeq;
      readonly changes: readonly ApplicationQueryCacheRevisionChange[];
    }>;

export type ApplicationQueryCacheRefreshError = ReadAppRowError | CommitFeedListAfterErrorV1;

const nonnegativeLimit = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const decodeRefreshPositionsEffect = Schema.decodeUnknownEffect(Schema.Struct({
  fromCommitSeq: Schema.toType(CommitSeqSchema),
  targetCommitSeq: Schema.toType(CommitSeqSchema),
}));
const decodeRefreshLimitsEffect = Schema.decodeUnknownEffect(Schema.Struct({
  maximumCommits: nonnegativeLimit,
  maximumChanges: nonnegativeLimit,
  maximumSemanticBytes: nonnegativeLimit,
}));
const coldCapacity = Object.freeze({ kind: "cold", reason: "capacityExceeded" } as const);
const coldHistory = Object.freeze({ kind: "cold", reason: "historyUnavailable" } as const);

/** Borrow the caller's live read capability. This operation neither acquires
 * another transaction nor lets history escape its existing authority guard. */
export const captureApplicationQueryCacheRefresh = Effect.fn(
  "ApplicationQueryCache.captureRefresh",
)((scoped: ScopedTransaction, input: ApplicationQueryCacheRefreshInput):
  Effect.Effect<ApplicationQueryCacheRefreshResult, ApplicationQueryCacheRefreshError> =>
  runScopedTransactionOperationEffect(scoped, captureRefreshOperation, input));

const captureRefreshOperation = defineScopedReadOperation(Effect.fn(
  "ApplicationQueryCache.captureRefreshInTransaction",
)(function* (tx, context, rawInput: ApplicationQueryCacheRefreshInput):
  Effect.fn.Return<ApplicationQueryCacheRefreshResult, ApplicationQueryCacheRefreshError> {
  const positions = yield* decodeRefreshPositionsEffect(rawInput).pipe(Effect.mapError(cause =>
    new InvalidAppRowReadInputError({ reason: "invalidSnapshotCommitSeq", cause })));
  const limits = yield* decodeRefreshLimitsEffect(rawInput).pipe(Effect.mapError(cause =>
    new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause })));
  const input = { ...positions, ...limits };
  if (input.fromCommitSeq > input.targetCommitSeq) {
    return yield* new CommitFeedInputErrorV1({ reason: "inclusiveCommitSeqInvalid" });
  }
  if (input.targetCommitSeq > context.clock.lastCommitSeq) {
    return yield* new CommitFeedInputErrorV1({ reason: "inclusiveCommitSeqAheadOfClock" });
  }
  if (input.fromCommitSeq < context.clock.oldestAvailableCommitSeq) return coldHistory;
  const distance = input.targetCommitSeq - input.fromCommitSeq;
  const maximumCommits = Math.min(input.maximumCommits, MAX_COMMIT_FEED_PAGE_COMMITS_V1);
  if (distance > BigInt(maximumCommits)) return coldCapacity;
  if (distance === 0n) return Object.freeze({ kind: "captured", snapshotCommitSeq: input.targetCommitSeq, changes: Object.freeze([]) });

  const { scopeUuid } = yield* Effect.fromResult(projectScopeIdUuidV1Result(context.clock.scopeId).pipe(
    Result.mapError(() => new CommitFeedInputErrorV1({ reason: "scopeUuidInvalid" })),
  ));
  const captured = yield* readBoundedCommitFeedPageInTransactionEffect(tx, {
    scopeUuid, exclusiveCommitSeq: input.fromCommitSeq, inclusiveCommitSeq: input.targetCommitSeq,
    maximumCommits: Number(distance),
    maximumAppRowChanges: Math.min(input.maximumChanges, MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1),
    maximumRelationAdjacencyChanges: Math.min(input.maximumChanges, MAX_COMMIT_FEED_PAGE_RELATION_ADJACENCY_CHANGES_V1),
  });
  if (captured.kind === "capacityExceeded") return coldCapacity;
  if (captured.page.commits.at(-1)?.commitSeq !== input.targetCommitSeq) return coldCapacity;

  const changes: ApplicationQueryCacheRevisionChange[] = [];
  let semanticBytes = 0;
  for (const commit of captured.page.commits) {
    for (const change of commit.appRowChanges) {
      const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(change.rowId).pipe(
        Result.mapError(() => new CommitFeedCorruptionErrorV1({ reason: "appRowChangeInvalid", scopeUuid, commitSeq: commit.commitSeq })),
      ));
      const identity = { scopeId: context.clock.scopeId, tableId: change.tableId, rowId };
      const previous = yield* readRefreshRevision(tx, identity, CommitSeqSchema.make(commit.commitSeq - 1n),
        input.maximumSemanticBytes - semanticBytes);
      semanticBytes += previous.kind === "live" ? previous.document.semanticSizeBytes : 0;
      if (semanticBytes > input.maximumSemanticBytes) return coldCapacity;
      const next = yield* readRefreshRevision(tx, identity, commit.commitSeq, input.maximumSemanticBytes - semanticBytes);
      semanticBytes += next.kind === "live" ? next.document.semanticSizeBytes : 0;
      if (semanticBytes > input.maximumSemanticBytes) return coldCapacity;
      if (next.kind === "missing" || next.commitSeq !== commit.commitSeq || next.writeEpochUuid !== commit.epochUuid) {
        return yield* Effect.fail(new AppRowStorageCorruptionError(identity, "cache refresh fact does not match the new row revision"));
      }
      if (next.prevCommitSeq !== (previous.kind === "missing" ? null : previous.commitSeq)) {
        return yield* Effect.fail(new AppRowStorageCorruptionError(identity, "cache refresh predecessor does not match the row revision chain"));
      }
      changes.push(Object.freeze({ commitSeq: commit.commitSeq, tableId: change.tableId, rowId, previous, next }));
    }
  }
  return Object.freeze({ kind: "captured", snapshotCommitSeq: input.targetCommitSeq, changes: Object.freeze(changes) });
}));

const readRefreshRevision = Effect.fn("ApplicationQueryCache.readRefreshRevision")(function* (
  tx: AppRowTransaction,
  identity: AppRowIdentityV1,
  snapshotCommitSeq: CommitSeq,
  maximumSemanticBytes: number,
): Effect.fn.Return<AppRowReadResultV1, ReadAppRowError> {
  let revision: AppRowReadResultV1 = Object.freeze({ kind: "missing" });
  // The shared reader deliberately permits one protocol-bounded crossing body.
  // The caller checks its canonical semantic size before any following read.
  yield* consumeBoundedAppRowsAtSnapshotInTransactionEffect(tx, {
    scopeId: identity.scopeId, tableId: identity.tableId, rowIds: [identity.rowId],
    snapshotCommitSeq, maximumTotalValueBytes: Math.min(maximumSemanticBytes, MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES),
  }, cause => cause, (_rowId, value) => Effect.sync(() => { revision = value; }));
  return revision;
});
