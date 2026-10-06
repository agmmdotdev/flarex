import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client, Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { Cause, Effect, Schema } from "effect";
import { createServerMeasurementCapture, acquireServerMeasurementResource, createServerMeasurementArming,
  retireIdleServerPool, ServerMeasurementFailure } from "./server";
import { serverLimits, ServerMeasurementEvidenceSchema } from "../server";
import type { RetrievalServerSnapshot } from "../../../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server";
import { createServerPlanCapture, SERVER_PLAN_LOG_PREFIX } from "./plans";

const snapshot: RetrievalServerSnapshot = { info: [{ stats_reset: "epoch", dealloc: 0 }], statements: [] };
const database = { database: "isolated", dbid: 1 };
const activity = { pid: 12, backendStart: "backend", dbid: 1, userid: 2, state: "active", queryid: "123",
  queryStart: "query", waitType: "Lock", waitEvent: "transactionid", blockerPids: [13] };
const sample = () => Promise.resolve({ serverAt: "time", activities: [activity] });

describe("post-preparation server arming", () => {
  it("retains complete diagnostic defect, interruption and combined Causes", async () => {
    const failure = new ServerMeasurementFailure({ stage: "typedArmFailure", cause: new Error("original typed cause") });
    const defect = new Error("diagnostic defect");
    const combined = Cause.combine(Cause.fail(failure), Cause.die(defect));
    const compoundArming = createServerMeasurementArming(() => Effect.failCause(combined), true);
    await expect(compoundArming.arm([])).rejects.toSatisfy((value: unknown) => Cause.isCause(value)
      && value.reasons.length === 2 && value.reasons.some(reason => Cause.isFailReason(reason) && reason.error === failure)
      && value.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect));
    expect(compoundArming.profile().state).toBe("failed");
    const interrupted = createServerMeasurementArming(() => Effect.failCause(Cause.interrupt(123)), true);
    await expect(interrupted.arm([])).rejects.toSatisfy((value: unknown) => Cause.isCause(value)
      && value.reasons.length === 1 && value.reasons.every(Cause.isInterruptReason));
    const defective = createServerMeasurementArming(() => Effect.die(defect), true);
    await expect(defective.arm([])).rejects.toSatisfy((value: unknown) => Cause.isCause(value)
      && value.reasons.length === 1 && value.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect));
    await compoundArming.close(); await interrupted.close(); await defective.close();
  });
  it("reports actual plan activation only after successful arming of the supplied pools", async () => {
    const pool = new Pool();
    const supplied = [pool];
    for (const plansSelected of [false, true]) {
      let observed: readonly Pool[] | undefined;
      const arming = createServerMeasurementArming(pools => Effect.sync(() => { observed = pools; }), plansSelected);
      expect(arming.profile().plansEnabled).toBe(false);
      await arming.arm(supplied);
      expect(observed).toBe(supplied);
      expect(arming.profile()).toEqual({ state: "armed", plansEnabled: plansSelected });
      await expect(arming.arm(supplied)).rejects.toMatchObject({ stage: "invalidArmingState" });
      await arming.close();
    }
    await pool.end();
  });
  it("keeps the profile unarmed until arming settles, refuses re-entry, and joins arming before close", async () => {
    let settle: (() => void) | undefined;
    const arming = createServerMeasurementArming(() => Effect.promise(() => new Promise<void>(resolve => { settle = resolve; })), true);
    expect(arming.profile()).toEqual({ state: "unarmed", plansEnabled: false });
    const request = arming.arm([]);
    expect(arming.profile().state).toBe("arming");
    await expect(arming.arm([])).rejects.toMatchObject({ stage: "invalidArmingState" });
    let closed = false;
    const closing = arming.close().then(() => { closed = true; });
    await delay(2); expect(closed).toBe(false);
    settle?.(); await request; await closing;
    expect(arming.profile().state).toBe("closed");
    await expect(arming.arm([])).rejects.toMatchObject({ stage: "invalidArmingState" });
  });
  it("keeps failed profiles unusable and retains the original diagnostic cause", async () => {
    const original = new Error("foreign arming failure");
    const arming = createServerMeasurementArming(() => Effect.fail(new ServerMeasurementFailure({ stage: "testArm", cause: original })), true);
    await expect(arming.arm([])).rejects.toBe(original);
    expect(arming.profile().state).toBe("failed");
    await expect(arming.arm([])).rejects.toMatchObject({ stage: "invalidArmingState" });
    await arming.close(); expect(arming.profile().state).toBe("closed");
  });
  it("borrows every old idle client before retiring any, preventing LIFO reuse", async () => {
    const pool = new Pool();
    let idle = 2, total = 2, borrowed = 0;
    const releaseCounts: number[] = [];
    const clients = [0, 1].map(() => Object.assign(new Client(), { release: vi.fn((destroy?: boolean) => {
      expect(destroy).toBe(true); releaseCounts.push(borrowed); total--;
    }) }));
    vi.spyOn(pool, "totalCount", "get").mockImplementation(() => total);
    vi.spyOn(pool, "idleCount", "get").mockImplementation(() => idle);
    const connect = vi.spyOn(pool, "connect").mockImplementation(async () => {
      const client = clients[borrowed];
      if (client === undefined) throw new Error("Unexpected extra borrow");
      borrowed++; idle--; return client;
    });
    await Effect.runPromise(retireIdleServerPool(pool));
    expect(connect).toHaveBeenCalledTimes(2);
    expect(releaseCounts).toEqual([2, 2]);
    await pool.end();
  });
  it("fails closed on a busy pool and releases borrowed clients after stale ownership", async () => {
    const busy = new Pool();
    vi.spyOn(busy, "totalCount", "get").mockReturnValue(1);
    vi.spyOn(busy, "idleCount", "get").mockReturnValue(0);
    const unusedConnect = vi.spyOn(busy, "connect");
    const busyExit = await Effect.runPromiseExit(retireIdleServerPool(busy));
    expect(busyExit._tag).toBe("Failure"); expect(unusedConnect).not.toHaveBeenCalled();
    await busy.end();
    const stale = new Pool();
    let total = 2, idle = 2;
    const client = Object.assign(new Client(), { release: vi.fn() });
    vi.spyOn(stale, "totalCount", "get").mockImplementation(() => total);
    vi.spyOn(stale, "idleCount", "get").mockImplementation(() => idle);
    vi.spyOn(stale, "connect").mockImplementation(async () => { idle--; total++; return client; });
    const staleExit = await Effect.runPromiseExit(retireIdleServerPool(stale));
    expect(staleExit._tag).toBe("Failure"); expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    await stale.end();
  });
});

