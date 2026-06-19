import { DurableObject } from "cloudflare:workers";
import {
  executionArtifactRefForSourcePackage,
  validateExecutionArtifactRef,
} from "flarex/artifacts";
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
  FunctionPartitionMetadata,
  FunctionPartitionPolicy,
  FunctionRoutePolicy,
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
        error TEXT,
        diagnostics_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.ensureFunctionPositionColumn();
    this.ensureFunctionRouteColumn();
    this.ensureFunctionPartitionColumn();
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
      route: metadata.route ?? null,
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
    value === "superseded"
  ) {
    return value;
  }
  throw new Error(`Unknown stored push state ${value}.`);
}

function validateAnalysis(analysis: DeploymentAnalysis): DeploymentAnalysis {
  const schema = validateSchema(analysis.schema);
  const functions = validateFunctions(analysis.functions);
  validateFunctionPartitions(functions, schema);
  return {
    schema,
    functions,
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
        `${metadata.path}.partition: Expected selector ${expectedSelector} for ${partition.table}.partitionBy(${JSON.stringify(table.placement.field)}).`,
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
