import { Deferred, Effect, Fiber, Result } from "effect";
import { ValidationError } from "payload";
import { expect, vi } from "vitest";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { defineCmsCommand, makeCmsHost } from "../src/cmsTransaction/host";
import { applicationUniqueDeclarationsMatch } from "../src/applicationWriteOwnership/UniqueDeclarations";
import { decodeIndexedDocument, makeIndexedPayloadFixture, type IndexedPayloadFixture } from "./payloadIndexedFixture";

export const makeUniquePayloadFixture = Effect.fn("UniquePayload.fixture")(function* (
  persistence: Parameters<typeof makeIndexedPayloadFixture>[0], session: Parameters<typeof makeIndexedPayloadFixture>[1],
) {
  const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
    { name: "title", type: "text", required: true, unique: true },
    { name: "alias", type: "text", required: true, unique: true },
    { name: "category", type: "text", required: true },
    { name: "amount", type: "number", required: true },
  ], indexes: [{ fields: ["category", "amount"], unique: true }] }]);
  return yield* makeIndexedPayloadFixture(persistence, session, compiled);
});

export const uniqueData = (title: string, category: string, amount: number, alias = `alias-${title}`) => ({ title, alias, category, amount });
const selection = (category: string, amount: number) => ({ collection: "items", where: { category: { equals: category }, amount: { equals: amount } } });

export const payloadUniqueScenario = Effect.fn("UniquePayload.scenario")(function* (tested: IndexedPayloadFixture) {
  const { host, runtime } = tested;
  const { fixture } = tested;
  const manifest = fixture.manifest;
  if (manifest.version !== 3) throw new Error("Expected authenticated Payload write policies");
  const bound = { deploymentId: fixture.deploymentId, schemaVersionId: fixture.relation.binding.schemaVersionId,
    tables: fixture.relation.binding.tables };
  expect(yield* applicationUniqueDeclarationsMatch(fixture.control.drizzle, manifest, bound)).toBe(true);
  yield* Effect.scoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.sync(() => vi.spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValueOnce(new DOMException("injected digest failure", "OperationError"))), spy => Effect.sync(() => spy.mockRestore()));
    expect(yield* applicationUniqueDeclarationsMatch(fixture.control.drizzle, manifest, bound).pipe(Effect.result))
      .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "digestUnavailable" } } });
  }));
  expect(yield* applicationUniqueDeclarationsMatch(fixture.control.drizzle, manifest, bound)).toBe(true);
  for (const reverse of [false, true]) {
    const changed = { ...manifest, schema: { ...manifest.schema, writePolicies: { ...manifest.schema.writePolicies,
      configuration: { ...manifest.schema.writePolicies.configuration,
        tables: manifest.schema.writePolicies.configuration.tables.map(table => ({ ...table,
          indexes: reverse ? table.indexes?.map(index => ({ ...index, fields: [...index.fields].reverse() })) ?? [] : [],
        })) } } } };
    expect(yield* applicationUniqueDeclarationsMatch(fixture.control.drizzle, changed, bound)).toBe(false);
  }
  const create = (data: ReturnType<typeof uniqueData>) => host.run(host.newRequestKey(), runtime.commands.create, { collection: "items", data });
  const first = decodeIndexedDocument(yield* create(uniqueData("first", "red", 10)));
  const second = decodeIndexedDocument(yield* create(uniqueData("second", "red", 11)));
  yield* create(uniqueData("blue", "blue", 10));
  const before = yield* Effect.promise(tested.inventory);
  expect(before.claims).toHaveLength(9);
  expect(new Set(before.claims.map(claim => claim.constraintId)).size).toBe(3);
  for (const [data, paths] of [
    [uniqueData("first", "green", 100), ["title"]],
    [uniqueData("alias-clash", "green", 100, "alias-first"), ["alias"]],
    [uniqueData("tuple-clash", "red", 10), ["category", "amount"]],
  ] as const) {
    const failure = yield* host.run(host.newRequestKey(), runtime.commands.create, { collection: "items", data }).pipe(Effect.flip);
    expect(failure.cause).toBeInstanceOf(ValidationError);
    expect(failure).toMatchObject({ reason: "documentInvalid", cause: { status: 400,
      data: { errors: paths.map(path => ({ path, message: "Value must be unique" })) } } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
  }
  const failedUpdate = yield* host.run(host.newRequestKey(), runtime.commands.update,
    { collection: "items", id: second.id, data: { amount: 10 } }).pipe(Effect.flip);
  expect(failedUpdate).toMatchObject({ reason: "documentInvalid", cause: { data: { errors: [{ path: "category" }, { path: "amount" }] } } });
  expect(yield* Effect.promise(tested.inventory)).toEqual(before);
  expect(yield* host.read(runtime.commands.count, selection("red", 10))).toEqual({ totalDocs: 1 });
  expect(yield* host.read(runtime.commands.count, { collection: "items", where: { alias: { equals: "alias-first" } } })).toEqual({ totalDocs: 1 });
  expect(yield* host.read(runtime.commands.count, { collection: "items", where: { category: { equals: "red" } } })).toEqual({ totalDocs: 2 });
  let executions = 0;
  const move = defineCmsCommand({ name: "moveUniqueClaims", mode: "write", run: Effect.fn(function* (ctx, fail) {
    executions++;
    yield* ctx.nested(runtime.commands.update, { collection: "items", id: first.id, data: { amount: 12, alias: "moved-alias" } });
    expect(yield* ctx.nested(runtime.commands.count, selection("red", 10))).toEqual({ totalDocs: 0 });
    const replacement = decodeIndexedDocument(yield* ctx.nested(runtime.commands.create,
      { collection: "items", data: uniqueData("replacement", "red", 10, "alias-first") }));
    expect(yield* ctx.nested(runtime.commands.count, selection("red", 10))).toEqual({ totalDocs: 1 });
    // This proves core claim release. Native delete's preference lifecycle has
    // a separate connected fixture and is not granted by the content binding.
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, replacement.id, "items");
    expect(yield* ctx.nested(runtime.commands.count, selection("red", 10))).toEqual({ totalDocs: 0 });
    const final = yield* ctx.nested(runtime.commands.create,
      { collection: "items", data: uniqueData("replacement", "red", 10, "alias-first") });
    if (fail === true) {
      // A second native operation must roll back all earlier key releases and acquisitions.
      yield* ctx.nested(runtime.commands.create, { collection: "items", data: uniqueData("late-clash", "red", 11) });
      return yield* Effect.die("Expected a native uniqueness refusal");
    }
    return final;
  }) });
  yield* Effect.scoped(Effect.gen(function* () {
    const pending = yield* Effect.acquireRelease(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, move] }), value => value.close);
    expect(yield* pending.run(pending.newRequestKey(), move, true).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
    const key = pending.newRequestKey();
    const value = yield* pending.run(key, move, false);
    const after = yield* Effect.promise(tested.inventory);
    expect(after.claims).toHaveLength(12);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(yield* pending.run(key, move, false)).toEqual(value);
    expect(yield* Effect.promise(tested.inventory)).toEqual(after);
    expect(executions).toBe(2);
  }));
  yield* create(uniqueData("zero", "zero", -0));
  const zero = yield* Effect.promise(tested.inventory);
  expect(yield* host.run(host.newRequestKey(), runtime.commands.create,
    { collection: "items", data: uniqueData("zero-clash", "zero", 0) }).pipe(Effect.flip)).toMatchObject({ reason: "documentInvalid" });
  expect(yield* Effect.promise(tested.inventory)).toEqual(zero);
  expect(yield* host.read(runtime.commands.count, selection("zero", -0))).toEqual({ totalDocs: 1 });
  expect(tested.scans()).toBe(0);
});

