import { AppRowScopeAuthorityUnavailableError, AppRowStorageCorruptionError, AppRowRevisionChainConflictError, AppRowCreationTimeConflictError, AppRowRevisionAlreadyExistsError, InvalidAppRowRevisionV1InputError } from "./appRowErrors";
import type { AppendAppRowRevisionV1Error } from "./appRowErrors";
import { fxSystemScopeExecutionAuthorities } from "../../database/schema";
import { closeExactAttemptScopeClockObservation, exactScopeWriteClockObservationIdentity, readExactScopeWriteClockObservation,
  readFiniteExecutionAuthorityObservation, requireFiniteExecutionAuthorityObservation,
  readProtectedScopeReadIdentity, requireProtectedScopeReadIdentity } from "../../scope/scopeClock";
import type { PointCommitPublicationObservation } from "../../commit/point/observation";
import { and, desc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { observeDrizzleQuery, observeDrizzleRawQuery } from "../../database/drizzleQueryObservation";
import { rowsFromDriverExecuteResult } from "../../database/driverExecuteResult";
import { requireAdmittedTargetInstallationSchema } from "../../installation/installationLifecycle";
import { applicationDomainFailureDetail, buildAppRowBatchStatement } from "../materialization/domainApplication";
import { runPointCommitInTransactionEffect, projectPointCommitTransactionResult } from "../../commit/point/promiseBoundary";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import {
  AppCreationTimeV1Schema,
  decodeAppCreationTimeV1,
  verifyAppDocumentEvidenceV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeStoredAppRowRevisionEvidenceEffect } from "./appRowCanonicalEvidence";
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
import { MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1, MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 } from "flarex-protocol/commit-protocol";
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

import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import {
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemCommitAppRowChanges,
  fxSystemScopeClocks,
} from "../../database/schema";

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

export class InvalidAppRowBatchInputError extends Error {
  readonly _tag = "InvalidAppRowBatchInputError" as const;
  constructor(
    readonly reason:
      "mixedPublication" | "duplicateIdentity" | "documentBytesExceeded" | "rowCountExceeded" | "byteCountExceeded",
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
const decodeTableFrontierBatchRowResult = Schema.decodeUnknownResult(Schema.Struct({
  ordinal: Schema.Int,
  commitSeqText: Schema.NullOr(Schema.String),
}));
const decodeBigIntTextResult = Schema.decodeUnknownResult(Schema.BigIntFromString);
const decodeCanonicalSnapshotSequenceTextResult = Schema.decodeUnknownResult(
  Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/)));
function decodeSnapshotSequenceTextResult(value: unknown) {
  return decodeCanonicalSnapshotSequenceTextResult(value).pipe(Result.flatMap(decodeBigIntTextResult));
}

const TABLE_FRONTIER_BATCH_SIZE = 64;

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

/** Each entry retains its own stored-value verdict so a caller can consume
 * coverage in definition order. The returned values belong only to this SQL
 * transaction and its current pointer visibility. */
export const readAppTableWriteFrontiersInTransactionEffect = Effect.fn(
  "AppRows.readTableWriteFrontiers",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  tableIds: ReadonlyArray<CatalogTableId>,
): Effect.fn.Return<
  ReadonlyMap<CatalogTableId, Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>>,
  InvalidAppRowReadInputError | AppRowReadPersistenceError
> {
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId)).pipe(
    Effect.mapError(cause => new InvalidAppRowReadInputError({ reason: "invalidScopeId", cause })),
  );
  const distinct = new Set<CatalogTableId>();
  for (const tableId of tableIds) {
    const table = yield* Effect.fromResult(decodeCatalogTableIdResult(tableId)).pipe(
      Effect.mapError(cause => new InvalidAppRowReadInputError({ reason: "invalidTableId", cause })),
    );
    distinct.add(table);
  }
  const selected = [...distinct];
  const frontiers = new Map<CatalogTableId, Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>>();
  for (let offset = 0; offset < selected.length; offset += TABLE_FRONTIER_BATCH_SIZE) {
    const batch = selected.slice(offset, offset + TABLE_FRONTIER_BATCH_SIZE);
    const values = sql.join(batch.map((tableId, ordinal) => sql`(${ordinal}::integer, ${tableId}::integer)`), sql`, `);
    const query = tx.execute(sql`
      with requested(ordinal, table_id) as (values ${values})
      select requested.ordinal as "ordinal", latest.commit_seq::text as "commitSeqText"
      from requested
      left join lateral (
        select current_row.commit_seq from fx_app_row_current as current_row
        where current_row.scope_uuid = ${scope.scopeUuid} and current_row.table_id = requested.table_id
        order by current_row.commit_seq desc limit 1
      ) as latest on true
      order by requested.ordinal
    `);
    const result = yield* Effect.uninterruptible(runDrizzleStatementEffect(query,
      cause => new AppRowReadPersistenceError("readTableFrontier", cause)));
    const rows = isNonArrayRecord(result) && Array.isArray(result.rows) ? result.rows : [];
    for (let ordinal = 0; ordinal < batch.length; ordinal += 1) {
      const tableId = batch[ordinal]!;
      const row = rows[ordinal];
      frontiers.set(tableId, decodeCapturedAppTableWriteFrontierResult(scopeId, tableId,
        ordinal, row, rows.length, batch.length));
    }
  }
  return frontiers;
});

/** The native batch owner also accepts a frontier retained by a connected
 * writer observation. Canonical text and envelope refusal remain this owner. */
export function decodeCapturedAppTableWriteFrontierResult(
  scopeId: ScopeId, tableId: CatalogTableId, ordinal: number, row: unknown,
  rowCount: number, expectedRowCount: number,
): Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError> {
  return Result.gen(function* () {
    const envelope = yield* decodeTableFrontierBatchRowResult(row);
    if (rowCount !== expectedRowCount || envelope.ordinal !== ordinal)
      return yield* Result.fail(undefined);
    if (envelope.commitSeqText === null) return null;
    const decoded = yield* decodeBigIntTextResult(envelope.commitSeqText).pipe(
      Result.flatMap(decodeCommitSeqResult));
    if (decoded < 1n) return yield* Result.fail(undefined);
    return decoded;
  }).pipe(Result.mapError(cause => new AppRowTableFrontierCorruptionError(scopeId, tableId, cause)));
}

/** Consume frontier demands in caller order. A later input or stored verdict
 * cannot replace an earlier consumer refusal; SQL reuses the existing batch. */
