import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
  type QuerySyncStateOperation,
} from "@flarex/query-sync/internal/state";
import { Data, Result, Schema } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import type { DeploymentQuerySyncContractState } from "./RowCodec";
import {
  authenticateDeploymentQuerySyncGeneration1Scope,
  deploymentQuerySyncGeneration1Catalog,
  readDeploymentQuerySyncGeneration1Scope,
} from "./StorageContractGeneration1";
import {
  deploymentQuerySyncGeneration2Catalog,
  readDeploymentQuerySyncGeneration2MigrationState,
} from "./StorageContractGeneration2";
import {
  deploymentQuerySyncGeneration3Catalog,
  migrateDeploymentQuerySyncGeneration1ToGeneration3,
  migrateDeploymentQuerySyncGeneration2ToGeneration3,
  readDeploymentQuerySyncGeneration3Contract,
  readReadyDeploymentQuerySyncGeneration3,
} from "./StorageContractGeneration3";
import {
  createFreshDeploymentQuerySyncGeneration4,
  deploymentQuerySyncGeneration4Catalog,
  migrateDeploymentQuerySyncGeneration3ToGeneration4,
  readDeploymentQuerySyncGeneration4Contract,
  readReadyDeploymentQuerySyncGeneration4,
} from "./StorageContractGeneration4";

export type { DeploymentQuerySyncContractState } from "./RowCodec";

export type DeploymentQuerySyncStateOperation = QuerySyncStateOperation;

export type DeploymentQuerySyncSqlStorage = Pick<SqlStorage, "exec">;

export interface DeploymentQuerySyncStorage {
  readonly sql: DeploymentQuerySyncSqlStorage;
  readonly transactionSync: <A>(closure: () => A) => A;
}

export interface DeploymentQuerySyncStorageColumnExpectation {
  readonly name: string;
  readonly type: "INTEGER" | "TEXT";
  readonly notnull: 0 | 1;
  readonly pk: 0 | 1 | 2 | 3 | 4;
}

export interface DeploymentQuerySyncStorageTableDefinition {
  readonly name: string;
  readonly ddl: string;
  readonly withoutRowId: 0 | 1;
  readonly strict: 0 | 1;
  readonly columns: readonly DeploymentQuerySyncStorageColumnExpectation[];
}

export interface DeploymentQuerySyncStorageIndexDefinition {
  readonly name: string;
  readonly tableName: string;
  readonly ddl: string;
  readonly columns: readonly Readonly<{
    readonly cid: number;
    readonly name: string;
    readonly key: 0 | 1;
  }>[];
}

export interface DeploymentQuerySyncStorageCatalogDefinition {
  readonly generation: 1 | 2 | 3 | 4;
  readonly tables: readonly DeploymentQuerySyncStorageTableDefinition[];
  readonly indexes: readonly DeploymentQuerySyncStorageIndexDefinition[];
}

export type DeploymentQuerySyncStorageContractError<
  Operation extends DeploymentQuerySyncStateOperation =
    DeploymentQuerySyncStateOperation,
> =
  | QuerySyncStoredStateCorruptError<Operation>
  | QuerySyncStoredStateIncompatibleError<Operation>;

const STORAGE_READINESS_OPERATION = "initializeOrInspectNamespace" as const;
const PROVIDER_TABLE_NAMES = new Set(["_cf_KV", "__cf_kv"]);
const STORAGE_CATALOGS = Object.freeze([
  deploymentQuerySyncGeneration1Catalog,
  deploymentQuerySyncGeneration2Catalog,
  deploymentQuerySyncGeneration3Catalog,
  deploymentQuerySyncGeneration4Catalog,
]);
const APPLICATION_TABLE_NAMES = new Set<string>(
  STORAGE_CATALOGS.flatMap(catalog =>
    catalog.tables.map(table => table.name)
  ),
);
const APPLICATION_SCHEMA_OBJECT_NAMES = new Set<string>([
  ...APPLICATION_TABLE_NAMES,
  ...STORAGE_CATALOGS.flatMap(catalog =>
    catalog.indexes.map(index => index.name)
  ),
]);

