import { DurableObject } from "cloudflare:workers";
import { encodeFlarexId, parseFlarexId } from "flarex/ids";
import { isWritableJsonObject } from "flarex-protocol/json";
import {
  badRequestErrorToHttpError,
  errorResponse,
  HttpError,
  json,
} from "./http";
import { indexKeyForDocument } from "./indexKeys";
import { findReadSetConflict, isOccConflict } from "./occ";
import {
  decodePartitionCommitRequest,
  decodePartitionConnectionUnregisterRequest,
  decodePartitionDocumentReadSearchParams,
  decodePartitionIndexReadSearchParams,
  decodePartitionSchemaCacheRequest,
  decodePartitionSubscriptionRegistrationRequest,
  decodePartitionSubscriptionTargetRequest,
  PartitionRoutePayloadError,
  type PartitionRouteError,
  type PartitionConnectionUnregisterRequest,
  type PartitionDocumentReadRequest,
  type PartitionIndexReadRequest,
  type PartitionSchemaCacheRequest,
  type PartitionSubscriptionRegistrationRequest,
  type PartitionSubscriptionTargetRequest,
} from "./partition/RouteBoundary";
import {
  decodePartitionStorageCommitResponseJson,
  decodePartitionStorageCommittedWritesJson,
  decodePartitionStorageDocumentJson,
  decodePartitionStorageIndexFieldsJson,
  decodePartitionStorageIndexWritesJson,
  decodePartitionStorageReadSetJson,
  decodePartitionStorageTablePlacementJson,
  decodePartitionStorageTableValidatorJson,
} from "./partition/StorageRows";
import { Data, Effect } from "effect";
import type {
  BeginResponse,
  CommitRequest,
  CommitResponse,
  CommittedWrite,
  DocumentReadResponse,
  DocumentWrite,
  Env,
  IndexReadResponse,
  IndexWrite,
  Json,
  ReadSet,
  SchemaIndex,
  TablePlacement,
  StoredDocument,
  ValidatorJson,
} from "./types";
import { BackendValidationError, validateJsonValue } from "./validation";

type WriteLogRow = {
  ts: number;
  writes_json: string;
  index_writes_json: string;
};

type CurrentDocumentRow = {
  table_id: number;
  id: string;
  ts: number;
  json_value: string;
};

type IndexRow = {
  index_id: number;
  table_id: number;
  index_name: string;
  fields_json: string;
  state: string;
};

type SubscriptionRow = {
  connection_name: string;
  query_id: number;
  read_set_json: string;
};

type SubscriptionInvalidation = {
  connectionName: string;
  queryId: number;
  invalidatedTs: number;
};

type ResolvedDocumentWrite = DocumentWrite & { id: string };

type PartitionOwnerChange = {
  tableId: number;
  tableName: string;
  ownerField: string;
  ownerValue: string;
  documentId: string;
};

type PartitionOwnerChanges = {
  claims: PartitionOwnerChange[];
  releases: PartitionOwnerChange[];
};

