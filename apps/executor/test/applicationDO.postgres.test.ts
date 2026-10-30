import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { withApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { createCoreApplicationDefinition } from "@flarex/system-test/internal/application-core-definition";
import { Cause, Effect, Exit, Schema } from "effect";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { builtinModules } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build, defaultClientConditions, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(endpointPath, "utf8")));
const TOKEN = "actual-application-owner-private-fixture";
const SOURCE_MODULE = Schema.Struct({ path: Schema.String, roles: Schema.Int,
  sourceSha256: Schema.String, sourceByteLength: Schema.Int });
const UPLOADED = Schema.Struct({ source: Schema.Struct({ sourceArtifact: Schema.Struct({
  rootSha256: Schema.String, executionModulePath: Schema.String, schemaModulePath: Schema.NullOr(Schema.String),
  modules: Schema.Array(SOURCE_MODULE),
}), modules: Schema.Array(Schema.Struct({ ...SOURCE_MODULE.fields, source: Schema.String })) }) });
const Resources = Schema.Struct({ pools: Schema.Int, connections: Schema.Int, ended: Schema.Int,
  checkouts: Schema.Int, released: Schema.Int, bodies: Schema.Int });
const ResultBody = Schema.Struct({ ok: Schema.Boolean, value: Schema.optionalKey(Schema.Unknown),
  cause: Schema.optionalKey(Schema.String), resources: Resources,
  failures: Schema.optionalKey(Schema.Array(Schema.Struct({ tag: Schema.NullOr(Schema.String), reason: Schema.NullOr(Schema.String) }))) });
const Status = Schema.Struct({ boot: Schema.String, gateEntered: Schema.Boolean, resources: Resources,
  backends: Schema.Array(Schema.Struct({ pid: Schema.Int, applicationName: Schema.String })) });
const Page = Schema.Struct({ page: Schema.Array(Schema.Struct({ name: Schema.String })),
  continueCursor: Schema.String, isDone: Schema.Boolean });
const Mutation = Schema.Struct({ disposition: Schema.Literals(["published", "replayed"]), commitSeq: Schema.String });

