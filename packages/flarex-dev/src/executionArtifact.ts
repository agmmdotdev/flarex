import { Data, Effect } from "effect";
import { fileURLToPath } from "node:url";
import {
  normalizeAnalyzerDiagnostics,
  type AnalyzerDiagnostic,
} from "@flarex/analysis";
import { Miniflare } from "miniflare";
import { build, type Plugin } from "vite";
import type { ExecutionArtifactRef } from "flarex/artifacts";
import type { DeploymentAnalysis } from "./analyze.ts";
import { readDevResponseJsonOrNullEffect } from "./responseJson.ts";
import type { SourcePackage } from "./sourcePackage.ts";

export type { ExecutionArtifactRef } from "flarex/artifacts";
export { normalizeAnalyzerDiagnostics };
export type { AnalyzerDiagnostic };

export type ExecutionArtifactAnalysis = {
  analysis: DeploymentAnalysis;
  diagnostics: AnalyzerDiagnostic[];
};

export class ExecutionArtifactAnalysisError extends Error {
  readonly diagnostics: AnalyzerDiagnostic[];

  constructor(message: string, diagnostics: AnalyzerDiagnostic[] = []) {
    super(message);
    this.name = "ExecutionArtifactAnalysisError";
    this.diagnostics = diagnostics;
  }
}

type ExecutionArtifactHttpResponse = Pick<Response, "json" | "ok" | "status">;

type ExecutionArtifactResponseOperation = "analysis" | "invoke";

export class ExecutionArtifactResponseError extends Data.TaggedError("ExecutionArtifactResponseError")<{
  readonly operation: ExecutionArtifactResponseOperation;
  readonly status: number;
  readonly message: string;
  readonly diagnostics: AnalyzerDiagnostic[];
  readonly body: unknown;
}> {}

export interface ExecutionArtifactAdapter {
  analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis>;
  analyzeWithDiagnostics?(sourcePackage: SourcePackage): Promise<ExecutionArtifactAnalysis>;
}

export type ExecutionArtifactInvokeRequest = {
  deploymentId: string;
  path: string;
  args: unknown;
  partitionKey?: string;
  idempotencyKey?: string;
};

export interface ExecutionArtifactRuntime {
  invoke(ref: ExecutionArtifactRef, request: ExecutionArtifactInvokeRequest): Promise<unknown>;
}

type ArtifactFetcher = {
  fetch(request: Request): Promise<Response>;
};

export class LocalMiniflareExecutionArtifactAdapter implements ExecutionArtifactAdapter {
  async analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis> {
    return (await this.analyzeWithDiagnostics(sourcePackage)).analysis;
  }

  async analyzeWithDiagnostics(sourcePackage: SourcePackage): Promise<ExecutionArtifactAnalysis> {
    const workerSource = await bundledAnalysisWorkerSource(sourcePackage);
    const artifact = new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: workerSource,
        },
        ...sourcePackage.modules.map(module => ({
          type: "ESModule" as const,
          path: module.path,
          contents: module.source,
        })),
      ],
      compatibilityDate: "2026-06-14",
    });
    try {
      const response = await artifact.dispatchFetch("http://flarex-artifact/analyze", {
        method: "POST",
      });
      // Deliberate runtime bridge: local artifact analysis API is Promise-based.
      const { body, diagnostics } = await Effect.runPromise(
        decodeExecutionArtifactAnalysisBody(response).pipe(
          Effect.mapError(executionArtifactResponseErrorToAnalysisError),
        ),
      );
      if (typeof body !== "object" || body === null || !("analysis" in body)) {
        throw new ExecutionArtifactAnalysisError("Execution artifact analysis returned an invalid response.", diagnostics);
      }
      return {
        analysis: (body as { analysis: DeploymentAnalysis }).analysis,
        diagnostics,
      };
    } finally {
      await artifact.dispose();
    }
  }
}

export class LocalMiniflareExecutionArtifactRuntime implements ExecutionArtifactRuntime {
  private readonly artifact: ArtifactFetcher;

  constructor(artifact: ArtifactFetcher) {
    this.artifact = artifact;
  }

  async invoke(ref: ExecutionArtifactRef, request: ExecutionArtifactInvokeRequest): Promise<unknown> {
    const response = await this.artifact.fetch(new Request("https://flarex-artifact.internal/__flarex_internal/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flarex-artifact-id": ref.artifactId,
        "x-flarex-source-package-hash": ref.sourcePackageHash,
      },
      body: JSON.stringify(request),
    }));
    // Deliberate runtime bridge: local artifact invoke API is Promise-based.
    return Effect.runPromise(
      decodeExecutionArtifactInvokeBody(response).pipe(
        Effect.mapError(executionArtifactResponseErrorToError),
      ),
    );
  }
}

