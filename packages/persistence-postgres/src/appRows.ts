import { and, desc, eq, getTableColumns, inArray, lte, or, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { observeDrizzleQuery } from "./drizzleQueryObservation";
import {
  AppCreationTimeV1Schema,
  decodeAppCreationTimeV1,
  verifyAppDocumentEvidenceV1,
  decodeCanonicalAppDocumentEvidenceV1Effect,
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
  type CanonicalFlarexValueBytesV1,
  type CanonicalFlarexValueV1,
  type FlarexValueCodecVersion,
  type FlarexValueSha256V1,
} from "flarex-protocol/value";

import type { FlarexMetadataTransaction } from "./metadataTransaction";
import {
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemCommitAppRowChanges,
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

export class InvalidAppRowBatchInputError extends Error {
  readonly _tag = "InvalidAppRowBatchInputError" as const;
  constructor(
    readonly reason:
      "mixedPublication" | "duplicateIdentity" | "documentBytesExceeded",
  ) {
    super(`Invalid prepared app-row batch: ${reason}`);
  }
}

export class AppRowWritePersistenceError extends Error {
  readonly _tag = "AppRowWritePersistenceError" as const;
  constructor(readonly cause: unknown) {
    super("Prepared app-row batch persistence failed", { cause });
  }
}

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
      | "readCurrentRevision"
      | "readPublicationFact"
      | "readTableFrontier",
    readonly cause: unknown,
  ) {
    super(`Failed to ${operation.replace(/([A-Z])/g, " $1").toLowerCase()}.`, {
      cause,
    });
    this.name = "AppRowReadPersistenceError";
  }
}

export class AppRowTableFrontierCorruptionError extends Error {
  readonly _tag = "AppRowTableFrontierCorruptionError" as const;
  constructor(
    readonly scopeId: ScopeId,
    readonly tableId: CatalogTableId,
    cause?: unknown,
  ) {
    super(`App-row table frontier is invalid: ${scopeId}/${tableId}.`, {
      cause,
    });
    this.name = "AppRowTableFrontierCorruptionError";
  }
}

export type ReadAppRowError =
  | InvalidAppRowReadInputError
  | AppRowScopeAuthorityUnavailableError
  | AppRowReadPersistenceError
  | AppRowTableFrontierCorruptionError
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

/** Includes tombstone pointers: absence of a later head proves no later table write. */
export const readAppTableWriteFrontierInTransactionEffect = Effect.fn(
  "AppRows.readTableWriteFrontier",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  tableId: CatalogTableId,
): Effect.fn.Return<
  CommitSeq | null,
  | InvalidAppRowReadInputError
  | AppRowReadPersistenceError
  | AppRowTableFrontierCorruptionError
> {
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(scopeId),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new InvalidAppRowReadInputError({ reason: "invalidScopeId", cause }),
    ),
  );
  const table = yield* Effect.fromResult(
    decodeCatalogTableIdResult(tableId),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new InvalidAppRowReadInputError({ reason: "invalidTableId", cause }),
    ),
  );
  const rows = yield* readAppRowRowsEffect(
    tx
      .select({ commitSeq: fxAppRowCurrent.commitSeq })
      .from(fxAppRowCurrent)
      .where(
        and(
          eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid),
          eq(fxAppRowCurrent.tableId, table),
        ),
      )
      .orderBy(desc(fxAppRowCurrent.commitSeq))
      .limit(1),
    "readTableFrontier",
  );
  const row = rows[0];
  if (row === undefined) return null;
  const frontier = yield* Effect.fromResult(
    decodeCommitSeqResult(row.commitSeq),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new AppRowTableFrontierCorruptionError(scopeId, tableId, cause),
    ),
  );
  if (frontier < 1n)
    return yield* Effect.fail(
      new AppRowTableFrontierCorruptionError(scopeId, tableId),
    );
  return frontier;
});

