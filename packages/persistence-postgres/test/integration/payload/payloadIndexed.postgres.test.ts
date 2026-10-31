import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { Deferred, Effect, Fiber, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { postgresUrl } from "../../support/postgresHelpers";
import { decodeIndexedDocument, indexedFields, makeIndexedPayloadFixture } from "./payloadIndexedFixture";
import { payloadIndexedScenario } from "./payloadIndexedScenario";
import { payloadIndexedVisibilityCases, payloadIndexedVisibilityScenario } from "./payloadIndexedVisibilityScenario";
import { runEffect } from "../../support/effectTestRuntime";

const fresh = { kind: "fresh", driver: "postgres" } as const;
const decodeFill = Schema.decodeUnknownEffect(Schema.Struct({ base: Schema.Int, count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 })) }));
describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("indexed Payload queries (ordinary PostgreSQL)", () => {
  it("executes native indexed operations with real five-table range and hydration plans", () => runEffect(Effect.scoped(Effect.gen(function* () {
    const tested = yield* makeIndexedPayloadFixture(fresh);
    yield* Effect.tryPromise({ try: () => payloadIndexedScenario(tested), catch: cause => cause });
    yield* Effect.tryPromise({ try: tested.reopen, catch: cause => cause });
    const from = tested.plans.length;
    yield* tested.host.read(inspectPayloadRuntimeForTest(tested.runtime).commands.count,
      { collection: "items", where: { amount: { equals: 15 } } });
    const queries = yield* Effect.tryPromise({ try: () => tested.applicationIndexQueries(from), catch: cause => cause });
    const query = queries.at(-1);
    if (query === undefined) throw new Error("Missing actual Core ordered-index SQL");
    const namespace = `"${tested.core.physical.namespace.replaceAll('"', '""')}"`;
    yield* Effect.tryPromise({ try: async () => {
      await tested.core.physical.query(`ANALYZE ${namespace}.indexes`);
      await tested.core.physical.query(`ANALYZE ${namespace}.documents`);
      const explained = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ "QUERY PLAN": Schema.String })))(
        await tested.core.physical.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${query.sql}`, query.params));
      const plan = explained.map(row => row["QUERY PLAN"]).join("\n");
      expect(plan).toMatch(/Index (?:Only )?Scan.*on indexes/);
      expect(plan).toMatch(/Index Cond:.*instance_name.*index_id.*key_prefix/);
      expect(plan).toMatch(/Index (?:Only )?Scan.*on documents/);
      expect(plan).not.toMatch(/Seq Scan on indexes/);
    }, catch: cause => cause });
  }))), 180_000);

  it.each(["phantom", "outside", "move", "range-before-scan", "scan-before-range"] as const)(
    "preserves observed membership across %s publication", mode => runEffect(Effect.scoped(Effect.gen(function* () {
      const tested = yield* makeIndexedPayloadFixture(fresh);
      const { host, runtime } = tested;
      const commands = inspectPayloadRuntimeForTest(runtime).commands;
      const seeded = decodeIndexedDocument(yield* host.run(host.newRequestKey(), commands.create,
        { collection: "items", data: { title: "initial", category: "red", amount: 15 } }));
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let executions = 0;
      const range = { collection: "items", where: { category: { equals: "red" }, amount: { greater_than_equal: 10, less_than: 20 } } };
      const held = defineCmsCommand({ name: "heldRange", mode: "write", run: Effect.fn(function* (ctx) {
        executions++;
        if (mode === "scan-before-range") expect((yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { where: {}, offset: 0, limit: 8 })).total).toBe(1);
        else {
          const empty = mode === "phantom" ? { collection: "items", where: { amount: { greater_than_equal: 30, less_than: 40 } } } : range;
          expect(yield* ctx.nested(commands.count, empty)).toEqual({ totalDocs: mode === "phantom" ? 0 : 1 });
        }
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        if (mode === "range-before-scan") yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { where: {}, offset: 0, limit: 8 });
        const observed = mode === "phantom" ? { collection: "items", where: { amount: { greater_than_equal: 30, less_than: 40 } } } : range;
        expect(yield* ctx.nested(commands.count, observed)).toEqual({ totalDocs: mode === "phantom" ? 0 : 1 });
        return "held-result";
      }) });
      const pendingHost = yield* Effect.acquireRelease(tested.openHost([held]), value => value.close);
      const key = pendingHost.newRequestKey();
      yield* Effect.gen(function* () {
        const fiber = yield* pendingHost.run(key, held, null).pipe(Effect.result, Effect.forkScoped);
        yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
        if (mode === "move") yield* host.run(host.newRequestKey(), commands.update, { collection: "items", id: seeded.id, data: { amount: 25 } });
        else yield* host.run(host.newRequestKey(), commands.create, { collection: "items", data: {
          title: "competing", category: "red", amount: mode === "outside" ? 25 : mode === "phantom" ? 35 : 12,
        } });
        expect(yield* Deferred.isDone(release)).toBe(false);
        const afterOther = yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause });
        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(fiber);
        if (mode === "outside") {
          expect(Result.getOrThrow(result)).toBe("held-result");
          const after = yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause });
          expect(after.outcomes.length).toBe(afterOther.outcomes.length + 1);
          expect(yield* pendingHost.run(key, held, null)).toBe("held-result");
          expect(yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause })).toEqual(after);
        } else {
          expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
          expect(yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause })).toEqual(afterOther);
        }
        expect(executions).toBe(1);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(20_000));
    }))), 120_000,
  );

  it("isolates identical compound keys in two owners of one physical target", () => runEffect(Effect.scoped(Effect.gen(function* () {
    const first = yield* makeIndexedPayloadFixture({ ...fresh, instanceName: "indexed-first" }, undefined,
      { scopeUuid: "45000000-0000-4000-8000-000000000051", epochUuid: "45000000-0000-4000-8000-000000000052" });
    const second = yield* makeIndexedPayloadFixture({ kind: "physical", physical: first.core.physical,
      installation: "fresh", instanceName: "indexed-second" }, undefined,
      { scopeUuid: "45000000-0000-4000-8000-000000000061", epochUuid: "45000000-0000-4000-8000-000000000062" });
    expect(second.core.physical).toBe(first.core.physical);
    const query = { collection: "items", where: { category: { equals: "shared" }, amount: { greater_than_equal: 10, less_than_equal: 10 } } };
    for (const tested of [first, second]) yield* tested.host.run(tested.host.newRequestKey(), inspectPayloadRuntimeForTest(tested.runtime).commands.create,
      { collection: "items", data: { title: "same-title", category: "shared", amount: 10 } });
    expect(yield* first.host.read(inspectPayloadRuntimeForTest(first.runtime).commands.count, query)).toEqual({ totalDocs: 1 });
    expect(yield* second.host.read(inspectPayloadRuntimeForTest(second.runtime).commands.count, query)).toEqual({ totalDocs: 1 });
  }))), 120_000);

  it.each(payloadIndexedVisibilityCases)("preserves ordinary-range visibility: %s", mode => runEffect(Effect.scoped(Effect.gen(function* () {
    yield* payloadIndexedVisibilityScenario(yield* makeIndexedPayloadFixture(fresh), mode);
  }))), 120_000);

  it("refuses final preparation overflow before membership conflict without replaying the held body", () => runEffect(Effect.scoped(Effect.gen(function* () {
    const tested = yield* makeIndexedPayloadFixture(fresh);
    const commands = inspectPayloadRuntimeForTest(tested.runtime).commands;
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let bodies = 0;
    const range = { collection: "items", where: { amount: { greater_than_equal: 30, less_than: 40 } } };
    const held = defineCmsCommand({ name: "heldFinalRangeCapacity", mode: "write", run: Effect.fn(function* (ctx) {
      bodies++;
      expect(yield* ctx.nested(commands.count, range)).toEqual({ totalDocs: 0 });
      const own = yield* ctx.nested(commands.create, { collection: "items", data: { title: "capacity-held", category: "held", amount: 9000 } });
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
      return own;
    }) });
    const fill = defineCmsCommand({ name: "fillFinalRangeCapacity", mode: "write", run: Effect.fn(function* (ctx, args) {
      const { base, count } = yield* decodeFill(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
      for (let position = 0; position < count; position++) yield* ctx.documents.insert(ctx.context, ctx.transactionId, "items",
        indexedFields(`capacity-${base + position}`, "matching", 35));
      return null;
    }) });
    const host = yield* Effect.acquireRelease(tested.openHost([held, fill]), value => value.close);
    yield* Effect.gen(function* () {
      const pending = yield* host.run(host.newRequestKey(), held, null).pipe(Effect.result, Effect.forkScoped);
      yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
      for (let base = 0; base < 257; base += 16) yield* host.run(host.newRequestKey(), fill, { base, count: Math.min(16, 257 - base) });
      const published = yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause });
      expect(published.rows).toHaveLength(257);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(pending)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      expect(yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause })).toEqual(published);
      expect(bodies).toBe(1);
      expect(yield* tested.host.read(commands.count, { collection: "items", where: { title: { equals: "capacity-held" } } })).toEqual({ totalDocs: 0 });
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(30_000));
  }))), 180_000);
});
