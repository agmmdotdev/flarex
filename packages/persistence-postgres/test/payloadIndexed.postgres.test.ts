import { Deferred, Effect, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { defineCmsCommand, makeCmsHost } from "../src/cmsTransaction/host";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { decodeIndexedDocument, makeIndexedPayloadFixture } from "./payloadIndexedFixture";
import { payloadIndexedScenario } from "./payloadIndexedScenario";
import { runEffect } from "./effectTestRuntime";

describe.skipIf(postgresUrl === null)("indexed Payload queries (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("executes native indexed operations with a selective ordinary-role query plan", () => withPersistence(persistence => runEffect(Effect.scoped(Effect.gen(function* () {
    const tested = yield* makeIndexedPayloadFixture(persistence, makePostgresRelationalSession(persistence));
    yield* Effect.promise(() => payloadIndexedScenario(tested));
    const role = yield* Effect.promise(() => persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user"));
    expect(role.rows[0]?.superuser).toBe(false);
    yield* tested.host.read(tested.runtime.commands.count, { collection: "items", where: { amount: { equals: 15 } } });
    const query = tested.plans.at(-1);
    if (query === undefined) throw new Error("Missing indexed SQL observation");
    yield* Effect.promise(async () => {
      await persistence.query("analyze fx_app_index_entry_current");
      await persistence.query("analyze fx_app_index_entry_rev");
      const explained = await persistence.query<{ "QUERY PLAN": string }>(`explain (analyze, buffers, costs off) ${query.sql}`, [...query.params]);
      const plan = explained.rows.map(row => row["QUERY PLAN"]).join("\n");
      expect(plan).toMatch(/Index (?:Only )?Scan.*on fx_app_index_entry_current/);
      expect(plan).toMatch(/Index Cond:.*scope_uuid.*index_definition_id.*encoded_key >=.*encoded_key </);
      expect(plan).not.toMatch(/Seq Scan on fx_app_index_entry_current/);
    });
  })))), 180_000);

  it.each(["phantom", "outside", "move", "range-before-scan", "scan-before-range"] as const)(
    "preserves observed membership across %s publication", mode => withPersistence(persistence => runEffect(Effect.scoped(Effect.gen(function* () {
      const tested = yield* makeIndexedPayloadFixture(persistence, makePostgresRelationalSession(persistence));
      const { host, runtime } = tested;
      const seeded = decodeIndexedDocument(yield* host.run(host.newRequestKey(), runtime.commands.create,
        { collection: "items", data: { title: "initial", category: "red", amount: 15 } }));
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let executions = 0;
      const range = { collection: "items", where: { category: { equals: "red" }, amount: { greater_than_equal: 10, less_than: 20 } } };
      const held = defineCmsCommand({ name: "heldRange", mode: "write", run: Effect.fn(function* (ctx) {
        executions++;
        if (mode === "scan-before-range") {
          expect((yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { where: {}, offset: 0, limit: 8 })).total).toBe(1);
        } else {
          const empty = mode === "phantom" ? { collection: "items", where: { amount: { greater_than_equal: 30, less_than: 40 } } } : range;
          expect(yield* ctx.nested(runtime.commands.count, empty)).toEqual({ totalDocs: mode === "phantom" ? 0 : 1 });
        }
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        if (mode === "range-before-scan") yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { where: {}, offset: 0, limit: 8 });
        const observed = mode === "phantom" ? { collection: "items", where: { amount: { greater_than_equal: 30, less_than: 40 } } } : range;
        expect(yield* ctx.nested(runtime.commands.count, observed)).toEqual({ totalDocs: mode === "phantom" ? 0 : 1 });
        return "held-result";
      }) });
      const pendingHost = yield* Effect.acquireRelease(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, held] }), value => value.close);
      const key = pendingHost.newRequestKey();
      yield* Effect.gen(function* () {
        const fiber = yield* pendingHost.run(key, held, null).pipe(Effect.result, Effect.forkScoped);
        yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
        if (mode === "move") {
          yield* host.run(host.newRequestKey(), runtime.commands.update, { collection: "items", id: seeded.id, data: { amount: 25 } });
        } else {
          yield* host.run(host.newRequestKey(), runtime.commands.create, { collection: "items", data: {
            title: "competing", category: "red", amount: mode === "outside" ? 25 : mode === "phantom" ? 35 : 12,
          } });
        }
        expect(yield* Deferred.isDone(release)).toBe(false);
        const afterOther = yield* Effect.promise(tested.inventory);
        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(fiber);
        if (mode === "outside") {
          expect(Result.getOrThrow(result)).toBe("held-result");
          const after = yield* Effect.promise(tested.inventory);
          expect(after.commits.length).toBe(afterOther.commits.length + 1);
          expect(yield* pendingHost.run(key, held, null)).toBe("held-result");
          expect(yield* Effect.promise(tested.inventory)).toEqual(after);
        } else {
          expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
          expect(yield* Effect.promise(tested.inventory)).toEqual(afterOther);
        }
        expect(executions).toBe(1);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(20_000));
    })))), 120_000,
  );

  it("isolates identical compound keys in two scopes", () => withPersistence(persistence => runEffect(Effect.scoped(Effect.gen(function* () {
    const first = yield* makeIndexedPayloadFixture(persistence, makePostgresRelationalSession(persistence));
    const second = yield* makeIndexedPayloadFixture(persistence, makePostgresRelationalSession(persistence));
    const query = { collection: "items", where: { category: { equals: "shared" }, amount: { greater_than_equal: 10, less_than_equal: 10 } } };
    for (const tested of [first, second]) yield* tested.host.run(tested.host.newRequestKey(), tested.runtime.commands.create,
      { collection: "items", data: { title: "same-title", category: "shared", amount: 10 } });
    expect(yield* first.host.read(first.runtime.commands.count, query)).toEqual({ totalDocs: 1 });
    expect(yield* second.host.read(second.runtime.commands.count, query)).toEqual({ totalDocs: 1 });
  })))), 120_000);
});