/** Held detached execution must not block the competing transaction's publication. */
export const concurrentUniqueScenario = Effect.fn("UniquePayload.concurrent")(function* (tested: IndexedPayloadFixture, sameKey: boolean) {
  const { host, runtime } = tested;
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const held = defineCmsCommand({ name: "heldUniqueInsert", mode: "write", run: Effect.fn(function* (ctx) {
    const value = yield* ctx.nested(runtime.commands.create, { collection: "items", data: uniqueData("held", "red", 10) });
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(release);
    return value;
  }) });
  const pending = yield* Effect.acquireRelease(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, held] }), value => value.close);
  yield* Effect.gen(function* () {
    const fiber = yield* pending.run(pending.newRequestKey(), held, null).pipe(Effect.result, Effect.forkScoped);
    yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
    yield* host.run(host.newRequestKey(), runtime.commands.create, { collection: "items", data: uniqueData("competing", "red", sameKey ? 10 : 11) });
    expect(yield* Deferred.isDone(release)).toBe(false);
    const published = yield* Effect.promise(tested.inventory);
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(fiber);
    if (sameKey) {
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      expect(yield* Effect.promise(tested.inventory)).toEqual(published);
    } else {
      expect(Result.isSuccess(result)).toBe(true);
      expect((yield* Effect.promise(tested.inventory)).claims).toHaveLength(6);
    }
  }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(20_000));
});
