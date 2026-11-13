import { Cause, Clock, Effect, Result } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { makeStoreCartRequestRuntime, makeStoreCartRequestScopeFactory, storeCartRequestHostLimits } from "@flarex/medusa-adapter/internal/store-cart-request";
import { compileStoreCartRequestFixtureCatalog, storeCartLogger, storeOrderHttpSeedRows } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-catalog";
import { makeStoreCartEffectHttpHandler } from "@flarex/medusa-http/store-cart-effect";
import { makeExecutorApplicationCredentials, executorApplicationSha256 } from "../src/applicationComposition";
import { executorApplicationObjectConfiguration, readExecutorApplicationProfiles, type ExecutorApplicationEnv } from "../src/applicationConfiguration";
import { makeApplicationDurableObject } from "../src/applicationDO";
import { admitExecutorRequest } from "../src/requestLifecycle";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

interface Env extends ExecutorApplicationEnv { readonly APPLICATIONS: DurableObjectNamespace<NativeStoreOrderApplicationFixture> }
const { catalog } = await Effect.runPromise(compileStoreCartRequestFixtureCatalog(undefined, storeOrderHttpSeedRows));
const workload = executorApplicationProfileFixture().workload;
type Failure = Effect.Error<ReturnType<typeof makeExecutorApplicationCredentials>>
  | Effect.Error<ReturnType<typeof makePreparedHostRuntime>> | Effect.Error<ReturnType<typeof makeStoreCartRequestRuntime>>;
const NativeOwner = makeApplicationDurableObject<ExecutorApplicationEnv, Failure>({
  configuration: executorApplicationObjectConfiguration,
  workload: { ...workload, schemaScheduler: { ...workload.schemaScheduler, wakeDelayMilliseconds: 60_000, continuationDelayMilliseconds: 60_000 } },
  coreOptions: { schemaBundles: [catalog.bundle], now: Clock.currentTimeMillis.pipe(Effect.map(ms => BigInt(Math.floor(ms)) * 1_000_000n)),
    randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))) },
  application: Effect.fn("NativeStoreOrderDO.compose")(function* (env, infrastructure) {
    const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))[0];
    if (profile === undefined) return yield* Effect.die(new Error("Missing private Store Order identity"));
    const credentials = yield* makeExecutorApplicationCredentials(env, profile);
    const hostRuntime = yield* makePreparedHostRuntime(storeCartRequestHostLimits);
    const runtime = yield* makeStoreCartRequestRuntime({ database: infrastructure.coreDatabase, hostRuntime, catalog,
      identityAndAccessPolicy: { profile: "native-store-order-private-do-proof" },
      revision: "1".repeat(64), subscribers: [{ id: "native-store-cart-http", revision: "2".repeat(64) }] });
    const container = createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const witnessed: typeof runtime = { ...runtime, runWorkflow: (name, input) => runtime.runWorkflow(name, input).pipe(
      Effect.tapCause(cause => Effect.sync(() => { console.error("Native Store Order workflow proof", name, Cause.pretty(cause)); }))) };
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime: witnessed, container });
    const http = yield* makeStoreCartEffectHttpHandler({ storeCors: "https://store.test", ...scopes,
      admitCartRefetchFields: runtime.admitCartRefetchFields,
      admitOrderRefetchFields: runtime.admitOrderRefetchFields,
      admitOrderReadFields: runtime.admitOrderReadFields,
      resolveCustomerPrincipal: request => {
        const credential = request.headers.get("x-proof-store-order-customer");
        return credential === "verified-owner" || credential === "verified-other" ? {
          actor_id: credential === "verified-owner" ? "cus-create-root" : "cus-store-other", actor_type: "customer",
          auth_identity_id: "auth_store_order_verified", app_metadata: {}, user_metadata: {},
        } : undefined;
      } });
    const dispatch = Effect.fn("NativeStoreOrderDO.dispatch")((request: Request) => {
      const headers = new Headers(request.headers); headers.delete("authorization");
      return Effect.promise(() => http.handler(new Request(request, { headers })));
    });
    return { ...credentials, deploymentId: profile.deploymentId, maximumAttempts: profile.maximumAttempts,
      applicationRunner: { source: infrastructure.source, host: infrastructure.host, hostPolicy: profile.hostPolicy,
        hostPolicySha256: yield* executorApplicationSha256(profile.hostPolicyCanonicalBytes), sha256: executorApplicationSha256 },
      executionContextFactory: { make: () => Effect.sync(() => ({ executionId: crypto.randomUUID(), logScopeId: crypto.randomUUID(),
        randomSeed: crypto.getRandomValues(new Uint8Array(32)) })) }, dispatch };
  }),
  dispatch: () => Effect.die(new Error("Native Store Order composition is not prepared")),
  failureResponse: cause => { console.error("Native Store Order DO refused", Cause.pretty(cause)); return Response.json({ error: "native_store_order_unavailable" }, { status: 503 }); },
});

export class NativeStoreOrderApplicationFixture extends NativeOwner {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/__proof/close") {
      const admitted = admitExecutorRequest(request, this.env);
      if (Result.isFailure(admitted)) return admitted.failure;
      await this.close(); return Response.json({ closed: true });
    }
    return super.fetch(request);
  }
}
export default { fetch(request: Request, env: Env): Promise<Response> {
  const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))[0];
  if (profile === undefined) throw new Error("Missing private Store Order identity");
  return env.APPLICATIONS.getByName(profile.canonicalName).fetch(request);
} } satisfies ExportedHandler<Env>;