export class PartitionDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tables (
        table_id INTEGER PRIMARY KEY,
        table_name TEXT NOT NULL,
        state TEXT NOT NULL,
        schema_json TEXT,
        partition_rule_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexes (
        index_id INTEGER PRIMARY KEY,
        table_id INTEGER NOT NULL,
        index_name TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS documents (
        table_id INTEGER NOT NULL,
        id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        json_value TEXT,
        deleted INTEGER NOT NULL,
        prev_ts INTEGER,
        PRIMARY KEY (ts, table_id, id)
      );
      CREATE INDEX IF NOT EXISTS documents_by_table_id_ts
        ON documents(table_id, id, ts DESC);
      CREATE TABLE IF NOT EXISTS current_documents (
        table_id INTEGER NOT NULL,
        id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        json_value TEXT NOT NULL,
        PRIMARY KEY (table_id, id)
      );
      CREATE INDEX IF NOT EXISTS current_documents_by_table
        ON current_documents(table_id, id);
      CREATE TABLE IF NOT EXISTS partition_owners (
        table_id INTEGER NOT NULL,
        owner_field TEXT NOT NULL,
        owner_value TEXT NOT NULL,
        document_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        PRIMARY KEY (table_id, owner_field, owner_value)
      );
      CREATE TABLE IF NOT EXISTS index_entries (
        index_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        document_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        deleted INTEGER NOT NULL,
        PRIMARY KEY (index_id, key, document_id, ts)
      );
      CREATE INDEX IF NOT EXISTS index_entries_by_index_key
        ON index_entries(index_id, key, ts DESC);
      CREATE TABLE IF NOT EXISTS current_index_entries (
        index_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        document_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        PRIMARY KEY (index_id, key, document_id)
      );
      CREATE TABLE IF NOT EXISTS write_log (
        ts INTEGER PRIMARY KEY,
        source TEXT,
        writes_json TEXT NOT NULL,
        index_writes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        committed_ts INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_subscriptions (
        connection_name TEXT NOT NULL,
        query_id INTEGER NOT NULL,
        read_set_json TEXT NOT NULL,
        PRIMARY KEY (connection_name, query_id)
      );
    `);
    this.setMetaIfMissing("current_ts", "0");
    this.setMetaIfMissing("schema_version", "0");
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      return await runPartitionRoute(routePartitionDurableObject(request, url, {
        health: () => ({
          service: "flarex-partition",
          status: "ok",
          currentTs: this.currentTs(),
          schemaVersion: this.schemaVersion(),
          partitionKey: this.partitionKey(),
        }),
        currentTs: () => this.currentTs(),
        putSchemaCache: body => this.putSchemaCache(body),
        begin: () => this.begin(),
        commit: body => this.commitEffect(body),
        registerSubscription: body => this.registerSubscription(body),
        unregisterSubscription: body => this.unregisterSubscription(body),
        unregisterConnection: body => this.unregisterConnection(body),
        readDocument: (tableId, id, at) => this.readDocumentEffect(tableId, id, at),
        readIndex: (indexId, at, lower, upper, limit, cursor, order) =>
          this.readIndexEffect(indexId, at, lower, upper, limit, cursor, order),
      }));
    } catch (error) {
      if (isOccConflict(error)) return json(error, { status: 409 });
      return errorResponse(error);
    }
  }

  private begin(): BeginResponse {
    return { beginTs: this.currentTs(), schemaVersion: this.schemaVersion() };
  }

  private async putSchemaCache(
    body: PartitionSchemaCacheRequest,
  ): Promise<{ schemaVersion: number }> {
    const schemaCandidate = body.schema ?? body;
    const partitionKey = body.partitionKey;
    if (typeof partitionKey !== "string" || partitionKey.length === 0) {
      throw partitionDomainValidationError("partitionKey must be provided with schema-cache.");
    }
    if (
      typeof schemaCandidate.version !== "number" ||
      !Array.isArray(schemaCandidate.tables) ||
      !Array.isArray(schemaCandidate.indexes)
    ) {
      throw partitionDomainValidationError("schema-cache requires a deployment schema.");
    }
    const schema = {
      version: schemaCandidate.version,
      tables: schemaCandidate.tables,
      indexes: schemaCandidate.indexes,
    };
    return this.ctx.storage.transaction(async () => {
      this.sql.exec("DELETE FROM indexes");
      this.sql.exec("DELETE FROM tables");
      for (const table of schema.tables) {
        this.sql.exec(
          `
          INSERT INTO tables (table_id, table_name, state, schema_json, partition_rule_json)
          VALUES (?, ?, ?, ?, ?)
          `,
          table.tableId,
          table.name,
          table.state ?? "active",
          JSON.stringify(table.validator ?? null),
          JSON.stringify(table.placement),
        );
      }
      for (const index of schema.indexes) {
        this.sql.exec(
          `
          INSERT INTO indexes (index_id, table_id, index_name, fields_json, state)
          VALUES (?, ?, ?, ?, ?)
          `,
          index.indexId,
          index.tableId,
          index.name,
          JSON.stringify(index.fields),
          index.state ?? "enabled",
        );
      }
      this.setMeta("schema_version", String(schema.version));
      this.setMeta("partition_key", partitionKey);
      return { schemaVersion: schema.version };
    });
  }

  private commitEffect(request: CommitRequest): Effect.Effect<CommitResponse, unknown> {
    const self = this;
    return Effect.gen(function* () {
      const idempotencyKey = request.idempotencyKey;
      if (idempotencyKey) {
        const cached = self.sql
          .exec<{ result_json: string }>(
            "SELECT result_json FROM idempotency_keys WHERE key = ?",
            idempotencyKey,
          )
          .toArray()[0];
        if (cached) {
          const decoded = yield* decodePartitionStorageCommitResponseJson(cached.result_json);
          return { ...decoded, replayed: true };
        }
      }

      const result = yield* runPartitionStorageTransactionEffect(
        self.ctx,
        Effect.gen(function* () {
          const currentTs = self.currentTs();
          if (request.beginTs > currentTs) {
            return yield* Effect.fail(
              new Error(`beginTs ${request.beginTs} is newer than currentTs ${currentTs}.`),
            );
          }
          if (request.schemaVersion !== undefined && request.schemaVersion !== self.schemaVersion()) {
            return yield* Effect.fail(
              new Error(
                `Schema version mismatch. Request has ${request.schemaVersion}, partition has ${self.schemaVersion()}.`,
              ),
            );
          }
          const writes = request.writes.map(resolveDocumentWrite);
          const partitionOwnerChanges = yield* self.validateWritesEffect(writes);
          yield* self.validateReadSetEffect(request.readSet ?? {}, request.beginTs, currentTs);

          const commitTs = currentTs + 1;
          const committedWrites: CommittedWrite[] = [];
          const indexWrites: IndexWrite[] = [];
          for (const write of writes) {
            const committed = yield* self.applyDocumentWriteEffect(write, commitTs);
            committedWrites.push(committed.write);
            indexWrites.push(...committed.indexWrites);
          }
          self.applyPartitionOwnerChanges(partitionOwnerChanges, commitTs);

          self.sql.exec(
              `
              INSERT INTO write_log (ts, source, writes_json, index_writes_json, created_at)
              VALUES (?, ?, ?, ?, ?)
              `,
              commitTs,
              request.source ?? null,
              JSON.stringify(committedWrites),
              JSON.stringify(indexWrites),
              Date.now(),
            );
          self.setMeta("current_ts", String(commitTs));
          const response: CommitResponse = { committedTs: commitTs, writes: committedWrites };
          if (idempotencyKey) {
            self.sql.exec(
              `
              INSERT INTO idempotency_keys (key, result_json, committed_ts, created_at)
              VALUES (?, ?, ?, ?)
              `,
              idempotencyKey,
              JSON.stringify(response),
              commitTs,
              Date.now(),
            );
          }
          return {
            response,
            invalidations: yield* self.invalidatedSubscriptionsEffect(
              commitTs,
              committedWrites,
              indexWrites,
            ),
          };
          }),
      );
      yield* Effect.tryPromise({
        try: () => self.notifyInvalidations(result.invalidations),
        catch: cause => cause,
      });
      return result.response;
    });
  }

  private registerSubscription(
    request: PartitionSubscriptionRegistrationRequest,
  ): { registered: true } {
    this.sql.exec(
      `
      INSERT INTO sync_subscriptions (connection_name, query_id, read_set_json)
      VALUES (?, ?, ?)
      ON CONFLICT(connection_name, query_id) DO UPDATE SET
        read_set_json = excluded.read_set_json
      `,
      request.connectionName,
      request.queryId,
      JSON.stringify(request.readSet),
    );
    return { registered: true };
  }

  private unregisterSubscription(
    request: PartitionSubscriptionTargetRequest,
  ): { unregistered: true } {
    this.sql.exec(
      "DELETE FROM sync_subscriptions WHERE connection_name = ? AND query_id = ?",
      request.connectionName,
      request.queryId,
    );
    return { unregistered: true };
  }

  private unregisterConnection(
    request: PartitionConnectionUnregisterRequest,
  ): { unregistered: true } {
    this.sql.exec(
      "DELETE FROM sync_subscriptions WHERE connection_name = ?",
      request.connectionName,
    );
    return { unregistered: true };
  }

  private invalidatedSubscriptionsEffect(
    commitTs: number,
    writes: CommittedWrite[],
    indexWrites: IndexWrite[],
  ): Effect.Effect<SubscriptionInvalidation[], unknown> {
    if (writes.length === 0 && indexWrites.length === 0) return Effect.succeed([]);
    const self = this;
    return Effect.gen(function* () {
      const rows = self.sql
        .exec<SubscriptionRow>(
          `
          SELECT connection_name, query_id, read_set_json
          FROM sync_subscriptions
          ORDER BY connection_name, query_id
          `,
        )
        .toArray();
      const invalidationGroups = yield* Effect.forEach(rows, row =>
        decodePartitionStorageReadSetJson(row.read_set_json).pipe(
          Effect.map(readSet => {
            const conflict = findReadSetConflict(readSet, [
              { ts: commitTs, writes, indexWrites },
            ]);
            return conflict === null
              ? []
              : [{
                  connectionName: row.connection_name,
                  queryId: row.query_id,
                  invalidatedTs: commitTs,
                }];
          }),
        ));
      return invalidationGroups.flat();
    });
  }

  private async notifyInvalidations(invalidations: SubscriptionInvalidation[]): Promise<void> {
    await Promise.all(invalidations.map(invalidation => {
      const connection = this.env.CONNECTIONS.getByName(invalidation.connectionName);
      return connection.fetch("https://flarex.internal/invalidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invalidation),
      });
    }));
  }

  private validateWritesEffect(writes: ResolvedDocumentWrite[]): Effect.Effect<PartitionOwnerChanges, unknown> {
    if (this.schemaVersion() === 0) return Effect.succeed({ claims: [], releases: [] });
    const claims = new Map<string, PartitionOwnerChange>();
    const releases = new Map<string, PartitionOwnerChange>();
    const self = this;
    return Effect.gen(function* () {
      for (const write of writes) {
        const row = self.sql
          .exec<{
            table_name: string;
            schema_json: string | null;
            partition_rule_json: string;
          }>(
            "SELECT table_name, schema_json, partition_rule_json FROM tables WHERE table_id = ? AND state != 'deleted'",
            write.tableId,
          )
          .toArray()[0];
        if (!row) {
          return yield* Effect.fail(
            partitionDomainValidationError(`Write references unknown table id ${write.tableId}.`),
          );
        }
        const placement = yield* decodePartitionStorageTablePlacementJson(row.partition_rule_json);
        if (write.value === null) {
          const current = yield* self.getCurrentDocumentEffect(write.tableId, write.id);
          if (current !== null) {
            yield* self.validateDocumentPlacementEffect(row.table_name, placement, current.value);
            const ownerField = rootOwnerFieldForPlacement(placement);
            if (ownerField !== null) {
              const ownerValue = documentOwnerValue(row.table_name, ownerField, current.value);
              const release = {
                tableId: write.tableId,
                tableName: row.table_name,
                ownerField,
                ownerValue,
                documentId: write.id,
              };
              releases.set(partitionOwnerKey(release), release);
            }
          }
          continue;
        }
        const validator = yield* decodePartitionStorageTableValidatorJson(row.schema_json ?? "null");
        if (validator !== null) {
          yield* Effect.try({
            try: () => validateJsonValue(validator, write.value, `$document(${row.table_name})`, {
              validateId: self.validateId.bind(self),
            }),
            catch: error => error instanceof BackendValidationError
              ? partitionDomainValidationError(`DocumentValidationError: ${error.message}`)
              : error,
          });
        }
        yield* self.validateDocumentPlacementEffect(row.table_name, placement, write.value);
        const ownerField = rootOwnerFieldForPlacement(placement);
        if (ownerField !== null) {
          const ownerValue = documentOwnerValue(row.table_name, ownerField, write.value);
          const claim = {
            tableId: write.tableId,
            tableName: row.table_name,
            ownerField,
            ownerValue,
            documentId: write.id,
          };
          const key = partitionOwnerKey(claim);
          const existingClaim = claims.get(key);
          if (existingClaim !== undefined && existingClaim.documentId !== write.id) {
            return yield* Effect.fail(partitionDomainValidationError(
              `UniquePartitionOwnerError: ${row.table_name}.${ownerField} ${JSON.stringify(ownerValue)} is claimed by multiple documents in this commit.`,
            ));
          }
          claims.set(key, claim);
        }
      }
      for (const [key, claim] of claims) {
        const existing = self.sql
          .exec<{ document_id: string }>(
            `
            SELECT document_id
            FROM partition_owners
            WHERE table_id = ? AND owner_field = ? AND owner_value = ?
            `,
            claim.tableId,
            claim.ownerField,
            claim.ownerValue,
          )
          .toArray()[0];
        const released = releases.get(key);
        if (
          existing !== undefined &&
          existing.document_id !== claim.documentId &&
          existing.document_id !== released?.documentId
        ) {
          return yield* Effect.fail(partitionDomainValidationError(
            `UniquePartitionOwnerError: ${claim.tableName}.${claim.ownerField} ${JSON.stringify(claim.ownerValue)} already belongs to document ${existing.document_id}.`,
          ));
        }
      }
      return { claims: Array.from(claims.values()), releases: Array.from(releases.values()) };
    });
  }

  private validateDocumentPlacementEffect(
    tableName: string,
    placement: TablePlacement,
    value: Json,
  ): Effect.Effect<void, PartitionDomainValidationError> {
    const placementField = ownerFieldForPlacement(placement);
    if (placementField === null) return Effect.void;
    const partitionKey = this.partitionKey();
    if (partitionKey === null) {
      return Effect.fail(partitionDomainValidationError("Partition placement validation requires a cached partitionKey."));
    }
    if (!isWritableJsonObject(value)) {
      return Effect.fail(partitionDomainValidationError(
        `PlacementValidationError: $document(${tableName}) must be an object for placement validation.`,
      ));
    }
    const placementValue = value[placementField];
    if (typeof placementValue !== "string" || placementValue.length === 0) {
      return Effect.fail(partitionDomainValidationError(
        `PlacementValidationError: $document(${tableName}).${placementField} must be a non-empty string matching partitionKey.`,
      ));
    }
    if (placementValue !== partitionKey) {
      return Effect.fail(partitionDomainValidationError(
        `PlacementValidationError: $document(${tableName}).${placementField} must match partitionKey ${partitionKey}.`,
      ));
    }
    return Effect.void;
  }

  private validateId(expectedTableName: string, id: string, path: string): void {
    const parsed = parseFlarexId(id);
    if (parsed === null) {
      throw new BackendValidationError(`Expected an ID for table ${expectedTableName}.`, path);
    }
    const row = this.sql
      .exec<{ table_name: string }>(
        "SELECT table_name FROM tables WHERE table_id = ? AND state != 'deleted'",
        parsed.tableId,
      )
      .toArray()[0];
    if (!row) {
      throw new BackendValidationError(
        `ID references unknown table id ${parsed.tableId}; expected table ${expectedTableName}.`,
        path,
      );
    }
    if (row.table_name !== expectedTableName) {
      throw new BackendValidationError(
        `Expected an ID for table ${expectedTableName}, got an ID for table ${row.table_name}.`,
        path,
      );
    }
  }

  private applyDocumentWriteEffect(
    write: ResolvedDocumentWrite,
    commitTs: number,
  ): Effect.Effect<{ write: CommittedWrite; indexWrites: IndexWrite[] }, unknown> {
    const self = this;
    return Effect.gen(function* () {
      const id = write.id;
      const previous = yield* self.getCurrentDocumentEffect(write.tableId, id);
      const prevTs = previous?.ts ?? null;
      const indexWrites: IndexWrite[] = [];

      if (previous) {
        indexWrites.push(...(yield* self.deleteIndexEntriesEffect(write.tableId, id, previous.value, commitTs)));
      }

      self.sql.exec(
        `
        INSERT INTO documents (table_id, id, ts, json_value, deleted, prev_ts)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        write.tableId,
        id,
        commitTs,
        write.value === null ? null : JSON.stringify(write.value),
        write.value === null ? 1 : 0,
        prevTs,
      );

      if (write.value === null) {
        self.sql.exec(
          "DELETE FROM current_documents WHERE table_id = ? AND id = ?",
          write.tableId,
          id,
        );
      } else {
        self.sql.exec(
          `
          INSERT INTO current_documents (table_id, id, ts, json_value)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(table_id, id) DO UPDATE SET
            ts = excluded.ts,
            json_value = excluded.json_value
          `,
          write.tableId,
          id,
          commitTs,
          JSON.stringify(write.value),
        );
        indexWrites.push(...(yield* self.insertIndexEntriesEffect(write.tableId, id, write.value, commitTs)));
      }

      return {
        write: {
          tableId: write.tableId,
          id,
          prevTs,
          ts: commitTs,
          value: write.value,
        },
        indexWrites,
      };
    });
  }

  private applyPartitionOwnerChanges(changes: PartitionOwnerChanges, commitTs: number): void {
    const claimedKeys = new Set(changes.claims.map(partitionOwnerKey));
    for (const release of changes.releases) {
      if (claimedKeys.has(partitionOwnerKey(release))) continue;
      this.sql.exec(
        `
        DELETE FROM partition_owners
        WHERE table_id = ?
          AND owner_field = ?
          AND owner_value = ?
          AND document_id = ?
        `,
        release.tableId,
        release.ownerField,
        release.ownerValue,
        release.documentId,
      );
    }
    for (const claim of changes.claims) {
      this.sql.exec(
        `
        INSERT INTO partition_owners (table_id, owner_field, owner_value, document_id, ts)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(table_id, owner_field, owner_value) DO UPDATE SET
          document_id = excluded.document_id,
          ts = excluded.ts
        `,
        claim.tableId,
        claim.ownerField,
        claim.ownerValue,
        claim.documentId,
        commitTs,
      );
    }
  }

  private validateReadSetEffect(
    readSet: ReadSet,
    beginTs: number,
    currentTs: number,
  ): Effect.Effect<void, unknown> {
    if (beginTs === currentTs) return Effect.void;
    const self = this;
    return Effect.gen(function* () {
      const rows = self.sql
        .exec<WriteLogRow>(
          `
          SELECT ts, writes_json, index_writes_json
          FROM write_log
          WHERE ts > ? AND ts <= ?
          ORDER BY ts ASC
          `,
          beginTs,
          currentTs,
        )
        .toArray();
      const writeLog = yield* Effect.forEach(rows, row =>
        Effect.gen(function* () {
          const writes = yield* decodePartitionStorageCommittedWritesJson(row.writes_json);
          const indexWrites = yield* decodePartitionStorageIndexWritesJson(row.index_writes_json);
          return {
            ts: row.ts,
            writes,
            indexWrites,
          };
        }),
      );
      const conflict = findReadSetConflict(
        readSet,
        writeLog,
      );
      if (conflict) return yield* Effect.fail(conflict);
    });
  }

  private readDocumentEffect(
    tableId: number,
    id: string,
    at: number,
  ): Effect.Effect<DocumentReadResponse, unknown> {
    return this.getDocumentAtEffect(tableId, id, at).pipe(
      Effect.map(document => ({
        document,
        readSet: { documents: [{ tableId, id }] },
      })),
    );
  }

  private readIndexEffect(
    indexId: number,
    at: number,
    lower?: string,
    upper?: string,
    limit = 100,
    cursor?: string,
    order: "asc" | "desc" = "asc",
  ): Effect.Effect<IndexReadResponse, unknown> {
    const read = { indexId, ...(lower === undefined ? {} : { lower }), ...(upper === undefined ? {} : { upper }) };
    const pageLimit = Math.max(1, Math.min(limit, 1000));
    return this.queryIndexAtEffect(indexId, at, lower, upper, pageLimit + 1, cursor, order).pipe(
      Effect.map(entries => {
        const isDone = entries.length <= pageLimit;
        const page = entries.slice(0, pageLimit);
        return {
          entries: page,
          readSet: { indexes: [read] },
          isDone,
          continueCursor: page.at(-1)?.key ?? cursor ?? "",
        };
      }),
    );
  }

  private queryIndexAtEffect(
    indexId: number,
    at: number,
    lower?: string,
    upper?: string,
    limit = 100,
    cursor?: string,
    order: "asc" | "desc" = "asc",
  ): Effect.Effect<Array<{ key: string; document: StoredDocument }>, unknown> {
    const boundedLimit = Math.max(1, Math.min(limit, 1001));
    const cursorOperator = order === "asc" ? ">" : "<";
    const orderSql = order === "asc" ? "ASC" : "DESC";
    const self = this;
    return Effect.gen(function* () {
      const rows = self.sql
        .exec<{ key: string; document_id: string }>(
          `
          SELECT latest.key, latest.document_id
          FROM index_entries AS latest
          JOIN (
            SELECT index_id, key, document_id, MAX(ts) AS max_ts
            FROM index_entries
            WHERE index_id = ?
              AND ts <= ?
              AND (? IS NULL OR key >= ?)
              AND (? IS NULL OR key < ?)
            GROUP BY index_id, key, document_id
          ) AS grouped
            ON grouped.index_id = latest.index_id
           AND grouped.key = latest.key
           AND grouped.document_id = latest.document_id
           AND grouped.max_ts = latest.ts
          WHERE latest.deleted = 0
            AND (? IS NULL OR latest.key ${cursorOperator} ?)
          ORDER BY latest.key ${orderSql}
          LIMIT ?
          `,
          indexId,
          at,
          lower ?? null,
          lower ?? null,
          upper ?? null,
          upper ?? null,
          cursor ?? null,
          cursor ?? null,
          boundedLimit,
        )
        .toArray();
      const entries = yield* Effect.forEach(rows, row =>
        self.getDocumentByIdAtEffect(row.document_id, at).pipe(
          Effect.map(document => ({ key: row.key, document })),
        ),
      );
      return entries.filter(
        (entry): entry is { key: string; document: StoredDocument } => entry.document !== null,
      );
    });
  }

  private getCurrentDocumentEffect(
    tableId: number,
    id: string,
  ): Effect.Effect<StoredDocument | null, unknown> {
    const self = this;
    return Effect.gen(function* () {
      const row = self.sql
        .exec<CurrentDocumentRow>(
          `
          SELECT table_id, id, ts, json_value
          FROM current_documents
          WHERE table_id = ? AND id = ?
          `,
          tableId,
          id,
        )
        .toArray()[0];
      if (!row) return null;
      const value = yield* decodePartitionStorageDocumentJson(row.json_value);
      return {
        tableId: row.table_id,
        id: row.id,
        ts: row.ts,
        value,
      };
    });
  }

  private getDocumentByIdAtEffect(
    id: string,
    at: number,
  ): Effect.Effect<StoredDocument | null, unknown> {
    const self = this;
    return Effect.gen(function* () {
      const row = self.sql
        .exec<{
          table_id: number;
          id: string;
          ts: number;
          json_value: string | null;
          deleted: number;
        }>(
          `
          SELECT table_id, id, ts, json_value, deleted
          FROM documents
          WHERE id = ? AND ts <= ?
          ORDER BY ts DESC
          LIMIT 1
          `,
          id,
          at,
        )
        .toArray()[0];
      if (!row || row.deleted) return null;
      const value = yield* decodePartitionStorageDocumentJson(row.json_value ?? "null");
      return {
        tableId: row.table_id,
        id: row.id,
        ts: row.ts,
        value,
      };
    });
  }

  private getDocumentAtEffect(
    tableId: number,
    id: string,
    at: number,
  ): Effect.Effect<StoredDocument | null, unknown> {
    const self = this;
    return Effect.gen(function* () {
      const row = self.sql
        .exec<{
          table_id: number;
          id: string;
          ts: number;
          json_value: string | null;
          deleted: number;
        }>(
          `
          SELECT table_id, id, ts, json_value, deleted
          FROM documents
          WHERE table_id = ? AND id = ? AND ts <= ?
          ORDER BY ts DESC
          LIMIT 1
          `,
          tableId,
          id,
          at,
        )
        .toArray()[0];
      if (!row || row.deleted) return null;
      const value = yield* decodePartitionStorageDocumentJson(row.json_value ?? "null");
      return {
        tableId: row.table_id,
        id: row.id,
        ts: row.ts,
        value,
      };
    });
  }

  private insertIndexEntriesEffect(
    tableId: number,
    documentId: string,
    value: Json,
    ts: number,
  ): Effect.Effect<IndexWrite[], unknown> {
    return this.indexesForTableEffect(tableId).pipe(
      Effect.map(indexes => indexes.map(index => {
        const key = indexKeyForDocument(index, value, documentId);
        this.sql.exec(
          `
          INSERT INTO index_entries (index_id, key, document_id, ts, deleted)
          VALUES (?, ?, ?, ?, 0)
          `,
          index.indexId,
          key,
          documentId,
          ts,
        );
        this.sql.exec(
          `
          INSERT INTO current_index_entries (index_id, key, document_id, ts)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(index_id, key, document_id) DO UPDATE SET ts = excluded.ts
          `,
          index.indexId,
          key,
          documentId,
          ts,
        );
        return { indexId: index.indexId, key, documentId, deleted: false };
      })),
    );
  }

  private deleteIndexEntriesEffect(
    tableId: number,
    documentId: string,
    value: Json,
    ts: number,
  ): Effect.Effect<IndexWrite[], unknown> {
    return this.indexesForTableEffect(tableId).pipe(
      Effect.map(indexes => indexes.map(index => {
        const key = indexKeyForDocument(index, value, documentId);
        this.sql.exec(
          `
          INSERT INTO index_entries (index_id, key, document_id, ts, deleted)
          VALUES (?, ?, ?, ?, 1)
          `,
          index.indexId,
          key,
          documentId,
          ts,
        );
        this.sql.exec(
          `
          DELETE FROM current_index_entries
          WHERE index_id = ? AND key = ? AND document_id = ?
          `,
          index.indexId,
          key,
          documentId,
        );
        return { indexId: index.indexId, key, documentId, deleted: true };
      })),
    );
  }

  private indexesForTableEffect(tableId: number): Effect.Effect<SchemaIndex[], unknown> {
    const self = this;
    return Effect.gen(function* () {
      const rows = self.sql
        .exec<IndexRow>(
          `
          SELECT index_id, table_id, index_name, fields_json, state
          FROM indexes
          WHERE table_id = ? AND state = 'enabled'
          ORDER BY index_id
          `,
          tableId,
        )
        .toArray();
      return yield* Effect.forEach(rows, row =>
        Effect.gen(function* () {
          const fields = yield* decodePartitionStorageIndexFieldsJson(row.fields_json);
          const state = yield* enabledIndexStateFromStorage(row.state);
          return {
            indexId: row.index_id,
            tableId: row.table_id,
            name: row.index_name,
            fields,
            state,
          };
        }),
      );
    });
  }

  private currentTs(): number {
    return Number(this.getMeta("current_ts") ?? "0");
  }

  private schemaVersion(): number {
    return Number(this.getMeta("schema_version") ?? "0");
  }

  private partitionKey(): string | null {
    return this.getMeta("partition_key");
  }

  private setMetaIfMissing(key: string, value: string): void {
    this.sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", key, value);
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private getMeta(key: string): string | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row?.value ?? null;
  }
}

