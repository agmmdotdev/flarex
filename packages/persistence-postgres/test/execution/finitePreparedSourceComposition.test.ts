import { count } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";
import { readFiniteActiveApplicationPreparationState } from "../../src/application/activation/finiteIdentity";
import { prepareFiniteActiveApplication } from "../../src/application/activation/repositoryIdentity";
import { prepareFiniteApplicationSourceComposition } from "../../src/storage/documents/logicalDocuments/sourceAdmission";
import { makeApplicationAnalysisRepository } from "../../src/application/applicationAnalysisRegistration";
import { readApplicationSelectionState, readFiniteApplicationSourceComposition } from "../../src/application/activation/selectionIdentity";
import { readFiniteMetadataSourceComposition, readFiniteMetadataSourcePreparation } from "../../src/execution/finiteMetadataDependencies";
import { createMixedMutationProductFixture, type MixedMutationFinalEntryTestContext } from "../../../executor/test/performance/support/mixedMutationProductFixture";
import { fxAppRowRevisions, fxSystemCommits, fxSystemSnapshotLeases, fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals, fxSystemTransactionSessions } from "../../src/database/schema";
import { fxSystemCommitEvents } from "../../src/commit/events/schema";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../support/postgresHelpers";
import { createApplicationNativeMutationPGliteFixtureWithPersistence, createApplicationNativeMutationPostgresFixture,
  type ApplicationNativeMutationFixture, type ApplicationNativeMutationPersistence } from "../application/applicationNativeMutationTestFixture";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";
import { makeSchemaComposer } from "../../../medusa-adapter/src/schemaComposition";
import { readPreparedLogicalSchemaCandidate } from "../../../analysis/src/logicalSchemaCandidate";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { makeLogicalSchemaAdmission } from "../../src/storage/catalog/logicalSchemaAdmission";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline, type CatalogControlSessionStarter } from "../../src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../src/database/postgresCatalogControlSession";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { ensureLogicalStorageDefinitions } from "../../src/storage/catalog/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../../src/storage/unique/appUniqueConstraintSetClosureV1";
import { reconcilePublishedIndexBuildsV1Effect } from "../../src/storage/indexes/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../../src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../../src/storage/unique/appUniqueConstraintSetBuildV1";
import { prepareLogicalStorageReadiness } from "../../src/storage/catalog/logicalStorageReadiness";
import { prepareLogicalRelationalAdmission } from "../../src/storage/documents/logicalDocuments/relationalAdmission";
import { makePreparedHostRuntime, retainPreparedHost } from "../../src/execution/preparation/preparedHostRuntime";
import { prepareCurrentApplicationBinding } from "../../src/application/activation/currentBinding";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import type { FiniteSessionJournalParticipantSelection } from "../../src/execution/journal/api";
import { inspectLogicalParticipantAdmissionBundle } from "../../src/storage/documents/logicalDocuments/participantAdmission";
import { withLogicalDocumentAttemptAdmissionEffect } from "../../src/storage/documents/logicalDocuments/documentAdmission";
import type { LogicalDocumentWrite } from "../../src/storage/documents/logicalDocuments/model";
import { detachLogicalCanonicalDocument } from "../../src/storage/documents/logicalDocuments/relationalRows";

const drivers = postgresUrl === null ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
const entryInventory = (context: MixedMutationFinalEntryTestContext) => Promise.all([
  fxAppRowRevisions, fxSystemCommits, fxSystemCommitEvents, fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims, fxSystemTransactionJournals, fxSystemTransactionSessions,
].map(async table => (await context.currency.persistence.drizzle.select({ count: count() }).from(table))[0]?.count ?? 0));

