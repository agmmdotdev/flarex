import { Cause, Effect, Exit, Schema } from "effect";
import { expect } from "vitest";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { canonicalizeTransactionGrantIdentityAccessPolicyV1Effect } from "flarex-protocol/transaction-grant";
import { decodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import type { Json } from "flarex-protocol/json";
import { CoreNativeReferenceError, CoreTransactionError } from "../../../persistence-postgres/src/core/api";
import { programKey } from "../../../persistence-postgres/src/core/registry";
import type { CoreSchemaBundle } from "../../../persistence-postgres/src/core/schemaBundle";
import { CoreApplicationMutationError } from "../../../persistence-postgres/src/application/coreMutation";
import { CommerceTransactionError } from "../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { CmsTransactionError, cmsLimits } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { coreNativeFixtureData } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { deferredSignal, withTimeout } from "../../../persistence-postgres/test/commit/point/support/postgresFaults";
import { createNativeProtectedWorkerFixture, type NativeProtectedWorkerFixture } from "./nativeProtectedWorkerFixture";

const handlerSource = `export async function save(ctx, args) {
  if (args.operation === "seed" || args.operation === "edit") {
    const article = await ctx.privateMixed.call("payload", args.operation === "seed" ? "payload-create" : "payload-update",
      args.operation === "seed" ? { collection: "articles", data: { headline: args.headline, featuredProduct: args.linked ? args.target : null } }
        : { collection: "articles", id: args.articleId, data: args.data });
    return { article };
  }
  const id = await ctx.db.insert("users", { name: "Pending protected consumption" });
  if (args.operation === "reverse") {
    const page = await ctx.privateMixed.call("payload", "private-reference-page", { limit: 1 });
    await ctx.db.patch(id, { name: JSON.stringify(page.docs) });
    const identity = await ctx.auth.getUserIdentity();
    return { id, page, subject: identity?.subject ?? null };
  }
  const product = await ctx.privateMixed.call("medusa.product", "retrieve", { id: args.target });
  const article = await ctx.privateMixed.call("payload", "payload-create", {
    collection: "articles", data: { headline: product.title, featuredProduct: args.target } });
  await ctx.db.patch(id, { name: article.headline });
  return { id, article };
}`;

const decodeArticle = Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ id: Schema.String, headline: Schema.String }) }));
const decodeReverse = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
  page: Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: Schema.String, headline: Schema.String })), hasMore: Schema.Boolean }),
  subject: Schema.NullOr(Schema.String) }));
const productId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));

function nativeMethod(method: string, args: readonly unknown[]): string | undefined {
  if (method !== "runPrivateNativeOperation") return;
  const decoded = decodeAdmittedFrameworkOperationV1Result(args[0]);
  return decoded._tag === "Success" && decoded.success.participant === "payload" ? decoded.success.operation : undefined;
}
const request = (label: string) => TransactionRequestKeyV1Schema.make(`protected-race-${label}`);
const stale = (cause: Cause.Cause<unknown>, label: string) => {
  const errors = cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
  expect(errors.some(error => error instanceof CoreTransactionError && (error.reason === "conflict" || error.reason === "authorityRevoked")
    || error instanceof CoreApplicationMutationError && error.reason === "revoked"), `${label}: ${Cause.pretty(cause)}`).toBe(true);
};
const data = async (fixture: NativeProtectedWorkerFixture) => coreNativeFixtureData(await fixture.inventory());

async function activate(fixture: NativeProtectedWorkerFixture, bundle: CoreSchemaBundle) {
  await fixture.run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
    const proposal = yield* database.prepareSchema({ bundle });
    for (let step = 0; step < 512; step++) {
      const status = yield* database.schemaStatus(proposal);
      if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Actual race selection failed: " + status.error));
      if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
        yield* database.activateSchema(proposal, { bundle, programs: fixture.programs });
        return;
      }
      yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
    }
    return yield* Effect.die(new Error("Actual race selection exceeded its bounded fixture work allowance"));
  })));
}
async function setPolicy(fixture: NativeProtectedWorkerFixture, id: string, policy: Json) {
  await fixture.run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
    const editing = yield* database.begin();
    yield* editing.patch(id, { policy });
    yield* database.commit(yield* editing.finalize());
  })));
}
async function savePermissions(fixture: NativeProtectedWorkerFixture, target: string, allowed = true) {
  await setPolicy(fixture, fixture.policyDocumentId, { ...fixture.policy, assign: allowed ? [target] : [], retain: allowed ? [target] : [] });
}
async function newProduct(fixture: NativeProtectedWorkerFixture, id: string) {
  const host = await fixture.run(fixture.product.openHost());
  try { return productId(await fixture.run(host.run(host.newRequestKey(), fixture.product.runtime.commands.internalProductCreate,
    { id, title: id, handle: id }))).id; } finally { await fixture.run(host.close); }
}
async function changeProduct(fixture: NativeProtectedWorkerFixture, target: string, mode: "body" | "softDelete" | "delete") {
  const host = await fixture.run(fixture.product.openHost());
  try {
    const commands = fixture.product.runtime.commands;
    return await fixture.run(host.run(host.newRequestKey(), mode === "body" ? commands.internalProductUpdate
      : mode === "softDelete" ? commands.internalProductSoftDelete : commands.delete,
    mode === "body" ? { id: target, title: "Changed native target" } : target));
  } finally { await fixture.run(host.close); }
}
const invokeSave = (fixture: NativeProtectedWorkerFixture, label: string, args: Json) =>
  fixture.port().invoke(fixture.path, args, request(label), fixture.access);

