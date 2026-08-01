import { bytesEqualFullScan, copyBytes } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result, Schema } from "effect";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  appRowIdHexV1FromBytes,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogIndexDefinitionIdSchema,
  type CatalogIndexDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import type { IndexBuildStateRecord } from "./indexBuildStates";
import {
  encodeAppOrderedIndexKeyV1,
  orderedIndexCreationTimeV1,
  orderedIndexRowIdHexV1FromBytesResult,
  type OrderedIndexKeyHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import {
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeId,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import {
  appendBackfilledLiveAppIndexEntryRevisionInTransactionEffect,
  readCurrentAppIndexEntriesForRowInTransactionEffect,
  type AppendAppIndexEntryRevisionV1Error,
  type AppIndexEntryTransaction,
  type ReadAppIndexRangeV1Error,
} from "./appIndexEntries";
import {
  locateAppCreationTimeIndexDefinitionForTableEffect,
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
  type ReadAppIndexDefinitionError,
} from "./appIndexDefinitions";
import type { AppRowTransaction } from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  decodeIndexBuildStateRowResult,
  IndexBuildStateCorruptionError,
} from "./indexBuildStates";
import {
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForUpdateError,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  fxAppIndexEntryCurrent,
  fxAppIndexEntryRevisions,
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemIndexBuildStates,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const INPUT_KEYS = Object.freeze([
  "deploymentId",
  "indexDefinitionId",
  "pageSize",
] as const);
export const MAX_INTRINSIC_INDEX_BUILD_PAGE_SIZE_V1 = 16;

const decodeDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogIndexDefinitionIdSchema),
);

export interface LocateIntrinsicCreationTimeIndexV1Input {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly tableId: CatalogTableId;
}

export interface IntrinsicCreationTimeIndexDefinitionPortV1 {
  readonly locate: (
    input: LocateIntrinsicCreationTimeIndexV1Input,
  ) => Effect.Effect<
    LocatedAppIndexDefinitionV1 | null,
    ReadAppIndexDefinitionError
  >;
}

/** Control-catalog adapter used by the private C08 point-commit composition. */
export function createIntrinsicCreationTimeIndexDefinitionPortV1(
  controlDb: FlarexMetadataDatabase,
): IntrinsicCreationTimeIndexDefinitionPortV1 {
  return Object.freeze({
    locate: Effect.fn("IntrinsicCreationTimeIndexDefinition.locate")(
      (input: LocateIntrinsicCreationTimeIndexV1Input) =>
        locateAppCreationTimeIndexDefinitionForTableEffect(
          controlDb,
          input.deploymentId,
          input.scopeId,
          input.tableId,
        ),
    ),
  });
}

export interface BuildIntrinsicCreationTimeIndexV1Input {
  readonly deploymentId: string;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly pageSize: number;
}

export interface LocatedIntrinsicCreationTimeIndexBuildTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {}

export interface IntrinsicCreationTimeIndexBuildPortsV1 {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedIntrinsicCreationTimeIndexBuildTargetV1
  >;
}

export type IntrinsicCreationTimeIndexBuildFaultPointV1 =
  | "afterLifecycleTransition"
  | "afterEntryWrite"
  | "beforeEnable";

export interface IntrinsicCreationTimeIndexBuildOptionsV1 {
  readonly faultAfter?: (
    point: IntrinsicCreationTimeIndexBuildFaultPointV1,
    rowId: OrderedIndexRowIdHexV1 | null,
  ) => void;
}

export interface IntrinsicCreationTimeIndexBuildResultV1 {
  readonly status: "advanced" | "enabled" | "replayed";
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly lifecycle:
    | "building"
    | "backfilling"
    | "validating"
    | "enabled";
  readonly processedRows: number;
  readonly replayedRows: number;
  readonly cursorRowId: OrderedIndexRowIdHexV1 | null;
}

export class InvalidIntrinsicCreationTimeIndexBuildInputV1Error
  extends Data.TaggedError(
    "InvalidIntrinsicCreationTimeIndexBuildInputV1Error",
  )<{
    readonly reason:
      | "invalidInputShape"
      | "invalidDeploymentId"
      | "invalidIndexDefinitionId"
      | "invalidPageSize";
  }> {}

