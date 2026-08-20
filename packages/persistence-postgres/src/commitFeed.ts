import { bytesEqual, copyBytes } from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { and, asc, eq, gt, gte, lte } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";

import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  CommitSeqSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeUuidV1Schema,
  type CommitSeq,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import type { FlarexMetadataDatabase } from "./deployments";
import { detachDriverRows } from "./detachDriverRows";
import {
  fxAppRowRevisions,
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "./schema";

const decodeScopeUuidV1Result = Schema.decodeUnknownResult(ScopeUuidV1Schema);

export const MAX_COMMIT_FEED_PAGE_COMMITS_V1 = 100;
export const MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1 = 16_000;

export type CommitFeedInputFailureReasonV1 =
  | "scopeUuidInvalid"
  | "exclusiveCommitSeqInvalid"
  | "cursorAheadOfClock";

export type CommitFeedCorruptionReasonV1 =
  | "scopeClockDuplicate"
  | "scopeClockInvalid"
  | "commitHeaderInvalid"
  | "commitHeaderGap"
  | "commitHeaderPastClock"
  | "commitHeaderMissingBeforeClock"
  | "appRowChangeCountMismatch"
  | "appRowChangeInvalid"
  | "appRowChangeOrdinalGap"
  | "appRowChangeHeaderMismatch"
  | "appRowChangeRevisionMismatch";

export class CommitFeedInputErrorV1 extends Data.TaggedError(
  "CommitFeedInputErrorV1",
)<{
  readonly reason: CommitFeedInputFailureReasonV1;
}> {}

export class CommitFeedScopeNotFoundErrorV1 extends Data.TaggedError(
  "CommitFeedScopeNotFoundErrorV1",
)<{
  readonly scopeUuid: ScopeUuidV1;
}> {}

export class CommitFeedCursorResetRequiredErrorV1 extends Data.TaggedError(
  "CommitFeedCursorResetRequiredErrorV1",
)<{
  readonly scopeUuid: ScopeUuidV1;
  readonly requestedExclusiveCommitSeq: CommitSeq;
  readonly restartExclusiveCommitSeq: CommitSeq;
  readonly observedOldestAvailableCommitSeq: CommitSeq;
}> {}

export class CommitFeedCorruptionErrorV1 extends Data.TaggedError(
  "CommitFeedCorruptionErrorV1",
)<{
  readonly reason: CommitFeedCorruptionReasonV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly commitSeq?: CommitSeq;
}> {}

export class CommitFeedSqlErrorV1 extends Data.TaggedError(
  "CommitFeedSqlErrorV1",
)<{
  readonly operation: "listAfter";
  readonly cause: unknown;
}> {}

export type CommitFeedListAfterErrorV1 =
  | CommitFeedInputErrorV1
  | CommitFeedScopeNotFoundErrorV1
  | CommitFeedCursorResetRequiredErrorV1
  | CommitFeedCorruptionErrorV1
  | CommitFeedSqlErrorV1;

export interface CommitFeedListAfterInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly exclusiveCommitSeq: CommitSeq;
}

export interface CommitFeedAppRowChangeV1 {
  readonly ordinal: number;
  readonly tableId: CatalogTableId;
  readonly rowId: Uint8Array;
}

export interface CommitFeedCommitV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly committedAtMilliseconds: number;
  readonly appRowChanges: ReadonlyArray<CommitFeedAppRowChangeV1>;
}

export type CommitFeedContinuationV1 =
  | Readonly<{
      readonly kind: "complete";
      readonly observedLastCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly kind: "more";
      readonly nextExclusiveCommitSeq: CommitSeq;
      readonly observedLastCommitSeq: CommitSeq;
    }>;

export interface CommitFeedPageV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly exclusiveCommitSeq: CommitSeq;
  readonly observedLastCommitSeq: CommitSeq;
  readonly observedOldestAvailableCommitSeq: CommitSeq;
  readonly commits: ReadonlyArray<CommitFeedCommitV1>;
  readonly continuation: CommitFeedContinuationV1;
}

