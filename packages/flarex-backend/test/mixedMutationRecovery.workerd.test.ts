import { createHash } from "node:crypto";
import { and, asc, eq, getTableName, sql } from "drizzle-orm";
import { Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CommerceTransactionError } from
  "@flarex/persistence-postgres/internal/commerce-values";
import { LogicalParticipantInvocationError } from
  "@flarex/persistence-postgres/internal/logical-participant-admission";
import { makeCommerceHost } from
  "../../persistence-postgres/src/commerceTransaction/host";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1,
  ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
  encodeAdmittedFrameworkOperationV1Result } from
  "flarex-protocol/internal/admitted-framework-operation-v1";
import { fxSystemCommitEvents } from
  "../../persistence-postgres/src/commitEvents/schema";
import { createStoredOccExecutionEvidenceLoaderV1 } from
  "@flarex/persistence-postgres/stored-occ-execution";
import {
  fxAppRowRevisions,
  fxSystemTransactionExecutionClaims,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionJournals,
} from "../../persistence-postgres/src/schema";
import { createMixedMutationProductFixture } from
  "./support/mixedMutationProductFixture";
import { selectorFromRelationAnchor } from
  "../../persistence-postgres/test/pointCommitRelationTestSupport";
import { createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1 } from
  "../../persistence-postgres/src/transactionSessionActivation";
import { type PostgresLocatedReadCommittedRunnerOptionsV1 } from
  "../../persistence-postgres/src/postgresLocatedReadCommitted";

type PostgresClient = Parameters<NonNullable<
  PostgresLocatedReadCommittedRunnerOptionsV1["afterAcquire"]>>[0];

function isPostgresClient(value: unknown): value is PostgresClient {
  return typeof value === "object" && value !== null &&
    "query" in value && typeof value.query === "function" &&
    "release" in value && typeof value.release === "function";
}

