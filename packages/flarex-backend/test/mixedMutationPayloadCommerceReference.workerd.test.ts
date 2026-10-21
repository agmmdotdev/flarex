import { Cause, Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { LogicalSchemaExtension } from "flarex-protocol/internal/logical-schema-candidate";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { isJsonObject } from "flarex-protocol/json";
import { captureProductSchema } from "../../medusa-adapter/src/modules/product/schema";
import { productRuntimeMetadata } from "../../medusa-adapter/src/modules/product/runtime-metadata";
import { createHash } from "node:crypto";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
const collections = [{ slug: "articles", fields: [
  { name: "headline", type: "text", required: true },
  { name: "featuredProduct", type: "text" },
] }];
const extensions: readonly LogicalSchemaExtension[] = [{ name: "article_product", sourceKey: "payload",
  source: { table: { namespace: "app", logicalName: "articles" }, field: "featuredProduct" },
  target: { table: { namespace: "medusa", logicalName: "commerce.product/product" }, field: "id" },
  policy: "strongReference", liveness: { source: { kind: "current" },
    target: { kind: "softDeleteNull", field: "deleted_at" } },
  onTargetSoftDelete: "retain", onTargetDelete: "restrict" }];
const decodeSuccess = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }));
const decodeArticle = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const decodeMixed = Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ id: Schema.String }), id: Schema.String }));
async function successfulValue(input: unknown) {
  return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(decodeSuccess(input).result.result))).value;
}
async function expectCmsFailure(work: Promise<unknown>, reason: string) {
  const result = (await Promise.allSettled([work]))[0];
  if (result?.status !== "rejected" || !Cause.isCause(result.reason)) throw new Error("Expected native CMS failure Cause");
  const failure = result.reason.reasons[0];
  if (failure === undefined || !Cause.isFailReason(failure)) throw new Error("Expected typed native CMS failure");
  expect(failure.error).toMatchObject({ reason });
}
function referenceSource(participant: string | undefined, target: string, productUpdate?: Fixture["seed"]["updateInput"]) {
  if (participant === undefined) throw new Error("Missing Payload participant");
  return `export default { users: { create: { isMutation: true, isPublic: true, _handler: async ctx => {
    const article = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
      { collection: "articles", data: { headline: "Selected product", featuredProduct: ${JSON.stringify(target)} } });
    ${productUpdate === undefined ? "return article;" : `await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(productUpdate)});
      const product = await ctx.privateMixed.call("medusa.product", "retrieve", { id: ${JSON.stringify(target)} });
      const id = await ctx.db.insert("users", { name: product.title });
      return { article, id };`}
  } } } };`;
}
async function commerceHost(fixture: Fixture) {
  const commands = fixture.product.runtime.commands;
  return Effect.runPromise(makeCommerceHost({ ...fixture.product.hostInput,
    commands: [commands.internalProductSoftDelete, commands.internalProductRestore] }));
}
// Native hard deletion emits a module event. Compose its real call validator
// and event contract, rather than using the eventless internal-service host.
async function prepareProductDeletion(fixture: Fixture) {
  const catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
    .pipe(Effect.flatMap(schema => productRuntimeMetadata(schema.metadata.frame))));
  const policy = fixture.product.runtime.logicalPolicy;
  const revision = createHash("sha256").update("private-reference-product-delete").digest("hex");
  const contract = defineCommerceEventContract({ name: catalog.product.deletedEvent, revision, internal: true, decode: policy.capture });
  const participant = defineAtomicCommerceParticipant("product");
  const command = fixture.product.runtime.commands.delete;
  const root = defineAtomicCommerceCommand("privateReferenceProductDelete", (ctx, args) => ctx.call(participant, command, args));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.currency.hostInput,
    identityAndAccessPolicy: { profile: "private-reference-product-delete" },
    participants: [{ participant, logicalStorage: fixture.product.hostInput.logicalStorage,
      commands: [command], validateLogicalCall: policy.validateLogicalCall,
      events: { contracts: [contract], select: event => isJsonObject(event) && event.name === catalog.product.deletedEvent
        ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [root], events: { producerRevision: revision, contracts: [contract],
      subscribers: [{ id: "private-reference-product-delete", revision }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return host.run(host.newRequestKey(), root, fixture.seed.productId).pipe(Effect.ensuring(host.close));
}

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
