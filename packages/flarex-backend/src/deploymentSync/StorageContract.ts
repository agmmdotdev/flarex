import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
  type QuerySyncStateOperation,
} from "@flarex/query-sync/internal/state";
import {
  makeEmptyQuerySyncScopeFacts,
} from "@flarex/query-sync/internal/transition-plan";
import { Data, Result, Schema } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import {
  captureScopeSyncSourceEpochV1,
  captureScopeSyncSourceSequenceV1,
} from "./QuerySyncModel";
import {
  decodeDeploymentQuerySyncContractRowResult,
  decodeDeploymentSyncGeneration1ScopeRowResult,
  type DeploymentQuerySyncContractState,
  type DeploymentSyncGeneration1ScopeState,
} from "./RowCodec";

export type { DeploymentQuerySyncContractState } from "./RowCodec";

export type DeploymentQuerySyncC1Operation = Extract<
  QuerySyncStateOperation,
  | "initializeOrInspectNamespace"
  | "beginQueryEvaluation"
  | "applyAdmittedBatchAndAdvance"
>;

export type DeploymentQuerySyncSqlStorage = Pick<SqlStorage, "exec">;

export interface DeploymentQuerySyncStorage {
  readonly sql: DeploymentQuerySyncSqlStorage;
  readonly transactionSync: <A>(closure: () => A) => A;
}

export type DeploymentQuerySyncStorageContractError<
  Operation extends DeploymentQuerySyncC1Operation =
    DeploymentQuerySyncC1Operation,
> =
  | QuerySyncStoredStateCorruptError<Operation>
  | QuerySyncStoredStateIncompatibleError<Operation>;

const LOCAL_CONTRACT_GENERATION = 2 as const;
const STORAGE_READINESS_OPERATION =
  "initializeOrInspectNamespace" as const;

const CONTRACT_TABLE = "deployment_sync_contract_state";
const SCOPE_TABLE = "deployment_sync_scope_state";
const QUERY_TABLE = "deployment_sync_queries";
const DEPENDENCY_TABLE = "deployment_sync_query_dependencies";
const DEPENDENCY_REVERSE_INDEX =
  "deployment_sync_query_dependencies_reverse";
const LEGACY_SCOPE_TABLE =
  "deployment_sync_scope_state_generation_1";

const PROVIDER_TABLE_NAMES = new Set(["_cf_KV", "__cf_kv"]);

const CONTRACT_TABLE_DDL = `CREATE TABLE deployment_sync_contract_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  local_contract_generation INTEGER NOT NULL
    CHECK (local_contract_generation = 2),
  durable_initialized_history INTEGER NOT NULL
    CHECK (durable_initialized_history IN (0, 1))
) STRICT, WITHOUT ROWID`;

const SCOPE_TABLE_DDL = `CREATE TABLE deployment_sync_scope_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  scope_uuid TEXT NOT NULL,
  epoch_uuid TEXT NOT NULL,
  storage_generation TEXT NOT NULL
    CHECK (storage_generation = 'flarexdb_v1'),
  storage_generation_fence TEXT NOT NULL,
  sync_model_id TEXT NOT NULL,
  applied_through_sequence TEXT NOT NULL,
  evaluation_work_revision TEXT NOT NULL,
  fairness_anchor TEXT COLLATE BINARY
    CHECK (fairness_anchor IS NULL OR length(fairness_anchor) = 43),
  query_count INTEGER NOT NULL
    CHECK (query_count BETWEEN 0 AND 4096),
  retained_identity_bytes INTEGER NOT NULL
    CHECK (retained_identity_bytes BETWEEN 0 AND 33554432),
  dependency_memberships INTEGER NOT NULL
    CHECK (dependency_memberships BETWEEN 0 AND 262144),
  pending_publication_count INTEGER NOT NULL
    CHECK (pending_publication_count BETWEEN 0 AND 4096),
  in_flight_publication_count INTEGER NOT NULL
    CHECK (in_flight_publication_count BETWEEN 0 AND 1),
  retained_publication_content_bytes INTEGER NOT NULL
    CHECK (retained_publication_content_bytes BETWEEN 0 AND 33554432),
  settlement_envelope_bytes INTEGER NOT NULL
    CHECK (settlement_envelope_bytes BETWEEN 0 AND 190),
  counted_canonical_bytes INTEGER NOT NULL
    CHECK (counted_canonical_bytes BETWEEN 0 AND 67108864)
) STRICT, WITHOUT ROWID`;

const QUERY_TABLE_DDL = `CREATE TABLE deployment_sync_queries (
  query_key TEXT NOT NULL COLLATE BINARY PRIMARY KEY
    CHECK (length(query_key) = 43),
  query_identity TEXT NOT NULL,
  active_generation TEXT,
  active_evaluation_snapshot_sequence TEXT,
  active_fresh_through_sequence TEXT,
  active_dirty_through_sequence TEXT,
  active_result_digest TEXT
    CHECK (active_result_digest IS NULL OR length(active_result_digest) = 43),
  active_authority_witness TEXT
    CHECK (
      active_authority_witness IS NULL
      OR length(active_authority_witness) = 43
    ),
  provisional_generation TEXT,
  provisional_expected_active_generation TEXT,
  provisional_registration_sequence TEXT,
  provisional_requested_dirty_through_sequence TEXT,
  provisional_disposition TEXT
    CHECK (
      provisional_disposition IS NULL
      OR provisional_disposition IN ('ready', 'blocked')
    ),
  CHECK (
    (
      active_generation IS NULL
      AND active_evaluation_snapshot_sequence IS NULL
      AND active_fresh_through_sequence IS NULL
      AND active_dirty_through_sequence IS NULL
      AND active_result_digest IS NULL
      AND active_authority_witness IS NULL
    )
    OR
    (
      active_generation IS NOT NULL
      AND active_evaluation_snapshot_sequence IS NOT NULL
      AND active_fresh_through_sequence IS NOT NULL
      AND active_result_digest IS NOT NULL
      AND active_authority_witness IS NOT NULL
    )
  ),
  CHECK (
    (
      provisional_generation IS NULL
      AND provisional_expected_active_generation IS NULL
      AND provisional_registration_sequence IS NULL
      AND provisional_requested_dirty_through_sequence IS NULL
      AND provisional_disposition IS NULL
    )
    OR
    (
      provisional_generation IS NOT NULL
      AND provisional_registration_sequence IS NOT NULL
      AND provisional_disposition IS NOT NULL
    )
  )
) STRICT, WITHOUT ROWID`;

