import { getTableColumns, sql, type SQL } from "drizzle-orm";
import { makePgArray } from "drizzle-orm/pg-core/utils/array";
import { encodeBytesToLowercaseHex, isUint8Array } from "@flarex/utils/bytes";
import { fxAppRowRevisions, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxAppSearchEntryCurrent, fxAppJsonEntryCurrent } from "../../database/schema";
import type { LogicalSearchDefinition } from "../documents/logicalDocuments/searchEntries";
import type { CommitSeq, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { Result, Schema } from "effect";
import type { PgTable } from "drizzle-orm/pg-core";
import type { PreparedAppUniqueMutationApplication } from "../unique/appUniqueKeys";
import type { PreparedLogicalSearchApplication } from "../documents/logicalDocuments/searchEntries";
import type { IndexCoverageWrite, UniqueCoverageWrite } from "./domainCoverage";
import { fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds } from "../../database/schema";

const decodeDomainDriverError = Schema.decodeUnknownResult(Schema.Struct({
  code: Schema.Literal("FX001"), message: Schema.String, detail: Schema.String,
}));
export function applicationDomainFailureDetail(cause: unknown, operation: string): string | null {
  return Result.match(decodeDomainDriverError(cause instanceof DrizzleQueryError ? cause.cause : cause), {
    onFailure: () => null, onSuccess: row => row.message === operation ? row.detail : null,
  });
}

type RowWrite = Required<typeof fxAppRowRevisions.$inferInsert>;
type IndexWrite = Required<typeof fxAppIndexEntryRevisions.$inferInsert>;
const rowColumns = getTableColumns(fxAppRowRevisions);
const indexColumns = getTableColumns(fxAppIndexEntryRevisions);
export function applicationIndexTransitionScalarArray(values: readonly (string | number | bigint | boolean | null)[],
  type: "text" | "integer" | "bigint" | "uuid" | "boolean" | "double precision", column: Parameters<typeof sql.param>[1]): SQL {
  const encoded = values.map(value => value === null ? null : String(column?.mapToDriverValue(value) ?? value));
  return sql`${sql.param(makePgArray(encoded))}::${sql.raw(type)}[]`;
}
export function applicationIndexTransitionByteArray(values: readonly (Uint8Array | null)[], column: Pick<typeof fxAppIndexEntryRevisions.encodedKey, "mapToDriverValue">): SQL {
  const encoded = values.map(value => {
    if (value === null) return null;
    const stored = column.mapToDriverValue(value);
    if (!isUint8Array(stored)) throw new Error("Index byte column no longer encodes bytea");
    return encodeBytesToLowercaseHex(stored);
  });
  return sql`array(select decode(v, 'hex') from unnest(${sql.param(makePgArray(encoded))}::text[]) with ordinality as bytes(v, ordinal) order by ordinal)`;
}
type UniqueWrite = typeof fxAppUniqueKeys.$inferSelect;
export type AppUniqueAbsentOwner = Pick<UniqueWrite, "scopeUuid" | "constraintId" | "localeKey" | "tableId" | "rowId"> &
  Readonly<{ ordinal: number }>;
const uniqueColumns = getTableColumns(fxAppUniqueKeys);

function uniqueOwnerArray(owners: readonly AppUniqueAbsentOwner[], schemaName: string): SQL {
  return sql`array[${sql.join(owners.map(owner => sql`row(
    ${sql.param(owner.scopeUuid, uniqueColumns.scopeUuid)}::uuid,
    ${sql.param(owner.constraintId, uniqueColumns.constraintId)}::integer,
    ${sql.param(owner.localeKey, uniqueColumns.localeKey)}::text,
    ${sql.param(owner.tableId, uniqueColumns.tableId)}::integer,
    ${sql.param(owner.rowId, uniqueColumns.rowId)}::bytea)::${sql.identifier(schemaName)}.fx_app_unique_owner`), sql`, `)}]::${sql.identifier(schemaName)}.fx_app_unique_owner[]`;
}

export function applicationUniqueOwnerAcceptanceParameters(owners: readonly AppUniqueAbsentOwner[], previous: readonly (Uint8Array | null)[],
  prior: readonly (bigint | null)[], schemaName: string): SQL {
  return sql`${uniqueOwnerArray(owners, schemaName)}, ${applicationIndexTransitionByteArray(previous, fxAppUniqueKeys.encodedKey)},
    ${applicationIndexTransitionScalarArray(prior, "bigint", fxAppIndexEntryRevisions.commitSeq)}`;
}

/** Internal compilation always receives one of this owner's fixed tables. */
function applicationTupleArray<T extends PgTable>(table: T, typeName: string, values: readonly (T["$inferInsert"] | null)[], schemaName: string): SQL {
  const columns = getTableColumns(table);
  const type = sql`${sql.identifier(schemaName)}.${sql.identifier(typeName)}`;
  // SAFETY: Drizzle's column-key map and inferred insert tuple belong to the same table parameter.
  return sql`array[${sql.join(values.map(value => value === null ? sql`null::${type}` : sql`row(${sql.join(Object.entries(columns).map(([key, column]) =>
    sql`${sql.param(value[key as keyof typeof value], column)}::${sql.raw(column.getSQLType())}`), sql`, `)})::${type}`), sql`, `)}]::${type}[]`;
}

export function buildAppUniqueMutationStatement(prepared: PreparedAppUniqueMutationApplication, schemaName: string): SQL {
  return sql`select reason, mutations from ${sql.identifier(schemaName)}.fx_apply_app_unique_mutations(
    ${uniqueOwnerArray(prepared.owners, schemaName)},
    ${applicationTupleArray(fxAppUniqueKeys, "fx_app_unique_write", prepared.previous, schemaName)},
    ${applicationTupleArray(fxAppUniqueKeys, "fx_app_unique_write", prepared.next, schemaName)})`;
}

export function applicationIndexCoverageArray(rows: readonly IndexCoverageWrite[], schemaName: string): SQL {
  const table = fxSystemIndexBuildStates;
  return sql`array[${sql.join(rows.map(row => sql`row(${sql.param(row.scopeId, table.scopeId)}::text,
    ${sql.param(row.indexDefinitionId, table.indexDefinitionId)}::integer, ${sql.param(row.attemptFence, table.attemptFence)}::bigint,
    ${sql.param(row.epoch, table.epoch)}::text, ${sql.param(row.storageGenerationFence, table.storageGenerationFence)}::bigint)
    ::${sql.identifier(schemaName)}.fx_app_index_coverage`), sql`, `)}]::${sql.identifier(schemaName)}.fx_app_index_coverage[]`;
}

export function applicationUniqueCoverageArray(rows: readonly UniqueCoverageWrite[], schemaName: string): SQL {
  const table = fxSystemUniqueConstraintBuilds;
  return sql`array[${sql.join(rows.map(row => sql`row(${sql.param(row.scopeId, table.scopeId)}::text,
    ${sql.param(row.uniqueConstraintDefinitionId, table.uniqueConstraintDefinitionId)}::integer, ${sql.param(row.attemptFence, table.attemptFence)}::bigint,
    ${sql.param(row.epoch, table.epoch)}::text, ${sql.param(row.storageGenerationFence, table.storageGenerationFence)}::bigint)
    ::${sql.identifier(schemaName)}.fx_app_unique_coverage`), sql`, `)}]::${sql.identifier(schemaName)}.fx_app_unique_coverage[]`;
}

export interface ApplicationMaterializationValues {
  readonly rows: readonly RowWrite[];
  readonly rowPages: readonly number[];
  readonly indexes: readonly Readonly<{ row: IndexWrite; prior: bigint | null; historical: boolean }>[];
  readonly unique: Pick<PreparedAppUniqueMutationApplication, "owners" | "previous" | "next">;
  readonly validation: readonly IndexCoverageWrite[];
  readonly indexCoverage: readonly IndexCoverageWrite[];
  readonly uniqueCoverage: readonly UniqueCoverageWrite[];
  readonly commitSeq: CommitSeq;
  readonly scopeUuid: ScopeUuidV1;
  readonly search: readonly PreparedLogicalSearchApplication[];
}

/** Prepared tuples are fixed domain values compiled from the authoritative
 * Drizzle columns. They cannot select a table, operation or SQL expression. */
export function buildAppRowBatchStatement(rows: readonly RowWrite[], schemaName: string, verification: readonly RowWrite[] = []): SQL {
  const rowType = sql`${sql.identifier(schemaName)}.fx_app_row_write`;
  // SAFETY: rowColumns is Drizzle's fxAppRowRevisions key map; RowWrite requires that same table's complete insert tuple.
  const values = (selected: readonly RowWrite[]) => selected.map(row => sql`row(${sql.join(Object.entries(rowColumns).map(([key, column]) =>
    sql`${sql.param(row[key as keyof RowWrite], column)}::${sql.raw(column.getSQLType())}`), sql`, `)})::${rowType}`);
  return sql`select reason, ordinal, actual_commit_seq::text as "actualCommitSeqText",
    actual_creation_time as "actualCreationTime" from ${sql.identifier(schemaName)}.fx_apply_app_row_batch(array[${sql.join(values(rows), sql`, `)}]::${rowType}[],
      array[${sql.join(values(verification), sql`, `)}]::${rowType}[])`;
}

export function buildAppIndexBatchStatement(entries: readonly Readonly<{ row: IndexWrite;
  prior: bigint | null; historical: boolean }>[], schemaName: string, verification: readonly IndexWrite[] = []): SQL {
  const indexType = sql`${sql.identifier(schemaName)}.fx_app_index_write`;
  // SAFETY: indexColumns is Drizzle's fxAppIndexEntryRevisions key map; IndexWrite requires that same table's complete insert tuple.
  const values = (selected: readonly IndexWrite[]) => selected.map(row => sql`row(${sql.join(Object.entries(indexColumns).map(([key, column]) =>
    sql`${sql.param(row[key as keyof IndexWrite], column)}::${sql.raw(column.getSQLType())}`), sql`, `)})::${indexType}`);
  return sql`select reason, ordinal, actual_commit_seq::text as "actualCommitSeqText" from ${sql.identifier(schemaName)}.fx_apply_app_index_batch(
    array[${sql.join(values(entries.map(entry => entry.row)), sql`, `)}]::${indexType}[],
    array[${sql.join(entries.map(entry => sql`${entry.prior}::bigint`), sql`, `)}]::bigint[],
    array[${sql.join(entries.map(entry => sql`${entry.historical}::boolean`), sql`, `)}]::boolean[],
    array[${sql.join(values(verification), sql`, `)}]::${indexType}[])`;
}

export function buildAppUniqueBatchStatement(releases: readonly UniqueWrite[], claims: readonly UniqueWrite[], schemaName: string,
  verificationReleases: readonly UniqueWrite[] = [], verificationClaims: readonly UniqueWrite[] = [],
  absentOwners: readonly AppUniqueAbsentOwner[] = []): SQL {
  const uniqueType = sql`${sql.identifier(schemaName)}.fx_app_unique_write`;
  // SAFETY: uniqueColumns is Drizzle's fxAppUniqueKeys key map; UniqueWrite is that same table's complete stored projection.
  const rows = (values: readonly UniqueWrite[]) => sql`array[${sql.join(values.map(row =>
    sql`row(${sql.join(Object.entries(uniqueColumns).map(([key, column]) =>
      sql`${sql.param(row[key as keyof UniqueWrite], column)}::${sql.raw(column.getSQLType())}`), sql`, `)})::${uniqueType}`), sql`, `)}]::${uniqueType}[]`;
  return sql`select reason, ordinal, actual_table_id as "actualTableId", actual_row_id as "actualRowId",
    actual_key as "actualKey", actual_codec as "actualCodec" from ${sql.identifier(schemaName)}.fx_apply_app_unique_batch(
      ${rows(releases)}, ${rows(claims)}, ${rows(verificationReleases)}, ${rows(verificationClaims)},
      array[${sql.join(absentOwners.map(owner => sql`row(
        ${sql.param(owner.scopeUuid, uniqueColumns.scopeUuid)}::uuid,
        ${sql.param(owner.constraintId, uniqueColumns.constraintId)}::integer,
        ${sql.param(owner.localeKey, uniqueColumns.localeKey)}::text,
        ${sql.param(owner.tableId, uniqueColumns.tableId)}::integer,
        ${sql.param(owner.rowId, uniqueColumns.rowId)}::bytea)::${sql.identifier(schemaName)}.fx_app_unique_owner`), sql`, `)}]::${sql.identifier(schemaName)}.fx_app_unique_owner[],
      array[${sql.join(absentOwners.map(owner => sql`${owner.ordinal}::integer`), sql`, `)}]::integer[])`;
}

export function buildAppSearchBatchStatement(scopeUuid: ScopeUuidV1, commitSeq: CommitSeq,
  definition: LogicalSearchDefinition, ids: readonly Uint8Array[],
  entries: readonly (typeof fxAppSearchEntryCurrent.$inferInsert)[],
  jsonEntries: readonly (typeof fxAppJsonEntryCurrent.$inferInsert)[], complete: boolean, schemaName: string,
  verification: Readonly<{ ids: readonly Uint8Array[];
    entries: readonly (typeof fxAppSearchEntryCurrent.$inferInsert)[];
    jsonEntries: readonly (typeof fxAppJsonEntryCurrent.$inferInsert)[] }> = { ids: [], entries: [], jsonEntries: [] }): SQL {
  const textColumns = getTableColumns(fxAppSearchEntryCurrent);
  const jsonColumns = getTableColumns(fxAppJsonEntryCurrent);
  // SAFETY: textColumns and these prepared insert rows come from the same fxAppSearchEntryCurrent owner; its column keys index that insert tuple.
  const textRows = (selected: readonly (typeof fxAppSearchEntryCurrent.$inferInsert)[]) => selected.map(row => sql`row(${sql.join(Object.entries(textColumns).map(([key, column]) =>
    sql`${sql.param(row[key as keyof typeof row], column)}::${sql.raw(column.getSQLType())}`), sql`, `)})::${sql.identifier(schemaName)}.fx_app_search_write`);
  // SAFETY: jsonColumns and these prepared insert rows come from the same fxAppJsonEntryCurrent owner; its column keys index that insert tuple.
  const jsonRows = (selected: readonly (typeof fxAppJsonEntryCurrent.$inferInsert)[]) => selected.map(row => sql`row(${sql.join(Object.entries(jsonColumns).map(([key, column]) =>
    sql`${sql.param(row[key as keyof typeof row], column)}::${sql.raw(column.getSQLType())}`), sql`, `)})::${sql.identifier(schemaName)}.fx_app_json_write`);
  return sql`select reason, entries, build_advanced as "buildAdvanced" from ${sql.identifier(schemaName)}.fx_apply_app_search_batch(
    ${sql.param(scopeUuid, textColumns.scopeUuid)}::uuid, ${sql.param(definition.tableId, textColumns.tableId)}::integer,
    ${sql.param(definition.logicalIndexId, textColumns.logicalIndexId)}::integer, ${sql.param(definition.sourceSha256, textColumns.sourceSha256)}::text,
    ${sql.param(commitSeq, textColumns.commitSeq)}::bigint, array[${sql.join(ids.map(id => sql`${sql.param(id, textColumns.rowId)}::bytea`), sql`, `)}]::bytea[],
    array[${sql.join(textRows(entries), sql`, `)}]::${sql.identifier(schemaName)}.fx_app_search_write[], array[${sql.join(jsonRows(jsonEntries), sql`, `)}]::${sql.identifier(schemaName)}.fx_app_json_write[],
    ${definition.kind === "jsonContainment"}::boolean, ${complete}::boolean,
    array[${sql.join(verification.ids.map(id => sql`${sql.param(id, textColumns.rowId)}::bytea`), sql`, `)}]::bytea[],
    array[${sql.join(textRows(verification.entries), sql`, `)}]::${sql.identifier(schemaName)}.fx_app_search_write[],
    array[${sql.join(jsonRows(verification.jsonEntries), sql`, `)}]::${sql.identifier(schemaName)}.fx_app_json_write[])`;
}
