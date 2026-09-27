import { and, asc, eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from
  "flarex-protocol/app-document-id";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { decodeCanonicalSessionJournalEffect } from "flarex-protocol/commit-protocol";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { fxAppRowRevisions, fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournals } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { decodeLogicalParticipantDependencyEvidence } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { createMixedMutationProductFixture } from "./support/mixedMutationProductFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("native Product in one Application mutation attempt on %s", driver => {
  it("runs the selected native service on the exact journal attempt", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `workerd-${driver}` });
    try {
      const { currency, product, seed, baseline, activation,
        binding, eventGroup, runAdmitted,
        serviceTransactionDepth, sqlByPhase } = fixture;
      const workerd = await fixture.runWorkerd();
    expect(workerd).toMatchObject({ kind: "result", result: { kind: "success",
      result: { format: "flarex.point-mutation-exact-runtime-result", version: 1,
        value: { updated: { id: seed.productId, handle: seed.newHandle },
        pending: { id: seed.productId, title: seed.newTitle },
        listed: [{ id: seed.productId }] } } } });
    const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
      result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(workerd);
    const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
      success.result.result))).value;
    const updateRequest = fixture.getUpdateRequest();
    if (updateRequest === undefined) throw new Error("Missing admitted update frame");
    fixture.setSqlPhase("replay");
    const replayed = await Effect.runPromise(runAdmitted(updateRequest));
    expect(replayed).toMatchObject({ id: seed.productId, title: seed.newTitle,
      handle: seed.newHandle });
    expect(fixture.hasSqlObserver).toBe(driver === "pglite");
    if (fixture.hasSqlObserver) {
      expect(serviceTransactionDepth).toEqual([0, 0, 0]);
      expect(fixture.getTransactionCounts().beginCount).toBeGreaterThan(0);
      expect(fixture.getTransactionCounts().settleCount).toBeGreaterThan(0);
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } else {
      expect(fixture.pgTransactionObservations).toHaveLength(3);
      expect(fixture.pgTransactionObservations.every(observed =>
        observed.targetBackends > 0 && observed.openTransactions === 0)).toBe(true);
    }
    expect(baseline).toMatchObject({ id: seed.productId, tags: [{ id: seed.tagId }] });
    const publication = await fixture.preparePublication(returnedValue);
    const sealedRoots = await currency.persistence.drizzle.select().from(fxSystemTransactionJournals)
      .where(and(eq(fxSystemTransactionJournals.scopeUuid,
        projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, activation.anchor.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, activation.anchor.attemptFence)));
    expect(sealedRoots).toHaveLength(1);
    const sealedRoot = sealedRoots[0];
    if (sealedRoot?.sealedJournalBytes === null || sealedRoot?.sealedJournalBytes === undefined ||
      sealedRoot.sealedJournalSha256 === null) throw new Error("Missing sealed Product journal evidence");
    const sealedJournal = await Effect.runPromise(decodeCanonicalSessionJournalEffect({
      canonicalBytes: sealedRoot.sealedJournalBytes,
      expectedSha256Hex: encodeBytesToLowercaseHex(sealedRoot.sealedJournalSha256),
    }));
    const productReadEvidence = sealedJournal.journal.participantOperations
      .filter(operation => operation.participant === "medusa.product")
      .flatMap(operation => operation.sourceContributions)
      .filter(source => source.sourceKey === "medusa.product")
      .map(source => Result.getOrThrow(decodeLogicalParticipantDependencyEvidence(
        source.dependencyEvidence)));
    expect(productReadEvidence).toHaveLength(3);
    expect(productReadEvidence.some(evidence => evidence.indexRanges.length > 0 &&
      evidence.indexRanges.some(range => range.entries.length > 0))).toBe(true);
    const published = await Effect.runPromise(publication);
    expect(published).toMatchObject({ kind: "published" });
    const appResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(returnedValue);
    const appIdentity = decodeAppDocumentIdentityV1(appResult.id);
    const committedApp = await currency.persistence.drizzle.select().from(fxAppRowRevisions).where(and(
      eq(fxAppRowRevisions.scopeUuid, projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid),
      eq(fxAppRowRevisions.tableId, appIdentity.tableId),
      eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(appIdentity.rowId)),
    )).orderBy(fxAppRowRevisions.commitSeq);
    const appRevision = committedApp.at(-1);
    if (appRevision?.valueBytes === null || appRevision?.valueBytes === undefined ||
      appRevision.valueSha256 === null) throw new Error("Missing committed dependent Application row");
    const appDocument = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: appRevision.valueBytes, sha256: appRevision.valueSha256, profile: "appDocument",
    });
    expect(appDocument.value).toMatchObject({ name: seed.newTitle });
    const committedEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents).where(
      eq(fxSystemCommitEvents.scopeUuid, projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid));
    const productUpdateEvents = committedEvents.filter(event =>
      event.envelope.contract === binding.metadata.product.updatedEvent &&
      event.envelope.group === eventGroup);
    expect(productUpdateEvents).toHaveLength(1);
    expect(productUpdateEvents[0]?.envelope.message).toMatchObject({ name: binding.metadata.product.updatedEvent });
    fixture.setSqlPhase("postcommit-read");
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.retrieve, product.runtime.commands.list] }));
    try {
      const after = await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: seed.productId, config: { relations: ["options.values", "tags",
          "variants.options", "images", "categories"] },
      }));
      expect(after).toMatchObject({ id: seed.productId, title: seed.newTitle, handle: seed.newHandle,
        options: baseline.options, tags: baseline.tags, variants: baseline.variants,
        images: baseline.images, categories: baseline.categories });
      const titleSearch = await Effect.runPromise(read.read(product.runtime.commands.list,
        { filters: { q: seed.newTitle } }));
      expect(titleSearch).toEqual(expect.arrayContaining([expect.objectContaining({ id: seed.productId })]));
    } finally { await Effect.runPromise(read.close); }
    if (fixture.hasSqlObserver) {
      expect(sqlByPhase.get("product:update")).toBeGreaterThan(0);
      expect(sqlByPhase.get("publish")).toBeGreaterThan(0);
      // A focused receipt for the connected proof; seed and postcommit reads are excluded.
      expect(Object.fromEntries(sqlByPhase)).toMatchObject({ application: expect.any(Number),
        "product:update": expect.any(Number), "product:retrieve": expect.any(Number),
        "product:listByHandle": expect.any(Number), seal: expect.any(Number), publish: expect.any(Number) });
      console.info("Mixed attempt SQL statements by phase", Object.fromEntries(sqlByPhase));
    }
    } finally { await fixture.close(); }
  }, 180_000);

  it("keeps a missing native Product failure sticky when the Worker catches it", async () => {
    const fixture = await createMixedMutationProductFixture({
      driver, suffix: `missing-product-${driver}`,
    });
    try {
      const missing = { ...fixture.seed.updateInput, id: `prod_missing_${driver}` };
      const workerError = await fixture.runWorkerd(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          const id = await ctx.db.insert("users", { name: "pending" });
          let caught = false;
          try { await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(missing)}); }
          catch { caught = true; }
          return { id, caught };
        },
      } } };`).then(() => null, cause => cause);
      if (!(workerError instanceof Error)) throw new Error("Expected sticky journal boundary failure after catch");
      expect(workerError.message).toContain("PointMutationExactRuntimeJournalBoundaryV1Error");
      expect(fixture.bridgeFailures.join("\n")).toContain("PointMutationJournalParticipantRejectedV1Error");
      const roots = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatchObject({ state: "operation_failed", lastSyscallSequence: 2n });
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId))
        .orderBy(asc(fxSystemTransactionJournalReceipts.lastSyscallSequence));
      expect(receipts.map(receipt => receipt.outcomeKind)).toEqual(["inserted", "admittedLogicalError"]);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(
        fixture.attempt, { caught: true }))).rejects.toBeDefined();
    } finally { await fixture.close(); }
  }, 180_000);
});