export const readAppRowAtSnapshotInTransactionEffect = Effect.fn(
  "AppRows.readAtSnapshotInTransaction",
)(function* (
  tx: AppRowTransaction,
  input: ReadAppRowAtSnapshotV1Input,
  observer?: Parameters<typeof observeDrizzleQuery<"snapshotRevision">>[2],
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
    observer,
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
  const [firstRowId] = input.rowIds;
  if (firstRowId === undefined) return Object.freeze([]);
  const decodedIdentity = yield* Effect.fromResult(
    decodeReadIdentityResult({
      scopeId: input.scopeId,
      tableId: input.tableId,
      rowId: firstRowId,
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
  observer?: Parameters<typeof observeDrizzleQuery<"snapshotRevision">>[2],
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
  observeDrizzleQuery("snapshotRevision", query, observer);
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

export const MAX_BOUNDED_APP_ROW_READ_IDENTITIES = 256;
export const MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES = 1_048_576;

/**
 * Private bounded statement-current view. The caller protects lifecycle and
 * either owns a physical snapshot or validates all observations at settlement.
 * Rows and their publication ceiling come from one statement snapshot.
 */
type BoundedCurrentAppRowReadInput = Readonly<{ scopeId: ScopeId; tableId: CatalogTableId; minimumCommitSeq: CommitSeq;
  maximumIdentities: number; maximumDocumentBytes: number; maximumTotalValueBytes: number;
  rowId?: AppRowIdHexV1; rowIds?: readonly AppRowIdHexV1[] }>;

const readBoundedCurrentAppRows = Effect.fn(
  "AppRows.readBoundedCurrentSet",
)(function* (
  tx: AppRowTransaction,
  input: BoundedCurrentAppRowReadInput,
  observer?: Parameters<typeof observeDrizzleQuery<"currentCapture">>[2],
  pendingCommitSeq?: CommitSeq,
): Effect.fn.Return<Readonly<{ rows: readonly AppRowRevisionV1[]; commitSeq: CommitSeq }>, ReadAppRowError> {
  if (!Number.isSafeInteger(input.maximumIdentities) || input.maximumIdentities < 0 || input.maximumIdentities > MAX_BOUNDED_APP_ROW_READ_IDENTITIES ||
    !Number.isSafeInteger(input.maximumDocumentBytes) || input.maximumDocumentBytes < 1 || input.maximumDocumentBytes > 1_048_576 ||
    !Number.isSafeInteger(input.maximumTotalValueBytes) || input.maximumTotalValueBytes < 0 || input.maximumTotalValueBytes > MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES) {
    return yield* Effect.fail(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: input.maximumIdentities }));
  }
  const scopeId = yield* Effect.fromResult(decodeReadFieldResult(decodeScopeIdResult(input.scopeId), "invalidScopeId"));
  const tableId = yield* Effect.fromResult(decodeReadFieldResult(decodeCatalogTableIdResult(input.tableId), "invalidTableId"));
  const minimumCommitSeq = yield* Effect.fromResult(decodeReadFieldResult(decodeCommitSeqResult(input.minimumCommitSeq), "invalidSnapshotCommitSeq"));
  const scopeUuid = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId).pipe(
    Result.mapError(cause => new InvalidAppRowReadInputError({ reason: "invalidScopeId", cause })),
  ));
  const clock = tx.$with("capture_clock").as(tx.select({ lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
    epoch: fxSystemScopeClocks.epoch })
    .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid.scopeUuid)).limit(1));
  const join = and(
      eq(fxAppRowRevisions.scopeUuid, fxAppRowCurrent.scopeUuid),
      eq(fxAppRowRevisions.tableId, fxAppRowCurrent.tableId),
      eq(fxAppRowRevisions.rowId, fxAppRowCurrent.rowId),
      eq(fxAppRowRevisions.commitSeq, fxAppRowCurrent.commitSeq),
    );
  const selectedRowId = input.rowId === undefined ? undefined : yield* Effect.fromResult(
    decodeReadFieldResult(decodeAppRowIdHexV1Result(input.rowId), "invalidRowId"),
  );
  if (input.rowIds !== undefined && (input.rowId !== undefined || !Array.isArray(input.rowIds) ||
    input.rowIds.length > input.maximumIdentities)) {
    return yield* Effect.fail(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: "invalid identity batch" }));
  }
  const selectedRowIds = input.rowIds === undefined ? undefined : yield* Effect.forEach(input.rowIds,
    id => Effect.fromResult(decodeReadFieldResult(decodeAppRowIdHexV1Result(id), "invalidRowId")));
  if (selectedRowIds !== undefined && new Set(selectedRowIds).size !== selectedRowIds.length) {
    return yield* Effect.fail(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: "duplicate identity batch" }));
  }
  const where = and(eq(fxAppRowCurrent.scopeUuid, scopeUuid.scopeUuid), eq(fxAppRowCurrent.tableId, tableId),
    selectedRowId === undefined ? undefined : eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(selectedRowId)),
    selectedRowIds === undefined ? undefined : inArray(fxAppRowCurrent.rowId, selectedRowIds.map(appRowIdHexV1ToBytes)));
  const capture = (() => {
    if (selectedRowId !== undefined) {
      // The scoped current-pointer key and exact revision join admit at most
      // one row. Check its budget in SQL without constructing an aggregate.
      const bytes = sql`coalesce(octet_length(${fxAppRowRevisions.valueBytes}), 0)`;
      const withinBudget = sql<boolean>`${fxAppRowCurrent.rowId} is null or (${input.maximumIdentities} >= 1
        and ${bytes} <= ${input.maximumDocumentBytes}
        and ${bytes} <= ${input.maximumTotalValueBytes})`;
      return tx.with(clock).select({
        observedCommitSeq: clock.lastCommitSeq,
        observedEpoch: clock.epoch,
        withinBudget,
        pointer: fxAppRowCurrent,
        revision: {
          ...getTableColumns(fxAppRowRevisions),
          valueBytes: sql`case when ${withinBudget} then ${fxAppRowRevisions.valueBytes} else null end`
            .mapWith(fxAppRowRevisions.valueBytes),
        },
      }).from(clock).leftJoin(fxAppRowCurrent, where).leftJoin(fxAppRowRevisions, join).limit(1);
    }
    // LIMIT applies before aggregation: total stored table size must not enter
    // the capture budget, and rejected bodies must never cross the driver.
    const bounded = tx.$with("bounded_current").as(tx.select({
      scopeUuid: fxAppRowCurrent.scopeUuid,
      tableId: fxAppRowCurrent.tableId,
      rowId: fxAppRowCurrent.rowId,
      commitSeq: fxAppRowCurrent.commitSeq,
      bytes: sql<number>`coalesce(octet_length(${fxAppRowRevisions.valueBytes}), 0)`.as("value_bytes_length"),
    }).from(fxAppRowCurrent).leftJoin(fxAppRowRevisions, join).where(where)
      .orderBy(fxAppRowCurrent.rowId).limit(input.maximumIdentities + 1));
    const budget = tx.$with("current_capture_budget").as(tx.select({
      allowed: sql<boolean>`count(*) <= ${input.maximumIdentities}
        and coalesce(max(${bounded.bytes}), 0) <= ${input.maximumDocumentBytes}
        and coalesce(sum(${bounded.bytes}), 0) <= ${input.maximumTotalValueBytes}`.as("within_budget"),
    }).from(bounded));
    return tx.with(clock, bounded, budget).select({
      observedCommitSeq: clock.lastCommitSeq,
      observedEpoch: clock.epoch,
      withinBudget: budget.allowed,
      pointer: { scopeUuid: bounded.scopeUuid, tableId: bounded.tableId, rowId: bounded.rowId, commitSeq: bounded.commitSeq },
      revision: fxAppRowRevisions,
    }).from(clock).crossJoin(budget).leftJoin(bounded, sql`${budget.allowed}`).leftJoin(fxAppRowRevisions, and(
      eq(fxAppRowRevisions.scopeUuid, bounded.scopeUuid),
      eq(fxAppRowRevisions.tableId, bounded.tableId),
      eq(fxAppRowRevisions.rowId, bounded.rowId),
      eq(fxAppRowRevisions.commitSeq, bounded.commitSeq),
    )).orderBy(bounded.rowId);
  })();
  observeDrizzleQuery("currentCapture", capture, observer);
  const rows = yield* readAppRowRowsEffect(capture, "readCurrentRevision");
  const verdict = rows[0];
  if (verdict === undefined || verdict.observedCommitSeq < minimumCommitSeq) {
    return yield* Effect.fail(new InvalidAppRowReadInputError({ reason: "invalidSnapshotCommitSeq", cause: minimumCommitSeq }));
  }
  if (!verdict.withinBudget) {
    return yield* Effect.fail(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: "bounded current view exceeds capture budget" }));
  }
  const commitSeq = yield* Effect.fromResult(decodeReadFieldResult(decodeCommitSeqResult(verdict.observedCommitSeq), "invalidSnapshotCommitSeq"));
  const revisions: AppRowRevisionV1[] = [];
  const pendingRowIds: AppRowIdHexV1[] = [];
  for (const row of rows) {
    // A valid empty selection retains only the aggregate verdict.
    if (row.pointer === null) continue;
    const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(row.pointer.rowId).pipe(
      Result.mapError(cause => new InvalidAppRowReadInputError({ reason: "invalidRowId", cause })),
    ));
    const identity = { scopeId, tableId, rowId };
    if (row.revision === null || (row.pointer.commitSeq > row.observedCommitSeq &&
      (pendingCommitSeq === undefined || pendingCommitSeq !== row.pointer.commitSeq ||
        pendingCommitSeq !== row.observedCommitSeq + 1n))) {
      return yield* Effect.fail(new AppRowStorageCorruptionError(identity, "bounded current pointer exceeds its statement publication clock"));
    }
    if (row.pointer.commitSeq > row.observedCommitSeq) {
      if (row.revision.writeEpochUuid !== projectScopeEpochUuidV1(verdict.observedEpoch).epochUuid)
        return yield* Effect.fail(new AppRowStorageCorruptionError(identity, "pending current revision has a stale scope epoch"));
      pendingRowIds.push(rowId);
    }
    revisions.push(yield* decodeRevisionRowEffect(identity, row.revision));
  }
  if (pendingRowIds.length > 0 && pendingCommitSeq !== undefined) {
    const facts = yield* readAppRowRowsEffect(tx.select({ rowId: fxSystemCommitAppRowChanges.rowId })
      .from(fxSystemCommitAppRowChanges).where(and(
        eq(fxSystemCommitAppRowChanges.scopeUuid, scopeUuid.scopeUuid),
        eq(fxSystemCommitAppRowChanges.epochUuid, projectScopeEpochUuidV1(verdict.observedEpoch).epochUuid),
        eq(fxSystemCommitAppRowChanges.tableId, tableId),
        eq(fxSystemCommitAppRowChanges.commitSeq, pendingCommitSeq),
        inArray(fxSystemCommitAppRowChanges.rowId, pendingRowIds.map(appRowIdHexV1ToBytes)),
      )), "readPublicationFact");
    const factIds = yield* Effect.forEach(facts, fact => Effect.fromResult(appRowIdHexV1FromBytesResult(fact.rowId).pipe(
      Result.mapError(cause => new InvalidAppRowReadInputError({ reason: "invalidRowId", cause })))));
    if (factIds.length !== pendingRowIds.length || new Set(factIds).size !== pendingRowIds.length ||
      factIds.some(id => !pendingRowIds.includes(id))) {
      const firstPending = pendingRowIds[0];
      if (firstPending === undefined) return yield* Effect.fail(new InvalidAppRowReadInputError({
        reason: "rowLimitExceeded", cause: "missing pending row identity",
      }));
      return yield* Effect.fail(new AppRowStorageCorruptionError(
        { scopeId, tableId, rowId: firstPending }, "pending current pointer has no exact publication fact"));
    }
  }
  return Object.freeze({ rows: Object.freeze(revisions), commitSeq });
});