/** Both outcomes are scheduled at a genuine completed native RPC. No helper
 * decides conflicts, permissions, native visibility or commit acceptance. */
export async function nativeProtectedSaveRaceWorkerScenarios(driver: "pglite" | "postgres") {
  let held: (() => Promise<void>) | undefined, nativeSaves = 0;
  const fixture = await createNativeProtectedWorkerFixture(driver, { handlerSource,
    payloadInstrumentation: { hooks: { beforeChange: [({ data: value }) => { nativeSaves++; return value; }] } },
    onCapabilityResult: async (method, args) => {
      if (nativeMethod(method, args) !== "payload-create") return;
      const action = held; held = undefined;
      await action?.();
    } });
  try {
    for (const mode of ["permission", "delete", "softDelete"] as const) for (const first of ["save", "change"] as const) {
      const label = `save-${mode}-${first}`, target = await newProduct(fixture, label);
      await savePermissions(fixture, target);
      const entered = deferredSignal(), release = deferredSignal();
      held = async () => { entered.resolve(); await release.promise; };
      const beforeLoads = fixture.loader.loads, beforeHooks = nativeSaves, before = await data(fixture);
      const pending = fixture.run(Effect.exit(invokeSave(fixture, label, { target })));
      try {
        await withTimeout(Promise.race([entered.promise, pending.then(() => { throw new Error("Save settled before its genuine native barrier: " + label); })]),
          30_000, label);
        expect(nativeSaves).toBe(beforeHooks + 1);
        expect(await data(fixture)).toEqual(before);
        const change = () => mode === "permission" ? savePermissions(fixture, target, false) : changeProduct(fixture, target, mode);
        if (first === "change") {
          await change();
          const changed = await data(fixture);
          release.resolve();
          const outcome = await pending;
          if (Exit.isSuccess(outcome)) throw new Error("Stale native assignment published: " + label);
          stale(outcome.cause, label);
          expect(await data(fixture)).toEqual(changed);
        } else {
          release.resolve();
          const outcome = await pending;
          if (Exit.isFailure(outcome)) throw new Error("Winning native save failed: " + label, { cause: outcome.cause });
          expect(outcome.value.disposition).toBe("published");
          const saved = await data(fixture);
          expect(saved.rows.length - before.rows.length).toBe(2);
          if (mode === "delete") {
            const committed = await data(fixture), refused = await change().then(() => undefined, (failure: unknown) => failure);
            expect(refused).toBeInstanceOf(CommerceTransactionError);
            if (!(refused instanceof CommerceTransactionError)) throw new Error("Referenced Product delete lost its native error boundary", { cause: refused });
            expect(refused.cause).toBeInstanceOf(CoreNativeReferenceError);
            expect(refused.cause).toMatchObject({ reason: "relationDeleteRestricted" });
            expect(await data(fixture)).toEqual(committed);
          } else {
            await change();
            if (mode === "softDelete") {
              const articleTable = fixture.bundle.bindings.find(binding => binding.sourceKey === fixture.payloadDefinition.source.key
                && binding.localName === "articles");
              if (articleTable === undefined) throw new Error("Missing actual Payload source binding");
              expect((await data(fixture)).rows.filter(row => row.table === articleTable.coreTableName))
                .toEqual(saved.rows.filter(row => row.table === articleTable.coreTableName));
            }
          }
        }
        expect(nativeSaves).toBe(beforeHooks + 1);
        expect(fixture.loader.loads).toBe(beforeLoads + 1);
      } finally { release.resolve(); await pending; held = undefined; }
    }
  } finally { await fixture.close(); }
}

