import { Result } from "effect";
import { describe, expect, it } from "vitest";
import type { MeasurementEvent, MeasurementEvidence } from "./artifact";
import { analyzeMeasurementEvidence, pairedSummary } from "./analysis";

const interval = { owner: null, site: null, parentId: null };
function phase(id: string, sequence: number, startMs: number, endMs: number | null,
  owner: string | null, parentId: string | null = null): Extract<MeasurementEvent, { readonly kind: "phase" }> {
  return { ...interval, id, sequence, startMs, endMs, owner, parentId, kind: "phase", name: id };
}
function driver(id: string, sequence: number, startMs: number, endMs: number | null): Extract<MeasurementEvent, { readonly kind: "driverAwait" }> {
  return { ...interval, id, sequence, startMs, endMs, kind: "driverAwait", pool: "target", phasePath: [],
    connectionId: 1, checkoutId: 2, transactionId: 3, fingerprint: "structural-query", template: "SELECT id FROM rows WHERE id=$1",
    statementCount: 1, parameterCount: 1, scalarParameterBytes: 4, unknownEncodingParameters: 0, sqlUtf8Bytes: 42,
    returnedRowCount: null, decodedResultJsonUtf8Bytes: null, transactionAction: null, outcome: "success" };
}
function evidence(events: readonly MeasurementEvent[] = [], endMs = 100): MeasurementEvidence {
  return { requestId: "test-request", clock: { id: "local-monotonic", unit: "milliseconds", precisionMs: 0.001, originMonotonicMs: 1000 },
    root: { startMs: 0, endMs, outcome: "success" }, events, postRequestObservers: [],
    collection: { capacity: 100, droppedEvents: 0, lostContextEvents: 0, failures: [] } };
}
function successful(input: unknown) {
  return Result.getOrThrow(analyzeMeasurementEvidence(input));
}

