import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { Deferred, Effect, Fiber, Result, type Cause, type Scope } from "effect";
import { ValidationError } from "payload";
import { expect, vi } from "vitest";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { makeCoreNativeDefinition } from "../../../src/core/nativePolicy";
import type { CoreError } from "../../../src/core/api";
import type { CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";
import type { CorePayloadFixtureTarget, CorePayloadFixtureOptions } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { assertNativeConstraintBinding, decodeIndexedDocument, decodeIndexedPage, makeIndexedPayloadFixture, type IndexedPayloadFixture } from "./payloadIndexedFixture";

export const makeUniquePayloadFixture: (target: CorePayloadFixtureTarget,
  options?: Pick<CorePayloadFixtureOptions, "scopeUuid" | "epochUuid">) => Effect.Effect<IndexedPayloadFixture, unknown, Scope.Scope> =
  Effect.fn("UniquePayload.fixture")(function* (
  target: CorePayloadFixtureTarget, options?: Pick<CorePayloadFixtureOptions, "scopeUuid" | "epochUuid">,
): Effect.fn.Return<IndexedPayloadFixture, unknown, Scope.Scope> {
  const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
    { name: "title", type: "text", required: true, unique: true },
    { name: "alias", type: "text", required: true, unique: true },
    { name: "category", type: "text", required: true },
    { name: "amount", type: "number", required: true },
  ], indexes: [{ fields: ["category", "amount"], unique: true }] }]);
  return yield* makeIndexedPayloadFixture(target, compiled, options);
});

export const uniqueData = (title: string, category: string, amount: number, alias = `alias-${title}`) => ({ title, alias, category, amount });
const selection = (category: string, amount: number) => ({ collection: "items", where: { category: { equals: category }, amount: { equals: amount } } });

export const assertUniqueOwners = Effect.fn("UniquePayload.assertOwners")(function* (
  tested: IndexedPayloadFixture, expected: readonly Readonly<{ id: string; data: ReturnType<typeof uniqueData> }>[],
): Effect.fn.Return<void, CmsTransactionError> {
  const commands = inspectPayloadRuntimeForTest(tested.runtime).commands;
  for (const { id, data } of expected) for (const where of [
    { title: { equals: data.title } }, { alias: { equals: data.alias } },
    { category: { equals: data.category }, amount: { equals: data.amount } },
  ]) expect(decodeIndexedPage(yield* tested.host.read(commands.find, { collection: "items", where })))
    .toMatchObject({ totalDocs: 1, docs: [{ id }] });
});

