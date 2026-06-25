import type { Miniflare } from "miniflare";
import { assertValidatorJson } from "flarex/validator-json";
import type { ValidatorJSON } from "flarex/values";
import type {
  DeploymentAnalysis as BackendDeploymentAnalysis,
  AbandonPushRequest,
  AnalyzeSourcePackageResponse,
  DeploymentCodegenAnalysis as BackendDeploymentCodegenAnalysis,
  DeploymentFunctionMetadata,
  FinishPushRequest,
  FunctionPartitionMetadata,
  PushState,
  StartPushRequest,
  ValidatorJson as BackendValidatorJson,
} from "flarex-backend/types";
import type { DeploymentAnalysis as CodegenDeploymentAnalysis } from "./analyze.ts";
import {
  ExecutionArtifactAnalysisError,
  LocalMiniflareExecutionArtifactAdapter,
  type AnalyzerDiagnostic,
  type ExecutionArtifactAdapter,
  normalizeAnalyzerDiagnostics,
} from "./executionArtifact.ts";
import type { SourcePackage } from "./sourcePackage.ts";

export type DevPushStatus = {
  pushId: string;
  state: PushState;
  analysis?: BackendDeploymentAnalysis;
  codegenAnalysis?: CodegenDeploymentAnalysis;
  error?: string;
  diagnostics?: AnalyzerDiagnostic[];
};

export function devPushStatusErrorMessage(status: DevPushStatus, message: string): string {
  const details = [
    ...(status.error === undefined ? [] : [`Backend error: ${status.error}`]),
    ...(status.diagnostics ?? []).map(
      diagnostic => `Backend diagnostic (${diagnostic.level}): ${diagnostic.message}`,
    ),
  ];
  const summary = `${message}: ${status.state}.`;
  return details.length === 0 ? summary : `${summary}\n${details.join("\n")}`;
}

export interface BackendPushCoordinator {
  start(sourcePackage: SourcePackage): Promise<DevPushStatus>;
  finish(pushId: string): Promise<DevPushStatus>;
  abandon?(pushId: string, request?: AbandonPushRequest): Promise<DevPushStatus>;
}

export interface BackendSourceAnalyzer {
  analyze(sourcePackage: SourcePackage): Promise<BackendSourceAnalysisResult>;
}

export type BackendSourceAnalysisResult = {
  analysis: CodegenDeploymentAnalysis;
  diagnostics?: AnalyzerDiagnostic[];
};

export type HttpBackendSourceAnalyzerOptions = {
  url: string | URL;
  deploymentId: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
};

export type HttpBackendPushCoordinatorOptions = {
  url: string | URL;
  deploymentId: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
};

const NONDETERMINISTIC_ANALYSIS_ERROR =
  "Flarex analysis is nondeterministic across cold isolates.";

export class LocalExecutionArtifactBackendAnalyzer implements BackendSourceAnalyzer {
  private readonly executionArtifact: ExecutionArtifactAdapter;

  constructor(executionArtifact: ExecutionArtifactAdapter = new LocalMiniflareExecutionArtifactAdapter()) {
    this.executionArtifact = executionArtifact;
  }

  async analyze(sourcePackage: SourcePackage): Promise<BackendSourceAnalysisResult> {
    const first = await this.analyzeOnce(sourcePackage);
    const second = await this.analyzeOnce(sourcePackage);
    const diagnostics = [...(first.diagnostics ?? []), ...(second.diagnostics ?? [])];
    if (stableAnalysisJson(first.analysis) !== stableAnalysisJson(second.analysis)) {
      throw new ExecutionArtifactAnalysisError(NONDETERMINISTIC_ANALYSIS_ERROR, [
        ...diagnostics,
        { level: "error", message: NONDETERMINISTIC_ANALYSIS_ERROR },
      ]);
    }
    return {
      analysis: first.analysis,
      diagnostics,
    };
  }

  private async analyzeOnce(sourcePackage: SourcePackage): Promise<BackendSourceAnalysisResult> {
    if (this.executionArtifact.analyzeWithDiagnostics !== undefined) {
      return this.executionArtifact.analyzeWithDiagnostics(sourcePackage);
    }
    return {
      analysis: await this.executionArtifact.analyze(sourcePackage),
      diagnostics: [],
    };
  }
}