describe.each(drivers)("genuine prepared source composition on %s", driver => {
  it("rechecks changed write identity and creation time after the actual Payload source issues its document verdict", async () => {
    let participant: FiniteSessionJournalParticipantSelection | undefined;
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `payload-context-${driver}`,
      payloadProfile: "ordinary", hooks: { transformFiniteEntrySources: participants => {
        participant = participants[1];
        return participants;
      } } });
    try {
      if (participant === undefined) throw new Error("Missing actual Payload entry participant");
      const method = participant.operationMethods[0];
      if (method === undefined) throw new Error("Missing actual Payload operation");
      const bundle = await Effect.runPromise(fixture.store.admitLogicalParticipantsEffect(fixture.persistenceAttempt,
        { ...participant, sources: participant.sources.map(source => ({ ...source, application: fixture.active.selection })) }));
      const issued = inspectLogicalParticipantAdmissionBundle(bundle, fixture.persistenceAttempt,
        participant.participant, method, participant.profileRevision);
      const admission = issued?.admissions[0];
      if (admission === undefined) throw new Error("Missing actual Payload source admission");
      await Effect.runPromise(withLogicalDocumentAttemptAdmissionEffect(admission, fixture.persistenceAttempt, method,
        () => Effect.void, state => Effect.gen(function* () {
          const table = state.tables.find(table => table.localName === "posts");
          if (table === undefined) return yield* Effect.die("Missing selected Payload posts table");
          const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId,
            rowId: decodeAppRowIdHexV1("11111111111111111111111111111111") });
          const changedId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId,
            rowId: decodeAppRowIdHexV1("22222222222222222222222222222222") });
          const creationTime = AppCreationTimeV1Schema.make(1);
          const document = yield* canonicalizeFlarexValueV1Effect({ _id: documentId, _creationTime: creationTime,
            title: "canonical context", score: 0, enabled: false, publishedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" }, "appDocument");
          const original: LogicalDocumentWrite = { operation: "replace", tableId: table.tableId,
            tableName: table.localName, documentId, creationTime, document };
          expect(Result.isSuccess(state.validate(original))).toBe(true);
          const detached = detachLogicalCanonicalDocument(document);
          // Only genuine table provenance retains this immutable runtime;
          // foreign detachment would clone it and fail this identity witness.
          expect(detached.value).toBe(document.value);
          for (const candidate of [original, { ...original, document: detached }]) {
            for (const changed of [{ ...candidate, documentId: changedId },
              { ...candidate, creationTime: AppCreationTimeV1Schema.make(2) }]) {
              const invalid = state.validate(changed);
              expect(Result.isFailure(invalid)).toBe(true);
              if (Result.isFailure(invalid)) expect(invalid.failure).toMatchObject({
                _tag: "LogicalDocumentSourceAdmissionError", reason: "documentInvalid" });
            }
            expect(Result.isSuccess(state.validate(candidate))).toBe(true);
          }
        })));
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual({});
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } finally { await fixture.close(); }
  }, 240_000);

  for (const change of ["changed", "missing", "reordered"] as const) {
    it(`refuses ${change} genuine entry sources without rebuilding the original generation graph or publishing`, async () => {
      let baseline: readonly number[] = [];
      let originalProjection: Result.Result.Success<ReturnType<typeof readFiniteApplicationSourceComposition>>;
      let originalGraph: Result.Result.Success<ReturnType<typeof readFiniteMetadataSourceComposition>> | undefined;
      let callbacks = 0, nativeCallbacks = 0, observedFailure = false;
      const failed = await createMixedMutationProductFixture({ driver,
        suffix: `prepared-source-${change}-${driver}`, payloadProfile: "ordinary", hooks: {
          beforeFinalEntry: async context => {
            baseline = await entryInventory(context);
            const active = readFiniteActiveApplicationPreparationState(context.preparedFiniteApplication);
            if (active === undefined) throw new Error("Missing original Application generation");
            originalProjection = Result.getOrThrow(readFiniteApplicationSourceComposition(active.selection));
            if (originalProjection === undefined) throw new Error("Missing cold source composition");
            originalGraph = Result.getOrThrow(readFiniteMetadataSourceComposition(originalProjection, active.selection));
            expect(originalGraph.sources).toHaveLength(2);
          },
          transformFiniteEntrySources: participants => {
            const product = participants[0], payload = participants[1];
            const replacement = payload?.sources[0];
            if (product === undefined || payload === undefined || replacement === undefined)
              throw new Error("Missing the actual Product/Payload generation sources");
            if (change === "missing") return [product];
            if (change === "reordered") return [payload, product];
            return [{ ...product, sources: product.sources.map(source => ({ ...source, selection: replacement.selection })) }, payload];
          },
          beforeFiniteCallback: () => Effect.sync(() => { callbacks++; }),
          beforeNative: () => Effect.sync(() => { nativeCallbacks++; }),
          onFinalEntryFailure: async (context, exit) => {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isSuccess(exit)) throw new Error("Changed source graph entered execution");
            const failures = exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
            expect(failures).toMatchObject([{ _tag: "LogicalParticipantAdmissionError",
              reason: change === "missing" ? "invalidAuthority" : "sourceMismatch",
              cause: { _tag: "LogicalSourceAdmissionError", reason: "sourceMismatch" } }]);
            const active = readFiniteActiveApplicationPreparationState(context.preparedFiniteApplication);
            if (active === undefined || originalProjection === undefined) throw new Error("Lost original generation during refusal");
            expect(Result.getOrThrow(readFiniteApplicationSourceComposition(active.selection))).toBe(originalProjection);
            expect(Result.getOrThrow(readFiniteMetadataSourceComposition(originalProjection, active.selection))).toBe(originalGraph);
            expect(await entryInventory(context)).toEqual(baseline);
            observedFailure = true;
          },
        } }).then(async fixture => { await fixture.close(); throw new Error("Expected exact source graph refusal"); }, cause => cause);
      expect(observedFailure, String(failed)).toBe(true);
      expect(callbacks).toBe(0);
      expect(nativeCallbacks).toBe(0);
    }, 240_000);
  }

  it("binds the original source/Application pair and revokes both source loans and the exact graph on disposal", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `prepared-source-composition-${driver}` });
    let closed = false;
    try {
      const active = readFiniteActiveApplicationPreparationState(fixture.preparedFiniteApplication);
      if (active === undefined) throw new Error("Missing original prepared Application generation");
      const sourceProjection = await Effect.runPromise(fixture.prepared.lendFiniteMetadataProjection());
      const original = Result.getOrThrow(readFiniteMetadataSourcePreparation(sourceProjection, fixture.prepared));
      expect(original.selection).toBe(fixture.prepared);
      expect(original.schemaVersionId).toBe(fixture.logicalSchemaVersionId);
      expect(original.schemaVersionId).not.toBe(fixture.schemaVersionId);
      expect(original.lifetime?.checkOpen).toBe(active.lifetime?.checkOpen);
      expect(original.lifetime?.checkOpen).toBeTypeOf("function");
      expect(original.boundApplicationProjection).toBeDefined();
      const copied = Object.freeze({ ...fixture.prepared });
      expect(await Effect.runPromise(copied.lendFiniteMetadataProjection())).toBe(sourceProjection);
      const copiedPreparation = readFiniteMetadataSourcePreparation(sourceProjection, copied);
      expect(Result.isFailure(copiedPreparation)).toBe(true);
      if (Result.isFailure(copiedPreparation)) expect(copiedPreparation.failure.reason).toBe("invalidProjection");
      const projection = Result.getOrThrow(readFiniteApplicationSourceComposition(active.selection));
      if (projection === undefined) throw new Error("Original generation did not compile its exact source graph");
      const graph = Result.getOrThrow(readFiniteMetadataSourceComposition(projection, active.selection));
      expect(graph.boundApplicationProjection).toBeDefined();
      expect(graph.sources).toEqual([fixture.prepared]);
      expect(graph.sourceProjections).toEqual([sourceProjection]);
      expect(Object.isFrozen(graph.sources)).toBe(true);
      expect(Object.isFrozen(graph.sourceProjections)).toBe(true);
      const copiedComposition = readFiniteMetadataSourceComposition(projection, Object.freeze({ ...active.selection }));
      expect(Result.isFailure(copiedComposition)).toBe(true);
      if (Result.isFailure(copiedComposition)) expect(copiedComposition.failure.reason).toBe("invalidProjection");
      await Effect.runPromise(graph.requirePrepared);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual({});
      expect(fixture.getOpenTransactionDepth()).toBe(0);
      await fixture.close();
      closed = true;
      const closedPreparation = readFiniteMetadataSourcePreparation(sourceProjection, fixture.prepared);
      expect(Result.isFailure(closedPreparation)).toBe(true);
      if (Result.isFailure(closedPreparation)) expect(closedPreparation.failure.reason).toBe("invalidProjection");
      const closedComposition = readFiniteMetadataSourceComposition(projection, active.selection);
      expect(Result.isFailure(closedComposition)).toBe(true);
      if (Result.isFailure(closedComposition)) expect(closedComposition.failure.reason).toBe("invalidProjection");
      expect(Result.isFailure(readFiniteApplicationSourceComposition(active.selection))).toBe(true);
      expect(Result.isFailure(await Effect.runPromise(fixture.prepared.lendFiniteMetadataProjection().pipe(Effect.result)))).toBe(true);
    } finally {
      if (!closed) await fixture.close();
    }
  }, 240_000);

  it("refuses copied sources and a genuinely removed Application index within the same preparation generation", async () => {
    const options = { runtimeHostIdentity: "flarex.test/prepared-source-catalog", compatibilityDate: "2026-10-11",
      includeUserNameIndex: true };
    if (driver === "postgres") {
      await withTemporaryPostgresPersistencePair(async (control, target) => {
        const application = await createApplicationNativeMutationPostgresFixture(options, { control, target });
        const session = makeCatalogControlSessionStarter({ controlDb: control.drizzle,
          driver: makePostgresCatalogControlSessionDriver(control.pool) });
        await Effect.runPromise(witnessCatalogPair(application, session));
      });
    } else {
      // The existing migrated fixture owns the actual PGlite client and host
      // runtime, registering both releases with onTestFinished even on failure.
      const control = await createMigratedPGlitePersistence();
      const target = await createMigratedPGlitePersistence();
      const application = await createApplicationNativeMutationPGliteFixtureWithPersistence(options, { control, target });
      const session = makePGliteFrameworkSchemaArtifactAdmissionFixture(control).controlSessionStarter;
      await Effect.runPromise(witnessCatalogPair(application, session));
    }
  }, 240_000);
});

