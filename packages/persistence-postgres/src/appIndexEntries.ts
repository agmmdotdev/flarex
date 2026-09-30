import { closeExactAttemptScopeClockObservation, readExactScopeWriteClockObservation, exactScopeWriteClockObservationIdentity } from "./scopeClock";
import { bytesEqualFullScan, isUint8Array } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { observeDrizzleRawQuery } from "./drizzleQueryObservation";
import { type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import {
  CatalogTableIdSchema,
  CatalogIndexDefinitionIdSchema,
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
  AppIndexPhysicalSpecSha256HexV1Schema,
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
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import {
  isLocatedAppIndexDefinitionV1,
  type LocatedAppIndexDefinitionV1,
} from "./appIndexDefinitions";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import type { StrongReferenceActivationProjection } from "./frameworkSchema/binding/strongReferenceProjection";
import {
  fxAppIndexEntryCurrent,
  fxAppIndexEntryRevisions,
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemScopeClocks,
} from "./schema";

export const MAX_APP_INDEX_RANGE_PAGE_SIZE_V1 = 1_000;
const BoundedRangeCountRowSchema = Schema.Struct({
  countText: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/)),
});
const decodeBoundedRangeCountRow = Schema.decodeUnknownResult(BoundedRangeCountRowSchema,
  { onExcessProperty: "error" });

export type AppIndexEntryTransaction = FlarexMetadataTransaction;

export interface AppIndexEntryIdentityV1 {
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly tableId: CatalogTableId;
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}

interface AppendAppIndexEntryRevisionV1Base {
  readonly membershipHeadEvidence?: AppIndexMembershipHeadEvidence;
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

export type AppendPublicationIndexEntryRevisionInput = Omit<AppendAppIndexEntryRevisionV1Base, "definition"> & {
  readonly kind: "live" | "tombstone";
  readonly reference: StrongReferenceActivationProjection;
};

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

type PublicationIndexRangeInput = Omit<AppIndexRangeReadV1Base, "definition"> & {
  /** The caller must obtain this from the authenticated active binding in
   * the same publication transaction. */
  readonly publicationIndex: StrongReferenceActivationProjection["reverseIndex"];
};

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
  | "invalidBatch"
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

interface CapturedIndexReadDefinition {
  readonly scopeId: ScopeId;
  readonly scopeProjection: ScopeIdUuidProjectionV1;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
}

interface PreparedIndexReadDefinition extends CapturedIndexReadDefinition {
  readonly physicalSpecSha256: Uint8Array;
}

interface DecodedAppIndexRangeReadV1
  extends Omit<PreparedIndexReadDefinition, "scopeProjection"> {
  readonly scopeUuid: ScopeUuidV1;
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
const decodeIndexDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogIndexDefinitionIdSchema),
);
const decodePhysicalSpecDigestResult = Schema.decodeUnknownResult(
  Schema.toType(AppIndexPhysicalSpecSha256HexV1Schema),
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

/** Online membership set; its owner must abort the transaction on any failure. */
export const appendAppIndexEntryRevisionsInTransactionEffect = Effect.fn(
  "AppIndexEntries.appendBatch",
)(function* (
  tx: AppIndexEntryTransaction,
  inputs: ReadonlyArray<AppendAppIndexEntryRevisionV1Input>,
) {
  const revisions = yield* decodeAppendInputsEffect(tx, inputs);
  return yield* appendDecodedAppIndexEntryRevisionsEffect(tx, revisions, inputs.map(input => input.membershipHeadEvidence));
}, (effect, tx) => effect.pipe(Effect.onError(() => Effect.sync(() => closeExactAttemptScopeClockObservation(tx)))));

/** The common publisher supplies only a reference read from its authenticated
 * active target binding. The ordinary index revision writer still owns row
 * parent checks, revision/current writes and rollback semantics. */
export const appendPublicationIndexEntryRevisionsInTransactionEffect = Effect.fn(
  "AppIndexEntries.appendPublicationBatch",
)(function* (tx: AppIndexEntryTransaction, inputs: readonly AppendPublicationIndexEntryRevisionInput[]) {
  const revisions = yield* decodeAppendInputsEffect(tx, inputs);
  return yield* appendDecodedAppIndexEntryRevisionsEffect(tx, revisions);
}, (effect, tx) => effect.pipe(Effect.onError(() => Effect.sync(() => closeExactAttemptScopeClockObservation(tx)))));

const decodeAppendInputsEffect = Effect.fn(
  "AppIndexEntries.decodeAppendInputs",
)(function* (
  tx: AppIndexEntryTransaction,
  inputs: ReadonlyArray<AppendAppIndexEntryRevisionV1Input | AppendPublicationIndexEntryRevisionInput>,
): Effect.fn.Return<
  ReadonlyArray<DecodedAppendAppIndexEntryRevisionV1>,
  AppendAppIndexEntryRevisionV1Error
> {
  const captures: DecodedAppendAppIndexEntryCapture[] = [];
  const positions = new Set<string>();
  for (const input of inputs) {
    const captured = yield* Effect.fromResult(captureAppendInputResult(input));
    const first = captures[0];
    if (
      first !== undefined &&
      (captured.identity.scopeId !== first.identity.scopeId ||
        captured.writeEpochUuid !== first.writeEpochUuid ||
        captured.commitSeq !== first.commitSeq)
    )
      return yield* Effect.fail(
        new InvalidAppIndexEntryInputError("invalidBatch"),
      );
    const key = indexPositionKey(
      captured.scopeProjection.scopeUuid,
      captured.identity,
    );
    if (positions.has(key))
      return yield* Effect.fail(
        new InvalidAppIndexEntryInputError("invalidBatch"),
      );
    positions.add(key);
    captures.push(captured);
  }
  const first = captures[0];
  if (first === undefined) return [];
  const observed = readExactScopeWriteClockObservation(tx, first.identity.scopeId);
  const clocks = observed === undefined ? yield* appendQueryEffect(
    tx
      .select({
        scopeUuid: fxSystemScopeClocks.scopeUuid,
        epochUuid: fxSystemScopeClocks.epochUuid,
      })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, first.identity.scopeId))
      .limit(1),
  ) : [{ scopeUuid: first.scopeProjection.scopeUuid,
    epochUuid: (yield* Effect.fromResult(projectScopeEpochUuidV1Result(observed.epoch)).pipe(Effect.mapError(cause => corruption("issued clock epoch is invalid", cause)))).epochUuid }];
  if (
    clocks[0]?.scopeUuid !== first.scopeProjection.scopeUuid ||
    clocks[0].epochUuid !== first.writeEpochUuid
  )
    return yield* Effect.fail(
      new AppIndexEntryScopeAuthorityUnavailableError(first.identity.scopeId),
    );
  const specs = new Map<AppOrderedIndexPhysicalSpecV1, Uint8Array>();
  const revisions: DecodedAppendAppIndexEntryRevisionV1[] = [];
  for (const captured of captures) {
    let digest = specs.get(captured.physicalSpec);
    if (digest === undefined) {
      const spec = yield* Effect.tryPromise({
        try: () => canonicalizeAppIndexPhysicalSpecV1(captured.physicalSpec),
        catch: (cause) => new AppIndexEntryHashError("append", cause),
      });
      digest = appIndexPhysicalSpecSha256HexV1ToBytes(spec.sha256Hex);
      specs.set(captured.physicalSpec, digest);
    }
    if (captured.expectedPhysicalSpecSha256Hex !== undefined) {
      const expected = yield* Effect.fromResult(decodePhysicalSpecDigestResult(
        captured.expectedPhysicalSpecSha256Hex).pipe(Result.mapError(cause =>
          new AppIndexEntryStorageCorruptionError("invalid activation index digest", { cause }))));
      if (!bytesEqualFullScan(digest, appIndexPhysicalSpecSha256HexV1ToBytes(expected)))
        return yield* Effect.fail(new AppIndexEntryStorageCorruptionError("activation index digest mismatch"));
    }
    revisions.push({
      historical: false,
      kind: captured.kind,
      identity: captured.identity,
      scopeUuid: captured.scopeProjection.scopeUuid,
      commitSeq: captured.commitSeq,
      physicalSpec: captured.physicalSpec,
      physicalSpecSha256: digest,
      keyBytes: captured.keyBytes,
      keySha256: yield* sha256Effect(captured.keyBytes, "append"),
    });
  }
  return revisions;
});

