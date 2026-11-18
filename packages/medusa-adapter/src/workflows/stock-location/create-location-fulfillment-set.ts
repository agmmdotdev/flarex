import { Effect, Schema } from "effect";
import { createLocationFulfillmentSetWorkflow } from "@medusajs/core-flows/stock-location/create-location-fulfillment-set";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import type { makeFulfillmentSetCreationCommands } from "../../modules/fulfillment/fulfillment-set-create-service";
import type { prepareLocationFulfillmentSetLink } from "../../links/location-fulfillment-set-service";
import { locationFulfillmentSetCreationResources } from "../../workflow/policy";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeFulfillmentSetCreationCommands>>["workflow"];
type Links = Effect.Success<ReturnType<typeof prepareLocationFulfillmentSetLink>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
// The native composer ignores extra Set fields. Retaining JSON extras here
// never grants the scalar command IDs, metadata or nested graph creation.
export const LocationFulfillmentSetCreationInput = Schema.Struct({ location_id: Id,
  fulfillment_set_data: Schema.StructWithRest(Schema.Struct({ name: Schema.String, type: Schema.String }),
    [Schema.Record(Schema.String, Schema.Json)]) });

/** Genuine creation and retained Link-dismiss/physical-Set inverse borrow one
 * outer owner. Stored endpoint identities do not require endpoint liveness. */
export const prepareLocationFulfillmentSetCreationWorkflow = Effect.fn("LocationFulfillmentSet.prepareCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<Fulfillment>; readonly locationLinks: InstalledWorkflowModule<Links["workflow"]> };
  readonly link: Links["resource"];
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment", "locationLinks"]));
  const fulfillmentDefinition = workflowModuleDefinition(installed.fulfillment.module), fulfillmentSource = fulfillmentDefinition?.source;
  const linkSource = workflowModuleDefinition(installed.locationLinks.module)?.source;
  if (!(fulfillmentSource?.name === "flarex-fulfillment-set-create" && fulfillmentSource.profile === "fulfillment-set-create" &&
    fulfillmentDefinition?.logical?.detachDeletedReferences === undefined) &&
    !(fulfillmentSource?.name === "flarex-fulfillment-set-create-reference-detachment" && fulfillmentSource.profile === "fulfillment-set-create-reference-detachment" &&
      fulfillmentDefinition?.logical?.detachDeletedReferences === true) || linkSource?.profile !== "location-fulfillment-set-creation")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const module of Object.values(installed)) if (module.logicalResources !== undefined && !jsonEqual(module.logicalResources, locationFulfillmentSetCreationResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = { fulfillment: { ...installed.fulfillment, logicalResources: locationFulfillmentSetCreationResources },
    locationLinks: { ...installed.locationLinks, logicalResources: locationFulfillmentSetCreationResources } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    fulfillment: { module: modules.fulfillment.module, methods: ["createFulfillmentSets", "deleteFulfillmentSets"], graph: false },
    locationLinks: { module: modules.locationLinks.module, methods: ["create", "list", "dismiss"], graph: false, expose: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(createLocationFulfillmentSetWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued", requestCallLimit: locationFulfillmentSetCreationResources.calls,
    requestEventLimit: locationFulfillmentSetCreationResources.eventMessages,
    workflow: { name: "createLocationFulfillmentSetWorkflow", resources, prepared,
      input: LocationFulfillmentSetCreationInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