describe("measurement interval analysis", () => {
  it("keeps uncovered wall visible and separates two reconciled ledgers", () => {
    const input = evidence([phase("request-phase", 0, 10, 80, "executor"), driver("sql", 1, 20, 60),
      { ...interval, id: "checkout", sequence: 2, startMs: 40, endMs: 70, kind: "checkoutAwait", pool: "target",
        phasePath: [], connectionId: 1, checkoutId: 2, transactionId: null, outcome: "success" },
      { ...interval, id: "sizing", sequence: 3, startMs: 50, endMs: 55, kind: "observer", name: "result-sizing", outcome: "success" },
    ]);
    const result = successful(input);
    expect(result.phaseLedger).toEqual({ attributed: 70, ambiguous: 0, unattributed: 30, observer: 0 });
    expect(result.waitLedger).toEqual({ driverOnlyMs: 20, checkoutOnlyMs: 10, bothMs: 20, neitherMs: 50 });
    expect(result.wall).toMatchObject({ rootMs: 100, partitionMs: 100, phaseLedgerMs: 100, waitLedgerMs: 100,
      driverAwaitUnionMs: 40, checkoutAwaitUnionMs: 30, observerUnionMs: 5, observerAwaitOverlapMs: 5 });
    expect(result.partitions.find(partition => partition.startMs === 50)).toMatchObject({
      phaseIds: ["request-phase"], driverAwaitIds: ["sql"], checkoutAwaitIds: ["checkout"], observerIds: ["sizing"],
      driverWaiting: true, checkoutWaiting: true, observerActive: true,
    });
    expect(result.evidence.events).toEqual(input.events);
    expect(result.database).toMatchObject({ observedStatements: 1, observedReturnedRows: 0, unknownRowExchanges: 1,
      observedDecodedJsonBytes: 0, unknownDecodedJsonByteExchanges: 1 });
    expect(Object.keys(result.wall).some(key => key.toLowerCase().includes("cpu"))).toBe(false);
  });

  it("attributes nested phases to the actual leaf and preserves concurrent ambiguity", () => {
    const result = successful(evidence([phase("outer", 0, 0, 100, "executor"),
      phase("product", 1, 10, 60, "product", "outer"), phase("payload", 2, 40, 80, "payload", "outer")]));
    expect(result.phaseLedger).toEqual({ attributed: 80, ambiguous: 20, unattributed: 0, observer: 0 });
    expect(result.owners).toEqual([
      { owner: "executor", attributedWallMs: 30, inclusiveObservedWallMs: 100, phaseCount: 1, spanCount: 0, driverExchangeCount: 0, workEventCount: 0 },
      { owner: "product", attributedWallMs: 30, inclusiveObservedWallMs: 50, phaseCount: 1, spanCount: 0, driverExchangeCount: 0, workEventCount: 0 },
      { owner: "payload", attributedWallMs: 20, inclusiveObservedWallMs: 40, phaseCount: 1, spanCount: 0, driverExchangeCount: 0, workEventCount: 0 },
    ]);
    expect(result.partitions.find(partition => partition.startMs === 40)).toMatchObject({
      phaseIds: ["outer", "product", "payload"], ownerCandidates: ["payload", "product"], attribution: "ambiguous",
    });
  });

  it("preserves unknown owners and ambiguous source owners without assigning them", () => {
    const result = successful(evidence([phase("unowned", 0, 0, 20, null),
      { ...phase("competing", 1, 20, 40, null), ownerCandidates: ["product", "payload"] }]));
    expect(result.coverage).toMatchObject({ attributedMs: 0, ambiguousMs: 20, unattributedMs: 80 });
    expect(result.owners).toEqual([]);
  });

  it("retains scalar counts at sites, post-request observer cost, and zero root meaning", () => {
    const input = evidence([{ id: "rows", sequence: 0, kind: "work", atMs: 20, owner: "storage", site: "hydrate",
      parentId: null, metric: "retainedRows", unit: "count", value: 5 },
    { id: "bytes", sequence: 1, kind: "work", atMs: 30, owner: "storage", site: "hydrate",
      parentId: null, metric: "decodedBytes", unit: "bytes", value: 400 }]);
    const result = successful({ ...input, postRequestObservers: [
      { ...interval, id: "finalize", sequence: 2, kind: "observer", name: "finalization", startMs: 100, endMs: 105, outcome: "success" },
      { ...interval, id: "persist", sequence: 3, kind: "observer", name: "recording", startMs: 102, endMs: 110, outcome: "success" },
    ] });
    expect(result.work).toEqual([
      { owner: "storage", site: "hydrate", metric: "retainedRows", unit: "count", value: 5, eventCount: 1 },
      { owner: "storage", site: "hydrate", metric: "decodedBytes", unit: "bytes", value: 400, eventCount: 1 },
    ]);
    expect(result.wall.postRequestObserverUnionMs).toBe(10);
    expect(result.wall.rootMs).toBe(100);
    expect(successful(evidence([], 0)).coverage.attributedFraction).toBeNull();
  });

  it("keeps request failure separate from an incomplete successful diagnostic", () => {
    const failedRequest = successful({ ...evidence(), root: { startMs: 0, endMs: 100, outcome: "failure" } });
    expect(failedRequest.requestOutcome).toBe("failure");
    expect(failedRequest.diagnostic).toBe("complete");
    const incomplete = successful({ ...evidence([phase("open", 0, 10, null, "storage")]),
      collection: { capacity: 10, droppedEvents: 3, lostContextEvents: 2, failures: ["buffer-failure"] } });
    expect(incomplete.requestOutcome).toBe("success");
    expect(incomplete.diagnostic).toBe("incomplete");
    expect(incomplete.incompleteReasons).toEqual(["openInterval:open", "droppedEvents:3", "lostContextEvents:2", "collectorFailure:buffer-failure"]);
    expect(incomplete.wall.phaseLedgerMs).toBe(100);
  });

  it("retains full Effect completion categories and concurrent observed span identities", () => {
    const effectSpan: MeasurementEvent = { ...interval, id: "effect", sequence: 0, startMs: 0, endMs: 100,
      owner: "journal", site: "Journal.freeze", kind: "effectSpan", name: "Journal.freeze", traceId: "trace",
      spanId: "span", fiberId: "fiber-1", effectStartNanos: "100", effectEndNanos: "200",
      outcome: "mixed", cause: "Fail + Interrupt" };
    const result = successful(evidence([effectSpan]));
    expect(result.evidence.events[0]).toMatchObject({ outcome: "mixed", cause: "Fail + Interrupt", fiberId: "fiber-1" });
    expect(result.partitions[0]).toMatchObject({ spanIds: ["effect"], attribution: "attributed" });
    expect(result.requestOutcome).toBe("success");
    expect(result.diagnostic).toBe("complete");
  });

  it("rejects unsafe aggregates even though each observed count is valid", () => {
    const first: MeasurementEvent = { id: "first", sequence: 0, kind: "work", atMs: 0, owner: "storage", site: "decode",
      parentId: null, metric: "bytes", unit: "bytes", value: Number.MAX_SAFE_INTEGER };
    const second: MeasurementEvent = { ...first, id: "second", sequence: 1, value: 1 };
    expect(Result.isFailure(analyzeMeasurementEvidence(evidence([first, second])))).toBe(true);
    const initial = driver("one", 0, 0, 10);
    const oversized = { ...initial, statementCount: Number.MAX_SAFE_INTEGER };
    expect(Result.isFailure(analyzeMeasurementEvidence(evidence([oversized, driver("two", 1, 10, 20)])))).toBe(true);
  });

  it.each([
    ["negative interval", evidence([phase("bad", 0, -1, 10, null)])],
    ["nonfinite root", evidence([], Infinity)],
    ["backwards interval", evidence([phase("bad", 0, 20, 10, null)])],
    ["outside root", evidence([phase("bad", 0, 0, 101, null)])],
    ["duplicate identity", evidence([phase("bad", 0, 0, 10, null), phase("bad", 1, 10, 20, null)])],
    ["duplicate sequence", evidence([phase("one", 0, 0, 10, null), phase("two", 0, 10, 20, null)])],
    ["unordered timeline", evidence([phase("late", 0, 20, 30, null), phase("early", 1, 0, 10, null)])],
    ["missing parent", evidence([phase("bad", 0, 0, 10, null, "missing")])],
    ["cyclic parents", evidence([phase("one", 0, 0, 100, null, "two"), phase("two", 1, 0, 100, null, "one")])],
    ["outside parent", evidence([phase("outer", 0, 0, 20, "executor"), phase("child", 1, 10, 30, "storage", "outer")])],
    ["buffer capacity", { ...evidence([phase("one", 0, 0, 100, null)]),
      collection: { capacity: 0, droppedEvents: 0, lostContextEvents: 0, failures: [] } }],
    ["fractional count", evidence([{ id: "bad", sequence: 0, kind: "work", atMs: 0, owner: null, site: null,
      parentId: null, metric: "rows", unit: "count", value: 0.5 }])],
  ])("rejects %s as invalid data rather than request failure", (_name, input) => {
    const result = analyzeMeasurementEvidence(input);
    expect(Result.isFailure(result)).toBe(true);
    expect(Result.match(result, { onSuccess: () => "unexpected", onFailure: error => error.reason })).toBe("invalidEvidence");
  });

  it("reconciles floating endpoints without using clock precision as an accounting allowance", () => {
    const result = successful(evidence(Array.from({ length: 10 }, (_, index) =>
      phase(`span-${index}`, index, index / 10, (index + 1) / 10, "storage")), 1));
    expect(result.wall.reconciliationErrorMs).toBeLessThanOrEqual(result.wall.roundingToleranceMs);
    expect(result.evidence.clock.precisionMs).toBe(0.001);
    expect(result.wall.roundingToleranceMs).toBeLessThan(0.001);
  });

  it("retains unknown clock precision without changing root accounting", () => {
    const input = evidence([phase("known-owner", 0, 10, 80, "executor")]);
    const knownPrecision = successful(input);
    const unknownPrecision = successful({ ...input, clock: { ...input.clock, precisionMs: null } });
    expect(unknownPrecision.evidence.clock.precisionMs).toBeNull();
    expect(unknownPrecision.wall).toEqual(knownPrecision.wall);
    expect(unknownPrecision.diagnostic).toBe("complete");
  });
});

