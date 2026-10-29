import { inspectFunctionReference } from "@flarex/application-definition/internal/function-reference";
import type { InferFunctionReturn } from "@flarex/application-definition";
import { invokeApplicationMutation } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  createApplicationNativeMutationPostgresFixture,
  createApplicationNativeMutationSourceBundle,
} from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { Effect, Result, Schema } from "effect";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { ChildProcess } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { builtinModules } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { build, defaultClientConditions, type Plugin } from "vite";
import { describe, expect, it } from "vitest";
import { appDocumentIdV1FromRowIdentity } from "flarex-protocol/app-document-id";
import { appOrderedIndexDocumentPathV1, compileAppOrderedIndexBoundsV1,
  lowerAppDeveloperOrderedIndexPhysicalSpecV1, orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import { decodeSchemaManifestAppDeveloperOrderedIndexSpecV1, decodeSchemaManifestAppIndexFieldPath } from "flarex-protocol/schema-manifest";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { validateValidatorValueV1 } from "flarex-protocol/validator-engine";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";

import { createFileScopedPostgresFixture, postgresUrl } from
  "../../../packages/persistence-postgres/test/support/postgresHelpers";
import {
  APPLICATION_NATIVE_QUERY_CACHE_FIXTURE_OPTIONS, CACHE_ROW_A, CACHE_ROW_B, CACHE_ROW_C, CACHE_ROW_MISSING,
  USERS_CACHE_REFERENCE,
} from "../../../packages/system-test/support/applicationNativeQueryDefinitions";
import { MiniflareApplicationWorkerLoader } from
  "../../../packages/system-test/support/applicationNativeQueryHarness";
import { makeApplicationNativeMutationTestLayer } from
  "../../../packages/system-test/support/applicationNativeMutationHarness";

const TOKEN = "application-query-do-private-fixture";
const runtimeContext = new AsyncLocalStorage<string>();
let runtimeSequence = 0;
let lifecycleObservations = 0;
const stdioFailures: unknown[] = [];
const COUNTS = Schema.Struct({ rowReads: Schema.Int, indexReads: Schema.Int, indexBodyReads: Schema.Int,
  refreshRows: Schema.Int, refreshes: Schema.Int, logicalPoints: Schema.Int, logicalIndexes: Schema.Int });
const RESOURCES = Schema.Struct({ constructed: Schema.Int, connected: Schema.Int, ended: Schema.Int });
const SHA256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const SOURCE_MODULE = Schema.Struct({ path: Schema.String, roles: Schema.Int, sourceSha256: SHA256, sourceByteLength: Schema.Int });
const UploadedSourceResponse = Schema.Struct({ source: Schema.Struct({
  sourceArtifact: Schema.Struct({ rootSha256: SHA256, executionModulePath: Schema.String,
    schemaModulePath: Schema.NullOr(Schema.String), modules: Schema.Array(SOURCE_MODULE) }),
  modules: Schema.Array(Schema.Struct({ ...SOURCE_MODULE.fields, source: Schema.String })),
}) });
const SuccessResponse = Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown, counts: COUNTS, resources: RESOURCES });
const FailureResponse = Schema.Struct({ ok: Schema.Literal(false), counts: COUNTS, resources: RESOURCES,
  cause: Schema.String, typedFailures: Schema.Array(Schema.String), defects: Schema.Array(Schema.String),
  spanFailures: Schema.Array(Schema.Struct({ span: Schema.String, tag: Schema.String, reason: Schema.NullOr(Schema.String) })),
  failure: Schema.Struct({ kind: Schema.Literals(["typed", "defect", "interrupted"]),
    tag: Schema.NullOr(Schema.String), reason: Schema.NullOr(Schema.String), message: Schema.NullOr(Schema.String),
    ownerTag: Schema.NullOr(Schema.String), ownerReason: Schema.NullOr(Schema.String) }) });
type Fixture = Awaited<ReturnType<typeof createApplicationNativeMutationPostgresFixture>>;
type ProbeValue = InferFunctionReturn<typeof USERS_CACHE_REFERENCE.contract>;

