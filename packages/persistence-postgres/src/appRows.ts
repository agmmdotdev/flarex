import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import {
  AppDocumentSystemFieldV1Error,
  AppCreationTimeV1Schema,
  decodeAppCreationTimeV1,
  verifyAppDocumentEvidenceV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
  AppRowIdHexV1Schema,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogTableIdSchema,
  decodeCatalogTableId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  CatalogSchemaVersionIdSchema,
  decodeCatalogSchemaVersionId,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import { MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1 } from "flarex-protocol/commit-protocol";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeIdSchema,
  ScopeUuidV1Schema,
  SnapshotTokenSchema,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeEpoch,
  type ScopeEpochUuidV1,
  type ScopeId,
  type ScopeUuidV1,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  type CanonicalFlarexValueBytesV1,
  type CanonicalFlarexValueV1,
  type FlarexValueCodecVersion,
  type FlarexValueSha256V1,
} from "flarex-protocol/value";

import type { FlarexMetadataTransaction } from "./metadataTransaction";
import {
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemScopeClocks,
} from "./schema";

export type AppRowTransaction = FlarexMetadataTransaction;

export interface AppRowIdentityV1 {
  readonly scopeId: ScopeId;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}

export interface ReadAppRowAtSnapshotV1Input extends AppRowIdentityV1 {
  readonly snapshotCommitSeq: CommitSeq;
}

export interface GetAppRowAtSnapshotV1Input {
  readonly snapshotToken: SnapshotToken;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}

export interface ReadAppRowsAtSnapshotV1Input {
  readonly scopeId: ScopeId;
  readonly tableId: CatalogTableId;
  readonly rowIds: ReadonlyArray<AppRowIdHexV1>;
  readonly snapshotCommitSeq: CommitSeq;
}

export interface PresentAppRowPointDependencyV1 {
  readonly kind: "present";
  readonly identity: AppRowIdentityV1;
  readonly revisionCommitSeq: CommitSeq;
}

export interface MissingAppRowPointDependencyV1 {
  readonly kind: "missing";
  readonly identity: AppRowIdentityV1;
  readonly basis:
    | Readonly<{ readonly kind: "noVisibleRevision" }>
    | Readonly<{
        readonly kind: "tombstone";
        readonly revisionCommitSeq: CommitSeq;
      }>;
}

export type AppRowPointDependencyV1 =
  | PresentAppRowPointDependencyV1
  | MissingAppRowPointDependencyV1;

export interface PresentAppRowPointReadResultV1 {
  readonly kind: "present";
  readonly document: CanonicalFlarexValueV1;
  readonly dependency: PresentAppRowPointDependencyV1;
}

export interface MissingAppRowPointReadResultV1 {
  readonly kind: "missing";
  readonly document: null;
  readonly dependency: MissingAppRowPointDependencyV1;
}

export type AppRowPointReadResultV1 =
  | PresentAppRowPointReadResultV1
  | MissingAppRowPointReadResultV1;

export interface AppRowValueEvidenceV1 {
  readonly codecVersion: FlarexValueCodecVersion;
  readonly valueJson: unknown;
  readonly canonicalBytes: CanonicalFlarexValueBytesV1;
  readonly sha256: FlarexValueSha256V1;
}

interface AppendAppRowRevisionV1Base extends AppRowIdentityV1 {
  readonly writeEpoch: ScopeEpoch;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly creationTime: AppCreationTimeV1;
}

export interface AppendLiveAppRowRevisionV1Input
  extends AppendAppRowRevisionV1Base {
  readonly kind: "live";
  readonly value: AppRowValueEvidenceV1;
}

export interface AppendTombstoneAppRowRevisionV1Input
  extends AppendAppRowRevisionV1Base {
  readonly kind: "tombstone";
}

export type AppendAppRowRevisionV1Input =
  | AppendLiveAppRowRevisionV1Input
  | AppendTombstoneAppRowRevisionV1Input;

export interface AppendPreparedLiveAppRowRevisionV1Input
  extends AppendAppRowRevisionV1Base {
  readonly kind: "live";
  readonly document: CanonicalFlarexValueV1;
}

export interface AppendPreparedTombstoneAppRowRevisionV1Input
  extends AppendAppRowRevisionV1Base {
  readonly kind: "tombstone";
}

export type AppendPreparedAppRowRevisionV1Input =
  | AppendPreparedLiveAppRowRevisionV1Input
  | AppendPreparedTombstoneAppRowRevisionV1Input;

interface AppRowRevisionV1Base extends AppRowIdentityV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly creationTime: AppCreationTimeV1;
}

export interface LiveAppRowRevisionV1 extends AppRowRevisionV1Base {
  readonly kind: "live";
  readonly document: CanonicalFlarexValueV1;
}

export interface TombstoneAppRowRevisionV1 extends AppRowRevisionV1Base {
  readonly kind: "tombstone";
}

export type AppRowRevisionV1 =
  | LiveAppRowRevisionV1
  | TombstoneAppRowRevisionV1;

export interface MissingAppRowRevisionV1 {
  readonly kind: "missing";
}

export type AppRowReadResultV1 =
  | MissingAppRowRevisionV1
  | AppRowRevisionV1;

const MISSING_APP_ROW_REVISION_V1 = Object.freeze({
  kind: "missing",
} satisfies MissingAppRowRevisionV1);

export class InvalidAppRowRevisionV1InputError extends Error {
  constructor(
    readonly issue:
      | { readonly reason: "nonPositiveCommitSeq"; readonly value: bigint }
      | {
          readonly reason: "invalidPreviousCommitSeq";
          readonly value: bigint;
          readonly commitSeq: bigint;
        },
  ) {
    super(
      issue.reason === "nonPositiveCommitSeq"
        ? `App-row revision commit sequence must be positive: ${issue.value}`
        : `App-row previous commit sequence ${issue.value} must be positive and less than ${issue.commitSeq}`,
    );
    this.name = "InvalidAppRowRevisionV1InputError";
  }
}

export class AppRowScopeAuthorityUnavailableError extends Error {
  readonly _tag = "AppRowScopeAuthorityUnavailableError" as const;

  constructor(readonly scopeId: ScopeId) {
    super(`Replacement app-row scope authority is unavailable: ${scopeId}`);
    this.name = "AppRowScopeAuthorityUnavailableError";
  }
}