export class IntrinsicCreationTimeIndexDefinitionUnavailableV1Error
  extends Data.TaggedError(
    "IntrinsicCreationTimeIndexDefinitionUnavailableV1Error",
  )<{
    readonly deploymentId: string;
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly reason: "missing" | "notCreationTime";
  }> {}

export class IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error
  extends Data.TaggedError(
    "IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly reason:
      | "storageGeneration"
      | "storageGenerationFence"
      | "epoch";
  }> {}

export class IntrinsicCreationTimeIndexBuildStateV1Error
  extends Data.TaggedError("IntrinsicCreationTimeIndexBuildStateV1Error")<{
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly reason:
      | "buildMissing"
      | "unsupportedLifecycle"
      | "concurrentStateChange"
      | "currentContentsMismatch"
      | "indexHistoryMismatch";
    readonly detail?: string;
  }> {}

export class IntrinsicCreationTimeIndexBuildIntegrationV1Error
  extends Data.TaggedError(
    "IntrinsicCreationTimeIndexBuildIntegrationV1Error",
  )<{
    readonly phase: "targetTransaction";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export class IntrinsicCreationTimeIndexBuildDecisionUncertainV1Error
  extends Data.TaggedError(
    "IntrinsicCreationTimeIndexBuildDecisionUncertainV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly cause: unknown;
  }> {}

export type BuildIntrinsicCreationTimeIndexV1Error =
  | InvalidIntrinsicCreationTimeIndexBuildInputV1Error
  | IntrinsicCreationTimeIndexDefinitionUnavailableV1Error
  | IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error
  | IntrinsicCreationTimeIndexBuildStateV1Error
  | IntrinsicCreationTimeIndexBuildIntegrationV1Error
  | IntrinsicCreationTimeIndexBuildDecisionUncertainV1Error
  | ReadAppIndexDefinitionError
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | AppendAppIndexEntryRevisionV1Error
  | ReadAppIndexRangeV1Error;

type BuildTransactionErrorV1 =
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error
  | IntrinsicCreationTimeIndexBuildStateV1Error
  | IntrinsicCreationTimeIndexBuildIntegrationV1Error
  | AppendAppIndexEntryRevisionV1Error
  | ReadAppIndexRangeV1Error;

interface DecodedBuildInputV1 {
  readonly deploymentId: string;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly pageSize: number;
}

interface CurrentAppRowV1 {
  readonly rowId: AppRowIdHexV1;
  readonly commitSeq: CommitSeq;
  readonly creationTime: AppCreationTimeV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
}

export const buildIntrinsicCreationTimeIndexV1Effect = Effect.fn(
  "IntrinsicCreationTimeIndexBuild.buildOneStep",
)(function* (
  ports: IntrinsicCreationTimeIndexBuildPortsV1,
  input: unknown,
  options: IntrinsicCreationTimeIndexBuildOptionsV1 = {},
): Effect.fn.Return<
  IntrinsicCreationTimeIndexBuildResultV1,
  BuildIntrinsicCreationTimeIndexV1Error
> {
  const decoded = yield* Effect.fromResult(decodeBuildInputResult(input));
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    decoded.deploymentId,
    ports.authority,
  );
  const definition = yield* locateAppIndexDefinitionByIdEffect(
    ports.controlDb,
    located.authority.scopeId,
    decoded.indexDefinitionId,
  );
  if (definition === null) {
    return yield* Effect.fail(
      new IntrinsicCreationTimeIndexDefinitionUnavailableV1Error({
        deploymentId: decoded.deploymentId,
        scopeId: located.authority.scopeId,
        indexDefinitionId: decoded.indexDefinitionId,
        reason: "missing",
      }),
    );
  }
  if (
    definition.deploymentId !== decoded.deploymentId ||
    definition.access.kind !== "by_creation_time"
  ) {
    return yield* Effect.fail(
      new IntrinsicCreationTimeIndexDefinitionUnavailableV1Error({
        deploymentId: decoded.deploymentId,
        scopeId: located.authority.scopeId,
        indexDefinitionId: decoded.indexDefinitionId,
        reason: "notCreationTime",
      }),
    );
  }
  return yield* runBuildTransaction(
    located.target,
    located.authority,
    definition,
    decoded.pageSize,
    options,
  );
});