describe.skipIf(postgresUrl === null)("Application core in an actual workerd query DO", () => {
  it("reuses guarded data, preserves outcomes and reconstructs cold after restart", async () => {
    const source = await createApplicationNativeMutationSourceBundle(false, 0, 0, false, true);
    const worker = await bundleWorker();
    const directory = await mkdtemp(join(tmpdir(), "flarex-query-do-host-"));
    let owner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>> | undefined;
    let betaOwner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>> | undefined;
    let runtime: Miniflare | undefined;
    const mutationLoader = new MiniflareApplicationWorkerLoader();
    const stopProcessObservations = observeQueryFixtureProcesses();
    let primaryFailure: Readonly<{ cause: unknown }> | undefined;
    try {
      owner = await createFileScopedPostgresFixture();
      const activeOwner = owner;
      expect((await owner.persistence.query<{ superuser: boolean; bypass: boolean }>(
        "select rolsuper as superuser,rolbypassrls as bypass from pg_roles where rolname=current_user",
      )).rows).toEqual([{ superuser: false, bypass: false }]);
      runtime = makeRuntime(worker, directory, "{}", "{}");
      const upload = await runtime.dispatchFetch("https://query-do.test/source", {
        method: "POST", body: JSON.stringify({ modules: source.modules }),
      });
      const uploadBody = await upload.text();
      expect(upload.status, uploadBody).toBe(200);
      const finalizedSource = Schema.decodeUnknownSync(Schema.fromJsonString(UploadedSourceResponse))(uploadBody).source;
      expect(finalizedSource.sourceArtifact.rootSha256).not.toBe(source.sourceArtifact.rootSha256);
      // Real R2 authority identifies the sealed source tree, not the fixture's
      // raw UTF-8 hash. Preserve the actual reader's entire source descriptor.
      expect(finalizedSource.sourceArtifact.modules).not.toEqual(source.sourceArtifact.modules);
      expect(finalizedSource.modules.map(({ path, roles, source: text }) => ({ path, roles, source: text })))
        .toEqual(source.modules.map(({ path, roles, source: text }) => ({ path, roles, source: text })));
      const fixture = await createApplicationNativeMutationPostgresFixture({
        ...APPLICATION_NATIVE_QUERY_CACHE_FIXTURE_OPTIONS, sourceBundle: finalizedSource,
      }, { control: owner.persistence, target: owner.persistence });
      betaOwner = await createFileScopedPostgresFixture();
      const activeBetaOwner = betaOwner;
      const beta = await createApplicationNativeMutationPostgresFixture({
        ...APPLICATION_NATIVE_QUERY_CACHE_FIXTURE_OPTIONS, sourceBundle: finalizedSource,
        fixtureIdentity: { deploymentId: "deployment_actual_query_beta", projectId: "project_actual_query_beta", uuidOffset: 1000 },
        initialUserDocuments: [{ name: "Beta Ada", rowId: CACHE_ROW_A }, { name: "Beta Ada", rowId: CACHE_ROW_B },
          { name: "Beta Bea", rowId: CACHE_ROW_C }],
      }, { control: betaOwner.persistence, target: betaOwner.persistence });
      const configuration = JSON.stringify({ deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, schemaName: owner.schemaName });
      const betaConfiguration = JSON.stringify({ deploymentId: beta.deploymentId, scopeId: beta.authority.scopeId, schemaName: betaOwner.schemaName });
      await runtime.dispose();
      runtime = makeRuntime(worker, directory, configuration, betaConfiguration);
      const args = cacheArguments(fixture);
      const activeRuntime = () => {
        if (runtime === undefined) throw new Error("Query DO runtime is not running.");
        return runtime;
      };
      const invoke = (operation = "probe", path = "alpha/query") => request(activeRuntime(), path, { operation, args });
      const mutate = await makeMutation(fixture, mutationLoader, args.repeatId);

      const unauthorized = await runtime.dispatchFetch("https://query-do.test/alpha/query", {
        method: "POST", body: JSON.stringify({ operation: "probe", args }),
      });
      expect(unauthorized.status).toBe(401);
      const cold = await success(await invoke());
      expect(cold.value.first).toMatchObject({ name: "Bea" });
      expect(cold.counts.rowReads).toBeGreaterThan(0);
      expect(cold.counts.indexReads).toBeGreaterThan(0);
      expect(cold.counts.indexBodyReads).toBeGreaterThan(0);
      expect(cold.counts.refreshes).toBe(0);
      expect(cold.resources).toEqual({ constructed: 1, connected: 1, ended: 1 });
      const warm = await success(await invoke());
      expect(warm.boot).toBe(cold.boot);
      expect(warm.value).toEqual(cold.value);
      expect(warm.counts.rowReads).toBeLessThan(cold.counts.rowReads);
      expect(warm.counts.indexReads).toBe(0);
      expect(warm.counts.refreshes).toBe(0);
      for (const query of [cold, warm]) {
        expect(query.counts.logicalPoints).toBe(6);
        expect(query.counts.logicalIndexes).toBe(6);
      }

      const mismatch = await failure(await invoke("mismatch"));
      expect(mismatch.failure).toMatchObject({ kind: "typed", tag: "ApplicationResultContractError" });
      const afterMismatch = await success(await invoke());
      expect(afterMismatch.counts.indexReads).toBeGreaterThan(0);

      const cleanup = await failure(await invoke("cleanupFailure"));
      expect(cleanup.failure).toMatchObject({ kind: "defect", message: "query-host-fixture-client-cleanup" });
      expect(cleanup.resources).toEqual({ constructed: 1, connected: 1, ended: 1 });
      const afterCleanup = await success(await invoke());
      expect(afterCleanup.counts.indexReads).toBeGreaterThan(0);
      const combined = await failure(await invoke("mismatchCleanupFailure"));
      expect(combined.typedFailures).toContain("ApplicationResultContractError");
      expect(combined.defects).toContain("query-host-fixture-client-cleanup");
      expect(combined.resources).toEqual({ constructed: 1, connected: 1, ended: 1 });
      expect((await success(await invoke())).counts.indexReads).toBeGreaterThan(0);
      for (const operation of ["constructorFailure", "connectFailure"]) {
        const rejected = await failure(await invoke(operation));
        expect(rejected.failure).toMatchObject({ kind: "typed", tag: "QueryInvocationError", reason: "unavailable" });
        expect(rejected.resources.ended).toBe(operation === "connectFailure" ? 1 : 0);
        expect((await success(await invoke())).value).toEqual(cold.value);
      }

      await mutate("Bea", "same-key-in-actual-do");
      const sameKey = await success(await invoke());
      expect(sameKey.value.first).toMatchObject({ name: "Bea", padding: "same-key-in-actual-do" });
      expect(sameKey.counts.refreshes).toBe(1);
      expect(sameKey.counts.refreshRows).toBeGreaterThan(0);
      expect(sameKey.counts.indexReads).toBe(0);
      await mutate("Cyra", "key-move-in-actual-do");
      const moved = await success(await invoke());
      expect(moved.value.first).toMatchObject({ name: "Cyra", padding: "key-move-in-actual-do" });
      expect(moved.counts.refreshes).toBe(1);
      expect(moved.value.expanded.documents[2]).toMatchObject({ name: "Cyra" });

      const olderResponse = await withHeldQuery(activeRuntime(), "alpha", { operation: "probe", args }, async () => {
        await expect.poll(async () => Schema.decodeUnknownSync(Schema.Struct({ entered: Schema.Boolean }))(
          await (await request(activeRuntime(), "alpha/gate-status", {})).json(),
        ).entered, { timeout: 10_000 }).toBe(true);
        await mutate("Cyra", "while-old-query-held");
        const concurrent = await success(await invoke());
        expect(concurrent.value.first).toMatchObject({ padding: "while-old-query-held" });
        expect(concurrent.counts.indexReads).toBeGreaterThan(0);
      });
      const older = await success(olderResponse);
      expect(older.value.first).toMatchObject({ padding: "key-move-in-actual-do" });
      const retainedNewer = await success(await invoke());
      expect(retainedNewer.value.first).toMatchObject({ padding: "while-old-query-held" });
      expect(retainedNewer.counts.indexReads).toBe(0);
      expect(retainedNewer.counts.refreshes).toBe(0);

      // This profile has no pinned transaction grant. A genuine active-head
      // publication invalidates the already admitted query through its actual gate.
      const withdrawnResponse = await withHeldQuery(activeRuntime(), "alpha", { operation: "probe", args }, async () => {
        await expect.poll(async () => Schema.decodeUnknownSync(Schema.Struct({ entered: Schema.Boolean }))(
          await (await request(activeRuntime(), "alpha/gate-status", {})).json(),
        ).entered, { timeout: 10_000 }).toBe(true);
        await fixture.moveHead();
      });
      const withdrawn = await failure(withdrawnResponse);
      expect(withdrawn.failure).toMatchObject({ kind: "typed", tag: "QueryInvocationError", reason: "unavailable",
        ownerTag: "ApplicationExecutionHostError", ownerReason: "readBoundaryFailed" });
      expect(withdrawn.spanFailures).toContainEqual({ span: "ApplicationQuerySnapshot.revalidateInTransaction",
        tag: "ApplicationActivationError", reason: "concurrentHead" });
      expect(withdrawn.counts.rowReads).toBe(0);
      const afterHeadChange = await success(await invoke());
      expect(afterHeadChange.counts.indexReads).toBeGreaterThan(0);

      const disconnectedResponse = await withHeldQuery(activeRuntime(), "alpha", { operation: "probe", args }, async () => {
        const gateSchema = Schema.Struct({ entered: Schema.Boolean, pid: Schema.NullOr(Schema.Int),
          applicationName: Schema.NullOr(Schema.String), errorEvents: Schema.Int });
        const readGate = async () => Schema.decodeUnknownSync(gateSchema)(
          await (await request(activeRuntime(), "alpha/gate-status", {})).json(),
        );
        await expect.poll(async () => (await readGate()).entered, { timeout: 10_000 }).toBe(true);
        const gate = await readGate();
        if (gate.pid === null || gate.applicationName === null) throw new Error("Held query did not expose its actual owned backend observation.");
        expect(gate.applicationName).toMatch(/^actual-query-do-[0-9a-f-]{36}$/);
        const victim = await activeOwner.persistence.query<{ pid: number; applicationName: string }>(
          `select pid,application_name as "applicationName" from pg_stat_activity
            where pid=$1 and application_name=$2 and usename=current_user and datname=current_database()`,
          [gate.pid, gate.applicationName],
        );
        expect(victim.rows).toEqual([{ pid: gate.pid, applicationName: gate.applicationName }]);
        const terminated = await activeOwner.persistence.query<{ terminated: boolean }>(
          `select pg_terminate_backend(pid) as terminated from pg_stat_activity
            where pid=$1 and application_name=$2 and usename=current_user and datname=current_database()`,
          [gate.pid, gate.applicationName],
        );
        expect(terminated.rows).toEqual([{ terminated: true }]);
        // The subclass counts emit() and delegates to the original emitter.
        // It installs no listener that could hide a missing production observer.
        await expect.poll(async () => (await readGate()).errorEvents, { timeout: 10_000 }).toBeGreaterThan(gate.errorEvents);
      });
      const disconnected = await failure(disconnectedResponse);
      expect(disconnected.failure).toMatchObject({ kind: "defect", tag: "QueryInvocationError", reason: "unavailable" });
      expect(disconnected.typedFailures).toContain("QueryInvocationError");
      expect(disconnected.defects).toContain("PostgreSQL connection failed during its owned client lifetime.");
      expect(disconnected.counts.rowReads).toBe(0);
      expect(disconnected.resources).toEqual({ constructed: 1, connected: 1, ended: 1 });
      const reconnected = await success(await invoke());
      expect(reconnected.counts.indexReads).toBeGreaterThan(0);
      expect(reconnected.value.first).toMatchObject({ padding: "while-old-query-held" });

      const betaResult = await success(await request(runtime, "beta/query", { operation: "probe", args: cacheArguments(beta) }));
      expect(betaResult.value.first).toMatchObject({ name: "Beta Bea" });
      expect(betaResult.counts.indexReads).toBeGreaterThan(0);
      expect((await success(await invoke())).value.first).toMatchObject({ name: "Cyra" });
      const wrong = await failure(await request(runtime, "wrong/query", { operation: "probe", args }));
      expect(wrong.failure).toMatchObject({ kind: "typed", tag: "QueryInvocationError" });
      expect(wrong.counts.rowReads).toBe(0);
      expect(wrong.counts.indexReads).toBe(0);

      const priorBoot = retainedNewer.boot;
      await runtime.dispose();
      runtime = undefined;
      await mutate("Dora", "saved-while-do-stopped");
      runtime = makeRuntime(worker, directory, configuration, betaConfiguration);
      const restarted = await success(await invoke());
      expect(restarted.boot).not.toBe(priorBoot);
      expect(restarted.value.first).toMatchObject({ name: "Dora", padding: "saved-while-do-stopped" });
      expect(restarted.counts.indexReads).toBeGreaterThan(0);
      expect(restarted.counts.refreshes).toBe(0);
      expect((await success(await invoke())).counts.indexReads).toBe(0);

      // Structural stale-authority injection in this disposable fixture, not
      // a production generation/takeover writer or a recovery protocol.
      // End at refusal; never roll the fence back to fabricate an old owner.
      const staleAuthorityResponse = await withHeldQuery(activeRuntime(), "alpha", { operation: "probe", args }, async () => {
        await expect.poll(async () => Schema.decodeUnknownSync(Schema.Struct({ entered: Schema.Boolean }))(
          await (await request(activeRuntime(), "alpha/gate-status", {})).json(),
        ).entered, { timeout: 10_000 }).toBe(true);
        const changed = await activeOwner.persistence.query<{ fence: string }>(
          `update fx_system_scope_execution_authority
              set storage_generation_fence=storage_generation_fence+1
            where scope_id=$1 returning storage_generation_fence::text as fence`,
          [fixture.authority.scopeId],
        );
        expect(changed.rows).toEqual([{ fence: (fixture.authority.storageGenerationFence + 1n).toString() }]);
      });
      const staleAuthority = await failure(staleAuthorityResponse);
      expect(staleAuthority.failure).toMatchObject({ kind: "typed", tag: "QueryInvocationError", reason: "unavailable",
        ownerTag: "ApplicationExecutionHostError", ownerReason: "readBoundaryFailed" });
      expect(staleAuthority.spanFailures).toContainEqual({ span: "ScopeExecution.runLocated",
        tag: "ScopeExecutionAuthorityError", reason: "storageGenerationFenceChanged" });
      expect(staleAuthority.counts.rowReads).toBe(0);
      expect(staleAuthority.counts.indexReads).toBe(0);

      // Separate disposable beta scope: retain a warm candidate, then make its
      // physical build unavailable. This is structural guard injection, not a
      // claimed production backfill/retirement writer or repaired generation.
      const betaArgs = cacheArguments(beta);
      await success(await request(runtime, "beta/query", { operation: "probe", args: betaArgs }));
      expect((await success(await request(runtime, "beta/query", { operation: "probe", args: betaArgs }))).counts.indexReads).toBe(0);
      const unavailableIndexResponse = await withHeldQuery(activeRuntime(), "beta", { operation: "probe", args: betaArgs }, async () => {
        await expect.poll(async () => Schema.decodeUnknownSync(Schema.Struct({ entered: Schema.Boolean }))(
          await (await request(activeRuntime(), "beta/gate-status", {})).json(),
        ).entered, { timeout: 10_000 }).toBe(true);
        const changed = await activeBetaOwner.persistence.query<{ definition: number }>(
          `update fx_system_index_build_state
              set lifecycle='validating',maintenance_activation_sequence=null,maintenance_authority_kind=null
            where scope_id=$1 returning index_definition_id as definition`,
          [beta.authority.scopeId],
        );
        expect(changed.rows.length).toBeGreaterThan(0);
      });
      const refusedIndex = await failure(unavailableIndexResponse);
      expect(refusedIndex.failure).toMatchObject({ kind: "typed", tag: "QueryInvocationError", reason: "unavailable",
        ownerTag: "ApplicationExecutionHostError", ownerReason: "readBoundaryFailed" });
      expect(refusedIndex.spanFailures).toContainEqual({ span: "ApplicationQuerySnapshot.readIndexInTransaction",
        tag: "ApplicationQuerySnapshotError", reason: "indexUnavailable" });
      expect(refusedIndex.counts.indexReads).toBe(0);
      expect(refusedIndex.counts.indexBodyReads).toBe(0);
    } catch (cause) {
      primaryFailure = { cause };
      throw cause;
    } finally {
      const releases = await Promise.allSettled([
        mutationLoader.dispose(), runtime?.dispose(), betaOwner?.dispose(), owner?.dispose(),
      ]);
      const cleanupErrors: unknown[] = [...stopProcessObservations(),
        ...releases.flatMap(release => release.status === "rejected" ? [release.reason] : [])];
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("flarex-query-do-host-")) {
        cleanupErrors.push(new Error("Unexpected query DO fixture resource directory."));
      } else {
        try { await rm(target, { recursive: true, force: true }); }
        catch (cause) { cleanupErrors.push(cause); }
      }
      if (cleanupErrors.length > 0) throw new AggregateError(
        primaryFailure === undefined ? cleanupErrors : [primaryFailure.cause, ...cleanupErrors], "Query DO fixture cleanup failed",
      );
    }
  }, 240_000);
});

