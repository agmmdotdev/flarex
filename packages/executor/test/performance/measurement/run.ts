import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { Data, Exit, Result, Schema } from "effect";
import type { Pool } from "pg";
import { analyzeMeasurementEvidence, pairedSummary } from "./analysis";
import type { MeasurementEvent, MeasurementEvidence, MeasurementObserver } from "./artifact";
import { databaseEvents } from "./collectors/database";
import { createEffectMeasurementCollector } from "./collectors/effect";
import { createCpuMeasurementCollector, assertCpuMeasurementIdle, readNodeResourceCounters } from "./collectors/cpu";
import { analyzeCpuEvidence } from "./cpu";
import { acquireServerMeasurementResource } from "./collectors/server";
import { acquireNativeBusinessResource } from "./collectors/native";
import { MeasurementInfrastructureError, MeasurementRunFailure, persistMeasurementReport, type RequestReport, type RunReport } from "./report";
import { describeFailure, type FailureEvidence } from "./failure";
import { measurementSourceDigest } from "./source";
import { failureTokens } from "../support/measurement";
import { createMixedMutationPerformanceTrace } from "../../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import type { CorePerformanceScenario } from "../support/scenario";
import type { PreparedPerformanceFamily } from "../support/scenarioLifetime";
import { corePerformanceScenarios } from "../support/scenarioCatalog";
import { maxCorePerformanceSeriesSamples } from "../support/measurementPlan";

const ScenarioName = Schema.Literals(corePerformanceScenarios.map(scenario => scenario.name));
const NativeScenarioName = Schema.Literals(["payload-create", "medusa-workflow", "mixed-product", "mixed-payload", "mixed-workflow"]);
const decodeNativeScenario = Schema.decodeUnknownSync(NativeScenarioName);

const common = {
  selection: Schema.Struct({ scenario: ScenarioName }),
  size: Schema.Literals(["small", "typical"]),
  outputDirectory: Schema.String.check(Schema.makeFilter(value => value.trim().length > 0 ? undefined : "Expected output directory")),
  samples: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  warmups: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))),
};
const MeasureOptionsSchema = Schema.Struct({ ...common,
  mode: Schema.Literals(["quiet", "timeline", "resources", "database", "cpu", "server"]),
  driver: Schema.optional(Schema.Literals(["postgres", "pglite"])),
  observation: Schema.optional(Schema.Literal("root")),
}).check(Schema.makeFilter(value => value.observation === "root" && value.mode !== "cpu"
  ? "Root observation requires CPU mode"
  : value.driver === "pglite" && (value.mode === "database" || value.mode === "server")
  ? "Database/server diagnostics require the PostgreSQL driver"
  : (value.samples ?? 1) * (value.mode === "resources" || value.observation === "root" ? 2 : 1) + (value.warmups ?? 1) +
    (value.mode === "quiet" || value.mode === "resources" || value.observation === "root" ? 0 : 1) > maxCorePerformanceSeriesSamples
    ? "Selected sampling exceeds the fixture's fresh-attempt capacity" : undefined));
const CompareOptionsSchema = Schema.Struct({ ...common,
  selection: Schema.Struct({ scenario: NativeScenarioName }), size: Schema.Literal("small") });

class InvalidMeasurementConfiguration extends Data.TaggedError("InvalidMeasurementConfiguration")<{
  readonly detail: string;
}> {}

const decodeMeasure = Schema.decodeUnknownResult(MeasureOptionsSchema, { onExcessProperty: "error" });
const decodeCompare = Schema.decodeUnknownResult(CompareOptionsSchema, { onExcessProperty: "error" });
const configuration = <A>(verdict: Result.Result<A, unknown>): A => Result.getOrThrow(verdict.pipe(
  Result.mapError(error => new InvalidMeasurementConfiguration({ detail: String(error) }))));

const EnvironmentSchema = Schema.Struct({ postgresVersion: Schema.String, role: Schema.String,
  superuser: Schema.Boolean, bypassRls: Schema.Boolean, createDb: Schema.Boolean, createRole: Schema.Boolean,
  synchronousCommit: Schema.String, fsync: Schema.String, fullPageWrites: Schema.String,
  statementTracking: Schema.NullOr(Schema.String), autoExplainMinDuration: Schema.NullOr(Schema.String) });
