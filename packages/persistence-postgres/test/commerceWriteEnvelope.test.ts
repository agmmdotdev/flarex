import { defaultCommerceResources } from "../src/commerceTransaction/resources";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Result } from "effect";
import { commerceWriteEnvelope, decodeCommerceWriteEnvelope, makeCommerceWriteEnvelopePolicy } from "../src/commerceTransaction/writeEnvelope";
import { commerceLimits } from "../src/commerceTransaction/model";

// One small SQL fixture per driver. This tests the actual transport envelope;
// host admission, publication and rollback remain in Product conformance.
const native = process.env.FLAREX_TEST_DRIVER === "postgres";
const namespace = "fx_write_test_" + randomUUID().replaceAll("-", "");
const target = sql`${sql.identifier(namespace)}.rows`;
const dialect = new PgDialect();
let execute: (query: SQL) => Promise<readonly unknown[]>;
let close: () => Promise<void>;
beforeAll(async () => {
  if (native) {
    if (!process.env.FLAREX_POSTGRES_DATABASE_URL) throw new Error("Missing native PostgreSQL URL");
    const client = new Client({ connectionString: process.env.FLAREX_POSTGRES_DATABASE_URL });
    await client.connect();
    execute = async query => { const compiled = dialect.sqlToQuery(query); return (await client.query(compiled.sql, compiled.params)).rows; };
    close = () => client.end();
  } else {
    const client = await PGlite.create();
    execute = async query => { const compiled = dialect.sqlToQuery(query); return (await client.query(compiled.sql, compiled.params)).rows; };
    close = () => client.close();
  }
  await execute(sql`create schema ${sql.identifier(namespace)}`);
  await execute(sql`create table ${target} (scope text not null, id text not null, value text not null default 'default',
    amount numeric not null default 0, stamp timestamptz not null default current_timestamp, primary key(scope, id))`);
});
afterAll(async () => { try { await execute(sql`drop schema ${sql.identifier(namespace)} cascade`); } finally { await close(); } });
beforeEach(async () => {
  await execute(sql`truncate ${target}`);
  await execute(sql`alter table ${target} alter column value set default 'default'`);
});
const json = (alias: SQL, textNumeric: boolean) => sql`jsonb_build_object('id', ${alias}.id, 'value', ${alias}.value,
  'amount', ${textNumeric ? sql`${alias}.amount::text` : sql`${alias}.amount`}, 'stamp', ${alias}.stamp)`;
