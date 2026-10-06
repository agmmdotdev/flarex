import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { Client, Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { createMixedMutationPerformanceTrace, decodedQueryResultSizes, structuralSql } from "./mixedMutationPerformanceTrace";
import { postgresUrl } from "./postgresHelpers";

async function traceFromFirstSite(pool: Pool): Promise<void> { await pool.query("select $1::int as value", [1]); }
async function traceFromSecondSite(pool: Pool): Promise<void> { await pool.query("select $1::int as value", [2]); }

function fakeDriver() {
  const pool = new Pool();
  const client: PoolClient = Object.assign(new Client(), { release: () => undefined });
  const validationError = new Error("Original synchronous validation failure");
  const driverError = new Error("Original driver rejection");
  let result: unknown = { rows: [{ value: 7 }] };
  let lastPromise: Promise<unknown> | undefined;
  let submitted = 0;
  const callbackReturn = { originalDriverReturn: true };
  Object.defineProperty(client, "query", { configurable: true, writable: true,
    value: function (...args: unknown[]) {
      if (args[0] === "sync-invalid") throw validationError;
      submitted++;
      const callback = args.at(-1);
      const failed = args[0] === "async-invalid";
      if (typeof callback === "function") {
        queueMicrotask(() => Reflect.apply(callback, client, [failed ? driverError : null, failed ? undefined : result]));
        return callbackReturn;
      }
      lastPromise = failed ? Promise.reject(driverError) : Promise.resolve(result);
      return lastPromise;
    } });
  Object.defineProperty(pool, "connect", { configurable: true, writable: true,
    value: (callback?: (error: Error | undefined, acquired: PoolClient, release: () => void) => void) => {
      if (callback !== undefined) { queueMicrotask(() => callback(undefined, client, client.release)); return; }
      return Promise.resolve(client);
    } });
  return { pool, client, validationError, driverError, callbackReturn,
    result: (value: unknown) => { result = value; },
    lastPromise: () => lastPromise, submitted: () => submitted };
}

describe("mixed mutation performance trace driver contract", () => {
  it("captures actual BackendKeyData PID at submission without another query or accessor reads", async () => {
    const driver = fakeDriver();
    Object.defineProperty(driver.client, "processID", { configurable: true, value: 8123 });
    const trace = createMixedMutationPerformanceTrace({ controlPool: driver.pool, targetPool: driver.pool });
    try {
      await trace.withInvocation({ id: "backend-pid", mode: "recon" }, async () => {
        const client = await driver.pool.connect();
        await client.query("select 7");
        Object.defineProperty(client, "processID", { configurable: true, get: () => { throw new Error("Do not invoke PID getter"); } });
        await client.query("select 8");
      });
      expect(driver.submitted()).toBe(2);
      expect(trace.records()[0]?.dispatches.map(dispatch => dispatch.backendPid)).toEqual([8123, null]);
      expect(trace.records()[0]?.observationErrors).toBe(1);
      expect(JSON.stringify(trace.records())).not.toContain("secretKey");
    } finally { trace.close(); await driver.pool.end(); }
  });
  it("retains distinct direct operation parents for identical SQL and isolates concurrent requests", async () => {
    const driver = fakeDriver();
    const operations = new AsyncLocalStorage<string>();
    const trace = createMixedMutationPerformanceTrace({ controlPool: driver.pool, targetPool: driver.pool,
      currentOperationId: () => operations.getStore() ?? null });
    try {
      await trace.withInvocation({ id: "same-sql", mode: "recon" }, async () => {
        const client = await operations.run("checkout-operation", () => driver.pool.connect());
        for (const id of ["first-operation", "second-operation"]) {
          await operations.run(id, () => client.query("select 7"));
        }
      });
      const sameSql = trace.records()[0];
      expect(sameSql?.dispatches.map(dispatch => dispatch.operationId)).toEqual(["first-operation", "second-operation"]);
      expect(new Set(sameSql?.dispatches.map(dispatch => dispatch.fingerprint)).size).toBe(1);
      expect(sameSql?.checkouts[0]?.operationId).toBe("checkout-operation");
      expect(sameSql?.operationCorrelation).toBe("enabled");
      expect(sameSql?.lostOperationContexts).toBe(0);
      expect(sameSql?.observerIntervals.filter(interval => interval.kind === "operation-correlation")).toHaveLength(3);
      await Promise.all(["request-a", "request-b"].map(id => operations.run(id, () =>
        trace.withInvocation({ id, mode: "recon" }, async () => {
          const client = await driver.pool.connect();
          await new Promise<void>(resolve => queueMicrotask(resolve));
          await client.query("select 7");
        }))));
      for (const record of trace.records().slice(1)) {
        expect(record.dispatches[0]?.operationId).toBe(record.id);
        expect(record.checkouts[0]?.operationId).toBe(record.id);
        expect(record.lostOperationContexts).toBe(0);
      }
    } finally { trace.close(); await driver.pool.end(); operations.disable(); }
  });

  it("carries the pool submission parent through a queued foreign checkout callback", async () => {
    const driver = fakeDriver();
    const operations = new AsyncLocalStorage<string>();
    const foreignCallback = new AsyncResource("foreign-pg-checkout");
    let pending: (() => void) | undefined;
    let reads = 0;
    Object.defineProperty(driver.pool, "connect", { configurable: true, writable: true,
      value: (callback: (error: Error | undefined, client: PoolClient, done: () => void) => void) => {
        pending = () => foreignCallback.runInAsyncScope(() => operations.run("foreign-callback-operation", () =>
          callback(undefined, driver.client, driver.client.release)));
      } });
    // Keep this deterministic fake's pool delegation protocol identical to pg:
    // acquisition callback submits to client.query and settles the original promise.
    let submittedPromise: Promise<unknown> | undefined;
    Object.defineProperty(driver.pool, "query", { configurable: true, writable: true,
      value: (sql: string) => {
        submittedPromise = new Promise((resolve, reject) => {
          driver.pool.connect((error, client) => {
            if (error) { reject(error); return; }
            if (client === undefined) { reject(new Error("Fake pool acquisition returned no client.")); return; }
            client.query(sql, (failure, result) => failure ? reject(failure) : resolve(result));
          });
        });
        return submittedPromise;
      } });
    const originalPoolQuery = driver.pool.query;
    const originalConnect = driver.pool.connect;
    const originalClientQuery = driver.client.query;
    const trace = createMixedMutationPerformanceTrace({ controlPool: driver.pool, targetPool: driver.pool,
      currentOperationId: () => { reads++; return operations.getStore() ?? null; } });
    try {
      await trace.withInvocation({ id: "queued-pool", mode: "recon" }, async () => {
        const promise = operations.run("initiating-operation", () => driver.pool.query("select 7"));
        expect(promise).toBe(submittedPromise);
        expect(pending).toBeDefined();
        pending?.();
        expect(await promise).toEqual({ rows: [{ value: 7 }] });
      });
      const record = trace.records()[0];
      expect(reads).toBe(1);
      expect(record?.dispatches[0]).toMatchObject({ operationId: "initiating-operation", delegatedPoolQuery: true });
      expect(record?.checkouts[0]?.operationId).toBe("initiating-operation");
      expect(record?.lostOperationContexts).toBe(0);
      trace.close();
      expect(driver.pool.query).toBe(originalPoolQuery);
      expect(driver.pool.connect).toBe(originalConnect);
      expect(driver.client.query).toBe(originalClientQuery);
      await driver.client.query("select 7");
      expect(reads).toBe(1);
    } finally { trace.close(); await driver.pool.end(); foreignCallback.emitDestroy(); operations.disable(); }
  });

  it("contains missing, malformed and throwing operation readers without replacing driver outcomes", async () => {
    const driver = fakeDriver();
    let identity: string | null = null;
    let throwReader = false;
    const trace = createMixedMutationPerformanceTrace({ controlPool: driver.pool, targetPool: driver.pool,
      currentOperationId: () => { if (throwReader) throw new Error("Diagnostic reader fault"); return identity; } });
    try {
      await trace.withInvocation({ id: "reader-faults", mode: "recon" }, async () => {
        const client = await driver.pool.connect();
        const result = client.query("select 7");
        expect(result).toBe(driver.lastPromise());
        expect(await result).toEqual({ rows: [{ value: 7 }] });
        identity = "";
        await new Promise<void>((resolve, reject) => {
          const returned = client.query("select 7", (error, value) => {
            if (error) { reject(error); return; }
            expect(value).toEqual({ rows: [{ value: 7 }] });
            resolve();
          });
          expect(returned).toBe(driver.callbackReturn);
        });
        throwReader = true;
        expect(() => client.query("sync-invalid")).toThrow(driver.validationError);
        const failed = client.query("async-invalid");
        expect(failed).toBe(driver.lastPromise());
        await expect(failed).rejects.toBe(driver.driverError);
      });
      const record = trace.records()[0];
      expect(record?.dispatches.map(dispatch => dispatch.operationId)).toEqual([null, null, null]);
      expect(record?.checkouts[0]?.operationId).toBeNull();
      expect(record?.lostOperationContexts).toBe(4);
      expect(record?.observationErrors).toBe(3);
      expect(record?.observerIntervals.filter(interval => interval.kind === "operation-correlation" && interval.outcome === "error")).toHaveLength(3);
      expect(record?.dispatches.map(dispatch => dispatch.outcome)).toEqual(["ok", "ok", "error"]);
      expect(record?.outcome).toBe("ok");
    } finally { trace.close(); await driver.pool.end(); }
  });

  it("retains BEGIN's initiating operation without parenting the longer transaction interval", async () => {
    const driver = fakeDriver();
    const operations = new AsyncLocalStorage<string>();
    const trace = createMixedMutationPerformanceTrace({ controlPool: driver.pool, targetPool: driver.pool,
      currentOperationId: () => operations.getStore() ?? null });
    try {
      await trace.withInvocation({ id: "transaction-origin", mode: "recon" }, async () => {
        const client = await operations.run("checkout", () => driver.pool.connect());
        await operations.run("begin-operation", () => client.query("begin"));
        await operations.run("body-operation", () => client.query("select 7"));
        await operations.run("commit-operation", () => client.query("commit"));
      });
      const record = trace.records()[0];
      expect(record?.dispatches.map(dispatch => dispatch.operationId)).toEqual([
        "begin-operation", "body-operation", "commit-operation",
      ]);
      expect(record?.dispatches[0]?.transactionAction).toBe("begin");
      expect(record?.transactions[0]?.transactionId).toBe(record?.dispatches[0]?.transactionId);
      expect(record?.transactions[0]).not.toHaveProperty("operationId");
      expect(record?.lostOperationContexts).toBe(0);
    } finally { trace.close(); await driver.pool.end(); operations.disable(); }
  });

  it("retains actual connection, checkout and transaction identities with ordered observer intervals", async () => {
    const driver = fakeDriver();
    const trace = createMixedMutationPerformanceTrace({ controlPool: driver.pool, targetPool: driver.pool });
    try {
      await trace.withInvocation({ id: "identities", mode: "recon" }, async () => {
        const client = await driver.pool.connect();
        await client.query("begin");
        const promise = client.query("select 7");
        expect(promise).toBe(driver.lastPromise());
        expect(await promise).toEqual({ rows: [{ value: 7 }] });
        await client.query("commit");
        client.release();
        const reused = await driver.pool.connect();
        await reused.query("select 7");
        reused.release();
      });
      const record = trace.records()[0];
      expect(record?.observationErrors).toBe(0);
      expect(record?.operationCorrelation).toBe("disabled");
      expect(record?.lostOperationContexts).toBe(0);
      expect(record?.droppedObservations).toBe(0);
      expect(record?.dispatches).toHaveLength(4);
      expect(record?.checkouts).toHaveLength(2);
      const [firstCheckout, secondCheckout] = record?.checkouts ?? [];
      expect(firstCheckout?.connectionId).toBe(secondCheckout?.connectionId);
      expect(firstCheckout?.checkoutId).not.toBe(secondCheckout?.checkoutId);
      const [begin, select, commit, outside] = record?.dispatches ?? [];
      expect(begin?.transactionId).not.toBeNull();
      expect(select?.transactionId).toBe(begin?.transactionId);
      expect(commit?.transactionId).toBe(begin?.transactionId);
      expect(outside?.transactionId).toBeNull();
      expect(outside?.checkoutId).toBe(secondCheckout?.checkoutId);
      expect(record?.transactions).toMatchObject([{ transactionId: begin?.transactionId,
        connectionId: firstCheckout?.connectionId, checkoutId: firstCheckout?.checkoutId, outcome: "commit" }]);
      const events = [...record?.dispatches ?? [], ...record?.checkouts ?? [],
        ...record?.transactions ?? [], ...record?.observerIntervals ?? []];
      expect(new Set(events.map(event => event.eventId)).size).toBe(events.length);
      expect(record?.dispatches.map(event => event.eventId)).toEqual(record?.dispatches.map(event => event.eventId).toSorted((a, b) => a - b));
      expect(record?.observerIntervals.every(event => event.endMs >= event.startMs && event.durationMs >= 0)).toBe(true);
      expect(new Set(record?.observerIntervals.map(event => event.kind))).toEqual(new Set([
        "preparation", "fingerprinting", "input-sizing", "source-stack", "backend-identity", "result-sizing", "event-recording", "finalization",
      ]));
      const finalization = record?.observerIntervals.find(event => event.kind === "finalization");
      expect(finalization?.startMs).toBeGreaterThanOrEqual(record?.durationMs ?? Infinity);
    } finally { trace.close(); await driver.pool.end(); }
  });

  it("preserves callback reentry, synchronous validation and the original Promise rejection", async () => {
    const driver = fakeDriver();
    const trace = createMixedMutationPerformanceTrace({ controlPool: driver.pool, targetPool: driver.pool });
    try {
      await trace.withInvocation({ id: "outcomes", mode: "recon" }, async () => {
        const client = await driver.pool.connect();
        expect(() => client.query("sync-invalid")).toThrow(driver.validationError);
        const failed = client.query("async-invalid");
        expect(failed).toBe(driver.lastPromise());
        await expect(failed).rejects.toBe(driver.driverError);
        await new Promise<void>((resolve, reject) => {
          const returned = client.query("select 7", (error, value) => {
            if (error) { reject(error); return; }
            expect(value).toEqual({ rows: [{ value: 7 }] });
            void trace.withPhase("callback-reentry", async () => { await client.query("select 8"); })
              .then(() => resolve(), reject);
          });
          expect(returned).toBe(driver.callbackReturn);
        });
      });
      const record = trace.records()[0];
      expect(driver.submitted()).toBe(3);
      expect(record?.dispatches).toHaveLength(3);
      expect(record?.dispatches.map(dispatch => dispatch.outcome)).toEqual(["error", "ok", "ok"]);
      expect(record?.dispatches.at(-1)?.phasePath).toContain("callback-reentry");
    } finally { trace.close(); await driver.pool.end(); }
  });

  it("contains foreign observation faults and reports bounded dropped evidence without changing success", async () => {
    const driver = fakeDriver();
    const trace = createMixedMutationPerformanceTrace({ controlPool: driver.pool, targetPool: driver.pool,
      observationLimit: 5 });
    const row = { toJSON: () => { throw new Error("Foreign sizing failure"); } };
    const originalResult = { rows: [row] };
    driver.result(originalResult);
    try {
      const result = await trace.withInvocation({ id: "faults", mode: "recon" }, async () => {
        const client = await driver.pool.connect();
        const config = new Proxy({ text: "select 7" }, { getOwnPropertyDescriptor: () => { throw new Error("Foreign input inspection failure"); } });
        return client.query(config);
      });
      expect(result).toBe(originalResult);
      const record = trace.records()[0];
      expect(record?.outcome).toBe("ok");
      expect(record?.observationErrors).toBeGreaterThanOrEqual(3);
      expect(record?.droppedObservations).toBeGreaterThan(0);
      expect(record?.observationLimit).toBe(5);
      expect((record?.dispatches.length ?? 0) + (record?.checkouts.length ?? 0)
        + (record?.transactions.length ?? 0) + (record?.observerIntervals.length ?? 0)).toBe(5);
      expect(driver.submitted()).toBe(1);
      const parameters = new Proxy([1], { getOwnPropertyDescriptor: () => { throw new Error("Foreign parameter inspection failure"); } });
      await expect(trace.withInvocation({ id: "fault-and-rejection", mode: "recon" }, async () => {
        const client = await driver.pool.connect();
        return client.query("async-invalid", parameters);
      })).rejects.toBe(driver.driverError);
      const failed = trace.records()[1];
      expect(failed?.outcome).toBe("error");
      expect(failed?.observationErrors).toBeGreaterThan(0);
    } finally { trace.close(); await driver.pool.end(); }
  });

  it("reports repeated client installation faults while preserving the acquired client and its query", async () => {
    const driver = fakeDriver();
    Object.defineProperty(driver.client, "query", { configurable: false, writable: false });
    const original = driver.client.query;
    const trace = createMixedMutationPerformanceTrace({ controlPool: driver.pool, targetPool: driver.pool });
    try {
      for (const id of ["first-install-fault", "second-install-fault"]) {
        const value = await trace.withInvocation({ id, mode: "recon" }, async () => {
          const client = await driver.pool.connect();
          expect(client).toBe(driver.client);
          return client.query("select 7");
        });
        expect(value).toEqual({ rows: [{ value: 7 }] });
      }
      expect(driver.client.query).toBe(original);
      expect(trace.records().map(record => record.observationErrors)).toEqual([1, 1]);
      expect(trace.records().every(record => record.outcome === "ok")).toBe(true);
    } finally { trace.close(); await driver.pool.end(); }
  });
});

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