/** Published current view. Unpublished current pointers remain corruption. */
export const readBoundedCurrentAppRowsInTransactionEffect = Effect.fn("AppRows.readBoundedPublishedCurrentSet")(
  (tx: AppRowTransaction, input: BoundedCurrentAppRowReadInput,
    observer?: Parameters<typeof observeDrizzleQuery<"currentCapture">>[2]) =>
    readBoundedCurrentAppRows(tx, input, observer));

/** Publication-only final-state view. The pending row must belong to the
 * immediately next commit and have an exact row-change fact in this transaction. */
export const readBoundedPublicationAppRowsInTransactionEffect = Effect.fn("AppRows.readBoundedPublicationCurrentSet")(
  (tx: AppRowTransaction, input: BoundedCurrentAppRowReadInput & { readonly pendingCommitSeq: CommitSeq },
    observer?: Parameters<typeof observeDrizzleQuery<"currentCapture">>[2]) =>
    readBoundedCurrentAppRows(tx, input, observer, input.pendingCommitSeq));

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

const APP_ROW_BATCH_ROWS = 32;
const APP_ROW_BATCH_TARGET_BYTES = 256 * 1024;
const APP_ROW_BATCH_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

type AppRowBatchError =
  | AppendAppRowRevisionV1Error
  | InvalidAppRowBatchInputError
  | AppRowWritePersistenceError;

