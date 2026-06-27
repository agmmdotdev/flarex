import { DurableObject } from "cloudflare:workers";
import { Effect, ManagedRuntime } from "effect";
import {
  executionArtifactRefForSourcePackage,
  validateExecutionArtifactRef,
} from "flarex/artifacts";
import {
  parseAnalyzedStartPushRequest,
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
  type AnalyzedStartPushRequest as ProtocolAnalyzedStartPushRequest,
} from "flarex-protocol/deployment";
import { makeDeploymentLayer } from "./deployment/Layer";
import { DeploymentService } from "./deployment/Service";
import type { DeploymentSqlError } from "./deployment/Store";
import { errorResponse, HttpError, json, readJson } from "./http";
import { rejectedFinishPushResponse } from "./pushResponses.ts";
import type {
  ActiveDeploymentStatus,
  AbandonPushRequest,
  AnalyzedStartPushRequest,
  AnalyzedSourcePosition,
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  DeploymentCodegenModule,
  DeploymentFunctionKind,
  DeploymentFunctionMetadata,
  FunctionPartitionMetadata,
  FunctionPartitionPolicy,
  FunctionRoutePolicy,
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  ExecutionArtifactRef,
  FinishPushResponse,
  FinishPushRequest,
  FunctionVisibility,
  Json,
  PushDiagnostic,
  PushSourcePackage,
  PushStatus,
  SchemaTable,
  ValidatorJson,
} from "./types";
import { assertValidatorJson, BackendValidationError } from "./validation";

