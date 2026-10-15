import { Effect, Result, Schema } from "effect";
import { deleteProductsWorkflow } from "@medusajs/core-flows/product/delete-products";
import { deleteProductVariantsWorkflow } from "@medusajs/core-flows/product/delete-product-variants";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductDeletionIds } from "../../modules/product/commands/deletion";
import type { ProductDeletionWorkflowModule } from "../../modules/product/product-deletion-workflow";
import type { makeLocalInventoryCommands } from "../../modules/inventory/service";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { prepareLocalProductLinks } from "../../links/product-service";
import type { prepareLocalVariantLinks } from "../../links/variant-service";
import type { prepareProductDeletionLinkResource } from "../../links/product-deletion-resource";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import type { ComposedWorkflowServices } from "../../workflow/composed-resource";
import { productDeletionResources, productDeletionParticipantResources } from "../../workflow/policy";
import { orderedProductWorkflowEvents } from "./events";

type Pricing = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
type Inventory = Effect.Success<ReturnType<typeof makeLocalInventoryCommands>>["workflow"];
type ProductLinks = Effect.Success<ReturnType<typeof prepareLocalProductLinks>>["workflow"];
type VariantLinks = Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>["workflow"];
type Link = Result.Result.Success<ReturnType<typeof prepareProductDeletionLinkResource>>;
type ProductMethods = readonly (keyof ProductDeletionWorkflowModule["methods"])[];
type Selections<Methods extends ProductMethods> = {
  readonly product: { readonly module: ProductDeletionWorkflowModule; readonly methods: Methods; readonly graph: true };
  readonly inventory: { readonly module: Inventory; readonly methods: readonly ["softDeleteInventoryItems"]; readonly graph: true };
  readonly pricing: { readonly module: Pricing; readonly methods: readonly ["softDeletePriceSets"]; readonly graph: false };
  readonly product_links: { readonly module: ProductLinks; readonly methods: readonly ["salesNativeSoftDelete", "shippingNativeSoftDelete"]; readonly graph: true; readonly expose: false };
  readonly variant_links: { readonly module: VariantLinks; readonly methods: readonly ["inventoryNativeSoftDelete", "pricingNativeSoftDelete"]; readonly graph: true; readonly expose: false };
};
type Resources<Methods extends ProductMethods> = NativeWorkflowResources<Selections<Methods>, true> & ComposedWorkflowServices<{ readonly link: Link }>;
type ProductSelection = readonly ["listProducts", "softDeleteProducts"];
type VariantSelection = readonly ["softDeleteProductVariants"];
const Input = Schema.Struct({ ids: ProductDeletionIds });
const decodeHook = commerceDecoder(Input, "invalidInput");
const decodeIds = commerceDecoder(ProductDeletionIds, "receiptMismatch");
type Hook<Methods extends ProductMethods> = (input: typeof Input.Type, context: NativeWorkflowContext<Resources<Methods>>) => unknown | Promise<unknown>;
export interface ProductDeletionHooks { readonly productsDeleted?: Hook<ProductSelection> }
export interface ProductVariantDeletionHooks { readonly productVariantsDeleted?: Hook<VariantSelection> }
interface DeletionInput<Hooks extends object> {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductDeletionWorkflowModule>; readonly inventory: InstalledWorkflowModule<Inventory>;
    readonly pricing: InstalledWorkflowModule<Pricing>; readonly product_links: InstalledWorkflowModule<ProductLinks>; readonly variant_links: InstalledWorkflowModule<VariantLinks> };
  readonly link: Link; readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"]; readonly hooks?: Hooks;
}

