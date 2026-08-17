import {
  bytesEqual,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import {
  asc,
  desc,
  eq,
  inArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  CatalogIndexDefinitionIdSchema,
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  ORDERED_INDEX_KEY_CODEC_VERSION_V1,
  MAX_ORDERED_INDEX_KEY_BYTES_V1,
  OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexRowIdHexV1Schema,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  orderedIndexRowIdHexV1ToBytes,
} from "flarex-protocol/ordered-index";
import {
  CommitSeqSchema,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeId,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import { observeDrizzleQuery } from "./drizzleQueryObservation";
import { runLocatedReadCommittedEffect } from "./locatedReadCommittedEffect";
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
import { fxAppIndexEntryRevisions } from "./schema";
import { LocatedReadCommittedTransactionFailureV1 } from
  "./transactionSessionAttemptKernel";

export const MAX_RETAINED_INDEX_HISTORY_PAGE_REVISIONS = 128;

const retainedIndexHistoryCompactionPortBrand: unique symbol = Symbol(
  "FlarexDB/retainedIndexHistoryCompactionPort",
);

const StrictParseOptions = { onExcessProperty: "error" } as const;
const RetainedIndexHistoryIdentitySchema = Schema.Struct({
  indexDefinitionId: CatalogIndexDefinitionIdSchema,
  encodedKey: OrderedIndexKeyBytesHexV1Schema,
  rowId: OrderedIndexRowIdHexV1Schema,
});
const RetainedIndexHistoryCursorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("start") }),
  Schema.Struct({
    kind: Schema.Literal("after"),
    identity: RetainedIndexHistoryIdentitySchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("exact"),
    identity: RetainedIndexHistoryIdentitySchema,
  }),
]);
const decodeCursorResult = Schema.decodeUnknownResult(
  Schema.toType(RetainedIndexHistoryCursorSchema),
  StrictParseOptions,
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeIndexDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogIndexDefinitionIdSchema),
);
const decodeOrderedKeyBytesResult = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexKeyBytesHexV1Schema),
);
const decodeTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);

export type RetainedIndexHistoryIdentity =
  typeof RetainedIndexHistoryIdentitySchema.Type;
export type RetainedIndexHistoryCursor =
  typeof RetainedIndexHistoryCursorSchema.Type;

