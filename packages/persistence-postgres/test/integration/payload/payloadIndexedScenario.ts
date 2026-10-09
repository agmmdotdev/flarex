import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError, cmsLimits } from "../../../src/frameworks/cmsTransaction/model";
import { decodeIndexedDocument, decodeIndexedPage, indexedFields, type IndexedPayloadFixture } from "./payloadIndexedFixture";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

const decodeRollback = Schema.decodeUnknownEffect(Schema.Boolean);
export async function payloadIndexedScenario(tested: IndexedPayloadFixture) {
  const { host, runtime } = tested;
  await signedZeroScenario(tested);
  for (let batch = 0; batch < 18; batch++) await runEffect(host.run(host.newRequestKey(), tested.seed, batch));
  expect((await tested.inventory()).rows.length).toBeGreaterThan(cmsLimits.identities);
  const create = async (title: string, category: string, amount: number) => decodeIndexedDocument(await runEffect(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create,
    { collection: "items", data: { title, category, amount } })));
  const first = await create("selected-first", "red", 10);
  await create("selected-second", "red", 15);
  await create("other-category", "blue", 15);
  const doomed = await create("delete-pending", "red", 12);
  const compound = { category: { equals: "red" }, amount: { greater_than_equal: 10, less_than: 16 } };
  const query = { collection: "items", where: compound, limit: 1, page: 2 };
  const page = await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.find, query));
  expect(page).toMatchObject({ totalDocs: 3, totalPages: 3, page: 2, hasPrevPage: true, hasNextPage: true });
  const complete = decodeIndexedPage(await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.find, { collection: "items", where: compound })));
  expect(decodeIndexedPage(page).docs).toEqual(complete.docs.slice(1, 2));
  expect(await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.count, { collection: "items", where: { amount: { equals: 15 } } }))).toEqual({ totalDocs: 2 });
  expect(await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.count, { collection: "items", where: { category: { equals: "red" }, amount: { greater_than: 15 } } }))).toEqual({ totalDocs: 0 });
  expect(await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.count, { collection: "items", where: { amount: { greater_than: 20, less_than: 10 } } }))).toEqual({ totalDocs: 0 });
  expect(await runEffectFailure(host.read(inspectPayloadRuntimeForTest(runtime).commands.count, { collection: "items", where: { category: { equals: "unrelated" } } })))
    .toMatchObject({ reason: "limitExceeded" });
  let executions = 0;
  const move = defineCmsCommand({ name: "pendingIndexedMove", mode: "write", run: Effect.fn(function* (ctx, args) {
    executions++;
    const rollback = yield* decodeRollback(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    const range = { collection: "items", where: { amount: { greater_than_equal: 10, less_than: 15 } } };
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, range)).toEqual({ totalDocs: 2 });
    const updated = yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.update, { collection: "items", id: first.id, data: { amount: 20 } });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, range)).toEqual({ totalDocs: 1 });
    // Core deletion tests pending membership; Payload's preference-cleanup
    // lifecycle has its own connected native deletion regression.
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, doomed.id, "items");
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, range)).toEqual({ totalDocs: 0 });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, { collection: "items", where: { category: { equals: "red" }, amount: { greater_than: 19, less_than_equal: 20 } } })).toEqual({ totalDocs: 1 });
    const temporary = decodeIndexedDocument(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.create,
      { collection: "items", data: { title: "pending-insert", category: "red", amount: 11 } }));
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, range)).toEqual({ totalDocs: 1 });
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, temporary.id, "items");
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, range)).toEqual({ totalDocs: 0 });
    if (rollback) return yield* Effect.fail(cmsError("documentInvalid"));
    return updated;
  }) });
  const invalidQuery = defineCmsCommand({ name: "invalidIndexValue", mode: "write", run: Effect.fn(function* (ctx, residual) {
    yield* ctx.documents.insert(ctx.context, ctx.transactionId, "items", {
      title: "must-rollback", category: "red", amount: 11, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z",
    });
    // Generate malformed Unicode inside the command so outer request admission
    // cannot reject it before query lowering and hide a defect conversion.
    yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { offset: 0, limit: 8,
      where: residual === true ? { _id: first.id, category: { gte: "\ud800" } } : { category: "\ud800" } });
    return null;
  }) });
  const nested = await runEffect(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, move, invalidQuery] }, tested.hooks));
  const before = await tested.inventory();
  for (const residual of [false, true]) {
    expect(await runEffectFailure(nested.run(nested.newRequestKey(), invalidQuery, residual))).toMatchObject({ reason: "invalidInput" });
    expect(await tested.inventory()).toEqual(before);
  }
  expect(await runEffectFailure(nested.run(nested.newRequestKey(), move, true))).toMatchObject({ reason: "documentInvalid" });
  expect(await tested.inventory()).toEqual(before);
  const key = nested.newRequestKey();
  const updated = await runEffect(nested.run(key, move, false));
  expect(updated).toMatchObject({ id: first.id, amount: 20 });
  const after = await tested.inventory();
  expect(after.commits.length).toBe(before.commits.length + 1);
  expect(after.facts.length).toBe(before.facts.length + 2);
  expect(await runEffect(nested.run(key, move, false))).toEqual(updated);
  expect(await tested.inventory()).toEqual(after);
  expect(executions).toBe(2);
  expect(await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.count, { collection: "items", where: { amount: { greater_than_equal: 10, less_than: 15 } } }))).toEqual({ totalDocs: 0 });
  expect(tested.scans()).toBe(0);
  expect(tested.plans.length).toBeGreaterThan(0);
  await runEffect(nested.close);
}

