import { readFiniteAttemptAnchorRow } from "../../persistence-postgres/src/execution/finiteAttemptAnchor";
import { createHash } from "node:crypto";
import { and, asc, eq, getTableName, sql } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CommerceTransactionError } from
  "@flarex/persistence-postgres/internal/commerce-values";
import {
  LogicalParticipantInvocationError,
} from "@flarex/persistence-postgres/internal/logical-participant-errors";
import { makeCommerceHost } from
  "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1,
  ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
  encodeAdmittedFrameworkOperationV1Result } from
  "flarex-protocol/internal/admitted-framework-operation-v1";
import { admittedCommerceEventGroup } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { fxSystemCommitEvents } from
  "../../persistence-postgres/src/commit/events/schema";
import {
  fxAppRowRevisions,
  fxSystemCommits,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionJournals, fxSystemTransactionSessions,
} from "../../persistence-postgres/src/database/schema";
import { createMixedMutationProductFixture } from
  "./support/mixedMutationWorkerdFixture";
import { selectorFromRelationAnchor } from
  "../../persistence-postgres/test/commit/point/support/relations";
import {
  createPointMutationExecutionClaimAcquisitionV1,
} from "@flarex/persistence-postgres/internal/session-construction";
import { readFiniteRecoveryAttempt } from "@flarex/persistence-postgres/internal/session";
import { installOneCommitResponseFault } from "./support/postgresCommitResponseFault";
import { expectExpiredMixedOwnerCleanup } from "./support/mixedMutationCleanupAssertions";
import { InvalidSessionJournalCapabilityV1Error } from
  "@flarex/persistence-postgres/internal/session-journal";

async function inspectCurrentFiniteAnchor(fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>) {
  const rows = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
  if (rows.length !== 1 || rows[0] === undefined) throw new Error("Missing exact finite anchor");
  return Effect.runPromise(readFiniteAttemptAnchorRow(rows[0]));
}

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const]
  : ["pglite" as const, "postgres" as const];

