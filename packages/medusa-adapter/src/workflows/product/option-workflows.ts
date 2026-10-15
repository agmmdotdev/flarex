import { Effect, Result, Schema } from "effect";
import { createProductOptionsWorkflow } from "@medusajs/core-flows/product/create-product-options";
import { updateProductOptionsWorkflow } from "@medusajs/core-flows/product/update-product-options";
import { deleteProductOptionsWorkflow } from "@medusajs/core-flows/product/delete-product-options";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductOptionCreateInput, ProductOptionUpdateInput, ProductOptionIds, ProductOptionOutput, decodeProductOptionOutput } from "../../modules/product/option-input";
import type { ProductOptionWorkflowModule } from "../../modules/product/product-option-workflow";
import type { prepareProductOptionDeletionLinkResource } from "../../links/product-option-resource";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import type { ComposedWorkflowServices } from "../../workflow/composed-resource";
import { productOptionCreationResources, productOptionUpdateResources, productOptionDeletionResources } from "../../workflow/policy";
import { orderedProductWorkflowEvents } from "./events";

type Link = Result.Result.Success<ReturnType<typeof prepareProductOptionDeletionLinkResource>>;
type Selections<Methods extends readonly (keyof ProductOptionWorkflowModule["methods"])[]> = {
  readonly product: { readonly module: ProductOptionWorkflowModule; readonly methods: Methods; readonly graph: true };
};
type CreationResources = NativeWorkflowResources<Selections<readonly ["createProductOptions"]>, true>;
type UpdateResources = NativeWorkflowResources<Selections<readonly ["listProductOptions", "updateProductOptions"]>, true>;
type DeletionResources = NativeWorkflowResources<Selections<readonly ["softDeleteProductOptions"]>, true> & ComposedWorkflowServices<{ readonly link: Link }>;

const CreationInput = Schema.Struct({ product_options: ProductOptionCreateInput, additional_data: Schema.optionalKey(Schema.JsonObject) });
const UpdateInput = Schema.Struct({ ...ProductOptionUpdateInput.fields, additional_data: Schema.optionalKey(Schema.JsonObject) });
const DeletionInput = Schema.Struct({ ids: ProductOptionIds });
const HookInput = Schema.Struct({ product_options: ProductOptionOutput, additional_data: Schema.optionalKey(Schema.UndefinedOr(Schema.JsonObject)) });
const decodeHook = commerceDecoder(HookInput, "invalidInput");
const decodeDeletionHook = commerceDecoder(DeletionInput, "invalidInput");
const decodeIds = commerceDecoder(ProductOptionIds, "receiptMismatch");

export interface ProductOptionCreationHooks {
  readonly productOptionsCreated?: (input: typeof HookInput.Type, context: NativeWorkflowContext<CreationResources>) => unknown | Promise<unknown>;
}
export interface ProductOptionUpdateHooks {
  readonly productOptionsUpdated?: (input: typeof HookInput.Type, context: NativeWorkflowContext<UpdateResources>) => unknown | Promise<unknown>;
}
export interface ProductOptionDeletionHooks {
  readonly productOptionsDeleted?: (input: typeof DeletionInput.Type, context: NativeWorkflowContext<DeletionResources>) => unknown | Promise<unknown>;
}
export interface OptionWorkflowInput<Hooks extends object> {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductOptionWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: Hooks;
}

const prepareInputs = Effect.fn("ProductOption.prepareInputs")(function* <Hooks extends object, Extra extends object = object>(
  input: OptionWorkflowInput<Hooks> & Extra, hookName: string, selectedResources: CommerceResources = productOptionCreationResources,
) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const captured = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["product"]));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const hooks = options.hooks === undefined ? undefined : yield* Effect.fromResult(captureWorkflowRecord(options.hooks));
  if (hooks !== undefined && Object.keys(hooks).some(name => {
    const handler: unknown = Object.getOwnPropertyDescriptor(hooks, name)?.value;
    return name !== hookName || handler !== undefined && typeof handler !== "function";
  })) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const { logicalPublication: _publication, ...product } = captured.product;
  return { options, hooks, modules: { product: { ...product, logicalResources: selectedResources } } };
});

