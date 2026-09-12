import { bytesEqualFullScan, isUint8Array } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
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
} from "flarex-protocol/index-definition";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
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
  fxAppRowCurrent,
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
}

export interface AppendLiveAppIndexEntryRevisionV1Input extends AppendAppIndexEntryRevisionV1Base {
  readonly kind: "live";
}

export interface AppendTombstoneAppIndexEntryRevisionV1Input extends AppendAppIndexEntryRevisionV1Base {
  readonly kind: "tombstone";
}

export type AppendAppIndexEntryRevisionV1Input =
  | AppendLiveAppIndexEntryRevisionV1Input
  | AppendTombstoneAppIndexEntryRevisionV1Input;

export interface AppIndexEntryRevisionV1 extends AppIndexEntryIdentityV1 {
  readonly kind: "live" | "tombstone";
  readonly scopeUuid: ScopeUuidV1;
  readonly commitSeq: CommitSeq;
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

export interface ScanAppIndexAtSnapshotV1Input extends AppIndexRangeReadV1Base {
  readonly snapshotCommitSeq: CommitSeq;
}

export type ScanCurrentAppIndexV1Input = AppIndexRangeReadV1Base;

export interface AppIndexRangeEntryV1 extends AppIndexEntryIdentityV1 {
  readonly scopeUuid: ScopeUuidV1;
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

export class AppIndexEntryTransitionConflictError extends Error {
  readonly _tag = "AppIndexEntryTransitionConflictError" as const;
  constructor(
    readonly identity: AppIndexEntryIdentityV1,
    readonly commitSeq: CommitSeq,
    readonly actualHeadCommitSeq: CommitSeq | null,
  ) {
    super(
      `Invalid membership transition at ${identity.scopeId}/${identity.indexDefinitionId}/${identity.rowId}/${commitSeq}; latest ${actualHeadCommitSeq ?? "missing"}.`,
    );
    this.name = "AppIndexEntryTransitionConflictError";
  }
}

export class AppIndexEntryParentRowError extends Error {
  readonly _tag = "AppIndexEntryParentRowError" as const;
  constructor(
    readonly identity: AppIndexEntryIdentityV1,
    readonly reason: "missing" | "tombstonedLiveEntry",
  ) {
    super(
      `App-index parent row identity is ${reason} at ${identity.scopeId}/${identity.tableId}/${identity.rowId}.`,
    );
    this.name = "AppIndexEntryParentRowError";
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

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
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

export class AppIndexEntryWritePersistenceError extends Error {
  readonly _tag = "AppIndexEntryWritePersistenceError" as const;
  constructor(readonly cause: unknown) {
    super("App-index entry append query failed.", { cause });
    this.name = "AppIndexEntryWritePersistenceError";
  }
}

const appendQueryEffect = <T>(
  query: PromiseLike<T>,
): Effect.Effect<T, AppIndexEntryWritePersistenceError> =>
  Effect.uninterruptible(
    Effect.tryPromise({
      try: () => Promise.resolve(query),
      catch: (cause) => new AppIndexEntryWritePersistenceError(cause),
    }),
  );

export type AppendAppIndexEntryRevisionV1Error =
  | InvalidAppIndexEntryInputError
  | AppIndexEntryScopeAuthorityUnavailableError
  | AppIndexEntryRevisionAlreadyExistsError
  | AppIndexEntryTransitionConflictError
  | AppIndexEntryParentRowError
  | AppIndexEntryWritePersistenceError
  | AppIndexEntryReadPersistenceError
  | AppIndexEntryHashError
  | AppIndexEntryStorageCorruptionError;

export function isAppendAppIndexEntryRevisionV1Error(
  value: unknown,
): value is AppendAppIndexEntryRevisionV1Error {
  return (
    value instanceof InvalidAppIndexEntryInputError ||
    value instanceof AppIndexEntryScopeAuthorityUnavailableError ||
    value instanceof AppIndexEntryRevisionAlreadyExistsError ||
    value instanceof AppIndexEntryTransitionConflictError ||
    value instanceof AppIndexEntryParentRowError ||
    value instanceof AppIndexEntryWritePersistenceError ||
    value instanceof AppIndexEntryReadPersistenceError ||
    value instanceof AppIndexEntryHashError ||
    value instanceof AppIndexEntryStorageCorruptionError
  );
}

export type ReadAppIndexRangeV1Error =
  | InvalidAppIndexEntryInputError
  | AppIndexEntryScopeAuthorityUnavailableError
  | AppIndexEntryReadPersistenceError
  | AppIndexEntryHashError
  | AppIndexEntryStorageCorruptionError;

interface DecodedAppendAppIndexEntryRevisionV1 {
  readonly historical: boolean;
  readonly kind: "live" | "tombstone";
  readonly identity: AppIndexEntryIdentityV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly commitSeq: CommitSeq;
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
 * digest, and transition failures remain Result data.
 */
export async function appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
  tx: AppIndexEntryTransaction,
  input: AppendAppIndexEntryRevisionV1Input,
): Promise<
  Result.Result<AppIndexEntryRevisionV1, AppendAppIndexEntryRevisionV1Error>
> {
  const appended = await Effect.runPromise(
    Effect.result(
      decodeAppendInputEffect(tx, input).pipe(
        Effect.flatMap((revision) =>
          appendDecodedAppIndexEntryRevisionEffect(tx, revision),
        ),
      ),
    ),
  );
  return Result.match(appended, {
    onFailure: (error) => {
      // The Promise transaction boundary preserves driver rejection for rollback.
      if (
        error instanceof AppIndexEntryWritePersistenceError ||
        error instanceof AppIndexEntryReadPersistenceError
      )
        throw error.cause;
      return Result.fail(error);
    },
    onSuccess: Result.succeed,
  });
}

interface AppendBackfilledAppIndexEntryRevisionV1Input {
  readonly kind: "live" | "tombstone";
  readonly scopeId: ScopeId;
  readonly scopeUuid: ScopeUuidV1;
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly commitSeq: CommitSeq;
}

/**
 * Package-internal backfill primitive. The builder authenticates historical
 * row/fact epochs and owns the current scope-clock fence. Membership stores
 * only its transition sequence and stable row identity.
 */
export const appendBuiltAppIndexEntryRevisionInTransactionEffect = Effect.fn(
  "AppIndexEntries.appendBuiltInTransaction",
)(function* (
  tx: AppIndexEntryTransaction,
  input: AppendBackfilledAppIndexEntryRevisionV1Input,
): Effect.fn.Return<
  AppIndexEntryRevisionV1,
  AppendAppIndexEntryRevisionV1Error
> {
  const revision = yield* decodeBackfilledAppendInputEffect(tx, input);
  return yield* appendDecodedAppIndexEntryRevisionEffect(tx, revision);
});

const appendDecodedAppIndexEntryRevisionEffect = Effect.fn(
  "AppIndexEntries.appendDecoded",
)(function* (
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
): Effect.fn.Return<
  AppIndexEntryRevisionV1,
  AppendAppIndexEntryRevisionV1Error
> {
  const head = yield* readDecodedMembershipHeadEffect(tx, revision);
  if (head?.commitSeq === revision.commitSeq)
    return yield* Effect.fail(
      new AppIndexEntryRevisionAlreadyExistsError(
        revision.identity,
        revision.commitSeq,
      ),
    );
  if (
    (head !== null && head.commitSeq >= revision.commitSeq) ||
    (revision.kind === "live"
      ? head?.isTombstone === false
      : head === null || head.isTombstone)
  ) {
    return yield* Effect.fail(
      new AppIndexEntryTransitionConflictError(
        revision.identity,
        revision.commitSeq,
        head?.commitSeq ?? null,
      ),
    );
  }
  yield* requireParentRowEffect(tx, revision);
  const rowIdBytes = orderedIndexRowIdHexV1ToBytes(revision.identity.rowId);
  const inserted = yield* appendQueryEffect(
    tx
      .insert(fxAppIndexEntryRevisions)
      .values({
        scopeUuid: revision.scopeUuid,
        indexDefinitionId: revision.identity.indexDefinitionId,
        tableId: revision.identity.tableId,
        keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
        physicalSpecSha256: revision.physicalSpecSha256,
        encodedKey: revision.keyBytes,
        keySha256: revision.keySha256,
        rowId: rowIdBytes,
        commitSeq: revision.commitSeq,
        isTombstone: revision.kind === "tombstone",
      })
      .onConflictDoNothing()
      .returning({ commitSeq: fxAppIndexEntryRevisions.commitSeq }),
  );
  if (inserted.length !== 1)
    return yield* Effect.fail(
      new AppIndexEntryRevisionAlreadyExistsError(
        revision.identity,
        revision.commitSeq,
      ),
    );
  const advanced = yield* appendQueryEffect(
    revision.kind === "live"
      ? tx
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
      : tx
          .delete(fxAppIndexEntryCurrent)
          .where(
            and(
              eq(fxAppIndexEntryCurrent.scopeUuid, revision.scopeUuid),
              eq(
                fxAppIndexEntryCurrent.indexDefinitionId,
                revision.identity.indexDefinitionId,
              ),
              eq(fxAppIndexEntryCurrent.encodedKey, revision.keyBytes),
              eq(fxAppIndexEntryCurrent.rowId, rowIdBytes),
              eq(
                fxAppIndexEntryCurrent.commitSeq,
                head?.commitSeq ?? revision.commitSeq,
              ),
            ),
          )
          .returning({ commitSeq: fxAppIndexEntryCurrent.commitSeq }),
  );
  if (advanced.length !== 1) {
    yield* deleteRejectedRevisionEffect(tx, revision);
    return yield* Effect.fail(
      corruption("membership current pointer changed during transition"),
    );
  }
  return projectRevision(revision);
});

export interface AppIndexEntryPositionV1 {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}
export interface AppIndexMembershipHeadV1 {
  readonly commitSeq: CommitSeq;
  readonly isTombstone: boolean;
}
interface DecodedMembershipPosition {
  readonly identity: AppIndexEntryIdentityV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly physicalSpecSha256: Uint8Array;
  readonly keyBytes: Uint8Array;
}
const MembershipHeadEnvelopeSchema = Schema.Struct({
  ordinal: Schema.String,
  currentCommitSeq: Schema.NullOr(Schema.String),
  commitSeqText: Schema.NullOr(Schema.String),
});
const decodeMembershipHeadEnvelope = Schema.decodeUnknownResult(
  MembershipHeadEnvelopeSchema,
);

/** Authenticate latest membership and its exact current pointer before omitting a write. */
export const readAppIndexMembershipHeadsInTransactionEffect = Effect.fn(
  "AppIndexEntries.readMembershipHeads",
)(function* (
  tx: AppIndexEntryTransaction,
  input: {
    readonly scopeId: ScopeId;
    readonly positions: ReadonlyArray<AppIndexEntryPositionV1>;
  },
): Effect.fn.Return<
  ReadonlyArray<AppIndexMembershipHeadV1 | null>,
  ReadAppIndexRangeV1Error
> {
  const definitions = new Map<
    LocatedAppIndexDefinitionV1,
    DecodedAppIndexRangeReadV1
  >();
  const decoded: DecodedMembershipPosition[] = [];
  for (const position of input.positions) {
    let definition = definitions.get(position.definition);
    if (definition === undefined) {
      definition = yield* decodeRangeReadEffect(tx, {
        scopeId: input.scopeId,
        definition: position.definition,
        bounds: {},
        limit: 1,
      });
      definitions.set(position.definition, definition);
    }
    const encodedKey = yield* Effect.fromResult(
      decodeWriteFieldResult(
        decodeOrderedKeyResult(position.encodedKey),
        "invalidEncodedKey",
      ),
    );
    yield* Effect.try({try:()=>decodeAppOrderedIndexKeyV1({spec:definition.physicalSpec,encodedKey}),catch:cause=>new InvalidAppIndexEntryInputError("invalidEncodedKey",cause)});
    const rowId = yield* Effect.fromResult(
      decodeWriteFieldResult(
        decodeOrderedRowIdResult(position.rowId),
        "invalidRowId",
      ),
    );
    decoded.push({
      identity: {
        scopeId: input.scopeId,
        indexDefinitionId: definition.indexDefinitionId,
        tableId: position.definition.access.tableId,
        encodedKey,
        rowId,
      },
      scopeUuid: definition.scopeUuid,
      physicalSpec: definition.physicalSpec,
      physicalSpecSha256: definition.physicalSpecSha256,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
    });
  }
  return yield* readDecodedMembershipHeadsEffect(tx, decoded);
});

const readDecodedMembershipHeadEffect = Effect.fn(
  "AppIndexEntries.readMembershipHead",
)(function* (
  tx: AppIndexEntryTransaction,
  position: DecodedMembershipPosition,
) {
  const heads = yield* readDecodedMembershipHeadsEffect(tx, [position]);
  return heads[0] ?? null;
});
const readDecodedMembershipHeadsEffect = Effect.fn(
  "AppIndexEntries.readDecodedMembershipHeads",
)(function* (
  tx: AppIndexEntryTransaction,
  positions: ReadonlyArray<DecodedMembershipPosition>,
): Effect.fn.Return<
  ReadonlyArray<AppIndexMembershipHeadV1 | null>,
  ReadAppIndexRangeV1Error
> {
  const heads: (AppIndexMembershipHeadV1 | null)[] = [];
  for (let offset = 0; offset < positions.length; offset += 32) {
    const batch = positions.slice(offset, offset + 32);
    const values = sql.join(
      batch.map(
        (position, ordinal) =>
          sql`(${ordinal}::integer, ${position.scopeUuid}::uuid, ${position.identity.indexDefinitionId}::integer, ${position.keyBytes}::bytea, ${orderedIndexRowIdHexV1ToBytes(position.identity.rowId)}::bytea)`,
      ),
      sql`, `,
    );
    const statement = sql`
        with requested(ordinal, scope_uuid, index_definition_id, encoded_key, row_id) as (values ${values})
        select requested.ordinal::text as "ordinal", current_entry.commit_seq::text as "currentCommitSeq",
          latest.table_id::text as "tableIdText", latest.key_codec_version::text as "keyCodecVersionText",
          latest.physical_spec_sha256 as "physicalSpecSha256", latest.encoded_key as "encodedKeyBytes",
          latest.key_sha256 as "keySha256", latest.row_id as "rowIdBytes",
          latest.commit_seq::text as "commitSeqText", latest.is_tombstone as "isTombstone"
        from requested
        left join fx_app_index_entry_current as current_entry on
          current_entry.scope_uuid = requested.scope_uuid and current_entry.index_definition_id = requested.index_definition_id
          and current_entry.encoded_key = requested.encoded_key and current_entry.row_id = requested.row_id
        left join lateral (
          select revision.* from fx_app_index_entry_rev as revision
          where revision.scope_uuid = requested.scope_uuid and revision.index_definition_id = requested.index_definition_id
            and revision.encoded_key = requested.encoded_key and revision.row_id = requested.row_id
          order by revision.commit_seq desc limit 1
        ) as latest on true order by requested.ordinal`;
    const query = tx.execute(statement);
    const result = yield* Effect.uninterruptible(
      Effect.tryPromise({
        try: () => query,
        catch: (cause) =>
          new AppIndexEntryReadPersistenceError("scanCurrent", cause),
      }),
    );
    const rows = yield* Effect.fromResult(captureDriverRowsResult(result));
    if (rows.length !== batch.length)
      return yield* Effect.fail(
        corruption("membership head result count differs"),
      );
    for (let ordinal = 0; ordinal < batch.length; ordinal += 1) {
      const position = batch[ordinal];
      if (position === undefined)
        return yield* Effect.fail(corruption("membership position missing"));
      const raw = rows[ordinal];
      const envelope = yield* Effect.fromResult(
        decodeMembershipHeadEnvelope(raw).pipe(
          Result.mapError((cause) =>
            corruption("membership head envelope invalid", cause),
          ),
        ),
      );
      if (envelope.ordinal !== String(ordinal))
        return yield* Effect.fail(
          corruption("membership position order differs"),
        );
      if (envelope.commitSeqText === null) {
        if (envelope.currentCommitSeq !== null)
          return yield* Effect.fail(
            corruption("current pointer has no membership history"),
          );
        heads.push(null);
        continue;
      }
      const membership = yield* Effect.fromResult(
        captureRangeRowResult(
          position.physicalSpec,
          position.physicalSpecSha256,
          raw,
        ),
      );
      const digest = yield* sha256Effect(membership.keyBytes, "read");
      if (
        membership.tableId !== position.identity.tableId ||
        membership.rowId !== position.identity.rowId ||
        membership.encodedKey !== position.identity.encodedKey ||
        !bytesEqualFullScan(digest, membership.keySha256) ||
        (membership.isTombstone
          ? envelope.currentCommitSeq !== null
          : envelope.currentCommitSeq !== String(membership.commitSeq))
      ) {
        return yield* Effect.fail(
          corruption("latest membership evidence or current pointer differs"),
        );
      }
      heads.push(
        Object.freeze({
          commitSeq: membership.commitSeq,
          isTombstone: membership.isTombstone,
        }),
      );
    }
  }
  return Object.freeze(heads);
});

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
  const statement = buildSnapshotRangeStatement(decoded, snapshotCommitSeq);
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
  ).pipe(
    Effect.mapError(() => new InvalidAppIndexEntryInputError("invalidRowId")),
  );
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

function captureAppendInputResult(
  input: AppendAppIndexEntryRevisionV1Input,
): Result.Result<
  DecodedAppendAppIndexEntryCapture,
  InvalidAppIndexEntryInputError
> {
  return Result.gen(function* () {
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
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError(
        (cause) => new InvalidAppIndexEntryInputError("invalidScopeId", cause),
      ),
    );
    const epochProjection = yield* projectScopeEpochUuidV1Result(
      writeEpoch,
    ).pipe(
      Result.mapError(
        (cause) =>
          new InvalidAppIndexEntryInputError("invalidWriteEpoch", cause),
      ),
    );
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
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
    });
  });
}