const appRowBatchQueryEffect = Effect.fn("AppRows.batchQuery")(
  <Row,>(
    execute: () => PromiseLike<ReadonlyArray<Row>>,
  ): Effect.Effect<ReadonlyArray<Row>, AppRowWritePersistenceError> =>
    Effect.uninterruptible(
      Effect.tryPromise({
        try: execute,
        catch: (cause) => new AppRowWritePersistenceError(cause),
      }),
    ),
);

/** Private prepared publication operation. The transaction owner MUST abort on
 * failure; partial batches are never locally recovered or committed. */
export const appendPreparedAppRowRevisionsInTransactionEffect = Effect.fn(
  "AppRows.appendPreparedBatch",
)(function* (
  tx: AppRowTransaction,
  inputs: ReadonlyArray<AppendPreparedAppRowRevisionV1Input>,
): Effect.fn.Return<ReadonlyArray<AppRowRevisionV1>, AppRowBatchError> {
  const first = inputs[0];
  if (first === undefined) return [];
  const decoded: DecodedAppendAppRowRevisionV1[] = [];
  const identities = new Set<string>();
  const projection = projectScopeIdUuidV1(first.scopeId);
  const authorityQuery = selectScopeAuthorityRows(tx, projection);
  const authority = yield* appRowBatchQueryEffect(() => authorityQuery);
  if (authority[0]?.scopeUuid !== projection.scopeUuid)
    return yield* Effect.fail(
      new AppRowScopeAuthorityUnavailableError(first.scopeId),
    );
  const scopeUuid = decodeScopeUuidV1(authority[0].scopeUuid);
  for (const input of inputs) {
    if (
      input.scopeId !== first.scopeId ||
      input.writeEpoch !== first.writeEpoch ||
      input.commitSeq !== first.commitSeq
    )
      return yield* Effect.fail(
        new InvalidAppRowBatchInputError("mixedPublication"),
      );
    const identity = decodeIdentity(input);
    const key = `${identity.tableId}/${identity.rowId}`;
    if (identities.has(key))
      return yield* Effect.fail(
        new InvalidAppRowBatchInputError("duplicateIdentity"),
      );
    identities.add(key);
    const scalars = yield* Effect.fromResult(
      decodePreparedAppendScalars(input),
    );
    if (
      input.kind === "live" &&
      input.document.canonicalBytes.byteLength >
        APP_ROW_BATCH_MAX_DOCUMENT_BYTES
    )
      return yield* Effect.fail(
        new InvalidAppRowBatchInputError("documentBytesExceeded"),
      );
    const base = { ...input, ...scalars, identity, scopeUuid };
    decoded.push(
      input.kind === "live"
        ? { ...base, kind: "live", document: input.document }
        : { ...base, kind: "tombstone" },
    );
  }
  const statements: RowBatchInsertStatements = {
    revisions: new Map(),
    pointers: new Map(),
  };
  let offset = 0;
  while (offset < decoded.length) {
    const batch: DecodedAppendAppRowRevisionV1[] = [];
    let bytes = 0;
    while (offset < decoded.length && batch.length < APP_ROW_BATCH_ROWS) {
      const row = decoded[offset];
      if (row === undefined) break;
      const rowBytes =
        row.kind === "live" ? row.document.canonicalBytes.byteLength : 0;
      if (batch.length > 0 && bytes + rowBytes > APP_ROW_BATCH_TARGET_BYTES)
        break;
      batch.push(row);
      bytes += rowBytes;
      offset += 1;
    }
    yield* appendPreparedRowBatchEffect(tx, batch, statements);
  }
  return decoded.map(projectAppRowRevision);
});