export class DeploymentDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly deploymentRuntime = ManagedRuntime.make(
    makeDeploymentLayer(this.ctx.storage, this.sql, pushId => this.getPush(pushId)),
  );

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
        route_json TEXT,
        partition_json TEXT,
        position_json TEXT
      );
      CREATE TABLE IF NOT EXISTS pushes (
        push_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        source_package_json TEXT NOT NULL,
        schema_json TEXT,
        functions_json TEXT,
        codegen_analysis_json TEXT,
        error TEXT,
        diagnostics_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.ensureFunctionPositionColumn();
    this.ensureFunctionRouteColumn();
    this.ensureFunctionPartitionColumn();
    this.ensurePushCodegenAnalysisColumn();
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
      if (url.pathname === "/push/start-analyzed" && request.method === "POST") {
        const body = parseAnalyzedStartPushRequest(await readJson(request));
        return json(await this.startPush(analyzedStartPushRequest(body)));
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
          const response = await this.finishPush(pushId, await readJson<FinishPushRequest>(request));
          return json(response, { status: response.result === "rejected" ? 409 : 200 });
        }
        if (action === "abandon" && request.method === "POST") {
          const body = parseAbandonPushRequest(await readJson(request));
          return json(await this.abandonPush(
            pushId,
            body.reason === undefined ? {} : { reason: body.reason },
          ));
        }
      }
      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      if (error instanceof DeploymentProtocolValidationError) {
        return json({ error: error.message }, { status: 400 });
      }
      return errorResponse(error);
    }
  }

  private async startPush(request: AnalyzedStartPushRequest): Promise<PushStatus> {
    const sourcePackage = validateSourcePackage(request.sourcePackage);
    const error = request.error;
    const analysis = request.analysis === undefined ? undefined : validateAnalysis(request.analysis);
    const diagnostics = validateDiagnostics(request.diagnostics);
    if (analysis === undefined) {
      if (typeof error !== "string" || error.length === 0) {
        throw new HttpError(400, "A push without analysis must include an error message.");
      }
      return this.runDeployment(
        DeploymentService.use(service =>
          service.startAnalyzedPush({
            sourcePackage,
            error,
            diagnostics,
          })
        ),
      );
    }
    const hasCodegenAnalysis = Object.prototype.hasOwnProperty.call(request, "codegenAnalysis");
    const codegenAnalysis = validateCodegenAnalysis(
      hasCodegenAnalysis ? request.codegenAnalysis : codegenAnalysisFromDeploymentAnalysis(analysis),
      analysis,
    );
    return this.runDeployment(
      DeploymentService.use(service =>
        service.startAnalyzedPush({
          sourcePackage,
          analysis,
          codegenAnalysis,
          diagnostics,
        })
      ),
    );
  }

  private async runDeployment<A>(
    effect: Effect.Effect<A, DeploymentSqlError, DeploymentService>,
  ): Promise<A> {
    const result = await this.deploymentRuntime.runPromise(
      effect.pipe(
        Effect.match({
          onFailure: error => ({ ok: false as const, error }),
          onSuccess: value => ({ ok: true as const, value }),
        }),
      ),
    );
    if (!result.ok) {
      throw new HttpError(500, "Deployment storage error.");
    }
    return result.value;
  }

  private async finishPush(pushId: string, _request: FinishPushRequest): Promise<FinishPushResponse> {
    const preflight = this.getPush(pushId);
    if (!preflight) throw new HttpError(404, `Unknown push: ${pushId}`);
    const executionArtifactRef = await executionArtifactRefForSourcePackage(preflight.sourcePackage);

    return this.ctx.storage.transaction(async () => {
      const status = this.getPush(pushId);
      if (!status) throw new HttpError(404, `Unknown push: ${pushId}`);
      if (status.state !== "analyzed") {
        return rejectedFinishPushResponse(
          status,
          "invalid_state",
          `Cannot finish push ${pushId} in state ${status.state}.`,
        );
      }
      if (status.analysis === undefined) {
        return rejectedFinishPushResponse(
          status,
          "missing_analysis",
          `Push ${pushId} has no analysis to activate.`,
        );
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
      return { result: "activated", push: activated };
    });
  }

  private async abandonPush(pushId: string, request: AbandonPushRequest): Promise<PushStatus> {
    return this.ctx.storage.transaction(async () => {
      const status = this.getPush(pushId);
      if (!status) throw new HttpError(404, `Unknown push: ${pushId}`);
      if (status.state !== "pending" && status.state !== "analyzed") {
        throw new HttpError(409, `Cannot abandon push ${pushId} in state ${status.state}.`);
      }
      const now = Date.now();
      const reason = typeof request.reason === "string" && request.reason.length > 0
        ? request.reason.slice(0, 1000)
        : "Push abandoned before activation.";
      this.sql.exec(
        "UPDATE pushes SET state = 'abandoned', error = ?, updated_at = ? WHERE push_id = ?",
        reason,
        now,
        pushId,
      );
      const abandoned = this.getPush(pushId);
      if (!abandoned) throw new Error(`Abandoned push ${pushId} disappeared.`);
      return abandoned;
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
        codegen_analysis_json: string | null;
        error: string | null;
        diagnostics_json: string | null;
        created_at: number;
        updated_at: number;
      }>(
        `
        SELECT push_id, state, source_package_json, schema_json, functions_json, codegen_analysis_json, error, diagnostics_json, created_at, updated_at
        FROM pushes
        WHERE push_id = ?
        `,
        pushId,
      )
      .toArray()[0];
    if (!row) return null;
    return pushStatusFromRow(row);
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
        INSERT INTO functions (function_path, kind, visibility, args_json, returns_json, route_json, partition_json, position_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        metadata.path,
        metadata.kind,
        metadata.visibility,
        JSON.stringify(metadata.args),
        JSON.stringify(metadata.returns),
        JSON.stringify(metadata.route ?? null),
        JSON.stringify(metadata.partition ?? null),
        metadata.position === undefined ? null : JSON.stringify(metadata.position),
      );
    }
    return normalized;
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

  private ensurePushCodegenAnalysisColumn(): void {
    try {
      this.sql.exec("ALTER TABLE pushes ADD COLUMN codegen_analysis_json TEXT");
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

  private ensureFunctionRouteColumn(): void {
    try {
      this.sql.exec("ALTER TABLE functions ADD COLUMN route_json TEXT");
    } catch {
      // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN.
    }
  }

  private ensureFunctionPartitionColumn(): void {
    try {
      this.sql.exec("ALTER TABLE functions ADD COLUMN partition_json TEXT");
    } catch {
      // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN.
    }
  }
}

function pushStatusFromRow(row: {
  push_id: string;
  state: string;
  source_package_json: string;
  schema_json: string | null;
  functions_json: string | null;
  codegen_analysis_json: string | null;
  error: string | null;
  diagnostics_json: string | null;
  created_at: number;
  updated_at: number;
}): PushStatus {
  const storedAnalysis = row.schema_json === null || row.functions_json === null
    ? undefined
    : validateAnalysis({
      schema: JSON.parse(row.schema_json),
      functions: JSON.parse(row.functions_json),
    });
  const storedCodegenAnalysis: unknown = row.codegen_analysis_json === null
    ? undefined
    : JSON.parse(row.codegen_analysis_json);
  const diagnostics = row.diagnostics_json === null
    ? []
    : JSON.parse(row.diagnostics_json) as PushDiagnostic[];
  return {
    pushId: row.push_id,
    state: parsePushState(row.state),
    sourcePackage: JSON.parse(row.source_package_json) as PushSourcePackage,
    ...(storedAnalysis !== undefined
      ? {
          analysis: storedAnalysis,
          codegenAnalysis: storedCodegenAnalysis === undefined
            ? codegenAnalysisFromDeploymentAnalysis(storedAnalysis)
            : validateCodegenAnalysis(storedCodegenAnalysis, storedAnalysis),
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
      partition: metadata.partition ?? null,
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
    value === "abandoned" ||
    value === "superseded"
  ) {
    return value;
  }
  throw new Error(`Unknown stored push state ${value}.`);
}

function analyzedStartPushRequest(request: ProtocolAnalyzedStartPushRequest): AnalyzedStartPushRequest {
  const sourcePackage = validateSourcePackage(request.sourcePackage as PushSourcePackage);
  const diagnostics = request.diagnostics === undefined
    ? undefined
    : validateDiagnostics(request.diagnostics);
  if (request.analysis === undefined) {
    const error = request.error;
    if (error === undefined) {
      throw new Error("Parsed failed push request is missing error.");
    }
    return {
      sourcePackage,
      error,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    };
  }
  return {
    sourcePackage,
    analysis: request.analysis,
    ...(request.codegenAnalysis === undefined ? {} : { codegenAnalysis: request.codegenAnalysis }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
}

function validateAnalysis(analysis: unknown): DeploymentAnalysis {
  if (!isRecord(analysis)) {
    throw new HttpError(400, "Deployment analysis must be an object.");
  }
  const schema = validateSchema(analysis.schema);
  const functions = validateFunctions(analysis.functions);
  validateFunctionPartitions(functions, schema);
  return {
    schema,
    functions,
  };
}

function validateCodegenAnalysis(
  codegenAnalysis: unknown,
  analysis: DeploymentAnalysis,
): DeploymentCodegenAnalysis {
  if (!isRecord(codegenAnalysis)) {
    throw new HttpError(400, "Codegen analysis must be an object.");
  }
  const schema = validateSchema(codegenAnalysis.schema);
  if (canonicalJson(schema) !== canonicalJson(analysis.schema)) {
    throw new HttpError(400, "Codegen analysis schema must match deployment analysis schema.");
  }
  if (!Array.isArray(codegenAnalysis.functions)) {
    throw new HttpError(400, "Codegen analysis functions must be an array.");
  }

  const metadataByPath = new Map(analysis.functions.functions.map(metadata => [metadata.path, metadata]));
  const seenModuleNames = new Set<string>();
  const seenPaths = new Set<string>();
  const modules = codegenAnalysis.functions.map((module, moduleIndex) => {
    if (!isRecord(module)) {
      throw new HttpError(400, `Codegen module at index ${moduleIndex} must be an object.`);
    }
    if (typeof module.moduleName !== "string" || module.moduleName.length === 0) {
      throw new HttpError(400, `Codegen module at index ${moduleIndex} has an invalid moduleName.`);
    }
    if (!Array.isArray(module.functions)) {
      throw new HttpError(400, `Codegen module ${module.moduleName} functions must be an array.`);
    }
    const moduleName = module.moduleName;
    if (seenModuleNames.has(moduleName)) {
      throw new HttpError(400, `Duplicate codegen module metadata: ${moduleName}.`);
    }
    seenModuleNames.add(moduleName);
    return {
      moduleName,
      functions: module.functions.map((fn, functionIndex) => {
        if (!isRecord(fn)) {
          throw new HttpError(
            400,
            `Codegen function ${moduleName}[${functionIndex}] must be an object.`,
          );
        }
        if (fn.moduleName !== moduleName) {
          throw new HttpError(
            400,
            `Codegen function ${moduleName}[${functionIndex}] moduleName must match its module.`,
          );
        }
        if (typeof fn.exportName !== "string" || fn.exportName.length === 0) {
          throw new HttpError(
            400,
            `Codegen function ${moduleName}[${functionIndex}] has an invalid exportName.`,
          );
        }
        const exportName = fn.exportName;
        const path = functionPathFromCodegen(moduleName, exportName);
        const metadata = metadataByPath.get(path);
        if (metadata === undefined) {
          throw new HttpError(400, `Codegen function ${path} has no deployment function metadata.`);
        }
        if (seenPaths.has(path)) {
          throw new HttpError(400, `Duplicate codegen function metadata path: ${path}.`);
        }
        seenPaths.add(path);
        const kind = parseFunctionKind(fn.kind, `$codegen.functions.${path}.kind`);
        const visibility = parseVisibility(fn.visibility, `$codegen.functions.${path}.visibility`);
        const args = safeValidator(fn.args, `$codegen.functions.${path}.args`);
        if (args === null) {
          throw new HttpError(400, `$codegen.functions.${path}.args: Validator is required.`);
        }
        const returns = safeValidator(fn.returns ?? null, `$codegen.functions.${path}.returns`);
        const partition = validateFunctionPartitionPolicy(
          fn.partition,
          `$codegen.functions.${path}.partition`,
        );
        const position = validateSourcePosition(fn.position, `$codegen.functions.${path}.position`);
        assertCodegenFunctionMatchesMetadata(path, {
          kind,
          visibility,
          args,
          returns,
          partition,
          position,
        }, metadata);
        return {
          moduleName,
          exportName,
          kind,
          visibility,
          args,
          returns,
          partition,
          ...(position === undefined ? {} : { position }),
        };
      }),
    };
  });
  if (seenPaths.size !== metadataByPath.size) {
    throw new HttpError(400, "Codegen analysis functions must cover every deployment function.");
  }
  return { schema, functions: modules };
}

function assertCodegenFunctionMatchesMetadata(
  path: string,
  codegen: {
    kind: DeploymentFunctionKind;
    visibility: FunctionVisibility;
    args: ValidatorJson;
    returns: ValidatorJson | null;
    partition: FunctionPartitionMetadata | null;
    position: AnalyzedSourcePosition | undefined;
  },
  metadata: DeploymentFunctionMetadata,
): void {
  const expected = {
    kind: metadata.kind,
    visibility: metadata.visibility ?? "public",
    args: metadata.args ?? { type: "any" },
    returns: metadata.returns ?? null,
    partition: metadata.partition ?? null,
    position: metadata.position,
  };
  if (canonicalJson(codegen) !== canonicalJson(expected)) {
    throw new HttpError(400, `Codegen function ${path} must match deployment function metadata.`);
  }
}

function functionPathFromCodegen(moduleName: string, exportName: string): string {
  return exportName === "default" ? moduleName : `${moduleName}:${exportName}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSchema(schema: unknown): DeploymentSchema {
  if (!isRecord(schema)) {
    throw new HttpError(400, "Schema must be an object.");
  }
  if (typeof schema.version !== "number" || !Number.isInteger(schema.version) || schema.version < 0) {
    throw new HttpError(400, "Schema version must be a non-negative integer.");
  }
  if (!Array.isArray(schema.tables)) throw new HttpError(400, "Schema tables must be an array.");
  if (!Array.isArray(schema.indexes)) throw new HttpError(400, "Schema indexes must be an array.");

  const tableIds = new Set<number>();
  const normalizedTables = schema.tables.map(table => {
    if (!isRecord(table)) {
      throw new HttpError(400, "Schema table entry must be an object.");
    }
    const tableId = table.tableId;
    if (typeof tableId !== "number" || !Number.isInteger(tableId) || tableId <= 0) {
      throw new HttpError(400, `Invalid table id for ${table.name}.`);
    }
    if (tableIds.has(tableId)) throw new HttpError(400, `Duplicate table id ${tableId}.`);
    tableIds.add(tableId);
    const tableName = table.name;
    if (typeof tableName !== "string" || tableName.length === 0) {
      throw new HttpError(400, `Table ${tableId} has an invalid name.`);
    }
    return {
      tableId,
      name: tableName,
      state: parseTableState(table.state),
      validator: safeValidator(table.validator ?? null, `$schema.tables.${tableName}.validator`),
      placement: validatePlacement(table.placement, `$schema.tables.${tableName}.placement`),
    };
  });

  const indexIds = new Set<number>();
  const normalizedIndexes = schema.indexes.map(index => {
    if (!isRecord(index)) {
      throw new HttpError(400, "Schema index entry must be an object.");
    }
    const indexId = index.indexId;
    if (typeof indexId !== "number" || !Number.isInteger(indexId) || indexId <= 0) {
      throw new HttpError(400, `Invalid index id for ${index.name}.`);
    }
    if (indexIds.has(indexId)) throw new HttpError(400, `Duplicate index id ${indexId}.`);
    indexIds.add(indexId);
    const tableId = index.tableId;
    if (typeof tableId !== "number" || !tableIds.has(tableId)) {
      throw new HttpError(400, `Index ${index.name} references unknown table id ${String(index.tableId)}.`);
    }
    const indexName = index.name;
    if (typeof indexName !== "string" || indexName.length === 0) {
      throw new HttpError(400, `Index ${indexId} has an invalid name.`);
    }
    if (!Array.isArray(index.fields) || !index.fields.every(field => typeof field === "string")) {
      throw new HttpError(400, `Index ${indexName} has invalid fields.`);
    }
    return {
      indexId,
      tableId,
      name: indexName,
      fields: [...index.fields],
      state: parseIndexState(index.state),
    };
  });

  return { version: schema.version, tables: normalizedTables, indexes: normalizedIndexes };
}

function validateFunctions(functions: unknown): DeploymentFunctions {
  if (!isRecord(functions)) {
    throw new HttpError(400, "Function metadata must be an object.");
  }
  if (!Array.isArray(functions.functions)) {
    throw new HttpError(400, "Function metadata must include a functions array.");
  }
  const seen = new Set<string>();
  const normalized = functions.functions.map((metadata, index) => {
    if (!isRecord(metadata)) {
      throw new HttpError(400, `Function metadata at index ${index} must be an object.`);
    }
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
    const route = validateFunctionRoutePolicy(metadata.route, `$functions.${path}.route`);
    const partition = validateFunctionPartitionPolicy(
      metadata.partition,
      `$functions.${path}.partition`,
    );
    const position = validateSourcePosition(metadata.position, `$functions.${path}.position`);
    return {
      path,
      kind,
      visibility,
      args,
      returns,
      route,
      partition,
      ...(position === undefined ? {} : { position }),
    };
  });
  return { functions: normalized };
}

function parseTableState(value: unknown): NonNullable<SchemaTable["state"]> {
  if (value === undefined) return "active";
  if (value === "active" || value === "hidden" || value === "deleted") return value;
  throw new HttpError(400, "Schema table has invalid state.");
}

function parseIndexState(value: unknown): NonNullable<DeploymentSchema["indexes"][number]["state"]> {
  if (value === undefined) return "enabled";
  if (value === "enabled" || value === "staged" || value === "disabled") return value;
  throw new HttpError(400, "Schema index has invalid state.");
}

function validateFunctionPartitions(
  functions: DeploymentFunctions,
  schema: DeploymentSchema,
): void {
  const tables = new Map(schema.tables.map(table => [table.name, table]));
  for (const metadata of functions.functions) {
    const partition = metadata.partition;
    if (partition === undefined || partition === null) continue;
    const table = tables.get(partition.table);
    if (table === undefined || table.state === "deleted") {
      throw new HttpError(400, `${metadata.path}.partition: Unknown partition table ${partition.table}.`);
    }
    if (table.placement.kind !== "partitionBy") {
      throw new HttpError(400, `${metadata.path}.partition: Table ${partition.table} is not partitioned.`);
    }
    if (partition.type === "partitionCreateRoot") {
      if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
        throw new HttpError(
          400,
          `${metadata.path}.partition: create-root partition requires ${partition.table} to be partitioned by _id.`,
        );
      }
      if (metadata.route !== null && metadata.route !== undefined) {
        throw new HttpError(
          400,
          `${metadata.path}.partition: create-root partition cannot declare route metadata.`,
        );
      }
      continue;
    }
    if (table.placement.field !== partition.partitionField) {
      throw new HttpError(
        400,
        `${metadata.path}.partition: Selector ${partition.selector} targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
      );
    }
    const expectedSelector = selectorNameForPartitionField(table.placement.field);
    if (partition.selector !== expectedSelector) {
      throw new HttpError(
        400,
        `${metadata.path}.partition: Expected selector ${expectedSelector} for ${partition.table} partition field ${JSON.stringify(table.placement.field)}.`,
      );
    }
    if (!validatorHasRequiredField(metadata.args ?? null, partition.argField)) {
      throw new HttpError(
        400,
        `${metadata.path}.partition: args.${partition.argField} is not a required argument.`,
      );
    }
    if (
      metadata.route !== null &&
      metadata.route !== undefined &&
      metadata.route.type === "args" &&
      metadata.route.field !== partition.argField
    ) {
      throw new HttpError(
        400,
        `${metadata.path}.partition: partition argument ${partition.argField} must match route argument ${metadata.route.field}.`,
      );
    }
  }
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

function validateFunctionRoutePolicy(
  value: unknown,
  path: string,
): FunctionRoutePolicy | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${path}: Invalid route policy.`);
  }
  const route = value as Partial<FunctionRoutePolicy>;
  if (route.type === "args" && typeof route.field === "string" && route.field.length > 0) {
    return { type: "args", field: route.field };
  }
  throw new HttpError(400, `${path}: Invalid route policy.`);
}

function validateFunctionPartitionPolicy(
  value: unknown,
  path: string,
): FunctionPartitionMetadata | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${path}: Invalid partition policy.`);
  }
  const partition = value as Partial<FunctionPartitionMetadata>;
  if (
    partition.type === "partitionCreateRoot" &&
    typeof partition.table === "string" &&
    partition.table.length > 0 &&
    partition.partitionField === "_id"
  ) {
    return {
      type: "partitionCreateRoot",
      table: partition.table,
      partitionField: "_id",
    };
  }
  if (
    partition.type === "partition" &&
    typeof partition.table === "string" &&
    partition.table.length > 0 &&
    typeof partition.selector === "string" &&
    partition.selector.length > 0 &&
    typeof partition.partitionField === "string" &&
    partition.partitionField.length > 0 &&
    typeof partition.argField === "string" &&
    partition.argField.length > 0
  ) {
    return {
      type: "partition",
      table: partition.table,
      selector: partition.selector,
      partitionField: partition.partitionField,
      argField: partition.argField,
    };
  }
  throw new HttpError(400, `${path}: Invalid partition policy.`);
}

function selectorNameForPartitionField(field: string): string {
  if (field === "_id") return "byId";
  const suffix = field
    .split(/[^A-Za-z0-9]+/)
    .filter(part => part.length > 0)
    .map(capitalize)
    .join("");
  return suffix.length === 0 ? "byPartition" : `by${suffix}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function validatorHasRequiredField(validator: ValidatorJson | null, field: string): boolean {
  return (
    validator !== null &&
    validator.type === "object" &&
    Object.prototype.hasOwnProperty.call(validator.value, field) &&
    validator.value[field]?.optional === false
  );
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

function parseFunctionKind(value: unknown, path: string): DeploymentFunctionKind {
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

function parseVisibility(value: unknown, path: string): FunctionVisibility {
  if (value === "public" || value === "internal") return value;
  throw new HttpError(400, `${path}: Invalid function visibility ${value}.`);
}

function safeValidator(value: unknown, path: string): ValidatorJson | null {
  try {
    return assertValidatorJson(jsonValue(value, path), path);
  } catch (error) {
    if (error instanceof BackendValidationError) {
      throw new HttpError(400, `Invalid validator metadata: ${error.message}`);
    }
    throw error;
  }
}

function jsonValue(value: unknown, path: string): Json | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const parsed = jsonValue(item, `${path}[${index}]`);
      if (parsed === undefined) throw new HttpError(400, `${path}[${index}]: Expected JSON value.`);
      return parsed;
    });
  }
  if (isRecord(value)) {
    const record: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      const parsed = jsonValue(item, `${path}.${key}`);
      if (parsed === undefined) throw new HttpError(400, `${path}.${key}: Expected JSON value.`);
      record[key] = parsed;
    }
    return record;
  }
  throw new HttpError(400, `${path}: Expected JSON value.`);
}
