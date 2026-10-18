import { Effect } from "effect";
import { createShippingProfilesWorkflow } from "@medusajs/core-flows/fulfillment/create-shipping-profiles";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { ShippingProfileCreationInput, compileShippingProfileCreationContracts } from "../../modules/fulfillment/shipping-profile-create-input";
import { captureShippingProfileDeletionMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeShippingProfileCreationCommands } from "../../modules/fulfillment/shipping-profile-create-service";
import { shippingProfileCreationResources } from "../../workflow/policy";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { ShippingProfileCreationInput };
type Fulfillment = Effect.Success<ReturnType<typeof makeShippingProfileCreationCommands>>["workflow"];

/** Genuine creation and its physical retained inverse borrow one outer owner.
 * The selected full Fulfillment constructor retains native validation/events. */
export const prepareShippingProfileCreationWorkflow = Effect.fn("ShippingProfile.prepareCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly fulfillment: InstalledWorkflowModule<Fulfillment>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "fulfillment", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules({ fulfillment: options.fulfillment }, ["fulfillment"]));
  const source = workflowModuleDefinition(installed.fulfillment.module)?.source;
  if (source?.name !== "flarex-shipping-profile-create" || source.profile !== "shipping-profile-create")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (installed.fulfillment.logicalResources !== undefined && !jsonEqual(installed.fulfillment.logicalResources, shippingProfileCreationResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const contracts = yield* Effect.fromResult(compileShippingProfileCreationContracts((yield* captureShippingProfileDeletionMetadata()).frame));
  const modules = { fulfillment: { ...installed.fulfillment, logicalResources: shippingProfileCreationResources } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["createShippingProfiles", "deleteShippingProfiles"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(createShippingProfilesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: shippingProfileCreationResources.calls, requestEventLimit: shippingProfileCreationResources.eventMessages,
    workflow: { name: "createShippingProfilesWorkflow", resources, prepared,
      input: ShippingProfileCreationInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