interface PartitionRouteHandlers {
  health(): {
    service: "flarex-partition";
    status: "ok";
    currentTs: number;
    schemaVersion: number;
    partitionKey: string | null;
  };
  currentTs(): number;
  putSchemaCache(body: PartitionSchemaCacheRequest): Promise<{ schemaVersion: number }>;
  begin(): BeginResponse;
  commit(body: CommitRequest): Effect.Effect<CommitResponse, unknown, never>;
  registerSubscription(body: PartitionSubscriptionRegistrationRequest): { registered: true };
  unregisterSubscription(body: PartitionSubscriptionTargetRequest): { unregistered: true };
  unregisterConnection(body: PartitionConnectionUnregisterRequest): { unregistered: true };
  readDocument(tableId: number, id: string, at: number): Effect.Effect<DocumentReadResponse, unknown, never>;
  readIndex(
    indexId: number,
    at: number,
    lower: string | undefined,
    upper: string | undefined,
    limit: number,
    cursor: string | undefined,
    order: "asc" | "desc",
  ): Effect.Effect<IndexReadResponse, unknown, never>;
}

const routePartitionDurableObject = Effect.fn("PartitionDO.route")(
  function* (
    request: Request,
    url: URL,
    handlers: PartitionRouteHandlers,
  ): Effect.fn.Return<Response, PartitionInternalRouteError> {
    if (url.pathname === "/health") {
      return json(handlers.health());
    }
    if (url.pathname === "/schema-cache" && request.method === "PUT") {
      return yield* routePartitionSchemaCache(request, handlers.putSchemaCache);
    }
    if (url.pathname === "/begin" && request.method === "POST") {
      return json(handlers.begin());
    }
    if (url.pathname === "/commit" && request.method === "POST") {
      return yield* routePartitionCommit(request, handlers.commit);
    }
    if (url.pathname === "/subscriptions/register" && request.method === "POST") {
      return yield* routePartitionSubscriptionRegistration(
        request,
        handlers.registerSubscription,
      );
    }
    if (url.pathname === "/subscriptions/unregister" && request.method === "POST") {
      return yield* routePartitionSubscriptionUnregister(
        request,
        handlers.unregisterSubscription,
      );
    }
    if (url.pathname === "/subscriptions/unregister-connection" && request.method === "POST") {
      return yield* routePartitionConnectionUnregister(
        request,
        handlers.unregisterConnection,
      );
    }
    if (url.pathname === "/document" && request.method === "GET") {
      return yield* routePartitionDocumentRead(url, handlers.currentTs, handlers.readDocument);
    }
    if (url.pathname === "/index" && request.method === "GET") {
      return yield* routePartitionIndexRead(url, handlers.currentTs, handlers.readIndex);
    }
    return json({ error: "Not found." }, { status: 404 });
  },
);

