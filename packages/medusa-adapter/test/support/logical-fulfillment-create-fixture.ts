import { Effect, Result } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/create-fulfillment";
import { createStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/create-stock-locations";
import { defineCommerceCommand, defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeLocalFulfillmentCreationCommands } from "../../src/modules/fulfillment/fulfillment-create-service";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { StockLocationsInput, StockLocationsOutput } from "../../src/modules/stock-location/input";
import { prepareFulfillmentCreationWorkflow, prepareFulfillmentCreationResources, FulfillmentCreationInput } from "../../src/workflows/fulfillment/create-fulfillment";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { fulfillmentCreationResources, fulfillmentCreationCommandMs } from "../../src/workflow/policy";
import { prepareLogicalShippingOptionCreation, shippingOptionCreationInput, shippingOptionParents } from "./logical-shipping-option-creation-fixture";

type NativeInput = Parameters<typeof createFulfillmentWorkflow.runAsStep>[0]["input"];
const native = Result.getOrThrow(createFulfillmentWorkflow.prepare());
const creation = native.nodes.find(node => node.name === "create-fulfillment");
if (creation?.kind !== "step" || creation.compensation !== "transactionCovered" || creation.compensate === undefined)
  throw new Error("Missing genuine Fulfillment creation retained inverse");
const undo = creation.compensate;

export function fulfillmentCreationInput(prefix: string, maximum = false): typeof FulfillmentCreationInput.Type {
  return { location_id: shippingOptionParents.location, provider_id: shippingOptionParents.provider,
    delivery_address: { first_name: "  First  ", last_name: "Last", address_1: prefix + " street", country_code: "us",
      city: "City", metadata: { nested: { retained: [null, " raw "] } } },
    items: Array.from({ length: maximum ? 4 : 1 }, (_, index) => ({ title: prefix + " item " + index, sku: prefix + "-sku-" + index,
      barcode: prefix + "-barcode-" + index, quantity: index === 0 ? "0.125" : index === 1 ? 0 : index === 2 ? -1 : 2,
      line_item_id: "line-" + index, inventory_item_id: "inventory-" + index })),
    labels: Array.from({ length: maximum ? 4 : 1 }, (_, index) => ({ tracking_number: prefix + "-tracking-" + index,
      tracking_url: "https://example.test/tracking/" + index, label_url: "https://example.test/labels/" + index })),
    data: { preserved: { value: prefix } }, metadata: { witness: prefix },
    order: { id: "inline-order-" + prefix, nested: { retained: true } },
  };
}

/** Reuse the existing installed Shipping Option source, genuine Manual service
 * and endpoint seeds. All consumers use the same fresh twelve-table source. */
export async function prepareLogicalFulfillmentCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareLogicalShippingOptionCreation>[2]) {
  const base = await prepareLogicalShippingOptionCreation(driver, close, shared);
  const fulfillment = await Effect.runPromise(makeLocalFulfillmentCreationCommands());
  const stockLocation = await Effect.runPromise(makeStockLocationCommands("update"));
  const modules = { fulfillment: { ...base.modules.fulfillment, module: fulfillment.workflow, logicalResources: fulfillmentCreationResources },
    stockLocation: { ...base.modules.stockLocation, module: stockLocation.workflow, logicalResources: fulfillmentCreationResources } };
  const resources = Result.getOrThrow(prepareFulfillmentCreationResources({ fulfillment: fulfillment.workflow, stockLocation: stockLocation.workflow }));
  const options = { execution: base.execution, modules, revision: "1".repeat(64), subscribers: [{ id: "native-fulfillment-create", revision: "1".repeat(64) }] };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareFulfillmentCreationWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRoundtrip = async (actualRetained: () => unknown, configuration?: Readonly<{ lateFailure?: boolean; repeat?: boolean;
    calls?: number; eventMessages?: number; inspectResources?: (resources: unknown) => void }>) => {
    const inverse = createStep("probe-fulfillment-native-inverse", resources.callback(async (_input: null, context) => {
      configuration?.inspectResources?.(context.resources);
      const actual = actualRetained();
      await undo(actual, context);
      if (configuration?.repeat) await undo(actual, context);
      if (configuration?.lateFailure) throw new Error("Late genuine Fulfillment creation inverse failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-fulfillment-retained-inverse", (value: WorkflowData<typeof FulfillmentCreationInput.Type>) => {
      // SAFETY: checked runtime input also retains native null item/address and
      // signed string quantity branches beyond the upstream authoring DTO.
      const root = createFulfillmentWorkflow.runAsStep({ input: value as NativeInput });
      const done = inverse(transform(root, () => null));
      return new WorkflowResponse(transform({ root, done }, ({ root }) => root));
    });
    const limits = { ...fulfillmentCreationResources, ...(configuration?.calls === undefined ? {} : { calls: configuration.calls }),
      ...(configuration?.eventMessages === undefined ? {} : { eventMessages: configuration.eventMessages }) };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      modules: { fulfillment: { ...modules.fulfillment, logicalResources: limits }, stockLocation: { ...modules.stockLocation, logicalResources: limits } },
      requestCallLimit: limits.calls, requestEventLimit: limits.eventMessages, requestByteLimit: limits.commandBytes, requestCommandMs: fulfillmentCreationCommandMs,
      workflow: { name: "probeFulfillmentRetainedInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: FulfillmentCreationInput,
        output: fulfillment.output,
        events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const seedOption = async (prefix: string) => {
    const host = await base.prepare();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), shippingOptionCreationInput(prefix)));
    const id = result[0]?.id;
    if (typeof id !== "string") throw new Error("Missing genuine Shipping Option ID");
    return id;
  };
  const seedLocation = async (id: string, rich = true) => {
    const stock = await Effect.runPromise(makeStockLocationCommands("create"));
    const selected = Result.getOrThrow(prepareWorkflowResources({ stock_location: { module: stock.workflow, methods: ["createStockLocations"], graph: false } }, true));
    const flow = createWorkflow("seed-fulfillment-stock-location", (value: WorkflowData<typeof StockLocationsInput.Type>) =>
      new WorkflowResponse(createStockLocationsWorkflow.runAsStep({ input: { locations: value } })));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution,
      modules: { stock_location: { ...base.modules.stockLocation, module: stock.workflow } }, revision: "2".repeat(64),
      subscribers: [{ id: "seed-fulfillment-location", revision: "2".repeat(64) }],
      workflow: { name: "seedFulfillmentLocation", resources: selected, prepared: Result.getOrThrow(flow.prepare()),
        input: StockLocationsInput, output: StockLocationsOutput, events: internalModuleWorkflowEvents } }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), [{ id, name: id, ...(rich ? { address: { id: id + "-address",
      address_1: "Location street", country_code: "GB", city: "Location city", metadata: { warehouse: true } } } : {}) }])); }
    finally { await Effect.runPromise(host.close); }
  };
  /** Test-only history/bootstrap uses canonical scoped table capabilities. It
   * neither adds a public module method nor copies native cascade logic. */
  const arrange = async (source: "fulfillment" | "stockLocation", table: "shipping_option" | "stock_location" | "fulfillment_provider",
    action: "softDelete" | "insert", values: readonly JsonObject[]) => {
    const command = defineCommerceCommand("fulfillmentCreationEndpointArrangement", "write", Effect.fn(function* (ctx) {
      const store = yield* ctx.table(table);
      if (action === "insert") yield* store.write(ctx.manager, "insert", values);
      else yield* store.lifecycle(ctx.manager, "softDelete", values);
      return null;
    }));
    const participant = defineAtomicCommerceParticipant("fulfillment_creation_arrangement");
    const root = defineAtomicCommerceCommand("fulfillmentCreationEndpointArrangementRoot", ctx => ctx.call(participant, command, null));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...base.fixture.hostInput,
      participants: [{ participant, logicalStorage: modules[source].logicalStorage, commands: [command] }], commands: [root] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); } finally { await Effect.runPromise(host.close); }
  };
  return { ...base, creation: base, fulfillment, stockLocation, modules, resources, options, prepare, prepareRoundtrip, seedOption, seedLocation, arrange };
}