export interface CommitFeedRepositoryV1 {
  readonly listAfter: (
    input: CommitFeedListAfterInputV1,
  ) => Effect.Effect<CommitFeedPageV1, CommitFeedListAfterErrorV1>;
}

export interface CommitFeedRepositoryOptionsV1 {
  /** Test-only observation after the read-only transaction has settled. */
  readonly afterRepeatableRead?: () => void | Promise<void>;
  /** Test-only capture of the bounded statements used by the reader. */
  readonly observeQuery?: (query: CommitFeedQueryV1) => void;
}

export interface CommitFeedQueryV1 {
  readonly name: "clock" | "headers" | "appRowChanges";
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

type ScopeClockRow = Pick<
  typeof fxSystemScopeClocks.$inferSelect,
  "scopeUuid" | "lastCommitSeq" | "oldestAvailableCommitSeq"
>;

type CommitHeaderRow = typeof fxSystemCommits.$inferSelect;

interface CommitAppRowChangeRow {
  readonly scopeUuid:
    typeof fxSystemCommitAppRowChanges.$inferSelect.scopeUuid;
  readonly epochUuid:
    typeof fxSystemCommitAppRowChanges.$inferSelect.epochUuid;
  readonly commitSeq:
    typeof fxSystemCommitAppRowChanges.$inferSelect.commitSeq;
  readonly changeOrdinal:
    typeof fxSystemCommitAppRowChanges.$inferSelect.changeOrdinal;
  readonly tableId:
    typeof fxSystemCommitAppRowChanges.$inferSelect.tableId;
  readonly rowId: Uint8Array;
  readonly revisionScopeUuid:
    | typeof fxAppRowRevisions.$inferSelect.scopeUuid
    | null;
  readonly revisionTableId:
    | typeof fxAppRowRevisions.$inferSelect.tableId
    | null;
  readonly revisionRowId: Uint8Array | null;
  readonly revisionEpochUuid:
    | typeof fxAppRowRevisions.$inferSelect.writeEpochUuid
    | null;
  readonly revisionCommitSeq:
    | typeof fxAppRowRevisions.$inferSelect.commitSeq
    | null;
}

interface CapturedCommitFeedRowsV1 {
  readonly clockRows: ReadonlyArray<ScopeClockRow>;
  readonly headerRows: ReadonlyArray<CommitHeaderRow>;
  readonly appRowChangeRows: ReadonlyArray<CommitAppRowChangeRow>;
}

interface ValidatedCommitFeedInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly exclusiveCommitSeq: CommitSeq;
}

interface HeaderCaptureSelectionV1 {
  readonly firstCommitSeq: CommitSeq;
  readonly lastCommitSeq: CommitSeq;
  readonly expectedChangeCount: number;
}

export function createCommitFeedRepositoryV1(
  db: FlarexMetadataDatabase,
  options: CommitFeedRepositoryOptionsV1 = {},
): CommitFeedRepositoryV1 {
  const captureRows = Effect.fn("CommitFeed.captureRows")(
    (
      input: ValidatedCommitFeedInputV1,
    ): Effect.Effect<
      CapturedCommitFeedRowsV1,
      CommitFeedSqlErrorV1
    > =>
      Effect.uninterruptible(
        Effect.tryPromise({
          try: () => captureCommitFeedRows(db, input, options.observeQuery),
          catch: (cause) => new CommitFeedSqlErrorV1({
            operation: "listAfter",
            cause,
          }),
        }),
      ),
  );

  const listAfter = Effect.fn("CommitFeed.listAfter")(function* (
    rawInput: CommitFeedListAfterInputV1,
  ): Effect.fn.Return<CommitFeedPageV1, CommitFeedListAfterErrorV1> {
    const input = yield* Effect.fromResult(validateListAfterInput(rawInput));
    const captured = yield* captureRows(input);
    if (options.afterRepeatableRead !== undefined) {
      // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: lifecycle - optional observer hook is absent or void; a rejecting hook is an invariant defect
      yield* Effect.promise(() => Promise.resolve(options.afterRepeatableRead?.()));
    }
    return yield* Effect.fromResult(materializeCommitFeedPage(input, captured));
  });

  return Object.freeze({ listAfter });
}

