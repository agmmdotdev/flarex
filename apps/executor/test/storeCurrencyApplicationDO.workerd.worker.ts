import { Cause, Clock, Effect, Result } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { makeCoreSchemaBundle } from "@flarex/persistence-postgres/internal/core";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { makeStoreRequestReads } from "@flarex/medusa-adapter/internal/store-request-reads";
import { makeStoreRequestScopeFactory } from "@flarex/medusa-adapter/internal/store-request-scope";
import { compileStoreRequestReadFixtureCatalog } from "@flarex/medusa-adapter/internal/system-test/store-request-read-catalog";
import { makeStoreCurrencyEffectHttpHandler } from "@flarex/medusa-http/effect";
import { makeExecutorApplicationCredentials, executorApplicationSha256 } from "../src/applicationComposition";
import { executorApplicationObjectConfiguration, readExecutorApplicationProfiles, type ExecutorApplicationEnv } from "../src/applicationConfiguration";
import { makeApplicationDurableObject } from "../src/applicationDO";
import { admitExecutorRequest } from "../src/requestLifecycle";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

interface Env extends ExecutorApplicationEnv {
  readonly APPLICATIONS: DurableObjectNamespace<NativeStoreApplicationFixture>;
}

// Deterministic test definition production precedes app-owner construction.
// Serving a request never prepares/activates a schema or initializes data.
const { catalog } = await Effect.runPromise(compileStoreRequestReadFixtureCatalog());
const bundle = await Effect.runPromise(makeCoreSchemaBundle({ sources: Object.values(catalog)
  .map(source => ({ kind: "native" as const, definition: source.definition })) }));
const workload = executorApplicationProfileFixture().workload;
type NativeFixtureFailure = Effect.Error<ReturnType<typeof makeExecutorApplicationCredentials>>
  | Effect.Error<ReturnType<typeof makePreparedHostRuntime>> | Effect.Error<ReturnType<typeof makeStoreRequestReads>>;
const NativeOwner = makeApplicationDurableObject<ExecutorApplicationEnv, NativeFixtureFailure>({
  configuration: executorApplicationObjectConfiguration,
  workload: { ...workload, schemaScheduler: { ...workload.schemaScheduler,
    wakeDelayMilliseconds: 60_000, continuationDelayMilliseconds: 60_000 } },
  coreOptions: { schemaBundles: [bundle], now: Clock.currentTimeMillis.pipe(Effect.map(ms => BigInt(Math.floor(ms)) * 1_000_000n)),
    randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))) },
  application: Effect.fn("NativeStoreApplicationFixture.compose")(function* (env, infrastructure) {
    const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))[0];
    if (profile === undefined) return yield* Effect.die("Missing private native Store fixture identity");
    const credentials = yield* makeExecutorApplicationCredentials(env, profile);
    const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 3, maximumPreparedBytes: 2 * 1024 * 1024 });
    const reads = yield* makeStoreRequestReads({ database: infrastructure.coreDatabase, hostRuntime, catalog,
      identityAndAccessPolicy: { profile: "native-store-private-do-fixture" } });
    const container = createContainer().register({
      logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }),
    });
    const scopes = yield* makeStoreRequestScopeFactory({ reads, container });
    const http = yield* makeStoreCurrencyEffectHttpHandler({ storeCors: "https://store.test", ...scopes });
    const dispatch = Effect.fn("NativeStoreApplicationFixture.dispatch")((request: Request) => {
      // The existing application DO admits private bearer transport. This
      // fixture exercises anonymous customer reads and never forwards that token.
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
  dispatch: () => Effect.die("Native Store fixture composition is not prepared"),
  failureResponse: cause => {
    console.error("Native Store fixture refused", Cause.pretty(cause));
    return Response.json({ error: "native_store_unavailable" }, { status: 503 });
  },
});

/** Native-only private fixture: the real app DO and Core generation own all reads. */
export class NativeStoreApplicationFixture extends NativeOwner {
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
    if (profile === undefined) throw new Error("Missing private native Store fixture identity");
    return env.APPLICATIONS.getByName(profile.canonicalName).fetch(request);
  },
} satisfies ExportedHandler<Env>;
