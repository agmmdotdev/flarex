import { bytesEqualFullScan, isUint8Array } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import {
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogTableIdSchema,
  type CatalogIndexDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  ORDERED_INDEX_KEY_CODEC_VERSION_V1,
  OrderedIndexBoundHexV1Schema,
  OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexRowIdHexV1Schema,
  decodeAppOrderedIndexKeyV1,
  orderedIndexBoundHexV1ToBytes,
  orderedIndexKeyBytesHexV1FromBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  orderedIndexRowIdHexV1ToBytes,
  type OrderedIndexBoundsV1,
  type AppOrderedIndexPhysicalSpecV1,
  type OrderedIndexKeyBytesHexV1,
  type OrderedIndexKeyCodecVersion,
  type OrderedIndexKeyHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
  type CanonicalAppIndexPhysicalSpecV1,
} from "flarex-protocol/index-definition";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeEpochUuidV1Schema,
  ScopeIdSchema,
  ScopeUuidV1Schema,
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeEpoch,
  type ScopeEpochUuidV1,
  type ScopeId,
  type ScopeIdUuidProjectionV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import {
  isLocatedAppIndexDefinitionV1,
  type LocatedAppIndexDefinitionV1,
} from "./appIndexDefinitions";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import {
  fxAppIndexEntryCurrent,
  fxAppIndexEntryRevisions,
  fxAppRowRevisions,
  fxSystemScopeClocks,
} from "./schema";

export const MAX_APP_INDEX_RANGE_PAGE_SIZE_V1 = 1_000;

export type AppIndexEntryTransaction = FlarexMetadataTransaction;

export interface AppIndexEntryIdentityV1 {
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly tableId: CatalogTableId;
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}

interface AppendAppIndexEntryRevisionV1Base {
  readonly scopeId: ScopeId;
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly writeEpoch: ScopeEpoch;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
}

export interface AppendLiveAppIndexEntryRevisionV1Input
  extends AppendAppIndexEntryRevisionV1Base {
  readonly kind: "live";
}

export interface AppendTombstoneAppIndexEntryRevisionV1Input
  extends AppendAppIndexEntryRevisionV1Base {
  readonly kind: "tombstone";
}

export type AppendAppIndexEntryRevisionV1Input =
  | AppendLiveAppIndexEntryRevisionV1Input
  | AppendTombstoneAppIndexEntryRevisionV1Input;

export interface AppIndexEntryRevisionV1 extends AppIndexEntryIdentityV1 {
  readonly kind: "live" | "tombstone";
  readonly scopeUuid: ScopeUuidV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
  readonly keyCodecVersion: OrderedIndexKeyCodecVersion;
  readonly keySha256: Uint8Array;
  readonly physicalSpecSha256: Uint8Array;
}

export interface AppIndexRangeCursorV1 {
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}

interface AppIndexRangeReadV1Base {
  readonly scopeId: ScopeId;
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly bounds: OrderedIndexBoundsV1;
  readonly after?: AppIndexRangeCursorV1;
  readonly limit: number;
}

export interface ScanAppIndexAtSnapshotV1Input
  extends AppIndexRangeReadV1Base {
  readonly snapshotCommitSeq: CommitSeq;
}

export type ScanCurrentAppIndexV1Input = AppIndexRangeReadV1Base;

export interface AppIndexRangeEntryV1 extends AppIndexEntryIdentityV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly keyCodecVersion: OrderedIndexKeyCodecVersion;
  readonly keySha256: Uint8Array;
  readonly physicalSpecSha256: Uint8Array;
}

export interface AppIndexRangePageV1 {
  readonly entries: ReadonlyArray<AppIndexRangeEntryV1>;
  readonly isDone: boolean;
  readonly continueCursor: AppIndexRangeCursorV1 | null;
}

export type InvalidAppIndexEntryInputIssue =
  | "invalidScopeId"
  | "invalidKind"
  | "invalidLocatedDefinition"
  | "invalidEncodedKey"
  | "invalidRowId"
  | "invalidWriteEpoch"
  | "invalidCommitSeq"
  | "invalidPreviousCommitSeq"
  | "invalidBounds"
  | "invalidCursor"
  | "invalidLimit"
  | "invalidSnapshotCommitSeq";

export class InvalidAppIndexEntryInputError extends Error {
  readonly _tag = "InvalidAppIndexEntryInputError" as const;

  constructor(
    readonly issue: InvalidAppIndexEntryInputIssue,
    readonly cause?: unknown,
  ) {
    super(`Invalid app-index entry input: ${issue}.`, { cause });
    this.name = "InvalidAppIndexEntryInputError";
  }
}

export class AppIndexEntryScopeAuthorityUnavailableError extends Error {
  readonly _tag = "AppIndexEntryScopeAuthorityUnavailableError" as const;

  constructor(readonly scopeId: ScopeId) {
    super(`App-index entry scope authority is unavailable: ${scopeId}`);
    this.name = "AppIndexEntryScopeAuthorityUnavailableError";
  }
}

export class AppIndexEntryRevisionAlreadyExistsError extends Error {
  readonly _tag = "AppIndexEntryRevisionAlreadyExistsError" as const;

  constructor(
    readonly identity: AppIndexEntryIdentityV1,
    readonly commitSeq: CommitSeq,
  ) {
    super(
      `App-index entry revision already exists at ${identity.scopeId}/` +
        `${identity.indexDefinitionId}/${identity.encodedKey}/` +
        `${identity.rowId}/${commitSeq}`,
    );
    this.name = "AppIndexEntryRevisionAlreadyExistsError";
  }
}

export class AppIndexEntryRevisionChainConflictError extends Error {
  readonly _tag = "AppIndexEntryRevisionChainConflictError" as const;

  constructor(
    readonly identity: AppIndexEntryIdentityV1,
    readonly expectedPrevCommitSeq: CommitSeq | null,
    readonly actualHeadCommitSeq: CommitSeq | null,
  ) {
    super(
      `App-index entry history chain head for ${identity.scopeId}/` +
        `${identity.indexDefinitionId}/${identity.encodedKey}/${identity.rowId} ` +
        `is ${actualHeadCommitSeq ?? "missing"}; expected ` +
        `${expectedPrevCommitSeq ?? "missing"}`,
    );
    this.name = "AppIndexEntryRevisionChainConflictError";
  }
}

export class AppIndexEntryParentRevisionError extends Error {
  readonly _tag = "AppIndexEntryParentRevisionError" as const;

  constructor(
    readonly identity: AppIndexEntryIdentityV1,
    readonly commitSeq: CommitSeq,
    readonly reason: "missing" | "tombstonedLiveEntry",
  ) {
    super(
      `App-index entry parent row revision is ${reason} at ` +
        `${identity.scopeId}/${identity.tableId}/${identity.rowId}/${commitSeq}`,
    );
    this.name = "AppIndexEntryParentRevisionError";
  }
}

export class AppIndexEntryHashError extends Error {
  readonly _tag = "AppIndexEntryHashError" as const;

  constructor(
    readonly operation: "append" | "read",
    readonly cause: unknown,
  ) {
    super(`App-index entry SHA-256 ${operation} operation failed.`, { cause });
    this.name = "AppIndexEntryHashError";
  }
}

export class AppIndexEntryStorageCorruptionError extends Error {
  readonly _tag = "AppIndexEntryStorageCorruptionError" as const;

