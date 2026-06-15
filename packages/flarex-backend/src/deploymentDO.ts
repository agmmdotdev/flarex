import { DurableObject } from "cloudflare:workers";
import { errorResponse, HttpError, json, readJson } from "./http";
import type {
  DeploymentFunctionKind,
  DeploymentFunctionMetadata,
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  FunctionVisibility,
  Json,
  SchemaIndex,
  SchemaTable,
  ValidatorJson,
} from "./types";
import { assertValidatorJson, BackendValidationError } from "./validation";

export class DeploymentDO extends DurableObject<Env> {
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
        table_name TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        schema_json TEXT,
        partition_rule_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexes (
        index_id INTEGER PRIMARY KEY,
        table_id INTEGER NOT NULL,
        index_name TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        state TEXT NOT NULL,
        UNIQUE(table_id, index_name)
      );
      CREATE TABLE IF NOT EXISTS functions (
        function_path TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        visibility TEXT NOT NULL,
        args_json TEXT,
        returns_json TEXT
      );
    `);
    this.setMetaIfMissing("schema_version", "0");
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return json({ service: "flarex-deployment", status: "ok" });
      }
      if (url.pathname === "/schema" && request.method === "PUT") {
        return json(await this.putSchema(await readJson<DeploymentSchema>(request)));
      }
      if (url.pathname === "/schema" && request.method === "GET") {
        return json(this.getSchema());
      }
      if (url.pathname === "/functions" && request.method === "PUT") {
        return json(await this.putFunctions(await readJson<DeploymentFunctions>(request)));
      }
      if (url.pathname === "/functions" && request.method === "GET") {
        return json(this.getFunctions());
      }
      if (url.pathname === "/function" && request.method === "GET") {
        const path = url.searchParams.get("path");
        if (!path) throw new HttpError(400, "Missing function path.");
        const metadata = this.getFunction(path);
        if (!metadata) throw new HttpError(404, `Unknown Flarex function metadata: ${path}`);
        return json(metadata);
      }
      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      return errorResponse(error);
    }
  }

  private async putSchema(schema: DeploymentSchema): Promise<DeploymentSchema> {
    return this.ctx.storage.transaction(async () => {
      const tableIds = new Set<number>();
      const indexIds = new Set<number>();
      for (const table of schema.tables) {
        if (tableIds.has(table.tableId)) throw new Error(`Duplicate table id ${table.tableId}.`);
        tableIds.add(table.tableId);
      }
      for (const index of schema.indexes) {
        if (!tableIds.has(index.tableId)) {
          throw new Error(`Index ${index.name} references unknown table id ${index.tableId}.`);
        }
        if (indexIds.has(index.indexId)) throw new Error(`Duplicate index id ${index.indexId}.`);
        indexIds.add(index.indexId);
      }

      this.sql.exec("DELETE FROM indexes");
      this.sql.exec("DELETE FROM tables");
      for (const table of schema.tables) {
        const validator = safeValidator(table.validator ?? null, `$schema.tables.${table.name}.validator`);
        this.sql.exec(
          `
          INSERT INTO tables (table_id, table_name, state, schema_json, partition_rule_json)
          VALUES (?, ?, ?, ?, ?)
          `,
          table.tableId,
          table.name,
          table.state ?? "active",
          JSON.stringify(validator),
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
      return schema;
    });
  }

  private async putFunctions(functions: DeploymentFunctions): Promise<DeploymentFunctions> {
    return this.ctx.storage.transaction(async () => {
      const seen = new Set<string>();
      const normalized = functions.functions.map((metadata, index) => {
        const path = metadata.path;
        if (typeof path !== "string" || path.length === 0) {
          throw new HttpError(400, `Function metadata at index ${index} has an invalid path.`);
        }
        if (seen.has(path)) throw new HttpError(400, `Duplicate function metadata path: ${path}.`);
        seen.add(path);
        const kind = parseFunctionKind(metadata.kind, `$functions.${path}.kind`);
        const visibility = parseVisibility(metadata.visibility ?? "public", `$functions.${path}.visibility`);
        const args = safeValidator(metadata.args ?? null, `$functions.${path}.args`);
        const returns = safeValidator(metadata.returns ?? null, `$functions.${path}.returns`);
        return { path, kind, visibility, args, returns };
      });

      this.sql.exec("DELETE FROM functions");
      for (const metadata of normalized) {
        this.sql.exec(
          `
          INSERT INTO functions (function_path, kind, visibility, args_json, returns_json)
          VALUES (?, ?, ?, ?, ?)
          `,
          metadata.path,
          metadata.kind,
          metadata.visibility,
          JSON.stringify(metadata.args),
          JSON.stringify(metadata.returns),
        );
      }
      return { functions: normalized };
    });
  }

  private getFunctions(): DeploymentFunctions {
    return {
      functions: this.sql
        .exec<{
          function_path: string;
          kind: string;
          visibility: string;
          args_json: string | null;
          returns_json: string | null;
        }>(
          `
          SELECT function_path, kind, visibility, args_json, returns_json
          FROM functions
          ORDER BY function_path
          `,
        )
        .toArray()
        .map(row => functionMetadataFromRow(row)),
    };
  }

  private getFunction(path: string): DeploymentFunctionMetadata | null {
    const row = this.sql
      .exec<{
        function_path: string;
        kind: string;
        visibility: string;
        args_json: string | null;
        returns_json: string | null;
      }>(
        `
        SELECT function_path, kind, visibility, args_json, returns_json
        FROM functions
        WHERE function_path = ?
        `,
        path,
      )
      .toArray()[0];
    return row ? functionMetadataFromRow(row) : null;
  }

  private getSchema(): DeploymentSchema {
    const tables = this.sql
      .exec<{
        table_id: number;
        table_name: string;
        state: string;
        schema_json: string | null;
        partition_rule_json: string;
      }>(
        `
        SELECT table_id, table_name, state, schema_json, partition_rule_json
        FROM tables
        ORDER BY table_id
        `,
      )
      .toArray()
      .map(row => ({
        tableId: row.table_id,
        name: row.table_name,
        state: row.state as NonNullable<SchemaTable["state"]>,
        validator: JSON.parse(row.schema_json ?? "null"),
        placement: JSON.parse(row.partition_rule_json),
      }));
    const indexes = this.sql
      .exec<{
        index_id: number;
        table_id: number;
        index_name: string;
        fields_json: string;
        state: string;
      }>(
        `
        SELECT index_id, table_id, index_name, fields_json, state
        FROM indexes
        ORDER BY index_id
        `,
      )
      .toArray()
      .map(row => ({
        indexId: row.index_id,
        tableId: row.table_id,
        name: row.index_name,
        fields: JSON.parse(row.fields_json) as string[],
        state: row.state as NonNullable<SchemaIndex["state"]>,
      }));
    return {
      version: Number(this.getMeta("schema_version") ?? "0"),
      tables,
      indexes,
    };
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

function functionMetadataFromRow(row: {
  function_path: string;
  kind: string;
  visibility: string;
  args_json: string | null;
  returns_json: string | null;
}): DeploymentFunctionMetadata {
  return {
    path: row.function_path,
    kind: row.kind as DeploymentFunctionKind,
    visibility: row.visibility as FunctionVisibility,
    args: JSON.parse(row.args_json ?? "null") as ValidatorJson | null,
    returns: JSON.parse(row.returns_json ?? "null") as ValidatorJson | null,
  };
}

function parseFunctionKind(value: string, path: string): DeploymentFunctionKind {
  if (
    value === "query" ||
    value === "mutation" ||
    value === "action" ||
    value === "workflowMutation"
  ) {
    return value;
  }
  throw new HttpError(400, `${path}: Invalid function kind ${value}.`);
}

function parseVisibility(value: string, path: string): FunctionVisibility {
  if (value === "public" || value === "internal") return value;
  throw new HttpError(400, `${path}: Invalid function visibility ${value}.`);
}

function safeValidator(value: Json | undefined | null, path: string): ValidatorJson | null {
  try {
    return assertValidatorJson(value, path);
  } catch (error) {
    if (error instanceof BackendValidationError) {
      throw new HttpError(400, `Invalid validator metadata: ${error.message}`);
    }
    throw error;
  }
}
