import { Deferred, Effect, Fiber, Result, Schema } from "effect";
import { expect, vi } from "vitest";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { defineCmsCommand } from "../src/cmsTransaction/commands";
import { applicationUniqueDeclarationsMatch, prepareApplicationUniqueDeclarationsInTransaction } from "../src/applicationWriteOwnership/UniqueDeclarations";
import { runEffectTransaction } from "../src/effectTransaction";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { makeIndexedPayloadFixture, type IndexedPayloadFixture } from "./payloadIndexedFixture";
import type { JsonObject } from "flarex-protocol/json";

const document = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String,
  alias: Schema.NullOr(Schema.String), amount: Schema.NullOr(Schema.Number),
  available: Schema.NullOr(Schema.Boolean), releaseAt: Schema.NullOr(Schema.String), note: Schema.NullOr(Schema.String),
}));
export const makeNullablePayloadFixture = Effect.fn("NullablePayload.fixture")(function* (
  persistence: Parameters<typeof makeIndexedPayloadFixture>[0], session: Parameters<typeof makeIndexedPayloadFixture>[1],
) {
  const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
    { name: "title", type: "text", required: true, unique: true },
    { name: "alias", type: "text", unique: true },
    { name: "category", type: "text", required: true },
    { name: "amount", type: "number", required: false },
    { name: "available", type: "checkbox" }, { name: "releaseAt", type: "date" },
    { name: "note", type: "text", defaultValue: "draft" },
  ], indexes: [{ fields: ["category", "amount"], unique: true }] }]);
  return yield* makeIndexedPayloadFixture(persistence, session, compiled);
});
const aliasQuery = (alias: string | null) => ({ collection: "items", where: { alias: { equals: alias } } });
const tupleQuery = (amount: number | null) => ({ collection: "items", where: { category: { equals: "red" }, amount: { equals: amount } } });
const upperQuery = (amount: number, inclusive = false) => ({ collection: "items", where: {
  category: { equals: "red" }, amount: inclusive ? { less_than_equal: amount } : { less_than: amount },
} });

