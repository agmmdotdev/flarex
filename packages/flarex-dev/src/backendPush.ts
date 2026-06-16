import type { Miniflare } from "miniflare";
import type { DeploymentAnalysis } from "./analyze.ts";
import {
  LocalMiniflareExecutionArtifactAdapter,
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
};

export interface BackendPushCoordinator {
  start(sourcePackage: SourcePackage): Promise<DevPushStatus>;
  finish(pushId: string): Promise<DevPushStatus>;
}

export interface BackendSourceAnalyzer {
  analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis>;
}

export class LocalExecutionArtifactBackendAnalyzer implements BackendSourceAnalyzer {
  private readonly executionArtifact: ExecutionArtifactAdapter;

  constructor(executionArtifact: ExecutionArtifactAdapter = new LocalMiniflareExecutionArtifactAdapter()) {
    this.executionArtifact = executionArtifact;
  }

  analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis> {
    return this.executionArtifact.analyze(sourcePackage);
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
      return Response.json({
        analysis: backendAnalysisFromCodegenAnalysis(await analyzer.analyze(body.sourcePackage)),
      });
    } catch (error) {
      return Response.json({ error: errorMessage(error) }, { status: 400 });
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
        })),
      ),
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