function indexPositionKey(
  scopeUuid: ScopeUuidV1,
  identity: Pick<
    AppIndexEntryIdentityV1,
    "indexDefinitionId" | "encodedKey" | "rowId"
  >,
): string {
  return `${scopeUuid}/${identity.indexDefinitionId}/${identity.encodedKey}/${identity.rowId}`;
}

const IndexWriteReturnSchema = Schema.Struct({
  scopeUuid: Schema.toType(ScopeUuidV1Schema),
  indexDefinitionId: Schema.toType(CatalogIndexDefinitionIdSchema),
  encodedKey: Schema.Uint8Array,
  rowId: Schema.Uint8Array,
  commitSeq: Schema.toType(CommitSeqSchema),
});
const decodeIndexWriteReturn = Schema.decodeUnknownResult(
  IndexWriteReturnSchema,
);
const ParentRowSchema = Schema.Struct({
  scopeUuid: Schema.toType(ScopeUuidV1Schema),
  tableId: Schema.toType(CatalogTableIdSchema),
  rowId: Schema.Uint8Array,
  isTombstone: Schema.Boolean,
});
const decodeParentRow = Schema.decodeUnknownResult(ParentRowSchema);

function verifyIndexWritesResult(
  expected: ReadonlyArray<
    Readonly<{
      revision: DecodedAppendAppIndexEntryRevisionV1;
      commitSeq: CommitSeq;
    }>
  >,
  returned: ReadonlyArray<unknown>,
  operation: "revision" | "current",
): Result.Result<
  void,
  AppIndexEntryRevisionAlreadyExistsError | AppIndexEntryStorageCorruptionError
> {
  return Result.gen(function* () {
    const wanted = new Map(
      expected.map((entry) => [
        indexPositionKey(entry.revision.scopeUuid, entry.revision.identity),
        entry,
      ]),
    );
    const seen = new Set<string>();
    for (const raw of returned) {
      const row = yield* decodeStoredResult(decodeIndexWriteReturn(raw));
      const rowId = yield* decodeStoredResult(
        orderedIndexRowIdHexV1FromBytesResult(row.rowId),
      );
      const encodedKey = yield* Result.try({
        try: () => orderedIndexKeyBytesHexV1FromBytes(row.encodedKey),
        catch: (cause) => corruption("returned encoded key is invalid", cause),
      });
      const key = indexPositionKey(row.scopeUuid, {
        indexDefinitionId: row.indexDefinitionId,
        encodedKey,
        rowId,
      });
      if (seen.has(key) || wanted.get(key)?.commitSeq !== row.commitSeq)
        return yield* Result.fail(
          corruption(
            "unexpected or duplicate returned index identity/sequence",
          ),
        );
      seen.add(key);
    }
    for (const entry of expected) {
      if (
        !seen.has(
          indexPositionKey(entry.revision.scopeUuid, entry.revision.identity),
        )
      )
        return yield* Result.fail(
          operation === "revision"
            ? new AppIndexEntryRevisionAlreadyExistsError(
                entry.revision.identity,
                entry.revision.commitSeq,
              )
            : corruption(
                "membership current pointer changed during transition",
              ),
        );
    }
  });
}

function indexParentKey(
  scope: ScopeUuidV1,
  table: CatalogTableId,
  row: OrderedIndexRowIdHexV1,
): string {
  return `${scope}/${table}/${row}`;
}