const appRowWriteIdentityColumns = {
  scopeUuid: fxAppRowRevisions.scopeUuid,
  tableId: fxAppRowRevisions.tableId,
  rowId: fxAppRowRevisions.rowId,
  commitSeq: fxAppRowRevisions.commitSeq,
};
const appRowCurrentIdentityColumns = {
  scopeUuid: fxAppRowCurrent.scopeUuid,
  tableId: fxAppRowCurrent.tableId,
  rowId: fxAppRowCurrent.rowId,
  commitSeq: fxAppRowCurrent.commitSeq,
};
type AppRowWriteIdentity = Pick<
  typeof fxAppRowRevisions.$inferSelect,
  "scopeUuid" | "tableId" | "rowId" | "commitSeq"
>;

function decodeBatchStoredIdentityResult(
  context: AppRowIdentityV1,
  row: AppRowWriteIdentity,
) {
  return Result.gen(function* () {
    const scopeUuid = yield* decodeStoredRevisionColumnResult(
      context,
      decodeScopeUuidV1Result(row.scopeUuid),
    );
    const tableId = yield* decodeStoredRevisionColumnResult(
      context,
      decodeCatalogTableIdResult(row.tableId),
    );
    const rowId = yield* decodeStoredRevisionColumnResult(
      context,
      appRowIdHexV1FromBytesResult(row.rowId),
    );
    const commitSeq = yield* decodeStoredPositiveCommitSeqResult(
      context,
      row.commitSeq,
    );
    return { scopeUuid, tableId, rowId, commitSeq };
  });
}

