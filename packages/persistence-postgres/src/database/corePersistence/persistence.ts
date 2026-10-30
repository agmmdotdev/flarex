import { Clock, Effect, Option, Schema } from "effect";
import { bytesEqual, compareBytesLexicographically, copyBytes } from "@flarex/utils/bytes";
import { MAX_INDEX_KEY_PREFIX_BYTES, splitIndexKey } from "flarex-protocol/index-key";
import {
  CorePersistenceError,
  type CoreDocumentLogEntry,
  type CoreHydratedIndexEntry,
  type CoreIndexPage,
  type CoreIndexScan,
  type CorePersistence,
  type CorePersistenceIndexEntry,
  type CorePersistenceLease,
  type CoreRetentionValidator,
  type CoreWriteBatch,
} from "../../core/contracts";
import type { CoreSqlConnection, CoreSqlParameter } from "./driver";
import { coreTableName, inspectCorePersistenceTarget, type CorePersistenceTarget } from "./target";
import {
  decodeDocumentRows, decodeIndexRows, documentFromRow, makeStoredRowsDecoder,
  internalIdSchema, timestampSchema,
} from "./rows";

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
const decodeScan = Schema.decodeUnknownEffect(scanSchema);
const decodeBatch = Schema.decodeUnknownEffect(batchSchema);
const decodePoint = Schema.decodeUnknownEffect(pointSchema);
const decodeGlobals = makeStoredRowsDecoder(globalsSchema);
const decodeLatest = makeStoredRowsDecoder(latestSchema);
const decodeFreshness = makeStoredRowsDecoder(freshnessSchema);
const jsonNull = new TextEncoder().encode("null");

function invalid(cause: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "invalidTarget", cause });
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
        // PostgreSQL's bind-parameter ceiling bounds each statement; all chunks
        // remain inside this logical batch's one fenced SQL transaction.
        const chunkSize = Math.floor(60_000 / columns.length);
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
              ORDER BY ts DESC LIMIT 1`, [instance, copyBytes(decoded.tableId), copyBytes(decoded.id), at]);
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
