import { Effect, Result } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createReturnFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/create-return-fulfillment";
import { defineCommerceCommand, defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { prepareFulfillmentReturnWorkflow, prepareFulfillmentReturnResources, FulfillmentReturnInput } from "../../src/workflows/fulfillment/create-return-fulfillment";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { fulfillmentCreationResources, fulfillmentCreationCommandMs } from "../../src/workflow/policy";
import { fulfillmentCreationInput, prepareLogicalFulfillmentCreation } from "./logical-fulfillment-create-fixture";

const native = Result.getOrThrow(createReturnFulfillmentWorkflow.prepare());
const creation = native.nodes.find(node => node.name === "create-return-fulfillment");
if (creation?.kind !== "step" || creation.compensation !== "transactionCovered" || creation.compensate === undefined)
  throw new Error("Missing genuine native Return retained cancellation");
const undo = creation.compensate;
type NativeInput = Parameters<typeof createReturnFulfillmentWorkflow.runAsStep>[0]["input"];

/** Existing twelve-table source, native Manual provider and creation seeds.
 * Only the genuine Return graph and its original retained callback are added. */
export async function prepareLogicalFulfillmentReturn(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalFulfillmentCreation(driver, close);
  const option = await base.seedOption("return146-shared-option");
  const resources = Result.getOrThrow(prepareFulfillmentReturnResources({ fulfillment: base.fulfillment.workflow,
    stockLocation: base.stockLocation.workflow }));
  const options = { execution: base.execution, modules: base.modules, revision: "6".repeat(64),
    subscribers: [{ id: "native-fulfillment-return", revision: "6".repeat(64) }] };
  const caseHosts: Array<() => Promise<void>> = [];
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const input = (prefix: string, maximum = false): typeof FulfillmentReturnInput.Type => ({ ...fulfillmentCreationInput(prefix, maximum), shipping_option_id: option });
  const seed = async (prefix: string, maximum = false) => {
    const host = await base.prepare();
    try { return await Effect.runPromise(host.run(host.newRequestKey(), input(prefix, maximum))); }
    finally { await Effect.runPromise(host.close); }
  };
  const prepare = async () => {
    const host = await Effect.runPromise(prepareFulfillmentReturnWorkflow(options));
    caseHosts.push(() => Effect.runPromise(host.close));
    return host;
  };
  /** Canonical fixture arrangement changes only an existing Option's declared
   * provider/data/metadata columns. It neither implements native update logic
   * nor grants those writes to the Return workflow. */
  const arrangeOption = async (id: string, fields: Readonly<{ data: JsonObject; metadata: JsonObject; provider_id?: string }>) => {
    const command = defineCommerceCommand("return146OptionArrangement", "write", Effect.fn(function* (context) {
      const table = yield* context.table("shipping_option");
      yield* table.write(context.manager, "update", [{ id, ...fields }]);
      return null;
    }));
    const participant = defineAtomicCommerceParticipant("return146OptionArrangement");
    const root = defineAtomicCommerceCommand("return146OptionArrangementRoot", context => context.call(participant, command, null));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...base.fixture.hostInput, commands: [root],
      participants: [{ participant, logicalStorage: base.modules.fulfillment.logicalStorage, commands: [command] }] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); }
    finally { await Effect.runPromise(host.close); }
  };
  const prepareWrapped = async (configuration: Readonly<{ retained?: () => unknown; repeat?: boolean; lateFailure?: boolean;
    calls?: number; eventMessages?: number; inspectResources?: (resources: unknown) => void;
    escape?: (cancel: (id: string) => Promise<unknown>) => void }> = {}) => {
    const after = createStep("probe146-return-parent", resources.callback(async (_id: string, context) => {
      configuration.inspectResources?.(context.resources);
      configuration.escape?.(context.resources.fulfillment.cancelFulfillment);
      if (configuration.retained !== undefined) {
        // This is the actual StepResponse ID observed by the caller. Never
        // derive an inverse argument from stored rows or the returned DTO.
        await undo(configuration.retained(), context);
        if (configuration.repeat) await undo(configuration.retained(), context);
      }
      if (configuration.lateFailure) throw new Error("Late native Return parent failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe146-native-return-wrapper", (value: WorkflowData<typeof FulfillmentReturnInput.Type>) => {
      // SAFETY: the checked shared input retains native nullable collections,
      // Address fields and signed/string quantities beyond the authoring DTO.
      const created = createReturnFulfillmentWorkflow.runAsStep({ input: value as NativeInput });
      const done = after(created.id);
      return new WorkflowResponse(transform({ created, done }, ({ created }) => created));
    });
    const limits = { ...fulfillmentCreationResources, ...(configuration.calls === undefined ? {} : { calls: configuration.calls }),
      ...(configuration.eventMessages === undefined ? {} : { eventMessages: configuration.eventMessages }) };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      modules: { fulfillment: { ...base.modules.fulfillment, logicalResources: limits }, stockLocation: { ...base.modules.stockLocation, logicalResources: limits } },
      requestCallLimit: limits.calls, requestEventLimit: limits.eventMessages, requestByteLimit: limits.commandBytes,
      requestCommandMs: fulfillmentCreationCommandMs,
      workflow: { name: "probe146NativeReturnWrapper", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: FulfillmentReturnInput, output: base.fulfillment.output, events: internalModuleWorkflowEvents } }));
    caseHosts.push(() => Effect.runPromise(host.close));
    return host;
  };
  return { ...base, option, input, seed, prepare, resources, prepareWrapped, arrangeOption, closeCaseHosts };
}