function decodeBuildInputResult(
  input: unknown,
): Result.Result<
  DecodedBuildInputV1,
  InvalidIntrinsicCreationTimeIndexBuildInputV1Error
> {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, INPUT_KEYS)) {
      return yield* Result.fail(
        new InvalidIntrinsicCreationTimeIndexBuildInputV1Error({
          reason: "invalidInputShape",
        }),
      );
    }
    if (
      typeof input.deploymentId !== "string" ||
      input.deploymentId.trim().length === 0
    ) {
      return yield* Result.fail(
        new InvalidIntrinsicCreationTimeIndexBuildInputV1Error({
          reason: "invalidDeploymentId",
        }),
      );
    }
    const indexDefinitionId = yield* decodeDefinitionIdResult(
      input.indexDefinitionId,
    ).pipe(Result.mapError(() =>
      new InvalidIntrinsicCreationTimeIndexBuildInputV1Error({
        reason: "invalidIndexDefinitionId",
      })
    ));
    if (
      !isPositiveSafeInteger(input.pageSize) ||
      input.pageSize > MAX_INTRINSIC_INDEX_BUILD_PAGE_SIZE_V1
    ) {
      return yield* Result.fail(
        new InvalidIntrinsicCreationTimeIndexBuildInputV1Error({
          reason: "invalidPageSize",
        }),
      );
    }
    return Object.freeze({
      deploymentId: input.deploymentId,
      indexDefinitionId,
      pageSize: input.pageSize,
    });
  });
}

const runBuildTransaction = Effect.fn(
  "IntrinsicCreationTimeIndexBuild.runTransaction",
)(function* (
  target: LocatedIntrinsicCreationTimeIndexBuildTargetV1,
  authority: TrustedScopeAuthority,
  definition: LocatedAppIndexDefinitionV1,
  pageSize: number,
  options: IntrinsicCreationTimeIndexBuildOptionsV1,
): Effect.fn.Return<
  IntrinsicCreationTimeIndexBuildResultV1,
  Exclude<BuildIntrinsicCreationTimeIndexV1Error,
    | InvalidIntrinsicCreationTimeIndexBuildInputV1Error
    | IntrinsicCreationTimeIndexDefinitionUnavailableV1Error
    | ReadAppIndexDefinitionError
    | TrustedScopeAuthorityError>
> {
  const started = startIntrinsicCreationTimeIndexBuildTransaction(
    target,
    (tx) => buildInTransaction(
      tx,
      authority,
      definition,
      pageSize,
      options,
    ),
  );
  const exit = yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => started.promise,
    catch: (cause) => cause,
  })));
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.findErrorOption(exit.cause);
  if (failure._tag === "None") return yield* Effect.die(exit.cause);
  const cause = failure.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(callbackCause);
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain"
  ) {
    return yield* Effect.fail(
      new IntrinsicCreationTimeIndexBuildDecisionUncertainV1Error({
        scopeId: authority.scopeId,
        indexDefinitionId: definition.indexDefinitionId,
        cause,
      }),
    );
  }
  return yield* Effect.fail(
    new IntrinsicCreationTimeIndexBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: cause instanceof LocatedReadCommittedTransactionFailureV1,
      cause,
    }),
  );
});

interface StartedIntrinsicCreationTimeIndexBuildTransactionV1 {
  readonly promise: Promise<IntrinsicCreationTimeIndexBuildResultV1>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<BuildTransactionErrorV1> |
    undefined;
}

/** The single audited Effect runtime bridge for this driver callback owner. */
function startIntrinsicCreationTimeIndexBuildTransaction(
  target: LocatedIntrinsicCreationTimeIndexBuildTargetV1,
  work: (
    tx: AppRowTransaction,
  ) => Effect.Effect<
    IntrinsicCreationTimeIndexBuildResultV1,
    BuildTransactionErrorV1
  >,
): StartedIntrinsicCreationTimeIndexBuildTransactionV1 {
  let observedCause: Cause.Cause<BuildTransactionErrorV1> | undefined;
  const rollbackSignal = new Error("C08-I1 intrinsic index step rolled back.");
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const exit = await Effect.runPromise(Effect.exit(work(tx)));
    if (Exit.isFailure(exit)) {
      observedCause = exit.cause;
      throw rollbackSignal;
    }
    return exit.value;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => observedCause,
  });
}

