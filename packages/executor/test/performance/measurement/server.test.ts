import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { analyzeServerEvidence, safeServerStatements, serverLimits, ServerMeasurementEvidenceSchema,
  type ServerMeasurementEvidence } from "./server";

const evidence = (): ServerMeasurementEvidence => ({ originMonotonicMs: 100, database: { database: "isolated", dbid: 1 },
  root: { startMs: 0, endMs: 80 }, limits: serverLimits, status: "complete", before: null, after: null,
  statements: [], beforeStatements: [], afterStatements: [], missedTicks: 0, droppedRows: 0, observers: [], failures: [],
  actualPlans: { status: "unavailable", reason: "noValidatedBoundedLogSource" }, polls: [{ startMs: 15, endMs: 19,
    serverAt: "server-time", activities: [{ pid: 12, backendStart: "backend-a", dbid: 1, userid: 2, state: "active",
      queryid: "987", queryStart: "query-start", waitType: "Lock", waitEvent: "transactionid", blockerPids: [13, 0] }] }] });

describe("server evidence normalization and candidate analysis", () => {
  it("does not serialize representative SQL or add parent and nested elapsed work", () => {
    const rows = safeServerStatements([{ userid: 2, dbid: 1, queryid: "987", toplevel: true,
      query: "select 'private-value'", stats_since: "epoch", calls: 1, plans: 1,
      total_plan_time: 2, total_exec_time: 20, rows: 1, shared_blks_hit: 3, shared_blks_read: 0,
      shared_blks_dirtied: 0, shared_blks_written: 0, temp_blks_read: 0, temp_blks_written: 0 }]);
    expect(JSON.stringify(rows)).not.toMatch(/query"|private-value|select/);
    const report = analyzeServerEvidence({ ...evidence(), statements: [...rows, { ...rows[0]!, toplevel: false, total_exec_time: 8 }] }, []);
    expect(report.topLevel.executionMs).toBe(20);
    expect(report.nested.executionMs).toBe(8);
    expect(report.waits).toEqual([{ waitType: "Lock", waitEvent: "transactionid", observations: 1, pids: [12] }]);
    expect(report).not.toHaveProperty("exactWaitMs");
  });
  it("retains candidates through offset clocks and same-PID queued work without choosing an owner", () => {
    const drivers = [{ id: "first", parentId: "op-a", backendPid: 12, startMs: 0, endMs: 12 },
      { id: "queued", parentId: "op-b", backendPid: 12, startMs: 2, endMs: 25 }];
    const report = analyzeServerEvidence(evidence(), drivers, 110);
    expect(report.correlations[0]).toMatchObject({ status: "ambiguous",
      candidateDriverIds: ["first", "queued"], candidateOperationParents: ["op-a", "op-b"] });
    expect(analyzeServerEvidence(evidence(), drivers.filter(driver => driver.id === "first"), 110).correlations[0]?.status)
      .toBe("singleCandidate");
    expect(analyzeServerEvidence(evidence(), [{ ...drivers[0]!, backendPid: null }]).correlations[0]?.status).toBe("unmatched");
  });
  it("refuses correlation after PID reuse and for inactive last-query identities", () => {
    const original = evidence();
    const first = original.polls[0]!;
    const second = { ...first, startMs: 25, endMs: 29,
      activities: first.activities.map(activity => ({ ...activity, backendStart: "backend-b" })) };
    const driver = [{ id: "driver", parentId: "op-a", backendPid: 12, startMs: 0, endMs: 40 }];
    expect(analyzeServerEvidence({ ...original, polls: [first, second] }, driver).correlations.map(value => value.status))
      .toEqual(["pidReuse", "pidReuse"]);
    expect(analyzeServerEvidence({ ...original, polls: [{ ...first,
      activities: first.activities.map(activity => ({ ...activity, state: "idle" })) }] }, driver).correlations[0])
      .toMatchObject({ status: "inactiveOrUnavailable", candidateDriverIds: [] });
  });
  it("validates bounded raw polls and observer order rather than silently trimming persisted evidence", () => {
    const decode = Schema.decodeUnknownResult(ServerMeasurementEvidenceSchema);
    expect(decode(evidence())._tag).toBe("Success");
    expect(decode({ ...evidence(), limits: { ...serverLimits, maxRows: 0 } })._tag).toBe("Failure");
    expect(decode({ ...evidence(), root: { startMs: 2, endMs: 1 } })._tag).toBe("Failure");
    expect(decode({ ...evidence(), observers: [{ name: "poll", startMs: 3, endMs: 2, outcome: "success" }] })._tag)
      .toBe("Failure");
  });
});