export class AppRowRevisionAlreadyExistsError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly commitSeq: CommitSeq,
  ) {
    super(
      `App-row revision already exists at ${identity.scopeId}/${identity.tableId}/${identity.rowId}/${commitSeq}`,
    );
    this.name = "AppRowRevisionAlreadyExistsError";
  }
}

export class AppRowRevisionChainConflictError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly expectedPrevCommitSeq: CommitSeq | null,
    readonly actualCurrentCommitSeq: CommitSeq | null,
  ) {
    super(
      `App-row current pointer for ${identity.scopeId}/${identity.tableId}/${identity.rowId} is ` +
        `${actualCurrentCommitSeq ?? "missing"}; expected ${expectedPrevCommitSeq ?? "missing"}`,
    );
    this.name = "AppRowRevisionChainConflictError";
  }
}

export class AppRowCreationTimeConflictError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly expectedCreationTime: AppCreationTimeV1,
    readonly actualCreationTime: AppCreationTimeV1,
  ) {
    super(
      `App-row creation time for ${identity.scopeId}/${identity.tableId}/${identity.rowId} is ` +
        `${actualCreationTime}; expected immutable value ${expectedCreationTime}`,
    );
    this.name = "AppRowCreationTimeConflictError";
  }
}

export class AppRowStorageCorruptionError extends Error {
  readonly _tag = "AppRowStorageCorruptionError" as const;

  constructor(
    readonly identity: AppRowIdentityV1,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(
      `App-row storage ${identity.scopeId}/${identity.tableId}/${identity.rowId} is invalid: ${reason}`,
      options,
    );
    this.name = "AppRowStorageCorruptionError";
  }
}

export type AppendAppRowRevisionV1Error =
  | InvalidAppRowRevisionV1InputError
  | AppRowScopeAuthorityUnavailableError
  | AppRowRevisionAlreadyExistsError
  | AppRowRevisionChainConflictError
  | AppRowCreationTimeConflictError
  | AppRowStorageCorruptionError;

export function isAppendAppRowRevisionV1Error(
  cause: unknown,
): cause is AppendAppRowRevisionV1Error {
  return cause instanceof InvalidAppRowRevisionV1InputError ||
    cause instanceof AppRowScopeAuthorityUnavailableError ||
    cause instanceof AppRowRevisionAlreadyExistsError ||
    cause instanceof AppRowRevisionChainConflictError ||
    cause instanceof AppRowCreationTimeConflictError ||
    cause instanceof AppRowStorageCorruptionError;
}

export type InvalidAppRowReadInputIssue =
  | Readonly<{ readonly reason: "invalidSnapshotToken"; readonly cause: unknown }>
  | Readonly<{ readonly reason: "invalidScopeId"; readonly cause: unknown }>
  | Readonly<{ readonly reason: "invalidTableId"; readonly cause: unknown }>
  | Readonly<{ readonly reason: "invalidRowId"; readonly cause: unknown }>
  | Readonly<{ readonly reason: "rowLimitExceeded"; readonly cause: unknown }>
  | Readonly<{
      readonly reason: "invalidSnapshotCommitSeq";
      readonly cause: unknown;
    }>;

export class InvalidAppRowReadInputError extends Error {
  readonly _tag = "InvalidAppRowReadInputError" as const;

  constructor(readonly issue: InvalidAppRowReadInputIssue) {
    super(
      `Invalid app-row read input: ${issue.reason}.`,
      { cause: issue.cause },
    );
    this.name = "InvalidAppRowReadInputError";
  }
}

export class AppRowReadPersistenceError extends Error {
  readonly _tag = "AppRowReadPersistenceError" as const;

  constructor(
    readonly operation:
      | "readScopeAuthority"
      | "readSnapshotRevision"
      | "readCurrentPointer"
      | "readCurrentRevision",
    readonly cause: unknown,
  ) {
    super(`Failed to ${operation.replace(/([A-Z])/g, " $1").toLowerCase()}.`, {
      cause,
    });
    this.name = "AppRowReadPersistenceError";
  }
}

export type ReadAppRowError =
  | InvalidAppRowReadInputError
  | AppRowScopeAuthorityUnavailableError
  | AppRowReadPersistenceError
  | AppRowStorageCorruptionError;

const decodeScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeIdSchema),
);
const decodeCatalogTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodeAppRowIdHexV1Result = Schema.decodeUnknownResult(
  Schema.toType(AppRowIdHexV1Schema),
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeSnapshotTokenResult = Schema.decodeUnknownResult(
  Schema.toType(SnapshotTokenSchema),
);
const decodeScopeUuidV1Result = Schema.decodeUnknownResult(
  Schema.toType(ScopeUuidV1Schema),
);
const decodeScopeEpochUuidV1Result = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochUuidV1Schema),
);
const decodeCatalogSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);
const decodeAppCreationTimeV1Result = Schema.decodeUnknownResult(
  Schema.toType(AppCreationTimeV1Schema),
);
const decodeBooleanResult = Schema.decodeUnknownResult(Schema.Boolean);

interface DecodedAppRowReadIdentityV1 {
  readonly identity: AppRowIdentityV1;
  readonly projection: ReturnType<typeof projectScopeIdUuidV1>;
}

export const readAppRowAtSnapshotInTransactionEffect = Effect.fn(
  "AppRows.readAtSnapshotInTransaction",
)(function* (
  tx: AppRowTransaction,
  input: ReadAppRowAtSnapshotV1Input,
): Effect.fn.Return<AppRowReadResultV1, ReadAppRowError> {
  const decodedIdentity = yield* Effect.fromResult(
    decodeReadIdentityResult(input),
  );
  const snapshotCommitSeq = yield* Effect.fromResult(
    decodeReadFieldResult(
      decodeCommitSeqResult(input.snapshotCommitSeq),
      "invalidSnapshotCommitSeq",
    ),
  );
  return yield* readDecodedAppRowAtSnapshotInTransactionEffect(
    tx,
    decodedIdentity,
    snapshotCommitSeq,
  );
});

/**
 * Bounded set-based snapshot materialization for positions already selected by
 * an authenticated ordered index. The result follows caller row-id order and
 * requires one visible live revision for every requested identity.
 */
