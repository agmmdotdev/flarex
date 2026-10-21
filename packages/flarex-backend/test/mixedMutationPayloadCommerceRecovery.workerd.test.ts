import { createHash } from "node:crypto";
import { Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1, ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
  encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/commit/point/errors";
import { deferredSignal, withTimeout } from "../../persistence-postgres/test/commit/point/support/postgresFaults";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { installOneCommitResponseFault } from "./support/postgresCommitResponseFault";
import { drivers, collections, extensions, decodeMixed, successfulValue, referenceSource,
  prepareProductDeletion, publishedCounts } from "./support/payloadCommerceReferenceFixture";

describe.each(drivers)("private CMS/Product reference recovery on %s", driver => {
  it("keeps all three owners unpublished after a caught late native validation failure", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `reference-late-failure-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions });
    try {
      const before = await publishedCounts(fixture), product = await fixture.readCurrentProduct();
      const source = referenceSource(fixture.payload?.profile.participant, fixture.seed.productId, fixture.seed.updateInput)
        .replace("return { article, id };", `try {
          await ctx.privateMixed.call(${JSON.stringify(fixture.payload?.profile.participant)}, "payload-update",
            { collection: "articles", id: article.id, data: { headline: 22 } });
        } catch (_) {} return { article, id };`);
      // The handler may catch the error; it cannot make the admitted root publishable.
      await fixture.runExecution(source).then(() => undefined, () => undefined);
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(1);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      expect(fixture.nativeInvokeCount.get("payload-update")).toBe(1);
      await expect(Effect.runPromise(fixture.freeze(null))).rejects.toMatchObject({ reason: "journalFailed" });
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.readCurrentProduct()).toEqual(product);
      // No ghost reverse edge may restrict a genuine native hard delete.
      await Effect.runPromise(await prepareProductDeletion(fixture));
    } finally { await fixture.close(); }
  }, 180_000);

  it("retries the complete reference mutation after a concurrent Product read changes", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `reference-conflict-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions,
      applicationSource: (seed, participant) => `export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => {
          const product = await ctx.privateMixed.call("medusa.product", "retrieve", { id: ${JSON.stringify(seed.productId)} });
          const article = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
            { collection: "articles", data: { headline: product.title, featuredProduct: product.id } });
          const id = await ctx.db.insert("users", { name: product.title });
          return { article, id };
        } } } };` });
    try {
      const first = await successfulValue(await fixture.runExecution()), discarded = decodeMixed(first);
      const title = fixture.seed.newTitle + " concurrent";
      await fixture.runStandaloneProductUpdate({ title, handle: fixture.seed.newHandle + "-concurrent" });
      const before = await publishedCounts(fixture);
      const conflict = await Effect.runPromise(Effect.flip(await fixture.prepareOccPublication(first)));
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.retryWholeAttempt(conflict)).toMatchObject({ kind: "published" });
      const retried = decodeMixed(fixture.retryReturnedValues[0]);
      expect(await fixture.readCurrentApplicationDocument(retried.article.id)).toMatchObject({ headline: title, featuredProduct: fixture.seed.productId });
      expect(await fixture.readCurrentApplicationDocument(retried.id)).toMatchObject({ name: title });
      await expect(fixture.readCurrentApplicationDocument(discarded.article.id)).rejects.toThrow("Missing committed Application document");
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(2);
      expect(fixture.nativeInvokeCount.get("retrieve")).toBe(2);
      expect(await publishedCounts(fixture)).toMatchObject({ rows: before.rows + 2, revisions: before.revisions + 2,
        rowFacts: before.rowFacts + 2, commits: before.commits + 1, outcomes: before.outcomes + 1, events: before.events });
      expect(await Effect.runPromise(Effect.flip(await prepareProductDeletion(fixture))))
        .toMatchObject({ cause: { reason: "targetDeleteRestricted", reference: "article_product" } });
    } finally { await fixture.close(); }
  }, 180_000);

  it("cancels an admitted reference create and poisons the staged three-owner root", async () => {
    const entered = deferredSignal(), release = deferredSignal();
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `reference-cancel-${driver}`,
      payloadProfile: "ordinary", payloadCollections: collections, extensions,
      hooks: { afterPayloadBeforeAck: method => method === "payload-create" ? Effect.promise(async () => {
        entered.resolve(); await release.promise;
      }) : Effect.void } });
    let fiber: ReturnType<typeof Effect.runFork<unknown, unknown>> | undefined;
    try {
      const before = await publishedCounts(fixture), product = await fixture.readCurrentProduct();
      await successfulValue(await fixture.runExecution(`export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => {
          await ctx.db.insert("users", { name: "pending" });
          await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(fixture.seed.updateInput)});
          return null;
        } } } };`));
      const participant = fixture.payload?.profile.participant;
      if (participant === undefined) throw new Error("Missing Payload participant");
      const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result({
        format: ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1, version: ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
        participant, operation: "payload-create", args: { collection: "articles",
          data: { headline: "Cancelled reference", featuredProduct: fixture.seed.productId } } }));
      fiber = Effect.runFork(fixture.runAdmitted({ syscallSequence: CommitSyscallSequenceV1Schema.make(3n),
        operation: encoded.operation, requestBytes: encoded.bytes,
        requestSha256: createHash("sha256").update(encoded.bytes).digest() }));
      await withTimeout(entered.promise, 30_000, "native reference staged before acknowledgement");
      if (fixture.hasSqlObserver) expect(fixture.getOpenTransactionDepth()).toBe(0);
      await Effect.runPromise(Fiber.interrupt(fiber));
      expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fiber)))).toBe(true);
      release.resolve();
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(1);
      await expect(Effect.runPromise(fixture.freeze(null))).rejects.toMatchObject({ reason: "journalFailed" });
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.readCurrentProduct()).toEqual(product);
      await Effect.runPromise(await prepareProductDeletion(fixture));
    } finally {
      release.resolve();
      if (fiber !== undefined) await Effect.runPromise(Fiber.interrupt(fiber));
      await fixture.close();
    }
  }, 180_000);

  it.skipIf(driver !== "postgres")("recovers a lost COMMIT response with the reference and all owners exactly once", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: "reference-lost-commit",
      payloadProfile: "ordinary", payloadCollections: collections, extensions });
    try {
      const value = await successfulValue(await fixture.runExecution(referenceSource(fixture.payload?.profile.participant,
        fixture.seed.productId, fixture.seed.updateInput)));
      const ids = decodeMixed(value), before = await publishedCounts(fixture), calls = new Map(fixture.nativeInvokeCount);
      const publication = await fixture.preparePublication(value);
      const fault = await installOneCommitResponseFault(fixture, before.commits, () => { throw new Error("reference COMMIT response lost"); });
      expect(await Effect.runPromise(publication).finally(fault.restore)).toMatchObject({ kind: "replayed" });
      expect(fault.fired()).toBe(true);
      const committed = await publishedCounts(fixture);
      expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(await publishedCounts(fixture)).toEqual(committed);
      expect(committed.rowFacts - before.rowFacts).toBe(committed.revisions - before.revisions);
      expect(committed.indexes).toBeGreaterThan(before.indexes);
      expect(fixture.nativeInvokeCount).toEqual(calls);
      expect(await fixture.readCurrentApplicationDocument(ids.article.id)).toMatchObject({ featuredProduct: fixture.seed.productId });
      expect(await fixture.readCurrentApplicationDocument(ids.id)).toMatchObject({ name: fixture.seed.newTitle });
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
      expect(await publishedCounts(fixture)).toMatchObject({ commits: before.commits + 1,
        outcomes: before.outcomes + 1, events: before.events + 1 });
      expect(await Effect.runPromise(Effect.flip(await prepareProductDeletion(fixture))))
        .toMatchObject({ cause: { reason: "targetDeleteRestricted", reference: "article_product" } });
    } finally { await fixture.close(); }
  }, 180_000);
});