export class HttpBackendSourceAnalyzer implements BackendSourceAnalyzer {
  private readonly url: string;
  private readonly deploymentId: string;
  private readonly fetcher: typeof fetch;
  private readonly headers: HeadersInit | undefined;

  constructor(options: HttpBackendSourceAnalyzerOptions) {
    this.url = String(options.url);
    this.deploymentId = options.deploymentId;
    this.fetcher = options.fetch ?? fetch;
    this.headers = options.headers;
  }

  async analyze(sourcePackage: SourcePackage): Promise<BackendSourceAnalysisResult> {
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: analyzerHeaders(this.headers),
      body: JSON.stringify({
        deploymentId: this.deploymentId,
        sourcePackage,
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    const diagnostics = diagnosticsFromBody(body);
    if (!response.ok) {
      throw new ExecutionArtifactAnalysisError(
        errorMessageFromBody(body) ?? `Backend analyzer request failed with status ${response.status}.`,
        diagnostics,
      );
    }
    const codegenAnalysis = parseCodegenAnalysisFromBody(body);
    if (!codegenAnalysis.ok) {
      throw new ExecutionArtifactAnalysisError(
        codegenAnalysis.message,
        diagnostics,
      );
    }
    return {
      analysis: codegenAnalysis.analysis,
      diagnostics,
    };
  }
}

export class LocalBackendPushCoordinator implements BackendPushCoordinator {
  private readonly backend: Miniflare;
  private readonly deploymentId: string;

  constructor(backend: Miniflare, deploymentId: string) {
    this.backend = backend;
    this.deploymentId = deploymentId;
  }

  async start(sourcePackage: SourcePackage): Promise<DevPushStatus> {
    return postBackend<DevPushStatus>(
      this.backend,
      `/deployments/${this.deploymentId}/push/start`,
      {
        sourcePackage,
      },
    );
  }

  finish(pushId: string): Promise<DevPushStatus> {
    return postBackend<DevPushStatus>(
      this.backend,
      `/deployments/${this.deploymentId}/push/${pushId}/finish`,
      {},
    );
  }

  abandon(pushId: string, request: AbandonPushRequest = {}): Promise<DevPushStatus> {
    return postBackend<DevPushStatus>(
      this.backend,
      `/deployments/${this.deploymentId}/push/${pushId}/abandon`,
      request,
    );
  }
}

export class HttpBackendPushCoordinator implements BackendPushCoordinator {
  private readonly url: string;
  private readonly deploymentId: string;
  private readonly fetcher: typeof fetch;
  private readonly headers: HeadersInit | undefined;

  constructor(options: HttpBackendPushCoordinatorOptions) {
    this.url = String(options.url);
    this.deploymentId = options.deploymentId;
    this.fetcher = options.fetch ?? fetch;
    this.headers = options.headers;
  }

  async start(sourcePackage: SourcePackage): Promise<DevPushStatus> {
    const body = {
      sourcePackage,
    } satisfies StartPushRequest;
    return await this.post(`/deployments/${encodeURIComponent(this.deploymentId)}/push/start`, {
      ...body,
    });
  }

  async finish(pushId: string): Promise<DevPushStatus> {
    const body = {} satisfies FinishPushRequest;
    return await this.post(
      `/deployments/${encodeURIComponent(this.deploymentId)}/push/${encodeURIComponent(pushId)}/finish`,
      body,
    );
  }

  async abandon(pushId: string, request: AbandonPushRequest = {}): Promise<DevPushStatus> {
    const body = request satisfies AbandonPushRequest;
    return await this.post(
      `/deployments/${encodeURIComponent(this.deploymentId)}/push/${encodeURIComponent(pushId)}/abandon`,
      body,
    );
  }

  private async post(path: string, body: unknown): Promise<DevPushStatus> {
    const response = await this.fetcher(backendRequestUrl(this.url, path), {
      method: "POST",
      headers: analyzerHeaders(this.headers),
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    const diagnostics = diagnosticsFromBody(payload);
    if (!response.ok) {
      throw new ExecutionArtifactAnalysisError(
        errorMessageFromBody(payload) ?? `Backend push request failed with status ${response.status}.`,
        diagnostics,
      );
    }
    return parseDevPushStatus(payload);
  }
}

export function createLocalAnalyzerService(
  analyzer: BackendSourceAnalyzer = new LocalExecutionArtifactBackendAnalyzer(),
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/analyze" || request.method !== "POST") {
      return Response.json({ error: "Analyzer route not found." }, { status: 404 });
    }
    try {
      const body = await request.json() as { sourcePackage?: SourcePackage };
      if (body.sourcePackage === undefined) {
        return Response.json({ error: "Analyzer request missing sourcePackage." }, { status: 400 });
      }
      const result = await analyzer.analyze(body.sourcePackage);
      const payload = {
        analysis: backendAnalysisFromCodegenAnalysis(result.analysis),
        codegenAnalysis: backendCodegenAnalysisFromCodegenAnalysis(result.analysis),
        diagnostics: result.diagnostics ?? [],
      } satisfies AnalyzeSourcePackageResponse;
      return Response.json(payload);
    } catch (error) {
      return Response.json(
        { error: errorMessage(error), diagnostics: diagnosticsFromError(error) },
        { status: 400 },
      );
    }
  };
}

export function backendAnalysisFromCodegenAnalysis(
  analysis: CodegenDeploymentAnalysis,
): BackendDeploymentAnalysis {
  return {
    schema: {
      version: analysis.schema.version,
      tables: analysis.schema.tables.map(table => ({
        tableId: table.tableId,
        name: table.name,
        validator: backendValidatorJson(table.validator),
        placement: table.placement,
      })),
      indexes: analysis.schema.indexes.map(index => ({
        indexId: index.indexId,
        tableId: index.tableId,
        name: index.name,
        fields: [...index.fields],
      })),
    },
    functions: {
      functions: analysis.functions.flatMap(module =>
        module.functions.map((fn): DeploymentFunctionMetadata => ({
          path: fn.exportName === "default" ? fn.moduleName : `${fn.moduleName}:${fn.exportName}`,
          kind: fn.kind,
          visibility: fn.visibility,
          args: backendValidatorJson(fn.args),
          returns: backendValidatorJson(fn.returns),
          route: null,
          partition: backendFunctionPartition(fn.partition ?? null),
          ...(fn.position === undefined ? {} : { position: fn.position }),
        })),
      ),
    },
  };
}

function backendCodegenAnalysisFromCodegenAnalysis(
  analysis: CodegenDeploymentAnalysis,
): BackendDeploymentCodegenAnalysis {
  return {
    schema: {
      version: analysis.schema.version,
      tables: analysis.schema.tables.map(table => ({
        tableId: table.tableId,
        name: table.name,
        validator: backendValidatorJson(table.validator),
        placement: table.placement,
      })),
      indexes: analysis.schema.indexes.map(index => ({
        indexId: index.indexId,
        tableId: index.tableId,
        name: index.name,
        fields: [...index.fields],
      })),
    },
    functions: analysis.functions.map(module => ({
      moduleName: module.moduleName,
      functions: module.functions.map(fn => ({
        moduleName: fn.moduleName,
        exportName: fn.exportName,
        kind: fn.kind,
        visibility: fn.visibility,
        args: backendRequiredValidatorJson(fn.args),
        returns: backendValidatorJson(fn.returns),
        partition: backendFunctionPartition(fn.partition ?? null),
        ...(fn.position === undefined ? {} : { position: fn.position }),
      })),
    })),
  };
}

function backendFunctionPartition(
  partition: CodegenDeploymentAnalysis["functions"][number]["functions"][number]["partition"] | null,
): FunctionPartitionMetadata | null {
  if (partition === null || partition === undefined) return null;
  switch (partition.type) {
    case "partition":
      return {
        type: "partition",
        table: partition.table,
        selector: partition.selector,
        partitionField: partition.partitionField,
        argField: partition.argField,
      };
    case "partitionCreateRoot":
      return {
        type: "partitionCreateRoot",
        table: partition.table,
        partitionField: partition.partitionField,
      };
    case "partitionRoot":
      throw new Error(
        `partitionRoot metadata for table ${partition.table} is not executable backend metadata.`,
      );
    default:
      partition satisfies never;
      return null;
  }
}

function backendValidatorJson(value: ValidatorJSON | null): BackendValidatorJson | null {
  if (value === null) return null;
  switch (value.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return { type: value.type };
    case "id":
      return { type: "id", tableName: value.tableName };
    case "literal": {
      if (typeof value.value === "bigint") {
        throw new Error("BigInt literal validators are not supported by backend deployment metadata.");
      }
      return { type: "literal", value: value.value };
    }
    case "array":
      return { type: "array", value: backendRequiredValidatorJson(value.value) };
    case "object": {
      const fields: Record<string, { fieldType: BackendValidatorJson; optional: boolean }> = {};
      for (const [name, field] of Object.entries(value.value)) {
        fields[name] = {
          fieldType: backendRequiredValidatorJson(field.fieldType),
          optional: field.optional,
        };
      }
      return { type: "object", value: fields };
    }
    case "record":
      return {
        type: "record",
        keys: backendRequiredValidatorJson(value.keys),
        values: backendRequiredValidatorJson(value.values),
      };
    case "union":
      return {
        type: "union",
        value: value.value.map(member => backendRequiredValidatorJson(member)),
      };
    default:
      value satisfies never;
      throw new Error("Unsupported validator metadata.");
  }
}

function backendRequiredValidatorJson(value: ValidatorJSON): BackendValidatorJson {
  const validator = backendValidatorJson(value);
  if (validator === null) {
    throw new Error("Required backend validator cannot be null.");
  }
  return validator;
}

type CodegenAnalysisParseResult =
  | { ok: true; analysis: CodegenDeploymentAnalysis }
  | { ok: false; message: string };

function parseCodegenAnalysisFromBody(body: unknown): CodegenAnalysisParseResult {
  if (!isRecord(body)) {
    return { ok: false, message: "Backend analyzer response body must be an object." };
  }
  if ("error" in body) {
    return { ok: false, message: "Backend analyzer success response must not include error." };
  }
  if (!("codegenAnalysis" in body)) {
    return { ok: false, message: "Backend analyzer response did not include codegenAnalysis." };
  }
  const analysis = codegenDeploymentAnalysis(body.codegenAnalysis, "codegenAnalysis");
  return analysis.ok
    ? { ok: true, analysis: analysis.value }
    : { ok: false, message: analysis.message };
}

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function codegenDeploymentAnalysis(value: unknown, path: string): ParseResult<CodegenDeploymentAnalysis> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  const schema = codegenSchema(value.schema, `${path}.schema`);
  if (!schema.ok) return schema;
  if (!Array.isArray(value.functions)) return parseError(`${path}.functions must be an array.`);
  const modules = parseArray(value.functions, codegenModule, `${path}.functions`);
  if (!modules.ok) return modules;
  return {
    ok: true,
    value: {
      schema: schema.value,
      functions: modules.value,
    },
  };
}

function codegenSchema(value: unknown, path: string): ParseResult<CodegenDeploymentAnalysis["schema"]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.version !== "number") return parseError(`${path}.version must be a number.`);
  if (!Array.isArray(value.tables)) return parseError(`${path}.tables must be an array.`);
  if (!Array.isArray(value.indexes)) return parseError(`${path}.indexes must be an array.`);
  const tables = parseArray(value.tables, codegenSchemaTable, `${path}.tables`);
  if (!tables.ok) return tables;
  const indexes = parseArray(value.indexes, codegenSchemaIndex, `${path}.indexes`);
  if (!indexes.ok) return indexes;
  return { ok: true, value: { version: value.version, tables: tables.value, indexes: indexes.value } };
}

