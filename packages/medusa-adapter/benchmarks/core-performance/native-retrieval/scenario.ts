import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Session } from "node:inspector/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Effect, Schema } from "effect";
import { Pool } from "pg";
import ts from "@typescript/typescript6";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProductStatus } from "@medusajs/framework/utils/portable";
import { ProductModuleService } from "@medusajs/product/services";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import type NativeProductModuleService from "../../../../../third_party/medusa/upstream/packages/modules/product/dist/services/product-module-service";
import { moduleIntegrationTestRunner as nativeRunner } from "./native-runner";
import {
  mikroOrmModuleTestPersistenceAdapter,
} from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter";
import {
  productIntegrationTestRunner,
  getLogicalProductRunnerFixture,
} from "../../../test/support/logical-product-runner";
import {
  makeCommerceReadHost,
} from "../../../../persistence-postgres/src/frameworks/commerceTransaction/read/host";
import {
  logicalCommerceBatchResources,
} from "../../../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { nativeRetrievalRelevantDemand } from "./fixtures";
import {
  observeNativeRetrievalService,
  observePromotedRetrievalPrototype,
  observeRetrievalPgClients,
  observeRetrievalAcceptingComponents,
  observeRetrievalPgProtocol,
  destroyIdleRetrievalPoolClients,
  prepareNativeRetrievalConnectionReset,
  type RetrievalComponentSpan,
  type RetrievalObservation,
  type RetrievalProtocolObservation,
} from "./observation";
import {
  openRetrievalServerObserver,
  readRetrievalRuntimeSettings,
  retrievalServerDifference,
  requireRetrievalServerObservedCalls,
  selectRetrievalServerDatabases,
  type RetrievalDatabaseIdentity,
} from "./server";

const root = new URL("../../../../../", import.meta.url);
const output = new URL("./", import.meta.url);
const mode = Schema.decodeUnknownSync(Schema.Literals(["quiet", "trace", "server", "cpu"]))(process.env.NATIVE_RETRIEVAL_MODE ?? "quiet");
let cpuSession: Session | undefined;
const componentSpans = Schema.decodeUnknownSync(Schema.Literals(["0", "1"]))(
  process.env.NATIVE_RETRIEVAL_COMPONENT_SPANS ?? "0") === "1";
const coldPoolClient = Schema.decodeUnknownSync(Schema.Literals(["0", "1"]))(
  process.env.NATIVE_RETRIEVAL_COLD_POOL_CLIENT ?? "0") === "1";
const managedRead = Schema.decodeUnknownSync(Schema.Literals(["0", "1"]))(
  process.env.NATIVE_RETRIEVAL_MANAGED_READ ?? "0") === "1";
const coldPreparation = Schema.decodeUnknownSync(Schema.Literals(["0", "1"]))(
  process.env.NATIVE_RETRIEVAL_COLD_PREPARATION ?? "0") === "1";
if (coldPreparation && !managedRead) throw new Error("Cold preparation requires the managed read profile");
const protocolTracing = Schema.decodeUnknownSync(Schema.Literals(["0", "1"]))(
  process.env.NATIVE_RETRIEVAL_PROTOCOL ?? "0") === "1";
if (protocolTracing && mode !== "trace") throw new Error("Protocol observation requires separate trace mode");
const decodeCount = Schema.decodeUnknownSync(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 10_000 })));
const metadataAxis = process.env.NATIVE_RETRIEVAL_METADATA_AXIS;
if (metadataAxis === undefined && process.env.NATIVE_RETRIEVAL_METADATA_COUNT !== undefined)
  throw new Error("Metadata count requires an explicit metadata axis");
const metadataScale = metadataAxis === undefined ? undefined : {
  axis: Schema.decodeUnknownSync(Schema.Literals(["tables", "indexes", "relations", "otherSourceDefinitions"]))(metadataAxis),
  count: Schema.decodeUnknownSync(Schema.Literals([1, 100]))(decodeCount(process.env.NATIVE_RETRIEVAL_METADATA_COUNT ?? "1")),
};
const relevantCount = process.env.NATIVE_RETRIEVAL_RELEVANT_COUNT === undefined ? undefined
  : Schema.decodeUnknownSync(Schema.Literals([1, 10, 100]))(decodeCount(process.env.NATIVE_RETRIEVAL_RELEVANT_COUNT));
