import { and, eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { captureFiniteAttemptAnchor, projectCapturedFiniteAttemptAnchor, readFiniteAttemptAnchorRow } from
  "../../persistence-postgres/src/execution/finiteAttemptAnchor";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { fxAppRowRevisions, fxSystemCommits, fxSystemSnapshotLeases, fxSystemTransactionSessions,
  fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import {
  PointCommitConflictV1Error,
} from "../../persistence-postgres/src/commit/point/errors";
import {
  PointMutationAttemptReplacementFiniteEntryError,
} from "../../persistence-postgres/src/commit/point/errors";
import {
  ApplicationMutationAdmissionError,
} from "../../persistence-postgres/src/application/applicationMutationAdmission";
import {
  PointMutationJournalAdmittedOperationRejectedV1Error,
} from "../../executor/src/mutation/journal/errors";
import { admittedCommerceEventGroup } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("mixed Product whole-root OCC retry on %s", driver => {
  it("refuses a cleared canonical reservation before replacing a frozen data-conflicted attempt", async () => {
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
      const session = before.sessions[0];
      if (session === undefined) throw new Error("Missing original compact anchor");
      const original = await Effect.runPromise(readFiniteAttemptAnchorRow(session));
      expect(original.reservation).not.toBeNull();
      expect(session).toMatchObject({ lifecycle: "retrying", executionProfile: "finiteRoot", executionAuthorityGeneration: "application_v1",
        attemptFence: fixture.activation.anchor.attemptFence,
        finiteClaimFence: fixture.activation.executionClaim.claimFence + 1n });
      expect(before.leases).toEqual([]);
      expect(before.journals).toEqual([]);
      expect(before.claims).toEqual([]);
      const selection = and(eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
        eq(fxSystemTransactionSessions.sessionId, sessionId), eq(fxSystemTransactionSessions.attemptFence, session.attemptFence));
      const cleared = Result.getOrThrow(projectCapturedFiniteAttemptAnchor(
        await Effect.runPromise(captureFiniteAttemptAnchor({ snapshotToken: original.snapshotToken }))));
      const calls = Object.fromEntries(fixture.nativeInvokeCount);
      try {
        // Canonical storage corruption preserves physical consistency and the
        // signed program. Confirmed entry still requires its reservation.
        expect(await db.update(fxSystemTransactionSessions).set(cleared)
          .where(selection).returning()).toHaveLength(1);
        const corrupted = await inspect();
        await expect(fixture.retryWholeAttempt(conflict)).rejects.toMatchObject({
          _tag: "PointMutationAttemptReplacementCorruptionV1Error", reason: "occEvidenceInvalid",
        });
        expect(await inspect()).toEqual(corrupted);
        expect(replacementReachedCommit).toBe(false);
        expect(fixture.retryContexts).toHaveLength(0);
        expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(calls);
        expect(fixture.getOpenTransactionDepth()).toBe(0);
      } finally {
        expect(await db.update(fxSystemTransactionSessions).set({ finiteAttemptBytes: session.finiteAttemptBytes,
          finiteAttemptSha256: session.finiteAttemptSha256, finiteMetadataWatermark: session.finiteMetadataWatermark })
          .where(selection).returning()).toHaveLength(1);
      }
      expect(await inspect()).toEqual(before);
    } finally { await fixture.close(); }
  }, 180_000);

  it("rolls back a replacement callback's forged admission refusal without aborting the original attempt", async () => {
    const failure = new PointMutationAttemptReplacementFiniteEntryError({
      cause: new ApplicationMutationAdmissionError({ reason: "invalidExecutionAuthority", retryable: false }),
    });
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
      const session = before.session[0];
      if (session === undefined || session.finiteAttemptBytes === null) throw new Error("Missing original compact anchor");
      expect((await Effect.runPromise(readFiniteAttemptAnchorRow(session))).reservation).not.toBeNull();
      expect(session.finiteAttemptBytes.byteLength).toBeGreaterThan(0);
      expect(session).toMatchObject({ lifecycle: "retrying", attemptFence: fixture.activation.anchor.attemptFence,
        finiteClaimFence: fixture.activation.executionClaim.claimFence + 1n });
      expect(before.lease).toEqual([]);
      expect(before.root).toEqual([]);
      expect(before.claim).toEqual([]);
      const calls = Object.fromEntries(fixture.nativeInvokeCount);
      await expect(fixture.retryWholeAttempt(conflict)).rejects.toBe(failure);
      expect(entered).toBe(true);
      // Nonacceptance fencing committed before the replacement transaction.
      // Its callback failure rolls back the entire new entry, preserving the
      // original program, snapshot and reservation under that committed fence.
      expect(await inspect()).toEqual(before);
      expect(fixture.retryContexts).toHaveLength(0);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(calls);
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } finally { await fixture.close(); }
  }, 180_000);

  it("reexecutes native Product on a fresh finite entry after a standalone conflict", async () => {
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
      expect(staleFailure).toBeInstanceOf(PointMutationJournalAdmittedOperationRejectedV1Error);
      if (!(staleFailure instanceof PointMutationJournalAdmittedOperationRejectedV1Error))
        throw new Error("Missing exact closed-root Product refusal", { cause: staleFailure });
      expect(staleFailure.result).toEqual({ kind: "stateRejected", issue: { reason: "journalFailed" } });
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(nativeCallsBeforeStale);
      const eventsAfterStale = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(eventsAfterStale).toEqual(committedEvents);
    } finally { await fixture.close(); }
  }, 180_000);
});