type StorageContractIssueReason =
  | "catalogRowInvalid"
  | "catalogObjectUnexpected"
  | "catalogShapeUnsupported"
  | "sqlDefinitionInvalid"
  | "tableMetadataMismatch"
  | "columnMetadataMismatch"
  | "indexMetadataMismatch";

class DeploymentQuerySyncStorageContractIssue extends Data.TaggedError(
  "DeploymentQuerySyncStorageContractIssue",
)<{
  readonly reason: StorageContractIssueReason;
  readonly objectName: string | null;
  readonly expected: unknown;
  readonly observed: unknown;
  readonly cause: unknown | null;
}> {}

class DeploymentQuerySyncSqlTokenizationIssue extends Data.TaggedError(
  "DeploymentQuerySyncSqlTokenizationIssue",
)<{
  readonly reason:
    | "commentNotAllowed"
    | "quotedIdentifierNotAllowed"
    | "unterminatedStringLiteral";
  readonly offset: number;
}> {}

function contractIssue(
  reason: StorageContractIssueReason,
  input: Readonly<{
    readonly objectName?: string;
    readonly expected?: unknown;
    readonly observed?: unknown;
    readonly cause?: unknown;
  }> = {},
): DeploymentQuerySyncStorageContractIssue {
  return new DeploymentQuerySyncStorageContractIssue({
    reason,
    objectName: input.objectName ?? null,
    expected: input.expected ?? null,
    observed: input.observed ?? null,
    cause: input.cause ?? null,
  });
}

function incompatible(
  cause: unknown,
): QuerySyncStoredStateIncompatibleError<
  typeof STORAGE_READINESS_OPERATION
> {
  return new QuerySyncStoredStateIncompatibleError({
    operation: STORAGE_READINESS_OPERATION,
    commitCertainty: "notCommitted",
    reason: "unsupportedStoredContract",
    cause,
  });
}

function isAsciiWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n"
    || character === "\r" || character === "\f" || character === "\v";
}

function isIdentifierStart(character: string): boolean {
  const code = character.charCodeAt(0);
  return character === "_" || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122);
}

function isIdentifierContinue(character: string): boolean {
  const code = character.charCodeAt(0);
  return isIdentifierStart(character) || (code >= 48 && code <= 57);
}

function isAsciiDigit(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function trailingCharactersAreWhitespace(sql: string, offset: number): boolean {
  for (let index = offset; index < sql.length; index += 1) {
    if (!isAsciiWhitespace(sql[index] ?? "")) return false;
  }
  return true;
}

export function tokenizeDeploymentQuerySyncSqlDefinitionForTest(
  sql: string,
): Result.Result<readonly string[], DeploymentQuerySyncSqlTokenizationIssue> {
  const tokens: string[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const character = sql[offset] ?? "";
    if (isAsciiWhitespace(character)) {
      offset += 1;
      continue;
    }
    const next = sql[offset + 1] ?? "";
    if ((character === "-" && next === "-")
      || (character === "/" && next === "*")) {
      return Result.fail(new DeploymentQuerySyncSqlTokenizationIssue({
        reason: "commentNotAllowed",
        offset,
      }));
    }
    if (character === "\"" || character === "`" || character === "[") {
      return Result.fail(new DeploymentQuerySyncSqlTokenizationIssue({
        reason: "quotedIdentifierNotAllowed",
        offset,
      }));
    }
    if (character === "'") {
      const start = offset;
      offset += 1;
      let closed = false;
      while (offset < sql.length) {
        if (sql[offset] !== "'") {
          offset += 1;
          continue;
        }
        if (sql[offset + 1] === "'") {
          offset += 2;
          continue;
        }
        offset += 1;
        closed = true;
        break;
      }
      if (!closed) {
        return Result.fail(new DeploymentQuerySyncSqlTokenizationIssue({
          reason: "unterminatedStringLiteral",
          offset: start,
        }));
      }
      tokens.push(sql.slice(start, offset));
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = offset;
      offset += 1;
      while (offset < sql.length
        && isIdentifierContinue(sql[offset] ?? "")) offset += 1;
      tokens.push(sql.slice(start, offset));
      continue;
    }
    if (isAsciiDigit(character)) {
      const start = offset;
      offset += 1;
      while (offset < sql.length && isAsciiDigit(sql[offset] ?? "")) {
        offset += 1;
      }
      tokens.push(sql.slice(start, offset));
      continue;
    }
    if (character === ";"
      && trailingCharactersAreWhitespace(sql, offset + 1)) {
      offset = sql.length;
      continue;
    }
    tokens.push(character);
    offset += 1;
  }
  return Result.succeed(Object.freeze(tokens));
}

function expectedSqlTokens(sql: string): readonly string[] {
  return Result.match(tokenizeDeploymentQuerySyncSqlDefinitionForTest(sql), {
    onFailure: cause => {
      throw cause;
    },
    onSuccess: tokens => tokens,
  });
}

function tokenSequencesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((token, index) => token === right[index]);
}