describe.each(drivers)("native mixed mutation recovery on %s", driver => {
  it("refuses overlapping private calls before either native callback runs", async () => {
    const fixture = await createMixedMutationProductFixture({
      driver,
      suffix: `parallel-refusal-${driver}`,
    });
    try {
      const workerError = await fixture.runExecution(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          const first = ctx.privateMixed.call("medusa.product", "update",
            ${JSON.stringify(fixture.seed.updateInput)});
          let refused = false;
          try { await ctx.privateMixed.call("medusa.product", "retrieve",
            ${JSON.stringify(fixture.seed.retrieveInput)}); }
          catch { refused = true; }
          try { await first; } catch {}
          return { refused };
        },
      } } };`).then(() => null, cause => cause);
      if (!(workerError instanceof Error)) {
        throw new Error("Expected an overlapping private call to poison the runtime");
      }
      expect(workerError.message).toContain("PointMutationExactRuntimeJournalBoundaryV1Error");
      expect(fixture.nativeInvokeCount.get("update") ?? 0).toBe(0);
      expect(fixture.nativeInvokeCount.get("retrieve") ?? 0).toBe(0);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });

  it("refuses a concurrent finite-root duplicate through the canonical exact handle without invoking Product twice", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const fixture = await createMixedMutationProductFixture({
      driver,
      suffix: `marker-duplicate-${driver}`,
      hooks: {
        beforeNative: method => method === "update"
          ? Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          })
          : Effect.void,
      },
    });
    let running: Promise<unknown> | undefined;
    try {
      await expect(Effect.runPromise(fixture.store.openAttemptEffect({
        selector: selectorFromRelationAnchor(fixture.activation.anchor), snapshotToken: fixture.activation.anchor.snapshotToken,
        schemaVersionId: fixture.schemaVersionId, executionClaim: fixture.activation.executionClaim, executionProfile: "finiteRoot",
      }))).rejects.toMatchObject({ _tag: "LogicalParticipantAdmissionError" });
      const secondHandle = fixture.persistenceAttempt;
      const secondAdmission = await Effect.runPromise(
        fixture.store.admitLogicalParticipantsEffect(secondHandle, {
          participant: "medusa.product",
          operationMethods: ["update", "retrieve", "listByHandle"],
          profileRevision: fixture.productProfileRevision,
          sources: [{ selection: fixture.prepared,
            application: fixture.active.selection,
            methods: ["update", "retrieve", "listByHandle"] }],
        }),
      );
      const pending = fixture.runExecution();
      running = pending;
      await Promise.race([
        Effect.runPromise(Deferred.await(entered)),
        pending.then(() => { throw new Error("Worker ended before Product update"); }),
      ]);
      const request = fixture.getUpdateRequest();
      if (request === undefined) throw new Error("Missing in-flight Product update request");
      const roots = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(0);
      expect(await inspectCurrentFiniteAnchor(fixture)).toMatchObject({ session: { lifecycle: "running", executionProfile: "finiteRoot" } });
      // The held callback is tentative local work. None of the five durable
      // child families may be published before the aggregate seal.
      for (const child of [fxSystemTransactionJournalReceipts, fxSystemTransactionJournalPoints,
        fxSystemTransactionJournalIndexRanges, fxSystemTransactionJournalRelationIncomingDependencies,
        fxSystemTransactionJournalWriteEvents]) {
        const children = await fixture.currency.persistence.drizzle.select({ sessionId: child.sessionId })
          .from(child).where(and(
            eq(child.scopeUuid, projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid),
            eq(child.sessionId, fixture.activation.anchor.sessionId),
            eq(child.attemptFence, fixture.activation.anchor.attemptFence),
          )).limit(1);
        expect(children, getTableName(child)).toEqual([]);
      }
      expect(await inspectCurrentFiniteAnchor(fixture)).toMatchObject({ session: { executionProfile: "finiteRoot", lifecycle: "running" } });
      let duplicateInvocations = 0;
      const duplicate = await Effect.runPromise(fixture.store.runAdmittedOperationEffect(
        secondHandle, secondAdmission, {
          syscallSequence: request.syscallSequence,
          requestBytes: request.requestBytes,
          requestSha256: request.requestSha256,
          participant: request.operation.participant,
          method: request.operation.operation,
          profileRevision: fixture.productProfileRevision,
        }, () => {
          duplicateInvocations += 1;
          return Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection",
            cause: new CommerceTransactionError({ reason: "adapterFailure" }) }));
        },
      ));
      expect(duplicate).toMatchObject({ kind: "stateRejected",
        issue: { reason: "operationPending" } });
      expect(duplicateInvocations).toBe(0);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      if (running !== undefined) await running.catch(() => undefined);
      await fixture.close();
    }
  });

  it("discards the finite root after the Product service stages an update", async () => {
    const fixture = await createMixedMutationProductFixture({
      driver,
      suffix: `after-service-${driver}`,
      hooks: {
        afterNativeBeforeAck: method => method === "update"
          ? Effect.fail(new CommerceTransactionError({ reason: "adapterFailure" }))
          : Effect.void,
      },
    });
    try {
      const appRowsBefore = await fixture.currency.persistence.drizzle.select()
        .from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid))
        .orderBy(asc(fxAppRowRevisions.tableId), asc(fxAppRowRevisions.rowId),
          asc(fxAppRowRevisions.commitSeq));
      const workerError = await fixture.runExecution(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          const id = await ctx.db.insert("users", { name: "pending" });
          let caught = false;
          try { await ctx.privateMixed.call("medusa.product", "update",
            ${JSON.stringify(fixture.seed.updateInput)}); }
          catch { caught = true; }
          return { id, caught };
        },
      } } };`).then(() => null, cause => cause);
      if (!(workerError instanceof Error)) {
        throw new Error("Expected sticky journal boundary failure after catch");
      }
      expect(workerError.message).toContain("PointMutationExactRuntimeJournalBoundaryV1Error");
      expect(fixture.bridgeFailures.join("\n")).toContain("PointMutationJournalParticipantRejectedV1Error");
      const roots = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(0);
      expect(await inspectCurrentFiniteAnchor(fixture)).toMatchObject({ session: { lifecycle: "running", executionProfile: "finiteRoot" } });
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId))
        .orderBy(asc(fxSystemTransactionJournalReceipts.lastSyscallSequence));
      expect(receipts).toHaveLength(0);
      const reopened = await Effect.runPromise(fixture.reopenJournalAttempt());
      expect(reopened).toBe(fixture.attempt);
      const request = fixture.getUpdateRequest();
      if (request === undefined) throw new Error("Missing original Product request");
      await expect(Effect.runPromise(fixture.runAdmitted(request))).rejects.toMatchObject({
        _tag: "PointMutationJournalAdmittedOperationRejectedV1Error",
        result: { kind: "stateRejected", issue: { reason: "journalFailed" } },
      });
      expect(fixture.retryContexts).toHaveLength(0);
      expect(fixture.retryReturnedValues).toHaveLength(0);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      expect(fixture.nativeInvokeCount.get("retrieve") ?? 0).toBe(0);
      const events = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      const applicationRows = await fixture.currency.persistence.drizzle.select()
        .from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid))
        .orderBy(asc(fxAppRowRevisions.tableId), asc(fxAppRowRevisions.rowId),
          asc(fxAppRowRevisions.commitSeq));
      expect(applicationRows).toEqual(appRowsBefore);
      const committedRead = await Effect.runPromise(makeCommerceHost({
        ...fixture.product.hostInput,
        commands: [fixture.product.runtime.commands.retrieve],
      }));
      try {
        const committedProduct = await Effect.runPromise(committedRead.read(
          fixture.product.runtime.commands.retrieve,
          { id: fixture.seed.productId },
        ));
        expect(committedProduct).toMatchObject({
          id: fixture.seed.productId,
          title: fixture.baseline.title,
          handle: fixture.baseline.handle,
        });
      } finally {
        await Effect.runPromise(committedRead.close);
      }
      await expect(Effect.runPromise(fixture.freeze(null,
      ))).rejects.toBeDefined();
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it("interrupts a staged Product call and refuses finite settlement", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const fixture = await createMixedMutationProductFixture({
      driver,
      suffix: `interrupted-product-${driver}`,
      hooks: {
        afterNativeBeforeAck: method => method === "update"
          ? Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          })
          : Effect.void,
      },
    });
    const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result({
      format: ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1,
      version: ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
      participant: "medusa.product", operation: "update", args: fixture.seed.updateInput,
    }));
    const request = {
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      operation: encoded.operation,
      requestBytes: encoded.bytes,
      requestSha256: createHash("sha256").update(encoded.bytes).digest(),
    };
    const fiber = Effect.runFork(fixture.runAdmitted(request));
    try {
      await Promise.race([
        Effect.runPromise(Deferred.await(entered)),
        Effect.runPromise(Fiber.await(fiber)).then(() => {
          throw new Error("Admitted call ended before native staging");
        }),
      ]);
      // Exercise the persistence freeze directly while the native callback is
      // still active; the executor's serial journal would otherwise queue seal.
      expect(fixture.getOpenTransactionDepth()).toBe(0);
      await expect(Effect.runPromise(fixture.freezeFiniteRootDirect({ ok: true })))
        .rejects.toBeDefined();
      await expect(Effect.runPromise(fixture.freezeFiniteRootDirect({ ok: true })))
        .rejects.toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
      await Effect.runPromise(Fiber.interrupt(fiber));
      const interrupted = await Effect.runPromise(Fiber.await(fiber));
      expect(Exit.isFailure(interrupted)).toBe(true);
      if (!Exit.isFailure(interrupted)) throw new Error("Expected admitted Product interruption");
      expect(Cause.hasInterrupts(interrupted.cause)).toBe(true);
      expect(Cause.hasDies(interrupted.cause)).toBe(false);
      expect(fixture.getOpenTransactionDepth()).toBe(0);
      const roots = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(0);
      expect(await inspectCurrentFiniteAnchor(fixture)).toMatchObject({ session: { lifecycle: "running", executionProfile: "finiteRoot" } });
      const reopened = await Effect.runPromise(fixture.reopenJournalAttempt());
      expect(reopened).toBe(fixture.attempt);
      await expect(Effect.runPromise(fixture.runAdmitted(request))).rejects.toMatchObject({
        _tag: "PointMutationJournalAdmittedOperationRejectedV1Error",
        result: { kind: "stateRejected", issue: { reason: "journalFailed" } },
      });
      expect(fixture.retryContexts).toHaveLength(0);
      expect(fixture.retryReturnedValues).toHaveLength(0);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      const events = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      const committedRead = await Effect.runPromise(makeCommerceHost({
        ...fixture.product.hostInput,
        commands: [fixture.product.runtime.commands.retrieve],
      }));
      try {
        const committedProduct = await Effect.runPromise(committedRead.read(
          fixture.product.runtime.commands.retrieve,
          { id: fixture.seed.productId },
        ));
        expect(committedProduct).toMatchObject({
          id: fixture.seed.productId,
          title: fixture.baseline.title,
          handle: fixture.baseline.handle,
        });
      } finally {
        await Effect.runPromise(committedRead.close);
      }
      await expect(Effect.runPromise(fixture.freeze(null,
      ))).rejects.toBeDefined();
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.interrupt(fiber));
      await fixture.close();
    }
  });

  it("does not durably acknowledge a Product child on bridge response loss", async () => {
    let loseAcknowledgement = true;
    const fixture = await createMixedMutationProductFixture({
      driver,
      suffix: `ack-loss-${driver}`,
      hooks: {
        afterStoreAckBeforeBridgeReply: method => {
          if (method === "update" && loseAcknowledgement) {
            loseAcknowledgement = false;
            throw new Error("injected lost bridge acknowledgement");
          }
        },
      },
    });
    try {
      const first = await fixture.runExecution().catch(cause => cause);
      if (first instanceof Error) {
        expect(first.message).toContain("injected lost bridge acknowledgement");
      } else {
        expect(first).toMatchObject({ kind: "result" });
        expect(first).not.toMatchObject({ result: { kind: "success" } });
        expect(fixture.bridgeFailures.at(-1)).toContain("injected lost bridge acknowledgement");
      }
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
      const roots = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(0);
      expect(await inspectCurrentFiniteAnchor(fixture)).toMatchObject({ session: { lifecycle: "running", executionProfile: "finiteRoot" } });
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it.skipIf(driver !== "pglite")("refuses an expired snapshot before entering Product", async () => {
    const fixture = await createMixedMutationProductFixture({
      driver, suffix: `snapshot-expired-${driver}`,
    });
    try {
      const appRowsBefore = await fixture.currency.persistence.drizzle.select()
        .from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid))
        .orderBy(asc(fxAppRowRevisions.tableId), asc(fxAppRowRevisions.rowId),
          asc(fxAppRowRevisions.commitSeq));
      await fixture.currency.persistence.drizzle.update(fxSystemTransactionSessions)
        .set({ finiteClaimedAt: sql`clock_timestamp()-interval '3 minutes'`,
          finiteClaimExpiresAt: sql`clock_timestamp()-interval '2 minutes'`, finiteLeaseExpiresAt: sql`clock_timestamp()-interval '1 minute'` })
        .where(eq(fxSystemTransactionSessions.sessionId,
          fixture.activation.anchor.sessionId));
      const failure = await fixture.runExecution().then(() => null, cause => cause);
      if (!(failure instanceof Error)) {
        throw new Error("Expected expired snapshot to reject the Worker");
      }
      expect(failure.message).toContain("PointMutationExactRuntimeJournalBoundaryV1Error");
      expect(fixture.nativeInvokeCount.get("update") ?? 0).toBe(0);
      const applicationRows = await fixture.currency.persistence.drizzle.select()
        .from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid))
        .orderBy(asc(fxAppRowRevisions.tableId), asc(fxAppRowRevisions.rowId),
          asc(fxAppRowRevisions.commitSeq));
      expect(applicationRows).toEqual(appRowsBefore);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
    } finally {
      await expectExpiredMixedOwnerCleanup(fixture.close);
    }
  });

  it("publishes a frozen Product root and replays its durable outcome without a service rerun", async () => {
    const fixture = await createMixedMutationProductFixture({
      driver, suffix: `sealed-finish-${driver}`,
    });
    try {
      const workerd = await fixture.runExecution();
      const success = Schema.decodeUnknownSync(Schema.Struct({
        kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }),
      }))(workerd);
      const returnedValue = (await Effect.runPromise(
        decodePointMutationExactRuntimeResultV1Effect(success.result.result),
      )).value;
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      const publication = await fixture.preparePublication(returnedValue);
      const sealed = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(sealed).toHaveLength(0);
      const published = await Effect.runPromise(publication);
      expect(published).toMatchObject({ kind: "published" });
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      expect(fixture.nativeInvokeCount.get("retrieve")).toBe(1);
      expect(fixture.nativeInvokeCount.get("listByHandle")).toBe(1);
      const events = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(1);
      await fixture.replayPublication();
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      const afterReplay = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid));
      expect(afterReplay.filter(event => event.envelope.group === fixture.eventGroup))
        .toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("recovers an expired finite claim after native nonacceptance and replays one commit", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const fixture = await createMixedMutationProductFixture({
      driver,
      suffix: `expired-invocation-${driver}`,
      hooks: {
        beforeNative: method => method === "update"
          ? Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          })
          : Effect.void,
      },
    });
    let running: Promise<unknown> | undefined;
    try {
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const sessionId = fixture.activation.anchor.sessionId;
      const database = fixture.currency.persistence.drizzle;
      const selector = selectorFromRelationAnchor(fixture.activation.anchor);
      const inspectChildren = async () => ({
        journals: await database.select().from(fxSystemTransactionJournals).where(eq(fxSystemTransactionJournals.sessionId, sessionId)),
        receipts: await database.select().from(fxSystemTransactionJournalReceipts).where(eq(fxSystemTransactionJournalReceipts.sessionId, sessionId)),
        points: await database.select().from(fxSystemTransactionJournalPoints).where(eq(fxSystemTransactionJournalPoints.sessionId, sessionId)),
        indexes: await database.select().from(fxSystemTransactionJournalIndexRanges).where(eq(fxSystemTransactionJournalIndexRanges.sessionId, sessionId)),
        relations: await database.select().from(fxSystemTransactionJournalRelationIncomingDependencies).where(eq(fxSystemTransactionJournalRelationIncomingDependencies.sessionId, sessionId)),
        events: await database.select().from(fxSystemTransactionJournalWriteEvents).where(eq(fxSystemTransactionJournalWriteEvents.sessionId, sessionId)),
      });
      const commitsBefore = await database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid));
      const eventsBefore = await database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)).orderBy(fxSystemCommitEvents.epochUuid, fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
      const pending = fixture.runExecution();
      running = pending;
      await Promise.race([
        Effect.runPromise(Deferred.await(entered)),
        pending.then(() => { throw new Error("Worker ended before Product update"); }),
      ]);
      expect(await inspectChildren()).toEqual({ journals: [], receipts: [], points: [], indexes: [], relations: [], events: [] });
      await database.update(fxSystemTransactionSessions)
        .set({ finiteClaimedAt: sql`clock_timestamp() - interval '2 minutes'`,
          finiteClaimExpiresAt: sql`clock_timestamp() - interval '1 minute'` })
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
      const expired = await database.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
      const next = await Effect.runPromise(
        createPointMutationExecutionClaimAcquisitionV1(fixture.application.sessionAuthority,
          { durationMilliseconds: 30_000, randomOwner: () => "42000000-0000-4000-8000-000000008120" })
          .acquireEffect(selector),
      );
      expect(next.kind).toBe("finiteRecovery");
      if (next.kind !== "finiteRecovery") throw new Error("Expected authentic inert finite recovery evidence");
      const recovery = Result.getOrThrow(readFiniteRecoveryAttempt(next.capture));
      expect(recovery.anchor.sessionId).toBe(sessionId);
      expect(recovery.anchor.attemptFence).toBe(fixture.activation.anchor.attemptFence);
      expect(recovery.anchor.snapshotToken).toEqual(fixture.activation.anchor.snapshotToken);
      expect(recovery.executionClaim.claimOwner).toBe(fixture.activation.executionClaim.claimOwner);
      expect(recovery.executionClaim.claimFence).toBe(fixture.activation.executionClaim.claimFence);
      const originalClaimOwner = recovery.executionClaim.claimOwner;
      expect(Reflect.set(recovery.executionClaim, "claimOwner", "42000000-0000-4000-8000-000000008121")).toBe(true);
      expect(Result.getOrThrow(readFiniteRecoveryAttempt(next.capture)).executionClaim.claimOwner).toBe(originalClaimOwner);
      expect(await database.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId))).toEqual(expired);
      expect(await database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)).orderBy(fxSystemCommitEvents.epochUuid, fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal)).toEqual(eventsBefore);
      expect(await inspectChildren()).toEqual({ journals: [], receipts: [], points: [], indexes: [], relations: [], events: [] });
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const oldCompletion = await running.catch(cause => cause);
      expect(oldCompletion).toBeInstanceOf(Error);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      expect(Result.isFailure(await Effect.runPromise(fixture.freeze(null).pipe(Effect.result)))).toBe(true);
      expect(await database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid))).toEqual(commitsBefore);
      const committedRead = await Effect.runPromise(makeCommerceHost({
        ...fixture.product.hostInput,
        commands: [fixture.product.runtime.commands.retrieve],
      }));
      try {
        expect(await Effect.runPromise(committedRead.read(fixture.product.runtime.commands.retrieve,
          { id: fixture.seed.productId }))).toMatchObject({
          id: fixture.seed.productId, title: fixture.baseline.title, handle: fixture.baseline.handle,
        });
      } finally { await Effect.runPromise(committedRead.close); }
      expect(await database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)).orderBy(fxSystemCommitEvents.epochUuid, fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal)).toEqual(eventsBefore);

      const published = await Effect.runPromise(fixture.makeFiniteDispatcher().redispatchExactPointMutationAttempt({
        ...selector, attemptFence: fixture.activation.anchor.attemptFence.toString(),
      }));
      expect(published).toMatchObject({ kind: "published" });
      expect(fixture.retryContexts).toHaveLength(1);
      const fresh = fixture.retryContexts[0];
      if (fresh === undefined) throw new Error("Missing authentic recovered whole-root context");
      expect(fresh.attemptFence).toBe(fixture.activation.anchor.attemptFence + 1n);
      expect(fresh.snapshotToken).toEqual(fixture.activation.anchor.snapshotToken);
      expect(fixture.nativeInvokeCount.get("update")).toBe(2);
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle, handle: fixture.seed.newHandle });
      const committed = await database.select().from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, sessionId));
      expect(committed).toHaveLength(1);
      expect(committed[0]).toMatchObject({ lifecycle: "committed", attemptFence: fresh.attemptFence });
      const commitsAfter = await database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid));
      expect(commitsAfter).toHaveLength(commitsBefore.length + 1);
      const eventsAfter = await database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)).orderBy(fxSystemCommitEvents.epochUuid, fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
      const freshEventGroup = admittedCommerceEventGroup({ scopeUuid, sessionId, attemptFence: fresh.attemptFence });
      expect(eventsAfter).toHaveLength(eventsBefore.length + 1);
      expect(eventsAfter.filter(event => event.envelope.group === freshEventGroup)).toHaveLength(1);
      expect(eventsAfter.filter(event => event.envelope.group !== freshEventGroup)).toEqual(eventsBefore);
      expect(eventsAfter.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      expect(await inspectChildren()).toEqual({ journals: [], receipts: [], points: [], indexes: [], relations: [], events: [] });
      const replayed = await Effect.runPromise(fixture.makeFiniteDispatcher().redispatchExactPointMutationAttempt({
        ...selector, attemptFence: fresh.attemptFence.toString(),
      }));
      expect(replayed).toMatchObject({ kind: "replayed", token: published.kind === "busy" ? undefined : published.token });
      expect(fixture.nativeInvokeCount.get("update")).toBe(2);
      expect(fixture.retryContexts).toHaveLength(1);
      expect(await database.select().from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, sessionId))).toEqual(committed);
      expect(await database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid))).toEqual(commitsAfter);
      expect(await database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)).orderBy(fxSystemCommitEvents.epochUuid, fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal)).toEqual(eventsAfter);
      expect(await inspectChildren()).toEqual({ journals: [], receipts: [], points: [], indexes: [], relations: [], events: [] });
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      if (running !== undefined) await running.catch(() => undefined);
      await expectExpiredMixedOwnerCleanup(fixture.close, "staleAttemptFence");
    }
  });
});

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)(
  "native mixed mutation PostgreSQL driver uncertainty", () => {
    it("resolves final Product COMMIT acknowledgement loss without rerunning callbacks", async () => {
      const fixture = await createMixedMutationProductFixture({
        driver: "postgres",
        suffix: "driver-commit-ack-loss",
      });
      if (fixture.currency.resource.kind !== "postgres") {
        throw new Error("PostgreSQL fixture required");
      }
      const workerd = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(
        await fixture.runExecution());
      const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        workerd.result.result))).value;
      const callsBefore = Object.fromEntries(fixture.nativeInvokeCount);
      expect(callsBefore).toMatchObject({ update: 1, retrieve: 1, listByHandle: 1 });
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const commitsBefore = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid));
      const fault = await installOneCommitResponseFault(fixture, commitsBefore.length,
        () => { throw new Error("injected driver COMMIT acknowledgement loss"); });
      try {
        const publication = await fixture.preparePublication(returnedValue);
        expect(await Effect.runPromise(publication)).toMatchObject({ kind: "replayed" });
        expect(fault.fired()).toBe(true);
        expect(fixture.nativeInvokeCount.get("update")).toBe(1);
        expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(callsBefore);
        expect(await fixture.currency.persistence.drizzle.select()
          .from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)))
          .toHaveLength(commitsBefore.length + 1);
        const roots = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemTransactionJournals)
          .where(eq(fxSystemTransactionJournals.sessionId,
            fixture.activation.anchor.sessionId));
        expect(roots).toHaveLength(0);
        const receipts = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemTransactionJournalReceipts)
          .where(eq(fxSystemTransactionJournalReceipts.sessionId,
            fixture.activation.anchor.sessionId));
        expect(receipts).toHaveLength(0);
        const request = fixture.getUpdateRequest();
        if (request === undefined) throw new Error("Missing accepted Product request");
        await expect(Effect.runPromise(fixture.runAdmitted(request))).rejects.toBeDefined();
        expect(fixture.nativeInvokeCount.get("update")).toBe(1);
        const events = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemCommitEvents)
          .where(eq(fxSystemCommitEvents.scopeUuid,
            projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid));
        expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(1);
        expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
        expect(fixture.nativeInvokeCount.get("update")).toBe(1);
        expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(callsBefore);
        expect(fixture.retryContexts).toHaveLength(0);
        expect(fixture.retryReturnedValues).toHaveLength(0);
        expect(await fixture.currency.persistence.drizzle.select()
          .from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)))
          .toHaveLength(commitsBefore.length + 1);
        const eventsAfterReplay = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
        expect(eventsAfterReplay.filter(event => event.envelope.group === fixture.eventGroup))
          .toHaveLength(1);
      } finally {
        fault.restore();
        await fixture.close();
      }
    });
  },
);

