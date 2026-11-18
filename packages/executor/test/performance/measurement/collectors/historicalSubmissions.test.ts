import { Client, Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { structuralSql } from "../../../../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";
import { createHistoricalSubmissionObserver } from "./historicalSubmissions";

describe("scoped historical submissions", () => {
  it("counts actual client submissions once and restores methods and listeners", async () => {
    const target = new Pool(), setupControl = new Pool(), managedReadControl = new Pool();
    const client = Object.assign(new Client(), { processID: 12, release: vi.fn() });
    const query = vi.fn(async () => ({ rows: [] }));
    Object.defineProperty(client, "query", { value: query, writable: true, configurable: true });
    const original = Object.getOwnPropertyDescriptor(client, "query");
    const observer = createHistoricalSubmissionObserver({ target, setupControl, managedReadControl });
    observer.begin();
    target.emit("acquire", client);
    await client.query({ name: "fx_finite_test", text: "select $1", values: ["private parameter"] });
    const observed = observer.end();
    expect(query).toHaveBeenCalledTimes(1);
    expect(observed.failures).toEqual([]);
    expect(observed.submissions).toHaveLength(1);
    expect(observed.submissions[0]).toMatchObject({ name: "fx_finite_test", backendPid: 12,
      fingerprint: structuralSql("select $1")?.fingerprint, pool: "target", outcome: "success" });
    expect(JSON.stringify(observed)).not.toContain("private parameter");
    expect(JSON.stringify(observed)).not.toContain("select");
    observer.close();
    expect(Object.getOwnPropertyDescriptor(client, "query")).toEqual(original);
    expect(target.listenerCount("acquire")).toBe(0);
    await target.end(); await setupControl.end(); await managedReadControl.end();
  });
  it("keeps an unnamed control submission visible and records observation failure without replacing pg rejection", async () => {
    const target = new Pool(), setupControl = new Pool(), managedReadControl = new Pool();
    const client = Object.assign(new Client(), { release: vi.fn() });
    const original = new Error("pg rejected");
    const query = vi.fn(async () => { throw original; });
    Object.defineProperty(client, "query", { value: query, writable: true, configurable: true });
    Object.defineProperty(client, "processID", { get: () => { throw new Error("PID getter must not run"); } });
    const observer = createHistoricalSubmissionObserver({ target, setupControl, managedReadControl });
    observer.begin(); managedReadControl.emit("acquire", client);
    await expect(client.query("select 1")).rejects.toBe(original);
    const observed = observer.end();
    expect(observed.failures).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
    observer.close();
    await target.end(); await setupControl.end(); await managedReadControl.end();
  });
});
