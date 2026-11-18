import { decodePublicDeploymentProfileEffect, encodeDeploymentAnalysis, encodeDeploymentCodegenAnalysis,
  type PublicDeploymentProfile } from "flarex-protocol/deployment";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import type { Miniflare } from "miniflare";
import { Data, Effect, Schema } from "effect";
import {
  backendCodegenAnalysisFromCodegenAnalysisEffect,
  encodeCodegenDeploymentAnalysis,
  deploymentAnalysisFromCodegenAnalysisEffect,
} from "@flarex/analysis";
import {
  decodeDeploymentAnalysisEffect,
  decodeDeploymentCodegenAnalysisEffect,
  type DeploymentAnalysis as ProtocolDeploymentAnalysis,
  type DeploymentCodegenAnalysis as ProtocolDeploymentCodegenAnalysis,
} from "flarex-protocol/deployment";
import type {
  AbandonPushRequest,
  FinishPushRejectionCode,
  FinishPushRequest,
  FinishPushResponse,
  PushState,
  StartPushRequest,
} from "flarex-backend/types";
import type { DeploymentAnalysis as CodegenDeploymentAnalysis } from "./analyze.ts";
import { errorMessageFromUnknown } from "./errorMessage.ts";
import {
  ExecutionArtifactAnalysisError,
  LocalMiniflareExecutionArtifactAdapter,
  executionArtifactAnalysisErrorFromResponse,
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

export type DevPushStatus = {
  storageProfile?: "core_application";
  pushId: string;
  state: PushState;
  analysis?: ProtocolDeploymentAnalysis;
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
  /** The backend selects storage before source bundling; no lookup fallback. */
  getStorageProfile?(): Promise<PublicDeploymentProfile["storageProfile"]>;
  start(sourcePackage: SourcePackage): Promise<DevPushStatus>;
  finish(pushId: string): Promise<DevFinishPushResponse>;
  abandon?(pushId: string, request?: AbandonPushRequest): Promise<DevPushStatus>;
}

export const LOCAL_BACKEND_DEPLOY_PUSH_TOKEN = "local-dev-deploy-push";

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

type BackendPushResponseContext = "analyzer" | "push" | "finish" | "profile";

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
    return await Effect.runPromise(Effect.gen(function* () {
      const body = yield* decodeHttpBackendAnalyzerBody(response).pipe(
        Effect.mapError(executionArtifactAnalysisErrorFromResponse),
      );
      return {
        analysis: yield* parseCodegenAnalysisFromBodyEffect(body),
        diagnostics: diagnosticsFromBody(body),
      };
    }));
  }
}

export class LocalBackendPushCoordinator implements BackendPushCoordinator {
  private readonly backend: Miniflare;
  private readonly deploymentId: string;
  private readonly deployPushToken: string;

  constructor(
    backend: Miniflare,
    deploymentId: string,
    deployPushToken = LOCAL_BACKEND_DEPLOY_PUSH_TOKEN,
  ) {
    this.backend = backend;
    this.deploymentId = deploymentId;
    this.deployPushToken = deployPushToken;
  }

  async start(sourcePackage: SourcePackage): Promise<DevPushStatus> {
    return postLocalBackendPush(
      this.backend,
      `/deployments/${this.deploymentId}/push/start`,
      {
        sourcePackage,
      },
      this.deployPushToken,
    );
  }

  async finish(pushId: string): Promise<DevFinishPushResponse> {
    const path = `/deployments/${this.deploymentId}/push/${pushId}/finish`;
    const response = await this.backend.dispatchFetch(`http://flarex.backend${path}`, {
      method: "POST",
      headers: localBackendDeployHeaders(this.deployPushToken),
      body: JSON.stringify({}),
    });
    // Deliberate runtime bridge: local backend finish API is Promise-based.
    return await Effect.runPromise(
      decodeLocalBackendFinishBody(response, path).pipe(
        Effect.mapError(localBackendFinishResponseErrorToError),
        Effect.flatMap(parseDevFinishPushResponseEffect),
      ),
    );
  }