function cacheArguments(fixture: Fixture) {
  const table = fixture.schemaAuthority.tables.find(candidate => candidate.logicalName === "users");
  if (table === undefined) throw new Error("Missing cache probe table.");
  const id = (rowId: typeof CACHE_ROW_A) => appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId });
  return { repeatId: id(CACHE_ROW_C), missingId: id(CACHE_ROW_MISSING), suffixId: id(CACHE_ROW_B),
    bounds: compileAppOrderedIndexBoundsV1({ spec: lowerAppDeveloperOrderedIndexPhysicalSpecV1(
      decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({ kind: "developerOrdered", specVersion: 1, fields: ["name"] })),
      expressions: [{ op: "eq", field: appOrderedIndexDocumentPathV1(decodeSchemaManifestAppIndexFieldPath("name")),
        value: orderedIndexValueFromFlarexValueV1("Ada") }] }) };
}

async function makeMutation(fixture: Fixture, loader: MiniflareApplicationWorkerLoader, id: string) {
  const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
  let sequence = 0;
  return async (name: string, padding: string) => {
    const ordinal = ++sequence;
    return runtimeContext.run(`native-mutation-${ordinal}`, async () => {
      lifecycle("mutation-start", { ordinal });
      try {
        const result = await Effect.runPromise(Effect.scoped(invokeApplicationMutation(
          TransactionFunctionPathV1Schema.make("users:renameCacheProbe"), { id, name, padding },
          TransactionRequestKeyV1Schema.make(`actual-query-do:${ordinal}`),
        ).pipe(Effect.provide(layer))));
        expect(result.disposition).toBe("published");
      } finally {
        lifecycle("mutation-finished", { ordinal });
      }
    });
  };
}