const buildInTransaction = Effect.fn(
  "IntrinsicCreationTimeIndexBuild.buildInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  definition: LocatedAppIndexDefinitionV1,
  pageSize: number,
  options: IntrinsicCreationTimeIndexBuildOptionsV1,
): Effect.fn.Return<
  IntrinsicCreationTimeIndexBuildResultV1,
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error
  | IntrinsicCreationTimeIndexBuildStateV1Error
  | IntrinsicCreationTimeIndexBuildIntegrationV1Error
  | AppendAppIndexEntryRevisionV1Error
  | ReadAppIndexRangeV1Error
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireAuthorityResult(
    authority,
    definition.indexDefinitionId,
    clock,
  ));
  const scopeUuid = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId),
  ).pipe(Effect.mapError((cause) =>
    new IntrinsicCreationTimeIndexBuildStateV1Error({
      scopeId: authority.scopeId,
      indexDefinitionId: definition.indexDefinitionId,
      reason: "indexHistoryMismatch",
      detail: String(cause),
    })
  ));
  const rows = yield* queryEffect(
    tx.select().from(fxSystemIndexBuildStates).where(and(
      eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
      eq(
        fxSystemIndexBuildStates.indexDefinitionId,
        definition.indexDefinitionId,
      ),
    )).limit(1).for("update"),
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* Effect.fail(new IntrinsicCreationTimeIndexBuildStateV1Error({
      scopeId: authority.scopeId,
      indexDefinitionId: definition.indexDefinitionId,
      reason: "buildMissing",
    }));
  }
  const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(
    row,
    authority.scopeId,
    definition.indexDefinitionId,
  ));
  yield* Effect.fromResult(requireBuildAuthorityResult(state, authority));
  if (state.startCommitSeq > clock.lastCommitSeq) {
    return yield* Effect.fail(new IndexBuildStateCorruptionError(
      authority.scopeId,
      definition.indexDefinitionId,
      `start commit sequence ${state.startCommitSeq} is ahead of scope clock ${clock.lastCommitSeq}`,
    ));
  }
  switch (state.lifecycle) {
    case "declared":
      yield* transitionLifecycle(
        tx,
        state,
        "building",
        null,
        options,
      );
      return result(state, "advanced", "building", 0, 0, null);
    case "building":
      yield* transitionLifecycle(
        tx,
        state,
        "backfilling",
        null,
        options,
      );
      return result(state, "advanced", "backfilling", 0, 0, null);
    case "backfilling":
      return yield* backfillPage(
        tx,
        scopeUuid.scopeUuid,
        state,
        definition,
        pageSize,
        options,
      );
    case "validating":
      return yield* validateAndEnable(
        tx,
        scopeUuid.scopeUuid,
        state,
        definition,
        pageSize,
        options,
      );
    case "enabled":
      return result(state, "replayed", "enabled", 0, 0, null);
    case "retiring":
      return yield* Effect.fail(new IntrinsicCreationTimeIndexBuildStateV1Error({
        scopeId: state.scopeId,
        indexDefinitionId: state.indexDefinitionId,
        reason: "unsupportedLifecycle",
      }));
  }
});

