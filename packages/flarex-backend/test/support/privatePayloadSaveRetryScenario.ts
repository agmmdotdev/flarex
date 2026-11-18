import { Deferred, Effect, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { fxAppRowCurrent, fxSystemTransactionSessions } from "../../../persistence-postgres/src/database/schema";
import { ApplicationPointMutationRunnerHostV1Error } from "../../../executor/src/mutation/authentication/storedAttemptAuthentication";
import type { PointMutationOccRuntimeNeutralRunnerV1 } from "../../../executor/src/mutation/authentication/storedAttemptAuthentication";
import { withTimeout } from "../../../persistence-postgres/test/commit/point/support/postgresFaults";
import { makePrivateSaveExecution, type PrivateSaveExecution } from "./privatePayloadSaveExecution";
import { bindPrivatePayloadSaveEffect, preparePrivateSavePolicy } from "./privatePayloadSaveCommands";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

const ids = Schema.decodeUnknownSync(Schema.Struct({ articleId: Schema.String, userId: Schema.String }));
const article = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));

/** Exercise the existing executor's real one-shot retry and redispatch owners;
 * the scenario only arranges revocation, runs native work and observes state. */
export async function privatePayloadSaveRetryScenario(fixture: PrivatePayloadSaveFixture) {
  const db = fixture.fixture.application.persistence.drizzle;
  const scopeId = fixture.fixture.application.authority.scopeId;
  const counts = () => publishedScopeCounts(db, scopeId);
  const product = article(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
    fixture.productRuntime.commands.internalProductCreate, { title: "Retry Product", handle: "private-save-retry-product" })));
  const allow = { source: { create: true, update: true, delete: true }, assign: [product.id], retain: [product.id] };
  const initial = await preparePrivateSavePolicy(fixture, allow);
  await initial.root.publish();
  const policyId = initial.documentId;
  const absent = async (id: string) => {
    const identity = decodeAppDocumentIdentityV1(id);
    expect(await db.select({ id: fxAppRowCurrent.rowId }).from(fxAppRowCurrent).where(and(
      eq(fxAppRowCurrent.scopeUuid, projectScopeIdUuidV1(scopeId).scopeUuid), eq(fxAppRowCurrent.tableId, identity.tableId),
      eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(identity.rowId))))).toHaveLength(0);
  };
  for (const mode of ["changedAllow", "revoked"] as const) {
    const reset = await preparePrivateSavePolicy(fixture, allow, policyId);
    await reset.root.publish();
    const entered = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    let execution: PrivateSaveExecution | undefined;
    let nativeCalls = 0, hooks = 0;
    const observations: { sessionId: string; fence: bigint; snapshot: bigint; profile: string }[] = [];
    const values: ReturnType<typeof ids>[] = [];
    const run: PointMutationOccRuntimeNeutralRunnerV1["run"] = Effect.fn("PrivatePayloadSaveRetry.nativeWork")(function* () {
      if (execution === undefined) return yield* Effect.die(new Error("Missing genuine execution owner"));
      const active = execution;
      const root = active.currentRoot();
      const saving = yield* bindPrivatePayloadSaveEffect(fixture, root, policyId,
        { instrumentation: { hooks: { beforeChange: [({ data }) => { hooks++; return data; }] }, onExecute: () => { nativeCalls++; } } });
      return yield* Effect.gen(function* () {
        active.selectProfile(saving.selected.profileRevision);
        observations.push({ sessionId: root.context.anchor.sessionId, fence: root.context.anchor.attemptFence,
          snapshot: root.context.anchor.snapshotToken.commitSeq, profile: saving.selected.profileRevision });
        const created = yield* saving.invoke("create", { collection: "posts", data: { title: mode, featuredProduct: product.id } }, 2n);
        if (created.kind !== "completed") return yield* Effect.die(new Error("Expected executed native create"));
        const users = yield* fixture.fixture.store.resolvePointTableEffect(root.attempt, "users");
        const inserted = yield* fixture.fixture.store.runPointOperationEffect(users, { kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(3n), fields: { name: `Application work ${mode}` } }, root.validator);
        if (inserted.kind !== "completed" || inserted.outcome.kind !== "inserted") return yield* Effect.die(new Error("Expected actual Application write"));
        const value = { articleId: article(created.result).id, userId: inserted.outcome.documentId };
        values.push(value);
        return value;
      }).pipe(Effect.ensuring(saving.closeEffect));
    }, Effect.mapError(cause => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause })));
    const initialWork = Effect.runPromise(fixture.withPreparation(preparation => Effect.gen(function* () {
      const owned = yield* makePrivateSaveExecution(fixture, preparation, { run });
      execution = owned;
      return yield* owned.owner.runPreparedFiniteAttempt(owned.prepared, entry => run(entry.runnerInput).pipe(
        Effect.tap(() => Deferred.succeed(entered, undefined)), Effect.tap(() => Deferred.await(release)),
        Effect.flatMap(entry.prepareFiniteCommit), Effect.flatMap(entry.settleFiniteCommit)));
    })));
    const done = Promise.allSettled([initialWork]);
    try {
      await withTimeout(Effect.runPromise(Deferred.await(entered)), 30_000, "native and Application work staged before revocation");
      const changed = mode === "revoked" ? { source: { ...allow.source, create: false }, assign: [], retain: [] } : { ...allow, retain: [] };
      const revocation = await preparePrivateSavePolicy(fixture, changed, policyId);
      await revocation.root.publish();
      const before = await counts();
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const first = (await done)[0];
      if (first?.status !== "rejected" || execution === undefined) throw new Error("Expected an actual conflicted first attempt");
      expect(first.reason).toMatchObject({ _tag: "PointCommitConflictV1Error" });
      expect(await counts()).toEqual(before);
      const discarded = values[0];
      if (discarded === undefined) throw new Error("Missing actual first native result");
      await absent(discarded.articleId); await absent(discarded.userId);
      await expect(Effect.runPromise(execution.owner.retryFailedAttempt({ ...first.reason })))
        .rejects.toMatchObject({ _tag: "FinitePointMutationExecutionError", reason: "unprovenRetry" });
      const retried = await Effect.runPromise(execution.owner.retryFailedAttempt(first.reason).pipe(Effect.result));
      expect(observations).toHaveLength(2);
      expect(observations[1]).toMatchObject({ sessionId: observations[0]?.sessionId, fence: 2n });
      expect(observations[1]!.snapshot).toBeGreaterThan(observations[0]!.snapshot);
      expect(observations[1]!.profile).not.toBe(observations[0]!.profile);
      expect(nativeCalls).toBe(2);
      if (mode === "revoked") {
        expect(retried).toMatchObject({ _tag: "Failure", failure: { _tag: "ApplicationPointMutationRunnerHostV1Error", reason: "terminalFailed" } });
        if (Result.isSuccess(retried) || !(retried.failure instanceof ApplicationPointMutationRunnerHostV1Error))
          throw new Error("Expected the actual runtime failure projection");
        expect(retried.failure.cause).toMatchObject({ _tag: "LogicalParticipantInvocationError", kind: "rejection",
          cause: { _tag: "CmsTransactionError", reason: "invalidInput", cause: { status: 403 } } });
        expect(hooks).toBe(1); // Fresh native source access denies before change hooks.
        expect(values).toHaveLength(1);
        expect(await counts()).toEqual(before);
      } else {
        expect(retried).toMatchObject({ _tag: "Success", success: { kind: "published" } });
        expect(hooks).toBe(2);
        expect(values).toHaveLength(2);
        expect(values[1]?.articleId).not.toBe(discarded.articleId);
        expect(values[1]?.userId).not.toBe(discarded.userId);
        expect(await counts()).toMatchObject({ commits: before.commits + 1, outcomes: before.outcomes + 1,
          rows: before.rows + 2, revisions: before.revisions + 2, rowFacts: before.rowFacts + 2, events: before.events });
        const laterRevocation = await preparePrivateSavePolicy(fixture, { source: { ...allow.source, create: false }, assign: [], retain: [] }, policyId);
        await laterRevocation.root.publish();
      }
      const settled = await counts(), calls = nativeCalls;
      const current = execution.currentRoot().context.anchor;
      expect(await db.select({ lifecycle: fxSystemTransactionSessions.lifecycle, fence: fxSystemTransactionSessions.attemptFence })
        .from(fxSystemTransactionSessions).where(and(eq(fxSystemTransactionSessions.scopeUuid, projectScopeIdUuidV1(scopeId).scopeUuid),
          eq(fxSystemTransactionSessions.sessionId, current.sessionId)))).toEqual([{ lifecycle: mode === "changedAllow" ? "committed" : "aborted", fence: 2n }]);
      const redispatched = await Effect.runPromise(execution.owner.redispatchExactPointMutationAttempt({
        deploymentId: current.deploymentId, scopeId: current.scopeId, sessionId: current.sessionId, attemptFence: current.attemptFence.toString(),
      }).pipe(Effect.result));
      expect(redispatched).toMatchObject(mode === "changedAllow" ? { _tag: "Success", success: { kind: "replayed", successfulResult: { valueJson: values[1] } } }
        : { _tag: "Failure", failure: { _tag: "PointMutationExecutionClaimAcquisitionStaleV1Error", reason: "lifecycle" } });
      expect(nativeCalls).toBe(calls);
      expect(await counts()).toEqual(settled);
      await expect(Effect.runPromise(execution.owner.retryFailedAttempt(first.reason)))
        .rejects.toMatchObject({ reason: "unprovenRetry" });
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); await done; }
  }
}
