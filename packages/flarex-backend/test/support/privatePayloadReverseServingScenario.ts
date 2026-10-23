import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { makePayloadReferencePages } from "../../../payload-adapter/src/runtime/referencePages";
import { PointCommitConflictV1Error } from "../../../persistence-postgres/src/commit/point/errors";
import { dataBindingActivationRequest } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { withTimeout } from "../../../persistence-postgres/test/commit/point/support/postgresFaults";
import { preparePrivateReverseReadPolicy, preparePrivateReverseReadProfile } from "./privatePayloadReverseReadCommands";
import { privatePayloadReverseSeed } from "./privatePayloadReverseSeed";
import { runPrivatePayloadReverseServing } from "./privatePayloadReverseServing";
import { privatePayloadReverseDelete } from "./privatePayloadReverseDelete";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

const Page = Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  hasMore: Schema.Boolean, cursor: Schema.NullOr(Schema.String) });
const result = Schema.decodeUnknownSync(Schema.Struct({ userId: Schema.String, first: Page, second: Page }));
const opaque = { kind: "error", name: "PointMutationExactRuntimeJournalBoundaryV1Error",
  message: "Exact point-mutation journal boundary failed.", cause: "The journal RPC capability is unavailable." };

/** Genuine protected data, normal consumer construction and real RPC/Workerd;
 * the test arranges changes and observes owners, never decides acceptance. */
