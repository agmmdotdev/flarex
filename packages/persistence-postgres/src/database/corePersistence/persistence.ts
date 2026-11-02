import { Clock, Effect, Option, Schema, Stream } from "effect";
import { bytesEqual, compareBytesLexicographically, copyBytes } from "@flarex/utils/bytes";
import { MAX_INDEX_KEY_PREFIX_BYTES, splitIndexKey } from "flarex-protocol/index-key";
import {
  CorePersistenceError,
  type CoreDocumentLogEntry,
  type CoreDocumentLogRequest,
  type CorePreviousRevisionQuery,
  type CorePreviousRevisionSearch,
  type CorePreviousRevision,
  type CoreHydratedIndexEntry,
  type CoreIndexPage,
  type CoreIndexScan,
  type CoreIndexHistoryRequest,
  type CoreIndexHistoryCursor,
  type CoreIndexHistoryEntry,
  type CoreIndexHistoryPage,
  type CorePersistence,
  type CorePersistenceIndexEntry,
  type CorePersistenceLease,
  type CoreRetentionValidator,
  type CoreWriteBatch,
} from "../../core/contracts";
import type { CoreSqlConnection, CoreSqlParameter } from "./driver";
import { PgDialect } from "drizzle-orm/pg-core";
import { inspectIssuedPostgresRelationalBatch, type PostgresRelationalPredicateFailure } from "../../values/postgresRelationalPredicate";
import { buildPostgresRelationalPredicateBody } from "../postgresRelationalPredicate";
import { coreTableName, inspectCorePersistenceTarget, type CorePersistenceTarget } from "./target";
import {
  decodeDocumentRows, decodePreviousRevisionRows, decodeIndexRows, decodeIndexHistoryRows, documentFromRow, makeStoredRowsDecoder,
  internalIdSchema, timestampSchema,
} from "./rows";

const relationalDialect = new PgDialect();
const instanceSchema = Schema.NonEmptyString;
const countSchema = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value > 0 ? undefined : "Expected a positive safe page size"));
const decodeCount = Schema.decodeUnknownEffect(countSchema);
const nullableBytes = Schema.NullOr(Schema.Uint8Array);
const scanSchema = Schema.Struct({
  index: Schema.Struct({ id: internalIdSchema, persistenceIndexId: Schema.optionalKey(Schema.BigInt) }),
  tableId: internalIdSchema,
  interval: Schema.Struct({ start: nullableBytes, end: nullableBytes }),
  order: Schema.Literals(["asc", "desc"]),
  maxResults: countSchema,
});
const documentEntrySchema = Schema.Struct({
  ts: timestampSchema, tableId: internalIdSchema, id: internalIdSchema,
  jsonValue: Schema.Uint8Array, deleted: Schema.Boolean, prevTs: Schema.NullOr(timestampSchema),
});
const indexEntrySchema = Schema.Struct({
  mode: Schema.Literals(["scanning", "scanComplete"]),
  ts: timestampSchema,
  index: Schema.Struct({ id: internalIdSchema, persistenceIndexId: Schema.optionalKey(Schema.BigInt) }),
  key: Schema.Uint8Array,
  value: Schema.NullOr(Schema.Struct({ tableId: internalIdSchema, documentId: internalIdSchema })),
  prev: Schema.NullOr(Schema.Struct({ ts: timestampSchema, documentId: internalIdSchema })),
});
const batchSchema = Schema.Struct({ documents: Schema.Array(documentEntrySchema), indexes: Schema.Array(indexEntrySchema) });
const globalsSchema = Schema.Array(Schema.Struct({ json_value: Schema.Uint8Array }));
const latestSchema = Schema.Array(Schema.Struct({ ts: Schema.NullOr(timestampSchema) }));
const freshnessSchema = Schema.Array(Schema.Struct({ documents: Schema.Boolean, indexes: Schema.Boolean }));
const pointSchema = Schema.Struct({ tableId: internalIdSchema, id: internalIdSchema });
const decodeInstance = Schema.decodeUnknownEffect(instanceSchema);
const decodeTimestamp = Schema.decodeUnknownEffect(timestampSchema);
const decodeSqlParameters = Schema.decodeUnknownEffect(Schema.Array(Schema.Union([
  Schema.String, Schema.Finite, Schema.BigInt, Schema.Boolean, Schema.Uint8Array, Schema.Null,
])));
const decodeScan = Schema.decodeUnknownEffect(scanSchema);
const decodeIndexHistoryRequest = Schema.decodeUnknownEffect(Schema.Struct({
  index: scanSchema.fields.index, tableId: internalIdSchema, interval: scanSchema.fields.interval,
  start: timestampSchema, end: timestampSchema, maxResults: countSchema,
  maxBytes: Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0
    ? undefined : "Expected a nonnegative safe byte bound")), maxDocumentBytes: countSchema,
  after: Schema.optionalKey(Schema.Struct({ keyPrefix: Schema.Uint8Array.check(Schema.makeFilter(value =>
    value.length <= MAX_INDEX_KEY_PREFIX_BYTES ? undefined : "Invalid physical prefix")),
  keySha256: Schema.Uint8Array.check(Schema.makeFilter(value => value.length === 32 ? undefined : "Invalid physical key digest")),
  ts: timestampSchema })),
}));
const decodeBatch = Schema.decodeUnknownEffect(batchSchema);
const decodePoint = Schema.decodeUnknownEffect(pointSchema);
const decodeDocumentLogRequest = Schema.decodeUnknownEffect(Schema.Struct({
  start: timestampSchema, end: timestampSchema, order: Schema.Literals(["asc", "desc"]), maxResults: countSchema,
  after: Schema.optionalKey(Schema.Struct({ ts: timestampSchema, tableId: internalIdSchema, id: internalIdSchema })),
  tableId: Schema.optionalKey(internalIdSchema),
}));
const previousSearchSchema = Schema.Struct({ ...pointSchema.fields, ts: timestampSchema });
const decodePreviousSearches = Schema.decodeUnknownEffect(Schema.Array(previousSearchSchema));
const decodePreviousQueries = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({
  ...previousSearchSchema.fields, prevTs: timestampSchema,
})));
const decodeGlobals = makeStoredRowsDecoder(globalsSchema);
const decodeLatest = makeStoredRowsDecoder(latestSchema);
const decodeFreshness = makeStoredRowsDecoder(freshnessSchema);
const jsonNull = new TextEncoder().encode("null");

