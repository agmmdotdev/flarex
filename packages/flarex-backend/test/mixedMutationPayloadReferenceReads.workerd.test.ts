import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { appDocumentIdV1FromRowIdentity, AppRowIdHexV1Schema, decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/commit/point/errors";
import { preparePrivateParticipantReadAccess } from "../../persistence-postgres/src/execution/journal/privateReadAccess";
import { inspectLogicalParticipantAdmissionBundle, inspectLogicalParticipantAttemptAdmission } from
  "../../persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { type Fixture, drivers, collections, extensions, decodeArticle, successfulValue, publishedCounts,
  commerceHost } from "./support/payloadCommerceReferenceFixture";

const decodeRead = Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ id: Schema.String,
  headline: Schema.String, featuredProduct: Schema.String }), product: Schema.Struct({ id: Schema.String, title: Schema.String }), id: Schema.String }));
function readSource(participant: string | undefined, articleId: string) {
  if (participant === undefined) throw new Error("Missing Payload participant");
  return `export default { users: { create: { isMutation: true, isPublic: true, _handler: async ctx => {
    const article = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-findByID",
      { collection: "articles", id: ${JSON.stringify(articleId)} });
    const product = await ctx.privateMixed.call("medusa.product", "retrieve", { id: article.featuredProduct });
    const id = await ctx.db.insert("users", { name: product.title });
    return { article, product, id };
  } } } };`;
}
async function seedArticle(fixture: Fixture) {
  return decodeArticle(await fixture.runStandalonePayloadCommand(commands => commands.create,
    { collection: "articles", data: { headline: "Visible article", featuredProduct: fixture.seed.productId } }));
}