export interface RetainedIndexHistoryCompactionQuery {
  readonly name:
    | "identityDirectory"
    | "anchor"
    | "candidateDirectory"
    | "revisionDeletion";
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface RetainedIndexHistoryCompactionPort {
  readonly [retainedIndexHistoryCompactionPortBrand]: true;
}

interface RetainedIndexHistoryCompactionPortState {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly observeQuery?: (
    query: RetainedIndexHistoryCompactionQuery,
  ) => void;
}

const portStates = new WeakMap<
  RetainedIndexHistoryCompactionPort,
  RetainedIndexHistoryCompactionPortState
>();

/** Private, production-inert O11-D ordered-index cleanup authority. */
export function createRetainedIndexHistoryCompactionPort(input: {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly observeQuery?: (
    query: RetainedIndexHistoryCompactionQuery,
  ) => void;
}): RetainedIndexHistoryCompactionPort {
  const observeQuery = input.observeQuery;
  const port = Object.freeze({
    [retainedIndexHistoryCompactionPortBrand]: true as const,
  });
  portStates.set(port, Object.freeze({
    authority: captureTrustedScopeAuthorityResolutionPorts(input.authority),
    ...(observeQuery === undefined
      ? {}
      : { observeQuery }),
  }));
  return port;
}

export type RetainedIndexHistoryCompactionResult =
  | Readonly<{
      readonly status: "compacted";
      readonly disposition: "exhausted";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly retainedFloor: CommitSeq;
    }>
  | Readonly<{
      readonly status: "compacted";
      readonly disposition: "advanced" | "deleted";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly retainedFloor: CommitSeq;
      readonly identity: RetainedIndexHistoryIdentity;
      readonly anchorCommitSeq: CommitSeq | null;
      readonly deletedRevisionCount: number;
      readonly continuation: RetainedIndexHistoryCursor;
    }>;

export class RetainedIndexHistoryCompactionError extends Data.TaggedError(
  "RetainedIndexHistoryCompactionError",
)<{
  readonly reason:
    | "invalidPort"
    | "invalidCursor"
    | "invalidTarget"
    | "staleAuthority"
    | "storedEvidenceInvalid";
  readonly deploymentId: string;
  readonly scopeId?: ScopeId;
  readonly cause?: unknown;
}> {}

export class RetainedIndexHistoryCompactionPersistenceError extends
  Data.TaggedError("RetainedIndexHistoryCompactionPersistenceError")<{
    readonly operation:
      | "identityDirectory"
      | "anchor"
      | "candidateDirectory"
      | "revisionDeletion";
    readonly cause: unknown;
  }> {}

export type CompactRetainedIndexHistoryPageError =
  | RetainedIndexHistoryCompactionError
  | RetainedIndexHistoryCompactionPersistenceError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1
  | TrustedScopeAuthorityError;

export const compactRetainedIndexHistoryPageEffect = Effect.fn(
  "RetainedIndexHistory.compactPage",
)(function* (
  port: RetainedIndexHistoryCompactionPort,
  deploymentId: string,
  cursorInput: unknown,
): Effect.fn.Return<
  RetainedIndexHistoryCompactionResult,
  CompactRetainedIndexHistoryPageError
> {
  const state = portStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(new RetainedIndexHistoryCompactionError({
      reason: "invalidPort",
      deploymentId,
    }));
  }
  const cursor = yield* decodeCursorResult(cursorInput).pipe(
    Result.mapError(cause => new RetainedIndexHistoryCompactionError({
      reason: "invalidCursor",
      deploymentId,
      cause,
    })),
    Effect.fromResult,
  );
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    deploymentId,
    state.authority,
  );
  if (!isLocatedRetainedHistoryFloorTargetInternal(located.target)) {
    return yield* Effect.fail(new RetainedIndexHistoryCompactionError({
      reason: "invalidTarget",
      deploymentId,
      scopeId: located.authority.scopeId,
    }));
  }
  return yield* runLocatedReadCommittedEffect(
    located.target,
    {
      rollbackMessage: "rollback:retained-index-history-compaction",
      cleanupDefect: failure => failure,
    },
    tx => compactInTransaction(tx, located.authority, state, cursor),
  );
});

