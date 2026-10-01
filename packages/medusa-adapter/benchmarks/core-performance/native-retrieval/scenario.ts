import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Effect, Schema } from "effect";
import ts from "@typescript/typescript6";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProductStatus } from "@medusajs/framework/utils/portable";
import { ProductModuleService } from "@medusajs/product/services";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import type NativeProductModuleService from "../../../../../third_party/medusa/upstream/packages/modules/product/dist/services/product-module-service";
import { moduleIntegrationTestRunner as nativeRunner } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-runner";
import { mikroOrmModuleTestPersistenceAdapter } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter";
import { productIntegrationTestRunner, getLogicalProductRunnerFixture } from "../../../test/support/logical-product-runner";
import { observeNativeRetrievalService, observePromotedRetrievalPrototype,
  observeRetrievalPgClients, type RetrievalObservation } from "./observation";
import { openRetrievalServerObserver, readRetrievalRuntimeSettings, retrievalServerDifference,
  requireRetrievalServerObservedCalls, selectRetrievalServerDatabases, type RetrievalDatabaseIdentity } from "./server";

const root = new URL("../../../../../", import.meta.url);
const output = new URL("./", import.meta.url);
const mode = Schema.decodeUnknownSync(Schema.Literals(["quiet", "trace", "server"]))(process.env.NATIVE_RETRIEVAL_MODE ?? "quiet");
const decodeCount = Schema.decodeUnknownSync(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 10_000 })));
const warmups = decodeCount(process.env.NATIVE_RETRIEVAL_WARMUPS ?? "5");
const sampleCount = decodeCount(process.env.NATIVE_RETRIEVAL_SAMPLES ?? (mode === "quiet" ? "30" : "1"));
if (sampleCount === 0) throw new Error("Retrieval requires at least one sample");
const nativeDatabase = process.env.NATIVE_RETRIEVAL_DATABASE;
if (nativeDatabase === undefined || !/^[a-zA-Z0-9_]+$/.test(nativeDatabase))
  throw new Error("NATIVE_RETRIEVAL_DATABASE must name the isolated existing native database");
const flarexUrl = process.env.FLAREX_POSTGRES_DATABASE_URL;
if (flarexUrl === undefined) throw new Error("Missing isolated Flarex PostgreSQL URL");
const seed = { id: "prod_native_compare", title: "Native retrieval", handle: "native-retrieval",
  status: ProductStatus.PUBLISHED, discountable: true, is_giftcard: false };
const collection = { id: "pcol_native_compare", title: "Native collection", handle: "native-collection" };
const scalarConfig: FindConfig<ProductTypes.ProductDTO> = {
  select: ["id", "title", "handle", "status", "discountable", "is_giftcard"], relations: [],
};
const collectionConfig: FindConfig<ProductTypes.ProductDTO> = {
  select: ["id", "title", "handle", "collection.id", "collection.title"], relations: ["collection"],
};
const cases = [
  { name: "scalar", config: scalarConfig, expected: seed },
  { name: "collection", config: collectionConfig, expected: { id: seed.id, title: seed.title,
    handle: seed.handle, collection_id: collection.id, collection: { id: collection.id, title: collection.title } } },
] as const;
type Lane = "native" | "flarex";
interface Sample {
  lane: Lane;
  demand: string;
  sample: number;
  warmup: boolean;
  elapsedMs: number;
  outcome: "success" | "failure";
  result?: unknown;
  error?: { name: string; message: string; type?: string };
  observations?: readonly RetrievalObservation[];
  server?: ReturnType<typeof retrievalServerDifference>;
  serverSnapshots?: {
    before: Awaited<ReturnType<Awaited<ReturnType<typeof openRetrievalServerObserver>>["snapshot"]>>;
    after: Awaited<ReturnType<Awaited<ReturnType<typeof openRetrievalServerObserver>>["snapshot"]>>;
  };
}
const samples: Sample[] = [];
const parityResults: Array<{ demand: string; lane: Lane; result: unknown }> = [];
const setup: Record<string, number> = {};
const missingErrors: Partial<Record<Lane, { name: string; message: string; type?: string }>> = {};
let nativeSetupStarted = 0;
let flarexSetupStarted = 0;
let server: Awaited<ReturnType<typeof openRetrievalServerObserver>> | undefined;
let selectedDatabaseIdentities: readonly RetrievalDatabaseIdentity[] | undefined;
const runtimeSettings: Partial<Record<Lane | "flarexControl", Awaited<ReturnType<typeof readRetrievalRuntimeSettings>>>> = {};
const runtimeSettingsAfter: typeof runtimeSettings = {};
let runtimeStable: boolean | undefined;
let sourcesBefore: Awaited<ReturnType<typeof sourceEvidence>> | undefined;
let nativeInstance: NativeProductModuleService | undefined;
let activeStage: "bootstrap" | "runtimeSettings" | "publicSeed" | "parity" | "nativeMissingErrors" | "measurement" | "runtimeSettingsAfter" = "bootstrap";
let measurementComplete = false;