function invalid(cause: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "invalidTarget", cause });
}
const relationalPersistenceFailure: PostgresRelationalPredicateFailure<CorePersistenceError> = (reason, cause) =>
  new CorePersistenceError({ reason: "invalidTarget", cause: { reason, cause } });

function comparePreviousSearches(left: CorePreviousRevisionSearch, right: CorePreviousRevisionSearch): number {
  return compareBytesLexicographically(left.tableId, right.tableId) || compareBytesLexicographically(left.id, right.id)
    || (left.ts < right.ts ? -1 : left.ts > right.ts ? 1 : 0);
}

function copyDocument(entry: CoreDocumentLogEntry): CoreDocumentLogEntry {
  return Object.freeze({ ...entry, tableId: copyBytes(entry.tableId), id: copyBytes(entry.id),
    jsonValue: entry.deleted ? copyBytes(jsonNull) : copyBytes(entry.jsonValue) });
}

function copyIndex(entry: CorePersistenceIndexEntry): CorePersistenceIndexEntry {
  return Object.freeze({ ...entry, key: copyBytes(entry.key),
    index: Object.freeze({ ...entry.index, id: copyBytes(entry.index.id) }),
    value: entry.value === null ? null : Object.freeze({
      tableId: copyBytes(entry.value.tableId), documentId: copyBytes(entry.value.documentId),
    }),
    prev: entry.prev === null ? null : Object.freeze({ ...entry.prev, documentId: copyBytes(entry.prev.documentId) }),
  });
}

interface SqlBound {
  readonly prefix: Uint8Array;
  readonly hash: Uint8Array;
  readonly inclusive: boolean;
}