function request(runtime: Miniflare, path: string, body: unknown, signal?: AbortSignal) {
  return runtime.dispatchFetch(`https://query-do.test/${path}`, { method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }) });
}

async function withHeldQuery(runtime: Miniflare, profile: "alpha" | "beta", body: unknown, work: () => Promise<void>) {
  lifecycle("held-query-start", { profile });
  const controller = new AbortController();
  const held = Promise.allSettled([request(runtime, `${profile}/hold`, body, controller.signal)] as const);
  const [primary] = await Promise.allSettled([Promise.resolve().then(work)] as const);
  lifecycle("held-work-settled", { profile, status: primary.status,
    message: primary.status === "rejected" && primary.reason instanceof Error ? primary.reason.message : null });
  const [release] = await Promise.allSettled([(async () => {
    const response = await request(runtime, `${profile}/release`, {});
    const text = await response.text();
    expect(response.status, text).toBe(200);
  })()] as const);
  if (release.status === "rejected") controller.abort(release.reason);
  const [joined] = await held;
  lifecycle("held-cleanup-settled", { profile, release: release.status, held: joined.status });
  const failures: unknown[] = [];
  if (primary.status === "rejected") failures.push(primary.reason);
  if (release.status === "rejected") failures.push(release.reason);
  if (joined.status === "rejected") failures.push(joined.reason);
  if (failures.length !== 0) throw new AggregateError(failures, `Held ${profile} query and cleanup failed.`);
  if (joined.status !== "fulfilled") throw new Error("Held query settlement was not retained.");
  return joined.value;
}