// Error summaries are an explicit diagnostic projection. Exact native type and
// message are asserted separately, including wrapped Commerce adapter causes.
function errorSummary(cause: unknown): { name: string; message: string; type?: string } {
  if (cause !== null && typeof cause === "object" && "reason" in cause &&
    cause.reason === "adapterFailure" && "cause" in cause) return errorSummary(cause.cause);
  const type = cause !== null && typeof cause === "object" && "type" in cause && typeof cause.type === "string"
    ? cause.type : undefined;
  return { name: cause instanceof Error ? cause.name : "NonError",
    message: cause instanceof Error ? cause.message : String(cause),
    ...(type === undefined ? {} : { type }) };
}

const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
async function sourceEvidence() {
  const paths = ["third_party/medusa/SOURCE.json", "pnpm-lock.yaml", "packages/medusa-adapter/package.json",
    "third_party/medusa/upstream/pnpm-lock.yaml", "packages/medusa-product/src/services/product-module-service.ts",
    "third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts",
    "third_party/medusa/upstream/packages/core/utils/src/modules-sdk/medusa-internal-service.ts",
    "third_party/medusa/upstream/packages/core/utils/src/dal/mikro-orm/mikro-orm-repository.ts",
    "packages/medusa-adapter/src/product-commands/reads.ts", "packages/medusa-adapter/src/product-module.ts",
    "packages/medusa-adapter/test/support/logical-product-runner.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/scenario.ts", "packages/medusa-adapter/vitest.native-retrieval.config.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/observation.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/tsconfig.json",
    "third_party/medusa/upstream/packages/modules/product/dist/index.js",
    "third_party/medusa/upstream/packages/modules/product/dist/services/product-module-service.js",
            "third_party/medusa/upstream/packages/modules/product/dist/repositories/product.js",
    "third_party/medusa/upstream/packages/modules/link-modules/dist/index.js",
    "third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-runner.js",
    "third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter.js",
    "third_party/medusa/upstream/packages/medusa-test-utils/dist/init-modules.js",
    "third_party/medusa/upstream/packages/medusa-test-utils/dist/database.js",
    "packages/medusa-product/dist/services/product-module-service.js",
    "packages/medusa-utils/src/modules-sdk/medusa-internal-service.ts",
    "packages/medusa-utils/dist/modules-sdk/medusa-internal-service.js",
    "packages/medusa-utils/package.json", "packages/medusa-utils/tsconfig.json",
    "packages/medusa-product/package.json", "packages/medusa-product/tsconfig.json",
    "tools/medusa/tsconfig.fork.json",
    "third_party/medusa/upstream/node_modules/pg-god/node_modules/tslib/tslib.js",
    "third_party/medusa/upstream/node_modules/pg-god/node_modules/tslib/package.json",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts",
    "packages/persistence-postgres/src/logicalDocuments/relationalQuery.ts",
    "packages/persistence-postgres/src/logicalDocuments/indexReads.ts",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts",
    "packages/persistence-postgres/src/commerceTransaction/host.ts",
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts",
    "packages/medusa-adapter/src/query/read.ts", "packages/medusa-adapter/src/commerce-relations.ts",
    "packages/persistence-postgres/src/appRows.ts", "packages/persistence-postgres/src/postgres.ts",
    "packages/persistence-postgres/src/transactionSessionAttemptKernel.ts",
    "packages/persistence-postgres/drizzle/meta/_journal.json"];
  const sources = await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, root)) })));
  const methodNames = ["retrieveProduct", "getProductFindConfig_", "buildVariantImagesFromProduct"];
  const methodHashes = sources.filter(source => source.path.endsWith("/product-module-service.ts")).map(source => {
    const parsed = ts.createSourceFile(source.path, source.bytes.toString("utf8"), ts.ScriptTarget.Latest, true);
    const methods: Record<string, string> = {};
    const visit = (node: ts.Node) => {
      if (ts.isMethodDeclaration(node) && node.body !== undefined && methodNames.includes(node.name.getText(parsed)))
        methods[node.name.getText(parsed)] = hash(node.body.getText(parsed));
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    return { path: source.path, methods };
  });
  for (const name of methodNames) {
    const native = methodHashes[0]?.methods[name];
    const promoted = methodHashes[1]?.methods[name];
    if (native === undefined || promoted === undefined || native !== promoted)
      throw new Error(`Retrieval source parity changed for ${name}`);
  }
  const requirePinned = createRequire(new URL("third_party/medusa/upstream/packages/medusa-test-utils/package.json", root));
  const nativePgExport = requirePinned.resolve("@medusajs/framework/pg");
  const nativeDepsPg = createRequire(nativePgExport).resolve("@medusajs/deps/pg");
  const nativeDriver = createRequire(nativeDepsPg).resolve("pg");
  const requirePromoted = createRequire(import.meta.url);
  const promotedDriver = requirePromoted.resolve("pg");
  const executingPromotedProduct = requirePromoted.resolve("@medusajs/product/services");
  const executingPromotedInternalService = requirePromoted.resolve("@medusajs/utils/modules-sdk/medusa-internal-service");
  const drivers = await Promise.all([nativePgExport, nativeDepsPg, nativeDriver, promotedDriver,
    executingPromotedProduct, executingPromotedInternalService].map(async path => ({
    path, sha256: hash(await readFile(path)),
  })));
  return { files: sources.map(source => ({ path: source.path, sha256: hash(source.bytes) })), drivers, methodHashes,
    construction: "pinned native MikroORM constructor versus promoted Flarex constructor; selected method-body parity" };
}

