import { randomUUID } from "node:crypto";
import { Effect, Result } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CorePersistence } from "../../../persistence-postgres/src/core/contracts";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { getCommerceCommand, type CommerceCommand, type CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { coreNativeRelationalRow } from "../../../persistence-postgres/src/core/nativeRelationalQuery";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { compileCurrencyCoreDefinition } from "../../src/modules/currency/schema";
import { currencyInitialization } from "../../src/modules/currency/contract";
import { currencyCommands, currencyWorkflowModule } from "../../src/modules/currency/service";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";

export interface CoreProductWorkflowFixtureOptions {
  readonly includeCurrency?: boolean;
  readonly physical?: CorePersistenceFixture;
  readonly wrapPersistence?: (persistence: CorePersistence) => CorePersistence;
}

/** Only the native sources selected by these workflows are installed. All
 * transaction, initialization, read and workflow mechanics use shared owners. */
export async function createCoreProductWorkflowFixture(driver: "pglite" | "postgres",
  registerCleanup: (close: () => Promise<void>) => void, options: CoreProductWorkflowFixtureOptions = {}) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const runtime = await Effect.runPromise(makeLocalProductCommands());
  const definition = await Effect.runPromise(compileProductCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const commands = Object.freeze(Object.values(runtime.commands));
  const internalCommands = Object.freeze([runtime.commands.internalProductCreate, runtime.commands.internalProductRetrieve,
    runtime.commands.internalProductList, runtime.commands.internalProductUpdate,
    runtime.commands.internalProductSoftDelete, runtime.commands.internalProductRestore]);
  const sourceInputs: CoreNativeWorkflowSource[] = [{ name: "product", definition, initialCommands: commands, rows: [] }];
  const currencyDefinition = options.includeCurrency === true ? await Effect.runPromise(compileCurrencyCoreDefinition(target)) : undefined;
  if (currencyDefinition !== undefined) {
    const dataset = await Effect.runPromise(currencyInitialization());
    sourceInputs.push({ name: "currency", definition: currencyDefinition, initialCommands: Object.values(currencyCommands),
      initializationStepId: dataset.stepId, rows: dataset.rows.map(row => ({ table: "currency", row })) });
  }
  const physical = options.physical === undefined ? undefined : await shareCoreNativeWorkflowPhysical(options.physical);
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: sourceInputs, eventDefinition,
    ...(physical === undefined ? {} : { physical }), ...(options.wrapPersistence === undefined ? {} : { wrapPersistence: options.wrapPersistence }) });
  registerCleanup(fixture.close);
  const readPhysicalTables = () => fixture.physical.query("select tablename as name from pg_tables where schemaname = $1 order by tablename", [fixture.physical.namespace]);
  const physicalTablesBeforeCandidate = await readPhysicalTables();
  const reads = await fixture.run(fixture.openReadHost("product", commands.filter(command => getCommerceCommand(command)?.mode === "read")));
  registerCleanup(() => Effect.runPromise(reads.close));
  const product = Object.freeze({ definition, runtime, reads, source: fixture.source("product") });
  const currency = currencyDefinition === undefined ? undefined : Object.freeze({ definition: currencyDefinition,
    source: fixture.source("currency"), module: Result.getOrThrow(currencyWorkflowModule) });
  const readTable = async (name: string): Promise<readonly JsonObject[]> => {
    const table = definition.tables.find(table => (table.localName ?? table.name) === name);
    if (table === undefined) throw new Error("Unknown admitted Product fixture table: " + name);
    return (await fixture.inventory()).rows.filter(row => row.table === table.name)
      .map(row => structuredClone(Result.getOrThrow(coreNativeRelationalRow(row.value))));
  };
  return { fixture, product, currency, reads, execution: fixture.execution, target, readTable, readPhysicalTables, physicalTablesBeforeCandidate, internalCommands,
    snapshot: fixture.snapshot };
}

export type CoreProductWorkflowFixture = Awaited<ReturnType<typeof createCoreProductWorkflowFixture>>;

/** Trusted module-command test host. Every mutation uses a genuine shared Core
 * root, while observations use the issued source's readonly command profile. */
export const openCoreProductCommandHost = Effect.fn("CoreProductWorkflowFixture.commandHost")(function* (
  base: CoreProductWorkflowFixture, input: { readonly commands?: readonly CommerceCommand[]; readonly requestCallLimit?: number } = {},
): Effect.fn.Return<Pick<CommerceHost, "run" | "read" | "newRequestKey" | "close">, Effect.Error<ReturnType<typeof base.execution.prepare>>> {
  const commands = input.commands ?? base.internalCommands;
  const reads = commands.filter(command => getCommerceCommand(command)?.mode === "read");
  const writes = commands.filter(command => getCommerceCommand(command)?.mode === "write");
  const readHost = reads.length === 0 ? undefined : yield* base.fixture.openReadHost("product", reads);
  if (writes.length === 0) {
    if (readHost === undefined) return yield* commerceError("invalidInput");
    return { ...readHost, run: () => Effect.fail(commerceError("invalidAuthority")), newRequestKey: randomUUID };
  }
  const participant = defineAtomicCommerceParticipant("product");
  const roots = writes.map(command => ({ command, root: defineAtomicCommerceCommand(getCommerceCommand(command)?.name ?? "productCommand", (ctx, value) => ctx.call(participant, command, value)) }));
  const host = yield* base.execution.prepare({ identityAndAccessPolicy: { profile: "product-module-command-test" },
    ...(input.requestCallLimit === undefined ? {} : { requestCallLimit: input.requestCallLimit }),
    participants: [{ participant, nativeStorage: base.product.source, commands: writes }], commands: roots.map(value => value.root) });
  return { read: (command, value) => readHost === undefined ? Effect.fail(commerceError("invalidAuthority")) : readHost.read(command, value),
    run: (key, command, value) => {
      const selected = roots.find(root => root.command === command);
      return selected === undefined ? Effect.fail(commerceError("invalidAuthority")) : host.run(key, selected.root, value);
    }, newRequestKey: host.newRequestKey,
    close: host.close.pipe(Effect.ensuring(readHost?.close ?? Effect.void)) };
});
