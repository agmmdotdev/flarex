import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/create-stock-locations";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { StockLocationsInput, StockLocationsOutput } from "../../src/modules/stock-location/input";
import { prepareStockLocationUpdateWorkflow } from "../../src/workflows/stock-location/update";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
const seedWorkflow = createWorkflow("seed-stock-location-update", (input: WorkflowData<typeof StockLocationsInput.Type>) =>
  new WorkflowResponse(createStockLocationsWorkflow.runAsStep({ input: { locations: input } })));

/** The existing native creation service seeds this genuine two-table source.
 * Reads and updates use the named profile and the ordinary shared host owner. */
export async function prepareLogicalStockLocationUpdate(
  driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>,
) {
  const fixture = shared === undefined
    ? await logicalCurrencyFixture(driver, registerCleanup, { includeStockLocation: true })
    : await logicalCurrencyFixture(driver, registerCleanup, { includeStockLocation: true, ...shared });
  const definition = fixture.stockLocationDefinition;
  if (definition === undefined) throw new Error("Missing Stock Location source");
  const creation = await Effect.runPromise(makeStockLocationCommands("create"));
  const stock = await Effect.runPromise(makeStockLocationCommands("update"));
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid Stock Location initialization"),
      hashFailure: cause => new Error("Stock Location initialization hash", { cause }) }));
  const sourceInput = { ...fixture.hostInput,
    identityAndAccessPolicy: { profile: "logical-stock-location-update-internal-test" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.stockLocation", writeProfile: "medusa.stockLocation", schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "stock-location-update-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } },
    commands: stock.commands,
  } satisfies LogicalCommerceHostInput<unknown>;
  const reader = await Effect.runPromise(makeCommerceHost(sourceInput));
  registerCleanup(() => Effect.runPromise(reader.close));
  await Effect.runPromise(reader.initialize([]));
  const execution: AtomicWorkflowExecution = {
    identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }),
  };
  const seedResources = await Effect.runPromise(Effect.fromResult(prepareWorkflowResources({
    stock_location: { module: creation.workflow, methods: ["createStockLocations"], graph: false },
  }, true)));
  const creator = await Effect.runPromise(prepareAtomicWorkflowHost({ execution,
    modules: { stock_location: { module: creation.workflow, logicalStorage: sourceInput.logicalStorage } },
    revision: createHash("sha256").update("native-stock-location-update-seed-113").digest("hex"),
    subscribers: [{ id: "native-stock-location-update-seed", revision: "c".repeat(64) }],
    workflow: { name: "seedStockLocationUpdate", resources: seedResources,
      prepared: await Effect.runPromise(Effect.fromResult(seedWorkflow.prepare())),
      input: StockLocationsInput, output: StockLocationsOutput, events: internalModuleWorkflowEvents },
  }));
  registerCleanup(() => Effect.runPromise(creator.close));
  const options: Parameters<typeof prepareStockLocationUpdateWorkflow>[0] = {
    execution, modules: { stock_location: { module: stock.workflow, logicalStorage: sourceInput.logicalStorage } },
    revision: createHash("sha256").update("native-stock-location-update-113").digest("hex"),
    subscribers: [{ id: "native-stock-location-update", revision: "d".repeat(64) }],
  };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareStockLocationUpdateWorkflow({ ...options, revision }));
    registerCleanup(() => Effect.runPromise(host.close));
    return host;
  };
  const seed = async (prefix: string, count = 1, addresses: "all" | "none" | "mixed" = "all") => {
    const entries: typeof StockLocationsInput.Type = Array.from({ length: count }, (_, index) => ({
      id: prefix + "-" + index, name: prefix,
      metadata: { keep: "location-" + index, drop: "old" },
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
  return { fixture, definition, stock, execution, options, prepare, seed, list, addresses };
}
