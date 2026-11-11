import { Clock, Effect, Scope } from "effect";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { openCoreDatabase } from "@flarex/persistence-postgres/internal/core";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { readCoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import { makeStoreCartRequestRuntime, type StoreCartRequestRuntime, type StoreCartRequestCatalog } from "../../src/http/store-cart-request";
import { createCoreNativeWorkflowFixture } from "./core-native-workflow-fixture";
import { compileStoreCartRequestFixtureCatalog } from "./store-cart-request-catalog";

export async function prepareStoreCartRequestFixture(driver: "pglite" | "postgres", options: Readonly<{
  target?: Readonly<{ scopeUuid: string; epochUuid: string }>; physical?: CorePersistenceFixture;
}> = {}) {
  const { catalog, rows, target } = await Effect.runPromise(compileStoreCartRequestFixtureCatalog(options.target));
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: catalog.sources.map(source => ({ name: source.name,
    definition: source.definition, initialCommands: source.commands, initializationStepId: source.initialization.stepId, rows: rows[source.name] ?? [] })),
    eventDefinition: catalog.eventDefinition, ...(options.physical === undefined ? {} : { physical: options.physical }) });
  const use = <A, E>(work: (runtime: StoreCartRequestRuntime) => Effect.Effect<A, E, Scope.Scope>,
    configuration: Pick<Parameters<typeof makeStoreCartRequestRuntime>[0], "hooks"> = {}) => fixture.run(Effect.scoped(
    fixture.useGeneration(generation => Effect.gen(function* () {
      const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
      const runtime = yield* makeStoreCartRequestRuntime({ ...configuration, database: generation.database, hostRuntime, catalog,
        identityAndAccessPolicy: { profile: "native-store-cart-http-proof" }, revision: "1".repeat(64),
        subscribers: [{ id: "native-store-cart-http", revision: "2".repeat(64) }] });
      return yield* work(runtime);
    }))));
  return { fixture, catalog, target, use };
}

/** Independent durable observation, after the serving owner is fully drained. */
export async function observeStoreCartRequestFixture(input: Readonly<{ physical: CorePersistenceFixture; catalog: StoreCartRequestCatalog }>) {
  const persistence = await input.physical.reopen();
  return Effect.runPromise(Effect.scoped(Effect.acquireUseRelease(openCoreDatabase(persistence, { schemaBundles: [input.catalog.bundle],
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, now: Clock.currentTimeMillis.pipe(Effect.map(ms => BigInt(Math.floor(ms)) * 1_000_000n)),
    randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 2 }),
  database => readCoreNativeFixtureInventory(database, persistence), database => database.close())));
}