const requireParentRowsEffect = Effect.fn("AppIndexEntries.requireParentRows")(
  function* (
    tx: AppIndexEntryTransaction,
    revisions: ReadonlyArray<DecodedAppendAppIndexEntryRevisionV1>,
  ): Effect.fn.Return<
    void,
    | AppIndexEntryParentRowError
    | AppIndexEntryStorageCorruptionError
    | AppIndexEntryWritePersistenceError
  > {
    const wanted = new Set(
      revisions.map((revision) =>
        indexParentKey(
          revision.scopeUuid,
          revision.identity.tableId,
          revision.identity.rowId,
        ),
      ),
    );
    const rows = yield* appendQueryEffect(
      tx
        .select({
          scopeUuid: fxAppRowCurrent.scopeUuid,
          tableId: fxAppRowCurrent.tableId,
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
          or(
            ...revisions.map((revision) =>
              and(
                eq(fxAppRowCurrent.scopeUuid, revision.scopeUuid),
                eq(fxAppRowCurrent.tableId, revision.identity.tableId),
                eq(
                  fxAppRowCurrent.rowId,
                  orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
                ),
              ),
            ),
          ),
        ),
    );
    const parents = new Map<string, boolean>();
    for (const raw of rows) {
      const row = yield* Effect.fromResult(
        decodeStoredResult(decodeParentRow(raw)),
      );
      const rowId = yield* Effect.fromResult(
        decodeStoredResult(orderedIndexRowIdHexV1FromBytesResult(row.rowId)),
      );
      const key = indexParentKey(row.scopeUuid, row.tableId, rowId);
      if (parents.has(key) || !wanted.has(key))
        return yield* Effect.fail(
          corruption("unexpected or duplicate parent row"),
        );
      parents.set(key, row.isTombstone);
    }
    for (const revision of revisions) {
      const tombstone = parents.get(
        indexParentKey(
          revision.scopeUuid,
          revision.identity.tableId,
          revision.identity.rowId,
        ),
      );
      if (tombstone === undefined)
        return yield* Effect.fail(
          new AppIndexEntryParentRowError(revision.identity, "missing"),
        );
      if (!revision.historical && revision.kind === "live" && tombstone)
        return yield* Effect.fail(
          new AppIndexEntryParentRowError(
            revision.identity,
            "tombstonedLiveEntry",
          ),
        );
    }
  },
);

const indexRevisionReturnColumns = {
  scopeUuid: fxAppIndexEntryRevisions.scopeUuid,
  indexDefinitionId: fxAppIndexEntryRevisions.indexDefinitionId,
  encodedKey: fxAppIndexEntryRevisions.encodedKey,
  rowId: fxAppIndexEntryRevisions.rowId,
  commitSeq: fxAppIndexEntryRevisions.commitSeq,
};
const indexCurrentReturnColumns = {
  scopeUuid: fxAppIndexEntryCurrent.scopeUuid,
  indexDefinitionId: fxAppIndexEntryCurrent.indexDefinitionId,
  encodedKey: fxAppIndexEntryCurrent.encodedKey,
  rowId: fxAppIndexEntryCurrent.rowId,
  commitSeq: fxAppIndexEntryCurrent.commitSeq,
};

const appendDecodedAppIndexEntryRevisionsEffect = Effect.fn(
  "AppIndexEntries.applyBatch",
)(function* (
  tx: AppIndexEntryTransaction,
  revisions: ReadonlyArray<DecodedAppendAppIndexEntryRevisionV1>,
  evidence?: readonly (AppIndexMembershipHeadEvidence | undefined)[],
): Effect.fn.Return<
  ReadonlyArray<AppIndexEntryRevisionV1>,
  AppendAppIndexEntryRevisionV1Error
> {
  const heads: (AppIndexMembershipHeadV1 | null)[] = [];
  if (evidence?.some(value => value !== undefined)) {
    if (evidence.length !== revisions.length) return yield* Effect.fail(corruption("membership proof count differs"));
    for (let ordinal = 0; ordinal < revisions.length; ordinal++) {
      const revision = revisions[ordinal];
      const handle = evidence[ordinal];
      const issued = handle === undefined ? undefined : membershipHeadEvidence.get(handle);
      if (revision === undefined || issued?.tx !== tx || issued.epoch !== indexMutationEpoch(tx) || issued.clockIdentity === undefined ||
        issued.clockIdentity !== exactScopeWriteClockObservationIdentity(tx, revision.identity.scopeId))
        return yield* Effect.fail(corruption("membership proof is not current for this transaction"));
      const position = issued.positions.get(indexPositionKey(revision.scopeUuid, revision.identity));
      if (position === undefined || position.tableId !== revision.identity.tableId || !bytesEqualFullScan(position.physicalSpecSha256, revision.physicalSpecSha256))
        return yield* Effect.fail(corruption("membership proof does not cover this exact index position"));
      heads.push(position.head);
    }
  } else heads.push(...yield* readDecodedMembershipHeadsEffect(tx, revisions));
  indexMutationEpochs.set(tx, indexMutationEpoch(tx) + 1);
  const transitions: {
    revision: DecodedAppendAppIndexEntryRevisionV1;
    prior: CommitSeq | null;
  }[] = [];
  for (let i = 0; i < revisions.length; i += 1) {
    const revision = revisions[i];
    const head = heads[i];
    if (revision === undefined || head === undefined)
      return yield* Effect.fail(corruption("missing membership transition"));
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
    )
      return yield* Effect.fail(
        new AppIndexEntryTransitionConflictError(
          revision.identity,
          revision.commitSeq,
          head?.commitSeq ?? null,
        ),
      );
    transitions.push({ revision, prior: head?.commitSeq ?? null });
  }
  for (let offset = 0; offset < transitions.length; offset += 32) {
    const batch = transitions.slice(offset, offset + 32);
    yield* requireParentRowsEffect(
      tx,
      batch.map((entry) => entry.revision),
    );
    const inserted = yield* appendQueryEffect(
      tx
        .insert(fxAppIndexEntryRevisions)
        .values(
          batch.map(({ revision }) => ({
            scopeUuid: revision.scopeUuid,
            indexDefinitionId: revision.identity.indexDefinitionId,
            tableId: revision.identity.tableId,
            keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
            physicalSpecSha256: revision.physicalSpecSha256,
            encodedKey: revision.keyBytes,
            keySha256: revision.keySha256,
            rowId: orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
            commitSeq: revision.commitSeq,
            isTombstone: revision.kind === "tombstone",
          })),
        )
        .onConflictDoNothing()
        .returning(indexRevisionReturnColumns),
    );
    yield* Effect.fromResult(
      verifyIndexWritesResult(
        batch.map((entry) => ({
          revision: entry.revision,
          commitSeq: entry.revision.commitSeq,
        })),
        inserted,
        "revision",
      ),
    );
    const creates = batch.filter((entry) => entry.revision.kind === "live");
    if (creates.length > 0) {
      const created = yield* appendQueryEffect(
        tx
          .insert(fxAppIndexEntryCurrent)
          .values(
            creates.map(({ revision }) => ({
              scopeUuid: revision.scopeUuid,
              indexDefinitionId: revision.identity.indexDefinitionId,
              encodedKey: revision.keyBytes,
              rowId: orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
              commitSeq: revision.commitSeq,
            })),
          )
          .onConflictDoNothing()
          .returning(indexCurrentReturnColumns),
      );
      yield* Effect.fromResult(
        verifyIndexWritesResult(
          creates.map((entry) => ({
            revision: entry.revision,
            commitSeq: entry.revision.commitSeq,
          })),
          created,
          "current",
        ),
      );
    }
    const deletes = batch.filter(
      (entry) => entry.revision.kind === "tombstone",
    );
    if (deletes.length > 0) {
      const expected = [];
      for (const entry of deletes) {
        if (entry.prior === null)
          return yield* Effect.fail(
            corruption("missing prior live membership"),
          );
        expected.push({ revision: entry.revision, commitSeq: entry.prior });
      }
      const deleted = yield* appendQueryEffect(
        tx
          .delete(fxAppIndexEntryCurrent)
          .where(
            or(
              ...expected.map(({ revision, commitSeq }) =>
                and(
                  eq(fxAppIndexEntryCurrent.scopeUuid, revision.scopeUuid),
                  eq(
                    fxAppIndexEntryCurrent.indexDefinitionId,
                    revision.identity.indexDefinitionId,
                  ),
                  eq(fxAppIndexEntryCurrent.encodedKey, revision.keyBytes),
                  eq(
                    fxAppIndexEntryCurrent.rowId,
                    orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
                  ),
                  eq(fxAppIndexEntryCurrent.commitSeq, commitSeq),
                ),
              ),
            ),
          )
          .returning(indexCurrentReturnColumns),
      );
      yield* Effect.fromResult(
        verifyIndexWritesResult(expected, deleted, "current"),
      );
    }
  }
  return revisions.map(projectRevision);
});

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
  const written = yield* appendDecodedAppIndexEntryRevisionsEffect(tx, [revision]);
  const result = written[0];
  if (result === undefined) return yield* Effect.fail(corruption("backfill revision missing"));
  return result;
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

