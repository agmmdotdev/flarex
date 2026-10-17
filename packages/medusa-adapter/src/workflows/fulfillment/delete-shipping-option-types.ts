import { Effect, Result, Schema } from "effect";
import { deleteShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/delete-shipping-option-types";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ShippingOptionTypeDeletionIds, decodeShippingOptionTypeDeletionIds } from "../../modules/fulfillment/shipping-option-type-delete-input";
import type { makeShippingOptionTypeDeletionCommands } from "../../modules/fulfillment/shipping-option-type-delete-service";
import type { prepareShippingOptionTypeDeletionLinkResource } from "../../links/shipping-option-type-deletion";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import type { ComposedWorkflowServices } from "../../workflow/composed-resource";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeShippingOptionTypeDeletionCommands>>["workflow"];
type Links = Result.Result.Success<ReturnType<typeof prepareShippingOptionTypeDeletionLinkResource>>;
type Selections = { readonly fulfillment: { readonly module: Fulfillment;
  readonly methods: readonly ["softDeleteShippingOptionTypes", "restoreShippingOptionTypes"]; readonly graph: true } };
type Resources = NativeWorkflowResources<Selections, true> & ComposedWorkflowServices<{ readonly link: Links }>;
export const ShippingOptionTypeDeletionInput = Schema.Struct({ ids: ShippingOptionTypeDeletionIds });
export interface ShippingOptionTypeDeletionHooks {
  readonly shippingOptionTypesDeleted?: (input: typeof ShippingOptionTypeDeletionInput.Type,
    context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
}

/** Native existence Query, Type lifecycle, raw-ID hook/events and real empty
 * installed Link router share one optimistic outer settlement. */
export const prepareShippingOptionTypeDeletionWorkflow = Effect.fn("ShippingOptionType.prepareDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<Fulfillment> };
  readonly link: Links;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ShippingOptionTypeDeletionHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers", "hooks"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment"]));
  const source = workflowModuleDefinition(modules.fulfillment.module)?.source;
  if (source?.name !== "flarex-shipping-option-type-delete" || source.profile !== "shipping-option-type-delete")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["softDeleteShippingOptionTypes", "restoreShippingOptionTypes"], graph: true,
  } }, true, { link: options.link }));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "shippingOptionTypesDeleted") ||
    registeredHooks.shippingOptionTypesDeleted !== undefined && typeof registeredHooks.shippingOptionTypesDeleted !== "function")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const decodeHookShape = commerceDecoder(ShippingOptionTypeDeletionInput, "invalidInput");
  const handler = registeredHooks.shippingOptionTypesDeleted;
  type Hooks = NonNullable<Parameters<typeof deleteShippingOptionTypesWorkflow.prepare>[0]>;
  const hooks: Hooks = handler === undefined ? {} : { shippingOptionTypesDeleted: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHookShape), Result.match({
      onFailure: error => Promise.reject(error), onSuccess: value => handler(value, context),
    }))) };
  const prepared = yield* Effect.fromResult(deleteShippingOptionTypesWorkflow.prepare(hooks))
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents("shipping-option-type.deleted", Effect.fn("ShippingOptionType.deletedIds")(function* (calls) {
    const writes = calls.calls(modules.fulfillment.module.methods.softDeleteShippingOptionTypes), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
    return yield* Effect.fromResult(decodeShippingOptionTypeDeletionIds(call.input));
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    workflow: { name: "deleteShippingOptionTypesWorkflow", resources, prepared,
      input: ShippingOptionTypeDeletionInput, output: Schema.Null, events } });
});