async function signedZeroScenario(tested: IndexedPayloadFixture) {
  const { host, runtime } = tested;
  const created = decodeIndexedDocument(await runEffect(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create,
    { collection: "items", data: { title: "native-negative-zero", category: "zero", amount: -0 } })));
  expect(Object.is(created.amount, 0)).toBe(true);
  const second = decodeIndexedDocument(await runEffect(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create,
    { collection: "items", data: { title: "native-positive-zero", category: "zero", amount: 1 } })));
  const updated = decodeIndexedDocument(await runEffect(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.update,
    { collection: "items", id: second.id, data: { amount: -0 } })));
  expect(Object.is(updated.amount, 0)).toBe(true);
  const numericCount = (predicate: { equals: number } | { greater_than_equal: number; less_than_equal: number } | { greater_than: number } | { less_than: number }) =>
    ({ collection: "items", where: { amount: predicate } });
  for (const value of [0, -0]) {
    expect(await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.count, numericCount({ equals: value })))).toEqual({ totalDocs: 2 });
    expect(await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.count, numericCount({ greater_than_equal: value, less_than_equal: value })))).toEqual({ totalDocs: 2 });
    expect(await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.count, numericCount({ greater_than: value })))).toEqual({ totalDocs: 0 });
    expect(await runEffect(host.read(inspectPayloadRuntimeForTest(runtime).commands.count, numericCount({ less_than: value })))).toEqual({ totalDocs: 0 });
  }
  const pending = defineCmsCommand({ name: "pendingNativeZero", mode: "write", run: Effect.fn(function* (ctx, scanFirst) {
    if (scanFirst === true) yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { where: {}, offset: 0, limit: 8 });
    yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data: { title: "pending-zero", category: "zero", amount: -0 } });
    for (const value of [0, -0]) expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, numericCount({ equals: value }))).toEqual({ totalDocs: 3 });
    return yield* Effect.fail(cmsError("documentInvalid"));
  }) });
  const raw = defineCmsCommand({ name: "seedCoreSignedZero", mode: "write", run: Effect.fn(function* (ctx) {
    yield* ctx.documents.insert(ctx.context, ctx.transactionId, "items", indexedFields("core-negative-zero", "zero", -0));
    return null;
  }) });
  const core = defineCmsCommand({ name: "coreSignedZeroEquality", mode: "write", run: Effect.fn(function* (ctx, scanFirst) {
    if (scanFirst === true) yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { where: {}, offset: 0, limit: 8 });
    for (const value of [0, -0]) {
      const expected = Object.is(value, -0) ? 1 : 2;
      expect((yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { where: { amount: value }, offset: 0, limit: 8 })).total).toBe(expected);
      yield* ctx.documents.insert(ctx.context, ctx.transactionId, "items", indexedFields(`core-pending-${expected}`, "zero", value));
      expect((yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { where: { amount: value }, offset: 0, limit: 8 })).total).toBe(expected + 1);
    }
    return yield* Effect.fail(cmsError("documentInvalid"));
  }) });
  const clear = defineCmsCommand({ name: "clearZeroWitness", mode: "write", run: Effect.fn(function* (ctx) {
    const page = yield* ctx.documents.find(ctx.context, ctx.transactionId, "items", { where: {}, offset: 0, limit: 8 });
    for (const row of page.docs) {
      if (typeof row._id !== "string") throw new Error("Missing zero witness identity");
      yield* ctx.documents.delete(ctx.context, ctx.transactionId, row._id, "items");
    }
    return null;
  }) });
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const checked = yield* Effect.acquireRelease(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, pending, raw, core, clear] }), value => value.close);
    for (const command of [pending, core]) {
      if (command === core) yield* checked.run(checked.newRequestKey(), raw, null);
      const before = yield* Effect.promise(tested.inventory);
      for (const scanFirst of [false, true]) {
        expect(yield* checked.run(checked.newRequestKey(), command, scanFirst).pipe(Effect.result))
          .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
        expect(yield* Effect.promise(tested.inventory)).toEqual(before);
      }
    }
    yield* checked.run(checked.newRequestKey(), clear, null);
  })));
}
