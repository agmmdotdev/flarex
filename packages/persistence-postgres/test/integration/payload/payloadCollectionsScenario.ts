import { makeCmsCommandBinding } from "../../../src/frameworks/cmsTransaction/construction";
import { inspectPayloadHostForTest, inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { fxSystemScopeExecutionAuthorities } from "../../../src/database/schema";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { expect } from "vitest";
import { Effect, Result, Schema } from "effect";
import { ValidationError } from "payload";
import { cmsLimits } from "../../../src/execution/preparation/frameworkExecutionPolicy";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { projectScopeIdUuidV1Result, ScopeIdSchema, ScopeEpochSchema, StorageGenerationSchema } from "flarex-protocol/storage-authority";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../../../payload-adapter/src/runtime";
import { makePayloadContentProfiles } from "../../../../payload-adapter/src/profile";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../../src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../src/installation/frameworkSchema/binding/selection";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes,
  fxSystemCommitAppRowChanges, fxSystemScopeClocks, fxAppUniqueKeys } from "../../../src/database/schema";
import { fxSystemCommitPayloadPreferenceDeletions } from "../../../src/frameworks/payloadPreferences/factsSchema";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import { cmsHostFixture } from "../../frameworks/cmsTransaction/cmsHostFixture";
import { installPayloadPreferenceFixture } from "../../frameworks/payloadPreferences/payloadPreferenceFixture";
import { installationBindingReference } from "../../installation/frameworkSchema/frameworkDataBindingPhysicalTestSupport";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

function document(value: Json): JsonObject & { id: string } {
  if (!isJsonObject(value) || typeof value.id !== "string") throw new Error("Expected native Payload document");
  return { ...value, id: value.id };
}
const decodeGeneration = Schema.decodeUnknownEffect(StorageGenerationSchema);

