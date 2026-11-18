import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import type { CommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";

export interface CoreSalesChannelOptions {
  readonly includeProduct?: boolean;
  readonly physical?: CorePersistenceFixture;
}

/** The selected native sources share one actual Core installation and owner. */
export async function prepareCoreSalesChannel(driver: "pglite" | "postgres",
  close: (cleanup: () => Promise<void>) => void, options: CoreSalesChannelOptions = {}) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const runtime = await Effect.runPromise(makeLocalSalesChannelCommands());
  const definition = await Effect.runPromise(compileSalesChannelCoreDefinition(target));
  if (definition.source.definition.kind !== "relational") throw new Error("Missing native Sales Channel schema");
  const schema = definition.source.definition.schema;
  const productRuntime = options.includeProduct === true ? await Effect.runPromise(makeLocalProductCommands()) : undefined;
  const productDefinition = productRuntime === undefined ? undefined : await Effect.runPromise(compileProductCoreDefinition(target));
  const sources: CoreNativeWorkflowSource[] = [{ name: "sales_channel", definition, initialCommands: runtime.commands, rows: [] }];
  if (productRuntime !== undefined && productDefinition !== undefined)
    sources.push({ name: "product", definition: productDefinition, initialCommands: Object.values(productRuntime.commands), rows: [] });
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const physical = options.physical === undefined ? undefined : await shareCoreNativeWorkflowPhysical(options.physical);
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources, eventDefinition,
    ...(physical === undefined ? {} : { physical }) });
  close(fixture.close);
  const openRead = (commands: readonly CommerceCommand[] = [runtime.list, runtime.count, runtime.retrieve]) =>
    fixture.openReadHost("sales_channel", commands);
  const reads = await fixture.run(openRead());
  close(() => Effect.runPromise(reads.close));
  const product = productRuntime === undefined || productDefinition === undefined ? undefined : {
    definition: productDefinition, runtime: productRuntime, source: fixture.source("product"),
  };
  const readPhysicalTables = () => fixture.physical.query("select tablename as name from pg_tables where schemaname = $1 order by tablename",
    [fixture.physical.namespace]);
  const physicalTablesBeforeCandidate = await readPhysicalTables();
  return { fixture, target, execution: fixture.execution,
    sales: { definition, schema, runtime, source: fixture.source("sales_channel"), reads }, product, openRead,
    snapshot: fixture.snapshot, readPhysicalTables, physicalTablesBeforeCandidate };
}
