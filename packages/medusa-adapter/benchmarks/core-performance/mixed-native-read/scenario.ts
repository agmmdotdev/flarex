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
import { prepareMixedMutationPerformanceSeries } from "../../../../flarex-backend/test/support/mixedMutationWorkerdFixture";
import { makeNativeProductOperationDiagnostics } from "../../../../executor/test/performance/support/nativeProductOperationDiagnostics";
import { observeRetrievalPgClients, type RetrievalObservation } from "../native-retrieval/observation";
import { readRetrievalRuntimeSettings, openRetrievalServerObserver, retrievalServerDifference,
  selectRetrievalServerDatabases, requireRetrievalServerObservedCalls } from "../native-retrieval/server";
import { NativeReadCpuProfiler, CPU_SAMPLING_INTERVAL_MICROSECONDS } from "./cpu-profile";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const sources = ["packages/medusa-adapter/benchmarks/core-performance/mixed-native-read/scenario.ts",
  "packages/medusa-adapter/benchmarks/core-performance/mixed-native-read/cpu-profile.ts",
  "packages/flarex-backend/test/support/mixedMutationWorkerdFixture.ts",
  "packages/flarex-backend/test/support/mixedMutationWorkerdAdapter.ts",
  "packages/executor/test/performance/support/mixedMutationProductFixture.ts",
  "packages/medusa-adapter/test/support/logical-currency-fixture.ts",
  "packages/persistence-postgres/test/postgresHelpers.ts",
  "packages/executor/test/performance/support/mixedMutationInProcessRuntime.ts",
  "packages/executor/test/performance/support/nativeProductOperationDiagnostics.ts",
  "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.ts",
  "packages/persistence-postgres/src/preparedHostRuntime.ts",
  "packages/persistence-postgres/test/mixedMutationPerformanceTrace.ts",
  "packages/persistence-postgres/test/logicalReadMetadataScalingTestSupport.ts",
  "packages/persistence-postgres/src/scopeAuthorityControlRead.ts",
  "packages/persistence-postgres/src/scopeClock.ts",
  "packages/persistence-postgres/src/finiteAttemptAnchor.ts",
  "packages/persistence-postgres/src/scopeExecutionAuthorityInstallation.ts",
  "packages/persistence-postgres/drizzle/0126_finite_execution_authority.sql",
  "packages/persistence-postgres/drizzle/0128_finite_storage_frontier.sql",
  "packages/persistence-postgres/drizzle/0129_finite_storage_reads.sql",
  "packages/persistence-postgres/drizzle/0130_finite_storage_capture.sql",
  "packages/persistence-postgres/drizzle/0131_finite_entry.sql",
  "packages/persistence-postgres/drizzle/0132_finite_historical_identity.sql",
  "packages/persistence-postgres/drizzle/0133_publication_domain.sql",
  "packages/persistence-postgres/src/finiteStorageCapture.ts",
  "packages/persistence-postgres/src/finitePublicationInstallation.ts",
  "packages/persistence-postgres/src/finitePublicationObservation.ts",
  "packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts",
  "packages/persistence-postgres/src/applicationDocumentMaterialization/domainApplication.ts",
  "packages/persistence-postgres/src/applicationDocumentMaterialization/domainInstallation.ts",
  "packages/persistence-postgres/src/applicationDocumentMaterialization/domainCoverage.ts",
  "packages/persistence-postgres/src/appUniqueKeys.ts",
  "packages/persistence-postgres/src/logicalDocuments/searchEntries.ts",
  "packages/persistence-postgres/src/commitPublication/publication.ts",
  "packages/persistence-postgres/src/commitPublication/installation.ts",
  "packages/persistence-postgres/src/commitPublication/prefixInstallation.ts",
  "packages/persistence-postgres/src/commitPublication/prefixProjection.ts",
  "packages/persistence-postgres/src/commitPublication/prefixWriter.ts",
  "packages/persistence-postgres/src/commitPublication/scopePublicationModel.ts",
  "packages/persistence-postgres/src/finiteEntryObservation.ts",
  "packages/persistence-postgres/src/finiteEntryCompletionInstallation.ts",
  "packages/persistence-postgres/src/finiteMetadataComparison.ts",
  "packages/persistence-postgres/src/physicalSession/postgres.ts",
  "packages/persistence-postgres/src/physicalSession/deadline.ts",
  "packages/persistence-postgres/src/physicalSession/drizzle.ts",
  "packages/persistence-postgres/src/postgres.ts",
  "packages/persistence-postgres/src/pglite.ts",
  "packages/persistence-postgres/src/indexBuildStates.ts",
  "packages/persistence-postgres/src/finiteMetadataDependencies.ts",
  "packages/persistence-postgres/src/finiteMetadataReservation.ts",
  "packages/persistence-postgres/src/transactionSessionAttemptKernel.ts",
  "packages/persistence-postgres/src/physicalDefinitionRetirementPins.ts",
  "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/readAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts",
  "packages/persistence-postgres/src/logicalDocuments/journalEvidence.ts",
  "packages/persistence-postgres/src/logicalDocuments/commitEvidence.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/host.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/canonical.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/model.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts",
  "packages/persistence-postgres/src/commerceTransaction/admission.ts",
  "packages/persistence-postgres/src/commerceTransaction/logicalInitialization.ts",
  "packages/persistence-postgres/src/commerceTransaction/host.ts",
  "packages/persistence-postgres/src/atomicCommerce/admission.ts",
  "packages/persistence-postgres/src/crossDomainCommand/host.ts",
  "packages/persistence-postgres/src/applicationActivation.ts",
  "packages/persistence-postgres/src/applicationBindingProjection.ts",
  "packages/persistence-postgres/src/applicationActiveHeadRead.ts",
  "packages/persistence-postgres/src/applicationReadiness.ts",
  "packages/persistence-postgres/src/applicationWriteOwnership/Capture.ts",
  "packages/persistence-postgres/src/applicationWriteOwnership/Commit.ts",
  "packages/persistence-postgres/src/applicationWriteOwnership/Repository.ts",
  "packages/persistence-postgres/src/applicationWriteOwnership/Successor.ts",
  "packages/persistence-postgres/src/applicationWriteOwnership/UniqueEvidence.ts",
  "packages/persistence-postgres/src/applicationWriteOwnership/Policy.ts",
  "packages/persistence-postgres/src/applicationWriteOwnership/Preparation.ts",
  "packages/persistence-postgres/src/applicationRelationReadinessFold.ts",
  "packages/persistence-postgres/src/applicationStandaloneBinding.ts",
  "packages/persistence-postgres/src/schemaVersionArtifacts.ts",
  "packages/persistence-postgres/src/appIndexDefinitions.ts",
  "packages/persistence-postgres/src/appIndexEntries.ts",
  "packages/persistence-postgres/src/appRows.ts",
  "packages/persistence-postgres/src/appUniqueConstraintDefinitions.ts",
  "packages/persistence-postgres/src/appUniqueConstraintCommitV1.ts",
  "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts",
  "packages/persistence-postgres/src/appUniqueConstraintSetClosureV1.ts",
  "packages/persistence-postgres/src/indexBuildReconciliation.ts",
  "packages/persistence-postgres/src/indexMaintenance.ts",
  "packages/persistence-postgres/src/logicalDocuments/workingSet.ts",
  "packages/persistence-postgres/src/logicalDocuments/indexReads.ts",
  "packages/persistence-postgres/src/logicalDocuments/model.ts",
  "packages/persistence-postgres/src/logicalStorageDefinitions.ts",
  "packages/persistence-postgres/src/logicalStorageReadiness.ts",
  "packages/persistence-postgres/src/logicalSearchBuild.ts",
  "packages/persistence-postgres/src/sessionJournalStore.ts",
  "packages/persistence-postgres/src/sessionJournalFiniteEntry.ts",
  "packages/persistence-postgres/src/sessionJournalFiniteFreeze.ts",
  "packages/persistence-postgres/src/storedCommitAuthority/materialization.ts",
  "packages/persistence-postgres/src/applicationMutationAdmission.ts",
  "packages/persistence-postgres/src/effectTransaction.ts",
  "packages/persistence-postgres/src/pointCommitTransaction.ts",
  "packages/executor/src/storedAttemptAuthentication/attemptReplacementOperations.ts",
  "packages/executor/src/storedAttemptAuthentication/capabilityState.ts",
  "packages/executor/src/storedAttemptAuthentication/occRerunExecutionOperations.ts",
  "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts",
  "packages/executor/src/pointMutationJournal.ts",
  "packages/executor/src/finitePointMutationExecution.ts",
  "packages/executor/src/finitePointMutationRecovery.ts",
  "packages/executor/src/pointMutationSessionActivation.ts",
  "packages/executor/src/pointMutationExecutionClaimLiveness.ts",
  "packages/executor/src/pointMutationExecutionClaimSupervision.ts",
  "packages/executor/src/pointMutationSessionAttemptState.ts",
  "packages/flarex-protocol/src/commit-protocol.ts",
  "packages/persistence-postgres/src/transactionSessionActivation.ts",
  "packages/persistence-postgres/src/transactionSessionReadSyscallKernel.ts",
  "packages/persistence-postgres/src/logicalReadMetadata.ts",
  "packages/persistence-postgres/src/preparedMetadataEpoch.ts",
  "packages/persistence-postgres/src/installationLifecycle.ts",
  "packages/persistence-postgres/src/postgresInstallationMaintenance.ts",
  "packages/medusa-adapter/src/product-attempt.ts"] as const;
