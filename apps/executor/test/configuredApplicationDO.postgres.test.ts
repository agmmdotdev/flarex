import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { createApplicationNativeMutationSourceBundle } from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { APPLICATION_ANALYSIS_ANALYZER_IDENTITY, APPLICATION_ANALYSIS_POLICY_IDENTITY } from
  "@flarex/source-analyzer-v2/internal/application-analysis-host";
import { sourceModuleDigestInputV1, SOURCE_MODULE_DIGEST_FORMAT_V1 } from "flarex/artifacts";
import { SOURCE_ARTIFACT_V2_ROLE_FUNCTION } from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { Result, Schema } from "effect";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { coreApplicationInvocationPath, coreApplicationProfilePath, coreApplicationDeploymentPath, coreApplicationPushStartPath, coreApplicationPushPath,
  decodeCoreApplicationCandidate, decodeCoreApplicationInvocationSuccess, decodeCoreApplicationProfile,
  encodeCoreApplicationInvocationRequest, type CoreApplicationInvocationRequest } from "flarex-protocol/internal/core-application";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { coreQueryCheckpointPath, decodeCoreQueryCheckpointResponse, type CoreQueryCheckpointRequest } from "flarex-protocol/internal/core-query-checkpoint";
import { bundleApplicationWorker } from "./support/bundleApplicationWorker";
import { createExecutorApplicationSecretFixture, executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(endpointPath, "utf8")));
const token = "configured-app-owner-private-proof";
const checkpointProbeToken = "configured-sync-probe-private-proof";
type Profile = ReturnType<typeof executorApplicationProfileFixture>;
type InvocationProfile = Profile & Pick<CoreApplicationInvocationRequest, "sourceArtifactRootSha256" | "sourcePackageHash">;