const decodeExecutionArtifactAnalysisBody = Effect.fn("ExecutionArtifact.decodeAnalysisBody")(
  function* (response: ExecutionArtifactHttpResponse) {
    const body = yield* readExecutionArtifactResponseJson(response);
    const diagnostics = diagnosticsFromBody(body);
    if (!response.ok) {
      return yield* Effect.fail(new ExecutionArtifactResponseError({
        operation: "analysis",
        status: response.status,
        message: errorMessageFromBody(body)
          ?? `Execution artifact analysis failed with status ${response.status}`,
        diagnostics,
        body,
      }));
    }
    return { body, diagnostics };
  },
);

const decodeExecutionArtifactInvokeBody = Effect.fn("ExecutionArtifact.decodeInvokeBody")(
  function* (response: ExecutionArtifactHttpResponse) {
    const body = yield* readExecutionArtifactResponseJson(response);
    if (!response.ok) {
      return yield* Effect.fail(new ExecutionArtifactResponseError({
        operation: "invoke",
        status: response.status,
        message: errorMessageFromBody(body)
          ?? `Execution artifact invoke failed with status ${response.status}`,
        diagnostics: [],
        body,
      }));
    }
    return body;
  },
);

function readExecutionArtifactResponseJson(
  response: ExecutionArtifactHttpResponse,
): Effect.Effect<unknown> {
  return readDevResponseJsonOrNullEffect(response);
}

function diagnosticsFromBody(body: unknown): AnalyzerDiagnostic[] {
  return normalizeAnalyzerDiagnostics(
    typeof body === "object" && body !== null && "diagnostics" in body
      ? (body as { diagnostics: unknown }).diagnostics
      : undefined,
  );
}

function errorMessageFromBody(body: unknown): string | undefined {
  return typeof body === "object" && body !== null && "error" in body
    ? String((body as { error: unknown }).error)
    : undefined;
}

function executionArtifactResponseErrorToAnalysisError(
  error: ExecutionArtifactResponseError,
): ExecutionArtifactAnalysisError {
  return new ExecutionArtifactAnalysisError(error.message, error.diagnostics);
}

function executionArtifactResponseErrorToError(error: ExecutionArtifactResponseError): Error {
  return new Error(error.message);
}

async function bundledAnalysisWorkerSource(sourcePackage: SourcePackage): Promise<string> {
  const entryId = "virtual:flarex-execution-artifact-analysis-worker";
  const resolvedEntryId = "\0flarex-execution-artifact-analysis-worker";
  const workerSource = analysisWorkerSource(sourcePackage);
  const plugin: Plugin = {
    name: "flarex-execution-artifact-analysis-worker",
    resolveId(id) {
      if (id === entryId) return resolvedEntryId;
      return resolveAnalysisWorkerDependency(id);
    },
    load(id) {
      return id === resolvedEntryId ? workerSource : undefined;
    },
  };

  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [plugin],
    build: {
      write: false,
      target: "es2022",
      rollupOptions: {
        input: entryId,
        external: ["cloudflare:workers"],
        preserveEntrySignatures: "strict",
        output: {
          format: "es",
          entryFileNames: "worker.js",
          inlineDynamicImports: true,
        },
      },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : [],
  );
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.isEntry);
  if (!worker || worker.type !== "chunk") {
    throw new Error("Execution artifact analysis worker bundle was not emitted.");
  }
  return worker.code;
}

function resolveAnalysisWorkerDependency(id: string): string | undefined {
  if (
    id === "@flarex/analysis" ||
    id.startsWith("@flarex/analysis/") ||
    id === "flarex" ||
    id.startsWith("flarex/") ||
    id === "flarex-protocol" ||
    id.startsWith("flarex-protocol/")
  ) {
    return fileURLToPath(import.meta.resolve(id));
  }
  return undefined;
}