/** The adapter owns physical I/O; the portable engine owns visibility/acceptance. */
export const createCorePersistence = Effect.fn("CorePersistence.create")(
  function* (
    target: CorePersistenceTarget,
    instanceInput: string,
    options: Readonly<{ sqlPageSize?: number; leaseTimestamp?: Effect.Effect<bigint> }> = {},
  ): Effect.fn.Return<CorePersistence, CorePersistenceError> {
    const captured = inspectCorePersistenceTarget(target);
    if (captured === undefined) return yield* Effect.fail(new CorePersistenceError({ reason: "invalidTarget" }));
    const instance = yield* decodeInstance(instanceInput).pipe(Effect.mapError(invalid));
    const sqlPageSize = options.sqlPageSize === undefined ? undefined
      : yield* decodeCount(options.sqlPageSize).pipe(Effect.mapError(invalid));
    const { driver, namespace } = captured;
    const table = (name: string) => coreTableName(namespace, name);
    const issuedLeases = new WeakSet<CorePersistenceLease>();
    const lostLeases = new WeakSet<CorePersistenceLease>();

    const readGlobal = Effect.fn("CorePersistence.readGlobal")(
      function* (connection: CoreSqlConnection, key: string) {
        const rows = yield* connection.query(`SELECT json_value FROM ${table("persistence_globals")}
          WHERE instance_name = $1 AND key = $2`, [instance, key]);
        const decoded = yield* decodeGlobals(rows);
        if (decoded.length > 1) return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
        return decoded[0] === undefined ? Option.none<Uint8Array>() : Option.some(copyBytes(decoded[0].json_value));
      },
    );
    const globalTimestamp = Effect.fn("CorePersistence.globalTimestamp")(
      function* (connection: CoreSqlConnection, key: string) {
        const stored = yield* readGlobal(connection, key);
        if (Option.isNone(stored)) return 0n;
        // These bootstrap/retention globals use the pinned JSON integer spelling.
        const text = yield* Effect.try({ try: () => new TextDecoder("utf-8", { fatal: true }).decode(stored.value),
          catch: cause => new CorePersistenceError({ reason: "corruptData", cause }) });
        return yield* decodeTimestamp(text).pipe(Effect.mapError(cause =>
          new CorePersistenceError({ reason: "corruptData", cause }),
        ));
      },
    );
    const validateRetention = Effect.fn("CorePersistence.validateRetention")(
      function* (at: bigint, key = "min_snapshot_ts") {
        const floor = yield* globalTimestamp(driver, key);
        if (at < floor) return yield* Effect.fail(new CorePersistenceError({ reason: "outOfRetention" }));
      },
    );
    const sqlRetention: CoreRetentionValidator = Object.freeze({
      validateIndex: (at: bigint) => validateRetention(at),
      validateDocument: (at: bigint) => validateRetention(at, "document_min_snapshot_ts"),
    });
    const fence = Effect.fn("CorePersistence.fence")(
      function* (connection: CoreSqlConnection, lease: CorePersistenceLease, lock: boolean) {
        const rows = yield* connection.query(`SELECT 1 FROM ${table("leases")}
          WHERE instance_name = $1 AND ts = $2${lock ? " FOR SHARE" : ""}`, [instance, lease.token]);
        if (rows.length !== 1) {
          lostLeases.add(lease);
          return yield* Effect.fail(new CorePersistenceError({ reason: "leaseLost" }));
        }
      },
    );
    const fenced = <A, E>(lease: CorePersistenceLease, run: (connection: CoreSqlConnection) => Effect.Effect<A, E>) =>
      Effect.suspend(() => {
        if (!issuedLeases.has(lease)) return Effect.fail(new CorePersistenceError({ reason: "invalidTarget" }));
        if (lostLeases.has(lease)) return Effect.fail(new CorePersistenceError({ reason: "leaseLost" }));
        return driver.transaction(connection => Effect.gen(function* () {
          yield* fence(connection, lease, false);
          const value = yield* run(connection);
          // Match Lease::transact: acquire the blocking share lock only after
          // materialization, immediately before the driver's COMMIT.
          yield* fence(connection, lease, true);
          return value;
        }));
      });

    const insertRows = Effect.fn("CorePersistence.insertRows")(
      function* (connection: CoreSqlConnection, name: string, columns: readonly string[],
        rows: readonly (readonly CoreSqlParameter[])[], overwrite = false) {
        // Match postgres/lib.rs INSERTS_PER_STATEMENT. All chunks remain in
        // this logical batch's one fenced SQL transaction. Giant VALUES binds
        // also exceed PGlite's signed ParameterDescription count parser.
        const chunkSize = 1024;
        for (let start = 0; start < rows.length; start += chunkSize) {
          const chunk = rows.slice(start, start + chunkSize);
          const parameters: CoreSqlParameter[] = [];
          const tuples = chunk.map(row => `(${row.map(value => {
            parameters.push(value);
            return `$${parameters.length}`;
          }).join(", ")})`);
          const conflict = overwrite ? ` ON CONFLICT (instance_name, index_id, key_sha256, ts)
            DO UPDATE SET key_prefix = excluded.key_prefix, key_suffix = excluded.key_suffix,
              deleted = excluded.deleted, table_id = excluded.table_id, document_id = excluded.document_id` : "";
          yield* connection.query(`INSERT INTO ${table(name)} (${columns.join(", ")}) VALUES ${tuples.join(", ")}${conflict}`, parameters);
        }
      },
    );
    const writeBatch = Effect.fn("CorePersistence.writeBatch")(
      function* (lease: CorePersistenceLease, input: CoreWriteBatch, overwriteIndexes = false) {
        const validated = yield* decodeBatch(input).pipe(Effect.mapError(invalid));
        // The complete batch is detached before any asynchronous operation.
        const documents = validated.documents.map(copyDocument);
        const indexes = validated.indexes.map(copyIndex);
        const documentRows = documents.map(entry => [instance, entry.id, entry.ts, entry.tableId,
          entry.jsonValue, entry.deleted, entry.prevTs]);
        const indexRows = indexes.map(entry => {
          const key = splitIndexKey(entry.key);
          return [instance, entry.index.id, entry.ts, key.keyPrefix, key.keySuffix,
            key.keySha256, entry.value === null, entry.value?.tableId ?? null, entry.value?.documentId ?? null];
        });
        yield* fenced(lease, connection => Effect.gen(function* () {
          yield* insertRows(connection, "documents", ["instance_name", "id", "ts", "table_id", "json_value", "deleted", "prev_ts"], documentRows);
          yield* insertRows(connection, "indexes", ["instance_name", "index_id", "ts", "key_prefix", "key_suffix", "key_sha256", "deleted", "table_id", "document_id"], indexRows, overwriteIndexes);
        }));
      },
    );

    const scan = Effect.fn("CorePersistence.indexPage")(
      function* (at: bigint, input: CoreIndexScan, retention: CoreRetentionValidator): Effect.fn.Return<CoreIndexPage, CorePersistenceError> {
        const decoded = yield* decodeScan(input).pipe(Effect.mapError(invalid));
        const request = Object.freeze({ ...decoded,
          index: Object.freeze({ ...decoded.index, id: copyBytes(decoded.index.id) }),
          tableId: copyBytes(decoded.tableId),
          interval: Object.freeze({ start: decoded.interval.start === null ? null : copyBytes(decoded.interval.start),
            end: decoded.interval.end === null ? null : copyBytes(decoded.interval.end) }),
        });
        yield* retention.validateIndex(at);
        const { start, end } = request.interval;
        if (start !== null && end !== null && compareBytesLexicographically(start, end) >= 0) {
          return Object.freeze({ entries: [], cursor: Object.freeze({ kind: "end" as const }) });
        }
        let lower: SqlBound | undefined = start === null ? undefined : {
          prefix: start.slice(0, MAX_INDEX_KEY_PREFIX_BYTES), hash: new Uint8Array(32), inclusive: true,
        };
        let upper: SqlBound | undefined = end === null ? undefined : {
          prefix: end.slice(0, MAX_INDEX_KEY_PREFIX_BYTES), hash: new Uint8Array(32).fill(255), inclusive: true,
        };
        const ascending = request.order === "asc";
        // Match the pinned reader's caller-sized SQL pages. A smaller explicit
        // transport page is useful for conformance, never a larger prefetch.
        const pageSize = Math.min(sqlPageSize ?? request.maxResults, request.maxResults);
        const entries: CoreHydratedIndexEntry[] = [];
        let buffer: CoreHydratedIndexEntry[] = [];
        let bufferedPrefix: Uint8Array | undefined;
        const inInterval = (key: Uint8Array) => (start === null || compareBytesLexicographically(key, start) >= 0)
          && (end === null || compareBytesLexicographically(key, end) < 0);
        const flush = () => {
          buffer.sort((left, right) => compareBytesLexicographically(left.key, right.key) * (ascending ? 1 : -1));
          for (const entry of buffer) if (inInterval(entry.key)) entries.push(entry);
          buffer = [];
          bufferedPrefix = undefined;
        };
        let exhausted = false;
        while (!exhausted && entries.length < request.maxResults) {
          const parameters: CoreSqlParameter[] = [instance, request.index.id, at];
          const predicates = ["instance_name = $1", "index_id = $2", "ts <= $3"];
          for (const [bound, side] of [[lower, "lower"], [upper, "upper"]] as const) {
            if (bound === undefined) continue;
            parameters.push(bound.prefix, bound.hash);
            const operator = side === "lower" ? (bound.inclusive ? ">=" : ">") : (bound.inclusive ? "<=" : "<");
            predicates.push(`(key_prefix, key_sha256) ${operator} ($${parameters.length - 1}, $${parameters.length})`);
          }
          parameters.push(pageSize);
          const order = ascending ? "ASC" : "DESC";
          const rows = yield* driver.query(`SELECT a.ts::text AS ts, a.key_prefix, a.key_suffix, a.key_sha256, a.deleted,
            d.ts::text AS document_ts, d.table_id, a.document_id, d.json_value, d.deleted AS document_deleted, d.prev_ts::text AS prev_ts
            FROM (SELECT DISTINCT ON (key_prefix, key_sha256)
              ts, key_prefix, key_suffix, key_sha256, deleted, table_id, document_id
              FROM ${table("indexes")} WHERE ${predicates.join(" AND ")}
              ORDER BY key_prefix ${order}, key_sha256 ${order}, ts DESC LIMIT $${parameters.length}) a
            LEFT JOIN ${table("documents")} d ON d.instance_name = $1 AND d.ts = a.ts
              AND d.table_id = a.table_id AND d.id = a.document_id
            ORDER BY a.key_prefix ${order}, a.key_sha256 ${order}`, parameters);
          const parsed = yield* decodeIndexRows(rows);
          for (const row of parsed) {
            if (bufferedPrefix !== undefined && !bytesEqual(bufferedPrefix, row.key_prefix)) flush();
            const next = { prefix: copyBytes(row.key_prefix), hash: copyBytes(row.key_sha256), inclusive: false };
            if (ascending) lower = next; else upper = next;
            if (row.deleted) continue;
            if (row.document_ts === null || row.table_id === null || row.document_id === null
              || row.json_value === null || row.document_deleted !== false || row.document_ts !== row.ts
              || !bytesEqual(row.table_id, request.tableId)) {
              return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
            }
            const key = new Uint8Array(row.key_prefix.length + (row.key_suffix?.length ?? 0));
            key.set(row.key_prefix);
            if (row.key_suffix !== null) key.set(row.key_suffix, row.key_prefix.length);
            const document = documentFromRow({ ts: row.document_ts, table_id: row.table_id,
              id: row.document_id, json_value: row.json_value, deleted: false, prev_ts: row.prev_ts });
            const entry = Object.freeze({ key, document });
            if (key.length < MAX_INDEX_KEY_PREFIX_BYTES) {
              if (inInterval(key)) entries.push(entry);
            } else {
              bufferedPrefix = copyBytes(row.key_prefix);
              buffer.push(entry);
            }
          }
          // Do not release a page after retention could have deleted anchors
          // used by this read. The same validation covers buffered prefix groups.
          yield* retention.validateIndex(at);
          exhausted = parsed.length < pageSize;
          if (exhausted) flush();
        }
        const selected = entries.slice(0, request.maxResults);
        const last = selected.at(-1);
        // IndexReader::index_page returns After as soon as max_results is met;
        // it does not fetch an extra SQL page merely to prove exact exhaustion.
        const complete = exhausted && entries.length < request.maxResults;
        return Object.freeze({ entries: Object.freeze(selected), cursor: complete || last === undefined
          ? Object.freeze({ kind: "end" as const })
          : Object.freeze({ kind: "after" as const, key: copyBytes(last.key) }) });
      },
    );

    const persistence: CorePersistence = {
      retentionValidator: sqlRetention,
      loadIndexHistory: Effect.fn("CorePersistence.loadIndexHistory")(function* (input: CoreIndexHistoryRequest,
        retention: CoreRetentionValidator = sqlRetention): Effect.fn.Return<CoreIndexHistoryPage, CorePersistenceError> {
        const decoded = yield* decodeIndexHistoryRequest(input).pipe(Effect.mapError(invalid));
        const request = { ...decoded, index: { ...decoded.index, id: copyBytes(decoded.index.id) },
          tableId: copyBytes(decoded.tableId), interval: { start: decoded.interval.start === null ? null : copyBytes(decoded.interval.start),
            end: decoded.interval.end === null ? null : copyBytes(decoded.interval.end) }, after: decoded.after === undefined ? undefined
            : { keyPrefix: copyBytes(decoded.after.keyPrefix), keySha256: copyBytes(decoded.after.keySha256), ts: decoded.after.ts } };
        if (request.start > request.end) return yield* invalid("Reversed history timestamps");
        yield* retention.validateIndex(request.start);
        yield* retention.validateDocument(request.start);
        const parameters: CoreSqlParameter[] = [instance, request.index.id, request.start, request.end];
        const predicates = ["instance_name = $1", "index_id = $2"];
        for (const [bound, lower] of [[request.interval.start, true], [request.interval.end, false]] as const) {
          if (bound === null) continue;
          parameters.push(bound.slice(0, MAX_INDEX_KEY_PREFIX_BYTES), new Uint8Array(32).fill(lower ? 0 : 255));
          predicates.push(`(key_prefix, key_sha256) ${lower ? ">=" : "<="} ($${parameters.length - 1}, $${parameters.length})`);
        }
        if (request.after !== undefined) {
          parameters.push(request.after.keyPrefix, request.after.keySha256, request.after.ts);
          predicates.push(`(key_prefix, key_sha256, ts) > ($${parameters.length - 2}, $${parameters.length - 1}, $${parameters.length})`);
        }
        const pageSize = Math.min(request.maxResults, sqlPageSize ?? request.maxResults);
        parameters.push(pageSize, request.maxBytes, request.maxDocumentBytes);
        const n = parameters.length;
        // LIMIT applies to physical versions before time eligibility or joining.
        // The byte window prevents oversized suffix/body transfer, including a
        // coarse collision. No DISTINCT or same-prefix group buffering occurs.
        const rows = yield* driver.query(`WITH physical AS MATERIALIZED (
          SELECT ts, key_prefix, key_suffix, key_sha256, deleted, table_id, document_id
          FROM ${table("indexes")} WHERE ${predicates.join(" AND ")}
          ORDER BY key_prefix, key_sha256, ts LIMIT $${n - 2}
        ), measured AS (
          SELECT a.*, d.ts AS document_ts, d.table_id AS anchor_table_id, d.id AS anchor_document_id,
            d.json_value, d.deleted AS document_deleted, d.prev_ts,
            octet_length(a.key_prefix)::bigint + coalesce(octet_length(a.key_suffix), 0)::bigint AS key_bytes,
            coalesce(octet_length(d.json_value), 0)::bigint AS document_bytes
          FROM physical a LEFT JOIN ${table("documents")} d ON d.instance_name = $1
            AND a.ts >= $3 AND a.ts <= $4
            AND d.ts = a.ts AND d.table_id = a.table_id AND d.id = a.document_id
        ), bounded AS (
          SELECT *, sum(key_bytes + document_bytes + 128) OVER (ORDER BY key_prefix, key_sha256, ts
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) > $${n - 1}
            OR document_bytes > $${n} AS over_budget FROM measured
        ) SELECT ts::text AS ts, key_prefix, CASE WHEN over_budget THEN NULL ELSE key_suffix END AS key_suffix,
          key_sha256, deleted, table_id AS index_table_id, document_id AS index_document_id,
          document_ts::text AS document_ts, anchor_table_id AS table_id, anchor_document_id AS document_id,
          CASE WHEN over_budget THEN NULL ELSE json_value END AS json_value, document_deleted,
          prev_ts::text AS prev_ts, key_bytes::text AS key_bytes, document_bytes::text AS document_bytes, over_budget
          FROM bounded ORDER BY bounded.key_prefix, bounded.key_sha256, bounded.ts`, parameters);
        const parsed = yield* decodeIndexHistoryRows(rows);
        yield* retention.validateIndex(request.start);
        yield* retention.validateDocument(request.start);
        const keyBytes = parsed.reduce((sum, row) => sum + Number(row.key_bytes), 0);
        const documentBytes = parsed.reduce((sum, row) => sum + Number(row.document_bytes), 0);
        if (!Number.isSafeInteger(keyBytes) || !Number.isSafeInteger(documentBytes) || parsed.length > pageSize)
          return yield* new CorePersistenceError({ reason: "corruptData" });
        const overBudget = parsed.some(row => row.over_budget || row.document_bytes > BigInt(request.maxDocumentBytes))
          || keyBytes + documentBytes + parsed.length * 128 > request.maxBytes;
        let previous: CoreIndexHistoryCursor | undefined = request.after;
        for (const row of parsed) {
          const order = previous === undefined ? 1 : compareBytesLexicographically(row.key_prefix, previous.keyPrefix)
            || compareBytesLexicographically(row.key_sha256, previous.keySha256) || (row.ts > previous.ts ? 1 : row.ts < previous.ts ? -1 : 0);
          if (order <= 0)
            return yield* new CorePersistenceError({ reason: "corruptData", cause: "Physical history cursor did not advance" });
          if (row.deleted ? row.index_table_id !== null || row.index_document_id !== null || row.document_ts !== null
            : row.index_table_id === null || row.index_document_id === null || !bytesEqual(row.index_table_id, request.tableId))
            return yield* new CorePersistenceError({ reason: "corruptData", cause: "Physical history target header is invalid" });
          if ((row.ts < request.start || row.ts > request.end) && (row.document_ts !== null || row.table_id !== null
            || row.document_id !== null || row.json_value !== null || row.document_deleted !== null || row.prev_ts !== null || row.document_bytes !== 0n))
            return yield* new CorePersistenceError({ reason: "corruptData", cause: "Time-ineligible history header hydrated a document" });
          previous = { keyPrefix: row.key_prefix, keySha256: row.key_sha256, ts: row.ts };
        }
        const entries: CoreIndexHistoryEntry[] = [];
        if (!overBudget) for (const row of parsed) {
          const key = new Uint8Array(row.key_prefix.length + (row.key_suffix?.length ?? 0));
          key.set(row.key_prefix); if (row.key_suffix !== null) key.set(row.key_suffix, row.key_prefix.length);
          const split = splitIndexKey(key);
          if (row.key_bytes !== BigInt(key.length)
            || !bytesEqual(split.keyPrefix, row.key_prefix) || !bytesEqual(split.keySha256, row.key_sha256)
            || (split.keySuffix === null) !== (row.key_suffix === null)
            || row.deleted && (row.index_table_id !== null || row.index_document_id !== null || row.document_ts !== null))
            return yield* new CorePersistenceError({ reason: "corruptData" });
          if (row.ts < request.start || row.ts > request.end) continue;
          let document: CoreDocumentLogEntry | null = null;
          if (!row.deleted) {
            if (row.document_ts !== row.ts || row.table_id === null || row.document_id === null || row.json_value === null
              || row.document_deleted !== false || row.index_table_id === null || row.index_document_id === null
              || !bytesEqual(row.table_id, request.tableId) || !bytesEqual(row.index_table_id, row.table_id)
              || !bytesEqual(row.index_document_id, row.document_id) || row.document_bytes !== BigInt(row.json_value.length))
              return yield* new CorePersistenceError({ reason: "corruptData" });
            document = documentFromRow({ ts: row.document_ts, table_id: row.table_id, id: row.document_id,
              json_value: row.json_value, deleted: false, prev_ts: row.prev_ts });
          }
          entries.push(Object.freeze({ ts: row.ts, key, document }));
        }
        const last = parsed.at(-1);
        return Object.freeze({ entries: Object.freeze(entries), examined: parsed.length, keyBytes, documentBytes, overBudget,
          cursor: last === undefined ? null : Object.freeze({ keyPrefix: copyBytes(last.key_prefix), keySha256: copyBytes(last.key_sha256), ts: last.ts }),
          done: parsed.length < pageSize });
      }),
      evaluateRelational: Effect.fn("CorePersistence.evaluateRelational")(function* (batch) {
        const facts = yield* Effect.fromResult(inspectIssuedPostgresRelationalBatch(batch, relationalPersistenceFailure));
        const body = yield* Effect.fromResult(buildPostgresRelationalPredicateBody(batch, facts.tableId, relationalPersistenceFailure));
        const query = relationalDialect.sqlToQuery(body);
        const parameters: readonly CoreSqlParameter[] = yield* decodeSqlParameters(query.params).pipe(Effect.mapError(invalid));
        // This closed renderer emits only captured JSON, column keys and scalar
        // operands. Output has exactly one ordinal/Boolean pair per input row.
        return yield* driver.query(query.sql, parameters);
      }),
      loadDocuments: Effect.fn("CorePersistence.loadDocuments")(function* (input: CoreDocumentLogRequest,
        retention: CoreRetentionValidator = sqlRetention) {
        const request = yield* decodeDocumentLogRequest(input).pipe(Effect.mapError(invalid));
        if (request.start > request.end) return yield* Effect.fail(invalid("Reversed timestamp range"));
        const parameters: CoreSqlParameter[] = [instance, request.start, request.end];
        const predicates = ["instance_name = $1", "ts >= $2", "ts <= $3"];
        if (request.tableId !== undefined) { parameters.push(copyBytes(request.tableId)); predicates.push(`table_id = $${parameters.length}`); }
        if (request.after !== undefined) {
          parameters.push(request.after.ts, copyBytes(request.after.tableId), copyBytes(request.after.id));
          const n = parameters.length;
          predicates.push(`(ts, table_id, id) ${request.order === "asc" ? ">" : "<"} ($${n - 2}, $${n - 1}, $${n})`);
        }
        parameters.push(Math.min(request.maxResults, sqlPageSize ?? request.maxResults));
        const order = request.order === "asc" ? "ASC" : "DESC";
        const rows = yield* driver.query(`SELECT ts::text AS ts, table_id, id, json_value, deleted, prev_ts::text AS prev_ts
          FROM ${table("documents")} WHERE ${predicates.join(" AND ")}
          ORDER BY ${table("documents")}.ts ${order}, table_id ${order}, id ${order} LIMIT $${parameters.length}`, parameters);
        const decoded = yield* decodeDocumentRows(rows);
        // The oldest requested timestamp witnesses retention, even when SQL returned no rows.
        yield* retention.validateDocument(request.start);
        const documents = decoded.map(documentFromRow);
        const last = documents.at(-1);
        return Object.freeze({ documents: Object.freeze(documents), done: documents.length < Number(parameters.at(-1)),
          cursor: last === undefined ? null : Object.freeze({ ts: last.ts, tableId: last.tableId.slice(), id: last.id.slice() }) });
      }),
      previousRevisions: Effect.fn("CorePersistence.previousRevisions")(function* (
        input: readonly CorePreviousRevisionSearch[], retention: CoreRetentionValidator = sqlRetention) {
        const capturedQueries = (yield* decodePreviousSearches(input).pipe(Effect.mapError(invalid)))
          .map(query => Object.freeze({ ...query, tableId: copyBytes(query.tableId), id: copyBytes(query.id) })).toSorted(comparePreviousSearches);
        // Source accepts a BTreeSet: equal searches are one request, regardless of byte-array identity.
        const queries = capturedQueries.filter((query, index) => {
          const previous = capturedQueries[index - 1];
          return previous === undefined || comparePreviousSearches(query, previous) !== 0;
        });
        if (queries.length === 0) return Object.freeze([]);
        const chunks: Array<readonly CorePreviousRevisionSearch[]> = [];
        let offset = 0;
        for (; offset + 8 <= queries.length; offset += 8) chunks.push(queries.slice(offset, offset + 8));
        for (; offset < queries.length; offset += 1) chunks.push(queries.slice(offset, offset + 1));
        return yield* driver.withConnection(connection => Effect.gen(function* () {
          // Pinned db914cf06 postgres/lib.rs previous_revisions: eight-way groups, single remainder requests,
          // and sixteen lazy query futures on one checkout. The transport owns actual wire pipelining.
          const groups = yield* Stream.fromIterable(chunks).pipe(Stream.mapEffect(chunk => Effect.gen(function* () {
            const parameters: CoreSqlParameter[] = [instance];
            const selects = chunk.map(query => {
              parameters.push(query.tableId, query.id, query.ts);
              const n = parameters.length;
              return `SELECT $${n}::bigint::text AS query_ts, ts::text AS ts, table_id, id, json_value, deleted, prev_ts::text AS prev_ts
                FROM ${table("documents")} WHERE instance_name = $1 AND table_id = $${n - 2} AND id = $${n - 1} AND ts < $${n}
                ORDER BY ${table("documents")}.ts DESC LIMIT 1`;
            });
            const statement = chunk.length === 1 ? selects[0]
              : `WITH ${selects.map((select, index) => `q${index + 1} AS (${select})`).join(", ")}
                ${selects.map((_, index) => `SELECT * FROM q${index + 1}`).join(" UNION ALL ")}`;
            if (statement === undefined) return yield* Effect.die(new Error("Nonempty history request lost its statement"));
            const rows = yield* connection.query(statement, parameters);
            const decoded = yield* decodePreviousRevisionRows(rows);
            const seen = new Set<CorePreviousRevisionSearch>();
            const result: CorePreviousRevision<CorePreviousRevisionSearch>[] = [];
            for (const row of decoded) {
              const query = chunk.find(value => value.ts === row.query_ts && row.ts < value.ts
                && bytesEqual(value.tableId, row.table_id) && bytesEqual(value.id, row.id));
              if (query === undefined || seen.has(query))
                return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
              seen.add(query);
              result.push(Object.freeze({ query, document: documentFromRow(row) }));
            }
            return result;
          }), { concurrency: 16, unordered: false }), Stream.runCollect);
          const witness = queries.reduce((min, query) => query.ts < min ? query.ts : min, queries[0]?.ts ?? 0n);
          if (retention === sqlRetention) {
            // Like the existing exact predecessor reader, reuse this checkout for its post-I/O floor check.
            const floor = yield* globalTimestamp(connection, "document_min_snapshot_ts");
            if (witness < floor) return yield* Effect.fail(new CorePersistenceError({ reason: "outOfRetention" }));
          } else yield* retention.validateDocument(witness);
          return Object.freeze(groups.flat().toSorted((left, right) => comparePreviousSearches(left.query, right.query)));
        }));
      }),
      previousRevisionsOfDocuments: Effect.fn("CorePersistence.previousRevisionsOfDocuments")(function* (
        input: readonly CorePreviousRevisionQuery[], retention: CoreRetentionValidator = sqlRetention) {
        const queries = (yield* decodePreviousQueries(input).pipe(Effect.mapError(invalid)))
          .map(query => ({ ...query, tableId: copyBytes(query.tableId), id: copyBytes(query.id) }));
        if (queries.some(query => query.prevTs >= query.ts)) return yield* Effect.fail(invalid("Predecessor must precede its retention witness"));
        return yield* driver.withConnection(connection => Effect.gen(function* () {
          const result: CorePreviousRevision[] = [];
          // Source batches eight exact lookups; this read lifetime never opens a SQL transaction.
          for (let offset = 0; offset < queries.length; offset += 8) {
            const chunk = queries.slice(offset, offset + 8);
            const parameters: CoreSqlParameter[] = [instance];
            const selects = chunk.map(query => {
              parameters.push(query.ts, query.tableId, query.id, query.prevTs);
              const n = parameters.length;
              return `(SELECT $${n - 3}::bigint::text AS query_ts, ts::text AS ts, table_id, id, json_value, deleted, prev_ts::text AS prev_ts
                FROM ${table("documents")} WHERE instance_name = $1 AND table_id = $${n - 2} AND id = $${n - 1} AND ts = $${n})`;
            });
            const rows = yield* connection.query(selects.join(" UNION ALL "), parameters);
            const decoded = yield* decodePreviousRevisionRows(rows);
            for (const row of decoded) {
              const query = chunk.find(value => value.ts === row.query_ts && value.prevTs === row.ts
                && bytesEqual(value.tableId, row.table_id) && bytesEqual(value.id, row.id));
              if (query === undefined) return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
              result.push(Object.freeze({ query, document: documentFromRow(row) }));
            }
          }
          if (queries.length > 0) {
            const witness = queries.reduce((min, query) => query.ts < min ? query.ts : min, queries[0]?.ts ?? 0n);
            if (retention === sqlRetention) {
              // Validate the minimum witness after ALL exact fetches, reusing this checkout even in a size-one pool.
              const floor = yield* globalTimestamp(connection, "document_min_snapshot_ts");
              if (witness < floor) return yield* Effect.fail(new CorePersistenceError({ reason: "outOfRetention" }));
            } else yield* retention.validateDocument(witness);
          }
          return Object.freeze(result);
        }));
      }),
      acquireLease: Effect.fn("CorePersistence.acquireLease")(function* () {
        const token = yield* options.leaseTimestamp ?? Clock.currentTimeNanos;
        yield* decodeTimestamp(token).pipe(Effect.mapError(invalid));
        yield* driver.query(`INSERT INTO ${table("leases")} (instance_name, ts) VALUES ($1, 0) ON CONFLICT DO NOTHING`, [instance]);
        const rows = yield* driver.query(`UPDATE ${table("leases")} SET ts = $2 WHERE instance_name = $1 AND ts < $2
          AND NOT EXISTS (SELECT 1 FROM ${table("read_only")} WHERE instance_name = $1) RETURNING ts`, [instance, token]);
        if (rows.length !== 1) {
          const readOnly = yield* driver.query(`SELECT 1 FROM ${table("read_only")} WHERE instance_name = $1`, [instance]);
          return yield* Effect.fail(new CorePersistenceError({ reason: readOnly.length > 0 ? "readOnly" : "leaseLost" }));
        }
        const lease = Object.freeze({ token });
        issuedLeases.add(lease);
        return lease;
      }),
      isFresh: Effect.fn("CorePersistence.isFresh")((lease: CorePersistenceLease) => fenced(lease,
        connection => Effect.gen(function* () {
          const rows = yield* connection.query(`SELECT
            EXISTS (SELECT 1 FROM ${table("documents")} WHERE instance_name = $1) AS documents,
            EXISTS (SELECT 1 FROM ${table("indexes")} WHERE instance_name = $1) AS indexes`, [instance]);
          const decoded = yield* decodeFreshness(rows);
          if (decoded.length !== 1 || decoded[0] === undefined) {
            return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
          }
          const repeatable = yield* globalTimestamp(connection, "max_repeatable_ts");
          return !decoded[0].documents && !decoded[0].indexes && repeatable === 0n;
        }),
      )),
      latestTimestamp: Effect.fn("CorePersistence.latestTimestamp")((lease: CorePersistenceLease) => fenced(lease,
        connection => Effect.gen(function* () {
          const rows = yield* connection.query(`SELECT max(ts)::text AS ts FROM ${table("documents")} WHERE instance_name = $1`, [instance]);
          const decoded = yield* decodeLatest(rows);
          if (decoded.length !== 1) return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
          const latest = decoded[0]?.ts ?? 0n;
          const repeatable = yield* globalTimestamp(connection, "max_repeatable_ts");
          return latest > repeatable ? latest : repeatable;
        }),
      )),
      readRetentionBounds: Effect.fn("CorePersistence.readRetentionBounds")((lease: CorePersistenceLease) => fenced(lease,
        connection => Effect.gen(function* () {
          const indexMinimumTimestamp = yield* globalTimestamp(connection, "min_snapshot_ts");
          const documentMinimumTimestamp = yield* globalTimestamp(connection, "document_min_snapshot_ts");
          return Object.freeze({ indexMinimumTimestamp, documentMinimumTimestamp });
        }),
      )),
      readSnapshot: Effect.fn("CorePersistence.readSnapshot")(function* (at: bigint, retention: CoreRetentionValidator = sqlRetention) {
        yield* decodeTimestamp(at).pipe(Effect.mapError(invalid));
        yield* retention.validateIndex(at);
        return Object.freeze({ timestamp: at,
          get: Effect.fn("CorePersistence.get")(function* (tableId: Uint8Array, id: Uint8Array) {
            const decoded = yield* decodePoint({ tableId, id })
              .pipe(Effect.mapError(invalid));
            const rows = yield* driver.query(`SELECT ts::text AS ts, table_id, id, json_value, deleted, prev_ts::text AS prev_ts
              FROM ${table("documents")} WHERE instance_name = $1 AND table_id = $2 AND id = $3 AND ts <= $4
              ORDER BY ${table("documents")}.ts DESC LIMIT 1`, [instance, copyBytes(decoded.tableId), copyBytes(decoded.id), at]);
            const stored = yield* decodeDocumentRows(rows);
            yield* retention.validateDocument(at);
            return stored[0] === undefined ? Option.none<CoreDocumentLogEntry>() : Option.some(documentFromRow(stored[0]));
          }),
          scan: (request: CoreIndexScan) => scan(at, request, retention),
        });
      }),
      write: (lease, batch) => writeBatch(lease, batch),
      writeIndexBackfill: (lease, indexes) => writeBatch(lease, { documents: [], indexes }, true),
      // PostgreSQL's row-version layout needs no physical reconciliation. The
      // mode-changing metadata write that follows still uses the ordinary fence.
      reconcileIndexBackfill: lease => Effect.suspend(() => !issuedLeases.has(lease)
        ? Effect.fail(new CorePersistenceError({ reason: "invalidTarget" }))
        : lostLeases.has(lease) ? Effect.fail(new CorePersistenceError({ reason: "leaseLost" }))
        : Effect.void),
      getGlobal: key => readGlobal(driver, key),
      putGlobal: Effect.fn("CorePersistence.putGlobal")(function* (lease: CorePersistenceLease, key: string, value: Uint8Array) {
        const bytes = copyBytes(value);
        yield* fenced(lease, connection => connection.query(`INSERT INTO ${table("persistence_globals")}
          (instance_name, key, json_value) VALUES ($1, $2, $3)
          ON CONFLICT (instance_name, key) DO UPDATE SET json_value = excluded.json_value`, [instance, key, bytes]));
      }),
    };
    return Object.freeze(persistence);
  },
);
