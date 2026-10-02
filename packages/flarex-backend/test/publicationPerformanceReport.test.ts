import { describe, expect, it } from "vitest";
import { publicationDistribution, publicationFinalCapFailureReceipt, publicationIntervalUnion, publicationPhaseIntervals,
  publicationPhaseSummary, type PublicationPerformanceReport } from "./support/publicationPerformanceReport";
import { admitPublicationServerLogCopies, filterPublicationServerLog, PublicationPerformanceServer } from "./support/publicationPerformanceServer";

describe("publication attribution evidence", () => {
  it("retains overlapping parent intervals and unions repeated owner regions per sample", () => {
    const parsed = publicationPhaseIntervals([
      { atMs: 0, event: { kind: "phase", phase: "transaction", edge: "begin" } },
      { atMs: 1, event: { kind: "phase", phase: "lifecycleAcceptance", edge: "begin" } },
      { atMs: 3, event: { kind: "phase", phase: "lifecycleAcceptance", edge: "end" } },
      { atMs: 4, event: { kind: "phase", phase: "lifecycleAcceptance", edge: "begin" } },
      { atMs: 7, event: { kind: "phase", phase: "lifecycleAcceptance", edge: "end" } },
      { atMs: 9, event: { kind: "phase", phase: "transaction", edge: "end" } },
    ]);
    expect(parsed.unmatchedEdges).toBe(0);
    expect(parsed.intervals).toHaveLength(3);
    expect(publicationPhaseSummary(parsed.intervals)).toEqual([
      { phase: "lifecycleAcceptance", intervals: 2, unionMs: 5 },
      { phase: "transaction", intervals: 1, unionMs: 9 },
    ]);
    expect(publicationIntervalUnion(parsed.intervals)).toBe(9);
  });

  it("marks incomplete observation rather than fabricating an end", () => {
    const parsed = publicationPhaseIntervals([
      { atMs: 0, event: { kind: "phase", phase: "transaction", edge: "begin" } },
      { atMs: 1, event: { kind: "phase", phase: "lowering", edge: "end" } },
    ]);
    expect(parsed).toEqual({ intervals: [], unmatchedEdges: 2 });
  });

  it("uses sample distributions including even medians without summing percentiles", () => {
    expect(publicationDistribution([4, 1, 3, 2])).toEqual({ count: 4, median: 2.5, p95: 4, min: 1, max: 4 });
    expect(publicationDistribution([])).toBeNull();
    expect(() => publicationIntervalUnion([{ phase: "bad", startMs: 2, endMs: 1 }])).toThrow();
  });

  it("retains foreign snapshot failure for the diagnostic assertion boundary", async () => {
    const cause = new Error("diagnostic connection refused");
    const server = new PublicationPerformanceServer({ snapshot: async () => { throw cause; } });
    await server.beginPublication();
    await server.endPublication();
    expect(server.status()).toEqual({ failures: 1, openWindows: 0 });
    try { server.assertHealthy(); throw new Error("expected diagnostic refusal"); }
    catch (failure) {
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw failure;
      expect(failure.cause).toBe(cause);
    }
  });

  it("filters only authenticated PID groups and keeps nested log continuation lines", () => {
    const selected = "2026-10-02 01:02:03.100 UTC [17] LOG: duration\n  {\n    \"Plan\": {}\n  }\n";
    const excluded = "2026-10-02 01:02:04.100 UTC [18] LOG: setup\n  excluded continuation\n";
    const result = filterPublicationServerLog(selected + excluded, new Set([17]));
    expect(result).toEqual({ log: selected, recognizedHeaders: 2, excludedHeaders: 1,
      unrecognizedLines: 0, coverage: "declaredPrefix" });
    expect(filterPublicationServerLog("different prefix\n", new Set([17])).coverage).toBe("partialOrUnavailable");
  });

  it("preserves actual snapshots when strict statistics comparison refuses and never retries", async () => {
    const before = { info: [{ stats_reset: "epoch-a", dealloc: 0 }], statements: [] };
    const after = { info: [{ stats_reset: "epoch-a", dealloc: 1 }], statements: [] };
    let calls = 0;
    const server = new PublicationPerformanceServer({ snapshot: async () => {
      calls++;
      return calls === 1 ? before : after;
    } });
    await server.begin("setup");
    await server.end("setup");
    expect(calls).toBe(2);
    expect(server.windows).toEqual([]);
    expect(server.status()).toEqual({ failures: 1, openWindows: 0 });
    expect(server.failedWindows).toHaveLength(1);
    expect(server.failedWindows[0]).toMatchObject({ name: "setup",
      classification: "statisticsDifferenceRefused", before, after });
    expect(server.failedWindows[0]?.before).toBe(before);
    expect(server.failedWindows[0]?.after).toBe(after);
    expect(server.compact().failedWindows[0]).toMatchObject({ name: "setup",
      classification: "statisticsDifferenceRefused", before: { statsReset: "epoch-a", dealloc: 0 },
      after: { statsReset: "epoch-a", dealloc: 1 }, beforeStatementEntries: 0, afterStatementEntries: 0 });
    try { server.assertHealthy(); throw new Error("expected diagnostic refusal"); }
    catch (failure) {
      if (!(failure instanceof Error)) throw failure;
      expect(failure.cause).toBeInstanceOf(Error);
      if (!(failure.cause instanceof Error)) throw failure.cause;
      expect(failure.cause.message).toBe("PostgreSQL statement statistics reset or deallocated during retrieval interval");
    }
    expect(calls).toBe(2);
  });

  it("refuses combined log copies before admitting either original or filtered artifact", () => {
    expect(admitPublicationServerLogCopies({ appendBytes: 8, selectedBytes: 3, combinedCap: 10,
      freeBytes: 100, remainingArtifactReservation: 20 })).toEqual({
      kind: "refused", reason: "combinedLogByteCap", combinedBytes: 11 });
    expect(admitPublicationServerLogCopies({ appendBytes: 8, selectedBytes: 2, combinedCap: 10,
      freeBytes: 100, remainingArtifactReservation: 20 })).toEqual({ kind: "allowed", combinedBytes: 10 });
    expect(admitPublicationServerLogCopies({ appendBytes: 8, selectedBytes: 2, combinedCap: 10,
      freeBytes: 29, remainingArtifactReservation: 20 }).kind).toBe("refused");
  });

  it("retains a compact invalid cap receipt without full query snapshots or success claims", () => {
    const report: PublicationPerformanceReport = { format: "flarex.publication-attribution",
      planned: { profiles: ["product"], warmupPairs: 1, retainedPairs: 1, attemptCap: 6,
        timeoutMs: 900000, rawByteCap: 262144000, reportByteCap: 52428800, serverLogByteCap: 536870912 },
      environment: { fullQueryText: "must not enter compact receipt" },
      sourceHashesStart: { owner: "hash" }, sourceHashesEnd: { owner: "hash" }, sourceStable: true,
      complete: true, samples: [], setup: [], serverDiagnostics: { fullQueries: "must not enter compact receipt" } };
    const receipt = publicationFinalCapFailureReceipt({ report, rawBytesWritten: 20, finalRawBytes: 30,
      safeRuntimeSettings: [], compactServerWindows: [],
      safeLogAccounting: { logStart: 10, logEnd: 50, appendBytes: 40, originalLogCaptured: false,
        selectedLogCaptured: false, logCaptureAccounting: { appendBytes: 40 }, filteredCoverage: "unavailable" },
      spentWork: { directoryCreationMs: 1, sourceHashStartMs: 2, sourceHashEndMs: 3, finalSerializationMs: 4,
        artifactTimings: [], runElapsedMs: 10, diagnosticSecondaryFailures: [], failure: null } });
    expect(receipt.complete).toBe(false);
    expect(receipt.combinedRawBytes).toBe(50);
    expect(receipt.sourceHashesEnd).toEqual({ owner: "hash" });
    expect(receipt.logAccounting.logStart).toBe(10);
    expect(receipt.unavailable).toContain("fullServerQuerySnapshots");
    expect(JSON.stringify(receipt)).not.toContain("must not enter compact receipt");
  });
});