function routePartitionDocumentRead(
  url: URL,
  currentTs: PartitionRouteHandlers["currentTs"],
  readDocument: PartitionRouteHandlers["readDocument"],
): Effect.Effect<Response, PartitionRoutePayloadError | PartitionRouteOperationError> {
  return decodePartitionDocumentReadSearchParams(url.searchParams).pipe(
    Effect.flatMap(read => routePartitionDocumentReadInput(read, currentTs, readDocument)),
  );
}

function routePartitionDocumentReadInput(
  read: PartitionDocumentReadRequest,
  currentTs: PartitionRouteHandlers["currentTs"],
  readDocument: PartitionRouteHandlers["readDocument"],
): Effect.Effect<Response, PartitionRouteOperationError> {
  return routePartitionJsonResult(
    "document-read",
    () => readDocument(read.tableId, read.id, read.at ?? currentTs()),
  );
}

function routePartitionIndexRead(
  url: URL,
  currentTs: PartitionRouteHandlers["currentTs"],
  readIndex: PartitionRouteHandlers["readIndex"],
): Effect.Effect<Response, PartitionRoutePayloadError | PartitionRouteOperationError> {
  return decodePartitionIndexReadSearchParams(url.searchParams).pipe(
    Effect.flatMap(read => routePartitionIndexReadInput(read, currentTs, readIndex)),
  );
}