export const consumeAppTableWriteFrontiersInTransactionEffect = Effect.fn("AppRows.consumeTableWriteFrontiers")(
  function* <Failure, Requirements>(tx: AppRowTransaction, scopeId: ScopeId, tableIds: readonly CatalogTableId[],
    error: (cause: InvalidAppRowReadInputError | AppRowReadPersistenceError | AppRowTableFrontierCorruptionError) => Failure,
    consume: (ordinal: number, frontier: CommitSeq | null) => Effect.Effect<void, Failure, Requirements>,
  ): Effect.fn.Return<void, Failure, Requirements> {
    if (tableIds.length === 0) return;
    yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId)).pipe(Effect.mapError(cause =>
      error(new InvalidAppRowReadInputError({ reason: "invalidScopeId", cause }))));
    for (let offset = 0; offset < tableIds.length;) {
      const prepared: CatalogTableId[] = [];
      let preparationFailure: InvalidAppRowReadInputError | undefined;
      while (offset + prepared.length < tableIds.length && prepared.length < TABLE_FRONTIER_BATCH_SIZE) {
        const selected = tableIds[offset + prepared.length];
        const decoded = decodeCatalogTableIdResult(selected);
        if (Result.isFailure(decoded)) {
          preparationFailure = new InvalidAppRowReadInputError({ reason: "invalidTableId", cause: decoded.failure });
          break;
        }
        prepared.push(decoded.success);
      }
      const frontiers = yield* readAppTableWriteFrontiersInTransactionEffect(tx, scopeId, prepared).pipe(Effect.mapError(error));
      for (const [ordinal, tableId] of prepared.entries()) {
        const verdict = frontiers.get(tableId);
        if (verdict === undefined) return yield* Effect.die(new Error("Table frontier batch lost a selection"));
        yield* consume(offset + ordinal, yield* Effect.fromResult(verdict).pipe(Effect.mapError(error)));
      }
      offset += prepared.length;
      if (preparationFailure !== undefined) return yield* Effect.fail(error(preparationFailure));
    }
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

/** Decoded demand only; scope and execution authority remain with the caller. */
export interface PreparedAppRowsSnapshotRead extends ReadAppRowsAtSnapshotV1Input { readonly scopeUuid: ScopeUuidV1; }
export const prepareAppRowsSnapshotReadResult = (
  input: ReadAppRowsAtSnapshotV1Input,
): Result.Result<PreparedAppRowsSnapshotRead, InvalidAppRowReadInputError> => Result.gen(function* () {
  if (input.rowIds.length > MAX_BOUNDED_APP_ROW_READ_IDENTITIES)
    return yield* Result.fail(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: input.rowIds.length }));
  const scopeId = yield* decodeReadFieldResult(decodeScopeIdResult(input.scopeId), "invalidScopeId");
  const projection = yield* projectScopeIdUuidV1Result(scopeId).pipe(Result.mapError(cause =>
    new InvalidAppRowReadInputError({ reason: "invalidScopeId", cause })));
  const tableId = yield* decodeReadFieldResult(decodeCatalogTableIdResult(input.tableId), "invalidTableId");
  const rowIds: AppRowIdHexV1[] = [];
  for (const rowId of input.rowIds)
    rowIds.push(yield* decodeReadFieldResult(decodeAppRowIdHexV1Result(rowId), "invalidRowId"));
  if (new Set(rowIds).size !== rowIds.length)
    return yield* Result.fail(new InvalidAppRowReadInputError({ reason: "invalidRowId", cause: new Error("Expected distinct row identities.") }));
  const snapshotCommitSeq = yield* decodeReadFieldResult(decodeCommitSeqResult(input.snapshotCommitSeq), "invalidSnapshotCommitSeq");
  return Object.freeze({ scopeId, scopeUuid: projection.scopeUuid, tableId, rowIds: Object.freeze(rowIds), snapshotCommitSeq });
});

export interface AppRowsSnapshotReadExpressions {
  readonly scopeUuid: SQL; readonly tableId: SQL; readonly rowIds: SQL; readonly snapshotCommitSeq: SQL;
  readonly transferBudget: SQL; readonly settlementWindow: SQL;
}

/** Code-owned prepared composition only. No capture request accepts SQL expressions. */
export function buildPreparedAppRowsSnapshotReadStatement(schemaName: string | undefined, parameters: AppRowsSnapshotReadExpressions): SQL {
  const reader = schemaName === undefined ? sql`fx_read_snapshot_rows` : sql`${sql.identifier(schemaName)}.fx_read_snapshot_rows`;
  return sql`select r.ordinal, r.requested_row_id as "requestedRowId", r.row_present as "rowPresent",
    r.scope_uuid as "scopeUuid", r.table_id as "tableId", r.row_id as "rowId", r.commit_seq_text as "commitSeq",
    r.prev_commit_seq_text as "prevCommitSeq", r.write_epoch_uuid as "writeEpochUuid",
    r.schema_version_id as "schemaVersionId", r.creation_time as "creationTime", r.value_codec_version as "valueCodecVersion",
    r.is_tombstone as "isTombstone", r.value_sha256 as "valueSha256", r.value_bytes as "valueBytes", r.body_withheld as "bodyWithheld"
    from ${reader}(${parameters.scopeUuid}::uuid, ${parameters.tableId}::integer,
      ${parameters.rowIds}::bytea[],
      ${parameters.snapshotCommitSeq}::bigint, ${parameters.transferBudget}::bigint, ${parameters.settlementWindow}::boolean) r order by r.ordinal`;
}


export function buildAppRowsSnapshotReadStatement(input: PreparedAppRowsSnapshotRead,
  transferBudget?: number, settlementWindow = false, schemaName?: string): SQL {
  return buildPreparedAppRowsSnapshotReadStatement(schemaName, { scopeUuid: sql`${input.scopeUuid}`, tableId: sql`${input.tableId}`,
    rowIds: sql`array[${sql.join(input.rowIds.map(rowId => sql`${appRowIdHexV1ToBytes(rowId)}::bytea`), sql`, `)}]`,
    snapshotCommitSeq: sql`${input.snapshotCommitSeq}`, transferBudget: sql`${transferBudget ?? null}`, settlementWindow: sql`${settlementWindow}` });
}

export const captureAppRowsAtSnapshotInTransactionEffect = Effect.fn("AppRows.captureSnapshotRead")(function* (
  tx: AppRowTransaction, input: PreparedAppRowsSnapshotRead, transferBudget?: number,
  observer?: Parameters<typeof observeDrizzleQuery<"snapshotRevision">>[2], settlementWindow = false,
): Effect.fn.Return<ReadonlyArray<unknown>, AppRowReadPersistenceError> {
  const query = tx.execute(buildAppRowsSnapshotReadStatement(input, transferBudget, settlementWindow));
  observeDrizzleRawQuery("snapshotRevision", query, observer);
  const result = yield* Effect.uninterruptible(runDrizzleStatementEffect(query,
    cause => new AppRowReadPersistenceError("readSnapshotRevision", cause)));
  return rowsFromDriverExecuteResult(result, () => {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - a resolved SQL read must expose the driver's rows wrapper.
    throw new Error("Snapshot driver result has no rows");
  });
});

