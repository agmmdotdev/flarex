import { Cause, Clock, Effect, Result } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { compileProductRequestCatalog, makeProductRequestOperations, makeProductRequestScopeFactory } from "@flarex/medusa-adapter/internal/product-request";
import { makeAdminProductEffectHttpHandler } from "@flarex/medusa-http/admin-product-effect";
import { makeExecutorApplicationCredentials, executorApplicationSha256 } from "../src/applicationComposition";
import { executorApplicationObjectConfiguration, readExecutorApplicationProfiles, type ExecutorApplicationEnv } from "../src/applicationConfiguration";
import { makeApplicationDurableObject } from "../src/applicationDO";
import { admitExecutorRequest } from "../src/requestLifecycle";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";
import { adminProductDOFixtureTarget } from "./support/adminProductDOFixtureIdentity";

interface NativeProductEnv extends ExecutorApplicationEnv {
  readonly ADMIN_PRODUCT_CREDENTIAL: string;
}
interface Env extends NativeProductEnv {
  readonly APPLICATIONS: DurableObjectNamespace<NativeAdminProductApplicationFixture>;
}

// Only deterministic native definition production occurs here. Provisioning and
// all initialization receipts are complete before this Worker starts.
const catalog = await Effect.runPromise(compileProductRequestCatalog(adminProductDOFixtureTarget));
const workload = executorApplicationProfileFixture().workload;
type NativeFixtureFailure = Effect.Error<ReturnType<typeof makeExecutorApplicationCredentials>>
  | Effect.Error<ReturnType<typeof makePreparedHostRuntime>> | Effect.Error<ReturnType<typeof makeProductRequestOperations>>;
const NativeOwner = makeApplicationDurableObject<NativeProductEnv, NativeFixtureFailure>({
  configuration: executorApplicationObjectConfiguration,
  workload: { ...workload, schemaScheduler: { ...workload.schemaScheduler,
    wakeDelayMilliseconds: 60_000, continuationDelayMilliseconds: 60_000 } },
  coreOptions: { schemaBundles: [catalog.bundle], now: Clock.currentTimeMillis.pipe(Effect.map(ms => BigInt(Math.floor(ms)) * 1_000_000n)),
    randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))) },
  application: Effect.fn("NativeAdminProductApplicationFixture.compose")(function* (env, infrastructure) {
    const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))[0];
    if (profile === undefined) return yield* Effect.die("Missing private native Product fixture identity");
    const credentials = yield* makeExecutorApplicationCredentials(env, profile);
    const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
    const operations = yield* makeProductRequestOperations({ database: infrastructure.coreDatabase, hostRuntime, catalog,
      identityAndAccessPolicy: { profile: "native-admin-product-private-do-fixture" }, revision: "d".repeat(64),
      subscribers: [{ id: "native-admin-product-request", revision: "e".repeat(64) }] });
    const container = createContainer().register({
      logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }),
    });
    const scopes = yield* makeProductRequestScopeFactory({ operations, container });
    const http = yield* makeAdminProductEffectHttpHandler({ adminCors: "https://admin.test", ...scopes,
      resolveAdminPrincipal: request => {
        const credential = request.headers.get("x-admin-fixture-token");
        const actor = credential === env.ADMIN_PRODUCT_CREDENTIAL ? "user_native_product"
          : credential === `${env.ADMIN_PRODUCT_CREDENTIAL}-without-policy` ? "user_native_product_unprivileged" : undefined;
        return actor === undefined ? undefined : { actor_id: actor, actor_type: "user", auth_identity_id: "auth_native_product",
          app_metadata: {}, user_metadata: {} };
      },
      evaluateAdminPolicies: (principal, policies) => principal.actor_id === "user_native_product"
        && policies.length === 3 && policies.every((policy, index) => policy.resource === ["product", "inventory_item", "price"][index]
          && policy.operation === "create"),
      admitProductRefetchFields: operations.admitProductRefetchFields });
    const dispatch = Effect.fn("NativeAdminProductApplicationFixture.dispatch")((request: Request) => {
      // Private service authority does not confer Medusa user identity. Only
      // the separate trusted resolver above can establish an administrator.
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      return Effect.promise(() => http.handler(new Request(request, { headers })));
    });
    return { ...credentials, deploymentId: profile.deploymentId, maximumAttempts: profile.maximumAttempts,
      applicationRunner: { source: infrastructure.source, host: infrastructure.host, hostPolicy: profile.hostPolicy,
        hostPolicySha256: yield* executorApplicationSha256(profile.hostPolicyCanonicalBytes), sha256: executorApplicationSha256 },
      executionContextFactory: { make: () => Effect.sync(() => ({ executionId: crypto.randomUUID(), logScopeId: crypto.randomUUID(),
        randomSeed: crypto.getRandomValues(new Uint8Array(32)) })) }, dispatch };
  }),
  dispatch: () => Effect.die("Native Product fixture composition is not prepared"),
  failureResponse: cause => {
    console.error("Native Product fixture refused", Cause.pretty(cause));
    return Response.json({ error: "native_product_unavailable" }, { status: 503 });
  },
});

/** A test-only native-ready application owner; production profiles stay unchanged. */
export class NativeAdminProductApplicationFixture extends NativeOwner {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/__proof/close") {
      const admitted = admitExecutorRequest(request, this.env);
      if (Result.isFailure(admitted)) return admitted.failure;
      await this.close();
      return Response.json({ closed: true });
    }
    return super.fetch(request);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))[0];
    if (profile === undefined) throw new Error("Missing private native Product fixture identity");
    return env.APPLICATIONS.getByName(profile.canonicalName).fetch(request);
  },
} satisfies ExportedHandler<Env>;
