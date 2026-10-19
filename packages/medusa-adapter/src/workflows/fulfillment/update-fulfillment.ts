import { Effect, Result, Schema } from "effect";
import { updateFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/update-fulfillment";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { compileFulfillmentCreationContracts } from "../../modules/fulfillment/fulfillment-create-input";
import { captureFulfillmentCreationMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import { FulfillmentUpdateInput } from "../../modules/fulfillment/fulfillment-shipment-input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { fulfillmentUpdateResources } from "../../workflow/policy";
import { prepareFulfillmentShipmentResources, type FulfillmentShipmentModules } from "./create-shipment";

export { FulfillmentUpdateInput };
// Standalone updates and Shipment's native child borrow the same authenticated
// retrieve/update pair from the existing local Fulfillment constructor.
export const prepareFulfillmentUpdateResources = prepareFulfillmentShipmentResources;
export type FulfillmentUpdateModules = FulfillmentShipmentModules;

/** Preserve genuine normalization and retained business compensation. The
 * trusted outer owner alone settles the finite atomic workflow. */
export const prepareFulfillmentUpdateWorkflow = Effect.fn("Fulfillment.prepareUpdate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<FulfillmentUpdateModules["fulfillment"]> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment"]));
  const resources = yield* Effect.fromResult(prepareFulfillmentUpdateResources({ fulfillment: installed.fulfillment.module }));
  if (installed.fulfillment.logicalResources !== undefined && !jsonEqual(installed.fulfillment.logicalResources, fulfillmentUpdateResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const { logicalPublication: _publication, ...selected } = installed.fulfillment;
  const modules = { fulfillment: { ...selected, logicalResources: fulfillmentUpdateResources } };
  const metadata = yield* captureFulfillmentCreationMetadata();
  const contracts = yield* Effect.fromResult(compileFulfillmentCreationContracts(metadata.frame));
  const output = Schema.JsonObject.check(Schema.makeFilter(value => Result.isSuccess(contracts.decodeOutput(value))));
  const prepared = yield* Effect.fromResult(updateFulfillmentWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    requestCallLimit: fulfillmentUpdateResources.calls, requestEventLimit: fulfillmentUpdateResources.eventMessages,
    requestByteLimit: fulfillmentUpdateResources.commandBytes,
    workflow: { name: "updateFulfillmentWorkflow", resources, prepared, input: FulfillmentUpdateInput, output,
      events: internalModuleWorkflowEvents } });
});
