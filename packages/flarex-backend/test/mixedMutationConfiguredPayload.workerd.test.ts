import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { fxAppRowCurrent, fxSystemCommits, fxSystemIdempotency } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/commit/point/errors";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { installOneCommitResponseFault } from "./support/postgresCommitResponseFault";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
const collections = [
  { slug: "articles", fields: [
    { name: "headline", type: "text", required: true, unique: true },
    { name: "rank", type: "number", required: true, defaultValue: 2, index: true },
    { name: "summary", type: "text" },
  ], indexes: [{ fields: ["headline", "rank"], unique: true }] },
  { slug: "editor-notes", fields: [
    { name: "label", type: "text", required: true, unique: true },
    { name: "approved", type: "checkbox", required: true, defaultValue: false },
  ] },
];

const decodeSuccess = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }));
const decodeDocuments = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
  article: Schema.Struct({ id: Schema.String }), note: Schema.Struct({ id: Schema.String }) }));

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

function applicationSource(seed: Fixture["seed"], participant: string | undefined, tail = "", mode: "mixed" | "content" = "mixed") {
  if (participant === undefined) throw new Error("Missing configured Payload participant");
  return `export default { users: { create: { isMutation: true, isPublic: true,
    _handler: async (ctx) => {
      ${mode === "mixed" ? `const id = await ctx.db.insert("users", { name: "before" });
      await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(seed.updateInput)});
      const pending = await ctx.privateMixed.call("medusa.product", "retrieve", ${JSON.stringify(seed.retrieveInput)});`
    : `const pending = { title: ${JSON.stringify(seed.newTitle)} };`}
      const article = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
        { collection: "articles", data: { headline: pending.title } });
      const note = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
        { collection: "editor-notes", data: { label: pending.title } });
      const updated = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-update",
        { collection: "articles", id: article.id, data: { rank: 7, summary: "edited" } });
      const final = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-findByID",
        { collection: "articles", id: article.id });
      const approved = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-update",
        { collection: "editor-notes", id: note.id, data: { approved: true } });
      const finalNote = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-findByID",
        { collection: "editor-notes", id: note.id });
      ${mode === "mixed" ? `await ctx.db.patch(id, { name: final.headline + ":" + final.rank + ":" + finalNote.approved });`
    : "const id = article.id;"}
      ${tail}
      return { id, article, note, updated, final, approved, finalNote };
    }
  } } };`;
}

