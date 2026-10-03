import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { expect } from "vitest";
import { ProductStatus } from "@medusajs/framework/utils/portable";
import type { IProductModuleService } from "@medusajs/framework/types";
import type { CommerceTransactionError } from "../../../../persistence-postgres/src/commerceTransaction/model";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { PrivateProductAttemptExecution } from "../../../src/product-attempt";
import { productAttemptSeed } from "../../../test/support/product-attempt-seed";
import { createMixedMutationPerformanceTrace, type TraceDispatchRecord, type TraceInvocationRecord } from "../../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import { prepareMixedMutationPerformanceSeries } from "../../../../flarex-backend/test/support/mixedMutationProductFixture";
import { makeNativeProductOperationDiagnostics } from "../../../../flarex-backend/test/support/nativeProductOperationDiagnostics";
import { observeRetrievalPgClients, type RetrievalObservation } from "../native-retrieval/observation";
import { readRetrievalRuntimeSettings, openRetrievalServerObserver, retrievalServerDifference,
  selectRetrievalServerDatabases, requireRetrievalServerObservedCalls } from "../native-retrieval/server";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const sources = ["packages/medusa-adapter/benchmarks/core-performance/mixed-native-read/scenario.ts",
  "packages/flarex-backend/test/support/mixedMutationProductFixture.ts",
  "packages/flarex-backend/test/support/nativeProductOperationDiagnostics.ts",
  "packages/persistence-postgres/src/preparedHostRuntime.ts",
  "packages/persistence-postgres/test/mixedMutationPerformanceTrace.ts",
  "packages/persistence-postgres/test/logicalReadMetadataScalingTestSupport.ts",
  "packages/persistence-postgres/src/scopeAuthorityControlRead.ts",
  "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts",
  "packages/persistence-postgres/src/applicationActivation.ts",
  "packages/persistence-postgres/src/applicationBindingProjection.ts",
  "packages/persistence-postgres/src/applicationActiveHeadRead.ts",
  "packages/persistence-postgres/src/logicalDocuments/workingSet.ts",
  "packages/persistence-postgres/src/logicalStorageReadiness.ts",
  "packages/persistence-postgres/src/logicalSearchBuild.ts",
  "packages/persistence-postgres/src/sessionJournalStore.ts",
  "packages/persistence-postgres/src/transactionSessionActivation.ts",
  "packages/persistence-postgres/src/transactionSessionReadSyscallKernel.ts",
  "packages/persistence-postgres/src/logicalReadMetadata.ts",
  "packages/persistence-postgres/src/preparedMetadataEpoch.ts",
  "packages/persistence-postgres/src/installationLifecycle.ts",
  "packages/medusa-adapter/src/product-attempt.ts"] as const;
const sourceHashes = async () => Object.fromEntries(await Promise.all(sources.map(async path =>
  [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")] as const)));
const Count = Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 30 }));
type Branch = "hit" | "miss";
type DecodedResults = Readonly<{ dispatches: number; returnedRowCount: number;
  decodedResultJsonUtf8Bytes: number; unknownResultEncodingDispatches: number }>;
interface Sample {
  readonly branch: Branch; readonly sample: number; readonly warmup: boolean; readonly nativeFirst: boolean;
  readonly nativeMs: number; readonly finiteOperationMs: number; readonly finiteRequestMs: number;
  readonly nativeResult: unknown; readonly finiteResult: unknown;
  readonly nativeError: ReturnType<typeof errorSummary> | null;
  readonly finiteError: ReturnType<typeof errorSummary> | null;
  readonly nativeSql: readonly RetrievalObservation[] | null;
  readonly finiteTrace: TraceInvocationRecord | null;
  readonly nativeServer: ReturnType<typeof retrievalServerDifference> | null;
  readonly finiteServer: ReturnType<typeof retrievalServerDifference> | null;
  readonly finiteOperationServer: ReturnType<typeof retrievalServerDifference> | null;
  readonly sourcePreparationUsage: Readonly<{ beforeRequestBytes: number; beforeOperationBytes: number;
    afterOperationBytes: number; afterRequestBytes: number }> | null;
  readonly methodDecodedResults: DecodedResults | null;
  readonly methodMetadataDecodedResults: DecodedResults | null;
  readonly methodBusinessDecodedResults: DecodedResults | null;
}

/** Diagnostic projection only; the entire native error remains in the Exit.
 * The commerce owner deliberately retains it as adapterFailure.cause. */
function errorSummary(error: unknown): { name: string; message: string; type?: string } {
  if (error !== null && typeof error === "object" && "reason" in error && error.reason === "adapterFailure" && "cause" in error)
    return errorSummary(error.cause);
  return { name: error instanceof Error ? error.name : "NonError",
    message: error instanceof Error ? error.message : String(error),
    ...(error !== null && typeof error === "object" && "type" in error && typeof error.type === "string" ? { type: error.type } : {}) };
}

/** Generated timestamps differ between independently authoritative stores.
 * Validate both complete DTOs and all timestamp fields, then compare all
 * remaining field values and exact structure. Reports retain original DTOs. */
function comparableDto(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableDto);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]: [string, unknown]) => {
    if ((key === "created_at" || key === "updated_at") && entry !== null) {
      const text = entry instanceof Date ? entry.toISOString() : entry;
      expect(typeof text).toBe("string");
      expect(Number.isFinite(Date.parse(String(text)))).toBe(true);
      expect(new Date(String(text)).toISOString()).toBe(text);
      return [key, "<generated-valid-timestamp>"];
    }
    return [key, comparableDto(entry)];
  }));
}

