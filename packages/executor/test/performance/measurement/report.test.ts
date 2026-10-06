import { resolve } from "node:path";
import { Result } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeasurementInfrastructureError, persistMeasurementReport, type RunReport } from "./report";
import { analyzeMeasurementEvidence } from "./analysis";

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
