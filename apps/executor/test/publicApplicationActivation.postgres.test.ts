import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { createApplicationNativeMutationSourceBundle } from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { APPLICATION_ANALYSIS_ANALYZER_IDENTITY, APPLICATION_ANALYSIS_POLICY_IDENTITY } from
  "@flarex/source-analyzer-v2/internal/application-analysis-host";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION, SOURCE_ARTIFACT_V2_ROLE_FUNCTION } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { Effect, Result, Schema } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { decodeFinishPushResponseEffect, decodePushStatusEffect, PushSourcePackage } from "flarex-protocol/deployment";
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
  sourcePackageHash: Schema.String, sourceArtifactRootSha256: Schema.String, sourcePackage: PushSourcePackage,
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
      expect(competing.status, await competing.clone().text()).toBe(200);
      const competingCandidate = await Effect.runPromise(decodePushStatusEffect(await competing.json()));
      expect(competingCandidate.pushId).not.toBe(candidate.pushId);
      const competingAbandon = await publicRequest(active(), `${base}/push/${encodeURIComponent(competingCandidate.pushId)}/abandon`, {});
      expect(competingAbandon.status, await competingAbandon.clone().text()).toBe(200);
      expect((await Effect.runPromise(decodePushStatusEffect(await competingAbandon.json()))).state).toBe("abandoned");
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
      const next = await publicRequest(active(), `${base}/push/start`, { sourcePackage: competingPackage });
      expect(next.status, await next.clone().text()).toBe(200);
      const nextCandidate = await Effect.runPromise(decodePushStatusEffect(await next.json()));
      expect(nextCandidate.pushId).not.toBe(competingCandidate.pushId);
      expect(nextCandidate.state).toBe("analyzed");
      expect(Schema.decodeUnknownSync(Active)(await (await publicRequest(active(), `${base}/deployment`)).json()).activePushId)
        .toBe(candidate.pushId);
      expect((await publicRequest(active(), `${base}/push/${encodeURIComponent(nextCandidate.pushId)}/abandon`, {})).ok).toBe(true);
    } catch (cause) { failed = true; bodyFailure = cause; }
    const cleanup = await Promise.allSettled([closeRuntime()]);
    const database = await Promise.allSettled([physical.close()]);
    // This exact mkdtemp-owned directory contains only this proof's local state.
    const temporary = await Promise.allSettled([rm(directory, { recursive: true, force: true })]);
    const failures = [...cleanup, ...database, ...temporary].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failed) { if (failures.length > 0) throw new AggregateError([bodyFailure, ...failures], "Public activation proof and cleanup failed."); throw bodyFailure; }
    if (failures.length > 0) throw new AggregateError(failures, "Public activation proof cleanup failed.");
  }, 300_000);

  it("upgrades populated normal SDK source, preserves old service and recovers original outcomes across complete closure changes", async () => {
    if (endpoints === undefined) throw new Error("SDK public activation requires ordinary PostgreSQL.");
    const directory = await mkdtemp(join(tmpdir(), "flarex-public-sdk-host-"));
    const project = join(directory, "project");
    const app = join(project, "flarex");
    const generated = join(app, "_generated");
    await mkdir(join(app, "functions"), { recursive: true });
    await mkdir(generated);
    await writeFile(join(project, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(join(generated, "worker.ts"), "throw new Error('stale legacy runtime');\n");
    await writeSdkApplication(app, { version: "A", marker: "A", archives: true });
    const jwt = await createRsaSigningKeys("normal-sdk-public-jwt");
    const rotatedJwt = await createRsaSigningKeys("normal-sdk-public-rotated-jwt");
    const writeAuth = (jwk: typeof jwt.jwk) => writeFile(join(app, "auth.config.ts"), `export default ${JSON.stringify({ providers: [{ type: "customJwt",
      issuer: "https://sdk-public.example", jwks: dataJsonUrl({ keys: [jwk] }), algorithm: "RS256", applicationID: "sdk-public" }] })};\n`);
    await writeAuth(jwt.jwk);
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
    const active = () => { if (runtime === undefined) throw new Error("SDK public activation host is closed."); return runtime; };
    const startRuntime = () => { runtime = makeRuntime(worker, join(directory, "runtime"), profile, secrets); };
    const closeRuntime = async () => {
      const running = runtime;
      if (running === undefined) return;
      runtime = undefined;
      const closed = await Promise.allSettled([proofRequest(running, "/__proof/close").then(async response => {
        if (!response.ok) throw new Error(await response.text());
      })]);
      const disposed = await Promise.allSettled([running.dispose()]);
      const failures = [...closed, ...disposed].flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, "SDK public activation host cleanup failed.");
    };
    let failed = false;
    let failure: unknown;
    try {
      startRuntime();
      const paths: string[] = [];
      const transport: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        paths.push(new URL(request.url).pathname);
        const response = await active().dispatchFetch(request.url, { method: request.method,
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
      const invoke = async (path: string, args: unknown, token = bearer, extra: Record<string, unknown> = {}) => {
        const response = await publicRequest(active(), url, { path, args, ...extra }, token);
        expect(response.status, await response.clone().text()).toBe(200);
        return Schema.decodeUnknownSync(Value)(await response.json()).value;
      };
      const activeDeployment = async () => {
        const response = await publicRequest(active(), `/deployments/${profile.deploymentId}/deployment`);
        expect(response.status, await response.clone().text()).toBe(200);
        return Schema.decodeUnknownSync(Active)(await response.json());
      };
      const pushStatus = async (pushId: string) => {
        const response = await publicRequest(active(), `/deployments/${profile.deploymentId}/push/${encodeURIComponent(pushId)}`, undefined, deployToken);
        expect(response.status, await response.clone().text()).toBe(200);
        return await Effect.runPromise(decodePushStatusEffect(await response.json()));
      };
      const name = "SDK → Core မင်္ဂလာ🌳";
      const create = { path: "users:create", args: { name }, idempotencyKey: "sdk:create:removed:lost-ack" };
      const lostCreate = await publicRequest(active(), url, create, bearer, { "x-proof-drop-response": "1" });
      expect(lostCreate.status, await lostCreate.clone().text()).toBe(502);
      const id = Schema.decodeUnknownSync(Schema.String)(await invoke(create.path, create.args, bearer, create));
      const changed = { path: "users:changed", kind: "mutation", args: { name: "changed A" }, idempotencyKey: "sdk:changed:lost-ack" };
      const lostChanged = await publicRequest(active(), url, changed, bearer, { "x-proof-drop-response": "1" });
      expect(lostChanged.status, await lostChanged.clone().text()).toBe(502);
      const changedIds = Schema.decodeUnknownSync(Schema.Array(Schema.String))(await invoke("users:byName", { name: "changed A" }));
      expect(changedIds).toHaveLength(1);
      const archiveId = Schema.decodeUnknownSync(Schema.String)(await invoke("users:archive", { label: "retain omitted table" }, bearer,
        { idempotencyKey: "sdk:archive" }));
      expect(await invoke("users:read", { id })).toBe(name);
      expect(await invoke("users:byName", { name })).toEqual([id]);
      expect(await invoke("users:current", {})).toBe("A");
      expect(await invoke("users:current", {}, bearer, { idempotencyKey: "sdk:keyed:query" })).toBe("A");
      expect(await invoke("users:nowInternal", {})).toBe("public-A");
      expect(await invoke("users:callInternal", {})).toBe("removed-internal-A");
      const identity = await publicRequest(active(), url, { path: "users:identity", args: {} }, bearer);
      expect(identity.status, await identity.clone().text()).toBe(200);
      expect(Schema.decodeUnknownSync(Schema.Struct({ value: Schema.Struct({ subject: Schema.String }) }))(await identity.json()).value.subject)
        .toBe("normal-sdk-user");
      const exact = await publicRequest(active(), url, { path: "users:exact", args: {} }, bearer);
      expect(exact.status, await exact.clone().text()).toBe(200);
      expect(Result.getOrThrow(coreApplicationValueFromJson(Schema.decodeUnknownSync(Value)(await exact.json()).value)))
        .toEqual({ integer: 9223372036854775807n, zero: -0, nan: NaN, infinity: Infinity, bytes: new Uint8Array([0, 128, 255]).buffer });
      const repeated = await deployFlarex({ root: project, pushCoordinator: coordinator });
      expect(repeated.started.state).toBe("activated");
      expect(repeated.finished.pushId).toBe(deployed.finished.pushId);
      await expect(readFile(join(generated, "worker.ts"))).rejects.toMatchObject({ code: "ENOENT" });

      const assertA = async () => {
        expect((await activeDeployment()).activePushId).toBe(deployed.finished.pushId);
        expect(await invoke("users:current", {})).toBe("A");
        expect(await invoke("users:read", { id })).toBe(name);
        expect(await invoke("users:byName", { name })).toEqual([id]);
      };
      await writeSdkApplication(app, { version: "A", marker: "abandoned", archives: true });
      const stopBeforeFinish = new Error("SDK validation stopped this candidate before finish");
      let abandonedId: string | undefined;
      await expect(deployFlarex({ root: project, pushCoordinator: coordinator, beforeFinish: async started => {
        abandonedId = started.pushId;
        expect(started.pushId).not.toBe(deployed.finished.pushId);
        await assertA();
        throw stopBeforeFinish;
      } })).rejects.toBe(stopBeforeFinish);
      if (abandonedId === undefined) throw new Error("Normal SDK abandon did not prepare a candidate.");
      expect((await pushStatus(abandonedId)).state).toBe("abandoned");
      await assertA();

      await writeSdkApplication(app, { version: "A", marker: "invalid", archives: true, invalidName: true });
      let failedId: string | undefined;
      await expect(deployFlarex({ root: project, pushCoordinator: coordinator, beforeFinish: async started => {
        failedId = started.pushId;
        await assertA();
      } })).rejects.toThrow();
      if (failedId === undefined) throw new Error("Incompatible SDK schema did not prepare a candidate.");
      expect((await pushStatus(failedId)).state).toBe("failed");
      await assertA();

      await writeSdkApplication(app, { version: "B", marker: "B", archives: false });
      await writeAuth(rotatedJwt.jwk);
      const upgraded = await deployFlarex({ root: project, pushCoordinator: coordinator, beforeFinish: async started => {
        expect(started.pushId).not.toBe(deployed.finished.pushId);
        expect(started.analysis.schema.indexes.some(index => index.name === "by_name_tag")).toBe(true);
        expect(started.analysis.schema.indexes.some(index => index.name === "by_name")).toBe(false);
        const functions = started.codegenAnalysis.functions.flatMap(module => module.functions);
        expect(functions.some(fn => fn.exportName === "create")).toBe(false);
        expect(functions.find(fn => fn.exportName === "nowInternal")?.visibility).toBe("internal");
        expect(functions.find(fn => fn.exportName === "nowPublic")?.visibility).toBe("public");
        expect(functions.find(fn => fn.exportName === "changed")?.kind).toBe("query");
        expect(await readFile(join(generated, "api.ts"), "utf8")).toContain("../functions/users");
        expect(await readFile(join(generated, "dataModel.ts"), "utf8")).toContain('import schema from "../schema"');
        await expect(readFile(join(generated, "functionMetadata.ts"))).rejects.toMatchObject({ code: "ENOENT" });
        await assertA();
        expect((await publicRequest(active(), url, { path: "users:nowPublic", args: {} }, bearer)).ok).toBe(false);
        const finishPath = `/deployments/${profile.deploymentId}/push/${encodeURIComponent(started.pushId)}/finish`;
        const lostFinish = await publicRequest(active(), finishPath, {}, deployToken, { "x-proof-drop-response": "1" });
        expect(lostFinish.status, await lostFinish.clone().text()).toBe(502);
        await closeRuntime();
        startRuntime();
      } });
      expect(upgraded.finished.state).toBe("activated");
      expect((await activeDeployment()).activePushId).toBe(upgraded.finished.pushId);
      const rotatedBearer = await signJwt({ privateKey: rotatedJwt.privateKey, kid: rotatedJwt.jwk.kid, payload: {
        iss: "https://sdk-public.example", sub: "normal-sdk-user", aud: "sdk-public", exp: Math.floor(Date.now() / 1000) + 600,
      } });
      expect((await publicRequest(active(), url, { path: "users:current", args: {} }, bearer)).status).toBe(401);
      expect(await invoke("users:current", {}, rotatedBearer)).toBe("B");
      expect(await invoke("users:current", {}, rotatedBearer, { idempotencyKey: "sdk:keyed:query" })).toBe("B");
      expect(await invoke("users:read", { id }, rotatedBearer)).toBe(name);
      expect(await invoke("users:byName", { name }, rotatedBearer)).toEqual([id]);
      expect(await invoke("users:nowPublic", {}, rotatedBearer)).toBe("public-B");
      expect(await invoke("users:callInternal", {}, rotatedBearer)).toBe("new-internal-B");
      expect(await invoke("users:changed", { name: 7 }, rotatedBearer)).toBe("B:7");
      for (const path of ["users:create", "users:removedInternal", "users:nowInternal", "users:newInternal", "users:readArchive"]) {
        expect((await publicRequest(active(), url, { path, args: path === "users:create" ? { name } : {},
          ...(path === "users:create" ? { kind: "mutation", idempotencyKey: "sdk:removed:fresh" } : {}) }, rotatedBearer)).ok).toBe(false);
      }
      expect((await publicRequest(active(), url, { path: "users:changed", args: changed.args }, rotatedBearer)).ok).toBe(false);
      expect(await invoke(create.path, create.args, rotatedBearer, create)).toBe(id);
      const changedId = Schema.decodeUnknownSync(Schema.String)(await invoke(changed.path, changed.args, rotatedBearer, changed));
      expect(changedId).toBe(changedIds[0]);
      expect(await invoke("users:read", { id: changedId }, rotatedBearer)).toBe("changed A");
      expect(await invoke("users:byName", { name: "changed A" }, rotatedBearer)).toEqual(changedIds);
      const wrongIdentity = await signJwt({ privateKey: rotatedJwt.privateKey, kid: rotatedJwt.jwk.kid, payload: {
        iss: "https://sdk-public.example", sub: "another-sdk-user", aud: "sdk-public", exp: Math.floor(Date.now() / 1000) + 600,
      } });
      for (const request of [{ ...create, args: { name: "changed correlation" } }, { ...changed, args: { name: "changed correlation" } }]) {
        expect((await publicRequest(active(), url, request, rotatedBearer)).ok).toBe(false);
      }
      expect((await publicRequest(active(), url, create, wrongIdentity)).ok).toBe(false);
      const newId = Schema.decodeUnknownSync(Schema.String)(await invoke("users:add", { name: "new B", tag: "upgraded" }, rotatedBearer,
        { idempotencyKey: "sdk:new:B" }));
      expect(await invoke("users:byTag", { tag: "upgraded" }, rotatedBearer)).toEqual([newId]);
      const oldFinish = await coordinator.finish(deployed.finished.pushId);
      expect(oldFinish.result).toBe("activated");
      expect((await activeDeployment()).activePushId).toBe(upgraded.finished.pushId);
      expect(await invoke("users:current", {}, rotatedBearer)).toBe("B");

      await writeSdkApplication(app, { version: "B", marker: "older-start", archives: false });
      let newerId: string | undefined;
      let sharedAbandonedId: string | undefined;
      const older = await deployFlarex({ root: project, pushCoordinator: coordinator, beforeFinish: async olderStarted => {
        await writeSdkApplication(app, { version: "B", marker: "newer-start", archives: false });
        const newer = await deployFlarex({ root: project, pushCoordinator: coordinator, beforeFinish: async newerStarted => {
          expect(newerStarted.pushId).not.toBe(olderStarted.pushId);
          expect(await invoke("users:current", {}, rotatedBearer)).toBe("B");
          await writeSdkApplication(app, { version: "B", marker: "shared-abandoned", archives: false });
          await expect(deployFlarex({ root: project, pushCoordinator: coordinator, beforeFinish: async shared => {
            sharedAbandonedId = shared.pushId;
            expect(shared.pushId).not.toBe(olderStarted.pushId);
            expect(shared.pushId).not.toBe(newerStarted.pushId);
            throw stopBeforeFinish;
          } })).rejects.toBe(stopBeforeFinish);
          expect((await pushStatus(olderStarted.pushId)).state).toBe("analyzed");
          expect((await pushStatus(newerStarted.pushId)).state).toBe("analyzed");
        } });
        newerId = newer.finished.pushId;
        expect((await activeDeployment()).activePushId).toBe(newerId);
        expect(await invoke("users:current", {}, rotatedBearer)).toBe("newer-start");
      } });
      if (newerId === undefined || sharedAbandonedId === undefined) throw new Error("Same-schema SDK attempt proof did not finish.");
      expect((await pushStatus(sharedAbandonedId)).state).toBe("abandoned");
      expect((await activeDeployment()).activePushId).toBe(older.finished.pushId);
      expect(await invoke("users:current", {}, rotatedBearer)).toBe("older-start");
      expect((await coordinator.finish(newerId)).result).toBe("activated");
      await closeRuntime();
      startRuntime();
      expect((await activeDeployment()).activePushId).toBe(older.finished.pushId);
      expect(await invoke("users:current", {}, rotatedBearer)).toBe("older-start");
      expect(await invoke(create.path, create.args, rotatedBearer, create)).toBe(id);
      expect(await invoke(changed.path, changed.args, rotatedBearer, changed)).toBe(changedId);

      await writeSdkApplication(app, { version: "B", marker: "reintroduced", archives: true });
      const reintroduced = await deployFlarex({ root: project, pushCoordinator: coordinator });
      expect((await activeDeployment()).activePushId).toBe(reintroduced.finished.pushId);
      expect(await invoke("users:readArchive", { id: archiveId }, rotatedBearer)).toBe("retain omitted table");
      expect(await invoke("users:read", { id }, rotatedBearer)).toBe(name);
      expect(await invoke("users:byName", { name }, rotatedBearer)).toEqual([id]);
      expect(await invoke("users:byTag", { tag: "upgraded" }, rotatedBearer)).toEqual([newId]);

      const beforeAuthOnly = await activeDeployment();
      const { authConfig: previousAuthConfig, ...previousSource } = beforeAuthOnly.sourcePackage;
      const functionBytes = await readFile(join(app, "functions/users.ts"));
      const schemaBytes = await readFile(join(app, "schema.ts"));
      const authOnlyJwt = await createRsaSigningKeys("normal-sdk-public-auth-only-jwt");
      await writeAuth(authOnlyJwt.jwk);
      const authOnly = await deployFlarex({ root: project, pushCoordinator: coordinator, beforeFinish: async started => {
        expect(started.pushId).not.toBe(beforeAuthOnly.activePushId);
        const pending = await pushStatus(started.pushId);
        const { authConfig: pendingAuthConfig, ...pendingSource } = pending.sourcePackage;
        expect(pendingAuthConfig).not.toEqual(previousAuthConfig);
        expect(pendingSource).toEqual(previousSource);
        expect((await activeDeployment()).activePushId).toBe(beforeAuthOnly.activePushId);
        expect(await invoke("users:current", {}, rotatedBearer)).toBe("reintroduced");
      } });
      const afterAuthOnly = await activeDeployment();
      const { authConfig: currentAuthConfig, ...currentSource } = afterAuthOnly.sourcePackage;
      expect(afterAuthOnly.activePushId).toBe(authOnly.finished.pushId);
      expect(afterAuthOnly.sourcePackageHash).not.toBe(beforeAuthOnly.sourcePackageHash);
      expect(afterAuthOnly.sourceArtifactRootSha256).toBe(beforeAuthOnly.sourceArtifactRootSha256);
      expect(currentAuthConfig).not.toEqual(previousAuthConfig);
      expect(currentSource).toEqual(previousSource);
      expect(afterAuthOnly.analysis).toEqual(beforeAuthOnly.analysis);
      expect(await readFile(join(app, "functions/users.ts"))).toEqual(functionBytes);
      expect(await readFile(join(app, "schema.ts"))).toEqual(schemaBytes);
      expect((await publicRequest(active(), url, { path: "users:current", args: {} }, rotatedBearer)).status).toBe(401);
      const authOnlyBearer = await signJwt({ privateKey: authOnlyJwt.privateKey, kid: authOnlyJwt.jwk.kid, payload: {
        iss: "https://sdk-public.example", sub: "normal-sdk-user", aud: "sdk-public", exp: Math.floor(Date.now() / 1000) + 600,
      } });
      expect(await invoke("users:current", {}, authOnlyBearer)).toBe("reintroduced");
      expect(await invoke("users:read", { id }, authOnlyBearer)).toBe(name);
      expect(await invoke("users:readArchive", { id: archiveId }, authOnlyBearer)).toBe("retain omitted table");
      expect(await invoke("users:byTag", { tag: "upgraded" }, authOnlyBearer)).toEqual([newId]);
      expect(await invoke(create.path, create.args, authOnlyBearer, create)).toBe(id);
    } catch (cause) { failed = true; failure = cause; }
    const closed = await Promise.allSettled([closeRuntime()]);
    const database = await Promise.allSettled([physical.close()]);
    const temporary = await Promise.allSettled([rm(directory, { recursive: true, force: true })]);
    const failures = [...closed, ...database, ...temporary].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failed) { if (failures.length > 0) throw new AggregateError([failure, ...failures], "SDK public activation and cleanup failed."); throw failure; }
    if (failures.length > 0) throw new AggregateError(failures, "SDK public activation cleanup failed.");
  }, 300_000);
});