const SnapshotRowEnvelopeSchema = Schema.Struct({ ordinal: Schema.Number, requestedRowId: Schema.Uint8Array,
  rowPresent: Schema.Boolean, bodyWithheld: Schema.Boolean });
const decodeSnapshotRowEnvelopeEffect = Schema.decodeUnknownEffect(SnapshotRowEnvelopeSchema);

function captureSnapshotRowResult(identity: AppRowIdentityV1, ordinal: number, raw: unknown,
  envelope: typeof SnapshotRowEnvelopeSchema.Type) {
  return Result.gen(function* () {
    const requested = yield* appRowIdHexV1FromBytesResult(envelope.requestedRowId).pipe(Result.mapError(cause =>
      new AppRowStorageCorruptionError(identity, "snapshot requested identity does not decode", { cause })));
    if (envelope.ordinal !== ordinal || requested !== identity.rowId || !isNonArrayRecord(raw))
      return yield* Result.fail(new AppRowStorageCorruptionError(identity, "snapshot requested ordinal or identity differs"));
    if (envelope.bodyWithheld) return { kind: "withheld" as const };
    if (!envelope.rowPresent) return { kind: "missing" as const };
    // Preserve column access order without eagerly projecting the driver row.
    return yield* decodeRevisionRowEvidenceResult(identity, {
      get rowId() { return raw.rowId; }, get scopeUuid() { return raw.scopeUuid; },
      get writeEpochUuid() { return raw.writeEpochUuid; }, get commitSeq() { return raw.commitSeq; },
      get prevCommitSeq() { return raw.prevCommitSeq; }, get schemaVersionId() { return raw.schemaVersionId; },
      get creationTime() { return raw.creationTime; }, get isTombstone() { return raw.isTombstone; },
      get valueBytes() { return raw.valueBytes; }, get valueSha256() { return raw.valueSha256; },
      get valueCodecVersion() { return raw.valueCodecVersion; }, get tableId() { return raw.tableId; },
    }, true);
  });
}

/** Each ordinal is decoded and consumed before later body evidence is accessed. */
export const consumeCapturedAppRowsAtSnapshotEffect = Effect.fn("AppRows.consumeCapturedSnapshotRead")(
  function* <Failure, Requirements>(input: PreparedAppRowsSnapshotRead, rows: readonly unknown[],
    error: (cause: AppRowStorageCorruptionError) => Failure,
    consume: (rowId: AppRowIdHexV1, revision: AppRowReadResultV1) => Effect.Effect<void, Failure, Requirements>,
    settlementWindow = false,
  ): Effect.fn.Return<number, Failure, Requirements> {
    let consumed = 0;
    for (const [ordinal, rowId] of input.rowIds.entries()) {
      const identity = { scopeId: input.scopeId, tableId: input.tableId, rowId };
      // This boundary precedes every next row access, including missing and
      // tombstone rows whose acceptance does not otherwise suspend for SHA.
      const captured = yield* Effect.suspend(() => {
        const raw = rows[ordinal];
        // Foreign Schema access owns a full Cause. Pure checks start only after
        // that envelope is captured; an accessor defect is never a parse issue.
        return decodeSnapshotRowEnvelopeEffect(raw).pipe(
          Effect.mapError(cause =>
            new AppRowStorageCorruptionError(identity, "snapshot row envelope does not decode", { cause })),
          Effect.flatMap(envelope => Effect.fromResult(captureSnapshotRowResult(identity, ordinal, raw, envelope))));
      }).pipe(Effect.mapError(error));
      if (captured.kind === "withheld" && settlementWindow) return consumed;
      if (captured.kind === "withheld") return yield* Effect.die(new Error("Trusted snapshot hydration reached a withheld body after its transfer budget"));
      const revision = captured.kind === "missing" ? MISSING_APP_ROW_REVISION_V1 : captured.kind === "tombstone"
        ? Object.freeze({ kind: "tombstone" as const, ...captured.base })
        : yield* decodeLiveRevisionEvidenceEffect(identity, captured).pipe(Effect.mapError(error));
      yield* consume(rowId, revision);
      consumed++;
    }
    const first = input.rowIds[0];
    if (rows.length !== input.rowIds.length && first !== undefined)
      return yield* Effect.fail(error(new AppRowStorageCorruptionError({ scopeId: input.scopeId, tableId: input.tableId, rowId: first },
        "snapshot returned unexpected row ordinals")));
    return consumed;
  });

const consumeSnapshotRows = Effect.fn("AppRows.consumeSetAtSnapshotInTransaction")(function* <Failure, Requirements>(
  tx: AppRowTransaction, input: ReadAppRowsAtSnapshotV1Input, transferBudget: number | undefined,
  error: (cause: ReadAppRowError) => Failure,
  consume: (rowId: AppRowIdHexV1, revision: AppRowReadResultV1) => Effect.Effect<void, Failure, Requirements>,
  observer?: Parameters<typeof observeDrizzleQuery<"snapshotRevision">>[2], settlementWindow = false,
): Effect.fn.Return<number, Failure, Requirements> {
  if (input.rowIds.length === 0) return 0;
  const prepared = yield* Effect.fromResult(prepareAppRowsSnapshotReadResult(input)).pipe(Effect.mapError(error));
  const identity = yield* Effect.fromResult(decodeReadIdentityResult({ scopeId: prepared.scopeId, tableId: prepared.tableId,
    rowId: prepared.rowIds[0]! })).pipe(Effect.mapError(error));
  yield* requireScopeUuidInTransactionEffect(tx, identity).pipe(Effect.mapError(error));
  const rows = yield* captureAppRowsAtSnapshotInTransactionEffect(tx, prepared, transferBudget, observer, settlementWindow).pipe(Effect.mapError(error));
  return yield* consumeCapturedAppRowsAtSnapshotEffect(prepared, rows, error, consume, settlementWindow);
});

/** Private working-set hydration. The trusted consumer must refuse once
 * canonical bodies cross this initial budget, before reaching withheld rows. */