  constructor(readonly reason: string, options?: ErrorOptions) {
    super(`App-index entry storage is invalid: ${reason}.`, options);
    this.name = "AppIndexEntryStorageCorruptionError";
  }
}

export class AppIndexEntryReadPersistenceError extends Error {
  readonly _tag = "AppIndexEntryReadPersistenceError" as const;

  constructor(
    readonly operation: "readScopeAuthority" | "scanSnapshot" | "scanCurrent",
    readonly cause: unknown,
  ) {
    super(`App-index entry ${operation} query failed.`, { cause });
    this.name = "AppIndexEntryReadPersistenceError";
  }
}

export type AppendAppIndexEntryRevisionV1Error =
  | InvalidAppIndexEntryInputError
  | AppIndexEntryScopeAuthorityUnavailableError
  | AppIndexEntryRevisionAlreadyExistsError
  | AppIndexEntryRevisionChainConflictError
  | AppIndexEntryParentRevisionError
  | AppIndexEntryHashError
  | AppIndexEntryStorageCorruptionError;

export function isAppendAppIndexEntryRevisionV1Error(
  value: unknown,
): value is AppendAppIndexEntryRevisionV1Error {
  return value instanceof InvalidAppIndexEntryInputError ||
    value instanceof AppIndexEntryScopeAuthorityUnavailableError ||
    value instanceof AppIndexEntryRevisionAlreadyExistsError ||
    value instanceof AppIndexEntryRevisionChainConflictError ||
    value instanceof AppIndexEntryParentRevisionError ||
    value instanceof AppIndexEntryHashError ||
    value instanceof AppIndexEntryStorageCorruptionError;
}

export type ReadAppIndexRangeV1Error =
  | InvalidAppIndexEntryInputError
  | AppIndexEntryScopeAuthorityUnavailableError
  | AppIndexEntryReadPersistenceError
  | AppIndexEntryHashError
  | AppIndexEntryStorageCorruptionError;

interface DecodedAppendAppIndexEntryRevisionV1 {
  readonly kind: "live" | "tombstone";
  readonly identity: AppIndexEntryIdentityV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly physicalSpecSha256: Uint8Array;
  readonly keyBytes: Uint8Array;
  readonly keySha256: Uint8Array;
}

interface DecodedAppIndexRangeReadV1 {
  readonly scopeId: ScopeId;
  readonly scopeUuid: ScopeUuidV1;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly physicalSpecSha256: Uint8Array;
  readonly bounds: Readonly<{
    readonly startInclusive?: Uint8Array;
    readonly endExclusive?: Uint8Array;
  }>;
  readonly after?: Readonly<{
    readonly encodedKey: OrderedIndexKeyBytesHexV1;
    readonly keyBytes: Uint8Array;
    readonly rowId: OrderedIndexRowIdHexV1;
    readonly rowIdBytes: Uint8Array;
  }>;
  readonly limit: number;
}

const decodeScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeIdSchema),
);
const decodeScopeEpochResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochSchema),
);
const decodeScopeUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeUuidV1Schema),
);
const decodeScopeEpochUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochUuidV1Schema),
);
const decodeTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeOrderedKeyResult = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexKeyBytesHexV1Schema),
);
const decodeOrderedBoundResult = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexBoundHexV1Schema),
);
const decodeOrderedRowIdResult = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexRowIdHexV1Schema),
);

/**
 * Transaction-only S10 mutation primitive. SQL failures remain rejected
 * Promises so the caller's Drizzle transaction rolls back; owned validation,
 * digest, and chain failures remain Result data.
 */
export async function appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
  tx: AppIndexEntryTransaction,
  input: AppendAppIndexEntryRevisionV1Input,
): Promise<
  Result.Result<AppIndexEntryRevisionV1, AppendAppIndexEntryRevisionV1Error>
> {
  const decodedResult = await decodeAppendInputResult(tx, input);
  return await Result.match(decodedResult, {
    onFailure: async (failure) => Result.fail(failure),
    onSuccess: (decodedRevision) =>
      appendDecodedAppIndexEntryRevisionResult(tx, decodedRevision),
  });
}

interface AppendBackfilledAppIndexEntryRevisionV1Input {
  readonly scopeId: ScopeId;
  readonly scopeUuid: ScopeUuidV1;
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
}

/**
 * Package-internal C08 backfill primitive. The builder supplies scope and epoch
 * UUIDs read from the exact authoritative row revision because historical
 * epoch text is intentionally not duplicated in app-row storage.
 */
export const appendBackfilledLiveAppIndexEntryRevisionInTransactionEffect =
Effect.fn("AppIndexEntries.appendBackfilledLiveInTransaction")(function* (
  tx: AppIndexEntryTransaction,
  input: AppendBackfilledAppIndexEntryRevisionV1Input,
): Effect.fn.Return<
  AppIndexEntryRevisionV1,
  AppendAppIndexEntryRevisionV1Error
> {
  const revision = yield* decodeBackfilledAppendInputEffect(tx, input);
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: transaction - Drizzle write rejections stay defects until AppendAppIndexEntryRevisionV1Error gains a persistence variant
  const appended = yield* Effect.promise(() =>
    appendDecodedAppIndexEntryRevisionResult(tx, revision)
  );
  return yield* Effect.fromResult(appended);
});

async function appendDecodedAppIndexEntryRevisionResult(
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
): Promise<
  Result.Result<AppIndexEntryRevisionV1, AppendAppIndexEntryRevisionV1Error>
> {
  if (await revisionExists(tx, revision)) {
    return Result.fail(new AppIndexEntryRevisionAlreadyExistsError(
      revision.identity,
      revision.commitSeq,
    ));
  }
  const chainHead = await readChainHeadResult(tx, revision);
  return await Result.match(chainHead, {
    onFailure: async (failure) => Result.fail(failure),
    onSuccess: (headRow) => {
      const actualHeadCommitSeq = headRow?.commitSeq ?? null;
      if (actualHeadCommitSeq !== revision.prevCommitSeq) {
        return Result.fail(new AppIndexEntryRevisionChainConflictError(
          revision.identity,
          revision.prevCommitSeq,
          actualHeadCommitSeq,
        ));
      }
      return appendVerifiedParentAndAdvanceCurrent(
        tx,
        revision,
        headRow?.isTombstone === true,
      );
    },
  });
}

async function appendVerifiedParentAndAdvanceCurrent(
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
  headIsTombstone: boolean,
): Promise<
  Result.Result<AppIndexEntryRevisionV1, AppendAppIndexEntryRevisionV1Error>