const decodeEnvironment = Schema.decodeUnknownSync(EnvironmentSchema);
async function environment(scenario: CorePerformanceScenario, driver: "postgres" | "pglite", mode: RunReport["mode"]) {
  if (driver === "pglite") return { driver: "pglite" };
  if (scenario.pools === undefined) throw new Error("PostgreSQL measurement requires actual runtime pools");
  const read = async (pool: Pool) => decodeEnvironment((await pool.query(`select
      current_setting('server_version') as "postgresVersion", current_user as role,
      rolsuper as superuser, rolbypassrls as "bypassRls", rolcreatedb as "createDb", rolcreaterole as "createRole",
      current_setting('synchronous_commit') as "synchronousCommit", current_setting('fsync') as fsync,
      current_setting('full_page_writes') as "fullPageWrites",
      current_setting('pg_stat_statements.track', true) as "statementTracking",
      current_setting('auto_explain.log_min_duration', true) as "autoExplainMinDuration"
      from pg_roles where rolname = current_user`)).rows[0]);
  const [control, target] = await Promise.all([read(scenario.pools.controlPool), read(scenario.pools.targetPool)]);
  for (const settings of [control, target]) if (settings.superuser || settings.bypassRls || settings.createDb || settings.createRole ||
    settings.synchronousCommit !== "on" || settings.fsync !== "on" || settings.fullPageWrites !== "on" ||
    (settings.statementTracking !== null && settings.statementTracking !== (mode === "server" ? "all" : "none")) ||
    (settings.autoExplainMinDuration !== null && settings.autoExplainMinDuration !==
      (mode === "server" && process.env.FLAREX_MEASUREMENT_SERVER_LOG ? "0" : "-1"))) {
    throw new Error("Measurement requires ordinary-role durable PostgreSQL settings and the selected diagnostic profile");
  }
  return { driver: "postgres", control, target };
}

function normalize(requestId: string, collector: ReturnType<typeof createEffectMeasurementCollector>,
  trace: ReturnType<typeof createMixedMutationPerformanceTrace> | undefined): MeasurementEvidence {
  const status = collector.status();
  const origin = status.originMonotonicMs;
  const records = collector.records();
  const root = records.find(event => event.id === status.rootId);
  if (root === undefined || root.kind !== "effectSpan" || root.endMs === null) throw new Error("Missing diagnostic root settlement");
  const end = root.endMs - origin;
  const events: MeasurementEvent[] = records.map(event => event.kind === "work"
    ? { ...event, atMs: event.atMs - origin }
    : { ...event, startMs: event.startMs - origin, endMs: event.endMs === null ? null : event.endMs - origin });
  const observers: MeasurementObserver[] = collector.observers().map(event => ({ ...event,
    startMs: event.startMs - origin, endMs: event.endMs === null ? null : event.endMs - origin }));
  const driver = trace?.records()[0];
  if (driver !== undefined) {
    const normalized = databaseEvents(driver, trace?.ownerMappings() ?? [], origin, events);
    events.push(...normalized.events);
    observers.push(...normalized.observers);
  }
  const postRequestObservers: MeasurementObserver[] = [];
  for (const observer of observers) {
    if (observer.startMs >= end) postRequestObservers.push(observer);
    else if (observer.endMs !== null && observer.endMs > end) {
      // Split a crossing observer at the declared root boundary. Its entire
      // original duration is retained in the two distinct accounting windows.
      events.push({ ...observer, endMs: end });
      postRequestObservers.push({ ...observer, id: `${observer.id}:post`, startMs: end });
    } else events.push(observer);
  }
  const startOf = (event: MeasurementEvent) => event.kind === "work" ? event.atMs : event.startMs;
  return { requestId, clock: { id: "node-performance-monotonic", unit: "milliseconds", precisionMs: null,
    originMonotonicMs: origin }, root: { startMs: 0, endMs: end, outcome: root.outcome },
    events: events.toSorted((left, right) => startOf(left) - startOf(right) || left.sequence - right.sequence)
      .map((event, sequence) => ({ ...event, sequence })),
    postRequestObservers: postRequestObservers.toSorted((left, right) => left.startMs - right.startMs)
      .map((event, sequence) => ({ ...event, sequence: events.length + sequence })),
    collection: { capacity: status.capacity + (driver?.observationLimit ?? 0),
      droppedEvents: status.droppedEvents + (driver?.droppedObservations ?? 0),
      lostContextEvents: status.lostContextEvents + (driver?.lostContextDispatches ?? 0) + (driver?.lostOperationContexts ?? 0),
      failures: [...status.failures, ...(driver?.observationErrors ? ["Database observation failed"] : []),
        ...(driver?.aggregationComplete === false ? ["Database trace finalization failed"] : []),
        ...(trace !== undefined && driver === undefined ? ["Missing database invocation"] : [])] } };
}

