import { Effect, Schema } from "effect";
import { createServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/create-service-zones";
import { matchesAtomicCommerceNativeSource, type AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ServiceZoneCreates, compileServiceZoneCreationContracts } from "../../modules/fulfillment/service-zone-create-input";
import { captureFulfillmentCreationMetadata, captureServiceZoneCreationMetadata, serviceZoneCreationTables } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeServiceZoneCreationCommands } from "../../modules/fulfillment/service-zone-create-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule, type OrdinaryNativeInstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeServiceZoneCreationCommands>>["workflow"];
export const ServiceZoneCreationInput = Schema.Struct({ data: ServiceZoneCreates });

type CreationOptions<Binding extends InstalledWorkflowModule<Fulfillment>> = {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: Binding };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
};

const captureCreation = Effect.fn("ServiceZone.captureCreation")(function* (input: CreationOptions<InstalledWorkflowModule<Fulfillment>>) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment"]));
  return { ...options, modules };
});

const prepareCreation = Effect.fn("ServiceZone.prepareCreationProfile")(function* (
  options: CreationOptions<InstalledWorkflowModule<Fulfillment>>, profile: "standalone" | "reference-detachment",
) {
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: options.modules.fulfillment.module, methods: ["createServiceZones", "deleteServiceZones"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(createServiceZonesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const metadata = yield* (profile === "standalone" ? captureServiceZoneCreationMetadata() : captureFulfillmentCreationMetadata());
  const contracts = yield* Effect.fromResult(compileServiceZoneCreationContracts(metadata.frame, profile));
  return yield* prepareAtomicWorkflowHost({ ...options, workflow: { name: "createServiceZonesWorkflow", resources, prepared,
    input: ServiceZoneCreationInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});

export const prepareServiceZoneCreationWorkflow = Effect.fn("ServiceZone.prepareCreation")(function* (
  input: CreationOptions<OrdinaryNativeInstalledWorkflowModule<Fulfillment>>,
) {
  const options = yield* captureCreation(input), { fulfillment } = options.modules;
  const definition = workflowModuleDefinition(fulfillment.module), source = definition?.source;
  if (source?.name !== "flarex-service-zone-create" || source.profile !== "service-zone-create" ||
    definition?.logical?.detachDeletedReferences !== undefined || fulfillment.nativeStorage === undefined || fulfillment.logicalStorage !== undefined ||
    !matchesAtomicCommerceNativeSource(fulfillment.nativeStorage, "fulfillment", "medusa.shippingProfile", { exactly: serviceZoneCreationTables }))
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (fulfillment.logicalResources !== undefined || fulfillment.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* prepareCreation(options, "standalone");
});

/** The retained wider Option/Shipment/Delivery profile requires eager detachment. */
export const prepareLegacyServiceZoneReferenceDetachmentWorkflow = Effect.fn("ServiceZone.prepareLegacyReferenceDetachment")(function* (
  input: CreationOptions<Extract<InstalledWorkflowModule<Fulfillment>, { readonly logicalStorage: unknown }>>,
) {
  const options = yield* captureCreation(input), { fulfillment } = options.modules;
  const definition = workflowModuleDefinition(fulfillment.module), source = definition?.source;
  if (source?.name !== "flarex-service-zone-create-reference-detachment" || source.profile !== "service-zone-create-reference-detachment" ||
    definition?.logical?.detachDeletedReferences !== true || fulfillment.logicalStorage === undefined || fulfillment.nativeStorage !== undefined)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  return yield* prepareCreation(options, "reference-detachment");
});
