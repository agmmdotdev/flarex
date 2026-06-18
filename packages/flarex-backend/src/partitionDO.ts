import { DurableObject } from "cloudflare:workers";
import { errorResponse, HttpError, json, readJson } from "./http";
import { encodeFlarexId, parseFlarexId } from "./ids";
import { indexKeyForDocument } from "./indexKeys";
import { findReadSetConflict, isOccConflict } from "./occ";
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
      if (url.pathname === "/health") {
        return json({
          service: "flarex-partition",
          status: "ok",
          currentTs: this.currentTs(),
          schemaVersion: this.schemaVersion(),
          partitionKey: this.partitionKey(),
        });
      }
      if (url.pathname === "/schema-cache" && request.method === "PUT") {
        return json(await this.putSchemaCache(await readJson(request)));
      }
      if (url.pathname === "/begin" && request.method === "POST") {
        return json(this.begin());
      }
      if (url.pathname === "/commit" && request.method === "POST") {
        const result = await this.commit(await readJson<CommitRequest>(request));
        return json(result, { status: result.replayed ? 200 : 201 });
      }
      if (url.pathname === "/subscriptions/register" && request.method === "POST") {
        return json(this.registerSubscription(await readJson(request)));
      }
      if (url.pathname === "/subscriptions/unregister" && request.method === "POST") {
        return json(this.unregisterSubscription(await readJson(request)));
      }
      if (url.pathname === "/subscriptions/unregister-connection" && request.method === "POST") {
        return json(this.unregisterConnection(await readJson(request)));
      }
      if (url.pathname === "/document" && request.method === "GET") {
        const tableId = Number(url.searchParams.get("tableId"));
        const id = url.searchParams.get("id");
        const at = Number(url.searchParams.get("at") ?? this.currentTs());
        if (!Number.isInteger(tableId) || !id) {
          return json({ error: "tableId and id are required." }, { status: 400 });
        }
        return json(this.readDocument(tableId, id, at));
      }
      if (url.pathname === "/index" && request.method === "GET") {
        const indexId = Number(url.searchParams.get("indexId"));
        if (!Number.isInteger(indexId)) {
          return json({ error: "indexId is required." }, { status: 400 });
        }
        const at = Number(url.searchParams.get("at") ?? this.currentTs());
        const lower = url.searchParams.get("lower") ?? undefined;
        const upper = url.searchParams.get("upper") ?? undefined;
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const order = url.searchParams.get("order") === "desc" ? "desc" : "asc";
        return json(
          this.readIndex(
            indexId,
            at,
            lower,
            upper,
            Number(url.searchParams.get("limit") ?? 100),
            cursor,
            order,
          ),
        );
      }
      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      if (isOccConflict(error)) return json(error, { status: 409 });
      return errorResponse(error);
    }
  }

  private begin(): BeginResponse {
    return { beginTs: this.currentTs(), schemaVersion: this.schemaVersion() };
  }

  private async putSchemaCache(body: {
    partitionKey?: string;
    schema?: {
      version: number;
      tables: Array<{
        tableId: number;
        name: string;
        state?: string;
        validator?: Json;
        placement: Json;
      }>;
      indexes: Array<{
        indexId: number;
        tableId: number;
        name: string;
        fields: string[];
        state?: string;
      }>;
    };
    version?: number;
    tables?: Array<{
      tableId: number;
      name: string;
      state?: string;
      validator?: Json;
      placement: Json;
    }>;
    indexes?: Array<{
      indexId: number;
      tableId: number;
      name: string;
      fields: string[];
      state?: string;
    }>;
  }): Promise<{ schemaVersion: number }> {
    const schemaCandidate = body.schema ?? body;
    const partitionKey = body.partitionKey;
    if (typeof partitionKey !== "string" || partitionKey.length === 0) {
      throw new HttpError(400, "partitionKey must be provided with schema-cache.");
    }
    if (
      typeof schemaCandidate.version !== "number" ||
      !Array.isArray(schemaCandidate.tables) ||
      !Array.isArray(schemaCandidate.indexes)
    ) {
      throw new HttpError(400, "schema-cache requires a deployment schema.");
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

  private async commit(request: CommitRequest): Promise<CommitResponse> {
    const idempotencyKey = request.idempotencyKey;
    if (idempotencyKey) {
      const cached = this.sql
        .exec<{ result_json: string }>(
          "SELECT result_json FROM idempotency_keys WHERE key = ?",
          idempotencyKey,
        )
        .toArray()[0];
      if (cached) return { ...(JSON.parse(cached.result_json) as CommitResponse), replayed: true };
    }

    const result = await this.ctx.storage.transaction(async () => {
      const currentTs = this.currentTs();
      if (request.beginTs > currentTs) {
        throw new Error(`beginTs ${request.beginTs} is newer than currentTs ${currentTs}.`);
      }
      if (request.schemaVersion !== undefined && request.schemaVersion !== this.schemaVersion()) {
        throw new Error(
          `Schema version mismatch. Request has ${request.schemaVersion}, partition has ${this.schemaVersion()}.`,
        );
      }
      this.validateWrites(request.writes);
      this.validateReadSet(request.readSet ?? {}, request.beginTs, currentTs);

      const commitTs = currentTs + 1;
      const committedWrites: CommittedWrite[] = [];
      const indexWrites: IndexWrite[] = [];
      for (const write of request.writes) {
        const committed = this.applyDocumentWrite(write, commitTs);
        committedWrites.push(committed.write);
        indexWrites.push(...committed.indexWrites);
      }

      this.sql.exec(
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
      this.setMeta("current_ts", String(commitTs));
      const response: CommitResponse = { committedTs: commitTs, writes: committedWrites };
      if (idempotencyKey) {
        this.sql.exec(
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
        invalidations: this.invalidatedSubscriptions(commitTs, committedWrites, indexWrites),
      };
    });
    await this.notifyInvalidations(result.invalidations);
    return result.response;
  }

  private registerSubscription(body: unknown): { registered: true } {
    const request = parseSubscriptionRegistration(body);
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

  private unregisterSubscription(body: unknown): { unregistered: true } {
    const request = parseSubscriptionTarget(body);
    this.sql.exec(
      "DELETE FROM sync_subscriptions WHERE connection_name = ? AND query_id = ?",
      request.connectionName,
      request.queryId,
    );
    return { unregistered: true };
  }

  private unregisterConnection(body: unknown): { unregistered: true } {
    const connectionName = requiredStringField(body, "connectionName");
    this.sql.exec(
      "DELETE FROM sync_subscriptions WHERE connection_name = ?",
      connectionName,
    );
    return { unregistered: true };
  }

  private invalidatedSubscriptions(
    commitTs: number,
    writes: CommittedWrite[],
    indexWrites: IndexWrite[],
  ): SubscriptionInvalidation[] {
    if (writes.length === 0 && indexWrites.length === 0) return [];
    const rows = this.sql
      .exec<SubscriptionRow>(
        `
        SELECT connection_name, query_id, read_set_json
        FROM sync_subscriptions
        ORDER BY connection_name, query_id
        `,
      )
      .toArray();
    return rows.flatMap(row => {
      const readSet = JSON.parse(row.read_set_json) as ReadSet;
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

  private validateWrites(writes: DocumentWrite[]): void {
    if (this.schemaVersion() === 0) return;
    for (const write of writes) {
      const row = this.sql
        .exec<{
          table_name: string;
          schema_json: string | null;
          partition_rule_json: string;
        }>(
          "SELECT table_name, schema_json, partition_rule_json FROM tables WHERE table_id = ? AND state != 'deleted'",
          write.tableId,
        )
        .toArray()[0];
      if (!row) throw new HttpError(400, `Write references unknown table id ${write.tableId}.`);
      const placement = JSON.parse(row.partition_rule_json) as TablePlacement;
      if (write.value === null) {
        const id = write.id;
        if (id !== undefined) {
          const current = this.getCurrentDocument(write.tableId, id);
          if (current !== null) {
            this.validateDocumentPlacement(row.table_name, placement, current.value);
          }
        }
        continue;
      }
      const validator = JSON.parse(row.schema_json ?? "null") as ValidatorJson | null;
      if (validator !== null) {
        try {
          validateJsonValue(validator, write.value, `$document(${row.table_name})`, {
            validateId: this.validateId.bind(this),
          });
        } catch (error) {
          if (error instanceof BackendValidationError) {
            throw new HttpError(400, `DocumentValidationError: ${error.message}`);
          }
          throw error;
        }
      }
      this.validateDocumentPlacement(row.table_name, placement, write.value);
    }
  }

  private validateDocumentPlacement(
    tableName: string,
    placement: TablePlacement,
    value: Json,
  ): void {
    const placementField = ownerFieldForPlacement(placement);
    if (placementField === null) return;
    const partitionKey = this.partitionKey();
    if (partitionKey === null) {
      throw new HttpError(400, "Partition placement validation requires a cached partitionKey.");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new HttpError(
        400,
        `PlacementValidationError: $document(${tableName}) must be an object for placement validation.`,
      );
    }
    const placementValue = value[placementField];
    if (typeof placementValue !== "string" || placementValue.length === 0) {
      throw new HttpError(
        400,
        `PlacementValidationError: $document(${tableName}).${placementField} must be a non-empty string matching partitionKey.`,
      );
    }
    if (placementValue !== partitionKey) {
      throw new HttpError(
        400,
        `PlacementValidationError: $document(${tableName}).${placementField} must match partitionKey ${partitionKey}.`,
      );
    }
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

  private applyDocumentWrite(
    write: DocumentWrite,
    commitTs: number,
  ): { write: CommittedWrite; indexWrites: IndexWrite[] } {
    const id = write.id ?? encodeFlarexId(write.tableId);
    const previous = this.getCurrentDocument(write.tableId, id);
    const prevTs = previous?.ts ?? null;
    const indexWrites: IndexWrite[] = [];

    if (previous) {
      indexWrites.push(...this.deleteIndexEntries(write.tableId, id, previous.value, commitTs));
    }

    this.sql.exec(
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
      this.sql.exec(
        "DELETE FROM current_documents WHERE table_id = ? AND id = ?",
        write.tableId,
        id,
      );
    } else {
      this.sql.exec(
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
      indexWrites.push(...this.insertIndexEntries(write.tableId, id, write.value, commitTs));
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
  }

  private validateReadSet(readSet: ReadSet, beginTs: number, currentTs: number): void {
    if (beginTs === currentTs) return;
    const rows = this.sql
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
    const conflict = findReadSetConflict(
      readSet,
      rows.map(row => ({
        ts: row.ts,
        writes: JSON.parse(row.writes_json) as CommittedWrite[],
        indexWrites: JSON.parse(row.index_writes_json) as IndexWrite[],
      })),
    );
    if (conflict) throw conflict;
  }

  private readDocument(tableId: number, id: string, at: number): DocumentReadResponse {
    return {
      document: this.getDocumentAt(tableId, id, at),
      readSet: { documents: [{ tableId, id }] },
    };
  }

  private readIndex(
    indexId: number,
    at: number,
    lower?: string,
    upper?: string,
    limit = 100,
    cursor?: string,
    order: "asc" | "desc" = "asc",
  ): IndexReadResponse {
    const read = { indexId, ...(lower === undefined ? {} : { lower }), ...(upper === undefined ? {} : { upper }) };
    const pageLimit = Math.max(1, Math.min(limit, 1000));
    const entries = this.queryIndexAt(indexId, at, lower, upper, pageLimit + 1, cursor, order);
    const isDone = entries.length <= pageLimit;
    const page = entries.slice(0, pageLimit);
    return {
      entries: page,
      readSet: { indexes: [read] },
      isDone,
      continueCursor: page.at(-1)?.key ?? cursor ?? "",
    };
  }

  private queryIndexAt(
    indexId: number,
    at: number,
    lower?: string,
    upper?: string,
    limit = 100,
    cursor?: string,
    order: "asc" | "desc" = "asc",
  ): Array<{ key: string; document: StoredDocument }> {
    const boundedLimit = Math.max(1, Math.min(limit, 1001));
    const cursorOperator = order === "asc" ? ">" : "<";
    const orderSql = order === "asc" ? "ASC" : "DESC";
    const rows = this.sql
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
    return rows
      .map(row => ({ key: row.key, document: this.getDocumentByIdAt(row.document_id, at) }))
      .filter(
        (entry): entry is { key: string; document: StoredDocument } => entry.document !== null,
      );
  }

  private getCurrentDocument(tableId: number, id: string): StoredDocument | null {
    const row = this.sql
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
    return row
      ? { tableId: row.table_id, id: row.id, ts: row.ts, value: JSON.parse(row.json_value) as Json }
      : null;
  }

  private getDocumentByIdAt(id: string, at: number): StoredDocument | null {
    const row = this.sql
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
    return {
      tableId: row.table_id,
      id: row.id,
      ts: row.ts,
      value: JSON.parse(row.json_value ?? "null") as Json,
    };
  }

  private getDocumentAt(tableId: number, id: string, at: number): StoredDocument | null {
    const row = this.sql
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
    return {
      tableId: row.table_id,
      id: row.id,
      ts: row.ts,
      value: JSON.parse(row.json_value ?? "null") as Json,
    };
  }

  private insertIndexEntries(
    tableId: number,
    documentId: string,
    value: Json,
    ts: number,
  ): IndexWrite[] {
    return this.indexesForTable(tableId).map(index => {
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
    });
  }

  private deleteIndexEntries(
    tableId: number,
    documentId: string,
    value: Json,
    ts: number,
  ): IndexWrite[] {
    return this.indexesForTable(tableId).map(index => {
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
    });
  }

  private indexesForTable(tableId: number): SchemaIndex[] {
    return this.sql
      .exec<IndexRow>(
        `
        SELECT index_id, table_id, index_name, fields_json, state
        FROM indexes
        WHERE table_id = ? AND state = 'enabled'
        ORDER BY index_id
        `,
        tableId,
      )
      .toArray()
      .map(row => ({
        indexId: row.index_id,
        tableId: row.table_id,
        name: row.index_name,
        fields: JSON.parse(row.fields_json) as string[],
        state: row.state as NonNullable<SchemaIndex["state"]>,
      }));
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

function parseSubscriptionRegistration(body: unknown): {
  connectionName: string;
  queryId: number;
  readSet: ReadSet;
} {
  return {
    ...parseSubscriptionTarget(body),
    readSet: requiredReadSet(body, "readSet"),
  };
}

function parseSubscriptionTarget(body: unknown): {
  connectionName: string;
  queryId: number;
} {
  return {
    connectionName: requiredStringField(body, "connectionName"),
    queryId: requiredIntegerField(body, "queryId"),
  };
}

function requiredStringField(body: unknown, field: string): string {
  if (!isRecord(body) || typeof body[field] !== "string" || body[field].length === 0) {
    throw new HttpError(400, `${field} must be a non-empty string.`);
  }
  return body[field];
}

function requiredIntegerField(body: unknown, field: string): number {
  if (!isRecord(body) || typeof body[field] !== "number" || !Number.isInteger(body[field])) {
    throw new HttpError(400, `${field} must be an integer.`);
  }
  return body[field];
}

function requiredReadSet(body: unknown, field: string): ReadSet {
  if (!isRecord(body) || !isRecord(body[field])) {
    throw new HttpError(400, `${field} must be an object.`);
  }
  return body[field] as ReadSet;
}

function ownerFieldForPlacement(placement: TablePlacement): string | null {
  if (placement.kind === "colocateWith") return placement.field;
  if (placement.kind === "partitionBy" && placement.field !== "_id") {
    return placement.field;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
