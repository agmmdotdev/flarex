import { DurableObject } from "cloudflare:workers";
import { errorResponse, HttpError, json, readJson } from "./http";
import type {
  ActiveDeploymentStatus,
  AnalyzedStartPushRequest,
  AnalyzedSourcePosition,
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  DeploymentCodegenModule,
  DeploymentFunctionKind,
  DeploymentFunctionMetadata,
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  ExecutionArtifactRef,
  FinishPushRequest,
  FunctionVisibility,
  Json,
  PushDiagnostic,
  PushSourcePackage,
  PushStatus,
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
        returns_json TEXT,
        position_json TEXT
      );
      CREATE TABLE IF NOT EXISTS pushes (
        push_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        source_package_json TEXT NOT NULL,
        schema_json TEXT,
        functions_json TEXT,
        error TEXT,
        diagnostics_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.ensureFunctionPositionColumn();
    this.ensurePushDiagnosticsColumn();
    this.setMetaIfMissing("schema_version", "0");
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return json({ service: "flarex-deployment", status: "ok" });
      }
      if (url.pathname === "/deployment" && request.method === "GET") {
        const active = this.getActiveDeployment();
        if (!active) throw new HttpError(404, "No active deployment.");
        return json(active);
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
      if (url.pathname === "/push/start-analyzed" && request.method === "POST") {
        return json(await this.startPush(await readJson<AnalyzedStartPushRequest>(request)));
      }
      const pushMatch = url.pathname.match(/^\/push\/([^/]+)(?:\/([^/]+))?$/);
      if (pushMatch) {
        const pushId = decodeURIComponent(pushMatch[1]!);
        const action = pushMatch[2];
        if (action === undefined && request.method === "GET") {
          const status = this.getPush(pushId);
          if (!status) throw new HttpError(404, `Unknown push: ${pushId}`);
          return json(status);
        }
        if (action === "finish" && request.method === "POST") {
          return json(await this.finishPush(pushId, await readJson<FinishPushRequest>(request)));
        }
      }
      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      return errorResponse(error);
    }
  }

  private async startPush(request: AnalyzedStartPushRequest): Promise<PushStatus> {
    const sourcePackage = validateSourcePackage(request.sourcePackage);
    const now = Date.now();
    const pushId = crypto.randomUUID();
    const error = request.error;
    const analysis = request.analysis === undefined ? undefined : validateAnalysis(request.analysis);
    const diagnostics = validateDiagnostics(request.diagnostics);
    const state = analysis === undefined ? "failed" : "analyzed";
    if (analysis === undefined && (typeof error !== "string" || error.length === 0)) {
      throw new HttpError(400, "A push without analysis must include an error message.");
    }

    return this.ctx.storage.transaction(async () => {
      this.sql.exec(
        "UPDATE pushes SET state = 'superseded', updated_at = ? WHERE state IN ('pending', 'analyzed')",
        now,
      );
      this.sql.exec(
        `
        INSERT INTO pushes (
          push_id,
          state,
          source_package_json,
          schema_json,
          functions_json,
          error,
          diagnostics_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        pushId,
        state,
        JSON.stringify(sourcePackage),
        analysis === undefined ? null : JSON.stringify(analysis.schema),
        analysis === undefined ? null : JSON.stringify(analysis.functions),
        error ?? null,
        diagnostics.length === 0 ? null : JSON.stringify(diagnostics),
        now,
        now,
      );
      const status = this.getPush(pushId);
      if (!status) throw new Error(`Push ${pushId} was not stored.`);
      return status;
    });
  }

  private async finishPush(pushId: string, _request: FinishPushRequest): Promise<PushStatus> {
    const preflight = this.getPush(pushId);
    if (!preflight) throw new HttpError(404, `Unknown push: ${pushId}`);
    const executionArtifactRef = await executionArtifactRefForSourcePackage(preflight.sourcePackage);

    return this.ctx.storage.transaction(async () => {
      const status = this.getPush(pushId);
      if (!status) throw new HttpError(404, `Unknown push: ${pushId}`);
      if (status.state !== "analyzed") {
        throw new HttpError(409, `Cannot finish push ${pushId} in state ${status.state}.`);
      }
      if (status.analysis === undefined) {
        throw new HttpError(409, `Push ${pushId} has no analysis to activate.`);
      }
      this.applySchema(status.analysis.schema);
      this.applyFunctions(status.analysis.functions);
      const now = Date.now();
      this.sql.exec(
        "UPDATE pushes SET state = 'activated', updated_at = ? WHERE push_id = ?",
        now,
        pushId,
      );
      this.setMeta("active_push_id", pushId);
      this.setMeta("active_activated_at", String(now));
      this.setMeta("active_execution_artifact_ref", JSON.stringify(executionArtifactRef));
      const activated = this.getPush(pushId);
      if (!activated) throw new Error(`Activated push ${pushId} disappeared.`);
      return activated;
    });
  }

  private getActiveDeployment(): ActiveDeploymentStatus | null {
    const activePushId = this.getMeta("active_push_id");
    if (activePushId === null) return null;
    const push = this.getPush(activePushId);
    if (push === null) {
      throw new Error(`Active push ${activePushId} is missing.`);
    }
    if (push.analysis === undefined || push.codegenAnalysis === undefined) {
      throw new Error(`Active push ${activePushId} has no analyzed deployment metadata.`);
    }
    const executionArtifactRef = this.getActiveExecutionArtifactRef(activePushId);
    return {
      activePushId,
      activatedAt: Number(this.getMeta("active_activated_at") ?? push.updatedAt),
      schemaVersion: push.analysis.schema.version,
      executionArtifactRef,
      sourcePackage: push.sourcePackage,
      analysis: push.analysis,
      codegenAnalysis: push.codegenAnalysis,
    };
  }

  private getActiveExecutionArtifactRef(activePushId: string): ExecutionArtifactRef {
    const raw = this.getMeta("active_execution_artifact_ref");
    if (raw === null) {
      throw new Error(`Active push ${activePushId} has no execution artifact reference.`);
    }
    return validateExecutionArtifactRef(JSON.parse(raw));
  }

  private getPush(pushId: string): PushStatus | null {
    const row = this.sql
      .exec<{
        push_id: string;
        state: string;
        source_package_json: string;
        schema_json: string | null;
        functions_json: string | null;
        error: string | null;
        diagnostics_json: string | null;
        created_at: number;
        updated_at: number;
      }>(
        `
        SELECT push_id, state, source_package_json, schema_json, functions_json, error, diagnostics_json, created_at, updated_at
        FROM pushes
        WHERE push_id = ?
        `,
        pushId,
      )
      .toArray()[0];
    if (!row) return null;
    return pushStatusFromRow(row);
  }

  private async putSchema(schema: DeploymentSchema): Promise<DeploymentSchema> {
    return this.ctx.storage.transaction(async () => {
      return this.applySchema(schema);
    });
  }

  private async putFunctions(functions: DeploymentFunctions): Promise<DeploymentFunctions> {
    return this.ctx.storage.transaction(async () => {
      return this.applyFunctions(functions);
    });
  }

  private applySchema(schema: DeploymentSchema): DeploymentSchema {
    const normalized = validateSchema(schema);
    this.sql.exec("DELETE FROM indexes");
    this.sql.exec("DELETE FROM tables");
    for (const table of normalized.tables) {
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
    for (const index of normalized.indexes) {
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
    this.setMeta("schema_version", String(normalized.version));
    return normalized;
  }

  private applyFunctions(functions: DeploymentFunctions): DeploymentFunctions {
    const normalized = validateFunctions(functions);
    this.sql.exec("DELETE FROM functions");
    for (const metadata of normalized.functions) {
      this.sql.exec(
        `
        INSERT INTO functions (function_path, kind, visibility, args_json, returns_json, position_json)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        metadata.path,
        metadata.kind,
        metadata.visibility,
        JSON.stringify(metadata.args),
        JSON.stringify(metadata.returns),
        metadata.position === undefined ? null : JSON.stringify(metadata.position),
      );
    }
    return normalized;
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
          position_json: string | null;
        }>(
          `
          SELECT function_path, kind, visibility, args_json, returns_json, position_json
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
        position_json: string | null;
      }>(
        `
        SELECT function_path, kind, visibility, args_json, returns_json, position_json
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

  private ensurePushDiagnosticsColumn(): void {
    try {
      this.sql.exec("ALTER TABLE pushes ADD COLUMN diagnostics_json TEXT");
    } catch {
      // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN. Existing
      // deployments created after the column was added will raise here.
    }
  }

  private ensureFunctionPositionColumn(): void {
    try {
      this.sql.exec("ALTER TABLE functions ADD COLUMN position_json TEXT");
    } catch {
      // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN.
    }
  }
}

function functionMetadataFromRow(row: {
  function_path: string;
  kind: string;
  visibility: string;
  args_json: string | null;
  returns_json: string | null;
  position_json: string | null;
}): DeploymentFunctionMetadata {
  return {
    path: row.function_path,
    kind: row.kind as DeploymentFunctionKind,
    visibility: row.visibility as FunctionVisibility,
    args: JSON.parse(row.args_json ?? "null") as ValidatorJson | null,
    returns: JSON.parse(row.returns_json ?? "null") as ValidatorJson | null,
    ...(row.position_json === null
      ? {}
      : { position: JSON.parse(row.position_json) as AnalyzedSourcePosition }),
  };
}

function pushStatusFromRow(row: {
  push_id: string;
  state: string;
  source_package_json: string;
  schema_json: string | null;
  functions_json: string | null;
  error: string | null;
  diagnostics_json: string | null;
  created_at: number;
  updated_at: number;
}): PushStatus {
  const schema = row.schema_json === null ? undefined : JSON.parse(row.schema_json) as DeploymentSchema;
  const functions = row.functions_json === null
    ? undefined
    : JSON.parse(row.functions_json) as DeploymentFunctions;
  const diagnostics = row.diagnostics_json === null
    ? []
    : JSON.parse(row.diagnostics_json) as PushDiagnostic[];
  return {
    pushId: row.push_id,
    state: parsePushState(row.state),
    sourcePackage: JSON.parse(row.source_package_json) as PushSourcePackage,
    ...(schema !== undefined && functions !== undefined
      ? {
          analysis: { schema, functions },
          codegenAnalysis: codegenAnalysisFromDeploymentAnalysis({ schema, functions }),
        }
      : {}),
    ...(row.error === null ? {} : { error: row.error }),
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function codegenAnalysisFromDeploymentAnalysis(
  analysis: DeploymentAnalysis,
): DeploymentCodegenAnalysis {
  const modules = new Map<string, DeploymentCodegenModule>();
  for (const metadata of analysis.functions.functions) {
    const { moduleName, exportName } = parseFunctionPath(metadata.path);
    const module = modules.get(moduleName) ?? { moduleName, functions: [] };
    module.functions.push({
      moduleName,
      exportName,
      kind: metadata.kind,
      visibility: metadata.visibility ?? "public",
      args: metadata.args ?? { type: "any" },
      returns: metadata.returns ?? null,
      ...(metadata.position === undefined ? {} : { position: metadata.position }),
    });
    modules.set(moduleName, module);
  }
  return {
    schema: analysis.schema,
    functions: [...modules.values()]
      .map(module => ({
        ...module,
        functions: module.functions.sort((left, right) =>
          left.exportName.localeCompare(right.exportName),
        ),
      }))
      .sort((left, right) => left.moduleName.localeCompare(right.moduleName)),
  };
}

function parseFunctionPath(path: string): { moduleName: string; exportName: string } {
  const separator = path.indexOf(":");
  if (separator === -1) return { moduleName: path, exportName: "default" };
  return {
    moduleName: path.slice(0, separator),
    exportName: path.slice(separator + 1),
  };
}

function parsePushState(value: string): PushStatus["state"] {
  if (
    value === "pending" ||
    value === "analyzed" ||
    value === "failed" ||
    value === "activated" ||
    value === "superseded"
  ) {
    return value;
  }
  throw new Error(`Unknown stored push state ${value}.`);
}

function validateAnalysis(analysis: DeploymentAnalysis): DeploymentAnalysis {
  return {
    schema: validateSchema(analysis.schema),
    functions: validateFunctions(analysis.functions),
  };
}

function validateSchema(schema: DeploymentSchema): DeploymentSchema {
  if (typeof schema.version !== "number" || !Number.isInteger(schema.version) || schema.version < 0) {
    throw new HttpError(400, "Schema version must be a non-negative integer.");
  }
  if (!Array.isArray(schema.tables)) throw new HttpError(400, "Schema tables must be an array.");
  if (!Array.isArray(schema.indexes)) throw new HttpError(400, "Schema indexes must be an array.");

  const tableIds = new Set<number>();
  const normalizedTables = schema.tables.map(table => {
    if (typeof table.tableId !== "number" || !Number.isInteger(table.tableId) || table.tableId <= 0) {
      throw new HttpError(400, `Invalid table id for ${table.name}.`);
    }
    if (tableIds.has(table.tableId)) throw new HttpError(400, `Duplicate table id ${table.tableId}.`);
    tableIds.add(table.tableId);
    if (typeof table.name !== "string" || table.name.length === 0) {
      throw new HttpError(400, `Table ${table.tableId} has an invalid name.`);
    }
    return {
      ...table,
      state: table.state ?? "active",
      validator: safeValidator(table.validator ?? null, `$schema.tables.${table.name}.validator`),
      placement: validatePlacement(table.placement, `$schema.tables.${table.name}.placement`),
    };
  });

  const indexIds = new Set<number>();
  const normalizedIndexes = schema.indexes.map(index => {
    if (typeof index.indexId !== "number" || !Number.isInteger(index.indexId) || index.indexId <= 0) {
      throw new HttpError(400, `Invalid index id for ${index.name}.`);
    }
    if (indexIds.has(index.indexId)) throw new HttpError(400, `Duplicate index id ${index.indexId}.`);
    indexIds.add(index.indexId);
    if (!tableIds.has(index.tableId)) {
      throw new HttpError(400, `Index ${index.name} references unknown table id ${index.tableId}.`);
    }
    if (typeof index.name !== "string" || index.name.length === 0) {
      throw new HttpError(400, `Index ${index.indexId} has an invalid name.`);
    }
    if (!Array.isArray(index.fields) || !index.fields.every(field => typeof field === "string")) {
      throw new HttpError(400, `Index ${index.name} has invalid fields.`);
    }
    return {
      ...index,
      fields: [...index.fields],
      state: index.state ?? "enabled",
    };
  });

  return { version: schema.version, tables: normalizedTables, indexes: normalizedIndexes };
}

function validateFunctions(functions: DeploymentFunctions): DeploymentFunctions {
  if (!Array.isArray(functions.functions)) {
    throw new HttpError(400, "Function metadata must include a functions array.");
  }
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
    const position = validateSourcePosition(metadata.position, `$functions.${path}.position`);
    return {
      path,
      kind,
      visibility,
      args,
      returns,
      ...(position === undefined ? {} : { position }),
    };
  });
  return { functions: normalized };
}

function validateSourcePosition(
  value: unknown,
  path: string,
): AnalyzedSourcePosition | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${path}: Invalid source position.`);
  }
  const position = value as Partial<AnalyzedSourcePosition>;
  if (typeof position.path !== "string" || position.path.length === 0) {
    throw new HttpError(400, `${path}.path: Source position path must be a non-empty string.`);
  }
  if (
    typeof position.startLine !== "number" ||
    !Number.isInteger(position.startLine) ||
    position.startLine <= 0
  ) {
    throw new HttpError(400, `${path}.startLine: Source position line must be a positive integer.`);
  }
  if (
    typeof position.startColumn !== "number" ||
    !Number.isInteger(position.startColumn) ||
    position.startColumn <= 0
  ) {
    throw new HttpError(400, `${path}.startColumn: Source position column must be a positive integer.`);
  }
  return {
    path: position.path,
    startLine: position.startLine,
    startColumn: position.startColumn,
  };
}

function validateSourcePackage(sourcePackage: PushSourcePackage): PushSourcePackage {
  if (!Array.isArray(sourcePackage.modules)) {
    throw new HttpError(400, "Source package modules must be an array.");
  }
  if (!Array.isArray(sourcePackage.functions)) {
    throw new HttpError(400, "Source package functions must be an array.");
  }
  if (typeof sourcePackage.execution !== "string" || sourcePackage.execution.length === 0) {
    throw new HttpError(400, "Source package execution module is required.");
  }
  const seen = new Set<string>();
  const modules = sourcePackage.modules.map(module => {
    if (typeof module.path !== "string" || module.path.length === 0) {
      throw new HttpError(400, "Source package module has an invalid path.");
    }
    if (seen.has(module.path)) throw new HttpError(400, `Duplicate source module path: ${module.path}.`);
    seen.add(module.path);
    if (module.environment !== "isolate") {
      throw new HttpError(400, `Source module ${module.path} has unsupported environment ${module.environment}.`);
    }
    if (typeof module.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(module.sha256)) {
      throw new HttpError(400, `Source module ${module.path} has an invalid sha256.`);
    }
    if (module.source !== undefined && typeof module.source !== "string") {
      throw new HttpError(400, `Source module ${module.path} source must be a string.`);
    }
    if (module.sourceMap !== undefined && typeof module.sourceMap !== "string") {
      throw new HttpError(400, `Source module ${module.path} sourceMap must be a string.`);
    }
    return { ...module };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (!seen.has(sourcePackage.execution)) {
    throw new HttpError(400, `Source package execution module ${sourcePackage.execution} is missing.`);
  }
  if (sourcePackage.schema !== undefined && !seen.has(sourcePackage.schema)) {
    throw new HttpError(400, `Source package schema module ${sourcePackage.schema} is missing.`);
  }
  const functions = [...sourcePackage.functions].sort();
  for (const fn of functions) {
    if (typeof fn !== "string" || !seen.has(fn)) {
      throw new HttpError(400, `Source package function module ${String(fn)} is missing.`);
    }
  }
  return {
    modules,
    functions,
    ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
    execution: sourcePackage.execution,
  };
}

async function executionArtifactRefForSourcePackage(
  sourcePackage: PushSourcePackage,
): Promise<ExecutionArtifactRef> {
  const sourcePackageHash = await sha256Hex(stableSourcePackageManifest(sourcePackage));
  return {
    runtime: "dynamic-worker",
    artifactId: `artifact_${sourcePackageHash.slice(0, 32)}`,
    sourcePackageHash,
    executionModule: sourcePackage.execution,
  };
}

function stableSourcePackageManifest(sourcePackage: PushSourcePackage): string {
  return JSON.stringify({
    execution: sourcePackage.execution,
    schema: sourcePackage.schema ?? null,
    functions: [...sourcePackage.functions].sort(),
    modules: [...sourcePackage.modules]
      .map(module => ({
        path: module.path,
        environment: module.environment,
        sha256: module.sha256,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateExecutionArtifactRef(value: unknown): ExecutionArtifactRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored execution artifact reference is invalid.");
  }
  const ref = value as Partial<ExecutionArtifactRef>;
  if (ref.runtime !== "dynamic-worker") {
    throw new Error("Stored execution artifact reference has an invalid runtime.");
  }
  if (typeof ref.artifactId !== "string" || !/^artifact_[a-f0-9]{32}$/.test(ref.artifactId)) {
    throw new Error("Stored execution artifact reference has an invalid artifact ID.");
  }
  if (
    typeof ref.sourcePackageHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(ref.sourcePackageHash)
  ) {
    throw new Error("Stored execution artifact reference has an invalid source package hash.");
  }
  if (typeof ref.executionModule !== "string" || ref.executionModule.length === 0) {
    throw new Error("Stored execution artifact reference has an invalid execution module.");
  }
  return {
    runtime: ref.runtime,
    artifactId: ref.artifactId,
    sourcePackageHash: ref.sourcePackageHash,
    executionModule: ref.executionModule,
  };
}

function validateDiagnostics(value: unknown): PushDiagnostic[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HttpError(400, "Push diagnostics must be an array.");
  }
  return value.slice(-100).map((diagnostic, index) => {
    if (typeof diagnostic !== "object" || diagnostic === null || Array.isArray(diagnostic)) {
      throw new HttpError(400, `Push diagnostic at index ${index} must be an object.`);
    }
    const record = diagnostic as Partial<PushDiagnostic>;
    if (record.level !== "log" && record.level !== "warn" && record.level !== "error") {
      throw new HttpError(400, `Push diagnostic at index ${index} has an invalid level.`);
    }
    if (typeof record.message !== "string") {
      throw new HttpError(400, `Push diagnostic at index ${index} has an invalid message.`);
    }
    return {
      level: record.level,
      message: record.message,
    };
  });
}

function validatePlacement(value: unknown, path: string): SchemaTable["placement"] {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("kind" in value)) {
    throw new HttpError(400, `${path}: Invalid placement.`);
  }
  const placement = value as Partial<SchemaTable["placement"]>;
  if (placement.kind === "global") return { kind: "global" };
  if (placement.kind === "partitionBy" && typeof placement.field === "string") {
    return { kind: "partitionBy", field: placement.field };
  }
  if (
    placement.kind === "colocateWith" &&
    typeof placement.table === "string" &&
    typeof placement.field === "string"
  ) {
    return { kind: "colocateWith", table: placement.table, field: placement.field };
  }
  throw new HttpError(400, `${path}: Invalid placement.`);
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