interface DecodedAppendAppIndexEntryCapture {
  readonly kind: "live" | "tombstone";
  readonly identity: AppIndexEntryIdentityV1;
  readonly scopeProjection: ScopeIdUuidProjectionV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly keyBytes: Uint8Array;
}

const decodeAppendInputEffect = Effect.fn("AppIndexEntries.decodeAppendInput")(
  function* (
    tx: AppIndexEntryTransaction,
    input: AppendAppIndexEntryRevisionV1Input,
  ): Effect.fn.Return<
    DecodedAppendAppIndexEntryRevisionV1,
    AppendAppIndexEntryRevisionV1Error
  > {
    const captured = yield* Effect.fromResult(captureAppendInputResult(input));
    const physicalSpec = yield* Effect.tryPromise({
      try: () => canonicalizeAppIndexPhysicalSpecV1(captured.physicalSpec),
      catch: (cause) => new AppIndexEntryHashError("append", cause),
    });
    const query = tx
      .select({
        scopeUuid: fxSystemScopeClocks.scopeUuid,
        epochUuid: fxSystemScopeClocks.epochUuid,
      })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, captured.identity.scopeId))
      .limit(1);
    const clocks = yield* Effect.uninterruptible(
      Effect.tryPromise({
        try: () => query,
        catch: (cause) =>
          new AppIndexEntryReadPersistenceError("readScopeAuthority", cause),
      }),
    );
    if (
      clocks[0]?.scopeUuid !== captured.scopeProjection.scopeUuid ||
      clocks[0].epochUuid !== captured.writeEpochUuid
    )
      return yield* Effect.fail(
        new AppIndexEntryScopeAuthorityUnavailableError(
          captured.identity.scopeId,
        ),
      );
    const keySha256 = yield* sha256Effect(captured.keyBytes, "append");
    return Object.freeze({
      historical: false,
      kind: captured.kind,
      identity: captured.identity,
      scopeUuid: captured.scopeProjection.scopeUuid,
      commitSeq: captured.commitSeq,
      physicalSpec: captured.physicalSpec,
      physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
        physicalSpec.sha256Hex,
      ),
      keyBytes: captured.keyBytes,
      keySha256,
    });
  },
);

