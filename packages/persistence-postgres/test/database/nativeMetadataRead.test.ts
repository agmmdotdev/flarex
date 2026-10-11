import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { bigint, customType, integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "effect";
import { Client } from "pg";
import { expect, it, vi } from "vitest";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { bytea } from "../../src/database/schema/primitives";
import { flarexSchema } from "../../src/database/schema";
import { defineNativeMetadataRead, makePhysicalSessionAccess } from "../../src/database/physicalSession/drizzle";
import { runDrizzleStatementEffect } from "../../src/database/drizzleStatementEffect";
import { observeDrizzleQuery } from "../../src/database/drizzleQueryObservation";
import { postgresUrl } from "../support/postgresHelpers";

const parent = pgTable("native_read_parent", {
  id: integer().primaryKey(), counter: bigint({ mode: "bigint" }).notNull(), updatedAt: timestamp({ withTimezone: true }).notNull(),
});
const child = pgTable("native_read_child", { id: integer().primaryKey(), payload: bytea().notNull() });
const selection = { parent: { id: parent.id, counter: parent.counter,
  updatedAt: sql`greatest(${parent.updatedAt}, ${parent.updatedAt})`.mapWith(parent.updatedAt) }, child: { id: child.id, payload: child.payload } };
const access = makePhysicalSessionAccess(flarexSchema);
function nativeRead(db: FlarexMetadataDatabase, id: number, limit: number) {
  return db.select(selection).from(parent).leftJoin(child, eq(child.id, parent.id))
    .where(eq(parent.id, id)).limit(limit).for("key share", { of: parent });
}

it("compiles once across fresh checkouts while executing lazily with fresh bindings and native row mapping", async () => {
  let compilations = 0;
  const read = defineNativeMetadataRead(db => {
    compilations++;
    return db.select(selection).from(parent).leftJoin(child, eq(child.id, parent.id))
      .where(eq(parent.id, sql.placeholder("id"))).limit(sql.placeholder("limit")).for("key share", { of: parent });
  });
  const firstClient = new Client();
  const secondClient = new Client();
  const firstTransport = vi.fn(async () => ({ command: "SELECT", rowCount: 1, oid: 0, fields: [],
    rows: [[1, "9007199254740993", "2026-10-10 10:11:12+00", null, null]] }));
  const secondTransport = vi.fn(async () => ({ command: "SELECT", rowCount: 1, oid: 0, fields: [],
    rows: [[2, "9007199254740995", "2026-10-10 12:13:14+00", 2, new Uint8Array([7, 8])]] }));
  Object.assign(firstClient, { query: firstTransport });
  Object.assign(secondClient, { query: secondTransport });
  const first = access(firstClient).transaction;
  const second = access(secondClient).transaction;
  const firstStatement = read(first, { id: 1, limit: 1 });
  const secondStatement = read(second, { id: 2, limit: 2 });
  const firstEffect = runDrizzleStatementEffect(firstStatement, cause => cause);
  expect(compilations).toBe(0);
  expect(firstTransport).not.toHaveBeenCalled();
  expect(secondTransport).not.toHaveBeenCalled();
  expect(firstStatement.toSQL()).toEqual(nativeRead(first, 1, 1).toSQL());
  expect(secondStatement.toSQL()).toEqual(nativeRead(second, 2, 2).toSQL());
  const observer = vi.fn();
  observeDrizzleQuery("native-read", secondStatement, observer);
  expect(observer).toHaveBeenCalledWith(expect.objectContaining({ params: [2, 2] }));
  expect(firstTransport).not.toHaveBeenCalled();
  const firstRows = await Effect.runPromise(firstEffect);
  const secondRows = await secondStatement;
  expect(firstRows).toEqual([{ parent: { id: 1, counter: 9007199254740993n, updatedAt: new Date("2026-10-10T10:11:12Z") }, child: null }]);
  expect(secondRows).toEqual([{ parent: { id: 2, counter: 9007199254740995n, updatedAt: new Date("2026-10-10T12:13:14Z") },
    child: { id: 2, payload: new Uint8Array([7, 8]) } }]);
  expect(firstTransport).toHaveBeenCalledWith(expect.objectContaining({ name: undefined, rowMode: "array" }), [1, 1]);
  expect(secondTransport).toHaveBeenCalledWith(expect.objectContaining({ name: undefined, rowMode: "array" }), [2, 2]);
  const repeatedRows = await read(first, { id: 3, limit: 3 });
  expect(firstTransport).toHaveBeenCalledTimes(2);
  expect(firstTransport).toHaveBeenLastCalledWith(expect.objectContaining({ name: undefined }), [3, 3]);
  expect(repeatedRows).not.toBe(firstRows);
  expect(compilations).toBe(1);
});

it("preserves native placeholder encoder order and original query failure identity", async () => {
  const calls: unknown[] = [];
  const encoderFailure = new Error("first codec");
  const encodedText = customType<{ data: string; driverData: string }>({
    dataType: () => "text", toDriver(value) { calls.push(value); if (value === "fail") throw encoderFailure; return value.toUpperCase(); },
  });
  const encoded = pgTable("encoded_read", { first: encodedText(), second: encodedText() });
  const read = defineNativeMetadataRead(db => db.select().from(encoded).where(sql`${encoded.first} = ${sql.param(sql.placeholder("first"), encoded.first)}
    and ${encoded.second} = ${sql.param(sql.placeholder("second"), encoded.second)}`));
  const client = new Client();
  const transportFailure = new Error("transport");
  const transport = vi.fn(async () => { throw transportFailure; });
  Object.assign(client, { query: transport });
  const db = access(client).database;
  expect(() => read(db, { first: "fail", second: "later" }).toSQL()).toThrow(encoderFailure);
  expect(calls).toEqual(["fail"]);
  calls.length = 0;
  await expect(read(db, { first: "fail", second: "later" })).rejects.toBe(encoderFailure);
  expect(calls).toEqual(["fail"]);
  expect(transport).not.toHaveBeenCalled();
  calls.length = 0;
  await expect(read(db, { first: "first", second: "second" })).rejects.toMatchObject({ cause: transportFailure, params: ["FIRST", "SECOND"] });
  expect(calls).toEqual(["first", "second"]);
  await expect(read(db, { first: "first" })).rejects.toThrow('No value for placeholder "second"');
  expect(transport).toHaveBeenCalledTimes(1);
});

async function proveNativeDriver(db: FlarexMetadataDatabase) {
  // Temporary driver-local DDL creates isolated fixtures, never authority state.
  await db.execute(sql`create temporary table native_read_parent (id integer primary key, counter bigint not null, "updatedAt" timestamptz not null)`);
  await db.execute(sql`create temporary table native_read_child (id integer primary key, payload bytea not null)`);
  const date = new Date("2026-10-10T10:11:12Z");
  await db.insert(parent).values([{ id: 1, counter: 9007199254740993n, updatedAt: date }, { id: 2, counter: 9007199254740995n, updatedAt: date }]);
  await db.insert(child).values({ id: 2, payload: new Uint8Array([7, 8]) });
  const read = defineNativeMetadataRead(database => database.select(selection).from(parent).leftJoin(child, eq(child.id, parent.id))
    .where(sql`${parent.id} = any(${sql.placeholder("ids")}::integer[])`).orderBy(parent.id));
  const many = await read(db, { ids: [1, 2] });
  const native = await db.select(selection).from(parent).leftJoin(child, eq(child.id, parent.id)).orderBy(parent.id);
  expect(many).toEqual(native);
  expect(many[0]?.child).toBeNull();
  expect(many[1]?.parent.counter).toBe(9007199254740995n);
  expect(many[1]?.parent.updatedAt).toEqual(date);
  expect(many[1]?.child?.payload).toEqual(native[1]?.child?.payload);
  expect(await read(db, { ids: [] })).toEqual([]);
  expect(await read(db, { ids: [2] })).toEqual([native[1]]);
  await db.update(parent).set({ counter: 9007199254740997n }).where(eq(parent.id, 2));
  expect((await read(db, { ids: [2] }))[0]?.parent.counter).toBe(9007199254740997n);
  const rawRead = defineNativeMetadataRead(database => database.execute(sql`
    select id, counter::text as "counterText", "updatedAt"::text as "timestampText" from native_read_parent
    where id = any(${sql.placeholder("ids")}::integer[]) order by id limit ${sql.placeholder("limit")}
  `), "raw");
  const nativeRaw = db.execute(sql`
    select id, counter::text as "counterText", "updatedAt"::text as "timestampText" from native_read_parent
    where id = any(${sql.param([1, 2])}::integer[]) order by id limit ${2}
  `);
  expect(rawRead(db, { ids: [1, 2], limit: 2 }).getQuery()).toMatchObject({
    sql: nativeRaw.getQuery().sql, params: nativeRaw.getQuery().params,
  });
  // Raw transport retains each driver's original result envelope and native
  // field parsing; no selected-field mapper or driver-independent rows wrapper.
  expectNativeRawEnvelope(await rawRead(db, { ids: [1, 2], limit: 2 }), await nativeRaw);
  expectNativeRawEnvelope(await rawRead(db, { ids: [], limit: 1 }), await db.execute(sql`
    select id, counter::text as "counterText", "updatedAt"::text as "timestampText" from native_read_parent
    where id = any(${sql.param([])}::integer[]) order by id limit ${1}
  `));
}

function expectNativeRawEnvelope(actual: unknown, native: unknown) {
  if (typeof actual !== "object" || actual === null || typeof native !== "object" || native === null)
    throw new Error("Native raw driver result must be an object");
  expect(Object.getPrototypeOf(actual)).toBe(Object.getPrototypeOf(native));
  expect(Reflect.ownKeys(actual)).toEqual(Reflect.ownKeys(native));
  // NodePgPreparedQuery constructs a new getTypeParser closure for each query.
  // pg.Result retains it in private _types/_parsers caches, so independent
  // native results cannot be deeply compared by those callback identities.
  for (const field of ["command", "rowCount", "oid", "rows", "fields", "rowAsArray"])
    expect(Reflect.get(actual, field)).toEqual(Reflect.get(native, field));
}

it("compiles native raw SQL once without transport and binds its original envelope lazily", async () => {
  let compilations = 0;
  const read = defineNativeMetadataRead(db => {
    compilations++;
    return db.execute(sql`select ${sql.placeholder("value")}::text as "value"`);
  }, "raw");
  const client = new Client();
  const result = { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ value: "fresh" }] };
  const transport = vi.fn(async (_query: unknown, _params: unknown) => result);
  Object.assign(client, { query: transport });
  const db = access(client).database;
  const first = read(db, { value: "first" });
  expect(compilations).toBe(1);
  expect(transport).not.toHaveBeenCalled();
  expect(first.getQuery()).toMatchObject({ sql: db.execute(sql`select ${"first"}::text as "value"`).getQuery().sql, params: ["first"] });
  expect(compilations).toBe(1);
  expect(transport).not.toHaveBeenCalled();
  expect(await first).toBe(result);
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ name: undefined }), ["first"]);
  expect(transport.mock.calls[0]?.[0]).not.toHaveProperty("rowMode");
  expect(read(access(new Client()).database, { value: "second" }).getQuery()).toMatchObject({
    sql: first.getQuery().sql, params: ["second"],
  });
  expect(compilations).toBe(1);
});

it("preserves synchronous actual raw-session preparation defects", () => {
  const read = defineNativeMetadataRead(db => db.execute(sql`select ${sql.placeholder("value")}::text`), "raw");
  const db = access(new Client()).database;
  const defect = new Error("native raw preparation defect");
  vi.spyOn(db._.session, "prepareQuery").mockImplementation(() => { throw defect; });
  expect(() => read(db, { value: "fresh" })).toThrow(defect);
});

it("preserves native codecs and nullable joins through PGlite session preparation", async () => {
  const client = new PGlite();
  try { await proveNativeDriver(drizzle(client, { schema: flarexSchema })); }
  finally { await client.close(); }
});

it.skipIf(postgresUrl === null)("preserves native codecs and nullable joins through ordinary PostgreSQL session preparation", async () => {
  const client = new Client({ connectionString: postgresUrl ?? undefined });
  try { await client.connect(); await proveNativeDriver(access(client).database); }
  finally { await client.end(); }
});
