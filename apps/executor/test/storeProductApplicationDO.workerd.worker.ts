import { Cause, Clock, Effect, Result } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { makeStoreProductRequestReads, makeStoreProductRequestScopeFactory } from "@flarex/medusa-adapter/internal/store-product-request";
import { compileStoreProductRequestFixtureCatalog, storeProductLogger } from "@flarex/medusa-adapter/internal/system-test/store-product-request-catalog";
import { makeStoreProductEffectHttpHandler } from "@flarex/medusa-http/store-product-effect";
import { makeExecutorApplicationCredentials, executorApplicationSha256 } from "../src/applicationComposition";
import { executorApplicationObjectConfiguration, readExecutorApplicationProfiles, type ExecutorApplicationEnv } from "../src/applicationConfiguration";
import { makeApplicationDurableObject } from "../src/applicationDO";
import { admitExecutorRequest } from "../src/requestLifecycle";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

interface Env extends ExecutorApplicationEnv { readonly APPLICATIONS: DurableObjectNamespace<NativeStoreProductApplicationFixture> }
const { catalog } = await Effect.runPromise(compileStoreProductRequestFixtureCatalog());
const workload = executorApplicationProfileFixture().workload;
type Failure = Effect.Error<ReturnType<typeof makeExecutorApplicationCredentials>>
  | Effect.Error<ReturnType<typeof makePreparedHostRuntime>> | Effect.Error<ReturnType<typeof makeStoreProductRequestReads>>;
const NativeOwner = makeApplicationDurableObject<ExecutorApplicationEnv, Failure>({
  configuration: executorApplicationObjectConfiguration,
  workload: { ...workload, schemaScheduler: { ...workload.schemaScheduler, wakeDelayMilliseconds: 60_000, continuationDelayMilliseconds: 60_000 } },
  coreOptions: { schemaBundles: [catalog.bundle], now: Clock.currentTimeMillis.pipe(Effect.map(ms => BigInt(Math.floor(ms)) * 1_000_000n)),
    randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))) },
  application: Effect.fn("NativeStoreProductDO.compose")(function* (env, infrastructure) {
    const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))[0];
    if (profile === undefined) return yield* Effect.die(new Error("Missing private Store Product identity"));
    const credentials = yield* makeExecutorApplicationCredentials(env, profile);
    const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 17, maximumPreparedBytes: 8 * 1024 * 1024 });
    const reads = yield* makeStoreProductRequestReads({ database: infrastructure.coreDatabase, hostRuntime, catalog,
      identityAndAccessPolicy: { profile: "native-store-product-private-do-proof" } });
    const container = createContainer().register({ logger: asValue(storeProductLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const scopes = yield* makeStoreProductRequestScopeFactory({ reads, container });
    const http = yield* makeStoreProductEffectHttpHandler({ storeCors: "https://store.test", ...scopes,
      // Test-only fixed credential verification at the trusted resolver edge.
      // An arbitrary actor header never becomes a customer identity.
      resolveCustomerPrincipal: request => request.headers.get("x-proof-customer-credential") === "store-proof-verified-customer-secret"
        ? { actor_id: "cus_store_verified", actor_type: "customer", auth_identity_id: "auth_store_verified", app_metadata: {}, user_metadata: {} } : undefined });
    const dispatch = Effect.fn("NativeStoreProductDO.dispatch")((request: Request) => {
      const headers = new Headers(request.headers); headers.delete("authorization");
      return Effect.promise(() => http.handler(new Request(request, { headers })));
    });
    return { ...credentials, deploymentId: profile.deploymentId, maximumAttempts: profile.maximumAttempts,
      applicationRunner: { source: infrastructure.source, host: infrastructure.host, hostPolicy: profile.hostPolicy,
        hostPolicySha256: yield* executorApplicationSha256(profile.hostPolicyCanonicalBytes), sha256: executorApplicationSha256 },
      executionContextFactory: { make: () => Effect.sync(() => ({ executionId: crypto.randomUUID(), logScopeId: crypto.randomUUID(),
        randomSeed: crypto.getRandomValues(new Uint8Array(32)) })) }, dispatch };
  }),
  dispatch: () => Effect.die(new Error("Native Store Product composition is not prepared")),
  failureResponse: cause => { console.error("Native Store Product DO refused", Cause.pretty(cause)); return Response.json({ error: "native_store_product_unavailable" }, { status: 503 }); },
});

export class NativeStoreProductApplicationFixture extends NativeOwner {
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
  if (profile === undefined) throw new Error("Missing private Store Product identity");
  return env.APPLICATIONS.getByName(profile.canonicalName).fetch(request);
} } satisfies ExportedHandler<Env>;