describe.each(drivers)("configured scalar Payload collections in one real Worker mutation on %s", driver => {
  it("routes both native collections, observes pending state and publishes one replayable outcome", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `configured-payload-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, applicationSource });
    try {
      const before = await publishedCounts(fixture);
      const returned = await successfulValue(await fixture.runExecution());
      expect(returned).toMatchObject({
        article: { headline: fixture.seed.newTitle, rank: 2, summary: null },
        note: { label: fixture.seed.newTitle, approved: false },
        final: { headline: fixture.seed.newTitle, rank: 7, summary: "edited" },
        finalNote: { label: fixture.seed.newTitle, approved: true },
      });
      const ids = decodeDocuments(returned);
      expect(decodeAppDocumentIdentityV1(ids.article.id).tableId)
        .not.toBe(decodeAppDocumentIdentityV1(ids.note.id).tableId);
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.publish(returned)).toMatchObject({ kind: "published" });
      const after = await publishedCounts(fixture);
      expect(after).toEqual({ rows: before.rows + 3, commits: before.commits + 1,
        outcomes: before.outcomes + 1, events: before.events + 1 });
      expect(await fixture.readCurrentApplicationDocument(ids.id))
        .toMatchObject({ name: fixture.seed.newTitle + ":7:true" });
      expect(await fixture.readCurrentApplicationDocument(ids.article.id))
        .toMatchObject({ headline: fixture.seed.newTitle, rank: 7, summary: "edited" });
      expect(await fixture.readCurrentApplicationDocument(ids.note.id))
        .toMatchObject({ label: fixture.seed.newTitle, approved: true });
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
      const calls = new Map(fixture.nativeInvokeCount);
      expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(await publishedCounts(fixture)).toEqual(after);
      expect(fixture.nativeInvokeCount).toEqual(calls);
      expect(fixture.payload?.runtimeHistory).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 180_000);

  it("rolls back both collections and Product when a late native unique check rejects", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `configured-payload-unique-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections });
    try {
      const before = await publishedCounts(fixture);
      const product = await fixture.readCurrentProduct();
      const participant = fixture.payload?.profile.participant;
      const tail = `await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
        { collection: "articles", data: { headline: final.headline } });`;
      await expect(fixture.runExecution(applicationSource(fixture.seed, participant, tail))).rejects.toThrow();
      expect(fixture.bridgeFailures.join("\n")).toContain("documentInvalid");
      expect(fixture.nativeInvokeCount.get("payload-update")).toBe(2);
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.readCurrentProduct()).toEqual(product);
      await expect(Effect.runPromise(fixture.freeze(null))).rejects.toMatchObject({ reason: "journalFailed" });
    } finally { await fixture.close(); }
  }, 180_000);

  it.each(["wrongCollectionId", "unconfiguredCollection", "unselectedDelete"] as const)("refuses %s after pending work without committing", async refusal => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `configured-payload-${refusal.toLowerCase()}-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections });
    try {
      const before = await publishedCounts(fixture);
      const participant = fixture.payload?.profile.participant;
      const tail = refusal === "wrongCollectionId"
        ? `await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-findByID",
          { collection: "editor-notes", id: article.id });`
        : refusal === "unconfiguredCollection"
          ? `await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
            { collection: "posts", data: { title: "not configured" } });`
          : `await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-delete",
            { collection: "articles", id: article.id });`;
      await expect(fixture.runExecution(applicationSource(fixture.seed, participant, tail))).rejects.toThrow();
      expect(fixture.nativeInvokeCount.get("payload-update")).toBe(2);
      if (refusal === "wrongCollectionId") expect(fixture.bridgeFailures.join("\n")).toContain("invalidInput");
      if (refusal === "unconfiguredCollection") expect(fixture.bridgeFailures.join("\n")).toContain("unsupportedProfile");
      if (refusal === "unselectedDelete") expect(fixture.nativeInvokeCount.get("payload-delete") ?? 0).toBe(0);
      expect(await publishedCounts(fixture)).toEqual(before);
      // Pre-admission method refusal executes no borrowed operation. Sticky
      // rollback-only assertions belong to failures after operation admission.
      if (refusal !== "unselectedDelete")
        await expect(Effect.runPromise(fixture.freeze(null))).rejects.toMatchObject({ reason: "journalFailed" });
    } finally { await fixture.close(); }
  }, 180_000);

  it("retries the complete configured mutation after a distinct-connection Product conflict", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `configured-payload-retry-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, applicationSource });
    try {
      const returned = await successfulValue(await fixture.runExecution());
      await fixture.runStandaloneProductUpdate({ title: fixture.seed.newTitle + " competing",
        handle: fixture.seed.newHandle + "-competing" });
      if (driver === "postgres") {
        const connection = fixture.standaloneProductPgConnections[0];
        if (connection === undefined) throw new Error("Missing competing PostgreSQL connection");
        expect(connection.standalonePid).not.toBe(connection.primaryTargetPid);
      }
      const before = await publishedCounts(fixture);
      const conflict = await fixture.prepareOccPublication(returned)
        .then(publication => Effect.runPromise(publication)).then(() => null, (cause: unknown) => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.retryWholeAttempt(conflict)).toMatchObject({ kind: "published" });
      expect(fixture.retryContexts).toHaveLength(1);
      expect(fixture.retryContexts[0]?.attemptFence).toBeGreaterThan(fixture.activation.anchor.attemptFence);
      const retried = decodeDocuments(fixture.retryReturnedValues[0]);
      expect(await fixture.readCurrentApplicationDocument(retried.article.id))
        .toMatchObject({ headline: fixture.seed.newTitle, rank: 7 });
      expect(await fixture.readCurrentApplicationDocument(retried.note.id))
        .toMatchObject({ label: fixture.seed.newTitle, approved: true });
      expect(await publishedCounts(fixture)).toEqual({ rows: before.rows + 3, commits: before.commits + 1,
        outcomes: before.outcomes + 1, events: before.events + 1 });
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(4);
    } finally { await fixture.close(); }
  }, 180_000);

  it("rejects a competing same-key root without publishing either losing collection", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `configured-payload-race-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections,
      applicationSource: (seed, participant) => applicationSource(seed, participant, "", "content") });
    let peer: Fixture | undefined;
    try {
      peer = await fixture.openCompetingFiniteFixture(`configured-payload-peer-${driver}`);
      const first = await successfulValue(await fixture.runExecution());
      const second = await successfulValue(await peer.runExecution());
      expect(decodeDocuments(first).article.id).not.toBe(decodeDocuments(second).article.id);
      expect(decodeDocuments(first).note.id).not.toBe(decodeDocuments(second).note.id);
      const before = await publishedCounts(fixture);
      expect(await peer.publish(second)).toMatchObject({ kind: "published" });
      const winner = await publishedCounts(fixture);
      expect(winner).toEqual({ rows: before.rows + 2, commits: before.commits + 1,
        outcomes: before.outcomes + 1, events: before.events });
      const conflict = await fixture.prepareOccPublication(first)
        .then(publication => Effect.runPromise(publication)).then(() => null, (cause: unknown) => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      expect(conflict).toMatchObject({ conflict: { kind: "finiteRootGraph", observation: { readKind: "unique" } } });
      expect(await publishedCounts(fixture)).toEqual(winner);
      const ids = decodeDocuments(second);
      expect(await fixture.readCurrentApplicationDocument(ids.article.id)).toMatchObject({ rank: 7 });
      expect(await fixture.readCurrentApplicationDocument(ids.note.id)).toMatchObject({ approved: true });
    } finally {
      try { await peer?.close(); } finally { await fixture.close(); }
    }
  }, 180_000);

  it.skipIf(driver !== "postgres")("recovers both collections after a real COMMIT response loss without native replay", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `configured-payload-response-loss-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, applicationSource });
    try {
      const returned = await successfulValue(await fixture.runExecution());
      const before = await publishedCounts(fixture);
      const calls = new Map(fixture.nativeInvokeCount);
      const publication = await fixture.preparePublication(returned);
      const fault = await installOneCommitResponseFault(fixture, before.commits,
        () => { throw new Error("Configured Payload COMMIT response lost"); });
      const result = await Effect.runPromise(publication).finally(fault.restore);
      expect(fault.fired()).toBe(true);
      expect(result).toMatchObject({ kind: "replayed" });
      const ids = decodeDocuments(returned);
      expect(await fixture.readCurrentApplicationDocument(ids.article.id)).toMatchObject({ rank: 7 });
      expect(await fixture.readCurrentApplicationDocument(ids.note.id)).toMatchObject({ approved: true });
      expect(await publishedCounts(fixture)).toEqual({ rows: before.rows + 3, commits: before.commits + 1,
        outcomes: before.outcomes + 1, events: before.events + 1 });
      expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(fixture.nativeInvokeCount).toEqual(calls);
    } finally { await fixture.close(); }
  }, 180_000);
});
