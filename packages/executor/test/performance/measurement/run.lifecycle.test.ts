import { Pool } from "pg";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compare, measure } from "./index";
import { MeasurementRunFailure, type RunReport } from "./report";
import type { CpuEvidence } from "./cpu";
import { CPU_LIMITS } from "./cpu";
import type { CorePerformanceScenario } from "../support/scenario";
import { corePerformanceScenarios, type CorePerformanceScenarioName } from "../support/scenarioCatalog";

const boundary = vi.hoisted(() => {
  const events: string[] = [];
  const bindings: { kind: "effect" | "trace"; value: unknown }[] = [];
  const requests: { lane: "flarex" | "native"; index: number; effect: boolean; trace: boolean; publication: boolean }[] = [];
  const reports: RunReport[] = [];
  const state: { prepareFailure: unknown; requestFailure: unknown; sampleCleanupFailure: unknown;
    familyCleanupFailure: unknown; nativeCleanupFailure: unknown; effect: unknown; trace: unknown;
    returnValue: unknown; committed: number; cpuFailure: unknown; clearFailure: unknown } = {
    prepareFailure: undefined, requestFailure: undefined, sampleCleanupFailure: undefined,
    familyCleanupFailure: undefined, nativeCleanupFailure: undefined, effect: undefined, trace: undefined,
    returnValue: undefined, committed: 0, cpuFailure: undefined, clearFailure: undefined,
  };
  return { events, bindings, requests, reports, state,
    prepareFamily: vi.fn(), native: vi.fn(), source: vi.fn(), persist: vi.fn(), cpu: vi.fn(), idle: vi.fn() };
});
vi.mock("../support/prepareScenario", () => ({ prepareCorePerformanceFamily: boundary.prepareFamily }));
vi.mock("./collectors/native", () => ({ acquireNativeBusinessResource: boundary.native }));
vi.mock("./source", () => ({ measurementSourceDigest: boundary.source }));
vi.mock("./collectors/cpu", async importOriginal => ({ ...await importOriginal<typeof import("./collectors/cpu")>(),
  createCpuMeasurementCollector: boundary.cpu, assertCpuMeasurementIdle: boundary.idle }));
vi.mock("./report", async importOriginal => ({ ...await importOriginal<typeof import("./report")>(), persistMeasurementReport: boundary.persist }));

const outputDirectory = resolve("unused-sdk-lifecycle");
const settings = { postgresVersion: "18", role: "ordinary", superuser: false, bypassRls: false, createDb: false,
  createRole: false, synchronousCommit: "on", fsync: "on", fullPageWrites: "on", statementTracking: null, autoExplainMinDuration: null };