export const readLiveAppRowsAtSnapshotInTransactionEffect = Effect.fn(
  "AppRows.readLiveSetAtSnapshotInTransaction",
)(function* (
  tx: AppRowTransaction,
  input: ReadAppRowsAtSnapshotV1Input,
): Effect.fn.Return<ReadonlyArray<LiveAppRowRevisionV1>, ReadAppRowError> {
  if (input.rowIds.length > MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1) {
    return yield* Effect.fail(new InvalidAppRowReadInputError({
      reason: "rowLimitExceeded",
      cause: new Error(
        `Expected at most ${MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1} row identities.`,
      ),
    }));
  }
  if (input.rowIds.length === 0) return Object.freeze([]);
  const decodedIdentity = yield* Effect.fromResult(
    decodeReadIdentityResult({
      scopeId: input.scopeId,
      tableId: input.tableId,
      rowId: input.rowIds[0],
    }),
  );
  const rowIds = yield* Effect.all(
    input.rowIds.map((rowId) =>
      Effect.fromResult(decodeReadFieldResult(
        decodeAppRowIdHexV1Result(rowId),
        "invalidRowId",
      ))
    ),
    { concurrency: 1 },
  );
  if (new Set(rowIds).size !== rowIds.length) {
    return yield* Effect.fail(new InvalidAppRowReadInputError({
      reason: "invalidRowId",
      cause: new Error("Expected distinct row identities."),
    }));
  }
  const snapshotCommitSeq = yield* Effect.fromResult(
    decodeReadFieldResult(
      decodeCommitSeqResult(input.snapshotCommitSeq),
      "invalidSnapshotCommitSeq",
    ),
  );
  const scopeUuid = yield* requireScopeUuidInTransactionEffect(
    tx,
    decodedIdentity,
  );
  const rows = yield* readAppRowRowsEffect(
    tx.selectDistinctOn([fxAppRowRevisions.rowId])
      .from(fxAppRowRevisions)
      .where(and(
        eq(fxAppRowRevisions.scopeUuid, scopeUuid),
        eq(fxAppRowRevisions.tableId, input.tableId),
        inArray(
          fxAppRowRevisions.rowId,
          rowIds.map(appRowIdHexV1ToBytes),
        ),
        lte(fxAppRowRevisions.commitSeq, snapshotCommitSeq),
      ))
      .orderBy(fxAppRowRevisions.rowId, desc(fxAppRowRevisions.commitSeq)),
    "readSnapshotRevision",
  );
  const byRowId = new Map<AppRowIdHexV1, AppRowRevisionRow>();
  for (const row of rows) {
    const rowId = yield* Effect.fromResult(
      appRowIdHexV1FromBytesResult(row.rowId).pipe(
        Result.mapError((cause) => new AppRowStorageCorruptionError(
          decodedIdentity.identity,
          "set-based snapshot row identity is invalid",
          { cause },
        )),
      ),
    );
    if (byRowId.has(rowId)) {
      return yield* Effect.fail(new AppRowStorageCorruptionError(
        { ...decodedIdentity.identity, rowId },
        "set-based snapshot returned duplicate row identity",
      ));
    }
    byRowId.set(rowId, row);
  }
  const revisions: LiveAppRowRevisionV1[] = [];
  for (const rowId of rowIds) {
    const row = byRowId.get(rowId);
    if (row === undefined) {
      return yield* Effect.fail(new AppRowStorageCorruptionError(
        { ...decodedIdentity.identity, rowId },
        "index position references no visible row revision",
      ));
    }
    const revision = yield* decodeRevisionRowEffect(
      { ...decodedIdentity.identity, rowId },
      row,
    );
    if (revision.kind !== "live") {
      return yield* Effect.fail(new AppRowStorageCorruptionError(
        { ...decodedIdentity.identity, rowId },
        "index position references a tombstone row revision",
      ));
    }
    revisions.push(revision);
  }
  return Object.freeze(revisions);
});

const readDecodedAppRowAtSnapshotInTransactionEffect = Effect.fn(
  "AppRows.readDecodedAtSnapshotInTransaction",
)(function* (
  tx: AppRowTransaction,
  decodedIdentity: DecodedAppRowReadIdentityV1,
  snapshotCommitSeq: CommitSeq,
): Effect.fn.Return<AppRowReadResultV1, Exclude<
  ReadAppRowError,
  InvalidAppRowReadInputError
>> {
  const { identity } = decodedIdentity;
  const scopeUuid = yield* requireScopeUuidInTransactionEffect(
    tx,
    decodedIdentity,
  );
  const query = tx
    .select()
    .from(fxAppRowRevisions)
    .where(
      and(
        eq(fxAppRowRevisions.scopeUuid, scopeUuid),
        eq(fxAppRowRevisions.tableId, identity.tableId),
        eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId)),
        lte(fxAppRowRevisions.commitSeq, snapshotCommitSeq),
      ),
    )
    .orderBy(desc(fxAppRowRevisions.commitSeq))
    .limit(1);
  const rows = yield* readAppRowRowsEffect(
    query,
    "readSnapshotRevision",
  );
  const row = rows[0];
  return row === undefined
    ? MISSING_APP_ROW_REVISION_V1
    : yield* decodeRevisionRowEffect(identity, row);
});

/**
 * Projects authoritative history into the logical point-read result and OCC
 * evidence for one immutable snapshot. This private kernel does not authorize
 * an execution attempt or apply staged read-your-writes state; C03 owns that
 * composition before a syscall can consume it.
 */
export const getAppRowAtSnapshotInTransactionEffect = Effect.fn(
  "AppRows.getAtSnapshotInTransaction",
)(function* (
  tx: AppRowTransaction,
  input: GetAppRowAtSnapshotV1Input,
): Effect.fn.Return<AppRowPointReadResultV1, ReadAppRowError> {
  const snapshotToken = yield* Effect.fromResult(
    decodeReadFieldResult(
      decodeSnapshotTokenResult(input.snapshotToken),
      "invalidSnapshotToken",
    ),
  );
  const decodedIdentity = yield* Effect.fromResult(
    decodeReadIdentityResult({
      scopeId: snapshotToken.scopeId,
      tableId: input.tableId,
      rowId: input.rowId,
    }),
  );
  const { identity } = decodedIdentity;
  const revision = yield* readDecodedAppRowAtSnapshotInTransactionEffect(
    tx,
    decodedIdentity,
    snapshotToken.commitSeq,
  );

  switch (revision.kind) {
    case "live":
      return Object.freeze({
        kind: "present",
        document: revision.document,
        dependency: Object.freeze({
          kind: "present",
          identity,
          revisionCommitSeq: revision.commitSeq,
        } satisfies PresentAppRowPointDependencyV1),
      } satisfies PresentAppRowPointReadResultV1);
    case "tombstone":
      return Object.freeze({
        kind: "missing",
        document: null,
        dependency: Object.freeze({
          kind: "missing",
          identity,
          basis: Object.freeze({
            kind: "tombstone",
            revisionCommitSeq: revision.commitSeq,
          }),
        } satisfies MissingAppRowPointDependencyV1),
      } satisfies MissingAppRowPointReadResultV1);
    case "missing":
      return Object.freeze({
        kind: "missing",
        document: null,
        dependency: Object.freeze({
          kind: "missing",
          identity,
          basis: Object.freeze({ kind: "noVisibleRevision" }),
        } satisfies MissingAppRowPointDependencyV1),
      } satisfies MissingAppRowPointReadResultV1);
  }
});