> {
  const parent = await requireParentRevisionResult(tx, revision);
  if (Result.isFailure(parent)) {
    // SAFETY: the guard proved the failure channel; only the success phantom needs widening.
    return parent as Result.Result<
      AppIndexEntryRevisionV1,
      AppendAppIndexEntryRevisionV1Error
    >;
  }
  const inserted = await tx
    .insert(fxAppIndexEntryRevisions)
    .values({
      scopeUuid: revision.scopeUuid,
      indexDefinitionId: revision.identity.indexDefinitionId,
      tableId: revision.identity.tableId,
      keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
      physicalSpecSha256: revision.physicalSpecSha256,
      encodedKey: revision.keyBytes,
      keySha256: revision.keySha256,
      rowId: orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
      commitSeq: revision.commitSeq,
      prevCommitSeq: revision.prevCommitSeq,
      writeEpochUuid: revision.writeEpochUuid,
      isTombstone: revision.kind === "tombstone",
    })
    .onConflictDoNothing()
    .returning({ commitSeq: fxAppIndexEntryRevisions.commitSeq });
  if (inserted[0] === undefined) {
    return Result.fail(new AppIndexEntryRevisionAlreadyExistsError(
      revision.identity,
      revision.commitSeq,
    ));
  }

  const rowIdBytes = orderedIndexRowIdHexV1ToBytes(revision.identity.rowId);
  const advanced = revision.kind === "tombstone"
    ? await tx
        .delete(fxAppIndexEntryCurrent)
        .where(and(
          eq(fxAppIndexEntryCurrent.scopeUuid, revision.scopeUuid),
          eq(
            fxAppIndexEntryCurrent.indexDefinitionId,
            revision.identity.indexDefinitionId,
          ),
          eq(fxAppIndexEntryCurrent.encodedKey, revision.keyBytes),
          eq(fxAppIndexEntryCurrent.rowId, rowIdBytes),
          eq(
            fxAppIndexEntryCurrent.commitSeq,
            revision.prevCommitSeq ?? revision.commitSeq,
          ),
        ))
        .returning({ commitSeq: fxAppIndexEntryCurrent.commitSeq })
    : revision.prevCommitSeq === null || headIsTombstone
    ? await tx
        .insert(fxAppIndexEntryCurrent)
        .values({
          scopeUuid: revision.scopeUuid,
          indexDefinitionId: revision.identity.indexDefinitionId,
          encodedKey: revision.keyBytes,
          rowId: rowIdBytes,
          commitSeq: revision.commitSeq,
        })
        .onConflictDoNothing()
        .returning({ commitSeq: fxAppIndexEntryCurrent.commitSeq })
    : await tx
        .update(fxAppIndexEntryCurrent)
        .set({ commitSeq: revision.commitSeq })
        .where(and(
          eq(fxAppIndexEntryCurrent.scopeUuid, revision.scopeUuid),
          eq(
            fxAppIndexEntryCurrent.indexDefinitionId,
            revision.identity.indexDefinitionId,
          ),
          eq(fxAppIndexEntryCurrent.encodedKey, revision.keyBytes),
          eq(fxAppIndexEntryCurrent.rowId, rowIdBytes),
          eq(fxAppIndexEntryCurrent.commitSeq, revision.prevCommitSeq),
        ))
        .returning({ commitSeq: fxAppIndexEntryCurrent.commitSeq });
  if (advanced[0] === undefined) {
    return failAdvancedCurrentPointerConflict(tx, revision);
  }

  return Result.succeed(projectRevision(revision));
}

async function failAdvancedCurrentPointerConflict(
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
): Promise<Result.Result<AppIndexEntryRevisionV1, AppendAppIndexEntryRevisionV1Error>> {
  const cleanup = await deleteRejectedRevisionResult(tx, revision);
  if (Result.isFailure(cleanup)) {
    // SAFETY: the guard proved the failure channel; only the success phantom needs widening.
    return cleanup as Result.Result<
      AppIndexEntryRevisionV1,
      AppendAppIndexEntryRevisionV1Error
    >;
  }
  return readActualChainHeadAndFail(tx, revision);
}

async function readActualChainHeadAndFail(
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
): Promise<Result.Result<AppIndexEntryRevisionV1, AppendAppIndexEntryRevisionV1Error>> {
  const actual = await readChainHeadResult(tx, revision);
  return Result.flatMap(actual, (headRow) =>
    Result.fail(new AppIndexEntryRevisionChainConflictError(
      revision.identity,
      revision.prevCommitSeq,
      headRow?.commitSeq ?? null,
    )));
}

export const scanAppIndexAtSnapshotInTransactionEffect = Effect.fn(
  "AppIndexEntries.scanAtSnapshotInTransaction",
)(function* (
  tx: AppIndexEntryTransaction,
  input: ScanAppIndexAtSnapshotV1Input,
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const snapshotCommitSeq = yield* Effect.fromResult(
    decodeReadFieldResult(
      decodeCommitSeqResult(input.snapshotCommitSeq),
      "invalidSnapshotCommitSeq",
    ),
  );
  const decoded = yield* decodeRangeReadEffect(tx, input);
  const statement = buildSnapshotRangeStatement(
    decoded,
    snapshotCommitSeq,
  );
  return yield* executeAndDecodeRangeEffect(
    tx,
    decoded,
    statement,
    "scanSnapshot",
  );
});

export const scanCurrentAppIndexInTransactionEffect = Effect.fn(
  "AppIndexEntries.scanCurrentInTransaction",
)(function* (
  tx: AppIndexEntryTransaction,
  input: ScanCurrentAppIndexV1Input,
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const decoded = yield* decodeRangeReadEffect(tx, input);
  return yield* executeAndDecodeRangeEffect(
    tx,
    decoded,
    buildCurrentRangeStatement(decoded),
    "scanCurrent",
  );
});

interface ReadCurrentAppIndexEntriesForRowV1Input {
  readonly scopeId: ScopeId;
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}

/** Package-internal bounded C08 validation read for one authoritative row. */
export const readCurrentAppIndexEntriesForRowInTransactionEffect = Effect.fn(
  "AppIndexEntries.readCurrentForRowInTransaction",
)(function* (
  tx: AppIndexEntryTransaction,
  input: ReadCurrentAppIndexEntriesForRowV1Input,
): Effect.fn.Return<
  ReadonlyArray<AppIndexRangeEntryV1>,
  ReadAppIndexRangeV1Error
> {
  const decoded = yield* decodeRangeReadEffect(tx, {
    scopeId: input.scopeId,
    definition: input.definition,
    bounds: {},
    limit: 2,
  });
  const rowId = yield* Effect.fromResult(
    decodeOrderedRowIdResult(input.rowId),
  ).pipe(Effect.mapError(() =>
    new InvalidAppIndexEntryInputError("invalidRowId")
  ));
  const rowIdBytes = orderedIndexRowIdHexV1ToBytes(rowId);
  const statement = sql`
    select
      revision.table_id::text as "tableIdText",
      revision.key_codec_version::text as "keyCodecVersionText",
      revision.physical_spec_sha256 as "physicalSpecSha256",
      revision.encoded_key as "encodedKeyBytes",
      revision.key_sha256 as "keySha256",
      revision.row_id as "rowIdBytes",
      revision.commit_seq::text as "commitSeqText",
      revision.write_epoch_uuid::text as "writeEpochUuid",
      revision.is_tombstone as "isTombstone"
    from fx_app_index_entry_current as current_entry
    join fx_app_index_entry_rev as revision
      on revision.scope_uuid = current_entry.scope_uuid
      and revision.index_definition_id = current_entry.index_definition_id
      and revision.encoded_key = current_entry.encoded_key
      and revision.row_id = current_entry.row_id
      and revision.commit_seq = current_entry.commit_seq
    where current_entry.scope_uuid = ${decoded.scopeUuid}
      and current_entry.index_definition_id = ${decoded.indexDefinitionId}
      and current_entry.row_id = ${rowIdBytes}
    order by current_entry.encoded_key asc
    limit 3
  `;
  const page = yield* executeAndDecodeRangeEffect(
    tx,
    decoded,
    statement,
    "scanCurrent",
  );
  if (!page.isDone) {
    return yield* Effect.fail(
      new AppIndexEntryStorageCorruptionError(
        "one row has more than two current index entries",
      ),
    );
  }
  return page.entries;
});

