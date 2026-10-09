import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { Client, Pool } from "pg";
import { Cause, Effect, Exit, Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diagnoseHistoricalCaptures, HistoricalCaptureRunFailure } from "./historicalCapture";
import { FiniteStorageCaptureError } from "../../../../persistence-postgres/src/execution/finiteStorageCapture";
import type { createHistoricalCaptureFixture, HistoricalCaptureObserver } from "../support/historicalCaptureFixture";
import { serverLimits, type ServerMeasurementEvidence } from "./server";
import { serverPlanLimits, SERVER_PLAN_LOG_PREFIX } from "./collectors/plans";

const boundary = vi.hoisted(() => ({ acquire: vi.fn(), fixture: vi.fn(), validation: vi.fn(),
  digest: vi.fn(), writes: [] as string[], events: [] as string[] }));
vi.mock("./collectors/server", () => ({ acquireServerMeasurementResource: boundary.acquire }));
vi.mock("../support/historicalCaptureFixture", () => ({ createHistoricalCaptureFixture: boundary.fixture }));
vi.mock("./source", () => ({ measurementSourceDigest: boundary.digest }));
vi.mock("./collectors/plans", async importOriginal => ({
  ...await importOriginal<typeof import("./collectors/plans")>(), createServerPlanCapture: boundary.validation,
}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (_path: string, body: string) => { boundary.writes.push(body); }) }));

const state: { initialFailure: unknown; missingPlan: boolean; extraWindow: boolean; epochDriftAt: number;
  deallocationAt: number; runtimeDriftAt: number; foreignActivity: boolean; extraTargetCommand: boolean;
  armFailure: Error | undefined; runtimeSetupFailure: Error | undefined;
  verifierDefect: Error | undefined; lastCause: Cause.Cause<unknown> | undefined } = {
  initialFailure: undefined, missingPlan: false, extraWindow: false, epochDriftAt: Infinity,
  deallocationAt: Infinity, runtimeDriftAt: Infinity, foreignActivity: false, extraTargetCommand: false,
  armFailure: undefined, runtimeSetupFailure: undefined, verifierDefect: undefined, lastCause: undefined,
};
const options = { outputDirectory: resolve("unused-historical-test"),
  planLog: { path: resolve("unused-owned-plan.log"), prefix: SERVER_PLAN_LOG_PREFIX } } satisfies Parameters<typeof diagnoseHistoricalCaptures>[0];
let calls = 0, actualReads = 0, runtimeChecks = 0;
let pools: { target: Pool; setupControl: Pool; managedReadControl: Pool };
let latest: ServerMeasurementEvidence | undefined;

function statement(queryid: string, toplevel: boolean) {
  return { queryid, toplevel, userid: 2, dbid: 1, stats_since: "epoch", calls: toplevel && state.extraTargetCommand ? 2 : 1, plans: 0,
    total_plan_time: 0, total_exec_time: 1, rows: 1, shared_blks_hit: 1, shared_blks_read: 0,
    shared_blks_dirtied: 0, shared_blks_written: 0, temp_blks_read: 0, temp_blks_written: 0 };
}
function evidence(origin: number): ServerMeasurementEvidence {
  const plan = (queryId: string, backendPid = 12) => ({ ordinal: 0, queryId, durationMs: 1,
    header: { backendPid, database: "isolated", sessionId: "ab.cd", queryId: "11" },
    nodes: [{ id: 0, parentId: null, nodeType: "Result" as const, metrics: { "Actual Rows": 1, "Actual Loops": 1 } }], triggers: [] });
  const epoch = { stats_reset: calls >= state.epochDriftAt ? "changed" : "epoch", dealloc: calls >= state.deallocationAt ? 1 : 0 };
  const result: ServerMeasurementEvidence = { originMonotonicMs: origin, database: { database: "isolated", dbid: 1 }, root: { startMs: 0, endMs: 1 },
    limits: serverLimits, status: state.initialFailure === undefined ? "complete" : "incomplete",
    before: epoch, after: epoch,
    beforeStatements: [], afterStatements: [], statements: [statement("11", true), statement("22", false)],
    polls: state.foreignActivity || state.extraTargetCommand ? [{ startMs: 0, endMs: 1, serverAt: "time", activities: [{ pid: 13,
      backendStart: "foreign", dbid: 1, userid: 2, state: "active", queryid: "11", queryStart: null,
      waitType: null, waitEvent: null, blockerPids: [] }] }] : [],
    missedTicks: 0, droppedRows: 0, observers: [], failures: [],
    actualPlans: { status: "complete", coverage: "observedLogWindowOnly", flushCompleteness: "unproven", limits: serverPlanLimits,
      window: { startOffsetBytes: 0, endOffsetBytes: 1, readBytes: 1 }, plans: state.missingPlan ? [plan("11")] :
        state.extraTargetCommand ? [plan("11"), plan("22"), plan("11", 13)] : [plan("11"), plan("22")],
      ignoredBlocks: 0, foreignDatabasePlans: 0, failures: [] } };
  if (state.verifierDefect !== undefined) {
    const defect = state.verifierDefect;
    Object.defineProperty(result, "statements", { get: () => { throw defect; } });
  }
  return result;
}