const backfillPage = Effect.fn(
  "IntrinsicCreationTimeIndexBuild.backfillPage",
)(function* (
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  state: IndexBuildStateRecord,
  definition: LocatedAppIndexDefinitionV1,
  pageSize: number,
  options: IntrinsicCreationTimeIndexBuildOptionsV1,
): Effect.fn.Return<
  IntrinsicCreationTimeIndexBuildResultV1,
  | IntrinsicCreationTimeIndexBuildIntegrationV1Error
  | IntrinsicCreationTimeIndexBuildStateV1Error
  | AppendAppIndexEntryRevisionV1Error
> {
  const cursor = state.backfillCursor.afterRowId;
  const cursorBytes = cursor === null ? null : Buffer.from(cursor, "hex");
  const candidates = yield* queryEffect(
    tx.selectDistinctOn([fxAppRowRevisions.rowId], {
      rowId: fxAppRowRevisions.rowId,
      commitSeq: fxAppRowRevisions.commitSeq,
    }).from(fxAppRowRevisions).where(and(
      eq(fxAppRowRevisions.scopeUuid, scopeUuid),
      eq(fxAppRowRevisions.tableId, definition.access.tableId),
      lte(fxAppRowRevisions.commitSeq, state.startCommitSeq),
      ...(cursorBytes === null
        ? []
        : [gt(fxAppRowRevisions.rowId, cursorBytes)]),
    )).orderBy(
      asc(fxAppRowRevisions.rowId),
      desc(fxAppRowRevisions.commitSeq),
    ).limit(pageSize + 1),
  );
  const page = candidates.slice(0, pageSize);
  let written = 0;
  let replayed = 0;
  let lastRowId: OrderedIndexRowIdHexV1 | null = cursor;
  for (const candidate of page) {
    const rowId = yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(candidate.rowId),
    ).pipe(Effect.mapError((cause) =>
      new IntrinsicCreationTimeIndexBuildStateV1Error({
        scopeId: state.scopeId,
        indexDefinitionId: state.indexDefinitionId,
        reason: "indexHistoryMismatch",
        detail: String(cause),
      })
    ));
    lastRowId = rowId;
    const current = yield* loadCurrentAppRow(tx, scopeUuid, definition, rowId);
    if (current === null) continue;
    const disposition = yield* ensureCurrentIndexEntry(
      tx,
      scopeUuid,
      state,
      definition,
      current,
    );
    if (disposition === "written") {
      written += 1;
      yield* runFault(options, "afterEntryWrite", rowId);
    } else {
      replayed += 1;
    }
  }
  const isDone = candidates.length <= pageSize;
  const lifecycle = isDone ? "validating" as const : "backfilling" as const;
  const nextCursor = isDone ? null : lastRowId;
  yield* transitionLifecycle(tx, state, lifecycle, nextCursor, options);
  return result(
    state,
    "advanced",
    lifecycle,
    written,
    replayed,
    nextCursor,
  );
});

