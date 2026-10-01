import { describe, expect, it } from "vitest";
import { readRetrievalRuntimeSettings, requireRetrievalServerObservedCalls, selectRetrievalServerDatabases,
  verifyRetrievalServerCatalogCoverage } from "./server";

describe("native retrieval authenticated database coverage", () => {
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