const warmups = decodeCount(process.env.NATIVE_RETRIEVAL_WARMUPS ?? "5");
const sampleCount = decodeCount(process.env.NATIVE_RETRIEVAL_SAMPLES ?? (mode === "quiet" ? "100" : "1"));
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
interface RetrievalCase {
  readonly name: string;
  readonly operation: "retrieve" | "list";
  readonly config: FindConfig<ProductTypes.ProductDTO>;
  readonly filters?: { readonly id: string[] };
  readonly id?: string;
  readonly expected: unknown;
}
const relevantSeed = relevantCount === undefined ? undefined : nativeRetrievalRelevantDemand(relevantCount, "scalar");
const cases: readonly RetrievalCase[] = relevantCount === undefined ? [
  { name: "scalar", operation: "retrieve", config: scalarConfig, expected: seed },
  { name: "collection", operation: "retrieve", config: collectionConfig, expected: { id: seed.id, title: seed.title,
    handle: seed.handle, collection_id: collection.id, collection: { id: collection.id, title: collection.title } } },
] : (["scalar", "collection"] as const).map(name => {
  const demand = nativeRetrievalRelevantDemand(relevantCount, name);
  return { name, operation: "list", config: demand.config, filters: demand.filters, expected: demand.expected };
});
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
  protocol?: readonly RetrievalProtocolObservation[];
  coldPoolReset?: { readonly destroyedConnections: readonly number[]; readonly elapsedMs: number };
  acceptingComponents?: readonly RetrievalComponentSpan[];
  acceptingComponentObservationError?: ReturnType<typeof errorSummary>;
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
let nativeInstance: NativeProductModuleService | undefined;
let flarexSetupStarted = 0;
let server: Awaited<ReturnType<typeof openRetrievalServerObserver>> | undefined;
let selectedDatabaseIdentities: readonly RetrievalDatabaseIdentity[] | undefined;
const runtimeSettings: Partial<Record<Lane | "flarexControl", Awaited<ReturnType<typeof readRetrievalRuntimeSettings>>>> = {};
const runtimeSettingsAfter: typeof runtimeSettings = {};
let runtimeStable: boolean | undefined;
let sourcesBefore: Awaited<ReturnType<typeof sourceEvidence>> | undefined;
let activeStage: "bootstrap" | "runtimeSettings" | "publicSeed" | "parity" | "nativeMissingErrors" | "measurement" | "runtimeSettingsAfter" = "bootstrap";
let measurementComplete = false;
let metadataEvidence: Pick<ReturnType<typeof getLogicalProductRunnerFixture>["currency"], "metadataCounts" | "metadataScaling"> | undefined;

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

function nativeManager(service: NativeProductModuleService): object {
  const base: unknown = Reflect.get(service, "baseRepository_");
  if (base === null || typeof base !== "object") throw new Error("Missing native base repository for settings");
  const getManager: unknown = Reflect.get(base, "getFreshManager");
  if (typeof getManager !== "function") throw new Error("Missing native manager accessor");
  const manager: unknown = Reflect.apply(getManager, base, []);
  if (manager === null || typeof manager !== "object") throw new Error("Missing actual native manager");
  return manager;
}

