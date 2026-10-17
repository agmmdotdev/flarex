import { Effect } from "effect";
import { updateServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/update-service-zones";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { ServiceZoneUpdateInput, compileServiceZoneUpdateContracts } from "../../modules/fulfillment/service-zone-update-input";
import type { makeServiceZoneUpdateCommands } from "../../modules/fulfillment/service-zone-update-service";
import { captureServiceZoneCreationMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import { serviceZoneUpdateResources } from "../../workflow/policy";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeServiceZoneUpdateCommands>>["workflow"];
export { ServiceZoneUpdateInput };

export const prepareServiceZoneUpdateWorkflow = Effect.fn("ServiceZone.prepareUpdate")(function* (input: {
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
  if (source?.name !== "flarex-service-zone-update" || source.profile !== "service-zone-update") return yield* Effect.fail(commerceError("invalidAuthority"));
  if (installed.fulfillment.logicalResources !== undefined && !jsonEqual(installed.fulfillment.logicalResources, serviceZoneUpdateResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = { fulfillment: { ...installed.fulfillment, logicalResources: serviceZoneUpdateResources } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["listServiceZones", "updateServiceZones", "upsertServiceZones"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(updateServiceZonesWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const metadata = yield* captureServiceZoneCreationMetadata(), contracts = yield* Effect.fromResult(compileServiceZoneUpdateContracts(metadata.frame));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: serviceZoneUpdateResources.calls, requestEventLimit: serviceZoneUpdateResources.eventMessages,
    workflow: { name: "updateServiceZonesWorkflow", resources, prepared, input: ServiceZoneUpdateInput,
      output: contracts.Output, events: internalModuleWorkflowEvents } });
});