export interface AppIndexMembershipHeadEvidence { readonly _tag: "AppIndexMembershipHeadEvidence" }
const membershipHeadEvidence = new WeakMap<AppIndexMembershipHeadEvidence, Readonly<{
  tx: AppIndexEntryTransaction; epoch: number; clockIdentity: object | undefined;
  positions: ReadonlyMap<string, Readonly<{ head: AppIndexMembershipHeadV1 | null; tableId: CatalogTableId; physicalSpecSha256: Uint8Array }>>;
}>>();

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
  Readonly<{ heads: ReadonlyArray<AppIndexMembershipHeadV1 | null>; evidence: AppIndexMembershipHeadEvidence }>,
  ReadAppIndexRangeV1Error
> {
  const scopeId = input.scopeId;
  const definitions = new Map<
    LocatedAppIndexDefinitionV1,
    PreparedIndexReadDefinition
  >();
  let scopeUuid: ScopeUuidV1 | undefined;
  const decoded: DecodedMembershipPosition[] = [];
  for (const position of input.positions) {
    const {
      definition: locatedDefinition,
      encodedKey: inputKey,
      rowId: inputRowId,
    } = position;
    let definition = definitions.get(locatedDefinition);
    if (definition === undefined) {
      const captured = yield* Effect.fromResult(
        captureIndexReadDefinitionResult(scopeId, locatedDefinition),
      );
      definition = yield* prepareIndexReadDefinitionEffect(captured);
      definitions.set(locatedDefinition, definition);
    }
    if (scopeUuid === undefined) {
      scopeUuid = yield* requireScopeUuidEffect(
        tx,
        definition.scopeId,
        definition.scopeProjection,
      );
    }
    const encodedKey = yield* Effect.fromResult(
      decodeWriteFieldResult(
        decodeOrderedKeyResult(inputKey),
        "invalidEncodedKey",
      ),
    );
    yield* Effect.try({try:()=>decodeAppOrderedIndexKeyV1({spec:definition.physicalSpec,encodedKey}),catch:cause=>new InvalidAppIndexEntryInputError("invalidEncodedKey",cause)});
    const rowId = yield* Effect.fromResult(
      decodeWriteFieldResult(
        decodeOrderedRowIdResult(inputRowId),
        "invalidRowId",
      ),
    );
    decoded.push({
      identity: {
        scopeId,
        indexDefinitionId: definition.indexDefinitionId,
        tableId: locatedDefinition.access.tableId,
        encodedKey,
        rowId,
      },
      scopeUuid,
      physicalSpec: definition.physicalSpec,
      physicalSpecSha256: definition.physicalSpecSha256,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
    });
  }
  const heads = yield* readDecodedMembershipHeadsEffect(tx, decoded);
  const positions = new Map<string, Readonly<{ head: AppIndexMembershipHeadV1 | null; tableId: CatalogTableId; physicalSpecSha256: Uint8Array }>>();
  for (let ordinal = 0; ordinal < decoded.length; ordinal++) {
    const position = decoded[ordinal];
    const head = heads[ordinal];
    if (position === undefined || head === undefined) return yield* Effect.die(new Error("Membership proof lost a position"));
    positions.set(indexPositionKey(position.scopeUuid, position.identity),
      Object.freeze({ head, tableId: position.identity.tableId, physicalSpecSha256: new Uint8Array(position.physicalSpecSha256) }));
  }
  const evidence = Object.freeze({ _tag: "AppIndexMembershipHeadEvidence" as const });
  membershipHeadEvidence.set(evidence, Object.freeze({ tx, epoch: indexMutationEpoch(tx), clockIdentity: exactScopeWriteClockObservationIdentity(tx, scopeId), positions }));
  return Object.freeze({ heads, evidence });
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
  observer?: Parameters<typeof observeDrizzleRawQuery<"scanCurrent">>[2],
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
    observer,
  );
});

