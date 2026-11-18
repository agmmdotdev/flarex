import { Effect } from "effect";
import { createShippingProfilesWorkflow } from "@medusajs/core-flows/fulfillment/create-shipping-profiles";
import { matchesAtomicCommerceNativeSource, type AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ShippingProfileCreationInput, compileShippingProfileCreationContracts } from "../../modules/fulfillment/shipping-profile-create-input";
import { captureShippingProfileDeletionMetadata, shippingProfileDeletionTables } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeShippingProfileCreationCommands } from "../../modules/fulfillment/shipping-profile-create-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type OrdinaryNativeInstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { ShippingProfileCreationInput };
type Fulfillment = Effect.Success<ReturnType<typeof makeShippingProfileCreationCommands>>["workflow"];

/** Genuine creation and its physical retained inverse borrow one outer owner.
 * The selected full Fulfillment constructor retains native validation/events. */
export const prepareShippingProfileCreationWorkflow = Effect.fn("ShippingProfile.prepareCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly fulfillment: OrdinaryNativeInstalledWorkflowModule<Fulfillment>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "fulfillment", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules({ fulfillment: options.fulfillment }, ["fulfillment"]));
  const { fulfillment } = modules;
  const source = workflowModuleDefinition(fulfillment.module)?.source;
  if (source?.name !== "flarex-shipping-profile-create" || source.profile !== "shipping-profile-create")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (fulfillment.logicalResources !== undefined || fulfillment.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  if (fulfillment.nativeStorage === undefined || fulfillment.logicalStorage !== undefined ||
    !matchesAtomicCommerceNativeSource(fulfillment.nativeStorage, "fulfillment", "medusa.shippingProfile", shippingProfileDeletionTables))
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const contracts = yield* Effect.fromResult(compileShippingProfileCreationContracts((yield* captureShippingProfileDeletionMetadata()).frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["createShippingProfiles", "deleteShippingProfiles"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(createShippingProfilesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  // The retained physical inverse can detach historical Options beyond the active validation cohort.
  const admitted = { fulfillment: { ...fulfillment, logicalResources: defaultCommerceResources } };
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules: admitted, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: defaultCommerceResources.calls, requestEventLimit: defaultCommerceResources.eventMessages,
    workflow: { name: "createShippingProfilesWorkflow", resources, prepared,
      input: ShippingProfileCreationInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
