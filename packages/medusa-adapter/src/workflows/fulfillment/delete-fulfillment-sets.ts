import { Effect, Result, Schema } from "effect";
import { deleteFulfillmentSetsWorkflow } from "@medusajs/core-flows/fulfillment/delete-fulfillment-sets";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { FulfillmentSetDeletionIds } from "../../modules/fulfillment/fulfillment-set-delete-input";
import type { makeFulfillmentSetDeletionCommands } from "../../modules/fulfillment/fulfillment-set-delete-service";
import type { prepareFulfillmentSetDeletionLinkResource } from "../../links/fulfillment-set-deletion";
import { fulfillmentSetDeletionResources } from "../../workflow/policy";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeFulfillmentSetDeletionCommands>>["workflow"];
type Links = Result.Result.Success<ReturnType<typeof prepareFulfillmentSetDeletionLinkResource>>;
export const FulfillmentSetDeletionInput = Schema.Struct({ ids: FulfillmentSetDeletionIds });

/** The genuine Set lifecycle and empty installed Link router share one outer
 * settlement, including the actual raw-input retained callbacks. */
export const prepareFulfillmentSetDeletionWorkflow = Effect.fn("FulfillmentSet.prepareDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<Fulfillment> };
  readonly link: Links;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment"]));
  const source = workflowModuleDefinition(installed.fulfillment.module)?.source;
  if (source?.name !== "flarex-fulfillment-set-delete" || source.profile !== "fulfillment-set-delete")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (installed.fulfillment.logicalResources !== undefined && !jsonEqual(installed.fulfillment.logicalResources, fulfillmentSetDeletionResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = { fulfillment: { ...installed.fulfillment, logicalResources: fulfillmentSetDeletionResources } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["softDeleteFulfillmentSets", "restoreFulfillmentSets"], graph: false,
  } }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deleteFulfillmentSetsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    requestCallLimit: fulfillmentSetDeletionResources.calls, requestEventLimit: fulfillmentSetDeletionResources.eventMessages,
    workflow: { name: "deleteFulfillmentSetsWorkflow", resources, prepared,
      input: FulfillmentSetDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