beforeEach(() => {
  boundary.events.length = 0; boundary.writes.length = 0;
  calls = 0; actualReads = 0; runtimeChecks = 0; latest = undefined;
  state.initialFailure = undefined; state.missingPlan = false; state.extraWindow = false; state.lastCause = undefined;
  state.epochDriftAt = Infinity; state.deallocationAt = Infinity; state.runtimeDriftAt = Infinity; state.foreignActivity = false;
  state.extraTargetCommand = false; state.verifierDefect = undefined;
  state.armFailure = undefined; state.runtimeSetupFailure = undefined;
  pools = { target: new Pool(), setupControl: new Pool(), managedReadControl: new Pool() };
  const client = Object.assign(new Client(), { processID: 12, release: vi.fn() });
  const contaminant = Object.assign(new Client(), { processID: 13, release: vi.fn() });
  Object.defineProperty(client, "query", { value: async () => ({ rows: [] }), writable: true, configurable: true });
  Object.defineProperty(contaminant, "query", { value: async () => ({ rows: [] }), writable: true, configurable: true });
  boundary.digest.mockReset().mockImplementation(async () => {
    boundary.events.push("sourceBaseline"); return { digest: "same", files: 1 };
  });
  boundary.validation.mockReturnValue({ begin: async () => { boundary.events.push("logBegin"); },
    end: async () => { boundary.events.push("logEnd"); }, evidence: () => ({ status: "complete" }) });
  boundary.acquire.mockResolvedValue({ endpoints: {}, database: { database: "isolated", dbid: 1 },
    arm: async (selected: readonly Pool[]) => {
      expect(selected).toEqual([pools.target, pools.managedReadControl]); boundary.events.push("arm");
      if (state.armFailure !== undefined) throw state.armFailure;
    },
    verifyRuntimePools: async (control: Pool, target: Pool) => {
      expect(control).toBe(pools.managedReadControl); expect(target).toBe(pools.target);
      boundary.events.push("verifyRuntime");
      if (state.runtimeSetupFailure !== undefined) throw state.runtimeSetupFailure;
      runtimeChecks++;
      const environment = { userid: 2, settings: { diagnostic: { status: "observed",
        value: runtimeChecks >= state.runtimeDriftAt ? "changed" : "same" } } };
      return { control: environment, target: environment };
    },
    capture: async <A>(run: () => Promise<A>, selected?: Readonly<{ initialObservation: "required" }>) => {
      expect(selected).toEqual({ initialObservation: "required" }); calls++;
      const origin = performance.now();
      try { if (state.initialFailure !== undefined) throw state.initialFailure; return await run(); }
      finally { latest = evidence(origin); boundary.events.push("windowDrained"); }
    },
    evidence: () => latest, failures: () => state.initialFailure === undefined ? [] : [state.initialFailure],
    close: async () => { boundary.events.push("resourceClose"); },
  });
  const fixture = { pools,
    setup: { fixtureMilliseconds: 1, provisioningMilliseconds: 1, preparedModuleMilliseconds: 1, initialSeedingMilliseconds: 1 },
    runPasses: async (observe: HistoricalCaptureObserver) => {
      for (const pass of [1, 2] as const) for (let ordinal = 1; ordinal <= 9; ordinal++) {
        const captureCase = { ordinal, id: `input-${ordinal}`, owner: "FiniteStorageCapture.run", ancestry: ["Product.find"],
          tableName: "product", expectedRows: 1, expectedBound: 2, expectedMaximumHydratedOwners: 1 };
        const run = () => Effect.tryPromise({ try: async () => {
          actualReads++; pools.target.emit("acquire", client);
          await client.query({ name: `fx_finite_${"a".repeat(40)}`, text: "select $1", values: ["private-value"] });
          if (state.extraTargetCommand) {
            pools.target.emit("acquire", contaminant);
            await contaminant.query("select $1", ["foreign parameter"]);
          }
          return 7;
        }, catch: cause => new FiniteStorageCaptureError({ reason: "resourceFailure", cause }) });
        // This deliberate synthetic fixture edge feeds only the projected case
        // fields. The genuine fixture independently owns operation/demand proof.
        const observed: Effect.Effect<number, FiniteStorageCaptureError> = Reflect.apply(observe, undefined, [captureCase, pass, run]);
        const exit = await Effect.runPromiseExit(observed);
        if (Exit.isFailure(exit)) { state.lastCause = exit.cause; throw exit.cause; }
      }
      if (state.extraWindow) {
        const observed: Effect.Effect<number, FiniteStorageCaptureError> = Reflect.apply(observe, undefined,
          [{ ordinal: 1 }, 2, () => Effect.sync(() => { actualReads++; return 8; })]);
        const exit = await Effect.runPromiseExit(observed);
        if (Exit.isFailure(exit)) { state.lastCause = exit.cause; throw exit.cause; }
      }
      return { captureCount: 18, passCaptureCounts: [9, 9], rootOutcome: "aborted", workBytes: 0, workCalls: 0, changes: 0, events: 0 };
    },
    close: async () => {
      boundary.events.push("fixtureClose");
      const releases = await Promise.allSettled([pools.target.end(), pools.setupControl.end(), pools.managedReadControl.end()]);
      const failures = releases.flatMap(release => release.status === "rejected" ? [release.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, "Synthetic fixture release failed");
    },
  };
  boundary.fixture.mockImplementation(async (input: Parameters<typeof createHistoricalCaptureFixture>[0]) => {
    boundary.events.push("nativePrepared");
    try { await input.onPrepared?.(pools); }
    catch (cause) {
      // This synthetic foreign fixture boundary retains construction cleanup;
      // the real mixed fixture owns the prepared context before admission.
      try { await fixture.close(); }
      catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "Synthetic construction cleanup failed"); }
      throw cause;
    }
    boundary.events.push("initialAdmission");
    return fixture;
  });
});