export const readCurrentAppRowInTransactionEffect = Effect.fn(
  "AppRows.readCurrentInTransaction",
)(function* (
  tx: AppRowTransaction,
  input: AppRowIdentityV1,
): Effect.fn.Return<AppRowReadResultV1, ReadAppRowError> {
  const decodedIdentity = yield* Effect.fromResult(
    decodeReadIdentityResult(input),
  );
  const { identity } = decodedIdentity;
  const scopeUuid = yield* requireScopeUuidInTransactionEffect(
    tx,
    decodedIdentity,
  );
  const rowIdBytes = appRowIdHexV1ToBytes(identity.rowId);
  const pointerQuery = tx
    .select({ commitSeq: fxAppRowCurrent.commitSeq })
    .from(fxAppRowCurrent)
    .where(
      and(
        eq(fxAppRowCurrent.scopeUuid, scopeUuid),
        eq(fxAppRowCurrent.tableId, identity.tableId),
        eq(fxAppRowCurrent.rowId, rowIdBytes),
      ),
    )
    .limit(1);
  const pointers = yield* readAppRowRowsEffect(
    pointerQuery,
    "readCurrentPointer",
  );
  const pointer = pointers[0];
  if (pointer === undefined) return MISSING_APP_ROW_REVISION_V1;
  const revisionQuery = tx
    .select()
    .from(fxAppRowRevisions)
    .where(
      and(
        eq(fxAppRowRevisions.scopeUuid, scopeUuid),
        eq(fxAppRowRevisions.tableId, identity.tableId),
        eq(fxAppRowRevisions.rowId, rowIdBytes),
        eq(fxAppRowRevisions.commitSeq, pointer.commitSeq),
      ),
    )
    .limit(1);
  const revisions = yield* readAppRowRowsEffect(
    revisionQuery,
    "readCurrentRevision",
  );
  const revision = revisions[0];
  if (revision === undefined) {
    return yield* Effect.fail(new AppRowStorageCorruptionError(
      identity,
      `current pointer references absent revision ${pointer.commitSeq}`,
    ));
  }
  return yield* decodeRevisionRowEffect(identity, revision);
});

export async function appendAppRowRevisionAndAdvanceCurrentInTransaction(
  tx: AppRowTransaction,
  input: AppendAppRowRevisionV1Input,
): Promise<AppRowRevisionV1> {
  const decoded = await decodeAppendInput(tx, input);
  return Result.getOrThrow(
    await appendDecodedAppRowRevisionAndAdvanceCurrentInTransactionResult(
      tx,
      decoded,
    ),
  );
}

/**
 * Internal O06/O07 Result bridge for Drizzle's Promise transaction callback.
 * SQL rejection remains a rejected Promise so the callback rolls back; owned
 * app-row validation and invariant failures are returned as data.
 */
export async function appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
  tx: AppRowTransaction,
  input: AppendPreparedAppRowRevisionV1Input,
): Promise<Result.Result<AppRowRevisionV1, AppendAppRowRevisionV1Error>> {
  const decoded = await decodePreparedAppendInputResult(tx, input);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  return appendDecodedAppRowRevisionAndAdvanceCurrentInTransactionResult(
    tx,
    decoded.success,
  );
}

type DecodedAppendAppRowRevisionV1 =
  | (AppendAppRowRevisionV1Base & {
      readonly kind: "live";
      readonly identity: AppRowIdentityV1;
      readonly scopeUuid: ScopeUuidV1;
      readonly writeEpochUuid: ScopeEpochUuidV1;
      readonly document: CanonicalFlarexValueV1;
    })
  | (AppendAppRowRevisionV1Base & {
      readonly kind: "tombstone";
      readonly identity: AppRowIdentityV1;
      readonly scopeUuid: ScopeUuidV1;
      readonly writeEpochUuid: ScopeEpochUuidV1;
    });