const missingAppRowWritesEffect = Effect.fn("AppRows.verifyBatchWrites")(
  function* (
    expected: ReadonlyArray<DecodedAppendAppRowRevisionV1>,
    returned: ReadonlyArray<AppRowWriteIdentity>,
  ): Effect.fn.Return<
    ReadonlyArray<DecodedAppendAppRowRevisionV1>,
    AppRowStorageCorruptionError
  > {
    const first = expected[0];
    if (first === undefined) return [];
    const wanted = new Map(
      expected.map((row) => [
        `${row.scopeUuid}/${row.identity.tableId}/${row.identity.rowId}`,
        row,
      ]),
    );
    const seen = new Set<string>();
    for (const row of returned) {
      const identity = yield* Effect.fromResult(
        decodeBatchStoredIdentityResult(first.identity, row),
      );
      const key = `${identity.scopeUuid}/${identity.tableId}/${identity.rowId}`;
      if (seen.has(key) || wanted.get(key)?.commitSeq !== identity.commitSeq)
        return yield* Effect.fail(
          new AppRowStorageCorruptionError(
            first.identity,
            "unexpected or duplicate returned row identity/sequence",
          ),
        );
      seen.add(key);
    }
    return expected.filter(
      (row) =>
        !seen.has(
          `${row.scopeUuid}/${row.identity.tableId}/${row.identity.rowId}`,
        ),
    );
  },
);

const failAppRowBatchChainEffect = Effect.fn("AppRows.failBatchChain")(
  function* (
    tx: AppRowTransaction,
    row: DecodedAppendAppRowRevisionV1,
  ): Effect.fn.Return<never, AppRowBatchError> {
    const currentQuery = tx
      .select({ commitSeq: fxAppRowCurrent.commitSeq })
      .from(fxAppRowCurrent)
      .where(
        and(
          eq(fxAppRowCurrent.scopeUuid, row.scopeUuid),
          eq(fxAppRowCurrent.tableId, row.identity.tableId),
          eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(row.identity.rowId)),
        ),
      )
      .limit(1);
    const current = yield* appRowBatchQueryEffect(() => currentQuery);
    const actual =
      current[0] === undefined
        ? null
        : yield* Effect.fromResult(
            decodeStoredPositiveCommitSeqResult(
              row.identity,
              current[0].commitSeq,
            ),
          );
    return yield* Effect.fail(
      new AppRowRevisionChainConflictError(
        row.identity,
        row.prevCommitSeq,
        actual,
      ),
    );
  },
);

interface RowBatchInsertStatements {
  readonly revisions: Map<number, ReturnType<typeof prepareRowRevisionBatch>>;
  readonly pointers: Map<number, ReturnType<typeof prepareRowPointerBatch>>;
}

// Empty names retain unnamed driver execution. Templates borrow this transaction
// only; their row values are supplied afresh and never retained across appends.
function prepareRowRevisionBatch(tx: AppRowTransaction, count: number) {
  return tx
    .insert(fxAppRowRevisions)
    .values(
      Array.from({ length: count }, (_, index) => ({
        scopeUuid: sql.placeholder(`scopeUuid_${index}`),
        tableId: sql.placeholder(`tableId_${index}`),
        rowId: sql.placeholder(`rowId_${index}`),
        commitSeq: sql.placeholder(`commitSeq_${index}`),
        prevCommitSeq: sql.placeholder(`prevCommitSeq_${index}`),
        writeEpochUuid: sql.placeholder(`writeEpochUuid_${index}`),
        schemaVersionId: sql.placeholder(`schemaVersionId_${index}`),
        creationTime: sql.placeholder(`creationTime_${index}`),
        valueCodecVersion: sql.placeholder(`valueCodecVersion_${index}`),
        isTombstone: sql.placeholder(`isTombstone_${index}`),
        valueBytes: sql.placeholder(`valueBytes_${index}`),
        valueSha256: sql.placeholder(`valueSha256_${index}`),
      })),
    )
    .onConflictDoNothing()
    .returning(appRowWriteIdentityColumns)
    .prepare("");
}

