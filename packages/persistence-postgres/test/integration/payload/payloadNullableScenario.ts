import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { Deferred, Effect, Fiber, Result, Schema, type Cause, type Scope } from "effect";
import { expect, vi } from "vitest";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { makeCoreNativeDefinition } from "../../../src/core/nativePolicy";
import type { CoreError } from "../../../src/core/api";
import type { CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";
import type { CorePayloadFixtureTarget, CorePayloadFixtureOptions } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { assertNativeConstraintBinding, makeIndexedPayloadFixture, type IndexedPayloadFixture } from "./payloadIndexedFixture";
import type { JsonObject } from "flarex-protocol/json";

const document = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String,
  alias: Schema.NullOr(Schema.String), amount: Schema.NullOr(Schema.Number),
  available: Schema.NullOr(Schema.Boolean), releaseAt: Schema.NullOr(Schema.String), note: Schema.NullOr(Schema.String),
}));
export const makeNullablePayloadFixture: (target: CorePayloadFixtureTarget,
  options?: Pick<CorePayloadFixtureOptions, "scopeUuid" | "epochUuid">) => Effect.Effect<IndexedPayloadFixture, unknown, Scope.Scope> =
  Effect.fn("NullablePayload.fixture")(function* (
  target: CorePayloadFixtureTarget, options?: Pick<CorePayloadFixtureOptions, "scopeUuid" | "epochUuid">,
): Effect.fn.Return<IndexedPayloadFixture, unknown, Scope.Scope> {
  const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
    { name: "title", type: "text", required: true, unique: true },
    { name: "alias", type: "text", unique: true },
    { name: "category", type: "text", required: true },
    { name: "amount", type: "number", required: false },
    { name: "available", type: "checkbox" }, { name: "releaseAt", type: "date" },
    { name: "note", type: "text", defaultValue: "draft" },
  ], indexes: [{ fields: ["category", "amount"], unique: true }] }]);
  return yield* makeIndexedPayloadFixture(target, compiled, options);
});
const aliasQuery = (alias: string | null) => ({ collection: "items", where: { alias: { equals: alias } } });
const tupleQuery = (amount: number | null) => ({ collection: "items", where: { category: { equals: "red" }, amount: { equals: amount } } });
const upperQuery = (amount: number, inclusive = false) => ({ collection: "items", where: {
  category: { equals: "red" }, amount: inclusive ? { less_than_equal: amount } : { less_than: amount },
} });