export const scanCurrentAppIndexInTransactionEffect = Effect.fn(
  "AppIndexEntries.scanCurrentInTransaction",
)(function* (
  tx: AppIndexEntryTransaction,
  input: ScanCurrentAppIndexV1Input,
  observer?: Parameters<typeof observeDrizzleRawQuery<"scanCurrent">>[2],
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const decoded = yield* decodeRangeReadEffect(tx, input);
  return yield* executeAndDecodeRangeEffect(
    tx,
    decoded,
    buildCurrentRangeStatement(decoded),
    "scanCurrent",
    observer,
  );
});

const decodePageBatchEnvelope = Schema.decodeUnknownResult(Schema.Struct({
  ordinal: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), present: Schema.NullOr(Schema.Boolean),
}));

/** Bounded ordinal predicates, including empty predicates. Preparation failures
 * and stored body decoding remain in demand order; the trusted consumer can
 * reject one observation before a later stored body is decoded. */
export const consumeCurrentAppIndexPagesInTransactionEffect = Effect.fn("AppIndexEntries.consumeCurrentPages")(
  function* <Failure, Requirements>(tx: AppIndexEntryTransaction, inputs: readonly ScanCurrentAppIndexV1Input[],
    error: (cause: ReadAppIndexRangeV1Error) => Failure,
    consume: (ordinal: number, page: AppIndexRangePageV1) => Effect.Effect<void, Failure, Requirements>,
  ): Effect.fn.Return<void, Failure, Requirements> {
    for (let offset = 0; offset < inputs.length;) {
      const prepared: DecodedAppIndexRangeReadV1[] = [];
      let outputBound = 0;
      let preparationFailure: ReadAppIndexRangeV1Error | undefined;
      while (offset + prepared.length < inputs.length && prepared.length < 32) {
        const input = inputs[offset + prepared.length];
        if (input === undefined) return yield* Effect.die(new Error("Index batch lost a demand"));
        const bound = (input.limit + 1) * (2048 + 256);
        if (prepared.length > 0 && outputBound + bound > 262_144) break;
        const previous = prepared[0];
        const decoded = yield* Effect.result(decodeRangeReadEffect(tx, input,
          previous === undefined ? undefined : { scopeId: previous.scopeId, scopeUuid: previous.scopeUuid }));
        if (Result.isFailure(decoded)) { preparationFailure = decoded.failure; break; }
        prepared.push(decoded.success);
        outputBound += bound;
      }
      if (prepared.length > 0) {
        const statement = sql.join(prepared.map((input, ordinal) => sql`
          select ${ordinal}::integer as "ordinal", member.* from (values (1)) as request(present)
          left join lateral (select true as "present", page.* from (${buildCurrentRangeStatement(input)}) as page) as member on true
        `), sql` union all `);
        const result = yield* Effect.uninterruptible(runDrizzleStatementEffect(tx.execute(sql`
          select * from (${statement}) as demands order by "ordinal", "encodedKeyBytes", "rowIdBytes"
        `), cause => new AppIndexEntryReadPersistenceError("scanCurrent", cause))).pipe(Effect.mapError(error));
        const rows = yield* Effect.fromResult(captureDriverRowsResult(result)).pipe(Effect.mapError(error));
        const grouped: unknown[][] = prepared.map(() => []);
        for (const raw of rows) {
          const envelope = yield* Effect.fromResult(decodePageBatchEnvelope(raw)).pipe(Effect.mapError(cause =>
            error(corruption("invalid index batch envelope", cause))));
          const group = grouped[envelope.ordinal];
          if (group === undefined) return yield* Effect.fail(error(corruption("unrequested index batch ordinal")));
          group.push(raw);
        }
        for (let ordinal = 0; ordinal < prepared.length; ordinal++) {
          const input = prepared[ordinal];
          const group = grouped[ordinal];
          if (input === undefined || group === undefined || group.length === 0)
            return yield* Effect.fail(error(corruption("missing index batch ordinal")));
          const entries: AppIndexRangeEntryV1[] = [];
          for (const raw of group) {
            const envelope = yield* Effect.fromResult(decodePageBatchEnvelope(raw)).pipe(Effect.mapError(cause =>
              error(corruption("invalid index batch envelope", cause))));
            if (envelope.present === null) {
              if (group.length !== 1) return yield* Effect.fail(error(corruption("duplicate empty index batch ordinal")));
            } else if (envelope.present === true) entries.push(yield* decodeRangeRowEffect(input, raw).pipe(Effect.mapError(error)));
            else return yield* Effect.fail(error(corruption("invalid index batch presence")));
          }
          if (entries.length > input.limit + 1) return yield* Effect.fail(error(corruption("index batch exceeded ordinal bound")));
          const page = projectRangePage(input.limit, entries);
          yield* consume(offset + ordinal, page);
        }
        offset += prepared.length;
      }
      if (preparationFailure !== undefined) return yield* Effect.fail(error(preparationFailure));
    }
  });

