import { Clock, Effect, Exit, Scope } from "effect";
import { defineSchema, defineTable } from "../../../flarex/src/server";
import { v } from "../../../flarex/src/values";
import { prepareApplicationSchemaSource, type PreparedApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { compilePayloadCollections, type CompiledPayloadCollections } from "../../../payload-adapter/src/collections";
import type { PayloadHost, PayloadReadHost } from "../../../payload-adapter/src/runtime";
import { makePayloadConformanceRuntime, inspectPayloadRuntimeForTest } from "../../../payload-adapter/src/testing";
import type { PayloadConformanceRuntime } from "../../../payload-adapter/src/testing/conformance";
import { payloadPostsCollectionDefinition } from "../../../payload-adapter/src/testing/profiles";
import { makeCmsNativeBinding } from "../../../persistence-postgres/src/frameworks/cmsTransaction/nativeBinding";
import { getCmsCommand, type CmsCommand } from "../../../persistence-postgres/src/frameworks/cmsTransaction/commands";
import { getCommerceCommand, type CommerceCommand, type CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceNativeHost, commerceNativeRegistrations } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeHost";
import { makeCurrencyAnnouncementHost } from "../../../persistence-postgres/src/frameworks/crossDomainCommand/host";
import type { CurrencyAnnouncementTestHooks } from "../../../persistence-postgres/src/frameworks/crossDomainCommand/testSupport";
import { openCoreDatabase } from "../../../persistence-postgres/src/core/database";
import type { CoreDatabase, CoreDatabaseOptions, CoreError, CoreNativeBinding, CoreNativeRootBinding } from "../../../persistence-postgres/src/core/api";
import { makeCoreNativeDefinition, type CoreNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import { makeCoreSchemaBundle, type CoreSchemaBundle } from "../../../persistence-postgres/src/core/schemaBundle";
import { CorePersistenceError, type CorePersistence, type CoreWriteBatch } from "../../../persistence-postgres/src/core/contracts";
import type { JsonObject } from "flarex-protocol";
import { makePreparedHostRuntime, type PreparedHostRuntime } from "../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { createCorePGliteFixture, createCorePostgresFixture,
  type CorePersistenceFixture, type CorePersistenceFixtureOptions } from "../../../persistence-postgres/test/core/fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import { coreNativeTestBudget } from "../../../persistence-postgres/test/core/nativeTestBudget";
import { readCoreNativeFixtureInventory, type CoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { makePayloadPreferenceNativeDefinition, payloadPreferenceCleanupCommand } from "../../../persistence-postgres/src/frameworks/payloadPreferences/nativeSource";
import { makePayloadPreferenceNativeCleanup, type PayloadPreferenceNativeCleanup } from "../../../persistence-postgres/src/frameworks/payloadPreferences/nativeCleanup";
import type { CmsTransactionError } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { postgresUrl } from "../../../persistence-postgres/test/support/postgresHelpers";
import { compileCurrencyCoreDefinition } from "../../src/modules/currency/schema";
import { currencyInitialization } from "../../src/modules/currency/contract";
import { currencyCommands, currencyAnnouncementWrite, makeCurrencyService, type CurrencyReads } from "../../src/modules/currency/service";

type Announcement = Effect.Success<ReturnType<typeof makeCurrencyAnnouncementHost>>;
export interface CoreCurrencyFixtureOptions {
  readonly commands?: readonly CommerceCommand[];
  readonly includeUserNameIndex?: boolean;
  readonly initialize?: boolean;
  readonly compiledPayload?: CompiledPayloadCollections;
  readonly application?: PreparedApplicationSchemaSource;
  readonly applicationTable?: string;
  readonly allowPreferenceTransition?: boolean;
  readonly wrapRuntimeDriver?: CorePersistenceFixtureOptions["wrapRuntimeDriver"];
  readonly observeWrite?: (batch: CoreWriteBatch) => void;
}
export interface CoreCurrencyFixture {
  readonly database: CoreDatabase;
  readonly persistence: CorePersistence;
  readonly physical: CorePersistenceFixture;
  readonly host: CommerceHost;
  readonly service: CurrencyReads;
  readonly payload: PayloadConformanceRuntime;
  readonly payloadWriter: PayloadHost;
  readonly payloadReader: PayloadReadHost;
  readonly compiledPayload: CompiledPayloadCollections;
  readonly cleanupBundle: CoreSchemaBundle | undefined;
  readonly preferenceDefinition: CoreNativeDefinition | undefined;
  readonly hostRuntime: PreparedHostRuntime;
  readonly currencyBinding: CoreNativeBinding;
  readonly payloadBinding: CoreNativeBinding;
  readonly rootBinding: CoreNativeRootBinding;
  readonly initialization: Effect.Success<ReturnType<typeof currencyInitialization>>;
  readonly run: <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Promise<A>;
  readonly announcement: (input?: Readonly<{ currencyCommand?: CommerceCommand; cmsCommand?: CmsCommand;
    hooks?: Pick<CurrencyAnnouncementTestHooks, "beforeApplication" | "afterSteps"> }>) =>
    Effect.Effect<Announcement, Effect.Error<ReturnType<typeof makeCurrencyAnnouncementHost>>, Scope.Scope>;
  readonly inventory: () => Promise<CoreCurrencyInventory>;
  readonly activatePayloadLifecycle: () => Effect.Effect<void, CoreError | CmsTransactionError, Scope.Scope>;
  readonly seedPreferences: (rows: readonly JsonObject[]) => Promise<void>;
  /** Fixture maintenance only, confined to Currency; never supplied to a host. */
  readonly maintainCurrencyForInitialization: (input: Readonly<{ insert: readonly JsonObject[] }> | Readonly<{ delete: readonly string[] }>) => Promise<number>;
  readonly reopen: () => Promise<void>;
  readonly loseNextWriteAcknowledgement: () => void;
  readonly close: () => Promise<void>;
}
export type CoreCurrencyInventory = CoreNativeFixtureInventory;

/** The same five-table resource owner as existing Core/Payload tests. Sources
 * are genuinely compiled together before Core bootstrap; no old host is built. */
export async function createCoreCurrencyFixture(driver: "pglite" | "postgres", options: CoreCurrencyFixtureOptions = {}): Promise<CoreCurrencyFixture> {
  const fixtureOptions = options.wrapRuntimeDriver === undefined ? {} : { wrapRuntimeDriver: options.wrapRuntimeDriver };
  let physical: CorePersistenceFixture;
  if (driver === "pglite") physical = await createCorePGliteFixture(fixtureOptions);
  else {
    const provisioning = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
    if (postgresUrl === null || provisioning === undefined) throw new Error("Native Currency needs ordinary and provisioning PostgreSQL endpoints");
    physical = await createCorePostgresFixture({ ...fixtureOptions, connectionString: postgresUrl, provisioningConnectionString: provisioning });
  }
  let scope = await Effect.runPromise(Scope.make());
  const run = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(work));
  const target = { scopeUuid: "65000000-0000-4000-8000-000000000001", epochUuid: "65000000-0000-4000-8000-000000000002" };
  let loseAcknowledgement = false;
  const observed = (persistence: CorePersistence): CorePersistence => ({ ...persistence,
    write: (lease, batch) => persistence.write(lease, batch).pipe(Effect.andThen(() => {
      options.observeWrite?.(batch);
      if (!loseAcknowledgement) return Effect.void;
      loseAcknowledgement = false;
      return Effect.fail(new CorePersistenceError({ reason: "uncertainWrite" }));
    })),
  });
  let database: CoreDatabase;
  let persistence: CorePersistence;
  let host: CommerceHost;
  let service: CurrencyReads;
  let payload: PayloadConformanceRuntime;
  let payloadWriter: PayloadHost;
  let payloadReader: PayloadReadHost;
  let compiledPayload: CompiledPayloadCollections;
  let activatePayloadLifecycle: CoreCurrencyFixture["activatePayloadLifecycle"];
  let preferencesBinding: CoreNativeBinding | undefined;
  let preferenceDefinition: Effect.Success<ReturnType<typeof makePayloadPreferenceNativeDefinition>> | undefined;
  let expectedCleanupBundle: CoreSchemaBundle | undefined;
  let cleanupInstalled = false;
  let hostRuntime: PreparedHostRuntime;
  let currencyBinding: CoreNativeBinding;
  let payloadBinding: CoreNativeBinding;
  let rootBinding: CoreNativeRootBinding;
  let initialization: Effect.Success<ReturnType<typeof currencyInitialization>>;
  let announcement: CoreCurrencyFixture["announcement"];
  let closed = false;
  const commands = [...Object.values(currencyCommands), currencyAnnouncementWrite, ...(options.commands ?? [])];
  try {
    const connect = (selected: CorePersistence, install: boolean) => run(Effect.gen(function* () {
      persistence = selected;
      const users = defineTable({ name: v.string() });
      const application = options.application ?? (yield* prepareApplicationSchemaSource(defineSchema({ users: options.includeUserNameIndex === true
        ? users.index("by_name", ["name"]) : users })));
      const compiled = options.compiledPayload ?? (yield* compilePayloadCollections([payloadPostsCollectionDefinition()]));
      compiledPayload = compiled;
      const payloadDefinition = yield* makeCoreNativeDefinition({ ...target, source: compiled.sourceContract });
      const currencyDefinition = yield* compileCurrencyCoreDefinition(target);
      const originalBundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "application", definition: application },
        { kind: "native", definition: payloadDefinition }, { kind: "native", definition: currencyDefinition }] });
      preferenceDefinition = options.allowPreferenceTransition === true ? yield* makePayloadPreferenceNativeDefinition(target) : undefined;
      const cleanupBundle = preferenceDefinition === undefined ? undefined : yield* makeCoreSchemaBundle({ sources: [
        { kind: "application", definition: application }, { kind: "native", definition: payloadDefinition },
        { kind: "native", definition: currencyDefinition }, { kind: "native", definition: preferenceDefinition },
      ] });
      expectedCleanupBundle = cleanupBundle;
      const bundle = cleanupInstalled && cleanupBundle !== undefined ? cleanupBundle : originalBundle;
      const databaseOptions: CoreDatabaseOptions = { schemaBundles: cleanupBundle === undefined ? [originalBundle] : [originalBundle, cleanupBundle], schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
        now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
        randomBytes: (length: 16 | 32) => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 2 };
      database = yield* Effect.acquireRelease(openCoreDatabase(observed(selected), databaseOptions), value => value.close());
      if (install) {
        const proposal = yield* database.prepareSchema({ bundle });
        let ready = false;
        for (let step = 0; step < 512; step++) {
          const status = yield* database.schemaStatus(proposal);
          if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Native Currency schema failed: ${status.error}`));
          if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
            yield* database.activateSchema(proposal, { programs: [], bundle }); ready = true; break;
          }
          yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
        }
        if (!ready) return yield* Effect.die(new Error("Native Currency schema exceeded its fixture work budget"));
      }
      const registrations = yield* Effect.fromResult(commerceNativeRegistrations(commands));
      currencyBinding = yield* database.bindNative({ definition: currencyDefinition, commands: registrations });
      payload = yield* makePayloadConformanceRuntime(compiled.configuration.profile, compiled);
      const payloadCommands = Object.values(inspectPayloadRuntimeForTest(payload.runtime).commands).flatMap(token => {
        const command = getCmsCommand(token);
        return command === undefined ? [] : [{ name: command.name, mode: command.mode }];
      });
      hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
      const bindPayload = Effect.gen(function* () {
        payloadBinding = yield* database.bindNative({ definition: payloadDefinition, commands: payloadCommands });
        let preferences: PayloadPreferenceNativeCleanup | undefined;
        if (cleanupInstalled && preferenceDefinition !== undefined && cleanupBundle !== undefined) {
          preferencesBinding = yield* database.bindNative({ definition: preferenceDefinition });
          preferences = yield* makePayloadPreferenceNativeCleanup({ database, bundle: cleanupBundle,
            contentBinding: payloadBinding, preferencesBinding });
        }
        const cmsBinding = yield* makeCmsNativeBinding({ database, binding: payloadBinding, hostRuntime,
          identityAndAccessPolicy: { profile: "native-currency-fixture", access: "closed-headless-local-api" },
          ...(preferences === undefined ? {} : { preferences }) });
        payloadWriter = yield* payload.runtime.bindNative(cmsBinding);
        payloadReader = yield* payload.runtime.bindNativeRead(cmsBinding);
      });
      yield* bindPayload;
      initialization = yield* currencyInitialization();
      const initializationContract = { stepId: initialization.stepId, datasetSha256: initialization.datasetSha256,
        expectedRowCount: initialization.expectedRowCount };
      host = yield* Effect.acquireRelease(makeCommerceNativeHost({ database, binding: currencyBinding, hostRuntime, commands,
        initialization: initializationContract, identityAndAccessPolicy: { profile: "native-currency-fixture" } }), value => value.close);
      service = makeCurrencyService(host);
      const currencyName = getCommerceCommand(currencyAnnouncementWrite)?.name;
      const cmsCommand = inspectPayloadRuntimeForTest(payload.runtime).commands.create;
      const cmsName = getCmsCommand(cmsCommand)?.name;
      if (currencyName === undefined || cmsName === undefined) return yield* Effect.die(new Error("Missing actual native command registration"));
      rootBinding = yield* database.bindNativeRoot({ bundle, contract: { name: "currency-announcement", version: 1 },
        participants: [{ binding: currencyBinding, commands: [currencyName], limits: { maxIdentities: 128, maxDocumentBytes: 65_536 } },
          { binding: payloadBinding, commands: [cmsName], limits: { maxIdentities: 256, maxDocumentBytes: 65_536 } }],
        applicationInsert: { table: options.applicationTable ?? "users", maxDocumentBytes: 65_536 }, maxFinalUserDocuments: 128 });
      activatePayloadLifecycle = () => Effect.gen(function* () {
        if (cleanupBundle === undefined) return yield* Effect.die(new Error("Preference transition was not selected by this fixture"));
        const proposal = yield* database.prepareSchema({ bundle: cleanupBundle });
        let ready = false;
        for (let step = 0; step < 512; step++) {
          const status = yield* database.schemaStatus(proposal);
          if ((status.state === "validated" || status.state === "active") && status.indexesReady) { ready = true; break; }
          if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Preference schema refused: ${status.error}`));
          yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
        }
        if (!ready) return yield* Effect.die(new Error("Preference transition exceeded fixture work allowance"));
        yield* database.activateSchema(proposal, { programs: [], bundle: cleanupBundle, authorityEpoch: (yield* database.readAuthorityEpoch) + 1n });
        cleanupInstalled = true;
        yield* bindPayload;
      });
      announcement = (input = {}) => Effect.acquireRelease(makeCurrencyAnnouncementHost({ database,
        hostRuntime, rootBinding, currencyBinding, payloadBinding, currencyCommand: input.currencyCommand ?? currencyAnnouncementWrite,
        cmsCommand: input.cmsCommand ?? cmsCommand,
        currencyInitialization: initializationContract, expectedContentIdentity: compiled.contentIdentity,
        identityAndAccessPolicy: { profile: "native-currency-announcement" } }, input.hooks), value => value.close);
      if (install && options.initialize !== false) yield* host.initialize(initialization.rows);
    }));
    await connect(physical.persistence, true);
    const inventory = () => run(readCoreNativeFixtureInventory(database, persistence));
    const maintainCurrencyForInitialization: CoreCurrencyFixture["maintainCurrencyForInitialization"] = input => run(
      Effect.acquireUseRelease(Effect.gen(function* () {
        const metadata = yield* database.readNativeBinding(currencyBinding);
        const table = metadata.definition.tables[0];
        const command = getCommerceCommand(currencyAnnouncementWrite);
        if (table === undefined || command === undefined) return yield* Effect.die(new Error("Missing fixture Currency maintenance target"));
        const operation = yield* database.beginNative(currencyBinding, { commandName: command.name,
          ...coreNativeTestBudget(), limits: { maxIdentities: 128, maxDocumentBytes: 65_536 } });
        return { operation, table: table.name };
      }), ({ operation, table }) => Effect.gen(function* () {
        const rows = yield* "insert" in input ? operation.operations.writeRows(table, "insert", input.insert)
          : operation.operations.deleteRows(table, input.delete);
        yield* database.commit(yield* operation.finalize());
        return rows.length;
      }), ({ operation }) => operation.abort()),
    );
    return { physical, run, inventory, maintainCurrencyForInitialization,
      get database() { return database; }, get persistence() { return persistence; }, get host() { return host; }, get service() { return service; },
      get payload() { return payload; }, get payloadWriter() { return payloadWriter; }, get payloadReader() { return payloadReader; }, get compiledPayload() { return compiledPayload; },
      get cleanupBundle() { return expectedCleanupBundle; }, get preferenceDefinition() { return preferenceDefinition; },
      get hostRuntime() { return hostRuntime; }, get currencyBinding() { return currencyBinding; },
      get payloadBinding() { return payloadBinding; }, get rootBinding() { return rootBinding; }, get initialization() { return initialization; },
      announcement: input => announcement(input),
      activatePayloadLifecycle: () => activatePayloadLifecycle(),
      seedPreferences: rows => run(Effect.acquireUseRelease(Effect.gen(function* () {
        if (preferencesBinding === undefined || preferenceDefinition === undefined) return yield* Effect.die(new Error("Preference lifecycle is not installed"));
        const operation = yield* database.beginNative(preferencesBinding, { commandName: payloadPreferenceCleanupCommand, ...coreNativeTestBudget() });
        const table = preferenceDefinition.tables[0];
        if (table === undefined) return yield* Effect.die(new Error("Missing preference producer table"));
        return { operation, table };
      }), ({ operation, table }) => Effect.gen(function* () {
        yield* operation.operations.writeRows(table.name, "insert", rows);
        yield* database.commit(yield* operation.finalize());
      }), ({ operation }) => operation.abort())),
      loseNextWriteAcknowledgement: () => { loseAcknowledgement = true; },
      reopen: async () => { await Effect.runPromise(Scope.close(scope, Exit.void)); scope = await Effect.runPromise(Scope.make());
        await connect(await physical.reopen(), false); },
      close: async () => {
        if (closed) return; closed = true;
        const results = await Promise.allSettled([Effect.runPromise(Scope.close(scope, Exit.void))]);
        const resources = await Promise.allSettled([physical.close()]);
        const failures = [...results, ...resources].flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (failures.length > 0) throw new AggregateError(failures, "Native Currency fixture cleanup failed");
      },
    };
  } catch (cause) {
    const results = await Promise.allSettled([Effect.runPromise(Scope.close(scope, Exit.void))]);
    const resources = await Promise.allSettled([physical.close()]);
    const failures = [...results, ...resources].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    throw failures.length === 0 ? cause : new AggregateError([cause, ...failures], "Native Currency fixture construction failed");
  }
}