/** Neither collection is a conformance fixture; the shorter slug is a prefix of the other. */
export async function payloadCollectionsScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession) {
  const definitions = [
    { slug: "news-items", fields: [
      { name: "headline", type: "text", required: true, unique: true },
      { name: "priority", type: "number", required: true, defaultValue: 2 },
      { name: "visible", type: "checkbox", required: true },
      { name: "goLive", type: "date", required: true, defaultValue: "2026-09-11T00:00:00.000Z" },
    ] },
    { slug: "news", fields: [
      { name: "sku", type: "text", required: true, unique: true },
      // Scalar fields with old fixture names must not acquire relationship semantics.
      { name: "relatedPost", type: "text", required: true, defaultValue: "plain text" },
      { name: "relatedPosts", type: "text", required: true, defaultValue: "also text" },
    ] },
  ];
  const compiled = await runEffect(compilePayloadCollections(definitions));
  const copied = { ...compiled };
  expect(await runEffectFailure(Effect.scoped(makePayloadRuntime(copied)))).toMatchObject({ reason: "unsupportedProfile" });
  expect(await runEffectFailure(makePayloadContentProfiles(copied))).toMatchObject({ reason: "unsupportedProfile" });
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing schema");
  const { fixture, target, bindings, reference, candidate: contentCandidate, payloadProfiles } = await cmsHostFixture(persistence,
    { physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } }, compiled);
  expect(fixture.manifest.schema.tables.map(table => table.name)).toEqual(["news", "news_items"]);
  expect(fixture.relation.binding.tables.map(table => table.logicalName)).toEqual(["news", "news_items"]);
  const { profile, availability, table } = await installPayloadPreferenceFixture(persistence, target, fixture.deploymentId);
  const frame = { ...contentCandidate.frame, payloadLifecycle: { ...installationBindingReference(availability), profiles: [profile.profile] } };
  const bindingInput = { database: persistence.drizzle, target,
    deploymentId: fixture.deploymentId,
    authority: fixture.authorityPorts, application: fixture.relationActivation };
  const exactBindingInput = { database: bindingInput.database, target: bindingInput.target,
    selection: { deploymentId: bindingInput.deploymentId, scopeId: fixture.authority.scopeId },
    authority: bindingInput.authority, application: bindingInput.application };
  for (const profiles of [undefined, { ...payloadProfiles }]) {
    const forged = await runEffect(makeDataBindingHost({ ...exactBindingInput, ...(profiles === undefined ? {} : { payloadProfiles: profiles }) }));
    expect(await runEffectFailure(forged.prepare(frame))).toMatchObject({ reason: "unsupportedProfile" });
  }
  const beforeBinding = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
  const candidate = await runEffect(bindings.prepare(frame));
  await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration,
    "compiled-preferences", candidate.sha256, beforeBinding.head)));
  const db = persistence.drizzle;
  const inventory = async () => ({ rows: await db.select().from(fxAppRowCurrent), revisions: await db.select().from(fxAppRowRevisions),
    commits: await db.select().from(fxSystemCommits), outcomes: await db.select().from(fxSystemIdempotency), wakes: await db.select().from(fxSystemCommitWakes),
    facts: await db.select().from(fxSystemCommitAppRowChanges), clocks: await db.select().from(fxSystemScopeClocks), unique: await db.select().from(fxAppUniqueKeys),
    preferences: await db.select().from(table), preferenceFacts: await db.select().from(fxSystemCommitPayloadPreferenceDeletions) });
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePayloadRuntime(compiled);
    expect(Object.keys(runtime)).not.toContain("commands");
    const hostInput = { hostRuntime: preparedHostTestRuntime(db), ...bindingInput, scopeId: fixture.authority.scopeId,
      session, controlDatabase: fixture.control.drizzle, pointCommitAuthority: fixture.pointCommitAuthority,
      identityAndAccessPolicy: { subject: "compiled-collection-test" }, payloadPreferenceTarget: target,
      materialization: fixture.servingOwners.materialization };
    const binding = yield* makeCmsCommandBinding({ serving: yield* fixture.makeServing(session),
      hostRuntime: hostInput.hostRuntime, identityAndAccessPolicy: hostInput.identityAndAccessPolicy,
      profile: { kind: "fullProof", payloadPreferenceTarget: hostInput.payloadPreferenceTarget } });
    const host = yield* runtime.bind(binding);
    const key = host.newRequestKey();
    const firstInput = { collection: "news-items", data: { headline: "same-value" } };
    const selected = { calls: 1, commandBytes: cmsLimits.commandBytes };
    const bounded = yield* runtime.bind(yield* makeCmsCommandBinding({ serving: yield* fixture.makeServing(session),
      hostRuntime: hostInput.hostRuntime, identityAndAccessPolicy: hostInput.identityAndAccessPolicy, requestBudget: selected,
      profile: { kind: "fullProof", payloadPreferenceTarget: target } }));
    selected.calls = cmsLimits.calls;
    expect(bounded.requestBudget.calls).toBe(1);
    const beforeBudgetRefusal = yield* Effect.promise(inventory);
    expect(yield* Effect.flip(bounded.create(bounded.newRequestKey(), firstInput)))
      .toMatchObject({ reason: "limitExceeded" });
    expect(yield* Effect.promise(inventory)).toEqual(beforeBudgetRefusal);
    yield* bounded.close;
    const first = document(yield* host.create(key, firstInput));
    expect(first).toMatchObject({ headline: "same-value", priority: 2, visible: false, goLive: "2026-09-11T00:00:00.000Z" });
    const second = document(yield* host.create(host.newRequestKey(), { collection: "news", data: { sku: "same-value" } }));
    expect(second).toMatchObject({ sku: "same-value", relatedPost: "plain text", relatedPosts: "also text" });
    expect(first.id.split(":")[0]).not.toBe(second.id.split(":")[0]);
    const stable = yield* Effect.promise(inventory);
    expect(yield* host.create(key, firstInput)).toEqual(first);
    expect(yield* Effect.flip(host.create(key, { ...firstInput, collection: "news" }))).toMatchObject({ reason: "requestConflict" });
    for (const [collection, id, unique] of [["news-items", first.id, "headline"], ["news", second.id, "sku"]] as const) {
      expect(yield* host.findByID({ collection, id })).toMatchObject({ id });
      expect(yield* host.count({ collection, where: { [unique]: { equals: "same-value" } } })).toEqual({ totalDocs: 1 });
      expect(yield* host.find({ collection, where: { id: { equals: id } }, limit: 1 })).toMatchObject({ docs: [{ id }], totalDocs: 1 });
      expect(yield* host.find({ collection, limit: cmsLimits.pageRows }))
        .toMatchObject({ docs: [{ id }], limit: cmsLimits.pageRows, totalDocs: 1 });
      expect(yield* Effect.flip(host.find({ collection, limit: cmsLimits.pageRows + 1 })))
        .toMatchObject({ reason: "unsupportedProfile" });
      const duplicate = yield* Effect.flip(host.create(host.newRequestKey(), { collection, data: { [unique]: "same-value" } }));
      expect(duplicate).toMatchObject({ reason: "documentInvalid", cause: { data: { collection, errors: [{ path: unique }] } } });
      expect(duplicate.cause).toBeInstanceOf(ValidationError);
      const missing = yield* Effect.flip(host.create(host.newRequestKey(), { collection, data: {} }));
      expect(missing).toMatchObject({ reason: "documentInvalid", cause: { data: { errors: [{ path: unique }] } } });
    }
    for (const [collection, id] of [["news-items", second.id], ["news", first.id]] as const) {
      for (const attempt of [host.findByID({ collection, id }), host.delete(host.newRequestKey(), { collection, id })]) {
        expect(yield* Effect.flip(attempt)).toMatchObject({ reason: "invalidInput" });
      }
      expect(yield* Effect.flip(host.update(host.newRequestKey(), { collection, id, data: {} }))).toMatchObject({ reason: "invalidInput" });
      for (const attempt of [host.find({ collection, where: { id: { equals: id } } }), host.count({ collection, where: { id: { equals: id } } })]) {
        expect(yield* Effect.flip(attempt)).toMatchObject({ reason: "invalidInput" });
      }
    }
    for (const input of [{}, { collection: "posts" }, { collection: "payload-preferences" }, { collection: "news-items", where: { priority: { equals: "2" } } }]) {
      yield* Effect.flip(inspectPayloadHostForTest(host).host.read(inspectPayloadHostForTest(host).commands.find, input));
    }
    expect(yield* Effect.promise(inventory)).toEqual(stable);
    expect(yield* host.update(host.newRequestKey(), { collection: "news-items", id: first.id, data: { priority: 7 } }))
      .toMatchObject({ id: first.id, priority: 7, createdAt: first.createdAt });
    expect(yield* host.update(host.newRequestKey(), { collection: "news", id: second.id, data: { relatedPost: "changed text" } }))
      .toMatchObject({ id: second.id, relatedPost: "changed text" });
    yield* host.create(host.newRequestKey(), { collection: "news-items", data: { headline: "second-headline" } });
    expect(yield* host.find({ collection: "news-items", limit: 1, page: 2 })).toMatchObject({ totalDocs: 2, totalPages: 2, page: 2 });
    expect(yield* host.count({ collection: "news" })).toEqual({ totalDocs: 1 });
    const scope = Result.getOrThrow(projectScopeIdUuidV1Result(reference.scopeId)).scopeUuid;
    const foreignScope = ScopeIdSchema.make("scope_00000000-0000-4000-8000-000000000001");
    const generation = yield* decodeGeneration(reference.storageGeneration);
    yield* Effect.promise(() => db.transaction(async tx => {
      await tx.insert(fxSystemScopeClocks).values({ scopeId: foreignScope });
      await tx.insert(fxSystemScopeExecutionAuthorities).values({ scopeId: foreignScope,
        storageGeneration: generation, epoch: ScopeEpochSchema.make(reference.epoch) });
    }));
    const seed = { scope, generation: reference.storageGeneration, userCollection: "users", userId: "user-a", value: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    yield* Effect.promise(async () => { await db.insert(table).values([
      { ...seed, id: "news-item-pref", key: `collection-news-items-${first.id}` },
      { ...seed, id: "news-pref", key: `collection-news-${second.id}` },
      { ...seed, id: "wrong-collection-pref", key: `collection-news-${first.id}` },
      { ...seed, id: "wrong-scope-pref", scope: "00000000-0000-4000-8000-000000000001", key: `collection-news-items-${first.id}` },
    ]); });
    const beforeDelete = yield* Effect.promise(inventory);
    const pair = defineCmsCommand({ name: "compiled-delete-pair", mode: "write", run: Effect.fn(function* (ctx, args) {
      yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.delete, { collection: "news-items", id: first.id });
      if (args === false) return yield* Effect.fail(cmsError("invalidInput"));
      if (args === "wrong-collection") yield* ctx.preferences.deleteForPendingDocument(ctx.context, ctx.transactionId,
        "news", { key: { in: [`collection-news-${first.id}`] } });
      return yield* ctx.nested(inspectPayloadRuntimeForTest(runtime).commands.delete, { collection: "news", id: second.id });
    }) });
    const paired = yield* makeCmsHost({ ...hostInput, expectedContentIdentity: compiled.contentIdentity, commands: [pair, ...Object.values(inspectPayloadRuntimeForTest(runtime).commands)] });
    yield* Effect.flip(paired.run(paired.newRequestKey(), pair, false));
    expect(yield* Effect.promise(inventory)).toEqual(beforeDelete);
    expect(yield* Effect.flip(paired.run(paired.newRequestKey(), pair, "wrong-collection"))).toMatchObject({ reason: "invalidAuthority" });
    expect(yield* Effect.promise(inventory)).toEqual(beforeDelete);
    const deleteKey = paired.newRequestKey();
    yield* paired.run(deleteKey, pair, true);
    const afterDelete = yield* Effect.promise(inventory);
    // Native current pointers retain tombstones; deletion is not physical row removal.
    expect(afterDelete.rows).toHaveLength(beforeDelete.rows.length);
    expect(afterDelete.revisions).toHaveLength(beforeDelete.revisions.length + 2);
    expect(afterDelete.revisions.filter(row => row.isTombstone)).toHaveLength(2);
    expect(afterDelete.commits).toHaveLength(beforeDelete.commits.length + 1);
    expect(afterDelete.facts).toHaveLength(beforeDelete.facts.length + 2);
    expect(afterDelete.preferenceFacts).toHaveLength(beforeDelete.preferenceFacts.length + 2);
    expect(afterDelete.preferences.map(value => value.id).sort()).toEqual(["wrong-collection-pref", "wrong-scope-pref"]);
    yield* paired.run(deleteKey, pair, true);
    expect(yield* Effect.promise(inventory)).toEqual(afterDelete);
    expect(yield* host.count({ collection: "news" })).toEqual({ totalDocs: 0 });
  })));
}
