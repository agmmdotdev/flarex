import { resolve } from "node:path";
import { Result } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeasurementInfrastructureError, persistMeasurementReport, type RunReport } from "./report";
import { analyzeMeasurementEvidence } from "./analysis";
import { analyzeCpuEvidence, CPU_LIMITS, type CpuEvidence } from "./cpu";
import { serverLimits, type ServerMeasurementEvidence } from "./server";
import { serverPlanLimits } from "./collectors/plans";
import { calibrateRootCounters } from "./rootCounters";

const filesystem = vi.hoisted(() => ({
  mkdir: vi.fn<typeof import("node:fs/promises").mkdir>(),
  writeFile: vi.fn<typeof import("node:fs/promises").writeFile>(),
}));
vi.mock("node:fs/promises", () => filesystem);

const directory = resolve("measurement-artifact-test");
function report(): RunReport {
  return { runId: "retained-request", operation: "measure", mode: "database", execution: "complete", acceptance: "notEvaluated",
    sampling: { requestedSamples: 1, warmups: 0, size: "small", scenario: "mixed-product", driver: "postgres", pairOrder: "none" },
    samples: [], pairs: [], pairedSummary: null, gates: [], setupMs: 1, cleanupMs: 2, cleanup: "completed", failures: [],
    sources: { before: "source", after: "source", files: 1 }, environment: { before: null, after: null } };
}

async function persistenceFailure(input = report()) {
  try {
    await persistMeasurementReport(directory, input);
  } catch (failure) {
    if (failure instanceof MeasurementInfrastructureError) return failure;
    throw failure;
  }
  throw new Error("Expected artifact persistence to reject");
}

beforeEach(() => {
  filesystem.mkdir.mockReset();
  filesystem.writeFile.mockReset();
  filesystem.mkdir.mockResolvedValue(undefined);
  filesystem.writeFile.mockResolvedValue(undefined);
});

