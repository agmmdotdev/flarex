import { Effect, Result, Schema } from "effect";
import { createProductCategoriesWorkflow } from "@medusajs/core-flows/product-category/create-product-categories";
import { updateProductCategoriesWorkflow } from "@medusajs/core-flows/product-category/update-product-categories";
import { deleteProductCategoriesWorkflow } from "@medusajs/core-flows/product-category/delete-product-categories";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources, type CommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductCategoryCreateInput, ProductCategoryUpdateInput, ProductCategoryIds, ProductCategoryOutput, decodeProductCategoryOutput } from "../../modules/product/category-input";
import type { ProductCategoryWorkflowModule } from "../../modules/product/product-category-workflow";
import type { prepareProductCategoryDeletionLinkResource } from "../../links/product-category-resource";
import { commerceDecoder } from "../../value/decoder";
import { captureCategoryProjection, decodeCategoryProjection } from "../../modules/product/category-projection";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import type { ComposedWorkflowServices } from "../../workflow/composed-resource";
import { productCategoryDeletionResources, productCategoryCreationResources, productCategoryUpdateResources } from "../../workflow/policy";
import { orderedProductWorkflowEvents } from "./events";

type Link = Result.Result.Success<ReturnType<typeof prepareProductCategoryDeletionLinkResource>>;
type Selections<Methods extends readonly (keyof ProductCategoryWorkflowModule["methods"])[]> = {
  readonly product: { readonly module: ProductCategoryWorkflowModule; readonly methods: Methods; readonly graph: true };
};
type CreationResources = NativeWorkflowResources<Selections<readonly ["createProductCategories"]>, true>;
type UpdateResources = NativeWorkflowResources<Selections<readonly ["listProductCategories", "updateProductCategories"]>, true>;
type DeletionResources = NativeWorkflowResources<Selections<readonly ["softDeleteProductCategories"]>, true> & ComposedWorkflowServices<{ readonly link: Link }>;

const CreationInput = Schema.Struct({ product_categories: ProductCategoryCreateInput, additional_data: Schema.optionalKey(Schema.JsonObject) });
const UpdateInput = Schema.Struct({ ...ProductCategoryUpdateInput.fields, additional_data: Schema.optionalKey(Schema.JsonObject) });
const DeletionInput = Schema.Struct({ ids: ProductCategoryIds });
const HookInput = Schema.Struct({ categories: ProductCategoryOutput, additional_data: Schema.optionalKey(Schema.UndefinedOr(Schema.JsonObject)) });
const decodeHook = commerceDecoder(HookInput, "invalidInput");
const captureHook = (value: unknown) => captureCategoryProjection(value, defaultCommerceResources).pipe(
  Result.flatMap(decodeCategoryProjection), Result.flatMap(decodeHook),
);
const decodeDeletionHook = commerceDecoder(DeletionInput, "invalidInput");
const decodeIds = commerceDecoder(ProductCategoryIds, "receiptMismatch");

export interface ProductCategoryCreationHooks {
  readonly categoriesCreated?: (input: typeof HookInput.Type, context: NativeWorkflowContext<CreationResources>) => unknown | Promise<unknown>;
}
export interface ProductCategoryUpdateHooks {
  readonly categoriesUpdated?: (input: typeof HookInput.Type, context: NativeWorkflowContext<UpdateResources>) => unknown | Promise<unknown>;
}
export interface ProductCategoryDeletionHooks {
  readonly categoriesDeleted?: (input: typeof DeletionInput.Type, context: NativeWorkflowContext<DeletionResources>) => unknown | Promise<unknown>;
}
export interface CategoryWorkflowInput<Hooks extends object> {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductCategoryWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: Hooks;
}