const decodeBackfilledAppendInputEffect = Effect.fn(
  "AppIndexEntries.decodeBackfilledAppendInput",
)(function* (
  tx: AppIndexEntryTransaction,
  input: AppendBackfilledAppIndexEntryRevisionV1Input,
): Effect.fn.Return<
  DecodedAppendAppIndexEntryRevisionV1,
  | InvalidAppIndexEntryInputError
  | AppIndexEntryScopeAuthorityUnavailableError
  | AppIndexEntryHashError
  | AppIndexEntryReadPersistenceError
> {
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
    const scopeUuid = yield* decodeWriteFieldResult(
      decodeScopeUuidResult(input.scopeUuid),
      "invalidScopeId",
    );
    const expectedScope = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError(
        (cause) => new InvalidAppIndexEntryInputError("invalidScopeId", cause),
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
      try: () =>
        decodeAppOrderedIndexKeyV1({
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
    const commitSeq = yield* decodeWriteFieldResult(
      decodeCommitSeqResult(input.commitSeq),
      "invalidCommitSeq",
    );
    if (commitSeq < 1n) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCommitSeq"),
      );
    }
    return Object.freeze({
      kind: input.kind,
      identity: Object.freeze({
        scopeId,
        indexDefinitionId: input.definition.indexDefinitionId,
        tableId: input.definition.access.tableId,
        encodedKey,
        rowId,
      }),
      scopeUuid,
      commitSeq,
      physicalSpec: input.definition.physicalSpec,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
    });
  });
  const value = yield* Effect.fromResult(captured);
  yield* requireScopeUuidEffect(tx, value.identity.scopeId, {
    scopeUuid: value.scopeUuid,
  });
  const canonicalPhysicalSpec = yield* Effect.tryPromise({
    try: () => canonicalizeAppIndexPhysicalSpecV1(value.physicalSpec),
    catch: (cause) => new AppIndexEntryHashError("append", cause),
  });
  const keySha256 = yield* sha256Effect(value.keyBytes, "append");
  return Object.freeze({
    historical: true,
    kind: value.kind,
    identity: value.identity,
    scopeUuid: value.scopeUuid,
    commitSeq: value.commitSeq,
    physicalSpec: value.physicalSpec,
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
      canonicalPhysicalSpec.sha256Hex,
    ),
    keyBytes: value.keyBytes,
    keySha256,
  });
});