async function appendDecodedAppRowRevisionAndAdvanceCurrentInTransactionResult(
  tx: AppRowTransaction,
  decoded: DecodedAppendAppRowRevisionV1,
): Promise<Result.Result<AppRowRevisionV1, AppendAppRowRevisionV1Error>> {
  const inserted = await tx
    .insert(fxAppRowRevisions)
    .values({
      scopeUuid: decoded.scopeUuid,
      tableId: decoded.identity.tableId,
      rowId: appRowIdHexV1ToBytes(decoded.identity.rowId),
      commitSeq: decoded.commitSeq,
      prevCommitSeq: decoded.prevCommitSeq,
      writeEpochUuid: decoded.writeEpochUuid,
      schemaVersionId: decoded.schemaVersionId,
      creationTime: decoded.creationTime,
      valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      isTombstone: decoded.kind === "tombstone",
      valueJson: decoded.kind === "live" ? decoded.document.valueJson : null,
      valueBytes:
        decoded.kind === "live" ? decoded.document.canonicalBytes : null,
      valueSha256: decoded.kind === "live" ? decoded.document.sha256 : null,
    })
    .onConflictDoNothing()
    .returning({ commitSeq: fxAppRowRevisions.commitSeq });
  if (inserted[0] === undefined) {
    return Result.fail(new AppRowRevisionAlreadyExistsError(
      decoded.identity,
      decoded.commitSeq,
    ));
  }

  const advanced =
    decoded.prevCommitSeq === null
      ? await tx
          .insert(fxAppRowCurrent)
          .values({
            scopeUuid: decoded.scopeUuid,
            tableId: decoded.identity.tableId,
            rowId: appRowIdHexV1ToBytes(decoded.identity.rowId),
            commitSeq: decoded.commitSeq,
          })
          .onConflictDoNothing()
          .returning({ commitSeq: fxAppRowCurrent.commitSeq })
      : await tx
          .update(fxAppRowCurrent)
          .set({ commitSeq: decoded.commitSeq })
          .where(
            and(
              eq(fxAppRowCurrent.scopeUuid, decoded.scopeUuid),
              eq(fxAppRowCurrent.tableId, decoded.identity.tableId),
              eq(
                fxAppRowCurrent.rowId,
                appRowIdHexV1ToBytes(decoded.identity.rowId),
              ),
              eq(fxAppRowCurrent.commitSeq, decoded.prevCommitSeq),
            ),
          )
          .returning({ commitSeq: fxAppRowCurrent.commitSeq });
  if (advanced[0] === undefined) {
    return failAdvancedCurrentPointerConflict(tx, decoded);
  }

  return Result.succeed(decoded.kind === "live"
    ? Object.freeze({
        kind: "live",
        ...decoded.identity,
        scopeUuid: decoded.scopeUuid,
        writeEpochUuid: decoded.writeEpochUuid,
        commitSeq: decoded.commitSeq,
        prevCommitSeq: decoded.prevCommitSeq,
        schemaVersionId: decoded.schemaVersionId,
        creationTime: decoded.creationTime,
        document: decoded.document,
      } satisfies LiveAppRowRevisionV1)
    : Object.freeze({
        kind: "tombstone",
        ...decoded.identity,
        scopeUuid: decoded.scopeUuid,
        writeEpochUuid: decoded.writeEpochUuid,
        commitSeq: decoded.commitSeq,
        prevCommitSeq: decoded.prevCommitSeq,
        schemaVersionId: decoded.schemaVersionId,
        creationTime: decoded.creationTime,
      } satisfies TombstoneAppRowRevisionV1));
}

async function failAdvancedCurrentPointerConflict(
  tx: AppRowTransaction,
  decoded: DecodedAppendAppRowRevisionV1,
): Promise<Result.Result<AppRowRevisionV1, AppendAppRowRevisionV1Error>> {
  const deleted = await deleteInsertedRevisionInTransactionResult(tx, decoded);
  if (Result.isFailure(deleted)) return Result.fail(deleted.failure);
  return readActualPointerCommitSeqAndFail(tx, decoded);
}

async function readActualPointerCommitSeqAndFail(
  tx: AppRowTransaction,
  decoded: DecodedAppendAppRowRevisionV1,
): Promise<Result.Result<AppRowRevisionV1, AppendAppRowRevisionV1Error>> {
  const actual = await readCurrentPointerCommitSeqResult(
    tx,
    decoded.scopeUuid,
    decoded.identity,
  );
  if (Result.isFailure(actual)) return Result.fail(actual.failure);
  return Result.fail(new AppRowRevisionChainConflictError(
    decoded.identity,
    decoded.prevCommitSeq,
    actual.success,
  ));
}

async function deleteInsertedRevisionInTransactionResult(
  tx: AppRowTransaction,
  revision: {
    readonly identity: AppRowIdentityV1;
    readonly scopeUuid: ScopeUuidV1;
    readonly commitSeq: CommitSeq;
  },
): Promise<Result.Result<void, AppRowStorageCorruptionError>> {
  const deleted = await tx
    .delete(fxAppRowRevisions)
    .where(
      and(
        eq(fxAppRowRevisions.scopeUuid, revision.scopeUuid),
        eq(fxAppRowRevisions.tableId, revision.identity.tableId),
        eq(
          fxAppRowRevisions.rowId,
          appRowIdHexV1ToBytes(revision.identity.rowId),
        ),
        eq(fxAppRowRevisions.commitSeq, revision.commitSeq),
      ),
    )
    .returning({ commitSeq: fxAppRowRevisions.commitSeq });
  if (deleted[0] === undefined) {
    return Result.fail(new AppRowStorageCorruptionError(
      revision.identity,
      `rejected revision ${revision.commitSeq} could not be removed`,
    ));
  }
  return Result.succeed(undefined);
}

type AppRowRevisionRow = typeof fxAppRowRevisions.$inferSelect;

type DecodedAppRowRevisionEvidenceV1 =
  | Readonly<{
      readonly kind: "tombstone";
      readonly base: AppRowRevisionV1Base;
    }>
  | Readonly<{
      readonly kind: "live";
      readonly base: AppRowRevisionV1Base;
      readonly valueCodecVersion: AppRowRevisionRow["valueCodecVersion"];
      readonly valueJson: NonNullable<AppRowRevisionRow["valueJson"]>;
      readonly valueBytes: NonNullable<AppRowRevisionRow["valueBytes"]>;
      readonly valueSha256: NonNullable<AppRowRevisionRow["valueSha256"]>;
    }>;

const decodeRevisionRowEffect = Effect.fn(
  "AppRows.decodeRevisionRow",
)(function* (
  identity: AppRowIdentityV1,
  row: AppRowRevisionRow,
): Effect.fn.Return<AppRowRevisionV1, AppRowStorageCorruptionError> {
  const decoded = yield* Effect.fromResult(
    decodeRevisionRowEvidenceResult(identity, row),
  );
  if (decoded.kind === "tombstone") {
    return Object.freeze({
      kind: "tombstone",
      ...decoded.base,
    } satisfies TombstoneAppRowRevisionV1);
  }
  const document = yield* Effect.tryPromise({
    try: () => verifyAppDocumentEvidenceV1({
      tableId: identity.tableId,
      rowId: identity.rowId,
      creationTime: decoded.base.creationTime,
      codecVersion: decoded.valueCodecVersion,
      valueJson: decoded.valueJson,
      canonicalBytes: decoded.valueBytes,
      sha256: decoded.valueSha256,
    }),
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause: unknown) =>
      cause instanceof AppDocumentSystemFieldV1Error ||
        cause instanceof FlarexValueCodecV1Error ||
        cause instanceof FlarexValueEvidenceV1Error
        ? Effect.fail(new AppRowStorageCorruptionError(
            identity,
            "live revision value evidence or trusted system fields do not verify",
            { cause },
          ))
        : Effect.die(cause),
    ),
  );
  return Object.freeze({
    kind: "live",
    ...decoded.base,
    document,
  } satisfies LiveAppRowRevisionV1);
});

