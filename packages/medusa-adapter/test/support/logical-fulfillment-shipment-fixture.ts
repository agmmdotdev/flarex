import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createShipmentWorkflow } from "@medusajs/core-flows/fulfillment/create-shipment";
import { updateFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/update-fulfillment";
import { fulfillmentShipmentResources } from "../../src/workflow/policy";
import { prepareFulfillmentShipmentWorkflow, prepareFulfillmentShipmentResources, FulfillmentShipmentInput } from "../../src/workflows/fulfillment/create-shipment";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalFulfillmentCancellation } from "./logical-fulfillment-cancel-fixture";
import { shippingOptionParents } from "./logical-shipping-option-creation-fixture";

const native = Result.getOrThrow(updateFulfillmentWorkflow.prepare());
const update = native.nodes.find(node => node.name === "update-fulfillment");
if (update?.kind !== "step" || update.compensation !== "transactionCovered" || update.compensate === undefined)
  throw new Error("Missing genuine native Fulfillment update retained inverse");
const undo = update.compensate;

/** Reuse the installed twelve-table source, genuine creation seed and canonical
 * state arrangements. Shipment receives only the two native update methods. */
export async function prepareLogicalFulfillmentShipment(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalFulfillmentCancellation(driver, close);
  const option = await base.seedBareOption("shipment144-shared-option", shippingOptionParents.zone);
  const resources = Result.getOrThrow(prepareFulfillmentShipmentResources({ fulfillment: base.fulfillment.workflow }));
  const modules = base.cancellationModules;
  const options = { execution: base.execution, modules, revision: "5".repeat(64),
    subscribers: [{ id: "native-fulfillment-shipment", revision: "5".repeat(64) }] };
  const caseHosts: Array<() => Promise<void>> = [];
  const closeCaseHosts = async () => {
    for (const dispose of caseHosts.splice(0).reverse()) await dispose();
    await base.closeCaseHosts();
  };
  close(closeCaseHosts);
  const prepare = async () => {
    const host = await Effect.runPromise(prepareFulfillmentShipmentWorkflow(options));
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const seed = (prefix: string, configuration: Parameters<typeof base.seed>[1] = {}) => base.seed(prefix, {
    ...configuration, input: { shipping_option_id: option, ...configuration.input },
  });
  const prepareWrapped = async (configuration: Readonly<{ retained?: () => unknown; lateFailure?: boolean;
    calls?: number; eventMessages?: number; inspectResources?: (resources: unknown) => void;
    escape?: (retrieve: () => Promise<unknown>) => void }> = {}) => {
    const after = createStep("probe144-shipment-parent", resources.callback(async (id: string, context) => {
      configuration.inspectResources?.(context.resources);
      configuration.escape?.(() => context.resources.fulfillment.retrieveFulfillment(id, { select: ["id"], relations: [] }));
      // The caller supplies the actual StepResponse preimage observed during
      // this genuine forward execution; no inverse payload is reconstructed.
      if (configuration.retained !== undefined) await undo(configuration.retained(), context);
      if (configuration.lateFailure) throw new Error("Late native shipment parent failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe144-native-shipment-wrapper", (value: WorkflowData<typeof FulfillmentShipmentInput.Type>) => {
      const root = createShipmentWorkflow.runAsStep({ input: value });
      const done = after(transform(root, value => value.id));
      return new WorkflowResponse(transform({ root, done }, ({ root }) => root));
    });
    const limits = { ...fulfillmentShipmentResources, ...(configuration.calls === undefined ? {} : { calls: configuration.calls }),
      ...(configuration.eventMessages === undefined ? {} : { eventMessages: configuration.eventMessages }) };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      modules: { fulfillment: { ...modules.fulfillment, logicalResources: limits } }, requestCallLimit: limits.calls,
      requestEventLimit: limits.eventMessages, requestByteLimit: limits.commandBytes,
      workflow: { name: "probe144NativeShipmentWrapper", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: FulfillmentShipmentInput, output: base.fulfillment.output, events: internalModuleWorkflowEvents } }));
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  /** A genuine inverse invoked in another root does not inherit the earlier
   * root's deletion proof. Only the existing core owner decides admission. */
  const prepareInverseOnly = async (actualRetained: () => unknown) => {
    const inverse = createStep("probe144-separate-root-native-inverse", resources.callback(async (_input: null, context) => {
      await undo(actualRetained(), context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe144-separate-root-native-inverse", () => new WorkflowResponse(inverse(null)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      modules: { fulfillment: { ...modules.fulfillment, logicalResources: fulfillmentShipmentResources } },
      requestCallLimit: fulfillmentShipmentResources.calls, requestEventLimit: fulfillmentShipmentResources.eventMessages,
      requestByteLimit: fulfillmentShipmentResources.commandBytes,
      workflow: { name: "probe144SeparateRootNativeInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  return { ...base, shipmentOptions: options, shipmentResources: resources, shipmentModules: modules,
    option, prepare, seed, prepareWrapped, prepareInverseOnly, closeCaseHosts, arrangeShipment: base.arrangeCancellation };
}
