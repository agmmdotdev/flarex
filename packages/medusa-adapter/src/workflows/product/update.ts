import { Effect, Result, Schema } from "effect";
import { updateProductsWorkflow } from "@medusajs/core-flows/product/update-products";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { ProductLifecycleIds } from "../../modules/product/lifecycle";
import { ProductUpdateSelector, ProductUpdateOutput, productUpdateData } from "../../modules/product/product-update-input";
import { variantUpdateData } from "../../modules/product/variant-workflow-input";
import type { ProductUpdateWorkflowModule } from "../../modules/product/product-update-workflow";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { prepareLocalProductLinks } from "../../links/product-service";
import type { prepareLocalVariantLinks } from "../../links/variant-service";
import type { prepareProductUpdateLinkResource } from "../../links/product-update-resource";
import { BasePricesUpdate } from "../../modules/pricing/input";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import type { ComposedWorkflowServices } from "../../workflow/composed-resource";
import { productUpdateParticipantResources, productUpdateResources } from "../../workflow/policy";
import { orderedProductWorkflowEvents } from "./events";

type PricingModule = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
type ProductLinks = Effect.Success<ReturnType<typeof prepareLocalProductLinks>>["workflow"];
type VariantLinks = Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>["workflow"];
type LinkResource = Result.Result.Success<ReturnType<typeof prepareProductUpdateLinkResource>>;
type Selections = {
  readonly product: { readonly module: ProductUpdateWorkflowModule; readonly methods: readonly ["listProducts", "upsertProducts", "updateProducts"]; readonly graph: true };
  readonly pricing: { readonly module: PricingModule; readonly methods: readonly ["createPriceSets", "listPriceSets", "upsertPriceSets", "updatePriceSets", "softDeletePriceSets"]; readonly graph: false };
  readonly product_links: { readonly module: ProductLinks; readonly methods: readonly ["salesNativeCreate", "salesNativeList", "salesNativeDismiss", "shippingNativeCreate", "shippingNativeList", "shippingNativeDismiss"]; readonly graph: true; readonly expose: false };
  readonly variant_links: { readonly module: VariantLinks; readonly methods: readonly ["inventoryNativeList", "inventoryNativeDismiss", "inventoryNativeSoftDelete", "pricingNativeCreate", "pricingNativeList", "pricingNativeSoftDelete"]; readonly graph: true; readonly expose: false };
};
type Resources = NativeWorkflowResources<Selections, true> & ComposedWorkflowServices<{ readonly link: LinkResource }>;
const decodeHook = commerceDecoder(Schema.Struct({ products: ProductUpdateOutput, additional_data: Schema.optionalKey(Schema.JsonObject) }), "invalidInput");
const decodeIds = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "receiptMismatch");
export interface ProductUpdateHooks {
  readonly productsUpdated?: (input: Result.Result.Success<ReturnType<typeof decodeHook>>, context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
}

/** The unchanged native parent/child own Product reconciliation, pricing and
 * Link ordering. The existing atomic host alone settles the complete root. */
export const prepareProductUpdateWorkflow = Effect.fn("MedusaWorkflow.prepareProductUpdate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductUpdateWorkflowModule>;
    readonly pricing: InstalledWorkflowModule<PricingModule>; readonly product_links: InstalledWorkflowModule<ProductLinks>;
    readonly variant_links: InstalledWorkflowModule<VariantLinks> };
  readonly link: LinkResource;
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"]; readonly hooks?: ProductUpdateHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["product", "pricing", "product_links", "variant_links"]));
  if (Object.keys(registrations).length !== 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const definition = workflowModuleDefinition(modules.product.module);
  const product = definition?.graph.reads.find(read => read.model === "Product");
  const variant = definition?.graph.reads.find(read => read.model === "ProductVariant");
  if (product === undefined || variant === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const Id = ProductLifecycleIds.value;
  const Variants = Schema.Array(variantUpdateData(variant.table.columns, { id: Schema.optionalKey(Id), prices: Schema.optionalKey(BasePricesUpdate) }))
    .check(Schema.isMaxLength(4));
  const linked = { variants: Schema.optionalKey(Variants),
    sales_channels: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(2))),
    shipping_profile_id: Schema.optionalKey(Schema.NullOr(Id)) };
  const data = productUpdateData(product.table.columns, linked);
  const entry = productUpdateData(product.table.columns, { ...linked, id: Id });
  const boundary = Schema.Union([Schema.Struct({ products: Schema.Array(entry).check(Schema.isMaxLength(4),
    Schema.makeFilter(rows => rows.reduce((total, row) => total + (row.variants?.length ?? 0), 0) <= 4)),
    additional_data: Schema.optionalKey(Schema.JsonObject) }), Schema.Struct({ selector: ProductUpdateSelector, update: data,
    additional_data: Schema.optionalKey(Schema.JsonObject) }).check(Schema.makeFilter(value =>
      (typeof value.selector.id === "string" ? 1 : value.selector.id.length) * (value.update.variants?.length ?? 0) <= 4))]);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["listProducts", "upsertProducts", "updateProducts"], graph: true },
    pricing: { module: modules.pricing.module, methods: ["createPriceSets", "listPriceSets", "upsertPriceSets", "updatePriceSets", "softDeletePriceSets"], graph: false },
    product_links: { module: modules.product_links.module, methods: ["salesNativeCreate", "salesNativeList", "salesNativeDismiss", "shippingNativeCreate", "shippingNativeList", "shippingNativeDismiss"], graph: true, expose: false },
    variant_links: { module: modules.variant_links.module, methods: ["inventoryNativeList", "inventoryNativeDismiss", "inventoryNativeSoftDelete", "pricingNativeCreate", "pricingNativeList", "pricingNativeSoftDelete"], graph: true, expose: false },
  }, true, { link: options.link }));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "productsUpdated") ||
    registeredHooks.productsUpdated !== undefined && typeof registeredHooks.productsUpdated !== "function")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const handler = registeredHooks.productsUpdated;
  type Hooks = NonNullable<Parameters<typeof updateProductsWorkflow.prepare>[0]>;
  const hooks: Hooks = handler === undefined ? {} : { productsUpdated: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHook), Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))) };
  const prepared = yield* Effect.fromResult(updateProductsWorkflow.prepare(hooks)).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product.updated", Effect.fn("ProductUpdate.returnedIds")(function* (calls) {
    const ids: string[] = [];
    for (const method of [modules.product.module.methods.upsertProducts, modules.product.module.methods.updateProducts])
      for (const value of calls.results(method)) ids.push(...(yield* Effect.fromResult(decodeIds(value))).map(row => row.id));
    return ids;
  }));
  const { logicalPublication: _productLinkPublication, ...productLinks } = modules.product_links;
  const { logicalPublication: _variantLinkPublication, ...variantLinks } = modules.variant_links;
  return yield* prepareAtomicWorkflowHost({ ...options,
    modules: { product: { ...modules.product, logicalResources: productUpdateResources, logicalPublication: "mixed" },
      pricing: { ...modules.pricing, logicalResources: productUpdateParticipantResources, logicalPublication: "mixed" },
      product_links: { ...productLinks, logicalResources: productUpdateParticipantResources },
      variant_links: { ...variantLinks, logicalResources: productUpdateParticipantResources } },
    requestCallLimit: productUpdateResources.calls, requestByteLimit: productUpdateResources.commandBytes,
    requestEventLimit: productUpdateResources.eventMessages,
    operationScheduling: "queued",
    workflow: { name: "updateProductsWorkflow", resources, prepared, input: boundary, output: ProductUpdateOutput, events } });
});