export const payloadNullableScenario = Effect.fn("NullablePayload.scenario")(function* (tested: IndexedPayloadFixture): Effect.fn.Return<void, CmsTransactionError | CoreError, Scope.Scope> {
  const { host, runtime } = tested;
  yield* assertNativeConstraintBinding(tested);
  const beforePreparationFailure = yield* Effect.promise(tested.inventory);
  const nativeInput = { source: tested.compiled.sourceContract, scopeUuid: tested.core.definition.identity.scopeUuid,
    epochUuid: tested.core.definition.identity.epochUuid };
  const providerFailure = new DOMException("temporary native spec digest failure", "OperationError");
  yield* Effect.acquireUseRelease(
    Effect.sync(() => vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(providerFailure)),
    () => Effect.gen(function* () {
      expect(yield* makeCoreNativeDefinition(nativeInput).pipe(Effect.result))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "CoreSchemaError", reason: "hashFailure",
          cause: { _tag: "ApplicationWritePolicyError", reason: "digestUnavailable", path: "digest" } } });
    }),
    spy => Effect.sync(() => spy.mockRestore()),
  );
  expect(yield* Effect.promise(tested.inventory)).toEqual(beforePreparationFailure);
  yield* assertNativeConstraintBinding(tested);
  const changed = { ...tested.compiled.sourceContract, configuration: { ...tested.compiled.configuration,
    tables: tested.compiled.configuration.tables.map(table => ({ ...table, fields: table.fields.map(field => {
      const required = { ...field };
      Reflect.deleteProperty(required, "nullable");
      return required;
    }) })) } };
  expect(yield* makeCoreNativeDefinition({ ...nativeInput, source: changed }).pipe(Effect.result))
    .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedCapability" } });
  const create = (data: JsonObject) => host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data });
  const first = document(yield* create({ title: "first", category: "red" }));
  expect(first).toMatchObject({ alias: null, amount: null, available: null, releaseAt: null, note: "draft" });
  expect(document(yield* create({ title: "second", category: "red", alias: null, amount: null, available: null, releaseAt: null, note: null })))
    .toMatchObject({ available: null, note: null });
  expect((yield* Effect.promise(tested.inventory)).rows).toHaveLength(2);
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, aliasQuery(null))).toEqual({ totalDocs: 2 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, tupleQuery(null))).toEqual({ totalDocs: 2 });
  const active = document(yield* create({ title: "active", category: "red", alias: "held", amount: 10 }));
  const before = yield* Effect.promise(tested.inventory);
  expect(before.rows).toHaveLength(3);
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.find, aliasQuery("held"))).toMatchObject({ totalDocs: 1, docs: [{ id: active.id }] });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.find, tupleQuery(10))).toMatchObject({ totalDocs: 1, docs: [{ id: active.id }] });
  for (const [data, paths] of [[{ alias: "held" }, ["alias"]], [{ amount: 10 }, ["category", "amount"]]] as const) {
    expect(yield* host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.update, { collection: "items", id: first.id, data }).pipe(Effect.result))
      .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid", cause: { status: 400,
        data: { errors: paths.map(path => ({ path, message: "Value must be unique" })) } } } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
  }
  expect(yield* create({ title: null, category: "red" }).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
  expect(yield* Effect.promise(tested.inventory)).toEqual(before);
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, aliasQuery(null))).toEqual({ totalDocs: 2 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, tupleQuery(null))).toEqual({ totalDocs: 2 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, upperQuery(10))).toEqual({ totalDocs: 0 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.find, upperQuery(10, true))).toMatchObject({ totalDocs: 1, docs: [{ id: active.id }] });
  const transition = defineCmsCommand({ name: "nullableKeyTransition", mode: "write", run: Effect.fn(function* (ctx, fail) {
    yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.update, { collection: "items", id: active.id, data: { alias: null, amount: null } });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, aliasQuery("held"))).toEqual({ totalDocs: 0 });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, aliasQuery(null))).toEqual({ totalDocs: 3 });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, tupleQuery(null))).toEqual({ totalDocs: 3 });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, upperQuery(10, true))).toEqual({ totalDocs: 0 });
    const replacement = yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data: { title: "replacement", category: "red", alias: "held", amount: 10 } });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, aliasQuery("held"))).toEqual({ totalDocs: 1 });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, tupleQuery(10))).toEqual({ totalDocs: 1 });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, upperQuery(10, true))).toEqual({ totalDocs: 1 });
    if (fail === true) yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data: { title: "first", category: "red" } });
    return replacement;
  }) });
  const missingStorageValue = defineCmsCommand({ name: "missingNullableStorageValue", mode: "write", run: Effect.fn(function* (ctx) {
    return yield* ctx.documents.insert(ctx.context, ctx.transactionId, "items", {
      title: "missing-alias", category: "red", amount: null, available: null, releaseAt: null, note: null,
      createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z",
    });
  }) });
  yield* Effect.scoped(Effect.gen(function* () {
    const pending = yield* Effect.acquireRelease(tested.openHost([transition, missingStorageValue]), value => value.close);
    expect(yield* pending.run(pending.newRequestKey(), missingStorageValue, null).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
    expect(yield* pending.run(pending.newRequestKey(), transition, true).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
    const key = pending.newRequestKey();
    const replacement = yield* pending.run(key, transition, false);
    const after = yield* Effect.promise(tested.inventory);
    expect(after.rows).toHaveLength(4);
    expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, aliasQuery(null))).toEqual({ totalDocs: 3 });
    expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, tupleQuery(null))).toEqual({ totalDocs: 3 });
    expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.find, aliasQuery("held"))).toMatchObject({ totalDocs: 1, docs: [{ id: document(replacement).id }] });
    expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.find, tupleQuery(10))).toMatchObject({ totalDocs: 1, docs: [{ id: document(replacement).id }] });
    expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expect(yield* pending.run(key, transition, false)).toEqual(replacement);
    expect(yield* Effect.promise(tested.inventory)).toEqual(after);
  }));
  const updated = document(yield* host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.update,
    { collection: "items", id: first.id, data: { alias: "new", amount: 11, releaseAt: "2026-09-20T00:00:00.000Z" } }));
  const retained = document(yield* host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.update,
    { collection: "items", id: first.id, data: { note: "changed" } }));
  expect(retained).toMatchObject({ alias: updated.alias, amount: 11, releaseAt: updated.releaseAt, note: "changed" });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, aliasQuery(null))).toEqual({ totalDocs: 2 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, tupleQuery(null))).toEqual({ totalDocs: 2 });
  const falsy = document(yield* create({ title: "falsy", category: "red", alias: "", amount: 0, available: false, note: "" }));
  expect(falsy).toMatchObject({ alias: "", amount: 0, available: false, note: "" });
  const beforeConflict = yield* Effect.promise(tested.inventory);
  expect(yield* create({ title: "empty-alias-clash", category: "blue", alias: "" }).pipe(Effect.result))
    .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
  expect(yield* create({ title: "zero-amount-clash", category: "red", amount: 0 }).pipe(Effect.result))
    .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
  expect(yield* Effect.promise(tested.inventory)).toEqual(beforeConflict);
  yield* create({ title: "minimum", category: "red", amount: -Number.MAX_VALUE });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, upperQuery(-Number.MAX_VALUE))).toEqual({ totalDocs: 0 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, upperQuery(-Number.MAX_VALUE, true))).toEqual({ totalDocs: 1 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, upperQuery(-0))).toEqual({ totalDocs: 1 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, upperQuery(0, true))).toEqual({ totalDocs: 2 });
  expect(yield* Effect.promise(() => tested.applicationTableQueries())).toHaveLength(0);
  const scannedRanges = defineCmsCommand({ name: "scannedNullableRanges", mode: "read", run: Effect.fn(function* (ctx) {
    yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.find, { collection: "items", limit: 32 });
    // Reuse an already scanned view: residual matching must exclude null too.
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, upperQuery(-0))).toEqual({ totalDocs: 1 });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, upperQuery(0, true))).toEqual({ totalDocs: 2 });
    return null;
  }) });
  yield* Effect.scoped(Effect.gen(function* () {
    const reader = yield* Effect.acquireRelease(tested.openHost([scannedRanges]), value => value.close);
    yield* reader.read(scannedRanges, null);
  }));
  expect((yield* Effect.promise(() => tested.applicationTableQueries())).length).toBeGreaterThan(0);
});