// A real Pool identity with a mocked foreign query boundary. No connection is opened.
const pool = new Pool({ max: 1 });
vi.spyOn(pool, "query").mockImplementation(async () => ({ command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [settings] }));
const verify = vi.fn<(result: unknown) => Promise<void>>(async () => { boundary.events.push("verify"); });
const cleanup = vi.fn(async () => {
  boundary.events.push("sampleCleanup");
  if (boundary.state.sampleCleanupFailure !== undefined) throw boundary.state.sampleCleanupFailure;
});
const prepareSample = vi.fn<CorePerformanceScenario["prepareSample"]>(async (_id, index) => {
  boundary.events.push(`prepareSample:${index}`);
  if (boundary.state.prepareFailure !== undefined) throw boundary.state.prepareFailure;
  return { verify, cleanup, run: async (observation) => {
    boundary.events.push(`run:${index}`);
    boundary.requests.push({ lane: "flarex", index, effect: boundary.state.effect !== undefined,
      trace: boundary.state.trace !== undefined, publication: observation !== undefined });
    if (boundary.state.requestFailure !== undefined) throw boundary.state.requestFailure;
    boundary.state.committed++;
    return boundary.state.returnValue;
  } };
});
const setTrace = vi.fn<NonNullable<CorePerformanceScenario["setTrace"]>>(value => {
  boundary.state.trace = value;
  boundary.bindings.push({ kind: "trace", value });
  boundary.events.push(value === undefined ? "traceClear" : "traceInstall");
});
const setEffect = vi.fn<NonNullable<CorePerformanceScenario["setEffectDiagnostics"]>>(value => {
  const previous = boundary.state.effect;
  boundary.state.effect = value;
  boundary.bindings.push({ kind: "effect", value });
  boundary.events.push(value === undefined ? "effectClear" : "effectInstall");
  if (value === undefined && previous !== undefined && boundary.state.clearFailure !== undefined) throw boundary.state.clearFailure;
});
const scenario = (postgres: boolean): CorePerformanceScenario => ({
  timings: { provisionAndPrepareMs: 1, runtimeConstructionMs: 1, initialSeedMs: 1 },
  ...(postgres ? { pools: { controlPool: pool, targetPool: pool } } : {}),
  prepareSample, setTrace, setEffectDiagnostics: setEffect, dispose: async () => { throw new Error("Scenario disposed outside family owner"); },
});
const selected: CorePerformanceScenarioName[] = [];
const family = {
  scenario: vi.fn((name: CorePerformanceScenarioName) => {
    selected.push(name);
    const call = boundary.prepareFamily.mock.calls.at(-1);
    const input: unknown = call?.[1];
    return scenario(typeof input === "object" && input !== null && "driver" in input && input.driver === "postgres");
  }),
  dispose: vi.fn(async () => {
    boundary.events.push("familyDispose");
    expect(boundary.state.effect).toBeUndefined();
    expect(boundary.state.trace).toBeUndefined();
    if (boundary.state.familyCleanupFailure !== undefined) throw boundary.state.familyCleanupFailure;
  }),
};
const native = {
  resource: { settings, readSettings: async () => settings,
    prepareSample: vi.fn(async (_name: string, marker: string) => {
      const index = Number(marker.split("-").at(-1));
      return { run: async () => {
        boundary.events.push(`nativeRun:${index}`);
        boundary.requests.push({ lane: "native", index, effect: boundary.state.effect !== undefined,
          trace: boundary.state.trace !== undefined, publication: false });
      }, verify: async () => { boundary.events.push("nativeVerify"); }, cleanup: async () => { boundary.events.push("nativeSampleCleanup"); } };
    }),
  },
  close: vi.fn(async () => { boundary.events.push("nativeClose");
    if (boundary.state.nativeCleanupFailure !== undefined) throw boundary.state.nativeCleanupFailure; }),
};
const emptyCpu = (): CpuEvidence => ({ complete: false,
  host: { pid: 1, threadId: 0, node: "24", v8: "13", platform: "win32", exclusivity: "controlled-isolate-only", externalContention: "unavailable" },
  limits: CPU_LIMITS, cpuIntervalMicroseconds: 1_000, allocationIntervalBytes: 32_768,
  includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
  callWindow: null, cpuStartCommand: null, cpuStopCommand: null, allocationWindow: null,
  cpuProfile: null, allocationProfile: null, counters: null, memory: { before: null, after: null },
  gc: { supported: true, droppedEvents: 0, events: [], observerIntervals: [] }, timedOut: false,
  retainedBytes: 0, droppedFailures: 0, failures: ["cpuStop"] });

