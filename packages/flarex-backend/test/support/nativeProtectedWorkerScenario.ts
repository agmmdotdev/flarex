import { inspect } from "node:util";
import { Cause, Effect, Schema } from "effect";
import { expect } from "vitest";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { cmsLimits } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { coreNativeFixtureData } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { coreNativeTestBudget } from "../../../persistence-postgres/test/core/nativeTestBudget";
import { createNativeProtectedWorkerFixture, type NativeProtectedReadSelection } from "./nativeProtectedWorkerFixture";

/** Existing foundation assertions over the reusable genuine Worker/profile
 * composition. All data, authority, requests and recovery stay with Core. */
export async function nativeProtectedWorkerScenario(driver: "pglite" | "postgres") {
  const tested = await createNativeProtectedWorkerFixture(driver);
  const { product: fixture, seedProduct: product, policy, principal, policyDocumentId, payloadDefinition, programs,
    saveRoot: root, limits, loader, port, ordinary, inventory, path, key, access, withdrawalBundle: withdrawn } = tested;
  let phase = "setup";
  const run: typeof tested.run = work => tested.run(work.pipe(Effect.tapCause(cause => Effect.sync(() => {
    console.error(`Native protected Worker ${driver} / ${phase}\n${Cause.pretty(cause)}\n${inspect(cause.reasons,
      { depth: 8, maxArrayLength: 32, maxStringLength: 2048 })}`);
  }))));
  try {
    const before = await inventory();
    phase = "protected create";
    const saved = await run(port().invoke(path, { target: product.id }, key, access));
    expect(saved.disposition).toBe("published");
    const savedDocument = Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ featuredProduct: Schema.String }), id: Schema.String }))(saved.value);
    expect(savedDocument.article.featuredProduct).toBe(product.id);
    const after = await inventory();
    expect(after.rows.length - before.rows.length).toBe(2);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(after.revisions.filter(row => row.timestamp === saved.timestamp)).toHaveLength(2);
    const loaded = loader.loads;
    expect(await run(port().invoke(path, { target: product.id }, key, access))).toEqual({ ...saved, disposition: "replayed" });
    expect({ opens: tested.opens, loads: loader.loads }).toEqual({ opens: 1, loads: loaded });
    // Setup writes and membership ordering use the real shared owners. Hidden
    // source bodies are never substituted for the serving consumer's own reads.
    const ordered = await run(tested.useGeneration(({ database }) => Effect.gen(function* () {
      const seedBinding = yield* database.bindNative({ definition: payloadDefinition });
      const seeding = yield* database.beginNative(seedBinding, { commandName: "payload-create", limits,
        chargeRetained: coreNativeTestBudget().chargeRetained });
      for (let index = 0; index < 40; index++) yield* seeding.operations.insert("articles", {
        headline: `Native reverse article ${index}`, featuredProduct: product.id,
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
      yield* database.commit(yield* seeding.finalize());
      const reading = yield* database.beginNative(seedBinding, { commandName: "payload-findByID", limits,
        chargeRetained: coreNativeTestBudget().chargeRetained });
      const firstMembers = yield* reading.operations.protectedReferencePage("article_product", product.id, { limit: 32 });
      if (firstMembers.position === null) throw new Error("Missing actual reverse source continuation");
      const lastMembers = yield* reading.operations.protectedReferencePage("article_product", product.id,
        { limit: 32, position: firstMembers.position, generation: firstMembers.generation });
      yield* reading.finishRead();
      return [...firstMembers.ids, ...lastMembers.ids];
    })));
    const visible = [ordered[33], ordered[39]];
    if (visible[0] === undefined || visible[1] === undefined) throw new Error("Missing source rows beyond the first 32 memberships");
    const pagePolicyId = await run(tested.useGeneration(({ database }) => Effect.gen(function* () {
      const pagePolicy = yield* database.begin();
      const id = yield* pagePolicy.insert("permissions", { policy: { format: "flarex.private-reference-read-permissions", version: 1,
        principal, collection: "articles", relation: "featuredProduct", enumerate: [product.id], articles: visible } });
      yield* database.commit(yield* pagePolicy.finalize());
      return id;
    })));
    const reverseRoot = tested.reverseRoot(pagePolicyId, product.id);
    const beforePages = await inventory();
    phase = "reverse pages and pending patch";
    const pages = await run(port(reverseRoot, { kind: "reverse", policyId: pagePolicyId, targetId: product.id }).invoke(path,
      { operation: "pages" }, TransactionRequestKeyV1Schema.make("native-protected-worker-pages"), access));
    const pageResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
      first: Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: Schema.String, headline: Schema.String })), hasMore: Schema.Boolean, cursor: Schema.String }),
      second: Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: Schema.String, headline: Schema.String })), hasMore: Schema.Boolean, cursor: Schema.Null }),
      user: Schema.Struct({ _id: Schema.String, name: Schema.String }) }))(pages.value);
    expect(pageResult.first.docs.map(doc => doc.id)).toEqual(visible.slice(0, 1));
    expect(pageResult.first.hasMore).toBe(true); expect(pageResult.first.cursor).toMatch(/^[a-f0-9-]{36}$/);
    expect(pageResult.second.docs.map(doc => doc.id)).toEqual(visible.slice(1)); expect(pageResult.second.hasMore).toBe(false);
    const firstVisible = pageResult.first.docs[0], secondVisible = pageResult.second.docs[0];
    if (firstVisible === undefined || secondVisible === undefined) throw new Error("Missing actual visible native documents");
    expect(pageResult.user).toEqual({ _id: pageResult.id, name: firstVisible.headline + secondVisible.headline });
    const beforeLost = await inventory();
    expect(beforeLost.rows.length - beforePages.rows.length).toBe(1);
    expect(beforeLost.outcomes.length - beforePages.outcomes.length).toBe(1);
    for (const [name, operation, method, input] of [
      ["cross-attempt cursor", "caught-native", "private-reference-page", { limit: 1, cursor: pageResult.first.cursor }],
      ["unselected source read", "caught-native", "payload-findByID", { collection: "articles", id: visible[0] }],
      ["dropped forged cursor", "dropped-native", "private-reference-page", { limit: 1, cursor: "forged" }],
    ] as const) {
      const rootsBeforeRefusal = tested.opens, loadsBeforeRefusal = loader.loads;
      const refused = await run(Effect.exit(port(reverseRoot, { kind: "reverse", policyId: pagePolicyId, targetId: product.id }).invoke(path,
        { operation, participant: "payload", method, input }, TransactionRequestKeyV1Schema.make(`native-protected-${name}`), access)));
      expect(refused._tag, name).toBe("Failure");
      expect({ opens: tested.opens, loads: loader.loads }, name).toEqual({ opens: rootsBeforeRefusal + 1, loads: loadsBeforeRefusal + 1 });
      expect(coreNativeFixtureData(await inventory()), name).toEqual(coreNativeFixtureData(beforeLost));
    }
    for (const [name, args] of [["invalid pending body", { invalid: true }], ["committed policy row", { id: policyDocumentId }]] as const) {
      const baseline = await inventory();
      expect((await run(Effect.exit(port().invoke(path, { operation: "caught-patch", ...args },
        TransactionRequestKeyV1Schema.make(`native-protected-caught-patch-${name}`), access))))._tag, name).toBe("Failure");
      expect(coreNativeFixtureData(await inventory()), name).toEqual(coreNativeFixtureData(baseline));
    }
    // The normal Application profile owns these source tables and must enforce
    // their actual restrictive policy without acquiring any native facade.
    for (const table of ["users", "news"] as const) {
      phase = `ordinary ${table} insert`;
      const inserted = Schema.decodeUnknownSync(Schema.String)((await run(ordinary().invoke(path,
        { operation: "ordinary-reference", table, target: product.id },
        TransactionRequestKeyV1Schema.make(`native-protected-ordinary-${table}`), access))).value);
      const beforeSoftDelete = await inventory();
      expect((await run(Effect.exit(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.internalProductSoftDelete, product.id))))._tag)
        .toBe("Failure");
      expect(coreNativeFixtureData(await inventory())).toEqual(coreNativeFixtureData(beforeSoftDelete));
      phase = `ordinary ${table} clear`;
      await run(ordinary().invoke(path, { operation: "ordinary-clear", id: inserted },
        TransactionRequestKeyV1Schema.make(`native-protected-clear-ordinary-${table}`), access));
    }
    phase = "retained target create";
    const retainedTarget = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await run(fixture.host.run(
      fixture.host.newRequestKey(), fixture.runtime.commands.internalProductCreate, { title: "Retained target", handle: "native-protected-retained" })));
    await run(tested.useGeneration(({ database }) => Effect.gen(function* () {
      const permissionUpdate = yield* database.begin();
      yield* permissionUpdate.patch(policyDocumentId, { policy: { ...policy,
        assign: [product.id, retainedTarget.id], retain: [product.id, retainedTarget.id] } });
      yield* database.commit(yield* permissionUpdate.finalize());
    })));
    phase = "retained source create";
    const retainedSource = Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ id: Schema.String }) }))((await run(port().invoke(path,
      { target: retainedTarget.id }, TransactionRequestKeyV1Schema.make("native-protected-retained-create"), access))).value).article;
    phase = "retained target softdelete";
    await run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.internalProductSoftDelete, retainedTarget.id));
    phase = "retained unrelated source edit";
    const retainedEdit = await run(port().invoke(path, { operation: "retained-edit", id: retainedSource.id },
      TransactionRequestKeyV1Schema.make("native-protected-retained-edit"), access));
    expect(retainedEdit.disposition).toBe("published");
    expect(Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ featuredProduct: Schema.String }) }))(retainedEdit.value)
      .article.featuredProduct).toBe(retainedTarget.id);
    await run(tested.useGeneration(({ database }) => Effect.gen(function* () {
      const seedBinding = yield* database.bindNative({ definition: payloadDefinition });
      const retainedMembership = yield* database.beginNative(seedBinding, { commandName: "payload-findByID", limits,
        chargeRetained: coreNativeTestBudget().chargeRetained });
      expect((yield* retainedMembership.operations.protectedReferencePage("article_product", retainedTarget.id, { limit: 32 })).ids)
        .toEqual([retainedSource.id]);
      yield* retainedMembership.finishRead();
    })));
    const sourceRoot = tested.sourceRoot([retainedSource.id]);
    const sourceSelection: NativeProtectedReadSelection = { kind: "sourceRead", ids: [retainedSource.id] };
    const sourceKey = TransactionRequestKeyV1Schema.make("native-protected-explicit-source-read");
    phase = "actor-only explicit source read";
    const sourceRead = await run(port(sourceRoot, sourceSelection).invoke(path,
      { operation: "source-read", id: retainedSource.id }, sourceKey, access));
    expect(Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ featuredProduct: Schema.String }) }))(sourceRead.value)
      .article.featuredProduct).toBe(retainedTarget.id);
    // The source body is visible while the target is soft deleted. This root
    // has no Product participant, target call, enumeration or save selection.
    const sourceBaseline = await inventory();
    for (const [name, participant, method, input] of [
      ["target read", "medusa.product", "retrieve", { id: retainedTarget.id }],
      ["enumeration", "payload", "private-reference-page", { limit: 1 }],
      ["source write", "payload", "payload-update", { collection: "articles", id: retainedSource.id, data: { headline: "Forbidden" } }],
      ["unselected source", "payload", "payload-findByID", { collection: "articles", id: visible[0] }],
    ] as const) {
      expect((await run(Effect.exit(port(sourceRoot, sourceSelection).invoke(path, { operation: "caught-native", participant, method, input },
        TransactionRequestKeyV1Schema.make(`native-protected-source-denied-${name}`), access))))._tag, name).toBe("Failure");
      expect(coreNativeFixtureData(await inventory()), name).toEqual(coreNativeFixtureData(sourceBaseline));
    }
    // The existing owner starts at one call for the root invocation. Its one
    // insert plus 62 patches reach 64; one more patch must fail without refund.
    phase = "64 calls: root entry, insert, 62 patches";
    const patchBoundary = await run(port(sourceRoot, sourceSelection).invoke(path, { operation: "many-patches", count: 62 },
      TransactionRequestKeyV1Schema.make("native-protected-exact-64-calls"), access));
    expect(patchBoundary.disposition).toBe("published");
    expect(tested.lastSealedCalls).toBe(cmsLimits.calls);
    const beforeBudgetRefusals = await inventory();
    expect((await run(Effect.exit(port(sourceRoot, sourceSelection).invoke(path, { operation: "many-patches", count: 63 },
      TransactionRequestKeyV1Schema.make("native-protected-over-64-calls"), access))))._tag).toBe("Failure");
    expect(coreNativeFixtureData(await inventory())).toEqual(coreNativeFixtureData(beforeBudgetRefusals));
    const loadsBeforeOversizedArgs = loader.loads;
    expect(await run(Effect.flip(port(sourceRoot, sourceSelection).invoke(path,
      { operation: "large-result", bytes: 1, padding: "x".repeat(cmsLimits.commandBytes) },
      TransactionRequestKeyV1Schema.make("native-protected-oversized-arguments"), access)))).toMatchObject({ reason: "limitExceeded" });
    expect(loader.loads).toBe(loadsBeforeOversizedArgs);
    expect(coreNativeFixtureData(await inventory())).toEqual(coreNativeFixtureData(beforeBudgetRefusals));
    expect(await run(Effect.flip(port(sourceRoot, sourceSelection).invoke(path,
      { operation: "large-result", bytes: cmsLimits.commandBytes },
      TransactionRequestKeyV1Schema.make("native-protected-oversized-result"), access)))).toMatchObject({ reason: "limitExceeded" });
    expect(loader.loads).toBe(loadsBeforeOversizedArgs + 1);
    expect(coreNativeFixtureData(await inventory())).toEqual(coreNativeFixtureData(beforeBudgetRefusals));
    const beforeRestricted = await inventory();
    for (const table of ["users", "news"] as const) {
      expect(await run(Effect.flip(ordinary().invoke(path, { operation: "ordinary-reference", table, target: retainedTarget.id },
        TransactionRequestKeyV1Schema.make(`native-protected-inactive-ordinary-${table}`), access))))
        .toMatchObject({ reason: "relationTargetMissing" });
      expect(coreNativeFixtureData(await inventory())).toEqual(coreNativeFixtureData(beforeRestricted));
    }
    expect((await run(Effect.exit(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.delete, retainedTarget.id))))._tag)
      .toBe("Failure");
    expect(coreNativeFixtureData(await inventory())).toEqual(coreNativeFixtureData(beforeRestricted));
    expect(await run(Effect.flip(port().invoke(path, { operation: "clear-reassign", id: retainedSource.id, target: retainedTarget.id },
      TransactionRequestKeyV1Schema.make("native-protected-clear-reassign-deleted"), access))))
      .toMatchObject({ reason: "relationTargetMissing" });
    expect(coreNativeFixtureData(await inventory())).toEqual(coreNativeFixtureData(beforeRestricted));
    phase = "final reference clear";
    await run(port().invoke(path, { operation: "final-clear", id: retainedSource.id },
      TransactionRequestKeyV1Schema.make("native-protected-final-clear"), access));
    phase = "harddelete cleared softdeleted target";
    await run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.delete, retainedTarget.id));
    expect(await run(fixture.host.read(fixture.runtime.commands.internalProductList,
      { filters: { id: retainedTarget.id }, config: { withDeleted: true } }))).toEqual([]);
    // Arm only after the real Worker/native body and before Core's final write;
    // claim persistence has already completed. The transport loses the response
    // after the actual durable business/result write, never the write itself.
    const lostKey = TransactionRequestKeyV1Schema.make("native-protected-worker-lost-ack");
    const rootsBeforeLoss = tested.opens, beforeUncertain = await inventory();
    tested.armLostAcknowledgement();
    expect(await run(Effect.flip(port().invoke(path, { target: product.id }, lostKey, access))))
      .toMatchObject({ reason: "uncertainWrite" });
    expect(tested.lostAcknowledgementPending).toBe(false);
    const afterLostLoads = loader.loads;
    expect(tested.opens).toBe(rootsBeforeLoss + 1);
    const executedOpens = tested.opens;
    await run(tested.recover);
    const afterLost = await inventory();
    expect(afterLost.rows.length - beforeUncertain.rows.length).toBe(2);
    expect(afterLost.outcomes.length - beforeUncertain.outcomes.length).toBe(1);
    phase = "source withdrawal";
    await run(tested.useGeneration(({ database }) => Effect.gen(function* () {
      const withdrawal = yield* database.prepareSchema({ bundle: withdrawn });
      let ready = false;
      for (let step = 0; step < 512; step++) {
        const status = yield* database.schemaStatus(withdrawal);
        if ((status.state === "validated" || status.state === "active") && status.indexesReady) { ready = true; break; }
        if (status.state === "failed" || status.state === "overwritten") throw new Error(`Native binding withdrawal failed: ${status.error}`);
        yield* database.advanceSchema(withdrawal, { pageSize: 32, maxPages: 16 });
      }
      if (!ready) throw new Error("Native binding withdrawal did not become ready");
      yield* database.activateSchema(withdrawal, { programs, bundle: withdrawn });
      expect(yield* database.readAuthorityEpoch).toBe(0n);
      expect(yield* Effect.flip(database.bindNative({ definition: payloadDefinition }))).toMatchObject({ reason: "authorityRevoked" });
    })));
    await tested.reopen();
    phase = "cold authenticated historical replay";
    expect(await run(port().invoke(path, { target: product.id }, key, access))).toEqual({ ...saved, disposition: "replayed" });
    expect(await run(port(sourceRoot, sourceSelection).invoke(path,
      { operation: "source-read", id: retainedSource.id }, sourceKey, access))).toEqual({ ...sourceRead, disposition: "replayed" });
    const recovered = await run(port().invoke(path, { target: product.id }, lostKey, access));
    expect(recovered.disposition).toBe("replayed");
    expect(Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ featuredProduct: Schema.String }) }))(recovered.value)
      .article.featuredProduct).toBe(product.id);
    expect({ opens: tested.opens, loads: loader.loads }).toEqual({ opens: executedOpens, loads: afterLostLoads });
    expect(await run(tested.useGeneration(({ database }) => Effect.flip(database.bindNative({ definition: payloadDefinition })))))
      .toMatchObject({ reason: "authorityRevoked" });
    expect(await run(Effect.flip(port({ ...root, contract: { ...root.contract, principalDigest: "b".repeat(64) } })
      .invoke(path, { target: product.id }, key, access)))).toMatchObject({ reason: "requestMismatch" });
    expect(await run(Effect.flip(port().invoke(path, { target: product.id }, TransactionRequestKeyV1Schema.make("genuinely-absent-after-withdrawal"), access))))
      .toMatchObject({ reason: "authorityRevoked" });
    expect(loader.loads).toBe(afterLostLoads);
    const cold = await inventory();
    expect(cold.rows).toEqual(afterLost.rows);
  } finally { await tested.close(); }
}