const TableListRowSchema = Schema.Struct({
  schema: Schema.String,
  name: Schema.String,
  type: Schema.String,
  ncol: Schema.Int,
  wr: Schema.Int,
  strict: Schema.Int,
});
const SchemaObjectRowSchema = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  tbl_name: Schema.String,
  sql: Schema.NullOr(Schema.String),
});
const TableInfoRowSchema = Schema.Struct({
  cid: Schema.Int,
  name: Schema.String,
  type: Schema.String,
  notnull: Schema.Int,
  dflt_value: Schema.NullOr(Schema.String),
  pk: Schema.Int,
});
const IndexListRowSchema = Schema.Struct({
  seq: Schema.Int,
  name: Schema.String,
  unique: Schema.Int,
  origin: Schema.String,
  partial: Schema.Int,
});
const IndexXInfoRowSchema = Schema.Struct({
  seqno: Schema.Int,
  cid: Schema.Int,
  name: Schema.NullOr(Schema.String),
  desc: Schema.Int,
  coll: Schema.NullOr(Schema.String),
  key: Schema.Int,
});
const decodeTableListRow = Schema.decodeUnknownResult(TableListRowSchema, {
  onExcessProperty: "error",
});
const decodeSchemaObjectRow = Schema.decodeUnknownResult(SchemaObjectRowSchema, {
  onExcessProperty: "error",
});
const decodeTableInfoRow = Schema.decodeUnknownResult(TableInfoRowSchema, {
  onExcessProperty: "error",
});
const decodeIndexListRow = Schema.decodeUnknownResult(IndexListRowSchema, {
  onExcessProperty: "error",
});
const decodeIndexXInfoRow = Schema.decodeUnknownResult(IndexXInfoRowSchema, {
  onExcessProperty: "error",
});
type TableListRow = typeof TableListRowSchema.Type;
type SchemaObjectRow = typeof SchemaObjectRowSchema.Type;
type TableInfoRow = typeof TableInfoRowSchema.Type;
type IndexListRow = typeof IndexListRowSchema.Type;
type IndexXInfoRow = typeof IndexXInfoRowSchema.Type;

type EncodedTableListRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly schema: string;
  readonly name: string;
  readonly type: string;
  readonly ncol: number;
  readonly wr: number;
  readonly strict: number;
}>;
type EncodedSchemaObjectRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
}>;
type EncodedTableInfoRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
}>;
type EncodedIndexListRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly seq: number;
  readonly name: string;
  readonly unique: number;
  readonly origin: string;
  readonly partial: number;
}>;
type EncodedIndexXInfoRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly seqno: number;
  readonly cid: number;
  readonly name: string | null;
  readonly desc: number;
  readonly coll: string | null;
  readonly key: number;
}>;

