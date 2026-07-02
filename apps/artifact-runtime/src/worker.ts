import {
  createExecutionArtifactRuntimeService,
  type ExecutionArtifactMaterializer,
  type ExecutionArtifactRuntimeService,
} from "flarex-backend/artifact-runtime";
import {
  R2BackendExecutionArtifactStore,
  type R2BucketLike,
} from "flarex-backend/artifact-store";

export type ArtifactRuntimeEnv = {
  readonly ARTIFACTS: R2BucketLike;
  readonly FLAREX_ARTIFACT_RUNTIME_TOKEN?: string;
};

export type ArtifactRuntimeWorker = {
  fetch(request: Request, env: ArtifactRuntimeEnv): Promise<Response>;
};

export class HostedArtifactRuntimeMaterializerUnavailableError extends Error {
  readonly status = 501;
  readonly artifactId: string;

  constructor(artifactId: string) {
    super(`Hosted artifact runtime materializer is not wired for artifact ${artifactId}.`);
    this.name = "HostedArtifactRuntimeMaterializerUnavailableError";
    this.artifactId = artifactId;
  }
}

export class HostedArtifactRuntimeMissingCapabilityTokenError extends Error {
  readonly status = 500;

  constructor() {
    super("FLAREX_ARTIFACT_RUNTIME_TOKEN is required for hosted artifact runtime requests.");
    this.name = "HostedArtifactRuntimeMissingCapabilityTokenError";
  }
}

export function createArtifactRuntimeWorker(options: {
  readonly materializer?: ExecutionArtifactMaterializer;
} = {}): ArtifactRuntimeWorker {
  const services = new WeakMap<ArtifactRuntimeEnv, ExecutionArtifactRuntimeService>();
  const materializer = options.materializer ?? unavailableHostedMaterializer;

  function serviceForEnv(env: ArtifactRuntimeEnv): ExecutionArtifactRuntimeService {
    const cached = services.get(env);
    if (cached !== undefined) return cached;

    const capabilityToken = env.FLAREX_ARTIFACT_RUNTIME_TOKEN;
    const service = createExecutionArtifactRuntimeService({
      materializer,
      store: new R2BackendExecutionArtifactStore(env.ARTIFACTS),
      ...(capabilityToken === undefined ? {} : { capabilityToken }),
    });
    services.set(env, service);
    return service;
  }

  return {
    fetch: (request, env) => {
      if (env.FLAREX_ARTIFACT_RUNTIME_TOKEN === undefined) {
        return Promise.resolve(
          Response.json(
            { error: new HostedArtifactRuntimeMissingCapabilityTokenError().message },
            { status: 500 },
          ),
        );
      }
      return serviceForEnv(env)(request);
    },
  };
}

const unavailableHostedMaterializer: ExecutionArtifactMaterializer = {
  materialize: payload => Promise.reject(
    new HostedArtifactRuntimeMaterializerUnavailableError(payload.ref.artifactId),
  ),
};

export default createArtifactRuntimeWorker() satisfies ExportedHandler<ArtifactRuntimeEnv>;