async function decodeAppendInputResult(
  tx: AppIndexEntryTransaction,
  input: AppendAppIndexEntryRevisionV1Input,
): Promise<Result.Result<
  DecodedAppendAppIndexEntryRevisionV1,
  InvalidAppIndexEntryInputError | AppIndexEntryScopeAuthorityUnavailableError |
    AppIndexEntryHashError
>> {
  const captured = Result.gen(function* () {
    if (input.kind !== "live" && input.kind !== "tombstone") {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidKind"),
      );
    }
    const scopeId = yield* decodeWriteFieldResult(
      decodeScopeIdResult(input.scopeId),
      "invalidScopeId",
    );
    if (
      !isLocatedAppIndexDefinitionV1(input.definition) ||
      input.definition.scopeId !== scopeId
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidLocatedDefinition"),
      );
    }
    const indexDefinitionId = input.definition.indexDefinitionId;
    const tableId = input.definition.access.tableId;
    const physicalSpec = input.definition.physicalSpec;
    const encodedKey = yield* decodeWriteFieldResult(
      decodeOrderedKeyResult(input.encodedKey),
      "invalidEncodedKey",
    );
    if (encodedKey.length === 0) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidEncodedKey"),
      );
    }
    yield* Result.try({
      try: () => decodeAppOrderedIndexKeyV1({ spec: physicalSpec, encodedKey }),
      catch: (cause) =>
        new InvalidAppIndexEntryInputError("invalidEncodedKey", cause),
    });
    const rowId = yield* decodeWriteFieldResult(
      decodeOrderedRowIdResult(input.rowId),
      "invalidRowId",
    );
    const writeEpoch = yield* decodeWriteFieldResult(
      decodeScopeEpochResult(input.writeEpoch),
      "invalidWriteEpoch",
    );
    const commitSeq = yield* decodeWriteFieldResult(
      decodeCommitSeqResult(input.commitSeq),
      "invalidCommitSeq",
    );
    if (commitSeq < 1n) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCommitSeq"),
      );
    }
    const prevCommitSeq = input.prevCommitSeq === null
      ? null
      : yield* decodeWriteFieldResult(
        decodeCommitSeqResult(input.prevCommitSeq),
        "invalidPreviousCommitSeq",
      );
    if (
      prevCommitSeq !== null &&
      (prevCommitSeq < 1n || prevCommitSeq >= commitSeq)
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidPreviousCommitSeq"),
      );
    }
    if (input.kind === "tombstone" && prevCommitSeq === null) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidPreviousCommitSeq"),
      );
    }
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError((cause) =>
        new InvalidAppIndexEntryInputError("invalidScopeId", cause)
      ),
    );
    const epochProjection = yield* projectScopeEpochUuidV1Result(
      writeEpoch,
    ).pipe(Result.mapError((cause) =>
      new InvalidAppIndexEntryInputError("invalidWriteEpoch", cause)
    ));
    return Object.freeze({
      kind: input.kind,
      physicalSpec,
      identity: Object.freeze({
        scopeId,
        indexDefinitionId,
        tableId,
        encodedKey,
        rowId,
      }),
      scopeProjection,
      writeEpochUuid: epochProjection.epochUuid,
      commitSeq,
      prevCommitSeq,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
    });
  });
  return await Result.match(captured, {
    onFailure: async (failure) => Result.fail(failure),
    onSuccess: (capture) => decodeAppendInputWithCapture(tx, capture),
  });
}

interface DecodedAppendAppIndexEntryCapture {
  readonly kind: "live" | "tombstone";
  readonly identity: AppIndexEntryIdentityV1;
  readonly scopeProjection: ScopeIdUuidProjectionV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly keyBytes: Uint8Array;
}

async function decodeAppendInputWithCapture(
  tx: AppIndexEntryTransaction,
  captured: DecodedAppendAppIndexEntryCapture,
): Promise<Result.Result<
  DecodedAppendAppIndexEntryRevisionV1,
  InvalidAppIndexEntryInputError | AppIndexEntryScopeAuthorityUnavailableError |
    AppIndexEntryHashError
>> {
  const canonicalPhysicalSpec = await canonicalizePhysicalSpecResult(
    captured.physicalSpec,
  );
  return await Result.match(canonicalPhysicalSpec, {
    onFailure: async (failure) => Result.fail(failure),
    onSuccess: (canonicalSpec) =>
      decodeAppendInputWithSpec(tx, captured, canonicalSpec),
  });
}

async function decodeAppendInputWithSpec(
  tx: AppIndexEntryTransaction,
  captured: DecodedAppendAppIndexEntryCapture,
  canonicalPhysicalSpec: CanonicalAppIndexPhysicalSpecV1,
): Promise<Result.Result<
  DecodedAppendAppIndexEntryRevisionV1,
  InvalidAppIndexEntryInputError | AppIndexEntryScopeAuthorityUnavailableError |
    AppIndexEntryHashError
>> {
  const scopeUuid = await requireScopeUuidResult(
    tx,
    captured.identity.scopeId,
    captured.scopeProjection,
  );
  return await Result.match(scopeUuid, {
    onFailure: async (failure) => Result.fail(failure),
    onSuccess: (scopeUuidValue) =>
      decodeAppendInputWithScope(tx, captured, scopeUuidValue, canonicalPhysicalSpec),
  });
}

async function decodeAppendInputWithScope(
  tx: AppIndexEntryTransaction,
  captured: DecodedAppendAppIndexEntryCapture,
  scopeUuid: ScopeUuidV1,
  canonicalPhysicalSpec: CanonicalAppIndexPhysicalSpecV1,
): Promise<Result.Result<
  DecodedAppendAppIndexEntryRevisionV1,
  InvalidAppIndexEntryInputError | AppIndexEntryScopeAuthorityUnavailableError |
    AppIndexEntryHashError
>> {
  const keySha256 = await sha256Result(captured.keyBytes, "append");
  return Result.map(keySha256, (keySha256Hex) =>
    Object.freeze({
    kind: captured.kind,
    identity: captured.identity,
    scopeUuid,
    writeEpochUuid: captured.writeEpochUuid,
    commitSeq: captured.commitSeq,
    prevCommitSeq: captured.prevCommitSeq,
    physicalSpec: captured.physicalSpec,
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
      canonicalPhysicalSpec.sha256Hex,
    ),
    keyBytes: captured.keyBytes,
    keySha256: keySha256Hex,
  }));
}

