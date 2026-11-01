import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { createApplicationNativeMutationSourceBundle } from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { APPLICATION_ANALYSIS_ANALYZER_IDENTITY, APPLICATION_ANALYSIS_POLICY_IDENTITY } from
  "@flarex/source-analyzer-v2/internal/application-analysis-host";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION, SOURCE_ARTIFACT_V2_ROLE_FUNCTION } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { Effect, Result, Schema } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { decodeFinishPushResponseEffect, decodePushStatusEffect, type PushSourcePackage } from "flarex-protocol/deployment";
import { coreApplicationValueFromJson } from "flarex-protocol/internal/core-application";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deployFlarex, HttpBackendPushCoordinator } from "flarex-dev";
import { createRsaSigningKeys, dataJsonUrl, signJwt } from "../../../packages/flarex-backend/test/authFixtures";
import { sourceModuleSha256ForTest } from "../../../packages/flarex-backend/test/sourcePackageHashFixture";
import { bundleApplicationWorker } from "./support/bundleApplicationWorker";
import { createExecutorApplicationSecretFixture, executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(endpointPath, "utf8")));
const privateToken = "public-activation-private-service-proof";
const deployToken = "public-activation-deploy-proof";
const Metrics = Schema.Struct({ sourceReads: Schema.Int, sourceWrites: Schema.Int });
const Value = Schema.Struct({ value: Schema.Unknown });
const Active = Schema.Struct({ storageProfile: Schema.Literal("core_application"), activePushId: Schema.String,
  sourcePackageHash: Schema.String, sourceArtifactRootSha256: Schema.String,
  analysis: Schema.Struct({ functions: Schema.Struct({ functions: Schema.Array(Schema.Struct({ path: Schema.String })) }) }),
});

