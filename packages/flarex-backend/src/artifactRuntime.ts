import type { BackendExecutionArtifactStore } from "./artifactStore";
import { HttpError } from "./http";
import type {
  ActiveDeploymentStatus,
  InvokeRequest,
  InvokeResponse,
  PushSourcePackage,
} from "./types";

export type ExecutionArtifactInvokePayload = {
  deploymentId: string;
  ref: ActiveDeploymentStatus["executionArtifactRef"];
  sourcePackage: PushSourcePackage;
  request: InvokeRequest;
};

export interface BackendExecutionArtifactRuntime {
  invoke(
    deployment: ActiveDeploymentStatus,
    request: InvokeRequest,
  ): Promise<InvokeResponse>;
}

export class ServiceBindingExecutionArtifactRuntime implements BackendExecutionArtifactRuntime {
  private readonly runtime: Fetcher;
  private readonly store: BackendExecutionArtifactStore;
  private readonly deploymentId: string;
  private readonly capabilityToken: string | undefined;

  constructor(options: {
    runtime: Fetcher;
    store: BackendExecutionArtifactStore;
    deploymentId: string;
    capabilityToken?: string;
  }) {
    this.runtime = options.runtime;
    this.store = options.store;
    this.deploymentId = options.deploymentId;
    this.capabilityToken = options.capabilityToken;
  }

  async invoke(
    deployment: ActiveDeploymentStatus,
    request: InvokeRequest,
  ): Promise<InvokeResponse> {
    const sourcePackage = await this.store.get(deployment.executionArtifactRef);
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: this.deploymentId,
      ref: deployment.executionArtifactRef,
      sourcePackage,
      request,
    };
    const response = await this.runtime.fetch("https://flarex-artifact-runtime.internal/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flarex-artifact-id": deployment.executionArtifactRef.artifactId,
        "x-flarex-source-package-hash": deployment.executionArtifactRef.sourcePackageHash,
        ...(this.capabilityToken === undefined
          ? {}
          : { authorization: `Bearer ${this.capabilityToken}` }),
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : `Execution artifact runtime failed with status ${response.status}`;
      throw new HttpError(response.status, message);
    }
    return body as InvokeResponse;
  }
}
