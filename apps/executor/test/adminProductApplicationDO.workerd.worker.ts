import { env as workerEnv } from "cloudflare:workers";
import { Cause, Clock, Effect, Result, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { compileProductRequestCatalog, makeProductRequestOperations, makeProductRequestScopeFactory } from "@flarex/medusa-adapter/internal/product-request";
import { compileStoreProductRequestFixtureCatalog } from "@flarex/medusa-adapter/internal/system-test/store-product-request-catalog";
import { makeAdminProductEffectHttpHandler } from "@flarex/medusa-http/admin-product-effect";
import { makeExecutorApplicationCredentials, executorApplicationSha256 } from "../src/applicationComposition";
import { executorApplicationObjectConfiguration, readExecutorApplicationProfiles, type ExecutorApplicationEnv } from "../src/applicationConfiguration";
import { makeApplicationDurableObject } from "../src/applicationDO";
import { admitExecutorRequest } from "../src/requestLifecycle";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

interface NativeProductEnv extends ExecutorApplicationEnv {
  readonly ADMIN_PRODUCT_CREDENTIAL: string;
}
interface Env extends NativeProductEnv {
  readonly APPLICATIONS: DurableObjectNamespace<NativeAdminProductApplicationFixture>;
}

// Only deterministic native definition production occurs here. Provisioning and
// all initialization receipts are complete before this Worker starts.
const fixtureConfiguration = Schema.decodeUnknownSync(Schema.Struct({ FLAREX_APPLICATION_PROFILES: Schema.String,
  ADMIN_PRODUCT_STORE_CATALOG: Schema.optionalKey(Schema.Literal("true")) }))(workerEnv);
const fixtureProfile = Result.getOrThrow(readExecutorApplicationProfiles(fixtureConfiguration))[0];
if (fixtureProfile === undefined) throw new Error("Missing private native Product fixture identity");
// The Store handoff proof opens one already-initialized superset catalog. Its
// Admin operations retain their original sources and mutation capabilities;
// only the exact installed bundle proof changes for that explicit fixture.
const storeCatalog = fixtureConfiguration.ADMIN_PRODUCT_STORE_CATALOG === "true"
  ? (await Effect.runPromise(compileStoreProductRequestFixtureCatalog(fixtureProfile))).catalog : undefined;
const catalog = storeCatalog === undefined ? await Effect.runPromise(compileProductRequestCatalog(fixtureProfile))
  : { ...storeCatalog.product, bundle: storeCatalog.bundle };
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
    const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 41, maximumPreparedBytes: 8 * 1024 * 1024 });
    const operations = yield* makeProductRequestOperations({ database: infrastructure.coreDatabase, hostRuntime, catalog,
      identityAndAccessPolicy: { profile: "native-admin-product-private-do-fixture" }, revision: "d".repeat(64),
      subscribers: [{ id: "native-admin-product-request", revision: "e".repeat(64) }] });
    const container = createContainer().register({
      logger: asValue({ error(error: unknown) {
        console.error("Native Product HTTP fixture failed", error instanceof Error && Cause.isCause(error.cause) ? Cause.pretty(error.cause) : error);
      }, info() {} }), configModule: asValue({ projectConfig: { http: {} } }),
    });
    const scopes = yield* makeProductRequestScopeFactory({ operations, container });
    const http = yield* makeAdminProductEffectHttpHandler({ adminCors: "https://admin.test", ...scopes,
      resolveAdminPrincipal: request => {
        const credential = request.headers.get("x-admin-fixture-token");
        const actor = credential === env.ADMIN_PRODUCT_CREDENTIAL ? "user_native_product"
          : credential === `${env.ADMIN_PRODUCT_CREDENTIAL}-without-policy` ? "user_native_product_unprivileged"
          : credential === `${env.ADMIN_PRODUCT_CREDENTIAL}-variant-reader` ? "user_native_variant_reader"
          : credential === `${env.ADMIN_PRODUCT_CREDENTIAL}-option-reader` ? "user_native_option_reader"
          : credential === `${env.ADMIN_PRODUCT_CREDENTIAL}-without-product-delete` ? "user_native_product_without_delete"
          : credential === `${env.ADMIN_PRODUCT_CREDENTIAL}-read-only` ? "user_native_product_reader" : undefined;
        return actor === undefined ? undefined : { actor_id: actor, actor_type: "user", auth_identity_id: "auth_native_product",
          app_metadata: {}, user_metadata: {} };
      },
      evaluateAdminPolicies: (principal, policies) => {
        // Pinned native middleware applies Product read to every child route;
        // Variant and Option child routes add their own exact policies afterward.
        const productRead = policies.length === 1 && policies[0]?.resource === "product" && policies[0]?.operation === "read";
        const variantRead = policies.length === 1 && policies[0]?.resource === "product_variant" && policies[0]?.operation === "read";
        const optionRead = policies.length === 1 && policies[0]?.resource === "product_option" && policies[0]?.operation === "read";
        if (principal.actor_id === "user_native_product_reader") return productRead;
        if (principal.actor_id === "user_native_variant_reader") return productRead || variantRead;
        if (principal.actor_id === "user_native_option_reader") return productRead || optionRead;
        if (principal.actor_id === "user_native_product_without_delete") return policies.every(policy => policy.resource === "product"
          && (Array.isArray(policy.operation) ? policy.operation : [policy.operation]).every(operation => ["read", "create", "update"].includes(operation)));
        return principal.actor_id === "user_native_product" && (productRead
          || (policies.length === 1 && policies.every(policy => typeof policy.resource === "string"
            && ["product_type", "product_tag", "product_category", "product_collection"].includes(policy.resource)
            && typeof policy.operation === "string" && ["read", "create", "update", "delete"].includes(policy.operation)))
          || (policies.length === 1 && policies[0]?.resource === "product" && policies[0]?.operation === "delete")
          || (policies.length === 1 && policies[0]?.resource === "product_variant" && policies[0]?.operation === "create")
          || (policies.length === 1 && policies[0]?.resource === "product_variant" && policies[0]?.operation === "delete")
          || (policies.length === 1 && policies[0]?.resource === "product" && Array.isArray(policies[0]?.operation)
            && (policies[0].operation.length === 2 || policies[0].operation.length === 3)
            && policies[0].operation.every((operation, index) => operation === ["create", "update", "delete"][index]))
          || (policies.length === 1 && policies[0]?.resource === "product_variant" && Array.isArray(policies[0]?.operation)
            && policies[0].operation.length === 3 && policies[0].operation.every((operation, index) => operation === ["create", "update", "delete"][index]))
          || (policies.length === 1 && typeof policies[0]?.resource === "string" && ["sales_channel", "price_list"].includes(policies[0].resource)
            && typeof policies[0]?.operation === "string" && ["read", "update"].includes(policies[0].operation))
          || variantRead
          || optionRead
          || (policies.length === 1 && policies[0]?.resource === "inventory_item"
            && (typeof policies[0]?.operation === "string" ? ["read", "create", "update", "delete"].includes(policies[0].operation)
              : Array.isArray(policies[0]?.operation) && policies[0].operation.length === 3
                && policies[0].operation.every((operation, index) => operation === ["create", "update", "delete"][index])))
          || (policies.length === 1 && policies[0]?.resource === "product_option" && policies[0]?.operation === "delete")
          || (policies.length === 3 && policies.every((policy, index) => policy.resource === ["product", "inventory_item", "price"][index]
            && policy.operation === "create")));
      },
      admitProductRefetchFields: operations.admitProductRefetchFields,
      admitVariantRefetchFields: operations.admitVariantRefetchFields,
      admitSalesChannelRefetchFields: operations.admitSalesChannelRefetchFields,
      admitPriceListRefetchFields: operations.admitPriceListRefetchFields,
      admitCatalogRefetchFields: operations.admitCatalogRefetchFields });
    const dispatch = Effect.fn("NativeAdminProductApplicationFixture.dispatch")((request: Request) => {
      // Reached only through the real private owner admission and completed
      // bootstrap. This test barrier exposes no database capability or data.
      if (new URL(request.url).pathname === "/__proof/ready") return Effect.succeed(Response.json({ ready: true }));
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
  readonly #incarnation = crypto.randomUUID();

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/__proof/close" || path === "/__proof/incarnation") {
      const admitted = admitExecutorRequest(request, this.env);
      if (Result.isFailure(admitted)) return admitted.failure;
      if (path === "/__proof/incarnation") return Response.json({ incarnation: this.#incarnation });
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