const validateAndEnable = Effect.fn(
  "IntrinsicCreationTimeIndexBuild.validateAndEnable",
)(function* (
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  state: IndexBuildStateRecord,
  definition: LocatedAppIndexDefinitionV1,
  pageSize: number,
  options: IntrinsicCreationTimeIndexBuildOptionsV1,
): Effect.fn.Return<
  IntrinsicCreationTimeIndexBuildResultV1,
  | IntrinsicCreationTimeIndexBuildIntegrationV1Error
  | IntrinsicCreationTimeIndexBuildStateV1Error
  | ReadAppIndexRangeV1Error
> {
  const cursor = state.backfillCursor.afterRowId;
  const cursorBytes = cursor === null ? null : Buffer.from(cursor, "hex");
  const expectedRowIds = yield* queryEffect(
    tx.select({ rowId: fxAppRowCurrent.rowId }).from(fxAppRowCurrent).where(and(
      eq(fxAppRowCurrent.scopeUuid, scopeUuid),
      eq(fxAppRowCurrent.tableId, definition.access.tableId),
      ...(cursorBytes === null
        ? []
        : [gt(fxAppRowCurrent.rowId, cursorBytes)]),
    )).orderBy(asc(fxAppRowCurrent.rowId)).limit(pageSize + 1),
  );
  const indexRowIds = yield* queryEffect(
    tx.selectDistinct({ rowId: fxAppIndexEntryCurrent.rowId })
      .from(fxAppIndexEntryCurrent).where(and(
        eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid),
        eq(
          fxAppIndexEntryCurrent.indexDefinitionId,
          definition.indexDefinitionId,
        ),
        ...(cursorBytes === null
          ? []
          : [gt(fxAppIndexEntryCurrent.rowId, cursorBytes)]),
      )).orderBy(asc(fxAppIndexEntryCurrent.rowId)).limit(pageSize + 1),
  );
  const observedRowIds: OrderedIndexRowIdHexV1[] = [];
  for (const observed of [...expectedRowIds, ...indexRowIds]) {
    observedRowIds.push(yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(observed.rowId),
    ).pipe(Effect.mapError((cause) =>
      new IntrinsicCreationTimeIndexBuildStateV1Error({
        scopeId: state.scopeId,
        indexDefinitionId: state.indexDefinitionId,
        reason: "indexHistoryMismatch",
        detail: String(cause),
      })
    )));
  }
  const mergedRowIds = [...new Set(observedRowIds)].sort();
  const page = mergedRowIds.slice(0, pageSize);
  let lastRowId: OrderedIndexRowIdHexV1 | null = cursor;
  for (let index = 0; index < page.length; index += 1) {
    const rowId = page[index]!;
    lastRowId = rowId;
    const expectedRow = yield* loadCurrentAppRow(
      tx,
      scopeUuid,
      definition,
      rowId,
    );
    const actualRows = yield* readCurrentAppIndexEntriesForRowInTransactionEffect(
      tx,
      { scopeId: state.scopeId, definition, rowId },
    );
    if (expectedRow === null) {
      if (actualRows.length !== 0) {
        return yield* mismatch(
          state,
          `index-only row ${index} has ${actualRows.length} current entries`,
        );
      }
      continue;
    }
    if (actualRows.length !== 1) {
      return yield* mismatch(
        state,
        `current row ${index} has ${actualRows.length} index entries`,
      );
    }
    const actualRow = actualRows[0]!;
    const encodedKey = creationTimeKey(definition, expectedRow.creationTime);
    if (
      rowId !== actualRow.rowId ||
      expectedRow.commitSeq !== actualRow.commitSeq ||
      expectedRow.writeEpochUuid !== actualRow.writeEpochUuid ||
      actualRow.tableId !== definition.access.tableId ||
      actualRow.encodedKey !== encodedKey ||
      !bytesEqualFullScan(
        actualRow.physicalSpecSha256,
        Buffer.from(definition.physicalSpecSha256Hex, "hex"),
      )
    ) {
      return yield* mismatch(state, `current row ${index} is inconsistent`);
    }
  }
  const hasMore = expectedRowIds.length > pageSize ||
    indexRowIds.length > pageSize ||
    mergedRowIds.length > pageSize;
  if (hasMore) {
    yield* transitionLifecycle(
      tx,
      state,
      "validating",
      lastRowId,
      options,
    );
    return result(
      state,
      "advanced",
      "validating",
      page.length,
      0,
      lastRowId,
    );
  }
  yield* runFault(options, "beforeEnable", null);
  yield* transitionLifecycle(tx, state, "enabled", null, options);
  return result(state, "enabled", "enabled", page.length, 0, null);
});

function loadCurrentAppRow(
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  definition: LocatedAppIndexDefinitionV1,
  rowId: OrderedIndexRowIdHexV1,
): Effect.Effect<
  CurrentAppRowV1 | null,
  IntrinsicCreationTimeIndexBuildIntegrationV1Error
> {
  const rowIdBytes = Buffer.from(rowId, "hex");
  return queryEffect(
    tx.select({
      rowId: fxAppRowRevisions.rowId,
      commitSeq: fxAppRowRevisions.commitSeq,
      creationTime: fxAppRowRevisions.creationTime,
      writeEpochUuid: fxAppRowRevisions.writeEpochUuid,
    }).from(fxAppRowCurrent).innerJoin(fxAppRowRevisions, and(
      eq(fxAppRowRevisions.scopeUuid, fxAppRowCurrent.scopeUuid),
      eq(fxAppRowRevisions.tableId, fxAppRowCurrent.tableId),
      eq(fxAppRowRevisions.rowId, fxAppRowCurrent.rowId),
      eq(fxAppRowRevisions.commitSeq, fxAppRowCurrent.commitSeq),
    )).where(and(
      eq(fxAppRowCurrent.scopeUuid, scopeUuid),
      eq(fxAppRowCurrent.tableId, definition.access.tableId),
      eq(fxAppRowCurrent.rowId, rowIdBytes),
      eq(fxAppRowRevisions.isTombstone, false),
    )).limit(1),
  ).pipe(Effect.map((rows) => {
    const row = rows[0];
    return row === undefined
      ? null
      : Object.freeze({
        rowId: appRowIdHexV1FromBytes(copyBytes(row.rowId)),
        commitSeq: row.commitSeq,
        creationTime: row.creationTime,
        writeEpochUuid: row.writeEpochUuid,
      });
  }));
}