async function flarexRequest(scenario: CorePerformanceScenario, name: typeof ScenarioName.Type, index: number,
  kind: RequestReport["kind"], mode: RunReport["mode"], runId: string, retainFailure: (cause: unknown) => void,
  server: Awaited<ReturnType<typeof acquireServerMeasurementResource>> | undefined,
  selectedObservation?: "root"): Promise<RequestReport> {
  const id = `${runId}:flarex:${index}`;
  const seedStart = performance.now();
  const sample = await scenario.prepareSample(id, index);
  const seedMs = performance.now() - seedStart;
  const rootCpu = mode === "cpu" && selectedObservation === "root";
  const collector = kind === "diagnostic" && !rootCpu ? createEffectMeasurementCollector({ now: () => performance.now(),
    ...(mode === "resources" ? { readResources: readNodeResourceCounters } : {}) }) : undefined;
  let trace: ReturnType<typeof createMixedMutationPerformanceTrace> | undefined;
  if (collector !== undefined && (mode === "resources" || mode === "database" || mode === "server" || mode === "cpu") && scenario.pools !== undefined) {
    trace = createMixedMutationPerformanceTrace({ ...scenario.pools, currentOperationId: collector.currentOperationId,
      detail: mode === "database" ? "full" : "resources" });
  }
  const cpu = kind === "diagnostic" && mode === "cpu"
    ? rootCpu ? createCpuMeasurementCollector({ allocations: false }) : createCpuMeasurementCollector() : undefined;
  const observation = collector?.publicationObservation();
  let requestMs: number | null = null;
  let verificationMs = 0;
  let cleanupMs = 0;
  let outcome: RequestReport["outcome"] = "success";
  let failureStage: string | null = null;
  const failures: FailureEvidence[] = [];
  const fail = (stage: string, cause: unknown) => { failures.push(describeFailure(stage, cause)); retainFailure(cause); };
  const cleanupFailures: unknown[] = [];
  let evidence: MeasurementEvidence | undefined;
  let analysis: RequestReport["analysis"];
  let cpuEvidence: RequestReport["cpuEvidence"];
  let cpuAnalysis: RequestReport["cpuAnalysis"];
  let invalidEvidence: string | undefined;
  let completed: unknown;
  let requestCompleted = false;
  try {
    scenario.setTrace?.(trace);
    scenario.setEffectDiagnostics?.(collector?.binding);
    const run = () => sample.run(observation, cleanupFailures);
    const observed = () => collector === undefined ? run() : collector.runRequest(name, run);
    const timed = async () => {
      const start = performance.now();
      try { return await (trace === undefined ? observed() : trace.withInvocation({ id, mode: "recon" }, observed)); }
      finally { requestMs = performance.now() - start; }
    };
    try {
      completed = await (cpu !== undefined ? cpu.capture(timed)
        : collector !== undefined && mode === "server" && server !== undefined ? server.capture(timed) : timed());
      requestCompleted = true;
    }
    catch (cause) { outcome = "failure"; failureStage = "request"; fail("request", cause); }
    if (requestCompleted) {
      const start = performance.now();
      try { await sample.verify(completed); }
      catch (cause) { outcome = "failure"; failureStage = "verification"; fail("verification", cause); }
      finally { verificationMs = performance.now() - start; }
    }
    if (cpu !== undefined) {
      try { cpuEvidence = cpu.evidence(); }
      catch (cause) { invalidEvidence = "CPU diagnostic analysis failed";
        failures.push(describeFailure("cpuAnalysis", cause)); retainFailure(cause); }
      for (const failure of cpu.failures()) {
        failures.push(describeFailure(`cpu.${failure.stage}`, failure.cause)); retainFailure(failure.cause);
      }
    }
    if (collector !== undefined) {
      for (const cause of mode === "server" ? server?.failures() ?? [] : []) {
        failures.push(describeFailure("serverCollector", cause)); retainFailure(cause);
      }
      try {
        evidence = normalize(id, collector, trace);
        if (cpuEvidence !== undefined) evidence = { ...evidence, cpu: cpuEvidence };
        if (mode === "server" && server !== undefined) evidence = { ...evidence, server: server.evidence() };
        if (observation !== undefined && observation.status().failureCount > 0) evidence = { ...evidence,
          collection: { ...evidence.collection, failures: [...evidence.collection.failures, "Publication observation delivery failed"] } };
        Result.match(analyzeMeasurementEvidence(evidence), {
          onSuccess: value => { analysis = value; }, onFailure: error => { invalidEvidence = error.detail; },
        });
      } catch (cause) { invalidEvidence = failureTokens(cause).join(",") || "Diagnostic normalization failed";
        failures.push(describeFailure("normalization", cause)); retainFailure(cause); }
    }
    if (cpuEvidence !== undefined && analysis?.cpu === undefined) {
      try { cpuAnalysis = analyzeCpuEvidence(cpuEvidence); }
      catch (cause) { invalidEvidence = "CPU diagnostic analysis failed";
        failures.push(describeFailure("cpuAnalysis", cause)); retainFailure(cause); }
    }
  } finally {
    for (const detach of [() => scenario.setTrace?.(undefined), () => scenario.setEffectDiagnostics?.(undefined)]) {
      try { detach(); } catch (cause) { invalidEvidence = "Diagnostic binding did not detach";
        failures.push(describeFailure("diagnosticDetach", cause)); retainFailure(cause); }
    }
    try { trace?.close(); } catch (cause) { invalidEvidence = "Database observer did not settle";
      failures.push(describeFailure("databaseObserverClose", cause)); retainFailure(cause); }
    const start = performance.now();
    try { await sample.cleanup(); }
    catch (cause) { outcome = "failure"; failureStage ??= "sampleCleanup"; fail("sampleCleanup", cause); }
    finally { cleanupMs = performance.now() - start; }
  }
  if (cleanupFailures.length > 0) { outcome = "failure"; failureStage ??= "attemptCleanup";
    for (const cause of cleanupFailures) fail("attemptCleanup", cause); }
  const effectFailures = [...collector?.fullExits() ?? []].flatMap(([spanId, exit]) => Exit.isFailure(exit)
    ? [{ spanId, failure: describeFailure("effectSpan", exit.cause) }] : []);
  return { id, lane: "flarex", index, kind, requestMs, seedMs, verificationMs, cleanupMs,
    outcome, failureStage, failures, ...(collector === undefined ? {} : { effectFailures }),
    ...(evidence === undefined ? {} : { evidence }), ...(analysis === undefined ? {} : { analysis }),
    ...(cpuEvidence === undefined || evidence?.cpu !== undefined ? {} : { cpuEvidence }),
    ...(cpuAnalysis === undefined || analysis?.cpu !== undefined ? {} : { cpuAnalysis }),
    ...(invalidEvidence === undefined ? {} : { invalidEvidence }),
    ...(trace?.records()[0] === undefined ? {} : { driver: trace.records()[0] }) };
}

