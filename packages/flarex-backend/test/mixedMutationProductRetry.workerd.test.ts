import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { CommitSyscallSequenceV1Schema, decodeCanonicalSessionJournalEffect } from "flarex-protocol/commit-protocol";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { fxAppRowRevisions, fxSystemCommits, fxSystemSnapshotLeases, fxSystemTransactionSessions,
  fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { PointCommitConflictV1Error } from
  "../../persistence-postgres/src/pointCommitTransaction";
import { PointMutationAttemptReplacementCorruptionV1Error,
  PointMutationAttemptReplacementFiniteEntryError } from "../../persistence-postgres/src/pointCommitTransaction";
import { PointMutationJournalAttemptUnavailableV1Error } from
  "../../executor/src/pointMutationJournal";
import { admittedCommerceEventGroup } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("mixed Product whole-root OCC retry on %s", driver => {
  it("refuses a cleared reserved lease before replacing a genuinely sealed data-conflicted attempt", async () => {
    let replacementReachedCommit = false;
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `product-reservation-null-retry-${driver}`, hooks: {
        afterReplacementStep: async event => {
          if (event.step === "beforeCommit") replacementReachedCommit = true;
        },
      } });
    try {
      const raw = await fixture.runExecution();
      const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
      const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      await fixture.runStandaloneProductUpdate({ title: `${fixture.seed.newTitle} standalone`,
        handle: `${fixture.seed.newHandle}-standalone` });
      const conflict = await Effect.runPromise(await fixture.prepareOccPublication(value)).then(() => undefined, cause => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      if (!(conflict instanceof PointCommitConflictV1Error)) throw new Error("Missing genuine data publication conflict");
      expect(conflict.conflict.kind).toBe("appRowPoint");
      expect(conflict.currentCommitSeq).toBeGreaterThan(conflict.snapshotCommitSeq);
      const db = fixture.currency.persistence.drizzle;
      const sessionId = fixture.activation.anchor.sessionId;
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const inspect = async () => ({
        sessions: await db.select().from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, sessionId)),
        leases: await db.select().from(fxSystemSnapshotLeases).where(eq(fxSystemSnapshotLeases.sessionId, sessionId)),
        journals: await db.select().from(fxSystemTransactionJournals).where(eq(fxSystemTransactionJournals.sessionId, sessionId)),
        claims: await db.select().from(fxSystemTransactionExecutionClaims).where(eq(fxSystemTransactionExecutionClaims.sessionId, sessionId)),
        rows: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid)),
        commits: await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)),
        events: await db.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)),
      });
      const before = await inspect();
      const lease = before.leases[0];
      const root = before.journals[0];
      if (lease === undefined || lease.metadataWatermark === null || lease.finiteMetadataReservationBytes === null ||
        lease.finiteMetadataReservationSha256 === null || root === undefined || root.sealedJournalBytes === null ||
        root.sealedJournalSha256 === null) throw new Error("Missing genuine sealed reserved attempt");
      const sealed = await Effect.runPromise(decodeCanonicalSessionJournalEffect({ canonicalBytes: root.sealedJournalBytes,
        expectedSha256Hex: encodeBytesToLowercaseHex(root.sealedJournalSha256) }));
      expect(sealed.journal.finiteMetadataReservationSha256Hex).toBe(encodeBytesToLowercaseHex(lease.finiteMetadataReservationSha256));
      expect(before.sessions[0]).toMatchObject({ lifecycle: "finishing", executionAuthorityGeneration: "application_v1" });
      expect(root).toMatchObject({ state: "sealed", executionProfile: "finiteRoot" });
      const leaseSelection = and(eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid),
        eq(fxSystemSnapshotLeases.sessionId, sessionId), eq(fxSystemSnapshotLeases.attemptFence, lease.attemptFence));
      const calls = Object.fromEntries(fixture.nativeInvokeCount);
      try {
        // Negative forensic corruption only. The authentic sealed journal and
        // signed session still require the original reserved contract.
        expect(await db.update(fxSystemSnapshotLeases).set({ metadataWatermark: null,
          finiteMetadataReservationBytes: null, finiteMetadataReservationSha256: null })
          .where(leaseSelection).returning()).toHaveLength(1);
        const corrupted = await inspect();
        await expect(fixture.retryWholeAttempt(conflict)).rejects.toMatchObject({
          _tag: "PointMutationAttemptReplacementCorruptionV1Error", reason: "leaseInvalid",
        } satisfies Pick<PointMutationAttemptReplacementCorruptionV1Error, "_tag" | "reason">);
        expect(await inspect()).toEqual(corrupted);
        expect(replacementReachedCommit).toBe(false);
        expect(fixture.retryContexts).toHaveLength(0);
        expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(calls);
        expect(fixture.getOpenTransactionDepth()).toBe(0);
      } finally {
        expect(await db.update(fxSystemSnapshotLeases).set({ metadataWatermark: lease.metadataWatermark,
          finiteMetadataReservationBytes: lease.finiteMetadataReservationBytes,
          finiteMetadataReservationSha256: lease.finiteMetadataReservationSha256 })
          .where(leaseSelection).returning()).toHaveLength(1);
      }
      expect(await inspect()).toEqual(before);
    } finally { await fixture.close(); }
  }, 180_000);

  it("rolls back a captured replacement entry when its accepting callback fails", async () => {
    const failure = new PointMutationAttemptReplacementFiniteEntryError({ cause: new Error("replacement callback refused") });
    let entered = false;
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `product-replacement-rollback-${driver}`, hooks: {
        afterReplacementStep: async event => {
          if (event.step !== "beforeCommit") return;
          entered = true;
          throw failure;
        },
      } });
    try {
      const raw = await fixture.runExecution();
      const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
      const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      await fixture.runStandaloneProductUpdate({ title: `${fixture.seed.newTitle} standalone`,
        handle: `${fixture.seed.newHandle}-standalone` });
      const conflict = await Effect.runPromise(await fixture.prepareOccPublication(value)).then(() => undefined, cause => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      const db = fixture.currency.persistence.drizzle;
      const sessionId = fixture.activation.anchor.sessionId;
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const inspect = async () => ({
        session: await db.select().from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, sessionId)),
        lease: await db.select().from(fxSystemSnapshotLeases).where(eq(fxSystemSnapshotLeases.sessionId, sessionId)),
        root: await db.select().from(fxSystemTransactionJournals).where(eq(fxSystemTransactionJournals.sessionId, sessionId)),
        claim: await db.select().from(fxSystemTransactionExecutionClaims).where(eq(fxSystemTransactionExecutionClaims.sessionId, sessionId)),
        rows: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid)),
        events: await db.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)),
      });
      const before = await inspect();
      const lease = before.lease[0];
      if (lease?.finiteMetadataReservationBytes === null || lease?.finiteMetadataReservationBytes === undefined ||
        lease.finiteMetadataReservationSha256 === null || lease.metadataWatermark === null)
        throw new Error("Missing genuine original finite reservation");
      expect(lease.finiteMetadataReservationBytes.byteLength).toBeGreaterThan(0);
      expect(before.session[0]?.lifecycle).toBe("finishing");
      const calls = Object.fromEntries(fixture.nativeInvokeCount);
      await expect(fixture.retryWholeAttempt(conflict)).rejects.toBe(failure);
      expect(entered).toBe(true);
      expect(await inspect()).toEqual(before);
      expect(fixture.retryContexts).toHaveLength(0);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(calls);
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } finally { await fixture.close(); }
  }, 180_000);

  it("reexecutes the native Product on a fresh journal manager after a standalone conflict", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `product-retry-${driver}` });
    try {
      const raw = await fixture.runExecution();
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
