import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { PointCommitConflictV1Error } from "../../../persistence-postgres/src/commit/point/errors";
import { preparePrivateSavePolicy } from "./privatePayloadSaveCommands";
import { runPrivatePayloadSaveServing } from "./privatePayloadSaveServing";
import { runPrivateMixedWorkerd } from "./privateMixedWorkerd";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";
import { withTimeout } from "../../../persistence-postgres/test/commit/point/support/postgresFaults";

const document = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const saved = Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ id: Schema.String, title: Schema.String,
  featuredProduct: Schema.String }), userId: Schema.String }));
const opaque = { kind: "error", name: "PointMutationExactRuntimeJournalBoundaryV1Error",
  message: "Exact point-mutation journal boundary failed.", cause: "The journal RPC capability is unavailable." };

/** The selected serving consumer uses normal construction, actual Worker code,
 * the real RPC session, genuine finite execution and protected policy commands. */
export async function privatePayloadSaveServingScenario(fixture: PrivatePayloadSaveFixture) {
  const product = document(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
    fixture.productRuntime.commands.internalProductCreate, { title: "Serving Product", handle: "private-save-serving-product" })));
  const allow = { source: { create: true, update: true, delete: true }, assign: [product.id], retain: [product.id] };
  const policy = await preparePrivateSavePolicy(fixture, allow);
  await policy.root.publish();
  const counts = () => publishedScopeCounts(fixture.fixture.application.persistence.drizzle, fixture.fixture.application.authority.scopeId);
  const responses: unknown[] = [];
  const invocations: string[] = [];
  const prepare = (body: string, after?: () => Promise<void>, observations?: Parameters<typeof runPrivateMixedWorkerd>[4]) =>
    runPrivatePayloadSaveServing(fixture, policy.documentId, body, { ...(after === undefined ? {} : { afterWorker: after }),
      ...(observations === undefined ? {} : { observations }), onResponse: value => { responses.push(value); },
      onNative: method => { invocations.push(method); } });
  const create = `await ctx.privateMixed.call("payload", "payload-create", { collection: "posts",
    data: { title: "Serving article", featuredProduct: ${JSON.stringify(product.id)} } })`;
  const before = await counts();
  const success = await Effect.runPromise(prepare(`const userId = await ctx.db.insert("users", { name: "before" });
    const created = ${create};
    const article = await ctx.privateMixed.call("payload", "payload-update", { collection: "posts", id: created.id,
      data: { title: "Protected serving article" } });
    await ctx.db.patch(userId, { name: article.title }); return { article, userId };`));
  const committed = Result.getOrThrow(success.result);
  expect(committed.kind).toBe("published");
  if (committed.kind !== "published") throw new Error("Expected published serving result");
  const value = saved(committed.successfulResult.valueJson);
  expect(value.article).toMatchObject({ title: "Protected serving article", featuredProduct: product.id });
  expect(invocations).toEqual(["payload-create", "payload-update"]);
  expect(await counts()).toMatchObject({ rows: before.rows + 2, revisions: before.revisions + 2,
    rowFacts: before.rowFacts + 2, commits: before.commits + 1, outcomes: before.outcomes + 1, events: before.events });
  const denied: readonly [string, typeof allow, string][] = [
    ["source denied", { ...allow, source: { ...allow.source, create: false } }, `await ${create};`],
    ["assignment denied", { ...allow, assign: [] }, `await ${create};`],
    ["retention denied", { ...allow, retain: [] }, `await ctx.privateMixed.call("payload", "payload-update",
      { collection: "posts", id: ${JSON.stringify(value.article.id)}, data: { title: "Forbidden retention" } });`],
    ["forged native authority", allow, `await ctx.privateMixed.call("payload", "payload-create", { collection: "posts",
      overrideAccess: true, user: { role: "admin" }, context: { flarexPrivateReferenceSave: {} },
      data: { title: "Forged", featuredProduct: ${JSON.stringify(product.id)} } });`],
    ["other collection", allow, `await ctx.privateMixed.call("payload", "payload-create", { collection: "audit", data: { policy: {} } });`],
    ["commerce mutation", allow, `await ctx.privateMixed.call("medusa.product", "update", { id: ${JSON.stringify(product.id)}, data: { title: "Forbidden" } });`],
    ["unselected read", allow, `await ctx.privateMixed.call("payload", "payload-findByID", { collection: "posts", id: ${JSON.stringify(value.article.id)} });`],
    ["ordinary content patch", allow, `await ctx.db.patch(${JSON.stringify(value.article.id)}, { title: "Bypass" });`],
    ["policy self grant", allow, `await ctx.db.patch(${JSON.stringify(policy.documentId)}, {});`],
    ["nested target write", allow, `await ctx.privateMixed.call("payload", "payload-update", { collection: "posts",
      id: ${JSON.stringify(value.article.id)}, data: { featuredProduct: { id: ${JSON.stringify(product.id)}, title: "Forbidden" } } });`],
  ];
  for (const [name, decisions, deniedBody] of denied) {
    const update = await preparePrivateSavePolicy(fixture, decisions, policy.documentId);
    await update.root.publish();
    const baseline = await counts(), responseCount = responses.length, nativeCount = invocations.length;
    const { execution, result } = await Effect.runPromise(prepare(`await ctx.db.insert("users", { name: "Must roll back" });
      try { ${deniedBody} } catch (_) {} return "caught refusal";`));
    expect(Result.isFailure(result), name).toBe(true);
    expect(responses.slice(responseCount), name).toEqual([name === "policy self grant"
      ? { ...opaque, cause: "Ordinary Application mutations cannot write this managed table." } : opaque]);
    expect(await counts(), name).toEqual(baseline);
    expect(invocations.length - nativeCount, name).toBe(["commerce mutation", "unselected read", "ordinary content patch", "policy self grant"].includes(name) ? 0 : 1);
    // No cached committed success is created for a refusal, even when caught.
    const anchor = execution.currentRoot().context.anchor;
    await expect(Effect.runPromise(execution.owner.redispatchExactPointMutationAttempt({ deploymentId: anchor.deploymentId,
      scopeId: anchor.scopeId, sessionId: anchor.sessionId, attemptFence: anchor.attemptFence.toString() })))
      .rejects.toMatchObject({ reason: "lifecycle" });
  }
  const noTargets = await preparePrivateSavePolicy(fixture, { ...allow, assign: [], retain: [] }, policy.documentId);
  await noTargets.root.publish();
  const clearing = await Effect.runPromise(prepare(`const article = await ctx.privateMixed.call("payload", "payload-update",
    { collection: "posts", id: ${JSON.stringify(value.article.id)}, data: { featuredProduct: null } });
    await ctx.privateMixed.call("payload", "payload-delete", { collection: "posts", id: article.id }); return article.id;`));
  expect(clearing.result).toMatchObject({ _tag: "Success", success: { kind: "published" } });
  const reset = await preparePrivateSavePolicy(fixture, allow, policy.documentId);
  await reset.root.publish();
  let revoked = false;
  const beforeStale = await counts();
  const stale = await Effect.runPromise(prepare(`return ${create};`, async () => {
    if (revoked) return;
    revoked = true;
    const revoke = await preparePrivateSavePolicy(fixture, { ...allow, source: { ...allow.source, create: false }, assign: [], retain: [] }, policy.documentId);
    await revoke.root.publish();
  }));
  const failed = stale.result;
  if (Result.isSuccess(failed) || !(failed.failure instanceof PointCommitConflictV1Error))
    throw new Error("Expected real serving permission conflict", { cause: Result.isSuccess(failed) ? failed.success : failed.failure });
  const afterRevoke = await counts();
  expect(afterRevoke).toMatchObject({ rows: beforeStale.rows, revisions: beforeStale.revisions + 1,
    commits: beforeStale.commits + 1, outcomes: beforeStale.outcomes + 1 });
  const responseCount = responses.length, calls = invocations.length;
  await expect(Effect.runPromise(stale.execution.owner.retryFailedAttempt(failed.failure))).rejects.toBeDefined();
  expect(invocations.length - calls).toBe(1); // Actual new native invocation observes denied source access.
  expect(responses.slice(responseCount)).toEqual([opaque]);
  expect(await counts()).toEqual(afterRevoke);
  const resetCancellation = await preparePrivateSavePolicy(fixture, allow, policy.documentId);
  await resetCancellation.root.publish();
  const receipt = Deferred.makeUnsafe<void>();
  let disposed = false;
  const beforeCancellation = await counts();
  const cancellation = Effect.runFork(prepare(`await ctx.db.insert("users", { name: "Interrupted serving work" });
    ${create}; while (true) {}`, undefined, { onReceipt: () => { Deferred.doneUnsafe(receipt, Effect.void); }, onDisposed: () => { disposed = true; } }));
  try {
    await withTimeout(Effect.runPromise(Deferred.await(receipt)), 30_000, "genuine native serving receipt before Worker interruption");
    await Effect.runPromise(Effect.sleep(25));
    await Effect.runPromise(Fiber.interrupt(cancellation));
    const exit = await Effect.runPromise(Fiber.await(cancellation));
    expect(Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(disposed).toBe(true);
    expect(await counts()).toEqual(beforeCancellation);
  } finally { await Effect.runPromise(Fiber.interrupt(cancellation)); }
  for (const mode of ["foreignPrincipal", "storedCorruption", "missing"] as const) {
    const changing = await fixture.fixture.open();
    const command = await Effect.runPromise(fixture.fixture.store.preparePrivateApplicationCommandEffect(changing.attempt, "audit"));
    const syscallSequence = CommitSyscallSequenceV1Schema.make(1n);
    await Effect.runPromise(command.run(mode === "missing" ? { kind: "delete", syscallSequence, documentId: policy.documentId }
      : { kind: "replace", syscallSequence, documentId: policy.documentId, fields: { policy: mode === "storedCorruption" ? {} : {
        format: "flarex.private-reference-permissions", version: 1, collection: "posts", relation: "featuredProduct", ...allow,
        principal: { ...changing.principal, principalDigest: "0".repeat(64) },
      } } }, changing.validator));
    await changing.publish();
    const baseline = await counts(), responseCount = responses.length, calls = invocations.length;
    const refused = await Effect.runPromise(prepare(`return ${create};`));
    expect(refused.result).toMatchObject({ _tag: "Failure", failure: { _tag: "ApplicationPointMutationRunnerHostV1Error",
      cause: mode === "missing" ? { _tag: "PrivateSaveAccessError", reason: "denied" }
        : { _tag: "PrivatePermissionEvidenceError", reason: mode === "foreignPrincipal" ? "invalidAuthority" : "storedCorruption" } } });
    expect(responses).toHaveLength(responseCount); // No sandbox or native runtime is entered after failed preflight.
    expect(invocations).toHaveLength(calls);
    expect(await counts()).toEqual(baseline);
  }
}
