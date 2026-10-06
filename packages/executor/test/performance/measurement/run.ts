import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { Data, Exit, Result, Schema } from "effect";
import type { Pool } from "pg";
import { analyzeMeasurementEvidence, pairedSummary } from "./analysis";
import type { MeasurementEvent, MeasurementEvidence, MeasurementObserver } from "./artifact";
import { databaseEvents } from "./collectors/database";
import { createEffectMeasurementCollector } from "./collectors/effect";
import { acquireNativeBusinessResource } from "./collectors/native";
import { MeasurementInfrastructureError, MeasurementRunFailure, persistMeasurementReport, type RequestReport, type RunReport } from "./report";
import { describeFailure, type FailureEvidence } from "./failure";
import { measurementSourceDigest } from "./source";
import { failureTokens } from "../support/measurement";
import { createMixedMutationPerformanceTrace } from "../../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import type { MixedMutationPerformanceSeries } from "../support/mixedMutationProductFixture";

const common = {
  selection: Schema.Struct({ scenario: Schema.Literal("mixed-product") }),
  size: Schema.Literal("small"),
  outputDirectory: Schema.String.check(Schema.makeFilter(value => value.trim().length > 0 ? undefined : "Expected output directory")),
  samples: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 }))),
  warmups: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))),
};
const MeasureOptionsSchema = Schema.Struct({ ...common,
  mode: Schema.Literals(["quiet", "timeline", "database"]),
  driver: Schema.optional(Schema.Literals(["postgres", "pglite"])),
}).check(Schema.makeFilter(value => value.driver === "pglite" && value.mode === "database"
  ? "Database diagnostics require the PostgreSQL driver" : undefined));