async function nativeRequest(resource: Awaited<ReturnType<typeof acquireNativeBusinessResource>>["resource"],
  name: typeof NativeScenarioName.Type, index: number, kind: "warmup" | "quiet", runId: string,
  retainFailure: (cause: unknown) => void): Promise<RequestReport> {
  const start = performance.now();
  const sample = await resource.prepareSample(name, `${runId.slice(0, 8)}-${index}`);
  const seedMs = performance.now() - start;
  let requestMs = 0, verificationMs = 0, cleanupMs = 0;
  let outcome: RequestReport["outcome"] = "success";
  let failureStage: string | null = null;
  const failures: FailureEvidence[] = [];
  const fail = (stage: string, cause: unknown) => { failures.push(describeFailure(stage, cause)); retainFailure(cause); };
  try {
    const start = performance.now();
    try { await sample.run(); }
    catch (cause) { outcome = "failure"; failureStage = "request"; fail("request", cause); }
    finally { requestMs = performance.now() - start; }
    if (outcome === "success") {
      const start = performance.now();
      try { await sample.verify(); }
      catch (cause) { outcome = "failure"; failureStage = "verification"; fail("verification", cause); }
      finally { verificationMs = performance.now() - start; }
    }
  } finally {
    const start = performance.now();
    try { await sample.cleanup(); }
    catch (cause) { outcome = "failure"; failureStage ??= "sampleCleanup"; fail("sampleCleanup", cause); }
    finally { cleanupMs = performance.now() - start; }
  }
  return { id: `${runId}:native:${index}`, lane: "native", index, kind, requestMs,
    seedMs, verificationMs, cleanupMs, outcome, failureStage, failures };
}

