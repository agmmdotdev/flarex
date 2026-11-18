import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compare, measure } from "./index";
import { MeasurementInfrastructureError, MeasurementRunFailure } from "./report";

const boundary = vi.hoisted(() => {
  const order: string[] = [];
  const rawWrites: string[] = [];
  const state: { primaryFailure: unknown; attemptCleanupFailure: unknown; commandCloseFailure: unknown;
    rawWriteFailure: unknown; applicationName: string } = {
    primaryFailure: undefined, attemptCleanupFailure: undefined, commandCloseFailure: undefined,
    rawWriteFailure: undefined, applicationName: "after",
  };
  return { order, rawWrites, state,
    prepareSeries: vi.fn(), acquireNative: vi.fn(), sourceDigest: vi.fn(), effectCollector: vi.fn(), databaseCollector: vi.fn(),
    mkdir: vi.fn<typeof import("node:fs/promises").mkdir>(),
    writeFile: vi.fn<typeof import("node:fs/promises").writeFile>(),
  };
});
vi.mock("../support/mixedMutationProductFixture", () => ({ prepareMixedMutationPerformanceSeries: boundary.prepareSeries }));
vi.mock("./collectors/native", () => ({ acquireNativeBusinessResource: boundary.acquireNative }));
vi.mock("./collectors/effect", () => ({ createEffectMeasurementCollector: boundary.effectCollector }));
vi.mock("../../../../persistence-postgres/test/mixedMutationPerformanceTrace", () => ({
  createMixedMutationPerformanceTrace: boundary.databaseCollector,
}));
vi.mock("./source", () => ({ measurementSourceDigest: boundary.sourceDigest }));
vi.mock("node:fs/promises", () => ({ mkdir: boundary.mkdir, writeFile: boundary.writeFile }));

const settings = { postgresVersion: "18", role: "ordinary", superuser: false, bypassRls: false,
  createDb: false, createRole: false, synchronousCommit: "on", fsync: "on", fullPageWrites: "on",
  statementTracking: null, autoExplainMinDuration: null };
const product = { id: "product-test", title: "after", handle: "after-handle", status: "published" };
const returnedValue = { id: "application-test", updated: product,
  pending: { id: product.id, title: product.title }, listed: [{ id: product.id }] };