function prepareRowPointerBatch(tx: AppRowTransaction, count: number) {
  return tx
    .insert(fxAppRowCurrent)
    .values(
      Array.from({ length: count }, (_, index) => ({
        scopeUuid: sql.placeholder(`scopeUuid_${index}`),
        tableId: sql.placeholder(`tableId_${index}`),
        rowId: sql.placeholder(`rowId_${index}`),
        commitSeq: sql.placeholder(`commitSeq_${index}`),
      })),
    )
    .onConflictDoNothing()
    .returning(appRowCurrentIdentityColumns)
    .prepare("");
}

function rowBatchBindings<Value>(
  rows: readonly Readonly<Record<string, Value>>[],
) {
  const bindings: Record<string, Value> = {};
  rows.forEach((row, index) => {
    for (const [field, value] of Object.entries(row)) {
      bindings[`${field}_${index}`] = value;
    }
  });
  return bindings;
}

const appendPreparedRowBatchEffect = Effect.fn("AppRows.applyPreparedBatch")(
  function* (
    tx: AppRowTransaction,
    batch: ReadonlyArray<DecodedAppendAppRowRevisionV1>,
    statements: RowBatchInsertStatements,
  ): Effect.fn.Return<void, AppRowBatchError> {
    const first = batch[0];
    if (first === undefined) return;
    const updates = batch.filter((row) => row.prevCommitSeq !== null);
    if (updates.length > 0) {
      const predecessorQuery = tx
        .select({
          ...appRowWriteIdentityColumns,
          creationTime: fxAppRowRevisions.creationTime,
        })
        .from(fxAppRowRevisions)
        .where(
          or(
            ...updates.map((row) =>
              and(
                eq(fxAppRowRevisions.scopeUuid, row.scopeUuid),
                eq(fxAppRowRevisions.tableId, row.identity.tableId),
                eq(
                  fxAppRowRevisions.rowId,
                  appRowIdHexV1ToBytes(row.identity.rowId),
                ),
                eq(
                  fxAppRowRevisions.commitSeq,
                  row.prevCommitSeq ?? row.commitSeq,
                ),
              ),
            ),
          ),
        );
      const predecessors = yield* appRowBatchQueryEffect(
        () => predecessorQuery,
      );
      const expectedPredecessors = updates.map((row) => ({
        ...row,
        commitSeq: row.prevCommitSeq ?? row.commitSeq,
      }));
      const missing = yield* missingAppRowWritesEffect(
        expectedPredecessors,
        predecessors,
      );
      const absent = missing[0];
      if (absent !== undefined)
        return yield* failAppRowBatchChainEffect(tx, absent);
      const creationTimes = new Map<string, AppCreationTimeV1>();
      for (const predecessor of predecessors) {
        const identity = yield* Effect.fromResult(
          decodeBatchStoredIdentityResult(first.identity, predecessor),
        );
        const creationTime = yield* Effect.fromResult(
          decodeStoredRevisionColumnResult(
            first.identity,
            decodeAppCreationTimeV1Result(predecessor.creationTime),
          ),
        );
        creationTimes.set(
          `${identity.tableId}/${identity.rowId}`,
          creationTime,
        );
      }
      for (const row of updates) {
        const creationTime = creationTimes.get(
          `${row.identity.tableId}/${row.identity.rowId}`,
        );
        if (creationTime === undefined)
          return yield* Effect.fail(
            new AppRowStorageCorruptionError(
              row.identity,
              "missing predecessor creation time",
            ),
          );
        if (creationTime !== row.creationTime)
          return yield* Effect.fail(
            new AppRowCreationTimeConflictError(
              row.identity,
              creationTime,
              row.creationTime,
            ),
          );
      }
    }
    let revisionInsert = statements.revisions.get(batch.length);
    if (revisionInsert === undefined) {
      revisionInsert = prepareRowRevisionBatch(tx, batch.length);
      statements.revisions.set(batch.length, revisionInsert);
    }
    const revisionBindings = rowBatchBindings(
      batch.map((row) => ({
        scopeUuid: row.scopeUuid,
        tableId: row.identity.tableId,
        rowId: appRowIdHexV1ToBytes(row.identity.rowId),
        commitSeq: row.commitSeq,
        prevCommitSeq: row.prevCommitSeq,
        writeEpochUuid: row.writeEpochUuid,
        schemaVersionId: row.schemaVersionId,
        creationTime: row.creationTime,
        valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
        isTombstone: row.kind === "tombstone",
        valueBytes: row.kind === "live" ? row.document.canonicalBytes : null,
        valueSha256: row.kind === "live" ? row.document.sha256 : null,
      } satisfies Required<typeof fxAppRowRevisions.$inferInsert>)),
    );
    const inserted = yield* appRowBatchQueryEffect(() =>
      revisionInsert.execute(revisionBindings),
    );
    const missingRevision = (yield* missingAppRowWritesEffect(
      batch,
      inserted,
    ))[0];
    if (missingRevision !== undefined)
      return yield* Effect.fail(
        new AppRowRevisionAlreadyExistsError(
          missingRevision.identity,
          missingRevision.commitSeq,
        ),
      );
    const creates = batch.filter((row) => row.prevCommitSeq === null);
    if (creates.length > 0) {
      let pointerInsert = statements.pointers.get(creates.length);
      if (pointerInsert === undefined) {
        pointerInsert = prepareRowPointerBatch(tx, creates.length);
        statements.pointers.set(creates.length, pointerInsert);
      }
      const pointerBindings = rowBatchBindings(
        creates.map((row) => ({
          scopeUuid: row.scopeUuid,
          tableId: row.identity.tableId,
          rowId: appRowIdHexV1ToBytes(row.identity.rowId),
          commitSeq: row.commitSeq,
        } satisfies Required<typeof fxAppRowCurrent.$inferInsert>)),
      );
      const created = yield* appRowBatchQueryEffect(() =>
        pointerInsert.execute(pointerBindings),
      );
      const missing = (yield* missingAppRowWritesEffect(creates, created))[0];
      if (missing !== undefined)
        return yield* failAppRowBatchChainEffect(tx, missing);
    }
    if (updates.length > 0) {
      const advanceQuery = tx
        .update(fxAppRowCurrent)
        .set({ commitSeq: first.commitSeq })
        .where(
          or(
            ...updates.map((row) =>
              and(
                eq(fxAppRowCurrent.scopeUuid, row.scopeUuid),
                eq(fxAppRowCurrent.tableId, row.identity.tableId),
                eq(
                  fxAppRowCurrent.rowId,
                  appRowIdHexV1ToBytes(row.identity.rowId),
                ),
                eq(
                  fxAppRowCurrent.commitSeq,
                  row.prevCommitSeq ?? row.commitSeq,
                ),
              ),
            ),
          ),
        )
        .returning(appRowCurrentIdentityColumns);
      const advanced = yield* appRowBatchQueryEffect(() => advanceQuery);
      const missing = (yield* missingAppRowWritesEffect(updates, advanced))[0];
      if (missing !== undefined)
        return yield* failAppRowBatchChainEffect(tx, missing);
    }
  },
);

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

  return Result.succeed(projectAppRowRevision(decoded));
}

