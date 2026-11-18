import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/update-fulfillment";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { FulfillmentUpdateInput, prepareFulfillmentUpdateResources, prepareFulfillmentUpdateWorkflow } from "../../src/workflows/fulfillment/update-fulfillment";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { fulfillmentUpdateResources } from "../../src/workflow/policy";
import { prepareLogicalFulfillmentCancellation } from "./logical-fulfillment-cancel-fixture";
import { shippingOptionParents } from "./logical-shipping-option-creation-fixture";

const native = Result.getOrThrow(updateFulfillmentWorkflow.prepare());
const update = native.nodes.find(node => node.name === "update-fulfillment");
if (update?.kind !== "step" || update.compensation !== "transactionCovered" || update.compensate === undefined)
  throw new Error("Missing genuine native Fulfillment update compensation");
const undo = update.compensate;
type NativeInput = Parameters<typeof updateFulfillmentWorkflow.runAsStep>[0]["input"];

/** Borrow the existing twelve-table source, native creation seed and canonical
 * arrangements. Only the actual standalone update root and inverse are added. */
export async function prepareLogicalFulfillmentUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalFulfillmentCancellation(driver, close);
  const option = await base.seedBareOption("update147-shared-option", shippingOptionParents.zone);
  const modules = base.cancellationModules;
  const resources = Result.getOrThrow(prepareFulfillmentUpdateResources({ fulfillment: base.fulfillment.workflow }));
  const options = { execution: base.execution, modules, revision: "7".repeat(64),
    subscribers: [{ id: "native-fulfillment-update", revision: "7".repeat(64) }] };
  const caseHosts: Array<() => Promise<void>> = [];
  const closeCaseHosts = async () => {
    for (const dispose of caseHosts.splice(0).reverse()) await dispose();
    await base.closeCaseHosts();
  };
  close(closeCaseHosts);
  const prepare = async () => {
    const host = await Effect.runPromise(prepareFulfillmentUpdateWorkflow(options));
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const seed = (prefix: string, configuration: Parameters<typeof base.seed>[1] = {}) => base.seed(prefix, {
    ...configuration, input: { shipping_option_id: option, ...configuration.input },
  });
  const prepareWrapped = async (configuration: Readonly<{ retained?: () => unknown; repeat?: boolean; lateFailure?: boolean; forgeEvent?: boolean;
    calls?: number; eventMessages?: number; inspectResources?: (resources: unknown) => void;
    escape?: (retrieve: () => Promise<unknown>) => void }> = {}) => {
    const after = createStep("probe147-update-parent", resources.callback(async (id: string, context) => {
      configuration.inspectResources?.(context.resources);
      configuration.escape?.(() => context.resources.fulfillment.retrieveFulfillment(id, { select: ["id"], relations: [] }));
      // The actual StepResponse preimage is observed by the caller. Never
      // reconstruct an inverse payload from a result or a database snapshot.
      if (configuration.retained !== undefined) {
        await undo(configuration.retained(), context);
        if (configuration.repeat) await undo(configuration.retained(), context);
      }
      if (configuration.forgeEvent) await context.resources.event_bus.emit([{
        name: buildModuleResourceEventName({ prefix: "fulfillment", objectName: "fulfillment", action: "updated" }),
        data: { id: "ful147-forged-event" }, metadata: { eventGroupId: context.eventGroupId },
      }]);
      if (configuration.lateFailure) throw new Error("Late native Fulfillment update parent failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe147-native-update-wrapper", (value: WorkflowData<typeof FulfillmentUpdateInput.Type>) => {
      // SAFETY: the checked runtime profile includes native module/Shipment
      // Labels beyond the upstream standalone workflow authoring interface.
      const root = updateFulfillmentWorkflow.runAsStep({ input: value as NativeInput });
      const done = after(transform(root, result => result.id));
      return new WorkflowResponse(transform({ root, done }, ({ root }) => root));
    });
    const limits = { ...fulfillmentUpdateResources, ...(configuration.calls === undefined ? {} : { calls: configuration.calls }),
      ...(configuration.eventMessages === undefined ? {} : { eventMessages: configuration.eventMessages }) };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      modules: { fulfillment: { ...modules.fulfillment, logicalResources: limits } }, requestCallLimit: limits.calls,
      requestEventLimit: limits.eventMessages, requestByteLimit: limits.commandBytes,
      workflow: { name: "probe147NativeUpdateWrapper", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: FulfillmentUpdateInput, output: base.fulfillment.output, events: internalModuleWorkflowEvents } }));
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareInverseOnly = async (actualRetained: () => unknown) => {
    const inverse = createStep("probe147-separate-root-native-inverse", resources.callback(async (_input: null, context) => {
      await undo(actualRetained(), context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe147-separate-root-native-inverse", () => new WorkflowResponse(inverse(null)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      modules: { fulfillment: { ...modules.fulfillment, logicalResources: fulfillmentUpdateResources } },
      requestCallLimit: fulfillmentUpdateResources.calls, requestEventLimit: fulfillmentUpdateResources.eventMessages,
      requestByteLimit: fulfillmentUpdateResources.commandBytes,
      workflow: { name: "probe147SeparateRootNativeInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  return { ...base, option, resources, updateOptions: options, prepare, seed, prepareWrapped, prepareInverseOnly,
    closeCaseHosts, arrangeUpdate: base.arrangeCancellation };
}
