import { Effect, Exit, Fiber, Result } from "effect";
import { expect } from "vitest";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { currencyAnnouncementWrite } from "../../../../medusa-adapter/src/modules/currency/service";
import { CorePersistenceError, type CoreWriteBatch } from "../../../src/core/contracts";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "../../../src/execution/diagnostics/operation";
import { defineCommerceCommand, getCommerceCommand } from "../../../src/frameworks/commerceTransaction/commands";
import { compositeError } from "../../../src/frameworks/crossDomainCommand/model";
import { coreNativeFixtureData } from "../../core/nativeFixtureInventory";
import { nativePreference, nativeTokenInvalidated, awaitNativeTestGate } from "../../integration/payload/payloadNativeRelationFixture";
import { barrier } from "../../integration/payload/payloadRelationScenario";
import { decodeJointAuthor, decodeJointResult, jointApplicationRelationsFixture } from "./jointApplicationRelationsFixture";

export async function jointApplicationRelationsScenario(driver: "pglite" | "postgres") {
  let failAt: "documents" | "indexes" | undefined;
  let faults = 0;
  const batches: CoreWriteBatch[] = [];
  const tested = await jointApplicationRelationsFixture(driver, {
    observeWrite: batch => batches.push(batch),
    wrapRuntimeDriver: original => ({ ...original, transaction: work => original.transaction(connection => work({ ...connection,
      query: (statement, parameters) => connection.query(statement, parameters).pipe(Effect.tap(() => {
        if (failAt === undefined || !statement.toLowerCase().startsWith("insert into ") || !statement.includes(`."${failAt}"`)) return Effect.void;
        failAt = undefined; faults++;
        return Effect.fail(new CorePersistenceError({ reason: "unavailable", cause: "after actual joint physical write, before SQL commit" }));
      })),
    })) }),
  });
  const { native } = tested;
  const { run } = native;
  let payloadCalls = 0, currencyCalls = 0;
  const diagnostics: ExecutionDiagnosticPolicy = { observe: (name, work) => name === "PayloadAdapter.call"
    ? Effect.sync(() => { payloadCalls++; }).pipe(Effect.andThen(work)) : work };
  const observe = <A, E>(work: Effect.Effect<A, E>) => work.pipe(Effect.provideService(ExecutionDiagnostics, diagnostics));
  try {
    const author = decodeJointAuthor(await run(native.payloadWriter.create(native.payloadWriter.newRequestKey(), { collection: "authors", data: { name: "Ada" } })));
    const nativeCurrency = getCommerceCommand(currencyAnnouncementWrite);
    if (nativeCurrency === undefined) throw new Error("Missing genuine native Currency command");
    const currencyCommand = defineCommerceCommand(nativeCurrency.name, nativeCurrency.mode,
      (context, args) => Effect.sync(() => { currencyCalls++; }).pipe(Effect.andThen(nativeCurrency.run(context, args))));
    let host = await run(native.announcement({ currencyCommand }));
    const cleanupBundle = native.cleanupBundle, preferenceDefinition = native.preferenceDefinition;
    if (cleanupBundle === undefined || preferenceDefinition === undefined) throw new Error("Missing authenticated future preference installation proof");
    expect(await run(Effect.flip(native.database.bindNative({ definition: preferenceDefinition })))).toMatchObject({ reason: "authorityRevoked" });
    const pendingCleanup = await run(native.database.prepareSchema({ bundle: cleanupBundle }));
    expect(await run(Effect.flip(native.database.bindNative({ definition: preferenceDefinition })))).toMatchObject({ reason: "authorityRevoked" });
    expect(await run(Effect.result(native.database.activateSchema(pendingCleanup, { programs: [], bundle: cleanupBundle })))).toMatchObject({ failure: expect.anything() });
    const args = { currency: { code: "jnt", name: "Joint relation", symbol: "J", symbol_native: "J" },
      cms: { collection: "articles", data: { headline: "Joint relation", author: author.id } }, application: { name: "Joint relation audit" } };
    const before = await native.inventory();
    const absence = await run(tested.incoming(author.id));
    expect(absence.ids).toEqual([]);
    const writesBefore = batches.length;
    const key = host.newRequestKey();
    const result = decodeJointResult(await run(observe(host.run(key, args))));
    expect(result.cms.author).toBe(author.id);
    expect(result.currency.code).toBe("jnt");
    expect({ payload: payloadCalls, currency: currencyCalls }).toEqual({ payload: 1, currency: 1 });
    let created = await native.inventory();
    expect(created.rows.length - before.rows.length).toBe(3);
    expect(created.outcomes.length - before.outcomes.length).toBe(1);
    const outcome = created.outcomes.find(outcome => outcome.value.key === key);
    expect(outcome?.value.state).toBe("committed");
    const timestamp = outcome?.timestamp;
    expect(timestamp).toBeDefined();
    const committedRows = created.revisions.filter(row => row.timestamp === timestamp);
    expect(committedRows).toHaveLength(3);
    for (const documentId of [result.applicationId, result.cms.id]) {
      const identity = Result.getOrThrow(decodeDocumentId(documentId));
      expect(committedRows.some(row => row.id === encodeBytesToLowercaseHex(identity.internalId))).toBe(true);
    }
    const committedIndexes = created.indexes.filter(index => index.timestamp === timestamp);
    expect(new Set(committedIndexes.map(index => index.table)).size).toBe(3);
    const definition = (await run(native.database.readNativeBinding(native.payloadBinding))).definition;
    const reverse = definition.references[0];
    if (reverse === undefined) throw new Error("Missing actual native reference policy");
    expect(committedIndexes).toContainEqual(expect.objectContaining({ table: reverse.sourceTable, name: reverse.indexName,
      id: encodeBytesToLowercaseHex(Result.getOrThrow(decodeDocumentId(result.cms.id)).internalId) }));
    expect(await run(tested.incoming(author.id))).toMatchObject({ ids: [result.cms.id], hasMore: false });
    expect(nativeTokenInvalidated(absence.token, batches.slice(writesBefore))).toBe(true);
    expect(await run(native.payloadReader.findByID({ collection: "articles", id: result.cms.id, depth: 1 }))).toMatchObject({ author });
    expect(await run(observe(host.run(key, args)))).toEqual(result);
    expect({ payload: payloadCalls, currency: currencyCalls }).toEqual({ payload: 1, currency: 1 });
    expect(await native.inventory()).toEqual(created);
    // Opaque Core roots and command closure are the current generation-loan authority.
    expect(await run(Effect.flip(native.database.readNativeRootBinding({ ...native.rootBinding })))).toMatchObject({ reason: "authorityRevoked" });
    expect(await run(Effect.result(native.announcement({ currencyCommand, cmsCommand: inspectPayloadRuntimeForTest(native.payload.runtime).commands.delete })))).toMatchObject({ failure: { reason: "invalidAuthority" } });
    expect(await native.inventory()).toEqual(created);
    for (const phase of ["documents", "indexes"] as const) {
      const callbacks = { payload: payloadCalls, currency: currencyCalls };
      const faultsBefore = faults;
      let completedParticipants = 0;
      const failing = await run(native.announcement({ currencyCommand, hooks: { afterSteps: () => Effect.sync(() => {
        completedParticipants++; failAt = phase;
      }) } }));
      const failedKey = failing.newRequestKey();
      const failedArgs = { ...args, currency: { ...args.currency, code: phase === "documents" ? "jra" : "jrb" },
        cms: { ...args.cms, data: { ...args.cms.data, headline: phase } } };
      expect(Exit.isFailure(await run(Effect.exit(observe(failing.run(failedKey, failedArgs)))))).toBe(true);
      expect(faults).toBe(faultsBefore + 1);
      expect(completedParticipants).toBe(1);
      expect({ payload: payloadCalls, currency: currencyCalls }).toEqual({ payload: callbacks.payload + 1, currency: callbacks.currency + 1 });
      failAt = undefined;
      await native.reopen();
      host = await run(native.announcement({ currencyCommand }));
      expect(await run(Effect.flip(observe(host.run(failedKey, failedArgs))))).toMatchObject({ reason: "requestConflict" });
      expect({ payload: payloadCalls, currency: currencyCalls }).toEqual({ payload: callbacks.payload + 1, currency: callbacks.currency + 1 });
      const recovered = await native.inventory();
      expect(coreNativeFixtureData(recovered)).toEqual(coreNativeFixtureData(created));
      expect(recovered.outcomes).toHaveLength(created.outcomes.length + 1);
      expect(recovered.outcomes.find(row => row.value.key === failedKey)?.value.state).toBe("failed");
      created = recovered;
      expect(await run(observe(host.run(key, args)))).toEqual(result);
    }
    const failed = await run(native.announcement({ currencyCommand, hooks: { afterSteps: () => Effect.fail(compositeError("invalidInput")) } }));
    const failedKey = failed.newRequestKey();
    const failedArgs = { ...args, currency: { ...args.currency, code: "jrc" }, cms: { ...args.cms, data: { ...args.cms.data, headline: "after native steps" } } };
    const beforeFailure = await native.inventory();
    const callbacksBeforeFailure = { payload: payloadCalls, currency: currencyCalls };
    expect(await run(Effect.flip(observe(failed.run(failedKey, failedArgs))))).toMatchObject({ reason: "invalidInput" });
    const afterFailure = await native.inventory();
    expect(coreNativeFixtureData(afterFailure)).toEqual(coreNativeFixtureData(beforeFailure));
    expect(afterFailure.outcomes).toHaveLength(beforeFailure.outcomes.length + 1);
    expect(afterFailure.outcomes.find(row => row.value.key === failedKey)?.value.state).toBe("failed");
    expect(await run(Effect.flip(observe(failed.run(failedKey, failedArgs))))).toMatchObject({ reason: "requestConflict" });
    expect({ payload: payloadCalls, currency: currencyCalls }).toEqual({ payload: callbacksBeforeFailure.payload + 1, currency: callbacksBeforeFailure.currency + 1 });
    const entered = barrier<void>();
    const cancelHost = await run(native.announcement({ currencyCommand, hooks: { afterSteps: () => Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.never)) } }));
    const canceledKey = cancelHost.newRequestKey();
    const canceledArgs = { ...args, currency: { ...args.currency, code: "jcx" }, cms: { ...args.cms, data: { ...args.cms.data, headline: "cancel all" } } };
    const beforeCancel = await native.inventory();
    const cancelFiber = await run(observe(cancelHost.run(canceledKey, canceledArgs)).pipe(Effect.forkScoped));
    try { await run(awaitNativeTestGate(cancelFiber, Effect.promise(() => entered.promise))); await run(Fiber.interrupt(cancelFiber)); expect(Exit.isFailure(await run(Fiber.await(cancelFiber)))).toBe(true); }
    finally { await run(Fiber.interrupt(cancelFiber)); }
    const afterCancel = await native.inventory();
    expect(coreNativeFixtureData(afterCancel)).toEqual(coreNativeFixtureData(beforeCancel));
    expect(afterCancel.outcomes.find(row => row.value.key === canceledKey)?.value.state).toBe("failed");
    // Actual durable root outcome survives a lost save acknowledgement and cold owner replacement.
    const ackHost = await run(native.announcement({ currencyCommand, hooks: { afterSteps: () => Effect.sync(native.loseNextWriteAcknowledgement) } }));
    const ackKey = ackHost.newRequestKey();
    const ackArgs = { ...args, currency: { ...args.currency, code: "jac" }, cms: { ...args.cms, data: { ...args.cms.data, headline: "cold native ack" } } };
    expect(await run(Effect.flip(observe(ackHost.run(ackKey, ackArgs))))).toMatchObject({ reason: "decisionUncertain" });
    const callbacksAfterAck = { payload: payloadCalls, currency: currencyCalls };
    await native.reopen();
    host = await run(native.announcement({ currencyCommand }));
    expect(decodeJointResult(await run(observe(host.run(ackKey, ackArgs))))).toMatchObject({ currency: { code: "jac" }, cms: { author: author.id } });
    expect({ payload: payloadCalls, currency: currencyCalls }).toEqual(callbacksAfterAck);
    const staleRoot = native.rootBinding;
    const staleHost = host;
    const epoch = await run(native.database.readAuthorityEpoch);
    const beforeTransition = await native.inventory();
    await run(native.activatePayloadLifecycle());
    expect(await run(native.database.readAuthorityEpoch)).toBe(epoch + 1n);
    const transitioned = await native.inventory();
    expect(coreNativeFixtureData(transitioned)).toEqual(coreNativeFixtureData(beforeTransition));
    expect(transitioned.outcomes).toEqual(beforeTransition.outcomes);
    const callsBeforeTransitionRefusal = { payload: payloadCalls, currency: currencyCalls };
    expect(await run(Effect.flip(observe(staleHost.run(staleHost.newRequestKey(), { ...args,
      currency: { ...args.currency, code: "jst" }, cms: { ...args.cms, data: { ...args.cms.data, headline: "stale binding" } } }))))).toMatchObject({ reason: "bindingChanged" });
    expect({ payload: payloadCalls, currency: currencyCalls }).toEqual(callsBeforeTransitionRefusal);
    expect(await native.inventory()).toEqual(transitioned);
    await native.seedPreferences([
      nativePreference("author-pref", `collection-authors-${author.id}`), nativePreference("article-pref", `collection-articles-${result.cms.id}`),
      nativePreference("retained-pref", "collection-authors-unrelated"),
    ]);
    const beforeRestrict = await native.inventory();
    const restrictedKey = native.payloadWriter.newRequestKey();
    expect(await run(Effect.flip(native.payloadWriter.delete(restrictedKey, { collection: "authors", id: author.id })))).toMatchObject({ reason: "relationDeleteRestricted" });
    const afterRestrict = await native.inventory();
    expect(coreNativeFixtureData(afterRestrict)).toEqual(coreNativeFixtureData(beforeRestrict));
    expect(afterRestrict.outcomes.find(row => row.value.key === restrictedKey)?.value.state).toBe("failed");
    await run(native.payloadWriter.delete(native.payloadWriter.newRequestKey(), { collection: "articles", id: result.cms.id }));
    expect((await native.inventory()).rows.some(row => row.value.id === "article-pref")).toBe(false);
    // The second joint article still protects Ada until its same-owner source is removed.
    const articles = await run(native.payloadReader.find({ collection: "articles", limit: 32 }));
    for (const article of articles.docs) await run(native.payloadWriter.delete(native.payloadWriter.newRequestKey(), { collection: "articles", id: article.id }));
    await run(native.payloadWriter.delete(native.payloadWriter.newRequestKey(), { collection: "authors", id: author.id }));
    const cleaned = await native.inventory();
    expect(cleaned.rows.some(row => row.value.id === "author-pref")).toBe(false);
    expect(cleaned.rows.some(row => row.value.id === "retained-pref")).toBe(true);
    expect(await run(tested.incoming(author.id))).toMatchObject({ ids: [], hasMore: false });
    await native.reopen();
    expect(await run(Effect.flip(native.database.readNativeRootBinding(staleRoot)))).toMatchObject({ reason: "authorityRevoked" });
    expect(await native.inventory()).toEqual(cleaned);
  } finally { await native.close(); }
}