const fixture = {
  readCurrentProduct: vi.fn(async () => product),
  readSettlementLedger: vi.fn(async () => ({ committed: true })),
  readCurrentApplicationDocument: vi.fn(async (_id: string) => ({ name: boundary.state.applicationName })),
};
const completed = {
  returnedValue, publication: { kind: "published", successfulResult: { valueJson: returnedValue } },
  workerConstructionMilliseconds: 0, canonicalResultBytes: 10,
  seed: { productId: product.id, newTitle: product.title, newHandle: product.handle }, fixture,
};
const pool = { query: vi.fn(async () => ({ rows: [settings] })) };
const prepareAttempt = async (index: number) => { boundary.order.push(`flarexPrepare:${index}`); };
const series = {
  currency: { resource: { kind: "postgres", control: { pool }, target: { pool } } },
  prepareAttempt: vi.fn(prepareAttempt),
  setTrace: vi.fn(), setEffectDiagnostics: vi.fn(),
  runAttempt: vi.fn(async (index: number, _observation: unknown, _reserved: unknown, cleanupFailures: unknown[]) => {
    boundary.order.push(`flarexRun:${index}`);
    if (boundary.state.attemptCleanupFailure !== undefined) cleanupFailures.push(boundary.state.attemptCleanupFailure);
    if (boundary.state.primaryFailure !== undefined) throw boundary.state.primaryFailure;
    return completed;
  }),
  close: vi.fn(async () => {
    boundary.order.push("seriesClose");
    if (boundary.state.commandCloseFailure !== undefined) throw boundary.state.commandCloseFailure;
  }),
};
const native = {
  resource: {
    settings,
    readSettings: vi.fn(async () => settings),
    prepareSample: vi.fn(async (_scenario: string, marker: string) => {
      const index = Number(marker.split("-").at(-1));
      return {
        run: async () => { boundary.order.push(`nativeRun:${index}`); },
        verify: async () => { boundary.order.push(`nativeVerify:${index}`); },
        cleanup: async () => { boundary.order.push(`nativeCleanup:${index}`); },
      };
    }),
  },
  close: vi.fn(async () => { boundary.order.push("nativeClose"); }),
};
const outputDirectory = resolve("unused-sdk-behavior");
const selection = { scenario: "mixed-product" } satisfies { scenario: "mixed-product" };
const quiet = { selection, size: "small", mode: "quiet", outputDirectory, warmups: 0, samples: 1 } satisfies Parameters<typeof measure>[0];

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try { await run(); } catch (cause) { return cause; }
  throw new Error("Expected SDK run rejection");
}
function rawReport(): unknown {
  const raw = boundary.rawWrites[0];
  if (raw === undefined) throw new Error("Expected retained raw artifact attempt");
  return JSON.parse(raw);
}
function expectQuietCollectors() {
  expect(boundary.effectCollector).not.toHaveBeenCalled();
  expect(boundary.databaseCollector).not.toHaveBeenCalled();
  expect(series.setTrace.mock.calls.every(([trace]) => trace === undefined)).toBe(true);
  expect(series.setEffectDiagnostics.mock.calls.every(([diagnostics]) => diagnostics === undefined)).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.order.length = 0;
  boundary.rawWrites.length = 0;
  Object.assign(boundary.state, { primaryFailure: undefined, attemptCleanupFailure: undefined,
    commandCloseFailure: undefined, rawWriteFailure: undefined, applicationName: "after" });
  boundary.prepareSeries.mockResolvedValue(series);
  series.prepareAttempt.mockReset().mockImplementation(prepareAttempt);
  boundary.acquireNative.mockResolvedValue(native);
  boundary.sourceDigest.mockReset().mockResolvedValue({ digest: "stable-source", files: 3 });
  boundary.effectCollector.mockImplementation(() => { throw new Error("Quiet mode installed an Effect collector"); });
  boundary.databaseCollector.mockImplementation(() => { throw new Error("Quiet mode installed a database collector"); });
  boundary.mkdir.mockImplementation(async () => { boundary.order.push("mkdir"); return undefined; });
  boundary.writeFile.mockImplementation(async (path, data) => {
    if (typeof path !== "string" || typeof data !== "string") throw new Error("Expected textual SDK artifact write");
    const raw = path.endsWith(".json");
    boundary.order.push(raw ? "rawWrite" : "humanWrite");
    if (raw) {
      boundary.rawWrites.push(data);
      if (boundary.state.rawWriteFailure !== undefined) throw boundary.state.rawWriteFailure;
    }
  });
});

