import { expect } from "vitest";
import { Effect, Fiber, Exit, Result } from "effect";
import { randomUUID } from "node:crypto";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { appDocumentIdV1FromRowIdentity, decodeAppDocumentIdentityV1Result, decodeAppDocumentIdV1, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { makePayloadConformanceRuntime } from "../../payload-adapter/src/testing";
import { payloadManyContentIdentity } from "../../payload-adapter/src/conformanceProfile";
import { makeCmsHost, defineCmsCommand } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import { makeApplicationActivationRepository } from "../src/applicationActivation";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { createApplicationRelationReadPort } from "../src/applicationRelationRead";
import { openApplicationRelationQuerySnapshot, readApplicationRelationQueryIncomingSources } from "../src/applicationQuerySnapshot";
import { ScopeExecutionLive } from "../src/scopeExecution/ScopeExecution";
import { fxAppEdgeCurrent, fxSystemCommits } from "../src/schema";
import { fxSystemCommitPayloadPreferenceDeletions } from "../src/payloadPreferences/factsSchema";
import { barrier, heldNativeRace, withDeadline, type payloadRelationScenario } from "./payloadRelationScenario";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const object = (value: Json): JsonObject => {
  if (!isJsonObject(value)) throw new Error("Expected Payload document");
  return value;
};
const id = (value: Json): string => {
  const result = object(value).id;
  if (typeof result !== "string") throw new Error("Expected Payload ID");
  return result;
};

/** Both drivers share one populated, fresh-install consumer scenario. */
export async function payloadManyScenario(input: Parameters<typeof payloadRelationScenario>[0]) {
  const { fixture, hostInput } = input;
  const db = input.persistence.drizzle;
  let restoredSource = "";
  let restoredTargets: string[] = [];
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const conformance = yield* makePayloadConformanceRuntime("payload.content-many");
    const nested = defineCmsCommand({ name: "many-nested", mode: "write", run: Effect.fn("ManyTest.nested")(function* (ctx, args) {
      if (!isJsonObject(args) || typeof args.source !== "string") return yield* Effect.fail(cmsError("invalidInput"));
      const target = yield* ctx.nested(conformance.runtime.commands.create, { collection: "posts", data: { title: "many-nested-target", publishedAt: "2026-01-01" } });
      const updated = yield* ctx.nested(conformance.runtime.commands.update, { collection: "posts", id: args.source, data: { relatedPosts: [id(target)] } });
      expect(yield* ctx.nested(conformance.runtime.commands.findByID, { collection: "posts", id: args.source })).toEqual(updated);
      if (args.fail === true) return yield* Effect.fail(cmsError("invalidInput"));
      return updated;
    }) });
    const outputRoots = defineCmsCommand({ name: "many-output-roots", mode: "write", run: Effect.fn("ManyTest.outputRoots")(function* (ctx, args) {
      if (!isJsonObject(args) || typeof args.offset !== "number") return yield* Effect.fail(cmsError("invalidInput"));
      const created: string[] = [];
      for (let index = args.offset; index < args.offset + (Array.isArray(args.ids) ? 4 : 8); index++) {
        if (Array.isArray(args.ids)) {
          const documentId = args.ids[index];
          if (typeof documentId !== "string") return yield* Effect.fail(cmsError("invalidInput"));
          yield* ctx.nested(conformance.runtime.commands.update, { collection: "posts", id: documentId, data: { relatedPosts: args.ids } });
        } else {
          created.push(id(yield* ctx.nested(conformance.runtime.commands.create, { collection: "posts",
            data: { title: `many-output-${index}-${"x".repeat(1800)}`, publishedAt: "2026-01-01" },
          })));
        }
      }
      return created;
    }) });
    const composition = { ...hostInput, expectedContentIdentity: payloadManyContentIdentity,
      commands: [...Object.values(conformance.runtime.commands), nested, outputRoots], materialization: { ...hostInput.materialization, applicationRelations: fixture.relationCommit } };
    yield* Effect.promise(async () => {
      const host = await runEffect(makeCmsHost(composition));
      const write = (command: typeof conformance.runtime.commands.create, args: Json) => runEffect(host.run(host.newRequestKey(), command, args));
      const create = (title: string, data: JsonObject = {}) => write(conformance.runtime.commands.create, { collection: "posts", data: { title, publishedAt: "2026-01-01", ...data } });
      const update = (source: string, data: JsonObject) => write(conformance.runtime.commands.update, { collection: "posts", id: source, data });
      const read = (source: string, depth = 0) => runEffect(host.read(conformance.runtime.commands.findByID, { collection: "posts", id: source, depth }));
      const first = await create("many-target-a");
      expect(first).toMatchObject({ relatedPosts: [], relatedPost: null });
      const a = id(first); const b = id(await create("many-target-b"));
      const source = id(await create("many-source", { relatedPosts: [a, b], relatedPost: a }));
      expect(await read(source)).toMatchObject({ relatedPosts: [a, b], relatedPost: a });
      expect(object(await read(source, 1)).relatedPosts).toEqual([expect.objectContaining({ id: a, relatedPosts: [] }), expect.objectContaining({ id: b })]);
      expect(object(await read(source, 1)).relatedPost).toMatchObject({ id: a });
      await update(source, { score: 3 });
      expect(await read(source)).toMatchObject({ relatedPosts: [a, b] });
      const beforeReorder = (await db.select().from(fxSystemCommits)).length;
      await update(source, { relatedPosts: [b, a] });
      expect((await db.select().from(fxSystemCommits)).length).toBe(beforeReorder + 1);
      expect(object(await read(source, 1)).relatedPosts).toEqual([expect.objectContaining({ id: b }), expect.objectContaining({ id: a })]);
      expect(await db.select().from(fxAppEdgeCurrent)).toHaveLength(3);
      const active = await runEffect(fixture.relationActivation.readActive());
      const declared = fixture.manifest.schema.relations[1]?.declaration.source;
      if (declared === undefined) throw new Error("Expected many declaration");
      const incoming = await runEffect(Effect.scoped(Effect.gen(function* () {
        const opened = yield* openApplicationRelationQuerySnapshot(active.selection, { source: { table: declared.table, path: declared.path } }, {
          deploymentId: fixture.deploymentId, controlDb: fixture.control.drizzle, authority: fixture.authorityPorts,
          relations: createApplicationRelationReadPort(fixture.control.drizzle, fixture.pointCommitAuthority, fixture.relationCommit, fixture.fold),
        });
        return yield* readApplicationRelationQueryIncomingSources(opened.snapshot, decodeAppDocumentIdV1(a), 16);
      })).pipe(Effect.provide(ScopeExecutionLive)));
      expect(incoming.sources.map(row => row.sourceDocumentId)).toEqual([source]);
      const beforeInvalid = await input.inventory();
      const calls = conformance.observations.executions();
      for (const invalid of [null, [a, a], [1], [{ id: a }], ["bad-id"], Array.from({ length: 33 }, () => a)]) {
        await runEffectFailure(host.run(host.newRequestKey(), conformance.runtime.commands.update, { collection: "posts", id: source, data: { relatedPosts: invalid } }));
      }
      expect(conformance.observations.executions()).toBe(calls);
      const audit = fixture.relation.binding.tables.find(table => table.logicalName === "audit");
      if (audit === undefined) throw new Error("Missing audit table");
      const wrongTable = appDocumentIdV1FromRowIdentity({ tableId: audit.tableId, rowId: decodeAppRowIdHexV1("1".repeat(32)) });
      await runEffectFailure(host.run(host.newRequestKey(), conformance.runtime.commands.update, { collection: "posts", id: source, data: { relatedPosts: [wrongTable] } }));
      expect(conformance.observations.executions()).toBe(calls);
      expect(await input.inventory()).toEqual(beforeInvalid);
      const identity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(a));
      const missing = appDocumentIdV1FromRowIdentity({ tableId: identity.tableId, rowId: decodeAppRowIdHexV1(randomUUID().replaceAll("-", "")) });
      expect(await runEffectFailure(host.run(host.newRequestKey(), conformance.runtime.commands.update, { collection: "posts", id: source, data: { relatedPosts: [missing] } }))).toMatchObject({ reason: "relationTargetMissing" });
      expect(await runEffectFailure(host.run(host.newRequestKey(), conformance.runtime.commands.delete, { collection: "posts", id: a }))).toMatchObject({ reason: "relationDeleteRestricted" });
      expect(await input.inventory()).toEqual(beforeInvalid);
      await runEffectFailure(host.run(host.newRequestKey(), nested, { source, fail: true }));
      expect(await input.inventory()).toEqual(beforeInvalid);
      const key = host.newRequestKey();
      const args = { collection: "posts", id: source, data: { relatedPosts: [a] } };
      const saved = await runEffect(host.run(key, conformance.runtime.commands.update, args));
      const replayCalls = conformance.observations.executions();
      expect(await runEffect(host.run(key, conformance.runtime.commands.update, args))).toEqual(saved);
      expect(conformance.observations.executions()).toBe(replayCalls);
      const nestedResult = object(await write(nested, { source }));
      expect(nestedResult.relatedPosts).toHaveLength(1);
      await update(source, { relatedPosts: [], relatedPost: null });
      expect(await read(source)).toMatchObject({ relatedPosts: [], relatedPost: null });
      expect(await db.select().from(fxAppEdgeCurrent)).toHaveLength(0);
      await update(source, { relatedPosts: [source, b] });
      expect(object(await read(source, 1)).relatedPosts).toEqual([expect.objectContaining({ id: source, relatedPosts: [source, b] }), expect.objectContaining({ id: b })]);
      await update(source, { relatedPosts: [b, a], relatedPost: a });
      const second = id(await create("many-second-source", { relatedPosts: [a, b], relatedPost: b }));
      const page = object(await runEffect(host.read(conformance.runtime.commands.find, { collection: "posts", depth: 1, limit: 32 })));
      expect(page.docs).toEqual(expect.arrayContaining([expect.objectContaining({ id: second, relatedPosts: [expect.objectContaining({ id: a }), expect.objectContaining({ id: b })] })]));
      await input.seed(second, ["many-preference"]);
      const beforeDelete = (await db.select().from(fxSystemCommits)).length;
      await write(conformance.runtime.commands.delete, { collection: "posts", id: second });
      expect((await db.select().from(fxSystemCommits)).length).toBe(beforeDelete + 1);
      expect(await db.select().from(fxSystemCommitPayloadPreferenceDeletions)).toHaveLength(1);
      expect(await db.select().from(fxAppEdgeCurrent)).toHaveLength(3);

      if ("pool" in input.persistence) {
        const persistence = input.persistence;
        for (const first of ["insert", "delete"] as const) {
          const target = id(await create(`many-race-${first}`));
          await update(source, { relatedPosts: [], relatedPost: null });
          const entered = barrier<void>(); const release = barrier<void>();
          const held = await runEffect(makeCmsHost(composition, { afterAdmission: () => Effect.promise(async () => { entered.resolve(); await release.promise; }) }));
          const inserting = (first === "insert" ? held : host).run(host.newRequestKey(), conformance.runtime.commands.update, { collection: "posts", id: source, data: { relatedPosts: [target] } });
          const deleting = (first === "delete" ? held : host).run(host.newRequestKey(), conformance.runtime.commands.delete, { collection: "posts", id: target });
          const results = await heldNativeRace(persistence, first === "insert" ? inserting : deleting, first === "insert" ? deleting : inserting, entered.promise, () => release.resolve());
          expect(results[0]).toMatchObject({ status: "fulfilled", value: { _tag: "Success" } });
          expect(results[1]).toMatchObject({ status: "fulfilled", value: { _tag: "Failure", failure: { reason: first === "insert" ? "relationDeleteRestricted" : "relationTargetMissing" } } });
          if (first === "insert") { await update(source, { relatedPosts: [] }); await write(conformance.runtime.commands.delete, { collection: "posts", id: target }); }
        }
        await update(source, { relatedPosts: [a, b] });
        for (const first of ["reader", "writer"] as const) {
          const entered = barrier<void>(); const release = barrier<void>();
          const held = await runEffect(makeCmsHost(composition, { afterAdmission: () => Effect.promise(async () => { entered.resolve(); await release.promise; }) }));
          const reading = (first === "reader" ? held : host).read(conformance.runtime.commands.findByID, { collection: "posts", id: source, depth: 1 });
          const writing = (first === "writer" ? held : host).run(host.newRequestKey(), conformance.runtime.commands.update, { collection: "posts", id: source, data: { relatedPosts: [b, a] } });
          const results = await heldNativeRace(persistence, first === "reader" ? reading : writing, first === "reader" ? writing : reading, entered.promise, () => release.resolve());
          expect(results).toEqual([expect.objectContaining({ status: "fulfilled", value: expect.objectContaining({ _tag: "Success" }) }), expect.objectContaining({ status: "fulfilled", value: expect.objectContaining({ _tag: "Success" }) })]);
          expect(results[first === "reader" ? 0 : 1]).toMatchObject({ value: { success: { relatedPosts: (first === "reader" ? [a, b] : [b, a]).map(id => expect.objectContaining({ id })) } } });
          await update(source, { relatedPosts: [a, b] });
        }
        let lost = false;
        let bound = false;
        const recovering = await runEffect(makeCmsHost({ ...composition, session: makePostgresRelationalSession(persistence, { lifecycleFault: event => {
          if (!bound) return;
          if (event.phase === "commit" && event.edge === "after" && !lost) { lost = true; throw new Error("Lost many COMMIT acknowledgement"); }
        } }) }));
        bound = true;
        const recoverKey = recovering.newRequestKey();
        const recoverArgs = { collection: "posts", id: source, data: { relatedPosts: [b, a] } };
        const recovered = await runEffect(recovering.run(recoverKey, conformance.runtime.commands.update, recoverArgs));
        expect(lost).toBe(true);
        expect(await runEffect(host.run(recoverKey, conformance.runtime.commands.update, recoverArgs))).toEqual(recovered);
      }
      const entered = barrier<void>();
      const blocked = await runEffect(makeCmsHost(composition, { documentReads: { beforeRead: selection => selection === "batch" ?
        Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.never)) : Effect.void } }));
      const reading = Effect.runFork(blocked.read(conformance.runtime.commands.findByID, { collection: "posts", id: source, depth: 1 }));
      try { await withDeadline(entered.promise); } finally { await runEffect(Fiber.interrupt(reading)); }
      expect(Exit.isFailure(await runEffect(Fiber.await(reading)))).toBe(true);
      await update(source, { relatedPosts: [b, a], relatedPost: a });
      // Valid indexed titles remain below the 2 KiB key limit. Amplify real supported
      // documents via 32 distinct targets per root, not an impossible large indexed field.
      const outputIds: string[] = [];
      for (let offset = 0; offset < 32; offset += 8) {
        const created = await write(outputRoots, { offset });
        if (!Array.isArray(created) || created.some(value => typeof value !== "string")) throw new Error("Expected output fixture IDs");
        for (const value of created) { if (typeof value !== "string") throw new Error("Expected ID"); outputIds.push(value); }
      }
      for (let offset = 0; offset < 32; offset += 4) await write(outputRoots, { offset, ids: outputIds });
      // Keep the aggregate target set exactly 32 so this refusal reaches output accounting.
      await update(source, { relatedPosts: [], relatedPost: null });
      const beforeOutputRefusal = await input.inventory();
      expect(await runEffectFailure(host.read(conformance.runtime.commands.find, { collection: "posts", depth: 1, limit: 32 }))).toMatchObject({ reason: "limitExceeded" });
      expect(await input.inventory()).toEqual(beforeOutputRefusal);
      await update(source, { relatedPosts: [b, a], relatedPost: a });
      restoredSource = source; restoredTargets = [b, a];
    });
  })));
  await input.reopen?.();
  // Drop the old Payload instance and reconstruct activation and CMS admission from retained evidence.
  const coldApplication = makeApplicationActivationRepository({ deploymentId: fixture.deploymentId, readiness: fixture.legacyReadiness,
    relationReadiness: fixture.fold, authority: fixture.authorityPorts });
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const conformance = yield* makePayloadConformanceRuntime("payload.content-many");
    const host = yield* conformance.runtime.bind({ ...hostInput, application: coldApplication,
      materialization: { ...hostInput.materialization, applicationRelations: fixture.relationCommit } });
    expect(yield* host.read(conformance.runtime.commands.findByID, { collection: "posts", id: restoredSource })).toMatchObject({ relatedPosts: restoredTargets });
    expect(object(yield* host.read(conformance.runtime.commands.findByID, { collection: "posts", id: restoredSource, depth: 1 })).relatedPosts).toEqual(restoredTargets.map(id => expect.objectContaining({ id })));
  })));
}
