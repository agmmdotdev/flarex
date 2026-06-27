import { DurableObject } from "cloudflare:workers";
import { Effect, ManagedRuntime } from "effect";
import {
  parseAnalyzedStartPushRequest,
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
  type AnalyzedStartPushRequest as ProtocolAnalyzedStartPushRequest,
} from "flarex-protocol/deployment";
import { makeDeploymentLayer } from "./deployment/Layer";
import {
  DeploymentActiveDeploymentNotFoundError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
} from "./deployment/Errors";
import { DeploymentService } from "./deployment/Service";
import type { DeploymentSqlError } from "./deployment/Store";
import {
  canonicalJson,
  isRecord,
  parseFunctionKind,
  parseVisibility,
  safeValidator,
  validateDiagnostics,
  validateFunctionPartitionPolicy,
  validateFunctionPartitions,
  validateFunctions,
  validateSchema,
  validateSourcePackage,
  validateSourcePosition,
} from "./deployment/Validation";
import { errorResponse, HttpError, json, readJson } from "./http";
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
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  FinishPushResponse,
  FinishPushRequest,
  FunctionVisibility,
  PushDiagnostic,
  PushSourcePackage,
  PushStatus,
  ValidatorJson,
} from "./types";

export class DeploymentDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly deploymentRuntime = ManagedRuntime.make(
    makeDeploymentLayer(
      this.ctx.storage,
      this.sql,
      pushId => this.getPush(pushId),
      schema => this.applySchema(schema),
      functions => this.applyFunctions(functions),
      (key, value) => this.setMeta(key, value),
      key => this.getMeta(key),
    ),
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
        return json(await this.activeDeployment());
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
          return json(await this.pushStatus(pushId));
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
    effect: Effect.Effect<
      A,
      | DeploymentActiveDeploymentNotFoundError
      | DeploymentPushInvalidStateError
      | DeploymentPushNotFoundError
      | DeploymentSqlError
      | HttpError,
      DeploymentService
    >,
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
      if (result.error instanceof DeploymentActiveDeploymentNotFoundError) {
        throw new HttpError(404, "No active deployment.");
      }
      if (result.error instanceof DeploymentPushNotFoundError) {
        throw new HttpError(404, `Unknown push: ${result.error.pushId}`);
      }
      if (result.error instanceof DeploymentPushInvalidStateError) {
        if (result.error.action === "abandon") {
          throw new HttpError(409, `Cannot abandon push ${result.error.pushId} in state ${result.error.state}.`);
        }
      }
      if (result.error instanceof HttpError) {
        throw result.error;
      }
      throw new HttpError(500, "Deployment storage error.");
    }
    return result.value;
  }

  private async activeDeployment(): Promise<ActiveDeploymentStatus> {
    return this.runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()),
    );
  }

  private async pushStatus(pushId: string): Promise<PushStatus> {
    return this.runDeployment(
      DeploymentService.use(service => service.getPush(pushId)),
    );
  }

  private async finishPush(pushId: string, _request: FinishPushRequest): Promise<FinishPushResponse> {
    return this.runDeployment(
      DeploymentService.use(service => service.finishPush(pushId)),
    );
  }

  private async abandonPush(pushId: string, request: AbandonPushRequest): Promise<PushStatus> {
    return this.runDeployment(
      DeploymentService.use(service => service.abandonPush(pushId, request)),
    );
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