describe.runIf(endpoints !== undefined)("public Core activation through actual backend and native bindings", () => {
  it("uploads genuine bytes, owns candidate disposition and activates authenticated execution across restart and lost acknowledgements", async () => {
    if (endpoints === undefined) throw new Error("Public activation proof requires ordinary PostgreSQL.");
    const keys = await createRsaSigningKeys("public-activation-jwt");
    const sourcePackage = await publicSourcePackage({ providers: [{ type: "customJwt", issuer: "https://public-activation.example",
      jwks: dataJsonUrl({ keys: [keys.jwk] }), algorithm: "RS256", applicationID: "public-application" }] });
    const artifact = await executionArtifactRefForSourcePackage({
      modules: sourcePackage.modules.map(module => ({ path: module.path, environment: module.environment, sha256: module.sha256,
        ...(module.source === undefined ? {} : { source: module.source }),
        ...(module.sourceMap === undefined ? {} : { sourceMap: module.sourceMap }) })),
      functions: [...sourcePackage.functions], execution: sourcePackage.execution,
      ...(sourcePackage.sourceModuleDigestFormat === undefined ? {} : { sourceModuleDigestFormat: sourcePackage.sourceModuleDigestFormat }),
      ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
      ...(sourcePackage.authConfig === undefined ? {} : { authConfig: sourcePackage.authConfig }),
      ...(sourcePackage.authConfigModule === undefined ? {} : { authConfigModule: sourcePackage.authConfigModule }),
    });
    const worker = await bundleApplicationWorker(new URL("./publicApplicationActivation.workerd.worker.ts", import.meta.url));
    const fixture = executorApplicationProfileFixture();
    const secrets = await createExecutorApplicationSecretFixture(fixture.keyId);
    const directory = await mkdtemp(join(tmpdir(), "flarex-public-activation-host-"));
    const physical = await createCorePostgresFixture(endpoints);
    const profile = { ...fixture, persistenceNamespace: physical.namespace, instanceName: physical.instanceName,
      http: { ...fixture.http, maximumRegistrationRequestBytes: 1_048_576 },
      workload: { ...fixture.workload, schemaScheduler: { ...fixture.workload.schemaScheduler,
        wakeDelayMilliseconds: 60_000, continuationDelayMilliseconds: 60_000 } },
      analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY, analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY };
    const base = `/deployments/${profile.deploymentId}`;
    let runtime: Miniflare | undefined;
    const active = () => { if (runtime === undefined) throw new Error("Public activation host is closed."); return runtime; };
    const startRuntime = () => { runtime = makeRuntime(worker, directory, profile, secrets); };
    const closeRuntime = async () => {
      const closing = runtime;
      if (closing === undefined) return;
      runtime = undefined;
      const closed = await Promise.allSettled([proofRequest(closing, "/__proof/close").then(async response => {
        if (!response.ok) throw new Error(await response.text());
      })]);
      const disposed = await Promise.allSettled([closing.dispose()]);
      const failures = [...closed, ...disposed].flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, "Public activation host cleanup failed.");
    };
    let failed = false;
    let bodyFailure: unknown;
    try {
      startRuntime();
      const unauthorized = await publicRequest(active(), `${base}/push/start`, { sourcePackage }, "wrong-deploy-token");
      expect(unauthorized.status).toBe(401);
      expect(Schema.decodeUnknownSync(Metrics)(await (await proofRequest(active(), "/__proof/resources")).json()))
        .toEqual({ sourceReads: 0, sourceWrites: 0 });

      const before = await publicRequest(active(), `${base}/deployment`);
      expect(before.ok).toBe(false);
      const started = await publicRequest(active(), `${base}/push/start`, { sourcePackage });
      expect(started.status, await started.clone().text()).toBe(200);
      const staged = await Effect.runPromise(decodePushStatusEffect(await started.json()));
      expect(staged.state).toBe("analyzed");
      expect(staged.codegenAnalysis?.functions.some(module => module.moduleName === "users"
        && module.functions.some(fn => fn.exportName === "create"))).toBe(true);
      expect((await publicRequest(active(), `${base}/deployment`)).ok).toBe(false);
      const stagedAgain = await publicRequest(active(), `${base}/push/start`, { sourcePackage });
      expect(stagedAgain.status, await stagedAgain.clone().text()).toBe(200);
      expect((await Effect.runPromise(decodePushStatusEffect(await stagedAgain.json()))).pushId).toBe(staged.pushId);

      const abandoned = await publicRequest(active(), `${base}/push/${encodeURIComponent(staged.pushId)}/abandon`, { reason: "retry fresh candidate" });
      expect(abandoned.status, await abandoned.clone().text()).toBe(200);
      expect((await Effect.runPromise(decodePushStatusEffect(await abandoned.json()))).state).toBe("abandoned");
      expect((await publicRequest(active(), `${base}/push/${encodeURIComponent(staged.pushId)}/finish`, {})).ok).toBe(false);
      await closeRuntime();
      startRuntime();

      const restarted = await publicRequest(active(), `${base}/push/start`, { sourcePackage });
      expect(restarted.status, await restarted.clone().text()).toBe(200);
      const candidate = await Effect.runPromise(decodePushStatusEffect(await restarted.json()));
      expect(candidate.pushId).not.toBe(staged.pushId);
      const competingPackage = { ...sourcePackage, modules: sourcePackage.modules.map((module, index) => index === 0 && module.source !== undefined
        ? { ...module, source: `${module.source}\n// competing fresh source`, sha256: sourceModuleSha256ForTest(`${module.source}\n// competing fresh source`, module.sourceMap) }
        : module) };
      const competing = await publicRequest(active(), `${base}/push/start`, { sourcePackage: competingPackage });
      expect(competing.ok).toBe(false);
      const finish = `${base}/push/${encodeURIComponent(candidate.pushId)}/finish`;
      const lostFinish = await publicRequest(active(), finish, {}, deployToken, { "x-proof-drop-response": "1" });
      expect(lostFinish.status, await lostFinish.clone().text()).toBe(502);
      await closeRuntime();
      startRuntime();
      const finishedResponse = await publicRequest(active(), finish, {});
      expect(finishedResponse.status, await finishedResponse.clone().text()).toBe(200);
      const finished = await Effect.runPromise(decodeFinishPushResponseEffect(await finishedResponse.json()));
      expect(finished.result).toBe("activated");
      const deployedResponse = await publicRequest(active(), `${base}/deployment`);
      expect(deployedResponse.status, await deployedResponse.clone().text()).toBe(200);
      const deployed = Schema.decodeUnknownSync(Active)(await deployedResponse.json());
      expect(deployed.activePushId).toBe(candidate.pushId);
      expect(deployed.sourcePackageHash).toBe(artifact.sourcePackageHash);
      expect(deployed.sourceArtifactRootSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(deployed.analysis.functions.functions.some(fn => fn.path === "users:queryIdentity")).toBe(true);
      expect(Schema.decodeUnknownSync(Metrics)(await (await proofRequest(active(), "/__proof/resources")).json()).sourceReads).toBe(0);

      const bearer = await signJwt({ privateKey: keys.privateKey, kid: keys.jwk.kid, payload: {
        iss: "https://public-activation.example", sub: "real-public-user", aud: "public-application",
        exp: Math.floor(Date.now() / 1000) + 600, email: "public@example.com",
      } });
      const identityResponse = await publicRequest(active(), `${base}/invoke`, { path: "users:queryIdentity", args: { nested: true } }, bearer);
      expect(identityResponse.status, await identityResponse.clone().text()).toBe(200);
      const identity = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.Struct({ parent: Schema.Struct({ subject: Schema.String }),
        child: Schema.Struct({ parent: Schema.Struct({ subject: Schema.String }), child: Schema.Null }) }) }))(await identityResponse.json());
      expect(identity.value.parent.subject).toBe("real-public-user");
      expect(identity.value.child.parent.subject).toBe("real-public-user");
      expect((await publicRequest(active(), `${base}/invoke`, { path: "users:create", args: { name: "unauthorized" } }, "invalid-jwt")).status).toBe(401);
      expect((await publicRequest(active(), `${base}/invoke`, { path: "users:createInternal", kind: "mutation", args: { name: "must not exist" } }, bearer)).ok).toBe(false);
      expect((await publicRequest(active(), `${base}/invoke`, { path: "users:typedQuery", args: { id: "invalid-id" } }, bearer)).ok).toBe(false);
      expect((await publicRequest(active(), `${base}/invoke`, { path: "users:get", kind: "mutation", args: {} }, bearer)).ok).toBe(false);

      const create = { path: "users:create", kind: "mutation", args: { name: "မင်္ဂလာ🌳" }, idempotencyKey: "public:create:lost-ack" };
      const lostMutation = await publicRequest(active(), `${base}/invoke`, create, bearer, { "x-proof-drop-response": "1" });
      expect(lostMutation.status, await lostMutation.clone().text()).toBe(502);
      await closeRuntime();
      startRuntime();
      const replayResponse = await publicRequest(active(), `${base}/invoke`, create, bearer);
      expect(replayResponse.status, await replayResponse.clone().text()).toBe(200);
      const id = Schema.decodeUnknownSync(Schema.String)(Schema.decodeUnknownSync(Value)(await replayResponse.json()).value);
      const same = await publicRequest(active(), `${base}/invoke`, create, bearer);
      expect(same.status, await same.clone().text()).toBe(200);
      expect(Schema.decodeUnknownSync(Value)(await same.json()).value).toBe(id);
      expect(Schema.decodeUnknownSync(Metrics)(await (await proofRequest(active(), "/__proof/resources")).json()).sourceReads).toBe(0);
      const read = await publicRequest(active(), `${base}/invoke`, { path: "users:typedQuery", args: { id } }, bearer);
      expect(read.status, await read.clone().text()).toBe(200);
      expect(Schema.decodeUnknownSync(Value)(await read.json()).value).toBe("မင်္ဂလာ🌳");
      expect(Schema.decodeUnknownSync(Metrics)(await (await proofRequest(active(), "/__proof/resources")).json()).sourceReads).toBeGreaterThan(0);
      const again = await publicRequest(active(), finish, {});
      expect(again.status, await again.clone().text()).toBe(200);
      expect((await publicRequest(active(), `${base}/push/${encodeURIComponent(candidate.pushId)}/abandon`, {})).ok).toBe(false);
      expect((await publicRequest(active(), `${base}/push/start`, { sourcePackage: competingPackage })).ok).toBe(false);
    } catch (cause) { failed = true; bodyFailure = cause; }
    const cleanup = await Promise.allSettled([closeRuntime()]);
    const database = await Promise.allSettled([physical.close()]);
    // This exact mkdtemp-owned directory contains only this proof's local state.
    const temporary = await Promise.allSettled([rm(directory, { recursive: true, force: true })]);
    const failures = [...cleanup, ...database, ...temporary].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failed) { if (failures.length > 0) throw new AggregateError([bodyFailure, ...failures], "Public activation proof and cleanup failed."); throw bodyFailure; }
    if (failures.length > 0) throw new AggregateError(failures, "Public activation proof cleanup failed.");
  }, 300_000);

  it("uses normal server-discovered SDK bundling and codegen before activating the same public Core", async () => {
    if (endpoints === undefined) throw new Error("SDK public activation requires ordinary PostgreSQL.");
    const directory = await mkdtemp(join(tmpdir(), "flarex-public-sdk-host-"));
    const project = join(directory, "project");
    const app = join(project, "flarex");
    const generated = join(app, "_generated");
    await mkdir(join(app, "functions"), { recursive: true });
    await mkdir(generated);
    await writeFile(join(project, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(join(generated, "worker.ts"), "throw new Error('stale legacy runtime');\n");
    await writeFile(join(app, "schema.ts"), [
      'import { defineGlobalTable, defineSchema } from "flarex/server";',
      'import { v } from "flarex/values";',
      'export default defineSchema({ users: defineGlobalTable({ name: v.string() }).index("by_name", ["name"]) });',
    ].join("\n"));
    await writeFile(join(app, "functions/users.ts"), [
      'import { query, mutation } from "../_generated/server";',
      'import { v } from "flarex/values";',
      'export const create = mutation({ args: { name: v.string() }, returns: v.id("users"), handler: async (ctx, args) => await ctx.db.insert("users", { name: args.name }) });',
      'export const read = query({ args: { id: v.id("users") }, returns: v.union(v.null(), v.string()), handler: async (ctx, args) => (await ctx.db.get(args.id))?.name ?? null });',
      'export const identity = query({ args: {}, returns: v.any(), handler: async ctx => await ctx.auth.getUserIdentity() });',
      'export const exact = query({ args: {}, returns: v.any(), handler: async () => ({ integer: 9223372036854775807n, zero: -0, nan: NaN, infinity: Infinity, bytes: new Uint8Array([0, 128, 255]).buffer }) });',
    ].join("\n"));
    const jwt = await createRsaSigningKeys("normal-sdk-public-jwt");
    await writeFile(join(app, "auth.config.ts"), `export default ${JSON.stringify({ providers: [{ type: "customJwt",
      issuer: "https://sdk-public.example", jwks: dataJsonUrl({ keys: [jwt.jwk] }), algorithm: "RS256", applicationID: "sdk-public" }] })};\n`);
    const worker = await bundleApplicationWorker(new URL("./publicApplicationActivation.workerd.worker.ts", import.meta.url));
    const base = executorApplicationProfileFixture();
    const secrets = await createExecutorApplicationSecretFixture(base.keyId);
    const physical = await createCorePostgresFixture(endpoints);
    const profile = { ...base, persistenceNamespace: physical.namespace, instanceName: physical.instanceName,
      http: { ...base.http, maximumRegistrationRequestBytes: 1_048_576 },
      analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY, analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
      workload: { ...base.workload, schemaScheduler: { ...base.workload.schemaScheduler,
        wakeDelayMilliseconds: 60_000, continuationDelayMilliseconds: 60_000 } } };
    let runtime: Miniflare | undefined;
    let failed = false;
    let failure: unknown;
    try {
      runtime = makeRuntime(worker, join(directory, "runtime"), profile, secrets);
      const running = runtime;
      const paths: string[] = [];
      const transport: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        paths.push(new URL(request.url).pathname);
        const response = await running.dispatchFetch(request.url, { method: request.method,
          headers: Object.fromEntries(request.headers), signal: request.signal,
          ...(request.body === null ? {} : { body: await request.arrayBuffer() }) });
        return new Response(await response.arrayBuffer(), { status: response.status,
          headers: Object.fromEntries(response.headers) });
      };
      const coordinator = new HttpBackendPushCoordinator({ url: "https://public-application.test", deploymentId: profile.deploymentId,
        headers: { authorization: `Bearer ${deployToken}` }, fetch: transport });
      const deployed = await deployFlarex({ root: project, pushCoordinator: coordinator, beforeFinish: async started => {
        expect(started.storageProfile).toBe("core_application");
        expect(started.codegenAnalysis.functions.some(module => module.moduleName === "users")).toBe(true);
        expect(await readFile(join(generated, "api.ts"), "utf8")).toContain("createApi");
        expect(await readFile(join(generated, "server.ts"), "utf8")).not.toContain("TABLE_SCOPES");
        await expect(readFile(join(generated, "worker.ts"))).rejects.toMatchObject({ code: "ENOENT" });
      } });
      expect(paths[0]).toBe(`/deployments/${profile.deploymentId}/profile`);
      expect(deployed.finished.state).toBe("activated");
      const bearer = await signJwt({ privateKey: jwt.privateKey, kid: jwt.jwk.kid, payload: { iss: "https://sdk-public.example",
        sub: "normal-sdk-user", aud: "sdk-public", exp: Math.floor(Date.now() / 1000) + 600 } });
      const url = `/deployments/${profile.deploymentId}/invoke`;
      const created = await publicRequest(running, url, { path: "users:create", args: { name: "SDK → Core" }, idempotencyKey: "sdk:create" }, bearer);
      expect(created.status, await created.clone().text()).toBe(200);
      const id = Schema.decodeUnknownSync(Schema.String)(Schema.decodeUnknownSync(Value)(await created.json()).value);
      const queried = await publicRequest(running, url, { path: "users:read", args: { id } }, bearer);
      expect(queried.status, await queried.clone().text()).toBe(200);
      expect(Schema.decodeUnknownSync(Value)(await queried.json()).value).toBe("SDK → Core");
      const identity = await publicRequest(running, url, { path: "users:identity", args: {} }, bearer);
      expect(identity.status, await identity.clone().text()).toBe(200);
      expect(Schema.decodeUnknownSync(Schema.Struct({ value: Schema.Struct({ subject: Schema.String }) }))(await identity.json()).value.subject)
        .toBe("normal-sdk-user");
      const exact = await publicRequest(running, url, { path: "users:exact", args: {} }, bearer);
      expect(exact.status, await exact.clone().text()).toBe(200);
      expect(Result.getOrThrow(coreApplicationValueFromJson(Schema.decodeUnknownSync(Value)(await exact.json()).value)))
        .toEqual({ integer: 9223372036854775807n, zero: -0, nan: NaN, infinity: Infinity, bytes: new Uint8Array([0, 128, 255]).buffer });
      const repeated = await deployFlarex({ root: project, pushCoordinator: coordinator });
      expect(repeated.started.state).toBe("activated");
      expect(repeated.finished.pushId).toBe(deployed.finished.pushId);
      await expect(readFile(join(generated, "worker.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    } catch (cause) { failed = true; failure = cause; }
    const running = runtime;
    const closed = await Promise.allSettled(running === undefined ? [] : [proofRequest(running, "/__proof/close").then(async response => {
      if (!response.ok) throw new Error(await response.text());
    })]);
    const disposed = await Promise.allSettled(running === undefined ? [] : [running.dispose()]);
    const database = await Promise.allSettled([physical.close()]);
    const temporary = await Promise.allSettled([rm(directory, { recursive: true, force: true })]);
    const failures = [...closed, ...disposed, ...database, ...temporary].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failed) { if (failures.length > 0) throw new AggregateError([failure, ...failures], "SDK public activation and cleanup failed."); throw failure; }
    if (failures.length > 0) throw new AggregateError(failures, "SDK public activation cleanup failed.");
  }, 300_000);
});

async function publicSourcePackage(authConfig: PushSourcePackage["authConfig"]): Promise<PushSourcePackage> {
  const source = await createApplicationNativeMutationSourceBundle(false, 0, 0, true, false, false, true, true);
  const modules = source.modules.map(module => {
    const text = (module.roles & SOURCE_ARTIFACT_V2_ROLE_EXECUTION) === 0 ? module.source
      : module.source.replace("  notify: action({ handler: users.notify }),\n", "");
    const sourceMap = (module.roles & SOURCE_ARTIFACT_V2_ROLE_FUNCTION) === 0 ? undefined
      : JSON.stringify({ version: 3, file: module.path, sources: ["public-users.ts"], names: [], mappings: "" });
    return { path: module.path, environment: "isolate" as const, source: text,
      sha256: sourceModuleSha256ForTest(text, sourceMap), ...(sourceMap === undefined ? {} : { sourceMap }) };
  });
  const dependency = "export const publicDependency = 'မြန်မာ';\n";
  modules.push({ path: "deps/ordinary.js", environment: "isolate", source: dependency,
    sha256: sourceModuleSha256ForTest(dependency) });
  return { modules, functions: source.modules.filter(module => (module.roles & SOURCE_ARTIFACT_V2_ROLE_FUNCTION) !== 0).map(module => module.path),
    execution: source.sourceArtifact.executionModulePath, sourceModuleDigestFormat: "sha256-framed-v1",
    ...(source.sourceArtifact.schemaModulePath === null ? {} : { schema: source.sourceArtifact.schemaModulePath }),
    ...(authConfig === undefined ? {} : { authConfig }),
  };
}
function publicRequest(runtime: Miniflare, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  return runtime.dispatchFetch(`https://public-application.test${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined && token === undefined ? {} : { authorization: `Bearer ${token ?? deployToken}` }),
      "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function proofRequest(runtime: Miniflare, path: string) {
  return runtime.dispatchFetch(`https://public-application.test${path}`, { headers: { authorization: `Bearer ${privateToken}` } });
}
function makeRuntime(worker: string, directory: string, profile: ReturnType<typeof executorApplicationProfileFixture>, keys: string) {
  if (endpoints === undefined) throw new Error("Missing public activation PostgreSQL endpoints.");
  return new Miniflare({ name: "public-application-proof", modules: [{ type: "ESModule", path: "worker.js", contents: worker }],
    compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
    bindings: { FLAREX_EXECUTOR_TOKEN: privateToken, FLAREX_ANALYZED_START_TOKEN: deployToken,
      FLAREX_EXECUTOR_TRANSPORT: "core_application", FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [profile] }),
      FLAREX_APPLICATION_KEYS: keys },
    hyperdrives: { HYPERDRIVE_CACHE_DISABLED: endpoints.connectionString }, workerLoaders: { LOADER: {} },
    serviceBindings: { FLAREX_EXECUTOR: "public-application-proof",
      APPLICATION_ANALYZER: { name: "public-application-proof", entrypoint: "FlarexApplicationAnalysisHost" } },
    r2Buckets: ["ARTIFACTS"], r2Persist: join(directory, "r2"), durableObjectsPersist: join(directory, "do"),
    durableObjects: { APPLICATIONS: { className: "PublicProofApplication", useSQLite: true },
      REGISTRY: { className: "RegistryDO", useSQLite: true }, DEPLOYMENTS: { className: "DeploymentDO", useSQLite: true },
      DEPLOYMENT_SYNCS: { className: "DeploymentSyncDO", useSQLite: true }, PARTITIONS: { className: "PartitionDO", useSQLite: true },
      EXECUTIONS: { className: "ExecutionDO", useSQLite: true }, CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
      DELIVERIES: { className: "DeliveryDO", useSQLite: true }, SCHEDULERS: { className: "SchedulerDO", useSQLite: true } },
  } satisfies MiniflareOptions);
}
