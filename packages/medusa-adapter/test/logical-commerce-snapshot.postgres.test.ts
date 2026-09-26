import { Deferred, Effect, Fiber } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineCommerceCommand, makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { Json, JsonObject } from "flarex-protocol/json";
import { currencyAnnouncementWrite, currencyCommands } from "../src/currency-service";

describe.skipIf(postgresUrl === null)("logical commerce snapshots and publication", () => {
  const cleanup: Array<() => Promise<void>> = [];
  let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  let template: JsonObject;
  let baselineName: string;
  let executions = 0;
  const insert = defineCommerceCommand("snapshotLogicalInsert", "write", Effect.fn(function* (ctx, id) {
    if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
    executions++;
    return [yield* ctx.nested(currencyAnnouncementWrite, { ...template, code: id, name: `Snapshot ${id}` })];
  }));
  const participant = defineAtomicCommerceParticipant("snapshotCurrency");
  const atomic = defineAtomicCommerceCommand("snapshotLogicalAtomicInsert", (ctx, id) => ctx.call(participant, insert, id));
  const readCommand = (between: Effect.Effect<void>) => defineCommerceCommand("snapshotLogicalRead", "read", Effect.fn(function* (ctx, id) {
    if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
    const options = (code: string) => ({ filters: { code }, config: { select: ["code", "name"] } });
    const first = yield* ctx.nested(currencyCommands.list, options("baseline"));
    yield* between;
    const second = yield* ctx.nested(currencyCommands.list, options(id));
    return { first, second };
  }));
  const local = (commands: Parameters<typeof makeCommerceHost>[0]["commands"]) =>
    Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands }));
  const writer = async (kind: "standalone" | "atomic") => {
    if (kind === "standalone") {
      const host = await local([insert, currencyAnnouncementWrite]);
      return { host, key: host.newRequestKey(), run: (key: string, id: string) => host.run(key, insert, id) };
    }
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, commands: [atomic],
      participants: [{ participant, logicalStorage: fixture.hostInput.logicalStorage,
        commands: [insert, currencyAnnouncementWrite] }] }));
    return { host, key: host.newRequestKey(), run: (key: string, id: string) => host.run(key, atomic, id) };
  };
  const assertReadPinsScopeClock = async () => {
    if (fixture.resource.kind !== "postgres") throw new Error("PostgreSQL connection required");
    const scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    const client = await fixture.resource.target.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '100ms'");
      await expect(client.query("select scope_uuid from fx_system_scope_clock where scope_uuid=$1 for update", [scope]))
        .rejects.toMatchObject({ code: "55P03" });
    } finally {
      await client.query("rollback");
      client.release();
    }
  };

  beforeAll(async () => {
    fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close));
    const first = fixture.initialization.rows[0];
    if (first === undefined) throw new Error("Missing Currency seed");
    const input: Record<string, Json> = { ...first };
    delete input.raw_rounding;
    template = input;
    baselineName = "Snapshot baseline";
    const host = await local([insert, currencyAnnouncementWrite]);
    try { await Effect.runPromise(host.run(host.newRequestKey(), insert, "baseline")); }
    finally { await Effect.runPromise(host.close); }
    const superuser = (await fixture.persistence.query<{ superuser: boolean }>(
      "select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser;
    expect(superuser).toBe(false);
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  for (const kind of ["standalone", "atomic"] as const) {
    it(`${kind} publishes while an earlier logical read retains its snapshot`, async () => {
      const entered = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      const read = readCommand(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))));
      const reader = await local([read, currencyCommands.list]);
      const write = await writer(kind);
      try {
        const id = `${kind}-logical-reader`;
        const before = await logicalCurrencyInventory(fixture);
        const count = executions;
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const reading = yield* reader.read(read, id).pipe(Effect.forkScoped);
          yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
          yield* Effect.promise(assertReadPinsScopeClock);
          const result = yield* write.run(write.key, id);
          expect(result).toEqual([expect.objectContaining({ code: id, name: `Snapshot ${id}` })]);
          expect(yield* Deferred.isDone(release)).toBe(false);
          expect(yield* write.run(write.key, id)).toEqual(result);
          yield* Deferred.succeed(release, undefined);
          expect(yield* Fiber.join(reading)).toEqual({ first: [{ code: "baseline", name: baselineName }], second: [] });
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("25 seconds"))));
        const after = await logicalCurrencyInventory(fixture);
        expect(executions).toBe(count + 1);
        expect(after.rowChanges.length - before.rowChanges.length).toBe(1);
        expect(after.commits.length - before.commits.length).toBe(1);
        expect(after.outcomes.length - before.outcomes.length).toBe(1);
        expect(after.wakes.length - before.wakes.length).toBe(1);
        expect(after.clocks[0]?.lastCommitSeq).toBe((before.clocks[0]?.lastCommitSeq ?? 0n) + 1n);
        const freshRead = readCommand(Effect.void);
        const fresh = await local([freshRead, currencyCommands.list]);
        try { expect(await Effect.runPromise(fresh.read(freshRead, id))).toEqual({
          first: [{ code: "baseline", name: baselineName }], second: [{ code: id, name: `Snapshot ${id}` }],
        }); } finally { await Effect.runPromise(fresh.close); }
        expect(await logicalCurrencyInventory(fixture)).toEqual(after);
        await expect(fixture.service.retrieveCurrency(id)).resolves.toMatchObject({ code: id, name: `Snapshot ${id}` });
        if (fixture.resource.kind === "postgres")
          expect(fixture.resource.target.pool.idleCount).toBe(fixture.resource.target.pool.totalCount);
      } finally {
        await Effect.runPromise(reader.close);
        await Effect.runPromise(write.host.close);
      }
    }, 90_000);
  }
});
