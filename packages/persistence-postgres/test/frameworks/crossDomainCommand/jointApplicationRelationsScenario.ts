import { Cause, Effect, Exit, Result } from "effect";
import { expect } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { makePayloadRuntime } from "../../../../payload-adapter/src/runtime";
import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { currencyAnnouncementWrite } from "../../../../medusa-adapter/src/modules/currency/service";
import { lendApplicationBindingRelations } from "../../../src/application/activation/bindingPreparation";
import { prepareCurrentApplicationBinding } from "../../../src/application/activation/currentBinding";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "../../../src/execution/diagnostics/operation";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { makeCmsCommandBinding } from "../../../src/frameworks/cmsTransaction/construction";
import { prepareSourceCmsDocumentMaterialization } from "../../../src/frameworks/cmsTransaction/contribution";
import { defineCommerceCommand, getCommerceCommand } from "../../../src/frameworks/commerceTransaction/commands";
import { makeLegacyCurrencyAnnouncementHost } from "../../../src/frameworks/crossDomainCommand/legacyHost";
import { ScopeExecutionLive } from "../../../src/scope/execution/ScopeExecution";
import { prepareLogicalStorageReadiness } from "../../../src/storage/catalog/logicalStorageReadiness";
import { prepareLogicalApplicationSourceAdmission } from "../../../src/storage/documents/logicalDocuments/applicationAdmission";
import { prepareLogicalDocumentSourceAdmission } from "../../../src/storage/documents/logicalDocuments/documentAdmission";
import { prepareLogicalRelationalAdmission } from "../../../src/storage/documents/logicalDocuments/relationalAdmission";
import { runEffect } from "../../support/effectTestRuntime";
import { decodeJointAuthor, decodeJointResult, jointApplicationRelationsFixture } from "./jointApplicationRelationsFixture";

async function verifyGenerationLoans(tested: Awaited<ReturnType<typeof jointApplicationRelationsFixture>>,
  foreignDatabase?: FlarexMetadataDatabase) {
  const { fixture, control, currency } = tested;
  const before = await tested.inventory();
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const retained = yield* retainPreparedHost(tested.hostRuntime,
      prepareCurrentApplicationBinding(fixture.relationActivation, fixture.persistence.drizzle, binding => Effect.gen(function* () {
        const coordinates = { deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
          schemaVersionId: tested.schemaVersionId };
        const catalog = yield* prepareLogicalStorageReadiness(currency.ports, currency.unique, coordinates, binding);
        if (catalog.status !== "prepared") return yield* Effect.die(new Error("Missing genuine joint catalog"));
        const construction = { kind: "prepared" as const, catalog };
        const application = yield* prepareLogicalApplicationSourceAdmission(currency.ports, currency.unique,
          coordinates, tested.applicationSource, construction);
        const prepared = yield* prepareLogicalDocumentSourceAdmission(currency.ports, currency.unique,
          coordinates, tested.compiled.sourceContract, construction);
        const commerce = yield* prepareLogicalRelationalAdmission(currency.ports, currency.unique,
          coordinates, currency.source, construction);
        const source = yield* prepared.lendPreparation();
        const template = yield* prepareSourceCmsDocumentMaterialization(source, {}, binding, control.drizzle);
        const loan = yield* lendApplicationBindingRelations(binding, control.drizzle);
        expect(loan.kind).toBe("relation");
        expect(yield* Effect.flip(lendApplicationBindingRelations({ ...binding }, control.drizzle)))
          .toMatchObject({ reason: "invalidComposition" });
        const foreign = foreignDatabase ?? (control.drizzle === fixture.persistence.drizzle ? undefined : fixture.persistence.drizzle);
        if (foreign !== undefined) {
          expect(yield* Effect.flip(prepareSourceCmsDocumentMaterialization(source, {}, binding, foreign)))
            .toMatchObject({ reason: "invalidAuthority" });
        }
        return { binding, source, template, application, commerce };
      }), { selection: { deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId },
        candidateIssuer: fixture.pointCommitAuthority }));
    yield* Effect.addFinalizer(() => retained.close);
    const original = yield* retained.use(current => current.withEntry(graph => Effect.succeed(Result.succeed(graph.payload))));
    // An authentic source allocation cannot be combined with a fresh preparation lifetime.
    expect(yield* Effect.flip(retainPreparedHost(tested.hostRuntime,
      prepareSourceCmsDocumentMaterialization(original.source, {}, original.binding, control.drizzle))))
      .toMatchObject({ reason: "invalidAuthority" });
    yield* retained.close;
    expect(yield* Effect.flip(original.template.read)).toMatchObject({ reason: "invalidAuthority" });
  })));
  expect(await tested.inventory()).toEqual(before);
}