const decodeBackfilledAppendInputEffect = Effect.fn(
  "AppIndexEntries.decodeBackfilledAppendInput",
)(function* (
  tx: AppIndexEntryTransaction,
  input: AppendBackfilledAppIndexEntryRevisionV1Input,
): Effect.fn.Return<
  DecodedAppendAppIndexEntryRevisionV1,
  InvalidAppIndexEntryInputError | AppIndexEntryScopeAuthorityUnavailableError |
    AppIndexEntryHashError
> {
  const captured = Result.gen(function* () {
    const scopeId = yield* decodeWriteFieldResult(
      decodeScopeIdResult(input.scopeId),
      "invalidScopeId",
    );
    const scopeUuid = yield* decodeWriteFieldResult(
      decodeScopeUuidResult(input.scopeUuid),
      "invalidScopeId",
    );
    const expectedScope = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError((cause) =>
        new InvalidAppIndexEntryInputError("invalidScopeId", cause)
      ),
    );
    if (scopeUuid !== expectedScope.scopeUuid) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidScopeId"),
      );
    }
    if (
      !isLocatedAppIndexDefinitionV1(input.definition) ||
      input.definition.scopeId !== scopeId
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidLocatedDefinition"),
      );
    }
    const encodedKey = yield* decodeWriteFieldResult(
      decodeOrderedKeyResult(input.encodedKey),
      "invalidEncodedKey",
    );
    if (encodedKey.length === 0) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidEncodedKey"),
      );
    }
    yield* Result.try({
      try: () => decodeAppOrderedIndexKeyV1({
        spec: input.definition.physicalSpec,
        encodedKey,
      }),
      catch: (cause) =>
        new InvalidAppIndexEntryInputError("invalidEncodedKey", cause),
    });
    const rowId = yield* decodeWriteFieldResult(
      decodeOrderedRowIdResult(input.rowId),
      "invalidRowId",
    );
    const writeEpochUuid = yield* decodeWriteFieldResult(
      decodeScopeEpochUuidResult(input.writeEpochUuid),
      "invalidWriteEpoch",
    );
    const commitSeq = yield* decodeWriteFieldResult(
      decodeCommitSeqResult(input.commitSeq),
      "invalidCommitSeq",
    );
    if (commitSeq < 1n) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCommitSeq"),
      );
    }
    const prevCommitSeq = input.prevCommitSeq === null
      ? null
      : yield* decodeWriteFieldResult(
        decodeCommitSeqResult(input.prevCommitSeq),
        "invalidPreviousCommitSeq",
      );
    if (
      prevCommitSeq !== null &&
      (prevCommitSeq < 1n || prevCommitSeq >= commitSeq)
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidPreviousCommitSeq"),
      );
    }
    return Object.freeze({
      identity: Object.freeze({
        scopeId,
        indexDefinitionId: input.definition.indexDefinitionId,
        tableId: input.definition.access.tableId,
        encodedKey,
        rowId,
      }),
      scopeUuid,
      writeEpochUuid,
      commitSeq,
      prevCommitSeq,
      physicalSpec: input.definition.physicalSpec,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
    });
  });
  const value = yield* Effect.fromResult(captured);
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: transaction - Result helper types authority mismatch; Drizzle rejection stays a defect because ReadPersistenceError is outside this operation's error channel
  const currentScope = yield* Effect.promise(() =>
    requireScopeUuidResult(
      tx,
      value.identity.scopeId,
      Object.freeze({ scopeUuid: value.scopeUuid }),
    )
  );
  yield* Effect.fromResult(currentScope);
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: invariant - helper catches hashing failures into Result before this Effect boundary
  const canonicalPhysicalSpecResult = yield* Effect.promise(() =>
    canonicalizePhysicalSpecResult(value.physicalSpec)
  );
  const canonicalPhysicalSpec = yield* Effect.fromResult(
    canonicalPhysicalSpecResult,
  );
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: invariant - helper catches hashing failures into Result before this Effect boundary
  const keySha256Result = yield* Effect.promise(() =>
    sha256Result(value.keyBytes, "append")
  );
  const keySha256 = yield* Effect.fromResult(keySha256Result);
  return Object.freeze({
    kind: "live" as const,
    identity: value.identity,
    scopeUuid: value.scopeUuid,
    writeEpochUuid: value.writeEpochUuid,
    commitSeq: value.commitSeq,
    prevCommitSeq: value.prevCommitSeq,
    physicalSpec: value.physicalSpec,
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
      canonicalPhysicalSpec.sha256Hex,
    ),
    keyBytes: value.keyBytes,
    keySha256,
  });
});

const decodeRangeReadEffect = Effect.fn(
  "AppIndexEntries.decodeRangeRead",
)(function* (
  tx: AppIndexEntryTransaction,
  input: AppIndexRangeReadV1Base,
): Effect.fn.Return<DecodedAppIndexRangeReadV1, ReadAppIndexRangeV1Error> {
  const captured = yield* Effect.fromResult(decodeRangeReadInputResult(input));
  const canonicalPhysicalSpec = yield* Effect.tryPromise({
    try: () => canonicalizeAppIndexPhysicalSpecV1(captured.physicalSpec),
    catch: (cause) => new AppIndexEntryHashError("read", cause),
  });
  const scopeUuid = yield* requireScopeUuidEffect(
    tx,
    captured.scopeId,
    captured.scopeProjection,
  );
  return Object.freeze({
    scopeId: captured.scopeId,
    scopeUuid,
    indexDefinitionId: captured.indexDefinitionId,
    physicalSpec: captured.physicalSpec,
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
      canonicalPhysicalSpec.sha256Hex,
    ),
    bounds: captured.bounds,
    ...(captured.after === undefined ? {} : { after: captured.after }),
    limit: captured.limit,
  });
});

function decodeRangeReadInputResult(
  input: AppIndexRangeReadV1Base,
): Result.Result<
  Omit<
    DecodedAppIndexRangeReadV1,
    "scopeUuid" | "physicalSpecSha256"
  > & {
    readonly scopeProjection: ReturnType<
      typeof projectScopeIdUuidV1Result
    > extends Result.Result<infer Value, unknown> ? Value : never;
  },
  InvalidAppIndexEntryInputError
> {
  return Result.gen(function* () {
    if (!isNonArrayRecord(input.bounds)) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidBounds"),
      );
    }
    const boundKeys = Object.keys(input.bounds);
    if (boundKeys.some((key) => key !== "startInclusive" && key !== "endExclusive")) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidBounds"),
      );
    }
    const scopeId = yield* decodeReadFieldResult(
      decodeScopeIdResult(input.scopeId),
      "invalidScopeId",
    );
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError((cause) =>
        new InvalidAppIndexEntryInputError("invalidScopeId", cause)
      ),
    );
    if (
      !isLocatedAppIndexDefinitionV1(input.definition) ||
      input.definition.scopeId !== scopeId
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidLocatedDefinition"),
      );
    }
    const indexDefinitionId = input.definition.indexDefinitionId;
    const physicalSpec = input.definition.physicalSpec;
    const startInclusive = input.bounds.startInclusive === undefined
      ? undefined
      : yield* decodeReadFieldResult(
        decodeOrderedBoundResult(input.bounds.startInclusive),
        "invalidBounds",
      );
    const endExclusive = input.bounds.endExclusive === undefined
      ? undefined
      : yield* decodeReadFieldResult(
        decodeOrderedBoundResult(input.bounds.endExclusive),
        "invalidBounds",
      );
    const startBytes = startInclusive === undefined
      ? undefined
      : orderedIndexBoundHexV1ToBytes(startInclusive);
    const endBytes = endExclusive === undefined
      ? undefined
      : orderedIndexBoundHexV1ToBytes(endExclusive);
    if (
      startBytes !== undefined &&
      endBytes !== undefined &&
      compareBytes(startBytes, endBytes) > 0
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidBounds"),
      );
    }
    if (input.after !== undefined && !isNonArrayRecord(input.after)) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCursor"),
      );
    }
    const after = input.after === undefined
      ? undefined
      : yield* decodeCursorResult(input.after, physicalSpec);
    if (
      after !== undefined &&
      ((startBytes !== undefined && compareBytes(after.keyBytes, startBytes) < 0) ||
        (endBytes !== undefined && compareBytes(after.keyBytes, endBytes) >= 0))
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCursor"),
      );
    }
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_APP_INDEX_RANGE_PAGE_SIZE_V1
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidLimit"),
      );
    }
    return Object.freeze({
      scopeId,
      scopeProjection,
      indexDefinitionId,
      physicalSpec,
      bounds: Object.freeze({
        ...(startBytes === undefined ? {} : { startInclusive: startBytes }),
        ...(endBytes === undefined ? {} : { endExclusive: endBytes }),
      }),
      ...(after === undefined ? {} : { after }),
      limit: input.limit,
    });
  });
}