async function success(response: Awaited<ReturnType<typeof request>>) {
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const body = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(text);
  expect(body, text).toMatchObject({ ok: true });
  const envelope = Schema.decodeUnknownSync(SuccessResponse)(body);
  const value = normalizeFlarexValueV1(envelope.value).value;
  const validator = inspectFunctionReference(USERS_CACHE_REFERENCE).returnsValidator;
  if (validator === null) throw new Error("Missing authored probe validator.");
  Result.getOrThrow(validateValidatorValueV1(validator, value, { path: "$response", idPolicy: { mode: "shapeOnly" } }));
  // SAFETY: the same authoritative authored validator accepted this canonical value.
  const typed = value as ProbeValue;
  const boot = response.headers.get("x-query-do-boot");
  expect(boot).toMatch(/^[0-9a-f-]{36}$/);
  return { ...envelope, value: typed, boot };
}

async function failure(response: Awaited<ReturnType<typeof request>>) {
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return Schema.decodeUnknownSync(Schema.fromJsonString(FailureResponse))(text);
}

function makeRuntime(worker: string, directory: string, configuration: string, betaConfiguration: string) {
  const connectionString = postgresUrl;
  if (connectionString === null) throw new Error("Actual DO query fixture requires PostgreSQL.");
  const label = `actual-query-owner-${++runtimeSequence}`;
  return runtimeContext.run(label, () => new ObservedQueryMiniflare({
    modules: [{ type: "ESModule", path: "worker.js", contents: worker }],
    compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
    bindings: { QUERY_CONFIGURATION: configuration, QUERY_BETA_CONFIGURATION: betaConfiguration, FLAREX_EXECUTOR_TOKEN: TOKEN },
    hyperdrives: { HYPERDRIVE_CACHE_DISABLED: connectionString },
    workerLoaders: { LOADER: {} },
    r2Buckets: ["ARTIFACTS"], r2Persist: join(directory, "r2"),
    durableObjectsPersist: join(directory, "do"),
    durableObjects: { QUERIES: { className: "ApplicationQueryFixtureDO", useSQLite: true },
      BETA_QUERIES: { className: "ApplicationQueryBetaFixtureDO", useSQLite: true },
      WRONG_QUERIES: { className: "WrongApplicationQueryFixtureDO", useSQLite: true },
      UPLOADS: { className: "ApplicationQuerySourceUploadDO", useSQLite: true } },
  } satisfies MiniflareOptions, label));
}

