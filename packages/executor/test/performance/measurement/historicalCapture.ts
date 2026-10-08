import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { Data, Effect, Exit, Result, Schema } from "effect";
import type { FiniteStorageCaptureError } from "../../../../persistence-postgres/src/finiteStorageCapture";
import { createHistoricalCaptureFixture, type HistoricalCaptureCase } from "../support/historicalCaptureFixture";
import { acquireServerMeasurementResource } from "./collectors/server";
import { createServerPlanCapture, SERVER_PLAN_LOG_PREFIX } from "./collectors/plans";
import { createHistoricalSubmissionObserver, HistoricalCaptureDiagnosticError,
  type HistoricalSubmission } from "./collectors/historicalSubmissions";
import { describeFailure, type FailureEvidence } from "./failure";
import { MeasurementInfrastructureError } from "./report";
import { analyzeServerEvidence, type ServerMeasurementEvidence } from "./server";
import { measurementSourceDigest } from "./source";

const OptionsSchema = Schema.Struct({
  outputDirectory: Schema.String.check(Schema.makeFilter(value => value.trim().length > 0 ? undefined : "Expected output directory")),
  provisioningConnectionString: Schema.optional(Schema.String),
  planLog: Schema.Struct({ path: Schema.String.check(Schema.makeFilter(value => isAbsolute(value) ? undefined : "Expected absolute log path")),
    prefix: Schema.Literal(SERVER_PLAN_LOG_PREFIX) }),
});
const decodeOptions = Schema.decodeUnknownSync(OptionsSchema, { onExcessProperty: "error" });
const CaseSchema = Schema.Struct({ ordinal: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9 })),
  id: Schema.String, owner: Schema.String, ancestry: Schema.Array(Schema.String), tableName: Schema.String,
  expectedRows: Schema.Natural, expectedBound: Schema.Natural, expectedMaximumHydratedOwners: Schema.NullOr(Schema.Natural) });
const decodeCase = Schema.decodeUnknownEffect(CaseSchema, { onExcessProperty: "error" });
type Case = typeof CaseSchema.Type;
type Resource = Awaited<ReturnType<typeof acquireServerMeasurementResource>>;
type Fixture = Awaited<ReturnType<typeof createHistoricalCaptureFixture>>;
type Environment = Awaited<ReturnType<Resource["verifyRuntimePools"]>>;

interface CaptureReport {
  readonly captureCase: Case; readonly pass: 1 | 2;
  readonly use: "firstObservedUse" | "secondPass";
  readonly status: "complete" | "incomplete";
  readonly backendReuse: "firstObservedUse" | "sameObservedSessionAndNamedStatement" | "unproven";
  readonly submissions: readonly HistoricalSubmission[];
  readonly evidence: ServerMeasurementEvidence | null;
  readonly analysis: ReturnType<typeof analyzeServerEvidence> | null;
  readonly failures: readonly FailureEvidence[];
}
interface HistoricalReport {
  readonly runId: string; readonly operation: "historical-capture-server";
  readonly status: "complete" | "incomplete";
  readonly budget: Readonly<{ maximumCaptureExecutions: 18; passes: 2; inputsPerPass: 9; completeBusinessGraphs: 0;
    measuredNativeCalls: 0; automaticRetries: 0 }>;
  readonly captures: readonly CaptureReport[];
  readonly actualCaptureExecutions: number;
  readonly cleanup: "notAcquired" | "completed" | "unverified" | "failed";
  readonly sources: Readonly<{ before: string | null; after: string | null }>;
  readonly environment: Readonly<{ before: Environment | null; after: Environment | null }>;
  readonly setup: Fixture["setup"] | null;
  readonly result: Awaited<ReturnType<Fixture["runPasses"]>> | null;
  readonly failures: readonly FailureEvidence[];
}
export class HistoricalCaptureRunFailure extends Data.TaggedError("HistoricalCaptureRunFailure")<{
  readonly runId: string; readonly cause: unknown; readonly reports: Readonly<{ raw: string; human: string }>;
}> {}

