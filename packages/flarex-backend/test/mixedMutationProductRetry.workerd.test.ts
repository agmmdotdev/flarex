import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { fxAppRowRevisions } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { PointCommitConflictV1Error } from
  "../../persistence-postgres/src/pointCommitTransaction";
import { PointMutationJournalAttemptUnavailableV1Error } from
  "../../executor/src/pointMutationJournal";
import { admittedCommerceEventGroup } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { createMixedMutationProductFixture } from "./support/mixedMutationProductFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("mixed Product whole-root OCC retry on %s", driver => {
  it("reexecutes the native Product on a fresh journal manager after a standalone conflict", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `product-retry-${driver}` });
    try {
      const raw = await fixture.runWorkerd();
      const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
      const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        success.result.result))).value;
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toMatchObject({
        update: 1, retrieve: 1, listByHandle: 1,
      });
      await fixture.runStandaloneProductUpdate({
        title: `${fixture.seed.newTitle} standalone`,
        handle: `${fixture.seed.newHandle}-standalone`,
      });
      let conflict: unknown;
      try {
        await Effect.runPromise(await fixture.prepareOccPublication(returnedValue));
      } catch (cause) {
        conflict = cause;
      }
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      const recovered = await fixture.retryWholeAttempt(conflict);
      expect(recovered).toMatchObject({ kind: "published" });
      expect(fixture.retryContexts).toHaveLength(1);
      const freshContext = fixture.retryContexts[0];
      if (freshContext === undefined) throw new Error("Missing fresh retry context");
      expect(freshContext.attemptFence).toBeGreaterThan(fixture.activation.anchor.attemptFence);
      expect(freshContext.snapshotToken.commitSeq).toBeGreaterThan(
        fixture.activation.anchor.snapshotToken.commitSeq);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toMatchObject({
        update: 2, retrieve: 2, listByHandle: 2,
      });
      if (fixture.hasSqlObserver) {
        expect(fixture.serviceTransactionDepth).toEqual([0, 0, 0, 0, 0, 0]);
      } else {
        expect(fixture.pgTransactionObservations).toHaveLength(6);
        expect(fixture.pgTransactionObservations.every(observed =>
          observed.targetBackends > 0 && observed.openTransactions === 0)).toBe(true);
      }
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const appRows = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
          eq(fxAppRowRevisions.tableId, CatalogTableIdSchema.make(1))));
      expect(appRows).toHaveLength(1);
      const appRow = appRows[0];
      if (appRow?.valueBytes === null || appRow?.valueBytes === undefined ||
        appRow.valueSha256 === null) throw new Error("Missing committed retried Application row");
      const appDocument = await decodeCanonicalFlarexValueEvidenceV1({
        canonicalBytes: appRow.valueBytes, sha256: appRow.valueSha256, profile: "appDocument",
      });
      expect(appDocument.value).toMatchObject({ name: fixture.seed.newTitle });
      const committedEvents = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      const freshGroup = admittedCommerceEventGroup({ scopeUuid,
        sessionId: fixture.activation.anchor.sessionId, attemptFence: freshContext.attemptFence });
      const productEvents = committedEvents.filter(event =>
        event.envelope.contract === fixture.binding.metadata.product.updatedEvent);
      expect(productEvents.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      expect(productEvents.filter(event => event.envelope.group === freshGroup)).toHaveLength(1);
      const originalUpdate = fixture.getUpdateRequest();
      if (originalUpdate === undefined) throw new Error("Missing original Product request");
      const nativeCallsBeforeStale = Object.fromEntries(fixture.nativeInvokeCount);
      const staleFailure = await Effect.runPromise(fixture.runAdmitted({ ...originalUpdate,
        syscallSequence: CommitSyscallSequenceV1Schema.make(6n) })).then(() => null, cause => cause);
      expect(staleFailure).toBeInstanceOf(PointMutationJournalAttemptUnavailableV1Error);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(nativeCallsBeforeStale);
      const eventsAfterStale = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(eventsAfterStale).toEqual(committedEvents);
    } finally { await fixture.close(); }
  }, 180_000);
});
