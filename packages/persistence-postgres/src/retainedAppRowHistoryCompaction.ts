import { asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  AppCreationTimeV1Schema,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  AppRowIdHexV1Schema,
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import {
  CommitSeqSchema,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeId,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";

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
import { fxAppRowRevisions } from "./schema";
import { LocatedReadCommittedTransactionFailureV1 } from
  "./transactionSessionAttemptKernel";

export const MAX_RETAINED_APP_ROW_HISTORY_PAGE_REVISIONS = 128;

const retainedAppRowHistoryCompactionPortBrand: unique symbol = Symbol(
  "FlarexDB/retainedAppRowHistoryCompactionPort",
);

const StrictParseOptions = { onExcessProperty: "error" } as const;
const RetainedAppRowHistoryIdentitySchema = Schema.Struct({
  tableId: CatalogTableIdSchema,
  rowId: AppRowIdHexV1Schema,
});
const RetainedAppRowHistoryCursorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("start") }),
  Schema.Struct({
    kind: Schema.Literal("after"),
    identity: RetainedAppRowHistoryIdentitySchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("exact"),
    identity: RetainedAppRowHistoryIdentitySchema,
  }),
]);
const decodeCursorResult = Schema.decodeUnknownResult(
  Schema.toType(RetainedAppRowHistoryCursorSchema),
  StrictParseOptions,
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodeCreationTimeResult = Schema.decodeUnknownResult(
  Schema.toType(AppCreationTimeV1Schema),
);

export type RetainedAppRowHistoryIdentity =
  typeof RetainedAppRowHistoryIdentitySchema.Type;
export type RetainedAppRowHistoryCursor =
  typeof RetainedAppRowHistoryCursorSchema.Type;

export interface RetainedAppRowHistoryCompactionQuery {
  readonly name:
    | "identityDirectory"
    | "anchor"
    | "candidateDirectory"
    | "revisionDeletion";
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface RetainedAppRowHistoryCompactionPort {
  readonly [retainedAppRowHistoryCompactionPortBrand]: true;
}

interface RetainedAppRowHistoryCompactionPortState {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly observeQuery?: (
    query: RetainedAppRowHistoryCompactionQuery,
  ) => void;
}

const portStates = new WeakMap<
  RetainedAppRowHistoryCompactionPort,
  RetainedAppRowHistoryCompactionPortState
>();

/** Private, production-inert O11-D authoritative app-row cleanup authority. */
export function createRetainedAppRowHistoryCompactionPort(input: {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly observeQuery?: (
    query: RetainedAppRowHistoryCompactionQuery,
  ) => void;
}): RetainedAppRowHistoryCompactionPort {
  const observeQuery = input.observeQuery;
  const port = Object.freeze({
    [retainedAppRowHistoryCompactionPortBrand]: true as const,
  });
  portStates.set(port, Object.freeze({
    authority: captureTrustedScopeAuthorityResolutionPorts(input.authority),
    ...(observeQuery === undefined ? {} : { observeQuery }),
  }));
  return port;
}

export type RetainedAppRowHistoryCompactionResult =
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
      readonly identity: RetainedAppRowHistoryIdentity;
      readonly rootCommitSeq: CommitSeq;
      readonly anchorCommitSeq: CommitSeq | null;
      readonly deletedRevisionCount: number;
      readonly continuation: RetainedAppRowHistoryCursor;
    }>;

export class RetainedAppRowHistoryCompactionError extends Data.TaggedError(
  "RetainedAppRowHistoryCompactionError",
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

export class RetainedAppRowHistoryCompactionPersistenceError extends
  Data.TaggedError("RetainedAppRowHistoryCompactionPersistenceError")<{
    readonly operation:
      | "identityDirectory"
      | "anchor"
      | "candidateDirectory"
      | "revisionDeletion";
    readonly cause: unknown;
  }> {}

export type CompactRetainedAppRowHistoryPageError =
  | RetainedAppRowHistoryCompactionError
  | RetainedAppRowHistoryCompactionPersistenceError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1
  | TrustedScopeAuthorityError;

export const compactRetainedAppRowHistoryPageEffect = Effect.fn(
  "RetainedAppRowHistory.compactPage",
)(function* (
  port: RetainedAppRowHistoryCompactionPort,
  deploymentId: string,
  cursorInput: unknown,
): Effect.fn.Return<
  RetainedAppRowHistoryCompactionResult,
  CompactRetainedAppRowHistoryPageError
> {
  const state = portStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(new RetainedAppRowHistoryCompactionError({
      reason: "invalidPort",
      deploymentId,
    }));
  }
  const cursor = yield* decodeCursorResult(cursorInput).pipe(
    Result.mapError(cause => new RetainedAppRowHistoryCompactionError({
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
    return yield* Effect.fail(new RetainedAppRowHistoryCompactionError({
      reason: "invalidTarget",
      deploymentId,
      scopeId: located.authority.scopeId,
    }));
  }
  return yield* runLocatedReadCommittedEffect(
    located.target,
    {
      rollbackMessage: "rollback:retained-app-row-history-compaction",
      cleanupDefect: failure => failure,
    },
    tx => compactInTransaction(tx, located.authority, state, cursor),
  );
});

const compactInTransaction = Effect.fn(
  "RetainedAppRowHistory.compactInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  state: RetainedAppRowHistoryCompactionPortState,
  cursor: RetainedAppRowHistoryCursor,
): Effect.fn.Return<
  RetainedAppRowHistoryCompactionResult,
  | RetainedAppRowHistoryCompactionError
  | RetainedAppRowHistoryCompactionPersistenceError
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
    fxAppRowRevisions,
  ).where(identitySelectionWhere(scopeUuid.scopeUuid, cursor)).orderBy(
    asc(fxAppRowRevisions.tableId),
    asc(fxAppRowRevisions.rowId),
    asc(fxAppRowRevisions.commitSeq),
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
  const root = yield* Effect.fromResult(decodeRevisionResult(
    authority,
    identityRows[0],
  ));
  if (root.prevCommitSeq !== null) {
    return yield* Effect.fail(compactionError(
      authority,
      "storedEvidenceInvalid",
    ));
  }
  const identity = root.identity;

  const anchorQuery = tx.select(revisionSelection()).from(
    fxAppRowRevisions,
  ).where(sql`${identityWhere(scopeUuid.scopeUuid, identity)} and
    ${fxAppRowRevisions.commitSeq} <= ${clock.oldestAvailableCommitSeq}`
  ).orderBy(desc(fxAppRowRevisions.commitSeq)).limit(1).for("update");
  observeDrizzleQuery("anchor", anchorQuery, state.observeQuery);
  const anchorRows = yield* queryEffect("anchor", anchorQuery);
  if (anchorRows.length === 0) {
    if (root.commitSeq <= clock.oldestAvailableCommitSeq) {
      return yield* Effect.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    return advancedResult(authority, clock, root, null, 0);
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
    root,
    anchor,
  ));
  if (
    anchor.commitSeq > clock.oldestAvailableCommitSeq ||
    root.commitSeq > anchor.commitSeq ||
    (anchor.commitSeq === root.commitSeq
      ? anchor.prevCommitSeq !== null
      : anchor.prevCommitSeq === null ||
        anchor.prevCommitSeq < root.commitSeq)
  ) {
    return yield* Effect.fail(compactionError(
      authority,
      "storedEvidenceInvalid",
    ));
  }

  const candidateQuery = tx.select(revisionSelection()).from(
    fxAppRowRevisions,
  ).where(sql`${identityWhere(scopeUuid.scopeUuid, identity)} and
    ${fxAppRowRevisions.commitSeq} > ${root.commitSeq} and
    ${fxAppRowRevisions.commitSeq} < ${anchor.commitSeq}`
  ).orderBy(asc(fxAppRowRevisions.commitSeq)).limit(
    MAX_RETAINED_APP_ROW_HISTORY_PAGE_REVISIONS + 1,
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
    root,
    anchor,
    candidateRows,
  ));
  const deletable = candidates.slice(
    0,
    MAX_RETAINED_APP_ROW_HISTORY_PAGE_REVISIONS,
  );
  if (deletable.length === 0) {
    return advancedResult(authority, clock, root, anchor.commitSeq, 0);
  }

  const deletion = tx.delete(fxAppRowRevisions).where(
    sql`${identityWhere(scopeUuid.scopeUuid, identity)} and ${inArray(
      fxAppRowRevisions.commitSeq,
      deletable.map(revision => revision.commitSeq),
    )}`,
  ).returning({ commitSeq: fxAppRowRevisions.commitSeq });
  observeDrizzleQuery("revisionDeletion", deletion, state.observeQuery);
  const deletedRows = yield* queryEffect("revisionDeletion", deletion);
  yield* Effect.fromResult(requireExactDeletionResult(
    authority,
    deletable,
    deletedRows,
  ));

  const continuation = candidates.length >
      MAX_RETAINED_APP_ROW_HISTORY_PAGE_REVISIONS
    ? exactCursor(identity)
    : afterCursor(identity);
  return Object.freeze({
    status: "compacted" as const,
    disposition: "deleted" as const,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    retainedFloor: clock.oldestAvailableCommitSeq,
    identity,
    rootCommitSeq: root.commitSeq,
    anchorCommitSeq: anchor.commitSeq,
    deletedRevisionCount: deletable.length,
    continuation,
  });
});

interface DecodedRevision {
  readonly identity: RetainedAppRowHistoryIdentity;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
  readonly creationTime: AppCreationTimeV1;
}

function revisionSelection() {
  return {
    tableId: fxAppRowRevisions.tableId,
    rowId: fxAppRowRevisions.rowId,
    commitSeq: fxAppRowRevisions.commitSeq,
    prevCommitSeq: fxAppRowRevisions.prevCommitSeq,
    creationTime: fxAppRowRevisions.creationTime,
    valueCodecVersion: fxAppRowRevisions.valueCodecVersion,
    isTombstone: fxAppRowRevisions.isTombstone,
  } as const;
}

function identitySelectionWhere(
  scopeUuid: ScopeUuidV1,
  cursor: RetainedAppRowHistoryCursor,
): SQL {
  if (cursor.kind === "start") {
    return eq(fxAppRowRevisions.scopeUuid, scopeUuid);
  }
  const exact = identityWhere(scopeUuid, cursor.identity);
  if (cursor.kind === "exact") return exact;
  return sql`${fxAppRowRevisions.scopeUuid} = ${scopeUuid} and (
      ${fxAppRowRevisions.tableId},
      ${fxAppRowRevisions.rowId}
    ) > (
      ${cursor.identity.tableId},
      ${appRowIdHexV1ToBytes(cursor.identity.rowId)}
    )`;
}

function identityWhere(
  scopeUuid: ScopeUuidV1,
  identity: RetainedAppRowHistoryIdentity,
): SQL {
  return sql`${fxAppRowRevisions.scopeUuid} = ${scopeUuid}
    and ${fxAppRowRevisions.tableId} = ${identity.tableId}
    and ${fxAppRowRevisions.rowId} = ${
      appRowIdHexV1ToBytes(identity.rowId)
    }`;
}

function decodeRevisionResult(
  authority: TrustedScopeAuthority,
  row: Readonly<{
    readonly tableId: unknown;
    readonly rowId: unknown;
    readonly commitSeq: unknown;
    readonly prevCommitSeq: unknown;
    readonly creationTime: unknown;
    readonly valueCodecVersion: unknown;
    readonly isTombstone: unknown;
  }>,
): Result.Result<DecodedRevision, RetainedAppRowHistoryCompactionError> {
  return Result.gen(function* () {
    const tableId = yield* decodeTableIdResult(row.tableId).pipe(
      Result.mapError(cause => compactionError(
        authority,
        "storedEvidenceInvalid",
        cause,
      )),
    );
    const rowId = yield* appRowIdHexV1FromBytesResult(row.rowId).pipe(
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
    const creationTime = yield* decodeCreationTimeResult(
      row.creationTime,
    ).pipe(Result.mapError(cause => compactionError(
      authority,
      "storedEvidenceInvalid",
      cause,
    )));
    if (
      row.valueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
      typeof row.isTombstone !== "boolean"
    ) {
      return yield* Result.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    return Object.freeze({
      identity: Object.freeze({ tableId, rowId }),
      commitSeq,
      prevCommitSeq,
      creationTime,
    });
  });
}

function decodeCandidatesResult(
  authority: TrustedScopeAuthority,
  root: DecodedRevision,
  anchor: DecodedRevision,
  rows: ReadonlyArray<Parameters<typeof decodeRevisionResult>[1]>,
): Result.Result<
  ReadonlyArray<DecodedRevision>,
  RetainedAppRowHistoryCompactionError
> {
  return Result.gen(function* () {
    if (rows.length > MAX_RETAINED_APP_ROW_HISTORY_PAGE_REVISIONS + 1) {
      return yield* Result.fail(compactionError(
        authority,
        "storedEvidenceInvalid",
      ));
    }
    const candidates: DecodedRevision[] = [];
    for (const row of rows) {
      const candidate = yield* decodeRevisionResult(authority, row);
      yield* requireSameIdentityEvidenceResult(authority, anchor, candidate);
      if (
        candidate.commitSeq >= anchor.commitSeq ||
        candidate.prevCommitSeq === null ||
        candidate.prevCommitSeq < root.commitSeq ||
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
      candidates.length <= MAX_RETAINED_APP_ROW_HISTORY_PAGE_REVISIONS &&
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
): Result.Result<void, RetainedAppRowHistoryCompactionError> {
  return expected.identity.tableId === actual.identity.tableId &&
      expected.identity.rowId === actual.identity.rowId &&
      expected.creationTime === actual.creationTime
    ? Result.succeed(undefined)
    : Result.fail(compactionError(authority, "storedEvidenceInvalid"));
}

function requireExactDeletionResult(
  authority: TrustedScopeAuthority,
  expected: ReadonlyArray<DecodedRevision>,
  actual: ReadonlyArray<Readonly<{ readonly commitSeq: unknown }>>,
): Result.Result<void, RetainedAppRowHistoryCompactionError> {
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
  root: DecodedRevision,
  anchorCommitSeq: CommitSeq | null,
  deletedRevisionCount: number,
): RetainedAppRowHistoryCompactionResult {
  return Object.freeze({
    status: "compacted" as const,
    disposition: deletedRevisionCount === 0
      ? "advanced" as const
      : "deleted" as const,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    retainedFloor: clock.oldestAvailableCommitSeq,
    identity: root.identity,
    rootCommitSeq: root.commitSeq,
    anchorCommitSeq,
    deletedRevisionCount,
    continuation: afterCursor(root.identity),
  });
}

function afterCursor(
  identity: RetainedAppRowHistoryIdentity,
): RetainedAppRowHistoryCursor {
  return Object.freeze({ kind: "after" as const, identity });
}

function exactCursor(
  identity: RetainedAppRowHistoryIdentity,
): RetainedAppRowHistoryCursor {
  return Object.freeze({ kind: "exact" as const, identity });
}

function requireExactAuthority(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): Effect.Effect<void, RetainedAppRowHistoryCompactionError> {
  return clock.storageGeneration === "flarexdb_v1" &&
      clock.storageGeneration === authority.storageGeneration &&
      clock.storageGenerationFence === authority.storageGenerationFence &&
      clock.epoch === authority.epoch
    ? Effect.void
    : Effect.fail(compactionError(authority, "staleAuthority"));
}

function queryEffect<Value>(
  operation: RetainedAppRowHistoryCompactionPersistenceError["operation"],
  query: PromiseLike<Value>,
): Effect.Effect<Value, RetainedAppRowHistoryCompactionPersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: cause => new RetainedAppRowHistoryCompactionPersistenceError({
      operation,
      cause,
    }),
  }));
}

function compactionError(
  authority: TrustedScopeAuthority,
  reason: RetainedAppRowHistoryCompactionError["reason"],
  cause?: unknown,
): RetainedAppRowHistoryCompactionError {
  return new RetainedAppRowHistoryCompactionError({
    reason,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    cause,
  });
}