const prepareInputs = Effect.fn("ProductDeletion.prepareInputs")(function* <Hooks extends object>(
  input: DeletionInput<Hooks>, hookName: string,
) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const captured = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["product", "inventory", "pricing", "product_links", "variant_links"]));
  if (Object.keys(registrations).length !== 5) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const hooks = options.hooks === undefined ? undefined : yield* Effect.fromResult(captureWorkflowRecord(options.hooks));
  if (hooks !== undefined && Object.keys(hooks).some(name => {
    const handler: unknown = Object.getOwnPropertyDescriptor(hooks, name)?.value;
    return name !== hookName || (handler !== undefined && typeof handler !== "function");
  }))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const select = <Module extends InstalledWorkflowModule>(binding: Module) => {
    const { logicalPublication: _publication, ...selected } = binding;
    return { ...selected, logicalResources: productDeletionParticipantResources };
  };
  const modules = { product: select(captured.product), inventory: select(captured.inventory), pricing: select(captured.pricing),
    product_links: select(captured.product_links), variant_links: select(captured.variant_links) };
  const shared = {
    inventory: { module: captured.inventory.module, methods: ["softDeleteInventoryItems"], graph: true },
    pricing: { module: captured.pricing.module, methods: ["softDeletePriceSets"], graph: false },
    product_links: { module: captured.product_links.module, methods: ["salesNativeSoftDelete", "shippingNativeSoftDelete"], graph: true, expose: false },
    variant_links: { module: captured.variant_links.module, methods: ["inventoryNativeSoftDelete", "pricingNativeSoftDelete"], graph: true, expose: false },
  } satisfies Omit<Selections<readonly []>, "product">;
  return { options, captured, modules, shared, hooks };
});

/** Actual native Product deletion, with requested-ID hooks/events and one outer settlement. */
export const prepareProductDeletionWorkflow = Effect.fn("ProductDeletion.prepareProduct")(function* (input: DeletionInput<ProductDeletionHooks>) {
  const { options, captured, modules, shared, hooks } = yield* prepareInputs(input, "productsDeleted");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ ...shared,
    product: { module: captured.product.module, methods: ["listProducts", "softDeleteProducts"], graph: true } }, true, { link: options.link }));
  const handler = hooks?.productsDeleted;
  const prepared = yield* Effect.fromResult(deleteProductsWorkflow.prepare(handler === undefined ? {} : { productsDeleted: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHook), Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))) }))
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product.deleted", Effect.fn("ProductDeletion.requestedIds")(function* (calls) {
    const ids: string[] = [];
    for (const call of calls.calls(captured.product.module.methods.softDeleteProducts)) ids.push(...yield* Effect.fromResult(decodeIds(call.input)));
    return ids;
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productDeletionResources.calls,
    requestByteLimit: productDeletionResources.commandBytes, requestEventLimit: productDeletionResources.eventMessages, operationScheduling: "queued",
    workflow: { name: "deleteProductsWorkflow", resources, prepared, input: Input, output: Schema.Null, events } });
});

export const prepareProductVariantDeletionWorkflow = Effect.fn("ProductDeletion.prepareVariant")(function* (input: DeletionInput<ProductVariantDeletionHooks>) {
  const { options, captured, modules, shared, hooks } = yield* prepareInputs(input, "productVariantsDeleted");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ ...shared,
    product: { module: captured.product.module, methods: ["softDeleteProductVariants"], graph: true } }, true, { link: options.link }));
  const handler = hooks?.productVariantsDeleted;
  const prepared = yield* Effect.fromResult(deleteProductVariantsWorkflow.prepare(handler === undefined ? {} : { productVariantsDeleted: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHook), Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))) }))
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-variant.deleted", Effect.fn("VariantDeletion.requestedIds")(function* (calls) {
    const ids: string[] = [];
    for (const call of calls.calls(captured.product.module.methods.softDeleteProductVariants)) ids.push(...yield* Effect.fromResult(decodeIds(call.input)));
    return ids;
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productDeletionResources.calls,
    requestByteLimit: productDeletionResources.commandBytes, requestEventLimit: productDeletionResources.eventMessages, operationScheduling: "queued",
    workflow: { name: "deleteProductVariantsWorkflow", resources, prepared, input: Input, output: Schema.Null, events } });
});