type ReverseRace = "enumerate" | "article" | "source" | "insert" | "remove" | "target" | "softDelete" | "withdrawal";
function readPolicy(fixture: NativeProtectedWorkerFixture, target: string, article: string, mode?: "enumerate" | "article") {
  return { format: "flarex.private-reference-read-permissions", version: 1, principal: fixture.principal,
    collection: "articles", relation: "featuredProduct", enumerate: mode === "enumerate" ? [] : [target], articles: mode === "article" ? [] : [article] };
}
async function seedReverse(fixture: NativeProtectedWorkerFixture, label: string, target: string, linked = true) {
  await savePermissions(fixture, target);
  const seeded = await fixture.run(invokeSave(fixture, label + "-seed", { operation: "seed", target, linked, headline: label }));
  const article = decodeArticle(seeded.value).article.id;
  const policyId = await fixture.run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
    const seed = yield* database.begin();
    const id = yield* seed.insert("permissions", { policy: readPolicy(fixture, target, article) });
    yield* database.commit(yield* seed.finalize());
    return id;
  })));
  return { article, policyId };
}
const invokeReverse = (fixture: NativeProtectedWorkerFixture, label: string, target: string, policyId: string, key = request(label)) =>
  fixture.port(fixture.reverseRoot(policyId, target), { kind: "reverse", policyId, targetId: target })
    .invoke(fixture.path, { operation: "reverse" }, key, fixture.access);

export async function nativeProtectedReverseRaceWorkerScenarios(driver: "pglite" | "postgres") {
  let held: (() => Promise<void>) | undefined;
  let phase = "initial construction";
  const fixture = await createNativeProtectedWorkerFixture(driver, { handlerSource, onCapabilityResult: async (method, args) => {
    if (nativeMethod(method, args) !== "private-reference-page") return;
    const action = held; held = undefined;
    await action?.();
  } });
  try {
    for (const mode of ["enumerate", "article", "source", "insert", "remove", "target", "softDelete", "withdrawal"] satisfies ReverseRace[])
      for (const first of ["read", "change"] as const) {
        const label = `reverse-${mode}-${first}`;
        phase = label + ": select fresh Product profile";
        const target = await newProduct(fixture, label);
        phase = label + ": seed source and permission";
        const { article, policyId } = await seedReverse(fixture, label, target, mode !== "insert");
        const entered = deferredSignal(), release = deferredSignal();
        held = async () => { entered.resolve(); await release.promise; };
        const before = await data(fixture), beforeLoads = fixture.loader.loads;
        const pending = fixture.run(Effect.exit(invokeReverse(fixture, label, target, policyId)));
        const change = async () => {
          phase = label + ": publish competing change";
          if (mode === "enumerate" || mode === "article") return setPolicy(fixture, policyId, readPolicy(fixture, target, article, mode));
          if (mode === "withdrawal") return activate(fixture, fixture.withdrawalBundle);
          if (mode === "target" || mode === "softDelete") { await changeProduct(fixture, target, mode === "target" ? "body" : mode); return; }
          await fixture.run(invokeSave(fixture, label + "-change", mode === "insert"
            ? { operation: "seed", target, linked: true, headline: "Inserted native membership" }
            : { operation: "edit", articleId: article, data: mode === "remove" ? { featuredProduct: null } : { headline: "Changed native source" } }));
        };
        try {
          phase = label + ": await completed native page";
          await withTimeout(Promise.race([entered.promise, pending.then(() => { throw new Error("Reverse settled before its real native barrier: " + label); })]),
            30_000, label);
          expect(await data(fixture)).toEqual(before);
          if (first === "change") {
            await change();
            const changed = await data(fixture);
            phase = label + ": refuse stale consumption";
            release.resolve();
            const outcome = await pending;
            if (Exit.isSuccess(outcome)) throw new Error("Stale native reverse page published: " + label);
            stale(outcome.cause, label);
            expect(await data(fixture)).toEqual(changed);
          } else {
            phase = label + ": publish winning consumption";
            release.resolve();
            const outcome = await pending;
            if (Exit.isFailure(outcome)) throw new Error("Winning native reverse failed: " + label, { cause: outcome.cause });
            const result = decodeReverse(outcome.value.value);
            expect(result.page.docs).toEqual(mode === "insert" ? [] : [{ id: article, headline: label }]);
            expect(result.page.hasMore).toBe(false);
            expect((await data(fixture)).rows.length - before.rows.length).toBe(1);
            await change();
          }
          expect(fixture.loader.loads).toBe(beforeLoads + (mode === "source" || mode === "insert" || mode === "remove" ? 2 : 1));
        } finally {
          release.resolve(); await pending; held = undefined;
          if (mode === "withdrawal") {
            const precedingPhase = phase;
            phase = label + ": explicitly restore selection";
            await activate(fixture, fixture.bundle);
            phase = precedingPhase;
          }
        }
      }
  } catch (cause) { throw new Error("Protected reverse race failed during " + phase, { cause });
  } finally { await fixture.close(); }
}