  abandon(pushId: string, request: AbandonPushRequest = {}): Promise<DevPushStatus> {
    return postLocalBackendPush(
      this.backend,
      `/deployments/${this.deploymentId}/push/${pushId}/abandon`,
      request,
      this.deployPushToken,
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

  async getStorageProfile(): Promise<PublicDeploymentProfile["storageProfile"]> {
    const response = await this.fetcher(backendRequestUrl(this.url,
      `/deployments/${encodeURIComponent(this.deploymentId)}/profile`),
    this.headers === undefined ? undefined : { headers: this.headers });
    // Deliberate runtime bridge: the public coordinator is a Promise HTTP API.
    return await Effect.runPromise(Effect.gen(function* () {
      const body = yield* readBackendPushResponseJson(response);
      if (!response.ok) return yield* backendPushResponseFailure("profile", response, body,
        errorMessageFromBody(body) ?? `Backend profile request failed with status ${response.status}.`);
      return (yield* decodePublicDeploymentProfileEffect(body)).storageProfile;
    }));
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
    return await Effect.runPromise(
      decodeHttpBackendPushBody(response).pipe(
        Effect.mapError(executionArtifactAnalysisErrorFromResponse),
        Effect.flatMap(parseDevPushStatusEffect),
      ),
    );
  }

  private async postFinish(path: string, body: unknown): Promise<DevFinishPushResponse> {
    const response = await this.fetcher(backendRequestUrl(this.url, path), {
      method: "POST",
      headers: analyzerHeaders(this.headers),
      body: JSON.stringify(body),
    });
    // Deliberate runtime bridge: HTTP backend finish API is Promise-based.
    return await Effect.runPromise(
      decodeHttpBackendFinishBody(response).pipe(
        Effect.mapError(executionArtifactAnalysisErrorFromResponse),
        Effect.flatMap(parseDevFinishPushResponseEffect),
      ),
    );
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
      const payload = await Effect.runPromise(Effect.gen(function* () {
        const body = yield* decodeLocalAnalyzerRequest(request);
        const result = yield* Effect.tryPromise({
          try: () => analyzer.analyze(body.sourcePackage),
          catch: cause => cause,
        });
        return {
          analysis: yield* deploymentAnalysisFromCodegenAnalysisEffect(result.analysis),
          codegenAnalysis: yield* backendCodegenAnalysisFromCodegenAnalysisEffect(result.analysis),
          diagnostics: result.diagnostics ?? [],
        };
      }));
      return Response.json({ ...payload, analysis: encodeDeploymentAnalysis(payload.analysis),
        codegenAnalysis: encodeDeploymentCodegenAnalysis(payload.codegenAnalysis) });
    } catch (error) {
      return Response.json(
        {
          error: isDevRouteError(error)
            ? devRouteErrorMessage(error)
            : errorMessageFromUnknown(error),
          diagnostics: diagnosticsFromError(error),
        },
        { status: 400 },
      );
    }
  };
}

function parseCodegenAnalysisFromBodyEffect(
  body: unknown,
): Effect.Effect<CodegenDeploymentAnalysis, ExecutionArtifactAnalysisError> {
  if (!isRecord(body)) {
    return analysisFailure("Backend analyzer response body must be an object.", []);
  }
  const diagnostics = diagnosticsFromBody(body);
  if ("error" in body) {
    return analysisFailure("Backend analyzer success response must not include error.", diagnostics);
  }
  if (!("codegenAnalysis" in body)) {
    return analysisFailure("Backend analyzer response did not include codegenAnalysis.", diagnostics);
  }
  const routeCheck = rejectCodegenRouteMetadata(body.codegenAnalysis);
  if (!routeCheck.ok) return analysisFailure(routeCheck.message, diagnostics);
  return decodeDeploymentCodegenAnalysisEffect(body.codegenAnalysis).pipe(
    Effect.mapError(error => new ExecutionArtifactAnalysisError(error.message, diagnostics)),
    Effect.flatMap(analysis => codegenDeploymentAnalysisFromProtocolEffect(analysis).pipe(
      Effect.mapError(error => new ExecutionArtifactAnalysisError(error.message, diagnostics)),
    )),
  );
}

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function parseError<T = never>(message: string): ParseResult<T> {
  return { ok: false, message };
}

function decodeProtocolDeploymentAnalysisEffect(
  value: unknown,
  diagnostics: AnalyzerDiagnostic[],
): Effect.Effect<ProtocolDeploymentAnalysis, ExecutionArtifactAnalysisError> {
  return decodeDeploymentAnalysisEffect(value).pipe(
    Effect.mapError(error => new ExecutionArtifactAnalysisError(error.message, diagnostics)),
  );
}

function codegenDeploymentAnalysisFromProtocolEffect(
  analysis: ProtocolDeploymentCodegenAnalysis,
): Effect.Effect<CodegenDeploymentAnalysis, ExecutionArtifactAnalysisError> {
  const tables: Array<CodegenDeploymentAnalysis["schema"]["tables"][number]> = [];
  for (const [index, table] of analysis.schema.tables.entries()) {
    if (table.validator === undefined || table.validator === null) {
      return analysisFailure(`codegenAnalysis.schema.tables[${index}].validator is invalid.`, []);
    }
    tables.push({
      tableId: table.tableId,
      name: table.name,
      validator: table.validator,
      placement: { ...table.placement },
    });
  }
  return Effect.succeed({
      schema: {
        version: analysis.schema.version,
        tables,
        indexes: analysis.schema.indexes.map(index => ({
          indexId: index.indexId,
          tableId: index.tableId,
          name: index.name,
          fields: [...index.fields],
          ...(index.decimalFields === undefined ? {} : { decimalFields: [...index.decimalFields] }),
        })),
      },
      functions: analysis.functions.map(module => ({
        moduleName: module.moduleName,
        functions: module.functions.map(fn => ({
          moduleName: fn.moduleName,
          exportName: fn.exportName,
          kind: fn.kind,
          visibility: fn.visibility,
          args: fn.args,
          returns: fn.returns,
          ...(fn.partition === undefined
            ? {}
            : { partition: fn.partition === null ? null : { ...fn.partition } }),
          ...(fn.position === undefined ? {} : { position: { ...fn.position } }),
        })),
      })),
  });
}

function rejectCodegenRouteMetadata(value: unknown): ParseResult<void> {
  if (!isRecord(value) || !Array.isArray(value.functions)) return { ok: true, value: undefined };
  for (const [moduleIndex, module] of value.functions.entries()) {
    if (!isRecord(module) || !Array.isArray(module.functions)) continue;
    for (const [functionIndex, fn] of module.functions.entries()) {
      if (!isRecord(fn) || fn.route === undefined || fn.route === null) continue;
      return parseError(
        `codegenAnalysis.functions[${moduleIndex}].functions[${functionIndex}].route is not supported in codegenAnalysis.`,
      );
    }
  }
  return { ok: true, value: undefined };
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

function analysisFailure(
  message: string,
  diagnostics: AnalyzerDiagnostic[],
): Effect.Effect<never, ExecutionArtifactAnalysisError> {
  return Effect.fail(new ExecutionArtifactAnalysisError(message, diagnostics));
}

const decodePushStorageProfile = Schema.decodeUnknownEffect(Schema.Struct({
  storageProfile: Schema.optionalKey(Schema.Literal("core_application")),
}));

const parseDevPushStatusEffect = Effect.fn("FlarexDev.parsePushStatus")(
  function (
    value: unknown,
  ): Effect.Effect<DevPushStatus, ExecutionArtifactAnalysisError> {
    if (!isRecord(value)) {
      return analysisFailure("Backend push response body must be an object.", []);
    }
    const diagnostics = diagnosticsFromBody(value);
    if (!isNonEmptyString(value.pushId)) {
      return analysisFailure(
        "Backend push response pushId must be a non-empty string.",
        diagnostics,
      );
    }
    if (!isPushState(value.state)) {
      return analysisFailure("Backend push response state is invalid.", diagnostics);
    }
    const pushId = value.pushId;
    const state = value.state;
    return Effect.gen(function* () {
      const { storageProfile } = yield* decodePushStorageProfile(value).pipe(Effect.mapError(() =>
        new ExecutionArtifactAnalysisError("Backend push response storageProfile is invalid.", diagnostics)));
      const codegenAnalysis = "codegenAnalysis" in value
        ? yield* parseCodegenAnalysisFromBodyEffect(value)
        : undefined;
      const backendAnalysis = "analysis" in value
        ? yield* decodeProtocolDeploymentAnalysisEffect(value.analysis, diagnostics)
        : undefined;
      return {
        pushId,
        state,
        ...(storageProfile === undefined ? {} : { storageProfile }),
        ...(backendAnalysis === undefined ? {} : { analysis: backendAnalysis }),
        ...(codegenAnalysis === undefined ? {} : { codegenAnalysis }),
        ...(typeof value.error === "string" ? { error: value.error } : {}),
        ...(diagnostics.length === 0 ? {} : { diagnostics }),
      };
    });
  },
);

const parseDevFinishPushResponseEffect = Effect.fn("FlarexDev.parseFinishPushResponse")(
  function (
    value: unknown,
  ): Effect.Effect<DevFinishPushResponse, ExecutionArtifactAnalysisError> {
    if (isFinishPushResponseEnvelope(value)) {
      const diagnostics = diagnosticsFromBody(value);
      if (!isRecord(value.push)) {
        return analysisFailure("Backend finish response push must be an object.", diagnostics);
      }
      return Effect.gen(function* () {
        const push = yield* parseDevPushStatusEffect(value.push);
        if (value.result === "activated") {
          if (push.state !== "activated") {
            return yield* analysisFailure(
              "Backend finish response activated result must include an activated push.",
              diagnostics,
            );
          }
          const activatedPush: DevPushStatus & { state: "activated" } = {
            ...push,
            state: "activated",
          };
          return { result: "activated", push: activatedPush };
        }
        if (typeof value.error !== "string") {
          return yield* analysisFailure(
            "Backend rejected finish response must include an error.",
            diagnostics,
          );
        }
        if (!isFinishPushRejectionCode(value.code)) {
          return yield* analysisFailure(
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
      });
    }

    return Effect.gen(function* () {
      const push = yield* parseDevPushStatusEffect(value);
      if (push.state === "activated") {
        const activatedPush: DevPushStatus & { state: "activated" } = {
          ...push,
          state: "activated",
        };
        return { result: "activated", push: activatedPush };
      }
      return yield* analysisFailure(
        "Legacy raw finish push status responses must be activated.",
        push.diagnostics ?? [],
      );
    });
  },
);

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

function diagnosticsFromError(error: unknown): AnalyzerDiagnostic[] {
  return error instanceof ExecutionArtifactAnalysisError ? error.diagnostics : [];
}

function stableAnalysisJson(analysis: CodegenDeploymentAnalysis): string {
  return JSON.stringify(encodeCodegenDeploymentAnalysis(analysis));
}

async function postLocalBackendPush(
  backend: Miniflare,
  path: string,
  body: unknown,
  deployPushToken: string,
): Promise<DevPushStatus> {
  const response = await backend.dispatchFetch(`http://flarex.backend${path}`, {
    method: "POST",
    headers: localBackendDeployHeaders(deployPushToken),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend request ${path} failed with status ${response.status}: ${text}`);
  }
  const payload: unknown = await response.json();
  return await Effect.runPromise(parseDevPushStatusEffect(payload));
}

function localBackendDeployHeaders(deployPushToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${deployPushToken}`,
    "content-type": "application/json",
  };
}