describe("fixed historical orchestration", () => {
  it.each(["arm", "runtime", "source"] as const)("drains setup ownership before closing the resource when %s setup fails", async stage => {
    const original = new Error(`${stage} setup failed`);
    if (stage === "arm") state.armFailure = original;
    else if (stage === "runtime") state.runtimeSetupFailure = original;
    else boundary.digest.mockRejectedValueOnce(original);
    const releases = [pools.target, pools.setupControl, pools.managedReadControl].map(pool => vi.spyOn(pool, "end"));
    await expect(diagnoseHistoricalCaptures(options)).rejects.toMatchObject({
      _tag: "HistoricalCaptureRunFailure", cause: original,
    });
    expect(boundary.events).not.toContain("initialAdmission");
    expect(calls).toBe(0); expect(actualReads).toBe(0);
    expect(boundary.events.indexOf("fixtureClose")).toBeLessThan(boundary.events.indexOf("resourceClose"));
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
    expect(pools.target.listenerCount("acquire")).toBe(0);
    expect(boundary.writes[0]).toContain('"status": "incomplete"');
    expect(boundary.writes[0]).toContain('"cleanup": "unverified"');
  });

  it("retains setup and release failures with unverified constructor cleanup and attempts every release", async () => {
    const original = new Error("prepared setup failed"), releaseFailure = new Error("target release failed");
    state.armFailure = original;
    const finishTarget = pools.target.end.bind(pools.target);
    const targetRelease = vi.spyOn(pools.target, "end").mockImplementation(async () => {
      await finishTarget(); throw releaseFailure;
    });
    const otherReleases = [pools.setupControl, pools.managedReadControl].map(pool => vi.spyOn(pool, "end"));
    const failure = await diagnoseHistoricalCaptures(options).then(
      () => { throw new Error("Expected setup and release failure"); }, (cause: unknown) => cause);
    if (!(failure instanceof HistoricalCaptureRunFailure) || !(failure.cause instanceof AggregateError))
      throw new Error("Expected preserved constructor aggregate");
    expect(failure.cause.errors[0]).toBe(original);
    const cleanupFailure = failure.cause.errors[1];
    if (!(cleanupFailure instanceof AggregateError)) throw new Error("Expected preserved release aggregate");
    expect(cleanupFailure.errors).toEqual([releaseFailure]);
    expect(cleanupFailure.errors[0]).toBe(releaseFailure);
    for (const release of [targetRelease, ...otherReleases]) expect(release).toHaveBeenCalledOnce();
    expect(boundary.events).not.toContain("initialAdmission");
    expect(calls).toBe(0); expect(actualReads).toBe(0);
    expect(boundary.events.indexOf("fixtureClose")).toBeLessThan(boundary.events.indexOf("resourceClose"));
    expect(boundary.writes[0]).toContain('"cleanup": "unverified"');
  });

  it("runs two serial passes of nine and exports only observed safe evidence", async () => {
    const result = await diagnoseHistoricalCaptures(options);
    expect(result.status).toBe("complete");
    expect(calls).toBe(18); expect(actualReads).toBe(18);
    const raw = boundary.writes[0];
    expect(raw).toBeDefined();
    const report = Schema.decodeUnknownSync(Schema.Struct({ captures: Schema.Array(Schema.Struct({ pass: Schema.Int })) }))(JSON.parse(raw ?? "{}"));
    expect(report.captures.map(capture => capture.pass)).toEqual([...Array(9).fill(1), ...Array(9).fill(2)]);
    expect(raw).not.toContain("private-value"); expect(raw).not.toContain("select $1");
    expect(boundary.events.indexOf("logEnd")).toBeLessThan(boundary.events.indexOf("arm"));
    expect(boundary.events.slice(0, 7)).toEqual([
      "logBegin", "logEnd", "nativePrepared", "arm", "verifyRuntime", "sourceBaseline", "initialAdmission",
    ]);
    expect(boundary.events.slice(-2)).toEqual(["fixtureClose", "resourceClose"]);
    expect(pools.target.listenerCount("acquire")).toBe(0);
  });
  it("records an initial observer fault then interrupts before the first actual read and completes cleanup", async () => {
    state.initialFailure = new Error("opening observation refused");
    await expect(diagnoseHistoricalCaptures(options)).rejects.toSatisfy((failure: unknown) =>
      typeof failure === "object" && failure !== null && "cause" in failure && failure.cause instanceof AggregateError &&
      failure.cause.errors.includes(state.initialFailure));
    expect(calls).toBe(1); expect(actualReads).toBe(0);
    expect(state.lastCause?.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(boundary.writes[0]).toContain('"stage": "serverCapture"');
    expect(boundary.writes[0]).toContain('"status": "incomplete"');
    expect(boundary.events.slice(-3)).toEqual(["fixtureClose", "resourceClose", "sourceBaseline"]);
  });
  it("stops after missing direct-root nested plan evidence rather than counting its enclosing header", async () => {
    state.missingPlan = true;
    await expect(diagnoseHistoricalCaptures(options)).rejects.toMatchObject({ _tag: "HistoricalCaptureRunFailure" });
    expect(calls).toBe(1); expect(actualReads).toBe(1);
    expect(boundary.writes[0]).toContain('"stage": "missingExpectedDirectRootPlan"');
  });
  it("refuses a nineteenth capture before invoking the original closure", async () => {
    state.extraWindow = true;
    await expect(diagnoseHistoricalCaptures(options)).rejects.toMatchObject({ _tag: "HistoricalCaptureRunFailure" });
    expect(calls).toBe(18); expect(actualReads).toBe(18);
    expect(boundary.writes[0]).toContain('"stage": "captureBudgetOrOrder"');
  });
  it.each(["reset", "deallocation"] as const)("stops on statistics %s between input windows", async kind => {
    if (kind === "reset") state.epochDriftAt = 2;
    else state.deallocationAt = 2;
    await expect(diagnoseHistoricalCaptures(options)).rejects.toMatchObject({ _tag: "HistoricalCaptureRunFailure" });
    expect(calls).toBe(2); expect(actualReads).toBe(2);
    expect(boundary.writes[0]).toContain('"stage": "campaignStatisticsEpochDrift"');
  });
  it("stops on settings drift before submitting a read", async () => {
    state.runtimeDriftAt = 2;
    await expect(diagnoseHistoricalCaptures(options)).rejects.toMatchObject({ _tag: "HistoricalCaptureRunFailure" });
    expect(calls).toBe(0); expect(actualReads).toBe(0);
    expect(state.lastCause?.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(boundary.writes[0]).toContain('"stage": "runtimeSettingsDrift"');
  });
  it("stops on foreign sampled activity after its first bounded window", async () => {
    state.foreignActivity = true;
    await expect(diagnoseHistoricalCaptures(options)).rejects.toMatchObject({ _tag: "HistoricalCaptureRunFailure" });
    expect(calls).toBe(1); expect(actualReads).toBe(1);
    expect(boundary.writes[0]).toContain('"stage": "foreignActivity"');
  });
  it("stops on source drift before the second pass", async () => {
    boundary.digest.mockReset().mockResolvedValueOnce({ digest: "same", files: 1 }).mockResolvedValue({ digest: "changed", files: 1 });
    await expect(diagnoseHistoricalCaptures(options)).rejects.toMatchObject({ _tag: "HistoricalCaptureRunFailure" });
    expect(calls).toBe(9); expect(actualReads).toBe(9);
    expect(boundary.writes[0]).toContain('"stage": "sourceDrift"');
  });
  it("refuses a contaminating unnamed target command rather than allowing its PID and plans", async () => {
    state.extraTargetCommand = true;
    await expect(diagnoseHistoricalCaptures(options)).rejects.toMatchObject({ _tag: "HistoricalCaptureRunFailure" });
    expect(calls).toBe(1); expect(actualReads).toBe(1);
    expect(boundary.writes[0]).toContain('"stage": "unexpectedUnderlyingSubmissionCount"');
  });
  it("preserves a verifier programming defect instead of classifying it as diagnostic refusal", async () => {
    const original = new Error("verifier defect");
    state.verifierDefect = original;
    await expect(diagnoseHistoricalCaptures(options)).rejects.toMatchObject({ _tag: "HistoricalCaptureRunFailure" });
    expect(state.lastCause?.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === original)).toBe(true);
    expect(state.lastCause?.reasons.some(Cause.isInterruptReason)).toBe(false);
    expect(boundary.writes[0]).toContain('"outcome": "defect"');
  });
});