describe("owned server capture", () => {
  it("retains original business failure when the optional plan source is unavailable", async () => {
    const business = new Error("original business failure");
    const plans = createServerPlanCapture({ database: database.database,
      source: { path: join(tmpdir(), `missing-server-plan-${randomUUID()}.log`), prefix: SERVER_PLAN_LOG_PREFIX } });
    const collector = createServerMeasurementCapture({ database, snapshot: async () => snapshot, sample, plans });
    await expect(collector.capture(async () => { throw business; })).rejects.toBe(business);
    expect(collector.failures()).toContain(plans.failures()[0]);
    expect(collector.evidence()?.status).toBe("incomplete");
    expect(collector.evidence()?.actualPlans.status).toBe("incomplete");
    expect(Schema.decodeUnknownResult(ServerMeasurementEvidenceSchema)(collector.evidence())._tag).toBe("Success");
  });
  it("joins pending observer work and preserves original business rejection", async () => {
    const business = new Error("original business failure"), observer = new Error("original observer failure");
    let settle: (() => void) | undefined;
    let sampled = false;
    const collector = createServerMeasurementCapture({ database, snapshot: async () => snapshot,
      sample: () => new Promise((_, reject) => { sampled = true; settle = () => reject(observer); }) });
    let completed = false;
    const request = collector.capture(async () => { throw business; }).finally(() => { completed = true; });
    await delay(5);
    expect(sampled).toBe(true); expect(completed).toBe(false);
    settle?.();
    await expect(request).rejects.toBe(business);
    expect(collector.failures()).toEqual([observer]);
    expect(collector.evidence()?.status).toBe("incomplete");
    expect(collector.evidence()?.observers.map(value => value.name)).toContain("serverSamplerJoin");
  });
  it("marks row capacity, foreign identity, and restricted visibility as incomplete without replacing return values", async () => {
    for (const observed of [{ serverAt: "time", activities: [activity, { ...activity, pid: 13 }] },
      { serverAt: "time", activities: [{ ...activity, dbid: 99 }] },
      { serverAt: "time", activities: [{ ...activity, userid: null }] }, undefined]) {
      const collector = createServerMeasurementCapture({ database, limits: { ...serverLimits, maxRows: 1 },
        snapshot: async () => snapshot, sample: async () => observed });
      expect(await collector.capture(async () => { await delay(3); return "original"; })).toBe("original");
      expect(collector.evidence()?.status).toBe("incomplete");
      expect(collector.failures()).toHaveLength(1);
    }
  });
  it("bounds observation instead of cancelling business execution and rejects concurrent capture", async () => {
    const collector = createServerMeasurementCapture({ database, limits: { ...serverLimits, maxDurationMs: 25, maxPolls: 1 },
      snapshot: async () => snapshot, sample });
    const request = collector.capture(async () => { await delay(65); return 17; });
    await expect(collector.capture(async () => 18)).rejects.toMatchObject({ _tag: "ServerMeasurementFailure", stage: "concurrentCapture" });
    expect(await request).toBe(17);
    expect(collector.evidence()?.polls).toHaveLength(1);
    expect(collector.evidence()?.status).toBe("incomplete");
    expect(Schema.decodeUnknownResult(ServerMeasurementEvidenceSchema)(collector.evidence())._tag).toBe("Success");
  });
  it("retains before/after statistics refusal and no late sampler after callback settlement", async () => {
    let snapshots = 0, polls = 0;
    const collector = createServerMeasurementCapture({ database, sample: async () => { polls++; return sample(); },
      snapshot: async () => ++snapshots === 1 ? snapshot : { ...snapshot, info: [{ stats_reset: "changed", dealloc: 0 }] } });
    expect(await collector.capture(async () => 9)).toBe(9);
    expect(collector.evidence()?.before?.stats_reset).toBe("epoch");
    expect(collector.evidence()?.after?.stats_reset).toBe("changed");
    const settledPolls = polls;
    await delay(40); expect(polls).toBe(settledPolls);
    expect(collector.evidence()?.status).toBe("incomplete");
  });
});