const envelope = async (mutation: SQL, ids: readonly string[], remainingBytes: number = commerceLimits.commandBytes, compose = commerceWriteEnvelope) => {
  const rows = await execute(compose({ mutation,
    retainedCatalog: sql`select ${json(sql`old`, false)} as payload from ${target} as old where scope = 'a' and id not in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
    writtenCatalogPayload: json(sql`changed`, false), writtenTransportPayload: json(sql`changed`, true), remainingBytes,
  }));
  expect(rows).toHaveLength(1);
  return rows[0];
};
describe("bounded commerce SQL write envelope", () => {
  it("keeps the expanded catalog scoped and transports only the bounded batch", async () => {
    const resources = { ...defaultCommerceResources, catalogRows: 2048, queryRows: 2048 };
    const policy = makeCommerceWriteEnvelopePolicy(resources);
    await execute(sql`insert into ${target}(scope,id) select 'b',i::text from generate_series(1,3000) i`);
    await execute(sql`insert into ${target}(scope,id) select 'a',i::text from generate_series(1,1000) i`);
    const raw = await envelope(sql`insert into ${target}(scope,id) values ('a','new') returning id,value,amount,stamp`, ["new"], resources.commandBytes, policy.commerceWriteEnvelope);
    const result = Result.getOrThrow(policy.decodeCommerceWriteEnvelope(raw, resources.commandBytes));
    expect(result.total).toBe(1001);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "new" });
    expect(decodeCommerceWriteEnvelope(raw, resources.commandBytes)).toMatchObject({ _tag: "Failure" });
  });

  it("uses RETURNING postimages, preserves exact numerics, and counts only the selected scope", async () => {
    await execute(sql`insert into ${target}(scope,id,value) values ('a','retained','old'), ('b','other','other scope')`);
    const inserted = Result.getOrThrow(decodeCommerceWriteEnvelope(await envelope(
      sql`insert into ${target}(scope,id,amount) values ('a','changed',9007199254740993.01) returning id,value,amount,stamp`, ["changed"],
    ), commerceLimits.commandBytes));
    expect(inserted.total).toBe(2);
    expect(inserted.rows).toMatchObject([{ id: "changed", value: "default", amount: "9007199254740993.01", stamp: expect.any(String) }]);
    const updated = Result.getOrThrow(decodeCommerceWriteEnvelope(await envelope(
      sql`update ${target} set value='new postimage' where scope='a' and id='changed' returning id,value,amount,stamp`, ["changed"],
    ), commerceLimits.commandBytes));
    expect(updated.total).toBe(2);
    expect(updated.rows).toMatchObject([{ id: "changed", value: "new postimage", amount: "9007199254740993.01" }]);
    expect(updated.bytes).toBeGreaterThan(inserted.bytes);
  });
  it.each(["default", "numeric"])("gates oversized %s expansion before driver transport and rolls it back", async kind => {
    if (kind === "default") await execute(sql`alter table ${target} alter column value set default repeat('x',70000)`);
    await execute(sql`begin`);
    try {
      const raw = await envelope(kind === "default"
        ? sql`insert into ${target}(scope,id) values ('a','large') returning id,value,amount,stamp`
        : sql`insert into ${target}(scope,id,amount) values ('a','large','1e100000'::numeric) returning id,value,amount,stamp`, ["large"]);
      expect(raw).toMatchObject({ total: 1, maximum: commerceLimits.rowBytes + 1, rows: null });
      expect(JSON.stringify(raw).length).toBeLessThan(256);
      expect(decodeCommerceWriteEnvelope(raw, commerceLimits.commandBytes)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    } finally { await execute(sql`rollback`); }
    expect(await execute(sql`select count(*)::integer as total from ${target}`)).toEqual([{ total: 0 }]);
  });
  it("counts retained rows when a small write exceeds the catalog row ceiling", async () => {
    await execute(sql`insert into ${target}(scope,id) select 'a',i::text from generate_series(1,256) i`);
    const raw = await envelope(sql`insert into ${target}(scope,id) values ('a','overflow') returning id,value,amount,stamp`, ["overflow"]);
    expect(raw).toMatchObject({ total: 257, rows: null });
    expect(decodeCommerceWriteEnvelope(raw, commerceLimits.commandBytes)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });
  it("gates aggregate bytes across individually valid rows and uses each group's remaining budget", async () => {
    await execute(sql`insert into ${target}(scope,id,value) select 'a',i::text,repeat('x',63000) from generate_series(1,16) i`);
    const raw = await envelope(sql`insert into ${target}(scope,id,value) values ('a','overflow',repeat('x',63000)) returning id,value,amount,stamp`, ["overflow"]);
    expect(raw).toMatchObject({ total: 17, bytes: commerceLimits.commandBytes + 1, rows: null });
    expect(decodeCommerceWriteEnvelope(raw, commerceLimits.commandBytes)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    await execute(sql`truncate ${target}`);
    const first = await envelope(sql`insert into ${target}(scope,id,value) values ('a','first',repeat('x',500)) returning id,value,amount,stamp`, ["first"]);
    expect(Result.isSuccess(decodeCommerceWriteEnvelope(first, commerceLimits.commandBytes))).toBe(true);
    const next = await envelope(sql`insert into ${target}(scope,id,value) values ('a','next',repeat('x',500)) returning id,value,amount,stamp`, ["next"], 700);
    expect(next).toMatchObject({ total: 2, rows: null });
    expect(decodeCommerceWriteEnvelope(next, 700)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });
  it.runIf(native)("retains native row locks and rolls back a timed-out modifying CTE", async () => {
    const blocker = new Client({ connectionString: process.env.FLAREX_POSTGRES_DATABASE_URL });
    await blocker.connect();
    await execute(sql`insert into ${target}(scope,id,value) values ('a','locked','before')`);
    try {
      await blocker.query("begin");
      const lock = dialect.sqlToQuery(sql`select * from ${target} where scope='a' and id='locked' for update`);
      await blocker.query(lock.sql, lock.params);
      await execute(sql`begin`);
      try {
        await execute(sql`set local lock_timeout = '50ms'`);
        await expect(envelope(sql`update ${target} set value='after' where scope='a' and id='locked' returning id,value,amount,stamp`, ["locked"]))
          .rejects.toMatchObject({ code: "55P03" });
      } finally { await execute(sql`rollback`); }
    } finally { await blocker.query("rollback"); await blocker.end(); }
    expect(await execute(sql`select value from ${target} where id='locked'`)).toEqual([{ value: "before" }]);
  });
});