export async function nativeProtectedHeldWorkerScenario(driver: "pglite" | "postgres", mode: "cancel" | "deadline") {
  const entered = deferredSignal(), release = deferredSignal();
  let holds = 0, nativeDone = false, settledBeforeDrain = false;
  const fixture = await createNativeProtectedWorkerFixture(driver, { handlerSource, payloadInstrumentation: {
    hooks: { beforeChange: [async ({ data: value }) => {
      holds++; entered.resolve();
      try { await release.promise; return value; } finally { nativeDone = true; }
    }] },
  } });
  const controller = new AbortController();
  let pending: ReturnType<typeof Effect.runPromiseExit<unknown, unknown>> | undefined;
  try {
    const before = await data(fixture), beforeLoads = fixture.loader.loads;
    pending = Effect.runPromiseExit(invokeSave(fixture, "held-" + mode, { target: fixture.seedProduct.id }), { signal: controller.signal })
      .then(outcome => { if (!nativeDone) settledBeforeDrain = true; return outcome; });
    await withTimeout(Promise.race([entered.promise, pending.then(() => { throw new Error("Native held operation settled before hook entry"); })]),
      30_000, "genuine held native " + mode);
    if (mode === "cancel") controller.abort();
    await Effect.runPromise(Effect.sleep(mode === "deadline" ? cmsLimits.commandMs + 100 : 100));
    expect(nativeDone).toBe(false);
    expect(settledBeforeDrain).toBe(false);
    release.resolve();
    const outcome = await pending;
    if (Exit.isSuccess(outcome)) throw new Error("Held native " + mode + " published");
    if (mode === "cancel") expect(Cause.hasInterrupts(outcome.cause), Cause.pretty(outcome.cause)).toBe(true);
    else expect(outcome.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error instanceof CmsTransactionError
      && reason.error.reason === "deadlineExceeded"), Cause.pretty(outcome.cause)).toBe(true);
    expect({ holds, nativeDone, settledBeforeDrain }).toEqual({ holds: 1, nativeDone: true, settledBeforeDrain: false });
    expect(fixture.loader.loads).toBe(beforeLoads + 1);
    expect(await data(fixture)).toEqual(before);
  } finally { release.resolve(); controller.abort(); await pending; await fixture.close(); }
}

export async function nativeProtectedReverseRecoveryWorkerScenario(driver: "pglite" | "postgres") {
  let reads = 0;
  const fixture = await createNativeProtectedWorkerFixture(driver, { handlerSource,
    payloadInstrumentation: { hooks: { afterRead: [({ doc }) => { reads++; return doc; }] } } });
  try {
    const target = fixture.seedProduct.id, label = "reverse-recovery";
    const { article, policyId } = await seedReverse(fixture, label, target);
    const key = request(label), before = await data(fixture), beforeLoads = fixture.loader.loads;
    fixture.armLostAcknowledgement();
    expect(await fixture.run(Effect.flip(invokeReverse(fixture, label, target, policyId, key)))).toMatchObject({ reason: "uncertainWrite" });
    await fixture.run(fixture.recover);
    const committed = await data(fixture), historicalLoads = fixture.loader.loads, historicalOpens = fixture.opens, historicalReads = reads;
    expect(committed.rows.length - before.rows.length).toBe(1);
    expect(historicalLoads).toBe(beforeLoads + 1);
    await setPolicy(fixture, policyId, readPolicy(fixture, target, article, "enumerate"));
    await activate(fixture, fixture.withdrawalBundle);
    const withdrawn = await data(fixture);
    await fixture.reopen();
    const replay = await fixture.run(invokeReverse(fixture, label, target, policyId, key));
    expect(replay.disposition).toBe("replayed");
    expect(decodeReverse(replay.value).page.docs).toEqual([{ id: article, headline: label }]);
    expect(await fixture.run(invokeReverse(fixture, label, target, policyId, key))).toEqual(replay);
    expect({ loads: fixture.loader.loads, opens: fixture.opens, reads }).toEqual({ loads: historicalLoads, opens: historicalOpens, reads: historicalReads });
    expect(await data(fixture)).toEqual(withdrawn);
    expect(await fixture.run(Effect.flip(invokeReverse(fixture, label + "-withdrawn", target, policyId))))
      .toMatchObject({ reason: "authorityRevoked" });
    await activate(fixture, fixture.bundle);
    await setPolicy(fixture, policyId, readPolicy(fixture, target, article));
    const restored = await fixture.run(invokeReverse(fixture, label + "-restored", target, policyId));
    expect(restored.disposition).toBe("published");
    expect(decodeReverse(restored.value).page.docs).toEqual([{ id: article, headline: label }]);
    expect(fixture.loader.loads).toBe(historicalLoads + 1);
  } finally { await fixture.close(); }
}

