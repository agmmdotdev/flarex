import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { inspectPrivateReferenceSaveAccess } from "../../../persistence-postgres/src/execution/journal/privateSaveAccess";
import { withTimeout } from "../../../persistence-postgres/test/commit/point/support/postgresFaults";
import { bindPrivatePayloadSave, preparePrivateSavePolicy } from "./privatePayloadSaveCommands";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

export async function privatePayloadSaveRecoveryScenario(fixture: PrivatePayloadSaveFixture) {
  const { store } = fixture.fixture;
  const counts = () => publishedScopeCounts(fixture.fixture.application.persistence.drizzle, fixture.fixture.application.authority.scopeId);
  const product = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await Effect.runPromise(fixture.productHost.run(
    fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductCreate,
    { title: "Recovery Product", handle: "private-save-recovery-product" })));
  const allow = { source: { create: true, update: true, delete: true }, assign: [product.id], retain: [product.id] };
  const deny = { ...allow, assign: [], retain: [] };
  const firstPolicy = await preparePrivateSavePolicy(fixture, allow);
  await firstPolicy.root.publish();
  const secondPolicy = await preparePrivateSavePolicy(fixture, deny);
  await secondPolicy.root.publish();

  // Same root, genuine but different protected points/decisions. A changed
  // selection must not replay a receipt made under the first capability.
  const changed = await fixture.open();
  let firstHooks = 0, secondHooks = 0;
  const first = await bindPrivatePayloadSave(fixture, changed, firstPolicy.documentId,
    { instrumentation: { hooks: { beforeChange: [({ data }) => { firstHooks++; return data; }] } } });
  const second = await bindPrivatePayloadSave(fixture, changed, secondPolicy.documentId,
    { policySequence: 2n, instrumentation: { hooks: { beforeChange: [({ data }) => { secondHooks++; return data; }] } } });
  try {
    expect(second.selected.profileRevision).not.toBe(first.selected.profileRevision);
    const before = await counts();
    const args = { collection: "posts", data: { title: "Exact grant receipt", featuredProduct: product.id } };
    expect(await Effect.runPromise(first.invoke("create", args, 3n))).toMatchObject({ kind: "completed", delivery: "executed" });
    expect(await Effect.runPromise(first.invoke("create", args, 3n))).toMatchObject({ kind: "completed", delivery: "replayed" });
    expect(await Effect.runPromise(second.invoke("create", args, 3n))).toMatchObject({ kind: "sequenceRejected", issue: { reason: "requestMismatch" } });
    expect(firstHooks).toBe(1);
    expect(secondHooks).toBe(0);
    // A sequence mismatch grants no result and changes no pending state. The
    // next genuine write must execute and fail the new assignment decision.
    await expect(Effect.runPromise(second.invoke("create", args, 4n))).rejects.toBeDefined();
    expect(secondHooks).toBe(1);
    await expect(changed.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
    expect(await counts()).toEqual(before);
  } finally { await second.close(); await first.close(); }

  const root = await fixture.open();
  let replayHooks = 0;
  const saving = await bindPrivatePayloadSave(fixture, root, firstPolicy.documentId,
    { instrumentation: { hooks: { beforeChange: [({ data }) => { replayHooks++; return data; }] } } });
  try {
    const args = { collection: "posts", data: { title: "Replayed receipt stays stale", featuredProduct: product.id } };
    const result = await Effect.runPromise(saving.invoke("create", args, 2n));
    if (result.kind !== "completed") throw new Error("Expected actual native save");
    const revocation = await preparePrivateSavePolicy(fixture, deny, firstPolicy.documentId);
    await revocation.root.publish();
    const before = await counts();
    expect(await Effect.runPromise(saving.invoke("create", args, 2n))).toMatchObject({ kind: "completed", delivery: "replayed" });
    expect(replayHooks).toBe(1);
    const publication = await root.preparePublication(result.result, { logicalOperationProfiles: [root.payloadProfile(saving.selected.profileRevision)] });
    await expect(Effect.runPromise(publication.publish)).rejects.toMatchObject({ _tag: "PointCommitConflictV1Error" });
    expect(await Effect.runPromise(publication.resolve)).toMatchObject({ kind: "noncommit" });
    expect(await counts()).toEqual(before);
    const fresh = await fixture.open();
    const freshSave = await bindPrivatePayloadSave(fixture, fresh, firstPolicy.documentId);
    try {
      await expect(Effect.runPromise(freshSave.invoke("create", args))).rejects.toBeDefined();
      await expect(fresh.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
      expect(await counts()).toEqual(before);
    } finally { await freshSave.close(); }
  } finally { await saving.close(); }

  const reset = await preparePrivateSavePolicy(fixture, allow, firstPolicy.documentId);
  await reset.root.publish();
  const entered = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
  const cancelled = await fixture.open();
  let nativeCalls = 0;
  const cancellable = await bindPrivatePayloadSave(fixture, cancelled, firstPolicy.documentId,
    { instrumentation: { hooks: {}, onExecute: () => { nativeCalls++; } },
      afterNative: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))) });
  let fiber: ReturnType<typeof Effect.runFork<unknown, unknown>> | undefined;
  try {
    const before = await counts();
    const users = await Effect.runPromise(store.resolvePointTableEffect(cancelled.attempt, "users"));
    expect(await Effect.runPromise(store.runPointOperationEffect(users,
      { kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(2n), fields: { name: "Cancelled Application work" } }, cancelled.validator)))
      .toMatchObject({ kind: "completed", outcome: { kind: "inserted" } });
    fiber = Effect.runFork(cancellable.invoke("create", { collection: "posts",
      data: { title: "Cancelled native save", featuredProduct: product.id } }, 3n));
    await withTimeout(Effect.runPromise(Deferred.await(entered)), 30_000, "actual native save before its receipt acknowledgement");
    expect(nativeCalls).toBe(1);
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(inspectPrivateReferenceSaveAccess(cancellable.access, cancelled.attempt)).toBeUndefined();
    await expect(cancelled.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
    await expect(Effect.runPromise(store.preparePrivateReferenceSaveEffect(cancelled.attempt, cancellable.facts,
      { participant: "payload", collection: "posts", relation: "featuredProduct", nativeProfileRevision: "1".repeat(64) })))
      .rejects.toMatchObject({ reason: "invalidAuthority" });
    expect(await counts()).toEqual(before);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    if (fiber !== undefined) await Effect.runPromise(Fiber.interrupt(fiber));
    await cancellable.close();
  }
}