function projectAppRowRevision(
  decoded: DecodedAppendAppRowRevisionV1,
): AppRowRevisionV1 {
  return decoded.kind === "live"
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
      } satisfies TombstoneAppRowRevisionV1);
}

async function failAdvancedCurrentPointerConflict(
  tx: AppRowTransaction,
  decoded: DecodedAppendAppRowRevisionV1,
): Promise<Result.Result<AppRowRevisionV1, AppendAppRowRevisionV1Error>> {
  const deleted = await deleteInsertedRevisionInTransactionResult(tx, decoded);
  return await Result.match(deleted, {
    onFailure: async (failure) => Result.fail(failure),
    onSuccess: () => readActualPointerCommitSeqAndFail(tx, decoded),
  });
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
  return Result.flatMap(actual, (headCommitSeq) =>
    Result.fail(new AppRowRevisionChainConflictError(
      decoded.identity,
      decoded.prevCommitSeq,
      headCommitSeq,
    )));
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
  const document = yield* decodeCanonicalAppDocumentEvidenceV1Effect({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime: decoded.base.creationTime,
    codecVersion: decoded.valueCodecVersion,
    canonicalBytes: decoded.valueBytes,
    sha256: decoded.valueSha256,
  }).pipe(Effect.mapError(cause => new AppRowStorageCorruptionError(
    identity,
    "live revision value evidence or trusted system fields do not verify",
    { cause },
  )));
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
    return Result.flatMap(actual, (headCommitSeq) =>
      Result.fail(new AppRowRevisionChainConflictError(
        identity,
        prevCommitSeq,
        headCommitSeq,
      )));
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