function lifecycle(phase: string, detail: Readonly<Record<string, unknown>> = {}): void {
  if (lifecycleObservations++ >= 160) return;
  console.info("QUERY_DO_RUNTIME_LIFECYCLE", JSON.stringify({ phase, context: runtimeContext.getStore() ?? null, ...detail }));
}

function observeQueryFixtureProcesses(): () => readonly unknown[] {
  const decode = Schema.decodeUnknownResult(Schema.Struct({ process: Schema.instanceOf(ChildProcess) }));
  const detach: Array<() => void> = [];
  const failures: unknown[] = [];
  const observe = (message: unknown) => {
    const result = decode(message);
    if (Result.isFailure(result)) { failures.push(result.failure); return; }
    const child = result.success.process;
    if (!/(^|[\\/])workerd(?:\.exe)?$/i.test(child.spawnfile)) return;
    const context = runtimeContext.getStore() ?? "unlabelled-workerd";
    const source = new Error("workerd process creation").stack?.split("\n").slice(1, 9).join("\n") ?? null;
    const spawned = () => { lifecycle("process-spawn", { owner: context, pid: child.pid ?? null,
      file: basename(child.spawnfile), source }); };
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      lifecycle("process-exit", { owner: context, pid: child.pid ?? null, code, signal, killed: child.killed });
    };
    const errored = (cause: Error) => {
      failures.push(cause);
      lifecycle("process-error", { owner: context, pid: child.pid ?? null, message: cause.message });
    };
    child.once("spawn", spawned);
    child.once("exit", exited);
    child.on("error", errored);
    detach.push(() => { child.off("spawn", spawned); child.off("exit", exited); child.off("error", errored); });
  };
  // Node's legacy constructor channel fires before spawnfile is assigned.
  // This public tracing event runs after assignment and before native spawn.
  subscribe("tracing:child_process.spawn:start", observe);
  return () => {
    unsubscribe("tracing:child_process.spawn:start", observe);
    for (const close of detach) close();
    return [...failures, ...stdioFailures];
  };
}