it("refuses a Product capability from another scope on the same physical target", async () => {
  const first = await createMixedMutationProductFixture({
    driver: "pglite", suffix: "foreign-scope-first",
  });
  let second: Awaited<ReturnType<typeof createMixedMutationProductFixture>> | undefined;
  try {
    second = await createMixedMutationProductFixture({
      driver: "pglite", suffix: "foreign-scope-second",
      resource: first.currency.resource,
      fixtureIdentity: { deploymentId: "mixed_foreign_deployment",
        projectId: "mixed_foreign_project", uuidOffset: 300 },
    });
    expect(second.activation.anchor.scopeId).not.toBe(first.activation.anchor.scopeId);
    const firstHandle = first.persistenceAttempt;
    const foreignHandle = second.persistenceAttempt;
    const foreignAdmission = await Effect.runPromise(
      second.store.admitLogicalParticipantsEffect(foreignHandle, {
        participant: "medusa.product",
        operationMethods: ["update", "retrieve", "listByHandle"],
        profileRevision: second.productProfileRevision,
        sources: [{ selection: second.prepared,
          application: second.active.selection,
          methods: ["update", "retrieve", "listByHandle"] }],
      }),
    );
    const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result({
      format: ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1,
      version: ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
      participant: "medusa.product", operation: "update", args: first.seed.updateInput,
    }));
    let invoked = 0;
    await expect(Effect.runPromise(first.store.runAdmittedOperationEffect(
      firstHandle, foreignAdmission, {
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        requestBytes: encoded.bytes,
        requestSha256: createHash("sha256").update(encoded.bytes).digest(),
        participant: "medusa.product", method: "update",
        profileRevision: first.productProfileRevision,
      }, () => {
        invoked += 1;
        return Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection",
          cause: new CommerceTransactionError({ reason: "adapterFailure" }) }));
      },
    ))).rejects.toBeInstanceOf(InvalidSessionJournalCapabilityV1Error);
    expect(invoked).toBe(0);
    expect(first.nativeInvokeCount.get("update") ?? 0).toBe(0);
    expect(second.nativeInvokeCount.get("update") ?? 0).toBe(0);
  } finally {
    if (second !== undefined) await second.close();
    await first.close();
  }
});
