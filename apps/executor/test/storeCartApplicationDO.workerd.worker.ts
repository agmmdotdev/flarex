import { Cause, Clock, Effect, Result, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { makeStoreCartRequestRuntime, makeStoreCartRequestScopeFactory } from "@flarex/medusa-adapter/internal/store-cart-request";
import { compileStoreCartRequestFixtureCatalog, storeCartLogger } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-catalog";
import { makeStoreCartEffectHttpHandler } from "@flarex/medusa-http/store-cart-effect";
import { makeExecutorApplicationCredentials, executorApplicationSha256 } from "../src/applicationComposition";
import { executorApplicationObjectConfiguration, readExecutorApplicationProfiles, type ExecutorApplicationEnv } from "../src/applicationConfiguration";
import { makeApplicationDurableObject } from "../src/applicationDO";
import { admitExecutorRequest } from "../src/requestLifecycle";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

interface Env extends ExecutorApplicationEnv { readonly APPLICATIONS: DurableObjectNamespace<NativeStoreCartApplicationFixture> }
const { catalog } = await Effect.runPromise(compileStoreCartRequestFixtureCatalog());
const workload = executorApplicationProfileFixture().workload;
const failsCartUpdate = Schema.is(Schema.Struct({ additional_data: Schema.Struct({ fail_cart_hook: Schema.Literal(true) }) }));
type Failure = Effect.Error<ReturnType<typeof makeExecutorApplicationCredentials>>
  | Effect.Error<ReturnType<typeof makePreparedHostRuntime>> | Effect.Error<ReturnType<typeof makeStoreCartRequestRuntime>>;
const NativeOwner = makeApplicationDurableObject<ExecutorApplicationEnv, Failure>({
  configuration: executorApplicationObjectConfiguration,
  workload: { ...workload, schemaScheduler: { ...workload.schemaScheduler, wakeDelayMilliseconds: 60_000, continuationDelayMilliseconds: 60_000 } },
  coreOptions: { schemaBundles: [catalog.bundle], now: Clock.currentTimeMillis.pipe(Effect.map(ms => BigInt(Math.floor(ms)) * 1_000_000n)),
    randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))) },
  application: Effect.fn("NativeStoreCartDO.compose")(function* (env, infrastructure) {
    const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))[0];
    if (profile === undefined) return yield* Effect.die(new Error("Missing private Store Cart identity"));
    const credentials = yield* makeExecutorApplicationCredentials(env, profile);
    const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
    const runtime = yield* makeStoreCartRequestRuntime({ database: infrastructure.coreDatabase, hostRuntime, catalog,
      identityAndAccessPolicy: { profile: "native-store-cart-private-do-proof" },
      revision: "1".repeat(64), subscribers: [{ id: "native-store-cart-http", revision: "2".repeat(64) }],
      mutationHooks: { cartUpdated: value => { if (failsCartUpdate(value)) throw new Error("late-workerd-cart-update"); } } });
    const container = createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime, container });
    const http = yield* makeStoreCartEffectHttpHandler({ storeCors: "https://store.test", ...scopes,
      admitCartRefetchFields: runtime.admitCartRefetchFields,
      // A fixed test credential stands in for the trusted verifier. Arbitrary
      // actor headers never become a native customer principal.
      resolveCustomerPrincipal: request => request.headers.get("x-proof-customer-credential") === "store-cart-verified-secret"
        ? { actor_id: "cus-create-root", actor_type: "customer", auth_identity_id: "auth_cart_verified", app_metadata: {}, user_metadata: {} } : undefined });
    const dispatch = Effect.fn("NativeStoreCartDO.dispatch")((request: Request) => {
      const headers = new Headers(request.headers); headers.delete("authorization");
      return Effect.promise(() => http.handler(new Request(request, { headers })));
    });
    return { ...credentials, deploymentId: profile.deploymentId, maximumAttempts: profile.maximumAttempts,
      applicationRunner: { source: infrastructure.source, host: infrastructure.host, hostPolicy: profile.hostPolicy,
        hostPolicySha256: yield* executorApplicationSha256(profile.hostPolicyCanonicalBytes), sha256: executorApplicationSha256 },
      executionContextFactory: { make: () => Effect.sync(() => ({ executionId: crypto.randomUUID(), logScopeId: crypto.randomUUID(),
        randomSeed: crypto.getRandomValues(new Uint8Array(32)) })) }, dispatch };
  }),
  dispatch: () => Effect.die(new Error("Native Store Cart composition is not prepared")),
  failureResponse: cause => { console.error("Native Store Cart DO refused", Cause.pretty(cause)); return Response.json({ error: "native_store_cart_unavailable" }, { status: 503 }); },
});

export class NativeStoreCartApplicationFixture extends NativeOwner {
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
  if (profile === undefined) throw new Error("Missing private Store Cart identity");
  return env.APPLICATIONS.getByName(profile.canonicalName).fetch(request);
} } satisfies ExportedHandler<Env>;