export const payloadNullableScenario = Effect.fn("NullablePayload.scenario")(function* (tested: IndexedPayloadFixture) {
  const { host, runtime } = tested;
  const manifest = tested.fixture.manifest;
  if (manifest.version !== 3) throw new Error("Expected Payload-owned manifest");
  const bound = { deploymentId: tested.fixture.deploymentId, schemaVersionId: tested.fixture.relation.binding.schemaVersionId,
    tables: tested.fixture.relation.binding.tables };
  expect(yield* applicationUniqueDeclarationsMatch(tested.fixture.control.drizzle, manifest, bound)).toBe(true);
  const beforePreparationFailure = yield* Effect.promise(tested.inventory);
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const providerFailure = new DOMException("temporary unique spec digest failure", "OperationError");
  yield* Effect.acquireUseRelease(
    Effect.sync(() => vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, bytes) =>
      new TextDecoder().decode(bytes).startsWith('{"format":"flarexdb-app-unique-constraint-physical-spec"')
        ? Promise.reject(providerFailure) : digest(algorithm, bytes))),
    () => Effect.gen(function* () {
      const prepared = yield* Effect.result(runEffectTransaction(
        callback => tested.fixture.control.drizzle.transaction(callback), "Payload declaration test rollback",
        (tx: FlarexMetadataTransaction) => prepareApplicationUniqueDeclarationsInTransaction(tx, manifest, bound),
        cause => new Error("Payload declaration transaction failed", { cause }),
      ));
      expect(prepared).toMatchObject({ _tag: "Failure", failure: { _tag: "ApplicationWriteOwnershipError",
        reason: "resourceFailure", cause: { _tag: "AppUniqueConstraintDefinitionPreparationError", operation: "canonicalizeSpec", cause: providerFailure } } });
      expect(yield* Effect.result(applicationUniqueDeclarationsMatch(tested.fixture.control.drizzle, manifest, bound)))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "ApplicationWriteOwnershipError", reason: "resourceFailure",
          cause: { _tag: "AppUniqueConstraintCatalogPersistenceError", operation: "canonicalizeStoredSpec", cause: providerFailure } } });
    }),
    spy => Effect.sync(() => spy.mockRestore()),
  );
  expect(yield* Effect.promise(tested.inventory)).toEqual(beforePreparationFailure);
  expect(yield* applicationUniqueDeclarationsMatch(tested.fixture.control.drizzle, manifest, bound)).toBe(true);
  const changed = { ...manifest, schema: { ...manifest.schema, writePolicies: { ...manifest.schema.writePolicies,
    configuration: { ...manifest.schema.writePolicies.configuration, tables: manifest.schema.writePolicies.configuration.tables.map(table => ({ ...table,
      fields: table.fields.map(field => {
        const required = { ...field };
        Reflect.deleteProperty(required, "nullable");
        return required;
      }),
    })) } } } };
  expect(yield* applicationUniqueDeclarationsMatch(tested.fixture.control.drizzle, changed, bound)).toBe(false);
  const create = (data: JsonObject) => host.run(host.newRequestKey(), runtime.commands.create, { collection: "items", data });
  const first = document(yield* create({ title: "first", category: "red" }));
  expect(first).toMatchObject({ alias: null, amount: null, available: null, releaseAt: null, note: "draft" });
  expect(document(yield* create({ title: "second", category: "red", alias: null, amount: null, available: null, releaseAt: null, note: null })))
    .toMatchObject({ available: null, note: null });
  expect((yield* Effect.promise(tested.inventory)).claims).toHaveLength(2);
  const active = document(yield* create({ title: "active", category: "red", alias: "held", amount: 10 }));
  const before = yield* Effect.promise(tested.inventory);
  expect(before.claims).toHaveLength(5);
  for (const [data, paths] of [[{ alias: "held" }, ["alias"]], [{ amount: 10 }, ["category", "amount"]]] as const) {
    expect(yield* host.run(host.newRequestKey(), runtime.commands.update, { collection: "items", id: first.id, data }).pipe(Effect.result))
      .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid", cause: { status: 400,
        data: { errors: paths.map(path => ({ path, message: "Value must be unique" })) } } } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
  }
  expect(yield* create({ title: null, category: "red" }).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
  expect(yield* Effect.promise(tested.inventory)).toEqual(before);
  expect(yield* host.read(runtime.commands.count, aliasQuery(null))).toEqual({ totalDocs: 2 });
  expect(yield* host.read(runtime.commands.count, tupleQuery(null))).toEqual({ totalDocs: 2 });
  expect(yield* host.read(runtime.commands.count, upperQuery(10))).toEqual({ totalDocs: 0 });
  expect(yield* host.read(runtime.commands.find, upperQuery(10, true))).toMatchObject({ totalDocs: 1, docs: [{ id: active.id }] });
  const transition = defineCmsCommand({ name: "nullableKeyTransition", mode: "write", run: Effect.fn(function* (ctx, fail) {
    yield* ctx.nested(runtime.commands.update, { collection: "items", id: active.id, data: { alias: null, amount: null } });
    expect(yield* ctx.nested(runtime.commands.count, aliasQuery("held"))).toEqual({ totalDocs: 0 });
    expect(yield* ctx.nested(runtime.commands.count, aliasQuery(null))).toEqual({ totalDocs: 3 });
    expect(yield* ctx.nested(runtime.commands.count, tupleQuery(null))).toEqual({ totalDocs: 3 });
    expect(yield* ctx.nested(runtime.commands.count, upperQuery(10, true))).toEqual({ totalDocs: 0 });
    const replacement = yield* ctx.nested(runtime.commands.create, { collection: "items", data: { title: "replacement", category: "red", alias: "held", amount: 10 } });
    expect(yield* ctx.nested(runtime.commands.count, aliasQuery("held"))).toEqual({ totalDocs: 1 });
    expect(yield* ctx.nested(runtime.commands.count, tupleQuery(10))).toEqual({ totalDocs: 1 });
    expect(yield* ctx.nested(runtime.commands.count, upperQuery(10, true))).toEqual({ totalDocs: 1 });
    if (fail === true) yield* ctx.nested(runtime.commands.create, { collection: "items", data: { title: "first", category: "red" } });
    return replacement;
  }) });
  const missingStorageValue = defineCmsCommand({ name: "missingNullableStorageValue", mode: "write", run: Effect.fn(function* (ctx) {
    return yield* ctx.documents.insert(ctx.context, ctx.transactionId, "items", {
      title: "missing-alias", category: "red", amount: null, available: null, releaseAt: null, note: null,
      createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z",
    });
  }) });
  yield* Effect.scoped(Effect.gen(function* () {
    const pending = yield* Effect.acquireRelease(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, transition, missingStorageValue] }, tested.hooks), value => value.close);
    expect(yield* pending.run(pending.newRequestKey(), missingStorageValue, null).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
    expect(yield* pending.run(pending.newRequestKey(), transition, true).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
    expect(yield* Effect.promise(tested.inventory)).toEqual(before);
    const key = pending.newRequestKey();
    const replacement = yield* pending.run(key, transition, false);
    const after = yield* Effect.promise(tested.inventory);
    expect(after.claims).toHaveLength(6);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(yield* pending.run(key, transition, false)).toEqual(replacement);
    expect(yield* Effect.promise(tested.inventory)).toEqual(after);
  }));
  const updated = document(yield* host.run(host.newRequestKey(), runtime.commands.update,
    { collection: "items", id: first.id, data: { alias: "new", amount: 11, releaseAt: "2026-09-20T00:00:00.000Z" } }));
  const retained = document(yield* host.run(host.newRequestKey(), runtime.commands.update,
    { collection: "items", id: first.id, data: { note: "changed" } }));
  expect(retained).toMatchObject({ alias: updated.alias, amount: 11, releaseAt: updated.releaseAt, note: "changed" });
  expect(yield* host.read(runtime.commands.count, aliasQuery(null))).toEqual({ totalDocs: 2 });
  expect(yield* host.read(runtime.commands.count, tupleQuery(null))).toEqual({ totalDocs: 2 });
  const falsy = document(yield* create({ title: "falsy", category: "red", alias: "", amount: 0, available: false, note: "" }));
  expect(falsy).toMatchObject({ alias: "", amount: 0, available: false, note: "" });
  const beforeConflict = yield* Effect.promise(tested.inventory);
  expect(yield* create({ title: "empty-alias-clash", category: "blue", alias: "" }).pipe(Effect.result))
    .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
  expect(yield* create({ title: "zero-amount-clash", category: "red", amount: 0 }).pipe(Effect.result))
    .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
  expect(yield* Effect.promise(tested.inventory)).toEqual(beforeConflict);
  yield* create({ title: "minimum", category: "red", amount: -Number.MAX_VALUE });
  expect(yield* host.read(runtime.commands.count, upperQuery(-Number.MAX_VALUE))).toEqual({ totalDocs: 0 });
  expect(yield* host.read(runtime.commands.count, upperQuery(-Number.MAX_VALUE, true))).toEqual({ totalDocs: 1 });
  expect(yield* host.read(runtime.commands.count, upperQuery(-0))).toEqual({ totalDocs: 1 });
  expect(yield* host.read(runtime.commands.count, upperQuery(0, true))).toEqual({ totalDocs: 2 });
  expect(tested.scans()).toBe(0);
  const scannedRanges = defineCmsCommand({ name: "scannedNullableRanges", mode: "read", run: Effect.fn(function* (ctx) {
    yield* ctx.nested(runtime.commands.find, { collection: "items", limit: 32 });
    // Reuse an already scanned view: residual matching must exclude null too.
    expect(yield* ctx.nested(runtime.commands.count, upperQuery(-0))).toEqual({ totalDocs: 1 });
    expect(yield* ctx.nested(runtime.commands.count, upperQuery(0, true))).toEqual({ totalDocs: 2 });
    return null;
  }) });
  yield* Effect.scoped(Effect.gen(function* () {
    const reader = yield* Effect.acquireRelease(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, scannedRanges] }, tested.hooks), value => value.close);
    yield* reader.read(scannedRanges, null);
  }));
  expect(tested.scans()).toBe(1);
});

