import { Cause, Result } from "effect";
import publicBackend from "../../../packages/flarex-backend/src/worker";
import type { Env as BackendEnv } from "../../../packages/flarex-backend/src/types";
import privateExecutor from "../src/worker";
import { makeExecutorApplicationOptions } from "../src/application";
import { ExecutorApplicationCompositionError } from "../src/applicationComposition";
import { makeApplicationDurableObject } from "../src/applicationDO";
import { readExecutorApplicationProfiles, type ExecutorApplicationEnv } from "../src/applicationConfiguration";
import { admitExecutorRequest } from "../src/requestLifecycle";

export { RegistryDO, DeploymentDO, DeploymentSyncDO, ConnectionDO, DeliveryDO,
  PartitionDO, ExecutionDO, SchedulerDO } from "../../../packages/flarex-backend/src/worker";
export { FlarexApplicationAnalysisHost } from "../../analyzer/src/ApplicationAnalysisEntrypoint";

type Env = ExecutorApplicationEnv & BackendEnv & {
  readonly APPLICATIONS: DurableObjectNamespace<PublicProofApplication>;
};
const options = makeExecutorApplicationOptions();
const ObservedProductionApplication = makeApplicationDurableObject({ ...options, failureResponse: cause => {
  console.error("Public activation proof refusal", Cause.pretty(cause));
  for (const reason of cause.reasons) if (Cause.isFailReason(reason)
    && reason.error instanceof ExecutorApplicationCompositionError)
    console.error("Public activation proof typed refusal", JSON.stringify({ reason: reason.error.reason, cause: reason.error.cause }));
  if (options.failureResponse === undefined) throw new Error("Production failure projection is missing.");
  return options.failureResponse(cause);
} });

/** Observes native bindings around the unchanged production composition. */
export class PublicProofApplication extends ObservedProductionApplication {
  readonly #metrics: { sourceReads: number; sourceWrites: number };
  constructor(ctx: DurableObjectState, env: ExecutorApplicationEnv) {
    const metrics = { sourceReads: 0, sourceWrites: 0 };
    const artifacts = new Proxy(env.ARTIFACTS, { get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (property === "get") metrics.sourceReads++;
        if (property === "put") metrics.sourceWrites++;
        return Reflect.apply(value, target, args);
      };
    } });
    super(ctx, { ...env, ARTIFACTS: artifacts });
    this.#metrics = metrics;
  }
  override async fetch(request: Request): Promise<Response> {
    const admission = admitExecutorRequest(request, this.env);
    if (Result.isFailure(admission)) return admission.failure;
    const path = new URL(request.url).pathname;
    if (path === "/__proof/resources") return Response.json(this.#metrics);
    if (path === "/__proof/close") {
      await this.close();
      return Response.json({ closed: true });
    }
    return super.fetch(request);
  }
}

function forbidLegacyDeploymentAccess(namespace: DurableObjectNamespace): DurableObjectNamespace {
  return new Proxy(namespace, { get(target, property) {
    if (property === "get" || property === "getByName") return () => {
      throw new Error("A Core public deployment must not construct the legacy DeploymentDO.");
    };
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/applications/")) return privateExecutor.fetch(request, env);
    if (path.startsWith("/__proof/")) {
      const admission = admitExecutorRequest(request, env);
      if (Result.isFailure(admission)) return admission.failure;
      const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))[0];
      if (profile === undefined) throw new Error("Public activation proof requires one configured target.");
      return env.APPLICATIONS.getByName(profile.canonicalName).fetch(request);
    }
    // Native FLAREX_EXECUTOR points back to this Worker and enters the real
    // private executor branch above. No mocked fetch result or active metadata.
    const response = await publicBackend.fetch(request, { ...env,
      DEPLOYMENTS: forbidLegacyDeploymentAccess(env.DEPLOYMENTS) });
    if (request.headers.get("x-proof-drop-response") === "1" && response.ok) {
      await response.arrayBuffer();
      return Response.json({ error: "simulated_lost_public_acknowledgement" }, { status: 502 });
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