const ensureCurrentIndexEntry = Effect.fn(
  "IntrinsicCreationTimeIndexBuild.ensureCurrentEntry",
)(function* (
  tx: AppIndexEntryTransaction,
  scopeUuid: ScopeUuidV1,
  state: IndexBuildStateRecord,
  definition: LocatedAppIndexDefinitionV1,
  current: CurrentAppRowV1,
): Effect.fn.Return<
  "written" | "replayed",
  | IntrinsicCreationTimeIndexBuildIntegrationV1Error
  | IntrinsicCreationTimeIndexBuildStateV1Error
  | AppendAppIndexEntryRevisionV1Error
> {
  const encodedKey = creationTimeKey(definition, current.creationTime);
  const rowId = yield* Effect.fromResult(
    orderedIndexRowIdHexV1FromBytesResult(Buffer.from(current.rowId, "hex")),
  ).pipe(Effect.mapError((cause) =>
    new IntrinsicCreationTimeIndexBuildStateV1Error({
      scopeId: state.scopeId,
      indexDefinitionId: state.indexDefinitionId,
      reason: "indexHistoryMismatch",
      detail: String(cause),
    })
  ));
  const keyBytes = Buffer.from(encodedKey, "hex");
  const rowIdBytes = Buffer.from(rowId, "hex");
  const heads = yield* queryEffect(
    tx.select({
      commitSeq: fxAppIndexEntryRevisions.commitSeq,
      isTombstone: fxAppIndexEntryRevisions.isTombstone,
      encodedKey: fxAppIndexEntryRevisions.encodedKey,
      tableId: fxAppIndexEntryRevisions.tableId,
    }).from(fxAppIndexEntryRevisions).where(and(
      eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid),
      eq(
        fxAppIndexEntryRevisions.indexDefinitionId,
        definition.indexDefinitionId,
      ),
      eq(fxAppIndexEntryRevisions.encodedKey, keyBytes),
      eq(fxAppIndexEntryRevisions.rowId, rowIdBytes),
    )).orderBy(desc(fxAppIndexEntryRevisions.commitSeq)).limit(1),
  );
  const head = heads[0];
  if (head !== undefined && head.commitSeq === current.commitSeq) {
    if (
      head.isTombstone ||
      head.tableId !== definition.access.tableId ||
      !bytesEqualFullScan(head.encodedKey, keyBytes)
    ) {
      return yield* mismatch(state, "matching revision is contradictory");
    }
    const pointers = yield* queryEffect(
      tx.select({ commitSeq: fxAppIndexEntryCurrent.commitSeq })
        .from(fxAppIndexEntryCurrent).where(and(
          eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid),
          eq(
            fxAppIndexEntryCurrent.indexDefinitionId,
            definition.indexDefinitionId,
          ),
          eq(fxAppIndexEntryCurrent.encodedKey, keyBytes),
          eq(fxAppIndexEntryCurrent.rowId, rowIdBytes),
        )).limit(1),
    );
    if (pointers[0]?.commitSeq !== current.commitSeq) {
      return yield* mismatch(state, "matching revision has no exact current pointer");
    }
    return "replayed";
  }
  if (head !== undefined && head.commitSeq > current.commitSeq) {
    return yield* mismatch(state, "index history is ahead of the current row");
  }
  yield* appendBackfilledLiveAppIndexEntryRevisionInTransactionEffect(tx, {
    scopeId: state.scopeId,
    scopeUuid,
    definition,
    encodedKey,
    rowId,
    writeEpochUuid: current.writeEpochUuid,
    commitSeq: current.commitSeq,
    prevCommitSeq: head?.commitSeq ?? null,
  });
  return "written";
});

function creationTimeKey(
  definition: LocatedAppIndexDefinitionV1,
  creationTime: AppCreationTimeV1,
): OrderedIndexKeyHexV1 {
  return encodeAppOrderedIndexKeyV1({
    spec: definition.physicalSpec,
    values: [orderedIndexCreationTimeV1(creationTime)],
  });
}