export const consumeBoundedAppRowsAtSnapshotInTransactionEffect = Effect.fn("AppRows.consumeBoundedSetAtSnapshotInTransaction")(
  function* <Failure, Requirements>(tx: AppRowTransaction,
    input: ReadAppRowsAtSnapshotV1Input & Readonly<{ maximumTotalValueBytes: number }>,
    error: (cause: ReadAppRowError) => Failure,
    consume: (rowId: AppRowIdHexV1, revision: AppRowReadResultV1) => Effect.Effect<void, Failure, Requirements>,
    observer?: Parameters<typeof observeDrizzleQuery<"snapshotRevision">>[2],
  ): Effect.fn.Return<void, Failure, Requirements> {
    if (!Number.isSafeInteger(input.maximumTotalValueBytes) || input.maximumTotalValueBytes < 0 ||
      input.maximumTotalValueBytes > MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES)
      return yield* Effect.fail(error(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: input.maximumTotalValueBytes })));
    yield* consumeSnapshotRows(tx, input, input.maximumTotalValueBytes, error, consume, observer);
  });

/** Ordered settlement hydration. The transaction owner supplies at most one
 * 32-identity frontier; missing and tombstone revisions remain observable, and
 * the consumer can refuse before a later canonical body is decoded. */
export const consumeAppRowSnapshotRevisionsInTransactionEffect = Effect.fn("AppRows.consumeSettlementSnapshotRevisions")(
  function* <Failure, Requirements>(tx: AppRowTransaction, input: ReadAppRowsAtSnapshotV1Input,
    error: (cause: ReadAppRowError) => Failure,
    consume: (rowId: AppRowIdHexV1, revision: AppRowReadResultV1) => Effect.Effect<void, Failure, Requirements>,
    observer?: Parameters<typeof observeDrizzleQuery<"snapshotRevision">>[2],
  ): Effect.fn.Return<void, Failure, Requirements> {
    if (input.rowIds.length > 32)
      return yield* Effect.fail(error(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: input.rowIds.length })));
    let offset = 0;
    while (offset < input.rowIds.length) {
      const consumed = yield* consumeSnapshotRows(tx, { ...input, rowIds: input.rowIds.slice(offset) },
        262_144, error, consume, observer, true);
      if (consumed === 0) return yield* Effect.die(new Error("Settlement snapshot window made no progress"));
      offset += consumed;
    }
  });

/** Bounded live materialization for identities selected by an authenticated index. */
export const readLiveAppRowsAtSnapshotInTransactionEffect = Effect.fn("AppRows.readLiveSetAtSnapshotInTransaction")(
  function* (tx: AppRowTransaction, input: ReadAppRowsAtSnapshotV1Input): Effect.fn.Return<ReadonlyArray<LiveAppRowRevisionV1>, ReadAppRowError> {
    if (input.rowIds.length > MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1)
      return yield* Effect.fail(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded",
        cause: new Error(`Expected at most ${MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1} row identities.`) }));
    const revisions: LiveAppRowRevisionV1[] = [];
    yield* consumeSnapshotRows(tx, input, undefined, cause => cause, (rowId, revision) => {
      if (revision.kind !== "live") return Effect.fail(new AppRowStorageCorruptionError(
        { scopeId: input.scopeId, tableId: input.tableId, rowId }, revision.kind === "missing"
          ? "index position references no visible row revision" : "index position references a tombstone row revision"));
      revisions.push(revision);
      return Effect.void;
    });
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
  const prepared: PreparedAppRowsSnapshotRead = { ...identity, scopeUuid, rowIds: [identity.rowId], snapshotCommitSeq };
  const rows = yield* captureAppRowsAtSnapshotInTransactionEffect(tx, prepared, undefined, observer);
  let revision: AppRowReadResultV1 = MISSING_APP_ROW_REVISION_V1;
  yield* consumeCapturedAppRowsAtSnapshotEffect(prepared, rows, cause => cause, (_rowId, value) => Effect.sync(() => { revision = value; }));
  return revision;
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

  return projectAppRowPointReadResult(identity, revision);
});

export function projectAppRowPointReadResult(identity: AppRowIdentityV1, revision: AppRowReadResultV1): AppRowPointReadResultV1 {
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
}


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

export type CurrentAppRowReadLimits = Readonly<{ maximumIdentities: number;
  maximumDocumentBytes: number; maximumTotalValueBytes: number }>;
const requireCurrentReadLimits = Effect.fn("AppRows.requireCurrentReadLimits")(function* (input: CurrentAppRowReadLimits) {
  if (!Number.isSafeInteger(input.maximumIdentities) || input.maximumIdentities < 0 || input.maximumIdentities > MAX_BOUNDED_APP_ROW_READ_IDENTITIES ||
    !Number.isSafeInteger(input.maximumDocumentBytes) || input.maximumDocumentBytes < 1 || input.maximumDocumentBytes > 1_048_576 ||
    !Number.isSafeInteger(input.maximumTotalValueBytes) || input.maximumTotalValueBytes < 0 || input.maximumTotalValueBytes > MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES)
    return yield* Effect.fail(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: input.maximumIdentities }));
});

/** The exact current-pointer join bounds this projection to one identity.
 * Rejected bodies remain inside Postgres, including a unique-owner capture. */
function projectBoundedCurrentAppRowPoint(input: Readonly<{
  maximumIdentities: number | SQL; maximumDocumentBytes: number | SQL; maximumTotalValueBytes: number | SQL;
}>,
  clock: Readonly<{ commitSeq: SQL; epoch: SQL }>) {
  const bytes = sql`coalesce(octet_length(${fxAppRowRevisions.valueBytes}), 0)`;
  const withinBudget = sql<boolean>`${fxAppRowCurrent.rowId} is null or (${input.maximumIdentities} >= 1
    and ${bytes} <= ${input.maximumDocumentBytes} and ${bytes} <= ${input.maximumTotalValueBytes})`;
  return {
    observedCommitSeq: clock.commitSeq.mapWith(fxSystemScopeClocks.lastCommitSeq),
    observedEpoch: clock.epoch.mapWith(fxSystemScopeExecutionAuthorities.epoch),
    withinBudget, bodyWithheld: sql<boolean>`false`, pointer: fxAppRowCurrent,
    revision: { ...getTableColumns(fxAppRowRevisions),
      valueBytes: sql`case when ${withinBudget} then ${fxAppRowRevisions.valueBytes} else null end`
        .mapWith(fxAppRowRevisions.valueBytes) },
  };
}
type CapturedCurrentAppRowPoint = Readonly<{ observedCommitSeq: CommitSeq; withinBudget: boolean;
  pointer: typeof fxAppRowCurrent.$inferSelect | null; revision: typeof fxAppRowRevisions.$inferSelect | null }>;