function codegenSchemaTable(
  value: unknown,
  path: string,
): ParseResult<CodegenDeploymentAnalysis["schema"]["tables"][number]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.tableId !== "number") return parseError(`${path}.tableId must be a number.`);
  if (typeof value.name !== "string") return parseError(`${path}.name must be a string.`);
  const validator = validatorJson(value.validator, `${path}.validator`);
  if (validator === null || validator === undefined) return parseError(`${path}.validator is invalid.`);
  const placement = tablePlacement(value.placement, `${path}.placement`);
  if (!placement.ok) return placement;
  return {
    ok: true,
    value: {
      tableId: value.tableId,
      name: value.name,
      validator,
      placement: placement.value,
    },
  };
}

function tablePlacement(
  value: unknown,
  path: string,
): ParseResult<CodegenDeploymentAnalysis["schema"]["tables"][number]["placement"]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.kind !== "string") return parseError(`${path}.kind must be a string.`);
  switch (value.kind) {
    case "partitionBy":
      return typeof value.field === "string"
        ? { ok: true, value: { kind: "partitionBy", field: value.field } }
        : parseError(`${path}.field must be a string.`);
    case "colocateWith":
      return typeof value.table === "string" && typeof value.field === "string"
        ? { ok: true, value: { kind: "colocateWith", table: value.table, field: value.field } }
        : parseError(`${path}.table and ${path}.field must be strings.`);
    case "global":
      return { ok: true, value: { kind: "global" } };
    default:
      return parseError(`${path}.kind is unsupported.`);
  }
}

