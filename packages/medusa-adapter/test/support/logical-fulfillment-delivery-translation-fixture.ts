import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/update-fulfillment";
import type { bindWorkflowQuery } from "../../src/workflow/query";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { fulfillmentShipmentResources } from "../../src/workflow/policy";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalFulfillmentShipment } from "./logical-fulfillment-shipment-fixture";

const definition = Result.getOrThrow(updateFulfillmentWorkflow.prepare()), update = definition.nodes.find(node => node.name === "update-fulfillment");
if (update?.kind !== "step" || update.compensation !== "transactionCovered" || update.compensate === undefined)
  throw new Error("Missing actual native Fulfillment update compensation");
const undo = update.compensate;

/** Module/query translation only. These short atomic probes exercise genuine
 * native list/update calls; they do not execute or admit Delivery's lock host. */
export async function prepareLogicalFulfillmentDeliveryTranslation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalFulfillmentShipment(driver, close), resources = Result.getOrThrow(prepareWorkflowResources({
    fulfillment: { module: base.fulfillment.workflow, methods: ["retrieveFulfillment", "updateFulfillment"], graph: true },
  }, true));
  const options = { ...base.shipmentOptions, modules: { fulfillment: { ...base.shipmentModules.fulfillment, logicalResources: fulfillmentShipmentResources } },
    operationScheduling: "queued" as const, requestCallLimit: fulfillmentShipmentResources.calls,
    requestEventLimit: fulfillmentShipmentResources.eventMessages, requestByteLimit: fulfillmentShipmentResources.commandBytes };
  const hosts: Array<() => Promise<void>> = [];
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); await base.closeCaseHosts(); };
  close(closeCaseHosts);
  const queryStep = createStep("probe145-native-fulfillment-singleton", resources.callback(async (id: string, context) => {
    const query = context.container.resolve<ReturnType<typeof bindWorkflowQuery>>("query");
    const rows = await query({ entryPoint: "fulfillment", fields: ["id", "delivered_at", "canceled_at"], variables: { id } },
      { throwIfKeyNotFound: true, throwIfRelationNotFound: undefined });
    return new StepResponse(rows);
  }));
  const queryFlow = createWorkflow("probe145-native-fulfillment-singleton", (id: WorkflowData<string>) => new WorkflowResponse(queryStep(id)));
  const prepareQuery = async () => {
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: {
      name: "probe145NativeFulfillmentSingleton", resources, prepared: Result.getOrThrow(queryFlow.prepare()), input: Schema.String,
      output: Schema.Array(Schema.Struct({ id: Schema.String, delivered_at: Schema.NullOr(Schema.String), canceled_at: Schema.NullOr(Schema.String) })),
      events: internalModuleWorkflowEvents,
    } }));
    hosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareUpdate = async (actualRetained?: () => unknown) => {
    const after = createStep("probe145-native-delivery-update-inverse", resources.callback(async (_id: string, context) => {
      if (actualRetained !== undefined) await undo(actualRetained(), context);
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe145-native-delivery-update", (id: WorkflowData<string>) => {
      const result = updateFulfillmentWorkflow.runAsStep({ input: transform(id, id => ({ id, delivered_at: new Date() })) });
      const done = after(transform(result, result => result.id));
      return new WorkflowResponse(transform({ result, done }, ({ result }) => result));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: {
      name: "probe145NativeDeliveryUpdate", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.String,
      output: base.fulfillment.output, events: internalModuleWorkflowEvents,
    } }));
    hosts.push(() => Effect.runPromise(host.close)); return host;
  };
  return { ...base, prepareQuery, prepareUpdate, closeCaseHosts };
}