describe("measurement SDK orchestration behavior", () => {
  it("preserves ordered request, attempt cleanup, command cleanup and artifact failures after resource disposal", async () => {
    const primary = Object.assign(new Error("private request input"), { code: "PrimaryFault" });
    const attemptCleanup = Object.assign(new Error("private attempt cleanup input"), { code: "AttemptCleanupFault" });
    const commandClose = Object.assign(new Error("private command close input"), { code: "CommandCloseFault" });
    const artifact = new Error("private raw artifact write input");
    Object.assign(boundary.state, { primaryFailure: primary, attemptCleanupFailure: attemptCleanup,
      commandCloseFailure: commandClose, rawWriteFailure: artifact });
    const failure = await rejection(() => measure(quiet));
    if (!(failure instanceof MeasurementInfrastructureError)) throw failure;
    expect(failure.stage).toBe("persistence");
    expect(failure.reports).toEqual({});
    if (!(failure.cause instanceof AggregateError)) throw new Error("Expected all original errors");
    const errors: readonly unknown[] = failure.cause.errors;
    expect(errors).toHaveLength(4);
    [primary, attemptCleanup, commandClose, artifact].forEach((original, index) => expect(errors[index]).toBe(original));
    expect(rawReport()).toMatchObject({ execution: "failed", acceptance: "notEvaluated", cleanup: "failed",
      samples: [{ outcome: "failure", failureStage: "request", failures: [
        { stage: "request", outcome: "foreign", tokens: ["Error", "PrimaryFault"] },
        { stage: "attemptCleanup", outcome: "foreign", tokens: ["Error", "AttemptCleanupFault"] },
      ] }], failures: [{ stage: "commandCleanup", outcome: "foreign", tokens: ["Error", "CommandCloseFault"] }] });
    expect(boundary.rawWrites[0]).not.toContain("private");
    expect(boundary.order).toEqual(["flarexPrepare:0", "flarexRun:0", "seriesClose", "mkdir", "rawWrite"]);
    expectQuietCollectors();
  });

  it("retains single original failure identity and complete artifact paths after successful cleanup and persistence", async () => {
    const original = new Error("private single request input");
    boundary.state.primaryFailure = original;
    const failure = await rejection(() => measure(quiet));
    if (!(failure instanceof MeasurementRunFailure)) throw failure;
    expect(failure.cause).toBe(original);
    expect(failure.execution).toBe("failed");
    expect(failure.acceptance).toBe("notEvaluated");
    expect(failure.reports).toEqual({ raw: resolve(outputDirectory, `${failure.runId}.json`),
      human: resolve(outputDirectory, `${failure.runId}.md`) });
    expect(rawReport()).toMatchObject({ runId: failure.runId, execution: "failed", cleanup: "completed",
      samples: [{ outcome: "failure", failureStage: "request" }] });
    expect(boundary.order).toEqual(["flarexPrepare:0", "flarexRun:0", "seriesClose", "mkdir", "rawWrite", "humanWrite"]);
    expectQuietCollectors();
  });

  it("rejects with ordered execution failures and saved report paths when artifact persistence succeeds", async () => {
    const primary = new Error("private primary failure");
    const attemptCleanup = new Error("private attempt cleanup failure");
    const commandClose = new Error("private command close failure");
    Object.assign(boundary.state, { primaryFailure: primary, attemptCleanupFailure: attemptCleanup,
      commandCloseFailure: commandClose });
    const failure = await rejection(() => measure(quiet));
    if (!(failure instanceof MeasurementRunFailure)) throw failure;
    if (!(failure.cause instanceof AggregateError)) throw new Error("Expected ordered execution errors");
    const errors: readonly unknown[] = failure.cause.errors;
    expect(errors).toHaveLength(3);
    [primary, attemptCleanup, commandClose].forEach((original, index) => expect(errors[index]).toBe(original));
    expect(failure.reports).toEqual({ raw: resolve(outputDirectory, `${failure.runId}.json`),
      human: resolve(outputDirectory, `${failure.runId}.md`) });
    expect(rawReport()).toMatchObject({ execution: "failed", acceptance: "notEvaluated", cleanup: "failed" });
    expect(boundary.order.slice(-4)).toEqual(["seriesClose", "mkdir", "rawWrite", "humanWrite"]);
    expectQuietCollectors();
  });

  it("executes 30 fresh matched quiet pairs after five warmups and alternates measured lane order", async () => {
    const result = await compare({ selection, size: "small", outputDirectory, samples: 30, warmups: 5 });
    expect(result).toMatchObject({ execution: "complete", acceptance: "passed" });
    expect(series.runAttempt).toHaveBeenCalledTimes(35);
    expect(series.prepareAttempt).toHaveBeenCalledTimes(35);
    expect(native.resource.prepareSample).toHaveBeenCalledTimes(35);
    expect(fixture.readCurrentApplicationDocument).toHaveBeenCalledTimes(35);
    expect(native.close).toHaveBeenCalledTimes(1);
    expect(series.close).toHaveBeenCalledTimes(1);
    expect(boundary.sourceDigest.mock.calls).toEqual([[true], [true]]);
    const runs = boundary.order.filter(event => event.startsWith("flarexRun:") || event.startsWith("nativeRun:"));
    const expectedWarmups = Array.from({ length: 5 }, (_, index) => [`flarexRun:${index}`, `nativeRun:${index}`]).flat();
    const expectedPairs = Array.from({ length: 30 }, (_, position) => position % 2 === 0
      ? [`nativeRun:${position + 5}`, `flarexRun:${position + 5}`]
      : [`flarexRun:${position + 5}`, `nativeRun:${position + 5}`]).flat();
    expect(runs).toEqual([...expectedWarmups, ...expectedPairs]);
    expect(rawReport()).toMatchObject({ operation: "compare", execution: "complete", acceptance: "passed",
      sampling: { requestedSamples: 30, warmups: 5, pairOrder: "alternating" },
      pairedSummary: { samples: 30 }, cleanup: "completed", failures: [],
      pairs: Array.from({ length: 30 }, (_, position) => ({ index: position + 5 })),
      gates: [
        { name: "sourceStability", passed: true }, { name: "settingsStability", passed: true },
        { name: "cleanup", passed: true }, { name: "sampling", passed: true },
        { name: "completeRequests", passed: true }, { name: "addedMedian", passed: true }, { name: "addedP95", passed: true },
      ] });
    expect(boundary.order.slice(-4)).toEqual(["seriesClose", "mkdir", "rawWrite", "humanWrite"]);
    expect(boundary.order.indexOf("nativeClose")).toBeLessThan(boundary.order.indexOf("seriesClose"));
    expectQuietCollectors();
  });

  it("retains the completed native lane when its paired Flarex preparation throws", async () => {
    const original = Object.assign(new Error("private Flarex preparation input"), { code: "PrepareFault" });
    series.prepareAttempt.mockRejectedValueOnce(original);
    const failure = await rejection(() => compare({ selection, size: "small", outputDirectory, samples: 1, warmups: 0 }));
    if (!(failure instanceof MeasurementRunFailure)) throw failure;
    expect(failure.cause).toBe(original);
    expect(failure.execution).toBe("failed");
    expect(failure.acceptance).toBe("failed");
    expect(series.prepareAttempt).toHaveBeenCalledExactlyOnceWith(0);
    expect(series.runAttempt).not.toHaveBeenCalled();
    expect(native.resource.prepareSample).toHaveBeenCalledTimes(1);
    expect(native.close).toHaveBeenCalledTimes(1);
    expect(series.close).toHaveBeenCalledTimes(1);
    expect(rawReport()).toMatchObject({ execution: "failed", acceptance: "failed", pairs: [], pairedSummary: null,
      cleanup: "completed", samples: [{ lane: "native", kind: "quiet", index: 0, outcome: "success",
        requestMs: expect.any(Number), failureStage: null, failures: [] }],
      failures: [{ stage: "measurement", outcome: "foreign", tokens: ["Error", "PrepareFault"] }] });
    expect(boundary.order).toEqual(["nativeRun:0", "nativeVerify:0", "nativeCleanup:0",
      "nativeClose", "seriesClose", "mkdir", "rawWrite", "humanWrite"]);
    expectQuietCollectors();
  });

  it("marks a completed comparison incomplete and ineligible when its authored source changes", async () => {
    boundary.sourceDigest.mockResolvedValueOnce({ digest: "before-source", files: 3 })
      .mockResolvedValueOnce({ digest: "after-source", files: 3 });
    const result = await compare({ selection, size: "small", outputDirectory, samples: 30, warmups: 5 });
    expect(result).toMatchObject({ execution: "incomplete", acceptance: "failed" });
    expect(rawReport()).toMatchObject({ execution: "incomplete", acceptance: "failed", pairedSummary: { samples: 30 },
      sources: { before: "before-source", after: "after-source" },
      gates: expect.arrayContaining([expect.objectContaining({ name: "sourceStability", passed: false })]) });
    expectQuietCollectors();
  });

  it("rejects a missing committed Application patch despite correct Product, publication, list and settlement ledger", async () => {
    boundary.state.applicationName = "before";
    const failure = await rejection(() => compare({ selection, size: "small", outputDirectory, samples: 30, warmups: 5 }));
    if (!(failure instanceof MeasurementRunFailure)) throw failure;
    expect(failure.execution).toBe("failed");
    expect(failure.acceptance).toBe("failed");
    expect(failure.cause).toMatchObject({ code: "ERR_ASSERTION", actual: { name: "before" }, expected: { name: "after" } });
    expect(fixture.readCurrentProduct).toHaveBeenCalledTimes(1);
    expect(fixture.readSettlementLedger).toHaveBeenCalledTimes(1);
    expect(fixture.readCurrentApplicationDocument).toHaveBeenCalledExactlyOnceWith("application-test");
    expect(series.runAttempt).toHaveBeenCalledTimes(1);
    expect(rawReport()).toMatchObject({ execution: "failed", acceptance: "failed", pairs: [],
      samples: [{ lane: "flarex", outcome: "failure", failureStage: "verification",
        failures: [{ stage: "verification", tokens: ["AssertionError", "ERR_ASSERTION"] }] },
      { lane: "native", outcome: "success" }], cleanup: "completed" });
    expectQuietCollectors();
  });
});
