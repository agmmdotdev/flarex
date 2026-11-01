import { Cause, Result } from "effect";
import { makeExecutorApplicationOptions } from "../src/application";
import { makeApplicationDurableObject } from "../src/applicationDO";
import { executorApplicationFailureResponse } from "../src/applicationComposition";
import { readExecutorApplicationProfiles, type ExecutorApplicationEnv } from "../src/applicationConfiguration";
import { makeApplicationExecutorGateway } from "../src/applicationGateway";
import { admitExecutorRequest } from "../src/requestLifecycle";
import { ApplicationSourceUploadDO } from "./support/applicationDOSourceUpload";
export { ApplicationSourceUploadDO };
export { FlarexApplicationAnalysisHost } from "../../analyzer/src/ApplicationAnalysisEntrypoint";

interface Env extends ExecutorApplicationEnv {
  readonly APPLICATIONS: DurableObjectNamespace<ConfiguredApplicationDO>;
  readonly UPLOADS: DurableObjectNamespace;
}

/** Native-binding observation around the real configured production owner. */
const ConfiguredProductionOwner = makeApplicationDurableObject({ ...makeExecutorApplicationOptions(),
  failureResponse: cause => {
    console.error("Configured app proof owner refusal", Cause.pretty(cause));
    return executorApplicationFailureResponse(cause);
  },
});
export class ConfiguredApplicationDO extends ConfiguredProductionOwner {
  readonly #resources: { sourceReads: number };
  constructor(ctx: DurableObjectState, env: ExecutorApplicationEnv) {
    const resources = { sourceReads: 0 };
    const artifacts = new Proxy(env.ARTIFACTS, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (property === "get") resources.sourceReads++;
          return Reflect.apply(value, target, args);
        };
      },
    });
    super(ctx, { ...env, ARTIFACTS: artifacts });
    this.#resources = resources;
  }
  override async fetch(request: Request): Promise<Response> {
    const admitted = admitExecutorRequest(request, this.env);
    if (Result.isFailure(admitted)) return admitted.failure;
    const path = new URL(request.url).pathname;
    if (path === "/__proof/resources") return Response.json(this.#resources);
    if (path === "/__proof/close") {
      await request.arrayBuffer();
      await this.close();
      return Response.json({ closed: true });
    }
    return super.fetch(request);
  }
}

const gateway = makeApplicationExecutorGateway({ fetch: async () => {
  throw new Error("The configured Core proof must not enter the legacy executor.");
} });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const admitted = admitExecutorRequest(request, env);
    if (Result.isFailure(admitted)) return admitted.failure;
    const path = new URL(request.url).pathname;
    if (path === "/__proof/source") return env.UPLOADS.getByName("source-upload").fetch(request);
    if (path.startsWith("/__proof/")) {
      const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))[0];
      if (profile === undefined) throw new Error("The configured proof needs one operator profile.");
      return env.APPLICATIONS.getByName(path === "/__proof/wrong-object" ? "unregistered-object" : profile.canonicalName).fetch(request);
    }
    const response = await gateway.fetch(request, env);
    if (request.headers.get("x-proof-drop-response") === "1" && response.ok) {
      // The observer retains a trace; the caller receives an unsuccessful transport result.
      return Response.json({ error: "simulated_response_loss", committed: await response.json() }, { status: 502 });
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
