import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { inspectPrivateReverseReadAccess } from "../../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import { readFrozenFiniteAttempt } from "../../../persistence-postgres/src/testing/sessionJournalInspection";
import { withTimeout } from "../../../persistence-postgres/test/commit/point/support/postgresFaults";
import { bindPrivatePayloadSave } from "./privatePayloadSaveCommands";
import { openPrivateReverseRead, preparePrivateReverseReadPolicy } from "./privatePayloadReverseReadCommands";
import { privatePayloadReverseSeed } from "./privatePayloadReverseSeed";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

export async function privatePayloadReverseRecoveryScenario(fixture: PrivatePayloadSaveFixture) {
  const seed = await privatePayloadReverseSeed(fixture, "rr3-frontier", 40);
  const { store, application } = fixture.fixture;
  const counts = () => publishedScopeCounts(application.persistence.drizzle, application.authority.scopeId);
  const consume = async (root: Awaited<ReturnType<typeof openPrivateReverseRead>>["root"], at = 4n) => {
    const users = await Effect.runPromise(store.resolvePointTableEffect(root.attempt, "users"));
    return Effect.runPromise(store.runPointOperationEffect(users, { kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(at),
      fields: { name: "Consumed native page" } }, root.validator));
  };
  // The actual captured prefix is a dependency; later physical keys beyond
  // that prefix are not silently promoted into whole-collection dependencies.
  for (const mode of ["outside", "inside", "insertBefore"] as const) {
    if (mode === "insertBefore") {
      const root = await fixture.open(), save = await bindPrivatePayloadSave(fixture, root, seed.savePolicyId);
      try {
        expect(await Effect.runPromise(save.invoke("update", { collection: "posts", id: seed.ids[0]!, data: { featuredProduct: null } }))).toMatchObject({ kind: "completed" });
        await root.publish(null, [root.payloadProfile(save.selected.profileRevision)]);
      } finally { await save.close(); }
    }
    const reading = await openPrivateReverseRead(fixture, seed.policyId, seed.principal, seed.productId);
    await Effect.runPromise(reading.retrieve());
    const bound = await reading.bind();
    try {
      expect((await bound.read(1)).docs.map(doc => doc.id)).toEqual(seed.ids.slice(mode === "insertBefore" ? 1 : 0, mode === "insertBefore" ? 2 : 1));
      await consume(reading.root);
      const publication = await bound.prepare();
      const graph = readFrozenFiniteAttempt(publication.command.frozenAttempt)?.graph;
      expect(graph?.pageReads).toHaveLength(1);
      expect(graph?.pageReads[0]).toMatchObject({ isDone: false });
      expect(graph?.pageReads[0]?.entries).toHaveLength(32);
      expect(graph?.scans).toEqual([]);
      const changing = await fixture.open(), save = await bindPrivatePayloadSave(fixture, changing, seed.savePolicyId);
      try {
        expect(await Effect.runPromise(mode === "outside" ? save.invoke("create", { collection: "posts", data: { title: "Later hidden membership", featuredProduct: seed.productId } }) :
          save.invoke("update", { collection: "posts", id: seed.ids[mode === "insertBefore" ? 0 : 5]!, data: mode === "insertBefore" ?
            { featuredProduct: seed.productId } : { title: "Consumed captured point changed" } }))).toMatchObject({ kind: "completed" });
        await changing.publish(null, [changing.payloadProfile(save.selected.profileRevision)]);
      } finally { await save.close(); }
      const before = await counts();
      if (mode === "outside") {
        expect(await Effect.runPromise(publication.publish)).toMatchObject({ kind: "published" });
        expect(await counts()).toMatchObject({ commits: before.commits + 1, rows: before.rows + 1 });
      } else {
        await expect(Effect.runPromise(publication.publish)).rejects.toMatchObject({ _tag: "PointCommitConflictV1Error" });
        expect(await counts()).toEqual(before);
      }
    } finally { await bound.close(); }
  }
  // Receipt replay remains the original observation after revocation. It is
  // not a fresh read authorization and cannot make the stale root publish.
  let hooks = 0;
  const replaying = await openPrivateReverseRead(fixture, seed.policyId, seed.principal, seed.productId,
    { instrumentation: { hooks: { afterRead: [({ doc }) => { hooks++; return doc; }] } } });
  await Effect.runPromise(replaying.retrieve());
  const replay = await replaying.bind();
  try {
    const original = await Effect.runPromise(replay.invoke({ limit: 1 }, 3n));
    expect(original).toMatchObject({ kind: "completed", delivery: "executed" });
    await consume(replaying.root);
    const revoke = await preparePrivateReverseReadPolicy(fixture, { enumerate: [], articles: [] }, seed.policyId);
    await revoke.root.publish();
    expect(await Effect.runPromise(replay.invoke({ limit: 1 }, 3n))).toEqual({ ...original, delivery: "replayed" });
    expect(hooks).toBe(2);
    const publication = await replay.prepare(), before = await counts();
    await expect(Effect.runPromise(publication.publish)).rejects.toMatchObject({ _tag: "PointCommitConflictV1Error" });
    expect(await Effect.runPromise(publication.resolve)).toMatchObject({ kind: "noncommit" });
    expect(await counts()).toEqual(before);
  } finally { await replay.close(); }
  const reset = await preparePrivateReverseReadPolicy(fixture, { enumerate: [seed.productId], articles: seed.ids }, seed.policyId);
  await reset.root.publish();
  const failing = await openPrivateReverseRead(fixture, seed.policyId, seed.principal, seed.productId,
    { instrumentation: { hooks: { afterRead: [() => { throw new Error("RR3 admitted native read failed"); }] } } });
  await Effect.runPromise(failing.retrieve());
  const failed = await failing.bind();
  try {
    const before = await counts();
    // Stage Application consumption first, then deliberately catch the native
    // failure. Catching it must not revive the shared root.
    await consume(failing.root, 3n);
    expect(await Effect.runPromise(failed.invoke({ limit: 1 }, 4n).pipe(Effect.exit))).toMatchObject({ _tag: "Failure" });
    expect(inspectPrivateReverseReadAccess(failed.access, failing.root.attempt)).toBeUndefined();
    await expect(failed.prepare()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
    expect(await counts()).toEqual(before);
  } finally { await failed.close(); }
  const entered = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
  let native = 0;
  const cancelled = await openPrivateReverseRead(fixture, seed.policyId, seed.principal, seed.productId, {
    instrumentation: { hooks: { afterRead: [({ doc }) => { native++; return doc; }] } },
    afterNative: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
  });
  await Effect.runPromise(cancelled.retrieve());
  const cancellable = await cancelled.bind();
  let fiber: ReturnType<typeof Effect.runFork<unknown, unknown>> | undefined;
  try {
    const before = await counts();
    await consume(cancelled.root, 3n);
    fiber = Effect.runFork(cancellable.invoke({ limit: 1 }, 4n));
    await withTimeout(Effect.runPromise(Deferred.await(entered)), 30_000, "native page before receipt acknowledgement");
    expect(native).toBe(2);
    await Effect.runPromise(Fiber.interrupt(fiber));
    const outcome = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(outcome) && outcome.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(inspectPrivateReverseReadAccess(cancellable.access, cancelled.root.attempt)).toBeUndefined();
    await expect(cancellable.prepare()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
    await expect(Effect.runPromise(cancelled.derive())).rejects.toMatchObject({ reason: "invalidAuthority" });
    expect(await counts()).toEqual(before);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    if (fiber !== undefined) await Effect.runPromise(Fiber.interrupt(fiber));
    await cancellable.close();
  }
}