function distribution(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)], minMs: sorted[0], maxMs: sorted.at(-1) };
}

const authorityStatement = /fx_system_(?:scope_clock|data_binding_head|application_active_head|index_build_state|prepared_metadata_epoch|installation(?:_runtime)?|tx_session|snapshot_lease|tx_journal|tx_execution_claim)\b|fx_lock_(?:installation_admission|read_scope_placement|prepared_metadata_epoch|running_attempt_tail)\b|fx_control_scope(?:_provisioning)?\b/;
const businessStatement = /fx_app_(?:row|index|unique|search|relation)/;
function decodedResults(dispatches: readonly TraceDispatchRecord[]): DecodedResults {
  return { dispatches: dispatches.length,
    returnedRowCount: dispatches.reduce((sum, dispatch) => sum + (dispatch.returnedRowCount ?? 0), 0),
    decodedResultJsonUtf8Bytes: dispatches.reduce((sum, dispatch) => sum + (dispatch.decodedResultJsonUtf8Bytes ?? 0), 0),
    unknownResultEncodingDispatches: dispatches.filter(dispatch => dispatch.returnedRowCount == null ||
      dispatch.decodedResultJsonUtf8Bytes == null).length };
}

function requireProtectedServerWork(statements: ReturnType<typeof retrievalServerDifference>) {
  for (const [owner, pattern] of [
    ["installation", /\bfx_system_installation\b/],
    ["placement", /\bfx_control_scope\b/],
    ["placement receipt", /\bfx_control_scope_provisioning\b/],
    ["journal tail", /\bfx_system_tx_journal\b/],
    ["execution claim tail", /\bfx_system_tx_execution_claim\b/],
    ["protected metadata tail", /\bfx_system_prepared_metadata_epoch\b/],
  ] as const) {
    if (!statements.some(statement => !statement.toplevel && statement.calls > 0 && pattern.test(statement.query)))
      throw new Error(`Missing observed nested finite ${owner} server work`);
  }
}