function decodeCursorResult(
  cursor: AppIndexRangeCursorV1,
  physicalSpec: AppOrderedIndexPhysicalSpecV1,
): Result.Result<NonNullable<DecodedAppIndexRangeReadV1["after"]>, InvalidAppIndexEntryInputError> {
  return Result.gen(function* () {
    const encodedKey = yield* decodeReadFieldResult(
      decodeOrderedKeyResult(cursor.encodedKey),
      "invalidCursor",
    );
    if (encodedKey.length === 0) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCursor"),
      );
    }
    yield* Result.try({
      try: () => decodeAppOrderedIndexKeyV1({ spec: physicalSpec, encodedKey }),
      catch: (cause) =>
        new InvalidAppIndexEntryInputError("invalidCursor", cause),
    });
    const rowId = yield* decodeReadFieldResult(
      decodeOrderedRowIdResult(cursor.rowId),
      "invalidCursor",
    );
    return Object.freeze({
      encodedKey,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
      rowId,
      rowIdBytes: orderedIndexRowIdHexV1ToBytes(rowId),
    });
  });
}

function buildSnapshotRangeStatement(
  input: DecodedAppIndexRangeReadV1,
  snapshotCommitSeq: CommitSeq,
): SQL {
  const predicates = rangePredicates("revision", input);
  predicates.unshift(
    sql`revision.scope_uuid = ${input.scopeUuid}`,
    sql`revision.index_definition_id = ${input.indexDefinitionId}`,
    sql`revision.commit_seq <= ${snapshotCommitSeq}`,
  );
  return sql`
    with latest as (
      select distinct on (revision.encoded_key, revision.row_id)
        revision.table_id,
        revision.key_codec_version,
        revision.physical_spec_sha256,
        revision.encoded_key,
        revision.key_sha256,
        revision.row_id,
        revision.commit_seq,
        revision.write_epoch_uuid,
        revision.is_tombstone
      from fx_app_index_entry_rev as revision
      where ${sql.join(predicates, sql` and `)}
      order by revision.encoded_key asc, revision.row_id asc,
        revision.commit_seq desc
    )
    select
      latest.table_id::text as "tableIdText",
      latest.key_codec_version::text as "keyCodecVersionText",
      latest.physical_spec_sha256 as "physicalSpecSha256",
      latest.encoded_key as "encodedKeyBytes",
      latest.key_sha256 as "keySha256",
      latest.row_id as "rowIdBytes",
      latest.commit_seq::text as "commitSeqText",
      latest.write_epoch_uuid::text as "writeEpochUuid",
      latest.is_tombstone as "isTombstone"
    from latest
    where not latest.is_tombstone
    order by latest.encoded_key asc, latest.row_id asc
    limit ${input.limit + 1}
  `;
}

function buildCurrentRangeStatement(
  input: DecodedAppIndexRangeReadV1,
): SQL {
  const predicates = rangePredicates("current_entry", input);
  predicates.unshift(
    sql`current_entry.scope_uuid = ${input.scopeUuid}`,
    sql`current_entry.index_definition_id = ${input.indexDefinitionId}`,
  );
  return sql`
    select
      revision.table_id::text as "tableIdText",
      revision.key_codec_version::text as "keyCodecVersionText",
      revision.physical_spec_sha256 as "physicalSpecSha256",
      revision.encoded_key as "encodedKeyBytes",
      revision.key_sha256 as "keySha256",
      revision.row_id as "rowIdBytes",
      revision.commit_seq::text as "commitSeqText",
      revision.write_epoch_uuid::text as "writeEpochUuid",
      revision.is_tombstone as "isTombstone"
    from fx_app_index_entry_current as current_entry
    join fx_app_index_entry_rev as revision
      on revision.scope_uuid = current_entry.scope_uuid
      and revision.index_definition_id = current_entry.index_definition_id
      and revision.encoded_key = current_entry.encoded_key
      and revision.row_id = current_entry.row_id
      and revision.commit_seq = current_entry.commit_seq
    where ${sql.join(predicates, sql` and `)}
    order by current_entry.encoded_key asc, current_entry.row_id asc
    limit ${input.limit + 1}
  `;
}

function rangePredicates(
  owner: "revision" | "current_entry",
  input: DecodedAppIndexRangeReadV1,
): SQL[] {
  const key = owner === "revision"
    ? sql`revision.encoded_key`
    : sql`current_entry.encoded_key`;
  const rowId = owner === "revision"
    ? sql`revision.row_id`
    : sql`current_entry.row_id`;
  const predicates: SQL[] = [];
  if (input.bounds.startInclusive !== undefined) {
    predicates.push(sql`${key} >= ${input.bounds.startInclusive}`);
  }
  if (input.bounds.endExclusive !== undefined) {
    predicates.push(sql`${key} < ${input.bounds.endExclusive}`);
  }
  if (input.after !== undefined) {
    predicates.push(
      sql`(${key}, ${rowId}) > (${input.after.keyBytes}, ${input.after.rowIdBytes})`,
    );
  }
  return predicates;
}

const executeAndDecodeRangeEffect = Effect.fn(
  "AppIndexEntries.executeAndDecodeRange",
)(function* (
  tx: AppIndexEntryTransaction,
  input: DecodedAppIndexRangeReadV1,
  statement: SQL,
  operation: AppIndexEntryReadPersistenceError["operation"],
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const driverResult = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(statement),
    catch: (cause) => new AppIndexEntryReadPersistenceError(operation, cause),
  }));
  const rows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(driverResult, () => {
      throw new AppIndexEntryStorageCorruptionError("driver result has no rows");
    }),
    catch: (cause) => cause instanceof AppIndexEntryStorageCorruptionError
      ? cause
      : new AppIndexEntryReadPersistenceError(operation, cause),
  });
  const decoded: AppIndexRangeEntryV1[] = [];
  for (const row of rows) {
    decoded.push(yield* decodeRangeRowEffect(input, row));
  }
  const isDone = decoded.length <= input.limit;
  const entries = Object.freeze(decoded.slice(0, input.limit));
  const last = entries.at(-1);
  const continueCursor = isDone || last === undefined
    ? null
    : Object.freeze({ encodedKey: last.encodedKey, rowId: last.rowId });
  return Object.freeze({ entries, isDone, continueCursor });
});