function decodeRevisionRowEvidenceResult(
  identity: AppRowIdentityV1,
  row: AppRowRevisionRow,
): Result.Result<
  DecodedAppRowRevisionEvidenceV1,
  AppRowStorageCorruptionError
> {
  return Result.gen(function* () {
    // Interleave driver-row access and decoding in storage-contract order.
    // Accessor/runtime throws stay defects, while an earlier typed failure
    // short-circuits before any later property is observed.
    const storedRowIdBytes = row.rowId;
    const storedRowId = yield* appRowIdHexV1FromBytesResult(
      storedRowIdBytes,
    ).pipe(Result.mapError((cause) =>
      storedRevisionColumnsCorruption(identity, cause)
    ));
    if (storedRowId !== identity.rowId) {
      return yield* Result.fail(new AppRowStorageCorruptionError(
        identity,
        "row identity changed",
      ));
    }
    const storedScopeUuid = row.scopeUuid;
    const scopeUuid = yield* decodeStoredRevisionColumnResult(
      identity,
      decodeScopeUuidV1Result(storedScopeUuid),
    );
    const storedWriteEpochUuid = row.writeEpochUuid;
    const writeEpochUuid = yield* decodeStoredRevisionColumnResult(
      identity,
      decodeScopeEpochUuidV1Result(storedWriteEpochUuid),
    );
    const storedCommitSeq = row.commitSeq;
    const commitSeq = yield* decodeStoredPositiveCommitSeqResult(
      identity,
      storedCommitSeq,
    );
    const storedPrevCommitSeq = row.prevCommitSeq;
    const prevCommitSeq = storedPrevCommitSeq === null
      ? null
      : yield* decodeStoredPositiveCommitSeqResult(
          identity,
          storedPrevCommitSeq,
        );
    const storedSchemaVersionId = row.schemaVersionId;
    const schemaVersionId = yield* decodeStoredRevisionColumnResult(
      identity,
      decodeCatalogSchemaVersionIdResult(storedSchemaVersionId),
    );
    const storedCreationTime = row.creationTime;
    const creationTime = yield* decodeStoredRevisionColumnResult(
      identity,
      decodeAppCreationTimeV1Result(storedCreationTime),
    );
    const base = Object.freeze({
      ...identity,
      scopeUuid,
      writeEpochUuid,
      commitSeq,
      prevCommitSeq,
      schemaVersionId,
      creationTime,
    } satisfies AppRowRevisionV1Base);
    const storedIsTombstone = row.isTombstone;
    const isTombstone = yield* decodeStoredRevisionColumnResult(
      identity,
      decodeBooleanResult(storedIsTombstone),
    );
    if (isTombstone) {
      const valueJson = row.valueJson;
      if (valueJson !== null) {
        return yield* Result.fail(new AppRowStorageCorruptionError(
          identity,
          "tombstone retains value evidence",
        ));
      }
      const valueBytes = row.valueBytes;
      if (valueBytes !== null) {
        return yield* Result.fail(new AppRowStorageCorruptionError(
          identity,
          "tombstone retains value evidence",
        ));
      }
      const valueSha256 = row.valueSha256;
      if (valueSha256 !== null) {
        return yield* Result.fail(new AppRowStorageCorruptionError(
          identity,
          "tombstone retains value evidence",
        ));
      }
      return Object.freeze({ kind: "tombstone", base } as const);
    }
    const valueJson = row.valueJson;
    if (valueJson === null) {
      return yield* Result.fail(new AppRowStorageCorruptionError(
        identity,
        "live revision is missing value evidence",
      ));
    }
    const valueBytes = row.valueBytes;
    if (valueBytes === null) {
      return yield* Result.fail(new AppRowStorageCorruptionError(
        identity,
        "live revision is missing value evidence",
      ));
    }
    const valueSha256 = row.valueSha256;
    if (valueSha256 === null) {
      return yield* Result.fail(new AppRowStorageCorruptionError(
        identity,
        "live revision is missing value evidence",
      ));
    }
    const valueCodecVersion = row.valueCodecVersion;
    return Object.freeze({
      kind: "live",
      base,
      valueCodecVersion,
      valueJson,
      valueBytes,
      valueSha256,
    } as const);
  });
}

function decodeStoredRevisionColumnResult<Value>(
  identity: AppRowIdentityV1,
  result: Result.Result<Value, unknown>,
): Result.Result<Value, AppRowStorageCorruptionError> {
  return result.pipe(Result.mapError((cause) =>
    storedRevisionColumnsCorruption(identity, cause)
  ));
}

function decodeStoredPositiveCommitSeqResult(
  identity: AppRowIdentityV1,
  value: unknown,
): Result.Result<CommitSeq, AppRowStorageCorruptionError> {
  return Result.gen(function* () {
    const decoded = yield* decodeStoredRevisionColumnResult(
      identity,
      decodeCommitSeqResult(value),
    );
    if (decoded < 1n) {
      return yield* Result.fail(storedRevisionColumnsCorruption(
        identity,
        new InvalidAppRowRevisionV1InputError({
          reason: "nonPositiveCommitSeq",
          value: decoded,
        }),
      ));
    }
    return decoded;
  });
}

function storedRevisionColumnsCorruption(
  identity: AppRowIdentityV1,
  cause: unknown,
): AppRowStorageCorruptionError {
  return new AppRowStorageCorruptionError(
    identity,
    "stored revision columns do not decode",
    { cause },
  );
}

const requireScopeUuidInTransactionEffect = Effect.fn(
  "AppRows.requireScopeUuidInTransaction",
)(function* (
  tx: AppRowTransaction,
  decodedIdentity: DecodedAppRowReadIdentityV1,
): Effect.fn.Return<
  ScopeUuidV1,
  AppRowScopeAuthorityUnavailableError | AppRowReadPersistenceError
> {
  const { identity, projection } = decodedIdentity;
  const query = selectScopeAuthorityRows(
    tx,
    projection,
  );
  const rows = yield* readAppRowRowsEffect(query, "readScopeAuthority");
  const row = rows[0];
  if (row?.scopeUuid !== projection.scopeUuid) {
    return yield* Effect.fail(
      new AppRowScopeAuthorityUnavailableError(identity.scopeId),
    );
  }
  return decodeScopeUuidV1(row.scopeUuid);
});

