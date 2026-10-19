import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { cancelFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/cancel-fulfillment";
import { defineCommerceCommand, defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { prepareFulfillmentCreationWorkflow } from "../../src/workflows/fulfillment/create-fulfillment";
import { prepareFulfillmentCancellationWorkflow, prepareFulfillmentCancellationResources, FulfillmentCancellationInput } from "../../src/workflows/fulfillment/cancel-fulfillment";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { shippingOptionCreationResources } from "../../src/workflow/policy";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLogicalShippingOptionReferenceDetachment } from "./logical-shipping-option-reference-detachment-fixture";
import { fulfillmentCreationInput } from "./logical-fulfillment-create-fixture";

/** Seed through genuine141 creation; standalone cancellation admits only its
 * existing native method and one source, with no Query or Location participant. */
export async function prepareLogicalFulfillmentCancellation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalShippingOptionReferenceDetachment(driver, close);
  // Test hosts share the database's bounded preparation runtime. Dispose each
  // case's leases without closing that shared fixture or retaining generations
  // from all cancellation cases until suite shutdown.
  const caseHosts: Array<() => Promise<void>> = [];
  const closeCaseHosts = async () => {
    for (const dispose of caseHosts.splice(0).reverse()) await dispose();
  };
  close(closeCaseHosts);
  const { logicalResources: _creationResources, ...installed } = base.modules.fulfillment;
  const modules = { fulfillment: installed };
  const resources = Result.getOrThrow(prepareFulfillmentCancellationResources({ fulfillment: base.fulfillment.workflow }));
  const options = { execution: base.execution, modules, revision: "3".repeat(64), subscribers: [{ id: "native-fulfillment-cancel", revision: "3".repeat(64) }] };
  const prepare = async () => {
    const host = await Effect.runPromise(prepareFulfillmentCancellationWorkflow(options));
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const seed = async (prefix: string, configuration: Readonly<{ maximum?: boolean; input?: Partial<ReturnType<typeof fulfillmentCreationInput>> }> = {}) => {
    const host = await Effect.runPromise(prepareFulfillmentCreationWorkflow(base.options));
    try {
      const input = { ...fulfillmentCreationInput(prefix, configuration.maximum), ...configuration.input };
      return await Effect.runPromise(host.run(host.newRequestKey(), input));
    } finally { await Effect.runPromise(host.close); }
  };
  /** Native witness state arrangement uses actual scoped table operations only.
   * It grants no module method, copies no lifecycle traversal and emits no fake
   * module event. Cancellation remains the genuine promoted workflow/service. */
  const arrange = async (table: "fulfillment" | "fulfillment_provider" | "fulfillment_address" | "fulfillment_item" | "fulfillment_label" | "shipping_option",
    action: "insert" | "update" | "softDelete" | "restore", rows: readonly JsonObject[]) => {
    const command = defineCommerceCommand("fulfillmentCancellationArrangement", "write", Effect.fn(function* (ctx) {
      const store = yield* ctx.table(table);
      if (action === "insert" || action === "update") yield* store.write(ctx.manager, action, rows);
      else yield* store.lifecycle(ctx.manager, action, rows);
      return null;
    }));
    const participant = defineAtomicCommerceParticipant("fulfillment_cancellation_arrangement");
    const root = defineAtomicCommerceCommand("fulfillmentCancellationArrangementRoot", ctx => ctx.call(participant, command, null));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...base.fixture.hostInput, commands: [root],
      participants: [{ participant, logicalStorage: installed.logicalStorage, commands: [command] }] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); } finally { await Effect.runPromise(host.close); }
  };
  /** Genuine142 physical Option deletion on a bare native Option seed. No
   * Pricing/Link row was created and no test-side FK cleanup is supplied. */
  const deleteOption = async (id: string) => {
    const selected = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: base.creation.fulfillment.workflow,
      methods: ["deleteShippingOptions"], graph: false } }, true));
    const remove = createStep("seed143-native-option-physical-delete", selected.callback(async (key: string, context) => {
      await context.resources.fulfillment.deleteShippingOptions([key]); return new StepResponse(null);
    }));
    const flow = createWorkflow("seed143-native-option-physical-delete", (key: WorkflowData<string>) => new WorkflowResponse(remove(key)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution,
      modules: { fulfillment: { ...base.creation.modules.fulfillment, logicalResources: shippingOptionCreationResources } },
      revision: "4".repeat(64), subscribers: [{ id: "cancel143-option-delete", revision: "4".repeat(64) }],
      requestCallLimit: shippingOptionCreationResources.calls, requestEventLimit: shippingOptionCreationResources.eventMessages,
      requestByteLimit: shippingOptionCreationResources.commandBytes,
      workflow: { name: "seed143NativeOptionDelete", resources: selected, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.String, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), id)); } finally { await Effect.runPromise(host.close); }
  };
  const prepareWrapped = async (configuration: Readonly<{ lateFailure?: boolean; repeat?: boolean; calls?: number; eventMessages?: number;
    inspectResources?: (resources: unknown) => void; escape?: (cancel: (id: string) => Promise<unknown>) => void }> = {}) => {
    const after = createStep("probe143-cancellation-parent", resources.callback(async (id: string, context) => {
      configuration.inspectResources?.(context.resources);
      configuration.escape?.(context.resources.fulfillment.cancelFulfillment);
      if (configuration.repeat) await context.resources.fulfillment.cancelFulfillment(id);
      if (configuration.lateFailure) throw new Error("Late standalone Fulfillment cancellation parent failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe143-native-cancellation-wrapper", (value: WorkflowData<typeof FulfillmentCancellationInput.Type>) => {
      const canceled = cancelFulfillmentWorkflow.runAsStep({ input: value });
      const done = after(transform({ value, canceled }, ({ value }) => value.id));
      return new WorkflowResponse(done);
    });
    const limits = { ...defaultCommerceResources, ...(configuration.calls === undefined ? {} : { calls: configuration.calls }),
      ...(configuration.eventMessages === undefined ? {} : { eventMessages: configuration.eventMessages }) };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      modules: { fulfillment: { ...installed, logicalResources: limits } }, requestCallLimit: limits.calls,
      requestEventLimit: limits.eventMessages, requestByteLimit: limits.commandBytes,
      workflow: { name: "probe143NativeCancellationWrapper", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: FulfillmentCancellationInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  return { ...base, cancellationOptions: options, cancellationModules: modules, cancellationResources: resources,
    closeCaseHosts, prepare, seed, arrangeCancellation: arrange, deleteOption, prepareWrapped };
}
