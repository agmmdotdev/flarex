import { expect } from "vitest";
import { Effect, Result } from "effect";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { decodeAppDocumentIdentityV1Result, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1, ScopeIdSchema, ScopeEpochSchema } from "flarex-protocol/storage-authority";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../payload-adapter/src/runtime";
import { makePayloadComposition } from "../../payload-adapter/src/composition";
import { makeCmsHost, defineCmsCommand } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import { dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";
import { validateApplicationWriteOwnershipForCommit } from "../src/applicationWriteOwnership/Commit";
import { insertInitialScopeClockInTransactionResult } from "../src/scopeClockInitialization";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes,
  fxSystemCommitAppRowChanges, fxSystemScopeClocks, fxAppEdgeCurrent, fxAppEdgeAdjacencyVersions,
  fxSystemCommitRelationAdjacencyChanges } from "../src/schema";
import { fxSystemCommitPayloadPreferenceDeletions } from "../src/payloadPreferences/factsSchema";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { cmsHostFixture } from "./cmsHostFixture";
import { installPayloadPreferenceFixture } from "./payloadPreferenceFixture";
import { installationBindingReference } from "./frameworkDataBindingPhysicalTestSupport";
import { barrier, heldNativeRace } from "./payloadRelationScenario";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

function document(value: Json): JsonObject & { id: string } {
  if (!isJsonObject(value) || typeof value.id !== "string") throw new Error("Expected native Payload document");
  return { ...value, id: value.id };
}