beforeEach(() => {
  vi.clearAllMocks();
  boundary.events.length = 0; boundary.bindings.length = 0; boundary.requests.length = 0; boundary.reports.length = 0; selected.length = 0;
  Object.assign(boundary.state, { prepareFailure: undefined, requestFailure: undefined, sampleCleanupFailure: undefined,
    familyCleanupFailure: undefined, nativeCleanupFailure: undefined, effect: undefined, trace: undefined,
    returnValue: undefined, committed: 0, cpuFailure: undefined, clearFailure: undefined });
  boundary.prepareFamily.mockResolvedValue(family);
  boundary.native.mockResolvedValue(native);
  boundary.source.mockResolvedValue({ digest: "stable-source", files: 3 });
  boundary.persist.mockImplementation(async (_directory: string, report: RunReport) => {
    boundary.events.push("persist"); boundary.reports.push(report);
    return { raw: resolve(outputDirectory, `${report.runId}.json`), human: resolve(outputDirectory, `${report.runId}.md`) };
  });
  boundary.cpu.mockImplementation(() => ({
    capture: async <A>(invoke: () => Promise<A>): Promise<A> => { boundary.events.push("cpuStart");
      try { return await invoke(); } finally { boundary.events.push("cpuStop"); } },
    evidence: emptyCpu,
    failures: () => boundary.state.cpuFailure === undefined ? [] : [{ stage: "cpuStop", cause: boundary.state.cpuFailure }],
  }));
});

async function rejection(run: () => Promise<unknown>): Promise<MeasurementRunFailure> {
  const failure = await run().catch((cause: unknown) => cause);
  if (!(failure instanceof MeasurementRunFailure)) throw new Error("Expected SDK failed-run rejection", { cause: failure });
  return failure;
}
const quiet = { mode: "quiet", driver: "pglite", size: "small", warmups: 0, samples: 1, outputDirectory } satisfies
  Omit<Parameters<typeof measure>[0], "selection">;