function analysisWorkerSource(sourcePackage: SourcePackage): string {
  const executionImport = `./${sourcePackage.execution}`;
  const schemaImport = sourcePackage.schema === undefined ? null : `./${sourcePackage.schema}`;
  const sourceMaps = Object.fromEntries(
    sourcePackage.functions.flatMap(modulePath => {
      const module = sourcePackage.modules.find(candidate => candidate.path === modulePath);
      if (module?.sourceMap === undefined) return [];
      return [[module.path.replace(/\.js$/, ""), module.sourceMap]];
    }),
  );

  return `// Generated by flarex-dev for local execution-artifact analysis.
import { Effect } from "effect";
import { analyzeLoadedSourcePackageEffect } from "@flarex/analysis";

const executionImport = ${JSON.stringify(executionImport)};
const schemaImport = ${schemaImport === null ? "null" : JSON.stringify(schemaImport)};
const functionSourceMaps = ${JSON.stringify(sourceMaps)};

async function analyze() {
  const diagnostics = [];
  const restoreConsole = installConsoleCapture(diagnostics);
  const restoreGlobals = installImportPhaseGlobals(diagnostics);
  try {
    let executionModule;
    let schemaModule;
    try {
      executionModule = await import(/* @vite-ignore */ executionImport);
      schemaModule = schemaImport === null
        ? { default: undefined }
        : await import(/* @vite-ignore */ schemaImport);
    } finally {
      restoreGlobals();
    }
    const schemaDefinition = schemaModule.default;
    if (schemaImport !== null && schemaDefinition === undefined) {
      throw new Error("Schema default export must be a Flarex schema definition.");
    }
    const analysis = await Effect.runPromise(analyzeLoadedSourcePackageEffect({
      executionModules: executionModule.default,
      schemaDefinition,
      sourceMaps: functionSourceMaps,
      sourceMapFailure: "ignore",
    }));
    return {
      analysis,
      diagnostics,
    };
  } catch (error) {
    if (isRecord(error)) {
      try {
        error.diagnostics = diagnostics;
      } catch {}
    }
    throw error;
  } finally {
    restoreConsole();
  }
}

function installConsoleCapture(diagnostics) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const write = (level, args) => {
    diagnostics.push({ level, message: args.map(formatConsoleArg).join(" ") });
    if (diagnostics.length > 100) diagnostics.shift();
    const originalMethod = original[level];
    if (typeof originalMethod === "function") {
      originalMethod.apply(console, args);
    }
  };
  try {
    console.log = (...args) => write("log", args);
    console.warn = (...args) => write("warn", args);
    console.error = (...args) => write("error", args);
  } catch {
    return () => {};
  }
  return () => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  };
}

function installImportPhaseGlobals(diagnostics) {
  const restore = [];
  installDeterministicDate(restore);
  installDeterministicRandom(restore);
  installRejectedGlobal(restore, diagnostics, globalThis, "fetch", "fetch is not supported during Flarex analysis import.");
  installRejectedCrypto(restore, diagnostics);
  installRejectedPerformance(restore, diagnostics);
  return () => {
    for (let index = restore.length - 1; index >= 0; index--) {
      restore[index]();
    }
  };
}

function installDeterministicDate(restore) {
  const OriginalDate = Date;
  const fixedUnixTimeMs = 1700000000000;
  class FlarexAnalysisDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedUnixTimeMs);
      } else {
        super(...args);
      }
    }
    static now() {
      return fixedUnixTimeMs;
    }
  }
  FlarexAnalysisDate.UTC = OriginalDate.UTC;
  FlarexAnalysisDate.parse = OriginalDate.parse;
  installValue(restore, globalThis, "Date", FlarexAnalysisDate);
}

function installDeterministicRandom(restore) {
  let seed = 0x5eed1234;
  installValue(restore, Math, "random", () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  });
}

function installRejectedCrypto(restore, diagnostics) {
  if (!isRecord(globalThis.crypto)) return;
  installRejectedGlobal(
    restore,
    diagnostics,
    globalThis.crypto,
    "randomUUID",
    "crypto.randomUUID is not supported during Flarex analysis import.",
  );
  installRejectedGlobal(
    restore,
    diagnostics,
    globalThis.crypto,
    "getRandomValues",
    "crypto.getRandomValues is not supported during Flarex analysis import.",
  );
}

function installRejectedPerformance(restore, diagnostics) {
  if (!isRecord(globalThis.performance)) return;
  installRejectedGlobal(
    restore,
    diagnostics,
    globalThis.performance,
    "now",
    "performance.now is not supported during Flarex analysis import.",
  );
}

function installRejectedGlobal(restore, diagnostics, target, key, message) {
  installValue(restore, target, key, () => {
    diagnostics.push({ level: "error", message });
    if (diagnostics.length > 100) diagnostics.shift();
    throw new Error(message);
  });
}

function installValue(restore, target, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      value,
    });
  } catch {
    return;
  }
  restore.push(() => {
    if (descriptor === undefined) {
      try {
        delete target[key];
      } catch {}
      return;
    }
    try {
      Object.defineProperty(target, key, descriptor);
    } catch {}
  });
}

function formatConsoleArg(value) {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function errorDiagnostics(error) {
  return isRecord(error) && Array.isArray(error.diagnostics) ? error.diagnostics : [];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/analyze" || request.method !== "POST") {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    try {
      return Response.json(await analyze());
    } catch (error) {
      return Response.json({ error: errorMessage(error), diagnostics: errorDiagnostics(error) }, { status: 400 });
    }
  },
};
`;
}
