import { Effect, Result, Schema } from "effect";
import { createCollectionsWorkflow } from "@medusajs/core-flows/product/create-collections";
import { updateCollectionsWorkflow } from "@medusajs/core-flows/product/update-collections";
import { deleteCollectionsWorkflow } from "@medusajs/core-flows/product/delete-collections";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductCollectionCreateInput, ProductCollectionUpdateInput, ProductCollectionIds, ProductCollectionOutput, decodeProductCollectionOutput } from "../../modules/product/collection-input";
import type { ProductCollectionWorkflowModule } from "../../modules/product/product-collection-workflow";
import type { prepareProductCollectionDeletionLinkResource } from "../../links/product-collection-resource";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import type { ComposedWorkflowServices } from "../../workflow/composed-resource";
import { productCollectionResources, productCollectionUpdateResources } from "../../workflow/policy";
import { orderedProductWorkflowEvents } from "./events";

type Link = Result.Result.Success<ReturnType<typeof prepareProductCollectionDeletionLinkResource>>;
type Selections<Methods extends readonly (keyof ProductCollectionWorkflowModule["methods"])[]> = {
  readonly product: { readonly module: ProductCollectionWorkflowModule; readonly methods: Methods; readonly graph: true };
};
type CreationResources = NativeWorkflowResources<Selections<readonly ["createProductCollections"]>, true>;
type UpdateResources = NativeWorkflowResources<Selections<readonly ["listProductCollections", "updateProductCollections"]>, true>;
type DeletionResources = NativeWorkflowResources<Selections<readonly ["softDeleteProductCollections"]>, true> & ComposedWorkflowServices<{ readonly link: Link }>;

const CreationInput = Schema.Struct({ collections: ProductCollectionCreateInput, additional_data: Schema.optionalKey(Schema.JsonObject) });
const UpdateInput = Schema.Struct({ ...ProductCollectionUpdateInput.fields, additional_data: Schema.optionalKey(Schema.JsonObject) });
const DeletionInput = Schema.Struct({ ids: ProductCollectionIds });
const HookInput = Schema.Struct({ collections: ProductCollectionOutput, additional_data: Schema.optionalKey(Schema.JsonObject) });
const decodeHook = commerceDecoder(HookInput, "invalidInput");
const decodeDeletionHook = commerceDecoder(DeletionInput, "invalidInput");
const decodeIds = commerceDecoder(ProductCollectionIds, "receiptMismatch");

export interface ProductCollectionCreationHooks {
  readonly collectionsCreated?: (input: typeof HookInput.Type, context: NativeWorkflowContext<CreationResources>) => unknown | Promise<unknown>;
}
export interface ProductCollectionUpdateHooks {
  readonly collectionsUpdated?: (input: typeof HookInput.Type, context: NativeWorkflowContext<UpdateResources>) => unknown | Promise<unknown>;
}
export interface ProductCollectionDeletionHooks {
  readonly collectionsDeleted?: (input: typeof DeletionInput.Type, context: NativeWorkflowContext<DeletionResources>) => unknown | Promise<unknown>;
}
export interface CollectionWorkflowInput<Hooks extends object> {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductCollectionWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: Hooks;
}

const prepareInputs = Effect.fn("ProductCollection.prepareInputs")(function* <Hooks extends object, Extra extends object = object>(
  input: CollectionWorkflowInput<Hooks> & Extra, hookName: string, selectedResources: CommerceResources = productCollectionResources,
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

/** Native Collection creation keeps the returned DTOs, hook and event ordering. */
export const prepareProductCollectionCreationWorkflow = Effect.fn("ProductCollection.prepareCreation")(function* (input: CollectionWorkflowInput<ProductCollectionCreationHooks>) {
  const { options, modules, hooks } = yield* prepareInputs<ProductCollectionCreationHooks>(input, "collectionsCreated");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProductCollections"], graph: true },
  }, true));
  const handler = hooks?.collectionsCreated;
  const prepared = yield* Effect.fromResult(createCollectionsWorkflow.prepare(handler === undefined ? {} : {
    collectionsCreated: resources.callback((value: unknown, context) => captureCommerceInput(value).pipe(Result.flatMap(decodeHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-collection.created", Effect.fn("ProductCollection.createdIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.createProductCollections), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return (yield* Effect.fromResult(decodeProductCollectionOutput(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productCollectionResources.calls,
    requestByteLimit: productCollectionResources.commandBytes, requestEventLimit: productCollectionResources.eventMessages,
    workflow: { name: "createCollectionsWorkflow", resources, prepared, input: CreationInput, output: ProductCollectionOutput, events } });
});

/** The native step owns its preimage list and selector-update ABI. */
export const prepareProductCollectionUpdateWorkflow = Effect.fn("ProductCollection.prepareUpdate")(function* (input: CollectionWorkflowInput<ProductCollectionUpdateHooks>) {
  const { options, modules, hooks } = yield* prepareInputs<ProductCollectionUpdateHooks>(input, "collectionsUpdated", productCollectionUpdateResources);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["listProductCollections", "updateProductCollections"], graph: true },
  }, true));
  const handler = hooks?.collectionsUpdated;
  const prepared = yield* Effect.fromResult(updateCollectionsWorkflow.prepare(handler === undefined ? {} : {
    collectionsUpdated: resources.callback((value: unknown, context) => captureCommerceInput(value).pipe(Result.flatMap(decodeHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-collection.updated", Effect.fn("ProductCollection.updatedIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.updateProductCollections), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return (yield* Effect.fromResult(decodeProductCollectionOutput(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productCollectionUpdateResources.calls,
    requestByteLimit: productCollectionUpdateResources.commandBytes, requestEventLimit: productCollectionUpdateResources.eventMessages,
    workflow: { name: "updateCollectionsWorkflow", resources, prepared, input: UpdateInput, output: ProductCollectionOutput, events } });
});

/** Native soft deletion preserves Product references and emits requested IDs. */
export const prepareProductCollectionDeletionWorkflow = Effect.fn("ProductCollection.prepareDeletion")(function* (
  input: CollectionWorkflowInput<ProductCollectionDeletionHooks> & { readonly link: Link },
) {
  const { options, modules, hooks } = yield* prepareInputs<ProductCollectionDeletionHooks, { readonly link: Link }>(input, "collectionsDeleted");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["softDeleteProductCollections"], graph: true },
  }, true, { link: options.link }));
  const handler = hooks?.collectionsDeleted;
  const prepared = yield* Effect.fromResult(deleteCollectionsWorkflow.prepare(handler === undefined ? {} : {
    collectionsDeleted: resources.callback((value: unknown, context) => captureCommerceInput(value).pipe(Result.flatMap(decodeDeletionHook),
      Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  })).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-collection.deleted", Effect.fn("ProductCollection.requestedIds")(function* (calls) {
    const writes = calls.calls(modules.product.module.methods.softDeleteProductCollections), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return yield* Effect.fromResult(decodeIds(call.input));
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productCollectionResources.calls,
    requestByteLimit: productCollectionResources.commandBytes, requestEventLimit: productCollectionResources.eventMessages, operationScheduling: "queued",
    workflow: { name: "deleteCollectionsWorkflow", resources, prepared, input: DeletionInput, output: Schema.Null, events } });
});