function validateListAfterInput(
  input: CommitFeedListAfterInputV1,
): Result.Result<ValidatedCommitFeedInputV1, CommitFeedInputErrorV1> {
  const decodedScopeUuid = decodeScopeUuidV1Result(input.scopeUuid);
  if (Result.isFailure(decodedScopeUuid)) {
    return Result.fail(new CommitFeedInputErrorV1({
      reason: "scopeUuidInvalid",
    }));
  }
  if (
    typeof input.exclusiveCommitSeq !== "bigint" ||
    input.exclusiveCommitSeq < 0n ||
    input.exclusiveCommitSeq > MAX_PERSISTED_SIGNED_INT64_V1
  ) {
    return Result.fail(new CommitFeedInputErrorV1({
      reason: "exclusiveCommitSeqInvalid",
    }));
  }
  return Result.succeed(Object.freeze({
    scopeUuid: decodedScopeUuid.success,
    exclusiveCommitSeq: CommitSeqSchema.make(input.exclusiveCommitSeq),
  }));
}

async function captureCommitFeedRows(
  db: FlarexMetadataDatabase,
  input: ValidatedCommitFeedInputV1,
  observeQuery: CommitFeedRepositoryOptionsV1["observeQuery"],
): Promise<CapturedCommitFeedRowsV1> {
  return db.transaction(async (tx) => {
    await tx.setTransaction({
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });

    const clockQuery = tx
      .select({
        scopeUuid: fxSystemScopeClocks.scopeUuid,
        lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
        oldestAvailableCommitSeq:
          fxSystemScopeClocks.oldestAvailableCommitSeq,
      })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeUuid, input.scopeUuid))
      .limit(2);
    observeCommitFeedQuery("clock", clockQuery, observeQuery);
    const clockRows = await clockQuery;

    if (!shouldCaptureCommitHeaders(input, clockRows)) {
      return Object.freeze({
        clockRows: detachDriverRows(clockRows),
        headerRows: Object.freeze([]),
        appRowChangeRows: Object.freeze([]),
      });
    }

    const headerQuery = tx
      .select()
      .from(fxSystemCommits)
      .where(and(
        eq(fxSystemCommits.scopeUuid, input.scopeUuid),
        gt(fxSystemCommits.commitSeq, input.exclusiveCommitSeq),
      ))
      .orderBy(asc(fxSystemCommits.commitSeq))
      .limit(MAX_COMMIT_FEED_PAGE_COMMITS_V1 + 1);
    observeCommitFeedQuery("headers", headerQuery, observeQuery);
    const headerRows = await headerQuery;

    const selection = selectHeadersForChildCapture(
      input,
      clockRows,
      headerRows,
    );
    if (selection === null) {
      return Object.freeze({
        clockRows: detachDriverRows(clockRows),
        headerRows: detachDriverRows(headerRows),
        appRowChangeRows: Object.freeze([]),
      });
    }

    const appRowChangeQuery = tx
      .select({
        scopeUuid: fxSystemCommitAppRowChanges.scopeUuid,
        epochUuid: fxSystemCommitAppRowChanges.epochUuid,
        commitSeq: fxSystemCommitAppRowChanges.commitSeq,
        changeOrdinal: fxSystemCommitAppRowChanges.changeOrdinal,
        tableId: fxSystemCommitAppRowChanges.tableId,
        rowId: fxSystemCommitAppRowChanges.rowId,
        revisionScopeUuid: fxAppRowRevisions.scopeUuid,
        revisionTableId: fxAppRowRevisions.tableId,
        revisionRowId: fxAppRowRevisions.rowId,
        revisionEpochUuid: fxAppRowRevisions.writeEpochUuid,
        revisionCommitSeq: fxAppRowRevisions.commitSeq,
      })
      .from(fxSystemCommitAppRowChanges)
      .leftJoin(
        fxAppRowRevisions,
        and(
          eq(
            fxAppRowRevisions.scopeUuid,
            fxSystemCommitAppRowChanges.scopeUuid,
          ),
          eq(
            fxAppRowRevisions.tableId,
            fxSystemCommitAppRowChanges.tableId,
          ),
          eq(
            fxAppRowRevisions.rowId,
            fxSystemCommitAppRowChanges.rowId,
          ),
          eq(
            fxAppRowRevisions.writeEpochUuid,
            fxSystemCommitAppRowChanges.epochUuid,
          ),
          eq(
            fxAppRowRevisions.commitSeq,
            fxSystemCommitAppRowChanges.commitSeq,
          ),
        ),
      )
      .where(and(
        eq(fxSystemCommitAppRowChanges.scopeUuid, input.scopeUuid),
        gte(
          fxSystemCommitAppRowChanges.commitSeq,
          selection.firstCommitSeq,
        ),
        lte(
          fxSystemCommitAppRowChanges.commitSeq,
          selection.lastCommitSeq,
        ),
      ))
      .orderBy(
        asc(fxSystemCommitAppRowChanges.commitSeq),
        asc(fxSystemCommitAppRowChanges.changeOrdinal),
      )
      .limit(selection.expectedChangeCount + 1);
    observeCommitFeedQuery(
      "appRowChanges",
      appRowChangeQuery,
      observeQuery,
    );
    const appRowChangeRows = await appRowChangeQuery;

    return Object.freeze({
      clockRows: detachDriverRows(clockRows),
      headerRows: detachDriverRows(headerRows),
      appRowChangeRows: detachDriverRows(appRowChangeRows),
    });
  });
}