function routePartitionIndexReadInput(
  read: PartitionIndexReadRequest,
  currentTs: PartitionRouteHandlers["currentTs"],
  readIndex: PartitionRouteHandlers["readIndex"],
): Effect.Effect<Response, PartitionRouteOperationError> {
  return routePartitionJsonResult(
    "index-read",
    () => readIndex(
      read.indexId,
      read.at ?? currentTs(),
      read.lower,
      read.upper,
      read.limit ?? 100,
      read.cursor,
      read.order ?? "asc",
    ),
  );
}

const routePartitionSchemaCache = Effect.fn("PartitionDO.routeSchemaCache")(
  function* (
    request: Request,
    putSchemaCache: (body: PartitionSchemaCacheRequest) => Promise<{ schemaVersion: number }>,
  ) {
    const body = yield* decodePartitionSchemaCacheRequest(request);
    return yield* routePartitionJsonResult("schema-cache", () =>
      Effect.tryPromise({
        try: () => putSchemaCache(body),
        catch: cause => cause,
      }));
  },
);

const routePartitionCommit = Effect.fn("PartitionDO.routeCommit")(
  function* (
    request: Request,
    commit: (body: CommitRequest) => Effect.Effect<CommitResponse, unknown, never>,
  ) {
    const body = yield* decodePartitionCommitRequest(request);
    return yield* routePartitionJsonResult(
      "commit",
      () => commit(body),
      result => ({ status: result.replayed ? 200 : 201 }),
    );
  },
);