/** Prepare actual joint catalogs before framework initialization writes rows.
 * Native-only candidate evolution cannot validate an initialized framework row
 * set. This witness exercises immutable preparation, not a business workflow. */
const witnessCatalogPair = Effect.fn("PreparedSourceComposition.catalogPairWitness")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  application: ApplicationNativeMutationFixture<Persistence>, session: CatalogControlSessionStarter,
) {
  const { control, target, deploymentId, authority, authorityPorts } = application;
  const logicalSchemaVersionId = decodeCatalogSchemaVersionId("prepared-source-catalog");
  const input = { deploymentId, scopeId: authority.scopeId, schemaVersionId: logicalSchemaVersionId };
  const ports = { controlDb: control.drizzle, authority: authorityPorts };
  const candidate = yield* makeSchemaComposer({ deploymentId, authority,
    applicationAnalyses: makeApplicationAnalysisRepository(target.drizzle), medusaModules: ["currency"] })({
      applicationCandidateId: application.active.basis.candidateId,
      payloadCollections: [{ slug: "news", fields: [{ name: "title", type: "text", required: true, unique: true }] }],
      payloadViews: [], extensions: [] });
  const authored = yield* readPreparedLogicalSchemaCandidate(candidate);
  const source = authored.sources.find(member => member.key === "medusa.currency");
  if (source?.definition.kind !== "relational") return yield* Effect.die("Missing actual composed Currency source");
  const sourceSchema = source.definition.schema;
  yield* makeLogicalSchemaAdmission({ controlDb: control.drizzle, session, deploymentId, scopeId: authority.scopeId })
    .admit(candidate, { schemaVersionId: logicalSchemaVersionId, version: decodeCatalogSchemaVersion(100) }, {
      initialDeadline: yield* startCatalogControlDeadline("initial", 20_000), lockTimeoutMilliseconds: 5_000,
      recoveryTimeoutMilliseconds: 20_000 });
  yield* Effect.promise(() => control.drizzle.transaction(tx => Effect.runPromise(Effect.gen(function* () {
    yield* ensureLogicalStorageDefinitions(tx, deploymentId, logicalSchemaVersionId);
    const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(control.drizzle,
      { deploymentId, schemaVersionId: logicalSchemaVersionId }, tx);
    yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
  }))));
  const reconciled = yield* reconcilePublishedIndexBuildsV1Effect(ports, input);
  if (reconciled.status !== "reconciled") return yield* Effect.die("Missing actual joint index declarations");
  for (const indexDefinitionId of reconciled.definitionIds) {
    const definition = yield* locateAppIndexDefinitionByIdEffect(control.drizzle, authority.scopeId, indexDefinitionId);
    if (definition === null) return yield* Effect.die("Missing actual joint index definition");
    let enabled = false;
    for (let step = 0; step < 20; step++) {
      const buildInput = { deploymentId, scopeId: authority.scopeId, indexDefinitionId, pageSize: 10 };
      const built = definition.access.kind === "by_creation_time"
        ? yield* buildIntrinsicCreationTimeIndexV1Effect(ports, buildInput)
        : yield* buildAppDeveloperOrderedIndexV1Effect(ports, buildInput);
      if (built.lifecycle === "enabled") { enabled = true; break; }
    }
    if (!enabled) return yield* Effect.die("Actual joint index did not enable");
  }
  const uniques = yield* reconcileAppUniqueConstraintSetBuildV1Effect(ports, input);
  if (uniques.status !== "reconciled") return yield* Effect.die("Missing actual joint unique declarations");
  let uniqueEnabled = false;
  for (let step = 0; step < (uniques.definitionCount + 1) * 4; step++) {
    const built = yield* advanceAppUniqueConstraintSetBackfillV1Effect(ports, { ...input, pageSize: 16 });
    if (built.lifecycle === "enabled" && built.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
  }
  if (!uniqueEnabled) return yield* Effect.die("Actual joint unique set did not enable");
  // All catalogs/builds are real, while the scope has no framework bodies to
  // reinterpret as Application documents during the supported schema change.
  expect((yield* Effect.promise(() => target.drizzle.select({ count: count() }).from(fxAppRowRevisions)))[0]?.count).toBe(0);
  const stopped = new Error("Finished genuine catalog-pair refusal witness");
  const outcome = yield* Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 134_217_728 });
    yield* retainPreparedHost(runtime, prepareCurrentApplicationBinding(application.activation, target.drizzle,
      originalBinding => Effect.gen(function* () {
        const catalog = yield* prepareLogicalStorageReadiness(ports, application.uniqueConstraintEligibility, input, originalBinding);
        if (catalog.status !== "prepared") return yield* Effect.die("Missing actual prepared joint catalog");
        const prepared = yield* prepareLogicalRelationalAdmission(ports, application.uniqueConstraintEligibility, input,
          { sourceKey: source.key, writeProfile: source.writeProfile, schema: sourceSchema, evidence: source.evidence },
          { kind: "prepared", catalog });
        const sourceProjection = yield* prepared.lendFiniteMetadataProjection();
        const original = yield* Effect.fromResult(readFiniteMetadataSourcePreparation(sourceProjection, prepared));
        const active = yield* prepareFiniteActiveApplication(application.activation);
        const activeState = readFiniteActiveApplicationPreparationState(active);
        if (activeState === undefined) return yield* Effect.die("Missing genuine native Application preparation");
        expect(original.schemaVersionId).not.toBe(application.active.basis.schemaVersionId);
        expect(original.lifetime?.checkOpen).toBe(activeState.lifetime?.checkOpen);
        expect(original.boundApplicationProjection).toBeDefined();
        const copied = yield* prepareFiniteApplicationSourceComposition(active, [Object.freeze({ ...prepared })]).pipe(Effect.result);
        expect(Result.isFailure(copied)).toBe(true);
        if (Result.isFailure(copied)) expect(copied.failure).toMatchObject({ _tag: "FiniteMetadataError", reason: "invalidProjection" });
        expect(Result.getOrThrow(readFiniteApplicationSourceComposition(activeState.selection))).toBeUndefined();
        yield* prepareFiniteApplicationSourceComposition(active, [prepared]);
        expect(Result.getOrThrow(readFiniteApplicationSourceComposition(activeState.selection))).toBeDefined();
        const analysis = yield* makeApplicationAnalysisRepository(target.drizzle).inspect(authority, application.active.basis.candidateId);
        if (analysis.status !== "analyzed" || analysis.manifest.version !== 1)
          return yield* Effect.die("Missing original analyzed fixture manifest");
        expect(analysis.manifest.schema.indexes.map(index => index.name)).toContain("by_name");
        const current = yield* application.activation.readActive();
        const manifest = { ...analysis.manifest, schema: { ...analysis.manifest.schema,
          indexes: [],
        } };
        expect(manifest.schema.tables).toBe(analysis.manifest.schema.tables);
        yield* Effect.promise(() => application.moveHead({ manifest, expectedActiveHead: current.expectedActiveHead }));
        const changed = yield* prepareFiniteActiveApplication(application.activation);
        const changedState = readFiniteActiveApplicationPreparationState(changed);
        if (changedState === undefined) return yield* Effect.die("Missing genuine changed Application preparation");
        expect(changedState.lifetime?.checkOpen).toBe(original.lifetime?.checkOpen);
        const changedSelection = readApplicationSelectionState(changedState.selection);
        if (changedSelection?.kind !== "legacy") return yield* Effect.die("Missing changed Application selection");
        const changedAnalysis = yield* makeApplicationAnalysisRepository(target.drizzle)
          .inspect(authority, changedSelection.basis.candidateId);
        if (changedAnalysis.status !== "analyzed" || changedAnalysis.manifest.version !== 1)
          return yield* Effect.die("Missing changed analyzed fixture manifest");
        expect(changedAnalysis.manifest.schema.tables).toEqual(analysis.manifest.schema.tables);
        expect(changedAnalysis.manifest.schema.indexes).toEqual([]);
        expect(changedSelection.basis.deploymentId).toBe(original.deploymentId);
        expect(changedSelection.basis.authority.scopeId).toBe(original.scopeId);
        expect(changedSelection.basis.schemaVersionId).not.toBe(original.schemaVersionId);
        const mismatch = yield* prepareFiniteApplicationSourceComposition(changed, [prepared]).pipe(Effect.result);
        expect(Result.isFailure(mismatch)).toBe(true);
        if (Result.isFailure(mismatch)) expect(mismatch.failure.reason).toBe("sourceMismatch");
        expect(Result.getOrThrow(readFiniteApplicationSourceComposition(changedState.selection))).toBeUndefined();
        // The witness deliberately moved the head during this staged
        // construction. Stop here: its original after-observation must not
        // publish that intentionally obsolete generation as a serving graph.
        return yield* Effect.die(stopped);
      }), { selection: { deploymentId, scopeId: authority.scopeId }, candidateIssuer: application.sessionAuthority }));
  })).pipe(Effect.exit);
  if (Exit.isSuccess(outcome)) return yield* Effect.die("Catalog-pair witness installed its obsolete generation");
  expect(outcome.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect), Cause.pretty(outcome.cause)).toContain(stopped);
});