describe.skipIf(process.env.FLAREX_MEASUREMENT_SERVER_INTEGRATION !== "1")("ordinary-role actual server execution and lock witness", () => {
  it("uses owned isolated endpoints and observes a genuine conflicting row lock", async () => {
    const resource = await acquireServerMeasurementResource();
    const pool = new Pool({ connectionString: resource.endpoints.connectionString, max: 2 });
    let blocker: PoolClient | undefined;
    try {
      expect(resource.profile().state).toBe("unarmed");
      const neverRun = vi.fn(async () => 1);
      await expect(resource.capture(neverRun)).rejects.toMatchObject({ stage: "unarmedResource" });
      expect(neverRun).not.toHaveBeenCalled();
      await resource.arm([pool]);
      expect(resource.profile().state).toBe("armed");
      const actual = await resource.verifyRuntimePools(pool, pool);
      expect(actual.target.privileges).toEqual({ superuser: false, bypassRls: false, createDb: false, createRole: false });
      await pool.query("create table server_observation_witness (id int primary key, value int)");
      await pool.query("insert into server_observation_witness values (1,0)");
      const holder = await pool.connect(); blocker = holder;
      await holder.query("begin"); await holder.query("update server_observation_witness set value=1 where id=1");
      await resource.capture(async () => {
        const work = pool.query("update server_observation_witness set value=2 where id=1");
        await delay(150); await holder.query("rollback"); await work;
      });
      expect(resource.evidence()?.status).toBe("complete");
      expect(resource.evidence()?.statements.some(statement => statement.calls > 0 && statement.total_exec_time > 0)).toBe(true);
      expect(resource.evidence()?.polls.some(poll => poll.activities.some(row => row.waitType === "Lock" && row.blockerPids.length > 0))).toBe(true);
      expect(JSON.stringify(resource.evidence())).not.toContain("server_observation_witness");
      expect(Schema.decodeUnknownResult(ServerMeasurementEvidenceSchema)(resource.evidence())._tag).toBe("Success");
    } finally {
      if (blocker !== undefined) { await blocker.query("rollback"); blocker.release(); }
      await pool.end(); await resource.close();
      const catalog = new Pool({ connectionString: process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL,
        connectionTimeoutMillis: 2000, statement_timeout: 1000, query_timeout: 1250 });
      try {
        expect((await catalog.query("select datname from pg_database where datname=any($1::text[])",
          [resource.ownedResources.databases])).rows).toEqual([]);
        expect((await catalog.query("select rolname from pg_roles where rolname=any($1::text[])",
          [resource.ownedResources.roles])).rows).toEqual([]);
      } finally { await catalog.end(); }
    }
  });
});