const infrastructure = Effect.fn("HistoricalCapture.infrastructure")(<A>(stage: string, work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: cause => new HistoricalCaptureDiagnosticError({ stage, cause }) }));
const refuse = (stage: string) => new HistoricalCaptureDiagnosticError({ stage });

/** This is the single foreign Promise collector edge. Capture the active Context
 * and cancellation signal, retain the core Exit separately, and drain collector
 * cleanup before replaying the original failure/defect/interruption Cause. */
export const captureHistoricalRead: <A>(resource: Readonly<{
  capture: <Value>(run: () => Promise<Value>, options?: Readonly<{ initialObservation: "required" }>) => Promise<Value>;
}>, runCapture: () => Effect.Effect<A, FiniteStorageCaptureError>) =>
  Effect.Effect<A, FiniteStorageCaptureError | HistoricalCaptureDiagnosticError> = Effect.fn("HistoricalCapture.read")(<A>(resource: Pick<Resource, "capture">,
  runCapture: () => Effect.Effect<A, FiniteStorageCaptureError>) => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    let coreExit: Exit.Exit<A, FiniteStorageCaptureError> | undefined;
    let pending: Promise<A> | undefined;
    const observed = yield* Effect.exit(restore(Effect.tryPromise({
      try: signal => {
        pending = resource.capture(async () => {
          coreExit = await Effect.runPromiseExitWith(context)(Effect.suspend(runCapture), { signal });
          if (Exit.isFailure(coreExit)) throw coreExit.cause;
          return coreExit.value;
        }, { initialObservation: "required" });
        return pending;
      }, catch: cause => new HistoricalCaptureDiagnosticError({ stage: "serverCapture", cause }),
    })));
    // tryPromise interruption signals cancellation but does not establish that
    // its foreign Promise settled. The masked drain joins both core and sampler.
    const draining = pending;
    if (draining !== undefined) yield* Effect.exit(infrastructure("serverCaptureDrain", () => draining));
    if (coreExit !== undefined && Exit.isFailure(coreExit)) return yield* Effect.failCause(coreExit.cause);
    if (Exit.isFailure(observed)) return yield* Effect.failCause(observed.cause);
    return observed.value;
  })));

const projectCase = Effect.fn("HistoricalCapture.projectCase")((value: HistoricalCaptureCase) => Effect.suspend(() =>
  decodeCase({ ordinal: value.ordinal, id: value.id, owner: value.owner, ancestry: value.ancestry,
    tableName: value.tableName, expectedRows: value.expectedRows, expectedBound: value.expectedBound,
    expectedMaximumHydratedOwners: value.expectedMaximumHydratedOwners }).pipe(
      Effect.mapError(cause => new HistoricalCaptureDiagnosticError({ stage: "captureDescriptor", cause })))));