function selectHeadersForChildCapture(
  input: ValidatedCommitFeedInputV1,
  clockRows: ReadonlyArray<ScopeClockRow>,
  headerRows: ReadonlyArray<CommitHeaderRow>,
): HeaderCaptureSelectionV1 | null {
  const clock = clockRows.length === 1 ? clockRows[0] : undefined;
  if (
    clock === undefined ||
    clock.scopeUuid !== input.scopeUuid ||
    typeof clock.lastCommitSeq !== "bigint" ||
    typeof clock.oldestAvailableCommitSeq !== "bigint" ||
    clock.lastCommitSeq < 0n ||
    clock.lastCommitSeq > MAX_PERSISTED_SIGNED_INT64_V1 ||
    clock.oldestAvailableCommitSeq < 0n ||
    clock.oldestAvailableCommitSeq > clock.lastCommitSeq ||
    input.exclusiveCommitSeq < retainedFloorExclusiveCursor(
      clock.oldestAvailableCommitSeq,
    ) ||
    input.exclusiveCommitSeq > clock.lastCommitSeq
  ) {
    return null;
  }

  let expectedCommitSeq = input.exclusiveCommitSeq + 1n;
  for (const header of headerRows) {
    if (
      header.scopeUuid !== input.scopeUuid ||
      typeof header.commitSeq !== "bigint" ||
      header.commitSeq !== expectedCommitSeq ||
      header.commitSeq < 1n ||
      header.commitSeq > clock.lastCommitSeq ||
      !Number.isInteger(header.changeCount) ||
      header.changeCount < 0 ||
      header.changeCount > MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1 ||
      finiteDateMilliseconds(header.committedAt) === undefined
    ) {
      return null;
    }
    expectedCommitSeq += 1n;
  }
  const lastCapturedCommitSeq = expectedCommitSeq - 1n;
  if (
    headerRows.length < MAX_COMMIT_FEED_PAGE_COMMITS_V1 + 1 &&
    lastCapturedCommitSeq < clock.lastCommitSeq
  ) {
    return null;
  }

  let expectedChangeCount = 0;
  let selectedCount = 0;
  for (
    const header of headerRows.slice(0, MAX_COMMIT_FEED_PAGE_COMMITS_V1)
  ) {
    if (
      selectedCount > 0 &&
      expectedChangeCount + header.changeCount >
        MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1
    ) {
      break;
    }
    expectedChangeCount += header.changeCount;
    selectedCount += 1;
  }
  if (selectedCount === 0) return null;
  const first = headerRows[0];
  const last = headerRows[selectedCount - 1];
  if (first === undefined || last === undefined) return null;
  return Object.freeze({
    firstCommitSeq: CommitSeqSchema.make(first.commitSeq),
    lastCommitSeq: CommitSeqSchema.make(last.commitSeq),
    expectedChangeCount,
  });
}