const decodeRangeRowEffect = Effect.fn(
  "AppIndexEntries.decodeRangeRow",
)(function* (
  input: DecodedAppIndexRangeReadV1,
  value: unknown,
): Effect.fn.Return<
  AppIndexRangeEntryV1,
  AppIndexEntryHashError | AppIndexEntryStorageCorruptionError
> {
  const captured = yield* Effect.fromResult(
    captureRangeRowResult(
      input.physicalSpec,
      input.physicalSpecSha256,
      value,
    ),
  );
  const observedSha256 = yield* sha256Effect(captured.keyBytes, "read");
  if (!bytesEqualFullScan(observedSha256, captured.keySha256)) {
    return yield* Effect.fail(
      new AppIndexEntryStorageCorruptionError("key digest does not match key bytes"),
    );
  }
  return Object.freeze({
    scopeId: input.scopeId,
    scopeUuid: input.scopeUuid,
    indexDefinitionId: input.indexDefinitionId,
    tableId: captured.tableId,
    encodedKey: captured.encodedKey,
    rowId: captured.rowId,
    writeEpochUuid: captured.writeEpochUuid,
    commitSeq: captured.commitSeq,
    keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
    keySha256: new Uint8Array(captured.keySha256),
    physicalSpecSha256: new Uint8Array(captured.physicalSpecSha256),
  });
});

function captureRangeRowResult(
  physicalSpec: AppOrderedIndexPhysicalSpecV1,
  expectedPhysicalSpecSha256: Uint8Array,
  value: unknown,
): Result.Result<{
  readonly tableId: CatalogTableId;
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly keyBytes: Uint8Array;
  readonly keySha256: Uint8Array;
  readonly physicalSpecSha256: Uint8Array;
  readonly rowId: AppRowIdHexV1;
  readonly commitSeq: CommitSeq;
  readonly writeEpochUuid: ScopeEpochUuidV1;
}, AppIndexEntryStorageCorruptionError> {
  return Result.gen(function* () {
    if (!isNonArrayRecord(value)) {
      return yield* Result.fail(corruption("range row is not an object"));
    }
    const tableIdText = yield* canonicalIntegerResult(value.tableIdText);
    const tableId = yield* decodeStoredResult(decodeTableIdResult(tableIdText));
    const codecVersion = yield* canonicalIntegerResult(
      value.keyCodecVersionText,
    );
    if (codecVersion !== ORDERED_INDEX_KEY_CODEC_VERSION_V1) {
      return yield* Result.fail(corruption("key codec version is invalid"));
    }
    if (
      !isUint8Array(value.physicalSpecSha256) ||
      value.physicalSpecSha256.byteLength !== 32
    ) {
      return yield* Result.fail(
        corruption("physical-spec digest is invalid"),
      );
    }
    const physicalSpecSha256 = new Uint8Array(value.physicalSpecSha256);
    if (!bytesEqualFullScan(physicalSpecSha256, expectedPhysicalSpecSha256)) {
      return yield* Result.fail(
        corruption("physical-spec digest does not match the located definition"),
      );
    }
    if (!isUint8Array(value.encodedKeyBytes)) {
      return yield* Result.fail(corruption("encoded key bytes are invalid"));
    }
    const keyBytes = new Uint8Array(value.encodedKeyBytes);
    const encodedKey = yield* Result.try({
      try: () => orderedIndexKeyBytesHexV1FromBytes(keyBytes),
      catch: () => corruption("encoded key bytes do not decode"),
    });
    if (encodedKey.length === 0) {
      return yield* Result.fail(corruption("encoded key is empty"));
    }
    yield* Result.try({
      try: () => decodeAppOrderedIndexKeyV1({ spec: physicalSpec, encodedKey }),
      catch: (cause) => corruption(
        "encoded key does not match the physical specification",
        cause,
      ),
    });
    if (!isUint8Array(value.keySha256) || value.keySha256.byteLength !== 32) {
      return yield* Result.fail(corruption("key digest is invalid"));
    }
    const rowId = yield* orderedIndexRowIdHexV1FromBytesResult(
      value.rowIdBytes,
    ).pipe(Result.mapError(() => corruption("row identity is invalid")));
    const commitSeqText = yield* canonicalBigIntResult(value.commitSeqText);
    const commitSeq = yield* decodeStoredResult(
      decodeCommitSeqResult(commitSeqText),
    );
    if (commitSeq < 1n) {
      return yield* Result.fail(corruption("commit sequence is not positive"));
    }
    const writeEpochUuid = yield* decodeStoredResult(
      decodeScopeEpochUuidResult(value.writeEpochUuid),
    );
    if (value.isTombstone !== false) {
      return yield* Result.fail(corruption("visible range row is a tombstone"));
    }
    return Object.freeze({
      tableId,
      encodedKey,
      keyBytes,
      keySha256: new Uint8Array(value.keySha256),
      physicalSpecSha256,
      rowId,
      commitSeq,
      writeEpochUuid,
    });
  });
}

async function requireScopeUuidResult(
  tx: AppIndexEntryTransaction,
  scopeId: ScopeId,
  projection: { readonly scopeUuid: ScopeUuidV1 },
): Promise<Result.Result<ScopeUuidV1, AppIndexEntryScopeAuthorityUnavailableError>> {
  const rows = await tx
    .select({ scopeUuid: fxSystemScopeClocks.scopeUuid })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  if (rows[0]?.scopeUuid !== projection.scopeUuid) {
    return Result.fail(new AppIndexEntryScopeAuthorityUnavailableError(scopeId));
  }
  return decodeScopeUuidResult(rows[0].scopeUuid).pipe(
    Result.mapError(() => new AppIndexEntryScopeAuthorityUnavailableError(scopeId)),
  );
}

const requireScopeUuidEffect = Effect.fn(
  "AppIndexEntries.requireScopeUuid",
)(function* (
  tx: AppIndexEntryTransaction,
  scopeId: ScopeId,
  projection: { readonly scopeUuid: ScopeUuidV1 },
): Effect.fn.Return<
  ScopeUuidV1,
  AppIndexEntryScopeAuthorityUnavailableError | AppIndexEntryReadPersistenceError
> {
  const query = tx
    .select({ scopeUuid: fxSystemScopeClocks.scopeUuid })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  const rows = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) =>
      new AppIndexEntryReadPersistenceError("readScopeAuthority", cause),
  }));
  if (rows[0]?.scopeUuid !== projection.scopeUuid) {
    return yield* Effect.fail(
      new AppIndexEntryScopeAuthorityUnavailableError(scopeId),
    );
  }
  return projection.scopeUuid;
});

async function deleteRejectedRevisionResult(
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
): Promise<Result.Result<void, AppIndexEntryStorageCorruptionError>> {
  const deleted = await tx
    .delete(fxAppIndexEntryRevisions)
    .where(and(
      eq(fxAppIndexEntryRevisions.scopeUuid, revision.scopeUuid),
      eq(
        fxAppIndexEntryRevisions.indexDefinitionId,
        revision.identity.indexDefinitionId,
      ),
      eq(fxAppIndexEntryRevisions.encodedKey, revision.keyBytes),
      eq(
        fxAppIndexEntryRevisions.rowId,
        orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
      ),
      eq(fxAppIndexEntryRevisions.commitSeq, revision.commitSeq),
    ))
    .returning({ commitSeq: fxAppIndexEntryRevisions.commitSeq });
  return deleted[0] === undefined
    ? Result.fail(corruption("rejected revision could not be removed"))
    : Result.succeed(undefined);
}