const CompareOptionsSchema = Schema.Struct(common);

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
async function environment(series: MixedMutationPerformanceSeries) {
  if (series.currency.resource.kind === "pglite") return { driver: "pglite" };
  const read = async (pool: Pool) => decodeEnvironment((await pool.query(`select
      current_setting('server_version') as "postgresVersion", current_user as role,
      rolsuper as superuser, rolbypassrls as "bypassRls", rolcreatedb as "createDb", rolcreaterole as "createRole",
      current_setting('synchronous_commit') as "synchronousCommit", current_setting('fsync') as fsync,
      current_setting('full_page_writes') as "fullPageWrites",
      current_setting('pg_stat_statements.track', true) as "statementTracking",
      current_setting('auto_explain.log_min_duration', true) as "autoExplainMinDuration"
      from pg_roles where rolname = current_user`)).rows[0]);
  const [control, target] = await Promise.all([read(series.currency.resource.control.pool), read(series.currency.resource.target.pool)]);
  for (const settings of [control, target]) if (settings.superuser || settings.bypassRls || settings.createDb || settings.createRole ||
    settings.synchronousCommit !== "on" || settings.fsync !== "on" || settings.fullPageWrites !== "on" ||
    (settings.statementTracking !== null && settings.statementTracking !== "none") ||
    (settings.autoExplainMinDuration !== null && settings.autoExplainMinDuration !== "-1")) {
    throw new Error("Measurement requires ordinary-role durable PostgreSQL settings with server diagnostics disabled");
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

async function flarexRequest(series: MixedMutationPerformanceSeries, index: number,
  kind: RequestReport["kind"], mode: RunReport["mode"], runId: string, retainFailure: (cause: unknown) => void): Promise<RequestReport> {
  const id = `${runId}:flarex:${index}`;
  const seedStart = performance.now();
  await series.prepareAttempt(index);
  const seedMs = performance.now() - seedStart;
  const collector = kind === "diagnostic" ? createEffectMeasurementCollector({ now: () => performance.now() }) : undefined;
  let trace: ReturnType<typeof createMixedMutationPerformanceTrace> | undefined;
  if (collector !== undefined && mode === "database") {
    if (series.currency.resource.kind !== "postgres") throw new Error("Expected PostgreSQL diagnostic resource");
    trace = createMixedMutationPerformanceTrace({ controlPool: series.currency.resource.control.pool,
      targetPool: series.currency.resource.target.pool, currentOperationId: collector.currentOperationId });
  }
  const observation = collector?.publicationObservation();
  series.setTrace(trace);
  series.setEffectDiagnostics(collector?.binding);
  let requestMs: number | null = null;
  let verificationMs = 0;
  let outcome: RequestReport["outcome"] = "success";
  let failureStage: string | null = null;
  const failures: FailureEvidence[] = [];
  const fail = (stage: string, cause: unknown) => { failures.push(describeFailure(stage, cause)); retainFailure(cause); };
  const cleanupFailures: unknown[] = [];
  let evidence: MeasurementEvidence | undefined;
  let analysis: RequestReport["analysis"];
  let invalidEvidence: string | undefined;
  let completed: Awaited<ReturnType<MixedMutationPerformanceSeries["runAttempt"]>> | undefined;
  try {
    const run = () => series.runAttempt(index, observation, undefined, cleanupFailures);
    const observed = () => collector === undefined ? run() : collector.runRequest("mixed-product", run);
    const start = performance.now();
    try { completed = await (trace === undefined ? observed() : trace.withInvocation({ id, mode: "recon" }, observed)); }
    catch (cause) { outcome = "failure"; failureStage = "request"; fail("request", cause); }
    finally { requestMs = performance.now() - start; }
    if (completed !== undefined) {
      const start = performance.now();
      try { await (await import("../support/mixedProductResult")).verifyMixedProductResult(completed, "product"); }
      catch (cause) { outcome = "failure"; failureStage = "verification"; fail("verification", cause); }
      finally { verificationMs = performance.now() - start; }
    }
    if (collector !== undefined) {
      try {
        evidence = normalize(id, collector, trace);
        if (observation !== undefined && observation.status().failureCount > 0) evidence = { ...evidence,
          collection: { ...evidence.collection, failures: [...evidence.collection.failures, "Publication observation delivery failed"] } };
        Result.match(analyzeMeasurementEvidence(evidence), {
          onSuccess: value => { analysis = value; }, onFailure: error => { invalidEvidence = error.detail; },
        });
      } catch (cause) { invalidEvidence = failureTokens(cause).join(",") || "Diagnostic normalization failed"; }
    }
  } finally {
    series.setTrace(undefined);
    series.setEffectDiagnostics(undefined);
    try { trace?.close(); } catch (cause) { invalidEvidence = "Database observer did not settle";
      failures.push(describeFailure("databaseObserverClose", cause)); }
  }
  if (cleanupFailures.length > 0) { outcome = "failure"; failureStage ??= "attemptCleanup";
    for (const cause of cleanupFailures) fail("attemptCleanup", cause); }
  const effectFailures = [...collector?.fullExits() ?? []].flatMap(([spanId, exit]) => Exit.isFailure(exit)
    ? [{ spanId, failure: describeFailure("effectSpan", exit.cause) }] : []);
  return { id, lane: "flarex", index, kind, requestMs, seedMs, verificationMs, cleanupMs: 0,
    outcome, failureStage, failures, ...(collector === undefined ? {} : { effectFailures }),
    ...(evidence === undefined ? {} : { evidence }), ...(analysis === undefined ? {} : { analysis }),
    ...(invalidEvidence === undefined ? {} : { invalidEvidence }),
    ...(trace?.records()[0] === undefined ? {} : { driver: trace.records()[0] }) };
}

async function nativeRequest(resource: Awaited<ReturnType<typeof acquireNativeBusinessResource>>["resource"],
  index: number, kind: "warmup" | "quiet", runId: string, retainFailure: (cause: unknown) => void): Promise<RequestReport> {
  const start = performance.now();
  const sample = await resource.prepareSample("mixed-product", `${runId.slice(0, 8)}-${index}`);
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

async function run(options: typeof MeasureOptionsSchema.Type, operation: RunReport["operation"]) {
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
  let series: MixedMutationPerformanceSeries | undefined;
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
    const fixture = await import("../support/mixedMutationProductFixture");
    series = await fixture.prepareMixedMutationPerformanceSeries({ driver: options.driver ?? "postgres",
      suffix: `sdk-${runId.slice(0, 8)}`, profile: "product", sampleCount: warmups + requested + (diagnostic ? 1 : 0) });
    cleanup = "failed";
    // Check the acquired serving profiles before warming or timing requests.
    await environment(series);
    if (operation === "compare") native = await acquireNativeBusinessResource();
    setupMs = performance.now() - start;
    stage = "warmup";
    for (let index = 0; index < warmups; index++) {
      samples.push(await flarexRequest(series, index, "warmup", "quiet", runId, retainFailure));
      if (native !== undefined) samples.push(await nativeRequest(native.resource, index, "warmup", runId, retainFailure));
      if (samples.some(sample => sample.outcome === "failure")) break;
    }
    stage = "sourceAndSettingsBefore";
    before = await measurementSourceDigest(native !== undefined);
    settingsBefore = { flarex: await environment(series), native: native?.resource.settings ?? null };
    stage = "measurement";
    if (samples.every(sample => sample.outcome === "success")) {
      if (diagnostic) samples.push(await flarexRequest(series, warmups, "calibration", "quiet", runId, retainFailure));
      for (let position = 0; position < requested && samples.every(sample => sample.outcome === "success"); position++) {
        const index = warmups + position + (diagnostic ? 1 : 0);
        if (native === undefined) samples.push(await flarexRequest(series, index, diagnostic ? "diagnostic" : "quiet", options.mode, runId, retainFailure));
        else {
          // Alternate pair order to disclose and reduce systematic order bias.
          const requests: RequestReport[] = [];
          const lanes = position % 2 === 0 ? ["native", "flarex"] as const : ["flarex", "native"] as const;
          for (const lane of lanes) {
            const request = lane === "native" ? await nativeRequest(native.resource, index, "quiet", runId, retainFailure)
              : await flarexRequest(series, index, "quiet", "quiet", runId, retainFailure);
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
    settingsAfter = { flarex: await environment(series), native: await native?.resource.readSettings() ?? null };
  } catch (cause) {
    infrastructureFailed = true;
    retainFailure(cause); failures.push(describeFailure(stage, cause));
  } finally {
    const start = performance.now();
    const cleanupErrors: unknown[] = [];
    for (const close of [native?.close, series?.close]) {
      if (close === undefined) continue;
      try { await close(); } catch (cause) { cleanupErrors.push(cause); }
    }
    cleanupMs = performance.now() - start;
    if (series !== undefined) cleanup = cleanupErrors.length === 0 ? "completed" : "failed";
    if (cleanupErrors.length > 0) {
      for (const cause of cleanupErrors) { retainFailure(cause); failures.push(describeFailure("commandCleanup", cause)); }
      infrastructureFailed = true;
    }
  }
  const summary = Result.getOrThrow(pairedSummary(pairs));
  const failed = infrastructureFailed || samples.some(sample => sample.outcome === "failure");
  const incomplete = samples.some(sample => sample.kind === "diagnostic" &&
    (sample.invalidEvidence !== undefined || sample.analysis?.diagnostic !== "complete"));
  const stableSources = before !== undefined && after !== undefined && before.digest === after.digest;
  const stableSettings = settingsBefore !== null && settingsAfter !== null && JSON.stringify(settingsBefore) === JSON.stringify(settingsAfter);
  gates.push({ name: "sourceStability", passed: stableSources, detail: "Authored package code, locks and loaded native sources remain stable" },
    { name: "settingsStability", passed: stableSettings, detail: "Ordinary-role durable settings are retained before and after" },
    { name: "cleanup", passed: cleanup === "completed", detail: "Owned command resources drained" });
  if (operation === "compare") gates.push(
    { name: "sampling", passed: warmups >= 5 && pairs.length >= 30 && pairs.length === requested,
      detail: `${pairs.length} fresh measured pairs, ${warmups} warmups per lane; first cohort supports 30 measured pairs` },
    { name: "completeRequests", passed: !failed && !incomplete, detail: "Both lanes completed and verified actual committed business results" },
    { name: "addedMedian", passed: summary !== null && summary.medianAddedMs <= 5, detail: "Paired added median must be <= 5 ms" },
    { name: "addedP95", passed: summary !== null && summary.p95AddedMs <= 10, detail: "Paired added P95 must be <= 10 ms" });
  const execution: RunReport["execution"] = failed ? "failed" : incomplete || !stableSources || !stableSettings ? "incomplete" : "complete";
  const acceptance: RunReport["acceptance"] = operation === "compare"
    ? execution === "complete" && gates.every(gate => gate.passed) ? "passed" : "failed" : "notEvaluated";
  const report: RunReport = { runId, operation, mode: options.mode, execution, acceptance,
    sampling: { requestedSamples: requested, warmups, size: "small", scenario: "mixed-product",
      driver: options.driver ?? "postgres", pairOrder: operation === "compare" ? "alternating" : "none" }, samples, pairs,
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
