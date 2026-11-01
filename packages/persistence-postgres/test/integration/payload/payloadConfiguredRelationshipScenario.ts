import { Effect } from "effect";
import { expect } from "vitest";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../../../payload-adapter/src/runtime";
import { makePayloadAccessProbeRuntime } from "../../../../payload-adapter/src/testing/accessProbe";
import { inspectPayloadHostForTest, inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { createCorePayloadFixture } from "../../../../payload-adapter/test/support/core-payload-fixture";
import type { CoreWriteBatch } from "../../../src/core/contracts";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { makeCmsNativeBinding } from "../../../src/frameworks/cmsTransaction/nativeBinding";
import { readNativePayload, nativeTokenInvalidated, nativePreference, expectNativeFailedWrite } from "./payloadNativeRelationFixture";

function document(value: Json): JsonObject & { id: string } {
  if (!isJsonObject(value) || typeof value.id !== "string") throw new Error("Expected native Payload document");
  return { ...value, id: value.id };
}

/** Compiler -> shared native installation -> genuine Local API, over five tables. */
export async function payloadConfiguredRelationshipScenario(driver: "pglite" | "postgres", authorCollection = "authors", relationName = "author") {
  const compiled = await Effect.runPromise(compilePayloadCollections([
    { slug: authorCollection, fields: [{ name: "name", type: "text", required: true }] },
    { slug: "articles", fields: [{ name: "headline", type: "text", required: true, unique: true },
      { name: relationName, type: "relationship", relationTo: authorCollection }] },
  ]));
  const batches: CoreWriteBatch[] = [];
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, {
    compiled, preferences: true, makeRuntime: makePayloadRuntime, observeWrite: batch => batches.push(batch),
  });
  const foreign = await createCorePayloadFixture({ kind: "physical", physical: fixture.physical, installation: "fresh", instanceName: "foreign" }, {
    compiled, preferences: true, makeRuntime: makePayloadRuntime,
    scopeUuid: "45000000-0000-4000-8000-000000000003", epochUuid: "45000000-0000-4000-8000-000000000004",
  }).catch(async cause => {
    try { await fixture.close(); }
    catch (cleanup) { throw new AggregateError([cause, cleanup], "Foreign Payload fixture construction and owner cleanup failed"); }
    throw cause;
  });
  const { run } = fixture;
  try {
    const create = (args: Parameters<typeof fixture.writer.create>[1]) => run(fixture.writer.create(fixture.writer.newRequestKey(), args));
    const update = (args: Parameters<typeof fixture.writer.update>[1]) => run(fixture.writer.update(fixture.writer.newRequestKey(), args));
    const remove = (args: Parameters<typeof fixture.writer.delete>[1]) => run(fixture.writer.delete(fixture.writer.newRequestKey(), args));
    const read = (id: string, depth: 0 | 1 = 1) => run(fixture.reader.findByID({ collection: "articles", id, depth }));
    const author = document(await create({ collection: authorCollection, data: { name: "Ada" } }));
    const other = document(await create({ collection: authorCollection, data: { name: "Grace" } }));
    const foreignAuthor = document(await foreign.run(foreign.writer.create(foreign.writer.newRequestKey(), { collection: authorCollection, data: { name: "Foreign only" } })));
    const foreignBefore = await foreign.inventory();
    if (foreign.preferences === undefined) throw new Error("Missing actual foreign cleanup profile");
    expect(await run(Effect.flip(makeCmsNativeBinding({ database: fixture.database, binding: fixture.binding,
      hostRuntime: fixture.hostRuntime, identityAndAccessPolicy: { profile: "wrong-scope-cleanup" }, preferences: foreign.preferences })))).toMatchObject({ reason: "invalidAuthority" });
    expect(author).not.toHaveProperty(relationName);
    expect(author).not.toHaveProperty("relatedPost");
    const key = fixture.writer.newRequestKey();
    const input = { collection: "articles", data: { headline: "First", [relationName]: author.id } };
    const article = document(await run(fixture.writer.create(key, input)));
    const second = document(await create({ collection: "articles", data: { headline: "Second", [relationName]: author.id } }));
    const empty = document(await create({ collection: "articles", data: { headline: "Empty" } }));
    expect(article[relationName]).toBe(author.id);
    expect(empty[relationName]).toBeNull();
    const stable = await fixture.inventory();
    expect(await run(fixture.writer.create(key, input))).toEqual(article);
    expect(document(await read(article.id))[relationName]).toEqual(author);
    expect(document(await read(article.id, 0))[relationName]).toBe(author.id);
    expect(document(await run(fixture.reader.findByID({ collection: "articles", id: article.id })))[relationName]).toBe(author.id);
    expect(await run(fixture.reader.findByID({ collection: authorCollection, id: author.id, depth: 1 }))).toEqual(author);
    const page = await run(fixture.reader.find({ collection: "articles", depth: 1, limit: 32 }));
    if (!isJsonObject(page) || !Array.isArray(page.docs)) throw new Error("Expected Payload page");
    expect(page.totalDocs).toBe(3);
    for (const root of [article, second]) expect(page.docs.find(value => isJsonObject(value) && value.id === root.id)).toEqual({ ...root, [relationName]: author });
    expect(await run(fixture.reader.find({ collection: "articles", depth: 1, page: 2, limit: 1 }))).toMatchObject({ totalDocs: 3, totalPages: 3, page: 2 });
    expect(await run(fixture.reader.count({ collection: authorCollection }))).toEqual({ totalDocs: 2 });
    // Population returns a mutable detached tree, including shared loader targets.
    const populated = document(await read(article.id));
    if (!isJsonObject(populated[relationName])) throw new Error("Expected populated author");
    expect(Reflect.set(populated[relationName], "name", "Caller mutation")).toBe(true);
    expect(document(await read(article.id))[relationName]).toEqual(author);
    let refused = stable;
    for (const value of [1, { id: author.id }, [author.id]]) {
      const refusedKey = fixture.writer.newRequestKey();
      refused = await expectNativeFailedWrite(fixture, refusedKey, fixture.writer.update(refusedKey,
        { collection: "articles", id: article.id, data: { [relationName]: value } }), "relationInvalid");
    }
    const wrongTableKey = fixture.writer.newRequestKey();
    refused = await expectNativeFailedWrite(fixture, wrongTableKey, fixture.writer.update(wrongTableKey,
      { collection: "articles", id: article.id, data: { [relationName]: article.id } }), "documentInvalid");
    const foreignKey = fixture.writer.newRequestKey();
    refused = await expectNativeFailedWrite(fixture, foreignKey, fixture.writer.update(foreignKey,
      { collection: "articles", id: article.id, data: { [relationName]: foreignAuthor.id } }), "relationTargetMissing");
    const inspected = inspectPayloadHostForTest(fixture.writer);
    for (const options of [{ depth: 2 }, { depth: 1, select: { name: true } }, { depth: 1, populate: {} }, { depth: 1, locale: "en" }, { depth: 1, overrideAccess: true }]) {
      expect(await run(Effect.flip(inspected.host.read(inspected.commands.findByID, { collection: "articles", id: article.id, ...options })))).toMatchObject({ reason: "unsupportedProfile" });
    }
    expect(await run(Effect.flip(inspected.host.read(inspected.commands.find, { collection: authorCollection, depth: 1, where: { id: { in: [author.id] } } })))).toMatchObject({ reason: "invalidInput" });
    expect(await run(Effect.flip(inspected.host.run(inspected.host.newRequestKey(), inspected.commands.findByID, { collection: "articles", id: article.id, depth: 1 })))).toMatchObject({ reason: "invalidAuthority" });
    expect(await run(Effect.flip(fixture.reader.findByID({ collection: "articles", id: author.id })))).toMatchObject({ reason: "invalidInput" });
    const restrictKey = fixture.writer.newRequestKey();
    refused = await expectNativeFailedWrite(fixture, restrictKey, fixture.writer.delete(restrictKey,
      { collection: authorCollection, id: author.id }), "relationDeleteRestricted");
    // Ordinary Application operations retain no authority over managed tables.
    await run(Effect.acquireUseRelease(fixture.database.begin(), tx => Effect.gen(function* () {
      expect(yield* Effect.flip(tx.patch(article.id, { headline: "forged" }))).toMatchObject({ reason: "authorityRevoked" });
    }), tx => tx.abort()));
    expect(await fixture.inventory()).toEqual(refused);
    const unbound = await run(compilePayloadCollections([
      { slug: authorCollection, fields: [{ name: "name", type: "text", required: true }] },
      { slug: "articles", fields: [{ name: "headline", type: "text", required: true, unique: true },
        { name: `${relationName}Changed`, type: "relationship", relationTo: authorCollection }] },
    ]));
    const unboundRuntime = await run(makePayloadRuntime(unbound));
    expect(await run(Effect.result(unboundRuntime.bindNative(fixture.cmsBinding)))).toMatchObject({ failure: { reason: "invalidAuthority" } });
    // Authentic loader access cannot be borrowed for another request/collection.
    const probes = await run(makePayloadAccessProbeRuntime(compiled, { collection: authorCollection, observedId: author.id, unobservedId: other.id }));
    const guarded = await run(probes.runtime.bindNative(fixture.cmsBinding));
    for (const mode of ["unobserved", "wrong-collection", "foreign-request", "cross-write", "unbound", "projection", "locale"] as const) {
      probes.selectProbe(mode);
      expect(await run(Effect.result(guarded.findByID({ collection: "articles", id: second.id, depth: 1 })))).toMatchObject(expect.objectContaining({ failure: expect.anything() }));
    }
    const incoming = (target: string, limit = 16) => run(readNativePayload(fixture, operations => operations.incomingReferences(relationName, target, { limit })));
    const oldIncoming = await incoming(author.id);
    const newIncoming = await incoming(other.id);
    expect(oldIncoming.value).toEqual({ ids: [article.id, second.id].toSorted(), hasMore: false });
    expect(newIncoming.value).toEqual({ ids: [], hasMore: false });
    expect((await incoming(author.id, 1)).value).toMatchObject({ ids: expect.any(Array), hasMore: true });
    for (const invalid of [-1, Number.MAX_SAFE_INTEGER, 1.5]) expect(await run(Effect.result(readNativePayload(fixture,
      operations => operations.incomingReferences(relationName, author.id, { limit: invalid }))))).toMatchObject(expect.objectContaining({ failure: expect.anything() }));
    expect(await run(Effect.result(readNativePayload(fixture, operations => operations.incomingReferences("forged", author.id, { limit: 16 }))))).toMatchObject(expect.objectContaining({ failure: expect.anything() }));
    expect(await run(Effect.result(readNativePayload(fixture, operations => operations.incomingReferences(relationName, article.id, { limit: 16 }))))).toMatchObject(expect.objectContaining({ failure: expect.anything() }));
    expect(document(await update({ collection: "articles", id: article.id, data: { headline: "Renamed" } }))[relationName]).toBe(author.id);
    const beforeRetarget = batches.length;
    expect(document(await update({ collection: "articles", id: article.id, data: { [relationName]: other.id } }))[relationName]).toBe(other.id);
    expect(nativeTokenInvalidated(oldIncoming.token, batches.slice(beforeRetarget))).toBe(true);
    expect(nativeTokenInvalidated(newIncoming.token, batches.slice(beforeRetarget))).toBe(true);
    expect(document(await read(article.id))[relationName]).toEqual(other);
    expect((await incoming(author.id)).value).toEqual({ ids: [second.id], hasMore: false });
    expect((await incoming(other.id)).value).toEqual({ ids: [article.id], hasMore: false });
    expect(document(await update({ collection: "articles", id: article.id, data: { [relationName]: null } }))[relationName]).toBeNull();
    expect(document(await read(article.id))[relationName]).toBeNull();
    await fixture.seedPreferences([
      nativePreference("article-pref", `collection-articles-${second.id}`), nativePreference("author-pref", `collection-${authorCollection}-${author.id}`),
      nativePreference("unrelated-pref", `collection-articles-${article.id}`), nativePreference("prefix-pref", `collection-articles-${second.id}-extra`),
    ]);
    const commands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
    const pair = defineCmsCommand({ name: "configured-relation-delete-pair", mode: "write", run: Effect.fn(function* (ctx, args) {
      yield* ctx.nested(commands.delete, { collection: "articles", id: second.id });
      if (args === false) return yield* Effect.fail(cmsError("invalidInput"));
      return yield* ctx.nested(commands.delete, { collection: authorCollection, id: author.id });
    }) });
    const paired = await run(fixture.openHost([pair]));
    const rejectedDeleteKey = paired.newRequestKey();
    const beforeDelete = await expectNativeFailedWrite(fixture, rejectedDeleteKey,
      paired.run(rejectedDeleteKey, pair, false), "invalidInput");
    const deleteKey = paired.newRequestKey();
    const deleted = await run(paired.run(deleteKey, pair, true));
    const afterDelete = await fixture.inventory();
    expect(afterDelete.outcomes).toHaveLength(beforeDelete.outcomes.length + 1);
    expect(afterDelete.revisions).toHaveLength(beforeDelete.revisions.length + 4);
    const timestamp = afterDelete.outcomes.at(-1)?.timestamp;
    expect(afterDelete.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(4);
    expect(afterDelete.rows.filter(row => row.value.id === "article-pref" || row.value.id === "author-pref")).toEqual([]);
    expect(afterDelete.rows.filter(row => row.value.id === "unrelated-pref" || row.value.id === "prefix-pref")).toHaveLength(2);
    expect((await incoming(author.id)).value).toEqual({ ids: [], hasMore: false });
    expect(await run(paired.run(deleteKey, pair, true))).toEqual(deleted);
    expect(await fixture.inventory()).toEqual(afterDelete);
    const oldReader = fixture.reader;
    await fixture.reopen();
    expect(await run(Effect.flip(oldReader.findByID({ collection: "articles", id: article.id })))).toMatchObject({ reason: "closed" });
    expect(await run(fixture.writer.create(key, input))).toEqual(article);
    expect(await read(article.id)).toMatchObject({ id: article.id, headline: "Renamed", [relationName]: null });
    expect(await fixture.inventory()).toEqual(afterDelete);
    expect(await foreign.inventory()).toEqual(foreignBefore);
    await remove({ collection: "articles", id: empty.id });
  } finally {
    const results = await Promise.allSettled([foreign.close(), fixture.close()]);
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError(failures, "Configured Payload fixture cleanup failed");
  }
}