function transitionLifecycle(
  tx: AppRowTransaction,
  state: IndexBuildStateRecord,
  lifecycle: "building" | "backfilling" | "validating" | "enabled",
  cursorRowId: OrderedIndexRowIdHexV1 | null,
  options: IntrinsicCreationTimeIndexBuildOptionsV1,
): Effect.Effect<
  void,
  | IntrinsicCreationTimeIndexBuildIntegrationV1Error
  | IntrinsicCreationTimeIndexBuildStateV1Error
> {
  return Effect.gen(function* () {
    const updated = yield* queryEffect(
      tx.update(fxSystemIndexBuildStates).set({
        lifecycle,
        backfillCursorRowId:
          cursorRowId === null ? null : Buffer.from(cursorRowId, "hex"),
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(fxSystemIndexBuildStates.scopeId, state.scopeId),
        eq(
          fxSystemIndexBuildStates.indexDefinitionId,
          state.indexDefinitionId,
        ),
        eq(fxSystemIndexBuildStates.storageGenerationFence,
          state.storageGenerationFence),
        eq(fxSystemIndexBuildStates.epoch, state.epoch),
        eq(fxSystemIndexBuildStates.attemptFence, state.attemptFence),
        eq(fxSystemIndexBuildStates.lifecycle, state.lifecycle),
      )).returning({
        indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId,
      }),
    );
    if (updated.length !== 1) {
      return yield* Effect.fail(
        new IntrinsicCreationTimeIndexBuildStateV1Error({
          scopeId: state.scopeId,
          indexDefinitionId: state.indexDefinitionId,
          reason: "concurrentStateChange",
        }),
      );
    }
    yield* runFault(options, "afterLifecycleTransition", cursorRowId);
  });
}

function runFault(
  options: IntrinsicCreationTimeIndexBuildOptionsV1,
  point: IntrinsicCreationTimeIndexBuildFaultPointV1,
  rowId: OrderedIndexRowIdHexV1 | null,
): Effect.Effect<void, IntrinsicCreationTimeIndexBuildIntegrationV1Error> {
  return options.faultAfter === undefined
    ? Effect.void
    : Effect.try({
      try: () => options.faultAfter?.(point, rowId),
      catch: (cause) => new IntrinsicCreationTimeIndexBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
    });
}

function result(
  state: IndexBuildStateRecord,
  status: IntrinsicCreationTimeIndexBuildResultV1["status"],
  lifecycle: IntrinsicCreationTimeIndexBuildResultV1["lifecycle"],
  processedRows: number,
  replayedRows: number,
  cursorRowId: OrderedIndexRowIdHexV1 | null,
): IntrinsicCreationTimeIndexBuildResultV1 {
  return Object.freeze({
    status,
    scopeId: state.scopeId,
    indexDefinitionId: state.indexDefinitionId,
    lifecycle,
    processedRows,
    replayedRows,
    cursorRowId,
  });
}

function mismatch(
  state: IndexBuildStateRecord,
  detail: string,
): Effect.Effect<never, IntrinsicCreationTimeIndexBuildStateV1Error> {
  return Effect.fail(new IntrinsicCreationTimeIndexBuildStateV1Error({
    scopeId: state.scopeId,
    indexDefinitionId: state.indexDefinitionId,
    reason: "currentContentsMismatch",
    detail,
  }));
}

function requireAuthorityResult(
  expected: TrustedScopeAuthority,
  indexDefinitionId: CatalogIndexDefinitionId,
  current: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: bigint;
    readonly epoch: string;
  },
): Result.Result<void, IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error> {
  for (const reason of [
    "storageGeneration",
    "storageGenerationFence",
    "epoch",
  ] as const) {
    if (current[reason] !== expected[reason]) {
      return Result.fail(
        new IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error({
          scopeId: expected.scopeId,
          indexDefinitionId,
          reason,
        }),
      );
    }
  }
  return Result.succeed(undefined);
}

function requireBuildAuthorityResult(
  state: IndexBuildStateRecord,
  authority: TrustedScopeAuthority,
): Result.Result<void, IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error> {
  return requireAuthorityResult(authority, state.indexDefinitionId, state);
}

function queryEffect<Value>(
  query: PromiseLike<Value>,
): Effect.Effect<Value, IntrinsicCreationTimeIndexBuildIntegrationV1Error> {
  return Effect.tryPromise({
    try: () => query,
    catch: (cause) => new IntrinsicCreationTimeIndexBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }),
  });
}
