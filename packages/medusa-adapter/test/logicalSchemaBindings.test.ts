import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeSchemaComposer } from "../src/schemaComposition";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../persistence-postgres/test/postgresHelpers";
import { createApplicationNativeMutationPGliteFixtureWithPersistence, createApplicationNativeMutationPostgresFixture,
  type ApplicationNativeMutationFixture } from "../../persistence-postgres/test/fixtures/applicationNativeMutationTestFixture";
import type { PGliteFlarexPersistence } from "../../persistence-postgres/src/pglite";
import type { PostgresFlarexPersistence } from "../../persistence-postgres/src/postgres";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../persistence-postgres/test/frameworkSchemaArtifactAdmissionTestSupport";
import { prepareNeutralCommerceProfile } from "../../persistence-postgres/test/neutralCommerceProfile";
import { makeFrameworkMigrationFixtureTarget } from "../../persistence-postgres/test/frameworkMigrationFixtureTarget";
import { installationBindingReference } from "../../persistence-postgres/test/frameworkDataBindingPhysicalTestSupport";
import { frameworkSchemaTargetSnapshot } from "../../persistence-postgres/src/frameworkSchema/target";
import { prepareFrameworkSchemaArtifactAdmission, makeFrameworkSchemaArtifactRepository } from "../../persistence-postgres/src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../../persistence-postgres/src/frameworkSchema/artifact/admission";
import { makeFrameworkInstaller } from "../../persistence-postgres/src/migrationCoordination/installer";
import * as scopePublication from "../../persistence-postgres/src/commitPublication/publication";
import { ScopePublicationSqlFailure } from "../../persistence-postgres/src/commitPublication/scopePublicationModel";
import { requireCommerceProfile } from "../../persistence-postgres/src/commerceTransaction/profile";
import { makeCommerceBinding } from "../../persistence-postgres/src/commerce";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { makeCatalogControlSessionStarter, type CatalogControlSessionStarter } from "../../persistence-postgres/src/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../persistence-postgres/src/postgresCatalogControlSession";
import { makeApplicationAnalysisRepository } from "../../persistence-postgres/src/applicationAnalysisRegistration";
import { logicalSchemaBindingScenario } from "../../persistence-postgres/test/logicalSchemaBindingScenario";
import { compileCurrencyDefinition } from "../../medusa-adapter/src/currency-schema";
import { currencyInitialization } from "../../medusa-adapter/src/currency-contract";
import { currencyReadPlan } from "../../medusa-adapter/src/currency-repository";
import { withCurrencyService } from "../../medusa-adapter/src/currency-service";
import { currencyCommands, currencyAnnouncementWrite, makeCurrencyService } from "../../medusa-adapter/src/currency-service";
import { defineCommerceCommand, makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commitEvents/schema";
import { commitEventsDigest } from "../../persistence-postgres/src/commitEvents/digest";
import { makeCommitEventPump } from "../../persistence-postgres/src/commitEvents/pump";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { preparedHostTestRuntime, openPreparedHostTestRuntime, closePreparedHostTestRuntime } from "../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { makePreparedHostRuntime, retainPreparedHost } from "../../persistence-postgres/src/preparedHostRuntime";
import { issueRelationalSession, makePostgresRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import type { RelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { runEffectTransaction } from "../../persistence-postgres/src/effectTransaction";
import { fxSystemLogicalSourceInitializations } from "../../persistence-postgres/src/logicalStorageInitialization";
import { runDrizzleStatementEffect } from "../../persistence-postgres/src/drizzleStatementEffect";
import { fxAppRowCurrent, fxSystemCommits, fxSystemIdempotency } from "../../persistence-postgres/src/schema";
import { CommitSeqSchema, projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";

const options = { runtimeHostIdentity: "flarex.test/logical-binding", compatibilityDate: "2026-09-20" };
describe("logical schema selection by the existing binding authority", () => {
  it("activates the joint native candidate and rechecks readiness on PGlite", async () => {
    const control = await createMigratedPGlitePersistence();
    const target = await createMigratedPGlitePersistence();
    const fixture = await createApplicationNativeMutationPGliteFixtureWithPersistence(options, { control, target });
    await Effect.runPromise(witness(fixture, makePGliteFrameworkSchemaArtifactAdmissionFixture(control).controlSessionStarter));
  });
  it.skipIf(postgresUrl === null)("activates and recovers the same joint candidate on ordinary-role PostgreSQL", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const role = await target.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(
        "select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user");
      expect(role.rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }]);
      const namespace = await target.query<{ schema: string }>("select current_schema() as schema");
      const schemaName = namespace.rows[0]?.schema;
      if (schemaName === undefined) throw new Error("Missing target schema");
      const fixture = await createApplicationNativeMutationPostgresFixture({ ...options,
        physicalLocator: { kind: "database_per_scope", databaseKey: "application_native_mutation_target", schemaName },
      }, { control, target });
      const session = makeCatalogControlSessionStarter({ controlDb: control.drizzle,
        driver: makePostgresCatalogControlSessionDriver(control.pool) });
      await Effect.runPromise(witness(fixture, session));
    });
  });
  it("runs native Currency commands and initialization through the logical commerce host on PGlite", async () => {
    const control = await createMigratedPGlitePersistence();
    const target = await createMigratedPGlitePersistence();
    const fixture = await createApplicationNativeMutationPGliteFixtureWithPersistence(options, { control, target });
    await Effect.runPromise(witness(fixture, makePGliteFrameworkSchemaArtifactAdmissionFixture(control).controlSessionStarter, "host"));
  });
  it.skipIf(postgresUrl === null)("runs native Currency commands and initialization through the logical commerce host on ordinary-role PostgreSQL", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const namespace = await target.query<{ schema: string }>("select current_schema() as schema");
      const schemaName = namespace.rows[0]?.schema;
      if (schemaName === undefined) throw new Error("Missing target schema");
      const fixture = await createApplicationNativeMutationPostgresFixture({ ...options,
        physicalLocator: { kind: "database_per_scope", databaseKey: "application_native_mutation_target", schemaName },
      }, { control, target });
      const session = makeCatalogControlSessionStarter({ controlDb: control.drizzle,
        driver: makePostgresCatalogControlSessionDriver(control.pool) });
      await openPreparedHostTestRuntime(target.drizzle);
      try { await Effect.runPromise(witness(fixture, session, "host", makePostgresRelationalSession(target), key => Effect.gen(function* () {
        const lockAddress = JSON.stringify(["flarex.commerce.request", fixture.authority.scopeId, key]);
        for (let attempt = 0; attempt < 30; attempt++) {
          const observed = yield* Effect.tryPromise({ try: () => target.query<{ blocked: boolean }>(`select exists (
            select 1 from pg_locks where locktype = 'advisory' and not granted and objsubid = 1
              and classid::bigint = ((hashtextextended($1, 0) >> 32) & 4294967295)
              and objid::bigint = (hashtextextended($1, 0) & 4294967295)
          ) as blocked`, [lockAddress]), catch: cause => new Error("Advisory wait query", { cause }) });
          if (observed.rows[0]?.blocked) return;
          yield* Effect.sleep("10 millis");
        }
        return yield* Effect.fail(new Error("Duplicate Commerce request did not reach the advisory wait"));
      }))); }
      finally { await closePreparedHostTestRuntime(target.drizzle); }
    });
  });
});