describe.each(drivers)("private authorized reference reads on %s", driver => {
  it("reads the native source and target under one admitted principal and publishes only Application consumption", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `reference-read-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions });
    let reader: Fixture | undefined;
    try {
      const article = await seedArticle(fixture);
      reader = await fixture.openCompetingFiniteFixture(`reference-reader-${driver}`,
        { privateReferenceRead: { articleIds: [article.id], productIds: [fixture.seed.productId] } });
      const before = await publishedCounts(fixture);
      const value = await successfulValue(await reader.runExecution(readSource(reader.payload?.profile.participant, article.id)));
      const result = decodeRead(value);
      expect(result.article).toMatchObject({ headline: "Visible article", featuredProduct: fixture.seed.productId });
      expect(result.product.id).toBe(fixture.seed.productId);
      const request = reader.getAdmittedRequest("medusa.product", "retrieve");
      if (request === undefined) throw new Error("Missing authorized Product read request");
      expect(await Effect.runPromise(reader.runAdmitted(request))).toMatchObject({ id: result.product.id });
      const bundle = await Effect.runPromise(reader.store.admitLogicalParticipantsEffect(reader.persistenceAttempt, {
        participant: "medusa.product", operationMethods: ["retrieve"], profileRevision: reader.productProfileRevision,
        sources: [{ selection: reader.prepared, application: reader.active.selection, methods: ["retrieve"] }] }));
      const admitted = inspectLogicalParticipantAdmissionBundle(bundle, reader.persistenceAttempt,
        "medusa.product", "retrieve", reader.productProfileRevision);
      const admission = admitted?.admissions[0];
      const state = admission === undefined ? null : inspectLogicalParticipantAttemptAdmission(admission, reader.persistenceAttempt, "retrieve");
      if (admitted === null || state === null) throw new Error("Missing genuine authorized read admission");
      const changedGrant = await Effect.runPromise(preparePrivateParticipantReadAccess({
        principal: { scopeId: state.root.scopeId, principalDigest: state.root.principalDigest },
        participant: "medusa.product", sourceKey: state.sourceKey, nativeProfileRevision: "f".repeat(64), method: "retrieve", ids: [] }));
      let nativeBorrowed = false;
      const refused = await Effect.runPromise(Effect.flip(changedGrant.bind(() => {
        nativeBorrowed = true; return Effect.die(new Error("A changed grant must not borrow the original admission"));
      })({ attempt: reader.persistenceAttempt, bundle, admissions: admitted.admissions, method: "retrieve", pendingRows: [] })));
      expect(refused).toMatchObject({ kind: "rejection", cause: { reason: "invalidAuthority" } });
      expect(nativeBorrowed).toBe(false);
      expect(await reader.publish(value)).toMatchObject({ kind: "published" });
      expect(await fixture.readCurrentApplicationDocument(result.id)).toMatchObject({ name: result.product.title });
      expect(await publishedCounts(fixture)).toMatchObject({ rows: before.rows + 1, revisions: before.revisions + 1,
        rowFacts: before.rowFacts + 1, events: before.events });
      expect(reader.nativeInvokeCount.get("payload-findByID")).toBe(1);
      expect(reader.nativeInvokeCount.get("retrieve")).toBe(1);
    } finally { try { await reader?.close(); } finally { await fixture.close(); } }
  }, 180_000);

  it("refuses hidden, missing, forged and foreign-principal reads without leaking targets or publishing consumption", async () => {
      const responses: unknown[] = [];
      const fixture = await createMixedMutationProductFixture({ driver, suffix: `reference-read-denied-${driver}`,
        payloadProfile: "ordinary", payloadCollections: collections, extensions,
        hooks: { onExecutionResponse: response => { responses.push(response); } } });
      let reader: Fixture | undefined;
      const host = await commerceHost(fixture);
      try {
        const article = await seedArticle(fixture);
        const identity = decodeAppDocumentIdentityV1(article.id);
        for (const scenario of ["sourceDenied", "targetDenied", "sourceMissing", "targetMissing", "wrongPrincipal", "wrongScope", "forgedAccess", "sourceWrite", "targetWrite", "targetSoftDeleted"] as const) {
        if (scenario === "targetSoftDeleted") await Effect.runPromise(host.run(host.newRequestKey(),
          fixture.product.runtime.commands.internalProductSoftDelete, fixture.seed.productId));
        const requestedId = scenario === "sourceMissing" ? appDocumentIdV1FromRowIdentity({ tableId: identity.tableId,
          rowId: AppRowIdHexV1Schema.make("f".repeat(32)) }) : article.id;
        reader = await fixture.openCompetingFiniteFixture(`reference-reader-${scenario}-${driver}`, { privateReferenceRead: {
          articleIds: scenario === "sourceDenied" ? [] : [requestedId],
          productIds: scenario === "targetDenied" ? [] : [scenario === "targetMissing" ? "missing-product" : fixture.seed.productId],
          ...(scenario === "wrongPrincipal" ? { principalDigest: "0".repeat(64) } : {}),
          ...(scenario === "wrongScope" ? { scopeId: ScopeIdSchema.make("scope_reference_other_shop") } : {}),
        } });
        const before = await publishedCounts(fixture);
        let source = readSource(reader.payload?.profile.participant, requestedId);
        if (scenario === "targetMissing") source = source.replace("id: article.featuredProduct", 'id: "missing-product"');
        if (scenario === "forgedAccess") source = source.replace('collection: "articles", id:', 'collection: "articles", overrideAccess: true, context: { flarexPrivateReferenceRead: {} }, user: { role: "admin" }, id:');
        if (scenario === "sourceWrite") source = source.replace('"payload-findByID"', '"payload-update"');
        if (scenario === "targetWrite") source = source.replace('"retrieve"', '"update"');
        await expect(reader.runExecution(source)).rejects.toBeDefined();
        expect(responses.at(-1), scenario).toEqual({ kind: "error", name: "PointMutationExactRuntimeJournalBoundaryV1Error",
          message: "Exact point-mutation journal boundary failed.", cause: "The journal RPC capability is unavailable." });
        expect(await publishedCounts(fixture)).toEqual(before);
        if (scenario !== "sourceWrite" && scenario !== "targetWrite")
          await expect(Effect.runPromise(reader.freeze(null))).rejects.toMatchObject({ reason: "journalFailed" });
        expect(reader.nativeInvokeCount.get("retrieve") ?? 0).toBe(scenario === "targetSoftDeleted" || scenario === "targetMissing" ? 1 : 0);
        expect(reader.nativeInvokeCount.get("update") ?? 0).toBe(0);
        expect(reader.nativeInvokeCount.get("payload-update") ?? 0).toBe(0);
        if (scenario === "wrongPrincipal" || scenario === "wrongScope")
          expect(reader.nativeInvokeCount.get("payload-findByID") ?? 0).toBe(0);
        await reader.close(); reader = undefined;
        }
        await Effect.runPromise(host.run(host.newRequestKey(), fixture.product.runtime.commands.internalProductRestore, fixture.seed.productId));
        reader = await fixture.openCompetingFiniteFixture(`reference-restored-reader-${driver}`, {
          privateReferenceRead: { articleIds: [article.id], productIds: [fixture.seed.productId] } });
        const restored = await successfulValue(await reader.runExecution(readSource(reader.payload?.profile.participant, article.id)));
        expect(decodeRead(restored).product.id).toBe(fixture.seed.productId);
        expect(await reader.publish(restored)).toMatchObject({ kind: "published" });
      } finally {
        try { await reader?.close(); } finally { try { await Effect.runPromise(host.close); } finally { await fixture.close(); } }
      }
    }, 300_000);

  it("retries authorized reads after native source and target changes using fresh dependencies", async () => {
    let articleId = "";
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `reference-read-conflict-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions,
      applicationSource: (_seed, participant) => readSource(participant, articleId) });
    let reader: Fixture | undefined;
    try {
      articleId = (await seedArticle(fixture)).id;
      for (const changed of ["source", "target"] as const) {
        reader = await fixture.openCompetingFiniteFixture(`reference-reader-conflict-${changed}-${driver}`,
          { privateReferenceRead: { articleIds: [articleId], productIds: [fixture.seed.productId] } });
        const value = await successfulValue(await reader.runExecution());
        const discarded = decodeRead(value);
        if (changed === "source") await fixture.runStandalonePayloadCommand(commands => commands.update,
          { collection: "articles", id: articleId, data: { headline: "Changed article" } });
        else await fixture.runStandaloneProductUpdate({ title: "Changed product", handle: fixture.seed.newHandle + "-reader" });
        const before = await publishedCounts(fixture);
        const conflict = await Effect.runPromise(Effect.flip(await reader.prepareOccPublication(value)));
        expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
        expect(await publishedCounts(fixture)).toEqual(before);
        expect(await reader.retryWholeAttempt(conflict)).toMatchObject({ kind: "published" });
        const retried = decodeRead(reader.retryReturnedValues[0]);
        expect(retried.article.headline).toBe("Changed article");
        if (changed === "target") expect(retried.product.title).toBe("Changed product");
        expect(await fixture.readCurrentApplicationDocument(retried.id)).toMatchObject({ name: retried.product.title });
        await expect(fixture.readCurrentApplicationDocument(discarded.id)).rejects.toThrow("Missing committed Application document");
        expect(reader.nativeInvokeCount.get("payload-findByID")).toBe(2);
        expect(reader.nativeInvokeCount.get("retrieve")).toBe(2);
        expect(await publishedCounts(fixture)).toMatchObject({ rows: before.rows + 1, revisions: before.revisions + 1,
          rowFacts: before.rowFacts + 1, events: before.events });
        await reader.close(); reader = undefined;
      }
    } finally { try { await reader?.close(); } finally { await fixture.close(); } }
  }, 240_000);

  it("resolves identical Product keys in their authorized shop and refuses a foreign article on the same storage", async () => {
    const first = await createMixedMutationProductFixture({ driver, suffix: `reference-two-shops-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions });
    let second: Fixture | undefined, reader: Fixture | undefined;
    try {
      second = await createMixedMutationProductFixture({ driver, suffix: `reference-two-shops-${driver}`,
        payloadProfile: "ordinary", payloadCollections: collections, extensions, resource: first.currency.resource,
        fixtureIdentity: { deploymentId: "reference_read_other_deployment", projectId: "reference_read_other_project", uuidOffset: 60_001 } });
      expect(second.activation.anchor.scopeId).not.toBe(first.activation.anchor.scopeId);
      expect(second.seed.productId).toBe(first.seed.productId);
      await first.runStandaloneProductUpdate({ title: "First shop", handle: first.seed.newHandle + "-first" });
      await second.runStandaloneProductUpdate({ title: "Second shop", handle: second.seed.newHandle + "-second" });
      const firstArticle = await seedArticle(first), secondArticle = await seedArticle(second);
      for (const [shop, article, title] of [[first, firstArticle, "First shop"], [second, secondArticle, "Second shop"]] as const) {
        reader = await shop.openCompetingFiniteFixture(`reference-shop-${title}-${driver}`, {
          privateReferenceRead: { articleIds: [article.id], productIds: [shop.seed.productId] } });
        const value = await successfulValue(await reader.runExecution(readSource(reader.payload?.profile.participant, article.id)));
        expect(decodeRead(value).product.title).toBe(title);
        expect(await reader.publish(value)).toMatchObject({ kind: "published" });
        await reader.close(); reader = undefined;
      }
      reader = await second.openCompetingFiniteFixture(`reference-foreign-article-${driver}`, {
        privateReferenceRead: { articleIds: [firstArticle.id], productIds: [second.seed.productId] } });
      const firstBefore = await publishedCounts(first), secondBefore = await publishedCounts(second);
      await expect(reader.runExecution(readSource(reader.payload?.profile.participant, firstArticle.id))).rejects.toBeDefined();
      expect(reader.nativeInvokeCount.get("retrieve") ?? 0).toBe(0);
      expect(await publishedCounts(first)).toEqual(firstBefore);
      expect(await publishedCounts(second)).toEqual(secondBefore);
      await expect(Effect.runPromise(reader.freeze(null))).rejects.toMatchObject({ reason: "journalFailed" });
    } finally {
      try { await reader?.close(); } finally { try { await second?.close(); } finally { await first.close(); } }
    }
  }, 300_000);
});