export const concurrentNullableScenario = Effect.fn("NullablePayload.concurrent")(function* (tested: IndexedPayloadFixture, nullKey: boolean) {
  const { host, runtime } = tested;
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const held = defineCmsCommand({ name: "heldNullableInsert", mode: "write", run: Effect.fn(function* (ctx) {
    const result = yield* ctx.nested(runtime.commands.create, { collection: "items", data: {
      title: "held", category: "red", alias: nullKey ? null : "same", amount: null,
    } });
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(release);
    return result;
  }) });
  const pending = yield* Effect.acquireRelease(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, held] }), value => value.close);
  yield* Effect.gen(function* () {
    const fiber = yield* pending.run(pending.newRequestKey(), held, null).pipe(Effect.result, Effect.forkScoped);
    yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
    yield* host.run(host.newRequestKey(), runtime.commands.create, { collection: "items", data: {
      title: "competitor", category: "red", alias: nullKey ? null : "same", amount: null,
    } });
    const before = yield* Effect.promise(tested.inventory);
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(fiber);
    if (nullKey) {
      expect(Result.isSuccess(result)).toBe(true);
      expect((yield* Effect.promise(tested.inventory)).claims).toHaveLength(2);
    } else {
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      expect(yield* Effect.promise(tested.inventory)).toEqual(before);
    }
  }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(20_000));
});
