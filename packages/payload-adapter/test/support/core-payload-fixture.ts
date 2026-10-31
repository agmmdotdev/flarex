import { Clock, Effect, Exit, Scope } from "effect";
import { compilePayloadCollections, type CompiledPayloadCollections } from "../../src/collections";
import type { PayloadRuntime, PayloadHost, PayloadReadHost } from "../../src/runtime";
import { makePayloadManagedReadAccessRuntime, inspectPayloadRuntimeForTest, withPayloadRuntimeScopeForTest } from "../../src/testing";
import { openCoreDatabase } from "../../../persistence-postgres/src/core/database";
import type { CoreDatabase, CoreNativeBinding } from "../../../persistence-postgres/src/core/api";
import { makeCoreNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import { CorePersistenceError, type CorePersistence } from "../../../persistence-postgres/src/core/contracts";
import { makePreparedHostRuntime, type PreparedHostRuntime } from "../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { makeCmsNativeBinding, bindCmsNativeCommand, type CmsNativeBinding } from "../../../persistence-postgres/src/frameworks/cmsTransaction/nativeBinding";
import { getCmsCommand, type CmsCommand } from "../../../persistence-postgres/src/frameworks/cmsTransaction/commands";
import type { CmsHost } from "../../../persistence-postgres/src/frameworks/cmsTransaction/host";
import { cmsError, type CmsTransactionError } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { projectCoreCmsFailure } from "../../../persistence-postgres/src/frameworks/cmsTransaction/nativeFailure";
import { createCorePGliteFixture, createCorePostgresFixture, type CorePersistenceFixture, type CorePersistenceFixtureOptions } from "../../../persistence-postgres/test/core/fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import { postgresUrl } from "../../../persistence-postgres/test/support/postgresHelpers";

type NativeRuntime = Pick<PayloadRuntime, "bind" | "bindRead" | "bindNative" | "bindNativeRead">;
type AccessRuntime = Effect.Success<ReturnType<typeof makePayloadManagedReadAccessRuntime>>;
export interface CorePayloadFixtureOptions {
  readonly compiled?: CompiledPayloadCollections;
  readonly makeRuntime?: (compiled: CompiledPayloadCollections) => Effect.Effect<NativeRuntime, CmsTransactionError, Scope.Scope>;
  readonly scopeUuid?: string;
  readonly epochUuid?: string;
  readonly wrapRuntimeDriver?: CorePersistenceFixtureOptions["wrapRuntimeDriver"];
}
export type CorePayloadFixtureTarget =
  | Readonly<{ kind: "fresh"; driver: "pglite" | "postgres"; instanceName?: string }>
  | Readonly<{ kind: "physical"; physical: CorePersistenceFixture; installation: "fresh" | "existing"; instanceName?: string }>;
export interface CorePayloadFixture {
  readonly database: CoreDatabase;
  readonly physical: CorePersistenceFixture;
  readonly persistence: CorePersistence;
  readonly instanceName: string;
  readonly compiled: CompiledPayloadCollections;
  readonly definition: Effect.Success<ReturnType<typeof makeCoreNativeDefinition>>;
  readonly binding: CoreNativeBinding;
  readonly cmsBinding: CmsNativeBinding;
  readonly runtime: NativeRuntime;
  readonly accessRuntime: AccessRuntime | undefined;
  readonly writer: PayloadHost;
  readonly reader: PayloadReadHost;
  readonly run: <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Promise<A>;
  readonly openHost: (extra: readonly CmsCommand[]) => Effect.Effect<CmsHost, CmsTransactionError>;
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
    if (postgresUrl === null || provisioning === undefined) throw new Error("Native PostgreSQL fixture needs ordinary and provisioning endpoints");
    physical = await createCorePostgresFixture({ connectionString: postgresUrl, provisioningConnectionString: provisioning,
      ...(target.instanceName === undefined ? {} : { instanceName: target.instanceName }),
      ...(options.wrapRuntimeDriver === undefined ? {} : { wrapRuntimeDriver: options.wrapRuntimeDriver }) });
  }
  const instanceName = target.instanceName ?? physical.instanceName;
  let scope = await Effect.runPromise(Scope.make());
  const run = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(work));
  let loseAcknowledgement = false;
  const observed = (persistence: CorePersistence): CorePersistence => ({ ...persistence,
    write: (lease, batch) => persistence.write(lease, batch).pipe(Effect.andThen(() => {
      if (!loseAcknowledgement) return Effect.void;
      loseAcknowledgement = false;
      return Effect.fail(new CorePersistenceError({ reason: "uncertainWrite" }));
    })),
  });
  let closed = false;
  try {
    const compiled = options.compiled ?? await run(compilePayloadCollections([{ slug: "news", fields: [
      { name: "title", type: "text", required: true, unique: true },
    ] }]));
    const definition = await run(makeCoreNativeDefinition({ source: compiled.sourceContract,
      scopeUuid: options.scopeUuid ?? "45000000-0000-4000-8000-000000000001",
      epochUuid: options.epochUuid ?? "45000000-0000-4000-8000-000000000002" }));
    const databaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
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
    const connect = async (persistence: CorePersistence, install: boolean) => run(Effect.gen(function* () {
      currentPersistence = persistence;
      database = yield* openCoreDatabase(observed(persistence), databaseOptions);
      if (install) {
        const proposal = yield* database.prepareSchema({ native: definition });
        let ready = false;
        for (let step = 0; step < 512; step++) {
          const status = yield* database.schemaStatus(proposal);
          if (status.state === "failed" || status.state === "overwritten") throw new Error(`Native schema failed: ${status.error}`);
          if ((status.state === "validated" || status.state === "active") && status.indexesReady) { ready = true; break; }
          yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
        }
        if (!ready) throw new Error("Native schema did not become ready within the fixture budget");
        yield* database.activateSchema(proposal, { programs: [], native: definition });
      }
      binding = yield* database.bindNative({ definition });
      hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
      if (options.makeRuntime === undefined) {
        accessRuntime = yield* makePayloadManagedReadAccessRuntime(compiled);
        runtime = accessRuntime.runtime;
      } else runtime = yield* options.makeRuntime(compiled);
      cmsBinding = yield* makeCmsNativeBinding({ database, binding, hostRuntime,
        identityAndAccessPolicy: { profile: "payload.scalar", access: "closed-headless-local-api" } });
      writer = yield* runtime.bindNative(cmsBinding);
      reader = yield* runtime.bindNativeRead(cmsBinding);
    }));
    await connect(target.kind === "fresh" ? physical.persistence : await physical.reopen(instanceName),
      target.kind === "fresh" || target.installation === "fresh");
    return {
      get database() { return database; }, physical, compiled, definition, instanceName,
      get persistence() { return currentPersistence; },
      get binding() { return binding; }, get cmsBinding() { return cmsBinding; },
      get runtime() { return runtime; }, get accessRuntime() { return accessRuntime; },
      get writer() { return writer; }, get reader() { return reader; }, run,
      openHost: extra => withPayloadRuntimeScopeForTest(runtime, Effect.gen(function* () {
        const commands = [...Object.values(inspectPayloadRuntimeForTest(runtime).commands), ...extra];
        const registrations = commands.map(token => getCmsCommand(token));
        if (registrations.some(command => command === undefined)) return yield* Effect.fail(cmsError("invalidAuthority"));
        const nativeBinding = yield* database.bindNative({ definition,
          commands: registrations.flatMap(command => command === undefined ? [] : [{ name: command.name, mode: command.mode }]),
        }).pipe(Effect.mapError(projectCoreCmsFailure));
        const scoped = yield* makeCmsNativeBinding({ database, binding: nativeBinding, hostRuntime,
          identityAndAccessPolicy: { profile: "payload.scalar", access: "closed-headless-local-api" } });
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