function materializeCommitFeedPage(
  input: ValidatedCommitFeedInputV1,
  captured: CapturedCommitFeedRowsV1,
): Result.Result<
  CommitFeedPageV1,
  CommitFeedInputErrorV1 | CommitFeedScopeNotFoundErrorV1 |
    CommitFeedCursorResetRequiredErrorV1 |
    CommitFeedCorruptionErrorV1
> {
  if (captured.clockRows.length === 0) {
    return Result.fail(new CommitFeedScopeNotFoundErrorV1({
      scopeUuid: input.scopeUuid,
    }));
  }
  if (captured.clockRows.length !== 1) {
    return corruption(input, "scopeClockDuplicate");
  }
  const clock = captured.clockRows[0];
  if (
    clock === undefined ||
    clock.scopeUuid !== input.scopeUuid ||
    typeof clock.lastCommitSeq !== "bigint" ||
    clock.lastCommitSeq < 0n ||
    clock.lastCommitSeq > MAX_PERSISTED_SIGNED_INT64_V1 ||
    typeof clock.oldestAvailableCommitSeq !== "bigint" ||
    clock.oldestAvailableCommitSeq < 0n ||
    clock.oldestAvailableCommitSeq > clock.lastCommitSeq
  ) {
    return corruption(input, "scopeClockInvalid");
  }
  if (input.exclusiveCommitSeq > clock.lastCommitSeq) {
    return Result.fail(new CommitFeedInputErrorV1({
      reason: "cursorAheadOfClock",
    }));
  }
  const restartExclusiveCommitSeq = retainedFloorExclusiveCursor(
    clock.oldestAvailableCommitSeq,
  );
  if (input.exclusiveCommitSeq < restartExclusiveCommitSeq) {
    return Result.fail(new CommitFeedCursorResetRequiredErrorV1({
      scopeUuid: input.scopeUuid,
      requestedExclusiveCommitSeq: input.exclusiveCommitSeq,
      restartExclusiveCommitSeq,
      observedOldestAvailableCommitSeq: CommitSeqSchema.make(
        clock.oldestAvailableCommitSeq,
      ),
    }));
  }

  const headerValidation = validateCommitHeaders(input, clock, captured.headerRows);
  if (Result.isFailure(headerValidation)) {
    return Result.fail(headerValidation.failure);
  }
  const selectedHeaders = selectPageHeaders(headerValidation.success);
  const expectedChangeCount = selectedHeaders.reduce(
    (total, header) => total + header.changeCount,
    0,
  );
  if (captured.appRowChangeRows.length !== expectedChangeCount) {
    return corruption(input, "appRowChangeCountMismatch");
  }

  const commits: CommitFeedCommitV1[] = [];
  let childIndex = 0;
  for (const header of selectedHeaders) {
    const committedAtMilliseconds = finiteDateMilliseconds(
      header.committedAt,
    );
    if (committedAtMilliseconds === undefined) {
      return corruption(input, "commitHeaderInvalid", header.commitSeq);
    }
    const appRowChanges: CommitFeedAppRowChangeV1[] = [];
    for (let ordinal = 0; ordinal < header.changeCount; ordinal += 1) {
      const row = captured.appRowChangeRows[childIndex];
      if (row === undefined) {
        return corruption(
          input,
          "appRowChangeCountMismatch",
          header.commitSeq,
        );
      }
      const decoded = materializeAppRowChange(
        input,
        header,
        ordinal,
        row,
      );
      if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
      appRowChanges.push(decoded.success);
      childIndex += 1;
    }
    commits.push(Object.freeze({
      scopeUuid: input.scopeUuid,
      epochUuid: header.epochUuid,
      commitSeq: CommitSeqSchema.make(header.commitSeq),
      committedAtMilliseconds,
      appRowChanges: Object.freeze(appRowChanges),
    }));
  }

  const observedLastCommitSeq = CommitSeqSchema.make(clock.lastCommitSeq);
  const lastReturnedCommitSeq = commits.at(-1)?.commitSeq ??
    input.exclusiveCommitSeq;
  const continuation: CommitFeedContinuationV1 =
    lastReturnedCommitSeq === observedLastCommitSeq
      ? Object.freeze({
          kind: "complete",
          observedLastCommitSeq,
        })
      : Object.freeze({
          kind: "more",
          nextExclusiveCommitSeq: lastReturnedCommitSeq,
          observedLastCommitSeq,
        });

  return Result.succeed(Object.freeze({
    scopeUuid: input.scopeUuid,
    exclusiveCommitSeq: input.exclusiveCommitSeq,
    observedLastCommitSeq,
    observedOldestAvailableCommitSeq: CommitSeqSchema.make(
      clock.oldestAvailableCommitSeq,
    ),
    commits: Object.freeze(commits),
    continuation,
  }));
}

