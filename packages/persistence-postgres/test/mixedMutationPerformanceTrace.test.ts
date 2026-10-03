import { AsyncResource } from "node:async_hooks";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createMixedMutationPerformanceTrace, decodedQueryResultSizes, structuralSql } from "./mixedMutationPerformanceTrace";
import { postgresUrl } from "./postgresHelpers";

async function traceFromFirstSite(pool: Pool): Promise<void> { await pool.query("select $1::int as value", [1]); }
async function traceFromSecondSite(pool: Pool): Promise<void> { await pool.query("select $1::int as value", [2]); }

describe("mixed mutation performance trace SQL structure", () => {
  it("measures decoded result rows independently from wire bytes without changing values", () => {
    const rows = [{ value: "မ", big: 3n, bytes: Buffer.from([1, 2]), at: new Date("2026-10-03T00:00:00.000Z") }];
    const encoded = JSON.stringify(rows, (_key, field: unknown) => typeof field === "bigint" ? field.toString() : field);
    expect(decodedQueryResultSizes({ rows })).toEqual({ returnedRowCount: 1,
      decodedResultJsonUtf8Bytes: Buffer.byteLength(encoded, "utf8") });
    expect(rows[0]?.big).toBe(3n);
    expect(rows[0]?.bytes).toEqual(Buffer.from([1, 2]));
    expect(decodedQueryResultSizes([{ rows: [] }, { rows: [{ value: 1 }] }]).returnedRowCount).toBe(1);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(decodedQueryResultSizes({ rows: [cycle] })).toEqual({ returnedRowCount: null, decodedResultJsonUtf8Bytes: null });
    expect(decodedQueryResultSizes(undefined)).toEqual({ returnedRowCount: null, decodedResultJsonUtf8Bytes: null });
  });
  it("counts only top-level statements and redacts literal and parameter values", () => {
    const first = structuralSql("/* a; /* nested; */ done */ select 'private;value', $$body;with;delimiters$$, $1, 17; -- trailing;\n select E'escape\\'quote;'::text");
    const second = structuralSql("select 'other;value', $$another;body$$, $9, 82; select E'other\\'quote;'::text");
    expect(first?.statementCount).toBe(2);
    expect(second?.statementCount).toBe(2);
    expect(first?.fingerprint).toBe(second?.fingerprint);
    expect(first?.template).not.toContain("private");
    expect(first?.template).not.toContain("body");
    expect(first?.template).not.toContain("17");
    expect(first?.template).not.toContain("$1");
    expect(structuralSql("select 'unterminated")?.statementCount).toBeUndefined();
    expect(structuralSql("select 1 /* unterminated")?.statementCount).toBeUndefined();
    expect(structuralSql({ submit: () => undefined })).toBeNull();
  });

  it("distinguishes transaction commands from savepoint rollback", () => {
    expect(structuralSql("BEGIN")?.transactionAction).toBe("begin");
    expect(structuralSql("START TRANSACTION")?.transactionAction).toBe("begin");
    expect(structuralSql("commit;")?.transactionAction).toBe("commit");
    expect(structuralSql("rollback")?.transactionAction).toBe("rollback");
    expect(structuralSql("rollback to savepoint nested")?.transactionAction).toBeNull();
    expect(structuralSql("select 1; select 2")?.transactionAction).toBeNull();
  });

  it("redacts PostgreSQL 18 decimal and base literals or refuses malformed forms", () => {
    const forms = ["1_500_000", "0b10001000_00000000", "0o_1_755", "0xFFFF_FFFF",
      "1.618_034", "1_2.3_4e-5_6", ".001_002", "5e+2_0"];
    for (const form of forms) {
      const parsed = structuralSql(`select ${form} as private_number`);
      expect(parsed?.statementCount).toBe(1);
      expect(parsed?.template).toBe("select ? as private_number");
    }
    for (const malformed of ["0b2", "0o9", "0x_G", "1__2", "1e_3", "1e+", "1_.2", "0xF.3"]) {
      expect(structuralSql(`select ${malformed} as private_number`)).toBeNull();
    }
  });
});