function completeWindow(evidence: ServerMeasurementEvidence | undefined, submissions: readonly HistoricalSubmission[],
  servingRoleIds: ReadonlySet<number>): Result.Result<Readonly<{ evidence: ServerMeasurementEvidence;
    submitted: HistoricalSubmission }>, HistoricalCaptureDiagnosticError> {
  return Result.gen(function* () {
  if (evidence === undefined || evidence.status !== "complete") return yield* Result.fail(refuse("incompleteServerEvidence"));
  if (submissions.length === 0 || submissions.some(item => item.backendPid === null || item.fingerprint === null ||
    item.statementCount !== 1 || item.outcome !== "success" || item.endMonotonicMs === null)) return yield* Result.fail(refuse("incompleteSubmissions"));
  if (submissions.some(item => item.pool !== "target")) return yield* Result.fail(refuse("controlActivityInsideCapture"));
  if (submissions.length !== 1) return yield* Result.fail(refuse("unexpectedUnderlyingSubmissionCount"));
  const submitted = submissions[0];
  if (submitted.name?.startsWith("fx_finite_") !== true) return yield* Result.fail(refuse("unexpectedCaptureCount"));
  if (!/^fx_finite_[a-f0-9]{40}$/.test(submitted.name)) return yield* Result.fail(refuse("unexpectedCaptureStatementName"));
  const top = evidence.statements.filter(item => item.toplevel);
  if (top.reduce((sum, item) => sum + item.calls, 0) !== 1 ||
    top.some(item => !servingRoleIds.has(item.userid))) return yield* Result.fail(refuse("unexpectedServerSubmissions"));
  if (evidence.polls.some(poll => poll.activities.some(item => item.state === "active" &&
    (item.pid !== submitted.backendPid || !servingRoleIds.has(item.userid))))) return yield* Result.fail(refuse("foreignActivity"));
  const plans = evidence.actualPlans;
  if (plans.status === "unavailable" || plans.status !== "complete" || plans.foreignDatabasePlans !== 0 ||
    plans.plans.some(plan => plan.header.backendPid !== submitted.backendPid)) return yield* Result.fail(refuse("incompleteOrForeignPlans"));
  const expected = evidence.statements.filter(item => item.calls > 0 && (!item.toplevel || item.plans > 0));
  if (expected.some(statement => !plans.plans.some(plan => plan.queryId === statement.queryid)))
    return yield* Result.fail(refuse("missingExpectedDirectRootPlan"));
  // The log prefix Query ID is enclosing context; only the direct-root plan
  // identifier matches pg_stat_statements for the installed statement itself.
  const matchingTop = top.filter(statement => plans.plans.some(plan => plan.queryId === statement.queryid &&
    plan.header.backendPid === submitted.backendPid));
  if (!submitted.requiresPlan || matchingTop.reduce((sum, statement) => sum + statement.calls, 0) !== 1)
    return yield* Result.fail(refuse("missingInstalledEnvelopePlan"));
  return { evidence, submitted };
  });
}

function humanReport(report: HistoricalReport) {
  const rows = [`# Historical capture server diagnostic`, "", `Status: ${report.status}. Actual capture submissions: ${report.actualCaptureExecutions}/18; observation windows: ${report.captures.length}.`,
    "", "Two serial passes of nine source-equivalent newly seeded inputs. This does not replay unavailable literal parameters from the previous resources artifact.",
    "No complete business graph or native call is measured. Untimed fixture seeding is retained in setup.", "",
    "| Pass | Input | Use | Status | Submissions | Top execution ms | Nested execution ms |",
    "|---|---|---|---|---:|---:|---:|"];
  for (const capture of report.captures) rows.push(`| ${capture.pass} | ${capture.captureCase.ordinal} | ${capture.use} | ${capture.status} | ${capture.submissions.length} | ${capture.analysis?.topLevel.executionMs.toFixed(3) ?? "unavailable"} | ${capture.analysis?.nested.executionMs.toFixed(3) ?? "unavailable"} |`);
  rows.push("", "First observed use and second pass remain separate. Backend warmth is unproven without matching observed PID/session and named statement reuse.",
    "Top-level, nested and plan elapsed intervals overlap. Waits are samples; missing waits do not prove zero lock cost. Driver minus server elapsed is not network time.",
    "Plan coverage includes only parsed observed-window bytes; asynchronous flush completeness remains unproven. SQL, predicates and parameter values are excluded from exported evidence.",
    "Exact client CPU, queue and transport attribution remains unavailable.", "", `Cleanup: ${report.cleanup}.`, "");
  for (const failure of [...report.failures, ...report.captures.flatMap(capture => capture.failures)])
    rows.push(`- ${failure.stage}: ${failure.outcome}; ${failure.tokens.join(", ")}.`);
  return rows.join("\n");
}