function shouldCaptureCommitHeaders(
  input: ValidatedCommitFeedInputV1,
  clockRows: ReadonlyArray<ScopeClockRow>,
): boolean {
  const clock = clockRows.length === 1 ? clockRows[0] : undefined;
  return clock !== undefined &&
    clock.scopeUuid === input.scopeUuid &&
    typeof clock.lastCommitSeq === "bigint" &&
    clock.lastCommitSeq >= 0n &&
    clock.lastCommitSeq <= MAX_PERSISTED_SIGNED_INT64_V1 &&
    typeof clock.oldestAvailableCommitSeq === "bigint" &&
    clock.oldestAvailableCommitSeq >= 0n &&
    clock.oldestAvailableCommitSeq <= clock.lastCommitSeq &&
    input.exclusiveCommitSeq >= retainedFloorExclusiveCursor(
      clock.oldestAvailableCommitSeq,
    ) &&
    input.exclusiveCommitSeq <= clock.lastCommitSeq;
}

function retainedFloorExclusiveCursor(
  oldestAvailableCommitSeq: bigint,
): CommitSeq {
  return CommitSeqSchema.make(
    oldestAvailableCommitSeq === 0n ? 0n : oldestAvailableCommitSeq - 1n,
  );
}

function validateCommitHeaders(
  input: ValidatedCommitFeedInputV1,
  clock: ScopeClockRow,
  rows: ReadonlyArray<CommitHeaderRow>,
): Result.Result<
  ReadonlyArray<CommitHeaderRow>,
  CommitFeedCorruptionErrorV1
> {
  let expectedCommitSeq = input.exclusiveCommitSeq + 1n;
  for (const row of rows) {
    if (
      row.scopeUuid !== input.scopeUuid ||
      typeof row.epochUuid !== "string" ||
      row.epochUuid.length === 0 ||
      typeof row.commitSeq !== "bigint" ||
      row.commitSeq < 1n ||
      row.commitSeq > MAX_PERSISTED_SIGNED_INT64_V1 ||
      !Number.isInteger(row.changeCount) ||
      row.changeCount < 0 ||
      row.changeCount > MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1 ||
      finiteDateMilliseconds(row.committedAt) === undefined
    ) {
      return corruption(input, "commitHeaderInvalid");
    }
    if (row.commitSeq !== expectedCommitSeq) {
      return corruption(input, "commitHeaderGap", row.commitSeq);
    }
    if (row.commitSeq > clock.lastCommitSeq) {
      return corruption(input, "commitHeaderPastClock", row.commitSeq);
    }
    expectedCommitSeq += 1n;
  }
  const lastCapturedCommitSeq = expectedCommitSeq - 1n;
  if (
    rows.length < MAX_COMMIT_FEED_PAGE_COMMITS_V1 + 1 &&
    lastCapturedCommitSeq < clock.lastCommitSeq
  ) {
    return corruption(
      input,
      "commitHeaderMissingBeforeClock",
      CommitSeqSchema.make(lastCapturedCommitSeq + 1n),
    );
  }
  return Result.succeed(rows);
}