export const concurrentNullableScenario = Effect.fn("NullablePayload.concurrent")(function* (tested: IndexedPayloadFixture, nullKey: boolean): Effect.fn.Return<void, CmsTransactionError | Cause.TimeoutError, Scope.Scope> {
  const { host, runtime } = tested;
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const held = defineCmsCommand({ name: "heldNullableInsert", mode: "write", run: Effect.fn(function* (ctx) {
    const result = yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data: {
      title: "held", category: "red", alias: nullKey ? null : "same", amount: null,
    } });
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(release);
    return result;
  }) });
  const pending = yield* Effect.acquireRelease(tested.openHost([held]), value => value.close);
  yield* Effect.gen(function* () {
    const fiber = yield* pending.run(pending.newRequestKey(), held, null).pipe(Effect.result, Effect.forkScoped);
    yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
    yield* host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data: {
      title: "competitor", category: "red", alias: nullKey ? null : "same", amount: null,
    } });
    const before = yield* Effect.promise(tested.inventory);
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(fiber);
    if (nullKey) {
      expect(Result.isSuccess(result)).toBe(true);
      expect((yield* Effect.promise(tested.inventory)).rows).toHaveLength(2);
      expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, aliasQuery(null))).toEqual({ totalDocs: 2 });
      expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, tupleQuery(null))).toEqual({ totalDocs: 2 });
    } else {
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      expect(yield* Effect.promise(tested.inventory)).toEqual(before);
    }
  }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(20_000));
});