describe("measurement SDK family and sample lifecycle", () => {
  it("alternates fresh quiet/resource pairs without constructing a profiler", async () => {
    await measure({ ...quiet, mode: "resources", warmups: 1, samples: 3,
      selection: { scenario: "mixed-product" } });
    expect(boundary.prepareFamily).toHaveBeenCalledExactlyOnceWith("mixed-product", { driver: "pglite", size: "small", sampleCount: 7 });
    expect(boundary.requests.map(request => [request.index, request.effect])).toEqual([
      [0, false], [1, false], [2, true], [3, true], [4, false], [5, false], [6, true],
    ]);
    expect(boundary.cpu).not.toHaveBeenCalled();
    const report = boundary.reports[0];
    expect(report?.observerPairs).toHaveLength(3);
    expect(report?.sampling.pairOrder).toBe("alternating");
    expect(report?.pairs).toEqual([]);
    expect(report?.acceptance).toBe("notEvaluated");
    expect(report?.samples.filter(sample => sample.kind === "diagnostic").every(sample =>
      sample.evidence?.events.some(event => event.kind === "effectSpan" && event.resources !== undefined))).toBe(true);
    expect(report?.samples.filter(sample => sample.kind !== "diagnostic").every(sample => sample.evidence === undefined)).toBe(true);
  });

  it("retains a completed observer lane when acquiring its fresh partner fails", async () => {
    const original = new Error("partner preparation failed");
    const prepare = prepareSample.getMockImplementation();
    if (prepare === undefined) throw new Error("Missing sample preparation witness");
    prepareSample.mockImplementationOnce(prepare).mockRejectedValueOnce(original);
    const result = await rejection(() => measure({ ...quiet, mode: "resources", samples: 2,
      selection: { scenario: "mixed-product" } }));
    expect(result.cause).toBe(original);
    expect(boundary.reports[0]?.samples).toMatchObject([{ kind: "calibration", outcome: "success" }]);
    expect(boundary.reports[0]?.observerPairs).toEqual([]);
    expect(boundary.reports[0]?.cleanup).toBe("completed");
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it.each(corePerformanceScenarios)("delegates $name to its catalog family with requested typical size", async descriptor => {
    const result = await measure({ ...quiet, size: "typical", selection: { scenario: descriptor.name } });
    expect(result.execution).toBe("complete");
    expect(boundary.prepareFamily).toHaveBeenCalledExactlyOnceWith(descriptor.family, { driver: "pglite", size: "typical", sampleCount: 1 });
    expect(selected).toEqual([descriptor.name]);
    expect(boundary.requests).toEqual([{ lane: "flarex", index: 0, effect: false, trace: false, publication: false }]);
    expect(boundary.cpu).not.toHaveBeenCalled();
    expect(family.dispose).toHaveBeenCalledOnce();
    expect(boundary.events.indexOf("sampleCleanup")).toBeLessThan(boundary.events.indexOf("familyDispose"));
    expect(boundary.events.indexOf("familyDispose")).toBeLessThan(boundary.events.indexOf("persist"));
  });

  it("provides genuine Effect/publication bindings only to the diagnostic request and clears them before family disposal", async () => {
    const result = await measure({ ...quiet, warmups: 1, mode: "timeline", selection: { scenario: "payload-populate-many" } });
    expect(result.execution).toBe("complete");
    expect(boundary.requests).toEqual([
      { lane: "flarex", index: 0, effect: false, trace: false, publication: false },
      { lane: "flarex", index: 1, effect: false, trace: false, publication: false },
      { lane: "flarex", index: 2, effect: true, trace: false, publication: true },
    ]);
    const report = boundary.reports[0];
    expect(report?.samples.filter(sample => sample.kind !== "diagnostic").every(sample => sample.evidence === undefined)).toBe(true);
    const diagnostic = report?.samples.find(sample => sample.kind === "diagnostic");
    expect(diagnostic?.evidence?.events.some(event => event.kind === "effectSpan" && event.name === "payload-populate-many")).toBe(true);
    expect(diagnostic?.analysis?.diagnostic).toBe("complete");
    expect(boundary.events.lastIndexOf("effectClear")).toBeLessThan(boundary.events.indexOf("familyDispose"));
  });

  it("verifies a valid undefined business result and performs every sample cleanup", async () => {
    await measure({ ...quiet, selection: { scenario: "product-delete" } });
    expect(verify).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(boundary.state.committed).toBe(1);
    expect(boundary.reports[0]?.samples[0]?.outcome).toBe("success");
  });

  it("preserves ordered request/sample/family cleanup failures by identity while disposing acquired resources", async () => {
    const request = new Error("private request"), sample = new Error("private sample cleanup"), command = new Error("private family cleanup");
    Object.assign(boundary.state, { requestFailure: request, sampleCleanupFailure: sample, familyCleanupFailure: command });
    const result = await rejection(() => measure({ ...quiet, selection: { scenario: "product-update" } }));
    if (!(result.cause instanceof AggregateError)) throw new Error("Expected combined original causes");
    const causes: readonly unknown[] = result.cause.errors;
    expect(causes).toEqual([request, sample, command]);
    [request, sample, command].forEach((cause, index) => expect(causes[index]).toBe(cause));
    expect(verify).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce(); expect(family.dispose).toHaveBeenCalledOnce();
    expect(boundary.reports[0]).toMatchObject({ execution: "failed", cleanup: "failed", samples: [{ outcome: "failure", failureStage: "request" }] });
    expect(JSON.stringify(boundary.reports)).not.toContain("private");
  });

  it("retains a single request rejection by identity after successful cleanup", async () => {
    const original = { _tag: "Refused" };
    boundary.state.requestFailure = original;
    const result = await rejection(() => measure({ ...quiet, selection: { scenario: "product-update" } }));
    expect(result.cause).toBe(original);
    expect(boundary.reports[0]?.cleanup).toBe("completed");
  });

  it("disposes the prepared family after sample preparation failure without invoking or cleaning an unacquired sample", async () => {
    const original = new Error("preparation fault");
    boundary.state.prepareFailure = original;
    const result = await rejection(() => measure({ ...quiet, selection: { scenario: "payload-find" } }));
    expect(result.cause).toBe(original);
    expect(boundary.requests).toEqual([]);
    expect(cleanup).not.toHaveBeenCalled(); expect(family.dispose).toHaveBeenCalledOnce();
    expect(boundary.reports[0]?.samples).toEqual([]);
    expect(boundary.reports[0]?.cleanup).toBe("completed");
  });

  it("marks a CPU observer fault incomplete while keeping the business result, verification and settlement successful", async () => {
    const fault = new Error("private CPU stop failure");
    boundary.state.cpuFailure = fault;
    boundary.state.returnValue = { committed: true };
    const result = await measure({ ...quiet, mode: "cpu", selection: { scenario: "mixed-application-payload" } });
    expect(result.execution).toBe("incomplete"); expect(result.acceptance).toBe("notEvaluated");
    expect(boundary.state.committed).toBe(2); // Quiet calibration and one independent diagnostic request.
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenLastCalledWith(boundary.state.returnValue);
    const sample = boundary.reports[0]?.samples.find(sample => sample.kind === "diagnostic");
    expect(sample?.outcome).toBe("success"); expect(sample?.failureStage).toBeNull();
    expect(sample?.analysis?.incompleteReasons).toContain("cpuDiagnosticIncomplete");
    expect(sample?.failures[0]?.tokens).toContain("Error");
    expect(sample?.failures[0]?.stage).toBe("cpu.cpuStop");
    expect(sample?.evidence?.root.outcome).toBe("success");
    expect(boundary.events.indexOf("cpuStop")).toBeLessThan(boundary.events.lastIndexOf("verify"));
    expect(boundary.reports[0]?.cleanup).toBe("completed");
  });

  it("attempts sample cleanup and family disposal when diagnostic binding detachment throws", async () => {
    boundary.state.clearFailure = new Error("private detach failure");
    const result = await measure({ ...quiet, mode: "timeline", selection: { scenario: "product-create-graph" } });
    expect(result.execution).toBe("incomplete");
    expect(cleanup).toHaveBeenCalledTimes(2); expect(family.dispose).toHaveBeenCalledOnce();
    expect(boundary.state.committed).toBe(2);
    const diagnostic = boundary.reports[0]?.samples.find(sample => sample.kind === "diagnostic");
    expect(diagnostic?.outcome).toBe("success");
    expect(diagnostic?.invalidEvidence).toBe("Diagnostic binding did not detach");
    expect(diagnostic?.failures[0]?.stage).toBe("diagnosticDetach");
    expect(boundary.events.lastIndexOf("effectClear")).toBeLessThan(boundary.events.lastIndexOf("sampleCleanup"));
    expect(boundary.reports[0]?.cleanup).toBe("completed");
  });

  it("retains original diagnostic detachment and command cleanup failures in order", async () => {
    const detach = new Error("detach fault"), command = new Error("family fault");
    boundary.state.clearFailure = detach; boundary.state.familyCleanupFailure = command;
    const result = await rejection(() => measure({ ...quiet, mode: "timeline", selection: { scenario: "product-delete" } }));
    if (!(result.cause instanceof AggregateError)) throw new Error("Expected retained diagnostic and cleanup causes");
    const causes: readonly unknown[] = result.cause.errors;
    expect(causes[0]).toBe(detach); expect(causes[1]).toBe(command);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(family.dispose).toHaveBeenCalledOnce();
  });

  it("keeps native comparison quiet and attempts both native and family cleanup after a close fault", async () => {
    const original = new Error("native close fault");
    boundary.state.nativeCleanupFailure = original;
    const result = await rejection(() => compare({ selection: { scenario: "mixed-product" }, size: "small", warmups: 0, samples: 1, outputDirectory }));
    expect(result.cause).toBe(original);
    expect(boundary.requests.map(request => request.lane)).toEqual(["native", "flarex"]);
    expect(boundary.requests.every(request => !request.effect && !request.trace && !request.publication)).toBe(true);
    expect(boundary.cpu).not.toHaveBeenCalled();
    expect(native.close).toHaveBeenCalledOnce(); expect(family.dispose).toHaveBeenCalledOnce();
    expect(boundary.events.indexOf("nativeClose")).toBeLessThan(boundary.events.indexOf("familyDispose"));
    expect(boundary.reports[0]?.pairs).toHaveLength(1);
  });
});