function selectPageHeaders(
  headers: ReadonlyArray<CommitHeaderRow>,
): ReadonlyArray<CommitHeaderRow> {
  const selected: CommitHeaderRow[] = [];
  let changeCount = 0;
  for (const header of headers.slice(0, MAX_COMMIT_FEED_PAGE_COMMITS_V1)) {
    if (
      selected.length > 0 &&
      changeCount + header.changeCount >
        MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1
    ) {
      break;
    }
    selected.push(header);
    changeCount += header.changeCount;
  }
  return Object.freeze(selected);
}

function materializeAppRowChange(
  input: ValidatedCommitFeedInputV1,
  header: CommitHeaderRow,
  expectedOrdinal: number,
  row: CommitAppRowChangeRow,
): Result.Result<CommitFeedAppRowChangeV1, CommitFeedCorruptionErrorV1> {
  if (
    !Number.isInteger(row.changeOrdinal) ||
    row.changeOrdinal < 0 ||
    row.changeOrdinal >= MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1 ||
    !Number.isInteger(row.tableId) ||
    row.tableId < 1 ||
    row.tableId > 2_147_483_647 ||
    !(row.rowId instanceof Uint8Array) ||
    row.rowId.byteLength !== 16
  ) {
    return corruption(input, "appRowChangeInvalid", header.commitSeq);
  }
  if (row.changeOrdinal !== expectedOrdinal) {
    return corruption(input, "appRowChangeOrdinalGap", header.commitSeq);
  }
  if (
    row.scopeUuid !== input.scopeUuid ||
    row.epochUuid !== header.epochUuid ||
    row.commitSeq !== header.commitSeq
  ) {
    return corruption(input, "appRowChangeHeaderMismatch", header.commitSeq);
  }
  if (
    row.revisionScopeUuid !== row.scopeUuid ||
    row.revisionTableId !== row.tableId ||
    row.revisionEpochUuid !== row.epochUuid ||
    row.revisionCommitSeq !== row.commitSeq ||
    !(row.revisionRowId instanceof Uint8Array) ||
    !bytesEqual(row.revisionRowId, row.rowId)
  ) {
    return corruption(
      input,
      "appRowChangeRevisionMismatch",
      header.commitSeq,
    );
  }
  return Result.succeed(Object.freeze({
    ordinal: row.changeOrdinal,
    tableId: row.tableId,
    rowId: copyBytes(row.rowId),
  }));
}

function corruption<A = never>(
  input: ValidatedCommitFeedInputV1,
  reason: CommitFeedCorruptionReasonV1,
  commitSeq?: bigint,
): Result.Result<A, CommitFeedCorruptionErrorV1> {
  return Result.fail(new CommitFeedCorruptionErrorV1({
    reason,
    scopeUuid: input.scopeUuid,
    ...(commitSeq === undefined
      ? {}
      : { commitSeq: CommitSeqSchema.make(commitSeq) }),
  }));
}

function observeCommitFeedQuery(
  name: CommitFeedQueryV1["name"],
  query: { readonly toSQL: () => {
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
  } },
  observe: CommitFeedRepositoryOptionsV1["observeQuery"],
): void {
  if (observe === undefined) return;
  const compiled = query.toSQL();
  observe(Object.freeze({
    name,
    sql: compiled.sql,
    params: Object.freeze([...compiled.params]),
  }));
}