describe.runIf(endpoints !== undefined)("configured production app owner in actual workerd", () => {
  it("prepares public source once, cold-finishes its Core candidate and preserves exact outcomes", async () => {
    if (endpoints === undefined) throw new Error("Configured owner proof requires ordinary PostgreSQL.");
    const source = await createApplicationNativeMutationSourceBundle(false, 0, 0, true, false, false, true, true);
    const modules = source.modules.map(module => ({ ...module,
      source: module.source.replace("  notify: action({ handler: users.notify }),\n", "") }));
    const sourcePackage = { modules: modules.map(module => ({ path: module.path, environment: "isolate" as const,
      source: module.source, sha256: createHash("sha256").update(sourceModuleDigestInputV1(module.source, undefined)).digest("hex") })),
      functions: modules.filter(module => (module.roles & SOURCE_ARTIFACT_V2_ROLE_FUNCTION) !== 0).map(module => module.path),
      execution: source.sourceArtifact.executionModulePath,
      ...(source.sourceArtifact.schemaModulePath === null ? {} : { schema: source.sourceArtifact.schemaModulePath }),
      sourceModuleDigestFormat: SOURCE_MODULE_DIGEST_FORMAT_V1 };
    const worker = await bundleApplicationWorker(new URL("./configuredApplicationDO.workerd.worker.ts", import.meta.url));
    const directory = await mkdtemp(join(tmpdir(), "flarex-configured-application-"));
    const physical = await createCorePostgresFixture(endpoints);
    const base = executorApplicationProfileFixture();
    const keys = await createExecutorApplicationSecretFixture(base.keyId);
    const profile = { ...base, persistenceNamespace: physical.namespace, instanceName: physical.instanceName,
      analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY, analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
      http: { ...base.http, maximumRegistrationRequestBytes: 1_048_576 },
      workload: { ...base.workload, schemaScheduler: { ...base.workload.schemaScheduler,
        wakeDelayMilliseconds: 60_000, continuationDelayMilliseconds: 60_000 } } };
    let runtime: Miniflare | undefined;
    const primaryFailures: unknown[] = [];
    const active = () => { if (runtime === undefined) throw new Error("Configured runtime is closed."); return runtime; };
    const stop = async () => {
      const closing = runtime;
      if (closing === undefined) return;
      runtime = undefined;
      const closed = await Promise.allSettled([request(closing, "/__proof/close", {}).then(async response => {
        if (!response.ok) throw new Error(await response.text());
      })]);
      const disposed = await Promise.allSettled([closing.dispose()]);
      const failures = [...closed, ...disposed].flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, "Configured owner resource cleanup failed.");
    };
    try {
      runtime = makeRuntime(worker, directory, { ...profile, maximumRegistrationSteps: 1 }, keys);
      const path = coreApplicationInvocationPath(profile.deploymentId);
      const checkpointPath = coreQueryCheckpointPath(profile.deploymentId);
      const checkpointRequest: CoreQueryCheckpointRequest = { format: "flarex.core-query-checkpoint.request", version: 1,
        route: { deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid },
        after: null, sourceId: null, maximumElapsedMilliseconds: 10_000 };
      const syncCheckpointRequest = { authorizationToken: checkpointProbeToken, route: checkpointRequest.route,
        budget: { sourceReads: 1, stateTransitions: 2, maximumElapsedMilliseconds: 10_000 }, authorizeFreshInitialization: true };
      const discovery = coreApplicationProfilePath(profile.deploymentId);
      const denied = await active().dispatchFetch(`https://configured-owner.test${path}`, { method: "POST", body: "{}" });
      expect(denied.status).toBe(401);
      expect((await active().dispatchFetch(`https://configured-owner.test${checkpointPath}`, { method: "POST", body: "{}" })).status).toBe(401);
      expect((await request(active(), "/__proof/wrong-object")).status).toBe(500);
      expect((await request(active(), discovery)).status).toBe(503);
      expect(await sourceReads(active())).toBe(0);
      const started = await request(active(), coreApplicationPushStartPath(profile.deploymentId), { sourcePackage });
      expect(started.status, await started.clone().text()).toBe(200);
      const candidate = Result.getOrThrow(decodeCoreApplicationCandidate(await started.json()));
      expect(candidate.state).not.toBe("active");
      expect(candidate.sourcePackage.modules.every(module => module.source === undefined && module.sourceMap === undefined)).toBe(true);
      const push = coreApplicationPushPath(profile.deploymentId, candidate.pushId);
      expect((await request(active(), discovery)).status).toBe(503);
      const partial = await request(active(), `${push}/finish`, {});
      expect(partial.status, await partial.clone().text()).toBe(503);
      await stop();

      runtime = makeRuntime(worker, directory, profile, keys);
      const finished = await request(active(), `${push}/finish`, {});
      expect(finished.status, await finished.clone().text()).toBe(200);
      expect(Result.getOrThrow(decodeCoreApplicationCandidate(await finished.json())).state).toBe("active");
      // Finish reconstructs persisted analysis; it does not read R2 or re-run analysis.
      expect(await sourceReads(active())).toBe(0);
      const discovered = await request(active(), discovery);
      expect(discovered.status, await discovered.clone().text()).toBe(200);
      expect(Result.getOrThrow(decodeCoreApplicationProfile(await discovered.json()))).toMatchObject({ kind: "core",
        sourceArtifactRootSha256: candidate.sourceArtifactRootSha256, sourcePackageHash: candidate.sourcePackageHash });
      const freshCheckpointResponse = await request(active(), checkpointPath, checkpointRequest);
      expect(freshCheckpointResponse.status, await freshCheckpointResponse.clone().text()).toBe(200);
      const freshCheckpoint = Result.getOrThrow(decodeCoreQueryCheckpointResponse(await freshCheckpointResponse.json()));
      expect(freshCheckpoint.kind).toBe("certified");
      const savedCheckpointRequest = { ...checkpointRequest, sourceId: freshCheckpoint.sourceId, after: freshCheckpoint.through };
      const syncCheckpointResponse = await request(active(), "/__proof/sync-checkpoint", syncCheckpointRequest);
      expect(syncCheckpointResponse.status, await syncCheckpointResponse.clone().text()).toBe(200);
      const syncCheckpoint = Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Literal(true),
        value: Schema.Struct({ kind: Schema.Literal("caughtUp"),
          checkpoint: Schema.Struct({ sourceId: Schema.String, position: Schema.String }) }) }))(await syncCheckpointResponse.json());
      expect(syncCheckpoint.value.checkpoint.sourceId).toBe(freshCheckpoint.sourceId);
      expect(syncCheckpoint.value.checkpoint.position).toBe(freshCheckpoint.through);
      const invocationProfile = { ...profile, sourceArtifactRootSha256: candidate.sourceArtifactRootSha256,
        sourcePackageHash: candidate.sourcePackageHash };
      expect((await request(active(), `/applications/${profile.deploymentId}/register`, {})).status).toBe(404);
      const oversized = await active().dispatchFetch(`https://configured-owner.test${path}`, { method: "POST",
        headers: { authorization: `Bearer ${token}` }, body: " ".repeat(profile.http.maximumRequestBytes + 1) });
      expect(oversized.status).toBe(413);
      const foreign = await invoke(active(), invocationProfile, "query", "users:get", { id: "wrong" }, "query:foreign", "ff".repeat(32));
      expect(foreign.status).toBe(503);
      const create = invocation(invocationProfile, "mutation", "users:create", { name: "configured" }, "create:lost-response");
      const lost = await request(active(), path, create, { "x-proof-drop-response": "1" });
      expect(lost.status).toBe(502);
      const trace = Schema.decodeUnknownSync(Schema.Struct({ committed: Schema.Unknown }))(await lost.json());
      const committed = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(trace.committed));
      if (committed.kind !== "mutation") throw new Error("Expected committed mutation trace.");
      expect(committed.disposition).toBe("published");
      expect(BigInt(syncCheckpoint.value.checkpoint.position)).toBeLessThan(committed.publishedTimestamp);
      const warmCheckpointResponse = await request(active(), checkpointPath, savedCheckpointRequest);
      expect(warmCheckpointResponse.status, await warmCheckpointResponse.clone().text()).toBe(200);
      const warmCheckpoint = Result.getOrThrow(decodeCoreQueryCheckpointResponse(await warmCheckpointResponse.json()));
      expect(warmCheckpoint.kind).toBe("certified");
      expect(warmCheckpoint.sourceId).toBe(freshCheckpoint.sourceId);
      expect(BigInt(warmCheckpoint.through)).toBeGreaterThanOrEqual(committed.publishedTimestamp);
      const id = Schema.decodeUnknownSync(Schema.String)(committed.value);
      await stop();

      runtime = makeRuntime(worker, directory, profile, keys);
      const replayResponse = await request(active(), path, create);
      const coldCheckpointResponse = await request(active(), checkpointPath, savedCheckpointRequest);
      expect(coldCheckpointResponse.status, await coldCheckpointResponse.clone().text()).toBe(200);
      const coldCheckpoint = Result.getOrThrow(decodeCoreQueryCheckpointResponse(await coldCheckpointResponse.json()));
      expect(coldCheckpoint.kind).toBe("historyUnavailable");
      expect(coldCheckpoint.sourceId).toBe(freshCheckpoint.sourceId);
      const restoredSyncCheckpoint = await request(active(), "/__proof/sync-checkpoint", { ...syncCheckpointRequest,
        authorizeFreshInitialization: false });
      expect(restoredSyncCheckpoint.status, await restoredSyncCheckpoint.clone().text()).toBe(200);
      expect(await restoredSyncCheckpoint.json()).toMatchObject({ ok: true,
        value: { kind: "resetRequired", reason: "historyUnavailable" } });
      expect(replayResponse.status, await replayResponse.clone().text()).toBe(200);
      const replay = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await replayResponse.json()));
      if (replay.kind !== "mutation") throw new Error("Expected replayed mutation.");
      expect(replay.disposition).toBe("replayed");
      expect(replay.publishedTimestamp).toBe(committed.publishedTimestamp);
      expect(replay.value).toBe(id);
      expect(await sourceReads(active())).toBe(0);
      const queryResponse = await invoke(active(), invocationProfile, "query", "users:get", { id }, "query:read");
      expect(queryResponse.status, await queryResponse.clone().text()).toBe(200);
      const queried = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await queryResponse.json()));
      if (queried.kind !== "query") throw new Error("Expected a Core query evaluation.");
      expect(Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }))(queried.value).name).toBe("configured");
      expect(queried.evaluation.timestamp).toBeGreaterThanOrEqual(committed.publishedTimestamp);
      expect(queried.evaluation.reads.some(read => read.intervals.length > 0)).toBe(true);
      expect(await sourceReads(active())).toBeGreaterThan(0);
      const again = await request(active(), `${push}/finish`, {});
      expect(again.status, await again.clone().text()).toBe(200);
      expect(Result.getOrThrow(decodeCoreApplicationCandidate(await again.json())).pushId).toBe(candidate.pushId);

      const identicalStart = await request(active(), coreApplicationPushStartPath(profile.deploymentId), { sourcePackage });
      expect(identicalStart.status, await identicalStart.clone().text()).toBe(200);
      expect(Result.getOrThrow(decodeCoreApplicationCandidate(await identicalStart.json())).pushId).toBe(candidate.pushId);
      const changedSourcePackage = (revision: number) => ({ ...sourcePackage, modules: sourcePackage.modules.map(module => {
        if (module.path !== sourcePackage.execution) return module;
        const text = `${module.source}\n// Registered source upgrade ${revision}.\n`;
        return { ...module, source: text,
          sha256: createHash("sha256").update(sourceModuleDigestInputV1(text, undefined)).digest("hex") };
      }) });
      const secondStart = await request(active(), coreApplicationPushStartPath(profile.deploymentId), { sourcePackage: changedSourcePackage(2) });
      expect(secondStart.status, await secondStart.clone().text()).toBe(200);
      const second = Result.getOrThrow(decodeCoreApplicationCandidate(await secondStart.json()));
      expect(second.pushId).not.toBe(candidate.pushId);
      const deployment = coreApplicationDeploymentPath(profile.deploymentId);
      expect(Result.getOrThrow(decodeCoreApplicationCandidate(await (await request(active(), deployment)).json())).pushId).toBe(candidate.pushId);
      const secondFinish = await request(active(), `${coreApplicationPushPath(profile.deploymentId, second.pushId)}/finish`, {});
      expect(secondFinish.status, await secondFinish.clone().text()).toBe(200);
      expect(Result.getOrThrow(decodeCoreApplicationCandidate(await secondFinish.json())).pushId).toBe(second.pushId);
      const replacedCheckpointResponse = await request(active(), checkpointPath, savedCheckpointRequest);
      expect(replacedCheckpointResponse.status, await replacedCheckpointResponse.clone().text()).toBe(200);
      const replacedCheckpoint = Result.getOrThrow(decodeCoreQueryCheckpointResponse(await replacedCheckpointResponse.json()));
      expect(replacedCheckpoint.kind).toBe("sourceReplaced");
      expect(replacedCheckpoint.sourceId).not.toBe(freshCheckpoint.sourceId);
      const secondCheckpointRequest = { ...checkpointRequest, sourceId: replacedCheckpoint.sourceId, after: replacedCheckpoint.through };
      const readsBeforeHistoricalReplay = await sourceReads(active());
      const historicalResponse = await request(active(), path, { ...create, kind: "infer" });
      expect(historicalResponse.status, await historicalResponse.clone().text()).toBe(200);
      const historical = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await historicalResponse.json()));
      expect(historical).toMatchObject({ kind: "mutation", disposition: "replayed", value: id,
        publishedTimestamp: committed.publishedTimestamp });
      expect(await sourceReads(active())).toBe(readsBeforeHistoricalReplay);
      const secondProfile = { ...profile, sourceArtifactRootSha256: second.sourceArtifactRootSha256, sourcePackageHash: second.sourcePackageHash };
      const inferredQueryResponse = await invoke(active(), secondProfile,
        "infer", "users:get", { id }, "query:keyed-after-upgrade");
      expect(inferredQueryResponse.status, await inferredQueryResponse.clone().text()).toBe(200);
      const inferredQuery = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await inferredQueryResponse.json()));
      expect(inferredQuery).toMatchObject({ kind: "query", value: { name: "configured" } });
      const oldFinish = await request(active(), `${push}/finish`, {});
      expect(oldFinish.status, await oldFinish.clone().text()).toBe(200);
      expect(Result.getOrThrow(decodeCoreApplicationCandidate(await oldFinish.json())).pushId).toBe(candidate.pushId);
      expect(Result.getOrThrow(decodeCoreApplicationCandidate(await (await request(active(), deployment)).json())).pushId).toBe(second.pushId);
      const thirdStart = await request(active(), coreApplicationPushStartPath(profile.deploymentId), { sourcePackage: changedSourcePackage(3) });
      expect(thirdStart.status, await thirdStart.clone().text()).toBe(200);
      const third = Result.getOrThrow(decodeCoreApplicationCandidate(await thirdStart.json()));
      const abandoned = await request(active(), `${coreApplicationPushPath(profile.deploymentId, third.pushId)}/abandon`, {});
      expect(abandoned.status, await abandoned.clone().text()).toBe(200);
      expect(Result.getOrThrow(decodeCoreApplicationCandidate(await abandoned.json())).state).toBe("abandoned");
      expect(Result.getOrThrow(decodeCoreApplicationCandidate(await (await request(active(), deployment)).json())).pushId).toBe(second.pushId);

      const authMutation = invocation(secondProfile, "mutation", "users:create", { name: "auth-only-original" }, "create:before-auth-only");
      const authOriginalResponse = await request(active(), path, authMutation);
      expect(authOriginalResponse.status, await authOriginalResponse.clone().text()).toBe(200);
      const authOriginal = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await authOriginalResponse.json()));
      if (authOriginal.kind !== "mutation") throw new Error("Expected the pre-auth-change mutation outcome.");
      const authStart = await request(active(), coreApplicationPushStartPath(profile.deploymentId), {
        sourcePackage: { ...changedSourcePackage(2), authConfig: {
          providers: [{ domain: "https://auth-only.example.com", applicationID: "configured-proof" }],
        } },
      });
      expect(authStart.status, await authStart.clone().text()).toBe(200);
      const authCandidate = Result.getOrThrow(decodeCoreApplicationCandidate(await authStart.json()));
      expect(authCandidate.sourceArtifactRootSha256).toBe(second.sourceArtifactRootSha256);
      expect(authCandidate.sourcePackageHash).not.toBe(second.sourcePackageHash);
      const authFinish = await request(active(), `${coreApplicationPushPath(profile.deploymentId, authCandidate.pushId)}/finish`, {});
      expect(authFinish.status, await authFinish.clone().text()).toBe(200);
      const authCheckpointResponse = await request(active(), checkpointPath, secondCheckpointRequest);
      expect(authCheckpointResponse.status, await authCheckpointResponse.clone().text()).toBe(200);
      const authCheckpoint = Result.getOrThrow(decodeCoreQueryCheckpointResponse(await authCheckpointResponse.json()));
      expect(authCheckpoint.kind).toBe("sourceReplaced");
      expect(authCheckpoint.sourceId).not.toBe(replacedCheckpoint.sourceId);
      const authProfile = { ...secondProfile, sourcePackageHash: authCandidate.sourcePackageHash };
      const readsBeforeStaleAuth = await sourceReads(active());
      for (const [kind, functionPath, args, requestKey] of [
        ["query", "users:get", { id }, "auth-only:stale-query"],
        ["mutation", "users:create", { name: "auth-only-fresh" }, "auth-only:stale-mutation"],
        ["infer", "users:get", { id }, "auth-only:stale-inferred-query"],
        ["infer", "users:create", { name: "auth-only-fresh" }, "auth-only:stale-inferred-mutation"],
      ] as const) {
        const stale = await invoke(active(), secondProfile, kind, functionPath, args, requestKey);
        expect(stale.status, await stale.clone().text()).toBe(503);
      }
      expect(await sourceReads(active())).toBe(readsBeforeStaleAuth);
      for (const kind of ["mutation", "infer"] as const) {
        const recovered = await request(active(), path, { ...authMutation, kind });
        expect(recovered.status, await recovered.clone().text()).toBe(200);
        expect(Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await recovered.json()))).toMatchObject({
          kind: "mutation", disposition: "replayed", value: authOriginal.value, publishedTimestamp: authOriginal.publishedTimestamp,
        });
      }
      expect(await sourceReads(active())).toBe(readsBeforeStaleAuth);
      const currentAuthMutation = await invoke(active(), authProfile, "mutation", "users:create", { name: "auth-only-fresh" }, "auth-only:stale-mutation");
      expect(currentAuthMutation.status, await currentAuthMutation.clone().text()).toBe(200);
      expect(Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await currentAuthMutation.json()))).toMatchObject({
        kind: "mutation", disposition: "published",
      });
      const currentAuthQuery = await invoke(active(), authProfile, "infer", "users:get", { id }, "auth-only:stale-inferred-query");
      expect(currentAuthQuery.status, await currentAuthQuery.clone().text()).toBe(200);
      expect(Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await currentAuthQuery.json()))).toMatchObject({
        kind: "query", value: { name: "configured" },
      });
      await stop();

      const changed = { ...profile, generation: profile.generation + 1 };
      runtime = makeRuntime(worker, directory, changed, keys);
      expect((await request(active(), discovery)).status).toBe(503);
      expect((await invoke(active(), { ...invocationProfile, generation: changed.generation }, "query", "users:get", { id }, "query:changed-generation")).status).toBe(503);
      expect(await sourceReads(active())).toBe(0);
    } catch (cause) { primaryFailures.push(cause); throw cause; }
    finally {
      const closed = await Promise.allSettled([stop()]);
      const database = await Promise.allSettled([physical.close()]);
      const temporary = await Promise.allSettled([rm(directory, { recursive: true, force: true })]);
      const failures = [...closed, ...database, ...temporary].flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError([...primaryFailures, ...failures], "Configured app proof cleanup failed.");
    }
  }, 240_000);
});

