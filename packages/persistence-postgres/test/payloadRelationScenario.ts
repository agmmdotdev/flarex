import { makeApplicationActivationRepository } from "../src/applicationActivation";
import { ScopeIdSchema, ScopeEpochSchema, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { insertInitialScopeClockInTransactionResult } from "../src/scopeClockInitialization";
import { validateApplicationWriteOwnershipForCommit } from "../src/applicationWriteOwnership/Commit";
import { fxAppRowCurrent, fxAppRowRevisions } from "../src/schema";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { decodeAppDocumentIdentityV1Result, decodeAppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { canonicalizeAppUniqueConstraintSetV1 } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import { createApplicationRelationReadPort } from "../src/applicationRelationRead";
import { openApplicationRelationQuerySnapshot, readApplicationRelationQueryIncomingSources } from "../src/applicationQuerySnapshot";
import { ScopeExecutionLive } from "../src/scopeExecution/ScopeExecution";
import { readApplicationWriteOwnershipInTransaction } from "../src/applicationWriteOwnership/Repository";
import { ApplicationWriteOwnershipHistoryBudget } from "../src/applicationWriteOwnership/Policy";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { fxControlSchemaVersionUniqueConstraintSets, fxControlSchemaVersionUniqueConstraintBindings, fxSystemScopeClocks } from "../src/schema";
import { expect } from "vitest";
import { Effect, Exit, Fiber, Result } from "effect";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { makePayloadConformanceRuntime } from "../../payload-adapter/src/testing";
import { payloadRelationContentIdentity } from "../../payload-adapter/src/conformanceProfile";
import { makeCmsHost, defineCmsCommand, type CmsHostInput } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import { dataBindingActivationRequest, makeDataBindingHost } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { fxAppEdgeCurrent, fxAppEdgeAdjacencyVersions, fxSystemCommitRelationAdjacencyChanges, fxSystemCommits } from "../src/schema";
import { fxSystemCommitPayloadPreferenceDeletions } from "../src/payloadPreferences/factsSchema";
import { preparePayloadRelationSuccessor, preparePayloadRelationRevision } from "./payloadRelationFixture";
import { type relationReadinessFixture } from "./applicationRelationReadinessFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import type { PayloadContentProfiles } from "../src/payloadPreferences/binding";

export async function payloadRelationScenario(input: {
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence;
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>;
  bindings: Effect.Success<ReturnType<typeof makeDataBindingHost>>;
  payloadProfiles: PayloadContentProfiles;
  hostInput: Omit<CmsHostInput<unknown>, "commands">;
  seed: (id: string, preferences: readonly string[]) => Promise<void>;
  inventory: () => Promise<unknown>;
  reopen?: () => Promise<void>;
}) {
  const { fixture, bindings, hostInput, payloadProfiles } = input;
  const db = fixture.persistence.drizzle;
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const scalar = yield* makePayloadConformanceRuntime();
    const relation = yield* makePayloadConformanceRuntime("payload.content-relations");
    yield* Effect.promise(async () => {
      const oldHost = await runEffect(scalar.runtime.bind(hostInput));
      const createOld = (title: string) => runEffect(oldHost.run(oldHost.newRequestKey(), scalar.runtime.commands.create, { collection: "posts", data: { title, publishedAt: "2026-01-01" } }));
      const target = documentId(await createOld("relation-target"));
      const source = documentId(await createOld("relation-source"));
      const old = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
      const active = await runEffect(fixture.relationActivation.readActive());
      const managedTableId = Result.getOrThrow(decodeAppDocumentIdentityV1Result(source)).tableId;
      const denyOrdinary = async () => {
        const result = await db.transaction(tx => runEffect(validateApplicationWriteOwnershipForCommit(tx, {
          scopeId: fixture.authority.scopeId, generation: "application_v1", authenticatedAttemptedTables: [managedTableId], materialTables: [],
        }, hostInput.materialization.uniqueConstraints).pipe(Effect.result)));
        expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "writeDenied" } });
      };
      await denyOrdinary();
      const next = await preparePayloadRelationSuccessor(fixture);
      await denyOrdinary();
      const activated = await runEffect(fixture.relationActivation.activate({ revisionId: next.input.revisionId, expectedActiveHead: active.expectedActiveHead }));
      expect(activated.status).toBe("activated");
      await denyOrdinary();
      await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
      expect((await runEffect(fixture.relationActivation.readActive())).expectedActiveHead).toEqual(activated.expectedActiveHead);

      const calls = scalar.observations.executions();
      await runEffectFailure(oldHost.read(scalar.runtime.commands.findByID, { collection: "posts", id: source }));
      expect(scalar.observations.executions()).toBe(calls);
      const reference = await runEffect(bindings.readApplicationReference());
      expect(reference.readiness).toMatchObject({ kind: "policy", relationCount: 1 });
      const policy = next.relation.binding;
      if (policy.version !== 3) throw new Error("Expected relation write policy");
      const candidate = await runEffect(bindings.prepare({ ...old.frame, application: reference,
        payloadContent: { ...payloadRelationContentIdentity, application: reference,
          tables: policy.writePolicies.filter(policy => policy.owner === "payload").map(policy => ({ tableId: policy.tableId.toString(), writePolicySha256: policy.writePolicySha256 })) } }));
      await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "relation-rebind", candidate.sha256, old.head)));
      await runEffectFailure(bindings.prepare(old.frame));
      let failureStep: string | undefined;
      const pair = defineCmsCommand({ name: "relation-nested", mode: "write", run: Effect.fn("RelationTest.nested")(function* (ctx, args) {
        if (!isJsonObject(args)) return yield* Effect.fail(cmsError("invalidInput"));
        if (args.kind === "create") {
          const child = yield* ctx.nested(relation.runtime.commands.create, { collection: "posts", data: { title: "relation-nested-target", publishedAt: "2026-01-01" } });
          if (!isJsonObject(child)) return yield* Effect.fail(cmsError("invalidInput"));
          return yield* ctx.nested(relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost: child.id ?? null } });
        }
        yield* ctx.nested(relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost: null } });
        return yield* ctx.nested(relation.runtime.commands.delete, { collection: "posts", id: args.id ?? null });
      }) });
      const composition = { ...hostInput, expectedContentIdentity: payloadRelationContentIdentity,
        commands: [...Object.values(relation.runtime.commands), pair],
        materialization: { ...hostInput.materialization, applicationRelations: fixture.relationCommit,
          afterTransactionStep: async (event: { step: string }) => { if (event.step === failureStep) throw new Error(`Injected relation ${event.step}`); } } };
      const host = await runEffect(makeCmsHost(composition));
      const write = (command: typeof relation.runtime.commands.update, args: Json) => runEffect(host.run(host.newRequestKey(), command, args));
      const read = (id: string) => runEffect(host.read(relation.runtime.commands.findByID, { collection: "posts", id }));
      const inventory = async () => ({ base: await input.inventory(), edges: await db.select().from(fxAppEdgeCurrent),
        adjacency: await db.select().from(fxAppEdgeAdjacencyVersions), relationFacts: await db.select().from(fxSystemCommitRelationAdjacencyChanges),
        preferences: await db.select().from(fxSystemCommitPayloadPreferenceDeletions) });
      const scopeId = fixture.authority.scopeId;
      const restore = (reserved = 0) => db.transaction(tx => {
        const budget = new ApplicationWriteOwnershipHistoryBudget();
        Result.getOrThrow(budget.consume(reserved, 0));
        return runEffect(readApplicationWriteOwnershipInTransaction(tx, scopeId, budget, fixture.control.drizzle).pipe(Effect.result));
      });
      expect((await restore(49))._tag).toBe("Success");
      expect(await restore(50)).toMatchObject({ _tag: "Failure", failure: { reason: "historyLimit" } });
      // A valid but different closed catalog must not grant historical successor authority.
      const catalog = fixture.control.drizzle;
      const uniqueWhere = and(eq(fxControlSchemaVersionUniqueConstraintSets.deploymentId, fixture.deploymentId), eq(fxControlSchemaVersionUniqueConstraintSets.schemaVersionId, policy.schemaVersionId));
      const bindingWhere = and(eq(fxControlSchemaVersionUniqueConstraintBindings.deploymentId, fixture.deploymentId), eq(fxControlSchemaVersionUniqueConstraintBindings.schemaVersionId, policy.schemaVersionId));
      const retainedUnique = (await catalog.select().from(fxControlSchemaVersionUniqueConstraintSets).where(uniqueWhere))[0];
      const retainedBindings = await catalog.select().from(fxControlSchemaVersionUniqueConstraintBindings).where(bindingWhere);
      if (retainedUnique === undefined) throw new Error("Missing unique closure");
      const empty = await canonicalizeAppUniqueConstraintSetV1([]);
      try {
        await catalog.delete(fxControlSchemaVersionUniqueConstraintBindings).where(bindingWhere);
        await catalog.update(fxControlSchemaVersionUniqueConstraintSets).set({ definitionCount: 0, definitionSetSha256: Buffer.from(empty.sha256Hex, "hex") }).where(uniqueWhere);
        expect(await restore()).toMatchObject({ _tag: "Failure", failure: { reason: "ownershipChanged" } });
      } finally {
        await catalog.update(fxControlSchemaVersionUniqueConstraintSets).set(retainedUnique).where(uniqueWhere);
        await catalog.insert(fxControlSchemaVersionUniqueConstraintBindings).values(retainedBindings);
      }
      expect((await restore())._tag).toBe("Success");
      expect(await read(source)).toMatchObject({ relatedPost: null });
      for (const relatedPost of [{ id: target }, 42, [target]]) {
        const before = await inventory();
        const executions = relation.observations.executions();
        expect(await runEffectFailure(host.run(host.newRequestKey(), relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost } }))).toMatchObject({ reason: "relationInvalid" });
        expect(relation.observations.executions()).toBe(executions);
        expect(await inventory()).toEqual(before);
      }

      const identity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(target));
      const missing = `${identity.tableId}:${randomUUID()}`;
      const wrongTable = `${identity.tableId + 1}:${randomUUID()}`;
      const tombstone = documentId(await write(relation.runtime.commands.create, { collection: "posts", data: { title: "relation-tombstone", publishedAt: "2026-01-01" } }));
      const tombstoneIdentity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(tombstone));
      const tombstoneRowId = Buffer.from(tombstoneIdentity.rowId, "hex");
      const retainedRow = (await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.rowId, tombstoneRowId)))[0];
      if (retainedRow === undefined) throw new Error("Missing target fixture row");
      const foreignScope = ScopeIdSchema.make(`scope_${randomUUID()}`);
      const foreignEpoch = ScopeEpochSchema.make(`epoch_${randomUUID()}`);
      const foreignUuid = projectScopeIdUuidV1(foreignScope).scopeUuid;
      await db.transaction(async tx => {
        Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, { scopeId: foreignScope, initialEpoch: foreignEpoch }));
        const clock = (await tx.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, foreignUuid)))[0];
        if (clock === undefined || clock.epochUuid === null) throw new Error("Missing foreign clock");
        await tx.insert(fxAppRowRevisions).values({ ...retainedRow, scopeUuid: foreignUuid, writeEpochUuid: clock.epochUuid });
        await tx.insert(fxAppRowCurrent).values({ scopeUuid: foreignUuid, tableId: retainedRow.tableId, rowId: retainedRow.rowId, commitSeq: retainedRow.commitSeq });
        await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: retainedRow.commitSeq }).where(eq(fxSystemScopeClocks.scopeUuid, foreignUuid));
      });
      const beforeRestrictFault = await inventory();
      failureStep = "relationRestrictValidated";
      try {
        expect(await runEffect(host.run(host.newRequestKey(), relation.runtime.commands.delete, { collection: "posts", id: tombstone }).pipe(Effect.exit))).toMatchObject({ _tag: "Failure" });
      } finally { failureStep = undefined; }
      expect(await inventory()).toEqual(beforeRestrictFault);
      await write(relation.runtime.commands.delete, { collection: "posts", id: tombstone });
      const foreignBefore = await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, foreignUuid));

      for (const [relatedPost, reason] of [[missing, "relationTargetMissing"], [tombstone, "relationTargetMissing"], [wrongTable, "documentInvalid"], ["invalid", "documentInvalid"]]) {
        const before = await inventory();
        expect(await runEffectFailure(host.run(host.newRequestKey(), relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost } }))).toMatchObject({ reason });
        expect(await inventory()).toEqual(before);
      }
      const key = host.newRequestKey();
      const args = { collection: "posts", id: source, data: { relatedPost: target } };
      const result = await runEffect(host.run(key, relation.runtime.commands.update, args));
      const executed = relation.observations.executions();
      expect(await runEffect(host.run(key, relation.runtime.commands.update, args))).toEqual(result);
      expect(relation.observations.executions()).toBe(executed);
      expect(await read(source)).toMatchObject({ relatedPost: target });
      expect(await db.select().from(fxAppEdgeCurrent)).toHaveLength(1);
      expect(await db.select().from(fxSystemCommitRelationAdjacencyChanges)).toHaveLength(2);
      const current = await runEffect(fixture.relationActivation.readActive());
      const declared = next.manifest.schema.relations[0]?.declaration.source;
      if (declared === undefined) throw new Error("Missing relation declaration");
      const incoming = await runEffect(Effect.scoped(Effect.gen(function* () {
        const opened = yield* openApplicationRelationQuerySnapshot(current.selection, { source: { table: declared.table, path: declared.path } }, {
          deploymentId: fixture.deploymentId, controlDb: fixture.control.drizzle, authority: fixture.authorityPorts,
          relations: createApplicationRelationReadPort(fixture.control.drizzle, fixture.pointCommitAuthority, fixture.relationCommit, fixture.fold),
        });
        return yield* readApplicationRelationQueryIncomingSources(opened.snapshot, decodeAppDocumentIdV1(target), 16);
      })).pipe(Effect.provide(ScopeExecutionLive)));
      expect(incoming.sources.map(item => item.sourceDocumentId)).toEqual([source]);
      expect(incoming.exhausted).toBe(true);

      const beforeRestrict = await inventory();
      expect(await runEffectFailure(host.run(host.newRequestKey(), relation.runtime.commands.delete, { collection: "posts", id: target }))).toMatchObject({ reason: "relationDeleteRestricted" });
      expect(await inventory()).toEqual(beforeRestrict);
      await write(relation.runtime.commands.update, { collection: "posts", id: source, data: { score: 7 } });
      expect(await read(source)).toMatchObject({ relatedPost: target, score: 7 });
      for (const step of ["tentativeRowWritten", "relationEdgeWritten", "commitHeaderWritten", "commitChangeWritten", "outcomeWritten", "wakeWritten", "clockAdvanced"]) {
        const before = await inventory(); failureStep = step;
        expect(await runEffect(host.run(host.newRequestKey(), relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost: source } }).pipe(Effect.exit))).toMatchObject({ _tag: "Failure" });
        failureStep = undefined; expect(await inventory()).toEqual(before);
      }
      await write(relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost: source } });
      expect(await read(source)).toMatchObject({ relatedPost: source });
      await write(relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost: target } });
      await write(relation.runtime.commands.update, { collection: "posts", id: target, data: { relatedPost: source } });
      expect(await db.select().from(fxAppEdgeCurrent)).toHaveLength(2);
      await write(relation.runtime.commands.update, { collection: "posts", id: target, data: { relatedPost: null } });
      const nested = await write(pair, { kind: "create" });
      if (!isJsonObject(nested) || typeof nested.relatedPost !== "string") throw new Error("Missing nested target");
      await input.seed(nested.relatedPost, ["relation-preference"]);
      const commitsBefore = (await db.select().from(fxSystemCommits)).length;
      await write(pair, { kind: "delete", id: nested.relatedPost });
      expect((await db.select().from(fxSystemCommits)).length).toBe(commitsBefore + 1);
      expect(await db.select().from(fxSystemCommitPayloadPreferenceDeletions)).toHaveLength(1);
      expect(await db.select().from(fxAppEdgeCurrent)).toHaveLength(0);
      expect(await read(source)).toMatchObject({ relatedPost: null, score: 7 });
      await write(relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost: target } });
      if ("pool" in input.persistence) {
        const persistence = input.persistence;
        const duplicateKey = host.newRequestKey();
        const duplicateCalls = relation.observations.executions();
        const duplicateArgs = { collection: "posts", id: source, data: { score: 8 } };
        const duplicate = await Promise.allSettled([runEffect(host.run(duplicateKey, relation.runtime.commands.update, duplicateArgs)), runEffect(host.run(duplicateKey, relation.runtime.commands.update, duplicateArgs))]);
        expect(duplicate.map(item => item.status)).toEqual(["fulfilled", "fulfilled"]);
        expect(duplicate[0]).toEqual(duplicate[1]);
        expect(relation.observations.executions()).toBe(duplicateCalls + 1);
        let lost = false;
        const pids: unknown[] = [];
        const recovering = await runEffect(makeCmsHost({ ...composition, session: makePostgresRelationalSession(persistence, { lifecycleFault: event => {
          if (event.phase === "begin" && event.edge === "after") pids.push(Reflect.get(event.client, "processID"));
          if (event.phase === "commit" && event.edge === "after" && !lost) { lost = true; throw new Error("Lost relation COMMIT acknowledgement"); }
        } }) }));
        const recoveryCalls = relation.observations.executions();
        expect(await runEffect(recovering.run(recovering.newRequestKey(), relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost: source } }))).toMatchObject({ relatedPost: source });
        expect(relation.observations.executions()).toBe(recoveryCalls + 1);
        expect(pids.length).toBeGreaterThanOrEqual(2);
        expect(pids[1]).not.toBe(pids[0]);
        const interruptedId = documentId(await write(relation.runtime.commands.create, { collection: "posts", data: { title: "delete-unresolved", publishedAt: "2026-01-01", relatedPost: target } }));
        await input.seed(interruptedId, ["relation-interrupted"]);
        const beforeInterrupt = await inventory();
        const pending = relation.observations.pendingReads();
        const fiber = Effect.runFork(host.run(host.newRequestKey(), relation.runtime.commands.delete, { collection: "posts", id: interruptedId }));
        try {
          const deadline = performance.now() + 5000;
          while (relation.observations.pendingReads() === pending && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
          expect(relation.observations.pendingReads()).toBe(pending + 1);
          await runEffect(Fiber.interrupt(fiber));
          expect(Exit.isFailure(await runEffect(Fiber.await(fiber)))).toBe(true);
        } finally { await runEffect(Fiber.interrupt(fiber)); }
        expect(await inventory()).toEqual(beforeInterrupt);
        await write(relation.runtime.commands.update, { collection: "posts", id: interruptedId, data: { title: "interrupted-restored", relatedPost: null } });
        await write(relation.runtime.commands.delete, { collection: "posts", id: interruptedId });
        for (const first of ["insert", "delete"] as const) {
          const raceTarget = documentId(await write(relation.runtime.commands.create, { collection: "posts", data: { title: `race-${first}`, publishedAt: "2026-01-01" } }));
          const entered = barrier<number>();
          const release = barrier<void>();
          const holder = await runEffect(makeCmsHost(composition, { afterAdmission: Effect.fn("RelationTest.holdClock")(function* (tx) {
            const rows = yield* Effect.promise(() => tx.select({ pid: sql<number>`pg_backend_pid()` }).from(fxSystemScopeClocks).limit(1));
            if (rows[0] === undefined) throw new Error("Missing backend PID");
            entered.resolve(rows[0].pid);
            yield* Effect.promise(() => release.promise);
          }) }));
          const firstCommand = first === "insert" ? relation.runtime.commands.update : relation.runtime.commands.delete;
          const firstArgs = first === "insert" ? { collection: "posts", id: source, data: { relatedPost: raceTarget } } : { collection: "posts", id: raceTarget };
          const firstRun = runEffect(holder.run(holder.newRequestKey(), firstCommand, firstArgs).pipe(Effect.result));
          const firstObserved = Promise.allSettled([firstRun]);
          let secondObserved: typeof firstObserved | undefined;
          let results: Array<Awaited<typeof firstObserved>[number]> = [];
          try {
            const pid = await withDeadline(Promise.race([entered.promise, firstObserved.then(() => { throw new Error("Holder exited before admission"); })]));
            const secondRun = runEffect(host.run(host.newRequestKey(), first === "insert" ? relation.runtime.commands.delete : relation.runtime.commands.update,
              first === "insert" ? { collection: "posts", id: raceTarget } : { collection: "posts", id: source, data: { relatedPost: raceTarget } }).pipe(Effect.result));
            secondObserved = Promise.allSettled([secondRun]);
            const deadline = performance.now() + 5000;
            let waiting = false;
            while (!waiting && performance.now() < deadline) {
              const rows = await persistence.pool.query<{ waiting: boolean }>("select exists(select 1 from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))) as waiting", [pid]);
              waiting = rows.rows[0]?.waiting === true;
              if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
            }
            expect(waiting).toBe(true);
          } finally {
            release.resolve();
            results = [...await firstObserved, ...(secondObserved === undefined ? [] : await secondObserved)];
          }
          expect(results[0]).toMatchObject({ status: "fulfilled", value: { _tag: "Success" } });
          expect(results[1]).toMatchObject({ status: "fulfilled", value: { _tag: "Failure", failure: { reason: first === "insert" ? "relationDeleteRestricted" : "relationTargetMissing" } } });
          if (first === "insert") {
            await write(relation.runtime.commands.update, { collection: "posts", id: source, data: { relatedPost: null } });
            await write(relation.runtime.commands.delete, { collection: "posts", id: raceTarget });
          }
        }
        const preferenceTarget = hostInput.payloadPreferenceTarget;
        if (preferenceTarget === undefined) throw new Error("Missing preference target");
        let revisionOrdinal = 62;
        let relationFixture = next;
        for (const change of ["activation", "binding"] as const) for (const first of ["writer", "change"] as const) {
          const beforeBinding = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
          const entered = barrier<void>();
          const release = barrier<void>();
          const holdChange = async () => { if (first === "change") { entered.resolve(); await release.promise; } };
          const heldWriter = await runEffect(makeCmsHost(composition, { afterAdmission: () => Effect.promise(async () => {
            entered.resolve(); await release.promise;
          }) }));
          let changing: Effect.Effect<unknown, unknown>;
          if (change === "activation") {
            const preparedRevision = await preparePayloadRelationRevision(relationFixture, revisionOrdinal++);
            if (first === "change") relationFixture = preparedRevision;
            const beforeActive = await runEffect(fixture.relationActivation.readActive());
            const activator = makeApplicationActivationRepository({ deploymentId: fixture.deploymentId, readiness: fixture.legacyReadiness,
              relationReadiness: fixture.fold, authority: fixture.authorityPorts, faultAfter: point => point === "headWritten" ? holdChange() : undefined });
            changing = activator.activate({ revisionId: preparedRevision.publication.revisionId, expectedActiveHead: beforeActive.expectedActiveHead });
          } else {
            const retainedCandidate = await runEffect(bindings.prepare(beforeBinding.frame));
            const rebinder = await runEffect(makeDataBindingHost({ database: db, deploymentId: fixture.deploymentId, target: preferenceTarget,
              authority: fixture.authorityPorts, application: fixture.relationActivation, payloadProfiles,
              testOnly: { afterAcceptance: () => Effect.promise(holdChange) } }));
            changing = rebinder.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, `race-binding-${first}`, retainedCandidate.sha256, beforeBinding.head));
          }
          const writer = first === "writer" ? heldWriter : host;
          const writerKey = writer.newRequestKey();
          const writerArgs = { collection: "posts", id: source, data: { score: 20 + revisionOrdinal } };
          const writing = writer.run(writerKey, relation.runtime.commands.update, writerArgs);
          const results = await heldNativeRace(persistence, first === "writer" ? writing : changing, first === "writer" ? changing : writing, entered.promise, () => release.resolve());
          expect(results[0]).toMatchObject({ status: "fulfilled", value: { _tag: "Success" } });
          if (change === "activation" && first === "writer") {
            expect(results[1]).toMatchObject({ status: "fulfilled", value: { _tag: "Failure", failure: { _tag: "ApplicationActivationError", reason: "notReady" } } });
            expect((await runEffect(bindings.withCurrent(readAdmittedDataBinding))).head).toEqual(beforeBinding.head);
            expect(await read(source)).toMatchObject({ score: writerArgs.data.score });
            const count = relation.observations.executions();
            expect(await runEffect(host.run(writerKey, relation.runtime.commands.update, writerArgs))).toMatchObject({ score: writerArgs.data.score });
            expect(relation.observations.executions()).toBe(count);
            continue;
          }
          expect(results[1]).toMatchObject({ status: "fulfilled", value: { _tag: change === "activation" ? "Failure" : "Success" } });
          if (change === "activation") {
            const count = relation.observations.executions();
            expect(await runEffectFailure(host.read(relation.runtime.commands.findByID, { collection: "posts", id: source }))).toMatchObject({ reason: "bindingChanged" });
            expect(relation.observations.executions()).toBe(count);
            const application = await runEffect(bindings.readApplicationReference());
            const rebound = await runEffect(bindings.prepare({ ...beforeBinding.frame, application, payloadContent: { ...beforeBinding.frame.payloadContent, application } }));
            await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, `race-rebind-${first}`, rebound.sha256, beforeBinding.head)));
          }
          if (first === "writer") {
            const count = relation.observations.executions();
            await runEffectFailure(host.run(writerKey, relation.runtime.commands.update, writerArgs));
            expect(relation.observations.executions()).toBe(count);
          }
        }
      }
      await write(relation.runtime.commands.delete, { collection: "posts", id: source });
      expect(await db.select().from(fxAppEdgeCurrent)).toHaveLength(0);
      await write(relation.runtime.commands.delete, { collection: "posts", id: target });
      expect(await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, foreignUuid))).toEqual(foreignBefore);
    });
  })));
}

