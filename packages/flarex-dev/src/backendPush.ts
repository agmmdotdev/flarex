import type { Miniflare } from "miniflare";
import { Data, Effect } from "effect";
import {
  backendCodegenAnalysisFromCodegenAnalysis,
  backendRequiredValidatorJsonFromValidatorJson,
  deploymentAnalysisFromCodegenAnalysis,
} from "@flarex/analysis";
import { assertValidatorJson } from "flarex/validator-json";
import type { ValidatorJSON } from "flarex/values";
import type {
  DeploymentAnalysis as BackendDeploymentAnalysis,
  AbandonPushRequest,
  AnalyzeSourcePackageResponse,
  FinishPushRejectionCode,
  FinishPushRequest,
  FinishPushResponse,
  FunctionVisibility,
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
import {
  decodeLocalAnalyzerRequest,
  devRouteErrorMessage,
  isDevRouteError,
} from "./routeBoundary.ts";
import { readDevResponseJsonOrNullEffect } from "./responseJson.ts";
import type { SourcePackage } from "./sourcePackage.ts";

export const backendAnalysisFromCodegenAnalysis = deploymentAnalysisFromCodegenAnalysis;

export type DevPushStatus = {
  pushId: string;
  state: PushState;
  analysis?: BackendDeploymentAnalysis;
  codegenAnalysis?: CodegenDeploymentAnalysis;
  error?: string;
  diagnostics?: AnalyzerDiagnostic[];
};

export type DevFinishPushResponse =
  | (Omit<Extract<FinishPushResponse, { result: "activated" }>, "push"> & {
      push: DevPushStatus & { state: "activated" };
    })
  | (Omit<Extract<FinishPushResponse, { result: "rejected" }>, "push" | "diagnostics"> & {
      push: DevPushStatus;
      diagnostics?: AnalyzerDiagnostic[];
    });

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

export function devFinishPushErrorMessage(response: DevFinishPushResponse, message: string): string {
  if (response.result === "activated") {
    return devPushStatusErrorMessage(response.push, message);
  }
  const details = [
    `Backend rejection code: ${response.code}`,
    `Backend remediation: ${devFinishPushRejectionHint(response.code)}`,
    `Backend error: ${response.error}`,
    ...(response.diagnostics ?? response.push.diagnostics ?? []).map(
      diagnostic => `Backend diagnostic (${diagnostic.level}): ${diagnostic.message}`,
    ),
  ];
  const summary = `${message}: ${response.push.state}.`;
  return `${summary}\n${details.join("\n")}`;
}

export function devFinishPushRejectionHint(code: FinishPushRejectionCode): string {
  switch (code) {
    case "invalid_state":
      return "Start a new deploy because this push is no longer finishable.";
    case "missing_analysis":
      return "Restart deploy so backend analysis can produce activation metadata.";
    case "missing_artifact":
      return "Re-run deploy so the source package is uploaded before activation.";
    default:
      code satisfies never;
      return "Inspect backend diagnostics and retry the deploy.";
  }
}

export interface BackendPushCoordinator {
  start(sourcePackage: SourcePackage): Promise<DevPushStatus>;
  finish(pushId: string): Promise<DevFinishPushResponse>;
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

type BackendPushHttpResponse = Pick<Response, "json" | "ok" | "status">;

type BackendPushResponseContext = "analyzer" | "push" | "finish";

export class BackendPushResponseError extends Data.TaggedError("BackendPushResponseError")<{
  readonly context: BackendPushResponseContext;
  readonly status: number;
  readonly message: string;
  readonly diagnostics: AnalyzerDiagnostic[];
  readonly body: unknown;
}> {}

export class LocalBackendFinishResponseError extends Data.TaggedError("LocalBackendFinishResponseError")<{
  readonly path: string;
  readonly status: number;
  readonly body: unknown;
}> {}

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
    // Deliberate runtime bridge: HTTP analyzer response decoding is Promise-based.
    const body = await Effect.runPromise(
      decodeHttpBackendAnalyzerBody(response).pipe(
        Effect.mapError(backendPushResponseErrorToAnalysisError),
      ),
    );
    const diagnostics = diagnosticsFromBody(body);
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

  async finish(pushId: string): Promise<DevFinishPushResponse> {
    const path = `/deployments/${this.deploymentId}/push/${pushId}/finish`;
    const response = await this.backend.dispatchFetch(`http://flarex.backend${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    // Deliberate runtime bridge: local backend finish API is Promise-based.
    const payload = await Effect.runPromise(
      decodeLocalBackendFinishBody(response, path).pipe(
        Effect.mapError(localBackendFinishResponseErrorToError),
      ),
    );
    return parseDevFinishPushResponse(payload);
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

  async finish(pushId: string): Promise<DevFinishPushResponse> {
    const body = {} satisfies FinishPushRequest;
    return await this.postFinish(
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
    // Deliberate runtime bridge: HTTP backend push API is Promise-based.
    const payload = await Effect.runPromise(
      decodeHttpBackendPushBody(response).pipe(
        Effect.mapError(backendPushResponseErrorToAnalysisError),
      ),
    );
    return parseDevPushStatus(payload);
  }

  private async postFinish(path: string, body: unknown): Promise<DevFinishPushResponse> {
    const response = await this.fetcher(backendRequestUrl(this.url, path), {
      method: "POST",
      headers: analyzerHeaders(this.headers),
      body: JSON.stringify(body),
    });
    // Deliberate runtime bridge: HTTP backend finish API is Promise-based.
    const payload = await Effect.runPromise(
      decodeHttpBackendFinishBody(response).pipe(
        Effect.mapError(backendPushResponseErrorToAnalysisError),
      ),
    );
    return parseDevFinishPushResponse(payload);
  }
}

const decodeHttpBackendAnalyzerBody = Effect.fn("FlarexDev.decodeHttpBackendAnalyzerBody")(
  function* (response: BackendPushHttpResponse) {
    const body = yield* readBackendPushResponseJson(response);
    if (!response.ok) {
      return yield* backendPushResponseFailure(
        "analyzer",
        response,
        body,
        errorMessageFromBody(body) ?? `Backend analyzer request failed with status ${response.status}.`,
      );
    }
    return body;
  },
);

const decodeHttpBackendPushBody = Effect.fn("FlarexDev.decodeHttpBackendPushBody")(
  function* (response: BackendPushHttpResponse) {
    const body = yield* readBackendPushResponseJson(response);
    if (!response.ok) {
      return yield* backendPushResponseFailure(
        "push",
        response,
        body,
        errorMessageFromBody(body) ?? `Backend push request failed with status ${response.status}.`,
      );
    }
    return body;
  },
);

const decodeHttpBackendFinishBody = Effect.fn("FlarexDev.decodeHttpBackendFinishBody")(
  function* (response: BackendPushHttpResponse) {
    const body = yield* readBackendPushResponseJson(response);
    if (!response.ok && (response.status !== 409 || !isRejectedFinishPushEnvelope(body))) {
      return yield* backendPushResponseFailure(
        "finish",
        response,
        body,
        errorMessageFromBody(body) ?? `Backend push request failed with status ${response.status}.`,
      );
    }
    return body;
  },
);

const decodeLocalBackendFinishBody = Effect.fn("FlarexDev.decodeLocalBackendFinishBody")(
  function* (response: BackendPushHttpResponse, path: string) {
    const body = yield* readBackendPushResponseJson(response);
    if (!response.ok && (response.status !== 409 || !isRejectedFinishPushEnvelope(body))) {
      return yield* Effect.fail(new LocalBackendFinishResponseError({
        path,
        status: response.status,
        body,
      }));
    }
    return body;
  },
);

function readBackendPushResponseJson(
  response: BackendPushHttpResponse,
): Effect.Effect<unknown> {
  return readDevResponseJsonOrNullEffect(response);
}

function backendPushResponseFailure(
  context: BackendPushResponseContext,
  response: BackendPushHttpResponse,
  body: unknown,
  message: string,
): Effect.Effect<never, BackendPushResponseError> {
  return Effect.fail(new BackendPushResponseError({
    context,
    status: response.status,
    message,
    diagnostics: diagnosticsFromBody(body),
    body,
  }));
}

function backendPushResponseErrorToAnalysisError(
  error: BackendPushResponseError,
): ExecutionArtifactAnalysisError {
  return new ExecutionArtifactAnalysisError(error.message, error.diagnostics);
}

function localBackendFinishResponseErrorToError(error: LocalBackendFinishResponseError): Error {
  return new Error(
    `Backend request ${error.path} failed with status ${error.status}: ${JSON.stringify(error.body)}`,
  );
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
      // Deliberate runtime bridge: analyzer route handler returns a Response Promise.
      const body = await Effect.runPromise(decodeLocalAnalyzerRequest(request));
      const result = await analyzer.analyze(body.sourcePackage);
      const payload = {
        analysis: backendAnalysisFromCodegenAnalysis(result.analysis),
        codegenAnalysis: backendCodegenAnalysisFromCodegenAnalysis(result.analysis),
        diagnostics: result.diagnostics ?? [],
      } satisfies AnalyzeSourcePackageResponse;
      return Response.json(payload);
    } catch (error) {
      return Response.json(
        {
          error: isDevRouteError(error) ? devRouteErrorMessage(error) : errorMessage(error),
          diagnostics: diagnosticsFromError(error),
        },
        { status: 400 },
      );
    }
  };
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

function backendDeploymentAnalysis(
  value: unknown,
  path: string,
): ParseResult<BackendDeploymentAnalysis> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  const schema = backendDeploymentSchema(value.schema, `${path}.schema`);
  if (!schema.ok) return schema;
  const functions = backendDeploymentFunctions(value.functions, `${path}.functions`);
  if (!functions.ok) return functions;
  return {
    ok: true,
    value: {
      schema: schema.value,
      functions: functions.value,
    },
  };
}

function backendDeploymentSchema(
  value: unknown,
  path: string,
): ParseResult<BackendDeploymentAnalysis["schema"]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.version !== "number") return parseError(`${path}.version must be a number.`);
  if (!Array.isArray(value.tables)) return parseError(`${path}.tables must be an array.`);
  if (!Array.isArray(value.indexes)) return parseError(`${path}.indexes must be an array.`);
  const tables = parseArray(value.tables, backendSchemaTable, `${path}.tables`);
  if (!tables.ok) return tables;
  const indexes = parseArray(value.indexes, backendSchemaIndex, `${path}.indexes`);
  if (!indexes.ok) return indexes;
  return {
    ok: true,
    value: {
      version: value.version,
      tables: tables.value,
      indexes: indexes.value,
    },
  };
}

function backendSchemaTable(
  value: unknown,
  path: string,
): ParseResult<BackendDeploymentAnalysis["schema"]["tables"][number]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.tableId !== "number") return parseError(`${path}.tableId must be a number.`);
  if (typeof value.name !== "string") return parseError(`${path}.name must be a string.`);
  const validator = backendValidatorJsonFromUnknown(value.validator, `${path}.validator`);
  if (!validator.ok) return validator;
  const placement = tablePlacement(value.placement, `${path}.placement`);
  if (!placement.ok) return placement;
  const state = backendSchemaTableState(value.state, `${path}.state`);
  if (!state.ok) return state;
  const table: BackendDeploymentAnalysis["schema"]["tables"][number] = {
    tableId: value.tableId,
    name: value.name,
    placement: placement.value,
  };
  if (validator.value !== undefined) table.validator = validator.value;
  if (state.value !== undefined) table.state = state.value;
  return { ok: true, value: table };
}

function backendSchemaIndex(
  value: unknown,
  path: string,
): ParseResult<BackendDeploymentAnalysis["schema"]["indexes"][number]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.indexId !== "number") return parseError(`${path}.indexId must be a number.`);
  if (typeof value.tableId !== "number") return parseError(`${path}.tableId must be a number.`);
  if (typeof value.name !== "string") return parseError(`${path}.name must be a string.`);
  const fields = stringArray(value.fields, `${path}.fields`);
  if (!fields.ok) return fields;
  const state = backendSchemaIndexState(value.state, `${path}.state`);
  if (!state.ok) return state;
  const index: BackendDeploymentAnalysis["schema"]["indexes"][number] = {
    indexId: value.indexId,
    tableId: value.tableId,
    name: value.name,
    fields: fields.value,
  };
  if (state.value !== undefined) index.state = state.value;
  return { ok: true, value: index };
}

function backendSchemaTableState(
  value: unknown,
  path: string,
): ParseResult<BackendDeploymentAnalysis["schema"]["tables"][number]["state"] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return value === "active" || value === "hidden" || value === "deleted"
    ? { ok: true, value }
    : parseError(`${path} must be active, hidden, or deleted.`);
}

function backendSchemaIndexState(
  value: unknown,
  path: string,
): ParseResult<BackendDeploymentAnalysis["schema"]["indexes"][number]["state"] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return value === "enabled" || value === "staged" || value === "disabled"
    ? { ok: true, value }
    : parseError(`${path} must be enabled, staged, or disabled.`);
}

function backendDeploymentFunctions(
  value: unknown,
  path: string,
): ParseResult<BackendDeploymentAnalysis["functions"]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (!Array.isArray(value.functions)) return parseError(`${path}.functions must be an array.`);
  const functions = parseArray(value.functions, backendDeploymentFunction, `${path}.functions`);
  return functions.ok
    ? { ok: true, value: { functions: functions.value } }
    : functions;
}

function backendDeploymentFunction(
  value: unknown,
  path: string,
): ParseResult<BackendDeploymentAnalysis["functions"]["functions"][number]> {
  if (!isRecord(value)) return parseError(`${path} must be an object.`);
  if (typeof value.path !== "string" || !isFunctionKind(value.kind)) {
    return parseError(`${path} has invalid function metadata.`);
  }
  const visibility = backendFunctionVisibility(value.visibility, `${path}.visibility`);
  if (!visibility.ok) return visibility;
  const args = backendValidatorJsonFromUnknown(value.args, `${path}.args`);
  if (!args.ok) return args;
  const returns = backendValidatorJsonFromUnknown(value.returns, `${path}.returns`);
  if (!returns.ok) return returns;
  const route = backendFunctionRoute(value.route, `${path}.route`);
  if (!route.ok) return route;
  const partition = functionPartition(value.partition, `${path}.partition`);
  if (!partition.ok) return partition;
  const position = sourcePosition(value.position, `${path}.position`);
  if (!position.ok) return position;
  const metadata: BackendDeploymentAnalysis["functions"]["functions"][number] = {
    path: value.path,
    kind: value.kind,
  };
  if (visibility.value !== null) metadata.visibility = visibility.value;
  if (args.value !== undefined) metadata.args = args.value;
  if (returns.value !== undefined) metadata.returns = returns.value;
  if (route.value !== undefined) metadata.route = route.value;
  if (partition.value !== null) metadata.partition = partition.value;
  if (position.value !== null) metadata.position = position.value;
  return { ok: true, value: metadata };
}

function backendFunctionVisibility(
  value: unknown,
  path: string,
): ParseResult<FunctionVisibility | null> {
  if (value === undefined) return { ok: true, value: null };
  return isFunctionVisibility(value)
    ? { ok: true, value }
    : parseError(`${path} must be public or internal.`);
}

function backendValidatorJsonFromUnknown(
  value: unknown,
  path: string,
): ParseResult<BackendValidatorJson | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  const parsed = validatorJson(value, path);
  if (parsed === undefined || parsed === null) return parseError(`${path} is invalid.`);
  try {
    return { ok: true, value: backendRequiredValidatorJsonFromValidatorJson(parsed) };
  } catch (error) {
    return parseError(`${path} is invalid: ${errorMessage(error)}`);
  }
}

function backendFunctionRoute(
  value: unknown,
  path: string,
): ParseResult<BackendDeploymentAnalysis["functions"]["functions"][number]["route"] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value) || value.type !== "args" || typeof value.field !== "string") {
    return parseError(`${path} has invalid route metadata.`);
  }
  return { ok: true, value: { type: "args", field: value.field } };
}

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

function functionPartition(
  value: unknown,
  path: string,
): ParseResult<FunctionPartitionMetadata | null> {
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
  const backendAnalysis = "analysis" in value
    ? backendDeploymentAnalysis(value.analysis, "analysis")
    : undefined;
  if (backendAnalysis !== undefined && !backendAnalysis.ok) {
    throw new ExecutionArtifactAnalysisError(
      backendAnalysis.message,
      diagnosticsFromBody(value),
    );
  }
  return {
    pushId: value.pushId,
    state: value.state,
    ...(backendAnalysis?.ok === true ? { analysis: backendAnalysis.value } : {}),
    ...(codegenAnalysis?.ok === true ? { codegenAnalysis: codegenAnalysis.analysis } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(diagnosticsFromBody(value).length === 0 ? {} : { diagnostics: diagnosticsFromBody(value) }),
  };
}

function parseDevFinishPushResponse(value: unknown): DevFinishPushResponse {
  if (isFinishPushResponseEnvelope(value)) {
    const diagnostics = diagnosticsFromBody(value);
    if (!isRecord(value.push)) {
      throw new ExecutionArtifactAnalysisError(
        "Backend finish response push must be an object.",
        diagnostics,
      );
    }
    const push = parseDevPushStatus(value.push);
    if (value.result === "activated") {
      if (push.state !== "activated") {
        throw new ExecutionArtifactAnalysisError(
          "Backend finish response activated result must include an activated push.",
          diagnosticsFromBody(value),
        );
      }
      const activatedPush: DevPushStatus & { state: "activated" } = {
        ...push,
        state: "activated",
      };
      return { result: "activated", push: activatedPush };
    }
    if (typeof value.error !== "string") {
      throw new ExecutionArtifactAnalysisError(
        "Backend rejected finish response must include an error.",
        diagnostics,
      );
    }
    if (!isFinishPushRejectionCode(value.code)) {
      throw new ExecutionArtifactAnalysisError(
        "Backend rejected finish response code is invalid.",
        diagnostics,
      );
    }
    return {
      result: "rejected",
      push,
      code: value.code,
      error: value.error,
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
    };
  }

  const push = parseDevPushStatus(value);
  if (push.state === "activated") {
    const activatedPush: DevPushStatus & { state: "activated" } = {
      ...push,
      state: "activated",
    };
    return { result: "activated", push: activatedPush };
  }
  throw new ExecutionArtifactAnalysisError(
    "Legacy raw finish push status responses must be activated.",
    push.diagnostics ?? [],
  );
}

function isFinishPushResponseEnvelope(value: unknown): value is {
  result: "activated" | "rejected";
  push: unknown;
  code?: unknown;
  error?: unknown;
  diagnostics?: unknown;
} {
  return (
    isRecord(value) &&
    (value.result === "activated" || value.result === "rejected")
  );
}

function isRejectedFinishPushEnvelope(value: unknown): value is {
  result: "rejected";
  push: unknown;
  code?: unknown;
  error?: unknown;
  diagnostics?: unknown;
} {
  return (
    isRecord(value) &&
    value.result === "rejected"
  );
}

function isFinishPushRejectionCode(value: unknown): value is FinishPushRejectionCode {
  return typeof value === "string" && Object.hasOwn(finishPushRejectionCodes, value);
}

const finishPushRejectionCodes = {
  invalid_state: true,
  missing_analysis: true,
  missing_artifact: true,
} satisfies Record<FinishPushRejectionCode, true>;

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