function classifyCurrentExecutionRoot(
  fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>,
) {
  const anchor = fixture.activation.anchor;
  return Effect.runPromise(createStoredOccExecutionEvidenceLoaderV1(
    fixture.application.sessionAuthority,
  ).loadEffect({
    kind: "claimedAttempt",
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    scopeUuid: projectScopeIdUuidV1(anchor.scopeId).scopeUuid,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    snapshotToken: anchor.snapshotToken,
    schemaVersionId: fixture.schemaVersionId,
    executionClaim: Object.freeze({
      claimOwner: fixture.activation.executionClaim.claimOwner,
      claimFence: fixture.activation.executionClaim.claimFence,
    }),
  }));
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
      const workerError = await fixture.runWorkerd(`export default { users: { create: {
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
      const secondHandle = await Effect.runPromise(fixture.store.openAttemptEffect({
        selector: selectorFromRelationAnchor(fixture.activation.anchor),
        snapshotToken: fixture.activation.anchor.snapshotToken,
        schemaVersionId: fixture.schemaVersionId,
        executionClaim: fixture.activation.executionClaim,
        executionProfile: "finiteRoot",
      }));
      const canonicalHandle = await Effect.runPromise(fixture.store.openAttemptEffect({
        selector: selectorFromRelationAnchor(fixture.activation.anchor),
        snapshotToken: fixture.activation.anchor.snapshotToken,
        schemaVersionId: fixture.schemaVersionId,
        executionClaim: fixture.activation.executionClaim,
        executionProfile: "finiteRoot",
      }));
      expect(canonicalHandle).toBe(secondHandle);
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
      const pending = fixture.runWorkerd();
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
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatchObject({ state: "open", executionProfile: "finiteRoot",
        lastSyscallSequence: 0n,
        scopeUuid: projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid,
        attemptFence: fixture.activation.anchor.attemptFence });
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
      expect(await classifyCurrentExecutionRoot(fixture)).toMatchObject({
        kind: "loaded",
      });
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
      const workerError = await fixture.runWorkerd(`export default { users: { create: {
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
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatchObject({ state: "open", lastSyscallSequence: 0n });
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId))
        .orderBy(asc(fxSystemTransactionJournalReceipts.lastSyscallSequence));
      expect(receipts).toHaveLength(0);
      await expect(Effect.runPromise(fixture.reopenJournalAttempt()))
        .rejects.toBeDefined();
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
      await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(
        fixture.attempt, null,
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
      await expect(Effect.runPromise(fixture.sealFiniteRootDirect({ ok: true })))
        .rejects.toBeDefined();
      expect(fixture.journal.confirmedSealCapture?.(fixture.attempt)).toBeUndefined();
      await Effect.runPromise(Fiber.interrupt(fiber));
      const interrupted = await Effect.runPromise(Fiber.await(fiber));
      expect(Exit.isFailure(interrupted)).toBe(true);
      const roots = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(roots[0]).toMatchObject({ state: "open",
        lastSyscallSequence: 0n });
      await expect(Effect.runPromise(fixture.reopenJournalAttempt()))
        .rejects.toBeDefined();
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
      await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(
        fixture.attempt, null,
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
      const first = await fixture.runWorkerd().catch(cause => cause);
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
      expect(roots[0]).toMatchObject({ state: "open", lastSyscallSequence: 0n });
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
      await fixture.currency.persistence.drizzle.update(fxSystemSnapshotLeases)
        .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 minute'` })
        .where(eq(fxSystemSnapshotLeases.sessionId,
          fixture.activation.anchor.sessionId));
      const failure = await fixture.runWorkerd().then(() => null, cause => cause);
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
      await fixture.close();
    }
  });

  it("finishes a sealed native Product attempt from durable evidence without a service rerun", async () => {
    const fixture = await createMixedMutationProductFixture({
      driver, suffix: `sealed-finish-${driver}`,
    });
    try {
      const workerd = await fixture.runWorkerd();
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
      expect(sealed[0]?.state).toBe("sealed");
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

  it("treats an expired finite root as an abort-only claim takeover", async () => {
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
      const pending = fixture.runWorkerd();
      running = pending;
      await Promise.race([
        Effect.runPromise(Deferred.await(entered)),
        pending.then(() => { throw new Error("Worker ended before Product update"); }),
      ]);
      const before = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(before[0]).toMatchObject({ state: "open", lastSyscallSequence: 0n });
      await fixture.currency.persistence.drizzle.update(fxSystemTransactionExecutionClaims)
        .set({ claimedAt: sql`clock_timestamp() - interval '2 minutes'`,
          claimExpiresAt: sql`clock_timestamp() - interval '1 minute'` })
        .where(eq(fxSystemTransactionExecutionClaims.sessionId,
          fixture.activation.anchor.sessionId));
      const next = await Effect.runPromise(
        createPointMutationExecutionClaimAcquisitionV1(
          fixture.application.sessionAuthority,
          { durationMilliseconds: 30_000,
            randomOwner: () => "42000000-0000-4000-8000-000000008120" },
        ).acquireEffect(selectorFromRelationAnchor(fixture.activation.anchor)),
      );
      expect(next).toMatchObject({ kind: "acquired", mode: "abortOnly",
        reason: "dirtyOpen" });
      if (next.kind !== "acquired") throw new Error("Expected replacement claim");
      const after = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(after[0]).toMatchObject({ state: "open", lastSyscallSequence: 0n });
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const oldCompletion = await running.catch(cause => cause);
      expect(oldCompletion).toBeInstanceOf(Error);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      const terminal = await Effect.runPromise(
        createPointMutationSessionAttemptTerminalizationPersistenceV1(
          fixture.application.sessionAuthority,
        ).abortEffect({
          selector: selectorFromRelationAnchor(fixture.activation.anchor),
          expectedSnapshotToken: fixture.activation.anchor.snapshotToken,
          executionClaim: next.observation,
        }),
      );
      expect(terminal).toMatchObject({ status: "terminalized",
        terminal: { lifecycle: "aborted" } });
      const journalAfterAbort = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(journalAfterAbort).toHaveLength(0);
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
      const events = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      if (running !== undefined) await running.catch(() => undefined);
      await fixture.close();
    }
  });
});

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)(
  "native mixed mutation PostgreSQL driver uncertainty", () => {
    it("retains the sealed Product root after aggregate-seal COMMIT acknowledgement loss", async () => {
      let lostAcknowledgement = false;
      let acquiredClients = 0;
      const fixture = await createMixedMutationProductFixture({
        driver: "postgres",
        suffix: "driver-commit-ack-loss",
      });
      if (fixture.currency.resource.kind !== "postgres") {
        throw new Error("PostgreSQL fixture required");
      }
      const workerd = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(
        await fixture.runWorkerd());
      const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        workerd.result.result))).value;
      const pool = fixture.currency.resource.target.pool;
      const connectDescriptor = Object.getOwnPropertyDescriptor(pool, "connect");
      const connect = pool.connect;
      const restoreQueries: Array<() => void> = [];
      const decorate = (candidate: unknown): void => {
        if (!isPostgresClient(candidate)) return;
        acquiredClients += 1;
        const queryDescriptor = Object.getOwnPropertyDescriptor(candidate, "query");
        const query = candidate.query;
        let aggregateReceiptsInserted = false;
        if (!Reflect.set(candidate, "query", (...args: readonly unknown[]): unknown => {
          const statement = args[0];
          const sql = typeof statement === "string" ? statement :
            typeof statement === "object" && statement !== null &&
              "text" in statement && typeof statement.text === "string"
              ? statement.text : "";
          if (sql.toLowerCase().includes("fx_system_tx_journal_receipt") &&
            sql.trimStart().toLowerCase().startsWith("insert")) aggregateReceiptsInserted = true;
          const result: unknown = Reflect.apply(query, candidate, args);
          if (sql.trim().toLowerCase() === "commit" && aggregateReceiptsInserted &&
            !lostAcknowledgement) {
            return Promise.resolve(result).then(() => {
              lostAcknowledgement = true;
              throw new Error("injected driver COMMIT acknowledgement loss");
            });
          }
          return result;
        })) throw new Error("Could not install COMMIT acknowledgement fault");
        restoreQueries.push(() => {
          if (queryDescriptor === undefined) Reflect.deleteProperty(candidate, "query");
          else Object.defineProperty(candidate, "query", queryDescriptor);
        });
      };
      if (!Reflect.set(pool, "connect", (...args: readonly unknown[]): unknown => {
        const callback = args[0];
        if (args.length === 1 && typeof callback === "function") {
          return Reflect.apply(connect, pool, [(...callbackArgs: readonly unknown[]) => {
            decorate(callbackArgs[1]);
            return Reflect.apply(callback, undefined, callbackArgs);
          }]);
        }
        if (args.length > 0) return Reflect.apply(connect, pool, args);
        const acquired: unknown = Reflect.apply(connect, pool, args);
        return Promise.resolve(acquired).then(client => {
          decorate(client);
          return client;
        });
      })) throw new Error("Could not install PostgreSQL connection fault");
      try {
        await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(
          fixture.attempt, returnedValue))).rejects.toBeDefined();
        expect(lostAcknowledgement, `acquired=${acquiredClients}`).toBe(true);
        expect(fixture.nativeInvokeCount.get("update")).toBe(1);
        const roots = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemTransactionJournals)
          .where(eq(fxSystemTransactionJournals.sessionId,
            fixture.activation.anchor.sessionId));
        expect(roots).toMatchObject([{ state: "sealed", lastSyscallSequence: 5n }]);
        const receipts = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemTransactionJournalReceipts)
          .where(eq(fxSystemTransactionJournalReceipts.sessionId,
            fixture.activation.anchor.sessionId));
        expect(receipts.filter(receipt => receipt.outcomeKind ===
          "admittedLogicalResult")).toHaveLength(3);
        const request = fixture.getUpdateRequest();
        if (request === undefined) throw new Error("Missing accepted Product request");
        await expect(Effect.runPromise(fixture.runAdmitted(request))).rejects.toBeDefined();
        expect(fixture.nativeInvokeCount.get("update")).toBe(1);
        const events = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemCommitEvents)
          .where(eq(fxSystemCommitEvents.scopeUuid,
            projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid));
        expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      } finally {
        for (const restore of restoreQueries.toReversed()) restore();
        if (connectDescriptor === undefined) Reflect.deleteProperty(pool, "connect");
        else Object.defineProperty(pool, "connect", connectDescriptor);
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
    const firstHandle = await Effect.runPromise(first.store.openAttemptEffect({
      selector: selectorFromRelationAnchor(first.activation.anchor),
      snapshotToken: first.activation.anchor.snapshotToken,
      schemaVersionId: first.schemaVersionId,
      executionClaim: first.activation.executionClaim,
      executionProfile: "finiteRoot",
    }));
    const foreignHandle = await Effect.runPromise(second.store.openAttemptEffect({
      selector: selectorFromRelationAnchor(second.activation.anchor),
      snapshotToken: second.activation.anchor.snapshotToken,
      schemaVersionId: second.schemaVersionId,
      executionClaim: second.activation.executionClaim,
      executionProfile: "finiteRoot",
    }));
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
    ))).rejects.toMatchObject({ _tag: "InvalidSessionJournalCapabilityV1Error" });
    expect(invoked).toBe(0);
    expect(first.nativeInvokeCount.get("update") ?? 0).toBe(0);
    expect(second.nativeInvokeCount.get("update") ?? 0).toBe(0);
  } finally {
    if (second !== undefined) await second.close();
    await first.close();
  }
});