/** Source-private joined-capture decoder. Its caller has authenticated the
 * selected identity and owns the accepting transaction and capture lifetime. */
const decodeCapturedPublishedCurrentAppRowEffect = Effect.fn("AppRows.decodeCapturedPublishedPoint")(function* (
  identity: AppRowIdentityV1, input: CurrentAppRowReadLimits & { readonly minimumCommitSeq: CommitSeq },
  captured: CapturedCurrentAppRowPoint,
) {
  yield* requireCurrentReadLimits(input);
  const minimumCommitSeq = yield* Effect.fromResult(decodeReadFieldResult(decodeCommitSeqResult(input.minimumCommitSeq), "invalidSnapshotCommitSeq"));
  const readAt = yield* Effect.fromResult(decodeReadFieldResult(decodeCommitSeqResult(captured.observedCommitSeq), "invalidSnapshotCommitSeq"));
  if (readAt < minimumCommitSeq) return yield* Effect.fail(new InvalidAppRowReadInputError({
    reason: "invalidSnapshotCommitSeq", cause: minimumCommitSeq }));
  if (!captured.withinBudget) return yield* Effect.fail(new InvalidAppRowReadInputError({
    reason: "rowLimitExceeded", cause: "bounded current view exceeds capture budget" }));
  if (captured.pointer === null) return Object.freeze({ row: null, readAt });
  if (captured.revision === null || captured.pointer.commitSeq > readAt)
    return yield* Effect.fail(new AppRowStorageCorruptionError(identity, "bounded current pointer exceeds its statement publication clock"));
  return Object.freeze({ row: yield* decodeRevisionRowEffect(identity, captured.revision), readAt });
});

/**
 * Private bounded statement-current view. The caller protects lifecycle and
 * either owns a physical snapshot or validates all observations at settlement.
 * Rows and their publication ceiling come from one statement snapshot.
 */
type BoundedCurrentAppRowReadInput = Readonly<{ scopeId: ScopeId; tableId: CatalogTableId; minimumCommitSeq: CommitSeq;
  maximumIdentities: number; maximumDocumentBytes: number; maximumTotalValueBytes: number;
  rowId?: AppRowIdHexV1; rowIds?: readonly AppRowIdHexV1[] }>;

const captureBoundedCurrentAppRows = Effect.fn(
  "AppRows.readBoundedCurrentSet",
)(function* (
  tx: AppRowTransaction,
  input: BoundedCurrentAppRowReadInput,
  observer?: Parameters<typeof observeDrizzleQuery<"currentCapture">>[2],
  profile?: "publicationTargets",
) {
  yield* requireCurrentReadLimits(input);
  const scopeId = yield* Effect.fromResult(decodeReadFieldResult(decodeScopeIdResult(input.scopeId), "invalidScopeId"));
  const tableId = yield* Effect.fromResult(decodeReadFieldResult(decodeCatalogTableIdResult(input.tableId), "invalidTableId"));
  const minimumCommitSeq = yield* Effect.fromResult(decodeReadFieldResult(decodeCommitSeqResult(input.minimumCommitSeq), "invalidSnapshotCommitSeq"));
  const scopeUuid = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId).pipe(
    Result.mapError(cause => new InvalidAppRowReadInputError({ reason: "invalidScopeId", cause })),
  ));
  const clock = tx.$with("capture_clock").as(tx.select({ lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
    epoch: fxSystemScopeExecutionAuthorities.epoch })
    .from(fxSystemScopeClocks).innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId)).where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid.scopeUuid)).limit(1));
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
      return tx.with(clock).select(projectBoundedCurrentAppRowPoint(input,
        { commitSeq: sql`${clock.lastCommitSeq}`, epoch: sql`${clock.epoch}` }))
        .from(clock).leftJoin(fxAppRowCurrent, where).leftJoin(fxAppRowRevisions, join).limit(1);
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
      allowed: (profile === "publicationTargets" ? sql<boolean>`count(*) <= ${input.maximumIdentities}` : sql<boolean>`count(*) <= ${input.maximumIdentities}
        and coalesce(max(${bounded.bytes}), 0) <= ${input.maximumDocumentBytes}
        and coalesce(sum(${bounded.bytes}), 0) <= ${input.maximumTotalValueBytes}`).as("within_budget"),
    }).from(bounded));
    return tx.with(clock, bounded, budget).select({
      observedCommitSeq: clock.lastCommitSeq,
      observedEpoch: clock.epoch,
      withinBudget: budget.allowed,
      bodyWithheld: profile === "publicationTargets"
        ? sql<boolean>`coalesce(${bounded.bytes} > ${input.maximumDocumentBytes}, false)` : sql<boolean>`false`,
      pointer: { scopeUuid: bounded.scopeUuid, tableId: bounded.tableId, rowId: bounded.rowId, commitSeq: bounded.commitSeq },
      revision: profile === "publicationTargets" ? { ...getTableColumns(fxAppRowRevisions),
        valueBytes: sql`case when ${bounded.bytes} <= ${input.maximumDocumentBytes} then ${fxAppRowRevisions.valueBytes} else null end`
          .mapWith(fxAppRowRevisions.valueBytes) } : fxAppRowRevisions,
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
  return { rows, commitSeq, verdict, scopeId, tableId, scopeUuid };
});