const witness = Effect.fn("LogicalSchemaBinding.nativeComposition")(function* <Persistence extends PGliteFlarexPersistence | PostgresFlarexPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, session: CatalogControlSessionStarter, mode: "participant" | "host" = "participant",
  suppliedDataSession?: RelationalSession,
  waitForAdvisoryWaiter?: (key: string) => Effect.Effect<void, Error>,
) {
  const compose = makeSchemaComposer({ deploymentId: fixture.deploymentId, authority: fixture.authority,
    applicationAnalyses: makeApplicationAnalysisRepository(fixture.target.drizzle), medusaModules: ["currency"] });
  const prepared = yield* compose({ applicationCandidateId: fixture.active.basis.candidateId,
    payloadCollections: [{ slug: "news", fields: [{ name: "title", type: "text", required: true, unique: true }] }],
    payloadViews: [], extensions: [] });
  const definition = yield* compileCurrencyDefinition();
  const initialization = yield* currencyInitialization();
  const codes = initialization.rows.slice(0, 3).map(row => row.code);
  const selected = { fields: ["code"], limit: 10 };
  const withDeleted = { ...selected, filters: { softDeletable: { withDeleted: true } } };
  const cases = [
    { input: { options: selected }, codes: [codes[0], codes[2]], total: 2 },
    { input: { options: { ...withDeleted, orderBy: { code: "DESC" }, offset: 1, limit: 1 } }, codes: [codes[1]], total: 3 },
    { input: { where: { code: [codes[0], codes[1]] }, options: selected }, codes: [codes[0]], total: 1 },
    { input: { where: { $or: [{ code: [codes[0], codes[1]] }, { code: [codes[1], codes[2]] }] }, options: withDeleted }, codes, total: 3 },
    { input: { where: { $and: [{ code: [codes[0], codes[1]] }, { $or: [{ code: [codes[1], codes[2]] }] }] }, options: withDeleted }, codes: [codes[1]], total: 1 },
    { input: { where: { $or: [] }, options: selected }, codes: [], total: 0 },
    { input: { where: { $or: [{}, { code: codes[1] }] }, options: selected }, codes: [codes[0], codes[2]], total: 2 },
    { input: { options: { ...withDeleted, limit: 0 } }, codes: [], total: 3 },
  ];
  const reads = yield* Effect.forEach(cases, entry => Effect.fromResult(currencyReadPlan(entry.input)).pipe(
    Effect.map(plan => ({ query: plan.query, expected: { docs: entry.codes.map(code => ({ code })), total: entry.total } }))));
  yield* logicalSchemaBindingScenario(fixture, session, prepared, {
    source: { sourceKey: "medusa.currency", writeProfile: "medusa.currency", schema: definition.schema, evidence: definition.provenance },
    rows: initialization.rows, reads,
    ...(mode === "host" ? { hostProof: (bindingTarget, schemaVersionId) => Effect.gen(function* () {
      const initializationDescriptor = { stepId: initialization.stepId, datasetSha256: initialization.datasetSha256,
        expectedRowCount: initialization.expectedRowCount };
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let invocations = 0;
      const heldCurrencyWrite = defineCommerceCommand("heldCurrencyWrite", "write", (context, args) => Effect.gen(function* () {
        invocations++;
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return yield* context.nested(currencyAnnouncementWrite, args);
      }));
      const dataSession = suppliedDataSession ?? issueRelationalSession(fixture.target.drizzle, (_profile, work) => runEffectTransaction(
          callback => fixture.target.drizzle.transaction(callback), "Logical Currency host transaction", work,
          cause => new RelationalSessionError({ reason: "resourceFailure", cause })));
      const hostInput = {
        hostRuntime: preparedHostTestRuntime(fixture.target.drizzle), database: fixture.target.drizzle,
        session: dataSession, target: bindingTarget, deploymentId: fixture.deploymentId,
        authority: fixture.authorityPorts, application: fixture.activation,
        identityAndAccessPolicy: { profile: "logical-currency-test" },
        logicalStorage: { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
          unique: fixture.uniqueConstraintEligibility, schemaVersionId,
          source: { sourceKey: "medusa.currency", writeProfile: "medusa.currency", schema: definition.schema, evidence: definition.provenance },
          initialization: initializationDescriptor },
        commands: [...Object.values(currencyCommands), currencyAnnouncementWrite, heldCurrencyWrite],
      };
      yield* Effect.scoped(Effect.gen(function* () {
        const limited = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 1024 });
        expect(yield* Effect.result(makeCommerceHost({ ...hostInput, hostRuntime: limited })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "capacityExceeded" } } });
        const replacement = yield* retainPreparedHost(limited, Effect.succeed(Object.freeze({ ready: true })));
        expect(yield* replacement.use(value => Effect.succeed(value.ready))).toBe(true);
        yield* replacement.close;
      }));
      yield* Effect.acquireUseRelease(makeCommerceHost(hostInput), host => Effect.gen(function* () {
        // Retained admission and receipts must use the construction snapshot.
        const firstCode = codes[0];
        if (typeof firstCode !== "string") throw new Error("Missing seeded Currency code");
        initializationDescriptor.stepId = "changed-after-construction";
        initializationDescriptor.datasetSha256 = "0".repeat(64);
        initializationDescriptor.expectedRowCount = 0;
        expect(yield* Effect.result(host.read(currencyCommands.retrieve, { code: firstCode })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "seedRequired" } });
        const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(fixture.authority.scopeId));
        const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement,
          cause => new Error("Logical Currency host inventory", { cause }));
        const beforeRows = yield* query(fixture.target.drizzle.select().from(fxAppRowCurrent));
        const beforeOutcomes = yield* query(fixture.target.drizzle.select().from(fxSystemIdempotency));
        yield* Effect.acquireUseRelease(query<unknown>(fixture.target.drizzle.insert(fxSystemLogicalSourceInitializations).values({
          scopeUuid: scope.scopeUuid, sourceKey: "medusa.currency", sourceSha256: "0".repeat(64),
          stepId: initialization.stepId, contractSha256: "0".repeat(64), datasetSha256: "0".repeat(64),
          rowCount: 123, commitSeq: CommitSeqSchema.make(1n),
        })), () => Effect.gen(function* () {
          expect(yield* Effect.result(host.initialize(initialization.rows)))
            .toMatchObject({ _tag: "Failure", failure: { reason: "statementFailure" } });
          expect(yield* query(fixture.target.drizzle.select().from(fxAppRowCurrent))).toEqual(beforeRows);
          expect(yield* query(fixture.target.drizzle.select().from(fxSystemIdempotency))).toEqual(beforeOutcomes);
        }), () => query<unknown>(fixture.target.drizzle.delete(fxSystemLogicalSourceInitializations))
          .pipe(Effect.asVoid, Effect.orDie));
        expect(yield* host.initialize(initialization.rows)).toEqual({ rowCount: 123 });
        expect(yield* host.initialize(initialization.rows)).toEqual({ rowCount: 123 });
        expect(yield* host.read(currencyCommands.retrieve, { code: firstCode })).toMatchObject({ code: firstCode });
        const native = makeCurrencyService(host);
        const nativeList = yield* Effect.tryPromise({ try: () => native.listCurrencies({ code: [firstCode] }, { take: 1 }),
          catch: cause => new Error("Logical Currency native list", { cause }) });
        expect(nativeList).toMatchObject([{ code: firstCode }]);
        const nativeCount = yield* Effect.tryPromise({ try: () => native.listAndCountCurrencies({ code: [firstCode] }, { take: 1 }),
          catch: cause => new Error("Logical Currency native count", { cause }) });
        expect(nativeCount).toMatchObject([[{ code: firstCode }], 1]);
        const key = host.newRequestKey();
        const request = { code: "zzz", name: "Logical Currency", symbol: "Z", symbol_native: "Z" };
        const created = yield* host.run(key, currencyAnnouncementWrite, request);
        expect(created).toMatchObject({ code: "zzz", name: "Logical Currency" });
        expect(yield* host.run(key, currencyAnnouncementWrite, request)).toEqual(created);
        if (waitForAdvisoryWaiter !== undefined) {
          const duplicateKey = host.newRequestKey();
          const duplicateRequest = { code: "xyy", name: "Concurrent logical Currency", symbol: "Y", symbol_native: "Y" };
          yield* Effect.scoped(Effect.gen(function* () {
            const first = yield* Effect.forkScoped(host.run(duplicateKey, heldCurrencyWrite, duplicateRequest));
            yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"));
            const second = yield* Effect.forkScoped(host.run(duplicateKey, heldCurrencyWrite, duplicateRequest));
            yield* waitForAdvisoryWaiter(duplicateKey);
            yield* Deferred.succeed(release, undefined);
            const results = yield* Effect.all([Fiber.join(first), Fiber.join(second)], { concurrency: 2 });
            expect(results[1]).toEqual(results[0]);
            expect(invocations).toBe(1);
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("10 seconds")));
        }
        const receipts = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemLogicalSourceInitializations),
          cause => new Error("Logical initialization receipt read", { cause }));
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toMatchObject({ sourceKey: "medusa.currency", rowCount: 123 });
      }), host => host.close);
      const currencyParticipant = defineAtomicCommerceParticipant("currency");
      const pair = defineAtomicCommerceCommand("logicalCurrencyPair", ctx => Effect.gen(function* () {
        yield* ctx.call(currencyParticipant, currencyAnnouncementWrite,
          { code: "lpa", name: "Logical pair A", symbol: "A", symbol_native: "A" });
        yield* ctx.call(currencyParticipant, currencyAnnouncementWrite,
          { code: "lpb", name: "Logical pair B", symbol: "B", symbol_native: "B" });
        return yield* ctx.call(currencyParticipant, currencyCommands.retrieve, { code: "lpa" });
      }));
      const lateFailure = defineAtomicCommerceCommand("logicalCurrencyLateFailure", ctx => Effect.gen(function* () {
        yield* ctx.call(currencyParticipant, currencyAnnouncementWrite,
          { code: "lpc", name: "Must roll back", symbol: "C", symbol_native: "C" });
        return yield* ctx.refuse(commerceError("invalidInput"));
      }));
      const contract = defineCommerceEventContract({ name: "currency.logical-proof", revision: "a".repeat(64), internal: false,
        decode: value => typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
          ? Effect.succeed({ code: value.code }) : Effect.fail(commerceError("invalidInput")) });
      const announce = defineAtomicCommerceCommand("logicalCurrencyEvent", ctx => Effect.gen(function* () {
        const value = yield* ctx.call(currencyParticipant, currencyCommands.retrieve, { code: "lpa" });
        yield* ctx.emit(contract, { code: "lpa" });
        return value;
      }));
      const manyEvents = defineAtomicCommerceCommand("logicalCurrencyManyEvents", ctx => Effect.gen(function* () {
        for (let index = 0; index < 257; index++) yield* ctx.emit(contract, { code: `event-${index}` });
        return null;
      }));
      const tooManyEvents = defineAtomicCommerceCommand("logicalCurrencyTooManyEvents", ctx => Effect.gen(function* () {
        for (let index = 0; index < 258; index++) yield* ctx.emit(contract, { code: `overflow-${index}` });
        return null;
      }));
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput,
        participants: [{ participant: currencyParticipant,
          logicalStorage: { ...hostInput.logicalStorage, initialization: {
            stepId: initialization.stepId, datasetSha256: initialization.datasetSha256,
            expectedRowCount: initialization.expectedRowCount } },
          commands: [currencyAnnouncementWrite, currencyCommands.retrieve] }],
        commands: [pair, lateFailure, announce, manyEvents, tooManyEvents],
        requestCallLimit: 512, requestEventLimit: 257,
        events: { producerRevision: "a".repeat(64), contracts: [contract],
          subscribers: [{ id: "logical-currency", revision: "a".repeat(64) }],
          validate: events => events.length <= 1 || events.length === 257
            ? Effect.void : Effect.fail(commerceError("unadmittedEvent")) },
      }), atomic => Effect.gen(function* () {
        const beforeRows = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Atomic logical Currency before rows", { cause }));
        const beforeOutcomes = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemIdempotency),
          cause => new Error("Atomic logical Currency before outcomes", { cause }));
        const key = atomic.newRequestKey();
        const value = yield* atomic.run(key, pair, null);
        expect(value).toMatchObject({ code: "lpa", name: "Logical pair A" });
        expect(yield* atomic.run(key, pair, null)).toEqual(value);
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Atomic logical Currency rows", { cause }))).toHaveLength(beforeRows.length + 2);
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemIdempotency),
          cause => new Error("Atomic logical Currency outcomes", { cause }))).toHaveLength(beforeOutcomes.length + 1);
        const beforeEvents = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommitEvents),
          cause => new Error("Atomic logical Currency before events", { cause }));
        const eventKey = atomic.newRequestKey();
        expect(yield* atomic.run(eventKey, announce, null)).toMatchObject({ code: "lpa" });
        expect(yield* atomic.run(eventKey, announce, null)).toMatchObject({ code: "lpa" });
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommitEvents),
          cause => new Error("Atomic logical Currency events", { cause }))).toHaveLength(beforeEvents.length + 1);
        const manyKey = atomic.newRequestKey();
        expect(yield* atomic.run(manyKey, manyEvents, null)).toBeNull();
        const publishedEvents = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommitEvents),
          cause => new Error("Atomic logical Currency many events", { cause }));
        const batch = publishedEvents.filter(row => row.envelope.group === manyKey).toSorted((a, b) => a.eventOrdinal - b.eventOrdinal);
        expect(batch).toHaveLength(257);
        expect(batch.map(row => row.eventOrdinal)).toEqual(Array.from({ length: 257 }, (_, index) => index));
        expect(batch.map(row => row.envelope.message)).toEqual(Array.from({ length: 257 }, (_, index) => ({ code: `event-${index}` })));
        const batchCommit = batch[0]?.commitSeq;
        if (batchCommit === undefined) throw new Error("Missing many-event commit");
        const headers = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommits),
          cause => new Error("Atomic logical Currency many-event header", { cause }));
        expect(headers.find(row => row.commitSeq === batchCommit)).toMatchObject({
          eventCount: 257, eventSha256: yield* commitEventsDigest(batch.map(row => row.envelope)),
        });
        const deliveries = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommitEventDeliveries),
          cause => new Error("Atomic logical Currency many-event deliveries", { cause }));
        expect(deliveries.filter(row => row.commitSeq === batchCommit)).toHaveLength(257);
        expect(yield* atomic.run(manyKey, manyEvents, null)).toBeNull();
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommitEvents),
          cause => new Error("Atomic logical Currency replay events", { cause }))).toHaveLength(publishedEvents.length);
        expect(yield* Effect.result(atomic.run(atomic.newRequestKey(), tooManyEvents, null)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommitEvents),
          cause => new Error("Atomic logical Currency overflow events", { cause }))).toHaveLength(publishedEvents.length);
        expect(yield* Effect.result(atomic.run(atomic.newRequestKey(), lateFailure, null)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Atomic logical Currency rollback rows", { cause }))).toHaveLength(beforeRows.length + 2);
        const consumed: unknown[] = [];
        let familyReads = 0, deliveryPages = 0;
        const pumpInput = { ...hostInput, observeQuery: (query: { readonly name: string }) => {
          if (query.name === "eventFamily") familyReads++;
          if (query.name === "deliveryPage") deliveryPages++;
        } };
        const handlers = [{ id: "logical-currency", revision: "a".repeat(64),
          handle: (message: { readonly envelope: { readonly message: unknown } }) => Effect.sync(() => { consumed.push(message.envelope.message); }) }];
        let pump = yield* makeCommitEventPump(pumpInput, handlers);
        let cursor = batchCommit - 1n;
        for (let pass = 0; pass < 8; pass++) {
          const progress = yield* pump.runNext(cursor);
          cursor = progress.cursor;
          if (progress.done) break;
          if (pass === 0) pump = yield* makeCommitEventPump(pumpInput, handlers);
          if (pass === 7) throw new Error("Many-event pump did not finish");
        }
        expect(consumed).toEqual(Array.from({ length: 257 }, (_, index) => ({ code: `event-${index}` })));
        expect(familyReads).toBe(2);
        expect(deliveryPages).toBeLessThanOrEqual(35);
        expect(yield* pump.runNext(batchCommit)).toMatchObject({ done: true, delivered: 0 });
        const settled = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommitEventDeliveries),
          cause => new Error("Atomic logical Currency delivered events", { cause }));
        expect(settled.filter(row => row.commitSeq === batchCommit && row.state === "delivered")).toHaveLength(257);
      }), atomic => atomic.close);
      let loseCommitAcknowledgement = true;
      let recoverExecutions = 0;
      const uncertainSession = issueRelationalSession(fixture.target.drizzle, (profile, work) =>
        runRelationalSession(dataSession, profile, work).pipe(
          Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
          Effect.flatMap(value => {
          if (!loseCommitAcknowledgement || profile !== "command") return Effect.succeed(value);
          loseCommitAcknowledgement = false;
          return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain",
            cause: new Error("Lost logical Currency COMMIT acknowledgement") }));
          })));
      const recoverWrite = defineCommerceCommand("recoverLogicalCurrency", "write", (context, args) => Effect.gen(function* () {
        recoverExecutions++;
        return yield* context.nested(currencyAnnouncementWrite, args);
      }));
      yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, session: uncertainSession,
        logicalStorage: { ...hostInput.logicalStorage, initialization: {
          stepId: initialization.stepId, datasetSha256: initialization.datasetSha256,
          expectedRowCount: initialization.expectedRowCount } },
        commands: [currencyAnnouncementWrite, recoverWrite],
      }), recovered => Effect.gen(function* () {
        const before = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Logical Currency recovery inventory", { cause }));
        const key = recovered.newRequestKey();
        const request = { code: "qyy", name: "Recovered logical Currency", symbol: "Q", symbol_native: "Q" };
        const result = yield* recovered.run(key, recoverWrite, request);
        expect(yield* recovered.run(key, recoverWrite, request)).toEqual(result);
        expect(recoverExecutions).toBe(1);
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Logical Currency recovery rows", { cause }))).toHaveLength(before.length + 1);
      }), recovered => recovered.close);
    }) } : {}),
    ...(mode === "host" ? { mixedProof: (bindingTarget, schemaVersionId, frame, head) => Effect.gen(function* () {
      const targetSnapshot = frameworkSchemaTargetSnapshot(bindingTarget);
      if (targetSnapshot === undefined) throw new Error("Missing mixed Commerce target");
      const preparedProduct = yield* prepareNeutralCommerceProfile(["product"], "mixed-currency-product")(
        fixture.deploymentId, { physicalLocator: targetSnapshot.physicalLocator, targetNamespace: targetSnapshot.namespace });
      const productDescriptor = yield* requireCommerceProfile(preparedProduct.profile);
      const repository = "pool" in fixture.control
        ? Result.getOrThrow(makeFrameworkSchemaArtifactRepository({ controlDb: fixture.control.drizzle,
          controlSessionStarter: makeCatalogControlSessionStarter({ controlDb: fixture.control.drizzle,
            driver: makePostgresCatalogControlSessionDriver(fixture.control.pool) }),
          readTimeoutMilliseconds: 10000, attemptTimeoutMilliseconds: 10000, recoveryTimeoutMilliseconds: 10000,
          lockTimeoutMilliseconds: 2000 }))
        : makePGliteFrameworkSchemaArtifactAdmissionFixture(fixture.control).repository;
      yield* admitFrameworkSchemaArtifactEffect(repository,
        Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(productDescriptor.artifact)));
      const migrationTarget = yield* Effect.tryPromise({ try: () => makeFrameworkMigrationFixtureTarget(fixture.target, bindingTarget),
        catch: cause => new Error("Mixed Commerce fixture target", { cause }) });
      const installer = Result.getOrThrow(makeFrameworkInstaller({ target: migrationTarget, artifactRepository: repository,
        policy: { leaseDurationMilliseconds: 120000, lockTimeoutMilliseconds: 5000, statementTimeoutMilliseconds: 30000,
          runTimeoutMilliseconds: 120000, maximumStepsPerCall: 128 } }));
      const ready = yield* installer.installFresh({ artifactIdentity: productDescriptor.artifact.identity,
        commerceProfile: preparedProduct.profile, attemptId: "mixed-product-install", leaseOwnerId: "mixed-proof" });
      if (ready.kind !== "ready") throw new Error(`Product installation incomplete: ${ready.kind}`);
      const productInstallation = installationBindingReference(ready.availability);
      const productBinding = yield* makeCommerceBinding(ready.availability, [preparedProduct.profile]);
      const bindings = yield* makeDataBindingHost({ database: fixture.target.drizzle, target: bindingTarget,
        deploymentId: fixture.deploymentId, authority: fixture.authorityPorts, application: fixture.activation,
        logicalStorage: { controlDb: fixture.control.drizzle, schemaVersionId, unique: fixture.uniqueConstraintEligibility },
        commerceProfiles: [preparedProduct.profile] });
      const mixedFrame = { ...frame, commerce: [productBinding] };
      const candidate = yield* bindings.prepare(mixedFrame);
      yield* bindings.activate(dataBindingActivationRequest(fixture.authority.scopeId, fixture.authority.storageGeneration,
        "mixed-logical-physical-activation", candidate.sha256, head));
      const productParticipant = defineAtomicCommerceParticipant("product");
      const currencyParticipant = defineAtomicCommerceParticipant("currency");
      const writeProduct = defineCommerceCommand("mixedProductWrite", "write", (ctx, value) => Effect.gen(function* () {
        const table = yield* ctx.table("product");
        return yield* table.write(ctx.manager, "insert", [{ id: value, value: 1 }]);
      }));
      const refuseProduct = defineCommerceCommand("mixedProductRefuse", "write", ctx =>
        ctx.refuse(commerceError("receiptMismatch")));
      const defect = new Error("mixed Product defect");
      const dieProduct = defineCommerceCommand("mixedProductDie", "write", () => Effect.die(defect));
      const mixed = defineAtomicCommerceCommand("mixedCurrencyProduct", ctx => Effect.gen(function* () {
        const currency = yield* ctx.call(currencyParticipant, currencyAnnouncementWrite,
          { code: "mxp", name: "Mixed Currency", symbol: "M", symbol_native: "M" });
        const product = yield* ctx.call(productParticipant, writeProduct, "mixed-product");
        const reread = yield* ctx.call(currencyParticipant, currencyCommands.retrieve, { code: "mxp" });
        return { currency, product, reread };
      }));
      const mixedFailure = defineAtomicCommerceCommand("mixedCurrencyProductFailure", ctx => Effect.gen(function* () {
        yield* ctx.call(currencyParticipant, currencyAnnouncementWrite,
          { code: "mxq", name: "Rolled back Currency", symbol: "Q", symbol_native: "Q" });
        yield* ctx.call(productParticipant, writeProduct, "rolled-product");
        return yield* ctx.refuse(commerceError("invalidInput"));
      }));
      const productOnly = defineAtomicCommerceCommand("mixedProductOnly", ctx =>
        ctx.call(productParticipant, writeProduct, "product-only"));
      const swallowedRefusal = defineAtomicCommerceCommand("mixedSwallowedRefusal", ctx =>
        ctx.call(productParticipant, writeProduct, "swallowed-refusal").pipe(
          Effect.andThen(ctx.call(productParticipant, refuseProduct, null)),
          Effect.catchTag("CommerceTransactionError", () => Effect.succeed(null))));
      const swallowedDefect = defineAtomicCommerceCommand("mixedSwallowedDefect", ctx =>
        ctx.call(productParticipant, writeProduct, "swallowed-defect").pipe(
          Effect.andThen(ctx.call(productParticipant, dieProduct, null)),
          Effect.catchCause(() => Effect.succeed(null))));
      const mixedLate = defineAtomicCommerceCommand("mixedAfterLoweringFailure", ctx => Effect.gen(function* () {
        yield* ctx.call(currencyParticipant, currencyAnnouncementWrite,
          { code: "mxr", name: "Late Currency", symbol: "R", symbol_native: "R" });
        return yield* ctx.call(productParticipant, writeProduct, "late-product");
      }));
      const mixedEventContract = defineCommerceEventContract({ name: "mixed.event-only", revision: "a".repeat(64),
        internal: false, decode: () => Effect.succeed({ kind: "event-only" }) });
      const eventOnly = defineAtomicCommerceCommand("mixedEventOnly", ctx =>
        ctx.emit(mixedEventContract, { kind: "event-only" }).pipe(Effect.as(null)));
      const productTable = productDescriptor.layout.frame.tables[0];
      const productId = productTable?.columns.find(column => column.identity.columnId === "id");
      if (productTable === undefined || productId === undefined) throw new Error("Missing physical Product table");
      const schemaName = productDescriptor.layout.targetNamespace.frame.schemaName;
      const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
      const readProduct = (id: string) => Effect.tryPromise({ try: () => fixture.target.query<{ id: string }>(
        `select ${quote(productId.name)} as id from ${quote(schemaName)}.${quote(productTable.name)} where ${quote(productId.name)} = $1`, [id]),
        catch: cause => new Error("Mixed Commerce physical Product inventory", { cause }) });
      const session = suppliedDataSession ?? issueRelationalSession(fixture.target.drizzle, (_profile, work) => runEffectTransaction(
        callback => fixture.target.drizzle.transaction(callback), "Mixed Commerce transaction", work,
        cause => new RelationalSessionError({ reason: "resourceFailure", cause })));
      const participants = [
        { participant: currencyParticipant, logicalStorage: { ports: { controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts }, unique: fixture.uniqueConstraintEligibility, schemaVersionId,
          source: { sourceKey: "medusa.currency", writeProfile: "medusa.currency", schema: definition.schema,
            evidence: definition.provenance }, initialization: { stepId: initialization.stepId,
            datasetSha256: initialization.datasetSha256, expectedRowCount: initialization.expectedRowCount } },
          commands: [currencyAnnouncementWrite, currencyCommands.retrieve] },
        { participant: productParticipant, profile: preparedProduct.profile, installation: productInstallation,
          commands: [writeProduct, refuseProduct, dieProduct], validate: () => Effect.void },
      ] satisfies AtomicCommerceHostInput<unknown>["participants"];
      const eventPolicy = { producerRevision: "a".repeat(64), contracts: [mixedEventContract],
        subscribers: [{ id: "mixed-proof", revision: "a".repeat(64) }],
        validate: (events: Parameters<NonNullable<AtomicCommerceHostInput<unknown>["events"]>["validate"]>[0]) =>
          events.length <= 1 ? Effect.void : Effect.fail(commerceError("unadmittedEvent")) };
      const mixedInput = { hostRuntime: preparedHostTestRuntime(fixture.target.drizzle),
        database: fixture.target.drizzle, session, target: bindingTarget, deploymentId: fixture.deploymentId,
        authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "mixed-proof" },
         participants, commands: [mixed, mixedFailure, productOnly, swallowedRefusal, swallowedDefect,
           eventOnly, mixedLate], events: eventPolicy,
      } satisfies AtomicCommerceHostInput<unknown>;
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost(mixedInput), host => Effect.gen(function* () {
        const beforeRows = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Mixed Commerce before logical rows", { cause }));
        const beforeOutcomes = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemIdempotency),
          cause => new Error("Mixed Commerce before outcomes", { cause }));
        const key = host.newRequestKey();
        const value = yield* host.run(key, mixed, null);
        expect(value).toMatchObject({ currency: { code: "mxp" }, reread: { code: "mxp" },
          product: [{ id: "mixed-product", value: 1 }] });
        expect(yield* host.run(key, mixed, null)).toEqual(value);
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Mixed Commerce logical rows", { cause }))).toHaveLength(beforeRows.length + 1);
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemIdempotency),
          cause => new Error("Mixed Commerce outcomes", { cause }))).toHaveLength(beforeOutcomes.length + 1);
        expect((yield* readProduct("mixed-product")).rows).toEqual([{ id: "mixed-product" }]);
        expect(yield* Effect.result(host.run(host.newRequestKey(), mixedFailure, null)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Mixed Commerce rollback logical rows", { cause }))).toHaveLength(beforeRows.length + 1);
        expect((yield* readProduct("rolled-product")).rows).toEqual([]);
        const productOnlyKey = host.newRequestKey();
        expect(yield* host.run(productOnlyKey, productOnly, null)).toMatchObject([{ id: "product-only" }]);
        expect(yield* host.run(productOnlyKey, productOnly, null)).toMatchObject([{ id: "product-only" }]);
        expect((yield* readProduct("product-only")).rows).toEqual([{ id: "product-only" }]);
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Mixed Commerce unused Currency rows", { cause }))).toHaveLength(beforeRows.length + 1);
        const beforeSwallowedOutcomes = yield* runDrizzleStatementEffect(
          fixture.target.drizzle.select().from(fxSystemIdempotency),
          cause => new Error("Mixed Commerce before swallowed failures", { cause }));
        const refused = yield* Effect.exit(host.run(host.newRequestKey(), swallowedRefusal, null));
        expect(Exit.isFailure(refused)).toBe(true);
        if (Exit.isFailure(refused)) expect(refused.cause.reasons.some(reason =>
          Cause.isFailReason(reason) && reason.error.reason === "receiptMismatch")).toBe(true);
        const died = yield* Effect.exit(host.run(host.newRequestKey(), swallowedDefect, null));
        expect(Exit.isFailure(died)).toBe(true);
        if (Exit.isFailure(died)) expect(died.cause.reasons.some(reason =>
          Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
        expect((yield* readProduct("swallowed-refusal")).rows).toEqual([]);
        expect((yield* readProduct("swallowed-defect")).rows).toEqual([]);
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemIdempotency),
          cause => new Error("Mixed Commerce swallowed outcomes", { cause }))).toHaveLength(beforeSwallowedOutcomes.length);
        const beforeEvents = yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommitEvents),
          cause => new Error("Mixed Commerce before events", { cause }));
        const eventKey = host.newRequestKey();
        expect(yield* host.run(eventKey, eventOnly, null)).toBeNull();
        expect(yield* host.run(eventKey, eventOnly, null)).toBeNull();
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxSystemCommitEvents),
          cause => new Error("Mixed Commerce event-only publication", { cause }))).toHaveLength(beforeEvents.length + 1);
        let reachedLatePublication = false;
        yield* Effect.acquireUseRelease(Effect.sync(() =>
          vi.spyOn(scopePublication, "advanceScopePublicationClock").mockImplementationOnce(async () => {
            reachedLatePublication = true;
            throw new ScopePublicationSqlFailure({ operation: "advanceScopeClock",
              cause: new Error("Injected after mixed row, fact and outcome publication") });
          })), () => Effect.gen(function* () {
          expect(yield* Effect.result(host.run(host.newRequestKey(), mixedLate, null)))
            .toMatchObject({ _tag: "Failure", failure: { reason: "statementFailure" } });
        }), advance => Effect.sync(() => advance.mockRestore()));
        expect(reachedLatePublication).toBe(true);
        expect(yield* runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowCurrent),
          cause => new Error("Mixed Commerce late logical rollback", { cause }))).toHaveLength(beforeRows.length + 1);
        expect((yield* readProduct("late-product")).rows).toEqual([]);
      }), host => host.close);
      const mutableParticipants = [...participants];
      const mutableContracts = [mixedEventContract];
      const metadata = fixture.authorityPorts.scopeMetadata;
      const original = metadata.getScopeMetadataByDeploymentId.bind(metadata);
      yield* Effect.acquireUseRelease(Effect.sync(() =>
        vi.spyOn(metadata, "getScopeMetadataByDeploymentId").mockImplementationOnce(async deploymentId => {
          mutableParticipants.splice(0);
          mutableContracts.splice(0);
          return original(deploymentId);
        })), () => Effect.acquireUseRelease(
        makeAtomicCommerceHost({ ...mixedInput, participants: mutableParticipants,
          commands: [eventOnly], events: { ...eventPolicy, contracts: mutableContracts } }),
        retained => Effect.gen(function* () {
          expect(mutableParticipants).toHaveLength(0);
          expect(mutableContracts).toHaveLength(0);
          const key = retained.newRequestKey();
          expect(yield* retained.run(key, eventOnly, null)).toBeNull();
          expect(yield* retained.run(key, eventOnly, null)).toBeNull();
        }), retained => retained.close), lookup => Effect.sync(() => lookup.mockRestore()));
    }) } : {}),
    verify: ctx => Effect.gen(function* () {
      const activeByName = { order: { column: "code", direction: "asc" }, predicate: { kind: "and", children: [
        { kind: "isNull", column: "deleted_at" }, { kind: "in", column: "name", values: ["Shared rows"] },
      ] } };
      expect(yield* ctx.store.find(ctx.manager, activeByName)).toMatchObject([{ code: "zzz", name: "Shared rows" }]);
      expect(yield* ctx.store.find(ctx.manager, { ...activeByName, predicate: { kind: "and", children: [
        { kind: "isNull", column: "deleted_at" }, { kind: "in", column: "name", values: ["No match"] },
      ] } })).toEqual([]);
      return yield* withCurrencyService(ctx, async ({ service, context }) => {
        expect(await service.retrieveCurrency("zzz", {}, context)).toMatchObject({ code: "zzz", name: "Shared rows",
          raw_rounding: { value: "1234567890123456.7890" }, deleted_at: null });
        expect(await service.listCurrencies({ code: ["yzz"] }, {}, context)).toEqual([]);
        return null;
      });
    }),
    concurrentExecute: (ctx, code) => withCurrencyService(ctx, async ({ internal, context }) => {
      await internal.upsert([{ code, name: `Concurrent ${code}`, symbol: "C", symbol_native: "C" }], context);
      return null;
    }),
    execute: (ctx, scenario) => withCurrencyService(ctx, async ({ internal, service, repository, context }) => {
      if (scenario === "missingUpdate" || scenario === "unknownUpdate") {
        await internal.upsert([{ code: "zzz", name: "Existing row", symbol: "Z", symbol_native: "Z" }], context);
        await expect(repository.update([
          { entity: { code: "zzz" }, update: { name: "Valid earlier entry" } },
          { entity: { code: "missing" }, update: scenario === "missingUpdate" ? { decimal_digits: 1.5 } : { unknown_column: "value" } },
        ], context)).rejects.toMatchObject({ reason: "invalidInput" });
        await expect(service.listCurrencies({}, {}, context)).rejects.toMatchObject({ reason: "rollbackOnly" });
        return null;
      }
      if (scenario === "invalid") {
        await expect(repository.upsert([
          { code: "xxx", name: "Valid batch entry", symbol: "X", symbol_native: "X" },
          { code: "yyy", name: "Invalid integer", symbol: "Y", symbol_native: "Y", decimal_digits: 1.5 },
        ], context)).rejects.toMatchObject({ reason: "invalidInput" });
        await expect(service.listCurrencies({}, {}, context)).rejects.toMatchObject({ reason: "rollbackOnly" });
        return null;
      }
      await internal.upsert([{ code: "zzz", name: "Shared rows", symbol: "Z", symbol_native: "Z" }], context);
      const created = await service.retrieveCurrency("zzz", {}, context);
      expect(created).toMatchObject({ code: "zzz", decimal_digits: 0, rounding: 0, raw_rounding: { value: "0", precision: 20 } });
      await internal.upsert([{ code: "zzz", rounding: "1234567890123456.789" }], context);
      expect(await service.retrieveCurrency("zzz", {}, context)).toMatchObject({ raw_rounding: { value: "1234567890123456.7890" } });
      await repository.softDelete({ code: "zzz" }, context);
      expect(await service.listCurrencies({ code: ["zzz"] }, {}, context)).toEqual([]);
      await repository.restore({ code: "zzz" }, context);
      expect(await service.listAndCountCurrencies({ code: ["zzz"] }, { take: 1 }, context)).toMatchObject([[{ code: "zzz" }], 1]);
      await internal.upsert([{ code: "yzz", name: "Removed pending row", symbol: "Y", symbol_native: "Y" }], context);
      await repository.delete({ code: "yzz" }, context);
      await internal.upsert([{ code: "yzz", name: "Reused native key", symbol: "Y", symbol_native: "Y" }], context);
      expect(await service.retrieveCurrency("yzz", {}, context)).toMatchObject({ name: "Reused native key" });
      await repository.delete({ code: "yzz" }, context);
      expect(await service.listCurrencies({ code: ["zzz", "yzz"] }, { select: ["code"] }, context)).toEqual([{ code: "zzz" }]);
      return null;
    }),
  });
});
