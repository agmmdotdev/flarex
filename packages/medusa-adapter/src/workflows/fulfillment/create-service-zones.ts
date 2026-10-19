import { Effect, Schema } from "effect";
import { createServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/create-service-zones";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ServiceZoneCreates, compileServiceZoneCreationContracts } from "../../modules/fulfillment/service-zone-create-input";
import { captureFulfillmentCreationMetadata, captureServiceZoneCreationMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeServiceZoneCreationCommands } from "../../modules/fulfillment/service-zone-create-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeServiceZoneCreationCommands>>["workflow"];
export const ServiceZoneCreationInput = Schema.Struct({ data: ServiceZoneCreates });

export const prepareServiceZoneCreationWorkflow = Effect.fn("ServiceZone.prepareCreation")(function* (input: {
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
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment"]));
  const definition = workflowModuleDefinition(modules.fulfillment.module), source = definition?.source;
  const referenceDetachment = source?.name === "flarex-service-zone-create-reference-detachment" && source.profile === "service-zone-create-reference-detachment" &&
    definition?.logical?.detachDeletedReferences === true;
  if (!referenceDetachment && (source?.name !== "flarex-service-zone-create" || source.profile !== "service-zone-create" || definition?.logical?.detachDeletedReferences !== undefined))
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["createServiceZones", "deleteServiceZones"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(createServiceZonesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const metadata = yield* (referenceDetachment ? captureFulfillmentCreationMetadata() : captureServiceZoneCreationMetadata()),
    contracts = yield* Effect.fromResult(compileServiceZoneCreationContracts(metadata.frame, referenceDetachment ? "reference-detachment" : "standalone"));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "createServiceZonesWorkflow", resources, prepared, input: ServiceZoneCreationInput, output: contracts.Output,
      events: internalModuleWorkflowEvents } });
});