describe.skipIf(postgresUrl === null)("mixed mutation performance trace ordinary PostgreSQL", () => {
  it("observes a shared standalone pool once and restores its methods", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL is required for this test.");
    const pool = new Pool({ connectionString: postgresUrl });
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    const trace = createMixedMutationPerformanceTrace({ controlPool: pool, targetPool: pool });
    try {
      await trace.withInvocation({ id: "standalone", mode: "measured" }, async () => {
        const result = await pool.query<{ value: number }>("select 7::int as value");
        expect(result.rows[0]?.value).toBe(7);
      });
      const record = trace.records()[0];
      expect(record?.dispatchGroups).toMatchObject([{ pool: "target", dispatchCount: 1, statementCount: 1 }]);
      expect(record?.poolQueryCalls).toBe(1);
      expect(record?.delegatedPoolQueryDispatches).toBe(1);
      expect(record?.lostContextDispatches).toBe(0);
      trace.close();
      expect(pool.query).toBe(originalQuery);
      expect(pool.connect).toBe(originalConnect);
      expect((await pool.query<{ value: number }>("select 9::int as value")).rows[0]?.value).toBe(9);
      expect(trace.records()).toHaveLength(1);
    } finally { trace.close(); await pool.end(); }
  });
  it("observes both pools, callback and Promise routes, nested phases and callback reentry without changing results", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL is required for this test.");
    const controlPool = new Pool({ connectionString: postgresUrl });
    const targetPool = new Pool({ connectionString: postgresUrl });
    const originalControlConnect = controlPool.connect;
    const originalControlQuery = controlPool.query;
    const trace = createMixedMutationPerformanceTrace({ controlPool, targetPool });
    const outsideResource = new AsyncResource("trace-outside-resource");
    try {
      await trace.withInvocation({ id: "recon-1", mode: "recon" }, async () => {
        await trace.withPhase("admission", async () => {
          const control = await controlPool.query<{ value: number }>("select $1::int as value", [7]);
          expect(control.rows[0]?.value).toBe(7);
          const client = await targetPool.connect();
          try {
            await client.query("begin");
            const callback = await new Promise<number>((resolve, reject) => {
              client.query<{ value: number }>("select $1::int as value", [9], (error, result) => {
                if (error) reject(error);
                else resolve(result.rows[0]?.value ?? -1);
              });
            });
            expect(callback).toBe(9);
            await client.query("commit");
          } finally { client.release(); }
        });
        const bound = trace.bindCurrent(async () => trace.withPhase("bridge", async () => {
          const result = await targetPool.query<{ value: number }>("select $1::int as value", [13]);
          return result.rows[0]?.value;
        }));
        expect(await outsideResource.runInAsyncScope(bound)).toBe(13);
      });
      const [recon] = trace.drainRecords();
      expect(recon).toBeDefined();
      expect(recon?.poolQueryCalls).toBe(2);
      expect(recon?.delegatedPoolQueryDispatches).toBe(2);
      expect(recon?.dispatches).toHaveLength(5);
      expect(recon?.startedAtMs).toBeGreaterThan(0);
      expect(recon?.dispatches.find(dispatch => dispatch.phasePath.includes("bridge"))).toMatchObject({
        parameterCount: 1, scalarParameterBytes: 2, unknownEncodingParameters: 0,
        returnedRowCount: 1, decodedResultJsonUtf8Bytes: Buffer.byteLength('[{"value":13}]', "utf8"),
      });
      expect(recon?.dispatches.find(dispatch => dispatch.transactionAction === null && !dispatch.delegatedPoolQuery))
        .toMatchObject({ returnedRowCount: 1, decodedResultJsonUtf8Bytes: Buffer.byteLength('[{"value":9}]', "utf8") });
      expect(recon?.checkouts.length).toBeGreaterThanOrEqual(3);
      expect(recon?.transactions).toMatchObject([{ pool: "target", outcome: "commit" }]);
      expect(recon?.unobservedDispatches).toBe(0);
      expect(recon?.unknownStatementDispatches).toBe(0);
      expect(recon?.spans.map(span => span.name)).toEqual(["invocation", "admission", "bridge"]);
      expect(recon?.spans.every(span => span.complete && span.exclusiveMs <= span.inclusiveMs)).toBe(true);
      expect(recon?.dispatches.find(dispatch => dispatch.phasePath.includes("bridge"))?.pool).toBe("target");
      expect(trace.ownerMappings().length).toBeGreaterThan(0);

      await Promise.all(["a", "b"].map(async id => trace.withInvocation({ id, mode: "measured" }, async () => {
        await trace.withPhase(`phase-${id}`, async () => {
          const result = await controlPool.query<{ value: number }>("select $1::int as value", [id === "a" ? 1 : 2]);
          expect(result.rows[0]?.value).toBe(id === "a" ? 1 : 2);
        });
      })));
      const measured = trace.drainRecords();
      expect(measured.map(record => record.id).toSorted()).toEqual(["a", "b"]);
      for (const record of measured) {
        expect(record.dispatches).toEqual([]);
        expect(record.dispatchGroups).toMatchObject([{ pool: "control", dispatchCount: 1 }]);
        expect(record.dispatchGroups[0]?.phasePath).toContain(`phase-${record.id}`);
        expect(record.dispatchAwaitedUnionMs).toBeGreaterThanOrEqual(0);
        expect(record.unobservedDispatches).toBe(0);
      }
      expect(trace.records()).toEqual([]);
    } finally {
      trace.close();
      outsideResource.emitDestroy();
      expect(controlPool.connect).toBe(originalControlConnect);
      expect(controlPool.query).toBe(originalControlQuery);
      await Promise.all([controlPool.end(), targetPool.end()]);
    }
  });

  it("preserves database rejection and records its original dispatch failure", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL is required for this test.");
    const controlPool = new Pool({ connectionString: postgresUrl });
    const targetPool = new Pool({ connectionString: postgresUrl });
    const trace = createMixedMutationPerformanceTrace({ controlPool, targetPool });
    try {
      const error = await trace.withInvocation({ id: "rejected", mode: "recon" }, async () => {
        try { await targetPool.query("select * from missing_trace_relation"); }
        catch (cause) { return cause; }
        throw new Error("Expected PostgreSQL rejection.");
      });
      expect(error).toMatchObject({ code: "42P01" });
      const [record] = trace.drainRecords();
      expect(record?.outcome).toBe("ok");
      expect(record?.dispatches).toMatchObject([{ pool: "target", outcome: "error" }]);
      expect(record?.dispatchGroups).toMatchObject([{ errorCount: 1 }]);
    } finally {
      trace.close();
      await Promise.all([controlPool.end(), targetPool.end()]);
    }
  });

  it("preserves distinct reconnaissance sites for the same SQL and phase on separate pools", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL is required for this test.");
    const controlPool = new Pool({ connectionString: postgresUrl });
    const targetPool = new Pool({ connectionString: postgresUrl });
    const trace = createMixedMutationPerformanceTrace({ controlPool, targetPool });
    try {
      await trace.withInvocation({ id: "owner-sites", mode: "recon" }, async () => trace.withPhase("shared", async () => {
        await traceFromFirstSite(controlPool);
        await traceFromSecondSite(controlPool);
        await traceFromFirstSite(targetPool);
      }));
      const mappings = trace.ownerMappings();
      const control = mappings.find(mapping => mapping.pool === "control" && mapping.phasePath.includes("shared"));
      const target = mappings.find(mapping => mapping.pool === "target" && mapping.phasePath.includes("shared"));
      expect(mappings).toHaveLength(2);
      expect(control).toMatchObject({ status: "ambiguous", owner: null, observedDispatches: 2 });
      expect(control?.sourceSites).toHaveLength(2);
      expect(new Set(control?.sourceSites.map(site => site.siteId)).size).toBe(2);
      expect(target).toMatchObject({ status: "unattributed", owner: null, observedDispatches: 1 });
      expect(target?.sourceSites).toHaveLength(1);
      expect(control?.fingerprint).toBe(target?.fingerprint);
    } finally {
      trace.close();
      await Promise.all([controlPool.end(), targetPool.end()]);
    }
  });

  it("flags acquired-client SQL that loses invocation context without assigning its costs", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL is required for this test.");
    const controlPool = new Pool({ connectionString: postgresUrl });
    const targetPool = new Pool({ connectionString: postgresUrl });
    const trace = createMixedMutationPerformanceTrace({ controlPool, targetPool });
    const outsideResource = new AsyncResource("trace-unbound-resource");
    try {
      await outsideResource.runInAsyncScope(() => controlPool.query("select 1"));
      expect(trace.records()).toEqual([]);

      await trace.withInvocation({ id: "unbound", mode: "recon" }, async () => {
        await controlPool.query("select 1");
        await outsideResource.runInAsyncScope(() => controlPool.query("select 2"));
        await controlPool.query("select 3");
      });
      const [unbound] = trace.drainRecords();
      expect(unbound?.lostContextDispatches).toBe(1);
      expect(unbound?.dispatches).toHaveLength(2);
      expect(unbound?.dispatches.every(dispatch => dispatch.pool === "control")).toBe(true);

      await trace.withInvocation({ id: "bound", mode: "recon" }, async () => {
        const bound = trace.bindCurrent(async () => controlPool.query("select 4"));
        await outsideResource.runInAsyncScope(bound);
      });
      const [bound] = trace.drainRecords();
      expect(bound?.lostContextDispatches).toBe(0);
      expect(bound?.dispatches).toHaveLength(1);

      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const first = trace.withInvocation({ id: "concurrent-first", mode: "measured" }, async () => { await held; });
      const second = trace.withInvocation({ id: "concurrent-second", mode: "measured" }, async () => { await held; });
      try { await outsideResource.runInAsyncScope(() => targetPool.query("select 5")); }
      finally { release(); }
      await Promise.all([first, second]);
      const concurrent = trace.drainRecords();
      expect(concurrent).toHaveLength(2);
      expect(concurrent.map(record => record.lostContextDispatches)).toEqual([1, 1]);
      expect(concurrent.every(record => record.dispatchGroups.length === 0)).toBe(true);
    } finally {
      trace.close();
      outsideResource.emitDestroy();
      await Promise.all([controlPool.end(), targetPool.end()]);
    }
  });
});
