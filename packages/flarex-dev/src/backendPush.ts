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

export class LocalBackendPushCoordinator implements BackendPushCoordinator {
  private readonly backend: Miniflare;
  private readonly deploymentId: string;
  private readonly executionArtifact: ExecutionArtifactAdapter;

  constructor(
    backend: Miniflare,
    deploymentId: string,
    executionArtifact: ExecutionArtifactAdapter = new LocalMiniflareExecutionArtifactAdapter(),
  ) {
    this.backend = backend;
    this.deploymentId = deploymentId;
    this.executionArtifact = executionArtifact;
  }

  async start(sourcePackage: SourcePackage): Promise<DevPushStatus> {
    const analysis = await this.executionArtifact.analyze(sourcePackage);
    return postBackend<DevPushStatus>(
      this.backend,
      `/deployments/${this.deploymentId}/push/start`,
      {
        sourcePackage,
        analysis: backendAnalysisFromCodegenAnalysis(analysis),
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

function backendAnalysisFromCodegenAnalysis(
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
