import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Cause, Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { projectScopeIdUuidV1, ScopeIdSchema, ScopeEpochSchema } from "flarex-protocol/storage-authority";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes, AppRowIdHexV1Schema, decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency, fxSystemScopeClocks } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { installOneCommitResponseFault } from "./support/postgresCommitResponseFault";
import { insertInitialScopeClockInTransactionResult } from "../../persistence-postgres/src/scope/scopeClockInitialization";
import { selectScopeClockRows } from "../../persistence-postgres/src/scope/scopeClock";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/commit/point/errors";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
const collections = [
  { slug: "writers-room", fields: [{ name: "name", type: "text", required: true }] },
  { slug: "articles", fields: [
    { name: "headline", type: "text", required: true },
    { name: "author", type: "relationship", relationTo: "writers-room" },
  ] },
];
const decodeSuccess = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }));
const decodeIds = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
  article: Schema.Struct({ id: Schema.String }), author: Schema.Struct({ id: Schema.String }) }));
const decodeDocument = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const seedAuthor = async (fixture: Fixture) => decodeDocument(await fixture.runStandalonePayloadCommand(commands => commands.create,
  { collection: "writers-room", data: { name: "Committed author" } }));
const removeAuthor = (fixture: Fixture, id: string) => fixture.runStandalonePayloadCommand(commands => commands.delete,
  { id, collection: "writers-room" });