describe.runIf(endpoints !== undefined)("canonical app owner in actual workerd", () => {
  it("shares one database across query and mutation, drains, fences and reconstructs correlated outcomes", async () => {
    if (endpoints === undefined) throw new Error("Actual app-owner proof requires ordinary PostgreSQL.");
    const rawDefinition = await createCoreApplicationDefinition();
    expect(rawDefinition.coldAnalysisLoads).toBeGreaterThan(0);
    const worker = await bundleWorker();
    const directory = await mkdtemp(join(tmpdir(), "flarex-application-do-"));
    let runtime: Miniflare | undefined;
    try {
      runtime = makeRuntime(worker, directory, { persistenceNamespace: "unconfigured", instanceName: "application" });
      const uploaded = await request(runtime, "/source", { modules: rawDefinition.source.modules });
      expect(uploaded.status, await uploaded.clone().text()).toBe(200);
      const finalizedSource = Schema.decodeUnknownSync(UPLOADED)(await uploaded.json()).source;
      // Current Analysis consumes the real sealed R2 source descriptor; raw
      // fixture hashes are not accepted as finalized artifact authority.
      const definition = await createCoreApplicationDefinition(finalizedSource);
      expect(definition.source.sourceArtifact.rootSha256).not.toBe(rawDefinition.source.sourceArtifact.rootSha256);
      await runtime.dispose();
      runtime = undefined;
      const physical = await createCorePostgresFixture(endpoints);
      await withApplicationCoreFixture(physical, definition, async fixture => {
        const seed = await Effect.runPromise(fixture.database.begin());
        for (const name of ["row000", "row001", "row002"]) await Effect.runPromise(seed.insert("users", { name }));
        await Effect.runPromise(fixture.database.commit(await Effect.runPromise(seed.finalize())));
        // This is explicit pre-activation maintenance. No live canonical owner
        // coexists with an external lease/metadata writer.
        await fixture.closeOwner();
        const previousLease = await Effect.runPromise(physical.persistence.acquireLease());
        const configuration = { persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
        const active = () => {
          if (runtime === undefined) throw new Error("Actual app-owner runtime is closed.");
          return runtime;
        };
        const start = async () => { runtime = makeRuntime(worker, directory, configuration); };
        const close = async () => {
          if (runtime === undefined) return;
          try { await request(runtime, "/close", {}); } finally { await runtime.dispose(); runtime = undefined; }
        };
        try {
          await start();
          const args = { id: fixture.documentId };
          for (const path of ["/wrong-name", "/unique"]) {
            const wrong = await request(active(), path, { operation: "typed", args });
            expect(wrong.status).toBe(421);
            expect((await status(active())).resources).toMatchObject({ pools: 0, connections: 0 });
          }
          const unauthorized = await active().dispatchFetch("https://application-owner.test/invoke", {
            method: "POST", body: JSON.stringify({ operation: "typed", args }),
          });
          expect(unauthorized.status).toBe(401);
          const beforeQueries = await fixture.durableState();
          const concurrent = await Promise.all(Array.from({ length: 4 }, () => invoke(active(), "typed", args)));
          expect(concurrent.map(result => result.body.value)).toEqual(["Ada", "Ada", "Ada", "Ada"]);
          expect(new Set(concurrent.map(result => result.boot)).size).toBe(1);
          expect((await status(active())).resources.pools).toBe(1);
          expect(await fixture.durableState()).toEqual(beforeQueries);
          const fenced = await Effect.runPromiseExit(physical.persistence.write(previousLease, { documents: [], indexes: [] }));
          expect(Exit.isFailure(fenced)).toBe(true);
          if (Exit.isFailure(fenced)) expect(fenced.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
            .toContainEqual(expect.objectContaining({ _tag: "CorePersistenceError", reason: "leaseLost" }));

          const oldQuery = invoke(active(), "typed", args, "/hold");
          await expect.poll(async () => (await status(active())).gateEntered, { timeout: 20_000 }).toBe(true);
          const mutation = await invoke(active(), "mutate", { ...args, fail: false }, "/invoke", "actual-app:acknowledged");
          expect(Schema.decodeUnknownSync(Mutation)(mutation.body.value).disposition).toBe("published");
          expect((await invoke(active(), "typed", args)).body.value).toBe("parent-after-success");
          await invoke(active(), "republish", {});
          await request(active(), "/release", {});
          expect((await oldQuery).body.value).toBe("Ada");
          expect((await invoke(active(), "typed", args)).body.value).toBe("parent-after-success");

          const firstPage = Schema.decodeUnknownSync(Page)((await invoke(active(), "query", {
            terminal: "paginate", count: 2,
          })).body.value);
          expect(firstPage.page.map(row => row.name)).toEqual(["parent-after-success", "row000"]);
          expect(firstPage.isDone).toBe(false);
          const history = await fixture.history();
          const boot = (await status(active())).boot;
          const beforeClose = await status(active());
          expect(beforeClose.resources.connections).toBeGreaterThan(0);
          expect(beforeClose.resources.ended).toBe(0);
          expect(beforeClose.resources.checkouts).toBe(beforeClose.resources.released);
          const closeResult = await request(active(), "/close", {});
          const closed = Schema.decodeUnknownSync(Schema.Struct({ closed: Schema.Boolean, resources: Resources }))(await closeResult.json());
          expect(closed.closed).toBe(true);
          // Client emits its observational end event on the platform nextTick,
          // after the awaited native connection end Promise has settled.
          await expect.poll(async () => (await status(active())).resources.ended).toBe(closed.resources.connections);
          expect((await request(active(), "/invoke", { operation: "typed", args })).status).toBe(503);
          await runtime?.dispose();
          runtime = undefined;
          await start();
          const cold = await invoke(active(), "typed", args);
          expect(cold.boot).not.toBe(boot);
          expect(cold.body.value).toBe("parent-after-success");
          expect(await fixture.history()).toEqual(history);
          const continued = Schema.decodeUnknownSync(Page)((await invoke(active(), "query", {
            terminal: "paginate", count: 2, cursor: firstPage.continueCursor,
          })).body.value);
          expect(continued.page.map(row => row.name)).toEqual(["row001", "row002"]);

          const idleBackend = (await status(active())).backends[0];
          if (idleBackend === undefined) throw new Error("Actual owner did not retain a PostgreSQL backend.");
          expect(idleBackend.applicationName).toMatch(/^actual-app-do-[0-9a-f-]{36}$/);
          expect(await physical.query(`SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
            WHERE pid=$1 AND application_name=$2 AND datname=current_database()`,
          [idleBackend.pid, idleBackend.applicationName])).toEqual([{ terminated: true }]);
          await expect.poll(async () => (await status(active())).resources.ended, { timeout: 20_000 }).toBeGreaterThan(0);
          const fatal = await request(active(), "/invoke", { operation: "typed", args });
          expect(fatal.status).toBe(500);
          expect(await fatal.text()).toContain("ApplicationOwnerHostError");
          await close();
          await start();

          const lost = await invoke(active(), "lostAck", { ...args, fail: false }, "/invoke", "actual-app:lost-ack", false);
          expect(lost.body.ok).toBe(false);
          expect(lost.body.failures).toContainEqual({ tag: "CorePersistenceError", reason: "uncertainWrite" });
          const historyAfterLost = await fixture.history();
          expect(historyAfterLost.length).toBe(history.length + 1);
          await close();
          await start();
          const replay = await invoke(active(), "mutate", { ...args, fail: false }, "/invoke", "actual-app:lost-ack");
          expect(Schema.decodeUnknownSync(Mutation)(replay.body.value).disposition).toBe("replayed");
          expect(replay.body.resources.bodies).toBe(0);
          expect(await fixture.history()).toEqual(historyAfterLost);
          // Dropped/late SDK terminals use the actual shared-session drain;
          // request cleanup owns every checkout before a later invocation.
          await invoke(active(), "query", { terminal: "take", count: 1, dropped: true });
          const late = await invoke(active(), "query", { terminal: "take", count: 1, dropped: true, late: true },
            "/invoke", undefined, false);
          expect(late.body.ok).toBe(false);
          expect(late.body.failures).toContainEqual({ tag: "ApplicationExecutionHostError", reason: "readBoundaryFailed" });
          expect((await invoke(active(), "typed", args)).body.value).toBe("parent-after-success");
          expect((await status(active())).resources.checkouts).toBe((await status(active())).resources.released);
          const cancelled = Promise.allSettled([request(active(), "/hold", { operation: "typed", args })]);
          await expect.poll(async () => (await status(active())).gateEntered, { timeout: 20_000 }).toBe(true);
          const cancelledClose = await request(active(), "/close", {});
          expect(cancelledClose.status).toBe(200);
          const [cancelledResult] = await cancelled;
          if (cancelledResult?.status === "fulfilled") expect(cancelledResult.value.status).not.toBe(200);
          const cancellationState = await status(active());
          expect(cancellationState.resources.ended).toBe(cancellationState.resources.connections);
          expect(cancellationState.resources.checkouts).toBe(cancellationState.resources.released);
        } finally { await close(); }
      });

      // Failure before ready cannot execute even a perfectly valid query body.
      runtime = makeRuntime(worker, directory, { persistenceNamespace: "missing_owned_core_target", instanceName: "application" });
      const notReady = await request(runtime, "/invoke", { operation: "typed", args: { id: "invalid" } });
      expect(notReady.status).toBe(500);
      expect((await status(runtime)).resources.bodies).toBe(0);
      await request(runtime, "/close", {});
    } finally {
      await runtime?.dispose();
      const absolute = resolve(directory);
      if (!absolute.startsWith(`${resolve(tmpdir())}\\flarex-application-do-`)) throw new Error("Refusing unowned app-host fixture cleanup.");
      await rm(absolute, { recursive: true, force: true });
    }
  }, 300_000);
});

function request(runtime: Miniflare, path: string, body: unknown, signal?: AbortSignal) {
  return runtime.dispatchFetch(`https://application-owner.test${path}`, { method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }) });
}
async function status(runtime: Miniflare) { return Schema.decodeUnknownSync(Status)(await (await request(runtime, "/status", {})).json()); }
async function invoke(runtime: Miniflare, operation: string, args: unknown, path = "/invoke", key?: string, expectSuccess = true) {
  const response = await request(runtime, path, { operation, args, ...(key === undefined ? {} : { key }) });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const body = Schema.decodeUnknownSync(Schema.fromJsonString(ResultBody))(text);
  if (expectSuccess) expect(body.ok, text).toBe(true);
  return { body, boot: response.headers.get("x-app-do-boot") };
}
function makeRuntime(worker: string, directory: string, configuration: Readonly<{ persistenceNamespace: string; instanceName: string }>) {
  if (endpoints === undefined) throw new Error("Missing app-host PostgreSQL endpoints.");
  return new Miniflare({ modules: [{ type: "ESModule", path: "worker.js", contents: worker }],
    compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
    bindings: { APP_CONFIGURATION: JSON.stringify(configuration), FLAREX_EXECUTOR_TOKEN: TOKEN },
    hyperdrives: { HYPERDRIVE_CACHE_DISABLED: endpoints.connectionString }, workerLoaders: { LOADER: {} },
    r2Buckets: ["ARTIFACTS"], r2Persist: join(directory, "r2"), durableObjectsPersist: join(directory, "do"),
    durableObjects: { APPS: { className: "ApplicationFixtureDO", useSQLite: true },
      UPLOADS: { className: "ApplicationSourceUploadDO", useSQLite: true } },
  } satisfies MiniflareOptions);
}
async function bundleWorker() {
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
  const workspaceResolution: Plugin = { name: "actual-app-do-workspace-resolution", resolveId(id) {
    if (id.startsWith("@flarex/") || id === "flarex-backend" || id.startsWith("flarex-backend/")
      || id === "flarex-protocol" || id.startsWith("flarex-protocol/")) return fileURLToPath(import.meta.resolve(id));
    return undefined;
  } };
  const output = await build({ configFile: false, logLevel: "silent", plugins: [workspaceResolution],
    resolve: { conditions: ["workerd", ...defaultClientConditions] },
    build: { write: false, minify: false, target: "es2022", lib: { entry: fileURLToPath(new URL("./applicationDO.workerd.worker.ts", import.meta.url)),
      formats: ["es"], fileName: "worker" }, rolldownOptions: {
      external: id => id.startsWith("cloudflare:") || builtins.has(id),
      output: { banner: 'import { createRequire as createRuntimeRequire } from "node:module";\nconst require = createRuntimeRequire("file:///worker.js");' },
    } } });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => "output" in result ? result.output : []);
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (worker === undefined || worker.type !== "chunk") throw new Error("Missing actual app-owner fixture bundle.");
  return worker.code;
}
