import { Effect, Result, Schema } from "effect";
import { createShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/create-shipping-option-types";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ShippingOptionTypeCreates, compileShippingOptionTypeCreationContracts } from "../../modules/fulfillment/shipping-option-type-input";
import { captureShippingProfileDeletionMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeShippingOptionTypeCreationCommands } from "../../modules/fulfillment/shipping-option-type-service";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeShippingOptionTypeCreationCommands>>["workflow"];
type Contracts = Result.Result.Success<ReturnType<typeof compileShippingOptionTypeCreationContracts>>;
type Selections = { readonly fulfillment: { readonly module: Fulfillment;
  readonly methods: readonly ["createShippingOptionTypes", "deleteShippingOptionTypes"]; readonly graph: false } };
type Resources = NativeWorkflowResources<Selections, true>;
export const ShippingOptionTypeCreationInput = Schema.Struct({ shipping_option_types: ShippingOptionTypeCreates,
  additional_data: Schema.optionalKey(Schema.JsonObject) });
export interface ShippingOptionTypeCreationHookInput {
  readonly shipping_option_types: Result.Result.Success<ReturnType<Contracts["decodeRows"]>>;
  readonly additional_data?: JsonObject;
}
export interface ShippingOptionTypeCreationHooks {
  readonly shippingOptionTypesCreated?: (input: ShippingOptionTypeCreationHookInput,
    context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
}

/** Native create, hook and ordered workflow messages borrow the same finite
 * outer settlement. No graph/provider/link resource is admitted by this root. */
export const prepareShippingOptionTypeCreationWorkflow = Effect.fn("ShippingOptionType.prepareCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<Fulfillment> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ShippingOptionTypeCreationHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers", "hooks"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment"]));
  const source = workflowModuleDefinition(modules.fulfillment.module)?.source;
  if (source?.name !== "flarex-shipping-option-type-create" || source.profile !== "shipping-option-type-create")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["createShippingOptionTypes", "deleteShippingOptionTypes"], graph: false,
  } }, true));
  const metadata = yield* captureShippingProfileDeletionMetadata();
  const contracts = yield* Effect.fromResult(compileShippingOptionTypeCreationContracts(metadata.frame));
  const decodeHookShape = commerceDecoder(Schema.Struct({ shipping_option_types: contracts.Output,
    additional_data: Schema.optionalKey(Schema.JsonObject) }), "invalidInput");
  const decodeHook = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(decodeHookShape), Result.flatMap(payload =>
    contracts.decodeRows(payload.shipping_option_types).pipe(Result.map(rows => ({ ...payload, shipping_option_types: rows })))));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "shippingOptionTypesCreated") ||
    registeredHooks.shippingOptionTypesCreated !== undefined && typeof registeredHooks.shippingOptionTypesCreated !== "function")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const handler = registeredHooks.shippingOptionTypesCreated;
  type Hooks = NonNullable<Parameters<typeof createShippingOptionTypesWorkflow.prepare>[0]>;
  const hooks: Hooks = handler === undefined ? {} : { shippingOptionTypesCreated: resources.callback((value: unknown, context) =>
    decodeHook(value).pipe(Result.match({ onFailure: error => Promise.reject(error), onSuccess: value => handler(value, context) }))) };
  const prepared = yield* Effect.fromResult(createShippingOptionTypesWorkflow.prepare(hooks))
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents("shipping-option-type.created", Effect.fn("ShippingOptionType.createdIds")(function* (calls) {
    const writes = calls.calls(modules.fulfillment.module.methods.createShippingOptionTypes), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
    return (yield* Effect.fromResult(contracts.decodeRows(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "createShippingOptionTypesWorkflow", resources, prepared,
      input: ShippingOptionTypeCreationInput, output: contracts.Output, events } });
});