const compactInTransaction = Effect.fn(
  "RetainedIndexHistory.compactInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  state: RetainedIndexHistoryCompactionPortState,
  cursor: RetainedIndexHistoryCursor,
): Effect.fn.Return<
  RetainedIndexHistoryCompactionResult,
  | RetainedIndexHistoryCompactionError
  | RetainedIndexHistoryCompactionPersistenceError
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
  const identityQuery = tx.select(revisionSelection()).from(
    fxAppIndexEntryRevisions,
  ).where(identitySelectionWhere(scopeUuid.scopeUuid, cursor)).orderBy(
    asc(fxAppIndexEntryRevisions.indexDefinitionId),
    asc(fxAppIndexEntryRevisions.encodedKey),
    asc(fxAppIndexEntryRevisions.rowId),
    asc(fxAppIndexEntryRevisions.commitSeq),
  ).limit(1).for("update");
  observeDrizzleQuery("identityDirectory", identityQuery, state.observeQuery);
  const identityRows = yield* queryEffect("identityDirectory", identityQuery);
  if (identityRows.length === 0) {
    if (cursor.kind === "exact") {
      return yield* Effect.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    return Object.freeze({
      status: "compacted" as const,
      disposition: "exhausted" as const,
      deploymentId: authority.deploymentId,
      scopeId: authority.scopeId,
      retainedFloor: clock.oldestAvailableCommitSeq,
    });
  }
  if (identityRows.length !== 1) {
    return yield* Effect.fail(compactionError(
      authority,
      "storedEvidenceInvalid",
    ));
  }
  const first = yield* Effect.fromResult(decodeRevisionResult(
    authority,
    identityRows[0],
  ));
  const identity = first.identity;

  const anchorQuery = tx.select(revisionSelection()).from(
    fxAppIndexEntryRevisions,
  ).where(sql`${identityWhere(scopeUuid.scopeUuid, identity)} and
    ${fxAppIndexEntryRevisions.commitSeq} <= ${clock.oldestAvailableCommitSeq}`
  ).orderBy(
    desc(fxAppIndexEntryRevisions.commitSeq),
  ).limit(1).for("update");
  observeDrizzleQuery("anchor", anchorQuery, state.observeQuery);
  const anchorRows = yield* queryEffect("anchor", anchorQuery);
  if (anchorRows.length === 0) {
    if (
      first.commitSeq <= clock.oldestAvailableCommitSeq ||
      first.prevCommitSeq !== null
    ) {
      return yield* Effect.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    return advancedResult(authority, clock, identity, null, 0);
  }
  if (anchorRows.length !== 1) {
    return yield* Effect.fail(compactionError(
      authority,
      "storedEvidenceInvalid",
    ));
  }
  const anchor = yield* Effect.fromResult(decodeRevisionResult(
    authority,
    anchorRows[0],
  ));
  yield* Effect.fromResult(requireSameIdentityEvidenceResult(
    authority,
    first,
    anchor,
  ));
  if (
    anchor.commitSeq > clock.oldestAvailableCommitSeq ||
    first.commitSeq > anchor.commitSeq
  ) {
    return yield* Effect.fail(compactionError(
      authority,
      "storedEvidenceInvalid",
    ));
  }

  const candidateQuery = tx.select(revisionSelection()).from(
    fxAppIndexEntryRevisions,
  ).where(sql`${identityWhere(scopeUuid.scopeUuid, identity)} and
    ${fxAppIndexEntryRevisions.commitSeq} < ${anchor.commitSeq}`
  ).orderBy(asc(fxAppIndexEntryRevisions.commitSeq)).limit(
    MAX_RETAINED_INDEX_HISTORY_PAGE_REVISIONS + 1,
  ).for("update");
  observeDrizzleQuery(
    "candidateDirectory",
    candidateQuery,
    state.observeQuery,
  );
  const candidateRows = yield* queryEffect(
    "candidateDirectory",
    candidateQuery,
  );
  const candidates = yield* Effect.fromResult(decodeCandidatesResult(
    authority,
    anchor,
    candidateRows,
  ));
  const deletable = candidates.slice(
    0,
    MAX_RETAINED_INDEX_HISTORY_PAGE_REVISIONS,
  );
  if (deletable.length === 0) {
    return advancedResult(
      authority,
      clock,
      identity,
      anchor.commitSeq,
      0,
    );
  }

  const deletion = tx.delete(fxAppIndexEntryRevisions).where(
    sql`${identityWhere(scopeUuid.scopeUuid, identity)} and ${inArray(
      fxAppIndexEntryRevisions.commitSeq,
      deletable.map(revision => revision.commitSeq),
    )}`,
  ).returning({ commitSeq: fxAppIndexEntryRevisions.commitSeq });
  observeDrizzleQuery("revisionDeletion", deletion, state.observeQuery);
  const deletedRows = yield* queryEffect("revisionDeletion", deletion);
  yield* Effect.fromResult(requireExactDeletionResult(
    authority,
    deletable,
    deletedRows,
  ));

  const continuation = candidates.length >
      MAX_RETAINED_INDEX_HISTORY_PAGE_REVISIONS
    ? exactCursor(identity)
    : afterCursor(identity);
  return Object.freeze({
    status: "compacted" as const,
    disposition: "deleted" as const,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    retainedFloor: clock.oldestAvailableCommitSeq,
    identity,
    anchorCommitSeq: anchor.commitSeq,
    deletedRevisionCount: deletable.length,
    continuation,
  });
});