function decodeRows<A>(
  rows: readonly unknown[],
  decode: (input: unknown) => Result.Result<A, unknown>,
  objectName: string | null,
): Result.Result<readonly A[], DeploymentQuerySyncStorageContractIssue> {
  return Result.gen(function* () {
    const decoded: A[] = [];
    for (const row of rows) {
      decoded.push(yield* decode(row).pipe(Result.mapError(cause =>
        contractIssue("catalogRowInvalid",
          objectName === null ? { cause } : { objectName, cause })
      )));
    }
    return Object.freeze(decoded);
  });
}

interface CatalogSnapshot {
  readonly applicationTableListRows: readonly TableListRow[];
  readonly applicationSchemaRows: readonly SchemaObjectRow[];
}

function readCatalogSnapshot(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<CatalogSnapshot, DeploymentQuerySyncStorageContractIssue> {
  return Result.gen(function* () {
    const tableListRows = yield* decodeRows(
      sql.exec<EncodedTableListRow>("PRAGMA table_list").toArray(),
      decodeTableListRow,
      null,
    );
    const mainSchemaRows = yield* decodeRows(
      sql.exec<EncodedSchemaObjectRow>(`SELECT type, name, tbl_name, sql
        FROM main.sqlite_schema
        ORDER BY type, name, tbl_name`).toArray(),
      decodeSchemaObjectRow,
      null,
    );
    const temporarySchemaRows = yield* decodeRows(
      sql.exec<EncodedSchemaObjectRow>(`SELECT type, name, tbl_name, sql
        FROM temp.sqlite_schema
        ORDER BY type, name, tbl_name`).toArray(),
      decodeSchemaObjectRow,
      null,
    );
    for (const row of temporarySchemaRows) {
      if (!row.name.startsWith("sqlite_")) {
        return yield* Result.fail(contractIssue("catalogObjectUnexpected", {
          objectName: `temp.${row.name}`,
          observed: row,
        }));
      }
    }
    const applicationTableListRows: TableListRow[] = [];
    for (const row of tableListRows) {
      if (row.schema === "temp") {
        if (!row.name.startsWith("sqlite_")) {
          return yield* Result.fail(contractIssue("catalogObjectUnexpected", {
            objectName: `temp.${row.name}`,
            observed: row,
          }));
        }
        continue;
      }
      if (row.schema !== "main") {
        return yield* Result.fail(contractIssue("catalogObjectUnexpected", {
          objectName: `${row.schema}.${row.name}`,
          observed: row,
        }));
      }
      if (row.name.startsWith("sqlite_")) continue;
      if (PROVIDER_TABLE_NAMES.has(row.name)) {
        if (row.type !== "table") {
          return yield* Result.fail(contractIssue("catalogObjectUnexpected", {
            objectName: row.name,
            observed: row,
          }));
        }
        continue;
      }
      if (!APPLICATION_TABLE_NAMES.has(row.name)) {
        return yield* Result.fail(contractIssue("catalogObjectUnexpected", {
          objectName: row.name,
          observed: row,
        }));
      }
      applicationTableListRows.push(row);
    }
    const applicationSchemaRows: SchemaObjectRow[] = [];
    for (const row of mainSchemaRows) {
      if (PROVIDER_TABLE_NAMES.has(row.name)) {
        if (row.type !== "table" || row.tbl_name !== row.name) {
          return yield* Result.fail(contractIssue("catalogObjectUnexpected", {
            objectName: row.name,
            observed: row,
          }));
        }
        continue;
      }
      if (PROVIDER_TABLE_NAMES.has(row.tbl_name)) {
        if (!row.name.startsWith("sqlite_")) {
          return yield* Result.fail(contractIssue("catalogObjectUnexpected", {
            objectName: row.name,
            observed: row,
          }));
        }
        continue;
      }
      if (row.name.startsWith("sqlite_")) {
        if (APPLICATION_TABLE_NAMES.has(row.tbl_name)) {
          return yield* Result.fail(contractIssue("catalogObjectUnexpected", {
            objectName: row.name,
            observed: row,
          }));
        }
        continue;
      }
      if (!APPLICATION_SCHEMA_OBJECT_NAMES.has(row.name)) {
        return yield* Result.fail(contractIssue("catalogObjectUnexpected", {
          objectName: row.name,
          observed: row,
        }));
      }
      applicationSchemaRows.push(row);
    }
    return Object.freeze({
      applicationTableListRows: Object.freeze(applicationTableListRows),
      applicationSchemaRows: Object.freeze(applicationSchemaRows),
    });
  });
}

function tableInfoMatches(
  rows: readonly TableInfoRow[],
  columns: readonly DeploymentQuerySyncStorageColumnExpectation[],
): boolean {
  return rows.length === columns.length && rows.every((row, index) => {
    const expected = columns[index];
    return expected !== undefined && row.cid === index
      && row.name === expected.name && row.type === expected.type
      && row.notnull === expected.notnull && row.dflt_value === null
      && row.pk === expected.pk;
  });
}

function indexXInfoMatches(
  rows: readonly IndexXInfoRow[],
  expected: DeploymentQuerySyncStorageIndexDefinition["columns"],
): boolean {
  return rows.length === expected.length && rows.every((row, index) => {
    const expectedRow = expected[index];
    return expectedRow !== undefined && row.seqno === index
      && row.cid === expectedRow.cid && row.name === expectedRow.name
      && row.desc === 0 && row.coll === "BINARY"
      && row.key === expectedRow.key;
  });
}

function primaryKeyIndexXInfoExpectation(
  columns: readonly DeploymentQuerySyncStorageColumnExpectation[],
): DeploymentQuerySyncStorageIndexDefinition["columns"] {
  const primary = columns.map((column, cid) => ({ column, cid }))
    .filter(entry => entry.column.pk > 0)
    .toSorted((left, right) => left.column.pk - right.column.pk)
    .map(entry => Object.freeze({
      cid: entry.cid,
      name: entry.column.name,
      key: 1 as const,
    }));
  const auxiliary = columns.map((column, cid) => ({ column, cid }))
    .filter(entry => entry.column.pk === 0)
    .map(entry => Object.freeze({
      cid: entry.cid,
      name: entry.column.name,
      key: 0 as const,
    }));
  return Object.freeze([...primary, ...auxiliary]);
}

function authenticateSqlDefinition(
  object: SchemaObjectRow,
  ddl: string,
): Result.Result<void, DeploymentQuerySyncStorageContractIssue> {
  const expected = expectedSqlTokens(ddl);
  if (object.sql === null) {
    return Result.fail(contractIssue("sqlDefinitionInvalid", {
      objectName: object.name,
      expected,
      observed: null,
    }));
  }
  return tokenizeDeploymentQuerySyncSqlDefinitionForTest(object.sql).pipe(
    Result.mapError(cause => contractIssue("sqlDefinitionInvalid", {
      objectName: object.name,
      cause,
    })),
    Result.flatMap(observed => tokenSequencesEqual(observed, expected)
      ? Result.succeed(undefined)
      : Result.fail(contractIssue("sqlDefinitionInvalid", {
        objectName: object.name,
        expected,
        observed,
      }))),
  );
}

function readTableInfo(
  sql: DeploymentQuerySyncSqlStorage,
  tableName: string,
): Result.Result<readonly TableInfoRow[], DeploymentQuerySyncStorageContractIssue> {
  return decodeRows(sql.exec<EncodedTableInfoRow>(
    `PRAGMA main.table_info('${tableName}')`,
  ).toArray(), decodeTableInfoRow, tableName);
}

function readIndexList(
  sql: DeploymentQuerySyncSqlStorage,
  tableName: string,
): Result.Result<readonly IndexListRow[], DeploymentQuerySyncStorageContractIssue> {
  return decodeRows(sql.exec<EncodedIndexListRow>(
    `PRAGMA main.index_list('${tableName}')`,
  ).toArray(), decodeIndexListRow, tableName);
}

function readIndexXInfo(
  sql: DeploymentQuerySyncSqlStorage,
  indexName: string,
): Result.Result<readonly IndexXInfoRow[], DeploymentQuerySyncStorageContractIssue> {
  return decodeRows(sql.exec<EncodedIndexXInfoRow>(
    `PRAGMA main.index_xinfo('${indexName}')`,
  ).toArray(), decodeIndexXInfoRow, indexName);
}

function inspectCatalog(
  sql: DeploymentQuerySyncSqlStorage,
  snapshot: CatalogSnapshot,
  catalog: DeploymentQuerySyncStorageCatalogDefinition,
): Result.Result<void, DeploymentQuerySyncStorageContractIssue> {
  return Result.gen(function* () {
    if (snapshot.applicationTableListRows.length !== catalog.tables.length
      || snapshot.applicationSchemaRows.length
        !== catalog.tables.length + catalog.indexes.length) {
      return yield* Result.fail(contractIssue("catalogShapeUnsupported", {
        expected: `exactGeneration${catalog.generation}`,
        observed: snapshot,
      }));
    }
    for (const table of catalog.tables) {
      const tableListRow = snapshot.applicationTableListRows.find(
        row => row.name === table.name,
      );
      if (tableListRow === undefined || tableListRow.schema !== "main"
        || tableListRow.type !== "table"
        || tableListRow.ncol !== table.columns.length
        || tableListRow.wr !== table.withoutRowId
        || tableListRow.strict !== table.strict) {
        return yield* Result.fail(contractIssue("tableMetadataMismatch", {
          objectName: table.name,
          expected: Object.freeze({
            ncol: table.columns.length,
            schema: "main",
            strict: table.strict,
            type: "table",
            wr: table.withoutRowId,
          }),
          observed: tableListRow,
        }));
      }
      const schemaRow = snapshot.applicationSchemaRows.find(
        row => row.name === table.name,
      );
      if (schemaRow === undefined || schemaRow.type !== "table"
        || schemaRow.tbl_name !== table.name) {
        return yield* Result.fail(contractIssue("catalogShapeUnsupported", {
          objectName: table.name,
          expected: "tableDefinition",
          observed: schemaRow,
        }));
      }
      yield* authenticateSqlDefinition(schemaRow, table.ddl);
      const tableInfo = yield* readTableInfo(sql, table.name);
      if (!tableInfoMatches(tableInfo, table.columns)) {
        return yield* Result.fail(contractIssue("columnMetadataMismatch", {
          objectName: table.name,
          expected: table.columns,
          observed: tableInfo,
        }));
      }
      const indexes = yield* readIndexList(sql, table.name);
      if (table.withoutRowId === 0) {
        if (indexes.length !== 0) {
          return yield* Result.fail(contractIssue("indexMetadataMismatch", {
            objectName: table.name,
            expected: [],
            observed: indexes,
          }));
        }
        continue;
      }
      const explicitIndexes = catalog.indexes.filter(
        index => index.tableName === table.name,
      );
      const automaticIndexName = `sqlite_autoindex_${table.name}_1`;
      const automatic = indexes.find(index => index.name === automaticIndexName);
      if (indexes.length !== 1 + explicitIndexes.length
        || automatic === undefined || automatic.seq !== explicitIndexes.length
        || automatic.unique !== 1 || automatic.origin !== "pk"
        || automatic.partial !== 0) {
        return yield* Result.fail(contractIssue("indexMetadataMismatch", {
          objectName: table.name,
          expected: Object.freeze({
            automaticIndexName,
            count: 1 + explicitIndexes.length,
            origin: "pk",
            unique: 1,
          }),
          observed: indexes,
        }));
      }
      const automaticXInfo = yield* readIndexXInfo(sql, automaticIndexName);
      const expectedAutomaticXInfo = primaryKeyIndexXInfoExpectation(table.columns);
      if (!indexXInfoMatches(automaticXInfo, expectedAutomaticXInfo)) {
        return yield* Result.fail(contractIssue("indexMetadataMismatch", {
          objectName: automaticIndexName,
          expected: expectedAutomaticXInfo,
          observed: automaticXInfo,
        }));
      }
      for (const [explicitOffset, explicit] of explicitIndexes.entries()) {
        const indexRow = indexes.find(index => index.name === explicit.name);
        if (indexRow === undefined || indexRow.seq !== explicitOffset
          || indexRow.unique !== 0 || indexRow.origin !== "c"
          || indexRow.partial !== 0) {
          return yield* Result.fail(contractIssue("indexMetadataMismatch", {
            objectName: explicit.name,
            expected: Object.freeze({
              origin: "c",
              partial: 0,
              seq: explicitOffset,
              unique: 0,
            }),
            observed: indexRow,
          }));
        }
        const explicitXInfo = yield* readIndexXInfo(sql, explicit.name);
        if (!indexXInfoMatches(explicitXInfo, explicit.columns)) {
          return yield* Result.fail(contractIssue("indexMetadataMismatch", {
            objectName: explicit.name,
            expected: explicit.columns,
            observed: explicitXInfo,
          }));
        }
      }
    }
    for (const index of catalog.indexes) {
      const schemaRow = snapshot.applicationSchemaRows.find(
        row => row.name === index.name,
      );
      if (schemaRow === undefined || schemaRow.type !== "index"
        || schemaRow.tbl_name !== index.tableName) {
        return yield* Result.fail(contractIssue("catalogShapeUnsupported", {
          objectName: index.name,
          expected: "explicitIndexDefinition",
          observed: schemaRow,
        }));
      }
      yield* authenticateSqlDefinition(schemaRow, index.ddl);
    }
  });
}

type CatalogClassification = Readonly<
  | { readonly _tag: "fresh" }
  | { readonly _tag: "generation1" }
  | { readonly _tag: "generation2" }
  | { readonly _tag: "generation3" }
  | { readonly _tag: "generation4" }
>;

function catalogTableNamesEqual(
  rows: readonly TableListRow[],
  catalog: DeploymentQuerySyncStorageCatalogDefinition,
): boolean {
  return rows.length === catalog.tables.length
    && catalog.tables.every(table => rows.some(row => row.name === table.name));
}

function classifyCatalog(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<CatalogClassification, DeploymentQuerySyncStorageContractIssue> {
  return Result.gen(function* () {
    const snapshot = yield* readCatalogSnapshot(sql);
    if (snapshot.applicationTableListRows.length === 0
      && snapshot.applicationSchemaRows.length === 0) {
      return Object.freeze({ _tag: "fresh" as const });
    }
    for (const catalog of STORAGE_CATALOGS) {
      if (!catalogTableNamesEqual(snapshot.applicationTableListRows, catalog)) {
        continue;
      }
      yield* inspectCatalog(sql, snapshot, catalog);
      switch (catalog.generation) {
        case 1:
          return Object.freeze({ _tag: "generation1" as const });
        case 2:
          return Object.freeze({ _tag: "generation2" as const });
        case 3:
          return Object.freeze({ _tag: "generation3" as const });
        case 4:
          return Object.freeze({ _tag: "generation4" as const });
      }
    }
    return yield* Result.fail(contractIssue("catalogShapeUnsupported", {
      expected:
        "freshOrExactGeneration1OrExactGeneration2OrExactGeneration3OrExactGeneration4",
      observed: snapshot,
    }));
  });
}

function authenticateGeneration3Catalog(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<void, DeploymentQuerySyncStorageContractIssue> {
  return readCatalogSnapshot(sql).pipe(Result.flatMap(snapshot =>
    inspectCatalog(sql, snapshot, deploymentQuerySyncGeneration3Catalog)
  ));
}

function authenticateGeneration4Catalog(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<void, DeploymentQuerySyncStorageContractIssue> {
  return readCatalogSnapshot(sql).pipe(Result.flatMap(snapshot =>
    inspectCatalog(sql, snapshot, deploymentQuerySyncGeneration4Catalog)
  ));
}

class DeploymentQuerySyncStorageRollback {
  constructor(readonly failure: DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >) {}
}

const issuedRollbacks = new WeakSet<DeploymentQuerySyncStorageRollback>();

function rollback(
  failure: DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >,
): DeploymentQuerySyncStorageRollback {
  const sentinel = new DeploymentQuerySyncStorageRollback(failure);
  issuedRollbacks.add(sentinel);
  return sentinel;
}

function isIssuedRollback(cause: unknown): cause is DeploymentQuerySyncStorageRollback {
  return cause instanceof DeploymentQuerySyncStorageRollback
    && issuedRollbacks.has(cause);
}

function runStorageTransactionResult<A>(
  storage: DeploymentQuerySyncStorage,
  body: () => Result.Result<A, DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >>,
): Result.Result<A, DeploymentQuerySyncStorageContractError<
  typeof STORAGE_READINESS_OPERATION
  >> {
  try {
    const success = storage.transactionSync(() => Result.match(body(), {
      onFailure: failure => {
        throw rollback(failure);
      },
      onSuccess: value => value,
    }));
    return Result.succeed(success);
  } catch (cause) {
    if (!isIssuedRollback(cause)) throw cause;
    issuedRollbacks.delete(cause);
    return Result.fail(cause.failure);
  }
}

export function readDeploymentQuerySyncContractState<
  Operation extends DeploymentQuerySyncStateOperation,
>(
  sql: DeploymentQuerySyncSqlStorage,
  operation: Operation,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncStorageContractError<Operation>
> {
  return readDeploymentQuerySyncGeneration4Contract(sql, operation);
}

export function ensureDeploymentQuerySyncStorageReady(
  storage: DeploymentQuerySyncStorage,
  binding: DeploymentQuerySyncBinding,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncStorageContractError<typeof STORAGE_READINESS_OPERATION>
> {
  const sql = storage.sql;
  return runStorageTransactionResult(storage, () => Result.gen(function* () {
    const catalog = yield* classifyCatalog(sql).pipe(Result.mapError(incompatible));
    switch (catalog._tag) {
      case "fresh":
        createFreshDeploymentQuerySyncGeneration4(sql);
        break;
      case "generation1": {
        const legacy = yield* readDeploymentQuerySyncGeneration1Scope(sql);
        const emptyScope = legacy === null ? null
          : yield* authenticateDeploymentQuerySyncGeneration1Scope(
            legacy,
            binding,
          );
        migrateDeploymentQuerySyncGeneration1ToGeneration3(
          sql,
          legacy,
          binding,
          emptyScope,
        );
        yield* authenticateGeneration3Catalog(sql).pipe(
          Result.mapError(incompatible),
        );
        const predecessor = yield* readReadyDeploymentQuerySyncGeneration3(
          sql,
          binding,
        );
        migrateDeploymentQuerySyncGeneration3ToGeneration4(
          sql,
          predecessor.durableInitializedHistory,
        );
        break;
      }
      case "generation2": {
        yield* readDeploymentQuerySyncGeneration2MigrationState(sql, binding);
        migrateDeploymentQuerySyncGeneration2ToGeneration3(sql);
        yield* authenticateGeneration3Catalog(sql).pipe(
          Result.mapError(incompatible),
        );
        const predecessor = yield* readReadyDeploymentQuerySyncGeneration3(
          sql,
          binding,
        );
        migrateDeploymentQuerySyncGeneration3ToGeneration4(
          sql,
          predecessor.durableInitializedHistory,
        );
        break;
      }
      case "generation3": {
        const predecessor = yield* readReadyDeploymentQuerySyncGeneration3(
          sql,
          binding,
        );
        migrateDeploymentQuerySyncGeneration3ToGeneration4(
          sql,
          predecessor.durableInitializedHistory,
        );
        break;
      }
      case "generation4":
        return yield* readReadyDeploymentQuerySyncGeneration4(sql, binding);
    }
    yield* authenticateGeneration4Catalog(sql).pipe(Result.mapError(incompatible));
    return yield* readReadyDeploymentQuerySyncGeneration4(sql, binding);
  }));
}