const routePartitionSubscriptionRegistration = Effect.fn("PartitionDO.routeSubscriptionRegistration")(
  function* (
    request: Request,
    registerSubscription: (
      body: PartitionSubscriptionRegistrationRequest,
    ) => { registered: true },
  ) {
    const body = yield* decodePartitionSubscriptionRegistrationRequest(request);
    return yield* routePartitionJsonResult(
      "subscription-register",
      () => Effect.try({
        try: () => registerSubscription(body),
        catch: cause => cause,
      }),
    );
  },
);

const routePartitionSubscriptionUnregister = Effect.fn("PartitionDO.routeSubscriptionUnregister")(
  function* (
    request: Request,
    unregisterSubscription: (
      body: PartitionSubscriptionTargetRequest,
    ) => { unregistered: true },
  ) {
    const body = yield* decodePartitionSubscriptionTargetRequest(request);
    return yield* routePartitionJsonResult(
      "subscription-unregister",
      () => Effect.try({
        try: () => unregisterSubscription(body),
        catch: cause => cause,
      }),
    );
  },
);

const routePartitionConnectionUnregister = Effect.fn("PartitionDO.routeConnectionUnregister")(
  function* (
    request: Request,
    unregisterConnection: (
      body: PartitionConnectionUnregisterRequest,
    ) => { unregistered: true },
  ) {
    const body = yield* decodePartitionConnectionUnregisterRequest(request);
    return yield* routePartitionJsonResult(
      "connection-unregister",
      () => Effect.try({
        try: () => unregisterConnection(body),
        catch: cause => cause,
      }),
    );
  },
);