interface DecodedRevision {
  readonly identity: RetainedIndexHistoryIdentity;
  readonly tableId: CatalogTableId;
  readonly physicalSpecSha256: Uint8Array;
  readonly keySha256: Uint8Array;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
}

function revisionSelection() {
  return {
    indexDefinitionId: fxAppIndexEntryRevisions.indexDefinitionId,
    tableId: fxAppIndexEntryRevisions.tableId,
    keyCodecVersion: fxAppIndexEntryRevisions.keyCodecVersion,
    physicalSpecSha256: fxAppIndexEntryRevisions.physicalSpecSha256,
    encodedKey: fxAppIndexEntryRevisions.encodedKey,
    keySha256: fxAppIndexEntryRevisions.keySha256,
    rowId: fxAppIndexEntryRevisions.rowId,
    commitSeq: fxAppIndexEntryRevisions.commitSeq,
    prevCommitSeq: fxAppIndexEntryRevisions.prevCommitSeq,
    isTombstone: fxAppIndexEntryRevisions.isTombstone,
  } as const;
}

function identitySelectionWhere(
  scopeUuid: ScopeUuidV1,
  cursor: RetainedIndexHistoryCursor,
): SQL {
  if (cursor.kind === "start") {
    return eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid);
  }
  const exact = identityWhere(scopeUuid, cursor.identity);
  if (cursor.kind === "exact") return exact;
  const keyBytes = orderedIndexKeyBytesHexV1ToBytes(
    cursor.identity.encodedKey,
  );
  const rowIdBytes = orderedIndexRowIdHexV1ToBytes(cursor.identity.rowId);
  return sql`${fxAppIndexEntryRevisions.scopeUuid} = ${scopeUuid} and (
      ${fxAppIndexEntryRevisions.indexDefinitionId},
      ${fxAppIndexEntryRevisions.encodedKey},
      ${fxAppIndexEntryRevisions.rowId}
    ) > (
      ${cursor.identity.indexDefinitionId},
      ${keyBytes},
      ${rowIdBytes}
    )`;
}

function identityWhere(
  scopeUuid: ScopeUuidV1,
  identity: RetainedIndexHistoryIdentity,
): SQL {
  return sql`${fxAppIndexEntryRevisions.scopeUuid} = ${scopeUuid}
    and ${fxAppIndexEntryRevisions.indexDefinitionId} = ${identity.indexDefinitionId}
    and ${fxAppIndexEntryRevisions.encodedKey} = ${
      orderedIndexKeyBytesHexV1ToBytes(identity.encodedKey)
    }
    and ${fxAppIndexEntryRevisions.rowId} = ${
      orderedIndexRowIdHexV1ToBytes(identity.rowId)
    }`;
}

