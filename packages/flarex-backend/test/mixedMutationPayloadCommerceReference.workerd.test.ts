import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { type Fixture, drivers, collections, extensions, decodeArticle, decodeMixed, successfulValue,
  expectCmsFailure, referenceSource, commerceHost, prepareProductDeletion } from "./support/payloadCommerceReferenceFixture";

describe.each(drivers)("private Payload-to-Product reference on %s", driver => {
  it("retains native references through soft deletion and unrelated edits, restricts hard deletion and permits explicit clear", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `retained-product-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, payloadPreferences: true, extensions });
    const host = await commerceHost(fixture);
    const commands = fixture.product.runtime.commands;
    try {
      const value = await successfulValue(await fixture.runExecution(referenceSource(fixture.payload?.profile.participant,
        fixture.seed.productId, fixture.seed.updateInput)));
      const ids = decodeMixed(value);
      expect(await fixture.publish(value)).toMatchObject({ kind: "published" });
      expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(await fixture.readCurrentApplicationDocument(ids.id)).toMatchObject({ name: fixture.seed.newTitle });
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
      const hardDelete = async () => Effect.runPromise(Effect.flip(await prepareProductDeletion(fixture)));
      expect(await hardDelete()).toMatchObject({ reason: "invalidInput", cause: { reason: "targetDeleteRestricted", reference: "article_product" } });
      await Effect.runPromise(host.run(host.newRequestKey(), commands.internalProductSoftDelete, fixture.seed.productId));
      expect(await fixture.runStandalonePayloadCommand(native => native.findByID,
        { collection: "articles", id: ids.article.id })).toMatchObject({ featuredProduct: fixture.seed.productId });
      expect(await fixture.runStandalonePayloadCommand(native => native.update,
        { collection: "articles", id: ids.article.id, data: { headline: "Edited while unavailable" } }))
        .toMatchObject({ headline: "Edited while unavailable", featuredProduct: fixture.seed.productId });
      await expectCmsFailure(fixture.runStandalonePayloadCommand(native => native.create,
        { collection: "articles", data: { headline: "Cannot newly select", featuredProduct: fixture.seed.productId } }), "relationTargetMissing");
      const attempt = await fixture.openCompetingFiniteFixture(`retained-mixed-edit-${driver}`);
      try {
        const participant = JSON.stringify(attempt.payload?.profile.participant);
        const result = await successfulValue(await attempt.runExecution(`export default { users: { create: { isMutation: true, isPublic: true,
          _handler: async ctx => {
            await ctx.privateMixed.call(${participant}, "payload-update", { collection: "articles", id: ${JSON.stringify(ids.article.id)},
              data: { headline: "Retained mixed edit", featuredProduct: ${JSON.stringify(fixture.seed.productId)} } });
            return await ctx.db.insert("users", { name: "Retained selection" });
          } } } };`));
        expect(await attempt.publish(result)).toMatchObject({ kind: "published" });
        expect(await fixture.readCurrentApplicationDocument(ids.article.id))
          .toMatchObject({ headline: "Retained mixed edit", featuredProduct: fixture.seed.productId });
      } finally { await attempt.close(); }
      expect(await hardDelete()).toMatchObject({ reason: "invalidInput", cause: { reason: "targetDeleteRestricted", reference: "article_product" } });
      await Effect.runPromise(host.run(host.newRequestKey(), commands.internalProductRestore, fixture.seed.productId));
      const second = decodeArticle(await fixture.runStandalonePayloadCommand(native => native.create,
        { collection: "articles", data: { headline: "Can select restored", featuredProduct: fixture.seed.productId } }));
      await fixture.runStandalonePayloadCommand(native => native.delete, { collection: "articles", id: second.id });
      await fixture.runStandalonePayloadCommand(native => native.update,
        { collection: "articles", id: ids.article.id, data: { featuredProduct: null } });
      await Effect.runPromise(host.run(host.newRequestKey(), commands.internalProductSoftDelete, fixture.seed.productId));
      await Effect.runPromise(await prepareProductDeletion(fixture));
      expect(await fixture.runStandalonePayloadCommand(native => native.findByID,
        { collection: "articles", id: ids.article.id })).toMatchObject({ featuredProduct: null });
    } finally { try { await Effect.runPromise(host.close); } finally { await fixture.close(); } }
  }, 240_000);

  it("does not let retained-target validation authorize a new edge on a later publication page", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `commerce-reference-page-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions });
    const host = await commerceHost(fixture);
    let attempt: Fixture | undefined;
    try {
      const participant = JSON.stringify(fixture.payload?.profile.participant);
      const value = await successfulValue(await fixture.runExecution(`export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => {
          const rows = [];
          for (let i = 0; i < 33; i++) rows.push(await ctx.privateMixed.call(${participant}, "payload-create",
            { collection: "articles", data: { headline: "Original " + i, featuredProduct: ${JSON.stringify(fixture.seed.productId)} } }));
          return rows;
        } } } };`));
      const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(value);
      expect(rows).toHaveLength(33);
      expect(await fixture.publish(value)).toMatchObject({ kind: "published" });
      // Publication orders one table's changes by rowId, not native call order.
      // Clearing the maximum identity makes its later reassignment a genuinely
      // new edge after a complete page of 32 retained edges, on every run.
      const ordered = rows.map(row => ({ ...row, rowId: decodeAppDocumentIdentityV1(row.id).rowId }))
        .sort((left, right) => left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0);
      const nextEdge = ordered[32];
      if (nextEdge === undefined) throw new Error("Missing last publication row");
      const retained = ordered.slice(0, 32);
      expect(retained.every(row => row.rowId < nextEdge.rowId)).toBe(true);
      await fixture.runStandalonePayloadCommand(native => native.update,
        { collection: "articles", id: nextEdge.id, data: { featuredProduct: null } });
      await Effect.runPromise(host.run(host.newRequestKey(), fixture.product.runtime.commands.internalProductSoftDelete, fixture.seed.productId));
      attempt = await fixture.openCompetingFiniteFixture(`commerce-reference-page-new-${driver}`);
      const next = await successfulValue(await attempt.runExecution(`export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => {
          for (const row of ${JSON.stringify(retained)}) await ctx.privateMixed.call(${participant}, "payload-update",
            { collection: "articles", id: row.id, data: { headline: "Retained" } });
          return await ctx.privateMixed.call(${participant}, "payload-update", { collection: "articles", id: ${JSON.stringify(nextEdge.id)},
            data: { headline: "New edge after retained page", featuredProduct: ${JSON.stringify(fixture.seed.productId)} } });
        } } } };`));
      expect(await Effect.runPromise(Effect.flip(await attempt.preparePublication(next))))
        .toMatchObject({ reason: "targetNotLive", reference: "article_product" });
      for (const row of rows) expect(await fixture.readCurrentApplicationDocument(row.id)).not.toMatchObject({ headline: "Retained" });
    } finally {
      try { await attempt?.close(); } finally { try { await Effect.runPromise(host.close); } finally { await fixture.close(); } }
    }
  }, 240_000);

  it.each(["deleteFirst", "referenceFirst"] as const)("enforces hard-delete/reference ordering with %s", async order => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `commerce-reference-${order}-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions });
    const host = await commerceHost(fixture);
    try {
      const value = await successfulValue(await fixture.runExecution(referenceSource(fixture.payload?.profile.participant, fixture.seed.productId)));
      if (order === "deleteFirst") {
        await Effect.runPromise(await prepareProductDeletion(fixture));
        expect(await Effect.runPromise(Effect.flip(await fixture.preparePublication(value))))
          .toMatchObject({ reason: "targetNotLive", reference: "article_product" });
      } else {
        expect(await fixture.publish(value)).toMatchObject({ kind: "published" });
        expect(await Effect.runPromise(Effect.flip(await prepareProductDeletion(fixture))))
          .toMatchObject({ reason: "invalidInput", cause: { reason: "targetDeleteRestricted", reference: "article_product" } });
      }
    } finally { try { await Effect.runPromise(host.close); } finally { await fixture.close(); } }
  }, 180_000);

  it("refuses a newly assigned target soft-deleted after execution without publishing its article", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `commerce-reference-soft-race-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions });
    const host = await commerceHost(fixture);
    try {
      const value = await successfulValue(await fixture.runExecution(referenceSource(fixture.payload?.profile.participant, fixture.seed.productId)));
      const article = decodeArticle(value);
      await Effect.runPromise(host.run(host.newRequestKey(), fixture.product.runtime.commands.internalProductSoftDelete, fixture.seed.productId));
      expect(await Effect.runPromise(Effect.flip(await fixture.preparePublication(value))))
        .toMatchObject({ reason: "targetNotLive", reference: "article_product" });
      await expect(fixture.readCurrentApplicationDocument(article.id)).rejects.toThrow("Missing committed Application document");
    } finally { try { await Effect.runPromise(host.close); } finally { await fixture.close(); } }
  }, 180_000);

  it("permits null and omitted native fields but refuses missing and wrong-table target keys", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `commerce-reference-null-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions });
    try {
      for (const data of [{ headline: "No selection" }, { headline: "Cleared selection", featuredProduct: null }])
        expect(await fixture.runStandalonePayloadCommand(native => native.create, { collection: "articles", data }))
          .toMatchObject({ featuredProduct: null });
      for (const target of ["missing-product", fixture.seed.tagId])
        await expectCmsFailure(fixture.runStandalonePayloadCommand(native => native.create,
          { collection: "articles", data: { headline: "Invalid selection", featuredProduct: target } }), "relationTargetMissing");
    } finally { await fixture.close(); }
  }, 180_000);
});