const DEPENDENCY_TABLE_DDL = `CREATE TABLE deployment_sync_query_dependencies (
  role TEXT NOT NULL CHECK (role = 'active'),
  query_key TEXT NOT NULL COLLATE BINARY
    CHECK (length(query_key) = 43),
  generation TEXT NOT NULL,
  dependency_key TEXT NOT NULL COLLATE BINARY,
  PRIMARY KEY (query_key, role, generation, dependency_key)
) STRICT, WITHOUT ROWID`;

const DEPENDENCY_REVERSE_INDEX_DDL =
  `CREATE INDEX deployment_sync_query_dependencies_reverse
ON deployment_sync_query_dependencies (
  role,
  dependency_key,
  query_key,
  generation
)`;

const LEGACY_SCOPE_TABLE_DDL = `CREATE TABLE deployment_sync_scope_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  local_schema_revision INTEGER NOT NULL,
  scope_uuid TEXT NOT NULL,
  epoch_uuid TEXT NOT NULL,
  storage_generation TEXT NOT NULL,
  storage_generation_fence TEXT NOT NULL,
  applied_through_commit_seq TEXT NOT NULL
)`;

const APPLICATION_TABLE_NAMES = new Set([
  CONTRACT_TABLE,
  SCOPE_TABLE,
  QUERY_TABLE,
  DEPENDENCY_TABLE,
]);

const APPLICATION_SCHEMA_OBJECT_NAMES = new Set([
  ...APPLICATION_TABLE_NAMES,
  DEPENDENCY_REVERSE_INDEX,
]);

type StorageContractIssueReason =
  | "catalogRowInvalid"
  | "catalogObjectUnexpected"
  | "catalogShapeUnsupported"
  | "sqlDefinitionInvalid"
  | "tableMetadataMismatch"
  | "columnMetadataMismatch"
  | "indexMetadataMismatch"
  | "contractRowMissing"
  | "contractRowDuplicate"
  | "contractGenerationUnsupported"
  | "contractRowInvalid"
  | "historyScopePresenceMismatch"
  | "historyDependentRowsPresent"
  | "legacyRowDuplicate"
  | "legacyRevisionUnsupported"
  | "legacyRowInvalid"
  | "legacyRouteScopeMismatch"
  | "legacyBootstrapBindingMismatch"
  | "legacyPortableProjectionRejected";

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
  input: {
    readonly objectName?: string;
    readonly expected?: unknown;
    readonly observed?: unknown;
    readonly cause?: unknown;
  } = {},
): DeploymentQuerySyncStorageContractIssue {
  return new DeploymentQuerySyncStorageContractIssue({
    reason,
    objectName: input.objectName ?? null,
    expected: input.expected ?? null,
    observed: input.observed ?? null,
    cause: input.cause ?? null,
  });
}

function incompatible<Operation extends DeploymentQuerySyncC1Operation>(
  operation: Operation,
  cause: unknown,
): QuerySyncStoredStateIncompatibleError<Operation> {
  return new QuerySyncStoredStateIncompatibleError<Operation>({
    operation,
    commitCertainty: "notCommitted",
    reason: "unsupportedStoredContract",
    cause,
  });
}

function bootstrapIncompatible(
  cause: unknown,
): QuerySyncStoredStateIncompatibleError<
  typeof STORAGE_READINESS_OPERATION
> {
  return new QuerySyncStoredStateIncompatibleError({
    operation: STORAGE_READINESS_OPERATION,
    commitCertainty: "notCommitted",
    reason: "bootstrapBindingMismatch",
    cause,
  });
}

function corrupt<Operation extends DeploymentQuerySyncC1Operation>(
  operation: Operation,
  reason: QuerySyncStoredStateCorruptError<Operation>["reason"],
  cause: unknown,
): QuerySyncStoredStateCorruptError<Operation> {
  return new QuerySyncStoredStateCorruptError<Operation>({
    operation,
    commitCertainty: "notCommitted",
    reason,
    cause,
  });
}

function isAsciiWhitespace(character: string): boolean {
  return character === " "
    || character === "\t"
    || character === "\n"
    || character === "\r"
    || character === "\f"
    || character === "\v";
}