type PartitionRouteOperation =
  | "schema-cache"
  | "commit"
  | "subscription-register"
  | "subscription-unregister"
  | "connection-unregister"
  | "document-read"
  | "index-read";

class PartitionRouteOperationError extends Data.TaggedError(
  "PartitionRouteOperationError",
)<{
  readonly operation: PartitionRouteOperation;
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

class PartitionDomainValidationError extends Data.TaggedError(
  "PartitionDomainValidationError",
)<{
  readonly status: 400;
  readonly message: string;
}> {}

type PartitionInternalRouteError =
  | PartitionRouteError
  | PartitionRouteOperationError;

function routePartitionJsonResult<A extends Json | object>(
  operation: PartitionRouteOperation,
  execute: () => Effect.Effect<A, unknown, never>,
  init?: (value: A) => ResponseInit,
): Effect.Effect<Response, PartitionRouteOperationError> {
  return Effect.try({
    try: execute,
    catch: cause => partitionRouteOperationError(operation, cause),
  }).pipe(
    Effect.flatMap(effect => effect.pipe(
      Effect.mapError(cause => partitionRouteOperationError(operation, cause)),
      Effect.map(value => json(value, init?.(value))),
    )),
  );
}

function runPartitionStorageTransactionEffect<A>(
  ctx: DurableObjectState,
  effect: Effect.Effect<A, unknown, never>,
): Effect.Effect<A, unknown> {
  return Effect.tryPromise({
    // Cloudflare storage transactions require a Promise-returning callback for rollback semantics.
    try: () => ctx.storage.transaction(() => Effect.runPromise(effect)),
    catch: cause => cause,
  });
}

function partitionRouteOperationError(
  operation: PartitionRouteOperation,
  cause: unknown,
): PartitionRouteOperationError {
  if (cause instanceof HttpError) {
    return new PartitionRouteOperationError({
      operation,
      status: cause.status,
      message: cause.message,
      cause,
    });
  }
  if (cause instanceof PartitionDomainValidationError) {
    return new PartitionRouteOperationError({
      operation,
      status: cause.status,
      message: cause.message,
      cause,
    });
  }
  return new PartitionRouteOperationError({
    operation,
    status: 500,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function runPartitionRoute(effect: Effect.Effect<Response, PartitionInternalRouteError>): Promise<Response> {
  // Deliberate runtime bridge: Durable Object fetch handlers return Promises.
  return Effect.runPromise(
    effect.pipe(
      Effect.catch(partitionInternalRouteErrorToResponseEffect),
    ),
  );
}

export const partitionInternalRouteErrorToResponseEffect = Effect.fn(
  "PartitionDO.partitionInternalRouteErrorToResponse",
)(function* (
  error: PartitionInternalRouteError,
): Effect.fn.Return<Response> {
  return yield* Effect.succeed(partitionInternalRouteErrorToResponse(error));
});

function partitionInternalRouteErrorToResponse(error: PartitionInternalRouteError): Response {
  if (error instanceof PartitionRouteOperationError) {
    if (isOccConflict(error.cause)) return json(error.cause, { status: 409 });
    return errorResponse(new HttpError(error.status, error.message));
  }
  return errorResponse(partitionRouteErrorToHttpError(error));
}

function partitionRouteErrorToHttpError(error: PartitionRouteError): HttpError {
  return badRequestErrorToHttpError(error);
}

function resolveDocumentWrite(write: DocumentWrite): ResolvedDocumentWrite {
  return { ...write, id: write.id ?? encodeFlarexId(write.tableId) };
}

function partitionDomainValidationError(message: string): PartitionDomainValidationError {
  return new PartitionDomainValidationError({
    status: 400,
    message,
  });
}

function enabledIndexStateFromStorage(
  state: string,
): Effect.Effect<NonNullable<SchemaIndex["state"]>, PartitionDomainValidationError> {
  if (state === "enabled") return Effect.succeed(state);
  return Effect.fail(partitionDomainValidationError(`Expected enabled index row, got ${state}.`));
}

function ownerFieldForPlacement(placement: TablePlacement): string | null {
  if (placement.kind === "colocateWith") return placement.field;
  if (placement.kind === "partitionBy" && placement.field !== "_id") {
    return placement.field;
  }
  return null;
}

function rootOwnerFieldForPlacement(placement: TablePlacement): string | null {
  if (placement.kind === "partitionBy" && placement.field !== "_id") return placement.field;
  return null;
}

function documentOwnerValue(tableName: string, ownerField: string, value: Json): string {
  if (!isWritableJsonObject(value)) {
    throw partitionDomainValidationError(
      `PlacementValidationError: $document(${tableName}) must be an object for placement validation.`,
    );
  }
  const ownerValue = value[ownerField];
  if (typeof ownerValue !== "string" || ownerValue.length === 0) {
    throw partitionDomainValidationError(
      `PlacementValidationError: $document(${tableName}).${ownerField} must be a non-empty string matching partitionKey.`,
    );
  }
  return ownerValue;
}

function partitionOwnerKey(owner: Pick<PartitionOwnerChange, "tableId" | "ownerField" | "ownerValue">): string {
  return `${owner.tableId}\0${owner.ownerField}\0${owner.ownerValue}`;
}