function codegenSchemaIndex(
  value: unknown,
  path: string,
): ParseResult<CodegenDeploymentAnalysis["schema"]["indexes"][number]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.indexId !== "number") return parseError(`${path}.indexId must be a number.`);
  if (typeof value.tableId !== "number") return parseError(`${path}.tableId must be a number.`);
  if (typeof value.name !== "string") return parseError(`${path}.name must be a string.`);
  const fields = stringArray(value.fields, `${path}.fields`);
  if (!fields.ok) return fields;
  return {
    ok: true,
    value: {
      indexId: value.indexId,
      tableId: value.tableId,
      name: value.name,
      fields: fields.value,
    },
  };
}

function codegenModule(
  value: unknown,
  path: string,
): ParseResult<CodegenDeploymentAnalysis["functions"][number]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.moduleName !== "string") return parseError(`${path}.moduleName must be a string.`);
  if (!Array.isArray(value.functions)) return parseError(`${path}.functions must be an array.`);
  const functions = parseArray(value.functions, codegenFunction, `${path}.functions`);
  if (!functions.ok) return functions;
  return {
    ok: true,
    value: {
      moduleName: value.moduleName,
      functions: functions.value,
    },
  };
}

function parseArray<T>(
  values: unknown[],
  parser: (value: unknown, path: string) => ParseResult<T>,
  path: string,
): ParseResult<T[]> {
  const parsed: T[] = [];
  for (const [index, value] of values.entries()) {
    const item = parser(value, `${path}[${index}]`);
    if (!item.ok) return item;
    parsed.push(item.value);
  }
  return { ok: true, value: parsed };
}

