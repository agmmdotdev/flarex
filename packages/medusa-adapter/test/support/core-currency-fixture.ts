import { Clock, Effect, Exit, Scope } from "effect";
import { defineSchema, defineTable } from "../../../flarex/src/server";
import { v } from "../../../flarex/src/values";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
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
import type { CoreDatabase, CoreDatabaseOptions, CoreNativeBinding, CoreNativeRootBinding } from "../../../persistence-postgres/src/core/api";
import { makeCoreNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import { makeCoreSchemaBundle } from "../../../persistence-postgres/src/core/schemaBundle";
import { CorePersistenceError, type CorePersistence, type CoreDocumentLogCursor, type CoreInterval } from "../../../persistence-postgres/src/core/contracts";
import { readDocumentObject, REQUESTS } from "../../../persistence-postgres/src/core/registry";
import type { DocumentObject } from "flarex-protocol/document-value";
import type { JsonObject } from "flarex-protocol";
import { makePreparedHostRuntime, type PreparedHostRuntime } from "../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { createCorePGliteFixture, createCorePostgresFixture, readCoreFixtureRegistry,
  type CorePersistenceFixture, type CorePersistenceFixtureOptions } from "../../../persistence-postgres/test/core/fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import { coreNativeTestBudget } from "../../../persistence-postgres/test/core/nativeTestBudget";
import { postgresUrl } from "../../../persistence-postgres/test/support/postgresHelpers";
import { compileCurrencyCoreDefinition } from "../../src/modules/currency/schema";
import { currencyInitialization } from "../../src/modules/currency/contract";
import { currencyCommands, currencyAnnouncementWrite, makeCurrencyService, type CurrencyReads } from "../../src/modules/currency/service";