export async function jointApplicationRelationsScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession, foreignDatabase?: FlarexMetadataDatabase) {
  const tested = await jointApplicationRelationsFixture(persistence, session);
  const inventory = Effect.tryPromise(tested.inventory);
  await verifyGenerationLoans(tested, foreignDatabase);
  const { fixture, compiled, control } = tested;
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePayloadRuntime(compiled);
    const cms = yield* runtime.bind(yield* makeCmsCommandBinding({ serving: yield* fixture.makeServing(session),
      hostRuntime: tested.hostRuntime, identityAndAccessPolicy: { profile: "joint-source-relations" },
      profile: { kind: "source", schemaVersionId: tested.schemaVersionId, source: compiled.sourceContract } }));
    const author = decodeJointAuthor(yield* cms.create(cms.newRequestKey(), { collection: "authors", data: { name: "Ada" } }));
    let payloadCalls = 0;
    let currencyCalls = 0;
    const diagnostics: ExecutionDiagnosticPolicy = { observe: (name, work) => name === "PayloadAdapter.call"
      ? Effect.sync(() => { payloadCalls++; }).pipe(Effect.andThen(work)) : work };
    const observe = <A, E>(work: Effect.Effect<A, E>) => work.pipe(Effect.provideService(ExecutionDiagnostics, diagnostics));
    const nativeCurrency = getCommerceCommand(currencyAnnouncementWrite);
    if (nativeCurrency === undefined) return yield* Effect.die(new Error("Missing native Currency command"));
    const currencyCommand = defineCommerceCommand(nativeCurrency.name, nativeCurrency.mode,
      (context, args) => Effect.sync(() => { currencyCalls++; }).pipe(Effect.andThen(nativeCurrency.run(context, args))));
    const input = { hostRuntime: tested.hostRuntime, database: persistence.drizzle, controlDatabase: control.drizzle,
      session, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
      authority: fixture.authorityPorts, application: fixture.relationActivation,
      identityAndAccessPolicy: { profile: "joint-source-relations" }, materialization: fixture.servingOwners.materialization,
      expectedContentIdentity: compiled.contentIdentity, currency: tested.currency,
      applicationSource: tested.applicationSource, payloadSource: compiled.sourceContract,
      currencyCommand, cmsCommand: inspectPayloadRuntimeForTest(runtime).commands.create, applicationTable: "audit" };
    const host = yield* Effect.acquireRelease(makeLegacyCurrencyAnnouncementHost(input), value => value.close);
    const args = { currency: { code: "jnt", name: "Joint relation", symbol: "J", symbol_native: "J" },
      cms: { collection: "articles", data: { headline: "Joint relation", author: author.id } },
      application: { name: "Joint relation audit" } };
    const before = yield* inventory;
    const key = host.newRequestKey();
    const result = decodeJointResult(yield* observe(host.run(key, args)));
    expect(result.cms.author).toBe(author.id);
    expect(result.currency.code).toBe("jnt");
    expect(payloadCalls).toBe(1);
    expect(currencyCalls).toBe(1);
    const created = yield* inventory;
    const commit = created.commits.at(-1);
    if (commit === undefined) return yield* Effect.die(new Error("Missing successful joint commit"));
    // These precede the relation assertions so the BEFORE witness proves an
    // actual successful native three-source commit, not a fixture/setup refusal.
    expect(created.rows.length - before.rows.length).toBe(3);
    expect(created.commits.length - before.commits.length).toBe(1);
    expect(created.outcomes.length - before.outcomes.length).toBe(1);
    expect(created.facts.length - before.facts.length).toBe(3);
    // The logical Currency profile publishes its row through the three shared
    // document facts; it emits no compatibility-table relational fact.
    expect(created.relationalFacts).toEqual(before.relationalFacts);
    const committedRows = created.revisions.filter(row => row.commitSeq === commit.commitSeq);
    expect(committedRows).toHaveLength(3);
    expect(committedRows.every(row => row.schemaVersionId === tested.schemaVersionId)).toBe(true);
    const expectedDocumentIds = [result.applicationId, result.cms.id].map(decodeAppDocumentIdentityV1);
    for (const identity of expectedDocumentIds) {
      expect(committedRows.some(row => row.tableId === identity.tableId &&
        encodeBytesToLowercaseHex(row.rowId) === identity.rowId)).toBe(true);
    }
    const committedIndexes = created.indexRevisions.filter(index => index.commitSeq === commit.commitSeq);
    expect(new Set(committedIndexes.map(index => index.tableId)).size).toBe(3);
    for (const index of committedIndexes) {
      const definition = tested.indexDefinitions.find(member => member.indexDefinitionId === index.indexDefinitionId);
      expect(definition?.access.tableId).toBe(index.tableId);
      expect(definition?.physicalSpecSha256Hex).toBe(encodeBytesToLowercaseHex(index.physicalSpecSha256));
      if (definition?.access.kind === "developer") {
        expect(tested.indexBindings).toContainEqual(expect.objectContaining({
          indexDefinitionId: index.indexDefinitionId, schemaVersionId: tested.schemaVersionId,
        }));
      } else expect(definition?.access.kind).toBe("by_creation_time");
    }
    const articleIdentity = decodeAppDocumentIdentityV1(result.cms.id);
    const reverse = tested.indexDefinitions.find(definition => definition.access.tableId === articleIdentity.tableId &&
      definition.physicalSpec.orderedFields[0]?.kind === "documentPath" &&
      definition.physicalSpec.orderedFields[0].path === "author");
    expect(reverse).toBeDefined();
    expect(committedIndexes.map(index => ({ ...index, rowId: encodeBytesToLowercaseHex(index.rowId) })))
      .toContainEqual(expect.objectContaining({
      indexDefinitionId: reverse?.indexDefinitionId, tableId: articleIdentity.tableId,
      rowId: articleIdentity.rowId, isTombstone: false,
    }));
    const incoming = yield* tested.incoming(author.id);
    expect({ edges: created.edges.length, adjacency: created.adjacency.length,
      relationFacts: created.relationFacts.length - before.relationFacts.length,
      incoming: incoming.sources.map(item => item.sourceDocumentId) }).toEqual({
      edges: 1, adjacency: 2, relationFacts: 2, incoming: [result.cms.id],
    });
    expect(created.edges).toHaveLength(1);
    const relation = fixture.relation.binding.relationBindings[0];
    if (relation === undefined) return yield* Effect.die(new Error("Missing genuine relation binding"));
    const article = decodeAppDocumentIdentityV1(result.cms.id);
    const target = decodeAppDocumentIdentityV1(author.id);
    expect(created.edges.map(edge => ({ ...edge, sourceRowId: encodeBytesToLowercaseHex(edge.sourceRowId),
      targetRowId: encodeBytesToLowercaseHex(edge.targetRowId) }))[0]).toMatchObject({ relationId: relation.relationId,
      edgeDefinitionId: relation.edgeDefinitionId, sourceTableId: article.tableId,
      sourceRowId: article.rowId, targetTableId: target.tableId,
      targetRowId: target.rowId, schemaVersionId: fixture.relation.binding.schemaVersionId,
      commitSeq: commit.commitSeq });
    const endpoints = [{ direction: "incoming", endpointRowId: target.rowId },
      { direction: "outgoing", endpointRowId: article.rowId }];
    expect(created.adjacency).toHaveLength(2);
    for (const endpoint of endpoints) {
      expect(created.adjacency.map(row => ({ ...row, endpointRowId: encodeBytesToLowercaseHex(row.endpointRowId) })))
        .toContainEqual(expect.objectContaining({ ...endpoint,
        edgeDefinitionId: relation.edgeDefinitionId, lastChangedCommitSeq: commit.commitSeq }));
      expect(created.relationFacts.map(row => ({ ...row, endpointRowId: encodeBytesToLowercaseHex(row.endpointRowId) })))
        .toContainEqual(expect.objectContaining({ ...endpoint,
        edgeDefinitionId: relation.edgeDefinitionId, commitSeq: commit.commitSeq }));
    }
    expect(created.relationFacts.length - before.relationFacts.length).toBe(2);
    expect(commit.relationAdjacencyChangeCount).toBe(2);
    expect(yield* observe(host.run(key, args))).toEqual(result);
    expect(payloadCalls).toBe(1);
    expect(currencyCalls).toBe(1);
    expect(yield* inventory).toEqual(created);
    for (const step of ["relationEdgeWritten", "commitRelationAdjacencyChangeWritten", "outcomeWritten"] as const) {
      let faults = 0;
      let completedParticipants = 0;
      const callsBeforeFault = { payload: payloadCalls, currency: currencyCalls };
      const fault = new Error(`Rollback all joint participants after ${step}`);
      const failing = yield* Effect.acquireRelease(makeLegacyCurrencyAnnouncementHost({ ...input,
        materialization: { ...input.materialization, afterTransactionStep: event => {
          if (event.step === step) { faults++; return Promise.reject(fault); }
          return Promise.resolve();
        } } }, { afterSteps: () => Effect.sync(() => { completedParticipants++; }) }), value => value.close);
      const code = step === "relationEdgeWritten" ? "jra" : step === "commitRelationAdjacencyChangeWritten" ? "jrb" : "jrc";
      const failed = yield* Effect.exit(observe(failing.run(failing.newRequestKey(), { ...args,
        currency: { ...args.currency, code }, cms: { ...args.cms, data: { ...args.cms.data, headline: step } } })));
      expect(failed).toMatchObject({ _tag: "Failure" });
      if (Exit.isFailure(failed)) {
        expect(failed.cause.reasons).toHaveLength(1);
        const reason = failed.cause.reasons[0];
        if (reason === undefined) return yield* Effect.die(new Error("Missing injected fault cause"));
        if (step === "relationEdgeWritten") {
          expect(Cause.isDieReason(reason)).toBe(true);
          if (Cause.isDieReason(reason)) expect(reason.defect).toBe(fault);
        } else {
          expect(Cause.isFailReason(reason)).toBe(true);
          if (Cause.isFailReason(reason)) {
            expect(reason.error).toMatchObject({ reason: "resourceFailure" });
            expect(reason.error.cause).toBe(fault);
          }
        }
      }
      expect(faults).toBe(1);
      expect(completedParticipants).toBe(1);
      expect({ payload: payloadCalls, currency: currencyCalls })
        .toEqual({ payload: callsBeforeFault.payload + 1, currency: callsBeforeFault.currency + 1 });
      expect(yield* inventory).toEqual(created);
    }
    const callsBeforeTransition = { payload: payloadCalls, currency: currencyCalls };
    yield* tested.activatePayloadLifecycle();
    const transitioned = yield* inventory;
    expect(transitioned).toEqual({ ...created, clock: created.clock.map(clock => ({ ...clock,
      lastMetadataSequence: clock.lastMetadataSequence + 1n })) });
    // This is a genuine changed binding. The old joint preparation must refuse
    // the lifecycle it cannot admit before invoking either native callback.
    expect(yield* Effect.flip(observe(host.run(host.newRequestKey(), { ...args,
      currency: { ...args.currency, code: "jst" },
      cms: { ...args.cms, data: { ...args.cms.data, headline: "Stale binding" } } }))))
      .toMatchObject({ reason: "invalidAuthority" });
    expect({ payload: payloadCalls, currency: currencyCalls }).toEqual(callsBeforeTransition);
    expect(yield* inventory).toEqual(transitioned);
    const lifecycleCms = yield* runtime.bind(yield* makeCmsCommandBinding({ serving: yield* fixture.makeServing(session),
      hostRuntime: tested.hostRuntime, identityAndAccessPolicy: { profile: "joint-source-relations-lifecycle" },
      profile: { kind: "source", schemaVersionId: tested.schemaVersionId, source: compiled.sourceContract,
        payloadPreferenceTarget: tested.target } }));
    expect(yield* Effect.flip(lifecycleCms.delete(lifecycleCms.newRequestKey(), { collection: "authors", id: author.id })))
      .toMatchObject({ reason: "relationDeleteRestricted" });
    expect(yield* inventory).toEqual(transitioned);
  })).pipe(Effect.provide(ScopeExecutionLive)));
}