function codegenFunction(
  value: unknown,
  path: string,
): ParseResult<CodegenDeploymentAnalysis["functions"][number]["functions"][number]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (
    typeof value.moduleName !== "string" ||
    typeof value.exportName !== "string" ||
    !isFunctionKind(value.kind) ||
    !isFunctionVisibility(value.visibility)
  ) {
    return parseError(`${path} has invalid function metadata.`);
  }
  const args = validatorJson(value.args, `${path}.args`);
  if (args === null || args === undefined) return parseError(`${path}.args is invalid.`);
  const returns = validatorJson(value.returns, `${path}.returns`);
  if (returns === undefined) return parseError(`${path}.returns is invalid.`);
  const partition = functionPartition(value.partition, `${path}.partition`);
  if (!partition.ok) return partition;
  if (value.route !== undefined && value.route !== null) {
    return parseError(`${path}.route is not supported in codegenAnalysis.`);
  }
  const position = sourcePosition(value.position, `${path}.position`);
  if (!position.ok) return position;
  return {
    ok: true,
    value: {
      moduleName: value.moduleName,
      exportName: value.exportName,
      kind: value.kind,
      visibility: value.visibility,
      args,
      returns,
      partition: partition.value,
      ...(position.value === null ? {} : { position: position.value }),
    },
  };
}

function validatorJson(value: unknown, path: string): ValidatorJSON | null | undefined {
  try {
    return assertValidatorJson(value, path);
  } catch {
    return undefined;
  }
}

function isFunctionKind(value: unknown): value is CodegenDeploymentAnalysis["functions"][number]["functions"][number]["kind"] {
  return value === "query" || value === "mutation" || value === "workflowMutation" || value === "action";
}

function isFunctionVisibility(
  value: unknown,
): value is CodegenDeploymentAnalysis["functions"][number]["functions"][number]["visibility"] {
  return value === "public" || value === "internal";
}

type ParsedCodegenFunctionPartition =
  NonNullable<CodegenDeploymentAnalysis["functions"][number]["functions"][number]["partition"]> | null;

