import { expect } from "vitest";
import { Effect, Exit, Fiber, Result } from "effect";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { appRowIdHexV1ToBytes, decodeAppDocumentIdentityV1Result, appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { fxAppRowCurrent, fxAppRowRevisions } from "../src/schema";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { makePayloadRuntime } from "../../payload-adapter/src/runtime";
import { payloadRelationContentIdentity } from "../../payload-adapter/src/profile";
import { makeCmsHost, defineCmsCommand, type CmsHostTestHooks } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import { dataBindingActivationRequest, makeDataBindingHost } from "../src/frameworkSchema/binding/host";
import { makeApplicationActivationRepository } from "../src/applicationActivation";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { preparePayloadRelationSuccessor, preparePayloadRelationRevision } from "./payloadRelationFixture";
import { barrier, withDeadline, heldNativeRace, type payloadRelationScenario } from "./payloadRelationScenario";
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

export async function payloadPopulationScenario(input: Parameters<typeof payloadRelationScenario>[0]) {
  const { fixture, bindings, hostInput, payloadProfiles } = input;
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const scalar = yield* makePayloadRuntime();
    const relation = yield* makePayloadRuntime("payload.content-relations");
    yield* Effect.promise(async () => {
      const scalarHost = await runEffect(scalar.bind(hostInput));
      const target = id(await runEffect(scalarHost.run(scalarHost.newRequestKey(), scalar.commands.create,
        { data: { title: "population-target", publishedAt: "2026-01-01" } })));
      const old = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
      const active = await runEffect(fixture.relationActivation.readActive());
      const next = await preparePayloadRelationSuccessor(fixture);
      expect((await runEffect(fixture.relationActivation.activate({ revisionId: next.input.revisionId, expectedActiveHead: active.expectedActiveHead }))).status).toBe("activated");
      const reference = await runEffect(bindings.readApplicationReference());
      const policy = next.relation.binding;
      if (policy.version !== 3) throw new Error("Expected relation policy");
      const candidate = await runEffect(bindings.prepare({ ...old.frame, application: reference,
        payloadContent: { ...payloadRelationContentIdentity, application: reference,
          tables: policy.writePolicies.filter(policy => policy.owner === "payload").map(policy => ({ tableId: policy.tableId.toString(), writePolicySha256: policy.writePolicySha256 })) } }));
      await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "population-rebind", candidate.sha256, old.head)));
      const batchProbe = defineCmsCommand({ name: "population-batch-probe", mode: "read", run: Effect.fn("PopulationTest.batch")(function* (ctx, args) {
        if (!Array.isArray(args) || args.some(value => typeof value !== "string")) return yield* Effect.fail(cmsError("invalidInput"));
        const ids: string[] = [];
        for (const value of args) if (typeof value === "string") ids.push(value);
        return [...yield* ctx.documents.getMany(ctx.context, undefined, "posts", ids)];
      }) });
      const nested = defineCmsCommand({ name: "population-nested-probe", mode: "write", run: (ctx, args) => ctx.nested(relation.commands.findByID, args) });
      const capacity = defineCmsCommand({ name: "population-capacity-probe", mode: "read", run: Effect.fn("PopulationTest.capacity")(function* (ctx, args) {
        if (!Array.isArray(args)) return yield* Effect.fail(cmsError("invalidInput"));
        const ids: string[] = [];
        for (const value of args) {
          if (typeof value !== "string") return yield* Effect.fail(cmsError("invalidInput"));
          ids.push(value);
        }
        for (let offset = 0; offset < ids.length; offset += 32) {
          const documents = yield* ctx.documents.getMany(ctx.context, undefined, "posts", ids.slice(offset, offset + 32));
          if (documents.some(document => document === null)) return yield* Effect.fail(cmsError("documentMissing"));
        }
        return null;
      }) });
      const reserve = defineCmsCommand({ name: "population-reservation-probe", mode: "read", run: ctx =>
        ctx.reserveOutput(1_048_576).pipe(Effect.as(null)) });
      const composition = { ...hostInput, expectedContentIdentity: payloadRelationContentIdentity,
        commands: [...Object.values(relation.commands), batchProbe, nested, capacity, reserve], materialization: { ...hostInput.materialization, applicationRelations: fixture.relationCommit } };
      const queries: { name: string; sql: string }[] = [];
      let failBatch = false;
      const hooks: CmsHostTestHooks = { documentReads: {
        observeQuery: observation => queries.push(observation),
        beforeRead: selection => selection === "batch" && failBatch ? Effect.fail(cmsError("statementFailure")) : Effect.void,
      } };
      const host = await runEffect(makeCmsHost(composition, hooks));
      const write = (command: typeof relation.commands.create, args: Json) => runEffect(host.run(host.newRequestKey(), command, args));
      const read = (documentId: string, depth = 1) => runEffect(host.read(relation.commands.findByID, { id: documentId, depth }));
      const create = (title: string, relatedPost?: string) => write(relation.commands.create,
        { data: { title, publishedAt: "2026-01-01", ...(relatedPost === undefined ? {} : { relatedPost }) } });
      const source = id(await create("population-source", target));
      const second = id(await create("population-second", target));
      const before = await input.inventory();
      queries.length = 0;
      expect(await runEffect(host.read(batchProbe, [second, target, source]))).toEqual([
        expect.objectContaining({ _id: second }), expect.objectContaining({ _id: target }), expect.objectContaining({ _id: source }),
      ]);
      expect(queries.filter(query => query.name === "currentDocuments")).toHaveLength(1);
      expect(queries.filter(query => query.name === "currentSizes")).toHaveLength(1);
      queries.length = 0;
      const populated = object(await read(source));
      expect(populated.relatedPost).toMatchObject({ id: target, title: "population-target", relatedPost: null });
      expect(queries.filter(query => query.name === "currentDocuments")).toHaveLength(2);
      expect(queries.filter(query => query.name === "currentSizes")).toHaveLength(2);
      expect(queries.filter(query => query.name === "currentDocuments")[1]?.sql).toContain(" in (");
      expect(object(await read(source, 0)).relatedPost).toBe(target);
      expect(object(await runEffect(host.read(relation.commands.findByID, { id: source }))).relatedPost).toBe(target);
      expect(object(await read(target)).relatedPost).toBeNull();
      queries.length = 0;
      const page = object(await runEffect(host.read(relation.commands.find, { depth: 1, limit: 32 })));
      expect(page.totalDocs).toBe(3);
      expect(page.docs).toEqual(expect.arrayContaining([expect.objectContaining({ id: source, relatedPost: expect.objectContaining({ id: target }) }),
        expect.objectContaining({ id: second, relatedPost: expect.objectContaining({ id: target }) })]));
      // General find already loaded all three roots; the loader reuses that request cache.
      expect(queries.filter(query => query.name === "currentDocuments")).toHaveLength(1);
      expect(await input.inventory()).toEqual(before);
      for (const depth of [-1, 2, 1.5, null, "1"]) {
        expect(await runEffectFailure(host.read(relation.commands.findByID, { id: source, depth }))).toMatchObject({ reason: "unsupportedProfile" });
      }
      expect(await runEffectFailure(host.run(host.newRequestKey(), relation.commands.findByID, { id: source, depth: 1 }))).toMatchObject({ reason: "unsupportedProfile" });
      expect(await runEffectFailure(host.run(host.newRequestKey(), nested, { id: source, depth: 1 }))).toMatchObject({ reason: "unsupportedProfile" });
      expect(await runEffectFailure(host.read(relation.commands.find, { depth: 1, where: { id: { in: [target] } } }))).toMatchObject({ reason: "invalidInput" });
      expect(await runEffectFailure(host.read(relation.commands.findByID, { id: "malformed", depth: 1 }))).toMatchObject({ reason: "invalidInput" });
      failBatch = true;
      expect(await runEffectFailure(host.read(relation.commands.findByID, { id: source, depth: 1 }))).toMatchObject({ reason: "statementFailure" });
      failBatch = false;
      expect(await input.inventory()).toEqual(before);
      for (const args of [{ id: source, depth: 1, select: { title: true } }, { id: source, depth: 1, populate: {} }, { id: source, depth: 1, overrideAccess: true }]) {
        expect(await runEffectFailure(host.read(relation.commands.findByID, args))).toMatchObject({ reason: "unsupportedProfile" });
      }
      const emptyPage = object(await runEffect(host.read(relation.commands.find, { depth: 1, where: { id: { equals: source }, title: { equals: "does-not-match" } } })));
      expect(emptyPage.docs).toEqual([]);
      await write(relation.commands.update, { id: target, data: { title: "population-updated", relatedPost: source } });
      expect(object(await read(source)).relatedPost).toMatchObject({ id: target, title: "population-updated", relatedPost: source });
      await write(relation.commands.update, { id: source, data: { relatedPost: source } });
      expect(object(await read(source)).relatedPost).toMatchObject({ id: source, relatedPost: source });
      await write(relation.commands.update, { id: source, data: { relatedPost: null } });
      expect(object(await read(source)).relatedPost).toBeNull();
      await write(relation.commands.update, { id: target, data: { relatedPost: null } });
      await write(relation.commands.delete, { id: source });
      expect(await runEffectFailure(host.read(relation.commands.findByID, { id: source, depth: 1 }))).toMatchObject({ reason: "documentMissing" });
      expect(await runEffect(host.read(batchProbe, [source, target]))).toEqual([null, expect.objectContaining({ _id: target })]);
      const targetIdentity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(target));
      const targetPredicate = and(eq(fxAppRowCurrent.scopeUuid, projectScopeIdUuidV1(reference.scopeId).scopeUuid),
        eq(fxAppRowCurrent.tableId, targetIdentity.tableId), eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(targetIdentity.rowId)));
      const retainedPointer = (await input.persistence.drizzle.select().from(fxAppRowCurrent).where(targetPredicate))[0];
      if (retainedPointer === undefined) throw new Error("Missing target pointer");
      // Deliberate storage-corruption fixture: bypass normal restrict only to prove fail-closed population.
      await input.persistence.drizzle.delete(fxAppRowCurrent).where(targetPredicate);
      try {
        expect(await runEffectFailure(host.read(relation.commands.findByID, { id: second, depth: 1 }))).toMatchObject({ reason: "storedCorruption", cause: { reason: "relationTargetMissing", documentId: target } });
      } finally { await input.persistence.drizzle.insert(fxAppRowCurrent).values(retainedPointer); }
      expect(await runEffectFailure(host.read(batchProbe, [target, target]))).toMatchObject({ reason: "invalidInput" });
      expect(await runEffectFailure(host.read(batchProbe, Array.from({ length: 33 }, () => target)))).toMatchObject({ reason: "limitExceeded" });
      if ("pool" in input.persistence) {
        const persistence = input.persistence;
        for (const first of ["reader", "writer"] as const) {
          const entered = barrier<void>();
          const release = barrier<void>();
          const held = await runEffect(makeCmsHost(composition, first === "reader" ? { documentReads: {
            beforeRead: selection => selection === "batch" ? Effect.promise(async () => { entered.resolve(); await release.promise; }) : Effect.void,
          } } : { afterAdmission: () => Effect.promise(async () => { entered.resolve(); await release.promise; }) }));
          const reading = (first === "reader" ? held : host).read(relation.commands.findByID, { id: second, depth: 1 });
          const writer = first === "writer" ? held : host;
          const writing = writer.run(writer.newRequestKey(), relation.commands.update, { id: target, data: { title: `population-race-${first}` } });
          const results = await heldNativeRace(persistence, first === "reader" ? reading : writing, first === "reader" ? writing : reading, entered.promise, () => release.resolve());
          expect(results).toEqual([expect.objectContaining({ status: "fulfilled", value: expect.objectContaining({ _tag: "Success" }) }),
            expect.objectContaining({ status: "fulfilled", value: expect.objectContaining({ _tag: "Success" }) })]);
          const result = results[first === "reader" ? 0 : 1];
          expect(result).toMatchObject({ status: "fulfilled", value: { success: { relatedPost: { title: first === "reader" ? "population-updated" : "population-race-writer" } } } });
        }
        const snapshot = await input.inventory();
        const entered = barrier<void>();
        const interrupted = await runEffect(makeCmsHost(composition, { documentReads: { beforeRead: selection => selection === "batch" ?
          Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.never)) : Effect.void } }));
        const fiber = Effect.runFork(interrupted.read(relation.commands.findByID, { id: second, depth: 1 }));
        try {
          await withDeadline(entered.promise);
          await runEffect(Fiber.interrupt(fiber));
          expect(Exit.isFailure(await runEffect(Fiber.await(fiber)))).toBe(true);
        } finally { await runEffect(Fiber.interrupt(fiber)); }
        expect(await input.inventory()).toEqual(snapshot);
        expect(object(await read(second)).relatedPost).toMatchObject({ id: target });

        let revision = next;
        let ordinal = 80;
        for (const change of ["activation", "binding"] as const) for (const first of ["reader", "change"] as const) {
          const beforeBinding = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
          const entered = barrier<void>();
          const release = barrier<void>();
          const held = await runEffect(makeCmsHost(composition, { documentReads: { beforeRead: selection => selection === "batch" ?
            Effect.promise(async () => { entered.resolve(); await release.promise; }) : Effect.void } }));
          const holdChange = async () => { if (first === "change") { entered.resolve(); await release.promise; } };
          let changing: Effect.Effect<unknown, unknown>;
          if (change === "activation") {
            revision = await preparePayloadRelationRevision(revision, ordinal++);
            const head = await runEffect(fixture.relationActivation.readActive());
            const activator = makeApplicationActivationRepository({ deploymentId: fixture.deploymentId, readiness: fixture.legacyReadiness,
              relationReadiness: fixture.fold, authority: fixture.authorityPorts, faultAfter: point => point === "headWritten" ? holdChange() : undefined });
            changing = activator.activate({ revisionId: revision.publication.revisionId, expectedActiveHead: head.expectedActiveHead });
          } else {
            if (hostInput.payloadPreferenceTarget === undefined) throw new Error("Missing preference target");
            const candidate = await runEffect(bindings.prepare(beforeBinding.frame));
            const rebinder = await runEffect(makeDataBindingHost({ database: persistence.drizzle, deploymentId: fixture.deploymentId,
              target: hostInput.payloadPreferenceTarget, authority: fixture.authorityPorts, application: fixture.relationActivation, payloadProfiles,
              testOnly: { afterAcceptance: () => Effect.promise(holdChange) } }));
            changing = rebinder.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, `population-binding-${first}`, candidate.sha256, beforeBinding.head));
          }
          const reading = (first === "reader" ? held : host).read(relation.commands.findByID, { id: second, depth: 1 });
          const results = await heldNativeRace(persistence, first === "reader" ? reading : changing, first === "reader" ? changing : reading, entered.promise, () => release.resolve());
          expect(results[0]).toMatchObject({ status: "fulfilled", value: { _tag: "Success" } });
          expect(results[1]).toMatchObject({ status: "fulfilled", value: { _tag: change === "activation" && first === "change" ? "Failure" : "Success" } });
          if (change === "activation") {
            if (first === "change") expect(results[1]).toMatchObject({ value: { failure: { reason: "bindingChanged" } } });
            const application = await runEffect(bindings.readApplicationReference());
            const rebound = await runEffect(bindings.prepare({ ...beforeBinding.frame, application, payloadContent: { ...beforeBinding.frame.payloadContent, application } }));
            await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, `population-rebind-${first}`, rebound.sha256, beforeBinding.head)));
          }
        }
      }
      const scalarCalls = scalar.executions();
      expect(await runEffectFailure(scalarHost.read(scalar.commands.findByID, { id: target, depth: 1 }))).toMatchObject({ reason: "invalidAuthority" });
      expect(scalar.executions()).toBe(scalarCalls);
      const resourceBaseline = await input.inventory();
      // Below Payload's 40,000-character ceiling, above the CMS UTF-8 document ceiling.
      expect(await runEffectFailure(host.run(host.newRequestKey(), relation.commands.update, { id: target, data: { title: "語".repeat(22_000) } }))).toMatchObject({ reason: "limitExceeded" });
      expect(await input.inventory()).toEqual(resourceBaseline);
      const beforeLargeRead = await input.inventory();
      expect(await runEffectFailure(host.read(reserve, {}))).toMatchObject({ reason: "limitExceeded" });
      expect(await input.inventory()).toEqual(beforeLargeRead);
      // The failure does not disable later bounded identity reads or their request cache.
      expect(object(await read(second)).relatedPost).toMatchObject({ id: target });

      // Reader-only low-level fixtures: valid canonical revision evidence isolates
      // cumulative hydration limits without booting another database or claiming a CMS mutation.
      const currentTarget = (await input.persistence.drizzle.select().from(fxAppRowCurrent).where(targetPredicate))[0];
      if (currentTarget === undefined) throw new Error("Missing current target");
      const template = (await input.persistence.drizzle.select().from(fxAppRowRevisions).where(and(
        eq(fxAppRowRevisions.scopeUuid, currentTarget.scopeUuid), eq(fxAppRowRevisions.tableId, currentTarget.tableId),
        eq(fxAppRowRevisions.rowId, currentTarget.rowId), eq(fxAppRowRevisions.commitSeq, currentTarget.commitSeq))))[0];
      if (template === undefined || !isJsonObject(template.valueJson)) throw new Error("Missing canonical template");
      const ids: string[] = [];
      const revisions: (typeof fxAppRowRevisions.$inferInsert)[] = [];
      const pointers: (typeof fxAppRowCurrent.$inferInsert)[] = [];
      const { relatedPost: _relatedPost, ...fields } = template.valueJson;
      for (let index = 0; index < 257; index += 1) {
        const rowId = decodeAppRowIdHexV1(randomUUID().replaceAll("-", ""));
        const documentId = appDocumentIdV1FromRowIdentity({ tableId: targetIdentity.tableId, rowId });
        const value = await runEffect(canonicalizeFlarexValueV1Effect({ ...fields, _id: documentId, title: `capacity-${index}` }));
        ids.push(documentId);
        revisions.push({ ...template, rowId: appRowIdHexV1ToBytes(rowId), prevCommitSeq: null,
          valueJson: value.valueJson, valueBytes: value.canonicalBytes, valueSha256: value.sha256 });
        pointers.push({ ...currentTarget, rowId: appRowIdHexV1ToBytes(rowId) });
      }
      await input.persistence.drizzle.transaction(async tx => {
        await tx.insert(fxAppRowRevisions).values(revisions);
        await tx.insert(fxAppRowCurrent).values(pointers);
      });
      queries.length = 0;
      expect(await runEffect(host.read(capacity, ids.slice(0, 256)))).toBeNull();
      expect(queries.filter(query => query.name === "currentDocuments")).toHaveLength(8);
      queries.length = 0;
      expect(await runEffectFailure(host.read(capacity, ids))).toMatchObject({ reason: "limitExceeded" });
      expect(queries.filter(query => query.name === "currentDocuments")).toHaveLength(8);
      expect(queries.filter(query => query.name === "currentSizes")).toHaveLength(8);
    });
  })));
}
