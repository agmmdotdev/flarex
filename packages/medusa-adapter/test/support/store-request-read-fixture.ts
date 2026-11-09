import { Effect, type Scope } from "effect";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { makeStoreRequestReads, type StoreRequestReads } from "../../src/http/store-request-reads";
import { createCoreNativeWorkflowFixture } from "./core-native-workflow-fixture";
import { compileStoreRequestReadFixtureCatalog } from "./store-request-read-catalog";

export async function prepareStoreRequestReadFixture(driver: "pglite" | "postgres", options: Readonly<{
  target?: Readonly<{ scopeUuid: string; epochUuid: string }>; physical?: CorePersistenceFixture;
}> = {}) {
  const { catalog, rows, target } = await Effect.runPromise(compileStoreRequestReadFixtureCatalog(options.target));
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: [
    { name: "currency", definition: catalog.currency.definition, initialCommands: catalog.currency.commands,
      rows: rows.currency.map(row => ({ table: "currency", row })) },
    { name: "apiKey", initializationStepId: catalog.apiKey.initialization.stepId, definition: catalog.apiKey.definition, initialCommands: catalog.apiKey.commands,
      rows: rows.apiKey.map(row => ({ table: "api_key", row })) },
    { name: "apiKeySalesChannel", initializationStepId: catalog.apiKeySalesChannel.initialization.stepId, definition: catalog.apiKeySalesChannel.definition,
      initialCommands: catalog.apiKeySalesChannel.commands, rows: rows.apiKeySalesChannel },
  ], ...(options.physical === undefined ? {} : { physical: options.physical }) });
  const use = <A, E>(work: (reads: StoreRequestReads) => Effect.Effect<A, E, Scope.Scope>) => fixture.run(fixture.useGeneration(generation => Effect.gen(function* () {
    const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 3, maximumPreparedBytes: 2 * 1024 * 1024 });
    const reads = yield* makeStoreRequestReads({ database: generation.database, hostRuntime, catalog,
      identityAndAccessPolicy: { profile: "store-request-native-contract" } });
    return yield* work(reads);
  })));
  return { fixture, use, catalog, target };
}