let commandActive = false;
async function run(options: typeof MeasureOptionsSchema.Type, operation: RunReport["operation"]) {
  assertCpuMeasurementIdle();
  if (commandActive) throw new InvalidMeasurementConfiguration({ detail: "SDK measurement commands must run sequentially" });
  commandActive = true;
  try { return await runOwned(options, operation); }
  finally { commandActive = false; }
}

async function runOwned(options: typeof MeasureOptionsSchema.Type, operation: RunReport["operation"]) {
  const runId = randomUUID();
  const samples: RequestReport[] = [];
  const pairs: RunReport["pairs"][number][] = [];
  const gates: RunReport["gates"][number][] = [];
  const failures: RunReport["failures"][number][] = [];
  const originalFailures: unknown[] = [];
  const retainFailure = (cause: unknown) => { originalFailures.push(cause); };
  const requested = options.samples ?? (operation === "compare" ? 30 : 1);
  const warmups = options.warmups ?? (operation === "compare" ? 5 : 1);
  const diagnostic = options.mode !== "quiet";
  const rootCpu = options.mode === "cpu" && options.observation === "root";
  const pairedDiagnostic = options.mode === "resources" || rootCpu;
  const driver = options.driver ?? "postgres";
  const name = options.selection.scenario;
  const descriptor = corePerformanceScenarios.find(scenario => scenario.name === name);
  if (descriptor === undefined) throw new InvalidMeasurementConfiguration({ detail: "Missing selected scenario owner" });
  const nativeName = operation === "compare" ? decodeNativeScenario(name) : undefined;
  let family: PreparedPerformanceFamily | undefined;
  let scenario: CorePerformanceScenario | undefined;
  let server: Awaited<ReturnType<typeof acquireServerMeasurementResource>> | undefined;
  const observerPairs: NonNullable<RunReport["observerPairs"]>[number][] = [];
  let native: Awaited<ReturnType<typeof acquireNativeBusinessResource>> | undefined;
  let setupMs = 0, cleanupMs = 0;
  let cleanup: RunReport["cleanup"] = "notAcquired";
  let before: Awaited<ReturnType<typeof measurementSourceDigest>> | undefined;
  let after: typeof before;
  let settingsBefore: unknown = null, settingsAfter: unknown = null;
  let infrastructureFailed = false;
  let stage = "acquisition";
  try {
    const start = performance.now();
    if (options.mode === "server") server = await acquireServerMeasurementResource({
      ...(process.env.FLAREX_MEASUREMENT_SERVER_LOG === undefined ? {} : {
        planLog: { path: resolve(process.env.FLAREX_MEASUREMENT_SERVER_LOG),
          prefix: "FXPLAN[%p][%d][%c][%Q]" } }) });
    const fixture = await import("../support/prepareScenario");
    family = await fixture.prepareCorePerformanceFamily(descriptor.family, { driver, size: options.size,
      sampleCount: warmups + requested * (pairedDiagnostic ? 2 : 1) +
        (diagnostic && !pairedDiagnostic ? 1 : 0),
      ...(server === undefined ? {} : { postgresEndpoints: server.endpoints }) });
    scenario = family.scenario(name);
    cleanup = "failed";
    // Arm only after installation and fixture preparation. Existing idle
    // sessions retire before warming so real serving sessions inherit the
    // declared isolated diagnostic profile.
    if (server !== undefined) {
      if (scenario.pools === undefined) throw new Error("Server measurement requires actual runtime pools");
      await server.arm([scenario.pools.controlPool, scenario.pools.targetPool]);
      await server.verifyRuntimePools(scenario.pools.controlPool, scenario.pools.targetPool);
    }
    await environment(scenario, driver, options.mode);
    if (operation === "compare") native = await acquireNativeBusinessResource();
    setupMs = performance.now() - start;
    stage = "warmup";
    for (let index = 0; index < warmups; index++) {
      samples.push(await flarexRequest(scenario, name, index, "warmup", "quiet", runId, retainFailure, server));
      if (native !== undefined && nativeName !== undefined)
        samples.push(await nativeRequest(native.resource, nativeName, index, "warmup", runId, retainFailure));
      if (samples.some(sample => sample.outcome === "failure")) break;
    }
    stage = "sourceAndSettingsBefore";
    before = await measurementSourceDigest(native !== undefined);
    settingsBefore = { flarex: await environment(scenario, driver, options.mode), native: native?.resource.settings ?? null };
    stage = "measurement";
    if (samples.every(sample => sample.outcome === "success")) {
      if (diagnostic && !pairedDiagnostic) samples.push(await flarexRequest(scenario, name, warmups, "calibration", "quiet", runId, retainFailure, server));
      for (let position = 0; position < requested && samples.every(sample => sample.outcome === "success"); position++) {
        if (pairedDiagnostic) {
          const requests: RequestReport[] = [];
          const kinds = position % 2 === 0 ? ["calibration", "diagnostic"] as const : ["diagnostic", "calibration"] as const;
          for (const kind of kinds) {
            const index = warmups + position * 2 + requests.length;
            const request = await flarexRequest(scenario, name, index, kind,
              kind === "calibration" ? "quiet" : options.mode, runId, retainFailure, server, options.observation);
            samples.push(request); requests.push(request);
            if (request.outcome === "failure") break;
          }
          const quiet = requests.find(request => request.kind === "calibration");
          const observed = requests.find(request => request.kind === "diagnostic");
          if (quiet?.outcome === "success" && observed?.outcome === "success" &&
            quiet.requestMs !== null && observed.requestMs !== null) observerPairs.push({ index: position,
            quietMs: quiet.requestMs, diagnosticMs: observed.requestMs, addedMs: observed.requestMs - quiet.requestMs });
          continue;
        }
        const index = warmups + position + (diagnostic ? 1 : 0);
        if (native === undefined) samples.push(await flarexRequest(scenario, name, index,
          diagnostic ? "diagnostic" : "quiet", options.mode, runId, retainFailure, server));
        else {
          // Alternate pair order to disclose and reduce systematic order bias.
          const requests: RequestReport[] = [];
          const lanes = position % 2 === 0 ? ["native", "flarex"] as const : ["flarex", "native"] as const;
          for (const lane of lanes) {
            if (nativeName === undefined) throw new Error("Missing verified native scenario");
            const request = lane === "native" ? await nativeRequest(native.resource, nativeName, index, "quiet", runId, retainFailure)
              : await flarexRequest(scenario, name, index, "quiet", "quiet", runId, retainFailure, server);
            // Retain each completed lane before acquiring its partner. A later
            // preparation failure must not discard an earlier actual request.
            samples.push(request);
            requests.push(request);
          }
          const nativeSample = requests.find(sample => sample.lane === "native");
          const flarexSample = requests.find(sample => sample.lane === "flarex");
          if (nativeSample?.outcome === "success" && flarexSample?.outcome === "success" &&
            nativeSample.requestMs !== null && flarexSample.requestMs !== null) pairs.push({ index,
            nativeMs: nativeSample.requestMs, flarexMs: flarexSample.requestMs,
            addedMs: flarexSample.requestMs - nativeSample.requestMs });
        }
      }
    }
    stage = "sourceAndSettingsAfter";
    after = await measurementSourceDigest(native !== undefined);
    settingsAfter = { flarex: await environment(scenario, driver, options.mode), native: await native?.resource.readSettings() ?? null };
  } catch (cause) {
    infrastructureFailed = true;
    retainFailure(cause); failures.push(describeFailure(stage, cause));
  } finally {
    const start = performance.now();
    const cleanupErrors: unknown[] = [];
    for (const close of [native?.close, family?.dispose, server?.close]) {
      if (close === undefined) continue;
      try { await close(); } catch (cause) { cleanupErrors.push(cause); }
    }
    cleanupMs = performance.now() - start;
    if (family !== undefined || server !== undefined || native !== undefined)
      cleanup = cleanupErrors.length === 0 ? "completed" : "failed";
    if (cleanupErrors.length > 0) {
      for (const cause of cleanupErrors) { retainFailure(cause); failures.push(describeFailure("commandCleanup", cause)); }
      infrastructureFailed = true;
    }
  }
  const summary = Result.getOrThrow(pairedSummary(pairs));
  const failed = infrastructureFailed || samples.some(sample => sample.outcome === "failure");
  const incomplete = samples.some(sample => sample.kind === "diagnostic" &&
    (rootCpu ? sample.invalidEvidence !== undefined || sample.cpuAnalysis?.complete !== true
      : sample.invalidEvidence !== undefined || sample.analysis?.diagnostic !== "complete"));
  const stableSources = before !== undefined && after !== undefined && before.digest === after.digest;
  const stableSettings = settingsBefore !== null && settingsAfter !== null && JSON.stringify(settingsBefore) === JSON.stringify(settingsAfter);
  gates.push({ name: "sourceStability", passed: stableSources, detail: "Authored package code, locks and loaded native sources remain stable" },
    { name: "settingsStability", passed: stableSettings, detail: "Ordinary-role durable settings are retained before and after" },
    { name: "cleanup", passed: cleanup === "completed", detail: "Owned command resources drained" });
  if (operation === "compare") gates.push(
    { name: "sampling", passed: warmups >= 5 && pairs.length >= 30 && pairs.length === requested,
      detail: `${pairs.length} fresh measured pairs, ${warmups} warmups per lane; acceptance requires at least 30 measured pairs` },
    { name: "completeRequests", passed: !failed && !incomplete, detail: "Both lanes completed and verified actual committed business results" },
    { name: "addedMedian", passed: summary !== null && summary.medianAddedMs <= 5, detail: "Paired added median must be <= 5 ms" },
    { name: "addedP95", passed: summary !== null && summary.p95AddedMs <= 10, detail: "Paired added P95 must be <= 10 ms" });
  const execution: RunReport["execution"] = failed ? "failed" : incomplete || !stableSources || !stableSettings ? "incomplete" : "complete";
  const acceptance: RunReport["acceptance"] = operation === "compare"
    ? execution === "complete" && gates.every(gate => gate.passed) ? "passed" : "failed" : "notEvaluated";
  const report: RunReport = { runId, operation, mode: options.mode, execution, acceptance,
    ...(rootCpu ? { observation: { selection: "root", timeline: "unavailable", driver: "unavailable" } } : {}),
    sampling: { requestedSamples: requested, warmups, size: options.size, scenario: name,
      driver, pairOrder: operation === "compare" || pairedDiagnostic ? "alternating" : "none" },
    ...(scenario?.workload === undefined ? {} : { workload: scenario.workload }), samples, pairs,
    ...(pairedDiagnostic ? { observerPairs } : {}),
    pairedSummary: summary, gates, setupMs, cleanupMs, cleanup, failures,
    sources: { before: before?.digest ?? null, after: after?.digest ?? null, files: before?.files ?? 0 },
    environment: { before: settingsBefore, after: settingsAfter } };
  let reports: Awaited<ReturnType<typeof persistMeasurementReport>>;
  try { reports = await persistMeasurementReport(resolve(options.outputDirectory), report); }
  catch (cause) {
    if (originalFailures.length > 0) throw new MeasurementInfrastructureError({ stage: "persistence",
      cause: new AggregateError([...originalFailures, cause instanceof MeasurementInfrastructureError ? cause.cause : cause],
        "Measurement and artifact persistence failed"),
      reports: cause instanceof MeasurementInfrastructureError ? cause.reports : {} });
    throw cause;
  }
  if (failed) throw new MeasurementRunFailure({ runId, execution: "failed", acceptance, reports,
    cause: originalFailures.length === 1 ? originalFailures[0] : new AggregateError(originalFailures, "Measurement execution failed") });
  return { runId, execution, acceptance, reports };
}

/** Configuration is decoded before importing fixtures or acquiring resources. */
export async function measure(options: typeof MeasureOptionsSchema.Type) {
  return run(configuration(decodeMeasure(options)), "measure");
}

/** Fresh quiet pairs; no tracer, observer, sink, exporter or profiler is installed. */
export async function compare(options: typeof CompareOptionsSchema.Type) {
  const configured = configuration(decodeCompare(options));
  return run({ ...configured, mode: "quiet", driver: "postgres" }, "compare");
}