/** Reuse the bounded current-index reader for an index copied into the
 * target-side activation. This never opens the control catalog at settlement. */
export const scanCurrentPublicationIndexInTransactionEffect = Effect.fn(
  "AppIndexEntries.scanCurrentPublicationIndex",
)(function* (
  tx: AppIndexEntryTransaction,
  input: PublicationIndexRangeInput,
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const decoded = yield* decodeRangeReadEffect(tx, input);
  return yield* executeAndDecodeRangeEffect(tx, decoded, buildCurrentRangeStatement(decoded), "scanCurrent");
});

/** Bounded cardinality probe over the same current index range used by the
 * page reader. A transition can refuse over-budget fan-out before writing any
 * derived revisions. The result is capped at maximumEntries + 1; it is not an
 * unbounded count or a substitute for page-by-page row validation. */
export const countCurrentAppIndexRangeUpToLimitInTransactionEffect = Effect.fn(
  "AppIndexEntries.countCurrentRangeUpToLimit",
)(function* (
  tx: AppIndexEntryTransaction,
  input: Omit<ScanCurrentAppIndexV1Input, "after" | "limit"> & { readonly maximumEntries: number },
): Effect.fn.Return<number, ReadAppIndexRangeV1Error> {
  if (!Number.isSafeInteger(input.maximumEntries) || input.maximumEntries < 1 || input.maximumEntries > 65_535)
    return yield* Effect.fail(new InvalidAppIndexEntryInputError("invalidLimit"));
  const decoded = yield* decodeRangeReadEffect(tx, { ...input, limit: 1 });
  const predicates = rangePredicates("current_entry", decoded);
  predicates.unshift(sql`current_entry.scope_uuid = ${decoded.scopeUuid}`,
    sql`current_entry.index_definition_id = ${decoded.indexDefinitionId}`);
  const query = tx.execute(sql`
    select count(*)::text as "countText" from (
      select 1 from fx_app_index_entry_current as current_entry
      where ${sql.join(predicates, sql` and `)}
      limit ${input.maximumEntries + 1}
    ) as bounded
  `);
  const driverResult = yield* Effect.uninterruptible(runDrizzleStatementEffect(query,
    cause => new AppIndexEntryReadPersistenceError("scanCurrent", cause)));
  const rows = yield* Effect.fromResult(captureDriverRowsResult(driverResult));
  if (rows.length !== 1)
    return yield* Effect.fail(new AppIndexEntryStorageCorruptionError("invalid bounded range count"));
  const row = yield* Effect.fromResult(decodeBoundedRangeCountRow(rows[0])).pipe(Effect.mapError(cause =>
    new AppIndexEntryStorageCorruptionError("invalid bounded range count", { cause })));
  const count = Number(row.countText);
  if (!Number.isSafeInteger(count) || count > input.maximumEntries + 1)
    return yield* Effect.fail(new AppIndexEntryStorageCorruptionError("out-of-range bounded count"));
  return count;
});

const indexMutationEpochs = new WeakMap<AppIndexEntryTransaction, number>();
const indexMutationEpoch = (tx: AppIndexEntryTransaction) => indexMutationEpochs.get(tx) ?? 0;

/** Prefetch fixed reverse memberships; only the trusted callback may decode
 * an ordinal, so historical/lowering failures precede later membership bodies. */