function decodeRevisionResult(
  authority: TrustedScopeAuthority,
  row: Readonly<{
    readonly indexDefinitionId: unknown;
    readonly tableId: unknown;
    readonly keyCodecVersion: unknown;
    readonly physicalSpecSha256: unknown;
    readonly encodedKey: unknown;
    readonly keySha256: unknown;
    readonly rowId: unknown;
    readonly commitSeq: unknown;
    readonly prevCommitSeq: unknown;
    readonly isTombstone: unknown;
  }>,
): Result.Result<DecodedRevision, RetainedIndexHistoryCompactionError> {
  return Result.gen(function* () {
    const indexDefinitionId = yield* decodeIndexDefinitionIdResult(
      row.indexDefinitionId,
    ).pipe(Result.mapError(cause => compactionError(
      authority,
      "storedEvidenceInvalid",
      cause,
    )));
    const tableId = yield* decodeTableIdResult(row.tableId).pipe(
      Result.mapError(cause => compactionError(
        authority,
        "storedEvidenceInvalid",
        cause,
      )),
    );
    const encodedKeyByteLength = uint8ArrayByteLength(row.encodedKey);
    if (
      row.keyCodecVersion !== ORDERED_INDEX_KEY_CODEC_VERSION_V1 ||
      !isUint8ArrayWithByteLength(row.physicalSpecSha256, 32) ||
      !isUint8Array(row.encodedKey) ||
      encodedKeyByteLength === undefined ||
      encodedKeyByteLength === 0 ||
      encodedKeyByteLength > MAX_ORDERED_INDEX_KEY_BYTES_V1 ||
      !isUint8ArrayWithByteLength(row.keySha256, 32) ||
      typeof row.isTombstone !== "boolean"
    ) {
      return yield* Result.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    const encodedKeyBytes = row.encodedKey;
    const encodedKeyText = yield* Result.try({
      try: () => encodeBytesToLowercaseHex(encodedKeyBytes),
      catch: cause => compactionError(
        authority,
        "storedEvidenceInvalid",
        cause,
      ),
    });
    const encodedKey = yield* decodeOrderedKeyBytesResult(encodedKeyText).pipe(
      Result.mapError(cause => compactionError(
        authority,
        "storedEvidenceInvalid",
        cause,
      )),
    );
    const rowId = yield* orderedIndexRowIdHexV1FromBytesResult(row.rowId).pipe(
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
        value => value >= 1n,
        () => compactionError(authority, "storedEvidenceInvalid"),
      ),
    );
    const prevCommitSeq = row.prevCommitSeq === null
      ? null
      : yield* decodeCommitSeqResult(row.prevCommitSeq).pipe(
          Result.mapError(cause => compactionError(
            authority,
            "storedEvidenceInvalid",
            cause,
          )),
          Result.filterOrFail(
            value => value >= 1n && value < commitSeq,
            () => compactionError(authority, "storedEvidenceInvalid"),
          ),
        );
    return Object.freeze({
      identity: Object.freeze({
        indexDefinitionId,
        encodedKey,
        rowId,
      }),
      tableId,
      physicalSpecSha256: new Uint8Array(row.physicalSpecSha256),
      keySha256: new Uint8Array(row.keySha256),
      commitSeq,
      prevCommitSeq,
    });
  });
}

function decodeCandidatesResult(
  authority: TrustedScopeAuthority,
  anchor: DecodedRevision,
  rows: ReadonlyArray<Parameters<typeof decodeRevisionResult>[1]>,
): Result.Result<
  ReadonlyArray<DecodedRevision>,
  RetainedIndexHistoryCompactionError
