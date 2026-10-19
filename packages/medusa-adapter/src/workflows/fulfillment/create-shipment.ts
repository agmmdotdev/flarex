import { Effect, Result, Schema } from "effect";
import { createShipmentWorkflow } from "@medusajs/core-flows/fulfillment/create-shipment";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { FulfillmentCreationId, FulfillmentCreationLabel, compileFulfillmentCreationContracts } from "../../modules/fulfillment/fulfillment-create-input";
import { captureFulfillmentCreationMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeLocalFulfillmentCreationCommands } from "../../modules/fulfillment/fulfillment-create-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { fulfillmentShipmentResources } from "../../workflow/policy";

type Fulfillment = Effect.Success<ReturnType<typeof makeLocalFulfillmentCreationCommands>>["workflow"];
export type FulfillmentShipmentModules = { readonly fulfillment: Fulfillment };
export const FulfillmentShipmentInput = Schema.Struct({ id: FulfillmentCreationId,
  labels: Schema.Array(FulfillmentCreationLabel).pipe(Schema.mutable).check(Schema.isMaxLength(4)),
  marked_shipped_by: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

/** Native shipment validation and its nested update borrow only these two
 * authenticated methods from the existing twelve-table Fulfillment source. */
export function prepareFulfillmentShipmentResources(input: FulfillmentShipmentModules) {
  return Result.gen(function* () {
    const modules = yield* captureWorkflowRecord(input);
    if (Object.keys(modules).length !== 1) return yield* Result.fail(commerceError("unsupportedProfile"));
    const definition = workflowModuleDefinition(modules.fulfillment), source = definition?.source;
    if (source?.name !== "flarex-fulfillment-create" || source.profile !== "fulfillment-create" ||
      definition?.logical?.detachDeletedReferences !== undefined)
      return yield* Result.fail(commerceError("invalidAuthority"));
    return yield* prepareWorkflowResources({ fulfillment: {
      module: modules.fulfillment, methods: ["retrieveFulfillment", "updateFulfillment"], graph: false,
    } }, true);
  });
}

/** Preserve genuine guard ordering, date generation, projected preimages and
 * Label replacement/inverse behavior inside one trusted outer settlement. */
export const prepareFulfillmentShipmentWorkflow = Effect.fn("Fulfillment.prepareShipment")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<Fulfillment> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment"]));
  const resources = yield* Effect.fromResult(prepareFulfillmentShipmentResources({ fulfillment: installed.fulfillment.module }));
  if (installed.fulfillment.logicalResources !== undefined && !jsonEqual(installed.fulfillment.logicalResources, fulfillmentShipmentResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const { logicalPublication: _publication, ...selected } = installed.fulfillment;
  const modules = { fulfillment: { ...selected, logicalResources: fulfillmentShipmentResources } };
  const metadata = yield* captureFulfillmentCreationMetadata();
  const contracts = yield* Effect.fromResult(compileFulfillmentCreationContracts(metadata.frame));
  const output = Schema.JsonObject.check(Schema.makeFilter(value => Result.isSuccess(contracts.decodeOutput(value))));
  const prepared = yield* Effect.fromResult(createShipmentWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    requestCallLimit: fulfillmentShipmentResources.calls, requestEventLimit: fulfillmentShipmentResources.eventMessages,
    requestByteLimit: fulfillmentShipmentResources.commandBytes,
    workflow: { name: "createShipmentWorkflow", resources, prepared, input: FulfillmentShipmentInput, output,
      events: internalModuleWorkflowEvents } });
});
