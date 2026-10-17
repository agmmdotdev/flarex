import { Effect, Result, Schema } from "effect";
import { updateShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/update-shipping-option-types";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ShippingOptionTypeUpdateSelector, ShippingOptionTypeUpdateData, compileShippingOptionTypeUpdateContracts } from "../../modules/fulfillment/shipping-option-type-update-input";
import { captureShippingProfileDeletionMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeShippingOptionTypeUpdateCommands } from "../../modules/fulfillment/shipping-option-type-update-service";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeShippingOptionTypeUpdateCommands>>["workflow"];
type Contracts = Result.Result.Success<ReturnType<typeof compileShippingOptionTypeUpdateContracts>>;
type Selections = { readonly fulfillment: { readonly module: Fulfillment;
  readonly methods: readonly ["listShippingOptionTypes", "updateShippingOptionTypes", "upsertShippingOptionTypes"]; readonly graph: false } };
type Resources = NativeWorkflowResources<Selections, true>;
export const ShippingOptionTypeUpdateInput = Schema.Struct({ selector: ShippingOptionTypeUpdateSelector,
  update: ShippingOptionTypeUpdateData, additional_data: Schema.optionalKey(Schema.JsonObject) });
export interface ShippingOptionTypeUpdateHookInput {
  readonly shipping_option_types: Result.Result.Success<ReturnType<Contracts["decodeRows"]>>;
  readonly additional_data?: JsonObject;
}
export interface ShippingOptionTypeUpdateHooks {
  readonly shippingOptionTypesUpdated?: (input: ShippingOptionTypeUpdateHookInput,
    context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
}

/** Native selector reads, target updates and retained upsert share one outer
 * settlement. Native retargeting and projected inverse behavior remain intact. */
export const prepareShippingOptionTypeUpdateWorkflow = Effect.fn("ShippingOptionType.prepareUpdate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<Fulfillment> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ShippingOptionTypeUpdateHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers", "hooks"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment"]));
  const source = workflowModuleDefinition(modules.fulfillment.module)?.source;
  if (source?.name !== "flarex-shipping-option-type-update" || source.profile !== "shipping-option-type-update")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["listShippingOptionTypes", "updateShippingOptionTypes", "upsertShippingOptionTypes"], graph: false,
  } }, true));
  const metadata = yield* captureShippingProfileDeletionMetadata();
  const contracts = yield* Effect.fromResult(compileShippingOptionTypeUpdateContracts(metadata.frame));
  const decodeHookShape = commerceDecoder(Schema.Struct({ shipping_option_types: contracts.Output,
    additional_data: Schema.optionalKey(Schema.JsonObject) }), "invalidInput");
  const decodeHook = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(decodeHookShape), Result.flatMap(payload =>
    contracts.decodeRows(payload.shipping_option_types).pipe(Result.map(rows => ({ ...payload, shipping_option_types: rows })))));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "shippingOptionTypesUpdated") ||
    registeredHooks.shippingOptionTypesUpdated !== undefined && typeof registeredHooks.shippingOptionTypesUpdated !== "function")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const handler = registeredHooks.shippingOptionTypesUpdated;
  type Hooks = NonNullable<Parameters<typeof updateShippingOptionTypesWorkflow.prepare>[0]>;
  const hooks: Hooks = handler === undefined ? {} : { shippingOptionTypesUpdated: resources.callback((value: unknown, context) =>
    decodeHook(value).pipe(Result.match({ onFailure: error => Promise.reject(error), onSuccess: value => handler(value, context) }))) };
  const prepared = yield* Effect.fromResult(updateShippingOptionTypesWorkflow.prepare(hooks))
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents("shipping-option-type.updated", Effect.fn("ShippingOptionType.updatedIds")(function* (calls) {
    const writes = calls.calls(modules.fulfillment.module.methods.updateShippingOptionTypes), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
    return (yield* Effect.fromResult(contracts.decodeRows(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "updateShippingOptionTypesWorkflow", resources, prepared,
      input: ShippingOptionTypeUpdateInput, output: contracts.Output, events } });
});
