import { describe, expect, it } from "vitest";
import { createPostgresStorageLeasePool, type PostgresStorageSchema } from "./postgresStorageLeasePool";
import { startPostgresStorageSession } from "./postgresStorageSessionOwner";

describe("runner-owned Postgres storage schemas", () => {
  it("keeps an unused session database-free and rejects unauthenticated control requests", async () => {
    const session = await startPostgresStorageSession("postgresql://unused@127.0.0.1:1/unused", 1);
    try {
      const refused = await fetch(session.endpoint.url, { method: "POST", body: "{}" });
      expect(refused.status).toBe(403);
      const malformed = await fetch(session.endpoint.url, { method: "POST", body: "{}",
        headers: { authorization: `Bearer ${session.endpoint.token}` } });
      expect(malformed.status).toBe(500);
      expect(session.statistics()).toMatchObject({ created: 0, retained: 0 });
    } finally { await session.close(); }
  });

  it("leases exclusively, reuses only clean schemas and rejects stale returns", async () => {
    const destroyed: PostgresStorageSchema[] = [];
    const pool = createPostgresStorageLeasePool({ maximumSchemas: 2,
      create: async () => undefined, destroy: async schema => { destroyed.push(schema); },
      assertDisconnected: async () => undefined });
    const [first, concurrent] = await Promise.all([pool.acquire("source"), pool.acquire("source")]);
    expect(first.schemaName).not.toBe(concurrent.schemaName);
    await expect(pool.acquire("source")).rejects.toThrow("budget exhausted");
    await pool.release(first.leaseId, true, "baseline");
    const reused = await pool.acquire("source");
    expect(reused).toMatchObject({ schemaName: first.schemaName, fresh: false, seal: "baseline" });
    expect(reused.leaseId).not.toBe(first.leaseId);
    await expect(pool.release(first.leaseId, true, "baseline")).rejects.toThrow("already returned");
    await pool.release(reused.leaseId, true, "baseline");
    await pool.release(concurrent.leaseId, true, "baseline");
    await pool.close();
    expect(destroyed).toHaveLength(2);
    expect(pool.statistics()).toMatchObject({ created: 2, reused: 1, retained: 0 });
  });

  it("retires failed leases and incompatible source keys instead of reusing them", async () => {
    const destroyed: string[] = [];
    const pool = createPostgresStorageLeasePool({ maximumSchemas: 2,
      create: async () => undefined, destroy: async schema => { destroyed.push(schema.schemaName); },
      assertDisconnected: async () => undefined });
    const failed = await pool.acquire("old");
    await pool.release(failed.leaseId, false, null);
    const healthy = await pool.acquire("old");
    expect(healthy.schemaName).not.toBe(failed.schemaName);
    await pool.release(healthy.leaseId, true, "baseline");
    const changed = await pool.acquire("changed bootstrap");
    expect(changed.fresh).toBe(true);
    expect(destroyed).toEqual([failed.schemaName, healthy.schemaName]);
    await pool.release(changed.leaseId, true, "new baseline");
    await pool.close();
  });

  it("quarantines a changed baseline and never replaces a resource whose retirement is uncertain", async () => {
    let creates = 0;
    let busy = false;
    const failure = new Error("client still connected");
    const pool = createPostgresStorageLeasePool({ maximumSchemas: 2,
      create: async () => { creates++; }, destroy: async () => undefined,
      assertDisconnected: async () => { if (busy) throw failure; } });
    const first = await pool.acquire("source");
    await pool.release(first.leaseId, true, "baseline");
    const changed = await pool.acquire("source");
    await expect(pool.release(changed.leaseId, true, "tampered")).rejects.toThrow("baseline seal changed");
    const active = await pool.acquire("source");
    busy = true;
    await expect(pool.release(active.leaseId, false, null)).rejects.toBe(failure);
    await expect(pool.acquire("source")).rejects.toBe(failure);
    expect(creates).toBe(2);
    busy = false;
    await pool.close();
  });

  it("preserves acquisition and cleanup failures", async () => {
    const creation = new Error("create failed");
    const cleanup = new Error("retire failed");
    let cannotRetire = true;
    const pool = createPostgresStorageLeasePool({ maximumSchemas: 1,
      create: async () => { throw creation; },
      destroy: async () => { if (cannotRetire) throw cleanup; }, assertDisconnected: async () => undefined });
    await expect(pool.acquire("source")).rejects.toMatchObject({ errors: [creation, cleanup] });
    await expect(pool.acquire("source")).rejects.toBe(cleanup);
    cannotRetire = false;
    await pool.close();
    await expect(pool.acquire("source")).rejects.toThrow("closing");
  });

  it("drains construction before shutdown without treating an unreturned lease as clean", async () => {
    let finish: () => void = () => { throw new Error("Missing construction barrier"); };
    const held = new Promise<void>(resolve => { finish = resolve; });
    let destroyed = false;
    const pool = createPostgresStorageLeasePool({ maximumSchemas: 1,
      create: async () => held, destroy: async () => { destroyed = true; }, assertDisconnected: async () => undefined });
    const acquisition = pool.acquire("source");
    const closing = pool.close();
    const refused = expect(closing).rejects.toMatchObject({ errors: [expect.objectContaining({ message: expect.stringContaining("Unreturned") })] });
    await expect(pool.acquire("source")).rejects.toThrow("closing");
    expect(destroyed).toBe(false);
    finish();
    await acquisition;
    await refused;
    expect(destroyed).toBe(false);
  });

  it("does not retire an unreturned lease just because no connection is visible yet", async () => {
    let destroys = 0;
    const pool = createPostgresStorageLeasePool({ maximumSchemas: 1,
      create: async () => undefined, destroy: async () => { destroys++; }, assertDisconnected: async () => undefined });
    await pool.acquire("source");
    await expect(pool.close()).rejects.toMatchObject({ errors: [expect.objectContaining({ message: expect.stringContaining("Unreturned") })] });
    expect(destroys).toBe(0);
  });
});