async function sourceReads(runtime: Miniflare) {
  return Schema.decodeUnknownSync(Schema.Struct({ sourceReads: Schema.Int }))(
    await (await request(runtime, "/__proof/resources")).json()).sourceReads;
}
function request(runtime: Miniflare, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  return runtime.dispatchFetch(`https://configured-owner.test${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function invocation(profile: InvocationProfile, kind: CoreApplicationInvocationRequest["kind"], functionPath: string, args: Record<string, string>,
  key: string, root = profile.sourceArtifactRootSha256) {
  return Result.getOrThrow(encodeCoreApplicationInvocationRequest({ format: "flarex.core-application.request", version: 1, kind,
    functionPath: TransactionFunctionPathV1Schema.make(functionPath), args, auth: { kind: "anonymous" },
    requestKey: TransactionRequestKeyV1Schema.make(key), sourceArtifactRootSha256: root, sourcePackageHash: profile.sourcePackageHash }));
}
function invoke(runtime: Miniflare, profile: InvocationProfile, kind: CoreApplicationInvocationRequest["kind"], functionPath: string,
  args: Record<string, string>, key: string, root?: string) {
  return request(runtime, coreApplicationInvocationPath(profile.deploymentId), invocation(profile, kind, functionPath, args, key, root));
}
function makeRuntime(worker: string, directory: string, profile: Profile, keys: string) {
  if (endpoints === undefined) throw new Error("Missing configured owner PostgreSQL endpoints.");
  return new Miniflare({ name: "configured-application-proof", modules: [{ type: "ESModule", path: "worker.js", contents: worker }],
    compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
    bindings: { FLAREX_EXECUTOR_TOKEN: token, FLAREX_QUERY_SYNC_PROBE_TOKEN: checkpointProbeToken,
      FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [profile] }),
      FLAREX_APPLICATION_KEYS: keys },
    hyperdrives: { HYPERDRIVE_CACHE_DISABLED: endpoints.connectionString }, workerLoaders: { LOADER: {} },
    serviceBindings: { FLAREX_EXECUTOR: "configured-application-proof",
      APPLICATION_ANALYZER: { name: "configured-application-proof", entrypoint: "FlarexApplicationAnalysisHost" } },
    r2Buckets: ["ARTIFACTS"], r2Persist: join(directory, "r2"), durableObjectsPersist: join(directory, "do"),
    durableObjects: { APPLICATIONS: { className: "ConfiguredApplicationDO", useSQLite: true },
      DEPLOYMENT_SYNCS: { className: "DeploymentSyncDO", useSQLite: true } },
  } satisfies MiniflareOptions);
}