const decodeRangeReadEffect = Effect.fn("AppIndexEntries.decodeRangeRead")(
  function* (
    tx: AppIndexEntryTransaction,
    input: AppIndexRangeReadV1Base,
  ): Effect.fn.Return<DecodedAppIndexRangeReadV1, ReadAppIndexRangeV1Error> {
    const captured = yield* Effect.fromResult(
      decodeRangeReadInputResult(input),
    );
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
  },
);

function decodeRangeReadInputResult(
  input: AppIndexRangeReadV1Base,
): Result.Result<
  Omit<DecodedAppIndexRangeReadV1, "scopeUuid" | "physicalSpecSha256"> & {
    readonly scopeProjection: ReturnType<
      typeof projectScopeIdUuidV1Result
    > extends Result.Result<infer Value, unknown>
      ? Value
      : never;
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
    if (
      boundKeys.some(
        (key) => key !== "startInclusive" && key !== "endExclusive",
      )
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidBounds"),
      );
    }
    const scopeId = yield* decodeReadFieldResult(
      decodeScopeIdResult(input.scopeId),
      "invalidScopeId",
    );
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError(
        (cause) => new InvalidAppIndexEntryInputError("invalidScopeId", cause),
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
    const startInclusive =
      input.bounds.startInclusive === undefined
        ? undefined
        : yield* decodeReadFieldResult(
            decodeOrderedBoundResult(input.bounds.startInclusive),
            "invalidBounds",
          );
    const endExclusive =
      input.bounds.endExclusive === undefined
        ? undefined
        : yield* decodeReadFieldResult(
            decodeOrderedBoundResult(input.bounds.endExclusive),
            "invalidBounds",
          );
    const startBytes =
      startInclusive === undefined
        ? undefined
        : orderedIndexBoundHexV1ToBytes(startInclusive);
    const endBytes =
      endExclusive === undefined
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
    const after =
      input.after === undefined
        ? undefined
        : yield* decodeCursorResult(input.after, physicalSpec);
    if (
      after !== undefined &&
      ((startBytes !== undefined &&
        compareBytes(after.keyBytes, startBytes) < 0) ||
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
): Result.Result<
  NonNullable<DecodedAppIndexRangeReadV1["after"]>,
  InvalidAppIndexEntryInputError
> {
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
      latest.is_tombstone as "isTombstone"
    from latest
    where not latest.is_tombstone
    order by latest.encoded_key asc, latest.row_id asc
    limit ${input.limit + 1}
  `;
}

function buildCurrentRangeStatement(input: DecodedAppIndexRangeReadV1): SQL {
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
  const key =
    owner === "revision"
      ? sql`revision.encoded_key`
      : sql`current_entry.encoded_key`;
  const rowId =
    owner === "revision" ? sql`revision.row_id` : sql`current_entry.row_id`;
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

/** Classify only the known invalid-wrapper sentinel; getter exceptions remain defects. */
function captureDriverRowsResult(
  value: unknown,
): Result.Result<ReadonlyArray<unknown>, AppIndexEntryStorageCorruptionError> {
  const invalid = corruption("membership driver result has no rows");
  try {
    return Result.succeed(
      rowsFromDriverExecuteResult(value, () => {
        // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - this exact sentinel is immediately converted to typed corruption; getter defects escape unchanged
        throw invalid;
      }),
    );
  } catch (cause) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - exceptions from driver wrapper getters preserve their original defect identity
    if (cause !== invalid) throw cause;
    return Result.fail(invalid);
  }
}

const executeAndDecodeRangeEffect = Effect.fn(
  "AppIndexEntries.executeAndDecodeRange",
)(function* (
  tx: AppIndexEntryTransaction,
  input: DecodedAppIndexRangeReadV1,
  statement: SQL,
  operation: AppIndexEntryReadPersistenceError["operation"],
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const query = tx.execute(statement);
  const driverResult = yield* Effect.uninterruptible(
    Effect.tryPromise({
      try: () => query,
      catch: (cause) => new AppIndexEntryReadPersistenceError(operation, cause),
    }),
  );
  const rows = yield* Effect.fromResult(captureDriverRowsResult(driverResult));
  const decoded: AppIndexRangeEntryV1[] = [];
  for (const row of rows) {
    decoded.push(yield* decodeRangeRowEffect(input, row));
  }
  const isDone = decoded.length <= input.limit;
  const entries = Object.freeze(decoded.slice(0, input.limit));
  const last = entries.at(-1);
  const continueCursor =
    isDone || last === undefined
      ? null
      : Object.freeze({ encodedKey: last.encodedKey, rowId: last.rowId });
  return Object.freeze({ entries, isDone, continueCursor });
});

const decodeRangeRowEffect = Effect.fn("AppIndexEntries.decodeRangeRow")(
  function* (
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
    if (captured.isTombstone)
      return yield* Effect.fail(corruption("visible range row is a tombstone"));
    const observedSha256 = yield* sha256Effect(captured.keyBytes, "read");
    if (!bytesEqualFullScan(observedSha256, captured.keySha256)) {
      return yield* Effect.fail(
        new AppIndexEntryStorageCorruptionError(
          "key digest does not match key bytes",
        ),
      );
    }
    return Object.freeze({
      scopeId: input.scopeId,
      scopeUuid: input.scopeUuid,
      indexDefinitionId: input.indexDefinitionId,
      tableId: captured.tableId,
      encodedKey: captured.encodedKey,
      rowId: captured.rowId,
      commitSeq: captured.commitSeq,
      keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
      keySha256: new Uint8Array(captured.keySha256),
      physicalSpecSha256: new Uint8Array(captured.physicalSpecSha256),
    });
  },
);

const StoredMembershipSchema = Schema.Struct({
  tableIdText: Schema.String,
  keyCodecVersionText: Schema.String,
  physicalSpecSha256: Schema.Uint8Array,
  encodedKeyBytes: Schema.Uint8Array,
  keySha256: Schema.Uint8Array,
  rowIdBytes: Schema.Uint8Array,
  commitSeqText: Schema.String,
  isTombstone: Schema.Boolean,
});
const decodeStoredMembershipResult = Schema.decodeUnknownResult(
  StoredMembershipSchema,
);

function captureRangeRowResult(
  physicalSpec: AppOrderedIndexPhysicalSpecV1,
  expectedPhysicalSpecSha256: Uint8Array,
  raw: unknown,
): Result.Result<
  {
    readonly tableId: CatalogTableId;
    readonly encodedKey: OrderedIndexKeyBytesHexV1;
    readonly keyBytes: Uint8Array;
    readonly keySha256: Uint8Array;
    readonly physicalSpecSha256: Uint8Array;
    readonly rowId: AppRowIdHexV1;
    readonly commitSeq: CommitSeq;
    readonly isTombstone: boolean;
  },
  AppIndexEntryStorageCorruptionError
> {
  return Result.gen(function* () {
    const value = yield* decodeStoredMembershipResult(raw).pipe(
      Result.mapError((cause) =>
        corruption("membership row does not decode", cause),
      ),
    );
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
      return yield* Result.fail(corruption("physical-spec digest is invalid"));
    }
    const physicalSpecSha256 = new Uint8Array(value.physicalSpecSha256);
    if (!bytesEqualFullScan(physicalSpecSha256, expectedPhysicalSpecSha256)) {
      return yield* Result.fail(
        corruption(
          "physical-spec digest does not match the located definition",
        ),
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
      catch: (cause) =>
        corruption(
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

    return Object.freeze({
      tableId,
      encodedKey,
      keyBytes,
      keySha256: new Uint8Array(value.keySha256),
      physicalSpecSha256,
      rowId,
      commitSeq,
      isTombstone: value.isTombstone,
    });
  });
}

const requireScopeUuidEffect = Effect.fn("AppIndexEntries.requireScopeUuid")(
  function* (
    tx: AppIndexEntryTransaction,
    scopeId: ScopeId,
    projection: { readonly scopeUuid: ScopeUuidV1 },
  ): Effect.fn.Return<
    ScopeUuidV1,
    | AppIndexEntryScopeAuthorityUnavailableError
    | AppIndexEntryReadPersistenceError
  > {
    const query = tx
      .select({ scopeUuid: fxSystemScopeClocks.scopeUuid })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1);
    const rows = yield* Effect.uninterruptible(
      Effect.tryPromise({
        try: () => query,
        catch: (cause) =>
          new AppIndexEntryReadPersistenceError("readScopeAuthority", cause),
      }),
    );
    if (rows[0]?.scopeUuid !== projection.scopeUuid) {
      return yield* Effect.fail(
        new AppIndexEntryScopeAuthorityUnavailableError(scopeId),
      );
    }
    return projection.scopeUuid;
  },
);

const deleteRejectedRevisionEffect = Effect.fn(
  "AppIndexEntries.deleteRejectedRevision",
)(function* (
  tx: AppIndexEntryTransaction,
  revision: DecodedAppendAppIndexEntryRevisionV1,
) {
  const deleted = yield* appendQueryEffect(
    tx
      .delete(fxAppIndexEntryRevisions)
      .where(
        and(
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
        ),
      )
      .returning({ commitSeq: fxAppIndexEntryRevisions.commitSeq }),
  );
  if (deleted[0] === undefined)
    return yield* Effect.fail(
      corruption("rejected revision could not be removed"),
    );
});

const requireParentRowEffect = Effect.fn("AppIndexEntries.requireParentRow")(
  function* (
    tx: AppIndexEntryTransaction,
    revision: DecodedAppendAppIndexEntryRevisionV1,
  ) {
    const rows = yield* appendQueryEffect(
      tx
        .select({
          rowId: fxAppRowCurrent.rowId,
          isTombstone: fxAppRowRevisions.isTombstone,
        })
        .from(fxAppRowCurrent)
        .innerJoin(
          fxAppRowRevisions,
          and(
            eq(fxAppRowRevisions.scopeUuid, fxAppRowCurrent.scopeUuid),
            eq(fxAppRowRevisions.tableId, fxAppRowCurrent.tableId),
            eq(fxAppRowRevisions.rowId, fxAppRowCurrent.rowId),
            eq(fxAppRowRevisions.commitSeq, fxAppRowCurrent.commitSeq),
          ),
        )
        .where(
          and(
            eq(fxAppRowCurrent.scopeUuid, revision.scopeUuid),
            eq(fxAppRowCurrent.tableId, revision.identity.tableId),
            eq(
              fxAppRowCurrent.rowId,
              orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
            ),
          ),
        )
        .limit(1),
    );
    if (rows[0] === undefined)
      return yield* Effect.fail(
        new AppIndexEntryParentRowError(revision.identity, "missing"),
      );
    if (!revision.historical && revision.kind === "live" && rows[0].isTombstone)
      return yield* Effect.fail(
        new AppIndexEntryParentRowError(
          revision.identity,
          "tombstonedLiveEntry",
        ),
      );
  },
);

function projectRevision(
  revision: DecodedAppendAppIndexEntryRevisionV1,
): AppIndexEntryRevisionV1 {
  return Object.freeze({
    kind: revision.kind,
    ...revision.identity,
    scopeUuid: revision.scopeUuid,
    commitSeq: revision.commitSeq,
    keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
    keySha256: new Uint8Array(revision.keySha256),
    physicalSpecSha256: new Uint8Array(revision.physicalSpecSha256),
  });
}

function decodeWriteFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  issue: InvalidAppIndexEntryInputIssue,
): Result.Result<Value, InvalidAppIndexEntryInputError> {
  return result.pipe(
    Result.mapError(
      (cause) => new InvalidAppIndexEntryInputError(issue, cause),
    ),
  );
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
  return result.pipe(
    Result.mapError((cause) =>
      corruption("stored row column does not decode", cause),
    ),
  );
}

function canonicalIntegerResult(
  value: unknown,
): Result.Result<number, AppIndexEntryStorageCorruptionError> {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(corruption("stored integer text is not canonical"));
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return Result.fail(
      corruption("stored integer text exceeds the safe range"),
    );
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

const sha256Effect = Effect.fn("AppIndexEntries.sha256")(function* (
  bytes: Uint8Array,
  operation: AppIndexEntryHashError["operation"],
): Effect.fn.Return<Uint8Array, AppIndexEntryHashError> {
  const owned = new Uint8Array(bytes);
  const digest = yield* Effect.tryPromise({
    try: async () =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer)),
    catch: (cause) => new AppIndexEntryHashError(operation, cause),
  });
  if (digest.byteLength !== 32)
    return yield* Effect.fail(
      new AppIndexEntryHashError(
        operation,
        new Error(`SHA-256 returned ${digest.byteLength} bytes`),
      ),
    );
  return digest;
});