function referenceSource(participant: string | undefined, target: string, populate = false) {
  if (participant === undefined) throw new Error("Missing Payload participant");
  return `export default { users: { create: { isMutation: true, isPublic: true,
    _handler: async (ctx) => {
      const article = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
        { collection: "articles", data: { headline: "Reference only", author: ${JSON.stringify(target)} } });
      const read = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-findByID",
        { collection: "articles", id: article.id, depth: ${populate ? 1 : 0} });
      return { article, read };
    }
  } } };`;
}
async function successfulValue(execution: unknown) {
  const success = decodeSuccess(execution);
  return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
}
async function publishedCounts(fixture: Fixture) {
  const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
  const db = fixture.currency.persistence.drizzle;
  return {
    rows: (await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid))).length,
    commits: (await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid))).length,
    outcomes: (await db.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scopeUuid))).length,
    events: (await db.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid))).length,
  };
}
function applicationSource(seed: Fixture["seed"], participant: string | undefined, tail = "") {
  if (participant === undefined) throw new Error("Missing Payload participant");
  return `export default { users: { create: { isMutation: true, isPublic: true,
    _handler: async (ctx) => {
      const id = await ctx.db.insert("users", { name: "before" });
      await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(seed.updateInput)});
      const author = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
        { collection: "writers-room", data: { name: "Ada" } });
      const article = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
        { collection: "articles", data: { headline: "Pending article", author: author.id } });
      await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-update",
        { collection: "writers-room", id: author.id, data: { name: "Ada edited" } });
      const populated = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-findByID",
        { collection: "articles", id: article.id, depth: 1 });
      await ctx.db.patch(id, { name: populated.author.name });
      ${tail}
      return { id, article, author, populated };
    }
  } } };`;
}
describe.each(drivers)("Payload optional-one relationships in one Worker mutation on %s", driver => {
  it("clears a committed reference and natively deletes its target in the same mixed root", async () => {
    let authorId = "", articleId = "";
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-relation-delete-root-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true,
      applicationSource: (_seed, participant) => `export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => {
          await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-update",
            { collection: "articles", id: ${JSON.stringify(articleId)}, data: { author: null } });
          return await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-delete",
            { collection: "writers-room", id: ${JSON.stringify(authorId)} });
        } } } };` });
    let fresh: Fixture | undefined;
    try {
      authorId = (await seedAuthor(fixture)).id;
      articleId = decodeDocument(await fixture.runStandalonePayloadCommand(commands => commands.create,
        { collection: "articles", data: { headline: "Committed article", author: authorId } })).id;
      fresh = await fixture.openCompetingFiniteFixture(`payload-relation-delete-fresh-${driver}`);
      const value = await successfulValue(await fresh.runExecution());
      expect(await fixture.readCurrentApplicationDocument(articleId)).toMatchObject({ author: authorId });
      expect(await fresh.publish(value)).toMatchObject({ kind: "published" });
      expect(await fixture.readCurrentApplicationDocument(articleId)).not.toHaveProperty("author");
      await expect(fixture.readCurrentApplicationDocument(authorId)).rejects.toThrow("Missing committed Application document");
      expect(fresh.nativeInvokeCount.get("payload-delete")).toBe(1);
    } finally { try { await fresh?.close(); } finally { await fixture.close(); } }
  }, 180_000);

  it("populates pending cross-collection changes and publishes one replayable outcome", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-relations-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true, applicationSource });
    try {
      const before = await publishedCounts(fixture);
      const value = await successfulValue(await fixture.runExecution());
      const ids = decodeIds(value);
      expect(value).toMatchObject({ article: { author: ids.author.id },
        populated: { author: { id: ids.author.id, name: "Ada edited" } } });
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.publish(value)).toMatchObject({ kind: "published" });
      expect(await fixture.readCurrentApplicationDocument(ids.article.id)).toMatchObject({ author: ids.author.id });
      expect(await fixture.readCurrentApplicationDocument(ids.author.id)).toMatchObject({ name: "Ada edited" });
      expect(await fixture.readCurrentApplicationDocument(ids.id)).toMatchObject({ name: "Ada edited" });
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
      expect(await publishedCounts(fixture)).toEqual({ rows: before.rows + 3, commits: before.commits + 1,
        outcomes: before.outcomes + 1, events: before.events + 1 });
      const calls = new Map(fixture.nativeInvokeCount);
      expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(fixture.nativeInvokeCount).toEqual(calls);
    } finally { await fixture.close(); }
  }, 180_000);

  it("preserves omitted references and supports reassignment and explicit null clearing", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-relation-clear-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true });
    try {
      const p = JSON.stringify(fixture.payload?.profile.participant);
      const value = await successfulValue(await fixture.runExecution(applicationSource(fixture.seed, fixture.payload?.profile.participant, `
        const other = await ctx.privateMixed.call(${p}, "payload-create", { collection: "writers-room", data: { name: "Grace" } });
        await ctx.privateMixed.call(${p}, "payload-update", { collection: "articles", id: article.id, data: { author: other.id } });
        await ctx.privateMixed.call(${p}, "payload-update", { collection: "articles", id: article.id, data: { headline: "Retained reference" } });
        const retained = await ctx.privateMixed.call(${p}, "payload-findByID", { collection: "articles", id: article.id, depth: 1 });
        await ctx.privateMixed.call(${p}, "payload-update", { collection: "articles", id: article.id, data: { author: null } });
        const cleared = await ctx.privateMixed.call(${p}, "payload-findByID", { collection: "articles", id: article.id, depth: 1 });
        return { id, article, author, other, retained, cleared };
      `)));
      const ids = decodeIds(value);
      expect(value).toMatchObject({ retained: { headline: "Retained reference", author: { name: "Grace" } }, cleared: { author: null } });
      expect(await fixture.publish(value)).toMatchObject({ kind: "published" });
      expect(await fixture.readCurrentApplicationDocument(ids.article.id)).not.toHaveProperty("author");
      // Both the reassigned and cleared reverse memberships must disappear.
      await removeAuthor(fixture, ids.author.id);
      const other = decodeDocument(Schema.decodeUnknownSync(Schema.Struct({ other: Schema.Unknown }))(value).other);
      await removeAuthor(fixture, other.id);
    } finally { await fixture.close(); }
  }, 180_000);

  it("rejects a wrong-table reference and poisons caught failure after mixed pending work", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-relation-wrong-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true });
    try {
      const before = await publishedCounts(fixture);
      const product = await fixture.readCurrentProduct();
      const p = JSON.stringify(fixture.payload?.profile.participant);
      await expect(fixture.runExecution(applicationSource(fixture.seed, fixture.payload?.profile.participant, `
        try { await ctx.privateMixed.call(${p}, "payload-update",
          { collection: "articles", id: article.id, data: { author: article.id } }); } catch {}
      `))).rejects.toThrow();
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(2);
      expect(fixture.bridgeFailures.join("\n")).toContain("documentInvalid");
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.readCurrentProduct()).toEqual(product);
      await expect(Effect.runPromise(fixture.freeze(null))).rejects.toMatchObject({ reason: "journalFailed" });
    } finally { await fixture.close(); }
  }, 180_000);

  it("rolls back all domains after a late native validation failure", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-relation-rollback-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true });
    try {
      const before = await publishedCounts(fixture);
      const product = await fixture.readCurrentProduct();
      const p = JSON.stringify(fixture.payload?.profile.participant);
      await expect(fixture.runExecution(applicationSource(fixture.seed, fixture.payload?.profile.participant, `
        await ctx.privateMixed.call(${p}, "payload-update",
          { collection: "articles", id: article.id, data: { headline: null } });
      `))).rejects.toThrow();
      expect(fixture.nativeInvokeCount.get("payload-findByID")).toBe(1);
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.readCurrentProduct()).toEqual(product);
      await expect(Effect.runPromise(fixture.freeze(null))).rejects.toMatchObject({ reason: "journalFailed" });
    } finally { await fixture.close(); }
  }, 180_000);

  it.each(["missing", "foreignScope"] as const)("refuses a %s target at final settlement", async kind => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-relation-${kind.toLowerCase()}-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true });
    try {
      const author = await seedAuthor(fixture);
      const identity = decodeAppDocumentIdentityV1(author.id);
      let target: string = appDocumentIdV1FromRowIdentity({ tableId: identity.tableId, rowId: AppRowIdHexV1Schema.make("f".repeat(32)) });
      if (kind === "foreignScope") {
        const db = fixture.currency.persistence.drizzle;
        const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
        const rowId = appRowIdHexV1ToBytes(identity.rowId);
        const template = (await db.select().from(fxAppRowRevisions).where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
          eq(fxAppRowRevisions.tableId, identity.tableId), eq(fxAppRowRevisions.rowId, rowId))))[0];
        if (template === undefined) throw new Error("Missing foreign scope seed");
        const foreignScope = ScopeIdSchema.make(`scope_${randomUUID()}`);
        const foreignUuid = projectScopeIdUuidV1(foreignScope).scopeUuid;
        await db.transaction(async tx => {
          Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, { scopeId: foreignScope, initialEpoch: ScopeEpochSchema.make(`epoch_${randomUUID()}`) }));
          const clock = (await selectScopeClockRows(tx).where(eq(fxSystemScopeClocks.scopeUuid, foreignUuid)))[0];
          if (clock?.epochUuid == null) throw new Error("Missing foreign scope clock");
          await tx.insert(fxAppRowRevisions).values({ ...template, scopeUuid: foreignUuid, writeEpochUuid: clock.epochUuid });
          await tx.insert(fxAppRowCurrent).values({ scopeUuid: foreignUuid, tableId: identity.tableId, rowId, commitSeq: template.commitSeq });
          await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: template.commitSeq }).where(eq(fxSystemScopeClocks.scopeUuid, foreignUuid));
        });
        await removeAuthor(fixture, author.id);
        target = author.id;
      }
      const before = await publishedCounts(fixture);
      const value = await successfulValue(await fixture.runExecution(referenceSource(fixture.payload?.profile.participant, target)));
      const failure = await Effect.runPromise(Effect.flip(await fixture.preparePublication(value)));
      expect(failure).toMatchObject({ _tag: "ScopePublicationReferenceConstraintError", reason: "targetNotLive" });
      expect(await publishedCounts(fixture)).toEqual(before);
      const article = decodeDocument(Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Unknown }))(value).article);
      await expect(fixture.readCurrentApplicationDocument(article.id)).rejects.toThrow("Missing committed Application document");
    } finally { await fixture.close(); }
  }, 180_000);

  it.each(["deleteFirst", "referenceFirst"] as const)("enforces the target-delete race with %s", async order => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-relation-${order.toLowerCase()}-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true });
    try {
      const author = await seedAuthor(fixture);
      const value = await successfulValue(await fixture.runExecution(referenceSource(fixture.payload?.profile.participant, author.id)));
      if (order === "deleteFirst") {
        await removeAuthor(fixture, author.id);
        const before = await publishedCounts(fixture);
        const failure = await Effect.runPromise(Effect.flip(await fixture.preparePublication(value)));
        expect(failure).toMatchObject({ _tag: "ScopePublicationReferenceConstraintError", reason: "targetNotLive" });
        expect(await publishedCounts(fixture)).toEqual(before);
        await expect(fixture.readCurrentApplicationDocument(author.id)).rejects.toThrow("Missing committed Application document");
      } else {
        expect(await fixture.publish(value)).toMatchObject({ kind: "published" });
        const before = await publishedCounts(fixture);
        const failure: unknown = await removeAuthor(fixture, author.id).then(() => null, (cause: unknown) => cause);
        if (!Cause.isCause(failure)) throw new Error("Expected the standalone host's full Cause", { cause: failure });
        expect(failure.reasons).toHaveLength(1);
        const reason = failure.reasons[0];
        if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Expected one typed deletion restriction", { cause: failure });
        expect(reason.error).toMatchObject({ reason: "relationDeleteRestricted" });
        expect(await publishedCounts(fixture)).toEqual(before);
        expect(await fixture.readCurrentApplicationDocument(author.id)).toMatchObject({ name: "Committed author" });
      }
      if (driver === "postgres") {
        const observations = fixture.standalonePayloadPgConnections;
        expect(observations.length).toBeGreaterThanOrEqual(2);
        for (const connection of observations) expect(connection.standalonePid).not.toBe(connection.primaryTargetPid);
      }
      expect(fixture.nativeInvokeCount.get("update") ?? 0).toBe(0);
    } finally { await fixture.close(); }
  }, 180_000);

  it("retries the whole root after a populated committed target changes", async () => {
    let authorId = "";
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-relation-retry-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true,
      applicationSource: (_seed, participant) => referenceSource(participant, authorId, true) });
    let fresh: Fixture | undefined;
    try {
      authorId = (await seedAuthor(fixture)).id;
      // The original root predates the seed. Start a genuine new snapshot;
      // never patch its snapshot token or make the harness emulate reads.
      fresh = await fixture.openCompetingFiniteFixture(`payload-relation-fresh-${driver}`);
      const value = await successfulValue(await fresh.runExecution());
      expect(value).toMatchObject({ read: { author: { name: "Committed author" } } });
      await fixture.runStandalonePayloadCommand(commands => commands.update,
        { collection: "writers-room", id: authorId, data: { name: "Concurrent author" } });
      const before = await publishedCounts(fixture);
      const conflict = await fresh.prepareOccPublication(value).then(work => Effect.runPromise(work))
        .then(() => null, (cause: unknown) => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fresh.retryWholeAttempt(conflict)).toMatchObject({ kind: "published" });
      expect(fresh.retryReturnedValues[0]).toMatchObject({ read: { author: { name: "Concurrent author" } } });
      expect(fresh.nativeInvokeCount.get("payload-create")).toBe(2);
      expect(fresh.nativeInvokeCount.get("update") ?? 0).toBe(0);
      expect(await publishedCounts(fixture)).toEqual({ rows: before.rows + 1, commits: before.commits + 1,
        outcomes: before.outcomes + 1, events: before.events });
    } finally { try { await fresh?.close(); } finally { await fixture.close(); } }
  }, 180_000);

  it.skipIf(driver !== "postgres")("recovers referenced rows after losing the real COMMIT response", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-relation-recovery-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true, applicationSource });
    try {
      const value = await successfulValue(await fixture.runExecution());
      const before = await publishedCounts(fixture);
      const calls = new Map(fixture.nativeInvokeCount);
      const publication = await fixture.preparePublication(value);
      const fault = await installOneCommitResponseFault(fixture, before.commits,
        () => { throw new Error("Payload relation COMMIT response lost"); });
      expect(await Effect.runPromise(publication).finally(fault.restore)).toMatchObject({ kind: "replayed" });
      expect(fault.fired()).toBe(true);
      const ids = decodeIds(value);
      expect(await fixture.readCurrentApplicationDocument(ids.article.id)).toMatchObject({ author: ids.author.id });
      expect(await fixture.readCurrentApplicationDocument(ids.author.id)).toMatchObject({ name: "Ada edited" });
      expect(await publishedCounts(fixture)).toEqual({ rows: before.rows + 3, commits: before.commits + 1,
        outcomes: before.outcomes + 1, events: before.events + 1 });
      expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(fixture.nativeInvokeCount).toEqual(calls);
    } finally { await fixture.close(); }
  }, 180_000);
});