const readBoundedCurrentAppRows = Effect.fn("AppRows.readBoundedCurrentSet")(function* (
  tx: AppRowTransaction, input: BoundedCurrentAppRowReadInput,
  observer?: Parameters<typeof observeDrizzleQuery<"currentCapture">>[2], pendingCommitSeq?: CommitSeq,
): Effect.fn.Return<Readonly<{ rows: readonly AppRowRevisionV1[]; commitSeq: CommitSeq }>, ReadAppRowError> {
  const { rows, commitSeq, verdict, scopeId, tableId, scopeUuid } = yield* captureBoundedCurrentAppRows(tx, input, observer);
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
    if (pendingCommitSeq === undefined && input.rowId !== undefined) {
      const captured = yield* decodeCapturedPublishedCurrentAppRowEffect(identity, input, row);
      if (captured.row === null) return yield* Effect.die(new Error("Current pointer lost its captured revision"));
      revisions.push(captured.row);
    } else revisions.push(yield* decodeRevisionRowEffect(identity, row.revision));
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


/** A publication target reader opens at most four 64-KiB bodies on demand.
 * Canonical decoding and the finished-fact check stay at the requested ordinal;
 * a target constraint may refuse before a later corrupt body is examined. */
export const withPublicationAppRowTargetsInTransactionEffect = Effect.fn("AppRows.withPublicationTargets")(
  function* <Value, Failure, Requirements>(tx: AppRowTransaction, input: {
    readonly scopeId: ScopeId; readonly tableId: CatalogTableId; readonly rowIds: readonly AppRowIdHexV1[];
    readonly minimumCommitSeq: CommitSeq; readonly pendingCommitSeq: CommitSeq;
  }, error: (cause: ReadAppRowError) => Failure,
    use: (read: (ordinal: number) => Effect.Effect<AppRowRevisionV1 | null, Failure>) => Effect.Effect<Value, Failure, Requirements>,
  ): Effect.fn.Return<Value, Failure, Requirements> {
    if (input.rowIds.length > 32 || new Set(input.rowIds).size !== input.rowIds.length)
      return yield* Effect.fail(error(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: input.rowIds.length })));
    type Capture = Effect.Success<ReturnType<typeof captureBoundedCurrentAppRows>>;
    const captures = new Map<number, Capture>();
    const decoded = new Map<number, AppRowRevisionV1 | null>();
    const publicationFacts = new Map<number, readonly { rowId: Uint8Array }[]>();
    const clockIdentity = exactScopeWriteClockObservationIdentity(tx, input.scopeId);
    let active = true;
    const read = Effect.fn("AppRows.readPublicationTargetOrdinal")(function* (ordinal: number) {
      if (!active || clockIdentity !== exactScopeWriteClockObservationIdentity(tx, input.scopeId) ||
        !Number.isSafeInteger(ordinal) || input.rowIds[ordinal] === undefined)
        return yield* Effect.fail(error(new InvalidAppRowReadInputError({ reason: "rowLimitExceeded", cause: "closed target capture or unrequested ordinal" })));
      if (decoded.has(ordinal)) return decoded.get(ordinal) ?? null;
      const offset = Math.floor(ordinal / 4) * 4;
      let capture = captures.get(offset);
      if (capture === undefined) {
        const rowIds = input.rowIds.slice(offset, offset + 4);
        capture = yield* captureBoundedCurrentAppRows(tx, { ...input, rowIds, maximumIdentities: rowIds.length,
          maximumDocumentBytes: 65_536, maximumTotalValueBytes: 262_144 }, undefined, "publicationTargets").pipe(Effect.mapError(error));
        if (capture.commitSeq !== input.minimumCommitSeq) return yield* Effect.fail(error(new AppRowStorageCorruptionError(
          { scopeId: input.scopeId, tableId: input.tableId, rowId: input.rowIds[ordinal]! }, "publication target clock changed")));
        captures.set(offset, capture);
      }
      const rowId = input.rowIds[ordinal]!;
      const matches = capture.rows.filter(row => row.pointer !== null && bytesEqualFullScan(row.pointer.rowId, appRowIdHexV1ToBytes(rowId)));
      if (matches.length > 1) return yield* Effect.fail(error(new AppRowStorageCorruptionError(
        { scopeId: input.scopeId, tableId: input.tableId, rowId }, "publication target has multiple current pointers")));
      const stored = matches[0];
      if (stored === undefined) { decoded.set(ordinal, null); return null; }
      if (stored.bodyWithheld) return yield* Effect.fail(error(new InvalidAppRowReadInputError({
        reason: "rowLimitExceeded", cause: "publication target body exceeds its admitted read bound" })));
      const identity = { scopeId: input.scopeId, tableId: input.tableId, rowId };
      if (stored.pointer === null || stored.revision === null || (stored.pointer.commitSeq > stored.observedCommitSeq &&
        (stored.pointer.commitSeq !== input.pendingCommitSeq || input.pendingCommitSeq !== stored.observedCommitSeq + 1n)))
        return yield* Effect.fail(error(new AppRowStorageCorruptionError(identity, "bounded current pointer exceeds its statement publication clock")));
      const revision = yield* decodeRevisionRowEffect(identity, stored.revision).pipe(Effect.mapError(error));
      if (stored.pointer.commitSeq > stored.observedCommitSeq) {
        const epoch = projectScopeEpochUuidV1(capture.verdict.observedEpoch).epochUuid;
        if (stored.revision.writeEpochUuid !== epoch) return yield* Effect.fail(error(new AppRowStorageCorruptionError(identity, "pending current revision has a stale scope epoch")));
        let facts = publicationFacts.get(offset);
        if (facts === undefined) {
        const pendingRows = capture.rows.filter(row => row.pointer !== null && row.pointer.commitSeq > row.observedCommitSeq);
        facts = yield* readAppRowRowsEffect(tx.select({ rowId: fxSystemCommitAppRowChanges.rowId }).from(fxSystemCommitAppRowChanges)
          .where(and(eq(fxSystemCommitAppRowChanges.scopeUuid, capture.scopeUuid.scopeUuid),
            eq(fxSystemCommitAppRowChanges.epochUuid, epoch), eq(fxSystemCommitAppRowChanges.tableId, input.tableId),
            eq(fxSystemCommitAppRowChanges.commitSeq, input.pendingCommitSeq), inArray(fxSystemCommitAppRowChanges.rowId, pendingRows.flatMap(row => row.pointer === null ? [] : [row.pointer.rowId])))), "readPublicationFact").pipe(Effect.mapError(error));
        publicationFacts.set(offset, facts);
        }
        if (facts.filter(fact => bytesEqualFullScan(fact.rowId, appRowIdHexV1ToBytes(rowId))).length !== 1) return yield* Effect.fail(error(new AppRowStorageCorruptionError(identity, "pending current pointer has no exact publication fact")));
      }
      decoded.set(ordinal, revision);
      return revision;
    });
    return yield* use(read).pipe(Effect.ensuring(Effect.sync(() => { active = false; })));
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
  projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(appendPreparedRowBatchEffect(tx, [decoded])));
  return projectAppRowRevision(decoded);
}