const sourceHashes = async () => Object.fromEntries(await Promise.all(sources.map(async path =>
  [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")] as const)));
const Count = Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 30 }));
type Branch = "hit" | "miss";
type DecodedResults = Readonly<{ dispatches: number; returnedRowCount: number;
  decodedResultJsonUtf8Bytes: number; unknownResultEncodingDispatches: number }>;
type CpuProfileEvidence = Readonly<{ file: string; sha256Hex: string; startTime: number; endTime: number;
  samplingIntervalMicroseconds: number; nodeCount: number; sampleCount: number | null }>;
interface Sample {
  readonly branch: Branch; readonly sample: number; readonly warmup: boolean; readonly nativeFirst: boolean;
  readonly finiteDataPreparationMs: number;
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
  readonly nativeCpuProfile: CpuProfileEvidence | null;
  readonly finiteCpuProfile: CpuProfileEvidence | null;
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

const authorityStatement = /fx_system_(?:scope_clock|scope_execution_authority|data_binding_head|application_active_head|index_build_state|prepared_metadata_epoch|installation(?:_runtime)?|tx_session|snapshot_lease|tx_journal|tx_execution_claim)\b|fx_lock_(?:installation_admission|read_scope_placement|prepared_metadata_epoch|running_attempt_tail|finite_scope_observation|finite_running_attempt)\b|fx_accept_finite_storage_capture\b|fx_control_scope(?:_provisioning)?\b/;
const businessStatement = /fx_app_(?:row|index|unique|search|relation)|fx_read_snapshot_(?:rows|index_page)\b/;
function decodedResults(dispatches: readonly TraceDispatchRecord[]): DecodedResults {
  return { dispatches: dispatches.length,
    returnedRowCount: dispatches.reduce((sum, dispatch) => sum + (dispatch.returnedRowCount ?? 0), 0),
    decodedResultJsonUtf8Bytes: dispatches.reduce((sum, dispatch) => sum + (dispatch.decodedResultJsonUtf8Bytes ?? 0), 0),
    unknownResultEncodingDispatches: dispatches.filter(dispatch => dispatch.returnedRowCount == null ||
      dispatch.decodedResultJsonUtf8Bytes == null).length };
}

function requireProtectedServerWork(statements: ReturnType<typeof retrievalServerDifference>) {
  const qualifier = String.raw`(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)\s*\.\s*`;
  for (const [owner, table] of [
    ["installation", "fx_system_installation"],
    ["placement", "fx_control_scope"],
    ["placement receipt", "fx_control_scope_provisioning"],
    ["execution authority", "fx_system_scope_execution_authority"],
    ["publication sequencer", "fx_system_scope_clock"],
  ] as const) {
    const pattern = new RegExp(String.raw`\bselect\b[\s\S]*?\b(?:from|join)\s+(?:${qualifier})?"?${table}"?\b`, "i");
    if (!statements.some(statement => !statement.toplevel && statement.calls > 0 && pattern.test(statement.query)))
      throw new Error(`Missing observed nested finite ${owner} server work`);
  }
  const targetEpoch = new RegExp(String.raw`\bleft\s+join\s+${qualifier}fx_system_prepared_metadata_epoch\s+(?:as\s+)?target_epoch\b`, "i");
  const controlEpoch = new RegExp(String.raw`\bleft\s+join\s+${qualifier}fx_system_prepared_metadata_epoch\s+(?:as\s+)?control_epoch\b`, "i");
  const installedCalls = /\bfx_lock_installation_admission\s*\(/i;
  const placementCalls = /\bfx_lock_read_scope_placement\s*\(/i;
  const finiteCaptureCalls = /\bfx_accept_finite_storage_capture\s*\(/i;
  const selectStatement = /^\s*(?:select|with)\b/i;
  // Genuine installed acceptance and the named capture share one outer
  // statement. The capture locks the original session and selected builds,
  // then starts separate fresh time and sequencer commands after their waits.
  if (!statements.some(statement => statement.toplevel && statement.calls > 0 &&
    selectStatement.test(statement.query) &&
    targetEpoch.test(statement.query) && controlEpoch.test(statement.query) &&
    installedCalls.test(statement.query) && placementCalls.test(statement.query) &&
    finiteCaptureCalls.test(statement.query)))
    throw new Error("Missing observed top-level finite installed acceptance with both epoch projections");
  const authorityRead = new RegExp(String.raw`\bfrom\s+(?:${qualifier})?"?fx_system_scope_execution_authority"?\b`, "i");
  const authorityScope = /\bwhere\s+a\.scope_id\s*=\s*p_scope_id\b/i;
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 &&
    selectStatement.test(statement.query) &&
    authorityRead.test(statement.query) && authorityScope.test(statement.query) && /\bfor\s+share\b/i.test(statement.query)))
    throw new Error("Missing observed nested finite installed execution authority FOR SHARE query");
  const anchorRead = new RegExp(String.raw`\bfrom\s+(?:${qualifier})?"?fx_system_tx_session"?\b`, "i");
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 &&
    selectStatement.test(statement.query) && anchorRead.test(statement.query) && /\bfor\s+share\b/i.test(statement.query) &&
    /\ba\.scope_uuid\s*=\s*\(\s*substring\s*\(\s*p_scope_id\s+from\s+\$\d+\s*\)\s*\)::uuid/i.test(statement.query) &&
    /\ba\.session_id\s*=\s*\(p_expected\)\.session_id\b/i.test(statement.query)))
    throw new Error("Missing observed nested original finite session anchor FOR SHARE query");
  const sequenceRead = new RegExp(String.raw`\bfrom\s+(?:${qualifier})?"?fx_system_scope_clock"?\b`, "i");
  if (!statements.some(statement => statement.toplevel && statement.calls > 0 &&
    selectStatement.test(statement.query) && /\bfx_accept_finite_storage_capture\s*\(/i.test(statement.query)))
    throw new Error("Missing observed top-level named finite storage capture");
  const servingScope = /\bwhere\s+c\.scope_id\s*=\s*p_scope_id\b/i;
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 &&
    selectStatement.test(statement.query) && sequenceRead.test(statement.query) && servingScope.test(statement.query) &&
    /\bc\.last_commit_seq\b/i.test(statement.query)))
    throw new Error("Missing observed nested finite post-wait serving sequence command");
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 &&
    selectStatement.test(statement.query) && /\bfloor\s*\(\s*extract\s*\(\s*(?:epoch|\$\d+)\s+from\s+clock_timestamp\s*\(/i.test(statement.query)))
    throw new Error("Missing observed nested finite post-wait database time command");
  const buildRead = new RegExp(String.raw`\bfrom\s+(?:${qualifier})?"?fx_system_index_build_state"?\b`, "i");
  if (!statements.some(statement => !statement.toplevel && statement.calls > 0 &&
    selectStatement.test(statement.query) && buildRead.test(statement.query) &&
    /\bb\.index_definition_id\s*=\s*p_index_definition_id\b/i.test(statement.query) && /\bfor\s+key\s+share\b/i.test(statement.query)))
    throw new Error("Missing observed nested finite selected index build FOR KEY SHARE command");
}

export async function runMixedNativeReadPerformanceScenario(native: Pick<IProductModuleService,
  "retrieveProduct" | "createProducts" | "createProductTags" | "createProductCategories">, nativeModuleSetupMs: number) {
  const mode = Schema.decodeUnknownSync(Schema.Literals(["quiet", "trace", "server", "cpu"]))(process.env.FLAREX_MIXED_NATIVE_READ_MODE ?? "quiet");
  const output = process.env.FLAREX_MIXED_NATIVE_READ_REPORT_DIR;
  if (mode === "cpu" && output === undefined) throw new Error("CPU mode requires an owned report directory");
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
    let finiteCpuProfiler: NativeReadCpuProfiler | undefined;
    let cpuSample: number | undefined;
    let finiteCpuProfile: CpuProfileEvidence | null = null;
    const saveCpuProfile = async (owner: "native" | "finite", index: number,
      profiler: NativeReadCpuProfiler): Promise<CpuProfileEvidence> => {
      const profile = await profiler.stop();
      if (output === undefined) throw new Error("Missing CPU profile output directory");
      const file = `${label}-cpu-${branch}-${index}-${owner}.cpuprofile`;
      const bytes = JSON.stringify(profile);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, file), bytes, { flag: "wx" });
      return { file, sha256Hex: createHash("sha256").update(bytes).digest("hex"),
        startTime: profile.startTime, endTime: profile.endTime,
        samplingIntervalMicroseconds: CPU_SAMPLING_INTERVAL_MICROSECONDS,
        nodeCount: profile.nodes.length, sampleCount: profile.samples?.length ?? null };
    };
    const operationDiagnostics: ReturnType<typeof makeNativeProductOperationDiagnostics> = makeNativeProductOperationDiagnostics((_method, _args, exit, elapsedMs) => {
      observed = { exit, elapsedMs };
      if (mode === "trace") afterOperationBytes = Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes;
      const profiler = finiteCpuProfiler;
      if (profiler !== undefined) return (async () => {
        if (cpuSample === undefined) throw new Error("Missing finite CPU sample identity");
        finiteCpuProfile = await saveCpuProfile("finite", cpuSample, profiler);
      })();
      return server?.snapshot().then(snapshot => { operationAfter = snapshot; });
    });
    const series = await prepareMixedMutationPerformanceSeries({ driver: "postgres", suffix, profile: "product", sampleCount: attemptCount,
      ...(readMetadataScale === undefined ? {} : { readMetadataScale }),
      hooks: { onNativeOperationExit: operationDiagnostics,
        beforeNative: () => {
          const beforeNative = (mode === "trace" ? Effect.sync(() => {
            beforeOperationBytes = Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes;
          }) : Effect.void).pipe(Effect.andThen(server === undefined ? Effect.void : Effect.tryPromise({ try: async () => {
            operationBefore = await server?.snapshot();
          }, catch: cause => commerceError("resourceFailure", cause) })));
          const profiler = finiteCpuProfiler;
          return profiler === undefined ? beforeNative : beforeNative.pipe(Effect.andThen(Effect.tryPromise({
            try: () => profiler.start(), catch: cause => commerceError("resourceFailure", cause),
          })));
        } },
      applicationSource: seed => `export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => ctx.privateMixed.call("medusa.product", "retrieve", { id: ${JSON.stringify(branch === "hit" ? seed.productId : `prod_missing_${suffix}`)} }) } } };`,
    });
    // No sampling resource exists while series initialization can fail.
    const nativeCpuProfiler = mode === "cpu" ? new NativeReadCpuProfiler() : undefined;
    finiteCpuProfiler = mode === "cpu" ? new NativeReadCpuProfiler() : undefined;
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
      const branchSetup = { branch, finiteSetupMs, nativeSeedingMs: performance.now() - nativeSeedStart,
        nativeSettings, finiteSettings,
        metadataCounts: series.currency.metadataCounts, metadataScaling: series.currency.metadataScaling,
        sourcePreparationRetainedBytes: Result.getOrThrow(series.readSourcePreparationUsage()).chargedBytes,
        builtInSqlObserver: series.currency.observeSql !== undefined,
        serverObserver: server === undefined ? null : { settings: server.settings, identity: server.observerIdentity, coverage: server.coverage },
        provisioningMs: series.provisioningMilliseconds, modulePreparationMs: series.preparedModuleMilliseconds,
        initialSeedingMs: series.initialSeedingMilliseconds, additionalSeedingMs: series.additionalSetupSeedingMilliseconds,
        lifetime: "one prepared module/schema/pool graph; fresh authenticated attempt and single-use Worker per sample" };
      setup.push(branchSetup);
      const trace = mode === "trace" && series.currency.resource.kind === "postgres"
        ? createMixedMutationPerformanceTrace({ controlPool: series.currency.resource.control.pool, targetPool: series.currency.resource.target.pool }) : undefined;
      series.setTrace(trace);
      try {
        for (let index = 0; index < attemptCount; index++) {
          // The series requires each disjoint data graph before request entry.
          // Charge this setup separately, before either alternating pair member
          // opens its timing, trace or server-observation interval.
          const preparationStarted = performance.now();
          await series.prepareAttempt(index);
          const finiteDataPreparationMs = performance.now() - preparationStarted;
          branchSetup.additionalSeedingMs += finiteDataPreparationMs;
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
          let nativeCpuProfile: CpuProfileEvidence | null = null;
          const nativeSql: RetrievalObservation[] | null = mode === "trace" ? [] : null;
          const runNative = async () => {
            const before = await server?.snapshot();
            const close = nativeSql === null ? undefined : observeRetrievalPgClients(nativeSql);
            if (nativeCpuProfiler !== undefined) await nativeCpuProfiler.start();
            const started = performance.now();
            try { nativeResult = await native.retrieveProduct(id); }
            catch (error) { nativeError = errorSummary(error); }
            finally { nativeMs = performance.now() - started; close?.(); }
            if (nativeCpuProfiler !== undefined) nativeCpuProfile = await saveCpuProfile("native", index, nativeCpuProfiler);
            if (before !== undefined && server !== undefined) {
              nativeServer = retrievalServerDifference(before, await server.snapshot());
              requireRetrievalServerObservedCalls({ database: nativeSettings.database, dbid: nativeSettings.dbid }, nativeServer);
            }
          };
          const runFinite = async () => {
            observed = undefined;
            cpuSample = index;
            finiteCpuProfile = null;
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
            finiteCpuProfiler?.assertMeasurement();
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
          if (mode === "cpu") {
            expect(nativeCpuProfile).not.toBeNull();
            expect(finiteCpuProfile).not.toBeNull();
          }
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
          samples.push({ branch, sample: index, warmup: index < warmups, nativeFirst, finiteDataPreparationMs,
            nativeMs, finiteOperationMs: observed.elapsedMs,
            finiteRequestMs, nativeResult, finiteResult, nativeError, finiteError, nativeSql,
            nativeServer, finiteServer, finiteOperationServer, sourcePreparationUsage, methodDecodedResults,
            methodMetadataDecodedResults, methodBusinessDecodedResults, finiteTrace, nativeCpuProfile, finiteCpuProfile });
        }
      } finally { trace?.close(); }
    } finally {
      try { await nativeCpuProfiler?.dispose(); }
      finally {
        try { await finiteCpuProfiler?.dispose(); }
        finally { try { await server?.close(); } finally { await series.close(); } }
      }
    }
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
      "Finite operation covers actual private native operation, close and receipt validation; complete request includes admission, fresh Worker, execution, local freeze, publication and fixture disposal.",
      "Schema/module/seeding costs are separately charged per actual series lifetime; measured native schema/module bootstrap remains runner-owned and outside per-operation samples.",
      "Each finite disjoint data graph is prepared before its alternating pair; per-sample preparation is recorded and included in setup additionalSeedingMs outside request and operation intervals.",
      "Quiet and trace are separate runs; trace observations are client SQL dispatches, never network round trips or server execution time."],
    cpuInterpretation: mode === "cpu" ? [
      "Diagnostic V8 sampling at 100 microseconds; timings carry profiler overhead and cannot satisfy quiet gates.",
      "Profiles start before the method clock and stop after its completed outcome; finite service construction, close and receipt validation are included.",
      "Returned startTime/endTime are genuine profiler timestamps in microseconds; profiles sample the local Node isolate, including asynchronous and inspector work.",
      "Short samples are noisy; no exclusive CPU is inferred by subtracting SQL awaits or from overlapping spans.",
    ] : null,
    unavailable: ["network round trips", ...(mode === "server" ? [] : ["server execution time"]), "driver wire bytes", "isolated CPU"] };
  if (output !== undefined) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, `${label}-${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}
