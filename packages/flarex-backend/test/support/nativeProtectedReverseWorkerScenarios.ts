import { Cause, Effect, Exit, Result, Schema } from "effect";
import { expect } from "vitest";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { decodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import type { Json } from "flarex-protocol/json";
import { CoreNativeBudgetError } from "../../../persistence-postgres/src/core/api";
import type { CoreSchemaBundle } from "../../../persistence-postgres/src/core/schemaBundle";
import { CmsTransactionError, cmsLimits } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { coreNativeFixtureData } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { coreNativeTestBudget } from "../../../persistence-postgres/test/core/nativeTestBudget";
import { createNativeProtectedWorkerFixture } from "./nativeProtectedWorkerFixture";

const decodeResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
  pages: Schema.Array(Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: Schema.String, headline: Schema.String })),
    hasMore: Schema.Boolean, cursor: Schema.NullOr(Schema.String) })),
  user: Schema.Struct({ _id: Schema.String, name: Schema.String }) }));

// The analyzed function receives only the genuine private page/save calls and
// ordinary Application point operations. It cannot issue policies or cursors.
const handlerSource = `export async function save(ctx, args) {
  const id = await ctx.db.insert("users", { name: "Before reverse pages" });
  const pages = [];
  for (let index = 0; index < args.count; index++) {
    const previous = pages[index - 1];
    const request = args.operation === "repeat" || previous === undefined ? { limit: 1 }
      : { limit: 1, cursor: previous.cursor };
    try {
      pages.push(await ctx.privateMixed.call("payload", "private-reference-page", request));
      if (index === 0 && args.operation === "pending-update") {
        await ctx.privateMixed.call("payload", "payload-update", {
          collection: "articles", id: args.articleId, data: { headline: "Changed in the pending root" }
        });
      }
    } catch (failure) {
      if (args.catchFailure) return { id, pages, caught: true };
      throw failure;
    }
  }
  await ctx.db.patch(id, { name: pages.map(page => page.docs[0]?.headline || "Empty").join("|") });
  return { id, pages, user: await ctx.db.get(id) };
}`;

/** Arrangement and observation over the real Worker/Local API/Core fixture.
 * No permission, membership, continuation or settlement evaluator lives here. */