export async function runMixedNativeReadPerformanceScenario(native: Pick<IProductModuleService,
  "retrieveProduct" | "createProducts" | "createProductTags" | "createProductCategories">, nativeModuleSetupMs: number) {
  const mode = Schema.decodeUnknownSync(Schema.Literals(["quiet", "trace", "server"]))(process.env.FLAREX_MIXED_NATIVE_READ_MODE ?? "quiet");
  const managedRead = true;
  const count = Schema.decodeUnknownSync(Count)(process.env.FLAREX_MIXED_NATIVE_READ_SAMPLES ?? (mode === "quiet" ? "30" : "2"));
  const warmups = Schema.decodeUnknownSync(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 5 })))(
    process.env.FLAREX_MIXED_NATIVE_READ_WARMUPS ?? (mode === "quiet" ? "3" : "0"));
  const attemptCount = count + warmups;
  const axis = process.env.FLAREX_MIXED_NATIVE_READ_METADATA_AXIS;
  const readMetadataScale = axis === undefined ? undefined : {
    profile: "finite" as const,
    axis: Schema.decodeUnknownSync(Schema.Literals(["tables", "indexes", "relations", "otherSourceDefinitions"]))(axis),
    count: Schema.decodeUnknownSync(Schema.Literals([1, 100]))(Schema.decodeUnknownSync(Schema.NumberFromString)(
      process.env.FLAREX_MIXED_NATIVE_READ_METADATA_COUNT ?? "1")),
  };
  const label = Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{1,60}$/)))(
    process.env.FLAREX_MIXED_NATIVE_READ_LABEL ?? "mixed-read-baseline");
  const before = await sourceHashes();
  const samples: Sample[] = [];
  const setup = [];
  const base: unknown = Reflect.get(native, "baseRepository_");
  if (base === null || typeof base !== "object") throw new Error("Missing actual native repository for runtime settings");
  const fresh: unknown = Reflect.get(base, "getFreshManager");
  if (typeof fresh !== "function") throw new Error("Missing actual native manager accessor");
  const manager: unknown = Reflect.apply(fresh, base, []);
  if (manager === null || typeof manager !== "object") throw new Error("Missing actual native manager");
  const execute: unknown = Reflect.get(manager, "execute");
  if (typeof execute !== "function") throw new Error("Missing actual native manager settings query");
  const nativeSettings = await readRetrievalRuntimeSettings(async sql => Reflect.apply(execute, manager, [sql]));
  for (const branch of ["hit", "miss"] as const) {
    let observed: { exit: Exit.Exit<PrivateProductAttemptExecution, CommerceTransactionError>; elapsedMs: number } | undefined;
    const suffix = `${label}-${branch}`;
    const setupStart = performance.now();
    let server: Awaited<ReturnType<typeof openRetrievalServerObserver>> | undefined;
    let operationBefore: Awaited<ReturnType<NonNullable<typeof server>["snapshot"]>> | undefined;
    let operationAfter: typeof operationBefore;
    let beforeOperationBytes: number | undefined;
    let afterOperationBytes: number | undefined;
    const operationDiagnostics: ReturnType<typeof makeNativeProductOperationDiagnostics> = makeNativeProductOperationDiagnostics((_method, _args, exit, elapsedMs) => {
      observed = { exit, elapsedMs };
      if (mode === "trace") afterOperationBytes = Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes;
      return server?.snapshot().then(snapshot => { operationAfter = snapshot; });
    });
    const series = await prepareMixedMutationPerformanceSeries({ driver: "postgres", suffix, profile: "product", sampleCount: attemptCount,
      ...(readMetadataScale === undefined ? {} : { readMetadataScale }),
      hooks: { onNativeOperationExit: operationDiagnostics,
        beforeNative: () => (mode === "trace" ? Effect.sync(() => {
          beforeOperationBytes = Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes;
        }) : Effect.void).pipe(Effect.andThen(server === undefined ? Effect.void : Effect.tryPromise({ try: async () => {
          operationBefore = await server?.snapshot();
        }, catch: cause => commerceError("resourceFailure", cause) }))) },
      applicationSource: seed => `export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => ctx.privateMixed.call("medusa.product", "retrieve", { id: ${JSON.stringify(branch === "hit" ? seed.productId : `prod_missing_${suffix}`)} }) } } };`,
    });
    const finiteSetupMs = performance.now() - setupStart;
    const nativeSeedStart = performance.now();
    try {
      for (let index = 0; index < attemptCount; index++) {
        const seed = productAttemptSeed(`${suffix}-${index}`);
        await native.createProductTags(seed.tagInput);
        await native.createProductCategories(seed.categoryInput);
        await native.createProducts(seed.createInput.products[0]!);
      }
      if (series.currency.resource.kind !== "postgres") throw new Error("Native comparison requires actual PostgreSQL");
      const resource = series.currency.resource;
      const finiteSettings = await readRetrievalRuntimeSettings(async sql => (await resource.target.pool.query(sql)).rows);
      for (const runtime of [nativeSettings, finiteSettings]) {
        for (const name of ["fsync", "synchronous_commit", "full_page_writes"])
          expect(runtime.settings[name]).toMatchObject({ status: "observed", value: "on" });
        expect(runtime.settings["pg_stat_statements.track"]).toMatchObject({ status: "observed", value: mode === "server" ? "all" : "none" });
        const autoExplain = runtime.settings["auto_explain.log_min_duration"];
        if (mode !== "server" && autoExplain?.status === "observed") expect(autoExplain.value).toBe("-1");
      }
      if (mode === "server") {
        const observerUrl = process.env.FLAREX_MIXED_NATIVE_READ_OBSERVER_DATABASE_URL;
        const nativeDatabase = process.env.NATIVE_RETRIEVAL_DATABASE;
        if (observerUrl === undefined || nativeDatabase === undefined) throw new Error("Server mode requires isolated observer URL and native database");
        const controlSettings = await readRetrievalRuntimeSettings(async sql => (await resource.control.pool.query(sql)).rows);
        expect(controlSettings.settings["pg_stat_statements.track"]).toMatchObject({ status: "observed", value: "all" });
        server = await openRetrievalServerObserver(observerUrl,
          selectRetrievalServerDatabases(nativeDatabase, nativeSettings, finiteSettings, controlSettings));
      }
      setup.push({ branch, finiteSetupMs, nativeSeedingMs: performance.now() - nativeSeedStart,
        nativeSettings, finiteSettings,
        metadataCounts: series.currency.metadataCounts, metadataScaling: series.currency.metadataScaling,
        sourcePreparationRetainedBytes: Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes,
        builtInSqlObserver: series.currency.observeSql !== undefined,
        serverObserver: server === undefined ? null : { settings: server.settings, identity: server.observerIdentity, coverage: server.coverage },
        provisioningMs: series.provisioningMilliseconds, modulePreparationMs: series.preparedModuleMilliseconds,
        initialSeedingMs: series.initialSeedingMilliseconds, additionalSeedingMs: series.additionalSetupSeedingMilliseconds,
        lifetime: "one prepared module/schema/pool graph; fresh authenticated attempt and single-use Worker per sample" });
      const trace = mode === "trace" && series.currency.resource.kind === "postgres"
        ? createMixedMutationPerformanceTrace({ controlPool: series.currency.resource.control.pool, targetPool: series.currency.resource.target.pool }) : undefined;
      series.setTrace(trace);
      try {
        for (let index = 0; index < attemptCount; index++) {
          const seed = productAttemptSeed(`${suffix}-${index}`);
          const id = branch === "hit" ? seed.productId : `prod_missing_${suffix}`;
          let nativeResult: unknown;
          let nativeError: ReturnType<typeof errorSummary> | null = null;
          let nativeMs = 0;
          let finiteRequestMs = 0;
          let finiteResult: unknown;
          let finiteFailure: unknown;
          let nativeServer: Sample["nativeServer"] = null;
          let finiteServer: Sample["finiteServer"] = null;
          let finiteOperationServer: Sample["finiteOperationServer"] = null;
          let sourcePreparationUsage: Sample["sourcePreparationUsage"] = null;
          const nativeSql: RetrievalObservation[] | null = mode === "trace" ? [] : null;
          const runNative = async () => {
            const before = await server?.snapshot();
            const close = nativeSql === null ? undefined : observeRetrievalPgClients(nativeSql);
            const started = performance.now();
            try { nativeResult = await native.retrieveProduct(id); }
            catch (error) { nativeError = errorSummary(error); }
            finally { nativeMs = performance.now() - started; close?.(); }
            if (before !== undefined && server !== undefined) {
              nativeServer = retrievalServerDifference(before, await server.snapshot());
              requireRetrievalServerObservedCalls({ database: nativeSettings.database, dbid: nativeSettings.dbid }, nativeServer);
            }
          };
          const runFinite = async () => {
            observed = undefined;
            operationBefore = undefined;
            operationAfter = undefined;
            beforeOperationBytes = undefined;
            afterOperationBytes = undefined;
            const beforeRequestBytes = mode === "trace" ? Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes : undefined;
            const before = await server?.snapshot();
            const started = performance.now();
            const work = async () => {
              try { finiteResult = (await series.runAttempt(index)).returnedValue; }
              catch (error) { finiteFailure = error; }
            };
            if (trace === undefined) await work();
            else await trace.withInvocation({ id: `${branch}/${index}`, mode: "recon" }, work);
            finiteRequestMs = performance.now() - started;
            operationDiagnostics.assertMeasurement();
            if (beforeRequestBytes !== undefined && beforeOperationBytes !== undefined && afterOperationBytes !== undefined)
              sourcePreparationUsage = { beforeRequestBytes, beforeOperationBytes, afterOperationBytes,
                afterRequestBytes: Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes };
            if (before !== undefined && server !== undefined) {
              const after = await server.snapshot();
              finiteServer = retrievalServerDifference(before, after);
              if (operationBefore === undefined || operationAfter === undefined)
                throw new Error("Missing exact finite native operation server interval");
              finiteOperationServer = retrievalServerDifference(operationBefore, operationAfter);
              requireRetrievalServerObservedCalls({ database: finiteSettings.database, dbid: finiteSettings.dbid }, finiteOperationServer);
              requireProtectedServerWork(finiteOperationServer);
            }
          };
          const nativeFirst = index % 2 === 0;
          if (nativeFirst) { await runNative(); await runFinite(); }
          else { await runFinite(); await runNative(); }
          if (observed === undefined) {
            if (finiteFailure !== undefined) throw finiteFailure;
            throw new Error("Missing actual native operation Exit");
          }
          let finiteError: ReturnType<typeof errorSummary> | null = null;
          if (branch === "hit") {
            expect(finiteFailure).toBeUndefined();
            expect(nativeError).toBeNull();
            expect(Exit.isSuccess(observed.exit)).toBe(true);
            expect(finiteResult).toMatchObject({ status: ProductStatus.DRAFT });
            expect(comparableDto(finiteResult)).toEqual(comparableDto(nativeResult));
          } else {
            expect(finiteFailure).toBeInstanceOf(Error);
            expect(nativeError).not.toBeNull();
            if (Exit.isSuccess(observed.exit)) throw new Error("Missing Product unexpectedly succeeded");
            expect(observed.exit.cause.reasons).toHaveLength(1);
            const reason = observed.exit.cause.reasons[0];
            if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Native miss became a defect or interruption");
            finiteError = errorSummary(reason.error);
            expect(finiteError).toEqual(nativeError);
          }
          const finiteTrace = trace?.records().find(record => record.id === `${branch}/${index}`) ?? null;
          const methodDispatches = finiteTrace?.dispatches.filter(dispatch => dispatch.phasePath.includes("native Product operation"));
          const methodDecodedResults = methodDispatches === undefined ? null : decodedResults(methodDispatches);
          const methodMetadataDecodedResults = methodDispatches === undefined ? null : decodedResults(methodDispatches.filter(dispatch =>
            authorityStatement.test(dispatch.template ?? "")));
          const methodBusinessDecodedResults = methodDispatches === undefined ? null : decodedResults(methodDispatches.filter(dispatch =>
            !authorityStatement.test(dispatch.template ?? "") && businessStatement.test(dispatch.template ?? "")));
          if (mode === "trace") {
            expect(sourcePreparationUsage).not.toBeNull();
            expect(methodDecodedResults?.unknownResultEncodingDispatches).toBe(0);
          }
          samples.push({ branch, sample: index, warmup: index < warmups, nativeFirst, nativeMs, finiteOperationMs: observed.elapsedMs,
            finiteRequestMs, nativeResult, finiteResult, nativeError, finiteError, nativeSql,
            nativeServer, finiteServer, finiteOperationServer, sourcePreparationUsage, methodDecodedResults,
            methodMetadataDecodedResults, methodBusinessDecodedResults, finiteTrace });
        }
      } finally { trace?.close(); }
    } finally { try { await server?.close(); } finally { await series.close(); } }
  }
  expect(await sourceHashes()).toEqual(before);
  const report = { format: "flarex.matched-finite-native-product-retrieve", mode, label, managedRead, readMetadataScale, nativeModuleSetupMs, warmups, count,
    checkpoint: process.env.FLAREX_MIXED_NATIVE_READ_CHECKPOINT, sourceHashes: before, setup, samples,
    summary: ["hit", "miss"].map(branch => {
      const selected = samples.filter(sample => sample.branch === branch && !sample.warmup);
      return { branch, native: distribution(selected.map(sample => sample.nativeMs)),
        finiteOperation: distribution(selected.map(sample => sample.finiteOperationMs)),
        pairedOperationExcess: distribution(selected.map(sample => sample.finiteOperationMs - sample.nativeMs)),
        finiteRequest: distribution(selected.map(sample => sample.finiteRequestMs)) };
    }),
    interpretation: ["Exact admitted ID-only private retrieve; full native default DTO and error contract retained.",
      "Actual generated created_at/updated_at differ between authoritative stores; every field and timestamp is retained and validated, all other values/structure compared exactly.",
      "Every finite hit is the first Product demand in a fresh attempt; no pending-only or repeated-row observation is presented as a storage hit.",
      "Missing Product failures poison their own attempt and keep the native Commerce adapter cause; no failure recovery or publication is introduced.",
      "Finite operation covers actual private native operation, close and receipt validation; complete request includes admission, fresh Worker, execution, seal, publication and fixture disposal.",
      "Schema/module/seeding costs are separately charged per actual series lifetime; measured native schema/module bootstrap remains runner-owned and outside per-operation samples.",
      "Quiet and trace are separate runs; trace observations are client SQL dispatches, never network round trips or server execution time."],
    unavailable: ["network round trips", ...(mode === "server" ? [] : ["server execution time"]), "driver wire bytes", "isolated CPU"] };
  const output = process.env.FLAREX_MIXED_NATIVE_READ_REPORT_DIR;
  if (output !== undefined) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, `${label}-${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}