function isIdentifierStart(character: string): boolean {
  const code = character.charCodeAt(0);
  return character === "_"
    || (code >= 65 && code <= 90)
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

function trailingCharactersAreWhitespace(
  sql: string,
  offset: number,
): boolean {
  for (let index = offset; index < sql.length; index += 1) {
    if (!isAsciiWhitespace(sql[index] ?? "")) return false;
  }
  return true;
}

export function tokenizeDeploymentQuerySyncSqlDefinitionForTest(
  sql: string,
): Result.Result<
  readonly string[],
  DeploymentQuerySyncSqlTokenizationIssue
> {
  const tokens: string[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const character = sql[offset] ?? "";
    if (isAsciiWhitespace(character)) {
      offset += 1;
      continue;
    }
    const next = sql[offset + 1] ?? "";
    if (
      (character === "-" && next === "-")
      || (character === "/" && next === "*")
    ) {
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
      while (
        offset < sql.length
        && isIdentifierContinue(sql[offset] ?? "")
      ) {
        offset += 1;
      }
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
    if (
      character === ";"
      && trailingCharactersAreWhitespace(sql, offset + 1)
    ) {
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

const EXPECTED_SQL_TOKENS = new Map<string, readonly string[]>([
  [CONTRACT_TABLE, expectedSqlTokens(CONTRACT_TABLE_DDL)],
  [SCOPE_TABLE, expectedSqlTokens(SCOPE_TABLE_DDL)],
  [QUERY_TABLE, expectedSqlTokens(QUERY_TABLE_DDL)],
  [DEPENDENCY_TABLE, expectedSqlTokens(DEPENDENCY_TABLE_DDL)],
  [DEPENDENCY_REVERSE_INDEX, expectedSqlTokens(
    DEPENDENCY_REVERSE_INDEX_DDL,
  )],
]);

const EXPECTED_LEGACY_SCOPE_SQL_TOKENS = expectedSqlTokens(
  LEGACY_SCOPE_TABLE_DDL,
);

function requiredExpectedSqlTokens(objectName: string): readonly string[] {
  const tokens = EXPECTED_SQL_TOKENS.get(objectName);
  if (tokens === undefined) {
    throw new Error(
      `Missing deployment query-sync SQL token expectation: ${objectName}`,
    );
  }
  return tokens;
}

function tokenSequencesEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((token, index) => token === right[index]);
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
const decodeSchemaObjectRow = Schema.decodeUnknownResult(
  SchemaObjectRowSchema,
  { onExcessProperty: "error" },
);
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

type EncodedContractRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
  readonly local_contract_generation: number;
  readonly durable_initialized_history: number;
}>;

type EncodedLegacyScopeRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
  readonly local_schema_revision: number;
  readonly scope_uuid: string;
  readonly epoch_uuid: string;
  readonly storage_generation: string;
  readonly storage_generation_fence: string;
  readonly applied_through_commit_seq: string;
}>;

interface ColumnExpectation {
  readonly name: string;
  readonly type: "INTEGER" | "TEXT";
  readonly notnull: 0 | 1;
  readonly pk: 0 | 1 | 2 | 3 | 4;
}

interface TableExpectation {
  readonly name: string;
  readonly columns: readonly ColumnExpectation[];
}

const TABLE_EXPECTATIONS: readonly TableExpectation[] = [
  {
    name: CONTRACT_TABLE,
    columns: [
      { name: "singleton", type: "INTEGER", notnull: 1, pk: 1 },
      {
        name: "local_contract_generation",
        type: "INTEGER",
        notnull: 1,
        pk: 0,
      },
      {
        name: "durable_initialized_history",
        type: "INTEGER",
        notnull: 1,
        pk: 0,
      },
    ],
  },
  {
    name: SCOPE_TABLE,
    columns: [
      { name: "singleton", type: "INTEGER", notnull: 1, pk: 1 },
      { name: "scope_uuid", type: "TEXT", notnull: 1, pk: 0 },
      { name: "epoch_uuid", type: "TEXT", notnull: 1, pk: 0 },
      { name: "storage_generation", type: "TEXT", notnull: 1, pk: 0 },
      {
        name: "storage_generation_fence",
        type: "TEXT",
        notnull: 1,
        pk: 0,
      },
      { name: "sync_model_id", type: "TEXT", notnull: 1, pk: 0 },
      {
        name: "applied_through_sequence",
        type: "TEXT",
        notnull: 1,
        pk: 0,
      },
      {
        name: "evaluation_work_revision",
        type: "TEXT",
        notnull: 1,
        pk: 0,
      },
      { name: "fairness_anchor", type: "TEXT", notnull: 0, pk: 0 },
      { name: "query_count", type: "INTEGER", notnull: 1, pk: 0 },
      {
        name: "retained_identity_bytes",
        type: "INTEGER",
        notnull: 1,
        pk: 0,
      },
      {
        name: "dependency_memberships",
        type: "INTEGER",
        notnull: 1,
        pk: 0,
      },
      {
        name: "pending_publication_count",
        type: "INTEGER",
        notnull: 1,
        pk: 0,
      },
      {
        name: "in_flight_publication_count",
        type: "INTEGER",
        notnull: 1,
        pk: 0,
      },
      {
        name: "retained_publication_content_bytes",
        type: "INTEGER",
        notnull: 1,
        pk: 0,
      },
      {
        name: "settlement_envelope_bytes",
        type: "INTEGER",
        notnull: 1,
        pk: 0,
      },
      {
        name: "counted_canonical_bytes",
        type: "INTEGER",
        notnull: 1,
        pk: 0,
      },
    ],
  },
  {
    name: QUERY_TABLE,
    columns: [
      { name: "query_key", type: "TEXT", notnull: 1, pk: 1 },
      { name: "query_identity", type: "TEXT", notnull: 1, pk: 0 },
      { name: "active_generation", type: "TEXT", notnull: 0, pk: 0 },
      {
        name: "active_evaluation_snapshot_sequence",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
      {
        name: "active_fresh_through_sequence",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
      {
        name: "active_dirty_through_sequence",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
      {
        name: "active_result_digest",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
      {
        name: "active_authority_witness",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
      {
        name: "provisional_generation",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
      {
        name: "provisional_expected_active_generation",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
      {
        name: "provisional_registration_sequence",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
      {
        name: "provisional_requested_dirty_through_sequence",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
      {
        name: "provisional_disposition",
        type: "TEXT",
        notnull: 0,
        pk: 0,
      },
    ],
  },
  {
    name: DEPENDENCY_TABLE,
    columns: [
      { name: "role", type: "TEXT", notnull: 1, pk: 2 },
      { name: "query_key", type: "TEXT", notnull: 1, pk: 1 },
      { name: "generation", type: "TEXT", notnull: 1, pk: 3 },
      { name: "dependency_key", type: "TEXT", notnull: 1, pk: 4 },
    ],
  },
] as const;

const LEGACY_COLUMN_EXPECTATIONS: readonly ColumnExpectation[] = [
  { name: "singleton", type: "INTEGER", notnull: 0, pk: 1 },
  {
    name: "local_schema_revision",
    type: "INTEGER",
    notnull: 1,
    pk: 0,
  },
  { name: "scope_uuid", type: "TEXT", notnull: 1, pk: 0 },
  { name: "epoch_uuid", type: "TEXT", notnull: 1, pk: 0 },
  { name: "storage_generation", type: "TEXT", notnull: 1, pk: 0 },
  {
    name: "storage_generation_fence",
    type: "TEXT",
    notnull: 1,
    pk: 0,
  },
  {
    name: "applied_through_commit_seq",
    type: "TEXT",
    notnull: 1,
    pk: 0,
  },
] as const;

function decodeRows<A>(
  rows: readonly unknown[],
  decode: (input: unknown) => Result.Result<A, unknown>,
  objectName: string | null,
): Result.Result<readonly A[], DeploymentQuerySyncStorageContractIssue> {
  return Result.gen(function* () {
    const decoded: A[] = [];
    for (const row of rows) {
      decoded.push(yield* decode(row).pipe(Result.mapError(cause =>
        contractIssue(
          "catalogRowInvalid",
          objectName === null ? { cause } : { objectName, cause },
        )
      )));
    }
    return Object.freeze(decoded);
  });
}

function tableInfoMatches(
  rows: readonly TableInfoRow[],
  columns: readonly ColumnExpectation[],
): boolean {
  return rows.length === columns.length && rows.every((row, index) => {
    const expected = columns[index];
    return expected !== undefined
      && row.cid === index
      && row.name === expected.name
      && row.type === expected.type
      && row.notnull === expected.notnull
      && row.dflt_value === null
      && row.pk === expected.pk;
  });
}

function tableListMatches(
  row: TableListRow | undefined,
  name: string,
  columnCount: number,
  withoutRowId: 0 | 1,
  strict: 0 | 1,
): boolean {
  return row !== undefined
    && row.schema === "main"
    && row.name === name
    && row.type === "table"
    && row.ncol === columnCount
    && row.wr === withoutRowId
    && row.strict === strict;
}

function indexListRowMatches(
  row: IndexListRow | undefined,
  input: {
    readonly name: string;
    readonly seq: number;
    readonly unique: 0 | 1;
    readonly origin: "c" | "pk";
  },
): boolean {
  return row !== undefined
    && row.name === input.name
    && row.seq === input.seq
    && row.unique === input.unique
    && row.origin === input.origin
    && row.partial === 0;
}

function indexXInfoMatches(
  rows: readonly IndexXInfoRow[],
  expected: readonly Readonly<{
    readonly cid: number;
    readonly name: string;
    readonly key: 0 | 1;
  }>[],
): boolean {
  return rows.length === expected.length && rows.every((row, index) => {
    const expectedRow = expected[index];
    return expectedRow !== undefined
      && row.seqno === index
      && row.cid === expectedRow.cid
      && row.name === expectedRow.name
      && row.desc === 0
      && row.coll === "BINARY"
      && row.key === expectedRow.key;
  });
}

function primaryKeyIndexXInfoExpectation(
  columns: readonly ColumnExpectation[],
): readonly Readonly<{
  readonly cid: number;
  readonly name: string;
  readonly key: 0 | 1;
}>[] {
  const primary = columns
    .map((column, cid) => ({ column, cid }))
    .filter(entry => entry.column.pk > 0)
    .toSorted((left, right) => left.column.pk - right.column.pk)
    .map(entry => Object.freeze({
      cid: entry.cid,
      name: entry.column.name,
      key: 1 as const,
    }));
  const auxiliary = columns
    .map((column, cid) => ({ column, cid }))
    .filter(entry => entry.column.pk === 0)
    .map(entry => Object.freeze({
      cid: entry.cid,
      name: entry.column.name,
      key: 0 as const,
    }));
  return Object.freeze([...primary, ...auxiliary]);
}

type CatalogClassification =
  | Readonly<{ readonly _tag: "fresh" }>
  | Readonly<{ readonly _tag: "generation1" }>
  | Readonly<{ readonly _tag: "generation2" }>;

interface CatalogSnapshot {
  readonly tableListRows: readonly TableListRow[];
  readonly applicationTableListRows: readonly TableListRow[];
  readonly applicationSchemaRows: readonly SchemaObjectRow[];
}

function readCatalogSnapshot(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<
  CatalogSnapshot,
  DeploymentQuerySyncStorageContractIssue
> {
  return Result.gen(function* () {
    const tableListRows = yield* decodeRows(
      sql.exec<EncodedTableListRow>("PRAGMA table_list").toArray(),
      decodeTableListRow,
      null,
    );
    const mainSchemaRows = yield* decodeRows(
      sql.exec<EncodedSchemaObjectRow>(`SELECT
        type,
        name,
        tbl_name,
        sql
      FROM main.sqlite_schema
      ORDER BY type, name, tbl_name`).toArray(),
      decodeSchemaObjectRow,
      null,
    );
    const temporarySchemaRows = yield* decodeRows(
      sql.exec<EncodedSchemaObjectRow>(`SELECT
        type,
        name,
        tbl_name,
        sql
      FROM temp.sqlite_schema
      ORDER BY type, name, tbl_name`).toArray(),
      decodeSchemaObjectRow,
      null,
    );

    for (const row of temporarySchemaRows) {
      if (!row.name.startsWith("sqlite_")) {
        return yield* Result.fail(contractIssue(
          "catalogObjectUnexpected",
          { objectName: `temp.${row.name}`, observed: row },
        ));
      }
    }

    const applicationTableListRows: TableListRow[] = [];
    for (const row of tableListRows) {
      if (row.schema === "temp") {
        if (!row.name.startsWith("sqlite_")) {
          return yield* Result.fail(contractIssue(
            "catalogObjectUnexpected",
            { objectName: `temp.${row.name}`, observed: row },
          ));
        }
        continue;
      }
      if (row.schema !== "main") {
        return yield* Result.fail(contractIssue(
          "catalogObjectUnexpected",
          { objectName: `${row.schema}.${row.name}`, observed: row },
        ));
      }
      if (row.name.startsWith("sqlite_")) continue;
      if (PROVIDER_TABLE_NAMES.has(row.name)) {
        if (row.type !== "table") {
          return yield* Result.fail(contractIssue(
            "catalogObjectUnexpected",
            { objectName: row.name, observed: row },
          ));
        }
        continue;
      }
      if (!APPLICATION_TABLE_NAMES.has(row.name)) {
        return yield* Result.fail(contractIssue(
          "catalogObjectUnexpected",
          { objectName: row.name, observed: row },
        ));
      }
      applicationTableListRows.push(row);
    }

    const applicationSchemaRows: SchemaObjectRow[] = [];
    for (const row of mainSchemaRows) {
      if (PROVIDER_TABLE_NAMES.has(row.name)) {
        if (row.type !== "table" || row.tbl_name !== row.name) {
          return yield* Result.fail(contractIssue(
            "catalogObjectUnexpected",
            { objectName: row.name, observed: row },
          ));
        }
        continue;
      }
      if (PROVIDER_TABLE_NAMES.has(row.tbl_name)) {
        if (!row.name.startsWith("sqlite_")) {
          return yield* Result.fail(contractIssue(
            "catalogObjectUnexpected",
            { objectName: row.name, observed: row },
          ));
        }
        continue;
      }
      if (row.name.startsWith("sqlite_")) {
        if (APPLICATION_TABLE_NAMES.has(row.tbl_name)) {
          return yield* Result.fail(contractIssue(
            "catalogObjectUnexpected",
            { objectName: row.name, observed: row },
          ));
        }
        continue;
      }
      if (!APPLICATION_SCHEMA_OBJECT_NAMES.has(row.name)) {
        return yield* Result.fail(contractIssue(
          "catalogObjectUnexpected",
          { objectName: row.name, observed: row },
        ));
      }
      applicationSchemaRows.push(row);
    }

    return Object.freeze({
      tableListRows,
      applicationTableListRows: Object.freeze(applicationTableListRows),
      applicationSchemaRows: Object.freeze(applicationSchemaRows),
    });
  });
}

function authenticateSqlDefinition(
  object: SchemaObjectRow,
  expected: readonly string[],
): Result.Result<void, DeploymentQuerySyncStorageContractIssue> {
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
): Result.Result<
  readonly TableInfoRow[],
  DeploymentQuerySyncStorageContractIssue
> {
  return decodeRows(
    sql.exec<EncodedTableInfoRow>(
      `PRAGMA main.table_info('${tableName}')`,
    ).toArray(),
    decodeTableInfoRow,
    tableName,
  );
}

function readIndexList(
  sql: DeploymentQuerySyncSqlStorage,
  tableName: string,
): Result.Result<
  readonly IndexListRow[],
  DeploymentQuerySyncStorageContractIssue
> {
  return decodeRows(
    sql.exec<EncodedIndexListRow>(
      `PRAGMA main.index_list('${tableName}')`,
    ).toArray(),
    decodeIndexListRow,
    tableName,
  );
}

function readIndexXInfo(
  sql: DeploymentQuerySyncSqlStorage,
  indexName: string,
): Result.Result<
  readonly IndexXInfoRow[],
  DeploymentQuerySyncStorageContractIssue
> {
  return decodeRows(
    sql.exec<EncodedIndexXInfoRow>(
      `PRAGMA main.index_xinfo('${indexName}')`,
    ).toArray(),
    decodeIndexXInfoRow,
    indexName,
  );
}

function inspectGeneration1Catalog(
  sql: DeploymentQuerySyncSqlStorage,
  snapshot: CatalogSnapshot,
): Result.Result<void, DeploymentQuerySyncStorageContractIssue> {
  return Result.gen(function* () {
    const tableListRow = snapshot.applicationTableListRows[0];
    const schemaRow = snapshot.applicationSchemaRows[0];
    if (
      snapshot.applicationTableListRows.length !== 1
      || snapshot.applicationSchemaRows.length !== 1
      || !tableListMatches(
        tableListRow,
        SCOPE_TABLE,
        LEGACY_COLUMN_EXPECTATIONS.length,
        0,
        0,
      )
      || schemaRow?.type !== "table"
      || schemaRow.name !== SCOPE_TABLE
      || schemaRow.tbl_name !== SCOPE_TABLE
    ) {
      return yield* Result.fail(contractIssue(
        "catalogShapeUnsupported",
        { expected: "exactGeneration1", observed: snapshot },
      ));
    }
    yield* authenticateSqlDefinition(
      schemaRow,
      EXPECTED_LEGACY_SCOPE_SQL_TOKENS,
    );
    const tableInfo = yield* readTableInfo(sql, SCOPE_TABLE);
    if (!tableInfoMatches(tableInfo, LEGACY_COLUMN_EXPECTATIONS)) {
      return yield* Result.fail(contractIssue("columnMetadataMismatch", {
        objectName: SCOPE_TABLE,
        expected: LEGACY_COLUMN_EXPECTATIONS,
        observed: tableInfo,
      }));
    }
    const indexes = yield* readIndexList(sql, SCOPE_TABLE);
    if (indexes.length !== 0) {
      return yield* Result.fail(contractIssue("indexMetadataMismatch", {
        objectName: SCOPE_TABLE,
        expected: [],
        observed: indexes,
      }));
    }
  });
}

function inspectGeneration2Table(
  sql: DeploymentQuerySyncSqlStorage,
  snapshot: CatalogSnapshot,
  expectation: TableExpectation,
): Result.Result<void, DeploymentQuerySyncStorageContractIssue> {
  return Result.gen(function* () {
    const tableListRow = snapshot.applicationTableListRows.find(
      row => row.name === expectation.name,
    );
    if (!tableListMatches(
      tableListRow,
      expectation.name,
      expectation.columns.length,
      1,
      1,
    )) {
      return yield* Result.fail(contractIssue("tableMetadataMismatch", {
        objectName: expectation.name,
        expected: {
          ncol: expectation.columns.length,
          schema: "main",
          strict: 1,
          type: "table",
          wr: 1,
        },
        observed: tableListRow,
      }));
    }
    const schemaRow = snapshot.applicationSchemaRows.find(
      row => row.name === expectation.name,
    );
    if (
      schemaRow === undefined
      || schemaRow.type !== "table"
      || schemaRow.tbl_name !== expectation.name
    ) {
      return yield* Result.fail(contractIssue("catalogShapeUnsupported", {
        objectName: expectation.name,
        expected: "tableDefinition",
        observed: schemaRow,
      }));
    }
    yield* authenticateSqlDefinition(
      schemaRow,
      requiredExpectedSqlTokens(expectation.name),
    );
    const tableInfo = yield* readTableInfo(sql, expectation.name);
    if (!tableInfoMatches(tableInfo, expectation.columns)) {
      return yield* Result.fail(contractIssue("columnMetadataMismatch", {
        objectName: expectation.name,
        expected: expectation.columns,
        observed: tableInfo,
      }));
    }
  });
}

function inspectGeneration2Indexes(
  sql: DeploymentQuerySyncSqlStorage,
  snapshot: CatalogSnapshot,
): Result.Result<void, DeploymentQuerySyncStorageContractIssue> {
  return Result.gen(function* () {
    for (const table of TABLE_EXPECTATIONS) {
      const indexes = yield* readIndexList(sql, table.name);
      const automaticIndexName = `sqlite_autoindex_${table.name}_1`;
      const automatic = indexes.find(index => index.name === automaticIndexName);
      const expectedIndexCount = table.name === DEPENDENCY_TABLE ? 2 : 1;
      if (
        indexes.length !== expectedIndexCount
        || !indexListRowMatches(automatic, {
          name: automaticIndexName,
          seq: table.name === DEPENDENCY_TABLE ? 1 : 0,
          unique: 1,
          origin: "pk",
        })
      ) {
        return yield* Result.fail(contractIssue("indexMetadataMismatch", {
          objectName: table.name,
          expected: {
            automaticIndexName,
            count: expectedIndexCount,
            origin: "pk",
            unique: 1,
          },
          observed: indexes,
        }));
      }
      const automaticXInfo = yield* readIndexXInfo(sql, automaticIndexName);
      const expectedAutomaticXInfo = primaryKeyIndexXInfoExpectation(
        table.columns,
      );
      if (!indexXInfoMatches(automaticXInfo, expectedAutomaticXInfo)) {
        return yield* Result.fail(contractIssue("indexMetadataMismatch", {
          objectName: automaticIndexName,
          expected: expectedAutomaticXInfo,
          observed: automaticXInfo,
        }));
      }
      if (table.name !== DEPENDENCY_TABLE) continue;
      const explicit = indexes.find(
        index => index.name === DEPENDENCY_REVERSE_INDEX,
      );
      if (!indexListRowMatches(explicit, {
        name: DEPENDENCY_REVERSE_INDEX,
        seq: 0,
        unique: 0,
        origin: "c",
      })) {
        return yield* Result.fail(contractIssue("indexMetadataMismatch", {
          objectName: DEPENDENCY_REVERSE_INDEX,
          expected: { origin: "c", partial: 0, unique: 0 },
          observed: explicit,
        }));
      }
      const explicitXInfo = yield* readIndexXInfo(
        sql,
        DEPENDENCY_REVERSE_INDEX,
      );
      const expectedExplicitXInfo = Object.freeze([
        Object.freeze({ cid: 0, name: "role", key: 1 as const }),
        Object.freeze({ cid: 3, name: "dependency_key", key: 1 as const }),
        Object.freeze({ cid: 1, name: "query_key", key: 1 as const }),
        Object.freeze({ cid: 2, name: "generation", key: 1 as const }),
      ]);
      if (!indexXInfoMatches(explicitXInfo, expectedExplicitXInfo)) {
        return yield* Result.fail(contractIssue("indexMetadataMismatch", {
          objectName: DEPENDENCY_REVERSE_INDEX,
          expected: expectedExplicitXInfo,
          observed: explicitXInfo,
        }));
      }
    }

    const explicitSchemaRow = snapshot.applicationSchemaRows.find(
      row => row.name === DEPENDENCY_REVERSE_INDEX,
    );
    if (
      explicitSchemaRow === undefined
      || explicitSchemaRow.type !== "index"
      || explicitSchemaRow.tbl_name !== DEPENDENCY_TABLE
    ) {
      return yield* Result.fail(contractIssue("catalogShapeUnsupported", {
        objectName: DEPENDENCY_REVERSE_INDEX,
        expected: "explicitDependencyReverseIndex",
        observed: explicitSchemaRow,
      }));
    }
    yield* authenticateSqlDefinition(
      explicitSchemaRow,
      requiredExpectedSqlTokens(DEPENDENCY_REVERSE_INDEX),
    );
  });
}

function inspectGeneration2Catalog(
  sql: DeploymentQuerySyncSqlStorage,
  snapshot: CatalogSnapshot,
): Result.Result<void, DeploymentQuerySyncStorageContractIssue> {
  return Result.gen(function* () {
    if (
      snapshot.applicationTableListRows.length !== TABLE_EXPECTATIONS.length
      || snapshot.applicationSchemaRows.length
        !== TABLE_EXPECTATIONS.length + 1
    ) {
      return yield* Result.fail(contractIssue(
        "catalogShapeUnsupported",
        { expected: "exactGeneration2", observed: snapshot },
      ));
    }
    for (const table of TABLE_EXPECTATIONS) {
      yield* inspectGeneration2Table(sql, snapshot, table);
    }
    yield* inspectGeneration2Indexes(sql, snapshot);
  });
}

function classifyCatalog(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<
  CatalogClassification,
  DeploymentQuerySyncStorageContractIssue
> {
  return Result.gen(function* () {
    const snapshot = yield* readCatalogSnapshot(sql);
    if (
      snapshot.applicationTableListRows.length === 0
      && snapshot.applicationSchemaRows.length === 0
    ) {
      return Object.freeze({ _tag: "fresh" as const });
    }
    if (
      snapshot.applicationTableListRows.length === 1
      && snapshot.applicationTableListRows[0]?.name === SCOPE_TABLE
      && snapshot.applicationSchemaRows.length === 1
      && snapshot.applicationSchemaRows[0]?.name === SCOPE_TABLE
    ) {
      yield* inspectGeneration1Catalog(sql, snapshot);
      return Object.freeze({ _tag: "generation1" as const });
    }
    if (
      snapshot.applicationTableListRows.length === TABLE_EXPECTATIONS.length
      && TABLE_EXPECTATIONS.every(expected =>
        snapshot.applicationTableListRows.some(row =>
          row.name === expected.name
        )
      )
    ) {
      yield* inspectGeneration2Catalog(sql, snapshot);
      return Object.freeze({ _tag: "generation2" as const });
    }
    return yield* Result.fail(contractIssue("catalogShapeUnsupported", {
      expected: "freshOrExactGeneration1OrExactGeneration2",
      observed: snapshot,
    }));
  });
}

const SingletonPresenceRowSchema = Schema.Struct({
  singleton: Schema.Literal(1),
});
const decodeSingletonPresenceRow = Schema.decodeUnknownResult(
  SingletonPresenceRowSchema,
  { onExcessProperty: "error" },
);

type EncodedSingletonPresenceRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
}>;

interface Generation2DependentRowPresence {
  readonly queryRowsPresent: boolean;
  readonly dependencyRowsPresent: boolean;
}

function readScopePresence<
  Operation extends DeploymentQuerySyncC1Operation,
>(
  sql: DeploymentQuerySyncSqlStorage,
  operation: Operation,
): Result.Result<boolean, QuerySyncStoredStateCorruptError<Operation>> {
  const rows = sql.exec<EncodedSingletonPresenceRow>(`SELECT singleton
    FROM main.deployment_sync_scope_state
    ORDER BY singleton
    LIMIT 2`).toArray();
  if (rows.length === 0) return Result.succeed(false);
  if (rows.length !== 1) {
    return Result.fail(corrupt(
      operation,
      "storedAggregateInvalid",
      contractIssue("historyScopePresenceMismatch", {
        expected: "zeroOrOneScopeRow",
        observed: rows.length,
      }),
    ));
  }
  return decodeSingletonPresenceRow(rows[0]).pipe(
    Result.map(() => true),
    Result.mapError(cause => corrupt(
      operation,
      "storedAggregateInvalid",
      contractIssue("historyScopePresenceMismatch", { cause }),
    )),
  );
}

function readContractRows(
  sql: DeploymentQuerySyncSqlStorage,
): readonly unknown[] {
  return sql.exec<EncodedContractRow>(`SELECT
    singleton,
    local_contract_generation,
    durable_initialized_history
  FROM main.deployment_sync_contract_state
  ORDER BY singleton
    LIMIT 2`).toArray();
}

function readGeneration2DependentRowPresence(
  sql: DeploymentQuerySyncSqlStorage,
): Generation2DependentRowPresence {
  const queryRowsPresent = sql.exec<{ readonly present: number }>(`SELECT
    1 AS present
  FROM main.deployment_sync_queries
  LIMIT 1`).toArray().length !== 0;
  const dependencyRowsPresent = sql.exec<{ readonly present: number }>(`SELECT
    1 AS present
  FROM main.deployment_sync_query_dependencies
  LIMIT 1`).toArray().length !== 0;
  return Object.freeze({ queryRowsPresent, dependencyRowsPresent });
}

export function readDeploymentQuerySyncContractState<
  Operation extends DeploymentQuerySyncC1Operation,
>(
  sql: DeploymentQuerySyncSqlStorage,
  operation: Operation,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncStorageContractError<Operation>
> {
  const rows = readContractRows(sql);
  if (rows.length === 0) {
    return Result.fail(corrupt(
      operation,
      "storedAggregateInvalid",
      contractIssue("contractRowMissing"),
    ));
  }
  if (rows.length !== 1) {
    return Result.fail(corrupt(
      operation,
      "storedAggregateInvalid",
      contractIssue("contractRowDuplicate", { observed: rows.length }),
    ));
  }
  return decodeDeploymentQuerySyncContractRowResult(rows[0]).pipe(
    Result.mapError(cause => cause.reason === "unsupportedContractGeneration"
      ? incompatible(operation, contractIssue(
        "contractGenerationUnsupported",
        { cause },
      ))
      : corrupt(
        operation,
        "storedAggregateInvalid",
        contractIssue("contractRowInvalid", { cause }),
      )),
  );
}

function readReadyGeneration2Contract(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >
> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      STORAGE_READINESS_OPERATION,
    );
    const scopePresent = yield* readScopePresence(
      sql,
      STORAGE_READINESS_OPERATION,
    );
    if (contract.durableInitializedHistory !== scopePresent) {
      return yield* Result.fail(corrupt(
        STORAGE_READINESS_OPERATION,
        contract.durableInitializedHistory
          ? "aggregateMissing"
          : "storedAggregateInvalid",
        contractIssue("historyScopePresenceMismatch", {
          expected: contract.durableInitializedHistory
            ? "scopePresent"
            : "scopeAbsent",
          observed: scopePresent ? "scopePresent" : "scopeAbsent",
        }),
      ));
    }
    if (!contract.durableInitializedHistory) {
      const dependentRows = readGeneration2DependentRowPresence(sql);
      if (
        dependentRows.queryRowsPresent
        || dependentRows.dependencyRowsPresent
      ) {
        return yield* Result.fail(corrupt(
          STORAGE_READINESS_OPERATION,
          "storedAggregateInvalid",
          contractIssue("historyDependentRowsPresent", {
            expected: "emptyQueryAndDependencyTablesWhenScopeAbsent",
            observed: dependentRows,
          }),
        ));
      }
    }
    return contract;
  });
}

function readGeneration1ScopeRow(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<
  DeploymentSyncGeneration1ScopeState | null,
  DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >
> {
  const rows = sql.exec<EncodedLegacyScopeRow>(`SELECT
    singleton,
    local_schema_revision,
    scope_uuid,
    epoch_uuid,
    storage_generation,
    storage_generation_fence,
    applied_through_commit_seq
  FROM main.deployment_sync_scope_state
  ORDER BY singleton
  LIMIT 2`).toArray();
  if (rows.length === 0) return Result.succeed(null);
  if (rows.length !== 1) {
    return Result.fail(corrupt(
      STORAGE_READINESS_OPERATION,
      "storedAggregateInvalid",
      contractIssue("legacyRowDuplicate", { observed: rows.length }),
    ));
  }
  return decodeDeploymentSyncGeneration1ScopeRowResult(rows[0]).pipe(
    Result.mapError(cause => cause.reason === "unsupportedLegacyRevision"
      ? incompatible(
        STORAGE_READINESS_OPERATION,
        contractIssue("legacyRevisionUnsupported", { cause }),
      )
      : corrupt(
        STORAGE_READINESS_OPERATION,
        "storedAggregateInvalid",
        contractIssue("legacyRowInvalid", { cause }),
      )),
  );
}

function authenticateGeneration1Scope(
  legacy: DeploymentSyncGeneration1ScopeState,
  binding: DeploymentQuerySyncBinding,
): Result.Result<
  ReturnType<typeof makeEmptyQuerySyncScopeFacts>,
  DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >
> {
  if (legacy.scopeUuid !== binding.scopeUuid) {
    return Result.fail(corrupt(
      STORAGE_READINESS_OPERATION,
      "namespaceBindingMismatch",
      contractIssue("legacyRouteScopeMismatch", {
        expected: binding.scopeUuid,
        observed: legacy.scopeUuid,
      }),
    ));
  }
  if (
    legacy.storageGeneration !== binding.storageGeneration
    || legacy.storageGenerationFence !== binding.storageGenerationFence
    || legacy.appliedThroughCommitSeq > binding.observedAtCommitSeq
  ) {
    return Result.fail(bootstrapIncompatible(contractIssue(
      "legacyBootstrapBindingMismatch",
      {
        expected: Object.freeze({
          storageGeneration: binding.storageGeneration,
          storageGenerationFence:
            binding.storageGenerationFence.toString(),
          maximumAppliedThroughCommitSeq:
            binding.observedAtCommitSeq.toString(),
        }),
        observed: Object.freeze({
          storageGeneration: legacy.storageGeneration,
          storageGenerationFence:
            legacy.storageGenerationFence.toString(),
          appliedThroughCommitSeq:
            legacy.appliedThroughCommitSeq.toString(),
        }),
      },
    )));
  }
  return Result.gen(function* () {
    const sourceEpoch = yield* captureScopeSyncSourceEpochV1(
      legacy.epochUuid,
    ).pipe(Result.mapError(cause => corrupt(
      STORAGE_READINESS_OPERATION,
      "storedAggregateInvalid",
      contractIssue("legacyPortableProjectionRejected", { cause }),
    )));
    const appliedThroughSequence = yield* captureScopeSyncSourceSequenceV1(
      legacy.appliedThroughCommitSeq,
    ).pipe(Result.mapError(cause => corrupt(
      STORAGE_READINESS_OPERATION,
      "storedAggregateInvalid",
      contractIssue("legacyPortableProjectionRejected", { cause }),
    )));
    return makeEmptyQuerySyncScopeFacts({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch,
      appliedThroughSequence,
    });
  });
}

function createGeneration2Tables(sql: DeploymentQuerySyncSqlStorage): void {
  sql.exec(CONTRACT_TABLE_DDL);
  sql.exec(SCOPE_TABLE_DDL);
  sql.exec(QUERY_TABLE_DDL);
  sql.exec(DEPENDENCY_TABLE_DDL);
}

function insertContractRow(
  sql: DeploymentQuerySyncSqlStorage,
  durableInitializedHistory: boolean,
): void {
  sql.exec(
    `INSERT INTO main.deployment_sync_contract_state (
      singleton,
      local_contract_generation,
      durable_initialized_history
    ) VALUES (1, 2, ?)`,
    durableInitializedHistory ? 1 : 0,
  );
}

function insertMigratedScopeRow(
  sql: DeploymentQuerySyncSqlStorage,
  legacy: DeploymentSyncGeneration1ScopeState,
  binding: DeploymentQuerySyncBinding,
  emptyScope: ReturnType<typeof makeEmptyQuerySyncScopeFacts>,
): void {
  sql.exec(
    `INSERT INTO main.deployment_sync_scope_state (
      singleton,
      scope_uuid,
      epoch_uuid,
      storage_generation,
      storage_generation_fence,
      sync_model_id,
      applied_through_sequence,
      evaluation_work_revision,
      fairness_anchor,
      query_count,
      retained_identity_bytes,
      dependency_memberships,
      pending_publication_count,
      in_flight_publication_count,
      retained_publication_content_bytes,
      settlement_envelope_bytes,
      counted_canonical_bytes
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    legacy.scopeUuid,
    legacy.epochUuid,
    legacy.storageGeneration,
    legacy.storageGenerationFence.toString(),
    binding.syncModelId,
    emptyScope.cursor.appliedThroughSequence.toString(),
    emptyScope.evaluationWork.revision.toString(),
    emptyScope.evaluationWork.fairnessAnchor,
    emptyScope.metrics.queryCount,
    emptyScope.metrics.retainedIdentityBytes,
    emptyScope.metrics.dependencyMemberships,
    emptyScope.metrics.pendingPublicationCount,
    emptyScope.metrics.inFlightPublicationCount,
    emptyScope.metrics.retainedPublicationContentBytes,
    emptyScope.metrics.settlementEnvelopeBytes,
    emptyScope.metrics.countedCanonicalBytes,
  );
}

function freshGeneration2Storage(
  sql: DeploymentQuerySyncSqlStorage,
): DeploymentQuerySyncContractState {
  createGeneration2Tables(sql);
  insertContractRow(sql, false);
  sql.exec(DEPENDENCY_REVERSE_INDEX_DDL);
  return Object.freeze({
    localContractGeneration: LOCAL_CONTRACT_GENERATION,
    durableInitializedHistory: false,
  });
}

function migrateGeneration1Storage(
  sql: DeploymentQuerySyncSqlStorage,
  legacy: DeploymentSyncGeneration1ScopeState | null,
  binding: DeploymentQuerySyncBinding,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >
> {
  return Result.gen(function* () {
    const emptyScope = legacy === null
      ? null
      : yield* authenticateGeneration1Scope(legacy, binding);

    sql.exec(`ALTER TABLE main.${SCOPE_TABLE}
      RENAME TO ${LEGACY_SCOPE_TABLE}`);
    createGeneration2Tables(sql);
    insertContractRow(sql, legacy !== null);
    if (legacy !== null && emptyScope !== null) {
      insertMigratedScopeRow(sql, legacy, binding, emptyScope);
    }
    sql.exec(`DROP TABLE main.${LEGACY_SCOPE_TABLE}`);
    sql.exec(DEPENDENCY_REVERSE_INDEX_DDL);
    return Object.freeze({
      localContractGeneration: LOCAL_CONTRACT_GENERATION,
      durableInitializedHistory: legacy !== null,
    });
  });
}

export function ensureDeploymentQuerySyncStorageReady(
  storage: DeploymentQuerySyncStorage,
  binding: DeploymentQuerySyncBinding,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >
> {
  const sql = storage.sql;
  return storage.transactionSync(() => Result.gen(function* () {
    const catalog = yield* classifyCatalog(sql).pipe(
      Result.mapError(cause => incompatible(
        STORAGE_READINESS_OPERATION,
        cause,
      )),
    );
    switch (catalog._tag) {
      case "fresh":
        return freshGeneration2Storage(sql);
      case "generation1": {
        const legacy = yield* readGeneration1ScopeRow(sql);
        return yield* migrateGeneration1Storage(sql, legacy, binding);
      }
      case "generation2":
        return yield* readReadyGeneration2Contract(sql);
    }
  }));
}