const APP_ROW_BATCH_ROWS = 32;
const APP_ROW_BATCH_MAX_ROWS = 512;
const APP_ROW_BATCH_TARGET_BYTES = 256 * 1024;
const APP_ROW_BATCH_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
// Bound complete retained write proofs independently of any journal/session profile.
const APP_ROW_BATCH_MAX_CANONICAL_BYTES = MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1;

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
export const prepareAppRowRevisionApplicationEffect = Effect.fn(
  "AppRows.prepareRevisionApplication",
)(function* (
  tx: AppRowTransaction,
  inputs: ReadonlyArray<AppendPreparedAppRowRevisionV1Input>,
): Effect.fn.Return<PreparedAppRowRevisionApplication, AppRowBatchError> {
  const first = inputs[0];
  if (first === undefined) return { decoded: [], pageCounts: [], values: [] };
  if (inputs.length > APP_ROW_BATCH_MAX_ROWS) return yield* Effect.fail(new InvalidAppRowBatchInputError("rowCountExceeded"));
  const decoded: DecodedAppendAppRowRevisionV1[] = [];
  const identities = new Set<string>();
  const projection = projectScopeIdUuidV1(first.scopeId);
  const observedClock = readExactScopeWriteClockObservation(tx, first.scopeId);
  const authority = observedClock === undefined ? yield* appRowBatchQueryEffect(() => selectScopeAuthorityRows(tx, projection))
    : [{ scopeId: observedClock.scopeId, scopeUuid: projectScopeIdUuidV1(observedClock.scopeId).scopeUuid }];
  if (authority[0]?.scopeUuid !== projection.scopeUuid)
    return yield* Effect.fail(
      new AppRowScopeAuthorityUnavailableError(first.scopeId),
    );
  const scopeUuid = decodeScopeUuidV1(authority[0].scopeUuid);
  let canonicalBytes = 0;
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
    canonicalBytes += input.kind === "live" ? input.document.canonicalBytes.byteLength : 0;
    if (canonicalBytes > APP_ROW_BATCH_MAX_CANONICAL_BYTES)
      return yield* Effect.fail(new InvalidAppRowBatchInputError("byteCountExceeded"));
    const base = { ...input, ...scalars, identity, scopeUuid };
    decoded.push(
      input.kind === "live"
        ? { ...base, kind: "live", document: input.document }
        : { ...base, kind: "tombstone" },
    );
  }
  const pageCounts: number[] = [];
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
    pageCounts.push(batch.length);
  }
  return { decoded, pageCounts, values: preparedAppRowWrites(decoded) };
});

export interface PreparedAppRowRevisionApplication {
  readonly decoded: readonly DecodedAppendAppRowRevisionV1[];
  readonly pageCounts: readonly number[];
  readonly values: ReturnType<typeof preparedAppRowWrites>;
}

export function preparedAppRowApplicationFailure(cause: unknown, prepared: PreparedAppRowRevisionApplication, pageOffset: number, detail: string): AppRowBatchError {
  let offset = 0;
  for (const count of prepared.pageCounts) {
    if (offset === pageOffset) return rowBatchFailure(cause, prepared.decoded.slice(offset, offset + count),
      offset + count === prepared.decoded.length ? prepared.decoded.slice(0, offset) : [], detail);
    offset += count;
  }
  return new AppRowWritePersistenceError(cause);
}

export const appendPreparedAppRowRevisionsInTransactionEffect = Effect.fn("AppRows.appendPreparedBatch")(function* (
  tx: AppRowTransaction, inputs: ReadonlyArray<AppendPreparedAppRowRevisionV1Input>,
  publicationObservation?: PointCommitPublicationObservation,
): Effect.fn.Return<ReadonlyArray<AppRowRevisionV1>, AppRowBatchError> {
  const prepared = yield* prepareAppRowRevisionApplicationEffect(tx, inputs);
  let offset = 0;
  for (const count of prepared.pageCounts) {
    const batch = prepared.decoded.slice(offset, offset + count);
    const bytes = batch.reduce((sum, row) => sum + (row.kind === "live" ? row.document.canonicalBytes.byteLength : 0), 0);
    yield* appendPreparedRowBatchEffect(tx, batch, publicationObservation, bytes,
      offset + count === prepared.decoded.length ? prepared.decoded.slice(0, offset) : []);
    offset += count;
  }
  return prepared.decoded.map(projectAppRowRevision);
}, (effect, tx) => effect.pipe(Effect.onError(() => Effect.sync(() => closeExactAttemptScopeClockObservation(tx)))));

const RowBatchRefusalSchema = Schema.Struct({
  phase: Schema.Literals(["write", "verify"]),
  reason: Schema.Literals(["invalidBatch", "chainConflict", "creationTimeConflict", "revisionExists", "storedCorruption"]),
  ordinal: Schema.Number,
  actualCommitSeqText: Schema.NullOr(Schema.BigIntFromString),
  actualCreationTime: Schema.NullOr(Schema.toType(AppCreationTimeV1Schema)),
});
const decodeRowBatchRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(RowBatchRefusalSchema),
  { onExcessProperty: "error" });
const decodeRowBatchSuccess = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literal("accepted"), ordinal: Schema.Number,
  actualCommitSeqText: Schema.Null, actualCreationTime: Schema.Null,
}), { onExcessProperty: "error" });

function rowBatchFailure(cause: unknown, batch: readonly DecodedAppendAppRowRevisionV1[], verification: readonly DecodedAppendAppRowRevisionV1[], capturedDetail?: string): AppRowBatchError {
  const detail = capturedDetail ?? applicationDomainFailureDetail(cause, "fx_apply_app_row_batch");
  if (detail === null) return new AppRowWritePersistenceError(cause);
  return Result.match(decodeRowBatchRefusal(detail), {
    onFailure: () => new AppRowWritePersistenceError(cause),
    onSuccess: refusal => {
      if (refusal.phase === "verify" && refusal.reason !== "storedCorruption") return new AppRowWritePersistenceError(cause);
      const selected = refusal.phase === "verify" ? [...verification, ...batch] : batch;
      const row = Number.isSafeInteger(refusal.ordinal) && refusal.ordinal >= 0 ? selected[refusal.ordinal] : undefined;
      if (row === undefined) return new AppRowWritePersistenceError(cause);
      switch (refusal.reason) {
        case "chainConflict":
          if (refusal.actualCommitSeqText !== null && refusal.actualCommitSeqText <= 0n)
            return new AppRowWritePersistenceError(cause);
          return new AppRowRevisionChainConflictError(row.identity, row.prevCommitSeq,
            refusal.actualCommitSeqText === null ? null : CommitSeqSchema.make(refusal.actualCommitSeqText));
        case "creationTimeConflict":
          return refusal.actualCreationTime === null ? new AppRowWritePersistenceError(cause)
            : new AppRowCreationTimeConflictError(row.identity, refusal.actualCreationTime, row.creationTime);
        case "revisionExists": return new AppRowRevisionAlreadyExistsError(row.identity, row.commitSeq);
        case "invalidBatch": return new InvalidAppRowBatchInputError("mixedPublication");
        case "storedCorruption": return new AppRowStorageCorruptionError(row.identity, "prepared row or pointer differs after write", { cause });
      }
    },
  });
}

