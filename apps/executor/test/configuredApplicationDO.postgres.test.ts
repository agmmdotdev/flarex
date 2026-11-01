import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { createCoreApplicationDefinition } from "@flarex/system-test/internal/application-core-definition";
import { APPLICATION_ANALYSIS_ANALYZER_IDENTITY, APPLICATION_ANALYSIS_POLICY_IDENTITY } from
  "@flarex/source-analyzer-v2/internal/application-analysis-host";
import { Result, Schema } from "effect";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { coreApplicationInvocationPath, coreApplicationProfilePath, coreApplicationRegistrationPath,
  decodeCoreApplicationInvocationSuccess, decodeCoreApplicationProfile, encodeCoreApplicationInvocationRequest } from
  "flarex-protocol/internal/core-application";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { bundleApplicationWorker } from "./support/bundleApplicationWorker";
import { createExecutorApplicationSecretFixture, executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(endpointPath, "utf8")));
const token = "configured-app-owner-private-proof";
type Profile = ReturnType<typeof executorApplicationProfileFixture>;

describe.runIf(endpoints !== undefined)("configured production app owner in actual workerd", () => {
  it("registers sealed source through actual Analysis, resumes and preserves Core evidence and outcomes", async () => {
    if (endpoints === undefined) throw new Error("Configured owner proof requires ordinary PostgreSQL.");
    const definition = await createCoreApplicationDefinition();
    const worker = await bundleApplicationWorker(new URL("./configuredApplicationDO.workerd.worker.ts", import.meta.url));
    const directory = await mkdtemp(join(tmpdir(), "flarex-configured-application-"));
    const physical = await createCorePostgresFixture(endpoints);
    const base = executorApplicationProfileFixture();
    const keys = await createExecutorApplicationSecretFixture(base.keyId);
    const configured = { ...base, persistenceNamespace: physical.namespace, instanceName: physical.instanceName,
      anchorFunctionPath: "users:get", analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
      analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
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
      runtime = makeRuntime(worker, directory, configured, keys);
      const uploaded = await request(active(), "/__proof/source", { modules: definition.source.modules });
      expect(uploaded.status, await uploaded.clone().text()).toBe(200);
      const source = Schema.decodeUnknownSync(Schema.Struct({ source: Schema.Struct({ sourceArtifact:
        Schema.Struct({ rootSha256: Schema.String }) }) }))(await uploaded.json());
      await active().dispose();
      runtime = undefined;
      const profile = { ...configured, sourceArtifactRootSha256: source.source.sourceArtifact.rootSha256 };
      const path = coreApplicationInvocationPath(profile.deploymentId);
      const discovery = coreApplicationProfilePath(profile.deploymentId);
      const registration = coreApplicationRegistrationPath(profile.deploymentId);
      runtime = makeRuntime(worker, directory, { ...profile, maximumRegistrationSteps: 1 }, keys);

      const denied = await active().dispatchFetch(`https://configured-owner.test${path}`, { method: "POST", body: "{}" });
      expect(denied.status).toBe(401);
      expect((await request(active(), "/__proof/wrong-object")).status).toBe(500);
      expect((await request(active(), discovery)).status).toBe(503);
      expect(Schema.decodeUnknownSync(Schema.Struct({ sourceReads: Schema.Int }))(await (await request(active(), "/__proof/resources")).json()).sourceReads).toBe(0);
      const partial = await request(active(), registration, { format: "flarex.core-application.registration", version: 1,
        requestKey: "registration:configured", sourceArtifactRootSha256: profile.sourceArtifactRootSha256 });
      expect(partial.status, await partial.clone().text()).toBe(503);
      expect((await request(active(), discovery)).status).toBe(503);
      await stop();

      runtime = makeRuntime(worker, directory, profile, keys);
      expect((await request(active(), discovery)).status).toBe(503);
      const registered = await request(active(), registration, { format: "flarex.core-application.registration", version: 1,
        requestKey: "registration:configured", sourceArtifactRootSha256: profile.sourceArtifactRootSha256 });
      expect(registered.status, await registered.clone().text()).toBe(200);
      const discovered = await request(active(), discovery);
      expect(discovered.status, await discovered.clone().text()).toBe(200);
      const resolved = Result.getOrThrow(decodeCoreApplicationProfile(await discovered.json()));
      expect(resolved).toMatchObject({ kind: "core", route: { deploymentId: profile.deploymentId,
        scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid }, sourceArtifactRootSha256: profile.sourceArtifactRootSha256,
        sourcePackageHash: profile.sourcePackageHash });

      const oversized = await request(active(), path, { content: "x".repeat(profile.http.maximumRequestBytes) });
      expect(oversized.status).toBe(413);

      const foreign = await invoke(active(), profile, "query", "users:get", { id: "wrong" }, "query:foreign", "ff".repeat(32));
      expect(foreign.status).toBe(503);
      const create = invocation(profile, "mutation", "users:create", { name: "configured" }, "create:lost-response");
      const lost = await request(active(), path, create, { "x-proof-drop-response": "1" });
      expect(lost.status).toBe(502);
      const trace = Schema.decodeUnknownSync(Schema.Struct({ committed: Schema.Unknown }))(await lost.json());
      const committed = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(trace.committed));
      if (committed.kind !== "mutation") throw new Error("Expected committed mutation trace.");
      expect(committed.disposition).toBe("published");
      const id = Schema.decodeUnknownSync(Schema.String)(committed.value);
      await stop();

      runtime = makeRuntime(worker, directory, profile, keys);
      const replayResponse = await request(active(), path, create);
      expect(replayResponse.status, await replayResponse.clone().text()).toBe(200);
      const replay = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await replayResponse.json()));
      if (replay.kind !== "mutation") throw new Error("Expected replayed mutation.");
      expect(replay.disposition).toBe("replayed");
      expect(replay.publishedTimestamp).toBe(committed.publishedTimestamp);
      expect(replay.value).toBe(id);
      expect(Schema.decodeUnknownSync(Schema.Struct({ sourceReads: Schema.Int }))(await (await request(active(), "/__proof/resources")).json()).sourceReads).toBe(0);
      const queryResponse = await invoke(active(), profile, "query", "users:get", { id }, "query:read");
      expect(queryResponse.status, await queryResponse.clone().text()).toBe(200);
      const queried = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(await queryResponse.json()));
      if (queried.kind !== "query") throw new Error("Expected a Core query evaluation.");
      expect(Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }))(queried.value).name).toBe("configured");
      expect(queried.evaluation.timestamp).toBeGreaterThanOrEqual(committed.publishedTimestamp);
      expect(queried.evaluation.reads.length).toBeGreaterThan(0);
      expect(queried.evaluation.reads.some(read => read.intervals.length > 0)).toBe(true);
      expect(Schema.decodeUnknownSync(Schema.Struct({ sourceReads: Schema.Int }))(await (await request(active(), "/__proof/resources")).json()).sourceReads).toBeGreaterThan(0);
      const again = await request(active(), registration, { format: "flarex.core-application.registration", version: 1,
        requestKey: "registration:after-data", sourceArtifactRootSha256: profile.sourceArtifactRootSha256 });
      expect(again.status, await again.clone().text()).toBe(200);
      await stop();

      // The same source pin does not authorize a changed configured installation generation.
      const changed = { ...profile, generation: profile.generation + 1 };
      runtime = makeRuntime(worker, directory, changed, keys);
      expect((await request(active(), discovery)).status).toBe(503);
      expect((await invoke(active(), changed, "query", "users:get", { id }, "query:changed-generation")).status).toBe(503);
      expect((await invoke(active(), changed, "mutation", "users:create", { name: "must refuse" }, "mutation:changed-generation")).status).toBe(503);
      expect(Schema.decodeUnknownSync(Schema.Struct({ sourceReads: Schema.Int }))(await (await request(active(), "/__proof/resources")).json()).sourceReads).toBe(0);
    } catch (cause) {
      primaryFailures.push(cause);
      throw cause;
    } finally {
      const closed = await Promise.allSettled([stop()]);
      const database = await Promise.allSettled([physical.close()]);
      // mkdtemp returned this exact test-owned directory under the OS temporary root.
      const temporary = await Promise.allSettled([rm(directory, { recursive: true, force: true })]);
      const failures = [...closed, ...database, ...temporary].flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError([...primaryFailures, ...failures], "Configured app proof cleanup failed.");
    }
  }, 240_000);
});

