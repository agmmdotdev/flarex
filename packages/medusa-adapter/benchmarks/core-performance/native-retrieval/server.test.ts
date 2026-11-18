import { describe, expect, it } from "vitest";
import { readRetrievalRuntimeSettings, requireRetrievalServerObservedCalls, selectRetrievalServerDatabases,
  verifyRetrievalServerCatalogCoverage, retrievalServerDifference, type RetrievalServerStatement } from "./server";

const statement: RetrievalServerStatement = { userid: 11, dbid: 12, queryid: "123", toplevel: true,
  query: "select private-literal", stats_since: "entry-epoch", calls: 0, plans: 0,
  total_plan_time: 0, total_exec_time: 0, rows: 0, shared_blks_hit: 0, shared_blks_read: 0,
  shared_blks_dirtied: 0, shared_blks_written: 0, temp_blks_read: 0, temp_blks_written: 0 };
const snapshot = (entries: readonly RetrievalServerStatement[], stats_reset = "epoch", dealloc = 0) =>
  ({ info: [{ stats_reset, dealloc }], statements: entries });

describe("native retrieval authenticated database coverage", () => {
  it("retains separate executing-role and top-level identities for the same queryid", () => {
    const delta = retrievalServerDifference(snapshot([
      { ...statement, userid: 11, calls: 1 }, { ...statement, userid: 12, calls: 2 },
      { ...statement, userid: 12, toplevel: false, calls: 3 },
    ]), snapshot([
      { ...statement, userid: 11, calls: 4 }, { ...statement, userid: 12, calls: 7 },
      { ...statement, userid: 12, toplevel: false, calls: 9 },
    ]));
    expect(delta.map(({ userid, queryid, toplevel, calls }) => ({ userid, queryid, toplevel, calls }))).toEqual([
      { userid: 11, queryid: "123", toplevel: true, calls: 3 },
      { userid: 12, queryid: "123", toplevel: true, calls: 5 },
      { userid: 12, queryid: "123", toplevel: false, calls: 6 },
    ]);
  });
  it("retains planning-only failed execution rather than requiring successful calls", () => {
    const delta = retrievalServerDifference(snapshot([statement]), snapshot([{ ...statement, plans: 1, total_plan_time: 0.7 }]));
    expect(delta).toHaveLength(1);
    expect(delta[0]).toMatchObject({ calls: 0, plans: 1, total_plan_time: 0.7, total_exec_time: 0 });
  });
  it("refuses selective reset even when counters have regrown and retains all reset guards", () => {
    const before = snapshot([{ ...statement, calls: 2, plans: 2 }]);
    expect(() => retrievalServerDifference(before, snapshot([{ ...statement, calls: 3, plans: 3, stats_since: "changed" }])))
      .toThrow("entry reset");
    expect(() => retrievalServerDifference(before, snapshot([{ ...statement, calls: 1, plans: 2 }])))
      .toThrow("counter decreased");
    expect(() => retrievalServerDifference(before, snapshot([], "different"))).toThrow("reset or deallocated");
    expect(() => retrievalServerDifference(before, snapshot([], "epoch", 1))).toThrow("reset or deallocated");
    expect(() => retrievalServerDifference(before, snapshot([]))).toThrow("lost entries");
  });
  it("selects the catalog database spelling when a connection URL encodes its name", async () => {
    const connectionUrl = new URL("postgres://runtime@localhost/logical%20retrieval");
    const native = await readRetrievalRuntimeSettings(async () => [{
      database: "native_retrieval", dbid: 101, role: "native_owner", userid: 201, pid: 301, settings: {},
    }]);
    const runtime = await readRetrievalRuntimeSettings(async () => [{
      database: "logical retrieval", dbid: 102, role: "protected_runtime", userid: 202, pid: 302, settings: {},
    }]);
    const control = { ...runtime, role: "fixture_owner", userid: 203, pid: 303 };
    const selected = selectRetrievalServerDatabases("native_retrieval", native, runtime, control);
    expect(selected).toEqual([{ database: "native_retrieval", dbid: 101 }, { database: "logical retrieval", dbid: 102 }]);
    expect(selected.map(database => database.database)).not.toContain(connectionUrl.pathname.slice(1));
  });

  it("refuses wrong native selection, split control/runtime databases and overlapping lanes", () => {
    const native = { database: "native", dbid: 101, role: "native_owner", userid: 201, pid: 301, settings: {} };
    const runtime = { database: "logical", dbid: 102, role: "runtime", userid: 202, pid: 302, settings: {} };
    expect(() => selectRetrievalServerDatabases("wrong", native, runtime, runtime)).toThrow("Actual native database differs");
    expect(() => selectRetrievalServerDatabases("native", native, runtime, { ...runtime, database: "other" }))
      .toThrow("runtime and control database identities differ");
    expect(() => selectRetrievalServerDatabases("native", native, runtime, { ...runtime, dbid: 999 }))
      .toThrow("runtime and control database identities differ");
    expect(() => selectRetrievalServerDatabases("native", native, native, native)).toThrow("must be distinct");
  });

  it("refuses missing or mismatched observer catalog identities before claiming coverage", () => {
    const selected = [{ database: "native", dbid: 101 }, { database: "logical retrieval", dbid: 102 }];
    expect(verifyRetrievalServerCatalogCoverage(selected, [selected[1], selected[0]])).toEqual([selected[1], selected[0]]);
    for (const catalog of [[], [selected[0]], [selected[0], { database: "logical retrieval", dbid: 999 }],
      [selected[0], { database: "unrelated", dbid: 102 }]]) {
      expect(() => verifyRetrievalServerCatalogCoverage(selected, catalog)).toThrow("Observer catalog does not cover");
    }
    expect(() => verifyRetrievalServerCatalogCoverage(selected, [{ database: "native", dbid: "101" }])).toThrow();
  });

  it("requires positive observed calls in the successful lane, not another database", () => {
    const native = { database: "native", dbid: 101 };
    const logical = { database: "logical", dbid: 102 };
    expect(() => requireRetrievalServerObservedCalls(native, [{ dbid: 101, calls: 1 }])).not.toThrow();
    expect(() => requireRetrievalServerObservedCalls(logical, [{ dbid: 102, calls: 2 }])).not.toThrow();
    for (const delta of [undefined, [], [{ dbid: 102, calls: 1 }], [{ dbid: 101, calls: 0 }]]) {
      expect(() => requireRetrievalServerObservedCalls(native, delta)).toThrow("No observed server calls");
    }
  });
});