export async function nativeProtectedReverseWorkerScenarios(driver: "pglite" | "postgres") {
  const hookIds: string[] = [];
  let failHookFor: string | undefined;
  let completedPages = 0;
  let afterPage: (() => Promise<void>) | undefined;
  const fixture = await createNativeProtectedWorkerFixture(driver, { handlerSource,
    payloadInstrumentation: { hooks: { afterRead: [({ doc }) => {
      hookIds.push(String(doc.id));
      if (doc.id === failHookFor) throw new Error("Native reverse visible lookahead hook failed");
      return { ...doc, headline: `${doc.headline} read` };
    }] } },
    onCapabilityResult: async (method, args) => {
      if (method !== "runPrivateNativeOperation" || !Result.match(decodeAdmittedFrameworkOperationV1Result(args[0]), {
        onFailure: () => false,
        onSuccess: request => request.participant === "payload" && request.operation === "private-reference-page",
      })) return;
      completedPages++;
      const action = afterPage;
      afterPage = undefined;
      await action?.();
    } });
  try {
    const { run, payloadDefinition, seedProduct, limits } = fixture;
    // One full membership window and its genuine lookahead witness suffice to
    // distinguish cumulative work from the number of distinct captured IDs.
    await run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
      const binding = yield* database.bindNative({ definition: payloadDefinition });
      const seed = yield* database.beginNative(binding, { commandName: "payload-create", limits,
        chargeRetained: coreNativeTestBudget().chargeRetained });
      for (let index = 0; index <= cmsLimits.pageRows; index++) yield* seed.operations.insert("articles", {
        headline: `Reverse source ${index}`, featuredProduct: seedProduct.id,
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
      yield* database.commit(yield* seed.finalize());
    })));
    const members = await run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
      const binding = yield* database.bindNative({ definition: payloadDefinition });
      const ordered = yield* database.beginNative(binding, { commandName: "payload-findByID", limits,
        chargeRetained: coreNativeTestBudget().chargeRetained });
      const page = yield* ordered.operations.protectedReferencePage("article_product", seedProduct.id, { limit: cmsLimits.pageRows });
      yield* ordered.finishRead();
      return page;
    })));
    expect(members.inspectedMemberships).toBe(cmsLimits.pageRows + 1);
    expect(members.hasMore).toBe(true);
    const first = members.ids[1], second = members.ids[3], third = members.ids[6], hidden = members.ids[0];
    if (first === undefined || second === undefined || third === undefined || hidden === undefined)
      throw new Error("Missing genuine ordered reverse memberships");
    const visible = [first, second, third];
    const permissions = (articles: readonly string[], enumerate: readonly string[] = [seedProduct.id]) => ({
      format: "flarex.private-reference-read-permissions", version: 1, principal: fixture.principal,
      collection: "articles", relation: "featuredProduct", enumerate: [...enumerate], articles: [...articles] });
    const policyId = await run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
      const policy = yield* database.begin();
      const id = yield* policy.insert("permissions", { policy: permissions(visible) });
      yield* database.commit(yield* policy.finalize());
      return id;
    })));
    const patchSource = Effect.fn("NativeProtectedReverseFixture.patchSource")((id: string, headline: string) =>
      fixture.useGeneration(({ database }) => Effect.gen(function* () {
        const selected = yield* database.bindNative({ definition: payloadDefinition });
        const editing = yield* database.beginNative(selected, { commandName: "payload-update", limits,
          chargeRetained: coreNativeTestBudget().chargeRetained });
        yield* editing.operations.patch(id, { headline });
        return yield* database.commit(yield* editing.finalize());
      })));
    const setVisible = (articles: readonly string[], enumerate?: readonly string[]) => run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
      const editing = yield* database.begin();
      yield* editing.patch(policyId, { policy: permissions(articles, enumerate) });
      yield* database.commit(yield* editing.finalize());
    })));
    const invoke = (name: string, args: Json, includeSave?: true) => fixture.port(
      fixture.reverseRoot(policyId, seedProduct.id, includeSave === true ? { includeSave } : {}),
      { kind: "reverse", policyId, targetId: seedProduct.id, ...(includeSave === true ? { includeSave } : {}) },
    ).invoke(fixture.path, args, TransactionRequestKeyV1Schema.make(`native-reverse-${name}`), fixture.access);
    const reset = () => { hookIds.length = 0; completedPages = 0; afterPage = undefined; failHookFor = undefined; };

    // Hidden identities contribute membership observations, but their source
    // bodies and hooks do not. A concurrent hidden body edit can still publish.
    reset();
    const beforeSparse = await fixture.inventory();
    afterPage = async () => { await run(patchSource(hidden, "Hidden body changed after membership capture")); };
    const sparse = await run(invoke("sparse-hidden-body", { operation: "traverse", count: 3 }));
    const sparseResult = decodeResult(sparse.value);
    expect(sparse.disposition).toBe("published");
    expect(sparseResult.pages.map(page => page.docs.map(doc => doc.id))).toEqual(visible.map(id => [id]));
    expect(sparseResult.pages.map(page => page.hasMore)).toEqual([true, true, false]);
    expect(sparseResult.pages.slice(0, 2).every(page => /^[a-f0-9-]{36}$/.test(page.cursor ?? ""))).toBe(true);
    expect(sparseResult.pages[2]?.cursor).toBeNull();
    expect(hookIds).toEqual([first, second, second, third, third]);
    expect(sparseResult.pages.every(page => page.docs[0]?.headline.endsWith(" read"))).toBe(true);
    expect(sparseResult.user).toEqual({ _id: sparseResult.id,
      name: sparseResult.pages.map(page => page.docs[0]?.headline).join("|") });
    const afterSparse = await fixture.inventory();
    expect(afterSparse.rows.length - beforeSparse.rows.length).toBe(1);
    expect(afterSparse.outcomes.length - beforeSparse.outcomes.length).toBe(1);

    // Historical correlation is checked before current target admission. The
    // same key and arguments cannot disclose a result for a different target.
    const opensAfterSparse = fixture.opens, loadsAfterSparse = fixture.loader.loads;
    const otherTarget = "native-reverse-missing-target";
    expect(await run(Effect.flip(fixture.port(fixture.reverseRoot(policyId, otherTarget), {
      kind: "reverse", policyId, targetId: otherTarget,
    }).invoke(fixture.path, { operation: "traverse", count: 3 },
      TransactionRequestKeyV1Schema.make("native-reverse-sparse-hidden-body"), fixture.access))))
      .toMatchObject({ _tag: "CoreTransactionError", reason: "requestMismatch" });
    expect({ opens: fixture.opens, loads: fixture.loader.loads }).toEqual({ opens: opensAfterSparse, loads: loadsAfterSparse });
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(afterSparse));

    // Enumeration does not authorize the independently selected target read.
    // These refusals occur before loading the Worker or hydrating source rows.
    reset();
    const beforeTargetDenied = await fixture.inventory(), loadsBeforeTargetDenied = fixture.loader.loads;
    const deniedTarget = await run(Effect.exit(fixture.port(fixture.reverseRoot(policyId, seedProduct.id, { targetReadIds: [] }), {
      kind: "reverse", policyId, targetId: seedProduct.id, targetReadIds: [],
    }).invoke(fixture.path, { operation: "traverse", count: 1 }, TransactionRequestKeyV1Schema.make("native-reverse-target-read-denied"), fixture.access)));
    expect(deniedTarget._tag).toBe("Failure");
    if (Exit.isFailure(deniedTarget)) expect(deniedTarget.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toEqual(expect.arrayContaining([expect.objectContaining({ _tag: "CmsTransactionError", reason: "invalidAuthority" })]));
    expect(fixture.loader.loads).toBe(loadsBeforeTargetDenied);
    expect(hookIds).toEqual([]);
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforeTargetDenied));

    await setVisible(visible, [seedProduct.id, otherTarget]);
    reset();
    const beforeMissingTarget = await fixture.inventory(), loadsBeforeMissingTarget = fixture.loader.loads;
    const missingTarget = await run(Effect.exit(fixture.port(fixture.reverseRoot(policyId, otherTarget), {
      kind: "reverse", policyId, targetId: otherTarget,
    }).invoke(fixture.path, { operation: "traverse", count: 1 }, TransactionRequestKeyV1Schema.make("native-reverse-target-missing"), fixture.access)));
    expect(missingTarget._tag).toBe("Failure");
    if (Exit.isFailure(missingTarget)) expect(missingTarget.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toEqual(expect.arrayContaining([expect.objectContaining({ _tag: "CmsTransactionError", reason: "invalidAuthority" })]));
    expect(fixture.loader.loads).toBe(loadsBeforeMissingTarget);
    expect(hookIds).toEqual([]);
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforeMissingTarget));
    await setVisible(visible);

    await run(fixture.product.host.run(fixture.product.host.newRequestKey(), fixture.product.runtime.commands.internalProductSoftDelete, seedProduct.id));
    reset();
    const beforeDeletedTarget = await fixture.inventory(), loadsBeforeDeletedTarget = fixture.loader.loads;
    const deletedTarget = await run(Effect.exit(invoke("target-soft-deleted", { operation: "traverse", count: 1 })));
    expect(deletedTarget._tag).toBe("Failure");
    if (Exit.isFailure(deletedTarget)) expect(deletedTarget.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toEqual(expect.arrayContaining([expect.objectContaining({ _tag: "CmsTransactionError", reason: "invalidAuthority" })]));
    expect(fixture.loader.loads).toBe(loadsBeforeDeletedTarget);
    expect(hookIds).toEqual([]);
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforeDeletedTarget));
    await run(fixture.product.host.run(fixture.product.host.newRequestKey(), fixture.product.runtime.commands.internalProductRestore, seedProduct.id));

    // The visible successor is genuinely hydrated through Payload even though
    // it is not in the first returned page. Its changed body must invalidate it.
    reset();
    const beforeLookahead = await fixture.inventory();
    let lookaheadChangeTimestamp: bigint | undefined;
    afterPage = async () => {
      lookaheadChangeTimestamp = await run(patchSource(second, "Visible lookahead changed after hydration"));
    };
    const staleLookahead = await run(Effect.exit(invoke("visible-lookahead-conflict", { operation: "traverse", count: 2 })));
    expect(staleLookahead._tag).toBe("Failure");
    expect(hookIds.slice(0, 2)).toEqual([first, second]);
    expect(lookaheadChangeTimestamp).toBeDefined();
    const afterLookahead = await fixture.inventory();
    expect(afterLookahead.revisions.length - beforeLookahead.revisions.length).toBe(1);
    expect(afterLookahead.revisions.filter(row => row.timestamp === lookaheadChangeTimestamp))
      .toMatchObject([{ table: "articles", value: { _id: second, headline: "Visible lookahead changed after hydration" } }]);
    expect(afterLookahead.rows.filter(row => row.value._id !== second)).toEqual(beforeLookahead.rows.filter(row => row.value._id !== second));

    // Repeating the same small result re-examines memberships. No cursor or
    // result limit refunds the shared access token's cumulative 256 allowance.
    reset();
    const beforeCumulative = await fixture.inventory();
    const expectedCompleted = Math.floor(cmsLimits.identities / members.inspectedMemberships);
    const cumulative = await run(Effect.exit(invoke("cumulative-memberships", {
      operation: "repeat", count: expectedCompleted + 1, catchFailure: true })));
    expect(cumulative._tag).toBe("Failure");
    if (Exit.isFailure(cumulative)) {
      const failures = cumulative.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
      expect(failures).toHaveLength(cumulative.cause.reasons.length);
      const nativeFailure = failures.find(error => error instanceof CmsTransactionError);
      expect(nativeFailure).toMatchObject({ _tag: "CmsTransactionError", reason: "limitExceeded" });
      expect(failures.some(error => error instanceof CoreNativeBudgetError && error.reason === "limitExceeded"
        && error.cause === nativeFailure)).toBe(true);
    }
    expect(completedPages).toBe(expectedCompleted);
    expect(completedPages * members.inspectedMemberships).toBeLessThanOrEqual(cmsLimits.identities);
    expect((completedPages + 1) * members.inspectedMemberships).toBeGreaterThan(cmsLimits.identities);
    expect(hookIds).toEqual(Array.from({ length: expectedCompleted }, () => [first, second]).flat());
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforeCumulative));

    // A real same-root Payload update advances the source pending generation.
    // The buffered continuation refuses before another document can be read.
    reset();
    const beforePending = await fixture.inventory();
    const pending = await run(Effect.exit(invoke("pending-generation", {
      operation: "pending-update", count: 2, articleId: first, catchFailure: true }, true)));
    expect(pending._tag).toBe("Failure");
    if (Exit.isFailure(pending)) {
      const failures = pending.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
      expect(failures).toHaveLength(pending.cause.reasons.length);
      const nativeFailure = failures.find(error => error instanceof CmsTransactionError);
      expect(nativeFailure).toMatchObject({ _tag: "CmsTransactionError", reason: "writeConflict",
        cause: { _tag: "CoreTransactionError", reason: "conflict", cause: "Protected reference page generation changed" } });
      expect(failures.some(error => error instanceof CoreNativeBudgetError && error.reason === "unexpectedFailure"
        && error.cause === nativeFailure)).toBe(true);
    }
    expect(completedPages).toBe(1);
    expect(hookIds.slice(0, 2)).toEqual([first, second]);
    expect(hookIds.filter(id => id === second)).toHaveLength(1);
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforePending));

    // A failing lookahead hook is a failed operation, never an empty/partial
    // page. Catching it in the authored Worker cannot commit its pending row.
    reset(); failHookFor = second;
    const beforeHook = await fixture.inventory();
    const hookFailure = await run(Effect.exit(invoke("lookahead-hook-failure", { operation: "traverse", count: 1, catchFailure: true })));
    expect(hookFailure._tag).toBe("Failure");
    expect(hookIds).toEqual([first, second]);
    expect(completedPages).toBe(0);
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforeHook));

    reset(); await setVisible([]);
    const allHidden = decodeResult((await run(invoke("all-hidden", { operation: "traverse", count: 1 }))).value);
    expect(allHidden.pages).toEqual([{ docs: [], hasMore: false, cursor: null }]);
    expect(hookIds).toEqual([]);
    await setVisible(visible);

    // This ABA uses authenticated source selection and the real shared schema
    // lifecycle. No registry/index metadata is replaced by test code.
    const activate = (bundle: CoreSchemaBundle) => run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
      const proposal = yield* database.prepareSchema({ bundle });
      for (let step = 0; step < 512; step++) {
        const status = yield* database.schemaStatus(proposal);
        if (status.state === "failed" || status.state === "overwritten")
          return yield* Effect.die(new Error(`Native reverse selection lifecycle ${status.state}`));
        if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
          yield* database.activateSchema(proposal, { programs: fixture.programs, bundle });
          return;
        }
        yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
      }
      return yield* Effect.die(new Error("Native reverse selection lifecycle exceeded its fixture work allowance"));
    })));
    reset();
    const beforeSelectionAba = await fixture.inventory();
    let selectionRestored = false;
    afterPage = async () => {
      await activate(fixture.withdrawalBundle);
      await activate(fixture.bundle);
      selectionRestored = true;
    };
    const selectionAba = await run(Effect.exit(invoke("selection-aba", { operation: "traverse", count: 2 })));
    expect(selectionAba._tag).toBe("Failure");
    expect(selectionRestored).toBe(true);
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforeSelectionAba));
    reset();
    expect((await run(invoke("fresh-after-selection-aba", { operation: "traverse", count: 1 }))).disposition).toBe("published");
    expect(hookIds).toEqual([first, second]);
  } finally { await fixture.close(); }
}