export const withCurrentPublicationIndexRowsInTransactionEffect = Effect.fn("AppIndexEntries.withPublicationRowMemberships")(
  function* <Value, Failure, Requirements>(tx: AppIndexEntryTransaction, input: {
    readonly scopeId: ScopeId; readonly publicationIndex: StrongReferenceActivationProjection["reverseIndex"];
    readonly rowIds: readonly OrderedIndexRowIdHexV1[];
  }, error: (cause: ReadAppIndexRangeV1Error) => Failure,
    consume: (read: (ordinal: number) => Effect.Effect<readonly AppIndexRangeEntryV1[], Failure>) => Effect.Effect<Value, Failure, Requirements>,
  ): Effect.fn.Return<Value, Failure, Requirements> {
    if (input.rowIds.length > 32) return yield* Effect.fail(error(new InvalidAppIndexEntryInputError("invalidBatch")));
    const decoded = yield* decodeRangeReadEffect(tx, { scopeId: input.scopeId, publicationIndex: input.publicationIndex,
      bounds: {}, limit: 2 }).pipe(Effect.mapError(error));
    const rowIds: OrderedIndexRowIdHexV1[] = [];
    for (const rowId of input.rowIds) rowIds.push(yield* Effect.fromResult(decodeOrderedRowIdResult(rowId)).pipe(
      Effect.mapError(cause => error(new InvalidAppIndexEntryInputError("invalidRowId", cause)))));
    if (new Set(rowIds).size !== rowIds.length) return yield* Effect.fail(error(new InvalidAppIndexEntryInputError("invalidBatch")));
    const values = sql.join(rowIds.map((rowId, ordinal) => sql`(${ordinal}::integer, ${orderedIndexRowIdHexV1ToBytes(rowId)}::bytea)`), sql`, `);
    const result = rowIds.length === 0 ? [] : yield* Effect.uninterruptible(runDrizzleStatementEffect(tx.execute(sql`
      with requested(ordinal, row_id) as (values ${values})
      select requested.ordinal as "ordinal", member.* from requested left join lateral (
        select true as "present", revision.table_id::text as "tableIdText", revision.key_codec_version::text as "keyCodecVersionText",
          revision.physical_spec_sha256 as "physicalSpecSha256", revision.encoded_key as "encodedKeyBytes",
          revision.key_sha256 as "keySha256", revision.row_id as "rowIdBytes", revision.commit_seq::text as "commitSeqText",
          revision.is_tombstone as "isTombstone"
        from fx_app_index_entry_current as current_entry join fx_app_index_entry_rev as revision
          on revision.scope_uuid = current_entry.scope_uuid and revision.index_definition_id = current_entry.index_definition_id
          and revision.encoded_key = current_entry.encoded_key and revision.row_id = current_entry.row_id
          and revision.commit_seq = current_entry.commit_seq
        where current_entry.scope_uuid = ${decoded.scopeUuid} and current_entry.index_definition_id = ${decoded.indexDefinitionId}
          and current_entry.row_id = requested.row_id order by current_entry.encoded_key limit 3
      ) as member on true order by requested.ordinal, member."encodedKeyBytes"
    `), cause => new AppIndexEntryReadPersistenceError("scanCurrent", cause))).pipe(Effect.mapError(error));
    const rawRows = yield* Effect.fromResult(captureDriverRowsResult(result)).pipe(Effect.mapError(error));
    const groups: unknown[][] = rowIds.map(() => []);
    for (const raw of rawRows) {
      const envelope = yield* Effect.fromResult(decodePageBatchEnvelope(raw)).pipe(Effect.mapError(cause => error(corruption("reverse membership envelope invalid", cause))));
      const group = groups[envelope.ordinal];
      if (group === undefined) return yield* Effect.fail(error(corruption("reverse membership has an unrequested ordinal")));
      group.push(raw);
    }
    let active = true;
    const epoch = indexMutationEpoch(tx);
    const clockIdentity = exactScopeWriteClockObservationIdentity(tx, input.scopeId);
    const read = Effect.fn("AppIndexEntries.readPublicationRowOrdinal")(function* (ordinal: number) {
      if (!active || epoch !== indexMutationEpoch(tx) ||
        clockIdentity !== exactScopeWriteClockObservationIdentity(tx, input.scopeId))
        return yield* Effect.fail(error(corruption("reverse membership capture is closed")));
      const rows = groups[ordinal];
      if (rows === undefined || rows.length === 0 || rows.length > 3)
        return yield* Effect.fail(error(corruption("reverse membership ordinal bound differs")));
      const entries: AppIndexRangeEntryV1[] = [];
      for (const raw of rows) {
        const envelope = yield* Effect.fromResult(decodePageBatchEnvelope(raw)).pipe(Effect.mapError(cause => error(corruption("reverse membership envelope invalid", cause))));
        if (envelope.present === null) {
          if (rows.length !== 1) return yield* Effect.fail(error(corruption("reverse membership empty ordinal duplicated")));
        } else {
          const entry = yield* decodeRangeRowEffect(decoded, raw).pipe(Effect.mapError(error));
          if (entry.rowId !== rowIds[ordinal]) return yield* Effect.fail(error(corruption("reverse membership row differs")));
          entries.push(entry);
        }
      }
      if (entries.length > 2) return yield* Effect.fail(error(corruption("one row has more than two current index entries")));
      return Object.freeze(entries);
    });
    return yield* consume(read).pipe(Effect.ensuring(Effect.sync(() => { active = false; })));
  });

type ReadCurrentAppIndexEntriesForRowV1Input = {
  readonly scopeId: ScopeId;
  readonly rowId: OrderedIndexRowIdHexV1;
} & ({ readonly definition: LocatedAppIndexDefinitionV1 } |
  { readonly publicationIndex: StrongReferenceActivationProjection["reverseIndex"] });

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
  const decoded = yield* decodeRangeReadEffect(tx, { ...input, bounds: {}, limit: 2 });
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
  input: AppendAppIndexEntryRevisionV1Input | AppendPublicationIndexEntryRevisionInput,
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
    if ("definition" in input &&
      (!isLocatedAppIndexDefinitionV1(input.definition) || input.definition.scopeId !== scopeId))
      return yield* Result.fail(new InvalidAppIndexEntryInputError("invalidLocatedDefinition"));
    const indexDefinitionId = "reference" in input
      ? input.reference.reverseIndex.indexDefinitionId : input.definition.indexDefinitionId;
    const tableId = "reference" in input ? input.reference.sourceTableId : input.definition.access.tableId;
    const physicalSpec = "reference" in input ? input.reference.reverseIndex.physicalSpec : input.definition.physicalSpec;
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
      ...( "reference" in input ? { expectedPhysicalSpecSha256Hex: input.reference.reverseIndex.physicalSpecSha256Hex } : {}),
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
  readonly expectedPhysicalSpecSha256Hex?: string;
  readonly keyBytes: Uint8Array;
}

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

function captureIndexReadDefinitionResult(
  inputScopeId: ScopeId,
  definition: LocatedAppIndexDefinitionV1,
): Result.Result<CapturedIndexReadDefinition, InvalidAppIndexEntryInputError> {
  return Result.gen(function* () {
    const scopeId = yield* decodeReadFieldResult(
      decodeScopeIdResult(inputScopeId),
      "invalidScopeId",
    );
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError(
        (cause) => new InvalidAppIndexEntryInputError("invalidScopeId", cause),
      ),
    );
    if (
      !isLocatedAppIndexDefinitionV1(definition) ||
      definition.scopeId !== scopeId
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidLocatedDefinition"),
      );
    }
    return Object.freeze({
      scopeId,
      scopeProjection,
      indexDefinitionId: definition.indexDefinitionId,
      physicalSpec: definition.physicalSpec,
    });
  });
}