function functionPartition(
  value: unknown,
  path: string,
): ParseResult<ParsedCodegenFunctionPartition> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.type !== "string") return parseError(`${path}.type must be a string.`);
  switch (value.type) {
    case "partition":
      return typeof value.table === "string" &&
        typeof value.selector === "string" &&
        typeof value.partitionField === "string" &&
        typeof value.argField === "string"
        ? {
            ok: true,
            value: {
              type: "partition",
              table: value.table,
              selector: value.selector,
              partitionField: value.partitionField,
              argField: value.argField,
            },
          }
        : parseError(`${path} has invalid partition metadata.`);
    case "partitionCreateRoot":
      return typeof value.table === "string" && value.partitionField === "_id"
        ? { ok: true, value: { type: "partitionCreateRoot", table: value.table, partitionField: "_id" } }
        : parseError(`${path} has invalid partitionCreateRoot metadata.`);
    default:
      return parseError(`${path}.type is unsupported.`);
  }
}

type ParsedCodegenSourcePosition =
  NonNullable<CodegenDeploymentAnalysis["functions"][number]["functions"][number]["position"]> | null;

function sourcePosition(
  value: unknown,
  path: string,
): ParseResult<ParsedCodegenSourcePosition> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  return typeof value.path === "string" &&
    typeof value.startLine === "number" &&
    typeof value.startColumn === "number"
    ? {
        ok: true,
        value: {
          path: value.path,
          startLine: value.startLine,
          startColumn: value.startColumn,
        },
      }
    : parseError(`${path} has invalid source position metadata.`);
}

function stringArray(value: unknown, path: string): ParseResult<string[]> {
  if (!Array.isArray(value)) return parseError(`${path} must be an array.`);
  return parseArray(
    value,
    (item, itemPath) =>
      typeof item === "string" ? { ok: true, value: item } : parseError(`${itemPath} must be a string.`),
    path,
  );
}

function parseError<T = never>(message: string): ParseResult<T> {
  return { ok: false, message };
}

function diagnosticsFromBody(body: unknown): AnalyzerDiagnostic[] {
  return isRecord(body)
    ? normalizeAnalyzerDiagnostics(body.diagnostics)
    : [];
}

function errorMessageFromBody(body: unknown): string | undefined {
  return isRecord(body) && typeof body.error === "string" ? body.error : undefined;
}

function analyzerHeaders(headers: HeadersInit | undefined): Headers {
  const result = new Headers(headers);
  result.set("content-type", "application/json");
  return result;
}

function parseDevPushStatus(value: unknown): DevPushStatus {
  if (!isRecord(value)) {
    throw new ExecutionArtifactAnalysisError("Backend push response body must be an object.", []);
  }
  if (typeof value.pushId !== "string" || value.pushId.length === 0) {
    throw new ExecutionArtifactAnalysisError("Backend push response pushId must be a non-empty string.", []);
  }
  if (!isPushState(value.state)) {
    throw new ExecutionArtifactAnalysisError("Backend push response state is invalid.", []);
  }
  const codegenAnalysis = "codegenAnalysis" in value
    ? parseCodegenAnalysisFromBody(value)
    : undefined;
  if (codegenAnalysis !== undefined && !codegenAnalysis.ok) {
    throw new ExecutionArtifactAnalysisError(
      codegenAnalysis.message,
      diagnosticsFromBody(value),
    );
  }
  return {
    pushId: value.pushId,
    state: value.state,
    ...(codegenAnalysis?.ok === true ? { codegenAnalysis: codegenAnalysis.analysis } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(diagnosticsFromBody(value).length === 0 ? {} : { diagnostics: diagnosticsFromBody(value) }),
  };
}

function isPushState(value: unknown): value is DevPushStatus["state"] {
  return typeof value === "string" && Object.hasOwn(pushStates, value);
}

const pushStates = {
  pending: true,
  analyzed: true,
  failed: true,
  activated: true,
  abandoned: true,
  superseded: true,
} satisfies Record<PushState, true>;

function backendRequestUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "");
  base.pathname = `${basePath}${path}`;
  return base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticsFromError(error: unknown): AnalyzerDiagnostic[] {
  return error instanceof ExecutionArtifactAnalysisError ? error.diagnostics : [];
}

function stableAnalysisJson(analysis: CodegenDeploymentAnalysis): string {
  return JSON.stringify(analysis);
}

async function postBackend<T>(backend: Miniflare, path: string, body: unknown): Promise<T> {
  const response = await backend.dispatchFetch(`http://flarex.backend${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend request ${path} failed with status ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}
