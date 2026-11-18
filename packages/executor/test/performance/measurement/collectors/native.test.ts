import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  query: vi.fn<(sql: string) => Promise<unknown>>(),
  end: vi.fn<() => Promise<void>>(),
  dispose: vi.fn<() => Promise<void>>(),
  prepare: vi.fn<(medusaUrl: string, payloadUrl: string) => Promise<{ dispose: () => Promise<void> }>>(),
  constructions: [] as unknown[],
  events: [] as string[],
}));
vi.mock("pg", () => ({ Pool: class {
  constructor(options: unknown) { native.constructions.push(options); }
  query = native.query;
  end = native.end;
} }));
vi.mock("../../../../../medusa-adapter/benchmarks/core-performance/native-business/native", () => ({
  prepareNativeBusiness: native.prepare,
}));

import { acquireNativeBusinessResource } from "./native";

const provisioningUrl = "postgresql://provisioner:fixture-secret@127.0.0.1:5432/provisioning" +
  "?options=-c%20role%3Dprovisioner&application_name=provisioning&user=override_admin&password=override_secret&sslmode=disable";
const commands = () => native.query.mock.calls.map(([sql]) => sql);
const createdName = (sql: string) => {
  const name = sql.match(/^create (?:role|database) "([a-z0-9_]+)"/)?.[1];
  if (name === undefined) throw new Error("Missing owned creation command in test witness");
  return name;
};