describe("paired request excess", () => {
  it("summarizes each actual pair before percentiles, preserving a shifted outlier", () => {
    const pairs = [
      { index: 0, nativeMs: 1, flarexMs: 11, addedMs: 10 },
      { index: 1, nativeMs: 100, flarexMs: 110, addedMs: 10 },
      { index: 2, nativeMs: 101, flarexMs: 1, addedMs: -100 },
    ];
    expect(Result.getOrThrow(pairedSummary(pairs))).toEqual({ samples: 3, medianAddedMs: 10, p95AddedMs: 10 });
    // Independent distributions would report median 11 - 100 = -89 and
    // P95 110 - 101 = 9. Neither is the percentile of complete matched excess.
    expect(Result.getOrThrow(pairedSummary(pairs))?.medianAddedMs).not.toBe(-89);
    expect(Result.getOrThrow(pairedSummary(pairs))?.p95AddedMs).not.toBe(9);
    expect(pairs.map(pair => pair.index)).toEqual([0, 1, 2]);
  });

  it("uses nearest rank for an even sample count and retains negative added time", () => {
    expect(Result.getOrThrow(pairedSummary([
      { index: 0, nativeMs: 10, flarexMs: 1, addedMs: -9 },
      { index: 1, nativeMs: 10, flarexMs: 15, addedMs: 5 },
    ]))).toEqual({ samples: 2, medianAddedMs: -9, p95AddedMs: 5 });
    expect(Result.getOrThrow(pairedSummary([]))).toBeNull();
  });

  it("accepts only floating rounding in the retained per-pair difference", () => {
    expect(Result.isSuccess(pairedSummary([{ index: 0, nativeMs: 0.1, flarexMs: 0.4, addedMs: 0.3 }]))).toBe(true);
    expect(Result.isFailure(pairedSummary([{ index: 0, nativeMs: 0.1, flarexMs: 0.4, addedMs: 0.301 }]))).toBe(true);
  });

  it.each([
    ["duplicate index", [{ index: 0, nativeMs: 1, flarexMs: 2, addedMs: 1 }, { index: 0, nativeMs: 2, flarexMs: 3, addedMs: 1 }]],
    ["negative index", [{ index: -1, nativeMs: 1, flarexMs: 2, addedMs: 1 }]],
    ["fractional index", [{ index: 0.5, nativeMs: 1, flarexMs: 2, addedMs: 1 }]],
    ["zero native", [{ index: 0, nativeMs: 0, flarexMs: 2, addedMs: 2 }]],
    ["negative Flarex", [{ index: 0, nativeMs: 1, flarexMs: -2, addedMs: -3 }]],
    ["nonfinite native", [{ index: 0, nativeMs: Infinity, flarexMs: 2, addedMs: 1 }]],
    ["nonfinite Flarex", [{ index: 0, nativeMs: 1, flarexMs: NaN, addedMs: 1 }]],
    ["nonfinite excess", [{ index: 0, nativeMs: 1, flarexMs: 2, addedMs: Infinity }]],
    ["mismatched excess", [{ index: 0, nativeMs: 1, flarexMs: 2, addedMs: 3 }]],
  ])("rejects %s", (_name, pairs) => {
    expect(Result.isFailure(pairedSummary(pairs))).toBe(true);
  });
});
