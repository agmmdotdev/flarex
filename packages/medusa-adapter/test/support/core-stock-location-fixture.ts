import { createHash, randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/create-stock-locations";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { StockLocationsInput, StockLocationsOutput } from "../../src/modules/stock-location/input";
import { prepareStockLocationUpdateWorkflow } from "../../src/workflows/stock-location/update";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
const seedWorkflow = createWorkflow("seed-stock-location-update", (input: WorkflowData<typeof StockLocationsInput.Type>) =>
  new WorkflowResponse(createStockLocationsWorkflow.runAsStep({ input: { locations: input } })));

/** Genuine Stock creation/update methods share the translated two-table source,
 * one app owner and its ordinary native workflow/event lifetime. */
export async function prepareCoreStockLocation(
  driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ physical: CorePersistenceFixture }>,
) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const definition = await Effect.runPromise(compileStockLocationCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const creation = await Effect.runPromise(makeStockLocationCommands("create"));
  const stock = await Effect.runPromise(makeStockLocationCommands("update"));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    ...(shared === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(shared.physical) }),
    sources: [{ name: "stock_location", definition, initialCommands: stock.commands, rows: [] }],
  });
  close(fixture.close);
  const source = fixture.source("stock_location"), execution = fixture.execution;
  const reader = await fixture.run(fixture.openReadHost("stock_location", [stock.list, stock.listAddresses]));
  close(() => Effect.runPromise(reader.close));
  const seedResources = await Effect.runPromise(Effect.fromResult(prepareWorkflowResources({
    stock_location: { module: creation.workflow, methods: ["createStockLocations"], graph: false },
  }, true)));
  const creator = await Effect.runPromise(prepareAtomicWorkflowHost({ execution,
    modules: { stock_location: { module: creation.workflow, nativeStorage: source } },
    revision: createHash("sha256").update("native-stock-location-update-seed-113").digest("hex"),
    subscribers: [{ id: "native-stock-location-update-seed", revision: "c".repeat(64) }],
    workflow: { name: "seedStockLocationUpdate", resources: seedResources,
      prepared: await Effect.runPromise(Effect.fromResult(seedWorkflow.prepare())),
      input: StockLocationsInput, output: StockLocationsOutput, events: internalModuleWorkflowEvents },
  }));
  close(() => Effect.runPromise(creator.close));
  const options = { execution, modules: { stock_location: { module: stock.workflow, nativeStorage: source } },
    revision: createHash("sha256").update("native-stock-location-update-113").digest("hex"),
    subscribers: [{ id: "native-stock-location-update", revision: "d".repeat(64) }],
  } satisfies Parameters<typeof prepareStockLocationUpdateWorkflow>[0];
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareStockLocationUpdateWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const seed = async (prefix: string, count = 1, addresses: "all" | "none" | "mixed" = "all") => {
    const entries: typeof StockLocationsInput.Type = Array.from({ length: count }, (_, index) => ({
      id: prefix + "-" + index, name: prefix, metadata: { keep: "location-" + index, drop: "old" },
      ...(addresses === "all" || addresses === "mixed" && index % 2 === 0
        ? { address: { id: prefix + "-address-" + index, address_1: "Street " + index, country_code: "US", city: "Before",
          metadata: { keep: "address-" + index, drop: "old" } } } : {}),
    }));
    for (let offset = 0; offset < entries.length; offset += 4)
      await Effect.runPromise(creator.run(creator.newRequestKey(), entries.slice(offset, offset + 4)));
    return entries.map(row => row.id).filter((id): id is string => id !== undefined);
  };
  const list = (ids: readonly string[], address = false) => reader.read(stock.list,
    { filters: { id: [...ids] }, config: { order: { id: "ASC" }, ...(address ? { relations: ["address"] } : {}) } })
    .pipe(Effect.flatMap(decodeRows));
  const addresses = (ids?: readonly string[]) => reader.read(stock.listAddresses,
    { filters: ids === undefined ? {} : { id: [...ids] }, config: { order: { id: "ASC" } } }).pipe(Effect.flatMap(decodeRows));
  return { fixture, target, definition, stock, source, reader, execution, options, prepare, creator, seed, list, addresses };
}