async function persist(directory: string, report: HistoricalReport) {
  const reports: { raw?: string; human?: string } = {};
  try {
    await mkdir(directory, { recursive: true });
    const raw = resolve(directory, `${report.runId}.json`);
    await writeFile(raw, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    reports.raw = raw;
    const human = resolve(directory, `${report.runId}.md`);
    await writeFile(human, humanReport(report), { flag: "wx" });
    reports.human = human;
    return { raw, human };
  } catch (cause) { throw new MeasurementInfrastructureError({ stage: "persistence", cause, reports }); }
}

/** Fixed diagnostic only: two serial passes, eighteen actual captures maximum,
 * no retries, no full graph measurement and no native baseline execution. */
export async function diagnoseHistoricalCaptures(input: typeof OptionsSchema.Type) {
  const options = decodeOptions(input);
  const runId = `historical-capture-${randomUUID()}`;
  const captures: CaptureReport[] = [], failures: FailureEvidence[] = [], originals: unknown[] = [];
  let resource: Resource | undefined, fixture: Fixture | undefined;
  let observer: ReturnType<typeof createHistoricalSubmissionObserver> | undefined;
  let before: Awaited<ReturnType<typeof measurementSourceDigest>> | undefined;
  let after: typeof before;
  let result: HistoricalReport["result"] = null;
  const environments: { before: Environment | null; after: Environment | null } = { before: null, after: null };
  let cleanup: HistoricalReport["cleanup"] = "notAcquired";
  const fail = (stage: string, cause: unknown) => { originals.push(cause); failures.push(describeFailure(stage, cause)); };
  try {
    resource = await acquireServerMeasurementResource({ planLog: options.planLog, planLogContinuity: "required",
      ...(options.provisioningConnectionString === undefined ? {} : { provisioningConnectionString: options.provisioningConnectionString }) });
    cleanup = "completed";
    // Verify the exact bounded, regular, stable source before any read callback.
    const validation = createServerPlanCapture({ database: resource.database.database, source: options.planLog });
    await validation.begin(); await validation.end();
    if (validation.evidence().status !== "complete") throw refuse("unverifiedPlanSource");
    const ownedResource = resource;
    fixture = await createHistoricalCaptureFixture({ postgresEndpoints: resource.endpoints, suffix: runId,
      onPrepared: async pools => {
        await ownedResource.arm([pools.target, pools.managedReadControl]);
        environments.before = await ownedResource.verifyRuntimePools(pools.managedReadControl, pools.target);
        // Native preparation has loaded the actual compiled source island.
        // Establish the baseline before initial admission starts its real lease.
        before = await measurementSourceDigest(false);
      } }).catch((cause: unknown) => {
        // Before handoff the constructor owns cleanup, but its rejection does
        // not establish whether every internal release completed successfully.
        cleanup = "unverified";
        throw cause;
      });
    if (environments.before === null || before === undefined) throw refuse("unpreparedHistoricalFixture");
    const environment = environments.before, ownedFixture = fixture;
    const roleIds = new Set([environment.control.userid, environment.target.userid]);
    observer = createHistoricalSubmissionObserver(fixture.pools);
    const ownedObserver = observer;
    const manifest = new Map<string, Readonly<{ captureCase: Case; name: string | null; fingerprint: string | null;
      backendPid: number | null; sessionIds: readonly string[] }>>();
    let previousEvidence: ServerMeasurementEvidence | undefined;
    const observeDiagnostic = Effect.fn("HistoricalCapture.observe")(<A>(captureCase: HistoricalCaptureCase, pass: 1 | 2,
      runCapture: () => Effect.Effect<A, FiniteStorageCaptureError>) => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const ordinal = captures.length % 9 + 1, expectedPass = captures.length < 9 ? 1 : 2;
      if (captures.length >= 18 || pass !== expectedPass || captureCase.ordinal !== ordinal)
        return yield* Effect.fail(refuse("captureBudgetOrOrder"));
      if (pass === 2 && ordinal === 1) {
        const currentSource = yield* restore(infrastructure("sourceBetweenPasses", () => measurementSourceDigest(false)));
        if (currentSource.digest !== before?.digest) return yield* Effect.fail(refuse("sourceDrift"));
      }
      const projected = yield* projectCase(captureCase);
      if (ownedFixture.pools.setupControl.waitingCount !== 0 ||
        ownedFixture.pools.setupControl.idleCount !== ownedFixture.pools.setupControl.totalCount)
        return yield* Effect.fail(refuse("busyPrivilegedSetupPool"));
      const settings = yield* restore(infrastructure("runtimeSettings", () => ownedResource.verifyRuntimePools(
        ownedFixture.pools.managedReadControl, ownedFixture.pools.target)));
      if (JSON.stringify({ control: settings.control.settings, target: settings.target.settings }) !==
        JSON.stringify({ control: environment.control.settings, target: environment.target.settings }))
        return yield* Effect.fail(refuse("runtimeSettingsDrift"));
      const observedFailures: FailureEvidence[] = [];
      ownedObserver.begin();
      const execution = yield* Effect.exit(restore(captureHistoricalRead(ownedResource, runCapture)));
      const observed = ownedObserver.end();
      const evidence = ownedResource.evidence();
      let backendReuse: CaptureReport["backendReuse"] = pass === 1 ? "firstObservedUse" : "unproven";
      for (const cause of [...observed.failures, ...ownedResource.failures()]) {
        originals.push(cause);
        observedFailures.push(describeFailure("captureObservation", cause));
      }
      if (Exit.isFailure(execution)) {
        originals.push(execution.cause);
        observedFailures.push(describeFailure("captureExecution", execution.cause));
      }
      const verified = yield* Effect.exit(Effect.gen(function* () {
        if (observed.failures.length > 0) return yield* Effect.fail(refuse("submissionObservationFailed"));
        const complete = yield* Effect.fromResult(completeWindow(evidence, observed.submissions, roleIds));
        const submitted = complete.submitted, acceptedEvidence = complete.evidence;
        if (previousEvidence !== undefined) {
          if (JSON.stringify(previousEvidence.after) !== JSON.stringify(acceptedEvidence.before))
            return yield* Effect.fail(refuse("campaignStatisticsEpochDrift"));
          const epochKey = (item: ServerMeasurementEvidence["statements"][number]) =>
            JSON.stringify([item.userid, item.dbid, item.queryid, item.toplevel]);
          const beforeEpochs = new Map(acceptedEvidence.beforeStatements.map(item => [epochKey(item), item.stats_since]));
          if (previousEvidence.afterStatements.some(item => beforeEpochs.get(epochKey(item)) !== item.stats_since))
            return yield* Effect.fail(refuse("campaignStatementEntryEpochDrift"));
        }
        previousEvidence = acceptedEvidence;
        const sessionIds = acceptedEvidence.actualPlans.status === "unavailable" ? [] : [...new Set(acceptedEvidence.actualPlans.plans
          .filter(plan => plan.header.backendPid === submitted.backendPid).map(plan => plan.header.sessionId))];
        const prior = manifest.get(projected.id);
        if (pass === 1) {
          if (prior !== undefined) return yield* Effect.fail(refuse("duplicateCaptureInput"));
          manifest.set(projected.id, { captureCase: projected, name: submitted.name, fingerprint: submitted.fingerprint,
            backendPid: submitted.backendPid, sessionIds });
        } else if (prior === undefined || JSON.stringify(prior.captureCase) !== JSON.stringify(projected) ||
          prior.name !== submitted.name || prior.fingerprint !== submitted.fingerprint)
          return yield* Effect.fail(refuse("captureShapeDrift"));
        else if (prior.backendPid === submitted.backendPid && sessionIds.length === 1 && prior.sessionIds.length === 1 &&
          sessionIds[0] === prior.sessionIds[0]) backendReuse = "sameObservedSessionAndNamedStatement";
      }));
      if (Exit.isFailure(verified)) observedFailures.push(describeFailure("captureCompleteness", verified.cause));
      captures.push({ captureCase: projected, pass, use: pass === 1 ? "firstObservedUse" : "secondPass",
        backendReuse,
        status: Exit.isSuccess(execution) && Exit.isSuccess(verified) && observedFailures.length === 0 ? "complete" : "incomplete",
        submissions: observed.submissions, evidence: evidence ?? null,
        analysis: evidence === undefined ? null : analyzeServerEvidence(evidence, observed.submissions.map(item => ({
          id: `${projected.id}:${pass}:${item.ordinal}`, parentId: projected.id, backendPid: item.backendPid,
          startMs: item.startMonotonicMs - evidence.originMonotonicMs,
          endMs: item.endMonotonicMs === null ? null : item.endMonotonicMs - evidence.originMonotonicMs }))), failures: observedFailures });
      if (Exit.isFailure(execution)) return yield* Effect.failCause(execution.cause);
      if (Exit.isFailure(verified)) return yield* Effect.failCause(verified.cause);
      return execution.value;
    })));
    // The fixture's sealed read owner exposes only its real storage failures.
    // Diagnostic refusal is an explicit abort policy: keep the diagnostic fault
    // in this outer ledger, then interrupt the owned read before another input.
    const observe = <A>(captureCase: HistoricalCaptureCase, pass: 1 | 2,
      runCapture: () => Effect.Effect<A, FiniteStorageCaptureError>) => observeDiagnostic(captureCase, pass, runCapture).pipe(
      Effect.catchTag("HistoricalCaptureDiagnosticError", cause => Effect.gen(function* () {
        fail(cause.stage, cause);
        return yield* Effect.interrupt;
      })));
    result = await fixture.runPasses(observe);
    after = await measurementSourceDigest(false);
    if (before.digest !== after.digest) throw refuse("sourceDrift");
    if (captures.length !== 18 || captures.some(capture => capture.status !== "complete")) throw refuse("incompleteCaptureCampaign");
    environments.after = await resource.verifyRuntimePools(fixture.pools.managedReadControl, fixture.pools.target);
    if (JSON.stringify({ control: environments.after.control.settings, target: environments.after.target.settings }) !==
      JSON.stringify({ control: environment.control.settings, target: environment.target.settings })) throw refuse("runtimeSettingsDrift");
    if (result.captureCount !== 18 || result.passCaptureCounts[0] !== 9 || result.passCaptureCounts[1] !== 9 ||
      result.rootOutcome !== "aborted" || result.changes !== 0 || result.events !== 0) throw refuse("unexpectedReadRootOutcome");
  } catch (cause) { fail(cause instanceof HistoricalCaptureDiagnosticError ? cause.stage : "historicalCampaign", cause); }
  finally {
    try { observer?.close(); } catch (cause) { cleanup = "failed"; fail("submissionObserverCleanup", cause); }
    // The fixture drains its admitted root and closes every real pool before the
    // resource drops only its owned databases and roles.
    try { await fixture?.close(); } catch (cause) { cleanup = "failed"; fail("fixtureCleanup", cause); }
    try { await resource?.close(); } catch (cause) { cleanup = "failed"; fail("serverResourceCleanup", cause); }
    try { after ??= await measurementSourceDigest(false); } catch (cause) { fail("sourceAfter", cause); }
    if (before !== undefined && after !== undefined && before.digest !== after.digest && !failures.some(failure => failure.stage === "sourceDrift"))
      fail("sourceDrift", refuse("sourceDrift"));
  }
  const report: HistoricalReport = { runId, operation: "historical-capture-server",
    status: failures.length === 0 && captures.length === 18 ? "complete" : "incomplete",
    budget: { maximumCaptureExecutions: 18, passes: 2, inputsPerPass: 9, completeBusinessGraphs: 0, measuredNativeCalls: 0, automaticRetries: 0 },
    captures, actualCaptureExecutions: captures.reduce((sum, capture) => sum + capture.submissions.filter(item =>
      item.name?.startsWith("fx_finite_") === true).length, 0), cleanup,
    sources: { before: before?.digest ?? null, after: after?.digest ?? null }, environment: environments,
    setup: fixture?.setup ?? null, result, failures };
  let reports: Awaited<ReturnType<typeof persist>>;
  try { reports = await persist(resolve(options.outputDirectory), report); }
  catch (cause) {
    if (originals.length > 0 && cause instanceof MeasurementInfrastructureError)
      throw new MeasurementInfrastructureError({ stage: "persistence", reports: cause.reports,
        cause: new AggregateError([...originals, cause.cause], "Historical diagnostic and artifact persistence failed") });
    throw cause;
  }
  if (report.status !== "complete") throw new HistoricalCaptureRunFailure({ runId, reports,
    cause: originals.length === 1 ? originals[0] : new AggregateError(originals, "Historical capture diagnostic incomplete") });
  return { runId, status: report.status, reports };
}