const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
async function sourceEvidence() {
  const paths = [
    "third_party/medusa/SOURCE.json",
    "pnpm-lock.yaml",
    "packages/medusa-adapter/package.json",
    "third_party/medusa/upstream/pnpm-lock.yaml",
    "packages/medusa-product/src/services/product-module-service.ts",
    "third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts",
    "third_party/medusa/upstream/packages/core/utils/src/modules-sdk/medusa-internal-service.ts",
    "third_party/medusa/upstream/packages/core/utils/src/dal/mikro-orm/mikro-orm-repository.ts",
    "packages/medusa-adapter/src/product-commands/reads.ts",
    "packages/medusa-adapter/src/product-module.ts",
    "packages/medusa-adapter/test/support/logical-product-runner.ts",
    "packages/medusa-adapter/test/support/logical-currency-fixture.ts",
    "packages/medusa-adapter/test/support/logical-product-fixture.ts",
    "packages/persistence-postgres/test/storage/documents/logicalReadMetadataScalingTestSupport.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/fixtures.ts",
    "packages/medusa-adapter/src/commerce-module.ts",
    "packages/medusa-adapter/src/module-definition.ts",
    "packages/medusa-adapter/src/product-module.ts",
    "packages/persistence-postgres/test/application/applicationNativeMutationTestFixture.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/scenario.ts",
    "packages/medusa-adapter/vitest.native-retrieval.config.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/observation.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/tsconfig.json",
    "third_party/medusa/upstream/packages/modules/product/dist/index.js",
    "third_party/medusa/upstream/packages/modules/product/dist/services/product-module-service.js",
    "third_party/medusa/upstream/packages/modules/product/dist/repositories/product.js",
    "third_party/medusa/upstream/packages/modules/link-modules/dist/index.js",
    "third_party/medusa/upstream/packages/medusa-test-utils/src/module-test-runner.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/native-runner.ts",
    "third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-runner.js",
    "third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter.js",
    "third_party/medusa/upstream/packages/medusa-test-utils/dist/init-modules.js",
    "third_party/medusa/upstream/packages/medusa-test-utils/dist/database.js",
    "packages/medusa-product/dist/services/product-module-service.js",
    "packages/medusa-utils/src/modules-sdk/medusa-internal-service.ts",
    "packages/medusa-utils/dist/modules-sdk/medusa-internal-service.js",
    "packages/medusa-utils/package.json",
    "packages/medusa-utils/tsconfig.json",
    "packages/medusa-product/package.json",
    "packages/medusa-product/tsconfig.json",
    "tools/medusa/tsconfig.fork.json",
    "third_party/medusa/upstream/node_modules/pg-god/node_modules/tslib/tslib.js",
    "third_party/medusa/upstream/node_modules/pg-god/node_modules/tslib/package.json",
    "packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts",
    "packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalAdmission.ts",
    "packages/persistence-postgres/src/storage/documents/logicalDocuments/documentAdmission.ts",
    "packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts",
    "packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts",
    "packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalQuery.ts",
    "packages/persistence-postgres/src/storage/documents/logicalDocuments/indexReads.ts",
    "packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts",
    "packages/persistence-postgres/src/application/activation/acceptedBinding.ts",
    "packages/persistence-postgres/src/application/activation/activationPersistence.ts",
    "packages/persistence-postgres/src/application/activation/activeRead.ts",
    "packages/persistence-postgres/src/application/activation/bindingAcceptance.ts",
    "packages/persistence-postgres/src/application/activation/bindingPreparation.ts",
    "packages/persistence-postgres/src/application/activation/capture.ts",
    "packages/persistence-postgres/src/application/activation/constructionContracts.ts",
    "packages/persistence-postgres/src/application/activation/contracts.ts",
    "packages/persistence-postgres/src/application/activation/currentBinding.ts",
    "packages/persistence-postgres/src/application/activation/currentEntryIdentity.ts",
    "packages/persistence-postgres/src/application/activation/databaseBoundary.ts",
    "packages/persistence-postgres/src/application/activation/errors.ts",
    "packages/persistence-postgres/src/application/activation/finiteIdentity.ts",
    "packages/persistence-postgres/src/application/activation/finitePreparation.ts",
    "packages/persistence-postgres/src/application/activation/headCapture.ts",
    "packages/persistence-postgres/src/application/activation/limits.ts",
    "packages/persistence-postgres/src/application/activation/metadataProjection.ts",
    "packages/persistence-postgres/src/application/activation/readBindingPublication.ts",
    "packages/persistence-postgres/src/application/activation/repository.ts",
    "packages/persistence-postgres/src/application/activation/repositoryIdentity.ts",
    "packages/persistence-postgres/src/application/activation/selectionIdentity.ts",
    "packages/persistence-postgres/src/application/activation/standaloneBinding.ts",
    "packages/persistence-postgres/src/application/applicationActivationApi.ts",
    "packages/persistence-postgres/src/application/activeHead/contracts.ts",
    "packages/persistence-postgres/src/application/activeHead/errors.ts",
    "packages/persistence-postgres/src/application/activeHead/identity.ts",
    "packages/persistence-postgres/src/application/readiness/acceptance.ts",
    "packages/persistence-postgres/src/application/readiness/activationTarget.ts",
    "packages/persistence-postgres/src/application/readiness/bundle.ts",
    "packages/persistence-postgres/src/application/readiness/coldEvidence.ts",
    "packages/persistence-postgres/src/application/readiness/constructionContracts.ts",
    "packages/persistence-postgres/src/application/readiness/contracts.ts",
    "packages/persistence-postgres/src/application/readiness/controlSchema.ts",
    "packages/persistence-postgres/src/application/readiness/databaseBoundary.ts",
    "packages/persistence-postgres/src/application/readiness/errors.ts",
    "packages/persistence-postgres/src/application/readiness/frames.ts",
    "packages/persistence-postgres/src/application/readiness/identity.ts",
    "packages/persistence-postgres/src/application/readiness/limits.ts",
    "packages/persistence-postgres/src/application/readiness/outcomes.ts",
    "packages/persistence-postgres/src/application/readiness/persistence.ts",
    "packages/persistence-postgres/src/application/readiness/physicalCoverage.ts",
    "packages/persistence-postgres/src/application/readiness/preparation.ts",
    "packages/persistence-postgres/src/application/readiness/repository.ts",
    "packages/persistence-postgres/src/application/readiness/storedAuthority.ts",
    "packages/persistence-postgres/src/application/relations/applicationRelationReadinessFold.ts",
    "packages/persistence-postgres/src/application/applicationActiveHeadRead.ts",
    "packages/persistence-postgres/src/application/applicationBindingProjection.ts",
    "packages/persistence-postgres/src/installation/physicalDefinitionLifecycle.ts",
    "packages/persistence-postgres/src/execution/preparation/preparedHostRuntime.ts",
    "packages/persistence-postgres/src/execution/preparation/preparedMetadataEpoch.ts",
    "packages/persistence-postgres/src/execution/exactRunningAttemptTail.ts",
    "packages/persistence-postgres/src/frameworks/commerceTransaction/admission.ts",
    "packages/persistence-postgres/src/installation/frameworkSchema/binding/repository.ts",
    "packages/persistence-postgres/src/installation/frameworkSchema/installation/runtime.ts",
    "packages/persistence-postgres/src/frameworks/commerceTransaction/host.ts",
    "packages/persistence-postgres/src/frameworks/commerceTransaction/borrowedLogicalAttempt.ts",
    "packages/medusa-adapter/src/query/read.ts",
    "packages/medusa-adapter/src/commerce-relations.ts",
    "packages/persistence-postgres/src/storage/documents/appRows.ts",
    "packages/persistence-postgres/src/database/postgres.ts",
    "packages/persistence-postgres/src/execution/transactionSessionAttemptKernel.ts",
    "packages/persistence-postgres/drizzle/meta/_journal.json",
  ];
  if (managedRead) paths.push("packages/persistence-postgres/src/installation/installationLifecycle.ts",
    "packages/persistence-postgres/src/database/postgresInstallationMaintenance.ts",
    "packages/persistence-postgres/src/application/applicationStandaloneBinding.ts",
    "packages/persistence-postgres/src/storage/documents/standaloneReadTransaction.ts",
    "packages/persistence-postgres/src/storage/documents/standaloneReadSnapshot.ts",
    "packages/persistence-postgres/src/storage/documents/logicalReadMetadata.ts",
    "packages/persistence-postgres/src/storage/documents/logicalDocuments/readAdmission.ts",
    "packages/persistence-postgres/src/frameworks/commerceTransaction/read/host.ts",
    "packages/persistence-postgres/src/frameworks/commerceTransaction/read/configuration.ts");
  const sources = await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, root)) })));
  const methodNames = ["retrieveProduct", "getProductFindConfig_", "buildVariantImagesFromProduct",
    ...(relevantCount === undefined ? [] : ["listProducts"])];
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
      afterModuleInit: async (_app, service) => {
        nativeInstance = service;
        setup.nativeSchemaAndModuleConstructionMs = performance.now() - nativeSetupStarted;
      } },
    testSuite: ({ service: native, withFreshModule }) => {
      const useNative = <T>(work: (service: NativeProductModuleService) => Promise<T>) => coldPreparation
        ? withFreshModule(work) : work(native);
      productIntegrationTestRunner({ moduleName: "product", testSuite: ({ service: flarex }) => {
        beforeAll(async () => {
          setup.flarexFixtureAndHostConstructionMs = performance.now() - flarexSetupStarted;
        });
        afterAll(async () => {
          try {
            const sourcesAfter = await sourceEvidence();
            const sourceStable = sourcesBefore !== undefined && JSON.stringify(sourcesAfter) === JSON.stringify(sourcesBefore);
            const settings = { mode, componentSpans, coldPoolClient, managedRead, coldPreparation, protocolTracing, warmups, sampleCount, concurrency: 1, nativeDatabase,
              metadataScale, relevantCount, metadataEvidence,
              preparationProfile: coldPreparation ? "actual native module init/read/shutdown and new managed Flarex host/read/close charged per request; installed schema and shared pools retained" : "retained hosts",
              logicalDatabase: runtimeSettings.flarex?.database ?? "unavailable", selectedDatabaseIdentities,
              node: process.version, platform: process.platform, architecture: process.arch,
              nativeLifetime: coldPreparation ? "fresh real native module per callback over the runner-owned shared Knex connection" : "existing MikroORM module and per-call injected manager; no benchmark-owned context",
              flarexLifetime: "existing standalone CommerceHost.read with actual fresh request lifetime",
              flarexPhysicalConnectionProfile: coldPoolClient ? "coldPoolClient; target/control idle clients destroyed outside request, connect/authentication and first Parse inside request" : "existing retained pools",
              nativePhysicalConnectionProfile: coldPoolClient ? "idle Knex sockets destroyed and empty pool reinitialized outside request; connect/authentication inside request" : "existing retained pool",
              protocolCoverage: protocolTracing ? "actual pg Connection method submissions; values and SQL bodies omitted; not server completion or wire bytes" : "unavailable; protocol observation disabled",
              diagnosticConnectionSettings: server?.settings ?? "unavailable in this mode", runtimeSettings, runtimeSettingsAfter,
              diagnosticObserverIdentity: server?.observerIdentity ?? "unavailable in this mode",
              serverStatementCoverage: server?.coverage ?? "unavailable in this mode",
              nestedServerCoverage: mode === "server" ? "all executing roles in selected isolated databases; inspect track=all rows and external auto_explain log" : "unavailable",
              functionTriggerCoverage: "unavailable unless separate server logs observe it" };
            await mkdir(output, { recursive: true });
            const label = process.env.NATIVE_RETRIEVAL_RUN_LABEL ?? new Date().toISOString().replaceAll(":", "-");
            if (!/^[a-zA-Z0-9_.-]+$/.test(label)) throw new Error("Invalid retrieval evidence label");
            if (cpuSession !== undefined) {
              const { profile } = await cpuSession.post("Profiler.stop");
              cpuSession.disconnect();
              cpuSession = undefined;
              await writeFile(new URL(`${mode}-${label}.cpuprofile`, output), JSON.stringify(profile), { flag: "wx" });
            }
            await writeFile(new URL(`${mode}-${label}.json`, output), JSON.stringify({
              sourcesBefore, sourcesAfter, checkpoint: process.env.NATIVE_RETRIEVAL_CHECKPOINT ?? "unavailable; source hashes recorded",
              status: measurementComplete ? (sourceStable ? "measurementPassed" : "sourceDriftFailed") : `${activeStage}Failed`,
              activeStage, runtimeStable, parityPassed: activeStage === "nativeMissingErrors" || activeStage === "measurement" || activeStage === "runtimeSettingsAfter",
              observedSuccessfulRetrievals: parityResults.length + samples.filter(sample => sample.outcome === "success").length,
              settings, settingsSha256: hash(JSON.stringify(settings)), seed, collection,
              cases, relevantSeed, setup, parityResults, missingErrors, samples,
              notes: ["All raw samples retained; assertions and diagnostic encoding are outside quiet intervals.",
                "Optional component spans include tracer overhead; nested inclusive span distributions are not additive and unobserved spans are not zero-duration proof.",
                "Server diagnostics include instrumentation overhead and are separate from quiet latency.",
                "Query JSON bytes are not network wire bytes. Inclusive call or parent/nested server times are not additive."] }, null, 2), { flag: "wx" });
            if (sourcesBefore !== undefined) expect(sourcesAfter).toStrictEqual(sourcesBefore);
          } finally { cpuSession?.disconnect(); await server?.close(); }
        });
        it("preserves complete scalar and collection DTOs, native errors and raw paired samples", async () => {
          activeStage = "runtimeSettings";
          sourcesBefore = await sourceEvidence();
          const fixture = getLogicalProductRunnerFixture();
          metadataEvidence = { metadataCounts: fixture.currency.metadataCounts, metadataScaling: fixture.currency.metadataScaling };
          let resetNativeConnections: (() => Promise<number>) | undefined;
          const captureRuntimeSettings = async () => ({
            native: await useNative(async service => {
              const manager = nativeManager(service);
              resetNativeConnections ??= prepareNativeRetrievalConnectionReset(manager);
              const execute: unknown = Reflect.get(manager, "execute");
              if (typeof execute !== "function") throw new Error("Missing actual native manager.execute");
              return readRetrievalRuntimeSettings(async sql => Reflect.apply(execute, manager, [sql]));
            }),
            flarex: await readRetrievalRuntimeSettings(async sql => (await fixture.currency.persistence.query(sql)).rows),
            flarexControl: await readRetrievalRuntimeSettings(async sql =>
              (await (fixture.currency.managedRead?.control ?? fixture.currency.control).query(sql)).rows),
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
          await useNative(async service => {
            if (relevantSeed === undefined) {
              await service.createProductCollections(collection);
              await service.createProducts({ ...seed, collection_id: collection.id });
            } else {
              await service.createProductCollections(relevantSeed.collections);
              await service.createProducts(relevantSeed.products);
            }
          });
          setup.nativePublicSeedMs = performance.now() - seedStarted;
          const flarexSeedStarted = performance.now();
          if (relevantSeed === undefined) {
            await flarex.createProductCollections(collection);
            await flarex.createProducts({ ...seed, collection_id: collection.id });
          } else {
            await flarex.createProductCollections(relevantSeed.collections);
            await flarex.createProducts(relevantSeed.products);
          }
          setup.flarexPublicSeedMs = performance.now() - flarexSeedStarted;
          const { product, reader } = getLogicalProductRunnerFixture();
          const retrieve = (lane: Lane, demand: RetrievalCase,
            components?: ReturnType<typeof observeRetrievalAcceptingComponents>, observations?: RetrievalObservation[]) => lane === "native"
            ? useNative(async service => {
              const observedService = coldPreparation ? service : nativeInstance;
              if (observations !== undefined && observedService === undefined)
                throw new Error("Missing actual native service for warm observation");
              const restore = observations === undefined || observedService === undefined ? undefined : observeNativeRetrievalService(observedService, observations,
                demand.operation === "retrieve" ? "retrieveProduct" : "listProducts");
              try {
                if (demand.operation === "retrieve") return await service.retrieveProduct(demand.id ?? seed.id, structuredClone(demand.config));
                if (demand.filters === undefined) throw new Error("Missing relevant Product selection");
                return await service.listProducts(structuredClone(demand.filters), structuredClone(demand.config));
              } finally { restore?.(); }
            })
            : Effect.runPromise(Effect.gen(function* () {
              if (coldPreparation && product.managedReadHostInput === undefined)
                return yield* Effect.fail(new Error("Missing managed host input"));
              const selectedReader = coldPreparation
                && product.managedReadHostInput !== undefined ? yield* makeCommerceReadHost({ ...product.managedReadHostInput,
                  logicalResources: logicalCommerceBatchResources })
                : reader;
              return yield* Effect.gen(function* () {
                const config = { select: [...(demand.config.select ?? [])], relations: [...(demand.config.relations ?? [])] };
                if (demand.operation === "retrieve") return yield* selectedReader.read(product.runtime.commands.retrieve,
                  { id: demand.id ?? seed.id, config });
                if (demand.filters === undefined || relevantCount === undefined)
                  return yield* Effect.fail(new Error("Missing relevant Product selection"));
                return yield* selectedReader.read(product.runtime.commands.list,
                  { filters: { id: [...demand.filters.id] }, config: { ...config, order: { id: "ASC" }, take: relevantCount } });
              }).pipe(Effect.ensuring(coldPreparation ? selectedReader.close : Effect.void));
            }).pipe(
                components === undefined ? effect => effect : Effect.withTracer(components.tracer)));
          activeStage = "parity";
          for (const demand of cases) {
            const nativeResult = await retrieve("native", demand);
            parityResults.push({ demand: demand.name, lane: "native", result: nativeResult });
            const flarexResult = await retrieve("flarex", demand);
            parityResults.push({ demand: demand.name, lane: "flarex", result: flarexResult });
            expect(nativeResult).toStrictEqual(demand.expected);
            expect(flarexResult).toStrictEqual(nativeResult);
          }
          activeStage = "nativeMissingErrors";
          for (const lane of ["native", "flarex"] as const) {
            try { await retrieve(lane, { name: "missing", operation: "retrieve", id: "prod_native_missing", config: scalarConfig,
              expected: undefined }); throw new Error("Missing product unexpectedly succeeded"); }
            catch (cause) { missingErrors[lane] = errorSummary(cause); }
          }
          expect(missingErrors.native?.type).toBe("not_found");
          expect(missingErrors.flarex?.type).toBe(missingErrors.native?.type);
          expect(missingErrors.flarex?.message).toBe(missingErrors.native?.message);
          activeStage = "measurement";
          if (mode === "cpu") {
            cpuSession = new Session();
            cpuSession.connect();
            await cpuSession.post("Profiler.enable");
            await cpuSession.post("Profiler.start");
          }
          for (const demand of cases) for (let index = -warmups; index < sampleCount; index++) {
            const order: readonly Lane[] = index % 2 === 0 ? ["native", "flarex"] : ["flarex", "native"];
            for (const lane of order) {
              const observations: RetrievalObservation[] = [];
              const protocol: RetrievalProtocolObservation[] = [];
              let coldPoolReset: Sample["coldPoolReset"];
              if (coldPoolClient) {
                const resetStarted = performance.now();
                const pools = lane === "native" ? [] : [fixture.currency.persistence,
                  fixture.currency.managedRead?.control ?? fixture.currency.control].map(owner => {
                  if (!("pool" in owner) || !(owner.pool instanceof Pool)) throw new Error("Cold retrieval requires actual PostgreSQL fixture pools");
                  return owner.pool;
                });
                const destroyedConnections: number[] = [];
                if (lane === "native") {
                  if (resetNativeConnections === undefined) throw new Error("Missing actual native shared connection reset");
                  destroyedConnections.push(await resetNativeConnections());
                }
                for (const pool of new Set(pools)) destroyedConnections.push(await destroyIdleRetrievalPoolClients(pool));
                coldPoolReset = { destroyedConnections, elapsedMs: performance.now() - resetStarted };
              }
              const components = componentSpans && lane === "flarex" ? observeRetrievalAcceptingComponents() : undefined;
              const cleanups: Array<() => void> = [];
              const before = server === undefined || index < 0 ? undefined : await server.snapshot();
              try {
                if (mode === "trace" && index >= 0) {
                  cleanups.push(observeRetrievalPgClients(observations));
                  if (protocolTracing) cleanups.push(observeRetrievalPgProtocol(protocol));
                  if (lane === "flarex") cleanups.push(observePromotedRetrievalPrototype(ProductModuleService.prototype, observations,
                    demand.operation === "retrieve" ? "retrieveProduct" : "listProducts"));
                }
                const started = performance.now();
                let result: unknown;
                try {
                  result = await retrieve(lane, demand, components, mode === "trace" && index >= 0 ? observations : undefined);
                } catch (cause) {
                  const elapsedMs = performance.now() - started;
                  const sample: Sample = { lane, demand: demand.name, sample: index, warmup: index < 0,
                    elapsedMs, outcome: "failure", error: errorSummary(cause),
                    ...(mode === "trace" && index >= 0 ? { observations, ...(protocolTracing ? { protocol } : {}) } : {}),
                    ...(coldPoolReset === undefined ? {} : { coldPoolReset }) };
                  samples.push(sample);
                  if (components !== undefined) {
                    try { sample.acceptingComponents = components.snapshot(); }
                    catch (observationError) { sample.acceptingComponentObservationError = errorSummary(observationError); }
                  }
                  throw cause;
                }
                const sample: Sample = { lane, demand: demand.name, sample: index, warmup: index < 0,
                  elapsedMs: performance.now() - started, outcome: "success", result,
                  ...(mode === "trace" && index >= 0 ? { observations, ...(protocolTracing ? { protocol } : {}) } : {}),
                  ...(coldPoolReset === undefined ? {} : { coldPoolReset }) };
                samples.push(sample);
                if (components !== undefined) {
                  try { sample.acceptingComponents = components.snapshot(); }
                  catch (observationError) {
                    sample.acceptingComponentObservationError = errorSummary(observationError);
                    throw observationError;
                  }
                  const observed = sample.acceptingComponents;
                  if (managedRead) {
                    expect(observed.filter(span => span.name === "ApplicationActivation.withStandaloneBinding" &&
                      span.outcome === "success")).toHaveLength(1);
                    for (const name of ["StandaloneReadTransaction.enter", "LogicalReadMetadata.authenticateAndRegister",
                      "PreparedMetadataEpoch.acceptFinalBatch"]) {
                      expect(observed.filter(span => span.name === name && span.outcome === "success")).toHaveLength(1);
                    }
                    if (!coldPreparation) expect(observed.filter(span => span.name === "LogicalReadMetadata.checkCurrent"))
                      .toHaveLength(0);
                  } else {
                    expect(observed.filter(span => (span.name === "ApplicationActivation.validateBindingBasisOwned" ||
                      span.name === "ApplicationActivation.withPreparedBindingBasis") && span.outcome === "success")).toHaveLength(1);
                    expect(observed.filter(span => span.name === "ApplicationReadiness.validateStoredIssuedReadiness" &&
                      span.outcome === "success")).toHaveLength(1);
                  }
                }
                // Preserve the complete DTO after EVERY invocation. No post-hoc projection.
                expect(result).toStrictEqual(demand.expected);
                if (protocolTracing && index >= 0) {
                  expect(protocol.filter(entry => entry.method === "query" || entry.method === "execute"))
                    .toHaveLength(observations.filter(entry => entry.kind === "sql").length);
                  expect(protocol.every(entry => entry.outcome === "returned")).toBe(true);
                  if (lane === "flarex") {
                    if (managedRead) {
                      const entries = observations.filter(entry => entry.kind === "sql" && entry.label.includes("fx_accept_finite_placement_frontier"));
                      expect(entries).toHaveLength(1);
                      const entry = entries[0];
                      if (entry === undefined) throw new Error("Missing named standalone entry statement");
                      const expectedName = `fx_sr_${hash(entry.label).slice(0, 56)}`;
                      const binds = protocol.filter(value => value.method === "bind" && value.statementName?.startsWith("fx_sr_"));
                      expect(binds).toHaveLength(1);
                      expect(binds[0]?.statementName).toBe(expectedName);
                      const parses = protocol.filter(value => value.method === "parse" && value.statementName?.startsWith("fx_sr_"));
                      expect(parses).toHaveLength(coldPoolClient ? 1 : 0);
                      for (const value of parses) {
                        expect(value.statementName).toBe(expectedName);
                        expect(value.sqlSha256).toBe(hash(entry.label));
                      }
                    }
                    const names = new Set(protocol.filter(entry => entry.method === "bind" &&
                      entry.statementName?.startsWith("fx_pm_")).map(entry => entry.statementName));
                    if (!managedRead) expect(names.size).toBe(2);
                    const parsed = protocol.filter(entry => entry.method === "parse" && entry.statementName?.startsWith("fx_pm_"));
                    for (const entry of parsed) expect(entry.statementName).toBe(`fx_pm_${entry.sqlSha256?.slice(0, 56)}`);
                    if (coldPoolClient && !managedRead) expect(parsed).toHaveLength(2);
                  }
                }
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
      } }, { protectedRuntime: true, managedRead, ...(metadataScale === undefined ? {} : { readMetadataScale: metadataScale }) });
    },
  });
});