/** Fresh compiler -> Analysis -> native relation readiness -> real Local API, no posts fixture. */
export async function payloadConfiguredRelationshipScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession,
  authorCollection = "authors", relationName = "author", reopen?: () => Promise<void>,
) {
  const compiled = await runEffect(compilePayloadCollections([
    { slug: authorCollection, fields: [{ name: "name", type: "text", required: true }] },
    { slug: "articles", fields: [{ name: "headline", type: "text", required: true, unique: true },
      { name: relationName, type: "relationship", relationTo: authorCollection }] },
  ]));
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing schema");
  const { fixture, target, bindings, reference, candidate: contentCandidate } = await cmsHostFixture(persistence,
    { physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } }, compiled);
  expect(reference.readiness).toMatchObject({ kind: "policy", relationCount: 1 });
  const { profile, availability, table } = await installPayloadPreferenceFixture(persistence, target, fixture.deploymentId);
  const old = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
  const candidate = await runEffect(bindings.prepare({ ...contentCandidate.frame,
    payloadLifecycle: { ...installationBindingReference(availability), profiles: [profile.profile] } }));
  await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration,
    "configured-relation-preferences", candidate.sha256, old.head)));
  const db = persistence.drizzle;
  const inventory = async () => ({ rows: await db.select().from(fxAppRowCurrent), revisions: await db.select().from(fxAppRowRevisions)
    .orderBy(fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    commits: await db.select().from(fxSystemCommits), outcomes: await db.select().from(fxSystemIdempotency), wakes: await db.select().from(fxSystemCommitWakes),
    facts: await db.select().from(fxSystemCommitAppRowChanges), clocks: await db.select().from(fxSystemScopeClocks),
    edges: await db.select().from(fxAppEdgeCurrent), adjacency: await db.select().from(fxAppEdgeAdjacencyVersions),
    relationFacts: await db.select().from(fxSystemCommitRelationAdjacencyChanges), preferences: await db.select().from(table),
    preferenceFacts: await db.select().from(fxSystemCommitPayloadPreferenceDeletions) });
  const hostInput = { database: db, controlDatabase: fixture.control.drizzle, session, deploymentId: fixture.deploymentId,
    authority: fixture.authorityPorts, application: fixture.relationActivation, pointCommitAuthority: fixture.pointCommitAuthority,
    identityAndAccessPolicy: { subject: "configured-relationship-test" }, payloadPreferenceTarget: target,
    materialization: { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle),
      developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle), uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle),
      applicationRelations: fixture.relationCommit,
      candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: fixture.candidateValidation, pointCommitAuthority: fixture.pointCommitAuthority }) } };
  const saved = await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePayloadRuntime(compiled);
    const host = yield* runtime.bind(hostInput);
    const write = (command: typeof runtime.commands.create, args: Json) => runEffect(host.run(host.newRequestKey(), command, args));
    const read = (id: string, depth = 1) => runEffect(host.read(runtime.commands.findByID, { collection: "articles", id, depth }));
    return yield* Effect.promise(async () => {
      const author = document(await write(runtime.commands.create, { collection: authorCollection, data: { name: "Ada" } }));
      const other = document(await write(runtime.commands.create, { collection: authorCollection, data: { name: "Grace" } }));
      const foreign = document(await write(runtime.commands.create, { collection: authorCollection, data: { name: "Foreign only" } }));
      const foreignIdentity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(foreign.id));
      const foreignRowId = appRowIdHexV1ToBytes(foreignIdentity.rowId);
      const foreignTemplate = (await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.rowId, foreignRowId)))[0];
      if (foreignTemplate === undefined) throw new Error("Missing foreign-scope template");
      const foreignScope = ScopeIdSchema.make(`scope_${randomUUID()}`);
      const foreignUuid = projectScopeIdUuidV1(foreignScope).scopeUuid;
      await db.transaction(async tx => {
        Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, { scopeId: foreignScope, initialEpoch: ScopeEpochSchema.make(`epoch_${randomUUID()}`) }));
        const clock = (await tx.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, foreignUuid)))[0];
        if (clock?.epochUuid == null) throw new Error("Missing foreign clock");
        await tx.insert(fxAppRowRevisions).values({ ...foreignTemplate, scopeUuid: foreignUuid, writeEpochUuid: clock.epochUuid });
        await tx.insert(fxAppRowCurrent).values({ scopeUuid: foreignUuid, tableId: foreignIdentity.tableId, rowId: foreignRowId, commitSeq: foreignTemplate.commitSeq });
        await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: foreignTemplate.commitSeq }).where(eq(fxSystemScopeClocks.scopeUuid, foreignUuid));
      });
      await write(runtime.commands.delete, { collection: authorCollection, id: foreign.id });
      expect(author).not.toHaveProperty(relationName);
      expect(author).not.toHaveProperty("relatedPost");
      const key = host.newRequestKey();
      const input = { collection: "articles", data: { headline: "First", [relationName]: author.id } };
      const article = document(await runEffect(host.run(key, runtime.commands.create, input)));
      const second = document(await write(runtime.commands.create, { collection: "articles", data: { headline: "Second", [relationName]: author.id } }));
      const empty = document(await write(runtime.commands.create, { collection: "articles", data: { headline: "Empty" } }));
      expect(article[relationName]).toBe(author.id);
      expect(empty[relationName]).toBeNull();
      const stable = await inventory();
      expect(await runEffect(host.run(key, runtime.commands.create, input))).toEqual(article);
      expect(document(await read(article.id))[relationName]).toEqual(author);
      expect(document(await read(article.id, 0))[relationName]).toBe(author.id);
      expect(document(await runEffect(host.read(runtime.commands.findByID, { collection: "articles", id: article.id })))[relationName]).toBe(author.id);
      expect(await runEffect(host.read(runtime.commands.findByID, { collection: authorCollection, id: author.id, depth: 1 }))).toEqual(author);
      const queries: string[] = [];
      const observedReads = await runEffect(makeCmsHost({ ...hostInput, commands: Object.values(runtime.commands), expectedContentIdentity: compiled.contentIdentity }, {
        documentReads: { observeQuery: query => queries.push(query.name) },
      }));
      await runEffect(observedReads.read(runtime.commands.findByID, { collection: authorCollection, id: author.id, depth: 1 }));
      expect(queries.filter(name => name === "currentDocuments")).toHaveLength(1);
      queries.length = 0;
      await runEffect(observedReads.read(runtime.commands.findByID, { collection: "articles", id: second.id, depth: 1 }));
      expect(queries.filter(name => name === "currentDocuments")).toHaveLength(2);
      const page = await runEffect(host.read(runtime.commands.find, { collection: "articles", depth: 1, limit: 32 }));
      if (!isJsonObject(page) || !Array.isArray(page.docs)) throw new Error("Expected Payload page");
      expect(page.totalDocs).toBe(3);
      for (const root of [article, second]) expect(page.docs.find(value => isJsonObject(value) && value.id === root.id))
        .toEqual({ ...root, [relationName]: author });
      expect(await runEffect(host.read(runtime.commands.find, { collection: "articles", depth: 1, page: 2, limit: 1 }))).toMatchObject({ totalDocs: 3, totalPages: 3, page: 2 });
      expect(await runEffect(host.read(runtime.commands.count, { collection: authorCollection }))).toEqual({ totalDocs: 2 });
      for (const value of [1, { id: author.id }, [author.id]]) {
        expect(await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.update, { collection: "articles", id: article.id, data: { [relationName]: value } })))
          .toMatchObject({ reason: "relationInvalid" });
      }
      expect(await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.update, { collection: "articles", id: article.id, data: { [relationName]: article.id } })))
        .toMatchObject({ reason: "documentInvalid" });
      expect(await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.update, { collection: "articles", id: article.id, data: { [relationName]: foreign.id } })))
        .toMatchObject({ reason: "relationTargetMissing" });
      for (const options of [{ depth: 2 }, { depth: 1, select: { name: true } }, { depth: 1, populate: {} }, { depth: 1, locale: "en" }, { depth: 1, overrideAccess: true }]) {
        expect(await runEffectFailure(host.read(runtime.commands.findByID, { collection: "articles", id: article.id, ...options }))).toMatchObject({ reason: "unsupportedProfile" });
      }
      expect(await runEffectFailure(host.read(runtime.commands.find, { collection: authorCollection, depth: 1, where: { id: { in: [author.id] } } }))).toMatchObject({ reason: "invalidInput" });
      expect(await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.findByID, { collection: "articles", id: article.id, depth: 1 }))).toMatchObject({ reason: "unsupportedProfile" });
      expect(await runEffectFailure(host.read(runtime.commands.findByID, { collection: "articles", id: author.id }))).toMatchObject({ reason: "invalidInput" });
      expect(await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.delete, { collection: authorCollection, id: author.id }))).toMatchObject({ reason: "relationDeleteRestricted" });
      for (const id of [article.id, author.id]) {
        const tableId = Result.getOrThrow(decodeAppDocumentIdentityV1Result(id)).tableId;
        expect(await db.transaction(tx => runEffect(validateApplicationWriteOwnershipForCommit(tx, {
          scopeId: fixture.authority.scopeId, generation: "application_v1", authenticatedAttemptedTables: [tableId], materialTables: [],
        }, hostInput.materialization.uniqueConstraints).pipe(Effect.result)))).toMatchObject({ _tag: "Failure", failure: { reason: "writeDenied" } });
      }
      expect(await inventory()).toEqual(stable);
      const unbound = await runEffect(compilePayloadCollections([
        { slug: authorCollection, fields: [{ name: "name", type: "text", required: true }] },
        { slug: "articles", fields: [{ name: "headline", type: "text", required: true, unique: true },
          { name: `${relationName}Changed`, type: "relationship", relationTo: authorCollection }] },
      ]));
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const unboundRuntime = yield* makePayloadRuntime(unbound);
        const unboundHost = yield* unboundRuntime.bind(hostInput);
        expect(yield* Effect.flip(unboundHost.read(unboundRuntime.commands.findByID, { collection: "articles", id: article.id, depth: 1 })))
          .toMatchObject({ reason: "invalidAuthority" });
      })));
      expect(document(await write(runtime.commands.update, { collection: "articles", id: article.id, data: { headline: "Renamed" } }))[relationName]).toBe(author.id);
      expect(document(await write(runtime.commands.update, { collection: "articles", id: article.id, data: { [relationName]: other.id } }))[relationName]).toBe(other.id);
      expect(document(await read(article.id))[relationName]).toEqual(other);
      expect(document(await write(runtime.commands.update, { collection: "articles", id: article.id, data: { [relationName]: null } }))[relationName]).toBeNull();
      expect(document(await read(article.id))[relationName]).toBeNull();

      // Test-only native access probes use the same composition owner, not an ordinary runtime escape hatch.
      let probe: "none" | "unobserved" | "wrong-collection" | "foreign-request" | "cross-write" | "unbound" | "projection" | "locale" = "none";
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const observed = yield* makePayloadComposition(compiled, { onExecute: () => {}, onCollection: () => {}, hooks: {
          afterRead: [async ({ doc, req, collection }) => {
            if (collection.slug !== "articles" || probe === "none") return doc;
            if (probe === "cross-write") await req.payload.db.create({ collection: authorCollection, data: { name: "forged" }, req });
            else await req.payload.db.find({ collection: probe === "wrong-collection" ? "articles" : probe === "unbound" ? "payload-preferences" : authorCollection,
              req: probe === "foreign-request" ? { ...req } : req,
              ...(probe === "projection" ? { select: { name: true } } : {}), ...(probe === "locale" ? { locale: "en" } : {}),
              where: { id: { in: [probe === "unobserved" ? other.id : author.id] } }, pagination: false, limit: 0, page: 1, sort: "id" });
            return doc;
          }],
        } });
        const guarded = yield* observed.runtime.bind(hostInput);
        for (const mode of ["unobserved", "wrong-collection", "foreign-request", "cross-write", "unbound", "projection", "locale"] as const) {
          probe = mode;
          yield* Effect.flip(guarded.read(observed.runtime.commands.findByID, { collection: "articles", id: second.id, depth: 1 }));
        }
      })));
      const beforeCorruption = await inventory();
      const identity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(author.id));
      const predicate = and(eq(fxAppRowRevisions.scopeUuid, projectScopeIdUuidV1(reference.scopeId).scopeUuid),
        eq(fxAppRowRevisions.tableId, identity.tableId), eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId)));
      const retained = (await db.select().from(fxAppRowRevisions).where(predicate))[0];
      if (retained === undefined || retained.isTombstone) throw new Error("Missing live target revision");
      // Deliberate corruption witness: preserve FKs and restore the exact body afterwards.
      await db.update(fxAppRowRevisions).set({ isTombstone: true, valueBytes: null, valueSha256: null }).where(predicate);
      try {
        expect(await runEffectFailure(host.read(runtime.commands.findByID, { collection: "articles", id: second.id, depth: 1 })))
          .toMatchObject({ reason: "storedCorruption", cause: { reason: "relationTargetMissing", documentId: author.id } });
      } finally {
        await db.update(fxAppRowRevisions).set({ isTombstone: retained.isTombstone, valueBytes: retained.valueBytes, valueSha256: retained.valueSha256 }).where(predicate);
      }
      expect(await inventory()).toEqual(beforeCorruption);

      if ("pool" in persistence) for (const first of ["reader", "writer"] as const) {
        const entered = barrier<void>(); const release = barrier<void>();
        const held = await runEffect(makeCmsHost({ ...hostInput, commands: Object.values(runtime.commands), expectedContentIdentity: compiled.contentIdentity }, first === "reader" ? {
          documentReads: { beforeRead: selection => selection === "batch" ? Effect.promise(async () => { entered.resolve(); await release.promise; }) : Effect.void },
        } : { afterAdmission: () => Effect.promise(async () => { entered.resolve(); await release.promise; }) }));
        const reading = (first === "reader" ? held : host).read(runtime.commands.findByID, { collection: "articles", id: second.id, depth: 1 });
        const writer = first === "writer" ? held : host;
        const writing = writer.run(writer.newRequestKey(), runtime.commands.delete, { collection: authorCollection, id: author.id });
        const results = await heldNativeRace(persistence, first === "reader" ? reading : writing, first === "reader" ? writing : reading,
          entered.promise, () => release.resolve());
        expect(results[first === "reader" ? 0 : 1]).toMatchObject({ status: "fulfilled", value: { _tag: "Success", success: { [relationName]: author } } });
        expect(results[first === "writer" ? 0 : 1]).toMatchObject({ status: "fulfilled", value: { _tag: "Failure", failure: { reason: "relationDeleteRestricted" } } });
      }
      const scope = projectScopeIdUuidV1(reference.scopeId).scopeUuid;
      const preference = { scope, generation: reference.storageGeneration, userCollection: "users", userId: "user-a",
        value: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
      await db.insert(table).values([
        { ...preference, id: "article-pref", key: `collection-articles-${second.id}` },
        { ...preference, id: "author-pref", key: `collection-${authorCollection}-${author.id}` },
      ]);
      const beforeDelete = await inventory();
      const pair = defineCmsCommand({ name: "configured-relation-delete-pair", mode: "write", run: Effect.fn(function* (ctx, args) {
        yield* ctx.nested(runtime.commands.delete, { collection: "articles", id: second.id });
        if (args === false) return yield* Effect.fail(cmsError("invalidInput"));
        return yield* ctx.nested(runtime.commands.delete, { collection: authorCollection, id: author.id });
      }) });
      const paired = await runEffect(makeCmsHost({ ...hostInput, expectedContentIdentity: compiled.contentIdentity, commands: [pair, ...Object.values(runtime.commands)] }));
      await runEffectFailure(paired.run(paired.newRequestKey(), pair, false));
      expect(await inventory()).toEqual(beforeDelete);
      const deleteKey = paired.newRequestKey();
      const deleted = await runEffect(paired.run(deleteKey, pair, true));
      const afterDelete = await inventory();
      expect(afterDelete.commits).toHaveLength(beforeDelete.commits.length + 1);
      expect(afterDelete.facts).toHaveLength(beforeDelete.facts.length + 2);
      expect(afterDelete.revisions).toHaveLength(beforeDelete.revisions.length + 2);
      expect(afterDelete.preferenceFacts).toHaveLength(beforeDelete.preferenceFacts.length + 2);
      expect(afterDelete.preferences).toHaveLength(0);
      expect(afterDelete.edges).toHaveLength(0);
      expect(await runEffect(paired.run(deleteKey, pair, true))).toEqual(deleted);
      expect(await inventory()).toEqual(afterDelete);
      return { article, key, input, host, command: runtime.commands.findByID, snapshot: afterDelete };
    });
  })));
  expect(await runEffectFailure(saved.host.read(saved.command, { collection: "articles", id: saved.article.id }))).toMatchObject({ reason: "closed" });
  await reopen?.();
  // New native instance and host reconstruct from admitted durable state, not old loader state.
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePayloadRuntime(compiled);
    const host = yield* runtime.bind(hostInput);
    expect(yield* host.run(saved.key, runtime.commands.create, saved.input)).toEqual(saved.article);
    expect(yield* host.read(runtime.commands.findByID, { collection: "articles", id: saved.article.id, depth: 1 }))
      .toMatchObject({ id: saved.article.id, headline: "Renamed", [relationName]: null });
  })));
  expect(await inventory()).toEqual(saved.snapshot);
}