function documentId(value: Json): string {
  if (!isJsonObject(value) || typeof value.id !== "string") throw new Error("Expected Payload document");
  return value.id;
}

export function barrier<Value>() {
  let resolve: (value: Value) => void = () => { throw new Error("Uninitialized barrier"); };
  const promise = new Promise<Value>(release => { resolve = release; });
  return { promise, resolve };
}

export async function withDeadline<Value>(promise: Promise<Value>): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Native barrier deadline")), 5000); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function heldNativeRace(persistence: PostgresFlarexPersistence, first: Effect.Effect<unknown, unknown>, second: Effect.Effect<unknown, unknown>, entered: Promise<void>, release: () => void) {
  const firstObserved = Promise.allSettled([runEffect(first.pipe(Effect.result))]);
  let secondObserved: typeof firstObserved | undefined;
  let results: Array<Awaited<typeof firstObserved>[number]> = [];
  try {
    await withDeadline(Promise.race([entered, firstObserved.then(() => { throw new Error("Native change exited before its barrier"); })]));
    secondObserved = Promise.allSettled([runEffect(second.pipe(Effect.result))]);
    const deadline = performance.now() + 5000;
    let waiting = false;
    while (!waiting && performance.now() < deadline) {
      const rows = await persistence.pool.query<{ waiting: boolean }>("select exists(select 1 from pg_stat_activity where usename = current_user and datname = current_database() and application_name = current_setting('application_name') and pid <> pg_backend_pid() and cardinality(pg_blocking_pids(pid)) > 0) as waiting");
      waiting = rows.rows[0]?.waiting === true;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    results = [...await firstObserved, ...(secondObserved === undefined ? [] : await secondObserved)];
  }
  return results;
}
