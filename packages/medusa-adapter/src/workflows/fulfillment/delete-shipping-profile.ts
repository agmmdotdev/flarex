import { Effect, Schema, type Result } from "effect";
import { deleteShippingProfileWorkflow } from "@medusajs/core-flows/shipping-profile/delete-shipping-profile";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ShippingProfileDeletionIds } from "../../modules/fulfillment/shipping-profile-delete-input";
import type { makeShippingProfileDeletionCommands } from "../../modules/fulfillment/shipping-profile-delete-service";
import type { prepareShippingProfileDeletionLinks, prepareShippingProfileDeletionLinkResource } from "../../links/shipping-profile-deletion";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeShippingProfileDeletionCommands>>["workflow"];
type ProductLinks = Effect.Success<ReturnType<typeof prepareShippingProfileDeletionLinks>>["shipping"]["workflow"];
type Links = Result.Result.Success<ReturnType<typeof prepareShippingProfileDeletionLinkResource>>;
export const ShippingProfileDeletionInput = Schema.Struct({ ids: ShippingProfileDeletionIds });

/** Native Product-Link validation, real Option validation, profile lifecycle and
 * endpoint Link dispatch borrow the selected optimistic outer attempt. */
export const prepareShippingProfileDeletionWorkflow = Effect.fn("ShippingProfile.prepareDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<Fulfillment>;
    readonly product_shipping_profile_deletion_links: InstalledWorkflowModule<ProductLinks> };
  readonly link: Links;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment", "product_shipping_profile_deletion_links"]));
  const fulfillment = workflowModuleDefinition(modules.fulfillment.module), links = workflowModuleDefinition(modules.product_shipping_profile_deletion_links.module);
  if (fulfillment === undefined || fulfillment.source.name !== "flarex-shipping-profile-delete" || fulfillment.source.profile !== "shipping-profile-delete"
    || links === undefined || links.source.name !== "flarex-product-links" || links.source.profile !== "shipping-profile-deletions")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    fulfillment: { module: modules.fulfillment.module, methods: ["softDeleteShippingProfiles", "restoreShippingProfiles"], graph: false },
    product_shipping_profile_deletion_links: { module: modules.product_shipping_profile_deletion_links.module,
      methods: ["softDelete", "restore"], graph: true, expose: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deleteShippingProfileWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    workflow: { name: "deleteShippingProfileWorkflow", resources, prepared,
      input: ShippingProfileDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
