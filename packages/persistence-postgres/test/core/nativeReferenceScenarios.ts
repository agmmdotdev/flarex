import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../../payload-adapter/src/runtime";
import { inspectPayloadRuntimeForTest } from "../../../payload-adapter/src/testing";
import { payloadPostsCollectionDefinition } from "../../../payload-adapter/src/testing/profiles";
import { createCorePayloadFixture } from "../../../payload-adapter/test/support/core-payload-fixture";
import { makeCmsNativeBinding } from "../../src/frameworks/cmsTransaction/nativeBinding";
import { makePayloadPreferenceNativeDefinition, payloadPreferenceCleanupCommand, payloadPreferenceLogicalSchemaInput } from "../../src/frameworks/payloadPreferences/nativeSource";
import { makePayloadPreferenceNativeCleanup } from "../../src/frameworks/payloadPreferences/nativeCleanup";
import { defineCmsCommand, getCmsCommand } from "../../src/frameworks/cmsTransaction/commands";
import type { CoreError } from "../../src/core/api";
import { makeCoreNativeDefinition, makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { coreNativeFixtureData } from "./nativeFixtureInventory";
import { barrier, overlappingSnapshotRace } from "../integration/payload/payloadRelationScenario";
import { expectNativeFailedWrite, nativePreference } from "../integration/payload/payloadNativeRelationFixture";

function id(value: Json): string {
  if (!isJsonObject(value) || typeof value.id !== "string") throw new Error("Expected real Payload document");
  return value.id;
}

export function registerCoreNativeReferenceScenarios(driver: "pglite" | "postgres") {
  it("refuses authentic native scalar/default/index/unique policy drift even on empty content", async () => {
    const scalar = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition()]));
    const relation = payloadPostsCollectionDefinition("payload.content-relations");
    const variants = [
      { ...relation, fields: relation.fields.map(field => "name" in field && field.name === "score" ? { ...field, defaultValue: 99 } : field) },
      { ...relation, fields: relation.fields.map(field => "name" in field && field.name === "score" ? { ...field, type: "text", defaultValue: "0" } : field) },
      { ...relation, indexes: [{ fields: ["score", "enabled"] }] },
      { ...relation, fields: relation.fields.map(field => {
        if (!("name" in field) || field.name !== "title" || !("unique" in field)) return field;
        const { unique: _unique, ...plain } = field;
        return plain;
      }) },
    ];
    const compiled = await Promise.all(variants.map(definition => Effect.runPromise(compilePayloadCollections([definition]))));
    const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, { compiled: scalar, makeRuntime: () => makePayloadRuntime(scalar) });
    try {
      const before = await fixture.inventory();
      for (const candidate of compiled) {
        await expect(fixture.prepareSuccessor(candidate)).rejects.toMatchObject({ reason: "unsupportedCapability" });
        expect(await fixture.inventory()).toEqual(before);
        expect(await fixture.run(fixture.reader.count({ collection: "posts" }))).toEqual({ totalDocs: 0 });
      }
      const changedExposure = await fixture.run(makeCoreNativeDefinition({ source: scalar.sourceContract,
        scopeUuid: fixture.definition.identity.scopeUuid, epochUuid: fixture.definition.identity.epochUuid, applicationRead: true }));
      expect(await fixture.run(Effect.flip(fixture.database.prepareSchema({ native: changedExposure })))).toMatchObject({ reason: "unsupportedCapability" });
      expect(await fixture.inventory()).toEqual(before);
    } finally { await fixture.close(); }
  }, 120_000);

  it("uses the entire candidate overlay and true incoming EOF, including net-zero native sources", async () => {
    const compiled = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition("payload.content-relations")]));
    const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, { compiled, preferences: true, makeRuntime: () => makePayloadRuntime(compiled) });
    const { run } = fixture;
    try {
      const commands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
      const create = (title: string, relatedPost?: string) => run(fixture.writer.create(fixture.writer.newRequestKey(), { collection: "posts", data: { title, publishedAt: "2026-01-01", ...(relatedPost === undefined ? {} : { relatedPost }) } }));
      const target = id(await create("two-incoming-target"));
      const first = id(await create("two-incoming-first", target));
      const second = id(await create("two-incoming-second", target));
      let bodies = 0;
      const remove = defineCmsCommand({ name: "reference-overlay-delete", mode: "write", run: Effect.fn(function* (ctx, both) {
        bodies++;
        yield* ctx.nested(commands.delete, { collection: "posts", id: first });
        if (both === true) yield* ctx.nested(commands.delete, { collection: "posts", id: second });
        return yield* ctx.nested(commands.delete, { collection: "posts", id: target });
      }) });
      const host = await run(fixture.openHost([remove]));
      const before = await fixture.inventory();
      // Suppressing the first fetched source must reveal the second survivor.
      const failedKey = host.newRequestKey();
      expect(await run(Effect.result(host.run(failedKey, remove, false)))).toMatchObject({ failure: { reason: "relationDeleteRestricted" } });
      expect(bodies).toBe(1);
      const refused = await fixture.inventory();
      expect(coreNativeFixtureData(refused)).toEqual(coreNativeFixtureData(before));
      expect(refused.outcomes).toHaveLength(before.outcomes.length + 1);
      expect(refused.outcomes.find(outcome => outcome.value.key === failedKey)?.value).toMatchObject({ state: "failed" });
      expect(await run(Effect.flip(host.run(failedKey, remove, false)))).toMatchObject({ reason: "requestConflict" });
      expect(bodies).toBe(1);
      expect(await fixture.inventory()).toEqual(refused);
      await run(host.run(host.newRequestKey(), remove, true));
      expect(bodies).toBe(2);
      const removed = await fixture.inventory();
      expect(removed.revisions).toHaveLength(before.revisions.length + 3);
      expect(removed.outcomes).toHaveLength(refused.outcomes.length + 1);
      expect(new Set(removed.revisions.slice(before.revisions.length).map(row => row.timestamp)).size).toBe(1);
      const netzero = defineCmsCommand({ name: "reference-insert-delete-netzero", mode: "write", run: Effect.fn(function* (ctx) {
        const created = yield* ctx.nested(commands.create, { collection: "posts", data: { title: "netzero-source", publishedAt: "2026-01-01", relatedPost: target } });
        return yield* ctx.nested(commands.delete, { collection: "posts", id: id(created) });
      }) });
      const netzeroHost = await run(fixture.openHost([netzero]));
      const netzeroKey = netzeroHost.newRequestKey();
      const netzeroResult = await run(netzeroHost.run(netzeroKey, netzero, null));
      expect(netzeroResult).toMatchObject({ title: "netzero-source", relatedPost: target });
      const afterNetzero = await fixture.inventory();
      expect(afterNetzero.rows).toEqual(removed.rows);
      const netzeroId = encodeBytesToLowercaseHex(Result.getOrThrow(decodeDocumentId(id(netzeroResult))).internalId);
      const tombstones = afterNetzero.revisions.filter(revision => revision.id === netzeroId);
      expect(tombstones).toHaveLength(1);
      const netzeroOutcome = afterNetzero.outcomes.find(outcome => outcome.value.key === netzeroKey);
      expect(netzeroOutcome?.value.state).toBe("committed");
      expect(tombstones[0]).toMatchObject({ deleted: true, previous: null, value: null, timestamp: netzeroOutcome?.timestamp });
      expect(afterNetzero.revisions.filter(revision => revision.id !== netzeroId)).toEqual(removed.revisions);
      expect(afterNetzero.indexes).toEqual(removed.indexes);
      expect(afterNetzero.outcomes).toHaveLength(removed.outcomes.length + 1);
      const self = defineCmsCommand({ name: "reference-self-create", mode: "write", run: Effect.fn(function* (ctx) {
        const created = yield* ctx.nested(commands.create, { collection: "posts", data: { title: "self-reference", publishedAt: "2026-01-01" } });
        return yield* ctx.nested(commands.update, { collection: "posts", id: id(created), data: { relatedPost: id(created) } });
      }) });
      const selfHost = await run(fixture.openHost([self]));
      const own = await run(selfHost.run(selfHost.newRequestKey(), self, null));
      expect(own).toMatchObject({ relatedPost: id(own) });
      await run(fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: id(own) }));
      expect(await run(fixture.reader.count({ collection: "posts" }))).toEqual({ totalDocs: 0 });
    } finally { await fixture.close(); }
  }, 120_000);

  it("keeps actual native target observations separate from integrity and refuses incoming capacity exhaustion", async () => {
    const compiled = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition("payload.content-relations")]));
    let beforeFinalize: (() => Effect.Effect<void, CoreError>) | undefined;
    const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, { compiled, preferences: true, makeRuntime: () => makePayloadRuntime(compiled),
      nativeHooks: { beforeFinalize: () => beforeFinalize?.() ?? Effect.void } });
    const { run } = fixture;
    try {
      const commands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
      const target = id(await run(fixture.writer.create(fixture.writer.newRequestKey(), { collection: "posts", data: { title: "observed-target", publishedAt: "2026-01-01" } })));
      const source = id(await run(fixture.writer.create(fixture.writer.newRequestKey(), { collection: "posts", data: { title: "observed-source", publishedAt: "2026-01-01" } })));
      let bodies = 0;
      const observeAndAssign = defineCmsCommand({ name: "reference-observed-target", mode: "write", run: Effect.fn(function* (ctx) {
        bodies++;
        const observed = yield* ctx.documents.get(ctx.context, ctx.transactionId, target, "posts");
        expect(observed).toMatchObject({ _id: target, score: 0 });
        return yield* ctx.nested(commands.update, { collection: "posts", id: source, data: { relatedPost: target } });
      }) });
      const host = await run(fixture.openHost([observeAndAssign]));
      const entered = barrier<void>(), release = barrier<void>();
      beforeFinalize = () => { beforeFinalize = undefined; return Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.promise(() => release.promise))); };
      const key = host.newRequestKey();
      const results = await run(overlappingSnapshotRace(host.run(key, observeAndAssign, null),
        fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: target, data: { score: 5 } }), entered.promise, () => release.resolve()));
      expect(results[0]).toMatchObject({ value: { failure: { reason: "writeConflict" } } });
      expect(results[1]).toMatchObject({ value: expect.objectContaining({ success: expect.anything() }) });
      expect(bodies).toBe(1);
      expect(await run(Effect.result(host.run(key, observeAndAssign, null)))).toMatchObject({ failure: { reason: "requestConflict" } });
      expect(bodies).toBe(1);
      await run(fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data: { relatedPost: target } }));
      await run(fixture.writer.create(fixture.writer.newRequestKey(), { collection: "posts", data: { title: "capacity-source", publishedAt: "2026-01-01", relatedPost: target } }));
      const before = await fixture.inventory();
      const readCommand = getCmsCommand(commands.findByID);
      if (readCommand === undefined) throw new Error("Missing actual native read command");
      const limited = await run(Effect.acquireUseRelease(fixture.database.beginNative(fixture.binding, { commandName: readCommand.name,
        ...coreNativeTestBudget(), limits: { maxIdentities: 1, maxDocumentBytes: 65_536 } }),
      operation => operation.operations.incomingReferences("relatedPost", target, { limit: 16 }).pipe(Effect.result), operation => operation.abort()));
      expect(limited).toMatchObject({ failure: { reason: "capacity" } });
      expect(await fixture.inventory()).toEqual(before);
    } finally { await fixture.close(); }
  }, 120_000);

  it("authenticates installed cleanup and opaque native deletion evidence", async () => {
    const compiled = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition("payload.content-relations")]));
    const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, { compiled, preferences: true, makeRuntime: () => makePayloadRuntime(compiled) });
    const { run } = fixture;
    try {
      const preferences = fixture.preferences, preferencesBinding = fixture.preferencesBinding, bundle = fixture.bundle;
      if (preferences === undefined || preferencesBinding === undefined || bundle === undefined) throw new Error("Missing installed cleanup authority");
      const producer = await run(makePayloadPreferenceNativeDefinition(fixture.definition.identity));
      expect(producer.source.key).toBe("payload-preferences");
      expect(producer.source.writeProfile).toBe("payload.preferences");
      if (producer.source.definition.kind !== "relational") throw new Error("Expected genuine preference model metadata");
      expect(producer.source.definition.schema.tables[0]?.columns.map(column => column.identity.columnId).toSorted())
        .toEqual(["created_at", "id", "key", "updated_at", "user_collection", "user_id", "value"]);
      const newBinding = await run(fixture.database.bindNative({ definition: fixture.definition }));
      const forged = Object.freeze({ ...preferences });
      const input = { database: fixture.database, binding: fixture.binding, hostRuntime: fixture.hostRuntime,
        identityAndAccessPolicy: { profile: "cleanup-proof-test" } };
      // Use the real host runtime owner; neither a clone nor another binding inherits the cap.
      expect(await run(Effect.result(makeCmsNativeBinding({ ...input, preferences: forged })))).toMatchObject({ failure: { reason: "invalidAuthority" } });
      expect(await run(Effect.result(makeCmsNativeBinding({ ...input, binding: newBinding, preferences })))).toMatchObject({ failure: { reason: "invalidAuthority" } });
      const genuineAgain = await run(makePayloadPreferenceNativeCleanup({ database: fixture.database, bundle,
        contentBinding: newBinding, preferencesBinding }));
      expect(genuineAgain).not.toBe(preferences);
      expect(forged).not.toBe(preferences);
      const created = id(await run(fixture.writer.create(fixture.writer.newRequestKey(), { collection: "posts", data: { title: "opaque-delete", publishedAt: "2026-01-01" } })));
      await fixture.seedPreferences([nativePreference("opaque-delete-pref", `collection-posts-${created}`)]);
      const invalidCleanup = defineCmsCommand({ name: "native-cleanup-selector", mode: "write", run: (ctx, mode) => {
        const context = mode === "foreign-context" ? { ...ctx.context } : ctx.context;
        const collection = mode === "wrong-collection" ? "unbound" : "posts";
        const key = mode === "wrong-selector" ? `collection-users-${created}` : `collection-posts-${created}`;
        return ctx.preferences.deleteForPendingDocument(context, ctx.transactionId, collection, { key: { in: [key] } }).pipe(Effect.as(null));
      } });
      const invalidHost = await run(fixture.openHost([invalidCleanup]));
      for (const mode of ["wrong-collection", "wrong-selector", "foreign-context"] as const) {
        const rejectedKey = invalidHost.newRequestKey();
        await expectNativeFailedWrite(fixture, rejectedKey, invalidHost.run(rejectedKey, invalidCleanup, mode),
          mode === "foreign-context" ? "invalidAuthority" : "invalidInput");
      }
      const command = getCmsCommand(inspectPayloadRuntimeForTest(fixture.runtime).commands.delete);
      if (command === undefined) throw new Error("Missing native delete command");
      const first = await run(fixture.database.beginNative(fixture.binding, { commandName: command.name, ...coreNativeTestBudget() }));
      const second = await run(fixture.database.beginNative(fixture.binding, { commandName: command.name, ...coreNativeTestBudget() }));
      try {
        expect(await run(Effect.result(first.operations.pendingDelete("posts", created)))).toMatchObject({ failure: { reason: "authorityRevoked" } });
        await run(first.operations.delete(created));
        const proof = await run(first.operations.pendingDelete("posts", created));
        await run(first.operations.assertPendingDelete("posts", created, proof));
        expect(await run(Effect.result(first.operations.assertPendingDelete("posts", created, { ...proof })))).toMatchObject({ failure: { reason: "authorityRevoked" } });
        await run(second.operations.delete(created));
        expect(await run(Effect.result(second.operations.assertPendingDelete("posts", created, proof)))).toMatchObject({ failure: { reason: "authorityRevoked" } });
      } finally { await run(first.abort()); await run(second.abort()); }
      expect(await run(fixture.reader.findByID({ collection: "posts", id: created }))).toMatchObject({ id: created });
      expect(producer.commands.map(entry => entry.name)).toEqual([payloadPreferenceCleanupCommand]);
    } finally { await fixture.close(); }
  }, 120_000);

  it("refuses cleanup authority for an authentic installed preference source with an altered key index", async () => {
    const target = { scopeUuid: "45000000-0000-4000-8000-000000000001", epochUuid: "45000000-0000-4000-8000-000000000002" };
    const expected = await Effect.runPromise(makePayloadPreferenceNativeDefinition(target));
    const input = payloadPreferenceLogicalSchemaInput();
    const schema = Result.getOrThrow(normalizeRelationalSchema({ ...input, tables: input.tables.map(table => ({ ...table,
      indexes: table.indexes.map(index => ({ ...index, columns: index.columns.map(column => column === "key" ? "user_id" : column) })),
    })) }));
    const { sourceSha256: _sourceSha256, ...sourceInput } = expected.source;
    const source = await Effect.runPromise(captureLogicalSchemaSource({ ...sourceInput, definition: { kind: "relational", schema } }));
    if (!isJsonObject(source.evidence) || source.evidence.provenance === undefined) throw new Error("Missing authentic preference provenance");
    const altered = await Effect.runPromise(makeCoreRelationalNativeDefinition({ ...target, source,
      provenance: source.evidence.provenance, applicationRead: expected.applicationRead,
      commands: expected.commands.map(command => ({ name: command.name, mode: command.mode })) }));
    expect(altered.metadata).not.toBe(expected.metadata);
    const compiled = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition("payload.content-relations")]));
    const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, { compiled, preferenceDefinition: altered, makeRuntime: () => makePayloadRuntime(compiled) });
    const { run } = fixture;
    try {
      const bundle = fixture.bundle, preferencesBinding = fixture.preferencesBinding;
      if (bundle === undefined || preferencesBinding === undefined) throw new Error("Altered preference source was not installed");
      const installed = await run(fixture.database.readNativeBinding(preferencesBinding));
      const content = await run(fixture.database.readNativeBinding(fixture.binding));
      expect(installed.definition.metadata).toBe(altered.metadata);
      expect(installed.definition.tables[0]?.indexes?.find(index => index.nativeId === "preferences.key")?.fields).toEqual(["user_id"]);
      expect(installed.schemaId).toBe(content.schemaId);
      expect(installed.authorityEpoch).toBe(content.authorityEpoch);
      expect(installed.commands.map(command => ({ name: command.name, mode: command.mode })))
        .toEqual([{ name: payloadPreferenceCleanupCommand, mode: "write" }]);
      expect(fixture.preferences).toBeUndefined();
      const created = id(await run(fixture.writer.create(fixture.writer.newRequestKey(), {
        collection: "posts", data: { title: "altered-preferences-survivor", publishedAt: "2026-01-01" },
      })));
      await fixture.seedPreferences([nativePreference("altered-model-pref", `collection-posts-${created}`)]);
      const before = await fixture.inventory();
      let bodies = 0;
      const refusal = await run(Effect.result(makePayloadPreferenceNativeCleanup({ database: fixture.database, bundle,
        contentBinding: fixture.binding, preferencesBinding }).pipe(
        Effect.flatMap(preferences => makeCmsNativeBinding({ database: fixture.database, binding: fixture.binding,
          hostRuntime: fixture.hostRuntime, identityAndAccessPolicy: { profile: "altered-preference-model" }, preferences })),
        Effect.flatMap(binding => fixture.runtime.bindNative(binding)),
        Effect.flatMap(writer => Effect.sync(() => { bodies++; }).pipe(Effect.andThen(
          writer.delete(writer.newRequestKey(), { collection: "posts", id: created })))),
      )));
      expect(refusal).toMatchObject({ failure: { reason: "invalidAuthority" } });
      expect(bodies).toBe(0);
      expect(await fixture.inventory()).toEqual(before);
      expect(await run(fixture.reader.findByID({ collection: "posts", id: created }))).toMatchObject({ id: created });
      expect(before.rows.some(row => row.value.id === "altered-model-pref")).toBe(true);
    } finally { await fixture.close(); }
  }, 120_000);
}
