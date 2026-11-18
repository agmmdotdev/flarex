import { Effect, Result, Schema } from "effect";
import { updateProductVariantsWorkflow } from "@medusajs/core-flows/product/update-product-variants";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { VariantUpdateSelector, variantUpdateData } from "../../modules/product/variant-workflow-input";
import { ProductLifecycleIds } from "../../modules/product/lifecycle";
import type { ProductVariantUpdateWorkflowModule } from "../../modules/product/variant-update-workflow";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { prepareLocalVariantLinks } from "../../links/variant-service";
import { prepareVariantUpdateLinkResource } from "../../links/variant-update-resource";
import { BasePricesUpdate } from "../../modules/pricing/input";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import type { ComposedWorkflowServices } from "../../workflow/composed-resource";
import { productVariantUpdateResources } from "../../workflow/policy";
import { orderedProductWorkflowEvents } from "./events";

type PricingModule = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
type LinkPreparation = Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>;
type LinkResource = Result.Result.Success<ReturnType<typeof prepareVariantUpdateLinkResource>>;
type Selections = {
  readonly product: { readonly module: ProductVariantUpdateWorkflowModule; readonly methods: readonly ["listProductVariants", "upsertProductVariants", "updateProductVariants"]; readonly graph: false };
  readonly pricing: { readonly module: PricingModule; readonly methods: readonly ["listPriceSets", "upsertPriceSets", "updatePriceSets"]; readonly graph: false };
  readonly variant_links: { readonly module: LinkPreparation["workflow"]; readonly methods: readonly ["inventoryNativeList", "pricingNativeList", "inventoryNativeDismiss"]; readonly graph: true; readonly expose: false };
};
type Resources = NativeWorkflowResources<Selections, true> & ComposedWorkflowServices<{ readonly link: LinkResource }>;
export const ProductVariantUpdateOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String,
  price_set: Schema.optionalKey(Schema.StructWithRest(Schema.Struct({ id: Schema.String,
    prices: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)) }), [Schema.Record(Schema.String, Schema.Json)])),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
const decodeHook = commerceDecoder(Schema.Struct({ product_variants: ProductVariantUpdateOutput, additional_data: Schema.optionalKey(Schema.JsonObject) }), "invalidInput");
const decodeIds = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "receiptMismatch");

export interface ProductVariantUpdateHooks {
  readonly productVariantsUpdated?: (input: Result.Result.Success<ReturnType<typeof decodeHook>>,
    context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
}

/** Execute the actual native composer with authentic Product/Pricing methods,
 * operation-local Link receipts and one existing outer settlement owner. */
export const prepareProductVariantUpdateWorkflow = Effect.fn("MedusaWorkflow.prepareProductVariantUpdate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductVariantUpdateWorkflowModule>;
    readonly pricing: InstalledWorkflowModule<PricingModule>; readonly variant_links: InstalledWorkflowModule<LinkPreparation["workflow"]> };
  readonly nativeLinks: { readonly inventory: unknown; readonly pricing: unknown };
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"]; readonly hooks?: ProductVariantUpdateHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["product", "pricing", "variant_links"]));
  if (Object.keys(registrations).length !== 3) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const table = workflowModuleDefinition(modules.product.module)?.graph.reads.find(read => read.model === "ProductVariant")?.table;
  if (table === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const data = variantUpdateData(table.columns, { prices: Schema.optionalKey(BasePricesUpdate) });
  const entry = variantUpdateData(table.columns, { id: ProductLifecycleIds.value, prices: Schema.optionalKey(BasePricesUpdate) });
  const boundary = Schema.Union([Schema.Struct({ product_variants: Schema.Array(entry).check(Schema.isMaxLength(4)),
    additional_data: Schema.optionalKey(Schema.JsonObject) }), Schema.Struct({ selector: VariantUpdateSelector, update: data,
    additional_data: Schema.optionalKey(Schema.JsonObject) })]);
  const nativeLinks = yield* Effect.fromResult(captureWorkflowRecord(options.nativeLinks));
  const link = yield* Effect.fromResult(prepareVariantUpdateLinkResource(nativeLinks.inventory, nativeLinks.pricing));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["listProductVariants", "upsertProductVariants", "updateProductVariants"], graph: false },
    pricing: { module: modules.pricing.module, methods: ["listPriceSets", "upsertPriceSets", "updatePriceSets"], graph: false },
    variant_links: { module: modules.variant_links.module, methods: ["inventoryNativeList", "pricingNativeList", "inventoryNativeDismiss"], graph: true, expose: false },
  }, true, { link }));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "productVariantsUpdated") ||
    registeredHooks.productVariantsUpdated !== undefined && typeof registeredHooks.productVariantsUpdated !== "function")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const handler = registeredHooks.productVariantsUpdated;
  type Hooks = NonNullable<Parameters<typeof updateProductVariantsWorkflow.prepare>[0]>;
  const hooks: Hooks = handler === undefined ? {} : { productVariantsUpdated: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHook), Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))) };
  const prepared = yield* Effect.fromResult(updateProductVariantsWorkflow.prepare(hooks)).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-variant.updated", Effect.fn("VariantUpdate.returnedIds")(function* (calls) {
    const ids: string[] = [];
    for (const method of [modules.product.module.methods.upsertProductVariants, modules.product.module.methods.updateProductVariants])
      for (const value of calls.results(method)) ids.push(...(yield* Effect.fromResult(decodeIds(value))).map(row => row.id));
    return ids;
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productVariantUpdateResources.calls,
    workflow: { name: "updateProductVariantsWorkflow", resources, prepared, input: boundary, output: ProductVariantUpdateOutput, events } });
});