describe("measurement artifact persistence", () => {
  it("exports standalone root CPU profiles and discloses disabled allocation and absent timeline accounting", async () => {
    const cpu: CpuEvidence = { complete: false,
      host: { pid: 1, threadId: 0, node: "24", v8: "13", platform: "win32", exclusivity: "controlled-isolate-only", externalContention: "unavailable" },
      limits: CPU_LIMITS, cpuIntervalMicroseconds: 1000, allocationSampling: "disabled", allocationIntervalBytes: null,
      includeObjectsCollectedByMajorGC: null, includeObjectsCollectedByMinorGC: null,
      callWindow: { startMonotonicMs: 10, endMonotonicMs: 12 }, cpuStartCommand: null, cpuStopCommand: null, allocationWindow: null,
      cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: "work", scriptId: "1", url: "./packages/work.ts", lineNumber: 1, columnNumber: 0 }, children: [] }],
        samples: [1], timeDeltas: [1000], startTime: 10000, endTime: 12000 },
      allocationProfile: null, counters: null, memory: { before: null, after: null },
      gc: { supported: true, events: [], observerIntervals: [], droppedEvents: 0 }, timedOut: false,
      retainedBytes: 0, droppedFailures: 0, failures: ["cpuStop"] };
    const input: RunReport = { ...report(), mode: "cpu", observation: { selection: "root", timeline: "unavailable", driver: "unavailable" },
      observerPairs: [{ index: 0, quietMs: 1, diagnosticMs: 2, addedMs: 1 }], samples: [{
      id: "root", lane: "flarex", index: 1, kind: "diagnostic", requestMs: 2, seedMs: 0,
      verificationMs: 0, cleanupMs: 0, outcome: "success", failureStage: null, failures: [],
      cpuEvidence: cpu, cpuAnalysis: analyzeCpuEvidence(cpu),
    }] };
    const paths = await persistMeasurementReport(directory, input);
    expect(paths.profiles).toEqual([resolve(directory, "retained-request-flarex-1.cpuprofile")]);
    expect(filesystem.writeFile).toHaveBeenCalledTimes(3);
    expect(filesystem.writeFile.mock.calls[2]?.[1]).toBe(JSON.stringify(cpu.cpuProfile) + "\n");
    const raw = filesystem.writeFile.mock.calls[0]?.[1], human = filesystem.writeFile.mock.calls[1]?.[1];
    expect(raw).toBe(JSON.stringify(input, null, 2) + "\n");
    expect(human).toContain("CPU observation: root. Full operation timeline: unavailable. Driver detail: unavailable.");
    expect(human).toContain("Allocation sampling: disabled");
    expect(human).toContain("Effect tracing and its context hook, SQL tracing, publication observation and heap sampling are absent");
    expect(human).toContain("| Observer pair | Quiet Flarex ms | Root CPU diagnostic ms |");
    expect(human).toContain("outside this timed difference");
    expect(human).toContain("separate business executions, not native acceptance");
    expect(human).toContain("never be subtracted");
    expect(human).not.toContain("Strict deepest-operation wall");
    expect(human).not.toContain("Driver-await union: 0");
  });

  it.each(["owners", "complete"] as const)("keeps resource request table contiguous with %s observation metadata", async selection => {
    const input: RunReport = { ...report(), mode: "resources", observation: {
      selection, timeline: selection === "owners" ? "unavailable" : "collected",
      driver: selection === "owners" ? "unavailable" : "collected" }, samples: [{
      id: "quiet", lane: "flarex", index: 0, kind: "calibration", requestMs: 1,
      seedMs: 0, verificationMs: 0, cleanupMs: 0, outcome: "success", failureStage: null, failures: [],
    }, {
      id: "observed", lane: "flarex", index: 1, kind: "diagnostic", requestMs: 2,
      seedMs: 0, verificationMs: 0, cleanupMs: 0, outcome: "success", failureStage: null, failures: [],
    }] };
    await persistMeasurementReport(directory, input);
    const human = filesystem.writeFile.mock.calls[1]?.[1];
    if (typeof human !== "string") throw new Error("Missing human report");
    const table = ["| Request | Lane | Kind | Complete call ms | Outcome |", "|---|---|---|---:|---|",
      "| quiet | flarex | calibration | 1.000 | success |", "| observed | flarex | diagnostic | 2.000 | success |"].join("\n");
    expect(human).toContain(table);
    expect(human.indexOf(`Resource observation: ${selection}.`)).toBeLessThan(human.indexOf(table));
  });

  it("reports selected owner counters with intentionally unavailable timeline and database detail", async () => {
    const input: RunReport = { ...report(), mode: "resources", observation: {
      selection: "owners", timeline: "unavailable", driver: "unavailable" }, samples: [{
      id: "selected", lane: "flarex", index: 0, kind: "diagnostic", requestMs: 1,
      seedMs: 0, verificationMs: 0, cleanupMs: 0, outcome: "success", failureStage: null, failures: [],
      ownerResources: { diagnostic: "complete", incompleteReasons: [], operations: [{ id: "root", name: "root", owner: null,
        wallMs: 1, counterWindowMs: 1, processCpuMs: 2, threadCpuMs: null, eventLoopIdleMs: 0, eventLoopActiveMs: 1 }] },
    }] };
    await persistMeasurementReport(directory, input);
    const raw = filesystem.writeFile.mock.calls[0]?.[1];
    const human = filesystem.writeFile.mock.calls[1]?.[1];
    expect(raw).not.toContain("driverAwaitUnionMs");
    expect(human).toContain("Full operation timeline: unavailable. Driver detail: unavailable");
    expect(human).toContain("Selected collection integrity: complete");
    expect(human).toContain("| root | 1.000 | 2.000 | unavailable | 0.000 |");
    expect(human).not.toContain("Strict deepest-operation wall");
    expect(human).not.toContain("Driver-await union: 0");
  });
  it("retains minimal root CPU evidence and clearly separates calibration and unresolved resolution from acceptance", async () => {
    let clock = 0, cpu = 0;
    const counterCalibration = calibrateRootCounters({ now: () => clock++, read: () => ({
      process: { user: cpu++, system: 0 }, thread: null, eventLoop: { idle: 0, active: 0, utilization: 0 } }) });
    const rootCounters = counterCalibration[0];
    if (rootCounters === undefined) throw new Error("Missing calibration sample");
    const input: RunReport = { ...report(), mode: "root-counters", operation: "compare", counterCalibration,
      samples: [{ id: "root", lane: "native", index: 0, kind: "diagnostic", requestMs: 1,
        seedMs: 0, verificationMs: 10, cleanupMs: 20, outcome: "success", failureStage: null, failures: [], rootCounters }],
      cpuPairs: [{ index: 0, nativeRequestId: "native", flarexRequestId: "flarex", process: {
        nativeUserMicroseconds: 10, nativeSystemMicroseconds: 0, flarexUserMicroseconds: 8, flarexSystemMicroseconds: 0,
        addedUserMicroseconds: -2, addedSystemMicroseconds: 0, addedTotalMicroseconds: -2 }, thread: null }] };
    await persistMeasurementReport(directory, input);
    expect(filesystem.writeFile.mock.calls[0]?.[1]).toBe(JSON.stringify(input, null, 2) + "\n");
    const human = filesystem.writeFile.mock.calls[1]?.[1];
    expect(human).toContain("| 0 | -2 | unavailable |");
    expect(human).toContain("actual platform process/thread counter resolution and monotonic clock precision are unknown");
    expect(human).toContain("back-to-back pairs calibrate resource acquisition");
    expect(human).toContain("retained without subtraction");
    expect(human).toContain("not quiet elapsed acceptance");
    expect(filesystem.writeFile).toHaveBeenCalledTimes(2); // No profiler exports.
  });
  it("renders true plan IDs separately from logged query context and leaves absent IDs unavailable", async () => {
    const server: ServerMeasurementEvidence = { originMonotonicMs: 0, database: { database: "isolated", dbid: 1 },
      root: { startMs: 0, endMs: 1 }, limits: serverLimits, status: "complete", before: null, after: null,
      statements: [], beforeStatements: [], afterStatements: [], polls: [], missedTicks: 0, droppedRows: 0, observers: [], failures: [],
      actualPlans: { status: "complete", coverage: "observedLogWindowOnly", flushCompleteness: "unproven", limits: serverPlanLimits,
        window: { startOffsetBytes: 0, endOffsetBytes: 100, readBytes: 100 }, ignoredBlocks: 0, foreignDatabasePlans: 0, failures: [],
        plans: ["9223372036854775807", null].map((queryId, ordinal) => ({ ordinal, queryId,
          header: { backendPid: 123, database: "isolated", sessionId: "68abcdef.7b", queryId: "0" }, durationMs: 1,
          nodes: [{ id: 0, parentId: null, nodeType: "Result", metrics: { "Actual Rows": 1, "Actual Loops": 1 } }], triggers: [] })) } };
    const analysis = Result.getOrThrow(analyzeMeasurementEvidence({ requestId: "request",
      clock: { id: "monotonic", unit: "milliseconds", precisionMs: null, originMonotonicMs: 0 },
      root: { startMs: 0, endMs: 1, outcome: "success" }, events: [], postRequestObservers: [],
      collection: { capacity: 100, droppedEvents: 0, lostContextEvents: 0, failures: [] }, server }));
    await persistMeasurementReport(directory, { ...report(), mode: "server", samples: [{
      id: "request", lane: "flarex", index: 0, kind: "diagnostic", requestMs: 1, seedMs: 0,
      verificationMs: 0, cleanupMs: 0, outcome: "success", failureStage: null, failures: [], analysis, evidence: analysis.evidence,
    }] });
    const human = filesystem.writeFile.mock.calls[1]?.[1];
    expect(human).toContain("| Plan query ID | Logged context query ID | PID / session |");
    expect(human).toContain("| 9223372036854775807 | 0 | 123 / 68abcdef.7b | 1.000 | Result |");
    expect(human).toContain("| unavailable | 0 | 123 / 68abcdef.7b | 1.000 | Result |");
    expect(human).not.toContain("| Observed query ID |");
  });

  it("exports sanitized CPU samples and retains partial profile paths on allocation export failure", async () => {
    const callFrame = { functionName: "work", scriptId: "1", url: "./packages/work.ts", lineNumber: 1, columnNumber: 0 };
    const cpu: CpuEvidence = { complete: false,
      host: { pid: 1, threadId: 0, node: "24", v8: "13", platform: "win32", exclusivity: "controlled-isolate-only", externalContention: "unavailable" },
      limits: CPU_LIMITS, cpuIntervalMicroseconds: 1000, allocationSampling: "enabled", allocationIntervalBytes: 32768,
      includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
      callWindow: null, cpuStartCommand: null, cpuStopCommand: null, allocationWindow: null,
      cpuProfile: { nodes: [{ id: 1, callFrame, children: [] }], samples: [1], timeDeltas: [1000], startTime: 0, endTime: 1000 },
      allocationProfile: { nodes: [{ id: 1, parentId: null, callFrame, selfSize: 32 }], samples: [{ size: 32, nodeId: 1, ordinal: 1 }] },
      counters: null, memory: { before: null, after: null }, gc: { supported: false, events: [], observerIntervals: [], droppedEvents: 0 },
      timedOut: false, retainedBytes: 0, droppedFailures: 0, failures: [] };
    const original = new Error("allocation artifact unavailable");
    filesystem.writeFile.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(original);
    const failure = await persistenceFailure({ ...report(), mode: "cpu", samples: [{
      id: "request", lane: "flarex", index: 1, kind: "diagnostic", requestMs: 1, seedMs: 0,
      verificationMs: 0, cleanupMs: 0, outcome: "success", failureStage: null, failures: [],
      evidence: { requestId: "request", clock: { id: "monotonic", unit: "milliseconds", precisionMs: null, originMonotonicMs: 0 },
        root: { startMs: 0, endMs: 1, outcome: "success" }, events: [], postRequestObservers: [],
        collection: { capacity: 1, droppedEvents: 0, lostContextEvents: 0, failures: [] }, cpu },
    }] });
    expect(failure.cause).toBe(original);
    expect(failure.reports).toEqual({ raw: resolve(directory, "retained-request.json"), human: resolve(directory, "retained-request.md"),
      profiles: [resolve(directory, "retained-request-flarex-1.cpuprofile")] });
    expect(filesystem.writeFile.mock.calls[2]?.[1]).toBe(JSON.stringify(cpu.cpuProfile) + "\n");
  });
  it("keeps strict attribution, enclosing context, coordination and unavailable database evidence distinct", async () => {
    const analysis = Result.getOrThrow(analyzeMeasurementEvidence({ requestId: "request",
      clock: { id: "monotonic", unit: "milliseconds", precisionMs: null, originMonotonicMs: 0 },
      root: { startMs: 0, endMs: 10, outcome: "success" }, postRequestObservers: [],
      collection: { capacity: 100, droppedEvents: 0, lostContextEvents: 0, failures: [] },
      events: [
        { kind: "phase", id: "publisher", sequence: 0, name: "publisher", role: "operation", startMs: 0, endMs: 10,
          owner: "publication", site: "publisher", parentId: null },
        { kind: "phase", id: "supervisor", sequence: 1, name: "supervisor", role: "coordination", startMs: 0, endMs: 10,
          owner: null, site: "supervisor", parentId: null },
        { kind: "phase", id: "unknown", sequence: 2, name: "lower body", role: "operation", startMs: 1, endMs: 9,
          owner: null, site: "lower body", parentId: "publisher" },
      ] }));
    await persistMeasurementReport(directory, { ...report(), mode: "timeline", samples: [{
      id: "request", lane: "flarex", index: 0, kind: "diagnostic", requestMs: 11, seedMs: 1,
      verificationMs: 1, cleanupMs: 0, outcome: "success", failureStage: null, failures: [], analysis,
    }] });
    const human = filesystem.writeFile.mock.calls[1]?.[1];
    expect(human).toContain("Strict deepest-operation wall: attributed 0.000 ms; ambiguous 2.000 ms; unattributed 8.000 ms");
    expect(human).toContain("Enclosing operation-context wall: attributed 10.000 ms");
    expect(human).toContain("Coordination lifetime union: 10.000 ms");
    expect(human).toContain("Database observations are unavailable");
    expect(human).not.toContain("Actual driver exchanges: 0");
    expect(human).toContain("not deepest-operation ownership or CPU cost");
  });

  it("retains only the successfully written raw path when the human write fails", async () => {
    const original = new Error("human artifact storage unavailable");
    filesystem.writeFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(original);
    const failure = await persistenceFailure();
    expect(failure.stage).toBe("persistence");
    expect(failure.cause).toBe(original);
    expect(failure.reports).toEqual({ raw: resolve(directory, "retained-request.json") });
    expect(failure.reports).not.toHaveProperty("human");
    expect(filesystem.writeFile).toHaveBeenCalledTimes(2);
  });

  it("retains no successful artifact paths when the first raw write fails", async () => {
    const original = new Error("raw artifact storage unavailable");
    filesystem.writeFile.mockRejectedValueOnce(original);
    const failure = await persistenceFailure();
    expect(failure.stage).toBe("persistence");
    expect(failure.cause).toBe(original);
    expect(failure.reports).toEqual({});
    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
  });

  it("retains no artifact paths or attempted writes when directory creation fails", async () => {
    const original = new Error("artifact directory unavailable");
    filesystem.mkdir.mockRejectedValueOnce(original);
    const failure = await persistenceFailure();
    expect(failure.stage).toBe("persistence");
    expect(failure.cause).toBe(original);
    expect(failure.reports).toEqual({});
    expect(filesystem.writeFile).not.toHaveBeenCalled();
  });

  it("renders the supplied paired summary and keeps uncertainty limits explicit", async () => {
    const input: RunReport = { ...report(), operation: "compare", mode: "quiet",
      pairs: [{ index: 0, nativeMs: 10, flarexMs: 20, addedMs: 10 }],
      // Rendering consumes the analysis owner's supplied summary. It must not
      // reconstruct a different summary from the retained pair observations.
      pairedSummary: { samples: 3, medianAddedMs: 12, p95AddedMs: 18 } };
    const paths = await persistMeasurementReport(directory, input);
    expect(paths).toEqual({ raw: resolve(directory, "retained-request.json"), human: resolve(directory, "retained-request.md") });
    const raw = filesystem.writeFile.mock.calls[0]?.[1];
    const human = filesystem.writeFile.mock.calls[1]?.[1];
    expect(raw).toBe(JSON.stringify(input, null, 2) + "\n");
    expect(human).toContain("median 12.000 ms; P95 18.000 ms (3 fresh pairs)");
    expect(human).toContain("The platform clock precision is unknown.");
    expect(human).toContain("Driver waits do not establish server execution, lock time, network cost or scheduler CPU.");
    expect(human).toContain("never subtracted to invent quiet latency");
  });
});