export async function nativeProtectedScopeWorkerScenario(driver: "pglite" | "postgres") {
  const first = await createNativeProtectedWorkerFixture(driver, { handlerSource });
  let second: NativeProtectedWorkerFixture | undefined;
  const failures: unknown[] = [];
  try {
    const instanceName = "protected-second-scope";
    const persistence = await first.physical.reopen(instanceName);
    const access = await first.run(canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
      policyVersion: first.access.policy.policyVersion, capabilities: first.access.policy.capabilities,
      auth: { kind: "verifiedBearer", issuer: "https://native-protected.test", subject: "editor-b", claims: {} } }));
    second = await createNativeProtectedWorkerFixture(driver, { handlerSource, identityAccessPolicy: access,
      physical: Object.freeze({ ...first.physical, persistence, instanceName, close: async () => {} }),
      target: { scopeUuid: "77000000-0000-4000-8000-000000000011", epochUuid: "77000000-0000-4000-8000-000000000012" } });
    expect(second.physical.namespace).toBe(first.physical.namespace);
    expect(second.principal.scopeId).not.toBe(first.principal.scopeId);
    expect(second.principal.principalDigest).not.toBe(first.principal.principalDigest);
    const equalKey = "protected-equal-native-product";
    const a = await newProduct(first, equalKey), b = await newProduct(second, equalKey);
    expect(a).toBe(b);
    const seededA = await seedReverse(first, "scope-a", a), seededB = await seedReverse(second, "scope-b", b);
    const visibleA = decodeReverse((await first.run(invokeReverse(first, "scope-a-read", a, seededA.policyId))).value);
    const visibleB = decodeReverse((await second.run(invokeReverse(second, "scope-b-read", b, seededB.policyId))).value);
    expect(visibleA).toMatchObject({ page: { docs: [{ id: seededA.article, headline: "scope-a" }] }, subject: null });
    expect(visibleB).toMatchObject({ page: { docs: [{ id: seededB.article, headline: "scope-b" }] }, subject: "editor-b" });
    const baseline = [await data(first), await data(second)];
    const foreignPolicy = await second.run(Effect.exit(invokeReverse(second, "foreign-scope-policy", b, seededA.policyId)));
    if (Exit.isSuccess(foreignPolicy)) throw new Error("Foreign scope permission point authorized a protected page");
    expect(foreignPolicy.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error instanceof CmsTransactionError
      && reason.error.reason === "invalidAuthority"), Cause.pretty(foreignPolicy.cause)).toBe(true);
    const foreignRoot = first.reverseRoot(seededA.policyId, a);
    expect(foreignRoot.applicationRead?.program).toEqual(first.program.identity);
    expect(programKey(first.program.identity)).not.toBe(programKey(second.program.identity));
    const beforeForeignActor = { opens: second.opens, loads: second.loader.loads };
    const foreignTarget = await second.run(Effect.exit(second.port(foreignRoot,
      { kind: "reverse", policyId: seededB.policyId, targetId: b }).invoke(second.path, { operation: "reverse" }, request("foreign-scope-root"), second.access)));
    if (Exit.isSuccess(foreignTarget)) throw new Error("Foreign scope root authorized a protected target");
    // The foreign actor is rejected before any current native profile or
    // Worker opens; this is the admitted selection boundary, not a row lookup.
    expect(foreignTarget.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error instanceof CoreApplicationMutationError
      && reason.error.reason === "unsupportedSelection"), Cause.pretty(foreignTarget.cause)).toBe(true);
    expect({ opens: second.opens, loads: second.loader.loads }).toEqual(beforeForeignActor);
    expect([await data(first), await data(second)]).toEqual(baseline);
  } catch (cause) { failures.push(cause); }
  finally {
    // The secondary borrows the primary installation. Settle its whole owner
    // before releasing physical resources, even if either cleanup fails.
    if (second !== undefined) try { await second.close(); } catch (cause) { failures.push(cause); }
    try { await first.close(); } catch (cause) { failures.push(cause); }
    if (failures.length !== 0) throw new AggregateError(failures, "Protected scope Worker scenario or cleanup failed");
  }
}