const prepareInputs = Effect.fn("ProductCategory.prepareInputs")(function* <Hooks extends object, Extra extends object = object>(
  input: CategoryWorkflowInput<Hooks> & Extra, hookName: string, selectedResources: CommerceResources,
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

/** Native Category creation keeps the returned DTOs, hook and event ordering. */
export const prepareProductCategoryCreationWorkflow = Effect.fn("ProductCategory.prepareCreation")(function* (input: CategoryWorkflowInput<ProductCategoryCreationHooks>) {
  const { options, modules, hooks } = yield* prepareInputs<ProductCategoryCreationHooks>(input, "categoriesCreated", productCategoryCreationResources);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProductCategories"], graph: true },
  }, true));
  const handler = hooks?.categoriesCreated;
  const prepared = yield* Effect.fromResult(createProductCategoriesWorkflow.prepare(handler === undefined ? {} : {
    categoriesCreated: resources.callback((value: unknown, context) => captureHook(value).pipe(
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-category.created", Effect.fn("ProductCategory.createdIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.createProductCategories), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return (yield* Effect.fromResult(decodeProductCategoryOutput(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productCategoryCreationResources.calls,
    requestByteLimit: productCategoryCreationResources.commandBytes, requestEventLimit: productCategoryCreationResources.eventMessages,
    workflow: { name: "createProductCategoriesWorkflow", resources, prepared, input: CreationInput, output: ProductCategoryOutput, events } });
});

/** The native step owns its preimage list and selector-update ABI. */
export const prepareProductCategoryUpdateWorkflow = Effect.fn("ProductCategory.prepareUpdate")(function* (input: CategoryWorkflowInput<ProductCategoryUpdateHooks>) {
  const { options, modules, hooks } = yield* prepareInputs<ProductCategoryUpdateHooks>(input, "categoriesUpdated", productCategoryUpdateResources);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["listProductCategories", "updateProductCategories"], graph: true },
  }, true));
  const handler = hooks?.categoriesUpdated;
  const prepared = yield* Effect.fromResult(updateProductCategoriesWorkflow.prepare(handler === undefined ? {} : {
    categoriesUpdated: resources.callback((value: unknown, context) => captureHook(value).pipe(
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-category.updated", Effect.fn("ProductCategory.updatedIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.updateProductCategories), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return (yield* Effect.fromResult(decodeProductCategoryOutput(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productCategoryUpdateResources.calls,
    requestByteLimit: productCategoryUpdateResources.commandBytes, requestEventLimit: productCategoryUpdateResources.eventMessages,
    workflow: { name: "updateProductCategoriesWorkflow", resources, prepared, input: UpdateInput, output: ProductCategoryOutput, events } });
});

/** Native leaf soft deletion preserves Product pivots and emits requested IDs. */
export const prepareProductCategoryDeletionWorkflow = Effect.fn("ProductCategory.prepareDeletion")(function* (
  input: CategoryWorkflowInput<ProductCategoryDeletionHooks> & { readonly link: Link },
) {
  const { options, modules, hooks } = yield* prepareInputs<ProductCategoryDeletionHooks, { readonly link: Link }>(input, "categoriesDeleted", productCategoryDeletionResources);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["softDeleteProductCategories"], graph: true },
  }, true, { link: options.link }));
  const handler = hooks?.categoriesDeleted;
  const prepared = yield* Effect.fromResult(deleteProductCategoriesWorkflow.prepare(handler === undefined ? {} : {
    categoriesDeleted: resources.callback((value: unknown, context) => captureCategoryProjection(value, defaultCommerceResources).pipe(Result.flatMap(decodeCategoryProjection), Result.flatMap(decodeDeletionHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-category.deleted", Effect.fn("ProductCategory.requestedIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.softDeleteProductCategories), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return yield* Effect.fromResult(decodeIds(call.input));
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productCategoryDeletionResources.calls,
    requestByteLimit: productCategoryDeletionResources.commandBytes, requestEventLimit: productCategoryDeletionResources.eventMessages, operationScheduling: "queued",
    workflow: { name: "deleteProductCategoriesWorkflow", resources, prepared, input: ProductCategoryIds, output: Schema.Null, events } });
});
