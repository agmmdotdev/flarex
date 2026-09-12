import { isNonArrayRecord } from "@flarex/utils/records";
import { preparePayloadRelationRevision } from "./payloadRelationFixture";
import { dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { and, eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { fxAppRowCurrent, fxAppRowRevisions } from "../src/schema";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import type { AppRelationEdgeQueryObservation } from "../src/appRelationEdges";
import { expect, vi } from "vitest";
import { Effect, Fiber, Exit, Tracer } from "effect";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { makePayloadConformanceRuntime } from "../../payload-adapter/src/testing";
import { payloadJoinContentIdentity } from "../../payload-adapter/src/conformanceProfile";
import { createApplicationRelationReadPort } from "../src/applicationRelationRead";
import { makeApplicationActivationRepository } from "../src/applicationActivation";
import { prepareApplicationBindingSelection, withAcceptedApplicationBinding, readAcceptedApplicationBinding } from "../src/applicationActivation";
import { lockScopeClockForShareInTransactionEffect } from "../src/scopeClock";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { makeCmsHost, defineCmsCommand, type CmsCommandContext } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import { decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import { Result } from "effect";
import { barrier, heldNativeRace, withDeadline, type payloadRelationScenario } from "./payloadRelationScenario";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const object = (value: Json): JsonObject => { if (!isJsonObject(value)) throw new Error("Expected document"); return value; };
const id = (value: Json): string => { const valueId = object(value).id; if (typeof valueId !== "string") throw new Error("Expected ID"); return valueId; };

export async function payloadJoinScenario(input: Parameters<typeof payloadRelationScenario>[0]) {
  const { fixture } = input;
  const inventory = async () => {
    const value = await input.inventory();
    if (!isNonArrayRecord(value) || !Array.isArray(value.rows) || !Array.isArray(value.revisions)) throw new Error("Missing inventory rows");
    const rowKey = (row: unknown) => {
      if (!isNonArrayRecord(row) || !(row.rowId instanceof Uint8Array) || typeof row.tableId !== "number") throw new Error("Invalid inventory row");
      return row.tableId + "/" + Buffer.from(row.rowId).toString("hex");
    };
    const revisionKey = (row: unknown) => {
      if (!isNonArrayRecord(row) || typeof row.commitSeq !== "bigint") throw new Error("Invalid inventory revision");
      return rowKey(row) + "/" + row.commitSeq;
    };
    return { ...value, rows: value.rows.toSorted((a: unknown, b: unknown) => rowKey(a).localeCompare(rowKey(b))),
      revisions: value.revisions.toSorted((a: unknown, b: unknown) => revisionKey(a).localeCompare(revisionKey(b))) };
  };
  const relationReads = createApplicationRelationReadPort(fixture.control.drizzle, fixture.pointCommitAuthority, fixture.relationCommit, fixture.fold);
  const hostInput = { ...input.hostInput, relationReads,
    materialization: { ...input.hostInput.materialization, applicationRelations: fixture.relationCommit } };
  let retainedTarget = "";
  let retainedSource = "";
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const conformance = yield* makePayloadConformanceRuntime("payload.content-joins");
    let escaped: CmsCommandContext | undefined;
    const probe = defineCmsCommand({ name: "join-probe", mode: "read", run: Effect.fn("JoinTest.probe")(function* (ctx, args) {
      escaped = ctx;
      if (!isJsonObject(args) || typeof args.target !== "string") return yield* Effect.fail(cmsError("invalidInput"));
      const page = yield* ctx.relations.incoming(args.forged === true ? { ...ctx.context } : ctx.context, ctx.transactionId, "relatedPost", args.target, 8);
      return { docs: [...page.docs], hasNextPage: page.hasNextPage };
    }) });
    const nested = defineCmsCommand({ name: "join-nested", mode: "read", run: (ctx, args) => ctx.nested(probe, args) });
    const caught = defineCmsCommand({ name: "join-caught-refusal", mode: "write", run: Effect.fn("JoinTest.caughtRefusal")(function* (ctx, args) {
      if (!isJsonObject(args) || typeof args.target !== "string") return yield* Effect.fail(cmsError("invalidInput"));
      yield* ctx.relations.incoming(ctx.context, ctx.transactionId, "relatedPost", args.target, 8).pipe(Effect.result);
      return yield* ctx.nested(conformance.runtime.commands.create, { collection: "posts", data: { title: "must-not-publish", publishedAt: "2026-01-01" } });
    }) });
    const composition = { ...hostInput, expectedContentIdentity: payloadJoinContentIdentity, commands: [...Object.values(conformance.runtime.commands), probe, nested, caught] };
    const observed: AppRelationEdgeQueryObservation[] = [];
    const host = yield* makeCmsHost(composition, { observeIncomingQuery: query => { observed.push(query); } });
    yield* Effect.promise(async () => {
      const write = (command: typeof conformance.runtime.commands.create, args: Json) => runEffect(host.run(host.newRequestKey(), command, args));
      const create = (title: string, data: JsonObject = {}) => write(conformance.runtime.commands.create, { collection: "posts", data: { title, publishedAt: "2026-01-01", ...data } });
      const update = (target: string, data: JsonObject) => write(conformance.runtime.commands.update, { collection: "posts", id: target, data });
      const read = async (target: string, depth = 0, joins?: Json) => {
        const spans: string[] = [];
        const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
        const result = await runEffect(host.read(conformance.runtime.commands.findByID,
          { collection: "posts", id: target, depth, ...(joins === undefined ? {} : { joins }) })
          .pipe(Effect.provideService(Tracer.Tracer, tracer)));
        expect(spans.filter(name => name === "ApplicationRelationReadinessFold.validatePreparedInTransaction")).toHaveLength(1);
        return result;
      };
      const target = id(await create("join-target"));
      const other = id(await create("join-other"));
      const prepared = await runEffect(prepareApplicationBindingSelection(fixture.relationActivation));
      const escapedNative = await input.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(tx, fixture.authority.scopeId);
        return yield* withAcceptedApplicationBinding(prepared, tx, clock, binding => Effect.gen(function* () {
          const basis = yield* Effect.fromResult(readAcceptedApplicationBinding(binding, tx, clock));
          const relation = basis.manifest.schema.relations[0];
          if (relation === undefined) throw new Error("Missing native join fixture");
          const deploymentId = TransactionGrantDeploymentIdV1Schema.make(fixture.deploymentId);
          const capability = yield* relationReads.prepareAcceptedBySource({ deploymentId, binding, tx, clock,
            relation: { source: relation.declaration.source } });
          const query = { deploymentId, scopeId: basis.authority.scopeId, schemaVersionId: basis.schemaVersionId };
          expect(Result.isSuccess(relationReads.resolve(capability, query))).toBe(true);
          yield* relationReads.validateInTransaction(capability, query, tx, clock);
          // SAFETY: deliberately foreign transaction identity must not borrow this admission.
          expect(yield* Effect.flip(relationReads.validateInTransaction(capability, query, { ...tx } as typeof tx, clock)))
            .toMatchObject({ reason: "invalidComposition" });
          return { capability, query };
        }));
      })));
      expect(Result.isFailure(relationReads.resolve(escapedNative.capability, escapedNative.query))).toBe(true);
      expect(await read(target)).toMatchObject({ referencedBy: { docs: [], hasNextPage: false }, referencedByMany: { docs: [], hasNextPage: false } });
      const sources: string[] = [];
      for (let index = 0; index < 9; index++) {
        const created = object(await create(`join-source-${index}`, { relatedPost: target, relatedPosts: [target, other] }));
        expect(created.referencedBy).toBeUndefined();
        sources.push(id(created));
      }
      const ordered = sources.toSorted((a, b) => {
        const left = Result.getOrThrow(decodeAppDocumentIdentityV1Result(a)).rowId;
        const right = Result.getOrThrow(decodeAppDocumentIdentityV1Result(b)).rowId;
        return left < right ? -1 : left > right ? 1 : 0;
      });
      const beforeReads = await inventory();
      observed.length = 0;
      const page = object(await read(target));
      expect(observed).toHaveLength(2);
      for (const query of observed) {
        expect(query.name).toBe("readIncomingPage");
        expect(query.sql).toContain("fx_app_edge_current");
        expect(query.sql).toContain("order by");
        expect(query.params.at(-1)).toBe(9);
      }
      expect(page.referencedBy).toEqual({ docs: ordered.slice(0, 8), hasNextPage: true });
      expect(page.referencedByMany).toEqual(page.referencedBy);
      expect(object(await read(target, 0, { referencedBy: { limit: 16 }, referencedByMany: false })).referencedBy).toEqual({ docs: ordered, hasNextPage: false });
      expect(object(await read(target, 0, false)).referencedBy).toBeUndefined();
      const populated = object(object(await read(target, 1)).referencedBy);
      expect(populated.docs).toEqual(ordered.slice(0, 8).map(id => expect.objectContaining({ id, relatedPost: target, relatedPosts: [target, other] })));
      if (!Array.isArray(populated.docs)) throw new Error("Missing docs");
      for (const doc of populated.docs) expect(object(doc).referencedByMany).toBeUndefined();
      expect(populated.totalDocs).toBeUndefined();
      const multi = object(await runEffect(host.read(conformance.runtime.commands.find, { collection: "posts", depth: 1, limit: 16 })));
      expect(multi.docs).toEqual(expect.arrayContaining([expect.objectContaining({ id: target }), expect.objectContaining({ id: other })]));
      expect(await inventory()).toEqual(beforeReads);
      const executions = conformance.observations.executions();
      for (const joins of [{ unknown: {} }, { referencedBy: { limit: null } }, { referencedBy: { limit: 0 } }, { referencedBy: { limit: 17 } }, { referencedBy: { page: 2 } },
        { referencedBy: { count: true } }, { referencedBy: { sort: "id" } }, { referencedBy: { where: {} } }, null]) {
        expect(await runEffectFailure(host.read(conformance.runtime.commands.findByID, { collection: "posts", id: target, joins }))).toMatchObject({ reason: "unsupportedProfile" });
      }
      await runEffectFailure(host.run(host.newRequestKey(), conformance.runtime.commands.update, { collection: "posts", id: target, data: { referencedBy: [] } }));
      expect(conformance.observations.executions()).toBe(executions);
      await runEffectFailure(host.read(probe, { target, forged: true }));
      const audit = fixture.relation.binding.tables.find(table => table.logicalName === "audit");
      if (audit === undefined) throw new Error("Missing audit table");
      const targetIdentity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(target));
      const wrongTable = appDocumentIdV1FromRowIdentity({ tableId: audit.tableId, rowId: targetIdentity.rowId });
      await runEffectFailure(host.read(probe, { target: wrongTable }));
      const { relationReads: _omitted, ...withoutReadAuthority } = composition;
      const missingAuthority = await runEffect(makeCmsHost(withoutReadAuthority));
      expect(await runEffectFailure(missingAuthority.read(probe, { target }))).toMatchObject({ reason: "invalidAuthority" });
      await runEffectFailure(host.read(nested, { target }));
      await runEffectFailure(host.run(host.newRequestKey(), probe, { target }));
      expect(await runEffectFailure(host.run(host.newRequestKey(), caught, { target }))).toMatchObject({ reason: "rollbackOnly" });
      await runEffect(host.read(probe, { target }));
      const retained = escaped;
      if (retained === undefined) throw new Error("Missing captured context");
      await runEffectFailure(retained.relations.incoming(retained.context, retained.transactionId, "relatedPost", target, 8));
      expect(await inventory()).toEqual(beforeReads);
      const source = sources[0];
      if (source === undefined) throw new Error("Missing source");
      const sourceRow = Result.getOrThrow(decodeAppDocumentIdentityV1Result(ordered[0] ?? source));
      await expect(input.persistence.drizzle.delete(fxAppRowCurrent).where(eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(sourceRow.rowId))))
        .rejects.toMatchObject({ cause: { message: expect.stringMatching(/fx_app_(unique_key|index_entry_rev)_row_identity_fk/) } });
      expect(await inventory()).toEqual(beforeReads);
      const [body] = await input.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(sourceRow.rowId)));
      if (body === undefined || body.valueBytes === null) throw new Error("Missing source body");
      const bodyIdentity = and(eq(fxAppRowRevisions.scopeUuid, body.scopeUuid), eq(fxAppRowRevisions.tableId, body.tableId),
        eq(fxAppRowRevisions.rowId, body.rowId), eq(fxAppRowRevisions.commitSeq, body.commitSeq));
      // Preserve the body-corruption witness without bypassing the stable-identity constraint.
      await input.persistence.drizzle.update(fxAppRowRevisions).set({ valueBytes: sql`decode('ff', 'hex')` }).where(bodyIdentity);
      try {
        expect(await runEffectFailure(host.read(conformance.runtime.commands.findByID, { collection: "posts", id: target, depth: 1 }))).toMatchObject({ reason: "storedCorruption" });
      } finally { await input.persistence.drizzle.update(fxAppRowRevisions).set({ valueBytes: body.valueBytes }).where(bodyIdentity); }
      expect(await inventory()).toEqual(beforeReads);
      // Reject both the developer-head read and the later intrinsic-head read.
      for (const rejectAt of [1, 2]) {
        let membershipQueries = 0;
        const failingMembershipHost = await runEffect(makeCmsHost(composition, { afterAdmission: tx => Effect.sync(() => {
          const execute = tx.execute.bind(tx);
          vi.spyOn(tx, "execute").mockImplementation(statement => {
            const text = typeof statement === "string" ? statement : new PgDialect().sqlToQuery(statement.getSQL()).sql;
            if (text.includes("with requested(ordinal") && ++membershipQueries === rejectAt) return execute(sql`select 1 / 0`);
            return execute(statement);
          });
        }) }));
        expect(await runEffectFailure(failingMembershipHost.run(failingMembershipHost.newRequestKey(), conformance.runtime.commands.update,
          { collection: "posts", id: source, data: { score: 8 } }))).toMatchObject({ reason: "statementFailure" });
        expect(membershipQueries).toBe(rejectAt);
        expect(await inventory()).toEqual(beforeReads);
      }
      await update(source, { relatedPosts: [other, target] });
      expect(object(await read(target)).referencedByMany).toEqual(page.referencedByMany);
      await update(source, { relatedPost: null, relatedPosts: [] });
      expect(object(await read(target)).referencedBy).toEqual({ docs: ordered.filter(value => value !== source), hasNextPage: false });
      await update(source, { relatedPost: target, relatedPosts: [target] });
      await update(target, { relatedPost: target, relatedPosts: [target] });
      expect(object(object(await read(target, 1, { referencedBy: { limit: 16 }, referencedByMany: false })).referencedBy).docs)
        .toEqual(expect.arrayContaining([expect.objectContaining({ id: target, relatedPost: target })]));
      await update(target, { relatedPost: null, relatedPosts: [] });
      // Amplify supported documents through the real loader without widening index or request limits.
      const extraSources: string[] = [];
      for (let index = 0; index < 4; index++) extraSources.push(id(await create(`join-output-extra-${index}`, { relatedPost: target })));
      const outputSources = [...sources, ...extraSources];
      for (const [index, current] of outputSources.entries()) await update(current, {
        title: 'join-output-' + index + '-' + 'x'.repeat(1900), relatedPosts: [target, other, ...outputSources],
      });
      const beforeOutput = await inventory();
      const adapterFind = vi.spyOn(conformance.payload.db, "find");
      try {
        expect(await runEffectFailure(host.read(conformance.runtime.commands.find, { collection: "posts", depth: 1, limit: 15,
          joins: { referencedBy: { limit: 16 }, referencedByMany: { limit: 16 } } }))).toMatchObject({ reason: "limitExceeded" });
        // Root identities returned, but the loader batch failed before returning source documents to Payload.
        expect(adapterFind.mock.settledResults.map(result => result.type)).toEqual(["fulfilled", "rejected"]);
      } finally { adapterFind.mockRestore(); }
      expect(await inventory()).toEqual(beforeOutput);
      for (const [index, current] of outputSources.entries()) await update(current, { title: 'join-source-' + index, relatedPosts: [target] });
      for (const current of extraSources) await write(conformance.runtime.commands.delete, { collection: "posts", id: current });
      if ("pool" in input.persistence) {
        for (const mutation of ["retarget", "delete"] as const) for (const first of ["reader", "writer"] as const) {
          const raceTarget = id(await create(`join-race-target-${mutation}-${first}`));
          const raceSource = id(await create(`join-race-source-${mutation}-${first}`, { relatedPost: raceTarget, relatedPosts: [raceTarget] }));
          const entered = barrier<void>(); const release = barrier<void>();
          const held = await runEffect(makeCmsHost(composition, { afterAdmission: () => Effect.promise(async () => { entered.resolve(); await release.promise; }) }));
          const reading = (first === "reader" ? held : host).read(conformance.runtime.commands.findByID, { collection: "posts", id: raceTarget, depth: 1 });
          const writing = (first === "writer" ? held : host).run(host.newRequestKey(), mutation === "delete" ? conformance.runtime.commands.delete : conformance.runtime.commands.update,
            mutation === "delete" ? { collection: "posts", id: raceSource } : { collection: "posts", id: raceSource, data: { relatedPost: null, relatedPosts: [] } });
          const results = await heldNativeRace(input.persistence, first === "reader" ? reading : writing, first === "reader" ? writing : reading, entered.promise, () => release.resolve());
          expect(results).toEqual([expect.objectContaining({ status: "fulfilled", value: expect.objectContaining({ _tag: "Success" }) }), expect.objectContaining({ status: "fulfilled", value: expect.objectContaining({ _tag: "Success" }) })]);
          expect(results[first === "reader" ? 0 : 1]).toMatchObject({ status: "fulfilled", value: { _tag: "Success", success: {
            referencedBy: { docs: first === "reader" ? [expect.objectContaining({ id: raceSource })] : [], hasNextPage: false },
            referencedByMany: { docs: first === "reader" ? [expect.objectContaining({ id: raceSource })] : [], hasNextPage: false },
          } } });
        }
      }
      const entered = barrier<void>();
      const blocked = await runEffect(makeCmsHost(composition, { documentReads: { beforeRead: selection => selection === "batch" ? Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.never)) : Effect.void } }));
      const reading = Effect.runFork(blocked.read(conformance.runtime.commands.findByID, { collection: "posts", id: target, depth: 1 }));
      try { await withDeadline(entered.promise); } finally { await runEffect(Fiber.interrupt(reading)); }
      expect(Exit.isFailure(await runEffect(Fiber.await(reading)))).toBe(true);
      await update(source, { score: 7 });
      const beforeBinding = await runEffect(input.bindings.withCurrent(readAdmittedDataBinding));
      if (beforeBinding.frame.payloadContent === null) throw new Error("Missing content binding");
      const revision = await preparePayloadRelationRevision(fixture, 90);
      const beforeHead = await runEffect(fixture.relationActivation.readActive());
      await runEffect(fixture.relationActivation.activate({ revisionId: revision.publication.revisionId, expectedActiveHead: beforeHead.expectedActiveHead }));
      const callsBeforeGap = conformance.observations.executions();
      expect(await runEffectFailure(host.read(conformance.runtime.commands.findByID, { collection: "posts", id: target, depth: 1 }))).toMatchObject({ reason: "bindingChanged" });
      expect(conformance.observations.executions()).toBe(callsBeforeGap);
      const applicationReference = await runEffect(input.bindings.readApplicationReference());
      const candidate = await runEffect(input.bindings.prepare({ ...beforeBinding.frame, application: applicationReference,
        payloadContent: { ...beforeBinding.frame.payloadContent, application: applicationReference } }));
      const reference = applicationReference;
      await runEffect(input.bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "join-rebind", candidate.sha256, beforeBinding.head)));
      retainedTarget = target; retainedSource = source;
    });
  })));
  await input.reopen?.();
  const application = makeApplicationActivationRepository({ deploymentId: fixture.deploymentId, readiness: fixture.legacyReadiness, relationReadiness: fixture.fold, authority: fixture.authorityPorts });
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const conformance = yield* makePayloadConformanceRuntime("payload.content-joins");
    const host = yield* conformance.runtime.bind({ ...hostInput, application });
    const result = object(yield* host.read(conformance.runtime.commands.findByID, { collection: "posts", id: retainedTarget, depth: 1, joins: { referencedBy: { limit: 16 }, referencedByMany: false } }));
    expect(object(result.referencedBy).docs).toEqual(expect.arrayContaining([expect.objectContaining({ id: retainedSource, score: 7 })]));
  })));
}