const preparedAppRowWrites = (selected: readonly DecodedAppendAppRowRevisionV1[]) => selected.map(row => ({
  scopeUuid: row.scopeUuid, tableId: row.identity.tableId, rowId: appRowIdHexV1ToBytes(row.identity.rowId),
  commitSeq: row.commitSeq, prevCommitSeq: row.prevCommitSeq, writeEpochUuid: row.writeEpochUuid,
  schemaVersionId: row.schemaVersionId, creationTime: row.creationTime, valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
  isTombstone: row.kind === "tombstone", valueBytes: row.kind === "live" ? row.document.canonicalBytes : null,
  valueSha256: row.kind === "live" ? row.document.sha256 : null,
} satisfies Required<typeof fxAppRowRevisions.$inferInsert>));

const appendPreparedRowBatchEffect = Effect.fn("AppRows.applyPreparedBatch")(function* (
  tx: AppRowTransaction, batch: readonly DecodedAppendAppRowRevisionV1[],
  publicationObservation?: PointCommitPublicationObservation, canonicalBytes?: number,
  verification: readonly DecodedAppendAppRowRevisionV1[] = [],
): Effect.fn.Return<void, AppRowBatchError> {
  const first = batch[0];
  if (first === undefined) return;
  const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx)).pipe(
    Effect.mapError(cause => new AppRowWritePersistenceError(cause)));
  const statement = buildAppRowBatchStatement(preparedAppRowWrites(batch), schemaName, preparedAppRowWrites(verification));
  const result = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(statement), catch: cause => rowBatchFailure(cause, batch, verification),
  }));
  const returned = rowsFromDriverExecuteResult(result, () => {
    throw new AppRowStorageCorruptionError(first.identity, "row application result has no rows");
  });
  if (returned.length !== 1) return yield* Effect.fail(new AppRowStorageCorruptionError(first.identity, "row application proof count differs"));
  const accepted = yield* Effect.fromResult(decodeRowBatchSuccess(returned[0])).pipe(
    Effect.mapError(cause => new AppRowStorageCorruptionError(first.identity, "row application proof does not decode", { cause })));
  if (accepted.ordinal !== batch.length)
    return yield* Effect.fail(new AppRowStorageCorruptionError(first.identity, "row application proof size differs"));
  if (publicationObservation?.detail) {
    publicationObservation.record({ kind: "batch", owner: "rowRevisions", counts: { rows: batch.length, canonicalBytes: canonicalBytes ?? 0 } });
    const creates = batch.filter(row => row.prevCommitSeq === null).length;
    if (creates > 0) publicationObservation.record({ kind: "batch", owner: "rowCreates", counts: { rows: creates } });
    if (creates < batch.length) publicationObservation.record({ kind: "batch", owner: "rowUpdates", counts: { rows: batch.length - creates } });
  }
});

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

type AppRowRevisionRow = typeof fxAppRowRevisions.$inferSelect;
type StoredAppRowRevisionColumns = { readonly [Key in keyof AppRowRevisionRow]: unknown };

type DecodedAppRowRevisionEvidenceV1 =
  | Readonly<{
      readonly kind: "tombstone";
      readonly base: AppRowRevisionV1Base;
    }>
  | Readonly<{
      readonly kind: "live";
      readonly base: AppRowRevisionV1Base;
      readonly valueCodecVersion: unknown;
      readonly valueBytes: unknown;
      readonly valueSha256: unknown;
    }>;

const decodeRevisionRowEffect = Effect.fn(
  "AppRows.decodeRevisionRow",
)(function* (
  identity: AppRowIdentityV1,
  row: StoredAppRowRevisionColumns,
  commitSequenceText = false,
): Effect.fn.Return<AppRowRevisionV1, AppRowStorageCorruptionError> {
  const decoded = yield* Effect.fromResult(
    decodeRevisionRowEvidenceResult(identity, row, commitSequenceText),
  );
  if (decoded.kind === "tombstone") {
    return Object.freeze({
      kind: "tombstone",
      ...decoded.base,
    } satisfies TombstoneAppRowRevisionV1);
  }
  return yield* decodeLiveRevisionEvidenceEffect(identity, decoded);
});

// The accepting read operation owns tracing and the per-row interruption
// boundary. This linear mapping retains the canonical decoder's actual SHA.
const decodeLiveRevisionEvidenceEffect = (
  identity: AppRowIdentityV1,
  decoded: Extract<DecodedAppRowRevisionEvidenceV1, { kind: "live" }>,
): Effect.Effect<LiveAppRowRevisionV1, AppRowStorageCorruptionError> =>
  decodeStoredAppRowRevisionEvidenceEffect(decoded.base, {
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

function decodeRevisionRowEvidenceResult(
  identity: AppRowIdentityV1,
  row: StoredAppRowRevisionColumns,
  commitSequenceText = false,
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
      commitSequenceText ? yield* decodeStoredRevisionColumnResult(identity, decodeSnapshotSequenceTextResult(storedCommitSeq)) : storedCommitSeq,
    );
    const storedPrevCommitSeq = row.prevCommitSeq;
    const prevCommitSeq = storedPrevCommitSeq === null
      ? null
      : yield* decodeStoredPositiveCommitSeqResult(
          identity,
          commitSequenceText ? yield* decodeStoredRevisionColumnResult(identity, decodeSnapshotSequenceTextResult(storedPrevCommitSeq)) : storedPrevCommitSeq,
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
  const observed = readExactScopeWriteClockObservation(tx, decodedIdentity.identity.scopeId);
  if (observed !== undefined) return decodedIdentity.projection.scopeUuid;
  const finite = readFiniteExecutionAuthorityObservation(tx, identity.scopeId);
  if (finite !== undefined) {
    const live = yield* Effect.fromResult(requireFiniteExecutionAuthorityObservation(tx, finite).pipe(
      Result.mapError(() => new AppRowScopeAuthorityUnavailableError(identity.scopeId))));
    if (live.scopeId !== identity.scopeId || live.scopeUuid !== projection.scopeUuid)
      return yield* Effect.fail(new AppRowScopeAuthorityUnavailableError(identity.scopeId));
    return live.scopeUuid;
  }
  const protectedIdentity = readProtectedScopeReadIdentity(tx, identity.scopeId);
  if (protectedIdentity !== undefined) {
    const live = yield* Effect.fromResult(requireProtectedScopeReadIdentity(tx, protectedIdentity).pipe(
      Result.mapError(() => new AppRowScopeAuthorityUnavailableError(identity.scopeId))));
    if (live.scopeUuid !== projection.scopeUuid)
      return yield* Effect.fail(new AppRowScopeAuthorityUnavailableError(identity.scopeId));
    return live.scopeUuid;
  }
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
    .from(fxSystemScopeClocks).innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
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
