import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, statfs, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  PointCommitPublicationObservation,
} from "@flarex/persistence-postgres/point-commit-transaction";
import { createMixedMutationPerformanceTrace, type TraceInvocationRecord } from
  "../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";
import { openRetrievalServerObserver, readRetrievalRuntimeSettings } from
  "../../medusa-adapter/benchmarks/core-performance/native-retrieval/server";
import { createPostgresPersistence } from "../../persistence-postgres/src/database/postgres";
import { prepareMixedMutationPerformanceSeries } from "./support/mixedMutationWorkerdFixture";
import { measuredSourcePaths } from "./support/mixedMutationPerformanceSources";
import { admitPublicationServerLogCopies, filterPublicationServerLog, PublicationPerformanceServer } from "./support/publicationPerformanceServer";
import { correlatePublicationDispatches, publicationFinalCapFailureReceipt, publicationPhaseIntervals, publicationPhaseSummary,
  renderPublicationPerformanceReport, type PublicationPerformanceReport, type PublicationPerformanceSample,
  type PublicationCompactServerRecord, type PublicationLogCaptureAccounting,
  type PublicationRuntimeSettingsRecord, type PublicationProfile, type PublicationTimedEvent } from "./support/publicationPerformanceReport";

const enabled = process.env.FLAREX_PUBLICATION_PERF === "1" &&
  process.env.FLAREX_POSTGRES_DATABASE_URL !== undefined;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const profiles: readonly PublicationProfile[] = ["product", "productPayload", "workflow"];
const serverLane = process.env.FLAREX_PUBLICATION_PERF_SERVER === "1";
const planned: PublicationPerformanceReport["planned"] = {
  profiles, warmupPairs: 1, retainedPairs: serverLane ? 1 : 5, attemptCap: serverLane ? 6 : 36,
  timeoutMs: serverLane ? 900000 : 1800000,
  rawByteCap: 262144000, reportByteCap: 52428800, serverLogByteCap: 536870912,
};
const sourcePaths = [...new Set([...measuredSourcePaths,
  "packages/flarex-backend/test/publicationPerformance.postgres.test.ts",
  "packages/flarex-backend/test/support/mixedMutationPerformanceSources.ts",
  "packages/flarex-backend/test/support/publicationPerformanceReport.ts",
  "packages/flarex-backend/test/support/publicationPerformanceServer.ts",
  "packages/persistence-postgres/src/commit/point/observation.ts",
  "packages/persistence-postgres/src/commit/pointCommitTransactionApi.ts",
  "packages/persistence-postgres/src/storage/indexes/appIndexDefinitions.ts",
  "packages/executor/src/mutation/authentication/stored/finishingOperations.ts",
  "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.ts",
])];

async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
    [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
}

function failureSummary(cause: unknown) {
  const token = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value)
    ? value : null;
  return { name: token(cause instanceof Error ? cause.name :
    typeof cause === "object" && cause !== null && "_tag" in cause ? cause._tag : null) ?? "UnclassifiedFailure",
  code: token(typeof cause === "object" && cause !== null && "code" in cause ? cause.code : null),
  reason: token(typeof cause === "object" && cause !== null && "reason" in cause ? cause.reason : null) };
}

const decodeBusiness = Schema.decodeUnknownSync(Schema.Struct({
  updated: Schema.Struct({ id: Schema.String, title: Schema.String, handle: Schema.String, status: Schema.String }),
  pending: Schema.Struct({ id: Schema.String, title: Schema.String }),
}));
const decodePayload = Schema.decodeUnknownSync(Schema.Struct({
  created: Schema.Struct({ id: Schema.String, title: Schema.String, score: Schema.Number, enabled: Schema.Boolean }),
  afterHook: Schema.Struct({ id: Schema.String, title: Schema.String, score: Schema.Number, enabled: Schema.Boolean }),
  final: Schema.Struct({ id: Schema.String, title: Schema.String, score: Schema.Number, enabled: Schema.Boolean }),
}));

