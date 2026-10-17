import { Effect } from "effect";
import { updateShippingProfilesWorkflow } from "@medusajs/core-flows/fulfillment/update-shipping-profiles";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ShippingProfileUpdateInput, compileShippingProfileUpdateContracts } from "../../modules/fulfillment/shipping-profile-update-input";
import type { makeShippingProfileUpdateCommands } from "../../modules/fulfillment/shipping-profile-update-service";
import { captureShippingProfileMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { ShippingProfileUpdateInput };
type Fulfillment = Effect.Success<ReturnType<typeof makeShippingProfileUpdateCommands>>["workflow"];

/** Genuine scalar update and retained upsert borrow the existing optimistic
 * attempt. No provider, relationship or native create capability is admitted. */
export const prepareShippingProfileUpdateWorkflow = Effect.fn("ShippingProfile.prepareUpdate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly fulfillment: InstalledWorkflowModule<Fulfillment>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "fulfillment", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules({ fulfillment: options.fulfillment }, ["fulfillment"]));
  const definition = workflowModuleDefinition(modules.fulfillment.module);
  if (definition === undefined || definition.source.name !== "flarex-shipping-profile-update" || definition.source.profile !== "shipping-profile-update")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const metadata = yield* captureShippingProfileMetadata();
  const contracts = yield* Effect.fromResult(compileShippingProfileUpdateContracts(metadata.frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    fulfillment: { module: modules.fulfillment.module, methods: ["listShippingProfiles", "updateShippingProfiles", "upsertShippingProfiles"], graph: false },
  }, true));
  const prepared = yield* Effect.fromResult(updateShippingProfilesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    workflow: { name: "updateShippingProfilesWorkflow", resources, prepared,
      input: ShippingProfileUpdateInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
