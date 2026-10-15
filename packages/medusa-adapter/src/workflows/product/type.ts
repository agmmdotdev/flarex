import { Effect, Result, Schema } from "effect";
import { createProductTypesWorkflow } from "@medusajs/core-flows/product/create-product-types";
import { updateProductTypesWorkflow } from "@medusajs/core-flows/product/update-product-types";
import { deleteProductTypesWorkflow } from "@medusajs/core-flows/product/delete-product-types";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductTypeCreateInput, ProductTypeUpdateInput, ProductTypeIds, ProductTypeOutput, decodeProductTypeOutput } from "../../modules/product/type-input";
import type { ProductTypeWorkflowModule } from "../../modules/product/product-type-workflow";
import type { prepareProductTypeDeletionLinkResource } from "../../links/product-type-resource";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import type { ComposedWorkflowServices } from "../../workflow/composed-resource";
import { productTypeResources } from "../../workflow/policy";
import { orderedProductWorkflowEvents } from "./events";

type Link = Result.Result.Success<ReturnType<typeof prepareProductTypeDeletionLinkResource>>;
type Selections<Methods extends readonly (keyof ProductTypeWorkflowModule["methods"])[]> = {
  readonly product: { readonly module: ProductTypeWorkflowModule; readonly methods: Methods; readonly graph: true };
};
type CreationResources = NativeWorkflowResources<Selections<readonly ["createProductTypes"]>, true>;
type UpdateResources = NativeWorkflowResources<Selections<readonly ["listProductTypes", "updateProductTypes"]>, true>;
type DeletionResources = NativeWorkflowResources<Selections<readonly ["softDeleteProductTypes"]>, true> & ComposedWorkflowServices<{ readonly link: Link }>;

const CreationInput = Schema.Struct({ product_types: ProductTypeCreateInput, additional_data: Schema.optionalKey(Schema.JsonObject) });
const UpdateInput = Schema.Struct({ ...ProductTypeUpdateInput.fields, additional_data: Schema.optionalKey(Schema.JsonObject) });
const DeletionInput = Schema.Struct({ ids: ProductTypeIds });
const HookInput = Schema.Struct({ product_types: ProductTypeOutput, additional_data: Schema.optionalKey(Schema.JsonObject) });
const decodeHook = commerceDecoder(HookInput, "invalidInput");
const decodeDeletionHook = commerceDecoder(DeletionInput, "invalidInput");
const decodeIds = commerceDecoder(ProductTypeIds, "receiptMismatch");

export interface ProductTypeCreationHooks {
  readonly productTypesCreated?: (input: typeof HookInput.Type, context: NativeWorkflowContext<CreationResources>) => unknown | Promise<unknown>;
}
export interface ProductTypeUpdateHooks {
  readonly productTypesUpdated?: (input: typeof HookInput.Type, context: NativeWorkflowContext<UpdateResources>) => unknown | Promise<unknown>;
}
export interface ProductTypeDeletionHooks {
  readonly productTypesDeleted?: (input: typeof DeletionInput.Type, context: NativeWorkflowContext<DeletionResources>) => unknown | Promise<unknown>;
}
export interface TypeWorkflowInput<Hooks extends object> {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductTypeWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: Hooks;
}

const prepareInputs = Effect.fn("ProductType.prepareInputs")(function* <Hooks extends object, Extra extends object = object>(
  input: TypeWorkflowInput<Hooks> & Extra, hookName: string,
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
  return { options, hooks, modules: { product: { ...product, logicalResources: productTypeResources } } };
});

/** Native Type creation keeps the returned DTOs, hook and event ordering. */
export const prepareProductTypeCreationWorkflow = Effect.fn("ProductType.prepareCreation")(function* (input: TypeWorkflowInput<ProductTypeCreationHooks>) {
  const { options, modules, hooks } = yield* prepareInputs<ProductTypeCreationHooks>(input, "productTypesCreated");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProductTypes"], graph: true },
  }, true));
  const handler = hooks?.productTypesCreated;
  const prepared = yield* Effect.fromResult(createProductTypesWorkflow.prepare(handler === undefined ? {} : {
    productTypesCreated: resources.callback((value: unknown, context) => captureCommerceInput(value).pipe(Result.flatMap(decodeHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-type.created", Effect.fn("ProductType.createdIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.createProductTypes), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return (yield* Effect.fromResult(decodeProductTypeOutput(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productTypeResources.calls,
    requestByteLimit: productTypeResources.commandBytes, requestEventLimit: productTypeResources.eventMessages,
    workflow: { name: "createProductTypesWorkflow", resources, prepared, input: CreationInput, output: ProductTypeOutput, events } });
});

/** The native step owns its preimage list and selector-update ABI. */
export const prepareProductTypeUpdateWorkflow = Effect.fn("ProductType.prepareUpdate")(function* (input: TypeWorkflowInput<ProductTypeUpdateHooks>) {
  const { options, modules, hooks } = yield* prepareInputs<ProductTypeUpdateHooks>(input, "productTypesUpdated");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["listProductTypes", "updateProductTypes"], graph: true },
  }, true));
  const handler = hooks?.productTypesUpdated;
  const prepared = yield* Effect.fromResult(updateProductTypesWorkflow.prepare(handler === undefined ? {} : {
    productTypesUpdated: resources.callback((value: unknown, context) => captureCommerceInput(value).pipe(Result.flatMap(decodeHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-type.updated", Effect.fn("ProductType.updatedIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.updateProductTypes), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return (yield* Effect.fromResult(decodeProductTypeOutput(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productTypeResources.calls,
    requestByteLimit: productTypeResources.commandBytes, requestEventLimit: productTypeResources.eventMessages,
    workflow: { name: "updateProductTypesWorkflow", resources, prepared, input: UpdateInput, output: ProductTypeOutput, events } });
});

/** Native soft deletion preserves Product references and emits requested IDs. */
export const prepareProductTypeDeletionWorkflow = Effect.fn("ProductType.prepareDeletion")(function* (
  input: TypeWorkflowInput<ProductTypeDeletionHooks> & { readonly link: Link },
) {
  const { options, modules, hooks } = yield* prepareInputs<ProductTypeDeletionHooks, { readonly link: Link }>(input, "productTypesDeleted");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["softDeleteProductTypes"], graph: true },
  }, true, { link: options.link }));
  const handler = hooks?.productTypesDeleted;
  const prepared = yield* Effect.fromResult(deleteProductTypesWorkflow.prepare(handler === undefined ? {} : {
    productTypesDeleted: resources.callback((value: unknown, context) => captureCommerceInput(value).pipe(Result.flatMap(decodeDeletionHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-type.deleted", Effect.fn("ProductType.requestedIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.softDeleteProductTypes), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return yield* Effect.fromResult(decodeIds(call.input));
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productTypeResources.calls,
    requestByteLimit: productTypeResources.commandBytes, requestEventLimit: productTypeResources.eventMessages, operationScheduling: "queued",
    workflow: { name: "deleteProductTypesWorkflow", resources, prepared, input: DeletionInput, output: Schema.Null, events } });
});
