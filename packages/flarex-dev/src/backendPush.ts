import type { Miniflare } from "miniflare";
import type { DeploymentAnalysis } from "./analyze.ts";
import {
  ExecutionArtifactAnalysisError,
  LocalMiniflareExecutionArtifactAdapter,
  type AnalyzerDiagnostic,
  type ExecutionArtifactAdapter,
} from "./executionArtifact.ts";
import type { SourcePackage } from "./sourcePackage.ts";

export type DevPushStatus = {
  pushId: string;
  state: "pending" | "analyzed" | "failed" | "activated" | "superseded";
  analysis?: {
    schema: unknown;
    functions: { functions: unknown[] };
  };
  codegenAnalysis?: DeploymentAnalysis;
  error?: string;
  diagnostics?: AnalyzerDiagnostic[];
};

export interface BackendPushCoordinator {
  start(sourcePackage: SourcePackage): Promise<DevPushStatus>;
  finish(pushId: string): Promise<DevPushStatus>;
}

export interface BackendSourceAnalyzer {
  analyze(sourcePackage: SourcePackage): Promise<BackendSourceAnalysisResult>;
}

export type BackendSourceAnalysisResult = {
  analysis: DeploymentAnalysis;
  diagnostics?: AnalyzerDiagnostic[];
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
      return Response.json({
        analysis: backendAnalysisFromCodegenAnalysis(result.analysis),
        diagnostics: result.diagnostics ?? [],
      });
    } catch (error) {
      return Response.json(
        { error: errorMessage(error), diagnostics: diagnosticsFromError(error) },
        { status: 400 },
      );
    }
  };
}

export function backendAnalysisFromCodegenAnalysis(
  analysis: DeploymentAnalysis,
): { schema: DeploymentAnalysis["schema"]; functions: { functions: unknown[] } } {
  return {
    schema: analysis.schema,
    functions: {
      functions: analysis.functions.flatMap(module =>
        module.functions.map(fn => ({
          path: fn.exportName === "default" ? fn.moduleName : `${fn.moduleName}:${fn.exportName}`,
          kind: fn.kind,
          visibility: fn.visibility,
          args: fn.args,
          returns: fn.returns,
          route: fn.route ?? null,
          ...(fn.position === undefined ? {} : { position: fn.position }),
        })),
      ),
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticsFromError(error: unknown): AnalyzerDiagnostic[] {
  return error instanceof ExecutionArtifactAnalysisError ? error.diagnostics : [];
}

function stableAnalysisJson(analysis: DeploymentAnalysis): string {
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