async function writeSdkApplication(app: string, options: {
  readonly version: "A" | "B";
  readonly marker: string;
  readonly archives: boolean;
  readonly invalidName?: boolean;
}) {
  const next = options.version === "B";
  const nameType = options.invalidName ? "number" : "string";
  await writeFile(join(app, "schema.ts"), [
    'import { defineGlobalTable, defineSchema } from "flarex/server";',
    'import { v } from "flarex/values";',
    `export default defineSchema({ users: defineGlobalTable({ name: v.${nameType}()${next ? ", tag: v.optional(v.string())" : ""} })`
      + (next ? '.index("by_name_tag", ["name", "tag"]).index("by_tag", ["tag"])' : '.index("by_name", ["name"])')
      + `${options.archives ? ', archives: defineGlobalTable({ label: v.string() })' : ""} });`,
  ].join("\n"));
  await writeFile(join(app, "functions/users.ts"), [
    'import { internalQuery, query, mutation } from "../_generated/server";',
    'import { v } from "flarex/values";',
    'import type { FunctionReference } from "flarex/server";',
    `const helper: FunctionReference<"query", "internal", {}, string> = { _path: "users:${next ? "newInternal" : "removedInternal"}" };`,
    `export const current = query({ args: {}, returns: v.string(), handler: async () => ${JSON.stringify(options.marker)} });`,
    `export const read = query({ args: { id: v.id("users") }, returns: v.union(v.null(), v.${nameType}()), handler: async (ctx, args) => (await ctx.db.get(args.id))?.name ?? null });`,
    `export const byName = query({ args: { name: v.${nameType}() }, returns: v.array(v.id("users")), handler: async (ctx, args) => (await ctx.db.query("users").withIndex("${next ? "by_name_tag" : "by_name"}", q => q.eq("name", args.name)).collect()).map(doc => doc._id) });`,
    'export const callInternal = query({ args: {}, returns: v.string(), handler: async ctx => await ctx.runQuery(helper) });',
    'export const identity = query({ args: {}, returns: v.any(), handler: async ctx => await ctx.auth.getUserIdentity() });',
    'export const exact = query({ args: {}, returns: v.any(), handler: async () => ({ integer: 9223372036854775807n, zero: -0, nan: NaN, infinity: Infinity, bytes: new Uint8Array([0, 128, 255]).buffer }) });',
    ...(next ? [
      'export const add = mutation({ args: { name: v.string(), tag: v.string() }, returns: v.id("users"), handler: async (ctx, args) => await ctx.db.insert("users", args) });',
      'export const changed = query({ args: { name: v.number() }, returns: v.string(), handler: async (_ctx, args) => `B:${args.name}` });',
      'export const nowInternal = internalQuery({ args: {}, returns: v.string(), handler: async () => "internal-B" });',
      'export const nowPublic = query({ args: {}, returns: v.string(), handler: async () => "public-B" });',
      'export const newInternal = internalQuery({ args: {}, returns: v.string(), handler: async () => "new-internal-B" });',
      'export const byTag = query({ args: { tag: v.string() }, returns: v.array(v.id("users")), handler: async (ctx, args) => (await ctx.db.query("users").withIndex("by_tag", q => q.eq("tag", args.tag)).collect()).map(doc => doc._id) });',
    ] : [
      `export const create = mutation({ args: { name: v.${nameType}() }, returns: v.id("users"), handler: async (ctx, args) => await ctx.db.insert("users", { name: args.name }) });`,
      `export const changed = mutation({ args: { name: v.${nameType}() }, returns: v.id("users"), handler: async (ctx, args) => await ctx.db.insert("users", { name: args.name }) });`,
      'export const nowInternal = query({ args: {}, returns: v.string(), handler: async () => "public-A" });',
      'export const nowPublic = internalQuery({ args: {}, returns: v.string(), handler: async () => "internal-A" });',
      'export const removedInternal = internalQuery({ args: {}, returns: v.string(), handler: async () => "removed-internal-A" });',
    ]),
    ...(options.archives ? [
      'export const archive = mutation({ args: { label: v.string() }, returns: v.id("archives"), handler: async (ctx, args) => await ctx.db.insert("archives", args) });',
      'export const readArchive = query({ args: { id: v.id("archives") }, returns: v.union(v.null(), v.string()), handler: async (ctx, args) => (await ctx.db.get(args.id))?.label ?? null });',
    ] : []),
  ].join("\n"));
}

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