describe.skipIf(!enabled)("genuine mixed publication attribution", () => {
  it("retains the finite paired original-demand baseline through real COMMIT", async () => {
    const harnessStarted = performance.now();
    const output = process.env.FLAREX_PUBLICATION_PERF_REPORT_DIR;
    if (output === undefined) throw new Error("A fresh publication artifact directory is required");
    if (!resolve(output).startsWith(resolve(root, "work", "validation") + sep))
      throw new Error("Private publication diagnostics require an ignored validation directory");
    // Exclusive directory creation prevents replacing an unfavorable receipt.
    const directoryStarted = performance.now();
    await mkdir(output, { recursive: false });
    const directoryCreationMs = performance.now() - directoryStarted;
    const sourceHashStarted = performance.now();
    const hashesStart = await sourceHashes();
    const sourceHashStartMs = performance.now() - sourceHashStarted;
    const samples: PublicationPerformanceSample[] = [];
    const setup: PublicationPerformanceReport["setup"][number][] = [];
    const runtimeSettings: PublicationRuntimeSettingsRecord[] = [];
    let runFailure: { cause: unknown } | undefined;
    let serverObserver: Awaited<ReturnType<typeof openRetrievalServerObserver>> | undefined;
    const serverWindows: unknown[] = [];
    const compactServerWindows: PublicationCompactServerRecord[] = [];
    const diagnosticSecondaryFailures: ReturnType<typeof failureSummary>[] = [];
    const serverLog = process.env.FLAREX_PUBLICATION_PERF_SERVER_LOG;
    let logStart: number | null = null;
    let logEnd: number | null = null;
    let originalLogCaptured = false;
    let selectedLogCaptured = false;
    const logCaptureAccounting: PublicationLogCaptureAccounting = {};
    let filteredLogCoverage: Omit<ReturnType<typeof filterPublicationServerLog>, "log"> | undefined;
    const authenticatedSamplePids = new Set<number>();
    let rawBytesWritten = 0;
    const artifactTimings: { id: string; serializationAndWriteMs: number; bytes: number }[] = [];
    const runStarted = performance.now();
    let order = 0;
    try {
      if (serverLane) {
        const diagnosticUrl = process.env.FLAREX_PUBLICATION_PERF_OBSERVER_URL;
        const databaseUrl = process.env.FLAREX_POSTGRES_DATABASE_URL;
        if (diagnosticUrl === undefined || databaseUrl === undefined || serverLog === undefined)
          throw new Error("Server lane requires observer URL and retained server log path");
        logStart = (await stat(serverLog)).size;
        // Authentication of catalog identity uses the selected actual runtime
        // connection; this diagnostic probe is never an application writer.
        const probe = await createPostgresPersistence({ connectionString: databaseUrl, poolConfig: { max: 1 } });
        try {
          const actual = await readRetrievalRuntimeSettings(async sql => (await probe.query(sql)).rows);
          serverObserver = await openRetrievalServerObserver(diagnosticUrl,
            [{ database: actual.database, dbid: actual.dbid }]);
        } finally { await probe.close(); }
      }
      for (const profile of profiles) {
        const setupStarted = performance.now();
        const setupServer = serverObserver === undefined ? undefined : new PublicationPerformanceServer(serverObserver);
        const prepareSeries = async () => {
          await setupServer?.begin("setup");
          try { return await prepareMixedMutationPerformanceSeries({ driver: "postgres",
            suffix: `publication-${profile.toLowerCase()}-${Date.now()}`, profile, sampleCount: planned.attemptCap / 3 }); }
          finally {
            await setupServer?.end("setup");
            if (setupServer !== undefined) serverWindows.push({ profile, setup: setupServer.windows,
              failedWindows: setupServer.failedWindows,
              status: setupServer.status() });
            if (setupServer !== undefined) compactServerWindows.push({ id: `${profile}-setup`, profile,
              observation: setupServer.compact() });
          }
        };
        const series = await prepareSeries();
        let seriesPrimaryFailure: { cause: unknown } | undefined;
        try {
          const target = series.currency.persistence;
          const controlPersistence = series.currency.resource.control;
          if (!("pool" in target) || !("pool" in controlPersistence))
            throw new Error("Publication baseline requires actual PostgreSQL pools");
          setupServer?.assertHealthy();
          setup.push({ profile, completeSetupMs: performance.now() - setupStarted,
            provisioningMs: series.provisioningMilliseconds, preparedModuleMs: series.preparedModuleMilliseconds,
            initialSeedingMs: series.initialSeedingMilliseconds,
            additionalSetupSeedingMs: series.additionalSetupSeedingMilliseconds });
          const control = await readRetrievalRuntimeSettings(async sql =>
            (await controlPersistence.query(sql)).rows);
          const targetSettings = await readRetrievalRuntimeSettings(async sql =>
            (await target.query(sql)).rows);
          for (const lane of [control, targetSettings]) {
            expect(lane.settings["pg_stat_statements.track"]).toEqual({ status: "observed", value: serverLane ? "all" : "none" });
            expect(lane.settings["auto_explain.log_min_duration"]).toEqual({ status: "observed", value: serverLane ? "0" : "-1" });
            if (!serverLane) expect(lane.settings.track_functions).toEqual({ status: "observed", value: "none" });
            expect(lane.settings.fsync).toEqual({ status: "observed", value: "on" });
            expect(lane.settings.synchronous_commit).toEqual({ status: "observed", value: "on" });
          }
          const privilege = (await target.query<{ superuser: boolean; createRole: boolean }>(
            `select rolsuper as superuser, rolcreaterole as "createRole" from pg_roles where rolname=current_user`)).rows;
          expect(privilege).toEqual([{ superuser: false, createRole: false }]);
          runtimeSettings.push({ profile, control, target: targetSettings, poolMax: {
            control: controlPersistence.pool.options.max,
            target: target.pool.options.max } });
          if (serverLane) {
            for (const pool of [controlPersistence, target]) {
              const settings = (await pool.query<{ name: string; setting: string | null }>(
                `select name, current_setting(name, true) as setting from unnest(array[
                'pg_stat_statements.track_planning', 'auto_explain.log_nested_statements',
                'pg_stat_statements.max',
                'auto_explain.log_analyze', 'auto_explain.log_buffers', 'auto_explain.log_triggers',
                'auto_explain.log_format', 'auto_explain.log_timing', 'auto_explain.log_parameter_max_length']) name`)).rows;
              expect(Object.fromEntries(settings.map(setting => [setting.name, setting.setting]))).toEqual({
                "pg_stat_statements.track_planning": "on", "auto_explain.log_nested_statements": "on",
                "pg_stat_statements.max": "20000",
                "auto_explain.log_analyze": "on", "auto_explain.log_buffers": "on",
                "auto_explain.log_triggers": "on", "auto_explain.log_format": "json",
                "auto_explain.log_timing": "off", "auto_explain.log_parameter_max_length": "0",
              });
            }
          }
          for (let pair = 0; pair < (serverLane ? 2 : 6); pair++) {
            const modes = serverLane ? ["detailed"] as const :
              pair % 2 === 0 ? ["boundaryOnly", "detailed"] as const : ["detailed", "boundaryOnly"] as const;
            for (const mode of modes) {
              if (performance.now() - runStarted >= planned.timeoutMs) throw new Error("Publication attribution run deadline reached");
              const index = serverLane ? pair : pair * 2 + (mode === modes[0] ? 0 : 1);
              const id = `${profile}-${pair}-${mode}`;
              const publicationServer = serverObserver === undefined ? undefined : new PublicationPerformanceServer(serverObserver);
              await publicationServer?.begin("wholeAttempt");
              const prepStarted = performance.now();
              let preparationFailure: { cause: unknown } | undefined;
              await publicationServer?.begin("prepareAttempt");
              try { await series.prepareAttempt(index); }
              catch (cause) { preparationFailure = { cause }; }
              finally { await publicationServer?.end("prepareAttempt"); }
              const preparationMs = performance.now() - prepStarted;
              const events: PublicationTimedEvent[] = [];
              let started = 0;
              const observation = new PointCommitPublicationObservation({ detail: mode === "detailed",
                record: event => events.push({ atMs: performance.now() - started, event }) });
              const acquiredPids: { pool: "control" | "target"; pid: number }[] = [];
              const pidObservationFailures: unknown[] = [];
              const acquire = (pool: "control" | "target") => (client: unknown) => {
                try {
                  const pid = typeof client === "object" && client !== null && "processID" in client
                    ? client.processID : undefined;
                  if (typeof pid === "number" && Number.isSafeInteger(pid) &&
                    !acquiredPids.some(entry => entry.pool === pool && entry.pid === pid)) {
                    acquiredPids.push({ pool, pid }); authenticatedSamplePids.add(pid);
                  }
                } catch (cause) { pidObservationFailures.push(cause); }
              };
              const controlAcquire = acquire("control"), targetAcquire = acquire("target");
              if (serverLane) {
                controlPersistence.pool.on("acquire", controlAcquire);
                target.pool.on("acquire", targetAcquire);
              }
              const trace = mode === "detailed" ? createMixedMutationPerformanceTrace({
                controlPool: controlPersistence.pool, targetPool: target.pool }) : undefined;
              series.setTrace(trace);
              let businessFailure: { cause: unknown } | undefined;
              let diagnosticFailure: { cause: unknown } | undefined;
              let outcome: Awaited<ReturnType<typeof series.runAttempt>> | undefined;
              let recorded: TraceInvocationRecord | null = null;
              let fingerprintOwners: PublicationPerformanceSample["fingerprintOwners"] = [];
              const cleanupFailures: unknown[] = [];
              started = performance.now();
              try {
                if (preparationFailure !== undefined) businessFailure = preparationFailure;
                else outcome = trace === undefined ? await series.runAttempt(index, observation, publicationServer, cleanupFailures) :
                  await trace.withInvocation({ id, mode: "recon" }, () => series.runAttempt(index, observation, publicationServer, cleanupFailures));
              } catch (cause) { businessFailure = { cause }; }
              await publicationServer?.end("wholeAttempt");
              const wallMs = preparationFailure === undefined ? performance.now() - started : null;
              const traceFinalizationStarted = performance.now();
              try {
                if (trace !== undefined && preparationFailure === undefined) {
                  const records = trace.drainRecords();
                  recorded = records.find(record => record.id === id) ?? null;
                  if (recorded === null || records.length !== 1) throw new Error("Missing exact attribution trace");
                  fingerprintOwners = trace.ownerMappings();
                  if (recorded.lostContextDispatches !== 0 || recorded.unobservedDispatches !== 0 ||
                    recorded.unknownStatementDispatches !== 0 || recorded.incompleteSpans !== 0 ||
                    recorded.transactions.some(tx => tx.outcome === "open-at-end"))
                    throw new Error("Incomplete publication SQL observation");
                }
              } catch (cause) { diagnosticFailure = { cause }; }
              finally {
                series.setTrace(undefined); trace?.close();
                if (serverLane) {
                  controlPersistence.pool.removeListener("acquire", controlAcquire);
                  target.pool.removeListener("acquire", targetAcquire);
                }
              }
              const traceFinalizationMs = performance.now() - traceFinalizationStarted;
              const evidenceStarted = performance.now();
              let settlementLedger: PublicationPerformanceSample["settlementLedger"] = null;
              try {
                observation.assertHealthy();
                publicationServer?.assertHealthy();
                if (cleanupFailures.length !== 0)
                  throw new Error("Benchmark fixture disposal failed", { cause: cleanupFailures[0] });
                if (pidObservationFailures.length !== 0)
                  throw new Error("Diagnostic acquired-client PID observation failed", { cause: pidObservationFailures[0] });
                if (outcome !== undefined) {
                  if (outcome.publication.kind !== "published") throw new Error("Expected genuine published outcome");
                  expect(outcome.publication.successfulResult.valueJson).toEqual(outcome.returnedValue);
                  const business = decodeBusiness(outcome.returnedValue);
                  expect(business.updated).toEqual({ id: outcome.seed.productId, title: outcome.seed.newTitle,
                    handle: outcome.seed.newHandle, status: "published" });
                  expect(business.pending).toEqual({ id: outcome.seed.productId, title: outcome.seed.newTitle });
                  if (profile !== "product") {
                    const payload = decodePayload(outcome.returnedValue);
                    expect(payload.created).toMatchObject({ title: outcome.seed.newTitle, score: 0, enabled: false });
                    expect(payload.afterHook).toMatchObject({ id: payload.created.id, title: outcome.seed.newTitle, score: 1, enabled: false });
                    expect(payload.final).toMatchObject({ id: payload.created.id, title: outcome.seed.newTitle, score: 1, enabled: true });
                  }
                  settlementLedger = await outcome.fixture.readSettlementLedger();
                  if (settlementLedger === null) throw new Error("Missing genuine frozen-attempt demand ledger");
                }
              } catch (cause) { diagnosticFailure ??= { cause }; }
              const evidenceMs = performance.now() - evidenceStarted;
              if (publicationServer !== undefined) serverWindows.push({ id, profile, warmup: pair === 0,
                acquiredPids, windows: publicationServer.windows,
                failedWindows: publicationServer.failedWindows, status: publicationServer.status() });
              if (publicationServer !== undefined) compactServerWindows.push({ id, profile,
                observation: publicationServer.compact() });
              const parsed = publicationPhaseIntervals(events);
              if (parsed.unmatchedEdges !== 0) diagnosticFailure ??= { cause: new Error("Unmatched publication phase edges") };
              const attemptIntervals = outcome?.attemptPhases.map(interval => ({ ...interval,
                startMs: interval.startMs - started, endMs: interval.endMs - started })) ?? [];
              const intervals = [...attemptIntervals, ...parsed.intervals];
              samples.push({ id, profile, mode, pair, warmup: pair === 0, order: order++, wallMs,
                preparationMs, evidenceMs, traceFinalizationMs,
                status: businessFailure !== undefined ? "businessFailure" : diagnosticFailure !== undefined ? "invalidObservation" : "ok",
                businessStatus: preparationFailure !== undefined ? "notStarted" :
                  businessFailure !== undefined ? "failedOrUncertain" : "published",
                failure: businessFailure !== undefined ? failureSummary(businessFailure.cause) :
                  diagnosticFailure === undefined ? null : failureSummary(diagnosticFailure.cause),
                observationFailures: observation.status().failureCount, cleanupFailures: cleanupFailures.map(failureSummary),
                unmatchedEdges: parsed.unmatchedEdges,
                canonicalResultBytes: outcome?.canonicalResultBytes ?? null,
                workerConstructionMs: outcome?.workerConstructionMilliseconds ?? null,
                intervals, phases: publicationPhaseSummary(intervals), events, trace: recorded, fingerprintOwners,
                dispatchAttribution: recorded === null ? null : correlatePublicationDispatches(recorded,
                  recorded.startedAtMs - started, intervals), settlementLedger,
                unavailable: [...(serverLane ? ["inlineFunctionCounters", "completeNestedTriggerCoverage",
                  "setupBackendPidAttribution"] : ["serverFunctionAndTriggerWork", "serverPlanningAndExecution"]), "lockWaitAndCpu",
                  "initialSetupClientSqlDispatchInventory", "prepareAttemptBackendPidAttribution",
                  "unobservedNamedOwnerParameters", ...(outcome === undefined ? ["failedAttemptOuterPhaseIntervals"] : [])] });
              const artifactStarted = performance.now();
              const sampleJson = JSON.stringify(samples.at(-1), null, 2);
              const sampleBytes = Buffer.byteLength(sampleJson);
              if (rawBytesWritten + sampleBytes > planned.rawByteCap) {
                await writeFile(join(output, "artifact-cap-failure.json"), JSON.stringify({
                  complete: false, reason: "rawByteCap", retainedSampleFiles: artifactTimings.length,
                  failedSampleId: id, failedSampleStatus: samples.at(-1)?.status,
                  attemptedSampleBytes: sampleBytes, rawBytesWritten }, null, 2), { flag: "wx" });
                throw new Error("Publication artifact cap reached; prior sample evidence retained", { cause: businessFailure?.cause });
              }
              await writeFile(join(output, `sample-${String(order - 1).padStart(2, "0")}.json`), sampleJson, { flag: "wx" });
              rawBytesWritten += sampleBytes;
              artifactTimings.push({ id, bytes: sampleBytes, serializationAndWriteMs: performance.now() - artifactStarted });
              if (businessFailure !== undefined) throw businessFailure.cause;
              if (diagnosticFailure !== undefined) throw diagnosticFailure.cause;
            }
          }
        } catch (cause) { seriesPrimaryFailure = { cause }; throw cause; }
        finally {
          try { await series.close(); }
          catch (cause) {
            diagnosticSecondaryFailures.push(failureSummary(cause));
            if (seriesPrimaryFailure === undefined) throw cause;
          }
        }
      }
    } catch (cause) { runFailure = { cause }; }
    finally {
      try { await serverObserver?.close(); }
      catch (cause) { diagnosticSecondaryFailures.push(failureSummary(cause)); runFailure ??= { cause }; }
    }
    if (serverLane && serverLog !== undefined && logStart !== null) {
      logEnd = (await stat(serverLog)).size;
      const logBytes = logEnd - logStart;
      const logCaptureStarted = performance.now();
      const capacity = await statfs(output);
      const freeBytesBefore = capacity.bavail * capacity.bsize;
      const memoryBefore = process.memoryUsage();
      Object.assign(logCaptureAccounting, { appendBytes: logBytes, freeBytesBefore,
        originalBufferByteBound: planned.serverLogByteCap, memoryBefore,
        peakMemoryCoverage: "phase-boundary samples only; true process peak unavailable" });
      if (logBytes < 0 || logBytes > planned.serverLogByteCap) {
        runFailure ??= { cause: new Error("Server log append outside declared byte bounds") };
      } else {
        const handle = await open(serverLog, "r");
        try {
          const buffer = Buffer.alloc(logBytes);
          const read = await handle.read(buffer, 0, logBytes, logStart);
          if (read.bytesRead !== logBytes) throw new Error("Incomplete bounded server log capture");
          const afterRead = process.memoryUsage();
          const filtered = filterPublicationServerLog(buffer.toString("utf8"), authenticatedSamplePids);
          const { log: filteredText, ...coverage } = filtered;
          filteredLogCoverage = coverage;
          const selectedBytes = Buffer.byteLength(filteredText);
          const afterFilter = process.memoryUsage();
          const admission = admitPublicationServerLogCopies({ appendBytes: logBytes, selectedBytes,
            combinedCap: planned.serverLogByteCap, freeBytes: freeBytesBefore,
            remainingArtifactReservation: planned.rawByteCap + planned.reportByteCap });
          Object.assign(logCaptureAccounting, { selectedBytes, admission, afterRead, afterFilter,
            sampledRssPeakBytes: Math.max(memoryBefore.rss, afterRead.rss, afterFilter.rss),
            readAndFilterMs: performance.now() - logCaptureStarted });
          if (admission.kind === "allowed") {
            const copyStarted = performance.now();
            // Private originals can contain utility credential literals. No
            // file is written until combined cap and free capacity admit both.
            await writeFile(join(output, "server-original.log"), buffer, { flag: "wx" });
            originalLogCaptured = true;
            await writeFile(join(output, "server-selected-pids-original.log"), filteredText, { flag: "wx" });
            selectedLogCaptured = true;
            Object.assign(logCaptureAccounting, { copyMs: performance.now() - copyStarted,
              copiedBytes: admission.combinedBytes });
          }
          else runFailure ??= { cause: new Error("Server log copies refused before either file write") };
        } finally { await handle.close(); }
      }
      const finalCapacity = await statfs(output);
      Object.assign(logCaptureAccounting, { freeBytesAfter: finalCapacity.bavail * finalCapacity.bsize,
        captureMs: performance.now() - logCaptureStarted });
    }
    const sourceHashEndStarted = performance.now();
    const hashesEnd = await sourceHashes();
    const sourceHashEndMs = performance.now() - sourceHashEndStarted;
    const sourceStable = Object.entries(hashesStart).every(([path, hash]) => hashesEnd[path] === hash);
    const report: PublicationPerformanceReport = { format: "flarex.publication-attribution", planned,
      environment: { node: process.version, platform: process.platform, architecture: process.arch,
        runtimeSettings, lane: serverLane ? "serverDiagnostic" : "pairedBoundaryAndDetailed",
        diagnosticSecondaryFailures, artifactTimings, rawBytesWritten,
        failure: runFailure === undefined ? null : failureSummary(runFailure.cause),
        directoryCreationMs, sourceHashStartMs, sourceHashEndMs,
        runElapsedCoverage: "excludes directory/start hashing and final serialization/write; includes end hashing; external finalization receipt records remainder",
        sourcePlan: "existing mixed inventory plus executing attribution owners",
        transport: "pg TCP; private Worker bridge in-process", runElapsedMs: performance.now() - runStarted },
      sourceHashesStart: hashesStart, sourceHashesEnd: hashesEnd, sourceStable,
      complete: runFailure === undefined && sourceStable && samples.length === planned.attemptCap,
      samples, setup, ...(serverLane ? { serverDiagnostics: { windows: serverWindows,
        logStart, logEnd, logByteCap: planned.serverLogByteCap, logCaptureAccounting,
        authenticatedSamplePids: [...authenticatedSamplePids],
        filteredLogCoverage: selectedLogCaptured ? filteredLogCoverage : {
          coverage: "unavailable", reason: originalLogCaptured ? "filteredLogArtifactCapRefused" : "noCapturedLogAppend" },
        logCoverage: originalLogCaptured
          ? "bounded full append captured; authenticated sample PIDs supplied; setup PID attribution incomplete"
          : "unavailable; no captured append artifact (declared cap or capture refusal)",
        counterCoverage: "all roles in authenticated isolated database; nested inclusive counters are not additive" } } : {}) };
    const finalSerializationStarted = performance.now();
    const raw = JSON.stringify(report, null, 2);
    const markdown = renderPublicationPerformanceReport(report);
    const finalSerializationMs = performance.now() - finalSerializationStarted;
    if (rawBytesWritten + Buffer.byteLength(raw) > planned.rawByteCap || Buffer.byteLength(markdown) > planned.reportByteCap) {
      const receipt = publicationFinalCapFailureReceipt({ report, rawBytesWritten, finalRawBytes: Buffer.byteLength(raw),
        safeRuntimeSettings: runtimeSettings, compactServerWindows,
        safeLogAccounting: { logStart, logEnd, appendBytes: logStart === null || logEnd === null ? null : logEnd - logStart,
          originalLogCaptured, selectedLogCaptured, logCaptureAccounting,
          filteredCoverage: selectedLogCaptured ? filteredLogCoverage : "unavailable; no selected log artifact" },
        spentWork: { directoryCreationMs, sourceHashStartMs, sourceHashEndMs, finalSerializationMs,
          artifactTimings, runElapsedMs: performance.now() - runStarted,
          diagnosticSecondaryFailures, failure: runFailure === undefined ? null : failureSummary(runFailure.cause) } });
      await writeFile(join(output, "final-artifact-cap-failure.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
      throw new Error("Publication artifact cap exceeded; individual sample evidence retained", { cause: runFailure?.cause });
    }
    const finalWriteStarted = performance.now();
    try {
      await writeFile(join(output, "raw.json"), raw, { flag: "wx" });
      await writeFile(join(output, "report.md"), markdown, { flag: "wx" });
    } catch (cause) { diagnosticSecondaryFailures.push(failureSummary(cause)); runFailure ??= { cause }; }
    const finalWriteMs = performance.now() - finalWriteStarted;
    const finalHashStarted = performance.now();
    const artifactHashes = { raw: createHash("sha256").update(raw).digest("hex"),
      report: createHash("sha256").update(markdown).digest("hex") };
    const finalArtifactHashMs = performance.now() - finalHashStarted;
    const finalization = { directoryCreationMs, sourceHashStartMs, sourceHashEndMs,
      finalSerializationMs, finalWriteMs, finalArtifactHashMs, artifactHashes,
      diagnosticSecondaryFailures, failure: runFailure === undefined ? null : failureSummary(runFailure.cause),
      harnessElapsedBeforeReceiptWriteMs: performance.now() - harnessStarted,
      receiptOwnSerializationAndWriteMs: "unavailable within this receipt; external process envelope retained by root" };
    try { await writeFile(join(output, "finalization.json"), JSON.stringify(finalization, null, 2), { flag: "wx" }); }
    catch (cause) { runFailure ??= { cause }; }
    if (runFailure !== undefined) throw runFailure.cause;
    expect(sourceStable).toBe(true);
    expect(report.complete).toBe(true);
  }, 1860000);
});
