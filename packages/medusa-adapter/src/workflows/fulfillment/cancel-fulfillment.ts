import { Effect, Result, Schema } from "effect";
import { cancelFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/cancel-fulfillment";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { FulfillmentCreationId } from "../../modules/fulfillment/fulfillment-create-input";
import type { makeLocalFulfillmentCreationCommands } from "../../modules/fulfillment/fulfillment-create-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeLocalFulfillmentCreationCommands>>["workflow"];
export type FulfillmentCancellationModules = { readonly fulfillment: Fulfillment };
export const FulfillmentCancellationInput = Schema.Struct({ id: FulfillmentCreationId });

/** Select the existing authenticated cancellation method. This root grants no
 * creation, Query, Link, endpoint mutation or reference detachment capability. */
export function prepareFulfillmentCancellationResources(input: FulfillmentCancellationModules) {
  return Result.gen(function* () {
    const modules = yield* captureWorkflowRecord(input);
    if (Object.keys(modules).length !== 1) return yield* Result.fail(commerceError("unsupportedProfile"));
    const definition = workflowModuleDefinition(modules.fulfillment), source = definition?.source;
    if (source?.name !== "flarex-fulfillment-create" || source.profile !== "fulfillment-create" ||
      definition?.logical?.detachDeletedReferences !== undefined)
      return yield* Result.fail(commerceError("invalidAuthority"));
    return yield* prepareWorkflowResources({ fulfillment: {
      module: modules.fulfillment, methods: ["cancelFulfillment"], graph: false,
    } }, true);
  });
}

/** The genuine void workflow reuses native eligibility, Manual cancellation,
 * DTO/receipt validation and module events within one outer settlement. The
 * retained step ID is not a business inverse. */
export const prepareFulfillmentCancellationWorkflow = Effect.fn("Fulfillment.prepareCancellation")(function* (input: {
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
  const resources = yield* Effect.fromResult(prepareFulfillmentCancellationResources({ fulfillment: installed.fulfillment.module }));
  if (installed.fulfillment.logicalResources !== undefined && !jsonEqual(installed.fulfillment.logicalResources, defaultCommerceResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const { logicalPublication: _publication, ...selected } = installed.fulfillment;
  const modules = { fulfillment: { ...selected, logicalResources: defaultCommerceResources } };
  const prepared = yield* Effect.fromResult(cancelFulfillmentWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    requestCallLimit: defaultCommerceResources.calls, requestEventLimit: defaultCommerceResources.eventMessages,
    requestByteLimit: defaultCommerceResources.commandBytes,
    workflow: { name: "cancelFulfillmentWorkflow", resources, prepared,
      input: FulfillmentCancellationInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
