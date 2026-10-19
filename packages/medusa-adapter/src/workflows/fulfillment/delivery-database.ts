import { Effect, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import type { AtomicCommerceEvents, TaskAtomicCommerceHost } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makeLocalFulfillmentCreationCommands } from "../../modules/fulfillment/fulfillment-create-service";
import { FulfillmentCreationId } from "../../modules/fulfillment/fulfillment-create-input";
import { NativePreimageConfig } from "../../workflow/preimage";
import { captureInstalledWorkflowModules, prepareTaskAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { workflowModuleDefinition } from "../../workflow/module";
import { fulfillmentShipmentResources } from "../../workflow/policy";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import type { bindWorkflowQuery } from "../../workflow/query";

type Fulfillment = Effect.Success<ReturnType<typeof makeLocalFulfillmentCreationCommands>>["workflow"];
const QueryCall = Schema.Struct({ kind: Schema.Literal("query"), id: FulfillmentCreationId });
const RetrieveCall = Schema.Struct({ kind: Schema.Literal("retrieve"), id: FulfillmentCreationId, config: NativePreimageConfig });
const UpdateCall = Schema.Struct({ kind: Schema.Literal("update"), id: FulfillmentCreationId,
  data: Schema.Struct({ delivered_at: Schema.String }) });
export const FulfillmentDeliveryDatabaseCall = Schema.Union([QueryCall, RetrieveCall, UpdateCall]);
const InverseCall = Schema.Struct({ id: FulfillmentCreationId, data: Schema.Struct({ delivered_at: Schema.Null }) });

/** Only short native service/Query calls borrow SQL. Lock waits and the parent
 * interpreter never enter these finite callback loans. The native update step
 * retains its own preimage; this bridge implements no inverse algorithm. */
export const prepareFulfillmentDeliveryDatabase = Effect.fn("FulfillmentDelivery.prepareDatabase")(function* (input: {
  readonly execution: AtomicWorkflowExecution<TaskAtomicCommerceHost>;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<Fulfillment> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(input.modules, ["fulfillment"]));
  const definition = workflowModuleDefinition(installed.fulfillment.module);
  if (Object.keys(input.modules).length !== 1 || definition?.source.name !== "flarex-fulfillment-create" ||
    definition.source.profile !== "fulfillment-create" || definition.logical?.detachDeletedReferences !== undefined)
    return yield* commerceError("invalidAuthority");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: installed.fulfillment.module, methods: ["retrieveFulfillment", "updateFulfillment"], graph: true,
  } }, true));
  const call = createStep("fulfillment-delivery-database-call", resources.callback<typeof FulfillmentDeliveryDatabaseCall.Type, Json>(async (value, context) => {
    switch (value.kind) {
      case "query": {
        const query = context.container.resolve<ReturnType<typeof bindWorkflowQuery>>("query");
        return new StepResponse(await query({ entryPoint: "fulfillment", fields: ["id", "delivered_at", "canceled_at"],
          variables: { id: value.id } }, { throwIfKeyNotFound: true, throwIfRelationNotFound: undefined }));
      }
      case "retrieve": return new StepResponse(await context.resources.fulfillment.retrieveFulfillment(value.id, value.config));
      case "update": return new StepResponse(await context.resources.fulfillment.updateFulfillment(value.id, value.data));
    }
  }));
  const workflow = createWorkflow("fulfillment-delivery-database-call", (value: WorkflowData<typeof FulfillmentDeliveryDatabaseCall.Type>) =>
    new WorkflowResponse(call(value)));
  const inverseCall = createStep("fulfillment-delivery-native-inverse-call", resources.callback(async (value: typeof InverseCall.Type, context) =>
    new StepResponse(await context.resources.fulfillment.updateFulfillment(value.id, value.data))));
  const inverseWorkflow = createWorkflow("fulfillment-delivery-native-inverse-call", (value: WorkflowData<typeof InverseCall.Type>) =>
    new WorkflowResponse(inverseCall(value)));
  const modules = { fulfillment: { ...installed.fulfillment, logicalResources: fulfillmentShipmentResources } };
  const options = { ...input, modules, operationScheduling: "queued" as const, executionIsolation: "scopeExclusive" as const,
    requestCallLimit: fulfillmentShipmentResources.calls, requestEventLimit: fulfillmentShipmentResources.eventMessages,
    requestByteLimit: fulfillmentShipmentResources.commandBytes };
  const ordinary = yield* prepareTaskAtomicWorkflowHost({ ...options, workflow: {
    name: "fulfillmentDeliveryDatabaseCall", resources, prepared: yield* Effect.fromResult(workflow.prepare()),
    input: FulfillmentDeliveryDatabaseCall, output: Schema.Json, events: internalModuleWorkflowEvents,
  } });
  const inverse = yield* prepareTaskAtomicWorkflowHost({ ...options, allowTaskControl: true, workflow: {
    name: "fulfillmentDeliveryNativeInverseCall", resources, prepared: yield* Effect.fromResult(inverseWorkflow.prepare()),
    input: InverseCall, output: Schema.Json, events: internalModuleWorkflowEvents,
  } }).pipe(Effect.onError(() => ordinary.close));
  return Object.freeze({ ordinary, inverse, close: Effect.andThen(inverse.close, ordinary.close) });
});
