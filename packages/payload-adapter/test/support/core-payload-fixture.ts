import { Clock, Effect, Exit, Scope } from "effect";
import { compilePayloadCollections, type CompiledPayloadCollections } from "../../src/collections";
import type { PayloadRuntime, PayloadHost, PayloadReadHost } from "../../src/runtime";
import { makePayloadManagedReadAccessRuntime, inspectPayloadRuntimeForTest, withPayloadRuntimeScopeForTest } from "../../src/testing";
import { openCoreDatabase } from "../../../persistence-postgres/src/core/database";
import type { CoreDatabase, CoreError, CoreNativeBinding, CoreNativeOperations } from "../../../persistence-postgres/src/core/api";
import { makeCoreNativeDefinition, type CoreNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import { makeCoreSchemaBundle, type CoreSchemaBundle } from "../../../persistence-postgres/src/core/schemaBundle";
import type { PreparedApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { CorePersistenceError, type CorePersistence, type CoreWriteBatch, type CorePersistenceIndexEntry } from "../../../persistence-postgres/src/core/contracts";
import { makePreparedHostRuntime, type PreparedHostRuntime } from "../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { makeCmsNativeBinding, bindCmsNativeCommand, type CmsNativeBinding } from "../../../persistence-postgres/src/frameworks/cmsTransaction/nativeBinding";
import { getCmsCommand, type CmsCommand } from "../../../persistence-postgres/src/frameworks/cmsTransaction/commands";
import type { CmsHost } from "../../../persistence-postgres/src/frameworks/cmsTransaction/host";
import { cmsError, type CmsTransactionError } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { projectCoreCmsFailure } from "../../../persistence-postgres/src/frameworks/cmsTransaction/nativeFailure";
import { createCorePGliteFixture, createCorePostgresFixture, type CorePersistenceFixture, type CorePersistenceFixtureOptions } from "../../../persistence-postgres/test/core/fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import { readCoreNativeFixtureInventory, type CoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { postgresUrl } from "../../../persistence-postgres/test/support/postgresHelpers";
import { makePayloadPreferenceNativeDefinition, payloadPreferenceCleanupCommand } from "../../../persistence-postgres/src/frameworks/payloadPreferences/nativeSource";
import { makePayloadPreferenceNativeCleanup, type PayloadPreferenceNativeCleanup } from "../../../persistence-postgres/src/frameworks/payloadPreferences/nativeCleanup";
import { coreNativeTestBudget } from "../../../persistence-postgres/test/core/nativeTestBudget";
import type { JsonObject } from "flarex-protocol/json";

type NativeRuntime = Pick<PayloadRuntime, "bind" | "bindRead" | "bindNative" | "bindNativeRead">;
/** Test-owned fixed producers and the ordinary compiler share this data contract.
 * It is not a CompiledPayloadCollections issuer proof for the public runtime. */
export type CorePayloadFixtureSource = Pick<CompiledPayloadCollections,
  "configuration" | "sourceContract" | "contentIdentity" | "createNativeCollections">;
type AccessRuntime = Effect.Success<ReturnType<typeof makePayloadManagedReadAccessRuntime>>;
export interface CorePayloadFixtureOptions {
  readonly compiled?: CorePayloadFixtureSource;
  readonly application?: PreparedApplicationSchemaSource;
  readonly futureSources?: readonly Readonly<{ compiled: CorePayloadFixtureSource; application?: PreparedApplicationSchemaSource }>[];
  readonly preferences?: boolean;
  /** Install this authentic source without automatically granting cleanup. */
  readonly preferenceDefinition?: CoreNativeDefinition;
  readonly nativeHooks?: {
    readonly afterGetMany?: () => Effect.Effect<void, CoreError>;
    readonly beforeFinalize?: () => Effect.Effect<void, CoreError>;
    readonly afterFinalize?: () => Effect.Effect<void, CoreError>;
  };
  readonly makeRuntime?: (compiled: CorePayloadFixtureSource) => Effect.Effect<NativeRuntime, CmsTransactionError, Scope.Scope>;
  readonly scopeUuid?: string;
  readonly epochUuid?: string;
  readonly wrapRuntimeDriver?: CorePersistenceFixtureOptions["wrapRuntimeDriver"];
  readonly observeWrite?: (batch: CoreWriteBatch) => void;
  readonly afterIndexBackfill?: (indexes: readonly CorePersistenceIndexEntry[]) => Effect.Effect<void, CorePersistenceError>;
}
export interface CorePayloadSuccessor {
  readonly compiled: CorePayloadFixtureSource;
  readonly definition: Effect.Success<ReturnType<typeof makeCoreNativeDefinition>>;
  readonly bundle: CoreSchemaBundle | undefined;
  readonly proposal: Effect.Success<ReturnType<CoreDatabase["prepareSchema"]>>;
}
export type CorePayloadFixtureTarget =
  | Readonly<{ kind: "fresh"; driver: "pglite" | "postgres"; instanceName?: string;
    postgresEndpoints?: Readonly<{ connectionString: string; provisioningConnectionString: string }> }>
  | Readonly<{ kind: "physical"; physical: CorePersistenceFixture; installation: "fresh" | "existing"; instanceName?: string }>;
export interface CorePayloadFixture {
  readonly database: CoreDatabase;
  readonly physical: CorePersistenceFixture;
  readonly persistence: CorePersistence;
  readonly instanceName: string;
  readonly compiled: CorePayloadFixtureSource;
  readonly definition: Effect.Success<ReturnType<typeof makeCoreNativeDefinition>>;
  readonly binding: CoreNativeBinding;
  readonly cmsBinding: CmsNativeBinding;
  readonly hostRuntime: PreparedHostRuntime;
  readonly bundle: CoreSchemaBundle | undefined;
  readonly preferences: PayloadPreferenceNativeCleanup | undefined;
  readonly preferencesBinding: CoreNativeBinding | undefined;
  readonly runtime: NativeRuntime;
  readonly accessRuntime: AccessRuntime | undefined;
  readonly writer: PayloadHost;
  readonly reader: PayloadReadHost;
  readonly run: <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Promise<A>;
  readonly openHost: (extra: readonly CmsCommand[]) => Effect.Effect<CmsHost, CmsTransactionError>;
  readonly inventory: () => Promise<CoreNativeFixtureInventory>;
  readonly prepareSuccessor: (compiled: CorePayloadFixtureSource, application?: PreparedApplicationSchemaSource) => Promise<CorePayloadSuccessor>;
  readonly activateSuccessor: (successor: CorePayloadSuccessor) => Promise<void>;
  readonly rebind: (successor: CorePayloadSuccessor) => Promise<void>;
  readonly seedPreferences: (rows: readonly JsonObject[]) => Promise<void>;
  readonly reopen: () => Promise<void>;
  readonly closeOwner: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly loseNextWriteAcknowledgement: () => void;
}

/** Genuine producer, shared lifecycle and five-table persistence only. */
export async function createCorePayloadFixture(target: CorePayloadFixtureTarget, options: CorePayloadFixtureOptions = {}): Promise<CorePayloadFixture> {
  const provisioning = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
  let physical: CorePersistenceFixture;
  if (target.kind === "physical") physical = target.physical;
  else if (target.driver === "pglite") physical = await createCorePGliteFixture({
    ...(target.instanceName === undefined ? {} : { instanceName: target.instanceName }),
    ...(options.wrapRuntimeDriver === undefined ? {} : { wrapRuntimeDriver: options.wrapRuntimeDriver }) });
  else {
    const endpoints = target.postgresEndpoints ?? (postgresUrl === null || provisioning === undefined ? undefined
      : { connectionString: postgresUrl, provisioningConnectionString: provisioning });
    if (endpoints === undefined) throw new Error("Native PostgreSQL fixture needs ordinary and provisioning endpoints");
    physical = await createCorePostgresFixture({ ...endpoints,
      ...(target.instanceName === undefined ? {} : { instanceName: target.instanceName }),
      ...(options.wrapRuntimeDriver === undefined ? {} : { wrapRuntimeDriver: options.wrapRuntimeDriver }) });
  }
  const instanceName = target.instanceName ?? physical.instanceName;
  let scope = await Effect.runPromise(Scope.make());
  const run = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(work));
  let loseAcknowledgement = false;
  const observed = (persistence: CorePersistence): CorePersistence => ({ ...persistence,
    writeIndexBackfill: (lease, indexes) => persistence.writeIndexBackfill(lease, indexes).pipe(
      Effect.andThen(options.afterIndexBackfill?.(indexes) ?? Effect.void)),
    write: (lease, batch) => persistence.write(lease, batch).pipe(Effect.andThen(() => {
      options.observeWrite?.(batch);
      if (!loseAcknowledgement) return Effect.void;
      loseAcknowledgement = false;
      return Effect.fail(new CorePersistenceError({ reason: "uncertainWrite" }));
    })),
  });
  let closed = false;
  try {
    let compiled: CorePayloadFixtureSource = options.compiled ?? await run(compilePayloadCollections([{ slug: "news", fields: [
      { name: "title", type: "text", required: true, unique: true },
    ] }]));
    let definition = await run(makeCoreNativeDefinition({ source: compiled.sourceContract,
      scopeUuid: options.scopeUuid ?? "45000000-0000-4000-8000-000000000001",
      epochUuid: options.epochUuid ?? "45000000-0000-4000-8000-000000000002" }));
    let application = options.application;
    const preferenceDefinition = options.preferenceDefinition
      ?? (options.preferences === true ? await run(makePayloadPreferenceNativeDefinition(definition.identity)) : undefined);
    const bundles: CoreSchemaBundle[] = [];
    let bundle = application === undefined && preferenceDefinition === undefined && definition.privateTables === undefined ? undefined : await run(makeCoreSchemaBundle({ sources: [
      ...(application === undefined ? [] : [{ kind: "application" as const, definition: application }]), { kind: "native", definition },
      ...(preferenceDefinition === undefined ? [] : [{ kind: "native" as const, definition: preferenceDefinition }]),
    ] }));
    if (bundle !== undefined) bundles.push(bundle);
    for (const future of options.futureSources ?? []) {
      const futureDefinition = await run(makeCoreNativeDefinition({ source: future.compiled.sourceContract,
        scopeUuid: definition.identity.scopeUuid, epochUuid: definition.identity.epochUuid }));
      const futureApplication = future.application ?? application;
      if (futureApplication === undefined && preferenceDefinition === undefined && futureDefinition.privateTables === undefined) continue;
      bundles.push(await run(makeCoreSchemaBundle({ sources: [
        ...(futureApplication === undefined ? [] : [{ kind: "application" as const, definition: futureApplication }]),
        { kind: "native", definition: futureDefinition },
        ...(preferenceDefinition === undefined ? [] : [{ kind: "native" as const, definition: preferenceDefinition }]),
      ] })));
    }
    const databaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, schemaBundles: bundles,
      now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
      randomBytes: (length: 16 | 32) => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 2 };
    let database: CoreDatabase;
    let currentPersistence: CorePersistence;
    let binding: CoreNativeBinding;
    let cmsBinding: CmsNativeBinding;
    let hostRuntime: PreparedHostRuntime;
    let runtime: NativeRuntime;
    let accessRuntime: AccessRuntime | undefined;
    let writer: PayloadHost;
    let reader: PayloadReadHost;
    let preferencesBinding: CoreNativeBinding | undefined;
    let preferences: Effect.Success<ReturnType<typeof makePayloadPreferenceNativeCleanup>> | undefined;
    const instrument = <Operations extends CoreNativeOperations>(operations: Operations): Operations => ({ ...operations,
      getMany: (table, ids) => operations.getMany(table, ids).pipe(
        Effect.tap(() => options.nativeHooks?.afterGetMany?.() ?? Effect.void)),
    });
    const bind = () => Effect.gen(function* () {
      binding = yield* database.bindNative({ definition });
      if (preferenceDefinition !== undefined && bundle !== undefined) {
        preferencesBinding = yield* database.bindNative({ definition: preferenceDefinition });
        if (options.preferences === true) preferences = yield* makePayloadPreferenceNativeCleanup({ database, bundle, contentBinding: binding,
          preferencesBinding });
      }
      hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
      if (options.makeRuntime === undefined) {
        accessRuntime = yield* makePayloadManagedReadAccessRuntime(compiled);
        runtime = accessRuntime.runtime;
      } else runtime = yield* options.makeRuntime(compiled);
      cmsBinding = yield* makeCmsNativeBinding({ database, binding, hostRuntime,
        identityAndAccessPolicy: { profile: compiled.configuration.profile, access: "closed-headless-local-api" },
        ...(preferences === undefined ? {} : { preferences }) });
      writer = yield* runtime.bindNative(cmsBinding);
      reader = yield* runtime.bindNativeRead(cmsBinding);
    });
    const connect = async (persistence: CorePersistence, install: boolean) => run(Effect.gen(function* () {
      currentPersistence = persistence;
      const original = yield* openCoreDatabase(observed(persistence), databaseOptions);
      database = { ...original, beginNative: (selected, input) => original.beginNative(selected, input).pipe(Effect.map(operation => ({ ...operation,
        operations: instrument(operation.operations),
        finalize: () => (options.nativeHooks?.beforeFinalize?.() ?? Effect.void).pipe(Effect.andThen(operation.finalize()),
          Effect.tap(() => options.nativeHooks?.afterFinalize?.() ?? Effect.void)),
      }))), beginNativeRoot: (selected, input) => original.beginNativeRoot(selected, input).pipe(Effect.map(operation => ({ ...operation,
        native: child => operation.native(child).pipe(Effect.map(operations => instrument(operations))),
        finalize: () => (options.nativeHooks?.beforeFinalize?.() ?? Effect.void).pipe(Effect.andThen(operation.finalize()),
          Effect.tap(() => options.nativeHooks?.afterFinalize?.() ?? Effect.void)),
      }))) };
      if (install) {
        const proposal = yield* database.prepareSchema(bundle === undefined ? { native: definition } : { bundle });
        let ready = false;
        for (let step = 0; step < 512; step++) {
          const status = yield* database.schemaStatus(proposal);
          if (status.state === "failed" || status.state === "overwritten") throw new Error(`Native schema failed: ${status.error}`);
          if ((status.state === "validated" || status.state === "active") && status.indexesReady) { ready = true; break; }
          yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
        }
        if (!ready) throw new Error("Native schema did not become ready within the fixture budget");
        yield* database.activateSchema(proposal, bundle === undefined ? { programs: [], native: definition } : { programs: [], bundle });
      }
      yield* bind();
    }));
    await connect(target.kind === "fresh" ? physical.persistence : await physical.reopen(instanceName),
      target.kind === "fresh" || target.installation === "fresh");
    return {
      get database() { return database; }, physical, get compiled() { return compiled; }, get definition() { return definition; }, instanceName,
      get persistence() { return currentPersistence; },
      get binding() { return binding; }, get cmsBinding() { return cmsBinding; },
      get hostRuntime() { return hostRuntime; },
      get bundle() { return bundle; }, get preferences() { return preferences; }, get preferencesBinding() { return preferencesBinding; },
      get runtime() { return runtime; }, get accessRuntime() { return accessRuntime; },
      get writer() { return writer; }, get reader() { return reader; }, run,
      inventory: () => run(readCoreNativeFixtureInventory(database, currentPersistence)),
      prepareSuccessor: async (next, nextApplication = application) => {
        const nextDefinition = await run(makeCoreNativeDefinition({ source: next.sourceContract,
          scopeUuid: definition.identity.scopeUuid, epochUuid: definition.identity.epochUuid }));
        const nextBundle = nextApplication === undefined && preferenceDefinition === undefined && nextDefinition.privateTables === undefined ? undefined : await run(makeCoreSchemaBundle({ sources: [
          ...(nextApplication === undefined ? [] : [{ kind: "application" as const, definition: nextApplication }]),
          { kind: "native", definition: nextDefinition },
          ...(preferenceDefinition === undefined ? [] : [{ kind: "native" as const, definition: preferenceDefinition }]),
        ] }));
        const expectedBundle = nextBundle === undefined ? undefined : bundles.find(candidate => candidate.metadata === nextBundle.metadata);
        if (nextBundle !== undefined && expectedBundle === undefined) throw new Error("Native successor was not included in this fixture owner's expected source proofs");
        const proposal = await run(database.prepareSchema(expectedBundle === undefined ? { native: nextDefinition } : { bundle: expectedBundle }));
        application = nextApplication;
        return { compiled: next, definition: nextDefinition, bundle: expectedBundle, proposal };
      },
      activateSuccessor: async successor => {
        await run(database.activateSchema(successor.proposal, successor.bundle === undefined
          ? { programs: [], native: successor.definition } : { programs: [], bundle: successor.bundle }));
      },
      rebind: async successor => {
        compiled = successor.compiled; definition = successor.definition; bundle = successor.bundle;
        await run(bind());
      },
      seedPreferences: rows => run(Effect.acquireUseRelease(Effect.gen(function* () {
        if (preferencesBinding === undefined || preferenceDefinition === undefined) return yield* Effect.die(new Error("Preference inventory was not installed"));
        const operation = yield* database.beginNative(preferencesBinding, { commandName: payloadPreferenceCleanupCommand,
          ...coreNativeTestBudget() });
        const table = preferenceDefinition.tables[0];
        if (table === undefined) return yield* Effect.die(new Error("Preference producer has no table"));
        return { operation, table };
      }), ({ operation, table }) => Effect.gen(function* () {
        yield* operation.operations.writeRows(table.name, "insert", rows);
        yield* database.commit(yield* operation.finalize());
      }), ({ operation }) => operation.abort())),
      openHost: extra => withPayloadRuntimeScopeForTest(runtime, Effect.gen(function* () {
        const commands = [...Object.values(inspectPayloadRuntimeForTest(runtime).commands), ...extra];
        const registrations = commands.map(token => getCmsCommand(token));
        if (registrations.some(command => command === undefined)) return yield* Effect.fail(cmsError("invalidAuthority"));
        const nativeBinding = yield* database.bindNative({ definition,
          commands: registrations.flatMap(command => command === undefined ? [] : [{ name: command.name, mode: command.mode }]),
        }).pipe(Effect.mapError(projectCoreCmsFailure));
        const scopedPreferences = preferences === undefined || preferencesBinding === undefined || bundle === undefined ? undefined
          : yield* makePayloadPreferenceNativeCleanup({ database, bundle, contentBinding: nativeBinding, preferencesBinding });
        const scoped = yield* makeCmsNativeBinding({ database, binding: nativeBinding, hostRuntime,
          identityAndAccessPolicy: { profile: compiled.configuration.profile, access: "closed-headless-local-api" },
          ...(scopedPreferences === undefined ? {} : { preferences: scopedPreferences }) });
        return yield* bindCmsNativeCommand(scoped, commands, compiled.contentIdentity);
      })),
      reopen: async () => {
        await Effect.runPromise(Scope.close(scope, Exit.void));
        scope = await Effect.runPromise(Scope.make());
        await connect(await physical.reopen(instanceName), false);
      },
      closeOwner: () => Effect.runPromise(Scope.close(scope, Exit.void)),
      loseNextWriteAcknowledgement: () => { loseAcknowledgement = true; },
      close: async () => {
        if (closed) return;
        closed = true;
        const results = await Promise.allSettled([Effect.runPromise(Scope.close(scope, Exit.void))]);
        const cleanup = await Promise.allSettled(target.kind === "fresh" ? [physical.close()] : []);
        const failures = [...results, ...cleanup].flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (failures.length > 0) throw new AggregateError(failures, "Core Payload fixture cleanup failed");
      },
    };
  } catch (cause) {
    const cleanup = await Promise.allSettled([Effect.runPromise(Scope.close(scope, Exit.void))]);
    const physicalCleanup = await Promise.allSettled(target.kind === "fresh" ? [physical.close()] : []);
    const failures = [...cleanup, ...physicalCleanup].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    throw failures.length === 0 ? cause : new AggregateError([cause, ...failures], "Core Payload fixture construction failed");
  }
}
