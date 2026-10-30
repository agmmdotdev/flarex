import { createCorePostgresFixture, readCoreFixtureRegistry } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { withApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { createCoreApplicationDefinition } from "@flarex/system-test/internal/application-core-definition";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { decodeDocumentValue } from "flarex-protocol/document-value";
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
  checkouts: Schema.Int, released: Schema.Int, bodies: Schema.Int, hostHeld: Schema.Int });
const ResultBody = Schema.Struct({ ok: Schema.Boolean, value: Schema.optionalKey(Schema.Unknown),
  cause: Schema.optionalKey(Schema.String), resources: Resources,
  failures: Schema.optionalKey(Schema.Array(Schema.Struct({ tag: Schema.NullOr(Schema.String), reason: Schema.NullOr(Schema.String) }))) });
const Status = Schema.Struct({ boot: Schema.String, gateEntered: Schema.Boolean, blockedSourceReads: Schema.Int, resources: Resources,
  backends: Schema.Array(Schema.Struct({ pid: Schema.Int, applicationName: Schema.String })) });
const SchemaSchedulerStatus = Schema.Struct({ boot: Schema.String, holdAlarms: Schema.Boolean, holdConnections: Schema.Boolean,
  blockedConnections: Schema.Int, alarms: Schema.Int, completedAlarms: Schema.Int, activeAlarms: Schema.Int,
  closing: Schema.Boolean, bootWaiting: Schema.Boolean, alarmsDuringBoot: Schema.Int,
  bootInitialState: Schema.NullOr(Schema.String), bootValidationState: Schema.NullOr(Schema.String), bootStatusReads: Schema.Int, alarm: Schema.NullOr(Schema.Number), resources: Resources });
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
      const summary = Schema.decodeUnknownSync(Schema.Struct({ timestamp: Schema.String, count: Schema.String,
        serialized: Schema.String }))(await (await runtime.dispatchFetch("https://application-owner.test/summary-codec")).json());
      expect(summary.timestamp).toBe("1");
      expect(summary.count).toBe("18446744073709551615");
      expect(summary.serialized).toContain('"numValues":18446744073709551615');
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
        const start = async (waitForSchemaOnBoot = false) => {
          runtime = makeRuntime(worker, directory, { ...configuration, waitForSchemaOnBoot });
        };
        const close = async () => {
          const owner = runtime;
          if (owner === undefined) return;
          runtime = undefined;
          const closed = await Promise.allSettled([request(owner, "/close-cleanup", {}).then(async response => {
            if (!response.ok) throw new Error(await response.text());
          })]);
          const disposed = await Promise.allSettled([owner.dispose()]);
          const failures = [...closed, ...disposed].flatMap(result => result.status === "rejected" ? [result.reason] : []);
          if (failures.length > 0) throw new AggregateError(failures, "Actual Application owner cleanup failed");
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
          const rejectedScheduler = await schemaSchedulerStatus(active());
          expect(rejectedScheduler.alarm).toBeNull();
          expect(rejectedScheduler.resources.pools).toBe(0);
          await invoke(active(), "schemaInspect", {});
          await waitForSchemaIdle(active());
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

          // The configured query channel admits two active roots and two queued
          // roots. Nested function execution in each root borrows that permit.
          await withSourceReadGate(active(), close, async own => {
            const heldFirst = own(invoke(active(), "typed", args, "/hold-all"));
            await expect.poll(async () => (await status(active())).blockedSourceReads, { timeout: 20_000 }).toBe(1);
            const heldSecond = own(invoke(active(), "typed", args));
            await expect.poll(async () => (await status(active())).blockedSourceReads, { timeout: 20_000 }).toBe(2);
            const completed: Awaited<ReturnType<typeof invoke>>[] = [];
            const saturated = Array.from({ length: 5 }, () => own(invoke(active(), "typed", args, "/invoke", undefined, false)
              .then(result => { completed.push(result); return result; })));
            await expect.poll(() => completed.length, { timeout: 20_000 }).toBe(3);
            // This endpoint runs the public typed query facade. Its owning
            // projection exposes temporary overload as QueryInvocationError.
            expect(completed.map(result => result.body.failures)).toEqual(Array.from({ length: 3 }, () =>
              expect.arrayContaining([{ tag: "QueryInvocationError", reason: "transient" }])));
            expect((await status(active())).blockedSourceReads).toBe(2);
            await request(active(), "/release", {});
            expect(await Promise.allSettled([heldFirst, heldSecond]))
              .toEqual(Array.from({ length: 2 }, () => expect.objectContaining({ status: "fulfilled" })));
            const resumed = await Promise.allSettled(saturated);
            expect(resumed).toEqual(Array.from({ length: 5 }, () => expect.objectContaining({ status: "fulfilled" })));
            expect(resumed.flatMap(result => result.status === "fulfilled" && result.value.body.ok ? [result.value] : []))
              .toHaveLength(2);
            expect((await status(active())).blockedSourceReads).toBe(0);
          });

          await withSourceReadGate(active(), close, async own => {
            const oldQuery = own(invoke(active(), "typed", args, "/hold"));
            await expect.poll(async () => (await status(active())).gateEntered, { timeout: 20_000 }).toBe(true);
            const mutation = await invoke(active(), "mutate", { ...args, fail: false }, "/invoke", "actual-app:acknowledged");
            expect(Schema.decodeUnknownSync(Mutation)(mutation.body.value).disposition).toBe("published");
            expect((await invoke(active(), "typed", args)).body.value).toBe("parent-after-success");
            await invoke(active(), "republish", {});
            await request(active(), "/release", {});
            expect((await oldQuery).body.value).toBe("Ada");
            expect((await invoke(active(), "typed", args)).body.value).toBe("parent-after-success");
          });

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

          await close();
          await start();
          const heldDispatches = Promise.allSettled(Array.from({ length: 8 }, () =>
            request(active(), "/invoke", { operation: "hostHold", args: {} })));
          await expect.poll(async () => (await status(active())).resources.hostHeld, { timeout: 20_000 }).toBe(8);
          const overflow = await request(active(), "/invoke", { operation: "typed", args });
          expect(overflow.status).toBe(503);
          expect(await overflow.json()).toEqual({ error: "application_owner_overloaded" });
          const drainedDispatches = await request(active(), "/close", {});
          expect(drainedDispatches.status).toBe(200);
          for (const result of await heldDispatches)
            if (result.status === "fulfilled") expect(result.value.status).not.toBe(200);
          const afterDispatchClose = await status(active());
          expect(afterDispatchClose.resources.hostHeld).toBe(0);
          expect(afterDispatchClose.resources.ended).toBe(afterDispatchClose.resources.connections);
          expect(afterDispatchClose.resources.checkouts).toBe(afterDispatchClose.resources.released);

          await close();
          await start();
          await invoke(active(), "schemaInspect", {});
          await waitForSchemaIdle(active());
          const stagedBoot = (await schemaSchedulerStatus(active())).boot;
          let stageFailed = false;
          let stageFailure: unknown;
          try {
            const staged = await invoke(active(), "stageSchema", {}, "/stage-hold");
            const activatedAt = BigInt(Schema.decodeUnknownSync(Schema.Struct({ timestamp: Schema.String }))(staged.body.value).timestamp);
            await expect.poll(async () => (await schemaSchedulerStatus(active())).blockedConnections, { timeout: 20_000 }).toBeGreaterThan(0);
            const initialRegistry = await Effect.runPromise(readCoreFixtureRegistry(physical, activatedAt));
            const initialTable = initialRegistry.table("users")?.definition;
            const initialIndex = initialTable === undefined ? undefined : initialRegistry.indexes.byName(initialTable.tabletId, "by_background").pending;
            expect(initialIndex?.state).toMatchObject({ type: "Backfilling", backfillState: { staged: true } });
            let closeSettled = false;
            const closing = request(active(), "/close", {}).then(response => { closeSettled = true; return response; });
            const observedClose = Promise.allSettled([closing]);
            await expect.poll(async () => (await schemaSchedulerStatus(active())).closing).toBe(true);
            expect(closeSettled).toBe(false);
            await request(active(), "/schema-release", {});
            const [closedAlarm] = await observedClose;
            if (closedAlarm?.status !== "fulfilled") throw new AggregateError(
              closedAlarm?.status === "rejected" ? [closedAlarm.reason] : [], "Actual alarm close did not settle");
            expect(closedAlarm.value.status, await closedAlarm.value.clone().text()).toBe(200);
            await expect.poll(async () => (await schemaSchedulerStatus(active())).activeAlarms).toBe(0);
            const stoppedScheduler = await schemaSchedulerStatus(active());
            expect(stoppedScheduler.alarm).toBeNull();
            expect(stoppedScheduler.resources.checkouts).toBe(stoppedScheduler.resources.released);
            expect(stoppedScheduler.resources.ended).toBe(stoppedScheduler.resources.connections);
          } catch (cause) {
            stageFailed = true;
            stageFailure = cause;
            throw cause;
          } finally {
            const released = await Promise.allSettled([request(active(), "/schema-release", {}).then(async response => {
              if (!response.ok) throw new Error(await response.text());
            })]);
            const closed = await Promise.allSettled([close()]);
            const failures = [...released, ...closed].flatMap(result => result.status === "rejected" ? [result.reason] : []);
            if (failures.length > 0) throw new AggregateError(stageFailed ? [stageFailure, ...failures] : failures,
              "Actual staged schema witness and cleanup failed");
          }
          // This is controlled close/reconstruction in actual workerd, not a
          // claim that production-managed eviction or alarm timing was tested.
          await start(true);
          await invoke(active(), "schemaInspect", {});
          await waitForSchemaIdle(active());
          const recoveredScheduler = await schemaSchedulerStatus(active());
          expect(recoveredScheduler.boot).not.toBe(stagedBoot);
          expect(recoveredScheduler.bootWaiting).toBe(false);
          expect(recoveredScheduler.alarmsDuringBoot).toBeGreaterThan(0);
          expect(recoveredScheduler.bootInitialState).toBe("pending");
          expect(recoveredScheduler.bootValidationState).toBe("validated");
          expect(recoveredScheduler.bootStatusReads).toBeGreaterThan(0);
          expect(recoveredScheduler.bootStatusReads).toBeLessThanOrEqual(6000);
          const recoveredAt = BigInt(Schema.decodeUnknownSync(Schema.String)((await invoke(active(), "schemaInspect", {})).body.value));
          const recoveredRegistry = await Effect.runPromise(readCoreFixtureRegistry(physical, recoveredAt));
          const recoveredTable = recoveredRegistry.table("users")?.definition;
          const recoveredIndex = recoveredTable === undefined ? undefined : recoveredRegistry.indexes.byName(recoveredTable.tabletId, "by_background").pending;
          expect(recoveredIndex?.state).toEqual({ type: "Backfilled2", staged: true });
          if (recoveredTable === undefined || recoveredIndex === undefined) throw new Error("Recovered staged index metadata is missing");
          const snapshot = await Effect.runPromise(physical.persistence.readSnapshot(recoveredAt));
          const indexRows = await Effect.runPromise(snapshot.scan({ index: recoveredIndex.ref, tableId: recoveredTable.tabletId,
            interval: { start: null, end: null }, order: "asc", maxResults: 128 }));
          expect(Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(indexRows.entries.map(entry =>
            Result.getOrThrow(decodeDocumentValue(entry.document.jsonValue)))).map(row => row.name).toSorted())
            .toEqual(["parent-after-success", "row000", "row001", "row002"]);
          const idleCheckouts = recoveredScheduler.resources.checkouts;
          await new Promise<void>(resolve => setTimeout(resolve, 150));
          const stillIdle = await schemaSchedulerStatus(active());
          expect(stillIdle.alarm).toBeNull();
          expect(stillIdle.resources.checkouts).toBe(idleCheckouts);
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

type SourceGateInvocationOwner = <A>(invocation: Promise<A>) => Promise<A>;

/** Each background call receives an immediate rejection observer. On any body
 * assertion failure, release and join all calls before reporting every failure. */
async function withSourceReadGate(runtime: Miniflare, close: () => Promise<void>,
  work: (own: SourceGateInvocationOwner) => Promise<void>) {
  const observed: Array<Promise<PromiseSettledResult<unknown>[]>> = [];
  const own: SourceGateInvocationOwner = invocation => {
    observed.push(Promise.allSettled([invocation]));
    return invocation;
  };
  const body = await Promise.allSettled([Promise.resolve().then(() => work(own))]);
  const released = await Promise.allSettled([request(runtime, "/release", {}).then(response => {
    expect(response.status).toBe(200);
  })]);
  // If the release transport fails, controlled owner close also releases the
  // fixture gate; the outer close owns runtime disposal even when close fails.
  const closed = released.some(result => result.status === "rejected") ? await Promise.allSettled([close()]) : [];
  const joined = (await Promise.all(observed)).flat();
  const failures = [...body, ...released, ...closed, ...joined]
    .flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (failures.length > 0) throw new AggregateError(failures, "Source-gated Application invocations failed.");
}

function request(runtime: Miniflare, path: string, body: unknown, signal?: AbortSignal) {
  return runtime.dispatchFetch(`https://application-owner.test${path}`, { method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }) });
}
async function schemaSchedulerStatus(runtime: Miniflare) {
  return Schema.decodeUnknownSync(SchemaSchedulerStatus)(await (await request(runtime, "/schema-status", {})).json());
}
async function waitForSchemaIdle(runtime: Miniflare) {
  await expect.poll(async () => {
    const state = await schemaSchedulerStatus(runtime);
    return state.completedAlarms > 0 && state.activeAlarms === 0 && state.alarm === null;
  }, { timeout: 60_000 }).toBe(true);
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
function makeRuntime(worker: string, directory: string, configuration: Readonly<{ persistenceNamespace: string; instanceName: string; waitForSchemaOnBoot?: boolean }>) {
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
