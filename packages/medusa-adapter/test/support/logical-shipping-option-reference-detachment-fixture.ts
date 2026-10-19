import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createShippingOptionsWorkflow } from "@medusajs/core-flows/fulfillment/create-shipping-options";
import { createServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/create-service-zones";
import { createFulfillmentSets } from "@medusajs/core-flows/fulfillment/create-fulfillment-set-step";
import { createLocationFulfillmentSetWorkflow } from "@medusajs/core-flows/stock-location/create-location-fulfillment-set";
import { createFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/create-fulfillment";
import { defineCommerceCommand, defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources, type PreparedWorkflowResources } from "../../src/workflow/resources";
import type { WorkflowModule } from "../../src/workflow/module";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { shippingOptionCreationResources } from "../../src/workflow/policy";
import { FulfillmentSetCreates } from "../../src/modules/fulfillment/fulfillment-set-create-input";
import { makeServiceZoneCreationWithReferenceDetachmentCommands } from "../../src/modules/fulfillment/service-zone-create-service";
import { makeFulfillmentSetCreationWithReferenceDetachmentCommands } from "../../src/modules/fulfillment/fulfillment-set-create-service";
import { makeLocalFulfillmentShippingOptionReferenceDetachmentCommands } from "../../src/modules/fulfillment/fulfillment-reference-detachment-service";
import { prepareServiceZoneCreationWorkflow } from "../../src/workflows/fulfillment/create-service-zones";
import { prepareLogicalFulfillmentCreation, fulfillmentCreationInput } from "./logical-fulfillment-create-fixture";
import { shippingOptionCreationInput, shippingOptionParents, type ShippingOptionRetained } from "./logical-shipping-option-creation-fixture";

const native = Result.getOrThrow(createShippingOptionsWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine Shipping Option retained callback " + name);
  return node.compensate;
}
const undo = { creation: retained("create-shipping-options-step"), pricing: retained("add-shipping-options-prices-step"),
  links: retained("set-shipping-options-price-sets-step") };
const optionNode = native.nodes.find(node => node.name === "create-shipping-options-step");
if (optionNode?.kind !== "step") throw new Error("Missing actual native Option forward step");
const invokeOption = optionNode.invoke;
function parentInverse(kind: "zone" | "set") {
  const workflow = Result.getOrThrow((kind === "zone" ? createServiceZonesWorkflow : createLocationFulfillmentSetWorkflow).prepare());
  const node = workflow.nodes.find(node => node.name === (kind === "zone" ? "create-service-zones" : "create-fulfillment-sets"));
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing actual native parent creation inverse");
  return node.compensate;
}

/** A committed-reference witness deliberately uses separate genuine native
 * roots. It does not pretend that two Fulfillment module profiles are one
 * authenticated same-root resource. Native callback data comes from the
 * original forward StepResponses observed by the caller. */
export async function prepareLogicalShippingOptionReferenceDetachment(driver: "pglite" | "postgres",
  close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalFulfillmentCreation(driver, close, undefined, "reference-detachment");
  const zone = await Effect.runPromise(makeServiceZoneCreationWithReferenceDetachmentCommands()),
    set = await Effect.runPromise(makeFulfillmentSetCreationWithReferenceDetachmentCommands());
  const registration = <Module>(module: Module) => ({ ...base.creation.modules.fulfillment, module });
  const prepareOptionInverse = async (actualRetained: () => ShippingOptionRetained, lateFailure = false) => {
    const creation = base.creation;
    const inverse = createStep("probe-committed-option-native-inverse", creation.resources.callback(async (_input: null, context) => {
      const actual = actualRetained();
      // These are the actual native retained callbacks in native inverse order.
      // Previously committed events remain durable; this separate root invokes
      // no fabricated grouped-event-clear payload for the earlier settlement.
      await undo.links(actual.links, context);
      await undo.pricing(actual.pricing, context);
      await undo.creation(actual.creation, context);
      if (lateFailure) throw new Error("Late native Option reference detachment failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-committed-option-reference-detachment", () => new WorkflowResponse(inverse(null)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...creation.options, operationScheduling: "queued",
      requestCallLimit: shippingOptionCreationResources.calls, requestEventLimit: shippingOptionCreationResources.eventMessages,
      requestByteLimit: shippingOptionCreationResources.commandBytes,
      workflow: { name: "probeCommittedOptionReferenceDetachment", resources: creation.resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareZone = async () => {
    const host = await Effect.runPromise(prepareServiceZoneCreationWorkflow({ execution: base.execution,
      modules: { fulfillment: registration(zone.workflow) }, revision: "2".repeat(64), subscribers: [{ id: "detach142-zone", revision: "2".repeat(64) }] }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareSet = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: set.workflow,
      methods: ["createFulfillmentSets", "deleteFulfillmentSets"], graph: false } }, true));
    const flow = createWorkflow("probe142-native-set-creation", (value: WorkflowData<typeof FulfillmentSetCreates.Type>) =>
      new WorkflowResponse(createFulfillmentSets(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution, modules: { fulfillment: registration(set.workflow) },
      revision: "3".repeat(64), subscribers: [{ id: "detach142-set", revision: "3".repeat(64) }],
      workflow: { name: "probe142NativeSetCreation", resources, prepared: Result.getOrThrow(flow.prepare()), input: FulfillmentSetCreates,
        output: set.output, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareParentInverse = async (kind: "zone" | "set", actualRetained: () => unknown, lateFailure = false) => {
    const compensate = parentInverse(kind);
    const prepareSelected = async <Module extends WorkflowModule, Resources>(module: Module, resources: PreparedWorkflowResources<Resources>) => {
      const inverse = createStep("probe142-native-parent-inverse", resources.callback(async (_input: null, context) => {
        await compensate(actualRetained(), context);
        if (lateFailure) throw new Error("Late native parent detachment failure");
        return new StepResponse(null);
      }));
      const flow = createWorkflow("probe142-native-parent-inverse", () => new WorkflowResponse(inverse(null)));
      const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution, modules: { fulfillment: registration(module) },
        revision: "4".repeat(64), subscribers: [{ id: "detach142-parent", revision: "4".repeat(64) }],
        workflow: { name: "probe142NativeParentInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null,
          events: internalModuleWorkflowEvents } }));
      close(() => Effect.runPromise(host.close)); return host;
    };
    return kind === "zone" ? prepareSelected(zone.workflow, Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: zone.workflow,
      methods: ["createServiceZones", "deleteServiceZones"], graph: false } }, true))) : prepareSelected(set.workflow,
      Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: set.workflow,
        methods: ["createFulfillmentSets", "deleteFulfillmentSets"], graph: false } }, true)));
  };
  const seedBareOption = async (prefix: string, zoneId: string) => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: base.creation.fulfillment.workflow,
      methods: ["upsertShippingOptions", "deleteShippingOptions"], graph: false } }, true));
    const forward = createStep("probe142-native-option-only-forward", resources.callback((_input: null, context) => invokeOption(
      shippingOptionCreationInput(prefix).map(({ prices: _prices, ...value }) => ({ ...value, service_zone_id: zoneId, type: shippingOptionParents.type })), context)));
    const flow = createWorkflow("probe142-native-option-only-forward", () => new WorkflowResponse(forward(null)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution,
      modules: { fulfillment: registration(base.creation.fulfillment.workflow) }, revision: "5".repeat(64), subscribers: [{ id: "detach142-option-only", revision: "5".repeat(64) }],
      workflow: { name: "probe142NativeOptionOnlyForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null,
        output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close));
    const result = await Effect.runPromise(host.run(host.newRequestKey(), null)), id = result[0]?.id;
    if (typeof id !== "string") throw new Error("Missing actual native Option-only result");
    return id;
  };
  /** Canonical setup delegates the exact selected table transition to core;
   * it adds no public Fulfillment history or arbitrary update capability. */
  const arrange = async (table: "fulfillment" | "shipping_option", operation: "softDelete" | "insert", rows: readonly JsonObject[]) => {
    const command = defineCommerceCommand("reference142CanonicalArrangement", "write", Effect.fn(function* (ctx) {
      const store = yield* ctx.table(table);
      if (operation === "insert") yield* store.write(ctx.manager, "insert", rows);
      else yield* store.lifecycle(ctx.manager, "softDelete", rows);
      return null;
    }));
    const participant = defineAtomicCommerceParticipant("reference142Arrangement");
    const root = defineAtomicCommerceCommand("reference142ArrangementRoot", ctx => ctx.call(participant, command, null));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...base.fixture.hostInput, commands: [root],
      participants: [{ participant, logicalStorage: base.creation.modules.fulfillment.logicalStorage, commands: [command] }] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); } finally { await Effect.runPromise(host.close); }
  };
  const prepareCombined = async (prefix: string, actualOptionRetained: () => unknown,
    configuration: Readonly<{ cancelBefore?: boolean; lateFailure?: boolean; calls?: number }> = {}) => {
    const combined = await Effect.runPromise(makeLocalFulfillmentShippingOptionReferenceDetachmentCommands());
    const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: combined.workflow,
      methods: ["upsertShippingOptions", "deleteShippingOptions", "createFulfillment", "cancelFulfillment"], graph: false },
      stockLocation: { module: base.stockLocation.workflow, methods: [], graph: true, expose: false } }, true));
    const forward = createStep("probe142-native-combined-option-forward", resources.callback((_input: null, context) => invokeOption(
      shippingOptionCreationInput(prefix).map(({ prices: _prices, ...value }) => ({ ...value, type: shippingOptionParents.type })), context)));
    const inverse = createStep("probe142-native-combined-option-inverse", resources.callback(async (id: string, context) => {
      const before = configuration.cancelBefore ? await context.resources.fulfillment.cancelFulfillment(id) : null;
      await undo.creation(actualOptionRetained(), context);
      const after = await context.resources.fulfillment.cancelFulfillment(id), repeat = await context.resources.fulfillment.cancelFulfillment(id);
      if (configuration.lateFailure) throw new Error("Late native combined detachment failure");
      return new StepResponse({ before, after, repeat });
    }));
    const flow = createWorkflow("probe142-native-combined-detachment", () => {
      const option = forward(null);
      const input = transform(option, value => {
        const rows = Result.getOrThrow(combined.option.contracts.decodeRows(value)), id = rows[0]?.id;
        if (typeof id !== "string") throw new Error("Missing genuine combined native Option ID");
        return { ...fulfillmentCreationInput(prefix), shipping_option_id: id };
      });
      // SAFETY: the actual native DTO understates the already checked nullable
      // fields/string quantities, as in the standalone141 authoring boundary.
      type NativeInput = Parameters<typeof createFulfillmentWorkflow.runAsStep>[0]["input"];
      const fulfillment = createFulfillmentWorkflow.runAsStep({ input: input as NativeInput });
      return new WorkflowResponse(inverse(fulfillment.id));
    });
    const limits = { ...shippingOptionCreationResources, ...(configuration.calls === undefined ? {} : { calls: configuration.calls }) };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution,
      modules: { fulfillment: { ...registration(combined.workflow), logicalResources: limits }, stockLocation: { ...base.modules.stockLocation, logicalResources: limits } },
      revision: "6".repeat(64), subscribers: [{ id: "detach142-combined", revision: "6".repeat(64) }], operationScheduling: "queued",
      requestCallLimit: limits.calls, requestEventLimit: limits.eventMessages, requestByteLimit: limits.commandBytes,
      workflow: { name: "probe142NativeCombinedDetachment", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null,
        output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCancel = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: base.fulfillment.workflow,
      methods: ["cancelFulfillment"], graph: false } }, true));
    const cancel = createStep("probe142-native-later-cancel", resources.callback(async (id: string, context) =>
      new StepResponse(await context.resources.fulfillment.cancelFulfillment(id))));
    const flow = createWorkflow("probe142-native-later-cancel", (id: WorkflowData<string>) => new WorkflowResponse(cancel(id)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution, modules: { fulfillment: registration(base.fulfillment.workflow) },
      revision: "7".repeat(64), subscribers: [{ id: "detach142-later-cancel", revision: "7".repeat(64) }],
      workflow: { name: "probe142NativeLaterCancel", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.String,
        output: base.fulfillment.output, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { ...base, prepareOptionInverse, prepareZone, prepareSet, prepareParentInverse, seedBareOption, arrangeReference: arrange, prepareCombined, prepareCancel };
}