/** Native Option creation keeps the returned DTOs, hook and event ordering. */
export const prepareProductOptionCreationWorkflow = Effect.fn("ProductOption.prepareCreation")(function* (input: OptionWorkflowInput<ProductOptionCreationHooks>) {
  const { options, modules, hooks } = yield* prepareInputs<ProductOptionCreationHooks>(input, "productOptionsCreated");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProductOptions"], graph: true },
  }, true));
  const handler = hooks?.productOptionsCreated;
  const prepared = yield* Effect.fromResult(createProductOptionsWorkflow.prepare(handler === undefined ? {} : {
    productOptionsCreated: resources.callback((value: unknown, context) => captureCommerceInput(value).pipe(Result.flatMap(decodeHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-option.created", Effect.fn("ProductOption.createdIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.createProductOptions), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return (yield* Effect.fromResult(decodeProductOptionOutput(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productOptionCreationResources.calls,
    requestByteLimit: productOptionCreationResources.commandBytes, requestEventLimit: productOptionCreationResources.eventMessages,
    workflow: { name: "createProductOptionsWorkflow", resources, prepared, input: CreationInput, output: ProductOptionOutput, events } });
});

/** The native step owns its preimage list and selector-update ABI. */
export const prepareProductOptionUpdateWorkflow = Effect.fn("ProductOption.prepareUpdate")(function* (input: OptionWorkflowInput<ProductOptionUpdateHooks>) {
  const { options, modules, hooks } = yield* prepareInputs<ProductOptionUpdateHooks>(input, "productOptionsUpdated", productOptionUpdateResources);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["listProductOptions", "updateProductOptions"], graph: true },
  }, true));
  const handler = hooks?.productOptionsUpdated;
  const prepared = yield* Effect.fromResult(updateProductOptionsWorkflow.prepare(handler === undefined ? {} : {
    productOptionsUpdated: resources.callback((value: unknown, context) => captureCommerceInput(value).pipe(Result.flatMap(decodeHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-option.updated", Effect.fn("ProductOption.updatedIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.updateProductOptions), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return (yield* Effect.fromResult(decodeProductOptionOutput(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productOptionUpdateResources.calls,
    requestByteLimit: productOptionUpdateResources.commandBytes, requestEventLimit: productOptionUpdateResources.eventMessages,
    workflow: { name: "updateProductOptionsWorkflow", resources, prepared, input: UpdateInput, output: ProductOptionOutput, events } });
});

/** Native soft deletion preserves Product and Variant endpoints and emits raw requested IDs. */
export const prepareProductOptionDeletionWorkflow = Effect.fn("ProductOption.prepareDeletion")(function* (
  input: OptionWorkflowInput<ProductOptionDeletionHooks> & { readonly link: Link },
) {
  const { options, modules, hooks } = yield* prepareInputs<ProductOptionDeletionHooks, { readonly link: Link }>(input, "productOptionsDeleted", productOptionDeletionResources);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["softDeleteProductOptions"], graph: true },
  }, true, { link: options.link }));
  const handler = hooks?.productOptionsDeleted;
  const prepared = yield* Effect.fromResult(deleteProductOptionsWorkflow.prepare(handler === undefined ? {} : {
    productOptionsDeleted: resources.callback((value: unknown, context) => captureCommerceInput(value).pipe(Result.flatMap(decodeDeletionHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-option.deleted", Effect.fn("ProductOption.requestedIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.softDeleteProductOptions), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return yield* Effect.fromResult(decodeIds(call.input));
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productOptionDeletionResources.calls,
    requestByteLimit: productOptionDeletionResources.commandBytes, requestEventLimit: productOptionDeletionResources.eventMessages, operationScheduling: "queued",
    workflow: { name: "deleteProductOptionsWorkflow", resources, prepared, input: DeletionInput, output: Schema.Null, events } });
});
