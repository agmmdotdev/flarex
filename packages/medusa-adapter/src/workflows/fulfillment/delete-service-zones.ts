import { Effect, Schema } from "effect";
import { deleteServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/delete-service-zones";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { ServiceZoneDeletionIds } from "../../modules/fulfillment/service-zone-delete-input";
import type { makeServiceZoneDeletionCommands } from "../../modules/fulfillment/service-zone-delete-service";
import { serviceZoneDeletionResources } from "../../workflow/policy";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeServiceZoneDeletionCommands>>["workflow"];
export const ServiceZoneDeletionInput = Schema.Struct({ ids: ServiceZoneDeletionIds });

/** Genuine raw-ID deletion and inverse share the named bounded event profile. */
export const prepareServiceZoneDeletionWorkflow = Effect.fn("ServiceZone.prepareDeletion")(function* (input: {
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
  const source = workflowModuleDefinition(installed.fulfillment.module)?.source;
  if (source?.name !== "flarex-service-zone-delete" || source.profile !== "service-zone-delete")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (installed.fulfillment.logicalResources !== undefined && !jsonEqual(installed.fulfillment.logicalResources, serviceZoneDeletionResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = { fulfillment: { ...installed.fulfillment, logicalResources: serviceZoneDeletionResources } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["softDeleteServiceZones", "restoreServiceZones"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(deleteServiceZonesWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: serviceZoneDeletionResources.calls,
    requestEventLimit: serviceZoneDeletionResources.eventMessages,
    workflow: { name: "deleteServiceZonesWorkflow", resources, prepared,
      input: ServiceZoneDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