async function revisionExists(
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
): Promise<boolean> {
  const rows = await tx
    .select({ commitSeq: fxAppIndexEntryRevisions.commitSeq })
    .from(fxAppIndexEntryRevisions)
    .where(and(
      eq(fxAppIndexEntryRevisions.scopeUuid, revision.scopeUuid),
      eq(
        fxAppIndexEntryRevisions.indexDefinitionId,
        revision.identity.indexDefinitionId,
      ),
      eq(fxAppIndexEntryRevisions.encodedKey, revision.keyBytes),
      eq(
        fxAppIndexEntryRevisions.rowId,
        orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
      ),
      eq(fxAppIndexEntryRevisions.commitSeq, revision.commitSeq),
    ))
    .limit(1);
  return rows[0] !== undefined;
}

async function readChainHeadResult(
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
): Promise<Result.Result<
  Readonly<{ readonly commitSeq: CommitSeq; readonly isTombstone: boolean }> | null,
  AppIndexEntryStorageCorruptionError
>> {
  const rows = await tx
    .select({
      commitSeq: fxAppIndexEntryRevisions.commitSeq,
      isTombstone: fxAppIndexEntryRevisions.isTombstone,
    })
    .from(fxAppIndexEntryRevisions)
    .where(and(
      eq(fxAppIndexEntryRevisions.scopeUuid, revision.scopeUuid),
      eq(
        fxAppIndexEntryRevisions.indexDefinitionId,
        revision.identity.indexDefinitionId,
      ),
      eq(fxAppIndexEntryRevisions.encodedKey, revision.keyBytes),
      eq(
        fxAppIndexEntryRevisions.rowId,
        orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
      ),
    ))
    .orderBy(desc(fxAppIndexEntryRevisions.commitSeq))
    .limit(1);
  const head = rows[0];
  if (head === undefined) return Result.succeed(null);
  return decodeCommitSeqResult(head.commitSeq).pipe(
    Result.mapError(() => corruption("chain-head commit sequence is invalid")),
    Result.map((commitSeq) => Object.freeze({
      commitSeq,
      isTombstone: head.isTombstone,
    })),
  );
}

async function requireParentRevisionResult(
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
): Promise<Result.Result<void, AppIndexEntryParentRevisionError>> {
  const rows = await tx
    .select({ isTombstone: fxAppRowRevisions.isTombstone })
    .from(fxAppRowRevisions)
    .where(and(
      eq(fxAppRowRevisions.scopeUuid, revision.scopeUuid),
      eq(fxAppRowRevisions.tableId, revision.identity.tableId),
      eq(
        fxAppRowRevisions.rowId,
        orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
      ),
      eq(fxAppRowRevisions.writeEpochUuid, revision.writeEpochUuid),
      eq(fxAppRowRevisions.commitSeq, revision.commitSeq),
    ))
    .limit(1);
  const parent = rows[0];
  if (parent === undefined) {
    return Result.fail(new AppIndexEntryParentRevisionError(
      revision.identity,
      revision.commitSeq,
      "missing",
    ));
  }
  if (revision.kind === "live" && parent.isTombstone) {
    return Result.fail(new AppIndexEntryParentRevisionError(
      revision.identity,
      revision.commitSeq,
      "tombstonedLiveEntry",
    ));
  }
  return Result.succeed(undefined);
}

function projectRevision(
  revision: DecodedAppendAppIndexEntryRevisionV1,
): AppIndexEntryRevisionV1 {
  return Object.freeze({
    kind: revision.kind,
    ...revision.identity,
    scopeUuid: revision.scopeUuid,
    writeEpochUuid: revision.writeEpochUuid,
    commitSeq: revision.commitSeq,
    prevCommitSeq: revision.prevCommitSeq,
    keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
    keySha256: new Uint8Array(revision.keySha256),
    physicalSpecSha256: new Uint8Array(revision.physicalSpecSha256),
  });
}

function decodeWriteFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  issue: InvalidAppIndexEntryInputIssue,
): Result.Result<Value, InvalidAppIndexEntryInputError> {
  return result.pipe(Result.mapError((cause) =>
    new InvalidAppIndexEntryInputError(issue, cause)
  ));
}

function decodeReadFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  issue: InvalidAppIndexEntryInputIssue,
): Result.Result<Value, InvalidAppIndexEntryInputError> {
  return decodeWriteFieldResult(result, issue);
}

function decodeStoredResult<Value>(
  result: Result.Result<Value, unknown>,
): Result.Result<Value, AppIndexEntryStorageCorruptionError> {
  return result.pipe(Result.mapError((cause) =>
    corruption("stored row column does not decode", cause)
  ));
}

function canonicalIntegerResult(
  value: unknown,
): Result.Result<number, AppIndexEntryStorageCorruptionError> {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(corruption("stored integer text is not canonical"));
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return Result.fail(corruption("stored integer text exceeds the safe range"));
  }
  return Result.succeed(parsed);
}

function canonicalBigIntResult(
  value: unknown,
): Result.Result<bigint, AppIndexEntryStorageCorruptionError> {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(corruption("stored bigint text is not canonical"));
  }
  return Result.succeed(BigInt(value));
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const count = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < count; index += 1) {
    const leftByte = left[index];
    const rightByte = right[index];
    if (leftByte !== rightByte) return (leftByte ?? 0) - (rightByte ?? 0);
  }
  return left.byteLength - right.byteLength;
}

function corruption(
  reason: string,
  cause?: unknown,
): AppIndexEntryStorageCorruptionError {
  return new AppIndexEntryStorageCorruptionError(
    reason,
    cause === undefined ? undefined : { cause },
  );
}

async function canonicalizePhysicalSpecResult(
  physicalSpec: AppOrderedIndexPhysicalSpecV1,
): Promise<Result.Result<
  Awaited<ReturnType<typeof canonicalizeAppIndexPhysicalSpecV1>>,
  AppIndexEntryHashError
>> {
  try {
    return Result.succeed(
      await canonicalizeAppIndexPhysicalSpecV1(physicalSpec),
    );
  } catch (cause) {
    return Result.fail(new AppIndexEntryHashError("append", cause));
  }
}

async function sha256Result(
  bytes: Uint8Array,
  operation: AppIndexEntryHashError["operation"],
): Promise<Result.Result<Uint8Array, AppIndexEntryHashError>> {
  try {
    const owned = new Uint8Array(bytes);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", owned.buffer),
    );
    return digest.byteLength === 32
      ? Result.succeed(digest)
      : Result.fail(new AppIndexEntryHashError(
        operation,
        new Error(`SHA-256 returned ${digest.byteLength} bytes`),
      ));
  } catch (cause) {
    return Result.fail(new AppIndexEntryHashError(operation, cause));
  }
}

const sha256Effect = Effect.fn("AppIndexEntries.sha256")((
  bytes: Uint8Array,
  operation: AppIndexEntryHashError["operation"],
): Effect.Effect<Uint8Array, AppIndexEntryHashError> =>
  Effect.tryPromise({
    try: async () => {
      const owned = new Uint8Array(bytes);
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", owned.buffer),
      );
      if (digest.byteLength !== 32) {
        throw new AppIndexEntryHashError(
          operation,
          new Error(`SHA-256 returned ${digest.byteLength} bytes`),
        );
      }
      return digest;
    },
    catch: (cause) => cause instanceof AppIndexEntryHashError
      ? cause
      : new AppIndexEntryHashError(operation, cause),
  }));
