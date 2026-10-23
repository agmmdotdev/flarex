import { Deferred, Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { appRowIdHexV1ToBytes, decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { fxAppRowCurrent } from "../../../persistence-postgres/src/database/schema";
import { ApplicationPointMutationRunnerHostV1Error, type PointMutationOccRuntimeNeutralRunnerV1 } from "../../../executor/src/mutation/authentication/storedAttemptAuthentication";
import { inspectPrivateReverseReadAccess } from "../../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import { withTimeout } from "../../../persistence-postgres/test/commit/point/support/postgresFaults";
import { preparePrivateReverseReadCommands, preparePrivateReverseReadPolicy, preparePrivateReverseReadProfile } from "./privatePayloadReverseReadCommands";
import { makePrivateSaveExecution, type PrivateSaveExecution } from "./privatePayloadSaveExecution";
import { privatePayloadReverseSeed } from "./privatePayloadReverseSeed";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

const pageResult = Schema.decodeUnknownSync(Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: Schema.String })), cursor: Schema.NullOr(Schema.String) }));

/** Replacement and recovery are the real finite executor's operations. */
export async function privatePayloadReverseRetryScenario(fixture: PrivatePayloadSaveFixture) {
  const seed = await privatePayloadReverseSeed(fixture, "rr3-replacement");
  const counts = () => publishedScopeCounts(fixture.fixture.application.persistence.drizzle, fixture.fixture.application.authority.scopeId);
  const rowsFor = (id: string) => {
    const identity = decodeAppDocumentIdentityV1(id);
    return fixture.fixture.application.persistence.drizzle.select({ id: fxAppRowCurrent.rowId }).from(fxAppRowCurrent).where(and(
      eq(fxAppRowCurrent.scopeUuid, projectScopeIdUuidV1(fixture.fixture.application.authority.scopeId).scopeUuid),
      eq(fxAppRowCurrent.tableId, identity.tableId), eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(identity.rowId))));
  };
  for (const mode of ["changedAllow", "revoked", "staleCursor"] as const) {
    const reset = await preparePrivateReverseReadPolicy(fixture, { enumerate: [seed.productId], articles: seed.ids }, seed.policyId);
    await reset.root.publish();
    const profile = await Effect.runPromise(preparePrivateReverseReadProfile(fixture, seed.principal, seed.productId));
    const entered = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    let execution: PrivateSaveExecution | undefined;
    let hooks = 0;
    const observations: { fence: bigint; snapshot: bigint; sessionId: string }[] = [];
    const pages: { userId: string; cursor: string | null; profile: string }[] = [];
    const capabilities: { access: Parameters<typeof inspectPrivateReverseReadAccess>[0]; attempt: Parameters<typeof inspectPrivateReverseReadAccess>[1] }[] = [];
    const run: PointMutationOccRuntimeNeutralRunnerV1["run"] = Effect.fn("PrivateReverseReadRetry.nativeWork")(function* () {
      if (execution === undefined) return yield* Effect.die(new Error("Missing genuine execution owner"));
      const active = execution, root = active.currentRoot();
      observations.push({ fence: root.context.anchor.attemptFence, snapshot: root.context.anchor.snapshotToken.commitSeq, sessionId: root.context.anchor.sessionId });
      const commands = yield* preparePrivateReverseReadCommands(fixture, root, profile, seed.policyId,
        { instrumentation: { hooks: { afterRead: [({ doc }) => { hooks++; return doc; }] } } });
      yield* commands.retrieve();
      const bound = yield* commands.bind();
      return yield* Effect.gen(function* () {
        active.selectReadProfile(bound.selection.profileRevision);
        capabilities.push({ access: bound.access, attempt: root.attempt });
        if (pages[0]?.cursor !== undefined && pages[0].cursor !== null) {
          expect(inspectPrivateReverseReadAccess(capabilities[0]!.access, root.attempt)).toBeUndefined();
          if (mode === "staleCursor") {
            yield* bound.invoke({ limit: 1, cursor: pages[0].cursor });
            return yield* Effect.die(new Error("Replacement accepted the abandoned root's cursor"));
          }
        }
        const result = yield* bound.invoke({ limit: 1 });
        if (result.kind !== "completed") return yield* Effect.die(new Error("Native page refused"));
        const page = pageResult(result.result);
        const users = yield* fixture.fixture.store.resolvePointTableEffect(root.attempt, "users");
        const user = yield* fixture.fixture.store.runPointOperationEffect(users, { kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(4n),
          fields: { name: JSON.stringify(page.docs) } }, root.validator);
        if (user.kind !== "completed" || user.outcome.kind !== "inserted") return yield* Effect.die(new Error("Application consumption refused"));
        pages.push({ userId: user.outcome.documentId, cursor: page.cursor, profile: bound.selection.profileRevision });
        return { userId: user.outcome.documentId, docs: page.docs };
      }).pipe(Effect.ensuring(bound.closeEffect));
    }, Effect.mapError(cause => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause })));
    const initial = Effect.runPromise(profile.withPreparation(preparation => Effect.gen(function* () {
      const owned = yield* makePrivateSaveExecution(fixture, preparation, { run }, undefined, undefined, profile.withPreparation);
      execution = owned;
      return yield* owned.owner.runPreparedFiniteAttempt(owned.prepared, entry => run(entry.runnerInput).pipe(
        Effect.tap(() => Deferred.succeed(entered, undefined)), Effect.tap(() => Deferred.await(release)),
        Effect.flatMap(entry.prepareFiniteCommit), Effect.flatMap(entry.settleFiniteCommit)));
    })));
    const drained = Promise.allSettled([initial]);
    try {
      await withTimeout(Promise.race([Effect.runPromise(Deferred.await(entered)), initial.then(() => { throw new Error("Settled before native page barrier"); })]), 30_000, "actual reverse page and Application work");
      const changed = await preparePrivateReverseReadPolicy(fixture, { enumerate: mode === "revoked" ? [] : [seed.productId], articles: seed.ids.slice(0, 2) }, seed.policyId);
      await changed.root.publish();
      const before = await counts();
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const first = (await drained)[0];
      if (first?.status !== "rejected" || execution === undefined) throw new Error("Missing actual stale-page conflict");
      expect(first.reason).toMatchObject({ _tag: "PointCommitConflictV1Error" });
      expect(await counts()).toEqual(before);
      expect(await rowsFor(pages[0]!.userId)).toHaveLength(0);
      expect(inspectPrivateReverseReadAccess(capabilities[0]!.access, capabilities[0]!.attempt)).toBeUndefined();
      await expect(Effect.runPromise(execution.owner.retryFailedAttempt({ ...first.reason }))).rejects.toMatchObject({ reason: "unprovenRetry" });
      const retried = await Effect.runPromise(execution.owner.retryFailedAttempt(first.reason).pipe(Effect.result));
      expect(observations).toHaveLength(2);
      expect(observations[1]).toMatchObject({ fence: 2n, sessionId: observations[0]!.sessionId });
      expect(observations[1]!.snapshot).toBeGreaterThan(observations[0]!.snapshot);
      if (mode === "changedAllow") {
        expect(retried).toMatchObject({ _tag: "Success", success: { kind: "published" } });
        expect(pages).toHaveLength(2); expect(hooks).toBe(4);
        expect(pages[1]!.profile).not.toBe(pages[0]!.profile);
        expect(pages[1]!.cursor).not.toBe(pages[0]!.cursor);
        expect(pages[1]!.userId).not.toBe(pages[0]!.userId);
        expect(await rowsFor(pages[1]!.userId)).toHaveLength(1);
        expect(await counts()).toMatchObject({ commits: before.commits + 1, rows: before.rows + 1, outcomes: before.outcomes + 1 });
      } else {
        expect(retried).toMatchObject({ _tag: "Failure", failure: { _tag: "ApplicationPointMutationRunnerHostV1Error", cause:
          mode === "revoked" ? { _tag: "PrivateReverseReadAccessError", reason: "denied" } :
            { _tag: "LogicalParticipantInvocationError", kind: "rejection", cause: { _tag: "CmsTransactionError", reason: "invalidAuthority" } } } });
        expect(pages).toHaveLength(1); expect(hooks).toBe(2);
        expect(await counts()).toEqual(before);
      }
      expect(await rowsFor(pages[0]!.userId)).toHaveLength(0);
      const snapshot = await counts(), calls = hooks;
      const anchor = execution.currentRoot().context.anchor;
      const replayed = await Effect.runPromise(execution.owner.redispatchExactPointMutationAttempt({ deploymentId: anchor.deploymentId, scopeId: anchor.scopeId,
        sessionId: anchor.sessionId, attemptFence: anchor.attemptFence.toString() }).pipe(Effect.result));
      expect(replayed).toMatchObject(mode === "changedAllow" ? { _tag: "Success", success: { kind: "replayed" } } :
        { _tag: "Failure", failure: { reason: "lifecycle" } });
      if (Result.isSuccess(retried) && Result.isSuccess(replayed) && retried.success.kind === "published" && replayed.success.kind === "replayed")
        expect(replayed.success.successfulResult).toEqual(retried.success.successfulResult);
      expect(hooks).toBe(calls); expect(await counts()).toEqual(snapshot);
      await expect(Effect.runPromise(execution.owner.retryFailedAttempt(first.reason))).rejects.toMatchObject({ reason: "unprovenRetry" });
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); await drained; }
  }
}