type Announcement = Effect.Success<ReturnType<typeof makeCurrencyAnnouncementHost>>;
export interface CoreCurrencyFixtureOptions {
  readonly commands?: readonly CommerceCommand[];
  readonly includeUserNameIndex?: boolean;
  readonly initialize?: boolean;
  readonly wrapRuntimeDriver?: CorePersistenceFixtureOptions["wrapRuntimeDriver"];
}
export interface CoreCurrencyFixture {
  readonly database: CoreDatabase;
  readonly persistence: CorePersistence;
  readonly physical: CorePersistenceFixture;
  readonly host: CommerceHost;
  readonly service: CurrencyReads;
  readonly payload: PayloadConformanceRuntime;
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
  /** Fixture maintenance only, confined to Currency; never supplied to a host. */
  readonly maintainCurrencyForInitialization: (input: Readonly<{ insert: readonly JsonObject[] }> | Readonly<{ delete: readonly string[] }>) => Promise<number>;
  readonly reopen: () => Promise<void>;
  readonly loseNextWriteAcknowledgement: () => void;
  readonly close: () => Promise<void>;
}
export interface CoreCurrencyInventory {
  readonly rows: readonly Readonly<{ table: string; timestamp: bigint; value: DocumentObject }>[];
  readonly revisions: readonly Readonly<{ table: string; id: string; timestamp: bigint; previous: bigint | null;
    deleted: boolean; value: DocumentObject | null }>[];
  readonly outcomes: readonly Readonly<{ timestamp: bigint; value: DocumentObject }>[];
}

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
      const application = yield* prepareApplicationSchemaSource(defineSchema({ users: options.includeUserNameIndex === true
        ? users.index("by_name", ["name"]) : users }));
      const compiled = yield* compilePayloadCollections([payloadPostsCollectionDefinition()]);
      const payloadDefinition = yield* makeCoreNativeDefinition({ ...target, source: compiled.sourceContract });
      const currencyDefinition = yield* compileCurrencyCoreDefinition(target);
      const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "application", definition: application },
        { kind: "native", definition: payloadDefinition }, { kind: "native", definition: currencyDefinition }] });
      const databaseOptions: CoreDatabaseOptions = { schemaBundles: [bundle], schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
        now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
        newInternalId: Effect.sync(() => crypto.getRandomValues(new Uint8Array(16))), maxConcurrentSaves: 2 };
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
      payload = yield* makePayloadConformanceRuntime();
      const payloadCommands = Object.values(inspectPayloadRuntimeForTest(payload.runtime).commands).flatMap(token => {
        const command = getCmsCommand(token);
        return command === undefined ? [] : [{ name: command.name, mode: command.mode }];
      });
      payloadBinding = yield* database.bindNative({ definition: payloadDefinition, commands: payloadCommands });
      hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
      const cmsBinding = yield* makeCmsNativeBinding({ database, binding: payloadBinding, hostRuntime,
        identityAndAccessPolicy: { profile: "native-currency-fixture", access: "closed-headless-local-api" } });
      yield* payload.runtime.bindNative(cmsBinding);
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
        applicationInsert: { table: "users", maxDocumentBytes: 65_536 }, maxFinalUserDocuments: 128 });
      announcement = (input = {}) => Effect.acquireRelease(makeCurrencyAnnouncementHost({ database,
        hostRuntime, rootBinding, currencyBinding, payloadBinding, currencyCommand: input.currencyCommand ?? currencyAnnouncementWrite,
        cmsCommand: input.cmsCommand ?? cmsCommand,
        currencyInitialization: initializationContract, expectedContentIdentity: compiled.contentIdentity,
        identityAndAccessPolicy: { profile: "native-currency-announcement" } }, input.hooks), value => value.close);
      if (install && options.initialize !== false) yield* host.initialize(initialization.rows);
    }));
    await connect(physical.persistence, true);
    const inventory = () => run(Effect.gen(function* () {
      const timestamp = yield* database.publishedTimestamp;
      const registry = yield* readCoreFixtureRegistry({ persistence }, timestamp);
      const snapshot = yield* persistence.readSnapshot(timestamp);
      const rows: CoreCurrencyInventory["rows"][number][] = [];
      const revisions: CoreCurrencyInventory["revisions"][number][] = [];
      const outcomes: CoreCurrencyInventory["outcomes"][number][] = [];
      for (const { definition: table } of registry.tables.values()) {
        if (table.name.startsWith("_") && table.name !== REQUESTS) continue;
        const index = table.indexes.find(index => index.name === "by_id");
        if (index === undefined) return yield* Effect.die(new Error("Fixture table has no ID index"));
        let interval: CoreInterval = { start: null, end: null };
        while (true) {
          const page = yield* snapshot.scan({ tableId: table.tabletId, index: index.ref, interval, order: "asc", maxResults: 128 });
          for (const entry of page.entries) {
            const value = yield* Effect.fromResult(readDocumentObject(entry.document, table));
            if (table.name === REQUESTS) outcomes.push({ timestamp: entry.document.ts, value });
            else rows.push({ table: table.name, timestamp: entry.document.ts, value });
          }
          if (page.cursor.kind === "end") break;
          const start = new Uint8Array(page.cursor.key.length + 1); start.set(page.cursor.key);
          interval = { start, end: null };
        }
        if (table.name === REQUESTS) continue;
        let after: CoreDocumentLogCursor | undefined;
        while (true) {
          const page = yield* persistence.loadDocuments({ start: 0n, end: timestamp, order: "asc", maxResults: 128,
            tableId: table.tabletId, ...(after === undefined ? {} : { after }) });
          for (const entry of page.documents) revisions.push({ table: table.name, id: encodeBytesToLowercaseHex(entry.id), timestamp: entry.ts,
            previous: entry.prevTs, deleted: entry.deleted, value: entry.deleted ? null : yield* Effect.fromResult(readDocumentObject(entry, table)) });
          if (page.done) break;
          if (page.cursor === null) return yield* Effect.die(new Error("Nonterminal fixture history page has no cursor"));
          after = page.cursor;
        }
      }
      return { rows, revisions, outcomes };
    }));
    const maintainCurrencyForInitialization: CoreCurrencyFixture["maintainCurrencyForInitialization"] = input => run(
      Effect.acquireUseRelease(Effect.gen(function* () {
        const metadata = yield* database.readNativeBinding(currencyBinding);
        const table = metadata.definition.tables[0];
        const command = getCommerceCommand(currencyAnnouncementWrite);
        if (table === undefined || command === undefined) return yield* Effect.die(new Error("Missing fixture Currency maintenance target"));
        const operation = yield* database.beginNative(currencyBinding, { commandName: command.name,
          limits: { maxIdentities: 128, maxDocumentBytes: 65_536 }, chargeRetained: coreNativeTestBudget().chargeRetained });
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
      get payload() { return payload; }, get hostRuntime() { return hostRuntime; }, get currencyBinding() { return currencyBinding; },
      get payloadBinding() { return payloadBinding; }, get rootBinding() { return rootBinding; }, get initialization() { return initialization; },
      announcement: input => announcement(input),
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