> {
  return Result.gen(function* () {
    if (rows.length > MAX_RETAINED_INDEX_HISTORY_PAGE_REVISIONS + 1) {
      return yield* Result.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    const candidates: DecodedRevision[] = [];
    for (const row of rows) {
      const candidate = yield* decodeRevisionResult(authority, row);
      yield* requireSameIdentityEvidenceResult(
        authority,
        anchor,
        candidate,
      );
      if (
        candidate.commitSeq >= anchor.commitSeq ||
        (candidates.length > 0 &&
          candidate.prevCommitSeq !== candidates.at(-1)?.commitSeq)
      ) {
        return yield* Result.fail(compactionError(
          authority,
          "storedEvidenceInvalid",
        ));
      }
      candidates.push(candidate);
    }
    const last = candidates.at(-1);
    if (
      candidates.length <= MAX_RETAINED_INDEX_HISTORY_PAGE_REVISIONS &&
      last !== undefined &&
      anchor.prevCommitSeq !== last.commitSeq
    ) {
      return yield* Result.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    return Object.freeze(candidates);
  });
}

function requireSameIdentityEvidenceResult(
  authority: TrustedScopeAuthority,
  expected: DecodedRevision,
  actual: DecodedRevision,
): Result.Result<void, RetainedIndexHistoryCompactionError> {
  return expected.identity.indexDefinitionId ===
      actual.identity.indexDefinitionId &&
      expected.identity.encodedKey === actual.identity.encodedKey &&
      expected.identity.rowId === actual.identity.rowId &&
      expected.tableId === actual.tableId &&
      bytesEqual(expected.physicalSpecSha256, actual.physicalSpecSha256) &&
      bytesEqual(expected.keySha256, actual.keySha256)
    ? Result.succeed(undefined)
    : Result.fail(compactionError(authority, "storedEvidenceInvalid"));
}

function requireExactDeletionResult(
  authority: TrustedScopeAuthority,
  expected: ReadonlyArray<DecodedRevision>,
  actual: ReadonlyArray<Readonly<{ readonly commitSeq: unknown }>>,
): Result.Result<void, RetainedIndexHistoryCompactionError> {
  return Result.gen(function* () {
    if (actual.length !== expected.length) {
      return yield* Result.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    const expectedSequences = new Set(expected.map(row => row.commitSeq));
    for (const row of actual) {
      const commitSeq = yield* decodeCommitSeqResult(row.commitSeq).pipe(
        Result.mapError(cause => compactionError(
          authority,
          "storedEvidenceInvalid",
          cause,
        )),
        Result.filterOrFail(
          value => value >= 1n,
          () => compactionError(authority, "storedEvidenceInvalid"),
        ),
      );
      if (!expectedSequences.delete(commitSeq)) {
        return yield* Result.fail(compactionError(
          authority,
          "storedEvidenceInvalid",
        ));
      }
    }
    return expectedSequences.size === 0
      ? undefined
      : yield* Result.fail(compactionError(
          authority,
          "storedEvidenceInvalid",
        ));
  });
}

function advancedResult(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  identity: RetainedIndexHistoryIdentity,
  anchorCommitSeq: CommitSeq | null,
  deletedRevisionCount: number,
): RetainedIndexHistoryCompactionResult {
  return Object.freeze({
    status: "compacted" as const,
    disposition: deletedRevisionCount === 0
      ? "advanced" as const
      : "deleted" as const,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    retainedFloor: clock.oldestAvailableCommitSeq,
    identity,
    anchorCommitSeq,
    deletedRevisionCount,
    continuation: afterCursor(identity),
  });
}

function afterCursor(
  identity: RetainedIndexHistoryIdentity,
): RetainedIndexHistoryCursor {
  return Object.freeze({ kind: "after" as const, identity });
}

function exactCursor(
  identity: RetainedIndexHistoryIdentity,
): RetainedIndexHistoryCursor {
  return Object.freeze({ kind: "exact" as const, identity });
}

function requireExactAuthority(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): Effect.Effect<void, RetainedIndexHistoryCompactionError> {
  return clock.storageGeneration === "flarexdb_v1" &&
      clock.storageGeneration === authority.storageGeneration &&
      clock.storageGenerationFence === authority.storageGenerationFence &&
      clock.epoch === authority.epoch
    ? Effect.void
    : Effect.fail(compactionError(authority, "staleAuthority"));
}

function queryEffect<Value>(
  operation: RetainedIndexHistoryCompactionPersistenceError["operation"],
  query: PromiseLike<Value>,
): Effect.Effect<Value, RetainedIndexHistoryCompactionPersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: cause => new RetainedIndexHistoryCompactionPersistenceError({
      operation,
      cause,
    }),
  }));
}

function compactionError(
  authority: TrustedScopeAuthority,
  reason: RetainedIndexHistoryCompactionError["reason"],
  cause?: unknown,
): RetainedIndexHistoryCompactionError {
  return new RetainedIndexHistoryCompactionError({
    reason,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    cause,
  });
}