export async function privatePayloadReverseServingScenario(fixture: PrivatePayloadSaveFixture) {
  const seed = await privatePayloadReverseSeed(fixture, "rr4-serving", 5);
  const visible = [seed.ids[1]!, seed.ids[3]!];
  const allow = { enumerate: [seed.productId], articles: visible };
  const setPolicy = async (input: typeof allow) => {
    const policy = await preparePrivateReverseReadPolicy(fixture, input, seed.policyId); await policy.root.publish();
  };
  await setPolicy(allow);
  const profile = await Effect.runPromise(preparePrivateReverseReadProfile(fixture, seed.principal, seed.productId));
  const counts = () => publishedScopeCounts(fixture.fixture.application.persistence.drizzle, fixture.fixture.application.authority.scopeId);
  const responses: unknown[] = [], calls: string[] = [];
  const serve = (body: string, hooks: Parameters<typeof runPrivatePayloadReverseServing>[4] = {}) =>
    runPrivatePayloadReverseServing(fixture, profile, seed.policyId, body, { ...hooks,
      onNative: method => { calls.push(method); }, onResponse: response => { responses.push(response); } });
  const page = (args = "{ limit: 1 }") => `ctx.privateMixed.call("payload", "private-reference-page", ${args})`;
  const before = await counts();
  const success = await Effect.runPromise(serve(`const userId = await ctx.db.insert("users", { name: "Before read" });
    const first = await ${page()}; const second = await ${page("{ limit: 1, cursor: first.cursor }")};
    await ctx.db.patch(userId, { name: first.docs[0].title + second.docs[0].title }); return { userId, first, second };`));
  const published = Result.getOrThrow(success.result);
  if (published.kind !== "published") throw new Error("Expected actual committed page consumption");
  const value = result(published.successfulResult.valueJson);
  expect(value.first.docs.map(doc => doc.id)).toEqual(visible.slice(0, 1));
  expect(value.first).toMatchObject({ hasMore: true });
  expect(value.second).toMatchObject({ hasMore: false, cursor: null });
  expect(value.second.docs.map(doc => doc.id)).toEqual(visible.slice(1));
  expect(calls).toEqual(["retrieve", "private-reference-page", "private-reference-page"]);
  expect(await counts()).toMatchObject({ rows: before.rows + 1, revisions: before.revisions + 1, rowFacts: before.rowFacts + 1,
    commits: before.commits + 1, outcomes: before.outcomes + 1, events: before.events });
  const anchor = success.execution.currentRoot().context.anchor, committed = await counts();
  expect(await Effect.runPromise(success.execution.owner.redispatchExactPointMutationAttempt({ deploymentId: anchor.deploymentId, scopeId: anchor.scopeId,
    sessionId: anchor.sessionId, attemptFence: anchor.attemptFence.toString() }))).toMatchObject({ kind: "replayed", successfulResult: published.successfulResult });
  expect(await counts()).toEqual(committed); expect(calls).toHaveLength(3); expect(responses).toHaveLength(1);

  const denied: readonly [string, string][] = [
    ["forged cursor", `await ${page('{ limit: 1, cursor: "forged" }')};`],
    ["forged native authority", `await ${page('{ limit: 1, overrideAccess: true, user: { role: "admin" }, context: { flarexPrivateReverseRead: {} } }')};`],
    ["other collection", `await ${page('{ limit: 1, collection: "audit" }')};`],
    ["other target", `await ${page('{ limit: 1, productId: "foreign-product" }')};`],
    ["zero limit", `await ${page('{ limit: 0 }')};`],
    ["broad find", 'await ctx.privateMixed.call("payload", "payload-find", { collection: "posts" });'],
    ["count", 'await ctx.privateMixed.call("payload", "payload-count", { collection: "posts" });'],
    ["raw point read", `await ctx.privateMixed.call("payload", "payload-findByID", { collection: "posts", id: ${JSON.stringify(visible[0])} });`],
    ["membership probe", 'await ctx.privateMixed.call("payload", "private-reference-membership-probe", {});'],
    ["content mutation", `await ctx.privateMixed.call("payload", "payload-update", { collection: "posts", id: ${JSON.stringify(visible[0])}, data: { title: "Bypass" } });`],
    ["commerce mutation", `await ctx.privateMixed.call("medusa.product", "update", { id: ${JSON.stringify(seed.productId)}, data: { title: "Bypass" } });`],
    ["extra target read", `await ctx.privateMixed.call("medusa.product", "retrieve", { id: ${JSON.stringify(seed.productId)} });`],
    ["ordinary content patch", `await ctx.db.patch(${JSON.stringify(visible[0])}, { title: "Bypass" });`],
    ["self grant", `await ctx.db.patch(${JSON.stringify(seed.policyId)}, {});`],
  ];
  for (const [name, body] of denied) {
    const baseline = await counts(), seen = responses.length;
    const served = await Effect.runPromise(serve(`await ctx.db.insert("users", { name: "Must roll back" });
      try { ${body} } catch (_) {} return "caught refusal";`));
    expect(Result.isFailure(served.result), name).toBe(true);
    expect(responses.slice(seen), name).toEqual([name === "self grant" ? { ...opaque, cause: "Ordinary Application mutations cannot write this managed table." } : opaque]);
    expect(await counts(), name).toEqual(baseline);
  }
  for (const articles of [[], visible] as const) {
    await setPolicy({ enumerate: [seed.productId], articles: [...articles] });
    const served = await Effect.runPromise(serve(`return await ${page()};`));
    expect(served.result).toMatchObject({ _tag: "Success", success: { kind: "published", successfulResult: { valueJson:
      articles.length === 0 ? { docs: [], hasMore: false, cursor: null } : { docs: [{ id: visible[0] }], hasMore: true } } } });
    if (articles.length === 0) {
      const beforeDelete = await counts();
      expect(await privatePayloadReverseDelete(fixture, seed.productId)).toMatchObject({ _tag: "Failure", failure: {
        _tag: "CommerceTransactionError", reason: "invalidInput", cause: { reason: "targetDeleteRestricted" } } });
      expect(await counts()).toEqual(beforeDelete);
    }
  }
  await setPolicy({ enumerate: [], articles: visible });
  const beforeDenied = await counts(), seen = responses.length;
  expect((await Effect.runPromise(serve(`return await ${page()};`))).result).toMatchObject({ _tag: "Failure", failure: {
    _tag: "ApplicationPointMutationRunnerHostV1Error", cause: { _tag: "PrivateReverseReadAccessError", reason: "denied" } } });
  expect(responses).toHaveLength(seen); expect(await counts()).toEqual(beforeDenied);
  await setPolicy(allow);

  // A genuine grant for another principal and a structural copy of this
  // grant both fail before any Worker page is available.
  for (const foreign of [true, false]) {
    const selected = foreign ? await Effect.runPromise(preparePrivateReverseReadProfile(fixture,
      { ...seed.principal, principalDigest: "f".repeat(64) }, seed.productId)) : { ...profile, target: { ...profile.target } };
    const baseline = await counts(), seen = responses.length;
    const served = await Effect.runPromise(runPrivatePayloadReverseServing(fixture, selected, seed.policyId, `return await ${page()};`,
      { onResponse: response => { responses.push(response); } }));
    expect(served.result).toMatchObject({ _tag: "Failure" });
    expect(responses).toHaveLength(seen); expect(await counts()).toEqual(baseline);
  }
  let revoked = false;
  const stale = await Effect.runPromise(serve(`const first = await ${page()};
    const userId = await ctx.db.insert("users", { name: first.docs[0].title }); return { userId, first };`, {
    afterWorker: async () => { if (!revoked) { revoked = true; await setPolicy({ enumerate: [seed.productId], articles: visible.slice(0, 1) }); } },
  }));
  if (Result.isSuccess(stale.result) || !(stale.result.failure instanceof PointCommitConflictV1Error))
    throw new Error("Expected genuine serving page conflict", { cause: stale.result });
  const afterRevoke = await counts(), responseCount = responses.length;
  expect(await Effect.runPromise(stale.execution.owner.retryFailedAttempt(stale.result.failure))).toMatchObject({ kind: "published",
    successfulResult: { valueJson: { first: { hasMore: false, cursor: null, docs: [{ id: visible[0] }] } } } });
  expect(responses).toHaveLength(responseCount + 1);
  expect(await counts()).toMatchObject({ commits: afterRevoke.commits + 1, rows: afterRevoke.rows + 1 });
  await setPolicy(allow);

  await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductSoftDelete, seed.productId));
  const softDeleted = await counts(), hiddenResponses = responses.length;
  let constructed = 0;
  const hidden = await Effect.runPromise(serve(`return await ${page()};`, {
    makeNative: Effect.fn("PrivateReverseServingTest.hiddenTarget")(function* (compiled, attempt, access) {
      constructed++; return yield* makePayloadReferencePages(compiled, attempt, access);
    }),
  }));
  expect(hidden.result).toMatchObject({ _tag: "Failure" });
  expect(constructed).toBe(0); expect(responses).toHaveLength(hiddenResponses); expect(await counts()).toEqual(softDeleted);
  await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductRestore, seed.productId));
  expect((await Effect.runPromise(serve(`return await ${page()};`))).result).toMatchObject({ _tag: "Success", success: {
    kind: "published", successfulResult: { valueJson: { docs: [{ id: visible[0] }] } } } });

  const { binding, frame } = fixture.schemaBinding;
  const activate = async (enabled: boolean) => {
    const application = await Effect.runPromise(binding.readApplicationReference());
    const current = await Effect.runPromise(binding.withCurrent(readAdmittedDataBinding));
    const candidate = await Effect.runPromise(binding.prepare({ ...frame, application, payloadLifecycle: enabled ? frame.payloadLifecycle : null }));
    await Effect.runPromise(binding.activate(dataBindingActivationRequest(seed.principal.scopeId, application.storageGeneration,
      enabled ? "rr4-serving-restore" : "rr4-serving-withdraw", candidate.sha256, current.head)));
  };
  const beforeWithdrawal = await counts();
  try {
    const withdrawn = await Effect.runPromise(serve(`const page = await ${page()};
      await ctx.db.insert("users", { name: page.docs[0].title }); return page;`, { afterWorker: () => activate(false) }));
    expect(withdrawn.result).toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitStaleAuthorityV1Error", reason: "revocationEpochChanged" } });
    expect(await counts()).toEqual(beforeWithdrawal);
  } finally { await activate(true); }

  let hooks = 0, closed = false;
  const baseline = await counts(), failureResponse = responses.length;
  const failed = await Effect.runPromise(serve(`await ctx.db.insert("users", { name: "Rollback native failure" });
    try { await ${page()}; } catch (_) {} return "caught native failure";`, {
    makeNative: Effect.fn("PrivateReverseServingTest.nativeFailure")(function* (compiled, attempt, access) {
      yield* Effect.addFinalizer(() => Effect.sync(() => { closed = true; }));
      return yield* makePayloadReferencePages(compiled, attempt, access,
        { hooks: { afterRead: [({ doc }) => { if (++hooks === 2) throw new Error("RR4 native lookahead failed"); return doc; }] } });
    }),
  }).pipe(Effect.exit));
  expect(Exit.isFailure(failed) && failed.cause.reasons.some(reason => Cause.isDieReason(reason) &&
    reason.defect instanceof Error && reason.defect.message === "RR4 native lookahead failed")).toBe(true);
  expect(hooks).toBe(2); expect(closed).toBe(true);
  expect(responses.slice(failureResponse)).toEqual([opaque]); expect(await counts()).toEqual(baseline);

  const receipt = Deferred.makeUnsafe<void>();
  let disposed = false;
  const beforeCancellation = await counts();
  const cancellation = Effect.runFork(serve(`await ctx.db.insert("users", { name: "Cancelled read" }); await ${page()}; while (true) {}`, {
    observations: { onReceipt: () => { Deferred.doneUnsafe(receipt, Effect.void); }, onDisposed: () => { disposed = true; } },
  }));
  try {
    await withTimeout(Effect.runPromise(Deferred.await(receipt)), 30_000, "real reverse-page Worker receipt");
    await Effect.runPromise(Fiber.interrupt(cancellation));
    const exit = await Effect.runPromise(Fiber.await(cancellation));
    expect(Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(disposed).toBe(true); expect(await counts()).toEqual(beforeCancellation);
  } finally { await Effect.runPromise(Fiber.interrupt(cancellation)); }

  for (const mode of ["foreignPrincipal", "storedCorruption", "missing"] as const) {
    const root = await fixture.fixture.open();
    const writer = await Effect.runPromise(fixture.fixture.store.preparePrivateApplicationCommandEffect(root.attempt, "audit"));
    const syscallSequence = CommitSyscallSequenceV1Schema.make(1n);
    await Effect.runPromise(writer.run(mode === "missing" ? { kind: "delete", documentId: seed.policyId, syscallSequence } : {
      kind: "replace", documentId: seed.policyId, syscallSequence, fields: { policy: mode === "storedCorruption" ? {} : {
        format: "flarex.private-reference-read-permissions", version: 1, collection: "posts", relation: "featuredProduct", ...allow,
        principal: { ...seed.principal, principalDigest: "e".repeat(64) },
      } },
    }, root.validator));
    await root.publish();
    const baseline = await counts(), seen = responses.length;
    expect((await Effect.runPromise(serve(`return await ${page()};`))).result).toMatchObject({ _tag: "Failure", failure: {
      _tag: "ApplicationPointMutationRunnerHostV1Error", cause: mode === "missing" ? { _tag: "PrivateReverseReadAccessError", reason: "denied" } :
        { _tag: "PrivatePermissionEvidenceError", reason: mode === "foreignPrincipal" ? "invalidAuthority" : "storedCorruption" } } });
    expect(responses).toHaveLength(seen); expect(await counts()).toEqual(baseline);
  }
}