describe("paired genuine native Product retrieval", () => {
  beforeAll(() => { flarexSetupStarted = performance.now(); });
  beforeEach(() => { nativeSetupStarted = performance.now(); });
  nativeRunner<NativeProductModuleService>({ moduleName: "product", dbName: nativeDatabase, schema: "native_retrieval",
    resolve: fileURLToPath(new URL("third_party/medusa/upstream/packages/modules/product", root)),
    persistenceAdapter: mikroOrmModuleTestPersistenceAdapter,
    hooks: { beforeModuleInit: async () => { setup.nativeSchemaPreparationMs = performance.now() - nativeSetupStarted; },
      afterModuleInit: async (_app, instance) => {
        nativeInstance = instance;
        setup.nativeSchemaAndModuleConstructionMs = performance.now() - nativeSetupStarted;
      } },
    testSuite: ({ service: native }) => {
      productIntegrationTestRunner({ moduleName: "product", testSuite: ({ service: flarex }) => {
        beforeAll(async () => {
          setup.flarexFixtureAndHostConstructionMs = performance.now() - flarexSetupStarted;
        });
        afterAll(async () => {
          try {
            const sourcesAfter = await sourceEvidence();
            const sourceStable = sourcesBefore !== undefined && JSON.stringify(sourcesAfter) === JSON.stringify(sourcesBefore);
            const settings = { mode, warmups, sampleCount, concurrency: 1, nativeDatabase,
              logicalDatabase: runtimeSettings.flarex?.database ?? "unavailable", selectedDatabaseIdentities,
              node: process.version, platform: process.platform, architecture: process.arch,
              nativeLifetime: "existing MikroORM module and per-call injected manager; no benchmark-owned context",
              flarexLifetime: "existing standalone CommerceHost.read with actual fresh request lifetime",
              diagnosticConnectionSettings: server?.settings ?? "unavailable in this mode", runtimeSettings, runtimeSettingsAfter,
              diagnosticObserverIdentity: server?.observerIdentity ?? "unavailable in this mode",
              serverStatementCoverage: server?.coverage ?? "unavailable in this mode",
              nestedServerCoverage: mode === "server" ? "all executing roles in selected isolated databases; inspect track=all rows and external auto_explain log" : "unavailable",
              functionTriggerCoverage: "unavailable unless separate server logs observe it" };
            await mkdir(output, { recursive: true });
            const label = process.env.NATIVE_RETRIEVAL_RUN_LABEL ?? new Date().toISOString().replaceAll(":", "-");
            if (!/^[a-zA-Z0-9_.-]+$/.test(label)) throw new Error("Invalid retrieval evidence label");
            await writeFile(new URL(`${mode}-${label}.json`, output), JSON.stringify({
              sourcesBefore, sourcesAfter, checkpoint: process.env.NATIVE_RETRIEVAL_CHECKPOINT ?? "unavailable; source hashes recorded",
              status: measurementComplete ? (sourceStable ? "measurementPassed" : "sourceDriftFailed") : `${activeStage}Failed`,
              activeStage, runtimeStable, parityPassed: activeStage === "nativeMissingErrors" || activeStage === "measurement" || activeStage === "runtimeSettingsAfter",
              observedSuccessfulRetrievals: parityResults.length + samples.filter(sample => sample.outcome === "success").length,
              settings, settingsSha256: hash(JSON.stringify(settings)), seed, collection,
              cases, setup, parityResults, missingErrors, samples,
              notes: ["All raw samples retained; assertions and diagnostic encoding are outside quiet intervals.",
                "Server diagnostics include instrumentation overhead and are separate from quiet latency.",
                "Query JSON bytes are not network wire bytes. Inclusive call or parent/nested server times are not additive."] }, null, 2), { flag: "wx" });
            if (sourcesBefore !== undefined) expect(sourcesAfter).toStrictEqual(sourcesBefore);
          } finally { await server?.close(); }
        });
        it("preserves complete scalar and collection DTOs, native errors and raw paired samples", async () => {
          activeStage = "runtimeSettings";
          sourcesBefore = await sourceEvidence();
          const base: unknown = Reflect.get(native, "baseRepository_");
          if (base === null || typeof base !== "object") throw new Error("Missing native base repository for settings");
          const getManager: unknown = Reflect.get(base, "getFreshManager");
          if (typeof getManager !== "function") throw new Error("Missing native manager accessor");
          const manager: unknown = Reflect.apply(getManager, base, []);
          if (manager === null || typeof manager !== "object") throw new Error("Missing actual native manager");
          const execute: unknown = Reflect.get(manager, "execute");
          if (typeof execute !== "function") throw new Error("Missing actual native manager.execute");
          const fixture = getLogicalProductRunnerFixture();
          const captureRuntimeSettings = async () => ({
            native: await readRetrievalRuntimeSettings(async sql => Reflect.apply(execute, manager, [sql])),
            flarex: await readRetrievalRuntimeSettings(async sql => (await fixture.currency.persistence.query(sql)).rows),
            flarexControl: await readRetrievalRuntimeSettings(async sql => (await fixture.currency.control.query(sql)).rows),
          });
          Object.assign(runtimeSettings, await captureRuntimeSettings());
          if (runtimeSettings.native === undefined || runtimeSettings.flarex === undefined || runtimeSettings.flarexControl === undefined)
            throw new Error("Missing authenticated retrieval database identities");
          selectedDatabaseIdentities = selectRetrievalServerDatabases(nativeDatabase, runtimeSettings.native,
            runtimeSettings.flarex, runtimeSettings.flarexControl);
          for (const [label, runtime] of Object.entries(runtimeSettings)) {
            const tracking = runtime.settings["pg_stat_statements.track"];
            if (tracking?.status !== "observed")
              throw new Error(`Unavailable ${label} effective PostgreSQL tracking mode`);
            if (tracking.value !== (mode === "server" ? "all" : "none"))
              throw new Error(`Unexpected ${label} effective PostgreSQL tracking mode`);
            const logging = runtime.settings["auto_explain.log_min_duration"];
            if (mode !== "server" && logging?.status === "observed" && logging.value !== "-1")
              throw new Error(`Unexpected ${label} auto_explain logging in ${mode} lane`);
          }
          const nativeSettings = runtimeSettings.native?.settings;
          if (nativeSettings === undefined) throw new Error("Missing native runtime settings");
          for (const [label, runtime] of Object.entries(runtimeSettings))
            for (const name of ["server_version", "fsync", "synchronous_commit", "full_page_writes", "pg_stat_statements.track"]) {
              const actual = runtime.settings[name];
              const reference = nativeSettings[name];
              if (actual?.status !== "observed" || reference?.status !== "observed")
                throw new Error(`Unavailable ${label} required PostgreSQL setting ${name}`);
              if (actual.value !== reference.value)
                throw new Error(`Mismatched ${label} PostgreSQL setting ${name}`);
            }
          if (mode === "server") {
            const diagnosticUrl = process.env.NATIVE_RETRIEVAL_DIAGNOSTIC_URL;
            if (diagnosticUrl === undefined) throw new Error("Server diagnostics require a separate diagnostic URL");
            server = await openRetrievalServerObserver(diagnosticUrl, selectedDatabaseIdentities);
          }
          activeStage = "publicSeed";
          const seedStarted = performance.now();
          await native.createProductCollections(collection);
          await native.createProducts({ ...seed, collection_id: collection.id });
          setup.nativePublicSeedMs = performance.now() - seedStarted;
          const flarexSeedStarted = performance.now();
          await flarex.createProductCollections(collection);
          await flarex.createProducts({ ...seed, collection_id: collection.id });
          setup.flarexPublicSeedMs = performance.now() - flarexSeedStarted;
          const { product, reader } = getLogicalProductRunnerFixture();
          const retrieve = (lane: Lane, id: string, config: FindConfig<ProductTypes.ProductDTO>) => lane === "native"
            ? native.retrieveProduct(id, structuredClone(config))
            : Effect.runPromise(reader.read(product.runtime.commands.retrieve,
              { id, config: { select: [...(config.select ?? [])], relations: [...(config.relations ?? [])] } }));
          activeStage = "parity";
          for (const demand of cases) {
            const nativeResult = await retrieve("native", seed.id, demand.config);
            parityResults.push({ demand: demand.name, lane: "native", result: nativeResult });
            const flarexResult = await retrieve("flarex", seed.id, demand.config);
            parityResults.push({ demand: demand.name, lane: "flarex", result: flarexResult });
            expect(nativeResult).toStrictEqual(demand.expected);
            expect(flarexResult).toStrictEqual(nativeResult);
          }
          activeStage = "nativeMissingErrors";
          for (const lane of ["native", "flarex"] as const) {
            try { await retrieve(lane, "prod_native_missing", scalarConfig); throw new Error("Missing product unexpectedly succeeded"); }
            catch (cause) { missingErrors[lane] = errorSummary(cause); }
          }
          expect(missingErrors.native?.type).toBe("not_found");
          expect(missingErrors.flarex?.type).toBe(missingErrors.native?.type);
          expect(missingErrors.flarex?.message).toBe(missingErrors.native?.message);
          activeStage = "measurement";
          for (const demand of cases) for (let index = -warmups; index < sampleCount; index++) {
            const order: readonly Lane[] = index % 2 === 0 ? ["native", "flarex"] : ["flarex", "native"];
            for (const lane of order) {
              const observations: RetrievalObservation[] = [];
              const cleanups: Array<() => void> = [];
              const before = server === undefined || index < 0 ? undefined : await server.snapshot();
              try {
                if (mode === "trace" && index >= 0) {
                  cleanups.push(observeRetrievalPgClients(observations));
                  if (nativeInstance === undefined) throw new Error("Missing actual native Product instance for observation");
                  cleanups.push(lane === "native" ? observeNativeRetrievalService(nativeInstance, observations)
                    : observePromotedRetrievalPrototype(ProductModuleService.prototype, observations));
                }
                const started = performance.now();
                let result: unknown;
                try {
                  result = await retrieve(lane, seed.id, demand.config);
                  samples.push({ lane, demand: demand.name, sample: index, warmup: index < 0,
                    elapsedMs: performance.now() - started, outcome: "success", result,
                    ...(mode === "trace" && index >= 0 ? { observations } : {}) });
                } catch (cause) {
                  samples.push({ lane, demand: demand.name, sample: index, warmup: index < 0,
                    elapsedMs: performance.now() - started, outcome: "failure", error: errorSummary(cause),
                    ...(mode === "trace" && index >= 0 ? { observations } : {}) });
                  throw cause;
                }
                // Preserve the complete DTO after EVERY invocation. No post-hoc projection.
                expect(result).toStrictEqual(demand.expected);
              } finally {
                for (const close of cleanups.toReversed()) close();
                if (before !== undefined && server !== undefined) {
                  const last = samples.at(-1);
                  if (last !== undefined) {
                    const after = await server.snapshot();
                    last.serverSnapshots = { before, after };
                    last.server = retrievalServerDifference(before, after);
                    if (last.outcome === "success") {
                      const database = runtimeSettings[lane];
                      if (database === undefined) throw new Error("Missing authenticated sample database identity");
                      requireRetrievalServerObservedCalls(database, last.server);
                    }
                  }
                }
              }
            }
          }
          activeStage = "runtimeSettingsAfter";
          Object.assign(runtimeSettingsAfter, await captureRuntimeSettings());
          runtimeStable = true;
          for (const lane of ["native", "flarex", "flarexControl"] as const) {
            const before = runtimeSettings[lane];
            const after = runtimeSettingsAfter[lane];
            // Pools may use a different connection; PID remains raw evidence
            // while role/database authority and effective settings must match.
            if (before === undefined || after === undefined || before.database !== after.database ||
              before.role !== after.role || before.dbid !== after.dbid || before.userid !== after.userid ||
              !isDeepStrictEqual(before.settings, after.settings)) runtimeStable = false;
          }
          if (!runtimeStable) throw new Error("Retrieval runtime identity or settings changed during measurement");
          measurementComplete = true;
        });
      } }, { protectedRuntime: true });
    },
  });
});