beforeEach(() => {
  vi.stubEnv("FLAREX_POSTGRES_PROVISIONING_DATABASE_URL", provisioningUrl);
  vi.clearAllMocks();
  native.constructions.length = 0;
  native.events.length = 0;
  native.query.mockImplementation(async sql => { native.events.push(sql); return undefined; });
  native.end.mockImplementation(async () => { native.events.push("pool end"); });
  native.dispose.mockImplementation(async () => { native.events.push("business dispose"); });
  native.prepare.mockImplementation(async () => {
    native.events.push("business preparation");
    return { dispose: native.dispose };
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("isolated native comparison acquisition", () => {
  it("supplies two fresh ordinary databases and drains business before exactly owned cleanup", async () => {
    const fixture = await acquireNativeBusinessResource();
    const preparation = native.prepare.mock.calls[0];
    if (preparation === undefined) throw new Error("Missing native preparation call");
    const [medusa, payload] = preparation.map(url => new URL(url));
    if (medusa === undefined || payload === undefined) throw new Error("Missing native endpoints");
    expect(medusa.pathname).not.toBe(payload.pathname);
    expect(medusa.pathname).not.toBe("/provisioning");
    expect(payload.pathname).not.toBe("/provisioning");
    expect(medusa.username).toBe(payload.username);
    expect(medusa.username).toMatch(/^fx_measure_native_[a-f0-9]{32}$/);
    expect(medusa.password).toBe(payload.password);
    expect(medusa.password).not.toBe("fixture-secret");
    expect(medusa.password).not.toBe("override_secret");
    expect(native.constructions).toEqual([{ connectionString: provisioningUrl, max: 1 }]);
    for (const url of [medusa, payload]) {
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.port).toBe("5432");
      expect(url.searchParams.get("sslmode")).toBe("disable");
      for (const key of ["options", "application_name", "user", "password"]) expect(url.searchParams.has(key)).toBe(false);
    }
    const role = commands().find(sql => sql.startsWith("create role"));
    expect(role).toContain("nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls");
    const created = commands().filter(sql => sql.startsWith("create database"));
    expect(created.map(createdName)).toEqual([medusa.pathname.slice(1), payload.pathname.slice(1)]);
    expect(created.every(sql => sql.includes(`owner "${medusa.username}" template template0`))).toBe(true);
    const disposalStart = native.events.length;
    const first = fixture.close();
    expect(fixture.close()).toBe(first);
    await first;
    await fixture.close();
    expect(native.events.slice(disposalStart)).toEqual([
      "business dispose", `drop database if exists "${payload.pathname.slice(1)}"`,
      `drop database if exists "${medusa.pathname.slice(1)}"`, `drop role if exists "${medusa.username}"`, "pool end",
    ]);
    expect(native.dispose).toHaveBeenCalledTimes(1);
    expect(native.end).toHaveBeenCalledTimes(1);
  });

  it("retains the original setup cause and every cleanup cause while draining all owned resources", async () => {
    const original = new Error("native preparation refusal");
    const databaseCleanup = new Error("owned database cleanup refusal");
    const poolCleanup = new Error("provisioning pool closure refusal");
    native.prepare.mockRejectedValueOnce(original);
    native.query.mockImplementation(async sql => {
      native.events.push(sql);
      if (sql.startsWith("drop database") && sql.includes("fx_measure_payload_")) throw databaseCleanup;
    });
    native.end.mockRejectedValueOnce(poolCleanup);
    const failure: unknown = await acquireNativeBusinessResource().catch(cause => cause);
    if (!(failure instanceof AggregateError)) throw new Error("Expected retained native acquisition and cleanup failure");
    expect(failure.message).toBe("Native comparison acquisition and cleanup failed");
    expect(failure.errors).toHaveLength(3);
    expect(failure.errors[0]).toBe(original);
    expect(failure.errors[1]).toBe(databaseCleanup);
    expect(failure.errors[2]).toBe(poolCleanup);
    expect(commands().filter(sql => sql.startsWith("drop database"))).toHaveLength(2);
    expect(commands().filter(sql => sql.startsWith("drop role"))).toHaveLength(1);
    expect(native.end).toHaveBeenCalledTimes(1);
    expect(native.dispose).not.toHaveBeenCalled();
  });

  it("retains disposal failures, attempts remaining cleanup, and replays the same failed close", async () => {
    const fixture = await acquireNativeBusinessResource();
    const businessFailure = new Error("native disposal refusal");
    const databaseFailure = new Error("owned database retirement refusal");
    native.dispose.mockRejectedValueOnce(businessFailure);
    native.query.mockImplementation(async sql => {
      native.events.push(sql);
      if (sql.startsWith("drop database") && sql.includes("fx_measure_payload_")) throw databaseFailure;
    });
    const closing = fixture.close();
    const failure: unknown = await closing.catch(cause => cause);
    if (!(failure instanceof AggregateError)) throw new Error("Expected retained native disposal failure");
    expect(failure.errors).toHaveLength(2);
    expect(failure.errors[0]).toBe(businessFailure);
    expect(failure.errors[1]).toBe(databaseFailure);
    expect(fixture.close()).toBe(closing);
    await expect(fixture.close()).rejects.toBe(failure);
    expect(native.dispose).toHaveBeenCalledTimes(1);
    expect(commands().filter(sql => sql.startsWith("drop database"))).toHaveLength(2);
    expect(commands().filter(sql => sql.startsWith("drop role"))).toHaveLength(1);
    expect(native.end).toHaveBeenCalledTimes(1);
  });

  it("cleans attempted generated resources after an uncertain second database acquisition", async () => {
    const original = new Error("transport interrupted during CREATE DATABASE");
    native.query.mockImplementation(async sql => {
      native.events.push(sql);
      if (sql.startsWith("create database") && sql.includes("fx_measure_payload_")) throw original;
    });
    await expect(acquireNativeBusinessResource()).rejects.toBe(original);
    const created = commands().filter(sql => sql.startsWith("create database")).map(createdName);
    expect(created).toHaveLength(2);
    expect(commands().filter(sql => sql.startsWith("drop database")))
      .toEqual(created.toReversed().map(name => `drop database if exists "${name}"`));
    expect(commands().filter(sql => sql.startsWith("drop role"))).toHaveLength(1);
    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.end).toHaveBeenCalledTimes(1);
  });

  it("never drops a collided foreign role after a duplicate-name refusal", async () => {
    const collision = Object.assign(new Error("existing role"), { code: "42710" });
    native.query.mockRejectedValueOnce(collision);
    await expect(acquireNativeBusinessResource()).rejects.toBe(collision);
    expect(commands()).toHaveLength(1);
    expect(commands()[0]).toMatch(/^create role /);
    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.end).toHaveBeenCalledTimes(1);
  });

  it.each(["medusa", "payload"])("never drops a collided foreign %s database", async collided => {
    const collision = Object.assign(new Error("existing database"), { code: "42P04" });
    native.query.mockImplementation(async sql => {
      native.events.push(sql);
      if (sql.startsWith("create database") && sql.includes(`fx_measure_${collided}_`)) throw collision;
    });
    await expect(acquireNativeBusinessResource()).rejects.toBe(collision);
    const created = commands().filter(sql => sql.startsWith("create database")).map(createdName);
    const foreign = created.find(name => name.startsWith(`fx_measure_${collided}_`));
    if (foreign === undefined) throw new Error("Missing collided database witness");
    expect(commands()).not.toContain(`drop database if exists "${foreign}"`);
    const owned = created.filter(name => name !== foreign);
    expect(commands().filter(sql => sql.startsWith("drop database")))
      .toEqual(owned.toReversed().map(name => `drop database if exists "${name}"`));
    expect(commands().filter(sql => sql.startsWith("drop role"))).toHaveLength(1);
    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.end).toHaveBeenCalledTimes(1);
  });
});