const prepareIndexReadDefinitionEffect = Effect.fn(
  "AppIndexEntries.prepareReadDefinition",
)(function* (
  captured: CapturedIndexReadDefinition,
): Effect.fn.Return<PreparedIndexReadDefinition, AppIndexEntryHashError> {
  const canonicalPhysicalSpec = yield* Effect.tryPromise({
    try: () => canonicalizeAppIndexPhysicalSpecV1(captured.physicalSpec),
    catch: (cause) => new AppIndexEntryHashError("read", cause),
  });
  return Object.freeze({
    scopeId: captured.scopeId,
    scopeProjection: captured.scopeProjection,
    indexDefinitionId: captured.indexDefinitionId,
    physicalSpec: captured.physicalSpec,
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
      canonicalPhysicalSpec.sha256Hex,
    ),
  });
});

const decodeRangeReadEffect = Effect.fn("AppIndexEntries.decodeRangeRead")(
  function* (
    tx: AppIndexEntryTransaction,
    input: AppIndexRangeReadV1Base | PublicationIndexRangeInput,
    observedScope?: Readonly<{ scopeId: ScopeId; scopeUuid: ScopeUuidV1 }>,
  ): Effect.fn.Return<DecodedAppIndexRangeReadV1, ReadAppIndexRangeV1Error> {
    const captured = yield* Effect.fromResult(
      decodeRangeReadInputResult(input, () => "publicationIndex" in input
        ? Result.gen(function* () {
          const scopeId = yield* decodeReadFieldResult(decodeScopeIdResult(input.scopeId), "invalidScopeId");
          const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(Result.mapError(cause =>
            new InvalidAppIndexEntryInputError("invalidScopeId", cause)));
          const indexDefinitionId = yield* decodeReadFieldResult(
            decodeIndexDefinitionIdResult(input.publicationIndex.indexDefinitionId), "invalidLocatedDefinition");
          return Object.freeze({ scopeId, scopeProjection, indexDefinitionId,
            physicalSpec: input.publicationIndex.physicalSpec });
        })
        : captureIndexReadDefinitionResult(input.scopeId, input.definition)),
    );
    const definition = yield* prepareIndexReadDefinitionEffect(captured);
    if ("publicationIndex" in input) {
      const digest = yield* Effect.fromResult(decodePhysicalSpecDigestResult(
        input.publicationIndex.physicalSpecSha256Hex).pipe(Result.mapError(cause =>
          new AppIndexEntryStorageCorruptionError("invalid activation index digest", { cause }))));
      if (!bytesEqualFullScan(definition.physicalSpecSha256, appIndexPhysicalSpecSha256HexV1ToBytes(digest)))
        return yield* Effect.fail(new AppIndexEntryStorageCorruptionError("activation index digest mismatch"));
    }
    const scopeUuid = observedScope?.scopeId === captured.scopeId && observedScope.scopeUuid === captured.scopeProjection.scopeUuid
      ? observedScope.scopeUuid : yield* requireScopeUuidEffect(tx, captured.scopeId, captured.scopeProjection);
    return Object.freeze({
      scopeId: captured.scopeId,
      scopeUuid,
      indexDefinitionId: captured.indexDefinitionId,
      physicalSpec: captured.physicalSpec,
      physicalSpecSha256: definition.physicalSpecSha256,
      bounds: captured.bounds,
      ...(captured.after === undefined ? {} : { after: captured.after }),
      limit: captured.limit,
    });
  },
);

function decodeRangeReadInputResult(
  input: Pick<AppIndexRangeReadV1Base, "scopeId" | "bounds" | "after" | "limit">,
  captureDefinition: () => Result.Result<CapturedIndexReadDefinition, InvalidAppIndexEntryInputError>,
): Result.Result<
  Omit<DecodedAppIndexRangeReadV1, "scopeUuid" | "physicalSpecSha256"> & {
    readonly scopeProjection: ScopeIdUuidProjectionV1;
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
    const definition = yield* captureDefinition();
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
        : yield* decodeCursorResult(input.after, definition.physicalSpec);
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
      ...definition,
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
    with page as materialized (
      select current_entry.scope_uuid, current_entry.index_definition_id,
        current_entry.encoded_key, current_entry.row_id, current_entry.commit_seq
      from fx_app_index_entry_current as current_entry
      where ${sql.join(predicates, sql` and `)}
      order by current_entry.encoded_key asc, current_entry.row_id asc
      limit ${input.limit + 1}
    )
    select
      revision.table_id::text as "tableIdText",
      revision.key_codec_version::text as "keyCodecVersionText",
      revision.physical_spec_sha256 as "physicalSpecSha256",
      revision.encoded_key as "encodedKeyBytes",
      revision.key_sha256 as "keySha256",
      revision.row_id as "rowIdBytes",
      revision.commit_seq::text as "commitSeqText",
      revision.is_tombstone as "isTombstone"
    from page as current_entry
    join fx_app_index_entry_rev as revision
      on revision.scope_uuid = current_entry.scope_uuid
      and revision.index_definition_id = current_entry.index_definition_id
      and revision.encoded_key = current_entry.encoded_key
      and revision.row_id = current_entry.row_id
      and revision.commit_seq = current_entry.commit_seq
    order by current_entry.encoded_key asc, current_entry.row_id asc
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
  observer?: Parameters<typeof observeDrizzleRawQuery<"scanCurrent">>[2],
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const query = tx.execute(statement);
  observeDrizzleRawQuery("scanCurrent", query, observer);
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
  return projectRangePage(input.limit, decoded);
});

function projectRangePage(limit: number, decoded: readonly AppIndexRangeEntryV1[]): AppIndexRangePageV1 {
  const isDone = decoded.length <= limit;
  const entries = Object.freeze(decoded.slice(0, limit));
  const last = entries.at(-1);
  const continueCursor = isDone || last === undefined ? null : Object.freeze({ encodedKey: last.encodedKey, rowId: last.rowId });
  return Object.freeze({ entries, isDone, continueCursor });
}

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
    const observed = readExactScopeWriteClockObservation(tx, scopeId);
  if (observed !== undefined) return projection.scopeUuid;
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