export const payloadUniqueScenario = Effect.fn("UniquePayload.scenario")(function* (tested: IndexedPayloadFixture): Effect.fn.Return<void, CmsTransactionError | CoreError, Scope.Scope> {
  const { host, runtime } = tested;
  yield* assertNativeConstraintBinding(tested);
  const nativeInput = { source: tested.compiled.sourceContract, scopeUuid: tested.core.definition.identity.scopeUuid,
    epochUuid: tested.core.definition.identity.epochUuid };
  yield* Effect.scoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.sync(() => vi.spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValueOnce(new DOMException("injected digest failure", "OperationError"))), spy => Effect.sync(() => spy.mockRestore()));
    expect(yield* makeCoreNativeDefinition(nativeInput).pipe(Effect.result))
      .toMatchObject({ _tag: "Failure", failure: { reason: "hashFailure", cause: { reason: "digestUnavailable" } } });
  }));
  yield* assertNativeConstraintBinding(tested);
  for (const reverse of [false, true]) {
    const changed = { ...tested.compiled.sourceContract, definition: { ...tested.compiled.logicalDefinition,
      indexes: reverse ? tested.compiled.logicalDefinition.indexes.map(index => ({ ...index, fields: [...index.fields].reverse() })) : [] } };
    expect(yield* makeCoreNativeDefinition({ ...nativeInput, source: changed }).pipe(Effect.result))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedCapability" } });
  }
  const create = (data: ReturnType<typeof uniqueData>) => host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data });
  const first = decodeIndexedDocument(yield* create(uniqueData("first", "red", 10)));
  const second = decodeIndexedDocument(yield* create(uniqueData("second", "red", 11)));
  const blue = decodeIndexedDocument(yield* create(uniqueData("blue", "blue", 10)));
  const before = yield* Effect.promise(tested.inventory);
  expect(before.rows).toHaveLength(3);
  yield* assertUniqueOwners(tested, [
    { id: first.id, data: uniqueData("first", "red", 10) },
    { id: second.id, data: uniqueData("second", "red", 11) },
    { id: blue.id, data: uniqueData("blue", "blue", 10) },
  ]);
  for (const [data, paths] of [
    [uniqueData("first", "green", 100), ["title"]],
    [uniqueData("alias-clash", "green", 100, "alias-first"), ["alias"]],
    [uniqueData("tuple-clash", "red", 10), ["category", "amount"]],
  ] as const) {
    const attempted = yield* host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data }).pipe(Effect.result);
    if (Result.isSuccess(attempted)) throw new Error("Expected native uniqueness failure");
    const failure = attempted.failure;
    expect(failure.cause).toBeInstanceOf(ValidationError);
    expect(failure).toMatchObject({ reason: "documentInvalid", cause: { status: 400,
      data: { errors: paths.map(path => ({ path, message: "Value must be unique" })) } } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
  }
  const attemptedUpdate = yield* host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.update,
    { collection: "items", id: second.id, data: { amount: 10 } }).pipe(Effect.result);
  if (Result.isSuccess(attemptedUpdate)) throw new Error("Expected native tuple uniqueness failure");
  const failedUpdate = attemptedUpdate.failure;
  expect(failedUpdate).toMatchObject({ reason: "documentInvalid", cause: { data: { errors: [{ path: "category" }, { path: "amount" }] } } });
  expect(yield* Effect.promise(tested.inventory)).toEqual(before);
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, selection("red", 10))).toEqual({ totalDocs: 1 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, { collection: "items", where: { alias: { equals: "alias-first" } } })).toEqual({ totalDocs: 1 });
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, { collection: "items", where: { category: { equals: "red" } } })).toEqual({ totalDocs: 2 });
  let executions = 0;
  const move = defineCmsCommand({ name: "moveUniqueClaims", mode: "write", run: Effect.fn(function* (ctx, fail) {
    executions++;
    yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.update, { collection: "items", id: first.id, data: { amount: 12, alias: "moved-alias" } });
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, selection("red", 10))).toEqual({ totalDocs: 0 });
    const replacement = decodeIndexedDocument(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.create,
      { collection: "items", data: uniqueData("replacement", "red", 10, "alias-first") }));
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, selection("red", 10))).toEqual({ totalDocs: 1 });
    // This proves core claim release. Native delete's preference lifecycle has
    // a separate connected fixture and is not granted by the content binding.
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, replacement.id, "items");
    expect(yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.count, selection("red", 10))).toEqual({ totalDocs: 0 });
    const final = yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.create,
      { collection: "items", data: uniqueData("replacement", "red", 10, "alias-first") });
    if (fail === true) {
      // A second native operation must roll back all earlier key releases and acquisitions.
      yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data: uniqueData("late-clash", "red", 11) });
      return yield* Effect.die("Expected a native uniqueness refusal");
    }
    return final;
  }) });
  yield* Effect.scoped(Effect.gen(function* () {
    const pending = yield* Effect.acquireRelease(tested.openHost([move]), value => value.close);
    expect(yield* pending.run(pending.newRequestKey(), move, true).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
    const key = pending.newRequestKey();
    const value = yield* pending.run(key, move, false);
    const after = yield* Effect.promise(tested.inventory);
    expect(after.rows).toHaveLength(4);
    yield* assertUniqueOwners(tested, [
      { id: first.id, data: uniqueData("first", "red", 12, "moved-alias") },
      { id: second.id, data: uniqueData("second", "red", 11) },
      { id: blue.id, data: uniqueData("blue", "blue", 10) },
      { id: decodeIndexedDocument(value).id, data: uniqueData("replacement", "red", 10, "alias-first") },
    ]);
    expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expect(yield* pending.run(key, move, false)).toEqual(value);
    expect(yield* Effect.promise(tested.inventory)).toEqual(after);
    expect(executions).toBe(2);
  }));
  yield* create(uniqueData("zero", "zero", -0));
  const zero = yield* Effect.promise(tested.inventory);
  expect(yield* host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create,
    { collection: "items", data: uniqueData("zero-clash", "zero", 0) }).pipe(Effect.result))
    .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
  expect(yield* Effect.promise(tested.inventory)).toEqual(zero);
  expect(yield* host.read(inspectPayloadRuntimeForTest(runtime).commands.count, selection("zero", -0))).toEqual({ totalDocs: 1 });
  expect(yield* Effect.promise(() => tested.applicationTableQueries())).toHaveLength(0);
});

/** Held detached execution must not block the competing transaction's publication. */
export const concurrentUniqueScenario = Effect.fn("UniquePayload.concurrent")(function* (tested: IndexedPayloadFixture, sameKey: boolean): Effect.fn.Return<void, CmsTransactionError | Cause.TimeoutError, Scope.Scope> {
  const { host, runtime } = tested;
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const held = defineCmsCommand({ name: "heldUniqueInsert", mode: "write", run: Effect.fn(function* (ctx) {
    const value = yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.create, { collection: "items", data: uniqueData("held", "red", 10) });
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(release);
    return value;
  }) });
  const pending = yield* Effect.acquireRelease(tested.openHost([held]), value => value.close);
  yield* Effect.gen(function* () {
    const fiber = yield* pending.run(pending.newRequestKey(), held, null).pipe(Effect.result, Effect.forkScoped);
    yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
    const competing = decodeIndexedDocument(yield* host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create,
      { collection: "items", data: uniqueData("competing", "red", sameKey ? 10 : 11) }));
    expect(yield* Deferred.isDone(release)).toBe(false);
    const published = yield* Effect.promise(tested.inventory);
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(fiber);
    if (sameKey) {
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      expect(yield* Effect.promise(tested.inventory)).toEqual(published);
    } else {
      expect(Result.isSuccess(result)).toBe(true);
      expect((yield* Effect.promise(tested.inventory)).rows).toHaveLength(2);
      yield* assertUniqueOwners(tested, [
        { id: decodeIndexedDocument(Result.getOrThrow(result)).id, data: uniqueData("held", "red", 10) },
        { id: competing.id, data: uniqueData("competing", "red", 11) },
      ]);
    }
  }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(20_000));
});