async function requireScopeUuidInTransaction(
  tx: AppRowTransaction,
  scopeId: ScopeId,
): Promise<ScopeUuidV1> {
  return Result.getOrThrow(
    await requireScopeUuidInTransactionResult(tx, scopeId),
  );
}

async function requireScopeUuidInTransactionResult(
  tx: AppRowTransaction,
  scopeId: ScopeId,
): Promise<Result.Result<ScopeUuidV1, AppRowScopeAuthorityUnavailableError>> {
  // Temporary write-side Promise bridge. The point-commit mutation graph is
  // its concrete consumer; delete this when that ordered transaction migrates.
  const projection = projectScopeIdUuidV1(scopeId);
  const query = selectScopeAuthorityRows(tx, projection);
  const rows = await query;
  const row = rows[0];
  if (row?.scopeUuid !== projection.scopeUuid) {
    return Result.fail(new AppRowScopeAuthorityUnavailableError(scopeId));
  }
  return Result.succeed(decodeScopeUuidV1(row.scopeUuid));
}

function selectScopeAuthorityRows(
  tx: AppRowTransaction,
  projection: ReturnType<typeof projectScopeIdUuidV1>,
) {
  const query = tx
    .select({
      scopeId: fxSystemScopeClocks.scopeId,
      scopeUuid: fxSystemScopeClocks.scopeUuid,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, projection.scopeId))
    .limit(1);
  return query;
}

const readAppRowRowsEffect = Effect.fn(
  "AppRows.readRows",
)(<Row>(
  query: PromiseLike<ReadonlyArray<Row>>,
  operation: AppRowReadPersistenceError["operation"],
): Effect.Effect<ReadonlyArray<Row>, AppRowReadPersistenceError> =>
  Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new AppRowReadPersistenceError(operation, cause),
  })));

function decodeReadIdentityResult(
  input: AppRowIdentityV1,
): Result.Result<DecodedAppRowReadIdentityV1, InvalidAppRowReadInputError> {
  return Result.gen(function* () {
    const tableId = yield* decodeReadFieldResult(
      decodeCatalogTableIdResult(input.tableId),
      "invalidTableId",
    );
    const rowId = yield* decodeReadFieldResult(
      decodeAppRowIdHexV1Result(input.rowId),
      "invalidRowId",
    );
    const scopeId = yield* decodeReadFieldResult(
      decodeScopeIdResult(input.scopeId),
      "invalidScopeId",
    );
    const identity = Object.freeze({ scopeId, tableId, rowId });
    const projection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError((cause) => new InvalidAppRowReadInputError({
        reason: "invalidScopeId",
        cause,
      })),
    );
    return Object.freeze({ identity, projection });
  });
}

function decodeReadFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  reason: InvalidAppRowReadInputIssue["reason"],
): Result.Result<Value, InvalidAppRowReadInputError> {
  return result.pipe(Result.mapError((cause) =>
    new InvalidAppRowReadInputError({ reason, cause })
  ));
}

function decodeIdentity(input: AppRowIdentityV1): AppRowIdentityV1 {
  return Object.freeze({
    scopeId: input.scopeId,
    tableId: decodeCatalogTableId(input.tableId),
    rowId: decodeAppRowIdHexV1(input.rowId),
  } satisfies AppRowIdentityV1);
}

async function decodeAppendInput(
  tx: AppRowTransaction,
  input: AppendAppRowRevisionV1Input,
): Promise<DecodedAppendAppRowRevisionV1> {
  const identity = decodeIdentity(input);
  const scopeUuid = await requireScopeUuidInTransaction(tx, identity.scopeId);
  const commitSeq = requirePositiveCommitSeq(input.commitSeq);
  const prevCommitSeq =
    input.prevCommitSeq === null
      ? null
      : requirePreviousCommitSeq(input.prevCommitSeq, commitSeq);
  const writeEpochUuid = projectScopeEpochUuidV1(input.writeEpoch).epochUuid;
  const schemaVersionId = decodeCatalogSchemaVersionId(input.schemaVersionId);
  const creationTime = decodeAppCreationTimeV1(input.creationTime);
  if (prevCommitSeq !== null) {
    await requireImmutableCreationTime(
      tx,
      identity,
      scopeUuid,
      prevCommitSeq,
      creationTime,
    );
  }
  const base = {
    ...input,
    identity,
    scopeUuid,
    writeEpochUuid,
    commitSeq,
    prevCommitSeq,
    schemaVersionId,
    creationTime,
  };
  if (input.kind === "tombstone") {
    return Object.freeze({ ...base, kind: "tombstone" });
  }
  const document = await verifyAppDocumentEvidenceV1({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime,
    codecVersion: input.value.codecVersion,
    valueJson: input.value.valueJson,
    canonicalBytes: input.value.canonicalBytes,
    sha256: input.value.sha256,
  });
  return Object.freeze({ ...base, kind: "live", document });
}

interface DecodedPreparedAppendScalars {
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
  readonly writeEpochUuid: ReturnType<
    typeof projectScopeEpochUuidV1
  >["epochUuid"];
  readonly schemaVersionId: ReturnType<typeof decodeCatalogSchemaVersionId>;
  readonly creationTime: ReturnType<typeof decodeAppCreationTimeV1>;
}

function decodePreparedAppendScalars(
  input: AppendPreparedAppRowRevisionV1Input,
): Result.Result<DecodedPreparedAppendScalars, AppendAppRowRevisionV1Error> {
  return Result.gen(function* () {
    const commitSeq = yield* requirePositiveCommitSeqResult(input.commitSeq);
    const prevCommitSeq = yield* input.prevCommitSeq === null
      ? Result.succeed<CommitSeq | null>(null)
      : requirePreviousCommitSeqResult(input.prevCommitSeq, commitSeq);
    const writeEpochUuid = projectScopeEpochUuidV1(input.writeEpoch).epochUuid;
    const schemaVersionId = decodeCatalogSchemaVersionId(input.schemaVersionId);
    const creationTime = decodeAppCreationTimeV1(input.creationTime);
    return Object.freeze({
      commitSeq,
      prevCommitSeq,
      writeEpochUuid,
      schemaVersionId,
      creationTime,
    });
  });
}

async function decodePreparedAppendInputResult(
  tx: AppRowTransaction,
  input: AppendPreparedAppRowRevisionV1Input,
): Promise<Result.Result<
  DecodedAppendAppRowRevisionV1,
  AppendAppRowRevisionV1Error