function request(runtime: Miniflare, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  return runtime.dispatchFetch(`https://configured-owner.test${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function invocation(profile: Profile, kind: "query" | "mutation", functionPath: string, args: Record<string, string>,
  key: string, root = profile.sourceArtifactRootSha256) {
  return Result.getOrThrow(encodeCoreApplicationInvocationRequest({ format: "flarex.core-application.request", version: 1, kind,
    functionPath: TransactionFunctionPathV1Schema.make(functionPath), args, auth: { kind: "anonymous" },
    requestKey: TransactionRequestKeyV1Schema.make(key), sourceArtifactRootSha256: root }));
}
function invoke(runtime: Miniflare, profile: Profile, kind: "query" | "mutation", functionPath: string,
  args: Record<string, string>, key: string, root?: string) {
  return request(runtime, coreApplicationInvocationPath(profile.deploymentId), invocation(profile, kind, functionPath, args, key, root));
}
function makeRuntime(worker: string, directory: string, profile: Profile, keys: string) {
  if (endpoints === undefined) throw new Error("Missing configured owner PostgreSQL endpoints.");
  return new Miniflare({ name: "configured-application-proof", modules: [{ type: "ESModule", path: "worker.js", contents: worker }],
    compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
    bindings: { FLAREX_EXECUTOR_TOKEN: token, FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [profile] }),
      FLAREX_APPLICATION_KEYS: keys },
    hyperdrives: { HYPERDRIVE_CACHE_DISABLED: endpoints.connectionString }, workerLoaders: { LOADER: {} },
    serviceBindings: { APPLICATION_ANALYZER: { name: "configured-application-proof", entrypoint: "FlarexApplicationAnalysisHost" } },
    r2Buckets: ["ARTIFACTS"], r2Persist: join(directory, "r2"), durableObjectsPersist: join(directory, "do"),
    durableObjects: { APPLICATIONS: { className: "ConfiguredApplicationDO", useSQLite: true },
      UPLOADS: { className: "ApplicationSourceUploadDO", useSQLite: true } },
  } satisfies MiniflareOptions);
}
