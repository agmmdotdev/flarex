import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { fxSystemScopeExecutionAuthorities } from "../../../src/database/schema";
import { expect } from "vitest";
import { Effect, Exit, Fiber } from "effect";
import { and, asc, eq, getTableName, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { closeInstallationAdmission, lockInstallationForCurrentTransaction, requireAdmittedTargetInstallationSchema } from "../../../src/installation/installationLifecycle";
import { isJsonObject } from "flarex-protocol/json";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { makeCmsHost, type CmsHostInput } from "../../../src/frameworks/cmsTransaction/host";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { makePayloadConformanceRuntime } from "../../../../payload-adapter/src/testing";
import { payloadScalarContentIdentity } from "../../../../payload-adapter/src/testing/profiles";
import { fxSystemCommitPayloadPreferenceDeletions } from "../../../src/frameworks/payloadPreferences/factsSchema";
import { fxSystemCommits, fxSystemScopeClocks, fxAppRowCurrent, fxAppRowRevisions } from "../../../src/database/schema";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { compactRetainedCommitHistoryPageEffect, createRetainedCommitHistoryCompactionPort } from "../../../src/storage/history/retainedCommitHistoryCompaction";
import { createLocatedRetainedHistoryFloorTargetInternal } from "../../../src/storage/history/retainedHistoryFloorObservation";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from "../../../src/execution/transactionSessionActivation";
import type { ExactTrustedScopeAuthorityResolutionPorts } from "../../../src/scope/scopeAuthorityResolution";
import type { LocatedRetainedHistoryFloorTarget } from "../../../src/storage/history/retainedHistoryFloorObservation";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

export async function payloadPreferencePublicationScenario(input: {
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence;
  hostInput: Omit<CmsHostInput<unknown>, "commands">;
  retentionAuthority: ExactTrustedScopeAuthorityResolutionPorts<LocatedRetainedHistoryFloorTarget>;
  seed: (postId: string, preferenceIds: readonly string[]) => Promise<void>;
  readPreferenceIds: () => Promise<readonly (string | null)[]>;
  inventory: () => Promise<unknown>;
}) {
  const { persistence, hostInput } = input;
  await runEffect(Effect.scoped(makePayloadConformanceRuntime().pipe(Effect.flatMap(conformance => Effect.promise(async () => {
    let failedStep: string | undefined;
    let failFacts = false;
    const pair = defineCmsCommand({ name: "delete-pair", mode: "write", run: Effect.fn("PreferenceTest.deletePair")(function* (ctx, args) {
      if (!isJsonObject(args)) return yield* Effect.fail(cmsError("invalidInput"));
      yield* ctx.nested(inspectPayloadRuntimeForTest(conformance.runtime).commands.delete, { collection: "posts", id: args.first ?? null });
      return yield* ctx.nested(inspectPayloadRuntimeForTest(conformance.runtime).commands.delete, { collection: "posts", id: args.second ?? null });
    }) });
    const createAndDelete = defineCmsCommand({ name: "create-delete-net-zero", mode: "write", run: Effect.fn("PreferenceTest.createDeleteNetZero")(function* (ctx) {
      const created = yield* ctx.nested(inspectPayloadRuntimeForTest(conformance.runtime).commands.create, { collection: "posts", data: { title: "delete-net-zero", publishedAt: "2026-01-01" } });
      if (!isJsonObject(created) || typeof created.id !== "string") return yield* Effect.fail(cmsError("invalidInput"));
      return yield* ctx.nested(inspectPayloadRuntimeForTest(conformance.runtime).commands.delete, { collection: "posts", id: created.id });
    }) });
    const composition = { ...hostInput, commands: [...Object.values(inspectPayloadRuntimeForTest(conformance.runtime).commands), pair, createAndDelete], expectedContentIdentity: payloadScalarContentIdentity,
      materialization: { ...hostInput.materialization, afterTransactionStep: async (event: { step: string }) => {
        if (event.step === failedStep) throw new Error(`Injected ${event.step}`);
      } } };
    let closedNoFinalRows: readonly string[] = [];
    let cleanupEvidence: unknown;
    const host = await runEffect(makeCmsHost(composition, {
      afterDocumentClosure: evidence => Effect.sync(() => { closedNoFinalRows = evidence.noFinalRows; }),
      afterPreferenceCleanup: evidence => Effect.sync(() => { cleanupEvidence = evidence; }),
      afterPreferenceFacts: () => failFacts ? Effect.fail(cmsError("resourceFailure")) : Effect.void,
    }));
    const create = async (title: string) => {
      const value = await runEffect(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(conformance.runtime).commands.create, { collection: "posts", data: { title, publishedAt: "2026-01-01" } }));
      if (!isJsonObject(value) || typeof value.id !== "string") throw new Error("Missing Payload ID");
      return value.id;
    };
    const facts = () => persistence.drizzle.select().from(fxSystemCommitPayloadPreferenceDeletions).orderBy(asc(fxSystemCommitPayloadPreferenceDeletions.commitSeq), asc(fxSystemCommitPayloadPreferenceDeletions.changeOrdinal));
    const inventory = async () => ({ application: await input.inventory(), preferences: await input.readPreferenceIds(), facts: await facts() });
    const remove = (id: string, key = host.newRequestKey()) => runEffect(host.run(key, inspectPayloadRuntimeForTest(conformance.runtime).commands.delete, { collection: "posts", id }));
    const rowInventory = async () => ({
      rows: await persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.scopeUuid, fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
      revisions: await persistence.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    });
    const beforeNetZero = { rows: await rowInventory(), preferences: await input.readPreferenceIds(), facts: await facts() };
    const netZeroKey = host.newRequestKey();
    const netZeroExecutions = conformance.observations.executions();
    const netZero = await runEffect(host.run(netZeroKey, createAndDelete, {}));
    if (!isJsonObject(netZero) || typeof netZero.id !== "string") throw new Error("Missing net-zero Payload ID");
    expect(netZero).toMatchObject({ title: "delete-net-zero" });
    expect(closedNoFinalRows).toEqual([netZero.id]);
    expect(cleanupEvidence).toEqual([{ collectionSlug: "posts", documentId: netZero.id, key: `collection-posts-${netZero.id}`, preferenceIds: [] }]);
    expect(await runEffect(host.run(netZeroKey, createAndDelete, {}))).toEqual(netZero);
    expect(conformance.observations.executions()).toBe(netZeroExecutions + 2);
    expect({ rows: await rowInventory(), preferences: await input.readPreferenceIds(), facts: await facts() }).toEqual(beforeNetZero);
    const empty = await create("delete-empty");
    const emptyFacts = await facts();
    const emptyKey = host.newRequestKey();
    const executions = conformance.observations.executions();
    const deletedEmpty = await remove(empty, emptyKey);
    expect(deletedEmpty).toMatchObject({ id: empty, title: "delete-empty" });
    expect(await remove(empty, emptyKey)).toEqual(deletedEmpty);
    expect(conformance.observations.executions()).toBe(executions + 1);
    expect(await facts()).toEqual(emptyFacts);

    const matching = await create("delete-matching");
    await input.seed(matching, ["published-a", "published-b"]);
    const beforeFacts = (await facts()).length;
    await remove(matching);
    const written = (await facts()).slice(beforeFacts);
    expect(written.map(fact => fact.preferenceId)).toEqual(["published-a", "published-b"]);
    expect(written.map(fact => fact.changeOrdinal)).toEqual([0, 1]);
    expect(new Set(written.map(fact => fact.commitSeq)).size).toBe(1);
    const first = written[0];
    if (first === undefined) throw new Error("Missing lifecycle fact");
    const header = await persistence.drizzle.select().from(fxSystemCommits).where(and(eq(fxSystemCommits.scopeUuid, first.scopeUuid), eq(fxSystemCommits.commitSeq, first.commitSeq)));
    expect(header[0]).toMatchObject({ payloadPreferenceDeletionCount: 2, changeCount: 1, epochUuid: first.epochUuid });
    expect(Object.keys(first).toSorted()).toEqual(["artifactSha256", "changeOrdinal", "codecVersion", "commitSeq", "contentRowId", "contentTableId", "epochUuid", "preferenceId", "scopeUuid", "storageGeneration"]);
    expect(await input.readPreferenceIds()).not.toContain("published-a");

    const failures = await create("delete-publication-failures");
    await input.seed(failures, ["rollback-a", "rollback-b"]);
    const stable = await inventory();
    const schemaName = await persistence.drizzle.transaction(async tx => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try { return await runEffect(Effect.fromResult(requireAdmittedTargetInstallationSchema(tx))); }
      finally { closeInstallationAdmission(tx); }
    });
    const rowTable = new PgDialect().sqlToQuery(sql`${sql.identifier(schemaName)}.${sql.identifier(getTableName(fxAppRowRevisions))}`).sql;
    const rowFunction = new PgDialect().sqlToQuery(sql`${sql.identifier(schemaName)}.${sql.identifier("payload_preference_row_corruption")}`).sql;
    await persistence.query(`create function ${rowFunction}() returns trigger language plpgsql as $$
      begin
        if NEW."${fxAppRowRevisions.isTombstone.name}" then
          NEW."${fxAppRowRevisions.creationTime.name}" := NEW."${fxAppRowRevisions.creationTime.name}" + 1;
        end if;
        return NEW;
      end $$`);
    try {
      await persistence.query(`create trigger payload_preference_row_corruption before insert on ${rowTable}
        for each row execute function ${rowFunction}()`);
      try {
        expect(await runEffectFailure(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(conformance.runtime).commands.delete,
          { collection: "posts", id: failures }))).toMatchObject({ reason: "storedCorruption" });
        expect(await inventory()).toEqual(stable);
      } finally { await persistence.query(`drop trigger payload_preference_row_corruption on ${rowTable}`); }
    } finally { await persistence.query(`drop function ${rowFunction}()`); }
    for (const step of ["commitHeaderWritten", "commitChangeWritten", "outcomeWritten", "wakeWritten", "clockAdvanced"]) {
      failedStep = step;
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(conformance.runtime).commands.delete, { collection: "posts", id: failures }))))).toBe(true);
      failedStep = undefined;
      expect(await inventory()).toEqual(stable);
    }
    failFacts = true;
    await runEffectFailure(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(conformance.runtime).commands.delete, { collection: "posts", id: failures }));
    failFacts = false;
    expect(await inventory()).toEqual(stable);
    const nested = await create("delete-nested-fail");
    await input.seed(nested, ["nested-rollback"]);
    const beforeNested = await inventory();
    await runEffectFailure(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(conformance.runtime).commands.delete, { collection: "posts", id: nested }));
    expect(await inventory()).toEqual(beforeNested);

    const maximum = await create("delete-maximum");
    await input.seed(maximum, Array.from({ length: 256 }, (_, index) => `maximum-${index.toString().padStart(3, "0")}`));
    const beforeMaximum = (await facts()).length;
    await remove(maximum);
    expect((await facts()).length - beforeMaximum).toBe(256);
    const firstPair = await create("delete-pair-first");
    const secondPair = await create("delete-pair-second");
    await input.seed(firstPair, Array.from({ length: 128 }, (_, index) => `pair-first-${index}`));
    await input.seed(secondPair, Array.from({ length: 129 }, (_, index) => `pair-second-${index}`));
    const beforePair = await inventory();
    await runEffectFailure(host.run(host.newRequestKey(), pair, { first: firstPair, second: secondPair }));
    expect(await inventory()).toEqual(beforePair);

    if ("pool" in persistence) {
      const race = await create("delete-native-race");
      await input.seed(race, ["native-race"]);
      const raceKey = host.newRequestKey();
      const raceCalls = conformance.observations.executions();
      const results = await Promise.allSettled([remove(race, raceKey), remove(race, raceKey)]);
      expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(results[0]).toEqual(results[1]);
      expect(conformance.observations.executions()).toBe(raceCalls + 1);
      const recoveringId = await create("delete-native-recovery");
      await input.seed(recoveringId, ["native-recovery"]);
      let lost = false;
      let bound = false;
      const pids: unknown[] = [];
      const recovering = await runEffect(makeCmsHost({ ...hostInput, expectedContentIdentity: payloadScalarContentIdentity,
        commands: Object.values(inspectPayloadRuntimeForTest(conformance.runtime).commands), session: makePostgresRelationalSession(persistence, { lifecycleFault: event => {
        if (!bound) return;
        if (event.phase === "begin" && event.edge === "after") pids.push(Reflect.get(event.client, "processID"));
        if (event.phase === "commit" && event.edge === "after" && !lost) { lost = true; throw new Error("Lost delete COMMIT acknowledgement"); }
      } }) }));
      bound = true;
      const recoveryCalls = conformance.observations.executions();
      const recovered = await runEffect(recovering.run(recovering.newRequestKey(), inspectPayloadRuntimeForTest(conformance.runtime).commands.delete, { collection: "posts", id: recoveringId }));
      expect(recovered).toMatchObject({ id: recoveringId });
      expect(conformance.observations.executions()).toBe(recoveryCalls + 1);
      expect(pids.length).toBeGreaterThanOrEqual(2);
      expect(pids[1]).not.toBe(pids[0]);
      expect((await facts()).filter(fact => fact.preferenceId === "native-recovery")).toHaveLength(1);
      const interruptedId = await create("delete-unresolved");
      await input.seed(interruptedId, ["native-interrupted"]);
      const beforeInterrupt = await inventory();
      const pending = conformance.observations.pendingReads();
      const fiber = Effect.runFork(host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(conformance.runtime).commands.delete, { collection: "posts", id: interruptedId }));
      try {
        const deadline = performance.now() + 5000;
        while (conformance.observations.pendingReads() === pending && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        expect(conformance.observations.pendingReads()).toBe(pending + 1);
        await runEffect(Fiber.interrupt(fiber));
        expect(Exit.isFailure(await runEffect(Fiber.await(fiber)))).toBe(true);
      } finally { await runEffect(Fiber.interrupt(fiber)); }
      expect(await inventory()).toEqual(beforeInterrupt);
    }

    // Exercise the real retention owner against published facts and a corrupt directory.
    await create("retention-marker");
    const clocks = await persistence.drizzle.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, first.scopeUuid));
    const clock = clocks[0];
    if (clock === undefined) throw new Error("Missing scope clock");
    await persistence.drizzle.update(fxSystemScopeExecutionAuthorities).set({ oldestAvailableCommitSeq: CommitSeqSchema.make(clock.lastCommitSeq) }).where(eq(fxSystemScopeExecutionAuthorities.scopeId, clock.scopeId));
    const compactor = createRetainedCommitHistoryCompactionPort({ authority: { ...input.retentionAuthority,
      scopeClockTargets: { resolve: async locator => createLocatedRetainedHistoryFloorTargetInternal(persistence.drizzle, locator,
        createDefaultLocatedReadCommittedTransactionRunnerV1(persistence.drizzle)) } } });
    const headers = await persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, first.scopeUuid)).orderBy(asc(fxSystemCommits.commitSeq));
    for (const prior of headers) if (prior.commitSeq < first.commitSeq) await runEffect(compactRetainedCommitHistoryPageEffect(compactor, { deploymentId: hostInput.deploymentId, scopeId: hostInput.scopeId }));
    await persistence.drizzle.delete(fxSystemCommitPayloadPreferenceDeletions).where(and(eq(fxSystemCommitPayloadPreferenceDeletions.scopeUuid, first.scopeUuid),
      eq(fxSystemCommitPayloadPreferenceDeletions.commitSeq, first.commitSeq), eq(fxSystemCommitPayloadPreferenceDeletions.changeOrdinal, first.changeOrdinal)));
    const corrupt = await inventory();
    expect(await runEffectFailure(compactRetainedCommitHistoryPageEffect(compactor, { deploymentId: hostInput.deploymentId, scopeId: hostInput.scopeId }))).toMatchObject({ reason: "storedEvidenceInvalid" });
    expect(await inventory()).toEqual(corrupt);
    await persistence.drizzle.insert(fxSystemCommitPayloadPreferenceDeletions).values(first);
    for (let index = 0; index < headers.length; index++) {
      const result = await runEffect(compactRetainedCommitHistoryPageEffect(compactor, { deploymentId: hostInput.deploymentId, scopeId: hostInput.scopeId }));
      if (result.disposition === "exhausted") break;
    }
    expect(await facts()).toEqual([]);
    expect(await persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, first.scopeUuid))).toHaveLength(1);
  })))));
}
