import { eq, getTableName } from "drizzle-orm";
import { Cause, Effect, Result, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { projectScopeIdUuidV1, ScopeIdSchema, ScopeEpochSchema } from "flarex-protocol/storage-authority";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { fxSystemCommitPayloadPreferenceDeletions } from "../../persistence-postgres/src/frameworks/payloadPreferences/factsSchema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { installOneCommitResponseFault } from "./support/postgresCommitResponseFault";
import { cmsLimits } from "../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/commit/point/errors";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency, fxSystemScopeClocks } from "../../persistence-postgres/src/database/schema";
import { insertInitialScopeClockInTransactionResult } from "../../persistence-postgres/src/scope/scopeClockInitialization";
import { captureFrameworkSchemaAvailabilityHistory, captureFrameworkSchemaAvailabilityHead } from "../../persistence-postgres/src/installation/frameworkSchema/installation/canonical";
import { appendFrameworkSchemaAvailabilityHistoryInTransactionEffect } from "../../persistence-postgres/src/installation/frameworkSchema/installation/availabilityHistoryRepository";
import { compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect } from "../../persistence-postgres/src/installation/frameworkSchema/installation/availabilityHeadRepository";
type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
const collections = [{ slug: "articles", fields: [{ name: "title", type: "text", required: true }] }];
const document = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const execution = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }));
async function valueOf(input: unknown) {
  return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(execution(input).result.result))).value;
}
async function seedPreferences(fixture: Fixture, id: string, count = 2) {
  const preferences = fixture.payloadPreferences;
  if (preferences === undefined) throw new Error("Missing preferences installation");
  const scope = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
  await fixture.currency.persistence.drizzle.insert(preferences.table).values(Array.from({ length: count }, (_, index) => ({
    scope, generation: fixture.application.authority.storageGeneration, id: `preference-${index}`,
    key: `collection-articles-${id}`, userCollection: "users", userId: "editor", value: { retained: true },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  })));
}
async function inventory(fixture: Fixture) {
  if (fixture.payloadPreferences === undefined) throw new Error("Missing preferences installation");
  const db = fixture.currency.persistence.drizzle;
  return { preferences: await db.select().from(fixture.payloadPreferences.table).orderBy(fixture.payloadPreferences.table.id),
    facts: await db.select().from(fxSystemCommitPayloadPreferenceDeletions).where(
      eq(fxSystemCommitPayloadPreferenceDeletions.scopeUuid, projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid)) };
}
async function committed(fixture: Fixture) {
  const db = fixture.currency.persistence.drizzle;
  const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
  return { rows: await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid)),
    revisions: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid)),
    commits: await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)),
    outcomes: await db.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scopeUuid)),
    clocks: await db.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid)) };
}
async function assertDeletionFacts(fixture: Fixture, documentId: string, count: number) {
  const facts = (await inventory(fixture)).facts;
  expect(facts).toHaveLength(count);
  const identity = decodeAppDocumentIdentityV1(documentId);
  const first = facts[0];
  if (first === undefined) throw new Error("Missing actual deletion facts");
  const header = (await committed(fixture)).commits.find(commit => commit.commitSeq === first.commitSeq);
  expect(header).toMatchObject({ payloadPreferenceDeletionCount: count, scopeUuid: first.scopeUuid, epochUuid: first.epochUuid });
  for (const fact of facts) {
    expect([...fact.contentRowId]).toEqual([...appRowIdHexV1ToBytes(identity.rowId)]);
    expect(fact).toMatchObject({ commitSeq: first.commitSeq, epochUuid: first.epochUuid,
    scopeUuid: projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid, contentTableId: identity.tableId,
    storageGeneration: fixture.application.authority.storageGeneration,
    artifactSha256: fixture.payloadPreferences?.availability.installation.installation.frame.identity.artifact.artifactSha256 });
  }
}
function typedFailure(input: unknown) {
  if (!Cause.isCause(input) || input.reasons.length !== 1) throw new Error("Expected one typed failure", { cause: input });
  const reason = input.reasons[0];
  if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Expected one typed failure", { cause: input });
  return reason.error;
}
async function deletionRoot(driver: typeof drivers[number], suffix: string, tail = "", preferenceCount = 2) {
  let articleId = "";
  const fixture = await createMixedMutationProductFixture({ driver, suffix, payloadProfile: "ordinary",
    payloadCollections: collections, payloadPreferences: true,
    applicationSource: (seed, participant) => `export default { users: { create: { isMutation: true, isPublic: true,
      _handler: async ctx => {
        const id = await ctx.db.insert("users", { name: "Deletion root" });
        await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(seed.updateInput)});
        const deleted = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-delete",
          { collection: "articles", id: ${JSON.stringify(articleId)} });
        ${tail.replaceAll("PARTICIPANT", JSON.stringify(participant))}
        return { id, deleted };
      } } } };` });
  let fresh: Fixture | undefined;
  try {
    articleId = document(await fixture.runStandalonePayloadCommand(commands => commands.create,
      { collection: "articles", data: { title: "Mixed delete" } })).id;
    await seedPreferences(fixture, articleId, preferenceCount);
    fresh = await fixture.openCompetingFiniteFixture(`${suffix}-fresh`);
    return { fixture, fresh, articleId, close: async () => { try { await fresh?.close(); } finally { await fixture.close(); } } };
  } catch (cause) { try { await fresh?.close(); } finally { await fixture.close(); } throw cause; }
}
describe.each(drivers)("Native Payload delete with preferences on %s", driver => {
  it("deletes committed content and exact matching preferences in a standalone command", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-delete-standalone-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true });
    try {
      const article = document(await fixture.runStandalonePayloadCommand(commands => commands.create,
        { collection: "articles", data: { title: "Delete me" } }));
      await seedPreferences(fixture, article.id);
      const preferences = fixture.payloadPreferences;
      if (preferences === undefined) throw new Error("Missing preferences installation");
      const template = (await inventory(fixture)).preferences[0];
      if (template === undefined) throw new Error("Missing preference seed");
      const foreignScope = ScopeIdSchema.make(`scope_${randomUUID()}`);
      await fixture.currency.persistence.drizzle.transaction(async tx => {
        Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, { scopeId: foreignScope,
          initialEpoch: ScopeEpochSchema.make(`epoch_${randomUUID()}`) }));
      });
      await fixture.currency.persistence.drizzle.insert(preferences.table).values([
        { ...template, id: "other-collection", key: `collection-other-${article.id}` },
        { ...template, id: "other-generation", generation: "unrelated-generation" },
        { ...template, id: "other-scope", scope: projectScopeIdUuidV1(foreignScope).scopeUuid },
      ]);
      expect((await inventory(fixture)).facts).toHaveLength(0);
      await fixture.runStandalonePayloadCommand(commands => commands.delete, { collection: "articles", id: article.id });
      await expect(fixture.readCurrentApplicationDocument(article.id)).rejects.toThrow("Missing committed Application document");
      const after = await inventory(fixture);
      expect(after.preferences.map(row => row.id).sort()).toEqual(["other-collection", "other-generation", "other-scope"]);
      expect(after.facts.map(fact => fact.preferenceId).sort()).toEqual(["preference-0", "preference-1"]);
      await assertDeletionFacts(fixture, article.id, 2);
    } finally { await fixture.close(); }
  }, 180_000);

  it("keeps cleanup pending until the mixed root publishes and replays it once", async () => {
    let articleId = "";
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-delete-mixed-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true,
      applicationSource: (seed, participant) => `export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => {
          const id = await ctx.db.insert("users", { name: "Deletion root" });
          await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(seed.updateInput)});
          const deleted = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-delete",
            { collection: "articles", id: ${JSON.stringify(articleId)} });
          return { id, deleted };
        } } } };` });
    let fresh: Fixture | undefined;
    try {
      articleId = document(await fixture.runStandalonePayloadCommand(commands => commands.create,
        { collection: "articles", data: { title: "Mixed delete" } })).id;
      await seedPreferences(fixture, articleId);
      fresh = await fixture.openCompetingFiniteFixture(`payload-delete-fresh-${driver}`);
      const before = await inventory(fixture);
      const value = await valueOf(await fresh.runExecution());
      expect(await inventory(fixture)).toEqual(before);
      expect(await fixture.readCurrentApplicationDocument(articleId)).toMatchObject({ title: "Mixed delete" });
      expect(await fresh.publish(value)).toMatchObject({ kind: "published" });
      expect((await inventory(fixture)).preferences).toHaveLength(0);
      expect((await inventory(fixture)).facts).toHaveLength(2);
      await assertDeletionFacts(fixture, articleId, 2);
      await expect(fixture.readCurrentApplicationDocument(articleId)).rejects.toThrow("Missing committed Application document");
      const calls = new Map(fresh.nativeInvokeCount);
      expect(await fresh.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(fresh.nativeInvokeCount).toEqual(calls);
      expect((await inventory(fixture)).facts).toHaveLength(2);
    } finally { try { await fresh?.close(); } finally { await fixture.close(); } }
  }, 180_000);

  it.each(["uncaught", "caught"] as const)("rolls back deletion and all mixed work after a %s late failure", async failure => {
    const root = await deletionRoot(driver, `payload-delete-${failure}-${driver}`, failure === "uncaught"
      ? 'await ctx.privateMixed.call(PARTICIPANT, "payload-create", { collection: "articles", data: { title: null } });'
      : 'try { await ctx.privateMixed.call(PARTICIPANT, "payload-create", { collection: "articles", data: { title: null } }); } catch {}');
    try {
      const before = await committed(root.fixture);
      const preferences = await inventory(root.fixture);
      await expect(root.fresh.runExecution()).rejects.toThrow();
      expect(root.fresh.nativeInvokeCount.get("payload-delete")).toBe(1);
      expect(await committed(root.fixture)).toEqual(before);
      expect(await inventory(root.fixture)).toEqual(preferences);
      await expect(Effect.runPromise(root.fresh.freeze(null))).rejects.toMatchObject({ reason: "journalFailed" });
    } finally { await root.close(); }
  }, 180_000);

  it("rolls back every domain when cleanup exceeds its bounded identity budget", async () => {
    const root = await deletionRoot(driver, `payload-delete-overflow-${driver}`, "", cmsLimits.identities + 1);
    try {
      const before = await committed(root.fixture);
      const preferences = await inventory(root.fixture);
      const value = await valueOf(await root.fresh.runExecution());
      const failure = await Effect.runPromise(Effect.flip(await root.fresh.preparePublication(value)));
      expect(failure).toMatchObject({ _tag: "CmsTransactionError", reason: "limitExceeded" });
      expect(await committed(root.fixture)).toEqual(before);
      expect(await inventory(root.fixture)).toEqual(preferences);
    } finally { await root.close(); }
  }, 180_000);

  it("retries the whole root after a concurrent content change and cleans up once", async () => {
    const root = await deletionRoot(driver, `payload-delete-retry-${driver}`);
    try {
      const value = await valueOf(await root.fresh.runExecution());
      await root.fixture.runStandalonePayloadCommand(commands => commands.update,
        { collection: "articles", id: root.articleId, data: { title: "Changed concurrently" } });
      const before = await committed(root.fixture);
      const preferences = await inventory(root.fixture);
      const conflict = await root.fresh.prepareOccPublication(value).then(work => Effect.runPromise(work))
        .then(() => null, (cause: unknown) => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      expect(await committed(root.fixture)).toEqual(before);
      expect(await inventory(root.fixture)).toEqual(preferences);
      expect(await root.fresh.retryWholeAttempt(conflict)).toMatchObject({ kind: "published" });
      expect(root.fresh.nativeInvokeCount.get("payload-delete")).toBe(2);
      expect((await inventory(root.fixture)).preferences).toHaveLength(0);
      expect((await inventory(root.fixture)).facts).toHaveLength(2);
    } finally { await root.close(); }
  }, 180_000);

  it("supports create then native delete with no final content row and a real empty preference match", async () => {
    const publicationSql: string[] = [];
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-delete-new-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true,
      hooks: { observeSql: (phase, statement) => { if (phase === "publish") publicationSql.push(statement); } },
      applicationSource: (_seed, participant) => `export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => {
          const article = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
            { collection: "articles", data: { title: "Temporary" } });
          await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-delete", { collection: "articles", id: article.id });
          return article;
        } } } };` });
    try {
      const value = await valueOf(await fixture.runExecution());
      const article = document(value);
      expect(await fixture.publish(value)).toMatchObject({ kind: "published" });
      await expect(fixture.readCurrentApplicationDocument(article.id)).rejects.toThrow("Missing committed Application document");
      expect(await inventory(fixture)).toEqual({ preferences: [], facts: [] });
      if (fixture.payloadPreferences === undefined) throw new Error("Missing preferences installation");
      const preferenceTable = getTableName(fixture.payloadPreferences.table);
      // This fixture's SQL observer is PGlite-only. Both drivers above prove
      // the actual no-final-row outcome; this lane also observes the query.
      expect(fixture.hasSqlObserver).toBe(driver === "pglite");
      if (driver === "pglite") expect(publicationSql.filter(statement => /select[\s\S]*for update/i.test(statement) &&
        statement.includes(preferenceTable))).toHaveLength(1);
    } finally { await fixture.close(); }
  }, 180_000);

  it("refuses native delete without lifecycle authority", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-delete-disabled-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections });
    try {
      const article = document(await fixture.runStandalonePayloadCommand(commands => commands.create,
        { collection: "articles", data: { title: "Retained" } }));
      const before = await committed(fixture);
      const failure = await fixture.runStandalonePayloadCommand(commands => commands.delete, { collection: "articles", id: article.id })
        .then(() => null, (cause: unknown) => cause);
      expect(typedFailure(failure)).toMatchObject({ reason: "unsupportedProfile" });
      expect(await committed(fixture)).toEqual(before);
    } finally { await fixture.close(); }
  }, 180_000);

  it("refuses publication and standalone use after lifecycle readiness is withdrawn", async () => {
    const root = await deletionRoot(driver, `payload-delete-withdraw-${driver}`);
    try {
      const value = await valueOf(await root.fresh.runExecution());
      const before = await committed(root.fixture);
      const preferences = await inventory(root.fixture);
      const availability = root.fixture.payloadPreferences?.availability;
      if (availability === undefined) throw new Error("Missing preferences installation");
      // The fixture's maintenance owner alone changes protected readiness.
      await root.fixture.currency.testOwner.drizzle.transaction(tx => Effect.runPromise(Effect.gen(function* () {
        const history = yield* captureFrameworkSchemaAvailabilityHistory({ readiness: availability.readiness.readiness,
          previous: availability.history.history, status: "withdrawn", reasonSha256: "f".repeat(64),
          recordedAt: "2026-10-21T00:00:00.000Z" });
        const stored = yield* appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(tx,
          availability.readiness, availability.history, history);
        yield* compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(tx, availability, stored,
          yield* captureFrameworkSchemaAvailabilityHead(stored.history));
      })));
      const failure = await Effect.runPromise(Effect.flip(await root.fresh.preparePublication(value)));
      expect(failure).toBeDefined();
      const standalone = await root.fixture.runStandalonePayloadCommand(commands => commands.delete,
        { collection: "articles", id: root.articleId }).then(() => null, (cause: unknown) => cause);
      expect(typedFailure(standalone)).toMatchObject({ reason: "invalidAuthority" });
      expect(await committed(root.fixture)).toEqual(before);
      expect(await inventory(root.fixture)).toEqual(preferences);
    } finally { await root.close(); }
  }, 180_000);

  it.skipIf(driver !== "postgres")("recovers cleanup facts after losing the real COMMIT response", async () => {
    const root = await deletionRoot(driver, `payload-delete-recovery-${driver}`);
    try {
      const value = await valueOf(await root.fresh.runExecution());
      const before = await committed(root.fixture);
      const calls = new Map(root.fresh.nativeInvokeCount);
      const publication = await root.fresh.preparePublication(value);
      const fault = await installOneCommitResponseFault(root.fresh, before.commits.length,
        () => { throw new Error("Payload delete COMMIT response lost"); });
      expect(await Effect.runPromise(publication).finally(fault.restore)).toMatchObject({ kind: "replayed" });
      expect(fault.fired()).toBe(true);
      expect((await inventory(root.fixture)).preferences).toHaveLength(0);
      expect((await inventory(root.fixture)).facts).toHaveLength(2);
      expect(root.fresh.nativeInvokeCount).toEqual(calls);
      expect(await root.fresh.replayPublication()).toMatchObject({ kind: "replayed" });
    } finally { await root.close(); }
  }, 180_000);
});
