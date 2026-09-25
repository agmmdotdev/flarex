import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Deferred, Effect, Result } from "effect";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { sumLogicalRows } from "../../persistence-postgres/src/logicalDocuments/aggregate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { currencyCommands } from "../src/currency-service";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid query driver");
const cleanup: Array<() => Promise<void>> = [];
const page = defineCommerceCommand("queryContractPage", "read", (ctx, input) => ctx.store.findPage(ctx.manager, input));
const complete = defineCommerceCommand("queryContractComplete", "read", (ctx, input) => ctx.store.find(ctx.manager, input));
const aggregate = defineCommerceCommand("queryContractAggregate", "read", (ctx, input) => ctx.store.aggregate(ctx.manager, input));
const seed = defineCommerceCommand("queryContractSeed", "write", (ctx, input) => ctx.store.write(ctx.manager, "insert", input));
const window = { fields: ["code"], order: { column: "code", direction: "asc" } };

describe("logical page and complete aggregate contracts", () => {
  let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  let host: Effect.Success<ReturnType<typeof makeCommerceHost>>;
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
    host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput,
      commands: [page, complete, aggregate, seed, ...Object.values(currencyCommands)] }));
    cleanup.push(() => Effect.runPromise(host.close));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("serves a small native Currency page independently of full-catalog cardinality", async () => {
    const first = fixture.initialization.rows[0];
    if (first === undefined) throw new Error("Missing Currency fixture");
    await Effect.runPromise(host.run(host.newRequestKey(), seed,
      Array.from({ length: 5 }, (_, index) => ({ ...first, code: `zz${index}` }))));
    expect(await Effect.runPromise(host.read(page, { ...window, take: 128 })))
      .toMatchObject({ rows: expect.any(Array), hasMore: false });
    const full = await Effect.runPromise(host.read(page, { ...window, take: 128 }));
    if (!isJsonObject(full) || !Array.isArray(full.rows)) throw new Error("Missing page rows");
    expect(full.rows).toHaveLength(128);
    await Effect.runPromise(host.run(host.newRequestKey(), seed, [{ ...first, code: "zz5" }]));
    const statements: string[] = [];
    fixture.observeSql?.(sql => { statements.push(sql); });
    try {
      expect(await Effect.runPromise(host.read(page, { ...window, take: 2 })))
        .toEqual({ rows: fixture.initialization.rows.slice(0, 2).map(row => ({ code: row.code })), hasMore: true });
    } finally { fixture.observeSql?.(undefined); }
    if (fixture.observeSql !== undefined) {
      const indexScans = statements.filter(sql => /from "?fx_app_index_entry_current"?/i.test(sql));
      expect(indexScans).toHaveLength(1);
      expect(indexScans[0]).toMatch(/limit/i);
    }
    const native = await Effect.runPromise(host.read(currencyCommands.list,
      { filters: {}, config: { select: ["code"], take: 2, order: { code: "ASC" } } }));
    expect(native).toEqual(fixture.initialization.rows.slice(0, 2).map(row => ({ code: row.code })));
    await expect(Effect.runPromise(host.read(complete, { ...window, take: 2 })))
      .rejects.toMatchObject({ reason: "limitExceeded" });
    await expect(Effect.runPromise(host.read(page, { ...window, take: 128 })))
      .rejects.toMatchObject({ reason: "limitExceeded" });
    await expect(Effect.runPromise(host.read(page, { ...window, order: { column: "name", direction: "asc" }, take: 2 })))
      .rejects.toMatchObject({ reason: "invalidInput" });
  }, 120_000);

  it("counts and sums an explicit complete selection, including pending writes and deletes", async () => {
    const predicate = { kind: "in", column: "code", values: ["usd", "eur"] };
    const pending = defineCommerceCommand("queryContractPending", "write", ctx => Effect.gen(function* () {
      yield* ctx.store.write(ctx.manager, "update", [{ code: "usd", rounding: 0.1, raw_rounding: { value: "0.1", precision: 20 } }, { code: "eur", rounding: 0.2, raw_rounding: { value: "0.2", precision: 20 } }]);
      const before = yield* ctx.store.aggregate(ctx.manager, { predicate, sum: "rounding" });
      yield* ctx.store.delete(ctx.manager, [{ code: "eur" }]);
      const after = yield* ctx.store.aggregate(ctx.manager, { predicate, sum: "rounding" });
      const pendingPage = yield* ctx.store.findPage(ctx.manager, { ...window, take: 1,
        predicate: { kind: "in", column: "code", values: ["eur"] } });
      return { before, after, pendingPage };
    }));
    const writer = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands: [pending] }));
    try {
      expect(await Effect.runPromise(writer.run(writer.newRequestKey(), pending, null)))
        .toEqual({ before: { count: 2, sum: "3e-1" }, after: { count: 1, sum: "1e-1" },
          pendingPage: { rows: [], hasMore: false } });
    } finally { await Effect.runPromise(writer.close); }
    expect(await Effect.runPromise(host.read(aggregate, { predicate, sum: "rounding" })))
      .toEqual({ count: 1, sum: "1e-1" });
    await expect(Effect.runPromise(host.read(aggregate, { predicate: { kind: "and", children: [] }, sum: "rounding" })))
      .rejects.toMatchObject({ reason: "invalidInput" });
    await expect(Effect.runPromise(host.read(aggregate, { predicate, sum: "name" })))
      .rejects.toMatchObject({ reason: "invalidInput" });
  }, 120_000);

  it("preserves exact decimal and SQL null semantics without floating-point addition", () => {
    const sum = (values: readonly (string | number | null)[]) => Result.getOrThrow(
      sumLogicalRows(values.map(value => ({ value })), "value", (reason, cause) => new Error(reason, { cause })));
    expect(sum([0.1, 0.2])).toBe("3e-1");
    expect(sum(["12e2", "-1.2e3", "0.001"])).toBe("1e-3");
    expect(sum([null, null])).toBeNull();
    expect(sum([])).toBeNull();
    expect(sum([0, null])).toBe("0");
  });

  it.skipIf(driver !== "postgres")("rejects a concurrent insertion before a pending-only page frontier", async () => {
    const first = fixture.initialization.rows[0];
    if (first === undefined) throw new Error("Missing Currency fixture");
    const entered = await Effect.runPromise(Deferred.make<void>());
    const released = await Effect.runPromise(Deferred.make<void>());
    const pending = defineCommerceCommand("queryPagePhantom", "write", ctx => Effect.gen(function* () {
      yield* ctx.store.write(ctx.manager, "insert", [{ ...first, code: "001" }]);
      const result = yield* ctx.store.findPage(ctx.manager, { ...window, take: 1 });
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(released);
      return result;
    }));
    const writer = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands: [pending] }));
    const execution = Effect.runPromise(Effect.result(writer.run(writer.newRequestKey(), pending, null)));
    try {
      try {
        await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeout(10_000)));
        await Effect.runPromise(host.run(host.newRequestKey(), seed, [{ ...first, code: "000" }]));
      } finally { await Effect.runPromise(Deferred.succeed(released, undefined)); }
      expect(await execution).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      expect(await Effect.runPromise(host.read(page, { ...window, take: 2 })))
        .toMatchObject({ rows: [{ code: "000" }, { code: first.code }], hasMore: true });
    } finally {
      await Effect.runPromise(Deferred.succeed(released, undefined));
      await execution;
      await Effect.runPromise(writer.close);
    }
  }, 60_000);
});