>> {
  const identity = decodeIdentity(input);
  const scopeUuid = await requireScopeUuidInTransactionResult(
    tx,
    identity.scopeId,
  );
  if (Result.isFailure(scopeUuid)) return Result.fail(scopeUuid.failure);
  return decodePreparedAppendInputWithScope(tx, input, identity, scopeUuid.success);
}

async function decodePreparedAppendInputWithScope(
  tx: AppRowTransaction,
  input: AppendPreparedAppRowRevisionV1Input,
  identity: AppRowIdentityV1,
  scopeUuid: ScopeUuidV1,
): Promise<Result.Result<
  DecodedAppendAppRowRevisionV1,
  AppendAppRowRevisionV1Error
>> {
  const scalars = decodePreparedAppendScalars(input);
  if (Result.isFailure(scalars)) return Result.fail(scalars.failure);
  return checkPreparedAppendImmutableCreationTime(
    tx,
    input,
    identity,
    scopeUuid,
    scalars.success,
  );
}

async function checkPreparedAppendImmutableCreationTime(
  tx: AppRowTransaction,
  input: AppendPreparedAppRowRevisionV1Input,
  identity: AppRowIdentityV1,
  scopeUuid: ScopeUuidV1,
  scalars: DecodedPreparedAppendScalars,
): Promise<Result.Result<
  DecodedAppendAppRowRevisionV1,
  AppendAppRowRevisionV1Error
>> {
  if (scalars.prevCommitSeq !== null) {
    const immutableCreationTime = await requireImmutableCreationTimeResult(
      tx,
      identity,
      scopeUuid,
      scalars.prevCommitSeq,
      scalars.creationTime,
    );
    if (Result.isFailure(immutableCreationTime)) {
      return Result.fail(immutableCreationTime.failure);
    }
  }
  const base = {
    ...input,
    identity,
    scopeUuid,
    commitSeq: scalars.commitSeq,
    prevCommitSeq: scalars.prevCommitSeq,
    writeEpochUuid: scalars.writeEpochUuid,
    schemaVersionId: scalars.schemaVersionId,
    creationTime: scalars.creationTime,
  };
  return Result.succeed(input.kind === "tombstone"
    ? Object.freeze({ ...base, kind: "tombstone" })
    : Object.freeze({ ...base, kind: "live", document: input.document }));
}

async function requireImmutableCreationTime(
  tx: AppRowTransaction,
  identity: AppRowIdentityV1,
  scopeUuid: ScopeUuidV1,
  prevCommitSeq: CommitSeq,
  creationTime: AppCreationTimeV1,
): Promise<void> {
  return Result.getOrThrow(await requireImmutableCreationTimeResult(
    tx,
    identity,
    scopeUuid,
    prevCommitSeq,
    creationTime,
  ));
}

async function requireImmutableCreationTimeResult(
  tx: AppRowTransaction,
  identity: AppRowIdentityV1,
  scopeUuid: ScopeUuidV1,
  prevCommitSeq: CommitSeq,
  creationTime: AppCreationTimeV1,
): Promise<Result.Result<
  void,
  | InvalidAppRowRevisionV1InputError
  | AppRowRevisionChainConflictError
  | AppRowCreationTimeConflictError
>> {
  const rows = await tx
    .select({ creationTime: fxAppRowRevisions.creationTime })
    .from(fxAppRowRevisions)
    .where(
      and(
        eq(fxAppRowRevisions.scopeUuid, scopeUuid),
        eq(fxAppRowRevisions.tableId, identity.tableId),
        eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId)),
        eq(fxAppRowRevisions.commitSeq, prevCommitSeq),
      ),
    )
    .limit(1);
  const predecessor = rows[0];
  if (predecessor === undefined) {
    const actual = await readCurrentPointerCommitSeqResult(
      tx,
      scopeUuid,
      identity,
    );
    if (Result.isFailure(actual)) return Result.fail(actual.failure);
    return Result.fail(new AppRowRevisionChainConflictError(
      identity,
      prevCommitSeq,
      actual.success,
    ));
  }
  const expectedCreationTime = decodeAppCreationTimeV1(
    predecessor.creationTime,
  );
  if (creationTime !== expectedCreationTime) {
    return Result.fail(new AppRowCreationTimeConflictError(
      identity,
      expectedCreationTime,
      creationTime,
    ));
  }
  return Result.succeed(undefined);
}

function requirePositiveCommitSeq(value: CommitSeq): CommitSeq {
  return Result.getOrThrow(requirePositiveCommitSeqResult(value));
}

function requirePositiveCommitSeqResult(
  value: CommitSeq,
): Result.Result<CommitSeq, InvalidAppRowRevisionV1InputError> {
  const decoded = CommitSeqSchema.make(value);
  if (decoded < 1n) {
    return Result.fail(new InvalidAppRowRevisionV1InputError({
      reason: "nonPositiveCommitSeq",
      value: decoded,
    }));
  }
  return Result.succeed(decoded);
}

function requirePreviousCommitSeq(
  value: CommitSeq,
  commitSeq: CommitSeq,
): CommitSeq {
  return Result.getOrThrow(requirePreviousCommitSeqResult(value, commitSeq));
}

function requirePreviousCommitSeqResult(
  value: CommitSeq,
  commitSeq: CommitSeq,
): Result.Result<CommitSeq, InvalidAppRowRevisionV1InputError> {
  const decoded = CommitSeqSchema.make(value);
  if (decoded < 1n || decoded >= commitSeq) {
    return Result.fail(new InvalidAppRowRevisionV1InputError({
      reason: "invalidPreviousCommitSeq",
      value: decoded,
      commitSeq,
    }));
  }
  return Result.succeed(decoded);
}

async function readCurrentPointerCommitSeqResult(
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  identity: AppRowIdentityV1,
): Promise<Result.Result<
  CommitSeq | null,
  InvalidAppRowRevisionV1InputError
>> {
  const rows = await tx
    .select({ commitSeq: fxAppRowCurrent.commitSeq })
    .from(fxAppRowCurrent)
    .where(
      and(
        eq(fxAppRowCurrent.scopeUuid, scopeUuid),
        eq(fxAppRowCurrent.tableId, identity.tableId),
        eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(identity.rowId)),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? Result.succeed(null)
    : requirePositiveCommitSeqResult(row.commitSeq);
}