class ObservedQueryMiniflare extends Miniflare {
  readonly #label: string;
  readonly #detachStdio: Array<() => void>;
  constructor(options: MiniflareOptions, label: string) {
    const detach: Array<() => void> = [];
    super({ ...options, handleRuntimeStdio(stdout, stderr) {
      for (const [channel, stream] of [["stdout", stdout], ["stderr", stderr]] as const) {
        const ended = () => { lifecycle("stdio-end", { owner: label, channel }); };
        const closed = () => { lifecycle("stdio-close", { owner: label, channel }); };
        const errored = (cause: Error) => {
          stdioFailures.push(cause);
          lifecycle("stdio-error", { owner: label, channel, message: cause.message });
        };
        stream.once("end", ended);
        stream.once("close", closed);
        stream.once("error", errored);
        // Preserve Miniflare's normal line output while observing its public hook.
        const lines = createInterface(stream);
        lines.on("line", line => { if (channel === "stdout") console.log(line); else console.error(line); });
        detach.push(() => {
          stream.off("end", ended); stream.off("close", closed); stream.off("error", errored); lines.close();
        });
      }
    } });
    this.#label = label;
    this.#detachStdio = detach;
  }
  override async dispose(): Promise<void> {
    lifecycle("dispose-requested", { owner: this.#label,
      source: new Error("owned runtime disposal").stack?.split("\n").slice(1, 8).join("\n") ?? null });
    try { await super.dispose(); }
    finally {
      for (const detach of this.#detachStdio) detach();
      lifecycle("dispose-finished", { owner: this.#label });
    }
  }
}

async function bundleWorker() {
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
  const workspaceResolution: Plugin = { name: "actual-query-do-workspace-resolution", resolveId(id) {
    if (id.startsWith("@flarex/") || id === "flarex-backend" || id.startsWith("flarex-backend/")
      || id === "flarex-protocol" || id.startsWith("flarex-protocol/")) return fileURLToPath(import.meta.resolve(id));
    return undefined;
  } };
  const output = await build({ configFile: false, logLevel: "silent", plugins: [workspaceResolution],
    // pg-cloudflare@1.4.0 intentionally exports an empty module without this
    // declared condition. The bundle executes in workerd, not a browser host.
    resolve: { conditions: ["workerd", ...defaultClientConditions] },
    build: { write: false, target: "es2022", lib: { entry: fileURLToPath(new URL("./applicationQueryDO.workerd.worker.ts", import.meta.url)),
      formats: ["es"], fileName: "worker" }, rolldownOptions: {
      external: id => id.startsWith("cloudflare:") || builtins.has(id),
      output: {
        // pg's external CommonJS builtins use workerd's native module loader.
        // The pinned June runtime lacks import.meta.url; this is the emitted entry.
        banner: 'import { createRequire as createRuntimeRequire } from "node:module";\nconst require = createRuntimeRequire("file:///worker.js");',
      },
    } } });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => "output" in result ? result.output : []);
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (worker === undefined || worker.type !== "chunk") throw new Error("Missing actual DO query fixture bundle.");
  return worker.code;
}
